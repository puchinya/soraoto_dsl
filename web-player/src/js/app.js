(() => {
"use strict";

const SONG_CATALOG_URL="songs/index.json";
const DEFAULT_SOURCE=`project {
  version: 1
  title: "soraotoDSL Draft v0.5 Web Test"
  tempo: 124bpm
  meter: 4/4
  key: C.major

  structure {
    Intro { bars: 2 }
    Verse { bars: 4 }
    Chorus { bars: 4 }
  }

  chords Harmony {
    Verse { C, G/B, Am7, Fmaj7, }
    Chorus { C, G, F, G, }
  }

  track Bass {
    Harmony |> BassRoot(octave: 2, mode: chord_bass)
    gain: -8db
  }

  track Piano {
    Harmony |> PianoVoicing(range: c3..c5, voice_leading: nearest)
    gain: -9db
  }

  track Drums {
    drums {
      Chorus {
        @16:
        Kick "x...x...x...x..."
        Snare "....X.......X..."
        Hat "xxxxxxxxxxxxxxxx"
      }
    }
  }
}`;

const el=id=>document.getElementById(id);
const editor=el("editor"), errors=el("errors"), status=el("status"), tracksEl=el("tracks"), canvas=el("timeline"), ctx2d=canvas.getContext("2d"), sampleSelect=el("sampleSelect");
const appRoot=el("appRoot"), busyOverlay=el("busyOverlay"), busyText=el("busyText"), transportState=el("transportState");
const debugUi={toggle:el("debugToggleBtn"),panel:el("debugPanel"),log:el("debugLog"),summary:el("debugSummary"),clear:el("debugClearBtn"),copy:el("debugCopyBtn"),audioTrace:el("debugAudioTrace")};
const ui={
  compile:el("compileBtn"), play:el("playBtn"), stop:el("stopBtn"),
  load:el("loadSampleBtn"), refresh:el("refreshSongsBtn"),
  exportMidi:el("exportMidiBtn"), exportGarageBand:el("exportGarageBandBtn"),
  render:el("renderWavBtn"), tempo:el("tempoInput"), sample:sampleSelect
};
const mobileViewButtons=[...document.querySelectorAll("[data-mobile-view]")];
function setMobileView(view){
  const allowed=new Set(["mixer","source","tools"]);
  if(!allowed.has(view))view="mixer";
  appRoot.classList.remove("mobile-view-mixer","mobile-view-source","mobile-view-tools");
  appRoot.classList.add(`mobile-view-${view}`);
  for(const b of mobileViewButtons){
    const active=b.dataset.mobileView===view;
    b.classList.toggle("active",active);
    b.setAttribute("aria-pressed",active?"true":"false");
  }
  requestAnimationFrame(()=>{if(view==="mixer")drawTimeline();});
}

const state={
  ir:null,audio:null,audioResources:null,scheduled:[],muted:new Set(),solo:new Set(),
  raf:0,playStart:0,playDuration:0,songDuration:0,graph:null,graphDisposePromise:Promise.resolve(),audioBuffers:new Map(),
  uiMode:"idle",dirty:true,compileValid:false,runtimeReady:false,
  schedulerTimer:0,schedulerQueues:[],meterHold:new Map(),meterFrame:0,
  scheduledDisposers:new Set(),scheduledCleanupTimers:new Set(),lastUiPaint:0,lastMeterPaint:0,
  audioKeepAlive:null,debugLines:[],loadSerial:0,playSerial:0
};
let serverSongs=[];
{
  const saved=localStorage.getItem("soraotoDSL.source");
  editor.value=saved||DEFAULT_SOURCE;
}

function debugEvent(name,data={}){
  const ac=state.audio;
  const row={wallMs:Math.round(performance.now()),audioTime:ac&&Number.isFinite(ac.currentTime)?+ac.currentTime.toFixed(6):null,load:state.loadSerial,play:state.playSerial,event:name,...data};
  const line=JSON.stringify(row);state.debugLines.push(line);if(state.debugLines.length>1200)state.debugLines.splice(0,state.debugLines.length-1200);
  if(debugUi.log){debugUi.log.textContent=state.debugLines.join("\n");debugUi.log.scrollTop=debugUi.log.scrollHeight;}
  if(debugUi.summary)debugUi.summary.textContent=`L${state.loadSerial} P${state.playSerial} · ${name}`;
}
function nextPaint(){
  return new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
}
function busyMode(mode=state.uiMode){
  return ["compiling","loading","starting","stopping","rendering","exporting"].includes(mode);
}
function syncUi(){
  const mode=state.uiMode,busy=busyMode(mode),playing=mode==="playing";
  appRoot.classList.toggle("busy",busy);
  appRoot.setAttribute("aria-busy",busy?"true":"false");
  busyOverlay.setAttribute("aria-hidden",busy?"false":"true");

  ui.compile.disabled=busy||playing;
  ui.play.disabled=busy||playing||!state.runtimeReady;
  ui.stop.disabled=!playing;
  ui.load.disabled=busy||playing;
  ui.refresh.disabled=busy||playing;
  ui.exportMidi.disabled=busy||playing;
  ui.exportGarageBand.disabled=busy||playing;
  ui.render.disabled=busy||playing;
  ui.tempo.disabled=busy||playing;
  ui.sample.disabled=busy||playing;
  editor.disabled=busy||playing;
  tracksEl.querySelectorAll("button").forEach(b=>b.disabled=busy||playing);

  transportState.textContent=
    mode==="playing"?"Playing":
    mode==="compiling"?"Compiling":
    mode==="starting"?"Preparing":
    mode==="stopping"?"Stopping":
    mode==="rendering"?"Rendering":
    mode==="loading"?"Loading":
    mode==="exporting"?"Exporting":"Stopped";
}
function setUiMode(mode,message=null){
  state.uiMode=mode;
  if(message)busyText.textContent=message;
  syncUi();
}
function registerScheduledNodes(nodes){
  for(const n of nodes||[]){
    if(!n||typeof n.stop!=="function")continue;
    state.scheduled.push(n);
    const old=n.onended;
    n.onended=()=>{
      const i=state.scheduled.indexOf(n);
      if(i>=0)state.scheduled.splice(i,1);
      try{old?.();}catch{}
    };
  }
}
function registerScheduledResult(result){
  registerScheduledNodes(result?.nodes||[]);
  if(typeof result?.dispose==="function"){
    const d=result.dispose;
    state.scheduledDisposers.add(d);
    let timer=0,finished=false;
    const release=()=>{
      if(finished)return;finished=true;
      if(timer){clearTimeout(timer);state.scheduledCleanupTimers.delete(timer);timer=0;}
      state.scheduledDisposers.delete(d);
    };
    // Safety net only; normal ended notifications resolve `done` immediately.
    timer=setTimeout(()=>{
      state.scheduledCleanupTimers.delete(timer);timer=0;
      if(state.scheduledDisposers.has(d))try{d();}catch{}
      release();
    },12000);
    state.scheduledCleanupTimers.add(timer);
    if(result?.done&&typeof result.done.then==="function")result.done.then(release,release);
  }
}
function disposeScheduledResults(){
  for(const timer of state.scheduledCleanupTimers)clearTimeout(timer);
  state.scheduledCleanupTimers.clear();
  for(const d of state.scheduledDisposers){try{d();}catch{}}
  state.scheduledDisposers.clear();
}
function clearScheduler(){
  if(state.schedulerTimer){clearInterval(state.schedulerTimer);state.schedulerTimer=0;}
  state.schedulerQueues=[];
}
function disposeActiveGraph(){
  const graph=state.graph;state.graph=null;
  if(graph){
    let task;
    try{task=Promise.resolve(graph.dispose());}catch{task=Promise.resolve();}
    const prior=state.graphDisposePromise||Promise.resolve();
    state.graphDisposePromise=Promise.allSettled([prior,task]).then(()=>{});
  }
  return state.graphDisposePromise||Promise.resolve();
}
function estimateTailSeconds(ir){
  let tail=1.9;
  for(const n of ir.audioGraph?.nodes||[]){
    for(const fx of n.effects||[]){
      if(fx.name==="StereoDelay")tail=Math.max(tail,2.8);
      if(/reverb/i.test(fx.name||"")){
        const pv=fx.props?.preset?.value||fx.props?.preset?.raw||"",preset=String(pv).replace(/["']/g,"");
        const defaults={room:1.15,plate:2.15,hall:4.8,chamber:2.7,ambience:.72};
        const decay=Number(fx.props?.decay?.value)||defaults[preset]||2.2;
        tail=Math.max(tail,decay*1.6+.5);
      }
    }
  }
  return tail;
}
syncUi();

function assertAudioRuntime(){
  const missing=[];
  if(!window.SoraotoInstruments?.schedule)missing.push("SoraotoInstruments.schedule");
  if(!window.SoraotoInstruments?.scheduleDrum)missing.push("SoraotoInstruments.scheduleDrum");
  if(!window.SoraotoAudioGraph?.build)missing.push("SoraotoAudioGraph.build");
  if(!window.SoraotoPluginHost?.createInstrument)missing.push("SoraotoPluginHost.createInstrument");
  if(missing.length){
    state.runtimeReady=false;
    status.className="status error";
    status.textContent=`Audio runtime mismatch (${missing.join(", ")}) · build ${window.SORAOTO_BUILD_ID||"unknown"}`;
    ui.play.disabled=true;
    console.error("soraotoDSL audio runtime mismatch",{missing,build:window.SORAOTO_BUILD_ID});
    return false;
  }
  state.runtimeReady=true;
  console.info("soraotoDSL audio runtime ready",{build:window.SORAOTO_BUILD_ID});
  syncUi();
  return true;
}

async function fetchSongCatalog(){
  status.className="status";status.textContent="Loading song list…";
  try{
    const previous=sampleSelect.value;
    const r=await fetch(SONG_CATALOG_URL,{cache:"no-store"});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const d=await r.json();
    serverSongs=d.songs||[];
    sampleSelect.innerHTML="";
    const groups=new Map();
    for(const song of serverSongs){
      const category=song.category||"Other";
      if(!groups.has(category))groups.set(category,[]);
      groups.get(category).push(song);
    }
    for(const [category,songs] of groups){
      const g=document.createElement("optgroup");
      g.label=category;
      for(const song of songs){
        const o=document.createElement("option");
        o.value=song.id;
        o.textContent=`${song.title} · ${song.tempo||"?"} BPM`;
        g.appendChild(o);
      }
      sampleSelect.appendChild(g);
    }
    if(serverSongs.some(s=>s.id===previous))sampleSelect.value=previous;
    status.className="status ok";
    status.textContent=`Loaded ${serverSongs.length} songs · ${groups.size} categories`;
  }catch(e){
    sampleSelect.innerHTML="<option>Failed to load</option>";
    status.className="status error";
    status.textContent=`Song list load failed: ${e.message}`;
  }
}
async function releaseProjectAudioContext(){
  const ac=state.audio;debugEvent("audio.release.begin",{state:ac?.state||null,plugins:window.SoraotoPluginHost?.stats?.()||null});
  stopAudioKeepAlive();
  clearScheduler();
  for(const n of [...state.scheduled]){try{n.stop();}catch{}}
  state.scheduled.length=0;
  disposeScheduledResults();
  await disposeActiveGraph();
  state.audioBuffers.clear();
  try{state.audioResources?.pluckCache?.clear?.();}catch{}
  try{window.SoraotoInstruments?.releaseContext?.(ac);}catch{}
  state.audioResources=null;
  state.audio=null;
  if(ac&&ac.state!=="closed")try{await ac.close();}catch{}
  debugEvent("audio.release.end",{plugins:window.SoraotoPluginHost?.stats?.()||null});
}

async function loadSelectedServerSong(){
  if(state.uiMode!=="idle")return;
  const song=serverSongs.find(x=>x.id===sampleSelect.value);if(!song)return;
  state.loadSerial++;debugEvent("load.request",{song:song.id,title:song.title});
  // Flip state before awaiting teardown so repeated Load taps cannot run two
  // teardown/fetch/compile transactions concurrently.
  setUiMode("loading","Loading song…");
  status.className="status";status.textContent=`Loading ${song.title}…`;
  await releaseProjectAudioContext();
  await nextPaint();
  try{
    const u=new URL(song.file,new URL(SONG_CATALOG_URL,location.href));
    const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const source=await r.text();
    const contentType=String(r.headers?.get?.("content-type")||"").toLowerCase();
    if(contentType.includes("text/html")||/^\s*<!doctype html\b/i.test(source)||/^\s*<html\b/i.test(source)){
      throw new Error(`Song URL returned HTML instead of soraoto source: ${u.pathname}`);
    }
    editor.value=source;
    localStorage.setItem("soraotoDSL.source",editor.value);
    state.dirty=true;
    setUiMode("compiling","Compiling…");
    await nextPaint();
    const ir=compileNow();
    if(ir&&!ir.diagnostics.some(d=>d.kind==="error")){
      status.className="status ok";
      status.textContent=`Loaded · ${song.title} · ready to play`;
    }
  }catch(e){
    status.className="status error";status.textContent=`Song load failed: ${e.message}`;
  }finally{
    setUiMode("idle");
  }
}
function ensureAudio() {
  if (!state.audio || state.audio.state === "closed") {
    state.audio = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive"
    });
    state.audioResources = {
      noiseBuffer: null,
      pluckCache: new Map(),
      impulse: null,
    };
  }
  return state.audio;
}
function startAudioKeepAlive(ac){
  if(state.audioKeepAlive)return state.audioKeepAlive;
  // WebKit can suspend/starve an otherwise idle AudioContext while the app is
  // awaiting AudioWorklet/WASM/network setup. Start an inaudible oscillator
  // directly from the user's Play gesture and keep it alive until Stop/end.
  const osc=ac.createOscillator();
  const gain=ac.createGain();
  osc.frequency.value=20;
  gain.gain.value=0.0000001;
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start();
  const keep={osc,gain};
  state.audioKeepAlive=keep;
  return keep;
}
function stopAudioKeepAlive(){
  const keep=state.audioKeepAlive;
  state.audioKeepAlive=null;
  if(!keep)return;
  try{keep.osc.stop();}catch{}
  try{keep.osc.disconnect();}catch{}
  try{keep.gain.disconnect();}catch{}
}
function unlockAudioFromGesture(){
  // iOS/Safari requires AudioContext creation/resume while the Play tap is
  // still in the transient user-activation call stack. Do this before any
  // await (compile paint, fetch, AudioWorklet setup, etc.).
  const ac=ensureAudio();
  startAudioKeepAlive(ac);
  let resumePromise=Promise.resolve();
  if(ac.state==="suspended"||ac.state==="interrupted"){
    try{resumePromise=Promise.resolve(ac.resume());}
    catch(e){resumePromise=Promise.reject(e);}
  }
  return {ac,resumePromise};
}

function midiHz(n) { return 440 * Math.pow(2,(n-69)/12); }

function connectWithPan(ac, source, destination, pan = 0) {
  if (ac.createStereoPanner) {
    const panner = ac.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan || 0));
    source.connect(panner);
    panner.connect(destination);
    return panner;
  }
  source.connect(destination);
  return destination;
}

