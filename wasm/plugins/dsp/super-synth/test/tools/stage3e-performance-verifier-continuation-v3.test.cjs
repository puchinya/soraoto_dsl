'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const search=require('./stage3e-search-core.cjs');
const followup=require('./stage3e-performance-verifier-continuation-v3.cjs');

assert.equal(followup.PARENT_SHA256,'64283b303effc386719926facf0d6abea03e6135accee38eee1f19c0f172b092');
assert.equal(followup.PARENT_ACCEPTED_COMMIT,'d1ced58e0f1a80e10a0269f7e5b489de1b79e2b3');
assert(followup.ALLOWED_CHANGED_PATHS.includes('wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs'));
assert(followup.ALLOWED_CHANGED_PATHS.includes('wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v3.cjs'));
assert(!followup.ALLOWED_CHANGED_PATHS.includes('wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs'));

const root=search.ROOT,identity={diagnosticWasmSha256:followup.STAGE3E_WASM_SHA256,captureHelperSha256:'a'.repeat(64)};
const expected={root,parentSha256:followup.PARENT_SHA256,acceptedCommit:followup.PARENT_ACCEPTED_COMMIT,
  paths:['wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs'],
  diffSha256:'b'.repeat(64),changedFileSha256:{'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs':'c'.repeat(64)},
  stage3eAcousticIdentity:identity};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  parentRelative:followup.PARENT_RELATIVE,parentSha256:expected.parentSha256,parentAcceptedCommit:followup.PARENT_ACCEPTED_COMMIT,
  acceptedCommit:expected.acceptedCommit,allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,
  changedFileSha256:expected.changedFileSha256,stage3eAcousticIdentity:identity,stage3eWasmSha256:followup.STAGE3E_WASM_SHA256,
  testResults:followup.DEFAULT_TEST_RESULTS,testResultsSha256:followup.sha256(followup.jsonBytes(followup.DEFAULT_TEST_RESULTS)),
  acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
assert.equal(followup.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
assert.throws(()=>followup.validateRecord({...record,stage3eWasmSha256:'0'.repeat(64)},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);
assert.throws(()=>followup.validateRecord({...record,changedFileSha256:{...record.changedFileSha256,[expected.paths[0]]:'0'.repeat(64)}},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);
assert(path.isAbsolute(root));

console.log('Stage3E performance verifier continuation v3 tests passed');
