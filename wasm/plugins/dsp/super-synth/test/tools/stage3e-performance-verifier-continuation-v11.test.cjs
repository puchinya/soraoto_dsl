'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const v11=require('./stage3e-performance-verifier-continuation-v11.cjs');
const v10=require('./stage3e-performance-verifier-continuation-v10.cjs');

function git(root,args,encoding='utf8'){
  return execFileSync('rtk',['git',...args],{cwd:root,encoding,stdio:['ignore','pipe','pipe']}).trim();
}
function commit(root,message){
  git(root,['add','.']);
  git(root,['-c','user.name=Stage3E verifier test','-c','user.email=stage3e-test@example.invalid','commit','--quiet','-m',message]);
  return git(root,['rev-parse','HEAD']);
}

assert.equal(v11.V10_SHA256,'2784426827df766629cee9dad975d512f5c33be271ba5baf270568a5b5476b45');
assert.equal(v11.CHECKPOINT_FIX_COMMIT,'b40cc7c67c16370b2bcecafb67061a1e254848ca');
assert.equal(v11.CHECKPOINT_VERIFIER_SHA256,'dcf2f297cc3e197df4d84ec7f9acc671aeae80b330ede76618eef2451a1341ca');
{
  const delegated={decision:'source-guard-delegated'};
  const original=v11.runtimeContext;
  try{
    v11.runtimeContext=()=>delegated;
    assert.equal(v10.runtimeContext({}),delegated,'direct v10 runtime calls cannot bypass the v11 source guard');
  }finally{v11.runtimeContext=original;}
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v11-source-'));
  try{
    git(root,['init','--quiet']);
    git(root,['config','user.name','Stage3E verifier test']);
    git(root,['config','user.email','stage3e-test@example.invalid']);
    const relative=v11.INCREMENTAL_VERIFIER_PATH;
    const file=path.join(root,relative);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,'approved source\n');
    const original=commit(root,'approved baseline');
    const originalSha=v11.sha256(Buffer.from('approved source\n'));
    assert.equal(v11.validateIncrementalSource({root,acceptedCommit:original,expectedSha256:originalSha}).sha256,originalSha,
      'the source hash at the approved commit is accepted');

    fs.writeFileSync(file,'approved source!\n');
    assert.throws(()=>v11.validateIncrementalSource({root,acceptedCommit:original,expectedSha256:originalSha}),
      /current incremental verifier differs from its authorized source hash/,
      'v10-only authorization blocks a one-byte verifier mutation');
    const fixCommit=commit(root,'approved verifier source update');
    const fixSha=v11.sha256(Buffer.from('approved source!\n'));
    assert.equal(v11.validateIncrementalSource({root,acceptedCommit:fixCommit,expectedSha256:fixSha}).sha256,fixSha,
      'the exact authorized source blob is accepted');

    fs.writeFileSync(path.join(root,'notes.md'),'documentation only\n');
    commit(root,'documentation only');
    assert.equal(v11.validateIncrementalSource({root,acceptedCommit:fixCommit,expectedSha256:fixSha}).sha256,fixSha,
      'a later documentation-only commit preserves the accepted source blob');
    const acceptedFileSha=v11.validateAcceptedVerifierFiles({root,acceptedCommit:fixCommit,
      paths:[relative],expectedHashes:{[relative]:fixSha}});
    assert.equal(acceptedFileSha[relative],fixSha,'a later documentation-only commit preserves verifier-path bindings');
    fs.writeFileSync(file,'tampered after documentation\n');
    assert.throws(()=>v11.validateAcceptedVerifierFiles({root,acceptedCommit:fixCommit,
      paths:[relative],expectedHashes:{[relative]:fixSha}}),/current verifier files differ from accepted commit/);
    assert.throws(()=>v11.validateIncrementalSource({root,acceptedCommit:fixCommit,expectedSha256:'0'.repeat(64)}),
      /incremental verifier authorization does not match the accepted commit/,
      'a mismatched authorization is rejected');

const identity={diagnosticWasmSha256:v11.STAGE3E_WASM_SHA256};
    const testResults=[{command:'v11-test',status:'PASS',outputSha256:'f'.repeat(64)}];
    const expected={root,acceptedCommit:fixCommit,paths:[],diffSha256:'e'.repeat(64),verifierFileSha256:{},
      stage3eAcousticIdentity:identity};
    const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY',
      decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:'performance-verifier-compatibility-v10.json',
      parentSha256:v11.V10_SHA256,parentAcceptedCommit:v11.V10_ACCEPTED_COMMIT,
      checkpointFixCommit:v11.CHECKPOINT_FIX_COMMIT,incrementalVerifierPath:relative,
      incrementalVerifierSha256:v11.CHECKPOINT_VERIFIER_SHA256,acceptedCommit:fixCommit,
      allowedChangedPaths:[],allowedVerifierOnlyDiffSha256:expected.diffSha256,verifierFileSha256:{},
      stage3eAcousticIdentity:identity,stage3eWasmSha256:v11.STAGE3E_WASM_SHA256,
      testResults,testResultsSha256:v11.sha256(v11.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
    assert.equal(v11.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
    assert.throws(()=>v11.validateRecord({...record,incrementalVerifierSha256:'0'.repeat(64)},expected),
      /v11 source attestation differs/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('PASS Stage3E v11 verifier source identity binding, tamper rejection, and documentation-only continuation');
