'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Require the bootstrap module for its exported pure core.
// Do not trigger main() — it only runs when require.main === module.
const bootstrap = require(path.join(__dirname, '..', '..', 'scripts', 'cc-bridge-bootstrap.js'));
const { buildCache, isLiveProbe, computeAgeMs } = bootstrap;

// ── helpers ────────────────────────────────────────────────────────────────

function makePriorEntry(overrides = {}) {
  const now = new Date();
  return {
    url: 'http://localhost:11111/utcp',
    toolCount: 42,
    tools: Array.from({ length: 42 }, (_, i) => `tool_${i}`),
    toolDefs: Array.from({ length: 42 }, (_, i) => ({ name: `tool_${i}` })),
    buildInfo: { version: '2.0.0', commit: 'abc123', branch: 'main', dirty: false, builtAt: now.toISOString() },
    fetchedAt: now.toISOString(),
    age_ms: 0,
    live: true,
    authoritative: true,
    stale: false,
    ...overrides,
  };
}

function utcpConfigFor(entries) {
  // entries: [{ name, port }]
  return {
    manual_call_templates: entries.map(({ name, port }) => ({
      name,
      call_template_type: 'http',
      url: `http://localhost:${port}/utcp`,
      http_method: 'GET',
      content_type: 'application/json',
    })),
  };
}

function mockFetch(map) {
  // map: { url: value }  value may be object, null, or fn(url)->value
  return async (url) => {
    if (typeof map[url] === 'function') return map[url](url);
    if (url in map) return map[url];
    return null;
  };
}

