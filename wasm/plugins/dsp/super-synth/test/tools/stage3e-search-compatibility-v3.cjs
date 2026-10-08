'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const v2=require('./stage3e-search-compatibility.cjs');
const validator=require('./stage3e-evidence-validator.cjs');

const RELATIVE='verifier-compatibility-v3.json';
const SHA_RELATIVE='verifier-compatibility-v3.sha256';
const ARCHIVE_RELATIVE='archives/verifier-compatibility-v3.tar.gz';
const ARCHIVE_SHA_RELATIVE='archives/verifier-compatibility-v3.tar.gz.sha256';
const V2_ACCEPTED_COMMIT='01c059ae9497119e5ef22d273958ca33eeade9a0';
const PRE_ABORT_LEDGER_SHA256='c8c0d162aafcf30908e4b1d7637245ecb6418328a75cee35d76303328960109f';
const FORENSIC_RELATIVE='pre-render-abort-recovery-v1/forensic-evidence.json';
const PINNED_PATHS=Object.freeze({
  captureHelper:'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs',
  generation2Runner:'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  generation2Core:'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs',
  searchCore:'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-core.cjs',
  preflight:'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  evidenceValidator:'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  evidencePaths:'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.cjs',
  masterOrchestrator:'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.cjs',
  velocityResponseRunner:'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs',
  amendmentRunner:'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.cjs',
  recoveryRunner:'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-pre-render-abort-recovery.cjs',
  compatibilityV3:'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-compatibility-v3.cjs',
});
const IDENTITY_FIELDS=['candidateId','diagnosticWasmSha256','sourcePluginSha256','configSha256','profileSha256','presetsSha256','referenceFixtureSha256'];

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fail(message,token='BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY'){throw new Error(`${token}: ${message}`);}
function hashFile(root,relative){const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail(`pinned executor is missing: ${relative}`);return sha256(fs.readFileSync(file));}
function pinnedExecutorHashes(root){return Object.fromEntries(Object.entries(PINNED_PATHS).map(([key,relative])=>[key,hashFile(root,relative)]));}
function isAncestor(root,from,to){try{execFileSync('rtk',['git','merge-base','--is-ancestor',from,to],{cwd:root,stdio:'ignore'});return true;}catch{return false;}}
function currentHead(root){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function assertClean(root){const state=execFileSync('rtk',['git','status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim();if(state)fail('tracked worktree must be clean before bridge creation');}
function acousticCriticalInputs(manifest){
  const protectedIdentity=manifest?.identity?.protectedIdentity;
  if(!protectedIdentity)fail('immutable Generation-2 acoustic identity is missing','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const identity=Object.fromEntries(IDENTITY_FIELDS.map(key=>[key,key==='candidateId'?manifest.identity.candidateId:protectedIdentity[key]]));
  return {...identity,sampleRate:48000,durationMs:380,preset:'concert_grand',stage2mFactorMask:3,
    stage3eResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true};
}
function currentAcousticIdentity(root){
  const current=search.currentProtectedIdentity(root);
  const wasmPath=path.join(path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm-stage3e')),'plugins/dsp/super-synth/plugin.wasm');
  if(!fs.existsSync(wasmPath))fail('Stage3E diagnostic WASM is missing','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {candidateId:current.candidateId,diagnosticWasmSha256:sha256(fs.readFileSync(wasmPath)),sourcePluginSha256:current.sourcePluginSha256,
    configSha256:current.configSha256,profileSha256:current.profileSha256,presetsSha256:current.presetsSha256,
    referenceFixtureSha256:current.referenceFixtureSha256};
}
function buildRecord({root,manifest,manifestSha256,v1Sha256,v2Sha256,sourceAudit,sourceAuditSha256,
  preAbortEvidence,preAbortEvidenceSha256,recoveryCommit,head=currentHead(root)}={}){
  if(!root||!manifest||!sourceAudit||!preAbortEvidence)fail('bridge inputs are incomplete');
  assertClean(root);
  if(!/^[0-9a-f]{40}$/.test(recoveryCommit||'')||head!==recoveryCommit)fail('recovery commit must be the clean current HEAD');
  if(!isAncestor(root,V2_ACCEPTED_COMMIT,recoveryCommit))fail('v2 accepted commit is not an ancestor of recovery commit');
  if(manifestSha256!==validator.SEARCH_MANIFEST_SHA256||manifest.identity?.creatorRevision!=='79121646babd0e1031de03aae1a5bed486e59f8a')fail('original search manifest identity mismatch');
  if(v1Sha256!==v2.V1_SHA256||v2Sha256!== '5f3340f7b993bb879aa29bca4214e5192008f54308d20160282aac0cfcc6f797')fail('v1/v2 predecessor identity mismatch');
  if(sourceAuditSha256!==validator.SOURCE_AUDIT_SHA256)fail('frozen source audit SHA mismatch','BLOCKED_STAGE3E_AMENDMENT_EVIDENCE');
  const inventorySha256=v2.fixedInventorySha(sourceAudit);
  if(inventorySha256!=='25e4bb121a8714bc90cd83ed00df1c8eb577208b87d2e272b15fc389fd212adf')fail('fixed 35-file inventory digest mismatch','BLOCKED_STAGE3E_AMENDMENT_EVIDENCE');
  if(preAbortEvidenceSha256!=='e601de82fbb382065b0d3c7efed6da8540c25681d5e622a11fb74a4cf12bb482'||
     preAbortEvidence.decision!=='PRE_RENDER_ABORT_FORENSICS_VERIFIED'||preAbortEvidence.preAbortLedgerSha256!==PRE_ABORT_LEDGER_SHA256||
     preAbortEvidence.bootstrapLedgerSha256!==validator.LOW_GENESIS_SHA256||preAbortEvidence.searchManifestSha256!==validator.SEARCH_MANIFEST_SHA256||
     preAbortEvidence.harnessConstructionCount!==0&&preAbortEvidence.isolatedOldSourceReproduction?.harnessConstructionCount!==0||
     preAbortEvidence.isolatedOldSourceReproduction?.acousticRenderCalls!==0)
    fail('immutable pre-render forensic proof mismatch','BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING');
  const acoustic=acousticCriticalInputs(manifest),current=currentAcousticIdentity(root);
  const manifestAcoustic=Object.fromEntries(IDENTITY_FIELDS.map(key=>[key,acoustic[key]]));
  if(!same(manifestAcoustic,current)||current.diagnosticWasmSha256!==v2.STAGE3E_WASM_SHA256)
    fail('current Stage3E acoustic identity differs from immutable Generation-2 identity','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {schemaVersion:3,kind:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBILITY',decision:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBLE',
    v1Sha256,v2Sha256,v2AcceptedCommit:V2_ACCEPTED_COMMIT,recoveryCommit,originalManifestSha256:manifestSha256,
    bootstrapLedgerSha256:validator.LOW_GENESIS_SHA256,preAbortLedgerSha256:PRE_ABORT_LEDGER_SHA256,
    protectedStage3eWasmSha256:v2.STAGE3E_WASM_SHA256,fixed35InventorySha256:inventorySha256,
    preRenderAbortEvidenceSha256,originalJournalSha256:preAbortEvidence.originalJournalSha256,
    pinnedExecutorHashes:pinnedExecutorHashes(root),acousticCriticalInputs:acoustic,
    baselineAcceptance:{decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',effectiveCellCount:12,effectivePassCount:12,
      maximumDifference:0,tolerance:1e-6,amendmentResultSha256:v2.AMENDMENT_RESULT_SHA256},
    searchCompletedAtBridgeCreation:0,allowedUnchangedAcousticRenders:0,primarySecondaryIntegrity:'PASS',createdAt:new Date().toISOString()};
}
function validateRecord(record,{root,head=currentHead(root),manifest,v1Sha256,v2Sha256,sourceAuditSha256,
  inventorySha256,preAbortEvidenceSha256,pinned=pinnedExecutorHashes(root),currentIdentity=currentAcousticIdentity(root),isAncestorCheck=isAncestor}={}){
  const expected={schemaVersion:3,kind:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBILITY',decision:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBLE',
    v1Sha256:v2.V1_SHA256,v2Sha256:'5f3340f7b993bb879aa29bca4214e5192008f54308d20160282aac0cfcc6f797',
    v2AcceptedCommit:V2_ACCEPTED_COMMIT,originalManifestSha256:validator.SEARCH_MANIFEST_SHA256,
    bootstrapLedgerSha256:validator.LOW_GENESIS_SHA256,preAbortLedgerSha256:PRE_ABORT_LEDGER_SHA256,
    protectedStage3eWasmSha256:v2.STAGE3E_WASM_SHA256,fixed35InventorySha256:'25e4bb121a8714bc90cd83ed00df1c8eb577208b87d2e272b15fc389fd212adf',
    preRenderAbortEvidenceSha256:'e601de82fbb382065b0d3c7efed6da8540c25681d5e622a11fb74a4cf12bb482',
    searchCompletedAtBridgeCreation:0,allowedUnchangedAcousticRenders:0,primarySecondaryIntegrity:'PASS'};
  for(const [key,value] of Object.entries(expected))if(record?.[key]!==value)fail(`v3 ${key} mismatch`);
  if(v1Sha256!==undefined&&v1Sha256!==record.v1Sha256||v2Sha256!==undefined&&v2Sha256!==record.v2Sha256||
     sourceAuditSha256!==undefined&&sourceAuditSha256!==validator.SOURCE_AUDIT_SHA256||
     inventorySha256!==undefined&&inventorySha256!==record.fixed35InventorySha256||
     preAbortEvidenceSha256!==undefined&&preAbortEvidenceSha256!==record.preRenderAbortEvidenceSha256)fail('v3 predecessor evidence changed');
  if(!/^[0-9a-f]{40}$/.test(record.recoveryCommit||'')||!isAncestorCheck(root,record.v2AcceptedCommit,head)||
     !isAncestorCheck(root,record.recoveryCommit,head))fail('v3 accepted commits are not ancestors of current HEAD');
  if(!same(record.pinnedExecutorHashes,pinned))fail('pinned verifier/executor SHA changed','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const critical=acousticCriticalInputs(manifest);
  if(!same(record.acousticCriticalInputs,critical)||!same(currentIdentity,Object.fromEntries(IDENTITY_FIELDS.map(key=>[key,critical[key]]))))
    fail('acoustic-critical identity changed','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  if(!same(record.baselineAcceptance,{decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',effectiveCellCount:12,effectivePassCount:12,
      maximumDifference:0,tolerance:1e-6,amendmentResultSha256:v2.AMENDMENT_RESULT_SHA256}))fail('v3 baseline acceptance mismatch');
  return {pass:true,decision:record.decision,recoveryCommit:record.recoveryCommit,currentHead:head,
    pinnedExecutorHashes:record.pinnedExecutorHashes,acousticCriticalInputs:record.acousticCriticalInputs};
}
function archiveBytes(recordBytes,shaBytes){
  const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'stage3e-v3-archive-'));
  try{fs.writeFileSync(path.join(temp,RELATIVE),recordBytes,{flag:'wx'});fs.writeFileSync(path.join(temp,SHA_RELATIVE),shaBytes,{flag:'wx'});
    const out=path.join(temp,'bundle.tar.gz');execFileSync('tar',['-czf',out,'-C',temp,RELATIVE,SHA_RELATIVE],{stdio:'pipe'});return fs.readFileSync(out);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
function readBundle(roots){
  const record=durable.verifyDualCopy(path.join(roots.primary,RELATIVE),path.join(roots.secondary,RELATIVE));
  const shaFile=durable.verifyDualCopy(path.join(roots.primary,SHA_RELATIVE),path.join(roots.secondary,SHA_RELATIVE));
  if(shaFile.bytes.toString('utf8')!==record.sha256+'\n')fail('v3 SHA registration mismatch');
  const archive=durable.verifyDualCopy(path.join(roots.primary,ARCHIVE_RELATIVE),path.join(roots.secondary,ARCHIVE_RELATIVE));
  const archiveSha=durable.verifyDualCopy(path.join(roots.primary,ARCHIVE_SHA_RELATIVE),path.join(roots.secondary,ARCHIVE_SHA_RELATIVE));
  if(archiveSha.bytes.toString('utf8')!==archive.sha256+'\n')fail('v3 archive SHA registration mismatch');
  for(const file of [path.join(roots.primary,ARCHIVE_RELATIVE),path.join(roots.secondary,ARCHIVE_RELATIVE)]){
    if(!v2.readArchiveMember(file,RELATIVE).equals(record.bytes)||!v2.readArchiveMember(file,SHA_RELATIVE).equals(shaFile.bytes))fail('v3 archive payload mismatch');
  }
  return {record:JSON.parse(record.bytes.toString('utf8')),bytes:record.bytes,sha256:record.sha256,archiveSha256:archive.sha256};
}
function writeBundle(roots,record){
  const bytes=jsonBytes(stable(record)),sha=sha256(bytes),shaBytes=Buffer.from(sha+'\n');
  const paths=[[RELATIVE,bytes],[SHA_RELATIVE,shaBytes]];
  for(const [relative,data] of paths){const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
    if(fs.existsSync(a)||fs.existsSync(b))fail('v3 immutable sidecar already exists; verify it instead of rewriting');
    durable.writeDualCopy(a,b,data);}
  const archive=archiveBytes(bytes,shaBytes),archiveSha=sha256(archive);
  durable.writeDualCopy(path.join(roots.primary,ARCHIVE_RELATIVE),path.join(roots.secondary,ARCHIVE_RELATIVE),archive);
  durable.writeDualCopy(path.join(roots.primary,ARCHIVE_SHA_RELATIVE),path.join(roots.secondary,ARCHIVE_SHA_RELATIVE),Buffer.from(archiveSha+'\n'));
  return {record,sha256:sha,archiveSha256:archiveSha};
}

module.exports={RELATIVE,SHA_RELATIVE,ARCHIVE_RELATIVE,ARCHIVE_SHA_RELATIVE,V2_ACCEPTED_COMMIT,PRE_ABORT_LEDGER_SHA256,FORENSIC_RELATIVE,
  PINNED_PATHS,IDENTITY_FIELDS,sha256,jsonBytes,stable,same,pinnedExecutorHashes,acousticCriticalInputs,currentAcousticIdentity,
  buildRecord,validateRecord,readBundle,writeBundle,isAncestor};
