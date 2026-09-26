"use strict";

const ABI = 0x00010000;
const PB_SIZE = 176;
const CONTEXT_SIZE = 192;
const BUS_SIZE = 32;
const PARAM_SIZE = 24;
const EVENT_SIZE = 64;
const PARAM_CAPACITY = 256;
const EVENT_CAPACITY = 256;
const SORAOTO_OK = 0;
const DSP_OUTPUT_FAULT_LIMIT = 64;

function alignUp(v,a){ return (v + a - 1) & ~(a - 1); }
function eqBytes(a,b){
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}
function renderFrame(){
  // `currentTime` is the AudioContext transport clock.  Some WebKit versions
  // have exposed a stale/incorrect `currentFrame` around suspend/resume or
  // AudioWorklet construction, so never use currentFrame as the scheduling
  // authority.  Keep it only as a diagnostic fallback for non-browser tests.
  const t=Number(globalThis.currentTime),sr=Number(globalThis.sampleRate);
  if(Number.isFinite(t)&&Number.isFinite(sr)&&sr>0)return Math.max(0,Math.round(t*sr));
  const f=Number(globalThis.currentFrame);
  return Number.isFinite(f)?Math.max(0,Math.floor(f)):0;
}

class SoraotoPluginProcessor extends AudioWorkletProcessor {
  constructor(options){
    super();
    const o=options.processorOptions||{};
    this.ready=false;
    this.disposed=false;
    this.queue=[];
    this.queueHead=0;
    this.queueDirty=false;
    this.maxFrames=Math.max(1,Number(o.maxFrames)||128);
    this.descriptor=o.descriptor||{};
    this.paramInterpolation=new Map((this.descriptor.parameters||[]).map(x=>[Number(x.id)>>>0,String(x.interpolation||"step")]));
    this.paramAnchors=new Map();
    this.projectOriginFrame=renderFrame();
    this.traceEnabled=false;this.traceStartFrame=0;this.traceUntilFrame=0;this.traceNextFrame=0;
    this.inputBuses=(this.descriptor.audio_buses||[]).filter(x=>x.direction==="input"&&x.default_active);
    this.outputBuses=(this.descriptor.audio_buses||[]).filter(x=>x.direction==="output"&&x.default_active);
    this.eventBus=(this.descriptor.event_buses||[]).find(x=>x.direction==="input")||null;
    this.port.onmessage=e=>this._onMessage(e.data||{});
    try{
      this._initialize(o);
      this.ready=true;
      this.port.postMessage({type:"ready",abi:ABI,pluginId:this.descriptor.id});
    }catch(err){
      this.port.postMessage({type:"error",message:String(err?.message||err)});
      this._dispose();
    }
  }

