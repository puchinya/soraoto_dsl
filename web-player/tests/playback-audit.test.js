const fs=require("fs");
const path=require("path");
const R=path.resolve(__dirname,"..");

const app=fs.readFileSync(path.join(R,"src/js/app.js"),"utf8");
const graph=fs.readFileSync(path.join(R,"src/js/audio-graph.js"),"utf8");
const registry=fs.readFileSync(path.join(R,"src/js/plugin-registry.js"),"utf8");
const worklet=fs.readFileSync(path.join(R,"src/worklets/soraoto-plugin-processor.js"),"utf8");

function check(cond,msg){if(!cond)throw new Error(msg);}

check(app.includes("SoraotoInstruments.schedule("),"realtime note path is not using instrument-library");
check(app.includes("SoraotoInstruments.scheduleDrum("),"realtime drum path is not using instrument-library");
check(app.includes("instrument-library.js is not loaded"),"realtime note path may silently bypass instrument-library");
check(app.includes("instrument-library.js drum renderer is not loaded"),"realtime drum path may silently bypass instrument-library");
check(app.includes("const horizon=ac.currentTime+0.85"),"mobile look-ahead horizon missing");
check(app.includes("setInterval(()=>pumpRealtimeScheduler"),"incremental realtime scheduler missing");
check(app.includes("await preloadAudioClips(ac,ir)"),"audio clips are not preloaded before transport start");
check(app.includes("estimateTailSeconds(ir)"),"effect-tail transport missing");
check(app.includes("updateMeters()"),"meter UI update missing");

check(graph.includes("readMeters()"),"audio graph meter API missing");
check(graph.includes("createMeterNode(ctx)"),"analyser meter missing");
check(registry.includes('module:"wasm/plugins/effects/master-limiter/plugin.wasm"'),"true-peak master limiter plugin missing");
check(graph.includes("glue.ratio.value=1.5"),"gentle master glue missing");
check(!graph.includes("*.50"),"legacy fixed 0.50 master attenuation remains");
check(graph.includes("integratedLufs"),"loudness meter missing");
check(registry.includes('module:"wasm/plugins/effects/reverb/plugin.wasm"'),"Reverb plugin path missing");
check(graph.includes('["stereo","automation","modulation"]'),"structural effect filtering missing");
check(!graph.includes("input.connect(output);return {input,output};"),"unknown effect self-feedback regression");
check(graph.includes('desc.kind==="bus"?(Number.isFinite(Number(desc.gain))'),"bus gain is not applied");
check(graph.includes('superSynthPresetFor?.(sourceTrack)'),"standard pitched tracks are not resolved to SuperSynth");
check(app.includes('if(ev.type==="note"&&q.inst)'),"realtime mixed note/drum WASM routing guard missing");
check(app.includes('ev.type==="drum"&&q.drumInst'),"realtime Drum Plugin routing missing");
check(graph.includes('trackDrumInstrument:'),"audio graph Drum Plugin accessor missing");
check(app.includes('if(ev.type==="note"&&inst)'),"offline mixed note/drum WASM routing guard missing");
check(app.includes('ev.type==="drum"&&drumInst'),"offline Drum Plugin routing missing");

check(worklet.includes("this.queueDirty"),"Plugin queue dirty flag missing");
check(worklet.includes("this.queueHead=0"),"Plugin head-index queue missing");
check(worklet.includes("if(this.queueDirty){"),"Plugin queue dirty guard missing");
check(!worklet.includes("this.queue.shift()"),"Plugin realtime queue still uses O(n) shift");

console.log("PASS playback audit",{
  instrumentLibrary:true,
  standardInstrumentsOnSuperSynth:true,
  drumsOnPlugin:true,
  reverbPlugin:true,
  truePeakLimiter:true,
  meters:true,
  lookAheadSeconds:.85,
  audioPreload:true,
  effectTail:true,
  zeroDelayFeedbackFixed:true,
  wasmQueueOptimized:true,
});
