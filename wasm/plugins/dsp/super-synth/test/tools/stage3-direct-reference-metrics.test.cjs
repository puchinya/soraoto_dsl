'use strict';

const assert=require('node:assert/strict');
const {LIMITS,postAttackResiduals,postAttackShapeErrorDb,dynamicSpanMetrics,brightnessDirectionMetrics,evaluateDirectReferenceMatrix}=require('./stage3-direct-reference-metrics.cjs');

const shapeA={envelopeDbfs:[-30,-24,-15,-20,-31]},shapeB={envelopeDbfs:[-31,-23,-16,-20,-28]};
const exactShape=Math.max(Math.abs((-15+20)-(-16+20)),Math.abs((-31+20)-(-28+20)));
assert.equal(postAttackShapeErrorDb(shapeA,shapeB),exactShape);

const earlyPositive=postAttackResiduals(
  {envelopeDbfs:[0,0,-10,-20,-30]},
  {envelopeDbfs:[0,0,-15,-20,-30]});
assert.equal(earlyPositive.earlyResidualDb,5);
assert.equal(earlyPositive.lateResidualDb,0);
assert.equal(earlyPositive.dominantResidual,'EARLY');
const earlyNegative=postAttackResiduals(
  {envelopeDbfs:[0,0,-20,-20,-30]},
  {envelopeDbfs:[0,0,-15,-20,-30]});
assert.equal(earlyNegative.earlyResidualDb,-5);
assert.equal(earlyNegative.dominantResidual,'EARLY');
const latePositive=postAttackResiduals(
  {envelopeDbfs:[0,0,-15,-20,-25]},
  {envelopeDbfs:[0,0,-15,-20,-30]});
assert.equal(latePositive.lateResidualDb,5);
assert.equal(latePositive.earlyResidualDb,0);
assert.equal(latePositive.dominantResidual,'LATE');
const lateNegative=postAttackResiduals(
  {envelopeDbfs:[0,0,-15,-20,-35]},
  {envelopeDbfs:[0,0,-15,-20,-30]});
assert.equal(lateNegative.lateResidualDb,-5);
assert.equal(lateNegative.dominantResidual,'LATE');
const residualTie=postAttackResiduals(
  {envelopeDbfs:[0,0,-10,-20,-25]},
  {envelopeDbfs:[0,0,-15,-20,-30]});
assert.equal(residualTie.dominantResidual,'TIE');
assert.equal(residualTie.postAttackShapeErrorDb,5);

const span=dynamicSpanMetrics([-30,-24,-18],[-32,-24,-10]);
assert.equal(span.actualSpanDb,12);
assert.equal(span.referenceSpanDb,22);
assert.equal(span.errorDb,10);
assert.equal(span.violationDb,10-LIMITS.dynamicSpanErrorDb);

const low={spectralCentroidHz:1000,above2kPowerRatio:0.1};
const high={spectralCentroidHz:1100,above2kPowerRatio:0.14};
const refLow={spectralCentroidHz:1000,above2kPowerRatio:0.1};
const refHigh={spectralCentroidHz:1200,above2kPowerRatio:0.2};
assert.equal(brightnessDirectionMetrics(low,high,refLow,refHigh).fails,false);
const dark={spectralCentroidHz:900,above2kPowerRatio:0.05};
const darkResult=brightnessDirectionMetrics(low,dark,refLow,refHigh);
assert.equal(darkResult.fails,true);
assert.ok(darkResult.violation>0);

const referenceCells=[];
const measuredCells=[];
for(const velocity of [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124]){
  const level=-30+velocity/10;
  const m={envelopeDbfs:[level-4,level-2,level-1,level,level-3],spectralCentroidHz:1000+velocity,
    above2kPowerRatio:velocity/1000,peakDbfs:-12,outputGuardHits:0,finite:true};
  const r={...m,envelopeDbfs:[...m.envelopeDbfs]};
  referenceCells.push({pitch:60,velocity,metrics:r});
  measuredCells.push({pitch:60,velocity,metrics:m});
}
const direct=evaluateDirectReferenceMatrix(referenceCells,measuredCells);
assert.equal(direct.coverage.cells,16);
assert.equal(direct.velocity.length,1);
assert.equal(direct.velocity[0].errorDb,0);
assert.equal(direct.metrics.postAttackShape.maxViolationDb,-LIMITS.postAttackShapeErrorDb);
assert.equal(direct.metrics.directLevel.maxViolationDb,-LIMITS.directLevelErrorDb);
assert.equal(direct.metrics.peakWorstDbfs,-12);
assert.equal(direct.cells[0].earlyResidualDb,0);
assert.equal(direct.cells[0].lateResidualDb,0);
assert.equal(direct.cells[0].dominantResidual,'TIE');
assert.equal(direct.cells[0].postAttackShapeErrorDb,postAttackShapeErrorDb(measuredCells[0].metrics,referenceCells[0].metrics));
console.log('PASS Stage-3 shared direct-reference metric formulas');
