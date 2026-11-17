'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const search=require('./stage3e-search-core.cjs');
const v8=require('./stage3e-performance-verifier-continuation-v8.cjs');
const v9=require('./stage3e-performance-verifier-continuation-v9.cjs');

assert.equal(v9.PARENT_RELATIVE,v8.RELATIVE);
assert.equal(v9.PARENT_SHA256,'1073fc1b2095a5e0668728f0a707aa4d21518e116a722fdf23a5bf5b82d1155d');
assert.equal(v9.PARENT_ACCEPTED_COMMIT,'0d4a2454b79f78a8ccd4144fffd9ede154229c0f');
assert(v9.REQUIRED_CHANGED_PATHS.every(item=>v9.ALLOWED_CHANGED_PATHS.includes(item)));
assert(!v9.ALLOWED_CHANGED_PATHS.some(item=>item.endsWith('capture-supersynth-stage3e-matrix.cjs')));
assert.equal(v9.recoveryDecision({decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'}).decision,
  'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE');
assert.throws(()=>v9.recoveryDecision({decision:'UNKNOWN'}),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const root=search.ROOT;
const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const identity={diagnosticWasmSha256:v9.STAGE3E_WASM_SHA256,candidateId:'stage2n-r3-candidate-01',
  sourcePluginSha256:'a'.repeat(64),configSha256:'b'.repeat(64),profileSha256:'c'.repeat(64),presetsSha256:'d'.repeat(64),
  referenceFixtureSha256:'e'.repeat(64),captureHelperSha256:'f'.repeat(64),sampleRate:48000,durationMs:380,
  preset:'concert_grand',stage2mFactorMask:3,stage3eResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true};
const testResults=[{command:'stage3e-performance-verifier-continuation-v9.test.cjs',status:'PASS',outputSha256:'1'.repeat(64)}];
const expected={root,parentSha256:v9.PARENT_SHA256,acceptedCommit,paths:[...v9.REQUIRED_CHANGED_PATHS].sort(),
  diffSha256:'2'.repeat(64),changedFileSha256:Object.fromEntries(v9.REQUIRED_CHANGED_PATHS.map(item=>[item,'3'.repeat(64)])),
  stage3eAcousticIdentity:identity};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  parentRelative:v9.PARENT_RELATIVE,parentSha256:expected.parentSha256,parentAcceptedCommit:v9.PARENT_ACCEPTED_COMMIT,acceptedCommit,
  allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,changedFileSha256:expected.changedFileSha256,
  stage3eAcousticIdentity:identity,stage3eWasmSha256:v9.STAGE3E_WASM_SHA256,testResults,
  testResultsSha256:v9.sha256(v9.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
assert.equal(v9.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
for(const change of [{parentSha256:'0'.repeat(64)},{parentAcceptedCommit:'f'.repeat(40)},
  {stage3eWasmSha256:'0'.repeat(64)},{acousticRenders:1},{builds:1},
  {testResults:[{command:'bad',status:'FAIL',outputSha256:'4'.repeat(64)}]}])
  assert.throws(()=>v9.validateRecord({...record,...change},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const parent=v9.readAndValidateParent(root,v9.rootsFor(root));
assert.equal(parent.sha256,v9.PARENT_SHA256,'the v8 record remains the immutable parent');
assert.equal(parent.record.acceptedCommit,v9.PARENT_ACCEPTED_COMMIT);
console.log('Stage3E performance verifier continuation v9 tests passed');
