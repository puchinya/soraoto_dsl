'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./issue7-contact-loss-v1-core.cjs');

function matrix() {
  const cells = core.STRESS_CELLS.map(([pitch, velocity]) => ({
    pitch, velocity, hardFailures: [], finite: true, peakDbfs: -4,
    guardHits: 0, postAttackShapeErrorDb: 9.8, levelErrorDb: 0,
    centroidComparable: true, centroidRatio: 1.2, above2kDelta: 0.1
  }));
  return {schemaVersion: 1, coverage: {cells: 7, pitches: 1}, cells,
    velocity: [{pitch: 96, actualSpanDb: 21, referenceSpanDb: 20,
      errorDb: 1, failures: []}],
    metrics: {finite: true, peakWorstDbfs: -4, guardHitTotal: 0,
      cellFailureCount: 0, directPitchFailureCount: 0,
      dynamicSpan: {failingPitchCount: 0}, brightnessDirection: {failingPitchCount: 0}}};
}
function candidate(alpha, familyLoss = 1) { return {alpha, official: matrix(), familyLoss}; }

test('fixed plan is six canonical alphas by seven canonical stress cells and has unique IDs', () => {
  const plan = core.plan();
  assert.equal(plan.length, 42);
  assert.equal(new Set(plan.map(row => row.id)).size, 42);
  assert.deepEqual(plan.slice(0, 7).map(row => [row.pitch, row.velocity]), core.STRESS_CELLS);
  assert.deepEqual([...new Set(plan.map(row => row.alpha))], core.ALPHAS);
  assert.equal(core.assertExactPlan(plan), true);
  assert.equal(plan[0].id, 'contact-loss-a00-c00');
  assert.equal(plan[41].id, 'contact-loss-a05-c06');
});

test('reordered, extra, missing or altered plan fails closed before acoustic calls', () => {
  const plan = core.plan();
  assert.throws(() => core.assertExactPlan(plan.slice(1)), /PLAN_LENGTH/);
  assert.throws(() => core.assertExactPlan([...plan, plan[0]]), /PLAN_LENGTH/);
  assert.throws(() => core.assertExactPlan([plan[1], plan[0], ...plan.slice(2)]), /PLAN_IDENTITY/);
  const altered = plan.map(row => ({...row}));
  altered[6].alpha += 0.001;
  assert.throws(() => core.assertExactPlan(altered), /PLAN_IDENTITY/);
});

test('fixed accounting exactly preserves 42 experiment and 1962 acceptance calls', () => {
  const v = core.accounting({startedExperimentCalls: 42, completedExperimentCalls: 42,
    startedAcceptanceCalls: 1962});
  assert.equal(core.RESERVE_CALLS, 1962);
  assert.equal(v.cumulative, 5255);
  assert.equal(v.lifetimeCap, 5255);
  assert.equal(v.experimentRemaining, 0);
  assert.equal(v.acceptanceRemaining, 0);
});

test('a started but incomplete experiment is charged and not treated as complete', () => {
  const v = core.accounting({startedExperimentCalls: 8, completedExperimentCalls: 7});
  assert.equal(v.experimentAmbiguous, 1);
  assert.equal(v.experimentCharged, 8);
  assert.equal(v.cumulative, 3259);
});

test('overbudget, completion ahead of start, negative and fractional counters are blocked', () => {
  for (const x of [
    {startedExperimentCalls: 43},
    {startedExperimentCalls: 1, completedExperimentCalls: 2},
    {startedExperimentCalls: -1}, {startedAcceptanceCalls: 1963},
    {startedExperimentCalls: 0.5}
  ]) assert.throws(() => core.accounting(x), /BLOCKED_CONTACT_LOSS/);
});

test('diagnostic alpha domain is only the six authorized finite canonical values', () => {
  for (const [index, alpha] of core.ALPHAS.entries()) assert.equal(core.alphaIndex(alpha), index);
  for (const alpha of [NaN, Infinity, -Infinity, 0.7, 2, -1]) {
    assert.throws(() => core.alphaIndex(alpha), /BLOCKED_CONTACT_LOSS/);
  }
});

