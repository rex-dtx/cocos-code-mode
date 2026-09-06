import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';
import { ToolError } from '../tool-error';

export class PropertyArrayTools {

    @utcpTool(
        'propertyArrayElement',
        'Remove or reorder an array property element by index on a node or component. 2.4 has no native array IPC — mutates the live array in scene-script.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['remove', 'move'] },
                uuid: { type: 'string', description: 'Node or component uuid' },
                propertyPath: { type: 'string', description: 'Array property path, e.g. clickEvents, sharedMaterials' },
                index: { type: 'number', description: 'Index to remove or move (0-based)' },
                toIndex: { type: 'number', description: 'For move: destination index (0-based)' },
                compType: { type: 'string', description: 'If uuid is a node, operate on this component type' },
            },
            required: ['operation', 'uuid', 'propertyPath', 'index'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, length: { type: 'number' } }, required: ['success'] },
        'POST',
        ['property', 'array', 'element', 'remove', 'delete', 'move', 'reorder', 'index', 'list']
    )
    async propertyArrayElement(args: { operation: string, uuid: string, propertyPath: string, index: number, toIndex?: number, compType?: string }): Promise<{ success: boolean, length: number }> {
        const index = Number(args.index);
        if (!Number.isInteger(index) || index < 0) {
            throw new ToolError({
                code: 'INVALID_INPUT',
                status: 400,
                message: 'propertyArrayElement requires a non-negative integer index',
                recovery: 'Pass index >= 0.',
            });
        }
        if (args.operation === 'move') {
            const toIndex = Number(args.toIndex);
            if (!Number.isInteger(toIndex) || toIndex < 0) {
                throw new ToolError({
                    code: 'MISSING_INPUTS',
                    status: 400,
                    message: 'move requires a non-negative integer toIndex',
                    recovery: 'Pass toIndex >= 0.',
                });
            }
        }
        const result = await sceneScript<any>('array-element', {
            operation: args.operation,
            uuid: args.uuid,
            propertyPath: args.propertyPath,
            index,
            toIndex: args.toIndex == null ? undefined : Number(args.toIndex),
            compType: args.compType || '',
        });
        if (!result || result.success !== true) {
            throw new ToolError({
                code: 'ARRAY_OP_FAILED',
                status: 422,
                message: `Failed to ${args.operation} element ${index} of "${args.propertyPath}" on ${args.uuid}`,
                recovery: 'Check that the path is an array and the index is in range.',
            });
        }
        return { success: true, length: result.length };
    }
}