const LIVE_MANUAL = { utcp_version: '1.0.1', manual_version: '1.0.0', tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
const LIVE_BUILD = { version: '2.0.0', commit: 'deadbeef', branch: 'cc-3x7', dirty: false, builtAt: new Date().toISOString() };
const DEAD_MANUAL_EMPTY = { utcp_version: '1.0.1', manual_version: '1.0.0', tools: [] };

// ── isLiveProbe unit ─────────────────────────────────────────────────────

describe('cc-bridge-bootstrap — isLiveProbe liveness gate', () => {
  it('live when fetch succeeded, toolCount>0, provenance present', () => {
    assert.equal(isLiveProbe(LIVE_MANUAL, LIVE_BUILD, LIVE_MANUAL.tools.length), true);
  });

  it('dead when toolCount is 0 even with provenance', () => {
    assert.equal(isLiveProbe(DEAD_MANUAL_EMPTY, LIVE_BUILD, 0), false);
  });

  it('dead when fetch returned null (editor unreachable)', () => {
    assert.equal(isLiveProbe(null, null, 0), false);
    assert.equal(isLiveProbe(null, LIVE_BUILD, 0), false);
  });

  it('dead when tools is not an array', () => {
    assert.equal(isLiveProbe({ utcp_version: '1.0.1' }, LIVE_BUILD, 0), false);
    assert.equal(isLiveProbe({}, LIVE_BUILD, 5), false);
  });

  it('dead when provenance absent despite toolCount>0', () => {
    // No manual_version/utcp_version and no buildInfo — treated as dead per spec
    const noProv = { tools: [{ name: 'a' }] };
    assert.equal(isLiveProbe(noProv, null, 1), false);
  });

  it('live with only manual_version and no buildInfo', () => {
    const m = { manual_version: '1.0.0', tools: [{ name: 'a' }] };
    assert.equal(isLiveProbe(m, null, 1), true);
  });

  it('live with only utcp_version and no manual_version', () => {
    const m = { utcp_version: '1.0.1', tools: [{ name: 'a' }] };
    assert.equal(isLiveProbe(m, null, 1), true);
  });

  it('live with only buildInfo and no manual version', () => {
    const m = { tools: [{ name: 'a' }] };
    assert.equal(isLiveProbe(m, LIVE_BUILD, 1), true);
  });
});

describe('cc-bridge-bootstrap — computeAgeMs', () => {
  it('computes age_ms = now - fetchedAt', () => {
    const fetchedAt = new Date('2026-09-03T00:00:00.000Z').toISOString();
    const nowMs = Date.parse('2026-09-03T01:00:00.000Z');
    assert.equal(computeAgeMs(fetchedAt, nowMs), 60 * 60 * 1000);
  });

  it('returns 0 when fetchedAt equals now', () => {
    const iso = new Date('2026-09-03T12:00:00.000Z').toISOString();
    assert.equal(computeAgeMs(iso, Date.parse(iso)), 0);
  });

  it('returns null for missing or invalid fetchedAt', () => {
    assert.equal(computeAgeMs(null, Date.now()), null);
    assert.equal(computeAgeMs(undefined, Date.now()), null);
    assert.equal(computeAgeMs('not-a-date', Date.now()), null);
  });
});

// ── buildCache — the regression suite ────────────────────────────────────

describe('cc-bridge-bootstrap — buildCache probe gate (regression)', () => {
  it('dead-editor fetch never overwrites good cache (retains prior, marks stale)', async () => {
    const prior = { updatedAt: new Date().toISOString(), manuals: { ccb3x: makePriorEntry({ toolCount: 50 }) } };
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const now = new Date();
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': null, // dead: connection refused
        'http://localhost:11111/build-info': null,
      }),
      now,
    });
    // Must retain the good entry, not clobber with 0
    assert.equal(result.manuals.ccb3x.toolCount, 50, 'good entry must be retained');
    assert.equal(result.manuals.ccb3x.authoritative, true);
    assert.equal(result.manuals.ccb3x.live, false);
    assert.equal(result.manuals.ccb3x.stale, true);
    assert.equal(result.manuals.ccb3x.staleReason, 'probe_failed');
    assert.ok(typeof result.manuals.ccb3x.age_ms === 'number' && result.manuals.ccb3x.age_ms >= 0);
  });

  it('dead fetch that returns empty tools array also retains good cache', async () => {
    const prior = { updatedAt: new Date().toISOString(), manuals: { ccb3x: makePriorEntry({ toolCount: 30 }) } };
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': DEAD_MANUAL_EMPTY,
        'http://localhost:11111/build-info': LIVE_BUILD,
      }),
      now: new Date(),
    });
    assert.equal(result.manuals.ccb3x.toolCount, 30);
    assert.equal(result.manuals.ccb3x.stale, true);
    assert.equal(result.manuals.ccb3x.live, false);
  });

  it('first-run dead fetch does not create an authoritative 0 entry (tombstone)', async () => {
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: null, // no prior file — first run
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': null,
        'http://localhost:11111/build-info': null,
      }),
      now: new Date(),
    });
    // The key exists as a tombstone but is NOT authoritative
    assert.ok(result.manuals.ccb3x, 'tombstone should be present for diagnostics');
    assert.equal(result.manuals.ccb3x.toolCount, 0);
    assert.equal(result.manuals.ccb3x.authoritative, false, 'first-run dead fetch must not be authoritative');
    assert.equal(result.manuals.ccb3x.live, false);
    assert.equal(result.manuals.ccb3x.stale, true);
    assert.equal(result.manuals.ccb3x.staleReason, 'probe_failed');
  });

  it('first-run dead fetch with empty-tools response also creates tombstone', async () => {
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: { updatedAt: new Date().toISOString(), manuals: {} }, // empty prior
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': DEAD_MANUAL_EMPTY,
        'http://localhost:11111/build-info': null,
      }),
      now: new Date(),
    });
    assert.equal(result.manuals.ccb3x.authoritative, false);
    assert.equal(result.manuals.ccb3x.toolCount, 0);
  });

  it('live probe writes authoritative entry with age_ms:0 and fetchedAt', async () => {
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const now = new Date('2026-09-03T12:00:00.000Z');
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: null,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': LIVE_MANUAL,
        'http://localhost:11111/build-info': LIVE_BUILD,
      }),
      now,
    });
    assert.equal(result.manuals.ccb3x.toolCount, 3);
    assert.equal(result.manuals.ccb3x.authoritative, true);
    assert.equal(result.manuals.ccb3x.live, true);
    assert.equal(result.manuals.ccb3x.stale, false);
    assert.equal(result.manuals.ccb3x.age_ms, 0);
    assert.equal(result.manuals.ccb3x.fetchedAt, now.toISOString());
    assert.deepEqual(result.manuals.ccb3x.buildInfo, LIVE_BUILD);
  });

  it('live probe overwrites a stale prior (recovery)', async () => {
    const stalePrior = makePriorEntry({ toolCount: 5, fetchedAt: new Date(Date.now() - 10000).toISOString(), stale: true, live: false, age_ms: 10000 });
    const prior = { updatedAt: new Date().toISOString(), manuals: { ccb3x: stalePrior } };
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const now = new Date();
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': { utcp_version: '1.0.1', manual_version: '1.0.0', tools: [{ name: 'x' }, { name: 'y' }] },
        'http://localhost:11111/build-info': LIVE_BUILD,
      }),
      now,
    });
    assert.equal(result.manuals.ccb3x.toolCount, 2);
    assert.equal(result.manuals.ccb3x.authoritative, true);
    assert.equal(result.manuals.ccb3x.live, true);
    assert.equal(result.manuals.ccb3x.stale, false);
  });

  it('ccb3x and ccb2x are independent — dead ccb3x does not clobber live ccb2x', async () => {
    const prior = {
      updatedAt: new Date().toISOString(),
      manuals: {
        ccb3x: makePriorEntry({ url: 'http://localhost:11111/utcp', toolCount: 50 }),
        ccb2x: makePriorEntry({ url: 'http://localhost:22222/utcp', toolCount: 30 }),
      },
    };
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }, { name: 'ccb2x', port: 22222 }]);
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': null, // ccb3x dead
        'http://localhost:11111/build-info': null,
        'http://localhost:22222/utcp': LIVE_MANUAL, // ccb2x live
        'http://localhost:22222/build-info': LIVE_BUILD,
      }),
      now: new Date(),
    });
    // ccb3x retained
    assert.equal(result.manuals.ccb3x.toolCount, 50);
    assert.equal(result.manuals.ccb3x.live, false);
    assert.equal(result.manuals.ccb3x.stale, true);
    // ccb2x freshly written
    assert.equal(result.manuals.ccb2x.toolCount, 3);
    assert.equal(result.manuals.ccb2x.live, true);
    assert.equal(result.manuals.ccb2x.authoritative, true);
  });

  it('ccb3x live does not resurrect a dead ccb2x tombstone into authoritative', async () => {
    const prior = null;
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }, { name: 'ccb2x', port: 22222 }]);
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': LIVE_MANUAL,
        'http://localhost:11111/build-info': LIVE_BUILD,
        'http://localhost:22222/utcp': null, // ccb2x dead
        'http://localhost:22222/build-info': null,
      }),
      now: new Date(),
    });
    assert.equal(result.manuals.ccb3x.authoritative, true);
    assert.equal(result.manuals.ccb3x.toolCount, 3);
    assert.equal(result.manuals.ccb2x.authoritative, false);
    assert.equal(result.manuals.ccb2x.toolCount, 0);
  });

  it('prior key not probed this run is retained with refreshed age_ms', async () => {
    const fetchedAt = new Date(Date.now() - 5000).toISOString();
    const prior = {
      updatedAt: new Date().toISOString(),
      manuals: { ccb2x: makePriorEntry({ url: 'http://localhost:22222/utcp', toolCount: 30, fetchedAt, age_ms: 0 }) },
    };
    // This run only has ccb3x in the config; ccb2x absent
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const now = new Date();
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': LIVE_MANUAL,
        'http://localhost:11111/build-info': LIVE_BUILD,
      }),
      now,
    });
    assert.ok(result.manuals.ccb2x, 'unprobed prior key must be retained');
    assert.equal(result.manuals.ccb2x.toolCount, 30);
    assert.ok(result.manuals.ccb2x.age_ms >= 4000, `age_ms should reflect ~5s elapsed, got ${result.manuals.ccb2x.age_ms}`);
  });

  it('max-age: prior older than 24h without successful probe is marked stale (max_age)', async () => {
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    const prior = {
      updatedAt: longAgo,
      manuals: { ccb3x: makePriorEntry({ toolCount: 50, fetchedAt: longAgo, age_ms: 0, stale: false, live: true }) },
    };
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': null, // still dead
        'http://localhost:11111/build-info': null,
      }),
      now: new Date(),
    });
    assert.equal(result.manuals.ccb3x.toolCount, 50, 'count must be retained');
    assert.equal(result.manuals.ccb3x.stale, true);
    assert.equal(result.manuals.ccb3x.staleReason, 'max_age');
  });

  it('per-port keys (ccb3x_49650) are independent of canonical ccb3x', async () => {
    const prior = {
      updatedAt: new Date().toISOString(),
      manuals: {
        ccb3x: makePriorEntry({ url: 'http://localhost:11111/utcp', toolCount: 50 }),
        ccb3x_49650: makePriorEntry({ url: 'http://localhost:49650/utcp', toolCount: 40 }),
      },
    };
    const cfg = {
      manual_call_templates: [
        { name: 'ccb3x', call_template_type: 'http', url: 'http://localhost:11111/utcp', http_method: 'GET', content_type: 'application/json' },
        { name: 'ccb3x_49650', call_template_type: 'http', url: 'http://localhost:49650/utcp', http_method: 'GET', content_type: 'application/json' },
      ],
    };
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: prior,
      fetchJson: mockFetch({
        'http://localhost:11111/utcp': null,
        'http://localhost:11111/build-info': null,
        'http://localhost:49650/utcp': LIVE_MANUAL,
        'http://localhost:49650/build-info': LIVE_BUILD,
      }),
      now: new Date(),
    });
    // Canonical retained stale, per-port refreshed live
    assert.equal(result.manuals.ccb3x.toolCount, 50);
    assert.equal(result.manuals.ccb3x.live, false);
    assert.equal(result.manuals['ccb3x_49650'].toolCount, 3);
    assert.equal(result.manuals['ccb3x_49650'].live, true);
  });

  it('dedup by URL: same editor as canonical + per-port alias keeps one probe (prefer canonical name)', async () => {
    // Same base URL appears twice (canonical + per-port alias) — dedup should fetch once
    let fetchCount = 0;
    const cfg = {
      manual_call_templates: [
        { name: 'ccb3x_49650', call_template_type: 'http', url: 'http://localhost:49650/utcp', http_method: 'GET', content_type: 'application/json' },
        { name: 'ccb3x', call_template_type: 'http', url: 'http://localhost:49650/utcp', http_method: 'GET', content_type: 'application/json' },
      ],
    };
    const countingFetch = async (url) => {
      if (url.endsWith('/utcp')) fetchCount++;
      if (url.endsWith('/utcp')) return LIVE_MANUAL;
      if (url.endsWith('/build-info')) return LIVE_BUILD;
      return null;
    };
    const result = await buildCache({ utcpConfig: cfg, priorCache: null, fetchJson: countingFetch, now: new Date() });
    // Prefer canonical name ccb3x over per-port for same URL
    assert.ok(result.manuals.ccb3x, 'canonical key wins dedup');
    assert.equal(fetchCount, 1, 'should fetch /utcp once per unique URL');
  });
});

