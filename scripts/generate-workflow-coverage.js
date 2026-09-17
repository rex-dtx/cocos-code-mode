#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const writeJson = (relative, value) => fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(value, null, 2)}\n`);

const competitor = readJson('reports/original-competitor-intake-20260917.json');
const lanes = readJson('reports/original-lane-requirements-20260917.json');
const portfolio = readJson('docs/tool-portfolio-candidates.json');
const supplementaryCoverage = readJson('reports/competitor-workflow-coverage-20260912.json');
const supplementaryByName = new Map();
for (const row of supplementaryCoverage.rows) {
  const entries = supplementaryByName.get(row.competitorTool) || [];
  entries.push(row);
  supplementaryByName.set(row.competitorTool, entries);
}
const portfolioRows = [
  ...portfolio.domains.flatMap(domain => domain.candidates.map(row => ({ ...row, domain: domain.domain }))),
  ...(portfolio.reserveCandidates || []).map(row => ({ ...row, domain: row.domain || 'reserve' })),
];
const portfolioByName = new Map(portfolioRows.map(row => [row.name, row]));

const toolRows = [];
for (const file of fs.readdirSync(path.join(ROOT, 'source/utcp/tools'))) {
  if (!file.endsWith('.ts')) continue;
  const source = fs.readFileSync(path.join(ROOT, 'source/utcp/tools', file), 'utf8');
  for (const match of source.matchAll(/@utcpTool\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)/g)) {
    toolRows.push({ name: match[1], description: match[2], file: `source/utcp/tools/${file}` });
  }
}
toolRows.push({ name: 'executeJavascript', description: 'Execute reviewed local JavaScript in editor or scene context.', file: 'source/utcp/execute/execute-tool.ts' });
const toolByName = new Map(toolRows.map(row => [row.name, row]));

const STOP = new Set(['get', 'set', 'query', 'list', 'create', 'delete', 'remove', 'add', 'open', 'close', 'run', 'start', 'stop', 'manage', 'inspect', 'validate', 'control', 'configure', 'apply', 'current', 'all', 'by', 'of', 'the']);
const words = value => String(value)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  .filter(Boolean).filter(word => !STOP.has(word));
const tokenSet = value => new Set(words(value));
const score = (left, right) => {
  const a = tokenSet(left), b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  return common / Math.max(a.size, b.size);
};
const slug = value => words(value).join('-') || 'workflow';

const DOMAIN_RULES = [
  ['animation', /anim|clip|curve|keyframe|skeleton|skeletal|spine|dragon|retarget/],
  ['audio', /audio|sound|music|volume/],
  ['asset', /asset|import|bundle|texture|atlas|resource|file|manifest|dependenc|reference/],
  ['build', /build|publish|server|network|preview-server|project-run/],
  ['diagnostics', /debug|log|console|diagnostic|performance|validate|health/],
  ['editor', /preference|selection|broadcast|viewport|gizmo|reference-image|editor/],
  ['localization', /locali|locale|language|glyph|font/],
  ['physics', /physics|rigid|collider|joint|raycast|contact/],
  ['prefab', /prefab/],
  ['runtime', /runtime|preview|input|screenshot|capture|play|pause|resume|simulate/],
  ['scene', /scene|node|component|hierarchy|camera|ui|layout|canvas|label|sprite|button/],
  ['rendering', /render|material|shader|light|terrain|model|mesh|particle|fog|skybox/],
  ['product', /update|install|tool|server-status|connectivity|network-interface/],
];
const domainFor = value => (DOMAIN_RULES.find(([, pattern]) => pattern.test(String(value).toLowerCase())) || ['other'])[0];

