import { utcpTool } from '../decorators';
import { SuccessIndicatorSchema, ISuccessIndicator } from '../schemas';

export class ProgramTools {

    @utcpTool(
        'programGetInfo',
        'Get info about a program registered with the editor (path and default command arguments). Programs are registered by editor extensions, not arbitrary executables.',
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
        'Launch a program registered with the editor (e.g. an external tool configured by an extension). Only registered programs can be opened - not arbitrary executables.',
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
        const ok = await Editor.Message.request('program', 'open-program', args.programName, args.commandArguments);
        if (!ok) {
            throw new Error(`Failed to open program "${args.programName}"`);
        }
        return { success: true };
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
        const ok = await Editor.Message.request('program', 'open-url', args.url);
        if (!ok) {
            throw new Error(`Failed to open url "${args.url}"`);
        }
        return { success: true };
    }
}