test('baseline safety gate allows a measured shape failure but rejects unsafe amplitude', () => {
  const pass = candidate(1);
  pass.official.cells[5].postAttackShapeErrorDb = 10.2;
  assert.equal(core.assertBaselineSafe(pass), true);
  for (const modify of [
    a => { a.official.cells[0].peakDbfs = 0; },
    a => { a.official.cells[0].guardHits = 1; },
    a => { a.official.metrics.finite = false; }
  ]) {
    const b = candidate(1);
    modify(b);
    assert.throws(() => core.assertBaselineSafe(b), /BASELINE_IDENTITY_OR_SAFETY_BLOCKED/);
  }
});

test('matrix requires all seven unique authenticated cell keys and MIDI96 velocity span', () => {
  const x = candidate(1);
  assert.equal(core.assertOfficialMatrix(x.official), true);
  x.official.cells[1].velocity = 31;
  x.official.cells[1].pitch = 90;
  assert.throws(() => core.assertOfficialMatrix(x.official), /OFFICIAL_CELL_IDENTITY/);
  const y = candidate(1);
  y.official.velocity = [];
  assert.throws(() => core.assertOfficialMatrix(y.official), /OFFICIAL_VELOCITY_SPAN_MISSING/);
});

test('a complete official matrix PASS selects the lowest loss, then closer alpha', () => {
  const result = core.selectCandidate([candidate(0.65, 0.4), candidate(1.2, 0.4), candidate(1.0, 1)]);
  assert.equal(result.status, 'GATE4_STRESS_PASS');
  assert.equal(result.selected.alpha, 1.2);
  assert.equal(result.eligible.length, 3);
});

test('an improved loss never overrides explicit official hard failure', () => {
  const bad = candidate(0.5, 0.001);
  bad.official.cells[5].hardFailures = ['postAttackShape'];
  const ok = candidate(1.0, 99);
  const r = core.selectCandidate([bad, ok]);
  assert.equal(r.selected.alpha, 1);
  assert.equal(r.eligible.length, 1);
});

test('numeric shape, direct level, spectral and brightness violations cannot be hidden by empty failure lists', () => {
  for (const modify of [
    x => { x.official.cells[0].postAttackShapeErrorDb = 10.00001; },
    x => { x.official.cells[0].levelErrorDb = 20.00001; },
    x => { x.official.cells[0].centroidRatio = 8.001; },
    x => { x.official.cells[0].above2kDelta = 1.001; },
    x => { x.official.metrics.brightnessDirection.failingPitchCount = 1; }
  ]) {
    const x = candidate(1);
    modify(x);
    assert.equal(core.classifyCandidate(x).pass, false);
  }
});

test('numeric dynamic span over 8 dB rejects a candidate even if failingPitchCount is forged zero', () => {
  const x = candidate(1);
  x.official.velocity[0].errorDb = 8.01;
  assert.equal(core.classifyCandidate(x).pass, false);
  assert.ok(core.classifyCandidate(x).hardFailures.includes('dynamicSpan'));
});

test('peak >= 0, nonfinite flag and any guard hit fail without relaxing limits', () => {
  for (const modify of [
    x => { x.official.cells[0].peakDbfs = 0; },
    x => { x.official.cells[0].guardHits = 1; },
    x => { x.official.cells[0].finite = false; },
    x => { x.official.metrics.guardHitTotal = 1; }
  ]) {
    const x = candidate(1);
    modify(x);
    assert.equal(core.classifyCandidate(x).pass, false);
  }
});

test('zero complete candidate passes terminate finitely and reserve all downstream calls', () => {
  const bad = core.ALPHAS.map(alpha => {
    const x = candidate(alpha);
    x.official.cells[0].postAttackShapeErrorDb = 11;
    return x;
  });
  const r = core.selectCandidate(bad);
  assert.equal(r.status, core.TERMINAL);
  assert.equal(r.selected, null);
  assert.equal(core.accounting({startedExperimentCalls: 42}).acceptanceRemaining, 1962);
});

test('duplicate candidate, invalid loss and unsupported alpha are not accepted', () => {
  assert.throws(() => core.selectCandidate([candidate(1), candidate(1)]), /DUPLICATE_ALPHA_RESULT/);
  assert.throws(() => core.classifyCandidate(candidate(1, NaN)), /INVALID_FAMILY_LOSS/);
  assert.throws(() => core.classifyCandidate(candidate(0.99)), /UNAUTHORIZED_ALPHA/);
});
