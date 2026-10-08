'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const master=require('./run-stage3e-master-orchestrator.cjs');

function fakeAdapters(overrides={}){
  const calls=[];
  const adapters={
    preflight:()=>{calls.push('preflight');return {decision:'READY'};},
    stage3eDryRun:()=>{calls.push('stage3eDryRun');return {decision:'READY',builds:0,renders:0,acousticRenders:0,evidenceWrites:0};},
    low:()=>{calls.push('low');return {decision:'STAGE3E_LOW_RESPONSE_FAMILY_PASS'};},
    mid:()=>{calls.push('mid');return {decision:'STAGE3E_MID_RESPONSE_FAMILY_PASS'};},
    selection:()=>{calls.push('selection');return {decision:'STAGE3E_SELECTION_READY_FOR_PRODUCTION_PREFLIGHT',selection:{selected:{low:.8,mid:.9,bassHardness:1.1}}};},
    promoteAndRegress:()=>{calls.push('promoteAndRegress');return {regressionDecision:'PASS',regressionResultsPath:'/tmp/focused-regressions.json'};},
    commitSelectedValues:()=>{calls.push('commitSelectedValues');return {commit:'a'.repeat(40)};},
    productionBuild:()=>{calls.push('productionBuild');return {stage3eExportsPresent:false};},
    stage3DryRun:()=>{calls.push('stage3DryRun');return {decision:'READY',builds:0,renders:0,acousticRenders:0,authorizedRenderCount:486};},
    stage3Execute:()=>{calls.push('stage3Execute');return {decision:'STAGE3_CAPTURE_IN_PROGRESS',renders:486};},
    stage3Finalize:()=>{calls.push('stage3Finalize');return {decision:'STAGE3_READY_FOR_STAGE4'};},
    stage4DryRun:()=>{calls.push('stage4DryRun');return {decision:'READY',builds:0,renders:0,acousticRenders:0,authorizedRenderCount:1423};},
    stage4Execute:()=>{calls.push('stage4Execute');return {decision:'STAGE4_CAPTURE_IN_PROGRESS',renders:1423};},
    stage4Finalize:()=>{calls.push('stage4Finalize');return {decision:'STAGE4_FULL_RANGE_COMPLETE'};},
    fullVerification:()=>{calls.push('fullVerification');return {decision:'PASS'};},
    reviewHandoff:()=>{calls.push('reviewHandoff');return {decision:'ISSUE_7_PHASE_REVIEW'};}
  };
  return {calls,adapters:{...adapters,...overrides}};
}

