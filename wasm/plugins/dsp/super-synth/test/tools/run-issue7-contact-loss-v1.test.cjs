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
function initFixtureRepo(root, branch = runner.PR_BRANCH) {
  execFileSync('rtk', ['git', 'init', '--quiet', '-b', branch], {cwd: root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'config', 'user.name', 'Issue 7 Fixture'], {cwd: root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'config', 'user.email', 'issue7-fixture@example.invalid'], {cwd: root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'commit', '--allow-empty', '-m', 'fixture head'], {cwd: root, stdio: 'ignore'});
  return execFileSync('rtk', ['git', 'rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
}
function bytesSha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function setupPreflight({roots, head, wasmSha256, source, parentEpoch, gate3Sha256, frozenEvidenceSnapshot}) {
  const hash = 'a'.repeat(64), preflightFile = runner.preflightFileName(head);
  const report = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT', decision: 'PREPARE_PREFLIGHT_READY',
    epoch: runner.ACTIVE_EPOCH, head, branch: runner.PR_BRANCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    ctestOrderContractSha256: runner.CTEST_ORDER_CONTRACT_SHA256,
    issueApprovalMarker: 'ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED',
    successorApprovalMarker: runner.SUCCESSOR_APPROVAL_MARKER,
    ctestOrderApprovalMarker: runner.CTEST_ORDER_APPROVAL_MARKER,
    parentProof: parentEpoch, gate3: {analysisSha256: gate3Sha256},
    frozenEvidenceSnapshot, frozenSnapshotSha256: runner.frozenSnapshotSha256(frozenEvidenceSnapshot), source,
    baselineInputs: {baselineHead: runner.BASELINE_HEAD,
      unchangedPaths: [...runner.BASELINE_INPUT_PATHS], sourceHashes: runner.BASELINE_TEST_SOURCE_HASHES},
    builds: {diagnostic: {pass: true, wasm: {sha256: wasmSha256}},
      production: {pass: true, wasm: {sha256: 'c'.repeat(64)}}},
    checks: {
      focusedNode: {tests: 1, passed: 1, failed: 0, skipped: 0, stdoutSha256: hash, stderrSha256: hash},
      focusedCTest: {tests: 2, passed: 2, failed: 0, skipped: 0, stdoutSha256: hash, stderrSha256: hash},
      offlineFrozen: {tests: 1, passed: 1, failed: 0, skipped: 0, stdoutSha256: hash, stderrSha256: hash,
        sourceContext: {kind: 'P3_PINNED_TEMP_WORKTREE', head,
          p3CreatorCommit: '6'.repeat(40), p3RecordSha256: '7'.repeat(64),
          p3SourceCount: runner.P3_PINNED_SOURCE_COUNT, p3SourceManifestSha256: '8'.repeat(64),
          originalP1WasmSha256: runner.P1_DIAGNOSTIC_WASM_SHA256, originalP1WasmSize: 427000,
          upstreamVerified: true, worktreeRemoved: true, branchRemoved: true}},
      fullCTest: {decision: 'BASELINE_FAILURES_DISCLOSED', baselineHead: runner.BASELINE_HEAD,
        exitCode: 8, testCount: 50, failedCount: 3, skippedCount: 0,
        failureNames: ['wasm.audio-quality-regression',
          'wasm.dsp.super-synth.supersynth-v9-full-range-calibration',
          'wasm.dsp.super-synth.supersynth-v9-production-lifecycle'],
        signatures: {audioQuality: 'field-wind-over-lumeria: true peak -32.387194396613445',
          productionLifecycleReportSha256: '9f0e33296134825b9dc0e86f097e4648763fcae5378452bf85e4491a56df8de0',
          productionWasmSha256: 'f36b18c705a4ac1c965f10712ae2ebde86106c6048b3f5f6a59036e721163fd3',
          stage4Input: 'persisted Stage4 lifecycle matrix is required; the Stage4 runner owns all acoustic renders'},
        stdoutSha256: hash, stderrSha256: hash}
    }};
  runner.assertPreflightReceiptShape(report, head);
  const bytes = Buffer.from(`${JSON.stringify(stable(report), null, 2)}\n`);
  runner.writeDualImmutable(roots, preflightFile, bytes);
  return {preflightFile, preflightSha256: bytesSha(bytes), report};
}
function decodeAudio(wav) {
  return require('./physical-fit-v4-loss.cjs').decodeFloat32StereoWav(wav);
}
function dualTreeInventory(roots) {
  const inventory = {};
  for (const copy of ['primary', 'secondary']) {
    const entries = [];
    const walk = (directory, relative = '') => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
        const childRelative = path.join(relative, entry.name), child = path.join(directory, entry.name);
        const stat = fs.statSync(child);
        if (entry.isDirectory()) {
          entries.push({path: childRelative, type: 'directory', mtimeMs: stat.mtimeMs});
          walk(child, childRelative);
        } else {
          const bytes = fs.readFileSync(child);
          entries.push({path: childRelative, type: 'file', size: bytes.length, sha256: bytesSha(bytes), mtimeMs: stat.mtimeMs});
        }
      }
    };
    walk(roots[copy]);
    inventory[copy] = entries;
  }
  return inventory;
}
function setupPrepared({roots, head = '1'.repeat(40), wasmSha256 = '2'.repeat(64), source = {}, parentProof = null}) {
  const frozenEvidenceSnapshot = {fixtureSnapshot: 'unchanged'};
  const gate3 = {status: 'GATE3_ANALYSIS_PASS', head,
    frozenSnapshotSha256: runner.frozenSnapshotSha256(frozenEvidenceSnapshot)};
  const gate3Bytes = Buffer.from(`${JSON.stringify(stable(gate3), null, 2)}\n`), gate3Sha256 = bytesSha(gate3Bytes);
  const parentEpoch = parentProof || {epoch: runner.PARENT_EPOCH, head: runner.PARENT_HEAD,
    prepareSha256: runner.PARENT_PREPARE_SHA256, planSha256: runner.PARENT_PLAN_SHA256,
    gate3Sha256: runner.PARENT_GATE3_SHA256,
    charged: 0, completed: 0, ambiguous: 0};
  const preflight = setupPreflight({roots, head, wasmSha256, source, parentEpoch,
    gate3Sha256, frozenEvidenceSnapshot});
  const value = {schemaVersion: 2, issue: 7, pr: 8, branch: runner.PR_BRANCH, head,
    epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: 'ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED',
    successorApprovalMarker: runner.SUCCESSOR_APPROVAL_MARKER,
    ctestOrderContractSha256: runner.CTEST_ORDER_CONTRACT_SHA256,
    ctestOrderApprovalMarker: runner.CTEST_ORDER_APPROVAL_MARKER,
    preflightFile: preflight.preflightFile, preflightSha256: preflight.preflightSha256, parentEpoch,
    gate3: {status: 'GATE3_ANALYSIS_PASS', analysisSha256: gate3Sha256, frozenSnapshotSha256: gate3.frozenSnapshotSha256},
    frozenEvidenceSnapshot,
    source, build: {diagnosticBuildDirectory: 'build/diag', wasm: {sha256: wasmSha256, size: 123}}, plan: core.plan(),
    startedCalls: 0, completedCalls: 0, ambiguousCalls: 0, budget: core.accounting()};
  const plan = {schemaVersion: 2, epoch: runner.ACTIVE_EPOCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256, plan: core.plan(), callCap: 42,
    historicalCalls: 3251, lifetimeCap: 5255, downstreamReserve: 1962};
  runner.writeDualImmutable(roots, 'gate3-analysis.json', gate3Bytes);
  runner.writeDualImmutable(roots, 'plan.json', Buffer.from(`${JSON.stringify(stable(plan), null, 2)}\n`));
  runner.writeDualImmutable(roots, 'prepare.json', Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
  return {value, head, wasmSha256};
}
function commitFixtureSource(root) {
  const source = {};
  for (const relative of runner.SOURCE_FILES) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const bytes = relative === 'wasm/plugins/dsp/super-synth/presets.json'
      ? Buffer.from('{"concert_grand":{"engine_config":{"hammer":{"contact_loss_soft":0.08,"contact_loss_hard":0.28}}}}\n')
      : Buffer.from(`fixture:${relative}`);
    fs.writeFileSync(file, bytes);
    const stat = fs.statSync(file);
    source[relative] = {sha256: bytesSha(bytes), size: bytes.length, mtimeMs: stat.mtimeMs};
  }
  execFileSync('rtk', ['git', 'add', ...runner.SOURCE_FILES], {cwd: root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'commit', '--quiet', '-m', 'fixture source snapshot'], {cwd: root, stdio: 'ignore'});
  return {source, head: execFileSync('rtk', ['git', 'rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim()};
}
function preparedStatusFixture() {
  const context = tempRoots(), parent = setupSyntheticParent(context);
  initFixtureRepo(context.root);
  const source = commitFixtureSource(context.root);
  const parentProof = {epoch: runner.PARENT_EPOCH, head: runner.PARENT_HEAD,
    prepareSha256: runner.PARENT_PREPARE_SHA256, planSha256: runner.PARENT_PLAN_SHA256,
    gate3Sha256: runner.PARENT_GATE3_SHA256, charged: 0, completed: 0, ambiguous: 0};
  const prepared = setupPrepared({roots: context.roots, head: source.head,
    source: source.source, parentProof});
  return {...context, parent, parentProof, prepared, head: source.head};
}
function verifyFixtureParent(context, options) {
  const actual = runner.verifyParentExperiment01(options, {expected: context.parent.expected});
  return {...actual, proof: context.parentProof};
}
function writeCompletedCall(roots, cell, prepared, {scale = 1, guardHits = 0} = {}) {
  writeStart(roots, cell, prepared);
  const fixture = runner.analyzerFixture(cell.pitch);
  for (let index = 0; index < fixture.left.length; index++) {
    fixture.left[index] *= scale;
    fixture.right[index] *= scale;
  }
  const audio = runner.writeFloatWav(fixture.left, fixture.right), audioSha256 = bytesSha(audio);
  const metrics = runner.normalizeAnalyzerMetrics(require('./analyze-issue7-physical-identification.cjs')
    .analyze(fixture.left, fixture.right, cell.pitch, 48000), guardHits);
  const metadata = {epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    id: cell.id, alpha: cell.alpha, alphaOrder: cell.alphaOrder, pitch: cell.pitch,
    velocity: cell.velocity, cellOrder: cell.cellOrder, sourceHead: prepared.head,
    wasmSha256: prepared.wasmSha256, finite: metrics.official.finite, guardHits, metrics, audioSha256};
  const metadataBytes = Buffer.from(`${JSON.stringify(stable(metadata), null, 2)}\n`);
  runner.writeDualImmutable(roots, `experiment/${cell.id}/audio.wav`, audio);
  runner.writeDualImmutable(roots, `experiment/${cell.id}/metadata.json`, metadataBytes);
  runner.writeDualImmutable(roots, `experiment/${cell.id}/complete.json`, Buffer.from(`${JSON.stringify(stable({
    schemaVersion: 1, epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    id: cell.id, state: 'COMPLETE', audioSha256, metadataSha256: bytesSha(metadataBytes),
    completedAt: '2026-11-14T00:00:00.000Z'}), null, 2)}\n`));
  return {audio, metadata};
}
function writeStart(roots, cell, {head, wasmSha256}) {
  const value = {schemaVersion: 1, epoch: runner.ACTIVE_EPOCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256, id: cell.id, alpha: cell.alpha, alphaOrder: cell.alphaOrder,
    pitch: cell.pitch, velocity: cell.velocity, cellOrder: cell.cellOrder,
    sourceHead: head, wasmSha256, state: 'STARTED', startedAt: '2026-11-09T00:00:00.000Z'};
  runner.writeDualImmutable(roots, `experiment/${cell.id}/start.json`,
    Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
}
function setupSyntheticParent(context, {startedCalls = 0, extraFile = false} = {}) {
  const roots = runner.resolveRoots({root: context.root, home: context.home,
    commonDirectory: context.commonDirectory, epoch: runner.PARENT_EPOCH});
  const gate3 = {status: 'GATE3_ANALYSIS_PASS', head: runner.PARENT_HEAD,
    contractSha256: runner.CONTRACT_SHA256, cellCount: 140, observationCount: 20,
    causalStatus: 'NOT_CONFIRMED', archiveSha256: 'a'.repeat(64), offlineReportSha256: 'b'.repeat(64)};
  const gate3Bytes = Buffer.from(`${JSON.stringify(stable(gate3), null, 2)}\n`), gate3Sha256 = bytesSha(gate3Bytes);
  const plan = {schemaVersion: 1, plan: core.plan(), callCap: 42,
    historicalCalls: 3251, lifetimeCap: 5255, downstreamReserve: 1962};
  const planBytes = Buffer.from(`${JSON.stringify(stable(plan), null, 2)}\n`);
  const prepare = {schemaVersion: 1, issue: 7, pr: 8, branch: runner.PR_BRANCH, head: runner.PARENT_HEAD,
    contractSha256: runner.CONTRACT_SHA256, approvalMarker: 'ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED',
    gate3: {...gate3, analysisSha256: gate3Sha256}, plan: core.plan(), startedCalls,
    completedCalls: 0, ambiguousCalls: 0,
    budget: core.accounting({startedExperimentCalls: startedCalls})};
  const prepareBytes = Buffer.from(`${JSON.stringify(stable(prepare), null, 2)}\n`);
  runner.writeDualImmutable(roots, 'gate3-analysis.json', gate3Bytes);
  runner.writeDualImmutable(roots, 'plan.json', planBytes);
  runner.writeDualImmutable(roots, 'prepare.json', prepareBytes);
  if (extraFile) {
    for (const copy of [roots.primary, roots.secondary]) fs.writeFileSync(path.join(copy, 'unexpected.json'), '{}');
  }
  return {roots, expected: {prepareSha256: bytesSha(prepareBytes), planSha256: bytesSha(planBytes),
    gate3Sha256, head: runner.PARENT_HEAD, members: ['gate3-analysis.json', 'plan.json', 'prepare.json']}};
}
function setBuildDirectory(directory, callback) {
  const name = 'SORAOTO_WASM_BUILD_DIR', previous = process.env[name];
  process.env[name] = path.resolve(directory);
  try { return callback(); }
  finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
}

test('experiment-02 is the only active namespace and experiment-01 remains separately addressable', t => {
  const context = tempRoots();
  assert.equal(context.roots.epoch, 'experiment-02');
  const parent = runner.resolveRoots({root: context.root, home: context.home,
    commonDirectory: context.commonDirectory, epoch: 'experiment-01'});
  assert.ok(parent.primary.endsWith(path.join('physical-contact-loss-v1', 'experiment-01')));
  assert.ok(parent.secondary.endsWith(path.join('physical-contact-loss-v1', 'experiment-01')));
  assert.notEqual(parent.primary, context.roots.primary);
  assert.throws(() => runner.resolveRoots({root: context.root, home: context.home,
    commonDirectory: context.commonDirectory, epoch: 'experiment-03'}), /BLOCKED_CONTACT_LOSS_EPOCH/);
});

test('experiment-02 predecessor proof authenticates both copies and preserves the captured inventory', () => {
  const context = tempRoots(), fixture = setupSyntheticParent(context);
  const options = {root: context.root, home: context.home, commonDirectory: context.commonDirectory};
  const before = runner.verifyParentExperiment01(options, {expected: fixture.expected});
  assert.equal(before.proof.charged, 0);
  assert.equal(before.proof.completed, 0);
  assert.equal(before.proof.ambiguous, 0);
  assert.deepEqual(before.proof.rootMembers, ['gate3-analysis.json', 'plan.json', 'prepare.json']);
  const after = runner.verifyParentInventoryUnchanged(before, options);
  assert.deepEqual(after.inventory, before.inventory);
  const target = path.join(fixture.roots.primary, 'prepare.json'), current = fs.statSync(target);
  fs.utimesSync(target, current.atime, new Date(current.mtimeMs + 3000));
  assert.throws(() => runner.verifyParentInventoryUnchanged(before, options), /PARENT_COPY_DRIFT|PARENT_CHANGED/);
});

test('parent proof rejects extra members and nonzero predecessor accounting', () => {
  const extra = tempRoots(), extraFixture = setupSyntheticParent(extra, {extraFile: true});
  assert.throws(() => runner.verifyParentExperiment01({root: extra.root, home: extra.home,
    commonDirectory: extra.commonDirectory}, {expected: extraFixture.expected}), /PARENT_MEMBERS/);
  const charged = tempRoots(), chargedFixture = setupSyntheticParent(charged, {startedCalls: 1});
  assert.throws(() => runner.verifyParentExperiment01({root: charged.root, home: charged.home,
    commonDirectory: charged.commonDirectory}, {expected: chargedFixture.expected}), /PARENT_PREPARE_IDENTITY/);
});

test('successor call accounting combines both epochs under the original 42-call cap', () => {
  assert.equal(runner.combinedExperimentCharge(0, 0), 0);
  assert.equal(runner.combinedExperimentCharge(0, 42), 42);
  assert.throws(() => runner.combinedExperimentCharge(1, 42), /EXPERIMENT_CAP/);
  assert.throws(() => runner.combinedExperimentCharge(-1, 0), /CALL_ACCOUNTING/);
});

test('status blocks an unverified predecessor without changing the prepared epoch', t => {
  const context = tempRoots(), currentHead = initFixtureRepo(context.root);
  const prepared = setupPrepared(context);
  assert.notEqual(prepared.head, currentHead);
  const result = runner.status({root: context.root, home: context.home, commonDirectory: context.commonDirectory});
  assert.equal(result.status, 'BLOCKED_CONTACT_LOSS_PARENT_EPOCH');
  assert.equal(result.parentStatus, 'UNVERIFIED');
  assert.equal(result.preparedHead, null);
  assert.equal(result.currentHead, currentHead);
  assert.equal(result.charged, 0);
  assert.equal(result.completed, 0);
  assert.equal(result.writes, 0);
  assert.equal(result.renders, 0);
  assert.equal(result.acousticCalls, 0);
});

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
    schemaVersion: 1, epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    id: cell.id, state: 'COMPLETE', audioSha256,
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
  assert.throws(() => runner.readExperimentState(next.roots), /EPOCH_ROOT_DIVERGED|DUAL_COPY_MISSING/);
  assert.equal(fs.existsSync(path.join(next.roots.primary, `experiment/${cell.id}/start.json`)), false);
});

test('an interrupted successor preparation remains an orphan and cannot be auto-completed', () => {
  const context = tempRoots();
  runner.writeDualImmutable(context.roots, 'gate3-analysis.json', Buffer.from('{}\n'));
  assert.throws(() => runner.readExperimentState(context.roots), /ORPHAN_ACTIVE_EPOCH/);
  assert.equal(runner.readDual(context.roots, 'prepare.json'), null);
  assert.equal(runner.readDual(context.roots, 'gate3-analysis.json').bytes.toString(), '{}\n');
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

function fixtureStatus(context, {referenceReader = () => [], snapshotReader = () => ({fixtureSnapshot: 'unchanged'})} = {}) {
  const parentVerifier = options => verifyFixtureParent(context, options);
  const preparedVerifier = (roots, state, {root}) => {
    const identity = runner.currentIdentity(root);
    if (identity.head !== state.prepare.head) throw new Error('BLOCKED_CONTACT_LOSS_HEAD_DRIFT');
    return identity;
  };
  const terminalVerifier = options => runner.verifyExperiment({...options, parentVerifier,
    preparedVerifier, snapshotReader, referenceReader});
  return runner.status({...context, parentVerifier, preparedVerifier, terminalVerifier,
    snapshotReader, referenceReader});
}

function fixtureReferences(state, alphaOrder = 0) {
  return state.calls.slice(alphaOrder * 7, alphaOrder * 7 + 7).map(row => ({pitch: row.cell.pitch, velocity: row.cell.velocity,
    metrics: row.metadata.value.metrics, audio: decodeAudio(row.audio.bytes)}));
}
function writeScoredFixtureSelection(context, {reference124OffsetDb = 0, candidateScaleAlpha = null} = {}) {
  for (const cell of core.plan()) {
    const scale = cell.alphaOrder > 0 && cell.alpha === candidateScaleAlpha
      && cell.pitch === 96 && cell.velocity === 124 ? 2 : 1;
    writeCompletedCall(context.roots, cell, context.prepared, {scale});
  }
  let state = runner.readExperimentState(context.roots), gainDb = null;
  const refs = fixtureReferences(state, candidateScaleAlpha === null ? 0 : core.alphaIndex(candidateScaleAlpha));
  if (reference124OffsetDb !== 0) {
    const ref = refs.find(row => row.pitch === 96 && row.velocity === 124);
    const shifted = ref.metrics.envelopeDbfs.map(value => value + reference124OffsetDb);
    ref.metrics.envelopeDbfs = shifted;
    ref.metrics.official.envelopeDbfs = [...shifted];
  }
  for (let alphaOrder = 0; alphaOrder < core.ALPHAS.length; alphaOrder++) {
    const result = runner.scoreCompletedAlpha({alphaOrder,
      calls: state.calls.slice(alphaOrder * 7, alphaOrder * 7 + 7), refs, gainDb,
      sourceHead: context.prepared.head, wasmSha256: context.prepared.wasmSha256});
    if (alphaOrder === 0) gainDb = result.sharedGainDb;
    runner.writeDualImmutable(context.roots, `experiment/alpha-${String(alphaOrder).padStart(2, '0')}.json`,
      Buffer.from(`${JSON.stringify(stable(result), null, 2)}\n`));
    state = runner.readExperimentState(context.roots);
  }
  const receipt = runner.verifiedReceipt(state, {head: context.prepared.head});
  const decision = core.selectCandidate(state.candidateResults, {receipt});
  const record = {schemaVersion: 1, epoch: runner.ACTIVE_EPOCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256, ...decision, receipt,
    charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
    stage3: 'NOT RUN', stage4: 'NOT RUN'};
  runner.writeDualImmutable(context.roots, 'experiment/selection.json',
    Buffer.from(`${JSON.stringify(stable(record), null, 2)}\n`));
  return {refs, decision, record, candidates: state.candidateResults};
}
function writeUnsafeBoundaryFixture(completedCount) {
  const context = preparedStatusFixture(), cells = core.plan().slice(0, completedCount);
  for (const [index, cell] of cells.entries()) {
    writeCompletedCall(context.roots, cell, context.prepared,
      {scale: index === cells.length - 1 ? 20 : 1});
  }
  let state = runner.readExperimentState(context.roots), gainDb = null;
  const refs = fixtureReferences(state), fullAlphaCount = Math.floor(completedCount / 7);
  const terminalAlphaOrder = completedCount % 7 === 0 ? fullAlphaCount - 1 : -1;
  for (let alphaOrder = 0; alphaOrder < fullAlphaCount; alphaOrder++) {
    if (alphaOrder === terminalAlphaOrder) break;
    const result = runner.scoreCompletedAlpha({alphaOrder,
      calls: state.calls.slice(alphaOrder * 7, alphaOrder * 7 + 7), refs, gainDb,
      sourceHead: context.prepared.head, wasmSha256: context.prepared.wasmSha256});
    if (alphaOrder === 0) gainDb = result.sharedGainDb;
    runner.writeDualImmutable(context.roots, `experiment/alpha-${String(alphaOrder).padStart(2, '0')}.json`,
      Buffer.from(`${JSON.stringify(stable(result), null, 2)}\n`));
    state = runner.readExperimentState(context.roots);
  }
  writeTerminal(context, {epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    status: 'BLOCKED_UNSAFE_CAPTURE', reason: 'FINITE_GUARD_OR_PEAK_GATE', charged: completedCount,
    completed: completedCount, ambiguous: 0, stage3: 'NOT RUN', stage4: 'NOT RUN'});
  return {...context, refs};
}

test('prepared status reports READY only at the exact clean source HEAD and remains read-only', () => {
  const context = preparedStatusFixture();
  const before = dualTreeInventory(context.roots);
  const result = fixtureStatus(context);
  assert.equal(result.status, 'READY');
  assert.equal(result.charged, 0);
  assert.equal(result.selection, 'NOT RUN');
  assert.equal(result.activeLedgerStatus, 'VERIFIED');
  assert.deepEqual(dualTreeInventory(context.roots), before);
});

test('status refuses a forged stress-pass selection before the exact 42-call ledger is complete', () => {
  for (const charged of [0, 41]) {
    const context = preparedStatusFixture();
    for (const cell of core.plan().slice(0, charged)) writeCompletedCall(context.roots, cell, context.prepared);
    writeSelection(context, {schemaVersion: 1, epoch: runner.ACTIVE_EPOCH,
      contractSha256: runner.SUCCESSOR_CONTRACT_SHA256, status: 'GATE4_STRESS_PASS',
      selected: {alpha: 0.65}, charged: 42, completed: 42, ambiguous: 0});
    const before = dualTreeInventory(context.roots);
    const result = fixtureStatus(context);
    assert.equal(result.status, 'BLOCKED_CONTACT_LOSS_SELECTION_LEDGER_INCOMPLETE');
    assert.equal(result.selection, 'UNVERIFIED');
    assert.equal(result.charged, charged);
    assert.equal(result.completed, charged);
    assert.equal(result.acceptanceCharged, null);
    assert.equal(result.cumulative, null);
    assert.equal(result.writes, 0);
    assert.equal(result.renders, 0);
    assert.equal(result.acousticCalls, 0);
    assert.deepEqual(dualTreeInventory(context.roots), before);
  }
});

test('status recomputes canonical 42-call PASS and FAIL selections from stored rows', () => {
  for (const reference124OffsetDb of [0, 30]) {
    const context = preparedStatusFixture();
    const fixture = writeScoredFixtureSelection(context, {reference124OffsetDb});
    const before = dualTreeInventory(context.roots);
    const result = fixtureStatus(context, {referenceReader: () => fixture.refs});
    assert.equal(fixture.decision.status, reference124OffsetDb === 0 ? 'GATE4_STRESS_PASS' : core.TERMINAL);
    assert.equal(result.status, fixture.decision.status, JSON.stringify(result));
    assert.equal(result.selection, fixture.decision.status);
    assert.equal(result.charged, 42);
    assert.equal(result.completed, 42);
    assert.equal(result.ambiguous, 0);
    assert.equal(result.writes, 0);
    assert.equal(result.renders, 0);
    assert.equal(result.acousticCalls, 0);
    assert.deepEqual(dualTreeInventory(context.roots), before);
  }
});

test('post-promotion verify and status use promoted authority instead of the stale prepared HEAD', () => {
  const context = preparedStatusFixture(), fixture = writeScoredFixtureSelection(context);
  assert.equal(fixture.decision.status, 'GATE4_STRESS_PASS');
  fs.writeFileSync(path.join(context.root, 'promotion-descendant.md'), 'two-file promotion descendant fixture\n');
  execFileSync('rtk', ['git', 'add', 'promotion-descendant.md'], {cwd: context.root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'commit', '--quiet', '-m', 'fixture promotion descendant'], {cwd: context.root, stdio: 'ignore'});
  const promotedHead = runner.currentIdentity(context.root).head;
  assert.notEqual(promotedHead, context.prepared.head);
  writePromotion(context, {schemaVersion: 2, epoch: runner.ACTIVE_EPOCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256, head: promotedHead});
  const before = dualTreeInventory(context.roots);
  let promotedChecks = 0;
  const promotedVerifier = ({state, root}) => {
    promotedChecks++;
    assert.equal(state.prepare.head, context.prepared.head);
    assert.equal(runner.currentIdentity(root).head, promotedHead);
    return {head: promotedHead};
  };
  const promotionSelectionVerifier = ({selectionStored}) => {
    assert.equal(selectionStored.value.status, fixture.decision.status);
    return fixture.decision;
  };
  const preparedVerifier = () => { throw new Error('BLOCKED_CONTACT_LOSS_HEAD_DRIFT'); };
  const parentVerifier = options => verifyFixtureParent(context, options);
  const snapshotReader = () => ({fixtureSnapshot: 'unchanged'});
  const verifyOptions = {...context, parentVerifier, preparedVerifier, promotedVerifier,
    promotionSelectionVerifier, snapshotReader, referenceReader: () => fixture.refs};
  const verified = runner.verifyExperiment(verifyOptions);
  assert.equal(verified.status, 'GATE4_STRESS_PASS');
  assert.equal(verified.selection.status, 'GATE4_STRESS_PASS');
  assert.equal(verified.writes, 0);
  assert.equal(verified.renders, 0);
  assert.equal(verified.acousticCalls, 0);
  const status = runner.status({...verifyOptions, terminalVerifier: options => runner.verifyExperiment({...options,
    parentVerifier, preparedVerifier, promotedVerifier, promotionSelectionVerifier, snapshotReader,
    referenceReader: () => fixture.refs}), acceptanceVerifier: () => ({acceptanceCharged: 0, reports: {}})});
  assert.equal(status.status, 'GATE4_STRESS_PASS');
  assert.equal(status.preparedHead, context.prepared.head);
  assert.equal(status.currentHead, promotedHead);
  assert.equal(status.writes, 0);
  assert.equal(status.renders, 0);
  assert.equal(status.acousticCalls, 0);
  assert.ok(promotedChecks >= 3);
  assert.deepEqual(dualTreeInventory(context.roots), before);
});

test('authenticated two-file promotion is accepted by read-only verify and status without rebinding experiment evidence', () => {
  const context = preparedStatusFixture(), fixture = writeScoredFixtureSelection(context,
    {candidateScaleAlpha: 0.5});
  assert.equal(fixture.decision.status, 'GATE4_STRESS_PASS');
  assert.notEqual(fixture.decision.selected.alpha, 1);
  const promotion = commitPromotionFixture(context, fixture.record);
  assert.equal(promotion.record.parentHead, context.prepared.head);
  assert.notEqual(promotion.head, context.prepared.head);
  const before = dualTreeInventory(context.roots);
  const snapshotReader = () => context.prepared.value.frozenEvidenceSnapshot;
  const parentVerifier = options => verifyFixtureParent(context, options);
  const promotedVerifier = options => runner.verifyPromotedAuthority({...options,
    pullRequestVerifier: (_root, head) => assert.equal(head, promotion.head),
    issueApprovalVerifier: () => true,
    offlineReportReader: () => ({reportSha256: context.prepared.value.gate3.offlineReportSha256}),
    snapshotReader});
  const promotionSelectionVerifier = options => runner.verifySelectionAfterPromotion({...options,
    parentVerifier, snapshotReader, referenceReader: () => fixture.refs,
    frozenSnapshotReader: snapshotReader,
    offlineReportReader: () => ({reportSha256: context.prepared.value.gate3.offlineReportSha256}),
    wasmArtifactReader: () => ({sha256: context.prepared.value.build.wasm.sha256,
      size: context.prepared.value.build.wasm.size})});
  const common = {...context, parentVerifier, promotedVerifier, promotionSelectionVerifier,
    snapshotReader, referenceReader: () => fixture.refs};
  const verified = runner.verifyExperiment(common);
  assert.equal(verified.status, 'GATE4_STRESS_PASS');
  assert.equal(verified.charged, 42);
  assert.equal(verified.completed, 42);
  assert.equal(verified.ambiguous, 0);
  assert.equal(verified.writes, 0);
  assert.equal(verified.renders, 0);
  assert.equal(verified.acousticCalls, 0);
  const status = runner.status({...common, acceptanceVerifier: () => ({acceptanceCharged: 0, reports: {}})});
  assert.equal(status.status, 'GATE4_STRESS_PASS');
  assert.equal(status.preparedHead, context.prepared.head);
  assert.equal(status.currentHead, promotion.head);
  assert.equal(status.selection, 'GATE4_STRESS_PASS');
  assert.equal(status.writes, 0);
  assert.equal(status.renders, 0);
  assert.equal(status.acousticCalls, 0);
  assert.deepEqual(dualTreeInventory(context.roots), before);
});

test('post-promotion verify rejects an unauthenticated fake promotion without altering evidence', () => {
  const context = preparedStatusFixture(), fixture = writeScoredFixtureSelection(context);
  fs.writeFileSync(path.join(context.root, 'unapproved-descendant.md'), 'not a promotion\n');
  execFileSync('rtk', ['git', 'add', 'unapproved-descendant.md'], {cwd: context.root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'commit', '--quiet', '-m', 'fixture unapproved descendant'], {cwd: context.root, stdio: 'ignore'});
  writePromotion(context, {schemaVersion: 2, epoch: runner.ACTIVE_EPOCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256, head: runner.currentIdentity(context.root).head});
  const before = dualTreeInventory(context.roots);
  const options = {...context, parentVerifier: opts => verifyFixtureParent(context, opts),
    snapshotReader: () => ({fixtureSnapshot: 'unchanged'}), referenceReader: () => fixture.refs};
  assert.throws(() => runner.verifyExperiment(options), /BLOCKED_CONTACT_LOSS_PROMOTION_IDENTITY/);
  const status = fixtureStatus(context, {referenceReader: () => fixture.refs});
  assert.equal(status.status, 'BLOCKED_CONTACT_LOSS_PROMOTION_IDENTITY');
  assert.equal(status.selection, 'UNVERIFIED');
  assert.equal(status.writes, 0);
  assert.equal(status.renders, 0);
  assert.deepEqual(dualTreeInventory(context.roots), before);
});

test('status refuses final acoustic PASS when a valid Gate4 selection has no downstream stage evidence', () => {
  const context = preparedStatusFixture(), fixture = writeScoredFixtureSelection(context);
  assert.equal(fixture.decision.status, 'GATE4_STRESS_PASS');
  const fakeFinal = {schemaVersion: 2, issue: 7, pr: 8, epoch: runner.ACTIVE_EPOCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256, decision: 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW',
    head: context.prepared.head, selectionSha256: 'a'.repeat(64), promotionSha256: 'b'.repeat(64),
    reports: Object.fromEntries(['confirmation', 'headroom', 'promoted-builds', 'release-equivalence', 'stage3', 'stage4', 'full-ctest']
      .map(name => [name, 'c'.repeat(64)])), webPlayer: {test: 'PASS', build: 'PASS'},
    manualAudio: 'NOT RUN', review: 'PENDING', stage3: 'PASS', stage4: 'PASS',
    accounting: core.accounting({startedExperimentCalls: 42, startedAcceptanceCalls: core.RESERVE_CALLS})};
  runner.writeDualImmutable(context.roots, 'acceptance/final-report.json', Buffer.from(`${JSON.stringify(stable(fakeFinal), null, 2)}\n`));
  const before = dualTreeInventory(context.roots);
  const result = fixtureStatus(context, {referenceReader: () => fixture.refs});
  assert.equal(result.status, 'BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISSING');
  assert.equal(result.finalReport, 'UNVERIFIED');
  assert.equal(result.selection, 'GATE4_STRESS_PASS');
  assert.equal(result.acceptanceCharged, null);
  assert.equal(result.cumulative, null);
  assert.equal(result.writes, 0);
  assert.equal(result.renders, 0);
  assert.equal(result.acousticCalls, 0);
  assert.deepEqual(dualTreeInventory(context.roots), before);
});

test('post-Stage4 full CTest consumes a reconstructed lifecycle document from the build temp area', () => {
  const context = preparedStatusFixture(), document = {schemaVersion: 1, decision: 'STAGE4_LIFECYCLE_CAPTURE_COMPLETE',
    identity: {stage3ResultSha256: 'a'.repeat(64)}, coverage: {lifecycleCells: 1408, adjacentComparisons: 1392, repeatCells: 15},
    render: {sampleRate: 48000}, matrix: [{pitch: 48, velocity: 14, metrics: {finite: true}}], repeats: []};
  const inputBytes = Buffer.from(`${JSON.stringify(stable(document), null, 2)}\n`);
  const before = dualTreeInventory(context.roots);
  let commandSeen = false;
  const result = runner.runPostStage4FullCTest({roots: context.roots, root: context.root,
    buildDirectory: 'build/diagnostic', stage4ReportSha256: 'b'.repeat(64), document,
    spawn: (command, args, options) => {
      commandSeen = true;
      assert.equal(command, 'rtk');
      assert.deepEqual(args, ['ctest', '--test-dir', path.join(context.root, 'build/diagnostic'), '--output-on-failure']);
      const input = options.env.SUPERSYNTH_LIFECYCLE_PATH;
      assert.ok(input.startsWith(path.join(context.root, 'build', '.issue7-contact-loss-post-stage4-')));
      assert.deepEqual(fs.readFileSync(input), inputBytes);
      assert.equal(options.env.SUPERSYNTH_REPORT_DIR, '');
      return {status: 0, stdout: '100% tests passed, 0 tests failed out of 50\n', stderr: ''};
    }});
  assert.equal(commandSeen, true);
  assert.equal(result.report.pass, true);
  assert.equal(result.report.testCount, 50);
  assert.equal(result.report.failedCount, 0);
  assert.equal(result.report.lifecycleInputSha256, bytesSha(inputBytes));
  assert.equal(result.report.stage4ReportSha256, 'b'.repeat(64));
  assert.deepEqual(fs.readdirSync(path.join(context.root, 'build')), []);
  const after = dualTreeInventory(context.roots);
  const oldFiles = copy => before[copy].filter(row => row.type === 'file');
  const newFiles = copy => after[copy].filter(row => row.type === 'file');
  for (const copy of ['primary', 'secondary']) {
    assert.deepEqual(newFiles(copy).filter(row => oldFiles(copy).some(old => old.path === row.path)), oldFiles(copy));
    assert.deepEqual(newFiles(copy).filter(row => !oldFiles(copy).some(old => old.path === row.path)).map(row => row.path),
      [path.join('acceptance', 'full-ctest', 'report.json')]);
  }
});

test('post-Stage4 full CTest records concrete failures instead of promoting them to PASS', () => {
  const context = preparedStatusFixture(), document = {schemaVersion: 1, decision: 'STAGE4_LIFECYCLE_CAPTURE_COMPLETE',
    identity: {}, coverage: {}, render: {}, matrix: [], repeats: []};
  const result = runner.runPostStage4FullCTest({roots: context.roots, root: context.root,
    buildDirectory: 'build/diagnostic', stage4ReportSha256: 'd'.repeat(64), document,
    spawn: () => ({status: 8, stdout: '94% tests passed, 3 tests failed out of 50\n'
      + 'The following tests FAILED:\n\t  2 - wasm.audio-quality-regression (Failed)\n', stderr: ''})});
  assert.equal(result.report.pass, false);
  assert.equal(result.report.decision, 'BLOCKED_FULL_CTEST_FAIL');
  assert.equal(result.report.exitCode, 8);
  assert.equal(result.report.testCount, 50);
  assert.equal(result.report.failedCount, 3);
  assert.deepEqual(result.report.failureNames, ['wasm.audio-quality-regression']);
});

test('post-Stage4 full CTest fails closed when process success has no complete CTest summary', () => {
  const context = preparedStatusFixture(), document = {schemaVersion: 1, decision: 'STAGE4_LIFECYCLE_CAPTURE_COMPLETE',
    identity: {}, coverage: {}, render: {}, matrix: [], repeats: []};
  const result = runner.runPostStage4FullCTest({roots: context.roots, root: context.root,
    buildDirectory: 'build/diagnostic', stage4ReportSha256: 'e'.repeat(64), document,
    spawn: () => ({status: 0, stdout: 'ctest terminated before its summary\n', stderr: ''})});
  assert.equal(result.report.pass, false);
  assert.equal(result.report.decision, 'BLOCKED_FULL_CTEST_FAIL');
  assert.equal(result.report.testCount, null);
  assert.equal(result.report.failedCount, null);
});

test('status blocks a forged selection even with a complete 42-call receipt and leaves both copies untouched', () => {
  const context = preparedStatusFixture(), fixture = writeScoredFixtureSelection(context);
  assert.equal(fixture.decision.status, 'GATE4_STRESS_PASS');
  for (const copy of [context.roots.primary, context.roots.secondary]) {
    const file = path.join(copy, 'experiment', 'selection.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.selected.alpha = 0.55;
    fs.writeFileSync(file, Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
  }
  const before = dualTreeInventory(context.roots);
  const result = fixtureStatus(context, {referenceReader: () => fixture.refs});
  assert.equal(result.status, 'BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
  assert.equal(result.selection, 'UNVERIFIED');
  assert.equal(result.acceptanceCharged, null);
  assert.equal(result.cumulative, null);
  assert.equal(result.writes, 0);
  assert.equal(result.renders, 0);
  assert.equal(result.acousticCalls, 0);
  assert.deepEqual(dualTreeInventory(context.roots), before);
});

test('prepared status blocks a doc-only HEAD change even after one completed cell', () => {
  const context = preparedStatusFixture(), first = core.plan()[0];
  writeCompletedCall(context.roots, first, context.prepared);
  fs.writeFileSync(path.join(context.root, 'later-note.md'), 'documentation only\n');
  execFileSync('rtk', ['git', 'add', 'later-note.md'], {cwd: context.root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'commit', '--quiet', '-m', 'fixture doc-only HEAD change'], {cwd: context.root, stdio: 'ignore'});
  const result = fixtureStatus(context);
  assert.equal(result.status, 'BLOCKED_CONTACT_LOSS_HEAD_DRIFT');
  assert.equal(result.charged, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.writes, 0);
  assert.equal(result.renders, 0);
  assert.equal(result.acousticCalls, 0);
});

test('prepared status blocks same-HEAD source snapshot drift and dirty worktrees', () => {
  const sourceDrift = preparedStatusFixture(), sourceFile = path.join(sourceDrift.root, runner.SOURCE_FILES[0]);
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(sourceFile, later, later);
  assert.equal(fixtureStatus(sourceDrift).status, 'BLOCKED_CONTACT_LOSS_SOURCE_DRIFT');
  assert.equal(runner.currentIdentity(sourceDrift.root).head, sourceDrift.head);

  const dirty = preparedStatusFixture();
  fs.writeFileSync(path.join(dirty.root, 'untracked.txt'), 'dirty');
  assert.equal(fixtureStatus(dirty).status, 'BLOCKED_CONTACT_LOSS_DIRTY_OR_UNIDENTIFIED_WORKTREE');
});

test('parent verification failure reports only an independently verified active call count', () => {
  const context = preparedStatusFixture();
  writeCompletedCall(context.roots, core.plan()[0], context.prepared);
  for (const copy of [context.parent.roots.primary, context.parent.roots.secondary]) {
    fs.appendFileSync(path.join(copy, 'prepare.json'), Buffer.from(' '));
  }
  const result = fixtureStatus(context);
  assert.equal(result.status, 'BLOCKED_CONTACT_LOSS_PARENT_EPOCH');
  assert.equal(result.activeLedgerStatus, 'VERIFIED');
  assert.equal(result.charged, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.combinedCharged, null);
  assert.equal(result.cumulative, null);
  assert.equal(result.acceptanceCharged, null);
  assert.equal(result.writes, 0);
});

test('parent failure reports active accounting as unknown when the active ledger also fails verification', () => {
  const context = preparedStatusFixture();
  writeCompletedCall(context.roots, core.plan()[0], context.prepared);
  for (const copy of [context.roots.primary, context.roots.secondary]) {
    const file = path.join(copy, 'experiment', core.plan()[0].id, 'complete.json');
    const complete = JSON.parse(fs.readFileSync(file, 'utf8'));
    complete.audioSha256 = 'a'.repeat(64);
    fs.writeFileSync(file, Buffer.from(`${JSON.stringify(stable(complete), null, 2)}\n`));
  }
  for (const copy of [context.parent.roots.primary, context.parent.roots.secondary]) {
    const file = path.join(copy, 'prepare.json');
    const prepare = JSON.parse(fs.readFileSync(file, 'utf8'));
    prepare.head = 'f'.repeat(40);
    fs.writeFileSync(file, Buffer.from(`${JSON.stringify(stable(prepare), null, 2)}\n`));
  }
  const result = fixtureStatus(context);
  assert.equal(result.status, 'BLOCKED_CONTACT_LOSS_PARENT_EPOCH');
  assert.equal(result.activeLedgerStatus, 'UNVERIFIED');
  assert.equal(result.charged, null);
  assert.equal(result.completed, null);
  assert.equal(result.cumulative, null);
});

function terminalVerificationOptions(context, {referenceReader = () => []} = {}) {
  return {parentVerifier: options => verifyFixtureParent(context, options),
    preparedVerifier: (roots, state, {root}) => {
      const identity = runner.currentIdentity(root);
      if (identity.head !== state.prepare.head) throw new Error('BLOCKED_CONTACT_LOSS_HEAD_DRIFT');
      return identity;
    }, snapshotReader: () => ({fixtureSnapshot: 'unchanged'}), referenceReader};
}
function writeTerminal(context, value) {
  runner.writeDualImmutable(context.roots, 'experiment/terminal.json', Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
}
function writeSelection(context, value) {
  runner.writeDualImmutable(context.roots, 'experiment/selection.json', Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
}
function writePromotion(context, value) {
  runner.writeDualImmutable(context.roots, 'acceptance/promotion.json', Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`));
}
function commitPromotionFixture(context, selection) {
  const alpha = selection.selected.alpha;
  const presetPath = 'wasm/plugins/dsp/super-synth/presets.json';
  const preset = JSON.parse(fs.readFileSync(path.join(context.root, presetPath), 'utf8'));
  preset.concert_grand.engine_config.hammer.contact_loss_soft = Number((0.08 * alpha).toFixed(8));
  preset.concert_grand.engine_config.hammer.contact_loss_hard = Number((0.28 * alpha).toFixed(8));
  fs.writeFileSync(path.join(context.root, presetPath), `${JSON.stringify(preset)}\n`);
  const generatedPath = 'wasm/shared/generated/super-synth_grand_profiles.h';
  fs.writeFileSync(path.join(context.root, generatedPath), 'fixture promoted profile\n');
  execFileSync('rtk', ['git', 'add', presetPath, generatedPath], {cwd: context.root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'commit', '--quiet', '-m', 'fixture exact promotion'], {cwd: context.root, stdio: 'ignore'});
  const head = runner.currentIdentity(context.root).head;
  const tree = execFileSync('rtk', ['git', 'rev-parse', `${head}^{tree}`], {cwd: context.root, encoding: 'utf8'}).trim();
  assert.deepEqual(runner.commitChangedPaths(context.root, head), runner.PROMOTION_PATHS);
  const values = {contact_loss_soft: Number((0.08 * alpha).toFixed(8)), contact_loss_hard: Number((0.28 * alpha).toFixed(8))};
  const record = {schemaVersion: 2, issue: 7, pr: 8, epoch: runner.ACTIVE_EPOCH,
    contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    selectionSha256: runner.readDual(context.roots, 'experiment/selection.json', {required: true}).sha256,
    alpha, parentHead: context.prepared.head, head, tree,
    changedPaths: ['wasm/plugins/dsp/super-synth/presets.json', generatedPath].sort(),
    sourceBefore: context.prepared.value.source, sourceAfter: runner.sourceSnapshot(context.root), values,
    remoteReadback: {state: 'OPEN', branch: runner.PR_BRANCH, head}};
  writePromotion(context, record);
  return {head, record};
}

test('run-bounded rejects a forged pass terminal when the ledger has zero calls', () => {
  const context = preparedStatusFixture();
  writeTerminal(context, {epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    status: 'GATE4_STRESS_PASS', charged: 0, completed: 0, ambiguous: 0,
    stage3: 'NOT RUN', stage4: 'NOT RUN'});
  const verification = terminalVerificationOptions(context);
  let renders = 0;
  assert.throws(() => runner.runBounded({...context, renderer: () => { renders++; },
    terminalVerifier: options => runner.verifyExperiment({...options, ...verification})}), /TERMINAL_STATUS/);
  assert.equal(renders, 0);
});

test('run-bounded verifies parent and current HEAD before reusing an existing blocked terminal', () => {
  const makeBlocked = () => {
    const context = preparedStatusFixture(), cell = core.plan()[0];
    writeCompletedCall(context.roots, cell, context.prepared, {scale: 20});
    writeTerminal(context, {epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
      status: 'BLOCKED_UNSAFE_CAPTURE', reason: 'FINITE_GUARD_OR_PEAK_GATE',
      charged: 1, completed: 1, ambiguous: 0, stage3: 'NOT RUN', stage4: 'NOT RUN'});
    return context;
  };
  const reuse = context => {
    const verification = terminalVerificationOptions(context);
    let renders = 0;
    const result = runner.runBounded({...context, renderer: () => { renders++; },
      terminalVerifier: options => runner.verifyExperiment({...options, ...verification})});
    assert.equal(renders, 0);
    return result;
  };

  const valid = makeBlocked();
  const verified = reuse(valid);
  assert.equal(verified.status, 'BLOCKED_UNSAFE_CAPTURE');
  assert.equal(verified.terminalEvidence, 'VERIFIED');
  assert.equal(verified.charged, 1);

  const alteredMetrics = makeBlocked();
  for (const copy of [alteredMetrics.roots.primary, alteredMetrics.roots.secondary]) {
    const base = path.join(copy, 'experiment', core.plan()[0].id);
    const metadataPath = path.join(base, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.metrics.peakDbfs = -1;
    metadata.metrics.official.peakDbfs = -1;
    const metadataBytes = Buffer.from(`${JSON.stringify(stable(metadata), null, 2)}\n`);
    fs.writeFileSync(metadataPath, metadataBytes);
    const completePath = path.join(base, 'complete.json'), complete = JSON.parse(fs.readFileSync(completePath, 'utf8'));
    complete.metadataSha256 = bytesSha(metadataBytes);
    fs.writeFileSync(completePath, Buffer.from(`${JSON.stringify(stable(complete), null, 2)}\n`));
  }
  assert.throws(() => reuse(alteredMetrics), /TERMINAL_MEASURED_METRIC_MISMATCH/);

  const brokenParent = makeBlocked();
  const parentPrepare = JSON.parse(fs.readFileSync(path.join(brokenParent.parent.roots.primary, 'prepare.json'), 'utf8'));
  parentPrepare.head = 'f'.repeat(40);
  const mutatedPrepare = Buffer.from(`${JSON.stringify(stable(parentPrepare), null, 2)}\n`);
  for (const copy of [brokenParent.parent.roots.primary, brokenParent.parent.roots.secondary]) {
    fs.writeFileSync(path.join(copy, 'prepare.json'), mutatedPrepare);
  }
  assert.throws(() => reuse(brokenParent), /PARENT_DIGEST/);

  const changedHead = makeBlocked();
  fs.writeFileSync(path.join(changedHead.root, 'later-note.md'), 'documentation only\n');
  execFileSync('rtk', ['git', 'add', 'later-note.md'], {cwd: changedHead.root, stdio: 'ignore'});
  execFileSync('rtk', ['git', 'commit', '--quiet', '-m', 'fixture terminal HEAD drift'], {cwd: changedHead.root, stdio: 'ignore'});
  assert.throws(() => reuse(changedHead), /HEAD_DRIFT/);
});

test('unsafe alpha-boundary terminals at calls 7, 14, and 42 verify and replay without writes or renders', () => {
  for (const completedCount of [7, 14, 42]) {
    const context = writeUnsafeBoundaryFixture(completedCount), verification = terminalVerificationOptions(context,
      {referenceReader: () => context.refs});
    const before = dualTreeInventory(context.roots);
    const verified = runner.verifyExperiment({...context, ...verification});
    assert.equal(verified.status, 'BLOCKED_UNSAFE_CAPTURE');
    assert.equal(verified.charged, completedCount);
    assert.equal(verified.completed, completedCount);
    assert.equal(verified.verifiedAlphaCount, completedCount / 7 - 1);
    let renders = 0;
    const reused = runner.runBounded({...context, renderer: () => { renders++; },
      terminalVerifier: options => runner.verifyExperiment({...options, ...verification})});
    assert.equal(reused.status, 'BLOCKED_UNSAFE_CAPTURE');
    assert.equal(reused.terminalEvidence, 'VERIFIED');
    assert.equal(reused.charged, completedCount);
    assert.equal(renders, 0);
    assert.deepEqual(dualTreeInventory(context.roots), before);
  }
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
  assert.equal(runner.parseMode(['--preflight']), 'preflight');
  assert.equal(runner.parseMode(['--recover-prepared']), 'recover-prepared');
  assert.throws(() => runner.parseMode(['--status', '--verify']), /Usage:/);
  assert.throws(() => runner.parseMode(['--run-bounded', '--count', '1']), /Usage:/);
});

test('preflight validates the exact P3-pinned source manifest before historical evidence replay', () => {
  const sourceBytes = Object.fromEntries(Array.from({length: runner.P3_PINNED_SOURCE_COUNT}, (_, index) => {
    const relative = 'wasm/pinned-' + String(index).padStart(2, '0') + '.c';
    return [relative, Buffer.from('source-' + index)];
  }));
  const sourceHashes = Object.fromEntries(Object.entries(sourceBytes)
    .map(([relative, bytes]) => [relative, bytesSha(bytes)]));
  const record = {creatorCommit: 'a'.repeat(40), optimizer: {sourceHashes}};
  const load = (commit, relative) => {
    assert.equal(commit, record.creatorCommit);
    return sourceBytes[relative];
  };
  const manifest = runner.buildP3SourceManifest(record, load);
  assert.equal(manifest.rows.length, runner.P3_PINNED_SOURCE_COUNT);
  assert.deepEqual(manifest.rows.map(row => row.path), Object.keys(sourceHashes).sort());
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(runner.buildP3SourceManifest(record, load).sha256, manifest.sha256);
  assert.throws(() => runner.buildP3SourceManifest(record, () => Buffer.from('drift')),
    /PREFLIGHT_P3_SOURCE_IDENTITY/);
  const shortRecord = structuredClone(record);
  delete shortRecord.optimizer.sourceHashes[Object.keys(sourceHashes)[0]];
  assert.throws(() => runner.buildP3SourceManifest(shortRecord, load), /PREFLIGHT_P3_SOURCE_COUNT/);
  const unsafeRecord = structuredClone(record);
  const first = Object.keys(unsafeRecord.optimizer.sourceHashes)[0];
  unsafeRecord.optimizer.sourceHashes['../escape.c'] = unsafeRecord.optimizer.sourceHashes[first];
  delete unsafeRecord.optimizer.sourceHashes[first];
  assert.throws(() => runner.buildP3SourceManifest(unsafeRecord, load), /PREFLIGHT_P3_SOURCE_PATH/);
});

test('preflight receipt accepts only the approved baseline failures and Stage4 input deferral', () => {
  const context = tempRoots(), head = '1'.repeat(40), wasmSha256 = '2'.repeat(64), source = {};
  const frozenEvidenceSnapshot = {fixtureSnapshot: 'unchanged'};
  const parentEpoch = {epoch: runner.PARENT_EPOCH, head: runner.PARENT_HEAD,
    charged: 0, completed: 0, ambiguous: 0};
  const preflight = setupPreflight({roots: context.roots, head, wasmSha256, source, parentEpoch,
    gate3Sha256: '3'.repeat(64), frozenEvidenceSnapshot});
  const state = runner.readExperimentState(context.roots);
  assert.equal(state.status, 'PREFLIGHT_READY');
  assert.deepEqual(state.preflightReports.map(row => row.file), [preflight.preflightFile]);
  assert.equal(runner.assertPreflightReceiptShape(preflight.report, head), preflight.report);

  const extraFailure = structuredClone(preflight.report);
  extraFailure.checks.fullCTest.failureNames.push('wasm.unapproved.failure');
  assert.throws(() => runner.assertPreflightReceiptShape(extraFailure, head), /PREFLIGHT_FULL_CTEST/);
  const skipped = structuredClone(preflight.report);
  skipped.checks.offlineFrozen.skipped = 1;
  assert.throws(() => runner.assertPreflightReceiptShape(skipped, head), /PREFLIGHT_CHECK:offlineFrozen/);
  const unverifiedP3 = structuredClone(preflight.report);
  unverifiedP3.checks.offlineFrozen.sourceContext.worktreeRemoved = false;
  assert.throws(() => runner.assertPreflightReceiptShape(unverifiedP3, head), /PREFLIGHT_P3_CONTEXT/);
  const changedSignature = structuredClone(preflight.report);
  changedSignature.checks.fullCTest.signatures.audioQuality = 'different audio failure';
  assert.throws(() => runner.assertPreflightReceiptShape(changedSignature, head), /PREFLIGHT_FULL_CTEST/);
});

test('full CTest classifier requires the exact failure set, signatures, lifecycle identity, and zero skips', () => {
  const lifecycle = {schemaVersion: 1, check: 'supersynth-v9-production-simd-lifecycle',
    productionWasmSha256: 'f36b18c705a4ac1c965f10712ae2ebde86106c6048b3f5f6a59036e721163fd3',
    cells: 1408, adjacentComparisons: 1390};
  const lifecycleBytes = Buffer.from(`${JSON.stringify(lifecycle, null, 2)}\n`);
  const lifecycleSha256 = bytesSha(lifecycleBytes);
  const failures = ['wasm.audio-quality-regression',
    'wasm.dsp.super-synth.supersynth-v9-full-range-calibration',
    'wasm.dsp.super-synth.supersynth-v9-production-lifecycle'];
  const output = ['94% tests passed, 3 tests failed out of 50', 'The following tests FAILED:',
    ...failures.map((name, index) => `  ${index + 1} - ${name} (Failed)`),
    'field-wind-over-lumeria: true peak -32.387194396613445',
    'persisted Stage4 lifecycle matrix is required; the Stage4 runner owns all acoustic renders',
    JSON.stringify(lifecycle, null, 2)].join('\n');
  const classified = runner.classifyFullCTestPreflight({status: 8, stdout: output,
    expectedLifecycleReportSha256: lifecycleSha256});
  assert.equal(classified.decision, 'BASELINE_FAILURES_DISCLOSED');
  assert.equal(classified.testCount, 50);
  assert.equal(classified.failedCount, 3);
  assert.equal(classified.skippedCount, 0);
  assert.equal(classified.signatures.productionLifecycleReportSha256, lifecycleSha256);
  assert.throws(() => runner.classifyFullCTestPreflight({status: 8,
    stdout: `${output}\n***Skipped`, expectedLifecycleReportSha256: lifecycleSha256}), /PREFLIGHT_NEW_CTEST_FAILURE/);
  assert.throws(() => runner.classifyFullCTestPreflight({status: 8,
    stdout: output.replace('field-wind-over-lumeria', 'changed-field-wind'),
    expectedLifecycleReportSha256: lifecycleSha256}), /PREFLIGHT_CTEST_FAILURE_SIGNATURE/);
  assert.throws(() => runner.classifyFullCTestPreflight({status: 8, stdout: output,
    expectedLifecycleReportSha256: '0'.repeat(64)}), /PREFLIGHT_BASELINE_LIFECYCLE_DRIFT/);
  assert.throws(() => runner.classifyFullCTestPreflight({status: 8, stdout: output,
    expectedLifecycleReportSha256: lifecycleSha256, errorCode: 'EACCES'}), /PREFLIGHT_CTEST_EXECUTION/);
});

test('focused CTest summary accepts current and legacy all-pass formats and rejects skips or failure detail', () => {
  assert.deepEqual(runner.summarizePassingCtest('100% tests passed out of 2\n', 2),
    {tests: 2, passed: 2, failed: 0, skipped: 0});
  assert.deepEqual(runner.summarizePassingCtest('100% tests passed, 0 tests failed out of 2\n', 2),
    {tests: 2, passed: 2, failed: 0, skipped: 0});
  assert.deepEqual(runner.summarizePassingCtest('100% tests passed out of 2\n1/2 Test #2: focused ***Skipped\n', 2),
    {tests: 2, passed: 2, failed: 0, skipped: 1});
  assert.deepEqual(runner.summarizePassingCtest(
    '100% tests passed out of 2\nThe following tests FAILED:\n  2 - focused (Failed)\n', 2),
  {tests: 2, passed: 1, failed: 1, skipped: 0});
  assert.deepEqual(runner.summarizePassingCtest('CTest exited without a summary\n', 2),
    {tests: null, passed: null, failed: null, skipped: 0});
});

test('prepare preflight identity rejects missing receipts and any source or identity drift', () => {
  const context = tempRoots(), head = '4'.repeat(40), wasmSha256 = '5'.repeat(64), source = {source: 'fixed'};
  const frozenEvidenceSnapshot = {fixtureSnapshot: 'unchanged'}, parentProof = {epoch: runner.PARENT_EPOCH,
    head: runner.PARENT_HEAD, charged: 0, completed: 0, ambiguous: 0};
  const analysisSha256 = '6'.repeat(64), productionWasmSha256 = 'c'.repeat(64);
  const inputs = {roots: context.roots, head, source, parentProof, frozenEvidenceSnapshot, analysisSha256,
    diagnosticWasmSha256: wasmSha256, productionWasmSha256};
  assert.throws(() => runner.verifyPreflightForPrepare(inputs), /PREFLIGHT_MISSING/);
  setupPreflight({roots: context.roots, head, wasmSha256, source, parentEpoch: parentProof,
    gate3Sha256: analysisSha256, frozenEvidenceSnapshot});
  const before = dualTreeInventory(context.roots);
  assert.equal(runner.verifyPreflightForPrepare(inputs).preflightSha256.length, 64);
  assert.throws(() => runner.verifyPreflightForPrepare({...inputs, source: {source: 'changed'}}), /PREFLIGHT_IDENTITY/);
  assert.throws(() => runner.verifyPreflightForPrepare({...inputs, diagnosticWasmSha256: '8'.repeat(64)}), /PREFLIGHT_IDENTITY/);
  assert.deepEqual(dualTreeInventory(context.roots), before);
});

test('prepare serialization binds the verifier-returned preflightSha256 field', () => {
  const preflight = {preflightFile: runner.preflightFileName('4'.repeat(40)),
    preflightSha256: 'a'.repeat(64)};
  assert.deepEqual(runner.buildPreparePreflightBinding(preflight), preflight);
  assert.throws(() => runner.buildPreparePreflightBinding({preflightFile: preflight.preflightFile,
    sha256: preflight.preflightSha256}), /PREPARE_PREFLIGHT_BINDING/);
});

test('recovery source delta permits only the two implementation files and three approved documents', () => {
  const original = Object.fromEntries(runner.SOURCE_FILES
    .filter(relative => !relative.endsWith('prepare-recovery-contract.md'))
    .map(relative => [relative, {sha256: '1'.repeat(64), size: 10, mtimeMs: 1}]));
  const recovery = {...original};
  for (const relative of runner.SOURCE_FILES.filter(relative => relative.endsWith('prepare-recovery-contract.md'))) {
    recovery[relative] = {sha256: '2'.repeat(64), size: 11, mtimeMs: 2};
  }
  const changed = [
    'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-prepare-recovery-contract.md',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'
  ];
  for (const relative of changed.filter(relative => Object.hasOwn(recovery, relative))) {
    recovery[relative] = {sha256: '3'.repeat(64), size: 12, mtimeMs: 3};
  }
  const delta = runner.verifyRecoverySourceDelta(original, recovery);
  assert.deepEqual(Object.keys(delta).sort(), changed.sort());
  const drifted = {...recovery, 'wasm/plugins/dsp/super-synth/src/plugin.c':
    {sha256: '4'.repeat(64), size: 13, mtimeMs: 4}};
  assert.throws(() => runner.verifyRecoverySourceDelta(original, drifted), /RECOVERY_SOURCE_DELTA/);
});

test('recovery frozen snapshot preserves analysis-20 and appends only approved sequential epochs', () => {
  const copy = (sha256, mtimeMs = 1) => ({sha256, size: 1, mtimeMs});
  const record = name => ({'report.json': {primary: copy(name, 1), secondary: copy(name, 2)},
    'manifest.json': {primary: copy(name, 1), secondary: copy(name, 2)}});
  const original = {parentEvidence: {sha256: 'parent'}, offlineEpochs: {
    'analysis-16': record('16'), 'analysis-17': record('17')}};
  const recovery = {parentEvidence: {sha256: 'parent'}, offlineEpochs: {
    ...original.offlineEpochs, 'analysis-18': record('18')}};
  assert.equal(runner.assertRecoveryFrozenAppendOnly(original, recovery, 'analysis-18'), true);
  const drifted = structuredClone(recovery);
  drifted.offlineEpochs['analysis-17']['report.json'].primary.sha256 = 'changed';
  assert.throws(() => runner.assertRecoveryFrozenAppendOnly(original, drifted, 'analysis-18'), /FROZEN_PARENT_DRIFT/);
  const secondRecovery = {parentEvidence: {sha256: 'parent'}, offlineEpochs: {
    ...original.offlineEpochs,
    'analysis-18': {'report.json': {primary: copy('49f1ae88d8583322cfc889d4c1bb03c02f43db5b74afbdebe524256734695048'),
      secondary: copy('49f1ae88d8583322cfc889d4c1bb03c02f43db5b74afbdebe524256734695048', 2)},
    'manifest.json': {primary: copy('8ec1084e70f96ca0212d48ef328d075941efafc3dd8a0e8dcf2ac381acc22e1e'),
      secondary: copy('8ec1084e70f96ca0212d48ef328d075941efafc3dd8a0e8dcf2ac381acc22e1e', 2)}},
    'analysis-19': record('19')}};
  assert.equal(runner.assertRecoveryFrozenAppendOnly(original, secondRecovery, 'analysis-19', 2), true);
  const analysis20 = {'report.json': {primary: copy(runner.RECOVERY_ANALYSIS20_REPORT_SHA256),
    secondary: copy(runner.RECOVERY_ANALYSIS20_REPORT_SHA256, 2)},
  'manifest.json': {primary: copy(runner.RECOVERY_ANALYSIS20_MANIFEST_SHA256),
    secondary: copy(runner.RECOVERY_ANALYSIS20_MANIFEST_SHA256, 2)}};
  const continuation02 = {parentEvidence: {sha256: 'parent'}, offlineEpochs: {
    ...secondRecovery.offlineEpochs, 'analysis-20': analysis20, 'analysis-21': record('21')}};
  assert.equal(runner.assertRecoveryFrozenAppendOnly(original, continuation02, 'analysis-21', 4), true);
  const modifiedAnalysis20 = structuredClone(continuation02);
  modifiedAnalysis20.offlineEpochs['analysis-20']['report.json'].primary.sha256 = 'changed';
  modifiedAnalysis20.offlineEpochs['analysis-20']['report.json'].secondary.sha256 = 'changed';
  assert.throws(() => runner.assertRecoveryFrozenAppendOnly(original, modifiedAnalysis20, 'analysis-21', 4),
    /RECOVERY_ANALYSIS20_IDENTITY/);
  const skippedEpoch = structuredClone(continuation02);
  delete skippedEpoch.offlineEpochs['analysis-20'];
  assert.throws(() => runner.assertRecoveryFrozenAppendOnly(original, skippedEpoch, 'analysis-21', 4),
    /RECOVERY_FROZEN_EPOCH_SEQUENCE/);
  const analysis21 = {'report.json': {primary: copy(runner.RECOVERY_ANALYSIS21_REPORT_SHA256),
    secondary: copy(runner.RECOVERY_ANALYSIS21_REPORT_SHA256, 2)},
  'manifest.json': {primary: copy(runner.RECOVERY_ANALYSIS21_MANIFEST_SHA256),
    secondary: copy(runner.RECOVERY_ANALYSIS21_MANIFEST_SHA256, 2)}};
  const continuation03 = {parentEvidence: {sha256: 'parent'}, offlineEpochs: {
    ...continuation02.offlineEpochs, 'analysis-21': analysis21, 'analysis-22': record('22')}};
  assert.equal(runner.assertRecoveryFrozenAppendOnly(original, continuation03, 'analysis-22', 5), true);
  const driftedAnalysis21 = structuredClone(continuation03);
  driftedAnalysis21.offlineEpochs['analysis-21']['manifest.json'].primary.sha256 = 'changed';
  driftedAnalysis21.offlineEpochs['analysis-21']['manifest.json'].secondary.sha256 = 'changed';
  assert.throws(() => runner.assertRecoveryFrozenAppendOnly(original, driftedAnalysis21, 'analysis-22', 5),
    /RECOVERY_ANALYSIS21_IDENTITY/);
});

test('recovery preserves distinct original copy mtimes while requiring identical bytes', () => {
  const context = tempRoots(), members = ['prepare.json'];
  for (const copy of ['primary', 'secondary']) fs.mkdirSync(context.roots[copy], {recursive: true});
  for (const [copy, timestamp] of [['primary', 1600000000], ['secondary', 1600000010]]) {
    const file = path.join(context.roots[copy], members[0]);
    fs.writeFileSync(file, 'immutable original bytes');
    fs.utimesSync(file, timestamp, timestamp);
  }
  const snapshots = runner.snapshotActiveRootMembers(context.roots, members);
  assert.equal(snapshots.primary['prepare.json'].sha256, snapshots.secondary['prepare.json'].sha256);
  assert.equal(snapshots.primary['prepare.json'].size, snapshots.secondary['prepare.json'].size);
  assert.notEqual(snapshots.primary['prepare.json'].mtimeMs, snapshots.secondary['prepare.json'].mtimeMs);
  fs.writeFileSync(path.join(context.roots.secondary, 'prepare.json'), 'changed bytes');
  assert.throws(() => runner.snapshotActiveRootMembers(context.roots, members), /ORIGINAL_COPY_DRIFT/);
});

test('continuation prefix verification tolerates its writer lock but rejects any other root member', () => {
  const context = tempRoots(), members = ['plan.json', 'prepare.json'];
  for (const copy of ['primary', 'secondary']) fs.mkdirSync(context.roots[copy], {recursive: true});
  for (const copy of ['primary', 'secondary']) {
    for (const name of members) fs.writeFileSync(path.join(context.roots[copy], name), `immutable-${name}`);
  }
  const snapshot = runner.snapshotActiveRootMembers(context.roots, members);
  for (const copy of ['primary', 'secondary']) {
    fs.writeFileSync(path.join(context.roots[copy], 'writer.lock'), '{"ownerId":"fixture"}');
  }
  assert.equal(runner.assertLockedRecoveryPrefix(context.roots, snapshot), true);
  for (const copy of ['primary', 'secondary']) {
    fs.writeFileSync(path.join(context.roots[copy], `recovery-preflight-${'a'.repeat(40)}.json`), '{}');
  }
  assert.throws(() => runner.assertLockedRecoveryPrefix(context.roots, snapshot), /PREFIX_SET/);
});

test('recovery root verification accepts only the exact lock owned by the current writer', () => {
  const context = tempRoots(), expected = ['plan.json', 'prepare.json'];
  for (const name of expected) runner.writeDualImmutable(context.roots, name, Buffer.from(`immutable-${name}`));
  const owner = crypto.randomUUID();
  const bytes = Buffer.from(`${JSON.stringify({schemaVersion: 1, owner, pid: process.pid,
    createdAt: new Date().toISOString()})}\n`);
  runner.writeDualImmutable(context.roots, 'writer.lock', bytes);
  assert.equal(runner.assertRecoveryRootMembers(context.roots, expected,
    {ownerLock: {owner, bytes}, blocker: 'BLOCKED_TEST_ROOT_MEMBERS'}), true);
  assert.throws(() => runner.assertRecoveryRootMembers(context.roots, expected,
    {blocker: 'BLOCKED_TEST_ROOT_MEMBERS'}), /BLOCKED_TEST_ROOT_MEMBERS/);
  assert.throws(() => runner.assertRecoveryRootMembers(context.roots, expected,
    {ownerLock: {owner: crypto.randomUUID(), bytes}, blocker: 'BLOCKED_TEST_ROOT_MEMBERS'}),
  /BLOCKED_CONTACT_LOSS_LOCK_OWNER_CHANGED/);
  assert.throws(() => runner.assertRecoveryRootMembers(context.roots, expected,
    {ownerLock: {owner, bytes: Buffer.from('stale lock')}, blocker: 'BLOCKED_TEST_ROOT_MEMBERS'}),
  /BLOCKED_CONTACT_LOSS_LOCK_OWNER_CHANGED/);
});

test('prepared verification uses the authenticated recovery receipt offline epoch', () => {
  assert.equal(runner.expectedRecoveryOfflineEpoch({kind: 'CONTACT_LOSS_PREPARE_RECOVERY'}),
    'physical-root-cause-offline-v1/analysis-19');
  assert.equal(runner.expectedRecoveryOfflineEpoch({kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02'}),
    'physical-root-cause-offline-v1/analysis-21');
  assert.equal(runner.expectedRecoveryOfflineEpoch({kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03'}),
    'physical-root-cause-offline-v1/analysis-22');
  assert.throws(() => runner.expectedRecoveryOfflineEpoch({kind: 'UNAUTHENTICATED'}), /RECOVERY_RECEIPT_KIND/);
});

test('prepare recovery receipt shape binds one HEAD, old roots, exact budgets, and WASM identities', () => {
  const executionHead = '9'.repeat(40), digest = 'a'.repeat(64), source = {fixture: {sha256: digest, size: 1, mtimeMs: 1}};
  const snapshot = {parentEvidence: {sha256: 'parent'}, offlineEpochs: {}};
  const gate3Analysis = {status: 'GATE3_ANALYSIS_PASS', head: executionHead,
    offlineEpoch: 'physical-root-cause-offline-v1/analysis-19', observationCount: 20, cellCount: 140};
  const gate3Bytes = Buffer.from(`${JSON.stringify(stable(gate3Analysis), null, 2)}\n`);
  const oldMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    runner.preflightFileName('7f7fd1074be24bada371a517468f1ff4366ef1fc')];
  const member = {sha256: digest, size: 12, mtimeMs: 1};
  const memberSnapshot = {primary: Object.fromEntries(oldMembers.map(name => [name, member])),
    secondary: Object.fromEntries(oldMembers.map(name => [name, member]))};
  const parentProof = {epoch: runner.PARENT_EPOCH, head: runner.PARENT_HEAD, charged: 0, completed: 0, ambiguous: 0};
  const sourceDelta = Object.fromEntries([
    'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-prepare-recovery-contract.md',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'
  ].map(name => [name, {before: null, after: source.fixture}]));
  const frozenSnapshotSha256 = runner.frozenSnapshotSha256(snapshot);
  const wasm = {sha256: 'b'.repeat(64), size: 123};
  const productionWasm = {sha256: 'c'.repeat(64), size: 456};
  const receipt = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY', issue: 7, pr: 8,
    epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    recoveryContractSha256: '20241190b844ba47f3d317891776ba523ced0fa517c05207be9fa75e8ebd7be0',
    approvalMarker: 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_APPROVED',
    original: {head: '7f7fd1074be24bada371a517468f1ff4366ef1fc',
      prepareSha256: '37b1d47a1329a48298feea6bc93f6bf540e50b30853abe10bc7b40fcac9bd8fd',
      planSha256: '0eaa7f377420d893acb6692f08aa0a6fa0b9035f26422c7d284a15d5fa08f52a',
      gate3Sha256: 'df8fd945bc2936e99c51c082b4ad92d31921321b5a8332643d1e56227c93fcc2',
      preflightFile: oldMembers[3],
      preflightSha256: '07a26cee19ba84b588d33f6e5967be5b3913ce11daf1eb0e6039c350894f3cb1',
      memberSnapshot, parentProof, diagnosticWasmSha256: wasm.sha256, diagnosticWasmSize: wasm.size,
      productionWasmSha256: productionWasm.sha256, productionWasmSize: productionWasm.size},
    executionHead,
    recovery: {head: executionHead, preflightFile: `recovery-preflight-${executionHead}.json`,
      preflightSha256: digest, gate3AnalysisSha256: bytesSha(gate3Bytes), gate3Analysis,
      offlineReportSha256: digest, frozenSnapshotSha256,
      frozenEvidenceSnapshot: snapshot, source, sourceDelta,
      builds: {diagnostic: {wasmSha256: wasm.sha256, wasmSize: wasm.size},
        production: {wasmSha256: productionWasm.sha256, wasmSize: productionWasm.size}}},
    parentProof, calls: {started: 0, completed: 0, ambiguous: 0}, budget: core.accounting()};
  assert.equal(runner.assertPrepareRecoveryReceiptShape(receipt), receipt);
  assert.throws(() => runner.assertPrepareRecoveryReceiptShape({...receipt,
    calls: {started: 1, completed: 0, ambiguous: 0}}), /PREPARE_RECOVERY_RECEIPT_IDENTITY/);
});

test('pinned recovery preparation accepts the immutable legacy marker only with its original byte identities', () => {
  const head = '7f7fd1074be24bada371a517468f1ff4366ef1fc';
  const prepared = {sha256: '37b1d47a1329a48298feea6bc93f6bf540e50b30853abe10bc7b40fcac9bd8fd',
    value: {head, approvalMarker: 'ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED',
      preflightFile: runner.preflightFileName(head)}};
  const originalPreflight = {sha256: '07a26cee19ba84b588d33f6e5967be5b3913ce11daf1eb0e6039c350894f3cb1'};
  assert.equal(runner.assertPinnedRecoveryPrepareBinding(prepared, originalPreflight), true);
  assert.throws(() => runner.assertPinnedRecoveryPrepareBinding({...prepared,
    value: {...prepared.value, approvalMarker: runner.ISSUE_APPROVAL_MARKER}}, originalPreflight),
  /PREPARE_RECOVERY_ORIGINAL_BINDING/);
  assert.throws(() => runner.assertPinnedRecoveryPrepareBinding({...prepared,
    value: {...prepared.value, preflightSha256: 'a'.repeat(64)}}, originalPreflight),
  /PREPARE_RECOVERY_ORIGINAL_BINDING/);
});

test('continuation-02 receipts chain the first recovery and preserve all six prior root records', () => {
  const head = '9'.repeat(40), digest = 'a'.repeat(64), source = {fixture: {sha256: digest, size: 7, mtimeMs: 11}};
  const names = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    'preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json',
    'recovery-preflight-e0a59dbf13d4910f2a342bf50fe2d846464c2b27.json', 'prepare-recovery.json'];
  const hashes = {'gate3-analysis.json': 'df8fd945bc2936e99c51c082b4ad92d31921321b5a8332643d1e56227c93fcc2',
    'plan.json': '0eaa7f377420d893acb6692f08aa0a6fa0b9035f26422c7d284a15d5fa08f52a',
    'prepare.json': '37b1d47a1329a48298feea6bc93f6bf540e50b30853abe10bc7b40fcac9bd8fd',
    'preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json': '07a26cee19ba84b588d33f6e5967be5b3913ce11daf1eb0e6039c350894f3cb1',
    'recovery-preflight-e0a59dbf13d4910f2a342bf50fe2d846464c2b27.json': 'b33563252befb268797189c5135babb7c6718c4d4e4a4f6b3eed2a90bbb7e138',
    'prepare-recovery.json': '0a212cfdb5a243056efe8206d327a42c526d643a6b55c71b2edf5d8ad277c539'};
  const previousRootSnapshot = {primary: {}, secondary: {}};
  for (const [index, name] of names.entries()) {
    previousRootSnapshot.primary[name] = {sha256: hashes[name], size: 100 + index, mtimeMs: 1000 + index};
    previousRootSnapshot.secondary[name] = {sha256: hashes[name], size: 100 + index, mtimeMs: 2000 + index};
  }
  const sourceDelta = Object.fromEntries([
    'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-prepare-recovery-contract.md',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'
  ].map(name => [name, {before: null, after: source.fixture}]));
  const frozenEvidenceSnapshot = {parentEvidence: {sha256: digest}, offlineEpochs: {}};
  const frozenSnapshotSha256 = runner.frozenSnapshotSha256(frozenEvidenceSnapshot);
  const gate3Analysis = {status: 'GATE3_ANALYSIS_PASS', head,
    offlineEpoch: 'physical-root-cause-offline-v1/analysis-21', observationCount: 20, cellCount: 140,
    archiveSha256: 'b'.repeat(64), offlineReportSha256: 'c'.repeat(64), frozenSnapshotSha256};
  const gate3AnalysisSha256 = bytesSha(Buffer.from(`${JSON.stringify(stable(gate3Analysis), null, 2)}\n`));
  const parentProof = {epoch: runner.PARENT_EPOCH, head: runner.PARENT_HEAD, charged: 0, completed: 0, ambiguous: 0};
  const previousRootSnapSha = 'd'.repeat(64), previousReportSha = gate3Analysis.offlineReportSha256;
  const builds = {diagnostic: {wasmSha256: 'e'.repeat(64), wasmSize: 10},
    production: {wasmSha256: 'f'.repeat(64), wasmSize: 20}};
  const receipt = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02',
    issue: 7, pr: 8, epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: runner.PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER,
    amendmentApprovalMarker: runner.PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER,
    designSha256: runner.PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256,
    previousExecutionHead: 'e0a59dbf13d4910f2a342bf50fe2d846464c2b27',
    previousRecoveryPreflightSha256: hashes['recovery-preflight-e0a59dbf13d4910f2a342bf50fe2d846464c2b27.json'],
    previousRecoveryReceiptSha256: hashes['prepare-recovery.json'],
    original: {head: '7f7fd1074be24bada371a517468f1ff4366ef1fc',
      prepareSha256: hashes['prepare.json'], planSha256: hashes['plan.json'],
      gate3Sha256: hashes['gate3-analysis.json'],
      preflightSha256: hashes['preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json']},
    executionHead: head, previousRootSnapshot,
    recovery: {head, preflightFile: `recovery-preflight-${head}.json`, preflightSha256: digest,
      gate3AnalysisSha256, gate3Analysis, offlineReportSha256: previousReportSha,
      offlineManifestSha256: '2'.repeat(64), frozenSnapshotSha256, frozenEvidenceSnapshot,
      source, sourceDelta, builds}, parentProof, calls: {started: 0, completed: 0, ambiguous: 0},
    budget: core.accounting()};
  assert.equal(runner.assertPrepareRecoveryContinuation02ReceiptShape(receipt), receipt);
  assert.throws(() => runner.assertPrepareRecoveryContinuation02ReceiptShape({...receipt,
    previousRecoveryReceiptSha256: '0'.repeat(64)}), /CONTINUATION_02_RECEIPT_IDENTITY/);
  assert.throws(() => runner.assertPrepareRecoveryContinuation02ReceiptShape({...receipt,
    amendmentApprovalMarker: 'UNAPPROVED'}), /CONTINUATION_02_RECEIPT_IDENTITY/);
  assert.throws(() => runner.assertPrepareRecoveryContinuation02ReceiptShape({...receipt,
    calls: {started: 1, completed: 0, ambiguous: 0}}), /CONTINUATION_02_RECEIPT_IDENTITY/);
  const context = tempRoots(), current = setupPreflight({roots: context.roots, head, wasmSha256: '3'.repeat(64),
    source, parentEpoch: parentProof, gate3Sha256: gate3AnalysisSha256, frozenEvidenceSnapshot});
  const preflight = {...current.report, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02_PREFLIGHT',
    gate3: {analysisSha256: gate3AnalysisSha256},
    continuation02: {approvalMarker: receipt.approvalMarker,
      amendmentApprovalMarker: receipt.amendmentApprovalMarker, designSha256: receipt.designSha256,
      offlineEpoch: gate3Analysis.offlineEpoch, executionHead: head,
      preflightFile: `recovery-preflight-${head}.json`, previousExecutionHead: receipt.previousExecutionHead,
      previousRecoveryPreflightSha256: receipt.previousRecoveryPreflightSha256,
      previousRecoveryReceiptSha256: receipt.previousRecoveryReceiptSha256,
      originalPrepareSha256: receipt.original.prepareSha256, originalPlanSha256: receipt.original.planSha256,
      originalGate3Sha256: receipt.original.gate3Sha256, originalPreflightSha256: receipt.original.preflightSha256,
      offlineReportSha256: gate3Analysis.offlineReportSha256, offlineManifestSha256: receipt.recovery.offlineManifestSha256,
      gate3AnalysisSha256, gate3Analysis, sourceDelta, previousRootSnapshot}};
  assert.equal(runner.assertRecoveryContinuation02PreflightReceiptShape(preflight, head), preflight);
  assert.throws(() => runner.assertRecoveryContinuation02PreflightReceiptShape({...preflight,
    continuation02: {...preflight.continuation02, amendmentApprovalMarker: 'UNAPPROVED'}}, head),
  /CONTINUATION_02_PREFLIGHT_IDENTITY/);
  assert.throws(() => runner.assertRecoveryContinuation02PreflightReceiptShape({...preflight,
    continuation02: {...preflight.continuation02, previousRootSnapshot: {...previousRootSnapshot,
      primary: {...previousRootSnapshot.primary, 'prepare.json': {...previousRootSnapshot.primary['prepare.json'], sha256: '0'.repeat(64)}}}}}, head),
  /CONTINUATION_02_PREFIX_IDENTITY/);
});

test('continuation-03 receipt authenticates the immutable continuation-02 chain and eight-file prefix', () => {
  const head = '8'.repeat(40), digest = 'a'.repeat(64), source = {fixture: {sha256: digest, size: 9, mtimeMs: 13}};
  const names = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    'preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json',
    'recovery-preflight-e0a59dbf13d4910f2a342bf50fe2d846464c2b27.json', 'prepare-recovery.json',
    `recovery-preflight-${runner.RECOVERY_CONTINUATION_02_EXECUTION_HEAD}.json`,
    runner.PREPARE_RECOVERY_CONTINUATION_02_REL];
  const hashes = {'gate3-analysis.json': 'df8fd945bc2936e99c51c082b4ad92d31921321b5a8332643d1e56227c93fcc2',
    'plan.json': '0eaa7f377420d893acb6692f08aa0a6fa0b9035f26422c7d284a15d5fa08f52a',
    'prepare.json': '37b1d47a1329a48298feea6bc93f6bf540e50b30853abe10bc7b40fcac9bd8fd',
    'preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json': '07a26cee19ba84b588d33f6e5967be5b3913ce11daf1eb0e6039c350894f3cb1',
    'recovery-preflight-e0a59dbf13d4910f2a342bf50fe2d846464c2b27.json': runner.RECOVERY_FIRST_PREFLIGHT_SHA256,
    'prepare-recovery.json': runner.RECOVERY_FIRST_RECEIPT_SHA256,
    [`recovery-preflight-${runner.RECOVERY_CONTINUATION_02_EXECUTION_HEAD}.json`]: runner.RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256,
    [runner.PREPARE_RECOVERY_CONTINUATION_02_REL]: runner.RECOVERY_CONTINUATION_02_RECEIPT_SHA256};
  const previousRootSnapshot = {primary: {}, secondary: {}};
  for (const [index, name] of names.entries()) {
    previousRootSnapshot.primary[name] = {sha256: hashes[name], size: 100 + index, mtimeMs: 1000 + index};
    previousRootSnapshot.secondary[name] = {sha256: hashes[name], size: 100 + index, mtimeMs: 2000 + index};
  }
  assert.equal(runner.assertRecoveryContinuation03PriorRootSnapshot(previousRootSnapshot), true);
  const sourceDelta = Object.fromEntries([
    'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md',
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-prepare-recovery-contract.md',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'
  ].map(name => [name, {before: null, after: source.fixture}]));
  const frozenEvidenceSnapshot = {parentEvidence: {sha256: digest}, offlineEpochs: {}};
  const frozenSnapshotSha256 = runner.frozenSnapshotSha256(frozenEvidenceSnapshot);
  const gate3Analysis = {status: 'GATE3_ANALYSIS_PASS', head,
    offlineEpoch: runner.PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH,
    observationCount: 20, cellCount: 140, archiveSha256: 'b'.repeat(64),
    offlineReportSha256: 'c'.repeat(64), frozenSnapshotSha256};
  const gate3AnalysisSha256 = bytesSha(Buffer.from(`${JSON.stringify(stable(gate3Analysis), null, 2)}\n`));
  const offlineHistory = {analysis20: {reportSha256: runner.RECOVERY_ANALYSIS20_REPORT_SHA256,
    manifestSha256: runner.RECOVERY_ANALYSIS20_MANIFEST_SHA256},
  analysis21: {reportSha256: runner.RECOVERY_ANALYSIS21_REPORT_SHA256,
    manifestSha256: runner.RECOVERY_ANALYSIS21_MANIFEST_SHA256},
  analysis22: {reportSha256: gate3Analysis.offlineReportSha256, manifestSha256: '2'.repeat(64)}};
  const parentProof = {epoch: runner.PARENT_EPOCH, head: runner.PARENT_HEAD, charged: 0, completed: 0, ambiguous: 0};
  const builds = {diagnostic: {wasmSha256: 'e'.repeat(64), wasmSize: 10},
    production: {wasmSha256: 'f'.repeat(64), wasmSize: 20}};
  const receipt = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03',
    issue: 7, pr: 8, epoch: runner.ACTIVE_EPOCH, contractSha256: runner.SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: runner.PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER,
    designSha256: runner.PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256,
    previousExecutionHead: runner.RECOVERY_CONTINUATION_02_EXECUTION_HEAD,
    previousRecoveryPreflightSha256: runner.RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256,
    previousRecoveryReceiptSha256: runner.RECOVERY_CONTINUATION_02_RECEIPT_SHA256,
    original: {head: '7f7fd1074be24bada371a517468f1ff4366ef1fc',
      prepareSha256: hashes['prepare.json'], planSha256: hashes['plan.json'],
      gate3Sha256: hashes['gate3-analysis.json'],
      preflightSha256: hashes['preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json']},
    executionHead: head, previousRootSnapshot,
    recovery: {head, preflightFile: `recovery-preflight-${head}.json`, preflightSha256: digest,
      gate3AnalysisSha256, gate3Analysis, offlineReportSha256: gate3Analysis.offlineReportSha256,
      offlineManifestSha256: offlineHistory.analysis22.manifestSha256, offlineHistory,
      frozenSnapshotSha256, frozenEvidenceSnapshot, source, sourceDelta, builds},
    parentProof, calls: {started: 0, completed: 0, ambiguous: 0}, budget: core.accounting()};
  assert.equal(runner.assertPrepareRecoveryContinuation03ReceiptShape(receipt), receipt);
  assert.throws(() => runner.assertPrepareRecoveryContinuation03ReceiptShape({...receipt,
    previousRecoveryReceiptSha256: '0'.repeat(64)}), /CONTINUATION_03_RECEIPT_IDENTITY/);
  assert.throws(() => runner.assertPrepareRecoveryContinuation03ReceiptShape({...receipt,
    previousRootSnapshot: {...previousRootSnapshot, primary: {...previousRootSnapshot.primary,
      'prepare.json': {...previousRootSnapshot.primary['prepare.json'], sha256: '0'.repeat(64)}}}}),
  /CONTINUATION_03_PREFIX_IDENTITY/);
  const context = tempRoots(), current = setupPreflight({roots: context.roots, head,
    wasmSha256: '3'.repeat(64), source, parentEpoch: parentProof,
    gate3Sha256: gate3AnalysisSha256, frozenEvidenceSnapshot});
  const continuation03 = {approvalMarker: receipt.approvalMarker, designSha256: receipt.designSha256,
    previousExecutionHead: receipt.previousExecutionHead,
    previousRecoveryPreflightSha256: receipt.previousRecoveryPreflightSha256,
    previousRecoveryReceiptSha256: receipt.previousRecoveryReceiptSha256,
    originalPrepareSha256: receipt.original.prepareSha256, originalPlanSha256: receipt.original.planSha256,
    originalGate3Sha256: receipt.original.gate3Sha256, originalPreflightSha256: receipt.original.preflightSha256,
    executionHead: head, preflightFile: receipt.recovery.preflightFile,
    offlineEpoch: runner.PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH,
    offlineReportSha256: receipt.recovery.offlineReportSha256,
    offlineManifestSha256: receipt.recovery.offlineManifestSha256, offlineHistory,
    gate3AnalysisSha256, gate3Analysis, sourceDelta, previousRootSnapshot};
  const preflight = {...current.report,
    kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03_PREFLIGHT',
    gate3: {analysisSha256: gate3AnalysisSha256}, continuation03};
  assert.equal(runner.assertRecoveryContinuation03PreflightReceiptShape(preflight, head), preflight);
  assert.throws(() => runner.assertRecoveryContinuation03PreflightReceiptShape({...preflight,
    continuation03: {...continuation03, offlineHistory: {...offlineHistory,
      analysis21: {...offlineHistory.analysis21, manifestSha256: '0'.repeat(64)}}}}, head),
  /CONTINUATION_03_PREFLIGHT_IDENTITY/);
  assert.equal(runner.PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256,
    'ebcabaa5835a7f1987fa1bcc1a3a269392889252643c73ea93ee134d223feb58');
});

test('preflight build matrix is exported as absolute paths for CTest child working directories', () => {
  const context = tempRoots(), env = runner.preflightTestEnvironment({root: context.root,
    diagnosticBuildDirectory: 'build/diag', productionBuildDirectory: 'build/release', env: {KEPT: 'yes'}});
  assert.equal(env.ISSUE7_CONTACT_LOSS_REQUIRE_BUILD_MATRIX, '1');
  assert.equal(env.ISSUE7_CONTACT_LOSS_BUILD_DIR, path.join(context.root, 'build/diag'));
  assert.equal(env.SORAOTO_WASM_BUILD_DIR, path.join(context.root, 'build/diag'));
  assert.equal(env.ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR, path.join(context.root, 'build/release'));
  assert.equal(env.ISSUE7_CONTACT_LOSS_RELEASE_BUILD_DIR, path.join(context.root, 'build/release'));
  assert.equal(env.KEPT, 'yes');
  assert.throws(() => runner.preflightTestEnvironment({root: context.root,
    diagnosticBuildDirectory: 'build/same', productionBuildDirectory: 'build/same'}), /PREFLIGHT_BUILD_MATRIX/);
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
