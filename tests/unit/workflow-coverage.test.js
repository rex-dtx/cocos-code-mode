'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generate, INPUTS } = require('../../scripts/generate-workflow-coverage');
const { audit } = require('../../scripts/audit-workflow-coverage');
const root = path.resolve(__dirname, '../..');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-workflow-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const file of INPUTS) { fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(temp, file)); }
  fs.mkdirSync(path.join(temp, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'docs/workflow-implementation-overrides.json'), JSON.stringify({ schemaVersion: 1, rows: [] }));
  return temp;
}
function read(temp, file) { return JSON.parse(fs.readFileSync(path.join(temp, file), 'utf8')); }
function write(temp, file, value) { fs.writeFileSync(path.join(temp, file), JSON.stringify(value)); }
it('preserves configure/query/validate as different outcomes and retains all sources', t => {
  const temp = fixture(t);
  generate(temp);
  const mappings = read(temp, 'docs/workflow-source-mapping.json').rows;
  assert.equal(mappings.length, 356);
  for (const names of [['physics3dConfigure', 'physics3dQuery', 'physics3dValidate'], ['localizationInspect', 'localizationValidate'], ['uiLayoutApply', 'uiLayoutInspect']]) {
    const rows = names.map(name => mappings.find(row => row.sourceKind === 'lane-requirement' && row.sourceName === name));
    assert.equal(new Set(rows.map(row => row.workflowId)).size, names.length);
  }
  assert.equal(audit(temp, true).frozen, true);
});
it('never turns a qualified portfolio label into a complete workflow', t => {
  const temp = fixture(t);
  const result = generate(temp);
  assert.equal(result.confirmedComplete, 0);
  const coverage = read(temp, 'reports/workflow-coverage-report.json');
  assert.equal(coverage.implementationPercent, 0);
  assert.equal(coverage.deficitTo90, 321);
  assert.equal(audit(temp, true).frozen, true);
});
it('rejects source substitution even if the total is unchanged', t => {
  const temp = fixture(t); generate(temp);
  const map = read(temp, 'docs/workflow-source-mapping.json');
  map.rows[0].sourceId = 'funplay:invented-source';
  write(temp, 'docs/workflow-source-mapping.json', map);
  assert.throws(() => audit(temp), /source inventory mismatch/);
});
it('rejects stale input hashes and false exact scores', t => {
  const temp = fixture(t); generate(temp);
  const coverage = read(temp, 'reports/workflow-coverage-report.json');
  coverage.implementationPercent = 95;
  write(temp, 'reports/workflow-coverage-report.json', coverage);
  assert.throws(() => audit(temp), /coverage arithmetic drift/);
  generate(temp);
  fs.appendFileSync(path.join(temp, INPUTS[0]), '\n');
  assert.throws(() => audit(temp), /stale input hash/);
});
it('rejects unsupported exclusion and unproved outcome merges', t => {
  const temp = fixture(t);
  const reviews = read(temp, 'docs/workflow-contract-reviews.json');
  reviews.rows[0].denominatorDisposition = 'excluded';
  delete reviews.rows[0].approval;
  write(temp, 'docs/workflow-contract-reviews.json', reviews);
  assert.throws(() => generate(temp), /lacks owner approval/);
  reviews.rows[0].denominatorDisposition = 'included';
  reviews.rows[1].workflowId = reviews.rows[0].workflowId;
  write(temp, 'docs/workflow-contract-reviews.json', reviews);
  assert.throws(() => generate(temp), /Unproved outcome merge/);
});
