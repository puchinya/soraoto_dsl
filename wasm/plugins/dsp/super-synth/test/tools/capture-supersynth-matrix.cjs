#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
const {analyzeStereo} = require('./salamander-metrics.cjs');

const REPO = path.resolve(__dirname,'../../../../../../');
const WASM = 'plugins/dsp/super-synth/plugin.wasm';
const CONCERT_GRAND = JSON.parse(fs.readFileSync(path.join(REPO,'wasm/plugins/dsp/super-synth/presets.json'),'utf8')).concert_grand;
const SAMPLE_RATE = 48000;
const BLOCK = 2048;
const DURATION_MS = 380;
const VELOCITIES = [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];

function parseArgs(argv) {
  const result={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!['--output','--pitches','--velocities','--set'].includes(key)||!argv[i+1])throw new Error('Usage: capture-supersynth-matrix.cjs --output <metrics.json> [--pitches <comma-list>] [--velocities <comma-list>] [--set <name=value,...>]');
    result[key.slice(2)]=argv[++i];
  }
  if(!result.output)throw new Error('Usage: capture-supersynth-matrix.cjs --output <metrics.json> [--pitches <comma-list>] [--velocities <comma-list>]');
  const parseList=(value,defaults)=>value?value.split(',').map(Number):defaults;
  const parameters={};if(result.set)for(const pair of result.set.split(',')){const at=pair.lastIndexOf('=');if(at<1)throw new Error(`invalid parameter override ${pair}`);parameters[pair.slice(0,at)]=Number(pair.slice(at+1));}
  return {output:path.resolve(result.output),pitches:parseList(result.pitches,Array.from({length:88},(_,i)=>i+21)),velocities:parseList(result.velocities,VELOCITIES),parameters};
}

function render(pitch, velocity, parameters={}) {
  const harness = new PluginHarness(REPO,WASM,{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});
  try {
    const guardCount=typeof harness.e.soraoto_supersynth_guard_hit_count==='function'?harness.e.soraoto_supersynth_guard_hit_count():null;
    harness.applyPreset('concert_grand');
    for (const [name,value] of [['voice_drift',0],['lfo1_pitch',0],['chorus_mix',0]]) harness.setPlain(name,value);
    for (const [name,value] of Object.entries(parameters)) harness.setPlain(name,value);
    const count = Math.floor(SAMPLE_RATE * DURATION_MS / 1000);
    const left = new Float32Array(count), right = new Float32Array(count);
    let position = 0;
    while (position < count) {
      const frames = Math.min(BLOCK,count-position);
      const events = position===0 ? [{kind:1,noteId:1,pitch,velocity:velocity/127,offset:0}] : [];
      const outputs = harness.process(frames,{events});
      left.set(outputs[0][0],position); right.set(outputs[0][1],position);
      position += frames;
    }
    const metrics=analyzeStereo(left,right,pitch,{sampleRate:SAMPLE_RATE});
    metrics.outputGuardHits=guardCount===null?null:harness.e.soraoto_supersynth_guard_hit_count()-guardCount;
    return metrics;
  } finally { harness.close(); }
}

function captureMatrix({onProgress=()=>{},pitches=Array.from({length:88},(_,i)=>i+21),velocities=VELOCITIES,parameters={}}={}) {
  const rows=[];
  for (const pitch of pitches) {
    for (const velocity of velocities) rows.push({pitch,velocity,velocityNormalized:velocity/127,metrics:render(pitch,velocity,parameters)});
    onProgress(pitch,rows.length);
  }
  if (rows.length!==pitches.length*velocities.length) throw new Error(`expected ${pitches.length*velocities.length} render cases, got ${rows.length}`);
  const wasmBuildRoot=process.env.SORAOTO_WASM_BUILD_DIR?path.resolve(process.env.SORAOTO_WASM_BUILD_DIR):path.join(REPO,'build','wasm');
  const wasmPath=path.join(wasmBuildRoot,WASM);
  const wasmSha256=crypto.createHash('sha256').update(fs.readFileSync(wasmPath)).digest('hex');
  const sourceRevision=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
  const sourcePath=path.join(REPO,'wasm/plugins/dsp/super-synth/src/plugin.c');
  const fitHeaderPath=path.join(REPO,'wasm/plugins/dsp/super-synth/src/grand_physics_fit_v9.h');
  const fitHeaderText=fs.readFileSync(fitHeaderPath,'utf8');
  const scaleMatch=fitHeaderText.match(/#define GRAND_FIT_BOARD_RADIATION_SCALE ([0-9.+-eE]+)f/);
  if(!scaleMatch)throw new Error('fit header is missing GRAND_FIT_BOARD_RADIATION_SCALE');
  const boardRadiationScale=Number(scaleMatch[1]);
  const sourcePluginSha256=crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  const fitHeaderSha256=crypto.createHash('sha256').update(fs.readFileSync(fitHeaderPath)).digest('hex');
  const sourceTreeDirty=Boolean(execFileSync('rtk',['git','status','--porcelain','--',path.relative(REPO,sourcePath),path.relative(REPO,fitHeaderPath)],{cwd:REPO,encoding:'utf8'}).trim());
  return {schemaVersion:2,render:{pluginId:'net.puchinya.soraotodsl.super-synth-v8',pluginName:'SuperSynth v9',pluginVersion:'9.0.0',preset:'concert_grand',sampleRate:SAMPLE_RATE,durationMs:DURATION_MS,velocityRepresentatives:velocities,pianoHammerHardness:parameters.piano_hammer_hardness??CONCERT_GRAND.piano_hammer_hardness,pianoHammerNoise:parameters.piano_hammer_noise??CONCERT_GRAND.piano_hammer_noise,sourceWasm:path.relative(REPO,wasmPath),wasmBuildRoot,sourceRevision,sourceTreeDirty,sourcePluginSha256,fitHeaderSha256,boardRadiationScale,wasmSha256,soundboardBypassed:parameters.piano_soundboard_mix===0,parameterOverrides:{...parameters}},matrix:rows};
}

function main() {
  const {output,pitches,velocities,parameters} = parseArgs(process.argv.slice(2));
  const started = performance.now();
  const result=captureMatrix({pitches,velocities,parameters,onProgress:(pitch,count)=>process.stderr.write(`rendered MIDI ${pitch} (${count}/${pitches.length*velocities.length})\n`)});
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const temp=`${output}.tmp-${process.pid}`;
  fs.writeFileSync(temp,`${JSON.stringify(result,null,2)}\n`);
  fs.renameSync(temp,output);
  const elapsedSeconds=(performance.now()-started)/1000;
  const selected=new Set(pitches),pitchPairs=new Set();for(const p of pitches)if(selected.has(p+1))pitchPairs.add(p);
  console.log(JSON.stringify({output,cases:result.matrix.length,adjacentComparisons:pitchPairs.size*velocities.length,totalOutputGuardHits:result.matrix.reduce((sum,row)=>sum+(row.metrics.outputGuardHits||0),0),maximumOutputGuardHitsPerCell:Math.max(0,...result.matrix.map(row=>row.metrics.outputGuardHits||0)),elapsedSeconds:+elapsedSeconds.toFixed(2)}));
}

if (require.main===module) {
  try { main(); }
  catch (error) { console.error(`ERROR: ${error.stack||error.message}`); process.exitCode=1; }
}
module.exports={captureMatrix,VELOCITIES,SAMPLE_RATE,DURATION_MS};
