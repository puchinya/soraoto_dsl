'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  EXPECTED_HEAD,CANDIDATE,DYNAMIC_PITCHES,TREBLE_PITCHES,VELOCITIES,TREBLE_VELOCITIES,MIDI41_NORMALIZED,MASKS,SUBSET,CELL_COUNT,
  stage3bPaths,cellKey,cellPath,expectedSubset,makeLedger,counts,assertLedger,validateCell,inspectState,run,finalize,
  assertMask0EquivalenceAuthorization,
  factorial,normalizeActiveImpedances,worstBaselineFailingPitch,supportGates,midi41FactorGuard,factorSafety,selectDecision,DERIVATIVE_WINDOW
}=require('./run-stage3b-contact-attribution.cjs');

assert.equal(EXPECTED_HEAD,'c1fd7f39b1c5d8353862169cadf7e187a7ed6eb6');
assert.equal(CANDIDATE,'stage2n-r3-candidate-01');
assert.deepEqual(MASKS,[1,2,3]);
assert.equal(DYNAMIC_PITCHES.length*VELOCITIES.length*3,432);
assert.equal(TREBLE_PITCHES.length*TREBLE_VELOCITIES.length*3,36);
assert.equal(MIDI41_NORMALIZED.length*3,9);
assert.equal(CELL_COUNT,477);
assert.equal(expectedSubset().filter(cell=>cell.stage3bMask===0).length,0);
assert.equal(new Set(SUBSET.map(cellKey)).size,477);
assert.deepEqual(DERIVATIVE_WINDOW,[30,180]);

const normalizedTwo=normalizeActiveImpedances([1,0.965,1.035],2);
assert.equal(normalizedTwo.activeCount,2);
assert.ok(Math.abs(normalizedTwo.activeSum-1)<=1e-6);
assert.equal(normalizedTwo.effective[2],0);
assert.equal(normalizedTwo.effective[3],0);
assert.ok(Math.abs(normalizedTwo.effective[0]/normalizedTwo.effective[1]-1/0.965)<1e-12);
const normalizedThree=normalizeActiveImpedances([1,0.965,1.035],3);
assert.equal(normalizedThree.activeCount,3);
assert.ok(Math.abs(normalizedThree.activeSum-1)<=1e-6);
assert.throws(()=>normalizeActiveImpedances([1,0,1],2),/positive finite lanes/);

const f=factorial(10,7,8,6);
assert.equal(f.I_main,-2.5);
assert.equal(f.P_main,-1.5);
assert.equal(f.interaction,1);

const baselineWorst=[36,39,51,54].map((pitch,index)=>({pitch,spanByMask:{M0:{absoluteSpanErrorDb:[12.580882,12.069386,20.696187,9.249924][index]}}}));
assert.equal(worstBaselineFailingPitch(baselineWorst),51);
const alternateWorst=baselineWorst.map(row=>({...row,spanByMask:{M0:{absoluteSpanErrorDb:row.pitch===36?22:1}}}));
assert.equal(worstBaselineFailingPitch(alternateWorst),36);
function gates(overrides={}){
  return supportGates({failingImprovements:[4,4,4,3],baselineWorstPitchImprovement:6,controlWorsening:[3,0,-1,2,3],safe:true,
    midi96WorseningDb:3,midi41Guard:true,twoStringImprovementDb:5,threeStringImprovementDb:4,...overrides});
}
assert.ok(Object.values(gates()).every(Boolean));
assert.equal(gates({failingImprovements:[4,4,4,3.999]}).threeOfFourImproveBy4,true);
assert.equal(gates({failingImprovements:[4,4,3.999,3]}).threeOfFourImproveBy4,false);
assert.equal(gates({failingImprovements:[7,4,4,3],baselineWorstPitchImprovement:5.999}).baselineWorstPitchImprovesBy6,false);
assert.equal(gates({failingImprovements:[5,6,4,3],baselineWorstPitchImprovement:6}).baselineWorstPitchImprovesBy6,true);
assert.equal(gates({controlWorsening:[3.001,0,0,0,0]}).controlsDoNotWorsen3,false);
assert.equal(gates({midi96WorseningDb:3.000001}).midi96v31FactorWorseningAtMost3,false);
assert.equal(gates({midi96WorseningDb:3}).midi96v31FactorWorseningAtMost3,true);
const midi96Factor=factorial(10,10,13,13);
assert.equal(midi96Factor.I_main,0,'P-only MIDI96 movement must not leak into I');
assert.equal(midi96Factor.P_main,3);
assert.equal(gates({midi96WorseningDb:midi96Factor.I_main}).midi96v31FactorWorseningAtMost3,true);
assert.equal(gates({midi96WorseningDb:midi96Factor.P_main}).midi96v31FactorWorseningAtMost3,true);
assert.equal(gates({midi41Guard:false}).midi41DerivativeGuard,false);
assert.equal(gates({twoStringImprovementDb:1,threeStringImprovementDb:-1}).noTwoThreeDirectionReversal,false);

