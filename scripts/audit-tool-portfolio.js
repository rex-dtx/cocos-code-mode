#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const PORTFOLIO_PATH = path.join(ROOT, 'docs', 'tool-portfolio-candidates.json');
const SOURCE_ROOT = path.join(ROOT, 'source', 'utcp');
const WITNESS_CONTRACTS_PATH = path.join(ROOT, 'docs', 'qualification-witness-contracts.json');
const FROZEN_BASELINE_COUNT = 86;
const FROZEN_MINIMUM_RELEASE_COUNT = 157;
const FROZEN_PRIMARY_COUNT = 80;
const FROZEN_RESERVE_COUNT = 20;
const FROZEN_REQUIRED_APPROVAL_COUNT = 82;
const IMPLEMENTED_EXPANSION_NAMES = new Set([
  'runtimePreviewControl',
  'uiLayoutInspect',
  'uiLayoutApply',
  'uiLayoutValidate',
  'uiCreateScrollView',
  'uiCreateInputForm',
  'assetImportSettingsGet',
  'assetManifestExport',
  'assetUsageAnalyze',
  'physics2dInspect',
  'physics2dValidate',
  'physics3dInspect',
  'audioSourceInspect',
  'audioAssetValidate',
  'buildPresetValidate',
  'buildArtifactInspect',
  'uiLayoutReport',
  'particleInspect',
  'particleValidate',
  'terrainInspect',
  'localizationInspect',
  'assetImporterAudit',
  'assetCatalogManifest',
  'buildOutputAudit',
  'buildTaskWait',
  'localizationValidate',
  'buildLogInspect',
  'audioSourceAudit',
  'physics2dTopologyAudit',
  'physics3dTopologyAudit',
  'physics3dValidate',
]);
const REPLACEMENT_NAMES = new Set([
  'prefabVariantCreate',
  'tilemapCreate',
  'tweenSequenceCreate',
  'tweenSequenceInspect',
  'tweenSequenceControl',
  'tweenSequenceValidate',
]);
const VALID_STATES = new Set(['candidate', 'probe-required', 'replace', 'rejected', 'approved', 'implemented-unverified', 'qualified']);

function fail(message) {
  throw new Error(message);
}
function sourceToolNames() {
  const inventory = new Set();
  const visitDirectory = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const source = fs.readFileSync(absolute, 'utf8');
      const parsed = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visitNode = (node) => {
        if (ts.isDecorator(node) && ts.isCallExpression(node.expression)
            && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'utcpTool') {
          const [name] = node.expression.arguments;
          if (!name || !ts.isStringLiteralLike(name)) {
            fail(`${path.relative(ROOT, absolute)}: @utcpTool requires a literal public name`);
          }
          if (inventory.has(name.text)) fail(`duplicate source tool: ${name.text}`);
          inventory.add(name.text);
        }
        ts.forEachChild(node, visitNode);
      };
      visitNode(parsed);
    }
  };
  visitDirectory(SOURCE_ROOT);
  return inventory;
}


