import { utcpTool } from '../decorators';
import { SuccessIndicatorSchema, ISuccessIndicator } from '../schemas';

export class ProgramTools {

    @utcpTool(
        'programGetInfo',
        'Get info (path, args) of a program registered with the editor.',
        {
            type: 'object',
            properties: {
                programName: { type: 'string', description: 'Registered program name' }
            },
            required: ['programName']
        },
        {
            type: 'object',
            properties: {
                path: { type: 'string' },
                commandArgument: { type: 'string' }
            },
            required: ['path']
        }, "GET", ['program', 'external', 'info', 'path']
    )
    async programGetInfo(args: { programName: string }): Promise<{ path: string, commandArgument?: string }> {
        if (!args.programName) {
            throw new Error('programGetInfo requires programName');
        }
        const info = await Editor.Message.request('program', 'query-program-info', args.programName);
        if (!info) {
            throw new Error(`Program "${args.programName}" is not registered with the editor`);
        }
        return { path: info.path, commandArgument: info.commandArgument || undefined };
    }

    @utcpTool(
        'programOpen',
        'Launch a program registered with the editor (external tool). Registered programs only.',
        {
            type: 'object',
            properties: {
                programName: { type: 'string', description: 'Registered program name' },
                commandArguments: { type: 'object', description: 'Optional named command arguments (keys defined by the program registration)' }
            },
            required: ['programName']
        },
        SuccessIndicatorSchema, "POST", ['program', 'external', 'open', 'launch', 'run', 'tool']
    )
    async programOpen(args: { programName: string, commandArguments?: Record<string, any> }): Promise<ISuccessIndicator> {
        if (!args.programName) {
            throw new Error('programOpen requires programName');
        }
        // 3.8.x calls this 'open-program'; 3.7.3 has no such message and instead
        // exposes 'execute', whose i18n doc block gives the same two parameters
        // ("program {string}", "args {Record<string, any>}"). Verified against 3.7.3:
        // open-program fails with "Message does not exist: program - open-program".
        const ok = await this.requestFirst(
            [
                ['open-program', [args.programName, args.commandArguments]],
                ['execute', [args.programName, args.commandArguments]]
            ],
            `open program "${args.programName}"`
        );
        if (!ok) {
            throw new Error(`Failed to open program "${args.programName}"`);
        }
        return { success: true };
    }

    // Try each message in turn, skipping the ones this editor version does not have.
    // Only a missing-message error is swallowed: anything else means the message
    // exists and genuinely failed, which the caller needs to see.
    private async requestFirst(candidates: [string, any[]][], what: string): Promise<any> {
        const errors: string[] = [];
        for (const [message, params] of candidates) {
            try {
                return await Editor.Message.request('program', message as any, ...params);
            } catch (e: any) {
                const text = String(e?.message ?? e);
                if (!/does not exist/i.test(text)) {
                    throw e;
                }
                errors.push(`${message}: ${text}`);
            }
        }
        throw new Error(`Cannot ${what} - no supported message on this editor version (${errors.join('; ')})`);
    }

    @utcpTool(
        'urlOpen',
        'Open a URL in the system default browser.',
        {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to open' }
            },
            required: ['url']
        },
        SuccessIndicatorSchema, "POST", ['url', 'browser', 'open', 'docs', 'link']
    )
    async urlOpen(args: { url: string }): Promise<ISuccessIndicator> {
        if (!args.url) {
            throw new Error('urlOpen requires url');
        }
        // Only http(s) reaches the shell. The URL becomes a command argument below,
        // so schemes like file: or a crafted string must not get through.
        let parsed: URL;
        try {
            parsed = new URL(args.url);
        } catch {
            throw new Error(`urlOpen requires an absolute URL, got "${args.url}"`);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`urlOpen only opens http(s) URLs, got "${parsed.protocol}"`);
        }

        // 3.8.x has program/open-url; 3.7.3 does not (verified: "Message does not
        // exist: program - open-url"). Fall back to the platform opener.
        try {
            const ok = await Editor.Message.request('program', 'open-url' as any, parsed.href);
            if (ok) {
                return { success: true };
            }
        } catch (e: any) {
            if (!/does not exist/i.test(String(e?.message ?? e))) {
                throw e;
            }
        }

        const { execFile } = require('child_process');
        // execFile, not exec: no shell, so the URL cannot be interpreted as a command.
        const [command, argv] = process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '', parsed.href]]
            : process.platform === 'darwin'
                ? ['open', [parsed.href]]
                : ['xdg-open', [parsed.href]];

        await new Promise<void>((resolve, reject) => {
            execFile(command, argv, (err: any) => err ? reject(err) : resolve());
        });
        return { success: true };
    }
}