const midi41Rows=[{velocityNormalized:.25,derivatives:{M0:.1,M1:.21,M2:.1,M3:.1}},
  {velocityNormalized:.55,derivatives:{M0:.3,M1:.3,M2:.3,M3:.3}},
  {velocityNormalized:.90,derivatives:{M0:.5,M1:.5,M2:.5,M3:.5}}];
assert.equal(midi41FactorGuard(midi41Rows,[1,3]).pass,false,'mask1-only drift affects I family');
assert.equal(midi41FactorGuard(midi41Rows,[2,3]).pass,true,'mask1-only drift does not leak into P family');
const mask2Failure=midi41Rows.map(row=>({...row,derivatives:{...row.derivatives,M1:row.derivatives.M0,M2:row.velocityNormalized===.25?.21:row.derivatives.M0,M3:row.derivatives.M0}}));
assert.equal(midi41FactorGuard(mask2Failure,[1,3]).pass,true);
assert.equal(midi41FactorGuard(mask2Failure,[2,3]).pass,false);
const mask3Failure=midi41Rows.map(row=>({...row,derivatives:{...row.derivatives,M1:row.derivatives.M0,M2:row.derivatives.M0,M3:row.velocityNormalized===.25?.21:row.derivatives.M0}}));
assert.equal(midi41FactorGuard(mask3Failure,[1,3]).pass,false);
assert.equal(midi41FactorGuard(mask3Failure,[2,3]).pass,false);
const midi41Boundary=midi41Rows.map(row=>({...row,derivatives:{...row.derivatives,M1:row.derivatives.M0+(row.velocityNormalized===.25?.10:0)}}));
assert.equal(midi41FactorGuard(midi41Boundary,[1,3]).pass,true,'0.10 derivative delta is inclusive');
const midi41Outside=midi41Rows.map(row=>({...row,derivatives:{...row.derivatives,M1:row.derivatives.M0+(row.velocityNormalized===.25?.100001:0)}}));
assert.equal(midi41FactorGuard(midi41Outside,[1,3]).pass,false,'values above 0.10 fail');
assert.equal(midi41FactorGuard(midi41Rows,[1,3]).rows[0].withinPointOne,false);
const safetyCells=[1,2,3].map(mask=>({stage3bMask:mask,pitch:36,velocity:14,velocityNormalized:14/127,
  metrics:{finite:true,outputGuardHits:0,peakDbfs:-1,fullRenderPeakDbfs:-.5}}));
assert.equal(factorSafety(safetyCells,[1,3]).pass,true);
assert.equal(factorSafety(safetyCells,[2,3]).pass,true);
assert.equal(factorSafety(safetyCells.map(row=>row.stage3bMask===1?{...row,metrics:{...row.metrics,peakDbfs:0}}:row),[1,3]).pass,false);
assert.equal(factorSafety(safetyCells.map(row=>row.stage3bMask===1?{...row,metrics:{...row.metrics,peakDbfs:0}}:row),[2,3]).pass,true,
  'mask1-only safety failure must not disqualify P family');

const safeGates={x:true},failedGates={x:false};
const decision=(overrides={})=>selectDecision({iSafe:true,pSafe:true,iGates:safeGates,pGates:safeGates,meanAbsoluteInteractionDb:1,
  twoI:1,threeI:1,twoP:1,threeP:1,iMeanImprovementDb:5,pMeanImprovementDb:3,...overrides});
