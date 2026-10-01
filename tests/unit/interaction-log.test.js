'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { formatInteractionHeadline, renderInteraction } = requireDist('utcp/interaction-log.js');
const { formatInteractionSummary } = requireDist('utcp/utcp-server.js');

describe('interaction log headlines', () => {
  it('summarizes popup inspection without expanding details', () => {
    const headline = formatInteractionHeadline({
      phase: 'complete', requestId: '1234567890', tool: 'editorPopupInspect', status: 200,
      durationMs: 354, result: { detected: true, blocking: true, total: 3 },
    });
    assert.equal(headline, '[cx3][api][12345678] SUCCESS editorPopupInspect · blocking popup · 3 windows 200 · 354ms');
  });
  it('retains popup meaning in summary tier without exposing result details', () => {
    const text = formatInteractionSummary({
      phase: 'complete', tier: 'summary', tool: 'editorPopupInspect', status: 200,
      result: { detected: true, blocking: true, total: 3, secret: 'hidden-value' },
    });
    assert.match(text, /blocking popup · 3 windows/);
    assert.doesNotMatch(text, /Result:|hidden-value/);
  });

  it('summarizes handshake identity mismatch separately from degraded transport', () => {
    assert.match(formatInteractionHeadline({
      phase: 'complete', tool: 'editorHandshake', result: { projectMatches: false, probe: { status: 'responsive' } },
    }), /responsive · project mismatch/);
    assert.match(formatInteractionHeadline({
      phase: 'complete', tool: 'editorHandshake', result: { probe: { status: 'timeout' } },
    }), /degraded · timeout/);
  });

  it('keeps expanded result detail available', () => {
    const rendered = renderInteraction({ phase: 'complete', tool: 'nodeCreate', result: { reference: 'node:1' } });
    assert.match(rendered.text, /SUCCESS nodeCreate · node created/);
    assert.match(rendered.text, /Result:/);
    assert.match(rendered.text, /reference: node:1/);
  });

  it('shows bounded tree request parameters on the completion event', () => {
    const rendered = renderInteraction({
      phase: 'complete', requestId: 'f7e37cb39bd16e44', tool: 'nodeGetTree', status: 200,
      durationMs: 23, args: { maxDepth: 99, maxNodes: 10000 }, result: { childrenCount: 200 },
    });
    assert.match(rendered.text, /SUCCESS nodeGetTree · .*maxDepth=99 · maxNodes=10000 200 · 23ms/);
    assert.match(rendered.text, /Params:\n  maxDepth: 99\n  maxNodes: 10000/);
    assert.match(rendered.text, /Result:/);
  });
});
