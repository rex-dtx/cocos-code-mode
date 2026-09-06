const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Stamps build provenance into dist/ (not source/) so the repo stays clean and
// tsc keeps working without this. main.ts reads it with a fallback.
// Point: a deployed dist/ that predates HEAD looks identical to a fresh one --
// this is what makes "the editor is running a stale build" visible.

const projectRoot = path.join(__dirname, '..');

function git(args, fallback) {
    try {
        return execSync(`git ${args}`, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
    } catch (e) {
        // No git, no repo, or git not on PATH -- a build is still valid without it.
        return fallback;
    }
}

const info = {
    commit: git('rev-parse --short HEAD', 'unknown'),
    branch: git('rev-parse --abbrev-ref HEAD', 'unknown'),
    // Release provenance covers every source/build input that can affect the
    // customer artifact, including new untracked files.
    dirty: git(
        'status --porcelain --untracked-files=all -- source scripts package.json package-lock.json tsconfig.json tsconfig.release.json base.tsconfig.json',
        ''
    ) !== '',
    builtAt: new Date().toISOString()
};

const distDir = path.join(projectRoot, 'dist');
if (process.argv.includes('--clean')) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

fs.writeFileSync(path.join(distDir, 'build-info.json'), JSON.stringify(info, null, 2));
console.log(`build-info: ${info.commit}${info.dirty ? '-dirty' : ''} (${info.branch})`);
