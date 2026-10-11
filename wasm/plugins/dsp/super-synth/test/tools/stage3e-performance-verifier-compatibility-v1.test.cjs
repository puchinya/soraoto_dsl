'use strict';

const assert=require('node:assert/strict');
const compatibility=require('./stage3e-performance-verifier-compatibility-v1.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const oldPins={captureHelper:'a'.repeat(64),generation2Runner:'b'.repeat(64)};
const currentPins={captureHelper:'a'.repeat(64),generation2Runner:'c'.repeat(64)};
const effective={runner:'d'.repeat(64),validator:'e'.repeat(64)};
const baselineFiles={'run-stage3e-generation2.cjs':'b'.repeat(64)};
const originalEffective={runner:null,validator:null};
const acousticIdentity={candidateId:'stage2n-r3-candidate-01',diagnosticWasmSha256:'f'.repeat(64),configSha256:'1'.repeat(64)};
const paths=['wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs'];
const testResults=compatibility.DEFAULT_TEST_RESULTS;
const record={
  schemaVersion:1,
  kind:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY',
  decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
  originalLocalCommit:compatibility.ORIGINAL_LOCAL_COMMIT,
  acceptedCommit:'2'.repeat(40),
  parentV10_9AttestationSha256:compatibility.PARENT_V10_9_SHA256,
  baselineV10_12AttestationSha256:compatibility.BASELINE_V10_12_SHA256,
  baselineVerifierFiles:baselineFiles,
  originalSearchManifestSha256:'27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095',
  originalSearchCompatibilityV3Sha256:compatibility.ORIGINAL_V3_SHA256,
  originalPinnedExecutorHashes:oldPins,
  acceptedPinnedExecutorHashes:currentPins,
  currentPinnedExecutorHashes:currentPins,
  originalEffectiveVerifierBlobHashes:originalEffective,
  effectiveVerifierBlobHashes:effective,
  acceptedVerifierBlobHashes:effective,
  allowedVerifierOnlyPaths:paths,
  allowedVerifierOnlyDiffSha256:'3'.repeat(64),
  stage3eAcousticIdentity:acousticIdentity,
  testResults,
  testResultsSha256:compatibility.buildTestReportSha256(testResults),
  primarySecondaryIntegrity:'PASS'
};
function context(changes={}){
  return {head:'4'.repeat(40),originalPinnedHashes:oldPins,currentPinnedHashes:currentPins,
    acceptedPinnedHashes:currentPins,currentVerifierHashes:effective,allowedDiffPaths:paths,
    allowedDiffSha256:record.allowedVerifierOnlyDiffSha256,currentAcousticIdentity:acousticIdentity,
    originalAcousticIdentity:acousticIdentity,parentAttestationSha256:compatibility.PARENT_V10_9_SHA256,
    baselineVerifierFiles:baselineFiles,originalEffectiveVerifierBlobHashes:originalEffective,
    testResultsSha256:record.testResultsSha256,ancestorCheck:()=>true,...changes};
}

assert.equal(compatibility.validateRecord(record,context()).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
assert.throws(()=>compatibility.validateRecord({...record,parentV10_9AttestationSha256:'0'.repeat(64)},context()),
  /sidecar identity or predecessor mismatch/);
assert.throws(()=>compatibility.validateRecord({...record,baselineV10_12AttestationSha256:'0'.repeat(64)},context()),
  /sidecar identity or predecessor mismatch/);
assert.throws(()=>compatibility.validateRecord({...record,originalSearchCompatibilityV3Sha256:'0'.repeat(64)},context()),
  /sidecar identity or predecessor mismatch/);
assert.throws(()=>compatibility.validateRecord(record,context({originalEffectiveVerifierBlobHashes:{...originalEffective,runner:'9'.repeat(64)}})),
  /original effective verifier blobs differ/);
assert.throws(()=>compatibility.validateRecord(record,context({currentPinnedHashes:{...currentPins,generation2Runner:'9'.repeat(64)}})),
  /current pinned files or accepted v10-12 verifier baseline changed/);
assert.throws(()=>compatibility.validateRecord(record,context({allowedDiffPaths:['wasm/plugins/dsp/super-synth/src/plugin.c']})),
  /changed source set or exact verifier diff differs/);
assert.throws(()=>compatibility.validateRecord({...record,testResultsSha256:'0'.repeat(64)},context()),
  /verification test report SHA mismatch/);
assert.throws(()=>compatibility.validateRecord({...record,testResults:[{command:'unrun.cjs',status:'PASS'}]},context()),
  /verification test report command set differs/);
assert.throws(()=>compatibility.validateRecord(record,context({ancestorCheck:()=>false})),
  /accepted verifier commit is not an ancestor/);
assert.throws(()=>compatibility.validateRecord(record,context({currentAcousticIdentity:{...acousticIdentity,diagnosticWasmSha256:'0'.repeat(64)}})),
  /Stage3E acoustic identity changed/);

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-performance-compatibility-lock-'));
  try{
    execFileSync('rtk',['git','init','--quiet'],{cwd:root});
    const common=execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();
    const lock=path.join(common,'stage3e-master-execution.lock');
    fs.writeFileSync(lock,'active');
    assert.throws(()=>compatibility.assertNoActiveWriter(root),/BLOCKED_STAGE3E_ACTIVE_WRITER/);
    assert.equal(fs.readFileSync(lock,'utf8'),'active','active writer lock is preserved');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('PASS Stage3E performance verifier compatibility identity and fail-closed validation');
