#!/usr/bin/env node
'use strict';

// Independent, append-only owner for Issue #7's approved contact-loss epoch.
// This file intentionally does not import the v3/v4/v5 experiment runners.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {execFileSync, spawnSync} = require('node:child_process');
const core = require('./issue7-contact-loss-v1-core.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const REPOSITORY = 'puchinya/soraoto_dsl';
const PR_NUMBER = 8;
const PR_BRANCH = 'codex/issue-7-supersynth-v9';
const LOCAL_WORKTREE_BRANCH = 'codex/issue-7-pr8-root-cause-review';
const PR_URL = `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`;
const ISSUE_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED';
const CONTRACT_SHA256 = '54838dfea9832f6da358a1c620567b09246a54fdd26fb807bc74d4ceeb6dc4aa';
const OFFLINE_EPOCH_PREFIX = 'physical-root-cause-offline-v1/analysis-';
const OFFLINE_FILES = Object.freeze(['report.json', 'manifest.json']);
const SOURCE_FILES = Object.freeze([
  'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-amendment.md',
  'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-design.md',
  'wasm/CMakeLists.txt',
  'wasm/cmake/wasm_plugin.cmake',
  'wasm/cmake/wasm32-clang.cmake',
  'wasm/cmake/generate_plugin_metadata.py',
  'wasm/cmake/super_synth_metadata.py',
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h',
  'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json',
  'wasm/test/helpers/plugin-harness.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/physical-fit-v4-loss.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-identification.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage4-lifecycle.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage4-full-range-evaluator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3-production-recovery.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-current-build-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
  'wasm/plugins/dsp/super-synth/test/supersynth-v9-full-range-calibration.test.js',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-contact-loss-v1-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-contact-loss-v1-core.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'
]);
const EXPERIMENT_REL = 'experiment';
const DIAGNOSTIC_BUILD_REL = process.env.ISSUE7_CONTACT_LOSS_BUILD_DIR || 'build/wasm-contact-loss';
const WASM_REL = 'plugins/dsp/super-synth/plugin.wasm';
const SAMPLE_RATE = 48000;
const RENDER_FRAMES = 24000;
const BLOCK_FRAMES = 128;
const ACCEPTANCE_ROOT = 'acceptance';
const CONFIRMATION_LAYERS = Object.freeze([14, 31, 36, 61, 124]);
const RELEASE_BUILD_REL = process.env.ISSUE7_CONTACT_LOSS_RELEASE_BUILD_DIR || 'build/wasm-contact-loss-release';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`); }
function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function assertSafe(base, candidate) {
  const anchor = path.resolve(base), absolute = path.resolve(candidate);
  if (!inside(anchor, absolute)) throw new Error('BLOCKED_CONTACT_LOSS_PATH_ESCAPE');
  let cursor = anchor;
  try {
    const rootStat = fs.lstatSync(cursor);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || fs.realpathSync(cursor) !== cursor) {
      throw new Error('BLOCKED_CONTACT_LOSS_ROOT_UNSAFE');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const part of path.relative(anchor, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_SYMLINK');
      if (cursor !== absolute && !stat.isDirectory()) throw new Error('BLOCKED_CONTACT_LOSS_PATH_NOT_DIRECTORY');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
function resolveRoots({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const repo = fs.realpathSync(path.resolve(root)), homePath = fs.realpathSync(path.resolve(home));
  const common = fs.realpathSync(path.resolve(commonDirectory || execFileSync('rtk',
    ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: repo, encoding: 'utf8'}).trim()));
  const suffix = path.join('soraoto-agent-state', '7', 'physical-contact-loss-v1', 'experiment-01');
  const archiveSuffix = path.join('.soraoto-agent-archive', 'soraoto_dsl', '7', 'physical-contact-loss-v1', 'experiment-01');
  const roots = {repo, home: homePath, commonDirectory: common,
    primary: path.join(common, suffix), secondary: path.join(homePath, archiveSuffix)};
  assertSafe(common, roots.primary);
  assertSafe(homePath, roots.secondary);
  return roots;
}
function relativeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/).some(part => part === '..' || part === '.')) {
    throw new Error('BLOCKED_CONTACT_LOSS_RELATIVE_PATH');
  }
  return assertSafe(root, path.join(root, relative));
}
function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readDual(roots, relative, {required = false} = {}) {
  const files = [relativeFile(roots.primary, relative), relativeFile(roots.secondary, relative)];
  const exists = files.map(file => {
    try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_NONREGULAR_FILE'); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  if (!exists[0] && !exists[1]) {
    if (required) throw new Error(`BLOCKED_CONTACT_LOSS_MISSING:${relative}`);
    return null;
  }
  if (exists[0] !== exists[1]) throw new Error(`BLOCKED_CONTACT_LOSS_DUAL_COPY_MISSING:${relative}`);
  const a = fs.readFileSync(files[0]), b = fs.readFileSync(files[1]);
  if (!a.equals(b)) throw new Error(`BLOCKED_CONTACT_LOSS_DUAL_COPY_DIVERGED:${relative}`);
  return {bytes: a, sha256: sha256(a)};
}
function mkdirSafe(root, directory) {
  const target = assertSafe(root, directory);
  const missing = [];
  let cursor = target;
  while (!fs.existsSync(cursor)) { missing.push(cursor); cursor = path.dirname(cursor); }
  for (const item of missing.reverse()) {
    fs.mkdirSync(item);
    const stat = fs.lstatSync(item);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_DIRECTORY_CREATE');
  }
  assertSafe(root, target);
  return target;
}
function createImmutable(root, relative, bytes) {
  const file = relativeFile(root, relative), directory = path.dirname(file);
  mkdirSafe(root, directory);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fsyncDirectory(directory);
  return file;
}
function writeDualImmutable(roots, relative, bytes) {
  const value = Buffer.from(bytes), prior = readDual(roots, relative);
  if (prior) {
    if (!prior.bytes.equals(value)) throw new Error(`BLOCKED_CONTACT_LOSS_IMMUTABLE_CONFLICT:${relative}`);
    return {status: 'REUSED', sha256: prior.sha256, bytes: value.length};
  }
  // Each side is created exclusively. If either creation fails, preserve the partial
  // state so readback blocks automatic repair or overwrite on a later invocation.
  createImmutable(roots.primary, relative, value);
  createImmutable(roots.secondary, relative, value);
  const check = readDual(roots, relative, {required: true});
  if (!check.bytes.equals(value)) throw new Error(`BLOCKED_CONTACT_LOSS_READBACK:${relative}`);
  return {status: 'CREATED', sha256: check.sha256, bytes: value.length};
}
function readJsonDual(roots, relative, options) {
  const stored = readDual(roots, relative, options);
  if (!stored) return null;
  let value;
  try { value = JSON.parse(stored.bytes.toString('utf8')); } catch { throw new Error(`BLOCKED_CONTACT_LOSS_JSON:${relative}`); }
  if (!jsonBytes(value).equals(stored.bytes)) throw new Error(`BLOCKED_CONTACT_LOSS_NONCANONICAL_JSON:${relative}`);
  return {value, ...stored};
}
function syncReadSha(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_ARTIFACT_TYPE');
  const before = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
  const bytes = fs.readFileSync(file), afterStat = fs.lstatSync(file);
  const after = [afterStat.dev, afterStat.ino, afterStat.size, afterStat.mtimeMs, afterStat.ctimeMs].join(':');
  if (before !== after || bytes.length !== stat.size) throw new Error('BLOCKED_CONTACT_LOSS_ARTIFACT_CHANGED_DURING_READ');
  return {bytes, size: bytes.length, sha256: sha256(bytes), mtimeMs: stat.mtimeMs};
}
function git(root, args) {
  return execFileSync('rtk', ['git', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
}
function gitBytes(root, args) {
  return execFileSync('rtk', ['proxy', 'git', ...args], {cwd: root, stdio: ['ignore', 'pipe', 'ignore']});
}
function github(args, {cwd = ROOT} = {}) {
  const result = spawnSync('rtk', ['gh', ...args], {cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (result.error || result.status !== 0) throw new Error('BLOCKED_CONTACT_LOSS_GITHUB_READBACK');
  return result.stdout.trim();
}
function currentIdentity(root = ROOT) {
  const status = git(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);
  const lines = status.split(/\r?\n/), oid = lines.find(line => line.startsWith('# branch.oid '))?.slice('# branch.oid '.length);
  const branch = lines.find(line => line.startsWith('# branch.head '))?.slice('# branch.head '.length);
  if (!oid || !/^[a-f0-9]{40}$/.test(oid) || !branch || lines.some(line => line && !line.startsWith('# '))) {
    throw new Error('BLOCKED_CONTACT_LOSS_DIRTY_OR_UNIDENTIFIED_WORKTREE');
  }
  return {head: oid, branch};
}
function verifiedPullRequest(root, expectedHead) {
  const pr = JSON.parse(github(['pr', 'view', String(PR_NUMBER), '--repo', REPOSITORY,
    '--json', 'state,number,headRefName,headRefOid,baseRefName,url'], {cwd: root}));
  if (pr.state !== 'OPEN' || pr.number !== PR_NUMBER || pr.headRefName !== PR_BRANCH
      || pr.headRefOid !== expectedHead || pr.baseRefName !== 'main' || pr.url !== PR_URL) {
    throw new Error('BLOCKED_CONTACT_LOSS_PR_HEAD_OR_BRANCH');
  }
  return pr;
}
function verifyIssueApproval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY, '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN') throw new Error('BLOCKED_CONTACT_LOSS_ISSUE_CLOSED');
  const labels = (issue.labels || []).map(row => row.name);
  if (!labels.includes('phase:implementation')) throw new Error('BLOCKED_CONTACT_LOSS_ISSUE_PHASE');
  if (String(issue.body || '').includes(ISSUE_APPROVAL_MARKER)) return true;
  const comments = JSON.parse(github(['api', `repos/${REPOSITORY}/issues/7/comments?per_page=100`], {cwd: root}));
  if (!Array.isArray(comments) || !comments.some(row => String(row.body || '').includes(ISSUE_APPROVAL_MARKER))) {
    throw new Error('BLOCKED_CONTACT_LOSS_ISSUE_APPROVAL_MISSING');
  }
  return true;
}
function fileSnapshot(root, relative) {
  const file = path.join(root, relative), info = syncReadSha(file);
  return {sha256: info.sha256, size: info.size, mtimeMs: info.mtimeMs};
}
function sourceSnapshot(root) {
  return Object.fromEntries(SOURCE_FILES.map(relative => [relative, fileSnapshot(root, relative)]));
}
function sameJson(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function latestOfflineReport(root, home, commonDirectory, expectedHead) {
  const offlineCore = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const roots = offlineCore.resolveInputRoots({root, home, commonDirectory});
  const primaryBase = roots.offlineBase.primaryRoot, secondaryBase = roots.offlineBase.secondaryRoot;
  let primary = [], secondary = [];
  try { primary = fs.readdirSync(primaryBase).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { secondary = fs.readdirSync(secondaryBase).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!primary.length || !sameJson(primary, secondary)) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_COPIES');
  const numbers = primary.map(name => Number(name.slice('analysis-'.length)));
  if (numbers.length < 4 || numbers.some((number, index) => number !== index + 1)) {
    throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_SEQUENCE');
  }
  const latest = primary.at(-1), number = Number(latest.slice('analysis-'.length));
  let report, manifest, value, manifestValue;
  for (const item of numbers) {
    const pair = offlineCore.resolveOfflinePair(roots, item);
    const primaryMembers = fs.readdirSync(pair.primary).sort(), secondaryMembers = fs.readdirSync(pair.secondary).sort();
    if (!sameJson(primaryMembers, [...OFFLINE_FILES].sort()) || !sameJson(primaryMembers, secondaryMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_MEMBERS');
    }
    const storedReport = offlineCore.readDual(pair, 'report.json'), storedManifest = offlineCore.readDual(pair, 'manifest.json');
    if (!storedReport || !storedManifest) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_INCOMPLETE');
    const previousValue = JSON.parse(storedReport.bytes.toString('utf8'));
    const previousManifest = JSON.parse(storedManifest.bytes.toString('utf8'));
    if (!offlineCore.jsonBytes(previousValue).equals(storedReport.bytes)
        || !offlineCore.jsonBytes(previousManifest).equals(storedManifest.bytes)
        || previousValue.epoch !== `${OFFLINE_EPOCH_PREFIX}${String(item).padStart(2, '0')}`
        || previousManifest.schemaVersion !== 1 || previousManifest.issue !== 7
        || previousManifest.epoch !== previousValue.epoch || previousManifest.reportSha256 !== storedReport.sha256
        || !sameJson(previousManifest.files, OFFLINE_FILES) || !/^[a-f0-9]{40}$/.test(previousManifest.head || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_PRIOR_EPOCH_INVALID');
    }
    if (item === number) { report = storedReport; manifest = storedManifest; value = previousValue; manifestValue = previousManifest; }
  }
  if (value.epoch !== `${OFFLINE_EPOCH_PREFIX}${String(number).padStart(2, '0')}`
      || value.outcome !== 'GATE0_2_VERIFIED_AND_PUBLISHED'
      || value.delivery?.currentHead !== expectedHead || value.delivery?.prBranch !== PR_BRANCH
      || manifestValue.head !== expectedHead
      || value.gate0?.status !== 'PASS' || value.gate0?.acousticCalls !== 0
      || value.gate1?.status !== 'PASS' || value.gate1?.predicate !== 'RECOVERED_IDENTICAL'
      || value.gate2?.status !== 'PASS' || value.gate2?.comparison?.result !== 'PCM_METRICS_RECOMPUTED_AND_MATCHED'
      || value.gate2?.cellCount !== 140 || manifestValue.reportSha256 !== report.sha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_REPORT_NOT_CURRENT_AND_VERIFIED');
  }
  return {number, epoch: value.epoch, reportSha256: report.sha256, manifestSha256: manifest.sha256, report: value, roots};
}

function locateArchive(home = os.homedir()) {
  const explicit = process.env.ISSUE7_SALAMANDER_ARCHIVE_PATH;
  if (explicit) return path.resolve(explicit);
  return require('./analyze-issue7-physical-identification.cjs')
    .locateGoogleDriveArchive({cloudStorage: path.join(home, 'Library', 'CloudStorage')});
}
function frozenSourceSnapshot({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const offline = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const roots = offline.resolveInputRoots({root, home, commonDirectory});
  const primary = fs.readdirSync(roots.offlineBase.primaryRoot).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort();
  const secondary = fs.readdirSync(roots.offlineBase.secondaryRoot).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort();
  if (!primary.length || !sameJson(primary, secondary)) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_COPIES');
  const offlineEpochs = {};
  for (const name of primary) {
    const number = Number(name.slice('analysis-'.length)), pair = offline.resolveOfflinePair(roots, number);
    const membersA = fs.readdirSync(pair.primary).sort(), membersB = fs.readdirSync(pair.secondary).sort();
    if (!sameJson(membersA, [...OFFLINE_FILES].sort()) || !sameJson(membersA, membersB)) {
      throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_MEMBERS');
    }
    const records = {};
    for (const relative of OFFLINE_FILES) {
      const stored = offline.readDual(pair, relative);
      if (!stored) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_INCOMPLETE');
      const filePrimary = path.join(pair.primary, relative), fileSecondary = path.join(pair.secondary, relative);
      const stat = file => { const value = fs.lstatSync(file); return {sha256: stored.sha256, size: value.size, mtimeMs: value.mtimeMs}; };
      records[relative] = {primary: stat(filePrimary), secondary: stat(fileSecondary)};
    }
    offlineEpochs[name] = records;
  }
  return {parentEvidence: offline.snapshotSources(roots), offlineEpochs};
}
function frozenSnapshotSha256(snapshot) { return sha256(Buffer.from(JSON.stringify(stable(snapshot)))); }
function assertFrozenSnapshotMatches(actual, prepare) {
  const expected = prepare?.frozenEvidenceSnapshot;
  if (!expected || !sameJson(actual, expected)) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_DRIFT');
  // Older immutable prepare records bind the full snapshot directly; derive
  // this redundant digest instead of rewriting those records.
  const expectedSha256 = prepare.gate3?.frozenSnapshotSha256 || frozenSnapshotSha256(expected);
  if (frozenSnapshotSha256(actual) !== expectedSha256) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_DRIFT');
  return true;
}
function gate3Analysis({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const identity = currentIdentity(root), pr = verifiedPullRequest(root, identity.head);
  const offline = latestOfflineReport(root, home, commonDirectory, identity.head);
  const offlineCore = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const inputs = offlineCore.resolveInputRoots({root, home, commonDirectory});
  const before = frozenSourceSnapshot({root, home, commonDirectory}), records = offlineCore.verifyFrozenRecords(inputs);
  const archive = locateArchive(home);
  if (!archive) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_ARCHIVE_MISSING');
  const observations = [
    ...offlineCore.readVerifiedV3Rows(inputs, records.p5History.value),
    ...offlineCore.readVerifiedV4Rows(inputs, records.p5History.value, records.p3Result.value)
  ];
  if (observations.length !== 20) throw new Error('BLOCKED_CONTACT_LOSS_HISTORICAL_OBSERVATION_COUNT');
  const reference = offlineCore.readVerifiedReference(archive, records.p3Manifest.value);
  const recomputed = offlineCore.recomputeOfficial({rows: observations, reference, gainDb: records.sharedGainOffsetDb});
  const comparison = offlineCore.compareHistory(recomputed, records.p5History.value, {db: 1e-6, nonDb: 1e-8});
  const after = frozenSourceSnapshot({root, home, commonDirectory});
  if (!sameJson(before, after)) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED');
  if (comparison.result !== 'PCM_METRICS_RECOMPUTED_AND_MATCHED') throw new Error('BLOCKED_CONTACT_LOSS_HISTORICAL_PCM_MISMATCH');
  const sourceRows = recomputed.flatMap(observation => observation.metrics.map(row => ({id: observation.id,
    source: observation.source, pitch: row.pitch, velocity: row.velocity,
    earlyResidualDb: row.earlyResidualDb, lateResidualDb: row.lateResidualDb,
    postAttackShapeErrorDb: row.postAttackShapeErrorDb, hardFailures: row.hardFailures,
    finite: row.finite, guardHits: row.guardHits, peakDbfs: row.peakDbfs})));
  return {status: 'GATE3_ANALYSIS_PASS', contractSha256: CONTRACT_SHA256, head: identity.head, branch: identity.branch,
    prUrl: pr.url, offlineEpoch: offline.epoch, offlineReportSha256: offline.reportSha256,
    archiveSha256: reference.archiveSha256, observationCount: observations.length, cellCount: recomputed.reduce((sum, row) => sum + row.rows.length, 0),
    comparison, sourceRows, hypothesis: 'HAMMER_CONTACT_DISSIPATION_HYPOTHESIS',
    causalStatus: 'NOT_CONFIRMED', stage3: 'NOT EVALUATED', stage4: 'NOT EVALUATED',
    frozenSnapshotSha256: frozenSnapshotSha256(before)};
}

function verifyDiagnosticBuild(root, expectedHead, options = {}) {
  const buildDirectory = path.resolve(root, options.buildDirectory || DIAGNOSTIC_BUILD_REL);
  const cachePath = path.join(buildDirectory, 'CMakeCache.txt'), wasmPath = path.join(buildDirectory, WASM_REL);
  const cache = fs.readFileSync(cachePath, 'utf8');
  const option = (name, value) => new RegExp(`^${name}:[^=]+=${value}$`, 'm').test(cache);
  if (!option('BUILD_TESTING', 'ON') || !option('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS', 'ON')
      || !option('SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS', 'ON')
      || !option('SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS', 'OFF')
      || !cache.includes(`CMAKE_HOME_DIRECTORY:INTERNAL=${path.join(root, 'wasm')}`)
      || !cache.includes(`CMAKE_TOOLCHAIN_FILE:FILEPATH=${path.join(root, 'wasm/cmake/wasm32-clang.cmake')}`)) {
    throw new Error('BLOCKED_CONTACT_LOSS_DIAGNOSTIC_BUILD_OPTIONS');
  }
  const objectPath = path.join(buildDirectory, 'plugins/dsp/super-synth/CMakeFiles/soraoto_dsp_super_synth.dir/src/plugin.c.obj');
  const objectStat = fs.statSync(objectPath), wasm = syncReadSha(wasmPath);
  const compileInputs = ['wasm/plugins/dsp/super-synth/src/plugin.c', 'wasm/CMakeLists.txt',
    'wasm/cmake/wasm_plugin.cmake', 'wasm/plugins/dsp/super-synth/presets.json',
    'wasm/shared/generated/super-synth_grand_profiles.h'];
  if (compileInputs.some(relative => fs.statSync(path.join(root, relative)).mtimeMs > objectStat.mtimeMs)
      || wasm.mtimeMs < objectStat.mtimeMs) throw new Error('BLOCKED_CONTACT_LOSS_STALE_DIAGNOSTIC_BUILD');
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm.bytes)).map(row => row.name);
  for (const name of ['soraoto_supersynth_contact_loss_set', 'soraoto_supersynth_contact_loss_get',
    'soraoto_supersynth_guard_hit_count', 'soraoto_supersynth_active_voice_count']) {
    if (!exports.includes(name)) throw new Error('BLOCKED_CONTACT_LOSS_DIAGNOSTIC_EXPORTS');
  }
  const source = sourceSnapshot(root);
  return {head: expectedHead, source, diagnosticBuildDirectory: path.relative(root, buildDirectory),
    wasm: {sha256: wasm.sha256, size: wasm.size, exports: exports.filter(name => name.startsWith('soraoto_supersynth_contact_loss_')).sort()}};
}

function prepareExperiment({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory}), identity = currentIdentity(root);
  if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  const analysis = gate3Analysis({root, home, commonDirectory});
  if (analysis.status !== 'GATE3_ANALYSIS_PASS' || analysis.cellCount !== 140) throw new Error('BLOCKED_CONTACT_LOSS_GATE3');
  const frozenEvidenceSnapshot = frozenSourceSnapshot({root, home, commonDirectory});
  if (frozenSnapshotSha256(frozenEvidenceSnapshot) !== analysis.frozenSnapshotSha256) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED');
  const source = sourceSnapshot(root), build = verifyDiagnosticBuild(root, identity.head, {buildDirectory});
  const record = {schemaVersion: 1, issue: 7, pr: 8, prUrl: PR_URL, branch: PR_BRANCH, head: identity.head,
    contractSha256: CONTRACT_SHA256, approvalMarker: ISSUE_APPROVAL_MARKER,
    gate3: {status: analysis.status, offlineEpoch: analysis.offlineEpoch, offlineReportSha256: analysis.offlineReportSha256,
      archiveSha256: analysis.archiveSha256, observationCount: analysis.observationCount, cellCount: analysis.cellCount,
      causalStatus: analysis.causalStatus, hypothesis: analysis.hypothesis,
      frozenSnapshotSha256: analysis.frozenSnapshotSha256},
    source, build, frozenEvidenceSnapshot, plan: core.plan(), startedCalls: 0, completedCalls: 0, ambiguousCalls: 0,
    budget: core.accounting(), createdAt: new Date().toISOString()};
  const lock = acquireLock(roots);
  try {
    const existing = readJsonDual(roots, 'prepare.json');
    const gate3Stored = readDual(roots, 'gate3-analysis.json');
    const expectedPlan = jsonBytes({schemaVersion: 1, plan: core.plan(), callCap: 42,
      historicalCalls: 3251, lifetimeCap: 5255, downstreamReserve: 1962});
    const storedPlan = readDual(roots, 'plan.json');
    if (existing && !gate3Stored) throw new Error('BLOCKED_CONTACT_LOSS_GATE3_REPORT_MISSING');
    if (!existing && storedPlan) throw new Error('BLOCKED_CONTACT_LOSS_ORPHAN_PLAN');
    if (gate3Stored && !gate3Stored.bytes.equals(jsonBytes(analysis))) throw new Error('BLOCKED_CONTACT_LOSS_GATE3_REPORT_CONFLICT');
    if (!gate3Stored) writeDualImmutable(roots, 'gate3-analysis.json', jsonBytes(analysis));
    record.gate3.analysisSha256 = sha256(jsonBytes(analysis));
    if (existing) {
      if (!sameJson({...existing.value, createdAt: null}, {...record, createdAt: null})
          || existing.value.gate3?.analysisSha256 !== record.gate3.analysisSha256) throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_CONFLICT');
      if (!storedPlan || !storedPlan.bytes.equals(expectedPlan)) throw new Error('BLOCKED_CONTACT_LOSS_PLAN_MISSING_OR_CONFLICT');
      return {status: 'PREPARED_REUSED', prepareSha256: existing.sha256, roots};
    }
    writeDualImmutable(roots, 'prepare.json', jsonBytes(record));
    writeDualImmutable(roots, 'plan.json', expectedPlan);
    return {status: 'PREPARED', prepareSha256: sha256(jsonBytes(record)), roots};
  } finally {
    releaseLock(roots, lock);
  }
}

function acquireLock(roots) {
  const owner = crypto.randomUUID(), bytes = jsonBytes({schemaVersion: 1, owner, pid: process.pid, createdAt: new Date().toISOString()});
  writeDualImmutable(roots, 'writer.lock', bytes);
  return {owner, bytes};
}
function releaseLock(roots, lock) {
  const stored = readDual(roots, 'writer.lock', {required: true});
  if (!stored.bytes.equals(lock.bytes)) throw new Error('BLOCKED_CONTACT_LOSS_LOCK_OWNER_CHANGED');
  for (const root of [roots.primary, roots.secondary]) {
    const file = relativeFile(root, 'writer.lock');
    fs.unlinkSync(file); fsyncDirectory(path.dirname(file));
  }
}

function readExperimentState(roots) {
  const prepared = readJsonDual(roots, 'prepare.json');
  if (!prepared) return {status: 'NOT_PREPARED', charged: 0, completed: 0, ambiguous: 0, candidateResults: []};
  const expected = core.plan(), calls = [], candidateResults = [];
  let gap = false, ambiguous = 0;
  for (let index = 0; index < expected.length; index++) {
    const item = expected[index], base = `${EXPERIMENT_REL}/${item.id}`;
    const start = readJsonDual(roots, `${base}/start.json`), complete = readJsonDual(roots, `${base}/complete.json`);
    if (!start) {
      if (complete) throw new Error('BLOCKED_CONTACT_LOSS_NONCONTIGUOUS_LEDGER');
      gap = true;
      calls.push({cell: item, status: 'NOT_STARTED'});
      continue;
    }
    if (gap || start.value.schemaVersion !== 1 || start.value.id !== item.id || start.value.alpha !== item.alpha
        || start.value.alphaOrder !== item.alphaOrder || start.value.pitch !== item.pitch
        || start.value.velocity !== item.velocity || start.value.cellOrder !== item.cellOrder
        || start.value.state !== 'STARTED' || start.value.sourceHead !== prepared.value.head
        || start.value.wasmSha256 !== prepared.value.build.wasm.sha256) throw new Error('BLOCKED_CONTACT_LOSS_START_IDENTITY');
    if (!complete) { ambiguous++; calls.push({cell: item, status: 'AMBIGUOUS'}); gap = true; continue; }
    const audio = readDual(roots, `${base}/audio.wav`, {required: true});
    const metadata = readJsonDual(roots, `${base}/metadata.json`, {required: true});
    let normalizedMetrics;
    try { normalizedMetrics = normalizeAnalyzerMetrics(metadata.value.metrics, metadata.value.guardHits); }
    catch { throw new Error('BLOCKED_CONTACT_LOSS_COMPLETE_IDENTITY'); }
    if (complete.value.schemaVersion !== 1 || complete.value.state !== 'COMPLETE' || complete.value.id !== item.id
        || complete.value.audioSha256 !== audio.sha256
        || complete.value.metadataSha256 !== metadata.sha256 || metadata.value.id !== item.id
        || metadata.value.alpha !== item.alpha || metadata.value.alphaOrder !== item.alphaOrder
        || metadata.value.pitch !== item.pitch || metadata.value.velocity !== item.velocity
        || metadata.value.cellOrder !== item.cellOrder
        || metadata.value.sourceHead !== prepared.value.head || metadata.value.wasmSha256 !== prepared.value.build.wasm.sha256
        || metadata.value.audioSha256 !== audio.sha256 || metadata.value.finite !== normalizedMetrics.official.finite
        || !Number.isSafeInteger(metadata.value.guardHits) || metadata.value.guardHits < 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_COMPLETE_IDENTITY');
    }
    calls.push({cell: item, status: 'COMPLETE', start, complete, audio, metadata});
  }
  for (let alphaOrder = 0; alphaOrder < core.ALPHAS.length; alphaOrder++) {
    const rows = calls.slice(alphaOrder * 7, alphaOrder * 7 + 7);
    if (rows.length === 7 && rows.every(row => row.status === 'COMPLETE')) {
      const stored = readJsonDual(roots, `${EXPERIMENT_REL}/alpha-${String(alphaOrder).padStart(2, '0')}.json`);
      if (stored) candidateResults.push(stored.value);
    }
  }
  return {status: ambiguous ? 'BLOCKED_AMBIGUOUS_CALL' : 'READY', prepare: prepared.value,
    prepareSha256: prepared.sha256, calls, charged: calls.filter(row => row.status !== 'NOT_STARTED').length,
    completed: calls.filter(row => row.status === 'COMPLETE').length, ambiguous, candidateResults};
}

function writeFloatWav(left, right) {
  if (!left?.length || left.length !== right.length || left.length > 0xffffffff / 8) throw new Error('BLOCKED_CONTACT_LOSS_AUDIO_SHAPE');
  const dataSize = left.length * 8, out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0); out.writeUInt32LE(36 + dataSize, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(3, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(SAMPLE_RATE * 8, 28); out.writeUInt16LE(8, 32); out.writeUInt16LE(32, 34); out.write('data', 36); out.writeUInt32LE(dataSize, 40);
  for (let index = 0, offset = 44; index < left.length; index++, offset += 8) {
    out.writeFloatLE(left[index], offset); out.writeFloatLE(right[index], offset + 4);
  }
  return out;
}

function officialMetricPayload(metrics) {
  const official = metrics?.official || metrics;
  if (!official || typeof official !== 'object' || typeof official.finite !== 'boolean'
      || !Array.isArray(official.envelopeDbfs) || official.envelopeDbfs.length < 5
      || !official.envelopeDbfs.every(Number.isFinite)
      || !Number.isFinite(official.peakDbfs) || !Number.isFinite(official.spectralCentroidHz)
      || official.spectralCentroidHz <= 0 || !Number.isFinite(official.above2kPowerRatio)) {
    throw new Error('BLOCKED_CONTACT_LOSS_ANALYZER_METRICS');
  }
  return official;
}
function normalizeAnalyzerMetrics(metrics, guardHits = metrics?.outputGuardHits ?? metrics?.official?.outputGuardHits ?? 0) {
  if (!metrics || typeof metrics !== 'object' || !metrics.official || typeof metrics.official !== 'object'
      || !Number.isSafeInteger(guardHits) || guardHits < 0) throw new Error('BLOCKED_CONTACT_LOSS_ANALYZER_METRICS');
  const official = officialMetricPayload(metrics);
  return {...metrics, outputGuardHits: guardHits, official: {...official, outputGuardHits: guardHits}};
}
function analyzerFixture(pitch = 69) {
  const left = new Float32Array(RENDER_FRAMES), right = new Float32Array(RENDER_FRAMES);
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  for (let index = 0; index < left.length; index++) {
    const phase = 2 * Math.PI * frequency * index / SAMPLE_RATE;
    left[index] = 0.12 * (Math.sin(phase) + 0.17 * Math.sin(phase * 2));
    right[index] = 0.115 * (Math.sin(phase) + 0.15 * Math.sin(phase * 2));
  }
  return {left, right};
}
function assertAnalyzerContract() {
  const analyzer = require('./analyze-issue7-physical-identification.cjs');
  const {left, right} = analyzerFixture(96);
  normalizeAnalyzerMetrics(analyzer.analyze(left, right, 96, SAMPLE_RATE), 0);
  return {status: 'ANALYZER_SHAPE_PASS', fixtureFrames: left.length};
}
function captureMetadata({cell, sourceHead, wasmSha256, guardHits, metrics}) {
  const normalizedMetrics = normalizeAnalyzerMetrics(metrics, guardHits);
  return {id: cell.id, alpha: cell.alpha, alphaOrder: cell.alphaOrder, pitch: cell.pitch,
    velocity: cell.velocity, cellOrder: cell.cellOrder, sourceHead, wasmSha256,
    finite: normalizedMetrics.official.finite, guardHits, metrics: normalizedMetrics};
}

function renderCall({root = ROOT, buildDirectory, cell, harnessFactory}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const oldBuild = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL);
  let harness;
  try {
    harness = harnessFactory
      ? harnessFactory(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES})
      : new PluginHarness(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES});
    harness.applyPreset('concert_grand');
    for (const [name, value] of [['engine_model', 'concert_grand'], ['voice_drift', 0], ['lfo1_pitch', 0], ['chorus_mix', 0]]) harness.setPlain(name, value);
    const setter = harness.e.soraoto_supersynth_contact_loss_set, getter = harness.e.soraoto_supersynth_contact_loss_get;
    if (typeof setter !== 'function' || typeof getter !== 'function') throw new Error('BLOCKED_CONTACT_LOSS_EXPORTS');
    if ((setter(cell.alpha) | 0) !== 0 || Math.abs(getter() - cell.alpha) > 1e-6) throw new Error('BLOCKED_CONTACT_LOSS_SETTER_STATE');
    const guardStart = harness.e.soraoto_supersynth_guard_hit_count();
    const left = new Float32Array(RENDER_FRAMES), right = new Float32Array(RENDER_FRAMES);
    for (let position = 0; position < RENDER_FRAMES; position += BLOCK_FRAMES) {
      const count = Math.min(BLOCK_FRAMES, RENDER_FRAMES - position);
      const events = position === 0 ? [{kind: 1, noteId: 1, pitch: cell.pitch, velocity: cell.velocity / 127, offset: 0}] : [];
      const output = harness.process(count, {events});
      left.set(output[0][0], position); right.set(output[0][1], position);
    }
    const guardHits = harness.e.soraoto_supersynth_guard_hit_count() - guardStart;
    const audio = writeFloatWav(left, right), analyzed = require('./analyze-issue7-physical-identification.cjs')
      .analyze(left, right, cell.pitch, SAMPLE_RATE);
    const metadata = captureMetadata({cell, sourceHead: git(root, ['rev-parse', 'HEAD']),
      wasmSha256: sha256(harness.bytes), guardHits, metrics: analyzed});
    return {audio, metadata};
  } finally {
    try { harness?.close(); } finally {
      if (oldBuild === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
      else process.env.SORAOTO_WASM_BUILD_DIR = oldBuild;
    }
  }
}

function decodeAudio(wav) {
  const loss = require('./physical-fit-v4-loss.cjs');
  return loss.decodeFloat32StereoWav(wav);
}
function referenceRows({root = ROOT, home = os.homedir(), commonDirectory, archivePath} = {}) {
  const offline = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const input = offline.resolveInputRoots({root, home, commonDirectory}), records = offline.verifyFrozenRecords(input);
  const archive = archivePath || locateArchive(home);
  if (!archive) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_ARCHIVE_MISSING');
  return offline.readVerifiedReference(archive, records.p3Manifest.value).rows;
}
function scoreAlpha({alphaOrder, rows, refs, gainDb, sourceHead, wasmSha256}) {
  const direct = require('./stage3-direct-reference-metrics.cjs');
  const loss = require('./physical-fit-v4-loss.cjs');
  const cellRows = core.STRESS_CELLS.map(([pitch, velocity], cellOrder) => {
    const source = rows.find(row => row.cell.pitch === pitch && row.cell.velocity === velocity);
    if (!source) throw new Error('BLOCKED_CONTACT_LOSS_ALPHA_CELL_MISSING');
    const ref = refs.find(row => row.pitch === pitch && row.velocity === velocity);
    if (!ref) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_CELL_MISSING');
    const audio = decodeAudio(source.audio.bytes), analyzed = require('./analyze-issue7-physical-identification.cjs')
      .analyze(audio.left, audio.right, pitch, SAMPLE_RATE);
    const actualMetrics = normalizeAnalyzerMetrics(analyzed, source.metadata.value.guardHits);
    const referenceMetrics = officialMetricPayload(ref.metrics);
    return {cell: {pitch, velocity, cellOrder}, actual: {pitch, velocity, metrics: actualMetrics},
      referenceMetrics, ref, audio};
  });
  const evaluation = direct.evaluateDirectReferenceMatrix(cellRows.map(row => ({pitch: row.cell.pitch,
    velocity: row.cell.velocity, metrics: row.referenceMetrics})),
  cellRows.map(row => ({...row.actual, metrics: row.actual.metrics.official})));
  const effectiveGainDb = alphaOrder === 0
    ? loss.sharedGainDb(cellRows.map(row => row.ref.metrics), cellRows.map(row => row.actual.metrics))
    : gainDb;
  if (!Number.isFinite(effectiveGainDb)) throw new Error('BLOCKED_CONTACT_LOSS_SHARED_GAIN');
  const familyLoss = loss.candidateLoss(cellRows.map(row => ({pitch: row.cell.pitch, reference: row.ref.audio, model: row.audio})), effectiveGainDb).total;
  const result = {alpha: core.ALPHAS[alphaOrder], alphaOrder, familyLoss, official: evaluation, sharedGainDb: effectiveGainDb,
    sourceHead, wasmSha256, cells: cellRows.map(({cell, actual}, index) => ({...cell,
      finite: actual.metrics.official.finite, guardHits: actual.metrics.official.outputGuardHits,
      peakDbfs: actual.metrics.official.peakDbfs,
      wavSha256: rows.find(row => row.cell.pitch === cell.pitch && row.cell.velocity === cell.velocity).audio.sha256,
      metadataSha256: rows.find(row => row.cell.pitch === cell.pitch && row.cell.velocity === cell.velocity).metadata.sha256,
      measuredIndex: index}))};
  if (alphaOrder !== 0) core.classifyCandidate(result);
  return result;
}

function scoreCompletedAlpha({alphaOrder, calls, refs, gainDb, sourceHead, wasmSha256, evaluator = scoreAlpha}) {
  if (!Array.isArray(calls) || calls.length !== 7 || calls.some(row => row.status !== 'COMPLETE')) {
    throw new Error('BLOCKED_CONTACT_LOSS_ALPHA_INCOMPLETE');
  }
  return evaluator({alphaOrder, rows: calls.map(row => ({cell: row.cell,
    audio: row.audio || readDual(row.roots, `${EXPERIMENT_REL}/${row.cell.id}/audio.wav`, {required: true}),
    metadata: row.metadata || readJsonDual(row.roots, `${EXPERIMENT_REL}/${row.cell.id}/metadata.json`, {required: true})})),
    refs, gainDb, sourceHead, wasmSha256});
}
function verifiedReceipt(state, identity = {head: state.prepare.head}) {
  if (state.charged !== 42 || state.completed !== 42 || state.ambiguous !== 0) throw new Error('BLOCKED_CONTACT_LOSS_INCOMPLETE_EXPERIMENT');
  return {status: 'VERIFIED_DUAL_STORE', startedCallCount: state.charged,
    completedCallCount: state.completed, ambiguousCallCount: state.ambiguous,
    baseline: {status: 'VERIFIED_SOURCE_BOUND_NEW_BUILD', alpha: core.ALPHAS[0], sourceHead: identity.head,
      wasmSha256: state.prepare.build.wasm.sha256},
    calls: state.calls.map(row => ({...row.cell, id: row.cell.id, state: row.status,
      sourceIdentityStatus: row.start.value.sourceHead === identity.head && row.start.value.wasmSha256 === state.prepare.build.wasm.sha256 ? 'MATCH' : 'MISMATCH',
      sourceHead: row.start.value.sourceHead, wasmSha256: row.start.value.wasmSha256,
      audioSha256: row.complete.value.audioSha256, metadataSha256: row.complete.value.metadataSha256}))};
}

function verifyPreparedCurrent(roots, state, {root = ROOT, home = os.homedir(), commonDirectory, buildDirectory} = {}) {
  const identity = currentIdentity(root);
  if (identity.head !== state.prepare.head || ![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)) {
    throw new Error('BLOCKED_CONTACT_LOSS_HEAD_DRIFT');
  }
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  if (!sameJson(sourceSnapshot(root), state.prepare.source)) throw new Error('BLOCKED_CONTACT_LOSS_SOURCE_DRIFT');
  const gate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
  if (gate3.sha256 !== state.prepare.gate3.analysisSha256 || gate3.value.status !== 'GATE3_ANALYSIS_PASS'
      || gate3.value.head !== state.prepare.head || gate3.value.offlineReportSha256 !== state.prepare.gate3.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_GATE3_REPORT_IDENTITY');
  }
  const frozenNow = frozenSourceSnapshot({root, home, commonDirectory});
  assertFrozenSnapshotMatches(frozenNow, state.prepare);
  const currentBuild = verifyDiagnosticBuild(root, identity.head, {buildDirectory});
  if (currentBuild.wasm.sha256 !== state.prepare.build.wasm.sha256 || !sameJson(currentBuild.source, state.prepare.source)) {
    throw new Error('BLOCKED_CONTACT_LOSS_BUILD_DRIFT');
  }
  const offline = latestOfflineReport(root, home, commonDirectory, identity.head);
  if (offline.reportSha256 !== state.prepare.gate3.offlineReportSha256) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EVIDENCE_DRIFT');
  return identity;
}

function preparedAcceptanceIdentity(state) {
  return {head: state.prepare.head, wasmSha256: state.prepare.build.wasm.sha256,
    sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(state.prepare.source)))), buildRole: 'diagnostic'};
}
function verifyAcceptanceLedgerIdentity(roots, stage, cells, expected) {
  const calls = readAcceptanceCalls(roots, stage, cells);
  if (calls.charged !== cells.length || calls.completed !== cells.length || calls.ambiguous !== 0) {
    throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_INCOMPLETE:${stage}`);
  }
  for (const call of calls.calls) {
    const value = call.start.value;
    if (value.head !== expected.head || value.wasmSha256 !== expected.wasmSha256
        || value.sourceSnapshotSha256 !== expected.sourceSnapshotSha256 || value.buildRole !== expected.buildRole) {
      throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_SOURCE_BINDING:${stage}`);
    }
  }
  return calls;
}
function verifySelectionAfterPromotion({roots, state, selectionStored, root = ROOT, home = os.homedir(), commonDirectory, archivePath} = {}) {
  if (state.charged !== 42 || state.completed !== 42 || state.ambiguous !== 0 || state.candidateResults.length !== 6) {
    throw new Error('BLOCKED_CONTACT_LOSS_INCOMPLETE_EXPERIMENT');
  }
  const before = frozenSourceSnapshot({root, home, commonDirectory});
  const refs = referenceRows({root, home, commonDirectory, archivePath});
  const identity = preparedAcceptanceIdentity(state);
  const storedResults = verifyStoredAlphaResults(roots, state, {root, home, commonDirectory, refs,
    evaluator: scoreAlpha, expectedIdentity: identity, skipCurrentAuthority: true});
  if (storedResults.baselineUnsafe) throw new Error('BLOCKED_CONTACT_LOSS_BASELINE_UNSAFE');
  const receipt = verifiedReceipt(state, {head: state.prepare.head});
  const decision = core.selectCandidate(state.candidateResults, {receipt});
  const expected = {schemaVersion: 1, ...decision, receipt, charged: state.charged, completed: state.completed,
    ambiguous: state.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (!selectionStored || !sameJson(selectionStored.value, expected)) throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
  if (!sameJson(before, frozenSourceSnapshot({root, home, commonDirectory}))) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED_DURING_VERIFY');
  return decision;
}

function runBounded({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory,
  renderer = renderCall, evaluator = scoreAlpha, archivePath} = {}) {
  assertAnalyzerContract();
  const roots = resolveRoots({root, home, commonDirectory}), state = readExperimentState(roots);
  if (!state.prepare) throw new Error('BLOCKED_CONTACT_LOSS_NOT_PREPARED');
  const priorTerminal = readJsonDual(roots, `${EXPERIMENT_REL}/terminal.json`);
  if (priorTerminal) return {...priorTerminal.value, charged: state.charged, completed: state.completed, ambiguous: state.ambiguous};
  if (state.ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL_NO_RERENDER');
  const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
  const refs = referenceRows({root, home, commonDirectory, archivePath});
  const lock = acquireLock(roots);
  try {
    let calls = readExperimentState(roots), charged = calls.charged;
    if (calls.ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL_NO_RERENDER');
    if (charged > core.EXPERIMENT_CALL_CAP) throw new Error('BLOCKED_CONTACT_LOSS_CALL_CAP');
    if (calls.completed > 0) {
      const reports = verifyStoredAlphaResults(roots, calls, {root, home, commonDirectory, buildDirectory,
        refs, evaluator, createMissingReports: true});
      if (reports.baselineUnsafe) {
        const terminal = {status: 'GATE4_BASELINE_UNSAFE', reason: 'BASELINE_SAFETY_GATE_FAILED', charged,
          completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
        writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
        return terminal;
      }
      calls = readExperimentState(roots);
    }
    for (let index = charged; index < core.EXPERIMENT_CALL_CAP; index++) {
      const cell = core.plan()[index], base = `${EXPERIMENT_REL}/${cell.id}`;
      verifyPreparedCurrent(roots, calls, {root, home, commonDirectory, buildDirectory});
      const currentBuild = verifyDiagnosticBuild(root, identity.head, {buildDirectory});
      if (currentBuild.wasm.sha256 !== calls.prepare.build.wasm.sha256) throw new Error('BLOCKED_CONTACT_LOSS_BUILD_DRIFT');
      const start = {schemaVersion: 1, id: cell.id, alpha: cell.alpha, alphaOrder: cell.alphaOrder,
        pitch: cell.pitch, velocity: cell.velocity, cellOrder: cell.cellOrder,
        sourceHead: identity.head, wasmSha256: currentBuild.wasm.sha256, state: 'STARTED',
        startedAt: new Date().toISOString()};
      writeDualImmutable(roots, `${base}/start.json`, jsonBytes(start));
      let capture;
      try { capture = renderer({root, buildDirectory: path.relative(root, path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL)), cell}); }
      catch (error) { throw new Error(`BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL:${cell.id}:${error.message}`); }
      try { verifyPreparedCurrent(roots, calls, {root, home, commonDirectory, buildDirectory}); }
      catch { throw new Error(`BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL:${cell.id}:SOURCE_OR_REMOTE_IDENTITY_DRIFT`); }
      if (!Buffer.isBuffer(capture?.audio) || !capture.metadata || capture.metadata.id !== cell.id
          || capture.metadata.alpha !== cell.alpha || capture.metadata.pitch !== cell.pitch
          || capture.metadata.velocity !== cell.velocity || capture.metadata.sourceHead !== identity.head
          || capture.metadata.wasmSha256 !== currentBuild.wasm.sha256) throw new Error(`BLOCKED_CONTACT_LOSS_CAPTURE_IDENTITY:${cell.id}`);
      const metadata = {...capture.metadata, audioSha256: sha256(capture.audio), completedAt: new Date().toISOString()};
      writeDualImmutable(roots, `${base}/audio.wav`, capture.audio);
      writeDualImmutable(roots, `${base}/metadata.json`, jsonBytes(metadata));
      writeDualImmutable(roots, `${base}/complete.json`, jsonBytes({schemaVersion: 1, id: cell.id,
        state: 'COMPLETE', audioSha256: sha256(capture.audio), metadataSha256: sha256(jsonBytes(metadata)), completedAt: metadata.completedAt}));
      calls = readExperimentState(roots);
      if (calls.ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL_NO_RERENDER');
      charged = calls.charged;
      const unsafeCapture = capture.metadata.finite !== true || capture.metadata.guardHits !== 0
        || !Number.isFinite(capture.metadata.metrics?.peakDbfs) || capture.metadata.metrics.peakDbfs >= 0;
      if (unsafeCapture) {
        const terminal = {status: 'BLOCKED_UNSAFE_CAPTURE', reason: 'FINITE_GUARD_OR_PEAK_GATE', charged,
          completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
        writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
        return terminal;
      }
      const alphaStart = cell.alphaOrder * 7, alphaCalls = calls.calls.slice(alphaStart, alphaStart + 7);
      if (alphaCalls.length === 7 && alphaCalls.every(row => row.status === 'COMPLETE')) {
        const baselineScore = cell.alphaOrder === 0 ? null : readJsonDual(roots, `${EXPERIMENT_REL}/alpha-00.json`, {required: true}).value;
        let scored;
        try {
          scored = evaluator({alphaOrder: cell.alphaOrder, rows: alphaCalls.map(row => ({cell: row.cell,
            audio: readDual(roots, `${EXPERIMENT_REL}/${row.cell.id}/audio.wav`, {required: true}),
            metadata: readJsonDual(roots, `${EXPERIMENT_REL}/${row.cell.id}/metadata.json`, {required: true})})),
            refs, gainDb: baselineScore?.sharedGainDb ?? null, sourceHead: identity.head, wasmSha256: currentBuild.wasm.sha256});
        } catch {
          const terminal = {status: 'BLOCKED_METRIC_RECOMPUTATION', reason: 'OFFICIAL_METRICS_UNVERIFIABLE',
            charged, completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
          writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
          return terminal;
        }
        if (cell.alphaOrder === 0) {
          try { core.assertBaselineSafe(scored); }
          catch {
            const terminal = {status: 'GATE4_BASELINE_UNSAFE', reason: 'BASELINE_SAFETY_GATE_FAILED', charged,
              completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
            writeDualImmutable(roots, `${EXPERIMENT_REL}/alpha-00.json`, jsonBytes({...scored, status: terminal.status}));
            writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
            return terminal;
          }
        }
        writeDualImmutable(roots, `${EXPERIMENT_REL}/alpha-${String(cell.alphaOrder).padStart(2, '0')}.json`, jsonBytes(scored));
      }
    }
    calls = readExperimentState(roots);
    if (calls.charged !== 42 || calls.completed !== 42 || calls.ambiguous !== 0 || calls.candidateResults.length !== 6) {
      throw new Error('BLOCKED_CONTACT_LOSS_INCOMPLETE_EXPERIMENT');
    }
    verifyPreparedCurrent(roots, calls, {root, home, commonDirectory, buildDirectory});
    const receipt = verifiedReceipt(calls, identity);
    const selection = core.selectCandidate(calls.candidateResults, {receipt});
    writeDualImmutable(roots, `${EXPERIMENT_REL}/selection.json`, jsonBytes({schemaVersion: 1, ...selection,
      receipt, charged: calls.charged, completed: calls.completed, ambiguous: calls.ambiguous,
      stage3: 'NOT RUN', stage4: 'NOT RUN'}));
    return {status: selection.status, charged: calls.charged, completed: calls.completed,
      ambiguous: calls.ambiguous, selectedAlpha: selection.selected?.alpha ?? null};
  } finally { releaseLock(roots, lock); }
}

function verifyStoredAlphaResults(roots, state, {root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, refs = null, evaluator = scoreAlpha, createMissingReports = false,
  skipCurrentAuthority = false, expectedIdentity} = {}) {
  if (skipCurrentAuthority) {
    const original = expectedIdentity || preparedAcceptanceIdentity(state), storedGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
    if (storedGate3.sha256 !== state.prepare.gate3.analysisSha256 || storedGate3.value.head !== state.prepare.head
        || storedGate3.value.status !== 'GATE3_ANALYSIS_PASS') {
      throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_EVIDENCE_DRIFT');
    }
    const frozen = frozenSourceSnapshot({root, home, commonDirectory});
    assertFrozenSnapshotMatches(frozen, state.prepare);
    const offline = latestOfflineReport(root, home, commonDirectory, state.prepare.head);
    if (offline.reportSha256 !== state.prepare.gate3.offlineReportSha256) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EVIDENCE_DRIFT');
    const directory = path.resolve(root, buildDirectory || state.prepare.build.diagnosticBuildDirectory);
    const artifact = syncReadSha(path.join(directory, WASM_REL));
    if (artifact.sha256 !== original.wasmSha256 || artifact.size !== state.prepare.build.wasm.size) {
      throw new Error('BLOCKED_CONTACT_LOSS_ORIGINAL_DIAGNOSTIC_WASM_DRIFT');
    }
  } else verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
  const reference = refs || referenceRows({root, home, commonDirectory});
  let baselineScore = null, baselineUnsafe = false;
  for (let alphaOrder = 0; alphaOrder < core.ALPHAS.length; alphaOrder++) {
    const calls = state.calls.slice(alphaOrder * 7, alphaOrder * 7 + 7);
    if (calls.length !== 7 || calls.some(row => row.status !== 'COMPLETE')) break;
    const stored = readJsonDual(roots, `${EXPERIMENT_REL}/alpha-${String(alphaOrder).padStart(2, '0')}.json`);
    const recomputed = scoreCompletedAlpha({alphaOrder, calls, refs: reference,
      gainDb: baselineScore?.sharedGainDb ?? null, sourceHead: state.prepare.head,
      wasmSha256: state.prepare.build.wasm.sha256, evaluator});
    if (alphaOrder === 0) {
      try { core.assertBaselineSafe(recomputed); }
      catch { recomputed.status = 'GATE4_BASELINE_UNSAFE'; baselineUnsafe = true; }
      baselineScore = recomputed;
    }
    const relative = `${EXPERIMENT_REL}/alpha-${String(alphaOrder).padStart(2, '0')}.json`;
    if (!stored && createMissingReports) writeDualImmutable(roots, relative, jsonBytes(recomputed));
    else if (!stored) throw new Error(`BLOCKED_CONTACT_LOSS_ALPHA_REPORT_MISSING:alpha-${alphaOrder}`);
    else if (!sameJson(stored.value, recomputed)) throw new Error(`BLOCKED_CONTACT_LOSS_STORED_METRIC_MISMATCH:alpha-${alphaOrder}`);
  }
  return {status: 'PASS', verifiedAlphaCount: Math.min(6, Math.floor(state.completed / 7)),
    charged: state.charged, completed: state.completed, ambiguous: state.ambiguous, baselineUnsafe};
}

function verifyExperiment({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory, archivePath} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const state = readExperimentState(roots);
  if (!state.prepare) return {status: 'NOT_PREPARED', charged: 0, completed: 0, ambiguous: 0, writes: 0, renders: 0, acousticCalls: 0};
  if (state.ambiguous) return {status: 'BLOCKED_AMBIGUOUS_CALL', charged: state.charged,
    completed: state.completed, ambiguous: state.ambiguous, writes: 0, renders: 0, acousticCalls: 0};
  const before = frozenSourceSnapshot({root, home, commonDirectory});
  const terminal = readJsonDual(roots, `${EXPERIMENT_REL}/terminal.json`);
  const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
  if (state.completed > 0) {
    const refs = referenceRows({root, home, commonDirectory, archivePath});
    verifyStoredAlphaResults(roots, state, {root, home, commonDirectory, buildDirectory, refs});
  }
  let selection = null;
  if (state.completed === 42 && state.charged === 42) {
    if (state.candidateResults.length !== 6) throw new Error('BLOCKED_CONTACT_LOSS_CANDIDATE_REPORT_COUNT');
    const receipt = verifiedReceipt(state, identity), decision = core.selectCandidate(state.candidateResults, {receipt});
    const stored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).value;
    const expected = {schemaVersion: 1, ...decision, receipt, charged: state.charged, completed: state.completed,
      ambiguous: state.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
    if (!sameJson(stored, expected)) throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
    selection = decision;
  } else if (readDual(roots, `${EXPERIMENT_REL}/selection.json`)) {
    throw new Error('BLOCKED_CONTACT_LOSS_EARLY_SELECTION');
  }
  const after = frozenSourceSnapshot({root, home, commonDirectory});
  if (!sameJson(before, after)) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED_DURING_VERIFY');
  return {status: terminal?.value.status || selection?.status || 'VERIFIED_IN_PROGRESS',
    charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
    verifiedAlphaCount: Math.min(6, Math.floor(state.completed / 7)), selection,
    frozenEvidenceUnchanged: true, writes: 0, renders: 0, acousticCalls: 0};
}

function acceptanceCallId(stage, index, cell) {
  const detail = cell.pattern ? `${cell.pattern}-${cell.role || ''}` : `${cell.kind || 'cell'}-${cell.pitch ?? 'x'}-${cell.velocity ?? 'x'}`;
  return `${stage}-${String(index).padStart(4, '0')}-${detail.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
}
function readAcceptanceCalls(roots, stage, cells) {
  const calls = [], baseRoot = `${ACCEPTANCE_ROOT}/${stage}/calls`;
  let gap = false, ambiguous = 0;
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index], id = acceptanceCallId(stage, index, cell), base = `${baseRoot}/${id}`;
    const start = readJsonDual(roots, `${base}/start.json`), complete = readJsonDual(roots, `${base}/complete.json`);
    if (!start) {
      if (complete) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_LEDGER_GAP');
      gap = true; calls.push({cell, id, status: 'NOT_STARTED'}); continue;
    }
    if (gap || start.value.schemaVersion !== 1 || start.value.id !== id || start.value.stage !== stage
        || start.value.callOrder !== index || !sameJson(start.value.cell, cell)
        || !/^[a-f0-9]{40}$/.test(start.value.head || '')
        || !/^[a-f0-9]{64}$/.test(start.value.wasmSha256 || '')
        || !/^[a-f0-9]{64}$/.test(start.value.sourceSnapshotSha256 || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_START_IDENTITY');
    }
    if (!complete) { ambiguous++; gap = true; calls.push({cell, id, status: 'AMBIGUOUS', start}); continue; }
    const audio = readDual(roots, `${base}/audio.wav`, {required: true});
    const metadata = readJsonDual(roots, `${base}/metadata.json`, {required: true});
    if (complete.value.schemaVersion !== 1 || complete.value.id !== id || complete.value.stage !== stage
        || complete.value.state !== 'COMPLETE' || complete.value.audioSha256 !== audio.sha256
        || complete.value.metadataSha256 !== metadata.sha256 || metadata.value.id !== id
        || metadata.value.stage !== stage || metadata.value.callOrder !== index
        || !sameJson(metadata.value.cell, cell) || metadata.value.sourceHead !== start.value.head
        || metadata.value.wasmSha256 !== start.value.wasmSha256
        || metadata.value.sourceSnapshotSha256 !== start.value.sourceSnapshotSha256
        || metadata.value.audioSha256 !== audio.sha256) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_COMPLETE_IDENTITY');
    calls.push({cell, id, status: 'COMPLETE', start, complete, audio, metadata});
  }
  if (ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL');
  return {calls, charged: calls.filter(row => row.status !== 'NOT_STARTED').length,
    completed: calls.filter(row => row.status === 'COMPLETE').length, ambiguous};
}
function acceptanceIdentity({root = ROOT, buildDirectory, buildRole = 'diagnostic'} = {}) {
  const local = currentIdentity(root), wasm = syncReadSha(path.join(root, buildDirectory, WASM_REL));
  return {head: local.head, branch: local.branch, sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))),
    wasmSha256: wasm.sha256, buildRole};
}
function assertAcceptanceIdentityBeforeAfter(before, after) {
  if (before.head !== after.head || before.branch !== after.branch
      || before.sourceSnapshotSha256 !== after.sourceSnapshotSha256
      || before.wasmSha256 !== after.wasmSha256 || before.buildRole !== after.buildRole) {
    throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_IDENTITY_DRIFT');
  }
}
function runAcceptancePlan({roots, stage, cells, identityNow, render, previousAcceptanceCalls = 0} = {}) {
  if (!Array.isArray(cells) || !cells.length) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_PLAN_EMPTY');
  let state = readAcceptanceCalls(roots, stage, cells);
  if (state.charged !== state.completed) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL');
  for (let index = state.completed; index < cells.length; index++) {
    const cell = cells[index], id = acceptanceCallId(stage, index, cell), base = `${ACCEPTANCE_ROOT}/${stage}/calls/${id}`;
    const identity = identityNow(cell), before = {...identity};
    core.accounting({startedExperimentCalls: readExperimentState(roots).charged,
      startedAcceptanceCalls: previousAcceptanceCalls + index + 1});
    writeDualImmutable(roots, `${base}/start.json`, jsonBytes({schemaVersion: 1, id, stage, callOrder: index,
      cell, head: identity.head, wasmSha256: identity.wasmSha256,
      sourceSnapshotSha256: identity.sourceSnapshotSha256, buildRole: identity.buildRole,
      state: 'STARTED', startedAt: new Date().toISOString()}));
    let capture;
    try { capture = render(cell, identity); }
    catch { throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL:${stage}:${id}`); }
    let after;
    try { after = identityNow(cell); assertAcceptanceIdentityBeforeAfter(before, after); }
    catch { throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL:${stage}:${id}:IDENTITY_DRIFT`); }
    if (!Buffer.isBuffer(capture?.audio) || !capture.metadata || typeof capture.metadata !== 'object') {
      throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_CAPTURE_INVALID:${stage}:${id}`);
    }
    const audioSha256 = sha256(capture.audio), metadata = {...capture.metadata, schemaVersion: 1,
      id, stage, callOrder: index, cell, sourceHead: identity.head, wasmSha256: identity.wasmSha256,
      sourceSnapshotSha256: identity.sourceSnapshotSha256, buildRole: identity.buildRole, audioSha256,
      completedAt: new Date().toISOString()};
    const metadataBytes = jsonBytes(metadata);
    writeDualImmutable(roots, `${base}/audio.wav`, capture.audio);
    writeDualImmutable(roots, `${base}/metadata.json`, metadataBytes);
    writeDualImmutable(roots, `${base}/complete.json`, jsonBytes({schemaVersion: 1, id, stage, state: 'COMPLETE',
      audioSha256, metadataSha256: sha256(metadataBytes), completedAt: metadata.completedAt}));
    state = readAcceptanceCalls(roots, stage, cells);
  }
  if (state.charged !== cells.length || state.completed !== cells.length || state.ambiguous !== 0) {
    throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_INCOMPLETE:${stage}`);
  }
  return state;
}
function recordAcceptanceReport(roots, stage, report) {
  const relative = `${ACCEPTANCE_ROOT}/${stage}/report.json`, bytes = jsonBytes(report), existing = readJsonDual(roots, relative);
  if (existing && !existing.bytes.equals(bytes)) throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_CONFLICT:${stage}`);
  if (!existing) writeDualImmutable(roots, relative, bytes);
  return {report, sha256: sha256(bytes), status: existing ? 'REUSED' : 'CREATED'};
}

function referenceMetricsForCells(root, cells) {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'), 'utf8'));
  const byKey = new Map((fixture.directCells || []).map(row => [`${row.pitch}:${row.velocity}`, row]));
  const rows = cells.map(cell => {
    const row = byKey.get(`${cell.pitch}:${cell.velocity}`);
    if (!row?.metrics) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_METRIC_CELL_MISSING');
    return {pitch: cell.pitch, velocity: cell.velocity, metrics: row.metrics};
  });
  return {fixture, rows, fixtureSha256: sha256(fs.readFileSync(path.join(root,
    'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json')))};
}
function confirmationReport(roots, root, selectedAlpha) {
  const cells = core.CONFIRMATION_CELLS.map((cell, index) => ({kind: 'confirmation', ...cell, cellOrder: index,
    alpha: selectedAlpha, alphaOrder: core.alphaIndex(selectedAlpha)}));
  const calls = readAcceptanceCalls(roots, 'confirmation', cells);
  const {fixtureSha256, rows: refs} = referenceMetricsForCells(root, cells);
  const actual = calls.calls.map(call => ({pitch: call.cell.pitch, velocity: call.cell.velocity,
    metrics: call.metadata.value.metrics}));
  const direct = require('./stage3-direct-reference-metrics.cjs');
  const official = direct.evaluateDirectReferenceMatrix(refs, actual, {requiredVelocityLayers: CONFIRMATION_LAYERS});
  const m = official.metrics;
  const pass = m.cellFailureCount === 0 && m.directPitchFailureCount === 0 && m.finite === true
    && m.guardHitTotal === 0 && m.peakWorstDbfs < 0 && m.dynamicSpan.failingPitchCount === 0
    && m.brightnessDirection.failingPitchCount === 0;
  const report = {schemaVersion: 1, gate: 'CONFIRMATION', decision: pass ? 'CONFIRMATION_PASS' : 'BLOCKED_CONFIRMATION_FAIL',
    pass, alpha: selectedAlpha, calls: calls.completed, callIds: calls.calls.map(call => call.id),
    audioSha256: calls.calls.map(call => call.audio.sha256), metadataSha256: calls.calls.map(call => call.metadata.sha256),
    referenceFixtureSha256: fixtureSha256, official};
  return recordAcceptanceReport(roots, 'confirmation', report);
}
function renderHeadroomCall({root = ROOT, buildDirectory, cell} = {}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const build = path.resolve(root, buildDirectory), oldBuild = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = build;
  let harness;
  try {
    harness = new PluginHarness(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES});
    harness.applyPreset('concert_grand');
    for (const [name, value] of [['voice_drift', 0], ['lfo1_pitch', 0], ['chorus_mix', 0], ['engine_model', 'concert_grand']]) harness.setPlain(name, value);
    const alpha = cell.role === 'baseline' ? 1 : cell.alpha;
    const setter = harness.e.soraoto_supersynth_contact_loss_set;
    if (typeof setter !== 'function' || (setter(alpha) | 0) !== 0
        || Math.abs(harness.e.soraoto_supersynth_contact_loss_get() - alpha) > 1e-6) throw new Error('BLOCKED_CONTACT_LOSS_HEADROOM_SETTER');
    const pitches = cell.pattern === 'open-c-major-nine' ? [48, 55, 60, 64, 67, 71, 74, 76, 79, 84]
      : Array.from({length: 32}, (_, index) => 48 + index);
    const left = new Float32Array(96000), right = new Float32Array(96000), callbackMs = [];
    const guardStart = harness.e.soraoto_supersynth_guard_hit_count(); let finite = true, peak = 0;
    for (let position = 0; position < left.length; position += BLOCK_FRAMES) {
      const count = Math.min(BLOCK_FRAMES, left.length - position);
      const events = position === 0 ? pitches.map((pitch, index) => ({kind: 1, noteId: index + 1, pitch, velocity: 124 / 127, offset: 0})) : [];
      const started = performance.now(), output = harness.process(count, {events})[0];
      callbackMs.push(performance.now() - started); left.set(output[0], position); right.set(output[1], position);
      for (let i = 0; i < count; i++) { const l = output[0][i], r = output[1][i];
        if (!Number.isFinite(l) || !Number.isFinite(r)) finite = false;
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
      }
    }
    const guardHits = harness.e.soraoto_supersynth_guard_hit_count() - guardStart;
    return {audio: writeFloatWav(left, right), metadata: {metrics: {finite, peak, peakDbfs: peak ? 20 * Math.log10(peak) : -240,
      guardHits, maxCallbackMs: Math.max(...callbackMs), callbackMs}, role: cell.role, pattern: cell.pattern, alpha}};
  } finally { try { harness?.close(); } finally {
    if (oldBuild === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR; else process.env.SORAOTO_WASM_BUILD_DIR = oldBuild;
  } }
}
function headroomReport(roots, selectedAlpha) {
  const cells = core.HEADROOM_CELLS.map(cell => ({...cell, kind: 'headroom', alpha: cell.role === 'baseline' ? 1 : selectedAlpha}));
  const calls = readAcceptanceCalls(roots, 'headroom', cells), byPattern = new Map();
  for (const call of calls.calls) {
    const pair = byPattern.get(call.cell.pattern) || {};
    pair[call.cell.role] = call.metadata.value.metrics; byPattern.set(call.cell.pattern, pair);
  }
  const rows = [...byPattern.entries()].map(([pattern, pair]) => {
    const baseline = pair.baseline, candidate = pair.candidate;
    if (!baseline || !candidate) throw new Error('BLOCKED_CONTACT_LOSS_HEADROOM_PAIR_MISSING');
    const peakIncreaseDb = candidate.peakDbfs - baseline.peakDbfs;
    const pass = baseline.finite && candidate.finite && baseline.guardHits === 0 && candidate.guardHits === 0
      && baseline.peakDbfs < 0 && candidate.peakDbfs < 0 && peakIncreaseDb <= 0.1
      && baseline.maxCallbackMs < 2.667 && candidate.maxCallbackMs < 2.667;
    return {pattern, baselinePeakDbfs: baseline.peakDbfs, candidatePeakDbfs: candidate.peakDbfs,
      peakIncreaseDb, baselineMaxCallbackMs: baseline.maxCallbackMs, candidateMaxCallbackMs: candidate.maxCallbackMs,
      baselineGuardHits: baseline.guardHits, candidateGuardHits: candidate.guardHits, pass};
  });
  const pass = rows.length === 2 && rows.every(row => row.pass);
  const report = {schemaVersion: 1, gate: 'HEADROOM', decision: pass ? 'HEADROOM_PASS' : 'BLOCKED_HEADROOM_FAIL',
    pass, alpha: selectedAlpha, calls: calls.completed, rows};
  return recordAcceptanceReport(roots, 'headroom', report);
}
const PROMOTION_PATHS = Object.freeze(['wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h'].sort());
function commitParent(root, commit) { return git(root, ['rev-parse', `${commit}^`]); }
function commitChangedPaths(root, commit) {
  return git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', commit])
    .split(/\r?\n/).filter(Boolean).sort();
}
function promoteProfileBytes(originalBytes, alpha) {
  const originalText = originalBytes.toString('utf8'), start = originalText.indexOf('"concert_grand"');
  if (start < 0) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PRESET_MISSING');
  const nextPreset = originalText.indexOf('\n  "', start + 1);
  const end = nextPreset < 0 ? originalText.length : nextPreset;
  let section = originalText.slice(start, end);
  const soft = Number((0.08 * alpha).toFixed(8)), hard = Number((0.28 * alpha).toFixed(8));
  let softCount = 0, hardCount = 0;
  section = section.replace(/("contact_loss_soft"\s*:\s*)[-+0-9.eE]+/g, (_match, prefix) => { softCount++; return `${prefix}${soft}`; });
  section = section.replace(/("contact_loss_hard"\s*:\s*)[-+0-9.eE]+/g, (_match, prefix) => { hardCount++; return `${prefix}${hard}`; });
  if (softCount !== 1 || hardCount !== 1) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PROFILE_SHAPE');
  const newText = originalText.slice(0, start) + section + originalText.slice(end), before = JSON.parse(originalText), after = JSON.parse(newText);
  const expected = JSON.parse(JSON.stringify(before));
  expected.concert_grand.engine_config.hammer.contact_loss_soft = soft;
  expected.concert_grand.engine_config.hammer.contact_loss_hard = hard;
  if (!sameJson(after, expected)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_UNRELATED_PRESET_DRIFT');
  return {bytes: Buffer.from(newText), soft, hard};
}
function assertPromotionCommit({root = ROOT, prepare, selectedAlpha, expectedHead} = {}) {
  const parent = commitParent(root, expectedHead), paths = commitChangedPaths(root, expectedHead);
  if (parent !== prepare.head || !sameJson(paths, PROMOTION_PATHS)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_COMMIT_IDENTITY');
  const presetText = gitBytes(root, ['show', `${expectedHead}:wasm/plugins/dsp/super-synth/presets.json`]).toString('utf8');
  const promoted = JSON.parse(presetText), expectedSoft = Number((0.08 * selectedAlpha).toFixed(8)),
    expectedHard = Number((0.28 * selectedAlpha).toFixed(8));
  if (promoted.concert_grand?.engine_config?.hammer?.contact_loss_soft !== expectedSoft
      || promoted.concert_grand?.engine_config?.hammer?.contact_loss_hard !== expectedHard) {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_COMMIT_VALUES');
  }
  for (const relative of PROMOTION_PATHS) {
    const committed = gitBytes(root, ['show', `${expectedHead}:${relative}`]);
    if (!committed.equals(fs.readFileSync(path.join(root, relative)))) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_COMMIT_WORKTREE_MISMATCH');
  }
  return {parent, paths, expectedSoft, expectedHard, tree: git(root, ['rev-parse', `${expectedHead}^{tree}`])};
}
function readPromotion(roots) {
  const stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/promotion.json`);
  return stored ? {value: stored.value, sha256: stored.sha256} : null;
}
function verifyPromotedAuthority({roots, state, root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const promotion = readPromotion(roots);
  if (!promotion) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECEIPT_MISSING');
  const record = promotion.value, identity = currentIdentity(root);
  if (identity.head !== record.head || ![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)
      || record.parentHead !== state.prepare.head || record.selectionSha256 !== readDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).sha256
      || !sameJson(record.changedPaths, PROMOTION_PATHS)
      || commitParent(root, record.head) !== record.parentHead
      || !sameJson(commitChangedPaths(root, record.head), PROMOTION_PATHS)
      || git(root, ['rev-parse', `${record.head}^{tree}`]) !== record.tree) {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_IDENTITY');
  }
  verifiedPullRequest(root, identity.head); verifyIssueApproval(root);
  const currentSources = sourceSnapshot(root);
  if (!sameJson(currentSources, record.sourceAfter)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_SOURCE_DRIFT');
  for (const relative of SOURCE_FILES) {
    if (!PROMOTION_PATHS.includes(relative) && !sameJson(record.sourceBefore[relative], record.sourceAfter[relative])) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_CHANGED_UNAUTHORIZED_SOURCE');
    }
  }
  const priorOffline = latestOfflineReport(root, home, commonDirectory, state.prepare.head);
  if (priorOffline.reportSha256 !== state.prepare.gate3.offlineReportSha256) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EVIDENCE_DRIFT');
  const frozen = frozenSourceSnapshot({root, home, commonDirectory});
  assertFrozenSnapshotMatches(frozen, state.prepare);
  return {...identity, promotion: record, promotionSha256: promotion.sha256};
}
function promoteSelected({roots, state, selection, root = ROOT} = {}) {
  const existing = readPromotion(roots);
  if (existing) return verifyPromotedAuthority({roots, state, root});
  const beforeIdentity = currentIdentity(root);
  if (beforeIdentity.head !== state.prepare.head) {
    const recovery = assertPromotionCommit({root, prepare: state.prepare, selectedAlpha: selection.selected.alpha,
      expectedHead: beforeIdentity.head});
    if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(beforeIdentity.branch)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_BRANCH');
    const sourceAfter = sourceSnapshot(root);
    for (const relative of SOURCE_FILES) {
      if (!PROMOTION_PATHS.includes(relative) && !sameJson(sourceAfter[relative], state.prepare.source[relative])) {
        throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_SOURCE_DRIFT');
      }
    }
    for (const relative of PROMOTION_PATHS) {
      const parentBytes = gitBytes(root, ['show', `${state.prepare.head}:${relative}`]);
      const parentSnapshot = state.prepare.source[relative];
      if (sha256(parentBytes) !== parentSnapshot.sha256 || parentBytes.length !== parentSnapshot.size) {
        throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_PARENT_MISMATCH');
      }
    }
    verifyIssueApproval(root);
    const remote = JSON.parse(github(['pr', 'view', String(PR_NUMBER), '--repo', REPOSITORY,
      '--json', 'state,number,headRefName,headRefOid,baseRefName,url'], {cwd: root}));
    if (remote.state !== 'OPEN' || remote.number !== PR_NUMBER || remote.headRefName !== PR_BRANCH
        || remote.baseRefName !== 'main' || remote.url !== PR_URL
        || ![state.prepare.head, beforeIdentity.head].includes(remote.headRefOid)) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_REMOTE_HEAD');
    }
    if (remote.headRefOid === state.prepare.head) {
      runBuildCommand(root, ['git', 'push', 'origin', `HEAD:refs/heads/${PR_BRANCH}`], 'BLOCKED_CONTACT_LOSS_PROMOTION_PUSH');
    }
    const pushedIdentity = currentIdentity(root); verifiedPullRequest(root, pushedIdentity.head);
    if (pushedIdentity.head !== beforeIdentity.head) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_HEAD_READBACK');
    const record = {schemaVersion: 1, issue: 7, pr: 8, contractSha256: CONTRACT_SHA256,
      selectionSha256: readDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).sha256,
      alpha: selection.selected.alpha, parentHead: state.prepare.head, head: beforeIdentity.head, tree: recovery.tree,
      changedPaths: PROMOTION_PATHS, sourceBefore: state.prepare.source, sourceAfter,
      values: {contact_loss_soft: recovery.expectedSoft, contact_loss_hard: recovery.expectedHard},
      remoteReadback: {state: 'OPEN', branch: PR_BRANCH, head: pushedIdentity.head}, recoveredAfterCommit: true,
      createdAt: new Date().toISOString()};
    writeDualImmutable(roots, `${ACCEPTANCE_ROOT}/promotion.json`, jsonBytes(record));
    return verifyPromotedAuthority({roots, state, root});
  }
  if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(beforeIdentity.branch)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PARENT_HEAD');
  }
  verifiedPullRequest(root, beforeIdentity.head); verifyIssueApproval(root);
  const sourceBefore = sourceSnapshot(root);
  if (!sameJson(sourceBefore, state.prepare.source)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_SOURCE_DRIFT');
  const presetPath = path.join(root, 'wasm/plugins/dsp/super-synth/presets.json'), original = fs.readFileSync(presetPath);
  const update = promoteProfileBytes(original, selection.selected.alpha);
  const status = git(root, ['status', '--porcelain=v2', '--untracked-files=all']);
  const statusLines = status.split(/\r?\n/).filter(line => line && !line.startsWith('# '));
  const changed = statusLines.map(line => line.slice(3).split(' -> ').at(-1)).sort();
  if (statusLines.length && !sameJson(changed, PROMOTION_PATHS)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_DIRTY_WORKTREE');
  if (!statusLines.length) fs.writeFileSync(presetPath, update.bytes);
  const generatorOutput = path.join(os.tmpdir(), 'issue7-contact-loss-v1-metadata');
  const generated = spawnSync('rtk', ['python3', 'wasm/cmake/generate_plugin_metadata.py', generatorOutput],
    {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (generated.error || generated.status !== 0) throw new Error('BLOCKED_CONTACT_LOSS_METADATA_GENERATION');
  const currentStatus = git(root, ['status', '--porcelain=v2', '--untracked-files=all']);
  const dirty = currentStatus.split(/\r?\n/).filter(line => line && !line.startsWith('# '));
  const changedNow = dirty.map(line => line.slice(3).split(' -> ').at(-1)).sort();
  if (!sameJson(changedNow, PROMOTION_PATHS)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PATH_SET');
  const prospectiveHead = git(root, ['rev-parse', 'HEAD']);
  let head = prospectiveHead;
  if (sameJson(commitChangedPaths(root, prospectiveHead), PROMOTION_PATHS)
      && commitParent(root, prospectiveHead) === state.prepare.head) {
    // A prior invocation may have committed before its push or receipt write.
  } else {
    git(root, ['add', '--', ...PROMOTION_PATHS]);
    git(root, ['commit', '-m', 'issue7: promote measured contact-loss alpha']);
    head = git(root, ['rev-parse', 'HEAD']);
  }
  const verified = assertPromotionCommit({root, prepare: state.prepare, selectedAlpha: selection.selected.alpha, expectedHead: head});
  const pushed = spawnSync('rtk', ['git', 'push', 'origin', `HEAD:refs/heads/${PR_BRANCH}`],
    {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (pushed.error || pushed.status !== 0) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PUSH');
  const local = currentIdentity(root); verifiedPullRequest(root, local.head);
  if (local.head !== head) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_HEAD_READBACK');
  const sourceAfter = sourceSnapshot(root), record = {schemaVersion: 1, issue: 7, pr: 8,
    contractSha256: CONTRACT_SHA256, selectionSha256: readDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).sha256,
    alpha: selection.selected.alpha, parentHead: state.prepare.head, head, tree: verified.tree,
    changedPaths: PROMOTION_PATHS, sourceBefore, sourceAfter,
    values: {contact_loss_soft: verified.expectedSoft, contact_loss_hard: verified.expectedHard},
    remoteReadback: {state: 'OPEN', branch: PR_BRANCH, head: local.head}, createdAt: new Date().toISOString()};
  writeDualImmutable(roots, `${ACCEPTANCE_ROOT}/promotion.json`, jsonBytes(record));
  return verifyPromotedAuthority({roots, state, root});
}

function runBuildCommand(root, args, code) {
  const result = spawnSync('rtk', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (result.error || result.status !== 0) throw new Error(code);
  return {status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim()};
}
function buildPromotedPair({root = ROOT} = {}) {
  const toolchain = path.join(root, 'wasm/cmake/wasm32-clang.cmake');
  const configs = [
    {role: 'test', directory: 'build/wasm-contact-loss-promoted-test', testing: 'ON', guards: 'ON'},
    {role: 'release', directory: 'build/wasm-contact-loss-promoted-release', testing: 'OFF', guards: 'OFF'}
  ];
  const builds = {};
  for (const config of configs) {
    const absolute = path.join(root, config.directory);
    runBuildCommand(root, ['cmake', '-S', path.join(root, 'wasm'), '-B', absolute,
      `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`, `-DBUILD_TESTING=${config.testing}`,
      `-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=${config.guards}`,
      '-DSORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS=OFF',
      '-DSORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS=OFF'], 'BLOCKED_CONTACT_LOSS_PROMOTED_CMAKE_CONFIGURE');
    runBuildCommand(root, ['cmake', '--build', absolute, '--parallel'], 'BLOCKED_CONTACT_LOSS_PROMOTED_CMAKE_BUILD');
    const cache = fs.readFileSync(path.join(absolute, 'CMakeCache.txt'), 'utf8');
    const option = (name, value) => new RegExp(`^${name}:BOOL=${value}$`, 'm').test(cache);
    if (!option('BUILD_TESTING', config.testing) || !option('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS', config.guards)
        || !option('SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS', 'OFF')
        || !option('SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS', 'OFF')) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_OPTIONS');
    }
    const wasmPath = path.join(absolute, WASM_REL), wasm = syncReadSha(wasmPath);
    const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm.bytes)).map(row => row.name);
    if (!exports.includes('soraoto_plugin_process') || !exports.includes('soraoto_plugin_init')) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_EXPORTS');
    }
    if (config.guards === 'ON') {
      for (const name of ['soraoto_supersynth_guard_hit_count', 'soraoto_supersynth_active_voice_count']) {
        if (!exports.includes(name)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_EXPORTS');
      }
    } else if (exports.includes('soraoto_supersynth_guard_hit_count')
        || exports.includes('soraoto_supersynth_active_voice_count')) {
      throw new Error('BLOCKED_CONTACT_LOSS_RELEASE_EXPORTS');
    }
    if (exports.some(name => name.startsWith('soraoto_supersynth_contact_loss_'))) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_EXPOSES_TEST_SETTER');
    }
    builds[config.role] = {directory: config.directory, wasmSha256: wasm.sha256, wasmSize: wasm.size,
      cacheSha256: sha256(fs.readFileSync(path.join(absolute, 'CMakeCache.txt'))), exports: exports.sort()};
  }
  return builds;
}
function assertCurrentAcceptanceIdentity({root = ROOT, buildDirectory, buildRole} = {}) {
  const identity = acceptanceIdentity({root, buildDirectory, buildRole});
  if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  return identity;
}
function withWasmBuild(root, buildDirectory, callback) {
  const key = 'SORAOTO_WASM_BUILD_DIR', prior = process.env[key];
  process.env[key] = path.resolve(root, buildDirectory);
  try { return callback(); }
  finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
}
function renderPromotedCell({root = ROOT, buildDirectory, cell} = {}) {
  const capture = require('./capture-supersynth-matrix.cjs');
  const result = withWasmBuild(root, buildDirectory, () => capture.renderNormalized(cell.pitch,
    cell.velocity / 127, {}, {returnSamples: true}));
  return {audio: writeFloatWav(result.left, result.right), metadata: {pitch: cell.pitch, velocity: cell.velocity,
    metrics: result.metrics, finite: result.metrics.finite, guardHits: result.metrics.outputGuardHits ?? 0}};
}
function renderReleaseCell({root = ROOT, buildDirectory, cell} = {}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const absolute = path.resolve(root, buildDirectory), prior = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = absolute;
  let harness;
  try {
    harness = new PluginHarness(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES});
    harness.applyPreset('concert_grand');
    for (const [name, value] of [['engine_model', 'concert_grand'], ['voice_drift', 0], ['lfo1_pitch', 0], ['chorus_mix', 0]]) harness.setPlain(name, value);
    const pitches = cell.kind === 'chord' ? cell.pitches : [cell.pitch];
    const velocity = cell.kind === 'chord' ? cell.velocity : cell.velocity;
    const left = new Float32Array(RENDER_FRAMES), right = new Float32Array(RENDER_FRAMES);
    const guardStart = typeof harness.e.soraoto_supersynth_guard_hit_count === 'function'
      ? harness.e.soraoto_supersynth_guard_hit_count() : null;
    let finite = true, peak = 0;
    for (let position = 0; position < RENDER_FRAMES; position += BLOCK_FRAMES) {
      const count = Math.min(BLOCK_FRAMES, RENDER_FRAMES - position);
      const events = position === 0 ? pitches.map((pitch, index) => ({kind: 1, noteId: index + 1,
        pitch, velocity: velocity / 127, offset: 0})) : [];
      const output = harness.process(count, {events})[0]; left.set(output[0], position); right.set(output[1], position);
      for (let frame = 0; frame < count; frame++) {
        if (!Number.isFinite(output[0][frame]) || !Number.isFinite(output[1][frame])) finite = false;
        peak = Math.max(peak, Math.abs(output[0][frame]), Math.abs(output[1][frame]));
      }
    }
    const guardHits = guardStart === null ? null : harness.e.soraoto_supersynth_guard_hit_count() - guardStart;
    return {audio: writeFloatWav(left, right), metadata: {finite, peak, peakDbfs: peak ? 20 * Math.log10(peak) : -240, guardHits}};
  } finally {
    try { harness?.close(); }
    finally { if (prior === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR; else process.env.SORAOTO_WASM_BUILD_DIR = prior; }
  }
}
function releaseEquivalenceReport(roots) {
  const cells = core.RELEASE_CELLS, test = readAcceptanceCalls(roots, 'release-test', cells), release = readAcceptanceCalls(roots, 'release-production', cells);
  const loss = require('./physical-fit-v4-loss.cjs'), rows = cells.map((cell, index) => {
    const testCall = test.calls[index], releaseCall = release.calls[index];
    const a = loss.decodeFloat32StereoWav(testCall.audio.bytes), b = loss.decodeFloat32StereoWav(releaseCall.audio.bytes);
    if (a.left.length !== b.left.length || a.right.length !== b.right.length) {
      return {cell, pass: false, reason: 'PCM_LENGTH_MISMATCH', maximumAbsoluteDifference: null};
    }
    let maximumAbsoluteDifference = 0;
    for (let i = 0; i < a.left.length; i++) {
      maximumAbsoluteDifference = Math.max(maximumAbsoluteDifference, Math.abs(a.left[i] - b.left[i]), Math.abs(a.right[i] - b.right[i]));
    }
    const testMetrics = testCall.metadata.value.metrics, releaseMetrics = releaseCall.metadata.value.metrics;
    const pass = maximumAbsoluteDifference <= 1e-6 && testMetrics.finite === true && releaseMetrics.finite === true
      && testMetrics.guardHits === 0 && releaseMetrics.guardHits === null
      && Number.isFinite(testMetrics.peakDbfs) && testMetrics.peakDbfs < 0
      && Number.isFinite(releaseMetrics.peakDbfs) && releaseMetrics.peakDbfs < 0;
    return {cell, pass, maximumAbsoluteDifference,
      testAudioSha256: testCall.audio.sha256, releaseAudioSha256: releaseCall.audio.sha256};
  });
  const pass = rows.length === 12 && rows.every(row => row.pass);
  return recordAcceptanceReport(roots, 'release-equivalence', {schemaVersion: 1, gate: 'RELEASE_EQUIVALENCE',
    decision: pass ? 'RELEASE_EQUIVALENCE_PASS' : 'BLOCKED_RELEASE_EQUIVALENCE_FAIL', pass, calls: 24,
    maximumAbsoluteDifference: Math.max(...rows.map(row => row.maximumAbsoluteDifference || 0)), rows});
}
function stage3Cells() {
  const recovery = require('./run-stage3-production-recovery.cjs');
  if (recovery.CELL_SPECS.length !== 486) throw new Error('BLOCKED_CONTACT_LOSS_STAGE3_CELL_SET');
  return recovery.CELL_SPECS.map(cell => ({...cell}));
}
function stage3Report(roots, root, stage3WasmBuild, acceptanceOffset) {
  const recovery = require('./run-stage3-production-recovery.cjs'), direct = require('./run-stage3-direct-reference.cjs');
  const cells = stage3Cells(), calls = readAcceptanceCalls(roots, 'stage3', cells);
  const fixtureBytes = fs.readFileSync(path.join(root, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'));
  const fixture = JSON.parse(fixtureBytes.toString('utf8')); direct.validateReferenceFixture(fixture);
  const rows = calls.calls.map(call => ({cell: call.cell, pitch: call.cell.pitch, velocity: call.cell.velocity,
    metrics: call.metadata.value.metrics}));
  const directRows = rows.filter(row => row.cell.kind === 'direct').map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics}));
  const sentinelRows = rows.filter(row => row.cell.kind === 'sentinel').map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics}));
  const evaluated = direct.evaluateDirect(fixture, {matrix: directRows});
  const byKey = new Map(directRows.map(row => [`${row.pitch}:${row.velocity}`, row]));
  const sentinels = sentinelRows.map(row => ({pitch: row.pitch, velocity: row.velocity,
    ...direct.compareSentinelMetrics(byKey.get(`${row.pitch}:${row.velocity}`), row)}));
  const directPass = evaluated.pass && evaluated.direct.coverage.cells === 480
    && evaluated.counts.dynamicSpanFailingPitches === 0 && evaluated.counts.brightnessDirectionFailingPitches === 0
    && evaluated.direct.metrics.guardHitTotal === 0 && evaluated.direct.metrics.finite === true
    && evaluated.direct.metrics.peakWorstDbfs < 0;
  const pass = calls.completed === 486 && calls.charged === 486 && directPass && sentinels.length === 6 && sentinels.every(row => row.pass);
  const decision = pass ? 'STAGE3_READY_FOR_STAGE4' : 'BLOCKED_STAGE3_ACCEPTANCE_FAIL';
  const result = {schemaVersion: 1, gate: 'STAGE3', decision, pass, sourceHead: currentIdentity(root).head,
    build: {directory: stage3WasmBuild.directory, wasmSha256: stage3WasmBuild.wasmSha256},
    calls: calls.completed, fixtureSha256: sha256(fixtureBytes), coverage: {directCells: directRows.length,
      sentinels: sentinelRows.length, total: rows.length}, direct: {pass: directPass, counts: evaluated.counts,
      metrics: evaluated.direct.metrics, diagnostics: evaluated.diagnostics}, sentinels,
    rows: rows.map(row => ({cell: row.cell, metrics: row.metrics})),
    accounting: core.accounting({startedExperimentCalls: readExperimentState(roots).charged,
      startedAcceptanceCalls: acceptanceOffset + calls.charged})};
  return recordAcceptanceReport(roots, 'stage3', result);
}
function runLegacyStage4Conformance(root, document) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-contact-loss-stage4-'));
  const matrixPath = path.join(temporary, 'lifecycle.json');
  try {
    fs.writeFileSync(matrixPath, JSON.stringify(document));
    const evaluator = require('./stage4-full-range-evaluator.cjs');
    const result = spawnSync('rtk', ['node', evaluator.LEGACY_TEST], {cwd: root, encoding: 'utf8',
      env: {...process.env, SUPERSYNTH_LIFECYCLE_PATH: matrixPath, SUPERSYNTH_REPORT_DIR: ''}, maxBuffer: 8 * 1024 * 1024});
    return {pass: result.status === 0, status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim()};
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}
function renderLifecycleWithAudio({root = ROOT, buildDirectory, cell} = {}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const capture = require('./capture-supersynth-stage4-lifecycle.cjs');
  const metricsModule = require('./salamander-metrics.cjs'), pitchModule = require('./piano-pitch-estimator.cjs');
  const prior = process.env.SORAOTO_WASM_BUILD_DIR; process.env.SORAOTO_WASM_BUILD_DIR = path.resolve(root, buildDirectory);
  let harness;
  try {
    harness = new PluginHarness(root, WASM_REL, {sampleRate: capture.SAMPLE_RATE, maxFrames: capture.BLOCK});
    const exports = harness.e;
    if (typeof exports.soraoto_supersynth_active_voice_count !== 'function'
        || typeof exports.soraoto_supersynth_guard_hit_count !== 'function') throw new Error('BLOCKED_CONTACT_LOSS_STAGE4_DIAGNOSTICS');
    harness.applyPreset('concert_grand'); harness.setPlain('voice_drift', 0); harness.setPlain('lfo1_pitch', 0); harness.setPlain('chorus_mix', 0);
    const holdFrames = Math.floor(capture.SAMPLE_RATE * capture.HOLD_MS / 1000);
    const releaseLimitFrames = Math.floor(capture.SAMPLE_RATE * capture.RELEASE_LIMIT_MS / 1000);
    const heldLeft = new Float32Array(holdFrames), heldRight = new Float32Array(holdFrames);
    const fullLeft = new Float32Array(holdFrames + releaseLimitFrames + capture.BLOCK);
    const fullRight = new Float32Array(fullLeft.length);
    let finite = true, peak = 0, position = 0;
    const guardStart = exports.soraoto_supersynth_guard_hit_count() >>> 0;
    const append = (output, offset) => {
      const left = output?.[0], right = output?.[1];
      if (!left || !right || left.length !== right.length) throw new Error('BLOCKED_CONTACT_LOSS_STAGE4_STEREO');
      fullLeft.set(left, offset); fullRight.set(right, offset);
      for (let i = 0; i < left.length; i++) {
        if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) finite = false;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
    };
    while (position < holdFrames) {
      const frames = Math.min(capture.BLOCK, holdFrames - position);
      const output = harness.process(frames, {events: position === 0
        ? [{kind: 1, noteId: 1, pitch: cell.pitch, velocity: cell.velocity / 127, offset: 0}] : []})[0];
      append(output, position); heldLeft.set(output[0], position); heldRight.set(output[1], position); position += frames;
    }
    const noteOffFrame = position;
    let releaseFrames = 0, active = exports.soraoto_supersynth_active_voice_count() >>> 0;
    while (releaseFrames < releaseLimitFrames) {
      const frames = Math.min(capture.BLOCK, releaseLimitFrames - releaseFrames);
      const events = releaseFrames === 0 ? [{kind: 2, noteId: 1, pitch: cell.pitch, velocity: 0, offset: 0}] : [];
      const output = harness.process(frames, {events})[0]; append(output, position); position += frames;
      releaseFrames += frames; active = exports.soraoto_supersynth_active_voice_count() >>> 0;
      if (active === 0) break;
    }
    const releasedWithinLimit = active === 0 && releaseFrames <= releaseLimitFrames;
    let postReleaseProcessed = false, postReleaseFinite = false;
    if (active === 0) {
      const output = harness.process(capture.BLOCK, {events: []})[0];
      postReleaseFinite = output[0].every(Number.isFinite) && output[1].every(Number.isFinite);
      append(output, position); position += capture.BLOCK; postReleaseProcessed = true;
    }
    const analysisFrames = Math.floor(capture.SAMPLE_RATE * .38);
    const metrics = metricsModule.analyzeStereo(heldLeft.subarray(0, analysisFrames), heldRight.subarray(0, analysisFrames), cell.pitch,
      {sampleRate: capture.SAMPLE_RATE});
    const plan = pitchModule.getPianoPitchAnalysisPlan(cell.pitch, {sampleRate: capture.SAMPLE_RATE,
      blockSize: capture.BLOCK, minimumDurationMs: capture.HOLD_MS});
    const pitchMeasurement = pitchModule.estimatePianoPitch(heldLeft, heldRight, {sampleRate: capture.SAMPLE_RATE,
      expectedMidiPitch: cell.pitch, analysisWindows: plan.windows});
    const guardHits = (exports.soraoto_supersynth_guard_hit_count() >>> 0) - guardStart;
    const fullRenderPeakDbfs = peak > 0 ? 20 * Math.log10(peak) : -240;
    Object.assign(metrics, {finite, finiteThroughout: finite, finiteRelease: finite, postReleaseFinite,
      fullRenderPeakDbfs, outputGuardHits: guardHits, pitchMeasurement,
      pitchCapture: {heldFrames: holdFrames, holdMs: capture.HOLD_MS, releaseLimitMs: capture.RELEASE_LIMIT_MS,
        analysisWindowMs: plan.windows, requiredDurationMs: plan.requiredDurationMs},
      lifecycle: {noteOnProcessed: true, noteOffProcessed: true, noteOffFrame, releaseFrames,
        inactiveAfterNoteOffMs: active === 0 ? releaseFrames * 1000 / capture.SAMPLE_RATE : null,
        releasedWithinLimit, postReleaseProcessed, finalActiveVoiceCount: active, guardHits,
        finiteThroughout: finite, postReleaseFinite}});
    return {audio: writeFloatWav(fullLeft.subarray(0, position), fullRight.subarray(0, position)),
      metadata: {pitch: cell.pitch, velocity: cell.velocity, metrics}};
  } finally {
    try { harness?.close(); }
    finally { if (prior === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR; else process.env.SORAOTO_WASM_BUILD_DIR = prior; }
  }
}
function stage4Report(roots, root, stage3Value, stage3Sha256, stage4Build, acceptanceOffset) {
  const capture = require('./capture-supersynth-stage4-lifecycle.cjs'), evaluator = require('./stage4-full-range-evaluator.cjs');
  const cells = [...capture.LIFECYCLE_CELLS, ...capture.REPEAT_CELLS].map(cell => ({...cell}));
  const calls = readAcceptanceCalls(roots, 'stage4', cells);
  const rows = calls.calls.map(call => ({...call.cell, metrics: call.metadata.value.metrics}));
  const matrix = rows.filter(row => row.kind === 'lifecycle'), repeats = rows.filter(row => row.kind === 'repeat');
  const stage3Identity = {resultSha256: stage3Sha256, identity: {sourceHead: stage3Value.sourceHead,
    build: stage3Value.build, fixtureSha256: stage3Value.fixtureSha256}};
  const identity = {stage3ResultSha256: stage3Sha256, stage3Identity: stage3Identity.identity};
  const stage3Rows = (stage3Value.rows || []).map(row => ({pitch: row.cell.pitch, velocity: row.cell.velocity, metrics: row.metrics}));
  const summary = evaluator.evaluate({root, identity, stage3Identity, stage3Rows, matrix, repeats,
    legacy: ({document}) => runLegacyStage4Conformance(root, document), legacyMatrixPath: null});
  const pass = summary.decision === 'STAGE4_FULL_RANGE_COMPLETE' && calls.completed === 1423 && calls.charged === 1423;
  const report = {schemaVersion: 1, gate: 'STAGE4', decision: pass ? 'STAGE4_FULL_RANGE_COMPLETE' : summary.decision,
    pass, sourceHead: currentIdentity(root).head, build: {directory: stage4Build.directory, wasmSha256: stage4Build.wasmSha256},
    calls: calls.completed, coverage: summary.coverage, counts: summary.counts, cellFailures: summary.cellFailures,
    repeatFailures: summary.repeatFailures, stage3IdentityStable: summary.stage3IdentityStable,
    legacyConformance: summary.legacyConformance, outputEquivalence: summary.outputEquivalence,
    accounting: core.accounting({startedExperimentCalls: readExperimentState(roots).charged,
      startedAcceptanceCalls: acceptanceOffset + calls.charged})};
  return recordAcceptanceReport(roots, 'stage4', report);
}
function runWebPlayerGates(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'web-player/package.json'), 'utf8'));
  if (!pkg.scripts?.test || !pkg.scripts?.build) throw new Error('BLOCKED_CONTACT_LOSS_WEB_PLAYER_SCRIPTS');
  runBuildCommand(path.join(root, 'web-player'), ['npm', 'test'], 'BLOCKED_CONTACT_LOSS_WEB_PLAYER_TESTS');
  runBuildCommand(path.join(root, 'web-player'), ['npm', 'run', 'build'], 'BLOCKED_CONTACT_LOSS_WEB_PLAYER_BUILD');
  return {test: 'PASS', build: 'PASS'};
}
function continuationDecision({selection, confirmation, headroom, release, stage3, stage4}) {
  if (selection?.status !== 'GATE4_STRESS_PASS') return {status: selection?.status || 'BLOCKED_CONTACT_LOSS_SELECTION_MISSING', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (confirmation && confirmation.pass !== true) return {status: confirmation.decision || 'BLOCKED_CONFIRMATION_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (headroom && headroom.pass !== true) return {status: headroom.decision || 'BLOCKED_HEADROOM_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (release && release.pass !== true) return {status: release.decision || 'BLOCKED_RELEASE_EQUIVALENCE_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (stage3 && stage3.pass !== true) return {status: stage3.decision || 'BLOCKED_STAGE3_ACCEPTANCE_FAIL', stage3: stage3.decision, stage4: 'NOT RUN'};
  if (stage4 && stage4.pass !== true) return {status: stage4.decision || 'BLOCKED_STAGE4_ACCEPTANCE_FAIL', stage3: 'PASS', stage4: stage4.decision};
  if (stage4?.pass === true) return {status: 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW', stage3: 'PASS', stage4: 'PASS'};
  return {status: 'CONTINUATION_READY'};
}
function estimateDualEvidenceBytes({remaining = {experiment: 42, confirmation: 25, headroom: 4,
  releaseEquivalence: 24, stage3: 486, stage4: 1423}} = {}) {
  const capture = require('./capture-supersynth-stage4-lifecycle.cjs');
  const frames = {experiment: RENDER_FRAMES, confirmation: RENDER_FRAMES, headroom: 96000,
    releaseEquivalence: RENDER_FRAMES, stage3: Math.floor(capture.SAMPLE_RATE * 0.38),
    stage4: Math.floor(capture.SAMPLE_RATE * (capture.HOLD_MS + capture.RELEASE_LIMIT_MS) / 1000) + capture.BLOCK};
  let wavBytes = 0, metadataAllowance = 0;
  for (const [stage, count] of Object.entries(remaining)) {
    if (!Object.hasOwn(frames, stage) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_STORAGE_ESTIMATE');
    }
    wavBytes += count * (44 + frames[stage] * 8);
    metadataAllowance += count * 16384;
  }
  const oneStoreBytes = wavBytes + metadataAllowance + 64 * 1024 * 1024;
  return {oneStoreBytes, dualStoreBytes: 2 * oneStoreBytes, promotionBuildAllowanceBytes: 2 * 1024 * 1024 * 1024};
}
function assertEvidenceCapacity({root = ROOT, home = os.homedir(), remaining} = {}) {
  const estimate = estimateDualEvidenceBytes({remaining});
  const freeBytes = directory => {
    const stats = fs.statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  };
  const repoFreeBytes = freeBytes(root), homeFreeBytes = freeBytes(home);
  const repoRequiredBytes = estimate.oneStoreBytes + estimate.promotionBuildAllowanceBytes;
  if (repoFreeBytes < repoRequiredBytes || homeFreeBytes < estimate.oneStoreBytes) {
    throw new Error(`BLOCKED_CONTACT_LOSS_INSUFFICIENT_STORAGE: repoFree=${repoFreeBytes};homeFree=${homeFreeBytes};repoRequired=${repoRequiredBytes};homeRequired=${estimate.oneStoreBytes}`);
  }
  return {repoFreeBytes, homeFreeBytes, repoRequiredBytes, homeRequiredBytes: estimate.oneStoreBytes, ...estimate};
}
function continueApproved({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory, archivePath} = {}) {
  const capacity = assertEvidenceCapacity({root, home});
  const roots = resolveRoots({root, home, commonDirectory});
  let state = readExperimentState(roots), selectionStored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`);
  if (!state.prepare) throw new Error('BLOCKED_CONTACT_LOSS_NOT_PREPARED');
  if (!selectionStored) {
    const first = runBounded({root, home, commonDirectory, buildDirectory, archivePath});
    state = readExperimentState(roots); selectionStored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`);
    if (!selectionStored) return {...first, stage3: 'NOT RUN', stage4: 'NOT RUN'};
  }
  const selection = selectionStored.value;
  if (selection.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection});
  const lock = acquireLock(roots);
  try {
    state = readExperimentState(roots);
    let promoted = readPromotion(roots), preparedIdentity, promotionCommittedWithoutReceipt = false;
    if (promoted) {
      promoted = verifyPromotedAuthority({roots, state, root, home, commonDirectory});
      const verified = verifySelectionAfterPromotion({roots, state, selectionStored, root, home, commonDirectory, archivePath});
      if (verified.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection: {status: verified.status}});
      preparedIdentity = preparedAcceptanceIdentity(state);
    } else if (currentIdentity(root).head !== state.prepare.head) {
      assertPromotionCommit({root, prepare: state.prepare, selectedAlpha: selection.selected.alpha,
        expectedHead: currentIdentity(root).head});
      promotionCommittedWithoutReceipt = true;
      const verified = verifySelectionAfterPromotion({roots, state, selectionStored, root, home, commonDirectory, archivePath});
      if (verified.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection: {status: verified.status}});
      preparedIdentity = preparedAcceptanceIdentity(state);
    } else {
      const verified = verifyExperiment({root, home, commonDirectory, buildDirectory, archivePath});
      if (verified.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection: {status: verified.status}});
      preparedIdentity = preparedAcceptanceIdentity(state);
    }
    const alpha = selection.selected?.alpha;
    if (!Number.isFinite(alpha) || !core.ALPHAS.includes(alpha)) throw new Error('BLOCKED_CONTACT_LOSS_SELECTED_ALPHA');
    if (!promoted && !promotionCommittedWithoutReceipt) verifyDiagnosticBuild(root, state.prepare.head, {buildDirectory});
    const confirmationCells = core.CONFIRMATION_CELLS.map((cell, index) => ({kind: 'confirmation', ...cell,
      cellOrder: index, alpha, alphaOrder: core.alphaIndex(alpha)}));
    if (promoted || promotionCommittedWithoutReceipt) verifyAcceptanceLedgerIdentity(roots, 'confirmation', confirmationCells, preparedIdentity);
    else runAcceptancePlan({roots, stage: 'confirmation', cells: confirmationCells,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: path.relative(root,
        path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL)), buildRole: 'diagnostic'}),
      render: cell => renderCall({root, buildDirectory, cell}), previousAcceptanceCalls: 0});
    verifyAcceptanceLedgerIdentity(roots, 'confirmation', confirmationCells, preparedIdentity);
    const confirmation = confirmationReport(roots, root, alpha).report;
    let result = continuationDecision({selection, confirmation});
    if (result.status !== 'CONTINUATION_READY') return result;
    const headroomCells = core.HEADROOM_CELLS.map(cell => ({...cell, kind: 'headroom', alpha: cell.role === 'baseline' ? 1 : alpha}));
    if (promoted || promotionCommittedWithoutReceipt) verifyAcceptanceLedgerIdentity(roots, 'headroom', headroomCells, preparedIdentity);
    else runAcceptancePlan({roots, stage: 'headroom', cells: headroomCells,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: path.relative(root,
        path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL)), buildRole: 'diagnostic'}),
      render: cell => renderHeadroomCall({root, buildDirectory, cell}), previousAcceptanceCalls: 25});
    verifyAcceptanceLedgerIdentity(roots, 'headroom', headroomCells, preparedIdentity);
    const headroom = headroomReport(roots, alpha).report;
    result = continuationDecision({selection, confirmation, headroom});
    if (result.status !== 'CONTINUATION_READY') return result;
    if (!promoted) promoted = promoteSelected({roots, state, selection, root, home, commonDirectory});
    const builds = buildPromotedPair({root});
    const buildReport = recordAcceptanceReport(roots, 'promoted-builds', {schemaVersion: 1, gate: 'PROMOTED_BUILDS',
      decision: 'PROMOTED_BUILDS_READY', pass: true, head: promoted.head, sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))), builds}).report;
    const testCells = core.RELEASE_CELLS, buildDirs = {test: builds.test.directory, release: builds.release.directory};
    for (const role of ['test', 'release']) {
      const stage = `release-${role}`, directory = buildDirs[role];
      runAcceptancePlan({roots, stage, cells: testCells,
        identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: directory,
          buildRole: role === 'test' ? 'guarded-test' : 'production-release'}),
        render: cell => renderReleaseCell({root, buildDirectory: directory, cell}),
        previousAcceptanceCalls: role === 'test' ? 29 : 41});
      verifyAcceptanceLedgerIdentity(roots, stage, testCells, {head: promoted.head,
        wasmSha256: builds[role].wasmSha256,
        sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))),
        buildRole: role === 'test' ? 'guarded-test' : 'production-release'});
    }
    const release = releaseEquivalenceReport(roots).report;
    result = continuationDecision({selection, confirmation, headroom, release});
    if (result.status !== 'CONTINUATION_READY') return result;
    const stage3Plan = stage3Cells();
    runAcceptancePlan({roots, stage: 'stage3', cells: stage3Plan,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: builds.test.directory, buildRole: 'guarded-test'}),
      render: cell => renderPromotedCell({root, buildDirectory: builds.test.directory, cell}), previousAcceptanceCalls: 53});
    verifyAcceptanceLedgerIdentity(roots, 'stage3', stage3Plan, {head: promoted.head, wasmSha256: builds.test.wasmSha256,
      sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))), buildRole: 'guarded-test'});
    const stage3 = stage3Report(roots, root, builds.test, 53).report;
    result = continuationDecision({selection, confirmation, headroom, release, stage3});
    if (result.status !== 'CONTINUATION_READY') return result;
    const lifecycleCells = [...require('./capture-supersynth-stage4-lifecycle.cjs').LIFECYCLE_CELLS,
      ...require('./capture-supersynth-stage4-lifecycle.cjs').REPEAT_CELLS].map(cell => ({...cell}));
    const priorStage4 = readAcceptanceCalls(roots, 'stage4', lifecycleCells);
    assertEvidenceCapacity({root, home, remaining: {stage4: lifecycleCells.length - priorStage4.completed}});
    runAcceptancePlan({roots, stage: 'stage4', cells: lifecycleCells,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: builds.test.directory, buildRole: 'guarded-test'}),
      render: cell => renderLifecycleWithAudio({root, buildDirectory: builds.test.directory, cell}), previousAcceptanceCalls: 539});
    verifyAcceptanceLedgerIdentity(roots, 'stage4', lifecycleCells, {head: promoted.head, wasmSha256: builds.test.wasmSha256,
      sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))), buildRole: 'guarded-test'});
    const stage4 = stage4Report(roots, root, stage3, readDual(roots, `${ACCEPTANCE_ROOT}/stage3/report.json`, {required: true}).sha256,
      builds.test, 539).report;
    result = continuationDecision({selection, confirmation, headroom, release, stage3, stage4});
    if (result.status !== 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW') return result;
    const webPlayer = runWebPlayerGates(root);
    const final = {schemaVersion: 1, issue: 7, pr: 8, decision: 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW',
      head: currentIdentity(root).head, selectionSha256: selectionStored.sha256, promotionSha256: promoted.promotionSha256,
      reports: Object.fromEntries(['confirmation', 'headroom', 'promoted-builds', 'release-equivalence', 'stage3', 'stage4']
        .map(name => [name, readDual(roots, `${ACCEPTANCE_ROOT}/${name}/report.json`, {required: true}).sha256])),
      webPlayer, capacity, manualAudio: 'NOT RUN', review: 'PENDING', accounting: core.accounting({startedExperimentCalls: state.charged,
        startedAcceptanceCalls: core.RESERVE_CALLS}), stage3: 'PASS', stage4: 'PASS'};
    writeDualImmutable(roots, `${ACCEPTANCE_ROOT}/final-report.json`, jsonBytes(final));
    return final;
  } finally { releaseLock(roots, lock); }
}

