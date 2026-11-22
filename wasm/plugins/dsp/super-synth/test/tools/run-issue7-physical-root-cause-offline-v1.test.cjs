'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('./issue7-physical-root-cause-offline-v1-core.cjs');
const cli = require('./run-issue7-physical-root-cause-offline-v1.cjs');

function tempState() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-offline-cli-'));
  const root = path.join(base, 'repo'), home = path.join(base, 'home'), commonDirectory = path.join(base, 'common');
  for (const directory of [root, home, commonDirectory]) fs.mkdirSync(directory, {recursive: true});
  return {base, root, home, commonDirectory, roots: core.resolveInputRoots({root, home, commonDirectory})};
}
function verifiedReport(head, roots, sourceSnapshot = core.snapshotSources(roots), epoch = core.EPOCH) {
  const snapshotSha = cli.sha(core.jsonBytes(core.stable(sourceSnapshot)));
  return core.buildReport({epoch, outcome: 'GATE0_2_VERIFIED_AND_PUBLISHED',
    gate1: {status: 'PASS', predicate: 'RECOVERED_IDENTICAL', historicExecutableIdentity: 'VERIFIED_ORIGINAL',
      fileStatus: 'MATCH', p1RecordStatus: 'MATCH', wasmSha256: core.DIAGNOSTIC_WASM_SHA256,
      wasmExists: true, wasmSize: 437260, p1RuntimeRecordSha256: core.P1_RECORD_SHA256, p1RuntimeWasmSha256: core.DIAGNOSTIC_WASM_SHA256,
      exports: {status: 'MATCH', requiredCount: core.EXPORTS.length, matchedCount: core.EXPORTS.length}},
    gate2: {status: 'PASS', observationCount: 20, cellCount: 140,
      comparison: {result: 'PCM_METRICS_RECOMPUTED_AND_MATCHED', observationCount: 20, cellCount: 140},
      reference: {archiveSha256: core.ARCHIVE_SHA256, archiveSize: 741757374, archiveMtimeMs: 1234,
        sfzSha256: 'd'.repeat(64), sampleCount: 25}},
    historicExecutableIdentity: 'VERIFIED_ORIGINAL', storedPcmEvaluation: 'PCM_METRICS_RECOMPUTED_AND_MATCHED',
    publication: 'IMMUTABLE_MANIFEST_REQUIRED', sourceSnapshots: {unchanged: true, beforeSha256: snapshotSha,
      afterSha256: snapshotSha, stores: core.summarizeSources(sourceSnapshot)},
    delivery: {repository: 'puchinya/soraoto_dsl', issue: 7, prUrl: 'https://github.com/puchinya/soraoto_dsl/pull/8',
      prBranch: cli.PR_BRANCH, currentHead: head, worktreeBranch: 'codex/issue-7-pr8-root-cause-review',
      upstreamBranch: `origin/${cli.PR_BRANCH}`}});
}
function freshReport(reportText, head) {
  const value = JSON.parse(reportText);
  value.outcome = 'GATE0_2_VERIFIED_AWAITING_PUBLICATION';
  value.publication = 'NOT ATTEMPTED';
  value.delivery.currentHead = head;
  return JSON.parse(core.buildReport(value));
}
function verifyOptions(head, value) {
  return {freshReport: value, readHead: () => head, readWorktreeStatus: () => ''};
}
function fixturePostWriteAdapters(head, overrides = {}) {
  return {
    readHead: overrides.readHead || (() => head),
    readWorktreeStatus: overrides.readWorktreeStatus || (() => ''),
    readRemotePr: overrides.readRemotePr || (() => ({state: 'OPEN', number: cli.PR_NUMBER, baseRefName: 'main',
      headRefName: cli.PR_BRANCH, headRefOid: head}))
  };
}
function publishFixture(options) {
  return cli.publishReport({...options,
    testOnlyPostWriteAdapters: options.testOnlyPostWriteAdapters || fixturePostWriteAdapters(options.head)});
}
function seedSourceEvidence(roots) {
  const relative = 'analysis-anchor.json';
  for (const root of [roots.v3.primary, roots.v3.secondary]) {
    fs.mkdirSync(root, {recursive: true});
    fs.writeFileSync(path.join(root, relative), '{"anchor":"original"}\n');
  }
  return [path.join(roots.v3.primary, relative), path.join(roots.v3.secondary, relative)];
}
function changedReportText(reportText, mutate) {
  const value = JSON.parse(reportText);
  mutate(value);
  return `${JSON.stringify(core.stable(value), null, 2)}\n`;
}
function statTree(paths) {
  return paths.flatMap(root => {
    if (!fs.existsSync(root)) return [];
    const entries = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const absolute = path.join(directory, entry.name), stat = fs.statSync(absolute);
        if (stat.isDirectory()) walk(absolute);
        else entries.push([path.relative(root, absolute), stat.size, stat.mtimeMs]);
      }
    };
    walk(root); return entries;
  });
}
function uleb(value) {
  const bytes = [];
  do { let byte = value & 0x7f; value >>>= 7; if (value) byte |= 0x80; bytes.push(byte); } while (value);
  return bytes;
}
function wasmModule(exports) {
  const section = (id, payload) => [id, ...uleb(payload.length), ...payload];
  const str = value => { const bytes = [...Buffer.from(value)]; return [...uleb(bytes.length), ...bytes]; };
  const types = section(1, [1, 0x60, 0, 0]);
  const functions = section(3, [exports.length, ...exports.map(() => 0)]);
  const exported = section(7, [exports.length, ...exports.flatMap((name, index) => [...str(name), 0, ...uleb(index)])]);
  const code = section(10, [exports.length, ...exports.flatMap(() => [2, 0, 0x0b])]);
  return Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, ...types, ...functions, ...exported, ...code]);
}

