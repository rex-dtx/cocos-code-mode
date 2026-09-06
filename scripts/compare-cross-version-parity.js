'use strict';

const { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } = require('fs');
const { join, extname } = require('path');

const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'source', 'utcp');
const CONTRACT = JSON.parse(readFileSync(join(ROOT, 'parity', 'portable-capabilities.json'), 'utf8'));

function walk(dir, acc) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (name === 'node_modules' || name === 'dist' || name === 'tools') continue;
            walk(full, acc);
        } else if (extname(full) === '.ts') {
            acc.push(full);
        }
    }
    return acc;
}

function extractTools(files) {
    const names = new Set();
    const re = /@utcpTool\(\s*'([^']+)'/g;
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        let match;
        while ((match = re.exec(text)) !== null) {
            names.add(match[1]);
        }
    }
    return names;
}

const files = walk(SOURCE, []);
const found = extractTools(files);
const required = CONTRACT.required2xTools;
const missing = required.filter((name) => !found.has(name));
const extraEngineLimit = (CONTRACT.engineLimit3xOnly || []).filter((name) => found.has(name));

const manifest = {
    generatedAt: new Date().toISOString(),
    toolCount: found.size,
    tools: [...found].sort(),
    requiredCount: required.length,
    missing,
    engineLimitPresentOn2x: extraEngineLimit,
};

mkdirSync(join(ROOT, 'parity'), { recursive: true });
writeFileSync(join(ROOT, 'parity', 'cc-bridge-2x.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

if (missing.length) {
    console.error(`parity: missing ${missing.length} required tools:\n  ${missing.join('\n  ')}`);
    process.exitCode = 1;
} else {
    console.log(`parity: ${found.size} tools, ${required.length}/${required.length} required portable tools present`);
}
