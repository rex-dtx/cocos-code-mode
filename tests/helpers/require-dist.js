'use strict';

const fs = require('fs');
const path = require('path');

function requireDist(rel) {
    const distPath = path.resolve(__dirname, '..', '..', 'dist', rel);
    if (!fs.existsSync(distPath)) {
        throw new Error(`dist not found at ${distPath}. Run npm run build first.`);
    }
    return require(distPath);
}

function readSource(rel) {
    return fs.readFileSync(path.resolve(__dirname, '..', '..', 'source', rel), 'utf8');
}

module.exports = { requireDist, readSource };