  _initialize(o){
    const bytes=o.wasmBytes instanceof Uint8Array?o.wasmBytes:new Uint8Array(o.wasmBytes||[]);
    const module=new WebAssembly.Module(bytes);
    const sections=WebAssembly.Module.customSections(module,"soraoto.plugin.v1");
    if(sections.length!==1)throw new Error(`soraoto.plugin.v1 section count ${sections.length}`);
    const embedded=new Uint8Array(sections[0]);
    const expected=o.descriptorBytes instanceof Uint8Array?o.descriptorBytes:new Uint8Array(o.descriptorBytes||[]);
    if(!eqBytes(embedded,expected))throw new Error("descriptor custom section mismatch");

    // Built-in plugins have no imports. The ABI permits soraoto_host_v1 imports,
    // but this browser profile advertises no host-service capabilities.
    this.instance=new WebAssembly.Instance(module,{});
    this.exports=this.instance.exports;
    this.memory=this.exports.memory;
    if((this.exports.soraoto_plugin_abi_version()>>>0)!==ABI)throw new Error("Plugin ABI version mismatch");
    let st=this.exports.soraoto_plugin_init(ABI|0);
    if(st!==SORAOTO_OK)throw new Error(`soraoto_plugin_init failed: ${st}`);

    // Descriptor returned through control plane must be byte-identical to the
    // mandatory custom section. Every temporary allocation is guarded so an
    // exception during initialization cannot strand allocator blocks across
    // repeated song loads.
    let nullPtr=0,descPtr=0,need=0;
    try{
      nullPtr=this.exports.soraoto_alloc(1,8)>>>0;
      if(!nullPtr)throw new Error("soraoto_alloc(null request) failed");
      new Uint8Array(this.memory.buffer,nullPtr,1)[0]=0xf6;
      need=this.exports.soraoto_plugin_control(1,nullPtr,1,0,0)|0;
      if(need<=0)throw new Error(`GET_DESCRIPTOR size query failed: ${need}`);
      descPtr=this.exports.soraoto_alloc(need,8)>>>0;
      if(!descPtr)throw new Error("soraoto_alloc(descriptor) failed");
      const got=this.exports.soraoto_plugin_control(1,nullPtr,1,descPtr,need)|0;
      if(got!==need)throw new Error(`GET_DESCRIPTOR failed: ${got}`);
      const returned=new Uint8Array(this.memory.buffer,descPtr,need);
      if(!eqBytes(returned,embedded))throw new Error("GET_DESCRIPTOR != soraoto.plugin.v1");
    }finally{
      try{if(descPtr)this.exports.soraoto_free(descPtr|0,need|0,8);}catch{}
      try{if(nullPtr)this.exports.soraoto_free(nullPtr|0,1,8);}catch{}
    }

    const configBytes=o.configBytes instanceof Uint8Array?o.configBytes:new Uint8Array(o.configBytes||[]);
    let cfgPtr=0;
    try{
      cfgPtr=this.exports.soraoto_alloc(configBytes.length,8)>>>0;
      if(!cfgPtr)throw new Error("soraoto_alloc(config) failed");
      new Uint8Array(this.memory.buffer,cfgPtr,configBytes.length).set(configBytes);
      st=this.exports.soraoto_plugin_control(2,cfgPtr,configBytes.length,0,0)|0;
      if(st!==SORAOTO_OK)throw new Error(`CONFIGURE failed: ${st}`);
    }finally{
      try{if(cfgPtr)this.exports.soraoto_free(cfgPtr|0,configBytes.length|0,8);}catch{}
    }

    const presetRequest=o.factoryPresetRequest instanceof Uint8Array?o.factoryPresetRequest:new Uint8Array(o.factoryPresetRequest||[]);
    if(o.factoryPresetId!=null){
      if(!presetRequest.length)throw new Error("factory preset request missing");
      let pp=0;
      try{
        pp=this.exports.soraoto_alloc(presetRequest.length,8)>>>0;
        if(!pp)throw new Error("soraoto_alloc(factory preset) failed");
        new Uint8Array(this.memory.buffer,pp,presetRequest.length).set(presetRequest);
        st=this.exports.soraoto_plugin_control(10,pp,presetRequest.length,0,0)|0;
        if(st!==SORAOTO_OK)throw new Error(`LOAD_FACTORY_PRESET ${o.factoryPresetId} failed: ${st}`);
      }finally{
        try{if(pp)this.exports.soraoto_free(pp|0,presetRequest.length|0,8);}catch{}
      }
    }

    this._allocateArena();
    st=this.exports.soraoto_plugin_activate()|0;
    if(st!==SORAOTO_OK)throw new Error(`activate failed: ${st}`);
    this.latencySamples=this.exports.soraoto_plugin_latency_samples()|0;
    this.tailSamples=this.exports.soraoto_plugin_tail_samples();
    st=this.exports.soraoto_plugin_start_processing()|0;
    if(st!==SORAOTO_OK)throw new Error(`start_processing failed: ${st}`);

    const initFrame=this.projectOriginFrame;
    const initial=(o.initialParameters||[]).map(x=>({
      type:"parameter",id:Number(x.id)>>>0,normalized:Number(x.normalized),frame:initFrame
    }));
    this._writeAndProcess(0,[],initial,initFrame);
    for(const x of initial){
      let n=Number(x.normalized);if(!Number.isFinite(n))continue;n=Math.max(0,Math.min(1,n));
      this.paramAnchors.set(Number(x.id)>>>0,{frame:initFrame,normalized:n,authored:false});
    }
  }

