'use strict';

const { readFileSync } = require('fs');
const { homedir } = require('os');
const { join, isAbsolute, normalize } = require('path');
const assert = require('assert').strict;

function configPath() {
    return process.env.UTCP_CONFIG_FILE || join(homedir(), '.utcp_config.json');
}

function readRegistry() {
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    return { templates: Array.isArray(config.manual_call_templates) ? config.manual_call_templates : [], variables: config.variables || {} };
}

function discoverBase() {
    const expectedProjectPath = process.env.CCP2X_PROJECT;
    if (!expectedProjectPath || !isAbsolute(expectedProjectPath)) throw new Error('Set CCP2X_PROJECT to the intended absolute Creator project path.');
    const { templates, variables } = readRegistry();
    const port = process.argv[2];
    if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error('Port must be a valid ccp2x_<port> registry port.');
    const normalizedProject = normalize(expectedProjectPath).replace(/[\\/]+$/, '');
    const sameProject = value => typeof value === 'string' && (process.platform === 'win32'
        ? normalize(value).replace(/[\\/]+$/, '').toLowerCase() === normalizedProject.toLowerCase()
        : normalize(value).replace(/[\\/]+$/, '') === normalizedProject);
    const owned = templates.filter(entry => {
        const match = /^ccp2x_(\d+)$/.exec(entry?.name || '');
        return match && entry.url === `http://localhost:${match[1]}/utcp`
            && variables[`CCP2X_OWNER_${match[1]}`]
            && sameProject(variables[`CCP2X_PROJECT_${match[1]}`])
            && (!port || match[1] === port);
    });
    if (owned.length !== 1) throw new Error(`Expected one owned ccp2x_<port> entry bound to CCP2X_PROJECT; found ${owned.length}. Select the exact port and project.`);
    return owned[0].url.replace(/\/utcp$/, '');
}

async function getJson(url) {
    const response = await fetch(url);
    const text = await response.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    return { ok: response.ok, status: response.status, body };
}

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(message) {
    passed += 1;
    console.log(`  PASS ${message}`);
}

function fail(message, error) {
    failed += 1;
    console.error(`  FAIL ${message}: ${error}`);
}

function skip(message, reason) {
    skipped += 1;
    console.log(`  SKIP ${message} (${reason})`);
}

async function smoke() {
    const base = discoverBase();
    console.log(`smoke: base=${base}\n`);
    const expectedProjectPath = process.env.CCP2X_PROJECT;
    const handshake = await getJson(`${base}/tools/editorHandshake?expectedProjectPath=${encodeURIComponent(expectedProjectPath)}&timeoutMs=1000`);
    if (!handshake.ok || handshake.body?.projectMatches !== true || handshake.body?.probe?.status !== 'responsive') {
        throw new Error('editorHandshake did not confirm the intended project.');
    }
    pass(`editorHandshake ${handshake.body.instanceId} (owned ccp2x_${new URL(base).port})`);

    try {
        const { ok, status, body } = await getJson(`${base}/utcp`);
        assert.equal(ok, true, `GET /utcp -> ${status}`);
        assert.deepEqual(Object.keys(body).sort(), ['manual_version', 'tools', 'utcp_version']);
        assert.ok(Array.isArray(body.tools) && body.tools.length > 0, 'manual contains tools');
        assert.ok(body.tools.every((tool) => !Object.prototype.hasOwnProperty.call(tool, 'annotations')), 'manual tools contain no unsupported annotations');
        pass(`manual valid: ${body.tools.length} tools`);
    } catch (error) {
        fail('manual', error instanceof Error ? error.message : String(error));
    }

    try {
        const { ok, body } = await getJson(`${base}/build-info`);
        assert.equal(ok, true, 'GET /build-info ok');
        assert.ok(body && body.commit && body.branch, 'build-info has commit and branch');
        pass(`build-info ${body.commit}${body.dirty ? '-dirty' : ''} on ${body.branch}`);
        const head = (() => {
            try {
                return require('child_process').execSync('git rev-parse --short HEAD', { cwd: join(__dirname, '..') }).toString().trim();
            } catch {
                return null;
            }
        })();
        if (head && body.commit && body.commit !== head) {
            fail('build-info stale', `editor serves ${body.commit}${body.dirty ? '-dirty' : ''} but HEAD is ${head} — rebuild + restart editor`);
        } else if (head) {
            pass(`build-info matches HEAD ${head}`);
        }
    } catch (error) {
        skip('build-info', error instanceof Error ? error.message : String(error));
    }

    try {
        const { ok, body } = await getJson(`${base}/tools/editorEnvInfo`);
        assert.equal(ok, true, 'GET editorEnvInfo ok');
        assert.ok(body && Object.prototype.hasOwnProperty.call(body, 'editorVersion'), 'editor environment has editorVersion');
        pass('editorEnvInfo');
    } catch (error) {
        fail('editorEnvInfo', error instanceof Error ? error.message : String(error));
    }

    console.log(`\nresult: ${passed} pass, ${failed} fail, ${skipped} skip`);
    if (failed > 0) process.exitCode = 1;
}

smoke().catch((error) => {
    console.error(`smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
