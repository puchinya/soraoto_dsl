'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./issue7-contact-loss-v1-core.cjs');
const {LIMITS} = require('./stage3-direct-reference-metrics.cjs');

function matrix() {
  const cells = core.STRESS_CELLS.map(([pitch, velocity]) => ({
    pitch, velocity, hardFailures: [], finite: true, peakDbfs: -4,
    guardHits: 0, postAttackShapeErrorDb: 9.8, levelErrorDb: 0,
    centroidComparable: true, centroidRatio: 1.2, above2kDelta: 0.1
  }));
  return {schemaVersion: 1, coverage: {cells: 7, pitches: 1}, cells,
    velocity: [{pitch: 96, actualSpanDb: 21, referenceSpanDb: 20,
      errorDb: 1, violationDb: -7, failures: []}],
    metrics: {finite: true, peakWorstDbfs: -4, guardHitTotal: 0,
      cellFailureCount: 0, directPitchFailureCount: 0,
      dynamicSpan: {failingPitchCount: 0, maxAbsoluteErrorDb: 1, maxViolationDb: -7,
        perPitch: [{pitch: 96, actualSpanDb: 21, referenceSpanDb: 20, errorDb: 1, violationDb: -7}]},
      brightnessDirection: {failingPitchCount: 0}}};
}
function candidate(alpha, familyLoss = 1) {
  const alphaOrder = core.alphaIndex(alpha), plan = core.plan().slice(alphaOrder * 7, alphaOrder * 7 + 7);
  return {alpha, alphaOrder, familyLoss, official: matrix(), sourceHead: '1'.repeat(40), wasmSha256: 'c'.repeat(64),
    cells: plan.map(cell => ({pitch: cell.pitch, velocity: cell.velocity, cellOrder: cell.cellOrder,
      wavSha256: 'a'.repeat(64), metadataSha256: 'b'.repeat(64)}))};
}
function receipt(overrides = {}) {
  const baseline = {status: 'VERIFIED_SOURCE_BOUND_NEW_BUILD', alpha: 1,
    sourceHead: '1'.repeat(40), wasmSha256: 'c'.repeat(64)};
  return {status: 'VERIFIED_DUAL_STORE', startedCallCount: 42, completedCallCount: 42,
    ambiguousCallCount: 0, calls: core.plan().map(cell => ({...cell, state: 'COMPLETE',
      sourceIdentityStatus: 'MATCH', sourceHead: baseline.sourceHead, wasmSha256: baseline.wasmSha256,
      audioSha256: 'a'.repeat(64), metadataSha256: 'b'.repeat(64)})),
    baseline, ...overrides};
}
function family(loss = () => 1) { return core.ALPHAS.map(alpha => candidate(alpha, loss(alpha))); }
function setDynamicSpan(official, actualSpanDb, referenceSpanDb) {
  const errorDb = Math.abs(actualSpanDb - referenceSpanDb);
  const violationDb = errorDb - LIMITS.dynamicSpanErrorDb;
  const failures = official.velocity[0].failures.filter(item => item !== 'dynamicSpan');
  if (violationDb > 0) failures.push('dynamicSpan');
  official.velocity[0] = {pitch: 96, actualSpanDb, referenceSpanDb, errorDb, violationDb, failures};
  official.metrics.dynamicSpan = {failingPitchCount: Number(violationDb > 0),
    maxAbsoluteErrorDb: errorDb, maxViolationDb: violationDb,
    perPitch: [{pitch: 96, actualSpanDb, referenceSpanDb, errorDb, violationDb}]};
  official.metrics.directPitchFailureCount = Number(failures.length > 0);
}

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

