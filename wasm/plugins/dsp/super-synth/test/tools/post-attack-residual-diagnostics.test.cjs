'use strict';

const assert = require('node:assert/strict');
const {VELOCITIES, candidateIdentity, conditions, requestedCells, referenceLoss,
  residualStats, aggregate, pairedDelta, classifyMechanism} = require('./post-attack-residual-diagnostics.cjs');

const matrix = requestedCells();
assert.equal(VELOCITIES.join(','), '14,61,124');
assert.equal(matrix.length, 90);
assert.equal(new Set(matrix.map(cell => `${cell.pitch}:${cell.velocity}`)).size, 90);
assert.equal(conditions().length, 8);
for (const name of ['A_AMOUNT_0','A_AMOUNT_1','B_AMOUNT_0','B_AMOUNT_0_5',
  'A_DAMPING_0','A_DAMPING_1','A_RADIATION_BYPASS_DELTA','B_RADIATION_BYPASS_DELTA']) {
  assert.ok(conditions().some(condition => condition.id === name), `missing ${name}`);
}
assert.equal(conditions().find(condition => condition.id === 'A_AMOUNT_0').componentCapture, true);
assert.equal(conditions().find(condition => condition.id === 'B_AMOUNT_0').componentCapture, true);
assert.equal(conditions().find(condition => condition.id === 'A_RADIATION_BYPASS_DELTA').label, 'RADIATION_BYPASS_DELTA');
for (const candidate of ['A','A1','B','B05']) {
  const identity = candidateIdentity(candidate);
  assert.equal(identity.productionSimd, true);
  assert.match(identity.wasmSha256, /^[a-f0-9]{64}$/);
}

assert.deepEqual(referenceLoss(21, 127), {
  base: 0.0014, registerStart: 0.68, registerWidth: 0.45,
  velocityBase: 1.82, velocityScale: 0.82, keyNormalized: 0,
  registerFactor: 1, velocityNormalized: 1, effective: 0.0014
});

const cells = [
  {pitch: 36, velocity: 14, residual: {earlyResidualDb: 3, lateResidualDb: -2, postAttackShapeErrorDb: 3, dominantResidual: 'EARLY'}},
  {pitch: 36, velocity: 61, residual: {earlyResidualDb: -4, lateResidualDb: 2, postAttackShapeErrorDb: 4, dominantResidual: 'EARLY'}},
  {pitch: 36, velocity: 124, residual: {earlyResidualDb: 1, lateResidualDb: -11, postAttackShapeErrorDb: 11, dominantResidual: 'LATE'}}
];
const early = residualStats(cells, 'earlyResidualDb');
assert.equal(early.count, 3);
assert.equal(early.maxPositive, 3);
assert.equal(early.minNegative, -4);
assert.equal(early.failuresAbsGt10Db, 0);
assert.equal(residualStats(cells, 'lateResidualDb').failuresAbsGt10Db, 1);
assert.equal(aggregate(cells).all.dominant.EARLY, 2);
assert.equal(aggregate(cells).bass_21_48.count, 3);

const clone = rows => ({id: 'before', cells: rows.map(cell => ({...cell, residual: {...cell.residual}}))});
const after = rows => ({id: 'after', cells: rows.map(cell => ({...cell, residual: {...cell.residual, earlyResidualDb: cell.residual.earlyResidualDb + 3}}))});
assert.equal(pairedDelta(clone(cells), after(cells), 'earlyResidualDb').count, 3);
assert.equal(classifyMechanism(clone(cells), {}).mechanism, 'MIXED_OR_UNRESOLVED');
console.log('PASS post-attack residual diagnostic matrix, provenance, aggregation, and guardrails');