describe('cc-bridge-bootstrap — regression: reverting the guard must fail', () => {
  it('the old buggy guard (existing.toolCount>0 only when prior exists) would let first-run 0 persist; new code must not', async () => {
    // This is the exact scenario the original bug report describes: first run,
    // no prior file on disk, editor dead → old code did:
    //   const cache = { manuals: {} }; // fresh
    //   existing = cache.manuals[cacheKey] // undefined
    //   if (existing && existing.toolCount>0 ...) continue; // never fires
    //   cache.manuals[cacheKey] = { toolCount: 0, ... } // authoritative 0 persists forever
    const cfg = utcpConfigFor([{ name: 'ccb3x', port: 11111 }]);
    const result = await buildCache({
      utcpConfig: cfg,
      priorCache: null,
      fetchJson: mockFetch({ 'http://localhost:11111/utcp': null, 'http://localhost:11111/build-info': null }),
      now: new Date(),
    });
    // If the guard were reverted to the old logic, this would be { toolCount:0, authoritative: true/undefined }
    // The regression test asserts the new invariant: a 0 entry is never authoritative
    const entry = result.manuals.ccb3x;
    assert.ok(entry, 'dead first run should still write a tombstone (or be absent) — never silent success');
    assert.notEqual(entry.authoritative, true, 'tombstone must not be authoritative; revert would make this true/undefined');
    assert.equal(entry.stale, true);
    // Consumers key off authoritative to decide "ready"; a revert would make toolCount:0 look ready
    const isReady = entry.authoritative === true && entry.toolCount > 0;
    assert.equal(isReady, false, 'dead first-run entry must not be considered ready');
  });
});
