const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");

const root = path.join(__dirname, "..");
const outDir = path.join(os.tmpdir(), `ccb-support-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });

// Only public metadata is eligible. Project payloads, source, screenshots,
// results, observations, credentials, and update URLs never enter the bundle.
const allow = [
  "package.json",
  "dist/build-info.json",
  "dist/package-manifest.json",
  "dist/release-target.signed.json",
];
const sensitiveKey = /credential|password|token|private[_-]?key|pkcs8|secret|bearer/i;
const redact = () => "[redacted]";
const copied = [];

function redactJson(text) {
  try {
    const json = JSON.parse(text);
    return `${JSON.stringify(json, (key, value) => (sensitiveKey.test(key) ? redact() : value), 2)}\n`;
  } catch {
    return text;
  }
}

for (const rel of allow) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) continue;
  const text = redactJson(fs.readFileSync(src, "utf8"));
  const dest = path.join(outDir, path.basename(rel));
  fs.writeFileSync(dest, text);
  copied.push({ file: path.basename(rel), sha256: createHash("sha256").update(text).digest("hex") });
}

// Canary-secret scan: refuse to emit a bundle that leaked a private key or
// credential marker anywhere in its output. A signature is public, so it is
// not a canary; an Ed25519 PKCS8 DER prefix or PEM private key is.
const forbiddenMarkers = [
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /MC4CAQAwBQYDK2VwBCIE/, // Ed25519 PKCS8 DER, base64url
  /\.utcp-debug/,
];
let leaked = null;
for (const entry of copied) {
  const body = fs.readFileSync(path.join(outDir, entry.file), "utf8");
  for (const marker of forbiddenMarkers) {
    if (marker.test(body)) { leaked = entry.file; break; }
  }
  if (leaked) break;
}
if (leaked) {
  console.error(`support bundle refused: canary marker leaked in ${leaked}`);
  process.exit(1);
}

const index = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  excludes: ["project payloads", "credentials", "screenshots", "observation bodies", "source", "results"],
  files: copied,
};
fs.writeFileSync(path.join(outDir, "bundle.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(outDir);
console.log("support bundle: privacy-safe defaults, canary scan clean");
