'use strict';

// Binds the verifier-only checkpoint change to its reviewed source blob while
// preserving the immutable v10 acoustic identity and all prior attestations.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const v10=require('./stage3e-performance-verifier-continuation-v10.cjs');
const acoustic=require('./stage3e-performance-verifier-compatibility-v1.cjs');

const RELATIVE='performance-verifier-compatibility-v11.json';
const V10_SHA256='2784426827df766629cee9dad975d512f5c33be271ba5baf270568a5b5476b45';
const V10_ACCEPTED_COMMIT='acffcba3f0810f3f8c9fb589523e01f6d18b8797';
const V11_BASE_COMMIT='c16a9b43665808a986a7b33f15d0b3b2b91d8009';
const CHECKPOINT_FIX_COMMIT='b40cc7c67c16370b2bcecafb67061a1e254848ca';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const INCREMENTAL_VERIFIER_PATH='wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs';
const CHECKPOINT_VERIFIER_SHA256='dcf2f297cc3e197df4d84ec7f9acc671aeae80b330ede76618eef2451a1341ca';
const REQUIRED_CHANGED_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.test.cjs'
].sort());
const TEST_FILES=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs'
]);

function fail(message,code='BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'){
  const error=new Error(`${code}: ${message}`);error.code=code;throw error;
}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function git(root,args,encoding=null){
  try{return execFileSync('rtk',['git',...args],{cwd:root,encoding,maxBuffer:64*1024*1024,stdio:encoding?['ignore','pipe','pipe']:'pipe'});}
  catch(error){fail(`git verification failed: ${String(error.stderr||error.message).slice(-1500)}`);}
}
function head(root){return git(root,['rev-parse','HEAD'],'utf8').trim();}
function ancestor(root,from,to){try{git(root,['merge-base','--is-ancestor',from,to]);return true;}catch{return false;}}
function pathsBetween(root,from,to){return git(root,['diff','--name-only','--no-renames',from,to,'--'],'utf8').split(/\r?\n/).map(value=>value.trim()).filter(value=>value&&value!=='Changes:').sort();}
function hashAt(root,commit,relative){return sha256(git(root,['show',`${commit}:${relative}`]));}
function currentHash(root,relative){return sha256(fs.readFileSync(path.join(root,relative)));}
function hashesAt(root,commit,paths){return Object.fromEntries(paths.map(relative=>[relative,hashAt(root,commit,relative)]));}
function currentHashes(root,paths){return Object.fromEntries(paths.map(relative=>[relative,currentHash(root,relative)]));}
function diffSha256(root,from,to,paths){return sha256(git(root,['diff','--binary','--no-compact','--no-ext-diff','--no-renames',from,to,'--',...paths]));}
function isClean(root){return git(root,['status','--porcelain'],'utf8').trim()==='';}
function rootsFor(root=search.ROOT,home=process.env.HOME){return v10.rootsFor(root,home);}

