'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getJson, postTool } = require('./utcp-client');

const DEFAULT_MANIFEST = path.resolve('G:/_ws/_helpers/cc-3x-test/assets/__ccb3x_qualification__.json');

function readQualificationManifest(manifestPath = process.env.CCB_QUALIFICATION_MANIFEST || DEFAULT_MANIFEST) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.scene.uuid, /^[0-9a-f-]{36}$/i);
  return manifest;
}

async function ensureQualificationScene(manifest = readQualificationManifest()) {
  let info = await getJson('/tools/sceneGetInfo');
  assert.equal(info.status, 200, JSON.stringify(info.body));
  if (info.body.currentScene?.uuid !== manifest.scene.uuid) {
    const opened = await postTool('sceneManage', {
      operation: 'open',
      reference: { id: manifest.scene.uuid, type: 'cc.SceneAsset' },
    });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.success, true);
    info = await getJson('/tools/sceneGetInfo');
  }
  assert.equal(info.body.currentScene?.uuid, manifest.scene.uuid);
  assert.equal(info.body.dirty, false);

  const tree = await getJson('/tools/nodeGetTree');
  assert.equal(tree.status, 200, JSON.stringify(tree.body));
  const byPath = new Map();
  const visit = (node) => {
    if (node.path) byPath.set(node.path, node);
    for (const child of node.children || []) visit(child);
  };
  visit(tree.body);
  for (const key of ['canvas', 'camera', 'label', 'sprite', 'animation']) {
    const fixture = manifest.fixtures[key];
    const node = byPath.get(fixture.path);
    assert.ok(node, `qualification fixture ${fixture.path} is missing`);
    assert.equal(node.reference.id, fixture.uuid, `qualification fixture ${fixture.path} UUID changed`);
  }
  const clip = await getJson(`/tools/assetQuery?pattern=${encodeURIComponent(manifest.fixtures.animationClip.path)}`);
  assert.equal(clip.status, 200, JSON.stringify(clip.body));
  assert.equal(clip.body.total, 1);
  assert.equal(clip.body.assets[0].uuid, manifest.fixtures.animationClip.uuid);
  return { manifest, info: info.body, tree: tree.body };
}

module.exports = { DEFAULT_MANIFEST, readQualificationManifest, ensureQualificationScene };