function status({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory}), state = readExperimentState(roots);
  const selection = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`), reports = {};
  let acceptanceCharged = 0;
  const report = stage => {
    const stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/${stage}/report.json`);
    reports[stage] = stored?.value.decision || 'NOT RUN';
    return stored?.value || null;
  };
  const count = (stage, cells) => {
    const calls = readAcceptanceCalls(roots, stage, cells);
    acceptanceCharged += calls.charged;
    return calls;
  };
  if (selection?.value.status === 'GATE4_STRESS_PASS') {
    const alpha = selection.value.selected?.alpha;
    if (!Number.isFinite(alpha)) throw new Error('BLOCKED_CONTACT_LOSS_SELECTED_ALPHA');
    count('confirmation', core.CONFIRMATION_CELLS.map((cell, index) => ({kind: 'confirmation', ...cell,
      cellOrder: index, alpha, alphaOrder: core.alphaIndex(alpha)})));
    report('confirmation');
    count('headroom', core.HEADROOM_CELLS.map(cell => ({...cell, kind: 'headroom', alpha: cell.role === 'baseline' ? 1 : alpha})));
    report('headroom');
    count('release-test', core.RELEASE_CELLS); count('release-production', core.RELEASE_CELLS);
    report('release-equivalence'); report('promoted-builds');
    const stage3Plan = stage3Cells(); count('stage3', stage3Plan); report('stage3');
    const lifecycleCells = [...require('./capture-supersynth-stage4-lifecycle.cjs').LIFECYCLE_CELLS,
      ...require('./capture-supersynth-stage4-lifecycle.cjs').REPEAT_CELLS];
    count('stage4', lifecycleCells); report('stage4');
  }
  const final = readJsonDual(roots, `${ACCEPTANCE_ROOT}/final-report.json`);
  return {status: final?.decision || readJsonDual(roots, `${EXPERIMENT_REL}/terminal.json`)?.value.status
      || selection?.value.status || state.status,
    charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
    acceptanceCharged, callCap: core.EXPERIMENT_CALL_CAP, acceptanceReserve: core.RESERVE_CALLS,
    cumulative: core.HISTORICAL_CALLS + state.charged + acceptanceCharged, lifetimeCap: core.MAX_CALLS,
    selection: selection?.value.status || 'NOT RUN', stage3: reports.stage3 || 'NOT RUN', stage4: reports.stage4 || 'NOT RUN',
    finalReport: final?.value.decision || 'NOT RUN', reports, writes: 0, renders: 0, acousticCalls: 0};
}

