'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { MaterialTools } = requireDist('utcp/tools/material-tools.js');

describe('renderPipelineInspect', () => {
  it('returns bounded native pipeline read-back with identity', async () => {
    const previous = global.Editor;
    global.Editor = { Message: { request: async (channel, method, id) => {
      assert.equal(channel, 'scene');
      assert.equal(method, 'query-render-pipeline');
      assert.equal(id, 'pipeline-1');
      return { passes: [{ name: 'forward' }], cameras: ['Main'] };
    } } };
    try {
      const result = await new MaterialTools().renderPipelineInspect({ reference: { id: 'pipeline-1', type: 'cc.Material' } });
      assert.deepEqual(result.pipeline, { passes: [{ name: 'forward' }], cameras: ['Main'] });
      assert.equal(result.reference.id, 'pipeline-1');
      assert.equal(result.truncated, false);
      assert.ok(result.bytes > 0);
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });

  it('rejects missing targets before reporting an empty success', async () => {
    const previous = global.Editor;
    global.Editor = { Message: { request: async () => null } };
    try {
      await assert.rejects(
        () => new MaterialTools().renderPipelineInspect({ reference: { id: 'missing', type: 'cc.Material' } }),
        error => error.code === 'TARGET_NOT_FOUND' && error.status === 404,
      );
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });
});
