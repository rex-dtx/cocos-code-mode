const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");

const root = path.join(__dirname, "..");
const outDir = path.join(os.tmpdir(), `ccb-support-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });

const allow = [
  "package.json",
  "dist/build-info.json",
  "dist/release-manifest.json",
];
const redact = /credential|password|token|private[_-]?key|pkcs8|secret/i;
const copied = [];

for (const rel of allow) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(outDir, path.basename(rel));
  let text = fs.readFileSync(src, "utf8");
  try {
    const json = JSON.parse(text);
    text = `${JSON.stringify(json, (key, value) => (redact.test(key) ? "[redacted]" : value), 2)}\n`;
  } catch {
    /* keep raw */
  }
  fs.writeFileSync(dest, text);
  copied.push({
    file: path.basename(rel),
    sha256: createHash("sha256").update(text).digest("hex"),
  });
}

const index = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  excludes: ["project payloads", "credentials", "screenshots", "observation bodies"],
  files: copied,
};
fs.writeFileSync(path.join(outDir, "bundle.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(outDir);
console.log("support bundle: privacy-safe defaults");
