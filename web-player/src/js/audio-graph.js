(() => {
"use strict";
function raw(prop,fallback=null){return prop?.raw ?? prop?.value ?? fallback;}
function num(prop,fallback=0){const v=prop?.value;return Number.isFinite(+v)?+v:fallback;}
function dbRaw(prop,fallback=0){const s=String(raw(prop,`${fallback}db`));const m=s.match(/^(-?\d+(?:\.\d+)?)db$/i);return m?+m[1]:fallback;}
function gainLinear(prop,fallback=1){const s=String(raw(prop,fallback)).trim();const m=s.match(/^(-?\d+(?:\.\d+)?)db$/i);if(m)return Math.pow(10,+m[1]/20);const n=Number(s);return Number.isFinite(n)?n:fallback;}
function secondsFromMusical(rawValue,tempo){const s=String(rawValue||"").trim();let m=s.match(/^(\d+)\/(\d+)(d?)$/);if(m){let beats=4/(+m[2]);if(m[3])beats*=1.5;return beats*60/tempo;}m=s.match(/^(-?\d+(?:\.\d+)?)(ms|s)$/i);if(m)return +m[1]*(m[2].toLowerCase()==="ms"?.001:1);return Number(s)||0;}

function bpmAt(ir,beat){let bpm=ir.tempo||120;for(const seg of ir.tempoMap||[]){if(seg.kind==="step"&&beat>=seg.beat)bpm=seg.bpm;if(seg.kind==="ramp"&&beat>=seg.startBeat&&beat<=seg.endBeat){const t=(beat-seg.startBeat)/(seg.endBeat-seg.startBeat||1);bpm=seg.startBpm+(seg.endBpm-seg.startBpm)*t;}}return bpm;}
function beatToSeconds(ir,beat){const target=Math.max(0,beat);const map=ir.tempoMap||[{kind:"step",beat:0,bpm:ir.tempo||120}];let t=0,b=0,bpm=ir.tempo||120;const boundaries=new Set([0,target]);for(const s of map){if(s.kind==="step"&&s.beat>0&&s.beat<target)boundaries.add(s.beat);if(s.kind==="ramp"){if(s.startBeat>0&&s.startBeat<target)boundaries.add(s.startBeat);if(s.endBeat>0&&s.endBeat<target)boundaries.add(s.endBeat);}}const pts=[...boundaries].sort((a,b)=>a-b);for(let i=1;i<pts.length;i++){const a=pts[i-1],z=pts[i],mid=(a+z)/2;const ramp=map.find(s=>s.kind==="ramp"&&mid>=s.startBeat&&mid<=s.endBeat);if(ramp){const n=24,step=(z-a)/n;for(let j=0;j<n;j++){const x=a+(j+.5)*step;const q=(x-ramp.startBeat)/(ramp.endBeat-ramp.startBeat||1);const local=ramp.startBpm+(ramp.endBpm-ramp.startBpm)*q;t+=step*60/local;}}else{for(const s of map){if(s.kind==="step"&&s.beat<=a)bpm=s.bpm;}t+=(z-a)*60/bpm;}}return t;}

function createNativeEffect(ctx,fx,tempo){const name=fx.name;let input=ctx.createGain(),output=input;
  if(name==="Gain"){input.gain.value=gainLinear(fx.props.gain,1);return {input,output:input};}
  if(name==="EQ"){const f=ctx.createBiquadFilter();f.type="peaking";f.frequency.value=num(fx.props.frequency,num(fx.props.cutoff,1000));f.Q.value=num(fx.props.q,1);f.gain.value=dbRaw(fx.props.gain,0);input.connect(f);return {input,output:f};}
  if(name==="Compressor"){const c=ctx.createDynamicsCompressor();c.threshold.value=dbRaw(fx.props.threshold,-18);c.ratio.value=num(fx.props.ratio,4);c.attack.value=secondsFromMusical(raw(fx.props.attack,"5ms"),tempo);c.release.value=secondsFromMusical(raw(fx.props.release,"120ms"),tempo);input.connect(c);return {input,output:c};}
  if(name==="Limiter"){const c=ctx.createDynamicsCompressor();c.threshold.value=dbRaw(fx.props.ceiling,-1);c.knee.value=0;c.ratio.value=20;c.attack.value=.001;c.release.value=.08;input.connect(c);return {input,output:c};}
  // Unknown/structural nodes are transparent. Never connect a GainNode to
  // itself: a zero-delay feedback cycle can create silence, instability or
  // bursts depending on the browser's cycle handling.
  return {input,output:input,passthrough:true};
}
function createMutedEffect(ctx){const input=ctx.createGain(),output=ctx.createGain();output.gain.value=0;input.connect(output);return {input,output,muted:true,owned:[input,output]};}
function createDelayFallback(ctx,fx,tempo,{wetOnly=false}={}){const d=ctx.createDelay(4),g=ctx.createGain(),wet=ctx.createGain(),input=ctx.createGain(),output=ctx.createGain();d.delayTime.value=secondsFromMusical(raw(fx.props.time,"1/8d"),tempo);g.gain.value=num(fx.props.feedback,.35);wet.gain.value=wetOnly?1:num(fx.props.mix,.3);if(!wetOnly)input.connect(output);input.connect(d);d.connect(g);g.connect(d);d.connect(wet);wet.connect(output);return {input,output,fallback:true,wetOnly,owned:[d,g,wet,input,output]};}
function pluginFallback(ctx,resolved,fx,tempo,placement){
  const strategy=resolved?.fallback||"bypass";
  if(strategy==="native-delay")return createDelayFallback(ctx,fx,tempo,{wetOnly:placement?.ownerKind==="bus"});
  if(strategy==="native-sidechain")return createNativeEffect(ctx,{name:"Compressor",props:{threshold:{raw:"-18db"},ratio:{value:6}}},tempo);
  if(strategy==="native-limiter")return createNativeEffect(ctx,fx,tempo);
  if(strategy==="mute-on-bus"&&placement?.ownerKind==="bus")return createMutedEffect(ctx);
  if(placement?.ownerKind==="bus"&&fx?.kind==="plugin")return createMutedEffect(ctx);
  return createNativeEffect(ctx,{name:"Gain",props:{gain:{value:1}}},tempo);
}
async function createEffect(ctx,fx,tempo,placement={}){
  const resolved=window.SoraotoPluginRegistry?.resolveEffect?.(fx,{tempo,placement})||null;
  if(resolved){
    try{
      const n=await SoraotoPluginHost.createEffect(ctx,resolved.module,[],resolved.props||{});
      return {input:n,output:n,node:n,sidechain:resolved.sidechain?n:null,wasm:true,owned:[n],resolvedPlugin:resolved};
    }catch(e){
      console.warn(`Plugin effect fallback: ${resolved.name} (${resolved.module})`,e);
      return pluginFallback(ctx,resolved,fx,tempo,placement);
    }
  }
  // A plugin-typed IR node without a module or registry entry must never silently
  // turn into a unity send return. Mute unresolved bus plugins; bypass elsewhere.
  if(fx?.kind==="plugin"){
    console.error("Unresolved Plugin effect",fx?.name,fx?.module||null);
    if(placement?.ownerKind==="bus")return createMutedEffect(ctx);
    return createNativeEffect(ctx,{name:"Gain",props:{gain:{value:1}}},tempo);
  }
  return createNativeEffect(ctx,fx,tempo);
}
async function chainEffects(ctx,effects,tempo,placement={}){
  const input=ctx.createGain();let tail=input;const sidechainNodes=[],owned=[input],effectNodes=[];
  for(const fx of effects||[]){
    // These are graph/track structure in the resolved IR, not insert effects.
    if(["stereo","automation","modulation"].includes(String(fx.name||"").toLowerCase()))continue;
    const e=await createEffect(ctx,fx,tempo,placement);
    tail.connect(e.input);tail=e.output;
    if(e.sidechain)sidechainNodes.push({fx,node:e.sidechain});
    if(e.node)effectNodes.push({fx,node:e.node});
    for(const n of e.owned||[])if(!owned.includes(n))owned.push(n);
  }
  return {input,output:tail,sidechainNodes,effectNodes,owned};
}


function setAudioParam(param,value,time=null,ramp=true){
  if(!param)return;
  const v=Number(value);if(!Number.isFinite(v))return;
  if(time==null){param.value=v;return;}
  try{if(ramp)param.linearRampToValueAtTime(v,time);else param.setValueAtTime(v,time);}catch{try{param.setValueAtTime(v,time);}catch{param.value=v;}}
}
function createStereoStage(ctx,balance=0,width=1){
  const input=ctx.createGain(),split=ctx.createChannelSplitter(2),merge=ctx.createChannelMerger(2);
  const ll=ctx.createGain(),lr=ctx.createGain(),rl=ctx.createGain(),rr=ctx.createGain();
  input.connect(split);
  split.connect(ll,0);split.connect(rl,0);split.connect(lr,1);split.connect(rr,1);
  ll.connect(merge,0,0);lr.connect(merge,0,0);rl.connect(merge,0,1);rr.connect(merge,0,1);
  const p=ctx.createStereoPanner?ctx.createStereoPanner():null;if(p)merge.connect(p);
  const stage={input,output:p||merge,owned:[input,split,merge,ll,lr,rl,rr,...(p?[p]:[])],baseBalance:0};
  stage.setWidth=(value,time=null,ramp=true)=>{const w=Math.max(0,Math.min(2,Number(value)||0));setAudioParam(ll.gain,(1+w)/2,time,ramp);setAudioParam(rr.gain,(1+w)/2,time,ramp);setAudioParam(lr.gain,(1-w)/2,time,ramp);setAudioParam(rl.gain,(1-w)/2,time,ramp);};
  stage.setBalance=(value,time=null,ramp=true)=>{const b=Math.max(-1,Math.min(1,Number(value)||0));if(p)setAudioParam(p.pan,b,time,ramp);else{setAudioParam(ll.gain,b>0?1-b:1,time,ramp);setAudioParam(rr.gain,b<0?1+b:1,time,ramp);}};
  stage.setWidth(width);stage.setBalance(balance);return stage;
}

function createMeterNode(ctx){
  const a=ctx.createAnalyser();
  a.fftSize=1024;
  a.smoothingTimeConstant=.35;
  return {node:a,buffer:new Float32Array(a.fftSize),energy:0,samples:0};
}
function meterValue(m){
  if(!m?.node)return {rms:0,peak:0,db:-96,lufs:-96,integratedLufs:-96};
  m.node.getFloatTimeDomainData(m.buffer);
  let peak=0,sum=0;
  for(let i=0;i<m.buffer.length;i++){
    const x=Number.isFinite(m.buffer[i])?m.buffer[i]:0;
    const ax=Math.abs(x);if(ax>peak)peak=ax;sum+=x*x;
  }
  const rms=Math.sqrt(sum/Math.max(1,m.buffer.length)),db=rms>1e-7?20*Math.log10(rms):-96;
  // Browser reference meter: BS.1770-style calibration over the analyser RMS.
  // Integrated value is accumulated across meter reads; offline regression uses
  // the rendered PCM directly for deterministic whole-program measurements.
  m.energy+=sum;m.samples+=m.buffer.length;
  const integratedRms=Math.sqrt(m.energy/Math.max(1,m.samples));
  return {rms,peak,db,lufs:db>-95?db-.691:-96,integratedLufs:integratedRms>1e-7?20*Math.log10(integratedRms)-.691:-96};
}
function safetyCurve(){
  const n=2048,c=new Float32Array(n),k=1.35,den=Math.tanh(k);
  for(let i=0;i<n;i++){const x=i/(n-1)*2-1;c[i]=Math.tanh(k*x)/den;}
  return c;
}

async function build(ctx,ir){const graph=ir.audioGraph||{nodes:[],edges:[],sidechains:[]};const tempo=ir.tempo||120;const entries=new Map();const sourceTracks=new Map((ir.tracks||[]).map(t=>[t.name,t]));
  // Master first.
  const masterDesc=graph.nodes.find(n=>n.id==="Master")||{id:"Master",effects:[]};
  const masterChain=await chainEffects(ctx,masterDesc.effects||[],tempo,{ownerKind:"master",ownerId:"Master"});

  // Production-oriented output stage. User master inserts run first,
  // followed by subsonic cleanup, gentle glue and a true-peak safety limiter.
  const safetyHP=ctx.createBiquadFilter();
  safetyHP.type="highpass";safetyHP.frequency.value=24;safetyHP.Q.value=.5;
  const glue=ctx.createDynamicsCompressor();
  glue.threshold.value=-10;glue.knee.value=10;glue.ratio.value=1.5;glue.attack.value=.02;glue.release.value=.18;
  const masterGain=ctx.createGain();
  const requestedMasterGain=Number(masterDesc.gain);
  masterGain.gain.value=Number.isFinite(requestedMasterGain)?requestedMasterGain:1;
  let finalLimiter=null,finalLimiterFallback=[];
  try{
    const resolvedLimiter=window.SoraotoPluginRegistry?.resolveEffect?.({name:"Limiter",kind:"plugin",module:null,props:{ceiling:{value:-1},release:{value:.12},lookahead:{value:.005},soft_clip:{value:0},input_gain:{value:0}}},{tempo});
    if(!resolvedLimiter)throw new Error("Limiter plugin is not registered");
    finalLimiter=await SoraotoPluginHost.createEffect(ctx,resolvedLimiter.module,[],resolvedLimiter.props||{});
  }
  catch(e){console.warn("Master limiter plugin fallback",e);const c=ctx.createDynamicsCompressor();c.threshold.value=-1;c.knee.value=0;c.ratio.value=20;c.attack.value=.001;c.release.value=.08;const ws=ctx.createWaveShaper();ws.curve=safetyCurve();ws.oversample="2x";c.connect(ws);finalLimiter={input:c,output:ws};finalLimiterFallback=[c,ws];}
  const limiterInput=finalLimiter.input||finalLimiter,limiterOutput=finalLimiter.output||finalLimiter;
  const masterStartGain=ctx.createGain();
  // Keep the physical output muted until the transport start point. This avoids
  // a startup discontinuity when AudioWorklet/effect state becomes ready.
  masterStartGain.gain.value=0;
  const masterMeter=createMeterNode(ctx);
  masterChain.output.connect(safetyHP);safetyHP.connect(glue);glue.connect(masterGain);masterGain.connect(limiterInput);limiterOutput.connect(masterStartGain);masterStartGain.connect(masterMeter.node);masterMeter.node.connect(ctx.destination);
  entries.set("Master",{
    input:masterChain.input,output:masterMeter.node,
    sidechainNodes:masterChain.sidechainNodes,effectNodes:masterChain.effectNodes,meter:masterMeter,
    effectOwned:masterChain.owned,
    owned:[safetyHP,glue,masterGain,masterStartGain,masterMeter.node,...finalLimiterFallback],
    masterStartGain,
    finalLimiter:finalLimiter?.dispose?finalLimiter:null
  });
  for(const desc of graph.nodes.filter(n=>n.id!=="Master")){
    const chain=await chainEffects(ctx,desc.effects||[],tempo,{ownerKind:desc.kind,ownerId:desc.id});
    let instrumentNode=null,instrumentFader=null,drumNode=null,drumFader=null;
    if(desc.kind==="track"){
      const explicit=desc.instrument?.kind==="wasm-plugin"&&desc.instrument?.module;
      const sourceTrack=sourceTracks.get(desc.id);
      const automaticPreset=!explicit?window.SoraotoInstruments?.superSynthPresetFor?.(sourceTrack):null;
      const module=explicit?desc.instrument.module:(automaticPreset?window.SoraotoInstruments?.superSynthUrl:null);
      const params=explicit?(desc.instrument.params||{}):{preset:{value:automaticPreset}};
      if(module){
        try{instrumentNode=await SoraotoPluginHost.createInstrument(ctx,module,params);instrumentFader=ctx.createGain();instrumentFader.gain.value=1;instrumentNode.connect(instrumentFader);instrumentFader.connect(chain.input);}catch(e){console.warn("Plugin instrument fallback",module,e);}
      }
      if((sourceTrack?.events||[]).some(e=>e.type==="drum")&&window.SoraotoInstruments?.drumPluginUrl){
        try{const preset=window.SoraotoInstruments.drumPresetFor?.(sourceTrack)||"studio";drumNode=await SoraotoPluginHost.createInstrument(ctx,window.SoraotoInstruments.drumPluginUrl,{preset:{value:preset}});drumFader=ctx.createGain();drumFader.gain.value=1;drumNode.connect(drumFader);drumFader.connect(chain.input);}catch(e){console.warn("Drum Plugin fallback",e);}
      }
    }
    let tail=chain.output;
    // Semantic send tap: source inserts are complete at chain.output. Track gain/pan
    // must happen after this point so pre_fader sends are independent of the channel fader.
    const preFaderOutput=tail;
    let trackFader=null;
    if(desc.kind==="track"){
      trackFader=ctx.createGain();
      const initialTrackGain=Number(desc.gain);
      trackFader.gain.value=Number.isFinite(initialTrackGain)?initialTrackGain:1;
      tail.connect(trackFader);tail=trackFader;
    }
    const sourceTrack=sourceTracks.get(desc.id),basePan=desc.kind==="track"?(Number(desc.pan)||0):0;
    const needsStereo=desc.kind==="track"||!!desc.stereo||!!sourceTrack?.timelineAutomation?.some(a=>String(a.target||"").startsWith("stereo."));
    let stereoStage=null;
    if(needsStereo){
      stereoStage=createStereoStage(ctx,Math.max(-1,Math.min(1,basePan+(Number(desc.stereo?.balance)||0))),desc.stereo?.width??1);
      tail.connect(stereoStage.input);tail=stereoStage.output;
    }

    const peakGuard=ctx.createDynamicsCompressor();
    peakGuard.threshold.value=desc.kind==="track"?-12:-9;
    peakGuard.knee.value=10;
    peakGuard.ratio.value=desc.kind==="track"?5:3;
    peakGuard.attack.value=.002;
    peakGuard.release.value=.10;
    tail.connect(peakGuard);

    const out=ctx.createGain();
    // Track gain is handled by trackFader above; bus gain has no dedicated source fader,
    // therefore bus gain is applied here.
    const baseOut=desc.kind==="track"?.72:.82;
    out.gain.value=baseOut*(desc.kind==="bus"?(Number.isFinite(Number(desc.gain))?Number(desc.gain):1):1);
    const meter=createMeterNode(ctx);
    peakGuard.connect(out);
    out.connect(meter.node);
    entries.set(desc.id,{
      input:chain.input,output:meter.node,preFaderOutput,sidechainNodes:chain.sidechainNodes,effectNodes:chain.effectNodes,
      desc,instrumentNode,instrumentFader,drumNode,drumFader,trackFader,peakGuard,meter,stereoStage,effectOwned:chain.owned,
      owned:[...(trackFader?[trackFader]:[]),...(stereoStage?.owned||[]),peakGuard,out,meter.node]
    });
  }
  const routeGains=new Map();
  for(const e of graph.edges||[]){
    const a=entries.get(e.from),b=entries.get(e.to);
    if(!a||!b)continue;
    const g=ctx.createGain();
    const rawGain=Number(e.gain);
    g.gain.value=Number.isFinite(rawGain)?rawGain:1;
    const routeMode=String(e.mode||"direct").toLowerCase();
    const routeSource=routeMode==="pre_fader"&&a.preFaderOutput?a.preFaderOutput:a.output;
    routeSource.connect(g);g.connect(b.input);
    routeGains.set(`${e.from}->${e.to}`,g);
  }
  // Ensure otherwise-unrouted tracks reach master.
  for(const t of ir.tracks||[]){const e=entries.get(t.name);if(!e)continue;const routed=(graph.edges||[]).some(x=>x.from===t.name);if(!routed)e.output.connect(entries.get("Master").input);}
  // Sidechain control edges target the first Sidechain effect on destination track.
  for(const sc of graph.sidechains||[]){const source=entries.get(sc.from),dest=entries.get(sc.to);const target=dest?.sidechainNodes?.[0]?.node;if(source&&target){try{source.output.connect(target,0,1);}catch(e){console.warn("sidechain connect",e);}}}
  function prepareTimelineAutomation(startAt,timeOfBeat){
    const masterEntry=entries.get("Master");
    const gate=masterEntry?.masterStartGain?.gain;
    if(gate){
      try{gate.cancelScheduledValues(startAt);gate.setValueAtTime(0,startAt);gate.linearRampToValueAtTime(1,startAt+.015);}
      catch{gate.value=1;}
    }
    for(const track of ir.tracks||[]){
      const entry=entries.get(track.name);if(!entry)continue;
      // Channel gain belongs after inserts and before pan. Keep source renderers at unity
      // so pre_fader sends remain independent of track gain/volume automation.
      const fader=entry.trackFader?.gain;
      if(fader){
        const initial=Number(track.gain);
        const base=Number.isFinite(initial)?Math.max(0,Math.min(2,initial)):1;
        try{fader.cancelScheduledValues(startAt);fader.setValueAtTime(base,startAt);}catch{fader.value=base;}
        const gainControls=(track.controls||[]).filter(c=>{
          const target=String(c.target||"").toLowerCase();
          return (c.type==="automation"&&(target==="gain"||target==="volume"))||(c.type==="cc"&&Number(c.cc)===7);
        }).sort((a,b)=>Number(a.time)-Number(b.time));
        for(const c of gainControls){
          const at=startAt+timeOfBeat(Number(c.time)||0);
          const target=String(c.target||"").toLowerCase();
          const value=c.type==="cc"?Math.max(0,Math.min(1,Number(c.value)||0)):Math.max(0,Math.min(2,Number(c.value)||0));
          try{if(c.type==="cc")fader.setValueAtTime(value,at);else fader.linearRampToValueAtTime(value,at);}catch{try{fader.setValueAtTime(value,at);}catch{fader.value=value;}}
        }
      }
      // Track-level pan is a graph concern for Plugin-backed tracks. Schedule
      // ordinary pan automation here so built-in and WASM paths behave alike.
      const panPoints=(track.controls||[]).filter(c=>c.type==="automation"&&String(c.target).toLowerCase()==="pan").sort((a,b)=>a.time-b.time);
      for(let i=0;i<panPoints.length;i++){const point=panPoints[i];entry.stereoStage?.setBalance(Math.max(-1,Math.min(1,(Number(entry.desc?.stereo?.balance)||0)+(Number(point.value)||0))),startAt+timeOfBeat(point.time),i!==0);}
      for(const automation of track.timelineAutomation||[]){
        const target=String(automation.target||""),points=automation.points||[];
        for(let i=0;i<points.length;i++){
          const point=points[i],at=startAt+timeOfBeat(point.beat),value=Number(point.value);if(!Number.isFinite(value))continue;
          const ramp=i!==0;
          if(target.startsWith("instrument.")){entry.instrumentNode?.setNamedParameter?.(target.slice(11),value,at);continue;}
          if(target==="stereo.width"){entry.stereoStage?.setWidth(value,at,ramp);continue;}
          if(target==="stereo.balance"||target==="stereo.pan"){entry.stereoStage?.setBalance(Math.max(-1,Math.min(1,(Number(entry.desc?.pan)||0)+value)),at,ramp);continue;}
          if(target.startsWith("send.")){const rg=routeGains.get(`${track.name}->${target.slice(5)}`);if(rg?.gain)setAudioParam(rg.gain,value,at,ramp);continue;}
          let m=target.match(/^(?:effects?\.)?([A-Za-z_][\w-]*)\.(.+)$/);
          if(m){const hit=(entry.effectNodes||[]).find(x=>String(x.fx?.name||"").toLowerCase()===m[1].toLowerCase());hit?.node?.setNamedParameter?.(m[2],value,at);}
        }
      }
    }
  }
  let disposed=false;
  return {
    entries,
    trackInput:(name)=>entries.get(name)?.input||entries.get("Master").input,
    trackInstrument:(name)=>entries.get(name)?.instrumentNode||null,
    trackInstrumentFader:(name)=>entries.get(name)?.instrumentFader||null,
    trackDrumInstrument:(name)=>entries.get(name)?.drumNode||null,
    trackDrumFader:(name)=>entries.get(name)?.drumFader||null,
    master:entries.get("Master"),
    async resetPlugins(){
      if(disposed)return;
      const seen=new Set(),pending=[];
      const apply=n=>{if(!n||seen.has(n))return;seen.add(n);if(typeof n.reset==="function")pending.push(Promise.resolve().then(()=>n.reset()));};
      for(const e of entries.values()){apply(e.instrumentNode);apply(e.drumNode);apply(e.finalLimiter);for(const x of e.effectNodes||[])apply(x.node);for(const x of e.sidechainNodes||[])apply(x.node);}
      if(pending.length)await Promise.all(pending);
    },
    setTransportOrigin(time){
      const seen=new Set();
      const apply=n=>{if(!n||seen.has(n))return;seen.add(n);n.setTransportOrigin?.(time);};
      for(const e of entries.values()){apply(e.instrumentNode);apply(e.drumNode);apply(e.finalLimiter);for(const x of e.effectNodes||[])apply(x.node);for(const x of e.sidechainNodes||[])apply(x.node);}
    },
    setDebugTrace(enabled,onEvent,startTime,duration=4){
      const seen=new Set();
      const apply=n=>{if(!n||seen.has(n))return;seen.add(n);const d=n.pluginDescriptor||{};if(!/reverb/i.test(`${d.id||""} ${d.name||""}`))return;n.onPluginTelemetry=enabled?onEvent:null;n.setTrace?.(enabled,startTime,duration);};
      for(const e of entries.values()){apply(e.instrumentNode);apply(e.drumNode);apply(e.finalLimiter);for(const x of e.effectNodes||[])apply(x.node);for(const x of e.sidechainNodes||[])apply(x.node);}
    },
    prepareTimelineAutomation,
    beatToSeconds:(beat)=>beatToSeconds(ir,beat),
    readMeters(){
      const out={};
      for(const [id,e] of entries)if(e.meter)out[id]=meterValue(e.meter);
      return out;
    },
    async dispose(){
      if(disposed)return;disposed=true;
      const pending=[],seen=new Set();
      const disposeNode=n=>{
        if(!n||seen.has(n))return;seen.add(n);
        try{const r=n.dispose?.();if(r&&typeof r.then==="function")pending.push(r);}catch{}
        try{n.disconnect?.();}catch{}
      };
      for(const e of entries.values()){
        for(const n of [e.instrumentNode,e.drumNode,e.finalLimiter])disposeNode(n);
        try{e.output?.disconnect();}catch{}
        for(const n of e.effectOwned||[])disposeNode(n);
        for(const n of e.owned||[])disposeNode(n);
        for(const side of e.sidechainNodes||[])disposeNode(side.node);
      }
      for(const g of routeGains.values())try{g.disconnect();}catch{}
      routeGains.clear();entries.clear();
      if(pending.length)await Promise.allSettled(pending);
    }
  };
}
window.SoraotoAudioGraph={build,beatToSeconds,bpmAt};
})();
