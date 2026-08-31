'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function runSmoke(port) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/smoke-utcp.js', String(port)], {
            cwd: path.resolve(__dirname, '..', '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('error', reject);
        child.on('exit', (code) => resolve({ code, output }));
    });
}

describe('UTCP smoke script', () => {
    it('passes against a strict manual and editor environment response', async () => {
        const server = http.createServer((request, response) => {
            const payload = request.url === '/utcp'
                ? { utcp_version: '1.0.1', manual_version: '1.0.0', tools: [{ name: 'editorEnvInfo', tool_call_template: {} }] }
                : request.url === '/build-info'
                    ? { commit: 'abc123', branch: 'cc-2x' }
                    : request.url === '/tools/editorEnvInfo'
                        ? { editorVersion: '2.4.15', projectPath: 'C:/project' }
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
    });
});
