const base='http://localhost:49650';
async function run(code){ const r=await fetch(base+'/tools/executeJavascript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:'scene',code})}); return r.json(); }
(async()=>{
  let j=await run('const skel=(()=>{const sc=cc.director.getScene();let s=null;const st=[sc];while(st.length&&!s){const n=st.pop();for(const c of n.children||[]) st.push(c); for(const c of n.components||[]) if(c.constructor&&c.constructor.name==="Skeleton"){s=c;break;} } return s;})(); if(!skel) return {noSkel:true}; let entry=null, before=null; try{ before=skel.animation; skel.setAnimation(0, skel.defaultAnimation||skel.animation||"animation", true); entry=skel.getCurrent(0); }catch(e){ entry={err:e.message}; } return {before, after: skel.animation, entry: entry? {animationName: entry.animation?entry.animation.name:"n/a", trackTime: entry.trackTime, loop: entry.loop} : null};');
  console.log('setAnimation + getCurrent', JSON.stringify(j,null,1));
  // bones/slots count
  j=await run('const skel=(()=>{const sc=cc.director.getScene();let s=null;const st=[sc];while(st.length&&!s){const n=st.pop();for(const c of n.children||[]) st.push(c); for(const c of n.components||[]) if(c.constructor&&c.constructor.name==="Skeleton"){s=c;break;} } return s;})(); if(!skel) return {}; let bones=null,slots=null; try{ const state=skel.getState(); bones= state&&state.data&&state.data.skeletonData&&state.data.skeletonData.bones? state.data.skeletonData.bones.length : null; }catch(e){} try{ slots= Object.keys(skel.skeletonData&&skel.skeletonData.skeletonJson? skel.skeletonData.skeletonJson : {}).slice(0,3); }catch(e){} return {bonesSlots:{bones,slots}};');
  console.log('bones/slots', JSON.stringify(j,null,1));
  // attachments probe
  j=await run('const skel=(()=>{const sc=cc.director.getScene();let s=null;const st=[sc];while(st.length&&!s){const n=st.pop();for(const c of n.children||[]) st.push(c); for(const c of n.components||[]) if(c.constructor&&c.constructor.name==="Skeleton"){s=c;break;} } return s;})(); if(!skel) return {}; let att=null; try{ att= skel.getAttachment("root","slot0"); }catch(e){ att="err:"+e.message; } return {getAttachment: att===null?"null":String(att).slice(0,80)};');
  console.log('getAttachment', JSON.stringify(j,null,1));
  // timeScale and sockets
  j=await run('const skel=(()=>{const sc=cc.director.getScene();let s=null;const st=[sc];while(st.length&&!s){const n=st.pop();for(const c of n.children||[]) st.push(c); for(const c of n.components||[]) if(c.constructor&&c.constructor.name==="Skeleton"){s=c;break;} } return s;})(); if(!skel) return {}; return {timeScale: skel.timeScale, loop: skel.loop, premul: skel.premultipliedAlpha, debugB: skel.debugBones, sockets: skel.sockets?skel.sockets.length:0};');
  console.log('props', JSON.stringify(j,null,1));
})();
