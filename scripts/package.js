const fs = require('fs');
const path = require('path');
// archiver v7 (function-form API). KHONG dung v8 nhu ban 3.x — v8 doi `node >= 18`,
// ban 2.x chot Node 14 cho Electron 13. v7 la ban moi nhat con ho tro Node 14.
const archiver = require('archiver');

// Read package.json to get the package name
const packageJsonPath = path.join(__dirname, '../package.json');
if (!fs.existsSync(packageJsonPath)) {
    console.error('package.json not found!');
    process.exit(1);
}

const packageJson = require(packageJsonPath);
const packageName = packageJson.name;
const zipFileName = `${packageName}.zip`;
const projectRoot = path.join(__dirname, '..');

// Derive zip version from build-info.json stamped at build time.
function resolveZipVersion() {
    const fallback = packageJson.version;
    try {
        const infoPath = path.join(projectRoot, 'dist', 'build-info.json');
        if (!fs.existsSync(infoPath)) return fallback;
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (!info.commit || info.commit === 'unknown') return fallback;
        const suffix = info.dirty ? '-dirty' : '';
        return `${fallback}-dev.${info.commit}${suffix}`;
    } catch {
        return fallback;
    }
}
const zipVersion = resolveZipVersion();
if (zipVersion !== packageJson.version) {
    console.log(`Patched zip version: ${packageJson.version} -> ${zipVersion}`);
}

// List of files/folders to include in the archive
const filesToInclude = [
    '@types',
    'dist',
    'i18n',
    'panel',
    'node_modules',
    'static',
    'package-lock.json',
    'package.json',
    'README.md'
];

const outputPath = path.join(projectRoot, zipFileName);

console.log(`Packaging project into ${zipFileName}...`);

const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
    const sizeMb = (archive.pointer() / 1024 / 1024).toFixed(1);
    console.log(`\nPackage created successfully: ${outputPath} (${sizeMb} MB)`);
});

archive.on('error', (err) => {
    console.error('Error creating package:', err.message);
    process.exit(1);
});

archive.pipe(output);

for (const item of filesToInclude) {
    if (item === 'package.json') {
        const patched = { ...packageJson, version: zipVersion };
        archive.append(JSON.stringify(patched, null, 2), { name: `${packageName}/package.json` });
        continue;
    }
    const itemPath = path.join(projectRoot, item);
    if (!fs.existsSync(itemPath)) {
        // Skip missing items; 'dist' missing is significant, warn loudly
        console.warn(`Warning: '${item}' not found, skipping${item === 'dist' ? ' (build output missing - run npm run build!)' : ''}`);
        continue;
    }
    if (fs.statSync(itemPath).isDirectory()) {
        archive.directory(itemPath, `${packageName}/${item}`);
    } else {
        archive.file(itemPath, { name: `${packageName}/${item}` });
    }
}

archive.finalize();