function createNoiseBuffer(ac) {
  if (state.audioResources.noiseBuffer) return state.audioResources.noiseBuffer;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * 1.0), ac.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i=0; i<data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.18 + white * 0.82;
    data[i] = last;
  }
  state.audioResources.noiseBuffer = buffer;
  return buffer;
}

function createReverbImpulse(ac) {
  if (state.audioResources.impulse) return state.audioResources.impulse;
  const duration = 1.15;
  const buffer = ac.createBuffer(2, Math.ceil(ac.sampleRate * duration), ac.sampleRate);
  for (let ch=0; ch<2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i=0; i<data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.7) * 0.55;
    }
  }
  state.audioResources.impulse = buffer;
  return buffer;
}

function createMasterBus(ac) {
  const input = ac.createGain();
  const highpass = ac.createBiquadFilter();
  const dry = ac.createGain();
  const convolver = ac.createConvolver();
  const wet = ac.createGain();
  const compressor = ac.createDynamicsCompressor();
  const output = ac.createGain();

  input.gain.value = 0.72;

  highpass.type = "highpass";
  highpass.frequency.value = 28;
  highpass.Q.value = 0.5;

  dry.gain.value = 0.93;
  convolver.buffer = createReverbImpulse(ac);
  wet.gain.value = 0.105;

  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.22;

  output.gain.value = 0.88;

  input.connect(highpass);
  highpass.connect(dry);
  highpass.connect(convolver);
  dry.connect(compressor);
  convolver.connect(wet);
  wet.connect(compressor);
  compressor.connect(output);
  output.connect(ac.destination);

  return input;
}

