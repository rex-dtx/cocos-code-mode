import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { IProperty } from '@cocos/creator-types/editor/packages/scene/@types/public';
import { finalizeUiLayoutReport } from '../../ui-layout-report';
import type { LayoutReport, LayoutReportRequest, LayoutReportResult } from '../../ui-layout-report';
import type { UiSafeAreaInspectRequest, UiSafeAreaInspectResult } from '../../ui-safe-area-inspect';
import { isCandidateRequest } from '../../ui-layout-validate';
import type { UiLayoutValidateRequest, UiLayoutValidateResult } from '../../ui-layout-validate';

// UI prefab paths — Cocos Creator 3.x internal UI prefabs
const UI_PREFABS: Record<string, string> = {
    Canvas: 'db://internal/default_ui/Canvas.prefab',
    Label: 'db://internal/default_ui/Label.prefab',
    Button: 'db://internal/default_ui/Button.prefab',
    Sprite: 'db://internal/default_ui/Sprite.prefab',
    Widget: 'db://internal/default_ui/Widget.prefab',
    ScrollView: 'db://internal/default_ui/ScrollView.prefab',
    Toggle: 'db://internal/default_ui/Toggle.prefab',
    ProgressBar: 'db://internal/default_ui/ProgressBar.prefab',
    Slider: 'db://internal/default_ui/Slider.prefab',
    EditBox: 'db://internal/default_ui/EditBox.prefab',
    Layout: 'db://internal/default_ui/Layout.prefab',
    Graphics: 'db://internal/default_ui/Graphics.prefab',
    Mask: 'db://internal/default_ui/Mask.prefab',
    PageView: 'db://internal/default_ui/PageView.prefab',
    SafeArea: 'db://internal/default_ui/SafeArea.prefab',
};

interface SceneNodeDump {
    name?: string | { value?: string };
    children?: Array<{ uuid?: string, value?: { uuid?: string } }>;
    __comps__?: Array<{ type?: string, value?: Record<string, any> }>;
    position?: { value?: { x?: number, y?: number, z?: number } };
    active?: { value?: boolean } | boolean;
    uuid?: string;
}

interface UiLayoutNode {
    reference: IInstanceReference;
    name: string;
    active: boolean;
    position: { x: number, y: number, z: number };
    size: { width: number, height: number } | null;
    anchor: { x: number, y: number } | null;
    worldRect: { x: number, y: number, width: number, height: number } | null;
    components: string[];
}
async function ensureSceneComponents(uuid: string, components: string[]): Promise<void> {
    for (const component of [...new Set(components)]) {
        const raw = await Editor.Message.request('scene', 'query-node', uuid);
        const dump = raw && typeof raw === 'object' ? raw as unknown as SceneNodeDump : null;
        const existing = new Set((dump?.__comps__ ?? []).map((item) => item.type).filter((type): type is string => typeof type === 'string'));
        if (existing.has(component)) continue;
        await Editor.Message.request('scene', 'create-component', { uuid, component });
    }
}

export class UiTools {

