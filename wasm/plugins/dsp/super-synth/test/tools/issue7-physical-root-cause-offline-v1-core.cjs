'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const analysis = require('./analyze-issue7-physical-identification.cjs');
const loss = require('./physical-fit-v4-loss.cjs');
const direct = require('./stage3-direct-reference-metrics.cjs');

const ISSUE = 7;
const EPOCH = 'physical-root-cause-offline-v1/analysis-01';
const EPOCH_PREFIX = 'physical-root-cause-offline-v1/analysis-';
const ORIGINAL_OFFLINE_HEAD = '09fa69ddf715649f3fe1b7a802e0e753a02501f1';
const ORIGINAL_OFFLINE_REPORT_SHA256 = 'e819d9b18561b0ac78bc610377245ef8d34c072dcd0375a609b0aa04bdcf06b4';
const ORIGINAL_OFFLINE_MANIFEST_SHA256 = '8bb3e31ed4813b4536cbe717dd284ac27d7a463dde67295da10a7b2b5ef021aa';
const ARCHIVE_SHA256 = 'b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b';
const SFZ_MEMBER = 'SalamanderGrandPiano-SFZ+FLAC-V3+20200602/SalamanderGrandPiano-V3+20200602.sfz';
const DIAGNOSTIC_WASM_SHA256 = '1028c5a77b533ba97066d116f77aab80e5e91b45ef043394875614ee3efab99a';
const P1_RECORD_SHA256 = '65869564e931e67a1f408de6ddee4cd60ef1c3a969f0b10bf221abba89723827';
const V3_TERMINAL_SHA256 = '71f72e01945c13942802c1e34dd9bc908aa441ac8f0a840bf223a1ea4e9e5908';
const P3_RECORD_SHA256 = '637a6074874e34fa389c2190ee07e703e399da04a381f7e0b44d8fb2f29d9761';
const P3_RESULT_SHA256 = '67aa6f2ea5cc37903a8961cd221be894d30a3ac6a751847da0b620dda56d5d49';
const P3_SOURCE_MANIFEST_SHA256 = 'add747ce3d8ae57ecae2705c67fdac8d771f0d97c8cf1a3aca7c91b0968fc329';
const P5_RUNTIME_SHA256 = '90cf96c243f298cc6f91b8eba350f904c9581cd1924d53e272e422450d377307';
const P5_TERMINAL_SHA256 = '346a61a21e3c6fb46c97ee45c74616c523f8a180d63a032f30643532e73243ed';
const P5_DIAGNOSTICS_SHA256 = 'f847aab8c2775d3edded8225d3842f5c4ac52757631cf145fde54b4d844483d3';
const P5_HISTORY_SHA256 = '095503bc9382ee3057b29687779104f3f18fdff7c5016dc5a37a1ceadd1b38b0';
const ROOT_CAUSE_REPORT_SHA256 = 'acde9dc981ccf69a19648ab302ba517a653f9486643a9603990ce26bd6c8b10f';
const ROOT_CAUSE_MANIFEST_SHA256 = 'dcf9eaac04c6b6c093d6473b9c2510ab57244cb6bd4f44aa267b8899893ac551';
const ROOT_CAUSE_MANIFEST_HASH_FILE_SHA256 = '5f0e00f24ad25bf2f965cf45583d71d18c9bcbe15e21a43e0a247790a9910111';
const ROOT_CAUSE_RUNTIME_SHA256 = '11f790c988acc9ebb8c22779262ca6b9d38847cf13cd8eb6c530b060b8fd9fd2';
const P1_WASM_REL = 'build/issue7-physical-identification-v1/diagnostic/plugins/dsp/super-synth/plugin.wasm';
const P1_REL = 'runtime-revisions/physical-fit-P1.json';
const V3_TERMINAL_REL = 'candidate/result.json';
const P3_REL = 'runtime-revisions/physical-fit-P3.json';
const P3_RESULT_REL = 'p3/optimizer-result.json';
const P3_MANIFEST_REL = 'reference/source-manifest.json';
const P5_REL = 'runtime-revisions/physical-fit-P5.json';
const P5_DIAGNOSTICS_REL = 'p5/read-only-diagnostics.json';
const P5_HISTORY_REL = 'p5/observed-history.json';
const P5_TERMINAL_REL = 'p5/terminal-result.json';
const ROOT_CAUSE_REPORT_REL = 'reports/root-cause.json';
const ROOT_CAUSE_MARKDOWN_REL = 'reports/root-cause.md';
const ROOT_CAUSE_MANIFEST_REL = 'evidence-manifest.json';
const ROOT_CAUSE_MANIFEST_HASH_FILE_REL = 'evidence-manifest.sha256';
const ROOT_CAUSE_RUNTIME_REL = 'runtime-revisions/root-cause-v1.json';
const STRESS_CELLS = Object.freeze([[90, 31], [93, 31], [96, 14], [96, 31], [96, 36], [96, 124], [99, 31]]
  .map(([pitch, velocity]) => Object.freeze({pitch, velocity})));
const HOLDOUT_CELLS = Object.freeze([90, 93, 96, 99, 102].flatMap(pitch => [14, 31, 36, 61, 124]
  .map(velocity => Object.freeze({pitch, velocity}))));
const REFERENCE_CELLS = Object.freeze([...new Map([...STRESS_CELLS, ...HOLDOUT_CELLS]
  .map(cell => [`${cell.pitch}:${cell.velocity}`, cell])).values()]);
