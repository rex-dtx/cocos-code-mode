import fs from 'fs';
import path from 'path';
import http from 'http';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';

const servers = new Map<string, http.Server>();

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
            if (!serverId || !servers.has(serverId)) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: 'Artifact server was not found.' });
            await new Promise<void>((resolve, reject) => servers.get(serverId)!.close((error) => error ? reject(error) : resolve()));
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
        servers.set(serverId, server);
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        if (!port) throw new ToolError({ code: 'SERVE_FAILED', status: 502, message: 'Artifact server did not expose a local port.' });
        const verified = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.ok);
        if (!verified) { await new Promise<void>((resolve) => server.close(() => resolve())); servers.delete(serverId); throw new ToolError({ code: 'SERVE_FAILED', status: 502, message: 'Artifact index verification failed.' }); }
        return { operation: 'start', serverId, url: `http://127.0.0.1:${port}/`, lifecycle: ['started', 'verified'], verified: true };
    }
}
