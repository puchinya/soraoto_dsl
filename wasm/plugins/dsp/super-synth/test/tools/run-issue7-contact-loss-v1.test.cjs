'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('./issue7-contact-loss-v1-core.cjs');
const runner = require('./run-issue7-contact-loss-v1.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const temporary = [];
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function tempRoots() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-contact-loss-'));
  temporary.push(base);
  const root = path.join(base, 'repo'), home = path.join(base, 'home'), commonDirectory = path.join(base, 'common');
  for (const directory of [root, home, commonDirectory]) fs.mkdirSync(directory, {recursive: true});
  return {base, root, home, commonDirectory, roots: runner.resolveRoots({root, home, commonDirectory})};
}
function bytesSha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function setupPrepared({roots}) {
  const head = '1'.repeat(40), wasmSha256 = '2'.repeat(64);
  const value = {schemaVersion: 1, issue: 7, pr: 8, branch: runner.PR_BRANCH, head,
    contractSha256: runner.CONTRACT_SHA256, source: {}, build: {wasm: {sha256: wasmSha256}}, plan: core.plan()};
  runner.writeDualImmutable(roots, 'prepare.json', Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
  return {value, head, wasmSha256};
}
function writeStart(roots, cell, {head, wasmSha256}) {
  const value = {schemaVersion: 1, id: cell.id, alpha: cell.alpha, alphaOrder: cell.alphaOrder,
    pitch: cell.pitch, velocity: cell.velocity, cellOrder: cell.cellOrder,
    sourceHead: head, wasmSha256, state: 'STARTED', startedAt: '2026-11-09T00:00:00.000Z'};
  runner.writeDualImmutable(roots, `experiment/${cell.id}/start.json`,
    Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
}
function setBuildDirectory(directory, callback) {
  const name = 'SORAOTO_WASM_BUILD_DIR', previous = process.env[name];
  process.env[name] = path.resolve(directory);
  try { return callback(); }
  finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
}
function openHarness(buildDirectory) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const harness = setBuildDirectory(buildDirectory, () => new PluginHarness(ROOT, 'plugins/dsp/super-synth/plugin.wasm'));
  harness.setPlain('engine_model', 'concert_grand');
  harness.applyPreset('concert_grand');
  harness.setPlain('engine_model', 'concert_grand');
  return harness;
}
function renderShort(harness) {
  const output = [];
  for (let index = 0; index < 8; index++) {
    const events = index === 0 ? [{kind: 1, noteId: 88, pitch: 96, velocity: 31 / 127, offset: 0}] : [];
    output.push(...harness.process(128, {events})[0][0]);
  }
  return Float32Array.from(output);
}
function renderAfterAlphaSequence(buildDirectory, values) {
  const harness = openHarness(buildDirectory);
  try {
    for (const value of values) assert.equal(harness.e.soraoto_supersynth_contact_loss_set(value), 0);
    return renderShort(harness);
  } finally { harness.close(); }
}

test('dual immutable writer reads back exact bytes and does not rewrite existing epoch files', () => {
  const context = tempRoots(), original = Buffer.from('{"status":"ok"}\n');
  const created = runner.writeDualImmutable(context.roots, 'prepare.json', original);
  const target = path.join(context.roots.primary, 'prepare.json'), before = fs.statSync(target).mtimeMs;
  const reused = runner.writeDualImmutable(context.roots, 'prepare.json', original);
  assert.equal(created.status, 'CREATED');
  assert.equal(reused.status, 'REUSED');
  assert.equal(reused.sha256, bytesSha(original));
  assert.equal(fs.statSync(target).mtimeMs, before);
  assert.throws(() => runner.writeDualImmutable(context.roots, 'prepare.json', Buffer.from('different')),
    /IMMUTABLE_CONFLICT/);
});

test('one-sided and equal-length divergent evidence fail closed without repair', () => {
  const context = tempRoots(), original = Buffer.from('abcd');
  runner.writeDualImmutable(context.roots, 'marker.json', original);
  fs.unlinkSync(path.join(context.roots.secondary, 'marker.json'));
  assert.throws(() => runner.readDual(context.roots, 'marker.json'), /DUAL_COPY_MISSING/);
  fs.writeFileSync(path.join(context.roots.secondary, 'marker.json'), Buffer.from('abce'));
  assert.throws(() => runner.readDual(context.roots, 'marker.json'), /DUAL_COPY_DIVERGED/);
  assert.deepEqual(fs.readFileSync(path.join(context.roots.primary, 'marker.json')), original);
});

test('a charged start without a completion is ambiguous and is never rendered on resume', () => {
  const context = tempRoots(), prepared = setupPrepared(context), first = core.plan()[0];
  writeStart(context.roots, first, prepared);
  const state = runner.readExperimentState(context.roots);
  assert.equal(state.charged, 1);
  assert.equal(state.completed, 0);
  assert.equal(state.ambiguous, 1);
  let renders = 0;
  assert.throws(() => runner.runBounded({root: context.root, home: context.home,
    commonDirectory: context.commonDirectory, renderer: () => { renders++; }}), /AMBIGUOUS_CALL_NO_RERENDER/);
  assert.equal(renders, 0);
});

test('out-of-order and partial paired starts cannot be repaired or charged as a complete experiment', () => {
  const context = tempRoots(), prepared = setupPrepared(context), plan = core.plan();
  writeStart(context.roots, plan[1], prepared);
  assert.throws(() => runner.readExperimentState(context.roots), /START_IDENTITY|NONCONTIGUOUS_LEDGER/);
  const next = tempRoots(), state = setupPrepared(next), cell = core.plan()[0];
  const marker = Buffer.from('start');
  fs.mkdirSync(path.dirname(path.join(next.roots.secondary, `experiment/${cell.id}/start.json`)), {recursive: true});
  fs.writeFileSync(path.join(next.roots.secondary, `experiment/${cell.id}/start.json`), marker);
  assert.throws(() => runner.writeDualImmutable(next.roots, `experiment/${cell.id}/start.json`, marker), /DUAL_COPY_MISSING/);
  assert.throws(() => runner.readExperimentState(next.roots), /DUAL_COPY_MISSING/);
  assert.equal(fs.existsSync(path.join(next.roots.primary, `experiment/${cell.id}/start.json`)), false);
});

test('read-only status reports exact counters and creates no epoch files', () => {
  const context = tempRoots(), beforePrimary = fs.existsSync(context.roots.primary), beforeSecondary = fs.existsSync(context.roots.secondary);
  const result = runner.status({root: context.root, home: context.home, commonDirectory: context.commonDirectory});
  assert.deepEqual({charged: result.charged, completed: result.completed, ambiguous: result.ambiguous,
    writes: result.writes, renders: result.renders, acousticCalls: result.acousticCalls},
  {charged: 0, completed: 0, ambiguous: 0, writes: 0, renders: 0, acousticCalls: 0});
  assert.equal(fs.existsSync(context.roots.primary), beforePrimary);
  assert.equal(fs.existsSync(context.roots.secondary), beforeSecondary);
});

test('frozen-snapshot binding derives an omitted legacy digest without rewriting evidence', () => {
  const snapshot = {parent: [{path: 'ledger.json', sha256: 'a'.repeat(64), size: 17, mtimeMs: 1}]};
  const legacy = {frozenEvidenceSnapshot: snapshot, gate3: {}};
  assert.equal(runner.assertFrozenSnapshotMatches(snapshot, legacy), true);
  assert.throws(() => runner.assertFrozenSnapshotMatches({parent: []}, legacy), /FROZEN_EVIDENCE_DRIFT/);
  const forgedDigest = {frozenEvidenceSnapshot: snapshot, gate3: {frozenSnapshotSha256: 'b'.repeat(64)}};
  assert.throws(() => runner.assertFrozenSnapshotMatches(snapshot, forgedDigest), /FROZEN_EVIDENCE_DRIFT/);
  const current = {frozenEvidenceSnapshot: snapshot,
    gate3: {frozenSnapshotSha256: runner.frozenSnapshotSha256(snapshot)}};
  assert.equal(runner.assertFrozenSnapshotMatches(snapshot, current), true);
});

test('read-only CLI modes are mutually exclusive and unknown flags are rejected', () => {
  assert.equal(runner.parseMode(['--status']), 'status');
  assert.throws(() => runner.parseMode(['--status', '--verify']), /Usage:/);
  assert.throws(() => runner.parseMode(['--run-bounded', '--count', '1']), /Usage:/);
});

test('approved continuation keeps every later gate NOT RUN after its predecessor fails', () => {
  const selection = {status: 'GATE4_STRESS_PASS'};
  assert.deepEqual(runner.continuationDecision({selection: {status: core.TERMINAL}}),
    {status: core.TERMINAL, stage3: 'NOT RUN', stage4: 'NOT RUN'});
  assert.deepEqual(runner.continuationDecision({selection, confirmation: {pass: false, decision: 'BLOCKED_CONFIRMATION_FAIL'}}),
    {status: 'BLOCKED_CONFIRMATION_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'});
  assert.deepEqual(runner.continuationDecision({selection, confirmation: {pass: true},
    headroom: {pass: false, decision: 'BLOCKED_HEADROOM_FAIL'}}),
  {status: 'BLOCKED_HEADROOM_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'});
  assert.deepEqual(runner.continuationDecision({selection, confirmation: {pass: true}, headroom: {pass: true},
    release: {pass: true}, stage3: {pass: false, decision: 'BLOCKED_STAGE3_ACCEPTANCE_FAIL'}}),
  {status: 'BLOCKED_STAGE3_ACCEPTANCE_FAIL', stage3: 'BLOCKED_STAGE3_ACCEPTANCE_FAIL', stage4: 'NOT RUN'});
  assert.deepEqual(runner.continuationDecision({selection, confirmation: {pass: true}, headroom: {pass: true},
    release: {pass: true}, stage3: {pass: true}, stage4: {pass: false, decision: 'BLOCKED_STAGE4_LIFECYCLE'}}),
  {status: 'BLOCKED_STAGE4_LIFECYCLE', stage3: 'PASS', stage4: 'BLOCKED_STAGE4_LIFECYCLE'});
});

test('storage preflight bounds the authorized dual-store WAV and metadata plan', () => {
  const full = runner.estimateDualEvidenceBytes();
  const stage4Only = runner.estimateDualEvidenceBytes({remaining: {stage4: 1423}});
  assert.ok(full.oneStoreBytes > stage4Only.oneStoreBytes);
  assert.equal(full.dualStoreBytes, full.oneStoreBytes * 2);
  assert.throws(() => runner.estimateDualEvidenceBytes({remaining: {stage4: -1}}), /STORAGE_ESTIMATE/);
});

test('test-only setter exports and state gates follow the configured WASM identity', t => {
  const buildDirectory = process.env.SORAOTO_WASM_BUILD_DIR || path.join(ROOT, 'build/wasm');
  const wasmPath = path.join(buildDirectory, 'plugins/dsp/super-synth/plugin.wasm');
  if (!fs.existsSync(wasmPath)) { t.skip('WASM build is not present'); return; }
  const harness = openHarness(buildDirectory);
  try {
    const hasSet = typeof harness.e.soraoto_supersynth_contact_loss_set === 'function';
    const hasGet = typeof harness.e.soraoto_supersynth_contact_loss_get === 'function';
    assert.equal(hasSet, hasGet, 'contact-loss setter and getter must be exported together');
    if (!hasSet) return;
    assert.equal(harness.e.soraoto_supersynth_contact_loss_get(), 1);
    for (const invalid of [NaN, Infinity, -Infinity, 0.99]) {
      assert.notEqual(harness.e.soraoto_supersynth_contact_loss_set(invalid), 0);
      assert.equal(harness.e.soraoto_supersynth_contact_loss_get(), 1);
    }
    assert.equal(harness.e.soraoto_supersynth_contact_loss_set(0.6500005), 0);
    assert.ok(Math.abs(harness.e.soraoto_supersynth_contact_loss_get() - 0.65) <= 1e-6);
    const alpha = [1, 0.5, 0.65, 0.8, 1.2, 1.4];
    for (const value of alpha) {
      assert.equal(harness.e.soraoto_supersynth_contact_loss_set(value), 0);
      assert.ok(Math.abs(harness.e.soraoto_supersynth_contact_loss_get() - value) <= 1e-6);
    }
  } finally { harness.close(); }
  const direct = renderAfterAlphaSequence(buildDirectory, [0.65]);
  const afterOtherValue = renderAfterAlphaSequence(buildDirectory, [1.4, 0.65]);
  assert.deepEqual(afterOtherValue, direct, 'coefficient assignment must derive from the factory base, not prior alpha');
});

test('diagnostic setter rejects wrong-engine and active-voice mutations', t => {
  const buildDirectory = process.env.SORAOTO_WASM_BUILD_DIR || path.join(ROOT, 'build/wasm');
  const wasmPath = path.join(buildDirectory, 'plugins/dsp/super-synth/plugin.wasm');
  if (!fs.existsSync(wasmPath)) { t.skip('WASM build is not present'); return; }
  const harness = openHarness(buildDirectory);
  try {
    const setter = harness.e.soraoto_supersynth_contact_loss_set;
    if (typeof setter !== 'function') { assert.equal(typeof harness.e.soraoto_supersynth_contact_loss_get, 'undefined'); return; }
    assert.equal(harness.e.soraoto_supersynth_active_voice_count(), 0);
    assert.equal(setter(0.5), 0);
    harness.setPlain('engine_model', 'wavetable');
    assert.notEqual(setter(0.5), 0);
    assert.equal(harness.e.soraoto_supersynth_contact_loss_get(), -1);
    harness.setPlain('engine_model', 'concert_grand');
    assert.equal(harness.e.soraoto_supersynth_contact_loss_get(), 0.5, 'wrong-engine rejection must leave the selected alpha unchanged');
    assert.equal(setter(0.65), 0);
    harness.process(128, {events: [{kind: 1, noteId: 12, pitch: 96, velocity: 0.8, offset: 0}]});
    assert.ok(harness.e.soraoto_supersynth_active_voice_count() > 0);
    assert.notEqual(setter(0.8), 0);
    assert.equal(harness.e.soraoto_supersynth_contact_loss_get(), -1);
    harness.process(128, {events: [{kind: 2, noteId: 12, pitch: 96, velocity: 0, offset: 0}]});
    for (let block = 0; block < 3000 && harness.e.soraoto_supersynth_active_voice_count() > 0; block++) {
      harness.process(128, {events: []});
    }
    assert.equal(harness.e.soraoto_supersynth_active_voice_count(), 0, 'test note must finish before checking the rejected mutation');
    assert.ok(Math.abs(harness.e.soraoto_supersynth_contact_loss_get() - 0.65) <= 1e-6,
      'active-voice rejection must leave the selected alpha unchanged');
  } finally { harness.close(); }
});

test('regular production build has no contact-loss setter/getter exports', t => {
  const production = process.env.ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR;
  if (!production) { t.skip('provide regular production build directory'); return; }
  const bytes = fs.readFileSync(path.join(production, 'plugins/dsp/super-synth/plugin.wasm'));
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(row => row.name);
  assert.equal(exports.includes('soraoto_supersynth_contact_loss_set'), false);
  assert.equal(exports.includes('soraoto_supersynth_contact_loss_get'), false);
});

test('alpha-one diagnostic PCM matches regular production when both builds are available', t => {
  const diagnostic = process.env.SORAOTO_WASM_BUILD_DIR || path.join(ROOT, 'build/wasm-contact-loss');
  const production = process.env.ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR;
  if (!production || !fs.existsSync(path.join(diagnostic, 'plugins/dsp/super-synth/plugin.wasm'))
      || !fs.existsSync(path.join(production, 'plugins/dsp/super-synth/plugin.wasm'))) {
    t.skip('provide diagnostic and production build directories to compare alpha-one PCM'); return;
  }
  const testHarness = openHarness(diagnostic), releaseHarness = openHarness(production);
  try {
    const setter = testHarness.e.soraoto_supersynth_contact_loss_set;
    if (typeof setter !== 'function') throw new Error('diagnostic build lacks setter export');
    assert.equal(setter(1), 0);
    const testSamples = renderShort(testHarness), releaseSamples = renderShort(releaseHarness);
    assert.deepEqual(testSamples, releaseSamples);
  } finally { testHarness.close(); releaseHarness.close(); }
});

test.after(() => { for (const directory of temporary) fs.rmSync(directory, {recursive: true, force: true}); });