function schedulePiano(ac, destination, pitch, event, track, t0, noteSeconds) {
  const freq = midiHz(pitch);
  const filter = ac.createBiquadFilter();
  const env = ac.createGain();
  const fundamental = ac.createOscillator();
  const harmonic = ac.createOscillator();
  const harmonicGain = ac.createGain();

  fundamental.type = "triangle";
  fundamental.frequency.value = freq;

  harmonic.type = "sine";
  harmonic.frequency.value = freq * 2.01;
  harmonicGain.gain.value = 0.17;

  filter.type = "lowpass";
  filter.frequency.value = Math.min(9000, (2200 + freq * 5.5) * (track.brightness || 1));
  filter.Q.value = 0.55;

  const amp = Math.min(0.14, 0.082 * event.velocity * track.gain);
  const sustainAt = Math.min(t0 + noteSeconds, t0 + 0.22);
  const releaseAt = t0 + noteSeconds;
  const stopAt = releaseAt + 0.20;

  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp * 0.34), sustainAt);
  env.gain.setValueAtTime(Math.max(0.0002, amp * 0.30), releaseAt);
  env.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  fundamental.connect(filter);
  harmonic.connect(harmonicGain).connect(filter);
  filter.connect(env);
  connectWithPan(ac, env, destination, track.pan);

  fundamental.start(t0);
  harmonic.start(t0);
  fundamental.stop(stopAt);
  harmonic.stop(stopAt);
  state.scheduled.push(fundamental, harmonic);
}

function scheduleBass(ac, destination, pitch, event, track, t0, noteSeconds) {
  const freq = midiHz(pitch);
  const saw = ac.createOscillator();
  const sine = ac.createOscillator();
  const sineGain = ac.createGain();
  const filter = ac.createBiquadFilter();
  const env = ac.createGain();

  saw.type = "sawtooth";
  saw.frequency.value = freq;
  sine.type = "sine";
  sine.frequency.value = freq;
  sineGain.gain.value = 0.52;

  filter.type = "lowpass";
  filter.frequency.value = Math.min(1800, (390 + freq * 3.4) * (track.brightness || 1));
  filter.Q.value = 1.05;

  const amp = Math.min(0.18, 0.11 * event.velocity * track.gain);
  const end = t0 + noteSeconds;
  const stopAt = end + 0.08;

  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp * 0.68), Math.min(end, t0 + 0.11));
  env.gain.setValueAtTime(Math.max(0.0002, amp * 0.64), end);
  env.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  saw.connect(filter);
  sine.connect(sineGain).connect(filter);
  filter.connect(env);
  connectWithPan(ac, env, destination, track.pan);

  saw.start(t0); sine.start(t0);
  saw.stop(stopAt); sine.stop(stopAt);
  state.scheduled.push(saw, sine);
}

function scheduleSynth(ac, destination, pitch, event, track, t0, noteSeconds) {
  const freq = midiHz(pitch);
  const a = ac.createOscillator();
  const b = ac.createOscillator();
  const mixA = ac.createGain();
  const mixB = ac.createGain();
  const filter = ac.createBiquadFilter();
  const env = ac.createGain();

  a.type = "triangle";
  b.type = "sine";
  a.frequency.value = freq;
  b.frequency.value = freq;
  a.detune.value = -5;
  b.detune.value = 5;
  mixA.gain.value = 0.72;
  mixB.gain.value = 0.42;

  filter.type = "lowpass";
  filter.frequency.value = track.cutoffHz ? Math.min(18000,Math.max(40,track.cutoffHz)) : Math.min(9000, (1800 + freq * 6) * (track.brightness || 1));
  filter.Q.value = Number(track.instrumentDescriptor?.params?.resonance?.value) ? 0.5 + Number(track.instrumentDescriptor.params.resonance.value)*8 : 0.8;

  const amp = Math.min(0.135, 0.083 * event.velocity * track.gain);
  const end = t0 + noteSeconds;
  const stopAt = end + 0.12;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t0 + 0.018);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp * 0.58), Math.min(end, t0 + 0.16));
  env.gain.setValueAtTime(Math.max(0.0002, amp * 0.50), end);
  env.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  a.connect(mixA).connect(filter);
  b.connect(mixB).connect(filter);
  filter.connect(env);
  connectWithPan(ac, env, destination, track.pan);

  let lfo=null, lfoDepth=null;
  if ((track.modulation || 0) > 0.001) {
    lfo=ac.createOscillator();
    lfoDepth=ac.createGain();
    lfo.frequency.value=5.2;
    lfoDepth.gain.value=18*(track.modulation||0);
    lfo.connect(lfoDepth);
    lfoDepth.connect(a.detune);
    lfoDepth.connect(b.detune);
    lfo.start(t0);
    lfo.stop(stopAt);
  }

  a.start(t0); b.start(t0);
  a.stop(stopAt); b.stop(stopAt);
  state.scheduled.push(a, b);
  if (lfo) state.scheduled.push(lfo);
}


function interpolateControl(points, time, fallback) {
  if (!points.length) return fallback;
  if (time <= points[0].time) return points[0].value;
  for (let i=1; i<points.length; i++) {
    if (time <= points[i].time) {
      const a=points[i-1], b=points[i];
      const span=Math.max(1e-9,b.time-a.time);
      const t=(time-a.time)/span;
      return a.value+(b.value-a.value)*t;
    }
  }
  return points[points.length-1].value;
}

function automationAt(track, target, time, fallback) {
  const points=(track.controls||[])
    .filter(c=>c.type==="automation" && String(c.target).toLowerCase()===String(target).toLowerCase())
    .map(c=>({time:c.time,value:Number(c.value)}))
    .sort((a,b)=>a.time-b.time);
  return interpolateControl(points,time,fallback);
}

function ccAt(track, cc, time, fallback) {
  const points=(track.controls||[])
    .filter(c=>c.type==="cc" && Number(c.cc)===Number(cc) && c.time<=time)
    .sort((a,b)=>a.time-b.time);
  return points.length ? Number(points[points.length-1].value) : fallback;
}

function pitchBendAt(track, time) {
  const points=(track.controls||[])
    .filter(c=>c.type==="pitchBend")
    .map(c=>({time:c.time,value:Number(c.semitones)||0}))
    .sort((a,b)=>a.time-b.time);
  return interpolateControl(points,time,0);
}

function sustainValueAt(track,time) {
  let value=automationAt(track,"sustain",time,0)>=.5?127:0;
  value=ccAt(track,64,time,value);
  return value;
}

function sustainedEndBeat(track,startBeat,endBeat) {
  if (sustainValueAt(track,endBeat)<64) return endBeat;
  const releases=[];
  for (const c of track.controls||[]) {
    if (c.time<=endBeat) continue;
    if (c.type==="cc" && Number(c.cc)===64 && Number(c.value)<64) releases.push(c.time);
    if (c.type==="automation" && String(c.target).toLowerCase()==="sustain" && Number(c.value)<.5) releases.push(c.time);
  }
  return releases.length ? Math.min(...releases) : endBeat+1;
}

function expressionAt(track,time) {
  let expression=automationAt(track,"expression",time,1);
  const cc11=ccAt(track,11,time,null);
  if(cc11!=null)expression=cc11/127;
  return Math.max(0,Math.min(1,Number(expression)||0));
}

