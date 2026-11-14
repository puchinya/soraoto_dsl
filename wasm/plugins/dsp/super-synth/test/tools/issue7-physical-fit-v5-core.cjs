'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../../../../');
const ISSUE = 7;
const EPOCH = 'current-build-v5/shape-residual-recovery-v1';
const LINEAGE = Object.freeze({diagnostic: 'physical-fit-P5', production: 'physical-fit-P6'});
const HISTORICAL_CALLS = 3251;
const MAX_CALLS = 5255;
const PARAMETERS = Object.freeze([
  Object.freeze({name: 'initial_velocity_velocity_scale', baseline: 1.05}),
  Object.freeze({name: 'velocity_hardness_amount', baseline: 0.5}),
  Object.freeze({name: 'stiffness_soft', baseline: 0.018})
]);
const STRESS_CELLS = Object.freeze([[90, 31], [93, 31], [96, 14], [96, 31], [96, 36], [96, 124], [99, 31]]
  .map(([pitch, velocity]) => Object.freeze({pitch, velocity})));
const STAGES = Object.freeze({candidate: 42, confirmation: 25, headroom: 4, releaseEquivalence: 24, stage3: 486, stage4: 1423});

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function inside(base, target) { const relative = path.relative(base, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function assertNoSymlink(base, target) {
  const absoluteBase = path.resolve(base), absolute = path.resolve(target);
  if (!inside(absoluteBase, absolute)) throw new Error('BLOCKED_V5_ROOT_ESCAPE');
  let cursor = absoluteBase;
  if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('BLOCKED_V5_SYMLINK');
  for (const part of path.relative(absoluteBase, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`BLOCKED_V5_SYMLINK: ${cursor}`);
    if (cursor !== absolute && !stat.isDirectory()) throw new Error(`BLOCKED_V5_PATH_NOT_DIRECTORY: ${cursor}`);
  }
  return absolute;
}

function resolveRoots(root = ROOT, home = os.homedir(), commonDirectory) {
  const repo = fs.realpathSync(path.resolve(root));
  const common = fs.realpathSync(path.resolve(commonDirectory || execFileSync('rtk', ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {cwd: repo, encoding: 'utf8'}).trim()));
  const homePath = fs.realpathSync(path.resolve(home));
  const suffix = EPOCH.split('/');
  const primaryBase = path.join(common, 'soraoto-agent-state', String(ISSUE), 'physical-fit-v5');
  const secondaryBase = path.join(homePath, '.soraoto-agent-archive', 'soraoto_dsl', String(ISSUE), 'physical-fit-v5');
  const primary = assertNoSymlink(common, path.join(primaryBase, ...suffix));
  const secondary = assertNoSymlink(homePath, path.join(secondaryBase, ...suffix));
  if (inside(primary, secondary) || inside(secondary, primary)) throw new Error('BLOCKED_V5_ROOT_OVERLAP');
  return {repo, primary, secondary, primaryBase, secondaryBase, commonDirectory: common, home: homePath, epoch: EPOCH};
}

function assertRelative(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('BLOCKED_V5_RELATIVE_PATH');
}
function dualPaths(roots, relative) {
  assertRelative(relative);
  return {primary: assertNoSymlink(roots.primary, path.join(roots.primary, relative)),
    secondary: assertNoSymlink(roots.secondary, path.join(roots.secondary, relative))};
}
function readDual(roots, relative) {
  const files = dualPaths(roots, relative), hasPrimary = fs.existsSync(files.primary), hasSecondary = fs.existsSync(files.secondary);
  if (hasPrimary !== hasSecondary) throw new Error(`BLOCKED_V5_PARTIAL_DUAL_COPY: ${relative}`);
  if (!hasPrimary) return null;
  const primary = fs.readFileSync(files.primary), secondary = fs.readFileSync(files.secondary);
  if (!primary.equals(secondary)) throw new Error(`BLOCKED_V5_DIVERGENT_DUAL_COPY: ${relative}`);
  return {bytes: primary, size: primary.length, sha256: sha256(primary)};
}
function readJson(roots, relative, required = true) {
  const value = readDual(roots, relative);
  if (!value) { if (required) throw new Error(`BLOCKED_V5_MISSING: ${relative}`); return null; }
  try { return JSON.parse(value.bytes.toString('utf8')); } catch { throw new Error(`BLOCKED_V5_INVALID_JSON: ${relative}`); }
}
function ensureDirectory(root, target) {
  const base = path.resolve(root), absolute = path.resolve(target);
  if (!inside(base, absolute)) throw new Error('BLOCKED_V5_ROOT_ESCAPE');
  const rootPath = path.parse(base).root;
  const parts = [...base.slice(rootPath.length).split(path.sep).filter(Boolean),
    ...path.relative(base, absolute).split(path.sep).filter(Boolean)];
  let cursor = rootPath;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, {mode: 0o700});
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`BLOCKED_V5_UNSAFE_DIRECTORY: ${cursor}`);
  }
}
function writeExclusive(file, bytes) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fsyncSync(descriptor);
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function writeImmutableDual(roots, relative, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const existing = readDual(roots, relative);
  if (existing) {
    if (!existing.bytes.equals(bytes)) throw new Error(`BLOCKED_V5_IMMUTABLE_CONFLICT: ${relative}`);
    return existing;
  }
  const files = dualPaths(roots, relative);
  ensureDirectory(roots.primary, path.dirname(files.primary));
  ensureDirectory(roots.secondary, path.dirname(files.secondary));
  let primaryCreated = false;
  try {
    writeExclusive(files.primary, bytes); primaryCreated = true;
    writeExclusive(files.secondary, bytes);
  } catch (error) {
    if (primaryCreated && !fs.existsSync(files.secondary)) fs.unlinkSync(files.primary);
    throw error;
  }
  const stored = readDual(roots, relative);
  if (!stored || stored.size !== bytes.length || stored.sha256 !== sha256(bytes)) throw new Error(`BLOCKED_V5_READBACK: ${relative}`);
  return stored;
}
function writeJsonImmutableDual(roots, relative, value) { return writeImmutableDual(roots, relative, jsonBytes(value)); }

