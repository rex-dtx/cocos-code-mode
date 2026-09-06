const { createHash, createPrivateKey, sign: ed25519Sign } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const zipPath = process.argv[2] || fs.readdirSync(projectRoot).filter((name) => /^cc-bridge-3x.*\.zip$/.test(name)).sort().at(-1);
if (!zipPath) {
  console.error("No cc-bridge-3x ZIP found. Pass an explicit path.");
  process.exit(1);
}
const resolved = path.resolve(projectRoot, zipPath);
if (!fs.existsSync(resolved)) {
  console.error(`ZIP not found: ${resolved}`);
  process.exit(1);
}

const bytes = fs.readFileSync(resolved);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const payload = {
  schemaVersion: 1,
  artifact: path.basename(resolved),
  sha256,
  bytes: bytes.length,
  builtAt: new Date().toISOString(),
  rollbackSlots: 1,
};
const distDir = path.join(projectRoot, "dist");
fs.mkdirSync(distDir, { recursive: true });
const manifestPath = path.join(distDir, "release-manifest.json");
const body = JSON.stringify(payload, null, 2);
fs.writeFileSync(manifestPath, `${body}\n`);

const pkcs8 = process.env.CCB_RELEASE_PRIVATE_KEY;
const keyId = process.env.CCB_RELEASE_KEY_ID;
if (pkcs8 && keyId) {
  const privateKey = createPrivateKey({ key: Buffer.from(pkcs8, "base64url"), format: "der", type: "pkcs8" });
  const message = Buffer.concat([Buffer.from("CCB1 release-root\n", "utf8"), Buffer.from(body)]);
  const signature = ed25519Sign(null, message, privateKey).toString("base64url");
  fs.writeFileSync(path.join(distDir, "release-manifest.sig.json"), `${JSON.stringify({ keyId, signature }, null, 2)}\n`);
  console.log(`Signed release metadata with ${keyId}`);
} else {
  console.warn("CCB_RELEASE_PRIVATE_KEY / CCB_RELEASE_KEY_ID unset — wrote unsigned SHA-256 manifest only");
}
console.log(`Wrote ${manifestPath}`);
console.log(`sha256 ${sha256}`);
