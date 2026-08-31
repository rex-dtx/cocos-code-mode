export class ProjectTools {

    // via projectManage — kept for delegation
    async projectGetConfig(args: { type?: string, key?: string, limit?: number }): Promise<{ config: any, total?: number, truncated?: boolean }> {
        const all = await Editor.Message.request('project', 'query-config', 'project');
        if (all===undefined||all===null) throw new Error('Failed to read project settings');
        if (!args.type) {
            const entries = Object.entries(all);
            const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
            return { config: Object.fromEntries(entries.slice(0, limit)), total: entries.length, truncated: entries.length > limit };
        }
        const category=(all as any)[args.type];
        if(category===undefined) throw new Error(`Unknown project settings type "${args.type}". Available: ${Object.keys(all as any).join(', ')}`);
        if(!args.key) return {config:category};
        const value=category[args.key];
        if(value===undefined){ const keys=(category&&typeof category==='object')?Object.keys(category).join(', '):''; throw new Error(`Unknown key "${args.key}" in project settings type "${args.type}". Available: ${keys}`); }
        return { config: value };
    }

    // via projectManage — kept for delegation
    async projectSetConfig(args: { path: string, value: any }): Promise<{ success: boolean }> {
        if (!args.path) throw new Error('projectSetConfig requires path');
        try{
            const ok=await Editor.Message.request('project','set-config','project',args.path,args.value);
            if(ok===false) throw new Error(`Failed to set project config at "${args.path}"`);
        }catch(e:any){
            if(/does not exist/i.test(String(e?.message??e))) throw new Error(`projectSetConfig is not supported on this editor version - 'project/set-config' does not exist (added in 3.8.x). Reading via projectGetConfig still works; edit settings/v2/packages/*.json directly to change them.`);
            throw e;
        }
        return { success: true };
    }
}
