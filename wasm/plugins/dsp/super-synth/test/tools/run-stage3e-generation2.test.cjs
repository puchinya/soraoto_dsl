'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const durable=require('./durable-evidence.cjs');
const runner=require('./run-stage3e-generation2.cjs');
const legacy=require('./run-stage3e-velocity-response.cjs');
const search=require('./stage3e-search-core.cjs');
const evidenceValidator=require('./stage3e-evidence-validator.cjs');
const captureDefaults=require('./capture-supersynth-stage3e-matrix.cjs');

assert.equal(typeof legacy.preflightDiagnosticCapabilities,'function');

{
  let validated=0,renderCalls=0;
  const capture={...captureDefaults,validateCaptureRequest(pitch,velocity,response,options){
    validated++;return captureDefaults.validateCaptureRequest(pitch,velocity,response,options);
  },renderNormalized(){renderCalls++;throw new Error('audio capture is forbidden in request dry-check');}};
  const counts=runner.validateAuthorizedSearchResponses(capture);
  assert.deepEqual(counts,{lowCount:1512,lowFullCandidateCellCount:10458,midCount:13608,midFullCandidateCellCount:72576});
  assert.equal(validated,98154,'every authorized screen and full-validation request is normalized before capture');
  assert.equal(renderCalls,0,'request dry-check never constructs the audio capture path');
}

