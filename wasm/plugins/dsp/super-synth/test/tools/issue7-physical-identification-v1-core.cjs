'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../../../../');
const ISSUE = 7;
const EPOCH = 'current-build-v3/physical-identification-v1';
const LINEAGE = Object.freeze({diagnostic: 'physical-fit-P1', production: 'physical-fit-P2'});
const HISTORICAL_CALLS = 3069;
const MAX_CALLS = 5105;
const PARAMS = Object.freeze([
  Object.freeze({name: 'initial_velocity_velocity_scale', baseline: 1.05}),
  Object.freeze({name: 'velocity_hardness_amount', baseline: 0.5}),
  Object.freeze({name: 'stiffness_soft', baseline: 0.018})
]);
const SCREEN_CELLS = Object.freeze([
  [90, 31], [93, 31], [96, 14], [96, 31], [96, 36], [96, 124], [99, 31]
].map(([pitch, velocity]) => Object.freeze({pitch, velocity})));
const HOLDOUT_PITCHES = Object.freeze([90, 93, 96, 99, 102]);
const HOLDOUT_VELOCITIES = Object.freeze([14, 31, 36, 61, 124]);
const STAGES = Object.freeze({baseline: 7, finiteDifference: 42, candidate: 49, holdout: 25, headroom: 4, stage3: 486, stage4: 1423});
const REQUIRED_DIRS = Object.freeze(['runtime-revisions', 'reference', 'promotion', 'production', 'baseline', 'finite-difference', 'candidate', 'holdout', 'headroom', 'stage3', 'stage4', 'journal', 'artifacts', 'locks']);

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
  if (!inside(anchor, absolute)) throw new Error('BLOCKED_PHYSICAL_ROOT_ESCAPE');
  let at = anchor;
  for (const part of path.relative(anchor, absolute).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    try {
      const stat = fs.lstatSync(at);
      if (stat.isSymbolicLink()) throw new Error(`BLOCKED_PHYSICAL_SYMLINK: ${at}`);
      if (at !== absolute && !stat.isDirectory()) throw new Error(`BLOCKED_PHYSICAL_PATH: ${at}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (fs.existsSync(absolute) && fs.realpathSync(absolute) !== absolute) throw new Error(`BLOCKED_PHYSICAL_SYMLINK: ${absolute}`);
  return absolute;
}
function resolveRoots(root = ROOT, home = os.homedir(), commonDirectory) {
  const repo = fs.realpathSync(path.resolve(root));
  const common = fs.realpathSync(path.resolve(commonDirectory || execFileSync('rtk', ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: repo, encoding: 'utf8'}).trim()));
  const homePath = fs.realpathSync(path.resolve(home));
  const repoName = path.basename(repo);
  const primaryBase = path.join(common, 'soraoto-agent-state', String(ISSUE), 'physical-identification-v1');
  const secondaryBase = path.join(homePath, '.soraoto-agent-archive', repoName, String(ISSUE), 'physical-identification-v1');
  const suffix = EPOCH.split('/');
  const primary = path.join(primaryBase, ...suffix);
  const secondary = path.join(secondaryBase, ...suffix);
  assertNoSymlink(common, primary); assertNoSymlink(homePath, secondary);
  if (inside(primary, secondary) || inside(secondary, primary)) throw new Error('BLOCKED_PHYSICAL_ROOT_OVERLAP');
  return {repo, primary, secondary, primaryBase, secondaryBase, commonDirectory: common, home: homePath, repoName, epoch: EPOCH};
}
function ensureDir(base, target) {
  const basePath = path.resolve(base), absolute = path.resolve(target);
  if (!inside(basePath, absolute)) throw new Error('BLOCKED_PHYSICAL_ROOT_ESCAPE');
  let anchor = basePath;
  while (!fs.existsSync(anchor)) {
    const parent = path.dirname(anchor);
    if (parent === anchor) throw new Error('BLOCKED_PHYSICAL_ROOT_ANCHOR');
    anchor = parent;
  }
  if (fs.realpathSync(anchor) !== anchor) throw new Error(`BLOCKED_PHYSICAL_SYMLINK: ${anchor}`);
  let at = anchor;
  for (const part of path.relative(anchor, absolute).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    try {
      const stat = fs.lstatSync(at);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`BLOCKED_PHYSICAL_UNSAFE_DIRECTORY: ${at}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(at, {mode: 0o700});
    }
  }
  return absolute;
}
function dualPaths(roots, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('BLOCKED_PHYSICAL_RELATIVE_PATH');
  return {a: assertNoSymlink(roots.primary, path.join(roots.primary, relative)), b: assertNoSymlink(roots.secondary, path.join(roots.secondary, relative))};
}
function readDual(roots, relative) {
  const {a, b} = dualPaths(roots, relative), hasA = fs.existsSync(a), hasB = fs.existsSync(b);
  if (hasA !== hasB) throw new Error(`BLOCKED_PHYSICAL_PARTIAL_DUAL_COPY: ${relative}`);
  if (!hasA) return null;
  const bytesA = fs.readFileSync(a), bytesB = fs.readFileSync(b);
  if (!bytesA.equals(bytesB)) throw new Error(`BLOCKED_PHYSICAL_DIVERGENT_DUAL_COPY: ${relative}`);
  return {bytes: bytesA, sha256: sha256(bytesA), size: bytesA.length};
}
function writeExclusive(file, bytes, base) {
  ensureDir(base, path.dirname(file));
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    fs.fsyncSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!fs.readFileSync(file).equals(bytes)) throw new Error(`BLOCKED_PHYSICAL_IMMUTABLE_CONFLICT: ${file}`);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function writeImmutableDual(roots, relative, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const {a, b} = dualPaths(roots, relative), old = readDual(roots, relative);
  if (old) {
    if (!old.bytes.equals(bytes)) throw new Error(`BLOCKED_PHYSICAL_IMMUTABLE_CONFLICT: ${relative}`);
    return old;
  }
  writeExclusive(a, bytes, roots.primary); writeExclusive(b, bytes, roots.secondary);
  const stored = readDual(roots, relative);
  if (!stored || !stored.bytes.equals(bytes)) throw new Error(`BLOCKED_PHYSICAL_READBACK: ${relative}`);
  return stored;
}
function writeMutableDual(roots, relative, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const {a, b} = dualPaths(roots, relative), old = readDual(roots, relative);
  if (old?.bytes.equals(bytes)) return old;
  for (const [file, base] of [[a, roots.primary], [b, roots.secondary]]) {
    ensureDir(base, path.dirname(file));
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  }
  const stored = readDual(roots, relative);
  if (!stored || !stored.bytes.equals(bytes)) throw new Error(`BLOCKED_PHYSICAL_READBACK: ${relative}`);
  return stored;
}
function readJson(roots, relative, required = true) {
  const file = readDual(roots, relative);
  if (!file) { if (required) throw new Error(`BLOCKED_PHYSICAL_MISSING: ${relative}`); return null; }
  return JSON.parse(file.bytes.toString('utf8'));
}
function writeJson(roots, relative, value, immutable = false) {
  const bytes = jsonBytes(value);
  return immutable ? writeImmutableDual(roots, relative, bytes) : writeMutableDual(roots, relative, bytes);
}
function snapshotTree(root) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(directory, entry.name), rel = path.join(relative, entry.name), stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) throw new Error(`BLOCKED_PHYSICAL_SYMLINK: ${abs}`);
      if (entry.isDirectory()) visit(abs, rel);
      else if (entry.isFile()) rows.push({path: rel.split(path.sep).join('/'), size: stat.size, sha256: sha256(fs.readFileSync(abs)), mtimeNs: stat.mtimeNs?.toString() ?? String(BigInt(Math.round(stat.mtimeMs * 1e6)))});
      else throw new Error(`BLOCKED_PHYSICAL_SPECIAL_FILE: ${abs}`);
    }
  }
  visit(root); return rows;
}
function cellKey(cell) { return `${cell.kind}:${cell.pitch ?? 'x'}:${cell.velocity ?? 'x'}:${cell.parameter ?? 'x'}:${cell.delta ?? 'x'}:${cell.candidate ?? 'x'}:${cell.pattern ?? 'x'}`; }
function baselineCells() { return SCREEN_CELLS.map(cell => ({kind: 'baseline', ...cell})); }
function finiteDifferenceCells() {
  return PARAMS.flatMap((parameter, index) => [-1, 1].flatMap(sign => SCREEN_CELLS.map(cell => ({kind: 'finite-difference', parameter: index, parameterName: parameter.name, delta: sign * parameter.baseline * 0.1, ...cell}))));
}
function candidateCells(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 7) throw new Error('BLOCKED_PHYSICAL_CANDIDATE_COUNT');
  const distinct = new Set(candidates.map(values => JSON.stringify(validateCandidate(values))));
  if (distinct.size !== candidates.length) throw new Error('BLOCKED_PHYSICAL_DUPLICATE_CANDIDATE');
  return candidates.flatMap((values, candidate) => {
    validateCandidate(values);
    return SCREEN_CELLS.map(cell => ({kind: 'candidate', candidate, values: [...values], ...cell}));
  });
}
function holdoutCells() { return HOLDOUT_PITCHES.flatMap(pitch => HOLDOUT_VELOCITIES.map(velocity => ({kind: 'holdout', pitch, velocity}))); }
function headroomCells() {
  return [
    {role: 'baseline', pattern: 'open-c-major-nine'}, {role: 'candidate', pattern: 'open-c-major-nine'},
    {role: 'baseline', pattern: '32-voice-cluster'}, {role: 'candidate', pattern: '32-voice-cluster'}
  ].map(cell => ({kind: 'headroom', ...cell}));
}
function validateCandidate(values) {
  if (!Array.isArray(values) || values.length !== PARAMS.length || values.some((value, index) => !Number.isFinite(value) || value < PARAMS[index].baseline * 0.9 || value > PARAMS[index].baseline * 1.1)) throw new Error('BLOCKED_PHYSICAL_PARAMETER_BOUNDS');
  return values;
}
function exactCells(cells, expected, stage) {
  if (!Array.isArray(cells) || cells.length !== expected || cells.some(cell => !cell || typeof cell.kind !== 'string')) throw new Error(`BLOCKED_PHYSICAL_PLAN_COUNT: ${stage}`);
  const keys = cells.map(cellKey);
  if (keys.some(key => !key) || new Set(keys).size !== expected) throw new Error(`BLOCKED_PHYSICAL_PLAN_DUPLICATE: ${stage}`);
  return cells;
}
function createPlan(stage, {identity, cells, createdAt = new Date().toISOString()} = {}) {
  const maximum = STAGES[stage];
  if (!maximum || !identity) throw new Error('BLOCKED_PHYSICAL_PLAN_STAGE_OR_IDENTITY');
  const expected = stage === 'candidate' ? cells?.length : maximum;
  if (stage === 'candidate' && (expected < 7 || expected > maximum || expected % 7 !== 0)) throw new Error('BLOCKED_PHYSICAL_PLAN_COUNT: candidate');
  exactCells(cells, expected, stage);
  return {schemaVersion: 1, issue: ISSUE, epoch: EPOCH, stage, createdAt, identity, cells};
}
function freshLedger(plan) {
  const cells = {};
  for (const cell of plan.cells) {
    const key = cellKey(cell);
    cells[key] = {state: 'PENDING', cell, marker: `start-markers/${encodeURIComponent(key)}.json`, result: `cells/${encodeURIComponent(key)}.json`, sha256: null};
  }
  return {schemaVersion: 1, stage: plan.stage, planSha256: sha256(jsonBytes(plan)), identity: plan.identity, authorizedCellCount: plan.cells.length, accounting: {charged: 0}, cells};
}
function counts(ledger) { return Object.fromEntries(['PENDING', 'IN_PROGRESS', 'COMPLETE', 'AMBIGUOUS'].map(state => [state, Object.values(ledger.cells).filter(cell => cell.state === state).length])); }
function saveLedger(roots, ledger) { return writeJson(roots, `${ledger.stage}/ledger.json`, ledger, false); }
function appendJournal(roots, event) {
  const relative = 'journal/transitions.jsonl', {a, b} = dualPaths(roots, relative), prior = readDual(roots, relative);
  const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
  if (prior && prior.bytes.toString('utf8').split('\n').filter(Boolean).some(line => JSON.parse(line).eventId === event.eventId)) throw new Error(`BLOCKED_PHYSICAL_DUPLICATE_EVENT: ${event.eventId}`);
  for (const [file, base] of [[a, roots.primary], [b, roots.secondary]]) {
    ensureDir(base, path.dirname(file)); const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  const readback = readDual(roots, relative);
  if (!readback.bytes.toString('utf8').endsWith(bytes.toString('utf8'))) throw new Error('BLOCKED_PHYSICAL_JOURNAL_READBACK');
  return readback;
}
function journal(roots) {
  const file = readDual(roots, 'journal/transitions.jsonl');
  if (!file) return {events: [], byId: new Map(), sha256: null};
  const events = [], byId = new Map();
  for (const line of file.bytes.toString('utf8').split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (!event.eventId || byId.has(event.eventId)) throw new Error('BLOCKED_PHYSICAL_JOURNAL_INVALID');
    events.push(event); byId.set(event.eventId, event);
  }
  return {events, byId, sha256: file.sha256};
}
function verifyLedger(roots, plan, ledger) {
  if (ledger.planSha256 !== sha256(jsonBytes(plan)) || !same(ledger.identity, plan.identity) || ledger.authorizedCellCount !== plan.cells.length || Object.keys(ledger.cells || {}).length !== plan.cells.length) throw new Error('BLOCKED_PHYSICAL_LEDGER_IDENTITY');
  const history = journal(roots).byId;
  for (const cell of plan.cells) {
    const key = cellKey(cell), item = ledger.cells[key];
    if (!item || !same(item.cell, cell) || item.marker !== `start-markers/${encodeURIComponent(key)}.json` || item.result !== `cells/${encodeURIComponent(key)}.json`) throw new Error(`BLOCKED_PHYSICAL_LEDGER_CELL_IDENTITY: ${key}`);
    const marker = readDual(roots, `${plan.stage}/${item.marker}`), result = readDual(roots, `${plan.stage}/${item.result}`);
    const start = history.get(`start:${plan.stage}:${key}`), complete = history.get(`complete:${plan.stage}:${key}`);
    if (item.state === 'PENDING' && (marker || result || start || complete)) throw new Error(`BLOCKED_PHYSICAL_ORPHAN_CELL: ${key}`);
    if (item.state === 'IN_PROGRESS' || item.state === 'AMBIGUOUS') throw new Error(`BLOCKED_PHYSICAL_AMBIGUOUS_CELL: ${key}`);
    if (item.state === 'COMPLETE' && (!marker || !result || result.sha256 !== item.sha256 || start?.type !== 'render-start' || !same(start.cell, cell) || complete?.type !== 'cell-complete' || !same(complete.cell, cell) || complete.sha256 !== item.sha256)) throw new Error(`BLOCKED_PHYSICAL_CELL_BINDING: ${key}`);
    if (!['PENDING', 'IN_PROGRESS', 'COMPLETE', 'AMBIGUOUS'].includes(item.state)) throw new Error(`BLOCKED_PHYSICAL_CELL_STATE: ${key}`);
  }
  const stateCounts = counts(ledger);
  if (ledger.accounting?.charged !== stateCounts.COMPLETE + stateCounts.IN_PROGRESS + stateCounts.AMBIGUOUS) throw new Error('BLOCKED_PHYSICAL_ACCOUNTING');
  return stateCounts;
}
function startCell(roots, plan, ledger, cell, {ownerId, priorLedgers = [], now = () => new Date().toISOString()} = {}) {
  const key = cellKey(cell), item = ledger.cells[key];
  if (!item || !same(item.cell, cell)) throw new Error(`BLOCKED_PHYSICAL_UNPLANNED_CELL: ${key}`);
  if (item.state !== 'PENDING') throw new Error(`BLOCKED_PHYSICAL_NO_RERENDER: ${key}:${item.state}`);
  const total = totalCharged([...priorLedgers, ledger]);
  if (HISTORICAL_CALLS + total + 1 > MAX_CALLS) throw new Error('BLOCKED_PHYSICAL_BUDGET');
  const at = now(), marker = {schemaVersion: 1, stage: plan.stage, cell, ownerId, pid: process.pid, hostname: os.hostname(), startedAt: at, charge: 1};
  writeImmutableDual(roots, `${plan.stage}/${item.marker}`, jsonBytes(marker));
  item.state = 'IN_PROGRESS'; item.startedAt = at; ledger.accounting.charged++;
  saveLedger(roots, ledger);
  appendJournal(roots, {eventId: `start:${plan.stage}:${key}`, type: 'render-start', stage: plan.stage, cell, ownerId, at});
  return item;
}
function completeCell(roots, plan, ledger, cell, row, {artifact, now = () => new Date().toISOString()} = {}) {
  const key = cellKey(cell), item = ledger.cells[key];
  if (!item || item.state !== 'IN_PROGRESS') throw new Error(`BLOCKED_PHYSICAL_CELL_NOT_STARTED: ${key}`);
  let artifactEvidence = null;
  if (artifact) {
    const relative = `${plan.stage}/artifacts/${encodeURIComponent(key)}.wav`;
    const storedArtifact = writeImmutableDual(roots, relative, artifact);
    artifactEvidence = {path: relative, sha256: storedArtifact.sha256, size: storedArtifact.size};
  }
  const data = {schemaVersion: 1, stage: plan.stage, cell, identity: plan.identity, row, artifact: artifactEvidence, capturedAt: now()};
  const stored = writeImmutableDual(roots, `${plan.stage}/${item.result}`, jsonBytes(data));
  item.state = 'COMPLETE'; item.sha256 = stored.sha256; item.completedAt = data.capturedAt;
  saveLedger(roots, ledger);
  appendJournal(roots, {eventId: `complete:${plan.stage}:${key}`, type: 'cell-complete', stage: plan.stage, cell, sha256: stored.sha256, at: item.completedAt});
  return stored;
}
function totalCharged(ledgers) { return ledgers.reduce((sum, ledger) => sum + (ledger?.accounting?.charged || 0), 0); }
function assertBudget(ledgers, next = 0) {
  const charged = totalCharged(ledgers);
  if (HISTORICAL_CALLS + charged + next > MAX_CALLS) throw new Error('BLOCKED_PHYSICAL_BUDGET');
  return {historical: HISTORICAL_CALLS, charged, remaining: MAX_CALLS - HISTORICAL_CALLS - charged, limit: MAX_CALLS};
}
function solveLinear3(matrix, vector) {
  if (!Array.isArray(matrix) || matrix.length !== 3 || matrix.some(row => !Array.isArray(row) || row.length !== 3) || vector.length !== 3) throw new Error('BLOCKED_PHYSICAL_SOLVER_SHAPE');
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (!Number.isFinite(a[pivot][col]) || Math.abs(a[pivot][col]) < 1e-14) throw new Error('BLOCKED_PHYSICAL_SINGULAR_SYSTEM');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j < 4; j++) a[col][j] /= divisor;
    for (let row = 0; row < 3; row++) if (row !== col) {
      const factor = a[row][col];
      for (let j = col; j < 4; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map(row => row[3]);
}
function centralDifferences({baseline, positive, negative, steps}) {
  if (!Array.isArray(baseline) || baseline.length !== SCREEN_CELLS.length || !Array.isArray(positive) || positive.length !== 3 || !Array.isArray(negative) || negative.length !== 3 || !Array.isArray(steps) || steps.length !== 3) throw new Error('BLOCKED_PHYSICAL_SENSITIVITY_COVERAGE');
  const featureCount = baseline[0]?.length;
  if (!Number.isInteger(featureCount) || featureCount < 1 || baseline.some(row => row.length !== featureCount) || positive.some(rows => rows.length !== baseline.length || rows.some(row => row.length !== featureCount)) || negative.some(rows => rows.length !== baseline.length || rows.some(row => row.length !== featureCount)) || steps.some(step => !Number.isFinite(step) || step <= 0)) throw new Error('BLOCKED_PHYSICAL_SENSITIVITY_SHAPE');
  const rows = [];
  for (let cell = 0; cell < baseline.length; cell++) for (let feature = 0; feature < featureCount; feature++) {
    const row = [];
    for (let parameter = 0; parameter < 3; parameter++) row.push((positive[parameter][cell][feature] - negative[parameter][cell][feature]) / (2 * steps[parameter]));
    rows.push(row);
  }
  return {rows, baseline: baseline.flat(), featureCount, cells: baseline.length};
}
function matrixRank3(rows, tolerance = 1e-10) {
  if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length !== 3 || row.some(value => !Number.isFinite(value)))) throw new Error('BLOCKED_PHYSICAL_SENSITIVITY_INVALID');
  const a = rows.map(row => [...row]), scale = Math.max(1, ...a.flat().map(Math.abs));
  let rank = 0;
  for (let col = 0; col < 3; col++) {
    let pivot = rank;
    for (let row = rank + 1; row < a.length; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot]?.[col] || 0)) pivot = row;
    if (Math.abs(a[pivot]?.[col] || 0) <= tolerance * scale) continue;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    const divisor = a[rank][col];
    for (let row = rank + 1; row < a.length; row++) {
      const factor = a[row][col] / divisor;
      for (let j = col; j < 3; j++) a[row][j] -= factor * a[rank][j];
    }
    rank++;
    if (rank === a.length) break;
  }
  return rank;
}
function dampedLeastSquares({sensitivity, residual, baseline = PARAMS.map(parameter => parameter.baseline), lambda = 1e-3, maxStepFraction = 0.05}) {
  if (!Array.isArray(sensitivity) || !Array.isArray(residual) || sensitivity.length !== residual.length || sensitivity.length < 3 || sensitivity.some(row => !Array.isArray(row) || row.length !== 3 || row.some(value => !Number.isFinite(value))) || residual.some(value => !Number.isFinite(value)) || !Number.isFinite(lambda) || lambda <= 0) throw new Error('BLOCKED_PHYSICAL_OPTIMIZER_INPUT');
  if (matrixRank3(sensitivity) < 3) throw new Error('BLOCKED_PHYSICAL_PARAMETER_UNIDENTIFIABLE');
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rhs = [0, 0, 0];
  for (let i = 0; i < sensitivity.length; i++) for (let a = 0; a < 3; a++) {
    rhs[a] -= sensitivity[i][a] * residual[i];
    for (let b = 0; b < 3; b++) normal[a][b] += sensitivity[i][a] * sensitivity[i][b];
  }
  for (let i = 0; i < 3; i++) normal[i][i] += lambda;
  let delta = solveLinear3(normal, rhs);
  const maxNorm = Math.max(...delta.map((value, i) => Math.abs(value / baseline[i])));
  if (maxNorm > maxStepFraction) delta = delta.map(value => value * maxStepFraction / maxNorm);
  const values = baseline.map((value, i) => Math.max(value * 0.9, Math.min(value * 1.1, value + delta[i])));
  validateCandidate(values);
  return {values, delta: values.map((value, i) => value - baseline[i]), rank: matrixRank3(sensitivity), lambda};
}
function lockWriter(roots, ownerId = crypto.randomUUID()) {
  const relative = 'locks/writer.lock', {a, b} = dualPaths(roots, relative);
  const bytes = jsonBytes({schemaVersion: 1, epoch: EPOCH, ownerId, pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString()});
  const created = [];
  try {
    for (const [file, base] of [[a, roots.primary], [b, roots.secondary]]) { writeExclusive(file, bytes, base); created.push(file); }
  } catch (error) {
    for (const file of created) { try { if (fs.readFileSync(file).equals(bytes)) fs.unlinkSync(file); } catch {} }
    throw new Error(`BLOCKED_PHYSICAL_WRITER_LOCK: ${error.message}`);
  }
  const check = readDual(roots, relative);
  if (!check || !check.bytes.equals(bytes)) throw new Error('BLOCKED_PHYSICAL_WRITER_LOCK_READBACK');
  return {ownerId, release() {
    const held = readDual(roots, relative);
    if (!held || !held.bytes.equals(bytes)) throw new Error('BLOCKED_PHYSICAL_WRITER_LOCK_OWNER');
    fs.unlinkSync(a); fs.unlinkSync(b);
  }};
}

module.exports = {
  ROOT, ISSUE, EPOCH, LINEAGE, HISTORICAL_CALLS, MAX_CALLS, PARAMS, SCREEN_CELLS, HOLDOUT_PITCHES,
  HOLDOUT_VELOCITIES, STAGES, REQUIRED_DIRS, sha256, jsonBytes, stable, same, inside, assertNoSymlink,
  resolveRoots, ensureDir, dualPaths, readDual, writeImmutableDual, writeMutableDual, readJson, writeJson,
  snapshotTree, cellKey, baselineCells, finiteDifferenceCells, candidateCells, holdoutCells, headroomCells,
  validateCandidate, exactCells, createPlan, freshLedger, counts, saveLedger, appendJournal, journal,
  verifyLedger, startCell, completeCell, totalCharged, assertBudget, solveLinear3, centralDifferences,
  matrixRank3, dampedLeastSquares, lockWriter
};
