'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const search=require('./stage3e-search-core.cjs');
const continuation=require('./stage3e-performance-verifier-continuation-v2.cjs');

const root=search.ROOT;
const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const parentPinned={captureHelper:'a'.repeat(64),generation2Runner:'b'.repeat(64),generation2Core:'c'.repeat(64),
  searchCore:'d'.repeat(64),preflight:'e'.repeat(64),evidenceValidator:'f'.repeat(64)};
const currentPinned={...parentPinned,generation2Runner:'1'.repeat(64),preflight:'2'.repeat(64),evidenceValidator:'3'.repeat(64)};
const pinnedChanges=continuation.verifierPinnedChanges(parentPinned,currentPinned);
assert.deepEqual(pinnedChanges.map(item=>item.key),['evidenceValidator','generation2Runner','preflight']);
assert.throws(()=>continuation.verifierPinnedChanges(parentPinned,{...currentPinned,captureHelper:'4'.repeat(64)}),/pinned non-verifier identity changed/);
assert.throws(()=>continuation.verifierPinnedChanges(parentPinned,{...currentPinned,generation2Core:'5'.repeat(64)}),/pinned non-verifier identity changed/);
assert.throws(()=>continuation.verifierPinnedChanges(parentPinned,{...currentPinned,preflight:parentPinned.preflight}),/reviewed pinned-file change set/);
const expected={root,parentSha256:continuation.PARENT_SHA256,acceptedCommit,paths:['stage3e-preflight.cjs'],
  diffSha256:'1'.repeat(64),runtimeVerifierHashes:{'stage3e-preflight.cjs':'2'.repeat(64)},
  parentPinnedExecutorHashesSha256:continuation.sha256(continuation.jsonBytes(parentPinned)),
  verifierPinnedHashChanges:pinnedChanges,currentPinnedExecutorHashes:currentPinned,
  stage3eAcousticIdentity:{diagnosticWasmSha256:continuation.STAGE3E_WASM_SHA256}};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION',
  decision:'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE',parentRelative:continuation.PARENT_RELATIVE,
  parentSha256:expected.parentSha256,parentAcceptedCommit:continuation.PARENT_ACCEPTED_COMMIT,acceptedCommit,
  allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,
  parentPinnedExecutorHashesSha256:expected.parentPinnedExecutorHashesSha256,
  verifierPinnedHashChanges:expected.verifierPinnedHashChanges,
  runtimeVerifierHashes:expected.runtimeVerifierHashes,currentPinnedExecutorHashes:expected.currentPinnedExecutorHashes,
  stage3eAcousticIdentity:expected.stage3eAcousticIdentity,captureHelperSha256:currentPinned.captureHelper,
  testResults:continuation.DEFAULT_TEST_RESULTS,primarySecondaryIntegrity:'PASS'};
record.testResultsSha256=continuation.sha256(continuation.jsonBytes(record.testResults));

assert.equal(continuation.validateRecord(record,expected).decision,record.decision);
assert.throws(()=>continuation.validateRecord({...record,parentSha256:'0'.repeat(64)},expected),/does not match its immutable predecessor/);
assert.throws(()=>continuation.validateRecord({...record,allowedVerifierOnlyDiffSha256:'0'.repeat(64)},expected),/does not match its immutable predecessor/);
assert.throws(()=>continuation.validateRecord({...record,verifierPinnedHashChanges:[]},expected),/does not match its immutable predecessor/);
assert.throws(()=>continuation.validateRecord({...record,runtimeVerifierHashes:{...record.runtimeVerifierHashes,'stage3e-preflight.cjs':'0'.repeat(64)}},expected),/does not match its immutable predecessor/);
assert.throws(()=>continuation.validateRecord({...record,stage3eAcousticIdentity:{diagnosticWasmSha256:'0'.repeat(64)}},expected),/does not match its immutable predecessor/);
assert.equal(continuation.ALLOWED_CHANGED_PATHS.includes('wasm/plugins/dsp/super-synth/src/plugin.c'),false);
assert.equal(continuation.RUNTIME_PATHS.includes('wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs'),true);
assert.equal(continuation.DEFAULT_TEST_RESULTS.every(item=>item.status==='PASS'),true);
assert.equal(continuation.rootsFor(root).primary.endsWith(path.join('generation-2','search-v1')),true);
process.stdout.write('Stage3E performance verifier continuation v2 tests passed\n');
