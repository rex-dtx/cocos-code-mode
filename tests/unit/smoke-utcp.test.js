'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const projectPath = path.resolve('sample-smoke-project');

const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function runSmoke(port, { project = projectPath, registryProject = projectPath, register = true } = {}) {
    return new Promise((resolve, reject) => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp2x-smoke-'));
        const configPath = path.join(directory, 'registry.json');
        fs.writeFileSync(configPath, JSON.stringify({
            manual_call_templates: register ? [{ name: `ccp2x_${port}`, url: `http://localhost:${port}/utcp` }] : [],
            variables: { [`CCP2X_OWNER_${port}`]: 'owner', [`CCP2X_PROJECT_${port}`]: registryProject },
        }));
        const child = spawn(process.execPath, ['scripts/smoke-utcp.js', String(port)], {
            cwd: path.resolve(__dirname, '..', '..'),
            env: { ...process.env, UTCP_CONFIG_FILE: configPath, CCP2X_PROJECT: project ?? '' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('error', reject);
        child.on('exit', (code) => {
            fs.rmSync(directory, { recursive: true, force: true });
            resolve({ code, output });
        });
    });
}
describe('UTCP smoke script', () => {
    it('passes against a strict manual and editor environment response', async () => {
        const server = http.createServer((request, response) => {
            const payload = request.url === '/utcp'
                ? { utcp_version: '1.0.1', manual_version: '1.0.0', tools: [{ name: 'editorEnvInfo', tool_call_template: {} }] }
                : request.url === '/build-info'
                    ? { commit: execSync('git rev-parse --short HEAD', { cwd: path.resolve(__dirname, '..', '..') }).toString().trim(), branch: 'cc-2x' }
                    : request.url === '/tools/editorEnvInfo'
                        ? { editorVersion: '2.4.15', projectPath }
                        : request.url?.startsWith('/tools/editorHandshake?')
                            ? { instanceId: 'instance', projectMatches: true, probe: { status: 'responsive' } }
                            : null;
            response.writeHead(payload ? 200 : 404, { 'content-type': 'application/json' });
            response.end(JSON.stringify(payload));
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

        const { port } = server.address();
        const result = await runSmoke(port);

        assert.equal(result.code, 0, result.output);
        assert.match(result.output, /PASS manual valid/);
        assert.match(result.output, /PASS editorEnvInfo/);
        assert.match(result.output, /PASS editorHandshake instance/);
    });

    it('fails when /build-info commit does not match git HEAD', async () => {
        const server = http.createServer((request, response) => {
            const payload = request.url === '/utcp'
                ? { utcp_version: '1.0.1', manual_version: '1.0.0', tools: [{ name: 'editorEnvInfo', tool_call_template: {} }] }
                : request.url === '/build-info'
                    ? { commit: 'abc123', branch: 'cc-2x' }
                    : request.url === '/tools/editorEnvInfo'
                        ? { editorVersion: '2.4.15', projectPath }
                        : request.url?.startsWith('/tools/editorHandshake?')
                            ? { instanceId: 'instance', projectMatches: true, probe: { status: 'responsive' } }
                            : null;
            response.writeHead(payload ? 200 : 404, { 'content-type': 'application/json' });
            response.end(JSON.stringify(payload));
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const result = await runSmoke(port);
        assert.notEqual(result.code, 0, result.output);
        assert.match(result.output, /FAIL build-info stale/);
    });
    it('rejects missing, unowned, or wrong-project bindings before contacting the editor', async () => {
        for (const options of [{ project: null }, { register: false }, { registryProject: path.resolve('other-project') }]) {
            const result = await runSmoke(43112, options);
            assert.notEqual(result.code, 0, result.output);
            assert.match(result.output, /CCP2X_PROJECT/);
        }
    });

    it('rejects a handshake that does not confirm the selected project', async () => {
        const server = http.createServer((request, response) => {
            const payload = request.url === '/utcp'
                ? { utcp_version: '1.0.1', manual_version: '1.0.0', tools: [{ name: 'editorEnvInfo', tool_call_template: {} }] }
                : request.url === '/build-info'
                    ? { commit: execSync('git rev-parse --short HEAD', { cwd: path.resolve(__dirname, '..', '..') }).toString().trim(), branch: 'cc-2x' }
                    : request.url === '/tools/editorEnvInfo' ? { editorVersion: '2.4.15' }
                        : request.url?.startsWith('/tools/editorHandshake?') ? { instanceId: 'other', projectMatches: false, probe: { status: 'responsive' } } : null;
            response.writeHead(payload ? 200 : 404, { 'content-type': 'application/json' });
            response.end(JSON.stringify(payload));
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const result = await runSmoke(server.address().port);
        assert.notEqual(result.code, 0, result.output);
        assert.match(result.output, /editorHandshake did not confirm the intended project/);
    });
});