test('forensic reports separate missing WASM, P1 record identity, and export predicates', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const before = statTree([state.root, state.commonDirectory, state.home]);
  const result = cli.classifyForensic(state);
  assert.equal(result.predicate, 'MISSING');
  assert.equal(result.fileStatus, 'MISSING');
  assert.equal(result.p1RecordStatus, 'P1_RECORD_SHA_MISMATCH');
  assert.equal(result.historicExecutableIdentity, 'HISTORICAL_BINARY_UNAVAILABLE');
  assert.deepEqual(result.work, {writes: 0, builds: 0, renders: 0, acousticCalls: 0});
  assert.deepEqual(statTree([state.root, state.commonDirectory, state.home]), before);
});

test('Gate 1 distinguishes exact recovery, file SHA mismatch, P1 record mismatch, missing WASM, and exports mismatch', () => {
  const exports = core.EXPORTS, goodBytes = wasmModule(exports), goodSha = cli.sha(goodBytes), recordSha = 'd'.repeat(64);
  const runtime = {build: {wasmSha256: goodSha}};
  const recovered = cli.classifyBinaryIdentity({bytes: goodBytes, runtime, p1RecordSha256: recordSha,
    expectedWasmSha256: goodSha, expectedP1RecordSha256: recordSha});
  assert.equal(recovered.predicate, 'RECOVERED_IDENTICAL');
  assert.equal(recovered.exports.matchedCount, 4);
  assert.equal(cli.classifyBinaryIdentity({bytes: null, runtime, p1RecordSha256: recordSha,
    expectedWasmSha256: goodSha, expectedP1RecordSha256: recordSha}).predicate, 'MISSING');
  const changedButStillExporting = wasmModule([...exports, 'extra']);
  const mismatch = cli.classifyBinaryIdentity({bytes: changedButStillExporting, runtime, p1RecordSha256: recordSha,
    expectedWasmSha256: goodSha, expectedP1RecordSha256: recordSha});
  assert.equal(mismatch.predicate, 'FILE_SHA_MISMATCH');
  assert.equal(mismatch.exports.status, 'MATCH');
  assert.equal(cli.classifyBinaryIdentity({bytes: goodBytes, runtime, p1RecordSha256: 'e'.repeat(64),
    expectedWasmSha256: goodSha, expectedP1RecordSha256: recordSha}).predicate, 'P1_RECORD_SHA_MISMATCH');
  const missingExports = cli.classifyBinaryIdentity({bytes: wasmModule(['unrelated']),
    runtime: {build: {wasmSha256: cli.sha(wasmModule(['unrelated']))}}, p1RecordSha256: recordSha,
    expectedWasmSha256: cli.sha(wasmModule(['unrelated'])), expectedP1RecordSha256: recordSha});
  assert.equal(missingExports.predicate, 'EXPORT_MISMATCH');
});