function parseMode(argv) {
  const modes = argv.filter(value => /^--(?:status|analyze|verify|prepare|run-bounded|continue-approved)$/.test(value));
  if (modes.length !== 1 || argv.some(value => !modes.includes(value))) {
    throw new Error('Usage: run-issue7-contact-loss-v1.cjs --status|--analyze|--verify|--prepare|--run-bounded|--continue-approved');
  }
  return modes[0].slice(2);
}
function main(argv = process.argv.slice(2)) {
  const mode = parseMode(argv);
  let result;
  if (mode === 'status') result = status();
  else if (mode === 'analyze') result = gate3Analysis();
  else if (mode === 'prepare') result = prepareExperiment();
  else if (mode === 'run-bounded') result = runBounded();
  else if (mode === 'verify') result = verifyExperiment();
  else if (mode === 'continue-approved') result = continueApproved();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${String(error.message || error).replace(/\n/g, ' ')}\n`); process.exitCode = 1; }
}

module.exports = {ROOT, REPOSITORY, PR_NUMBER, PR_BRANCH, PR_URL, CONTRACT_SHA256, SOURCE_FILES,
  resolveRoots, readDual, readJsonDual, writeDualImmutable, currentIdentity, verifiedPullRequest,
  verifyIssueApproval, latestOfflineReport, gate3Analysis, verifyDiagnosticBuild, prepareExperiment,
  frozenSourceSnapshot, frozenSnapshotSha256, assertFrozenSnapshotMatches, readExperimentState, writeFloatWav,
  officialMetricPayload, normalizeAnalyzerMetrics, analyzerFixture, assertAnalyzerContract, captureMetadata, renderCall, referenceRows,
  scoreAlpha, scoreCompletedAlpha, verifiedReceipt, runBounded, verifyStoredAlphaResults, verifyExperiment,
  buildPromotedPair, renderPromotedCell, renderReleaseCell, releaseEquivalenceReport, estimateDualEvidenceBytes,
  assertEvidenceCapacity, stage3Cells,
  stage3Report, renderLifecycleWithAudio, stage4Report, continuationDecision, continueApproved,
  status, parseMode, main};
