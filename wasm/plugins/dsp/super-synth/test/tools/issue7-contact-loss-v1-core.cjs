'use strict';

// Pure fixed-plan and official-verdict helpers for Issue #7 contact-loss v1.
// Acoustic rendering, evidence IO, source identity and call charging belong to
// the separately approved orchestration/ledger owner, never to these helpers.
const ALPHAS = Object.freeze([1.00, 0.50, 0.65, 0.80, 1.20, 1.40]);
const STRESS_CELLS = Object.freeze([[90, 31], [93, 31], [96, 14],
  [96, 31], [96, 36], [96, 124], [99, 31]].map(row => Object.freeze(row)));
const HISTORICAL_CALLS = 3251, MAX_CALLS = 5255, EXPERIMENT_CALL_CAP = 42;
const RESERVE = Object.freeze({confirmation: 25, headroom: 4,
  releaseEquivalence: 24, stage3: 486, stage4: 1423});
const RESERVE_CALLS = Object.values(RESERVE).reduce((a, b) => a + b, 0);
const TERMINAL = 'PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT';

function invariant(condition, code) {
  if (!condition) throw new Error(`BLOCKED_CONTACT_LOSS:${code}`);
}
function cellKey(pitch, velocity) { return `${pitch}:${velocity}`; }
function alphaIndex(alpha) {
  invariant(typeof alpha === 'number' && Number.isFinite(alpha), 'NONFINITE_ALPHA');
  const index = ALPHAS.findIndex(value => Math.abs(value - alpha) <= 1e-6);
  invariant(index >= 0, 'UNAUTHORIZED_ALPHA');
  return index;
}
function plan() {
  return ALPHAS.flatMap((alpha, alphaOrder) => STRESS_CELLS.map(([pitch, velocity], cellOrder) => ({
    id: `contact-loss-a${String(alphaOrder).padStart(2, '0')}-c${String(cellOrder).padStart(2, '0')}`,
    alpha, alphaOrder, pitch, velocity, cellOrder
  })));
}
function assertExactPlan(actual) {
  const expected = plan();
  invariant(Array.isArray(actual) && actual.length === EXPERIMENT_CALL_CAP, 'PLAN_LENGTH');
  actual.forEach((cell, index) => {
    const canonical = expected[index];
    invariant(cell && Object.keys(canonical).length === Object.keys(cell).length
      && Object.entries(canonical).every(([name, value]) => Object.is(cell[name], value)), 'PLAN_IDENTITY');
  });
  return true;
}
function accounting({startedExperimentCalls = 0, completedExperimentCalls = 0,
  startedAcceptanceCalls = 0} = {}) {
  for (const [name, value] of Object.entries({startedExperimentCalls, completedExperimentCalls, startedAcceptanceCalls})) {
    invariant(Number.isSafeInteger(value) && value >= 0, `INVALID_${name.toUpperCase()}`);
  }
  invariant(startedExperimentCalls <= EXPERIMENT_CALL_CAP, 'EXPERIMENT_CAP');
  invariant(completedExperimentCalls <= startedExperimentCalls, 'COMPLETE_EXCEEDS_STARTED');
  invariant(startedAcceptanceCalls <= RESERVE_CALLS, 'RESERVE_CAP');
  const cumulative = HISTORICAL_CALLS + startedExperimentCalls + startedAcceptanceCalls;
  invariant(cumulative <= MAX_CALLS, 'LIFETIME_CAP');
  return {historical: HISTORICAL_CALLS, experimentCharged: startedExperimentCalls,
    experimentCompleted: completedExperimentCalls, experimentAmbiguous: startedExperimentCalls - completedExperimentCalls,
    acceptanceCharged: startedAcceptanceCalls, acceptanceReserved: RESERVE_CALLS,
    cumulative, lifetimeCap: MAX_CALLS, experimentRemaining: EXPERIMENT_CALL_CAP - startedExperimentCalls,
    acceptanceRemaining: RESERVE_CALLS - startedAcceptanceCalls};
}
function assertOfficialMatrix(official) {
  invariant(official?.schemaVersion === 1 && Array.isArray(official.cells)
    && official.cells.length === STRESS_CELLS.length && Array.isArray(official.velocity)
    && official.metrics && official.coverage?.cells === STRESS_CELLS.length, 'OFFICIAL_MATRIX_INCOMPLETE');
  const seen = new Set();
  for (const cell of official.cells) {
    const key = cellKey(cell.pitch, cell.velocity);
    invariant(STRESS_CELLS.some(([p, v]) => cellKey(p, v) === key) && !seen.has(key),
      'OFFICIAL_CELL_IDENTITY');
    seen.add(key);
    invariant(Array.isArray(cell.hardFailures) && typeof cell.finite === 'boolean'
      && Number.isFinite(cell.peakDbfs) && Number.isFinite(cell.guardHits)
      && Number.isFinite(cell.postAttackShapeErrorDb) && Number.isFinite(cell.levelErrorDb)
      && Number.isFinite(cell.centroidRatio) && Number.isFinite(cell.above2kDelta)
      && typeof cell.centroidComparable === 'boolean',
    'OFFICIAL_METRIC_INVALID');
  }
  // The seven-cell matrix has four velocity layers only at MIDI96.
  const dynamic = official.velocity.find(row => row.pitch === 96);
  invariant(dynamic && Array.isArray(dynamic.failures) && Number.isFinite(dynamic.errorDb)
    && Number.isFinite(dynamic.actualSpanDb) && Number.isFinite(dynamic.referenceSpanDb),
    'OFFICIAL_VELOCITY_SPAN_MISSING');
  return true;
}
function classifyCandidate({alpha, official, familyLoss}) {
  const index = alphaIndex(alpha);
  assertOfficialMatrix(official);
  invariant(Number.isFinite(familyLoss) && familyLoss >= 0, 'INVALID_FAMILY_LOSS');
  const failures = new Set();
  for (const cell of official.cells) {
    for (const failure of cell.hardFailures) failures.add(failure);
    if (!cell.finite) failures.add('finite');
    if (cell.guardHits !== 0) failures.add('guard');
    if (cell.peakDbfs >= 0) failures.add('peak');
    if (cell.postAttackShapeErrorDb > 10) failures.add('postAttackShape');
    if (Math.abs(cell.levelErrorDb) > 20) failures.add('directLevel');
    if (cell.centroidComparable && cell.centroidRatio > 8) failures.add('centroid');
    if (cell.above2kDelta > 1) failures.add('above2k');
  }
  for (const row of official.velocity) {
    invariant(Number.isFinite(row.errorDb) && Array.isArray(row.failures),
      'OFFICIAL_VELOCITY_ROW_INVALID');
    for (const failure of row.failures) failures.add(failure);
    if (row.errorDb > 8) failures.add('dynamicSpan');
  }
  const m = official.metrics;
  if (m.finite !== true) failures.add('finite');
  if (!Number.isFinite(m.peakWorstDbfs) || m.peakWorstDbfs >= 0) failures.add('peak');
  if (!Number.isFinite(m.guardHitTotal) || m.guardHitTotal !== 0) failures.add('guard');
  if (m.dynamicSpan?.failingPitchCount !== 0) failures.add('dynamicSpan');
  if (m.brightnessDirection?.failingPitchCount !== 0) failures.add('brightnessDirection');
  if (m.cellFailureCount !== 0 || m.directPitchFailureCount !== 0) failures.add('officialHardGate');
  const hardViolation = Math.max(0,
    ...official.cells.map(cell => Math.max(0, Math.abs(cell.levelErrorDb) - 20, cell.postAttackShapeErrorDb - 10)),
    ...official.velocity.map(row => Math.max(0, row.errorDb - 8)));
  return {alpha: ALPHAS[index], alphaOrder: index, pass: failures.size === 0 && hardViolation === 0,
    hardFailures: [...failures].sort(), hardViolation, familyLoss};
}
function assertBaselineSafe(baseline) {
  invariant(baseline?.alpha === ALPHAS[0], 'BASELINE_ALPHA_MISMATCH');
  assertOfficialMatrix(baseline.official);
  invariant(baseline.official.cells.every(cell => cell.finite === true
    && cell.guardHits === 0 && cell.peakDbfs < 0)
    && baseline.official.metrics.finite === true
    && baseline.official.metrics.guardHitTotal === 0
    && baseline.official.metrics.peakWorstDbfs < 0, 'BASELINE_IDENTITY_OR_SAFETY_BLOCKED');
  return true;
}
function selectCandidate(candidateResults) {
  invariant(Array.isArray(candidateResults), 'CANDIDATE_LIST_REQUIRED');
  const seen = new Set();
  const eligible = [];
  for (const result of candidateResults) {
    const row = classifyCandidate(result);
    invariant(!seen.has(row.alphaOrder), 'DUPLICATE_ALPHA_RESULT');
    seen.add(row.alphaOrder);
    if (row.pass) eligible.push(row);
  }
  eligible.sort((a, b) => a.hardViolation - b.hardViolation
    || a.familyLoss - b.familyLoss
    || Math.abs(a.alpha - 1) - Math.abs(b.alpha - 1) || a.alpha - b.alpha);
  return eligible.length ? {status: 'GATE4_STRESS_PASS', selected: eligible[0], eligible} :
    {status: TERMINAL, selected: null, eligible: []};
}

invariant(HISTORICAL_CALLS + EXPERIMENT_CALL_CAP + RESERVE_CALLS === MAX_CALLS, 'BUDGET_CONTRACT_BROKEN');
module.exports = {ALPHAS, STRESS_CELLS, HISTORICAL_CALLS, MAX_CALLS, EXPERIMENT_CALL_CAP,
  RESERVE, RESERVE_CALLS, TERMINAL, alphaIndex, plan, assertExactPlan, accounting,
  assertOfficialMatrix, classifyCandidate, assertBaselineSafe, selectCandidate};