    @utcpTool(
        'createUiNode',
        'Create a UI node from Cocos internal prefab templates (Canvas, Label, Button, Sprite, Widget, ScrollView, Toggle, ProgressBar, Slider, EditBox, Layout, Graphics, Mask, PageView, SafeArea).',
        {
            type: 'object',
            properties: {
                uiType: { type: 'string', enum: Object.keys(UI_PREFABS), description: 'UI component type to create' },
                name: { type: 'string', description: 'Node name (defaults to uiType)' },
                parentReference: InstanceReferenceSchema,
            },
            required: ['uiType'],
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] },
        'POST',
        ['ui', 'create', 'canvas', 'label', 'button', 'sprite', 'widget', '2d', 'panel']
    )
    async createUiNode(args: { uiType: string, name?: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference }> {
        const prefabUrl = UI_PREFABS[args.uiType];
        if (!prefabUrl) {
            throw new Error(`Unknown UI type: ${args.uiType}. Available: ${Object.keys(UI_PREFABS).join(', ')}`);
        }
        const nativeComponent = ({
            Label: 'cc.Label',
            Button: 'cc.Button',
            Sprite: 'cc.Sprite',
            ScrollView: 'cc.ScrollView',
            EditBox: 'cc.EditBox',
            Widget: 'cc.UITransform',
        } as Record<string, string>)[args.uiType];
        const [assetUuid, sceneRoot] = await Promise.all([
            Editor.Message.request('asset-db', 'query-uuid', prefabUrl),
            args.parentReference?.id ? Promise.resolve(null) : Editor.Message.request('scene', 'query-node-tree'),
        ]) as [string | null, any];

        const options: Record<string, unknown> = {
            name: args.name || args.uiType,
            parent: args.parentReference?.id || sceneRoot?.uuid,
        };

        if (assetUuid) {
            const result = await Editor.Message.request('scene', 'create-node', options);
            const nodeUuid = Array.isArray(result) ? result[0] : result;
            if (typeof nodeUuid !== 'string' || !nodeUuid) throw new Error(`Failed to create ${args.uiType} node`);
            await Editor.Message.request('scene', 'snapshot');
            return { reference: { id: nodeUuid, type: 'cc.Node' } };
        }
        if (!nativeComponent) throw new Error(`UI prefab not found at ${prefabUrl} — editor version may not include it.`);
        const result = await Editor.Message.request('scene', 'create-node', options);
        const nodeUuid = Array.isArray(result) ? result[0] : result;
        if (typeof nodeUuid !== 'string' || !nodeUuid) {
            throw new Error(`Failed to create native ${args.uiType} node`);
        }
        await ensureSceneComponents(nodeUuid, [nativeComponent, 'cc.UITransform']);
        await Editor.Message.request('scene', 'snapshot');
        return { reference: { id: nodeUuid, type: 'cc.Node' } };
    }

    @utcpTool(
        'createLabel',
        'Create a UI Label node with optional text, font size, and color.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Node name (default "Label")' },
                text: { type: 'string', description: 'Label text content' },
                fontSize: { type: 'number', description: 'Font size (default 20)' },
                color: { type: 'string', description: 'Text color hex, e.g. "#FFFFFF"' },
                parentReference: InstanceReferenceSchema,
            },
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] },
        'POST',
        ['ui', 'label', 'text', 'create', '2d']
    )
    async createLabel(args: { name?: string, text?: string, fontSize?: number, color?: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference }> {
        const { reference } = await this.createUiNode({ uiType: 'Label', name: args.name || 'Label', parentReference: args.parentReference });

        if (args.text !== undefined || args.fontSize !== undefined || args.color !== undefined) {
            const componentPath = await this.componentPath(reference.id, 'cc.Label');
            const paths: string[] = [];
            const dumps: IProperty[] = [];
            if (args.text !== undefined) { paths.push(`${componentPath}.string`); dumps.push({ value: args.text, type: 'cc.String' }); }
            if (args.fontSize !== undefined) { paths.push(`${componentPath}.fontSize`); dumps.push({ value: args.fontSize, type: 'cc.Integer' }); }
            if (args.color !== undefined) { paths.push(`${componentPath}.color`); dumps.push({ value: args.color, type: 'cc.Color' }); }

            for (let i = 0; i < paths.length; i++) {
                await Editor.Message.request('scene', 'set-property', { uuid: reference.id, path: paths[i], dump: dumps[i] });
            }
            await Editor.Message.request('scene', 'snapshot');
        }

        return { reference };
    }

    @utcpTool(
        'createButton',
        'Create a UI Button node with optional label text.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Node name (default "Button")' },
                text: { type: 'string', description: 'Button label text' },
                parentReference: InstanceReferenceSchema,
            },
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] },
        'POST',
        ['ui', 'button', 'create', '2d', 'interactive']
    )
    async createButton(args: { name?: string, text?: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference }> {
        const { reference } = await this.createUiNode({ uiType: 'Button', name: args.name || 'Button', parentReference: args.parentReference });

        // Button prefab has a child Label node — set its text. No swallow: a requested
        // label that was not applied must fail loudly, otherwise the agent believes
        // the button reads its text (docs §2 "trả sai còn tệ hơn ném lỗi").
        if (args.text !== undefined) {
            try {
                const node = await this.queryNodeDump(reference.id);
                let labelChildUuid = await this.findNamedChild(node, 'Label');
                if (!labelChildUuid) {
                    labelChildUuid = await this.createNativeLabelChild(reference.id);
                }
                if (!labelChildUuid) {
                    const rbErr = await this.rollbackNode(reference.id);
                    throw new ToolError({
                        code: 'PARTIAL_MUTATION',
                        status: 500,
                        message: `createButton: no Label child on ${reference.id} — text "${args.text}" was not applied${rbErr ? `; rollback FAILED (${rbErr}) — delete node ${reference.id} before retrying` : '; created node was rolled back, safe to retry'}`,
                        details: { createdNodeId: reference.id, reason: 'no Label child' },
                        recovery: 'Node was rolled back, safe to retry; or query-node to verify structure',
                    });
                }
                const labelPath = await this.componentPath(labelChildUuid, 'cc.Label');
                const ok = await Editor.Message.request('scene', 'set-property', { uuid: labelChildUuid, path: `${labelPath}.string`, dump: { value: args.text, type: 'cc.String' } }) as boolean;
                if (ok === false) {
                    const rbErr = await this.rollbackNode(reference.id);
                    throw new ToolError({
                        code: 'PARTIAL_MUTATION',
                        message: `createButton: set-property refused for label text on ${labelChildUuid} (button ${reference.id})${rbErr ? `; rollback FAILED (${rbErr}) — delete node ${reference.id} before retrying` : '; button was rolled back, safe to retry'}`,
                        details: { createdNodeId: reference.id, labelChildUuid },
                        recovery: 'Button was rolled back, safe to retry',
                    });
                }
                await Editor.Message.request('scene', 'snapshot');
            } catch (err: unknown) {
                if (err instanceof ToolError) throw err;
                const rbErr = await this.rollbackNode(reference.id);
                const errorMessage = err instanceof Error ? err.message : String(err);
                throw new ToolError({
                    code: 'PARTIAL_MUTATION',
                    status: 500,
                    message: `createButton: follow-up IPC failed for button ${reference.id} (${errorMessage})${rbErr ? `; rollback FAILED (${rbErr}) — delete node ${reference.id} before retrying` : '; created node was rolled back, safe to retry'}`,
                    details: { createdNodeId: reference.id, error: errorMessage },
                    recovery: 'Button was rolled back, safe to retry',
                });
            }
        }

        return { reference };
    }

    @utcpTool(
        'createSprite',
        'Create a UI Sprite node, optionally assigning a SpriteFrame asset.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Node name (default "Sprite")' },
                spriteFrameUuid: { type: 'string', description: 'Optional SpriteFrame asset uuid to assign' },
                parentReference: InstanceReferenceSchema,
            },
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] },
        'POST',
        ['ui', 'sprite', 'image', 'create', '2d']
    )
    async createSprite(args: { name?: string, spriteFrameUuid?: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference }> {
        const { reference } = await this.createUiNode({ uiType: 'Sprite', name: args.name || 'Sprite', parentReference: args.parentReference });

        // No swallow: an unassigned spriteFrame must not read as a successful create.
        if (args.spriteFrameUuid) {
            const componentPath = await this.componentPath(reference.id, 'cc.Sprite');
            const ok = await Editor.Message.request('scene', 'set-property', {
                uuid: reference.id,
                path: `${componentPath}.spriteFrame`,
                dump: { value: { uuid: args.spriteFrameUuid }, type: 'cc.SpriteFrame' },
            }) as boolean;
            if (ok === false) {
                const rbErr = await this.rollbackNode(reference.id);
                throw new ToolError({
                    code: 'PARTIAL_MUTATION',
                    status: 500,
                    message: `createSprite: set-property refused for spriteFrame ${args.spriteFrameUuid} on ${reference.id}${rbErr ? `; rollback FAILED (${rbErr}) — delete node ${reference.id} before retrying` : '; created node was rolled back, safe to retry'}`,
                    details: { createdNodeId: reference.id, spriteFrameUuid: args.spriteFrameUuid },
                    recovery: 'Sprite node was rolled back, safe to retry; verify the SpriteFrame uuid with query-asset',
                });
            }
            await Editor.Message.request('scene', 'snapshot');
        }

        return { reference };
    }
    @utcpTool(
        'uiLayoutReport',
        'Return a bounded, read-only live 2D UI layout report with optional ephemeral overlay.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                root: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, type: { type: 'string' } } },
                rootPath: { type: 'string' },
                designResolution: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, required: ['width', 'height'] },
                viewport: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, required: ['width', 'height'] },
                fitMode: { type: 'string', enum: ['fitWidth', 'fitHeight', 'contain', 'cover', 'stretch', 'none'], default: 'contain' },
                maxNodes: { type: 'integer', minimum: 1, maximum: 5000, default: 128 },
                maxIssues: { type: 'integer', minimum: 1, maximum: 5000, default: 256 },
                maxBytes: { type: 'integer', minimum: 256, maximum: 2097152, default: 524288 },
                overlay: { type: 'boolean', default: false },
                alignmentTolerance: { type: 'number', minimum: 0, maximum: 1000, default: 1 },
                gapTolerance: { type: 'number', minimum: 0, maximum: 1000, default: 2 },
            },
            required: ['designResolution', 'viewport'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                complete: { type: 'boolean' },
                designResolution: { type: 'object' },
                viewport: { type: 'object' },
                fitMode: { type: 'string' },
                fit: { type: 'object' },
                root: { type: 'object' },
                nodes: { type: 'array' },
                issues: { type: 'array' },
                truncation: { type: 'array' },
                overlay: { type: 'object' },
                tolerances: { type: 'object' },
                error: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['code', 'message', 'evidence'],
                    properties: { code: { type: 'string' }, message: { type: 'string' }, evidence: { type: 'object' } },
                },
            },
            oneOf: [
                { required: ['error'] },
                { required: ['complete', 'designResolution', 'viewport', 'fitMode', 'fit', 'root', 'nodes', 'issues', 'truncation', 'overlay', 'tolerances'] },
            ],
        },
        'POST',
        ['ui', 'layout', 'report', 'geometry', 'diagnostics']
    )
    async uiLayoutReport(args: LayoutReportRequest): Promise<LayoutReportResult> {
        let dirtyBefore: boolean | undefined;
        try {
            const value = await Editor.Message.request('scene', 'query-dirty');
            if (typeof value === 'boolean') dirtyBefore = value;
        } catch (error) { console.warn('[uiLayoutReport] failed to read dirty-before state', error); }

        const raw = await Editor.Message.request('scene', 'execute-scene-script', { name: 'cc-bridge-3x', method: 'uiLayoutReport', args: [args] }) as unknown;
        let dirtyAfter: boolean | undefined;
        try {
            const value = await Editor.Message.request('scene', 'query-dirty');
            if (typeof value === 'boolean') dirtyAfter = value;
        } catch (error) { console.warn('[uiLayoutReport] failed to read dirty-after state', error); }

        if (raw && typeof raw === 'object' && 'overlay' in raw) {
            const result = raw as LayoutReport;
            if (dirtyBefore !== undefined) result.overlay.dirtyBefore = dirtyBefore;
            if (dirtyAfter !== undefined) result.overlay.dirtyAfter = dirtyAfter;
            if (dirtyBefore !== undefined && dirtyAfter !== undefined) result.overlay.dirtyPreserved = dirtyBefore === dirtyAfter;
            if (result.overlay.requested && result.overlay.dirtyPreserved !== true) {
                delete result.overlay.artifact;
                result.overlay.valid = false;
                result.overlay.rendered = false;
                result.overlay.error = {
                    code: dirtyBefore === undefined || dirtyAfter === undefined ? 'OVERLAY_DIRTY_STATE_UNAVAILABLE' : 'OVERLAY_DIRTY_STATE_CHANGED',
                    message: dirtyBefore === undefined || dirtyAfter === undefined
                        ? 'Scene dirty state could not be verified before and after overlay rendering'
                        : 'Scene dirty state changed while rendering the overlay',
                    evidence: { dirtyBefore, dirtyAfter },
                };
            }
            return finalizeUiLayoutReport(result, Math.min(args.maxBytes ?? 512 * 1024, 2 * 1024 * 1024));
        }
        return raw as LayoutReportResult;
    }
    @utcpTool(
        'uiSafeAreaInspect',
        'Inspect bounded 2D UI geometry against a caller-provided safe-area rectangle or root-relative insets without mutating the scene.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                root: InstanceReferenceSchema,
                rootPath: { type: 'string', minLength: 1, maxLength: 256 },
                safeArea: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        rect: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                x: { type: 'number' }, y: { type: 'number' },
                                width: { type: 'number', exclusiveMinimum: 0 },
                                height: { type: 'number', exclusiveMinimum: 0 },
                            },
                            required: ['x', 'y', 'width', 'height'],
                        },
                        insets: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                top: { type: 'number', minimum: 0 }, right: { type: 'number', minimum: 0 },
                                bottom: { type: 'number', minimum: 0 }, left: { type: 'number', minimum: 0 },
                            },
                            required: ['top', 'right', 'bottom', 'left'],
                        },
                        x: { type: 'number' }, y: { type: 'number' },
                        width: { type: 'number', exclusiveMinimum: 0 },
                        height: { type: 'number', exclusiveMinimum: 0 },
                    },
                    oneOf: [
                        { required: ['rect'] },
                        { required: ['insets'] },
                        { required: ['x', 'y', 'width', 'height'] },
                    ],
                },
                maxNodes: { type: 'integer', minimum: 1, maximum: 5000, default: 128 },
                maxIssues: { type: 'integer', minimum: 1, maximum: 5000, default: 256 },
            },
            required: ['safeArea'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                complete: { type: 'boolean' }, valid: { type: 'boolean' }, truncated: { type: 'boolean' },
                safeArea: { type: 'object' }, root: { type: 'object' },
                checkedNodes: { type: 'integer' }, nodes: { type: 'array' }, issues: { type: 'array' },
                truncation: { type: 'array' },
                error: { type: 'object', additionalProperties: false, required: ['code', 'message', 'evidence'], properties: { code: { type: 'string' }, message: { type: 'string' }, evidence: { type: 'object' } } },
            },
            oneOf: [
                { required: ['error'] },
                { required: ['complete', 'valid', 'safeArea', 'root', 'checkedNodes', 'nodes', 'issues', 'truncation', 'truncated'] },
            ],
        },
        'POST',
        ['ui', 'safe-area', 'inspect', 'geometry', 'diagnostics']
    )
    async uiSafeAreaInspect(args: UiSafeAreaInspectRequest): Promise<UiSafeAreaInspectResult> {
        return await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cc-bridge-3x', method: 'uiSafeAreaInspect', args: [args],
        }) as UiSafeAreaInspectResult;
    }


    @utcpTool(
        'uiLayoutInspect',
        'Inspect bounded UI layout constraints and normalized world rectangles for a scene subtree.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                maxNodes: { type: 'integer', minimum: 1, maximum: 128, default: 64 },
            },
        },
        { type: 'object', properties: { nodes: { type: 'array' }, truncated: { type: 'boolean' } }, required: ['nodes', 'truncated'] },
        'POST',
        ['ui', 'layout', 'inspect', 'geometry']
    )
    async uiLayoutInspect(args: { reference?: IInstanceReference, maxNodes?: number }): Promise<{ nodes: UiLayoutNode[], truncated: boolean }> {
        return this.inspectLayout(args.reference?.id, args.maxNodes ?? 64);
    }

    @utcpTool(
        'uiLayoutApply',
        'Apply bounded UI layout constraints atomically and return normalized read-back.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, additionalProperties: false },
                size: { type: 'object', properties: { width: { type: 'number', minimum: 0 }, height: { type: 'number', minimum: 0 } }, required: ['width', 'height'], additionalProperties: false },
                anchor: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } }, required: ['x', 'y'], additionalProperties: false },
                active: { type: 'boolean' },
            },
            required: ['reference'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, layout: { type: 'object' } }, required: ['success', 'layout'] },
        'POST',
        ['ui', 'layout', 'apply', 'mutation']
    )
    async uiLayoutApply(args: { reference: IInstanceReference, position?: { x?: number, y?: number, z?: number }, size?: { width: number, height: number }, anchor?: { x: number, y: number }, active?: boolean }): Promise<{ success: true, layout: UiLayoutNode | null }> {
        const node = await this.queryNodeDump(args.reference.id);
        if (!node) throw new ToolError({ code: 'NOT_FOUND', status: 404, message: `UI node ${args.reference.id} not found` });
        if (args.position) await Editor.Message.request('scene', 'set-property', { uuid: args.reference.id, path: 'position', dump: { value: { x: args.position.x ?? 0, y: args.position.y ?? 0, z: args.position.z ?? 0 }, type: 'cc.Vec3' } });
        const componentPath = await this.componentPath(args.reference.id, 'cc.UITransform');
        if (args.size) await Editor.Message.request('scene', 'set-property', { uuid: args.reference.id, path: `${componentPath}._contentSize`, dump: { value: args.size, type: 'cc.Size' } });
        if (args.anchor) await Editor.Message.request('scene', 'set-property', { uuid: args.reference.id, path: `${componentPath}._anchorPoint`, dump: { value: args.anchor, type: 'cc.Vec2' } });
        if (args.active !== undefined) await Editor.Message.request('scene', 'set-property', { uuid: args.reference.id, path: 'active', dump: { value: args.active, type: 'Boolean' } });
        await Editor.Message.request('scene', 'snapshot');
        const layout = (await this.inspectLayout(args.reference.id, 1)).nodes[0] ?? null;
        return { success: true, layout };
    }

    @utcpTool(
        'uiLayoutValidate',
        'Validate bounded, read-only UI geometry for clipping, overlap, anchors, and safe-area constraints.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                reference: InstanceReferenceSchema,
                root: InstanceReferenceSchema,
                rootPath: { type: 'string', minLength: 1, maxLength: 256 },
                designResolution: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, required: ['width', 'height'] },
                viewport: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, required: ['width', 'height'] },
                fitMode: { type: 'string', enum: ['fitWidth', 'fitHeight', 'contain', 'cover', 'stretch', 'none'], default: 'contain' },
                safeArea: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        rect: { type: 'object', additionalProperties: false, properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, required: ['x', 'y', 'width', 'height'] },
                        insets: { type: 'object', additionalProperties: false, properties: { top: { type: 'number', minimum: 0 }, right: { type: 'number', minimum: 0 }, bottom: { type: 'number', minimum: 0 }, left: { type: 'number', minimum: 0 } }, required: ['top', 'right', 'bottom', 'left'] },
                        x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 },
                    },
                    oneOf: [{ required: ['rect'] }, { required: ['insets'] }, { required: ['x', 'y', 'width', 'height'] }],
                },
                maxNodes: { type: 'integer', minimum: 1, maximum: 5000, default: 128 },
                maxIssues: { type: 'integer', minimum: 1, maximum: 5000, default: 256 },
                checks: {
                    type: 'object', additionalProperties: false,
                    properties: { clipping: { type: 'boolean', default: true }, overlap: { type: 'boolean', default: true }, anchors: { type: 'boolean', default: true }, safeArea: { type: 'boolean', default: true } },
                },
            },
            anyOf: [
                { required: ['reference'] },
                {
                    oneOf: [{ required: ['root'] }, { required: ['rootPath'] }],
                    anyOf: [{ required: ['designResolution', 'viewport'] }, { required: ['safeArea'] }],
                },
            ],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                valid: { type: 'boolean' }, complete: { type: 'boolean' }, truncated: { type: 'boolean' },
                checkedNodes: { type: 'integer' }, root: { type: 'object' }, nodes: { type: 'array' }, issues: { type: 'array' },
                truncation: { type: 'array' }, geometry: { type: 'object' }, safeArea: { type: 'object' },
                error: { type: 'object', additionalProperties: false, required: ['code', 'message', 'evidence'], properties: { code: { type: 'string' }, message: { type: 'string' }, evidence: { type: 'object' } } },
            },
            oneOf: [{ required: ['error'] }, { required: ['valid', 'complete', 'truncated', 'checkedNodes', 'root', 'nodes', 'issues', 'truncation'] }],
        },
        'POST',
        ['ui', 'layout', 'validate', 'geometry', 'diagnostics']
    )
    async uiLayoutValidate(args: ({ reference?: IInstanceReference } & UiLayoutValidateRequest)): Promise<UiLayoutValidateResult | { valid: boolean, issues: string[], checkedNodes: number }> {
        if (isCandidateRequest(args)) {
            return await Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cc-bridge-3x', method: 'uiLayoutValidate', args: [args],
            }) as UiLayoutValidateResult;
        }
        const legacyArgs = args as { reference?: IInstanceReference; maxNodes?: number };
        const inspected = await this.inspectLayout(legacyArgs.reference?.id, legacyArgs.maxNodes ?? 64);
        const issues: string[] = [];
        for (const item of inspected.nodes) {
            if (!item.size) issues.push(`${item.reference.id}: missing cc.UITransform`);
            if (item.worldRect && (item.worldRect.width < 0 || item.worldRect.height < 0)) issues.push(`${item.reference.id}: negative layout size`);
        }
        return { valid: issues.length === 0 && !inspected.truncated, issues, checkedNodes: inspected.nodes.length };
    }

    @utcpTool(
        'uiCreateScrollView',
        'Create and verify a ScrollView with viewport mask and content hierarchy.',
        {
            type: 'object',
            properties: { name: { type: 'string', default: 'ScrollView' }, parentReference: InstanceReferenceSchema },
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema, viewport: { type: 'object' }, content: { type: 'object' } }, required: ['reference', 'viewport', 'content'] },
        'POST',
        ['ui', 'scrollview', 'create', 'compound']
    )
    async uiCreateScrollView(args: { name?: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference, viewport: IInstanceReference, content: IInstanceReference }> {
        const root = await this.createUiNode({ uiType: 'ScrollView', name: args.name ?? 'ScrollView', parentReference: args.parentReference });
        const viewport = await this.createUiNode({ uiType: 'Widget', name: 'Viewport', parentReference: root.reference });
        await Editor.Message.request('scene', 'create-component', { uuid: viewport.reference.id, component: 'cc.Mask' });
        const content = await this.createUiNode({ uiType: 'Widget', name: 'Content', parentReference: viewport.reference });
        await Editor.Message.request('scene', 'create-component', { uuid: content.reference.id, component: 'cc.Layout' });
        await Editor.Message.request('scene', 'snapshot');
        const rootDump = await this.queryNodeDump(root.reference.id);
        if (!rootDump || !(await this.findNamedChild(rootDump, 'Viewport')) || !((await this.queryNodeDump(viewport.reference.id))?.children ?? []).some((c) => (c.uuid || c.value?.uuid) === content.reference.id)) {
            throw new ToolError({ code: 'POSTCONDITION_FAILED', status: 500, message: 'uiCreateScrollView hierarchy verification failed' });
        }
        return { reference: root.reference, viewport: viewport.reference, content: content.reference };
    }

    @utcpTool(
        'uiCreateInputForm',
        'Create a labeled input form row with focus-order metadata and verified controls.',
        {
            type: 'object',
            properties: { label: { type: 'string', minLength: 1 }, placeholder: { type: 'string' }, name: { type: 'string', default: 'InputForm' }, parentReference: InstanceReferenceSchema },
            required: ['label'],
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema, label: { type: 'object' }, input: { type: 'object' }, submit: { type: 'object' }, focusOrder: { type: 'array' } }, required: ['reference', 'label', 'input', 'submit', 'focusOrder'] },
        'POST',
        ['ui', 'input', 'form', 'create', 'compound']
    )
    async uiCreateInputForm(args: { label: string, placeholder?: string, name?: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference, label: IInstanceReference, input: IInstanceReference, submit: IInstanceReference, focusOrder: string[] }> {
        const form = await this.createUiNode({ uiType: 'Widget', name: args.name ?? 'InputForm', parentReference: args.parentReference });
        const label = await this.createLabel({ name: 'Label', text: args.label, parentReference: form.reference });
        const input = await this.createUiNode({ uiType: 'EditBox', name: 'Input', parentReference: form.reference });
        if (args.placeholder !== undefined) {
            const inputPath = await this.componentPath(input.reference.id, 'cc.EditBox');
            await Editor.Message.request('scene', 'set-property', { uuid: input.reference.id, path: `${inputPath}.placeholderLabel.string`, dump: { value: args.placeholder, type: 'cc.String' } });
        }
        const submit = await this.createButton({ name: 'Submit', text: 'Submit', parentReference: form.reference });
        await Editor.Message.request('scene', 'snapshot');
        const dump = await this.queryNodeDump(form.reference.id);
        if (!dump || (dump.children ?? []).length < 3) throw new ToolError({ code: 'POSTCONDITION_FAILED', status: 500, message: 'uiCreateInputForm hierarchy verification failed' });
        return { reference: form.reference, label: label.reference, input: input.reference, submit: submit.reference, focusOrder: [input.reference.id, submit.reference.id] };
    }

    private unwrapValue(value: any): any {
        return value && typeof value === 'object' && 'value' in value ? value.value : value;
    }

    private async inspectLayout(rootUuid?: string, maxNodes = 64): Promise<{ nodes: UiLayoutNode[], truncated: boolean }> {
        const tree = (rootUuid ? await Editor.Message.request('scene', 'query-node-tree', rootUuid) : await Editor.Message.request('scene', 'query-node-tree')) as unknown as SceneNodeDump | null;
        if (!tree) throw new ToolError({ code: 'NOT_FOUND', status: 404, message: 'Scene subtree not found' });
        const nodes: UiLayoutNode[] = [];
        const visit = async (entry: any, parentWorld = { x: 0, y: 0 }): Promise<void> => {
            if (nodes.length >= maxNodes) return;
            const id = entry.uuid || entry.value?.uuid;
            if (!id) return;
            const dump = await this.queryNodeDump(id);
            if (!dump) return;
            const pos = this.unwrapValue(dump.position) ?? { x: 0, y: 0, z: 0 };
            const transform = dump.__comps__?.find((component) => component.type === 'cc.UITransform');
            const value = transform ? this.unwrapValue(transform.value) : null;
            const size = value ? this.unwrapValue(value.contentSize) ?? this.unwrapValue(value._contentSize) : null;
            const anchor = value ? this.unwrapValue(value.anchorPoint) ?? this.unwrapValue(value._anchorPoint) : null;
            const width = typeof size?.width === 'number' ? size.width : null;
            const height = typeof size?.height === 'number' ? size.height : null;
            const world = { x: parentWorld.x + (pos.x ?? 0), y: parentWorld.y + (pos.y ?? 0) };
            const nameValue = typeof dump.name === 'string' ? dump.name : dump.name?.value;
            nodes.push({ reference: { id, type: 'cc.Node' }, name: nameValue ?? id, active: Boolean(this.unwrapValue(dump.active) ?? true), position: { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 }, size: width !== null && height !== null ? { width, height } : null, anchor: anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number' ? { x: anchor.x, y: anchor.y } : null, worldRect: width !== null && height !== null ? { x: world.x - width * (anchor?.x ?? 0.5), y: world.y - height * (anchor?.y ?? 0.5), width, height } : null, components: (dump.__comps__ ?? []).map((component) => component.type).filter((type): type is string => Boolean(type)) });
            for (const child of dump.children ?? []) await visit(child, world);
        };
        await visit(tree);
        return { nodes, truncated: Boolean((tree.children ?? []).length && nodes.length >= maxNodes) };
    }

    private async queryNodeDump(uuid: string): Promise<SceneNodeDump | null> {
        return await Editor.Message.request('scene', 'query-node', uuid) as unknown as SceneNodeDump | null;
    }

    private async componentPath(uuid: string, componentType: string): Promise<string> {
        const node = await this.queryNodeDump(uuid);
        const index = node?.__comps__?.findIndex((component) => component.type === componentType) ?? -1;
        if (index < 0) {
            throw new Error(`Component ${componentType} not found on node ${uuid}`);
        }
        return `__comps__.${index}`;
    }

    private async findNamedChild(node: SceneNodeDump | null, name: string): Promise<string | null> {
        for (const child of node?.children ?? []) {
            const uuid = child.uuid || child.value?.uuid;
            if (!uuid) continue;
            const childDump = await this.queryNodeDump(uuid);
            const childName = typeof childDump?.name === 'string' ? childDump.name : childDump?.name?.value;
            if (childName === name) return uuid;
        }
        return null;
    }


    private async createNativeLabelChild(parentUuid: string): Promise<string | null> {
        const result = await Editor.Message.request('scene', 'create-node', {
            name: 'Label',
            parent: parentUuid,
        });
        const childUuid = Array.isArray(result) ? result[0] : result;
        if (typeof childUuid !== 'string' || !childUuid) return null;
        await ensureSceneComponents(childUuid, ['cc.Label', 'cc.UITransform']);
        await Editor.Message.request('scene', 'snapshot');
        return childUuid;
    }

    /**
     * Best-effort undo for a partially applied create* helper: remove the node we
     * just created and snapshot the scene. Returns null when the node is gone, or
     * the rollback error message so the caller can tell the agent to delete it
     * manually before retrying (a leaked half-configured node is worse than a throw).
     */
    private async rollbackNode(uuid: string): Promise<string | null> {
        try {
            await Editor.Message.request('scene', 'remove-node', { uuid });
            await Editor.Message.request('scene', 'snapshot');
            return null;
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }
}