const EXPORTS = Object.freeze([
  'soraoto_supersynth_physical_identification_set',
  'soraoto_supersynth_physical_identification_get',
  'soraoto_supersynth_physical_identification_observation_reset',
  'soraoto_supersynth_physical_identification_observation'
]);

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function assertSafe(base, candidate) {
  const anchor = path.resolve(base), absolute = path.resolve(candidate);
  if (!inside(anchor, absolute)) throw new Error('BLOCKED_INPUT_PATH_ESCAPE');
  let cursor = anchor;
  if (fs.existsSync(cursor) && (fs.lstatSync(cursor).isSymbolicLink() || fs.realpathSync(cursor) !== cursor)) throw new Error('BLOCKED_INPUT_SYMLINK');
  for (const part of path.relative(anchor, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error('BLOCKED_INPUT_SYMLINK');
      if (cursor !== absolute && !stat.isDirectory()) throw new Error('BLOCKED_INPUT_NOT_DIRECTORY');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
function pair(primary, secondary, epoch) {
  return {primary, secondary, epoch};
}
function offlineEpoch(number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('BLOCKED_PUBLICATION:INVALID_OFFLINE_EPOCH');
  return `${EPOCH_PREFIX}${String(number).padStart(2, '0')}`;
}
function resolveOfflinePair(roots, number) {
  const suffix = `analysis-${String(number).padStart(2, '0')}`;
  const primary = path.join(roots.offlineBase.primaryRoot, suffix);
  const secondary = path.join(roots.offlineBase.secondaryRoot, suffix);
  assertSafe(roots.commonDirectory, primary);
  assertSafe(roots.home, secondary);
  return pair(primary, secondary, offlineEpoch(number));
}
function resolveInputRoots({root = path.resolve(__dirname, '../../../../../../'), home = os.homedir(), commonDirectory} = {}) {
  const repo = fs.realpathSync(path.resolve(root)), homePath = fs.realpathSync(path.resolve(home));
  const common = fs.realpathSync(path.resolve(commonDirectory || execFileSync('rtk', ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: repo, encoding: 'utf8'}).trim()));
  const roots = {
    repo, home: homePath, commonDirectory: common,
    v3: pair(path.join(common, 'soraoto-agent-state/7/physical-identification-v1/current-build-v3/physical-identification-v1'),
      path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-identification-v1/current-build-v3/physical-identification-v1'), 'v3'),
    v4: pair(path.join(common, 'soraoto-agent-state/7/physical-fit-v4/current-build-v4/physical-fit-recovery-v1'),
      path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-fit-v4/current-build-v4/physical-fit-recovery-v1'), 'v4'),
    v5: pair(path.join(common, 'soraoto-agent-state/7/physical-fit-v5/current-build-v5/shape-residual-recovery-v1'),
      path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-fit-v5/current-build-v5/shape-residual-recovery-v1'), 'v5'),
    rootCause: pair(path.join(common, 'soraoto-agent-state/7/physical-root-cause-v1/analysis-01'),
      path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-root-cause-v1/analysis-01'), 'root-cause-v1'),
    review01: pair(path.join(common, 'soraoto-agent-state/7/physical-fit-v5-review/continuation-01'),
      path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-fit-v5-review/continuation-01'), 'review-01'),
    review02: pair(path.join(common, 'soraoto-agent-state/7/physical-fit-v5-review/continuation-02'),
      path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-fit-v5-review/continuation-02'), 'review-02'),
    offline: pair(path.join(common, 'soraoto-agent-state/7/physical-root-cause-offline-v1/analysis-01'),
      path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-root-cause-offline-v1/analysis-01'), EPOCH),
    offlineBase: {
      primaryRoot: path.join(common, 'soraoto-agent-state/7/physical-root-cause-offline-v1'),
      secondaryRoot: path.join(homePath, '.soraoto-agent-archive/soraoto_dsl/7/physical-root-cause-offline-v1')
    }
  };
  for (const [name, rootsPair] of Object.entries(roots)) {
    if (!rootsPair || typeof rootsPair !== 'object' || !rootsPair.primary) continue;
    assertSafe(name === 'offline' || name === 'v3' || name === 'v4' || name === 'v5' || name.startsWith('review') || name === 'rootCause'
      ? common : common, rootsPair.primary);
    assertSafe(homePath, rootsPair.secondary);
  }
  const all = Object.entries(roots).filter(([, value]) => value?.primary);
  const rootPaths = all.flatMap(([name, value]) => [['primary', name, path.resolve(value.primary)], ['secondary', name, path.resolve(value.secondary)]]);
  for (let i = 0; i < rootPaths.length; i++) for (let j = i + 1; j < rootPaths.length; j++) {
    const a = rootPaths[i][2], b = rootPaths[j][2];
    if (inside(a, b) || inside(b, a)) throw new Error('BLOCKED_INPUT_ROOT_OVERLAP');
  }
  return roots;
}
function relativePath(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
    throw new Error('BLOCKED_INPUT_RELATIVE_PATH');
  }
  return relative;
}
function readOne(root, relative) {
  relativePath(relative);
  const file = assertSafe(root, path.join(root, relative));
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BLOCKED_INPUT_NOT_REGULAR_FILE');
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    try {
      const opened = fs.fstatSync(fd), bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
      if (!opened.isFile() || opened.size !== stat.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('UNVERIFIABLE_SOURCE_DATA:INPUT_CHANGED_DURING_READ');
      return {bytes, size: bytes.length, sha256: sha256(bytes), mtimeMs: after.mtimeMs};
    } finally { fs.closeSync(fd); }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function readDual(rootsPair, relative) {
  const primary = readOne(rootsPair.primary, relative), secondary = readOne(rootsPair.secondary, relative);
  if (Boolean(primary) !== Boolean(secondary)) throw new Error(`UNVERIFIABLE_SOURCE_DATA:DUAL_COPY_MISSING:${relative}`);
  if (!primary) return null;
  if (!primary.bytes.equals(secondary.bytes)) throw new Error(`UNVERIFIABLE_SOURCE_DATA:DUAL_COPY_DIVERGED:${relative}`);
  return {bytes: primary.bytes, size: primary.size, sha256: primary.sha256,
    primaryMtimeMs: primary.mtimeMs, secondaryMtimeMs: secondary.mtimeMs};
}
function readJson(rootsPair, relative) {
  const record = readDual(rootsPair, relative);
  if (!record) return null;
  let value;
  try { value = JSON.parse(record.bytes.toString('utf8')); } catch { throw new Error(`UNVERIFIABLE_SOURCE_DATA:INVALID_JSON:${relative}`); }
  return {value, ...record};
}
function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  assertSafe(path.dirname(root), root);
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name), stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('UNVERIFIABLE_SOURCE_DATA:SYMLINK_IN_EVIDENCE_STORE');
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) {
        const record = readOne(root, path.relative(root, absolute));
        if (!record || record.size !== stat.size || record.mtimeMs !== stat.mtimeMs) throw new Error('UNVERIFIABLE_SOURCE_DATA:PARENT_CHANGED_DURING_SNAPSHOT');
        files.push({path: path.relative(root, absolute).split(path.sep).join('/'), size: record.size,
          sha256: record.sha256, mtimeMs: record.mtimeMs});
      } else throw new Error('UNVERIFIABLE_SOURCE_DATA:SPECIAL_FILE_IN_EVIDENCE_STORE');
    }
  };
  visit(root);
  return files;
}
function snapshotSources(roots) {
  const snapshot = {};
  for (const name of ['v3', 'v4', 'v5', 'rootCause', 'review01', 'review02']) {
    const pairRoots = roots[name];
    const primary = walkFiles(pairRoots.primary), secondary = walkFiles(pairRoots.secondary);
    if (!same(primary.map(({path: p, size, sha256: hash}) => ({path: p, size, sha256: hash})),
      secondary.map(({path: p, size, sha256: hash}) => ({path: p, size, sha256: hash})))) {
      throw new Error(`UNVERIFIABLE_SOURCE_DATA:PARENT_INVENTORY_DIVERGED:${name}`);
    }
    snapshot[name] = {primary, secondary};
  }
  return snapshot;
}
function summarizeSources(snapshot) {
  const result = {};
  for (const [name, pairSnapshot] of Object.entries(snapshot)) {
    const summarize = files => {
      const content = files.map(({path: relative, size, sha256: digest}) => ({path: relative, size, sha256: digest}));
      const mtimes = files.map(({path: relative, mtimeMs}) => ({path: relative, mtimeMs}));
      return {fileCount: files.length, bytes: files.reduce((sum, row) => sum + row.size, 0),
        contentSha256: sha256(jsonBytes(content)), mtimeSha256: sha256(jsonBytes(mtimes))};
    };
    const primary = summarize(pairSnapshot.primary), secondary = summarize(pairSnapshot.secondary);
    result[name] = {primary, secondary, contentAndSizeMatch: primary.fileCount === secondary.fileCount
      && primary.bytes === secondary.bytes && primary.contentSha256 === secondary.contentSha256};
  }
  return result;
}
function verifyParentSnapshots(snapshot, rootCauseReport) {
  const expected = rootCauseReport?.inputIdentities?.parentInventories;
  const actual = summarizeSources(snapshot);
  if (!expected) throw new Error('UNVERIFIABLE_SOURCE_DATA:ROOT_CAUSE_PARENT_INVENTORY_MISSING');
  const names = [['v3', 'v3'], ['v4', 'v4'], ['v5', 'v5'], ['review-01', 'review01'], ['review-02', 'review02']];
  for (const [recordName, snapshotName] of names) {
    const recorded = expected[recordName], current = actual[snapshotName];
    if (!recorded || !current) throw new Error(`UNVERIFIABLE_SOURCE_DATA:PARENT_INVENTORY_MISSING:${recordName}`);
    for (const side of ['primary', 'secondary']) {
      const anchor = recorded[side], observed = current[side];
      const contentKey = side === 'primary' ? 'primaryContentSha256' : 'secondaryContentSha256';
      const mtimeKey = side === 'primary' ? 'primaryMtimeSha256' : 'secondaryMtimeSha256';
      if (!anchor || anchor.fileCount !== observed.fileCount || anchor.bytes !== observed.bytes
          || anchor[contentKey] !== observed.contentSha256 || anchor[mtimeKey] !== observed.mtimeSha256) {
        throw new Error(`UNVERIFIABLE_SOURCE_DATA:PARENT_INVENTORY_MISMATCH:${recordName}:${side}`);
      }
    }
    if (!current.contentAndSizeMatch || !recorded.primary.contentAndSizeMatch || !recorded.secondary.contentAndSizeMatch) {
      throw new Error(`UNVERIFIABLE_SOURCE_DATA:PARENT_DUAL_COPY_MISMATCH:${recordName}`);
    }
  }
  return {status: 'MATCHED_ROOT_CAUSE_V1_PARENT_INVENTORY', stores: names.length};
}
function verifyFrozenRecords(roots) {
  const p1 = readJson(roots.v3, P1_REL), v3Terminal = readJson(roots.v3, V3_TERMINAL_REL);
  const p3 = readJson(roots.v4, P3_REL), p3Result = readJson(roots.v4, P3_RESULT_REL), p3Manifest = readJson(roots.v4, P3_MANIFEST_REL);
  const p5 = readJson(roots.v5, P5_REL), p5Diagnostics = readJson(roots.v5, P5_DIAGNOSTICS_REL),
    p5History = readJson(roots.v5, P5_HISTORY_REL), p5Terminal = readJson(roots.v5, P5_TERMINAL_REL);
  const rootCauseReport = readJson(roots.rootCause, ROOT_CAUSE_REPORT_REL), rootCauseMarkdown = readDual(roots.rootCause, ROOT_CAUSE_MARKDOWN_REL),
    rootCauseManifest = readJson(roots.rootCause, ROOT_CAUSE_MANIFEST_REL), rootCauseManifestHashFile = readDual(roots.rootCause, ROOT_CAUSE_MANIFEST_HASH_FILE_REL),
    rootCauseRuntime = readJson(roots.rootCause, ROOT_CAUSE_RUNTIME_REL);
  const exact = (record, expected, code) => { if (!record || record.sha256 !== expected) throw new Error(`UNVERIFIABLE_SOURCE_DATA:${code}`); };
  exact(p1, P1_RECORD_SHA256, 'P1_RECORD_SHA_MISMATCH');
  exact(v3Terminal, V3_TERMINAL_SHA256, 'V3_TERMINAL_SHA_MISMATCH');
  exact(p3, P3_RECORD_SHA256, 'P3_RECORD_SHA_MISMATCH');
  exact(p3Result, P3_RESULT_SHA256, 'P3_RESULT_SHA_MISMATCH');
  exact(p3Manifest, P3_SOURCE_MANIFEST_SHA256, 'P3_SOURCE_MANIFEST_SHA_MISMATCH');
  exact(p5, P5_RUNTIME_SHA256, 'P5_RECORD_SHA_MISMATCH');
  exact(p5Diagnostics, P5_DIAGNOSTICS_SHA256, 'P5_DIAGNOSTICS_SHA_MISMATCH');
  exact(p5History, P5_HISTORY_SHA256, 'P5_HISTORY_SHA_MISMATCH');
  exact(p5Terminal, P5_TERMINAL_SHA256, 'P5_TERMINAL_SHA_MISMATCH');
  exact(rootCauseReport, ROOT_CAUSE_REPORT_SHA256, 'ROOT_CAUSE_REPORT_SHA_MISMATCH');
  exact(rootCauseManifest, ROOT_CAUSE_MANIFEST_SHA256, 'ROOT_CAUSE_MANIFEST_SHA_MISMATCH');
  exact(rootCauseManifestHashFile, ROOT_CAUSE_MANIFEST_HASH_FILE_SHA256, 'ROOT_CAUSE_MANIFEST_HASH_FILE_SHA_MISMATCH');
  exact(rootCauseRuntime, ROOT_CAUSE_RUNTIME_SHA256, 'ROOT_CAUSE_RUNTIME_SHA_MISMATCH');
  if (!rootCauseMarkdown || !rootCauseManifestHashFile.bytes.toString('utf8').includes(ROOT_CAUSE_MANIFEST_SHA256)) {
    throw new Error('UNVERIFIABLE_SOURCE_DATA:ROOT_CAUSE_MANIFEST_POINTER_MISMATCH');
  }
  const markdownSha256 = 'de926f511bd917a97683a2ff6501e779de9590c75a19e1929fef0ffd32236a87';
  const manifestFiles = [
    {path: ROOT_CAUSE_REPORT_REL, sha256: ROOT_CAUSE_REPORT_SHA256, size: rootCauseReport.size},
    {path: ROOT_CAUSE_MARKDOWN_REL, sha256: markdownSha256, size: rootCauseMarkdown.size},
    {path: ROOT_CAUSE_RUNTIME_REL, sha256: ROOT_CAUSE_RUNTIME_SHA256, size: rootCauseRuntime.size}
  ];
  if (!same(rootCauseManifest.value.files, manifestFiles) || rootCauseManifest.value.epoch !== 'physical-root-cause-v1/analysis-01'
      || rootCauseRuntime.value.reportSha256 !== ROOT_CAUSE_REPORT_SHA256 || rootCauseRuntime.value.markdownSha256 !== markdownSha256) {
    throw new Error('UNVERIFIABLE_SOURCE_DATA:ROOT_CAUSE_MANIFEST_CONTENT_MISMATCH');
  }
  const rootCauseExpectedFiles = [...manifestFiles,
    {path: ROOT_CAUSE_MANIFEST_REL, sha256: ROOT_CAUSE_MANIFEST_SHA256, size: rootCauseManifest.size},
    {path: ROOT_CAUSE_MANIFEST_HASH_FILE_REL, sha256: ROOT_CAUSE_MANIFEST_HASH_FILE_SHA256, size: rootCauseManifestHashFile.size}]
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const root of [roots.rootCause.primary, roots.rootCause.secondary]) {
    const inventory = walkFiles(root).map(({path: relative, size, sha256: digest}) => ({path: relative, size, sha256: digest}));
    if (!same(inventory, rootCauseExpectedFiles)) throw new Error('UNVERIFIABLE_SOURCE_DATA:ROOT_CAUSE_INVENTORY_MISMATCH');
  }
  const inputAnchor = rootCauseReport.value.inputIdentities;
  if (inputAnchor?.p5RuntimeSha256 !== P5_RUNTIME_SHA256 || inputAnchor?.p5TerminalSha256 !== P5_TERMINAL_SHA256
      || inputAnchor?.p5DiagnosticsSha256 !== P5_DIAGNOSTICS_SHA256 || inputAnchor?.p5HistorySha256 !== P5_HISTORY_SHA256) {
    throw new Error('UNVERIFIABLE_SOURCE_DATA:ROOT_CAUSE_P5_ANCHOR_MISMATCH');
  }
  if (p1.value.build?.wasmSha256 !== DIAGNOSTIC_WASM_SHA256) throw new Error('UNVERIFIABLE_SOURCE_DATA:P1_RECORD_WASM_IDENTITY_MISMATCH');
  if (v3Terminal.value.decision !== 'BLOCKED_PHYSICAL_FIT_NO_ACCEPTABLE_CANDIDATE') throw new Error('UNVERIFIABLE_SOURCE_DATA:V3_TERMINAL_DECISION_MISMATCH');
  if (p3Result.value.decision !== 'BLOCKED_PHYSICAL_FIT_V4_NO_ACCEPTABLE_CANDIDATE'
      || p3Result.value.archiveSha256 !== ARCHIVE_SHA256
      || p3Result.value.sourceManifestSha256 !== P3_SOURCE_MANIFEST_SHA256
      || p3Result.value.newVectorsCharged !== 12 || p3Result.value.newCandidateCalls !== 84) {
    throw new Error('UNVERIFIABLE_SOURCE_DATA:P3_OPTIMIZER_IDENTITY_MISMATCH');
  }
  const observations = p5History?.value?.observations;
  if (!Array.isArray(observations) || observations.length !== 20 || p5Terminal.value.decision !== 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT') {
    throw new Error('UNVERIFIABLE_SOURCE_DATA:P5_HISTORY_OR_TERMINAL_IDENTITY_MISMATCH');
  }
  if (!Number.isFinite(p3Result.value.sharedGainOffsetDb)) throw new Error('UNVERIFIABLE_SOURCE_DATA:P3_SHARED_GAIN_MISSING');
  return {p1, v3Terminal, p3, p3Result, p3Manifest, p5, p5Diagnostics, p5History, p5Terminal,
    rootCauseReport, rootCauseManifest, rootCauseRuntime,
    p5Observations: observations, sharedGainOffsetDb: p3Result.value.sharedGainOffsetDb};
}
function parseCanonicalJson(record, label) {
  let value;
  try { value = JSON.parse(record.bytes.toString('utf8')); } catch { throw new Error(`UNVERIFIABLE_SOURCE_DATA:INVALID_METADATA:${label}`); }
  if (!jsonBytes(value).equals(record.bytes)) throw new Error(`UNVERIFIABLE_SOURCE_DATA:NONCANONICAL_METADATA:${label}`);
  return value;
}
function assertCellList(cells, label) {
  if (!Array.isArray(cells) || cells.length !== STRESS_CELLS.length || !same(cells, STRESS_CELLS)) {
    throw new Error(`UNVERIFIABLE_SOURCE_DATA:CELL_ORDER_MISMATCH:${label}`);
  }
}
function historyBySource(p5History, source) {
  const observations = p5History.observations;
  if (!Array.isArray(observations)) throw new Error('UNVERIFIABLE_SOURCE_DATA:P5_HISTORY_MISSING_OBSERVATIONS');
  return observations.filter(item => item.source === source);
}
function readV3Stage(roots, stage) {
  const planRecord = readJson(roots.v3, `${stage}/plan.json`), ledgerRecord = readJson(roots.v3, `${stage}/ledger.json`);
  if (!planRecord || !ledgerRecord) throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_PLAN_LEDGER_MISSING:${stage}`);
  const plan = planRecord.value, ledger = ledgerRecord.value;
  if (!Array.isArray(plan.cells) || !ledger.cells || typeof ledger.cells !== 'object') throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_PLAN_LEDGER_INVALID:${stage}`);
  return {plan, ledger};
}
function readV3Rows(roots, p5History) {
  const expected = [
    {id: 'v3-baseline', source: 'immutable-v3-p1-baseline', stage: 'baseline', group: null},
    ...Array.from({length: 7}, (_, index) => ({id: `v3-candidate-${String(index + 1).padStart(2, '0')}`,
      source: 'immutable-v3-p1-candidate', stage: 'candidate', group: index}))
  ];
  const history = new Map(p5History.observations.map(item => [item.id, item]));
  const result = [];
  for (const item of expected) {
    const receipt = history.get(item.id);
    if (!receipt || receipt.source !== item.source) throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_HISTORY_IDENTITY:${item.id}`);
    const {plan, ledger} = readV3Stage(roots, item.stage);
    if (item.stage === 'baseline') assertCellList(plan.cells.map(({pitch, velocity}) => ({pitch, velocity})), item.id);
    const selected = item.group === null ? plan.cells : plan.cells.filter(cell => cell.candidate === item.group);
    assertCellList(selected.map(({pitch, velocity}) => ({pitch, velocity})), item.id);
    const values = item.group === null ? [1.05, 0.5, 0.018] : selected[0].values;
    if (item.group !== null && selected.some(cell => !same(cell.values, values))) throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_CANDIDATE_VECTOR_MISMATCH:${item.id}`);
    if (!same(receipt.values, values) || !Array.isArray(receipt.rows) || receipt.rows.length !== 7) throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_HISTORY_PARAMETERS_OR_ROWS:${item.id}`);
    const sourceRecord = readDual(roots.v3, `${item.stage}/result.json`);
    if (!sourceRecord || receipt.sourceSha256 !== sourceRecord.sha256) throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_SOURCE_SHA_MISMATCH:${item.id}`);
    const rows = selected.map((cell, index) => {
      const cellKey = `${cell.kind}:${cell.pitch}:${cell.velocity}:x:x:${cell.candidate ?? 'x'}:x`;
      const ledgerItem = ledger.cells[cellKey];
      if (!ledgerItem || ledgerItem.state !== 'COMPLETE' || typeof ledgerItem.result !== 'string') throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_INCOMPLETE_CELL:${item.id}:${cellKey}`);
      const metadataRel = `${item.stage}/${ledgerItem.result}`;
      const audioRel = `${item.stage}/artifacts/${encodeURIComponent(cellKey)}.wav`;
      const metadata = readDual(roots.v3, metadataRel), audio = readDual(roots.v3, audioRel);
      if (!metadata || !audio) throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_CELL_ARTIFACT_MISSING:${item.id}:${cellKey}`);
      const meta = parseCanonicalJson(metadata, `${item.id}:${cellKey}`);
      const historical = receipt.rows[index];
      if (!historical || historical.pitch !== cell.pitch || historical.velocity !== cell.velocity
          || historical.metadataSha256 !== metadata.sha256 || historical.wavSha256 !== audio.sha256) {
        throw new Error(`UNVERIFIABLE_SOURCE_DATA:V3_CELL_HASH_OR_ORDER_MISMATCH:${item.id}:${cellKey}`);
      }
      return {pitch: cell.pitch, velocity: cell.velocity, metadata, metadataRel, metadataValue: meta,
        audio, audioRel, guardHits: meta.row?.outputGuardHits ?? meta.outputGuardHits};
    });
    result.push({id: item.id, source: item.source, sourceSha256: sourceRecord.sha256, values, rows});
  }
  if (result.reduce((sum, item) => sum + item.rows.length, 0) !== 56) throw new Error('UNVERIFIABLE_SOURCE_DATA:V3_ROW_COUNT');
  return result;
}
function readVerifiedV3Rows(roots, p5History) {
  const baseline = readV3Rows(roots, p5History);
  return baseline;
}
function readVerifiedV4Rows(roots, p5History, p3 = null) {
  const optimizer = p3?.value || p3?.optimizer || p3;
  if (!optimizer || !Array.isArray(optimizer.rounds)) throw new Error('UNVERIFIABLE_SOURCE_DATA:P3_ROUNDS_MISSING');
  const scores = new Map();
  for (const round of optimizer.rounds) for (const item of (round.candidates || [])) if (item.score) {
    const old = scores.get(item.score.id);
    if (old && !same(old, item.score)) throw new Error(`UNVERIFIABLE_SOURCE_DATA:P3_DUPLICATE_SCORE_CONFLICT:${item.score.id}`);
    scores.set(item.score.id, item.score);
  }
  if (scores.size !== 12) throw new Error(`UNVERIFIABLE_SOURCE_DATA:P3_VECTOR_COUNT:${scores.size}`);
  const observations = historyBySource(p5History, 'v4');
  if (observations.length !== 12) throw new Error(`UNVERIFIABLE_SOURCE_DATA:V4_HISTORY_COUNT:${observations.length}`);
  const byId = new Map(observations.map(item => [item.id, item]));
  const rows = [];
  for (const score of [...scores.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const receipt = byId.get(score.id);
    if (!receipt || !same(receipt.values, score.values) || receipt.source !== 'v4' || receipt.sourceSha256 !== null) {
      throw new Error(`UNVERIFIABLE_SOURCE_DATA:V4_HISTORY_IDENTITY:${score.id}`);
    }
    assertCellList(receipt.rows.map(({pitch, velocity}) => ({pitch, velocity})), score.id);
    const vectorRows = STRESS_CELLS.map((cell, index) => {
      const id = `p3-${score.id}-${cell.pitch}-${cell.velocity}`;
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)) throw new Error('UNVERIFIABLE_SOURCE_DATA:P3_CALL_ID_INVALID');
      const call = `calls/${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;
      const metadata = readDual(roots.v4, `${call}/result.json`), audio = readDual(roots.v4, `${call}/audio.wav`);
      const historic = receipt.rows[index];
      if (!metadata || !audio || !historic || historic.metadataSha256 !== metadata.sha256 || historic.wavSha256 !== audio.sha256) {
        throw new Error(`UNVERIFIABLE_SOURCE_DATA:V4_CELL_HASH_MISMATCH:${score.id}:${cell.pitch}/${cell.velocity}`);
      }
      const meta = parseCanonicalJson(metadata, `${score.id}:${cell.pitch}/${cell.velocity}`);
      return {pitch: cell.pitch, velocity: cell.velocity, metadata, metadataRel: `${call}/result.json`, metadataValue: meta,
        audio, audioRel: `${call}/audio.wav`, guardHits: meta.row?.outputGuardHits ?? meta.outputGuardHits};
    });
    rows.push({id: score.id, source: 'v4', sourceSha256: null, values: score.values, rows: vectorRows});
  }
  return rows;
}
function readVerifiedReference(archive, expectedManifest) {
  const archivePath = typeof archive === 'string' ? archive : archive?.path;
  if (!archivePath || !fs.existsSync(archivePath) || !fs.lstatSync(archivePath).isFile() || fs.lstatSync(archivePath).isSymbolicLink()) throw new Error('UNVERIFIABLE_SOURCE_DATA:REFERENCE_ARCHIVE_MISSING');
  const fd = fs.openSync(archivePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const archiveHash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  const archiveBefore = fs.fstatSync(fd);
  let archiveSize = 0, archiveAfter;
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { archiveHash.update(buffer.subarray(0, count)); archiveSize += count; }
    archiveAfter = fs.fstatSync(fd);
  } finally { fs.closeSync(fd); }
  if (archiveBefore.size !== archiveSize || archiveAfter.size !== archiveBefore.size || archiveAfter.mtimeMs !== archiveBefore.mtimeMs) {
    throw new Error('UNVERIFIABLE_SOURCE_DATA:REFERENCE_ARCHIVE_CHANGED_DURING_READ');
  }
  const archiveSha256 = archiveHash.digest('hex');
  if (archiveSha256 !== ARCHIVE_SHA256 || expectedManifest?.archiveSha256 !== ARCHIVE_SHA256) throw new Error('UNVERIFIABLE_SOURCE_DATA:REFERENCE_ARCHIVE_SHA_MISMATCH');
  if (expectedManifest.sfzMember !== SFZ_MEMBER || !expectedManifest.samples || typeof expectedManifest.samples !== 'object') throw new Error('UNVERIFIABLE_SOURCE_DATA:P3_REFERENCE_MANIFEST_INVALID');
  const sfzBytes = execFileSync('rtk', ['run', 'tar', '-xOzf', archivePath, SFZ_MEMBER], {maxBuffer: 32 * 1024 * 1024});
  const sfzSha256 = sha256(sfzBytes);
  if (sfzSha256 !== expectedManifest.sfzSha256) throw new Error('UNVERIFIABLE_SOURCE_DATA:SFZ_SHA_MISMATCH');
  const parsed = analysis.parseSfz(sfzBytes.toString('utf8'));
  const rootMember = path.posix.dirname(SFZ_MEMBER), cellMembers = new Map();
  for (const cell of REFERENCE_CELLS) {
    const matches = parsed.regions.filter(region => {
      const root = Number(region.key ?? region.pitch_keycenter ?? cell.pitch);
      const lowKey = Number(region.lokey ?? root), highKey = Number(region.hikey ?? root);
      const lowVelocity = Number(region.lovel ?? 1), highVelocity = Number(region.hivel ?? 127);
      return region.trigger !== 'release' && cell.pitch >= lowKey && cell.pitch <= highKey
        && cell.velocity >= lowVelocity && cell.velocity <= highVelocity && region.sample;
    });
    if (matches.length !== 1) throw new Error(`UNVERIFIABLE_SOURCE_DATA:SFZ_MAPPING_COUNT:${cell.pitch}/${cell.velocity}`);
    if (path.posix.isAbsolute(matches[0].sample)) throw new Error('UNVERIFIABLE_SOURCE_DATA:SFZ_PATH_ESCAPE');
    const sampleRelative = path.posix.normalize(path.posix.join(parsed.globalOps.default_path || '.', matches[0].sample));
    if (sampleRelative.startsWith('../') || sampleRelative === '..' || path.posix.isAbsolute(sampleRelative)) throw new Error('UNVERIFIABLE_SOURCE_DATA:SFZ_PATH_ESCAPE');
    const member = path.posix.join(rootMember, sampleRelative);
    cellMembers.set(`${cell.pitch}:${cell.velocity}`, member);
  }
  const expectedMembers = Object.keys(expectedManifest.samples).sort();
  const mappedMembers = [...new Set(cellMembers.values())].sort();
  if (!same(mappedMembers, expectedMembers)) throw new Error(`UNVERIFIABLE_SOURCE_DATA:P3_SAMPLE_MANIFEST_COVERAGE:${JSON.stringify({expectedCount: expectedMembers.length, mappedCount: mappedMembers.length})}`);
  const cache = new Map();
  for (const member of expectedMembers) {
    const flacBytes = execFileSync('rtk', ['run', 'tar', '-xOzf', archivePath, member], {maxBuffer: 128 * 1024 * 1024});
    const expected = expectedManifest.samples[member];
    if (!expected || expected.sha256 !== sha256(flacBytes) || expected.size !== flacBytes.length) {
      throw new Error(`UNVERIFIABLE_SOURCE_DATA:FLAC_IDENTITY_MISMATCH:${path.posix.basename(member)}`);
    }
    const wavBytes = execFileSync('rtk', ['run', 'flac', '-d', '-c', '--silent', '-'], {input: flacBytes, maxBuffer: 128 * 1024 * 1024});
    cache.set(member, {flacSha256: sha256(flacBytes), flacSize: flacBytes.length, audio: analysis.decodeWav24Stereo(wavBytes)});
  }
  const rows = STRESS_CELLS.map(cell => {
    const member = cellMembers.get(`${cell.pitch}:${cell.velocity}`), sample = cache.get(member);
    const metrics = analysis.analyze(sample.audio.left, sample.audio.right, cell.pitch, sample.audio.sampleRate);
    return {pitch: cell.pitch, velocity: cell.velocity, sourceMember: member, sourceSha256: sample.flacSha256,
      sourceSize: sample.flacSize, audio: sample.audio, metrics};
  });
  const seen = Object.fromEntries([...cache.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([member, row]) => [member, {sha256: row.flacSha256, size: row.flacSize}]));
  if (!same(seen, expectedManifest.samples)) {
    const keys = [...new Set([...Object.keys(seen), ...Object.keys(expectedManifest.samples)])].sort();
    const mismatches = keys.filter(member => !same(seen[member], expectedManifest.samples[member])).map(member => ({
      sample: path.posix.basename(member), expectedSha256: expectedManifest.samples[member]?.sha256 ?? null,
      actualSha256: seen[member]?.sha256 ?? null, expectedSize: expectedManifest.samples[member]?.size ?? null,
      actualSize: seen[member]?.size ?? null
    }));
    throw new Error(`UNVERIFIABLE_SOURCE_DATA:P3_SAMPLE_MANIFEST_MISMATCH:${JSON.stringify({expectedCount: Object.keys(expectedManifest.samples).length,
      actualCount: Object.keys(seen).length, mismatches})}`);
  }
  return {archiveSha256, archiveSize, archiveMtimeMs: archiveBefore.mtimeMs, sfzSha256, sfzMember: SFZ_MEMBER, samples: seen, rows};
}
function normalizedViolation(evaluation) {
  const limits = evaluation.limits, values = [];
  for (const cell of evaluation.cells) {
    values.push(Math.max(0, cell.directLevelViolationDb) / limits.directLevelErrorDb);
    values.push(Math.max(0, cell.postAttackShapeViolationDb) / limits.postAttackShapeErrorDb);
    values.push(Math.max(0, cell.centroidRatio - limits.centroidRatio) / limits.centroidRatio);
    values.push(Math.max(0, cell.above2kDelta - limits.above2kDelta) / limits.above2kDelta);
    values.push(Math.max(0, cell.peakDbfs - limits.peakMaxDbfs) / Math.max(1, Math.abs(limits.peakMaxDbfs)));
    if (!cell.finite || cell.guardHits !== 0) throw new Error('UNVERIFIABLE_SOURCE_DATA:UNSAFE_OR_NONFINITE_PCM');
  }
  for (const row of evaluation.velocity) {
    values.push(Math.max(0, row.violationDb) / limits.dynamicSpanErrorDb);
    if (row.fails) values.push(1);
  }
  return Math.max(0, ...values);
}
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`UNVERIFIABLE_SOURCE_DATA:NONFINITE:${label}`);
  return value;
}
function recomputeOfficial({rows, reference, gainDb}) {
  finite(gainDb, 'sharedGainOffsetDb');
  const referenceRows = reference.rows || reference;
  if (!Array.isArray(rows) || rows.length !== 20 || !Array.isArray(referenceRows) || referenceRows.length !== 7) throw new Error('UNVERIFIABLE_SOURCE_DATA:OBSERVATION_OR_REFERENCE_COUNT');
  return rows.map(observation => {
    assertCellList(observation.rows.map(({pitch, velocity}) => ({pitch, velocity})), observation.id);
    const measuredRows = observation.rows.map(row => {
      if (!row.audio?.bytes || !Buffer.isBuffer(row.audio.bytes)) throw new Error(`UNVERIFIABLE_SOURCE_DATA:PCM_BYTES_MISSING:${observation.id}`);
      const decoded = loss.decodeFloat32StereoWav(row.audio.bytes);
      if (decoded.sampleRate !== 48000) throw new Error(`UNVERIFIABLE_SOURCE_DATA:PCM_SAMPLE_RATE:${observation.id}`);
      const measured = analysis.analyze(decoded.left, decoded.right, row.pitch, decoded.sampleRate);
      const guardHits = row.guardHits;
      if (!Number.isInteger(guardHits) || guardHits < 0) throw new Error(`UNVERIFIABLE_SOURCE_DATA:GUARD_METADATA_MISSING:${observation.id}:${row.pitch}/${row.velocity}`);
      measured.official.outputGuardHits = guardHits;
      measured.official.finite = measured.official.finite === true;
      return {pitch: row.pitch, velocity: row.velocity, metrics: measured.official, audio: decoded,
        metadataSha256: row.metadata.sha256, wavSha256: row.audio.sha256, guardHits};
    });
    const orderedRefs = STRESS_CELLS.map(cell => {
      const found = referenceRows.find(row => row.pitch === cell.pitch && row.velocity === cell.velocity);
      if (!found) throw new Error(`UNVERIFIABLE_SOURCE_DATA:REFERENCE_CELL_MISSING:${cell.pitch}/${cell.velocity}`);
      return found;
    });
    const evalRefs = orderedRefs.map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics.official || row.metrics}));
    const evalRows = measuredRows.map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics}));
    const evaluation = direct.evaluateDirectReferenceMatrix(evalRefs, evalRows,
      {requiredVelocityLayers: [14, 31, 36, 61, 124].filter(velocity => evalRefs.some(row => row.velocity === velocity))});
    const failureCount = evaluation.metrics.cellFailureCount + evaluation.metrics.directPitchFailureCount;
    const objective = loss.candidateLoss(orderedRefs.map((ref, index) => ({pitch: ref.pitch, reference: ref.audio, model: measuredRows[index].audio})), gainDb);
    const score = {id: observation.id, source: observation.source, sourceSha256: observation.sourceSha256 ?? null,
      values: observation.values, valuesSha256: sha256(jsonBytes(observation.values)), violation: normalizedViolation(evaluation),
      loss: finite(objective.total, `${observation.id}.loss`), pass: failureCount === 0, official: evaluation,
      rows: measuredRows.map(row => ({pitch: row.pitch, velocity: row.velocity,
        metadataSha256: row.metadataSha256, wavSha256: row.wavSha256})),
      guardHitsProvenance: 'AUTHENTICATED_STORED_METADATA'};
    score.metrics = evaluation.cells.map(cell => ({pitch: cell.pitch, velocity: cell.velocity,
      earlyResidualDb: finite(cell.earlyResidualDb, `${observation.id}.early`), lateResidualDb: finite(cell.lateResidualDb, `${observation.id}.late`),
      postAttackShapeErrorDb: finite(cell.postAttackShapeErrorDb, `${observation.id}.shape`), dominantResidual: cell.dominantResidual,
      hardFailures: cell.hardFailures, finite: cell.finite, guardHits: cell.guardHits, peakDbfs: finite(cell.peakDbfs, `${observation.id}.peak`)}));
    return score;
  });
}
function compareHistory(recomputed, p5History, tolerance = {db: 1e-6, nonDb: 1e-8}) {
  const dbTol = typeof tolerance === 'number' ? tolerance : tolerance.db ?? 1e-6;
  const nonDbTol = typeof tolerance === 'number' ? 1e-8 : tolerance.nonDb ?? 1e-8;
  const expected = p5History.observations;
  if (!Array.isArray(expected) || expected.length !== 20 || !Array.isArray(recomputed) || recomputed.length !== 20) throw new Error('PCM_METRIC_MISMATCH:OBSERVATION_COUNT');
  const mismatches = [];
  const maxAbsErrorDb = {earlyResidualDb: 0, lateResidualDb: 0, postAttackShapeErrorDb: 0, peakDbfs: 0};
  const maxAbsErrorNonDb = {officialViolation: 0, familyLoss: 0};
  const compareNumber = (id, field, actual, wanted, tol, maxima, maxKey = field) => {
    if (!Number.isFinite(actual) || !Number.isFinite(wanted) || Math.abs(actual - wanted) > tol) mismatches.push({id, field, actual, expected: wanted});
    if (Number.isFinite(actual) && Number.isFinite(wanted)) maxima[maxKey] = Math.max(maxima[maxKey], Math.abs(actual - wanted));
  };
  for (let i = 0; i < 20; i++) {
    const actual = recomputed[i], wanted = expected[i];
    if (actual.id !== wanted.id || actual.source !== wanted.source || (actual.sourceSha256 ?? null) !== (wanted.sourceSha256 ?? null)
        || !same(actual.values, wanted.values) || actual.valuesSha256 !== wanted.valuesSha256 || actual.pass !== wanted.pass) {
      mismatches.push({id: wanted.id, field: 'identity'});
    }
    compareNumber(wanted.id, 'officialViolation', actual.violation, wanted.officialViolation, nonDbTol, maxAbsErrorNonDb);
    compareNumber(wanted.id, 'familyLoss', actual.loss, wanted.familyLoss, nonDbTol, maxAbsErrorNonDb);
    if (!Array.isArray(actual.rows) || !same(actual.rows, wanted.rows) || !Array.isArray(actual.metrics) || actual.metrics.length !== 7 || !Array.isArray(wanted.metrics) || wanted.metrics.length !== 7) {
      mismatches.push({id: wanted.id, field: 'rows'}); continue;
    }
    for (let row = 0; row < 7; row++) {
      const a = actual.metrics[row], e = wanted.metrics[row];
      if (a.pitch !== e.pitch || a.velocity !== e.velocity || a.dominantResidual !== e.dominantResidual
          || !same(a.hardFailures, e.hardFailures) || a.finite !== e.finite || a.guardHits !== e.guardHits) {
        mismatches.push({id: wanted.id, field: `metrics[${row}].identity`});
      }
      for (const field of Object.keys(maxAbsErrorDb)) compareNumber(wanted.id, `metrics[${row}].${field}`, a[field], e[field], dbTol, maxAbsErrorDb, field);
    }
  }
  if (mismatches.length) throw Object.assign(new Error('PCM_METRIC_MISMATCH'), {code: 'PCM_METRIC_MISMATCH', mismatches});
  return {result: 'PCM_METRICS_RECOMPUTED_AND_MATCHED', observationCount: 20, cellCount: 140,
    dbTolerance: dbTol, nonDbTolerance: nonDbTol, maxAbsErrorDb, maxAbsErrorNonDb,
    guardHitsProvenance: 'AUTHENTICATED_STORED_METADATA'};
}
function sanitizeReportValue(value, key = '') {
  if (/^(?:path|.*absolutePath|archivePath|wasmPath|privatePath)$/i.test(key)) return undefined;
  if (typeof value === 'string') return value.replace(/(?:\/Users\/[^/\s]+(?:\/[^\s]*)?|\/private\/[^\s]+|[A-Za-z]:\\[^\s]+)/g, '$PRIVATE_PATH');
  if (Array.isArray(value)) return value.map(item => sanitizeReportValue(item)).filter(item => item !== undefined);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([childKey, child]) => [childKey, sanitizeReportValue(child, childKey)]).filter(([, child]) => child !== undefined));
  return value;
}
function buildReport(input) {
  const report = {
    schemaVersion: 1, issue: ISSUE, epoch: input.epoch || EPOCH, createdAt: null,
    delivery: sanitizeReportValue(input.delivery || {repository: 'puchinya/soraoto_dsl', issue: ISSUE,
      prUrl: 'https://github.com/puchinya/soraoto_dsl/pull/8', prBranch: null, currentHead: null, upstreamBranch: null}),
    outcome: input.outcome || 'GATE0_2_IMPLEMENTED_BUT_PRIVATE_EVIDENCE_BLOCKED',
    gate0: {status: 'PASS', acousticCalls: 0, builds: 0, renders: 0, budgetsChanged: false},
    gate1: sanitizeReportValue(input.gate1 || {status: 'NOT RUN'}),
    gate2: sanitizeReportValue(input.gate2 || {status: 'NOT RUN'}),
    historicExecutableIdentity: input.historicExecutableIdentity || 'HISTORICAL_BINARY_UNAVAILABLE',
    storedPcmEvaluation: input.storedPcmEvaluation || 'UNVERIFIABLE_SOURCE_DATA',
    sourceSnapshots: sanitizeReportValue(input.sourceSnapshots || null),
    publication: input.publication || 'NOT ATTEMPTED',
    stage3: 'NOT EVALUATED', stage4: 'NOT EVALUATED', productAcousticAcceptance: 'BLOCKED',
    sourceDataPathsRedacted: true
  };
  return JSON.stringify(stable(report), null, 2) + '\n';
}

module.exports = {ISSUE, EPOCH, EPOCH_PREFIX, ORIGINAL_OFFLINE_HEAD, ORIGINAL_OFFLINE_REPORT_SHA256,
  ORIGINAL_OFFLINE_MANIFEST_SHA256, offlineEpoch, resolveOfflinePair, ARCHIVE_SHA256, SFZ_MEMBER, DIAGNOSTIC_WASM_SHA256, P1_RECORD_SHA256,
  V3_TERMINAL_SHA256, P3_RECORD_SHA256, P3_RESULT_SHA256, P3_SOURCE_MANIFEST_SHA256, P5_RUNTIME_SHA256,
  P5_TERMINAL_SHA256, P5_DIAGNOSTICS_SHA256, P5_HISTORY_SHA256, ROOT_CAUSE_REPORT_SHA256,
  ROOT_CAUSE_MANIFEST_SHA256, ROOT_CAUSE_RUNTIME_SHA256, P1_WASM_REL, P1_REL, V3_TERMINAL_REL, P3_REL,
  P3_RESULT_REL, P3_MANIFEST_REL, P5_REL, P5_DIAGNOSTICS_REL, P5_HISTORY_REL, P5_TERMINAL_REL,
  ROOT_CAUSE_REPORT_REL, ROOT_CAUSE_MARKDOWN_REL, ROOT_CAUSE_MANIFEST_REL, ROOT_CAUSE_MANIFEST_HASH_FILE_REL,
  ROOT_CAUSE_RUNTIME_REL, STRESS_CELLS, HOLDOUT_CELLS, REFERENCE_CELLS, EXPORTS, sha256, jsonBytes, stable, same, inside,
  resolveInputRoots, snapshotSources, summarizeSources, verifyFrozenRecords, verifyParentSnapshots, readVerifiedV3Rows, readVerifiedV4Rows,
  readVerifiedReference, recomputeOfficial, compareHistory, buildReport,
  summarizeSources,
  // Read-only primitives exported for synthetic contract tests.
  readDual, readJson, parseCanonicalJson, assertSafe, normalizedViolation};
