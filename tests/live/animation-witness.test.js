'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool } = require('../helpers/utcp-client');
const { liveWitness, assertPositive, assertNegative } = require('../helpers/witness-harness');

describe('live: animation candidate witnesses (non-qualifying)', () => {
  it('inspects and validates a real SkeletalAnimation node, with typed negative witnesses', async (t) => {
    const evidence = await liveWitness(
      'witness.skeletal-animation.inspect-validate.v1',
      async ({ getExpectedErrorJson }) => {
        const nodes = await getJson('/tools/findNodes?componentType=cc.SkeletalAnimation&maxResults=1');
        assertPositive(nodes, 'find SkeletalAnimation');
        if (!nodes.body.nodes.length) return { unavailable: true, reason: 'No SkeletalAnimation fixture is present in the active scene.' };

        const reference = nodes.body.nodes[0].reference;
        const encoded = encodeURIComponent(reference.id);
        const inspected = await getJson(`/tools/skeletalAnimationInspect?nodeReference%5Bid%5D=${encoded}&maxClips=3`);
        const inspectBody = assertPositive(inspected, 'skeletalAnimationInspect');
        assert.equal(inspectBody.reference.id, reference.id);
        assert.ok(Array.isArray(inspectBody.clips));
        assert.equal(typeof inspectBody.totalClips, 'number');

        const validated = await postTool('skeletalAnimationValidate', { nodeReference: reference, maxClips: 3 });
        const validateBody = assertPositive(validated, 'skeletalAnimationValidate');
        assert.equal(typeof validateBody.valid, 'boolean');
        assert.ok(Array.isArray(validateBody.issues));
        assert.equal(typeof validateBody.clipCount, 'number');

        const invalid = await getExpectedErrorJson(
          '/tools/skeletalAnimationInspect?nodeReference=%7B%22id%22%3A%22__missing_animation_node__%22%7D',
          'candidate.skeletalAnimationInspect.negative.v1',
        );
        assert.equal(invalid.status, 404);
        assert.equal(invalid.body.code, 'TARGET_NOT_FOUND');
        return { inspected: inspectBody, validated: validateBody, negative: invalid.body };
      },
      [
        'This witness is fixture-dependent and is skipped when the active scene has no SkeletalAnimation node.',
        'Positive validation may report asset/component limitations; valid=false is retained as observed evidence.',
      ],
    );

    if (evidence.skipped) {
      t.skip(evidence.reason);
      return;
    }
    if (evidence.result.unavailable) {
      t.skip(evidence.result.reason);
      return;
    }
    assert.equal(typeof evidence.build.commit, 'string');
    assert.equal(typeof evidence.build.branch, 'string');
    assert.ok(evidence.limitations.length >= 2);
  });
});
