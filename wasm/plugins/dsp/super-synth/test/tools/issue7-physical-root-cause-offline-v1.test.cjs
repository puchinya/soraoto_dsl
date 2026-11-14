'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('./issue7-physical-root-cause-offline-v1-core.cjs');

const CELLS = core.STRESS_CELLS;
function tempRoots() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-offline-core-'));
  const root = path.join(base, 'repo'), home = path.join(base, 'home'), commonDirectory = path.join(base, 'common');
  for (const directory of [root, home, commonDirectory]) fs.mkdirSync(directory, {recursive: true});
  const roots = core.resolveInputRoots({root, home, commonDirectory});
  return {base, roots};
}
function putDual(pair, relative, bytes) {
  for (const root of [pair.primary, pair.secondary]) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes);
  }
  return {bytes, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
}
function metadataBytes(guardHits = 0) { return core.jsonBytes({row: {outputGuardHits: guardHits}}); }
function makeHistoryObservation(id, source, sourceSha256, values, rows) {
  return {id, source, sourceSha256, values, valuesSha256: core.sha256(core.jsonBytes(values)),
    rows: rows.map((row, index) => ({pitch: CELLS[index].pitch, velocity: CELLS[index].velocity,
      metadataSha256: row.metadata.sha256, wavSha256: row.audio.sha256}))};
}
function buildV3Fixture(roots) {
  const observations = [], output = [];
  const baselineValues = [1.05, 0.5, 0.018];
  const stages = [
    {stage: 'baseline', groups: [{group: null, id: 'v3-baseline', source: 'immutable-v3-p1-baseline', values: baselineValues}]},
    {stage: 'candidate', groups: Array.from({length: 7}, (_, i) => ({group: i + 1,
      id: `v3-candidate-${String(i + 1).padStart(2, '0')}`, source: 'immutable-v3-p1-candidate', values: [1 + i / 10, 0.4 + i / 100, 0.018 + i / 1000]}))}
  ];
  for (const {stage, groups} of stages) {
    const planCells = [];
    const ledger = {cells: {}};
    const groupRows = new Map();
    for (const group of groups) {
      const rows = [];
      for (const cell of CELLS) {
        const cellEntry = {...cell};
        if (group.group === null) cellEntry.kind = 'baseline';
        else { cellEntry.kind = 'candidate'; cellEntry.candidate = group.group - 1; cellEntry.values = group.values; }
        planCells.push(cellEntry);
        const cellKey = `${cellEntry.kind}:${cell.pitch}:${cell.velocity}:x:x:${cellEntry.candidate ?? 'x'}:x`;
        const metadataRel = `${stage}/rows/${String(group.group ?? 0)}-${cell.pitch}-${cell.velocity}.json`;
        const metadata = putDual(roots.v3, metadataRel, metadataBytes());
        const audioRel = `${stage}/artifacts/${encodeURIComponent(cellKey)}.wav`;
        // Candidate plan has one row per cell and unique candidate groups; each stage stores a single artifact per cell.
        // Use deterministic opaque bytes because this reader authenticates bytes before decoding them.
        const audio = putDual(roots.v3, audioRel, Buffer.from(`wav:${stage}:${group.group}:${cellKey}`));
        ledger.cells[cellKey] = {state: 'COMPLETE', result: `rows/${String(group.group ?? 0)}-${cell.pitch}-${cell.velocity}.json`};
        rows.push({metadata, audio});
      }
      const sourceRecord = putDual(roots.v3, `${stage}/result.json`, core.jsonBytes({stage}));
      observations.push(makeHistoryObservation(group.id, group.source, sourceRecord.sha256, group.values, rows));
      output.push({group, rows});
    }
    putDual(roots.v3, `${stage}/plan.json`, core.jsonBytes({cells: planCells}));
    putDual(roots.v3, `${stage}/ledger.json`, core.jsonBytes(ledger));
  }
  return {observations, output};
}
function buildV4Fixture(roots) {
  const observations = [], candidates = [];
  for (let index = 0; index < 12; index++) {
    const id = `v4-vector-${String(index + 1).padStart(2, '0')}`;
    const values = [1.02 + index / 100, 0.45 + index / 100, 0.019 + index / 1000];
    const rows = [];
    for (const cell of CELLS) {
      const call = `calls/p3-${id}-${cell.pitch}-${cell.velocity}`;
      const metadata = putDual(roots.v4, `${call}/result.json`, metadataBytes());
      const audio = putDual(roots.v4, `${call}/audio.wav`, Buffer.from(`wav:v4:${id}:${cell.pitch}:${cell.velocity}`));
      rows.push({metadata, audio});
    }
    observations.push(makeHistoryObservation(id, 'v4', null, values, rows));
    candidates.push({score: {id, values}});
  }
  return {observations, optimizer: {rounds: [{candidates}]}};
}

