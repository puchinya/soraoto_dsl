'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const capture=require('./capture-supersynth-stage3e-matrix.cjs');
const stage3d=require('./capture-supersynth-stage3d-matrix.cjs');

function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-preflight-'));
  const build=path.join(dir,'build');fs.mkdirSync(build);
  const flags={SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'ON',SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'ON',
    SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',
    SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'ON'};
  fs.writeFileSync(path.join(build,'CMakeCache.txt'),Object.entries(flags).map(([k,v])=>`${k}:BOOL=${v}`).join('\n')+'\n');
  const old=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=build;
  let response={low:1,mid:1,bassHardness:1};
  const e={
    soraoto_supersynth_guard_hit_count:()=>0,
    soraoto_supersynth_stage2m_set_factor_mask:v=>v===3?0:-1,
    soraoto_supersynth_stage2m_get_factor_mask:()=>3,
    soraoto_supersynth_stage2m_hammer_diag_reset:()=>{},
    soraoto_supersynth_stage2m_hammer_diag_value:()=>0,
    soraoto_supersynth_stage3e_set_velocity_response:(l,m,h)=>{if(![l,m,h].every(Number.isFinite)||l<.35||l>1||m<.35||m>1||h<0||h>2)return -1;response={low:l,mid:m,bassHardness:h};return 0;},
    soraoto_supersynth_stage3e_get_low:()=>response.low,soraoto_supersynth_stage3e_get_mid:()=>response.mid,
    soraoto_supersynth_stage3e_get_bass_hardness:()=>response.bassHardness,
  };
  let closed=false;
  return {dir,build,old,e,get closed(){return closed;},restore(){if(old===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=old;fs.rmSync(dir,{recursive:true,force:true});},factory:()=>({e,close(){closed=true;}})};
}
function stage3dDerivative(samples,startSeconds,endSeconds){
  let squareDelta=0,squareSignal=0,count=0;
  for(let i=Math.max(1,Math.floor(startSeconds*capture.SAMPLE_RATE));i<Math.min(samples.length,Math.floor(endSeconds*capture.SAMPLE_RATE));i++){
    const delta=samples[i]-samples[i-1];squareDelta+=delta*delta;squareSignal+=samples[i]*samples[i];count++;
  }
  return Math.sqrt(squareDelta/Math.max(1,count))/Math.max(1e-12,Math.sqrt(squareSignal/Math.max(1,count)));
}

{
  const x=setup();
  try{
    const result=capture.preflightDiagnosticCapabilities({root:x.dir,harnessFactory:x.factory});
    assert.equal(result.passed,true);assert.equal(result.audioProcessCalls,0);assert.equal(result.acousticRenders,0);
    assert.deepEqual(result.stage3eRoundTripValues,[.75,.85,1.5]);assert.deepEqual(result.stage3eResponse,[1,1,1]);assert.equal(x.closed,true);
  }finally{x.restore();}
}
{
  const x=setup();
  try{
    delete x.e.soraoto_supersynth_stage2m_hammer_diag_value;
    assert.throws(()=>capture.preflightDiagnosticCapabilities({root:x.dir,harnessFactory:x.factory}),/BLOCKED_STAGE3E_DIAGNOSTIC_PREFLIGHT/);
  }finally{x.restore();}
}
{
  const x=setup();
  try{
    x.e.soraoto_supersynth_stage3d_set_variant=()=>0;
    assert.throws(()=>capture.preflightDiagnosticCapabilities({root:x.dir,harnessFactory:x.factory}),/mutually-exclusive/);
  }finally{x.restore();}
}
for(const response of [{low:.349,mid:1,bassHardness:1},{low:1,mid:1,bassHardness:2.001},{low:1,mid:NaN,bassHardness:1}])
  assert.throws(()=>capture.requireResponse(response),/approved profile bounds/);
