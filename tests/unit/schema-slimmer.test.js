'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

function loadSlimmer() {
    try {
        return requireDist('utcp/utils/schema-slimmer.js');
    } catch (error) {
        assert.fail(`Output schema slimmer must exist: ${error instanceof Error ? error.message : String(error)}`);
    }
}

describe('slimOutputsSchema', () => {
    it('keeps top-level output keys and constraints without nested metadata', () => {
        const { slimOutputsSchema } = loadSlimmer();
        const input = {
            type: 'object',
            description: 'Detailed response schema',
            properties: {
                entries: {
                    type: 'array',
                    description: 'Returned entries',
                    items: {
                        type: 'object',
                        properties: { uuid: { type: 'string', description: 'Stable id' } },
                    },
                },
                status: { type: 'string', enum: ['ok', 'error'], description: 'Result status' },
            },
            required: ['entries'],
        };

        assert.deepEqual(slimOutputsSchema(input), {
            type: 'object',
            properties: {
                entries: { type: 'array' },
                status: { type: 'string', enum: ['ok', 'error'] },
            },
            required: ['entries'],
        });
        assert.equal(input.properties.entries.items.properties.uuid.description, 'Stable id');
    });
});
