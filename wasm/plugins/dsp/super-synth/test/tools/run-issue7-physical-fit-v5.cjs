'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const core = require('./issue7-physical-fit-v5-core.cjs');
const localModel = require('./physical-fit-v5-local-model.cjs');
const v4 = require('./run-issue7-physical-fit-v4.cjs');
const v4core = require('./issue7-physical-fit-v4-core.cjs');
const v3core = require('./issue7-physical-identification-v1-core.cjs');

const ROOT = core.ROOT;
const PR_URL = 'https://github.com/puchinya/soraoto_dsl/pull/8';
const REPOSITORY = 'puchinya/soraoto_dsl';
const CONTRACT = Object.freeze({
  sourceSha256: 'd008ad4d71063d967838a3bef2f36e088a22d3406c18190cbb85cf26a19b6502',
  sourceBytes: 20116,
  v4ContractCommentId: 6243950617,
  v4ContractSha256: 'ca3542c678e35cffa4766d2bd056febc3e2cff5e0ee2ff2dc964ce307c10567f',
  v3TerminalSha256: '71f72e01945c13942802c1e34dd9bc908aa441ac8f0a840bf223a1ea4e9e5908',
  p3RecordSha256: '637a6074874e34fa389c2190ee07e703e399da04a381f7e0b44d8fb2f29d9761',
  p3ResultSha256: '67aa6f2ea5cc37903a8961cd221be894d30a3ac6a751847da0b620dda56d5d49',
  p3SourceManifestSha256: 'add747ce3d8ae57ecae2705c67fdac8d771f0d97c8cf1a3aca7c91b0968fc329',
  archiveSha256: 'b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b',
  diagnosticWasmSha256: '1028c5a77b533ba97066d116f77aab80e5e91b45ef043394875614ee3efab99a',
  knownShapeErrorDb: 10.205353
});
const P5_REL = 'runtime-revisions/physical-fit-P5.json';
const DIAGNOSTICS_REL = 'p5/read-only-diagnostics.json';
const HISTORY_REL = 'p5/observed-history.json';
const TERMINAL_REL = 'p5/terminal-result.json';

