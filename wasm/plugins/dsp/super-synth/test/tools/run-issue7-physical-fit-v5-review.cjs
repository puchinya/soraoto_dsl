#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../../../../');
const REVIEW_DIR = 'wasm/plugins/dsp/super-synth/test/tools';
const NEW_SOURCE_REL = Object.freeze([
  `${REVIEW_DIR}/physical-fit-v5-review-audit.cjs`,
  `${REVIEW_DIR}/issue7-physical-fit-v5-review-core.cjs`,
  `${REVIEW_DIR}/run-issue7-physical-fit-v5-review.cjs`,
  `${REVIEW_DIR}/run-issue7-physical-fit-v5-review.test.cjs`,
  'docs/specs/plugins/dsp/super-synth/physical-fit-v5-review-02-amendment.md',
  'docs/design/plugins/dsp/super-synth/physical-fit-v5-review-02-design.md'
]);
const REVISION_REL = 'runtime-revisions/v5-review-02.json';
const AUDIT_REL = 'reports/p5-audit.json';
const TERMINAL_REL = 'p5/terminal-result.json';
const REVIEW_DECISION = 'PHYSICAL_FIT_V5_REVIEW_PREPARED';
const P5_BLOCKED = 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT';
const PREVIOUS_EPOCH = 'current-build-v5-review/continuation-01';
const PREVIOUS_CONTRACT_SHA256 = '951a0bad7fb12b92f9aa103e0caef8e0d689b13e61eda72640ee68376399c105';
const PCM_TOLERANCE = 1e-6;
const HISTORY_CALLS = 3251;
const CALL_CAP = 5255;
const CONFIRMATION_PITCHES = Object.freeze([90, 93, 96, 99, 102]);
const CONFIRMATION_VELOCITIES = Object.freeze([14, 31, 36, 61, 124]);

const core = require('./issue7-physical-fit-v5-review-core.cjs');
const audit = require('./physical-fit-v5-review-audit.cjs');
const model = require('./physical-fit-v5-local-model.cjs');
const oldP5 = require('./run-issue7-physical-fit-v5.cjs');
const oldV4 = require('./run-issue7-physical-fit-v4.cjs');
const oldV5Core = require('./issue7-physical-fit-v5-core.cjs');
const v3Core = require('./issue7-physical-identification-v1-core.cjs');
const v4Core = require('./issue7-physical-fit-v4-core.cjs');
const directMetrics = require('./stage3-direct-reference-metrics.cjs');
const stage3 = require('./run-issue7-stage3-current-build.cjs');
const stage4 = require('./run-issue7-stage4-current-build.cjs');
const stage4Capture = require('./capture-supersynth-stage4-lifecycle.cjs');

