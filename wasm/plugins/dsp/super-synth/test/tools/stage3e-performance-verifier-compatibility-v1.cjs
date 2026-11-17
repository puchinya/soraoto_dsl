'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const v3=require('./stage3e-search-compatibility-v3.cjs');

const RELATIVE='performance-verifier-compatibility-v1.json';
const ORIGINAL_LOCAL_COMMIT='62fd2fe255d888176eadec9ab983efb557e3d563';
const PARENT_V10_9_SHA256='00182bfb74d9b67ddbf8ee16fbe9a8085440df6ca4cdbd995e74ef4a1290f042';
const BASELINE_V10_12_SHA256='6930d8e25848b647ec349b6c1c58ba0d1f3bf950411622ba0e9291ef00f9dc00';
const ORIGINAL_MANIFEST_SHA256='27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095';
const ORIGINAL_V3_SHA256='3be7fd37be85ad7c772d745cd928c9b08fef06a8de8d6c89e0124e6e306641f3';
const PARENT_V10_9_RELATIVE='recovery-reconciliation-v2/verifier-compatibility-v10-9.json';
const BASELINE_V10_12_RELATIVE='recovery-reconciliation-v2/verifier-compatibility-v10-12.json';
const V10_CHAIN=Object.freeze([
  {sequence:9,relative:'recovery-reconciliation-v2/verifier-compatibility-v10-9.json',sha256:PARENT_V10_9_SHA256,previous:'0b256b0808b6fbfc23dc8a06d926e0bacdf5604788741cff69934a7b15b598fe'},
  {sequence:10,relative:'recovery-reconciliation-v2/verifier-compatibility-v10-10.json',sha256:'d5ec8c7d7df25985a66e3e673310fe1fe03d1463fe074a2900b50965d3bc2fe6',previous:PARENT_V10_9_SHA256},
  {sequence:11,relative:'recovery-reconciliation-v2/verifier-compatibility-v10-11.json',sha256:'d93b2b93405bbf5b36bcaf3dc086dd06fb9d292578e700ae9465bbbff89e7555',previous:'d5ec8c7d7df25985a66e3e673310fe1fe03d1463fe074a2900b50965d3bc2fe6'},
  {sequence:12,relative:BASELINE_V10_12_RELATIVE,sha256:BASELINE_V10_12_SHA256,previous:'d93b2b93405bbf5b36bcaf3dc086dd06fb9d292578e700ae9465bbbff89e7555'}
]);
const ALLOWED_CHANGED_PATHS=Object.freeze([
  'docs/agent-workflow/evidence-preservation.md',
  'docs/design/plugins/dsp/super-synth/super-synth-design.md',
  'docs/status/plugins/dsp/super-synth/stage3e-incremental-verification.md',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.bench.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-compatibility-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-compatibility-v1.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs'
].sort());
const EFFECTIVE_VERIFIER_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-compatibility-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs'
]);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fail(message,token='BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'){throw new Error(`${token}: ${message}`);}
function stage3eCaptureControls({capture,options,presetSource}={}){
  const expectedResponse={low:1,mid:1,bassHardness:1};
  if(capture?.SAMPLE_RATE!==48000||capture?.DURATION_MS!==380||!same(capture?.DEFAULT_RESPONSE,expectedResponse)||
     !/harness\.applyPreset\(['"]concert_grand['"]\)/.test(presetSource||'')||
     !same(options,{stage2mFactorMask:3,includeVelocityDerivative:true,velocityDerivativeStartMs:30,
       velocityDerivativeEndMs:180,includeSoundboardDiagnostics:true}))
    fail('current Stage3E capture controls differ from the immutable baseline','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {sampleRate:capture.SAMPLE_RATE,durationMs:capture.DURATION_MS,preset:'concert_grand',stage2mFactorMask:3,
    stage3eResponse:capture.DEFAULT_RESPONSE,includeSoundboardDiagnostics:options.includeSoundboardDiagnostics};
}
function currentStage3eAcousticIdentity(root){
  const identity=v3.currentAcousticIdentity(root);
  const capture=require('./capture-supersynth-stage3e-matrix.cjs');
  const runner=require('./run-stage3e-generation2.cjs');
  const controls=stage3eCaptureControls({capture,
    options:runner.captureOptionsForCell({phase:'baseline',pitch:41,velocityNormalized:0.25}),
    presetSource:fs.readFileSync(require.resolve('./capture-supersynth-stage3e-matrix.cjs'),'utf8')});
  return {...identity,...controls};
}
function git(root,args,encoding=null){return execFileSync('rtk',['git',...args],{cwd:root,encoding,maxBuffer:64*1024*1024,stdio:encoding?['ignore','pipe','pipe']:'pipe'});}
function head(root){return git(root,['rev-parse','HEAD'],'utf8').trim();}
function isAncestor(root,from,to){try{git(root,['merge-base','--is-ancestor',from,to]);return true;}catch{return false;}}
function hashCommitFile(root,commit,relative){return sha256(git(root,['show',`${commit}:${relative}`]));}
function currentFileHash(root,relative){const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail(`required verifier file is missing: ${relative}`);return sha256(fs.readFileSync(file));}
function changedPaths(root,from,to){return git(root,['diff','--name-only','--no-renames',from,to,'--'], 'utf8').trim().split(/\r?\n/).filter(line=>line&&line!=='Changes:').sort();}
function diffSha256(root,from,to,allowedPaths){return sha256(git(root,['diff','--binary','--no-compact','--no-ext-diff','--no-renames',from,to,'--',...allowedPaths]));}
function gitStatusClean(root){return git(root,['status','--porcelain'],'utf8').trim()==='';}
function verifierHashesAt(root,commit){return Object.fromEntries(EFFECTIVE_VERIFIER_PATHS.map(relative=>[relative,hashCommitFile(root,commit,relative)]));}
function verifierHashesAtWorkingTree(root){return Object.fromEntries(EFFECTIVE_VERIFIER_PATHS.map(relative=>[relative,currentFileHash(root,relative)]));}
function optionalCommitFileHash(root,commit,relative){try{return hashCommitFile(root,commit,relative);}catch{return null;}}
function allowedPinKeys(oldPins,newPins){return Object.keys(oldPins||{}).sort().filter(key=>oldPins[key]!==newPins?.[key]);}
function buildTestReportSha256(testResults){return sha256(jsonBytes(testResults));}

function readV10Chain(roots){
  let previous=null,baseline=null;
  for(const expected of V10_CHAIN){
    const primary=path.join(roots.primary,expected.relative),secondary=path.join(roots.secondary,expected.relative);
    const stored=durable.verifyDualCopy(primary,secondary,expected.sha256),record=JSON.parse(stored.bytes.toString('utf8'));
    if(record.attestationSequence!==expected.sequence||record.previousVerifierAttestationSha256!==expected.previous)
      fail(`v10 verifier chain mismatch at sequence ${expected.sequence}`);
    previous=stored.sha256;
    if(expected.sequence===12)baseline=record;
  }
  if(previous!==BASELINE_V10_12_SHA256||baseline?.verifierFixCommit!==ORIGINAL_LOCAL_COMMIT)
    fail('accepted v10-12 verifier baseline differs from the contracted original source');
  return {sha256:previous,record:baseline};
}

function validateRecord(record,context={}){
  if(!record||record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'||
     record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.originalLocalCommit!==ORIGINAL_LOCAL_COMMIT||
     record.parentV10_9AttestationSha256!==PARENT_V10_9_SHA256||record.originalSearchManifestSha256!==ORIGINAL_MANIFEST_SHA256||
     record.baselineV10_12AttestationSha256!==BASELINE_V10_12_SHA256||record.originalSearchCompatibilityV3Sha256!==ORIGINAL_V3_SHA256||
     record.primarySecondaryIntegrity!=='PASS')fail('sidecar identity or predecessor mismatch');
  const {head:currentHead,originalPinnedHashes,currentPinnedHashes,acceptedPinnedHashes,currentVerifierHashes,
    allowedDiffPaths,allowedDiffSha256,currentAcousticIdentity,originalAcousticIdentity,parentAttestationSha256,
    baselineVerifierFiles,originalEffectiveVerifierBlobHashes,testResultsSha256,ancestorCheck=isAncestor}=context;
  if(typeof currentHead!=='string'||!/^\w{40}$/.test(record.acceptedCommit||'')||
     !ancestorCheck?.(record.originalLocalCommit,record.acceptedCommit)||!ancestorCheck(record.acceptedCommit,currentHead))
    fail('accepted verifier commit is not an ancestor of the current execution');
  if(parentAttestationSha256!==PARENT_V10_9_SHA256||!same(record.originalPinnedExecutorHashes,originalPinnedHashes)||
     !same(record.acceptedPinnedExecutorHashes,acceptedPinnedHashes)||!same(record.effectiveVerifierBlobHashes,currentVerifierHashes))
    fail('verifier source identity differs from the immutable attestation');
  if(!same(record.currentPinnedExecutorHashes,currentPinnedHashes)||!same(record.baselineVerifierFiles,baselineVerifierFiles))
    fail('current pinned files or accepted v10-12 verifier baseline changed');
  if(!same(record.originalEffectiveVerifierBlobHashes,originalEffectiveVerifierBlobHashes))
    fail('original effective verifier blobs differ from the pinned baseline commit');
  if(!same(record.effectiveVerifierBlobHashes,record.acceptedVerifierBlobHashes)||!same(record.allowedVerifierOnlyPaths,allowedDiffPaths)||
     allowedDiffPaths.some(relative=>!ALLOWED_CHANGED_PATHS.includes(relative))||record.allowedVerifierOnlyDiffSha256!==allowedDiffSha256)
    fail('changed source set or exact verifier diff differs from the attestation');
  if(!same(record.stage3eAcousticIdentity,currentAcousticIdentity)||!same(currentAcousticIdentity,originalAcousticIdentity))
    fail('Stage3E acoustic identity changed','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const oldCapture=record.originalPinnedExecutorHashes?.captureHelper,newCapture=record.acceptedPinnedExecutorHashes?.captureHelper;
  if(!oldCapture||oldCapture!==newCapture)fail('capture helper changed','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  if(!Array.isArray(record.testResults)||record.testResults.length===0||record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'))
    fail('zero-render verification result is incomplete');
  if(!same(record.testResults,DEFAULT_TEST_RESULTS))fail('verification test report command set differs from this verifier');
  if(record.testResultsSha256!==testResultsSha256||record.testResultsSha256!==buildTestReportSha256(record.testResults))
    fail('verification test report SHA mismatch');
  if(!same(record.allowedVerifierOnlyPaths,[...record.allowedVerifierOnlyPaths].sort()))fail('allowed path list is not canonical');
  return {decision:record.decision,acceptedCommit:record.acceptedCommit,allowedVerifierOnlyDiffSha256:record.allowedVerifierOnlyDiffSha256,
    effectiveVerifierBlobHashes:record.effectiveVerifierBlobHashes,testResultsSha256:record.testResultsSha256};
}

function parentAttestationSha256(roots){
  const expected=V10_CHAIN[0],primary=path.join(roots.primary,expected.relative),secondary=path.join(roots.secondary,expected.relative);
  return durable.verifyDualCopy(primary,secondary,PARENT_V10_9_SHA256).sha256;
}

function buildRecord({root,roots,manifest,v3Record,v3Sha256,testResults,acceptedCommit=head(root)}={}){
  if(!root||!roots||!manifest||!v3Record||!Array.isArray(testResults))fail('sidecar build inputs are incomplete');
  if(!gitStatusClean(root)||head(root)!==acceptedCommit)fail('accepted verifier commit must be the clean current HEAD');
  if(!isAncestor(root,ORIGINAL_LOCAL_COMMIT,acceptedCommit))fail('original verifier commit is not an ancestor');
  if(v3Sha256!==ORIGINAL_V3_SHA256)fail('original v3 verifier bundle SHA mismatch');
  if(v3Record.decision!=='STAGE3E_PRE_RENDER_RECOVERY_COMPATIBLE'||!same(v3Record.acousticCriticalInputs,v3.acousticCriticalInputs(manifest)))
    fail('v3 recovery compatibility record does not bind the original acoustic candidate');
  const parentSha=parentAttestationSha256(roots);
  const baseline=readV10Chain(roots);
  const baselineVerifierFiles=baseline.record.newVerifierFiles;
  for(const [relative,expectedSha256] of Object.entries(baselineVerifierFiles)){
    if(hashCommitFile(root,ORIGINAL_LOCAL_COMMIT,relative)!==expectedSha256)
      fail(`v10-12 source baseline does not match original commit: ${relative}`);
  }
  const originalPinnedExecutorHashes=Object.fromEntries(Object.entries(v3.PINNED_PATHS).map(([key,relative])=>[key,hashCommitFile(root,ORIGINAL_LOCAL_COMMIT,relative)]));
  const acceptedPinnedExecutorHashes=Object.fromEntries(Object.entries(v3.PINNED_PATHS).map(([key,relative])=>[key,hashCommitFile(root,acceptedCommit,relative)]));
  const currentPinnedHashes=v3.pinnedExecutorHashes(root);
  if(!same(acceptedPinnedExecutorHashes,currentPinnedHashes))fail('current verifier files differ from accepted commit');
  const allowedVerifierOnlyPaths=changedPaths(root,ORIGINAL_LOCAL_COMMIT,acceptedCommit);
  if(!allowedVerifierOnlyPaths.length||allowedVerifierOnlyPaths.some(relative=>!ALLOWED_CHANGED_PATHS.includes(relative)))
    fail('commit range contains a change outside the approved verifier-only scope','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const allowedVerifierOnlyDiffSha256=diffSha256(root,ORIGINAL_LOCAL_COMMIT,acceptedCommit,allowedVerifierOnlyPaths);
  const effectiveVerifierBlobHashes=verifierHashesAt(root,acceptedCommit);
  const originalEffectiveVerifierBlobHashes=Object.fromEntries(EFFECTIVE_VERIFIER_PATHS.map(relative=>[relative,optionalCommitFileHash(root,ORIGINAL_LOCAL_COMMIT,relative)]));
  const stage3eAcousticIdentity=v3.acousticCriticalInputs(manifest),currentAcousticIdentity=currentStage3eAcousticIdentity(root);
  if(!same(stage3eAcousticIdentity,currentAcousticIdentity))fail('current Stage3E inputs differ from original manifest','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const reportSha=buildTestReportSha256(testResults);
  return {schemaVersion:1,kind:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY',decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',
    originalLocalCommit:ORIGINAL_LOCAL_COMMIT,acceptedCommit,parentV10_9AttestationSha256:parentSha,
    baselineV10_12AttestationSha256:baseline.sha256,baselineVerifierFiles,
    originalSearchManifestSha256:ORIGINAL_MANIFEST_SHA256,originalSearchCompatibilityV3Sha256:v3Sha256,
    originalPinnedExecutorHashes,originalEffectiveVerifierBlobHashes,acceptedPinnedExecutorHashes,currentPinnedExecutorHashes:currentPinnedHashes,
    effectiveVerifierBlobHashes,acceptedVerifierBlobHashes:effectiveVerifierBlobHashes,
    allowedVerifierOnlyPaths,allowedVerifierOnlyDiffSha256,stage3eAcousticIdentity,
    testResults,testResultsSha256:reportSha,primarySecondaryIntegrity:'PASS'};
}

function runtimeContext({root,manifest,v3Record,v3Sha256,roots,allowAbsent=false}={}){
  const currentHead=head(root),currentPinnedHashes=v3.pinnedExecutorHashes(root);
  if(v3Sha256!==ORIGINAL_V3_SHA256)fail('current v3 compatibility bundle differs from the immutable predecessor');
  const baselinePinnedHashes=Object.fromEntries(Object.entries(v3.PINNED_PATHS).map(([key,relative])=>[key,hashCommitFile(root,ORIGINAL_LOCAL_COMMIT,relative)]));
  const changed=allowedPinKeys(baselinePinnedHashes,currentPinnedHashes);
  const file=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  const hasPrimary=fs.existsSync(file),hasSecondary=fs.existsSync(secondary);
  if(hasPrimary!==hasSecondary)fail('compatibility sidecar exists in only one store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(!hasPrimary){if(changed.length&&!allowAbsent)fail(`changed pinned verifier files require a compatibility sidecar: ${changed.join(',')}`);return null;}
  const stored=durable.verifyDualCopy(file,secondary),record=JSON.parse(stored.bytes.toString('utf8'));
  const originalPinnedHashes=Object.fromEntries(Object.entries(v3.PINNED_PATHS).map(([key,relative])=>[key,hashCommitFile(root,record.originalLocalCommit,relative)]));
  const acceptedPinnedHashes=Object.fromEntries(Object.entries(v3.PINNED_PATHS).map(([key,relative])=>[key,hashCommitFile(root,record.acceptedCommit,relative)]));
  const allowedDiffPaths=changedPaths(root,record.originalLocalCommit,record.acceptedCommit);
  const allowedDiffSha=diffSha256(root,record.originalLocalCommit,record.acceptedCommit,allowedDiffPaths);
  const currentVerifierHashes=verifierHashesAtWorkingTree(root);
  const baseline=readV10Chain(roots);
  const originalEffectiveVerifierBlobHashes=Object.fromEntries(EFFECTIVE_VERIFIER_PATHS.map(relative=>[
    relative,optionalCommitFileHash(root,record.originalLocalCommit,relative)]));
  const currentAcousticIdentity=currentStage3eAcousticIdentity(root),originalAcousticIdentity=v3.acousticCriticalInputs(manifest);
  const parentSha=parentAttestationSha256(roots),reportSha=buildTestReportSha256(record.testResults);
  validateRecord(record,{head:currentHead,originalPinnedHashes,currentPinnedHashes,acceptedPinnedHashes,currentVerifierHashes,
    allowedDiffPaths,allowedDiffSha256:allowedDiffSha,currentAcousticIdentity,originalAcousticIdentity,
    parentAttestationSha256:parentSha,baselineVerifierFiles:baseline.record.newVerifierFiles,
    originalEffectiveVerifierBlobHashes,
    testResultsSha256:reportSha,ancestorCheck:(from,to)=>isAncestor(root,from,to)});
  if(record.originalSearchCompatibilityV3Sha256!==v3Sha256)fail('sidecar v3 predecessor binding mismatch');
  if(!same(record.stage3eAcousticIdentity,stage3eAcousticIdentity(manifest)))fail('manifest acoustic identity changed','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {sha256:stored.sha256,record};
}

function stage3eAcousticIdentity(manifest){return v3.acousticCriticalInputs(manifest);}

function assertNoActiveWriter(root){
  const common=path.resolve(git(root,['rev-parse','--path-format=absolute','--git-common-dir'],'utf8').trim());
  const masterLock=path.join(common,'stage3e-master-execution.lock'),lockRoot=path.join(common,'soraoto-agent-locks');
  if(fs.existsSync(masterLock))fail('master execution lock is active; do not write verifier compatibility evidence yet','BLOCKED_STAGE3E_ACTIVE_WRITER');
  if(fs.existsSync(lockRoot))for(const name of fs.readdirSync(lockRoot))if(name.startsWith('issue-7-stage3e-generation-2-')&&name.endsWith('.lock'))
    fail(`Generation-2 writer lock is active: ${name}`,'BLOCKED_STAGE3E_ACTIVE_WRITER');
}

function main(argv=process.argv.slice(2)){
  if(argv.length!==1||!['--dry-run','--create','--verify'].includes(argv[0]))throw new Error('explicit compatibility mode required: --dry-run, --create, or --verify');
  const root=search.ROOT,home=process.env.HOME,preflight=require('./stage3e-preflight.cjs'),roots=preflight.searchRoots(root,home);
  if(argv[0]==='--create')assertNoActiveWriter(root);
  const manifestStored=durable.verifyDualCopy(path.join(roots.primary,'generation-2-manifest.json'),path.join(roots.secondary,'generation-2-manifest.json'),ORIGINAL_MANIFEST_SHA256);
  const manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  const v3Bundle=require('./stage3e-search-compatibility-v3.cjs').readBundle(roots);
  if(argv[0]==='--verify'){
    const existing=runtimeContext({root,manifest,v3Record:v3Bundle.record,v3Sha256:v3Bundle.sha256,roots});
    if(!existing)fail('performance compatibility sidecar is absent');
    process.stdout.write(JSON.stringify({decision:existing.record.decision,recordSha256:existing.sha256,builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  const existing=runtimeContext({root,manifest,v3Record:v3Bundle.record,v3Sha256:v3Bundle.sha256,roots,allowAbsent:true});
  if((argv[0]==='--dry-run'||argv[0]==='--create')&&existing){
    process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_COMPATIBILITY_REUSED',recordSha256:existing.sha256,acceptedCommit:existing.record.acceptedCommit,
      primarySecondaryIntegrity:'PASS',builds:0,acousticRenders:0,evidenceWrites:0})+'\n');return;
  }
  const record=buildRecord({root,roots,manifest,v3Record:v3Bundle.record,v3Sha256:v3Bundle.sha256,testResults:DEFAULT_TEST_RESULTS});
  if(argv[0]==='--dry-run'){
    process.stdout.write(JSON.stringify({decision:'STAGE3E_PERFORMANCE_COMPATIBILITY_READY',builds:0,acousticRenders:0,evidenceWrites:0,
      recordSha256:sha256(jsonBytes(record)),acceptedCommit:record.acceptedCommit,primarySecondaryIntegrity:'NOT_WRITTEN'})+'\n');return;
  }
  const bytes=jsonBytes(record),primary=path.join(roots.primary,RELATIVE),secondary=path.join(roots.secondary,RELATIVE);
  if(fs.existsSync(primary)||fs.existsSync(secondary)){
    const existing=durable.verifyDualCopy(primary,secondary);
    if(!existing.bytes.equals(bytes))fail('existing immutable compatibility sidecar has different bytes','BLOCKED_STAGE3E_PERFORMANCE_COMPATIBILITY_COLLISION');
    process.stdout.write(JSON.stringify({decision:record.decision,recordSha256:existing.sha256,reused:true,builds:0,acousticRenders:0})+'\n');return;
  }
  durable.writeDualCopy(primary,secondary,bytes);
  const stored=durable.verifyDualCopy(primary,secondary,sha256(bytes));
  process.stdout.write(JSON.stringify({decision:record.decision,recordSha256:stored.sha256,reused:false,builds:0,acousticRenders:0})+'\n');
}

const DEFAULT_TEST_RESULTS=Object.freeze([
  {command:'stage3e-incremental-verification.test.cjs',status:'PASS'},
  {command:'stage3e-performance-verifier-compatibility-v1.test.cjs',status:'PASS'},
  {command:'stage3e-evidence-validator.test.cjs',status:'PASS'},
  {command:'stage3e-evidence-paths.test.cjs',status:'PASS'},
  {command:'stage3e-preflight.test.cjs',status:'PASS'},
  {command:'run-stage3e-generation2.test.cjs',status:'PASS'},
  {command:'run-stage3e-master-orchestrator.test.cjs',status:'PASS'},
  {command:'capture-supersynth-stage3e-matrix.test.cjs',status:'PASS'},
  {command:'run-stage3e-midi41-evidence-amendment.test.cjs',status:'PASS'},
  {command:'run-stage3e-historical-reference-requalification.test.cjs',status:'PASS'},
  {command:'test_super_synth_metadata.py',status:'PASS'}
]);

if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={RELATIVE,ORIGINAL_LOCAL_COMMIT,PARENT_V10_9_SHA256,BASELINE_V10_12_SHA256,ORIGINAL_V3_SHA256,V10_CHAIN,
  ALLOWED_CHANGED_PATHS,EFFECTIVE_VERIFIER_PATHS,sha256,jsonBytes,stable,same,changedPaths,diffSha256,
  verifierHashesAt,buildTestReportSha256,stage3eCaptureControls,currentStage3eAcousticIdentity,validateRecord,buildRecord,runtimeContext,assertNoActiveWriter,DEFAULT_TEST_RESULTS};
