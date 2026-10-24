'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const core = require('./issue7-physical-fit-v4-core.cjs');
const loss = require('./physical-fit-v4-loss.cjs');
const oldRunner = require('./run-issue7-physical-identification-v1.cjs');
const oldCore = require('./issue7-physical-identification-v1-core.cjs');
const analysis = require('./analyze-issue7-physical-identification.cjs');
const directMetrics = require('./stage3-direct-reference-metrics.cjs');
const stage3 = require('./run-issue7-stage3-current-build.cjs');
const stage4 = require('./run-issue7-stage4-current-build.cjs');
const fixture = require('../reference/salamander-grand-piano-v3-metrics.json');
const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');

const ROOT = core.ROOT;
const PR_URL = 'https://github.com/puchinya/soraoto_dsl/pull/8';
const CONTRACT = Object.freeze({commentId: 6243950617, sha256: 'ca3542c678e35cffa4766d2bd056febc3e2cff5e0ee2ff2dc964ce307c10567f', bytes: 22533});
const V3_CANDIDATE_RESULT_SHA256 = '71f72e01945c13942802c1e34dd9bc908aa441ac8f0a840bf223a1ea4e9e5908';
const P3_REL = 'runtime-revisions/physical-fit-P3.json';
const P3_RESULT_REL = 'p3/optimizer-result.json';
const P3_SELECTION_REL = 'p3/accepted-selection.json';
const P3_HOLDOUT_REL = 'p3/confirmation-result.json';
const P3_HEADROOM_REL = 'p3/headroom-result.json';
const PROMOTION_INTENT_REL = 'p3/promotion-intent.json';
const P4_REL = 'runtime-revisions/physical-fit-P4.json';
const P4_BUILD_REL = 'p4/build-identity.json';
const P4_EQUIVALENCE_REL = 'p4/release-equivalence-result.json';
const STAGE3_RESULT_REL = 'stage3/result.json';
const STAGE4_RESULT_REL = 'stage4/result.json';
const V3_SOURCE_REL = Object.freeze([
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-physical-identification-v1-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-identification.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs',
  'wasm/cmake/wasm_plugin.cmake'
]);
const V4_SOURCE_REL = Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/issue7-physical-fit-v4-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/physical-fit-v4-loss.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v4.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v4.test.cjs',
  'docs/specs/plugins/dsp/super-synth/super-synth-spec.md',
  'docs/design/plugins/dsp/super-synth/super-synth-design.md',
  'docs/status/plugins/dsp/super-synth/super-synth-status.md'
]);
const P4_ALLOWED_REL = Object.freeze([
  'wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h'
].sort());
const DIAGNOSTIC_WASM_SHA256 = '1028c5a77b533ba97066d116f77aab80e5e91b45ef043394875614ee3efab99a';
const REFERENCE_ARCHIVE_SHA256 = 'b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b';
const REFERENCE_SFZ_MEMBER = 'SalamanderGrandPiano-SFZ+FLAC-V3+20200602/SalamanderGrandPiano-V3+20200602.sfz';
const WASM_RELATIVE = 'plugins/dsp/super-synth/plugin.wasm';
const TEST_BUILD_DIR = 'build/issue7-physical-fit-v4/production-test';
const RELEASE_BUILD_DIR = 'build/issue7-physical-fit-v4/production-release';
const BUILD_OPTIONS = Object.freeze({
  test: ['-DBUILD_TESTING=ON', '-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON'],
  release: ['-DBUILD_TESTING=OFF', '-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=OFF', '-DCMAKE_BUILD_TYPE=Release']
});
const REQUIRED_P4_TESTS = Object.freeze([
  'concertGrand', 'pianoRealism', 'pianoClick', 'pianoVoiceSteal', 'pluginInterfaceV1', 'playbackSafety'
]);