function git(args) {
  return execFileSync('rtk', ['git', ...args], {cwd: ROOT, encoding: 'utf8'}).trim();
}
function gh(args) {
  return execFileSync('rtk', ['gh', ...args], {cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}).trim();
}
function hashMap(paths) { return Object.fromEntries(paths.map(relative => [relative, v4.fileSha(relative, ROOT)])); }
function assertTrackedTreeClean() {
  const changed = git(['status', '--porcelain', '--untracked-files=no']);
  if (changed) throw new Error('BLOCKED_V5_TRACKED_WORKTREE_DIRTY');
}
function metricRows(score) {
  return score.official.cells.map(cell => ({pitch: cell.pitch, velocity: cell.velocity,
    earlyResidualDb: cell.earlyResidualDb, lateResidualDb: cell.lateResidualDb,
    postAttackShapeErrorDb: cell.postAttackShapeErrorDb, dominantResidual: cell.dominantResidual,
    hardFailures: cell.hardFailures, finite: cell.finite, guardHits: cell.guardHits, peakDbfs: cell.peakDbfs}));
}
function observationReceipt(score) {
  return {id: score.id, source: score.source, sourceSha256: score.sourceSha256 || null,
    values: score.values, valuesSha256: core.sha256(core.jsonBytes(score.values)),
    officialViolation: score.violation, familyLoss: score.loss, pass: score.pass,
    metrics: metricRows(score), rows: score.rows};
}
function checkV3Rows(old) {
  const checks = [];
  for (const stage of ['baseline', 'candidate']) for (const row of old.rows[stage]) {
    const metadata = v3core.readDual(old.roots, row.metadataRel), audio = v3core.readDual(old.roots, row.artifactRel);
    if (!metadata || metadata.sha256 !== row.metadataSha256 || !audio || audio.sha256 !== row.artifactSha256) {
      throw new Error(`BLOCKED_V5_V3_CELL_IDENTITY: ${stage}:${row.cell.pitch}/${row.cell.velocity}`);
    }
    const parsed = JSON.parse(metadata.bytes.toString('utf8'));
    if (!v3core.jsonBytes(parsed).equals(metadata.bytes)) throw new Error(`BLOCKED_V5_V3_METADATA_BYTES: ${row.metadataRel}`);
    checks.push({stage, cell: row.cell, metadataSha256: metadata.sha256, wavSha256: audio.sha256, metadataSize: metadata.size, wavSize: audio.size});
  }
  if (checks.length !== 56) throw new Error(`BLOCKED_V5_V3_OBSERVED_CELL_COUNT: ${checks.length}`);
  return checks;
}
function readV4Scores(roots, optimizer, refs) {
  const candidates = optimizer.rounds.flatMap(round => round.candidates).filter(item => item.score);
  const unique = new Map();
  for (const item of candidates) {
    const score = item.score;
    if (unique.has(score.id)) {
      if (!v4core.same(unique.get(score.id), score)) throw new Error(`BLOCKED_V5_V4_DUPLICATE_SCORE: ${score.id}`);
      continue;
    }
    const rows = [];
    for (const cell of v4core.STRESS_CELLS) {
      const id = `p3-${score.id}-${cell.pitch}-${cell.velocity}`;
      const relative = v4core.callKey(id);
      const metadata = v4core.readDual(roots, `${relative}/result.json`);
      const audio = v4core.readDual(roots, `${relative}/audio.wav`);
      if (!metadata || !audio) throw new Error(`BLOCKED_V5_V4_CELL_MISSING: ${id}`);
      const result = JSON.parse(metadata.bytes.toString('utf8'));
      if (!v4core.jsonBytes(result).equals(metadata.bytes)) throw new Error(`BLOCKED_V5_V4_METADATA_BYTES: ${id}`);
      rows.push({cell, result, resultSha256: metadata.sha256, audio: audio.bytes, audioSha256: audio.sha256, source: 'v4'});
    }
    const fresh = v4.scoreObservation({id: score.id, values: score.values, refs, rows,
      gainDb: optimizer.sharedGainOffsetDb, source: 'v4'});
    if (!v4core.same(fresh, score)) throw new Error(`BLOCKED_V5_V4_RECOMPUTED_SCORE: ${score.id}`);
    unique.set(score.id, fresh);
  }
  const scores = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (scores.length !== 12) throw new Error(`BLOCKED_V5_V4_VECTOR_COUNT: ${scores.length}`);
  return scores;
}
function parentInventory(roots, coreModule) {
  const before = coreModule.snapshots ? coreModule.snapshots(roots)
    : {primary: coreModule.snapshotTree(roots.primary), secondary: coreModule.snapshotTree(roots.secondary)};
  return {before, summary: core.inventorySummary(before.primary, before.secondary)};
}