test('analyze terminates on missing private records with zero writes and explicit NOT evaluated gates', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const before = statTree([state.root, state.commonDirectory, state.home]);
  const result = cli.runAnalysis(state);
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.result.error, /P1_RECORD_SHA_MISMATCH/);
  const report = JSON.parse(result.reportText);
  assert.equal(report.stage3, 'NOT EVALUATED');
  assert.equal(report.stage4, 'NOT EVALUATED');
  assert.equal(report.gate0.acousticCalls, 0);
  assert.deepEqual(statTree([state.root, state.commonDirectory, state.home]), before);
});

test('authority verifier fails closed on stale PR head, wrong branch, and unapproved Issue state', () => {
  const issue = {state: 'OPEN', labels: [{name: 'phase:implementation'}]};
  const pr = {state: 'OPEN', headRefName: cli.PR_BRANCH, headRefOid: 'b'.repeat(40), baseRefName: 'main', number: 8};
  const approval = {id: Number(cli.APPROVAL_COMMENT_ID), user: {login: 'puchinya'}, body: '6ファイルを実装し、条件付きdual-store保存、commit/push/既存PR #8のHEAD確認・最終レビューまで進めること'};
  assert.throws(() => cli.verifyPublicationAuthority({head: 'a'.repeat(40), issue, pr, approval}), /PR_HEAD_OR_BRANCH_MISMATCH/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid, branch: 'unexpected', issue, pr, approval}), /PR_HEAD_OR_BRANCH_MISMATCH/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid, issue: {state: 'CLOSED', labels: []}, pr, approval}), /ISSUE_APPROVAL_MISSING/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid, issue, pr,
    approval: {...approval, id: 42}}), /APPROVAL_COMMENT_MISMATCH/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid, issue, pr, approval,
    epoch: core.offlineEpoch(2)}), /CONTINUATION_APPROVAL_MISSING/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid,
    issue: {...issue, body: cli.CONTINUATION_APPROVAL_MARKER}, pr, approval, epoch: core.offlineEpoch(2)}), /WORKTREE_NOT_CLEAN/);
});

test('publication authority queries use rtk gh subcommands without duplicating the gh prefix', () => {
  const issue = {state: 'OPEN', labels: [{name: 'phase:implementation'}], body: 'approved'};
  const pr = {state: 'OPEN', headRefName: cli.PR_BRANCH, headRefOid: 'd'.repeat(40), baseRefName: 'main', number: 8,
    body: 'Closes #7'};
  const approval = {id: Number(cli.APPROVAL_COMMENT_ID), user: {login: 'puchinya'}, body: '6ファイルを実装し、条件付きdual-store保存、commit/push/既存PR #8のHEAD確認・最終レビューまで進めること'};
  const calls = [], checks = [];
  const result = cli.collectAuthority(pr.headRefOid, {
    readGhJson: args => { calls.push(args); return args[0] === 'issue' ? issue : pr; },
    readApproval: () => approval,
    verifyPublicationAuthority: value => checks.push(value)
  });
  assert.deepEqual(calls, [
    ['issue', 'view', '7', '--json', 'state,labels,body'],
    ['pr', 'view', '8', '--json', 'state,headRefName,headRefOid,baseRefName,number,body,url']
  ]);
  assert.equal(checks.length, 1);
  assert.equal(result.approval, approval);
});

