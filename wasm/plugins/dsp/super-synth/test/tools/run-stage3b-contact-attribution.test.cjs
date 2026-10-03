'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  EXPECTED_HEAD,CANDIDATE,DYNAMIC_PITCHES,TREBLE_PITCHES,VELOCITIES,TREBLE_VELOCITIES,MIDI41_NORMALIZED,MASKS,SUBSET,CELL_COUNT,
  stage3bPaths,cellKey,cellPath,expectedSubset,makeLedger,counts,assertLedger,validateCell,inspectState,run,finalize,
  factorial,normalizeActiveImpedances,supportGates,selectDecision,DERIVATIVE_WINDOW
}=require('./run-stage3b-contact-attribution.cjs');

assert.equal(EXPECTED_HEAD,'d2bc990a9e669e4e5496d9a745d171fc0434ca99');
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

function gates(overrides={}){
  return supportGates({failingImprovements:[6,4,4,3],controlWorsening:[3,0,-1,2,3],safe:true,trebleWorseningDb:3,
    midi41Guard:true,beatsOtherByDb:2,meanAbsoluteInteractionDb:1.9999,twoStringImprovementDb:5,threeStringImprovementDb:4,...overrides});
}
assert.ok(Object.values(gates()).every(Boolean));
assert.equal(gates({failingImprovements:[4,4,4,3.999]}).threeOfFourImproveBy4,true);
assert.equal(gates({failingImprovements:[4,4,3.999,3]}).threeOfFourImproveBy4,false);
assert.equal(gates({failingImprovements:[6,4,4,3]}).worstFailureImprovesBy6,true);
assert.equal(gates({failingImprovements:[5.999,4,4,3]}).worstFailureImprovesBy6,false);
assert.equal(gates({controlWorsening:[3.001,0,0,0,0]}).controlsDoNotWorsen3,false);
assert.equal(gates({trebleWorseningDb:3.001}).midi96v31DoesNotWorsen3,false);
assert.equal(gates({midi41Guard:false}).midi41DerivativeGuard,false);
assert.equal(gates({beatsOtherByDb:1.999}).beatsOtherBy2,false);
assert.equal(gates({meanAbsoluteInteractionDb:2}).interactionBelow2,false);
assert.equal(gates({twoStringImprovementDb:1,threeStringImprovementDb:-1}).noTwoThreeDirectionReversal,false);
assert.equal(selectDecision({safe:false,iGates:{x:true},pGates:{x:true},meanAbsoluteInteractionDb:0,twoI:1,threeI:1,twoP:1,threeP:1}),
  'BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY');
assert.equal(selectDecision({safe:true,iGates:{x:true},pGates:{x:true},meanAbsoluteInteractionDb:2,twoI:1,threeI:1,twoP:1,threeP:1}),
  'STAGE3B_CONTACT_PHASE_INTERACTION');
assert.equal(selectDecision({safe:true,iGates:{x:true},pGates:{x:false},meanAbsoluteInteractionDb:0,twoI:1,threeI:1,twoP:0,threeP:0}),
  'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE');
assert.equal(selectDecision({safe:true,iGates:{x:false},pGates:{x:true},meanAbsoluteInteractionDb:0,twoI:0,threeI:0,twoP:1,threeP:1}),
  'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN');
assert.equal(selectDecision({safe:true,iGates:{x:false},pGates:{x:false},meanAbsoluteInteractionDb:1,twoI:1,threeI:1,twoP:1,threeP:1}),
  'BLOCKED_STAGE3B_CONTACT_UNISON_HYPOTHESIS');

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