function performanceTrackAt(track,time) {
  let gain=automationAt(track,"gain",time,track.gain);
  gain=automationAt(track,"volume",time,gain);
  const cc7=ccAt(track,7,time,null);
  if (cc7!=null) gain=cc7/127;

  let expression=automationAt(track,"expression",time,1);
  const cc11=ccAt(track,11,time,null);
  if (cc11!=null) expression=cc11/127;

  let pan=automationAt(track,"pan",time,track.pan);
  const cc10=ccAt(track,10,time,null);
  if (cc10!=null) pan=(cc10-63.5)/63.5;

  let modulation=automationAt(track,"modulation",time,automationAt(track,"mod",time,0));
  const cc1=ccAt(track,1,time,null);
  if (cc1!=null) modulation=cc1/127;

  const cc74=ccAt(track,74,time,64);
  let brightness=0.45+(cc74/127)*0.95;
  let cutoffHz=Number(track.instrumentDescriptor?.params?.cutoff?.value)||null;
  for(const mod of track.modulations||[]){
    if(mod.source?.type!=="lfo")continue;
    const rate=String(mod.source.rate||"1/4");
    const rm=rate.match(/^(\d+)\/(\d+)(d?)$/);
    let period=1;if(rm){period=(4*Number(rm[1])/Number(rm[2]))*(rm[3]?1.5:1);}
    const phase=(time/Math.max(.001,period))*Math.PI*2;
    let wave=Math.sin(phase);if(mod.source.shape==="triangle")wave=2/Math.PI*Math.asin(Math.sin(phase));else if(mod.source.shape==="square")wave=Math.sin(phase)>=0?1:-1;
    const amount=Number(mod.source.amount)||0;
    if(String(mod.target).endsWith("instrument.cutoff")){if(cutoffHz)cutoffHz=Math.max(20,cutoffHz*(1+wave*amount));else brightness*=Math.max(.1,1+wave*amount);}
    if(String(mod.target).endsWith("gain"))gain*=Math.max(0,1+wave*amount);
    if(String(mod.target).endsWith("pan"))pan=Math.max(-1,Math.min(1,pan+wave*amount));
  }

  return {
    ...track,
    gain:Math.max(0,Math.min(2,Number(gain)||0))*Math.max(0,Math.min(1,Number(expression)||0)),
    pan:Math.max(-1,Math.min(1,Number(pan)||0)),
    modulation:Math.max(0,Math.min(1,Number(modulation)||0)),
    brightness,
    cutoffHz,
  };
}

function getPluckBuffer(ac, pitch) {
  pitch = Math.round(pitch);
  const key = String(pitch);
  if (state.audioResources.pluckCache.has(key)) {
    return state.audioResources.pluckCache.get(key);
  }

  const freq = midiHz(pitch);
  const duration = 1.65;
  const length = Math.ceil(ac.sampleRate * duration);
  const delay = Math.max(2, Math.round(ac.sampleRate / freq));
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i=0; i<delay && i<length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.86;
  }
  const damping = pitch < 48 ? 0.996 : pitch > 72 ? 0.987 : 0.992;
  for (let i=delay; i<length; i++) {
    const a = data[i-delay];
    const b = data[Math.max(0, i-delay-1)];
    data[i] = (a + b) * 0.5 * damping;
  }

  state.audioResources.pluckCache.set(key, buffer);
  return buffer;
}

function scheduleGuitar(ac, destination, pitch, event, track, t0, noteSeconds) {
  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const body = ac.createBiquadFilter();
  const env = ac.createGain();

  const basePitch = Math.round(pitch);
  src.buffer = getPluckBuffer(ac, basePitch);
  src.playbackRate.value = Math.pow(2, (pitch-basePitch)/12);

  filter.type = "lowpass";
  filter.frequency.value = 5200 * (track.brightness || 1);
  filter.Q.value = 0.35;

  body.type = "peaking";
  body.frequency.value = 210;
  body.Q.value = 0.9;
  body.gain.value = 2.5;

  const amp = Math.min(0.15, 0.105 * event.velocity * track.gain);
  const naturalEnd = Math.min(1.55, Math.max(0.24, noteSeconds + 0.30));
  env.gain.setValueAtTime(Math.max(0.0002, amp), t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp * 0.48), t0 + 0.09);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + naturalEnd);

  src.connect(filter).connect(body).connect(env);
  connectWithPan(ac, env, destination, track.pan);

  src.start(t0);
  src.stop(t0 + naturalEnd + 0.03);
  state.scheduled.push(src);
}

function scheduleNote(ac, destination, event, track, timeOfBeat, startAt) {
  const chordScale=1/Math.sqrt(Math.max(1,event.pitches.length));
  const perfTrack=performanceTrackAt(track,event.time);
  const bend=pitchBendAt(track,event.time);
  const nominalEndBeat=event.time+event.duration;
  const endBeat=sustainedEndBeat(track,event.time,nominalEndBeat);
  const t0=startAt+timeOfBeat(event.time);
  const noteSeconds=Math.max(.05,timeOfBeat(endBeat)-timeOfBeat(event.time));

  for(const pitch of event.pitches){
    const scaledEvent={...event,velocity:event.velocity*chordScale};
    const performedPitch=pitch+bend;
    if(!window.SoraotoInstruments?.schedule){
      throw new Error("Audio runtime mismatch: instrument-library.js is not loaded");
    }
    const r=window.SoraotoInstruments.schedule(ac,destination,performedPitch,scaledEvent,{...perfTrack,gain:expressionAt(track,event.time),pan:0},t0,noteSeconds);
    registerScheduledResult(r);
  }
}

function scheduleDrum(ac, destination, event, track, timeOfBeat, startAt) {
  const t0=startAt+timeOfBeat(event.time);
  const perfTrack=performanceTrackAt(track,event.time);
  if(!window.SoraotoInstruments?.scheduleDrum){
    throw new Error("Audio runtime mismatch: instrument-library.js drum renderer is not loaded");
  }
  const r=window.SoraotoInstruments.scheduleDrum(ac,destination,event,{...perfTrack,gain:expressionAt(track,event.time),pan:0},t0);
  registerScheduledResult(r);
  return;

  const name=String(event.drum||"").toLowerCase();
  const strength=Math.min(1,Math.max(.05,event.velocity*perfTrack.gain));

  if (name.includes("kick")) {
    const osc = ac.createOscillator();
    const click = ac.createBufferSource();
    const clickFilter = ac.createBiquadFilter();
    const g = ac.createGain();
    const clickGain = ac.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(145, t0);
    osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.095);

    g.gain.setValueAtTime(0.29 * strength, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);

    click.buffer = createNoiseBuffer(ac);
    clickFilter.type = "highpass";
    clickFilter.frequency.value = 3200;
    clickGain.gain.setValueAtTime(0.055 * strength, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018);

    osc.connect(g).connect(destination);
    click.connect(clickFilter).connect(clickGain).connect(destination);
    osc.start(t0); osc.stop(t0 + 0.23);
    click.start(t0, 0, 0.025);
    state.scheduled.push(osc, click);
    return;
  }

  if (name.includes("snare") || name.includes("clap") || name.includes("rim")) {
    const noise = ac.createBufferSource();
    const noiseFilter = ac.createBiquadFilter();
    const noiseGain = ac.createGain();
    const tone = ac.createOscillator();
    const toneGain = ac.createGain();

    noise.buffer = createNoiseBuffer(ac);
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = name.includes("rim") ? 2800 : 1800;
    noiseFilter.Q.value = name.includes("rim") ? 1.8 : 0.72;
    noiseGain.gain.setValueAtTime(0.17 * strength, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + (name.includes("rim") ? 0.055 : 0.16));

    tone.type = "triangle";
    tone.frequency.value = name.includes("rim") ? 410 : 185;
    toneGain.gain.setValueAtTime(0.055 * strength, t0);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.10);

    noise.connect(noiseFilter).connect(noiseGain).connect(destination);
    tone.connect(toneGain).connect(destination);
    noise.start(t0, 0, 0.20);
    tone.start(t0); tone.stop(t0 + 0.11);
    state.scheduled.push(noise, tone);
    return;
  }

  const noise = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const g = ac.createGain();
  noise.buffer = createNoiseBuffer(ac);

  const isCrash = name.includes("crash") || name.includes("ride");
  filter.type = "highpass";
  filter.frequency.value = isCrash ? 4200 : 7200;
  filter.Q.value = 0.55;

  const length = isCrash ? 0.52 : 0.075;
  g.gain.setValueAtTime((isCrash ? 0.10 : 0.075) * strength, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + length);

  noise.connect(filter).connect(g).connect(destination);
  noise.start(t0, 0, Math.min(0.70, length + 0.04));
  state.scheduled.push(noise);
}



