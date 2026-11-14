'use strict';

// Pure fixed-plan and official-verdict helpers for Issue #7 contact-loss v1.
// Acoustic rendering, evidence IO, source identity and call charging belong to
// the separately approved orchestration/ledger owner, never to these helpers.
const ALPHAS = Object.freeze([1.00, 0.50, 0.65, 0.80, 1.20, 1.40]);
const STRESS_CELLS = Object.freeze([[90, 31], [93, 31], [96, 14],
  [96, 31], [96, 36], [96, 124], [99, 31]].map(row => Object.freeze(row)));
const {LIMITS: OFFICIAL_LIMITS} = require('./stage3-direct-reference-metrics.cjs');
const HISTORICAL_CALLS = 3251, MAX_CALLS = 5255, EXPERIMENT_CALL_CAP = 42;
const RESERVE = Object.freeze({confirmation: 25, headroom: 4,
  releaseEquivalence: 24, stage3: 486, stage4: 1423});
const RESERVE_CALLS = Object.values(RESERVE).reduce((a, b) => a + b, 0);
const CONFIRMATION_CELLS = Object.freeze([90, 93, 96, 99, 102].flatMap(pitch =>
  [14, 31, 36, 61, 124].map(velocity => Object.freeze({pitch, velocity}))));
const HEADROOM_CELLS = Object.freeze([
  {role: 'baseline', pattern: 'open-c-major-nine'}, {role: 'candidate', pattern: 'open-c-major-nine'},
  {role: 'baseline', pattern: '32-voice-cluster'}, {role: 'candidate', pattern: '32-voice-cluster'}
].map(cell => Object.freeze(cell)));
const RELEASE_CELLS = Object.freeze([
  ...[[48, 14], [48, 124], [60, 31], [78, 36], [90, 31], [93, 31], [96, 31], [96, 124], [99, 124], [108, 124]]
    .map(([pitch, velocity]) => Object.freeze({kind: 'single', pitch, velocity})),
  Object.freeze({kind: 'chord', pattern: 'open-c-major-nine', pitches: Object.freeze([48, 55, 60, 64, 67, 71, 74, 76, 79, 84]), velocity: 124}),
  Object.freeze({kind: 'chord', pattern: 'dense-32-note', pitches: Object.freeze(Array.from({length: 32}, (_, index) => index + 48)), velocity: 124})
]);
const TERMINAL = 'PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT';
const INCOMPLETE_EXPERIMENT = 'BLOCKED_INCOMPLETE_EXPERIMENT';
const SPAN_ARITHMETIC_TOLERANCE_DB = 1e-9;

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
function closeSpanValue(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) <= SPAN_ARITHMETIC_TOLERANCE_DB;
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
    && official.metrics && official.coverage?.cells === STRESS_CELLS.length
    && official.coverage?.pitches === 1 && official.velocity.length === 1, 'OFFICIAL_MATRIX_INCOMPLETE');
  const seen = new Set();
  for (const [index, cell] of official.cells.entries()) {
    const key = cellKey(cell.pitch, cell.velocity);
    invariant(key === cellKey(...STRESS_CELLS[index]) && !seen.has(key),
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
  const dynamic = official.velocity[0];
  invariant(dynamic.pitch === 96 && Array.isArray(dynamic.failures) && Number.isFinite(dynamic.errorDb)
    && Number.isFinite(dynamic.actualSpanDb) && dynamic.actualSpanDb >= 0
    && Number.isFinite(dynamic.referenceSpanDb) && dynamic.referenceSpanDb >= 0,
    'OFFICIAL_VELOCITY_SPAN_MISSING');
  const derivedErrorDb = Math.abs(dynamic.actualSpanDb - dynamic.referenceSpanDb);
  invariant(closeSpanValue(dynamic.errorDb, derivedErrorDb), 'OFFICIAL_VELOCITY_ERROR_MISMATCH');
  const derivedViolationDb = derivedErrorDb - OFFICIAL_LIMITS.dynamicSpanErrorDb;
  invariant(closeSpanValue(dynamic.violationDb, derivedViolationDb), 'OFFICIAL_VELOCITY_VIOLATION_MISMATCH');
  invariant(new Set(dynamic.failures).size === dynamic.failures.length
    && dynamic.failures.every(failure => typeof failure === 'string'), 'OFFICIAL_VELOCITY_FAILURES_INVALID');
  const derivedSpanFailure = derivedErrorDb > OFFICIAL_LIMITS.dynamicSpanErrorDb;
  invariant(dynamic.failures.includes('dynamicSpan') === derivedSpanFailure,
    'OFFICIAL_VELOCITY_FAILURE_MISMATCH');
  const spanSummary = official.metrics.dynamicSpan;
  invariant(Number.isSafeInteger(spanSummary?.failingPitchCount)
    && spanSummary.failingPitchCount === Number(derivedSpanFailure)
    && closeSpanValue(spanSummary.maxAbsoluteErrorDb, derivedErrorDb)
    && closeSpanValue(spanSummary.maxViolationDb, derivedViolationDb)
    && Array.isArray(spanSummary.perPitch) && spanSummary.perPitch.length === 1,
  'OFFICIAL_DYNAMIC_SPAN_SUMMARY_MISMATCH');
  const summaryRow = spanSummary.perPitch[0];
  invariant(summaryRow.pitch === dynamic.pitch
    && closeSpanValue(summaryRow.actualSpanDb, dynamic.actualSpanDb)
    && closeSpanValue(summaryRow.referenceSpanDb, dynamic.referenceSpanDb)
    && closeSpanValue(summaryRow.errorDb, derivedErrorDb)
    && closeSpanValue(summaryRow.violationDb, derivedViolationDb),
  'OFFICIAL_DYNAMIC_SPAN_PER_PITCH_MISMATCH');
  const directPitchFailureCount = official.velocity.filter(row => row.failures.length > 0).length;
  invariant(official.metrics.directPitchFailureCount === directPitchFailureCount,
    'OFFICIAL_DIRECT_PITCH_FAILURE_COUNT_MISMATCH');
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
    for (const failure of row.failures) failures.add(failure);
    if (Math.abs(row.actualSpanDb - row.referenceSpanDb) > OFFICIAL_LIMITS.dynamicSpanErrorDb) {
      failures.add('dynamicSpan');
    }
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
    ...official.velocity.map(row => Math.max(0,
      Math.abs(row.actualSpanDb - row.referenceSpanDb) - OFFICIAL_LIMITS.dynamicSpanErrorDb)));
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
function completeExperimentReceiptValid(receipt) {
  if (receipt?.status !== 'VERIFIED_DUAL_STORE' || receipt.startedCallCount !== EXPERIMENT_CALL_CAP
      || receipt.completedCallCount !== EXPERIMENT_CALL_CAP || receipt.ambiguousCallCount !== 0
      || !Array.isArray(receipt.calls) || receipt.calls.length !== EXPERIMENT_CALL_CAP) return false;
  const baseline = receipt.baseline;
  if (baseline?.status !== 'VERIFIED_SOURCE_BOUND_NEW_BUILD' || baseline.alpha !== ALPHAS[0]
      || !/^[a-f0-9]{40}$/.test(baseline.sourceHead || '')
      || !/^[a-f0-9]{64}$/.test(baseline.wasmSha256 || '')) return false;
  const expected = plan();
  for (const [index, call] of receipt.calls.entries()) {
    const cell = expected[index];
    if (!call || call.id !== cell.id || call.alpha !== cell.alpha || call.alphaOrder !== cell.alphaOrder
        || call.pitch !== cell.pitch || call.velocity !== cell.velocity || call.cellOrder !== cell.cellOrder
        || call.sourceIdentityStatus !== 'MATCH' || call.sourceHead !== baseline.sourceHead
        || call.wasmSha256 !== baseline.wasmSha256
        || call.state !== 'COMPLETE' || !/^[a-f0-9]{64}$/.test(call.audioSha256 || '')
        || !/^[a-f0-9]{64}$/.test(call.metadataSha256 || '')) return false;
  }
  return true;
}
function blockedIncompleteExperiment(reason) {
  return {status: INCOMPLETE_EXPERIMENT, reason, selected: null, eligible: []};
}
function candidateReportMatchesReceipt(result, alphaOrder, receipt) {
  if (result?.alphaOrder !== alphaOrder || result.sourceHead !== receipt.baseline.sourceHead
      || result.wasmSha256 !== receipt.baseline.wasmSha256
      || !Array.isArray(result.cells) || result.cells.length !== STRESS_CELLS.length) return false;
  for (let cellOrder = 0; cellOrder < STRESS_CELLS.length; cellOrder++) {
    const [pitch, velocity] = STRESS_CELLS[cellOrder], cell = result.cells[cellOrder];
    const call = receipt.calls[alphaOrder * STRESS_CELLS.length + cellOrder];
    if (!cell || cell.pitch !== pitch || cell.velocity !== velocity || cell.cellOrder !== cellOrder
        || cell.wavSha256 !== call.audioSha256 || cell.metadataSha256 !== call.metadataSha256) return false;
  }
  return true;
}
function selectCandidate(candidateResults, {receipt} = {}) {
  invariant(Array.isArray(candidateResults), 'CANDIDATE_LIST_REQUIRED');
  if (candidateResults.length !== ALPHAS.length) {
    return blockedIncompleteExperiment('SIX_CANONICAL_ALPHA_VECTORS_REQUIRED');
  }
  const seen = new Set();
  const eligible = [];
  for (const [index, result] of candidateResults.entries()) {
    let alphaOrder;
    try { alphaOrder = alphaIndex(result?.alpha); } catch {
      return blockedIncompleteExperiment('UNAUTHORIZED_ALPHA_IDENTITY');
    }
    if (seen.has(alphaOrder)) return blockedIncompleteExperiment('DUPLICATE_ALPHA_RESULT');
    if (alphaOrder !== index) return blockedIncompleteExperiment('NONCANONICAL_ALPHA_ORDER');
    seen.add(alphaOrder);
  }
  if (!completeExperimentReceiptValid(receipt)) {
    return blockedIncompleteExperiment('COMPLETE_VERIFIED_42_CALL_RECEIPT_REQUIRED');
  }
  if (candidateResults.some((result, alphaOrder) => !candidateReportMatchesReceipt(result, alphaOrder, receipt))) {
    return blockedIncompleteExperiment('CANDIDATE_REPORT_LEDGER_PROVENANCE_MISMATCH');
  }
  try { assertBaselineSafe(candidateResults[0]); } catch {
    return {status: 'BLOCKED_BASELINE_UNSAFE', reason: 'BASELINE_SAFETY_GATE_FAILED', selected: null, eligible: []};
  }
  for (const result of candidateResults) {
    const row = classifyCandidate(result);
    if (row.pass) eligible.push(row);
  }
  eligible.sort((a, b) => a.hardViolation - b.hardViolation
    || a.familyLoss - b.familyLoss
    || Math.abs(a.alpha - 1) - Math.abs(b.alpha - 1) || a.alpha - b.alpha);
  return eligible.length ? {status: 'GATE4_STRESS_PASS', selected: eligible[0], eligible} :
    {status: TERMINAL, selected: null, eligible: []};
}

invariant(HISTORICAL_CALLS + EXPERIMENT_CALL_CAP + RESERVE_CALLS === MAX_CALLS, 'BUDGET_CONTRACT_BROKEN');
module.exports = {ALPHAS, STRESS_CELLS, CONFIRMATION_CELLS, HEADROOM_CELLS, RELEASE_CELLS,
  HISTORICAL_CALLS, MAX_CALLS, EXPERIMENT_CALL_CAP,
  RESERVE, RESERVE_CALLS, TERMINAL, INCOMPLETE_EXPERIMENT, alphaIndex, plan, assertExactPlan, accounting,
  assertOfficialMatrix, classifyCandidate, assertBaselineSafe, selectCandidate};