{
  const {root,roots}=tempRoots();
  try{
    const target=search.expectedLowScreenCells().find(cell=>cell.key==='low-screen-L1-M1-H0-midi-036-v110');
    assert.ok(target,'the recovered coordinate is an authorized low-screen identity');
    assert.deepEqual(target.response,{low:1,mid:1,bassHardness:0});
    const identity=baseIdentity(),cells=[target],ledger=runner.freshCellLedger('low-screen',identity,cells),phaseRoots={
      primary:path.join(roots.primary,'low'),secondary:path.join(roots.secondary,'low')};
    fs.mkdirSync(phaseRoots.primary,{recursive:true});fs.mkdirSync(phaseRoots.secondary,{recursive:true});
    runner.writeCellState(phaseRoots,ledger);
    const journalRoots={primary:path.join(roots.primary,'ledger-transition-journal'),secondary:path.join(roots.secondary,'ledger-transition-journal')};
    let fakeRenders=0,observed=null;
    const fakeCapture={...captureDefaults,
      render(pitch,velocity,response,options){fakeRenders++;observed={pitch,velocity,response,options};return {metrics:rowMetrics()};},
      renderNormalized(pitch,velocity,response,options){fakeRenders++;observed={pitch,velocity,response,options};return {metrics:rowMetrics()};}};
    const done=runner.capturePhaseRows({roots:phaseRoots,ledger,cells,identity,capture:fakeCapture,journalContext:{journalRoots,
      manifestSha256:'1'.repeat(64),proofSha256:'2'.repeat(64),compatibilitySha256:'3'.repeat(64)},
      identityNow:()=>identity,now:()=> '2026-10-09T00:00:00.000Z'});
    assert.equal(fakeRenders,1,'the real renderOne/helper chain invokes only the deterministic fake');
    assert.deepEqual(observed.response,{low:1,mid:1,bassHardness:0});
    assert.equal(observed.pitch,36);assert.equal(observed.velocity,14/127);
    assert.equal(done.ledger.accounting.renderCalls,1);
    assert.deepEqual(done.counts,{PENDING:0,IN_PROGRESS:0,COMPLETE:1});
    assert.equal(runner.readCompletedRows(phaseRoots,done.ledger,cells)[0].cell.response.bassHardness,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

function tempRoots(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-gen2-runner-'));
  const roots={primary:path.join(root,'primary'),secondary:path.join(root,'secondary')};
  fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});return {root,roots};
}
function baseIdentity(){return {schemaVersion:1,generation:2,executionId:'generation-2',creatorRevision:'a'.repeat(40),candidateId:'stage2n-r3-candidate-01',
  protectedIdentity:{diagnosticWasmSha256:'b'.repeat(64)},referenceSetSha256:'c'.repeat(64),captureHelperSha256:'d'.repeat(64),runnerSha256:'e'.repeat(64),coreSha256:'f'.repeat(64)};}
function rowMetrics(){return {finite:true,outputGuardHits:0,peakDbfs:-12,fullRenderPeakDbfs:-11};}

{
  assert.equal(runner.assertBaselineReferenceIdentity('c'.repeat(64),'c'.repeat(64)),'c'.repeat(64));
  assert.throws(()=>runner.assertBaselineReferenceIdentity('d'.repeat(64),'c'.repeat(64)),/BLOCKED_STAGE3E_BASELINE_REFERENCE_CHANGED/);
}

{
  const {root,roots}=tempRoots();
  try{
    const base=baseIdentity(),identity=runner.phaseIdentity(base,'screen','c'.repeat(64),{authorizedGrid:[{low:1}],screenCoordinates:[{pitch:36,velocity:14}]});
    const cells=runner.cellSpecs('screen',[{pitch:36,velocity:14,response:{low:.8,mid:1,bassHardness:.5}}]);
    const ledger=runner.freshCellLedger('screen',identity,cells);let calls=0,actualResponse=null;
    const render=(cell,response)=>{calls++;actualResponse=response;return {pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocity/127,kind:'screen',metrics:rowMetrics()};};
    const completed=runner.capturePhaseRows({roots,ledger,cells,identity,capture:{},render,response:null,identityNow:()=>base,now:()=> '2026-10-08T00:00:00.000Z'});
    assert.deepEqual(actualResponse,{low:.8,mid:1,bassHardness:.5},'cell-specific response is used when the phase response is omitted');
    assert.equal(completed.calls,1);assert.deepEqual(completed.counts,{PENDING:0,IN_PROGRESS:0,COMPLETE:1});
    const replay=runner.loadLedger(roots,'screen',identity,cells);assert.equal(replay.accounting.renderCalls,1);
    const read=runner.readCompletedRows(roots,replay,cells);assert.equal(read[0].metrics.finite,true);
    runner.capturePhaseRows({roots,ledger:replay,cells,identity,capture:{},render,response:null,identityNow:()=>base});
    assert.equal(calls,1,'COMPLETE rows are never rerendered');
    const evaluation={pass:true};const first=runner.finalizePhase({roots,phase:'screen',identity,ledger:replay,decision:'PASS',result:evaluation,now:()=> '2026-10-08T00:00:01.000Z'});
    const second=runner.finalizePhase({roots,phase:'screen',identity,ledger:replay,decision:'PASS',result:evaluation,now:()=> '2026-10-08T00:10:01.000Z'});
    assert.equal(first.ledgerSha256,second.ledgerSha256,'finalization replay preserves persisted result identity');
    assert.equal(first.archiveSha256,second.archiveSha256,'phase archive is immutable and reused');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const {root,roots}=tempRoots();
  try{
    const base=baseIdentity(),identity=runner.phaseIdentity(base,'journal-screen','c'.repeat(64));
    const cells=runner.cellSpecs('journal-screen',[{pitch:36,velocity:14}]);
    const ledger=runner.freshCellLedger('journal-screen',identity,cells),journalRoots=runner.ledgerJournalRoots(roots,'journal');
    runner.writeCellState(roots,ledger);
    const journalContext={journalRoots,manifestSha256:'1'.repeat(64),proofSha256:'2'.repeat(64),compatibilitySha256:'3'.repeat(64)};
    let renders=0;
    const measured=runner.capturePhaseRows({roots,ledger,cells,identity,capture:{},journalContext,
      render(){renders++;return {pitch:36,velocity:14,velocityNormalized:14/127,kind:'screen',metrics:rowMetrics()};},
      identityNow:()=>base,now:()=> '2026-10-08T00:00:00.000Z'});
    assert.equal(renders,1);assert.deepEqual(measured.counts,{PENDING:0,IN_PROGRESS:0,COMPLETE:1});
    const genesis=durable.verifyDualCopy(path.join(journalRoots.primary,'genesis-ledger.json'),path.join(journalRoots.secondary,'genesis-ledger.json'));
    const current=durable.verifyDualCopy(path.join(roots.primary,'journal-screen-ledger.json'),path.join(roots.secondary,'journal-screen-ledger.json'));
    const events=runner.transitionEntries(journalRoots);
    const renderStarts=runner.renderStartEntries(journalRoots);
    const replay=evidenceValidator.validateLedgerTransitions({genesisLedgerBytes:genesis.bytes,currentLedgerBytes:current.bytes,
      transitionEntries:events,renderStartEntries:renderStarts,expectedCells:cells,bindings:journalContext});
    assert.equal(replay.transitionCount,2);assert.equal(replay.renderCalls,1);assert.equal(replay.complete,1);
    assert.equal(renderStarts.length,1);assert.equal(renderStarts[0].cellKey,cells[0].key);
    assert.equal(events[0].oldState,'PENDING');assert.equal(events[0].newState,'IN_PROGRESS');
    assert.equal(events[1].oldState,'IN_PROGRESS');assert.equal(events[1].newState,'COMPLETE');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const {root,roots}=tempRoots();
  try{
    const base=baseIdentity(),identity=runner.phaseIdentity(base,'screen','c'.repeat(64));
    const cells=runner.cellSpecs('screen',[{pitch:36,velocity:14},{pitch:39,velocity:14}]);
    const ledger=runner.freshCellLedger('screen',identity,cells);let calls=0;
    assert.throws(()=>runner.capturePhaseRows({roots,ledger,cells,identity,capture:{},render(){calls++;},identityNow:()=>({...base,captureHelperSha256:'9'.repeat(64)})}),/BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY/);
    assert.equal(calls,0,'identity drift blocks before render');
    assert.equal(ledger.cells[cells[0].key].state,'PENDING','identity drift never marks IN_PROGRESS');
    assert.equal(fs.existsSync(path.join(roots.primary,'screen-ledger.json')),false,'blocked pre-render identity check writes no ledger');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const {root,roots}=tempRoots();
  try{
    const base=baseIdentity(),identity=runner.phaseIdentity(base,'invalid-screen','c'.repeat(64));
    const cells=runner.cellSpecs('invalid-screen',[{pitch:36,velocity:14,response:[1,1,0]}]);
    const ledger=runner.freshCellLedger('invalid-screen',identity,cells),journalRoots=runner.ledgerJournalRoots(roots);
    let renders=0;
    assert.throws(()=>runner.capturePhaseRows({roots,ledger,cells,identity,capture:captureDefaults,journalContext:{journalRoots,
      manifestSha256:'1'.repeat(64),proofSha256:'2'.repeat(64),compatibilitySha256:'3'.repeat(64)},
      identityNow:()=>base,render(){renders++;throw new Error('audio rendering is forbidden');}}),/exactly low, mid, and bassHardness/);
    assert.equal(renders,0);
    assert.equal(ledger.cells[cells[0].key].state,'PENDING');
    assert.equal(fs.existsSync(path.join(roots.primary,'invalid-screen-ledger.json')),false);
    assert.equal(fs.existsSync(journalRoots.primary),false,'request validation precedes genesis and ledger side effects');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const received=[];const capture={renderNormalized(pitch,velocity,response,options){received.push({pitch,velocity,response,options});return {metrics:rowMetrics()};}};
  const cell={pitch:41,velocityNormalized:.55,response:{low:.85,mid:.9,bassHardness:1.25},kind:'screen'};
  const row=runner.renderOne(cell,null,capture);
  assert.deepEqual(received[0].response,cell.response,'normalized capture honors cell-level response');
  assert.deepEqual(received[0].options,{stage2mFactorMask:3,includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,includeSoundboardDiagnostics:true});
  assert.equal(row.metrics.finite,true);
}

{
  const received=[];const capture={renderNormalized(pitch,velocity,response,options){received.push({pitch,velocity,response,options});return {metrics:rowMetrics()};}};
  const cell={phase:'baseline',pitch:36,velocity:14,velocityNormalized:14/127,kind:'production'};
  runner.renderOne(cell,{low:1,mid:1,bassHardness:1},capture);
  assert.equal(received[0].options.stage2mFactorMask,3);
  assert.equal(received[0].options.includeSoundboardDiagnostics,true);
  assert.equal(received[0].options.includeVelocityDerivative,false,
    'direct style baseline uses canonical windows without MIDI41 derivative analysis');
}

{
  const {root,roots}=tempRoots();
  try{
    const generation={primary:path.join(roots.primary,'generation-2'),secondary:path.join(roots.secondary,'generation-2')};
    fs.mkdirSync(generation.primary,{recursive:true});fs.mkdirSync(generation.secondary,{recursive:true});
    assert.equal(runner.phaseRoots(generation,'low-full-.8-1.25').primary,path.join(generation.primary,'low','validations','low-full-.8-1.25'));
    assert.equal(runner.phaseRoots(generation,'mid-full-.9').secondary,path.join(generation.secondary,'mid','validations','mid-full-.9'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('PASS Stage3E Generation-2 dual persistence, identity gate, resume, and finalization');
