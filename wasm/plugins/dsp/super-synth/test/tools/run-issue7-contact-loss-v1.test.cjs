'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('./issue7-contact-loss-v1-core.cjs');
const runner = require('./run-issue7-contact-loss-v1.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const temporary = [];
function currentHead() {
  return execFileSync('rtk', ['git', 'rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
}
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
function setupPrepared({roots, head = '1'.repeat(40), wasmSha256 = '2'.repeat(64)}) {
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
function syntheticHarnessFactory(cell, wasmBytes = Buffer.from('synthetic-contact-loss-diagnostic-wasm')) {
  const base = runner.analyzerFixture(cell.pitch), scale = cell.velocity / 127;
  const left = Float32Array.from(base.left, value => value * scale);
  const right = Float32Array.from(base.right, value => value * scale);
  let cursor = 0, alpha = 1;
  return () => ({bytes: wasmBytes, applyPreset() {}, setPlain() {}, close() {},
    e: {soraoto_supersynth_contact_loss_set(value) { alpha = value; return 0; },
      soraoto_supersynth_contact_loss_get() { return alpha; },
      soraoto_supersynth_guard_hit_count() { return 0; }},
    process(count) {
      const l = left.slice(cursor, cursor + count), r = right.slice(cursor, cursor + count);
      cursor += count;
      return [[l, r]];
    }});
}
function persistCapture(roots, cell, capture) {
  const base = `experiment/${cell.id}`, audioSha256 = bytesSha(capture.audio);
  const metadata = {...capture.metadata, audioSha256, completedAt: '2026-11-14T00:00:00.000Z'};
  const metadataBytes = Buffer.from(`${JSON.stringify(stable(metadata), null, 2)}\n`);
  runner.writeDualImmutable(roots, `${base}/audio.wav`, capture.audio);
  runner.writeDualImmutable(roots, `${base}/metadata.json`, metadataBytes);
  runner.writeDualImmutable(roots, `${base}/complete.json`, Buffer.from(`${JSON.stringify(stable({
    schemaVersion: 1, id: cell.id, state: 'COMPLETE', audioSha256,
    metadataSha256: bytesSha(metadataBytes), completedAt: metadata.completedAt
  }), null, 2)}\n`));
}
function writeAlphaStart(roots, cell, identity) { writeStart(roots, cell, identity); }
function assertCmakeRole(directory, expected) {
  const cachePath = path.join(directory, 'CMakeCache.txt');
  assert.ok(fs.existsSync(cachePath), `required CMake cache is missing: ${directory}`);
  const cache = fs.readFileSync(cachePath, 'utf8');
  for (const [name, value] of Object.entries(expected)) {
    assert.match(cache, new RegExp(`^${name}:[^=]+=${value}$`, 'm'), `${name} must be ${value}`);
  }
  assert.ok(cache.includes(`CMAKE_HOME_DIRECTORY:INTERNAL=${path.join(ROOT, 'wasm')}`));
  assert.ok(cache.includes(`CMAKE_TOOLCHAIN_FILE:FILEPATH=${path.join(ROOT, 'wasm/cmake/wasm32-clang.cmake')}`));
}
function strictBuildMatrix() {
  const required = process.env.ISSUE7_CONTACT_LOSS_REQUIRE_BUILD_MATRIX === '1';
  if (required) {
    assert.ok(process.env.ISSUE7_CONTACT_LOSS_BUILD_DIR, 'explicit diagnostic build directory is required');
    assert.ok(process.env.ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR, 'explicit production build directory is required');
    const diagnostic = path.resolve(process.env.ISSUE7_CONTACT_LOSS_BUILD_DIR);
    const production = path.resolve(process.env.ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR);
    assert.notEqual(diagnostic, production, 'diagnostic and production builds must use separate directories');
    assertCmakeRole(diagnostic, {BUILD_TESTING: 'ON', SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS: 'ON',
      SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS: 'ON', SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS: 'OFF'});
    assertCmakeRole(production, {BUILD_TESTING: 'OFF', SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS: 'OFF',
      SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS: 'OFF', SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS: 'OFF'});
  }
  return required;
}

test('actual analyzer wrapper survives first-call readback and a complete alpha-one seven-cell baseline', () => {
  const context = tempRoots(), head = currentHead();
  const wasmBytes = Buffer.from('synthetic-contact-loss-diagnostic-wasm'), wasmSha256 = bytesSha(wasmBytes);
  const prepared = setupPrepared({roots: context.roots, head, wasmSha256});
  const identity = {head: prepared.head, wasmSha256: prepared.wasmSha256};
  const calls = core.plan().slice(0, 7);
  for (const [index, cell] of calls.entries()) {
    writeAlphaStart(context.roots, cell, identity);
    const capture = runner.renderCall({root: ROOT, buildDirectory: 'unused-synthetic-build', cell,
      harnessFactory: syntheticHarnessFactory(cell, wasmBytes)});
    assert.equal(capture.metadata.finite, capture.metadata.metrics.official.finite);
    assert.equal(typeof capture.metadata.finite, 'boolean');
    persistCapture(context.roots, cell, capture);
    const state = runner.readExperimentState(context.roots);
    assert.equal(state.completed, index + 1, `cell ${index} must survive dual-store readback`);
  }
  const state = runner.readExperimentState(context.roots);
  const loss = require('./physical-fit-v4-loss.cjs');
  const baselineCalls = state.calls.slice(0, 7);
  const refs = baselineCalls.map(row => ({pitch: row.cell.pitch, velocity: row.cell.velocity,
    metrics: row.metadata.value.metrics,
    audio: loss.decodeFloat32StereoWav(row.audio.bytes)}));
  const baseline = runner.scoreCompletedAlpha({alphaOrder: 0, calls: baselineCalls, refs,
    sourceHead: head, wasmSha256});
  assert.equal(baseline.alpha, 1);
  assert.equal(baseline.official.coverage.cells, 7);
  assert.equal(baseline.cells.length, 7);
  assert.ok(Number.isFinite(baseline.familyLoss));
  runner.writeDualImmutable(context.roots, 'experiment/alpha-00.json',
    Buffer.from(`${JSON.stringify(stable(baseline), null, 2)}\n`));
  const parsed = runner.readExperimentState(context.roots);
  assert.equal(parsed.candidateResults.length, 1);
  assert.equal(parsed.candidateResults[0].alpha, 1);
});

test('completed readback rejects missing official metrics without changing either copy', () => {
  const context = tempRoots(), head = currentHead();
  const wasmBytes = Buffer.from('synthetic-contact-loss-diagnostic-wasm'), wasmSha256 = bytesSha(wasmBytes);
  const prepared = setupPrepared({roots: context.roots, head, wasmSha256});
  const cell = core.plan()[0], identity = {head: prepared.head, wasmSha256: prepared.wasmSha256};
  writeAlphaStart(context.roots, cell, identity);
  const capture = runner.renderCall({root: ROOT, buildDirectory: 'unused-synthetic-build', cell,
    harnessFactory: syntheticHarnessFactory(cell, wasmBytes)});
  const damaged = {...capture, metadata: {...capture.metadata, metrics: {...capture.metadata.metrics, official: undefined}}};
  persistCapture(context.roots, cell, damaged);
  const before = ['primary', 'secondary'].map(key => fs.readFileSync(path.join(context.roots[key], 'experiment', cell.id, 'metadata.json')));
  assert.throws(() => runner.readExperimentState(context.roots), /BLOCKED_CONTACT_LOSS_COMPLETE_IDENTITY/);
  const after = ['primary', 'secondary'].map(key => fs.readFileSync(path.join(context.roots[key], 'experiment', cell.id, 'metadata.json')));
  assert.deepEqual(after, before);
});

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
  const required = strictBuildMatrix();
  const buildDirectory = process.env.ISSUE7_CONTACT_LOSS_BUILD_DIR
    || process.env.SORAOTO_WASM_BUILD_DIR || path.join(ROOT, 'build/wasm');
  const wasmPath = path.join(buildDirectory, 'plugins/dsp/super-synth/plugin.wasm');
  if (!fs.existsSync(wasmPath)) {
    if (required) assert.fail(`required diagnostic WASM is missing: ${wasmPath}`);
    t.skip('WASM build is not present'); return;
  }
  const harness = openHarness(buildDirectory);
  try {
    const hasSet = typeof harness.e.soraoto_supersynth_contact_loss_set === 'function';
    const hasGet = typeof harness.e.soraoto_supersynth_contact_loss_get === 'function';
    assert.equal(hasSet, hasGet, 'contact-loss setter and getter must be exported together');
    if (!hasSet) {
      if (required) assert.fail('required diagnostic WASM lacks contact-loss setter/getter exports');
      return;
    }
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
  const required = strictBuildMatrix();
  const buildDirectory = process.env.ISSUE7_CONTACT_LOSS_BUILD_DIR
    || process.env.SORAOTO_WASM_BUILD_DIR || path.join(ROOT, 'build/wasm');
  const wasmPath = path.join(buildDirectory, 'plugins/dsp/super-synth/plugin.wasm');
  if (!fs.existsSync(wasmPath)) {
    if (required) assert.fail(`required diagnostic WASM is missing: ${wasmPath}`);
    t.skip('WASM build is not present'); return;
  }
  const harness = openHarness(buildDirectory);
  try {
    const setter = harness.e.soraoto_supersynth_contact_loss_set;
    if (typeof setter !== 'function') {
      assert.equal(typeof harness.e.soraoto_supersynth_contact_loss_get, 'undefined');
      if (required) assert.fail('required diagnostic WASM lacks contact-loss setter/getter exports');
      return;
    }
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
  const required = strictBuildMatrix();
  const production = process.env.ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR;
  if (!production) {
    if (required) assert.fail('required production build directory is not configured');
    t.skip('provide regular production build directory'); return;
  }
  const wasmPath = path.join(production, 'plugins/dsp/super-synth/plugin.wasm');
  if (!fs.existsSync(wasmPath) && required) assert.fail(`required production WASM is missing: ${wasmPath}`);
  const bytes = fs.readFileSync(wasmPath);
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(row => row.name);
  assert.equal(exports.includes('soraoto_supersynth_contact_loss_set'), false);
  assert.equal(exports.includes('soraoto_supersynth_contact_loss_get'), false);
});

test('alpha-one diagnostic PCM matches regular production when both builds are available', t => {
  const required = strictBuildMatrix();
  const diagnostic = process.env.ISSUE7_CONTACT_LOSS_BUILD_DIR
    || process.env.SORAOTO_WASM_BUILD_DIR || path.join(ROOT, 'build/wasm-contact-loss');
  const production = process.env.ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR;
  if (!production || !fs.existsSync(path.join(diagnostic, 'plugins/dsp/super-synth/plugin.wasm'))
      || !fs.existsSync(path.join(production, 'plugins/dsp/super-synth/plugin.wasm'))) {
    if (required) assert.fail('required diagnostic/release WASM pair is unavailable for alpha-one PCM equivalence');
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