let wasmNoteSerial=1;
function lfoValue(shape,phase){const s=String(shape||"sine").toLowerCase();if(s==="triangle")return 2/Math.PI*Math.asin(Math.sin(phase));if(s==="square")return Math.sin(phase)>=0?1:-1;if(s==="saw")return 2*((phase/(2*Math.PI))%1)-1;return Math.sin(phase);}
function musicalPeriodBeats(rate){const m=String(rate||"1/4").match(/^(\d+)\/(\d+)(d?)$/);if(!m)return 1;return (4*Number(m[1])/Number(m[2]))*(m[3]?1.5:1);}
function prepareWasmInstrumentTrack(node,fader,track,ir,timeOfBeat,startAt){
  // Track gain is applied by AudioGraph after inserts. This source fader remains unity.
  if(fader){
    try{fader.gain.cancelScheduledValues(startAt);fader.gain.setValueAtTime(1,startAt);}catch{fader.gain.value=1;}
  }
  for(const mod of track.modulations||[]){
    const prefix=`${track.name}.instrument.`;
    if(!String(mod.target).startsWith(prefix))continue;
    const param=String(mod.target).slice(prefix.length);
    const base=Number(track.instrumentDescriptor?.params?.[param]?.value);
    if(!Number.isFinite(base))continue;
    const period=musicalPeriodBeats(mod.source?.rate),amount=Number(mod.source?.amount)||0,step=.5;
    for(let beat=0;beat<=ir.length+1e-6;beat+=step){
      const phase=beat/Math.max(.001,period)*Math.PI*2;
      const wave=lfoValue(mod.source?.shape,phase);
      let value=base;
      if(param==="cutoff"||param==="frequency")value=Math.max(20,base*(1+wave*amount));
      else value=base+wave*amount;
      node.setNamedParameter?.(param,value,startAt+timeOfBeat(beat));
    }
  }
}
function scheduleWasmNoteEvent(node,track,ev,timeOfBeat,startAt){
  if(ev.type!=="note")return;
  const bend=pitchBendAt(track,ev.time);
  const t0=startAt+timeOfBeat(ev.time);
  const endBeat=sustainedEndBeat(track,ev.time,ev.time+ev.duration);
  const t1=startAt+timeOfBeat(endBeat);
  const scale=1/Math.sqrt(Math.max(1,ev.pitches.length));
  for(const pitch of ev.pitches||[]){
    const id=wasmNoteSerial++;
    node.noteOn(id,pitch+bend,Math.max(.001,ev.velocity*scale),t0);
    for(const x of ev.noteExpressions||[]){
      const at=startAt+timeOfBeat(ev.time+Math.max(0,Number(x.offset)||0));
      if(at<=t1+0.001)node.noteExpression?.(id,Number(x.id),Number(x.value),at);
    }
    node.noteOff(id,0,t1);
  }
}
function prepareWasmDrumTrack(node,fader,track,startAt,timeOfBeat=null){
  if(!node)return;
  // Track gain is applied by AudioGraph after inserts. This source fader remains unity.
  if(fader){
    try{fader.gain.cancelScheduledValues(startAt);fader.gain.setValueAtTime(1,startAt);}catch{fader.gain.value=1;}
  }
}
function scheduleWasmDrumEvent(node,track,ev,timeOfBeat,startAt){
  if(ev.type!=="drum"||!node)return;
  const pitch=window.SoraotoInstruments?.drumPitchFor?.(ev);
  if(!Number.isFinite(Number(pitch)))return;
  const t0=startAt+timeOfBeat(ev.time),id=wasmNoteSerial++;
  node.noteOn(id,Number(pitch),Math.max(.001,Math.min(1,Number(ev.velocity)||.7)),t0);
  node.noteOff(id,0,t0+.06);
}
function scheduleWasmInstrumentTrack(node,fader,track,ir,timeOfBeat,startAt){
  // Used by offline rendering, where scheduling the whole timeline is desired.
  prepareWasmInstrumentTrack(node,fader,track,ir,timeOfBeat,startAt);
  for(const ev of track.events||[])scheduleWasmNoteEvent(node,track,ev,timeOfBeat,startAt);
}

function activeTrack(track){if(state.solo.size)return state.solo.has(track.name);return !state.muted.has(track.name);}
function toggleSet(set,key){set.has(key)?set.delete(key):set.add(key);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

async function stopPlayback(updateStatus=true){
  // Teardown is a transport transaction. Do not expose idle/Play until every
  // Plugin Worklet has acknowledged disposal (or its bounded timeout elapsed).
  if(state.uiMode!=="stopping")setUiMode("stopping","Stopping audio…");
  cancelAnimationFrame(state.raf);state.raf=0;
  clearScheduler();
  for(const n of [...state.scheduled]){try{n.stop();}catch{}}
  state.scheduled.length=0;
  disposeScheduledResults();
  stopAudioKeepAlive();
  await disposeActiveGraph();
  state.playDuration=0;state.songDuration=0;
  state.meterHold.clear();
  updateMeters(true);
  setUiMode("idle");
  if(updateStatus){status.className="status ok";status.textContent="Stopped";}
  drawTimeline();
}

async function loadAudioBuffer(ac,url){
  if(state.audioBuffers.has(url))return state.audioBuffers.get(url);
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok)throw new Error(`audio ${url}: HTTP ${r.status}`);
  const buf=await ac.decodeAudioData(await r.arrayBuffer());
  state.audioBuffers.set(url,buf);
  return buf;
}
async function preloadAudioClips(ac,ir){
  const clips=(ir.audioClips||[]).filter(c=>c.file);
  await Promise.all([...new Set(clips.map(c=>c.file))].map(url=>loadAudioBuffer(ac,url)));
}
function scheduleAudioClips(ac,graph,ir,startAt,timeOfBeat){
  for(const clip of ir.audioClips||[]){
    if(!clip.file)continue;
    const buffer=state.audioBuffers.get(clip.file);
    if(!buffer)continue;
    const src=ac.createBufferSource(),g=ac.createGain();
    src.buffer=buffer;
    const t=startAt+timeOfBeat(clip.at||0);
    const offset=clip.source?.start||0;
    const duration=clip.source?.end?Math.max(0,clip.source.end-offset):undefined;
    const clipGain=clip.gain??1;
    const dest=graph.trackInput(clip.track);
    src.connect(g);g.connect(dest);
    g.gain.setValueAtTime(Math.max(.0001,clipGain),t);
    if(clip.fadeIn){
      g.gain.setValueAtTime(.0001,t);
      g.gain.exponentialRampToValueAtTime(Math.max(.0001,clipGain),t+clip.fadeIn);
    }
    if(duration&&clip.fadeOut){
      g.gain.setValueAtTime(Math.max(.0001,clipGain),t+Math.max(0,duration-clip.fadeOut));
      g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    }
    src.start(t,offset,duration);
    registerScheduledNodes([src]);
  }
}

function buildRealtimeQueues(ac,graph,ir,startAt,timeOfBeat){
  const queues=[];
  for(const track of ir.tracks||[]){
    if(!activeTrack(track))continue;
    const events=[...(track.events||[])].sort((a,b)=>a.time-b.time);
    const inst=graph.trackInstrument?.(track.name),drumInst=graph.trackDrumInstrument?.(track.name);
    if(inst)prepareWasmInstrumentTrack(inst,graph.trackInstrumentFader?.(track.name),track,ir,timeOfBeat,startAt);
    if(drumInst)prepareWasmDrumTrack(drumInst,graph.trackDrumFader?.(track.name),track,startAt,timeOfBeat);
    queues.push({track,events,index:0,inst,drumInst,dest:graph.trackInput(track.name)});
  }
  return queues;
}
function pumpRealtimeScheduler(ac,ir,startAt,timeOfBeat){
  const horizon=ac.currentTime+0.85;
  for(const q of state.schedulerQueues){
    while(q.index<q.events.length){
      const ev=q.events[q.index];
      const at=startAt+timeOfBeat(ev.time||0);
      if(at>horizon)break;
      q.index++;
      if(ev.type==="note"&&q.inst)scheduleWasmNoteEvent(q.inst,q.track,ev,timeOfBeat,startAt);
      else if(ev.type==="drum"&&q.drumInst)scheduleWasmDrumEvent(q.drumInst,q.track,ev,timeOfBeat,startAt);
      else if(ev.type==="drum")scheduleDrum(ac,q.dest,ev,q.track,timeOfBeat,startAt);
      else if(ev.type==="note")scheduleNote(ac,q.dest,ev,q.track,timeOfBeat,startAt);
    }
  }
}

