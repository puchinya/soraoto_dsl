#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const core = require('./issue7-physical-root-cause-offline-v1-core.cjs');
const analyzer = require('./analyze-issue7-physical-identification.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const REPOSITORY = 'puchinya/soraoto_dsl';
const PR_NUMBER = 8;
const PR_BRANCH = 'codex/issue-7-supersynth-v9';
const APPROVAL_COMMENT_ID = '6392117466';
const PUBLISH_FILES = Object.freeze(['report.json', 'manifest.json']);

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function git(args, root = ROOT) { return execFileSync('rtk', ['git', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
function rtk(args, options = {}) { return execFileSync('rtk', args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options}).trim(); }
function redact(value, roots = {}) {
  let text = String(value ?? '');
  for (const [secret, replacement] of [[roots.home || os.homedir(), '$HOME'], [roots.repo || ROOT, '$REPO'], [roots.archive, '$REFERENCE_ARCHIVE']]) {
    if (secret) text = text.split(secret).join(replacement);
  }
  return text.replace(/(?:\/[^\s:]+){4,}/g, '$PRIVATE_PATH');
}
function classifyBinaryIdentity({bytes, runtime, p1RecordSha256, expectedWasmSha256 = core.DIAGNOSTIC_WASM_SHA256,
  expectedP1RecordSha256 = core.P1_RECORD_SHA256, requiredExports = core.EXPORTS} = {}) {
  let wasm = null, fileStatus = 'MISSING', exports = [], exportsStatus = 'EXPORT_MISMATCH';
  if (bytes) {
    wasm = {size: bytes.length, sha256: sha(bytes)};
    fileStatus = wasm.sha256 === expectedWasmSha256 ? 'MATCH' : 'FILE_SHA_MISMATCH';
    try {
      exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(item => item.name).sort();
      exportsStatus = requiredExports.every(name => exports.includes(name)) ? 'MATCH' : 'EXPORT_MISMATCH';
    } catch { exportsStatus = 'EXPORT_MISMATCH'; }
  }
  const p1RecordStatus = p1RecordSha256 === expectedP1RecordSha256
    && runtime?.build?.wasmSha256 === expectedWasmSha256 ? 'MATCH' : 'P1_RECORD_SHA_MISMATCH';
  const predicate = wasm && fileStatus === 'MATCH' && p1RecordStatus === 'MATCH' && exportsStatus === 'MATCH'
    ? 'RECOVERED_IDENTICAL' : (fileStatus === 'MISSING' ? 'MISSING' : fileStatus === 'FILE_SHA_MISMATCH' ? 'FILE_SHA_MISMATCH'
      : p1RecordStatus !== 'MATCH' ? 'P1_RECORD_SHA_MISMATCH' : 'EXPORT_MISMATCH');
  return {predicate, historicExecutableIdentity: predicate === 'RECOVERED_IDENTICAL' ? 'VERIFIED_ORIGINAL' : 'HISTORICAL_BINARY_UNAVAILABLE',
    wasmExists: Boolean(wasm), wasmSize: wasm?.size ?? null, wasmSha256: wasm?.sha256 ?? null,
    exports: {requiredCount: requiredExports.length, matchedCount: requiredExports.filter(name => exports.includes(name)).length, status: exportsStatus},
    p1RuntimeRecordSha256: p1RecordSha256 ?? null, p1RuntimeWasmSha256: runtime?.build?.wasmSha256 ?? null,
    p1RecordStatus, fileStatus};
}
function classifyForensic({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const roots = core.resolveInputRoots({root, home, commonDirectory});
  const p1 = core.readDual(roots.v3, core.P1_REL);
  const p1RecordSha256 = p1?.sha256 ?? null;
  let runtime = null;
  if (p1) {
    try { runtime = JSON.parse(p1.bytes.toString('utf8')); } catch { runtime = null; }
  }
  const wasmPath = path.join(roots.repo, core.P1_WASM_REL);
  let wasmBytes = null;
  try {
    const stat = fs.lstatSync(wasmPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    wasmBytes = fs.readFileSync(wasmPath);
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('BLOCKED_FORENSIC_WASM_NOT_REGULAR_FILE'); }
  return {...classifyBinaryIdentity({bytes: wasmBytes, runtime, p1RecordSha256}), work: {writes: 0, builds: 0, renders: 0, acousticCalls: 0}};
}
function locateArchive({home = os.homedir()} = {}) {
  const explicit = process.env.ISSUE7_SALAMANDER_ARCHIVE_PATH;
  if (explicit) return path.resolve(explicit);
  const located = analyzer.locateGoogleDriveArchive({cloudStorage: path.join(home, 'Library', 'CloudStorage')});
  return located || null;
}
function sameSnapshots(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function deliveryIdentity(repoRoot) {
  try {
    return {repository: REPOSITORY, issue: 7, prUrl: `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`,
      prBranch: PR_BRANCH, currentHead: git(['rev-parse', 'HEAD'], repoRoot),
      worktreeBranch: git(['branch', '--show-current'], repoRoot),
      upstreamBranch: git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot)};
  } catch {
    return {repository: REPOSITORY, issue: 7, prUrl: `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`,
      prBranch: PR_BRANCH, currentHead: null, worktreeBranch: null, upstreamBranch: null};
  }
}
function runAnalysis({root = ROOT, home = os.homedir(), commonDirectory, archivePath} = {}) {
  const roots = core.resolveInputRoots({root, home, commonDirectory});
  const before = core.snapshotSources(roots);
  let forensic = null, records = null, result = null, error = null, parentAnchor = null;
  try {
    forensic = classifyForensic({root, home, commonDirectory});
    records = core.verifyFrozenRecords(roots);
    parentAnchor = core.verifyParentSnapshots(before, records.rootCauseReport.value);
    const archive = archivePath || locateArchive({home});
    if (!archive) throw new Error('UNVERIFIABLE_SOURCE_DATA:REFERENCE_ARCHIVE_MISSING');
    const observations = [
      ...core.readVerifiedV3Rows(roots, records.p5History.value),
      ...core.readVerifiedV4Rows(roots, records.p5History.value, records.p3Result.value)
    ];
    if (observations.length !== 20) throw new Error('UNVERIFIABLE_SOURCE_DATA:OBSERVATION_COUNT');
    const reference = core.readVerifiedReference(archive, records.p3Manifest.value);
    const recomputed = core.recomputeOfficial({rows: observations, reference, gainDb: records.sharedGainOffsetDb});
    const comparison = core.compareHistory(recomputed, records.p5History.value, {db: 1e-6, nonDb: 1e-8});
    result = {status: 'PASS', comparison, parentAnchor, observationCount: observations.length, cellCount: recomputed.reduce((n, row) => n + row.rows.length, 0),
      reference: {archiveSha256: reference.archiveSha256, archiveSize: reference.archiveSize,
        archiveMtimeMs: reference.archiveMtimeMs, sfzSha256: reference.sfzSha256, sampleCount: Object.keys(reference.samples).length},
      critical96v124: recomputed.map(score => ({id: score.id, row: score.metrics.find(row => row.pitch === 96 && row.velocity === 124)}))
        .filter(item => item.row).map(item => ({id: item.id, earlyResidualDb: item.row.earlyResidualDb, lateResidualDb: item.row.lateResidualDb,
          postAttackShapeErrorDb: item.row.postAttackShapeErrorDb}))};
  } catch (caught) {
    error = redact(caught.message, {repo: roots.repo, home: roots.home, archive: archivePath});
    result = {status: caught.code === 'PCM_METRIC_MISMATCH' ? 'FAIL' : 'BLOCKED', code: caught.code || caught.message.split(':')[0], error};
  }
  const after = core.snapshotSources(roots);
  if (!sameSnapshots(before, after)) result = {status: 'FAIL', code: 'PARENT_SNAPSHOT_CHANGED'};
  const gate2 = result.status === 'PASS' ? {status: 'PASS', ...result} : {status: result.status, ...result};
  const beforeSha256 = sha(core.jsonBytes(core.stable(before))), afterSha256 = sha(core.jsonBytes(core.stable(after)));
  const reportOutcome = result.status !== 'PASS' ? 'EVIDENCE_UNVERIFIABLE'
    : forensic?.historicExecutableIdentity === 'VERIFIED_ORIGINAL' ? 'GATE0_2_VERIFIED_AWAITING_PUBLICATION'
      : 'GATE0_2_IMPLEMENTED_BUT_PRIVATE_EVIDENCE_BLOCKED';
  const reportText = core.buildReport({outcome: reportOutcome,
    gate1: forensic ? {status: forensic.historicExecutableIdentity === 'VERIFIED_ORIGINAL' ? 'PASS' : 'BLOCKED', ...forensic} : {status: 'NOT RUN'},
    gate2, historicExecutableIdentity: forensic?.historicExecutableIdentity,
    storedPcmEvaluation: result.status === 'PASS' ? 'PCM_METRICS_RECOMPUTED_AND_MATCHED' : 'UNVERIFIABLE_SOURCE_DATA',
    sourceSnapshots: {unchanged: sameSnapshots(before, after), beforeSha256, afterSha256,
      rootCauseBaseline: parentAnchor, stores: core.summarizeSources(before)}, delivery: deliveryIdentity(roots.repo)});
  return {status: result.status, result, forensic, reportText, roots, snapshots: {before, after}};
}
function verifyPublishedReport(roots) {
  let report, manifest;
  try {
    report = core.readDual(roots.offline, 'report.json');
    manifest = core.readDual(roots.offline, 'manifest.json');
  } catch (error) {
    if (/DUAL_COPY_MISSING/.test(error.message)) throw new Error('BLOCKED_PUBLICATION:PARTIAL_PUBLICATION_PRESERVED');
    if (/DUAL_COPY_DIVERGED/.test(error.message)) throw new Error('BLOCKED_PUBLICATION:DIVERGENT_PUBLICATION_PRESERVED');
    throw error;
  }
  if (!report && !manifest) return {status: 'NOT_PUBLISHED'};
  if (!report || !manifest) throw new Error('BLOCKED_PUBLICATION:PARTIAL_PUBLICATION_PRESERVED');
  let reportValue, manifestValue;
  try { reportValue = JSON.parse(report.bytes.toString('utf8')); manifestValue = JSON.parse(manifest.bytes.toString('utf8')); }
  catch { throw new Error('BLOCKED_PUBLICATION:INVALID_PUBLISHED_JSON'); }
  if (!core.jsonBytes(reportValue).equals(report.bytes) || !core.jsonBytes(manifestValue).equals(manifest.bytes)) throw new Error('BLOCKED_PUBLICATION:NONCANONICAL_PUBLISHED_JSON');
  if (manifestValue.schemaVersion !== 1 || manifestValue.issue !== 7 || manifestValue.epoch !== core.EPOCH
      || manifestValue.reportSha256 !== report.sha256 || !Array.isArray(manifestValue.files)
      || JSON.stringify(manifestValue.files) !== JSON.stringify(PUBLISH_FILES)
      || !/^[a-f0-9]{40}$/.test(manifestValue.head)) throw new Error('BLOCKED_PUBLICATION:MANIFEST_IDENTITY_MISMATCH');
  if (reportValue.outcome !== 'GATE0_2_VERIFIED_AND_PUBLISHED' || reportValue.issue !== 7 || reportValue.epoch !== core.EPOCH
      || reportValue.delivery?.repository !== REPOSITORY || reportValue.delivery?.issue !== 7
      || reportValue.delivery?.prUrl !== `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`
      || reportValue.delivery?.prBranch !== PR_BRANCH || reportValue.delivery?.currentHead !== manifestValue.head
      || reportValue.gate1?.status !== 'PASS' || reportValue.gate2?.status !== 'PASS'
      || reportValue.historicExecutableIdentity !== 'VERIFIED_ORIGINAL'
      || reportValue.storedPcmEvaluation !== 'PCM_METRICS_RECOMPUTED_AND_MATCHED'
      || reportValue.publication !== 'IMMUTABLE_MANIFEST_REQUIRED'
      || reportValue.gate0?.acousticCalls !== 0 || reportValue.gate0?.builds !== 0 || reportValue.gate0?.renders !== 0
      || reportValue.sourceSnapshots?.unchanged !== true || reportValue.sourceSnapshots?.beforeSha256 !== reportValue.sourceSnapshots?.afterSha256
      || reportValue.productAcousticAcceptance !== 'BLOCKED' || reportValue.stage3 !== 'NOT EVALUATED'
      || reportValue.stage4 !== 'NOT EVALUATED') throw new Error('BLOCKED_PUBLICATION:REPORT_POSTCONDITION_MISMATCH');
  return {status: 'PASS', reportSha256: report.sha256, manifestSha256: manifest.sha256,
    primarySecondaryBytesMatch: true, head: manifestValue.head};
}
function readGhJson(args) {
  return JSON.parse(rtk(['gh', ...args, '--repo', REPOSITORY]));
}
function verifyPublicationAuthority({head, branch = PR_BRANCH, issue, pr, approval} = {}) {
  if (!head || branch !== PR_BRANCH || !pr || pr.state !== 'OPEN' || pr.headRefName !== PR_BRANCH || pr.headRefOid !== head
      || pr.baseRefName !== 'main' || pr.number !== PR_NUMBER) throw new Error('BLOCKED_PUBLICATION:PR_HEAD_OR_BRANCH_MISMATCH');
  if (!issue || issue.state !== 'OPEN' || !issue.labels?.some(label => label.name === 'phase:implementation')) throw new Error('BLOCKED_PUBLICATION:ISSUE_APPROVAL_MISSING');
  if (String(approval?.id) !== APPROVAL_COMMENT_ID || approval?.user?.login !== 'puchinya'
      || !approval?.body?.includes('実装・テスト・push・既存PR #8')) {
    throw new Error('BLOCKED_PUBLICATION:APPROVAL_COMMENT_MISMATCH');
  }
  const upstreamBranch = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstreamBranch !== `origin/${PR_BRANCH}`) throw new Error('BLOCKED_PUBLICATION:UPSTREAM_BRANCH_MISMATCH');
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('BLOCKED_PUBLICATION:WORKTREE_NOT_CLEAN');
  if (git(['rev-parse', 'HEAD']) !== head) throw new Error('BLOCKED_PUBLICATION:LOCAL_HEAD_MISMATCH');
  return true;
}
function fsyncFile(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function safeDir(base, target) {
  const absolute = path.resolve(target);
  if (!core.inside(base, absolute)) throw new Error('BLOCKED_PUBLICATION:ROOT_ESCAPE');
  let current = base;
  for (const part of path.relative(base, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('BLOCKED_PUBLICATION:UNSAFE_DIRECTORY');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(current, {mode: 0o700});
    }
  }
  return absolute;
}
function ownLock(directory, ownerId) {
  const lockPath = path.join(directory, 'publish.lock');
  const bytes = Buffer.from(`${JSON.stringify({ownerId, pid: process.pid, host: os.hostname()})}\n`);
  fsyncFile(lockPath, bytes);
  return {lockPath, ownerId};
}
function releaseOwnLock(lock) {
  const bytes = fs.readFileSync(lock.lockPath);
  const record = JSON.parse(bytes.toString('utf8'));
  if (record.ownerId !== lock.ownerId) throw new Error('BLOCKED_PUBLICATION:LOCK_OWNER_CHANGED');
  fs.unlinkSync(lock.lockPath);
  fsyncDirectory(path.dirname(lock.lockPath));
}
function existingPublication(roots, reportBytes, manifestBytes) {
  const files = ['report.json', 'manifest.json'];
  const readAt = root => Object.fromEntries(files.map(name => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return [name, null];
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BLOCKED_PUBLICATION:UNSAFE_EXISTING_FILE');
    return [name, fs.readFileSync(file)];
  }));
  const primary = readAt(roots.primary), secondary = readAt(roots.secondary);
  if (files.every(name => primary[name] && secondary[name]) && files.every(name => primary[name].equals(secondary[name]))) {
    if (primary['report.json'].equals(reportBytes) && primary['manifest.json'].equals(manifestBytes)) return 'REUSED';
    throw new Error('BLOCKED_PUBLICATION:IMMUTABLE_CONTENT_CONFLICT');
  }
  if (files.some(name => primary[name] || secondary[name])) throw new Error('BLOCKED_PUBLICATION:PARTIAL_PUBLICATION_PRESERVED');
  return null;
}
function publishReport({reportText, roots, head, branch = PR_BRANCH, issue, pr, approval,
  ownerId = crypto.randomUUID(), authorityVerifier = verifyPublicationAuthority, beforeImmutableWrite = () => {}} = {}) {
  authorityVerifier({head, branch, issue, pr, approval});
  const report = JSON.parse(reportText);
  if (report.outcome !== 'GATE0_2_VERIFIED_AND_PUBLISHED'
      || report.gate0?.acousticCalls !== 0 || report.gate0?.builds !== 0 || report.gate0?.renders !== 0
      || report.productAcousticAcceptance !== 'BLOCKED' || report.stage3 !== 'NOT EVALUATED' || report.stage4 !== 'NOT EVALUATED') {
    throw new Error('BLOCKED_PUBLICATION:REPORT_INCOMPLETE');
  }
  if (report.delivery?.currentHead !== head || report.delivery?.prBranch !== branch
      || report.delivery?.repository !== REPOSITORY || report.delivery?.issue !== 7) throw new Error('BLOCKED_PUBLICATION:REPORT_HEAD_OR_BRANCH_MISMATCH');
  const before = core.snapshotSources(roots);
  const primary = safeDir(roots.commonDirectory, roots.offline.primary), secondary = safeDir(roots.home, roots.offline.secondary);
  if (primary === secondary || core.inside(primary, secondary) || core.inside(secondary, primary)) throw new Error('BLOCKED_PUBLICATION:ROOTS_OVERLAP');
  const reportBytes = Buffer.from(reportText), reportSha256 = sha(reportBytes);
  const manifestBytes = Buffer.from(`${JSON.stringify({schemaVersion: 1, issue: 7, epoch: core.EPOCH, head, reportSha256,
    files: PUBLISH_FILES}, null, 2)}\n`);
  const prior = existingPublication(roots.offline, reportBytes, manifestBytes);
  if (prior) return {status: prior, reportSha256, unchangedMtime: true};
  let lockPrimary = null, lockSecondary = null, writeStarted = false;
  try {
    lockPrimary = ownLock(primary, ownerId);
    lockSecondary = ownLock(secondary, ownerId);
    fsyncDirectory(primary); fsyncDirectory(secondary);
    writeStarted = true;
    beforeImmutableWrite('primary:report.json');
    fsyncFile(path.join(primary, 'report.json'), reportBytes);
    beforeImmutableWrite('secondary:report.json');
    fsyncFile(path.join(secondary, 'report.json'), reportBytes);
    beforeImmutableWrite('primary:manifest.json');
    fsyncFile(path.join(primary, 'manifest.json'), manifestBytes);
    beforeImmutableWrite('secondary:manifest.json');
    fsyncFile(path.join(secondary, 'manifest.json'), manifestBytes);
    for (const root of [primary, secondary]) {
      for (const name of PUBLISH_FILES) {
        const expected = name === 'report.json' ? reportBytes : manifestBytes;
        if (!fs.readFileSync(path.join(root, name)).equals(expected)) throw new Error('BLOCKED_PUBLICATION:READBACK_MISMATCH');
      }
      fsyncDirectory(root);
    }
    const after = core.snapshotSources(roots);
    if (!sameSnapshots(before, after)) throw new Error('BLOCKED_PUBLICATION:PARENT_CHANGED_DURING_PUBLICATION');
    releaseOwnLock(lockPrimary); lockPrimary = null;
    releaseOwnLock(lockSecondary); lockSecondary = null;
    return {status: 'PUBLISHED', reportSha256, manifestSha256: sha(manifestBytes), readback: 'MATCHED_BOTH_COPIES'};
  } catch (error) {
    // Before any immutable report byte is written, release only locks whose
    // ownership still matches this invocation. A partial publication keeps locks.
    if (!writeStarted) {
      try { if (lockPrimary) releaseOwnLock(lockPrimary); } catch {}
      try { if (lockSecondary) releaseOwnLock(lockSecondary); } catch {}
    }
    // Partial report/manifest bytes are deliberately retained for manual recovery.
    throw error;
  }
}
function collectAuthority(head, adapters = {}) {
  const query = adapters.readGhJson || readGhJson;
  const readApproval = adapters.readApproval || (() => JSON.parse(rtk(['gh', 'api', `repos/${REPOSITORY}/issues/comments/${APPROVAL_COMMENT_ID}`])));
  const verify = adapters.verifyPublicationAuthority || verifyPublicationAuthority;
  const issue = query(['issue', 'view', '7', '--json', 'state,labels']);
  const pr = query(['pr', 'view', '8', '--json', 'state,headRefName,headRefOid,baseRefName,number,body,url']);
  const approval = readApproval();
  if (!pr.body?.includes('Closes #7')) throw new Error('BLOCKED_PUBLICATION:PR_ISSUE_ATTRIBUTION_MISSING');
  verify({head, issue, pr, approval});
  return {issue, pr, approval};
}
function runPublish(options = {}) {
  const analysisRun = runAnalysis(options);
  if (analysisRun.status !== 'PASS' || analysisRun.forensic?.historicExecutableIdentity !== 'VERIFIED_ORIGINAL') {
    return {status: 'BLOCKED', code: 'BLOCKED_PUBLICATION:ANALYSIS_NOT_FULLY_VERIFIED', reportText: analysisRun.reportText};
  }
  const prePublishReport = JSON.parse(analysisRun.reportText);
  prePublishReport.outcome = 'GATE0_2_VERIFIED_AND_PUBLISHED';
  prePublishReport.publication = 'IMMUTABLE_MANIFEST_REQUIRED';
  analysisRun.reportText = `${JSON.stringify(core.stable(prePublishReport), null, 2)}\n`;
  const head = git(['rev-parse', 'HEAD'], options.root || ROOT), authority = collectAuthority(head);
  const publish = publishReport({...authority, head, reportText: analysisRun.reportText, roots: analysisRun.roots});
  return {status: publish.status, publish, reportText: analysisRun.reportText};
}
function run() {
  const mode = process.argv[2];
  if (!['--forensic', '--analyze', '--verify', '--publish'].includes(mode) || process.argv.length !== 3) {
    process.stderr.write('usage: run-issue7-physical-root-cause-offline-v1.cjs --forensic|--analyze|--verify|--publish\n');
    process.exitCode = 2; return;
  }
  try {
    if (mode === '--forensic') process.stdout.write(`${JSON.stringify(classifyForensic(), null, 2)}\n`);
    else if (mode === '--analyze') {
      const result = runAnalysis();
      process.stdout.write(result.reportText);
      if (result.status !== 'PASS') process.exitCode = 2;
    } else if (mode === '--verify') {
      const result = runAnalysis();
      const publication = verifyPublishedReport(result.roots);
      if (publication.status === 'PASS') process.stdout.write(`${JSON.stringify({verification: publication, report: JSON.parse(core.readDual(result.roots.offline, 'report.json').bytes.toString('utf8'))}, null, 2)}\n`);
      else process.stdout.write(result.reportText);
      if (result.status !== 'PASS' || publication.status === 'BLOCKED') process.exitCode = 2;
    } else {
      const result = runPublish();
      process.stdout.write(result.reportText || `${JSON.stringify(result, null, 2)}\n`);
      if (result.status !== 'PUBLISHED' && result.status !== 'REUSED') process.exitCode = 2;
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({status: 'BLOCKED', error: redact(error.message)}, null, 2)}\n`);
    process.exitCode = 2;
  }
}
if (require.main === module) run();

module.exports = {ROOT, REPOSITORY, PR_NUMBER, PR_BRANCH, APPROVAL_COMMENT_ID, PUBLISH_FILES,
  sha, redact, classifyBinaryIdentity, classifyForensic, locateArchive, runAnalysis, verifyPublicationAuthority, publishReport,
  verifyPublishedReport, collectAuthority, runPublish, run};
