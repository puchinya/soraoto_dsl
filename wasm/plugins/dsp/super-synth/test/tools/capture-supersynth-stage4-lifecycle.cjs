#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {PluginHarness}=require('../../../../../test/helpers/plugin-harness.cjs');
const {analyzeStereo}=require('./salamander-metrics.cjs');
const {estimatePianoPitch,getPianoPitchAnalysisPlan}=require('./piano-pitch-estimator.cjs');
const {VELOCITIES,SAMPLE_RATE}=require('./capture-supersynth-matrix.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const WASM_RELATIVE='plugins/dsp/super-synth/plugin.wasm';
const PITCHES=Array.from({length:88},(_,i)=>i+21);
const HOLD_MS=1600,RELEASE_LIMIT_MS=1000,BLOCK=2048;
const REPEAT_PITCHES=[21,60,83,87,108],REPEAT_VELOCITIES=[14,61,124];
const REPEAT_CELLS=REPEAT_PITCHES.flatMap(pitch=>REPEAT_VELOCITIES.map(velocity=>({pitch,velocity,kind:'repeat'})));
const LIFECYCLE_CELLS=PITCHES.flatMap(pitch=>VELOCITIES.map(velocity=>({pitch,velocity,kind:'lifecycle'})));

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function key(cell){return `${cell.kind}:${cell.pitch}:${cell.velocity}`;}
function assertExactCells(cells,expected=LIFECYCLE_CELLS){
  const actual=cells.map(key),wanted=expected.map(key);
  if(actual.length!==wanted.length||new Set(actual).size!==wanted.length||wanted.some(id=>!actual.includes(id)))
    throw new Error('BLOCKED_STAGE4_CAPTURE_COVERAGE: cells are not the exact authorized set');
  return cells;
}
function toDbfs(value){return value>0?20*Math.log10(value):-240;}
function updateFiniteAndPeak(output,state){
  const left=output?.[0],right=output?.[1];if(!left||!right||left.length!==right.length)throw new Error('invalid stereo output block');
  for(let i=0;i<left.length;i++){
    const l=left[i],r=right[i];if(!Number.isFinite(l)||!Number.isFinite(r))state.finite=false;
    state.peak=Math.max(state.peak,Math.abs(l),Math.abs(r));
  }
}
function captureLifecycleCell({pitch,velocity,repoRoot=ROOT,holdMs=HOLD_MS,releaseLimitMs=RELEASE_LIMIT_MS,blockSize=BLOCK,
  createHarness=(root,file,options)=>new PluginHarness(root,file,options),analyze=analyzeStereo,estimatePitch=estimatePianoPitch,now=()=>new Date().toISOString()}={}){
  if(!Number.isInteger(pitch)||pitch<21||pitch>108||!VELOCITIES.includes(velocity))throw new Error('invalid Stage4 lifecycle coordinate');
  const harness=createHarness(repoRoot,WASM_RELATIVE,{sampleRate:SAMPLE_RATE,maxFrames:blockSize});
  const holdFrames=Math.floor(SAMPLE_RATE*holdMs/1000),releaseLimitFrames=Math.floor(SAMPLE_RATE*releaseLimitMs/1000);
  const heldLeft=new Float32Array(holdFrames),heldRight=new Float32Array(holdFrames),state={finite:true,peak:0};
  let position=0;
  try{
    const exports=harness.e;
    if(typeof exports.soraoto_supersynth_active_voice_count!=='function'||typeof exports.soraoto_supersynth_guard_hit_count!=='function')
      throw new Error('Stage4 lifecycle requires active-voice and guard diagnostic exports');
    harness.applyPreset('concert_grand');
    harness.setPlain('voice_drift',0);harness.setPlain('lfo1_pitch',0);harness.setPlain('chorus_mix',0);
    const guardStart=exports.soraoto_supersynth_guard_hit_count()>>>0;
    while(position<holdFrames){
      const frames=Math.min(blockSize,holdFrames-position);
      const output=harness.process(frames,{events:position===0?[{kind:1,noteId:1,pitch,velocity:velocity/127,offset:0}]:[]})[0];
      heldLeft.set(output[0],position);heldRight.set(output[1],position);updateFiniteAndPeak(output,state);position+=frames;
    }
    const noteOffFrame=position;let noteOffProcessed=false,releaseFrames=0,active=exports.soraoto_supersynth_active_voice_count()>>>0;
    let postReleaseProcessed=false,postReleaseFinite=false;
    if(releaseLimitFrames<=0)throw new Error('Stage4 release limit must be positive');
    {
      const frames=Math.min(blockSize,releaseLimitFrames);
      const output=harness.process(frames,{events:[{kind:2,noteId:1,pitch,velocity:0,offset:0}]})[0];
      noteOffProcessed=true;updateFiniteAndPeak(output,state);releaseFrames+=frames;active=exports.soraoto_supersynth_active_voice_count()>>>0;
    }
    while(active>0&&releaseFrames<releaseLimitFrames){
      const frames=Math.min(blockSize,releaseLimitFrames-releaseFrames);
      const output=harness.process(frames,{events:[]})[0];
      updateFiniteAndPeak(output,state);releaseFrames+=frames;active=exports.soraoto_supersynth_active_voice_count()>>>0;
    }
    if(active===0){
      const output=harness.process(blockSize,{events:[]})[0];
      const post={finite:true,peak:0};updateFiniteAndPeak(output,post);updateFiniteAndPeak(output,state);
      postReleaseProcessed=true;postReleaseFinite=post.finite;active=exports.soraoto_supersynth_active_voice_count()>>>0;
    }
    const analysisFrames=Math.floor(SAMPLE_RATE*.38),left=heldLeft.subarray(0,analysisFrames),right=heldRight.subarray(0,analysisFrames);
    const metrics=analyze(left,right,pitch,{sampleRate:SAMPLE_RATE});
    const plan=getPianoPitchAnalysisPlan(pitch,{sampleRate:SAMPLE_RATE,blockSize:BLOCK,minimumDurationMs:holdMs});
    const pitchMeasurement=estimatePitch(heldLeft,heldRight,{sampleRate:SAMPLE_RATE,expectedMidiPitch:pitch,analysisWindows:plan.windows});
    const guardHits=(exports.soraoto_supersynth_guard_hit_count()>>>0)-guardStart;
    const fullPeakDbfs=toDbfs(state.peak);
    Object.assign(metrics,{finite:state.finite,finiteThroughout:state.finite,finiteRelease:state.finite,postReleaseFinite,
      fullRenderPeakDbfs:fullPeakDbfs,outputGuardHits:guardHits,pitchMeasurement,
      pitchCapture:{heldFrames:holdFrames,holdMs,releaseLimitMs,analysisWindowMs:plan.windows,requiredDurationMs:plan.requiredDurationMs},
      lifecycle:{noteOnProcessed:true,noteOffProcessed,noteOffFrame,releaseFrames,
        inactiveAfterNoteOffMs:active===0?releaseFrames*1000/SAMPLE_RATE:null,
        releasedWithinLimit:active===0&&releaseFrames<=releaseLimitFrames,postReleaseProcessed,
        finalActiveVoiceCount:active,guardHits,finiteThroughout:state.finite,postReleaseFinite}});
    return {pitch,velocity,velocityNormalized:velocity/127,metrics,capturedAt:now()};
  }finally{harness.close();}
}
function renderMetadata(repoRoot=ROOT){
  const presets=JSON.parse(fs.readFileSync(path.join(repoRoot,'wasm/plugins/dsp/super-synth/presets.json'),'utf8'));
  const preset=presets.concert_grand;const hammer=Number(preset.piano_hammer_hardness),noise=Number(preset.piano_hammer_noise);
  if(!Number.isFinite(hammer)||!Number.isFinite(noise))throw new Error('concert_grand hammer preset metadata is missing');
  return {pluginId:'net.puchinya.soraotodsl.super-synth-v8',pluginName:'SuperSynth v9',pluginVersion:'9.0.0',preset:'concert_grand',
    sampleRate:SAMPLE_RATE,durationMs:380,velocityRepresentatives:[...VELOCITIES],pianoHammerHardness:hammer,pianoHammerNoise:noise};
}
function captureMatrix({cells=LIFECYCLE_CELLS,renderCell=captureLifecycleCell,onProgress=()=>{},repoRoot=ROOT}={}){
  assertExactCells(cells);const started=performance.now(),rows=[];
  for(const cell of cells){rows.push(renderCell({...cell,repoRoot}));onProgress(cell,rows.length);}
  const build=path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(repoRoot,'build/wasm-stage4'));
  const wasm=path.join(build,WASM_RELATIVE);
  return {schemaVersion:1,render:renderMetadata(repoRoot),matrix:rows,
    capture:{authorizedCells:cells.length,renderCalls:rows.length,elapsedSeconds:(performance.now()-started)/1000,
      wasmSha256:sha256(fs.readFileSync(wasm)),buildRoot:build}};
}
function repeatMatrix({cells=REPEAT_CELLS,renderCell=captureLifecycleCell,onProgress=()=>{},repoRoot=ROOT}={}){
  assertExactCells(cells,REPEAT_CELLS);const rows=[];
  for(const cell of cells){rows.push(renderCell({...cell,repoRoot}));onProgress(cell,rows.length);}
  return rows;
}

module.exports={ROOT,WASM_RELATIVE,SAMPLE_RATE,BLOCK,HOLD_MS,RELEASE_LIMIT_MS,PITCHES,VELOCITIES,REPEAT_PITCHES,REPEAT_VELOCITIES,
  LIFECYCLE_CELLS,REPEAT_CELLS,sha256,key,assertExactCells,captureLifecycleCell,renderMetadata,captureMatrix,repeatMatrix};