async function play(){
  if(state.uiMode!=="idle")return;
  state.playSerial++;debugEvent("play.request",{build:window.SORAOTO_BUILD_ID||null});
  if(!assertAudioRuntime())return;

  // Must happen synchronously from the Play click on iOS.
  const unlocked=unlockAudioFromGesture();

  setUiMode("compiling","Compiling before playback…");
  status.className="status";status.textContent="Compiling…";
  await nextPaint();

  let ir;
  try{ir=compileNow();}
  catch(e){
    status.className="status error";status.textContent=`Compile failed: ${e.message}`;
    stopAudioKeepAlive();
    setUiMode("idle");return;
  }
  if(!ir||ir.diagnostics.some(d=>d.kind==="error")){stopAudioKeepAlive();setUiMode("idle");return;}

  setUiMode("starting","Preparing audio graph…");
  status.className="status";status.textContent="Preparing audio…";
  await nextPaint();

  const ac=unlocked.ac;
  try{
    await unlocked.resumePromise;
    if(ac.state==="suspended"||ac.state==="interrupted")await ac.resume();
  }catch(e){
    status.className="status error";
    status.textContent=`Audio start was blocked: ${e.message||e}`;
    stopAudioKeepAlive();
    setUiMode("idle");
    return;
  }

  try{
    // A previous transport may still be completing asynchronous Worklet
    // disposal. Serialize generations before constructing any new graph.
    await (state.graphDisposePromise||Promise.resolve());
    // Audio files are loaded before the transport clock is chosen, so a slow
    // network cannot push scheduled clip starts into the past.
    await preloadAudioClips(ac,ir);
    state.graph=await SoraotoAudioGraph.build(ac,ir);
  }catch(e){
    status.className="status error";status.textContent=`Audio preparation failed: ${e.message}`;
    disposeActiveGraph();
    stopAudioKeepAlive();
    setUiMode("idle");return;
  }

  // Worklet construction is asynchronous. Verify WebKit did not suspend the
  // context while the graph was being built.
  if(ac.state!=="running"){
    try{await ac.resume();}catch{}
  }
  if(ac.state!=="running"){
    disposeActiveGraph();
    stopAudioKeepAlive();
    status.className="status error";
    status.textContent=`AudioContext is ${ac.state} after graph creation`;
    setUiMode("idle");
    return;
  }
  status.className="status";
  status.textContent="Audio graph ready · resetting plugins…";

  try{
    // A graph can spend a measurable amount of time alive while Worklets/WASM
    // are constructed. Reset every Plugin at the actual playback boundary so
    // LFO/delay/reverb/voice state cannot depend on page or graph age.
    await state.graph.resetPlugins?.();
  }catch(e){
    disposeActiveGraph();
    stopAudioKeepAlive();
    status.className="status error";
    status.textContent=`Plugin reset failed: ${e.message||e}`;
    setUiMode("idle");
    return;
  }

  // Reset acknowledgement itself can take one or more render quanta, so choose
  // the transport origin only after every Plugin has confirmed reset.
  const timeOfBeat=b=>SoraotoAudioGraph.beatToSeconds(ir,b);
  const mobileWebKit=/iP(?:hone|ad|od)/.test(navigator.userAgent)&&/WebKit/.test(navigator.userAgent);
  const leadIn=mobileWebKit ? 0.32 : 0.18;
  const startAt=ac.currentTime+leadIn;
  debugEvent("audio.context",{state:ac.state,currentTime:+ac.currentTime.toFixed(6),sampleRate:ac.sampleRate,startAt:+startAt.toFixed(6),plugins:window.SoraotoPluginHost?.stats?.()||null});
  status.textContent="Audio graph ready · scheduling…";

  try{
    state.graph.setTransportOrigin?.(startAt);
    state.graph.setDebugTrace?.(!!debugUi.audioTrace?.checked,d=>debugEvent("plugin.audio",d),startAt,4);
    state.graph.prepareTimelineAutomation?.(startAt,timeOfBeat);
    state.schedulerQueues=buildRealtimeQueues(ac,state.graph,ir,startAt,timeOfBeat);
    scheduleAudioClips(ac,state.graph,ir,startAt,timeOfBeat);
    pumpRealtimeScheduler(ac,ir,startAt,timeOfBeat);
    state.schedulerTimer=setInterval(()=>pumpRealtimeScheduler(ac,ir,startAt,timeOfBeat),50);
  }catch(e){
    clearScheduler();
    disposeActiveGraph();
    status.className="status error";status.textContent=`Playback scheduling failed: ${e.message}`;
    stopAudioKeepAlive();
    setUiMode("idle");return;
  }

  state.playStart=performance.now()/1000+(startAt-ac.currentTime);
  state.songDuration=timeOfBeat(ir.length);
  state.playDuration=state.songDuration+estimateTailSeconds(ir);
  state.meterHold.clear();
  state.lastUiPaint=0;state.lastMeterPaint=0;
  setUiMode("playing");
  status.className="status ok";status.textContent=`Playing · ${ir.title||"soraotoDSL"}`;

  const tick=(rafNow=performance.now())=>{
    // UI work is intentionally much slower than the audio scheduler.
    // On iPhone this avoids canvas/analyser work competing with Web Audio.
    if(rafNow-state.lastUiPaint>=66){
      drawTimeline();
      state.lastUiPaint=rafNow;
    }
    if(rafNow-state.lastMeterPaint>=100){
      updateMeters();
      state.lastMeterPaint=rafNow;
    }
    const elapsed=performance.now()/1000-state.playStart;
    if(elapsed<=state.playDuration){
      if(elapsed>state.songDuration&&elapsed<state.playDuration-.2){
        transportState.textContent="Tail";
      }
      state.raf=requestAnimationFrame(tick);
    }else{
      // Use the same serialized teardown path as an explicit Stop. Keep the UI
      // non-idle until the old Worklets are gone, then publish completion.
      stopPlayback(false).then(()=>{
        status.className="status ok";status.textContent="Playback finished";
      }).catch(e=>{
        status.className="status error";status.textContent=`Playback teardown failed: ${e.message||e}`;
      });
    }
  };
  tick();
}

function compileNow(){
  localStorage.setItem("soraotoDSL.source",editor.value);
  const ir=SoraotoCompiler.compile(editor.value);
  state.ir=ir;state.dirty=false;
  state.compileValid=!(ir.diagnostics||[]).some(d=>d.kind==="error");
  el("tempoInput").value=String(Math.round(ir.tempo||120));
  renderDiagnostics(ir.diagnostics||[]);
  renderTracks(ir.tracks||[]);
  drawTimeline();
  const ec=(ir.diagnostics||[]).filter(d=>d.kind==="error").length;
  const wc=(ir.diagnostics||[]).filter(d=>d.kind==="warning").length;
  const graphNodes=ir.audioGraph?.nodes?.length||0;
  status.className="status "+(ec?"error":"ok");
  status.textContent=ec
    ?`${ec} error(s), ${wc} warning(s)`
    :`Compiled v${SoraotoCompiler.version}: ${ir.events?.length||0} events · ${ir.tracks?.length||0} tracks · ${ir.harmonies?.length||0} harmony · ${ir.structure?.length||0} sections · ${graphNodes} graph nodes${wc?` · ${wc} warnings`:""}`;
  syncUi();
  return ir;
}

async function compileUi(){
  if(state.uiMode!=="idle")return state.ir;
  setUiMode("compiling","Compiling…");
  status.className="status";status.textContent="Compiling…";
  await nextPaint();
  try{return compileNow();}
  catch(e){
    state.compileValid=false;
    status.className="status error";status.textContent=`Compile failed: ${e.message}`;
    return null;
  }finally{setUiMode("idle");}
}

