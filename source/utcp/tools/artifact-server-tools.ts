import fs from 'fs';
import path from 'path';
import http from 'http';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';

type ArtifactServer = { server: http.Server; url: string };
const servers = new Map<string, ArtifactServer>();
export function closeArtifactServers(): void {
    for (const record of servers.values()) record.server.close();
    servers.clear();
}


function resolveArtifact(requested: string): string {
    const projectRoot = path.resolve((Editor.Project as any).path);
    if (!requested || path.isAbsolute(requested) || requested.includes('\0')) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'artifactPath must be a non-empty project-relative path.' });
    }
    const root = path.resolve(projectRoot, requested);
    const relative = path.relative(projectRoot, root);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'artifactPath must remain inside the project.' });
    }
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, 'index.html'))) {
        throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: 'Completed web artifact with index.html was not found.' });
    }
    const realRoot = fs.realpathSync(root);
    const realProjectRoot = fs.realpathSync(projectRoot);
    const realRelative = path.relative(realProjectRoot, realRoot);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'artifactPath must resolve inside the project.' });
    }
    return realRoot;
}

export class ArtifactServerTools {
    @utcpTool('buildArtifactServe', 'Serve one completed project-local web artifact with a bounded HTTP lifecycle.', {
        type: 'object', additionalProperties: false,
        properties: {
            artifactPath: { type: 'string', minLength: 1, maxLength: 512 },
            operation: { type: 'string', enum: ['start', 'stop'] },
            serverId: { type: 'string', minLength: 1, maxLength: 64 },
        }, required: ['operation'],
    }, {
        type: 'object', properties: {
            operation: { type: 'string' }, serverId: { type: 'string' }, url: { type: 'string' },
            lifecycle: { type: 'array' }, verified: { type: 'boolean' },
        }, required: ['operation', 'serverId', 'lifecycle', 'verified'],
    }, 'POST', ['build', 'artifact', 'serve', 'web', 'lifecycle'])
    async buildArtifactServe(args: { artifactPath?: string, operation: 'start' | 'stop', serverId?: string }): Promise<Record<string, unknown>> {
        if (args.operation === 'stop') {
            const serverId = args.serverId;
            const record = serverId ? servers.get(serverId) : undefined;
            if (!serverId || !record) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: 'Artifact server was not found.' });
            await new Promise<void>((resolve, reject) => record.server.close((error) => error ? reject(error) : resolve()));
            servers.delete(serverId);
            return { operation: 'stop', serverId, lifecycle: ['stopped'], verified: true };
        }
        if (!args.artifactPath) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'artifactPath is required when starting an artifact server.' });
        const root = resolveArtifact(args.artifactPath);
        const serverId = `artifact-${Date.now().toString(36)}`;
        const server = http.createServer((request, response) => {
            let relative: string;
            try { relative = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'; }
            catch { response.writeHead(400); response.end(); return; }
            let file: string;
            try { file = fs.realpathSync(path.resolve(root, relative)); }
            catch { response.writeHead(404); response.end(); return; }
            if (path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file))) { response.writeHead(403); response.end(); return; }
            fs.stat(file, (error, stat) => {
                if (error || !stat.isFile()) { response.writeHead(404); response.end(); return; }
                fs.createReadStream(file).pipe(response);
            });
        });
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        if (!port) { server.close(); throw new ToolError({ code: 'SERVE_FAILED', status: 502, message: 'Artifact server did not expose a local port.' }); }
        let verified = false;
        try {
            verified = await new Promise<boolean>((resolve) => {
                const request = http.get(`http://127.0.0.1:${port}/`, (response) => {
                    response.resume();
                    resolve((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300);
                });
                request.once('error', () => resolve(false));
            });
        } catch {
            verified = false;
        }
        if (!verified) { await new Promise<void>((resolve) => server.close(() => resolve())); throw new ToolError({ code: 'SERVE_FAILED', status: 502, message: 'Artifact index verification failed.' }); }
        const url = `http://127.0.0.1:${port}/`;
        servers.set(serverId, { server, url });
        return { operation: 'start', serverId, url, lifecycle: ['started', 'verified'], verified: true };
    }

    @utcpTool('buildTargetLaunch', 'Launch one completed project-local web artifact on a verified bounded browser target.', {
        type: 'object', additionalProperties: false,
        properties: {
            artifactPath: { type: 'string', minLength: 1, maxLength: 512 },
            target: { type: 'string', enum: ['web-browser', 'native-desktop'] },
        }, required: ['artifactPath', 'target'],
    }, {
        type: 'object', properties: {
            target: { type: 'string' }, serverId: { type: 'string' }, url: { type: 'string' },
            lifecycle: { type: 'array' }, verified: { type: 'boolean' },
        }, required: ['target', 'serverId', 'url', 'lifecycle', 'verified'],
    }, 'POST', ['build', 'target', 'launch', 'web', 'browser'])
    async buildTargetLaunch(args: { artifactPath: string, target: 'web-browser' | 'native-desktop' }): Promise<Record<string, unknown>> {
        if (args.target !== 'web-browser') {
            throw new ToolError({
                code: 'UNSUPPORTED_TARGET',
                status: 422,
                message: `Build target ${args.target} has no verified launcher on this environment.`,
                recovery: 'Use target=web-browser or qualify a target-specific launcher first.',
            });
        }
        const launched = await this.buildArtifactServe({ operation: 'start', artifactPath: args.artifactPath });
        return { target: args.target, ...launched };
    }

    @utcpTool('buildTargetSmoke', 'Fetch and verify the launched project-local web artifact through its active target session.', {
        type: 'object', additionalProperties: false,
        properties: {
            serverId: { type: 'string', minLength: 1, maxLength: 64 },
            expectedText: { type: 'string', minLength: 1, maxLength: 256 },
        }, required: ['serverId'],
    }, {
        type: 'object', properties: {
            serverId: { type: 'string' }, url: { type: 'string' }, statusCode: { type: 'integer' },
            bytes: { type: 'integer' }, contentMatched: { type: 'boolean' }, passed: { type: 'boolean' },
        }, required: ['serverId', 'url', 'statusCode', 'bytes', 'contentMatched', 'passed'],
    }, 'POST', ['build', 'target', 'smoke', 'web', 'browser'])
    async buildTargetSmoke(args: { serverId: string, expectedText?: string }): Promise<Record<string, unknown>> {
        const record = servers.get(args.serverId);
        if (!record) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: 'Launched build target was not found.' });
        const result = await new Promise<{ statusCode: number, body: string }>((resolve, reject) => {
            const request = http.get(record.url, (response) => {
                const chunks: Buffer[] = [];
                let bytes = 0;
                response.on('data', (chunk: Buffer) => {
                    bytes += chunk.length;
                    if (bytes <= 1024 * 1024) chunks.push(chunk);
                });
                response.on('end', () => resolve({ statusCode: response.statusCode ?? 500, body: Buffer.concat(chunks).toString('utf8') }));
            });
            request.setTimeout(5000, () => request.destroy(new Error('Build target smoke request timed out.')));
            request.once('error', reject);
        });
        const contentMatched = args.expectedText === undefined || result.body.includes(args.expectedText);
        const passed = result.statusCode >= 200 && result.statusCode < 300 && contentMatched;
        return { serverId: args.serverId, url: record.url, statusCode: result.statusCode, bytes: Buffer.byteLength(result.body, 'utf8'), contentMatched, passed };
    }
}
