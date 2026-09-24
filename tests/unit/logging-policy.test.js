'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const policy = requireDist('utcp/logging-policy.js');
describe('Creator log policy', () => {
  let previousEnabled;
  let previousPolicy;

  beforeEach(() => {
    previousEnabled = policy.debugEnabled;
    previousPolicy = policy.getCreatorLogPolicy();
    policy.setDebugLogging(true);
    policy.setCreatorLogPolicy({
      tier: 'summary',
      groups: { protocol: false, read: true, behavior: true, lifecycle: true },
    });
  });

  afterEach(() => {
    policy.setDebugLogging(previousEnabled);
    policy.setCreatorLogPolicy(previousPolicy);
  });

  it('hides successful protocol summaries while keeping other groups visible', () => {
    assert.equal(policy.isCreatorLogVisible('complete', 'protocol'), false);
    assert.equal(policy.isCreatorLogVisible('complete', 'read'), true);
    assert.equal(policy.isCreatorLogVisible('complete', 'behavior'), true);
  });

  it('always exposes warnings and errors even when their group is disabled', () => {
    assert.equal(policy.isCreatorLogVisible('warning', 'protocol'), true);
    assert.equal(policy.isCreatorLogVisible('error', 'read'), true);
  });

  it('only exposes request-start traces at trace tier', () => {
    assert.equal(policy.isCreatorLogVisible('start', 'read'), false);
    policy.setCreatorLogPolicy({
      tier: 'trace',
      groups: { protocol: true, read: true, behavior: true, lifecycle: true },
    });
    assert.equal(policy.isCreatorLogVisible('start', 'read'), true);
    assert.equal(policy.isCreatorLogVisible('trace', 'protocol'), true);
  });

  it('falls back safely for malformed persisted policy', () => {
    assert.deepEqual(policy.parseCreatorLogPolicy({ tier: 'trace', groups: { protocol: true } }), {
      tier: 'summary',
      groups: { protocol: false, read: true, behavior: true, lifecycle: true },
    });
  });
});
