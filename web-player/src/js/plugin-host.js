(() => {
"use strict";
const ABI=0x00010000;
const SECTION="soraoto.plugin.v1",INTERFACE_SECTION="soraoto.interface";
const REQUIRED_DESCRIPTOR=["abi_major","abi_minor","id","vendor","name","version","kinds","max_instances","compatible_plugin_ids","required_wasm_features","required_host_features","optional_host_features","process_context_requirements","supports_f64","supports_in_place","deterministic_dsp","distributable","process_modes","io_modes","units","audio_buses","event_buses","routing_hints","parameters","controllers","note_expressions","articulations","key_switches","physical_ui_mappings","orchestral_articulations","controller_mappings","remote_representations","data_exchange_queues","parameter_aliases","factory_presets","program_lists","state","prefetch_support","max_event_output_per_block","max_host_requests_per_block","max_asset_requests_per_block","max_data_exchange_packets_per_block"];
const REQUIRED_EXPORTS=["memory","soraoto_plugin_abi_version","soraoto_plugin_init","soraoto_plugin_terminate","soraoto_alloc","soraoto_free","soraoto_plugin_control","soraoto_plugin_activate","soraoto_plugin_deactivate","soraoto_plugin_start_processing","soraoto_plugin_stop_processing","soraoto_plugin_process","soraoto_plugin_reset","soraoto_plugin_state_snapshot","soraoto_plugin_state_load","soraoto_plugin_latency_samples","soraoto_plugin_tail_samples"];
const LEGACY_EXPORTS=new Set(["init","reset","set_parameter","process","note_on","note_off","note_expression"]);
const workletPromises=new WeakMap(),pluginCache=new Map();
function versioned(url){const s=String(url),sep=s.includes("?")?"&":"?";return `${s}${sep}v=${encodeURIComponent(window.SORAOTO_BUILD_ID||"dev")}`;}
function bytesEqual(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function validateDescriptor(d){
  for(const k of REQUIRED_DESCRIPTOR)if(!(k in d))throw new Error(`Plugin descriptor missing ${k}`);
  if(d.abi_major!==1)throw new Error(`Plugin ABI major ${d.abi_major} unsupported`);
  if(!Array.isArray(d.kinds)||!d.kinds.length)throw new Error("Plugin descriptor kinds empty");
  if(!Array.isArray(d.audio_buses)||!Array.isArray(d.event_buses)||!Array.isArray(d.parameters)||!Array.isArray(d.units))throw new Error("Plugin descriptor arrays invalid");
  const units=d.units.filter(x=>Number(x.id)===0&&x.parent_id==null);if(units.length!==1)throw new Error("Plugin descriptor requires exactly one root unit id 0");
  const pids=new Set(),paths=new Set();for(const p of d.parameters){const id=Number(p.id);if(!Number.isInteger(id)||id<1||id>0xfffffffe)throw new Error(`Invalid Plugin parameter id ${p.id}`);if(pids.has(id))throw new Error(`Duplicate Plugin parameter id ${id}`);if(paths.has(p.path))throw new Error(`Duplicate Plugin parameter path ${p.path}`);pids.add(id);paths.add(p.path);}
  const bids=new Set();for(const b of [...d.audio_buses,...d.event_buses]){const id=Number(b.id);if(!Number.isInteger(id)||id<1||id>0xfffffffe)throw new Error(`Invalid Plugin bus id ${b.id}`);if(bids.has(id))throw new Error(`Duplicate Plugin-global bus id ${id}`);bids.add(id);}
  if(!d.state||typeof d.state.schema_id!=="string"||!Number.isInteger(Number(d.state.schema_version))||!Number.isInteger(Number(d.state.max_snapshot_bytes))||Number(d.state.max_snapshot_bytes)<0)throw new Error("Invalid Plugin StateDescriptor");
  if(!["never","supported","state_dependent"].includes(d.prefetch_support))throw new Error(`Invalid prefetch_support ${d.prefetch_support}`);
  return d;
}
function validateInterfaceSection(module,descriptor){
  if(!window.SoraotoPluginInterface)throw new Error("soraoto.interface validator is not loaded");
  return window.SoraotoPluginInterface.validateModule(module,descriptor);
}
function validateModule(module){
  const sections=WebAssembly.Module.customSections(module,SECTION);if(sections.length!==1)throw new Error(`${SECTION} custom section count ${sections.length}`);
  const descBytes=new Uint8Array(sections[0]);const descriptor=validateDescriptor(SoraotoPluginCBOR.decode(descBytes));const interfaceInfo=validateInterfaceSection(module,descriptor);
  const ex=WebAssembly.Module.exports(module),names=new Set(ex.map(x=>x.name));for(const k of REQUIRED_EXPORTS)if(!names.has(k))throw new Error(`Plugin missing export ${k}`);for(const k of LEGACY_EXPORTS)if(names.has(k))throw new Error(`Legacy Plugin ABI export is forbidden: ${k}`);
  const imports=WebAssembly.Module.imports(module);for(const i of imports)if(i.module!=="soraoto_host_v1")throw new Error(`Forbidden Plugin import ${i.module}.${i.name}`);
  return {descriptor,descriptorBytes:descBytes,interfaceInfo};
}
async function fetchPlugin(url){const build=String(window.SORAOTO_BUILD_ID||"dev"),key=`${build}\u0000${String(url)}`;if(pluginCache.has(key))return pluginCache.get(key);const task=(async()=>{const r=await fetch(versioned(url),{cache:"no-store"});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);const bytes=new Uint8Array(await r.arrayBuffer()),module=new WebAssembly.Module(bytes),v=validateModule(module);return {url,build,bytes,module,...v};})();pluginCache.set(key,task);try{return await task;}catch(e){pluginCache.delete(key);throw e;}}
async function ensureWorklet(ctx){if(!ctx.audioWorklet)throw new Error("AudioWorklet requires HTTPS/secure context");let p=workletPromises.get(ctx);if(!p){p=ctx.audioWorklet.addModule(`assets/worklets/soraoto-plugin-processor.js?v=${encodeURIComponent(window.SORAOTO_BUILD_ID||"dev")}`);workletPromises.set(ctx,p);}await p;}
function ext(d){return d?.["x-net.daradara.soraotodsl-browser"]||{};}
function standardParameters(d){return Array.isArray(d?.parameters)?d.parameters:[];}
function plainDef(d,nameOrId){
  const ps=standardParameters(d);
  if(typeof nameOrId==="string")return ps.find(x=>x.path===nameOrId)||null;
  return ps.find(x=>Number(x.id)===Number(nameOrId))||null;
}
function raw(v){return v&&typeof v==="object"&&"value" in v?v.value:v;}
function plainNumber(def,value){
  let v=raw(value),type=String(def?.type||"").toLowerCase();
  if(value&&typeof value==="object"&&String(def?.unit||"").toLowerCase()==="db"&&typeof value.raw==="string"){
    const m=value.raw.trim().match(/^(-?\d+(?:\.\d+)?)db$/i);if(m)v=Number(m[1]);
  }
  if(type==="enum"&&typeof v==="string"){
    const labels=Array.isArray(def?.enum_values)?def.enum_values:[];
    const idx=labels.indexOf(v);if(idx>=0)v=idx;
  }
  if(type==="bool"&&typeof v==="boolean")v=v?1:0;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function normalize(def,value){
  const p=plainNumber(def,value);if(p==null)return null;
  const type=String(def?.type||"").toLowerCase(),lo=Number(def?.min),hi=Number(def?.max);
  if(type==="bool")return p>=0.5?1:0;
  if(type==="enum"){
    const N=Array.isArray(def?.enum_values)?def.enum_values.length:0;
    if(N<=1)return 0;const idx=Math.max(0,Math.min(N-1,Math.round(p)));return idx/(N-1);
  }
  if(type==="int"&&Number.isFinite(lo)&&Number.isFinite(hi)){
    const N=Math.round(hi-lo+1);if(N<=1)return 0;const v=Math.max(lo,Math.min(hi,Math.round(p)));return (v-lo)/(N-1);
  }
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)return Math.max(0,Math.min(1,p));
  const kind=String(def?.scale?.kind||"linear");
  if(kind==="log"&&lo>0&&hi>0&&p>0)return Math.max(0,Math.min(1,Math.log(p/lo)/Math.log(hi/lo)));
  if(kind==="power"){
    const exponent=Number(def?.scale?.exponent);if(Number.isFinite(exponent)&&exponent>0)return Math.max(0,Math.min(1,Math.pow((p-lo)/(hi-lo),1/exponent)));
  }
  return Math.max(0,Math.min(1,(p-lo)/(hi-lo)));
}
function factoryPreset(descriptor,name){
  if(name==null)return null;const wanted=String(raw(name));
  return (descriptor?.factory_presets||[]).find(p=>String(p?.meta?.name||"")===wanted)||null;
}
function parametersFromProps(descriptor,props,explicit=[],{includeDefaults=false,legacyPreset=true}={}){
  const ps=standardParameters(descriptor),merged={};
  const preset=props?.preset!=null?String(raw(props.preset)):null,presets=ext(descriptor).presets||{};
  if(legacyPreset&&preset&&presets[preset])for(const [k,v] of Object.entries(presets[preset]))if(plainDef(descriptor,k))merged[k]=v;
  if(props)for(const [k,v] of Object.entries(props))if(k!=="preset")merged[k]=v;
  const out=[];
  for(const def of ps){
    if(!(def.path in merged)&&!includeDefaults)continue;
    const source=def.path in merged?merged[def.path]:def.default,n=normalize(def,source);
    if(n!=null)out.push({id:Number(def.id),normalized:n});
  }
  for(const x of explicit){const def=plainDef(descriptor,Number(x.id));if(!def)continue;const n=normalize(def,x.value);if(n!=null){const i=out.findIndex(q=>q.id===Number(x.id));if(i>=0)out[i]={id:Number(x.id),normalized:n};else out.push({id:Number(x.id),normalized:n});}}
  return out.sort((a,b)=>a.id-b.id);
}
function initialParameters(descriptor,props,explicit=[]){
  const preset=props?.preset!=null?String(raw(props.preset)):null;
  const formal=factoryPreset(descriptor,preset);
  return parametersFromProps(descriptor,props,explicit,{includeDefaults:!formal,legacyPreset:!formal});
}
function initialState(descriptor,props,explicit=[]){
  const preset=props?.preset!=null?String(raw(props.preset)):null;
  const formal=factoryPreset(descriptor,preset);
  let parameters=parametersFromProps(descriptor,props,explicit,{includeDefaults:!formal,legacyPreset:!formal});
  // Built-in formal presets also publish an exact browser compatibility mirror.
  // Re-send those normalized values after LOAD_FACTORY_PRESET so the Worklet
  // knows the current automation anchor without querying control-plane state.
  if(formal){
    const name=String(formal?.meta?.name||preset||""),mirror=ext(descriptor).presets?.[name];
    if(mirror)parameters=parametersFromProps(descriptor,{...mirror,...(props||{})},explicit,{includeDefaults:false,legacyPreset:false});
  }
  return {
    factoryPresetId:formal?Number(formal.id)>>>0:null,
    factoryPresetRequest:formal?SoraotoPluginCBOR.encode({preset_id:Number(formal.id)>>>0}):null,
    parameters
  };
}
function configFor(ctx,descriptor,maxFrames){const offline=typeof OfflineAudioContext!=="undefined"&&ctx instanceof OfflineAudioContext;const activeAudio=(descriptor.audio_buses||[]).filter(x=>x.default_active).map(x=>({bus_id:x.id,layout:x.supported_layouts[0],presentation_latency_samples:0}));const activeEvents=(descriptor.event_buses||[]).filter(x=>x.direction==="input").map(x=>({bus_id:x.id,dialect:x.dialects?.[0]||"soraoto-note-v1"}));return {abi:1,sample_rate:SoraotoPluginCBOR.float64(Number(ctx.sampleRate)),sample_format:"f32",max_frames:maxFrames,process_mode:offline?"offline":"realtime",io_mode:offline?"offline":(descriptor.kinds.includes("instrument")?"simple":"advanced"),automation_state:"read",host_info:{id:"net.daradara.soraotodsl.web-player",name:"soraotoDSL Web Player",vendor:"soraotoDSL",version:"1.0.0"},host_capabilities:offline?["offline-processing"]:[],control_quantum_samples:maxFrames,active_audio_buses:activeAudio,active_event_buses:activeEvents,data_exchange_queues:[],capacities:{input_events:256,output_events:0,input_parameter_points:256,output_parameter_points:0,modulation_buffers:0,host_requests:0,asset_requests:0,asset_completions:0,data_exchange_packets:0,input_blob_bytes:0,output_blob_bytes:0}};}
let liveNodeCount=0;
async function makeNode(ctx,url,{kind=null,initialPlain=[],parameterProps=null}={}){
  await ensureWorklet(ctx);
  const plugin=await fetchPlugin(url),descriptor=plugin.descriptor,actualKind=kind||descriptor.kinds[0];
  const init=initialState(descriptor,parameterProps,initialPlain);
  const inputs=(descriptor.audio_buses||[]).filter(x=>x.direction==="input"&&x.default_active).length,maxFrames=128,configBytes=SoraotoPluginCBOR.encode(configFor(ctx,descriptor,maxFrames));
  const node=new AudioWorkletNode(ctx,"soraoto-plugin-v1",{numberOfInputs:inputs,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,processorOptions:{wasmBytes:plugin.bytes,descriptor,descriptorBytes:plugin.descriptorBytes,configBytes,maxFrames,initialParameters:init.parameters,factoryPresetId:init.factoryPresetId,factoryPresetRequest:init.factoryPresetRequest}});
  liveNodeCount++;
  let resolve,reject,settled=false,disposed=false,disposeResolve=null,disposeTimer=0,resetSerial=0;
  const resetPending=new Map();
  const ready=new Promise((a,b)=>{resolve=a;reject=b});
  const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error(`Plugin init timeout: ${url}`));node.dispose?.();}},4000);
  const finishDispose=()=>{
    if(disposed)return;disposed=true;liveNodeCount=Math.max(0,liveNodeCount-1);
    if(disposeTimer){clearTimeout(disposeTimer);disposeTimer=0;}
    for(const [id,p] of resetPending){clearTimeout(p.timer);p.reject(new Error(`Plugin disposed during reset ${id}: ${url}`));}
    resetPending.clear();
    try{node.port.removeEventListener("message",onMessage);}catch{}
    try{node.port.close?.();}catch{}
    disposeResolve?.();disposeResolve=null;
  };
  const onMessage=e=>{
    const d=e.data||{};
    if(d.type==="ready"&&!settled){settled=true;clearTimeout(timer);resolve(node);}
    else if(d.type==="reset_done"){
      const p=resetPending.get(Number(d.requestId)||0);
      if(p){resetPending.delete(Number(d.requestId)||0);clearTimeout(p.timer);p.resolve(d);}
    }else if(d.type==="error"){
      const id=Number(d.requestId)||0,p=id?resetPending.get(id):null;
      if(p){resetPending.delete(id);clearTimeout(p.timer);p.reject(new Error(`Plugin reset failed (${url}): ${d.message||"unknown"}`));}
      else if(!settled){settled=true;clearTimeout(timer);reject(new Error(`Plugin failed (${url}): ${d.message||"unknown"}`));}
    }else if(d.type==="disposed")finishDispose();
    else if(d.type==="telemetry")node.onPluginTelemetry?.(d);
  };
  node.port.addEventListener("message",onMessage);node.port.start?.();
  node.pluginDescriptor=descriptor;node.parameterIds=Object.fromEntries(standardParameters(descriptor).map(p=>[p.path,Number(p.id)]));
  node.setParameter=(id,value,time=null)=>{const def=plainDef(descriptor,Number(id)),n=def?normalize(def,value):null;if(n!=null&&!disposed)node.port.postMessage({type:"parameter",id:Number(id),normalized:n,frame:time==null?undefined:Math.round(time*ctx.sampleRate)});};
  node.setNamedParameter=(name,value,time=null)=>{const id=node.parameterIds[name];if(id!=null)node.setParameter(id,value,time);};
  node.noteOn=(noteId,pitch,velocity,time)=>{if(!disposed)node.port.postMessage({type:"note_on",noteId,pitch,velocity,frame:Math.round(time*ctx.sampleRate)});};
  node.noteOff=(noteId,velocity,time)=>{if(!disposed)node.port.postMessage({type:"note_off",noteId,velocity,frame:Math.round(time*ctx.sampleRate)});};
  node.noteExpression=(noteId,expressionId,value,time)=>{if(!disposed)node.port.postMessage({type:"note_expression",noteId,expressionId:Number(expressionId),value,frame:Math.round(time*ctx.sampleRate)});};
  node.reset=()=>{
    if(disposed)return Promise.reject(new Error(`Plugin already disposed: ${url}`));
    const requestId=++resetSerial;
    return new Promise((resolveReset,rejectReset)=>{
      const timer=setTimeout(()=>{
        if(!resetPending.has(requestId))return;
        resetPending.delete(requestId);
        rejectReset(new Error(`Plugin reset timeout: ${url}`));
      },2000);
      resetPending.set(requestId,{resolve:resolveReset,reject:rejectReset,timer});
      try{node.port.postMessage({type:"reset",requestId});}
      catch(e){clearTimeout(timer);resetPending.delete(requestId);rejectReset(e);}
    });
  };
  node.setTransportOrigin=(time)=>{if(!disposed)node.port.postMessage({type:"transport_origin",frame:Math.max(0,Math.round(Number(time||0)*ctx.sampleRate))});};
  node.setTrace=(enabled,startTime=ctx.currentTime,duration=4)=>{if(disposed)return;const startFrame=Math.max(0,Math.round(Number(startTime||0)*ctx.sampleRate)),untilFrame=startFrame+Math.max(0,Math.round(Number(duration||0)*ctx.sampleRate));node.port.postMessage({type:"trace_config",enabled:!!enabled,startFrame,untilFrame});};
  node.dispose=()=>{
    if(disposed)return Promise.resolve();
    try{node.disconnect();}catch{}
    return new Promise(r=>{
      if(disposed){r();return;}
      const prior=disposeResolve;disposeResolve=()=>{try{prior?.();}finally{r();}};
      try{node.port.postMessage({type:"dispose"});}catch{finishDispose();return;}
      if(!disposeTimer)disposeTimer=setTimeout(finishDispose,750);
    });
  };
  try{await ready;return node;}catch(e){try{await node.dispose();}catch{}throw e;}
}
async function createEffect(ctx,url,initialPlain=[],parameterProps=null){return makeNode(ctx,url,{kind:"effect",initialPlain,parameterProps});}
async function createInstrument(ctx,url,parameterProps={}){return makeNode(ctx,url,{kind:"instrument",parameterProps});}
window.SoraotoPluginHost={ABI,SECTION,INTERFACE_SECTION,validateModule,validateDescriptor,validateInterfaceSection,fetchPlugin,createEffect,createInstrument,ensureWorklet,initialParameters,initialState,factoryPreset,normalize,stats:()=>({liveNodeCount,pluginCacheEntries:pluginCache.size})};
})();