assert.deepEqual(capture.requireResponse({low:1,mid:1,bassHardness:1}),{low:1,mid:1,bassHardness:1});
for(const response of [[1,1,1],{low:1,mid:1},{low:1,mid:1,bassHardness:1,extra:0},null])
  assert.throws(()=>capture.requireResponse(response),/canonical named object|exactly low, mid, and bassHardness/);
assert.throws(()=>capture.validateCaptureRequest(36,.11,[1,1,1],{}),/canonical named object/);
assert.deepEqual(capture.validateCaptureRequest(36,.11,{low:1,mid:1,bassHardness:0},{}),{low:1,mid:1,bassHardness:0});
{
  const left=new Float32Array(capture.SAMPLE_RATE*capture.DURATION_MS/1000);
  for(let i=0;i<left.length;i++)left[i]=Math.sin(i*.031)+.2*Math.sin(i*.127);
  const stage3e=capture.derivative(left,30,180),stage3dValue=stage3dDerivative(left,30/1000,180/1000);
  assert(Math.abs(stage3e-stage3dValue)<=1e-12,`Stage3D derivative parity ${stage3e} vs ${stage3dValue}`);
  const metrics={peakDbfs:-4};
  capture.applyVelocityDerivative(metrics,left,{includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180});
  assert.equal(metrics.peakDbfs,-4);assert.equal(metrics.velocityDerivative,stage3e);assert.deepEqual(metrics.velocityDerivativeWindowMs,[30,180]);
  assert.equal(capture.applyVelocityDerivative({ok:true},left,{includeVelocityDerivative:false}).velocityDerivative,undefined);
  for(const options of [{},{velocityDerivativeStartMs:30,velocityDerivativeEndMs:30},{velocityDerivativeStartMs:NaN,velocityDerivativeEndMs:180},{velocityDerivativeStartMs:-1,velocityDerivativeEndMs:180}])
    assert.throws(()=>capture.velocityDerivativeWindow(options),/window must be supplied explicitly/);
  assert.throws(()=>capture.derivative(new Float32Array(),30,180),/samples are missing/);
  assert.throws(()=>capture.derivative(new Float32Array(100),30,180),/contains no samples/);
  const invalid=left.slice();invalid[2000]=Infinity;
  assert.throws(()=>capture.derivative(invalid,30,180),/samples must be finite/);
  let observed;
  const rows=capture.captureMatrix({rows:[{pitch:41,velocityNormalized:.25,velocityDerivativeWindowMs:[30,180]}],renderCell:(pitch,velocity,response,options)=>{
    observed={pitch,velocity,velocityNormalized:options.velocityNormalized,options};return {pitch,velocity,velocityNormalized:options.velocityNormalized,metrics:{}};
  }});
  assert.equal(observed.pitch,41);assert.equal(observed.velocity,Math.round(.25*127));
  assert.equal(observed.velocityNormalized,.25);assert.deepEqual([observed.options.velocityDerivativeStartMs,observed.options.velocityDerivativeEndMs],[30,180]);
  assert.equal(rows[0].velocityNormalized,.25);
}
{
  let reset=0;
  const e={soraoto_supersynth_soundboard_diag_reset(){reset++;},soraoto_supersynth_soundboard_diag_frames:()=>17760,
    soraoto_supersynth_soundboard_diag_sum_squares:index=>index+1,
    soraoto_supersynth_soundboard_diag_peak:index=>index/10};
  capture.assertSoundboardDiagnostics(e);e.soraoto_supersynth_soundboard_diag_reset();
  const result=capture.readSoundboardDiagnostics(e);
  assert.equal(reset,1);assert.equal(result.frames,17760);
  assert.deepEqual(Object.keys(result.signals),stage3d.SOUNDBOARD_DIAGNOSTIC_NAMES);
  assert.equal(result.signals.bridge_b.rms,Math.sqrt(1/17760));
  assert.equal(result.signals.longitudinal_bridge_drive.peak,1.9);
  assert.throws(()=>capture.readSoundboardDiagnostics({}),/guard-diagnostic exports/);
}
console.log('PASS Stage3E capability preflight and response bounds');