test('HEAD continuation appends analysis-02, verifies the latest epoch, and preserves analysis-01 bytes and mtimes', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const sourceSnapshot = core.snapshotSources(state.roots), head1 = '1'.repeat(40), head2 = '2'.repeat(40), head3 = '3'.repeat(40);
  const baseText = verifiedReport(head1, state.roots, sourceSnapshot);
  publishFixture({reportText: baseText, roots: state.roots, head: head1,
    expectedSourceSnapshot: sourceSnapshot, authorityVerifier: () => true});
  const basePair = state.roots.offline;
  const originalIdentity = {
    head: head1,
    reportSha256: cli.sha(fs.readFileSync(path.join(basePair.primary, 'report.json'))),
    manifestSha256: cli.sha(fs.readFileSync(path.join(basePair.primary, 'manifest.json')))
  };
  const prior = cli.publicationSequence(state.roots, {originalIdentity});
  const beforeBase = cli.priorPublicationSnapshot(prior);
  const selected = cli.selectPublicationForHead(state.roots, head2, {originalIdentity});
  assert.equal(selected.epoch, core.offlineEpoch(2));
  const continuationText = verifiedReport(head2, state.roots, sourceSnapshot, selected.epoch);
  for (const mutate of [
    value => { value.gate2.reference.archiveMtimeMs += 1; },
    value => { value.gate2.comparison.maxAbsErrorDb = {earlyResidualDb: 0.5}; }
  ]) {
    const changedEvidence = changedReportText(continuationText, mutate);
    assert.throws(() => publishFixture({reportText: changedEvidence, roots: state.roots,
      publication: selected.publication, epoch: selected.epoch, head: head2,
      expectedSourceSnapshot: sourceSnapshot,
      expectedPriorPublicationSnapshot: {sequence: prior, snapshot: beforeBase}, authorityVerifier: () => true}),
    /PRIOR_EPOCH_EVIDENCE_DRIFT/);
    assert.equal(fs.existsSync(selected.publication.primary), false);
    assert.equal(fs.existsSync(selected.publication.secondary), false);
    assert.deepEqual(cli.priorPublicationSnapshot(prior), beforeBase);
    assert.equal(cli.selectPublicationForHead(state.roots, head2, {originalIdentity}).epoch, selected.epoch);
  }
  const published = publishFixture({reportText: continuationText, roots: state.roots,
    publication: selected.publication, epoch: selected.epoch, head: head2,
    expectedSourceSnapshot: sourceSnapshot,
    expectedPriorPublicationSnapshot: {sequence: prior, snapshot: beforeBase}, authorityVerifier: () => true});
  assert.equal(published.status, 'PUBLISHED');
  const continuation = cli.publicationSequence(state.roots, {originalIdentity});
  assert.deepEqual(continuation.map(item => item.epoch), [core.EPOCH, core.offlineEpoch(2)]);
  assert.deepEqual(cli.priorPublicationSnapshot(continuation.slice(0, 1)), beforeBase);
  assert.equal(cli.latestPublication(state.roots, {originalIdentity}).manifestValue.head, head2);
  assert.equal(cli.verifyPublishedReport(state.roots, {
    ...verifyOptions(head2, freshReport(continuationText, head2)),
    publication: selected.publication, epoch: selected.epoch
  }).status, 'PASS');
  assert.equal(cli.selectPublicationForHead(state.roots, head2, {originalIdentity}).epoch, selected.epoch);
  assert.equal(cli.selectPublicationForHead(state.roots, head3, {originalIdentity}).epoch, core.offlineEpoch(3));
});

test('prior epoch drift under the transaction is detected before immutable bytes and owned empty targets are removed', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const sourceSnapshot = core.snapshotSources(state.roots), head1 = '4'.repeat(40), head2 = '5'.repeat(40);
  const baseText = verifiedReport(head1, state.roots, sourceSnapshot);
  publishFixture({reportText: baseText, roots: state.roots, head: head1,
    expectedSourceSnapshot: sourceSnapshot, authorityVerifier: () => true});
  const basePair = state.roots.offline;
  const originalIdentity = {head: head1,
    reportSha256: cli.sha(fs.readFileSync(path.join(basePair.primary, 'report.json'))),
    manifestSha256: cli.sha(fs.readFileSync(path.join(basePair.primary, 'manifest.json')))};
  const prior = cli.publicationSequence(state.roots, {originalIdentity});
  const before = cli.priorPublicationSnapshot(prior);
  const selected = cli.selectPublicationForHead(state.roots, head2, {originalIdentity});
  const reportText = verifiedReport(head2, state.roots, sourceSnapshot, selected.epoch);
  let mutated = false;
  assert.throws(() => publishFixture({reportText, roots: state.roots, publication: selected.publication,
    epoch: selected.epoch, head: head2, expectedSourceSnapshot: sourceSnapshot,
    expectedPriorPublicationSnapshot: {sequence: prior, snapshot: before}, authorityVerifier: () => true,
    beforeImmutableWrite: operation => {
      if (!mutated && operation === 'primary:report.json') {
        mutated = true;
        const reportPath = path.join(basePair.primary, 'report.json'), stat = fs.statSync(reportPath);
        const shifted = new Date(Date.now() + 10000);
        fs.utimesSync(reportPath, stat.atime, shifted);
      }
    }}), /PRIOR_EPOCH_CHANGED/);
  assert.equal(mutated, true);
  assert.equal(fs.existsSync(selected.publication.primary), false);
  assert.equal(fs.existsSync(selected.publication.secondary), false);
  assert.deepEqual(fs.readFileSync(path.join(basePair.primary, 'report.json')),
    fs.readFileSync(path.join(basePair.secondary, 'report.json')));
  assert.equal(fs.existsSync(path.join(selected.publication.primary, 'publish.lock')), false);
  assert.equal(fs.existsSync(path.join(selected.publication.secondary, 'publish.lock')), false);
});