function readOnlyDiagnosis() {
  const roots3 = v3core.resolveRoots(ROOT), roots4 = v4core.resolveRoots(ROOT);
  const before3 = parentInventory(roots3, v3core), before4 = parentInventory(roots4, v4core);
  const v4Report = v4.verify();
  if (v4Report.decision !== 'BLOCKED_PHYSICAL_FIT_V4_NO_ACCEPTABLE_CANDIDATE'
      || v4Report.p3RecordSha256 !== CONTRACT.p3RecordSha256
      || v4Report.v3TerminalResultSha256 !== CONTRACT.v3TerminalSha256
      || v4Report.calls?.complete !== 84 || v4Report.calls?.ambiguous !== 0 || v4Report.calls?.incomplete !== 0
      || v4Report.renders !== 0 || v4Report.writes !== 0) throw new Error('BLOCKED_V5_V4_PARENT_TERMINAL_IDENTITY');
  const p3Record = v4core.readDual(roots4, v4.P3_REL);
  const p3Result = v4core.readDual(roots4, v4.P3_RESULT_REL);
  if (!p3Record || p3Record.sha256 !== CONTRACT.p3RecordSha256 || !p3Result || p3Result.sha256 !== CONTRACT.p3ResultSha256) {
    throw new Error('BLOCKED_V5_P3_FULL_SHA_MISMATCH');
  }
  const optimizer = JSON.parse(p3Result.bytes.toString('utf8'));
  if (optimizer.decision !== 'BLOCKED_PHYSICAL_FIT_V4_NO_ACCEPTABLE_CANDIDATE'
      || optimizer.archiveSha256 !== CONTRACT.archiveSha256
      || optimizer.sourceManifestSha256 !== CONTRACT.p3SourceManifestSha256
      || optimizer.newVectorsCharged !== 12 || optimizer.newCandidateCalls !== 84) throw new Error('BLOCKED_V5_P3_OPTIMIZER_IDENTITY');

  const old = v4.safeP1Snapshot();
  if (old.terminal.sha256 !== CONTRACT.v3TerminalSha256 || old.archive.sha256 !== CONTRACT.archiveSha256
      || old.runtime.build?.wasmSha256 !== CONTRACT.diagnosticWasmSha256) throw new Error('BLOCKED_V5_V3_PARENT_IDENTITY');
  const v3CellImports = checkV3Rows(old);
  const referenceSet = v4.extractReferenceSet(old.archivePath, v4core.STRESS_CELLS, optimizer.archiveSha256);
  const references = referenceSet.rows;
  const historical = v4.loadHistoricalObservations(old, references, optimizer.sharedGainOffsetDb);
  if (JSON.stringify(optimizer.initialObservationIds) !== JSON.stringify(historical.map(item => item.id))) {
    throw new Error('BLOCKED_V5_V3_OBSERVATION_IDENTITY');
  }
  const v4Scores = readV4Scores(roots4, optimizer, references);
  const observations = [...historical, ...v4Scores];
  if (observations.length !== 20 || new Set(observations.map(item => item.id)).size !== 20
      || observations.reduce((count, item) => count + item.rows.length, 0) !== 140) throw new Error('BLOCKED_V5_OBSERVED_VECTOR_OR_CELL_COUNT');
  const known = observations.find(item => item.id === 'p3-r02-03');
  const knownShapeDb = known && Math.max(...known.official.cells.map(cell => cell.postAttackShapeErrorDb));
  if (!Number.isFinite(knownShapeDb) || Math.abs(knownShapeDb - CONTRACT.knownShapeErrorDb) > 1e-6) {
    throw new Error(`BLOCKED_V5_KNOWN_SHAPE_MISMATCH: ${knownShapeDb}`);
  }
  const diagnostics = localModel.evaluateLocalModel(observations);
  const sources = [...v4.V3_SOURCE_REL, ...v4.V4_SOURCE_REL];
  const sourceHashes = hashMap(sources);
  const after3 = parentInventory(roots3, v3core), after4 = parentInventory(roots4, v4core);
  if (!v4core.same(before3.before, after3.before) || !v4core.same(before4.before, after4.before)) {
    throw new Error('BLOCKED_V5_PARENT_EVIDENCE_MTIME_CHANGED_DURING_READ');
  }
  if (!before3.summary.contentAndSizeMatch || !before4.summary.contentAndSizeMatch) throw new Error('BLOCKED_V5_PARENT_DUAL_INVENTORY_MISMATCH');
  const v3P1 = v3core.readDual(roots3, 'runtime-revisions/physical-fit-P1.json');
  if (!v3P1) throw new Error('BLOCKED_V5_V3_P1_RECORD_MISSING');
  const history = observations.map(observationReceipt);
  const p3Paths = v4core.dualPaths(roots4, v4.P3_REL);
  const p1Paths = v3core.dualPaths(roots3, 'runtime-revisions/physical-fit-P1.json');
  const stat = file => { const value = fs.statSync(file); return {size: value.size, mtimeMs: value.mtimeMs}; };
  const v3ResidualCells = v3CellImports.length;
  const result = {
    schemaVersion: 1, issue: 7, contractSha256: CONTRACT.sourceSha256, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic,
    decision: diagnostics.decision,
    parent: {head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
      v3P1Sha256: v3P1.sha256, v3TerminalSha256: old.terminal.sha256, p3RecordSha256: p3Record.sha256,
      p3ResultSha256: p3Result.sha256, p3SourceManifestSha256: optimizer.sourceManifestSha256,
      archiveSha256: old.archive.sha256, diagnosticWasmSha256: old.runtime.build.wasmSha256},
    records: {p3Record: {sha256: p3Record.sha256, size: p3Record.size,
      primary: stat(p3Paths.primary), secondary: stat(p3Paths.secondary)},
      v3P1: {sha256: v3P1.sha256, size: v3P1.size, primary: stat(p1Paths.a), secondary: stat(p1Paths.b)},
      optimizer: {sha256: p3Result.sha256, size: p3Result.size, rounds: optimizer.rounds.length,
        newVectorsCharged: optimizer.newVectorsCharged, newCandidateCalls: optimizer.newCandidateCalls}},
    inventory: {v3: before3.summary, v4: before4.summary}, sourceHashes,
    observations: history, v3RowsVerified: v3ResidualCells, v4RowsVerified: 84,
    knownShape: {id: known.id, computedDb: knownShapeDb, reportedDb: CONTRACT.knownShapeErrorDb,
      absoluteDifferenceDb: Math.abs(knownShapeDb - CONTRACT.knownShapeErrorDb)},
    model: {bestId: diagnostics.best.id, bestValues: diagnostics.best.values, bestViolation: diagnostics.best.violation,
      bestLoss: diagnostics.best.loss, nearestIds: diagnostics.nearest.map(item => item.id), rank: diagnostics.rank,
      conditionNumber: diagnostics.conditionNumber, singularValues: diagnostics.singularValues,
      looErrorDb: diagnostics.looErrorDb, candidateCount: diagnostics.candidates.length,
      candidates: diagnostics.candidates, blockedReason: diagnostics.decision},
    work: {builds: 0, renders: 0, newAcousticCalls: 0, evidenceWrites: 0,
      v3AndV4InventoryMtimesUnchanged: true}
  };
  return {roots: roots4, roots3, report: result, history, diagnostics, references, optimizer};
}