function renderDiagnostics(ds){errors.textContent=ds.map(d=>`${String(d.kind||"info").toUpperCase()}: ${d.message}`).join("\n");}
function meterElement(id){
  const m=document.createElement("div");
  m.className="meter";
  m.dataset.meterId=id;
  m.innerHTML='<div class="meter-rail"><div class="meter-fill"></div><div class="meter-peak"></div><span class="clip-badge">CLIP</span></div><span class="meter-readout">−∞</span>';
  return m;
}
function dbToMeterPercent(db){
  // Meter window: -60 dB .. 0 dB
  return Math.max(0,Math.min(100,(db+60)/60*100));
}
function updateMeters(clear=false){
  const values=(!clear&&state.graph?.readMeters)?state.graph.readMeters():{};
  const now=performance.now();
  document.querySelectorAll(".meter[data-meter-id]").forEach(m=>{
    const id=m.dataset.meterId,v=values[id]||{db:-96,peak:0};
    const fill=m.querySelector(".meter-fill"),peakEl=m.querySelector(".meter-peak"),read=m.querySelector(".meter-readout");
    const pct=dbToMeterPercent(v.db);
    const peakDb=v.peak>1e-7?20*Math.log10(v.peak):-96;
    fill.style.width=`${pct.toFixed(1)}%`;
    peakEl.style.left=`${dbToMeterPercent(peakDb).toFixed(1)}%`;
    read.textContent=v.db<=-60?"−∞":`${v.db.toFixed(0)}`;
    const old=state.meterHold.get(id)||0;
    if(v.peak>=.985){if(old<=now)debugEvent("meter.CLIP",{id,peak:v.peak,db:v.db});state.meterHold.set(id,now+1800);}
    const clipped=(state.meterHold.get(id)||0)>now;
    m.classList.toggle("clip",clipped);
    if(clear){state.meterHold.delete(id);m.classList.remove("clip");}
  });
}
function renderTracks(tracks){
  tracksEl.innerHTML="";

  for(const sec of state.ir?.structure||[]){
    const row=document.createElement("div");row.className="track";
    row.innerHTML=`<div><strong>§ ${escapeHtml(sec.name)}</strong><br><small>Section · ${sec.bars} bars</small></div><span class="chip">${sec.startBeat.toFixed(1)}–${sec.endBeat.toFixed(1)}</span><span></span><span></span><span></span>`;
    tracksEl.appendChild(row);
  }
  for(const h of state.ir?.harmonies||[]){
    const row=document.createElement("div");row.className="track";
    row.innerHTML=`<div><strong>◇ ${escapeHtml(h.name)}</strong><br><small>Harmony · ${h.events.length} chords</small></div><span class="chip">${h.length.toFixed(1)} beats</span><span></span><span></span><span></span>`;
    tracksEl.appendChild(row);
  }

  for(const t of tracks){
    const row=document.createElement("div");row.className="track";
    const info=document.createElement("div");
    const preset=window.SoraotoInstruments?.presetFor?.(t);
    info.innerHTML=`<strong>${escapeHtml(t.name)}</strong><br><small>${escapeHtml(t.instrument)}${preset?` / ${escapeHtml(preset)}`:""} · ${t.events?.length||0} events${t.dependency?` · ↳ ${escapeHtml(t.dependency)}`:""}${t.effects?.length?` · ${t.effects.length} fx`:""}</small>`;
    const chip=document.createElement("span");chip.className="chip";chip.textContent=`${(t.length||0).toFixed(1)} beats`;
    const meter=meterElement(t.name);
    const m=document.createElement("button");m.textContent="M";m.className="toggle"+(state.muted.has(t.name)?" active":"");
    m.disabled=state.uiMode!=="idle";
    m.onclick=()=>{if(state.uiMode!=="idle")return;toggleSet(state.muted,t.name);renderTracks(state.ir.tracks);syncUi();};
    const so=document.createElement("button");so.textContent="S";so.className="toggle"+(state.solo.has(t.name)?" active":"");
    so.disabled=state.uiMode!=="idle";
    so.onclick=()=>{if(state.uiMode!=="idle")return;toggleSet(state.solo,t.name);renderTracks(state.ir.tracks);syncUi();};
    row.append(info,chip,meter,m,so);tracksEl.appendChild(row);
  }

  for(const node of state.ir?.audioGraph?.nodes||[]){
    if(node.kind!=="bus")continue;
    const row=document.createElement("div");row.className="track";
    row.innerHTML=`<div><strong>↯ ${escapeHtml(node.id)}</strong><br><small>Bus · ${(node.effects||[]).map(x=>x.name).join(" → ")||"no fx"}</small></div>`;
    const chip=document.createElement("span");chip.className="chip";chip.textContent="BUS";
    row.append(chip,meterElement(node.id),document.createElement("span"),document.createElement("span"));
    tracksEl.appendChild(row);
  }

  if(state.ir?.audioGraph){
    const row=document.createElement("div");row.className="track";
    row.innerHTML=`<div><strong>MASTER</strong><br><small>${state.ir.audioGraph.nodes.length} nodes · ${state.ir.audioGraph.edges.length} edges · ${state.ir.audioGraph.sidechains.length} sidechains</small></div>`;
    const chip=document.createElement("span");chip.className="chip";chip.textContent="OUT";
    row.append(chip,meterElement("Master"),document.createElement("span"),document.createElement("span"));
    tracksEl.appendChild(row);
  }
  syncUi();
}

function resizeCanvas(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1,w=Math.max(1,Math.floor(r.width*d)),h=Math.max(1,Math.floor(r.height*d));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx2d.setTransform(d,0,0,d,0,0);}
function drawTimeline(){resizeCanvas();const w=canvas.clientWidth,h=canvas.clientHeight;ctx2d.clearRect(0,0,w,h);ctx2d.fillStyle="#090d13";ctx2d.fillRect(0,0,w,h);const ir=state.ir;if(!ir)return;const tracks=ir.tracks||[],harm=ir.harmonies||[];const lanes=tracks.length+harm.length;if(!lanes)return;const compact=w<520,left=compact?56:92,top=compact?10:14,right=compact?6:10,bottom=compact?20:24,pw=w-left-right,ph=h-top-bottom,maxBeat=Math.max(4,Math.ceil(ir.length||4)),lh=ph/lanes,meter=ir.meter||[4,4],bar=meter[0]*(4/meter[1]);ctx2d.font=`${compact?9:11}px ui-monospace,monospace`;for(let b=0;b<=maxBeat;b++){const x=left+b/maxBeat*pw,isBar=Math.abs(b/bar-Math.round(b/bar))<1e-6;ctx2d.strokeStyle=isBar?"#3b4c6c":"#20293c";ctx2d.beginPath();ctx2d.moveTo(x,top);ctx2d.lineTo(x,top+ph);ctx2d.stroke();if(isBar&&b<maxBeat){ctx2d.fillStyle="#7787a5";ctx2d.fillText(`B${Math.floor(b/bar)+1}`,x+3,h-7);}}let lane=0;for(const hh of harm){const y=top+lane++*lh;ctx2d.fillStyle="#d0b5ff";ctx2d.fillText(("◇"+hh.name).slice(0,compact?8:14),5,y+(compact?11:15));for(const c of hh.events){const x=left+c.time/maxBeat*pw,ew=Math.max(2,c.duration/maxBeat*pw);ctx2d.fillStyle="#5a3f78";ctx2d.fillRect(x,y+lh*.2,ew,lh*.6);ctx2d.fillStyle="#eadcff";if(ew>25)ctx2d.fillText(c.symbol,x+3,y+lh*.62);}}for(const t of tracks){const y=top+lane++*lh;ctx2d.fillStyle=activeTrack(t)?"#c7d5eb":"#596477";ctx2d.fillText(((t.dependency?"↳":"")+t.name).slice(0,compact?8:14),5,y+(compact?11:15));const notes=(t.events||[]).filter(e=>e.type==="note"),ps=notes.flatMap(e=>e.pitches||[]),mn=ps.length?Math.min(...ps):36,mx=ps.length?Math.max(...ps):84;for(const e of t.events||[]){const x=left+e.time/maxBeat*pw,ew=Math.max(2,(e.duration||.1)/maxBeat*pw);if(e.type==="drum"){ctx2d.fillStyle="#d9a657";ctx2d.fillRect(x,y+lh*.28,Math.max(3,ew*.4),lh*.44);}else for(const p of e.pitches||[]){const yy=y+lh*.78-((p-mn)/Math.max(1,mx-mn))*lh*.56;ctx2d.fillStyle=t.dependency?"#7bd9ac":"#65bde9";ctx2d.fillRect(x,yy,ew,Math.max(3,Math.min(6,lh*.12)));}}}if(state.raf&&state.songDuration>0){const elapsed=performance.now()/1000-state.playStart,f=Math.max(0,Math.min(1,elapsed/state.songDuration)),x=left+f*pw*(ir.length/maxBeat);ctx2d.strokeStyle="#ffef8a";ctx2d.lineWidth=2;ctx2d.beginPath();ctx2d.moveTo(x,top);ctx2d.lineTo(x,top+ph);ctx2d.stroke();ctx2d.lineWidth=1;}}
function currentProjectTitle(){return state.ir?.title||"soraotoDSL";}
async function exportCurrentMidi(garageBand=false){
  if(state.uiMode!=="idle")return;
  setUiMode("exporting",garageBand?"Preparing GarageBand MIDI…":"Preparing MIDI…");
  await nextPaint();
  try{
    const ir=compileNow();
    if(!ir||ir.diagnostics.some(d=>d.kind==="error"))return;
    const r=SoraotoMidi.exportMidi(ir,{title:currentProjectTitle(),garageBand});
    status.className="status ok";status.textContent=`Exported ${r.filename}`;
  }catch(e){
    status.className="status error";status.textContent=`Export failed: ${e.message}`;
  }finally{setUiMode("idle");}
}

