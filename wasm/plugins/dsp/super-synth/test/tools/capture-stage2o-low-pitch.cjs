#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const REPO = path.resolve(__dirname, '../../../../../../');
const PRIVATE_ROOT = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2o');
const BASELINE_PATH = path.join(PRIVATE_ROOT, 'baseline.json');
const CANDIDATE_ROOT = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2n-revision3/scratch/stage2n-r3-candidate-01');
const BUILD_ROOT = path.join(CANDIDATE_ROOT, 'build');
const CANDIDATE_PATH = path.join(CANDIDATE_ROOT, 'candidate.json');
const WASM_PATH = path.join(BUILD_ROOT, 'plugins/dsp/super-synth/plugin.wasm');
const CANDIDATE_PRESETS_PATH = path.join(CANDIDATE_ROOT, 'source/wasm/plugins/dsp/super-synth/presets.json');
const PRESETS_PATH = path.join(REPO, 'wasm/plugins/dsp/super-synth/presets.json');
const CAPTURE_TOOL = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
const ESTIMATOR = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs');
const METRICS = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs');
const RESULT_PATH = path.join(PRIVATE_ROOT, 'low-register-matrix.json');
const PITCHES = [21, 24, 27, 30, 33, 36, 39, 42];
const VELOCITIES = [14, 61, 124];
const CELLS = PITCHES.flatMap(pitch => VELOCITIES.map(velocity => ({pitch, velocity})));
const EXPECTED_WASM_SHA256 = '9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2';
const EXPECTED_CONFIG_SHA256 = '792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d';
const STAGE2O_BASELINE_COMMIT = '9d8af93dd7f02fff3d16ea36a1cd0edadba9a6f4';
const HASHED_EVALUATOR_FILES = [CAPTURE_TOOL, ESTIMATOR, METRICS];

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function gitHead() {
  return execFileSync('rtk', ['git', 'rev-parse', 'HEAD'], {cwd: REPO, encoding: 'utf8'}).trim();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseMode(argv) {
  if (argv.length > 1 || (argv.length === 1 && !['--dry-run', '--execute'].includes(argv[0]))) {
    throw new Error('Usage: capture-stage2o-low-pitch.cjs [--dry-run|--execute]');
  }
  if (argv[0] === '--execute') return 'execute';
  return 'dry-run';
}

function preflight() {
  const baseline = readJson(BASELINE_PATH);
  const candidate = readJson(CANDIDATE_PATH);
  const currentHead = gitHead();
  const wasmSha256 = sha256File(WASM_PATH);
  const configSha256 = sha256File(CANDIDATE_PRESETS_PATH);
  const candidateExpected = {
    effective_strike_position_c4: 0.13664120183629616,
    'hammer.compression_scale': 0.00053383185753125,
    'hammer.velocity_hardness_amount': 0.5,
    piano_hammer_hardness: 0.3719079878026494,
    piano_inharmonicity: 0.06597007256584347,
    piano_string_damping: 0,
    piano_string_unison: 0.9855708493914253
  };
  if (baseline.stage2oBaselineCommit !== STAGE2O_BASELINE_COMMIT || currentHead !== STAGE2O_BASELINE_COMMIT) {
    throw new Error(`BLOCKED_STAGE2O_BASELINE_CHANGED: expected ${STAGE2O_BASELINE_COMMIT}, got ${currentHead}`);
  }
  if (baseline.stage2nCandidateId !== 'stage2n-r3-candidate-01' || candidate.candidateId !== baseline.stage2nCandidateId) {
    throw new Error('BLOCKED_STAGE2O_CANDIDATE_IDENTITY');
  }
  if (canonical(candidate.parameters) !== canonical(candidateExpected)
      || canonical(candidate.parameters) !== canonical(baseline.candidateVector)) {
    throw new Error('BLOCKED_STAGE2O_CANDIDATE_VECTOR');
  }
  if (candidate.configSha256 !== EXPECTED_CONFIG_SHA256 || baseline.configSha256 !== EXPECTED_CONFIG_SHA256
      || configSha256 !== EXPECTED_CONFIG_SHA256) {
    throw new Error(`BLOCKED_STAGE2O_CANDIDATE_CONFIG: ${configSha256}`);
  }
  if (baseline.candidateWasmSha256 !== EXPECTED_WASM_SHA256 || wasmSha256 !== EXPECTED_WASM_SHA256) {
    throw new Error(`BLOCKED_STAGE2O_CANDIDATE_ARTIFACT: ${wasmSha256}`);
  }
  const prior = readJson(path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2n-revision3/results/stage2n-revision3-result.json'));
  if (prior.candidateId !== candidate.candidateId || prior.wasmSha256 !== wasmSha256 || prior.productionSimd !== true) {
    throw new Error('BLOCKED_STAGE2O_PRODUCTION_SIMD_PROVENANCE');
  }
  const sourceHashes = Object.fromEntries(HASHED_EVALUATOR_FILES.map(file => [path.relative(REPO, file), sha256File(file)]));
  return {baseline, candidate, currentHead, wasmSha256, configSha256, sourceHashes};
}

function verifyUnchanged(before) {
  if (gitHead() !== before.currentHead) throw new Error('BLOCKED_STAGE2O_SOURCE_CHANGED_DURING_RENDER');
  if (sha256File(WASM_PATH) !== before.wasmSha256 || sha256File(CANDIDATE_PRESETS_PATH) !== before.configSha256) {
    throw new Error('BLOCKED_STAGE2O_CANDIDATE_ARTIFACT_CHANGED_DURING_RENDER');
  }
  const after = Object.fromEntries(HASHED_EVALUATOR_FILES.map(file => [path.relative(REPO, file), sha256File(file)]));
  if (canonical(after) !== canonical(before.sourceHashes)) throw new Error('BLOCKED_STAGE2O_EVALUATOR_CHANGED_DURING_RENDER');
}

function run() {
  const mode = parseMode(process.argv.slice(2));
  const proof = preflight();
  const manifest = {
    schemaVersion: 1,
    stage: 'Stage2O low-register pitch matrix',
    mode,
    candidateId: proof.candidate.candidateId,
    sourceRevision: proof.currentHead,
    configSha256: proof.configSha256,
    wasmSha256: proof.wasmSha256,
    evaluatorHashes: proof.sourceHashes,
    requestedCells: CELLS,
    buildCount: 0,
    physicalRenderCount: 0,
    candidateBudgetDelta: 0,
    resultPath: path.relative(REPO, RESULT_PATH),
    status: mode === 'dry-run' ? 'PREFLIGHT_PASS_NO_BUILD_NO_RENDER' : 'RUNNING'
  };
  if (mode === 'dry-run') {
    writeJson(path.join(PRIVATE_ROOT, 'low-register-matrix-preflight.json'), manifest);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  const baselineCandidate = proof.candidate.parameters;
  const parameters = {
    piano_hammer_hardness: baselineCandidate.piano_hammer_hardness,
    piano_inharmonicity: baselineCandidate.piano_inharmonicity,
    piano_string_damping: baselineCandidate.piano_string_damping,
    piano_string_unison: baselineCandidate.piano_string_unison
  };
  const originalBuildRoot = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = BUILD_ROOT;
  try {
    const {captureMatrix} = require(CAPTURE_TOOL);
    const capture = captureMatrix({
      cells: CELLS,
      parameters,
      includePitchHealth: true,
      includeNearFundamentalProbe: true,
      onProgress: (_pitch, count) => process.stderr.write(`Stage2O pitch matrix ${count}/${CELLS.length}\n`)
    });
    verifyUnchanged(proof);
    const actualCells = capture.matrix.map(({pitch, velocity}) => `${pitch}:${velocity}`);
    const expectedCells = CELLS.map(({pitch, velocity}) => `${pitch}:${velocity}`);
    if (capture.matrix.length !== 24 || canonical(actualCells) !== canonical(expectedCells)) {
      throw new Error('BLOCKED_STAGE2O_REQUIRED_COVERAGE');
    }
    manifest.status = 'CAPTURE_COMPLETE';
    manifest.physicalRenderCount = capture.matrix.length;
    manifest.capture = capture;
    verifyUnchanged(proof);
    writeJson(RESULT_PATH, manifest);
    process.stdout.write(`${JSON.stringify({status: manifest.status, candidateId: manifest.candidateId,
      cellCount: capture.matrix.length, wasmSha256: manifest.wasmSha256, output: manifest.resultPath})}\n`);
  } finally {
    if (originalBuildRoot === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR = originalBuildRoot;
  }
}

if (require.main === module) {
  try { run(); }
  catch (error) { process.stderr.write(`Stage2O low-pitch capture ERROR: ${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = {CELLS, canonical, preflight};
