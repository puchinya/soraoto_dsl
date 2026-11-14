#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PluginHarness } = require('../../../../../test/helpers/plugin-harness.cjs');
const { estimatePianoPitch } = require('./piano-pitch-estimator.cjs');

const REPO = path.resolve(__dirname, '../../../../../../');
const WASM = 'plugins/dsp/super-synth/plugin.wasm';
const SAMPLE_RATE = 48000;
const BLOCK = 1024;
const VELOCITIES = [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const DEFAULT_PITCHES = Array.from({length:88},(_,i)=>i+21);
const TOTAL_FRAMES = Math.floor(SAMPLE_RATE * 3.2);
const NOTE_OFF_FRAME = Math.floor(SAMPLE_RATE * 0.60);
const PITCH_TOLERANCE_CENTS = 15;
const ADJACENT_STEP_TOLERANCE_CENTS = 10;

function parseArgs(argv) {
  const args = {};
  for (let i=0; i<argv.length; i++) {
    const key=argv[i];
    if (!['--production-dir','--output','--pitches','--velocities','--set','--pitch-window'].includes(key) || !argv[i+1]) {
      throw new Error('Usage: verify-supersynth-v9-production-lifecycle.cjs --production-dir <path> --output <json> [--pitches <list>] [--velocities <list>] [--set <name=value,...>] [--pitch-window <startMs,endMs>]');
    }
    args[key.slice(2)]=argv[++i];
  }
  for (const key of ['production-dir','output']) if (!args[key]) throw new Error(`missing --${key}`);
  const list=(value,fallback)=>value?value.split(',').map(Number):fallback;
  const pitches=list(args.pitches,DEFAULT_PITCHES), velocities=list(args.velocities,VELOCITIES);
  const pitchWindow=list(args['pitch-window'],[20,350]);
  if(pitchWindow.length!==2||!pitchWindow.every(Number.isFinite)||pitchWindow[0]<0||pitchWindow[1]<=pitchWindow[0])throw new Error('pitch window must be two increasing nonnegative millisecond values');
  const parameters={};
  if(args.set)for(const pair of args.set.split(',')){
    const separator=pair.lastIndexOf('=');
    if(separator<1)throw new Error(`invalid parameter override ${pair}`);
    const value=Number(pair.slice(separator+1));
    if(!Number.isFinite(value))throw new Error(`parameter override must be finite: ${pair}`);
    parameters[pair.slice(0,separator)]=value;
  }
  if (pitches.some(x=>!Number.isInteger(x)||x<21||x>108)) throw new Error('pitch must be an integer from MIDI 21 through 108');
  if (velocities.some(x=>!Number.isInteger(x)||x<1||x>127)) throw new Error('velocity must be an integer from 1 through 127');
  return {productionDir:path.resolve(args['production-dir']),output:path.resolve(args.output),pitches,velocities,parameters,pitchWindow};
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function makeHarness(dir) {
  process.env.SORAOTO_WASM_BUILD_DIR=dir;
  const harness=new PluginHarness(REPO,WASM,{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});
  if (typeof harness.e.soraoto_supersynth_guard_hit_count!=='function' || typeof harness.e.soraoto_supersynth_active_voice_count!=='function') {
    throw new Error(`${dir}: build lacks required local production lifecycle diagnostics`);
  }
  return harness;
}
function prepare(harness,parameters={}) {
  /* ABI reset is only valid in ST_ACTIVE. This harness is normally in
     ST_PROCESSING, so stop and restart it around reset to isolate each cell. */
  harness.e.soraoto_plugin_stop_processing();
  harness.e.soraoto_plugin_reset();
  const startStatus=harness.e.soraoto_plugin_start_processing()|0;
  if(startStatus!==0)throw new Error(`failed to restart processing after reset: ${startStatus}`);
  harness.applyPreset('concert_grand');
  for (const [name,value] of [['voice_drift',0],['lfo1_pitch',0],['chorus_mix',0],['sustain_pedal',0],['sostenuto_pedal',0]]) harness.setPlain(name,value);
  for(const [name,value] of Object.entries(parameters))harness.setPlain(name,value);
}
function schedule(pitch,velocity) {
  return {
    note:{frame:0,kind:1,noteId:1,pitch,velocity:velocity/127},
    off:{frame:NOTE_OFF_FRAME,kind:2,noteId:1,pitch,velocity:0},
  };
}
function render(harness,pitch,velocity,parameters={},pitchWindow=[20,350]) {
  prepare(harness,parameters);
  const startGuard=harness.e.soraoto_supersynth_guard_hit_count();
  const timeline=schedule(pitch,velocity);
  const left=new Float32Array(TOTAL_FRAMES),right=new Float32Array(TOTAL_FRAMES);
  let peak=0,peakFrame=-1,attackPeak=0,releasePeak=0,releasePeakFrame=-1,nonFinite=0,nonFiniteRelease=0,position=0,noteOffSent=false;
  while(position<TOTAL_FRAMES){
    const frames=Math.min(BLOCK,TOTAL_FRAMES-position),end=position+frames;
    const events=[];
    if(timeline.note.frame>=position&&timeline.note.frame<end) events.push({...timeline.note,offset:timeline.note.frame-position});
    if(timeline.off.frame>=position&&timeline.off.frame<end) {
      events.push({...timeline.off,offset:timeline.off.frame-position});
      noteOffSent=true;
    }
    const output=harness.process(frames,{events})[0];
    left.set(output[0],position);right.set(output[1],position);
    for(let i=0;i<frames;i++){
      const l=output[0][i],r=output[1][i],absolute=position+i;
      if(!Number.isFinite(l)||!Number.isFinite(r)){
        nonFinite++;
        if(absolute>=NOTE_OFF_FRAME)nonFiniteRelease++;
        continue;
      }
      const samplePeak=Math.max(Math.abs(l),Math.abs(r));
      if(samplePeak>peak){peak=samplePeak;peakFrame=absolute;}
      if(absolute<Math.floor(SAMPLE_RATE*.05))attackPeak=Math.max(attackPeak,samplePeak);
      if(absolute>=NOTE_OFF_FRAME&&samplePeak>releasePeak){releasePeak=samplePeak;releasePeakFrame=absolute;}
    }
    position=end;
  }
  const pitchEstimate=estimatePianoPitch(left,right,{sampleRate:SAMPLE_RATE,expectedMidiPitch:pitch,onsetIndex:0,startMs:pitchWindow[0],endMs:pitchWindow[1]});
  let tailEnergy=0,tailCount=0;
  for(let i=TOTAL_FRAMES-Math.floor(SAMPLE_RATE*.1);i<TOTAL_FRAMES;i++){
    tailEnergy+=left[i]*left[i]+right[i]*right[i];tailCount+=2;
  }
  return {
    pitchEstimate,peak,peakFrame,peakTimeMs:peakFrame*1000/SAMPLE_RATE,peakDbfsFull:20*Math.log10(Math.max(1e-12,peak)),attackPeak,releasePeak,releasePeakFrame,releasePeakTimeMs:releasePeakFrame*1000/SAMPLE_RATE,
    tailRmsDbfs:20*Math.log10(Math.max(1e-12,Math.sqrt(tailEnergy/Math.max(1,tailCount)))),
    nonFinite,nonFiniteRelease,guardHits:harness.e.soraoto_supersynth_guard_hit_count()-startGuard,
    noteOffSent,activeVoicesAtEnd:harness.e.soraoto_supersynth_active_voice_count(),
  };
}
function recordMaximum(target,key,value) { if (Number.isFinite(value)) target[key]=Math.max(target[key]||0,value); }

function main() {
  const args=parseArgs(process.argv.slice(2));
  const previousBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  const production=makeHarness(args.productionDir);
  const summary={
    schemaVersion:1,check:'supersynth-v9-production-simd-lifecycle',simdMode:'wasm-simd128',
    sampleRate:SAMPLE_RATE,blockFrames:BLOCK,totalFrames:TOTAL_FRAMES,noteOffFrame:NOTE_OFF_FRAME,
    pitches:args.pitches,velocities:args.velocities,pitchWindowMs:args.pitchWindow,parameterOverrides:args.parameters,productionWasmSha256:sha256(path.join(args.productionDir,WASM)),
    cells:0,adjacentComparisons:0,
    counts:{nonFiniteSamples:0,nonFiniteReleaseSamples:0,silentAttack:0,peakAtOrAbove0Dbfs:0,guardHits:0,stuckVoices:0,pitchOutOfTolerance:0,invalidPitch:0,missingNoteOff:0,nonMonotonicPitch:0,adjacentPitchStepOutOfTolerance:0},
    maxima:{pitchErrorCents:0,adjacentPitchStepErrorCents:0,cellPeakDbfs:-240,cellPeakTimeMs:null,releasePeakDbfs:-240,releasePeakTimeMs:null,tailRmsDbfs:-240},
    failures:[],cellResults:[],frequencyByVelocity:{},
  };
  const failureSamples={};
  const addFailure=(kind,pitch,velocity,detail)=>{const xs=failureSamples[kind]||(failureSamples[kind]=[]);xs.push({pitch,velocity,detail});};
  try {
    for(const velocity of args.velocities)summary.frequencyByVelocity[velocity]={};
    for(const pitch of args.pitches) for(const velocity of args.velocities){
      const result=render(production,pitch,velocity,args.parameters,args.pitchWindow);
      summary.cells++;
      const pitchValid=result.pitchEstimate.result!=='MEASUREMENT_INVALID'&&Number.isFinite(result.pitchEstimate.estimated_f0)&&Number.isFinite(result.pitchEstimate.pitch_error_cents);
      const releasePeakDbfs=20*Math.log10(Math.max(1e-12,result.releasePeak));
      summary.cellResults.push({
        pitch,velocity,
        finite:result.nonFinite===0&&result.nonFiniteRelease===0,
        fundamentalHz:pitchValid?result.pitchEstimate.estimated_f0:null,
        pitchErrorCents:pitchValid?result.pitchEstimate.pitch_error_cents:null,
        pitchWithinTolerance:result.pitchEstimate.result==='PASS',
        pitchResult:result.pitchEstimate.result,
        harmonicCombCents:result.pitchEstimate.pitch_error_cents,
        fittedB:result.pitchEstimate.fitted_B,
        confidence:result.pitchEstimate.confidence_ratio,
        usablePartials:result.pitchEstimate.usable_partials,
        autocorrelationCents:result.pitchEstimate.autocorrelation_pitch_cents,
        estimatorDisagreementCents:result.pitchEstimate.estimator_disagreement_cents,
        pitchDiagnostics:result.pitchEstimate,
        peakDbfs:result.peakDbfsFull,peakTimeMs:result.peakTimeMs,peakBelowZero:result.peakDbfsFull<0,
        guardHits:result.guardHits,noteOffSent:result.noteOffSent,
        releaseFinite:result.nonFiniteRelease===0,releasePeakDbfs,releasePeakTimeMs:result.releasePeakTimeMs,
        stuckVoices:result.activeVoicesAtEnd,tailRmsDbfs:result.tailRmsDbfs,
      });
      summary.frequencyByVelocity[velocity][pitch]=result.pitchEstimate.estimated_f0;
      summary.counts.nonFiniteSamples+=result.nonFinite;
      summary.counts.nonFiniteReleaseSamples+=result.nonFiniteRelease;
      summary.counts.guardHits+=result.guardHits;
      if(result.peakDbfsFull>summary.maxima.cellPeakDbfs){summary.maxima.cellPeakDbfs=result.peakDbfsFull;summary.maxima.cellPeakTimeMs=result.peakTimeMs;}
      if(releasePeakDbfs>summary.maxima.releasePeakDbfs){summary.maxima.releasePeakDbfs=releasePeakDbfs;summary.maxima.releasePeakTimeMs=result.releasePeakTimeMs;}
      recordMaximum(summary.maxima,'tailRmsDbfs',result.tailRmsDbfs);
      const pitchError=Math.abs(result.pitchEstimate.pitch_error_cents);
      if(Number.isFinite(pitchError))recordMaximum(summary.maxima,'pitchErrorCents',pitchError);
      if(result.attackPeak<=1e-8){summary.counts.silentAttack++;addFailure('silent-attack',pitch,velocity,result.attackPeak);}
      if(result.peakDbfsFull>=0){summary.counts.peakAtOrAbove0Dbfs++;addFailure('peak-not-below-zero-dbfs',pitch,velocity,result.peakDbfsFull);}
      if(result.guardHits){addFailure('output-guard-hit',pitch,velocity,result.guardHits);}
      if(result.activeVoicesAtEnd){summary.counts.stuckVoices++;addFailure('voice-still-active-at-tail-end',pitch,velocity,result.activeVoicesAtEnd);}
      if(result.nonFinite){addFailure('non-finite-output',pitch,velocity,result.nonFinite);}
      if(result.nonFiniteRelease){addFailure('non-finite-release-output',pitch,velocity,result.nonFiniteRelease);}
      if(!result.noteOffSent){summary.counts.missingNoteOff++;addFailure('note-off-not-scheduled',pitch,velocity,null);}
      if(!pitchValid){
        summary.counts.invalidPitch++;addFailure('invalid-pitch-measurement',pitch,velocity,result.pitchEstimate);
      }else if(result.pitchEstimate.result==='FAIL'||pitchError>PITCH_TOLERANCE_CENTS){
        summary.counts.pitchOutOfTolerance++;addFailure('pitch-out-of-tolerance',pitch,velocity,{pitchErrorCents:result.pitchEstimate.pitch_error_cents,toleranceCents:PITCH_TOLERANCE_CENTS,estimator:result.pitchEstimate});
      }
    }
    for(const velocity of args.velocities){
      const frequencies=summary.frequencyByVelocity[velocity];
      for(let pitch=21;pitch<108;pitch++){
        const a=frequencies[pitch],b=frequencies[pitch+1];
        if(!Number.isFinite(a)||!Number.isFinite(b))continue;
        summary.adjacentComparisons++;
        const cents=1200*Math.log2(b/a),error=Math.abs(cents-100);
        recordMaximum(summary.maxima,'adjacentPitchStepErrorCents',error);
        if(!(b>a)){summary.counts.nonMonotonicPitch++;addFailure('adjacent-pitch-not-monotonic',pitch+1,velocity,{lowerHz:a,upperHz:b});}
        if(error>ADJACENT_STEP_TOLERANCE_CENTS){summary.counts.adjacentPitchStepOutOfTolerance++;addFailure('adjacent-pitch-step-out-of-tolerance',pitch+1,velocity,{cents,stepErrorCents:error,toleranceCents:ADJACENT_STEP_TOLERANCE_CENTS});}
      }
    }
    summary.requiredCells=args.pitches.length*args.velocities.length;
    const selectedPitches=new Set(args.pitches);
    const selectedAdjacentPairs=args.pitches.filter(pitch=>selectedPitches.has(pitch+1)).length;
    summary.requiredAdjacentComparisons=selectedAdjacentPairs*args.velocities.length;
    summary.pass=summary.cells===summary.requiredCells&&summary.adjacentComparisons===summary.requiredAdjacentComparisons&&Object.values(summary.counts).every(x=>x===0);
    summary.failures=Object.entries(failureSamples).flatMap(([kind,samples])=>samples.map(x=>({kind,...x})));
    delete summary.frequencyByVelocity;
    fs.mkdirSync(path.dirname(args.output),{recursive:true});
    fs.writeFileSync(args.output,`${JSON.stringify(summary,null,2)}\n`);
    process.stdout.write(`${JSON.stringify(summary,null,2)}\n`);
  } finally {
    production.close();
    if(previousBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previousBuildDir;
  }
  if(!summary.pass)process.exitCode=1;
}

main();
