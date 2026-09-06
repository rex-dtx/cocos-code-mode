const { createHash, createPrivateKey, createPublicKey, sign, verify } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Offline immutable-target signer. Emits a SignedMetadata envelope
// (payload + signatures[]) over a ReleaseTargetBody, signed with the
// "CCB1 release-targets\n" domain prefix — the exact shape that
// gateway/src/cc-bridge/release-metadata.ts and source/update/metadata.ts
// verify. Target keys are distinct from root/policy keys.

const TARGET_PREFIX = Buffer.from("CCB1 release-targets\n", "utf8");
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const projectRoot = path.join(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));

// RFC 8785 JCS — byte-identical to source/protected/canonical-json.ts
// (sorted keys + JSON.stringify for primitives; no number rewriting needed
// for this schema's integer/hex/ISO-string fields).
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function decodeBase64UrlStrict(value, exactBytes) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.includes("=")) {
    throw new Error("invalid unpadded base64url");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error("invalid base64url encoding");
  if (exactBytes !== undefined && bytes.length !== exactBytes) throw new Error(`expected ${exactBytes} bytes, got ${bytes.length}`);
  return bytes;
}

function assertKeyId(keyId) {
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error("invalid key ID");
}

function readZip() {
  const explicit = process.argv[2];
  const zipPath = explicit
    || fs.readdirSync(projectRoot).filter((name) => /^cc-bridge-3x.*\.zip$/.test(name)).sort().at(-1);
  if (!zipPath) {
    console.error("No cc-bridge-3x ZIP found. Pass an explicit path.");
    process.exit(1);
  }
  const resolved = path.resolve(projectRoot, zipPath);
  if (!fs.existsSync(resolved)) {
    console.error(`ZIP not found: ${resolved}`);
    process.exit(1);
  }
  return { resolved, basename: path.basename(resolved), bytes: fs.readFileSync(resolved) };
}

function buildReleaseTargetBody(artifact) {
  const now = new Date();
  return {
    schemaVersion: 1,
    metadataVersion: 1,
    releaseSequence: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    package: {
      name: packageJson.name,
      version: packageJson.version,
      sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
      size: artifact.bytes.length,
      url: "",
      packageManifestSha256: "",
      sbomSha256: "",
      provenanceSha256: "",
    },
    compatibility: {
      protocol: { min: 1, max: 1 },
      creator: packageJson.editor || ">=3.7.0",
      os: ["win32"],
      arch: ["x64"],
    },
  };
}

function main() {
  const artifact = readZip();
  const body = buildReleaseTargetBody(artifact);
  const payloadBytes = Buffer.from(canonicalize(body), "utf8");
  const message = Buffer.concat([TARGET_PREFIX, payloadBytes]);

  const keyId = process.env.CCB_RELEASE_TARGETS_KEY_ID;
  const privateKeyB64 = process.env.CCB_RELEASE_TARGETS_PRIVATE_KEY;
  const publicKeyB64 = process.env.CCB_RELEASE_TARGETS_PUBLIC_KEY;

  if (!keyId || !privateKeyB64) {
    console.error("CCB_RELEASE_TARGETS_KEY_ID and CCB_RELEASE_TARGETS_PRIVATE_KEY (PKCS8 DER base64url) are required.");
    process.exit(1);
  }
  assertKeyId(keyId);

  const privateKey = createPrivateKey({ key: Buffer.from(privateKeyB64, "base64url"), format: "der", type: "pkcs8" });
  const signatureBytes = sign(null, message, privateKey);
  if (signatureBytes.length !== 64) throw new Error("Ed25519 produced an unexpected signature length");

  const signed = {
    payload: payloadBytes.toString("base64url"),
    signatures: [{ keyId, signature: signatureBytes.toString("base64url") }],
  };

  const distDir = path.join(projectRoot, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  const outPath = path.join(distDir, "release-target.signed.json");
  fs.writeFileSync(outPath, JSON.stringify(signed, null, 2) + "\n");

  // Self-verify the round trip when the public key is available.
  if (publicKeyB64) {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyB64, "base64url"), format: "der", type: "spki" });
    const recovered = decodeBase64UrlStrict(signed.payload);
    const recoveredMessage = Buffer.concat([TARGET_PREFIX, recovered]);
    const ok = verify(null, recoveredMessage, publicKey, signatureBytes);
    if (!ok) throw new Error("self-verify failed: signature does not cover the canonical payload");
    console.log("self-verify: OK");
  }

  console.log(`Wrote ${outPath}`);
  console.log(`package ${body.package.name}@${body.package.version}`);
  console.log(`sha256 ${body.package.sha256}`);
  console.log(`size ${body.package.size}`);
}

main();
