#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const REPO = path.resolve(__dirname, '../../../../../../');
const PRIVATE_ROOT = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2p');
const BASELINE_PATH = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2o/baseline.json');
const CANDIDATE_ROOT = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2n-revision3/scratch/stage2n-r3-candidate-01');
const BUILD_ROOT = path.join(CANDIDATE_ROOT, 'build');
const CANDIDATE_PATH = path.join(CANDIDATE_ROOT, 'candidate.json');
const WASM_PATH = path.join(BUILD_ROOT, 'plugins/dsp/super-synth/plugin.wasm');
const CANDIDATE_PRESETS_PATH = path.join(CANDIDATE_ROOT, 'source/wasm/plugins/dsp/super-synth/presets.json');
const CAPTURE_TOOL = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
const ESTIMATOR = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs');
const METRICS = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs');
const SELF = path.join(__dirname, 'capture-stage2p-low-pitch.cjs');
const RESULT_PATH = path.join(PRIVATE_ROOT, 'low-register-matrix.json');
const START_HEAD = '67f9ab93a69ff677c4f18f1a5e867a6c5ae63594';
const EXPECTED_WASM_SHA256 = '9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2';
const EXPECTED_CONFIG_SHA256 = '792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d';
const PITCHES = [21, 24, 27, 30, 33, 36, 39, 42];
const VELOCITIES = [14, 61, 124];
const CELLS = PITCHES.flatMap(pitch => VELOCITIES.map(velocity => ({pitch, velocity})));
const PROTECTED_SHARED_FILES = [
  'wasm/shared/plugin_abi_runtime.h',
  'docs/specs/soraotoDSL/spec/03-plugin-model.md',
  'docs/specs/soraotoDSL/spec/04-realtime-abi.md',
  'docs/specs/soraotoDSL/spec/05-plugin-services.md',
  'docs/specs/soraotoDSL/spec/06-project-audio.md',
  'docs/specs/soraotoDSL/spec/09-conformance.md',
  'web-player/src/js/plugin-cbor.js'
];
const HASHED_EVALUATOR_FILES = [CAPTURE_TOOL, ESTIMATOR, METRICS, SELF];

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function gitHead() { return execFileSync('rtk', ['git', 'rev-parse', 'HEAD'], {cwd: REPO, encoding: 'utf8'}).trim(); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function parseMode(argv) {
  if (argv.length > 1 || (argv.length === 1 && !['--dry-run', '--execute'].includes(argv[0]))) {
    throw new Error('Usage: capture-stage2p-low-pitch.cjs [--dry-run|--execute]');
  }
  return argv[0] === '--execute' ? 'execute' : 'dry-run';
}

function preflight() {
  const baseline = readJson(BASELINE_PATH);
  const candidate = readJson(CANDIDATE_PATH);
  const currentHead = gitHead();
  const wasmSha256 = sha256File(WASM_PATH);
  const configSha256 = sha256File(CANDIDATE_PRESETS_PATH);
  if (currentHead !== START_HEAD) throw new Error(`BLOCKED_STAGE2P_BASELINE: expected ${START_HEAD}, got ${currentHead}`);
  if (baseline.stage2nCandidateId !== 'stage2n-r3-candidate-01' || candidate.candidateId !== baseline.stage2nCandidateId) {
    throw new Error('BLOCKED_STAGE2P_CANDIDATE_IDENTITY');
  }
  if (canonical(candidate.parameters) !== canonical(baseline.candidateVector)) throw new Error('BLOCKED_STAGE2P_CANDIDATE_VECTOR');
  if (candidate.configSha256 !== EXPECTED_CONFIG_SHA256 || baseline.configSha256 !== EXPECTED_CONFIG_SHA256
      || configSha256 !== EXPECTED_CONFIG_SHA256) throw new Error(`BLOCKED_STAGE2P_CANDIDATE_CONFIG: ${configSha256}`);
  if (baseline.candidateWasmSha256 !== EXPECTED_WASM_SHA256 || wasmSha256 !== EXPECTED_WASM_SHA256) {
    throw new Error(`BLOCKED_STAGE2P_CANDIDATE_ARTIFACT: ${wasmSha256}`);
  }
  const result = readJson(path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2n-revision3/results/stage2n-revision3-result.json'));
  if (result.candidateId !== candidate.candidateId || result.wasmSha256 !== wasmSha256 || result.productionSimd !== true) {
    throw new Error('BLOCKED_STAGE2P_PRODUCTION_SIMD_PROVENANCE');
  }
  const evaluatorHashes = Object.fromEntries(HASHED_EVALUATOR_FILES.map(file => [path.relative(REPO, file), sha256File(file)]));
  const protectedHashes = Object.fromEntries(PROTECTED_SHARED_FILES.map(file => [file, sha256File(path.join(REPO, file))]));
  if (canonical(protectedHashes) !== canonical(baseline.sharedProtectedSha256Current)) throw new Error('BLOCKED_STAGE2P_PROTECTED_SHARED_HASH');
  return {baseline, candidate, currentHead, wasmSha256, configSha256, evaluatorHashes, protectedHashes};
}

function verifyUnchanged(before) {
  if (gitHead() !== before.currentHead) throw new Error('BLOCKED_STAGE2P_SOURCE_CHANGED_DURING_RENDER');
  if (sha256File(WASM_PATH) !== before.wasmSha256 || sha256File(CANDIDATE_PRESETS_PATH) !== before.configSha256) {
    throw new Error('BLOCKED_STAGE2P_CANDIDATE_ARTIFACT_CHANGED_DURING_RENDER');
  }
  const evaluatorHashes = Object.fromEntries(HASHED_EVALUATOR_FILES.map(file => [path.relative(REPO, file), sha256File(file)]));
  const protectedHashes = Object.fromEntries(PROTECTED_SHARED_FILES.map(file => [file, sha256File(path.join(REPO, file))]));
  if (canonical(evaluatorHashes) !== canonical(before.evaluatorHashes)) throw new Error('BLOCKED_STAGE2P_EVALUATOR_CHANGED_DURING_RENDER');
  if (canonical(protectedHashes) !== canonical(before.protectedHashes)) throw new Error('BLOCKED_STAGE2P_PROTECTED_SHARED_CHANGED');
}

function run() {
  const mode = parseMode(process.argv.slice(2));
  const proof = preflight();
  const manifest = {
    schemaVersion: 1,
    stage: 'Stage2P multi-window low-register pitch matrix',
    mode,
    candidateId: proof.candidate.candidateId,
    sourceRevision: proof.currentHead,
    candidateSourceRevision: proof.candidate.sourceRevision,
    candidateVector: proof.candidate.parameters,
    configSha256: proof.configSha256,
    wasmSha256: proof.wasmSha256,
    productionSimd: true,
    evaluatorHashes: proof.evaluatorHashes,
    protectedSharedHashes: proof.protectedHashes,
    requestedCells: CELLS,
    buildCount: 0,
    physicalRenderCount: 0,
    candidateBudgetDelta: 0,
    resultPath: path.relative(REPO, RESULT_PATH),
    status: 'PREFLIGHT_PASS'
  };
  if (mode === 'dry-run') {
    writeJson(path.join(PRIVATE_ROOT, 'dry-run.json'), manifest);
    process.stdout.write(`${JSON.stringify({status: manifest.status, buildCount: 0, physicalRenderCount: 0,
      candidateId: manifest.candidateId, wasmSha256: manifest.wasmSha256, cellCount: CELLS.length})}\n`);
    return;
  }

  const parameters = {
    piano_hammer_hardness: proof.candidate.parameters.piano_hammer_hardness,
    piano_inharmonicity: proof.candidate.parameters.piano_inharmonicity,
    piano_string_damping: proof.candidate.parameters.piano_string_damping,
    piano_string_unison: proof.candidate.parameters.piano_string_unison
  };
  const previousBuildRoot = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = BUILD_ROOT;
  try {
    const {captureMatrix} = require(CAPTURE_TOOL);
    const capture = captureMatrix({cells: CELLS, parameters, includePitchHealth: true, includeNearFundamentalProbe: true,
      onProgress: (_pitch, count) => process.stderr.write(`Stage2P low-pitch matrix ${count}/${CELLS.length}\n`)});
    verifyUnchanged(proof);
    const actualCells = capture.matrix.map(({pitch, velocity}) => `${pitch}:${velocity}`);
    const expectedCells = CELLS.map(({pitch, velocity}) => `${pitch}:${velocity}`);
    if (capture.matrix.length !== 24 || canonical(actualCells) !== canonical(expectedCells)) throw new Error('BLOCKED_STAGE2P_REQUIRED_COVERAGE');
    manifest.status = 'CAPTURE_COMPLETE';
    manifest.buildCount = 0;
    manifest.physicalRenderCount = capture.matrix.length;
    manifest.capture = capture;
    verifyUnchanged(proof);
    writeJson(RESULT_PATH, manifest);
    process.stdout.write(`${JSON.stringify({status: manifest.status, candidateId: manifest.candidateId,
      cellCount: capture.matrix.length, candidateBudgetDelta: 0, wasmSha256: manifest.wasmSha256, output: manifest.resultPath})}\n`);
  } finally {
    if (previousBuildRoot === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR = previousBuildRoot;
  }
}

if (require.main === module) {
  try { run(); }
  catch (error) { process.stderr.write(`Stage2P low-pitch capture ERROR: ${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = {CELLS, canonical, preflight};