function git(args, root = ROOT) {
  return execFileSync('rtk', ['git', ...args], {cwd: root, encoding: 'utf8'}).trim();
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function hashFile(file) { return core.sha256(fs.readFileSync(file)); }
function sourceHashMap(files, root = ROOT) {
  return Object.fromEntries([...new Set(files)].sort().map(relative => [relative, hashFile(path.join(root, relative))]));
}
function assertReviewSourcesCommitted(root = ROOT, head = git(['rev-parse', 'HEAD'], root)) {
  for (const relative of NEW_SOURCE_REL) {
    try {
      execFileSync('rtk', ['git', 'ls-files', '--error-unmatch', relative], {cwd: root, stdio: 'ignore'});
      execFileSync('rtk', ['git', 'diff', '--quiet', head, '--', relative], {cwd: root, stdio: 'ignore'});
    } catch {
      throw new Error(`BLOCKED_REVIEW_SOURCE_NOT_COMMITTED_AT_HEAD: ${relative}`);
    }
  }
  return true;
}
function same(left, right) { return core.same(left, right); }
function canonicalSame(left, right) {
  try { return core.canonicalBytes(left).equals(core.canonicalBytes(right)); }
  catch { return false; }
}
function isAncestor(ancestor, descendant, root = ROOT) {
  try {
    execFileSync('rtk', ['git', 'merge-base', '--is-ancestor', ancestor, descendant], {cwd: root, stdio: 'ignore'});
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw new Error(`BLOCKED_REVIEW_GIT_ANCESTRY: ${error.message}`);
  }
}
function verifyLineage({root = ROOT, frozenHead = core.FROZEN_P5_HEAD, currentHead = git(['rev-parse', 'HEAD'], root), sourceHashes} = {}) {
  if (!/^[a-f0-9]{40}$/.test(frozenHead) || !/^[a-f0-9]{40}$/.test(currentHead)
      || !isAncestor(frozenHead, currentHead, root)) throw new Error('BLOCKED_REVIEW_NON_DESCENDANT_HEAD');
  if (sourceHashes) {
    const actual = sourceHashMap(Object.keys(sourceHashes), root);
    if (!canonicalSame(actual, sourceHashes)) throw new Error('BLOCKED_REVIEW_FROZEN_SOURCE_SHA_MISMATCH');
  }
  return {frozenHead, currentHead, descendant: true};
}
function getParentSnapshots(root = ROOT) {
  const roots3 = v3Core.resolveRoots(root);
  const roots4 = v4Core.resolveRoots(root);
  const roots5 = oldV5Core.resolveRoots(root);
  const snapshots = {
    v3: {primary: v3Core.snapshotTree(roots3.primary), secondary: v3Core.snapshotTree(roots3.secondary)},
    v4: {primary: v4Core.snapshotTree(roots4.primary), secondary: v4Core.snapshotTree(roots4.secondary)},
    v5: {primary: oldV5Core.snapshotTree(roots5.primary), secondary: oldV5Core.snapshotTree(roots5.secondary)}
  };
  return {
    roots: {v3: roots3, v4: roots4, v5: roots5},
    snapshots,
    inventory: Object.fromEntries(Object.entries(snapshots).map(([name, value]) =>
      [name, core.inventorySummary(value.primary, value.secondary)]))
  };
}
function transformHistoryObservation(item) {
  if (!Array.isArray(item.metrics) || item.metrics.length !== oldV5Core.STRESS_CELLS.length) {
    throw new Error('BLOCKED_REVIEW_PARENT_HISTORY_SHAPE');
  }
  return {...item, violation: item.officialViolation, loss: item.familyLoss,
    residuals: item.metrics.flatMap(metric => [metric.earlyResidualDb, metric.lateResidualDb])};
}
function compareModelToFrozen(report, frozen) {
  const prior = frozen.model;
  const fields = ['bestId', 'bestValues', 'rank', 'conditionNumber', 'looErrorDb', 'candidateCount'];
  for (const field of fields) {
    if (!same(report.model[field], prior[field])) throw new Error(`BLOCKED_REVIEW_PARENT_MODEL_MISMATCH: ${field}`);
  }
  if (report.model.observationCount !== 20 || report.points.length !== 729 || report.summary.eligibleCount !== 0) {
    throw new Error('BLOCKED_REVIEW_PARENT_AUDIT_SUMMARY_MISMATCH');
  }
}
function verifyFrozenP5Parent({root = ROOT, verifyRemote = false, currentHead} = {}) {
  const roots = oldV5Core.resolveRoots(root);
  const prepared = oldP5.preparedPayload(roots);
  const head = currentHead || git(['rev-parse', 'HEAD'], root);
  if (prepared.record.commitSha !== core.FROZEN_P5_HEAD || prepared.record.epoch !== oldV5Core.EPOCH
      || !isAncestor(core.FROZEN_P5_HEAD, head, root)) throw new Error('BLOCKED_REVIEW_PARENT_LINEAGE');
  if (verifyRemote) {
    const remote = oldP5.remoteReadback(head);
    if (remote.head !== head || remote.state !== 'OPEN') throw new Error('BLOCKED_REVIEW_REMOTE_HEAD_READBACK');
  }
  const hashes = sourceHashMap(Object.keys(prepared.record.sourceHashes), root);
  if (!canonicalSame(hashes, prepared.record.sourceHashes)) throw new Error('BLOCKED_REVIEW_FROZEN_SOURCE_SHA_MISMATCH');

  const parentSnapshots = getParentSnapshots(root);
  if (!same(parentSnapshots.inventory.v3, prepared.record.parentInventory.v3)
      || !same(parentSnapshots.inventory.v4, prepared.record.parentInventory.v4)) {
    throw new Error('BLOCKED_REVIEW_PARENT_INVENTORY_MISMATCH');
  }
  const runtime = oldV5Core.readDual(roots, oldP5.P5_REL);
  const diagnostics = oldV5Core.readDual(roots, oldP5.DIAGNOSTICS_REL);
  const historyFile = oldV5Core.readDual(roots, oldP5.HISTORY_REL);
  const terminal = oldV5Core.readDual(roots, oldP5.TERMINAL_REL);
  if (!runtime || !diagnostics || !historyFile || !terminal
      || runtime.sha256 !== prepared.runtimeSha256 || diagnostics.sha256 !== prepared.diagnosticsSha256
      || terminal.sha256 !== '346a61a21e3c6fb46c97ee45c74616c523f8a180d63a032f30643532e73243ed') {
    throw new Error('BLOCKED_REVIEW_PARENT_RECORD_SHA_MISMATCH');
  }
  const terminalRecord = JSON.parse(terminal.bytes.toString('utf8'));
  if (terminalRecord.decision !== P5_BLOCKED || terminalRecord.p5RecordSha256 !== runtime.sha256
      || terminalRecord.diagnosticsSha256 !== diagnostics.sha256 || terminalRecord.calls?.started !== 0) {
    throw new Error('BLOCKED_REVIEW_PARENT_TERMINAL_MISMATCH');
  }
  const p3 = v4Core.readDual(parentSnapshots.roots.v4, oldV4.P3_REL);
  if (!p3 || p3.sha256 !== oldP5.CONTRACT.p3RecordSha256) throw new Error('BLOCKED_REVIEW_P3_SHA_MISMATCH');

  const history = JSON.parse(historyFile.bytes.toString('utf8'));
  if (!Array.isArray(history.observations) || history.observations.length !== 20) throw new Error('BLOCKED_REVIEW_PARENT_HISTORY_SHAPE');
  const observations = history.observations.map(transformHistoryObservation);
  const report = audit.auditObservations(observations);
  compareModelToFrozen(report, prepared.diagnosticReport);
  if (!same(report.plannerMatch.values, prepared.diagnosticReport.candidates || [])) {
    throw new Error('BLOCKED_REVIEW_FROZEN_PLANNER_MISMATCH');
  }
  const parentV5Summary = parentSnapshots.inventory.v5;
  if (parentV5Summary.fileCount !== 10 || parentV5Summary.bytes !== 624417
      || parentV5Summary.primaryContentSha256 !== '8a05c9a17f53c437af0bc6ceef90609d8db372770900a76cfbe9042b7d815a31'
      || parentV5Summary.secondaryContentSha256 !== parentV5Summary.primaryContentSha256) {
    throw new Error('BLOCKED_REVIEW_PARENT_V5_INVENTORY_MISMATCH');
  }
  return {head, roots, prepared, terminal, report, parentSnapshots,
    p5: {runtimeSha256: runtime.sha256, diagnosticsSha256: diagnostics.sha256,
      historySha256: historyFile.sha256, terminalSha256: terminal.sha256}};
}
function auditReport({root = ROOT, verifyRemote = false} = {}) {
  const parent = verifyFrozenP5Parent({root, verifyRemote});
  return {decision: P5_BLOCKED, issue: core.ISSUE, epoch: core.EPOCH,
    fixedParentHead: core.FROZEN_P5_HEAD, currentHead: parent.head,
    contractSha256: core.CONTRACT_SHA256, model: parent.report.model,
    summary: parent.report.summary, best5: parent.report.best5,
    plannerMatch: parent.report.plannerMatch, points: parent.report.points,
    parent: {p5: parent.p5, inventory: parent.parentSnapshots.inventory},
    work: {builds: 0, acousticCalls: 0, renders: 0, writes: 0}};
}
function sourceSet(parent) {
  return [...new Set([...Object.keys(parent.prepared.record.sourceHashes), ...NEW_SOURCE_REL])].sort();
}
function readReviewRevision(roots) {
  const runtimeStored = core.readDual(roots, REVISION_REL);
  const auditStored = core.readDual(roots, AUDIT_REL);
  if (!runtimeStored || !auditStored) throw new Error('BLOCKED_REVIEW_REVISION_MISSING');
  const runtime = JSON.parse(runtimeStored.bytes.toString('utf8'));
  const auditBytes = JSON.parse(auditStored.bytes.toString('utf8'));
  if (runtime.auditSha256 !== auditStored.sha256 || runtime.epoch !== core.EPOCH
      || runtime.revision !== 'v5-review-02'
      || runtime.contractSha256 !== core.CONTRACT_SHA256 || runtime.decision !== REVIEW_DECISION) {
    throw new Error('BLOCKED_REVIEW_REVISION_IDENTITY');
  }
  return {runtime, runtimeSha256: runtimeStored.sha256, audit: auditBytes, auditSha256: auditStored.sha256};
}
function previousReviewIdentity({root = ROOT, home = os.homedir(), commonDirectory, currentHead = git(['rev-parse', 'HEAD'], root)} = {}) {
  const roots = core.resolveRoots(root, home, commonDirectory, PREVIOUS_EPOCH);
  const revisionStored = core.readDual(roots, 'runtime-revisions/v5-review-01.json');
  const auditStored = core.readDual(roots, AUDIT_REL);
  const terminalStored = core.readDual(roots, TERMINAL_REL);
  if (!revisionStored || !auditStored || !terminalStored) throw new Error('BLOCKED_REVIEW_PREDECESSOR_MISSING');
  const revision = JSON.parse(revisionStored.bytes.toString('utf8'));
  const terminal = JSON.parse(terminalStored.bytes.toString('utf8'));
  if (revision.epoch !== PREVIOUS_EPOCH || revision.revision !== 'v5-review-01'
      || revision.contractSha256 !== PREVIOUS_CONTRACT_SHA256 || revision.auditSha256 !== auditStored.sha256
      || revision.fixedParentHead !== core.FROZEN_P5_HEAD || !/^[a-f0-9]{40}$/.test(revision.commitSha)
      || !isAncestor(revision.commitSha, currentHead, root)
      || revision.decision !== REVIEW_DECISION || terminal.revisionSha256 !== revisionStored.sha256
      || terminal.decision !== P5_BLOCKED || terminal.newAcousticCalls !== 0) {
    throw new Error('BLOCKED_REVIEW_PREDECESSOR_IDENTITY');
  }
  return {epoch: PREVIOUS_EPOCH, revisionSha256: revisionStored.sha256,
    auditSha256: auditStored.sha256, terminalSha256: terminalStored.sha256, commitSha: revision.commitSha};
}
function prepareReviewRevision({root = ROOT, home = os.homedir(), commonDirectory, verifyRemote = true} = {}) {
  const parent = verifyFrozenP5Parent({root, verifyRemote});
  if (verifyRemote) assertReviewSourcesCommitted(root, parent.head);
  const roots = core.resolveRoots(root, home, commonDirectory);
  const previousReview = previousReviewIdentity({root, home, commonDirectory, currentHead: parent.head});
  const ownerId = `prepare-review-${crypto.randomUUID()}`;
  const lock = core.acquireLock(roots, ownerId);
  try {
    const existing = core.readDual(roots, REVISION_REL);
    const existingAudit = core.readDual(roots, AUDIT_REL);
    if (existing || existingAudit) {
      if (!existing || !existingAudit) throw new Error('BLOCKED_REVIEW_PARTIAL_REVISION');
      const prepared = readReviewRevision(roots);
      if (prepared.runtime.commitSha !== parent.head || prepared.runtime.parentP5RuntimeSha256 !== parent.p5.runtimeSha256
          || prepared.runtime.auditSha256 !== existingAudit.sha256
          || !same(prepared.runtime.previousReview, previousReview)) throw new Error('BLOCKED_REVIEW_REVISION_CONFLICT');
      return {...prepared, roots, writes: 0, reused: true, parentInventory: parent.parentSnapshots.inventory};
    }
    const sourceHashes = sourceHashMap(sourceSet(parent), root);
    const sourceLineage = verifyLineage({root, frozenHead: core.FROZEN_P5_HEAD, currentHead: parent.head,
      sourceHashes: Object.fromEntries(Object.entries(sourceHashes).filter(([file]) =>
        Object.hasOwn(parent.prepared.record.sourceHashes, file)))});
    const report = auditReport({root, verifyRemote: false});
    const reportBytes = core.jsonBytes(report);
    const reportWrite = core.writeImmutableDual(roots, AUDIT_REL, reportBytes);
    const revision = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH,
      revision: 'v5-review-02', contractSha256: core.CONTRACT_SHA256,
      fixedParentHead: core.FROZEN_P5_HEAD, fixedParentCommitSha: core.FROZEN_P5_HEAD,
      fixedParentParentSha: git(['rev-parse', `${core.FROZEN_P5_HEAD}^`], root),
      fixedParentTreeSha: git(['rev-parse', `${core.FROZEN_P5_HEAD}^{tree}`], root),
      commitSha: parent.head,
      commitParent: git(['rev-parse', `${parent.head}^`], root), commitTree: git(['rev-parse', `${parent.head}^{tree}`], root),
      parentP5RuntimeSha256: parent.p5.runtimeSha256, parentDiagnosticsSha256: parent.p5.diagnosticsSha256,
      parentHistorySha256: parent.p5.historySha256, parentTerminalSha256: parent.p5.terminalSha256,
      previousReview,
      sourceHashes, auditSha256: reportWrite.sha256, auditSummary: report.summary,
      parentInventory: parent.parentSnapshots.inventory, lineage: sourceLineage,
      acousticCallsAuthorized: 0, buildsAuthorized: 0, decision: REVIEW_DECISION,
      createdAt: new Date().toISOString()};
    const runtimeWrite = core.writeJsonImmutableDual(roots, REVISION_REL, revision);
    const readback = readReviewRevision(roots);
    if (readback.runtimeSha256 !== runtimeWrite.sha256 || readback.auditSha256 !== reportWrite.sha256) {
      throw new Error('BLOCKED_REVIEW_REVISION_READBACK');
    }
    return {...readback, roots, writes: 2, reused: false, parentInventory: parent.parentSnapshots.inventory};
  } finally { core.releaseLock(roots, lock); }
}
function verifyReviewRevision({root = ROOT, home = os.homedir(), commonDirectory, verifyRemote = true} = {}) {
  const parent = verifyFrozenP5Parent({root, verifyRemote});
  if (verifyRemote) assertReviewSourcesCommitted(root, parent.head);
  const roots = core.resolveRoots(root, home, commonDirectory);
  const prepared = readReviewRevision(roots);
  const previousReview = previousReviewIdentity({root, home, commonDirectory, currentHead: parent.head});
  if (!same(prepared.runtime.previousReview, previousReview)) throw new Error('BLOCKED_REVIEW_PREDECESSOR_MISMATCH');
  if (prepared.runtime.commitSha !== parent.head || prepared.runtime.fixedParentHead !== core.FROZEN_P5_HEAD
      || prepared.runtime.fixedParentCommitSha !== core.FROZEN_P5_HEAD
      || prepared.runtime.fixedParentParentSha !== git(['rev-parse', `${core.FROZEN_P5_HEAD}^`], root)
      || prepared.runtime.fixedParentTreeSha !== git(['rev-parse', `${core.FROZEN_P5_HEAD}^{tree}`], root)
      || prepared.runtime.commitParent !== git(['rev-parse', `${parent.head}^`], root)
      || prepared.runtime.commitTree !== git(['rev-parse', `${parent.head}^{tree}`], root)
      || prepared.runtime.parentP5RuntimeSha256 !== parent.p5.runtimeSha256
      || prepared.runtime.parentDiagnosticsSha256 !== parent.p5.diagnosticsSha256
      || prepared.runtime.parentHistorySha256 !== parent.p5.historySha256
      || prepared.runtime.parentTerminalSha256 !== parent.p5.terminalSha256
      || !same(prepared.runtime.parentInventory, parent.parentSnapshots.inventory)) {
    throw new Error('BLOCKED_REVIEW_REVISION_PARENT_MISMATCH');
  }
  verifyLineage({root, frozenHead: prepared.runtime.fixedParentHead, currentHead: prepared.runtime.commitSha,
    sourceHashes: Object.fromEntries(Object.entries(prepared.runtime.sourceHashes).filter(([file]) =>
      Object.hasOwn(parent.prepared.record.sourceHashes, file)))});
  const currentSources = sourceHashMap(Object.keys(prepared.runtime.sourceHashes), root);
  if (!canonicalSame(currentSources, prepared.runtime.sourceHashes)) throw new Error('BLOCKED_REVIEW_SOURCE_SHA_MISMATCH');
  const recomputed = auditReport({root, verifyRemote: false});
  if (core.sha256(core.jsonBytes(recomputed)) !== prepared.auditSha256
      || !same(recomputed.summary, prepared.runtime.auditSummary)) throw new Error('BLOCKED_REVIEW_AUDIT_SHA_MISMATCH');
  return {...prepared, roots, parent};
}
function status({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const roots = core.resolveRoots(root, home, commonDirectory);
  const runtime = core.readDual(roots, REVISION_REL);
  const counts = core.callCounts(roots);
  if (!runtime) return {decision: 'REVIEW_NOT_PREPARED', epoch: core.EPOCH, calls: counts,
    builds: 0, acousticCalls: 0, renders: 0, writes: 0};
  const prepared = verifyReviewRevision({root, home, commonDirectory, verifyRemote: false});
  const terminal = core.readDual(roots, TERMINAL_REL);
  return {decision: terminal ? JSON.parse(terminal.bytes.toString('utf8')).decision : prepared.runtime.decision,
    epoch: core.EPOCH, revisionSha256: prepared.runtimeSha256, auditSha256: prepared.auditSha256,
    terminalSha256: terminal?.sha256 || null, summary: prepared.runtime.auditSummary,
    calls: counts, builds: 0, acousticCalls: 0, renders: 0, writes: 0};
}
function verify({root = ROOT, home = os.homedir(), commonDirectory, verifyRemote = true} = {}) {
  const prepared = verifyReviewRevision({root, home, commonDirectory, verifyRemote});
  const terminal = core.readDual(prepared.roots, TERMINAL_REL);
  if (!terminal) return {decision: P5_BLOCKED, revisionSha256: prepared.runtimeSha256,
    auditSha256: prepared.auditSha256, calls: core.callCounts(prepared.roots),
    parent: prepared.runtime.parentInventory, builds: 0, acousticCalls: 0, writes: 0};
  const result = JSON.parse(terminal.bytes.toString('utf8'));
  if (result.revisionSha256 !== prepared.runtimeSha256 || result.parentTerminalSha256 !== prepared.runtime.parentTerminalSha256
      || result.previousReviewRevisionSha256 !== prepared.runtime.previousReview.revisionSha256
      || result.previousReviewTerminalSha256 !== prepared.runtime.previousReview.terminalSha256
      || result.decision !== P5_BLOCKED || result.newAcousticCalls !== 0) {
    throw new Error('BLOCKED_REVIEW_TERMINAL_IDENTITY');
  }
  return {...result, terminalSha256: terminal.sha256, calls: core.callCounts(prepared.roots), writes: 0};
}
function dryRun(options = {}) {
  const report = auditReport(options);
  return {...report, points: undefined, representative: report.points.slice(0, 5),
    work: {builds: 0, acousticCalls: 0, renders: 0, writes: 0}};
}

function scenarioId(stage, index, suffix = '') {
  return `${stage}-${String(index).padStart(4, '0')}${suffix ? `-${suffix}` : ''}`;
}
function scenarioPlan(ctx, stage, payload) {
  const result = core.writePlan(ctx.roots, stage, {scenario: ctx.scenarioId,
    parentP5Sha256: ctx.parentP5Sha256, values: ctx.values, ...payload});
  ctx.plans[stage] = result;
  return result;
}
function recordSyntheticCall(ctx, {stage, index, cell, artifactKind = 'wav', plan, values = ctx.values, scenario = stage}) {
  const id = scenarioId(scenario, index);
  const request = {id, stage, planSha256: plan.planSha256, values, cell, artifactKind,
    ownerId: ctx.ownerId, sourceSha256: ctx.sourceSha256, captureSha256: ctx.captureSha256,
    binarySha256: ctx.binarySha256, fixtureSha256: ctx.fixtureSha256, writerSession: ctx.writerSession};
  const started = core.startCall(ctx.roots, request);
  if (started.reused) return {id, ...started, call: core.verifiedCall(ctx.roots, id, request)};
  let output;
  try {
    if (!ctx.synthetic || typeof ctx.backend !== 'function') throw new Error('BLOCKED_REVIEW_REAL_BACKEND_FORBIDDEN');
    output = ctx.backend({stage, index, cell, values: [...values], artifactKind, binarySha256: ctx.binarySha256,
      build: ctx.currentBuild, scenario});
    if (!output || !output.row || (artifactKind === 'wav' && !Buffer.isBuffer(output.audioBytes))) {
      throw new Error('BLOCKED_REVIEW_SYNTHETIC_BACKEND_SHAPE');
    }
    const completed = core.completeCall(ctx.roots, id, {row: output.row,
      audioBytes: artifactKind === 'wav' ? output.audioBytes : null, writerSession: ctx.writerSession});
    ctx.calls[stage]++;
    return {id, output, call: completed};
  } catch (error) {
    try { core.markAmbiguous(ctx.roots, id, error.message); } catch { /* retain the original fail-closed error */ }
    throw new Error(`BLOCKED_REVIEW_SCENARIO_CALL: ${id}: ${error.message}`);
  }
}
function failSafeRow(row) {
  const metrics = row.metrics || row;
  if (metrics.finite === false || metrics.finiteThroughout === false || metrics.guardHits > 0
      || metrics.outputGuardHits > 0 || (Number.isFinite(metrics.peak) && metrics.peak >= 1)
      || (Number.isFinite(metrics.peakDbfs) && metrics.peakDbfs >= 0)) {
    throw new Error('BLOCKED_REVIEW_OFFICIAL_SAFETY_GATE');
  }
}
function referenceMap(fixture) { return new Map(fixture.directCells.map(cell => [`${cell.pitch}:${cell.velocity}`, cell])); }
function evaluateDirectRows(rows, fixture, label) {
  const references = referenceMap(fixture);
  const measured = rows.map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics}));
  const refs = measured.map(row => references.get(`${row.pitch}:${row.velocity}`));
  if (refs.some(row => !row)) throw new Error(`BLOCKED_REVIEW_${label}_REFERENCE_COVERAGE`);
  const result = directMetrics.evaluateDirectReferenceMatrix(refs, measured);
  const pass = result.metrics?.finite === true && result.metrics.cellFailureCount === 0
    && result.metrics.directPitchFailureCount === 0;
  return {decision: pass ? 'OFFICIAL_DIRECT_GATES_PASS' : 'BLOCKED_OFFICIAL_DIRECT_GATES', pass, result};
}
function runP5Candidates(ctx) {
  if (!ctx.synthetic) throw new Error('BLOCKED_REVIEW_SYNTHETIC_ONLY');
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  const candidates = ctx.candidates;
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 6) throw new Error('BLOCKED_REVIEW_CANDIDATE_COUNT');
  const unique = new Set(candidates.map(item => JSON.stringify(core.validateValues(item.values))));
  if (unique.size !== candidates.length) throw new Error('BLOCKED_REVIEW_DUPLICATE_CANDIDATE');
  const fixture = ctx.fixture, stress = oldV5Core.STRESS_CELLS;
  const plan = scenarioPlan(ctx, 'candidate', {values: candidates.map(item => item.values), cells: stress});
  const outcomes = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const candidate = candidates[candidateIndex];
    ctx.values = core.validateValues(candidate.values);
    const rows = [];
    for (let cellIndex = 0; cellIndex < stress.length; cellIndex++) {
      const cell = {...stress[cellIndex], candidateIndex};
      const result = recordSyntheticCall(ctx, {stage: 'candidate', index: candidateIndex * stress.length + cellIndex + 1,
        cell, plan, scenario: 'candidate'});
      const row = result.call.row;
      failSafeRow(row);
      rows.push(row);
    }
    const gate = evaluateDirectRows(rows, fixture, 'CANDIDATE');
    core.validateWriterSession(ctx.roots, ctx.writerSession);
    outcomes.push({candidateIndex, values: ctx.values, gate: gate.decision, pass: gate.pass});
    if (gate.pass) { ctx.values = [...candidate.values]; ctx.selectedCandidate = candidate; ctx.p5Gate = gate; return {pass: true, outcomes}; }
  }
  return {pass: false, outcomes, decision: 'BLOCKED_REVIEW_NO_OFFICIAL_CANDIDATE'};
}
function runConfirmation(ctx) {
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  const cells = CONFIRMATION_PITCHES.flatMap(pitch => CONFIRMATION_VELOCITIES.map(velocity => ({pitch, velocity,
    kind: oldV5Core.STRESS_CELLS.some(item => item.pitch === pitch && item.velocity === velocity) ? 'training-overlap' : 'new-coordinate'})));
  if (cells.filter(cell => cell.kind === 'training-overlap').length !== 7 || cells.length !== 25) {
    throw new Error('BLOCKED_REVIEW_CONFIRMATION_CELL_SET');
  }
  const plan = scenarioPlan(ctx, 'confirmation', {cells});
  const rows = [];
  for (let index = 0; index < cells.length; index++) {
    const result = recordSyntheticCall(ctx, {stage: 'confirmation', index: index + 1, cell: cells[index], plan});
    failSafeRow(result.call.row);
    rows.push(result.call.row);
  }
  const gate = evaluateDirectRows(rows, ctx.fixture, 'CONFIRMATION');
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  if (!gate.pass) return {pass: false, decision: 'BLOCKED_REVIEW_CONFIRMATION', gate: gate.result};
  return {pass: true, total: rows.length, trainingOverlap: 7, newCoordinates: 18, gate: gate.result};
}
function runHeadroom(ctx) {
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  const patterns = [
    {pattern: 'ten-note', notes: [48, 55, 60, 64, 67, 71, 74, 76, 79, 84]},
    {pattern: 'thirty-two-note', notes: Array.from({length: 32}, (_, index) => 48 + index)}
  ];
  const cases = patterns.flatMap(pattern => ['baseline', 'candidate'].map(build => ({...pattern,
    velocity: 124, build, values: [...(build === 'baseline' ? model.BASELINES : ctx.values)]})));
  const plan = scenarioPlan(ctx, 'headroom', {sampleRate: 48000, blockSize: 128, durationSec: 2, noteOffSec: 1, cases});
  const rows = [];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    const result = recordSyntheticCall(ctx, {stage: 'headroom', index: index + 1, cell: item, plan, values: item.values});
    const row = result.call.row;
    if (row.sampleRate !== 48000 || row.blockSize !== 128 || row.durationSec !== 2 || row.noteOffSec !== 1
        || !Number.isFinite(row.maxCallbackSec) || row.maxCallbackSec >= 128 / 48000
        || row.finite !== true || row.guardHits !== 0 || !Number.isFinite(row.peak) || row.peak >= 1
        || row.pattern !== item.pattern || row.build !== item.build || row.velocity !== item.velocity
        || JSON.stringify(row.notes) !== JSON.stringify(item.notes)
        || JSON.stringify(row.values) !== JSON.stringify(item.values)) {
      return {pass: false, decision: 'BLOCKED_REVIEW_HEADROOM', failedIndex: index + 1};
    }
    rows.push(row);
  }
  for (let index = 0; index < rows.length; index += 2) {
    const baseline = rows[index], candidate = rows[index + 1];
    if (!Number.isFinite(baseline.peakDbfs) || !Number.isFinite(candidate.peakDbfs)
        || candidate.peakDbfs - baseline.peakDbfs > 0.1) {
      return {pass: false, decision: 'BLOCKED_REVIEW_HEADROOM_PEAK', failedPattern: baseline.pattern};
    }
  }
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  return {pass: true, calls: rows.length, maxCallbackLimitSec: 128 / 48000};
}
function promoteP6(ctx) {
  if (!ctx.synthetic || !ctx.p5Gate?.pass || !ctx.confirmation?.pass || !ctx.headroom?.pass) {
    throw new Error('BLOCKED_REVIEW_P6_PREREQUISITE');
  }
  const expectedFiles = ['wasm/plugins/dsp/super-synth/presets.json', 'wasm/shared/generated/super-synth_grand_profiles.h'];
  const fake = typeof ctx.promotion === 'function' ? ctx.promotion({files: expectedFiles, values: ctx.values}) : {
    files: expectedFiles.map((file, index) => ({path: file, sha256: (index ? 'e' : 'd').repeat(64)})),
    parentSha: ctx.parentHead, commitSha: '1'.repeat(40), treeSha: '2'.repeat(40), pushedAndReadBack: true
  };
  const names = fake.files?.map(item => item.path).sort();
  if (!same(names, [...expectedFiles].sort()) || new Set(names).size !== 2
      || fake.parentSha !== ctx.parentHead || !/^[a-f0-9]{40}$/.test(fake.commitSha)
      || !/^[a-f0-9]{40}$/.test(fake.treeSha) || fake.pushedAndReadBack !== true
      || fake.files.some(item => !/^[a-f0-9]{64}$/.test(item.sha256))) {
    throw new Error('BLOCKED_REVIEW_P6_SYNTHETIC_RECEIPT');
  }
  const intent = {schemaVersion: 1, kind: 'P6_INTENT', parentSha: fake.parentSha,
    selectedValues: ctx.values, files: fake.files};
  const receipt = {schemaVersion: 1, kind: 'P6_RECEIPT', parentSha: fake.parentSha,
    commitSha: fake.commitSha, treeSha: fake.treeSha, files: fake.files, pushedAndReadBack: true, synthetic: true};
  core.writeJsonImmutableDual(ctx.roots, 'p6/intent.json', intent);
  core.writeJsonImmutableDual(ctx.roots, 'p6/receipt.json', receipt);
  return {pass: true, intent, receipt, synthetic: true};
}
function buildSyntheticVariants(ctx) {
  if (!ctx.promotionResult?.pass) throw new Error('BLOCKED_REVIEW_BUILD_PREREQUISITE');
  const test = {configuration: {BUILD_TESTING: true, GUARD_DIAGNOSTICS: true},
    wasmSha256: 'a'.repeat(64), exports: ['memory', 'render', 'diagnostic_guard']};
  const release = {configuration: {BUILD_TESTING: false, GUARD_DIAGNOSTICS: false},
    wasmSha256: 'b'.repeat(64), exports: ['memory', 'render']};
  if (test.wasmSha256 === release.wasmSha256 || same(test.configuration, release.configuration)) {
    throw new Error('BLOCKED_REVIEW_BUILD_IDENTITY_NOT_DISTINCT');
  }
  core.writeJsonImmutableDual(ctx.roots, 'builds/production-test.json', test);
  core.writeJsonImmutableDual(ctx.roots, 'builds/production-release.json', release);
  ctx.builds = {productionTest: test, productionRelease: release};
  ctx.currentBuild = test;
  const checks = Array.from({length: 6}, (_, index) => ({label: `regression-${index + 1}`, result: 'PASS'}));
  const ctest = {result: 'PASS'};
  if (checks.length !== 6 || checks.some(item => item.result !== 'PASS') || ctest.result !== 'PASS') {
    throw new Error('BLOCKED_REVIEW_SYNTHETIC_TESTS');
  }
  core.writeJsonImmutableDual(ctx.roots, 'builds/test-results.json', {checks, ctest, synthetic: true});
  return {productionTest: test, productionRelease: release, checks, ctest};
}
function comparePcm(test, release) {
  if (!Array.isArray(test.left) || !Array.isArray(test.right) || !Array.isArray(release.left)
      || !Array.isArray(release.right) || test.left.length !== release.left.length
      || test.right.length !== release.right.length || test.left.length !== test.right.length) {
    return {pass: false, reason: 'shape'};
  }
  let maxAbs = 0, finite = true;
  for (let index = 0; index < test.left.length; index++) {
    for (const value of [test.left[index], test.right[index], release.left[index], release.right[index]]) {
      if (!Number.isFinite(value)) finite = false;
    }
    maxAbs = Math.max(maxAbs, Math.abs(test.left[index] - release.left[index]),
      Math.abs(test.right[index] - release.right[index]));
  }
  const peak = Math.max(...test.left.map(Math.abs), ...test.right.map(Math.abs), ...release.left.map(Math.abs), ...release.right.map(Math.abs));
  return {pass: finite && Number.isFinite(peak) && peak < 1 && maxAbs <= PCM_TOLERANCE,
    finite, peak, sampleCountPerChannel: test.left.length, maxAbsoluteSampleDifference: maxAbs, tolerance: PCM_TOLERANCE};
}
function releasePairs() {
  return [...v4Core.RELEASE_SINGLE_CELLS, ...v4Core.RELEASE_CHORDS]
    .map((cell, index) => ({index: index + 1, cell}));
}
function runReleasePairs(ctx) {
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  if (!ctx.builds?.productionTest || !ctx.builds?.productionRelease
      || ctx.builds.productionTest.wasmSha256 === ctx.builds.productionRelease.wasmSha256) {
    throw new Error('BLOCKED_REVIEW_RELEASE_BUILD_IDENTITY');
  }
  const pairs = releasePairs();
  if (pairs.length !== 12) throw new Error('BLOCKED_REVIEW_RELEASE_PAIR_COUNT');
  const plan = scenarioPlan(ctx, 'releaseEquivalence', {pairs, tolerance: PCM_TOLERANCE,
    testWasmSha256: ctx.builds.productionTest.wasmSha256, releaseWasmSha256: ctx.builds.productionRelease.wasmSha256});
  const results = [];
  for (const {index, cell} of pairs) {
    const captures = {};
    for (const buildName of ['productionTest', 'productionRelease']) {
      ctx.currentBuild = ctx.builds[buildName];
      ctx.binarySha256 = ctx.currentBuild.wasmSha256;
      const callIndex = (index - 1) * 2 + (buildName === 'productionTest' ? 1 : 2);
      const result = recordSyntheticCall(ctx, {stage: 'releaseEquivalence', index: callIndex,
        cell: {...cell, build: buildName}, plan, scenario: 'release'});
      const row = result.call.row;
      if (row.finite !== true || !Number.isFinite(row.peak) || row.peak >= 1
          || (buildName === 'productionTest' && row.guardHits !== 0)
          || !Array.isArray(row.left) || !Array.isArray(row.right)) {
        return {pass: false, decision: 'BLOCKED_REVIEW_RELEASE_SAFETY', failedPair: index, buildName};
      }
      captures[buildName] = row;
    }
    const comparison = comparePcm(captures.productionTest, captures.productionRelease);
    results.push({index, cell, comparison,
      productionTestWasmSha256: ctx.builds.productionTest.wasmSha256,
      productionReleaseWasmSha256: ctx.builds.productionRelease.wasmSha256,
      productionTestExports: ctx.builds.productionTest.exports,
      productionReleaseExports: ctx.builds.productionRelease.exports});
    if (!comparison.pass) return {pass: false, decision: 'BLOCKED_REVIEW_RELEASE_PCM_MISMATCH', completedPairs: results.length, pairs: results};
  }
  const result = {pass: true, decision: 'REVIEW_RELEASE_EQUIVALENCE_PASS', expectedPairs: 12,
    actualAudioCalls: 24, tolerance: PCM_TOLERANCE, pairs: results, synthetic: true};
  core.writeJsonImmutableDual(ctx.roots, 'release/equivalence.json', result);
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  return result;
}
function runStage3(ctx) {
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  if (!ctx.releaseEquivalence?.pass || !ctx.builds?.productionTest) throw new Error('BLOCKED_REVIEW_STAGE3_PREREQUISITE');
  if (ctx.stage3Started) throw new Error('BLOCKED_REVIEW_STAGE3_DUPLICATE_START');
  ctx.stage3Started = true;
  ctx.binarySha256 = ctx.builds.productionTest.wasmSha256;
  const cells = stage3.cells();
  if (cells.length !== 486 || cells.filter(cell => cell.kind === 'direct').length !== 480
      || cells.filter(cell => cell.kind === 'sentinel').length !== 6) throw new Error('BLOCKED_REVIEW_STAGE3_CELL_SET');
  scenarioPlan(ctx, 'stage3', {cellCount: cells.length, binarySha256: ctx.binarySha256});
  const rows = cells.map((cell, index) => {
    const result = recordSyntheticCall(ctx, {stage: 'stage3', index: index + 1, cell,
      artifactKind: 'metric', plan: ctx.plans.stage3, scenario: 'stage3'});
    const stored = result.call.row;
    if (stored.pitch !== cell.pitch || stored.velocity !== cell.velocity || !stored.metrics) {
      throw new Error(`BLOCKED_REVIEW_STAGE3_ROW_IDENTITY: ${cell.key}`);
    }
    return {schemaVersion: 1, cell, pitch: stored.pitch, velocity: stored.velocity, metrics: stored.metrics};
  });
  const regressions = Object.fromEntries(stage3.REQUIRED_REGRESSIONS.map(name => [name, {result: 'PASS', synthetic: true}]));
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  const evaluation = stage3.evaluate(rows, ctx.fixture, regressions);
  const result = {decision: evaluation.decision, evaluation, identity: {wasmSha256: ctx.binarySha256},
    rowsSha256: core.sha256(core.jsonBytes(rows)), synthetic: true};
  core.writeJsonImmutableDual(ctx.roots, 'stage3/result.json', result);
  ctx.stage3Result = result;
  ctx.stage3Rows = rows;
  if (evaluation.decision !== 'STAGE3_READY_FOR_STAGE4') {
    return {pass: false, decision: evaluation.decision, result};
  }
  return {pass: true, decision: evaluation.decision, result, rows};
}
function safeSyntheticLifecycleRow(cell) {
  return {pitch: cell.pitch, velocity: cell.velocity, metrics: {
    finite: true, finiteThroughout: true, finiteRelease: true, postReleaseFinite: true,
    outputGuardHits: 0, peakDbfs: -10, fullRenderPeakDbfs: -9,
    pitchMeasurement: {measurement_valid: true, pitch_error_cents: 0},
    lifecycle: {postReleaseFinite: true, guardHits: 0, noteOffProcessed: true,
      releasedWithinLimit: true, inactiveAfterNoteOffMs: 20, postReleaseProcessed: true, finalActiveVoiceCount: 0}
  }};
}
function runStage4(ctx) {
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  if (!ctx.stage3Result || !ctx.stage3Rows || !ctx.builds?.productionTest) throw new Error('BLOCKED_REVIEW_STAGE4_PREREQUISITE');
  if (!ctx.stage3Result.decision.startsWith('STAGE3_') || ctx.stage3Result.decision.includes('BLOCKED')) {
    throw new Error('BLOCKED_REVIEW_STAGE4_AFTER_STAGE3_FAILURE');
  }
  const cells = stage4.cells();
  ctx.binarySha256 = ctx.builds.productionTest.wasmSha256;
  if (cells.length !== 1423 || stage4Capture.LIFECYCLE_CELLS.length !== 1408
      || stage4Capture.REPEAT_CELLS.length !== 15) throw new Error('BLOCKED_REVIEW_STAGE4_CELL_SET');
  scenarioPlan(ctx, 'stage4', {cellCount: cells.length, binarySha256: ctx.builds.productionTest.wasmSha256,
    stage3ResultSha256: core.sha256(core.jsonBytes(ctx.stage3Result))});
  const lifecycle = new Map(), matrix = [], repeats = [];
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    const result = recordSyntheticCall(ctx, {stage: 'stage4', index: index + 1, cell,
      artifactKind: 'metric', plan: ctx.plans.stage4, scenario: 'stage4'});
    const row = result.call.row;
    if (cell.kind === 'repeat') {
      const original = lifecycle.get(`${cell.pitch}:${cell.velocity}`);
      if (!original) throw new Error('BLOCKED_REVIEW_STAGE4_REPEAT_ORDER');
      repeats.push({...row, cell});
    } else {
      lifecycle.set(`${cell.pitch}:${cell.velocity}`, row);
      matrix.push({...row, cell});
    }
  }
  const stage3Identity = {identity: {wasmSha256: ctx.builds.productionTest.wasmSha256},
    resultSha256: core.sha256(core.jsonBytes(ctx.stage3Result))};
  const identity = {stage3Identity: stage3Identity.identity, stage3ResultSha256: stage3Identity.resultSha256,
    wasmSha256: ctx.builds.productionTest.wasmSha256};
  const evaluation = stage4.evaluate({root: ROOT, roots: ctx.roots, identity, stage3Identity, matrix, repeats,
    stage3Rows: ctx.stage3Rows});
  const result = {decision: evaluation.decision, evaluation, synthetic: true};
  core.validateWriterSession(ctx.roots, ctx.writerSession);
  core.writeJsonImmutableDual(ctx.roots, 'stage4/result.json', result);
  ctx.stage4Result = result;
  return {pass: evaluation.decision === 'STAGE4_FULL_RANGE_COMPLETE', decision: evaluation.decision, result};
}
function finalize(ctx) {
  const stagesComplete = Boolean(ctx.p5Gate?.pass && ctx.confirmation?.pass && ctx.headroom?.pass
    && ctx.promotionResult?.pass && ctx.builds && ctx.releaseEquivalence?.pass
    && ctx.stage3Result && ctx.stage4Result?.decision === 'STAGE4_FULL_RANGE_COMPLETE');
  const result = {decision: stagesComplete ? 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW' : 'BLOCKED_REVIEW_SYNTHETIC_SCENARIO',
    synthetic: true, stagesComplete, actualAcousticCalls: 0,
    webPlayer: 'NOT RUN', metadataAbi: 'NOT RUN', manualListening: 'NOT RUN',
    pushReadback: 'NOT RUN', issueReadyForReview: false, calls: core.callCounts(ctx.roots)};
  core.writeJsonImmutableDual(ctx.roots, 'final/synthetic-result.json', result);
  return result;
}
function runAuthorizedScenario({roots, values = model.BASELINES, candidates = [{values}], backend,
  promotion, scenarioId: suppliedScenarioId = 'synthetic-review-positive', fixture, sourceSha256,
  captureSha256, binarySha256} = {}) {
  if (!roots || !Array.isArray(candidates) || typeof backend !== 'function') throw new Error('BLOCKED_REVIEW_SCENARIO_INPUT');
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (!core.inside(temporaryRoot, roots.repo) || !core.inside(temporaryRoot, roots.primary)
      || !core.inside(temporaryRoot, roots.secondary) || roots.epoch !== core.EPOCH) {
    throw new Error('BLOCKED_REVIEW_SYNTHETIC_ROOT_NOT_ISOLATED');
  }
  const scenario = {synthetic: true, roots, values: core.validateValues(values), candidates, backend, promotion,
    scenarioId: suppliedScenarioId, fixture: fixture || readJson(path.join(ROOT, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json')),
    sourceSha256: sourceSha256 || core.sha256(Buffer.from('synthetic-source')),
    captureSha256: captureSha256 || core.sha256(Buffer.from('synthetic-capture')),
    binarySha256: binarySha256 || core.sha256(Buffer.from('synthetic-binary')),
    fixtureSha256: core.sha256(Buffer.from('synthetic-fixture')),
    ownerId: `synthetic-${crypto.randomUUID()}`, plans: {}, calls: Object.fromEntries(Object.keys(core.STAGES).map(stage => [stage, 0])),
    parentP5Sha256: core.sha256(Buffer.from('synthetic-parent')), parentHead: core.FROZEN_P5_HEAD};
  const lock = core.acquireLock(roots, scenario.ownerId);
  try {
    scenario.writerSession = core.beginWriterSession(roots, scenario.ownerId);
    const candidate = runP5Candidates(scenario);
    if (!candidate.pass) return {decision: candidate.decision, candidate, calls: core.callCounts(roots)};
    scenario.p5Gate = candidate;
    scenario.confirmation = runConfirmation(scenario);
    if (!scenario.confirmation.pass) return {decision: scenario.confirmation.decision, confirmation: scenario.confirmation, calls: core.callCounts(roots)};
    scenario.headroom = runHeadroom(scenario);
    if (!scenario.headroom.pass) return {decision: scenario.headroom.decision, headroom: scenario.headroom, calls: core.callCounts(roots)};
    scenario.promotionResult = promoteP6(scenario);
    scenario.buildResults = buildSyntheticVariants(scenario);
    scenario.releaseEquivalence = runReleasePairs(scenario);
    if (!scenario.releaseEquivalence.pass) return {decision: scenario.releaseEquivalence.decision, releaseEquivalence: scenario.releaseEquivalence, calls: core.callCounts(roots)};
    scenario.stage3 = runStage3(scenario);
    if (!scenario.stage3.pass) return {decision: scenario.stage3.decision, stage3: scenario.stage3, calls: core.callCounts(roots)};
    scenario.stage4 = runStage4(scenario);
    if (!scenario.stage4.pass) return {decision: scenario.stage4.decision, stage4: scenario.stage4, calls: core.callCounts(roots)};
    const final = finalize(scenario);
    return {...final, candidate, confirmation: scenario.confirmation, headroom: scenario.headroom,
      promotion: scenario.promotionResult, builds: scenario.buildResults, releaseEquivalence: scenario.releaseEquivalence,
      stage3: scenario.stage3, stage4: scenario.stage4};
  } finally {
    try {
      if (scenario.writerSession) core.endWriterSession(roots, scenario.writerSession);
    } finally { core.releaseLock(roots, lock); }
  }
}
function runAll({root = ROOT, home = os.homedir(), commonDirectory, verifyRemote = true} = {}) {
  const prepared = verifyReviewRevision({root, home, commonDirectory, verifyRemote});
  const parent = prepared.parent;
  if (parent.prepared.diagnosticReport.decision !== P5_BLOCKED
      || parent.prepared.diagnosticReport.model?.candidateCount !== 0
      || parent.report.summary.eligibleCount !== 0) throw new Error('BLOCKED_REVIEW_REAL_EXECUTION_NOT_AUTHORIZED');
  const roots = prepared.roots;
  const existing = core.readDual(roots, TERMINAL_REL);
  if (existing) {
    const saved = JSON.parse(existing.bytes.toString('utf8'));
    if (saved.revisionSha256 !== prepared.runtimeSha256 || saved.parentP5RuntimeSha256 !== parent.p5.runtimeSha256
        || saved.parentTerminalSha256 !== parent.p5.terminalSha256
        || saved.previousReviewRevisionSha256 !== prepared.runtime.previousReview.revisionSha256
        || saved.previousReviewTerminalSha256 !== prepared.runtime.previousReview.terminalSha256
        || saved.decision !== P5_BLOCKED || saved.newAcousticCalls !== 0) throw new Error('BLOCKED_REVIEW_TERMINAL_CONFLICT');
    return {...saved, terminalSha256: existing.sha256, writes: 0};
  }
  const beforeCounts = core.callCounts(roots);
  if (beforeCounts.started !== 0) throw new Error('BLOCKED_REVIEW_UNEXPECTED_REAL_CALLS');
  const result = {schemaVersion: 1, issue: core.ISSUE, epoch: core.EPOCH,
    revisionSha256: prepared.runtimeSha256, auditSha256: prepared.auditSha256,
    parentP5RuntimeSha256: parent.p5.runtimeSha256, parentDiagnosticsSha256: parent.p5.diagnosticsSha256,
    parentTerminalSha256: parent.p5.terminalSha256,
    previousReviewRevisionSha256: prepared.runtime.previousReview.revisionSha256,
    previousReviewTerminalSha256: prepared.runtime.previousReview.terminalSha256, decision: P5_BLOCKED,
    model: {bestId: parent.report.model.bestId, bestValues: parent.report.model.bestValues,
      rank: parent.report.model.rank, conditionNumber: parent.report.model.conditionNumber,
      looErrorDb: parent.report.model.looErrorDb, candidateCount: 0},
    phases: {candidate: P5_BLOCKED, confirmation: 'NOT RUN', headroom: 'NOT RUN', p6: 'NOT RUN',
      productionBuilds: 'NOT RUN', regressionsAndCTest: 'NOT RUN', releaseEquivalence: 'NOT RUN',
      stage3: 'NOT RUN', stage4: 'NOT RUN', webPlayer: 'NOT RUN', manualListening: 'NOT RUN'},
    calls: {...beforeCounts, cumulative: HISTORY_CALLS, cap: CALL_CAP, remaining: CALL_CAP - HISTORY_CALLS},
    newAcousticCalls: 0, builds: 0, renders: 0, writes: 1,
    next: 'Frozen P5 has zero eligible candidates; stop before acoustic rendering.'};
  const ownerId = `real-blocked-${crypto.randomUUID()}`;
  const lock = core.acquireLock(roots, ownerId);
  try {
    const racedTerminal = core.readDual(roots, TERMINAL_REL);
    if (racedTerminal) {
      const saved = JSON.parse(racedTerminal.bytes.toString('utf8'));
      if (saved.revisionSha256 !== prepared.runtimeSha256 || saved.parentP5RuntimeSha256 !== parent.p5.runtimeSha256
          || saved.parentTerminalSha256 !== parent.p5.terminalSha256
          || saved.previousReviewRevisionSha256 !== prepared.runtime.previousReview.revisionSha256
          || saved.previousReviewTerminalSha256 !== prepared.runtime.previousReview.terminalSha256
          || saved.decision !== P5_BLOCKED || saved.newAcousticCalls !== 0) throw new Error('BLOCKED_REVIEW_TERMINAL_CONFLICT');
      return {...saved, terminalSha256: racedTerminal.sha256, writes: 0};
    }
    const lockedCounts = core.callCounts(roots);
    if (lockedCounts.started !== 0) throw new Error('BLOCKED_REVIEW_UNEXPECTED_REAL_CALLS');
    const stored = core.writeJsonImmutableDual(roots, TERMINAL_REL, result);
    const after = core.callCounts(roots);
    if (after.started !== 0 || after.cumulative !== HISTORY_CALLS || stored.sha256 !== core.readDual(roots, TERMINAL_REL).sha256) {
      throw new Error('BLOCKED_REVIEW_PARENT_ACCOUNTING_CHANGED');
    }
    return {...result, terminalSha256: stored.sha256, writes: stored.reused ? 0 : 1};
  } finally { core.releaseLock(roots, lock); }
}
function parseMode(argv) {
  if (argv.length !== 1) throw new Error('select exactly one mode: --audit, --status, --verify, --dry-run, --prepare-review, or --run-all');
  const modes = {
    '--audit': () => auditReport({verifyRemote: false}),
    '--status': () => status(),
    '--verify': () => verify({verifyRemote: true}),
    '--dry-run': () => dryRun(),
    '--prepare-review': () => prepareReviewRevision({verifyRemote: true}),
    '--run-all': () => runAll({verifyRemote: true})
  };
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

module.exports = {ROOT, NEW_SOURCE_REL, REVISION_REL, AUDIT_REL, TERMINAL_REL,
  verifyLineage, assertReviewSourcesCommitted, verifyFrozenP5Parent, auditReport, prepareReviewRevision, verifyReviewRevision,
  status, verify, dryRun, runP5Candidates, runConfirmation, runHeadroom, promoteP6,
  buildSyntheticVariants, comparePcm, runReleasePairs, runStage3, runStage4, finalize,
  runAuthorizedScenario, runAll, parseMode, run, main};
