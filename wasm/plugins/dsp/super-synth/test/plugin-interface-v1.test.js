const fs=require('fs');const path=require('path');global.window=global;const R=path.resolve(__dirname,'../../../../../');
const {wasmPath}=require('../../../../test/helpers/plugin-harness.cjs');
eval(fs.readFileSync(path.join(R,'web-player', 'src/js', 'plugin-cbor.js'),'utf8'));
eval(fs.readFileSync(path.join(R,'web-player', 'src/js', 'plugin-interface.js'),'utf8'));
function check(x,m){if(!x)throw new Error(m);}
const ifacePath=path.join(R,'wasm','plugins','dsp','super-synth','interface.soraoto'),source=fs.readFileSync(ifacePath,'utf8');
for(const token of ['abi: "1.0"','id: "net.puchinya.soraotodsl.super-synth-v8"','name: "SuperSynth v8"','version: "8.0.0"','kind: instrument','control_modulation_max_quantum: 64','parameter output_width: Width','parameter engine_model: Enum<EngineModel>','parameter voice_drift: Cent'])check(source.includes(token),`canonical interface missing ${token}`);
const b=fs.readFileSync(wasmPath(R,'plugins/dsp/super-synth/plugin.wasm')),mod=new WebAssembly.Module(b),is=WebAssembly.Module.customSections(mod,'soraoto.interface'),ds=WebAssembly.Module.customSections(mod,'soraoto.plugin.v1');
check(is.length===1,'soraoto.interface section count');check(ds.length===1,'soraoto.plugin.v1 section count');check(Buffer.from(is[0]).toString('utf8')===source,'embedded soraoto.interface must equal source byte-for-byte');
const d=SoraotoPluginCBOR.decode(new Uint8Array(ds[0])),model=SoraotoPluginInterface.validateModule(mod,d);check(model,'interface validator did not return model');check(model.params.length===157,'157 parameters');check(model.kind==='instrument','kind');
const eng=d.parameters.find(p=>p.path==='engine_model');check(eng&&eng.type==='enum'&&eng.enum_values.join(',')==='wavetable,pluck,piano,tine,bowed,flute,reed,brass,vocal,concert_grand','EngineModel lowering mismatch');
const width=d.parameters.find(p=>p.path==='output_width');check(width&&width.unit==='width'&&width.min===0&&width.max===2,'Width lowering mismatch');
console.log('PASS soraoto.interface canonical validation',{parameters:model.params.length,interfaceBytes:Buffer.byteLength(source),descriptorBytes:ds[0].byteLength,models:eng.enum_values.length});
