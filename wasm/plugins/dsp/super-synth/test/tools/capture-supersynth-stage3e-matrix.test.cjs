'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const capture=require('./capture-supersynth-stage3e-matrix.cjs');

function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-preflight-'));
  const build=path.join(dir,'build');fs.mkdirSync(build);
  const flags={SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'ON',SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'ON',
    SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',
    SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'ON'};
  fs.writeFileSync(path.join(build,'CMakeCache.txt'),Object.entries(flags).map(([k,v])=>`${k}:BOOL=${v}`).join('\n')+'\n');
  const old=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=build;
  let response=[1,1,1];
  const e={
    soraoto_supersynth_guard_hit_count:()=>0,
    soraoto_supersynth_stage2m_set_factor_mask:v=>v===3?0:-1,
    soraoto_supersynth_stage2m_get_factor_mask:()=>3,
    soraoto_supersynth_stage2m_hammer_diag_reset:()=>{},
    soraoto_supersynth_stage2m_hammer_diag_value:()=>0,
    soraoto_supersynth_stage3e_set_velocity_response:(l,m,h)=>{if(![l,m,h].every(Number.isFinite)||l<.35||l>1||m<.35||m>1||h<0||h>2)return -1;response=[l,m,h];return 0;},
    soraoto_supersynth_stage3e_get_low:()=>response[0],soraoto_supersynth_stage3e_get_mid:()=>response[1],
    soraoto_supersynth_stage3e_get_bass_hardness:()=>response[2],
  };
  let closed=false;
  return {dir,build,old,e,get closed(){return closed;},restore(){if(old===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=old;fs.rmSync(dir,{recursive:true,force:true});},factory:()=>({e,close(){closed=true;}})};
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
for(const tuple of [[.349,1,1],[1,1,2.001],[1,NaN,1]])assert.throws(()=>capture.requireResponse(tuple),/approved profile bounds/);
assert.deepEqual(capture.requireResponse([1,1,1]),[1,1,1]);
console.log('PASS Stage3E capability preflight and response bounds');
