import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, ISuccessIndicator, SuccessIndicatorSchema } from '../schemas';
import { SetPropertyTool } from './set-properties-tool';
import { invalidateAfterWrite } from '../utils/memo-cache';

const MAX_BATCH_SET_ENTRIES = 100;
const MAX_BATCH_PROPERTIES = 100;

function validateBatchEntry(entry: unknown, index: number): void {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`nodeBatchSet entry ${index + 1} must be an object`);
    }

    const candidate = entry as { reference?: unknown, propertyPaths?: unknown, values?: unknown };
    const reference = candidate.reference as { id?: unknown } | undefined;
    if (!reference || typeof reference.id !== 'string' || !reference.id) {
        throw new Error(`nodeBatchSet entry ${index + 1} requires reference.id`);
    }
    if (!Array.isArray(candidate.propertyPaths) || candidate.propertyPaths.length === 0 || candidate.propertyPaths.length > MAX_BATCH_PROPERTIES) {
        throw new Error(`nodeBatchSet entry ${index + 1} propertyPaths must contain 1-${MAX_BATCH_PROPERTIES} items`);
    }
    if (!candidate.propertyPaths.every((path) => typeof path === 'string' && path.length > 0)) {
        throw new Error(`nodeBatchSet entry ${index + 1} propertyPaths must contain non-empty strings`);
    }
    if (!Array.isArray(candidate.values) || candidate.values.length === 0 || candidate.values.length > MAX_BATCH_PROPERTIES) {
        throw new Error(`nodeBatchSet entry ${index + 1} values must contain 1-${MAX_BATCH_PROPERTIES} items`);
    }
    if (candidate.propertyPaths.length !== candidate.values.length) {
        throw new Error(`nodeBatchSet entry ${index + 1} propertyPaths and values must have equal lengths`);
    }
}

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
                    minItems: 1,
                    maxItems: MAX_BATCH_SET_ENTRIES,
                    items: {
                        type: 'object',
                        properties: {
                            reference: InstanceReferenceSchema,
                            propertyPaths: { type: 'array', minItems: 1, maxItems: MAX_BATCH_PROPERTIES, items: { type: 'string', minLength: 1 } },
                            values: { type: 'array', minItems: 1, maxItems: MAX_BATCH_PROPERTIES, items: {} },
                        },
                        required: ['reference', 'propertyPaths', 'values'],
                    },
                    description: `Array of 1-${MAX_BATCH_SET_ENTRIES} { reference, propertyPaths[], values[] } entries; each property array is capped at ${MAX_BATCH_PROPERTIES}`,
                },
            },
            required: ['entries'],
        },
        SuccessIndicatorSchema,
        'POST',
        ['batch', 'multi', 'set', 'property', 'bulk', 'node']
    )
    async nodeBatchSet(args: { entries: Array<{ reference: IInstanceReference, propertyPaths: string[], values: any[] }> }): Promise<ISuccessIndicator> {
        if (!args.entries || !Array.isArray(args.entries) || args.entries.length === 0 || args.entries.length > MAX_BATCH_SET_ENTRIES) {
            throw new Error(`nodeBatchSet requires 1-${MAX_BATCH_SET_ENTRIES} entries`);
        }
        args.entries.forEach((entry, index) => validateBatchEntry(entry, index));

        const setTool = new (SetPropertyTool as any)();
        let successCount = 0;
        const errors: string[] = [];

        for (const [index, entry] of args.entries.entries()) {
            try {
                await setTool.setInstanceProperties({
                    reference: entry.reference,
                    propertyPaths: entry.propertyPaths,
                    values: entry.values,
                });
                successCount++;
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                errors.push(`entry ${index + 1}: ${message}`);
            }
        }

        // Single snapshot for the whole batch
        await Editor.Message.request('scene', 'snapshot');
        invalidateAfterWrite();

        if (errors.length > 0 && successCount === 0) {
            throw new Error(`All entries failed: ${errors.join('; ')}`);
        }

        return { success: true };
    }
}
