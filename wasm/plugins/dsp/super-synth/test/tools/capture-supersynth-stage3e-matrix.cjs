#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PluginHarness}=require('../../../../../test/helpers/plugin-harness.cjs');
const {analyzeStereo}=require('./salamander-metrics.cjs');
const {SOUNDBOARD_DIAGNOSTIC_NAMES}=require('./capture-supersynth-stage3d-matrix.cjs');

const REPO=path.resolve(__dirname,'../../../../../../');
const WASM='plugins/dsp/super-synth/plugin.wasm';
const SAMPLE_RATE=48000;
const BLOCK=2048;
const DURATION_MS=380;
const STAGE2M_EXPORTS=[
  'soraoto_supersynth_stage2m_set_factor_mask','soraoto_supersynth_stage2m_get_factor_mask',
  'soraoto_supersynth_stage2m_hammer_diag_reset','soraoto_supersynth_stage2m_hammer_diag_value',
];
const STAGE3E_EXPORTS=[
  'soraoto_supersynth_stage3e_set_velocity_response','soraoto_supersynth_stage3e_get_low',
  'soraoto_supersynth_stage3e_get_mid','soraoto_supersynth_stage3e_get_bass_hardness',
];
const FORBIDDEN_EXPORTS=[
  'soraoto_supersynth_stage3b_set_variant_mask','soraoto_supersynth_stage3c_set_variant_mask',
  'soraoto_supersynth_stage3d_set_variant',
];
const REQUIRED_GUARD_EXPORTS=['soraoto_supersynth_guard_hit_count'];

