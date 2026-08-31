'use strict';

const { readFileSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');
const assert = require('assert').strict;

function configPath() {
    return process.env.UTCP_CONFIG_FILE || join(homedir(), '.utcp_config.json');
}

function readTemplates() {
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    return Array.isArray(config.manual_call_templates) ? config.manual_call_templates : [];
}

async function discoverBase() {
    const port = Number(process.argv[2]);
    if (port > 0) return `http://localhost:${port}`;

    const template = readTemplates().find((entry) => entry && entry.name === 'ccb2x');
    const match = String(template && template.url || '').match(/^http:\/\/localhost:(\d+)\/utcp\/?$/);
    if (!match) {
        throw new Error(`Cannot discover ccb2x URL from ${configPath()}. Open Creator 2.4 or pass a port.`);
    }
    return `http://localhost:${match[1]}`;
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
    const base = await discoverBase();
    console.log(`smoke: base=${base}\n`);

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

    if (!process.argv[2]) {
        try {
            const templates = readTemplates();
            const ccb2x = templates.filter((template) => template && template.name === 'ccb2x');
            assert.equal(ccb2x.length, 1, `expected exactly one ccb2x template, found ${ccb2x.length}`);
            assert.match(String(ccb2x[0].url), /^http:\/\/localhost:\d+\/utcp$/);
            pass('config has one current ccb2x template');
        } catch (error) {
            fail('ccb2x config', error instanceof Error ? error.message : String(error));
        }
    }

    console.log(`\nresult: ${passed} pass, ${failed} fail, ${skipped} skip`);
    if (failed > 0) process.exitCode = 1;
}

smoke().catch((error) => {
    console.error(`smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
