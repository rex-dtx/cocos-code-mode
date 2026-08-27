import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, ISuccessIndicator, SuccessIndicatorSchema } from '../schemas';
import { SetPropertyTool } from './set-properties-tool';

// Multi-node batch property write — loop set-property + 1 snapshot.
// Corroborates funplay modify_nodes bulk pattern and 2x batchSetProperties gap.

export class BatchTools {

    @utcpTool(
        'nodeBatchSet',
        'Set properties on multiple nodes in one call. Each entry specifies a node reference and its property paths/values. Single snapshot at end.',
        {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            reference: InstanceReferenceSchema,
                            propertyPaths: { type: 'array', items: { type: 'string' } },
                            values: { type: 'array', items: {} },
                        },
                        required: ['reference', 'propertyPaths', 'values'],
                    },
                    description: 'Array of { reference, propertyPaths[], values[] } to set',
                },
            },
            required: ['entries'],
        },
        SuccessIndicatorSchema,
        'POST',
        ['batch', 'multi', 'set', 'property', 'bulk', 'node']
    )
    async nodeBatchSet(args: { entries: Array<{ reference: IInstanceReference, propertyPaths: string[], values: any[] }> }): Promise<ISuccessIndicator> {
        if (!args.entries || !Array.isArray(args.entries) || args.entries.length === 0) {
            throw new Error('nodeBatchSet requires non-empty entries array');
        }

        const setTool = new (SetPropertyTool as any)();
        let successCount = 0;
        const errors: string[] = [];

        for (const entry of args.entries) {
            try {
                await setTool.setInstanceProperties({
                    reference: entry.reference,
                    propertyPaths: entry.propertyPaths,
                    values: entry.values,
                });
                successCount++;
            } catch (err: any) {
                errors.push(`${entry.reference.id}: ${err.message}`);
            }
        }

        // Single snapshot for the whole batch
        await Editor.Message.request('scene', 'snapshot');

        if (errors.length > 0 && successCount === 0) {
            throw new Error(`All entries failed: ${errors.join('; ')}`);
        }

        return { success: true };
    }
}
