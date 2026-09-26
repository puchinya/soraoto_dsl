const fs=require('fs');const path=require('path');const R=path.resolve(__dirname,'../..');global.window=global;
eval(fs.readFileSync(path.join(R,'web-player', 'src/js', 'plugin-cbor.js'),'utf8'));
const {ABI,descriptorOf,requiredExports,wasmPath}=require('./helpers/plugin-harness.cjs');
function check(x,m){if(!x)throw new Error(m);}
const plugins=['gain','stereo-delay','channel-strip','sidechain','reverb','master-limiter','drum-machine','super-synth'];
function allocBytes(e,bytes,align=8){const p=e.soraoto_alloc(bytes.length,align)>>>0;check(p,`alloc ${bytes.length}`);new Uint8Array(e.memory.buffer,p,bytes.length).set(bytes);return p;}
function query(e,opcode,request){const rp=allocBytes(e,request);const need=e.soraoto_plugin_control(opcode,rp,request.length,0,0)|0;check(need>0,`query ${opcode} size ${need}`);const out=e.soraoto_alloc(need,8)>>>0;check(out,`query ${opcode} response alloc`);const got=e.soraoto_plugin_control(opcode,rp,request.length,out,need)|0;check(got===need,`query ${opcode} ${got}/${need}`);const bytes=new Uint8Array(e.memory.buffer,out,need).slice();e.soraoto_free(out|0,need|0,8);e.soraoto_free(rp|0,request.length|0,8);return bytes;}
let totalCycles=0,totalQueries=0;
for(const name of plugins){
  const file=wasmPath(R,path.join('plugins',['drum-machine','super-synth'].includes(name)?'dsp':'effects',name,'plugin.wasm')),module=new WebAssembly.Module(fs.readFileSync(file)),descriptor=descriptorOf(module,R),instance=new WebAssembly.Instance(module,{}),e=instance.exports;
  check(requiredExports(e),`${name}: exports`);let firstProbe=0,stableMemory=0;
  for(let cycle=0;cycle<120;cycle++){
    check((e.soraoto_plugin_abi_version()>>>0)===ABI,`${name}: ABI`);check((e.soraoto_plugin_init(ABI|0)|0)===0,`${name}: init ${cycle}`);
    const nil=Uint8Array.of(0xf6);const descBytes=query(e,1,nil);check(descBytes.length>32,`${name}: descriptor query`);
    const cfg=SoraotoPluginCBOR.encode({sample_rate:SoraotoPluginCBOR.float64(48000),max_frames:128});const cp=allocBytes(e,cfg);check((e.soraoto_plugin_control(2,cp,cfg.length,0,0)|0)===0,`${name}: configure ${cycle}`);e.soraoto_free(cp|0,cfg.length|0,8);
    const probe=e.soraoto_alloc(32,16)>>>0;check(probe,`${name}: probe before`);e.soraoto_free(probe|0,32,16);if(!cycle)firstProbe=probe;else check(probe===firstProbe,`${name}: allocator base drift cycle ${cycle}: ${probe}/${firstProbe}`);
    for(let q=0;q<40;q++){const snap=query(e,4,nil);check(snap.length>8,`${name}: snapshot`);totalQueries++;}
    const probeAfter=e.soraoto_alloc(32,16)>>>0;check(probeAfter===firstProbe,`${name}: control query allocator leak ${probeAfter}/${firstProbe}`);e.soraoto_free(probeAfter|0,32,16);
    const arena=e.soraoto_alloc(256*1024,16)>>>0;check(arena,`${name}: arena`);check((e.soraoto_plugin_activate()|0)===0,`${name}: activate`);check((e.soraoto_plugin_start_processing()|0)===0,`${name}: start`);e.soraoto_plugin_stop_processing();e.soraoto_plugin_deactivate();e.soraoto_free(arena|0,256*1024,16);e.soraoto_plugin_terminate();
    const mem=e.memory.buffer.byteLength;if(!cycle)stableMemory=mem;else check(mem===stableMemory,`${name}: wasm memory grew ${stableMemory}->${mem} on cycle ${cycle}`);totalCycles++;
  }
}
console.log('PASS plugin lifecycle stress',{plugins:plugins.length,totalCycles,totalQueries});
