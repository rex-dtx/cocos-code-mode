import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';
import { ToolError } from '../tool-error';

export class EventTools {

    @utcpTool(
        'simulateButtonClick',
        'Simulate a button click: finds cc.Button on the node and fires its clickEvents.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid with cc.Button' },
            },
            required: ['uuid'],
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
    async simulateButtonClick(args: { uuid: string }): Promise<{ handlersFired: number, method: string }> {
        const result = await sceneScript<any>('simulate-button-click', args.uuid);
        if (typeof result?.handlersFired !== 'number') {
            throw new ToolError({
                code: 'BUTTON_CLICK_FAILED',
                status: 422,
                message: `simulateButtonClick: unexpected response ${JSON.stringify(result)}`,
                recovery: 'Confirm the node has cc.Button and clickEvents, then retry.',
            });
        }
        return { handlersFired: result.handlersFired, method: result.method || 'clickEvents' };
    }

    @utcpTool(
        'bindButtonClickEvent',
        'Attach a cc.Component.EventHandler to a Button: on click, calls componentType.handlerName on the same node (or a child).',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid with cc.Button' },
                componentType: { type: 'string', description: 'Target component type, e.g. GameController' },
                handlerName: { type: 'string', description: 'Method name on that component' },
                customEventData: { type: 'string', description: 'Optional customEventData forwarded to the handler' },
            },
            required: ['uuid', 'componentType', 'handlerName'],
        },
        { type: 'object', properties: { handlerCount: { type: 'number' } }, required: ['handlerCount'] },
        'POST',
        ['event', 'button', 'bind', 'handler', 'component', 'interact']
    )
    async bindButtonClickEvent(args: { uuid: string, componentType: string, handlerName: string, customEventData?: string }): Promise<{ handlerCount: number }> {
        const result = await sceneScript<any>('bind-button-click', {
            uuid: args.uuid,
            componentType: args.componentType,
            handlerName: args.handlerName,
            customEventData: args.customEventData || '',
        });
        if (typeof result?.handlerCount !== 'number' || result.handlerCount === 0) {
            throw new ToolError({
                code: 'BIND_FAILED',
                status: 422,
                message: `bindButtonClickEvent: unexpected response ${JSON.stringify(result)}`,
                recovery: 'Confirm cc.Button exists and componentType is present on the node or a child.',
            });
        }
        return { handlerCount: result.handlerCount };
    }
}