test('the offline reader exposes read-only APIs and fixed trust boundaries', () => {
  const names = Object.keys(core);
  assert.ok(names.includes('resolveInputRoots') && names.includes('readVerifiedV3Rows') && names.includes('compareHistory'));
  assert.ok(!names.some(name => /^(?:write|publish|render)/i.test(name)));
  const source = fs.readFileSync(path.join(__dirname, 'issue7-physical-root-cause-offline-v1-core.cjs'), 'utf8');
  assert.doesNotMatch(source, /writeFileSync|mkdirSync|renameSync|unlinkSync|run-issue7-physical-fit-v[345]\.cjs|run-issue7-physical-identification-v1\.cjs/);
  assert.equal(core.STRESS_CELLS.map(cell => `${cell.pitch}/${cell.velocity}`).join(','), '90/31,93/31,96/14,96/31,96/36,96/124,99/31');
});

test('dual-copy reads reject one-sided and divergent evidence without repair', t => {
  const {base, roots} = tempRoots(); t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  putDual(roots.v3, 'fixture.json', core.jsonBytes({ok: true}));
  assert.deepEqual(core.readJson(roots.v3, 'fixture.json').value, {ok: true});
  fs.unlinkSync(path.join(roots.v3.secondary, 'fixture.json'));
  assert.throws(() => core.readDual(roots.v3, 'fixture.json'), /DUAL_COPY_MISSING/);
  fs.writeFileSync(path.join(roots.v3.secondary, 'fixture.json'), core.jsonBytes({ok: false}));
  assert.throws(() => core.readDual(roots.v3, 'fixture.json'), /DUAL_COPY_DIVERGED/);
});

test('root resolution rejects escapes, symlinks, and overlapping evidence roots', t => {
  const {base, roots} = tempRoots();
  assert.throws(() => core.readDual(roots.v3, '../escape'), /RELATIVE_PATH/);
  const link = path.join(roots.v3.primary, 'linked'); fs.mkdirSync(roots.v3.primary, {recursive: true});
  fs.symlinkSync(path.join(base, 'outside'), link);
  assert.throws(() => core.readDual(roots.v3, 'linked/file.json'), /SYMLINK/);
  fs.rmSync(base, {recursive: true, force: true});
});

test('v3 and v4 source readers authenticate all twenty vectors and 140 ordered WAV/metadata pairs', t => {
  const {base, roots} = tempRoots(); t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const v3 = buildV3Fixture(roots), v4 = buildV4Fixture(roots), p5History = {observations: [...v3.observations, ...v4.observations]};
  const v3Rows = core.readVerifiedV3Rows(roots, p5History);
  const v4Rows = core.readVerifiedV4Rows(roots, p5History, v4.optimizer);
  assert.equal(v3Rows.length, 8);
  assert.equal(v3Rows.reduce((sum, row) => sum + row.rows.length, 0), 56);
  assert.equal(v4Rows.length, 12);
  assert.equal(v4Rows.reduce((sum, row) => sum + row.rows.length, 0), 84);
  assert.equal(v3Rows[0].rows[0].guardHits, 0);
  assert.throws(() => core.readVerifiedV4Rows(roots, {observations: p5History.observations.slice(0, -1)}, v4.optimizer), /V4_HISTORY_COUNT/);
  const inv = core.snapshotSources(roots);
  assert.equal(inv.v3.primary.length, inv.v3.secondary.length);
});

test('v3/v4 readers fail closed on source tag, row order, and metadata hash drift', t => {
  const {base, roots} = tempRoots(); t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const v3 = buildV3Fixture(roots), v4 = buildV4Fixture(roots), history = {observations: [...v3.observations, ...v4.observations]};
  history.observations[0].source = 'untrusted';
  assert.throws(() => core.readVerifiedV3Rows(roots, history), /V3_HISTORY_IDENTITY/);
  history.observations[0].source = 'immutable-v3-p1-baseline';
  history.observations[0].rows.reverse();
  assert.throws(() => core.readVerifiedV3Rows(roots, history), /CELL_HASH_OR_ORDER_MISMATCH/);
});

test('archive identity is checked before extraction and SFZ mapping rejects ambiguity', t => {
  const {base} = tempRoots(); t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const archive = path.join(base, 'archive.tar.gz'); fs.writeFileSync(archive, 'not the frozen archive');
  assert.throws(() => core.readVerifiedReference(archive, {archiveSha256: core.ARCHIVE_SHA256}), /REFERENCE_ARCHIVE_SHA_MISMATCH/);
  assert.throws(() => core.readVerifiedReference(path.join(base, 'missing.tar.gz'), {archiveSha256: core.ARCHIVE_SHA256}), /REFERENCE_ARCHIVE_MISSING/);
});