  _allocateArena(){
    const inputCount=this.inputBuses.length;
    const outputCount=Math.max(1,this.outputBuses.length);
    let off=0;
    const take=(size,align=16)=>{off=alignUp(off,align);const r=off;off+=size;return r;};
    const layout={};
    layout.pb=take(PB_SIZE,16);
    layout.ctx=take(CONTEXT_SIZE,16);
    layout.inBuses=take(inputCount*BUS_SIZE,16);
    layout.outBuses=take(outputCount*BUS_SIZE,16);
    layout.inChannelTables=[];
    for(let i=0;i<inputCount;i++)layout.inChannelTables.push(take(8,8));
    layout.outChannelTables=[];
    for(let i=0;i<outputCount;i++)layout.outChannelTables.push(take(8,8));
    layout.inAudio=[];
    for(let i=0;i<inputCount;i++)layout.inAudio.push([take(this.maxFrames*4,16),take(this.maxFrames*4,16)]);
    layout.outAudio=[];
    for(let i=0;i<outputCount;i++)layout.outAudio.push([take(this.maxFrames*4,16),take(this.maxFrames*4,16)]);
    layout.params=take(PARAM_CAPACITY*PARAM_SIZE,16);
    layout.events=take(EVENT_CAPACITY*EVENT_SIZE,16);
    const total=alignUp(off,16);
    const base=this.exports.soraoto_alloc(total,16)>>>0;
    if(!base)throw new Error(`soraoto_alloc(process arena ${total}) failed`);
    this.arenaPtr=base;this.arenaSize=total;
    for(const k of ["pb","ctx","inBuses","outBuses","params","events"])layout[k]+=base;
    layout.inChannelTables=layout.inChannelTables.map(x=>x+base);
    layout.outChannelTables=layout.outChannelTables.map(x=>x+base);
    layout.inAudio=layout.inAudio.map(x=>x.map(y=>y+base));
    layout.outAudio=layout.outAudio.map(x=>x.map(y=>y+base));
    this.layout=layout;
    this._refreshViews();
    this._initializeStaticArena();
  }

  _refreshViews(){
    this.dv=new DataView(this.memory.buffer);
    this.u8=new Uint8Array(this.memory.buffer);
  }
  _u16(p,v){this.dv.setUint16(p,v>>>0,true);}
  _u32(p,v){this.dv.setUint32(p,v>>>0,true);}
  _f32(p,v){this.dv.setFloat32(p,Number(v)||0,true);}
  _f64(p,v){this.dv.setFloat64(p,Number(v)||0,true);}
  _u64(p,v){
    const n=Number.isFinite(Number(v))?Math.max(0,Math.floor(Number(v))):0;
    this._u32(p,n>>>0);this._u32(p+4,Math.floor(n/4294967296)>>>0);
  }

  _initializeStaticArena(){
    const L=this.layout;
    // Process context prefix used by this browser host.
    this._u32(L.ctx,CONTEXT_SIZE);
    this._u32(L.ctx+4,0); // no optional valid flags advertised
    this._u64(L.ctx+8,0); // state flags

    for(let i=0;i<this.inputBuses.length;i++){
      const p=L.inBuses+i*BUS_SIZE,table=L.inChannelTables[i];
      this._u32(p,Number(this.inputBuses[i].id)||0);
      this._u32(p+4,2);this._u32(p+8,table);this._u32(p+12,0);this._u64(p+16,0);this._u64(p+24,0);
      this._u32(table,L.inAudio[i][0]);this._u32(table+4,L.inAudio[i][1]);
    }
    for(let i=0;i<Math.max(1,this.outputBuses.length);i++){
      const p=L.outBuses+i*BUS_SIZE,table=L.outChannelTables[i];
      this._u32(p,Number(this.outputBuses[i]?.id)||1);
      this._u32(p+4,2);this._u32(p+8,table);this._u32(p+12,0);this._u64(p+16,0);this._u64(p+24,0);
      this._u32(table,L.outAudio[i][0]);this._u32(table+4,L.outAudio[i][1]);
    }
  }

  _onMessage(d){
    if(this.disposed)return;
    if(d.type==="reset"){
      const requestId=Number(d.requestId)||0;
      try{
        this.exports.soraoto_plugin_stop_processing();
        this.exports.soraoto_plugin_reset();
        const st=this.exports.soraoto_plugin_start_processing()|0;
        if(st!==SORAOTO_OK)throw new Error(`restart after reset failed: ${st}`);
        this.queue.length=0;this.queueHead=0;this.queueDirty=false;
        const now=renderFrame();
        // Preserve parameter values, but discard authored interpolation history
        // from the previous transport. The next transport_origin message will
        // replace this provisional origin before scheduling starts.
        for(const [id,a] of this.paramAnchors){
          this.paramAnchors.set(id,{frame:now,normalized:Number(a.normalized)||0,authored:false});
        }
        this.projectOriginFrame=now;
        this.port.postMessage({type:"reset_done",requestId,frame:now});
      }catch(e){this.port.postMessage({type:"error",requestId,message:String(e?.message||e)});}
      return;
    }
    if(d.type==="dispose"){
      this._dispose();return;
    }
    if(d.type==="transport_origin"){
      const f=Number(d.frame);if(Number.isFinite(f))this.projectOriginFrame=Math.max(0,Math.floor(f));
      return;
    }
    if(d.type==="trace_config"){
      this.traceEnabled=!!d.enabled;
      this.traceStartFrame=Math.max(0,Math.floor(Number(d.startFrame)||0));
      this.traceUntilFrame=Math.max(this.traceStartFrame,Math.floor(Number(d.untilFrame)||0));
      this.traceNextFrame=this.traceStartFrame;
      return;
    }
    if(["parameter","note_on","note_off","note_expression"].includes(d.type)){
      const item={...d};
      if(!Number.isFinite(Number(item.frame)))item.frame=renderFrame();
      item.frame=Math.max(0,Math.floor(Number(item.frame)));
      this.queue.push(item);this.queueDirty=true;
    }
  }

