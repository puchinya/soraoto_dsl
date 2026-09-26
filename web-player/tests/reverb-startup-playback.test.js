const fs=require('fs');
const path=require('path');
const vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const SR=48000;
const BLOCK=128;

global.window=globalThis;
global.SORAOTO_BUILD_ID='node-exact-sim';

function runScript(file){ vm.runInThisContext(fs.readFileSync(path.join(ROOT,file),'utf8'),{filename:file}); }

// Local fetch for exactly the same plugin-host.js URL path resolution.
global.fetch=async function(url){
  let s=String(url).replace(/^https?:\/\/[^/]+\//,'').split('?')[0].replace(/^\.\//,'');
  s=s.replace(/^\.\.\/wasm\//,'wasm/');
  const p=s.startsWith('wasm/')?path.resolve(ROOT,'..','build','wasm',s.slice('wasm/'.length)):path.join(ROOT,s);
  if(!fs.existsSync(p)) return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};
  const b=fs.readFileSync(p);
  return {ok:true,status:200,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
};

function zero(frames){return new Float32Array(frames)}
function cloneChannels(chs,frames){return chs.map(c=>{const x=new Float32Array(frames);x.set(c.subarray(0,frames));return x;});}
function peakOf(chs){let p=0;for(const c of chs||[])for(let i=0;i<c.length;i++){const a=Math.abs(c[i]);if(a>p)p=a;}return p;}
function sumConnections(conns,frames,forceChannels=null){
  if(!conns.length){const n=forceChannels||2;return Array.from({length:n},()=>zero(frames));}
  const rendered=conns.map(x=>x.channels);
  let n=forceChannels||Math.max(...rendered.map(x=>x.length||1));
  const out=Array.from({length:n},()=>zero(frames));
  for(const src of rendered){
    if(!src.length)continue;
    for(let ch=0;ch<n;ch++){
      let sc;
      if(src.length===1&&n===2)sc=src[0];
      else sc=src[Math.min(ch,src.length-1)];
      for(let i=0;i<frames;i++)out[ch][i]+=sc[i]||0;
    }
  }
  return out;
}

class SimAudioParam{
  constructor(v=0){this._value=Number(v)||0;this.events=[];}
  get value(){return this._value}
  set value(v){v=Number(v);if(Number.isFinite(v))this._value=v;}
  _add(type,value,time){value=Number(value);time=Number(time);if(!Number.isFinite(value)||!Number.isFinite(time))return this;this.events.push({type,value,time});this.events.sort((a,b)=>a.time-b.time);return this;}
  setValueAtTime(v,t){return this._add('set',v,t)}
  linearRampToValueAtTime(v,t){return this._add('linear',v,t)}
  exponentialRampToValueAtTime(v,t){return this._add('exp',v,t)}
  cancelScheduledValues(t){t=Number(t);this.events=this.events.filter(e=>e.time<t);return this;}
  valueAt(t){
    const ev=this.events;let prevTime=0,prevVal=this._value;
    for(let i=0;i<ev.length;i++){
      const e=ev[i];
      if(e.time<=t){prevTime=e.time;prevVal=e.value;continue;}
      if((e.type==='linear'||e.type==='exp')&&e.time>prevTime){
        const q=Math.max(0,Math.min(1,(t-prevTime)/(e.time-prevTime)));
        if(e.type==='exp'&&prevVal>0&&e.value>0)return prevVal*Math.pow(e.value/prevVal,q);
        return prevVal+(e.value-prevVal)*q;
      }
      return prevVal;
    }
    return prevVal;
  }
  block(startFrame,frames,sr){const a=new Float32Array(frames);if(!this.events.length){a.fill(this._value);return a;}for(let i=0;i<frames;i++)a[i]=this.valueAt((startFrame+i)/sr);return a;}
}

let NODE_ID=1;
class SimNode{
  constructor(ctx){this.ctx=ctx;this.id=NODE_ID++;this.incoming=[];this.outgoing=[];this._last=null;ctx._nodes.add(this);}
  connect(dest,output=0,input=0){const c={src:this,dest,output:Number(output)||0,input:Number(input)||0};this.outgoing.push(c);dest.incoming.push(c);return dest;}
  disconnect(){for(const c of [...this.outgoing]){const i=c.dest.incoming.indexOf(c);if(i>=0)c.dest.incoming.splice(i,1);}this.outgoing=[];}
  _input(index,frame,frames,memo,forceChannels=null){const rs=[];for(const c of this.incoming){if(c.input!==index)continue;const ports=c.src._render(frame,frames,memo);const ch=ports[c.output]||ports[0]||[zero(frames)];rs.push({channels:ch});}return sumConnections(rs,frames,forceChannels);}
  _render(frame,frames,memo){if(memo.has(this))return memo.get(this);const r=this._process(frame,frames,memo);memo.set(this,r);this._last=r;return r;}
  _process(frame,frames,memo){return [this._input(0,frame,frames,memo)];}
}
class GainNodeSim extends SimNode{constructor(ctx){super(ctx);this.gain=new SimAudioParam(1)}_process(f,n,m){const x=this._input(0,f,n,m);const g=this.gain.block(f,n,this.ctx.sampleRate);const y=x.map(()=>zero(n));for(let ch=0;ch<x.length;ch++)for(let i=0;i<n;i++)y[ch][i]=x[ch][i]*g[i];return[y];}}
class BiquadNodeSim extends SimNode{constructor(ctx){super(ctx);this.type='lowpass';this.frequency=new SimAudioParam(350);this.Q=new SimAudioParam(1);this.gain=new SimAudioParam(0)}_process(f,n,m){return[this._input(0,f,n,m)];}}
class CompressorNodeSim extends SimNode{constructor(ctx){super(ctx);this.threshold=new SimAudioParam(-24);this.knee=new SimAudioParam(30);this.ratio=new SimAudioParam(12);this.attack=new SimAudioParam(.003);this.release=new SimAudioParam(.25);this.reduction=0;}
  // Upper-bound model: WebAudio DynamicsCompressor never supplies makeup gain.
  // Bypassing it cannot hide an overload upstream of the compressor.
  _process(f,n,m){return[this._input(0,f,n,m)];}}
class WaveShaperNodeSim extends SimNode{constructor(ctx){super(ctx);this.curve=null;this.oversample='none'}_process(f,n,m){const x=this._input(0,f,n,m);if(!this.curve)return[x];const c=this.curve,N=c.length,y=x.map(()=>zero(n));for(let ch=0;ch<x.length;ch++)for(let i=0;i<n;i++){const v=Math.max(-1,Math.min(1,x[ch][i]));const q=(v+1)*.5*(N-1),a=Math.floor(q),b=Math.min(N-1,a+1),t=q-a;y[ch][i]=c[a]+(c[b]-c[a])*t;}return[y];}}
class StereoPannerNodeSim extends SimNode{constructor(ctx){super(ctx);this.pan=new SimAudioParam(0)}_process(f,n,m){const x=this._input(0,f,n,m,2),p=this.pan.block(f,n,this.ctx.sampleRate),L=zero(n),R=zero(n);for(let i=0;i<n;i++){const l=x[0][i],r=x[1][i],pan=Math.max(-1,Math.min(1,p[i]));if(pan<=0){const a=(pan+1)*Math.PI/2;L[i]=l+r*Math.cos(a);R[i]=r*Math.sin(a);}else{const a=pan*Math.PI/2;L[i]=l*Math.cos(a);R[i]=r+l*Math.sin(a);}}return[[L,R]];}}
class SplitterNodeSim extends SimNode{constructor(ctx,n=2){super(ctx);this.numberOfOutputs=n}_process(f,n,m){const x=this._input(0,f,n,m,2);return[[x[0]],[x[1]]];}}
class MergerNodeSim extends SimNode{constructor(ctx,n=2){super(ctx);this.numberOfInputs=n}_process(f,n,m){const L=this._input(0,f,n,m,1)[0],R=this._input(1,f,n,m,1)[0];return[[L,R]];}}
class AnalyserNodeSim extends SimNode{constructor(ctx){super(ctx);this.fftSize=2048;this.smoothingTimeConstant=.8;this.ring=new Float32Array(this.fftSize);this.rp=0;}_process(f,n,m){const x=this._input(0,f,n,m);const mono=x[0]||zero(n);for(let i=0;i<n;i++){this.ring[this.rp++%this.ring.length]=mono[i];}return[x];}getFloatTimeDomainData(dst){const N=this.ring.length,start=this.rp%N;for(let i=0;i<dst.length;i++)dst[i]=this.ring[(start+i)%N]||0;}}
class DelayNodeSim extends SimNode{constructor(ctx,max=1){super(ctx);this.delayTime=new SimAudioParam(0);this._max=max;this._buf=[new Float32Array(Math.ceil(ctx.sampleRate*max)+BLOCK*2),new Float32Array(Math.ceil(ctx.sampleRate*max)+BLOCK*2)];}_process(f,n,m){const x=this._input(0,f,n,m,2),y=[zero(n),zero(n)],d=Math.max(0,Math.round(this.delayTime.valueAt(f/this.ctx.sampleRate)*this.ctx.sampleRate)),N=this._buf[0].length;for(let i=0;i<n;i++)for(let ch=0;ch<2;ch++){const w=(f+i)%N,rr=(f+i-d+N*1000)%N;y[ch][i]=d?this._buf[ch][rr]:x[ch][i];this._buf[ch][w]=x[ch][i];}return[y];}}
class DestinationNodeSim extends SimNode{_process(f,n,m){return[this._input(0,f,n,m,2)];}}

class PortEndpoint{
  constructor(){this.peer=null;this.listeners=[];this.onmessage=null;this.pending=[];this.closed=false;}
  postMessage(data){if(this.closed||!this.peer||this.peer.closed)return;const evt={data};const p=this.peer;if(p.onmessage){p.onmessage(evt);return;}if(p.listeners.length){for(const fn of [...p.listeners])fn(evt);return;}p.pending.push(evt);}
  addEventListener(type,fn){if(type!=='message')return;this.listeners.push(fn);if(this.pending.length){const q=this.pending.splice(0);for(const e of q)fn(e);}}
  removeEventListener(type,fn){if(type==='message')this.listeners=this.listeners.filter(x=>x!==fn)} start(){} close(){this.closed=true;}
}
function portPair(){const a=new PortEndpoint(),b=new PortEndpoint();a.peer=b;b.peer=a;return[a,b];}
const PROCESSORS=new Map();
global.registerProcessor=(name,klass)=>PROCESSORS.set(name,klass);
let constructingPort=null;
global.AudioWorkletProcessor=class{constructor(){this.port=constructingPort;}};
global.currentFrame=0;

class AudioWorkletNodeSim extends SimNode{
  constructor(ctx,name,options={}){super(ctx);this.name=name;this.options=options;const K=PROCESSORS.get(name);if(!K)throw new Error(`processor ${name} not registered`);const [nodePort,procPort]=portPair();this.port=nodePort;constructingPort=procPort;try{this._processor=new K(options);}finally{constructingPort=null;}this.numberOfInputs=options.numberOfInputs||0;this.numberOfOutputs=options.numberOfOutputs||1;this.outputChannelCount=options.outputChannelCount||[2];this.lastInputPeak=0;this.lastOutputPeak=0;this.maxInputPeak=0;this.maxOutputPeak=0;}
  _process(f,n,m){global.currentFrame=f;const inputs=[];for(let i=0;i<this.numberOfInputs;i++)inputs.push(this._input(i,f,n,m,2));const out=[Array.from({length:this.outputChannelCount[0]||2},()=>zero(n))];this.lastInputPeak=peakOf(inputs.flat());this.maxInputPeak=Math.max(this.maxInputPeak,this.lastInputPeak);this._processor.process(inputs,out);this.lastOutputPeak=peakOf(out[0]);this.maxOutputPeak=Math.max(this.maxOutputPeak,this.lastOutputPeak);return out;}
}
global.AudioWorkletNode=AudioWorkletNodeSim;

class SimAudioContext{
  constructor(opts={}){this.sampleRate=Number(opts.sampleRate)||SR;this.currentTime=0;this._nodes=new Set();this.destination=new DestinationNodeSim(this);this.state='running';this.audioWorklet={addModule:async(url)=>{if(PROCESSORS.has('soraoto-plugin-v1'))return;let s=String(url).split('?')[0].replace(/^\.\//,'');if(s==='assets/worklets/soraoto-plugin-processor.js')s='src/worklets/soraoto-plugin-processor.js';runScript(s);}};}
  createGain(){return new GainNodeSim(this)} createBiquadFilter(){return new BiquadNodeSim(this)} createDynamicsCompressor(){return new CompressorNodeSim(this)} createWaveShaper(){return new WaveShaperNodeSim(this)} createStereoPanner(){return new StereoPannerNodeSim(this)} createChannelSplitter(n){return new SplitterNodeSim(this,n)} createChannelMerger(n){return new MergerNodeSim(this,n)} createAnalyser(){return new AnalyserNodeSim(this)} createDelay(max){return new DelayNodeSim(this,max)}
  async resume(){this.state='running'}
  renderBlock(frame,frames){this.currentTime=frame/this.sampleRate;global.currentFrame=frame;const memo=new Map();return {memo,master:this.destination._render(frame,frames,memo)[0]};}
}
class SimOfflineAudioContext extends SimAudioContext{}
global.AudioContext=SimAudioContext;global.OfflineAudioContext=SimOfflineAudioContext;

// Load actual WebPlayer sources without changing their logic.
runScript('src/js/plugin-cbor.js');
runScript('src/js/plugin-interface.js');
runScript('src/js/plugin-registry.js');
runScript('src/js/instrument-library.js');
runScript('src/js/plugin-host.js');
runScript('src/js/audio-graph.js');
runScript('src/js/compiler.js');

// Export exact scheduler functions from app.js source text, without rewriting bodies.
const appSource=fs.readFileSync(path.join(ROOT,'src/js/app.js'),'utf8');
function extractFunction(name){
  const marker=`function ${name}`;const i=appSource.indexOf(marker);if(i<0)throw new Error(`missing ${name}`);const open=appSource.indexOf('{',i);let d=1,q=null,esc=false,j=open+1;for(;j<appSource.length;j++){const c=appSource[j];if(q){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===q)q=null;}else if(c==='"'||c==="'")q=c;else if(c==='{')d++;else if(c==='}'&&!--d){j++;break;}}return appSource.slice(i,j);
}
const names=['interpolateControl','automationAt','ccAt','pitchBendAt','sustainValueAt','sustainedEndBeat','lfoValue','musicalPeriodBeats','prepareWasmInstrumentTrack','scheduleWasmNoteEvent','prepareWasmDrumTrack','scheduleWasmDrumEvent','activeTrack','buildRealtimeQueues','pumpRealtimeScheduler'];
for(const name of names){global[name]=vm.runInThisContext(`(${extractFunction(name)})`,{filename:`app.js:${name}`});}
// Fallback paths must not occur for this song; fail if they do.
global.scheduleNote=()=>{throw new Error('unexpected native note fallback')};
global.scheduleDrum=()=>{throw new Error('unexpected native drum fallback')};
global.state={solo:new Set(),muted:new Set(),schedulerQueues:[]};
global.wasmNoteSerial=1;

(async()=>{
  const songFile=process.argv[2]||path.join(ROOT,'public/songs','jpop-blue-hour-signal.soraoto');
  const src=fs.readFileSync(path.isAbsolute(songFile)?songFile:path.join(ROOT,songFile),'utf8');
  const ir=SoraotoCompiler.compile(src);const errs=(ir.diagnostics||[]).filter(x=>x.kind==='error');if(errs.length)throw new Error(JSON.stringify(errs));
  const ac=new AudioContext({sampleRate:SR});
  const graph=await SoraotoAudioGraph.build(ac,ir);
  const timeOfBeat=b=>SoraotoAudioGraph.beatToSeconds(ir,b);
  const startAt=ac.currentTime+0.18;
  graph.prepareTimelineAutomation?.(startAt,timeOfBeat);
  state.schedulerQueues=buildRealtimeQueues(ac,graph,ir,startAt,timeOfBeat);
  pumpRealtimeScheduler(ac,ir,startAt,timeOfBeat);

  const reverbEntry=[...graph.entries.values()].find(e=>(e.effectNodes||[]).some(x=>String(x.fx?.name).toLowerCase()==='reverb'));
  if(!reverbEntry){console.log(JSON.stringify({song:ir.title,sampleRate:SR,blockSize:BLOCK,startAt,seconds:4,noReverb:true}));await graph.dispose();return;}
  const reverbNode=(reverbEntry.effectNodes||[]).find(x=>String(x.fx?.name).toLowerCase()==='reverb')?.node;
  const spaceInput=reverbEntry.input,spaceOut=reverbEntry.output;
  

  const captureStart=Math.round(startAt*SR),captureEnd=captureStart+4*SR,totalEnd=captureEnd;
  let nextPump=.05;
  const stats={reverbIn:{peak:0,frame:0},reverbRaw:{peak:0,frame:0},spaceOut:{peak:0,frame:0}};
  const windows=Array.from({length:40},(_,i)=>({t0:i*.1,t1:(i+1)*.1,reverbIn:0,reverbRaw:0,spaceOut:0}));
  const setPeak=(key,p,frame)=>{if(p>stats[key].peak){stats[key]={peak:p,frame}}};
  for(let frame=0;frame<totalEnd;frame+=BLOCK){
    const n=Math.min(BLOCK,totalEnd-frame);
    while(nextPump<=frame/SR+1e-12){ac.currentTime=nextPump;pumpRealtimeScheduler(ac,ir,startAt,timeOfBeat);nextPump+=.05;}
    ac.currentTime=frame/SR;global.currentFrame=frame;
    ac.currentTime=frame/SR;global.currentFrame=frame;const memo=new Map();spaceOut._render(frame,n,memo);
    if(frame+n<=captureStart)continue;
    const rin=(reverbNode._lastInputs)||null;
    // Force/cache the exact nodes in the same block memo so taps do not advance state twice.
    const revPorts=reverbNode._render(frame,n,memo),rev=revPorts[0];
    const sp=spaceOut._render(frame,n,memo)[0];
    
    // AudioWorkletNode stores the input used on its last processing call.
    const rInput=reverbNode.__lastInputs || reverbNode._capturedInputs || null;
    // Rebuild from incoming sources in the already-computed memo (no processor call).
    const rIn=reverbNode._input(0,frame,n,memo,2);
    const pIn=peakOf(rIn),pRev=peakOf(rev),pSp=peakOf(sp);
    const relFrame=Math.max(0,frame-captureStart);
    setPeak('reverbIn',pIn,frame);setPeak('reverbRaw',pRev,frame);setPeak('spaceOut',pSp,frame);
    const wi=Math.max(0,Math.min(windows.length-1,Math.floor(relFrame/SR/.1)));const w=windows[wi];w.reverbIn=Math.max(w.reverbIn,pIn);w.reverbRaw=Math.max(w.reverbRaw,pRev);w.spaceOut=Math.max(w.spaceOut,pSp);
  }
  const db=x=>x>0?20*Math.log10(x):-Infinity;
  const out={song:ir.title,sampleRate:SR,blockSize:BLOCK,startAt,seconds:4,stats:{}};
  for(const [k,v] of Object.entries(stats))out.stats[k]={peak:v.peak,dbfs:db(v.peak),songTime:(v.frame-captureStart)/SR,clipped:v.peak>=1};
  out.reverbWorklet={maxInputPeak:reverbNode.maxInputPeak,maxInputDb:db(reverbNode.maxInputPeak),maxOutputPeak:reverbNode.maxOutputPeak,maxOutputDb:db(reverbNode.maxOutputPeak)};
  out.windows=windows;
  const assert=require('assert');
  assert(out.stats.reverbIn.peak < 1, `Reverb input clipped: ${JSON.stringify(out.stats.reverbIn)}`);
  assert(out.stats.reverbRaw.peak < 1, `Reverb output clipped: ${JSON.stringify(out.stats.reverbRaw)}`);
  assert(out.stats.spaceOut.peak < 1, `Space bus output clipped: ${JSON.stringify(out.stats.spaceOut)}`);
  // Keep ample startup headroom so a future gain/routing regression fails before hard clipping.
  assert(out.stats.reverbIn.peak < 0.25, `Reverb startup headroom collapsed: ${out.stats.reverbIn.peak}`);
  assert(out.stats.reverbRaw.peak < 0.25, `Reverb wet startup headroom collapsed: ${out.stats.reverbRaw.peak}`);
  if(process.env.SORAOTO_DUMP_REVERB_STARTUP==='1') console.log(JSON.stringify(out,null,2));
  console.log('PASS reverb startup playback regression',{
    song:out.song,
    seconds:out.seconds,
    reverbInDb:+out.stats.reverbIn.dbfs.toFixed(2),
    reverbOutDb:+out.stats.reverbRaw.dbfs.toFixed(2),
    spaceOutDb:+out.stats.spaceOut.dbfs.toFixed(2)
  });
  await graph.dispose();
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1)});
