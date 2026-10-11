'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const search=require('./stage3e-search-core.cjs');
const v5=require('./stage3e-performance-verifier-continuation-v5.cjs');

assert.equal(v5.PARENT_RELATIVE,'performance-verifier-compatibility-v4.json');
assert.equal(v5.PARENT_SHA256,'2dbc65caef3ea70d9293cf32aec9a043d533e43423f7024daa263b73a835cc28');
assert.equal(v5.PARENT_ACCEPTED_COMMIT,'f3caae588228cd535ba71aea23ccb4e6138d8147');
assert(v5.REQUIRED_CHANGED_PATHS.every(item=>v5.ALLOWED_CHANGED_PATHS.includes(item)));
assert(!v5.ALLOWED_CHANGED_PATHS.some(item=>item.endsWith('capture-supersynth-stage3e-matrix.cjs')));
assert.equal(v5.recoveryDecision('STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'),
  'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE');
assert.throws(()=>v5.recoveryDecision('UNKNOWN'),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const root=search.ROOT;
const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const identity={diagnosticWasmSha256:v5.STAGE3E_WASM_SHA256,candidateId:'stage2n-r3-candidate-01',
  sourcePluginSha256:'a'.repeat(64),configSha256:'b'.repeat(64),profileSha256:'c'.repeat(64),presetsSha256:'d'.repeat(64),
  referenceFixtureSha256:'e'.repeat(64),captureHelperSha256:'f'.repeat(64),sampleRate:48000,durationMs:380,
  preset:'concert_grand',stage2mFactorMask:3,stage3eResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true};
const results=[{command:'zero-render.test.cjs',status:'PASS',outputSha256:'1'.repeat(64)}];
const expected={root,parentSha256:v5.PARENT_SHA256,acceptedCommit,paths:[...v5.REQUIRED_CHANGED_PATHS],
  diffSha256:'2'.repeat(64),changedFileSha256:{[v5.REQUIRED_CHANGED_PATHS[0]]:'3'.repeat(64)},stage3eAcousticIdentity:identity};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  parentRelative:v5.PARENT_RELATIVE,parentSha256:expected.parentSha256,parentAcceptedCommit:v5.PARENT_ACCEPTED_COMMIT,acceptedCommit,
  allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,changedFileSha256:expected.changedFileSha256,
  stage3eAcousticIdentity:identity,stage3eWasmSha256:v5.STAGE3E_WASM_SHA256,testResults:results,
  testResultsSha256:v5.sha256(v5.jsonBytes(results)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
assert.equal(v5.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
for(const change of [{parentSha256:'0'.repeat(64)},{stage3eWasmSha256:'0'.repeat(64)},{acousticRenders:1},
  {testResults:[{command:'bad',status:'FAIL',outputSha256:'4'.repeat(64)}]}])
  assert.throws(()=>v5.validateRecord({...record,...change},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const parent=v5.readAndValidateParent(root,v5.rootsFor(root));
assert.equal(parent.sha256,v5.PARENT_SHA256,'the v4 record remains the immutable parent');
console.log('Stage3E performance verifier continuation v5 tests passed');
