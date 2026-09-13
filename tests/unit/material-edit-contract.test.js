'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { MaterialTools } = requireDist('utcp/tools/material-tools.js');

describe('materialEdit contract', () => {
  it('rejects missing references before editor mutation', async () => {
    await assert.rejects(
      () => new MaterialTools().materialEdit({ path: 'passes.0.properties.roughness', value: 0.5 }),
      error => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
  });

  it('rejects unsafe property paths before editor mutation', async () => {
    await assert.rejects(
      () => new MaterialTools().materialEdit({ reference: { id: 'mat' }, path: 'passes[0].roughness', value: 0.5 }),
      error => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
  });
});
