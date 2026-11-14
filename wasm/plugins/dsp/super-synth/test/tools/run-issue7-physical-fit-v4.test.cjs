'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('./issue7-physical-fit-v4-core.cjs');
const loss = require('./physical-fit-v4-loss.cjs');
const runner = require('./run-issue7-physical-fit-v4.cjs');

function tempRoots(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-physical-fit-v4-test-'));
  const roots = {primary: path.join(directory, 'primary'), secondary: path.join(directory, 'secondary')};
  fs.mkdirSync(roots.primary); fs.mkdirSync(roots.secondary);
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return roots;
}
function lock(roots) { core.writeJson(roots, 'locks/master.json', {ownerId: 'test-owner'}, true); }
function syntheticAudio(pitch = 69, scale = 0.2) {
  const frames = new Float32Array(loss.SAMPLE_COUNT), right = new Float32Array(loss.SAMPLE_COUNT), frequency = 440 * 2 ** ((pitch - 69) / 12);
  for (let i = 0; i < frames.length; i++) {
    const envelope = Math.min(1, i / 240) * Math.exp(-i / 90000);
    frames[i] = scale * envelope * (Math.sin(2 * Math.PI * frequency * i / loss.SAMPLE_RATE) + 0.18 * Math.sin(2 * Math.PI * frequency * 2.01 * i / loss.SAMPLE_RATE));
    right[i] = frames[i] * 0.97;
  }
  return {sampleRate: loss.SAMPLE_RATE, left: frames, right};
}

test('v4 epoch, acoustic allocation, fixed stress matrix, and P4 paths are contract-bound', () => {
  assert.equal(core.EPOCH, 'current-build-v4/physical-fit-recovery-v1');
  assert.equal(core.MAX_CALLS, 5213);
  assert.equal(core.HISTORICAL_CALLS, 3167);
  assert.deepEqual(core.STAGES, {candidate: 84, holdout: 25, headroom: 4, releaseEquivalence: 24, stage3: 486, stage4: 1423});
  assert.equal(core.STRESS_CELLS.length, 7);
  assert.equal(core.HOLDOUT_CELLS.length, 25);
  assert.deepEqual(runner.P4_ALLOWED_REL, ['wasm/plugins/dsp/super-synth/presets.json', 'wasm/shared/generated/super-synth_grand_profiles.h']);
});

test('coordinate poll remains in the original box and reuses coincident measured vectors', () => {
  const center = core.PARAMETERS.map(parameter => parameter.baseline), observed = [{id: 'known', values: [...center]}];
  const vectors = core.neighborVectors(center, 0.05, observed);
  assert.equal(vectors.length, 6);
  assert.equal(vectors.filter(vector => vector.reuse).length, 0);
  assert.ok(Math.abs(vectors[0].values[0] - center[0] * 0.95) < 1e-12);
  assert.ok(Math.abs(vectors[1].values[0] - center[0] * 1.05) < 1e-12);
  assert.deepEqual(vectors[0].values.slice(1), center.slice(1));
  assert.deepEqual(vectors[1].values.slice(1), center.slice(1));
  const atLowerBound = [...center]; atLowerBound[0] *= 0.9;
  const clipped = core.neighborVectors(atLowerBound, 0.05, [{id: 'bound', values: atLowerBound}]);
  const negative = clipped.find(item => core.vectorsEqual(item.values, atLowerBound));
  assert.ok(negative?.reuse);
  for (const item of [...vectors, ...clipped]) assert.ok(item.values.every((value, index) => value >= core.PARAMETERS[index].baseline * 0.9 && value <= core.PARAMETERS[index].baseline * 1.1));
});

test('candidate ordering uses violation, v2 loss, distance, then deterministic ID with epsilon', () => {
  const base = {violation: 0, loss: 1, distance: 0.1, id: 'b'};
  assert.ok(core.strictImprovement({violation: 0, loss: 0.9, distance: 0.9, id: 'z'}, base));
  assert.ok(core.strictImprovement({violation: 0, loss: 1, distance: 0.05, id: 'z'}, base));
  assert.ok(core.strictImprovement({violation: 0, loss: 1, distance: 0.1, id: 'a'}, base));
  assert.equal(core.strictImprovement({violation: 0, loss: 1 + 5e-10, distance: 0.1, id: 'z'}, base), false);
  assert.ok(core.strictImprovement({violation: 0.1, loss: 100, distance: 1, id: 'a'}, {violation: 0.2, loss: 0, distance: 0, id: 'b'}));
});

test('coincident observations are reused with a deterministic source lineage SHA', () => {
  const rows = [{pitch: 96, velocity: 124, metadataSha256: 'a'.repeat(64), wavSha256: 'b'.repeat(64)}];
  const score = {id: 'measured-v4', sourceSha256: null, rows};
  assert.equal(runner.reuseLineageSha256(score), core.sha256(core.jsonBytes(rows)));
  assert.equal(runner.reuseLineageSha256({...score, sourceSha256: 'c'.repeat(64)}), 'c'.repeat(64));
  assert.throws(() => runner.reuseLineageSha256({...score, rows: []}), /BLOCKED_PHYSICAL_V4_REUSE_LINEAGE/);
});