function remoteReadback(expectedHead = git(['rev-parse', 'HEAD'])) {
  assertTrackedTreeClean();
  const branch = git(['branch', '--show-current']);
  const pr = JSON.parse(gh(['pr', 'view', '8', '--repo', REPOSITORY, '--json', 'state,url,headRefName,headRefOid,baseRefName']));
  if (pr.state !== 'OPEN' || pr.headRefName !== branch || pr.headRefOid !== expectedHead) throw new Error('BLOCKED_V5_PR_HEAD_READBACK');
  const remote = JSON.parse(gh(['api', `repos/${REPOSITORY}/commits/${expectedHead}`]));
  const tree = git(['rev-parse', `${expectedHead}^{tree}`]), parent = git(['rev-parse', `${expectedHead}^`]);
  if (remote.sha !== expectedHead || remote.commit?.tree?.sha !== tree
      || !remote.parents?.some(item => item.sha === parent)) throw new Error('BLOCKED_V5_REMOTE_COMMIT_READBACK');
  return {pullRequest: pr.url, state: pr.state, branch, head: expectedHead, parent, tree};
}

function preparedPayload(roots) {
  const runtime = core.readDual(roots, P5_REL), diagnostics = core.readDual(roots, DIAGNOSTICS_REL), history = core.readDual(roots, HISTORY_REL);
  if (!runtime || !diagnostics || !history) throw new Error('BLOCKED_V5_P5_RECORD_MISSING');
  const record = JSON.parse(runtime.bytes.toString('utf8'));
  if (record.diagnosticsSha256 !== diagnostics.sha256 || record.historySha256 !== history.sha256) throw new Error('BLOCKED_V5_P5_RECORD_DIGEST_MISMATCH');
  const diagnosticReport = JSON.parse(diagnostics.bytes.toString('utf8'));
  if (diagnosticReport.p3RecordSha256 !== CONTRACT.p3RecordSha256 || diagnosticReport.contractSha256 !== CONTRACT.sourceSha256) {
    throw new Error('BLOCKED_V5_P5_PARENT_BINDING_MISMATCH');
  }
  return {record, diagnosticReport, runtimeSha256: runtime.sha256, diagnosticsSha256: diagnostics.sha256, historySha256: history.sha256};
}

function verifyPrepared({verifyRemote = true} = {}) {
  const roots = core.resolveRoots(ROOT), prepared = preparedPayload(roots);
  const head = git(['rev-parse', 'HEAD']);
  if (head !== prepared.record.commitSha || core.EPOCH !== prepared.record.epoch) throw new Error('BLOCKED_V5_CURRENT_HEAD_MISMATCH');
  if (verifyRemote) {
    const remote = remoteReadback(head);
    if (!core.same(remote, prepared.record.remoteReadback)) throw new Error('BLOCKED_V5_REMOTE_IDENTITY_CHANGED');
  }
  const currentSources = hashMap(Object.keys(prepared.record.sourceHashes));
  if (!core.same(currentSources, prepared.record.sourceHashes)) throw new Error('BLOCKED_V5_SOURCE_SHA_MISMATCH');
  const roots3 = v3core.resolveRoots(ROOT), roots4 = v4core.resolveRoots(ROOT);
  const inv3 = core.inventorySummary(v3core.snapshotTree(roots3.primary), v3core.snapshotTree(roots3.secondary));
  const inv4 = core.inventorySummary(v4core.snapshotTree(roots4.primary), v4core.snapshotTree(roots4.secondary));
  if (!core.same(inv3, prepared.record.parentInventory.v3) || !core.same(inv4, prepared.record.parentInventory.v4)) {
    throw new Error('BLOCKED_V5_PARENT_INVENTORY_CHANGED');
  }
  const p3 = v4core.readDual(roots4, v4.P3_REL);
  if (!p3 || p3.sha256 !== CONTRACT.p3RecordSha256) throw new Error('BLOCKED_V5_P3_FULL_SHA_MISMATCH');
  return {...prepared, roots};
}

