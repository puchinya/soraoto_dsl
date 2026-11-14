'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const search=require('./stage3e-search-core.cjs');
const v4=require('./stage3e-performance-verifier-continuation-v4.cjs');
const acoustic=require('./stage3e-performance-verifier-compatibility-v1.cjs');

assert.equal(v4.PARENT_RELATIVE,'performance-verifier-compatibility-v3.json');
assert.equal(v4.PARENT_SHA256,'f1425e17e25b0338b504cedacf54e45be703581fc87277ede47540e39a02a487');
assert.equal(v4.PARENT_ACCEPTED_COMMIT,'d055c8c3a21b020a89f0a19de8fad1b7055c192e');
assert(v4.REQUIRED_CHANGED_PATHS.every(item=>v4.ALLOWED_CHANGED_PATHS.includes(item)));
assert(!v4.ALLOWED_CHANGED_PATHS.some(item=>item.endsWith('capture-supersynth-stage3e-matrix.cjs')));

const root=search.ROOT;
const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const identity={diagnosticWasmSha256:v4.STAGE3E_WASM_SHA256,candidateId:'stage2n-r3-candidate-01',
  sourcePluginSha256:'a'.repeat(64),configSha256:'b'.repeat(64),profileSha256:'c'.repeat(64),presetsSha256:'d'.repeat(64),
  referenceFixtureSha256:'e'.repeat(64),captureHelperSha256:'f'.repeat(64),sampleRate:48000,durationMs:380,
  preset:'concert_grand',stage2mFactorMask:3,stage3eResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true};
const testResults=[{command:'zero-render.test.cjs',status:'PASS',outputSha256:'1'.repeat(64)}];
const expected={root,parentSha256:v4.PARENT_SHA256,acceptedCommit,paths:[...v4.REQUIRED_CHANGED_PATHS].sort(),
  diffSha256:'2'.repeat(64),changedFileSha256:Object.fromEntries(v4.REQUIRED_CHANGED_PATHS.map(item=>[item,'3'.repeat(64)])),
  stage3eAcousticIdentity:identity};
const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  parentRelative:v4.PARENT_RELATIVE,parentSha256:expected.parentSha256,parentAcceptedCommit:v4.PARENT_ACCEPTED_COMMIT,acceptedCommit,
  allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,changedFileSha256:expected.changedFileSha256,
  stage3eAcousticIdentity:identity,stage3eWasmSha256:v4.STAGE3E_WASM_SHA256,testResults,
  testResultsSha256:v4.sha256(v4.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
assert.equal(v4.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
for(const change of [
  {parentSha256:'0'.repeat(64)},
  {allowedVerifierOnlyDiffSha256:'0'.repeat(64)},
  {changedFileSha256:{...record.changedFileSha256,[expected.paths[0]]:'0'.repeat(64)}},
  {stage3eWasmSha256:'0'.repeat(64)},
  {acousticRenders:1},
  {testResults:[{command:'not-passed',status:'FAIL',outputSha256:'4'.repeat(64)}]}
]) assert.throws(()=>v4.validateRecord({...record,...change},expected),/BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY/);

const roots=v4.rootsFor(root);
const parent=v4.readAndValidateParent(root,roots);
assert.equal(parent.sha256,v4.PARENT_SHA256,'v3 remains an immutable verified parent');
assert.equal(acoustic.currentStage3eAcousticIdentity(root).diagnosticWasmSha256,v4.STAGE3E_WASM_SHA256);

console.log('Stage3E performance verifier continuation v4 tests passed');
