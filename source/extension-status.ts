import { get } from 'http';
import { getBuildInfo } from './build-info';
import { readRegistry } from './utcp/config-transaction';

interface ServerIdentity { port: number; instanceId: string; debug: boolean; scene?: 'enabled' | 'disabled' | 'unavailable' | 'error' | 'unknown'; logDirectory?: string | null; logFile?: string | null }
interface StatusHandshake {
    instanceId: string;
    projectPath: string | null;
    probe: { status: string; sceneReady: boolean | null; code: string | null };
}
function isHandshake(value: unknown): value is StatusHandshake {
    if (!value || typeof value !== 'object' || !('instanceId' in value) || typeof value.instanceId !== 'string'
        || !('projectPath' in value) || (value.projectPath !== null && typeof value.projectPath !== 'string')
        || !('probe' in value) || !value.probe || typeof value.probe !== 'object') return false;
    const probe = value.probe;
    return 'status' in probe && typeof probe.status === 'string' && ['responsive', 'timeout', 'error', 'invalid-response'].includes(probe.status)
        && 'sceneReady' in probe && (probe.sceneReady === null || typeof probe.sceneReady === 'boolean')
        && 'code' in probe && (probe.code === null || typeof probe.code === 'string');
}

async function probeHttp(port: number): Promise<StatusHandshake> {
    // Creator 3.7 does not support Promise.withResolvers or global fetch.
    return new Promise((resolve, reject) => {
        const request = get(`http://127.0.0.1:${port}/tools/editorHandshake?timeoutMs=1000`, response => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            if (response.statusCode !== 200) {
                response.resume();
                request.destroy(new Error(`Handshake HTTP ${response.statusCode}`));
                return;
            }
            response.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 65536) request.destroy(new Error('Handshake response exceeds 64 KiB.'));
                else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
                try {
                    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    const payload = raw && typeof raw === 'object' && 'ok' in raw && raw.ok === true
                        && 'tool' in raw && raw.tool === 'editorHandshake' && 'data' in raw ? raw.data : raw;
                    if (!isHandshake(payload)) throw new Error('Invalid handshake response.');
                    resolve(payload);
                } catch (error) { reject(error); }
            });
        });
        const timer = setTimeout(() => request.destroy(new Error('Handshake HTTP deadline exceeded (2000ms).')), 2000);
        request.on('error', reject);
        request.on('close', () => clearTimeout(timer));
    });
}

export async function inspectExtensionStatus(server: ServerIdentity | null, registryPath: string) {
    const projectPath = typeof Editor.Project?.path === 'string' ? Editor.Project.path : null;
    const running = Boolean(server && server.port > 0);
    const result = {
        checkedAt: Date.now(), build: getBuildInfo(), projectPath,
        editorVersion: typeof Editor.App?.version === 'string' ? Editor.App.version : null,
        server: {
            running,
            port: running ? server!.port : 0,
            instanceId: running ? server!.instanceId : null,
            namespace: running ? `ccp3x_${server!.port}` : null,
            url: running ? `http://localhost:${server!.port}/utcp` : null,
            debug: server?.debug ?? false,
            logging: {
                server: server?.debug ?? false,
                scene: server?.scene ?? 'unknown',
                logDirectory: server?.logDirectory ?? null,
                logFile: server?.logFile ?? null,
            },
        },
        registry: { path: registryPath, status: 'not-running', detail: null as string | null },
        http: { status: 'not-running', detail: null as string | null },
        probe: null as StatusHandshake['probe'] | null,
    };
    if (!running || !server) return result;
    try {
        const config = readRegistry(registryPath);
        const entry = config.manual_call_templates.find(t => t.name === result.server.namespace);
        const owns = config.variables?.[`CCP3X_OWNER_${server.port}`] === server.instanceId;
        let endpointMatches = false;
        if (entry?.url) {
            const url = new URL(entry.url);
            endpointMatches = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
                && Number(url.port) === server.port && url.pathname === '/utcp' && !url.search && !url.hash && !url.username && !url.password;
        }
        result.registry.status = !entry ? 'missing' : owns && endpointMatches ? 'matched' : 'mismatch';
        if (result.registry.status !== 'matched') result.registry.detail = 'Registry endpoint or instance ownership does not match this server.';
    } catch (error) {
        result.registry.status = 'error';
        result.registry.detail = error instanceof Error ? error.message : String(error);
    }
    try {
        const handshake = await probeHttp(server.port);
        if (handshake.instanceId !== server.instanceId || handshake.projectPath !== projectPath) throw new Error('Handshake identity does not match this editor instance/project.');
        result.http.status = 'ok';
        result.probe = handshake.probe;
    } catch (error) {
        result.http.status = 'error';
        result.http.detail = error instanceof Error ? error.message : String(error);
    }
    result.checkedAt = Date.now();
    return result;
}
