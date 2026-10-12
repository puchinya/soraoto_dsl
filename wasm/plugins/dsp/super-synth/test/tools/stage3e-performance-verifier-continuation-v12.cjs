'use strict';

// Append-only verifier continuation after the immutable v11 record. This
// binds the reader-schema correction without rewriting prior evidence.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const v10=require('./stage3e-performance-verifier-continuation-v10.cjs');
const v11=require('./stage3e-performance-verifier-continuation-v11.cjs');
const acoustic=require('./stage3e-performance-verifier-compatibility-v1.cjs');

const RELATIVE='performance-verifier-compatibility-v12.json';
const PARENT_SHA256='e35a9dfa984419e892a6f408c6709f236fee79d273865da5904147d351ccb77d';
const PARENT_ACCEPTED_COMMIT='424b7b3552b566b5e7a78140c3f3819575414cc5';
const BASE_COMMIT=PARENT_ACCEPTED_COMMIT;
const CHECKPOINT_FIX_COMMIT='b40cc7c67c16370b2bcecafb67061a1e254848ca';
const INCREMENTAL_VERIFIER_PATH='wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs';
const CHECKPOINT_VERIFIER_SHA256='dcf2f297cc3e197df4d84ec7f9acc671aeae80b330ede76618eef2451a1341ca';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const REQUIRED_CHANGED_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.test.cjs'
].sort());
const TEST_FILES=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs'
]);

function fail(message,code='BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'){
  const error=new Error(`${code}: ${message}`);error.code=code;throw error;
}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
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

function readV11(root,roots){
  const stored=durable.verifyDualCopy(path.join(roots.primary,v11.RELATIVE),path.join(roots.secondary,v11.RELATIVE),PARENT_SHA256);
  if(stored.sha256!==PARENT_SHA256)fail('immutable v11 parent SHA-256 differs from its fixed identity');
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('immutable v11 parent is not valid JSON');}
  if(record.acceptedCommit!==PARENT_ACCEPTED_COMMIT||record.parentSha256!==v11.V10_SHA256||
     record.checkpointFixCommit!==CHECKPOINT_FIX_COMMIT||record.incrementalVerifierSha256!==CHECKPOINT_VERIFIER_SHA256||
     record.primarySecondaryIntegrity!=='PASS')fail('immutable v11 parent identity differs');
  const v10Parent=v11.readV10(root,roots);
  const paths=v11.pathsBetween(root,v11.V11_BASE_COMMIT,record.acceptedCommit);
  if(!same(paths,[...v11.REQUIRED_CHANGED_PATHS]))fail('immutable v11 source path set differs');
  const expected={root,acceptedCommit:record.acceptedCommit,paths,
    diffSha256:v11.diffSha256(root,v11.V11_BASE_COMMIT,record.acceptedCommit,paths),
    verifierFileSha256:hashesAt(root,record.acceptedCommit,paths),stage3eAcousticIdentity:v10Parent.identity};
  v11.validateRecord(record,expected);
  return {record,sha256:stored.sha256,identity:record.stage3eAcousticIdentity};
}

