import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';

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

        // M1: prefab uuid lookup + (if no parent) scene-root lookup are independent -> 1 round
        const [assetUuid, sceneRoot] = await Promise.all([
            Editor.Message.request('asset-db', 'query-uuid', prefabUrl),
            args.parentReference?.id ? Promise.resolve(null) : Editor.Message.request('scene', 'query-node-tree'),
        ]) as [string | null, any];
        if (!assetUuid) {
            throw new Error(`UI prefab not found at ${prefabUrl} — editor version may not include it.`);
        }

        const options: any = {
            name: args.name || args.uiType,
            assetUuid,
            type: 'cc.Prefab',
            unlinkPrefab: false,
        };

        if (args.parentReference?.id) {
            options.parent = args.parentReference.id;
        } else {
            options.parent = sceneRoot?.uuid;
        }

        const result = await Editor.Message.request('scene', 'create-node', options);
        const nodeUuid = Array.isArray(result) ? result[0] : result;
        if (!nodeUuid) throw new Error(`Failed to create ${args.uiType} node`);

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

        // Set Label component properties via property paths
        if (args.text !== undefined || args.fontSize !== undefined || args.color !== undefined) {
            const paths: string[] = [];
            const dumps: any[] = [];
            if (args.text !== undefined) { paths.push('__comps__.0.string'); dumps.push({ value: args.text, type: 'cc.String' }); }
            if (args.fontSize !== undefined) { paths.push('__comps__.0.fontSize'); dumps.push({ value: args.fontSize, type: 'cc.Integer' }); }
            if (args.color !== undefined) { paths.push('__comps__.0.color'); dumps.push({ value: args.color, type: 'cc.Color' }); }

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

        // Button prefab has a child Label node — set its text
        if (args.text !== undefined) {
            try {
                const node = await Editor.Message.request('scene', 'query-node', reference.id) as any;
                const labelChild = (node.children || []).find((c: any) => c.name === 'Label');
                if (labelChild?.uuid) {
                    await Editor.Message.request('scene', 'set-property', { uuid: labelChild.uuid, path: '__comps__.0.string', dump: { value: args.text, type: 'cc.String' } });
                }
            } catch {}
            await Editor.Message.request('scene', 'snapshot');
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

        if (args.spriteFrameUuid) {
            try {
                await Editor.Message.request('scene', 'set-property', {
                    uuid: reference.id,
                    path: '__comps__.0.spriteFrame',
                    dump: { value: { uuid: args.spriteFrameUuid }, type: 'cc.SpriteFrame' },
                });
                await Editor.Message.request('scene', 'snapshot');
            } catch {}
        }

        return { reference };
    }
}
