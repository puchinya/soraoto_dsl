'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const generation2=require('./run-stage3e-generation2.cjs');
const evidenceValidator=require('./stage3e-evidence-validator.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');
const compatibilityV2=require('./stage3e-search-compatibility.cjs');
const compatibilityV3=require('./stage3e-search-compatibility-v3.cjs');

const ROOT=search.ROOT;
const RELATIVE='recovery-reconciliation-v2/';
const EXECUTION_ID='stage3e-gen2-low-pre-render-abort-reconciliation-v2';
const OLD_HEAD='b9b0629664eef576c8e27650323308e9ae37785e';
const OLD_LEDGER_SHA256='c8c0d162aafcf30908e4b1d7637245ecb6418328a75cee35d76303328960109f';
const INVALID_RESULT_SHA256='ee1bc4f286fadd25cfdaad4fff69951522b50b1d1ebdfef7417d121f7919eaa3';
const OLD_AUTHORIZATION_SHA256='54fe051d4eeb2a406c702305e9adfd50ff3fe942bff1c6eaf38d533b07f6d63a';
const FORENSIC_SHA256='e601de82fbb382065b0d3c7efed6da8540c25681d5e622a11fb74a4cf12bb482';
const PROOF_SHA256='e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb';
const TARGET_KEY='low-screen-L1-M1-H0-midi-036-v110';
const TARGET=Object.freeze({pitch:36,velocity:14,velocityNormalized:14/127,phase:'low-screen',response:{low:1,mid:1,bassHardness:0},key:TARGET_KEY});
const FILES=Object.freeze({
  sourceAudit:'source-audit.json',invalidDisposition:'invalid-recovery-disposition.json',authorization:'authorization-v2.json',intent:'transaction-intent.json',
  receipt:'transaction-receipt.json',result:'reconciliation-result.json',compatibility:'recovery-transaction-compatibility-v2.json',
  compatibilitySha:'recovery-transaction-compatibility-v2.sha256',stagedLedger:'staging/low-ledger-post.json',stagedTransition:'staging/transition-000002.json',
  manifest:'evidence-manifest.json',manifestSha:'evidence-manifest.sha256',compatibilityArchive:'archives/recovery-transaction-compatibility-v2.tar.gz',
  compatibilityArchiveSha:'archives/recovery-transaction-compatibility-v2.tar.gz.sha256',archive:'archives/recovery-reconciliation-v2.tar.gz'
});
const ALLOWED_DIFF_PATHS=new Set([
  'docs/agent-workflow/evidence-preservation.md','docs/design/plugins/dsp/super-synth/super-synth-design.md',
  'docs/status/plugins/dsp/super-synth/stage3b-contact-attribution.md',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs','wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs','wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-pre-render-abort-recovery.cjs','wasm/plugins/dsp/super-synth/test/tools/run-stage3e-pre-render-abort-recovery.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.cjs','wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.cjs','wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs','wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs','wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs','wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs'
]);
const VERIFIER_RUNTIME_PATHS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-paths.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-pre-render-abort-recovery.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-compatibility.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-compatibility-v3.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/durable-evidence.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-historical-reference-requalification.cjs'
]);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fail(token,detail){throw new Error(`${token}: ${detail}`);}
function rootsFor(root=ROOT,home=process.env.HOME){return require('./stage3e-preflight.cjs').searchRoots(root,home);}
function join(root,relative){return path.join(root,...relative.split('/'));}
function transactionRoots(roots){return {primary:join(roots.primary,RELATIVE),secondary:join(roots.secondary,RELATIVE)};}
function immutableDual(roots,relative,bytes,{write=durable.atomicWrite}={}){
  const a=join(roots.primary,relative),b=join(roots.secondary,relative),data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const existsA=fs.existsSync(a),existsB=fs.existsSync(b);
  if(existsA||existsB){
    if(existsA&&existsB){const old=durable.verifyDualCopy(a,b);if(!old.bytes.equals(data))fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COLLISION',relative+' immutable bytes differ');return old;}
    const existing=fs.readFileSync(existsA?a:b);if(!existing.equals(data))fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COLLISION',relative+' one-sided bytes differ');
    try{write(existsA?b:a,data);}catch(error){fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE',relative+': '+error.message);}
    return durable.verifyDualCopy(a,b);
  }
  return durable.writeDualCopy(a,b,data,{write});
}
function readDual(roots,relative){return durable.verifyDualCopy(join(roots.primary,relative),join(roots.secondary,relative));}
function currentHead(root){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function ensureClean(root){const result=execFileSync('rtk',['git','status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim();if(result)fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','worktree must be clean before evidence transaction');}
function fileSha(root,relative){const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','missing verifier input '+relative);return sha256(fs.readFileSync(file));}
function git(root,args){return execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'});}
function gitBytes(root,args){return execFileSync('rtk',['git',...args],{cwd:root});}
function isAncestor(root,ancestor,descendant){try{execFileSync('rtk',['git','merge-base','--is-ancestor',ancestor,descendant],{cwd:root,stdio:'ignore'});return true;}catch{return false;}}
function countStates(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells||{}).filter(row=>row.state===state).length]));}

function proposedLedger(ledger){
  const next=JSON.parse(JSON.stringify(ledger)),row=next.cells?.[TARGET_KEY];
  if(!row||row.state!=='IN_PROGRESS'||row.sha256!==null||row.identity?.key!==TARGET_KEY||next.accounting?.renderCalls!==0||
     Object.values(next.cells).filter(item=>item.state==='IN_PROGRESS').length!==1||Object.values(next.cells).some(item=>item.state==='COMPLETE'))
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','only the exact zero-render target may be requeued');
  row.state='PENDING';delete row.startedAt;delete row.completedAt;
  if(!same(countStates(next),{PENDING:1512,IN_PROGRESS:0,COMPLETE:0})||next.accounting?.renderCalls!==0)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','proposed ledger accounting is not exact');
  return next;
}

function codeIdentity(root,revision=currentHead(root)){
  const files=Object.fromEntries(VERIFIER_RUNTIME_PATHS.map(name=>[name,sha256(gitBytes(root,['show',`${revision}:${name}`]))]));
  const helper='wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs';
  const protectedFiles=['wasm/plugins/dsp/super-synth/src/plugin.c','wasm/plugins/dsp/super-synth/presets.json','wasm/shared/generated/super-synth_grand_profiles.h'];
  const protectedSha=Object.fromEntries(protectedFiles.map(name=>[name,sha256(gitBytes(root,['show',`${revision}:${name}`]))]));
  return {files,captureHelperSha256:fileSha(root,helper),protectedSha};
}
function assertCurrentVerifierAtAnchor(root,anchorCommit,head=currentHead(root),base=OLD_HEAD){
  if(!isAncestor(root,base,anchorCommit)||!isAncestor(root,anchorCommit,head))
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','verifier anchor must descend from the accepted base and be an ancestor of current HEAD');
  const anchor=codeIdentity(root,anchorCommit);
  for(const relative of VERIFIER_RUNTIME_PATHS){
    const current=fileSha(root,relative);
    if(current!==anchor.files[relative])fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','verifier runtime changed after compatibility anchor: '+relative);
  }
  for(const [relative,expectedSha] of Object.entries(anchor.protectedSha))
    if(fileSha(root,relative)!==expectedSha)fail('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT','protected acoustic source changed: '+relative);
  return anchor;
}
function verifierDiff(root,head,base=OLD_HEAD){
  if(!isAncestor(root,base,head)&&head!==base)fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','reconciliation commit is outside accepted ancestry');
  const names=git(root,['diff','--name-only',`${OLD_HEAD}..${head}`]).trim().split(/\r?\n/).filter(Boolean).sort();
  const disallowed=names.filter(name=>!ALLOWED_DIFF_PATHS.has(name));
  if(disallowed.length)fail('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT','changed tracked path outside verifier-only allowlist: '+disallowed.join(', '));
  const diff=execFileSync('rtk',['git','diff','--binary',`${OLD_HEAD}..${head}`,'--',...names],{cwd:root});
  return {changedPaths:names,sha256:sha256(diff)};
}
function buildCompatibilityRecord({root,manifest,manifestSha256,bridge,forensicSha256,sourceAuditSha256,oldResultSha256,head=currentHead(root),testReportSha256,allowHistoricalAnchor=false}={}){
  ensureClean(root);
  if(!allowHistoricalAnchor&&head!==currentHead(root))fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','new compatibility must be created at the current verifier commit');
  if(!/^[0-9a-f]{64}$/.test(testReportSha256||''))fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','zero-render verifier test report SHA is required');
  const v3Pinned=bridge.record.pinnedExecutorHashes||{},code=assertCurrentVerifierAtAnchor(root,head,head),diff=verifierDiff(root,head);
  if(code.captureHelperSha256!==v3Pinned.captureHelper)fail('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT','capture helper changed from original acoustic creator');
  const acoustic=compatibilityV3.currentAcousticIdentity(root);
  const expected=compatibilityV3.acousticCriticalInputs(manifest);
  const fields=compatibilityV3.IDENTITY_FIELDS;
  if(!same(Object.fromEntries(fields.map(key=>[key,acoustic[key]])),Object.fromEntries(fields.map(key=>[key,expected[key]])))||
     acoustic.diagnosticWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221')
    fail('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT','current Generation-2 acoustic identity changed');
  return {schemaVersion:2,kind:'STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY',decision:'STAGE3E_RECOVERY_TRANSACTION_COMPATIBLE',
    acceptedBaseCommit:OLD_HEAD,verifierCommit:head,sourceAuditSha256,proofSha256:PROOF_SHA256,searchManifestSha256:manifestSha256,
    invalidPrecommitResultSha256:oldResultSha256,forensicEvidenceSha256:forensicSha256,priorV3CompatibilitySha256:bridge.sha256,
    originalLedgerSha256:OLD_LEDGER_SHA256,stage3eWasmSha256:acoustic.diagnosticWasmSha256,acousticCriticalInputs:expected,
    legacyPinnedExecutorHashes:v3Pinned,currentVerifierFiles:code.files,captureHelperSha256:code.captureHelperSha256,
    protectedAcousticSourceSha256:code.protectedSha,allowedVerifierOnlyDiffSha256:diff.sha256,allowedChangedPaths:diff.changedPaths,
    zeroRenderVerifierTestReportSha256:testReportSha256,primarySecondaryIntegrity:'PASS'};
}
function validateCompatibilityRecord(record,{root,head=currentHead(root),manifest,manifestSha256,bridge,forensicSha256,sourceAuditSha256,oldResultSha256,testReportSha256}={}){
  const anchor=record?.verifierCommit;
  if(typeof anchor!=='string')fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','verifier anchor commit is missing');
  const code=assertCurrentVerifierAtAnchor(root,anchor,head);
  const expected=buildCompatibilityRecord({root,manifest,manifestSha256,bridge,forensicSha256,sourceAuditSha256,oldResultSha256,head:anchor,testReportSha256,allowHistoricalAnchor:true});
  if(!same(record,expected))fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','immutable v2 compatibility record differs from current verifier-only identity');
  if(!same(record.currentVerifierFiles,code.files)||!same(record.protectedAcousticSourceSha256,code.protectedSha))
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','verifier or protected-source inventory differs from the anchored tree');
  return {pass:true,decision:record.decision,sha256:sha256(jsonBytes(stable(record)))};
}
function archiveCompatibility(recordBytes,shaBytes){
  const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'stage3e-recovery-compat-'));
  try{fs.writeFileSync(path.join(temp,FILES.compatibility),recordBytes,{flag:'wx'});fs.writeFileSync(path.join(temp,FILES.compatibilitySha),shaBytes,{flag:'wx'});
    const output=path.join(temp,'compatibility.tar.gz');execFileSync('tar',['-czf',output,'-C',temp,FILES.compatibility,FILES.compatibilitySha],{stdio:'pipe'});return fs.readFileSync(output);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
function writeCompatibility(roots,record){
  const bytes=jsonBytes(stable(record)),hash=sha256(bytes),hashBytes=Buffer.from(hash+'\n'),archive=archiveCompatibility(bytes,hashBytes),archiveSha=sha256(archive);
  const saved=immutableDual(transactionRoots(roots),FILES.compatibility,bytes);
  immutableDual(transactionRoots(roots),FILES.compatibilitySha,hashBytes);
  immutableDual(transactionRoots(roots),FILES.compatibilityArchive,archive);
  immutableDual(transactionRoots(roots),FILES.compatibilityArchiveSha,Buffer.from(archiveSha+'\n'));
  const verify=readCompatibility(roots);
  if(verify.sha256!==saved.sha256||verify.archiveSha256!==archiveSha)fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','compatibility archive readback mismatch');
  return verify;
}
function readCompatibility(roots){
  const base=transactionRoots(roots),record=readDual(base,FILES.compatibility),sha=readDual(base,FILES.compatibilitySha),archive=readDual(base,FILES.compatibilityArchive),archiveSha=readDual(base,FILES.compatibilityArchiveSha);
  if(sha.bytes.toString('utf8')!==record.sha256+'\n'||archiveSha.bytes.toString('utf8')!==archive.sha256+'\n')fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','compatibility SHA registration mismatch');
  const archivePath=join(base.primary,FILES.compatibilityArchive),entries=execFileSync('tar',['-tzf',archivePath],{encoding:'utf8'}).trim().split(/\r?\n/);
  for(const relative of [FILES.compatibility,FILES.compatibilitySha]){
    const entry=entries.find(name=>name===relative||name==='./'+relative);
    if(!entry||!execFileSync('tar',['-xOf',archivePath,entry]).equals(relative===FILES.compatibility?record.bytes:sha.bytes))
      fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY','immutable compatibility archive content mismatch: '+relative);
  }
  return {record:JSON.parse(record.bytes.toString('utf8')),bytes:record.bytes,sha256:record.sha256,archiveSha256:archive.sha256};
}

function readBaseline({root=ROOT,home=process.env.HOME}={}){
  const roots=rootsFor(root,home),manifestFile=readDual(roots,'generation-2-manifest.json');
  if(manifestFile.sha256!==evidenceValidator.SEARCH_MANIFEST_SHA256)fail('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','immutable search manifest changed');
  const manifest=JSON.parse(manifestFile.bytes.toString('utf8')),resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest);
  const snapshot=readDual(roots,'pre-render-abort-recovery-v1/pre-abort-low-ledger.json');
  const forensicFile=readDual(roots,'pre-render-abort-recovery-v1/forensic-evidence.json');
  const oldAuth=readDual(roots,'pre-render-abort-recovery-v1/recovery-authorization.json');
  const oldResult=readDual(roots,'pre-render-abort-recovery-v1/recovery-result.json');
  if(snapshot.sha256!==OLD_LEDGER_SHA256||oldAuth.sha256!==OLD_AUTHORIZATION_SHA256||oldResult.sha256!==INVALID_RESULT_SHA256||forensicFile.sha256!==FORENSIC_SHA256)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','immutable pre-abort snapshots or invalid legacy result changed');
  const forensic=JSON.parse(forensicFile.bytes.toString('utf8'));
  const prior=recoveryApi().validateAbortForensic(forensic,forensicFile.sha256);
  const v1v2=compatibilityV2.readBundle(roots),bridge=compatibilityV3.readBundle(roots);
  const audit=require('./run-stage3e-midi41-evidence-amendment.cjs').assertSourceAudit({root,home});
  compatibilityV3.validateRecord(bridge.record,{root,head:currentHead(root),manifest,v1Sha256:v1v2.v1Sha256,v2Sha256:v1v2.sha256,
    sourceAuditSha256:evidenceValidator.SOURCE_AUDIT_SHA256,
    inventorySha256:compatibilityV2.fixedInventorySha(audit.audit),
    preAbortEvidenceSha256:forensicFile.sha256,pinned:bridge.record.pinnedExecutorHashes});
  const amendment=require('./run-stage3e-midi41-evidence-amendment.cjs').verify({root,home});
  if(audit.sha256!==evidenceValidator.SOURCE_AUDIT_SHA256||amendment.resultSha256!==compatibilityV2.AMENDMENT_RESULT_SHA256||
     amendment.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendment.result?.effectivePassCount!==12)
    fail('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT','frozen evidence or Gen2 baseline changed');
  const genesis=readDual(roots,'ledger-transition-journal/genesis-ledger.json');
  const genesisRecord=JSON.parse(readDual(roots,'ledger-transition-journal/genesis.json').bytes.toString('utf8'));
  if(genesis.sha256!==evidenceValidator.LOW_GENESIS_SHA256||genesisRecord.genesisLedgerSha256!==genesis.sha256||
     genesisRecord.manifestSha256!==manifestFile.sha256||genesisRecord.proofSha256!==PROOF_SHA256||
     genesisRecord.compatibilitySha256!==v1v2.sha256)
    fail('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','original low genesis binding changed');
  const journal1=readDual(roots,'ledger-transition-journal/transition-000001.json');
  const forensicJournal=forensic.originalJournalFiles?.find(item=>item.name==='transition-000001.json');
  if(!forensicJournal||journal1.sha256!==forensicJournal.sha256)fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','original journal transition changed');
  const wasmPath=path.join(path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm-stage3e')),'plugins/dsp/super-synth/plugin.wasm');
  if(!fs.existsSync(wasmPath)||sha256(fs.readFileSync(wasmPath))!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221')
    fail('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT','Stage3E diagnostic WASM mismatch');
  return {roots,resolved,manifest,manifestSha256:manifestFile.sha256,snapshot,forensic,forensicSha256:forensicFile.sha256,
    oldAuthSha256:oldAuth.sha256,oldResultSha256:oldResult.sha256,v1v2,bridge,audit,amendment,genesis,journal1};
}
function recoveryApi(){return require('./run-stage3e-pre-render-abort-recovery.cjs');}

function makeTransaction(state,compatibility){
  const base=state.roots,live=durable.verifyDualCopy(state.resolved.primary.lowLedger,state.resolved.secondary.lowLedger);
  if(live.sha256!==OLD_LEDGER_SHA256)fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','initial ledger is not the authorized pre-abort bytes');
  const oldLedger=JSON.parse(live.bytes.toString('utf8'));
  if(oldLedger.authorizedCellCount!==1512||!same(Object.keys(oldLedger.cells||{}),search.expectedLowScreenCells().map(cell=>cell.key))||
     !same(countStates(oldLedger),{PENDING:1511,IN_PROGRESS:1,COMPLETE:0})||oldLedger.accounting?.renderCalls!==0||
     !same(oldLedger.cells[TARGET_KEY]?.identity,TARGET)||oldLedger.cells[TARGET_KEY]?.sha256!==null)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','1512-cell ledger is not the exact pre-render abort state');
  const tRoots=transactionRoots(base),stagedLedger=proposedLedger(oldLedger),stagedLedgerBytes=generation2.jsonBytes(stagedLedger),stagedLedgerSha256=sha256(stagedLedgerBytes);
  const intent={schemaVersion:2,executionId:EXECUTION_ID,transactionId:EXECUTION_ID,decision:'STAGE3E_ADMINISTRATIVE_REQUEUE_INTENT',
    targetCell:TARGET,oldLedgerSha256:live.sha256,newLedgerSha256:stagedLedgerSha256,genesisLedgerSha256:state.genesis.sha256,
    manifestSha256:state.manifestSha256,proofSha256:PROOF_SHA256,sourceAuditSha256:state.audit.sha256,
    oldAuthorizationSha256:state.oldAuthSha256,invalidRecoveryResultSha256:state.oldResultSha256,
    preRenderAbortProofSha256:state.forensicSha256,recoveryCompatibilityV3Sha256:state.bridge.sha256,
    recoveryReconciliationCompatibilitySha256:compatibility.sha256,renderCallsBefore:0,renderCallsAfter:0};
  const intentBytes=jsonBytes(intent),intentSha256=sha256(intentBytes);
  const authorization={schemaVersion:2,decision:'STAGE3E_ADMINISTRATIVE_REQUEUE_AUTHORIZED',executionId:EXECUTION_ID,transactionIntentSha256:intentSha256,
    targetCell:TARGET,oldLedgerSha256:live.sha256,newLedgerSha256:stagedLedgerSha256,manifestSha256:state.manifestSha256,
    proofSha256:PROOF_SHA256,sourceAuditSha256:state.audit.sha256,invalidRecoveryResultSha256:state.oldResultSha256,
    oldAuthorizationSha256:state.oldAuthSha256,forensicEvidenceSha256:state.forensicSha256,
    recoveryCompatibilityV3Sha256:state.bridge.sha256,recoveryReconciliationCompatibilitySha256:compatibility.sha256,
    authorizedAdministrativeTransitions:1,acousticRendersAuthorized:0,acousticRendersObserved:0};
  const authorizationBytes=jsonBytes(authorization),authorizationSha256=sha256(authorizationBytes);
  const disposition={schemaVersion:1,decision:'INVALID_PRECOMMIT_RESULT',invalidResultSha256:state.oldResultSha256,
    legacyAuthorizationSha256:state.oldAuthSha256,reason:'The legacy recovery result claimed completion before journal and live-ledger postconditions were established.',
    supersededByTransactionIntentSha256:intentSha256};
  const dispositionBytes=jsonBytes(disposition);
  const entry={schemaVersion:1,sequence:2,previousLedgerSha256:live.sha256,nextLedgerSha256:stagedLedgerSha256,cellKey:TARGET_KEY,
    cellIdentity:TARGET,oldState:'IN_PROGRESS',newState:'PENDING',previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,
    manifestSha256:state.manifestSha256,proofSha256:PROOF_SHA256,compatibilitySha256:state.bridge.sha256,
    eventType:'ADMIN_REQUEUE_NO_RENDER',recoveryAuthorizationSha256:authorizationSha256,transactionIntentSha256:intentSha256,
    sourceAuditSha256:state.audit.sha256,invalidRecoveryResultSha256:state.oldResultSha256,
    recoveryReconciliationCompatibilitySha256:compatibility.sha256};
  const transitionBytes=jsonBytes(entry);
  return {tRoots,intent,intentBytes,intentSha256,authorization,authorizationBytes,authorizationSha256,disposition,dispositionBytes,
    stagedLedger,stagedLedgerBytes,stagedLedgerSha256,entry,transitionBytes,transitionSha256:sha256(transitionBytes)};
}

function stageIntent(state,transaction){
  const roots=transaction.tRoots;
  immutableDual(roots,FILES.sourceAudit,jsonBytes(state.audit.audit));
  immutableDual(roots,FILES.invalidDisposition,transaction.dispositionBytes);
  immutableDual(roots,FILES.authorization,transaction.authorizationBytes);
  immutableDual(roots,FILES.intent,transaction.intentBytes);
  immutableDual(roots,FILES.stagedLedger,transaction.stagedLedgerBytes);
  immutableDual(roots,FILES.stagedTransition,transaction.transitionBytes);
  if(sha256(readDual(roots,FILES.stagedLedger).bytes)!==transaction.stagedLedgerSha256||
     sha256(readDual(roots,FILES.stagedTransition).bytes)!==transaction.transitionSha256)
    fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','staged proposed state mismatch');
}
function validateProposedReplay(state,transaction,compatibility){
  const history=[JSON.parse(state.journal1.bytes.toString('utf8'))],renderStarts=[];
  return evidenceValidator.validateLedgerTransitions({genesisLedgerBytes:state.genesis.bytes,currentLedgerBytes:transaction.stagedLedgerBytes,
    transitionEntries:[...history,transaction.entry],renderStartEntries:renderStarts,expectedCells:search.expectedLowScreenCells(),
    bindings:{manifestSha256:state.manifestSha256,proofSha256:PROOF_SHA256,compatibilitySha256:state.bridge.sha256,
      acceptedCompatibilitySha256s:[state.v1v2.sha256],recoveryCompatibilitySha256:state.bridge.sha256,
      recoveryReconciliationCompatibilitySha256:compatibility.sha256}});
}

function readLiveLedgerPair(resolved,oldSha,newSha,oldBytes,newBytes){
  const locations=[resolved.primary.lowLedger,resolved.secondary.lowLedger],items=locations.map(file=>{
    if(!fs.existsSync(file))fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','live low ledger copy missing: '+file);
    const bytes=fs.readFileSync(file),hash=sha256(bytes);
    if((hash!==oldSha||!bytes.equals(oldBytes))&&(hash!==newSha||!bytes.equals(newBytes)))
      fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','live ledger has an unrecognized transaction hash');
    return {file,bytes,sha256:hash};
  });
  return items;
}
function appendJournalOnce(roots,entryBytes,expectedSha){
  const relative='ledger-transition-journal/transition-000002.json',a=join(roots.primary,relative),b=join(roots.secondary,relative);
  const hasA=fs.existsSync(a),hasB=fs.existsSync(b);
  if(hasA||hasB){if(!hasA||!hasB)fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','transition 000002 exists in only one store');const saved=durable.verifyDualCopy(a,b);if(saved.sha256!==expectedSha||!saved.bytes.equals(entryBytes))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','transition 000002 differs from exact authorized intent');return saved;}
  return immutableDual(roots,relative,entryBytes);
}
function mirrorLiveLedger(resolved,transaction,oldBytes,{write=durable.atomicWrite}={}){
  for(const file of [resolved.primary.lowLedger,resolved.secondary.lowLedger]){
    const exists=fs.existsSync(file),bytes=exists?fs.readFileSync(file):null;
    if(!exists||!bytes.equals(oldBytes)&&!bytes.equals(transaction.stagedLedgerBytes))
      fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','live ledger is outside the permitted old/new state pair');
  }
  for(const file of [resolved.primary.lowLedger,resolved.secondary.lowLedger]){
    const bytes=fs.readFileSync(file);if(bytes.equals(transaction.stagedLedgerBytes))continue;
    try{write(file,transaction.stagedLedgerBytes);}catch(error){fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','live ledger mirror failed: '+error.message);}
  }
  return durable.verifyDualCopy(resolved.primary.lowLedger,resolved.secondary.lowLedger);
}
function validatePostconditions(state,transaction,compatibility){
  const live=durable.verifyDualCopy(state.resolved.primary.lowLedger,state.resolved.secondary.lowLedger);
  if(live.sha256!==transaction.stagedLedgerSha256||!live.bytes.equals(transaction.stagedLedgerBytes))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','requeued ledger does not match staged bytes');
  const transitions=[JSON.parse(state.journal1.bytes.toString('utf8')),JSON.parse(readDual(state.roots,'ledger-transition-journal/transition-000002.json').bytes.toString('utf8'))];
  const replay=evidenceValidator.validateLedgerTransitions({genesisLedgerBytes:state.genesis.bytes,currentLedgerBytes:live.bytes,
    transitionEntries:transitions,renderStartEntries:[],expectedCells:search.expectedLowScreenCells(),
    bindings:{manifestSha256:state.manifestSha256,proofSha256:PROOF_SHA256,compatibilitySha256:state.bridge.sha256,
      acceptedCompatibilitySha256s:[state.v1v2.sha256],recoveryCompatibilitySha256:state.bridge.sha256,
      recoveryReconciliationCompatibilitySha256:compatibility.sha256}});
  if(replay.pending!==1512||replay.inProgress!==0||replay.complete!==0||replay.renderCalls!==0||
     !same(countStates(JSON.parse(live.bytes.toString('utf8'))),{PENDING:1512,IN_PROGRESS:0,COMPLETE:0}))
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','post-requeue ledger accounting is not exact');
  const targetPrimary=path.join(state.roots.primary,'low/cells',TARGET_KEY+'.json'),targetSecondary=path.join(state.roots.secondary,'low/cells',TARGET_KEY+'.json');
  if(fs.existsSync(targetPrimary)||fs.existsSync(targetSecondary))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','requeued cell has acoustic evidence');
  return {ledger:live,replay};
}
function finalizeArtifacts(state,transaction,compatibility,postconditions,{root=ROOT}={}){
  if(!postconditions?.gates?.pass||postconditions.replay?.pending!==1512||postconditions.replay?.inProgress!==0||
     postconditions.replay?.complete!==0||postconditions.replay?.renderCalls!==0||
     postconditions.ledger?.sha256!==transaction.stagedLedgerSha256)
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_EVIDENCE','finalization requires verified live ledger, journal, and read-only CLI gates');
  const roots=transaction.tRoots;
  const receipt={schemaVersion:2,decision:'STAGE3E_PRE_RENDER_ABORT_RECONCILIATION_RECEIPT',intentSha256:transaction.intentSha256,
    authorizationSha256:transaction.authorizationSha256,compatibilitySha256:compatibility.sha256,invalidPrecommitResultSha256:state.oldResultSha256,
    oldLedgerSha256:OLD_LEDGER_SHA256,newLedgerSha256:postconditions.ledger.sha256,journalTipSha256:transaction.transitionSha256,
    transitionSha256:transaction.transitionSha256,renderCalls:postconditions.replay.renderCalls,
    counts:{pending:postconditions.replay.pending,inProgress:postconditions.replay.inProgress,complete:postconditions.replay.complete}};
  const receiptBytes=jsonBytes(receipt),receiptSha256=sha256(receiptBytes);
  const result={schemaVersion:2,decision:'STAGE3E_PRE_RENDER_ABORT_RECONCILED',invalidPrecommitResultSha256:state.oldResultSha256,
    sourceAuditSha256:state.audit.sha256,authorizationSha256:transaction.authorizationSha256,intentSha256:transaction.intentSha256,
    compatibilitySha256:compatibility.sha256,oldLedgerSha256:OLD_LEDGER_SHA256,requeuedLedgerSha256:postconditions.ledger.sha256,
    journalTipSha256:transaction.transitionSha256,transitionSha256:transaction.transitionSha256,targetCell:TARGET,
    authorizedAdministrativeRequeues:1,administrativeRequeues:1,
    acousticRenders:0,renderCalls:postconditions.replay.renderCalls,pending:postconditions.replay.pending,inProgress:postconditions.replay.inProgress,
    complete:postconditions.replay.complete,receiptSha256};
  const resultBytes=jsonBytes(result);
  immutableDual(roots,FILES.receipt,receiptBytes);
  immutableDual(roots,FILES.result,resultBytes);
  const metadata={creatorRevision:compatibility.record.verifierCommit,executionId:'generation-2-recovery-reconciliation-v2',generation:2,
    runnerSha256:fileSha(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-pre-render-abort-recovery.cjs'),
    helperSha256:fileSha(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs'),
    wasmSha256:'6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221',startedAt:'pre-render-abort',
    finalizedAt:'postcondition-verified',decision:result.decision};
  durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata});
  const archive=durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase:'recovery-reconciliation-v2'});
  return {receiptSha256,resultSha256:sha256(resultBytes),manifestSha256:readDual(roots,FILES.manifest).sha256,archiveSha256:archive.sha256};
}

function prepareCompatibility(state,{root=ROOT,testReportSha256}={}){
  const existing=FILES.compatibility;
  const compatRoot=transactionRoots(state.roots);
  const record=buildCompatibilityRecord({root,manifest:state.manifest,manifestSha256:state.manifestSha256,bridge:state.bridge,
    forensicSha256:state.forensicSha256,sourceAuditSha256:state.audit.sha256,oldResultSha256:state.oldResultSha256,
    head:currentHead(root),testReportSha256});
  const present=[FILES.compatibility,FILES.compatibilitySha,FILES.compatibilityArchive,FILES.compatibilityArchiveSha]
    .some(relative=>fs.existsSync(join(compatRoot.primary,relative))||fs.existsSync(join(compatRoot.secondary,relative)));
  if(present){const bundle=readCompatibility(state.roots);validateCompatibilityRecord(bundle.record,{root,manifest:state.manifest,manifestSha256:state.manifestSha256,
    bridge:state.bridge,forensicSha256:state.forensicSha256,sourceAuditSha256:state.audit.sha256,oldResultSha256:state.oldResultSha256,
    testReportSha256});return bundle;}
  return writeCompatibility(state.roots,record);
}

function initialDryRun({root=ROOT,home=process.env.HOME,testReportSha256}={}){
  const state=recoveryApi().readOriginalArtifacts({root,home});
  const compatibility=buildCompatibilityRecord({root,manifest:state.manifest,manifestSha256:state.manifestSha256,bridge:readV3(state),
    forensicSha256:state.forensicSha256,sourceAuditSha256:state.audit.sha256,oldResultSha256:INVALID_RESULT_SHA256,
    head:currentHead(root),testReportSha256});
  const next=proposedLedger(state.ledger),bytes=generation2.jsonBytes(next);
  return {decision:'STAGE3E_PRE_RENDER_ABORT_RECONCILIATION_READY',legacyResultDisposition:'INVALID_PRECOMMIT_RESULT',
    targetCell:TARGET,oldLedgerSha256:state.ledgerSha256,newLedgerSha256:sha256(bytes),compatibilityDecision:compatibility.decision,
    compatibilitySha256:sha256(jsonBytes(stable(compatibility))),pending:1512,inProgress:0,complete:0,builds:0,renders:0,acousticRenders:0,evidenceWrites:0};
}
function readV3(state,{root=ROOT}={}){
  const bundle=state.bridge||compatibilityV3.readBundle(state.roots);
  compatibilityV3.validateRecord(bundle.record,{root,head:currentHead(root),manifest:state.manifest,
    v1Sha256:state.v1v2?.v1Sha256||state.v2Bundle?.v1Sha256,v2Sha256:state.v1v2?.sha256||state.v2Bundle?.sha256,
    sourceAuditSha256:state.audit.sha256,inventorySha256:compatibilityV2.fixedInventorySha(state.audit.audit),
    preAbortEvidenceSha256:state.forensicSha256,pinned:bundle.record.pinnedExecutorHashes});
  return bundle;
}

function readResumableState({root=ROOT,home=process.env.HOME}={}){
  const roots=rootsFor(root,home),manifestStored=readDual(roots,'generation-2-manifest.json');
  if(manifestStored.sha256!==evidenceValidator.SEARCH_MANIFEST_SHA256)fail('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','manifest changed');
  const manifest=JSON.parse(manifestStored.bytes.toString('utf8')),resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest),tRoots=transactionRoots(roots);
  const v1=readDual(roots,'pre-render-abort-recovery-v1/pre-abort-low-ledger.json'),forensicFile=readDual(roots,'pre-render-abort-recovery-v1/forensic-evidence.json');
  const oldAuth=readDual(roots,'pre-render-abort-recovery-v1/recovery-authorization.json'),oldResult=readDual(roots,'pre-render-abort-recovery-v1/recovery-result.json');
  if(v1.sha256!==OLD_LEDGER_SHA256||oldAuth.sha256!==OLD_AUTHORIZATION_SHA256||oldResult.sha256!==INVALID_RESULT_SHA256||forensicFile.sha256!==FORENSIC_SHA256)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','legacy immutable recovery evidence changed');
  const forensic=JSON.parse(forensicFile.bytes.toString('utf8'));recoveryApi().validateAbortForensic(forensic,forensicFile.sha256);
  const audit=require('./run-stage3e-midi41-evidence-amendment.cjs').assertSourceAudit({root,home});
  const amendment=require('./run-stage3e-midi41-evidence-amendment.cjs').verify({root,home});
  if(audit.sha256!==evidenceValidator.SOURCE_AUDIT_SHA256||amendment.resultSha256!==compatibilityV2.AMENDMENT_RESULT_SHA256||
     amendment.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendment.result?.effectivePassCount!==12)
    fail('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT','frozen source audit or baseline amendment changed');
  const v1v2=compatibilityV2.readBundle(roots),bridge=compatibilityV3.readBundle(roots);
  compatibilityV3.validateRecord(bridge.record,{root,head:currentHead(root),manifest,v1Sha256:v1v2.v1Sha256,v2Sha256:v1v2.sha256,
    sourceAuditSha256:audit.sha256,inventorySha256:compatibilityV2.fixedInventorySha(audit.audit),
    preAbortEvidenceSha256:forensicFile.sha256,pinned:bridge.record.pinnedExecutorHashes});
  const compatibility=readCompatibility(roots);
  validateCompatibilityRecord(compatibility.record,{root,manifest,manifestSha256:manifestStored.sha256,bridge,forensicSha256:forensicFile.sha256,
    sourceAuditSha256:audit.sha256,oldResultSha256:oldResult.sha256,testReportSha256:compatibility.record.zeroRenderVerifierTestReportSha256});
  const intent=readDual(tRoots,FILES.intent),authorization=readDual(tRoots,FILES.authorization),stagedLedger=readDual(tRoots,FILES.stagedLedger),stagedTransition=readDual(tRoots,FILES.stagedTransition);
  const intentObj=JSON.parse(intent.bytes.toString('utf8')),authObj=JSON.parse(authorization.bytes.toString('utf8')),
    nextLedger=JSON.parse(stagedLedger.bytes.toString('utf8')),entry=JSON.parse(stagedTransition.bytes.toString('utf8'));
  if(intentObj.schemaVersion!==2||intentObj.executionId!==EXECUTION_ID||intentObj.transactionId!==EXECUTION_ID||
     intentObj.decision!=='STAGE3E_ADMINISTRATIVE_REQUEUE_INTENT'||
     intentObj.targetCell?.key!==TARGET_KEY||intentObj.oldLedgerSha256!==OLD_LEDGER_SHA256||intentObj.sourceAuditSha256!==audit.sha256||
     intentObj.oldAuthorizationSha256!==oldAuth.sha256||intentObj.preRenderAbortProofSha256!==forensicFile.sha256||
     intentObj.invalidRecoveryResultSha256!==oldResult.sha256||intentObj.recoveryCompatibilityV3Sha256!==bridge.sha256||
     intentObj.recoveryReconciliationCompatibilitySha256!==compatibility.sha256||sha256(stagedLedger.bytes)!==intentObj.newLedgerSha256||
     sha256(authorization.bytes)!==entry.recoveryAuthorizationSha256||sha256(intent.bytes)!==entry.transactionIntentSha256||
     authObj.executionId!==EXECUTION_ID||authObj.transactionIntentSha256!==intent.sha256||authObj.oldAuthorizationSha256!==oldAuth.sha256||
     authObj.invalidRecoveryResultSha256!==oldResult.sha256||authObj.forensicEvidenceSha256!==forensicFile.sha256||
     authObj.authorizedAdministrativeTransitions!==1||authObj.acousticRendersAuthorized!==0||authObj.acousticRendersObserved!==0||
     entry.eventType!=='ADMIN_REQUEUE_NO_RENDER'||entry.sequence!==2)
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COLLISION','staged transaction binding differs');
  const genesis=readDual(roots,'ledger-transition-journal/genesis-ledger.json'),journal1=readDual(roots,'ledger-transition-journal/transition-000001.json');
  const transitionPath='ledger-transition-journal/transition-000002.json',hasA=fs.existsSync(join(roots.primary,transitionPath)),hasB=fs.existsSync(join(roots.secondary,transitionPath));
  if(hasA!==hasB)fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','journal transition 2 exists in one store only');
  const journal2=hasA?readDual(roots,transitionPath):null;
  const oldBytes=v1.bytes,newBytes=stagedLedger.bytes,live=readLiveLedgerPair(resolved,intentObj.oldLedgerSha256,intentObj.newLedgerSha256,oldBytes,newBytes);
  if(journal2&&(!journal2.bytes.equals(stagedTransition.bytes)||journal2.sha256!==stagedTransition.sha256))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','journal transition 2 differs from staged event');
  if(journal2){
    const replay=evidenceValidator.validateLedgerTransitions({genesisLedgerBytes:genesis.bytes,currentLedgerBytes:newBytes,
      transitionEntries:[JSON.parse(journal1.bytes.toString('utf8')),entry],renderStartEntries:[],expectedCells:search.expectedLowScreenCells(),
      bindings:{manifestSha256:manifestStored.sha256,proofSha256:PROOF_SHA256,compatibilitySha256:bridge.sha256,
        acceptedCompatibilitySha256s:[v1v2.sha256],recoveryCompatibilitySha256:bridge.sha256,
        recoveryReconciliationCompatibilitySha256:compatibility.sha256}});
    if(replay.pending!==1512||replay.inProgress!==0||replay.complete!==0||replay.renderCalls!==0)
      fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','journal replay does not produce exact no-render requeue state');
  }else if(live.some(item=>item.sha256!==OLD_LEDGER_SHA256))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','ledger advanced before journal transition');
  return {roots,resolved,manifest,manifestSha256:manifestStored.sha256,forensic,forensicSha256:forensicFile.sha256,genesis,
    oldResultSha256:oldResult.sha256,audit,bridge,v1v2,compatibility,intent:intentObj,intentSha256:intent.sha256,
    originalLedgerBytes:v1.bytes,authorization:authObj,authorizationSha256:authorization.sha256,stagedLedgerBytes:stagedLedger.bytes,stagedLedgerSha256:stagedLedger.sha256,
    entry,transitionBytes:stagedTransition.bytes,transitionSha256:stagedTransition.sha256,journal1,journal2,live};
}
function transactionFromState(state){
  const roots=transactionRoots(state.roots),disposition=readDual(roots,FILES.invalidDisposition);
  return {tRoots:roots,intent:state.intent,intentBytes:jsonBytes(state.intent),intentSha256:state.intentSha256,
    authorization:state.authorization,authorizationBytes:jsonBytes(state.authorization),authorizationSha256:state.authorizationSha256,
    dispositionBytes:disposition.bytes,stagedLedgerBytes:state.stagedLedgerBytes,stagedLedgerSha256:state.stagedLedgerSha256,
    transitionBytes:state.transitionBytes,transitionSha256:state.transitionSha256,entry:state.entry};
}
function committedPostconditions(state,transaction,compatibility){
  if(!state.journal2||state.live.some(item=>item.sha256!==transaction.stagedLedgerSha256))
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','journal and both live ledger copies must be committed before verification');
  return validatePostconditions(state,transaction,compatibility);
}
function evidenceSnapshot(roots){
  return {primary:evidenceValidator.walkFiles(roots.base.primary),secondary:evidenceValidator.walkFiles(roots.base.secondary)};
}
function assertZeroReadOnly(result,label,decision){
  if(!result||result.decision!==decision||result.builds!==0||result.renders!==0||result.acousticRenders!==0||(result.evidenceWrites??0)!==0)
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_PREFLIGHT',`${label} did not pass zero-build/render/write gate`);
}
function runCliJson(root,home,relative,mode){
  const command=path.join(root,'wasm/plugins/dsp/super-synth/test/tools',relative);
  try{
    const output=execFileSync('rtk',['node',command,mode],{cwd:root,encoding:'utf8',env:{...process.env,HOME:home,
      SORAOTO_WASM_BUILD_DIR:path.join(root,'build/wasm-stage3e')}}).trim();
    return JSON.parse(output);
  }catch(error){
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_PREFLIGHT',`${relative} ${mode} failed: ${String(error.stdout||'')}${String(error.stderr||error.message||'')}`);
  }
}
function runRequiredCliGates({root=ROOT,home=process.env.HOME,invoke=runCliJson,snapshot=evidenceSnapshot}={}){
  const roots=rootsFor(root,home),before=snapshot(roots);
  const checks=[
    {script:'run-stage3e-pre-render-abort-recovery.cjs',mode:'--verify',label:'recovery --verify',decision:'STAGE3E_PRE_RENDER_ABORT_COMMIT_VERIFIED'},
    {script:'run-stage3e-generation2.cjs',mode:'--dry-run',label:'Generation-2 --dry-run',decision:'GENERATION2_SEARCH_READY'},
    {script:'run-stage3e-master-orchestrator.cjs',mode:'--dry-run',label:'master --dry-run',decision:'STAGE3E_MASTER_DRY_RUN_READY'}
  ].map(check=>{
    const result=invoke(root,home,check.script,check.mode);assertZeroReadOnly(result,check.label,check.decision);
    return {command:`${check.script} ${check.mode}`,decision:result.decision,builds:result.builds,renders:result.renders,
      acousticRenders:result.acousticRenders,evidenceWrites:result.evidenceWrites??0};
  });
  const after=snapshot(roots);
  if(!same(before,after))fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_PREFLIGHT','read-only CLI gates changed evidence bytes or mtimes');
  return {pass:true,checks,evidenceWrites:0,snapshotSha256:sha256(jsonBytes({primary:before.primary,secondary:before.secondary}))};
}
function completeTransaction({root=ROOT,home=process.env.HOME,testReportSha256}={}){
  const entryRoots=rootsFor(root,home),entryTransactionRoots=transactionRoots(entryRoots);
  const finalRelatives=[FILES.receipt,FILES.result,FILES.manifest,FILES.manifestSha,FILES.archive];
  if(finalRelatives.every(relative=>[join(entryTransactionRoots.primary,relative),join(entryTransactionRoots.secondary,relative)].every(fs.existsSync))){
    return {...verify({root,home}),idempotent:true,evidenceWrites:0};
  }
  let state;
  const roots=rootsFor(root,home),manifest=JSON.parse(readDual(roots,'generation-2-manifest.json').bytes.toString('utf8')),
    resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest),liveLedgerPaths=[resolved.primary.lowLedger,resolved.secondary.lowLedger];
  const liveCopies=liveLedgerPaths.map(file=>{if(!fs.existsSync(file))fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','live low ledger copy missing');const bytes=fs.readFileSync(file);return {bytes,sha256:sha256(bytes)};});
  const oldPair=liveCopies.every(item=>item.sha256===OLD_LEDGER_SHA256);
  const transactionStarted=[FILES.intent,FILES.authorization,FILES.stagedLedger,FILES.stagedTransition].some(relative=>
    fs.existsSync(join(transactionRoots(roots).primary,relative))||fs.existsSync(join(transactionRoots(roots).secondary,relative)));
  if(oldPair&&!transactionStarted){
    const original=recoveryApi().readOriginalArtifacts({root,home});
    state={...original,bridge:readV3(original)};
    const compatibility=prepareCompatibility(state,{root,testReportSha256});
    const transaction=makeTransaction(state,compatibility);
    stageIntent(state,transaction);
    const replay=validateProposedReplay(state,transaction,compatibility);
    if(replay.pending!==1512||replay.inProgress!==0||replay.complete!==0||replay.renderCalls!==0)
      fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','staged proposal failed transition replay');
    appendJournalOnce(state.roots,transaction.transitionBytes,transaction.transitionSha256);
    mirrorLiveLedger(state.resolved,transaction,state.ledgerBytes);
    const postconditions=validatePostconditions(state,transaction,compatibility);
    const gates=runRequiredCliGates({root,home});
    const final=finalizeArtifacts(state,transaction,compatibility,{...postconditions,gates},{root});
    const verified=verify({root,home});
    return {...verified,decision:'STAGE3E_PRE_RENDER_ABORT_RECONCILED',legacyResultDisposition:'INVALID_PRECOMMIT_RESULT',
      oldLedgerSha256:state.ledgerSha256,requeuedLedgerSha256:postconditions.ledger.sha256,transactionIntentSha256:transaction.intentSha256,
      authorizationSha256:transaction.authorizationSha256,transitionSha256:transaction.transitionSha256,
      recoveryReconciliationCompatibilitySha256:compatibility.sha256,receiptSha256:final.receiptSha256,resultSha256:final.resultSha256,
      manifestSha256:final.manifestSha256,archiveSha256:final.archiveSha256,preFinalizeGates:gates,renderCalls:0,builds:0,renders:0,evidenceWrites:13};
  }
  state=readResumableState({root,home});
  if(!testReportSha256)testReportSha256=state.compatibility.record.zeroRenderVerifierTestReportSha256;
  const record=state.compatibility.record;
  validateCompatibilityRecord(record,{root,manifest:state.manifest,manifestSha256:state.manifestSha256,bridge:state.bridge,
    forensicSha256:state.forensicSha256,sourceAuditSha256:state.audit.sha256,oldResultSha256:state.oldResultSha256,testReportSha256});
  const transaction=transactionFromState(state);
  const compatibility=state.compatibility;
  if(!state.journal2){
    if(state.live.some(item=>item.sha256!==OLD_LEDGER_SHA256))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','live ledger advanced without journal');
    immutableDual(state.roots,'ledger-transition-journal/transition-000002.json',state.transitionBytes);
  }
  mirrorLiveLedger(state.resolved,transaction,state.originalLedgerBytes);
  const post=committedPostconditions(state,transaction,compatibility);
  const gates=runRequiredCliGates({root,home});
  const final=finalizeArtifacts(state,transaction,compatibility,{...post,gates},{root});
  const verified=verify({root,home});
  return {...verified,decision:'STAGE3E_PRE_RENDER_ABORT_RECONCILED',legacyResultDisposition:'INVALID_PRECOMMIT_RESULT',
    oldLedgerSha256:OLD_LEDGER_SHA256,requeuedLedgerSha256:post.ledger.sha256,transactionIntentSha256:state.intentSha256,
    authorizationSha256:state.authorizationSha256,transitionSha256:state.transitionSha256,recoveryReconciliationCompatibilitySha256:compatibility.sha256,
    receiptSha256:final.receiptSha256,resultSha256:final.resultSha256,manifestSha256:final.manifestSha256,archiveSha256:final.archiveSha256,
    preFinalizeGates:gates,renderCalls:0,builds:0,renders:0,evidenceWrites:4};
}

function verify({root=ROOT,home=process.env.HOME}={}){
  const state=readResumableState({root,home}),transaction=transactionFromState(state),post=committedPostconditions(state,transaction,state.compatibility);
  const roots=transactionRoots(state.roots),finalRelatives=[FILES.receipt,FILES.result,FILES.manifest,FILES.manifestSha,FILES.archive];
  const presence=finalRelatives.map(relative=>[join(roots.primary,relative),join(roots.secondary,relative)].map(fs.existsSync));
  if(presence.every(pair=>!pair[0]&&!pair[1]))return {decision:'STAGE3E_PRE_RENDER_ABORT_COMMIT_VERIFIED',legacyResultDisposition:'INVALID_PRECOMMIT_RESULT',
    ledgerSha256:post.ledger.sha256,journalTipSha256:state.journal2.sha256,compatibilitySha256:state.compatibility.sha256,
    pending:post.replay.pending,inProgress:post.replay.inProgress,complete:post.replay.complete,renderCalls:post.replay.renderCalls,
    builds:0,renders:0,acousticRenders:0,evidenceWrites:0,finalized:false};
  if(presence.some(pair=>!pair[0]||!pair[1]))
    fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','finalized reconciliation artifacts are incomplete in one or both stores');
  const receipt=readDual(roots,FILES.receipt),result=readDual(roots,FILES.result),manifest=readDual(roots,FILES.manifest),manifestHash=readDual(roots,FILES.manifestSha),archive=readDual(roots,FILES.archive);
  if(manifestHash.bytes.toString('utf8')!==manifest.sha256+'\n')fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_EVIDENCE','evidence manifest SHA file mismatch');
  const resultObj=JSON.parse(result.bytes.toString('utf8')),receiptObj=JSON.parse(receipt.bytes.toString('utf8')),manifestObj=JSON.parse(manifest.bytes.toString('utf8'));
  if(resultObj.decision!=='STAGE3E_PRE_RENDER_ABORT_RECONCILED'||resultObj.invalidPrecommitResultSha256!==INVALID_RESULT_SHA256||
     resultObj.requeuedLedgerSha256!==post.ledger.sha256||resultObj.requeuedLedgerSha256!==state.stagedLedgerSha256||
     resultObj.intentSha256!==state.intentSha256||resultObj.authorizationSha256!==state.authorizationSha256||
     resultObj.journalTipSha256!==state.journal2.sha256||resultObj.compatibilitySha256!==state.compatibility.sha256||
     resultObj.renderCalls!==0||resultObj.authorizedAdministrativeRequeues!==1||resultObj.administrativeRequeues!==1||
     resultObj.pending!==1512||resultObj.inProgress!==0||resultObj.complete!==0||
     receiptObj.decision!=='STAGE3E_PRE_RENDER_ABORT_RECONCILIATION_RECEIPT'||receiptObj.invalidPrecommitResultSha256!==INVALID_RESULT_SHA256||
     receiptObj.intentSha256!==state.intentSha256||receiptObj.newLedgerSha256!==post.ledger.sha256||
     receiptObj.journalTipSha256!==state.journal2.sha256||receiptObj.renderCalls!==0)
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_EVIDENCE','immutable reconciliation result or receipt binding mismatch');
  const inventory=durable.assertMatchingInventory(roots.primary,roots.secondary);
  if(!same(manifestObj.files,inventory))fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_EVIDENCE','final evidence manifest inventory differs from stored files');
  const archiveEntries=execFileSync('tar',['-tzf',join(roots.primary,FILES.archive)],{encoding:'utf8'}).trim().split(/\r?\n/);
  for(const item of inventory){if(!archiveEntries.includes('./'+item.relativePath)&&!archiveEntries.includes(item.relativePath))
      fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_EVIDENCE','phase archive lacks '+item.relativePath);}
  const archivedResult=execFileSync('tar',['-xOf',join(roots.primary,FILES.archive),'./'+FILES.result]);
  const archivedReceipt=execFileSync('tar',['-xOf',join(roots.primary,FILES.archive),'./'+FILES.receipt]);
  if(!archivedResult.equals(result.bytes)||!archivedReceipt.equals(receipt.bytes))
    fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_EVIDENCE','phase archive result/receipt bytes differ');
  return {decision:resultObj.decision,legacyResultDisposition:'INVALID_PRECOMMIT_RESULT',ledgerSha256:post.ledger.sha256,
    journalTipSha256:state.journal2.sha256,manifestSha256:manifest.sha256,resultSha256:result.sha256,receiptSha256:receipt.sha256,
    compatibilitySha256:state.compatibility.sha256,archiveSha256:archive.sha256,pending:post.replay.pending,
    inProgress:post.replay.inProgress,complete:post.replay.complete,renderCalls:post.replay.renderCalls,
    builds:0,renders:0,acousticRenders:0,evidenceWrites:0,finalized:true};
}
function dryRun(options={}){
  const roots=rootsFor(options.root||ROOT,options.home||process.env.HOME),manifest=JSON.parse(readDual(roots,'generation-2-manifest.json').bytes.toString('utf8')),
    resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest),ledger=durable.verifyDualCopy(resolved.primary.lowLedger,resolved.secondary.lowLedger);
  if(ledger.sha256===OLD_LEDGER_SHA256)return {...initialDryRun(options),mode:'pre-transaction'};
  return {...verify(options),mode:'post-transaction'};
}
function run({mode,root=ROOT,home=process.env.HOME,testReportSha256=process.env.STAGE3E_V2_TEST_REPORT_SHA256}={}){
  if(mode==='--dry-run')return dryRun({root,home,testReportSha256});
  if(mode==='--execute')return completeTransaction({root,home,testReportSha256});
  if(mode==='--verify')return verify({root,home});
  throw new Error('supported modes: --dry-run, --execute, --verify');
}
function main(argv=process.argv.slice(2)){if(argv.length!==1)throw new Error('one explicit mode is required');process.stdout.write(JSON.stringify(run({mode:argv[0]}))+'\n');}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,RELATIVE,OLD_HEAD,OLD_LEDGER_SHA256,INVALID_RESULT_SHA256,OLD_AUTHORIZATION_SHA256,FORENSIC_SHA256,PROOF_SHA256,TARGET_KEY,TARGET,FILES,
  ALLOWED_DIFF_PATHS,VERIFIER_RUNTIME_PATHS,sha256,jsonBytes,stable,same,rootsFor,transactionRoots,immutableDual,countStates,proposedLedger,verifierDiff,codeIdentity,
  assertCurrentVerifierAtAnchor,
  buildCompatibilityRecord,validateCompatibilityRecord,writeCompatibility,readCompatibility,readBaseline,makeTransaction,stageIntent,
  validateProposedReplay,appendJournalOnce,mirrorLiveLedger,validatePostconditions,finalizeArtifacts,runRequiredCliGates,completeTransaction,verify,dryRun,run,main};