function fileSha(file) { return core.sha256(fs.readFileSync(file)); }
function git(args, root = ROOT) { return execFileSync('rtk', ['git', ...args], {cwd: root, encoding: 'utf8'}).trim(); }
function repoFileSha(relative, root = ROOT) { return fileSha(path.join(root, relative)); }
function isCommitAncestor(ancestor, descendant = 'HEAD') {
  return spawnSync('rtk', ['git', 'merge-base', '--is-ancestor', ancestor, descendant], {cwd: ROOT}).status === 0;
}
function runCommand(file, args, {cwd = ROOT, env = process.env, timeout = 0, maxBuffer = 32 * 1024 * 1024} = {}) {
  const result = spawnSync(file, args, {cwd, env, encoding: 'utf8', timeout: timeout || undefined, maxBuffer});
  return {command: [file, ...args].join(' '), status: result.status, signal: result.signal || null,
    stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null};
}
function runRtk(args, options = {}) { return runCommand('rtk', args, options); }
function requirePass(result, label) {
  if (result.error || result.status !== 0) throw new Error(`BLOCKED_PHYSICAL_V4_COMMAND: ${label}: ${result.error || result.status}; ${(result.stderr || result.stdout).slice(-1800)}`);
  return result;
}
function remotePullRequest() {
  const result = requirePass(runRtk(['gh', 'pr', 'view', '8', '--repo', 'puchinya/soraoto_dsl', '--json', 'headRefOid,state,headRefName,url']), 'PR #8 readback');
  return JSON.parse(result.stdout);
}
function verifyRemoteHead(expected = git(['rev-parse', 'HEAD'])) {
  const pr = remotePullRequest();
  if (pr.state !== 'OPEN' || pr.headRefName !== 'codex/issue-7-supersynth-v9' || pr.headRefOid !== expected || pr.url !== PR_URL)
    throw new Error(`BLOCKED_PHYSICAL_V4_PR_HEAD_READBACK: ${JSON.stringify({expected, pr})}`);
  return pr;
}
function writeFloatWav(left, right, sampleRate = 48000) {
  const dataSize = left.length * 8, wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 8, 28); wav.writeUInt16LE(8, 32); wav.writeUInt16LE(32, 34); wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0, p = 44; i < left.length; i++, p += 8) { wav.writeFloatLE(left[i], p); wav.writeFloatLE(right[i], p + 4); }
  return wav;
}
function withBuildDirectory(buildDirectory, action) {
  const key = 'SORAOTO_WASM_BUILD_DIR', prior = process.env[key];
  process.env[key] = path.resolve(ROOT, buildDirectory);
  try { return action(); }
  finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
}
function renderDiagnostic({cell, values, frames = 24000, notes = [{pitch: cell.pitch, velocity: cell.velocity}], buildDirectory = oldRunner.BUILD_DIR} = {}) {
  const harness = withBuildDirectory(buildDirectory, () => new PluginHarness(ROOT, WASM_RELATIVE, {sampleRate: 48000, maxFrames: 128}));
  try {
    harness.applyPreset('concert_grand');
    for (let index = 0; index < 3; index++) {
      const setter = harness.e.soraoto_supersynth_physical_identification_set;
      const getter = harness.e.soraoto_supersynth_physical_identification_get;
      if (typeof setter !== 'function' || typeof getter !== 'function') throw new Error('BLOCKED_PHYSICAL_V4_DIAGNOSTIC_EXPORTS');
      if (setter(index, values[index]) !== 0 || Math.abs(getter(index) - values[index]) > Math.max(1e-7, Math.abs(values[index]) * 1e-6)) throw new Error(`BLOCKED_PHYSICAL_V4_PARAMETER_OVERRIDE: ${index}`);
    }
    harness.e.soraoto_supersynth_physical_identification_observation_reset();
    const guardStart = harness.e.soraoto_supersynth_guard_hit_count?.() ?? 0;
    const left = new Float32Array(frames), right = new Float32Array(frames), callbackMs = [];
    for (let position = 0; position < frames; position += 128) {
      const count = Math.min(128, frames - position), events = [];
      if (position === 0) notes.forEach((note, index) => events.push({kind: 1, noteId: index + 1, pitch: note.pitch, velocity: note.velocity / 127, offset: 0}));
      if (position === 48000) notes.forEach((note, index) => events.push({kind: 2, noteId: index + 1, pitch: note.pitch, velocity: 0, offset: 0}));
      const started = performance.now(), output = harness.process(count, {events}); callbackMs.push(performance.now() - started);
      for (let i = 0; i < count; i++) { left[position + i] = output[0][0][i]; right[position + i] = output[0][1][i]; }
    }
    const guardHits = (harness.e.soraoto_supersynth_guard_hit_count?.() ?? 0) - guardStart;
    let peak = 0;
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    const finite = left.every(Number.isFinite) && right.every(Number.isFinite);
    if (!finite) throw new Error('BLOCKED_PHYSICAL_V4_NONFINITE_RENDER');
    const audio = writeFloatWav(left, right);
    const metrics = cell.kind === 'headroom' ? null : analysis.analyze(left, right, cell.pitch, 48000);
    if (metrics) { metrics.official.outputGuardHits = guardHits; metrics.official.finite = finite; }
    const row = {cell, values: [...values], metrics, finite, peak, peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -240, outputGuardHits: guardHits,
      ...(cell.kind === 'headroom' ? {callbackMs, maxCallbackMs: Math.max(...callbackMs)} : {})};
    return {audio, row, left, right};
  } finally { harness.close(); }
}
function renderProductionCell({record, cell, buildDirectory, frames = 96000, notes} = {}) {
  const selectedNotes = notes || (cell.kind === 'chord'
    ? cell.pitches.map(pitch => ({pitch, velocity: cell.velocity}))
    : [{pitch: cell.pitch, velocity: cell.velocity}]);
  const harness = withBuildDirectory(buildDirectory, () => new PluginHarness(ROOT, WASM_RELATIVE, {sampleRate: 48000, maxFrames: 128}));
  try {
    harness.applyPreset('concert_grand');
    for (const [name, value] of [['voice_drift', 0], ['lfo1_pitch', 0], ['chorus_mix', 0]]) harness.setPlain(name, value);
    const guardStart = harness.e.soraoto_supersynth_guard_hit_count?.() ?? 0;
    const left = new Float32Array(frames), right = new Float32Array(frames), callbackMs = [];
    for (let position = 0; position < frames; position += 128) {
      const count = Math.min(128, frames - position), events = [];
      if (position === 0) selectedNotes.forEach((note, index) => events.push({kind: 1, noteId: index + 1, pitch: note.pitch, velocity: note.velocity / 127, offset: 0}));
      if (position === 48000) selectedNotes.forEach((note, index) => events.push({kind: 2, noteId: index + 1, pitch: note.pitch, velocity: 0, offset: 0}));
      const started = performance.now(), output = harness.process(count, {events}); callbackMs.push(performance.now() - started);
      for (let i = 0; i < count; i++) { left[position + i] = output[0][0][i]; right[position + i] = output[0][1][i]; }
    }
    const guardHits = (harness.e.soraoto_supersynth_guard_hit_count?.() ?? guardStart) - guardStart;
    let peak = 0;
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    const finite = left.every(Number.isFinite) && right.every(Number.isFinite), audio = writeFloatWav(left, right);
    if (!finite) throw new Error('BLOCKED_PHYSICAL_V4_NONFINITE_RELEASE_CAPTURE');
    return {audio, left, right, finite, peak, peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -240, guardHits, callbackMs,
      waveformSha256: core.sha256(audio.subarray(44))};
  } finally { harness.close(); }
}
function decodeFloatAudio(bytes) { return loss.decodeFloat32StereoWav(bytes); }
function safeP1Snapshot(home) {
  const roots = oldCore.resolveRoots(ROOT, home), before = {primary: oldCore.snapshotTree(roots.primary), secondary: oldCore.snapshotTree(roots.secondary)};
  const verification = oldRunner.verify({home});
  const after = {primary: oldCore.snapshotTree(roots.primary), secondary: oldCore.snapshotTree(roots.secondary)};
  if (!oldCore.same(before, after)) throw new Error('BLOCKED_PHYSICAL_V4_V3_EVIDENCE_CHANGED_DURING_READ');
  if (verification.oldEvidence?.readOnlyEvidenceUnchanged === false) throw new Error('BLOCKED_PHYSICAL_V4_V3_READ_ONLY_VERIFY');
  const runtime = oldCore.readJson(roots, oldRunner.P1_REL);
  const candidate = oldCore.readDual(roots, 'candidate/result.json');
  if (!runtime || !candidate || candidate.sha256 !== V3_CANDIDATE_RESULT_SHA256) throw new Error('BLOCKED_PHYSICAL_V4_V3_TERMINAL_IDENTITY');
  const result = JSON.parse(candidate.bytes.toString('utf8'));
  if (result.decision !== 'BLOCKED_PHYSICAL_FIT_NO_ACCEPTABLE_CANDIDATE') throw new Error('BLOCKED_PHYSICAL_V4_V3_TERMINAL_DECISION');
  const wasm = oldRunner.wasmPath(oldRunner.BUILD_DIR);
  if (!fs.existsSync(wasm) || fileSha(wasm) !== DIAGNOSTIC_WASM_SHA256 || runtime.build?.wasmSha256 !== DIAGNOSTIC_WASM_SHA256) throw new Error('BLOCKED_PHYSICAL_V4_P1_WASM_IDENTITY');
  oldRunner.assertDiagnosticExports(wasm);
  const rows = {};
  for (const stage of ['baseline', 'finiteDifference', 'candidate']) {
    const plan = oldCore.readJson(roots, `${stage}/plan.json`), ledger = oldCore.readJson(roots, `${stage}/ledger.json`);
    if (!plan || !ledger || plan.cells.some(cell => ledger.cells[oldCore.cellKey(cell)]?.state !== 'COMPLETE')) throw new Error(`BLOCKED_PHYSICAL_V4_V3_INCOMPLETE: ${stage}`);
    rows[stage] = plan.cells.map(cell => {
      const item = ledger.cells[oldCore.cellKey(cell)], resultRel = `${stage}/${item.result}`;
      const metadata = oldCore.readDual(roots, resultRel), artifactRel = `${stage}/artifacts/${encodeURIComponent(oldCore.cellKey(cell))}.wav`, artifact = oldCore.readDual(roots, artifactRel);
      if (!metadata || !artifact) throw new Error(`BLOCKED_PHYSICAL_V4_V3_ROW_MISSING: ${stage}:${oldCore.cellKey(cell)}`);
      return {cell, metadataRel: resultRel, metadataSha256: metadata.sha256, artifactRel, artifactSha256: artifact.sha256, artifactSize: artifact.size};
    });
  }
  if (rows.baseline.length !== 7 || rows.finiteDifference.length !== 42 || rows.candidate.length !== 49) throw new Error('BLOCKED_PHYSICAL_V4_V3_ROW_COUNTS');
  const archivePath = analysis.locateGoogleDriveArchive();
  if (!fs.existsSync(archivePath) || !fs.lstatSync(archivePath).isFile()) throw new Error('BLOCKED_PHYSICAL_V4_REFERENCE_ARCHIVE_PATH');
  return {roots, verification, runtime, terminal: {sha256: candidate.sha256, result}, rows, wasm, archivePath,
    archive: {name: path.basename(archivePath), sha256: REFERENCE_ARCHIVE_SHA256}, p1BeforeAfter: {primary: before.primary.length, secondary: before.secondary.length}};
}
function sourceHashes(paths = V4_SOURCE_REL, root = ROOT) {
  return Object.fromEntries(paths.map(relative => [relative, repoFileSha(relative, root)]));
}
function runPreP3Checks() {
  const checks = [
    runRtk(['node', '--test', 'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v4.test.cjs']),
    runRtk(['node', '--test', 'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.test.cjs']),
    runRtk(['python3', '-m', 'unittest', 'wasm/cmake/test_super_synth_metadata.py']),
    runRtk(['git', 'diff', '--check'])
  ];
  return checks.map((result, index) => ({...result, label: ['v4-focused-tests', 'v3-regression-tests', 'metadata-tests', 'diff-check'][index],
    result: result.error || result.status !== 0 ? 'FAIL' : 'PASS', stdoutSha256: core.sha256(result.stdout), stderrSha256: core.sha256(result.stderr),
    summary: `${(result.stdout || '').trim().split('\n').slice(-4).join(' | ')} ${(result.stderr || '').trim().split('\n').slice(-2).join(' | ')}`.trim()}));
}
async function prepareP3({home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), old = safeP1Snapshot(home), head = git(['rev-parse', 'HEAD']), branch = git(['branch', '--show-current']);
  const archiveSha256 = await analysis.sha256File(old.archivePath);
  if (archiveSha256 !== REFERENCE_ARCHIVE_SHA256) throw new Error('BLOCKED_PHYSICAL_V4_REFERENCE_ARCHIVE_SHA');
  const archiveSize = fs.statSync(old.archivePath).size;
  if (branch !== 'codex/issue-7-supersynth-v9') throw new Error('BLOCKED_PHYSICAL_V4_BRANCH');
  if (git(['status', '--porcelain']).split('\n').filter(Boolean).some(line => !line.endsWith('.vscode/'))) throw new Error('BLOCKED_PHYSICAL_V4_DIRTY_TRACKED_WORKTREE');
  const pr = verifyRemoteHead(head), checks = runPreP3Checks();
  const failed = checks.filter(item => item.result !== 'PASS');
  if (failed.length) throw new Error(`BLOCKED_PHYSICAL_V4_PRE_P3_TESTS: ${failed.map(item => item.label).join(',')}`);
  const currentFiles = [...V3_SOURCE_REL, ...V4_SOURCE_REL];
  const record = {schemaVersion: 1, issue: 7, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic, phase: 'P3', contract: CONTRACT,
    creatorCommit: head, branch, pullRequest: {url: pr.url, state: pr.state, headRefName: pr.headRefName, headRefOid: pr.headRefOid},
    historicalV3: {decision: old.terminal.result.decision, terminalResultSha256: old.terminal.sha256,
      runtimeRevisionSha256: oldCore.readDual(old.roots, oldRunner.P1_REL).sha256, p1DiagnosticWasmSha256: fileSha(old.wasm),
      p1SourceIdentity: old.runtime.sourceIdentity, rows: old.rows},
    referenceArchive: {...old.archive, size: archiveSize, sha256VerifiedAt: new Date().toISOString()}, referenceCorpusCommitment: {sfzMember: REFERENCE_SFZ_MEMBER, sfzSha256: '91a273d53390c84a855437b4f37a734afac5cb0e4063b3ef59ccf0e63d909506'},
    optimizer: {lossVersion: loss.LOSS_VERSION, coreSha256: repoFileSha('wasm/plugins/dsp/super-synth/test/tools/issue7-physical-fit-v4-core.cjs'),
      lossSha256: repoFileSha('wasm/plugins/dsp/super-synth/test/tools/physical-fit-v4-loss.cjs'), runnerSha256: repoFileSha('wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v4.cjs'),
      sourceHashes: sourceHashes(currentFiles), checks}, createdAt: new Date().toISOString(), acousticCallsCharged: 0,
    accounting: {historical: core.HISTORICAL_CALLS, cap: core.MAX_CALLS, newMaximum: core.MAX_CALLS - core.HISTORICAL_CALLS}};
  const written = core.writeJson(roots, P3_REL, record, true);
  core.writeJson(roots, 'p3/creator-record.json', {recordSha256: written.sha256, creatorCommit: head, remotePullRequestHead: pr.headRefOid,
    testResults: checks.map(({label, result, stdoutSha256, stderrSha256}) => ({label, result, stdoutSha256, stderrSha256}))}, true);
  return {decision: 'PHYSICAL_V4_P3_PREPARED', epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic, recordSha256: written.sha256,
    recordPath: P3_REL, creatorCommit: head, pullRequestHead: pr.headRefOid, historicalCandidateResultSha256: old.terminal.sha256,
    p1DiagnosticWasmSha256: fileSha(old.wasm), referenceArchiveSha256: old.archive.sha256, tests: checks, builds: 0, acousticRenders: 0};
}

