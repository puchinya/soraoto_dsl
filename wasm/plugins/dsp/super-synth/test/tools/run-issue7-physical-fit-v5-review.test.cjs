'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const core = require('./issue7-physical-fit-v5-review-core.cjs');
const audit = require('./physical-fit-v5-review-audit.cjs');
const model = require('./physical-fit-v5-local-model.cjs');
const runner = require('./run-issue7-physical-fit-v5-review.cjs');
const p5 = require('./issue7-physical-fit-v5-core.cjs');
const direct = require('./stage3-direct-reference-metrics.cjs');
const stage3 = require('./run-issue7-stage3-current-build.cjs');
const stage4Capture = require('./capture-supersynth-stage4-lifecycle.cjs');
const stage4 = require('./stage4-full-range-evaluator.cjs');

const REFERENCE_PATH = path.join(runner.ROOT, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
const fixture = JSON.parse(fs.readFileSync(REFERENCE_PATH, 'utf8'));
const referenceRows = new Map(fixture.directCells.map(row => [`${row.pitch}:${row.velocity}`, row]));
const SOURCE_SHA = core.sha256(Buffer.from('synthetic-source'));
const CAPTURE_SHA = core.sha256(Buffer.from('synthetic-capture'));
const BINARY_SHA = core.sha256(Buffer.from('synthetic-binary'));
const FIXTURE_SHA = core.sha256(Buffer.from('synthetic-fixture'));
let mockWriterQueue = Promise.resolve();

function makeRoots(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-v5-review-test-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const repo = path.join(base, 'repo'), home = path.join(base, 'home'), common = path.join(base, 'common');
  for (const directory of [repo, home, common]) fs.mkdirSync(directory);
  return {base, roots: core.resolveRoots(repo, home, common), repo, home, common};
}
function makeRequest({roots, id = 'test-call-1', artifactKind = 'metric', values = model.BASELINES,
  cell = {pitch: 60, velocity: 80}, ownerId = 'test-owner'} = {}) {
  const lock = core.acquireLock(roots, ownerId);
  const plan = core.writePlan(roots, 'candidate', {test: true, values});
  return {lock, plan, request: {id, stage: 'candidate', planSha256: plan.planSha256,
    values, cell, artifactKind, ownerId, sourceSha256: SOURCE_SHA, captureSha256: CAPTURE_SHA,
    binarySha256: BINARY_SHA, fixtureSha256: FIXTURE_SHA}};
}
function completeCall(roots, {id = 'complete-call', artifactKind = 'wav'} = {}) {
  const {lock, plan, request} = makeRequest({roots, id, artifactKind});
  core.startCall(roots, request);
  const result = core.completeCall(roots, id, {row: {pitch: 60, velocity: 80, metrics: {finite: true}},
    audioBytes: artifactKind === 'wav' ? Buffer.from('synthetic-waveform') : null});
  return {lock, plan, request, result};
}
function directMetricsFor(cell, {shapeError, guardHits = 0, finite = true} = {}) {
  const reference = referenceRows.get(`${cell.pitch}:${cell.velocity}`);
  if (!reference) throw new Error(`fixture missing ${cell.pitch}:${cell.velocity}`);
  const metrics = {...reference.metrics, envelopeDbfs: [...reference.metrics.envelopeDbfs],
    envelope20msDbfs: [...reference.metrics.envelope20msDbfs], finite, outputGuardHits: guardHits};
  if (shapeError) metrics.envelopeDbfs[2] += shapeError;
  return {pitch: cell.pitch, velocity: cell.velocity, finite, guardHits,
    peakDbfs: metrics.peakDbfs, outputGuardHits: guardHits, metrics};
}
function lifecycleMetrics(cell, {guardHits = 0} = {}) {
  return {pitch: cell.pitch, velocity: cell.velocity, metrics: {
    finite: true, finiteThroughout: true, finiteRelease: true, postReleaseFinite: true,
    outputGuardHits: guardHits, peakDbfs: -10, fullRenderPeakDbfs: -9,
    pitchMeasurement: {measurement_valid: true, pitch_error_cents: 0},
    lifecycle: {postReleaseFinite: true, guardHits, noteOffProcessed: true,
      releasedWithinLimit: true, inactiveAfterNoteOffMs: 20, postReleaseProcessed: true, finalActiveVoiceCount: 0}
  }};
}
function syntheticBackend({failAt} = {}) {
  return request => {
    let row;
    if (request.stage === 'candidate' || request.stage === 'confirmation') {
      const metrics = directMetricsFor(request.cell, {
        shapeError: failAt === 'candidate-shape' && request.stage === 'candidate' && request.index === 1 ? 10.205353 : undefined,
        guardHits: failAt === 'candidate-safety' && request.stage === 'candidate' && request.index === 1 ? 1 : 0
      });
      row = metrics;
    } else if (request.stage === 'headroom') {
      const clipped = failAt === 'headroom-clip' && request.index === 1;
      row = {sampleRate: 48000, blockSize: 128, durationSec: 2, noteOffSec: 1,
        maxCallbackSec: 0.001, finite: true, guardHits: 0, peak: clipped ? 1.01 : 0.5,
        peakDbfs: clipped ? 0.086 : -6};
    } else if (request.stage === 'releaseEquivalence') {
      const releaseBuild = request.build?.wasmSha256 === 'b'.repeat(64);
      const drift = failAt === 'release-drift' && releaseBuild && request.index === 2 ? 1e-5 : 0;
      row = {finite: true, guardHits: 0, peak: 0.5,
        left: [0.2 + drift, -0.1], right: [0.3, 0.05]};
    } else if (request.stage === 'stage3') {
      row = directMetricsFor(request.cell, {
        guardHits: failAt === 'stage3-cell' && request.index === 1 ? 1 : 0,
        finite: true
      });
    } else if (request.stage === 'stage4') {
      row = lifecycleMetrics(request.cell);
    } else {
      throw new Error(`unexpected synthetic stage ${request.stage}`);
    }
    return {row, audioBytes: request.artifactKind === 'wav' ? Buffer.from(`synthetic-${request.stage}-${request.index}`) : null};
  };
}
async function withMockWriter(action) {
  const previous = mockWriterQueue;
  let unlock;
  mockWriterQueue = new Promise(resolve => { unlock = resolve; });
  await previous;
  const names = ['beginWriterSession', 'validateWriterSession', 'endWriterSession', 'writePlan',
    'startCall', 'completeCall', 'callCounts', 'writeJsonImmutableDual'];
  const original = Object.fromEntries(names.map(name => [name, core[name]]));
  const states = new Map();
  let planIndex = 0;
  let lastCounts = null;
  function counts() {
    const state = [...states.values()][0];
    const countState = state?.counts || lastCounts;
    if (!countState) return {started: 0, complete: 0, ambiguous: 0, incomplete: 0, cumulative: core.HISTORICAL_CALLS,
      cap: core.MAX_CALLS, remaining: core.MAX_CALLS - core.HISTORICAL_CALLS,
      byStage: Object.fromEntries(Object.keys(core.STAGES).map(stage => [stage, 0])), ambiguousIds: [], incompleteIds: []};
    return {...countState, byStage: {...countState.byStage}, ambiguousIds: [], incompleteIds: [],
      cap: core.MAX_CALLS, remaining: core.MAX_CALLS - countState.cumulative};
  }
  core.beginWriterSession = (roots, ownerId) => {
    lastCounts = null;
    const token = `mock-session-${states.size + 1}`;
    states.set(token, {roots, ownerId, pendingId: null, counts: {started: 0, complete: 0, ambiguous: 0, incomplete: 0,
      cumulative: core.HISTORICAL_CALLS, byStage: Object.fromEntries(Object.keys(core.STAGES).map(stage => [stage, 0]))}});
    return token;
  };
  core.validateWriterSession = (roots, token) => {
    const state = states.get(token);
    if (!state || state.roots !== roots || state.pendingId) throw new Error('BLOCKED_REVIEW_WRITER_SESSION_ACCOUNTING');
    return counts();
  };
  core.endWriterSession = (roots, token) => {
    const state = states.get(token); if (state) lastCounts = {...state.counts, byStage: {...state.counts.byStage}};
    states.delete(token); return {pendingId: state?.pendingId ?? null};
  };
  core.writePlan = (roots, stage, payload) => ({plan: {stage, payload}, planSha256: core.sha256(Buffer.from(`${stage}:${++planIndex}`))});
  core.startCall = (roots, request) => {
    const state = states.get(request.writerSession);
    if (!state || state.roots !== roots || state.ownerId !== request.ownerId || state.pendingId) throw new Error('BLOCKED_REVIEW_WRITER_SESSION');
    const budget = state.counts.byStage[request.stage];
    if (budget + 1 > core.STAGES[request.stage] || state.counts.cumulative + 1 > core.MAX_CALLS) throw new Error('BLOCKED_REVIEW_BUDGET');
    state.counts.started++; state.counts.incomplete++; state.counts.cumulative++;
    state.counts.byStage[request.stage]++; state.pendingId = request.id;
    return {reused: false, marker: request};
  };
  core.completeCall = (roots, id, {row, writerSession} = {}) => {
    const state = states.get(writerSession);
    if (!state || state.pendingId !== id) throw new Error('BLOCKED_REVIEW_WRITER_SESSION_PENDING_CALL');
    state.counts.complete++; state.counts.incomplete--; state.pendingId = null;
    return {status: 'COMPLETE', row};
  };
  core.callCounts = () => counts();
  core.writeJsonImmutableDual = () => ({sha256: 'e'.repeat(64), size: 0, reused: false});
  try { return await action(); }
  finally {
    for (const name of names) core[name] = original[name];
    unlock();
  }
}

test('T01: audits all 729 fixed grid points and exactly matches the frozen planner', () => {
  const report = runner.auditReport({verifyRemote: false});
  assert.equal(report.summary.total, 729);
  assert.equal(Object.values(report.summary.counts).reduce((sum, count) => sum + count, 0), 729);
  assert.equal(report.summary.eligibleCount, 0);
  assert.equal(report.plannerMatch.count, 0);
  assert.deepEqual(report.plannerMatch.values, []);
  assert.deepEqual(report.points[0].index, {k0: -4, k1: -4, k2: -4});
  assert.deepEqual(report.points.at(-1).index, {k0: 4, k1: 4, k2: 4});
  assert.equal(report.model.rank, 4);
  assert.equal(report.model.conditionNumber, 11.520548680042188);
  assert.equal(report.model.looErrorDb, 0.1747236693451656);
  assert.equal(report.best5.length, 0);
});

test('T02: assigns mutually exclusive classifications and represents empty sets with null extrema', () => {
  const base = [...model.BASELINES];
  const near = [{id: 'near', values: base}];
  const point = (indices, values, U, observed = []) => audit.classifyGridPoint({indices, values,
    observed, nearest: near, predicted14: Array(14).fill(0), upperBoundDb: U});
  assert.equal(point([0, 0, 0], base, 1).classification, 'CENTER');
  assert.equal(point([2, 0, 0], [base[0] * 1.2, base[1], base[2]], 1).classification, 'OUT_OF_BOX');
  const duplicateValues = [base[0] + 0.005 * base[0], base[1], base[2]];
  assert.equal(point([1, 0, 0], duplicateValues, 1, [{values: duplicateValues}]).classification, 'MEASURED_DUPLICATE');
  assert.equal(point([1, 0, 0], duplicateValues, 9.9).classification, 'S_AND_P');
  assert.equal(point([1, 0, 0], duplicateValues, 10.1).classification, 'S_ONLY');
  const far = [base[0] * 0.95, base[1], base[2]];
  const farNearest = [{id: 'far', values: [base[0] * 1.05, base[1], base[2]]}];
  const unsupported = upperBoundDb => audit.classifyGridPoint({indices: [1, 0, 0], values: far,
    observed: [], nearest: farNearest, predicted14: Array(14).fill(0), upperBoundDb});
  assert.equal(unsupported(9.9).classification, 'P_ONLY');
  assert.equal(unsupported(10.1).classification, 'NEITHER');
  const empty = audit.gridSummary(Array.from({length: 729}, () => ({classification: 'NEITHER'})));
  assert.equal(empty.supportSatisfied.count, 0);
  assert.equal(empty.supportSatisfied.minU, null);
  assert.equal(empty.predictionSatisfied.count, 0);
  assert.equal(empty.predictionSatisfied.maxSupportDistance, null);
});

test('T03: audit and dry-run preserve all v3/v4/v5 parent inventories and report zero work', () => {
  const before = runner.verifyFrozenP5Parent({verifyRemote: false});
  const reports = [runner.auditReport({verifyRemote: false}), runner.dryRun({verifyRemote: false}),
    runner.auditReport({verifyRemote: false}), runner.dryRun({verifyRemote: false})];
  const after = runner.verifyFrozenP5Parent({verifyRemote: false});
  assert.deepEqual(after.parentSnapshots.inventory, before.parentSnapshots.inventory);
  for (const report of reports) {
    assert.equal(report.work.builds, 0);
    assert.equal(report.work.acousticCalls, 0);
    assert.equal(report.work.renders, 0);
    assert.equal(report.work.writes, 0);
  }
  assert.equal(after.p5.terminalSha256, '346a61a21e3c6fb46c97ee45c74616c523f8a180d63a032f30643532e73243ed');
});

test('T04: accepts a child HEAD with frozen sources and rejects changed sources or non-descendant HEADs', () => {
  const currentHead = require('node:child_process').execFileSync('rtk', ['git', 'rev-parse', 'HEAD'],
    {cwd: runner.ROOT, encoding: 'utf8'}).trim();
  const lineage = runner.verifyLineage({root: runner.ROOT, frozenHead: core.FROZEN_P5_HEAD, currentHead});
  assert.equal(lineage.descendant, true);
  const oldRunner = require('./run-issue7-physical-fit-v5.cjs');
  const oldCore = require('./issue7-physical-fit-v5-core.cjs');
  const frozenSources = oldRunner.preparedPayload(oldCore.resolveRoots(runner.ROOT)).record.sourceHashes;
  const tampered = {...frozenSources, [Object.keys(frozenSources)[0]]: '0'.repeat(64)};
  assert.throws(() => runner.verifyLineage({root: runner.ROOT, frozenHead: core.FROZEN_P5_HEAD,
    currentHead, sourceHashes: tampered}), /BLOCKED_REVIEW_FROZEN_SOURCE_SHA_MISMATCH/);
  assert.throws(() => runner.verifyLineage({root: runner.ROOT, frozenHead: core.FROZEN_P5_HEAD,
    currentHead: '0'.repeat(40)}));
});

test('T05: call identity reuse requires exact values, cell, and artifact kind', t => {
  const {roots} = makeRoots(t);
  const {lock, request} = makeRequest({roots, id: 'identity', artifactKind: 'metric'});
  core.startCall(roots, request);
  core.completeCall(roots, request.id, {row: {pitch: 60, velocity: 80, metrics: {finite: true}}});
  core.releaseLock(roots, lock);
  const resumedLock = core.acquireLock(roots, 'restarted-process');
  const resumed = {...request, ownerId: 'restarted-process'};
  assert.equal(core.startCall(roots, resumed).reused, true);
  assert.throws(() => core.startCall(roots, {...resumed, values: [1.051, 0.5, 0.018]}), /BLOCKED_CALL_IDENTITY_CONFLICT/);
  assert.throws(() => core.startCall(roots, {...resumed, cell: {pitch: 61, velocity: 80}}), /BLOCKED_CALL_IDENTITY_CONFLICT/);
  assert.throws(() => core.startCall(roots, {...resumed, artifactKind: 'wav'}), /BLOCKED_CALL_IDENTITY_CONFLICT/);
  assert.equal(core.callCounts(roots).started, 1);
  assert.equal(core.callCounts(roots).complete, 1);
  core.releaseLock(roots, resumedLock);
});

test('T06: COMPLETE rejects forged audio hashes, divergent/missing copies, metric audio, and false row hashes', t => {
  const cases = ['forged-audio-sha', 'one-sided-audio', 'missing-result-copy', 'metric-audio', 'forged-row-sha'];
  for (const kind of cases) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `issue7-v5-review-${kind}-`));
    try {
      const repo = path.join(base, 'repo'), home = path.join(base, 'home'), common = path.join(base, 'common');
      for (const dir of [repo, home, common]) fs.mkdirSync(dir);
      const roots = core.resolveRoots(repo, home, common);
      const metric = kind === 'metric-audio';
      const {lock} = completeCall(roots, {id: kind, artifactKind: metric ? 'metric' : 'wav'});
      const paths = core.dualPaths(roots, `${core.callPath(kind)}/${metric ? 'audio.wav' : 'result.json'}`);
      if (kind === 'forged-audio-sha') {
        for (const file of [paths.primary, paths.secondary]) {
          const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.audioSha256 = '0'.repeat(64);
          fs.writeFileSync(file, JSON.stringify(data));
        }
      } else if (kind === 'one-sided-audio') {
        const file = core.dualPaths(roots, `${core.callPath(kind)}/audio.wav`).primary;
        fs.writeFileSync(file, Buffer.from('changed-one-side'));
      } else if (kind === 'missing-result-copy') {
        fs.unlinkSync(paths.secondary);
      } else if (kind === 'metric-audio') {
        for (const file of [paths.primary, paths.secondary]) fs.writeFileSync(file, Buffer.from('forbidden-audio'));
      } else {
        for (const file of [paths.primary, paths.secondary]) {
          const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.rowSha256 = '0'.repeat(64);
          fs.writeFileSync(file, JSON.stringify(data));
        }
      }
      assert.throws(() => core.verifiedCall(roots, kind));
      assert.throws(() => core.callCounts(roots));
      core.releaseLock(roots, lock);
    } finally { fs.rmSync(base, {recursive: true, force: true}); }
  }
});

