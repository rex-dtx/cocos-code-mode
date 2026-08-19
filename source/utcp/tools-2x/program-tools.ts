import { utcpTool } from '../decorators';

function isHttpUrl(s: string): boolean {
    try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export class ProgramTools2x {
    @utcpTool(
        'urlOpen',
        'Open a URL in the system default browser. Only http(s) allowed.',
        { type: 'object', properties: { url: { type: 'string', description: 'Absolute http(s) URL' } }, required: ['url'] },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST', ['url', 'browser', 'open', 'docs', 'link']
    )
    async urlOpen(args: { url: string }): Promise<any> {
        if (!args.url || !isHttpUrl(args.url)) throw new Error(`urlOpen requires absolute http(s) URL, got "${args.url}"`);
        const parsed = new URL(args.url);
        // Try editor message first (3.8 has program/open-url, 2.4 likely not)
        try {
            const ok = await new Promise<any>((resolve, reject) => {
                Editor.Ipc.sendToMain('program:open-url' as any, parsed.href, (err: any, res: any) => err ? reject(err) : resolve(res));
            });
            if (ok) return { success: true };
        } catch (e: any) {
            if (!/does not exist|not found/i.test(String(e?.message ?? e))) throw e;
        }
        const { execFile } = require('child_process');
        const [cmd, argv]: [string, string[]] = process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '', parsed.href]]
            : process.platform === 'darwin' ? ['open', [parsed.href]] : ['xdg-open', [parsed.href]];
        await new Promise<void>((resolve, reject) => execFile(cmd, argv, (err: any) => err ? reject(err) : resolve()));
        return { success: true };
    }

    @utcpTool(
        'programGetInfo',
        'Get info (path, args) of a program registered with the editor.',
        { type: 'object', properties: { programName: { type: 'string', description: 'Registered program name' } }, required: ['programName'] },
        { type: 'object', properties: { path: { type: 'string' }, commandArgument: { type: 'string' } }, required: ['path'] },
        'GET', ['program', 'external', 'info', 'path']
    )
    async programGetInfo(args: { programName: string }): Promise<any> {
        if (!args.programName) throw new Error('programGetInfo requires programName');
        return new Promise((resolve, reject) => {
            Editor.Ipc.sendToMain('program:query-program-info' as any, args.programName, (err: any, info: any) => {
                if (err) return reject(err);
                if (!info) return reject(new Error(`Program "${args.programName}" not registered`));
                resolve({ path: info.path, commandArgument: info.commandArgument || undefined });
            });
        });
    }

    @utcpTool(
        'programOpen',
        'Launch a program registered with the editor (external tool).',
        { type: 'object', properties: { programName: { type: 'string' }, commandArguments: { type: 'object', description: 'Optional named args defined by registration' } }, required: ['programName'] },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST', ['program', 'external', 'open', 'launch', 'run']
    )
    async programOpen(args: { programName: string, commandArguments?: Record<string, any> }): Promise<any> {
        if (!args.programName) throw new Error('programOpen requires programName');
        const tryMsg = (msg: string) => new Promise<any>((resolve, reject) => {
            Editor.Ipc.sendToMain(msg as any, args.programName, args.commandArguments, (err: any, res: any) => err ? reject(err) : resolve(res));
        });
        for (const msg of ['program:open-program', 'program:execute']) {
            try { const ok = await tryMsg(msg); if (ok !== false) return { success: true }; } catch (e: any) {
                if (!/does not exist/i.test(String(e?.message ?? e))) throw e;
            }
        }
        throw new Error(`Cannot open program "${args.programName}" — no supported message on 2.4`);
    }
}
