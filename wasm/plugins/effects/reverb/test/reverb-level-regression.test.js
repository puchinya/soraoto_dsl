const assert=require('assert');
const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=require('path').resolve(__dirname,'../../../../..');
const presets=['ambience','room','chamber','plate','hall'];
function runPreset(preset){
  const h=new PluginHarness(R,'plugins/effects/reverb/plugin.wasm');
  try{
    h.applyPreset(preset);h.setPlain('mix',1);
    const block=128,sr=48000,seconds=8,warm=3,blocks=Math.ceil(sr*seconds/block);
    let seed=0x12345678,inSq=0,outSq=0,n=0,peak=0;
    for(let b=0;b<blocks;b++){
      const L=new Float32Array(block),RR=new Float32Array(block);
      for(let i=0;i<block;i++){
        seed=(Math.imul(1664525,seed)+1013904223)>>>0;
        const x=((seed/4294967296)*2-1)*0.08;L[i]=RR[i]=x;
      }
      const out=h.process(block,{inputs:[[L,RR]]})[0][0];
      for(let i=0;i<block;i++){
        const frame=b*block+i;if(frame<sr*warm)continue;
        inSq+=L[i]*L[i];outSq+=out[i]*out[i];peak=Math.max(peak,Math.abs(out[i]));n++;
      }
    }
    const inRms=Math.sqrt(inSq/n),outRms=Math.sqrt(outSq/n),gainDb=20*Math.log10(outRms/inRms);
    assert(Number.isFinite(gainDb)&&Number.isFinite(peak),`${preset}: finite`);
    assert(gainDb<=-3,`${preset}: wet return must keep >=3 dB headroom, got ${gainDb.toFixed(2)} dB`);
    assert(peak<0.2,`${preset}: dense-input wet peak too high: ${peak}`);
    return {preset,gainDb:Number(gainDb.toFixed(2)),peak:Number(peak.toFixed(4))};
  }finally{h.close();}
}
const results=presets.map(runPreset);
console.log('PASS reverb level regression',results);
