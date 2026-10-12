'use strict';

// Successor verification record for the v12 parent-hash and inherited-source
// review fixes. Earlier attestations remain immutable.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const v11=require('./stage3e-performance-verifier-continuation-v11.cjs');
const v12=require('./stage3e-performance-verifier-continuation-v12.cjs');
const acoustic=require('./stage3e-performance-verifier-compatibility-v1.cjs');

const RELATIVE='performance-verifier-compatibility-v13.json';
const PARENT_SHA256='295be44b3b7da844f7f581abcf64d304d1663b24025c004c9c6ffc0400055f2c';
const PARENT_ACCEPTED_COMMIT='2a311bc44f581fc2b11678f9d135bbea2f4d29fb';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const REQUIRED_CHANGED_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v13.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v13.test.cjs'
].sort());
const TEST_FILES=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v13.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs'
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
  catch(error){fail(`git verifier check failed: ${String(error.stderr||error.message).slice(-1500)}`);}
}
function head(root){return git(root,['rev-parse','HEAD'],'utf8').trim();}
function ancestor(root,from,to){try{git(root,['merge-base','--is-ancestor',from,to]);return true;}catch{return false;}}
function pathsBetween(root,from,to){return git(root,['diff','--name-only','--no-renames',from,to,'--'],'utf8').split(/\r?\n/).map(value=>value.trim()).filter(Boolean).sort();}
function hashAt(root,commit,relative){return sha256(git(root,['show',`${commit}:${relative}`]));}
function currentHash(root,relative){const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail(`effective verifier file is missing: ${relative}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');return sha256(fs.readFileSync(file));}
function hashesAt(root,commit,paths){return Object.fromEntries(paths.map(relative=>[relative,hashAt(root,commit,relative)]));}
function rootsFor(root=search.ROOT,home=process.env.HOME){return v12.rootsFor(root,home);}
function isClean(root){return git(root,['status','--porcelain'],'utf8').trim()==='';}
function diffSha256(root,from,to,paths){return sha256(git(root,['diff','--binary','--no-compact','--no-ext-diff','--no-renames',from,to,'--',...paths]));}

function readV12(root,roots){
  const stored=durable.verifyDualCopy(path.join(roots.primary,v12.RELATIVE),path.join(roots.secondary,v12.RELATIVE));
  if(stored.sha256!==PARENT_SHA256)fail('immutable v12 parent SHA-256 differs from fixed identity');
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('immutable v12 parent is not valid JSON');}
  if(record.acceptedCommit!==PARENT_ACCEPTED_COMMIT||record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||
     record.primarySecondaryIntegrity!=='PASS')fail('immutable v12 parent identity differs');
  const expected=v12.snapshot({root,roots,acceptedCommit:record.acceptedCommit,verifyCurrentFiles:false});
  v12.validateRecord(record,expected);
  return {record,sha256:stored.sha256,v11:v12.readV11(root,roots)};
}

function effectiveVerifierFileSha256({root,acceptedCommit,priorV11,priorV12,paths}={}){
  const result={...(priorV11||{}),...(priorV12||{}),...hashesAt(root,acceptedCommit,paths)};
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
function validateCurrentVerifierFiles(root,expected){
  for(const [relative,sha] of Object.entries(expected||{})){
    if(currentHash(root,relative)!==sha)
      fail(`effective inherited verifier source differs from its approved blob: ${relative}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  }
  return true;
}

