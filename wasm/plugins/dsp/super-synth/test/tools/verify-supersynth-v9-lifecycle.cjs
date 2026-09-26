#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PluginHarness, paramDef } = require('../../../../../test/helpers/plugin-harness.cjs');
const { analyzeStereo } = require('./salamander-metrics.cjs');

const REPO = path.resolve(__dirname, '../../../../../../');
const WASM = 'plugins/dsp/super-synth/plugin.wasm';
const SAMPLE_RATE = 48000;
const BLOCK = 1024;
const VELOCITIES = [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const DEFAULT_PITCHES = Array.from({length:88},(_,i)=>i+21);
const TOTAL_FRAMES = Math.floor(SAMPLE_RATE * 2.45);
const EVENTS = {
  sostenutoDown: Math.floor(SAMPLE_RATE * 0.04),
  sustainDown: Math.floor(SAMPLE_RATE * 0.06),
  noteOff: Math.floor(SAMPLE_RATE * 0.12),
  sustainUp: Math.floor(SAMPLE_RATE * 0.15),
  sostenutoUp: Math.floor(SAMPLE_RATE * 0.20),
};

function parseArgs(argv) {
  const args = {};
  for (let i=0; i<argv.length; i++) {
    const key=argv[i];
    if (!['--simd-dir','--scalar-dir','--output','--pitches','--velocities'].includes(key) || !argv[i+1]) {
      throw new Error('Usage: verify-supersynth-v9-lifecycle.cjs --simd-dir <path> --scalar-dir <path> --output <json> [--pitches <list>] [--velocities <list>]');
    }
    args[key.slice(2)]=argv[++i];
  }
  for (const key of ['simd-dir','scalar-dir','output']) if (!args[key]) throw new Error(`missing --${key}`);
  const list=(value,fallback)=>value?value.split(',').map(Number):fallback;
  const pitches=list(args.pitches,DEFAULT_PITCHES), velocities=list(args.velocities,VELOCITIES);
  if (pitches.some(x=>!Number.isInteger(x)||x<21||x>108)) throw new Error('pitch must be an integer from MIDI 21 through 108');
  if (velocities.some(x=>!Number.isInteger(x)||x<1||x>127)) throw new Error('velocity must be an integer from 1 through 127');
  return {simdDir:path.resolve(args['simd-dir']),scalarDir:path.resolve(args['scalar-dir']),output:path.resolve(args.output),pitches,velocities};
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function normalized(def,value) {
  const low=Number(def.min), high=Number(def.max);
  if (String(def.type).toLowerCase()==='bool') return value>=0.5?1:0;
  return Number.isFinite(low)&&Number.isFinite(high)&&high>low?Math.max(0,Math.min(1,(value-low)/(high-low))):Math.max(0,Math.min(1,value));
}
function makeHarness(dir) {
  process.env.SORAOTO_WASM_BUILD_DIR=dir;
  const harness=new PluginHarness(REPO,WASM,{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});
  if (typeof harness.e.soraoto_supersynth_guard_hit_count!=='function' || typeof harness.e.soraoto_supersynth_active_voice_count!=='function') {
    throw new Error(`${dir}: build lacks required local lifecycle diagnostics`);
  }
  return harness;
}
function prepare(harness) {
  harness.e.soraoto_plugin_reset();
  harness.applyPreset('concert_grand');
  for (const [name,value] of [['voice_drift',0],['lfo1_pitch',0],['chorus_mix',0],['sustain_pedal',0],['sostenuto_pedal',0]]) harness.setPlain(name,value);
}
function schedule(harness,pitch,velocity) {
  const params=[];
  for (const [name,frame,value] of [
    ['sostenuto_pedal',EVENTS.sostenutoDown,1],
    ['sustain_pedal',EVENTS.sustainDown,1],
    ['sustain_pedal',EVENTS.sustainUp,0],
    ['sostenuto_pedal',EVENTS.sostenutoUp,0],
  ]) {
    const def=paramDef(harness.descriptor,name);
    if (!def) throw new Error(`missing ${name}`);
    params.push({frame,id:Number(def.id),normalized:normalized(def,value)});
  }
  return {
    note:{frame:0,kind:1,noteId:1,pitch,velocity:velocity/127},
    off:{frame:EVENTS.noteOff,kind:2,noteId:1,pitch,velocity:0},
    params,
  };
}
function render(harness,pitch,velocity) {
  prepare(harness);
  const startGuard=harness.e.soraoto_supersynth_guard_hit_count();
  const timeline=schedule(harness,pitch,velocity);
  const left=new Float32Array(TOTAL_FRAMES),right=new Float32Array(TOTAL_FRAMES);
  let peak=0,attackPeak=0,releasePeak=0,nonFinite=0,position=0;
  while(position<TOTAL_FRAMES){
    const frames=Math.min(BLOCK,TOTAL_FRAMES-position),end=position+frames;
    const events=[];
    if(timeline.note.frame>=position&&timeline.note.frame<end) events.push({...timeline.note,offset:timeline.note.frame-position});
    if(timeline.off.frame>=position&&timeline.off.frame<end) events.push({...timeline.off,offset:timeline.off.frame-position});
    const params=timeline.params.filter(x=>x.frame>=position&&x.frame<end).map(({frame,...x})=>({...x,offset:frame-position}));
    const output=harness.process(frames,{events,params})[0];
    left.set(output[0],position);right.set(output[1],position);
    for(let i=0;i<frames;i++){
      const l=output[0][i],r=output[1][i];
      if(!Number.isFinite(l)||!Number.isFinite(r)){nonFinite++;continue;}
      const samplePeak=Math.max(Math.abs(l),Math.abs(r));
      peak=Math.max(peak,samplePeak);
      const absolute=position+i;
      if(absolute<Math.floor(SAMPLE_RATE*.05))attackPeak=Math.max(attackPeak,samplePeak);
      if(absolute>=EVENTS.sostenutoUp)releasePeak=Math.max(releasePeak,samplePeak);
    }
    position=end;
  }
  const metrics=analyzeStereo(left,right,pitch,{sampleRate:SAMPLE_RATE});
  let tailEnergy=0,tailCount=0;
  for(let i=TOTAL_FRAMES-Math.floor(SAMPLE_RATE*.1);i<TOTAL_FRAMES;i++){
    tailEnergy+=left[i]*left[i]+right[i]*right[i];tailCount+=2;
  }
  return {
    metrics,peak,peakDbfsFull:20*Math.log10(Math.max(1e-12,peak)),attackPeak,releasePeak,tailRmsDbfs:20*Math.log10(Math.max(1e-12,Math.sqrt(tailEnergy/Math.max(1,tailCount)))),
    nonFinite,guardHits:harness.e.soraoto_supersynth_guard_hit_count()-startGuard,
    activeVoicesAtEnd:harness.e.soraoto_supersynth_active_voice_count(),
  };
}
function recordMaximum(target,key,value) { if (Number.isFinite(value)) target[key]=Math.max(target[key]||0,value); }

function main() {
  const args=parseArgs(process.argv.slice(2));
  const previousBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  const simd=makeHarness(args.simdDir),scalar=makeHarness(args.scalarDir);
  const summary={
    schemaVersion:1,check:'supersynth-v9-full-lifecycle-scalar-simd',
    sampleRate:SAMPLE_RATE,blockFrames:BLOCK,totalFrames:TOTAL_FRAMES,
    pedalSequenceFrames:EVENTS, pitches:args.pitches,velocities:args.velocities,
    simdWasmSha256:sha256(path.join(args.simdDir,WASM)),scalarWasmSha256:sha256(path.join(args.scalarDir,WASM)),
    cells:0,adjacentComparisons:0,adjacentComparisonsByMode:{simd:0,scalar:0},counts:{nonFinite:0,silentAttack:0,peakAtOrAbove0Dbfs:0,guardHits:0,stuckVoices:0,differentialPitch:0,differentialPeak:0,differentialEnvelope:0,differentialSpectrum:0,nonMonotonicPitch:0},
    maxima:{pitchDeltaCents:0,peakDeltaDb:0,envelopeDeltaDb:0,spectralBandRelativeDelta:0,cellPeakDbfs:-240,releasePeakDbfs:-240,tailRmsDbfs:-240,adjacentPitchErrorCents:0},
    failures:[],frequencyByMode:{simd:{},scalar:{}},
  };
  const failureSamples={};
  const addFailure=(kind,pitch,velocity,detail)=>{const xs=failureSamples[kind]||(failureSamples[kind]=[]);if(xs.length<6)xs.push({pitch,velocity,detail});};
  try {
    for(const pitch of args.pitches) for(const velocity of args.velocities){
      const a=render(simd,pitch,velocity),b=render(scalar,pitch,velocity);
      summary.cells++;
      for(const [mode,result] of [['simd',a],['scalar',b]]){
        if(!summary.frequencyByMode[mode][velocity])summary.frequencyByMode[mode][velocity]={};
        summary.frequencyByMode[mode][velocity][pitch]=result.metrics.fundamentalHz;
        summary.counts.nonFinite+=result.nonFinite;
        summary.counts.guardHits+=result.guardHits;
        recordMaximum(summary.maxima,'cellPeakDbfs',result.peakDbfsFull);
        recordMaximum(summary.maxima,'releasePeakDbfs',20*Math.log10(Math.max(1e-12,result.releasePeak)));
        recordMaximum(summary.maxima,'tailRmsDbfs',result.tailRmsDbfs);
        if(result.attackPeak<=1e-8){summary.counts.silentAttack++;addFailure('silent-attack',pitch,velocity,result.attackPeak);}
        if(result.peakDbfsFull>=0){summary.counts.peakAtOrAbove0Dbfs++;addFailure('peak-not-below-zero-dbfs',pitch,velocity,result.peakDbfsFull);}
        if(result.guardHits){addFailure(`${mode}-output-guard-hit`,pitch,velocity,result.guardHits);}
        if(result.activeVoicesAtEnd){summary.counts.stuckVoices++;addFailure(`${mode}-voice-still-active-at-tail-end`,pitch,velocity,result.activeVoicesAtEnd);}
        if(result.nonFinite){addFailure(`${mode}-non-finite`,pitch,velocity,result.nonFinite);}
      }
      const pitchDelta=Math.abs(a.metrics.pitchErrorCents-b.metrics.pitchErrorCents);
      const peakDelta=Math.abs(a.metrics.peakDbfs-b.metrics.peakDbfs);
      const envelopeDelta=Math.max(...a.metrics.envelopeDbfs.map((x,i)=>Math.abs(x-b.metrics.envelopeDbfs[i])));
      let spectralDelta=0,spectralFailures=0,worstBand=-1;
      for(let i=0;i<a.metrics.spectralBandPowerRatios.length;i++){
        const av=a.metrics.spectralBandPowerRatios[i],bv=b.metrics.spectralBandPowerRatios[i],den=Math.max(Math.abs(av),Math.abs(bv));
        if(den>=1e-4){const d=Math.abs(av-bv)/den;if(d>spectralDelta){spectralDelta=d;worstBand=i;}if(d>0.005)spectralFailures++;}
      }
      recordMaximum(summary.maxima,'pitchDeltaCents',pitchDelta);
      recordMaximum(summary.maxima,'peakDeltaDb',peakDelta);
      recordMaximum(summary.maxima,'envelopeDeltaDb',envelopeDelta);
      recordMaximum(summary.maxima,'spectralBandRelativeDelta',spectralDelta);
      if(pitchDelta>0.1){summary.counts.differentialPitch++;addFailure('simd-scalar-pitch-delta',pitch,velocity,{deltaCents:pitchDelta,simdCents:a.metrics.pitchErrorCents,scalarCents:b.metrics.pitchErrorCents,simdHz:a.metrics.fundamentalHz,scalarHz:b.metrics.fundamentalHz});}
      if(peakDelta>0.05){summary.counts.differentialPeak++;addFailure('simd-scalar-peak-delta',pitch,velocity,{deltaDb:peakDelta,simdDbfs:a.metrics.peakDbfs,scalarDbfs:b.metrics.peakDbfs});}
      if(envelopeDelta>0.05){summary.counts.differentialEnvelope++;addFailure('simd-scalar-envelope-delta',pitch,velocity,{deltaDb:envelopeDelta,simdEnvelope:a.metrics.envelopeDbfs,scalarEnvelope:b.metrics.envelopeDbfs});}
      if(spectralFailures){summary.counts.differentialSpectrum+=spectralFailures;addFailure('simd-scalar-spectral-band-delta',pitch,velocity,{count:spectralFailures,maxRelative:spectralDelta,worstBand});}
    }
    for(const mode of ['simd','scalar']) for(const velocity of args.velocities){
      const frequencies=summary.frequencyByMode[mode][velocity];
      for(let pitch=21;pitch<108;pitch++){
        const a=frequencies[pitch],b=frequencies[pitch+1];
        if(!Number.isFinite(a)||!Number.isFinite(b))continue;
        summary.adjacentComparisonsByMode[mode]++;
        const cents=1200*Math.log2(b/a),error=Math.abs(cents-100);
        recordMaximum(summary.maxima,'adjacentPitchErrorCents',error);
        if(!(b>a)){summary.counts.nonMonotonicPitch++;addFailure(`${mode}-adjacent-pitch-not-monotonic`,pitch+1,velocity,{lowerHz:a,upperHz:b});}
        if(error>10)addFailure(`${mode}-adjacent-pitch-step-error`,pitch+1,velocity,{cents,stepErrorCents:error,lowerHz:a,upperHz:b});
      }
    }
    summary.adjacentComparisons=summary.adjacentComparisonsByMode.simd;
    summary.requiredCells=88*16;
    summary.requiredAdjacentComparisons=87*16;
    summary.pass=summary.cells===summary.requiredCells&&summary.adjacentComparisons===summary.requiredAdjacentComparisons&&Object.values(summary.adjacentComparisonsByMode).every(x=>x===summary.requiredAdjacentComparisons)&&Object.values(summary.counts).every(x=>x===0);
    const out={...summary,failures:Object.entries(failureSamples).flatMap(([kind,samples])=>samples.map(x=>({kind,...x}))),spectralNonNegligibleThreshold:1e-4};delete out.frequencyByMode;
    fs.mkdirSync(path.dirname(args.output),{recursive:true});fs.writeFileSync(args.output,`${JSON.stringify(out,null,2)}\n`);
    process.stdout.write(`${JSON.stringify(out,null,2)}\n`);
  } finally {
    simd.close();scalar.close();
    if(previousBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previousBuildDir;
  }
  if(!summary.pass)process.exitCode=1;
}

main();
