'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EXPECTED_PITCHES,
  EXPECTED_VELOCITIES,
  SENTINELS,
  SERIALIZATION_TOLERANCE,
  validateReferenceFixture,
  assertExactCoverage,
  compareSentinelMetrics,
} = require('./run-stage3-direct-reference.cjs');

const fixturePath = path.resolve(__dirname, '../reference/salamander-grand-piano-v3-metrics.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

assert.deepEqual(validateReferenceFixture(fixture).pitches, EXPECTED_PITCHES);
assert.deepEqual(validateReferenceFixture(fixture).velocities, EXPECTED_VELOCITIES);
assert.equal(assertExactCoverage(fixture.directCells).unique, 480);

const expected = EXPECTED_PITCHES.flatMap(pitch => EXPECTED_VELOCITIES.map(velocity => ({pitch, velocity})));
assert.throws(() => assertExactCoverage(expected.slice(1)), /BLOCKED_STAGE3_CAPTURE_COVERAGE/);
assert.throws(() => assertExactCoverage([...expected.slice(1), expected[0], expected[0]]), /BLOCKED_STAGE3_CAPTURE_COVERAGE/);
assert.throws(() => assertExactCoverage(expected.map((cell, i) => i === 0 ? {...cell, velocity: 15} : cell)), /BLOCKED_STAGE3_CAPTURE_COVERAGE/);

function row(metrics = {}) {
  return {pitch: 60, velocity: 14, metrics: {
    spectralCentroidHz: 1000,
    above2kPowerRatio: 0.1,
    peakDbfs: -12,
    envelopeDbfs: [-30, -24, -18, -20, -25],
    finite: true,
    outputGuardHits: 0,
    ...metrics,
  }};
}

assert.equal(compareSentinelMetrics(row(), row()).pass, true);
assert.equal(compareSentinelMetrics(row(), row({spectralCentroidHz: 1000 + SERIALIZATION_TOLERANCE})).pass, true);
assert.equal(compareSentinelMetrics(row(), row({spectralCentroidHz: 1000 + SERIALIZATION_TOLERANCE * 1.01})).pass, false);
assert.equal(compareSentinelMetrics(row(), row({finite: false})).pass, false);
assert.equal(compareSentinelMetrics(row(), row({outputGuardHits: 1})).pass, false);
assert.equal(compareSentinelMetrics(row(), {...row(), pitch: 61}).reason, 'sentinel cell identity mismatch');
assert.equal(SENTINELS.length, 6);

console.log('PASS Stage3 direct-reference runner validation and sentinel rules');