test('dual-store immutable rows detect divergent copies and preserve identical hashes', t => {
  const roots = tempRoots(t), stored = core.writeJson(roots, 'p3/row.json', {pitch: 96, velocity: 124}, true);
  assert.equal(core.readDual(roots, 'p3/row.json').sha256, stored.sha256);
  fs.writeFileSync(path.join(roots.secondary, 'p3/row.json'), '{"different":true}\n');
  assert.throws(() => core.readDual(roots, 'p3/row.json'), /BLOCKED_PHYSICAL_V4_DIVERGENT_DUAL_COPY/);
});

test('every audio call is charged before rendering; ambiguous starts cannot be retried', t => {
  const roots = tempRoots(t); lock(roots);
  const start = core.startCall(roots, 'vector-01-96-124', {audioArtifactRequired: true, values: [1.05, 0.5, 0.018]});
  assert.equal(start.accounting.charged, 1);
  assert.equal(core.readJson(roots, 'accounting.json').charged, 1);
  core.markAmbiguous(roots, 'vector-01-96-124', 'synthetic timeout');
  assert.throws(() => core.startCall(roots, 'vector-01-96-124', {audioArtifactRequired: true}), /BLOCKED_PHYSICAL_V4_AMBIGUOUS_CALL/);
});

test('v4 budget rejects a charge beyond the approved 5,213 cumulative cap', t => {
  const roots = tempRoots(t); lock(roots);
  core.writeJson(roots, 'accounting.json', {schemaVersion: 1, charged: core.MAX_CALLS - core.HISTORICAL_CALLS});
  assert.throws(() => core.startCall(roots, 'over-cap', {audioArtifactRequired: true}), /BLOCKED_PHYSICAL_V4_BUDGET/);
});

test('float32 WAV decoder validates the fixed 48 kHz stereo half-second capture', () => {
  const source = syntheticAudio(), wav = runner.writeFloatWav(source.left, source.right);
  const decoded = loss.decodeFloat32StereoWav(wav);
  assert.equal(decoded.sampleRate, 48000);
  assert.equal(decoded.left.length, 24000);
  assert.ok(Math.abs(decoded.left[1000] - source.left[1000]) < 1e-7);
  assert.throws(() => loss.decodeFloat32StereoWav(Buffer.from('not a wav')), /BLOCKED_PHYSICAL_V4_WAV_HEADER/);
});

test('physical-feature-loss-v2 yields zero for an identical measured/reference pair', () => {
  const audio = syntheticAudio(84), row = loss.cellLoss(audio, audio, 84, 0);
  assert.equal(row.lossVersion, 'physical-feature-loss-v2');
  assert.ok(row.total < 1e-15);
  assert.equal(row.featureCounts.rms, 5);
  for (const size of loss.FFT_SIZES) assert.ok(row.featureCounts.spectral[size] > 0);
});

test('physical-feature-loss-v2 uses frozen gain and reports weighted f0, RMS, and three-resolution spectral terms', () => {
  const reference = syntheticAudio(84), model = syntheticAudio(84, 0.15), pairs = Array.from({length: 7}, () => ({pitch: 84, reference, model}));
  const score = loss.candidateLoss(pairs, -1.25);
  assert.equal(score.lossVersion, 'physical-feature-loss-v2');
  assert.ok(score.total > 0);
  assert.ok(Math.abs(score.weightedContributions.f0 - 0.15 * score.contributions.f0) < 1e-12);
  assert.ok(Math.abs(score.weightedContributions.rms - 0.4 * score.contributions.rms) < 1e-12);
  assert.ok(Math.abs(score.weightedContributions.spectral - 0.45 * (score.spectralBySize[1024] + score.spectralBySize[2048] + score.spectralBySize[4096]) / 3) < 1e-12);
  assert.equal(score.featureCounts.cells, 7);
  assert.equal(score.featureCounts.rms, 35);
  assert.ok(score.featureCounts.spectral[4096] > 0);
});

test('silent reference frames and nonfinite measured data fail closed instead of returning low loss', () => {
  const silent = {sampleRate: 48000, left: new Float32Array(24000), right: new Float32Array(24000)};
  assert.throws(() => loss.cellLoss(silent, silent, 69, 0), /BLOCKED_PHYSICAL_V4|BLOCKED_PHYSICAL/);
  const bad = syntheticAudio(); bad.left[400] = Number.NaN;
  assert.throws(() => loss.cellLoss(bad, syntheticAudio(), 69, 0), /BLOCKED_PHYSICAL_V4_NONFINITE_AUDIO/);
});

test('read-only mode parser rejects multiple modes and exposes only the approved transitions', () => {
  assert.equal(runner.parseMode(['--status']), 'status');
  assert.equal(runner.parseMode(['--verify']), 'verify');
  assert.equal(runner.parseMode(['--dry-run']), 'dry-run');
  assert.equal(runner.parseMode(['--prepare-p3']), 'prepare-p3');
  assert.equal(runner.parseMode(['--run-all']), 'run-all');
  assert.throws(() => runner.parseMode(['--status', '--run-all']), /select exactly one mode/);
  assert.throws(() => runner.parseMode(['--force']), /unsupported mode/);
});
