'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('./issue7-physical-identification-v1-core.cjs');
const runner = require('./run-issue7-physical-identification-v1.cjs');
const directMetrics = require('./stage3-direct-reference-metrics.cjs');
const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');

test('physical-identification allocation is fixed and totals the approved acoustic cap', () => {
  assert.equal(core.HISTORICAL_CALLS, 3069);
  assert.equal(core.MAX_CALLS, 5105);
  assert.deepEqual(core.STAGES, {baseline: 7, finiteDifference: 42, candidate: 49, holdout: 25, headroom: 4, stage3: 486, stage4: 1423});
  assert.equal(core.assertBudget([]).remaining, 2036);
  assert.equal(core.baselineCells().length, 7);
  assert.equal(core.finiteDifferenceCells().length, 42);
  assert.equal(core.holdoutCells().length, 25);
  assert.equal(core.headroomCells().length, 4);
  assert.equal(runner.SOURCE_FILES.includes('wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.test.cjs'), true);
});

test('candidate values stay within the approved box and invalid values fail closed', () => {
  const baseline = core.PARAMS.map(parameter => parameter.baseline);
  assert.deepEqual(core.validateCandidate(baseline), baseline);
  assert.throws(() => core.validateCandidate([1.05, 0.5, 0.02]), /BLOCKED_PHYSICAL_PARAMETER_BOUNDS/);
  assert.throws(() => core.validateCandidate([1.05, Number.NaN, 0.018]), /BLOCKED_PHYSICAL_PARAMETER_BOUNDS/);
  assert.throws(() => core.candidateCells([baseline, baseline]), /BLOCKED_PHYSICAL_DUPLICATE_CANDIDATE/);
  assert.equal(core.candidateCells([baseline]).length, 7);
});

test('central differences identify three parameters and damped steps remain at most five percent', () => {
  const baseline = core.SCREEN_CELLS.map((_, index) => [index, index + 1, index + 2]);
  const positive = [0, 1, 2].map(parameter => baseline.map(row => row.map((value, feature) => value + (feature === parameter ? 0.2 : 0))));
  const negative = [0, 1, 2].map(parameter => baseline.map(row => row.map((value, feature) => value - (feature === parameter ? 0.2 : 0))));
  const sensitivity = core.centralDifferences({baseline, positive, negative, steps: [0.1, 0.1, 0.1]});
  assert.equal(sensitivity.rows.length, 21);
  assert.equal(core.matrixRank3(sensitivity.rows), 3);
  const solved = core.dampedLeastSquares({sensitivity: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], residual: [10, -5, 2], lambda: 0.01});
  assert.equal(solved.rank, 3);
  assert.ok(Math.max(...solved.delta.map((value, index) => Math.abs(value / core.PARAMS[index].baseline))) <= 0.05 + 1e-12);
  assert.throws(() => core.dampedLeastSquares({sensitivity: [[1, 0, 0], [2, 0, 0], [3, 0, 0]], residual: [1, 1, 1]}), /BLOCKED_PHYSICAL_PARAMETER_UNIDENTIFIABLE/);
});

test('official evaluation receives normalized rows without mapping them a second time', () => {
  const original = directMetrics.evaluateDirectReferenceMatrix;
  const referenceRows = [{pitch: 60, velocity: 64, metrics: {}}];
  const actualRows = [{pitch: 60, velocity: 64, metrics: {official: {finite: true}}}];
  let received;
  directMetrics.evaluateDirectReferenceMatrix = (reference, actual, options) => {
    received = {reference, actual, options};
    return {decision: 'TEST_STUB'};
  };
  try {
    assert.deepEqual(runner.evaluateOfficial(referenceRows, actualRows, [64]), {decision: 'TEST_STUB'});
    assert.deepEqual(received, {reference: referenceRows, actual: actualRows, options: {requiredVelocityLayers: [64]}});
  } finally {
    directMetrics.evaluateDirectReferenceMatrix = original;
  }
});

test('dual-store ledger charges before completion and binds immutable results', t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'issue7-physical-v1-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const roots = {primary: path.join(root, 'primary'), secondary: path.join(root, 'secondary')};
  fs.mkdirSync(roots.primary); fs.mkdirSync(roots.secondary);
  const plan = core.createPlan('baseline', {identity: {fixture: 'test'}, cells: core.baselineCells()});
  const ledger = core.freshLedger(plan); core.saveLedger(roots, ledger);
  const cell = plan.cells[0];
  core.startCell(roots, plan, ledger, cell, {ownerId: 'unit-test'});
  assert.equal(ledger.accounting.charged, 1);
  core.completeCell(roots, plan, ledger, cell, {finite: true, sample: 0.25});
  assert.equal(core.verifyLedger(roots, plan, ledger).COMPLETE, 1);
  assert.equal(core.assertBudget([ledger]).charged, 1);
  assert.throws(() => core.writeImmutableDual(roots, 'baseline/cells/conflict.json', 'first').sha256 &&
    core.writeImmutableDual(roots, 'baseline/cells/conflict.json', 'second'), /BLOCKED_PHYSICAL_IMMUTABLE_CONFLICT/);
});

test('physical-identification controls are guarded by the opt-in test-only build flag', () => {
  const cmake = fs.readFileSync(path.resolve(__dirname, '../../../../../../wasm/CMakeLists.txt'), 'utf8');
  const pluginCmake = fs.readFileSync(path.resolve(__dirname, '../../../../../../wasm/cmake/wasm_plugin.cmake'), 'utf8');
  const source = fs.readFileSync(path.resolve(__dirname, '../../../../../../wasm/plugins/dsp/super-synth/src/plugin.c'), 'utf8');
  assert.match(cmake, /option\(SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS[\s\S]*?OFF\)/);
  assert.match(pluginCmake, /if\(SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS\)[\s\S]*?SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS=1/);
  assert.match(source, /#if defined\(SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS\)[\s\S]*?soraoto_supersynth_physical_identification_set/);
});

test('diagnostic parameter setter enforces finite bounded values without processing audio', t => {
  const wasm = runner.wasmPath();
  if (!fs.existsSync(wasm)) return t.skip('diagnostic WASM has not been built');
  assert.doesNotThrow(() => runner.assertDiagnosticExports(wasm));
  const envKey = 'SORAOTO_WASM_BUILD_DIR', prior = process.env[envKey];
  process.env[envKey] = runner.BUILD_DIR;
  const harness = new PluginHarness(runner.ROOT, runner.WASM_REL, {sampleRate: 48000, maxFrames: 128});
  try {
    harness.applyPreset('concert_grand');
    const expected = [1.05, 0.5, 0.018];
    for (let index = 0; index < expected.length; index++) assert.ok(Math.abs(harness.e.soraoto_supersynth_physical_identification_get(index) - expected[index]) < 1e-6);
    assert.equal(harness.e.soraoto_supersynth_physical_identification_set(0, 1.1025), 0);
    assert.ok(Math.abs(harness.e.soraoto_supersynth_physical_identification_get(0) - 1.1025) < 1e-6);
    assert.equal(harness.e.soraoto_supersynth_physical_identification_set(0, 1.2), -3);
    assert.equal(harness.e.soraoto_supersynth_physical_identification_set(1, Number.NaN), -1);
    assert.equal(harness.e.soraoto_supersynth_physical_identification_set(3, 0.5), -1);
    harness.e.soraoto_supersynth_physical_identification_observation_reset();
  } finally {
    harness.close();
    if (prior === undefined) delete process.env[envKey]; else process.env[envKey] = prior;
  }
});
