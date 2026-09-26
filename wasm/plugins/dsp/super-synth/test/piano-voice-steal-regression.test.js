const path=require('path');
const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'),FILE='plugins/dsp/super-synth/plugin.wasm',SR=48000,B=128;
function check(x,m){if(!x)throw new Error(m)}
const h=new PluginHarness(R,FILE,{sampleRate:SR,maxFrames:B});
h.applyPreset('soft_piano');h.setPlain('voice_drift',0);h.setPlain('lfo1_pitch',0);h.setPlain('chorus_mix',0);
let prev=0,boundary=0,maxNear=0,sumNear=0,nNear=0;
for(let b=0;b<150;b++){
  const events=[];
  if(b===0)for(let i=0;i<32;i++)events.push({kind:1,noteId:i+1,pitch:28+i*2,velocity:.68+(i%4)*.04,offset:0});
  if(b===90)events.push({kind:1,noteId:100,pitch:84,velocity:.86,offset:0});
  const out=h.process(B,{events})[0][0];
  for(let i=0;i<out.length;i++){
    const d=Math.abs(out[i]-prev);
    if(b===90&&i===0)boundary=d;
    else if(b>=86&&b<=94){maxNear=Math.max(maxNear,d);sumNear+=d;nNear++;}
    prev=out[i];
  }
}
h.close();
const meanNear=sumNear/Math.max(1,nNear),ratio=boundary/Math.max(1e-12,meanNear);
check(Number.isFinite(boundary)&&Number.isFinite(meanNear),'non-finite voice-steal measurement');
check(ratio<2.0,`voice stealing discontinuity too large: boundary=${boundary} meanNearby=${meanNear} ratio=${ratio}`);
console.log('PASS piano voice-steal de-click',{boundary:+boundary.toFixed(6),meanNearby:+meanNear.toFixed(6),ratio:+ratio.toFixed(3),maxNearby:+maxNear.toFixed(6)});