assert.equal(decision({iMeanImprovementDb:4.999,pMeanImprovementDb:3}),'STAGE3B_CONTACT_PHASE_INTERACTION');
assert.equal(decision({iMeanImprovementDb:5,pMeanImprovementDb:3}),'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE');
assert.equal(decision({iMeanImprovementDb:3,pMeanImprovementDb:5}),'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN');
assert.equal(decision({meanAbsoluteInteractionDb:2}),'STAGE3B_CONTACT_PHASE_INTERACTION');
assert.equal(decision({twoI:1,threeI:-1}),'STAGE3B_CONTACT_PHASE_INTERACTION');
assert.equal(decision({iGates:safeGates,pGates:failedGates}),'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE');
assert.equal(decision({iGates:failedGates,pGates:safeGates}),'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN');
assert.equal(decision({iSafe:false,pSafe:true,iGates:safeGates,pGates:safeGates,meanAbsoluteInteractionDb:9,
  twoI:1,threeI:-1,iMeanImprovementDb:9,pMeanImprovementDb:1}),'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN');
assert.equal(decision({iSafe:true,pSafe:false,iGates:safeGates,pGates:safeGates,meanAbsoluteInteractionDb:9,
  twoI:1,threeI:1,iMeanImprovementDb:9,pMeanImprovementDb:1}),'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE');
assert.equal(decision({iSafe:false,pSafe:false}),'BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY');
assert.equal(decision({iSafe:false,pSafe:true,pGates:failedGates}),'BLOCKED_STAGE3B_CONTACT_UNISON_HYPOTHESIS');

const identity={sourceRevision:EXPECTED_HEAD,candidateId:CANDIDATE,productionSimd:true,stage2mFactorMask:3,buildRoot:'/tmp/stage3b',
  hashes:{productionWasmSha256:'a'.repeat(64),stage3aWasmSha256:'b'.repeat(64),stage3bWasmSha256:'c'.repeat(64),
    configSha256:'d'.repeat(64),profileSha256:'e'.repeat(64),presetsSha256:'f'.repeat(64),referenceFixtureSha256:'1'.repeat(64)},
  subsetSha256:'2'.repeat(64),constraintSchemaSha256:'3'.repeat(64),authorizedRenderCount:477};
function fakeMetrics(mask){return {stage2mFactorMask:3,stage3bVariantMask:mask,
  envelopeDbfs:[-30,-28,-26,-24,-25],spectralCentroidHz:1200,above2kPowerRatio:.18,peakDbfs:-8,fullRenderPeakDbfs:-7.5,
  finite:true,outputGuardHits:0,velocityDerivative:.1,velocityDerivativeWindowMs:[30,180],
  stage2mHammer:{effectiveHardness:.4,initialHammerVelocity:1,contactDurationSamples:90,peakForce:32,maxCompression:.002,postContactTransverseEnergy:123},
  soundboardDiagnostics:{signals:Object.fromEntries(['bridge_b','board_drive_b','post_radiation_l','bridge_m','bridge_t','board_drive_m','board_drive_t',
    'modal_l','modal_r','residual_l','residual_r','pre_radiation_l','pre_radiation_r','post_radiation_r','dry_transverse','dry_bridge','dry_contact',
    'dry_longitudinal','dry_mix','longitudinal_bridge_drive'].map(name=>[name,{rms:.1,peak:.2}]))}};}

