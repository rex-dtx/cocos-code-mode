import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, '..');
const sourceRoots = ['src', 'scripts'];
const manifestFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const localSpecifier = /^(?:file:|link:|portal:|workspace:|https?:|git(?:\+[^:]+)?:|github:|\.{0,2}[\\/]|[A-Za-z]:[\\/])/i;
const importPattern = /(?:\bimport\s*(?:[^'"()]*?\sfrom\s*)?|\bexport\s+[^'"]*?\sfrom\s*|\brequire\s*\(|\bimport\s*\()\s*(['"])([^'"]+)\1/g;

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesUnder(full));
    else if (entry.isFile() && /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)) output.push(full);
  }
  return output;
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function auditProductBoundary(root = defaultRoot) {
  const issues = [];
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const field of manifestFields) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (typeof specifier !== 'string' || localSpecifier.test(specifier)) {
        issues.push(`package.json ${field}.${name} must resolve from a registry, not ${JSON.stringify(specifier)}`);
      }
    }
  }

  const lockPath = path.join(root, 'yarn.lock');
  if (fs.existsSync(lockPath)) {
    const lock = fs.readFileSync(lockPath, 'utf8');
    for (const match of lock.matchAll(/^\s*(?:resolved\s+)?["']?((?:file|link|portal|workspace):[^\s"']+)/gm)) {
      issues.push(`yarn.lock contains local dependency ${match[1]}`);
    }
  }

  for (const sourceRoot of sourceRoots) {
    for (const file of filesUnder(path.join(root, sourceRoot))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[2];
        if (/^mcpdocs(?:[\\/@]|$)/i.test(specifier) || specifier.includes('/mcpdocs/')) {
          issues.push(`${path.relative(root, file)} imports product-owned mcpdocs code: ${specifier}`);
          continue;
        }
        if (!specifier.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!within(root, resolved)) issues.push(`${path.relative(root, file)} escapes the Gateway root: ${specifier}`);
      }
    }
  }
  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = auditProductBoundary();
  if (issues.length) {
    console.error(`product boundary audit failed:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('product boundary audit: clean');
  }
}
