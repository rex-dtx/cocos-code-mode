'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoots = [];

afterEach(() => {
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryDirectory(prefix) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(directory);
    return directory;
}

function loadLinker() {
    try {
        return require('../../scripts/link-project-extension');
    } catch (error) {
        assert.fail(`Project extension linker must exist: ${error instanceof Error ? error.message : String(error)}`);
    }
}

describe('linkProjectExtension', () => {
    it('links the 2.x extension under a Creator 2.4 project packages directory', () => {
        const { linkProjectExtension } = loadLinker();
        const project = temporaryDirectory('ccb2x-project-');
        const source = temporaryDirectory('ccb2x-source-');

        const result = linkProjectExtension({ projectPath: project, sourcePath: source });

        assert.equal(result.status, 'linked');
        assert.equal(
            fs.realpathSync(result.destination),
            fs.realpathSync(source),
        );
        assert.equal(result.destination, path.join(project, 'packages', 'cc-bridge-2x'));
    });
});
