'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const execFileSync=require('node:child_process').execFileSync;
const durable=require('./durable-evidence.cjs');
const requalify=require('./run-stage3e-historical-reference-requalification.cjs');

function mkroot(){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-requal-test-'));const root=path.join(temp,'repo');fs.mkdirSync(root);execFileSync('rtk',['git','init','--quiet'],{cwd:root});return {temp,root};}
function fakeSourceIdentity(){return {production:{candidateId:requalify.CANDIDATE_ID,sourceRevision:requalify.PRODUCTION_REVISION,presetsSha256:requalify.PRESETS_SHA256,profileSha256:requalify.PROFILE_SHA256,referenceFixtureSha256:requalify.FIXTURE_SHA256,configSha256:requalify.CONFIG_SHA256},stage3a:{sourceRevision:requalify.STAGE3A_REVISION,diagnosticWasmSha256:requalify.STAGE3A_WASM_SHA256},captureHelper:{sourceRevision:requalify.CAPTURE_HELPER_REVISION,sha256:requalify.CAPTURE_HELPER_SHA256,presetsSha256:requalify.PRESETS_SHA256,profileSha256:requalify.PROFILE_SHA256,referenceFixtureSha256:requalify.FIXTURE_SHA256}};}
function stage3aMetrics(velocityNormalized){const index=requalify.STAGE3A_CELLS.findIndex(row=>row.velocityNormalized===velocityNormalized);return {finite:true,peakDbfs:-8,fullRenderPeakDbfs:-7,outputGuardHits:0,stage2mFactorMask:3,velocityDerivative:requalify.DERIVATIVE_EXPECTED[index],velocityDerivativeWindowMs:[30,180],stage2mHammer:{effectiveHardness:1,initialHammerVelocity:2,contactDurationSamples:3,peakForce:4,maxCompression:5,postContactTransverseEnergy:6},soundboardDiagnostics:{frames:10,signals:{bridge_b:{rms:.1,peak:.2}}}};}

assert.deepEqual(requalify.cmakeOptionArgs({SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'ON',BUILD_TESTING:'OFF'}),['-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON','-DBUILD_TESTING=OFF']);

{
  assert.equal(requalify.AUTHORIZED_CELLS.length,12);
  assert.equal(requalify.PRODUCTION_CELLS.length,9);
  assert.equal(requalify.STAGE3A_CELLS.length,3);
  assert.equal(new Set(requalify.exactCellList().map(requalify.cellKey)).size,12);
  assert.deepEqual(requalify.assertAuthorizedCells(requalify.AUTHORIZED_CELLS).map(x=>x.key),requalify.exactCellList().map(x=>x.key));
  assert.throws(()=>requalify.assertAuthorizedCells([...requalify.AUTHORIZED_CELLS.slice(0,11),requalify.AUTHORIZED_CELLS[0]]),/duplicate|mismatch/);
  assert.throws(()=>requalify.assertAuthorizedCells(requalify.AUTHORIZED_CELLS.slice(0,11)),/exactly 12/);
}

{
  const candidate=Buffer.from('{"concert_grand":{"engine_config":{"soundboard":{"radiation_scale":1}},"name":"Concert Grand"}}\n');
  const historical=Buffer.from('{\n  "concert_grand": {\n    "name": "Concert Grand",\n    "engine_config": {"soundboard": {"radiation_scale": 1}}\n  }\n}\n');
  assert.doesNotThrow(()=>requalify.assertCandidateConfigMatchesSource(candidate,historical,'test source'),
    'candidate config digest input may differ in formatting but must have the exact historical preset values');
  assert.notEqual(requalify.sha256(candidate),requalify.sha256(historical),
    'the Stage2Q candidate config SHA identifies its exact source bytes, separately from the historical preset file SHA');
  assert.throws(()=>requalify.assertCandidateConfigMatchesSource(candidate,Buffer.from('{"concert_grand":{"name":"Other"}}'),'test source'),
    /STAGE2Q_CONFIG_EVIDENCE/);
}

{
  const rows=[...requalify.PRODUCTION_CELLS,...requalify.STAGE3A_CELLS];
  for(const cell of rows){
    const metrics=cell.kind==='stage3a'?stage3aMetrics(cell.velocityNormalized):{finite:true,peakDbfs:-9,fullRenderPeakDbfs:-8};
    assert.equal(requalify.validateMetrics(cell,metrics),metrics);
  }
  const stage3a=requalify.STAGE3A_CELLS[1];
  assert.throws(()=>requalify.validateMetrics(stage3a,{...stage3aMetrics(stage3a.velocityNormalized),velocityDerivativeWindowMs:[0,160]}),/HISTORICAL_STAGE3A_WINDOW/);
  assert.throws(()=>requalify.validateMetrics(stage3a,{...stage3aMetrics(stage3a.velocityNormalized),velocityDerivative:requalify.DERIVATIVE_EXPECTED[1]+2e-6}),/HISTORICAL_STAGE3A_DERIVATIVE/);
  assert.throws(()=>requalify.validateMetrics(stage3a,{...stage3aMetrics(stage3a.velocityNormalized),outputGuardHits:1}),/HISTORICAL_STAGE3A_SAFETY/);
  assert.throws(()=>requalify.validateMetrics(requalify.PRODUCTION_CELLS[0],{finite:true,peakDbfs:0,fullRenderPeakDbfs:-1}),/HISTORICAL_REFERENCE_SAFETY/);
  assert.throws(()=>requalify.validateMetrics(requalify.PRODUCTION_CELLS[0],{finite:true,peakDbfs:-1,fullRenderPeakDbfs:-1,bad:NaN}),/non-finite/);
}

{
  const {temp,root}=mkroot();
  try{
    fs.mkdirSync(path.join(root,'wasm/plugins/dsp/super-synth/test/tools'),{recursive:true});
    fs.writeFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-historical-reference-requalification.cjs'),'test runner');
    const state=path.join(temp,'common/soraoto-agent-state/issues/7/stage3e',requalify.EXECUTION_ID);
    const archive=path.join(temp,'home/.soraoto-agent-archive/soraoto_dsl/7/stage3e',requalify.EXECUTION_ID);
    const result=requalify.run({mode:'--dry-run',root,home:path.join(temp,'home'),validateSources:()=>fakeSourceIdentity(),rootsFactory:()=>({primary:state,secondary:archive})});
    assert.equal(result.builds,0);assert.equal(result.renders,0);assert.equal(result.authorizedRenderCount,12);assert.equal(result.authorizedCells.length,12);
    assert.equal(result.historicalSourceIdentities.captureHelper.sourceRevision,requalify.CAPTURE_HELPER_REVISION);
    assert.equal(result.historicalSourceIdentities.captureHelper.sha256,requalify.CAPTURE_HELPER_SHA256);
    assert.equal(fs.existsSync(state),false,'dry-run must create no evidence directory or file');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

{
  const {temp,root}=mkroot();
  try{
    const rootsSet={primary:path.join(temp,'primary'),secondary:path.join(temp,'secondary')};
    fs.mkdirSync(rootsSet.primary,{recursive:true});fs.mkdirSync(rootsSet.secondary,{recursive:true});
    const identity={candidateId:requalify.CANDIDATE_ID,productionRevision:requalify.PRODUCTION_REVISION,stage3aRevision:requalify.STAGE3A_REVISION,executionSourceRevision:'checkpoint',runnerSha256:'a'.repeat(64),authorizedCells:requalify.exactCellList()};
    const ledger=requalify.freshLedger(identity);ledger.startedAt='2026-10-08T00:00:00.000Z';
    for(const row of requalify.exactCellList()){
      const metrics=row.kind==='stage3a'?stage3aMetrics(row.velocityNormalized):{finite:true,peakDbfs:-8,fullRenderPeakDbfs:-7};
      const doc={schemaVersion:1,cellKey:row.key,identity,row,metrics,capturedAt:ledger.startedAt};
      const body={...doc};doc.rowSha256=requalify.sha256(requalify.canonicalBytes(body));
      const saved=durable.writeDualCopy(path.join(rootsSet.primary,`cells/${row.key}.json`),path.join(rootsSet.secondary,`cells/${row.key}.json`),JSON.stringify(doc,null,2)+'\n');
      ledger.cells[row.key]={...ledger.cells[row.key],state:'COMPLETE',sha256:saved.sha256,rowSha256:doc.rowSha256,renderObserved:true,completedAt:ledger.startedAt};ledger.accounting.newRenderCalls++;
    }
    durable.writeDualCopy(path.join(rootsSet.primary,'ledger.json'),path.join(rootsSet.secondary,'ledger.json'),JSON.stringify(ledger,null,2)+'\n');
    const finalized=requalify.finalize({root,rootsSet,ledger,now:()=>ledger.startedAt});
    assert.equal(finalized.result.decision,'STAGE3E_HISTORICAL_REFERENCE_REQUALIFIED');
    assert.equal(finalized.result.rows.length,12);assert.equal(finalized.result.acousticRenderCalls,12);assert.equal(finalized.renderCalls,0);
    const replay=requalify.finalize({root,rootsSet,ledger,now:()=>ledger.startedAt});
    assert.equal(replay.idempotent,true);assert.equal(replay.sha256,finalized.sha256);assert.equal(replay.renderCalls,0);
    assert(durable.verifyDualCopy(path.join(rootsSet.primary,'evidence-manifest.json'),path.join(rootsSet.secondary,'evidence-manifest.json')));
    assert(durable.verifyDualCopy(path.join(rootsSet.primary,'archives/historical-reference-requalification.tar.gz'),path.join(rootsSet.secondary,'archives/historical-reference-requalification.tar.gz')));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

console.log('PASS Stage3E historical-reference authorization, safety, dry-run, dual-copy finalization and replay');
