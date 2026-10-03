'use strict';

const assert=require('node:assert/strict');
const {MASK,EQUIVALENCE_CELLS,MATRIX_PITCHES,VELOCITIES,MIDI41_NORMALIZED,
  assertFixedCells,assertMask,compareEquivalence,gainDecomposition,assertHammerInvariants,assertSupplementalCells,
  validateSupplementalRow,MIDI41_EXPECTED_DERIVATIVE,DIAGNOSTIC_SIGNALS}
  =require('./run-stage3a-velocity-diagnostic.cjs');

assert.equal(MASK,3);
assert.deepEqual(EQUIVALENCE_CELLS,[[36,14],[36,124],[51,14],[51,124],[96,31],[96,124]]);
assert.equal(MATRIX_PITCHES.length*VELOCITIES.length+MIDI41_NORMALIZED.length,195);
assert.deepEqual(MIDI41_NORMALIZED,[0.25,0.55,0.9]);
const supplemental=MIDI41_NORMALIZED.map(velocityNormalized=>({pitch:41,velocityNormalized}));
assert.doesNotThrow(()=>assertSupplementalCells(supplemental));
assert.throws(()=>assertSupplementalCells(supplemental.slice(0,2)),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([...supplemental,supplemental[0]]),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([{pitch:40,velocityNormalized:.25},...supplemental.slice(1)]),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([{pitch:41,velocityNormalized:.25},{pitch:41,velocityNormalized:.55},{pitch:41,velocityNormalized:.91}]),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([...supplemental].reverse()),/exactly MIDI 41/);

function midi41Row(index,derivative=MIDI41_EXPECTED_DERIVATIVE[index],window=[30,180]){
  return {pitch:41,velocityNormalized:MIDI41_NORMALIZED[index],metrics:{
    stage2mFactorMask:3,stage2mHammer:{effectiveHardness:.3,initialHammerVelocity:.7,contactDurationSamples:120,
      peakForce:20,maxCompression:.0005,postContactTransverseEnergy:100},
    velocityDerivative:derivative,velocityDerivativeWindowMs:window,envelopeDbfs:[-40,-39,-38,-37,-36],
    peakDbfs:-12,fullRenderPeakDbfs:-11.9,finite:true,outputGuardHits:0,
    soundboardDiagnostics:{signals:Object.fromEntries(DIAGNOSTIC_SIGNALS.map(name=>[name,{rms:.01,peak:.02}]))}
  }};
}
assert.equal(validateSupplementalRow(midi41Row(0),0).equivalencePass,true);
assert.equal(validateSupplementalRow(midi41Row(1,MIDI41_EXPECTED_DERIVATIVE[1]+0.9e-6),1).equivalencePass,true);
assert.equal(validateSupplementalRow(midi41Row(2,MIDI41_EXPECTED_DERIVATIVE[2]+1.1e-6),2).equivalencePass,false);
assert.throws(()=>validateSupplementalRow(midi41Row(0,MIDI41_EXPECTED_DERIVATIVE[0],[0,160]),0),/30–180 ms/);
assert.throws(()=>validateSupplementalRow({...midi41Row(0),metrics:{...midi41Row(0).metrics,outputGuardHits:1}},0),/acoustic\/safety diagnostics/);

const cells=MATRIX_PITCHES.flatMap(pitch=>VELOCITIES.map(velocity=>({pitch,velocity})));
assert.doesNotThrow(()=>assertFixedCells(cells));
assert.throws(()=>assertFixedCells(cells.slice(1)),/exactly the 192/);
assert.throws(()=>assertFixedCells([...cells,cells[0]]),/exactly the 192/);

assert.doesNotThrow(()=>assertMask({stage2mFactorMask:3,stage2mHammer:{}}));
assert.throws(()=>assertMask({stage2mFactorMask:1,stage2mHammer:{}}),/requires Stage2M factor mask 3/);
assert.throws(()=>assertMask({stage2mFactorMask:3}),/requires Stage2M factor mask 3/);

const production={envelopeDbfs:[-20,-21,-22,-23,-24],spectralCentroidHz:1000,above2kPowerRatio:.2,
  peakDbfs:-8,finite:true,outputGuardHits:0};
const within={...production,envelopeDbfs:[...production.envelopeDbfs],spectralCentroidHz:1000+5e-7};
assert.equal(compareEquivalence(production,within).pass,true);
assert.ok(compareEquivalence(production,{...within,peakDbfs:-7.999998}).pass===false);

const d14=gainDecomposition(-30,14/127,.7,.3);
const d124=gainDecomposition(-10,124/127,.7,.3);
assert.ok(Math.abs((d124.velocityGainDb-d14.velocityGainDb)-2.635308)<1e-5);
assert.ok(d14.preOutputGainEquivalentDb!==-30);

const invariantRows=[];
for(const pitch of [33,36,39]) for(const velocity of [14,124]) invariantRows.push({pitch,velocity,metrics:{stage2mHammer:{effectiveHardness:.4,initialHammerVelocity:1.2}}});
assert.ok(assertHammerInvariants(invariantRows).every(row=>row.pass));
invariantRows[0].metrics.stage2mHammer.effectiveHardness=.40001;
assert.throws(()=>assertHammerInvariants(invariantRows),/not pitch-invariant/);

console.log('PASS Stage3A diagnostic cell, mask, equivalence, gain and hammer-invariant checks');
