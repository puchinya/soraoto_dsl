'use strict';

const assert=require('node:assert/strict');
const core=require('./stage3e-generation2-core.cjs');
const reference=require('./run-stage3e-historical-reference-requalification.cjs');

const SIGNALS=['bridge_b','bridge_m','bridge_t','board_drive_b','board_drive_m','board_drive_t','modal_l','modal_r','residual_l','residual_r','pre_radiation_l','pre_radiation_r','post_radiation_l','post_radiation_r','dry_transverse','dry_bridge','dry_contact','dry_longitudinal','dry_mix','longitudinal_bridge_drive'];
function metric(kind,velocityNormalized){
  const value={onsetMs:2,peakDbfs:-10,fullRenderPeakDbfs:-9,spectralCentroidHz:1200,above2kPowerRatio:.2,envelopeDbfs:[-50,-30,-12,-10,-14],envelope20msDbfs:[-40,-25,-10,-10,-11,-12],harmonicRatiosH2ToH6:[.1,.05,.02,.01,.005],stereoWidth:.4,stereoPan:0,inharmonicityB:.001,spectralSpreadHz:8,finite:true,outputGuardHits:0,
    stage2mFactorMask:3,stage2mHammer:{effectiveHardness:.2,initialHammerVelocity:2,contactDurationSamples:100,peakForce:3,maxCompression:.1,postContactTransverseEnergy:.5},
    soundboardDiagnostics:{frames:17760,signals:Object.fromEntries(SIGNALS.map(name=>[name,{rms:.1,peak:.2}]))}};
  if(kind==='stage3a'){const i=reference.STAGE3A_CELLS.findIndex(row=>row.velocityNormalized===velocityNormalized);Object.assign(value,{velocityDerivative:reference.DERIVATIVE_EXPECTED[i],velocityDerivativeWindowMs:[30,180]});}
  return value;
}
function makeReferenceSet(){
  const rows=reference.exactCellList().map(cell=>({...reference.makeRow(cell,metric(cell.kind,cell.velocityNormalized)),rowFileSha256:'b'.repeat(64)}));
  return {schemaVersion:1,decision:'STAGE3E_BASELINE_SURROGATE_REQUALIFIED',referenceSetId:reference.REFERENCE_SET_ID,
    candidateId:reference.CANDIDATE_ID,productionProvenanceClassification:'SUFFICIENT_METADATA_PROVENANCE',
    productionProvenanceSha256:'a'.repeat(64),authoritativeHistoricalProductionWasmSha256:'b'.repeat(64),
    stage3dWasmSha256:'9883b54eaa888b5a8d2e4d9da0490de92dd4c31915fb0d97d47cc03ce123a63a',
    stage3dSourceSha256:'968488b7d325c42e41570c1d7add10003050ab4c87779774a6e5337244c64886',
    configSha256:'792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d',
    profileSha256:'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66',
    presetsSha256:'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431',
    referenceFixtureSha256:'5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7',
    stage3dVariant:0,stage2mFactorMask:3,authorizedCellCount:12,acousticRenderCalls:12,productionCandidateDelta:0,stage4Renders:0,rows};
}

{
  assert.equal(core.compareValue([1,2], [1,2+1e-7], {tolerance:1e-6}).pass, true);
  assert.equal(core.compareValue([1,2], [1,2+2e-6], {tolerance:1e-6}).pass, false);
  assert.equal(core.compareValue(17760,17760.0000001,{tolerance:1e-6,pathName:'soundboardDiagnostics.frames'}).pass,false,
    'diagnostic frame counts are exact integer states');
  assert.equal(core.compareValue(3,3+1e-7,{tolerance:1e-6,pathName:'stage2mFactorMask'}).pass,false,
    'diagnostic masks are exact integer states');
  const ref=makeReferenceSet();assert.equal(core.validateHistoricalReferenceSet(ref),ref);
  assert.equal(core.validateBaselineRows(ref,ref.rows).decision,'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  const drift=structuredClone(ref.rows);drift[0].metrics.peakDbfs+=2e-6;
  const failed=core.validateBaselineRows(ref,drift);assert.equal(failed.decision,'BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');
  assert.throws(()=>core.validateBaselineRows(ref,drift.slice(0,11)),/exactly 12/);
  const corrupt=structuredClone(ref);corrupt.rows[0].rowSha256='0'.repeat(64);
  assert.throws(()=>core.validateHistoricalReferenceSet(corrupt),/row payload SHA mismatch/);
  const missing=structuredClone(ref);delete missing.rows[9].metrics.velocityDerivative;
  assert.throws(()=>core.validateHistoricalReferenceSet(missing),/missing canonical metric velocityDerivative/);
}

{
  const fixture={directCells:[14,61,124].map((velocity,index)=>({pitch:36,velocity,metrics:{envelopeDbfs:[-30,-20,-10+index*2,-10+index*2,-15]}}))};
  const actual=[14,61,124].map((velocity,index)=>({pitch:36,velocity,metrics:{envelopeDbfs:[-30,-20,-10+index*3,-10+index*3,-15]}}));
  const errors=core.screenSpanErrors(actual,fixture,[36],[14,61,124]);
  assert.deepEqual(errors[36],[1,1,2]);
  const low=core.lowScreenResult({low:.9,bassHardness:1},[
    ...[36,39,42].flatMap(pitch=>[14,61,124].map(velocity=>({pitch,velocity,metrics:{finite:true,outputGuardHits:0,peakDbfs:-5,fullRenderPeakDbfs:-4,envelopeDbfs:[0,0,0,velocity,0]}}))),
    ...[.25,.55,.90].map((velocityNormalized,i)=>({pitch:41,velocityNormalized,metrics:{velocityDerivative:[.05,.06,.1][i],finite:true,outputGuardHits:0,peakDbfs:-5,fullRenderPeakDbfs:-4}}))
  ],{directCells:[...fixture.directCells,...[39,42].flatMap(pitch=>[14,61,124].map(velocity=>({pitch,velocity,metrics:{envelopeDbfs:[0,0,0,velocity,0]}})))]});
  assert.equal(low.spanErrorsByPitch[36].length,3);assert.equal(low.safetyPass,true);assert.equal(low.midi41Derivatives.length,3);
}

console.log('PASS Stage3E Generation-2 canonical baseline, exact 12-row equivalence and fixed search metrics');