function extractReferenceSet(archivePath, cells, verifiedArchiveSha256) {
  if (verifiedArchiveSha256 !== REFERENCE_ARCHIVE_SHA256 || !fs.lstatSync(archivePath).isFile()) throw new Error('BLOCKED_PHYSICAL_V4_REFERENCE_ARCHIVE_SHA');
  const sfz = execFileSync('rtk', ['run', 'tar', '-xOzf', archivePath, REFERENCE_SFZ_MEMBER], {maxBuffer: 32 * 1024 * 1024});
  const parsed = analysis.parseSfz(sfz.toString('utf8')), rootMember = path.posix.dirname(REFERENCE_SFZ_MEMBER), cache = new Map(), samples = {};
  const rows = cells.map(cell => {
    const matches = parsed.regions.filter(region => {
      const root = Number(region.key ?? region.pitch_keycenter ?? cell.pitch), lowKey = Number(region.lokey ?? root), highKey = Number(region.hikey ?? root);
      const lowVelocity = Number(region.lovel ?? 1), highVelocity = Number(region.hivel ?? 127);
      return region.trigger !== 'release' && cell.pitch >= lowKey && cell.pitch <= highKey && cell.velocity >= lowVelocity && cell.velocity <= highVelocity && region.sample;
    });
    if (matches.length !== 1) throw new Error(`BLOCKED_PHYSICAL_V4_REFERENCE_MAPPING: ${cell.pitch}/${cell.velocity}/${matches.length}`);
    const sampleRelative = path.posix.normalize(path.posix.join(parsed.globalOps.default_path || '.', matches[0].sample));
    if (sampleRelative.startsWith('../') || sampleRelative === '..' || path.posix.isAbsolute(sampleRelative)) throw new Error('BLOCKED_PHYSICAL_V4_REFERENCE_PATH_ESCAPE');
    const member = path.posix.join(rootMember, sampleRelative);
    if (!cache.has(member)) {
      const flacBytes = execFileSync('rtk', ['run', 'tar', '-xOzf', archivePath, member], {maxBuffer: 128 * 1024 * 1024});
      const wavBytes = execFileSync('rtk', ['run', 'flac', '-d', '-c', '--silent', '-'], {input: flacBytes, maxBuffer: 128 * 1024 * 1024});
      cache.set(member, {audio: analysis.decodeWav24Stereo(wavBytes), flacSha256: core.sha256(flacBytes), flacSize: flacBytes.length});
    }
    const sample = cache.get(member), metrics = analysis.analyze(sample.audio.left, sample.audio.right, cell.pitch, sample.audio.sampleRate);
    samples[member] = {sha256: sample.flacSha256, size: sample.flacSize};
    return {pitch: cell.pitch, velocity: cell.velocity, sourceMember: member, sourceSha256: sample.flacSha256, audio: sample.audio, metrics};
  });
  const sourceManifest = {schemaVersion: 1, archiveSha256: REFERENCE_ARCHIVE_SHA256, sfzMember: REFERENCE_SFZ_MEMBER,
    sfzSha256: core.sha256(sfz), samples: Object.fromEntries(Object.entries(samples).sort(([a], [b]) => a.localeCompare(b)))};
  return {rows, sourceManifest, sfzSha256: core.sha256(sfz)};
}
function oldRowsByStage(old, stage) {
  const plan = oldCore.readJson(old.roots, `${stage}/plan.json`), ledger = oldCore.readJson(old.roots, `${stage}/ledger.json`);
  if (!plan || !ledger) throw new Error(`BLOCKED_PHYSICAL_V4_V3_STAGE_MISSING: ${stage}`);
  return plan.cells.map(cell => {
    const item = ledger.cells[oldCore.cellKey(cell)];
    if (!item || item.state !== 'COMPLETE') throw new Error(`BLOCKED_PHYSICAL_V4_V3_CELL_INCOMPLETE: ${stage}:${oldCore.cellKey(cell)}`);
    const result = oldCore.readJson(old.roots, `${stage}/${item.result}`);
    const artifact = oldCore.readDual(old.roots, `${stage}/artifacts/${encodeURIComponent(oldCore.cellKey(cell))}.wav`);
    if (!result || !artifact) throw new Error(`BLOCKED_PHYSICAL_V4_V3_CELL_ARTIFACT: ${stage}:${oldCore.cellKey(cell)}`);
    return {cell, result, resultSha256: oldCore.readDual(old.roots, `${stage}/${item.result}`).sha256, audio: artifact.bytes, audioSha256: artifact.sha256};
  });
}
function measuredFromFloatWav(bytes, pitch, storedRow = {}) {
  const audio = decodeFloatAudio(bytes), metrics = analysis.analyze(audio.left, audio.right, pitch, 48000);
  metrics.official.outputGuardHits = Number.isFinite(storedRow.outputGuardHits) ? storedRow.outputGuardHits : 0;
  metrics.official.finite = true;
  return {audio, metrics, peak: metrics.peak, peakDbfs: metrics.peakDbfs, outputGuardHits: metrics.official.outputGuardHits};
}
function officialRows(referenceRows, measuredRows) {
  return {reference: referenceRows.map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics.official})),
    measured: measuredRows.map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics.official}))};
}
function normalizedViolation(evaluation) {
  const limits = evaluation.limits, cells = evaluation.cells, velocity = evaluation.velocity;
  const values = [];
  for (const cell of cells) {
    values.push(Math.max(0, cell.directLevelViolationDb) / limits.directLevelErrorDb);
    values.push(Math.max(0, cell.postAttackShapeViolationDb) / limits.postAttackShapeErrorDb);
    values.push(Math.max(0, cell.centroidRatio - limits.centroidRatio) / limits.centroidRatio);
    values.push(Math.max(0, cell.above2kDelta - limits.above2kDelta) / limits.above2kDelta);
    values.push(Math.max(0, cell.peakDbfs - limits.peakMaxDbfs) / Math.max(1, Math.abs(limits.peakMaxDbfs)));
    if (!cell.finite || cell.guardHits !== 0) throw new Error('BLOCKED_PHYSICAL_V4_UNSAFE_OR_NONFINITE_CANDIDATE');
  }
  for (const row of velocity) {
    values.push(Math.max(0, row.violationDb) / limits.dynamicSpanErrorDb);
    if (row.fails) values.push(1);
  }
  return Math.max(0, ...values);
}
function evaluateMeasured(referenceRows, measuredRows) {
  const paired = officialRows(referenceRows, measuredRows);
  const evaluation = directMetrics.evaluateDirectReferenceMatrix(paired.reference, paired.measured,
    {requiredVelocityLayers: [14, 31, 36, 61, 124].filter(velocity => paired.reference.some(row => row.velocity === velocity))});
  if (evaluation.metrics.finite !== true || evaluation.metrics.guardHitTotal !== 0 || cellsMaxPeak(evaluation) >= evaluation.limits.peakMaxDbfs)
    throw new Error('BLOCKED_PHYSICAL_V4_UNSAFE_OR_NONFINITE_CANDIDATE');
  const failureCount = evaluation.metrics.cellFailureCount + evaluation.metrics.directPitchFailureCount;
  return {evaluation, violation: normalizedViolation(evaluation), failureCount, pass: failureCount === 0};
}
function cellsMaxPeak(evaluation) { return Math.max(...evaluation.cells.map(cell => cell.peakDbfs)); }
function scoreObservation({id, values, refs, rows, gainDb, source = 'v3', sourceSha256 = null}) {
  const safeRows = rows.map(row => {
    const fresh = measuredFromFloatWav(row.audio, row.cell.pitch, row.result.row);
    return {pitch: row.cell.pitch, velocity: row.cell.velocity, metrics: fresh.metrics, audio: fresh.audio,
      rowSha256: row.resultSha256, audioSha256: row.audioSha256, source: row.source || source};
  });
  const orderedRefs = core.STRESS_CELLS.map(cell => {
    const row = refs.find(item => item.pitch === cell.pitch && item.velocity === cell.velocity);
    if (!row) throw new Error(`BLOCKED_PHYSICAL_V4_REFERENCE_CELL: ${cell.pitch}/${cell.velocity}`);
    return row;
  });
  const orderedRows = core.STRESS_CELLS.map(cell => {
    const row = safeRows.find(item => item.pitch === cell.pitch && item.velocity === cell.velocity);
    if (!row) throw new Error(`BLOCKED_PHYSICAL_V4_MEASURED_CELL: ${cell.pitch}/${cell.velocity}`);
    return row;
  });
  const measured = evaluateMeasured(orderedRefs, orderedRows);
  const objective = loss.candidateLoss(orderedRefs.map((reference, index) => ({pitch: reference.pitch, reference: reference.audio, model: orderedRows[index].audio})), gainDb);
  return {id, values: core.validateValues(values), violation: measured.violation, loss: objective.total,
    distance: core.distanceFromBaseline(values), pass: measured.pass, official: measured.evaluation, objective,
    source, sourceSha256, rows: orderedRows.map(row => ({pitch: row.pitch, velocity: row.velocity, metadataSha256: row.rowSha256, wavSha256: row.audioSha256}))};
}
function loadHistoricalObservations(old, refs, gainDb) {
  const baselineRows = oldRowsByStage(old, 'baseline'), candidates = oldRowsByStage(old, 'candidate');
  const baseline = scoreObservation({id: 'v3-baseline', values: core.PARAMETERS.map(param => param.baseline), refs, rows: baselineRows,
    gainDb, source: 'immutable-v3-p1-baseline', sourceSha256: oldCore.readDual(old.roots, 'baseline/result.json').sha256});
  const grouped = new Map();
  for (const row of candidates) {
    const index = row.cell.candidate, entry = grouped.get(index) || {values: row.cell.values, rows: []};
    if (!core.same(entry.values, row.cell.values)) throw new Error('BLOCKED_PHYSICAL_V4_V3_CANDIDATE_VECTOR_MISMATCH');
    entry.rows.push(row); grouped.set(index, entry);
  }
  if (grouped.size !== 7) throw new Error('BLOCKED_PHYSICAL_V4_V3_CANDIDATE_VECTOR_COUNT');
  const observations = [baseline];
  for (const [index, item] of [...grouped.entries()].sort(([a], [b]) => a - b)) {
    const expected = core.STRESS_CELLS.length;
    if (item.rows.length !== expected) throw new Error(`BLOCKED_PHYSICAL_V4_V3_CANDIDATE_ROW_COUNT: ${index}`);
    const resultSha = oldCore.readDual(old.roots, `candidate/result.json`).sha256;
    observations.push(scoreObservation({id: `v3-candidate-${String(index + 1).padStart(2, '0')}`, values: item.values,
      refs, rows: item.rows, gainDb, source: 'immutable-v3-p1-candidate', sourceSha256: resultSha}));
  }
  return observations;
}
function callAudio(roots, id, meta, render) {
  const started = core.startCall(roots, id, {...meta, audioArtifactRequired: true});
  if (started.reused) return {id, result: started.result, audio: started.artifact.bytes, reused: true};
  try {
    const observed = render(), stored = core.completeCall(roots, id, observed.row, observed.audio);
    return {id, result: stored.result, audio: observed.audio, reused: false, observed};
  } catch (error) {
    core.markAmbiguous(roots, id, error.message);
    throw new Error(`BLOCKED_PHYSICAL_V4_AMBIGUOUS_CALL: ${id}: ${error.message}`);
  }
}
function persistSourceManifest(roots, sourceManifest) {
  return core.writeJson(roots, 'reference/source-manifest.json', sourceManifest, true);
}
function refsFor(roots, archivePath, cells, verifiedArchiveSha256) {
  const source = extractReferenceSet(archivePath, cells, verifiedArchiveSha256);
  persistSourceManifest(roots, source.sourceManifest);
  return source.rows;
}
function candidateRowsFromV4(roots, vectorId) {
  const rows = [];
  for (const cell of core.STRESS_CELLS) {
    const id = `p3-${vectorId}-${cell.pitch}-${cell.velocity}`, result = core.readJson(roots, `${core.callKey(id)}/result.json`), wav = core.readDual(roots, `${core.callKey(id)}/audio.wav`);
    if (!result || !wav) throw new Error(`BLOCKED_PHYSICAL_V4_CANDIDATE_INCOMPLETE: ${vectorId}:${cell.pitch}/${cell.velocity}`);
    rows.push({cell: {pitch: cell.pitch, velocity: cell.velocity}, result, resultSha256: core.sha256(core.jsonBytes(result)), audio: wav.bytes, audioSha256: wav.sha256, source: 'v4'});
  }
  return rows;
}
function scoreV4Vector(roots, refs, gainDb, vector) {
  const existing = core.readJson(roots, `p3/scores/${vector.id}.json`, false);
  if (existing) {
    const candidateRows = candidateRowsFromV4(roots, vector.id);
    const fresh = scoreObservation({id: vector.id, values: vector.values, refs, rows: candidateRows, gainDb, source: 'v4'});
    if (!core.same(existing.score, fresh)) throw new Error(`BLOCKED_PHYSICAL_V4_SCORE_READBACK: ${vector.id}`);
    return existing.score;
  }
  const rows = [];
  for (const cell of core.STRESS_CELLS) {
    const id = `p3-${vector.id}-${cell.pitch}-${cell.velocity}`;
    const call = callAudio(roots, id, {stage: 'candidate', vectorId: vector.id, values: vector.values, cell},
      () => renderDiagnostic({cell: {...cell, kind: 'candidate', id: vector.id}, values: vector.values}));
    const decoded = measuredFromFloatWav(call.audio, cell.pitch, call.result.row);
    rows.push({cell, result: call.result, resultSha256: core.sha256(core.jsonBytes(call.result)), audio: call.audio, audioSha256: core.sha256(call.audio), metrics: decoded.metrics, source: 'v4'});
  }
  const score = scoreObservation({id: vector.id, values: vector.values, refs, rows, gainDb, source: 'v4'});
  core.writeJson(roots, `p3/scores/${vector.id}.json`, {schemaVersion: 1, score}, true);
  return score;
}
function reuseLineageSha256(sourceScore) {
  if (sourceScore.sourceSha256) return sourceScore.sourceSha256;
  if (!Array.isArray(sourceScore.rows) || sourceScore.rows.length === 0) throw new Error('BLOCKED_PHYSICAL_V4_REUSE_LINEAGE');
  return core.sha256(core.jsonBytes(sourceScore.rows));
}
function reuseScore(roots, vector, sourceScore) {
  const rel = `p3/reuse/${vector.id}.json`;
  return core.writeJson(roots, rel, {schemaVersion: 1, id: vector.id, values: vector.values,
    reusedFrom: sourceScore.id, sourceResultSha256: reuseLineageSha256(sourceScore), sourceRowHashes: sourceScore.rows,
    score: sourceScore, chargedCalls: 0}, true);
}
function runOptimizer(roots, old, sourceRefs) {
  const baselineRows = oldRowsByStage(old, 'baseline'), refsStress = core.STRESS_CELLS.map(cell => sourceRefs.find(row => row.pitch === cell.pitch && row.velocity === cell.velocity));
  const baselineMetrics = core.STRESS_CELLS.map(cell => {
    const entry = baselineRows.find(row => row.cell.pitch === cell.pitch && row.cell.velocity === cell.velocity);
    return measuredFromFloatWav(entry.audio, cell.pitch, entry.result.row).metrics;
  });
  const gainDb = loss.sharedGainDb(refsStress.map(row => row.metrics), baselineMetrics);
  const sourceManifest = core.readJson(roots, 'reference/source-manifest.json');
  const existingObs = loadHistoricalObservations(old, refsStress, gainDb);
  const completedNew = core.readJson(roots, P3_RESULT_REL, false);
  if (completedNew) return {result: completedNew, gainDb, refsStress};
  let observations = [...existingObs], incumbent = observations.slice().sort(core.compareScores)[0], chargedVectors = 0, rounds = [];
  for (const [roundIndex, fraction] of [0.05, 0.025].entries()) {
    const vectors = core.neighborVectors(incumbent.values, fraction, observations);
    const roundPlan = {schemaVersion: 1, round: roundIndex + 1, fraction, incumbentId: incumbent.id, incumbentValues: incumbent.values,
      vectors: vectors.map(({id, values, reuse}) => ({id, values, reuseFrom: reuse?.id || null, reuseSha256: reuse ? reuseLineageSha256(reuse) : null})), createdAt: new Date().toISOString()};
    const existingPlan = core.readJson(roots, `p3/round-${String(roundIndex + 1).padStart(2, '0')}-plan.json`, false);
    if (existingPlan) {
      const comparable = value => ({...value, createdAt: undefined});
      if (!core.same(comparable(existingPlan), comparable(roundPlan))) throw new Error(`BLOCKED_PHYSICAL_V4_ROUND_PLAN_CONFLICT: ${roundIndex + 1}`);
    } else core.writeJson(roots, `p3/round-${String(roundIndex + 1).padStart(2, '0')}-plan.json`, roundPlan, true);
    const roundScores = [];
    for (const vector of vectors) {
      if (vector.reuse) {
        const reused = reuseScore(roots, vector, vector.reuse);
        roundScores.push({id: vector.id, values: vector.values, reusedFrom: vector.reuse.id, reuseRecordSha256: reused.sha256, score: vector.reuse});
        continue;
      }
      if (chargedVectors >= 12) throw new Error('BLOCKED_PHYSICAL_V4_CANDIDATE_VECTOR_BUDGET');
      const before = core.charged(roots), score = scoreV4Vector(roots, refsStress, gainDb, vector);
      chargedVectors += core.charged(roots) - before > 0 ? 1 : 0;
      const decision = core.strictImprovement(score, incumbent) ? 'IMPROVES_INCUMBENT' : 'REJECT';
      observations.push(score); roundScores.push({id: vector.id, values: vector.values, decision, score});
      if (score.violation === 0 && score.pass) {
        incumbent = score;
        rounds.push({round: roundIndex + 1, fraction, incumbentBefore: observations.length > 1 ? observations[observations.length - 2].id : null,
          candidateCount: roundScores.length, candidates: roundScores, earlyPass: true});
        break;
      }
      if (core.strictImprovement(score, incumbent)) incumbent = score;
    }
    if (!rounds.at(-1)?.earlyPass) rounds.push({round: roundIndex + 1, fraction, incumbentAfter: incumbent.id, candidateCount: roundScores.length, candidates: roundScores});
    core.writeJson(roots, `p3/round-${String(roundIndex + 1).padStart(2, '0')}-result.json`, rounds.at(-1), true);
    if (rounds.at(-1).earlyPass) break;
  }
  const accepted = incumbent.violation === 0 && incumbent.pass;
  const result = {schemaVersion: 1, decision: accepted ? 'PHYSICAL_V4_OPTIMIZER_PASS' : 'BLOCKED_PHYSICAL_FIT_V4_NO_ACCEPTABLE_CANDIDATE',
    lossVersion: loss.LOSS_VERSION, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic, p1DiagnosticWasmSha256: DIAGNOSTIC_WASM_SHA256,
    v3TerminalResultSha256: old.terminal.sha256, archiveSha256: REFERENCE_ARCHIVE_SHA256, sharedGainOffsetDb: gainDb,
    initialObservationIds: existingObs.map(item => item.id), initialIncumbent: existingObs.slice().sort(core.compareScores)[0], rounds,
    selected: accepted ? incumbent : null, newVectorsCharged: chargedVectors, newCandidateCalls: core.charged(roots), maxVectors: 12,
    maxNewCandidateCalls: 84, candidateCallCap: core.STAGES.candidate,
    sourceManifestSha256: core.readDual(roots, 'reference/source-manifest.json').sha256,
    v3CandidateTerminalDecision: old.terminal.result.decision, createdAt: new Date().toISOString()};
  core.writeJson(roots, P3_RESULT_REL, result, true);
  if (accepted) core.writeJson(roots, P3_SELECTION_REL, {schemaVersion: 1, decision: result.decision, selected: incumbent,
    optimizerResultSha256: core.readDual(roots, P3_RESULT_REL).sha256, trainingOverlap: core.STRESS_CELLS}, true);
  return {result, gainDb, refsStress};
}

