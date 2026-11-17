const path=require('path');const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'),FILE='plugins/dsp/super-synth/plugin.wasm';
function check(x,m){if(!x)throw new Error(m)}
const cases=[
 ['supersaw_lead','wavetable',[24,36,48,60,72,84,96]],
 ['clean_guitar','pluck',[28,40,52,64,76,88]],
 ['soft_piano','piano',[21,36,48,60,72,88,108]],
 ['concert_grand','concert_grand',[28,40,60,76,88]],
 ['ep_bell','tine',[36,48,60,72,84]],
 ['strings_wide','bowed',[36,48,60,72,84]],
 ['flute_air','flute',[60,72,84,96]],
 ['sax_warm','reed',[40,52,64,76,88]],
 ['brass_pop','brass',[36,48,60,72,84]],
 ['vocal_ah','vocal',[48,60,72]]
];
let maxPeak=0,count=0;
for(const [preset,model,pitches] of cases)for(const pitch of pitches){
 const h=new PluginHarness(R,FILE);h.applyPreset(preset);h.setPlain('filter_quality','tpt');h.setPlain('stereo_filter',true);h.setPlain('oversample','x4');h.setPlain('decimation_quality','halfband');h.setPlain('voice_drift',0);h.setPlain('lfo1_pitch',0);
 let p=0;for(let b=0;b<96;b++){const ev=b===0?[{kind:1,noteId:1,pitch,velocity:.86,offset:0}]:[];const o=h.process(128,{events:ev})[0];for(const ch of o)for(const x of ch){check(Number.isFinite(x),`${model}/${pitch}: nonfinite`);p=Math.max(p,Math.abs(x));}}
 h.close();check(p<=Math.pow(10,1.6/20),`${model}/${pitch}: unsafe ${p}`);check(p>.00002,`${model}/${pitch}: silent ${p}`);maxPeak=Math.max(maxPeak,p);count++;
}
console.log('PASS SuperSynth v9 sweep regression',{engines:cases.length,cases:count,maxPeak:+maxPeak.toFixed(4)});