function validateIncrementalSource({root,acceptedCommit,expectedSha256=hashAt(root,acceptedCommit,INCREMENTAL_VERIFIER_PATH)}={}){
  if(!ancestor(root,acceptedCommit,head(root)))fail('accepted verifier commit is not an ancestor of current HEAD','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const committed=hashAt(root,acceptedCommit,INCREMENTAL_VERIFIER_PATH);
  if(committed!==expectedSha256)fail('incremental verifier authorization differs from its accepted commit');
  const actual=currentHash(root,INCREMENTAL_VERIFIER_PATH);
  if(actual!==expectedSha256)fail('current incremental verifier differs from its authorized source hash','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {commit:acceptedCommit,sha256:actual};
}

function snapshot({root=search.ROOT,roots=rootsFor(root),acceptedCommit=head(root),verifyCurrentFiles=true}={}){
  const parent=readV11(root,roots);
  if(!ancestor(root,BASE_COMMIT,acceptedCommit))fail('v12 verifier source is outside immutable v11 ancestry','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const paths=pathsBetween(root,BASE_COMMIT,acceptedCommit);
  if(!same(paths,[...REQUIRED_CHANGED_PATHS]))fail(`v12 changed paths differ from verifier-only allowlist: ${paths.join(',')}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const stage3eAcousticIdentity=acoustic.currentStage3eAcousticIdentity(root);
  if(stage3eAcousticIdentity.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||!same(stage3eAcousticIdentity,parent.identity))
    fail('Stage3E acoustic creator inputs differ from immutable v11','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const checkpointSource=validateIncrementalSource({root,acceptedCommit:CHECKPOINT_FIX_COMMIT,expectedSha256:CHECKPOINT_VERIFIER_SHA256});
  const verifierFileSha256=hashesAt(root,acceptedCommit,REQUIRED_CHANGED_PATHS);
  if(verifyCurrentFiles&&!same(currentHashes(root,REQUIRED_CHANGED_PATHS),verifierFileSha256))
    fail('current v12 verifier files differ from accepted source commit','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {root,roots,parent,paths,acceptedCommit,diffSha256:diffSha256(root,BASE_COMMIT,acceptedCommit,paths),
    verifierFileSha256,checkpointSource,stage3eAcousticIdentity};
}

function validateRecord(record,expected){
  if(!record||record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V12'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!==v11.RELATIVE||
     record.parentSha256!==PARENT_SHA256||record.parentAcceptedCommit!==PARENT_ACCEPTED_COMMIT||
     record.checkpointFixCommit!==CHECKPOINT_FIX_COMMIT||record.incrementalVerifierPath!==INCREMENTAL_VERIFIER_PATH||
     record.incrementalVerifierSha256!==CHECKPOINT_VERIFIER_SHA256||record.acceptedCommit!==expected.acceptedCommit||
     !ancestor(expected.root,record.acceptedCommit,head(expected.root))||!same(record.allowedChangedPaths,expected.paths)||
     record.allowedVerifierOnlyDiffSha256!==expected.diffSha256||!same(record.verifierFileSha256,expected.verifierFileSha256)||
     !same(record.stage3eAcousticIdentity,expected.stage3eAcousticIdentity)||record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||
     !Array.isArray(record.testResults)||!record.testResults.length||
     record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
     record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0||
     record.primarySecondaryIntegrity!=='PASS')fail('v12 source attestation differs from immutable v11, verifier blobs, tests, or acoustic identity');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,parentSha256:record.parentSha256,
    incrementalVerifierSha256:record.incrementalVerifierSha256};
}

function runtimeContext({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home)}={}){
  return require('./stage3e-performance-verifier-continuation-v13.cjs').runtimeContext({root,home,roots});
}

function buildRecord({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home),testResults,acceptedCommit=head(root)}={}){
  if(!isClean(root)||head(root)!==acceptedCommit)fail('v12 attestation requires a clean committed verifier tree');
  if(!Array.isArray(testResults)||!testResults.length||testResults.some(item=>!item||item.status!=='PASS'||
     typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||'')))fail('zero-render v12 test evidence is incomplete');
  const state=snapshot({root,roots,acceptedCommit});
  return {schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V12',
    decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:v11.RELATIVE,parentSha256:state.parent.sha256,
    parentAcceptedCommit:PARENT_ACCEPTED_COMMIT,checkpointFixCommit:CHECKPOINT_FIX_COMMIT,
    incrementalVerifierPath:INCREMENTAL_VERIFIER_PATH,incrementalVerifierSha256:state.checkpointSource.sha256,
    acceptedCommit,allowedChangedPaths:state.paths,allowedVerifierOnlyDiffSha256:state.diffSha256,
    verifierFileSha256:state.verifierFileSha256,stage3eAcousticIdentity:state.stage3eAcousticIdentity,
    stage3eWasmSha256:STAGE3E_WASM_SHA256,testResults,testResultsSha256:sha256(jsonBytes(testResults)),
    acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
}

function runVerifierTests(root=search.ROOT){
  return TEST_FILES.map(relative=>{
    let output;try{output=execFileSync('rtk',['node',relative],{cwd:root,encoding:null,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}
    catch(error){fail(`zero-render v12 test failed: ${relative}: ${String(error.stderr||error.stdout||error.message).slice(-2500)}`);}
    return {command:`rtk node ${relative}`,status:'PASS',outputSha256:sha256(output)};
  });
}

function main(argv=process.argv.slice(2),options={}){
  if(argv.length!==1||!['--dry-run','--create','--verify'].includes(argv[0]))throw new Error('explicit mode required: --dry-run, --create, or --verify');
  const root=options.root||search.ROOT,home=options.home===undefined?process.env.HOME:options.home,
    roots=options.roots||rootsFor(root,home),mode=argv[0];
  if(mode==='--verify'){
    const result=runtimeContext({root,home,roots});process.stdout.write(JSON.stringify({...result,record:undefined})+'\n');return;
  }
  const primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('v12 source attestation exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
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

module.exports={RELATIVE,PARENT_SHA256,PARENT_ACCEPTED_COMMIT,BASE_COMMIT,CHECKPOINT_FIX_COMMIT,
  INCREMENTAL_VERIFIER_PATH,CHECKPOINT_VERIFIER_SHA256,STAGE3E_WASM_SHA256,REQUIRED_CHANGED_PATHS,TEST_FILES,
  sha256,jsonBytes,stable,same,pathsBetween,hashAt,currentHash,diffSha256,rootsFor,readV11,validateIncrementalSource,
  snapshot,validateRecord,buildRecord,runtimeContext,runVerifierTests,main};
