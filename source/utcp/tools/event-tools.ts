// Event simulation — fire or attach handlers on cc.Button via the live scene.
// Delegates to scene.ts helpers; the scene panel is the only context where the
// runtime node graph + EventHandler are live.
import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';

const EVENT_PACKAGE = 'cc-bridge-3x';

async function ensureRuntimeNode(id: string): Promise<void> {
    const exists = await Editor.Message.request('scene', 'query-node', id);
    if (exists === null || exists === undefined) {
        throw new Error(`Node ${id} not found in editor scene`);
    }
}

export class EventTools {

    @utcpTool(
        'simulateButtonClick',
        'Simulate a button click: finds cc.Button on the runtime node and fires its clickEvents (same path the UI uses).',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
            },
            required: ['reference'],
        },
        {
            type: 'object',
            properties: {
                handlersFired: { type: 'number' },
                method: { type: 'string' },
            },
            required: ['handlersFired'],
        },
        'POST',
        ['event', 'button', 'click', 'simulate', 'input', 'interact']
    )
    async simulateButtonClick(args: { reference: IInstanceReference }): Promise<{ handlersFired: number, method: string }> {
        if (!args.reference?.id) throw new Error('simulateButtonClick requires reference.id (node uuid with cc.Button)');
        await ensureRuntimeNode(args.reference.id);
        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: EVENT_PACKAGE, method: 'simulateButtonClick', args: [args.reference.id],
        }) as { handlersFired: number, method: string };
        return { handlersFired: result?.handlersFired ?? 0, method: result?.method ?? 'clickEvents' };
    }

    @utcpTool(
        'bindButtonClickEvent',
        'Attach a cc.EventHandler to a Button: on click, calls componentType.handlerName on the same node (or its children).',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                componentType: { type: 'string', description: 'Target component type, e.g. "WheelController" or "cc.Component"' },
                handlerName:   { type: 'string', description: 'Method name on that component' },
                customEventData: { type: 'string', description: 'Optional customEventData forwarded to the handler' },
            },
            required: ['reference', 'componentType', 'handlerName'],
        },
        {
            type: 'object',
            properties: {
                handlerCount: { type: 'number' },
            },
            required: ['handlerCount'],
        },
        'POST',
        ['event', 'button', 'bind', 'handler', 'component', 'interact']
    )
    async bindButtonClickEvent(args: {
        reference: IInstanceReference, componentType: string, handlerName: string, customEventData?: string
    }): Promise<{ handlerCount: number }> {
        if (!args.reference?.id) throw new Error('bindButtonClickEvent requires reference.id');
        if (!args.componentType?.trim()) throw new Error('componentType must be non-empty');
        if (!args.handlerName?.trim())   throw new Error('handlerName must be non-empty');
        await ensureRuntimeNode(args.reference.id);
        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: EVENT_PACKAGE, method: 'bindButtonClickEvent',
            args: [args.reference.id, args.componentType, args.handlerName, args.customEventData || ''],
        }) as { handlerCount: number };
        return { handlerCount: result?.handlerCount ?? 0 };
    }
}
