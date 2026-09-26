const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=require('path').resolve(__dirname,'../../../../../');
function check(x,m){if(!x)throw new Error(m);}
function renderPattern(preset='pop'){
  const h=new PluginHarness(R,'plugins/dsp/drum-machine/plugin.wasm',{sampleRate:48000,maxFrames:128});h.applyPreset(preset);
  const sr=48000,seconds=4,total=sr*seconds,block=128;let id=1;const ev=[];
  for(let t=0;t<seconds;t+=.125)ev.push({frame:Math.round(t*sr),kind:1,noteId:id++,pitch:42,velocity:.72});
  for(let t=0;t<seconds;t+=.5)ev.push({frame:Math.round(t*sr),kind:1,noteId:id++,pitch:36,velocity:.9});
  for(let t=.25;t<seconds;t+=.5)ev.push({frame:Math.round(t*sr),kind:1,noteId:id++,pitch:38,velocity:.85});
  ev.sort((a,b)=>a.frame-b.frame);let ei=0,out=[];
  for(let base=0;base<total;base+=block){const n=Math.min(block,total-base),events=[];while(ei<ev.length&&ev[ei].frame<base+n){const x=ev[ei++];events.push({...x,offset:x.frame-base});}out.push(...h.process(n,{events})[0][0]);}
  h.close();return out;
}
function metrics(a){let sum=0,peak=0,z=0,hot=0;for(let i=0;i<a.length;i++){const x=a[i];check(Number.isFinite(x),'non-finite drum sample');sum+=x*x;peak=Math.max(peak,Math.abs(x));if(i&&((a[i-1]>=0)!=(x>=0)))z++;if(Math.abs(x)>.01)hot++;}return{rms:Math.sqrt(sum/a.length),peak,zcr:z/a.length,hot:hot/a.length};}
const m=metrics(renderPattern());
check(m.rms<.10,`drum noise floor too high: rms=${m.rms}`);
check(m.peak<.75,`drum transient unsafe: peak=${m.peak}`);
check(m.zcr<.14,`drum mix too noise-like: zcr=${m.zcr}`);
console.log('PASS drum noise regression',Object.fromEntries(Object.entries(m).map(([k,v])=>[k,+v.toFixed(4)])));
