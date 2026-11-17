'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const search=require('./stage3e-search-core.cjs');
const v7=require('./stage3e-performance-verifier-continuation-v7.cjs');
const v8=require('./stage3e-performance-verifier-continuation-v8.cjs');

assert.equal(v8.PARENT_RELATIVE,v7.RELATIVE);
assert.equal(v8.PARENT_SHA256,'e055f44c632b5eea57b4a4e1f12fbb9ff09f3d267687cba1c86882e6e587dba1');
assert.equal(v8.PARENT_ACCEPTED_COMMIT,'1f88603e14176e2931afdbd96b29ddfd6b28a27a');
assert(v8.REQUIRED_CHANGED_PATHS.every(item=>v8.ALLOWED_CHANGED_PATHS.includes(item)));
assert(!v8.ALLOWED_CHANGED_PATHS.some(item=>item.endsWith('capture-supersynth-stage3e-matrix.cjs')));
assert.equal(v8.recoveryDecision({decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'}).decision,
  'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE');
assert.throws(()=>v8.recoveryDecision({decision:'UNKNOWN'}),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const root=search.ROOT;
const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const identity={diagnosticWasmSha256:v8.STAGE3E_WASM_SHA256,candidateId:'stage2n-r3-candidate-01',
  sourcePluginSha256:'a'.repeat(64),configSha256:'b'.repeat(64),profileSha256:'c'.repeat(64),presetsSha256:'d'.repeat(64),
  referenceFixtureSha256:'e'.repeat(64),captureHelperSha256:'f'.repeat(64),sampleRate:48000,durationMs:380,
  preset:'concert_grand',stage2mFactorMask:3,stage3eResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true};
const testResults=[{command:'stage3e-performance-verifier-continuation-v8.test.cjs',status:'PASS',outputSha256:'1'.repeat(64)}];
const expected={root,parentSha256:v8.PARENT_SHA256,acceptedCommit,paths:[...v8.REQUIRED_CHANGED_PATHS].sort(),
  diffSha256:'2'.repeat(64),changedFileSha256:Object.fromEntries(v8.REQUIRED_CHANGED_PATHS.map(item=>[item,'3'.repeat(64)])),
  stage3eAcousticIdentity:identity};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  parentRelative:v8.PARENT_RELATIVE,parentSha256:expected.parentSha256,parentAcceptedCommit:v8.PARENT_ACCEPTED_COMMIT,acceptedCommit,
  allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,changedFileSha256:expected.changedFileSha256,
  stage3eAcousticIdentity:identity,stage3eWasmSha256:v8.STAGE3E_WASM_SHA256,testResults,
  testResultsSha256:v8.sha256(v8.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
assert.equal(v8.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
for(const change of [{parentSha256:'0'.repeat(64)},{parentAcceptedCommit:'f'.repeat(40)},
  {stage3eWasmSha256:'0'.repeat(64)},{acousticRenders:1},{builds:1},
  {testResults:[{command:'bad',status:'FAIL',outputSha256:'4'.repeat(64)}]}])
  assert.throws(()=>v8.validateRecord({...record,...change},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const parent=v8.readAndValidateParent(root,v8.rootsFor(root));
assert.equal(parent.sha256,v8.PARENT_SHA256,'the v7 record remains the immutable parent');
assert.equal(parent.record.acceptedCommit,v8.PARENT_ACCEPTED_COMMIT);
console.log('Stage3E performance verifier continuation v8 tests passed');
