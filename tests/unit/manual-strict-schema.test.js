'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
require('@utcp/http');

// Profile metadata must remain outside the SDK's strict public manual.
describe('manual strict schema', () => {
  it('serves SDK-valid manuals for every profile without profile metadata', async () => {
    const { UtcpServerManager, setServerProfile } = requireDist('utcp/utcp-server.js');
    const { UtcpManualSchema } = require('@utcp/sdk');
    const server = new UtcpServerManager();
    try {
      const port = await server.start();
      for (const profile of ['core', 'full', 'custom']) {
        setServerProfile(profile);
        const response = await fetch(`http://127.0.0.1:${port}/utcp`);
        assert.equal(response.status, 200);
        const manual = await response.json();
        const parsed = UtcpManualSchema.safeParse(manual);
        assert.equal(parsed.success, true, parsed.success ? undefined : parsed.error.message);
        for (const tool of manual.tools) {
          assert.equal(Object.hasOwn(tool, 'annotations'), false);
          assert.equal(Object.hasOwn(tool, 'profile'), false);
        }
      }
    } finally {
      await server.stop();
      setServerProfile('full');
    }
  });

  it('outputs are slimmed while retaining their public type contract', () => {
    const { slimOutputsSchema } = requireDist('utcp/utils/schema-slimmer.js');
    const slimmed = slimOutputsSchema({
      type: 'object',
      properties: {
        reference: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], description: 'drop' },
        name: { type: 'string', description: 'drop' },
        children: { type: 'array', items: { type: 'object' }, description: 'drop' },
      },
      required: ['reference', 'name'],
    });
    assert.deepEqual(Object.keys(slimmed.properties).sort(), ['children', 'name', 'reference']);
    assert.deepEqual(slimmed.properties.reference, { type: 'object' });
    assert.deepEqual(slimmed.properties.name, { type: 'string' });
    assert.equal(slimmed.properties.reference.description, undefined);
  });
});
