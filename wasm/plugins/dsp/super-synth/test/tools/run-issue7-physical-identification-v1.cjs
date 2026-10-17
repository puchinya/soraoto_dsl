'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const core = require('./issue7-physical-identification-v1-core.cjs');
const analysis = require('./analyze-issue7-physical-identification.cjs');
const {PluginHarness, ext} = require('../../../../../test/helpers/plugin-harness.cjs');
const directMetrics = require('./stage3-direct-reference-metrics.cjs');
const stage3 = require('./run-issue7-stage3-current-build.cjs');
const stage4 = require('./run-issue7-stage4-current-build.cjs');

const ROOT = core.ROOT;
const BASE_HEAD = '4af394d56c986f35260ad5adcc6eee7f6e575ce7';
const P1_EVALUATOR_PREDECESSOR_HEAD = '468710ab8760d76ab66b16d82c11883ab5b3866c';
const BRANCH = 'codex/issue-7-supersynth-v9';
const BUILD_DIR = path.join(ROOT, 'build/issue7-physical-identification-v1/diagnostic');
const P2_TEST_BUILD_DIR = path.join(ROOT, 'build/issue7-physical-identification-v1/production-test');
const P2_RELEASE_BUILD_DIR = path.join(ROOT, 'build/issue7-physical-identification-v1/production-release');
const WASM_REL = 'plugins/dsp/super-synth/plugin.wasm';
const P1_REL = 'runtime-revisions/physical-fit-P1.json';
const P1_EVALUATION_REVISION_REL = 'runtime-revisions/physical-fit-P1-evaluation-01.json';
const P2_REL = 'runtime-revisions/physical-fit-P2.json';
const REF_REL = 'reference/corpus.json';
const REGRESSION_REL = 'production/regressions.json';
const CTEST_REL = 'production/ctest.json';
const PROMOTION_INTENT_REL = 'promotion/intent.json';
const PROMOTION_RECEIPT_REL = 'promotion/receipt.json';
const PROMOTION_FILES = Object.freeze(['wasm/plugins/dsp/super-synth/presets.json', 'wasm/shared/generated/super-synth_grand_profiles.h'].sort());
const STAGE4_LEGACY_ROOT = path.join(ROOT, 'build/issue7-physical-identification-v1/stage4-legacy-conformance');
const PROFILE_GENERATOR = 'wasm/cmake/generate_plugin_metadata.py';
const REF_CELLS = core.HOLDOUT_PITCHES.flatMap(pitch => core.HOLDOUT_VELOCITIES.map(velocity => ({pitch, velocity})));
const SOURCE_FILES = Object.freeze([
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/CMakeLists.txt',
  'wasm/cmake/wasm_plugin.cmake',
  'wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-physical-identification-v1-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-identification.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.test.cjs',
  'wasm/cmake/generate_plugin_metadata.py',
  'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3-production-recovery.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage4-lifecycle.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage4-full-range-evaluator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.cjs',
  ...['concert-grand-regression.test.js', 'piano-realism-regression.test.js', 'piano-click-regression.test.js',
    'piano-voice-steal-regression.test.js', 'plugin-interface-v1.test.js', 'playback-safety-regression.test.js']
    .map(name => `wasm/plugins/dsp/super-synth/test/${name}`)
]);
const DIAGNOSTIC_EXPORTS = Object.freeze([
  'soraoto_supersynth_physical_identification_set',
  'soraoto_supersynth_physical_identification_get',
  'soraoto_supersynth_physical_identification_observation_reset',
  'soraoto_supersynth_physical_identification_observation'
]);