function evaluateStoredAudioRows(roots, ids, cells) {
  return cells.map((cell, index) => {
    const id = ids[index], result = core.readJson(roots, `${core.callKey(id)}/result.json`), audio = core.readDual(roots, `${core.callKey(id)}/audio.wav`);
    if (!result || !audio) throw new Error(`BLOCKED_PHYSICAL_V4_PHASE_INCOMPLETE: ${id}`);
    const measured = measuredFromFloatWav(audio.bytes, cell.pitch, result.row);
    return {pitch: cell.pitch, velocity: cell.velocity, metrics: measured.metrics, audio: measured.audio,
      audioSha256: audio.sha256, resultSha256: core.sha256(core.jsonBytes(result)), cell};
  });
}
function runConfirmation(roots, refs, selected) {
  const prior = core.readJson(roots, P3_HOLDOUT_REL, false);
  if (prior) return prior;
  const overlap = new Set(core.STRESS_CELLS.map(cell => `${cell.pitch}:${cell.velocity}`)), ids = [];
  for (const cell of core.HOLDOUT_CELLS) {
    const id = `p3-holdout-${cell.pitch}-${cell.velocity}`; ids.push(id);
    callAudio(roots, id, {stage: 'holdout', cell, values: selected.values, trainingLabel: overlap.has(`${cell.pitch}:${cell.velocity}`) ? 'training-overlap' : 'new-coordinate'},
      () => renderDiagnostic({cell: {...cell, kind: 'holdout'}, values: selected.values}));
  }
  const actual = evaluateStoredAudioRows(roots, ids, core.HOLDOUT_CELLS);
  const reference = core.HOLDOUT_CELLS.map(cell => refs.find(row => row.pitch === cell.pitch && row.velocity === cell.velocity));
  const evaluated = evaluateMeasured(reference, actual), report = {schemaVersion: 1, decision: evaluated.pass ? 'PHYSICAL_V4_CONFIRMATION_PASS' : 'BLOCKED_PHYSICAL_V4_CONFIRMATION_FAIL',
    coverage: {cells: actual.length, trainingOverlap: overlap.size, newCoordinates: actual.length - overlap.size}, pass: evaluated.pass,
    official: evaluated.evaluation, rows: actual.map((row, index) => ({pitch: row.pitch, velocity: row.velocity,
      trainingLabel: overlap.has(`${row.pitch}:${row.velocity}`) ? 'training-overlap' : 'new-coordinate', resultSha256: row.resultSha256, wavSha256: row.audioSha256,
      official: row.metrics.official, referenceSourceSha256: reference[index].sourceSha256})), selectedValues: selected.values, createdAt: new Date().toISOString()};
  core.writeJson(roots, P3_HOLDOUT_REL, report, true);
  return report;
}
function runHeadroom(roots, selected) {
  const prior = core.readJson(roots, P3_HEADROOM_REL, false);
  if (prior) return prior;
  const rows = [];
  for (const pattern of core.RELEASE_CHORDS) {
    const pair = [];
    for (const [role, values] of [['baseline', core.PARAMETERS.map(param => param.baseline)], ['candidate', selected.values]]) {
      const cell = {kind: 'headroom', pattern: pattern.pattern, role}, id = `p3-headroom-${pattern.pattern}-${role}`;
      const call = callAudio(roots, id, {stage: 'headroom', pattern: pattern.pattern, role, values, cell},
        () => renderDiagnostic({cell, values, frames: 96000, notes: pattern.pitches.map(pitch => ({pitch, velocity: pattern.velocity}))}));
      const result = call.result.row;
      if (!result.finite || result.outputGuardHits !== 0 || result.peak >= 1 || result.maxCallbackMs >= (128 / 48000) * 1000)
        throw new Error(`BLOCKED_PHYSICAL_V4_HEADROOM_SAFETY: ${pattern.pattern}:${role}`);
      pair.push(result);
    }
    const baseline = pair[0], candidate = pair[1], peakDeltaDb = candidate.peakDbfs - baseline.peakDbfs;
    if (peakDeltaDb > 0.1 + 1e-9) throw new Error(`BLOCKED_PHYSICAL_V4_HEADROOM_PEAK: ${pattern.pattern}:${peakDeltaDb}`);
    rows.push({pattern: pattern.pattern, pitches: pattern.pitches, velocity: pattern.velocity, baseline: {peak: baseline.peak, peakDbfs: baseline.peakDbfs,
      outputGuardHits: baseline.outputGuardHits, maxCallbackMs: baseline.maxCallbackMs, callbackMs: baseline.callbackMs},
      candidate: {peak: candidate.peak, peakDbfs: candidate.peakDbfs, outputGuardHits: candidate.outputGuardHits,
        maxCallbackMs: candidate.maxCallbackMs, callbackMs: candidate.callbackMs}, peakDeltaDb, pass: true});
  }
  const report = {schemaVersion: 1, decision: 'PHYSICAL_V4_HEADROOM_PASS', cells: rows.length, rows, createdAt: new Date().toISOString()};
  core.writeJson(roots, P3_HEADROOM_REL, report, true);
  return report;
}
function p3PromotionIntent(roots, selected) {
  const prior = core.readJson(roots, PROMOTION_INTENT_REL, false);
  if (prior) {
    if (!core.same(prior.selectedValues, selected.values)) throw new Error('BLOCKED_PHYSICAL_V4_PROMOTION_INTENT_CONFLICT');
    return prior;
  }
  const p3Record = core.readJson(roots, P3_REL), optimizer = core.readDual(roots, P3_RESULT_REL);
  const confirmation = core.readDual(roots, P3_HOLDOUT_REL), headroom = core.readDual(roots, P3_HEADROOM_REL);
  const record = {schemaVersion: 1, issue: 7, epoch: core.EPOCH, lineage: core.LINEAGE.production, p3RecordSha256: core.readDual(roots, P3_REL).sha256,
    p3CreatorCommit: p3Record.creatorCommit, optimizerResultSha256: optimizer.sha256, confirmationResultSha256: confirmation.sha256,
    headroomResultSha256: headroom.sha256, selectedValues: selected.values, allowedCommitPaths: P4_ALLOWED_REL,
    requiredParentCommit: git(['rev-parse', 'HEAD']), createdAt: new Date().toISOString()};
  core.writeJson(roots, PROMOTION_INTENT_REL, record, true);
  return record;
}
function presetValues() {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, P4_ALLOWED_REL[1].replace('wasm/shared/generated/super-synth_grand_profiles.h', 'wasm/plugins/dsp/super-synth/presets.json')), 'utf8'));
  const hammer = presets.concert_grand?.engine_config?.hammer;
  if (!hammer) throw new Error('BLOCKED_PHYSICAL_V4_PRESET_SHAPE');
  return core.PARAMETERS.map(parameter => hammer[parameter.name]);
}
function headerValues() {
  const source = fs.readFileSync(path.join(ROOT, 'wasm/shared/generated/super-synth_grand_profiles.h'), 'utf8');
  return core.PARAMETERS.map(parameter => {
    const pattern = new RegExp(`\\.${parameter.name}\\s*=\\s*([-+0-9.eE]+)f`), match = source.match(pattern);
    if (!match) throw new Error(`BLOCKED_PHYSICAL_V4_GENERATED_PROFILE_FIELD: ${parameter.name}`);
    const value = Number(match[1]);
    if (!Number.isFinite(value)) throw new Error(`BLOCKED_PHYSICAL_V4_GENERATED_PROFILE_VALUE: ${parameter.name}`);
    return value;
  });
}
function assertValuesMatch(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > 1e-9))
    throw new Error(`BLOCKED_PHYSICAL_V4_PROMOTION_VALUES: ${label}:${JSON.stringify({actual, expected})}`);
}
function buildInfo(role, buildDirectory) {
  const wasm = path.join(ROOT, buildDirectory, WASM_RELATIVE), bytes = fs.readFileSync(wasm), module = new WebAssembly.Module(bytes);
  return {buildDirectory, wasmPath: path.relative(ROOT, wasm), wasmSha256: core.sha256(bytes), wasmSize: bytes.length,
    exports: WebAssembly.Module.exports(module).map(item => item.name).sort(), cacheSha256: fileSha(path.join(ROOT, buildDirectory, 'CMakeCache.txt'))};
}
function p4PromotionDiff(p3Commit) {
  const commits = git(['rev-list', '--parents', `${p3Commit}..HEAD`]).split('\n').filter(Boolean);
  if (commits.length !== 1) throw new Error(`BLOCKED_PHYSICAL_V4_P4_COMMIT_COUNT: ${commits.length}`);
  const [commit, parent] = commits[0].split(' ');
  if (parent !== p3Commit) throw new Error('BLOCKED_PHYSICAL_V4_P4_PARENT');
  const changed = git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).split('\n').filter(Boolean).sort();
  if (!core.same(changed, P4_ALLOWED_REL)) throw new Error(`BLOCKED_PHYSICAL_V4_P4_PATH_ALLOWLIST: ${changed.join(',')}`);
  return {commit, parent, changed};
}
function buildP4(roots, intent) {
  const old = core.readJson(roots, P4_REL, false);
  if (old) return old;
  const p3Record = core.readJson(roots, P3_REL), diff = p4PromotionDiff(p3Record.creatorCommit), head = git(['rev-parse', 'HEAD']);
  if (diff.commit !== head) throw new Error('BLOCKED_PHYSICAL_V4_P4_HEAD');
  const pr = verifyRemoteHead(head), selectedValues = core.validateValues(intent.selectedValues);
  assertValuesMatch(presetValues(), selectedValues, 'presets.json');
  assertValuesMatch(headerValues(), selectedValues, 'generated profile header');
  const options = ['-DCMAKE_TOOLCHAIN_FILE=' + path.join(ROOT, 'wasm/cmake/wasm32-clang.cmake')];
  const commands = [];
  for (const [role, buildDirectory] of [['test', TEST_BUILD_DIR], ['release', RELEASE_BUILD_DIR]]) {
    commands.push(requirePass(runRtk(['cmake', '-S', 'wasm', '-B', buildDirectory, ...options, ...BUILD_OPTIONS[role]]), `${role} configure`));
    commands.push(requirePass(runRtk(['cmake', '--build', buildDirectory]), `${role} build`));
  }
  const test = buildInfo('test', TEST_BUILD_DIR), release = buildInfo('release', RELEASE_BUILD_DIR);
  if (!test.exports.includes('soraoto_supersynth_guard_hit_count') || release.exports.includes('soraoto_supersynth_guard_hit_count')) throw new Error('BLOCKED_PHYSICAL_V4_BUILD_EXPORT_BOUNDARY');
  if (core.same(test.exports, release.exports) || test.wasmSha256 === release.wasmSha256) throw new Error('BLOCKED_PHYSICAL_V4_BUILD_EXPORT_SEPARATION');
  if (test.exports.some(name => name.includes('stage3e_')) || release.exports.some(name => name.includes('stage3e_'))) throw new Error('BLOCKED_PHYSICAL_V4_STAGE3E_EXPORT');
  const artifactTest = core.writeImmutableDual(roots, 'p4/artifacts/production-test-plugin.wasm', fs.readFileSync(path.join(ROOT, test.wasmPath)));
  const artifactRelease = core.writeImmutableDual(roots, 'p4/artifacts/production-release-plugin.wasm', fs.readFileSync(path.join(ROOT, release.wasmPath)));
  if (artifactTest.sha256 !== test.wasmSha256 || artifactRelease.sha256 !== release.wasmSha256) throw new Error('BLOCKED_PHYSICAL_V4_BUILD_ARTIFACT_READBACK');
  const trackedDiff = git(['diff', '--name-only']);
  if (trackedDiff) throw new Error(`BLOCKED_PHYSICAL_V4_BUILD_SOURCE_DRIFT: ${trackedDiff}`);
  const checks = runPostPromotionChecks();
  const failures = checks.filter(item => item.result !== 'PASS');
  const record = {schemaVersion: 1, issue: 7, epoch: core.EPOCH, lineage: core.LINEAGE.production, promotionIntentSha256: core.readDual(roots, PROMOTION_INTENT_REL).sha256,
    p3RecordSha256: core.readDual(roots, P3_REL).sha256, selectedValues, promotionCommit: diff.commit, promotionParent: diff.parent,
    prReadback: pr, builds: {productionTest: test, productionRelease: release}, tests: checks,
    decision: failures.length ? 'BLOCKED_PHYSICAL_V4_P4_TESTS' : 'PHYSICAL_V4_P4_BUILD_PASS', createdAt: new Date().toISOString()};
  core.writeJson(roots, P4_BUILD_REL, record, true);
  if (failures.length) throw new Error(`BLOCKED_PHYSICAL_V4_P4_TESTS: ${failures.map(item => item.label).join(',')}`);
  return record;
}
function runPostPromotionChecks() {
  const env = {...process.env, SORAOTO_WASM_BUILD_DIR: path.resolve(ROOT, TEST_BUILD_DIR)}, checks = [];
  for (const name of REQUIRED_P4_TESTS) {
    const file = stage3.REGRESSION_TESTS[name];
    checks.push(runRtk(['node', '--test', file], {env}));
    checks.at(-1).label = name;
  }
  checks.push(runRtk(['ctest', '--test-dir', TEST_BUILD_DIR, '--output-on-failure'])); checks.at(-1).label = 'full-ctest';
  checks.push(runRtk(['python3', '-m', 'unittest', 'wasm/cmake/test_super_synth_metadata.py'])); checks.at(-1).label = 'metadata-tests';
  checks.push(runRtk(['node', '--test', 'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v4.test.cjs'])); checks.at(-1).label = 'v4-focused-tests';
  checks.push(runRtk(['node', '--test', 'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.test.cjs'])); checks.at(-1).label = 'v3-regression-tests';
  checks.push(runRtk(['git', 'diff', '--check'])); checks.at(-1).label = 'diff-check';
  return checks.map(item => ({label: item.label, command: item.command, result: item.error || item.status !== 0 ? 'FAIL' : 'PASS', status: item.status,
    stdoutSha256: core.sha256(item.stdout), stderrSha256: core.sha256(item.stderr), error: item.error,
    summary: `${(item.stdout || '').trim().split('\n').slice(-5).join(' | ')} ${(item.stderr || '').trim().split('\n').slice(-2).join(' | ')}`.trim()}));
}

