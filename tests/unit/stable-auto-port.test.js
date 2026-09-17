'use strict';
const {it} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {requireDist} = require('../helpers/require-dist');
const {UtcpConfigManager} = requireDist('utcp/config-manager.js');
async function listen(port=0){const server=net.createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r)});return server;}
it('prunes closed CCB endpoints but keeps currently listening editors and unrelated templates', async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ccb-prune-')), file=path.join(dir,'config.json');
 const live=await listen(), livePort=live.address().port, closedServer=await listen(), closedPort=closedServer.address().port;await new Promise(r=>closedServer.close(r));
 const variables={['CCB3X_OWNER_'+livePort]:'a'.repeat(32),['CCB3X_OWNER_'+closedPort]:'b'.repeat(32),['CCB3X_PROJECT_'+closedPort]:'old'};
 fs.writeFileSync(file,JSON.stringify({variables,manual_call_templates:[{name:'other',url:'http://localhost:1/utcp'},{name:'ccb3x_'+livePort,url:`http://localhost:${livePort}/utcp`},{name:'ccb3x_'+closedPort,url:`http://localhost:${closedPort}/utcp`}]}));
 const original=global.Editor;global.Editor={Project:{path:path.join(dir,'project')},Profile:{setConfig:async()=>{}}};
 try{const manager=UtcpConfigManager.getInstance();await manager.setConfigPath(file);await manager.ensureCocosEditorTemplate(45000,'c'.repeat(32),global.Editor.Project.path);const c=manager.readConfig();assert.ok(c.manual_call_templates.some(x=>x.name==='ccb3x_'+livePort));assert.ok(!c.manual_call_templates.some(x=>x.name==='ccb3x_'+closedPort));assert.ok(c.manual_call_templates.some(x=>x.name==='other'));assert.equal(c.variables['CCB3X_OWNER_'+closedPort],undefined);assert.equal(c.variables.CCB3X_PROJECT_45000,path.normalize(global.Editor.Project.path));}finally{await new Promise(r=>live.close(r));global.Editor=original;fs.rmSync(dir,{recursive:true,force:true});}
});