function snapshotTree(root) {
  if (!fs.existsSync(root)) return [];
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('BLOCKED_V5_SYMLINK');
  const rows = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`BLOCKED_V5_SYMLINK: ${file}`);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) rows.push({path: path.relative(root, file).split(path.sep).join('/'), size: stat.size,
        sha256: sha256(fs.readFileSync(file)), mtimeMs: stat.mtimeMs});
      else throw new Error(`BLOCKED_V5_SPECIAL_FILE: ${file}`);
    }
  }
  visit(root);
  return rows;
}
function snapshots(roots) { return {primary: snapshotTree(roots.primary), secondary: snapshotTree(roots.secondary)}; }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function inventorySummary(primary, secondary) {
  const normalize = rows => rows.map(({path: relative, size, sha256: digest}) => ({path: relative, size, sha256: digest}));
  const mtimeRows = rows => rows.map(({path: relative, mtimeMs}) => ({path: relative, mtimeMs}));
  const identity = normalize(primary), secondaryIdentity = normalize(secondary);
  return {fileCount: primary.length, bytes: primary.reduce((total, row) => total + row.size, 0),
    primaryContentSha256: sha256(jsonBytes(identity)), secondaryContentSha256: sha256(jsonBytes(secondaryIdentity)),
    primaryMtimeSha256: sha256(jsonBytes(mtimeRows(primary))), secondaryMtimeSha256: sha256(jsonBytes(mtimeRows(secondary))),
    contentAndSizeMatch: same(identity, secondaryIdentity)};
}
function filesUnder(root, relative) {
  const start = assertNoSymlink(root, path.join(root, relative));
  if (!fs.existsSync(start)) return [];
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`BLOCKED_V5_SYMLINK: ${file}`);
      if (stat.isDirectory()) visit(file); else if (stat.isFile()) result.push(path.relative(root, file).split(path.sep).join('/'));
      else throw new Error(`BLOCKED_V5_SPECIAL_FILE: ${file}`);
    }
  }
  visit(start);
  return result;
}

