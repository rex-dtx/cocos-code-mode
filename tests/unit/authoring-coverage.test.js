'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classify, makeBasis, digest } = require('../../scripts/generate-authoring-coverage');

describe('authoring coverage denominator identity', () => {
  it('ignores runtime wording in limitations and implementation evidence', () => {
    const contract = {
      id: 'editor.example',
      domain: 'editor',
      executionContext: 'editor',
      title: 'Configure an editor asset',
      observableOutcome: 'The configured asset is persisted and readable in the editor.',
      authoringDisposition: 'included',
      authoringReason: 'Included authoring contract: editor is an editor-side authoring domain and the contract has no active-runtime or external-delivery prerequisite.',
    };
    const clean = { ...contract, limitations: [], implementationState: 'unreviewed', implementationReason: 'No evidence yet.' };
    const evidenceOnly = {
      ...contract,
      limitations: ['No runtime credit; playback and Game View are unavailable.'],
      implementationState: 'complete',
      implementationReason: 'Runtime evidence is unavailable, but editor read-back is confirmed.',
    };

    assert.deepEqual(classify(clean), classify(evidenceOnly));
    assert.equal(classify(evidenceOnly).disposition, 'included');
    assert.equal(
      digest(JSON.stringify(makeBasis([clean]))),
      digest(JSON.stringify(makeBasis([evidenceOnly]))),
    );
  });
});
