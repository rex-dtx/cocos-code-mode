#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const INPUTS = ['reports/original-competitor-intake-20260917.json', 'reports/original-lane-requirements-20260917.json', 'docs/tool-portfolio-candidates.json', 'docs/workflow-mapping-decisions.json', 'docs/workflow-contract-reviews.json'];
const VERSION = 'ccb3x-creator-3.7.3-windows-v1-review';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const slug = value => String(value).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function generate(root = ROOT) {
  const bytes = INPUTS.map(file => fs.readFileSync(path.join(root, file)));
  const [competitor, lanes, portfolio, proposals, reviews] = bytes.map(value => JSON.parse(value));
  const sourceHashes = Object.fromEntries(INPUTS.map((file, index) => [file, digest(bytes[index])]));
  const proposalById = new Map(proposals.rows.map(row => [row.sourceId, row]));
  const portfolioRows = [...portfolio.domains.flatMap(domain => domain.candidates.map(row => ({ ...row, domain: domain.domain }))), ...portfolio.reserveCandidates];
  const portfolioByName = new Map(portfolioRows.map(row => [row.name, row]));
  const evidenceByTool = new Map();
  const routeByTool = new Map();
  const isQualifiedEvidenceRecord = record => record?.qualified === true && record?.creator === '3.7.3';
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const record = JSON.parse(fs.readFileSync(file, 'utf8'));
          const relative = path.relative(root, file).replaceAll(path.sep, '/');
          if (isQualifiedEvidenceRecord(record) && record.tool) {
            const list = evidenceByTool.get(record.tool) || [];
            list.push(relative);
            evidenceByTool.set(record.tool, list);
          }
          if (record.target?.creator === '3.7.3' && record.result?.failed === 0 && Array.isArray(record.witnesses)) {
            for (const tool of record.witnesses) {
              const list = evidenceByTool.get(tool) || [];
              list.push(relative);
              evidenceByTool.set(tool, list);
            }
          }
        } catch { /* unrelated JSON is not candidate evidence */ }
      }
    }
  };
  const evidenceRoot = path.join(root, 'reports/evidence/candidates');
  if (fs.existsSync(evidenceRoot)) walk(evidenceRoot);
  const sourceRoot = path.join(root, 'source');
  const scanSources = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scanSources(file);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(file, 'utf8');
        for (const tool of portfolioRows.map(row => row.name)) {
          if (!new RegExp(`@utcpTool\\s*\\(\\s*['\"]${tool}['\"]`).test(text)) continue;
          const list = routeByTool.get(tool) || [];
          list.push(path.relative(root, file).replaceAll(path.sep, '/'));
          routeByTool.set(tool, list);
        }
      }
    }
  };
  if (fs.existsSync(sourceRoot)) scanSources(sourceRoot);
  const evidencePromotion = source => {
    if (source.kind !== 'lane-requirement') return null;
    const candidate = portfolioByName.get(source.name);
    const evidence = evidenceByTool.get(source.name) || [];
    const routes = routeByTool.get(source.name) || [];
    if (candidate?.state !== 'qualified' || evidence.length === 0 || routes.length !== 1) return null;
    const candidateSpecific = evidence.filter(file => file.includes(`/candidates/${source.name}/`));
    const selected = candidateSpecific.length ? candidateSpecific.sort().at(-1) : evidence.length === 1 ? evidence[0] : null;
    if (!selected) return null;
    return { state: 'complete', route: { tool: source.name, file: routes[0] }, evidence: selected, reason: 'qualified portfolio state + unique direct route + current Creator 3.7.3 evidence' };
  };
  const sources = competitor.rows.map(row => ({
    id: `${row.catalog === 'Funplay' ? 'funplay' : 'cocos-mcp'}:${row.name}`,
    kind: 'competitor-row', name: row.name,
    contract: row.contract || null,
    contractSource: 'reports/original-competitor-intake-20260917.json',
    detailStatus: row.contract ? 'documented' : 'operation-contract-needed',
  }));
  for (const row of lanes.rows) sources.push({
    id: `lane:${row.source.replace('/plan.md', '')}:${row.name}`, kind: 'lane-requirement', name: row.name,
    contract: [row.requirement, portfolioByName.get(row.name)?.contractDelta].filter(Boolean).join('\n'),
    contractSource: `reports/original-lane-requirements-20260917.json#${row.source}`,
    domain: portfolioByName.get(row.name)?.domain || 'scene', detailStatus: 'documented',
  });
  // These foundation clauses are explicitly preserved, not inferred from registrations.
  const parent = [
    ['runtime-session', 'runtime', 'Identify, start, observe and stop a declared runtime target with bounded state and unknown-outcome handling.'],
    ['runtime-input', 'runtime', 'Dispatch allow-listed input to the intended runtime target and observe the result.'],
    ['runtime-capture', 'runtime', 'Capture bounded visual evidence of the intended runtime target.'],
    ['runtime-observation', 'runtime', 'Observe allow-listed state from the actual runtime, without an edit-renderer fallback.'],
    ['compound-scene', 'scene', 'Create complete scene/UI composition with stable node, component and asset identities.'],
    ['mutation-workflow', 'scene', 'Preflight mutation, apply boundedly, verify postconditions and recover from partial failure.'],
    ['long-job', 'build', 'Track a named build/import job to terminal outcome with bounded diagnostics and cancellation semantics.'],
    ['golden-tracer', 'runtime', 'Blank project to scene/UI, compile, preview, input, observation, capture, build and launched artifact smoke.'],
  ];
  for (const [name, domain, contract] of parent) sources.push({ id: `parent:${name}`, kind: 'parent-requirement', name, domain, contract, contractSource: reviews.parentContractSource, detailStatus: 'documented' });
  if (new Set(sources.map(row => row.id)).size !== sources.length) throw new Error('Duplicate source identity');
  const reviewBySource = new Map();
  for (const row of reviews.rows) {
    if (!sources.some(source => source.id === row.sourceId)) throw new Error(`Unknown reviewed source ${row.sourceId}`);
    if (reviewBySource.has(row.sourceId)) throw new Error(`Duplicate contract review ${row.sourceId}`);
    reviewBySource.set(row.sourceId, row);
  }
  const workflows = new Map();
  const mappings = [];
  const contractReviewAccepted = (source, proposal, review) => {
    if (reviews.status === 'accepted' && review?.contractReviewStatus === 'accepted') return true;
    // Competitor mapping decisions are a separate, reviewed contract lane. They
    // establish source-to-workflow identity only; implementationState remains
    // independently sourced from evidence review.
    return source.kind === 'competitor-row' && proposals.status === 'reviewed' && Boolean(proposal?.decision);
  };
  for (const source of sources) {
    const proposal = proposalById.get(source.id);
    const review = reviewBySource.get(source.id);
    const contractAccepted = contractReviewAccepted(source, proposal, review);
    const proposedDomain = proposal?.targetWorkflowId?.split('.')[0];
    const domain = source.domain || (proposedDomain && proposedDomain !== 'excluded' ? proposedDomain : 'product');
    // Contract acceptance is independent from implementation evidence. A reviewed
    // proposal may still be missing, partial, or test-pending.
    const workflowId = review?.workflowId || `${domain}.${slug(source.id)}`;
    const promotion = evidencePromotion(source);
    const row = workflows.get(workflowId) || {
      id: workflowId, domain, title: source.name, observableOutcome: source.contract || source.name,
      creatorVersion: '3.7.3', platform: 'windows-x64', executionContext: review?.executionContext || 'unreviewed',
      sourceIds: [], sourceRequirementIds: [], competitorSourceIds: [], portfolioNames: [],
      implementationState: promotion?.state || review?.implementationState || 'unreviewed',
      implementationReason: promotion?.reason || (review?.implementationState && review.implementationState !== 'unreviewed' ? 'contract review classification without complete current evidence' : 'accepted contract identity; implementation route and evidence not yet bound'),
      implementationRoute: promotion ? [promotion.route] : (review?.routes || []),
      evidenceArtifacts: promotion ? [promotion.evidence] : (review?.evidence || []),
      limitations: review?.limitations || [], reviewed: contractAccepted,
      contractReviewStatus: contractAccepted ? 'accepted' : 'unreviewed',
      contractDecision: review?.decision || proposal?.decision || null,
      denominatorDisposition: 'included', dispositionReason: 'No owner-approved scope reduction; unreviewed requirements stay included.',
      mergeEvidence: review?.mergeEvidence || [],
    };
    if (row.sourceIds.length && (!review?.mergeEvidence?.length || !row.mergeEvidence.length)) throw new Error(`Unproved outcome merge ${workflowId}`);
    if (row.sourceIds.length && row.executionContext !== review.executionContext) throw new Error(`Conflicting merged context ${workflowId}`);
    if (row.sourceIds.length) {
      const rank = { complete: 5, 'test-pending': 4, partial: 3, missing: 2, unreviewed: 1, excluded: 0 };
      if ((rank[review?.implementationState] ?? 1) < (rank[row.implementationState] ?? 1)) row.implementationState = review.implementationState;
      if (contractAccepted) row.contractReviewStatus = 'accepted';
      for (const route of review?.routes || []) if (!row.implementationRoute.some(existing => existing.tool === route.tool)) row.implementationRoute.push(route);
      row.limitations.push(...(review?.limitations || [])); row.evidenceArtifacts.push(...(review?.evidence || [])); row.mergeEvidence.push(...(review?.mergeEvidence || []));
    }
    if (review?.denominatorDisposition === 'excluded') {
      if (!review.approval?.instruction || !review.approval?.date) throw new Error(`Scope exclusion lacks owner approval: ${source.id}`);
      row.denominatorDisposition = 'excluded'; row.dispositionReason = review.approval.instruction; row.approval = review.approval;
    }
    row.sourceIds.push(source.id);
    (source.kind === 'competitor-row' ? row.competitorSourceIds : row.sourceRequirementIds).push(source.id);
    if (source.kind === 'lane-requirement' && portfolioByName.has(source.name)) row.portfolioNames.push(source.name);
    workflows.set(workflowId, row);
    mappings.push({ sourceId: source.id, sourceKind: source.kind, sourceName: source.name, workflowId,
      status: contractAccepted ? 'contract-reviewed' : 'needs-contract-review', detailStatus: source.detailStatus,
      originalContract: source.contract, contractSource: source.contractSource,
      proposal: proposal ? { decision: proposal.decision, target: proposal.targetWorkflowId, rationale: proposal.rationale } : null,
    });
  }
  const rows = [...workflows.values()].sort((a, b) => a.id.localeCompare(b.id));
  const included = rows.filter(row => row.denominatorDisposition === 'included');
  const unresolved = mappings.filter(row => row.status !== 'contract-reviewed');
  const confirmed = included.filter(row => row.implementationState === 'complete');
  const reviewComplete = unresolved.length === 0;
  const byDomain = {};
  for (const row of included) {
    const bucket = byDomain[row.domain] ||= { total: 0, complete: 0, unreviewed: 0 };
    bucket.total++; if (row.implementationState === 'complete') bucket.complete++;
  }
  for (const bucket of Object.values(byDomain)) bucket.implementationPercent = bucket.unreviewed ? null : Number((bucket.complete * 100 / bucket.total).toFixed(2));
  const basis = { profile: { creator: '3.7.3', os: 'windows-x64', profile: 'full', artifactClass: 'local-operator' }, sourceHashes, mappings: mappings.map(({ sourceId, workflowId }) => ({ sourceId, workflowId })), dispositions: rows.map(({ id, denominatorDisposition }) => ({ id, denominatorDisposition })) };
  const denominatorHash = digest(JSON.stringify(basis));
  const common = { schemaVersion: 2, denominatorVersion: VERSION, denominatorHash };
  const output = {
    'docs/workflow-inventory.json': { ...common, status: reviewComplete ? 'frozen-v1' : 'review-required', qualificationProfile: basis.profile, inputHashes: sourceHashes, rows },
    'docs/workflow-source-mapping.json': { ...common, sourceCounts: { competitor: competitor.rows.length, lane: lanes.rows.length, parent: parent.length }, rows: mappings.sort((a, b) => a.sourceId.localeCompare(b.sourceId)) },
    'docs/workflow-implementation-evidence.json': { ...common, rows: rows.map(row => ({ workflowId: row.id, state: row.implementationState, reason: row.implementationReason, routes: row.implementationRoute, evidenceArtifacts: row.evidenceArtifacts, limitations: row.limitations })) },
    'reports/workflow-coverage-report.json': { ...common, status: reviewComplete ? 'measurable' : 'not-measurable', candidateDenominator: included.length, denominator: reviewComplete ? included.length : null, confirmedComplete: confirmed.length, implementationPercent: reviewComplete ? Number((confirmed.length * 100 / included.length).toFixed(2)) : null, targetPercent: 90, targetComplete: reviewComplete ? Math.ceil(included.length * 0.9) : null, deficitTo90: reviewComplete ? Math.max(0, Math.ceil(included.length * 0.9) - confirmed.length) : null, unresolvedContracts: unresolved.length, byDomain, invalidatedClaims: ['137/181', '144/189', '27 workflows to closure'], reason: 'Prior generator merged different operations and inferred implementation from registration/qualification labels; these are not accepted coverage evidence.' },
    'reports/workflow-classification-review.json': { ...common, rows: mappings.filter(row => row.status !== 'contract-reviewed').map(row => ({ ...row, reviewReason: row.detailStatus === 'operation-contract-needed' ? 'Recover original operation inputs/outputs and context before equivalence review.' : 'Verify full outcome, not tool name or shared implementation.' })) },
    'reports/workflow-closure-backlog.json': { ...common, status: reviewComplete ? 'ready-for-implementation-reconciliation' : 'blocked-on-contract-review', requiredFor90: reviewComplete ? Math.max(0, Math.ceil(included.length * 0.9) - confirmed.length) : null, rows: rows.filter(row => row.reviewed && row.denominatorDisposition === 'included' && row.implementationState !== 'complete').map(row => ({ workflowId: row.id, state: row.implementationState, reason: row.implementationReason, acceptance: row.observableOutcome, limitations: row.limitations, dependencies: row.executionContext === 'game-view' ? ['qualified-game-view-transport'] : [] })) },
  };
  for (const [file, value] of Object.entries(output)) { const destination = path.join(root, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`); }
  return { ok: true, sourceCount: sources.length, candidateWorkflows: rows.length, confirmedComplete: confirmed.length, unresolvedContracts: unresolved.length, denominatorHash, frozen: false };
}
module.exports = { generate, INPUTS, digest };
if (require.main === module) { try { console.log(JSON.stringify(generate())); } catch (error) { console.error(error.message); process.exitCode = 1; } }
