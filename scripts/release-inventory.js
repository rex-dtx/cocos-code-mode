'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const STATIC_ROOTS = ['@types', 'dist', 'i18n', 'static'];
const STATIC_FILES = ['package-lock.json'];
const GENERATED_SIDECARS = new Set([
  'dist/package-manifest.json',
  'dist/sbom.cdx.json',
  'dist/provenance.intoto.json',
  'dist/release-target.signed.json',
]);
const FORBIDDEN_SUFFIXES = ['.map', '.tsbuildinfo'];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizedMode(stat) {
  return stat.mode & 0o111 ? 0o755 : 0o644;
}

function assertOrdinaryFile(fsPath, stat) {
  if (stat.isSymbolicLink()) throw new Error(`package input must not be a symlink: ${fsPath}`);
  if (!stat.isFile()) throw new Error(`package input must be a regular file: ${fsPath}`);
}

function shouldInclude(relativePath) {
  const posixPath = toPosix(relativePath);
  return !GENERATED_SIDECARS.has(posixPath)
    && !FORBIDDEN_SUFFIXES.some((suffix) => posixPath.endsWith(suffix));
}

function collectTree(projectRoot, relativeRoot, entries, options = {}) {
  const absoluteRoot = path.join(projectRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) throw new Error(`required package input missing: ${relativeRoot}`);
  const walk = (absolutePath, relativePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`package input must not be a symlink: ${relativePath}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath).sort()) {
        if (options.skipNestedNodeModules && name === 'node_modules') continue;
        if (options.skipVendorNoise && /^(?:test|tests|__tests__|example|examples|fixture|fixtures|\.github)$/i.test(name)) continue;
        walk(path.join(absolutePath, name), path.join(relativePath, name));
      }
      return;
    }
    assertOrdinaryFile(relativePath, stat);
    if (!shouldInclude(relativePath)) return;
    const bytes = fs.readFileSync(absolutePath);
    entries.push({
      sourcePath: absolutePath,
      relativePath: toPosix(relativePath),
      size: bytes.length,
      sha256: sha256(bytes),
      mode: normalizedMode(stat),
    });
  };
  walk(absoluteRoot, relativeRoot);
}

function productionPackageRoots(projectRoot) {
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json must use lockfileVersion 3 with a packages map');
  }
  return Object.entries(lock.packages)
    .filter(([packagePath, metadata]) => packagePath.startsWith('node_modules/') && metadata && metadata.dev !== true)
    .map(([packagePath]) => packagePath)
    .sort();
}

function assignArchivePaths(entries, packageName) {
  const seen = new Set();
  for (const entry of entries) {
    const archivePath = `${packageName}/${entry.relativePath}`;
    const collisionKey = archivePath.toLocaleLowerCase('en-US');
    if (seen.has(collisionKey)) throw new Error(`case-colliding package path: ${archivePath}`);
    seen.add(collisionKey);
    entry.archivePath = archivePath;
  }
}

function collectPackageEntries(projectRoot, packageName, patchedPackageJson) {
  const entries = [];
  for (const relativeRoot of STATIC_ROOTS) collectTree(projectRoot, relativeRoot, entries);
  for (const relativeFile of STATIC_FILES) collectTree(projectRoot, relativeFile, entries);
  for (const packageRoot of productionPackageRoots(projectRoot)) {
    collectTree(projectRoot, packageRoot, entries, { skipNestedNodeModules: true, skipVendorNoise: true });
  }

  const packageBytes = Buffer.from(JSON.stringify(patchedPackageJson, null, 2));
  entries.push({
    sourcePath: null,
    bytes: packageBytes,
    relativePath: 'package.json',
    size: packageBytes.length,
    sha256: sha256(packageBytes),
    mode: 0o644,
  });

  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  assignArchivePaths(entries, packageName);
  return entries;
}

function createPackageManifest(packageName, version, entries) {
  return {
    schemaVersion: 1,
    package: packageName,
    version,
    files: entries.map(({ archivePath, size, sha256: digest, mode }) => ({
      path: archivePath,
      size,
      sha256: digest,
      mode,
    })),
  };
}

const FORBIDDEN_ARCHIVE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|[^/]*(?:private[-_]?key|credential|secret)[^/]*)/i;
const NESTED_ARCHIVE = /\.(?:zip|tgz|tar|gz|7z|rar|asar)$/i;
const SECRET_TEXT = [
  /CCB_(?:EXECUTION|RELEASE|DEVICE)[A-Z0-9_]*PRIVATE_KEY/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const FIRST_PARTY_FORBIDDEN_TEXT = [
  /sourceMappingURL=data:/,
  /"sourcesContent"\s*:/,
  /\bexecuteJavascript\b/,
  /\bplanCreateUiNode\b/,
  /\bnew Function\s*\(/,
  /\beval\s*\(/,
  /(?:node:)?child_process/,
];

function isVendorPath(relativePath) {
  return relativePath.startsWith('node_modules/');
}

function isVendorDoc(relativePath) {
  return isVendorPath(relativePath) && /\.(?:md|markdown|txt)$/i.test(relativePath);
}

function assertReleaseInventory(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('release inventory is empty');
  for (const entry of entries) {
    if (!isVendorPath(entry.relativePath) && FORBIDDEN_ARCHIVE_PATH.test(entry.archivePath)) {
      throw new Error(`sensitive package path: ${entry.archivePath}`);
    }
    if (NESTED_ARCHIVE.test(entry.archivePath)) throw new Error(`nested archive is not allowed: ${entry.archivePath}`);
    if (isVendorDoc(entry.relativePath)) continue;
    const bytes = entry.bytes || fs.readFileSync(entry.sourcePath);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    const patterns = isVendorPath(entry.relativePath)
      ? SECRET_TEXT
      : SECRET_TEXT.concat(FIRST_PARTY_FORBIDDEN_TEXT);
    for (const pattern of patterns) {
      if (pattern.test(text)) throw new Error(`forbidden release marker ${pattern} in ${entry.archivePath}`);
    }
  }
}

module.exports = {
  assignArchivePaths,
  assertReleaseInventory,
  collectPackageEntries,
  createPackageManifest,
  productionPackageRoots,
  sha256,
};
