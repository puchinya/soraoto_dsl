#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const durable=require('./durable-evidence.cjs');
const runner=require('./run-stage3e-historical-reference-requalification.cjs');
const capture=require('./capture-supersynth-stage3d-matrix.cjs');

function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function tempRoots(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-surrogate-runner-test-'));
  const root=path.join(temp,'repo'),home=path.join(temp,'home');fs.mkdirSync(root);fs.mkdirSync(home);
  const rootSet={primary:path.join(temp,'common/soraoto-agent-state/issues/7/stage3e',runner.EXECUTION_ID),
    secondary:path.join(home,'.soraoto-agent-archive/soraoto_dsl/7/stage3e',runner.EXECUTION_ID)};
  return {temp,root,home,rootSet,rootsFactory:()=>rootSet};
}
function fixtureDependencies(state,{captureCell,identitySequence}={}){
  const provenanceBytes=Buffer.from('{"classification":"SUFFICIENT_METADATA_PROVENANCE"}\n');
  const provenance={classification:'SUFFICIENT_METADATA_PROVENANCE',sha256:sha(provenanceBytes),bytes:provenanceBytes,
    document:{isolatedProductionBuild:{sha256:'eef4fb43c8df85d7840bacd258e289448d2f841c95a02157d29d45803341df47'}}};
  const wasmPath=path.join(state.temp,'surrogate.wasm'),buildDir=path.join(state.temp,'build');
  fs.writeFileSync(wasmPath,Buffer.from('exact Stage3D surrogate fixture'));fs.mkdirSync(buildDir);
  const built={wasmPath,buildDir,identity:{wasmSha256:runner.fileSha(wasmPath)},cleanup(){}};
  const identity={schemaVersion:1,executionId:runner.EXECUTION_ID,referenceSetId:runner.REFERENCE_SET_ID,
    candidateId:runner.CANDIDATE_ID,executionSourceRevision:'a'.repeat(40),authoritativeProductionWasmSha256:'b'.repeat(64),
    productionProvenanceClassification:provenance.classification,productionProvenanceSha256:provenance.sha256,
    stage3dWasmSha256:runner.fileSha(wasmPath),stage3dSourceSha256:'c'.repeat(64),configSha256:'d'.repeat(64),
    profileSha256:'e'.repeat(64),presetsSha256:'f'.repeat(64),referenceFixtureSha256:'1'.repeat(64),
    stage3dCaptureHelperSha256:'2'.repeat(64),surrogateVerifierSha256:'3'.repeat(64),runnerSha256:'4'.repeat(64),
    stage2mFactorMask:3,stage3dVariant:0,tolerance:runner.TOLERANCE,authorizedCells:runner.exactCellList(),
    stage3dBuildIdentity:{decision:'STAGE3E_STAGE3D_SURROGATE_EXACT_REBUILD',wasmSha256:runner.fileSha(wasmPath),controls:{stage3dVariant:0,stage2mFactorMask:3,acousticRenders:0}}};
  let identities=identitySequence?identitySequence.map(value=>structuredClone(value)):null;
  return {validateLineage:()=>provenance,buildSurrogate:()=>built,captureCell:captureCell||((cell)=>safeMetrics(cell)),
    rootsFactory:state.rootsFactory,identityFactory:()=>identities?.length?identities.shift():structuredClone(identity),identity,
    provenance,built,provenanceBytes};
}
function safeMetrics(cell){
  const metrics={envelopeDbfs:[-50,-30,-16,-10,-14],spectralCentroidHz:1200,above2kPowerRatio:.12,
    peakDbfs:-5,fullRenderPeakDbfs:-4,finite:true,outputGuardHits:0,stage2mFactorMask:3,stage3dVariant:0,
    stage2mHammer:{effectiveHardness:1,initialHammerVelocity:2,contactDurationSamples:3,peakForce:4,maxCompression:5,postContactTransverseEnergy:6},
    soundboardDiagnostics:{frames:100,signals:Object.fromEntries(capture.SOUNDBOARD_DIAGNOSTIC_NAMES.map((name,index)=>[name,{rms:index/1000,peak:index/500}]))}};
  if(cell.kind==='stage3a'){metrics.velocityDerivative=.1+cell.velocityNormalized;metrics.velocityDerivativeWindowMs=[30,180];}
  return metrics;
}

