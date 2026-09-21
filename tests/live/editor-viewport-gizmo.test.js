'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase, healthCheck, getCanvasReference } = require('../helpers/utcp-client');

const fixtureName = `__ccp3x_gizmo_${process.pid}__`;
const selectionPasses = Math.min(10, Math.max(1, Number(process.env.CCB_SELECTION_PASSES || 5) || 5));

async function selectNodeRepeatedly(reference) {
  for (let pass = 1; pass <= selectionPasses; pass++) {
    const selected = await postTool('editorSelect', { operation: 'select', references: [reference] });
    assert.equal(selected.ok, true, `selection pass ${pass}: ${JSON.stringify(selected.body)}`);
    assert.ok(selected.body.selected.includes(reference.id), `selection pass ${pass} missed ${reference.id}`);
  }
}

async function deleteNode(reference) {
  if (reference?.id) await postTool('nodeOperate', { operation: 'delete', reference });
}

describe('live: editor viewport and gizmo workflows', { concurrency: false }, () => {
  it('selects and focuses a random UI node, then controls gizmo state', async (t) => {
    const health = await healthCheck();
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    await repeatTestcase('VP-F01-G01', async () => {
      let reference;
      let initialViewport;
      let initialGizmo;
      try {
        const created = await postTool('createUiNode', {
          uiType: 'Widget',
          name: `${fixtureName}${Date.now()}`,
          parentReference: canvas,
        });
        assert.equal(created.ok, true, JSON.stringify(created.body));
        reference = created.body.reference;
        initialViewport = (await postTool('editorViewport', { operation: 'query_viewport' })).body;
        initialGizmo = (await postTool('editorViewport', { operation: 'query_gizmo' })).body;
        const x = Math.floor(Math.random() * 900) - 450;
        const y = Math.floor(Math.random() * 500) - 250;
        const positioned = await postTool('nodeBatchSet', {
          entries: [{ reference, propertyPaths: ['position.x', 'position.y'], values: [x, y] }],
        });
        assert.equal(positioned.ok, true, JSON.stringify(positioned.body));
        const cleared = await postTool('editorSelect', { operation: 'clear' });
        assert.equal(cleared.ok, true, JSON.stringify(cleared.body));
        await selectNodeRepeatedly(reference);
        const focused = await postTool('editorViewport', { operation: 'focus', references: [reference] });
        assert.equal(focused.ok, true, JSON.stringify(focused.body));
        for (const [operation, body] of [
          ['set_2d_mode', { enabled: true }],
          ['set_grid_visible', { enabled: true }],
          ['set_gizmo_tool', { gizmoTool: 'move' }],
          ['set_gizmo_pivot', { gizmoPivot: 'center' }],
          ['set_gizmo_coordinate', { gizmoCoordinate: 'global' }],
          ['set_icon_gizmo_size', { size: 32 }],
        ]) {
          const result = await postTool('editorViewport', { operation, ...body });
          assert.equal(result.ok, true, `${operation}: ${JSON.stringify(result.body)}`);
        }
        const gizmo = await postTool('editorViewport', { operation: 'query_gizmo' });
        assert.equal(gizmo.ok, true, JSON.stringify(gizmo.body));
        assert.equal(gizmo.body.gizmoTool, 'position');
        assert.equal(gizmo.body.gizmoPivot, 'center');
        assert.equal(gizmo.body.gizmoCoordinate, 'global');
        const viewport = await postTool('editorViewport', { operation: 'query_viewport' });
        assert.equal(viewport.ok, true, JSON.stringify(viewport.body));
        assert.equal(viewport.body.is2D, true);
        assert.equal(viewport.body.gridVisible, true);
        assert.equal(viewport.body.iconGizmoSize, 32);
        const aligned = await postTool('editorViewport', { operation: 'align_view_to_selected_node' });
        assert.equal(aligned.ok, true, JSON.stringify(aligned.body));
      } finally {
        if (initialGizmo?.gizmoPivot) await postTool('editorViewport', { operation: 'set_gizmo_pivot', gizmoPivot: initialGizmo.gizmoPivot });
        if (initialGizmo?.gizmoCoordinate) await postTool('editorViewport', { operation: 'set_gizmo_coordinate', gizmoCoordinate: initialGizmo.gizmoCoordinate });
        if (typeof initialViewport?.is2D === 'boolean') await postTool('editorViewport', { operation: 'set_2d_mode', enabled: initialViewport.is2D });
        if (typeof initialViewport?.gridVisible === 'boolean') await postTool('editorViewport', { operation: 'set_grid_visible', enabled: initialViewport.gridVisible });
        if (initialGizmo?.gizmoTool) {
          const toolName = { position: 'move', rotation: 'rotate', scale: 'scale', rect: 'rect' }[initialGizmo.gizmoTool] || initialGizmo.gizmoTool;
          await postTool('editorViewport', { operation: 'set_gizmo_tool', gizmoTool: toolName });
        }
        await deleteNode(reference);
        await postTool('editorSelect', { operation: 'clear' });
      }
    });
  });

  it('returns a bounded viewport state snapshot', async () => {
    await repeatTestcase('VP-E01', async () => {
      const result = await postTool('editorViewport', { operation: 'query_viewport' });
      assert.equal(result.ok, true, JSON.stringify(result.body));
      assert.equal(typeof result.body.is2D, 'boolean');
      assert.equal(typeof result.body.gridVisible, 'boolean');
      assert.equal(typeof result.body.iconGizmo3D, 'boolean');
      assert.equal(typeof result.body.iconGizmoSize, 'number');
    });
  });

});
