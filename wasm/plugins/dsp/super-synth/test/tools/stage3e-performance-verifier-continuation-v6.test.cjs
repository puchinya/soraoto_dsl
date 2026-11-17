'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const search=require('./stage3e-search-core.cjs');
const v6=require('./stage3e-performance-verifier-continuation-v6.cjs');

assert.equal(v6.PARENT_RELATIVE,'performance-verifier-compatibility-v5.json');
assert.equal(v6.PARENT_SHA256,'bdfdb267f38dcc5b7430ec96d1f4a19176f80fcd5238c27aae7f7e0adc30307f');
assert.equal(v6.PARENT_ACCEPTED_COMMIT,'672dcd1e18770247af9a924760072a87bf3b4a83');
assert(v6.REQUIRED_CHANGED_PATHS.every(item=>v6.ALLOWED_CHANGED_PATHS.includes(item)));
assert(!v6.ALLOWED_CHANGED_PATHS.some(item=>item.endsWith('capture-supersynth-stage3e-matrix.cjs')));

const root=search.ROOT;
const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const identity={diagnosticWasmSha256:v6.STAGE3E_WASM_SHA256,candidateId:'stage2n-r3-candidate-01',
  sourcePluginSha256:'a'.repeat(64),configSha256:'b'.repeat(64),profileSha256:'c'.repeat(64),presetsSha256:'d'.repeat(64),
  referenceFixtureSha256:'e'.repeat(64),captureHelperSha256:'f'.repeat(64),sampleRate:48000,durationMs:380,
  preset:'concert_grand',stage2mFactorMask:3,stage3eResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true};
const testResults=[{command:'stage3e-performance-verifier-continuation-v6.test.cjs',status:'PASS',outputSha256:'1'.repeat(64)}];
const expected={root,parentSha256:v6.PARENT_SHA256,acceptedCommit,paths:[...v6.REQUIRED_CHANGED_PATHS].sort(),
  diffSha256:'2'.repeat(64),changedFileSha256:Object.fromEntries(v6.REQUIRED_CHANGED_PATHS.map(item=>[item,'3'.repeat(64)])),
  stage3eAcousticIdentity:identity};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  parentRelative:v6.PARENT_RELATIVE,parentSha256:expected.parentSha256,parentAcceptedCommit:v6.PARENT_ACCEPTED_COMMIT,acceptedCommit,
  allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,changedFileSha256:expected.changedFileSha256,
  stage3eAcousticIdentity:identity,stage3eWasmSha256:v6.STAGE3E_WASM_SHA256,testResults,
  testResultsSha256:v6.sha256(v6.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
assert.equal(v6.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
for(const change of [{parentSha256:'0'.repeat(64)},{parentAcceptedCommit:'f'.repeat(40)},
  {stage3eWasmSha256:'0'.repeat(64)},{acousticRenders:1},{builds:1},
  {testResults:[{command:'bad',status:'FAIL',outputSha256:'4'.repeat(64)}]}])
  assert.throws(()=>v6.validateRecord({...record,...change},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const parent=v6.readAndValidateParent(root,v6.rootsFor(root));
assert.equal(parent.sha256,v6.PARENT_SHA256,'the v5 record remains the immutable parent');
assert.equal(parent.record.acceptedCommit,v6.PARENT_ACCEPTED_COMMIT);
console.log('Stage3E performance verifier continuation v6 tests passed');
