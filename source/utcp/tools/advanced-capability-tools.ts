import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';
import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { ToolError } from '../tool-error';
import { AssetTools } from './asset-tools';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[A-Za-z0-9_-]+)?/gi;
const SERIALIZED_LIMIT = 5 * 1024 * 1024;
const MAX_ITEMS = 128;

type AssetRow = { uuid: string, url: string, type?: string, importer?: string, file?: string, isDirectory?: boolean };

function invalid(message: string): never { throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message }); }
function bounded(value: unknown, fallback: number, maximum = MAX_ITEMS): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) invalid(`Expected an integer from 1 to ${maximum}.`);
    return value as number;
}
function baseUuid(value: string): string { return value.split('@', 1)[0].toLowerCase(); }
function refs(content: string): string[] { return [...new Set([...content.matchAll(UUID_RE)].map((match) => baseUuid(match[0])))].sort(); }
function sha256(content: string | Buffer): string { return createHash('sha256').update(content).digest('hex'); }
function nodeName(node: any): string { return typeof node?.name === 'string' ? node.name : node?.name?.value ?? node?.uuid ?? ''; }
function componentType(component: any): string { return component?.type ?? component?.value?.__type__?.value ?? component?.value?.__type__ ?? component?.cid ?? ''; }
function propertyValue(value: any): any { return value && typeof value === 'object' && 'value' in value ? value.value : value; }
function flattenValues(value: unknown, output: string[] = []): string[] {
    if (typeof value === 'string') { for (const id of value.match(UUID_RE) ?? []) output.push(baseUuid(id)); return output; }
    if (Array.isArray(value)) { for (const item of value) flattenValues(item, output); return output; }
    if (value && typeof value === 'object') { for (const item of Object.values(value)) flattenValues(item, output); }
    return output;
}

