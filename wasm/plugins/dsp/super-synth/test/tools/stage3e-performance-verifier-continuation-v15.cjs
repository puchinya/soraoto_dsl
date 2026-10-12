'use strict';

// Immutable successor to v14. The v14 record is checked against its approved
// Git objects; v14.runtimeContext is intentionally not used on changed files.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const v14=require('./stage3e-performance-verifier-continuation-v14.cjs');
const acoustic=require('./stage3e-performance-verifier-compatibility-v1.cjs');

const RELATIVE='performance-verifier-compatibility-v15.json';
const PARENT_RELATIVE=v14.RELATIVE;
const PARENT_SHA256='f913fb5597c584c293e0106c50242ead507bf52f1e32097543c9f1c6b25771f1';
const PARENT_ACCEPTED_COMMIT='f3abab2d5999f86e959e2c5e57a09bddc2a8adbe';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const STATUS_DESCENDANT='docs/status/plugins/dsp/super-synth/stage3e-mid055-diagnostic.md';
const REQUIRED_CHANGED_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-mid055-diagnostic.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-mid055-diagnostic.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v15.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-mid055-diagnostic.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-mid055-diagnostic.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v15.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs'
].sort());
const TEST_FILES=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-mid055-diagnostic.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-mid055-diagnostic.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v15.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v14.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs'
]);
const TEST_COMMANDS=Object.freeze([...TEST_FILES.map(relative=>`rtk node ${relative}`),'rtk git diff --check']);