function renderSettings(ir){
  const r=(ir.renders||[]).find(x=>String(x.props?.format?.value||x.props?.format?.raw||'').toLowerCase()==='wav') || ir.renders?.[0] || null;
  const sr=Math.max(8000,Math.min(192000,Number(r?.props?.sample_rate?.value)||48000));
  const bd=Number(r?.props?.bit_depth?.value)||24;
  const normalize=Boolean(r?.props?.normalize?.value||false);
  return {name:r?.name||'Main',sampleRate:sr,bitDepth:bd===16?16:24,normalize};
}
async function renderCurrentWav(){
  if(state.uiMode!=="idle")return;
  setUiMode("rendering","Compiling for WAV render…");
  await nextPaint();

  let ir;
  try{ir=compileNow();}
  catch(e){
    status.className="status error";status.textContent=`Compile failed: ${e.message}`;
    setUiMode("idle");return;
  }
  if(!ir||ir.diagnostics.some(d=>d.kind==="error")){setUiMode("idle");return;}
  if(typeof OfflineAudioContext==="undefined"){
    status.className="status error";status.textContent="OfflineAudioContext is not available in this browser";
    setUiMode("idle");return;
  }

  const cfg=renderSettings(ir),timeOfBeat=b=>SoraotoAudioGraph.beatToSeconds(ir,b);
  const duration=Math.min(600,Math.max(.5,timeOfBeat(ir.length)+estimateTailSeconds(ir)));
  busyText.textContent=`Rendering ${cfg.sampleRate} Hz / ${cfg.bitDepth}-bit WAV…`;
  status.className="status";status.textContent=`Rendering ${cfg.sampleRate} Hz / ${cfg.bitDepth}-bit WAV…`;
  const previousScheduled=state.scheduled;state.scheduled=[];

  try{
    const off=new OfflineAudioContext(2,Math.ceil(cfg.sampleRate*duration),cfg.sampleRate);
    await preloadAudioClips(off,ir);
    const graph=await SoraotoAudioGraph.build(off,ir);
    const startAt=.02;
    graph.setTransportOrigin?.(startAt);
    graph.prepareTimelineAutomation?.(startAt,timeOfBeat);
    for(const track of ir.tracks||[]){
      if(!activeTrack(track))continue;
      const inst=graph.trackInstrument?.(track.name),drumInst=graph.trackDrumInstrument?.(track.name);
      const dest=graph.trackInput(track.name);
      if(inst)prepareWasmInstrumentTrack(inst,graph.trackInstrumentFader?.(track.name),track,ir,timeOfBeat,startAt);
      if(drumInst)prepareWasmDrumTrack(drumInst,graph.trackDrumFader?.(track.name),track,startAt,timeOfBeat);
      for(const ev of track.events||[]){
        if(ev.type==="note"&&inst)scheduleWasmNoteEvent(inst,track,ev,timeOfBeat,startAt);
        else if(ev.type==="drum"&&drumInst)scheduleWasmDrumEvent(drumInst,track,ev,timeOfBeat,startAt);
        else if(ev.type==="drum")scheduleDrum(off,dest,ev,track,timeOfBeat,startAt);
        else if(ev.type==="note")scheduleNote(off,dest,ev,track,timeOfBeat,startAt);
      }
    }
    scheduleAudioClips(off,graph,ir,startAt,timeOfBeat);
    const rendered=await off.startRendering();
    const bytes=SoraotoWav.encode(rendered,cfg.bitDepth,cfg.normalize);
    const safe=currentProjectTitle().replace(/[\\/:*?"<>|]+/g,"-").replace(/\s+/g,"-");
    const filename=`${safe}-${cfg.name}.wav`;
    SoraotoWav.download(bytes,filename);
    status.className="status ok";
    status.textContent=`Rendered ${filename} · ${(bytes.byteLength/1024/1024).toFixed(1)} MB`;
    try{await graph.dispose();}catch{}
  }catch(e){
    status.className="status error";status.textContent=`Render failed: ${e.message}`;
    console.error(e);
  }finally{
    state.scheduled=previousScheduled;
    setUiMode("idle");
  }
}

ui.compile.onclick=()=>compileUi();
ui.play.onclick=()=>play();
ui.stop.onclick=()=>{if(state.uiMode==="playing")stopPlayback().catch(e=>{status.className="status error";status.textContent=`Stop failed: ${e.message||e}`;setUiMode("idle");});};
ui.load.onclick=loadSelectedServerSong;
window.addEventListener("pagehide",()=>{stopPlayback(false).catch(()=>{}).finally(()=>releaseProjectAudioContext().catch(()=>{}));},{once:true});
ui.refresh.onclick=fetchSongCatalog;
ui.exportMidi.onclick=()=>exportCurrentMidi(false);
ui.exportGarageBand.onclick=()=>exportCurrentMidi(true);
ui.render.onclick=()=>renderCurrentWav();

if(debugUi.toggle)debugUi.toggle.onclick=()=>{debugUi.panel.hidden=!debugUi.panel.hidden;debugEvent("debug.panel",{open:!debugUi.panel.hidden});};
if(debugUi.clear)debugUi.clear.onclick=()=>{state.debugLines=[];if(debugUi.log)debugUi.log.textContent="";if(debugUi.summary)debugUi.summary.textContent="cleared";};
if(debugUi.copy)debugUi.copy.onclick=async()=>{try{await navigator.clipboard.writeText(state.debugLines.join("\n"));debugEvent("debug.copy",{lines:state.debugLines.length});}catch(e){debugEvent("debug.copy.error",{message:String(e?.message||e)});}};
if(debugUi.audioTrace)debugUi.audioTrace.onchange=()=>debugEvent("debug.audioTrace",{enabled:debugUi.audioTrace.checked});

for(const b of mobileViewButtons){
  b.addEventListener("click",()=>setMobileView(b.dataset.mobileView));
}
setMobileView("mixer");

window.addEventListener("resize",drawTimeline);

editor.addEventListener("input",()=>{
  state.dirty=true;state.compileValid=false;
  if(state.uiMode==="idle"){
    status.className="status";
    status.textContent="Edited · Compile or Play to apply changes";
  }
});
editor.addEventListener("keydown",e=>{
  if(e.key==="Tab"&&!editor.disabled){
    e.preventDefault();
    const a=editor.selectionStart,b=editor.selectionEnd;
    editor.setRangeText("  ",a,b,"end");
    state.dirty=true;
  }
  if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){
    e.preventDefault();
    if(state.uiMode==="idle")play();
  }
});

assertAudioRuntime();
compileUi();
fetchSongCatalog();
})();
