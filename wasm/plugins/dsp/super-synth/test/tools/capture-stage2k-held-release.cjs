#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const REQUIRED_EXPORTS = ['soraoto_supersynth_active_voice_count'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--check-exports' || flag === '--self-test') {
      args[flag.slice(2)] = true;
      continue;
    }
    if (!['--repo-root', '--candidate-build', '--candidate', '--output', '--wasm', '--expected-wasm-sha256'].includes(flag) || !argv[i + 1]) {
      throw new Error('Usage: capture-stage2k-held-release.cjs --repo-root <root> --candidate-build <dir> --candidate <candidate.json> --output <result.json> --expected-wasm-sha256 <sha256> | --check-exports --wasm <plugin.wasm> | --self-test');
    }
    args[flag.slice(2)] = argv[++i];
  }
  if (args['check-exports']) {
    if (!args.wasm) throw new Error('--wasm is required with --check-exports');
  } else if (!args['self-test']) {
    for (const key of ['repo-root', 'candidate-build', 'candidate', 'output', 'expected-wasm-sha256']) {
      if (!args[key]) throw new Error(`--${key} is required`);
    }
  }
  for (const key of ['repo-root', 'candidate-build', 'candidate', 'output', 'wasm']) {
    if (args[key]) args[key] = path.resolve(args[key]);
  }
  return args;
}

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function rmsWindow(samples, startFrame, endFrame) {
  const start = Math.max(0, Math.floor(startFrame));
  const end = Math.min(samples.length, Math.floor(endFrame));
  let squares = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    squares += samples[i] * samples[i];
    count++;
  }
  return Math.sqrt(squares / Math.max(1, count));
}

function allStereoFinite(render) {
  return render.left.every(Number.isFinite) && render.right.every(Number.isFinite);
}

function metricsFromRenders(held, release) {
  const heldDecayRatio = rmsWindow(held.left, 0.25 * SAMPLE_RATE, 0.60 * SAMPLE_RATE)
    / Math.max(1e-12, rmsWindow(held.left, 0.08 * SAMPLE_RATE, 0.25 * SAMPLE_RATE));
  const releaseTail1 = rmsWindow(release.left, 1.10 * SAMPLE_RATE, 1.35 * SAMPLE_RATE);
  const releaseTail2 = rmsWindow(release.left, 1.80 * SAMPLE_RATE, 2.10 * SAMPLE_RATE);
  const releaseTail3 = rmsWindow(release.left, 2.80 * SAMPLE_RATE, 3.20 * SAMPLE_RATE);
  const peak = Math.max(held.peak, release.peak);
  return {
    finite: allStereoFinite(held) && allStereoFinite(release),
    finiteRelease: allStereoFinite(release),
    stuckVoiceCount: release.activeVoiceCountAtEnd,
    outputGuardHits: held.outputGuardHits + release.outputGuardHits,
    heldDecayRatio,
    releaseTail1,
    releaseTail2,
    releaseTail3,
    releaseTail3To2Ratio: releaseTail3 / Math.max(1e-12, releaseTail2),
    peakDbfs: 20 * Math.log10(Math.max(1e-12, peak)),
    releaseActiveVoiceCountExport: release.activeVoiceCountAtEnd,
  };
}

function checkWasmExports(wasmPath) {
  const bytes = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(bytes);
  const exports = new Set(WebAssembly.Module.exports(module).map(row => row.name));
  const missing = REQUIRED_EXPORTS.filter(name => !exports.has(name));
  if (missing.length) throw new Error(`required held/release exports missing: ${missing.join(', ')}`);
  return { status: 'PASS', requiredExports: REQUIRED_EXPORTS, wasmSha256: sha(bytes) };
}

function render(repoRoot, buildRoot, { velocity, durationSeconds, noteOffSeconds }) {
  const helperPath = path.join(repoRoot, 'wasm/test/helpers/plugin-harness.cjs');
  const { PluginHarness } = require(helperPath);
  const harness = new PluginHarness(repoRoot, 'plugins/dsp/super-synth/plugin.wasm', {
    sampleRate: SAMPLE_RATE,
    maxFrames: BLOCK,
  });
  const totalFrames = Math.floor(durationSeconds * SAMPLE_RATE);
  const left = new Float64Array(totalFrames);
  const right = new Float64Array(totalFrames);
  const before = typeof harness.e.soraoto_supersynth_guard_hit_count === 'function'
    ? harness.e.soraoto_supersynth_guard_hit_count() : 0;
  let pos = 0;
  let noteOffSent = false;
  let peak = 0;
  let finite = true;
  try {
    if (typeof harness.e.soraoto_supersynth_active_voice_count !== 'function') {
      throw new Error('soraoto_supersynth_active_voice_count export is unavailable');
    }
    harness.applyPreset('concert_grand');
    harness.setPlain('voice_drift', 0);
    harness.setPlain('lfo1_pitch', 0);
    while (pos < totalFrames) {
      const count = Math.min(BLOCK, totalFrames - pos);
      const events = [];
      if (pos === 0) events.push({ kind: 1, noteId: 1, pitch: 60, velocity, offset: 0 });
      if (!noteOffSent && noteOffSeconds !== null && pos <= noteOffSeconds * SAMPLE_RATE
          && pos + count > noteOffSeconds * SAMPLE_RATE) {
        events.push({ kind: 2, noteId: 1, pitch: 60, velocity: 0, offset: Math.floor(noteOffSeconds * SAMPLE_RATE - pos) });
        noteOffSent = true;
      }
      const output = harness.process(count, { events })[0];
      left.set(output[0], pos);
      right.set(output[1], pos);
      for (let i = 0; i < count; i++) {
        const l = output[0][i];
        const r = output[1][i];
        if (!Number.isFinite(l) || !Number.isFinite(r)) finite = false;
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
      }
      pos += count;
    }
    if (noteOffSeconds !== null && !noteOffSent) throw new Error('release note-off event was not sent');
    const guardAfter = typeof harness.e.soraoto_supersynth_guard_hit_count === 'function'
      ? harness.e.soraoto_supersynth_guard_hit_count() : before;
    const activeVoiceCountAtEnd = harness.e.soraoto_supersynth_active_voice_count();
    return {
      left, right, peak, outputGuardHits: guardAfter - before,
      activeVoiceCountAtEnd, finite,
      definition: { sampleRate: SAMPLE_RATE, blockFrames: BLOCK, durationSeconds, velocity, noteOffSeconds },
    };
  } finally {
    harness.close();
  }
}