test('downstream confirmation, headroom, and release plans match the fixed acceptance budgets', () => {
  assert.equal(core.CONFIRMATION_CELLS.length, 25);
  assert.deepEqual(core.CONFIRMATION_CELLS.slice(0, 5).map(row => [row.pitch, row.velocity]),
    [[90, 14], [90, 31], [90, 36], [90, 61], [90, 124]]);
  assert.equal(new Set(core.CONFIRMATION_CELLS.map(row => `${row.pitch}:${row.velocity}`)).size, 25);
  assert.deepEqual(core.HEADROOM_CELLS.map(row => [row.role, row.pattern]), [
    ['baseline', 'open-c-major-nine'], ['candidate', 'open-c-major-nine'],
    ['baseline', '32-voice-cluster'], ['candidate', '32-voice-cluster']
  ]);
  assert.equal(core.RELEASE_CELLS.length, 12);
  assert.equal(new Set(core.RELEASE_CELLS.map(row => JSON.stringify(row))).size, 12);
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
  const reordered = candidate(1);
  [reordered.official.cells[0], reordered.official.cells[1]] =
    [reordered.official.cells[1], reordered.official.cells[0]];
  assert.throws(() => core.assertOfficialMatrix(reordered.official), /OFFICIAL_CELL_IDENTITY/);
  const y = candidate(1);
  y.official.velocity = [];
  assert.throws(() => core.assertOfficialMatrix(y.official), /OFFICIAL_MATRIX_INCOMPLETE/);
});

test('a complete official matrix PASS selects the lowest loss, then closer alpha', () => {
  const result = core.selectCandidate(family(alpha => [0.65, 1.2].includes(alpha) ? 0.4 : 1), {receipt: receipt()});
  assert.equal(result.status, 'GATE4_STRESS_PASS');
  assert.equal(result.selected.alpha, 1.2);
  assert.equal(result.eligible.length, 6);
});

