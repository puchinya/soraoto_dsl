const fs=require('fs');
const path=require('path');
const ABI=0x00010000, PB_SIZE=176, BUS_SIZE=32, PARAM_SIZE=24, EVENT_SIZE=64;
function wasmBuildRoot(R){
  return process.env.SORAOTO_WASM_BUILD_DIR
    ? path.resolve(process.env.SORAOTO_WASM_BUILD_DIR)
    : path.join(R,'build','wasm');
}
function wasmPath(R,file){return path.join(wasmBuildRoot(R),file);}
function loadCBOR(R){
  if(global.SoraotoPluginCBOR)return global.SoraotoPluginCBOR;
  global.window=global;
  eval(fs.readFileSync(path.join(R,'web-player', 'src/js','plugin-cbor.js'),'utf8'));
  return global.SoraotoPluginCBOR;
}
function descriptorOf(module,R){
  const xs=WebAssembly.Module.customSections(module,'soraoto.plugin.v1');
  if(xs.length!==1)throw new Error(`soraoto.plugin.v1 count ${xs.length}`);
  return loadCBOR(R).decode(new Uint8Array(xs[0]));
}
function ext(d){return d['x-net.daradara.soraotodsl-browser']||{};}
function paramDef(d,nameOrId){const ps=Array.isArray(d.parameters)?d.parameters:[];if(typeof nameOrId==='string')return ps.find(x=>x.path===nameOrId)||null;return ps.find(x=>Number(x.id)===Number(nameOrId))||null;}
function plain(def,v){const t=String(def?.type||'').toLowerCase();if(t==='enum'&&typeof v==='string'){const i=(def.enum_values||[]).indexOf(v);if(i>=0)v=i;}if(t==='bool'&&typeof v==='boolean')v=v?1:0;const n=Number(v);return Number.isFinite(n)?n:null;}
function normalize(def,v){const x=plain(def,v);if(x==null)return null;const t=String(def?.type||'').toLowerCase(),lo=Number(def.min),hi=Number(def.max);if(t==='bool')return x>=.5?1:0;if(t==='enum'){const N=(def.enum_values||[]).length;if(N<=1)return 0;return Math.max(0,Math.min(N-1,Math.round(x)))/(N-1);}if(t==='int'&&Number.isFinite(lo)&&Number.isFinite(hi)){const N=Math.round(hi-lo+1);if(N<=1)return 0;return (Math.max(lo,Math.min(hi,Math.round(x)))-lo)/(N-1);}if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)return Math.max(0,Math.min(1,x));if(def?.scale?.kind==='log'&&lo>0&&hi>0&&x>0)return Math.max(0,Math.min(1,Math.log(x/lo)/Math.log(hi/lo)));return Math.max(0,Math.min(1,(x-lo)/(hi-lo)));}
function requiredExports(e){return ['memory','soraoto_alloc','soraoto_free','soraoto_plugin_abi_version','soraoto_plugin_init','soraoto_plugin_terminate','soraoto_plugin_control','soraoto_plugin_activate','soraoto_plugin_deactivate','soraoto_plugin_start_processing','soraoto_plugin_stop_processing','soraoto_plugin_reset','soraoto_plugin_process','soraoto_plugin_latency_samples','soraoto_plugin_tail_samples'].every(k=>k in e);}
class PluginHarness{
  constructor(R,file,{sampleRate=48000,maxFrames=128}={}){
    this.R=R;this.file=file;this.sampleRate=sampleRate;this.maxFrames=maxFrames;
    this.bytes=fs.readFileSync(wasmPath(R,file));
    this.module=new WebAssembly.Module(this.bytes);
    this.descriptor=descriptorOf(this.module,R);
    this.instance=new WebAssembly.Instance(this.module,{});this.e=this.instance.exports;
    if(!requiredExports(this.e))throw new Error(`${file}: required exports missing`);
    if((this.e.soraoto_plugin_abi_version()>>>0)!==ABI)throw new Error(`${file}: ABI mismatch`);
    let st=this.e.soraoto_plugin_init(ABI|0);if(st!==0)throw new Error(`${file}: init ${st}`);
    const embedded=new Uint8Array(WebAssembly.Module.customSections(this.module,'soraoto.plugin.v1')[0]);
    const nil=this.e.soraoto_alloc(1,8)>>>0;new Uint8Array(this.e.memory.buffer,nil,1)[0]=0xf6;
    const need=this.e.soraoto_plugin_control(1,nil,1,0,0)|0;if(need!==embedded.length)throw new Error(`${file}: descriptor size ${need}/${embedded.length}`);
    const dp=this.e.soraoto_alloc(need,8)>>>0;const got=this.e.soraoto_plugin_control(1,nil,1,dp,need)|0;if(got!==need)throw new Error(`${file}: descriptor control ${got}`);
    const returned=new Uint8Array(this.e.memory.buffer,dp,need);for(let i=0;i<need;i++)if(returned[i]!==embedded[i])throw new Error(`${file}: descriptor mismatch at ${i}`);
    const cfg=loadCBOR(R).encode({sample_rate:loadCBOR(R).float64(sampleRate),max_frames:maxFrames});
    const cp=this.e.soraoto_alloc(cfg.length,8)>>>0;new Uint8Array(this.e.memory.buffer,cp,cfg.length).set(cfg);
    st=this.e.soraoto_plugin_control(2,cp,cfg.length,0,0)|0;if(st!==0)throw new Error(`${file}: configure ${st}`);
    this._allocate();
    st=this.e.soraoto_plugin_activate()|0;if(st!==0)throw new Error(`${file}: activate ${st}`);
    st=this.e.soraoto_plugin_start_processing()|0;if(st!==0)throw new Error(`${file}: start ${st}`);
    this.frame=0;
  }
  _align(v,a){return (v+a-1)&~(a-1);}
  _allocate(){
    const ins=(this.descriptor.audio_buses||[]).filter(x=>x.direction==='input'&&x.default_active);
    const outs=(this.descriptor.audio_buses||[]).filter(x=>x.direction==='output'&&x.default_active);
    this.inBuses=ins;this.outBuses=outs.length?outs:[{id:1}];
    let off=0;const take=(n,a=16)=>{off=this._align(off,a);const r=off;off+=n;return r;};
    const L={pb:take(PB_SIZE),inBuses:take(ins.length*BUS_SIZE),outBuses:take(this.outBuses.length*BUS_SIZE),inTables:[],outTables:[],inAudio:[],outAudio:[],params:0,events:0};
    for(let i=0;i<ins.length;i++)L.inTables.push(take(8,8));
    for(let i=0;i<this.outBuses.length;i++)L.outTables.push(take(8,8));
    for(let i=0;i<ins.length;i++)L.inAudio.push([take(this.maxFrames*4),take(this.maxFrames*4)]);
    for(let i=0;i<this.outBuses.length;i++)L.outAudio.push([take(this.maxFrames*4),take(this.maxFrames*4)]);
    L.params=take(256*PARAM_SIZE);L.events=take(256*EVENT_SIZE);
    const total=this._align(off,16),base=this.e.soraoto_alloc(total,16)>>>0;if(!base)throw new Error('arena alloc');
    this.base=base;this.total=total;
    for(const k of ['pb','inBuses','outBuses','params','events'])L[k]+=base;
    L.inTables=L.inTables.map(x=>x+base);L.outTables=L.outTables.map(x=>x+base);L.inAudio=L.inAudio.map(a=>a.map(x=>x+base));L.outAudio=L.outAudio.map(a=>a.map(x=>x+base));this.L=L;
    this._views();
    for(let i=0;i<ins.length;i++){const p=L.inBuses+i*BUS_SIZE;this.u32(p,Number(ins[i].id)||i+1);this.u32(p+4,2);this.u32(p+8,L.inTables[i]);this.u32(L.inTables[i],L.inAudio[i][0]);this.u32(L.inTables[i]+4,L.inAudio[i][1]);}
    for(let i=0;i<this.outBuses.length;i++){const p=L.outBuses+i*BUS_SIZE;this.u32(p,Number(this.outBuses[i].id)||i+1);this.u32(p+4,2);this.u32(p+8,L.outTables[i]);this.u32(L.outTables[i],L.outAudio[i][0]);this.u32(L.outTables[i]+4,L.outAudio[i][1]);}
  }
  _views(){this.dv=new DataView(this.e.memory.buffer);this.u8=new Uint8Array(this.e.memory.buffer);}
  u16(p,v){this.dv.setUint16(p,v>>>0,true)} u32(p,v){this.dv.setUint32(p,v>>>0,true)} f32(p,v){this.dv.setFloat32(p,Number(v)||0,true)} f64(p,v){this.dv.setFloat64(p,Number(v)||0,true)} u64(p,v){v=Math.max(0,Math.floor(Number(v)||0));this.u32(p,v>>>0);this.u32(p+4,Math.floor(v/4294967296)>>>0)}
  setPlain(nameOrId,value){const d=paramDef(this.descriptor,nameOrId);if(!d)throw new Error(`unknown param ${nameOrId}`);const n=normalize(d,value);this.process(0,{params:[{id:Number(d.id),normalized:n,offset:0}]});}
  _controlMutation(opcode,obj){
    this.e.soraoto_plugin_stop_processing();
    const bytes=loadCBOR(this.R).encode(obj),p=this.e.soraoto_alloc(bytes.length,8)>>>0;if(!p)throw new Error(`control ${opcode}: alloc`);
    new Uint8Array(this.e.memory.buffer,p,bytes.length).set(bytes);
    const st=this.e.soraoto_plugin_control(opcode,p,bytes.length,0,0)|0;
    this.e.soraoto_free(p|0,bytes.length|0,8);
    const restart=this.e.soraoto_plugin_start_processing()|0;if(restart!==0)throw new Error(`control ${opcode}: restart ${restart}`);
    if(st!==0)throw new Error(`control ${opcode}: ${st}`);
  }
  controlQuery(opcode,obj=null){
    this.e.soraoto_plugin_stop_processing();
    const bytes=obj==null?Uint8Array.of(0xf6):loadCBOR(this.R).encode(obj),p=this.e.soraoto_alloc(bytes.length,8)>>>0;if(!p)throw new Error(`query ${opcode}: alloc request`);
    new Uint8Array(this.e.memory.buffer,p,bytes.length).set(bytes);
    const need=this.e.soraoto_plugin_control(opcode,p,bytes.length,0,0)|0;if(need<=0)throw new Error(`query ${opcode}: size ${need}`);
    const out=this.e.soraoto_alloc(need,8)>>>0;if(!out)throw new Error(`query ${opcode}: alloc response`);
    const got=this.e.soraoto_plugin_control(opcode,p,bytes.length,out,need)|0;if(got!==need)throw new Error(`query ${opcode}: got ${got}/${need}`);
    const copy=new Uint8Array(this.e.memory.buffer,out,need).slice();
    this.e.soraoto_free(out|0,need|0,8);this.e.soraoto_free(p|0,bytes.length|0,8);
    const restart=this.e.soraoto_plugin_start_processing()|0;if(restart!==0)throw new Error(`query ${opcode}: restart ${restart}`);
    return loadCBOR(this.R).decode(copy);
  }
  applyPreset(name){
    const fp=(this.descriptor.factory_presets||[]).find(x=>String(x?.meta?.name||'')===String(name));
    if(fp){this._controlMutation(10,{preset_id:Number(fp.id)>>>0});return;}
    const p=ext(this.descriptor).presets?.[name];if(!p)throw new Error(`preset ${name}`);
    const params=[];for(const [k,v] of Object.entries(p)){const d=paramDef(this.descriptor,k);if(d){const n=normalize(d,v);if(n!=null)params.push({id:Number(d.id),normalized:n,offset:0});}}this.process(0,{params});
  }
  process(frames,{inputs=[],params=[],events=[]}={}){
    const L=this.L;this._views();
    for(let b=0;b<this.inBuses.length;b++)for(let c=0;c<2;c++){const a=new Float32Array(this.e.memory.buffer,L.inAudio[b][c],this.maxFrames);a.fill(0);const src=inputs[b]?.[c]||inputs[b]?.[0];if(src&&frames)a.set(src.subarray(0,frames));}
    for(let b=0;b<L.outAudio.length;b++)for(let c=0;c<2;c++)new Float32Array(this.e.memory.buffer,L.outAudio[b][c],this.maxFrames).fill(0);
    for(let i=0;i<params.length;i++){const x=params[i],p=L.params+i*PARAM_SIZE;this.u32(p,x.id);this.u32(p+4,x.offset||0);this.f64(p+8,x.normalized);this.u64(p+16,0);}
    for(let i=0;i<events.length;i++){const x=events[i],p=L.events+i*EVENT_SIZE;this.u8.fill(0,p,p+EVENT_SIZE);this.u16(p,x.kind);this.u32(p+4,EVENT_SIZE);this.u32(p+8,1);this.u32(p+12,x.offset||0);this.u64(p+16,x.noteId||0);if(x.kind===1||x.kind===2){this.f64(p+24,x.pitch||60);this.f32(p+32,x.velocity??0.8);this.u16(p+40,0xffff);}else if(x.kind===3){this.u32(p+24,x.expressionId||1);this.f64(p+32,x.value||0);}}
    const p=L.pb;this.u8.fill(0,p,p+PB_SIZE);this.u32(p,PB_SIZE);this.u32(p+4,ABI);this.u32(p+8,frames);this.u32(p+16,this.inBuses.length?L.inBuses:0);this.u32(p+20,this.inBuses.length);this.u32(p+24,L.outBuses);this.u32(p+28,this.outBuses.length);this.u32(p+32,events.length?L.events:0);this.u32(p+36,events.length);this.u32(p+56,params.length?L.params:0);this.u32(p+60,params.length);
    const st=this.e.soraoto_plugin_process(p)|0;if(st!==0)throw new Error(`${this.file}: process ${st}`);this.frame+=frames;
    return this.L.outAudio.map(a=>[new Float32Array(this.e.memory.buffer,a[0],frames).slice(),new Float32Array(this.e.memory.buffer,a[1],frames).slice()]);
  }
  close(){try{this.e.soraoto_plugin_stop_processing()}catch{}try{this.e.soraoto_plugin_deactivate()}catch{}try{this.e.soraoto_plugin_terminate()}catch{}}
}
module.exports={ABI,PluginHarness,descriptorOf,ext,paramDef,normalize,requiredExports,wasmBuildRoot,wasmPath};
