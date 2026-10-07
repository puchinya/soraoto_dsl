'use strict';

const assert=require('node:assert/strict');
const core=require('./stage3e-generation2-core.cjs');
const reference=require('./run-stage3e-historical-reference-requalification.cjs');

const SIGNALS=['bridge_b','bridge_m','bridge_t','board_drive_b','board_drive_m','board_drive_t','modal_l','modal_r','residual_l','residual_r','pre_radiation_l','pre_radiation_r','post_radiation_l','post_radiation_r','dry_transverse','dry_bridge','dry_contact','dry_longitudinal','dry_mix','longitudinal_bridge_drive'];
function metric(kind,velocityNormalized){
  const value={onsetMs:2,peakDbfs:-10,fullRenderPeakDbfs:-9,spectralCentroidHz:1200,above2kPowerRatio:.2,envelopeDbfs:[-50,-30,-12,-10,-14],envelope20msDbfs:[-40,-25,-10,-10,-11,-12],harmonicRatiosH2ToH6:[.1,.05,.02,.01,.005],stereoWidth:.4,stereoPan:0,inharmonicityB:.001,spectralSpreadHz:8,finite:true};
  if(kind==='stage3a'){const i=reference.STAGE3A_CELLS.findIndex(row=>row.velocityNormalized===velocityNormalized);Object.assign(value,{stage2mFactorMask:3,velocityDerivative:reference.DERIVATIVE_EXPECTED[i],velocityDerivativeWindowMs:[30,180],stage2mHammer:{effectiveHardness:.2,initialHammerVelocity:2,contactDurationSamples:100,peakForce:3,maxCompression:.1,postContactTransverseEnergy:.5},soundboardDiagnostics:{frames:17760,signals:Object.fromEntries(SIGNALS.map(name=>[name,{rms:.1,peak:.2}]))}});}
  return value;
}
function makeReferenceSet(){
  const rows=reference.exactCellList().map(cell=>{const doc={schemaVersion:1,cellKey:cell.key,identity:{candidateId:reference.CANDIDATE_ID},row:cell,pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized,kind:cell.kind,metrics:metric(cell.kind,cell.velocityNormalized),capturedAt:'2026-10-08T00:00:00.000Z'};doc.rowSha256=reference.sha256(reference.canonicalBytes(doc));doc.rowFileSha256='b'.repeat(64);return doc;});
  return {schemaVersion:1,decision:'STAGE3E_HISTORICAL_REFERENCE_REQUALIFIED',candidateId:reference.CANDIDATE_ID,productionRevision:reference.PRODUCTION_REVISION,stage3aRevision:reference.STAGE3A_REVISION,acousticRenderCalls:12,productionCandidateDelta:0,stage4Renders:0,authorizedCells:reference.exactCellList(),rows};
}

{
  assert.equal(core.compareValue([1,2], [1,2+1e-7], {tolerance:1e-6}).pass, true);
  assert.equal(core.compareValue([1,2], [1,2+2e-6], {tolerance:1e-6}).pass, false);
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