const ALIASES = new Map(Object.entries({
  play_animation: 'animationRuntimeControl', stop_animation: 'animationRuntimeControl', list_animations: 'animationCatalogInspect', add_animation_clip: 'animationClipConfigure',
  start_preview_server: 'buildArtifactServe', stop_preview_server: 'buildArtifactServe', run_project: 'runtimePreviewControl',
  capture_scene_screenshot: 'captureSceneScreenshot', capture_preview_screenshot: 'runtimeScreenshotAssert', capture_desktop_screenshot: 'captureEditorScreenshot',
  instantiate_prefab: 'prefabInstantiate', update_prefab: 'prefabApplyOverrides', revert_prefab: 'prefabRevertOverrides', restore_prefab_node: 'prefabRevertOverrides',
  get_asset_dependencies: 'assetFindReferences', get_unused_assets: 'assetUsageAnalyze', compress_textures: 'assetCompressionConfigure', export_asset_manifest: 'assetManifestExport',
  batch_import_assets: 'assetBatchImport', batch_delete_assets: 'assetBatchOperate', validate_asset_references: 'assetMissingReferenceAudit',
  get_current_scene: 'sceneGetInfo', get_scene_hierarchy: 'nodeGetTree', get_node_tree: 'nodeGetTree', find_nodes: 'findNodes',
  get_console_logs: 'editorGetLogs', clear_console: 'editorClearLogs', execute_script: 'executeJavascript', get_performance_stats: 'getPerformanceSnapshot',
  get_editor_selection: 'editorSelect', get_selection: 'editorSelect', set_selection: 'editorSelect',
  create_button: 'createUiNode', create_canvas: 'createUiNode', create_label: 'createLabel', create_sprite: 'createUiNode',
  list_assets: 'assetQuery', list_scenes: 'assetQuery', select_asset: 'editorSelect', inspect_asset: 'assetQuery', inspect_asset_dependencies: 'assetFindReferences',
  create_prefab_from_node: 'nodeOperate', apply_prefab_instance: 'prefabApplyOverrides', inspect_prefab: 'readPrefabJson', inspect_prefab_instance: 'prefabOverrideDiff', list_prefabs: 'assetQuery', validate_prefab_references: 'prefabReferenceAudit',
  get_preview_mode: 'runtimePreviewControl', run_scene_asset: 'runtimePreviewControl', run_project_preview: 'runtimePreviewControl',
  get_build_status: 'buildManage', query_server_ip_list: 'editorEnvInfo', query_sorted_server_ip_list: 'editorEnvInfo', get_network_interfaces: 'editorEnvInfo',
  clear_logs: 'editorClearLogs', get_recent_logs: 'editorGetLogs', list_directory: 'projectListDirectory', exists: 'projectFileExists', get_file_snippet: 'projectReadFile',
  open_preferences_settings: 'getEditorPreference', reset_preferences: 'setEditorPreference', export_preferences: 'getEditorPreference', import_preferences: 'setEditorPreference',
  list_project_instructions: 'readProjectInstruction', create_project_skill: 'writeProjectInstruction', create_cocos_mcp_project_skill: 'writeProjectInstruction',
  get_tool_catalog: 'editorState', save_current_scene: 'sceneManage', create_camera: 'nodeCreatePrimitive',
  validate_json_params: 'executeJavascript', safe_string_value: 'executeJavascript', format_mcp_request: 'executeJavascript', execute_editor_script: 'executeJavascript', broadcast_editor_message: 'broadcastObserve',
  inspect_prefab_instance: 'prefabOverrideDiff',
}));

function bestTool(name, description = '') {
  const alias = ALIASES.get(name);
  if (alias && toolByName.has(alias)) return { tool: alias, score: 1, route: toolByName.get(alias) };
  let best = null;
  for (const tool of toolRows) {
    const current = Math.max(score(name, tool.name), score(`${name} ${description}`, `${tool.name} ${tool.description}`) * 0.85);
    if (!best || current > best.score) best = { tool: tool.name, score: current, route: tool };
  }
  return best && best.score >= 0.62 ? best : null;
}

const p1Sources = [
  ['parent:runtime-session', 'Attach and identify one bounded Game View runtime session with truthful lifecycle state.'],
  ['parent:runtime-input', 'Dispatch allow-listed input to the intended runtime target.'],
  ['parent:runtime-capture', 'Capture bounded runtime visual evidence and compare stable signatures.'],
  ['parent:runtime-observation', 'Observe allow-listed runtime state without arbitrary execution.'],
  ['parent:compound-scene', 'Create a complete scene/UI composition with stable identities.'],
  ['parent:mutation-workflow', 'Mutate editor state with preflight, postcondition and recovery semantics.'],
  ['parent:long-job', 'Track one build/import job to a bounded terminal outcome.'],
  ['parent:golden-tracer', 'Run scene to preview, input, observation, screenshot, build and launched artifact smoke.'],
].map(([id, outcome]) => ({ id, name: id.split(':')[1], outcome, source: 'parent-plan' }));