test('T07: started charges survive incomplete work, partial dual writes preserve data, and locks reject another owner', t => {
  const {roots} = makeRoots(t);
  const {lock, request} = makeRequest({roots, id: 'crash-after-marker', artifactKind: 'metric'});
  core.startCall(roots, request);
  const counts = core.callCounts(roots);
  assert.equal(counts.started, 1);
  assert.equal(counts.incomplete, 1);
  core.markAmbiguous(roots, request.id, 'simulated process interruption');
  const ambiguous = core.callCounts(roots);
  assert.equal(ambiguous.ambiguous, 1);
  assert.equal(ambiguous.incomplete, 0);
  assert.throws(() => core.startCall(roots, request), /BLOCKED_CALL_AMBIGUOUS/);
  assert.throws(() => core.assertWriterLock(roots, 'other-owner'), /BLOCKED_REVIEW_LOCK_OWNER_MISMATCH/);
  const partial = core.dualPaths(roots, 'fault-injection/immutable.json');
  fs.mkdirSync(path.dirname(partial.primary), {recursive: true});
  fs.mkdirSync(path.dirname(partial.secondary), {recursive: true});
  fs.writeFileSync(partial.primary, Buffer.from('preserve-existing'));
  assert.throws(() => core.writeImmutableDual(roots, 'fault-injection/immutable.json', Buffer.from('new')),
    /BLOCKED_REVIEW_PARTIAL_DUAL_COPY/);
  assert.equal(fs.readFileSync(partial.primary, 'utf8'), 'preserve-existing');
  assert.equal(fs.existsSync(partial.secondary), false);
  core.releaseLock(roots, lock);
});

