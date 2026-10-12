'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const verifier=require('./stage3e-performance-verifier-continuation-v15.cjs');
const v14=require('./stage3e-performance-verifier-continuation-v14.cjs');

function git(root,args,encoding='utf8'){
  return execFileSync('rtk',['git',...args],{cwd:root,encoding,stdio:['ignore','pipe','pipe']}).trim();
}
function write(root,relative,bytes){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
function commit(root,message){
  git(root,['add','--','.']);
  git(root,['-c','user.name=Issue 9 verifier test','-c','user.email=issue9-test@example.invalid','commit','--quiet','-m',message]);
  return git(root,['rev-parse','HEAD']);
}
function recordFor(root,acceptedCommit){
  const inherited='wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v14.cjs';
  const hashes=Object.fromEntries([...verifier.REQUIRED_CHANGED_PATHS,inherited].sort().map(relative=>
    [relative,verifier.sha256(fs.readFileSync(path.join(root,relative)))]));
  const testResults=verifier.TEST_COMMANDS.map(command=>({command,status:'PASS',outputSha256:'e'.repeat(64)}));
  const identity={diagnosticWasmSha256:verifier.STAGE3E_WASM_SHA256,captureHelperSha256:'d'.repeat(64)};
  const expected={root,acceptedCommit,paths:verifier.REQUIRED_CHANGED_PATHS,diffSha256:'c'.repeat(64),
    verifierFileSha256:hashes,stage3eAcousticIdentity:identity};
  return {expected,record:{schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V15',
    decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:verifier.PARENT_RELATIVE,
    parentSha256:verifier.PARENT_SHA256,parentAcceptedCommit:verifier.PARENT_ACCEPTED_COMMIT,acceptedCommit,
    allowedChangedPaths:verifier.REQUIRED_CHANGED_PATHS,allowedVerifierOnlyDiffSha256:expected.diffSha256,
    verifierFileSha256:hashes,stage3eAcousticIdentity:identity,stage3eWasmSha256:verifier.STAGE3E_WASM_SHA256,
    testResults,testResultsSha256:verifier.sha256(verifier.jsonBytes(testResults)),acousticRenders:0,builds:0,evidenceWrites:0,
    primarySecondaryIntegrity:'PASS'}};
}

assert.equal(verifier.PARENT_SHA256,'f913fb5597c584c293e0106c50242ead507bf52f1e32097543c9f1c6b25771f1');
assert.equal(verifier.PARENT_ACCEPTED_COMMIT,'f3abab2d5999f86e959e2c5e57a09bddc2a8adbe');
assert.equal(verifier.REQUIRED_CHANGED_PATHS.length,12);
assert.ok(!verifier.REQUIRED_CHANGED_PATHS.includes('docs/status/plugins/dsp/super-synth/stage3e-mid055-diagnostic.md'));
assert.equal(typeof v14.runtimeContext,'function');

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v15-source-'));
  try{
    git(root,['init','--quiet']);git(root,['config','user.name','Issue 9 verifier test']);git(root,['config','user.email','issue9-test@example.invalid']);
    for(const relative of verifier.REQUIRED_CHANGED_PATHS)write(root,relative,Buffer.from(`approved ${relative}\n`));
    write(root,'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v14.cjs',Buffer.from('inherited source\n'));
    const accepted=commit(root,'accepted v15 source set');
    write(root,verifier.STATUS_DESCENDANT,Buffer.from('documentation only\n'));
    commit(root,'status only descendant');
    const {expected,record}=recordFor(root,accepted);
    const originalRuntime=v14.runtimeContext;
    v14.runtimeContext=()=>{throw new Error('legacy v14 live verifier must not be called');};
    try{
      assert.equal(verifier.validateRecord(record,expected).acceptedCommit,accepted,
        'historical v14 acceptance and the committed v15 source set do not require v14 live runtimeContext');
      assert.throws(()=>verifier.validateRecord({...record,allowedChangedPaths:['unexpected.cjs']},expected),/differs from frozen v14 parent/);
      const inheritedPath='wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v14.cjs';
      write(root,inheritedPath,Buffer.from('mutated inherited source\n'));
      assert.throws(()=>verifier.validateRecord(record,expected),/effective verifier source differs/);
      write(root,inheritedPath,Buffer.from('inherited source\n'));
      write(root,verifier.REQUIRED_CHANGED_PATHS[0],Buffer.from('one-byte source drift\n'));
      assert.throws(()=>verifier.validateRecord(record,expected),/effective verifier source differs/);
    }finally{v14.runtimeContext=originalRuntime;}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v15-one-sided-'));
  const roots={primary:path.join(root,'primary'),secondary:path.join(root,'secondary')};
  try{
    fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
    write(roots.primary,verifier.RELATIVE,Buffer.from('{}\n'));
    const before=[fs.statSync(roots.primary,{bigint:true}).mtimeNs.toString(),fs.statSync(roots.secondary,{bigint:true}).mtimeNs.toString()];
    assert.throws(()=>verifier.runtimeContext({root,roots}),/v15 attestation exists in only one durable store/);
    const after=[fs.statSync(roots.primary,{bigint:true}).mtimeNs.toString(),fs.statSync(roots.secondary,{bigint:true}).mtimeNs.toString()];
    assert.deepEqual(after,before,'verification never writes or repairs the one-sided record');
    assert.equal(fs.readFileSync(path.join(roots.primary,verifier.RELATIVE),'utf8'),'{}\n');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('PASS v15 source SHA, path, ancestry, one-sided record, and read-only compatibility checks');