const workflows = new Map();
const mappings = [];
function ensureWorkflow(id, seed) {
  if (!workflows.has(id)) workflows.set(id, {
    id, domain: seed.domain, title: seed.title, observableOutcome: seed.outcome,
    creatorVersion: '3.7.3', platform: 'windows-x64', executionContext: seed.executionContext || 'editor-or-runtime',
    preconditions: [], operations: [], effects: seed.effects || 'mixed', persistenceRequirement: seed.persistenceRequirement || 'as-applicable',
    sourceRequirementIds: [], competitorSourceIds: [], portfolioNames: [], implementationRoute: [], compositionRecipe: [],
    implementationState: 'missing', limitations: [], verificationIds: [], evidenceArtifacts: [],
    denominatorDisposition: 'included', dispositionReason: 'Original in-scope workflow outcome.', owner: 'api-capability-expansion', updated: '2026-09-17',
  });
  return workflows.get(id);
}

for (const row of lanes.rows) {
  const portfolioRow = portfolioByName.get(row.name);
  const domain = portfolioRow?.domain || domainFor(`${row.name} ${row.requirement}`);
  const id = `${domain}.${slug(row.name)}`;
  const workflow = ensureWorkflow(id, { domain, title: row.name, outcome: portfolioRow?.contractDelta || row.requirement });
  const sourceId = `lane:${row.source.replace('/plan.md', '')}:${row.name}`;
  workflow.sourceRequirementIds.push(sourceId);
  if (portfolioRow) workflow.portfolioNames.push(row.name);
  mappings.push({ sourceId, sourceKind: 'lane-requirement', sourceName: row.name, workflowId: id, mapping: 'primary', rationale: 'Named original child-plan requirement.' });
}
for (const source of p1Sources) {
  const domain = source.name.startsWith('runtime') ? 'runtime' : source.name.includes('scene') || source.name.includes('mutation') ? 'scene' : 'build';
  const id = `${domain}.${slug(source.name)}`;
  const workflow = ensureWorkflow(id, { domain, title: source.name, outcome: source.outcome });
  workflow.sourceRequirementIds.push(source.id);
  mappings.push({ sourceId: source.id, sourceKind: 'parent-requirement', sourceName: source.name, workflowId: id, mapping: 'primary', rationale: 'Explicit parent foundation requirement.' });
}

for (const [index, row] of competitor.rows.entries()) {
  const sourceId = `${row.catalog === 'Funplay' ? 'funplay' : 'cocos-mcp'}:${row.name}`;
  const supplementary = (supplementaryByName.get(row.name) || []).find(entry => Array.isArray(entry.ccbTools) && entry.ccbTools.length > 0);
  const supplementaryTool = supplementary?.ccbTools.find(name => toolByName.has(name));
  const matchedTool = supplementaryTool
    ? { tool: supplementaryTool, score: 1, route: toolByName.get(supplementaryTool), supplementary }
    : bestTool(row.name, row.contract || '');
  let workflow = null;
  if (matchedTool) {
    workflow = [...workflows.values()].find(item => item.portfolioNames.includes(matchedTool.tool));
    if (!workflow) {
      const domain = domainFor(`${row.name} ${matchedTool.tool}`);
      workflow = ensureWorkflow(`${domain}.${slug(matchedTool.tool)}`, { domain, title: matchedTool.tool, outcome: matchedTool.route.description });
    }
  }
  if (!workflow) {
    const domain = domainFor(`${row.name} ${row.contract || ''}`);
    workflow = ensureWorkflow(`${domain}.${slug(row.name)}`, { domain, title: row.name, outcome: row.contract || `Provide the ${row.name} observable outcome.` });
  }
  if (matchedTool && !workflow.implementationRoute.some(route => route.tool === matchedTool.tool)) {
    workflow.implementationRoute.push({ tool: matchedTool.tool, file: matchedTool.route.file });
  }
  workflow.competitorSourceIds.push(sourceId);
  mappings.push({ sourceId, sourceKind: 'competitor-row', sourceName: row.name, workflowId: workflow.id,
    mapping: matchedTool?.supplementary ? 'reviewed-supplementary' : matchedTool?.score === 1 ? 'exact-name-provisional' : matchedTool ? 'heuristic-provisional' : 'competitor-only', rationale: matchedTool?.supplementary ? `Reused supplementary mapping to ${matchedTool.tool}; original contract equivalence still requires acceptance review.` : matchedTool ? `Best bounded CCB route: ${matchedTool.tool} (token score ${matchedTool.score.toFixed(2)}). Requires contract review.` : 'No sufficiently similar current public route found.' });
}