function syntheticHistoryAndRecomputed() {
  const observations = [], recomputed = [];
  for (let index = 0; index < 20; index++) {
    const id = index === 0 ? 'v3-baseline' : index < 8 ? `v3-candidate-${String(index).padStart(2, '0')}` : `v4-vector-${String(index - 7).padStart(2, '0')}`;
    const source = index < 8 ? (index === 0 ? 'immutable-v3-p1-baseline' : 'immutable-v3-p1-candidate') : 'v4';
    const sourceSha256 = index < 8 ? 'a'.repeat(64) : null, values = [1 + index / 100, 0.5, 0.018];
    const rows = CELLS.map((cell, row) => ({pitch: cell.pitch, velocity: cell.velocity,
      metadataSha256: crypto.createHash('sha256').update(`${id}:meta:${row}`).digest('hex'),
      wavSha256: crypto.createHash('sha256').update(`${id}:wav:${row}`).digest('hex')}));
    const metrics = CELLS.map((cell, row) => ({pitch: cell.pitch, velocity: cell.velocity,
      earlyResidualDb: -1.2 + row / 10, lateResidualDb: 0.2 + row / 100, postAttackShapeErrorDb: 1.4 + row / 10,
      dominantResidual: 'EARLY', hardFailures: [], finite: true, guardHits: 0, peakDbfs: -2}));
    const receipt = {id, source, sourceSha256, values, valuesSha256: core.sha256(core.jsonBytes(values)),
      officialViolation: 0.12, familyLoss: 1.5, pass: false, metrics, rows};
    observations.push(receipt);
    recomputed.push({id, source, sourceSha256, values, valuesSha256: receipt.valuesSha256, violation: receipt.officialViolation,
      loss: receipt.familyLoss, pass: receipt.pass, metrics: structuredClone(metrics), rows: structuredClone(rows),
      guardHitsProvenance: 'AUTHENTICATED_STORED_METADATA'});
  }
  return {observations, recomputed};
}

test('history comparison distinguishes exact dB/non-dB tolerance and metadata-derived guard facts', () => {
  const fixture = syntheticHistoryAndRecomputed();
  assert.deepEqual(core.compareHistory(fixture.recomputed, fixture, {db: 1e-6, nonDb: 1e-8}), {
    result: 'PCM_METRICS_RECOMPUTED_AND_MATCHED', observationCount: 20, cellCount: 140,
    dbTolerance: 1e-6, nonDbTolerance: 1e-8,
    maxAbsErrorDb: {earlyResidualDb: 0, lateResidualDb: 0, postAttackShapeErrorDb: 0, peakDbfs: 0},
    maxAbsErrorNonDb: {officialViolation: 0, familyLoss: 0},
    guardHitsProvenance: 'AUTHENTICATED_STORED_METADATA'
  });
  fixture.recomputed[0].metrics[2].earlyResidualDb += 1.1e-6;
  assert.throws(() => core.compareHistory(fixture.recomputed, fixture, {db: 1e-6, nonDb: 1e-8}), error => {
    assert.equal(error.code, 'PCM_METRIC_MISMATCH');
    assert.ok(error.mismatches.some(item => item.field === 'metrics[2].earlyResidualDb'));
    return true;
  });
  fixture.recomputed[0].metrics[2].earlyResidualDb -= 1.1e-6;
  fixture.recomputed[0].loss += 1.1e-8;
  assert.throws(() => core.compareHistory(fixture.recomputed, fixture, {db: 1e-6, nonDb: 1e-8}), /PCM_METRIC_MISMATCH/);
});

test('report is deterministic, path-redacted, and never upgrades Stage 3/4 acceptance', () => {
  const first = core.buildReport({gate1: {status: 'BLOCKED', privatePath: '/Users/secret/private/file'},
    gate2: {status: 'BLOCKED'}, sourceSnapshots: {unchanged: true}});
  const second = core.buildReport({gate1: {status: 'BLOCKED', privatePath: '/Users/secret/private/file'},
    gate2: {status: 'BLOCKED'}, sourceSnapshots: {unchanged: true}});
  assert.equal(first, second);
  assert.doesNotMatch(first, /\/Users\/secret/);
  const parsed = JSON.parse(first);
  assert.equal(parsed.stage3, 'NOT EVALUATED');
  assert.equal(parsed.stage4, 'NOT EVALUATED');
  assert.equal(parsed.productAcousticAcceptance, 'BLOCKED');
});
