'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('./issue7-physical-fit-v5-core.cjs');
const v4core = require('./issue7-physical-fit-v4-core.cjs');
const model = require('./physical-fit-v5-local-model.cjs');
const runner = require('./run-issue7-physical-fit-v5.cjs');

function vector(id, x, violation = 0.1, loss = 1, residuals = null) {
  return {id, values: model.BASELINES.map((baseline, index) => baseline * (1 + x[index] * 0.1)), violation, loss,
    residuals: residuals || Array.from({length: model.OUTPUTS}, (_, output) => 0.5 + output * 0.01 + x[0] * 0.2 - x[1] * 0.1 + x[2] * 0.05)};
}
function wellSpreadObservations() {
  const points = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1],
    [1, 1, 0], [-1, 1, 0], [1, 0, 1], [0, 1, 1], [-1, -1, -1]];
  return points.map((point, index) => vector(`obs-${String(index).padStart(2, '0')}`, point, index === 0 ? 0 : 0.1 + index / 100));
}

test('local model fits 14 signed residuals and emits deterministic supported candidates', () => {
  const observations = wellSpreadObservations();
  const result = model.evaluateLocalModel(observations);
  assert.equal(result.decision, 'V5_READ_ONLY_DIAGNOSTICS_PASS');
  assert.equal(result.best.id, 'obs-00');
  assert.equal(result.nearest.length, 12);
  assert.equal(result.rank, 4);
  assert.ok(result.conditionNumber <= model.MAX_CONDITION);
  assert.ok(result.looErrorDb <= model.MAX_LOO_ERROR_DB);
  assert.ok(result.candidates.length > 0);
  assert.deepEqual(model.evaluateLocalModel(observations).candidates, result.candidates);
  for (const candidate of result.candidates) {
    assert.ok(candidate.upperBoundDb <= model.MAX_PREDICTED_SHAPE_DB);
    assert.ok(!observations.some(item => model.maxCoordinateDifference(model.normalized(item.values), model.normalized(candidate.values)) <= 1e-9));
  }
  assert.ok(result.candidates.every((item, index, all) => index === 0 || all[index - 1].upperBoundDb <= item.upperBoundDb));
});

test('collinear vectors fail the rank gate before producing candidates', () => {
  const observations = Array.from({length: 12}, (_, index) => {
    const x = (index - 5.5) / 16;
    return vector(`line-${String(index).padStart(2, '0')}`, [x, 2 * x, -x], index === 5 ? 0 : 1 + index / 100);
  });
  const result = model.evaluateLocalModel(observations);
  assert.equal(result.decision, 'BLOCKED_V5_LOCAL_IDENTIFIABILITY');
  assert.ok(result.rank < 4);
  assert.deepEqual(result.candidates, []);
});

test('unreliable leave-one-out predictions block candidate generation', () => {
  const observations = wellSpreadObservations();
  observations[11].residuals[0] = 4;
  const result = model.evaluateLocalModel(observations);
  assert.equal(result.decision, 'BLOCKED_V5_SURROGATE_UNRELIABLE');
  assert.ok(result.looErrorDb > model.MAX_LOO_ERROR_DB);
  assert.deepEqual(result.candidates, []);
});

test('official signed residual rows are flattened in fixed early/late order', () => {
  const cells = Array.from({length: 7}, (_, index) => ({earlyResidualDb: index + 0.25, lateResidualDb: -index - 0.5}));
  assert.deepEqual(model.residualVector({official: {cells}}), cells.flatMap(cell => [cell.earlyResidualDb, cell.lateResidualDb]));
});

test('dual-store records are immutable and started calls stay charged after interruption', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-v5-core-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const repo = path.join(temp, 'repo'), home = path.join(temp, 'home'), common = path.join(temp, 'common');
  for (const directory of [repo, home, common]) fs.mkdirSync(directory);
  const roots = core.resolveRoots(repo, home, common);
  const written = core.writeJsonImmutableDual(roots, 'p5/plan.json', {round: 1, candidateCount: 0});
  assert.equal(core.readDual(roots, 'p5/plan.json').sha256, written.sha256);
  assert.throws(() => core.writeJsonImmutableDual(roots, 'p5/plan.json', {round: 1, candidateCount: 1}), /BLOCKED_V5_IMMUTABLE_CONFLICT/);

  core.startCall(roots, {id: 'candidate-01-90-31', stage: 'candidate', planSha256: written.sha256,
    values: core.PARAMETERS.map(item => item.baseline), cell: {pitch: 90, velocity: 31}, ownerId: 'test-owner'});
  const counts = core.callCounts(roots);
  assert.equal(counts.started, 1);
  assert.equal(counts.complete, 0);
  assert.equal(counts.ambiguous, 1);
  assert.equal(counts.cumulative, core.HISTORICAL_CALLS + 1);
  assert.throws(() => core.startCall(roots, {id: 'candidate-01-90-31', stage: 'candidate', planSha256: written.sha256,
    values: core.PARAMETERS.map(item => item.baseline), cell: {pitch: 90, velocity: 31}, ownerId: 'test-owner'}), /BLOCKED_V5_AMBIGUOUS_CALL/);
});