const KNOWN_OVERRIDES = {
  'prefab.prefab-apply-overrides': ['complete', 'Whole-instance apply uses native operation plus source/instance postcondition; selective revert is separate.'],
  'audio.audio-playback-control': ['missing', 'Public route fails closed; no qualified actual-Game-View audio component transport.'],
  'audio.audio-playback-observe': ['missing', 'Public route fails closed; no qualified actual-Game-View audio observation transport.'],
  'particles.particle-playback': ['missing', 'Extension scene scripts target edit renderer; actual Game View particle route is unqualified.'],
  'runtime.runtime-session': ['partial', 'Finite actual-Game-View host adapter exists; cold-start/stop repeatability on qualification fixture remains open.'],
};

for (const workflow of workflows.values()) {
  const routes = new Map(workflow.implementationRoute.map(route => [route.tool, toolByName.get(route.tool) || route]));
  for (const name of workflow.portfolioNames) if (toolByName.has(name)) routes.set(name, toolByName.get(name));
  for (const sourceId of workflow.competitorSourceIds) {
    const sourceName = sourceId.slice(sourceId.indexOf(':') + 1);
    const match = bestTool(sourceName);
    if (match) routes.set(match.tool, match.route);
  }
  workflow.implementationRoute = [...routes.values()].map(route => ({ tool: route.name, file: route.file }));
  for (const route of workflow.implementationRoute) {
    if (!workflow.portfolioNames.includes(route.tool) && portfolioByName.has(route.tool)) workflow.portfolioNames.push(route.tool);
  }
  const states = workflow.portfolioNames.map(name => portfolioByName.get(name)?.state).filter(Boolean);
  if (states.includes('qualified')) workflow.implementationState = 'complete';
  else if (states.includes('implemented-unverified') || states.includes('approved')) workflow.implementationState = 'test-pending';
  else if (states.includes('probe-required') || states.includes('candidate')) workflow.implementationState = workflow.implementationRoute.length ? 'partial' : 'missing';
  else if (workflow.implementationRoute.length) workflow.implementationState = 'complete';
  if (workflow.portfolioNames.some(name => portfolioByName.get(name)?.state === 'replace')) {
    workflow.implementationState = 'excluded'; workflow.denominatorDisposition = 'excluded'; workflow.dispositionReason = 'Explicit replacement row; original outcome must map elsewhere before freeze.';
  }
  const override = KNOWN_OVERRIDES[workflow.id];
  if (override) { workflow.implementationState = override[0]; workflow.limitations.push(override[1]); }
  workflow.sourceRequirementIds = [...new Set(workflow.sourceRequirementIds)];
  workflow.competitorSourceIds = [...new Set(workflow.competitorSourceIds)];
  workflow.portfolioNames = [...new Set(workflow.portfolioNames)];
}

const inventoryRows = [...workflows.values()].sort((a, b) => a.id.localeCompare(b.id));
const included = inventoryRows.filter(row => row.denominatorDisposition === 'included');
const complete = included.filter(row => row.implementationState === 'complete');
const byDomain = {};
for (const row of included) {
  byDomain[row.domain] ||= { total: 0, complete: 0, partial: 0, missing: 0, testPending: 0, unsupported: 0 };
  const bucket = byDomain[row.domain]; bucket.total++;
  if (row.implementationState === 'complete') bucket.complete++;
  else if (row.implementationState === 'partial') bucket.partial++;
  else if (row.implementationState === 'missing') bucket.missing++;
  else if (row.implementationState === 'test-pending') bucket.testPending++;
  else if (row.implementationState === 'unsupported') bucket.unsupported++;
}
for (const bucket of Object.values(byDomain)) bucket.percent = bucket.total ? Number((bucket.complete * 100 / bucket.total).toFixed(2)) : 0;
const targetComplete = Math.ceil(included.length * 0.90);
const marginComplete = Math.min(included.length, Math.max(targetComplete + 2, Math.ceil(included.length * 0.92)));
const candidates = included.filter(row => row.implementationState !== 'complete').map(row => ({
  workflowId: row.id, domain: row.domain, state: row.implementationState, title: row.title,
  routeCount: row.implementationRoute.length, priorityScore: (row.implementationState === 'test-pending' ? 5 : row.implementationState === 'partial' ? 3 : 1) + row.competitorSourceIds.length,
  acceptance: `Implement the complete '${row.observableOutcome}' contract with truthful failure behavior and focused verification.`,
})).sort((a, b) => b.priorityScore - a.priorityScore || a.workflowId.localeCompare(b.workflowId));
const classificationReview = included.filter(row => row.implementationState !== 'complete' || row.competitorSourceIds.length >= 3).map(row => ({
  workflowId: row.id, state: row.implementationState,
  sourceFanIn: row.competitorSourceIds.length + row.sourceRequirementIds.length,
  implementationRoutes: row.implementationRoute, limitations: row.limitations,
  reviewReason: row.implementationState === 'complete' && row.competitorSourceIds.length >= 3
    ? 'High-fan-in complete classification requires adversarial equivalence review.'
    : 'Incomplete classification requires contract or transport decision.',
})).sort((a, b) => b.sourceFanIn - a.sourceFanIn || a.workflowId.localeCompare(b.workflowId));