function capture(args) {
  const candidateBuild = args['candidate-build'];
  const wasmPath = path.join(candidateBuild, 'build/plugins/dsp/super-synth/plugin.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const wasmSha256 = sha(wasmBytes);
  if (wasmSha256 !== args['expected-wasm-sha256']) throw new Error(`candidate WASM SHA mismatch: expected ${args['expected-wasm-sha256']}, got ${wasmSha256}`);
  const exportCheck = checkWasmExports(wasmPath);
  const candidate = JSON.parse(fs.readFileSync(args.candidate, 'utf8'));
  const repoRoot = path.join(candidateBuild, 'source');
  if (!fs.existsSync(path.join(repoRoot, 'wasm/test/helpers/plugin-harness.cjs'))) throw new Error('candidate source snapshot is missing the WASM harness');
  const priorBuild = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = path.join(candidateBuild, 'build');
  const started = performance.now();
  try {
    const held = render(repoRoot, path.join(candidateBuild, 'build'), { velocity: 0.82, durationSeconds: 1.6, noteOffSeconds: null });
    const release = render(repoRoot, path.join(candidateBuild, 'build'), { velocity: 0.72, durationSeconds: 3.4, noteOffSeconds: 1.0 });
    const metrics = metricsFromRenders(held, release);
    return {
      schemaVersion: 1,
      candidateId: candidate.candidateId,
      acousticArtifactIdentity: { candidateId: candidate.candidateId, wasmSha256 },
      measurementToolIdentity: { metricDefinition: 'stage2k-held-release-v1', extractorSha256: sha(fs.readFileSync(__filename)) },
      productionSimd: true,
      heldDefinition: held.definition,
      releaseDefinition: release.definition,
      metrics,
      elapsedSeconds: (performance.now() - started) / 1000,
      renderCount: 2,
      diagnosticOnly: true,
    };
  } finally {
    if (priorBuild === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR = priorBuild;
  }
}

function selfTest() {
  const held = { left: new Float64Array(1.6 * SAMPLE_RATE), right: new Float64Array(1.6 * SAMPLE_RATE), peak: 1, outputGuardHits: 0, activeVoiceCountAtEnd: 1, finite: true };
  held.left.fill(0.5, Math.floor(0.08 * SAMPLE_RATE), Math.floor(0.25 * SAMPLE_RATE));
  held.left.fill(0.25, Math.floor(0.25 * SAMPLE_RATE), Math.floor(0.60 * SAMPLE_RATE));
  const release = { left: new Float64Array(3.4 * SAMPLE_RATE), right: new Float64Array(3.4 * SAMPLE_RATE), peak: 0.2, outputGuardHits: 0, activeVoiceCountAtEnd: 3, finite: true };
  release.left.fill(0.4, Math.floor(1.10 * SAMPLE_RATE), Math.floor(1.35 * SAMPLE_RATE));
  release.left.fill(0.2, Math.floor(1.80 * SAMPLE_RATE), Math.floor(2.10 * SAMPLE_RATE));
  release.left.fill(0.1, Math.floor(2.80 * SAMPLE_RATE), Math.floor(3.20 * SAMPLE_RATE));
  const result = metricsFromRenders(held, release);
  if (Math.abs(result.heldDecayRatio - 0.5) > 1e-12) throw new Error('held RMS window math failed');
  if (Math.abs(result.releaseTail1 - 0.4) > 1e-12 || Math.abs(result.releaseTail2 - 0.2) > 1e-12
      || Math.abs(result.releaseTail3 - 0.1) > 1e-12 || Math.abs(result.releaseTail3To2Ratio - 0.5) > 1e-12) {
    throw new Error('release RMS window math failed');
  }
  if (result.stuckVoiceCount !== 3) throw new Error('active voice count was not preserved');
  release.left[100] = Number.NaN;
  if (metricsFromRenders(held, release).finiteRelease !== false) throw new Error('non-finite release was not rejected');
  console.log(JSON.stringify({ status: 'PASS', assertions: 4 }));
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['self-test']) return selfTest();
  if (args['check-exports']) return console.log(JSON.stringify(checkWasmExports(args.wasm)));
  const result = capture(args);
  write(args.output, result);
  console.log(JSON.stringify({ status: 'PASS', candidateId: result.candidateId, wasmSha256: result.acousticArtifactIdentity.wasmSha256, renders: result.renderCount }));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`Stage2K held/release ERROR: ${error.stack || error.message}`); process.exitCode = 1; }
}

module.exports = { SAMPLE_RATE, BLOCK, REQUIRED_EXPORTS, rmsWindow, metricsFromRenders, checkWasmExports, render, capture, selfTest };