test('publisher immutably writes both copies, reads back exact bytes, and reuses without mtime changes', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const head = 'f'.repeat(40), sourceSnapshot = core.snapshotSources(state.roots);
  const reportText = verifiedReport(head, state.roots, sourceSnapshot);
  const authorityVerifier = () => true;
  const first = publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier, ownerId: 'fixture-owner'});
  assert.equal(first.status, 'PUBLISHED');
  assert.equal(first.readback, 'MATCHED_BOTH_COPIES');
  assert.equal(cli.verifyPublishedReport(state.roots, verifyOptions(head, freshReport(reportText, head))).status, 'PASS');
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  for (const name of ['report.json', 'manifest.json']) {
    assert.deepEqual(fs.readFileSync(path.join(primary, name)), fs.readFileSync(path.join(secondary, name)));
  }
  const beforeMtime = statTree([primary, secondary]);
  const retry = publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier, ownerId: 'fixture-owner-2'});
  assert.equal(retry.status, 'REUSED');
  assert.equal(retry.unchangedMtime, true);
  assert.deepEqual(statTree([primary, secondary]), beforeMtime);
});

test('publisher does not return PUBLISHED or REUSED when live Git HEAD changes after authorization', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const head = '6'.repeat(40), sourceSnapshot = core.snapshotSources(state.roots), reportText = verifiedReport(head, state.roots, sourceSnapshot);
  let currentHead = head;
  const adapters = fixturePostWriteAdapters(head, {readHead: () => currentHead});
  assert.throws(() => publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier: () => true, testOnlyPostWriteAdapters: adapters,
    beforeImmutableWrite: operation => { if (operation === 'primary:report.json') currentHead = '7'.repeat(40); }}),
  /STALE_PUBLISHED_REPORT_HEAD_DRIFT/);
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  const preserved = statTree([primary, secondary]);
  for (const root of [primary, secondary]) {
    assert.equal(fs.existsSync(path.join(root, 'report.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'publish.lock')), false);
  }
  assert.throws(() => publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier: () => true, testOnlyPostWriteAdapters: adapters}),
  /STALE_PUBLISHED_REPORT_HEAD_DRIFT/);
  assert.deepEqual(statTree([primary, secondary]), preserved);
});

test('publisher rechecks the remote PR HEAD after immutable readback', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const head = '8'.repeat(40), remoteHead = {value: head};
  const sourceSnapshot = core.snapshotSources(state.roots), reportText = verifiedReport(head, state.roots, sourceSnapshot);
  const adapters = fixturePostWriteAdapters(head, {readRemotePr: () => ({state: 'OPEN', number: cli.PR_NUMBER,
    baseRefName: 'main', headRefName: cli.PR_BRANCH, headRefOid: remoteHead.value})});
  assert.throws(() => publishFixture({reportText, roots: state.roots, head,
    expectedSourceSnapshot: sourceSnapshot, authorityVerifier: () => true, testOnlyPostWriteAdapters: adapters,
    beforeImmutableWrite: operation => { if (operation === 'primary:report.json') remoteHead.value = '9'.repeat(40); }}),
  /POST_WRITE_REMOTE_PR_HEAD_DRIFT/);
  for (const root of [state.roots.offline.primary, state.roots.offline.secondary]) {
    assert.equal(fs.existsSync(path.join(root, 'report.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'publish.lock')), false);
  }
});

test('published verification rejects a newer executing HEAD and changed reference archive identity', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const head = 'f'.repeat(40), sourceSnapshot = core.snapshotSources(state.roots);
  const reportText = verifiedReport(head, state.roots, sourceSnapshot);
  publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot, authorityVerifier: () => true});
  const fresh = freshReport(reportText, head);
  assert.equal(cli.verifyPublishedReport(state.roots, verifyOptions(head, fresh)).status, 'PASS');

  const newerHead = 'e'.repeat(40), headDrift = freshReport(reportText, newerHead);
  assert.throws(() => cli.verifyPublishedReport(state.roots, verifyOptions(newerHead, headDrift)), /STALE_PUBLISHED_REPORT_HEAD_DRIFT/);

  const archiveDrift = structuredClone(fresh);
  archiveDrift.gate2.reference.archiveSha256 = '0'.repeat(64);
  assert.throws(() => cli.verifyPublishedReport(state.roots, verifyOptions(head, archiveDrift)), /STALE_PUBLISHED_REPORT_REFERENCE_DRIFT/);
});