test('an improved loss never overrides explicit official hard failure', () => {
  const candidates = family(alpha => alpha === 0.5 ? 0.001 : alpha === 0.65 ? 1 : 99);
  const bad = candidates[1];
  bad.official.cells[5].hardFailures = ['postAttackShape'];
  const r = core.selectCandidate(candidates, {receipt: receipt()});
  assert.equal(r.selected.alpha, 0.65);
  assert.equal(r.eligible.length, 5);
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

test('numeric dynamic span over 8 dB rejects a candidate when official row and summary agree', () => {
  const x = candidate(1);
  setDynamicSpan(x.official, 28.01, 20);
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
  const r = core.selectCandidate(bad, {receipt: receipt()});
  assert.equal(r.status, core.TERMINAL);
  assert.equal(r.selected, null);
  assert.equal(core.accounting({startedExperimentCalls: 42}).acceptanceRemaining, 1962);
});

test('duplicate candidate, invalid loss and unsupported alpha are not accepted', () => {
  const duplicate = family();
  duplicate[1] = candidate(1);
  assert.equal(core.selectCandidate(duplicate, {receipt: receipt()}).status, core.INCOMPLETE_EXPERIMENT);
  assert.throws(() => core.classifyCandidate(candidate(1, NaN)), /INVALID_FAMILY_LOSS/);
  assert.throws(() => core.classifyCandidate(candidate(0.99)), /UNAUTHORIZED_ALPHA/);
});

test('single and five-of-six passing subsets are blocked as incomplete, never a family terminal or PASS', () => {
  const all = family();
  assert.equal(core.selectCandidate([all[1]], {receipt: receipt()}).status, core.INCOMPLETE_EXPERIMENT);
  assert.equal(core.selectCandidate(all.slice(0, 5), {receipt: receipt()}).status, core.INCOMPLETE_EXPERIMENT);
  assert.equal(core.selectCandidate([all[1]], {receipt: receipt()}).selected, null);
});

test('six vectors must be canonical, distinct, and include the safe alpha-one baseline', () => {
  const outOfOrder = family();
  [outOfOrder[0], outOfOrder[1]] = [outOfOrder[1], outOfOrder[0]];
  assert.equal(core.selectCandidate(outOfOrder, {receipt: receipt()}).reason, 'NONCANONICAL_ALPHA_ORDER');
  const missingBaseline = family();
  missingBaseline[0] = candidate(0.5);
  assert.equal(core.selectCandidate(missingBaseline, {receipt: receipt()}).status, core.INCOMPLETE_EXPERIMENT);
  const unsafeBaseline = family();
  unsafeBaseline[0].official.cells[0].peakDbfs = 0;
  assert.equal(core.selectCandidate(unsafeBaseline, {receipt: receipt()}).status, 'BLOCKED_BASELINE_UNSAFE');
});

test('selector requires a verified source-bound new-build baseline and a complete unambiguous 42-call ledger', () => {
  const candidates = family();
  assert.equal(core.selectCandidate(candidates, {receipt: receipt({baseline: null})}).status,
    core.INCOMPLETE_EXPERIMENT);
  const ambiguous = receipt();
  ambiguous.ambiguousCallCount = 1;
  assert.equal(core.selectCandidate(candidates, {receipt: ambiguous}).status, core.INCOMPLETE_EXPERIMENT);
  const missingCall = receipt();
  missingCall.calls[41].state = 'AMBIGUOUS';
  assert.equal(core.selectCandidate(candidates, {receipt: missingCall}).status, core.INCOMPLETE_EXPERIMENT);
  const mismappedCall = receipt();
  mismappedCall.calls[41].id = mismappedCall.calls[40].id;
  assert.equal(core.selectCandidate(candidates, {receipt: mismappedCall}).status, core.INCOMPLETE_EXPERIMENT);
  const sourceDrift = receipt();
  sourceDrift.calls[0].wasmSha256 = 'd'.repeat(64);
  assert.equal(core.selectCandidate(candidates, {receipt: sourceDrift}).status, core.INCOMPLETE_EXPERIMENT);
  const missingCellBinding = family();
  missingCellBinding[2].cells[0].wavSha256 = 'e'.repeat(64);
  assert.equal(core.selectCandidate(missingCellBinding, {receipt: receipt()}).status, core.INCOMPLETE_EXPERIMENT);
  const wrongReportBuild = family();
  wrongReportBuild[3].sourceHead = 'f'.repeat(40);
  assert.equal(core.selectCandidate(wrongReportBuild, {receipt: receipt()}).status, core.INCOMPLETE_EXPERIMENT);
});

test('dynamic-span error is derived from raw spans and rejects a forged low stored error', () => {
  const x = candidate(1);
  x.official.velocity[0].actualSpanDb = 50;
  x.official.velocity[0].referenceSpanDb = 20;
  x.official.velocity[0].errorDb = 1;
  assert.throws(() => core.classifyCandidate(x), /OFFICIAL_VELOCITY_ERROR_MISMATCH/);
});

test('dynamic-span failure flag and summary counts must match raw spans', () => {
  const forgedRowFlag = candidate(1);
  setDynamicSpan(forgedRowFlag.official, 50, 20);
  forgedRowFlag.official.velocity[0].failures = [];
  assert.throws(() => core.classifyCandidate(forgedRowFlag), /OFFICIAL_VELOCITY_FAILURE_MISMATCH/);
  const forgedCount = candidate(1);
  setDynamicSpan(forgedCount.official, 50, 20);
  forgedCount.official.metrics.dynamicSpan.failingPitchCount = 0;
  assert.throws(() => core.classifyCandidate(forgedCount), /OFFICIAL_DYNAMIC_SPAN_SUMMARY_MISMATCH/);
  const forgedViolation = candidate(1);
  setDynamicSpan(forgedViolation.official, 50, 20);
  forgedViolation.official.velocity[0].violationDb = -8;
  assert.throws(() => core.classifyCandidate(forgedViolation), /OFFICIAL_VELOCITY_VIOLATION_MISMATCH/);
});

test('dynamic-span rows require complete per-pitch summary and official threshold boundaries', () => {
  const missingPitchSummary = candidate(1);
  missingPitchSummary.official.metrics.dynamicSpan.perPitch = [];
  assert.throws(() => core.classifyCandidate(missingPitchSummary), /OFFICIAL_DYNAMIC_SPAN_SUMMARY_MISMATCH/);
  const boundary = candidate(1);
  setDynamicSpan(boundary.official, 28, 20);
  assert.equal(core.classifyCandidate(boundary).pass, true);
  const over = candidate(1);
  setDynamicSpan(over.official, 28.000001, 20);
  assert.equal(core.classifyCandidate(over).pass, false);
});
