'use strict';

// Immutable verifier-only bridge for the phase-specific mid-full result binding.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const v9=require('./stage3e-performance-verifier-continuation-v9.cjs');
const acousticIdentity=require('./stage3e-performance-verifier-compatibility-v1.cjs');

const PARENT_RELATIVE=v9.RELATIVE;
const RELATIVE='performance-verifier-compatibility-v10.json';
const PARENT_SHA256='e3de969f8a33f2cb42743f8de5ac4cefeae94261d374d4ebf874f9fc16463754';
const PARENT_ACCEPTED_COMMIT='88d111b3fb43a459e5daf23c141d0d837c2a2ebf';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const REQUIRED_CHANGED_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.test.cjs'
]);
const ALLOWED_CHANGED_PATHS=Object.freeze([...REQUIRED_CHANGED_PATHS].sort());
const TEST_FILES=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v9.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.test.cjs'
]);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fail(message,token='BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'){throw new Error(`${token}: ${message}`);}
function rootsFor(root=search.ROOT,home=process.env.HOME){return v9.rootsFor(root,home);}
function git(root,args,encoding=null){
  try{return execFileSync('rtk',['git',...args],{cwd:root,encoding,maxBuffer:64*1024*1024,stdio:encoding?['ignore','pipe','pipe']:'pipe'});}
  catch(error){fail(`git verification failed: ${error.message}`);}
}
function head(root){return git(root,['rev-parse','HEAD'],'utf8').trim();}
function ancestor(root,from,to){try{git(root,['merge-base','--is-ancestor',from,to]);return true;}catch{return false;}}
function pathsBetween(root,from,to){return git(root,['diff','--name-only','--no-renames',from,to,'--'],'utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&x!=='Changes:').sort();}
function hashAt(root,commit,relative){return sha256(git(root,['show',`${commit}:${relative}`]));}
function hashesAt(root,commit,paths){return Object.fromEntries(paths.map(relative=>[relative,hashAt(root,commit,relative)]));}
function currentHashes(root,paths){return Object.fromEntries(paths.map(relative=>[relative,sha256(fs.readFileSync(path.join(root,relative)))]));}
function diffBetween(root,from,to,paths){return sha256(git(root,['diff','--binary','--no-compact','--no-ext-diff','--no-renames',from,to,'--',...paths]));}
function isClean(root){return git(root,['status','--porcelain'],'utf8').trim()==='';}

function readAndValidateParent(root,roots){
  const stored=durable.verifyDualCopy(path.join(roots.primary,PARENT_RELATIVE),path.join(roots.secondary,PARENT_RELATIVE),PARENT_SHA256);
  let record;try{record=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('immutable v9 parent is not valid JSON');}
  if(record.acceptedCommit!==PARENT_ACCEPTED_COMMIT||record.primarySecondaryIntegrity!=='PASS')fail('immutable v9 parent identity differs');
  const prior=v9.readAndValidateParent(root,roots);
  const paths=v9.pathsBetween(root,v9.PARENT_ACCEPTED_COMMIT,record.acceptedCommit);
  const expected={root,parentSha256:v9.PARENT_SHA256,acceptedCommit:record.acceptedCommit,paths,
    diffSha256:v9.diffBetween(root,v9.PARENT_ACCEPTED_COMMIT,record.acceptedCommit,paths),
    changedFileSha256:Object.fromEntries(paths.map(relative=>[relative,hashAt(root,record.acceptedCommit,relative)])),
    stage3eAcousticIdentity:prior.identity};
  v9.validateRecord(record,expected);
  return {record,sha256:stored.sha256,identity:record.stage3eAcousticIdentity};
}
function snapshot({root=search.ROOT,roots=rootsFor(root),acceptedCommit=head(root)}={}){
  const parent=readAndValidateParent(root,roots);
  if(!ancestor(root,PARENT_ACCEPTED_COMMIT,acceptedCommit))fail('v10 verifier is not descended from immutable v9 commit','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const paths=pathsBetween(root,PARENT_ACCEPTED_COMMIT,acceptedCommit);
  const disallowed=paths.filter(item=>!ALLOWED_CHANGED_PATHS.includes(item)),missing=REQUIRED_CHANGED_PATHS.filter(item=>!paths.includes(item));
  if(disallowed.length||missing.length)fail(`v10 diff is outside verifier-only scope; disallowed=${disallowed.join(',')}; missing=${missing.join(',')}`,
    'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const identity=acousticIdentity.currentStage3eAcousticIdentity(root);
  if(identity.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||!same(identity,parent.identity))
    fail('Stage3E acoustic creator identity differs from immutable v9','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const changedFileSha256=hashesAt(root,acceptedCommit,paths);
  if(!same(currentHashes(root,paths),changedFileSha256))fail('current verifier files differ from accepted v10 commit');
  return {root,roots,parent,parentSha256:parent.sha256,acceptedCommit,paths,
    diffSha256:diffBetween(root,PARENT_ACCEPTED_COMMIT,acceptedCommit,paths),changedFileSha256,stage3eAcousticIdentity:identity};
}
function runVerifierTests(root=search.ROOT){
  return TEST_FILES.map(relative=>{
    let output;
    try{output=execFileSync('rtk',['node',relative],{cwd:root,encoding:null,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}
    catch(error){fail(`zero-render verifier test failed: ${relative}: ${String(error.stderr||error.stdout||error.message).slice(-3000)}`);}
    return {command:`rtk node ${relative}`,status:'PASS',outputSha256:sha256(output)};
  });
}
function buildRecord({root=search.ROOT,home=process.env.HOME,testResults,acceptedCommit=head(root)}={}){
  if(!isClean(root)||head(root)!==acceptedCommit)fail('v10 compatibility record requires a clean committed verifier tree');
  if(!Array.isArray(testResults)||!testResults.length||testResults.some(item=>!item||item.status!=='PASS'||
     typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||'')))fail('zero-render verifier test evidence is incomplete');
  const state=snapshot({root,roots:rootsFor(root,home),acceptedCommit});
  return {schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
    parentRelative:PARENT_RELATIVE,parentSha256:state.parentSha256,parentAcceptedCommit:PARENT_ACCEPTED_COMMIT,acceptedCommit,
    allowedChangedPaths:state.paths,allowedVerifierOnlyDiffSha256:state.diffSha256,changedFileSha256:state.changedFileSha256,
    stage3eAcousticIdentity:state.stage3eAcousticIdentity,stage3eWasmSha256:STAGE3E_WASM_SHA256,
    testResults,testResultsSha256:sha256(jsonBytes(testResults)),acousticRenders:0,builds:0,primarySecondaryIntegrity:'PASS'};
}
function validateRecord(record,expected){
  if(!record||record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!==PARENT_RELATIVE||
     record.parentSha256!==expected.parentSha256||record.parentAcceptedCommit!==PARENT_ACCEPTED_COMMIT||
     record.acceptedCommit!==expected.acceptedCommit||!ancestor(expected.root,record.acceptedCommit,head(expected.root))||
     !same(record.allowedChangedPaths,expected.paths)||record.allowedVerifierOnlyDiffSha256!==expected.diffSha256||
     !same(record.changedFileSha256,expected.changedFileSha256)||!same(record.stage3eAcousticIdentity,expected.stage3eAcousticIdentity)||
     record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||!Array.isArray(record.testResults)||!record.testResults.length||
     record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
     record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0||
     record.primarySecondaryIntegrity!=='PASS')fail('v10 sidecar differs from immutable v9 parent, verifier diff, tests, or acoustic identity');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,parentSha256:record.parentSha256};
}
function runtimeContext({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home)}={}){
  // Keep direct v10 callers behind the same source-identity gate as preflight.
  // The v11 reader validates the immutable v10 record without re-entering here.
  return require('./stage3e-performance-verifier-continuation-v11.cjs').runtimeContext({root,home,roots});
}
function recoveryDecision(current){
  if(current?.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE')fail('v10 runtime decision is not accepted by recovery');
  return {...current,decision:'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE',verifierDecision:current.decision};
}
function assertRecoveryRuntimeBinding({root,roots,head:currentHead}={}){
  const current=runtimeContext({root,roots});
  if(currentHead&&!ancestor(root,current.acceptedCommit,currentHead))fail('v10 verifier commit is not an ancestor of active execution','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return recoveryDecision(current);
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==1||!['--dry-run','--create','--verify'].includes(argv[0]))throw new Error('explicit mode required: --dry-run, --create, or --verify');
  const root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home),mode=argv[0];
  if(mode==='--verify'){const result=runtimeContext({root,home,roots});process.stdout.write(JSON.stringify({...result,record:undefined})+'\n');return;}
  if(mode==='--create')acousticIdentity.assertNoActiveWriter(root);
  const testResults=runVerifierTests(root),acceptedCommit=head(root),record=buildRecord({root,home,testResults,acceptedCommit});
  const bytes=jsonBytes(record),recordSha256=sha256(bytes),primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('v10 sidecar exists in only one durable store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(hasPrimary){const stored=durable.verifyDualCopy(primary,secondary);if(!stored.bytes.equals(bytes))fail('existing v10 sidecar is immutable and differs','BLOCKED_STAGE3E_PERFORMANCE_COMPATIBILITY_COLLISION');
    process.stdout.write(JSON.stringify({decision:mode==='--dry-run'?'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP_READY':record.decision,
      acceptedCommit,recordSha256:stored.sha256,reused:true,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;}
  if(mode==='--dry-run'){process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP_READY',acceptedCommit,recordSha256,
    builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;}
  const saved=durable.writeDualCopy(primary,secondary,bytes);
  process.stdout.write(JSON.stringify({decision:record.decision,acceptedCommit,recordSha256:saved.sha256,reused:false,
    builds:0,acousticRenders:0,evidenceWrites:1})+'\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={PARENT_RELATIVE,RELATIVE,PARENT_SHA256,PARENT_ACCEPTED_COMMIT,STAGE3E_WASM_SHA256,REQUIRED_CHANGED_PATHS,
  ALLOWED_CHANGED_PATHS,TEST_FILES,sha256,jsonBytes,stable,same,rootsFor,pathsBetween,diffBetween,readAndValidateParent,
  snapshot,runVerifierTests,buildRecord,validateRecord,runtimeContext,recoveryDecision,assertRecoveryRuntimeBinding,main};
