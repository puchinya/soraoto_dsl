#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const REPO = path.resolve(__dirname, '../../../../../../');
const PRIVATE_ROOT = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2q');
const STAGEP_ROOT = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2p');
const BASELINE_PATH = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2o/baseline.json');
const CANDIDATE_ROOT = path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2n-revision3/scratch/stage2n-r3-candidate-01');
const BUILD_ROOT = path.join(CANDIDATE_ROOT, 'build');
const CANDIDATE_PATH = path.join(CANDIDATE_ROOT, 'candidate.json');
const WASM_PATH = path.join(BUILD_ROOT, 'plugins/dsp/super-synth/plugin.wasm');
const CANDIDATE_PRESETS_PATH = path.join(CANDIDATE_ROOT, 'source/wasm/plugins/dsp/super-synth/presets.json');
const CAPTURE_TOOL = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
const ESTIMATOR = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs');
const METRICS = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs');
const SELF = path.join(__dirname, 'capture-stage2q-low-pitch.cjs');
const RESULT_PATH = path.join(PRIVATE_ROOT, 'low-register-matrix.json');
const MANIFEST_PATH = path.join(PRIVATE_ROOT, 'manifest.json');
const DRY_RUN_PATH = path.join(PRIVATE_ROOT, 'dry-run.json');
const START_HEAD = 'fa54334c93ddbefc6e7a6202bc4c251ff85f0d16';
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
const PROTECTED_STAGEP_FILES = [
  '.agent-state/issues/7/calibration-optuna/stage2p/low-register-matrix.json',
  '.agent-state/issues/7/calibration-optuna/stage2p/summary.json',
  '.agent-state/issues/7/calibration-optuna/stage2p/stage2p-copyable-report.md',
  'docs/status/plugins/dsp/super-synth/stage2p-multi-window-pitch.md'
];
const PROTECTED_PRODUCTION_FILES = [
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/plugins/dsp/super-synth/presets.json',
  'wasm/plugins/dsp/super-synth/descriptor.json'
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
    throw new Error('Usage: capture-stage2q-low-pitch.cjs [--dry-run|--execute]');
  }
  return argv[0] === '--execute' ? 'execute' : 'dry-run';
}
function fileHashes(files) {
  return Object.fromEntries(files.map(file => [file, sha256File(path.join(REPO, file))]));
}
function identity(proof) {
  return {
    candidateId: proof.candidate.candidateId,
    sourceRevision: proof.currentHead,
    candidateSourceRevision: proof.candidate.sourceRevision,
    candidateVector: proof.candidate.parameters,
    candidateJsonSha256: proof.candidateJsonSha256,
    configSha256: proof.configSha256,
    wasmSha256: proof.wasmSha256,
    productionSimd: true,
    evaluatorHashes: proof.evaluatorHashes,
    protectedSharedHashes: proof.protectedHashes,
    protectedStage2pHashes: proof.stagepHashes,
    protectedProductionHashes: proof.productionHashes,
    requestedCells: CELLS,
    candidateBudgetDelta: 0
  };
}
function preflight() {
  const baseline = readJson(BASELINE_PATH);
  const candidate = readJson(CANDIDATE_PATH);
  const currentHead = gitHead();
  const wasmSha256 = sha256File(WASM_PATH);
  const configSha256 = sha256File(CANDIDATE_PRESETS_PATH);
  const candidateJsonSha256 = sha256File(CANDIDATE_PATH);
  if (currentHead !== START_HEAD) throw new Error(`BLOCKED_STAGE2Q_BASELINE: expected ${START_HEAD}, got ${currentHead}`);
  if (baseline.stage2nCandidateId !== 'stage2n-r3-candidate-01' || candidate.candidateId !== baseline.stage2nCandidateId) {
    throw new Error('BLOCKED_STAGE2Q_CANDIDATE_IDENTITY');
  }
  if (canonical(candidate.parameters) !== canonical(baseline.candidateVector)) throw new Error('BLOCKED_STAGE2Q_CANDIDATE_VECTOR');
  if (candidate.configSha256 !== EXPECTED_CONFIG_SHA256 || baseline.configSha256 !== EXPECTED_CONFIG_SHA256
      || configSha256 !== EXPECTED_CONFIG_SHA256) throw new Error(`BLOCKED_STAGE2Q_CANDIDATE_CONFIG: ${configSha256}`);
  if (baseline.candidateWasmSha256 !== EXPECTED_WASM_SHA256 || wasmSha256 !== EXPECTED_WASM_SHA256) {
    throw new Error(`BLOCKED_STAGE2Q_CANDIDATE_ARTIFACT: ${wasmSha256}`);
  }
  const result = readJson(path.join(REPO, '.agent-state/issues/7/calibration-optuna/stage2n-revision3/results/stage2n-revision3-result.json'));
  if (result.candidateId !== candidate.candidateId || result.wasmSha256 !== wasmSha256 || result.productionSimd !== true) {
    throw new Error('BLOCKED_STAGE2Q_PRODUCTION_SIMD_PROVENANCE');
  }
  const evaluatorHashes = Object.fromEntries(HASHED_EVALUATOR_FILES.map(file => [path.relative(REPO, file), sha256File(file)]));
  const protectedHashes = fileHashes(PROTECTED_SHARED_FILES);
  if (canonical(protectedHashes) !== canonical(baseline.sharedProtectedSha256Current)) throw new Error('BLOCKED_STAGE2Q_PROTECTED_SHARED_HASH');
  const stagepHashes = fileHashes(PROTECTED_STAGEP_FILES);
  const productionHashes = fileHashes(PROTECTED_PRODUCTION_FILES);
  return {baseline, candidate, currentHead, wasmSha256, configSha256, candidateJsonSha256,
    evaluatorHashes, protectedHashes, stagepHashes, productionHashes};
}
function verifyUnchanged(before) {
  if (gitHead() !== before.currentHead) throw new Error('BLOCKED_STAGE2Q_SOURCE_CHANGED_DURING_RENDER');
  if (sha256File(WASM_PATH) !== before.wasmSha256 || sha256File(CANDIDATE_PRESETS_PATH) !== before.configSha256) {
    throw new Error('BLOCKED_STAGE2Q_CANDIDATE_ARTIFACT_CHANGED_DURING_RENDER');
  }
  if (sha256File(CANDIDATE_PATH) !== before.candidateJsonSha256) throw new Error('BLOCKED_STAGE2Q_CANDIDATE_VECTOR_CHANGED_DURING_RENDER');
  const evaluatorHashes = Object.fromEntries(HASHED_EVALUATOR_FILES.map(file => [path.relative(REPO, file), sha256File(file)]));
  const protectedHashes = fileHashes(PROTECTED_SHARED_FILES);
  const stagepHashes = fileHashes(PROTECTED_STAGEP_FILES);
  const productionHashes = fileHashes(PROTECTED_PRODUCTION_FILES);
  if (canonical(evaluatorHashes) !== canonical(before.evaluatorHashes)) throw new Error('BLOCKED_STAGE2Q_EVALUATOR_CHANGED_DURING_RENDER');
  if (canonical(protectedHashes) !== canonical(before.protectedHashes)) throw new Error('BLOCKED_STAGE2Q_PROTECTED_SHARED_CHANGED');
  if (canonical(stagepHashes) !== canonical(before.stagepHashes)) throw new Error('BLOCKED_STAGE2Q_STAGE2P_EVIDENCE_CHANGED');
  if (canonical(productionHashes) !== canonical(before.productionHashes)) throw new Error('BLOCKED_STAGE2Q_PRODUCTION_SOURCE_CHANGED');
}
function reusableResult(expectedIdentity) {
  if (!fs.existsSync(MANIFEST_PATH) && !fs.existsSync(RESULT_PATH)) return null;
  if (!fs.existsSync(MANIFEST_PATH) || !fs.existsSync(RESULT_PATH)) throw new Error('BLOCKED_STAGE2Q_INCOMPLETE_PRIOR_EVIDENCE');
  const manifest = readJson(MANIFEST_PATH);
  const result = readJson(RESULT_PATH);
  if (manifest.status !== 'CAPTURE_COMPLETE' || result.status !== 'CAPTURE_COMPLETE'
      || canonical(manifest.identity) !== canonical(expectedIdentity)
      || canonical(result.identity) !== canonical(expectedIdentity)) {
    throw new Error('BLOCKED_STAGE2Q_PRIOR_EVIDENCE_PROVENANCE_MISMATCH');
  }
  return result;
}
function run() {
  const mode = parseMode(process.argv.slice(2));
  const proof = preflight();
  const currentIdentity = identity(proof);
  const manifest = {
    schemaVersion: 1,
    stage: 'Stage2Q note-level inharmonicity / fixed-B low-register matrix',
    mode,
    estimatorRevision: 4,
    identity: currentIdentity,
    buildCount: 0,
    physicalRenderCount: 0,
    resultPath: path.relative(REPO, RESULT_PATH),
    status: 'PREFLIGHT_PASS'
  };
  if (mode === 'dry-run') {
    writeJson(DRY_RUN_PATH, manifest);
    process.stdout.write(`${JSON.stringify({status: manifest.status, buildCount: 0, physicalRenderCount: 0,
      candidateId: proof.candidate.candidateId, wasmSha256: proof.wasmSha256, cellCount: CELLS.length,
      candidateBudgetDelta: 0})}\n`);
    return;
  }
  const reusable = reusableResult(currentIdentity);
  if (reusable) {
    process.stdout.write(`${JSON.stringify({status: 'REUSED_COMPLETE_EVIDENCE', candidateId: reusable.candidateId,
      cellCount: reusable.capture.matrix.length, candidateBudgetDelta: 0, result: path.relative(REPO, RESULT_PATH)})}\n`);
    return;
  }
  const started = {...manifest, status: 'EXECUTING', startedAt: new Date().toISOString()};
  writeJson(MANIFEST_PATH, started);
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
      onProgress: (_pitch, count) => process.stderr.write(`Stage2Q fixed-B matrix ${count}/${CELLS.length}\n`)});
    verifyUnchanged(proof);
    const actualCells = capture.matrix.map(({pitch, velocity}) => `${pitch}:${velocity}`);
    const expectedCells = CELLS.map(({pitch, velocity}) => `${pitch}:${velocity}`);
    if (capture.matrix.length !== 24 || canonical(actualCells) !== canonical(expectedCells)) {
      throw new Error('BLOCKED_STAGE2Q_REQUIRED_COVERAGE');
    }
    const complete = {...manifest, identity: currentIdentity, status: 'CAPTURE_COMPLETE',
      completedAt: new Date().toISOString(), physicalRenderCount: capture.matrix.length, candidateBudgetDelta: 0,
      candidateId: proof.candidate.candidateId, sourceRevision: proof.currentHead,
      candidateVector: proof.candidate.parameters, configSha256: proof.configSha256, wasmSha256: proof.wasmSha256,
      productionSimd: true, evaluatorHashes: proof.evaluatorHashes, protectedSharedHashes: proof.protectedHashes,
      protectedStage2pHashes: proof.stagepHashes, capture};
    complete.protectedProductionHashes = proof.productionHashes;
    verifyUnchanged(proof);
    writeJson(RESULT_PATH, complete);
    writeJson(MANIFEST_PATH, {...started, status: 'CAPTURE_COMPLETE', completedAt: complete.completedAt,
      physicalRenderCount: complete.physicalRenderCount, candidateBudgetDelta: 0});
    process.stdout.write(`${JSON.stringify({status: complete.status, candidateId: complete.candidateId,
      cellCount: capture.matrix.length, candidateBudgetDelta: 0, wasmSha256: complete.wasmSha256,
      output: path.relative(REPO, RESULT_PATH)})}\n`);
  } finally {
    if (previousBuildRoot === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR = previousBuildRoot;
  }
}

if (require.main === module) {
  try { run(); }
  catch (error) { process.stderr.write(`Stage2Q low-pitch capture ERROR: ${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = {CELLS, canonical, identity, preflight, reusableResult};
