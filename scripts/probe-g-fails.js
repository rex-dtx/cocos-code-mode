const { postTool } = require('../tests/helpers/utcp-client');
async function exec(context, code){ return postTool('executeJavascript', {context, code}); }
(async()=>{
  const cases = [
    ['S5', 'scene', 'const sc=cc.director.getScene();const found={spine:[],dragonbones:[],skeletal3d:[]};const st=[sc];while(st.length){const n=st.pop();for(const c of n.components||[]){const cls=c&&c.constructor?c.constructor.name:"";const hasBones=!!(c&&(c.skeleton||c._skeleton||c.skeletonData));if(cls==="Skeleton"||cls==="sp.Skeleton"||(c&&c.skeletonData!==undefined))found.spine.push({node:n.name,cls,hasBones});if(cls==="ArmatureDisplay"||cls.indexOf("dragonBones")>=0)found.dragonbones.push({node:n.name,cls});if(cls==="SkeletalAnimation"||cls==="cc.SkeletalAnimation")found.skeletal3d.push({node:n.name,cls});}for(const c of n.children||[])st.push(c);}return found;'],
    ['T4', 'scene', 'const sc=cc.director.getScene();let sk=null;const st=[sc];while(st.length&&!sk){const n=st.pop();for(const c of n.components||[]) if(c&&c.constructor&&c.constructor.name==="Skeleton"){sk=c;break;}for(const c of n.children||[])st.push(c);} if(!sk) return {skip:true}; let err=null, entry=null; try{ const name=sk.defaultAnimation||sk.animation||"animation"; sk.setAnimation(0, name, true); entry=sk.getCurrent(0); }catch(e){ err=String(e.message||e); } return {err, entryOk: entry?{hasAnim:!!entry.animation, trackTime:typeof entry.trackTime==="number"}:null};'],
    ['T6', 'scene', 'const sc=cc.director.getScene();let sk=null;const st=[sc];while(st.length&&!sk){const n=st.pop();for(const c of n.components||[]) if(c&&c.constructor&&c.constructor.name==="Skeleton"){sk=c;break;}for(const c of n.children||[])st.push(c);} if(!sk) return {skip:true}; let bone=null, slot=null, err=null; try{ bone=sk.findBone("root"); }catch(e){ err="bone:"+e.message; } try{ slot=sk.findSlot("root"); }catch(e){ err=(err?err+"; ":"")+"slot:"+e.message; } return {err, boneType:bone?(bone.data?bone.data.name:"bone"):null, slotFound:!!slot};'],
    ['T7', 'scene', 'const sc=cc.director.getScene();let sk=null;const st=[sc];while(st.length&&!sk){const n=st.pop();for(const c of n.components||[]) if(c&&c.constructor&&c.constructor.name==="Skeleton"){sk=c;break;}for(const c of n.children||[])st.push(c);} if(!sk) return {skip:true}; let err=null; try{ sk.setToSetupPose(); sk.setBonesToSetupPose(); sk.setSlotsToSetupPose(); }catch(e){ err=String(e.message||e); } return {err};'],
    ['G3', 'editor', 'return 123n'],
    ['G4', 'scene', 'const a={};a.self=a;return a;'],
    ['G5', 'scene', 'const n=new cc.Node("orphan");return n;'],
  ];
  for(const [name, ctx, code] of cases){
    const r = await exec(ctx, code);
    console.log(`\n[${name}] ok=${r.ok} status=${r.status}`);
    console.log(JSON.stringify(r.body,null,2).slice(0,800));
  }
})();