function callDirectory(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(id)) throw new Error('BLOCKED_V5_INVALID_CALL_ID');
  return `p5/calls/${encodeURIComponent(id)}`;
}
function callCounts(roots) {
  const primary = filesUnder(roots.primary, 'p5/calls').filter(relative => relative.endsWith('/started.json'));
  const secondary = filesUnder(roots.secondary, 'p5/calls').filter(relative => relative.endsWith('/started.json'));
  if (!same(primary, secondary)) throw new Error('BLOCKED_V5_CALL_MARKER_INVENTORY_MISMATCH');
  const byStage = Object.fromEntries(Object.keys(STAGES).map(stage => [stage, 0]));
  let ambiguous = 0, complete = 0;
  for (const relative of primary) {
    const marker = readJson(roots, relative);
    if (!Object.hasOwn(byStage, marker.stage) || marker.charge !== 1) throw new Error(`BLOCKED_V5_INVALID_CALL_MARKER: ${relative}`);
    byStage[marker.stage]++;
    const base = relative.slice(0, -'/started.json'.length);
    const result = readDual(roots, `${base}/result.json`), audio = readDual(roots, `${base}/audio.wav`), aborted = readDual(roots, `${base}/ambiguous.json`);
    if (aborted || Boolean(result) !== Boolean(audio)) ambiguous++;
    else if (result && audio) complete++;
    else ambiguous++;
  }
  const started = primary.length;
  if (HISTORICAL_CALLS + started > MAX_CALLS) throw new Error('BLOCKED_V5_CUMULATIVE_CALL_CAP');
  for (const [stage, count] of Object.entries(byStage)) if (count > STAGES[stage]) throw new Error(`BLOCKED_V5_STAGE_CALL_CAP: ${stage}`);
  return {started, complete, ambiguous, incomplete: started - complete - ambiguous, byStage,
    cumulative: HISTORICAL_CALLS + started, cap: MAX_CALLS, remaining: MAX_CALLS - HISTORICAL_CALLS - started};
}
function startCall(roots, {id, stage, planSha256, values, cell, ownerId}) {
  if (!Object.hasOwn(STAGES, stage)) throw new Error('BLOCKED_V5_INVALID_CALL_STAGE');
  const base = callDirectory(id), markerPath = `${base}/started.json`;
  const old = readDual(roots, markerPath);
  if (old) {
    const marker = JSON.parse(old.bytes.toString('utf8'));
    if (marker.stage !== stage || marker.planSha256 !== planSha256) throw new Error(`BLOCKED_V5_CALL_IDENTITY_CONFLICT: ${id}`);
    const counts = callCounts(roots);
    if (counts.ambiguous) throw new Error(`BLOCKED_V5_AMBIGUOUS_CALL: ${id}`);
    const result = readJson(roots, `${base}/result.json`, false), audio = readDual(roots, `${base}/audio.wav`);
    if (!result || !audio || result.audioSha256 !== audio.sha256) throw new Error(`BLOCKED_V5_AMBIGUOUS_CALL: ${id}`);
    return {reused: true, marker, result, audio};
  }
  const counts = callCounts(roots);
  if (counts.byStage[stage] >= STAGES[stage] || counts.cumulative >= MAX_CALLS) throw new Error('BLOCKED_V5_CALL_BUDGET');
  const marker = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, id, stage, planSha256, values: values.slice(), cell,
    ownerId, startedAt: new Date().toISOString(), charge: 1};
  writeJsonImmutableDual(roots, markerPath, marker);
  return {reused: false, marker};
}
function completeCall(roots, id, row, audioBytes) {
  const base = callDirectory(id), marker = readJson(roots, `${base}/started.json`);
  if (!Buffer.isBuffer(audioBytes) || !audioBytes.length) throw new Error(`BLOCKED_V5_EMPTY_AUDIO: ${id}`);
  const audio = writeImmutableDual(roots, `${base}/audio.wav`, audioBytes);
  const result = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, id, stage: marker.stage, planSha256: marker.planSha256,
    values: marker.values, cell: marker.cell, row, audioSha256: audio.sha256, audioSize: audio.size, completedAt: new Date().toISOString()};
  const stored = writeJsonImmutableDual(roots, `${base}/result.json`, result);
  return {result, resultSha256: stored.sha256, audio};
}
function markAmbiguous(roots, id, reason) {
  const safeReason = String(reason).slice(0, 512);
  return writeJsonImmutableDual(roots, `${callDirectory(id)}/ambiguous.json`, {schemaVersion: 1, id, reason: safeReason, recordedAt: new Date().toISOString()});
}
function acquireLock(roots, ownerId) {
  const relative = 'locks/master.json';
  if (readDual(roots, relative)) throw new Error('BLOCKED_V5_ACTIVE_OR_STALE_LOCK');
  const lock = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, ownerId, pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString()};
  writeJsonImmutableDual(roots, relative, lock);
  return lock;
}
function releaseLock(roots, ownerId) {
  const paths = dualPaths(roots, 'locks/master.json'), lock = readJson(roots, 'locks/master.json', false);
  if (!lock) return false;
  if (lock.ownerId !== ownerId) throw new Error('BLOCKED_V5_LOCK_OWNER_MISMATCH');
  fs.unlinkSync(paths.primary); fs.unlinkSync(paths.secondary);
  return true;
}

module.exports = {ROOT, ISSUE, EPOCH, LINEAGE, HISTORICAL_CALLS, MAX_CALLS, PARAMETERS, STRESS_CELLS, STAGES,
  sha256, jsonBytes, inside, resolveRoots, assertRelative, dualPaths, readDual, readJson, writeImmutableDual,
  writeJsonImmutableDual, snapshotTree, snapshots, same, inventorySummary, filesUnder, callDirectory, callCounts,
  startCall, completeCall, markAmbiguous, acquireLock, releaseLock};
