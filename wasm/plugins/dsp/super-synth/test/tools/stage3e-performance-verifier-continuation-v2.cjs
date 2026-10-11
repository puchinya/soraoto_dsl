'use strict';

// Append-only verifier continuation for the immutable performance-v1 record.
// This binds the follow-up verifier code without changing the acoustic creator.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const compatibilityV3=require('./stage3e-search-compatibility-v3.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');

const PARENT_RELATIVE='performance-verifier-compatibility-v1.json';
const RELATIVE='performance-verifier-compatibility-v2.json';
const PARENT_SHA256='76adf3d6326fa0e9c3b8bfb67f2af9dbab11c2575d3cf34131921e1392ca45fa';
const PARENT_ACCEPTED_COMMIT='96a23a01977f2a58213f2b207f700264bf43171e';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const VERIFIER_PINNED_KEYS=Object.freeze(['evidenceValidator','generation2Runner','preflight']);
const ALLOWED_CHANGED_PATHS=Object.freeze([
  'docs/agent-workflow/evidence-preservation.md',
  'docs/design/plugins/dsp/super-synth/super-synth-design.md',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs'
].sort());
const RUNTIME_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs'
]);
const DEFAULT_TEST_RESULTS=Object.freeze([
  {command:'stage3e-performance-verifier-continuation-v2.test.cjs',status:'PASS'},
  {command:'stage3e-performance-verifier-compatibility-v1.test.cjs',status:'PASS'},
  {command:'stage3e-evidence-validator.test.cjs',status:'PASS'},
  {command:'stage3e-evidence-paths.test.cjs',status:'PASS'},
  {command:'stage3e-preflight.test.cjs',status:'PASS'},
  {command:'stage3e-recovery-reconciliation-v2.test.cjs',status:'PASS'},
  {command:'run-stage3e-generation2.test.cjs',status:'PASS'},
  {command:'run-stage3e-master-orchestrator.test.cjs',status:'PASS'},
  {command:'stage3e-incremental-verification.test.cjs',status:'PASS'},
  {command:'capture-supersynth-stage3e-matrix.test.cjs',status:'PASS'},
  {command:'run-stage3e-midi41-evidence-amendment.test.cjs',status:'PASS'},
  {command:'run-stage3e-historical-reference-requalification.test.cjs',status:'PASS'},
  {command:'test_super_synth_metadata.py',status:'PASS'}
]);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fail(message,token='BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'){throw new Error(`${token}: ${message}`);}
function verifierPinnedChanges(parentPinned,currentPinned){
  const parentKeys=Object.keys(parentPinned||{}).sort(),currentKeys=Object.keys(currentPinned||{}).sort();
  if(!same(parentKeys,currentKeys))fail('pinned verifier identity keys changed','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const changes=[];
  for(const key of currentKeys){
    if(parentPinned[key]===currentPinned[key])continue;
    const relative=compatibilityV3.PINNED_PATHS[key];
    if(!VERIFIER_PINNED_KEYS.includes(key)||!relative||!ALLOWED_CHANGED_PATHS.includes(relative))
      fail(`pinned non-verifier identity changed: ${key}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
    changes.push({key,relativePath:relative,parentSha256:parentPinned[key],currentSha256:currentPinned[key]});
  }
  const changedKeys=changes.map(item=>item.key).sort();
  if(!same(changedKeys,VERIFIER_PINNED_KEYS))
    fail('the verifier-only continuation does not match its reviewed pinned-file change set','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return changes.sort((a,b)=>a.key.localeCompare(b.key));
}
function git(root,args,encoding='utf8'){return execFileSync('rtk',['git',...args],{cwd:root,encoding,maxBuffer:64*1024*1024,stdio:encoding?['ignore','pipe','pipe']:'pipe'});}
function head(root){return git(root,['rev-parse','HEAD']).trim();}
function ancestor(root,from,to){try{git(root,['merge-base','--is-ancestor',from,to],null);return true;}catch{return false;}}
function hashCommitFile(root,commit,relative){try{return sha256(git(root,['show',`${commit}:${relative}`],null));}catch{return null;}}
function fileHash(root,relative){const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail('required verifier file is absent: '+relative);return sha256(fs.readFileSync(file));}
function parseChangedPaths(output){return String(output).split(/\r?\n/).map(item=>item.trim()).filter(item=>item&&item!=='Changes:').sort();}
function changedPaths(root,from,to){return parseChangedPaths(git(root,['diff','--name-only','--no-renames',from,to,'--']));}
function diffHash(root,from,to,names){return sha256(git(root,['diff','--binary','--no-compact','--no-ext-diff','--no-renames',from,to,'--',...names],null));}
function rootsFor(root=search.ROOT,home=process.env.HOME){
  if(path.basename(path.resolve(root))!=='soraoto_dsl'||!home)fail('repository or HOME root cannot be resolved','BLOCKED_STAGE3E_EVIDENCE_PATH');
  const common=search.gitCommonDir(root),repository=path.basename(path.resolve(root));
  const basePrimary=path.join(common,'soraoto-agent-state','7','stage3e'),baseSecondary=path.join(home,'.soraoto-agent-archive',repository,'7','stage3e');
  return {primary:path.join(basePrimary,'generation-2','search-v1'),secondary:path.join(baseSecondary,'generation-2','search-v1'),base:{primary:basePrimary,secondary:baseSecondary}};
}
function readDual(roots,relative,expectedSha256){
  const result=durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),expectedSha256);
  return {...result,record:JSON.parse(result.bytes.toString('utf8'))};
}
function v1Module(){return require('./stage3e-performance-verifier-compatibility-v1.cjs');}
function validateParentRecord({root,roots,manifest,parent}={}){
  const v1=v1Module();
  if(parent.record?.schemaVersion!==1||parent.record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'||
     parent.record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||parent.record.acceptedCommit!==PARENT_ACCEPTED_COMMIT||
     parent.record.originalLocalCommit!==v1.ORIGINAL_LOCAL_COMMIT||parent.record.stage3eAcousticIdentity?.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||
     parent.record.primarySecondaryIntegrity!=='PASS')fail('immutable performance-v1 predecessor schema or identity mismatch');
  if(!ancestor(root,parent.record.originalLocalCommit,PARENT_ACCEPTED_COMMIT)||!ancestor(root,PARENT_ACCEPTED_COMMIT,head(root)))
    fail('performance-v1 accepted commit is outside current ancestry');
  let baselineSha256=null,baselineRecord=null;
  for(const expected of v1.V10_CHAIN){
    const item=readDual(roots,expected.relative,expected.sha256);
    if(item.record.attestationSequence!==expected.sequence||item.record.previousVerifierAttestationSha256!==expected.previous)
      fail('immutable v10 verifier chain does not match performance-v1 predecessor');
    baselineSha256=item.sha256;if(expected.sequence===12)baselineRecord=item.record;
  }
  if(baselineSha256!==v1.BASELINE_V10_12_SHA256||baselineSha256!==parent.record.baselineV10_12AttestationSha256||
     baselineRecord?.verifierFixCommit!==v1.ORIGINAL_LOCAL_COMMIT)
    fail('immutable v10-12 chain does not match performance-v1 predecessor');
  if(parent.record.testResultsSha256!==v1.buildTestReportSha256(parent.record.testResults))
    fail('performance-v1 test report digest is invalid');
  for(const [relative,expected] of Object.entries(parent.record.effectiveVerifierBlobHashes||{}))
    if(hashCommitFile(root,PARENT_ACCEPTED_COMMIT,relative)!==expected)fail('performance-v1 accepted source hash mismatch: '+relative);
  const currentPinned=compatibilityV3.pinnedExecutorHashes(root);
  const pinnedChanges=verifierPinnedChanges(parent.record.acceptedPinnedExecutorHashes,currentPinned);
  const acoustic=v1.currentStage3eAcousticIdentity(root);
  if(!same(acoustic,parent.record.stage3eAcousticIdentity)||!same(compatibilityV3.acousticCriticalInputs(manifest),acoustic))
    fail('Stage3E acoustic identity differs from performance-v1','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const capturePath='wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs';
  if(fileHash(root,capturePath)!==parent.record.acceptedPinnedExecutorHashes.captureHelper)
    fail('Stage3E capture helper changed after performance-v1','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {v1,acoustic,currentPinned,parentPinned:parent.record.acceptedPinnedExecutorHashes,pinnedChanges};
}
function runtimeHashes(root){return Object.fromEntries(RUNTIME_PATHS.map(relative=>[relative,fileHash(root,relative)]));}
function snapshot({root=search.ROOT,roots=rootsFor(root),manifest,acceptedCommit=head(root)}={}){
  if(!manifest){const stored=readDual(roots,'generation-2-manifest.json','27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095');manifest=stored.record;}
  evidencePaths.resolveStage3eEvidencePaths(roots,manifest);
  const parent=readDual(roots,PARENT_RELATIVE,PARENT_SHA256);
  const validatedParent=validateParentRecord({root,roots,manifest,parent});
  if(!ancestor(root,PARENT_ACCEPTED_COMMIT,acceptedCommit))fail('continuation commit is not descended from performance-v1 accepted commit');
  const paths=changedPaths(root,PARENT_ACCEPTED_COMMIT,acceptedCommit);
  if(!paths.length||paths.some(relative=>!ALLOWED_CHANGED_PATHS.includes(relative)))
    fail('follow-up commit includes a path outside the verifier-only continuation','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  if(validatedParent.pinnedChanges.some(change=>!paths.includes(change.relativePath)))
    fail('pinned verifier change is absent from the accepted commit diff','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const actualAcoustic=validatedParent.v1.currentStage3eAcousticIdentity(root);
  if(!same(actualAcoustic,validatedParent.acoustic)||actualAcoustic.diagnosticWasmSha256!==STAGE3E_WASM_SHA256)
    fail('acoustic identity drifted during verifier continuation','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {root,roots,manifest,parent,parentSha256:parent.sha256,acceptedCommit,paths,
    diffSha256:diffHash(root,PARENT_ACCEPTED_COMMIT,acceptedCommit,paths),runtimeVerifierHashes:runtimeHashes(root),
    parentPinnedExecutorHashes:validatedParent.parentPinned,
    parentPinnedExecutorHashesSha256:sha256(jsonBytes(validatedParent.parentPinned)),
    verifierPinnedHashChanges:validatedParent.pinnedChanges,
    currentPinnedExecutorHashes:validatedParent.currentPinned,stage3eAcousticIdentity:actualAcoustic};
}
function buildRecord({root=search.ROOT,home=process.env.HOME,manifest,testResults=DEFAULT_TEST_RESULTS,acceptedCommit=head(root)}={}){
  if(git(root,['status','--porcelain']).trim()!=='')fail('continuation record must be built from a clean committed tree');
  if(head(root)!==acceptedCommit)fail('accepted continuation commit must be current HEAD');
  if(!Array.isArray(testResults)||testResults.length===0||testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'))
    fail('zero-render continuation test report is incomplete');
  const state=snapshot({root,roots:rootsFor(root,home),manifest,acceptedCommit});
  return {schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION',
    decision:'STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE',parentRelative:PARENT_RELATIVE,
    parentSha256:state.parentSha256,parentAcceptedCommit:PARENT_ACCEPTED_COMMIT,acceptedCommit,
    allowedChangedPaths:state.paths,allowedVerifierOnlyDiffSha256:state.diffSha256,
    parentPinnedExecutorHashesSha256:state.parentPinnedExecutorHashesSha256,
    verifierPinnedHashChanges:state.verifierPinnedHashChanges,
    runtimeVerifierHashes:state.runtimeVerifierHashes,currentPinnedExecutorHashes:state.currentPinnedExecutorHashes,
    stage3eAcousticIdentity:state.stage3eAcousticIdentity,captureHelperSha256:state.currentPinnedExecutorHashes.captureHelper,
    testResults,testResultsSha256:sha256(jsonBytes(testResults)),primarySecondaryIntegrity:'PASS'};
}
function validateRecord(record,expected){
  if(!record||record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE'||record.parentRelative!==PARENT_RELATIVE||
     record.parentSha256!==expected.parentSha256||record.parentAcceptedCommit!==PARENT_ACCEPTED_COMMIT||
     record.acceptedCommit!==expected.acceptedCommit||!ancestor(expected.root,PARENT_ACCEPTED_COMMIT,record.acceptedCommit)||
     !ancestor(expected.root,record.acceptedCommit,head(expected.root))||
     !same(record.allowedChangedPaths,expected.paths)||record.allowedVerifierOnlyDiffSha256!==expected.diffSha256||
     record.parentPinnedExecutorHashesSha256!==expected.parentPinnedExecutorHashesSha256||
     !same(record.verifierPinnedHashChanges,expected.verifierPinnedHashChanges)||
     !same(record.runtimeVerifierHashes,expected.runtimeVerifierHashes)||!same(record.currentPinnedExecutorHashes,expected.currentPinnedExecutorHashes)||
     !same(record.stage3eAcousticIdentity,expected.stage3eAcousticIdentity)||
     record.captureHelperSha256!==expected.currentPinnedExecutorHashes.captureHelper||record.stage3eAcousticIdentity?.diagnosticWasmSha256!==STAGE3E_WASM_SHA256||
     !Array.isArray(record.testResults)||record.testResults.length===0||record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string')||
     !same(record.testResults,DEFAULT_TEST_RESULTS)||record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.primarySecondaryIntegrity!=='PASS')
    fail('continuation sidecar does not match its immutable predecessor, verifier commit, tests, or current acoustic identity');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,parentSha256:record.parentSha256};
}
function runtimeContext({root=search.ROOT,home=process.env.HOME,manifest,roots=rootsFor(root,home)}={}){
  const stored=readDual(roots,RELATIVE),record=stored.record;
  const state=snapshot({root,roots,manifest,acceptedCommit:record.acceptedCommit});
  validateRecord(record,state);
  if(!same(record.runtimeVerifierHashes,runtimeHashes(root)))fail('current verifier blobs differ from the appended continuation');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,sha256:stored.sha256,record,
    builds:0,acousticRenders:0,evidenceWrites:0};
}
function assertRecoveryRuntimeBinding({root,roots,head:currentHead}={}){
  const current=runtimeContext({root,roots});
  if(currentHead&&current.acceptedCommit!==currentHead&&!ancestor(root,current.acceptedCommit,currentHead))
    fail('recovery verifier continuation is not an ancestor of the active execution');
  return current;
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==1||!['--dry-run','--create','--verify'].includes(argv[0]))throw new Error('explicit mode required: --dry-run, --create, or --verify');
  const root=search.ROOT,home=process.env.HOME,roots=rootsFor(root,home),mode=argv[0];
  if(mode==='--verify'){
    const result=runtimeContext({root,home,roots});
    process.stdout.write(JSON.stringify({...result,record:undefined,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  if(mode==='--create')v1Module().assertNoActiveWriter(root);
  const manifest=readDual(roots,'generation-2-manifest.json','27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095').record;
  const record=buildRecord({root,home,manifest}),bytes=jsonBytes(stable(record)),recordSha256=sha256(bytes);
  if(mode==='--dry-run'){
    const existingPrimary=fs.existsSync(path.join(roots.primary,RELATIVE)),existingSecondary=fs.existsSync(path.join(roots.secondary,RELATIVE));
    if(existingPrimary!==existingSecondary)fail('continuation exists in only one store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
    if(existingPrimary){
      const existing=durable.verifyDualCopy(path.join(roots.primary,RELATIVE),path.join(roots.secondary,RELATIVE));
      if(!existing.bytes.equals(bytes))fail('existing continuation is immutable and differs','BLOCKED_STAGE3E_PERFORMANCE_COMPATIBILITY_COLLISION');
    }
    process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_CONTINUATION_READY',recordSha256,
      acceptedCommit:record.acceptedCommit,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  const primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  if(fs.existsSync(primary)||fs.existsSync(secondary)){
    const existing=durable.verifyDualCopy(primary,secondary);
    if(!existing.bytes.equals(bytes))fail('existing continuation is immutable and differs','BLOCKED_STAGE3E_PERFORMANCE_COMPATIBILITY_COLLISION');
    process.stdout.write(JSON.stringify({decision:record.decision,recordSha256:existing.sha256,reused:true,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  durable.writeDualCopy(primary,secondary,bytes);
  const saved=durable.verifyDualCopy(primary,secondary,recordSha256);
  process.stdout.write(JSON.stringify({decision:record.decision,recordSha256:saved.sha256,reused:false,builds:0,acousticRenders:0,evidenceWrites:1})+'\n');
}

if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={PARENT_RELATIVE,RELATIVE,PARENT_SHA256,PARENT_ACCEPTED_COMMIT,STAGE3E_WASM_SHA256,
  ALLOWED_CHANGED_PATHS,RUNTIME_PATHS,DEFAULT_TEST_RESULTS,VERIFIER_PINNED_KEYS,sha256,jsonBytes,stable,same,rootsFor,verifierPinnedChanges,
  parseChangedPaths,changedPaths,diffHash,runtimeHashes,buildRecord,validateRecord,runtimeContext,assertRecoveryRuntimeBinding,main};