function validateCandidate(row, location, witnessIds) {
  if (!row || typeof row.name !== 'string' || !/^[a-z][A-Za-z0-9]+$/.test(row.name)) {
    fail(`${location}: invalid tool name`);
  }
  if (!VALID_STATES.has(row.state)) fail(`${row.name}: invalid state ${row.state}`);
  if (typeof row.contractDelta !== 'string' || row.contractDelta.trim().length < 20) {
    fail(`${row.name}: missing concrete contractDelta`);
  }
  if (REPLACEMENT_NAMES.has(row.name)) {
    if (row.state === 'replace' && !row.replacementReason) {
      fail(`${row.name}: replacementReason required`);
    }
    return;
  }
  if (row.state === 'replace' && !row.replacementReason) fail(`${row.name}: replacementReason required`);
  if (typeof row.domain !== 'string' || !row.domain.trim()) fail(`${row.name}: domain required`);
  if (typeof row.route !== 'string' || !row.route.trim()) fail(`${row.name}: implementation route required`);
  if (!Array.isArray(row.prerequisites) || row.prerequisites.length === 0
      || row.prerequisites.some((item) => typeof item !== 'string' || !item.trim())) {
    fail(`${row.name}: reviewed non-empty prerequisites required`);
  }
  if (row.prerequisites.some((id) => !witnessIds.has(id))) {
    fail(`${row.name}: unknown prerequisite witness contract`);
  }
  if (!Array.isArray(row.witnessContractIds)
      || row.witnessContractIds.length !== row.prerequisites.length
      || row.witnessContractIds.some((id, index) => id !== row.prerequisites[index])) {
    fail(`${row.name}: witnessContractIds must exactly match prerequisites`);
  }
  const expectedPrefix = `candidate.${row.name}.`;
  if (row.positiveTestID !== `${expectedPrefix}positive.v1`
      || row.negativeTestID !== `${expectedPrefix}negative.v1`
      || row.fixtureID !== `fixture.candidate.${row.name}.v1`) {
    fail(`${row.name}: stable candidate evidence identifiers required`);
  }
  if (row.evidenceArtifact !== `reports/evidence/candidates/${row.name}/<creator>-<artifact-sha>.json`) {
    fail(`${row.name}: canonical evidenceArtifact required`);
  }
  if (location.startsWith('reserve[')
      && (typeof row.proposedExecutionPhase !== 'string' || !/^P[1-6]$/.test(row.proposedExecutionPhase))) {
    fail(`${row.name}: reserve proposedExecutionPhase P1-P6 required`);
  }
}

