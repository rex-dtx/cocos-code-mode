// API-availability probes for the seven non-runtime `probe-required` portfolio rows.
// Read-only except for the physics write, which rewrites the current value (idempotent).
const path = require('path');
const { postTool, getJson } = require(path.join(__dirname, '..', 'tests', 'helpers', 'utcp-client'));

const probe = async (label, context, code) => {
  const result = await postTool('executeJavascript', { context, code, timeout_ms: 45000 });
  const body = result.status === 200 ? result.body?.result : { httpError: result.status, body: result.body };
  console.log(`[${label}] ${JSON.stringify(body)}`);
};

(async () => {
  // 1/2. project-settings-write: does project/set-config exist, and is physics reachable?
  await probe('project-config', 'editor', `
    const config = await Editor.Message.request('project', 'query-config', 'project').catch((error) => ({ error: String(error.message || error) }));
    const keys = config && typeof config === 'object' ? Object.keys(config) : [];
    const physicsKeys = keys.filter((key) => /physic/i.test(key));
    const physics = {};
    for (const key of physicsKeys) physics[key] = config[key];
    return { topKeys: keys.slice(0, 40), physicsKeys, physics: JSON.stringify(physics).slice(0, 400) };
  `);
  await probe('project-set-config', 'editor', `
    const before = await Editor.Message.request('project', 'query-config', 'project').catch(() => null);
    const current = before && before.physics ? JSON.stringify(before.physics.gravity) : null;
    let outcome;
    try {
      const value = before && before.physics ? before.physics.gravity : undefined;
      const ok = await Editor.Message.request('project', 'set-config', 'project', 'physics.gravity', value);
      outcome = { exists: true, returned: ok };
    } catch (error) {
      outcome = { exists: false, error: String(error.message || error).slice(0, 160) };
    }
    return { current, outcome };
  `);

  // 3. particle-schema: does the component expose serialized fields, and do writes persist?
  await probe('particle-schema', 'scene', `
    const scene = cc.director.getScene();
    const node = new cc.Node('__ccb_probe__');
    node.parent = scene;
    const cls = cc.js.getClassByName('cc.ParticleSystem');
    const comp = node.addComponent(cls);
    const fields = [];
    for (const key in comp) if (key.startsWith('_') && !key.startsWith('__') && typeof comp[key] !== 'object') fields.push(key);
    await Editor.Message.request('scene', 'snapshot');
    const dump = await Editor.Message.request('scene', 'query-node', node.uuid);
    const index = dump.__comps__.findIndex((entry) => /ParticleSystem/.test(entry.type));
    const unwrap = (value) => (value && typeof value === 'object' && 'value' in value) ? value.value : value;
    const candidates = [['_capacity', 128], ['_simulationSpace', 0], ['_prewarm', true], ['_renderCulling', true]];
    const roundTrip = [];
    for (const [key, setTo] of candidates) {
      const before = unwrap(dump.__comps__[index].value[key]);
      let accepted = null;
      try { accepted = await Editor.Message.request('scene', 'set-property', { uuid: node.uuid, path: '__comps__.' + index + '.' + key, dump: { value: setTo, type: 'Unknown' } }); }
      catch (error) { accepted = 'error: ' + String(error.message || error).slice(0, 60); }
      await Editor.Message.request('scene', 'snapshot');
      const after = await Editor.Message.request('scene', 'query-node', node.uuid);
      roundTrip.push({ key, before, setTo, accepted, after: unwrap(after.__comps__[index].value[key]), persisted: JSON.stringify(unwrap(after.__comps__[index].value[key])) === JSON.stringify(setTo) });
    }
    node.destroy();
    await Editor.Message.request('scene', 'snapshot');
    return { componentIndex: index, scalarFields: fields.length, roundTrip };
  `).catch((error) => console.log('[particle-schema] probe failed:', error.message));

  // 4. light-bake-job-api: does the scene package expose any bake message?
  await probe('light-bake', 'editor', `
    const candidates = ['bake', 'bake-lightmap', 'lightmap-bake', 'bake-scene', 'generate-lightmap'];
    const results = {};
    for (const message of candidates) {
      try {
        const value = await Editor.Message.request('scene', message, {});
        results[message] = { exists: true, value: JSON.stringify(value ?? null).slice(0, 80) };
      } catch (error) {
        const text = String(error.message || error);
        results[message] = { exists: /does not exist|not found|unregistered/i.test(text) ? false : 'unknown', error: text.slice(0, 90) };
      }
    }
    return results;
  `);

  // 5. terrain-write-api: does cc.Terrain expose mutation methods?
  await probe('terrain-write', 'scene', `
    const names = [];
    const ctor = cc.Terrain || (cc.internal && cc.internal.Terrain);
    const seen = new Set();
    let proto = ctor && ctor.prototype;
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) if (!seen.has(key)) { seen.add(key); names.push(key); }
      proto = Object.getPrototypeOf(proto);
    }
    return { hasTerrain: Boolean(ctor), methods: names.filter((n) => /set|edit|write|apply|build|import|create|upload/i.test(n)).slice(0, 40), total: names.length };
  `);

  // 6/7. localization-package-api: is the package present and message-addressable?
  await probe('localization-package', 'editor', `
    let packages = [];
    try {
      const list = await Editor.Package.getPackages({});
      packages = (list || []).map((entry) => entry && entry.name).filter(Boolean);
    } catch (error) {
      packages = ['error: ' + String(error.message || error).slice(0, 60)];
    }
    const localizationPackages = packages.filter((name) => /local/i.test(String(name)));
    const candidates = ['query-localization', 'query-languages', 'query-assets'];
    const messages = {};
    for (const message of candidates) {
      try {
        await Editor.Message.request('localization-manager', message);
        messages[message] = { exists: true };
      } catch (error) {
        const text = String(error.message || error);
        messages[message] = { exists: /does not exist|not found|unregistered|unknown/i.test(text) ? false : 'unknown', error: text.slice(0, 80) };
      }
    }
    return { localizationPackages, messages };
  `);

  // Scene-side localization seam used by localizationValidate.
  await probe('localization-scene-seam', 'scene', `
    try {
      const mod = require('db://localization-editor/l10n');
      return { resolved: true, hasL10n: Boolean(mod && mod.l10n) };
    } catch (error) {
      return { resolved: false, error: String(error.message || error).slice(0, 120) };
    }
  `);

  const info = await getJson('/build-info');
  console.log('[artifact]', JSON.stringify(info.body));
})();
