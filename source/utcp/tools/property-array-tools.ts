import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, ISuccessIndicator, SuccessIndicatorSchema } from '../schemas';

// Array-valued properties (children, sharedMaterials, custom @property arrays) need
// dedicated messages: set-property replaces the whole array and loses element identity.
// Signatures from scene/@types/public.d.ts: MoveArrayOptions {uuid,path,target,offset},
// RemoveArrayOptions {uuid,path,index}.

export class PropertyArrayTools {

    @utcpTool(
        'propertyArrayElement',
        'Remove or reorder one element of an array-valued property by index. Use instead of inspectorSetInstanceProperties (which replaces the whole array).',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['remove', 'move'] },
                reference: InstanceReferenceSchema,
                propertyPath: { type: 'string', description: 'Path of the array property on the target, e.g. "sharedMaterials", "children", "myClips"' },
                index: { type: 'integer', description: 'Index of the element to remove or move (0-based)' },
                toIndex: { type: 'integer', description: 'For move: destination index (0-based)' }
            },
            required: ['operation', 'reference', 'propertyPath', 'index']
        },
        SuccessIndicatorSchema, "POST", ['property', 'array', 'element', 'remove', 'delete', 'move', 'reorder', 'index', 'list']
    )
    async propertyArrayElement(args: { operation: string, reference: IInstanceReference, propertyPath: string, index: number, toIndex?: number }): Promise<ISuccessIndicator> {
        if (!args.reference || !args.reference.id) {
            throw new Error('propertyArrayElement requires reference.id (node, component or asset uuid)');
        }
        if (!args.propertyPath) {
            throw new Error('propertyArrayElement requires propertyPath');
        }
        if (typeof args.index !== 'number' || args.index < 0 || !Number.isInteger(args.index)) {
            throw new Error('propertyArrayElement requires a non-negative integer index');
        }

        let ok: boolean;
        switch (args.operation) {
            case 'remove':
                ok = await Editor.Message.request('scene', 'remove-array-element', {
                    uuid: args.reference.id,
                    path: args.propertyPath,
                    index: args.index
                });
                break;

            case 'move': {
                if (typeof args.toIndex !== 'number' || args.toIndex < 0 || !Number.isInteger(args.toIndex)) {
                    throw new Error('propertyArrayElement operation "move" requires a non-negative integer toIndex');
                }
                if (args.toIndex === args.index) {
                    return { success: true };
                }
                // move-array-element takes an offset from the current position, not a target index
                ok = await Editor.Message.request('scene', 'move-array-element', {
                    uuid: args.reference.id,
                    path: args.propertyPath,
                    target: args.index,
                    offset: args.toIndex - args.index
                });
                break;
            }

            default:
                throw new Error(`Unknown array operation: ${args.operation}`);
        }

        if (ok === false) {
            throw new Error(`Failed to ${args.operation} element ${args.index} of "${args.propertyPath}" on ${args.reference.id}. Check that the path is an array and the index is in range.`);
        }

        await Editor.Message.request('scene', 'snapshot');
        return { success: true };
    }
}
