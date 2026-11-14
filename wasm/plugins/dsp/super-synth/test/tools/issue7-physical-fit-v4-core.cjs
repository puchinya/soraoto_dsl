'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../../../../');
const ISSUE = 7;
const EPOCH = 'current-build-v4/physical-fit-recovery-v1';
const LINEAGE = Object.freeze({diagnostic: 'physical-fit-P3', production: 'physical-fit-P4'});
const HISTORICAL_CALLS = 3167;
const MAX_CALLS = 5213;
const STAGES = Object.freeze({candidate: 84, holdout: 25, headroom: 4, releaseEquivalence: 24, stage3: 486, stage4: 1423});
const PARAMETERS = Object.freeze([
  Object.freeze({name: 'initial_velocity_velocity_scale', baseline: 1.05}),
  Object.freeze({name: 'velocity_hardness_amount', baseline: 0.5}),
  Object.freeze({name: 'stiffness_soft', baseline: 0.018})
]);
const STRESS_CELLS = Object.freeze([
  [90, 31], [93, 31], [96, 14], [96, 31], [96, 36], [96, 124], [99, 31]
].map(([pitch, velocity]) => Object.freeze({pitch, velocity})));
const HOLDOUT_CELLS = Object.freeze([90, 93, 96, 99, 102].flatMap(pitch => [14, 31, 36, 61, 124].map(velocity => Object.freeze({pitch, velocity}))));
const RELEASE_SINGLE_CELLS = Object.freeze([
  [48, 14], [48, 124], [60, 31], [78, 36], [90, 31], [93, 31], [96, 31], [96, 124], [99, 124], [108, 124]
].map(([pitch, velocity]) => Object.freeze({kind: 'single', pitch, velocity})));
const RELEASE_CHORDS = Object.freeze([
  Object.freeze({kind: 'chord', pattern: 'open-c-major-nine', pitches: Object.freeze([48, 55, 60, 64, 67, 71, 74, 76, 79, 84]), velocity: 124}),
  Object.freeze({kind: 'chord', pattern: 'dense-32-note', pitches: Object.freeze(Array.from({length: 32}, (_, i) => i + 48)), velocity: 124})
]);

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function assertNoSymlink(base, target) {
  const anchor = path.resolve(base), absolute = path.resolve(target);
  if (!inside(anchor, absolute)) throw new Error('BLOCKED_PHYSICAL_V4_ROOT_ESCAPE');
  const relative = path.relative(anchor, absolute);
  let cursor = anchor;
  if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('BLOCKED_PHYSICAL_V4_SYMLINK');
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('BLOCKED_PHYSICAL_V4_SYMLINK');
  }
  return absolute;
}
function resolveRoots(root = ROOT, home = os.homedir(), commonDirectory) {
  const repo = fs.realpathSync(path.resolve(root));
  const common = fs.realpathSync(path.resolve(commonDirectory || execFileSync('rtk', ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: repo, encoding: 'utf8'}).trim()));
  const homePath = fs.realpathSync(path.resolve(home));
  const primaryBase = path.join(common, 'soraoto-agent-state', String(ISSUE), 'physical-fit-v4');
  const secondaryBase = path.join(homePath, '.soraoto-agent-archive', 'soraoto_dsl', String(ISSUE), 'physical-fit-v4');
  const suffix = EPOCH.split('/');
  const primary = path.join(primaryBase, ...suffix), secondary = path.join(secondaryBase, ...suffix);
  assertNoSymlink(common, primary); assertNoSymlink(homePath, secondary);
  if (inside(primary, secondary) || inside(secondary, primary)) throw new Error('BLOCKED_PHYSICAL_V4_ROOT_OVERLAP');
  return {repo, primary, secondary, primaryBase, secondaryBase, commonDirectory: common, home: homePath, epoch: EPOCH};
}
function assertRelative(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('BLOCKED_PHYSICAL_V4_RELATIVE_PATH');
}
function dualPaths(roots, relative) {
  assertRelative(relative);
  return {primary: assertNoSymlink(roots.primary, path.join(roots.primary, relative)), secondary: assertNoSymlink(roots.secondary, path.join(roots.secondary, relative))};
}
function readDual(roots, relative) {
  const files = dualPaths(roots, relative), hasPrimary = fs.existsSync(files.primary), hasSecondary = fs.existsSync(files.secondary);
  if (hasPrimary !== hasSecondary) throw new Error(`BLOCKED_PHYSICAL_V4_PARTIAL_DUAL_COPY: ${relative}`);
  if (!hasPrimary) return null;
  const primary = fs.readFileSync(files.primary), secondary = fs.readFileSync(files.secondary);
  if (!primary.equals(secondary)) throw new Error(`BLOCKED_PHYSICAL_V4_DIVERGENT_DUAL_COPY: ${relative}`);
  return {bytes: primary, size: primary.length, sha256: sha256(primary)};
}
function ensureDirectory(base, target) {
  const absolute = assertNoSymlink(base, target);
  fs.mkdirSync(absolute, {recursive: true});
  assertNoSymlink(base, absolute);
  return absolute;
}
function writeExclusive(file, bytes, base) {
  ensureDirectory(base, path.dirname(file));
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function writeImmutableDual(roots, relative, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), files = dualPaths(roots, relative);
  const old = readDual(roots, relative);
  if (old) {
    if (!old.bytes.equals(bytes)) throw new Error(`BLOCKED_PHYSICAL_V4_IMMUTABLE_CONFLICT: ${relative}`);
    return old;
  }
  writeExclusive(files.primary, bytes, roots.primary);
  writeExclusive(files.secondary, bytes, roots.secondary);
  const stored = readDual(roots, relative);
  if (!stored || !stored.bytes.equals(bytes)) throw new Error(`BLOCKED_PHYSICAL_V4_IMMUTABLE_READBACK: ${relative}`);
  return stored;
}
function writeMutableDual(roots, relative, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), files = dualPaths(roots, relative);
  const prior = readDual(roots, relative);
  for (const [file, base] of [[files.primary, roots.primary], [files.secondary, roots.secondary]]) {
    ensureDirectory(base, path.dirname(file));
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    writeExclusive(temporary, bytes, base);
    fs.renameSync(temporary, file);
  }
  const stored = readDual(roots, relative);
  if (!stored || !stored.bytes.equals(bytes)) throw new Error(`BLOCKED_PHYSICAL_V4_MUTABLE_READBACK: ${relative}`);
  if (prior && stored.sha256 === prior.sha256 && stored.size !== prior.size) throw new Error(`BLOCKED_PHYSICAL_V4_MUTABLE_SIZE: ${relative}`);
  return stored;
}
function appendDual(roots, relative, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), files = dualPaths(roots, relative), old = readDual(roots, relative);
  const prior = old?.bytes || Buffer.alloc(0);
  for (const [file, base] of [[files.primary, roots.primary], [files.secondary, roots.secondary]]) {
    ensureDirectory(base, path.dirname(file));
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  const stored = readDual(roots, relative);
  if (!stored || !stored.bytes.equals(Buffer.concat([prior, bytes]))) throw new Error(`BLOCKED_PHYSICAL_V4_JOURNAL_READBACK: ${relative}`);
  return stored;
}
function readJson(roots, relative, required = true) {
  const stored = readDual(roots, relative);
  if (!stored) { if (required) throw new Error(`BLOCKED_PHYSICAL_V4_MISSING: ${relative}`); return null; }
  try { return JSON.parse(stored.bytes.toString('utf8')); } catch { throw new Error(`BLOCKED_PHYSICAL_V4_INVALID_JSON: ${relative}`); }
}
function writeJson(roots, relative, value, immutable = false) {
  const bytes = jsonBytes(value);
  return immutable ? writeImmutableDual(roots, relative, bytes) : writeMutableDual(roots, relative, bytes);
}
function snapshotTree(root) {
  if (!fs.existsSync(root)) return [];
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('BLOCKED_PHYSICAL_V4_SYMLINK');
  const rows = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`BLOCKED_PHYSICAL_V4_SYMLINK: ${file}`);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) rows.push({path: path.relative(root, file).split(path.sep).join('/'), size: stat.size, sha256: sha256(fs.readFileSync(file)), mtimeMs: stat.mtimeMs});
      else throw new Error(`BLOCKED_PHYSICAL_V4_SPECIAL_FILE: ${file}`);
    }
  }
  visit(root);
  return rows;
}
function snapshots(roots) { return {primary: snapshotTree(roots.primary), secondary: snapshotTree(roots.secondary)}; }
function assertSnapshotsSame(before, after) {
  if (!same(before, after)) throw new Error('BLOCKED_PHYSICAL_V4_READ_ONLY_SNAPSHOT_CHANGED');
}
function assertDualInventories(roots) {
  const a = snapshotTree(roots.primary), b = snapshotTree(roots.secondary);
  const identity = rows => rows.map(({path: itemPath, size, sha256: digest}) => ({path: itemPath, size, sha256: digest}));
  if (!same(identity(a), identity(b))) throw new Error('BLOCKED_PHYSICAL_V4_STORE_INVENTORY_MISMATCH');
  return {fileCount: a.length, bytes: a.reduce((sum, row) => sum + row.size, 0), contentSha256: sha256(jsonBytes(identity(a)))};
}
function lockPaths(roots) { return dualPaths(roots, 'locks/master.json'); }
function acquireLock(roots, ownerId, now = () => new Date().toISOString()) {
  const files = lockPaths(roots);
  if (fs.existsSync(files.primary) || fs.existsSync(files.secondary)) throw new Error('BLOCKED_PHYSICAL_V4_WRITER_LOCK_PRESENT');
  const record = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, ownerId, pid: process.pid, hostname: os.hostname(), acquiredAt: now()};
  const bytes = jsonBytes(record);
  writeExclusive(files.primary, bytes, roots.primary);
  writeExclusive(files.secondary, bytes, roots.secondary);
  const back = readDual(roots, 'locks/master.json');
  if (!back || !back.bytes.equals(bytes)) throw new Error('BLOCKED_PHYSICAL_V4_WRITER_LOCK_READBACK');
  return {ownerId, record};
}
function releaseLock(roots, lock) {
  const files = lockPaths(roots), old = readDual(roots, 'locks/master.json');
  if (!old) throw new Error('BLOCKED_PHYSICAL_V4_WRITER_LOCK_MISSING');
  const record = JSON.parse(old.bytes.toString('utf8'));
  if (record.ownerId !== lock.ownerId || !fs.existsSync(files.primary) || !fs.existsSync(files.secondary)) throw new Error('BLOCKED_PHYSICAL_V4_WRITER_LOCK_OWNER_MISMATCH');
  fs.unlinkSync(files.primary); fs.unlinkSync(files.secondary);
}
function slug(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_'); }
function callKey(id) { return `calls/${slug(id)}`; }
function startCall(roots, id, meta, {now = () => new Date().toISOString()} = {}) {
  const base = callKey(id), markerRel = `${base}/start.json`, rowRel = `${base}/result.json`, wavRel = `${base}/audio.wav`;
  const existingMarker = readJson(roots, markerRel, false), existingResult = readJson(roots, rowRel, false), existingAudio = readDual(roots, wavRel);
  if (existingMarker) {
    if (existingResult && (!existingMarker.meta?.audioArtifactRequired || existingAudio)) return {reused: true, result: existingResult, artifact: existingAudio};
    throw new Error(`BLOCKED_PHYSICAL_V4_AMBIGUOUS_CALL: ${id}`);
  }
  const accounting = readJson(roots, 'accounting.json', false) || {schemaVersion: 1, charged: 0};
  if (!Number.isInteger(accounting.charged) || HISTORICAL_CALLS + accounting.charged + 1 > MAX_CALLS) throw new Error('BLOCKED_PHYSICAL_V4_BUDGET');
  const at = now(), marker = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, id, meta, ownerId: readJson(roots, 'locks/master.json').ownerId, pid: process.pid, hostname: os.hostname(), startedAt: at, charge: 1};
  writeJson(roots, markerRel, marker, true);
  accounting.charged++;
  writeJson(roots, 'accounting.json', accounting);
  appendDual(roots, 'journal/calls.jsonl', Buffer.from(`${JSON.stringify({event: 'started', id, meta, at, charge: 1})}\n`));
  return {reused: false, marker, accounting};
}
function completeCall(roots, id, row, audio, {now = () => new Date().toISOString()} = {}) {
  const base = callKey(id), marker = readJson(roots, `${base}/start.json`), oldResult = readJson(roots, `${base}/result.json`, false);
  if (oldResult) {
    const oldAudio = readDual(roots, `${base}/audio.wav`);
    if (oldResult.rowSha256 !== sha256(jsonBytes(row)) || (audio && (!oldAudio || oldAudio.sha256 !== sha256(audio))) || (!audio && oldAudio)) throw new Error(`BLOCKED_PHYSICAL_V4_RESULT_IMMUTABLE_CONFLICT: ${id}`);
    return {result: oldResult, audio: oldAudio};
  }
  if (!marker || readDual(roots, `${base}/audio.wav`) || (!audio && marker.meta?.audioArtifactRequired)) throw new Error(`BLOCKED_PHYSICAL_V4_CALL_STATE: ${id}`);
  const storedAudio = audio ? writeImmutableDual(roots, `${base}/audio.wav`, audio) : null;
  const record = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, id, startedAt: marker.startedAt, completedAt: now(), row, rowSha256: sha256(jsonBytes(row)), audio: storedAudio ? {path: `${base}/audio.wav`, size: storedAudio.size, sha256: storedAudio.sha256} : null};
  const storedResult = writeJson(roots, `${base}/result.json`, record, true);
  appendDual(roots, 'journal/calls.jsonl', Buffer.from(`${JSON.stringify({event: 'complete', id, resultSha256: storedResult.sha256, audioSha256: storedAudio.sha256, at: record.completedAt})}\n`));
  return {result: record, audio: storedAudio};
}
function markAmbiguous(roots, id, reason, {now = () => new Date().toISOString()} = {}) {
  const relative = `${callKey(id)}/ambiguous.json`;
  return writeJson(roots, relative, {schemaVersion: 1, id, reason: String(reason), at: now()}, true);
}
function charged(roots) { return readJson(roots, 'accounting.json', false)?.charged || 0; }
function cellKey(cell) { return `${cell.kind || 'cell'}:${cell.pitch ?? 'x'}:${cell.velocity ?? 'x'}:${cell.pattern ?? 'x'}:${cell.id ?? 'x'}`; }
function validateValues(values) {
  if (!Array.isArray(values) || values.length !== PARAMETERS.length || values.some((value, index) => !Number.isFinite(value) || value < PARAMETERS[index].baseline * 0.9 - 1e-12 || value > PARAMETERS[index].baseline * 1.1 + 1e-12)) throw new Error('BLOCKED_PHYSICAL_V4_PARAMETER_BOUNDS');
  return values.map(Number);
}
function distanceFromBaseline(values) { return Math.sqrt(values.reduce((sum, value, i) => sum + ((value - PARAMETERS[i].baseline) / PARAMETERS[i].baseline) ** 2, 0)); }
function vectorsEqual(a, b, tolerance = 1e-9) {
  return a.length === b.length && a.every((value, i) => Math.abs((value - b[i]) / PARAMETERS[i].baseline) <= tolerance);
}
function neighborVectors(center, fraction, observed) {
  validateValues(center);
  const vectors = [];
  for (let parameter = 0; parameter < PARAMETERS.length; parameter++) {
    for (const sign of [-1, 1]) {
      const candidate = [...center];
      candidate[parameter] = Math.max(PARAMETERS[parameter].baseline * 0.9, Math.min(PARAMETERS[parameter].baseline * 1.1, center[parameter] + sign * PARAMETERS[parameter].baseline * fraction));
      if (vectors.some(item => vectorsEqual(item, candidate))) continue;
      vectors.push(candidate);
    }
  }
  return vectors.map((values, index) => ({id: `p3-r${fraction === 0.05 ? '01' : '02'}-${String(index + 1).padStart(2, '0')}`, values, reuse: observed.find(item => vectorsEqual(item.values, values)) || null}));
}
function compareScores(a, b, epsilon = 1e-9) {
  for (const key of ['violation', 'loss', 'distance']) {
    if (a[key] < b[key] - epsilon) return -1;
    if (a[key] > b[key] + epsilon) return 1;
  }
  return String(a.id).localeCompare(String(b.id));
}
function strictImprovement(candidate, incumbent, epsilon = 1e-9) { return compareScores(candidate, incumbent, epsilon) < 0; }
function exactCellSet(cells, expected, label) {
  if (!Array.isArray(cells) || cells.length !== expected || new Set(cells.map(cellKey)).size !== expected) throw new Error(`BLOCKED_PHYSICAL_V4_CELL_SET: ${label}`);
  return cells;
}

module.exports = {ROOT, ISSUE, EPOCH, LINEAGE, HISTORICAL_CALLS, MAX_CALLS, STAGES, PARAMETERS, STRESS_CELLS,
  HOLDOUT_CELLS, RELEASE_SINGLE_CELLS, RELEASE_CHORDS, sha256, jsonBytes, stable, same, inside, assertNoSymlink,
  resolveRoots, dualPaths, readDual, readJson, writeImmutableDual, writeMutableDual, writeJson, appendDual,
  snapshotTree, snapshots, assertSnapshotsSame, assertDualInventories, acquireLock, releaseLock, callKey, startCall,
  completeCall, markAmbiguous, charged, cellKey, validateValues, distanceFromBaseline, vectorsEqual, neighborVectors,
  compareScores, strictImprovement, exactCellSet};
