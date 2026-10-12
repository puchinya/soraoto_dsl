'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const v13=require('./stage3e-performance-verifier-continuation-v13.cjs');

function git(root,args,encoding='utf8'){
  return execFileSync('rtk',['git',...args],{cwd:root,encoding,stdio:['ignore','pipe','pipe']}).trim();
}
function write(root,relative,contents){
  const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);
}
function commit(root,message){
  git(root,['add','--','.']);git(root,['-c','user.name=Stage3E verifier test','-c','user.email=stage3e-test@example.invalid','commit','--quiet','-m',message]);
  return git(root,['rev-parse','HEAD']);
}

assert.equal(v13.PARENT_SHA256,'295be44b3b7da844f7f581abcf64d304d1663b24025c004c9c6ffc0400055f2c');
assert.equal(v13.PARENT_ACCEPTED_COMMIT,'2a311bc44f581fc2b11678f9d135bbea2f4d29fb');

{
  const inherited='wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs';
  const inheritedV10='wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.cjs';
  const overridden='wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.cjs';
  const inheritedBytes=Buffer.from('approved inherited\n'),inheritedV10Bytes=Buffer.from('approved v10\n'),
    overriddenBytes=Buffer.from('approved v12 override\n');
  const accepted=v13.effectiveVerifierFileSha256({root:'/unused',acceptedCommit:'commit',
    priorV11:{[inherited]:v13.sha256(inheritedBytes),[inheritedV10]:v13.sha256(inheritedV10Bytes),[overridden]:'c'.repeat(64)},
    priorV12:{[overridden]:v13.sha256(overriddenBytes)},paths:[]});
  assert.equal(accepted[inherited],v13.sha256(inheritedBytes),'unmodified v11 runtime source is inherited');
  assert.equal(accepted[inheritedV10],v13.sha256(inheritedV10Bytes),'v10 runtime source remains in the effective source set');
  assert.equal(accepted[overridden],v13.sha256(overriddenBytes),'v12 accepted source overrides its v11 predecessor');

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v13-source-union-'));
  try{
    for(const [relative,sha] of Object.entries(accepted))write(root,relative,
      relative===inherited?inheritedBytes:relative===inheritedV10?inheritedV10Bytes:overriddenBytes);
    assert.equal(v13.validateCurrentVerifierFiles(root,accepted),true);
    write(root,inherited,'tampered inherited v11 source\n');
    assert.throws(()=>v13.validateCurrentVerifierFiles(root,accepted),/stage3e-recovery-reconciliation-v2\.cjs/);
    write(root,inherited,inheritedBytes);
    write(root,inheritedV10,'tampered inherited v10 source\n');
    assert.throws(()=>v13.validateCurrentVerifierFiles(root,accepted),/stage3e-performance-verifier-continuation-v10\.cjs/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v13-doc-descendant-'));
  try{
    git(root,['init','--quiet']);
    git(root,['config','user.name','Stage3E verifier test']);
    git(root,['config','user.email','stage3e-test@example.invalid']);
    const acceptedSources=Object.fromEntries(v13.REQUIRED_CHANGED_PATHS.map(relative=>[relative,`approved ${relative}\n`]));
    for(const [relative,contents] of Object.entries(acceptedSources))write(root,relative,contents);
    const acceptedCommit=commit(root,'accepted verifier-only source');
    write(root,'docs/review-note.md','documentation-only descendant\n');
    commit(root,'documentation-only descendant');
    const verifierFileSha256=Object.fromEntries(Object.entries(acceptedSources).map(([relative,contents])=>
      [relative,v13.sha256(Buffer.from(contents))]));
    const stage3eAcousticIdentity={diagnosticWasmSha256:v13.STAGE3E_WASM_SHA256};
    const testResults=[{command:'v13-test',status:'PASS',outputSha256:'f'.repeat(64)}];
    const expected={root,acceptedCommit,paths:v13.REQUIRED_CHANGED_PATHS,diffSha256:'e'.repeat(64),
      verifierFileSha256,stage3eAcousticIdentity};
    const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V13',
      decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:'performance-verifier-compatibility-v12.json',
      parentSha256:v13.PARENT_SHA256,parentAcceptedCommit:v13.PARENT_ACCEPTED_COMMIT,acceptedCommit,
      allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,
      verifierFileSha256,stage3eAcousticIdentity,stage3eWasmSha256:v13.STAGE3E_WASM_SHA256,
      testResults,testResultsSha256:v13.sha256(v13.jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
    assert.equal(v13.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
      'a later docs-only commit is accepted while the approved verifier source blobs stay unchanged');
    assert.throws(()=>v13.validateRecord({...record,verifierFileSha256:{...verifierFileSha256,
      'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.cjs':'0'.repeat(64)}},expected),
      /v13 compatibility record differs/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('PASS v13 effective source set covers inherited v11 runtime files');
console.log('PASS v13 rejects changed inherited source and accepts docs-only descendant commits');
