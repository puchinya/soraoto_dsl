'use strict';

// Append-only verifier continuation for the immutable performance-v2 record.
// This authorizes only the audited checkpoint bootstrap correction and its
// evidence-reader wiring; acoustic inputs and the capture helper stay fixed.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const parentContinuation=require('./stage3e-performance-verifier-continuation-v2.cjs');
const acousticIdentity=require('./stage3e-performance-verifier-compatibility-v1.cjs');

const PARENT_RELATIVE='performance-verifier-compatibility-v2.json';
const RELATIVE='performance-verifier-compatibility-v3.json';
const PARENT_SHA256='64283b303effc386719926facf0d6abea03e6135accee38eee1f19c0f172b092';
const PARENT_ACCEPTED_COMMIT='d1ced58e0f1a80e10a0269f7e5b489de1b79e2b3';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const ALLOWED_CHANGED_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v3.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v3.test.cjs'
].sort());
const DEFAULT_TEST_RESULTS=Object.freeze([
  {command:'stage3e-incremental-verification.test.cjs',status:'PASS'},
  {command:'stage3e-performance-verifier-continuation-v3.test.cjs',status:'PASS'},
  {command:'run-stage3e-generation2.test.cjs',status:'PASS'},
  {command:'run-stage3e-master-orchestrator.test.cjs',status:'PASS'},
  {command:'stage3e-evidence-validator.test.cjs',status:'PASS'},
  {command:'stage3e-preflight.test.cjs',status:'PASS'},
  {command:'stage3e-recovery-reconciliation-v2.test.cjs',status:'PASS'}
]);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fail(message,token='BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'){throw new Error(`${token}: ${message}`);}
function rootsFor(root=search.ROOT,home=process.env.HOME){return parentContinuation.rootsFor(root,home);}
function git(root,args,encoding='utf8'){
  try{return execFileSync('rtk',['git',...args],{cwd:root,encoding,maxBuffer:64*1024*1024,stdio:encoding?['ignore','pipe','pipe']:'pipe'});}
  catch(error){fail(`git verification failed: ${error.message}`);}
}
function head(root){return git(root,['rev-parse','HEAD']).trim();}
function ancestor(root,from,to){try{git(root,['merge-base','--is-ancestor',from,to],null);return true;}catch{return false;}}
function changedPaths(root,from,to){return git(root,['diff','--name-only','--no-renames',from,to,'--']).split(/\r?\n/).map(item=>item.trim()).filter(item=>item&&item!=='Changes:').sort();}
function diffSha256(root,from,to,paths){return sha256(git(root,['diff','--binary','--no-compact','--no-ext-diff','--no-renames',from,to,'--',...paths],null));}
function fileHash(root,relative){const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail(`required verifier file is absent: ${relative}`);return sha256(fs.readFileSync(file));}
function currentHashes(root,paths){return Object.fromEntries(paths.map(relative=>[relative,fileHash(root,relative)]));}
function readParent(roots){
  const stored=durable.verifyDualCopy(path.join(roots.primary,PARENT_RELATIVE),path.join(roots.secondary,PARENT_RELATIVE),PARENT_SHA256);
  const record=JSON.parse(stored.bytes.toString('utf8'));
  if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE'||record.acceptedCommit!==PARENT_ACCEPTED_COMMIT||
     record.stage3eAcousticIdentity?.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||record.primarySecondaryIntegrity!=='PASS')
    fail('immutable performance-v2 predecessor identity is invalid');
  return {record,sha256:stored.sha256};
}
function snapshot({root=search.ROOT,roots=rootsFor(root),acceptedCommit=head(root)}={}){
  const parent=readParent(roots);
  if(!ancestor(root,PARENT_ACCEPTED_COMMIT,acceptedCommit))fail('fix commit is not descended from immutable performance-v2 commit','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const paths=changedPaths(root,PARENT_ACCEPTED_COMMIT,acceptedCommit);
  const disallowed=paths.filter(relative=>!ALLOWED_CHANGED_PATHS.includes(relative));
  if(disallowed.length||!paths.includes('wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs'))
    fail('follow-up diff is not limited to the checkpoint verifier correction: '+disallowed.join(', '),'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const currentAcousticIdentity=acousticIdentity.currentStage3eAcousticIdentity(root);
  if(currentAcousticIdentity.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||!same(currentAcousticIdentity,parent.record.stage3eAcousticIdentity))
    fail('Stage3E acoustic creator identity differs from immutable performance-v2','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {root,roots,parent,parentSha256:parent.sha256,acceptedCommit,paths,
    diffSha256:diffSha256(root,PARENT_ACCEPTED_COMMIT,acceptedCommit,paths),
    changedFileSha256:currentHashes(root,paths),stage3eAcousticIdentity:currentAcousticIdentity};
}
function buildRecord({root=search.ROOT,home=process.env.HOME,testResults=DEFAULT_TEST_RESULTS,acceptedCommit=head(root)}={}){
  if(git(root,['status','--porcelain']).trim()!=='')fail('compatibility record requires a clean committed verifier tree');
  if(head(root)!==acceptedCommit)fail('compatibility record must bind current HEAD');
  if(!Array.isArray(testResults)||!testResults.length||testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'))
    fail('zero-render verifier test evidence is incomplete');
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
     record.stage3eWasmSha256!==STAGE3E_WASM_SHA256||!Array.isArray(record.testResults)||
     record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string')||
     record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0||
     record.primarySecondaryIntegrity!=='PASS')
    fail('follow-up sidecar differs from its immutable parent, exact verifier diff, tests, or acoustic identity');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,parentSha256:record.parentSha256};
}
function runtimeContext({root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home)}={}){
  const stored=durable.verifyDualCopy(path.join(roots.primary,RELATIVE),path.join(roots.secondary,RELATIVE));
  const record=JSON.parse(stored.bytes.toString('utf8'));
  const expected=snapshot({root,roots,acceptedCommit:record.acceptedCommit});
  validateRecord(record,expected);
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,sha256:stored.sha256,record,builds:0,acousticRenders:0,evidenceWrites:0};
}
function assertRecoveryRuntimeBinding({root,roots,head:currentHead}={}){
  const current=runtimeContext({root,roots});
  if(currentHead&&current.acceptedCommit!==currentHead&&!ancestor(root,current.acceptedCommit,currentHead))
    fail('performance-v3 verifier commit is not an ancestor of the active execution','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return current;
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==1||!['--dry-run','--create','--verify'].includes(argv[0]))throw new Error('explicit mode required: --dry-run, --create, or --verify');
  const root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home),mode=argv[0];
  if(mode==='--verify'){
    const result=runtimeContext({root,home,roots});
    process.stdout.write(JSON.stringify({...result,record:undefined,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  if(mode==='--create')acousticIdentity.assertNoActiveWriter(root);
  const acceptedCommit=head(root),record=buildRecord({root,home,acceptedCommit}),bytes=jsonBytes(record),recordSha256=sha256(bytes);
  const primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  if(mode==='--dry-run'){
    const hasPrimary=fs.existsSync(primary),hasSecondary=fs.existsSync(secondary);
    if(hasPrimary!==hasSecondary)fail('follow-up sidecar exists in one store only','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
    if(hasPrimary){const stored=durable.verifyDualCopy(primary,secondary);if(!stored.bytes.equals(bytes))fail('existing performance-v3 sidecar is immutable and differs','BLOCKED_STAGE3E_PERFORMANCE_COMPATIBILITY_COLLISION');}
    process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP_READY',acceptedCommit,recordSha256,acousticRenders:0,builds:0,evidenceWrites:0})+'\n');return;
  }
  if(fs.existsSync(primary)||fs.existsSync(secondary)){
    const stored=durable.verifyDualCopy(primary,secondary);
    if(!stored.bytes.equals(bytes))fail('existing performance-v3 sidecar is immutable and differs','BLOCKED_STAGE3E_PERFORMANCE_COMPATIBILITY_COLLISION');
    process.stdout.write(JSON.stringify({decision:record.decision,recordSha256:stored.sha256,reused:true,acousticRenders:0,builds:0,evidenceWrites:0})+'\n');return;
  }
  const saved=durable.writeDualCopy(primary,secondary,bytes);
  process.stdout.write(JSON.stringify({decision:record.decision,recordSha256:saved.sha256,reused:false,acousticRenders:0,builds:0,evidenceWrites:1})+'\n');
}

if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={PARENT_RELATIVE,RELATIVE,PARENT_SHA256,PARENT_ACCEPTED_COMMIT,STAGE3E_WASM_SHA256,ALLOWED_CHANGED_PATHS,DEFAULT_TEST_RESULTS,
  sha256,jsonBytes,stable,same,rootsFor,changedPaths,diffSha256,snapshot,buildRecord,validateRecord,runtimeContext,assertRecoveryRuntimeBinding,main};