test('published verification rejects one-sided and two-sided residual locks without mutation', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const head = 'f'.repeat(40), sourceSnapshot = core.snapshotSources(state.roots);
  const reportText = verifiedReport(head, state.roots, sourceSnapshot);
  publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot, authorityVerifier: () => true});
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  const fresh = freshReport(reportText, head), options = verifyOptions(head, fresh);
  for (const rootsWithLock of [[primary], [primary, secondary]]) {
    const lockBytes = Buffer.from('unknown owner; preserve');
    for (const root of rootsWithLock) fs.writeFileSync(path.join(root, 'publish.lock'), lockBytes, {flag: 'wx'});
    const before = statTree([primary, secondary]);
    assert.throws(() => cli.verifyPublishedReport(state.roots, options), /RESIDUAL_PUBLISH_LOCK/);
    assert.throws(() => publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
      authorityVerifier: () => true}), /RESIDUAL_PUBLISH_LOCK/);
    assert.deepEqual(statTree([primary, secondary]), before);
    for (const root of rootsWithLock) fs.unlinkSync(path.join(root, 'publish.lock'));
  }
  fs.writeFileSync(path.join(secondary, 'unexpected.bin'), 'preserve');
  const before = statTree([primary, secondary]);
  assert.throws(() => cli.verifyPublishedReport(state.roots, options), /UNEXPECTED_PUBLICATION_FILE/);
  assert.throws(() => publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier: () => true}), /UNEXPECTED_PUBLICATION_FILE/);
  assert.deepEqual(statTree([primary, secondary]), before);
});

test('publisher preserves partial output and never overwrites an unknown competing lock', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  const head = 'a'.repeat(40), sourceSnapshot = core.snapshotSources(state.roots);
  const reportText = verifiedReport(head, state.roots, sourceSnapshot);
  fs.mkdirSync(primary, {recursive: true}); fs.mkdirSync(secondary, {recursive: true});
  const partial = Buffer.from('partial report evidence');
  fs.writeFileSync(path.join(primary, 'report.json'), partial, {flag: 'wx'});
  assert.throws(() => publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier: () => true}), /PARTIAL_PUBLICATION_PRESERVED/);
  assert.throws(() => cli.verifyPublishedReport(state.roots, verifyOptions(head, freshReport(reportText, head))), /PARTIAL_PUBLICATION_PRESERVED/);
  assert.deepEqual(fs.readFileSync(path.join(primary, 'report.json')), partial);
  fs.unlinkSync(path.join(primary, 'report.json'));
  const lock = Buffer.from('unknown owner lock');
  fs.writeFileSync(path.join(primary, 'publish.lock'), lock, {flag: 'wx'});
  assert.throws(() => publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier: () => true}), /RESIDUAL_PUBLISH_LOCK/);
  assert.deepEqual(fs.readFileSync(path.join(primary, 'publish.lock')), lock);
  assert.deepEqual(fs.readdirSync(secondary), []);
});

test('publisher keeps partial dual-copy bytes and owned locks after a simulated secondary write failure', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  const head = 'b'.repeat(40), sourceSnapshot = core.snapshotSources(state.roots), reportText = verifiedReport(head, state.roots, sourceSnapshot);
  assert.throws(() => publishFixture({reportText, roots: state.roots, head, expectedSourceSnapshot: sourceSnapshot,
    authorityVerifier: () => true, ownerId: 'partial-owner', beforeImmutableWrite: operation => {
      if (operation === 'secondary:report.json') throw new Error('simulated second-copy failure');
    }}), /simulated second-copy failure/);
  assert.equal(fs.existsSync(path.join(primary, 'report.json')), true);
  assert.equal(fs.existsSync(path.join(secondary, 'report.json')), false);
  for (const root of [primary, secondary]) {
    const owner = JSON.parse(fs.readFileSync(path.join(root, 'publish.lock'), 'utf8'));
    assert.equal(owner.ownerId, 'partial-owner');
  }
});

