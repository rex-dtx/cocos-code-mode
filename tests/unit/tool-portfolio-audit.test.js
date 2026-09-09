'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'audit-tool-portfolio.js');
const PORTFOLIO_PATH = path.join(ROOT, 'docs', 'tool-portfolio-candidates.json');

function runMutatedPortfolio(mutate) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-portfolio-'));
  try {
    const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
    mutate(portfolio);
    const tempPortfolio = path.join(tempDir, 'portfolio.json');
    fs.writeFileSync(tempPortfolio, `${JSON.stringify(portfolio)}\n`, 'utf8');
    return spawnSync(
      process.execPath,
      [SCRIPT, '--require-ready', '--portfolio-path', tempPortfolio],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('minimum tool portfolio audit', () => {
  it('keeps 80 primary candidates plus a sufficient non-overlapping reserve pool', () => {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/audit-tool-portfolio.js'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.ok, true);
    assert.equal(result.baselineCount, 86);
    assert.equal(result.primaryCandidateCount, 80);
    assert.equal(result.reserveCandidateCount, 20);
    assert.equal(result.replaceCount, 6);
    assert.equal(result.minimumNet, 71);
    assert.equal(result.requiredApprovalCount, 82);
    assert.equal(result.potentiallyQualifiableCount >= result.requiredApprovalCount, true);
    assert.equal(result.readyForBulkImplementation, false);
    assert.equal(result.dependencyMetadataComplete, true);
    assert.equal(result.witnessContractCount, 46);
    assert.equal(result.evidencePlanComplete, true);
  });

  it('rejects baseline, replacement, and reserve mutations before readiness', () => {
    const cases = [
      {
        mutate: (portfolio) => { portfolio.baseline.minimumReleaseCount = 85; },
        error: /minimum release count drift/,
      },
      {
        mutate: (portfolio) => {
          const replacement = portfolio.domains
            .flatMap((domain) => domain.candidates)
            .find((candidate) => candidate.name === 'prefabVariantCreate');
          replacement.state = 'approved';
        },
        error: /replacement candidate classification drift/,
      },
      {
        mutate: (portfolio) => { portfolio.reserveCandidates.push({ ...portfolio.reserveCandidates[0], name: 'extraCandidate' }); },
        error: /reserve portfolio must contain 20 rows/,
      },
      {
        mutate: (portfolio) => {
          const candidate = portfolio.domains
            .flatMap((domain) => domain.candidates)
            .find((row) => row.name === 'uiAccessibilityAudit');
          candidate.prerequisites = [];
        },
        error: /reviewed non-empty prerequisites required/,
      },
      {
        mutate: (portfolio) => { delete portfolio.reserveCandidates[0].domain; },
        error: /domain required/,
      },
      {
        mutate: (portfolio) => {
          const candidate = portfolio.domains
            .flatMap((domain) => domain.candidates)
            .find((row) => row.name === 'uiAccessibilityAudit');
          candidate.prerequisites = ['missing-witness-contract'];
          candidate.witnessContractIds = ['missing-witness-contract'];
        },
        error: /unknown prerequisite witness contract/,
      },
      {
        mutate: (portfolio) => {
          const candidate = portfolio.reserveCandidates[0];
          delete candidate.positiveTestID;
        },
        error: /stable candidate evidence identifiers required/,
      },
      {
        mutate: (portfolio) => {
          const candidate = portfolio.reserveCandidates[0];
          candidate.witnessContractIds = [];
        },
        error: /witnessContractIds must exactly match prerequisites/,
      },
    ];

    for (const testCase of cases) {
      const result = runMutatedPortfolio(testCase.mutate);
      assert.equal(result.status, 1);
      assert.match(result.stderr, testCase.error);
    }
  });
});
