const fs = require('fs');
const path = require('path');
const os = require('os');

// Resolve compiled dist regardless of cwd (tests/ vs root).
function requireDist(rel) {
  const distPath = path.resolve(__dirname, '..', '..', 'dist', rel);
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `dist not found at ${distPath}. Run \`npm run build\` first. ` +
      `Unit tests import compiled JS from dist/ (pure modules have no Editor dep).`
    );
  }
  return require(distPath);
}

// Small helper: read source text for string-safety tests that must forbid specific patterns.
function readSource(rel) {
  const p = path.resolve(__dirname, '..', '..', 'source', rel);
  return fs.readFileSync(p, 'utf8');
}

module.exports = { requireDist, readSource };
