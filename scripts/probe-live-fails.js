const base='http://localhost:49650';
async function run(context, code){ const r=await fetch(base+'/tools/executeJavascript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context,code})}); return {ok:r.ok, j:await r.json()}; }
(async()=>{
  let j=await run('scene','const sc=cc.director.getScene();let sk=null;const st=[sc];while(st.length&&!sk){const n=st.pop();for(const c of n.components||[]) if(c.constructor&&c.constructor.name==="Skeleton"){sk=c;break;}for(const c of n.children||[])st.push(c);}const found={spine:[],dragonbones:[],skeletal3d:[]};const st2=[sc];while(st2.length){const n=st2.pop();for(const c of n.components||[]){const cls=c&&c.constructor?c.constructor.name:"";const hasBones=!!(c&&(c.skeleton||c._skeleton||c.skeletonData));if(cls==="Skeleton"||cls==="sp.Skeleton"||(c&&c.skeletonData!==undefined))found.spine.push({node:n.name,cls,hasBones});if(cls==="ArmatureDisplay"||cls.indexOf("dragonBones")>=0)found.dragonbones.push({node:n.name,cls});if(cls==="SkeletalAnimation"||cls==="cc.SkeletalAnimation")found.skeletal3d.push({node:n.name,cls});}for(const c of n.children||[])st2.push(c);}console.log(JSON.stringify(found));return found;');
  console.log('S5:', JSON.stringify(j,null,1));
  j=await run('scene','const sc=cc.director.getScene();let sk=null;const st=[sc];while(st.length&&!sk){const n=st.pop();for(const c of n.components||[]) if(c.constructor&&c.constructor.name==="Skeleton"){sk=c;break;}for(const c of n.children||[])st.push(c);}let out=null,err=null;try{sk.setAnimation(0, sk.defaultAnimation||sk.animation||"animation", true);}catch(e){err=String(e.message||e);}return{err,out:err?null:"ok"};');
  console.log('T4:', JSON.stringify(j,null,1));
  j=await run('editor','return 123n');
  console.log('G3:', JSON.stringify(j,null,1));
  j=await run('scene','const a={};a.self=a;return a;');
  console.log('G4:', JSON.stringify(j,null,1));
})();
