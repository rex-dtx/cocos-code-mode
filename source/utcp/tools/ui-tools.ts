import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { IProperty } from '@cocos/creator-types/editor/packages/scene/@types/public';

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
    __comps__?: Array<{ type?: string }>;
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

        // Prefer Creator's internal prefab when present. Creator 3.7.3 does not
        // ship the default_ui Label/Button/Sprite prefabs, so those types use a
        // native node + component fallback instead of failing after registration.
        const nativeComponent = ({
            Label: 'cc.Label',
            Button: 'cc.Button',
            Sprite: 'cc.Sprite',
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
            options.assetUuid = assetUuid;
            options.type = 'cc.Prefab';
            options.unlinkPrefab = false;
        } else if (nativeComponent) {
            const result = await Editor.Message.request('scene', 'create-node', options);
            const nodeUuid = Array.isArray(result) ? result[0] : result;
            if (typeof nodeUuid !== 'string' || !nodeUuid) {
                throw new Error(`Failed to create native ${args.uiType} node`);
            }

            for (const component of [nativeComponent, 'cc.UITransform']) {
                await Editor.Message.request('scene', 'create-component', {
                    uuid: nodeUuid,
                    component,
                });
            }

            await Editor.Message.request('scene', 'snapshot');
            return { reference: { id: nodeUuid, type: 'cc.Node' } };
        } else {
            throw new Error(`UI prefab not found at ${prefabUrl} — editor version may not include it.`);
        }

        const result = await Editor.Message.request('scene', 'create-node', options);
        const nodeUuid = Array.isArray(result) ? result[0] : result;
        if (typeof nodeUuid !== 'string' || !nodeUuid) throw new Error(`Failed to create ${args.uiType} node`);

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
    private async queryNodeDump(uuid: string): Promise<SceneNodeDump | null> {
        return await Editor.Message.request('scene', 'query-node', uuid) as SceneNodeDump | null;
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

        for (const component of ['cc.Label', 'cc.UITransform']) {
            await Editor.Message.request('scene', 'create-component', {
                uuid: childUuid,
                component,
            });
        }
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
