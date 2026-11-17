'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const model = require('./physical-fit-v5-local-model.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const ISSUE = 7;
const EPOCH = 'current-build-v5-review/continuation-02';
const FROZEN_P5_HEAD = '7ab88ce5b857423ec1d278e8741e963f4e33cd56';
const CONTRACT_SHA256 = '8fff6411325c255156eb566f742dde72a0f437cffd50812e32a8d5640d09b498';
const HISTORICAL_CALLS = 3251;
const MAX_CALLS = 5255;
const STAGES = Object.freeze({candidate: 42, confirmation: 25, headroom: 4,
  releaseEquivalence: 24, stage3: 486, stage4: 1423});
const SHA_RE = /^[a-f0-9]{64}$/;
const ACTIVE_WRITER_SESSIONS = new Map();

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('BLOCKED_CALL_NONFINITE_IDENTITY');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error('BLOCKED_CALL_UNDEFINED_IDENTITY');
      out[key] = canonical(value[key]);
    }
    return out;
  }
  throw new Error('BLOCKED_CALL_INVALID_IDENTITY');
}
function canonicalBytes(value) { return Buffer.from(`${JSON.stringify(canonical(value))}\n`); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function inside(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function assertNoSymlink(base, target) {
  const absoluteBase = path.resolve(base), absolute = path.resolve(target);
  if (!inside(absoluteBase, absolute)) throw new Error('BLOCKED_REVIEW_ROOT_ESCAPE');
  let cursor = absoluteBase;
  if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('BLOCKED_REVIEW_SYMLINK');
  for (const part of path.relative(absoluteBase, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`BLOCKED_REVIEW_SYMLINK: ${cursor}`);
    if (cursor !== absolute && !stat.isDirectory()) throw new Error(`BLOCKED_REVIEW_PATH_NOT_DIRECTORY: ${cursor}`);
  }
  return absolute;
}
function resolveRoots(root = ROOT, home = os.homedir(), commonDirectory, epoch = EPOCH) {
  if (!['current-build-v5-review/continuation-01', 'current-build-v5-review/continuation-02'].includes(epoch)) {
    throw new Error('BLOCKED_REVIEW_EPOCH');
  }
  const repo = fs.realpathSync(path.resolve(root));
  const common = fs.realpathSync(path.resolve(commonDirectory || execFileSync('rtk',
    ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: repo, encoding: 'utf8'}).trim()));
  const homePath = fs.realpathSync(path.resolve(home));
  const primaryBase = path.join(common, 'soraoto-agent-state', '7', 'physical-fit-v5-review');
  const secondaryBase = path.join(homePath, '.soraoto-agent-archive', 'soraoto_dsl', '7', 'physical-fit-v5-review');
  const continuation = epoch.slice(epoch.lastIndexOf('/') + 1);
  const primary = assertNoSymlink(common, path.join(primaryBase, continuation));
  const secondary = assertNoSymlink(homePath, path.join(secondaryBase, continuation));
  if (inside(primary, secondary) || inside(secondary, primary)) throw new Error('BLOCKED_REVIEW_ROOT_OVERLAP');
  return {repo, commonDirectory: common, home: homePath, primaryBase, secondaryBase, primary, secondary, epoch};
}
function assertRelative(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('BLOCKED_REVIEW_RELATIVE_PATH');
}
function dualPaths(roots, relative) {
  assertRelative(relative);
  return {
    primary: assertNoSymlink(roots.primary, path.join(roots.primary, relative)),
    secondary: assertNoSymlink(roots.secondary, path.join(roots.secondary, relative))
  };
}
function readDual(roots, relative) {
  const files = dualPaths(roots, relative);
  const hasPrimary = fs.existsSync(files.primary), hasSecondary = fs.existsSync(files.secondary);
  if (hasPrimary !== hasSecondary) throw new Error(`BLOCKED_REVIEW_PARTIAL_DUAL_COPY: ${relative}`);
  if (!hasPrimary) return null;
  const primary = fs.readFileSync(files.primary), secondary = fs.readFileSync(files.secondary);
  if (!primary.equals(secondary)) throw new Error(`BLOCKED_REVIEW_DIVERGENT_DUAL_COPY: ${relative}`);
  return {bytes: primary, size: primary.length, sha256: sha256(primary)};
}
function readJson(roots, relative, required = true) {
  const stored = readDual(roots, relative);
  if (!stored) {
    if (required) throw new Error(`BLOCKED_REVIEW_MISSING: ${relative}`);
    return null;
  }
  try { return JSON.parse(stored.bytes.toString('utf8')); }
  catch { throw new Error(`BLOCKED_REVIEW_INVALID_JSON: ${relative}`); }
}
function ensureDirectory(root, target) {
  const base = path.resolve(root), absolute = path.resolve(target);
  if (!inside(base, absolute)) throw new Error('BLOCKED_REVIEW_ROOT_ESCAPE');
  const rootPath = path.parse(base).root;
  const parts = [...base.slice(rootPath.length).split(path.sep).filter(Boolean),
    ...path.relative(base, absolute).split(path.sep).filter(Boolean)];
  let cursor = rootPath;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, {mode: 0o700});
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`BLOCKED_REVIEW_UNSAFE_DIRECTORY: ${cursor}`);
  }
}
function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeOne(root, relative, bytes) {
  const destination = assertNoSymlink(root, path.join(root, relative));
  ensureDirectory(root, path.dirname(destination));
  if (fs.existsSync(destination)) throw new Error(`BLOCKED_REVIEW_IMMUTABLE_EXISTS: ${relative}`);
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.tmp-${crypto.randomUUID()}`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  fs.writeFileSync(fd, bytes);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  if (fs.existsSync(destination)) throw new Error(`BLOCKED_REVIEW_IMMUTABLE_RACE: ${relative}`);
  fs.renameSync(temporary, destination);
  fsyncDirectory(path.dirname(destination));
  const readback = fs.readFileSync(destination);
  if (!readback.equals(bytes)) throw new Error(`BLOCKED_REVIEW_WRITE_READBACK: ${relative}`);
  return {size: bytes.length, sha256: sha256(bytes)};
}
function writeImmutableDual(roots, relative, bytes) {
  const files = dualPaths(roots, relative);
  const exists = [fs.existsSync(files.primary), fs.existsSync(files.secondary)];
  if (exists[0] || exists[1]) {
    if (!exists[0] || !exists[1]) throw new Error(`BLOCKED_REVIEW_PARTIAL_DUAL_COPY: ${relative}`);
    const left = fs.readFileSync(files.primary), right = fs.readFileSync(files.secondary);
    if (!left.equals(right) || !left.equals(bytes)) throw new Error(`BLOCKED_REVIEW_IMMUTABLE_CONFLICT: ${relative}`);
    return {size: bytes.length, sha256: sha256(bytes), reused: true};
  }
  const primary = writeOne(roots.primary, relative, bytes);
  const secondary = writeOne(roots.secondary, relative, bytes);
  const readback = readDual(roots, relative);
  if (!readback || readback.sha256 !== primary.sha256 || readback.sha256 !== secondary.sha256) {
    throw new Error(`BLOCKED_REVIEW_DUAL_WRITE_READBACK: ${relative}`);
  }
  return {...readback, reused: false};
}
function writeBatchOne(root, entries) {
  const destinations = entries.map(({relative}) => assertNoSymlink(root, path.join(root, relative)));
  const parent = path.dirname(destinations[0]);
  if (destinations.some(destination => path.dirname(destination) !== parent)) throw new Error('BLOCKED_REVIEW_BATCH_DIRECTORY_MISMATCH');
  ensureDirectory(root, parent);
  const temporaries = [];
  for (let index = 0; index < entries.length; index++) {
    const {relative, bytes} = entries[index], destination = destinations[index];
    if (fs.existsSync(destination)) throw new Error(`BLOCKED_REVIEW_IMMUTABLE_EXISTS: ${relative}`);
    const temporary = path.join(parent, `.${path.basename(destination)}.tmp-${crypto.randomUUID()}`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    temporaries.push({relative, temporary, destination, bytes});
  }
  for (const item of temporaries) {
    if (fs.existsSync(item.destination)) throw new Error(`BLOCKED_REVIEW_IMMUTABLE_RACE: ${item.relative}`);
    fs.renameSync(item.temporary, item.destination);
  }
  fsyncDirectory(parent);
  return temporaries.map(item => {
    const readback = fs.readFileSync(item.destination);
    if (!readback.equals(item.bytes)) throw new Error(`BLOCKED_REVIEW_WRITE_READBACK: ${item.relative}`);
    return {relative: item.relative, size: item.bytes.length, sha256: sha256(item.bytes)};
  });
}
function writeImmutableDualBatch(roots, entries) {
  if (!Array.isArray(entries) || !entries.length || entries.some(entry => !Buffer.isBuffer(entry.bytes))) {
    throw new Error('BLOCKED_REVIEW_INVALID_BATCH');
  }
  const normalized = entries.map(entry => { assertRelative(entry.relative); return entry; });
  const primary = normalized.map(({relative}) => assertNoSymlink(roots.primary, path.join(roots.primary, relative)));
  const secondary = normalized.map(({relative}) => assertNoSymlink(roots.secondary, path.join(roots.secondary, relative)));
  const exists = normalized.map((_, index) => [fs.existsSync(primary[index]), fs.existsSync(secondary[index])]);
  if (exists.some(([left, right]) => left || right)) {
    if (exists.some(([left, right]) => !left || !right)) throw new Error('BLOCKED_REVIEW_PARTIAL_DUAL_BATCH');
    for (let index = 0; index < normalized.length; index++) {
      const left = fs.readFileSync(primary[index]), right = fs.readFileSync(secondary[index]);
      if (!left.equals(right) || !left.equals(normalized[index].bytes)) throw new Error('BLOCKED_REVIEW_IMMUTABLE_BATCH_CONFLICT');
    }
    return normalized.map(entry => ({relative: entry.relative, size: entry.bytes.length,
      sha256: sha256(entry.bytes), reused: true}));
  }
  const left = writeBatchOne(roots.primary, normalized);
  const right = writeBatchOne(roots.secondary, normalized);
  for (const entry of normalized) {
    const readback = readDual(roots, entry.relative);
    if (!readback || readback.sha256 !== sha256(entry.bytes)) throw new Error('BLOCKED_REVIEW_DUAL_BATCH_READBACK');
  }
  return left.map((item, index) => ({...item, reused: false, secondarySha256: right[index].sha256}));
}
function writeJsonImmutableDual(roots, relative, value) { return writeImmutableDual(roots, relative, jsonBytes(value)); }
function snapshotTree(root) {
  if (!fs.existsSync(root)) return [];
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('BLOCKED_REVIEW_SYMLINK');
  const rows = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`BLOCKED_REVIEW_SYMLINK: ${file}`);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) rows.push({path: path.relative(root, file).split(path.sep).join('/'), size: stat.size,
        sha256: sha256(fs.readFileSync(file)), mtimeMs: stat.mtimeMs});
      else throw new Error(`BLOCKED_REVIEW_SPECIAL_FILE: ${file}`);
    }
  }
  visit(root);
  return rows;
}
function snapshots(roots) { return {primary: snapshotTree(roots.primary), secondary: snapshotTree(roots.secondary)}; }
function inventorySummary(primary, secondary) {
  const identity = rows => rows.map(({path: relative, size, sha256: digest}) => ({path: relative, size, sha256: digest}));
  const mtimes = rows => rows.map(({path: relative, mtimeMs}) => ({path: relative, mtimeMs}));
  const left = identity(primary), right = identity(secondary);
  return {fileCount: primary.length, bytes: primary.reduce((sum, row) => sum + row.size, 0),
    primaryContentSha256: sha256(jsonBytes(left)), secondaryContentSha256: sha256(jsonBytes(right)),
    primaryMtimeSha256: sha256(jsonBytes(mtimes(primary))), secondaryMtimeSha256: sha256(jsonBytes(mtimes(secondary))),
    contentAndSizeMatch: same(left, right)};
}
function filesUnder(root, relative) {
  const start = assertNoSymlink(root, path.join(root, relative));
  if (!fs.existsSync(start)) return [];
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`BLOCKED_REVIEW_SYMLINK: ${file}`);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) result.push(path.relative(root, file).split(path.sep).join('/'));
      else throw new Error(`BLOCKED_REVIEW_SPECIAL_FILE: ${file}`);
    }
  }
  visit(start);
  return result;
}
function validateStage(stage) {
  if (!Object.hasOwn(STAGES, stage)) throw new Error('BLOCKED_REVIEW_INVALID_STAGE');
}
function validateValues(values) {
  if (!Array.isArray(values) || values.length !== 3) throw new Error('BLOCKED_CALL_INVALID_VALUES');
  const result = values.map((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('BLOCKED_CALL_INVALID_VALUES');
    if (value < model.BASELINES[index] * 0.9 - 1e-12 || value > model.BASELINES[index] * 1.1 + 1e-12) {
      throw new Error('BLOCKED_CALL_VALUES_OUTSIDE_APPROVED_BOX');
    }
    return Object.is(value, -0) ? 0 : value;
  });
  return result;
}
function validateSha(value, label) {
  if (typeof value !== 'string' || !SHA_RE.test(value)) throw new Error(`BLOCKED_REVIEW_INVALID_${label}`);
  return value;
}
function planPath(stage, planSha256) { return `plans/${stage}/${planSha256}.json`; }
function writePlan(roots, stage, payload) {
  validateStage(stage);
  const plan = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, stage, payload: canonical(payload)};
  const bytes = canonicalBytes(plan), digest = sha256(bytes);
  const written = writeImmutableDual(roots, planPath(stage, digest), bytes);
  return {plan, planSha256: digest, ...written};
}
function callPath(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error('BLOCKED_CALL_INVALID_ID');
  return `calls/${id}`;
}
function markerPath(id) { return `${callPath(id)}/started.json`; }
function assertWriterLock(roots, ownerId) {
  const lock = readJson(roots, 'locks/master.json');
  if (lock.issue !== ISSUE || lock.epoch !== EPOCH || (ownerId && lock.ownerId !== ownerId)) {
    throw new Error('BLOCKED_REVIEW_LOCK_OWNER_MISMATCH');
  }
  return lock;
}
function cloneCounts(counts) {
  return {...counts, byStage: {...counts.byStage}, ambiguousIds: [...counts.ambiguousIds], incompleteIds: [...counts.incompleteIds]};
}
function sessionIdentity(roots) { return `${roots.primary}\n${roots.secondary}\n${roots.epoch}`; }
function writerSessionState(roots, token) {
  const state = ACTIVE_WRITER_SESSIONS.get(token);
  if (!state || state.rootsKey !== sessionIdentity(roots)) throw new Error('BLOCKED_REVIEW_WRITER_SESSION');
  assertWriterLock(roots, state.ownerId);
  return state;
}
function beginWriterSession(roots, ownerId) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (!inside(temporaryRoot, roots.repo) || !inside(temporaryRoot, roots.primary)
      || !inside(temporaryRoot, roots.secondary) || roots.epoch !== EPOCH) {
    throw new Error('BLOCKED_REVIEW_WRITER_SESSION_NOT_ISOLATED');
  }
  assertWriterLock(roots, ownerId);
  const token = crypto.randomUUID();
  ACTIVE_WRITER_SESSIONS.set(token, {rootsKey: sessionIdentity(roots), ownerId, counts: cloneCounts(callCounts(roots)), pendingId: null});
  return token;
}
function validateWriterSession(roots, token) {
  const state = writerSessionState(roots, token), actual = callCounts(roots), expected = state.counts;
  const fields = ['started', 'complete', 'ambiguous', 'incomplete', 'cumulative', 'byStage'];
  if (fields.some(field => !same(actual[field], expected[field]))) throw new Error('BLOCKED_REVIEW_WRITER_SESSION_ACCOUNTING');
  return actual;
}
function endWriterSession(roots, token) {
  const state = writerSessionState(roots, token);
  ACTIVE_WRITER_SESSIONS.delete(token);
  return {pendingId: state.pendingId};
}
function sameIdentity(marker, request) {
  const expected = {
    id: request.id, epoch: EPOCH, stage: request.stage, planSha256: request.planSha256,
    values: validateValues(request.values), normalizedValues: model.normalized(validateValues(request.values)),
    cell: canonical(request.cell), artifactKind: request.artifactKind,
    sourceSha256: request.sourceSha256, captureSha256: request.captureSha256,
    binarySha256: request.binarySha256, fixtureSha256: request.fixtureSha256
  };
  return Object.keys(expected).every(key => same(marker[key], expected[key]));
}
function verifiedCall(roots, id, expected = {}) {
  const base = callPath(id), marker = readJson(roots, `${base}/started.json`);
  if (marker.id !== id || marker.issue !== ISSUE || marker.epoch !== EPOCH) throw new Error('BLOCKED_CALL_IDENTITY_CONFLICT');
  if (expected.id && !sameIdentity(marker, expected)) throw new Error('BLOCKED_CALL_IDENTITY_CONFLICT');
  const primaryFiles = filesUnder(roots.primary, base), secondaryFiles = filesUnder(roots.secondary, base);
  if (!same(primaryFiles, secondaryFiles)) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
  const allowedFiles = new Set([`${base}/started.json`, `${base}/ambiguous.json`, `${base}/result.json`,
    `${base}/manifest.json`, `${base}/row.json`, `${base}/audio.wav`]);
  if (primaryFiles.some(relative => !allowedFiles.has(relative))) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
  if (readDual(roots, `${base}/ambiguous.json`)) throw new Error('BLOCKED_CALL_AMBIGUOUS');
  const resultBytes = readDual(roots, `${base}/result.json`);
  const manifestBytes = readDual(roots, `${base}/manifest.json`);
  const rowBytes = readDual(roots, `${base}/row.json`);
  const audio = readDual(roots, `${base}/audio.wav`);
  if (!resultBytes) {
    if (manifestBytes || rowBytes || audio) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
    return {status: 'INCOMPLETE', marker};
  }
  if (!manifestBytes || !rowBytes) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
  let result, manifest, row;
  try {
    result = JSON.parse(resultBytes.bytes.toString('utf8'));
    manifest = JSON.parse(manifestBytes.bytes.toString('utf8'));
    row = JSON.parse(rowBytes.bytes.toString('utf8'));
  } catch { throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY'); }
  const {sha256: manifestSha, ...manifestWithoutSha} = manifest;
  const expectedManifestSha256 = sha256(canonicalBytes(manifestWithoutSha));
  if (!sameIdentity(marker, result) || !sameIdentity(marker, manifest)
      || !same(result.ownerId, marker.ownerId)
      || result.rowSha256 !== sha256(canonicalBytes(row))
      || result.rowSize !== rowBytes.size
      || manifestSha !== expectedManifestSha256) {
    throw new Error('BLOCKED_CALL_IDENTITY_CONFLICT');
  }
  const entries = manifest.files;
  if (!Array.isArray(entries)) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
  const expectedFiles = [{path: `${base}/row.json`, sha256: rowBytes.sha256, size: rowBytes.size}];
  if (marker.artifactKind === 'wav') {
    if (!audio || result.audioSha256 !== audio.sha256 || result.audioSize !== audio.size) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
    expectedFiles.push({path: `${base}/audio.wav`, sha256: audio.sha256, size: audio.size});
  } else if (marker.artifactKind === 'metric') {
    if (audio) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
    if (result.audioSha256 !== null || result.audioSize !== null) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
  } else throw new Error('BLOCKED_CALL_ARTIFACT_KIND');
  if (!same(entries, expectedFiles)) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
  if (result.manifestSha256 !== expectedManifestSha256) throw new Error('BLOCKED_CALL_ARTIFACT_INTEGRITY');
  return {status: 'COMPLETE', marker, result, row, rowSha256: result.rowSha256,
    manifestSha256: expectedManifestSha256, audio: audio?.bytes ?? null, audioSha256: audio?.sha256 ?? null};
}
function startCall(roots, request) {
  const {id, stage, planSha256, values, cell, artifactKind, ownerId} = request;
  validateStage(stage);
  if (!['wav', 'metric'].includes(artifactKind)) throw new Error('BLOCKED_CALL_ARTIFACT_KIND');
  if (typeof ownerId !== 'string' || !ownerId) throw new Error('BLOCKED_REVIEW_OWNER_REQUIRED');
  validateSha(planSha256, 'PLAN_SHA');
  validateSha(request.sourceSha256, 'SOURCE_SHA');
  validateSha(request.captureSha256, 'CAPTURE_SHA');
  validateSha(request.binarySha256, 'BINARY_SHA');
  validateSha(request.fixtureSha256, 'FIXTURE_SHA');
  const normalizedValues = model.normalized(validateValues(values));
  canonical(cell);
  const planStored = readDual(roots, planPath(stage, planSha256));
  if (!planStored || planStored.sha256 !== planSha256) throw new Error('BLOCKED_REVIEW_PLAN_IDENTITY');
  const plan = readJson(roots, planPath(stage, planSha256));
  if (plan.stage !== stage || plan.epoch !== EPOCH) throw new Error('BLOCKED_REVIEW_PLAN_IDENTITY');
  const session = request.writerSession ? writerSessionState(roots, request.writerSession) : null;
  if (session?.pendingId) throw new Error('BLOCKED_REVIEW_WRITER_SESSION_PENDING_CALL');
  assertWriterLock(roots, ownerId);
  const relative = markerPath(id), existing = readJson(roots, relative, false);
  if (existing) {
    if (!sameIdentity(existing, {...request, id, stage, planSha256, values, cell, artifactKind})) {
      throw new Error('BLOCKED_CALL_IDENTITY_CONFLICT');
    }
    const verified = verifiedCall(roots, id, {...request, id, stage, planSha256, values, cell, artifactKind});
    if (verified.status !== 'COMPLETE') throw new Error('BLOCKED_CALL_AMBIGUOUS');
    return {reused: true, marker: existing, result: verified.result, audio: verified.audio, row: verified.row};
  }
  const counts = session ? session.counts : callCounts(roots);
  if (counts.ambiguous > 0 || counts.incomplete > 0) throw new Error('BLOCKED_REVIEW_UNRESOLVED_CALLS');
  if (counts.cumulative + 1 > MAX_CALLS || counts.byStage[stage] + 1 > STAGES[stage]) throw new Error('BLOCKED_REVIEW_BUDGET');
  const marker = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, id, stage, planSha256,
    values: validateValues(values), normalizedValues, cell: canonical(cell), artifactKind,
    sourceSha256: request.sourceSha256, captureSha256: request.captureSha256,
    binarySha256: request.binarySha256, fixtureSha256: request.fixtureSha256,
    ownerId, startedAt: new Date().toISOString()};
  writeJsonImmutableDual(roots, relative, marker);
  const readback = readJson(roots, relative);
  if (!same(readback, marker)) throw new Error('BLOCKED_REVIEW_START_MARKER_READBACK');
  if (session) {
    session.counts.started++;
    session.counts.incomplete++;
    session.counts.cumulative++;
    session.counts.byStage[stage]++;
    session.counts.incompleteIds.push(id);
    session.pendingId = id;
  }
  return {reused: false, marker: readback};
}
function completeCall(roots, id, {row, audioBytes = null, writerSession: writerSessionToken} = {}) {
  const base = callPath(id), marker = readJson(roots, `${base}/started.json`);
  assertWriterLock(roots);
  const session = writerSessionToken ? writerSessionState(roots, writerSessionToken) : null;
  if (session && session.pendingId !== id) throw new Error('BLOCKED_REVIEW_WRITER_SESSION_PENDING_CALL');
  const plan = readDual(roots, planPath(marker.stage, marker.planSha256));
  if (!plan || plan.sha256 !== marker.planSha256) throw new Error('BLOCKED_REVIEW_PLAN_IDENTITY');
  if (readDual(roots, `${base}/ambiguous.json`)) throw new Error('BLOCKED_CALL_AMBIGUOUS');
  const canonicalRow = canonical(row);
  if (!canonicalRow || Array.isArray(canonicalRow) || typeof canonicalRow !== 'object') throw new Error('BLOCKED_CALL_INVALID_ROW');
  const rowData = canonicalBytes(canonicalRow);
  let audioEntry = null;
  if (marker.artifactKind === 'wav') {
    if (!Buffer.isBuffer(audioBytes) || !audioBytes.length) throw new Error('BLOCKED_CALL_EMPTY_AUDIO');
    audioEntry = {relative: `${base}/audio.wav`, bytes: audioBytes,
      sha256: sha256(audioBytes), size: audioBytes.length};
  } else {
    if (audioBytes !== null || readDual(roots, `${base}/audio.wav`)) throw new Error('BLOCKED_METRIC_AUDIO_FORBIDDEN');
  }
  const rowEntry = {relative: `${base}/row.json`, bytes: rowData, sha256: sha256(rowData), size: rowData.length};
  const files = [{path: rowEntry.relative, sha256: rowEntry.sha256, size: rowEntry.size}];
  if (audioEntry) files.push({path: audioEntry.relative, sha256: audioEntry.sha256, size: audioEntry.size});
  const manifestWithoutSha = {...marker, files};
  const manifestSha256 = sha256(canonicalBytes(manifestWithoutSha));
  const manifest = {...manifestWithoutSha, sha256: manifestSha256};
  const manifestData = jsonBytes(manifest);
  const result = {...marker, ownerId: marker.ownerId, rowSha256: rowEntry.sha256, rowSize: rowEntry.size,
    audioSha256: audioEntry?.sha256 ?? null, audioSize: audioEntry?.size ?? null, manifestSha256,
    completedAt: new Date().toISOString()};
  const batch = [rowEntry, ...(audioEntry ? [audioEntry] : []),
    {relative: `${base}/manifest.json`, bytes: manifestData},
    {relative: `${base}/result.json`, bytes: jsonBytes(result)}];
  writeImmutableDualBatch(roots, batch);
  const completed = verifiedCall(roots, id);
  if (session) {
    session.counts.complete++;
    session.counts.incomplete--;
    session.counts.incompleteIds = session.counts.incompleteIds.filter(item => item !== id);
    session.pendingId = null;
  }
  return completed;
}
function markAmbiguous(roots, id, reason) {
  const base = callPath(id), marker = readJson(roots, `${base}/started.json`);
  assertWriterLock(roots);
  const record = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, id, markerSha256: sha256(jsonBytes(marker)),
    reason: String(reason || 'unknown'), markedAt: new Date().toISOString()};
  writeJsonImmutableDual(roots, `${base}/ambiguous.json`, record);
  return record;
}
function callCounts(roots) {
  const primary = filesUnder(roots.primary, 'calls').filter(relative => relative.endsWith('/started.json'));
  const secondary = filesUnder(roots.secondary, 'calls').filter(relative => relative.endsWith('/started.json'));
  if (!same(primary, secondary)) throw new Error('BLOCKED_REVIEW_CALL_MARKER_INVENTORY_MISMATCH');
  const counts = {started: primary.length, complete: 0, ambiguous: 0, incomplete: 0,
    cumulative: HISTORICAL_CALLS + primary.length, cap: MAX_CALLS, remaining: MAX_CALLS - HISTORICAL_CALLS - primary.length,
    byStage: Object.fromEntries(Object.keys(STAGES).map(stage => [stage, 0])), ambiguousIds: [], incompleteIds: []};
  for (const markerRelative of primary) {
    const marker = readJson(roots, markerRelative);
    validateStage(marker.stage);
    counts.byStage[marker.stage]++;
    const id = marker.id;
    if (readDual(roots, `${callPath(id)}/ambiguous.json`)) {
      counts.ambiguous++;
      counts.ambiguousIds.push(id);
      continue;
    }
    const state = verifiedCall(roots, id);
    if (state.status === 'COMPLETE') counts.complete++;
    else { counts.incomplete++; counts.incompleteIds.push(id); }
  }
  if (counts.cumulative > MAX_CALLS) throw new Error('BLOCKED_REVIEW_BUDGET');
  for (const [stage, maximum] of Object.entries(STAGES)) {
    if (counts.byStage[stage] > maximum) throw new Error(`BLOCKED_REVIEW_STAGE_BUDGET: ${stage}`);
  }
  return counts;
}
function acquireLock(roots, ownerId) {
  const relative = 'locks/master.json';
  const current = readJson(roots, relative, false);
  if (current || fs.existsSync(dualPaths(roots, relative).primary) || fs.existsSync(dualPaths(roots, relative).secondary)) {
    throw new Error('BLOCKED_REVIEW_WRITER_LOCK_PRESENT');
  }
  const record = {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, ownerId, pid: process.pid,
    hostname: os.hostname(), acquiredAt: new Date().toISOString()};
  writeJsonImmutableDual(roots, relative, record);
  return {ownerId, record};
}
function releaseLock(roots, lock) {
  const relative = 'locks/master.json', current = readJson(roots, relative);
  if (!same(current, lock.record) || current.ownerId !== lock.ownerId) throw new Error('BLOCKED_REVIEW_LOCK_OWNER_MISMATCH');
  const files = dualPaths(roots, relative);
  fs.unlinkSync(files.primary);
  fsyncDirectory(path.dirname(files.primary));
  fs.unlinkSync(files.secondary);
  fsyncDirectory(path.dirname(files.secondary));
  if (readDual(roots, relative)) throw new Error('BLOCKED_REVIEW_LOCK_RELEASE_READBACK');
}

module.exports = {ROOT, ISSUE, EPOCH, FROZEN_P5_HEAD, CONTRACT_SHA256, HISTORICAL_CALLS, MAX_CALLS, STAGES,
  sha256, jsonBytes, canonical, canonicalBytes, same, inside, assertNoSymlink, resolveRoots, assertRelative, dualPaths,
  readDual, readJson, writeImmutableDual, writeImmutableDualBatch, writeJsonImmutableDual, snapshotTree, snapshots, inventorySummary, filesUnder,
  writePlan, planPath, callPath, validateValues, startCall, completeCall, verifiedCall, callCounts,
  markAmbiguous, acquireLock, releaseLock, assertWriterLock, beginWriterSession, validateWriterSession, endWriterSession};