function snapshot({root=search.ROOT,roots=rootsFor(root),acceptedCommit=head(root)}={}){
  const parent=readV12(root,roots);
  if(!ancestor(root,PARENT_ACCEPTED_COMMIT,acceptedCommit))fail('v13 verifier source is outside immutable v12 ancestry','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const paths=pathsBetween(root,PARENT_ACCEPTED_COMMIT,acceptedCommit);
  if(!same(paths,[...REQUIRED_CHANGED_PATHS]))
    fail(`v13 changed paths differ from verifier-only allowlist: ${paths.join(',')}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const stage3eAcousticIdentity=acoustic.currentStage3eAcousticIdentity(root);
  if(stage3eAcousticIdentity.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||!same(stage3eAcousticIdentity,parent.record.stage3eAcousticIdentity))
    fail('Stage3E acoustic creator inputs differ from immutable v12','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const verifierFileSha256=effectiveVerifierFileSha256({root,acceptedCommit,
    priorV11:parent.v11.record.verifierFileSha256,priorV12:parent.record.verifierFileSha256,paths});
  validateCurrentVerifierFiles(root,verifierFileSha256);
  return {root,roots,parent,paths,acceptedCommit,diffSha256:diffSha256(root,PARENT_ACCEPTED_COMMIT,acceptedCommit,paths),
    verifierFileSha256,stage3eAcousticIdentity};
}

function validateRecord(record,expected){
  if(!record||record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V13'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!==v12.RELATIVE||
     record.parentSha256!==PARENT_SHA256||record.parentAcceptedCommit!==PARENT_ACCEPTED_COMMIT||
     record.acceptedCommit!==expected.acceptedCommit||!ancestor(expected.root,record.acceptedCommit,head(expected.root))||
     !same(record.allowedChangedPaths,expected.paths)||record.allowedVerifierOnlyDiffSha256!==expected.diffSha256||
     !same(record.verifierFileSha256,expected.verifierFileSha256)||!same(record.stage3eAcousticIdentity,expected.stage3eAcousticIdentity)||
     record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||!Array.isArray(record.testResults)||!record.testResults.length||
     record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
     record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0||
     record.primarySecondaryIntegrity!=='PASS')fail('v13 compatibility record differs from fixed parents, effective source blobs, or test results');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,parentSha256:record.parentSha256};
}

function runtimeContext({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home)}={}){
  const parent=readV12(root,roots),primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('v13 compatibility record exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(!hasPrimary)fail('v13 compatibility record is required before verifier execution');
  const stored=durable.verifyDualCopy(primary,secondary);
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('v13 compatibility record is not valid JSON');}
  const expected=snapshot({root,roots,acceptedCommit:record.acceptedCommit});
  validateRecord(record,expected);
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,sha256:stored.sha256,record,
    parentSha256:parent.sha256,builds:0,acousticRenders:0,evidenceWrites:0};
}

function buildRecord({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home),testResults,acceptedCommit=head(root)}={}){
  if(!isClean(root)||head(root)!==acceptedCommit)fail('v13 attestation requires a clean committed verifier tree');
  if(!Array.isArray(testResults)||!testResults.length||testResults.some(item=>!item||item.status!=='PASS'||
     typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||'')))fail('zero-render v13 test evidence is incomplete');
  const state=snapshot({root,roots,acceptedCommit});
  return {schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V13',
    decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:v12.RELATIVE,parentSha256:state.parent.sha256,
    parentAcceptedCommit:PARENT_ACCEPTED_COMMIT,acceptedCommit,allowedChangedPaths:state.paths,
    allowedVerifierOnlyDiffSha256:state.diffSha256,verifierFileSha256:state.verifierFileSha256,
    stage3eAcousticIdentity:state.stage3eAcousticIdentity,stage3eWasmSha256:STAGE3E_WASM_SHA256,
    testResults,testResultsSha256:sha256(jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
}

function runVerifierTests(root=search.ROOT){
  return TEST_FILES.map(relative=>{
    let output;try{output=execFileSync('rtk',['node',relative],{cwd:root,encoding:null,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}
    catch(error){fail(`zero-render v13 test failed: ${relative}: ${String(error.stderr||error.stdout||error.message).slice(-2500)}`);}
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
  if(hasPrimary!==hasSecondary)fail('v13 compatibility record exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(hasPrimary){
    const stored=runtimeContext({root,home,roots});
    process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_READY',acceptedCommit:stored.acceptedCommit,
      recordSha256:stored.sha256,reused:true,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
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

module.exports={RELATIVE,PARENT_SHA256,PARENT_ACCEPTED_COMMIT,STAGE3E_WASM_SHA256,REQUIRED_CHANGED_PATHS,TEST_FILES,
  sha256,jsonBytes,stable,same,head,ancestor,pathsBetween,hashAt,currentHash,hashesAt,rootsFor,readV12,
  effectiveVerifierFileSha256,validateCurrentVerifierFiles,snapshot,validateRecord,runtimeContext,buildRecord,runVerifierTests,main};
