'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const v12=require('./stage3e-performance-verifier-continuation-v12.cjs');

function git(root,args,encoding='utf8'){
  return execFileSync('rtk',['git',...args],{cwd:root,encoding,stdio:['ignore','pipe','pipe']}).trim();
}
function commit(root,message){
  git(root,['add','-f','--','.']);
  git(root,['-c','user.name=Stage3E verifier test','-c','user.email=stage3e-test@example.invalid','commit','--quiet','-m',message]);
  return git(root,['rev-parse','HEAD']);
}

assert.equal(v12.PARENT_SHA256,'e35a9dfa984419e892a6f408c6709f236fee79d273865da5904147d351ccb77d');
assert.equal(v12.PARENT_ACCEPTED_COMMIT,'424b7b3552b566b5e7a78140c3f3819575414cc5');
assert.equal(v12.CHECKPOINT_VERIFIER_SHA256,'dcf2f297cc3e197df4d84ec7f9acc671aeae80b330ede76618eef2451a1341ca');
assert.notEqual(v12.sha256(v12.jsonBytes([{status:'PASS'}])),
  v12.sha256(Buffer.from(JSON.stringify([{status:'PASS'}])+'\n')),
  'v12 result hashing uses the validator canonical pretty-JSON representation');

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v12-source-'));
  try{
    git(root,['init','--quiet']);
    git(root,['config','user.name','Stage3E verifier test']);
    git(root,['config','user.email','stage3e-test@example.invalid']);
    const file=path.join(root,v12.INCREMENTAL_VERIFIER_PATH);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'approved incremental source\n');
    const approved=commit(root,'approved incremental source'),approvedSha=v12.sha256(Buffer.from('approved incremental source\n'));
    assert.equal(v12.validateIncrementalSource({root,acceptedCommit:approved,expectedSha256:approvedSha}).sha256,approvedSha);
    fs.writeFileSync(file,'tampered incremental source\n');
    assert.throws(()=>v12.validateIncrementalSource({root,acceptedCommit:approved,expectedSha256:approvedSha}),
      /current incremental verifier differs from its authorized source hash/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v12-record-'));
  try{
    git(root,['init','--quiet']);git(root,['config','user.name','Stage3E verifier test']);git(root,['config','user.email','stage3e-test@example.invalid']);
    fs.writeFileSync(path.join(root,'seed.txt'),'seed\n');
    const accepted=commit(root,'v12 accepted source');
    const identity={diagnosticWasmSha256:v12.STAGE3E_WASM_SHA256};
    const testResults=[{command:'v12-test',status:'PASS',outputSha256:'f'.repeat(64)}];
    const expected={root,acceptedCommit:accepted,paths:v12.REQUIRED_CHANGED_PATHS,
      diffSha256:'e'.repeat(64),verifierFileSha256:Object.fromEntries(v12.REQUIRED_CHANGED_PATHS.map(item=>[item,'a'.repeat(64)])),
      stage3eAcousticIdentity:identity};
    const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V12',
      decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:'performance-verifier-compatibility-v11.json',
      parentSha256:v12.PARENT_SHA256,parentAcceptedCommit:v12.PARENT_ACCEPTED_COMMIT,
      checkpointFixCommit:v12.CHECKPOINT_FIX_COMMIT,incrementalVerifierPath:v12.INCREMENTAL_VERIFIER_PATH,
      incrementalVerifierSha256:v12.CHECKPOINT_VERIFIER_SHA256,acceptedCommit:accepted,
      allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,
      verifierFileSha256:expected.verifierFileSha256,stage3eAcousticIdentity:identity,
      stage3eWasmSha256:v12.STAGE3E_WASM_SHA256,testResults,
      testResultsSha256:v12.sha256(v12.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
    assert.equal(v12.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE');
    assert.throws(()=>v12.validateRecord({...record,parentSha256:'0'.repeat(64)},expected),/v12 source attestation differs/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('PASS Stage3E v12 chains immutable v11 evidence and binds verifier source and canonical test hashes');
