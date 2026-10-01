'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { trimResponse } = requireDist('utcp/utils/response-trimmer.js');

it('retains required empty audit arrays while dropping optional empty payloads', () => {
  const result = trimResponse({ valid: true, nestedPrefabs: [], missingReferences: [], optional: [] }, {
    type: 'object', required: ['valid', 'nestedPrefabs', 'missingReferences'],
    properties: {
      valid: { type: 'boolean' }, nestedPrefabs: { type: 'array' },
      missingReferences: { type: 'array' }, optional: { type: 'array' },
    },
  });
  assert.deepEqual(result, { valid: true, nestedPrefabs: [], missingReferences: [] });
});
