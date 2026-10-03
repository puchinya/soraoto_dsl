'use strict';

const assert=require('node:assert/strict');
const {MASK,EQUIVALENCE_CELLS,MATRIX_PITCHES,VELOCITIES,MIDI41_NORMALIZED,
  assertFixedCells,assertMask,compareEquivalence,gainDecomposition,assertHammerInvariants}
  =require('./run-stage3a-velocity-diagnostic.cjs');

assert.equal(MASK,3);
assert.deepEqual(EQUIVALENCE_CELLS,[[36,14],[36,124],[51,14],[51,124],[96,31],[96,124]]);
assert.equal(MATRIX_PITCHES.length*VELOCITIES.length+MIDI41_NORMALIZED.length,195);
assert.deepEqual(MIDI41_NORMALIZED,[0.25,0.55,0.9]);

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
