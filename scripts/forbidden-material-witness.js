const fs = require("node:fs");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist");
const forbidden = [
  /new Function\s*\(/,
  /\beval\s*\(/,
  /CCB_EXECUTION_PRIVATE_KEY/,
  /planCreateUiNode/,
  // Customer protected artifact carries no process launch or raw debug persistence.
  /require\(['"]child_process['"]\)/,
  /from\s+['"]child_process['"]/,
  /\bexecFile\b/,
  /\bexecSync\b/,
  /\bspawn(?:Sync)?\s*\(/,
  /\.utcp-debug/,
  /\bDEBUG_LOG_DIR\b/,
];
let hits = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`missing ${dir}`);
    process.exit(1);
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (path.extname(entry.name) === ".map") continue;
    const text = fs.readFileSync(full, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        console.error(`${full}: ${pattern}`);
        hits += 1;
      }
    }
  }
}

walk(dist);
if (fs.existsSync(path.join(dist, "utcp", "execute"))) {
  console.error("dist/utcp/execute must not ship");
  hits += 1;
}
for (const stale of ["dist/utcp/tools/program-tools.js", "dist/utcp/tools/diagnostics-tools.js"]) {
  if (fs.existsSync(path.join(__dirname, "..", stale))) {
    console.error(`${stale} must not ship`);
    hits += 1;
  }
}
if (hits) {
  console.error(`forbidden material witness failed: ${hits} hit(s)`);
  process.exit(1);
}
console.log("forbidden material witness: clean");