test('a completed call is reused only when marker, result, and audio agree', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-v5-reuse-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const repo = path.join(temp, 'repo'), home = path.join(temp, 'home'), common = path.join(temp, 'common');
  for (const directory of [repo, home, common]) fs.mkdirSync(directory);
  const roots = core.resolveRoots(repo, home, common), values = core.PARAMETERS.map(item => item.baseline);
  const planSha256 = 'a'.repeat(64), cell = {pitch: 90, velocity: 31}, id = 'candidate-01-90-31';
  core.startCall(roots, {id, stage: 'candidate', planSha256, values, cell, ownerId: 'test-owner'});
  const audio = Buffer.from('fixture-wav-bytes');
  core.completeCall(roots, id, {finite: true, outputGuardHits: 0}, audio);
  const reused = core.startCall(roots, {id, stage: 'candidate', planSha256, values, cell, ownerId: 'test-owner'});
  assert.equal(reused.reused, true);
  assert.equal(reused.audio.sha256, core.sha256(audio));
  assert.deepEqual(core.callCounts(roots), {started: 1, complete: 1, ambiguous: 0, incomplete: 0,
    byStage: {candidate: 1, confirmation: 0, headroom: 0, releaseEquivalence: 0, stage3: 0, stage4: 0},
    cumulative: core.HISTORICAL_CALLS + 1, cap: core.MAX_CALLS, remaining: core.MAX_CALLS - core.HISTORICAL_CALLS - 1});
});

test('prepared P5 evidence is written to the dedicated v5 roots, never the imported v4 roots', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-v5-prepare-roots-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const repo = path.join(temp, 'repo'), home = path.join(temp, 'home'), common = path.join(temp, 'common');
  for (const directory of [repo, home, common]) fs.mkdirSync(directory);
  const importedV4Roots = v4core.resolveRoots(repo, home, common);
  const preflight = {
    roots: importedV4Roots,
    history: [{id: 'historical-vector'}],
    diagnostics: {candidates: []},
    report: {schemaVersion: 1, issue: 7, contractSha256: runner.CONTRACT.sourceSha256,
      epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic, decision: 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT',
      parent: {head: 'a'.repeat(40), branch: 'codex/test'}, inventory: {v3: {}, v4: {}},
      model: {bestId: 'baseline', bestValues: core.PARAMETERS.map(item => item.baseline), rank: 4,
        conditionNumber: 12, looErrorDb: 0.1, candidateCount: 0, candidates: []}}
  };
  const remote = {pullRequest: 'https://github.com/puchinya/soraoto_dsl/pull/8', state: 'OPEN',
    branch: 'codex/test', head: 'a'.repeat(40), parent: 'b'.repeat(40), tree: 'c'.repeat(40)};
  const sourceHashes = {'test/source.cjs': 'd'.repeat(64)};
  const saved = runner.persistPreparedP5({root: repo, home, commonDirectory: common, preflight, remote, sourceHashes});

  assert.notEqual(saved.roots.primary, importedV4Roots.primary);
  assert.ok(saved.roots.primary.includes('physical-fit-v5'));
  assert.ok(core.readDual(saved.roots, runner.HISTORY_REL));
  assert.ok(core.readDual(saved.roots, runner.DIAGNOSTICS_REL));
  assert.equal(core.readDual(saved.roots, runner.P5_REL).sha256, saved.result.p5RecordSha256);
  assert.equal(v4core.readDual(importedV4Roots, runner.HISTORY_REL), null);
  assert.equal(v4core.readDual(importedV4Roots, runner.DIAGNOSTICS_REL), null);
  assert.equal(v4core.readDual(importedV4Roots, runner.P5_REL), null);
});
