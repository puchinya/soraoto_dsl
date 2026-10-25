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
function verifiedReport(head = 'f'.repeat(40)) {
  return core.buildReport({outcome: 'GATE0_2_VERIFIED_AND_PUBLISHED',
    gate1: {status: 'PASS', predicate: 'RECOVERED_IDENTICAL'},
    gate2: {status: 'PASS', cellCount: 140, comparison: {result: 'PCM_METRICS_RECOMPUTED_AND_MATCHED'}},
    historicExecutableIdentity: 'VERIFIED_ORIGINAL', storedPcmEvaluation: 'PCM_METRICS_RECOMPUTED_AND_MATCHED',
    publication: 'IMMUTABLE_MANIFEST_REQUIRED', sourceSnapshots: {unchanged: true, beforeSha256: 'c'.repeat(64), afterSha256: 'c'.repeat(64)},
    delivery: {repository: 'puchinya/soraoto_dsl', issue: 7, prUrl: 'https://github.com/puchinya/soraoto_dsl/pull/8',
      prBranch: cli.PR_BRANCH, currentHead: head, worktreeBranch: 'codex/issue-7-pr8-root-cause-review',
      upstreamBranch: `origin/${cli.PR_BRANCH}`}});
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
  const approval = {id: Number(cli.APPROVAL_COMMENT_ID), user: {login: 'puchinya'}, body: '実装・テスト・push・既存PR #8を指示'};
  assert.throws(() => cli.verifyPublicationAuthority({head: 'a'.repeat(40), issue, pr, approval}), /PR_HEAD_OR_BRANCH_MISMATCH/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid, branch: 'unexpected', issue, pr, approval}), /PR_HEAD_OR_BRANCH_MISMATCH/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid, issue: {state: 'CLOSED', labels: []}, pr, approval}), /ISSUE_APPROVAL_MISSING/);
  assert.throws(() => cli.verifyPublicationAuthority({head: pr.headRefOid, issue, pr,
    approval: {...approval, id: 42}}), /APPROVAL_COMMENT_MISMATCH/);
});

test('publication authority queries use rtk gh subcommands without duplicating the gh prefix', () => {
  const issue = {state: 'OPEN', labels: [{name: 'phase:implementation'}]};
  const pr = {state: 'OPEN', headRefName: cli.PR_BRANCH, headRefOid: 'd'.repeat(40), baseRefName: 'main', number: 8,
    body: 'Closes #7'};
  const approval = {id: Number(cli.APPROVAL_COMMENT_ID), user: {login: 'puchinya'}, body: '実装・テスト・push・既存PR #8を指示'};
  const calls = [], checks = [];
  const result = cli.collectAuthority(pr.headRefOid, {
    readGhJson: args => { calls.push(args); return args[0] === 'issue' ? issue : pr; },
    readApproval: () => approval,
    verifyPublicationAuthority: value => checks.push(value)
  });
  assert.deepEqual(calls, [
    ['issue', 'view', '7', '--json', 'state,labels'],
    ['pr', 'view', '8', '--json', 'state,headRefName,headRefOid,baseRefName,number,body,url']
  ]);
  assert.equal(checks.length, 1);
  assert.equal(result.approval, approval);
});

test('publisher immutably writes both copies, reads back exact bytes, and reuses without mtime changes', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const reportText = verifiedReport(), head = 'f'.repeat(40);
  const authorityVerifier = () => true;
  const first = cli.publishReport({reportText, roots: state.roots, head, authorityVerifier, ownerId: 'fixture-owner'});
  assert.equal(first.status, 'PUBLISHED');
  assert.equal(first.readback, 'MATCHED_BOTH_COPIES');
  assert.equal(cli.verifyPublishedReport(state.roots).status, 'PASS');
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  for (const name of ['report.json', 'manifest.json']) {
    assert.deepEqual(fs.readFileSync(path.join(primary, name)), fs.readFileSync(path.join(secondary, name)));
  }
  const beforeMtime = statTree([primary, secondary]);
  const retry = cli.publishReport({reportText, roots: state.roots, head, authorityVerifier, ownerId: 'fixture-owner-2'});
  assert.equal(retry.status, 'REUSED');
  assert.equal(retry.unchangedMtime, true);
  assert.deepEqual(statTree([primary, secondary]), beforeMtime);
});

test('publisher preserves partial output and never overwrites an unknown competing lock', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  fs.mkdirSync(primary, {recursive: true}); fs.mkdirSync(secondary, {recursive: true});
  const partial = Buffer.from('partial report evidence');
  fs.writeFileSync(path.join(primary, 'report.json'), partial, {flag: 'wx'});
  assert.throws(() => cli.publishReport({reportText: verifiedReport('a'.repeat(40)), roots: state.roots, head: 'a'.repeat(40),
    authorityVerifier: () => true}), /PARTIAL_PUBLICATION_PRESERVED/);
  assert.throws(() => cli.verifyPublishedReport(state.roots), /PARTIAL_PUBLICATION_PRESERVED/);
  assert.deepEqual(fs.readFileSync(path.join(primary, 'report.json')), partial);
  fs.unlinkSync(path.join(primary, 'report.json'));
  const lock = Buffer.from('unknown owner lock');
  fs.writeFileSync(path.join(primary, 'publish.lock'), lock, {flag: 'wx'});
  assert.throws(() => cli.publishReport({reportText: verifiedReport('a'.repeat(40)), roots: state.roots, head: 'a'.repeat(40),
    authorityVerifier: () => true}), /EEXIST/);
  assert.deepEqual(fs.readFileSync(path.join(primary, 'publish.lock')), lock);
  assert.deepEqual(fs.readdirSync(secondary), []);
});

test('publisher keeps partial dual-copy bytes and owned locks after a simulated secondary write failure', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const primary = state.roots.offline.primary, secondary = state.roots.offline.secondary;
  assert.throws(() => cli.publishReport({reportText: verifiedReport('b'.repeat(40)), roots: state.roots, head: 'b'.repeat(40),
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

test('publisher rejects an incomplete report before creating output roots', t => {
  const state = tempState(); t.after(() => fs.rmSync(state.base, {recursive: true, force: true}));
  const blocked = core.buildReport({outcome: 'EVIDENCE_UNVERIFIABLE'});
  assert.throws(() => cli.publishReport({reportText: blocked, roots: state.roots, head: 'a'.repeat(40), authorityVerifier: () => true}), /REPORT_INCOMPLETE/);
  assert.equal(fs.existsSync(state.roots.offline.primary), false);
  assert.equal(fs.existsSync(state.roots.offline.secondary), false);
});