function callMetric(roots, id, meta, render) {
  const started = core.startCall(roots, id, {...meta, audioArtifactRequired: false});
  if (started.reused) return started.result.row;
  try {
    const row = render();
    core.completeCall(roots, id, row, null);
    return row;
  } catch (error) {
    core.markAmbiguous(roots, id, error.message);
    throw new Error(`BLOCKED_PHYSICAL_V4_AMBIGUOUS_METRIC_CALL: ${id}: ${error.message}`);
  }
}
function p4ProductionRecord(build) {
  return {builds: {production: {buildDirectory: TEST_BUILD_DIR, wasm: {path: WASM_RELATIVE, sha256: build.builds.productionTest.wasmSha256}}}};
}
function comparePCM(leftA, rightA, leftB, rightB) {
  if (leftA.length !== rightA.length || leftA.length !== leftB.length || leftA.length !== rightB.length) throw new Error('BLOCKED_RELEASE_OUTPUT_EQUIVALENCE_SHAPE');
  let maxDifference = 0, finite = true, peakA = 0, peakB = 0;
  for (let i = 0; i < leftA.length; i++) {
    for (const value of [leftA[i], rightA[i], leftB[i], rightB[i]]) if (!Number.isFinite(value)) finite = false;
    peakA = Math.max(peakA, Math.abs(leftA[i]), Math.abs(rightA[i])); peakB = Math.max(peakB, Math.abs(leftB[i]), Math.abs(rightB[i]));
    maxDifference = Math.max(maxDifference, Math.abs(leftA[i] - leftB[i]), Math.abs(rightA[i] - rightB[i]));
  }
  return {sampleCountPerChannel: leftA.length, maxAbsoluteSampleDifference: maxDifference, finite,
    testPeak: peakA, releasePeak: peakB, testPeakDbfs: peakA ? 20 * Math.log10(peakA) : -240, releasePeakDbfs: peakB ? 20 * Math.log10(peakB) : -240,
    pass: finite && peakA < 1 && peakB < 1 && maxDifference <= 1e-6};
}
function releasePairs() {
  return [...core.RELEASE_SINGLE_CELLS, ...core.RELEASE_CHORDS].map((cell, index) => ({index: index + 1, cell}));
}
function runReleaseEquivalence(roots, build) {
  const prior = core.readJson(roots, P4_EQUIVALENCE_REL, false);
  if (prior) return prior;
  const testRecord = p4ProductionRecord(build), pairs = [];
  for (const {index, cell} of releasePairs()) {
    const pairId = `release-${String(index).padStart(2, '0')}`, testId = `${pairId}-production-test`, releaseId = `${pairId}-production-release`;
    const test = callAudio(roots, testId, {stage: 'release-equivalence', pairId, build: 'productionTest', cell},
      () => renderProductionCell({record: testRecord, cell, buildDirectory: TEST_BUILD_DIR}));
    const release = callAudio(roots, releaseId, {stage: 'release-equivalence', pairId, build: 'productionRelease', cell},
      () => renderProductionCell({record: testRecord, cell, buildDirectory: RELEASE_BUILD_DIR}));
    const testCapture = test.observed || {...decodeFloatAudio(test.audio), audio: test.audio, finite: true,
      peak: test.result.row.peak, peakDbfs: test.result.row.peakDbfs, guardHits: test.result.row.guardHits, waveformSha256: test.result.row.waveformSha256};
    const releaseCapture = release.observed || {...decodeFloatAudio(release.audio), audio: release.audio, finite: true,
      peak: release.result.row.peak, peakDbfs: release.result.row.peakDbfs, guardHits: release.result.row.guardHits, waveformSha256: release.result.row.waveformSha256};
    const comparison = comparePCM(testCapture.left, testCapture.right, releaseCapture.left, releaseCapture.right);
    const row = {pairId, cell, comparison, productionTest: {callId: testId, wasmSha256: build.builds.productionTest.wasmSha256,
      exports: build.builds.productionTest.exports, guardHits: testCapture.guardHits, waveformSha256: testCapture.waveformSha256,
      peak: testCapture.peak, peakDbfs: testCapture.peakDbfs, resultSha256: core.sha256(core.jsonBytes(test.result))},
      productionRelease: {callId: releaseId, wasmSha256: build.builds.productionRelease.wasmSha256,
        exports: build.builds.productionRelease.exports, peak: releaseCapture.peak, peakDbfs: releaseCapture.peakDbfs,
        waveformSha256: releaseCapture.waveformSha256, resultSha256: core.sha256(core.jsonBytes(release.result))}};
    pairs.push(row);
    if (testCapture.guardHits !== 0 || !comparison.pass) {
      const failure = {schemaVersion: 1, decision: 'BLOCKED_RELEASE_OUTPUT_EQUIVALENCE', expectedPairs: 12, completedPairs: pairs.length,
        pairs, p4BuildSha256: core.readDual(roots, P4_BUILD_REL).sha256, createdAt: new Date().toISOString()};
      core.writeJson(roots, P4_EQUIVALENCE_REL, failure, true);
      return failure;
    }
  }
  const report = {schemaVersion: 1, decision: 'P4_RELEASE_EQUIVALENCE_PASS', expectedPairs: 12, actualAudioCalls: pairs.length * 2,
    pairs, p4BuildSha256: core.readDual(roots, P4_BUILD_REL).sha256, tolerance: 1e-6, createdAt: new Date().toISOString()};
  core.writeJson(roots, P4_EQUIVALENCE_REL, report, true);
  return report;
}
function readMetricCalls(roots, prefix, cells) {
  return cells.map((cell, index) => {
    const id = `${prefix}-${cell.kind}-${cell.pitch}-${cell.velocity}`;
    const record = core.readJson(roots, `${core.callKey(id)}/result.json`);
    if (!record) throw new Error(`BLOCKED_PHYSICAL_V4_PHASE_INCOMPLETE: ${id}`);
    return record.row;
  });
}
function runStage3(roots, build) {
  const prior = core.readJson(roots, STAGE3_RESULT_REL, false);
  if (prior) return prior;
  const cells = stage3.cells(), record = p4ProductionRecord(build), rows = [];
  if (cells.length !== 486) throw new Error('BLOCKED_PHYSICAL_V4_STAGE3_CELL_COUNT');
  for (const cell of cells) {
    const id = `stage3-${cell.kind}-${cell.pitch}-${cell.velocity}`;
    const row = callMetric(roots, id, {stage: 'stage3', cell, testWasmSha256: build.builds.productionTest.wasmSha256}, () => {
      const observed = stage3.renderDefault({root: ROOT, record, cell});
      return {...observed, cell};
    });
    rows.push(row);
  }
  const checks = Object.fromEntries(build.tests.filter(item => REQUIRED_P4_TESTS.includes(item.label)).map(item => [item.label, {result: item.result, stdoutSha256: item.stdoutSha256, stderrSha256: item.stderrSha256}]));
  const summary = stage3.evaluate(rows, fixture, checks);
  const report = {schemaVersion: 1, decision: summary.decision, coverage: summary.coverage, summary,
    p4BuildSha256: core.readDual(roots, P4_BUILD_REL).sha256, productionTestWasmSha256: build.builds.productionTest.wasmSha256,
    rowsSha256: core.sha256(core.jsonBytes(rows)), createdAt: new Date().toISOString()};
  core.writeJson(roots, STAGE3_RESULT_REL, report, true);
  return report;
}
function runStage4(roots, build, stage3Result) {
  const prior = core.readJson(roots, STAGE4_RESULT_REL, false);
  if (prior) return prior;
  if (stage3Result.decision !== 'STAGE3_READY_FOR_STAGE4') return {decision: 'BLOCKED_STAGE4_STAGE3_REQUIRED', stage3Decision: stage3Result.decision, acousticRenders: 0};
  const cells = stage4.cells(), record = p4ProductionRecord(build), rows = [];
  if (cells.length !== 1423) throw new Error('BLOCKED_PHYSICAL_V4_STAGE4_CELL_COUNT');
  stage4.assertStage4Exports(ROOT, record);
  for (const cell of cells) {
    const id = `stage4-${cell.kind}-${cell.key}`;
    const row = callMetric(roots, id, {stage: 'stage4', cell, testWasmSha256: build.builds.productionTest.wasmSha256},
      () => ({...stage4.renderDefault({root: ROOT, record, cell}), kind: cell.kind, key: cell.key}));
    rows.push(row);
  }
  const lifecycle = rows.filter(row => row.kind === 'lifecycle'), repeats = rows.filter(row => row.kind === 'repeat');
  const stage3Rows = readMetricCalls(roots, 'stage3', stage3.cells());
  const stage3Identity = {resultSha256: core.readDual(roots, STAGE3_RESULT_REL).sha256, identity: {p4BuildSha256: core.readDual(roots, P4_BUILD_REL).sha256,
    productionTestWasmSha256: build.builds.productionTest.wasmSha256, decision: stage3Result.decision}};
  const identity = {issue: 7, epoch: core.EPOCH, stage: 'stage4', productionTestWasmSha256: build.builds.productionTest.wasmSha256,
    productionReleaseWasmSha256: build.builds.productionRelease.wasmSha256, p4Commit: build.promotionCommit};
  const summary = stage4.evaluate({root: ROOT, roots, identity, stage3Identity, matrix: lifecycle, repeats, stage3Rows});
  const report = {schemaVersion: 1, decision: summary.decision, coverage: {lifecycle: lifecycle.length, repeats: repeats.length, total: rows.length,
    adjacentComparisons: 1392}, summary, stage3ResultSha256: stage3Identity.resultSha256,
    productionTestWasmSha256: build.builds.productionTest.wasmSha256, p4BuildSha256: core.readDual(roots, P4_BUILD_REL).sha256,
    rowsSha256: core.sha256(core.jsonBytes(rows)), createdAt: new Date().toISOString()};
  core.writeJson(roots, STAGE4_RESULT_REL, report, true);
  return report;
}
function finalChecks(roots) {
  const test = runRtk(['npm', 'test'], {cwd: path.join(ROOT, 'web-player')});
  const build = runRtk(['npm', 'run', 'build'], {cwd: path.join(ROOT, 'web-player')});
  const checks = [test, build].map((item, index) => ({label: index === 0 ? 'web-player-tests' : 'web-player-build', command: item.command,
    result: item.error || item.status !== 0 ? 'FAIL' : 'PASS', status: item.status, stdoutSha256: core.sha256(item.stdout), stderrSha256: core.sha256(item.stderr),
    summary: `${(item.stdout || '').trim().split('\n').slice(-6).join(' | ')} ${(item.stderr || '').trim().split('\n').slice(-2).join(' | ')}`.trim()}));
  core.writeJson(roots, 'final/web-player-checks.json', checks, true);
  return checks;
}
async function continueRun(roots, home) {
  const p3 = core.readJson(roots, P3_REL), head = git(['rev-parse', 'HEAD']);
  if (!p3 || p3.contract.sha256 !== CONTRACT.sha256 || !isCommitAncestor(p3.creatorCommit, head)) throw new Error('BLOCKED_PHYSICAL_V4_P3_RUNTIME_IDENTITY');
  verifyRemoteHead(head);
  const old = safeP1Snapshot(home);
  if (old.terminal.sha256 !== p3.historicalV3.terminalResultSha256 || fileSha(old.wasm) !== p3.historicalV3.p1DiagnosticWasmSha256) throw new Error('BLOCKED_PHYSICAL_V4_FROZEN_P1_IDENTITY');
  for (const [relative, sha] of Object.entries(p3.optimizer.sourceHashes)) if (repoFileSha(relative) !== sha) throw new Error(`BLOCKED_PHYSICAL_V4_SOURCE_DRIFT: ${relative}`);
  const refCells = [...core.STRESS_CELLS, ...core.HOLDOUT_CELLS], archivePath = analysis.locateGoogleDriveArchive();
  const archiveSha256 = await analysis.sha256File(archivePath);
  if (archiveSha256 !== REFERENCE_ARCHIVE_SHA256) throw new Error('BLOCKED_PHYSICAL_V4_REFERENCE_ARCHIVE_SHA');
  const refs = refsFor(roots, archivePath, refCells, archiveSha256), opt = runOptimizer(roots, old, refs), optimizer = opt.result;
  if (optimizer.decision !== 'PHYSICAL_V4_OPTIMIZER_PASS') return {decision: optimizer.decision, optimizer, budget: budget(roots), builds: 0};
  const selection = core.readJson(roots, P3_SELECTION_REL);
  const confirmation = runConfirmation(roots, refs, selection.selected);
  if (confirmation.decision !== 'PHYSICAL_V4_CONFIRMATION_PASS') return {decision: confirmation.decision, optimizer, confirmation, budget: budget(roots), builds: 0};
  const headroom = runHeadroom(roots, selection.selected);
  if (headroom.decision !== 'PHYSICAL_V4_HEADROOM_PASS') return {decision: headroom.decision, optimizer, confirmation, headroom, budget: budget(roots), builds: 0};
  const intent = p3PromotionIntent(roots, selection.selected), p4 = core.readJson(roots, P4_REL, false);
  if (!p4) {
    if (head === p3.creatorCommit) return {decision: 'PHYSICAL_V4_PROMOTION_READY', optimizer, confirmation, headroom,
      promotionIntentSha256: core.readDual(roots, PROMOTION_INTENT_REL).sha256, selectedValues: selection.selected.values,
      allowedCommitPaths: P4_ALLOWED_REL, budget: budget(roots), builds: 0};
    const built = buildP4(roots, intent);
    if (built.decision !== 'PHYSICAL_V4_P4_BUILD_PASS') return {decision: built.decision, p4: built, budget: budget(roots)};
  }
  const build = core.readJson(roots, P4_BUILD_REL);
  if (build.decision !== 'PHYSICAL_V4_P4_BUILD_PASS') return {decision: build.decision, p4: build, budget: budget(roots)};
  let equivalence = core.readJson(roots, P4_EQUIVALENCE_REL, false);
  if (!equivalence) equivalence = runReleaseEquivalence(roots, build);
  if (equivalence.decision !== 'P4_RELEASE_EQUIVALENCE_PASS') return {decision: equivalence.decision, equivalence, budget: budget(roots)};
  let stage3Result = core.readJson(roots, STAGE3_RESULT_REL, false);
  if (!stage3Result) stage3Result = runStage3(roots, build);
  if (stage3Result.decision !== 'STAGE3_READY_FOR_STAGE4') return {decision: stage3Result.decision, stage3: stage3Result, equivalence, budget: budget(roots)};
  let stage4Result = core.readJson(roots, STAGE4_RESULT_REL, false);
  if (!stage4Result) stage4Result = runStage4(roots, build, stage3Result);
  if (stage4Result.decision !== 'STAGE4_FULL_RANGE_COMPLETE') return {decision: stage4Result.decision, stage4: stage4Result, stage3: stage3Result, equivalence, budget: budget(roots)};
  const checks = core.readJson(roots, 'final/web-player-checks.json', false) || finalChecks(roots);
  const failed = checks.filter(item => item.result !== 'PASS');
  const result = {decision: failed.length ? 'BLOCKED_FINAL_WEB_PLAYER_CHECKS' : 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW',
    p3RuntimeRecordSha256: core.readDual(roots, P3_REL).sha256, p4RuntimeRecordSha256: core.readDual(roots, P4_REL).sha256,
    selectedValues: selection.selected.values, p3OptimizerSha256: core.readDual(roots, P3_RESULT_REL).sha256,
    p4BuildSha256: core.readDual(roots, P4_BUILD_REL).sha256, releaseEquivalenceSha256: core.readDual(roots, P4_EQUIVALENCE_REL).sha256,
    stage3: {decision: stage3Result.decision, sha256: core.readDual(roots, STAGE3_RESULT_REL).sha256, calls: 486},
    stage4: {decision: stage4Result.decision, sha256: core.readDual(roots, STAGE4_RESULT_REL).sha256, calls: 1423},
    webPlayerChecks: checks, manualListening: 'NOT RUN', budget: budget(roots), createdAt: new Date().toISOString()};
  core.writeJson(roots, 'final/acceptance-result.json', result, true);
  return result;
}
function budget(roots) {
  const calls = core.charged(roots);
  return {historical: core.HISTORICAL_CALLS, newAcousticCalls: calls, cumulative: core.HISTORICAL_CALLS + calls,
    cap: core.MAX_CALLS, remaining: core.MAX_CALLS - core.HISTORICAL_CALLS - calls, byAllocation: core.STAGES};
}
function collectCallState(roots) {
  const files = core.snapshotTree(roots.primary), starts = files.filter(row => row.path.startsWith('calls/') && row.path.endsWith('/start.json'));
  let complete = 0, ambiguous = 0, incomplete = 0;
  for (const start of starts) {
    const base = start.path.slice(0, -'/start.json'.length), result = core.readDual(roots, `${base}/result.json`), audio = core.readDual(roots, `${base}/audio.wav`), marker = core.readJson(roots, `${base}/start.json`);
    if (result && (!marker.meta?.audioArtifactRequired || audio)) complete++;
    else if (core.readDual(roots, `${base}/ambiguous.json`)) ambiguous++;
    else incomplete++;
  }
  return {started: starts.length, complete, ambiguous, incomplete};
}
function readOnlyReport(kind, {home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), before = core.snapshots(roots);
  let decision = 'PHYSICAL_V4_AWAITING_P3_PREPARATION', p3 = null, phases = {}, store = null, p1;
  try {
    store = core.assertDualInventories(roots);
    p1 = safeP1Snapshot(home);
    p3 = core.readJson(roots, P3_REL, false);
    if (p3) {
      for (const [relative, sha] of Object.entries(p3.optimizer.sourceHashes)) if (repoFileSha(relative) !== sha) throw new Error(`BLOCKED_PHYSICAL_V4_SOURCE_DRIFT: ${relative}`);
      const calls = collectCallState(roots), chargedCalls = core.charged(roots);
      if (chargedCalls !== calls.started) throw new Error('BLOCKED_PHYSICAL_V4_ACCOUNTING_MISMATCH');
      if (calls.ambiguous || calls.incomplete) decision = 'BLOCKED_PHYSICAL_V4_AMBIGUOUS_OR_INCOMPLETE_CALLS';
      else if (calls.complete > core.STAGES.candidate + core.STAGES.holdout + core.STAGES.headroom + core.STAGES.releaseEquivalence + core.STAGES.stage3 + core.STAGES.stage4) decision = 'BLOCKED_PHYSICAL_V4_BUDGET';
      else decision = core.readJson(roots, P3_RESULT_REL, false)?.decision || 'PHYSICAL_V4_READY_FOR_RUN_ALL';
      phases = {optimizer: core.readJson(roots, P3_RESULT_REL, false)?.decision || 'NOT RUN', confirmation: core.readJson(roots, P3_HOLDOUT_REL, false)?.decision || 'NOT RUN',
        headroom: core.readJson(roots, P3_HEADROOM_REL, false)?.decision || 'NOT RUN', releaseEquivalence: core.readJson(roots, P4_EQUIVALENCE_REL, false)?.decision || 'NOT RUN',
        stage3: core.readJson(roots, STAGE3_RESULT_REL, false)?.decision || 'NOT RUN', stage4: core.readJson(roots, STAGE4_RESULT_REL, false)?.decision || 'NOT RUN'};
      if (kind === 'dry-run') decision = 'PHYSICAL_V4_DRY_RUN';
    } else if (kind === 'dry-run') decision = 'PHYSICAL_V4_DRY_RUN';
  } catch (error) { decision = error.message.split(':')[0]; phases = {...phases, error: error.message}; }
  const after = core.snapshots(roots);
  core.assertSnapshotsSame(before, after);
  const currentBudget = budget(roots), next = !p3 ? 'run --prepare-p3 after source commit/push/readback' :
    !phases.optimizer || phases.optimizer === 'NOT RUN' ? 'run --run-all for P3 optimizer' :
    phases.optimizer === 'BLOCKED_PHYSICAL_FIT_V4_NO_ACCEPTABLE_CANDIDATE' ? 'terminal v4 optimizer failure; no more candidate calls authorized' :
    phases.optimizer === 'PHYSICAL_V4_OPTIMIZER_PASS' && phases.confirmation === 'NOT RUN' ? 'run --run-all for 25 confirmation cells and 4 headroom clips' :
    phases.headroom === 'PHYSICAL_V4_HEADROOM_PASS' && !core.readJson(roots, P4_BUILD_REL, false) ? 'promote exactly the two P4 files in one commit, push/readback, then resume --run-all' :
    'resume --run-all from the first incomplete authorized gate';
  return {decision, kind, epoch: core.EPOCH, lineage: core.LINEAGE, contract: CONTRACT,
    p1Decision: p1?.verification?.decision || null, v3TerminalResultSha256: p1?.terminal?.sha256 || null,
    p3RecordSha256: p3 ? core.readDual(roots, P3_REL).sha256 : null, phases, calls: p3 ? collectCallState(roots) : null,
    budget: currentBudget, next, store, builds: 0, renders: 0, writes: 0, acousticRenders: 0};
}
function status(options = {}) { return readOnlyReport('status', options); }
function verify(options = {}) { return readOnlyReport('verify', options); }
function dryRun(options = {}) { return readOnlyReport('dry-run', options); }
async function runAll({home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), lock = core.acquireLock(roots, `run-all-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    if (!core.readJson(roots, P3_REL, false)) throw new Error('BLOCKED_PHYSICAL_V4_P3_RECORD_REQUIRED: run --prepare-p3 first');
    return await continueRun(roots, home);
  } catch (error) {
    return {decision: error.message.split(':')[0], reason: error.message, budget: budget(roots), builds: 0,
      acousticRenders: core.charged(roots), issue: 7, epoch: core.EPOCH};
  } finally { core.releaseLock(roots, lock); }
}
function parseMode(argv) {
  if (argv.length !== 1) throw new Error('select exactly one mode: --status, --verify, --dry-run, --prepare-p3, or --run-all');
  const modes = {'--status': 'status', '--verify': 'verify', '--dry-run': 'dry-run', '--prepare-p3': 'prepare-p3', '--run-all': 'run-all'};
  if (!modes[argv[0]]) throw new Error(`unsupported mode: ${argv[0]}`);
  return modes[argv[0]];
}
function run({mode, home = os.homedir()} = {}) {
  if (mode === 'status') return status({home});
  if (mode === 'verify') return verify({home});
  if (mode === 'dry-run') return dryRun({home});
  if (mode === 'prepare-p3') return prepareP3({home});
  if (mode === 'run-all') return runAll({home});
  throw new Error('explicit v4 mode required');
}
async function main(argv = process.argv.slice(2)) {
  const result = await run({mode: parseMode(argv)});
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (/^BLOCKED_/.test(result.decision || '')) process.exitCode = 2;
  return result;
}
if (require.main === module) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = /^BLOCKED_/.test(error.message) ? 2 : 1; });
}

module.exports = {ROOT, PR_URL, CONTRACT, P3_REL, P3_RESULT_REL, P3_SELECTION_REL, P3_HOLDOUT_REL, P3_HEADROOM_REL,
  PROMOTION_INTENT_REL, P4_REL, P4_BUILD_REL, P4_EQUIVALENCE_REL, STAGE3_RESULT_REL, STAGE4_RESULT_REL,
  V3_SOURCE_REL, V4_SOURCE_REL, P4_ALLOWED_REL, fileSha, git, runCommand, requirePass, verifyRemoteHead,
  writeFloatWav, renderDiagnostic, renderProductionCell, safeP1Snapshot, extractReferenceSet, sourceHashes,
  prepareP3, oldRowsByStage, officialRows, normalizedViolation, evaluateMeasured, scoreObservation, reuseLineageSha256, loadHistoricalObservations,
  runOptimizer, runConfirmation, runHeadroom, p3PromotionIntent, presetValues, headerValues, buildP4, runPostPromotionChecks,
  runReleaseEquivalence, runStage3, runStage4, finalChecks, continueRun, budget, collectCallState, status, verify, dryRun,
  runAll, parseMode, run, main};