function prepareP5() {
  const preflight = readOnlyDiagnosis();
  assertTrackedTreeClean();
  const remote = remoteReadback(preflight.report.parent.head);
  const sourceFiles = [...v4.V3_SOURCE_REL, ...v4.V4_SOURCE_REL,
    'wasm/plugins/dsp/super-synth/test/tools/issue7-physical-fit-v5-core.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/physical-fit-v5-local-model.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5.test.cjs',
    'docs/specs/plugins/dsp/super-synth/physical-fit-v5-amendment.md',
    'docs/design/plugins/dsp/super-synth/physical-fit-v5-design.md'];
  const sourceHashes = hashMap(sourceFiles);
  const history = {schemaVersion: 1, issue: 7, epoch: core.EPOCH, p3RecordSha256: CONTRACT.p3RecordSha256,
    v3TerminalSha256: CONTRACT.v3TerminalSha256, observations: preflight.history};
  const historyBytes = core.jsonBytes(history), historySha256 = core.sha256(historyBytes);
  const diagnostics = {...preflight.report, p3RecordSha256: CONTRACT.p3RecordSha256,
    historySha256, model: {...preflight.report.model, candidates: preflight.diagnostics.candidates}};
  const diagnosticsBytes = core.jsonBytes(diagnostics), diagnosticsSha256 = core.sha256(diagnosticsBytes);
  const roots = preflight.roots;
  core.writeImmutableDual(roots, HISTORY_REL, historyBytes);
  core.writeImmutableDual(roots, DIAGNOSTICS_REL, diagnosticsBytes);
  const record = {schemaVersion: 1, issue: 7, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic,
    contractSha256: CONTRACT.sourceSha256, contractBytes: CONTRACT.sourceBytes,
    commitSha: remote.head, commitParent: remote.parent, commitTree: remote.tree, branch: remote.branch,
    pullRequest: remote.pullRequest, p3RecordSha256: CONTRACT.p3RecordSha256,
    v3TerminalSha256: CONTRACT.v3TerminalSha256, p3ResultSha256: CONTRACT.p3ResultSha256,
    sourceHashes, parentInventory: {v3: preflight.report.inventory.v3, v4: preflight.report.inventory.v4},
    historySha256, diagnosticsSha256, decision: preflight.report.decision,
    candidateCount: preflight.diagnostics.candidates.length, acousticCallsAuthorized: 42};
  const stored = core.writeJsonImmutableDual(roots, P5_REL, record);
  return {decision: preflight.report.decision, prepared: true, p5RecordSha256: stored.sha256,
    diagnosticsSha256, historySha256, candidateCount: preflight.diagnostics.candidates.length,
    calls: {started: 0, complete: 0, ambiguous: 0, cumulative: core.HISTORICAL_CALLS, cap: core.MAX_CALLS},
    builds: 0, renders: 0, writes: 3};
}

function terminalResult(prepared) {
  const diagnostic = prepared.diagnosticReport;
  const counts = core.callCounts(prepared.roots);
  if (counts.started !== 0 || counts.ambiguous !== 0 || diagnostic.work?.newAcousticCalls !== 0) {
    throw new Error('BLOCKED_V5_UNEXPECTED_PRIOR_CALLS');
  }
  if (diagnostic.model?.candidateCount !== 0 || diagnostic.decision !== 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT') {
    throw new Error('BLOCKED_V5_PREFLIGHT_OUTCOME_CHANGED');
  }
  return {schemaVersion: 1, issue: 7, epoch: core.EPOCH, lineage: core.LINEAGE.diagnostic,
    decision: 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT', p5RecordSha256: prepared.runtimeSha256,
    diagnosticsSha256: prepared.diagnosticsSha256, p3RecordSha256: CONTRACT.p3RecordSha256,
    model: {bestId: diagnostic.model.bestId, bestValues: diagnostic.model.bestValues,
      rank: diagnostic.model.rank, conditionNumber: diagnostic.model.conditionNumber,
      looErrorDb: diagnostic.model.looErrorDb, candidateCount: 0},
    phases: {p5: 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT', confirmation: 'NOT RUN', headroom: 'NOT RUN',
      promotion: 'NOT RUN', releaseEquivalence: 'NOT RUN', stage3: 'NOT RUN', stage4: 'NOT RUN'},
    calls: {started: counts.started, complete: counts.complete, ambiguous: counts.ambiguous,
      incomplete: counts.incomplete, cumulative: counts.cumulative, cap: counts.cap, remaining: counts.remaining,
      byAllocation: counts.byStage},
    builds: 0, renders: 0, writes: 1,
    next: 'No candidate satisfied U<=9.95 dB and the local-support constraint; stop before acoustic calls.'};
}

