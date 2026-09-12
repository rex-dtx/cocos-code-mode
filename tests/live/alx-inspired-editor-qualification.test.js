'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: ALX-inspired editor ergonomics', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('resolves bounded reverse paths and aligns/distributes sibling UI nodes', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const fixture = await postTool('executeJavascript', {
      context: 'scene',
      code: `const { director, Node, UITransform }=require('cc');const sc=director.getScene();const old=sc.getChildByName('__ccb3x_ergonomics__');if(old){old.removeFromParent();old.destroy();}const root=new Node('__ccb3x_ergonomics__');sc.addChild(root);const ids=[];for(const [i,x] of [0,100,260].entries()){const n=new Node('item'+i);n.parent=root;n.setPosition(x,0,0);const ui=n.addComponent(UITransform);ui.setContentSize(20+i*10,10);ids.push(n.uuid);}return {root:root.uuid,ids};`,
    });
    assert.equal(fixture.ok, true, JSON.stringify(fixture.body));
    const { root, ids } = fixture.body.result;
    try {
      const relative = await getJson(`/tools/nodeGetPath?reference%5Bid%5D=${encodeURIComponent(ids[1])}&relativeTo%5Bid%5D=${encodeURIComponent(root)}&includeRoot=false`);
      assert.equal(relative.ok, true, JSON.stringify(relative.body));
      assert.equal(relative.body.path, 'item1');
      assert.deepEqual(relative.body.segments, ['item1']);

      const outside = await getJson(`/tools/nodeGetPath?reference%5Bid%5D=${encodeURIComponent(root)}&relativeTo%5Bid%5D=${encodeURIComponent(ids[0])}`);
      assert.equal(outside.status, 404, JSON.stringify(outside.body));

      const align = await postTool('uiLayoutAlign', {
        references: ids.slice(0, 2).map((id) => ({ id, type: 'cc.Node' })),
        operation: 'align', axis: 'horizontal', edge: 'left',
      });
      assert.equal(align.ok, true, JSON.stringify(align.body));
      assert.equal(align.body.layouts[0].worldRect.x, align.body.layouts[1].worldRect.x);

      const distribute = await postTool('uiLayoutAlign', {
        references: ids.map((id) => ({ id, type: 'cc.Node' })),
        operation: 'distribute', axis: 'horizontal',
      });
      assert.equal(distribute.ok, true, JSON.stringify(distribute.body));
      const rectangles = [...distribute.body.layouts].map((item) => item.worldRect).sort((left, right) => left.x - right.x);
      const firstGap = rectangles[1].x - rectangles[0].x - rectangles[0].width;
      const secondGap = rectangles[2].x - rectangles[1].x - rectangles[1].width;
      assert.ok(Math.abs(firstGap - secondGap) < 0.001, JSON.stringify(rectangles));
      assert.equal(distribute.body.layouts.length, 3);
    } finally {
      await postTool('nodeOperate', { operation: 'delete', reference: { id: root, type: 'cc.Node' } });
    }
  });
});