  _compactQueue(){
    if(this.queueHead && (this.queueHead>1024 || this.queueHead*2>this.queue.length)){
      this.queue=this.queue.slice(this.queueHead);this.queueHead=0;
    }
  }
  _nextQueuedParameter(id){
    const wanted=Number(id)>>>0;
    for(let i=this.queueHead;i<this.queue.length;i++){
      const x=this.queue[i];if(x.type==="parameter"&&(Number(x.id)>>>0)===wanted)return x;
    }
    return null;
  }
  _rampValue(anchor,next,frame){
    const a=Number(anchor?.normalized),b=Number(next?.normalized),af=Number(anchor?.frame),bf=Number(next?.frame);
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(af)||!Number.isFinite(bf)||bf<=af)return Math.max(0,Math.min(1,Number.isFinite(b)?b:a||0));
    const t=Math.max(0,Math.min(1,(frame-af)/(bf-af)));
    return Math.max(0,Math.min(1,a+(b-a)*t));
  }
  _dueMessages(blockStart,frames){
    if(this.queueDirty){
      if(this.queueHead){this.queue=this.queue.slice(this.queueHead);this.queueHead=0;}
      this.queue.sort((a,b)=>(a.frame-b.frame));
      this.queueDirty=false;
    }
    const end=blockStart+frames,events=[],params=[],authoredParams=[];
    while(this.queueHead<this.queue.length){
      const d=this.queue[this.queueHead];
      if(d.frame>=end && frames>0)break;
      if(frames===0 && d.frame>blockStart)break;
      this.queueHead++;
      const offset=frames===0?0:Math.max(0,Math.min(frames-1,d.frame-blockStart));
      if(d.type==="parameter"){
        const item={...d,id:Number(d.id)>>>0,offset};params.push(item);authoredParams.push(item);
      }else events.push({...d,offset});
      if(params.length>=PARAM_CAPACITY||events.length>=EVENT_CAPACITY)break;
    }
    this._compactQueue();
    for(const x of authoredParams){
      let n=Number(x.normalized);if(!Number.isFinite(n))n=0;n=Math.max(0,Math.min(1,n));
      this.paramAnchors.set(x.id,{frame:Number(x.frame),normalized:n,authored:true});
    }
    // The ABI point list is block-local, while a linear automation segment can
    // span many AudioWorklet blocks. Add one synthetic end-of-block point so
    // the Plugin runtime can interpolate continuously instead of stepping at
    // block boundaries. Synthetic points never replace authored anchors.
    if(frames>0&&params.length<PARAM_CAPACITY){
      const tailFrame=end-1;
      for(const [id,anchor] of this.paramAnchors){
        if(this.paramInterpolation.get(id)!=="linear"||!anchor.authored)continue;
        const next=this._nextQueuedParameter(id);if(!next||Number(next.frame)<=Number(anchor.frame)||Number(next.frame)<=tailFrame)continue;
        if(params.some(x=>x.id===id&&x.offset===frames-1))continue;
        params.push({type:"parameter",id,normalized:this._rampValue(anchor,next,tailFrame),frame:tailFrame,offset:frames-1,synthetic:true});
        if(params.length>=PARAM_CAPACITY)break;
      }
    }
    params.sort((a,b)=>(a.offset-b.offset)||(a.id-b.id));
    events.sort((a,b)=>a.offset-b.offset);
    return {events,params};
  }

  _writeParameters(params){
    const p0=this.layout.params;
    for(let i=0;i<params.length;i++){
      const x=params[i],p=p0+i*PARAM_SIZE;
      this._u32(p,Number(x.id));this._u32(p+4,x.offset);
      let n=Number(x.normalized);if(!Number.isFinite(n))n=0;n=Math.max(0,Math.min(1,n));
      this._f64(p+8,n);this._u64(p+16,Number(x.gestureId)||0);
    }
  }

  _writeEvents(events){
    const p0=this.layout.events,busId=Number(this.eventBus?.id)||1;
    for(let i=0;i<events.length;i++){
      const x=events[i],p=p0+i*EVENT_SIZE;
      this.u8.fill(0,p,p+EVENT_SIZE);
      let kind=0;if(x.type==="note_on")kind=1;else if(x.type==="note_off")kind=2;else if(x.type==="note_expression")kind=3;
      this._u16(p,kind);this._u16(p+2,0);this._u32(p+4,EVENT_SIZE);this._u32(p+8,busId);this._u32(p+12,x.offset);this._u64(p+16,Number(x.noteId)||0);
      if(kind===1||kind===2){
        this._f64(p+24,Number(x.pitch)||0);this._f32(p+32,Math.max(0,Math.min(1,Number(x.velocity)||0)));
        this._u32(p+36,0);this._u16(p+40,0xffff);this._u16(p+42,0);this._u32(p+44,0);this._u32(p+48,0);
      }else if(kind===3){
        this._u32(p+24,Number(x.expressionId)||1);this._u32(p+28,0);this._f64(p+32,Number(x.value)||0);
      }
    }
  }

  _copyInputs(inputs,frames){
    for(let b=0;b<this.inputBuses.length;b++){
      const src=inputs[b]||[];
      for(let ch=0;ch<2;ch++){
        const dest=new Float32Array(this.memory.buffer,this.layout.inAudio[b][ch],this.maxFrames);
        if(frames)dest.set((src[ch]||src[0]||new Float32Array(0)).subarray(0,frames),0);
        if(frames<dest.length)dest.fill(0,frames);
      }
      const bus=this.layout.inBuses+b*BUS_SIZE;
      this._u64(bus+16,(src[0]?.length||src[1]?.length)?0:3);
    }
  }
  _clearOutputs(frames){
    for(let b=0;b<this.layout.outAudio.length;b++)for(let ch=0;ch<2;ch++)new Float32Array(this.memory.buffer,this.layout.outAudio[b][ch],this.maxFrames).fill(0,0,frames);
  }
  _writeContext(blockStart){
    const c=this.layout.ctx;
    // Project time is relative to the current transport origin, never to the
    // lifetime of the AudioContext. This keeps reload/replay deterministic.
    const projectSample=Math.max(0,Math.floor(Number(blockStart)-Number(this.projectOriginFrame||0)));
    this._u64(c+16,projectSample);this._u64(c+24,projectSample);
  }
  _writeProcessBlock(frames,eventCount,paramCount){
    const p=this.layout.pb;
    this.u8.fill(0,p,p+PB_SIZE);
    this._u32(p,PB_SIZE);this._u32(p+4,ABI);this._u32(p+8,frames);this._u32(p+12,0);
    this._u32(p+16,this.inputBuses.length?this.layout.inBuses:0);this._u32(p+20,this.inputBuses.length);
    this._u32(p+24,this.layout.outBuses);this._u32(p+28,Math.max(1,this.outputBuses.length));
    this._u32(p+32,eventCount?this.layout.events:0);this._u32(p+36,eventCount);
    this._u32(p+40,0);this._u32(p+44,0);this._u32(p+48,0);
    this._u32(p+56,paramCount?this.layout.params:0);this._u32(p+60,paramCount);
    this._u32(p+64,0);this._u32(p+68,0);this._u32(p+72,0);
    this._u32(p+80,0);this._u32(p+84,0);this._u32(p+88,this.layout.ctx);
    // Remaining unsupported pointer/capacity/count fields stay zero.
  }

  _writeAndProcess(frames,events,params,blockStart){
    this._writeParameters(params);this._writeEvents(events);this._writeContext(blockStart);this._writeProcessBlock(frames,events.length,params.length);
    const st=this.exports.soraoto_plugin_process(this.layout.pb)|0;
    if(st!==SORAOTO_OK)throw new Error(`soraoto_plugin_process failed: ${st}`);
  }

  _recoverFromOutputFault(blockStart,peak){
    try{
      this.exports.soraoto_plugin_stop_processing();
      this.exports.soraoto_plugin_reset();
      const st=this.exports.soraoto_plugin_start_processing()|0;
      if(st!==SORAOTO_OK)throw new Error(`restart after DSP output fault failed: ${st}`);
      this.port.postMessage({
        type:"telemetry",pluginId:this.descriptor.id||"",frame:blockStart,
        projectSample:Math.max(0,blockStart-this.projectOriginFrame),
        event:"dsp_output_fault",outputPeak:peak,recovered:true
      });
      return true;
    }catch(e){
      this.port.postMessage({
        type:"telemetry",pluginId:this.descriptor.id||"",frame:blockStart,
        projectSample:Math.max(0,blockStart-this.projectOriginFrame),
        event:"dsp_output_fault",outputPeak:peak,recovered:false,
        message:String(e?.message||e)
      });
      return false;
    }
  }

  _dispose(){
    if(this.disposed)return;
    this.disposed=true;this.ready=false;
    const e=this.exports;
    if(e){
      try{e.soraoto_plugin_stop_processing?.();}catch{}
      try{e.soraoto_plugin_deactivate?.();}catch{}
      try{if(this.arenaPtr&&this.arenaSize)e.soraoto_free?.(this.arenaPtr|0,this.arenaSize|0,16);}catch{}
      try{e.soraoto_plugin_terminate?.();}catch{}
    }
    this.queue.length=0;this.queueHead=0;this.queueDirty=false;
    this.layout=null;this.dv=null;this.u8=null;this.memory=null;this.exports=null;this.instance=null;
    this.inputBuses=[];this.outputBuses=[];this.eventBus=null;this.arenaPtr=0;this.arenaSize=0;
    try{this.port.postMessage({type:"disposed"});}catch{}
  }

  process(inputs,outputs){
    const out=outputs[0];
    if(!out||!out[0])return !this.disposed;
    const frames=out[0].length;
    if(!this.ready||this.disposed||frames>this.maxFrames){out[0].fill(0);if(out[1])out[1].fill(0);return !this.disposed;}
    try{
      const blockStart=renderFrame();
      const {events,params}=this._dueMessages(blockStart,frames);
      this._copyInputs(inputs,frames);this._clearOutputs(frames);
      this._writeAndProcess(frames,events,params,blockStart);
      const srcL=new Float32Array(this.memory.buffer,this.layout.outAudio[0][0],this.maxFrames);
      const srcR=new Float32Array(this.memory.buffer,this.layout.outAudio[0][1],this.maxFrames);
      let traceInPeak=0,traceOutPeak=0,dspFault=false,dspFaultPeak=0;
      for(let i=0;i<frames;i++){
        let l=srcL[i],r=srcR[i];
        const rawL=Number(l),rawR=Number(r);
        const rawPeak=Math.max(Number.isFinite(rawL)?Math.abs(rawL):Infinity,Number.isFinite(rawR)?Math.abs(rawR):Infinity);
        if(!Number.isFinite(rawL)||!Number.isFinite(rawR)||rawPeak>DSP_OUTPUT_FAULT_LIMIT){
          dspFault=true;dspFaultPeak=Math.max(dspFaultPeak,rawPeak);l=0;r=0;
        }
        out[0][i]=l;if(out[1])out[1][i]=r;
        if(this.traceEnabled&&blockStart>=this.traceStartFrame&&blockStart<=this.traceUntilFrame){
          const src=inputs[0]||[],il=src[0]?.[i]||0,ir=src[1]?.[i]??il;
          traceInPeak=Math.max(traceInPeak,Math.abs(il),Math.abs(ir));traceOutPeak=Math.max(traceOutPeak,Math.abs(l),Math.abs(r));
        }
      }
      if(dspFault){
        out[0].fill(0);if(out[1])out[1].fill(0);
        this._recoverFromOutputFault(blockStart,dspFaultPeak);
      }
      if(this.traceEnabled&&blockStart>=this.traceStartFrame&&blockStart<=this.traceUntilFrame&&blockStart>=this.traceNextFrame){
        this.traceNextFrame=blockStart+Math.max(frames,Math.floor(sampleRate/10));
        this.port.postMessage({type:"telemetry",pluginId:this.descriptor.id||"",frame:blockStart,projectSample:Math.max(0,blockStart-this.projectOriginFrame),inputPeak:traceInPeak,outputPeak:traceOutPeak});
      }
    }catch(e){
      out[0].fill(0);if(out[1])out[1].fill(0);this.ready=false;this.port.postMessage({type:"error",message:String(e?.message||e)});this._dispose();
    }
    return !this.disposed;
  }
}

registerProcessor("soraoto-plugin-v1",SoraotoPluginProcessor);