function validateAcceptedVerifierFiles({root,acceptedCommit,paths=REQUIRED_CHANGED_PATHS,expectedHashes}={}){
  if(!ancestor(root,acceptedCommit,head(root)))fail('accepted verifier commit is not an ancestor of current HEAD','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const committed=hashesAt(root,acceptedCommit,paths);
  if(expectedHashes&&!same(expectedHashes,committed))fail('attested verifier hashes differ from accepted commit');
  if(!same(currentHashes(root,paths),committed))fail('current verifier files differ from accepted commit','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return committed;
}

function readV10(root,roots){
  const stored=durable.verifyDualCopy(path.join(roots.primary,v10.RELATIVE),path.join(roots.secondary,v10.RELATIVE),V10_SHA256);
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('immutable v10 parent is not valid JSON');}
  if(record.acceptedCommit!==V10_ACCEPTED_COMMIT||record.primarySecondaryIntegrity!=='PASS')fail('immutable v10 parent identity differs');
  const prior=v10.readAndValidateParent(root,roots);
  const paths=v10.pathsBetween(root,v10.PARENT_ACCEPTED_COMMIT,record.acceptedCommit);
  const expected={root,parentSha256:v10.PARENT_SHA256,acceptedCommit:record.acceptedCommit,paths,
    diffSha256:v10.diffBetween(root,v10.PARENT_ACCEPTED_COMMIT,record.acceptedCommit,paths),
    changedFileSha256:hashesAt(root,record.acceptedCommit,paths),stage3eAcousticIdentity:prior.identity};
  v10.validateRecord(record,expected);
  return {record,sha256:stored.sha256,identity:prior.identity};
}

function validateIncrementalSource({root,acceptedCommit,expectedSha256=hashAt(root,acceptedCommit,INCREMENTAL_VERIFIER_PATH)}={}){
  if(!ancestor(root,acceptedCommit,head(root)))fail('accepted verifier commit is not an ancestor of current HEAD','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const committed=hashAt(root,acceptedCommit,INCREMENTAL_VERIFIER_PATH);
  if(committed!==expectedSha256)fail('incremental verifier authorization does not match the accepted commit');
  const actual=currentHash(root,INCREMENTAL_VERIFIER_PATH);
  if(actual!==expectedSha256)fail('current incremental verifier differs from its authorized source hash','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {commit:acceptedCommit,sha256:actual};
}

function snapshot({root=search.ROOT,roots=rootsFor(root),acceptedCommit=head(root)}={}){
  const parent=readV10(root,roots);
  if(!ancestor(root,V11_BASE_COMMIT,acceptedCommit)||!ancestor(root,CHECKPOINT_FIX_COMMIT,acceptedCommit))
    fail('verifier fix commit is outside the reviewed v10 continuation ancestry','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const paths=pathsBetween(root,V11_BASE_COMMIT,acceptedCommit);
  if(!same(paths,[...REQUIRED_CHANGED_PATHS]))
    fail(`v11 changed paths differ from the verifier-only allowlist: ${paths.join(',')}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const stage3eAcousticIdentity=acoustic.currentStage3eAcousticIdentity(root);
  if(stage3eAcousticIdentity.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||!same(stage3eAcousticIdentity,parent.identity))
    fail('Stage3E acoustic creator inputs differ from immutable v10','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const checkpointSource=validateIncrementalSource({root,acceptedCommit:CHECKPOINT_FIX_COMMIT,expectedSha256:CHECKPOINT_VERIFIER_SHA256});
  const verifierFileSha256=validateAcceptedVerifierFiles({root,acceptedCommit,paths:REQUIRED_CHANGED_PATHS});
  for(const [relative,oldSha256] of Object.entries(parent.record.changedFileSha256||{})){
    const current=currentHash(root,relative),accepted=verifierFileSha256[relative];
    if(current!==oldSha256&&current!==accepted)
      fail(`current file is not bound by either immutable v10 or v11 identity: ${relative}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  }
  return {root,roots,parent,paths,acceptedCommit,diffSha256:diffSha256(root,V11_BASE_COMMIT,acceptedCommit,paths),
    verifierFileSha256,checkpointSource,stage3eAcousticIdentity};
}

function validateRecord(record,expected){
  if(!record||record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!==v10.RELATIVE||
     record.parentSha256!==V10_SHA256||record.parentAcceptedCommit!==V10_ACCEPTED_COMMIT||
     record.checkpointFixCommit!==CHECKPOINT_FIX_COMMIT||record.incrementalVerifierPath!==INCREMENTAL_VERIFIER_PATH||
     record.incrementalVerifierSha256!==CHECKPOINT_VERIFIER_SHA256||record.acceptedCommit!==expected.acceptedCommit||
     !ancestor(expected.root,record.acceptedCommit,head(expected.root))||!same(record.allowedChangedPaths,expected.paths)||
     record.allowedVerifierOnlyDiffSha256!==expected.diffSha256||!same(record.verifierFileSha256,expected.verifierFileSha256)||
     !same(record.stage3eAcousticIdentity,expected.stage3eAcousticIdentity)||
     record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||!Array.isArray(record.testResults)||!record.testResults.length||
     record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
     record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0||
     record.primarySecondaryIntegrity!=='PASS')fail('v11 source attestation differs from immutable v10, exact verifier blobs, tests, or acoustic inputs');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,parentSha256:record.parentSha256,
    incrementalVerifierSha256:record.incrementalVerifierSha256};
}

function buildRecord({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home),testResults,acceptedCommit=head(root)}={}){
  if(!isClean(root)||head(root)!==acceptedCommit)fail('v11 attestation requires a clean committed verifier tree');
  if(!Array.isArray(testResults)||!testResults.length||testResults.some(item=>!item||item.status!=='PASS'||
     typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||'')))fail('zero-render v11 test evidence is incomplete');
  const state=snapshot({root,roots,acceptedCommit});
  return {schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
    parentRelative:v10.RELATIVE,parentSha256:state.parent.sha256,parentAcceptedCommit:V10_ACCEPTED_COMMIT,
    checkpointFixCommit:CHECKPOINT_FIX_COMMIT,incrementalVerifierPath:INCREMENTAL_VERIFIER_PATH,
    incrementalVerifierSha256:state.checkpointSource.sha256,acceptedCommit,
    allowedChangedPaths:state.paths,allowedVerifierOnlyDiffSha256:state.diffSha256,verifierFileSha256:state.verifierFileSha256,
    stage3eAcousticIdentity:state.stage3eAcousticIdentity,stage3eWasmSha256:STAGE3E_WASM_SHA256,
    testResults,testResultsSha256:sha256(jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
}

function runVerifierTests(root=search.ROOT){
  return TEST_FILES.map(relative=>{
    let output;
    try{output=execFileSync('rtk',['node',relative],{cwd:root,encoding:null,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}
    catch(error){fail(`zero-render v11 test failed: ${relative}: ${String(error.stderr||error.stdout||error.message).slice(-2500)}`);}
    return {command:`rtk node ${relative}`,status:'PASS',outputSha256:sha256(output)};
  });
}

function runtimeContext({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home)}={}){
  const parent=readV10(root,roots);
  const primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('v11 source attestation exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(!hasPrimary){
    // v10-only execution is safe only while every source it accepted is still
    // exact, including the incremental verifier omitted by its path inventory.
    validateIncrementalSource({root,acceptedCommit:parent.record.acceptedCommit});
    for(const [relative,expected] of Object.entries(parent.record.changedFileSha256||{}))
      if(currentHash(root,relative)!==expected)fail(`v10-only verifier source changed without a v11 attestation: ${relative}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
    const identity=acoustic.currentStage3eAcousticIdentity(root);
    if(!same(identity,parent.identity))fail('Stage3E acoustic identity differs from immutable v10','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
    return {decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',acceptedCommit:parent.record.acceptedCommit,
      sha256:parent.sha256,record:parent.record,builds:0,acousticRenders:0,evidenceWrites:0};
  }
  const stored=durable.verifyDualCopy(primary,secondary);
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('v11 source attestation is not valid JSON');}
  const expected=snapshot({root,roots,acceptedCommit:record.acceptedCommit});validateRecord(record,expected);
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,sha256:stored.sha256,record,
    builds:0,acousticRenders:0,evidenceWrites:0};
}

function assertRecoveryRuntimeBinding({root=search.ROOT,roots=rootsFor(root),head:currentHead}={}){
  const current=runtimeContext({root,roots});
  if(currentHead&&!ancestor(root,current.acceptedCommit,currentHead))fail('v11 verifier commit is not an ancestor of active execution','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return v10.recoveryDecision(current);
}

function main(argv=process.argv.slice(2)){
  if(argv.length!==1||!['--dry-run','--create','--verify'].includes(argv[0]))throw new Error('explicit mode required: --dry-run, --create, or --verify');
  const root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home),mode=argv[0];
  if(mode==='--verify'){
    const result=runtimeContext({root,home,roots});
    process.stdout.write(JSON.stringify({...result,record:undefined})+'\n');return;
  }
  const primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('v11 source attestation exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(hasPrimary){
    const stored=runtimeContext({root,home,roots});
    process.stdout.write(JSON.stringify({decision:mode==='--dry-run'?'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_READY':stored.decision,
      acceptedCommit:stored.acceptedCommit,recordSha256:stored.sha256,reused:true,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  const testResults=runVerifierTests(root),acceptedCommit=head(root),record=buildRecord({root,home,roots,testResults,acceptedCommit});
  const bytes=jsonBytes(record),recordSha256=sha256(bytes);
  if(mode==='--dry-run'){
    process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_READY',acceptedCommit,recordSha256,
      builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  const saved=durable.writeDualCopy(primary,secondary,bytes);
  process.stdout.write(JSON.stringify({decision:record.decision,acceptedCommit,recordSha256:saved.sha256,reused:false,
    builds:0,acousticRenders:0,evidenceWrites:1})+'\n');
}

if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}

module.exports={RELATIVE,V10_SHA256,V10_ACCEPTED_COMMIT,V11_BASE_COMMIT,CHECKPOINT_FIX_COMMIT,STAGE3E_WASM_SHA256,
  INCREMENTAL_VERIFIER_PATH,CHECKPOINT_VERIFIER_SHA256,REQUIRED_CHANGED_PATHS,TEST_FILES,sha256,jsonBytes,stable,same,
  pathsBetween,diffSha256,hashAt,currentHash,validateIncrementalSource,validateAcceptedVerifierFiles,readV10,snapshot,validateRecord,buildRecord,
  runVerifierTests,runtimeContext,assertRecoveryRuntimeBinding,main};