function main() {
  const requireReady = process.argv.includes('--require-ready');
  const portfolioIndex = process.argv.indexOf('--portfolio-path');
  const portfolioPath = portfolioIndex >= 0 ? path.resolve(process.argv[portfolioIndex + 1]) : PORTFOLIO_PATH;
  const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
  const sourceNames = sourceToolNames();
  const baselineSourceNames = new Set([...sourceNames].filter((name) => !IMPLEMENTED_EXPANSION_NAMES.has(name)));
  const witnessContracts = JSON.parse(fs.readFileSync(WITNESS_CONTRACTS_PATH, 'utf8'));
  const witnessRows = witnessContracts.contracts || [];
  const witnessIds = new Set(witnessRows.map((row) => row.id));
  const primary = portfolio.domains.flatMap((domain) => domain.candidates.map((candidate) => ({ ...candidate, domain: domain.domain })));
  const reserve = portfolio.reserveCandidates || [];

  if (portfolio.schemaVersion !== 1) fail('unsupported portfolio schemaVersion');
  if (witnessContracts.schemaVersion !== 1 || witnessRows.length === 0 || witnessIds.size !== witnessRows.length) {
    fail('invalid or duplicate qualification witness contracts');
  }
  const witnessTestIds = new Set();
  for (const row of witnessRows) {
    if (row.status !== 'planned'
        || typeof row.fixtureId !== 'string'
        || row.positiveWitness?.testId !== `witness.${row.id}.positive.v1`
        || typeof row.positiveWitness?.expectedOutcome !== 'string'
        || row.negativeWitness?.testId !== `witness.${row.id}.negative.v1`
        || typeof row.negativeWitness?.expectedOutcome !== 'string'
        || typeof row.evidenceArtifactPattern !== 'string') {
      fail(`${row.id || '<unknown>'}: incomplete qualification witness contract`);
    }
    witnessTestIds.add(row.positiveWitness.testId);
    witnessTestIds.add(row.negativeWitness.testId);
  }
  if (witnessTestIds.size !== witnessRows.length * 2) fail('duplicate prerequisite witness test IDs');
  if (primary.length !== FROZEN_PRIMARY_COUNT) {
    fail(`primary portfolio must contain ${FROZEN_PRIMARY_COUNT} rows, found ${primary.length}`);
  }
  if (reserve.length !== FROZEN_RESERVE_COUNT) {
    fail(`reserve portfolio must contain ${FROZEN_RESERVE_COUNT} rows, found ${reserve.length}`);
  }
  primary.forEach((row, index) => validateCandidate(row, `primary[${index}]`, witnessIds));
  reserve.forEach((row, index) => validateCandidate(row, `reserve[${index}]`, witnessIds));

  const all = [...primary, ...reserve];
  const declaredPrerequisites = new Set(all
    .filter((row) => !REPLACEMENT_NAMES.has(row.name))
    .flatMap((row) => row.prerequisites));
  const unusedWitnessContracts = [...witnessIds].filter((id) => !declaredPrerequisites.has(id));
  if (unusedWitnessContracts.length) {
    fail(`unused qualification witness contracts: ${unusedWitnessContracts.join(', ')}`);
  }
  const names = all.map((row) => row.name);
  const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  if (duplicateNames.length) fail(`duplicate portfolio names: ${duplicateNames.join(', ')}`);
  const baselineOverlap = names.filter((name) => baselineSourceNames.has(name));
  if (baselineOverlap.length) fail(`portfolio names already registered: ${baselineOverlap.join(', ')}`);

  if (baselineSourceNames.size !== FROZEN_BASELINE_COUNT
      || portfolio.baseline.sourceRegistrations !== FROZEN_BASELINE_COUNT) {
    fail(`frozen cc-3x7 source baseline drift: expected ${FROZEN_BASELINE_COUNT}`);
  }
  if (portfolio.baseline.minimumReleaseCount !== FROZEN_MINIMUM_RELEASE_COUNT) {
    fail(`minimum release count drift: expected ${FROZEN_MINIMUM_RELEASE_COUNT}`);
  }
  const replacementRows = all.filter((row) => REPLACEMENT_NAMES.has(row.name));
  if (replacementRows.length !== REPLACEMENT_NAMES.size
      || replacementRows.some((row) => row.state !== 'replace' || !row.replacementReason)) {
    fail('replacement candidate classification drift');
  }

  const minimumReleaseCount = FROZEN_MINIMUM_RELEASE_COUNT;
  const minimumNet = minimumReleaseCount - FROZEN_BASELINE_COUNT;
  const approvalMargin = Math.max(10, Math.ceil(minimumNet * 0.15));
  const requiredApprovalCount = minimumNet + approvalMargin;
  if (requiredApprovalCount !== FROZEN_REQUIRED_APPROVAL_COUNT) {
    fail(`approval threshold drift: expected ${FROZEN_REQUIRED_APPROVAL_COUNT}`);
  }
  const countEligible = all.filter((row) => !REPLACEMENT_NAMES.has(row.name));
  const approvedCount = countEligible.filter((row) => row.state === 'approved' || row.state === 'implemented-unverified' || row.state === 'qualified').length;
  const potentiallyQualifiableCount = countEligible.filter((row) => row.state !== 'rejected').length;
  const readyForBulkImplementation = approvedCount >= FROZEN_REQUIRED_APPROVAL_COUNT;

  if (potentiallyQualifiableCount < requiredApprovalCount) {
    fail(`candidate pool too small: ${potentiallyQualifiableCount} potential, ${requiredApprovalCount} required`);
  }
  if (requireReady && !readyForBulkImplementation) {
    fail(`portfolio not approved: ${approvedCount} approved, ${requiredApprovalCount} required`);
  }

  console.log(JSON.stringify({
    ok: true,
    baselineCount: baselineSourceNames.size,
    registeredToolCount: sourceNames.size,
    expansionToolCount: IMPLEMENTED_EXPANSION_NAMES.size,
    primaryCandidateCount: primary.length,
    reserveCandidateCount: reserve.length,
    replaceCount: replacementRows.length,
    probeRequiredCount: all.filter((row) => row.state === 'probe-required').length,
    potentiallyQualifiableCount,
    minimumNet,
    approvalMargin,
    requiredApprovalCount,
    approvedCount,
    readyForBulkImplementation,
    dependencyMetadataComplete: countEligible.every((row) => (
      typeof row.domain === 'string'
      && typeof row.route === 'string'
      && Array.isArray(row.prerequisites)
      && row.prerequisites.length > 0
    )),
    witnessContractCount: witnessRows.length,
    evidencePlanComplete: countEligible.every((row) => (
      Array.isArray(row.witnessContractIds)
      && typeof row.positiveTestID === 'string'
      && typeof row.negativeTestID === 'string'
      && typeof row.fixtureID === 'string'
      && typeof row.evidenceArtifact === 'string'
    )),
  }));
}

try {
  main();
} catch (error) {
  console.error(`tool portfolio audit failed: ${error.message}`);
  process.exitCode = 1;
}
