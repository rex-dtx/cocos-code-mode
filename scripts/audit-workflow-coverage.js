#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const fail = message => { throw new Error(message); };

const inventory = read('docs/workflow-inventory.json');
const mapping = read('docs/workflow-source-mapping.json');
const evidence = read('docs/workflow-implementation-evidence.json');
const coverage = read('reports/workflow-coverage-report.json');
const backlog = read('reports/workflow-closure-backlog.json');
const competitor = read('reports/original-competitor-intake-20260917.json');
const classificationReview = read('reports/workflow-classification-review.json');
const lanes = read('reports/original-lane-requirements-20260917.json');
const portfolio = read('docs/tool-portfolio-candidates.json');

const states = new Set(['complete', 'partial', 'missing', 'unsupported', 'external', 'excluded', 'test-pending']);
const dispositions = new Set(['included', 'excluded']);
const ids = inventory.rows.map(row => row.id);
if (new Set(ids).size !== ids.length) fail('duplicate workflow IDs');
if (inventory.denominatorVersion !== mapping.denominatorVersion || inventory.denominatorVersion !== evidence.denominatorVersion || inventory.denominatorVersion !== coverage.denominatorVersion || inventory.denominatorVersion !== backlog.denominatorVersion) fail('denominator version drift');
for (const row of inventory.rows) {
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(row.id)) fail(`${row.id}: invalid stable ID`);
  if (!states.has(row.implementationState)) fail(`${row.id}: invalid implementation state`);
  if (!dispositions.has(row.denominatorDisposition)) fail(`${row.id}: invalid denominator disposition`);
  if (!row.observableOutcome || !row.domain || !row.dispositionReason) fail(`${row.id}: incomplete workflow row`);
  if (row.implementationState === 'complete' && (!Array.isArray(row.implementationRoute) || row.implementationRoute.length === 0)) fail(`${row.id}: complete without implementation route`);
  if (row.denominatorDisposition === 'excluded' && row.implementationState !== 'excluded') fail(`${row.id}: excluded denominator row must use excluded state`);
}
const inventoryIds = new Set(ids);
for (const row of mapping.rows) if (!inventoryIds.has(row.workflowId)) fail(`${row.sourceId}: unknown workflow ${row.workflowId}`);
const sourceIds = mapping.rows.map(row => row.sourceId);
if (new Set(sourceIds).size !== sourceIds.length) fail('source IDs must map exactly once');
const competitorMappings = mapping.rows.filter(row => row.sourceKind === 'competitor-row');
const laneMappings = mapping.rows.filter(row => row.sourceKind === 'lane-requirement');
if (competitorMappings.length !== competitor.total || competitor.total !== 262) fail(`competitor mapping mismatch: ${competitorMappings.length}/${competitor.total}`);
if (laneMappings.length !== lanes.count) fail(`lane mapping mismatch: ${laneMappings.length}/${lanes.count}`);
const expectedPortfolioNames = new Set([
  ...portfolio.domains.flatMap(domain => domain.candidates.map(row => row.name)),
  ...(portfolio.reserveCandidates || []).map(row => row.name),
]);
const mappedPortfolioNames = new Set(inventory.rows.flatMap(row => row.portfolioNames || []));
const unknownPortfolio = [...mappedPortfolioNames].filter(name => !expectedPortfolioNames.has(name));
if (unknownPortfolio.length) fail(`unknown portfolio names: ${unknownPortfolio.join(', ')}`);
const included = inventory.rows.filter(row => row.denominatorDisposition === 'included');
const complete = included.filter(row => row.implementationState === 'complete');
if (coverage.denominator !== included.length || coverage.complete !== complete.length) fail('coverage totals drift from inventory');
const percent = Number((complete.length * 100 / included.length).toFixed(2));
if (coverage.implementationPercent !== percent) fail('coverage percentage drift');
if (classificationReview.denominatorVersion !== inventory.denominatorVersion) fail('classification review denominator drift');
const reviewIds = new Set(classificationReview.rows.map(row => row.workflowId));
for (const row of inventory.rows) {
  if (row.denominatorDisposition === 'included' && row.implementationState !== 'complete' && !reviewIds.has(row.id)) fail(`${row.id}: incomplete workflow missing review queue`);
}
if (coverage.targetComplete !== Math.ceil(included.length * 0.90)) fail('90% target arithmetic drift');
for (const row of backlog.rows) if (!inventoryIds.has(row.workflowId)) fail(`${row.workflowId}: backlog references unknown workflow`);
if (evidence.rows.length !== inventory.rows.length || new Set(evidence.rows.map(row => row.workflowId)).size !== inventory.rows.length) fail('evidence rows do not cover inventory exactly once');
console.log(JSON.stringify({ ok: true, denominatorVersion: inventory.denominatorVersion, workflows: inventory.rows.length, included: included.length, complete: complete.length, implementationPercent: percent, competitorMappings: competitorMappings.length, laneMappings: laneMappings.length, backlogRows: backlog.rows.length }));