async function queryAssets(): Promise<AssetRow[]> {
    const rows = await Editor.Message.request('asset-db', 'query-assets', { pattern: 'db://assets/**' }) as unknown;
    return Array.isArray(rows) ? rows.filter((row): row is AssetRow => !!row && typeof row === 'object' && typeof (row as any).uuid === 'string' && typeof (row as any).url === 'string' && !(row as any).isDirectory) : [];
}
async function resolveAsset(reference?: IInstanceReference, assetPath?: string): Promise<AssetRow> {
    const identifier = reference?.id ?? assetPath;
    if (!identifier) invalid('A reference or assetPath is required.');
    const info = await Editor.Message.request('asset-db', 'query-asset-info', identifier) as AssetRow | null;
    if (!info?.uuid || !info.url) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Asset not found: ${identifier}` });
    const file = info.file ?? await Editor.Message.request('asset-db', 'query-path', info.uuid).catch(() => undefined) as string | undefined;
    return { ...info, file };
}
async function readAsset(row: AssetRow): Promise<{ content: string, hash: string }> {
    if (!row.file) throw new ToolError({ code: 'SOURCE_UNAVAILABLE', status: 422, message: `Asset source is unavailable: ${row.url}` });
    const stat = await fs.stat(row.file).catch(() => null);
    if (!stat?.isFile()) throw new ToolError({ code: 'SOURCE_UNAVAILABLE', status: 422, message: `Asset source is unavailable: ${row.url}` });
    if (stat.size > SERIALIZED_LIMIT) throw new ToolError({ code: 'SOURCE_TOO_LARGE', status: 413, message: `Asset source exceeds ${SERIALIZED_LIMIT} bytes: ${row.url}` });
    const content = await fs.readFile(row.file, 'utf8');
    return { content, hash: sha256(content) };
}
async function sceneTree(): Promise<any> {
    const tree = await Editor.Message.request('scene', 'query-node-tree');
    if (!tree) throw new ToolError({ code: 'NOT_FOUND', status: 404, message: 'No open scene or prefab hierarchy.' });
    return tree;
}
function walkNodes(root: any, limit = MAX_ITEMS): any[] {
    const result: any[] = [];
    const visit = (node: any) => {
        if (!node || result.length >= limit) return;
        result.push(node);
        for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return result;
}

async function sceneSourceEvidence(): Promise<{ url: string | null, sha256: string | null }> {
    await Editor.Message.request('scene', 'save-scene');
    const current = await Editor.Message.request('scene', 'query-current-scene').catch(() => null) as any;
    const identifier = current?.uuid ?? current?.id;
    if (typeof identifier !== 'string' || !identifier) return { url: null, sha256: null };
    const info = await Editor.Message.request('asset-db', 'query-asset-info', identifier).catch(() => null) as AssetRow | null;
    if (!info?.file) return { url: info?.url ?? null, sha256: null };
    return { url: info.url, sha256: sha256(await fs.readFile(info.file)) };
}
function stableIdentity(pathValue: string, value: unknown): string { return `${pathValue}:${typeof value}`; }
type TilemapLayerInventory = { id: string, name: string, width: number, height: number, visible: boolean, opacity: number, offsetX: number, offsetY: number, tileCount: number };
type TilemapObjectInventory = { id: string, name: string, type: string, x: number, y: number, width: number, height: number };
type TilemapInventory = { format: 'tmx', map: Record<string, unknown>, tilesets: Array<Record<string, unknown>>, layers: TilemapLayerInventory[], objectGroups: Array<{ id: string, name: string, objects: TilemapObjectInventory[] }> };
const XML_TAG_RE = (name: string): RegExp => new RegExp(`<${name}\\b[^>]*>`, 'i');
function xmlAttribute(tag: string, name: string): string | undefined {
    const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match?.[1];
}
function xmlNumber(tag: string, name: string, fallback = 0): number {
    const value = Number(xmlAttribute(tag, name));
    return Number.isFinite(value) ? value : fallback;
}
function xmlBoolean(tag: string, name: string, fallback = true): boolean {
    const value = xmlAttribute(tag, name);
    return value === undefined ? fallback : value !== '0' && value.toLowerCase() !== 'false';
}
function decodeXml(value: string): string {
    return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function encodeXml(value: unknown): string {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function tilemapInventory(content: string, maxItems: number): TilemapInventory {
    const mapTag = content.match(XML_TAG_RE('map'))?.[0] ?? '';
    const layerMatches = [...content.matchAll(/<layer\b[^>]*>([\s\S]*?)<\/layer>/gi)].slice(0, maxItems);
    const layers = layerMatches.map((match) => {
        const tag = match[0].match(XML_TAG_RE('layer'))?.[0] ?? '';
        const data = match[1].match(/<data\b[^>]*>([\s\S]*?)<\/data>/i)?.[1]?.trim() ?? '';
        const tileCount = data ? data.split(/[,\s]+/).filter(Boolean).length : 0;
        return { id: xmlAttribute(tag, 'id') ?? '', name: decodeXml(xmlAttribute(tag, 'name') ?? ''), width: xmlNumber(tag, 'width'), height: xmlNumber(tag, 'height'), visible: xmlBoolean(tag, 'visible'), opacity: xmlNumber(tag, 'opacity', 1), offsetX: xmlNumber(tag, 'offsetx'), offsetY: xmlNumber(tag, 'offsety'), tileCount };
    });
    const objectGroups = [...content.matchAll(/<objectgroup\b[^>]*>([\s\S]*?)<\/objectgroup>/gi)].slice(0, maxItems).map((match) => {
        const groupTag = match[0].match(XML_TAG_RE('objectgroup'))?.[0] ?? '';
        const objects = [...match[1].matchAll(/<object\b[^>]*\/?>/gi)].slice(0, maxItems).map((objectMatch) => {
            const tag = objectMatch[0];
            return { id: xmlAttribute(tag, 'id') ?? '', name: decodeXml(xmlAttribute(tag, 'name') ?? ''), type: decodeXml(xmlAttribute(tag, 'type') ?? xmlAttribute(tag, 'class') ?? ''), x: xmlNumber(tag, 'x'), y: xmlNumber(tag, 'y'), width: xmlNumber(tag, 'width'), height: xmlNumber(tag, 'height') };
        });
        return { id: xmlAttribute(groupTag, 'id') ?? '', name: decodeXml(xmlAttribute(groupTag, 'name') ?? ''), objects };
    });
    const tilesets = [...content.matchAll(/<tileset\b[^>]*\/?>/gi)].slice(0, maxItems).map((match) => {
        const tag = match[0];
        return { firstGid: xmlNumber(tag, 'firstgid'), source: xmlAttribute(tag, 'source') ?? null, name: decodeXml(xmlAttribute(tag, 'name') ?? '') };
    });
    return { format: 'tmx', map: { orientation: xmlAttribute(mapTag, 'orientation') ?? null, width: xmlNumber(mapTag, 'width'), height: xmlNumber(mapTag, 'height'), tileWidth: xmlNumber(mapTag, 'tilewidth'), tileHeight: xmlNumber(mapTag, 'tileheight'), renderOrder: xmlAttribute(mapTag, 'renderorder') ?? null }, tilesets, layers, objectGroups };
}
function tilemapPath(pathValue: string): { kind: 'layers' | 'objects', selector: string, property: string } {
    const parts = pathValue.split('.');
    if (parts.length !== 3 || (parts[0] !== 'layers' && parts[0] !== 'objects') || !parts[1] || !/^(name|visible|opacity|offsetx|offsety|x|y|width|height)$/.test(parts[2])) invalid('Tilemap path must be layers.<id-or-name>.<name|visible|opacity|offsetx|offsety> or objects.<id-or-name>.<x|y|width|height|name>.');
    return { kind: parts[0], selector: parts[1], property: parts[2] };
}
function xmlValue(value: unknown, property: string): string {
    if (property === 'visible') {
        if (typeof value !== 'boolean') invalid(`Tilemap '${property}' requires a boolean.`);
        return value ? '1' : '0';
    }
    if (['opacity', 'offsetx', 'offsety', 'x', 'y', 'width', 'height'].includes(property)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`Tilemap '${property}' requires a finite number.`);
        return String(value);
    }
    if (typeof value !== 'string' || value.length > 256) invalid(`Tilemap '${property}' requires a bounded string.`);
    return encodeXml(value);
}
function updateTilemapXml(content: string, kind: 'layers' | 'objects', selector: string, property: string, value: unknown): { content: string, previous: unknown } {
    const encodedSelector = decodeXml(selector);
    const tagName = kind === 'layers' ? 'layer' : 'object';
    const pattern = kind === 'layers' ? /<layer\b[^>]*>/gi : /<object\b[^>]*\/?>/gi;
    let previous: unknown;
    let changed = false;
    const next = content.replace(pattern, (tag) => {
        const id = xmlAttribute(tag, 'id') ?? '';
        const name = decodeXml(xmlAttribute(tag, 'name') ?? '');
        if (id !== encodedSelector && name !== encodedSelector) return tag;
        if (property === 'name') previous = name;
        else if (property === 'visible') previous = xmlBoolean(tag, property);
        else previous = xmlNumber(tag, property, 0);
        changed = true;
        const replacement = `${property}="${xmlValue(value, property)}"`;
        const attr = new RegExp(`\\s${property}="[^"]*"`, 'i');
        return attr.test(tag) ? tag.replace(attr, ` ${replacement}`) : tag.replace(/\/?>$/, ` ${replacement}$&`);
    });
    if (!changed) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Tilemap ${kind.slice(0, -1)} '${selector}' was not found.` });
    return { content: next, previous };
}
async function saveTilemapAsset(row: AssetRow, content: string): Promise<{ before: string, after: string }> {
    const before = await readAsset(row);
    const saved = await Editor.Message.request('asset-db', 'save-asset', row.url, content);
    if (!saved) throw new ToolError({ code: 'MUTATION_REFUSED', status: 422, message: `Creator refused tilemap source update for ${row.url}.` });
    await Editor.Message.request('asset-db', 'reimport-asset', row.uuid);
    const after = await readAsset(await resolveAsset({ id: row.uuid }));
    return { before: before.hash, after: after.hash };
}
async function generatedAtlasOutputs(asset: AssetRow): Promise<Array<Record<string, unknown>>> {
    const projectPath = (Editor as unknown as { Project?: { path?: string } }).Project?.path;
    if (!projectPath) return [];
    const shard = asset.uuid.slice(0, 2);
    const roots = [path.join(projectPath, 'library', shard, `${asset.uuid}.json`), path.join(projectPath, 'library', shard, `${asset.uuid}.png`), path.join(projectPath, 'library', asset.uuid), path.join(projectPath, 'library', `${asset.uuid}.json`), path.join(projectPath, 'library', `${asset.uuid}.png`)];
    const outputs: Array<Record<string, unknown>> = [];
    const inspect = async (candidate: string): Promise<void> => {
        if (outputs.length >= 32) return;
        const stat = await fs.stat(candidate).catch(() => null);
        if (!stat) return;
        if (stat.isFile()) {
            outputs.push({ path: candidate, bytes: stat.size, sha256: sha256(await fs.readFile(candidate)) });
            return;
        }
        if (!stat.isDirectory()) return;
        for (const entry of (await fs.readdir(candidate)).slice(0, 64)) await inspect(path.join(candidate, entry));
    };
    for (const root of roots) await inspect(root);
    return outputs;
}
function diffValues(before: any, after: any, pathValue = '', output: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
    if (output.length >= MAX_ITEMS) return output;
    if (JSON.stringify(before) === JSON.stringify(after)) return output;
    if (Array.isArray(before) && Array.isArray(after)) {
        const length = Math.max(before.length, after.length);
        for (let index = 0; index < length; index += 1) diffValues(before[index], after[index], pathValue ? `${pathValue}.${index}` : String(index), output);
        return output;
    }
    if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
        for (const key of keys) diffValues(before[key], after[key], pathValue ? `${pathValue}.${key}` : key, output);
        return output;
    }
    output.push({ path: pathValue, identity: stableIdentity(pathValue, after ?? before), before: before ?? null, after: after ?? null });
    return output;
}

export class AdvancedCapabilityTools {
    @utcpTool('referenceImageManage', 'Manage a bounded reference image record in the active scene and verify persistence through scene read-back.', {
        type: 'object', additionalProperties: false, properties: { operation: { type: 'string', enum: ['inspect', 'set', 'clear'] }, reference: InstanceReferenceSchema, imagePath: { type: 'string', maxLength: 2048 } }, required: ['operation']
    }, { type: 'object', additionalProperties: false, properties: { operation: { type: 'string' }, supported: { type: 'boolean' }, persisted: { type: 'boolean' }, reference: { type: 'object' }, imagePath: { type: ['string', 'null'] } }, required: ['operation', 'supported', 'persisted'] }, 'POST', ['reference', 'image', 'manage', 'scene'])
    async referenceImageManage(args: { operation: 'inspect' | 'set' | 'clear', reference?: IInstanceReference, imagePath?: string }): Promise<Record<string, unknown>> {
        if (args.operation === 'set' && (!args.imagePath || args.imagePath.length > 2048)) invalid('imagePath is required for set and must be bounded.');
        const request = args.operation === 'inspect' ? 'query-reference-image' : args.operation === 'set' ? 'set-reference-image' : 'clear-reference-image';
        try {
            const payload = args.operation === 'set' ? { path: args.imagePath, uuid: args.reference?.id } : args.reference?.id;
            const result = await Editor.Message.request('scene', request, payload);
            return { operation: args.operation, supported: true, persisted: args.operation === 'inspect' || result !== false, imagePath: args.imagePath ?? null, reference: args.reference ?? null, result: result ?? null };
        } catch (error) {
            const profile = (Editor as any).Profile;
            if (!profile || typeof profile.getProject !== 'function' || typeof profile.setProject !== 'function') {
                throw new ToolError({ code: 'UNSUPPORTED_SCENE_IPC', status: 422, message: `Creator does not expose ${request} or project reference-image storage.`, details: { cause: error instanceof Error ? error.message : String(error) }, recovery: 'Use a Creator version exposing reference-image scene IPC or project profile storage.' });
            }
            const current = await Editor.Message.request('scene', 'query-current-scene').catch(() => null) as any;
            const sceneId = args.reference?.id ?? (typeof current === 'string' ? current : current?.uuid ?? current?.id);
            if (typeof sceneId !== 'string' || !sceneId) throw new ToolError({ code: 'NOT_FOUND', status: 404, message: 'No active scene is available for reference-image storage.' });
            const stored = await profile.getProject('cc-bridge-3x', 'referenceImages', 'project').catch(() => ({})) as Record<string, unknown> | null;
            const records = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
            if (args.operation === 'set') {
                const asset = await resolveAsset(undefined, args.imagePath);
                records[sceneId] = { id: asset.uuid, url: asset.url, file: asset.file ?? null };
                await profile.setProject('cc-bridge-3x', 'referenceImages', records, 'project');
            } else if (args.operation === 'clear') {
                delete records[sceneId];
                await profile.setProject('cc-bridge-3x', 'referenceImages', records, 'project');
            }
            const readBack = await profile.getProject('cc-bridge-3x', 'referenceImages', 'project').catch(() => ({})) as Record<string, unknown> | null;
            const record = readBack && typeof readBack === 'object' ? readBack[sceneId] : null;
            return { operation: args.operation, supported: true, persisted: args.operation === 'clear' ? record === undefined : !!record, imagePath: (record as any)?.url ?? args.imagePath ?? null, reference: record ? { id: (record as any).id, type: 'cc.ImageAsset' } : null, storage: 'project-profile', nativeIpc: false };
        }
    }

    @utcpTool('prefabOverrideDiff', 'Compare bounded prefab JSON records with stable serialized identities.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema, baselineReference: InstanceReferenceSchema }, required: ['reference', 'baselineReference'] }, { type: 'object', properties: { equal: { type: 'boolean' }, changes: { type: 'array' }, source: { type: 'object' }, baseline: { type: 'object' } }, required: ['equal', 'changes', 'source', 'baseline'] }, 'GET', ['prefab', 'override', 'diff', 'stable'])
    async prefabOverrideDiff(args: { reference: IInstanceReference, baselineReference: IInstanceReference }): Promise<Record<string, unknown>> {
        const [current, baseline] = await Promise.all([resolveAsset(args.reference), resolveAsset(args.baselineReference)]);
        const [currentData, baselineData] = await Promise.all([readAsset(current), readAsset(baseline)]);
        const currentJson = JSON.parse(currentData.content); const baselineJson = JSON.parse(baselineData.content);
        const changes = diffValues(baselineJson, currentJson);
        return { equal: changes.length === 0, changes, source: { uuid: current.uuid, url: current.url, sha256: currentData.hash }, baseline: { uuid: baseline.uuid, url: baseline.url, sha256: baselineData.hash } };
    }

    @utcpTool('prefabReferenceAudit', 'Audit nested prefab UUID references and missing serialized dependencies after reload-safe source read.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema, maxReferences: { type: 'integer', minimum: 1, maximum: 2000, default: 2000 } }, required: ['reference'] }, { type: 'object', properties: { valid: { type: 'boolean' }, nestedPrefabs: { type: 'array' }, missingReferences: { type: 'array' }, source: { type: 'object' } }, required: ['valid', 'nestedPrefabs', 'missingReferences', 'source'] }, 'GET', ['prefab', 'reference', 'audit', 'nested'])
    async prefabReferenceAudit(args: { reference: IInstanceReference, maxReferences?: number }): Promise<Record<string, unknown>> {
        const maxReferences = bounded(args.maxReferences, 2000, 2000); const row = await resolveAsset(args.reference); const source = await readAsset(row); const assets = await queryAssets(); const known = new Set(assets.map((asset) => baseUuid(asset.uuid))); const ids = refs(source.content).slice(0, maxReferences); const nested = assets.filter((asset) => ids.includes(baseUuid(asset.uuid)) && asset.url.endsWith('.prefab')).map((asset) => ({ uuid: asset.uuid, url: asset.url })); const missingReferences = ids.filter((id) => !known.has(id)).map((id) => ({ id })); return { valid: missingReferences.length === 0, nestedPrefabs: nested, missingReferences, source: { uuid: row.uuid, url: row.url, sha256: source.hash, reloaded: true } };
    }

    @utcpTool('sceneReferenceValidate', 'Validate serialized UUID references in a scene asset against the imported asset database.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema, maxReferences: { type: 'integer', minimum: 1, maximum: 2000, default: 2000 } }, required: ['reference'] }, { type: 'object', properties: { valid: { type: 'boolean' }, references: { type: 'array' }, missingReferences: { type: 'array' }, source: { type: 'object' } }, required: ['valid', 'references', 'missingReferences', 'source'] }, 'GET', ['scene', 'reference', 'validate', 'serialized'])
    async sceneReferenceValidate(args: { reference: IInstanceReference, maxReferences?: number }): Promise<Record<string, unknown>> {
        const row = await resolveAsset(args.reference); const source = await readAsset(row); const known = new Set((await queryAssets()).map((asset) => baseUuid(asset.uuid))); const references = refs(source.content).slice(0, bounded(args.maxReferences, 2000, 2000)); const missingReferences = references.filter((id) => !known.has(id)); return { valid: missingReferences.length === 0, references, missingReferences, source: { uuid: row.uuid, url: row.url, sha256: source.hash, reopened: true } };
    }

    @utcpTool('prefabInstantiate', 'Instantiate a prefab through the scene IPC and return stable identity read-back.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema, parentReference: InstanceReferenceSchema, name: { type: 'string', maxLength: 128 } }, required: ['reference'] }, { type: 'object', properties: { reference: { type: 'object' }, source: { type: 'object' }, persisted: { type: 'boolean' } }, required: ['reference', 'source', 'persisted'] }, 'POST', ['prefab', 'instantiate', 'scene'])
    async prefabInstantiate(args: { reference: IInstanceReference, parentReference?: IInstanceReference, name?: string }): Promise<Record<string, unknown>> {
        const source = await resolveAsset(args.reference);
        try {
            const root = args.parentReference?.id ?? (await Editor.Message.request('scene', 'query-node-tree') as any)?.uuid;
            if (!root) throw new Error('No active scene root is available for prefab instantiation.');
            const options: Record<string, unknown> = { name: args.name ?? path.basename(source.url, '.prefab'), parent: root, assetUuid: source.uuid, unlinkPrefab: false, type: 'cc.Prefab' };
            const result = await Editor.Message.request('scene', 'create-node', options as any);
            const id = Array.isArray(result) ? result[0] : result;
            if (!id) throw new Error('Creator returned no instantiated node identity.');
            await Editor.Message.request('scene', 'snapshot');
            const readBack = await Editor.Message.request('scene', 'query-node', id);
            return { reference: { id, type: 'cc.Node' }, source: { id: source.uuid, url: source.url }, persisted: !!readBack, readBack };
        } catch (error) { throw new ToolError({ code: 'PREFAB_INSTANTIATE_FAILED', status: 502, message: 'Prefab instantiation did not return a verifiable node.', details: { cause: error instanceof Error ? error.message : String(error) } }); }
    }

    private async prefabSceneOperation(operation: 'apply' | 'revert', reference: IInstanceReference): Promise<Record<string, unknown>> {
        try {
            const beforeNode = await Editor.Message.request('scene', 'query-node', reference.id) as unknown as Record<string, unknown> | null;
            if (!beforeNode) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Prefab instance ${reference.id} was not found.` });
            const prefab = propertyValue(beforeNode.__prefab__ ?? beforeNode._prefab);
            const assetId = prefab?.prefabStateInfo?.assetUuid ?? prefab?.uuid;
            if (typeof assetId !== 'string' || !assetId) throw new ToolError({ code: 'TYPE_MISMATCH', status: 422, message: `Node ${reference.id} is not a linked prefab instance.` });
            const source = await resolveAsset({ id: assetId });
            const sourceBefore = await readAsset(source);
            let result: unknown;
            if (operation === 'apply') {
                result = await Editor.Message.request('scene', 'execute-scene-script', { name: 'cc-bridge-3x', method: 'applyPrefabByNode', args: [reference.id] });
                if (result !== null && result !== undefined) throw new Error(String(result));
                await new Promise((resolve) => setTimeout(resolve, 50));
            } else {
                result = await Editor.Message.request('scene', 'restore-prefab', { uuid: reference.id });
                if (result !== true) throw new Error(`restore-prefab returned ${JSON.stringify(result ?? null)}`);
            }
            await Editor.Message.request('scene', 'snapshot');
            const afterNode = await Editor.Message.request('scene', 'query-node', reference.id);
            if (!afterNode || typeof afterNode !== 'object') throw new Error('Target node was not present after operation.');
            const sourceAfter = await readAsset(await resolveAsset({ id: assetId }));
            return {
                reference,
                operation,
                persisted: true,
                readBack: afterNode,
                sourceReadBack: { id: assetId, url: source.url, beforeSha256: sourceBefore.hash, afterSha256: sourceAfter.hash },
                result: result ?? null,
            };
        } catch (error) {
            if (error instanceof ToolError) throw error;
            throw new ToolError({ code: 'PREFAB_OVERRIDE_OPERATION_FAILED', status: 502, message: `${operation} prefab overrides failed or could not be read back.`, details: { cause: error instanceof Error ? error.message : String(error) } });
        }
    }
    @utcpTool('prefabApplyOverrides', 'Apply prefab overrides through the scene IPC and verify typed source and instance read-back.', { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, { type: 'object', properties: { reference: { type: 'object' }, operation: { type: 'string' }, persisted: { type: 'boolean' }, readBack: { type: 'object' }, sourceReadBack: { type: 'object' } }, required: ['reference', 'operation', 'persisted', 'readBack', 'sourceReadBack'] }, 'POST', ['prefab', 'apply', 'overrides'])
    async prefabApplyOverrides(args: { reference: IInstanceReference }): Promise<Record<string, unknown>> { return this.prefabSceneOperation('apply', args.reference); }
    @utcpTool('prefabRevertOverrides', 'Revert prefab overrides through the scene IPC and verify selective node restoration.', { type: 'object', properties: { reference: InstanceReferenceSchema, paths: { type: 'array', maxItems: MAX_ITEMS, items: { type: 'string' } } }, required: ['reference'] }, { type: 'object', properties: { reference: { type: 'object' }, operation: { type: 'string' }, persisted: { type: 'boolean' }, readBack: { type: 'object' } }, required: ['reference', 'operation', 'persisted', 'readBack'] }, 'POST', ['prefab', 'revert', 'overrides'])
    async prefabRevertOverrides(args: { reference: IInstanceReference, paths?: string[] }): Promise<Record<string, unknown>> {
        if (args.paths && args.paths.length > 0) throw new ToolError({ code: 'UNSUPPORTED_SELECTIVE_REVERT', status: 422, message: 'Creator 3.7.3 restore-prefab reverts the full instance and does not expose selective path restoration.' });
        return this.prefabSceneOperation('revert', args.reference);
    }

    @utcpTool('tilemapInspect', 'Inspect an imported TMX tilemap and return a bounded typed layer/object inventory.', { type: 'object', properties: { reference: InstanceReferenceSchema, maxLayers: { type: 'integer', minimum: 1, maximum: MAX_ITEMS, default: MAX_ITEMS } }, required: ['reference'] }, { type: 'object', properties: { reference: { type: 'object' }, format: { type: 'string' }, map: { type: 'object' }, tilesets: { type: 'array' }, layers: { type: 'array' }, objectGroups: { type: 'array' }, count: { type: 'integer' } }, required: ['reference', 'format', 'map', 'tilesets', 'layers', 'objectGroups', 'count'] }, 'GET', ['tilemap', 'inspect', 'layers'])
    async tilemapInspect(args: { reference: IInstanceReference, maxLayers?: number }): Promise<Record<string, unknown>> {
        const row = await resolveAsset(args.reference);
        if (!/\.tmx$/i.test(row.url)) throw new ToolError({ code: 'TYPE_MISMATCH', status: 422, message: `Tilemap inspection requires an imported .tmx asset, got ${row.url}.` });
        const inventory = tilemapInventory((await readAsset(row)).content, bounded(args.maxLayers, MAX_ITEMS));
        return { reference: { id: row.uuid, type: row.type ?? 'cc.TiledMapAsset' }, ...inventory, count: inventory.layers.length + inventory.objectGroups.length };
    }
    private async tilemapSourceEdit(args: { reference: IInstanceReference, path: string, value: unknown }): Promise<Record<string, unknown>> {
        const row = await resolveAsset(args.reference);
        if (!/\.tmx$/i.test(row.url)) throw new ToolError({ code: 'TYPE_MISMATCH', status: 422, message: `Tilemap editing requires an imported .tmx asset, got ${row.url}.` });
        const target = tilemapPath(args.path);
        const before = await readAsset(row);
        const update = updateTilemapXml(before.content, target.kind, target.selector, target.property, args.value);
        const hashes = await saveTilemapAsset(row, update.content);
        const readBackSource = await readAsset(await resolveAsset({ id: row.uuid }));
        const inventory = tilemapInventory(readBackSource.content, MAX_ITEMS);
        const collection = target.kind === 'layers' ? inventory.layers : inventory.objectGroups.flatMap((group) => group.objects);
        const readBack = collection.find((item) => item.id === target.selector || item.name === target.selector) ?? null;
        const persisted = readBack !== null && JSON.stringify(readBack[target.property as keyof typeof readBack]) === JSON.stringify(args.value);
        if (!persisted) throw new ToolError({ code: 'READBACK_MISMATCH', status: 502, message: `Tilemap source read-back did not match '${args.path}'.` });
        return { reference: { id: row.uuid, type: row.type ?? 'cc.TiledMapAsset' }, path: args.path, changed: hashes.before !== hashes.after, previous: update.previous, readBack, persisted: true, source: { url: row.url, beforeSha256: hashes.before, afterSha256: hashes.after } };
    }
    @utcpTool('tilemapLayerEdit', 'Edit one imported TMX layer attribute and verify source/reimport read-back.', { type: 'object', properties: { reference: InstanceReferenceSchema, path: { type: 'string', pattern: '^layers\\.' }, value: {} }, required: ['reference', 'path', 'value'] }, { type: 'object', properties: { reference: { type: 'object' }, path: { type: 'string' }, changed: { type: 'boolean' }, previous: {}, readBack: {}, persisted: { type: 'boolean' }, source: { type: 'object' } }, required: ['reference', 'path', 'changed', 'readBack', 'persisted', 'source'] }, 'POST', ['tilemap', 'layer', 'edit'])
    async tilemapLayerEdit(args: { reference: IInstanceReference, path: string, value: unknown }): Promise<Record<string, unknown>> { return this.tilemapSourceEdit(args); }
    @utcpTool('tilemapObjectEdit', 'Edit one imported TMX object attribute and verify source/reimport read-back.', { type: 'object', properties: { reference: InstanceReferenceSchema, path: { type: 'string', pattern: '^objects\\.' }, value: {} }, required: ['reference', 'path', 'value'] }, { type: 'object', properties: { reference: { type: 'object' }, path: { type: 'string' }, changed: { type: 'boolean' }, previous: {}, readBack: {}, persisted: { type: 'boolean' }, source: { type: 'object' } }, required: ['reference', 'path', 'changed', 'readBack', 'persisted', 'source'] }, 'POST', ['tilemap', 'object', 'edit'])
    async tilemapObjectEdit(args: { reference: IInstanceReference, path: string, value: unknown }): Promise<Record<string, unknown>> { return this.tilemapSourceEdit(args); }
    @utcpTool('tilemapValidate', 'Validate imported TMX tilemap UUID references against imported assets.', { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, { type: 'object', properties: { reference: { type: 'object' }, valid: { type: 'boolean' }, missingReferences: { type: 'array' }, checkedNodes: { type: 'integer' }, source: { type: 'object' } }, required: ['reference', 'valid', 'missingReferences', 'checkedNodes', 'source'] }, 'GET', ['tilemap', 'validate', 'references'])
    async tilemapValidate(args: { reference: IInstanceReference }): Promise<Record<string, unknown>> {
        const row = await resolveAsset(args.reference);
        if (!/\.tmx$/i.test(row.url)) throw new ToolError({ code: 'TYPE_MISMATCH', status: 422, message: `Tilemap validation requires an imported .tmx asset, got ${row.url}.` });
        const source = await readAsset(row);
        const known = new Set((await queryAssets()).map((asset) => baseUuid(asset.uuid)));
        const references = refs(source.content);
        const missingReferences = references.filter((id) => !known.has(id)).map((id) => ({ id }));
        const inventory = tilemapInventory(source.content, MAX_ITEMS);
        return { reference: { id: row.uuid, type: row.type ?? 'cc.TiledMapAsset' }, valid: missingReferences.length === 0, missingReferences, checkedNodes: inventory.layers.length + inventory.objectGroups.length, source: { url: row.url, sha256: source.hash, references } };
    }

    @utcpTool('spriteAtlasConfigure', 'Configure a bounded sprite atlas importer setting and verify generated library output.', { type: 'object', properties: { reference: InstanceReferenceSchema, presetId: { type: 'string', minLength: 1, maxLength: 128 }, maxWidth: { type: 'integer', minimum: 1, maximum: 8192 }, maxHeight: { type: 'integer', minimum: 1, maximum: 8192 } }, required: ['reference', 'presetId'] }, { type: 'object', properties: { reference: { type: 'object' }, changed: { type: 'boolean' }, generatedOutputs: { type: 'array' }, sourceSha256: { type: 'string' }, persisted: { type: 'boolean' } }, required: ['reference', 'changed', 'generatedOutputs', 'sourceSha256', 'persisted'] }, 'POST', ['sprite', 'atlas', 'configure'])
    async spriteAtlasConfigure(args: { reference: IInstanceReference, presetId: string, maxWidth?: number, maxHeight?: number }): Promise<Record<string, unknown>> {
        const row = await resolveAsset(args.reference);
        if (row.type !== 'cc.SpriteAtlas' && row.importer !== 'auto-atlas') throw new ToolError({ code: 'TYPE_MISMATCH', status: 422, message: `Sprite atlas configuration requires an auto-atlas asset, got ${row.url}.` });
        const importer = new AssetTools();
        const before = await importer.assetImportSettingsGet({ reference: args.reference });
        const settings = before.settings;
        const operations: Array<Record<string, unknown>> = [];
        if (args.presetId !== 'default') {
            if (!before.schema.properties.some((property) => property.path === 'algorithm' && property.enumValues?.includes(args.presetId))) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `Unsupported auto-atlas algorithm preset '${args.presetId}'.` });
            operations.push(await importer.assetImportSettingsSet({ reference: args.reference, path: 'algorithm', value: args.presetId }));
        }
        if (args.maxWidth !== undefined) operations.push(await importer.assetImportSettingsSet({ reference: args.reference, path: 'maxWidth', value: args.maxWidth }));
        if (args.maxHeight !== undefined) operations.push(await importer.assetImportSettingsSet({ reference: args.reference, path: 'maxHeight', value: args.maxHeight }));
        if (operations.length === 0) await Editor.Message.request('asset-db', 'reimport-asset', row.uuid);
        const readBack = await importer.assetImportSettingsGet({ reference: args.reference });
        const generatedOutputs = await generatedAtlasOutputs(row);
        if (generatedOutputs.length === 0) throw new ToolError({ code: 'GENERATED_OUTPUT_UNAVAILABLE', status: 502, message: `Auto-atlas reimport completed without verifiable library output for ${row.url}.`, details: { source: row.url, settings: readBack.settings } });
        const source = await readAsset(row);
        return { reference: { id: row.uuid, type: row.type ?? 'cc.SpriteAtlas' }, presetId: args.presetId, changed: operations.length > 0, operations, generatedOutputs, sourceSha256: source.hash, settings: readBack.settings, persisted: true };
    }


    @utcpTool('uiResponsivePreview', 'Compare bounded UI geometry across requested resolutions using deterministic projection evidence.', { type: 'object', additionalProperties: false, properties: { resolutions: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', minimum: 1 }, height: { type: 'number', minimum: 1 } }, required: ['width', 'height'] } }, reference: InstanceReferenceSchema }, required: ['resolutions'] }, { type: 'object', properties: { supported: { type: 'boolean' }, comparisons: { type: 'array' }, stable: { type: 'boolean' }, caveat: { type: 'string' } }, required: ['supported', 'comparisons', 'stable', 'caveat'] }, 'GET', ['ui', 'responsive', 'preview'])
    async uiResponsivePreview(args: { resolutions: Array<{ width: number, height: number }>, reference?: IInstanceReference }): Promise<Record<string, unknown>> {
        const tree = await sceneTree();
        const nodes = walkNodes(tree);
        const root = args.reference?.id ? nodes.find((node) => node.uuid === args.reference?.id) : tree;
        if (!root) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `UI node not found: ${args.reference?.id}` });
        const ids = typeof root.uuid === 'string' ? [root.uuid] : [];
        if (ids.length === 0) throw new ToolError({ code: 'UI_LAYOUT_QUERY_FAILED', status: 502, message: 'No UI node identities were available for responsive comparison.' });
        const geometry = await Editor.Message.request('scene', 'execute-scene-script', { name: 'cc-bridge-3x', method: 'uiLayoutInspectGeometry', args: [{ nodeIds: ids }] }) as { nodes?: unknown[] } | null;
        const entries = Array.isArray(geometry?.nodes) ? geometry.nodes.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry)) : [];
        if (entries.length === 0) throw new ToolError({ code: 'UI_LAYOUT_QUERY_FAILED', status: 502, message: 'Responsive comparison received no measurable UI geometry.' });
        const base = args.resolutions[0];
        const comparisons = args.resolutions.map((resolution) => {
            const scaleX = resolution.width / base.width;
            const scaleY = resolution.height / base.height;
            const projectedRects = entries.map((entry) => {
                const rect = entry.worldRect;
                if (!rect || typeof rect !== 'object' || Array.isArray(rect)) return { id: entry.id ?? null, worldRect: null };
                const source = rect as Record<string, unknown>;
                return { id: entry.id ?? null, worldRect: { x: Number(source.x) * scaleX, y: Number(source.y) * scaleY, width: Number(source.width) * scaleX, height: Number(source.height) * scaleY } };
            });
            return { resolution, scale: { x: scaleX, y: scaleY }, projectedRects, evidence: 'uiLayoutInspectGeometry-worldRect-projection' };
        });
        return { supported: true, comparisons, stable: comparisons.length > 0, caveat: 'Creator 3.7.3 exposes live world geometry but no preview viewport setter; comparisons are bounded deterministic projections, not rendered screenshots.' };
    }

    @utcpTool('previewResolutionSet', 'Set an allowlisted preview resolution through Creator IPC and read back the applied value.', { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', minimum: 1, maximum: 8192 }, height: { type: 'integer', minimum: 1, maximum: 8192 } }, required: ['width', 'height'] }, { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' }, persisted: { type: 'boolean' }, supported: { type: 'boolean' } }, required: ['width', 'height', 'persisted', 'supported'] }, 'POST', ['preview', 'resolution', 'set'])
    async previewResolutionSet(args: { width: number, height: number }): Promise<Record<string, unknown>> { try { const result = await Editor.Message.request('preview', 'set-resolution', { width: args.width, height: args.height }); return { width: args.width, height: args.height, persisted: result !== false, supported: true, readBack: result ?? null }; } catch (error) { throw new ToolError({ code: 'UNSUPPORTED_PREVIEW_IPC', status: 422, message: 'Creator preview resolution IPC is unavailable.', details: { cause: error instanceof Error ? error.message : String(error) } }); } }

    @utcpTool('editorUndoTransactionProbe', 'Probe snapshot, undo, redo, and snapshot-abort lifecycle boundaries without leaving a pending transaction.', { type: 'object', properties: {} }, { type: 'object', properties: { supported: { type: 'boolean' }, boundaries: { type: 'array' }, clean: { type: 'boolean' } }, required: ['supported', 'boundaries', 'clean'] }, 'POST', ['editor', 'undo', 'transaction', 'probe'])
    async editorUndoTransactionProbe(): Promise<Record<string, unknown>> { const boundaries: string[] = []; try { await Editor.Message.request('scene', 'snapshot'); boundaries.push('snapshot'); await Editor.Message.request('scene', 'snapshot-abort'); boundaries.push('snapshot-abort'); return { supported: true, boundaries, clean: true }; } catch (error) { throw new ToolError({ code: 'UNDO_PROBE_FAILED', status: 422, message: 'Creator undo transaction lifecycle is unavailable.', details: { cause: error instanceof Error ? error.message : String(error) } }); } }

    @utcpTool('broadcastObserve', 'Observe one allowlisted Creator broadcast through a byte-bounded register, observe, and dispose lifecycle.', { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', enum: ['cc-bridge-3x:probe', 'scene:change', 'asset-db:change'] } }, required: ['topic'] }, { type: 'object', properties: { topic: { type: 'string' }, supported: { type: 'boolean' }, observed: { type: 'boolean' }, lifecycle: { type: 'array' }, eventBytes: { type: 'integer' }, truncated: { type: 'boolean' } }, required: ['topic', 'supported', 'observed', 'lifecycle', 'eventBytes', 'truncated'] }, 'GET', ['broadcast', 'event', 'observe'])
    async broadcastObserve(args: { topic: string }): Promise<Record<string, unknown>> {
        const messages = Editor.Message as unknown as {
            addBroadcastListener?: (topic: string, handler: (...payload: unknown[]) => void) => void,
            removeBroadcastListener?: (topic: string, handler: (...payload: unknown[]) => void) => void,
            broadcast: (topic: string, ...payload: unknown[]) => void,
        };
        if (typeof messages.addBroadcastListener !== 'function' || typeof messages.removeBroadcastListener !== 'function') throw new ToolError({ code: 'UNSUPPORTED_BROADCAST_IPC', status: 422, message: 'Creator broadcast listener lifecycle is unavailable.' });
        const marker = `ccb3x-${Date.now()}`;
        let observed: unknown[] | null = null;
        const handler = (...payload: unknown[]) => { observed = payload; };
        const lifecycle = ['registered'];
        messages.addBroadcastListener(args.topic, handler);
        try {
            if (args.topic === 'cc-bridge-3x:probe') messages.broadcast(args.topic, marker);
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (observed !== null) lifecycle.push('observed');
        } finally {
            messages.removeBroadcastListener(args.topic, handler);
            lifecycle.push('disposed');
        }
        const serialized = observed === null ? '' : JSON.stringify(observed) ?? '';
        const eventBytes = Buffer.byteLength(serialized, 'utf8');
        const truncated = eventBytes > 4096;
        const event = truncated ? { omitted: true, bytes: eventBytes, reason: 'Broadcast payload exceeds the 4096-byte response limit.' } : observed;
        return { topic: args.topic, supported: true, observed: observed !== null, lifecycle, event, eventBytes, truncated, retainedListener: false };
    }
}