assert.equal(runner.EXECUTION_ID,'baseline-surrogate-reference-v1');
assert.equal(runner.REFERENCE_SET_ID,'stage3e-baseline-surrogate-reference-v1');
assert.equal(runner.AUTHORIZED_CELLS.length,12);
assert.equal(runner.PRODUCTION_CELLS.length,9);
assert.equal(runner.STAGE3A_CELLS.length,3);
assert.equal(new Set(runner.exactCellList().map(runner.cellKey)).size,12);
assert.equal(runner.assertAuthorizedCells(runner.AUTHORIZED_CELLS).length,12);
assert.throws(()=>runner.assertAuthorizedCells([...runner.AUTHORIZED_CELLS.slice(0,11),runner.AUTHORIZED_CELLS[0]]),/authorized 12-cell/);
assert.throws(()=>runner.validateMetrics(runner.STAGE3A_CELLS[0],{...safeMetrics(runner.STAGE3A_CELLS[0]),velocityDerivativeWindowMs:[0,160]}),/must be \[30,180\]/);
assert.throws(()=>runner.validateMetrics(runner.PRODUCTION_CELLS[0],{...safeMetrics(runner.PRODUCTION_CELLS[0]),finite:false}),/DIAGNOSTIC_SAFETY/);
assert.throws(()=>runner.validateMetrics(runner.PRODUCTION_CELLS[0],{...safeMetrics(runner.PRODUCTION_CELLS[0]),outputGuardHits:1}),/DIAGNOSTIC_SAFETY/);
assert.throws(()=>runner.validateMetrics(runner.PRODUCTION_CELLS[0],{...safeMetrics(runner.PRODUCTION_CELLS[0]),peakDbfs:0}),/DIAGNOSTIC_SAFETY/);
assert.throws(()=>runner.validateMetrics(runner.PRODUCTION_CELLS[0],{...safeMetrics(runner.PRODUCTION_CELLS[0]),fullRenderPeakDbfs:0}),/DIAGNOSTIC_SAFETY/);

{
  const state=tempRoots();
  try{
    const deps=fixtureDependencies(state);
    const dry=runner.run({mode:'--dry-run',root:state.root,home:state.home,...deps});
    assert.equal(dry.renders,0);assert.equal(dry.acousticRenders,0);assert.equal(dry.authorizedRenderCount,12);
    assert.equal(dry.complete,0);assert.equal(dry.pending,12);assert.equal(fs.existsSync(state.rootSet.primary),false);

    let rendered=0;
    const executeDeps={...deps,captureCell:(cell)=>{rendered++;return safeMetrics(cell);}};
    const executed=runner.run({mode:'--execute',root:state.root,home:state.home,...executeDeps});
    assert.equal(rendered,12);assert.equal(executed.renders,12);assert.deepEqual(executed.counts,{PENDING:0,IN_PROGRESS:0,COMPLETE:12});
    assert.equal(executed.accounting.newRenderCalls,12);
    assert.equal(durable.verifyDualCopy(path.join(state.rootSet.primary,'production-provenance.json'),path.join(state.rootSet.secondary,'production-provenance.json')).sha256,deps.provenance.sha256);

    const resume=runner.run({mode:'--execute',root:state.root,home:state.home,...deps,captureCell:()=>{throw new Error('COMPLETE row rerendered');}});
    assert.equal(resume.renders,0);assert.equal(resume.counts.COMPLETE,12);
    const finalized=runner.run({mode:'--finalize',root:state.root,home:state.home,...deps,now:()=> '2026-10-08T00:00:00.000Z'});
    assert.equal(finalized.renders,0);assert.equal(finalized.decision,'STAGE3E_BASELINE_SURROGATE_REQUALIFIED');
    assert.equal(finalized.authorizedRenderCount,12);assert.match(finalized.referenceSetSha256,/^[0-9a-f]{64}$/);
    const stored=durable.verifyDualCopy(path.join(state.rootSet.primary,runner.REFERENCE_FILE),path.join(state.rootSet.secondary,runner.REFERENCE_FILE));
    const reference=JSON.parse(stored.bytes.toString('utf8'));
    assert.equal(reference.referenceSetId,'stage3e-baseline-surrogate-reference-v1');assert.equal(reference.rows.length,12);
    assert.equal(reference.productionCandidateDelta,0);assert.equal(reference.stage4Renders,0);
    const finalizedAgain=runner.run({mode:'--finalize',root:state.root,home:state.home,...deps,now:()=> '2099-01-01T00:00:00.000Z'});
    assert.equal(finalizedAgain.renders,0);assert.equal(finalizedAgain.referenceSetSha256,finalized.referenceSetSha256);
    assert.equal(durable.verifyDualCopy(path.join(state.rootSet.primary,runner.REFERENCE_FILE),path.join(state.rootSet.secondary,runner.REFERENCE_FILE)).sha256,finalized.referenceSetSha256);
  }finally{fs.rmSync(state.temp,{recursive:true,force:true});}
}

