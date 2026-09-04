import { ISuccessIndicator } from '../schemas';
import { isMessageNotExposed } from '../utils/editor-message-error';

export class ProgramTools {

    // via programManage — kept for delegation
    async programGetInfo(args: { programName: string }): Promise<{ path: string, commandArgument?: string }> {
        if (!args.programName) throw new Error('programGetInfo requires programName');
        const info = await Editor.Message.request('program', 'query-program-info', args.programName);
        if (!info) throw new Error(`Program "${args.programName}" is not registered with the editor`);
        return { path: info.path, commandArgument: info.commandArgument || undefined };
    }

    // via programManage — kept for delegation
    async programOpen(args: { programName: string, commandArguments?: Record<string, any> }): Promise<ISuccessIndicator> {
        if (!args.programName) throw new Error('programOpen requires programName');
        const ok = await this.requestFirst([ ['open-program',[args.programName,args.commandArguments]], ['execute',[args.programName,args.commandArguments]] ], `open program "${args.programName}"`);
        if (!ok) throw new Error(`Failed to open program "${args.programName}"`);
        return { success: true };
    }

    private async requestFirst(candidates: [string, any[]][], what: string): Promise<any> {
        const errors: string[] = [];
        for (const [message, params] of candidates) {
            try { return await Editor.Message.request('program', message as any, ...params); } catch(e:any){ if(!isMessageNotExposed(e, 'program', message)) throw e; errors.push(`${message}: ${String(e?.message ?? e)}`); }
        }
        throw new Error(`Cannot ${what} - no supported message on this editor version (${errors.join('; ')})`);
    }

    // via programManage — kept for delegation
    async urlOpen(args: { url: string }): Promise<ISuccessIndicator> {
        if (!args.url) throw new Error('urlOpen requires url');
        let parsed: URL; try{ parsed=new URL(args.url);} catch{ throw new Error(`urlOpen requires an absolute URL, got "${args.url}"`); }
        if (parsed.protocol!=='http:'&&parsed.protocol!=='https:') throw new Error(`urlOpen only opens http(s) URLs, got "${parsed.protocol}"`);
        try{ const ok=await Editor.Message.request('program','open-url' as any, parsed.href); if(ok) return {success:true}; }catch(e:any){ if(!isMessageNotExposed(e, 'program', 'open-url')) throw e; }
        const { execFile } = require('child_process');
        const [command, argv]: [string,string[]] = process.platform==='win32'?['cmd',['/c','start','',parsed.href]]:process.platform==='darwin'?['open',[parsed.href]]:['xdg-open',[parsed.href]];
        await new Promise<void>((resolve,reject)=> execFile(command,argv,(err:any)=> err?reject(err):resolve()));
        return { success: true };
    }
}
