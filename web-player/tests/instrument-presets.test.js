const fs=require('fs');const path=require('path');global.window=global;const WEB_PLAYER_ROOT=path.resolve(__dirname,'..'),R=path.resolve(WEB_PLAYER_ROOT,'..');
eval(fs.readFileSync(path.join(WEB_PLAYER_ROOT,'src/js','plugin-cbor.js'),'utf8'));eval(fs.readFileSync(path.join(WEB_PLAYER_ROOT,'src/js','plugin-host.js'),'utf8'));eval(fs.readFileSync(path.join(WEB_PLAYER_ROOT,'src/js','instrument-library.js'),'utf8'));eval(fs.readFileSync(path.join(WEB_PLAYER_ROOT,'src/js','compiler.js'),'utf8'));
const {descriptorOf,ext,wasmPath}=require('../../wasm/test/helpers/plugin-harness.cjs');function check(x,m){if(!x)throw new Error(m);}
const wasmModule=new WebAssembly.Module(fs.readFileSync(wasmPath(R,'plugins/dsp/super-synth/plugin.wasm'))),d=descriptorOf(wasmModule,R),factory=d.factory_presets||[],presetNames=new Set(factory.map(x=>x.meta?.name));check(factory.length===51,'production factory preset count');
const init=SoraotoPluginHost.initialState(d,{preset:{value:'supersaw_lead'},filter_cutoff:{value:7500}});const byId=Object.fromEntries(init.parameters.map(x=>[x.id,x.normalized]));
const def=n=>d.parameters.find(p=>p.path===n);const expected=SoraotoPluginHost.normalize(def('filter_cutoff'),7500);check(Math.abs(byId[20]-expected)<1e-9,'filter_cutoff normalized override');check(init.factoryPresetId!=null,'factory preset id');check(new Set(init.parameters.map(p=>p.id)).size===init.parameters.length,'formal preset emitted duplicate parameter IDs');
const standard=['soft_piano','ep_bell','clean_guitar','driven_guitar','picked_bass','sub_bass','bright_pluck','supersaw_lead','airy_pad','strings_wide','brass_pop','organ_drawbar','digital_bell','flute_air','vocal_ah','harp_glass','sax_warm'];
for(const p of standard)check(presetNames.has(p),`missing SuperSynth standard factory preset ${p}`);
check(SoraotoInstruments.superSynthUrl==='wasm/plugins/dsp/super-synth/plugin.wasm','SuperSynth standard URL');
const noteTrack=(instrument,name=instrument)=>({instrument,name,events:[{type:'note'}]});
check(SoraotoInstruments.superSynthPresetFor(noteTrack('piano'))==='concert_grand','piano resolver');
check(SoraotoInstruments.superSynthPresetFor(noteTrack('sax'))==='sax_warm','sax resolver');
check(SoraotoInstruments.superSynthPresetFor(noteTrack('synth','Lead Theme'))==='supersaw_lead','lead resolver');
check(SoraotoInstruments.superSynthPresetFor({instrument:'drums',name:'Drums',events:[{type:'drum'}]})===null,'drums must not resolve to SuperSynth');
check(SoraotoInstruments.drumPluginUrl==='wasm/plugins/dsp/drum-machine/plugin.wasm','Drum Plugin URL');
check(SoraotoInstruments.drumPitchFor({drum:'Kick'})===36&&SoraotoInstruments.drumPitchFor({drum:'Snare'})===38&&SoraotoInstruments.drumPitchFor({drum:'OpenHat'})===46,'GM drum lowering');
check(SoraotoInstruments.superSynthPresetFor({instrument:'synth',name:'Explicit',instrumentDescriptor:{kind:'wasm-plugin'},events:[{type:'note'}]})===null,'explicit plugin must win');
const catalog=JSON.parse(fs.readFileSync(path.join(WEB_PLAYER_ROOT,'public/songs','index.json'),'utf8'));let autoTracks=0;
for(const song of catalog.songs){
  const ir=SoraotoCompiler.compile(fs.readFileSync(path.join(WEB_PLAYER_ROOT,'public/songs',song.file),'utf8'));
  for(const t of ir.tracks||[]){
    if(!(t.events||[]).some(e=>e.type==='note')||t.instrumentDescriptor?.kind==='wasm-plugin')continue;
    const preset=SoraotoInstruments.superSynthPresetFor(t);
    check(preset&&presetNames.has(preset),`${song.id}/${t.name}: unresolved SuperSynth preset ${preset}`);
    autoTracks++;
  }
}
check(autoTracks>0,'catalog did not exercise automatic SuperSynth resolution');
const programs=d.program_lists?.[0]?.programs||[];for(const [name,model] of Object.entries({soft_piano:'piano',clean_guitar:'pluck',strings_wide:'bowed',flute_air:'flute',vocal_ah:'vocal'})){const pr=programs.find(x=>x.name===name);check(pr?.attributes?.['soraoto.engine']===model,`${name}: expected ${model}`);}
console.log('PASS instrument presets',{fallbackBuiltin:SoraotoInstruments.presets.length,pluginPresets:factory.length,standardOnSuperSynth:true,drumsOnPlugin:true,autoTracks});