{
  const state=tempRoots();
  try{
    let renderCount=0;const deps=fixtureDependencies(state,{captureCell:cell=>{renderCount++;return safeMetrics(cell);}});
    const changed=structuredClone(deps.identity);changed.productionProvenanceSha256='9'.repeat(64);
    const identities=[deps.identity,deps.identity,changed];
    assert.throws(()=>runner.run({mode:'--execute',root:state.root,home:state.home,...deps,identityFactory:()=>identities.shift()}),/IDENTITY: source or authorization identity changed/);
    assert.equal(renderCount,1,'identity replacement blocks before the next PENDING cell transitions or renders');
    const ledger=JSON.parse(durable.verifyDualCopy(path.join(state.rootSet.primary,'ledger.json'),path.join(state.rootSet.secondary,'ledger.json')).bytes.toString('utf8'));
    assert.equal(Object.values(ledger.cells).filter(cell=>cell.state==='COMPLETE').length,1);
    assert.equal(Object.values(ledger.cells).filter(cell=>cell.state==='PENDING').length,11);
    assert.equal(Object.values(ledger.cells).filter(cell=>cell.state==='IN_PROGRESS').length,0);
  }finally{fs.rmSync(state.temp,{recursive:true,force:true});}
}

{
  const state=tempRoots();
  try{
    const deps=fixtureDependencies(state,{captureCell:()=>{throw new Error('synthetic crash after IN_PROGRESS');}});
    assert.throws(()=>runner.run({mode:'--execute',root:state.root,home:state.home,...deps}),/synthetic crash/);
    const before=JSON.parse(durable.verifyDualCopy(path.join(state.rootSet.primary,'ledger.json'),path.join(state.rootSet.secondary,'ledger.json')).bytes.toString('utf8'));
    assert.equal(Object.values(before.cells).filter(cell=>cell.state==='IN_PROGRESS').length,1);
    let calls=0;
    assert.throws(()=>runner.run({mode:'--execute',root:state.root,home:state.home,...deps,captureCell:()=>{calls++;return safeMetrics(runner.PRODUCTION_CELLS[0]);}}),/AMBIGUOUS_RENDER_ACCOUNTING/);
    assert.equal(calls,0);
  }finally{fs.rmSync(state.temp,{recursive:true,force:true});}
}

console.log('PASS Stage3E surrogate reference authorization, dual-copy lifecycle, 12-cell cap, resume, finalize, and safety');