const inputHashes = {};
for (const relative of ['reports/original-competitor-intake-20260917.json', 'reports/original-lane-requirements-20260917.json', 'reports/competitor-workflow-coverage-20260912.json', 'docs/tool-portfolio-candidates.json']) {
  inputHashes[relative] = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
}
const generatedAt = new Date().toISOString();
writeJson('docs/workflow-inventory.json', { schemaVersion: 1, denominatorVersion: 'ccb3x-creator-3.7.3-windows-v1-draft', generatedAt, qualificationProfile: { creator: '3.7.3', os: 'windows-x64', profile: 'full', artifactClass: 'local-operator' }, inputHashes, status: 'draft-requires-contract-review', acceptanceBlockedBy: ['provisional competitor mappings require manual review', 'competitor-only rows require explicit route/disposition decisions', 'P3/P4 declared-vs-listed requirement mismatch remains unresolved'], rows: inventoryRows });
writeJson('docs/workflow-source-mapping.json', { schemaVersion: 1, denominatorVersion: 'ccb3x-creator-3.7.3-windows-v1-draft', generatedAt, sourceCounts: { competitor: competitor.rows.length, lane: lanes.rows.length, parent: p1Sources.length }, rows: mappings.sort((a, b) => a.sourceId.localeCompare(b.sourceId)) });
writeJson('docs/workflow-implementation-evidence.json', { schemaVersion: 1, denominatorVersion: 'ccb3x-creator-3.7.3-windows-v1-draft', generatedAt, rows: inventoryRows.map(row => ({ workflowId: row.id, state: row.implementationState, routes: row.implementationRoute, limitations: row.limitations, verificationIds: row.verificationIds, evidenceArtifacts: row.evidenceArtifacts })) });
writeJson('reports/workflow-coverage-report.json', { schemaVersion: 1, denominatorVersion: 'ccb3x-creator-3.7.3-windows-v1-draft', generatedAt, status: 'draft-not-accepted', denominator: included.length, complete: complete.length, implementationPercent: Number((complete.length * 100 / included.length).toFixed(2)), targetPercent: 90, targetComplete, deficitTo90: Math.max(0, targetComplete - complete.length), marginComplete, deficitToMargin: Math.max(0, marginComplete - complete.length), mappingReview: { reviewedSupplementary: mappings.filter(row => row.mapping === 'reviewed-supplementary').length, exactNameProvisional: mappings.filter(row => row.mapping === 'exact-name-provisional').length, heuristicProvisional: mappings.filter(row => row.mapping === 'heuristic-provisional').length, competitorOnly: mappings.filter(row => row.mapping === 'competitor-only').length }, byDomain, stateCounts: inventoryRows.reduce((acc, row) => (acc[row.implementationState] = (acc[row.implementationState] || 0) + 1, acc), {}), caveats: ['Automated semantic mapping is conservative and requires human contract review before denominator acceptance.', 'Historical qualification labels do not override broader original workflow requirements.', 'Verification >=95% remains a separate parent gate.'] });
writeJson('reports/workflow-closure-backlog.json', { schemaVersion: 1, denominatorVersion: 'ccb3x-creator-3.7.3-windows-v1-draft', generatedAt, requiredFor90: Math.max(0, targetComplete - complete.length), requiredWithMargin: Math.max(0, marginComplete - complete.length), selectionRule: 'Prefer test-pending, then partial routes with proven Creator3.7.3 transport, then missing high-source-fan-in workflows.', rows: candidates.slice(0, Math.max(25, marginComplete - complete.length + 10)) });
writeJson('reports/workflow-classification-review.json', { schemaVersion: 1, denominatorVersion: 'ccb3x-creator-3.7.3-windows-v1-draft', generatedAt, status: 'open-review-queue', rows: classificationReview });
console.log(JSON.stringify({ ok: true, workflows: inventoryRows.length, included: included.length, complete: complete.length, percent: Number((complete.length * 100 / included.length).toFixed(2)), mappings: mappings.length, targetComplete, deficitTo90: Math.max(0, targetComplete - complete.length) }));
