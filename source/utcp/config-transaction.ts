import { promises as fs, readFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';
import { z } from 'zod';

const registrySchema = z.object({
    manual_call_templates: z.array(z.object({ name: z.string(), url: z.string().optional() }).passthrough()).default([]),
    variables: z.record(z.string(), z.string()).optional(),
}).passthrough();
export type Registry = z.infer<typeof registrySchema>;

export function readRegistry(path: string): Registry {
    let text: string;
    try { text = readFileSync(path, 'utf8'); }
    catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { manual_call_templates: [] };
        throw error;
    }
    return registrySchema.parse(JSON.parse(text));
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// All CCB writers use the same lock. Never steal a lock based on elapsed time:
// a suspended but live editor can resume and overwrite a newer transaction.
export async function mutateRegistry(path: string, mutate: (config: Registry) => void): Promise<boolean> {
    await fs.mkdir(dirname(path), { recursive: true });
    const lock = `${path}.ccb-lock`;
    const deadline = Date.now() + 5000;
    for (;;) {
        try { await fs.mkdir(lock); break; }
        catch (error: unknown) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
            if (Date.now() >= deadline) throw new Error(`UTCP registry locked: ${lock}. Close registry writers before removing an abandoned lock.`);
            await delay(25);
        }
    }
    const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
        await fs.writeFile(`${lock}/owner.json`, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
        const config = readRegistry(path);
        const before = JSON.stringify(config);
        mutate(config);
        if (JSON.stringify(config) === before) return false;
        const file = await fs.open(temporary, 'wx');
        try { await file.writeFile(JSON.stringify(config, null, 2), 'utf8'); await file.sync(); }
        finally { await file.close(); }
        // Windows scanners may briefly hold a destination handle. Never unlink the
        // destination: readers must see either the previous or the next valid JSON.
        for (let attempt = 0;; attempt++) {
            try { await fs.rename(temporary, path); break; }
            catch (error: unknown) {
                if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code)) || attempt === 19) throw error;
                await delay(25);
            }
        }
        return true;
    } finally {
        try { await fs.rm(temporary, { force: true }); }
        finally { await fs.rm(lock, { recursive: true, force: true }); }
    }
}