test('publisher compares the analysis snapshot before any output write after SHA or mtime drift', t => {
  for (const mutation of ['sha256', 'mtime']) {
    const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
    const sourceFiles = seedSourceEvidence(state.roots), sourceSnapshot = core.snapshotSources(state.roots);
    const head = mutation === 'sha256' ? 'c'.repeat(40) : 'd'.repeat(40);
    const reportText = verifiedReport(head, state.roots, sourceSnapshot);
    let inventoryAfterAuthorityReadback;
    const authorityVerifier = () => {
      if (mutation === 'sha256') {
        for (const file of sourceFiles) fs.writeFileSync(file, '{"anchor":"changed!!"}\n');
      } else {
        for (const file of sourceFiles) {
          const stat = fs.statSync(file), changed = new Date(Date.now() + 10000);
          fs.utimesSync(file, stat.atime, changed);
        }
      }
      inventoryAfterAuthorityReadback = statTree([state.commonDirectory, state.home]);
      return true;
    };
    assert.throws(() => publishFixture({reportText, roots: state.roots, head,
      expectedSourceSnapshot: sourceSnapshot, authorityVerifier}), /ANALYSIS_SOURCE_SNAPSHOT_DRIFT/);
    assert.equal(fs.existsSync(state.roots.offline.primary), false);
    assert.equal(fs.existsSync(state.roots.offline.secondary), false);
    assert.deepEqual(statTree([state.commonDirectory, state.home]), inventoryAfterAuthorityReadback);
  }
});

test('publisher detects input inventory drift after writing and preserves locked evidence', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const sourceFiles = seedSourceEvidence(state.roots), sourceSnapshot = core.snapshotSources(state.roots);
  const head = 'e'.repeat(40), reportText = verifiedReport(head, state.roots, sourceSnapshot);
  assert.throws(() => publishFixture({reportText, roots: state.roots, head,
    expectedSourceSnapshot: sourceSnapshot, authorityVerifier: () => true, ownerId: 'inventory-drift-owner',
    beforeImmutableWrite: operation => {
      if (operation === 'secondary:manifest.json') {
        for (const file of sourceFiles) fs.writeFileSync(file, '{"anchor":"changed!!"}\n');
      }
    }}), /ANALYSIS_SOURCE_SNAPSHOT_DRIFT/);
  for (const root of [state.roots.offline.primary, state.roots.offline.secondary]) {
    assert.equal(fs.existsSync(path.join(root, 'report.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'publish.lock')), true);
  }
});

test('publisher rejects incomplete Gate1, Gate2, and source identities before any write', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const head = '9'.repeat(40), sourceSnapshot = core.snapshotSources(state.roots);
  const reportText = verifiedReport(head, state.roots, sourceSnapshot);
  const incomplete = [
    text => changedReportText(text, value => { value.gate1.predicate = 'MISSING'; }),
    text => changedReportText(text, value => { value.gate2.cellCount = 139; }),
    text => changedReportText(text, value => { value.sourceSnapshots.beforeSha256 = '0'.repeat(64); })
  ];
  for (const mutate of incomplete) {
    const candidate = mutate(reportText);
    assert.throws(() => publishFixture({reportText: candidate, roots: state.roots, head,
      expectedSourceSnapshot: sourceSnapshot, authorityVerifier: () => true}), /REPORT_(?:POSTCONDITION|SOURCE_SNAPSHOT)_MISMATCH/);
    assert.equal(fs.existsSync(state.roots.offline.primary), false);
    assert.equal(fs.existsSync(state.roots.offline.secondary), false);
  }
});

test('publisher rejects an incomplete report before creating output roots', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const blocked = core.buildReport({outcome: 'EVIDENCE_UNVERIFIABLE'});
  assert.throws(() => publishFixture({reportText: blocked, roots: state.roots, head: 'a'.repeat(40), authorityVerifier: () => true}), /REPORT_POSTCONDITION_MISMATCH/);
  assert.equal(fs.existsSync(state.roots.offline.primary), false);
  assert.equal(fs.existsSync(state.roots.offline.secondary), false);
});
