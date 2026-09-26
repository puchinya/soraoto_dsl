const path=require('path');const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'),FILE='plugins/dsp/super-synth/plugin.wasm';
function check(x,m){if(!x)throw new Error(m);}
const h=new PluginHarness(R,FILE,{sampleRate:48000,maxFrames:128});h.applyPreset('soft_piano');
let prev=0,eventJump=0,preMax=0,postMax=0;
for(let b=0;b<220;b++){
  const events=[];
  if(b===0)events.push({kind:1,noteId:1,pitch:52,velocity:.82,offset:0});
  if(b===100)events.push({kind:3,noteId:1,expressionId:4,value:.24,offset:37});
  const o=h.process(128,{events})[0][0];
  for(let i=0;i<o.length;i++){
    const d=Math.abs(o[i]-prev);
    if(b===99&&i>=64)preMax=Math.max(preMax,d);
    if(b===100&&i===37)eventJump=d;
    if(b===100&&i>=38&&i<102)postMax=Math.max(postMax,d);
    prev=o[i];
  }
}
h.close();
check(preMax>1e-5,'pre-event signal too quiet');
check(eventJump<Math.max(.012,preMax*1.35),`volume expression discontinuity ${eventJump}/${preMax}`);
check(postMax<Math.max(.02,preMax*1.8),`post-expression transient ${postMax}/${preMax}`);
console.log('PASS piano click regression',{eventJump:+eventJump.toFixed(6),preMax:+preMax.toFixed(6),postMax:+postMax.toFixed(6)});