function testDryRunIsReadOnlyAndStopsBeforeAnyExecution(){
  const {calls,adapters}=fakeAdapters();
  const result=master.runPipeline({mode:'--dry-run',adapters});
  assert.equal(result.decision,'STAGE3E_MASTER_DRY_RUN_READY');
  assert.equal(result.renders,0);assert.equal(result.builds,0);assert.equal(result.evidenceWrites,0);
  assert.deepEqual(calls,['preflight','stage3eDryRun']);
}
function testDryRunDoesNotReturnMutableLedgerPayload(){
  const {adapters}=fakeAdapters({stage3eDryRun:()=>({decision:'READY',builds:0,renders:0,acousticRenders:0,evidenceWrites:0,
    ledger:{cells:Array.from({length:1512},()=>({state:'PENDING'}))}})});
  const result=master.runPipeline({mode:'--dry-run',adapters});
  assert.equal(result.decision,'STAGE3E_MASTER_DRY_RUN_READY');
  assert.equal(result.stage3e.ledger,undefined);
  assert.equal(result.evidenceWrites,0);
}
function testHappyPathGatesEveryPhaseAndReachesReview(){
  const {calls,adapters}=fakeAdapters();
  const result=master.runPipeline({mode:'--execute',adapters});
  assert.equal(result.decision,'ISSUE_7_PHASE_REVIEW');
  assert.deepEqual(calls,['preflight','stage3eDryRun','low','mid','selection','promoteAndRegress','commitSelectedValues',
    'productionBuild','stage3DryRun','stage3Execute','stage3Finalize','stage4DryRun','stage4Execute','stage4Finalize','fullVerification','reviewHandoff']);
}
function testNoEligibleLowStopsBeforeMidOrLater(){
  const {calls,adapters}=fakeAdapters({low:()=>{calls.push('low');throw new Error('BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY');}});
  assert.throws(()=>master.runPipeline({mode:'--execute',adapters}),/BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY/);
  assert.deepEqual(calls,['preflight','stage3eDryRun','low']);
}
function testStage3FailureNeverStartsStage4(){
  const {calls,adapters}=fakeAdapters({stage3Finalize:()=>{calls.push('stage3Finalize');return {decision:'BLOCKED_STAGE3_DIRECT_REFERENCE'};}});
  assert.throws(()=>master.runPipeline({mode:'--execute',adapters}),/BLOCKED_STAGE3_DIRECT_REFERENCE/);
  assert.equal(calls.includes('stage4Execute'),false);assert.equal(calls.includes('reviewHandoff'),false);
}
function testStage4FailureNeverStartsReview(){
  const {calls,adapters}=fakeAdapters({stage4Finalize:()=>{calls.push('stage4Finalize');return {decision:'BLOCKED_STAGE4_LIFECYCLE'};}});
  assert.throws(()=>master.runPipeline({mode:'--execute',adapters}),/BLOCKED_STAGE4_LIFECYCLE/);
  assert.equal(calls.includes('reviewHandoff'),false);
}
function testMissingPreflightExportBlocksBeforeAnyPhase(){
  const {calls,adapters}=fakeAdapters();delete adapters.preflight;
  assert.throws(()=>master.runPipeline({mode:'--execute',adapters}),/BLOCKED_STAGE3E_MASTER_API: preflight is not a function/);
  assert.deepEqual(calls,[]);
}
function testRealDependencyExportsAreImportable(){
  assert.equal(master.requirePreflightExports(),undefined);
}
function testWrongRenderBudgetsFailClosed(){
  const {calls,adapters}=fakeAdapters({stage3Execute:()=>{calls.push('stage3Execute');return {renders:485};}});
  assert.throws(()=>master.runPipeline({mode:'--execute',adapters}),/spend exactly 486 calls/);
  assert.equal(calls.includes('stage4DryRun'),false);
}
function testStage3eExportDetection(){
  assert.deepEqual(master.stage3eExportNames(['memory','soraoto_supersynth_stage3e_get_low','soraoto_supersynth_get_voice_count']),
    ['soraoto_supersynth_stage3e_get_low']);
}
function testExclusiveMasterLockFailsClosed(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-master-lock-'));
  try{
    const first=master.acquireMasterExecutionLock(root,{pid:1,identity:'first'});
    assert.throws(()=>master.acquireMasterExecutionLock(root,{pid:2,identity:'second'}),/BLOCKED_STAGE3E_MASTER_WRITER_LOCK/);
    first.release();
    const stalePath=path.join(root,'stage3e-master-execution.lock');fs.writeFileSync(stalePath,'stale');
    assert.throws(()=>master.acquireMasterExecutionLock(root,{pid:3,identity:'third'}),/BLOCKED_STAGE3E_MASTER_WRITER_LOCK/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

for(const test of [testDryRunIsReadOnlyAndStopsBeforeAnyExecution,testHappyPathGatesEveryPhaseAndReachesReview,
  testDryRunDoesNotReturnMutableLedgerPayload,testNoEligibleLowStopsBeforeMidOrLater,testStage3FailureNeverStartsStage4,
  testStage4FailureNeverStartsReview,testMissingPreflightExportBlocksBeforeAnyPhase,testRealDependencyExportsAreImportable,
  testWrongRenderBudgetsFailClosed,testStage3eExportDetection,testExclusiveMasterLockFailsClosed])test();
process.stdout.write('Stage3E master-orchestrator tests passed\n');
