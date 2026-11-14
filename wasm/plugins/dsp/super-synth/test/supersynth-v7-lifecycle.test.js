const path=require('path');const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'), FILE='plugins/dsp/super-synth/plugin.wasm';
function check(x,m){if(!x)throw new Error(m)}
let maxPages=0;
for(let cycle=0;cycle<120;cycle++){
  const h=new PluginHarness(R,FILE);
  h.applyPreset(cycle%3===0?'soft_piano':cycle%3===1?'strings_wide':'supersaw_lead');
  h.setPlain('filter_quality','tpt');h.setPlain('decimation_quality','halfband');
  for(let b=0;b<24;b++){
    const ev=b===0?[{kind:1,noteId:cycle+1,pitch:48+(cycle%24),velocity:.75,offset:0}]:(b===14?[{kind:2,noteId:cycle+1,pitch:48+(cycle%24),velocity:.4,offset:0}]:[]);
    const o=h.process(128,{events:ev})[0];for(const ch of o)for(const x of ch)check(Number.isFinite(x),'nonfinite lifecycle output');
  }
  maxPages=Math.max(maxPages,h.e.memory.buffer.byteLength/65536);h.close();
}
check(maxPages<=512,`unexpected wasm pages ${maxPages}`);
console.log('PASS SuperSynth v9 lifecycle regression',{cycles:120,maxPages});