function fail(message,code='BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'){
  const error=new Error(`${code}: ${message}`);error.code=code;throw error;
}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function validTestResults(results){
  return Array.isArray(results)&&results.length===TEST_COMMANDS.length&&same(results.map(item=>item?.command),TEST_COMMANDS)&&
    results.every(item=>item?.status==='PASS'&&/^[0-9a-f]{64}$/.test(item.outputSha256||''));
}
function git(root,args,encoding=null){
  try{return execFileSync('rtk',['git',...args],{cwd:root,encoding,maxBuffer:64*1024*1024,stdio:encoding?['ignore','pipe','pipe']:'pipe'});}
  catch(error){fail(`git verifier check failed: ${String(error.stderr||error.message).slice(-1500)}`);}
}
function head(root){return git(root,['rev-parse','HEAD'],'utf8').trim();}
function ancestor(root,from,to){try{git(root,['merge-base','--is-ancestor',from,to]);return true;}catch{return false;}}
function pathsBetween(root,from,to){return git(root,['diff','--name-only','--no-renames',from,to,'--'],'utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&x!=='Changes:').sort();}
function hashAt(root,commit,relative){return sha256(git(root,['show',`${commit}:${relative}`]));}
function currentHash(root,relative){const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail(`effective source file is missing: ${relative}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');return sha256(fs.readFileSync(file));}
function hashesAt(root,commit,paths){return Object.fromEntries(paths.map(relative=>[relative,hashAt(root,commit,relative)]));}
function rootsFor(root=search.ROOT,home=process.env.HOME){return v14.rootsFor(root,home);}
function isClean(root){return git(root,['status','--porcelain'],'utf8').trim()==='';}
function diffSha256(root,from,to,paths){return sha256(git(root,['diff','--binary','--no-compact','--no-ext-diff','--no-renames',from,to,'--',...paths]));}
function validateV14Historically({root=search.ROOT,roots=rootsFor(root)}={}){
  const primary=path.join(roots.primary,v14.RELATIVE),secondary=path.join(roots.secondary,v14.RELATIVE);
  const stored=durable.verifyDualCopy(primary,secondary);
  if(stored.sha256!==PARENT_SHA256)fail('immutable v14 parent SHA-256 differs from the frozen pre-change identity');
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('immutable v14 parent is not valid JSON');}
  if(record.acceptedCommit!==PARENT_ACCEPTED_COMMIT||record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||record.primarySecondaryIntegrity!=='PASS')
    fail('immutable v14 parent identity differs');
  if(!ancestor(root,PARENT_ACCEPTED_COMMIT,head(root)))fail('current source is not a descendant of the accepted v14 commit','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const v13=v14.readV13(root,roots),paths=pathsBetween(root,v14.PARENT_ACCEPTED_COMMIT,record.acceptedCommit);
  if(!same(paths,[...v14.REQUIRED_CHANGED_PATHS]))fail('historical v14 source path set differs');
  const identity=acoustic.currentStage3eAcousticIdentity(root);
  if(identity.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||!same(identity,v13.record.stage3eAcousticIdentity))
    fail('pinned v14 acoustic identity differs','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const verifierFileSha256=Object.fromEntries(Object.entries({...v13.record.verifierFileSha256,...hashesAt(root,record.acceptedCommit,paths)})
    .sort(([a],[b])=>a.localeCompare(b)));
  const expected={root,acceptedCommit:record.acceptedCommit,paths,
    diffSha256:diffSha256(root,v14.PARENT_ACCEPTED_COMMIT,record.acceptedCommit,paths),verifierFileSha256,stage3eAcousticIdentity:identity};
  v14.validateRecord(record,expected);
  return {record,sha256:stored.sha256,v13,expected};
}
function snapshot({root=search.ROOT,roots=rootsFor(root),acceptedCommit=head(root)}={}){
  const parent=validateV14Historically({root,roots});
  if(!ancestor(root,PARENT_ACCEPTED_COMMIT,acceptedCommit))fail('v15 source commit is outside immutable v14 ancestry','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const paths=pathsBetween(root,PARENT_ACCEPTED_COMMIT,acceptedCommit);
  if(!same(paths,[...REQUIRED_CHANGED_PATHS]))fail(`v15 changed paths differ from the exact source/test allowlist: ${paths.join(',')}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const stage3eAcousticIdentity=acoustic.currentStage3eAcousticIdentity(root);
  if(!same(stage3eAcousticIdentity,parent.record.stage3eAcousticIdentity)||stage3eAcousticIdentity.diagnosticWasmSha256!==STAGE3E_WASM_SHA256)
    fail('Stage3E acoustic creator inputs differ from immutable v14','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const verifierFileSha256=Object.fromEntries(Object.entries({...parent.record.verifierFileSha256,...hashesAt(root,acceptedCommit,paths)})
    .sort(([a],[b])=>a.localeCompare(b)));
  const diff=diffSha256(root,PARENT_ACCEPTED_COMMIT,acceptedCommit,paths);
  return {root,roots,parent,paths,acceptedCommit,diffSha256:diff,verifierFileSha256,stage3eAcousticIdentity};
}
function validateRecord(record,expected,{allowStatusDescendant=true}={}){
  const fieldHashes=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
  if(!record||record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V15'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!==PARENT_RELATIVE||
     record.parentSha256!==PARENT_SHA256||record.parentAcceptedCommit!==PARENT_ACCEPTED_COMMIT||
     record.acceptedCommit!==expected.acceptedCommit||!ancestor(expected.root,record.acceptedCommit,head(expected.root))||
     !same(record.allowedChangedPaths,expected.paths)||record.allowedVerifierOnlyDiffSha256!==expected.diffSha256||
     !same(record.verifierFileSha256,expected.verifierFileSha256)||!same(record.stage3eAcousticIdentity,expected.stage3eAcousticIdentity)||
     record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||fieldHashes.some(key=>! /^[0-9a-f]{64}$/.test(record[key]||''))||
     !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||!validTestResults(record.testResults)||
     record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0||record.evidenceWrites!==0||
     record.primarySecondaryIntegrity!=='PASS')fail('v15 record differs from frozen v14 parent, source path set, hashes, or zero-render tests');
  const livePaths=pathsBetween(expected.root,record.acceptedCommit,head(expected.root));
  if(livePaths.length&&(!allowStatusDescendant||!same(livePaths,[STATUS_DESCENDANT])))
    fail(`post-attestation commit changed unapproved paths: ${livePaths.join(',')}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  for(const [relative,hash] of Object.entries(expected.verifierFileSha256))
    if(currentHash(expected.root,relative)!==hash)fail(`effective verifier source differs from its committed blob: ${relative}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,parentSha256:record.parentSha256};
}
function runZeroRenderTests(root=search.ROOT){
  const results=[];
  for(const relative of TEST_FILES){
    let output;
    try{output=execFileSync('rtk',['node',relative],{cwd:root,encoding:null,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}
    catch(error){fail(`zero-render v15 test failed: ${relative}: ${String(error.stderr||error.stdout||error.message).slice(-2500)}`);}
    results.push({command:`rtk node ${relative}`,status:'PASS',outputSha256:sha256(output)});
  }
  let output;
  try{output=execFileSync('rtk',['git','diff','--check'],{cwd:root,encoding:null,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});}
  catch(error){fail(`zero-render v15 diff check failed: ${String(error.stderr||error.stdout||error.message).slice(-1500)}`);}
  results.push({command:'rtk git diff --check',status:'PASS',outputSha256:sha256(output)});
  return results;
}
function buildRecord({root=search.ROOT,roots=rootsFor(root),testResults,acceptedCommit=head(root)}={}){
  if(!isClean(root)||head(root)!==acceptedCommit)fail('v15 attestation requires the exact clean committed source tree');
  if(!validTestResults(testResults))fail('v15 zero-render test evidence is incomplete or out of order');
  const state=snapshot({root,roots,acceptedCommit});
  return {schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V15',
    decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',parentRelative:PARENT_RELATIVE,parentSha256:state.parent.sha256,
    parentAcceptedCommit:PARENT_ACCEPTED_COMMIT,acceptedCommit,allowedChangedPaths:state.paths,
    allowedVerifierOnlyDiffSha256:state.diffSha256,verifierFileSha256:state.verifierFileSha256,
    stage3eAcousticIdentity:state.stage3eAcousticIdentity,stage3eWasmSha256:STAGE3E_WASM_SHA256,
    testResults,testResultsSha256:sha256(jsonBytes(testResults)),acousticRenders:0,builds:0,evidenceWrites:0,primarySecondaryIntegrity:'PASS'};
}
function runtimeContext({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home)}={}){
  const primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('v15 attestation exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(!hasPrimary)fail('v15 source attestation is required before Stage3E diagnostic verification');
  const parent=validateV14Historically({root,roots}),stored=durable.verifyDualCopy(primary,secondary);
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('v15 record is not valid JSON');}
  const expected=snapshot({root,roots,acceptedCommit:record.acceptedCommit});
  validateRecord(record,expected);
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,sha256:stored.sha256,record,
    parentSha256:parent.sha256,builds:0,acousticRenders:0,evidenceWrites:0};
}
function main(argv=process.argv.slice(2),options={}){
  if(argv.length!==1||!['--dry-run','--create','--verify'].includes(argv[0]))throw new Error('explicit mode required: --dry-run, --create, or --verify');
  const root=options.root||search.ROOT,home=options.home===undefined?process.env.HOME:options.home,roots=options.roots||rootsFor(root,home),mode=argv[0];
  if(mode==='--verify'){
    const result=runtimeContext({root,home,roots});process.stdout.write(JSON.stringify({...result,record:undefined})+'\n');return;
  }
  const primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('v15 record exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(hasPrimary)fail('v15 --create is single-use; existing records are immutable');
  const testResults=options.testResults||runZeroRenderTests(root),acceptedCommit=head(root);
  const record=buildRecord({root,roots,testResults,acceptedCommit}),bytes=jsonBytes(record),recordSha256=sha256(bytes);
  if(mode==='--dry-run'){
    process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_VERIFIER_SOURCE_READY',acceptedCommit,
      parentSha256:record.parentSha256,recordSha256,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  const saved=durable.writeDualCopy(primary,secondary,bytes);
  if(saved.sha256!==recordSha256)fail('v15 dual-copy readback SHA differs','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  const readback=durable.verifyDualCopy(primary,secondary);
  process.stdout.write(JSON.stringify({decision:record.decision,acceptedCommit,recordSha256:readback.sha256,
    reused:false,builds:0,acousticRenders:0,evidenceWrites:1})+'\n');
}

module.exports={RELATIVE,PARENT_RELATIVE,PARENT_SHA256,PARENT_ACCEPTED_COMMIT,STAGE3E_WASM_SHA256,REQUIRED_CHANGED_PATHS,TEST_FILES,TEST_COMMANDS,
  STATUS_DESCENDANT,sha256,jsonBytes,stable,same,head,ancestor,pathsBetween,hashAt,currentHash,hashesAt,rootsFor,isClean,
  validTestResults,diffSha256,validateV14Historically,snapshot,validateRecord,runZeroRenderTests,buildRecord,runtimeContext,main};

if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