function runAll() {
  const prepared = verifyPrepared();
  const roots = prepared.roots, ownerId = crypto.randomUUID();
  core.acquireLock(roots, ownerId);
  try {
    const existing = core.readDual(roots, TERMINAL_REL);
    if (existing) {
      const result = JSON.parse(existing.bytes.toString('utf8'));
      if (result.decision !== 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT') throw new Error('BLOCKED_V5_TERMINAL_RESULT_CONFLICT');
      return {...result, writes: 0};
    }
    const result = terminalResult(prepared);
    const stored = core.writeJsonImmutableDual(roots, TERMINAL_REL, result);
    return {...result, terminalResultSha256: stored.sha256};
  } finally { core.releaseLock(roots, ownerId); }
}

function status() {
  const roots = core.resolveRoots(ROOT), runtime = core.readDual(roots, P5_REL), terminal = core.readDual(roots, TERMINAL_REL);
  const counts = core.callCounts(roots);
  if (!runtime) return {decision: 'V5_NOT_PREPARED', epoch: core.EPOCH, calls: counts, builds: 0, renders: 0, writes: 0};
  const prepared = verifyPrepared();
  return {decision: terminal ? JSON.parse(terminal.bytes.toString('utf8')).decision : prepared.record.decision,
    epoch: core.EPOCH, p5RecordSha256: prepared.runtimeSha256, diagnosticsSha256: prepared.diagnosticsSha256,
    terminalResultSha256: terminal?.sha256 || null, model: prepared.diagnosticReport.model,
    calls: counts, builds: 0, renders: 0, writes: 0};
}
function verify() {
  const roots = core.resolveRoots(ROOT), runtime = core.readDual(roots, P5_REL);
  if (!runtime) {
    const result = readOnlyDiagnosis().report;
    return {...result, decision: 'BLOCKED_V5_P5_RECORD_MISSING', writes: 0};
  }
  const prepared = verifyPrepared();
  const terminal = core.readDual(roots, TERMINAL_REL);
  if (terminal) {
    const result = JSON.parse(terminal.bytes.toString('utf8'));
    if (result.p5RecordSha256 !== prepared.runtimeSha256 || result.diagnosticsSha256 !== prepared.diagnosticsSha256) {
      throw new Error('BLOCKED_V5_TERMINAL_RESULT_IDENTITY');
    }
    return {...result, terminalResultSha256: terminal.sha256, writes: 0};
  }
  return {decision: prepared.record.decision, p5RecordSha256: prepared.runtimeSha256,
    diagnosticsSha256: prepared.diagnosticsSha256, model: prepared.diagnosticReport.model,
    calls: core.callCounts(roots), builds: 0, renders: 0, writes: 0};
}
function dryRun() {
  const result = readOnlyDiagnosis().report;
  return {...result, dryRun: true, builds: 0, renders: 0, writes: 0};
}

function parseMode(argv) {
  if (argv.length !== 1) throw new Error('select exactly one mode: --status, --verify, --dry-run, --prepare-p5, or --run-all');
  const modes = {'--status': status, '--verify': verify, '--dry-run': dryRun, '--prepare-p5': prepareP5, '--run-all': runAll};
  const action = modes[argv[0]];
  if (!action) throw new Error(`unknown mode: ${argv[0]}`);
  return action;
}
function run(argv = process.argv.slice(2)) { return parseMode(argv)(); }
function main() {
  const result = run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (/^BLOCKED_/.test(result.decision || '')) process.exitCode = 2;
  return result;
}
if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = /^BLOCKED_/.test(error.message) ? 2 : 1;
  }
}

module.exports = {ROOT, PR_URL, CONTRACT, P5_REL, DIAGNOSTICS_REL, HISTORY_REL, TERMINAL_REL,
  readOnlyDiagnosis, remoteReadback, preparedPayload, verifyPrepared, prepareP5, terminalResult, runAll,
  status, verify, dryRun, parseMode, run, main};