function temporaryRoot(callback){const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3b-recovery-'));
  try{return callback(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}

function writeMask0Authorization(root,overrides={}){
  const base=path.join(root,'.agent-state/issues/7/stage3b');fs.mkdirSync(base,{recursive:true});
  const provenanceFile=path.join(base,'preflight-provenance.json');fs.writeFileSync(provenanceFile,'{"fixture":"preflight"}\n');
  const preflightProvenanceSha256=crypto.createHash('sha256').update(fs.readFileSync(provenanceFile)).digest('hex');
  const artifact={schemaVersion:1,decision:'STAGE3B_MASK0_EQUIVALENT',authorization:'AUTHORIZE_STAGE3B_477_RENDER_MATRIX',
    candidateId:identity.candidateId,authoritativeProductionWasmSha256:identity.hashes.productionWasmSha256,
    stage3bDiagnosticWasmSha256:identity.hashes.stage3bWasmSha256,preflightProvenanceSha256,
    productionCandidateDelta:0,stage4Renders:0,...overrides};
  const authorizationFile=path.join(base,'mask0-equivalence-authorization.json');
  fs.writeFileSync(authorizationFile,`${JSON.stringify(artifact,null,2)}\n`);
  return {authorizationFile,provenanceFile,artifact};
}
function testAuthorization(root,files,options={}){
  let preflightCalls=0,identityCalls=0;
  const result=assertMask0EquivalenceAuthorization(root,{...files,
    preflightCheck:(checkedRoot,{provenanceFile})=>{preflightCalls++;assert.equal(checkedRoot,root);assert.equal(provenanceFile,files.provenanceFile);return {};},
    identityProvider:checkedRoot=>{identityCalls++;assert.equal(checkedRoot,root);return identity;},...options});
  return {result,preflightCalls,identityCalls};
}

temporaryRoot(root=>{
  const files=writeMask0Authorization(root),before=fs.readdirSync(path.dirname(files.authorizationFile)).sort();
  const checked=testAuthorization(root,files);
  assert.equal(checked.result.identity,identity);
  assert.equal(checked.result.authorization.decision,'STAGE3B_MASK0_EQUIVALENT');
  assert.equal(checked.result.preflightProvenanceSha256,files.artifact.preflightProvenanceSha256);
  assert.equal(checked.preflightCalls,1);assert.equal(checked.identityCalls,1);
  assert.deepEqual(fs.readdirSync(path.dirname(files.authorizationFile)).sort(),before,'authorization validation must not write');
});

temporaryRoot(root=>{
  const base=path.join(root,'.agent-state/issues/7/stage3b');fs.mkdirSync(base,{recursive:true});
  const provenanceFile=path.join(base,'preflight-provenance.json');fs.writeFileSync(provenanceFile,'{}\n');
  assert.throws(()=>assertMask0EquivalenceAuthorization(root,{authorizationFile:path.join(base,'mask0-equivalence-authorization.json'),provenanceFile,
    preflightCheck:()=>{},identityProvider:()=>identity}),/BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/);
});

temporaryRoot(root=>{
  const files=writeMask0Authorization(root,{schemaVersion:2});
  assert.throws(()=>testAuthorization(root,files),/BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/);
});
for(const [key,value] of [
  ['decision','WRONG'],['authorization','FORCE'],['candidateId','other-candidate'],
  ['authoritativeProductionWasmSha256','f'.repeat(64)],['stage3bDiagnosticWasmSha256','e'.repeat(64)],
  ['preflightProvenanceSha256','c'.repeat(64)],['productionCandidateDelta',1],['stage4Renders',1]
])temporaryRoot(root=>{
  const files=writeMask0Authorization(root,{[key]:value});
  assert.throws(()=>testAuthorization(root,files),/BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/,`${key} mismatch must block`);
});

temporaryRoot(root=>{
  const files=writeMask0Authorization(root);
  fs.appendFileSync(files.provenanceFile,'changed\n');
  assert.throws(()=>testAuthorization(root,files),/BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/,
    'changed preflight provenance invalidates the saved authorization');
});

temporaryRoot(root=>{
  const files=writeMask0Authorization(root);
  const changedIdentity={...identity,hashes:{...identity.hashes,productionWasmSha256:'9'.repeat(64)}};
  assert.throws(()=>assertMask0EquivalenceAuthorization(root,{...files,preflightCheck:()=>{},identityProvider:()=>changedIdentity}),
    /BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/,'authorization cannot outlive the authoritative production WASM');
});

temporaryRoot(root=>{
  const files=writeMask0Authorization(root);
  const paths=stage3bPaths(root);let renderCalls=0;
  assert.throws(()=>run({root,mode:'execute',renderFn:()=>{renderCalls++;return fakeMetrics(1);}}),
    /BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/);
  assert.equal(renderCalls,0);
  assert.equal(fs.existsSync(paths.ledger),false,'execute authorization must block before ledger creation');
  assert.equal(fs.existsSync(paths.final),false);
  assert.throws(()=>run({root,mode:'finalize'}),/BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/);
  assert.equal(fs.existsSync(paths.ledger),false);
  assert.equal(fs.existsSync(paths.final),false,'finalize authorization must block before final-result write');
});

temporaryRoot(root=>{
  const paths=stage3bPaths(root);
  assert.throws(()=>finalize({root,paths}),/BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED/);
  assert.equal(fs.existsSync(paths.ledger),false);
  assert.equal(fs.existsSync(paths.final),false,'direct finalize authorization must block before evidence/final writes');
});

const initial=makeLedger(identity);
assert.deepEqual(counts(initial),{PENDING:477,IN_PROGRESS:0,COMPLETE:0});
assert.doesNotThrow(()=>assertLedger(initial,identity));
const first=expectedSubset()[0];
const firstRow=validateCell({schemaVersion:1,candidateId:CANDIDATE,stage3bMask:first.stage3bMask,stage2mFactorMask:3,
  pitch:first.pitch,velocity:first.velocity,velocityNormalized:first.velocityNormalized,
  productionWasmSha256:identity.hashes.productionWasmSha256,stage3aWasmSha256:identity.hashes.stage3aWasmSha256,
  stage3bWasmSha256:identity.hashes.stage3bWasmSha256,configSha256:identity.hashes.configSha256,
  profileSha256:identity.hashes.profileSha256,presetsSha256:identity.hashes.presetsSha256,
  referenceFixtureSha256:identity.hashes.referenceFixtureSha256,metrics:fakeMetrics(first.stage3bMask)},first,identity);
assert.equal(firstRow.safety.pass,true);
assert.equal(validateCell({...firstRow,metrics:{...firstRow.metrics,outputGuardHits:1}},first,identity).safety.pass,false);

temporaryRoot(root=>{
  let calls=0;
  const result=run({root,mode:'execute',identityOverride:identity,renderFn:cell=>{calls++;return fakeMetrics(cell.stage3bMask);}});
  assert.equal(result.renderCalls,477);
  assert.deepEqual(result.counts,{PENDING:0,IN_PROGRESS:0,COMPLETE:477});
  assert.equal(calls,477);
  const paths=stage3bPaths(root),ledger=JSON.parse(fs.readFileSync(paths.ledger,'utf8'));
  assert.equal(Object.keys(ledger.aggregates).length,39);
  const resumed=run({root,mode:'execute',identityOverride:identity,renderFn:()=>{calls++;throw new Error('COMPLETE cell rerendered');}});
  assert.equal(resumed.renderCalls,0);assert.equal(calls,477);
  const finished=finalize({root:require('path').resolve(__dirname,'../../../../../../'),paths,identityOverride:identity});
  assert.equal(finished.renderCalls,0);assert.equal(finished.cellCount,477);
  assert.ok(fs.existsSync(paths.final));
});

temporaryRoot(root=>{
  assert.throws(()=>run({root,mode:'execute',identityOverride:identity,renderFn:()=>{throw new Error('must not render');},
    failurePoint:point=>{if(point==='after-in-progress')throw new Error('injected-in-progress');}}),/injected-in-progress/);
  assert.throws(()=>inspectState(stage3bPaths(root),identity),/ambiguous IN_PROGRESS/);
});

temporaryRoot(root=>{
  assert.throws(()=>run({root,mode:'execute',identityOverride:identity,renderFn:cell=>fakeMetrics(cell.stage3bMask),
    failurePoint:point=>{if(point==='after-cell-write')throw new Error('injected-after-cell');}}),/injected-after-cell/);
  assert.throws(()=>inspectState(stage3bPaths(root),identity),/ambiguous IN_PROGRESS/);
});

temporaryRoot(root=>{
  const result=run({root,mode:'dry-run',identityOverride:identity});
  assert.equal(result.builds,0);assert.equal(result.renders,0);assert.equal(result.authorizedNewRenders,477);
  assert.equal(fs.existsSync(stage3bPaths(root).ledger),false);
});

console.log('Stage3B tests passed: 477 identity authorization, factorial math, gate boundaries, safety, atomic resume/skip/finalize behavior.');