test('T08: synthetic positive path executes the fixed stage order within all call budgets', async t => {
  const {roots} = makeRoots(t);
  const result = await withMockWriter(() => runner.runAuthorizedScenario({roots, fixture,
    candidates: [{values: [...model.BASELINES]}], backend: syntheticBackend()}));
  const counts = result.calls;
  assert.equal(result.decision, 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW');
  assert.equal(counts.byStage.candidate, 7);
  assert.equal(counts.byStage.confirmation, 25);
  assert.equal(counts.byStage.headroom, 4);
  assert.equal(counts.byStage.releaseEquivalence, 24);
  assert.equal(counts.byStage.stage3, 486);
  assert.equal(counts.byStage.stage4, 1423);
  assert.equal(counts.cumulative, 5220);
  assert.ok(counts.cumulative <= counts.cap);
  assert.equal(result.stage3.decision, 'STAGE3_READY_FOR_STAGE4');
  assert.equal(result.stage4.decision, 'STAGE4_FULL_RANGE_COMPLETE');
  assert.notEqual(result.builds.productionTest.wasmSha256, result.builds.productionRelease.wasmSha256);
  assert.notDeepEqual(result.builds.productionTest.exports, result.builds.productionRelease.exports);
});

test('T09: official shape/safety, headroom, release, and Stage3 failures stop every later stage', async t => {
  async function scenario(failure) {
    const {roots} = makeRoots(t);
    return withMockWriter(() => {
      try {
        const result = runner.runAuthorizedScenario({roots, fixture, candidates: [{values: [...model.BASELINES]}],
          backend: syntheticBackend({failAt: failure})});
        return {result, roots, counts: core.callCounts(roots)};
      } catch (error) { return {error, roots, counts: core.callCounts(roots)}; }
    });
  }
  const shape = await scenario('candidate-shape');
  assert.equal(shape.result.decision, 'BLOCKED_REVIEW_NO_OFFICIAL_CANDIDATE');
  assert.equal(shape.counts.byStage.confirmation, 0);
  const safety = await scenario('candidate-safety');
  assert.match(safety.error.message, /BLOCKED_REVIEW_OFFICIAL_SAFETY_GATE/);
  assert.equal(safety.counts.byStage.confirmation, 0);
  const headroom = await scenario('headroom-clip');
  assert.equal(headroom.result.decision, 'BLOCKED_REVIEW_HEADROOM');
  assert.equal(headroom.counts.byStage.releaseEquivalence, 0);
  const release = await scenario('release-drift');
  assert.equal(release.result.decision, 'BLOCKED_REVIEW_RELEASE_PCM_MISMATCH');
  assert.equal(release.counts.byStage.stage3, 0);
  const failedStage3 = await scenario('stage3-cell');
  assert.match(failedStage3.result.decision, /^BLOCKED_STAGE3_/);
  assert.equal(failedStage3.counts.byStage.stage4, 0);
});

test('T10: test/release builds may differ while sample equivalence uses the fixed 1e-6 tolerance', () => {
  const pass = runner.comparePcm({left: [0.1, -0.2], right: [0.3, 0.4]},
    {left: [0.1 + 5e-7, -0.2], right: [0.3, 0.4 - 5e-7]});
  assert.equal(pass.pass, true);
  assert.ok(Math.abs(pass.maxAbsoluteSampleDifference - 5e-7) < 1e-15);
  const fail = runner.comparePcm({left: [0.1], right: [0.3]}, {left: [0.1 + 1e-5], right: [0.3]});
  assert.equal(fail.pass, false);
  assert.ok(Math.abs(fail.maxAbsoluteSampleDifference - 1e-5) < 1e-15);
});

test('T11: even a synthetic Stage4 pass cannot claim final review readiness when external acceptance is NOT RUN', t => {
  const {roots} = makeRoots(t);
  const result = runner.finalize({synthetic: true, roots, p5Gate: {pass: true}, confirmation: {pass: true},
    headroom: {pass: true}, promotionResult: {pass: true}, builds: {}, releaseEquivalence: {pass: true},
    stage3Result: {decision: 'STAGE3_READY_FOR_STAGE4'}, stage4Result: {decision: 'STAGE4_FULL_RANGE_COMPLETE'}});
  assert.equal(result.decision, 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW');
  assert.equal(result.webPlayer, 'NOT RUN');
  assert.equal(result.manualListening, 'NOT RUN');
  assert.equal(result.issueReadyForReview, false);
});

test('T12: real frozen P5 terminal zero produces a blocked review terminal with no calls and no parent writes', t => {
  const before = runner.verifyFrozenP5Parent({verifyRemote: false});
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-v5-review-terminal-'));
  try {
    const home = path.join(base, 'home'), common = path.join(base, 'common');
    fs.mkdirSync(home); fs.mkdirSync(common);
    const prepared = runner.prepareReviewRevision({root: runner.ROOT, home, commonDirectory: common, verifyRemote: false});
    const terminal = runner.runAll({root: runner.ROOT, home, commonDirectory: common, verifyRemote: false});
    const counts = core.callCounts(prepared.roots);
    const after = runner.verifyFrozenP5Parent({verifyRemote: false});
    assert.equal(terminal.decision, 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT');
    assert.equal(terminal.newAcousticCalls, 0);
    assert.equal(terminal.phases.stage3, 'NOT RUN');
    assert.equal(terminal.phases.stage4, 'NOT RUN');
    assert.equal(counts.started, 0);
    assert.equal(counts.cumulative, 3251);
    assert.equal(after.p5.terminalSha256, before.p5.terminalSha256);
    assert.deepEqual(after.parentSnapshots.inventory, before.parentSnapshots.inventory);
  } finally { fs.rmSync(base, {recursive: true, force: true}); }
});