function buildRoot(root=REPO){return process.env.SORAOTO_WASM_BUILD_DIR?path.resolve(process.env.SORAOTO_WASM_BUILD_DIR):path.join(root,'build/wasm-stage3e');}
function assertDiagnosticMode(root=REPO){
  const cache=path.join(buildRoot(root),'CMakeCache.txt');
  if(!fs.existsSync(cache))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_PREFLIGHT: Stage3E CMake cache is missing');
  const text=fs.readFileSync(cache,'utf8');
  for(const [key,want] of Object.entries({
    SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'ON',SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'ON',
    SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',
    SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'ON',
  })){
    const match=text.match(new RegExp(`^${key}:BOOL=(.*)$`,'m'));
    if(!match||match[1]!==want)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_PREFLIGHT: ${key} must be ${want}`);
  }
  return cache;
}
function preflightDiagnosticCapabilities({root=REPO,harnessFactory=(R,file,options)=>new PluginHarness(R,file,options)}={}){
  assertDiagnosticMode(root);
  const harness=harnessFactory(root,WASM,{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});
  try{
    const e=harness.e;
    for(const name of [...REQUIRED_GUARD_EXPORTS,...STAGE2M_EXPORTS,...STAGE3E_EXPORTS])if(typeof e[name]!=='function')
      throw new Error(`missing runtime export ${name}`);
    for(const name of FORBIDDEN_EXPORTS)if(name in e)throw new Error(`unexpected mutually-exclusive runtime export ${name}`);
    if((e.soraoto_supersynth_stage2m_set_factor_mask(3)>>>0)!==0||
       (e.soraoto_supersynth_stage2m_get_factor_mask()>>>0)!==3)
      throw new Error('Stage2M factor mask control round-trip failed');
    const requested=[.75,.85,1.5];
    if((e.soraoto_supersynth_stage3e_set_velocity_response(NaN,1,1)|0)===0||
       (e.soraoto_supersynth_stage3e_set_velocity_response(.34,1,1)|0)===0)
      throw new Error('Stage3E setter accepted invalid control values');
    if((e.soraoto_supersynth_stage3e_set_velocity_response(...requested)>>>0)!==0)
      throw new Error('Stage3E response setter rejected valid control values');
    const values=[e.soraoto_supersynth_stage3e_get_low(),e.soraoto_supersynth_stage3e_get_mid(),e.soraoto_supersynth_stage3e_get_bass_hardness()];
    if(values.some((value,index)=>!Number.isFinite(value)||Math.abs(value-requested[index])>1e-7))throw new Error(`Stage3E control round-trip failed: ${values}`);
    if((e.soraoto_supersynth_stage3e_set_velocity_response(1,1,1)>>>0)!==0)throw new Error('Stage3E baseline controls could not be restored');
    return {passed:true,buildRoot:buildRoot(root),audioProcessCalls:0,acousticRenders:0,stage2mFactorMask:3,stage3eRoundTripValues:values,stage3eResponse:[e.soraoto_supersynth_stage3e_get_low(),e.soraoto_supersynth_stage3e_get_mid(),e.soraoto_supersynth_stage3e_get_bass_hardness()]};
  }catch(error){
    throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_PREFLIGHT: ${error.message}`);
  }finally{harness.close();}
}
function requireResponse(values){
  if(!values||typeof values!=='object'||Array.isArray(values))
    throw new Error('Stage3E response must be the canonical named object {low, mid, bassHardness}');
  const keys=Object.keys(values).sort();
  if(keys.length!==3||keys[0]!=='bassHardness'||keys[1]!=='low'||keys[2]!=='mid')
    throw new Error('Stage3E response must contain exactly low, mid, and bassHardness');
  const low=values.low,mid=values.mid,bass=values.bassHardness;
  if(![low,mid,bass].every(Number.isFinite)||low<0.35||low>1||mid<0.35||mid>1||bass<0||bass>2)
    throw new Error('Stage3E response tuple is outside approved profile bounds');
  return {low,mid,bassHardness:bass};
}
function assertSoundboardDiagnostics(e){
  const required=['soraoto_supersynth_soundboard_diag_reset','soraoto_supersynth_soundboard_diag_sum_squares',
    'soraoto_supersynth_soundboard_diag_peak','soraoto_supersynth_soundboard_diag_frames'];
  const missing=required.filter(name=>typeof e?.[name]!=='function');
  if(missing.length)throw new Error(`Stage3E soundboard diagnostics require guard-diagnostic exports: ${missing.join(', ')}`);
}
function readSoundboardDiagnostics(e){
  assertSoundboardDiagnostics(e);
  const frames=e.soraoto_supersynth_soundboard_diag_frames();
  if(!Number.isInteger(frames)||frames<=0)throw new Error('Stage3E soundboard diagnostic frame count is invalid');
  return {frames,signals:Object.fromEntries(SOUNDBOARD_DIAGNOSTIC_NAMES.map((name,index)=>[
    name,{rms:Math.sqrt(e.soraoto_supersynth_soundboard_diag_sum_squares(index)/frames),peak:e.soraoto_supersynth_soundboard_diag_peak(index)},
  ]))};
}
function velocityDerivativeWindow(options={}){
  const startMs=options.velocityDerivativeStartMs,endMs=options.velocityDerivativeEndMs;
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<=startMs)
    throw new Error('Stage3E velocity derivative window must be supplied explicitly and be valid');
  return [startMs,endMs];
}
function derivative(left,startMs,endMs){
  if(!left||!Number.isInteger(left.length)||left.length===0)throw new Error('Stage3E velocity derivative samples are missing');
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<=startMs)
    throw new Error('Stage3E velocity derivative window must be supplied explicitly and be valid');
  const startIndex=Math.max(1,Math.floor(startMs/1000*SAMPLE_RATE));
  const endIndex=Math.min(left.length,Math.floor(endMs/1000*SAMPLE_RATE));
  if(endIndex<=startIndex)throw new Error('Stage3E velocity derivative window contains no samples');
  let squareDelta=0,squareSignal=0,count=0;
  for(let i=startIndex;i<endIndex;i++){
    const current=left[i],previous=left[i-1];
    if(!Number.isFinite(current)||!Number.isFinite(previous))throw new Error('Stage3E velocity derivative samples must be finite');
    const delta=current-previous;squareDelta+=delta*delta;squareSignal+=current*current;count++;
  }
  const value=Math.sqrt(squareDelta/Math.max(1,count))/Math.max(1e-12,Math.sqrt(squareSignal/Math.max(1,count)));
  if(!Number.isFinite(value))throw new Error('Stage3E velocity derivative is non-finite');
  return value;
}
function applyVelocityDerivative(metrics,left,options={}){
  if(options.includeVelocityDerivative!==true)return metrics;
  const [startMs,endMs]=velocityDerivativeWindow(options);
  metrics.velocityDerivative=derivative(left,startMs,endMs);
  metrics.velocityDerivativeWindowMs=[startMs,endMs];
  return metrics;
}
function validateCaptureRequest(pitch,velocityNormalized,response,options={}){
  if(!Number.isInteger(pitch)||pitch<0||pitch>127)throw new Error('Stage3E MIDI pitch must be an integer in [0,127]');
  if(!Number.isFinite(velocityNormalized)||velocityNormalized<0||velocityNormalized>1)throw new Error('Stage3E normalized velocity must be in [0,1]');
  if(options.includeVelocityDerivative)velocityDerivativeWindow(options);
  if(options.includeSoundboardDiagnostics!==undefined&&typeof options.includeSoundboardDiagnostics!=='boolean')
    throw new Error('Stage3E soundboard diagnostic option must be boolean');
  return requireResponse(response);
}
const DEFAULT_RESPONSE=Object.freeze({low:1,mid:1,bassHardness:1});
function render(pitch,velocity,response=DEFAULT_RESPONSE,options={}){return renderNormalized(pitch,options.velocityNormalized??velocity/127,response,options);}
function renderNormalized(pitch,velocityNormalized,response=DEFAULT_RESPONSE,options={}){
  response=validateCaptureRequest(pitch,velocityNormalized,response,options);
  const harness=new PluginHarness(REPO,WASM,{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});
  try{
    const e=harness.e;
    for(const name of [...STAGE2M_EXPORTS,...STAGE3E_EXPORTS])if(typeof e[name]!=='function')throw new Error(`Stage3E diagnostic WASM is missing ${name}`);
    if(options.includeSoundboardDiagnostics)assertSoundboardDiagnostics(e);
    harness.applyPreset('concert_grand');
    for(const [name,value] of [['voice_drift',0],['lfo1_pitch',0],['chorus_mix',0]])harness.setPlain(name,value);
    for(const [name,value] of Object.entries(options.parameters||{}))harness.setPlain(name,value);
    if((e.soraoto_supersynth_stage2m_set_factor_mask(3)>>>0)!==0||(e.soraoto_supersynth_stage2m_get_factor_mask()>>>0)!==3)throw new Error('Stage2M mask 3 unavailable');
    if((e.soraoto_supersynth_stage3e_set_velocity_response(response.low,response.mid,response.bassHardness)|0)!==0)throw new Error('Stage3E response tuple rejected');
    e.soraoto_supersynth_stage2m_hammer_diag_reset();
    if(options.includeSoundboardDiagnostics)e.soraoto_supersynth_soundboard_diag_reset();
    const guardCount=typeof e.soraoto_supersynth_guard_hit_count==='function'?e.soraoto_supersynth_guard_hit_count():null;
    const count=Math.floor(SAMPLE_RATE*DURATION_MS/1000),left=new Float32Array(count),right=new Float32Array(count);
    let offset=0,finite=true,fullPeak=0;
    while(offset<count){
      const frames=Math.min(BLOCK,count-offset);
      const output=harness.process(frames,{events:offset===0?[{kind:1,noteId:1,pitch,velocity:velocityNormalized,offset:0}]:[]})[0];
      left.set(output[0],offset);right.set(output[1],offset);
      for(let i=0;i<frames;i++){
        const l=output[0][i],r=output[1][i];
        if(!Number.isFinite(l)||!Number.isFinite(r))finite=false;
        fullPeak=Math.max(fullPeak,Math.abs(l),Math.abs(r));
      }
      offset+=frames;
    }
    const metrics=analyzeStereo(left,right,pitch,{sampleRate:SAMPLE_RATE});
    applyVelocityDerivative(metrics,left,options);
    metrics.finite=finite;
    metrics.fullRenderPeakDbfs=fullPeak>0?20*Math.log10(fullPeak):null;
    metrics.outputGuardHits=guardCount===null?null:e.soraoto_supersynth_guard_hit_count()-guardCount;
    metrics.stage2mFactorMask=3;
    metrics.stage2mHammer={effectiveHardness:e.soraoto_supersynth_stage2m_hammer_diag_value(0),initialHammerVelocity:e.soraoto_supersynth_stage2m_hammer_diag_value(1),contactDurationSamples:e.soraoto_supersynth_stage2m_hammer_diag_value(2),peakForce:e.soraoto_supersynth_stage2m_hammer_diag_value(3),maxCompression:e.soraoto_supersynth_stage2m_hammer_diag_value(4),postContactTransverseEnergy:e.soraoto_supersynth_stage2m_hammer_diag_value(5)};
    metrics.stage3eVelocityResponse={low:response.low,mid:response.mid,bassHardness:response.bassHardness};
    if(options.includeSoundboardDiagnostics)metrics.soundboardDiagnostics=readSoundboardDiagnostics(e);
    return {pitch,velocity:Math.round(velocityNormalized*127),velocityNormalized,metrics};
  }finally{harness.close();}
}
function captureMatrix({rows,response=DEFAULT_RESPONSE,parameters={},renderCell=render}={}){
  if(!Array.isArray(rows)||rows.length===0)throw new Error('Stage3E capture requires an explicit non-empty cell list');
  return rows.map(row=>{
    const window=row.velocityDerivativeWindowMs;
    const derivativeOptions=window===undefined?{}:{includeVelocityDerivative:true,velocityDerivativeStartMs:window[0],velocityDerivativeEndMs:window[1]};
    const captured=row.velocityNormalized!==undefined
      ?renderCell(row.pitch,Math.round(row.velocityNormalized*127),response,{parameters,velocityNormalized:row.velocityNormalized,...derivativeOptions})
      :renderCell(row.pitch,row.velocity,response,{parameters,...derivativeOptions});
    return {...captured,phase:row.phase||null};
  });
}
function identity(){
  const wasm=path.join(buildRoot(),WASM),source=path.join(REPO,'wasm/plugins/dsp/super-synth/src/plugin.c'),presets=path.join(REPO,'wasm/plugins/dsp/super-synth/presets.json');
  const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return {wasmPath:wasm,wasmSha256:sha(wasm),sourceSha256:sha(source),presetsSha256:sha(presets)};
}
module.exports={REPO,WASM,SAMPLE_RATE,BLOCK,DURATION_MS,STAGE2M_EXPORTS,STAGE3E_EXPORTS,FORBIDDEN_EXPORTS,REQUIRED_GUARD_EXPORTS,buildRoot,assertDiagnosticMode,preflightDiagnosticCapabilities,DEFAULT_RESPONSE,requireResponse,validateCaptureRequest,assertSoundboardDiagnostics,readSoundboardDiagnostics,velocityDerivativeWindow,derivative,applyVelocityDerivative,render,renderNormalized,captureMatrix,identity};
