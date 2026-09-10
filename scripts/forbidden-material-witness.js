const fs = require("node:fs");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist");
const forbidden = [
  /new Function\s*\(/,
  /\beval\s*\(/,
  /CCB_EXECUTION_PRIVATE_KEY/,
  /planCreateUiNode/,
  /sourceMappingURL=data:/,
  /"sourcesContent"\s*:/,
  /\bexecuteJavascript\b/,
  /\.utcp-debug/,
  /\bDEBUG_LOG_DIR\b/,
];
const updaterProcess = [
  /require\(['"]child_process['"]\)/,
  /from\s+['"]child_process['"]/,
  /\bexecFile\b/,
  /\bexecSync\b/,
  /\bspawn(?:Sync)?\s*\(/,
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
    if (entry.name.endsWith(".map") || entry.name.endsWith(".ts")) {
      console.error(`${full}: source/source-map file must not ship`);
      hits += 1;
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    const isUpdaterRuntime = full.startsWith(`${path.join(dist, "update")}${path.sep}`);
    const patterns = isUpdaterRuntime ? forbidden : [...forbidden, ...updaterProcess];
    for (const pattern of patterns) {
      if (pattern.source === "\\bexecuteJavascript\\b" && text.includes("REMOVED_CUSTOMER_TOOLS")) continue;
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