function git(args, {raw = false} = {}) {
  return execFileSync('rtk', raw ? ['proxy', 'git', ...args] : ['git', ...args], {cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).trim();
}
function fileSha(file) { return core.sha256(fs.readFileSync(file)); }
function wasmPath(buildDir = BUILD_DIR) { return path.join(buildDir, WASM_REL); }
function wasmExports(file) {
  const module = new WebAssembly.Module(fs.readFileSync(file));
  return WebAssembly.Module.exports(module).map(item => item.name).sort();
}
function assertDiagnosticExports(file) {
  const exports = wasmExports(file);
  for (const name of DIAGNOSTIC_EXPORTS) if (!exports.includes(name)) throw new Error(`BLOCKED_PHYSICAL_DIAGNOSTIC_EXPORT_MISSING: ${name}`);
  return exports;
}
function assertNoDiagnosticExports(file) {
  const exports = wasmExports(file);
  for (const name of DIAGNOSTIC_EXPORTS) if (exports.includes(name)) throw new Error(`BLOCKED_PHYSICAL_DIAGNOSTIC_EXPORT_IN_PRODUCTION: ${name}`);
  return exports;
}
function assertCleanTarget() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const upstream = git(['rev-parse', '@{u}']);
  const status = git(['status', '--porcelain=v1'], {raw: true});
  if (branch !== BRANCH || head !== upstream) throw new Error('BLOCKED_PHYSICAL_BRANCH_OR_PUSH');
  if (git(['merge-base', '--is-ancestor', BASE_HEAD, 'HEAD']) !== '') throw new Error('BLOCKED_PHYSICAL_BASELINE_ANCESTRY');
  const dirty = status.split('\n').filter(Boolean).filter(line => !line.endsWith(' .vscode/'));
  if (dirty.length) throw new Error(`BLOCKED_PHYSICAL_WORKTREE_DIRTY: ${dirty.join(';')}`);
  return {branch, head, upstream};
}
function runRtk(args, label, {cwd = ROOT, env = process.env, allowFailure = false} = {}) {
  const result = spawnSync('rtk', args, {cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (result.error) throw result.error;
  const out = result.stdout || '', err = result.stderr || '';
  const logDir = path.join(ROOT, 'build/issue7-physical-identification-v1/logs');
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, `${label}.log`), `${out}\n${err}`);
  if (result.status !== 0 && !allowFailure) throw new Error(`BLOCKED_PHYSICAL_COMMAND: rtk ${args.join(' ')} (exit ${result.status}): ${(err || out).slice(-1600)}`);
  return {stdout: out, stderr: err, status: result.status};
}
function configureDiagnosticBuild() {
  const toolchain = path.join(ROOT, 'wasm/cmake/wasm32-clang.cmake');
  runRtk(['cmake', '-S', 'wasm', '-B', BUILD_DIR, `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`, '-DBUILD_TESTING=ON', '-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON', '-DSORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS=ON', '-DSORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_TREBLE_HARDNESS_DIAGNOSTICS=OFF'], 'configure-diagnostic');
  runRtk(['cmake', '--build', BUILD_DIR, '--target', 'soraoto_dsp_super_synth'], 'build-diagnostic');
  const wasm = wasmPath();
  if (!fs.existsSync(wasm)) throw new Error('BLOCKED_PHYSICAL_DIAGNOSTIC_WASM_MISSING');
  return {buildDirectory: path.relative(ROOT, BUILD_DIR), wasmSha256: fileSha(wasm), exports: assertDiagnosticExports(wasm)};
}
function sourceIdentity() {
  const gitFacts = assertCleanTarget();
  const files = Object.fromEntries(SOURCE_FILES.map(relative => [relative, fileSha(path.join(ROOT, relative))]));
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  return {git: {...gitFacts, tree}, files};
}
function ensureP1EvaluationRevision(roots, prior, source) {
  const evaluatorFiles = [
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-identification-v1.test.cjs'
  ].sort();
  const priorFiles = Object.keys(prior.sourceIdentity?.files || {}).sort();
  const currentFiles = Object.keys(source.files).sort();
  if (!core.same(priorFiles, currentFiles)) throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_SOURCE_SET_DRIFT');
  if (prior.sourceIdentity?.git?.head !== P1_EVALUATOR_PREDECESSOR_HEAD)
    throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_PREDECESSOR_HEAD');
  const fileChanges = priorFiles.filter(relative => prior.sourceIdentity.files[relative] !== source.files[relative]).sort();
  const commitChanges = git(['diff', '--name-only', `${prior.sourceIdentity.git.head}..${source.git.head}`], {raw: true}).split(/\r?\n/).filter(Boolean).sort();
  if (!core.same(fileChanges, evaluatorFiles) || !core.same(commitChanges, evaluatorFiles))
    throw new Error(`BLOCKED_PHYSICAL_P1_EVALUATOR_CHANGE_SCOPE: ${commitChanges.join(',')}`);
  git(['merge-base', '--is-ancestor', prior.sourceIdentity.git.head, source.git.head], {raw: true});
  if (git(['rev-list', '--count', `${prior.sourceIdentity.git.head}..${source.git.head}`]) !== '1')
    throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_COMMIT_COUNT');
  if (git(['rev-parse', `${prior.sourceIdentity.git.head}^{tree}`]) !== prior.sourceIdentity.git.tree)
    throw new Error('BLOCKED_PHYSICAL_P1_PREDECESSOR_TREE_DRIFT');
  const wasmSha256 = fileSha(wasmPath());
  if (wasmSha256 !== prior.build?.wasmSha256) throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_BUILD_DRIFT');
  assertDiagnosticExports(wasmPath());
  const baseline = readPhase(roots, 'baseline'), finiteDifference = readPhase(roots, 'finiteDifference');
  if (baseline?.counts.COMPLETE !== 7 || baseline.counts.PENDING || baseline.counts.IN_PROGRESS || baseline.counts.AMBIGUOUS
      || finiteDifference?.counts.COMPLETE !== 42 || finiteDifference.counts.PENDING || finiteDifference.counts.IN_PROGRESS || finiteDifference.counts.AMBIGUOUS
      || core.totalCharged(allLedgers(roots)) !== 49)
    throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_CELL_STATE');
  const p1Sha256 = core.readDual(roots, P1_REL).sha256;
  const referenceSha256 = core.readDual(roots, REF_REL)?.sha256;
  if (!referenceSha256 || baseline.plan.identity?.p1Sha256 !== p1Sha256 || finiteDifference.plan.identity?.p1Sha256 !== p1Sha256
      || baseline.plan.identity?.referenceSha256 !== referenceSha256 || finiteDifference.plan.identity?.referenceSha256 !== referenceSha256
      || baseline.plan.identity?.p1Lineage !== prior.lineage || finiteDifference.plan.identity?.p1Lineage !== prior.lineage)
    throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_PLAN_IDENTITY');
  const baselineLedger = core.readDual(roots, 'baseline/ledger.json');
  const finiteDifferenceLedger = core.readDual(roots, 'finiteDifference/ledger.json');
  const input = {revisionId: 'physical-fit-P1-evaluation-01', decision: 'P1_EVALUATOR_ONLY_RESUME', p1Sha256, referenceSha256,
    predecessorHead: prior.sourceIdentity.git.head, predecessorTree: prior.sourceIdentity.git.tree,
    currentHead: source.git.head, currentTree: source.git.tree, predecessorEvaluatorSha256: prior.sourceIdentity.files[evaluatorFiles[0]],
    currentEvaluatorSha256: source.files[evaluatorFiles[0]], predecessorTestSha256: prior.sourceIdentity.files[evaluatorFiles[1]],
    currentTestSha256: source.files[evaluatorFiles[1]], wasmSha256,
    baselinePlanSha256: core.sha256(core.jsonBytes(baseline.plan)), baselineLedgerSha256: baselineLedger.sha256,
    finiteDifferencePlanSha256: core.sha256(core.jsonBytes(finiteDifference.plan)), finiteDifferenceLedgerSha256: finiteDifferenceLedger.sha256,
    preservedAcousticCells: 49, additionalRenderCalls: 0};
  const inputDigest = core.sha256(core.jsonBytes(input));
  let record = core.readJson(roots, P1_EVALUATION_REVISION_REL, false);
  const hadRecord = Boolean(record);
  if (!hadRecord && (baseline.result || finiteDifference.result)) throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_RESULT_REVISION');
  if (record) {
    if (record.inputDigest !== inputDigest || !core.same(record.input, input)) throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_REVISION_DRIFT');
  } else {
    const recordValue = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic,
      createdAt: new Date().toISOString(), input, inputDigest};
    core.writeJson(roots, P1_EVALUATION_REVISION_REL, recordValue, true);
    record = recordValue;
  }
  const recordSha256 = core.readDual(roots, P1_EVALUATION_REVISION_REL).sha256;
  if ((baseline.result && baseline.result.summary?.p1EvaluationRevisionSha256 !== recordSha256)
      || (finiteDifference.result && finiteDifference.result.summary?.p1EvaluationRevisionSha256 !== recordSha256))
    throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_RESULT_REVISION');
  const eventId = 'runtime:physical-fit-P1-evaluation-01';
  const event = {eventId, type: 'runtime-revision', lineage: core.LINEAGE.diagnostic, sha256: recordSha256, at: record.createdAt};
  const existingEvent = core.journal(roots).events.find(item => item.eventId === eventId);
  if (existingEvent && !core.same(existingEvent, event)) throw new Error('BLOCKED_PHYSICAL_P1_EVALUATOR_REVISION_EVENT_DRIFT');
  if (!existingEvent) core.appendJournal(roots, event);
  return {record, sha256: recordSha256};
}
function rootsForReadOnly(home = os.homedir()) {
  const roots = core.resolveRoots(ROOT, home);
  return [roots.primary, roots.secondary,
    path.join(roots.commonDirectory, 'soraoto-agent-state', '7'),
    path.join(home, '.soraoto-agent-archive', path.basename(ROOT), '7')];
}
function readOnlyProtected(fn, home = os.homedir()) {
  const roots = rootsForReadOnly(home);
  const snapshot = () => roots.map(root => ({root, files: core.snapshotTree(root)}));
  const before = snapshot(), result = fn(), after = snapshot();
  const beforeSha256 = core.sha256(core.jsonBytes(before)), afterSha256 = core.sha256(core.jsonBytes(after));
  if (!core.same(before, after)) throw new Error('BLOCKED_PHYSICAL_READ_ONLY_MUTATION');
  return {...result, readOnlyEvidence: {unchanged: true, beforeSha256, afterSha256}, builds: 0, renders: 0, writes: 0, acousticRenders: 0};
}
function allLedgers(roots) {
  return Object.keys(core.STAGES).map(stage => core.readJson(roots, `${stage}/ledger.json`, false)).filter(Boolean);
}
function readPhase(roots, stage) {
  const plan = core.readJson(roots, `${stage}/plan.json`, false), ledger = core.readJson(roots, `${stage}/ledger.json`, false);
  if (!plan && !ledger) return null;
  if (!plan || !ledger) throw new Error(`BLOCKED_PHYSICAL_PARTIAL_PHASE: ${stage}`);
  const counts = core.verifyLedger(roots, plan, ledger);
  return {plan, ledger, counts, charged: ledger.accounting.charged, result: core.readJson(roots, `${stage}/result.json`, false)};
}
function state(roots) {
  const phases = {};
  for (const stage of Object.keys(core.STAGES)) {
    const phase = readPhase(roots, stage);
    if (phase) phases[stage] = {counts: phase.counts, charged: phase.charged, authorizedCellCount: phase.plan.cells.length,
      planSha256: core.sha256(core.jsonBytes(phase.plan)), resultSha256: core.readDual(roots, `${stage}/result.json`)?.sha256 || null};
  }
  const history = core.journal(roots);
  return {phases, journal: {events: history.events.length, sha256: history.sha256}, budget: core.assertBudget(allLedgers(roots))};
}
function verifyOldEvidence(home = os.homedir()) {
  const v1 = require('./issue7-current-build-core.cjs');
  const v2 = require('./issue7-treble-hardness-v2-core.cjs');
  const v2runner = require('./run-issue7-treble-hardness-v2.cjs');
  const old = v2runner.verifyOldR9({home});
  const r10Roots = v2.resolveRoots(ROOT, home);
  const r10 = v2.verifyRuntimeRevision(r10Roots, 10, v2.R9_SHA256);
  const correction = verifyPinnedR10Correction(v2, v2runner, r10Roots, r10, home);
  const v2State = v2runner.status({home});
  const screen = v2.readJson(v2.resolveRoots(ROOT, home), 'screen/result.json', true);
  if (screen.result?.decision !== 'BLOCKED_TREBLE_HARDNESS_NO_PASS' || v2State.current?.phases?.screen?.counts?.COMPLETE !== 200) throw new Error('BLOCKED_PHYSICAL_OLD_V2_EVIDENCE');
  const oldStage3Roots = ['stage3'].map(stage => v1.resolveRoots(ROOT, stage, v1.EPOCH, {home}));
  const oldStage3 = oldStage3Roots.map(r => v1.readFinal(r, 'stage3'));
  if (oldStage3.some(result => result.result?.decision !== 'BLOCKED_STAGE3_DIRECT_REFERENCE')) throw new Error('BLOCKED_PHYSICAL_LEGACY_STAGE3_EVIDENCE');
  return {oldCalls: old.totalCalls, r9Sha256: old.r9Sha256, r10Sha256: r10.sha256, correctionSha256: correction.sha256,
    v2Screen: screen.result.decision, v2ScreenComplete: v2State.current.phases.screen.counts.COMPLETE,
    legacyStage3: oldStage3[0].result.decision, legacyStage3Calls: oldStage3[0].result.accounting?.charged ?? oldStage3[0].result.coverage?.cells ?? null};
}
function verifyPinnedR10Correction(v2, v2runner, roots, r10, home) {
  // R10 evidence is tied to BASE_HEAD; verify its source hashes from that immutable tree.
  const stored = v2.readDual(roots, v2runner.CORRECTION_REL);
  if (!stored) throw new Error('BLOCKED_V2_R10_CORRECTION_REQUIRED');
  const correctionRecord = JSON.parse(stored.bytes.toString('utf8'));
  const historicalFiles = new Map();
  for (const [relative, expectedSha256] of Object.entries(correctionRecord.inputs || {})) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('BLOCKED_PHYSICAL_R10_INPUT_PATH');
    let bytes;
    try {
      bytes = execFileSync('rtk', ['proxy', 'git', 'show', `${BASE_HEAD}:${relative}`], {cwd: ROOT, maxBuffer: 16 * 1024 * 1024});
    } catch {
      throw new Error(`BLOCKED_PHYSICAL_R10_BASELINE_INPUT_MISSING: ${relative}`);
    }
    if (core.sha256(bytes) !== expectedSha256) throw new Error(`BLOCKED_PHYSICAL_R10_BASELINE_INPUT_DRIFT: ${relative}`);
    historicalFiles.set(path.resolve(ROOT, relative), bytes);
  }
  if (!historicalFiles.size) throw new Error('BLOCKED_PHYSICAL_R10_BASELINE_INPUTS_EMPTY');
  const originalReadFileSync = fs.readFileSync;
  try {
    fs.readFileSync = function(file, ...args) {
      const historical = typeof file === 'string' ? historicalFiles.get(path.resolve(file)) : null;
      if (historical) {
        const encoding = typeof args[0] === 'string' ? args[0] : args[0]?.encoding;
        return encoding ? historical.toString(encoding) : Buffer.from(historical);
      }
      return originalReadFileSync.call(this, file, ...args);
    };
    return v2runner.verifyR10Correction(roots, r10, {home});
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
}
function readRuntime(roots) { return core.readJson(roots, P1_REL, false); }
function ensureDiagnosticBuild(roots, refRecord) {
  const source = sourceIdentity();
  const prior = readRuntime(roots);
  let build;
  if (prior) {
    if ((!core.same(prior.sourceIdentity, source) && !ensureP1EvaluationRevision(roots, prior, source))
        || !core.same(prior.reference, refRecord.source) || prior.lineage !== core.LINEAGE.diagnostic) throw new Error('BLOCKED_PHYSICAL_P1_IDENTITY_DRIFT');
    build = {buildDirectory: prior.build.buildDirectory, wasmSha256: fileSha(wasmPath()), exports: assertDiagnosticExports(wasmPath())};
    if (build.wasmSha256 !== prior.build.wasmSha256) throw new Error('BLOCKED_PHYSICAL_DIAGNOSTIC_BUILD_DRIFT');
    return prior;
  }
  build = configureDiagnosticBuild();
  const identity = {sourceIdentity: source, reference: refRecord.source, build, lineage: core.LINEAGE.diagnostic, epoch: core.EPOCH, budgetLimit: core.MAX_CALLS};
  const record = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic, createdAt: new Date().toISOString(), ...identity,
    identitySha256: core.sha256(core.jsonBytes(identity))};
  core.writeJson(roots, P1_REL, record, true);
  core.appendJournal(roots, {eventId: 'runtime:physical-fit-P1', type: 'runtime-revision', lineage: core.LINEAGE.diagnostic, sha256: core.sha256(core.jsonBytes(record)), at: record.createdAt});
  return record;
}
async function ensureReference(roots, referenceDir = process.env.SUPERSYNTH_V9_SALAMANDER_REF,
  archivePath = process.env.SUPERSYNTH_V9_SALAMANDER_ARCHIVE || analysis.locateGoogleDriveArchive()) {
  const existing = core.readJson(roots, REF_REL, false);
  if (!archivePath) throw new Error('BLOCKED_PHYSICAL_REFERENCE_REQUIRED: Salamander archive was not found on the Google Drive Desktop filesystem');
  const archiveSha256 = await analysis.sha256File(archivePath);
  if (archiveSha256 !== analysis.ARCHIVE_SHA256) throw new Error('BLOCKED_PHYSICAL_REFERENCE_ARCHIVE_SHA');
  if (existing) {
    if (existing.source.archiveSha256 !== archiveSha256 || existing.rows.length !== REF_CELLS.length
        || typeof existing.source.referenceDir !== 'string') throw new Error('BLOCKED_PHYSICAL_REFERENCE_IDENTITY');
    const corpus = await analysis.referenceCorpus(existing.source.referenceDir, REF_CELLS, {archivePath, archiveSha256});
    if (!core.same(corpus.source, existing.source) || !core.same(corpus.rows, existing.rows)) throw new Error('BLOCKED_PHYSICAL_REFERENCE_DATA_DRIFT');
    return {record: existing, sha256: core.readDual(roots, REF_REL).sha256};
  }
  if (!referenceDir) {
    const extractionRoot = path.join(ROOT, 'build/issue7-physical-identification-v1/reference', archiveSha256);
    referenceDir = analysis.extractReferenceFiles(archivePath, REF_CELLS, extractionRoot).referenceDir;
  }
  const corpus = await analysis.referenceCorpus(referenceDir, REF_CELLS, {archivePath, archiveSha256});
  const data = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, createdAt: new Date().toISOString(), ...corpus};
  const stored = core.writeJson(roots, REF_REL, data, true);
  return {record: data, sha256: stored.sha256};
}
function planStage(roots, stage, identity, cells) {
  const planRel = `${stage}/plan.json`, ledgerRel = `${stage}/ledger.json`;
  const oldPlan = core.readJson(roots, planRel, false), oldLedger = core.readJson(roots, ledgerRel, false);
  if (oldPlan || oldLedger) {
    if (!oldPlan || !oldLedger || !core.same(oldPlan.identity, identity) || !core.same(oldPlan.cells, cells)) throw new Error(`BLOCKED_PHYSICAL_PLAN_IDENTITY_DRIFT: ${stage}`);
    core.verifyLedger(roots, oldPlan, oldLedger); return {plan: oldPlan, ledger: oldLedger};
  }
  const plan = core.createPlan(stage, {identity, cells});
  core.writeJson(roots, planRel, plan, true);
  const ledger = core.freshLedger(plan); core.saveLedger(roots, ledger);
  return {plan, ledger};
}
function finalizePhase(roots, plan, ledger, decision, summary) {
  const states = core.verifyLedger(roots, plan, ledger);
  if (states.COMPLETE !== plan.cells.length) throw new Error(`BLOCKED_PHYSICAL_PHASE_INCOMPLETE: ${plan.stage}`);
  const result = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, stage: plan.stage, decision, identity: plan.identity,
    planSha256: core.sha256(core.jsonBytes(plan)), ledgerSha256: core.readDual(roots, `${plan.stage}/ledger.json`).sha256,
    accounting: {charged: ledger.accounting.charged}, coverage: states, summary};
  const existing = core.readJson(roots, `${plan.stage}/result.json`, false);
  if (existing) {
    const {createdAt, ...body} = existing;
    if (!core.same(body, result)) throw new Error(`BLOCKED_PHYSICAL_RESULT_IDENTITY_DRIFT: ${plan.stage}`);
    return {result: existing, sha256: core.readDual(roots, `${plan.stage}/result.json`).sha256};
  }
  result.createdAt = new Date().toISOString();
  const stored = core.writeJson(roots, `${plan.stage}/result.json`, result, true);
  return {result, sha256: stored.sha256};
}
function loadRows(roots, stage) {
  const phase = readPhase(roots, stage);
  if (!phase || phase.counts.COMPLETE !== phase.plan.cells.length) throw new Error(`BLOCKED_PHYSICAL_PHASE_INCOMPLETE: ${stage}`);
  return phase.plan.cells.map(cell => core.readJson(roots, `${stage}/${phase.ledger.cells[core.cellKey(cell)].result}`, true));
}
function allMetricRows(records) { return records.map(record => ({pitch: record.cell.pitch, velocity: record.cell.velocity, metrics: record.row.metrics.official})); }
function referenceMetricRows(referenceRows) { return referenceRows.map(record => ({pitch: record.pitch, velocity: record.velocity, metrics: record.metrics.official})); }
function evaluateOfficial(referenceRows, actualRows, requiredVelocityLayers) {
  return directMetrics.evaluateDirectReferenceMatrix(referenceRows, actualRows, {requiredVelocityLayers});
}
function gateViolation(evaluation) {
  const limits = evaluation.limits || directMetrics.LIMITS;
  const violations = [];
  for (const cell of evaluation.cells) {
    violations.push(Math.max(0, Math.abs(cell.levelErrorDb) / limits.directLevelErrorDb - 1));
    violations.push(Math.max(0, cell.peakDbfs - limits.peakMaxDbfs));
    if (cell.centroidComparable) violations.push(Math.max(0, cell.centroidRatio / limits.centroidRatio - 1));
    violations.push(Math.max(0, cell.above2kDelta / limits.above2kDelta - 1));
    violations.push(Math.max(0, cell.postAttackShapeErrorDb / limits.postAttackShapeErrorDb - 1));
    if (!cell.finite || cell.guardHits !== 0) return Infinity;
  }
  for (const pitch of evaluation.velocity || []) {
    violations.push(Math.max(0, pitch.violationDb / Math.max(limits.dynamicSpanErrorDb || limits.dynamicSpanDb || 1, 1e-12)));
    violations.push(Math.max(0, pitch.violation || 0));
  }
  return Math.max(0, ...violations);
}
function researchLoss(referenceRows, actualRecords, gainDb) {
  let sum = 0, count = 0;
  const byKey = new Map(actualRecords.map(row => [`${row.cell.pitch}:${row.cell.velocity}`, row.row.metrics]));
  for (const ref of referenceRows) {
    const actual = byKey.get(`${ref.pitch}:${ref.velocity}`);
    if (!actual) throw new Error(`BLOCKED_PHYSICAL_RESEARCH_CELL_MISSING: ${ref.pitch}/${ref.velocity}`);
    const a = analysis.featureVector(actual, gainDb), b = analysis.featureVector(ref.metrics, 0);
    if (a.length !== b.length) throw new Error('BLOCKED_PHYSICAL_RESEARCH_FEATURE_SHAPE');
    for (let i = 0; i < a.length; i++) { const delta = a[i] - b[i]; sum += delta * delta; count++; }
  }
  const loss = sum / Math.max(1, count);
  if (!Number.isFinite(loss)) throw new Error('BLOCKED_PHYSICAL_RESEARCH_LOSS_NONFINITE');
  return loss;
}
function writeWavFloat32(left, right, sampleRate) {
  const frames = left.length, dataSize = frames * 8, bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + dataSize, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 8, 28);
  bytes.writeUInt16LE(8, 32); bytes.writeUInt16LE(32, 34); bytes.write('data', 36); bytes.writeUInt32LE(dataSize, 40);
  for (let i = 0, offset = 44; i < frames; i++, offset += 8) { bytes.writeFloatLE(left[i], offset); bytes.writeFloatLE(right[i], offset + 4); }
  return bytes;
}
function getPresetName(harness) {
  const presets = ext(harness.descriptor).presets || {};
  if (!presets.concert_grand && !(harness.descriptor.factory_presets || []).some(item => item?.meta?.name === 'concert_grand')) throw new Error('BLOCKED_PHYSICAL_CONCERT_GRAND_PRESET_MISSING');
}
function renderAudio({cell, values, frames, notes, diagnostic = true}) {
  const buildEnv = 'SORAOTO_WASM_BUILD_DIR', priorBuildDir = process.env[buildEnv];
  process.env[buildEnv] = BUILD_DIR;
  let harness;
  try {
    harness = new PluginHarness(ROOT, WASM_REL, {sampleRate: 48000, maxFrames: 128});
    getPresetName(harness); harness.applyPreset('concert_grand');
    if (diagnostic) {
      for (let index = 0; index < 3; index++) {
        const expected = values[index];
        const current = harness.e.soraoto_supersynth_physical_identification_get(index);
        if (Math.abs(current - expected) > Math.max(1e-7, Math.abs(expected) * 1e-6)) {
          const status = harness.e.soraoto_supersynth_physical_identification_set(index, expected);
          if (status !== 0) throw new Error(`BLOCKED_PHYSICAL_OVERRIDE_REJECTED: ${index}:${status}`);
        }
        const observed = harness.e.soraoto_supersynth_physical_identification_get(index);
        if (Math.abs(observed - expected) > Math.max(1e-7, Math.abs(expected) * 1e-6)) throw new Error(`BLOCKED_PHYSICAL_OVERRIDE_READBACK: ${index}`);
      }
      harness.e.soraoto_supersynth_physical_identification_observation_reset();
    }
    const beforeGuard = harness.e.soraoto_supersynth_guard_hit_count?.() ?? 0;
    const left = new Float32Array(frames), right = new Float32Array(frames), callbackMs = [];
    const frameCount = frames;
    for (let position = 0; position < frameCount; position += 128) {
      const count = Math.min(128, frameCount - position), events = [];
      if (position === 0) for (let i = 0; i < notes.length; i++) events.push({kind: 1, noteId: i + 1, pitch: notes[i].pitch, velocity: notes[i].velocity / 127, offset: 0});
      if (position === 48000) for (let i = 0; i < notes.length; i++) events.push({kind: 2, noteId: i + 1, pitch: notes[i].pitch, velocity: 0, offset: 0});
      const started = performance.now();
      const outputs = harness.process(count, {events});
      callbackMs.push(performance.now() - started);
      for (let i = 0; i < count; i++) { left[position + i] = outputs[0][0][i]; right[position + i] = outputs[0][1][i]; }
    }
    const afterGuard = harness.e.soraoto_supersynth_guard_hit_count?.() ?? 0;
    let peak = 0;
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    const finite = left.every(Number.isFinite) && right.every(Number.isFinite);
    if (!finite) throw new Error('BLOCKED_PHYSICAL_NONFINITE_RENDER');
    const internal = diagnostic ? Array.from({length: 6}, (_, index) => harness.e.soraoto_supersynth_physical_identification_observation(index)) : [];
    const audio = writeWavFloat32(left, right, 48000);
    let metrics = null;
    if (cell.kind !== 'headroom') {
      metrics = analysis.analyze(left, right, cell.pitch, 48000);
      metrics.official.outputGuardHits = afterGuard - beforeGuard;
      metrics.official.finite = finite;
    }
    return {audio, row: {cell, values: [...values], metrics, internal, finite, peak, peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -240, outputGuardHits: afterGuard - beforeGuard,
      callbackMs: cell.kind === 'headroom' ? callbackMs : undefined, maxCallbackMs: cell.kind === 'headroom' ? Math.max(...callbackMs) : undefined}};
  } finally {
    harness?.close();
    if (priorBuildDir === undefined) delete process.env[buildEnv]; else process.env[buildEnv] = priorBuildDir;
  }
}
function stageIdentity(roots, p1, reference, extra = {}) { return {p1Sha256: core.readDual(roots, P1_REL).sha256, referenceSha256: reference.sha256, p1Lineage: p1.lineage, ...extra}; }
function executePlan(roots, stage, identity, cells, render, {ownerId, home = os.homedir()} = {}) {
  const {plan, ledger} = planStage(roots, stage, identity, cells), all = allLedgers(roots);
  for (const cell of plan.cells) {
    const item = ledger.cells[core.cellKey(cell)];
    if (item.state === 'COMPLETE') continue;
    const priorLedgers = allLedgers(roots).filter(other => other.stage !== ledger.stage);
    core.startCell(roots, plan, ledger, cell, {ownerId, priorLedgers});
    try {
      const output = render(cell);
      core.completeCell(roots, plan, ledger, cell, output.row, {artifact: output.audio});
    } catch (error) {
      item.state = 'AMBIGUOUS'; item.error = String(error.message || error); ledger.accounting.ambiguous = (ledger.accounting.ambiguous || 0) + 1;
      core.saveLedger(roots, ledger);
      core.appendJournal(roots, {eventId: `ambiguous:${stage}:${core.cellKey(cell)}`, type: 'render-ambiguous', stage, cell, error: item.error, at: new Date().toISOString()});
      throw new Error(`BLOCKED_PHYSICAL_RENDER_AMBIGUOUS: ${stage}:${core.cellKey(cell)}: ${item.error}`);
    }
  }
  return {plan, ledger, rows: loadRows(roots, stage)};
}
function ensurePhaseB(roots, p1, reference, ownerId) {
  const identity = stageIdentity(roots, p1, reference, {purpose: 'P1 baseline and centered finite differences'});
  const baseValues = core.PARAMS.map(parameter => parameter.baseline);
  const base = executePlan(roots, 'baseline', identity, core.baselineCells(), cell => renderAudio({cell, values: baseValues, frames: 24000, notes: [{pitch: cell.pitch, velocity: cell.velocity}]}), {ownerId});
  const perturbations = executePlan(roots, 'finiteDifference', identity, core.finiteDifferenceCells(), cell => {
    const values = [...baseValues]; values[cell.parameter] += cell.delta;
    return renderAudio({cell, values, frames: 24000, notes: [{pitch: cell.pitch, velocity: cell.velocity}]});
  }, {ownerId});
  const baseByKey = new Map(base.rows.map(row => [`${row.cell.pitch}:${row.cell.velocity}`, row.row.metrics]));
  const positive = [[], [], []], negative = [[], [], []];
  for (const row of perturbations.rows) {
    const target = row.cell.delta > 0 ? positive[row.cell.parameter] : negative[row.cell.parameter];
    target.push({cell: row.cell, metrics: row.row.metrics, internal: row.row.internal});
  }
  const order = rows => rows.map(items => {
    const byKey = new Map(items.map(item => [`${item.cell.pitch}:${item.cell.velocity}`, item.metrics]));
    return core.SCREEN_CELLS.map(cell => analysis.featureVector(byKey.get(`${cell.pitch}:${cell.velocity}`), 0));
  });
  const baselineMetrics = core.SCREEN_CELLS.map(cell => baseByKey.get(`${cell.pitch}:${cell.velocity}`));
  const referenceRows = reference.record.rows.filter(row => core.SCREEN_CELLS.some(cell => cell.pitch === row.pitch && cell.velocity === row.velocity));
  const baselineOfficial = evaluateOfficial(referenceMetricRows(referenceRows), allMetricRows(base.rows), [14, 31, 36, 124]);
  const gainDb = analysis.gainOffsetDb(referenceRows.map(row => row.metrics), baselineMetrics);
  const baselineFeatures = baselineMetrics.map(metrics => analysis.featureVector(metrics, gainDb));
  const positiveFeatures = positive.map(rows => {
    const byKey = new Map(rows.map(item => [`${item.cell.pitch}:${item.cell.velocity}`, item.metrics]));
    return core.SCREEN_CELLS.map(cell => analysis.featureVector(byKey.get(`${cell.pitch}:${cell.velocity}`), gainDb));
  });
  const negativeFeatures = negative.map(rows => {
    const byKey = new Map(rows.map(item => [`${item.cell.pitch}:${item.cell.velocity}`, item.metrics]));
    return core.SCREEN_CELLS.map(cell => analysis.featureVector(byKey.get(`${cell.pitch}:${cell.velocity}`), gainDb));
  });
  const referenceFeatures = referenceRows.map(row => analysis.featureVector(row.metrics, 0));
  const sensitivity = core.centralDifferences({baseline: baselineFeatures, positive: positiveFeatures, negative: negativeFeatures, steps: core.PARAMS.map(parameter => parameter.baseline * 0.1)});
  const residual = baselineFeatures.flatMap((features, index) => features.map((value, feature) => value - referenceFeatures[index][feature]));
  if (core.matrixRank3(sensitivity.rows) < 3) throw new Error('BLOCKED_PHYSICAL_PARAMETER_UNIDENTIFIABLE');
  const causalSignals = core.PARAMS.map((_, index) => {
    const positiveObs = positive[index].map(item => item.internal?.[index] ?? 0);
    const negativeObs = negative[index].map(item => item.internal?.[index] ?? 0);
    return positiveObs.some((value, i) => Math.abs(value - negativeObs[i]) > 1e-8);
  });
  if (causalSignals.some(value => !value)) throw new Error('BLOCKED_PHYSICAL_INTERNAL_SIGNAL_UNIDENTIFIABLE');
  const evaluationRevision = core.readDual(roots, P1_EVALUATION_REVISION_REL);
  const summary = {baselineOfficial, p1EvaluationRevisionSha256: evaluationRevision?.sha256 || null,
    sharedGainOffsetDb: gainDb, featureCountPerCell: sensitivity.featureCount,
    sensitivityRank: core.matrixRank3(sensitivity.rows), parameterDeltas: core.PARAMS.map(parameter => parameter.baseline * 0.1),
    causalSignals, baselineRows: base.rows.map(row => ({cell: row.cell, sha256: row.sha256})), finiteDifferenceRows: perturbations.rows.map(row => ({cell: row.cell, sha256: row.sha256}))};
  const baselineResult = finalizePhase(roots, base.plan, base.ledger, 'PHYSICAL_FIT_P1_BASELINE_COMPLETE', summary);
  const differenceResult = finalizePhase(roots, perturbations.plan, perturbations.ledger, 'PHYSICAL_FIT_P1_SENSITIVITY_COMPLETE', {...summary, baselineResultSha256: baselineResult.sha256});
  return {base, perturbations, summary, gainDb, sensitivity, residual, referenceRows, baselineFeatures, referenceFeatures, baselineOfficial, baselineResult, differenceResult};
}
function candidateScore(evaluation, loss, values) {
  const violation = gateViolation(evaluation);
  const distance = Math.sqrt(values.reduce((sum, value, i) => sum + ((value - core.PARAMS[i].baseline) / core.PARAMS[i].baseline) ** 2, 0));
  return {violation, loss, distance, pass: violation === 0 && evaluation.metrics.cellFailureCount === 0 && evaluation.metrics.directPitchFailureCount === 0};
}
function lexLess(a, b) { return a.violation < b.violation - 1e-10 || (Math.abs(a.violation - b.violation) <= 1e-10 && a.loss < b.loss - 1e-10); }
function ensurePhaseC(roots, p1, reference, phaseB, ownerId) {
  const correction = core.dampedLeastSquares({sensitivity: phaseB.sensitivity.rows, residual: phaseB.residual, baseline: core.PARAMS.map(parameter => parameter.baseline), lambda: 1e-2});
  const alphas = [1, 0.75, 0.5, 0.25, 0.125, 0.0625, 0.03125];
  const proposed = alphas.map(alpha => correction.values.map((value, index) => core.PARAMS[index].baseline + (value - core.PARAMS[index].baseline) * alpha));
  const candidates = proposed.filter((values, index) => proposed.findIndex(other => core.same(other, values)) === index);
  const identity = stageIdentity(roots, p1, reference, {purpose: 'bounded damped least-squares candidate sequence', sensitivityPlanSha256: core.readDual(roots, 'finiteDifference/plan.json').sha256, baselinePlanSha256: core.readDual(roots, 'baseline/plan.json').sha256});
  const screenRefs = phaseB.referenceRows;
  const baselineMetrics = phaseB.base.rows.map(row => row.row.metrics);
  const baselineEval = evaluateOfficial(referenceMetricRows(screenRefs), allMetricRows(phaseB.base.rows), [14, 31, 36, 124]);
  const gainDb = phaseB.gainDb;
  const baselineLoss = researchLoss(screenRefs, phaseB.base.rows, gainDb);
  const baselineScore = candidateScore(baselineEval, baselineLoss, core.PARAMS.map(parameter => parameter.baseline));
  const planned = core.candidateCells(candidates);
  const executed = executePlan(roots, 'candidate', identity, planned, cell => renderAudio({cell, values: cell.values, frames: 24000, notes: [{pitch: cell.pitch, velocity: cell.velocity}]}), {ownerId});
  const candidateSummaries = [];
  for (let index = 0; index < candidates.length; index++) {
    const rows = executed.rows.filter(row => row.cell.candidate === index);
    const metricsRows = rows.map(row => ({cell: row.cell, row: row.row}));
    const evaluation = evaluateOfficial(referenceMetricRows(screenRefs), allMetricRows(metricsRows), [14, 31, 36, 124]);
    const loss = researchLoss(screenRefs, metricsRows, gainDb), score = candidateScore(evaluation, loss, candidates[index]);
    candidateSummaries.push({candidate: index, values: candidates[index], score, decision: score.pass && lexLess(score, baselineScore) ? 'PASS' : 'REJECT', official: evaluation.metrics});
  }
  const accepted = candidateSummaries.filter(item => item.decision === 'PASS').sort((a, b) => a.score.violation - b.score.violation || a.score.loss - b.score.loss || a.score.distance - b.score.distance)[0] || null;
  const decision = accepted ? 'PHYSICAL_FIT_CANDIDATE_PASS' : 'BLOCKED_PHYSICAL_FIT_NO_ACCEPTABLE_CANDIDATE';
  const summary = {decision, baselineScore, candidates: candidateSummaries, selected: accepted, maxCandidates: 7, candidateCalls: planned.length, lambda: correction.lambda, sensitivityRank: correction.rank};
  const finalized = finalizePhase(roots, executed.plan, executed.ledger, decision, summary);
  core.writeJson(roots, 'candidate/selection.json', {...summary, resultSha256: finalized.sha256}, true);
  if (!accepted) throw new Error('BLOCKED_PHYSICAL_FIT_NO_ACCEPTABLE_CANDIDATE');
  return {phase: executed, summary, selected: accepted, gainDb};
}
function ensurePhaseD(roots, p1, reference, phaseB, phaseC, ownerId) {
  const identity = stageIdentity(roots, p1, reference, {purpose: 'held-out generalization 25 cells', selectedValues: phaseC.selected.values});
  const cells = core.holdoutCells();
  const output = executePlan(roots, 'holdout', identity, cells, cell => renderAudio({cell, values: phaseC.selected.values, frames: 24000, notes: [{pitch: cell.pitch, velocity: cell.velocity}]}), {ownerId});
  const refs = referenceMetricRows(reference.record.rows), measured = allMetricRows(output.rows);
  const evaluation = directMetrics.evaluateDirectReferenceMatrix(refs, measured, {requiredVelocityLayers: [...core.HOLDOUT_VELOCITIES]});
  const loss = researchLoss(reference.record.rows, output.rows, phaseC.gainDb);
  const pass = evaluation.metrics.cellFailureCount === 0 && evaluation.metrics.directPitchFailureCount === 0 && evaluation.metrics.peakWorstDbfs < 0 && evaluation.metrics.guardHitTotal === 0 && evaluation.metrics.finite;
  const finalized = finalizePhase(roots, output.plan, output.ledger, pass ? 'PHYSICAL_FIT_HELDOUT_PASS' : 'BLOCKED_PHYSICAL_FIT_HELDOUT_FAIL', {evaluation, researchLoss: loss, calls: output.plan.cells.length});
  if (!pass) throw new Error('BLOCKED_PHYSICAL_FIT_HELDOUT_FAIL');
  const headroomCells = core.headroomCells();
  const headroom = executePlan(roots, 'headroom', stageIdentity(roots, p1, reference, {purpose: 'exact 4-call musical chord and 32-voice RT headroom comparison', selectedValues: phaseC.selected.values}), headroomCells, cell => {
    const pitches = cell.pattern === 'open-c-major-nine' ? [48, 55, 60, 64, 67, 71, 74, 76, 79, 84] : Array.from({length: 32}, (_, index) => 48 + index);
    const values = cell.role === 'baseline' ? core.PARAMS.map(parameter => parameter.baseline) : phaseC.selected.values;
    const notes = pitches.map(pitch => ({pitch, velocity: 124}));
    return renderAudio({cell, values, frames: 96000, notes});
  }, {ownerId});
  const groups = new Map();
  for (const row of headroom.rows) {
    const prior = groups.get(row.cell.pattern) || {};
    prior[row.cell.role] = row.row; groups.set(row.cell.pattern, prior);
  }
  const comparisons = [...groups.entries()].map(([pattern, pair]) => ({pattern, baselinePeakDbfs: pair.baseline.peakDbfs,
    candidatePeakDbfs: pair.candidate.peakDbfs, peakIncreaseDb: pair.candidate.peakDbfs - pair.baseline.peakDbfs,
    baselineMaxCallbackMs: pair.baseline.maxCallbackMs, candidateMaxCallbackMs: pair.candidate.maxCallbackMs,
    baselineFinite: pair.baseline.finite, candidateFinite: pair.candidate.finite,
    baselineGuardHits: pair.baseline.outputGuardHits, candidateGuardHits: pair.candidate.outputGuardHits}));
  const headroomPass = comparisons.length === 2 && comparisons.every(row => row.baselineFinite && row.candidateFinite && row.baselinePeakDbfs < 0 && row.candidatePeakDbfs < 0 && row.peakIncreaseDb <= 0.1 && row.baselineMaxCallbackMs < 2.667 && row.candidateMaxCallbackMs < 2.667 && row.baselineGuardHits === 0 && row.candidateGuardHits === 0);
  const safetyFinal = finalizePhase(roots, headroom.plan, headroom.ledger, headroomPass ? 'PHYSICAL_FIT_HEADROOM_PASS' : 'BLOCKED_PHYSICAL_FIT_HEADROOM_FAIL', {comparisons, callbackDeadlineMs: 2.667, calls: 4});
  if (!headroomPass) throw new Error('BLOCKED_PHYSICAL_FIT_HEADROOM_FAIL');
  const selected = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic, values: phaseC.selected.values,
    baselineValues: core.PARAMS.map(parameter => parameter.baseline), phaseBResultSha256: core.readDual(roots, 'finiteDifference/result.json').sha256,
    phaseCResultSha256: core.readDual(roots, 'candidate/result.json').sha256, phaseDResultSha256: finalized.sha256,
    headroomResultSha256: safetyFinal.sha256, decision: 'PHYSICAL_FIT_P1_ACCEPTANCE_PASS'};
  const oldSelected = core.readJson(roots, 'candidate/physical-fit-P1-accepted.json', false);
  if (oldSelected) {
    const {createdAt, ...body} = oldSelected;
    if (!core.same(body, selected)) throw new Error('BLOCKED_PHYSICAL_P1_ACCEPTANCE_IDENTITY_DRIFT');
  } else selected.createdAt = new Date().toISOString();
  const stored = core.writeJson(roots, 'candidate/physical-fit-P1-accepted.json', selected, true);
  return {decision: selected.decision, selected, sha256: stored.sha256, holdout: {resultSha256: finalized.sha256, evaluation, researchLoss: loss}, headroom: {resultSha256: safetyFinal.sha256, comparisons}};
}
function writeImmutableRecord(roots, relative, record) {
  const existing = core.readJson(roots, relative, false);
  if (existing) {
    const {createdAt, ...body} = existing, {createdAt: ignored, ...expected} = record;
    if (!core.same(body, expected)) throw new Error(`BLOCKED_PHYSICAL_IMMUTABLE_RECORD_DRIFT: ${relative}`);
    return {record: existing, sha256: core.readDual(roots, relative).sha256};
  }
  if (!record.createdAt) record.createdAt = new Date().toISOString();
  const stored = core.writeJson(roots, relative, record, true);
  return {record, sha256: stored.sha256};
}
function promotionChangedPaths(revision = 'HEAD') {
  return git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', revision], {raw: true})
    .split(/\r?\n/).filter(Boolean).sort();
}
function verifyPromotionCommit(intent) {
  const commit = git(['rev-parse', 'HEAD']), parent = git(['rev-parse', 'HEAD^']);
  if (parent !== intent.parentHead || git(['branch', '--show-current']) !== BRANCH
      || git(['show', '-s', '--format=%s', 'HEAD'], {raw: true}) !== 'stage3: promote physical-fit P1 candidate'
      || !core.same(promotionChangedPaths('HEAD'), PROMOTION_FILES)) throw new Error('BLOCKED_PHYSICAL_P2_PROMOTION_COMMIT');
  return {commit, parent, tree: git(['rev-parse', 'HEAD^{tree}'])};
}
function updateSelectedPreset(values) {
  const presetPath = path.join(ROOT, 'wasm/plugins/dsp/super-synth/presets.json');
  const source = fs.readFileSync(presetPath, 'utf8'), presets = JSON.parse(source), hammer = presets.concert_grand?.engine_config?.hammer;
  if (!hammer) throw new Error('BLOCKED_PHYSICAL_P2_PRESET_CONFIG');
  const current = core.PARAMS.map(parameter => hammer[parameter.name]);
  const baseline = core.PARAMS.map(parameter => parameter.baseline);
  if (core.same(current, values)) return;
  if (!core.same(current, baseline)) throw new Error('BLOCKED_PHYSICAL_P2_PRESET_PARTIAL_OR_DRIFTED');
  for (let index = 0; index < core.PARAMS.length; index++) hammer[core.PARAMS[index].name] = values[index];
  const changed = Buffer.from(`${JSON.stringify(presets, null, 2)}\n`);
  const temporary = `${presetPath}.physical-identification-${process.pid}-${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, changed, {flag: 'wx', mode: 0o600});
  fs.renameSync(temporary, presetPath);
  const readback = JSON.parse(fs.readFileSync(presetPath, 'utf8')).concert_grand.engine_config.hammer;
  if (!core.same(core.PARAMS.map(parameter => readback[parameter.name]), values)) throw new Error('BLOCKED_PHYSICAL_P2_PRESET_READBACK');
}
function profileValues() {
  const source = fs.readFileSync(path.join(ROOT, 'wasm/shared/generated/super-synth_grand_profiles.h'), 'utf8');
  return core.PARAMS.map(parameter => {
    const matches = [...source.matchAll(new RegExp(`\\.${parameter.name}\\s*=\\s*([-+0-9.eE]+)f`, 'g'))];
    if (matches.length !== 1) throw new Error(`BLOCKED_PHYSICAL_P2_GENERATED_PROFILE: ${parameter.name}`);
    return Number(matches[0][1]);
  });
}
function promoteCandidate(roots, p1) {
  const selected = core.readJson(roots, 'candidate/physical-fit-P1-accepted.json', true);
  const acceptedSha = core.readDual(roots, 'candidate/physical-fit-P1-accepted.json').sha256;
  if (selected.decision !== 'PHYSICAL_FIT_P1_ACCEPTANCE_PASS' || selected.lineage !== core.LINEAGE.diagnostic
      || !core.same(selected.baselineValues, core.PARAMS.map(parameter => parameter.baseline))) throw new Error('BLOCKED_PHYSICAL_P1_ACCEPTANCE_REQUIRED');
  const values = core.validateCandidate(selected.values);
  const existingP2 = core.readJson(roots, P2_REL, false);
  if (existingP2) {
    const wasm = path.join(ROOT, existingP2.builds.productionTest.buildDirectory, WASM_REL);
    if (existingP2.p1AcceptanceSha256 !== acceptedSha || existingP2.lineage !== core.LINEAGE.production
        || !core.same(existingP2.values, values) || fileSha(wasm) !== existingP2.builds.productionTest.wasmSha256)
      throw new Error('BLOCKED_PHYSICAL_P2_IDENTITY_DRIFT');
    return {record: existingP2, sha256: core.readDual(roots, P2_REL).sha256};
  }
  const p1Head = p1.sourceIdentity.git.head;
  let intent = core.readJson(roots, PROMOTION_INTENT_REL, false);
  if (!intent) {
    const facts = assertCleanTarget();
    if (facts.head !== p1Head) throw new Error('BLOCKED_PHYSICAL_P2_PARENT_HEAD');
    const initial = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, p1Sha256: core.readDual(roots, P1_REL).sha256,
      p1AcceptanceSha256: acceptedSha, parentHead: facts.head, values};
    const stored = writeImmutableRecord(roots, PROMOTION_INTENT_REL, initial);
    intent = stored.record;
  } else if (intent.p1Sha256 !== core.readDual(roots, P1_REL).sha256 || intent.p1AcceptanceSha256 !== acceptedSha
      || intent.parentHead !== p1Head || !core.same(intent.values, values)) throw new Error('BLOCKED_PHYSICAL_P2_PROMOTION_INTENT_DRIFT');
  const headBefore = git(['rev-parse', 'HEAD']);
  if (headBefore === intent.parentHead) {
    const dirty = git(['status', '--porcelain=v1'], {raw: true}).split(/\r?\n/).filter(Boolean).filter(line => !line.endsWith(' .vscode/')
      && !PROMOTION_FILES.some(relative => line.slice(3) === relative));
    if (dirty.length) throw new Error(`BLOCKED_PHYSICAL_P2_UNRELATED_WORKTREE_CHANGE: ${dirty.join(';')}`);
    updateSelectedPreset(values);
    runRtk(['python3', PROFILE_GENERATOR, P2_TEST_BUILD_DIR], 'generate-p2-profile');
    const profile = profileValues();
    if (profile.some((value, index) => Math.abs(value - values[index]) > Math.max(1e-8, Math.abs(values[index]) * 1e-7)))
      throw new Error('BLOCKED_PHYSICAL_P2_GENERATED_PROFILE_VALUE');
    const changed = git(['diff', '--name-only'], {raw: true}).split(/\r?\n/).filter(Boolean).sort();
    if (!core.same(changed, PROMOTION_FILES)) throw new Error(`BLOCKED_PHYSICAL_P2_FILE_ALLOWLIST: ${changed.join(',')}`);
    runRtk(['git', 'add', '--', ...PROMOTION_FILES], 'stage-p2-promotion');
    const staged = git(['diff', '--cached', '--name-only', '--no-renames'], {raw: true}).split(/\r?\n/).filter(Boolean).sort();
    if (!core.same(staged, PROMOTION_FILES)) throw new Error('BLOCKED_PHYSICAL_P2_STAGED_FILE_ALLOWLIST');
    runRtk(['git', 'commit', '-m', 'stage3: promote physical-fit P1 candidate'], 'commit-p2-promotion');
  }
  const promotion = verifyPromotionCommit(intent);
  const receipt = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, lineage: core.LINEAGE.production,
    p1AcceptanceSha256: acceptedSha, values, ...promotion};
  const receiptStored = writeImmutableRecord(roots, PROMOTION_RECEIPT_REL, receipt);
  return {intent, receipt: receiptStored.record, receiptSha256: receiptStored.sha256, selected, acceptedSha};
}
function buildP2Configuration(buildDir, {testing, guardDiagnostics}) {
  const toolchain = path.join(ROOT, 'wasm/cmake/wasm32-clang.cmake');
  runRtk(['cmake', '-S', 'wasm', '-B', buildDir, `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
    `-DBUILD_TESTING=${testing ? 'ON' : 'OFF'}`,
    `-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=${guardDiagnostics ? 'ON' : 'OFF'}`,
    '-DSORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS=OFF',
    '-DSORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS=OFF',
    '-DSORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS=OFF',
    '-DSORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS=OFF', '-DSORAOTO_SUPERSYNTH_TREBLE_HARDNESS_DIAGNOSTICS=OFF'],
  `configure-${testing ? 'p2-test' : 'p2-release'}`);
  runRtk(['cmake', '--build', buildDir, ...(testing ? [] : ['--target', 'soraoto_dsp_super_synth'])],
    `build-${testing ? 'p2-test-all' : 'p2-release-synth'}`);
  const cache = fs.readFileSync(path.join(buildDir, 'CMakeCache.txt'), 'utf8');
  const readFlag = name => cache.match(new RegExp(`^${name}:BOOL=(.+)$`, 'm'))?.[1] ?? null;
  if (readFlag('BUILD_TESTING') !== (testing ? 'ON' : 'OFF')
      || readFlag('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS') !== (guardDiagnostics ? 'ON' : 'OFF')
      || readFlag('SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS') !== 'OFF'
      || ['STAGE2M', 'STAGE3B', 'STAGE3C', 'STAGE3D', 'STAGE3E', 'TREBLE_HARDNESS'].some(flag => readFlag(`SORAOTO_SUPERSYNTH_${flag}_DIAGNOSTICS`) !== 'OFF'))
    throw new Error('BLOCKED_PHYSICAL_P2_BUILD_FLAGS');
  const wasm = wasmPath(buildDir);
  if (!fs.existsSync(wasm)) throw new Error(`BLOCKED_PHYSICAL_P2_WASM_MISSING: ${wasm}`);
  const exports = assertNoDiagnosticExports(wasm);
  const exportCheck = stage3.assertProductionExports(ROOT, {builds: {production: {buildDirectory: path.relative(ROOT, buildDir), wasm: {path: WASM_REL}}}});
  if (!core.same(exports, exportCheck)) throw new Error('BLOCKED_PHYSICAL_P2_EXPORT_IDENTITY');
  if (!testing && exports.some(name => /soraoto_supersynth_(guard_hit_count|active_voice_count|stage[23]|treble_hardness|physical_identification)/.test(name)))
    throw new Error('BLOCKED_PHYSICAL_P2_RELEASE_DIAGNOSTIC_EXPORT');
  return {buildDirectory: path.relative(ROOT, buildDir), cmakeCacheSha256: fileSha(path.join(buildDir, 'CMakeCache.txt')),
    wasmSha256: fileSha(wasm), wasmBytes: fs.statSync(wasm).size, exports};
}
function recordRegressions(roots, build) {
  const testInputs = Object.fromEntries(Object.entries(stage3.REGRESSION_TESTS).map(([name, relative]) => [name, fileSha(path.join(ROOT, relative))]));
  const input = {issue: core.ISSUE, epoch: core.EPOCH, productionWasmSha256: build.wasmSha256, testInputs};
  const inputDigest = core.sha256(core.jsonBytes(input));
  let record = core.readJson(roots, REGRESSION_REL, false);
  if (record) {
    if (record.inputDigest !== inputDigest || !core.same(record.input, input)) throw new Error('BLOCKED_PHYSICAL_P2_REGRESSION_IDENTITY_DRIFT');
  } else {
    const results = {};
    for (const [name, relative] of Object.entries(stage3.REGRESSION_TESTS)) {
      const run = runRtk(['node', '--test', relative], `p2-regression-${name}`, {
        env: {...process.env, SORAOTO_WASM_BUILD_DIR: path.join(ROOT, build.buildDirectory)}, allowFailure: true});
      results[name] = {result: run.status === 0 ? 'PASS' : 'FAIL', exitCode: run.status,
        outputSha256: core.sha256(Buffer.from(`${run.stdout}\n--stderr--\n${run.stderr}`))};
    }
    record = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, input, inputDigest, results};
    writeImmutableRecord(roots, REGRESSION_REL, record);
  }
  const failed = Object.entries(record.results || {}).filter(([, value]) => value.result !== 'PASS').map(([name]) => name);
  if (failed.length || Object.keys(record.results || {}).length !== Object.keys(stage3.REGRESSION_TESTS).length)
    throw new Error(`BLOCKED_PHYSICAL_P2_REQUIRED_REGRESSIONS: ${failed.join(',') || 'coverage'}`);
  return {record, sha256: core.readDual(roots, REGRESSION_REL).sha256};
}
function recordCtest(roots, build) {
  const input = {issue: core.ISSUE, epoch: core.EPOCH, productionWasmSha256: build.wasmSha256, cmakeCacheSha256: build.cmakeCacheSha256};
  const inputDigest = core.sha256(core.jsonBytes(input));
  let record = core.readJson(roots, CTEST_REL, false);
  if (record) {
    if (record.inputDigest !== inputDigest || !core.same(record.input, input)) throw new Error('BLOCKED_PHYSICAL_CTEST_IDENTITY_DRIFT');
  } else {
    const run = runRtk(['ctest', '--test-dir', path.join(ROOT, build.buildDirectory), '--output-on-failure'],
      'p2-full-ctest', {env: {...process.env, SORAOTO_WASM_BUILD_DIR: path.join(ROOT, build.buildDirectory)}, allowFailure: true});
    const result = {decision: run.status === 0 ? 'PASS' : 'FAIL', exitCode: run.status,
      outputSha256: core.sha256(Buffer.from(`${run.stdout}\n--stderr--\n${run.stderr}`))};
    record = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, input, inputDigest, result};
    writeImmutableRecord(roots, CTEST_REL, record);
  }
  if (record.result?.decision !== 'PASS') throw new Error('BLOCKED_PHYSICAL_P2_CTEST_FAIL');
  return {record, sha256: core.readDual(roots, CTEST_REL).sha256};
}
function ensureProductionP2(roots, p1) {
  const p2Stored = core.readJson(roots, P2_REL, false);
  if (p2Stored) {
    const wasm = path.join(ROOT, p2Stored.builds.productionTest.buildDirectory, WASM_REL);
    if (fileSha(wasm) !== p2Stored.builds.productionTest.wasmSha256
        || git(['rev-parse', 'HEAD']) !== p2Stored.promotion.commit) throw new Error('BLOCKED_PHYSICAL_P2_IDENTITY_DRIFT');
    if (core.readJson(roots, REGRESSION_REL, true).results && core.readJson(roots, CTEST_REL, true).result?.decision === 'PASS')
      return {record: p2Stored, sha256: core.readDual(roots, P2_REL).sha256};
    throw new Error('BLOCKED_PHYSICAL_P2_ACCEPTANCE_RECORDS');
  }
  const promotion = promoteCandidate(roots, p1);
  const p1Acceptance = promotion.selected || core.readJson(roots, 'candidate/physical-fit-P1-accepted.json', true);
  const priorProfile = profileValues();
  if (priorProfile.some((value, index) => Math.abs(value - promotion.receipt.values[index]) > Math.max(1e-8, Math.abs(value) * 1e-7)))
    throw new Error('BLOCKED_PHYSICAL_P2_PROFILE_READBACK');
  const productionTest = buildP2Configuration(P2_TEST_BUILD_DIR, {testing: true, guardDiagnostics: true});
  const productionRelease = buildP2Configuration(P2_RELEASE_BUILD_DIR, {testing: false, guardDiagnostics: false});
  const regressions = recordRegressions(roots, productionTest), ctest = recordCtest(roots, productionTest);
  const identity = {p1Sha256: core.readDual(roots, P1_REL).sha256, p1AcceptanceSha256: promotion.acceptedSha || core.readDual(roots, 'candidate/physical-fit-P1-accepted.json').sha256,
    promotionReceiptSha256: promotion.receiptSha256, promotionCommit: promotion.receipt.commit, values: promotion.receipt.values,
    sourceHead: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']),
    presetsSha256: fileSha(path.join(ROOT, 'wasm/plugins/dsp/super-synth/presets.json')),
    generatedProfileSha256: fileSha(path.join(ROOT, 'wasm/shared/generated/super-synth_grand_profiles.h')),
    productionTest, productionRelease, regressionResultsSha256: regressions.sha256, ctestResultsSha256: ctest.sha256,
    sourceFiles: Object.fromEntries(SOURCE_FILES.map(relative => [relative, fileSha(path.join(ROOT, relative))]))};
  const record = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, lineage: core.LINEAGE.production,
    p1Acceptance, promotion: promotion.receipt, builds: {productionTest, productionRelease}, regressions: regressions.record,
    ctest: ctest.record, identity, identitySha256: core.sha256(core.jsonBytes(identity))};
  const stored = writeImmutableRecord(roots, P2_REL, record);
  core.appendJournal(roots, {eventId: 'runtime:physical-fit-P2', type: 'runtime-revision', lineage: core.LINEAGE.production,
    sha256: stored.sha256, at: stored.record.createdAt});
  return stored;
}
function stage3IdentityForP2(roots, p2) {
  return {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, stage: 'stage3', lineage: core.LINEAGE.production,
    p2Sha256: core.readDual(roots, P2_REL).sha256, p1Sha256: p2.identity.p1Sha256, promotionCommit: p2.promotion.commit,
    productionWasmSha256: p2.builds.productionTest.wasmSha256, regressionResultsSha256: p2.identity.regressionResultsSha256,
    runnerSha256: fileSha(path.join(ROOT, 'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs')),
    evaluatorSha256: fileSha(path.join(ROOT, 'wasm/plugins/dsp/super-synth/test/tools/run-stage3-production-recovery.cjs'))};
}
function runStage3(roots, p2, ownerId) {
  const identity = stage3IdentityForP2(roots, p2), cells = stage3.cells();
  if (cells.length !== core.STAGES.stage3) throw new Error('BLOCKED_PHYSICAL_STAGE3_CELL_COUNT');
  const buildRecord = {builds: {production: {buildDirectory: p2.builds.productionTest.buildDirectory,
    wasm: {path: WASM_REL, sha256: p2.builds.productionTest.wasmSha256}}}};
  const executed = executePlan(roots, 'stage3', identity, cells,
    cell => ({row: stage3.renderDefault({root: ROOT, record: buildRecord, cell})}), {ownerId});
  const rows = executed.rows.map(item => item.row);
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'), 'utf8'));
  const regression = core.readJson(roots, REGRESSION_REL, true);
  const evaluation = stage3.evaluate(rows, fixture, regression.results);
  const finalized = finalizePhase(roots, executed.plan, executed.ledger, evaluation.decision, evaluation);
  if (evaluation.decision !== 'STAGE3_READY_FOR_STAGE4') throw new Error(`BLOCKED_PHYSICAL_STAGE3_FAIL: ${evaluation.decision}`);
  return {decision: evaluation.decision, resultSha256: finalized.sha256, identity, evaluation,
    rows, calls: executed.plan.cells.length};
}
function stage4LegacyRoots() {
  const commonDirectory = path.join(STAGE4_LEGACY_ROOT, 'primary'), home = path.join(STAGE4_LEGACY_ROOT, 'secondary');
  fs.mkdirSync(commonDirectory, {recursive: true}); fs.mkdirSync(home, {recursive: true});
  return {primary: commonDirectory, secondary: home, commonDirectory, home};
}
function runStage4(roots, p2, stage3Result, ownerId) {
  if (stage3Result.decision !== 'STAGE3_READY_FOR_STAGE4') throw new Error('BLOCKED_PHYSICAL_STAGE4_REQUIRES_STAGE3_PASS');
  const cells = stage4.cells();
  if (cells.length !== core.STAGES.stage4) throw new Error('BLOCKED_PHYSICAL_STAGE4_CELL_COUNT');
  const stage3State = {resultSha256: stage3Result.resultSha256, identity: stage3Result.identity};
  const identity = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH, stage: 'stage4', lineage: core.LINEAGE.production,
    p2Sha256: core.readDual(roots, P2_REL).sha256, productionWasmSha256: p2.builds.productionTest.wasmSha256,
    stage3ResultSha256: stage3State.resultSha256, stage3Identity: stage3State.identity};
  const buildRecord = {builds: {production: {buildDirectory: p2.builds.productionTest.buildDirectory,
    wasm: {path: WASM_REL, sha256: p2.builds.productionTest.wasmSha256}}}};
  const executed = executePlan(roots, 'stage4', identity, cells, cell => {
    const observed = stage4.renderDefault({root: ROOT, record: buildRecord, cell});
    return {row: {...observed, kind: cell.kind}};
  }, {ownerId});
  const captured = executed.rows.map(item => item.row);
  const matrix = captured.filter(row => row.kind === 'lifecycle'), repeats = captured.filter(row => row.kind === 'repeat');
  const legacyRoots = stage4LegacyRoots();
  const legacyConformance = ({document}) => stage4.safeLegacyConformance({root: ROOT, roots: legacyRoots, document});
  const stage3Rows = stage3Result.rows.map(row => ({pitch: row.pitch, velocity: row.velocity, kind: row.kind, metrics: row.metrics}));
  const evaluation = stage4.evaluate({root: ROOT, roots: legacyRoots, identity, stage3Identity: stage3State,
    matrix, repeats, stage3Rows, legacyConformance});
  const finalized = finalizePhase(roots, executed.plan, executed.ledger, evaluation.decision, evaluation);
  if (evaluation.decision !== 'STAGE4_FULL_RANGE_COMPLETE') throw new Error(`BLOCKED_PHYSICAL_STAGE4_FAIL: ${evaluation.decision}`);
  return {decision: evaluation.decision, resultSha256: finalized.sha256, evaluation, calls: executed.plan.cells.length};
}
function status({home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), phases = state(roots);
  return {decision: 'ISSUE7_PHYSICAL_IDENTIFICATION_V1_STATUS', epoch: core.EPOCH, lineage: core.LINEAGE,
    p1: readRuntime(roots) ? core.readDual(roots, P1_REL).sha256 : null, phases, oldEvidence: verifyOldEvidence(home), builds: 0, renders: 0, writes: 0, acousticRenders: 0};
}
function verify({home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), current = status({home}), candidate = core.readJson(roots, 'candidate/physical-fit-P1-accepted.json', false);
  const terminal = ['stage4', 'stage3', 'headroom', 'holdout', 'candidate', 'finiteDifference', 'baseline']
    .map(stage => [stage, core.readJson(roots, `${stage}/result.json`, false)])
    .find(([, result]) => result?.decision?.startsWith('BLOCKED_')) || null;
  const p2 = core.readJson(roots, P2_REL, false), stage3Result = core.readJson(roots, 'stage3/result.json', false), stage4Result = core.readJson(roots, 'stage4/result.json', false);
  const complete = candidate?.decision === 'PHYSICAL_FIT_P1_ACCEPTANCE_PASS' && p2
    && stage3Result?.decision === 'STAGE3_READY_FOR_STAGE4' && stage4Result?.decision === 'STAGE4_FULL_RANGE_COMPLETE';
  return {...current, decision: terminal ? terminal[1].decision : complete ? 'ISSUE7_PHYSICAL_IDENTIFICATION_V1_COMPLETE'
      : candidate?.decision === 'PHYSICAL_FIT_P1_ACCEPTANCE_PASS' ? 'ISSUE7_PHYSICAL_IDENTIFICATION_V1_PHASE_D_PASS' : 'BLOCKED_PHYSICAL_IDENTIFICATION_INCOMPLETE',
    candidateSha256: candidate ? core.readDual(roots, 'candidate/physical-fit-P1-accepted.json').sha256 : null,
    p2Sha256: p2 ? core.readDual(roots, P2_REL).sha256 : null,
    stage3Sha256: stage3Result ? core.readDual(roots, 'stage3/result.json').sha256 : null,
    stage4Sha256: stage4Result ? core.readDual(roots, 'stage4/result.json').sha256 : null};
}
function dryRun({home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), current = state(roots);
  const phaseD = core.readJson(roots, 'candidate/physical-fit-P1-accepted.json', false);
  let next = !readRuntime(roots) ? 'build diagnostic binary and record physical-fit-P1' : 'read Salamander reference files and record fixed 25-cell corpus';
  if (readRuntime(roots)) {
    if (!current.phases.baseline || current.phases.baseline.counts.COMPLETE !== 7) next = 'render 7 P1 baseline cells';
    else if (!current.phases.finiteDifference || current.phases.finiteDifference.counts.COMPLETE !== 42) next = 'render 42 centered finite-difference cells';
    else if (!current.phases.candidate || current.phases.candidate.counts.COMPLETE !== current.phases.candidate.authorizedCellCount) next = 'render up to 49 bounded candidate cells';
    else if (!current.phases.holdout || current.phases.holdout.counts.COMPLETE !== 25) next = 'render 25 fixed held-out cells';
    else if (!current.phases.headroom || current.phases.headroom.counts.COMPLETE !== 4) next = 'render 4 fixed headroom/RT calls';
    else if (phaseD) next = 'promote physical-fit-P2 after acceptance record';
  }
  return {decision: phaseD ? 'ISSUE7_PHYSICAL_IDENTIFICATION_V1_DRY_RUN_P2_READY' : 'ISSUE7_PHYSICAL_IDENTIFICATION_V1_DRY_RUN', next, phases: current.phases, calls: current.budget, builds: 0, renders: 0, writes: 0, acousticRenders: 0};
}
async function runAll({home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), lock = core.lockWriter(roots, `run-all-${process.pid}`);
  try {
    const oldEvidence = verifyOldEvidence(home);
    const reference = await ensureReference(roots);
    const priorP1 = readRuntime(roots), promotionIntent = core.readJson(roots, PROMOTION_INTENT_REL, false);
    const p1 = priorP1 && promotionIntent ? priorP1 : ensureDiagnosticBuild(roots, reference.record);
    const ownerId = lock.ownerId;
    const phaseB = ensurePhaseB(roots, p1, reference, ownerId);
    const phaseC = ensurePhaseC(roots, p1, reference, phaseB, ownerId);
    const phaseD = ensurePhaseD(roots, p1, reference, phaseB, phaseC, ownerId);
    const p2Stored = ensureProductionP2(roots, p1), p2 = p2Stored.record;
    const phase3 = runStage3(roots, p2, ownerId);
    const phase4 = runStage4(roots, p2, phase3, ownerId);
    return {decision: 'ISSUE7_PHYSICAL_IDENTIFICATION_V1_COMPLETE', lineage: core.LINEAGE.production, p1Sha256: core.readDual(roots, P1_REL).sha256,
      oldEvidence, phaseB: {sensitivityRank: phaseB.summary.sensitivityRank, calls: 49, baselineResultSha256: phaseB.baselineResult.sha256, finiteDifferenceResultSha256: phaseB.differenceResult.sha256},
      phaseC: {selectedValues: phaseC.selected.values, selectedCandidate: phaseC.selected.candidate, resultSha256: core.readDual(roots, 'candidate/result.json').sha256},
      phaseD, p2Sha256: p2Stored.sha256, productionBuilds: p2.builds, regressionResultsSha256: p2.identity.regressionResultsSha256,
      ctestResultsSha256: p2.identity.ctestResultsSha256,
      phase3: {decision: phase3.decision, resultSha256: phase3.resultSha256, calls: phase3.calls, coverage: phase3.evaluation.coverage},
      phase4: {decision: phase4.decision, resultSha256: phase4.resultSha256, calls: phase4.calls, coverage: phase4.evaluation.coverage},
      budget: core.assertBudget(allLedgers(roots)), builds: 3, acousticRenders: core.totalCharged(allLedgers(roots))};
  } finally { lock.release(); }
}
async function recordP1({home = os.homedir()} = {}) {
  const roots = core.resolveRoots(ROOT, home), lock = core.lockWriter(roots, `record-p1-${process.pid}`);
  try { const reference = await ensureReference(roots); return ensureDiagnosticBuild(roots, reference.record); }
  finally { lock.release(); }
}
async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['--status', '--verify', '--dry-run', '--record-p1', '--run-all'].includes(argv[0])) throw new Error('Usage: run-issue7-physical-identification-v1.cjs --status|--verify|--dry-run|--record-p1|--run-all');
  const mode = argv[0];
  const result = mode === '--status' ? readOnlyProtected(() => status())
    : mode === '--verify' ? readOnlyProtected(() => verify())
    : mode === '--dry-run' ? readOnlyProtected(() => dryRun())
    : mode === '--record-p1' ? await recordP1()
    : await runAll();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (/^BLOCKED_/.test(result?.decision || '')) process.exitCode = 2;
  return result;
}
if (require.main === module) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = /^BLOCKED_/.test(error.message) ? 2 : 1; });
}

module.exports = {ROOT, BASE_HEAD, BRANCH, BUILD_DIR, WASM_REL, P1_REL, REF_REL, SOURCE_FILES, DIAGNOSTIC_EXPORTS,
  git, fileSha, wasmPath, wasmExports, assertDiagnosticExports, assertNoDiagnosticExports, assertCleanTarget,
  configureDiagnosticBuild, sourceIdentity, rootsForReadOnly, readOnlyProtected, allLedgers, readPhase, state,
  verifyOldEvidence, ensureDiagnosticBuild, ensureReference, planStage, finalizePhase, loadRows, evaluateOfficial,
  gateViolation, researchLoss, writeWavFloat32, renderAudio, ensurePhaseB, ensurePhaseC, ensurePhaseD,
  evaluateOfficial, status, verify, dryRun, runAll, recordP1, main};
