'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const search=require('./stage3e-search-core.cjs');
const v7=require('./stage3e-performance-verifier-continuation-v7.cjs');

assert.equal(v7.PARENT_RELATIVE,'performance-verifier-compatibility-v6.json');
assert.equal(v7.PARENT_SHA256,'963cc8a52a9c8a24eb90f89dbbf393b7dda94ca3ec64560d106f56414be8cf39');
assert.equal(v7.PARENT_ACCEPTED_COMMIT,'3a2e8487ae51ab1952b76e18e65ffca8a51c74b3');
assert(v7.REQUIRED_CHANGED_PATHS.every(item=>v7.ALLOWED_CHANGED_PATHS.includes(item)));
assert(!v7.ALLOWED_CHANGED_PATHS.some(item=>item.endsWith('capture-supersynth-stage3e-matrix.cjs')));
assert.equal(v7.recoveryDecision({decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'}).decision,
  'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE');
assert.throws(()=>v7.recoveryDecision({decision:'UNKNOWN'}),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const root=search.ROOT;
const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const identity={diagnosticWasmSha256:v7.STAGE3E_WASM_SHA256,candidateId:'stage2n-r3-candidate-01',
  sourcePluginSha256:'a'.repeat(64),configSha256:'b'.repeat(64),profileSha256:'c'.repeat(64),presetsSha256:'d'.repeat(64),
  referenceFixtureSha256:'e'.repeat(64),captureHelperSha256:'f'.repeat(64),sampleRate:48000,durationMs:380,
  preset:'concert_grand',stage2mFactorMask:3,stage3eResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true};
const testResults=[{command:'stage3e-performance-verifier-continuation-v7.test.cjs',status:'PASS',outputSha256:'1'.repeat(64)}];
const expected={root,parentSha256:v7.PARENT_SHA256,acceptedCommit,paths:[...v7.REQUIRED_CHANGED_PATHS].sort(),
  diffSha256:'2'.repeat(64),changedFileSha256:Object.fromEntries(v7.REQUIRED_CHANGED_PATHS.map(item=>[item,'3'.repeat(64)])),
  stage3eAcousticIdentity:identity};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  parentRelative:v7.PARENT_RELATIVE,parentSha256:expected.parentSha256,parentAcceptedCommit:v7.PARENT_ACCEPTED_COMMIT,acceptedCommit,
  allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,changedFileSha256:expected.changedFileSha256,
  stage3eAcousticIdentity:identity,stage3eWasmSha256:v7.STAGE3E_WASM_SHA256,testResults,
  testResultsSha256:v7.sha256(v7.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
assert.equal(v7.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
for(const change of [{parentSha256:'0'.repeat(64)},{parentAcceptedCommit:'f'.repeat(40)},
  {stage3eWasmSha256:'0'.repeat(64)},{acousticRenders:1},{builds:1},
  {testResults:[{command:'bad',status:'FAIL',outputSha256:'4'.repeat(64)}]}])
  assert.throws(()=>v7.validateRecord({...record,...change},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const parent=v7.readAndValidateParent(root,v7.rootsFor(root));
assert.equal(parent.sha256,v7.PARENT_SHA256,'the v6 record remains the immutable parent');
assert.equal(parent.record.acceptedCommit,v7.PARENT_ACCEPTED_COMMIT);
console.log('Stage3E performance verifier continuation v7 tests passed');
