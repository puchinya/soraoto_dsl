#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
const {analyzeStereo,toneMag,spectrum,peakNearExpected} = require('./salamander-metrics.cjs');
const {estimatePianoPitch,getPianoPitchAnalysisPlan} = require('./piano-pitch-estimator.cjs');

const REPO = path.resolve(__dirname,'../../../../../../');
const WASM = 'plugins/dsp/super-synth/plugin.wasm';
const PRESETS_PATH = path.join(REPO,'wasm/plugins/dsp/super-synth/presets.json');
const PRESETS = JSON.parse(fs.readFileSync(PRESETS_PATH,'utf8'));
const CONCERT_GRAND = PRESETS.concert_grand;
const SAMPLE_RATE = 48000;
const BLOCK = 2048;
const DURATION_MS = 380;
const VELOCITIES = [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const SOUNDBOARD_DIAGNOSTIC_NAMES = [
  'bridge_b','bridge_m','bridge_t','board_drive_b','board_drive_m','board_drive_t',
  'modal_l','modal_r','residual_l','residual_r','pre_radiation_l','pre_radiation_r',
  'post_radiation_l','post_radiation_r','dry_transverse','dry_bridge','dry_contact',
  'dry_longitudinal','dry_mix','longitudinal_bridge_drive'
];

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

function derivative(a, startSeconds, endSeconds) {
  let squareDelta=0, squareSignal=0, count=0;
  for(let i=Math.max(1,Math.floor(startSeconds*SAMPLE_RATE));i<Math.min(a.length,Math.floor(endSeconds*SAMPLE_RATE));i++){
    const delta=a[i]-a[i-1];squareDelta+=delta*delta;squareSignal+=a[i]*a[i];count++;
  }
  return Math.sqrt(squareDelta/Math.max(1,count))/Math.max(1e-12,Math.sqrt(squareSignal/Math.max(1,count)));
}

function render(pitch, velocity, parameters={}, options={}) {
  return renderNormalized(pitch,velocity/127,parameters,options);
}

function renderNormalized(pitch, velocityNormalized, parameters={}, options={}) {
  const harness = new PluginHarness(REPO,WASM,{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});
  try {
    const guardCount=typeof harness.e.soraoto_supersynth_guard_hit_count==='function'?harness.e.soraoto_supersynth_guard_hit_count():null;
    harness.applyPreset('concert_grand');
    for (const [name,value] of [['voice_drift',0],['lfo1_pitch',0],['chorus_mix',0]]) harness.setPlain(name,value);
    for (const [name,value] of Object.entries(parameters)) harness.setPlain(name,value);
    if(options.stage2mFactorMask!==undefined){
      const e=harness.e;
      if(typeof e.soraoto_supersynth_stage2m_set_factor_mask!=='function'
          ||typeof e.soraoto_supersynth_stage2m_get_factor_mask!=='function'
          ||typeof e.soraoto_supersynth_stage2m_hammer_diag_reset!=='function'
          ||typeof e.soraoto_supersynth_stage2m_hammer_diag_value!=='function')
        throw new Error('Stage2M capture requires a test-only Stage2M diagnostic WASM');
      if((e.soraoto_supersynth_stage2m_set_factor_mask(options.stage2mFactorMask)>>>0)!==0)
        throw new Error(`Stage2M factor mask rejected: ${options.stage2mFactorMask}`);
      if((e.soraoto_supersynth_stage2m_get_factor_mask()>>>0)!==options.stage2mFactorMask)
        throw new Error(`Stage2M factor mask did not persist: ${options.stage2mFactorMask}`);
      e.soraoto_supersynth_stage2m_hammer_diag_reset();
    }
    if(options.stage3bVariantMask!==undefined){
      const e=harness.e;
      if(typeof e.soraoto_supersynth_stage3b_set_variant_mask!=='function'
          ||typeof e.soraoto_supersynth_stage3b_get_variant_mask!=='function')
        throw new Error('Stage3B capture requires a test-only Stage3B diagnostic WASM');
      if((e.soraoto_supersynth_stage3b_set_variant_mask(options.stage3bVariantMask)|0)!==0)
        throw new Error(`Stage3B variant mask rejected: ${options.stage3bVariantMask}`);
      if((e.soraoto_supersynth_stage3b_get_variant_mask()>>>0)!==options.stage3bVariantMask)
        throw new Error(`Stage3B variant mask did not persist: ${options.stage3bVariantMask}`);
    }
    if(options.includeSoundboardDiagnostics){
      if(typeof harness.e.soraoto_supersynth_soundboard_diag_reset!=='function'
          ||typeof harness.e.soraoto_supersynth_soundboard_diag_sum_squares!=='function'
          ||typeof harness.e.soraoto_supersynth_soundboard_diag_frames!=='function'){
        throw new Error('soundboard diagnostics require a test WASM built with SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON');
      }
      harness.e.soraoto_supersynth_soundboard_diag_reset();
    }
    const pitchPlan=options.includePitchHealth
      ? getPianoPitchAnalysisPlan(pitch,{sampleRate:SAMPLE_RATE,blockSize:BLOCK,minimumDurationMs:1600})
      : null;
    const analysisCount=Math.floor(SAMPLE_RATE * DURATION_MS / 1000);
    const count=pitchPlan?.requiredFrames??analysisCount;
    const left = new Float32Array(count), right = new Float32Array(count);
    let position = 0,finite=true,fullPeak=0;
    while (position < count) {
      const frames = Math.min(BLOCK,count-position);
      const events = position===0 ? [{kind:1,noteId:1,pitch,velocity:velocityNormalized,offset:0}] : [];
      const outputs = harness.process(frames,{events});
      left.set(outputs[0][0],position); right.set(outputs[0][1],position);
      for(let i=0;i<frames;i++){
        const l=outputs[0][0][i],r=outputs[0][1][i];
        if(!Number.isFinite(l)||!Number.isFinite(r))finite=false;
        fullPeak=Math.max(fullPeak,Math.abs(l),Math.abs(r));
      }
      position += frames;
    }
    const metrics=analyzeStereo(left.subarray(0,analysisCount),right.subarray(0,analysisCount),pitch,{sampleRate:SAMPLE_RATE});
    metrics.finite=finite;
    metrics.fullRenderPeakDbfs=fullPeak>0?20*Math.log10(fullPeak):null;
    if(pitchPlan){
      metrics.pitchMeasurement=estimatePianoPitch(left,right,{sampleRate:SAMPLE_RATE,expectedMidiPitch:pitch,analysisWindows:pitchPlan.windows});
      if(metrics.pitchMeasurement.window_results.some(window=>window.reason==='insufficient-analysis-window')){
        throw new Error(`pitch capture policy failed to provide analysis samples for MIDI ${pitch} at ${pitchPlan.requiredDurationMs} ms`);
      }
      metrics.pitchCapture={durationFrames:count,durationMs:pitchPlan.requiredDurationMs,extensionFrames:count-analysisCount,sampleRate:SAMPLE_RATE,renderBlockFrames:BLOCK,alignmentMarginFrames:pitchPlan.alignmentMarginFrames,windowsMs:pitchPlan.windows};
    }
    if(options.stage2mFactorMask!==undefined){
      const e=harness.e;
      metrics.stage2mFactorMask=options.stage2mFactorMask;
      metrics.stage2mHammer={effectiveHardness:e.soraoto_supersynth_stage2m_hammer_diag_value(0),
        initialHammerVelocity:e.soraoto_supersynth_stage2m_hammer_diag_value(1),
        contactDurationSamples:e.soraoto_supersynth_stage2m_hammer_diag_value(2),
        peakForce:e.soraoto_supersynth_stage2m_hammer_diag_value(3),
        maxCompression:e.soraoto_supersynth_stage2m_hammer_diag_value(4),
        postContactTransverseEnergy:e.soraoto_supersynth_stage2m_hammer_diag_value(5)};
      if(pitch===21){
        const expectedHz=440*2**((pitch-69)/12);
        const onsetIndex=Math.max(0,Math.floor((metrics.onsetMs??0)*SAMPLE_RATE/1000));
        const spec=spectrum(left,right,SAMPLE_RATE,onsetIndex,20,65536);
        if(!spec)throw new Error('Stage2M MIDI21 spectrum window is incomplete');
        const nearPeak=peakNearExpected(spec.magnitude,spec.binHz,expectedHz,100);
        const selectedHz=metrics.pitchMeasurement?.estimated_f0??metrics.pitchMeasurement?.candidate_estimated_f0??null;
        const selectedPeak=selectedHz?peakNearExpected(spec.magnitude,spec.binHz,selectedHz,100):null;
        const config=CONCERT_GRAND.engine_config.string;
        const key=Math.max(0,Math.min(1,(pitch-21)/87));
        const unison=Math.max(0,Math.min(1,CONCERT_GRAND.piano_string_unison
          *Math.max(0,Math.min(1,(pitch-config.unison_activation_start_midi)/config.unison_activation_width_midi))));
        const cents=(config.unison_detune_base_cents+config.unison_detune_amount*unison)
          *(config.unison_detune_key_base+config.unison_detune_key_scale*key);
        const count=pitch<config.one_to_two_string_midi?1:(pitch<config.two_to_three_string_midi?2:3);
        const preparedStringNominalHz=Array.from({length:count},(_,index)=>
          440*2**((pitch+config.unison_offsets[index]*cents/100-69)/12));
      metrics.stage2mPitchProbe={targetMidiFrequency:expectedHz,
          currentEstimatorCents:metrics.pitchMeasurement?.pitch_error_cents??null,
          currentEstimatorSelectedFrequency:selectedHz,
          constrainedNearFundamentalFrequency:nearPeak?.hz??null,
          constrainedNearFundamentalCents:nearPeak?1200*Math.log2(nearPeak.hz/expectedHz):null,
          estimatorSelectedPeakAmplitude:selectedPeak?.amplitude??null,
          constrainedNearFundamentalAmplitude:nearPeak?.amplitude??null,
          selectedToConstrainedAmplitudeRatio:selectedPeak&&nearPeak?selectedPeak.amplitude/Math.max(1e-30,nearPeak.amplitude):null,
          preparedStringNominalHz};
    }
    if(options.stage3bVariantMask!==undefined)metrics.stage3bVariantMask=options.stage3bVariantMask;
    }
    if(options.includeNearFundamentalProbe&&pitch===21){
      const expectedHz=440*2**((pitch-69)/12);
      const onsetIndex=Math.max(0,Math.floor((metrics.onsetMs??0)*SAMPLE_RATE/1000));
      const spec=spectrum(left,right,SAMPLE_RATE,onsetIndex,20,65536);
      if(!spec)throw new Error('near-fundamental probe spectrum window is incomplete');
      const nearPeak=peakNearExpected(spec.magnitude,spec.binHz,expectedHz,100);
      if(!nearPeak)throw new Error('near-fundamental probe did not find an expected-f0 peak');
      metrics.nearFundamentalProbe={targetMidiFrequency:expectedHz,
        frequencyHz:nearPeak.hz,
        cents:1200*Math.log2(nearPeak.hz/expectedHz),
        amplitude:nearPeak.amplitude,
        estimatorCents:metrics.pitchMeasurement?.pitch_error_cents??null};
    }
    if(options.includePitchSparsity){
      const f0=261.625565;
      const h1=toneMag(left,f0,.08,.65,SAMPLE_RATE),h2=toneMag(left,f0*2,.08,.65,SAMPLE_RATE),h3=toneMag(left,f0*3,.08,.65,SAMPLE_RATE);
      metrics.harmonicSparsity={h1,h2,h3,h2ToH1:h2/Math.max(1e-12,h1),h3ToH1:h3/Math.max(1e-12,h1),minimumH2ToH1:.12,minimumH3ToH1:.05};
    }
    if(options.includeLowRegisterBuzz)metrics.lowRegisterBuzz=derivative(left,.05,.25);
    if(options.includeVelocityDerivative){
      const startMs=Number.isFinite(options.velocityDerivativeStartMs)?options.velocityDerivativeStartMs:0;
      const endMs=Number.isFinite(options.velocityDerivativeEndMs)?options.velocityDerivativeEndMs:160;
      if(startMs<0||endMs<=startMs)throw new Error('invalid velocity derivative window');
      metrics.velocityDerivative=derivative(left,startMs/1000,endMs/1000);
      metrics.velocityDerivativeWindowMs=[startMs,endMs];
    }
    metrics.outputGuardHits=guardCount===null?null:harness.e.soraoto_supersynth_guard_hit_count()-guardCount;
    if(options.includeSoundboardDiagnostics){
      const frames=harness.e.soraoto_supersynth_soundboard_diag_frames();
      metrics.soundboardDiagnostics={frames,signals:Object.fromEntries(SOUNDBOARD_DIAGNOSTIC_NAMES.map((name,index)=>{
        const sumSquares=harness.e.soraoto_supersynth_soundboard_diag_sum_squares(index);
        return [name,{rms:Math.sqrt(sumSquares/Math.max(1,frames)),peak:harness.e.soraoto_supersynth_soundboard_diag_peak(index)}];
      }))};
    }
    return options.returnSamples?{metrics,left,right}:metrics;
  } finally { harness.close(); }
}

function captureMatrix({onProgress=()=>{},pitches=Array.from({length:88},(_,i)=>i+21),velocities=VELOCITIES,parameters={},includePitchHealth=false,includeSoundboardDiagnostics=false,includeCalibrationDiagnostics=false,includeNearFundamentalProbe=false,stage2mFactorMask=undefined,cells=null}={}) {
  const rows=[];
  const requestedCells=cells??pitches.flatMap(pitch=>velocities.map(velocity=>({pitch,velocity})));
  const seenCells=new Set();
  for (const cell of requestedCells) {
    const {pitch,velocity}=cell;
    if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(velocity)||velocity<=0||velocity>127)throw new Error(`invalid requested matrix cell ${pitch}:${velocity}`);
    const cellKey=`${pitch}:${velocity}`;
    if(seenCells.has(cellKey))throw new Error(`duplicate requested matrix cell ${cellKey}`);
    seenCells.add(cellKey);
    rows.push({pitch,velocity,velocityNormalized:velocity/127,metrics:render(pitch,velocity,parameters,{includePitchHealth,includeSoundboardDiagnostics,includeNearFundamentalProbe,stage2mFactorMask})});
    onProgress(pitch,rows.length);
  }
  if (rows.length!==requestedCells.length) throw new Error(`expected ${requestedCells.length} render cases, got ${rows.length}`);
  let diagnostics;
  if(includeCalibrationDiagnostics){
    const soft=renderNormalized(60,.25,parameters,{includeVelocityDerivative:true});
    const hard=renderNormalized(60,.90,parameters,{includeVelocityDerivative:true,includePitchHealth:true,includePitchSparsity:true});
    const buzz=renderNormalized(29,.55,parameters,{includeLowRegisterBuzz:true});
    diagnostics={
      velocityBrightness:{softVelocity:.25,hardVelocity:.90,softDerivative:soft.velocityDerivative,hardDerivative:hard.velocityDerivative,ratio:hard.velocityDerivative/Math.max(1e-12,soft.velocityDerivative)},
      lowRegisterBuzz:{pitch:29,velocity:.55,value:buzz.lowRegisterBuzz},
      diagnosticRenders:{soft:{peakDbfs:soft.peakDbfs,fullRenderPeakDbfs:soft.fullRenderPeakDbfs,finite:soft.finite,outputGuardHits:soft.outputGuardHits},hard:{peakDbfs:hard.peakDbfs,fullRenderPeakDbfs:hard.fullRenderPeakDbfs,finite:hard.finite,outputGuardHits:hard.outputGuardHits},lowRegisterBuzz:{peakDbfs:buzz.peakDbfs,fullRenderPeakDbfs:buzz.fullRenderPeakDbfs,finite:buzz.finite,outputGuardHits:buzz.outputGuardHits}},
      harmonicSparsity:{...hard.harmonicSparsity,pitchMeasurement:hard.pitchMeasurement,pitchCapture:hard.pitchCapture}
    };
  }
  const wasmBuildRoot=process.env.SORAOTO_WASM_BUILD_DIR?path.resolve(process.env.SORAOTO_WASM_BUILD_DIR):path.join(REPO,'build','wasm');
  const wasmPath=path.join(wasmBuildRoot,WASM);
  const wasmSha256=crypto.createHash('sha256').update(fs.readFileSync(wasmPath)).digest('hex');
  const sourceRevision=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
  const sourcePath=path.join(REPO,'wasm/plugins/dsp/super-synth/src/plugin.c');
  const boardRadiationScale=Number(CONCERT_GRAND.engine_config?.soundboard?.radiation_scale);
  if(!Number.isFinite(boardRadiationScale))throw new Error('concert_grand preset is missing soundboard.radiation_scale');
  const hammerForceScale=Number(CONCERT_GRAND.engine_config?.hammer?.force_scale);
  if(!Number.isFinite(hammerForceScale))throw new Error('concert_grand preset is missing hammer.force_scale');
  const calibrationConfig=JSON.parse(JSON.stringify(CONCERT_GRAND));
  delete calibrationConfig.engine_config.soundboard.radiation_scale;
  const calibrationConfigSha256=crypto.createHash('sha256').update(JSON.stringify(calibrationConfig)).digest('hex');
  const sourcePluginSha256=crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  const presetConfigSha256=crypto.createHash('sha256').update(fs.readFileSync(PRESETS_PATH)).digest('hex');
  const sourceTreeDirty=Boolean(execFileSync('rtk',['git','status','--porcelain','--',path.relative(REPO,sourcePath),path.relative(REPO,PRESETS_PATH)],{cwd:REPO,encoding:'utf8'}).trim());
  const pitchWindowPolicy=includePitchHealth?Object.fromEntries([...new Set(rows.map(row=>row.pitch))].map(pitch=>[pitch,getPianoPitchAnalysisPlan(pitch,{sampleRate:SAMPLE_RATE,blockSize:BLOCK,minimumDurationMs:1600})])):undefined;
  return {schemaVersion:2,render:{pluginId:'net.puchinya.soraotodsl.super-synth-v8',pluginName:'SuperSynth v9',pluginVersion:'9.0.0',preset:'concert_grand',sampleRate:SAMPLE_RATE,durationMs:DURATION_MS,pitchWindowPolicy,velocityRepresentatives:velocities,pianoHammerHardness:parameters.piano_hammer_hardness??CONCERT_GRAND.piano_hammer_hardness,pianoHammerNoise:parameters.piano_hammer_noise??CONCERT_GRAND.piano_hammer_noise,hammerForceScale,calibrationConfigSha256,sourceWasm:path.relative(REPO,wasmPath),wasmBuildRoot,sourceRevision,sourceTreeDirty,sourcePluginSha256,presetConfigSha256,boardRadiationScale,wasmSha256,soundboardBypassed:parameters.piano_soundboard_mix===0,parameterOverrides:{...parameters}},matrix:rows,...(diagnostics?{diagnostics}:{})};
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
module.exports={captureMatrix,VELOCITIES,SAMPLE_RATE,DURATION_MS,render,renderNormalized,SOUNDBOARD_DIAGNOSTIC_NAMES};
