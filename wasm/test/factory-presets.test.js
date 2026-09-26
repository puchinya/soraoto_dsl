const fs=require('fs');const path=require('path');
const {PluginHarness,paramDef,normalize}=require('./helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../..');
function check(x,m){if(!x)throw new Error(m);}
const presets=JSON.parse(fs.readFileSync(path.join(R,'wasm/plugins/dsp/super-synth/presets.json'),'utf8'));
const h=new PluginHarness(R,'plugins/dsp/super-synth/plugin.wasm',{sampleRate:48000,maxFrames:128});
const d=h.descriptor,fp=d.factory_presets||[],pl=d.program_lists||[];
check(fp.length===Object.keys(presets).length,`factory preset count ${fp.length}/${Object.keys(presets).length}`);
check(pl.length===1&&pl[0].programs.length===fp.length,'program list incomplete');
const byName=new Map(fp.map(x=>[String(x.meta?.name),x]));
for(const [name,preset] of Object.entries(presets)){
  check(byName.has(name),`factory preset missing ${name}`);
  h.applyPreset(name);
  const snap=h.controlQuery(4),values=new Map((snap.values||[]).map(x=>[Number(x.parameter_id),Number(x.value?.normalized)]));
  for(const [k,v] of Object.entries(preset)){
    const def=paramDef(d,k);if(!def)continue;
    const expected=normalize(def,v),got=values.get(Number(def.id));
    check(Number.isFinite(got),`${name}.${k}: snapshot missing`);
    check(Math.abs(got-expected)<1e-5,`${name}.${k}: ${got} != ${expected}`);
  }
}
const first=fp[0],info=h.controlQuery(20,{program_list_id:pl[0].id,program_id:first.id});
check(String(info.name)===String(first.meta.name),'GET_PROGRAM_INFO mismatch');
h.close();
console.log('PASS formal factory presets',{factory:fp.length,programLists:pl.length,first:first.meta.name});


const genericCases=[
  ['reverb',5,{room:{mix:0.17,decay:1.15},hall:{mix:0.25,decay:4.8}}],
  ['drum-machine',5,{studio:{kit:'studio',output_gain:0.30},edm:{kit:'edm',punch:0.88}}],
  ['channel-strip',7,{lead:{hpf_freq:110,width:1.08},bass:{hpf_freq:32,width:0.72},mix_bus:{comp_ratio:1.5,width:1.0}}],
];
for(const [plugin,count,expect] of genericCases){
  const gh=new PluginHarness(R,`plugins/${['drum-machine','super-synth'].includes(plugin)?'dsp':'effects'}/${plugin}/plugin.wasm`,{sampleRate:48000,maxFrames:128});
  const gd=gh.descriptor,gf=gd.factory_presets||[],gl=gd.program_lists||[];
  check(gf.length===count,`${plugin}: factory count ${gf.length}/${count}`);
  check(gl.length===1&&gl[0].programs.length===count,`${plugin}: program list incomplete`);
  const names=new Set(gf.map(x=>String(x.meta?.name||'')));
  for(const [name,params] of Object.entries(expect)){
    check(names.has(name),`${plugin}: factory preset missing ${name}`);
    gh.applyPreset(name);
    const snap=gh.controlQuery(4),values=new Map((snap.values||[]).map(x=>[Number(x.parameter_id),Number(x.value?.normalized)]));
    for(const [k,v] of Object.entries(params)){
      const def=paramDef(gd,k);check(def,`${plugin}.${name}: missing ${k}`);
      const expected=normalize(def,v),got=values.get(Number(def.id));
      check(Number.isFinite(got),`${plugin}.${name}.${k}: snapshot missing`);
      check(Math.abs(got-expected)<1e-5,`${plugin}.${name}.${k}: ${got} != ${expected}`);
    }
    const fp=gf.find(x=>String(x.meta?.name)===name);
    const info=gh.controlQuery(20,{program_list_id:gl[0].id,program_id:fp.id});
    check(String(info.name)===name,`${plugin}.${name}: GET_PROGRAM_INFO mismatch`);
  }
  gh.close();
  console.log('PASS generic factory presets',{plugin,count});
}
