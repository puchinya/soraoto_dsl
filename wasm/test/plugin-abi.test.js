const fs=require('fs');const path=require('path');global.window=global;
const R=path.resolve(__dirname,'../..');
eval(fs.readFileSync(path.join(R,'web-player', 'src/js', 'plugin-cbor.js'),'utf8'));
eval(fs.readFileSync(path.join(R,'web-player', 'src/js', 'plugin-interface.js'),'utf8'));
eval(fs.readFileSync(path.join(R,'web-player', 'src/js', 'plugin-host.js'),'utf8'));
const {PluginHarness,ABI,wasmPath}=require('./helpers/plugin-harness.cjs');
function check(x,m){if(!x)throw new Error(m);}function finite(a){return a.every(Number.isFinite);}function peak(a){let p=0;for(const x of a)p=Math.max(p,Math.abs(x));return p;}
const required=['memory','soraoto_alloc','soraoto_free','soraoto_plugin_abi_version','soraoto_plugin_init','soraoto_plugin_terminate','soraoto_plugin_control','soraoto_plugin_activate','soraoto_plugin_deactivate','soraoto_plugin_start_processing','soraoto_plugin_stop_processing','soraoto_plugin_process','soraoto_plugin_reset','soraoto_plugin_state_snapshot','soraoto_plugin_state_load','soraoto_plugin_latency_samples','soraoto_plugin_tail_samples'];
const legacy=['init','reset','set_parameter','process','note_on','note_off','note_expression'];
const files=['plugins/effects/gain/plugin.wasm','plugins/effects/stereo-delay/plugin.wasm','plugins/effects/channel-strip/plugin.wasm','plugins/effects/sidechain/plugin.wasm','plugins/effects/reverb/plugin.wasm','plugins/effects/master-limiter/plugin.wasm','plugins/dsp/drum-machine/plugin.wasm','plugins/dsp/super-synth/plugin.wasm'];
for(const file of files){
  const bytes=fs.readFileSync(wasmPath(R,file)),module=new WebAssembly.Module(bytes),exports=WebAssembly.Module.exports(module).map(x=>x.name),sections=WebAssembly.Module.customSections(module,'soraoto.plugin.v1');
  check(sections.length===1,`${file}: descriptor section count`);check(WebAssembly.Module.customSections(module,'muse.plugin.v1').length===0,`${file}: legacy muse.plugin.v1 section remains`);check(WebAssembly.Module.customSections(module,'muse.interface').length===0,`${file}: legacy muse.interface section remains`);check(required.every(k=>exports.includes(k)),`${file}: required exports`);check(legacy.every(k=>!exports.includes(k)),`${file}: legacy export remains`);check(WebAssembly.Module.imports(module).every(x=>x.module==='soraoto_host_v1'),`${file}: forbidden import`);const v=SoraotoPluginHost.validateModule(module);check(v.descriptor.abi_major===1&&v.descriptor.abi_minor===0,`${file}: descriptor ABI`);console.log('PASS ABI surface',file,v.descriptor.id);
}
{
  const h=new PluginHarness(R,'plugins/effects/gain/plugin.wasm');h.setPlain('gain',.5);const input=Float32Array.from({length:128},(_,i)=>i===0?.5:0);const out=h.process(128,{inputs:[[input,input]]})[0];check(finite(out[0]),'gain nonfinite');check(Math.abs(out[0][0]-.25)<.02,`gain output ${out[0][0]}`);h.close();
}
{
  const h=new PluginHarness(R,'plugins/effects/stereo-delay/plugin.wasm');h.setPlain('time',.018);h.setPlain('feedback',.42);h.setPlain('mix',.35);let p=0;for(let b=0;b<1400;b++){const x=new Float32Array(128);if(!b)x[0]=.5;const o=h.process(128,{inputs:[[x,x]]})[0];check(finite(o[0])&&finite(o[1]),'delay nonfinite');p=Math.max(p,peak(o[0]),peak(o[1]));}check(p>0&&p<4,`delay peak ${p}`);h.close();
}
{
  const h=new PluginHarness(R,'plugins/effects/reverb/plugin.wasm');h.applyPreset('hall');let tail=0;for(let b=0;b<180;b++){const x=new Float32Array(128);if(!b)x[0]=.5;const o=h.process(128,{inputs:[[x,x]]})[0];check(finite(o[0])&&finite(o[1]),'reverb nonfinite');if(b>20)tail=Math.max(tail,peak(o[0]),peak(o[1]));}check(tail>.0001,`reverb tail ${tail}`);check(Number(h.e.soraoto_plugin_tail_samples())>48000,'reverb tail report');h.close();
}
{
  const h=new PluginHarness(R,'plugins/effects/master-limiter/plugin.wasm');h.setPlain('ceiling',-1);let p=0;for(let b=0;b<80;b++){const x=new Float32Array(128).fill(2);const o=h.process(128,{inputs:[[x,x]]})[0];check(finite(o[0]),'limiter nonfinite');p=Math.max(p,peak(o[0]),peak(o[1]));}check(p<=.9&&p>.5,`limiter peak ${p}`);check(h.e.soraoto_plugin_latency_samples()>0,'limiter lookahead latency');h.close();
}
{
  const h=new PluginHarness(R,'plugins/dsp/drum-machine/plugin.wasm');h.applyPreset('studio');let p=0;for(let b=0;b<100;b++){const events=b===0?[{kind:1,noteId:1,pitch:36,velocity:.9,offset:0}]:[];const o=h.process(128,{events})[0];check(finite(o[0])&&finite(o[1]),'drum nonfinite');p=Math.max(p,peak(o[0]),peak(o[1]));}check(p>.02&&p<1.5,`drum peak ${p}`);h.close();
}
{
  const h=new PluginHarness(R,'plugins/dsp/super-synth/plugin.wasm');h.applyPreset('soft_lead');let p=0;for(let b=0;b<160;b++){const events=b===0?[{kind:1,noteId:1,pitch:60,velocity:.8,offset:0}]:[];const o=h.process(128,{events})[0];check(finite(o[0])&&finite(o[1]),'synth nonfinite');p=Math.max(p,peak(o[0]),peak(o[1]));}check(p>.002&&p<1.5,`synth peak ${p}`);h.close();
}
console.log('PASS Plugin ABI 1.0 processing',{abi:ABI.toString(16),plugins:files.length});
