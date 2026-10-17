'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const v12=require('./stage3e-performance-verifier-continuation-v12.cjs');
const v13=require('./stage3e-performance-verifier-continuation-v13.cjs');
const v14=require('./stage3e-performance-verifier-continuation-v14.cjs');

function git(root,args,encoding='utf8'){
  return execFileSync('rtk',['git',...args],{cwd:root,encoding,stdio:['ignore','pipe','pipe']}).trim();
}
function write(root,relative,contents){
  const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);
}
function commit(root,message){
  git(root,['add','--','.']);
  git(root,['-c','user.name=Stage3E verifier test','-c','user.email=stage3e-test@example.invalid','commit','--quiet','-m',message]);
  return git(root,['rev-parse','HEAD']);
}

assert.equal(v14.PARENT_SHA256,'56b62b07daf4e29e3f5405f2dc26ace4aab6936b30e309fde1973ab7c7244dc2');
assert.equal(v14.PARENT_ACCEPTED_COMMIT,'100c59457dfbb28f17d334f99f848e851339a6b5');
assert.equal(typeof v12.runtimeContext,'function');
assert.equal(typeof v13.runtimeContext,'function');
for(const relative of [
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v13.cjs'
]){
  const source=fs.readFileSync(path.join(__dirname,path.basename(relative)),'utf8');
  assert.ok(source.indexOf('module.exports=')<source.indexOf('if(require.main===module)'),
    relative+' exports its verifier API before invoking CLI main');
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v14-doc-descendant-'));
  try{
    git(root,['init','--quiet']);
    git(root,['config','user.name','Stage3E verifier test']);
    git(root,['config','user.email','stage3e-test@example.invalid']);
    const acceptedSources=Object.fromEntries(v14.REQUIRED_CHANGED_PATHS.map(relative=>[relative,'approved '+relative+'\n']));
    for(const [relative,contents] of Object.entries(acceptedSources))write(root,relative,contents);
    const acceptedCommit=commit(root,'accepted verifier-only source');
    write(root,'docs/review-note.md','documentation-only descendant\n');
    commit(root,'documentation-only descendant');
    const inheritedPaths=[
      'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.cjs',
      'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
      'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.cjs',
      'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.cjs',
      'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v13.cjs'
    ];
    const verifierFileSha256=Object.fromEntries([...inheritedPaths,...v14.REQUIRED_CHANGED_PATHS].map(relative=>
      [relative,v14.sha256(Buffer.from(acceptedSources[relative]||'inherited '+relative+'\n'))]).sort(([a],[b])=>a.localeCompare(b)));
    const stage3eAcousticIdentity={diagnosticWasmSha256:v14.STAGE3E_WASM_SHA256};
    const testResults=[{command:'continuation-v14.test.cjs',status:'PASS',outputSha256:'f'.repeat(64)}];
    const expected={root,acceptedCommit,paths:v14.REQUIRED_CHANGED_PATHS,
      diffSha256:'e'.repeat(64),verifierFileSha256,stage3eAcousticIdentity};
    const record={schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V14',
      decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:'performance-verifier-compatibility-v13.json',
      parentSha256:v14.PARENT_SHA256,parentAcceptedCommit:v14.PARENT_ACCEPTED_COMMIT,acceptedCommit,
      allowedChangedPaths:expected.paths,allowedVerifierOnlyDiffSha256:expected.diffSha256,
      verifierFileSha256,stage3eAcousticIdentity,stage3eWasmSha256:v14.STAGE3E_WASM_SHA256,
      testResults,testResultsSha256:v14.sha256(v14.jsonBytes(testResults)),
      acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
    assert.equal(v14.validateRecord(record,expected).decision,'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
      'documentation-only descendants preserve the approved source identity');
    assert.throws(()=>v14.validateRecord({...record,verifierFileSha256:{...verifierFileSha256,
      [inheritedPaths[0]]:'0'.repeat(64)}},expected),/v14 compatibility record differs/);
    assert.throws(()=>v14.validateRecord({...record,parentSha256:'0'.repeat(64)},expected),/v14 compatibility record differs/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('PASS v14 verifier continuation binds inherited source hashes and permits documentation-only descendants');
console.log('PASS v12/v13 export their verifier API before CLI execution');
