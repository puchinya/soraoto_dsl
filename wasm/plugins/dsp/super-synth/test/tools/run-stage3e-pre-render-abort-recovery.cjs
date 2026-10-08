#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const generation2=require('./run-stage3e-generation2.cjs');
const preflight=require('./stage3e-preflight.cjs');
const evidenceValidator=require('./stage3e-evidence-validator.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');
const amendment=require('./run-stage3e-midi41-evidence-amendment.cjs');
const compatibilityV2=require('./stage3e-search-compatibility.cjs');
const compatibilityV3=require('./stage3e-search-compatibility-v3.cjs');
const masterOrchestrator=require('./run-stage3e-master-orchestrator.cjs');

const ROOT=search.ROOT;
const RECOVERY_DIR='pre-render-abort-recovery-v1';
const PRE_ABORT_LEDGER='pre-abort-low-ledger.json';
const FORENSIC='forensic-evidence.json';
const AUTHORIZATION='recovery-authorization.json';
const RESULT='recovery-result.json';
const ARCHIVE='pre-render-abort-recovery-v1.tar.gz';
const TARGET_KEY='low-screen-L1-M1-H0-midi-036-v110';
const OLD_HEAD='01c059ae9497119e5ef22d273958ca33eeade9a0';
const OLD_LEDGER_SHA256='c8c0d162aafcf30908e4b1d7637245ecb6418328a75cee35d76303328960109f';
const FORENSIC_SHA256='e601de82fbb382065b0d3c7efed6da8540c25681d5e622a11fb74a4cf12bb482';
const V1_SHA256='331279140ef707c71c81cf716eed052f443e8537616bac83ad88e002bf61b1e5';
const V2_SHA256='5f3340f7b993bb879aa29bca4214e5192008f54308d20160282aac0cfcc6f797';
const TARGET={pitch:36,velocity:14,velocityNormalized:14/127,phase:'low-screen',response:{low:1,mid:1,bassHardness:0},key:TARGET_KEY};

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function rootPaths(root=ROOT,home=process.env.HOME){return preflight.searchRoots(root,home);}
function readDual(roots,relative){return durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative));}
function sidecarRoots(roots){return {primary:path.join(roots.primary,RECOVERY_DIR),secondary:path.join(roots.secondary,RECOVERY_DIR)};}
function currentHead(root){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells||{}).filter(row=>row.state===state).length]));}
function error(token,detail){throw new Error(`${token}: ${detail}`);}
function lowLedgerIdentityMatchesManifest(ledgerIdentity,manifest){
  const base=manifest?.identity,referenceSetSha256=base?.referenceSetSha256;
  if(typeof referenceSetSha256!=='string'||!/^[0-9a-f]{64}$/.test(referenceSetSha256))return false;
  return same(ledgerIdentity,generation2.lowPhaseIdentity(base,referenceSetSha256));
}
function priorExecutionLogMatches(bytes,prior){
  if(!Buffer.isBuffer(bytes)||!prior||typeof prior.content!=='string'||!Number.isInteger(prior.sizeBytes)||
     !/^[0-9a-f]{64}$/.test(prior.sha256||'')||sha256(bytes)!==prior.sha256||bytes.length!==prior.sizeBytes)return false;
  const recorded=Buffer.from(prior.content,'utf8');
  return bytes.equals(recorded)||(!prior.content.endsWith('\n')&&bytes.length===recorded.length+1&&bytes[bytes.length-1]===0x0a&&bytes.subarray(0,-1).equals(recorded));
}
function reproductionCount(forensic){return forensic?.isolatedOldSourceReproduction?.harnessConstructionCount??null;}

function validateAbortForensic(forensic,sha=FORENSIC_SHA256){
  const reproduction=forensic?.isolatedOldSourceReproduction;
  if(sha!==FORENSIC_SHA256||forensic?.decision!=='PRE_RENDER_ABORT_FORENSICS_VERIFIED'||
     forensic?.preAbortLedgerSha256!==OLD_LEDGER_SHA256||forensic?.bootstrapLedgerSha256!==evidenceValidator.LOW_GENESIS_SHA256||
     forensic?.searchManifestSha256!==evidenceValidator.SEARCH_MANIFEST_SHA256||forensic?.sourceAuditSha256!==evidenceValidator.SOURCE_AUDIT_SHA256||
     forensic?.fixed35InventorySha256!=='25e4bb121a8714bc90cd83ed00df1c8eb577208b87d2e272b15fc389fd212adf'||
     forensic?.preAbortCellId!==TARGET_KEY||forensic?.preAbortOriginalRowStatus!=='IN_PROGRESS'||forensic?.cellPayloadAbsent!==true||
     forensic?.ledgerCounts?.PENDING!==1511||forensic?.ledgerCounts?.IN_PROGRESS!==1||forensic?.ledgerCounts?.COMPLETE!==0||forensic?.ledgerCounts?.renderCalls!==0||
     !same(forensic.preAbortCellIdentity,TARGET)||!reproduction||reproduction.sourceRevision!==OLD_HEAD||
     reproduction.errorName!=='TypeError'||reproduction.errorMessage!=='values is not iterable'||
     reproduction.harnessConstructionCount!==0||reproduction.processCalls!==0||reproduction.acousticRenderCalls!==0)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','immutable forensic record does not prove this exact pre-render abort');
  const prior=forensic.priorExecutionLog;
  if(prior&&fs.existsSync(prior.path)){
    const bytes=fs.readFileSync(prior.path);
    if(!priorExecutionLogMatches(bytes,prior))
      error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','saved original execution log changed');
  }
  return true;
}

function readOriginalArtifacts({root=ROOT,home=process.env.HOME}={}){
  const roots=rootPaths(root,home),resolvedManifest=readDual(roots,'generation-2-manifest.json');
  if(resolvedManifest.sha256!==evidenceValidator.SEARCH_MANIFEST_SHA256)
    error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','immutable search manifest SHA changed');
  const manifest=JSON.parse(resolvedManifest.bytes.toString('utf8'));
  const resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest);
  const ledgerFile=durable.verifyDualCopy(resolved.primary.lowLedger,resolved.secondary.lowLedger);
  if(ledgerFile.sha256!==OLD_LEDGER_SHA256)error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','pre-abort low ledger SHA changed');
  const sidecar=sidecarRoots(roots),snapshot=readDual({primary:roots.primary,secondary:roots.secondary},`${RECOVERY_DIR}/${PRE_ABORT_LEDGER}`);
  const forensicFile=readDual({primary:roots.primary,secondary:roots.secondary},`${RECOVERY_DIR}/${FORENSIC}`);
  const forensic=JSON.parse(forensicFile.bytes.toString('utf8'));
  validateAbortForensic(forensic,forensicFile.sha256);
  if(snapshot.sha256!==OLD_LEDGER_SHA256||!snapshot.bytes.equals(ledgerFile.bytes))
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','immutable pre-abort ledger snapshot does not match current ledger');
  const ledger=JSON.parse(ledgerFile.bytes.toString('utf8')),cells=search.expectedLowScreenCells();
  if(ledger.authorizedCellCount!==1512||!same(Object.keys(ledger.cells||{}),cells.map(cell=>cell.key))||
     !lowLedgerIdentityMatchesManifest(ledger.identity,manifest)||ledger.accounting?.renderCalls!==0||!same(counts(ledger),{PENDING:1511,IN_PROGRESS:1,COMPLETE:0}))
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','low ledger state/count/order changed');
  const inProgress=Object.entries(ledger.cells).filter(([,row])=>row.state==='IN_PROGRESS');
  if(inProgress.length!==1||inProgress[0][0]!==TARGET_KEY||!same(inProgress[0][1].identity,TARGET))
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','the only IN_PROGRESS row is not the authorized MIDI36/v14 cell');
  const targetCell=cells.find(cell=>cell.key===TARGET_KEY);
  if(!targetCell||!same(targetCell,TARGET))error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','authorized coordinate is not in the fixed screen matrix');
  const targetPath=path.join(roots.primary,'low','cells',TARGET_KEY+'.json'),targetSecondary=path.join(roots.secondary,'low','cells',TARGET_KEY+'.json');
  if(fs.existsSync(targetPath)||fs.existsSync(targetSecondary)||ledger.cells[TARGET_KEY].sha256!==null)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','target cell already has captured evidence');
  const cellDirPrimary=path.join(roots.primary,'low','cells'),cellDirSecondary=path.join(roots.secondary,'low','cells');
  const payloads=[cellDirPrimary,cellDirSecondary].filter(dir=>fs.existsSync(dir)).flatMap(dir=>fs.readdirSync(dir));
  if(payloads.length)error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','low cell payload exists before search start');

  const v2Bundle=compatibilityV2.readBundle(roots);
  if(v2Bundle.v1Sha256!==V1_SHA256||v2Bundle.sha256!==V2_SHA256)
    error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY','immutable v1/v2 SHA changed');
  const genesis=durable.verifyDualCopy(resolved.primary.genesisLedger,resolved.secondary.genesisLedger);
  const genesisRecordFile=durable.verifyDualCopy(resolved.primary.genesisRecord,resolved.secondary.genesisRecord);
  const genesisRecord=JSON.parse(genesisRecordFile.bytes.toString('utf8'));
  if(genesis.sha256!==evidenceValidator.LOW_GENESIS_SHA256||genesisRecord.genesisLedgerSha256!==genesis.sha256||
     genesisRecord.manifestSha256!==resolvedManifest.sha256||genesisRecord.proofSha256!==evidenceValidator.SOURCE_AUDIT_SHA256||
     genesisRecord.compatibilitySha256!==v2Bundle.sha256||!same(genesisRecord.identity,ledger.identity))
    error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','original genesis binding is invalid');
  const transitionEntries=preflight.readTransitionEntries(roots,manifest),renderStartEntries=preflight.readRenderStartEntries(roots,manifest);
  const journalRoot=resolved.primary.journalRoot,secondaryJournal=resolved.secondary.journalRoot;
  const originalNames=['genesis-ledger.json','genesis.json','transition-000001.json'];
  const actualNames=fs.readdirSync(journalRoot).sort(),secondaryNames=fs.readdirSync(secondaryJournal).sort();
  if(!same(actualNames,originalNames)||!same(secondaryNames,originalNames)||renderStartEntries.length!==0||transitionEntries.length!==1)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','original journal topology has unexpected files or events');
  const liveJournal=originalNames.map(name=>{const stored=durable.verifyDualCopy(path.join(journalRoot,name),path.join(secondaryJournal,name));return {name,sha256:stored.sha256,sizeBytes:stored.sizeBytes};});
  if(!same(liveJournal,forensic.originalJournalFiles))error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','original journal bytes differ from forensic snapshot');
  const replay=evidenceValidator.validateLedgerTransitions({genesisLedgerBytes:genesis.bytes,currentLedgerBytes:ledgerFile.bytes,
    transitionEntries,renderStartEntries,expectedCells:cells,bindings:{manifestSha256:resolvedManifest.sha256,
      proofSha256:evidenceValidator.SOURCE_AUDIT_SHA256,compatibilitySha256:v2Bundle.sha256}});
  if(replay.pending!==1511||replay.inProgress!==1||replay.complete!==0||replay.renderCalls!==0||replay.currentLedgerSha256!==ledgerFile.sha256)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','journal does not terminate at the exact pre-abort ledger');
  const currentWasm=path.join(path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm-stage3e')),'plugins/dsp/super-synth/plugin.wasm');
  if(!fs.existsSync(currentWasm)||sha256(fs.readFileSync(currentWasm))!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
     forensic.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221')
    error('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT','Stage3E diagnostic WASM identity changed');
  const preflightFiles=[AUTHORIZATION,RESULT,'evidence-manifest.json','evidence-manifest.sha256',`archives/${ARCHIVE}`];
  for(const relative of preflightFiles)if(fs.existsSync(path.join(sidecar.primary,relative))||fs.existsSync(path.join(sidecar.secondary,relative)))
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','recovery authorization already exists; one-time recovery cannot repeat');
  const audit=amendment.assertSourceAudit({root,home});
  const amendmentResult=amendment.verify({root,home});
  if(audit.sha256!==evidenceValidator.SOURCE_AUDIT_SHA256||amendmentResult.resultSha256!==compatibilityV2.AMENDMENT_RESULT_SHA256||
     amendmentResult.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendmentResult.result?.effectivePassCount!==12)
    error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT','frozen evidence or Generation-2 12/12 baseline changed');
  return {roots,resolved,manifest,manifestSha256:resolvedManifest.sha256,ledger,ledgerBytes:ledgerFile.bytes,
    ledgerSha256:ledgerFile.sha256,genesisBytes:genesis.bytes,genesisRecord,v2Bundle,forensic,forensicSha256:forensicFile.sha256,
    snapshotSha256:snapshot.sha256,cells,targetCell,replay,audit,amendmentResult,sidecar,
    originalJournalSha256:forensic.originalJournalSha256,transitionEntries,renderStartEntries};
}

function readAndValidateBridge(state,{root=ROOT}={}){
  const bundle=compatibilityV3.readBundle(state.roots);
  compatibilityV3.validateRecord(bundle.record,{root,head:currentHead(root),manifest:state.manifest,
    v1Sha256:state.v2Bundle.v1Sha256,v2Sha256:state.v2Bundle.sha256,
    sourceAuditSha256:state.audit.sha256,inventorySha256:compatibilityV2.fixedInventorySha(state.audit.audit),
    preAbortEvidenceSha256:state.forensicSha256});
  return bundle;
}

function createCompatibilityV3({root=ROOT,home=process.env.HOME}={}){
  const state=readOriginalArtifacts({root,home});
  const existing=[compatibilityV3.RELATIVE,compatibilityV3.SHA_RELATIVE,compatibilityV3.ARCHIVE_RELATIVE,compatibilityV3.ARCHIVE_SHA_RELATIVE]
    .some(relative=>fs.existsSync(path.join(state.roots.primary,relative))||fs.existsSync(path.join(state.roots.secondary,relative)));
  if(existing){const bridge=readAndValidateBridge(state,{root});return {decision:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBLE',v3Sha256:bridge.sha256,archiveSha256:bridge.archiveSha256,reused:true,builds:0,renders:0,evidenceWrites:0};}
  const record=compatibilityV3.buildRecord({root,manifest:state.manifest,manifestSha256:state.manifestSha256,
    v1Sha256:state.v2Bundle.v1Sha256,v2Sha256:state.v2Bundle.sha256,sourceAudit:state.audit.audit,
    sourceAuditSha256:state.audit.sha256,preAbortEvidence:state.forensic,preAbortEvidenceSha256:state.forensicSha256,recoveryCommit:currentHead(root)});
  const saved=compatibilityV3.writeBundle(state.roots,record);
  const reread=readAndValidateBridge(state,{root});
  if(reread.sha256!==saved.sha256||reread.archiveSha256!==saved.archiveSha256)
    error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','v3 bridge failed immediate dual-copy read-back');
  amendment.assertSourceAudit({root,home});
  return {decision:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBLE',v3Sha256:saved.sha256,archiveSha256:saved.archiveSha256,reused:false,builds:0,renders:0,evidenceWrites:4};
}

function recoveryLedger(ledger,key){
  const next=JSON.parse(JSON.stringify(ledger)),state=next.cells?.[key];
  if(!state||state.state!=='IN_PROGRESS'||state.sha256!==null||Object.values(next.cells).filter(row=>row.state==='IN_PROGRESS').length!==1||
     Object.values(next.cells).some(row=>row.state==='COMPLETE')||next.accounting?.renderCalls!==0)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','only the exact pre-render IN_PROGRESS cell may be requeued');
  state.state='PENDING';delete state.startedAt;delete state.completedAt;
  return next;
}

function verifyRecoveredState({root=ROOT,home=process.env.HOME}={}){
  const roots=rootPaths(root,home),sidecar=sidecarRoots(roots),manifestFile=readDual(roots,'generation-2-manifest.json'),
    manifest=JSON.parse(manifestFile.bytes.toString('utf8')),v2Bundle=compatibilityV2.readBundle(roots),v3Bundle=compatibilityV3.readBundle(roots);
  const sourceAudit=amendment.assertSourceAudit({root,home}),forensicFile=readDual(roots,`${RECOVERY_DIR}/${FORENSIC}`),snapshot=readDual(roots,`${RECOVERY_DIR}/${PRE_ABORT_LEDGER}`),
    authorizationFile=readDual(roots,`${RECOVERY_DIR}/${AUTHORIZATION}`),resultFile=readDual(roots,`${RECOVERY_DIR}/${RESULT}`);
  const forensic=JSON.parse(forensicFile.bytes.toString('utf8')),authorization=JSON.parse(authorizationFile.bytes.toString('utf8')),
    result=JSON.parse(resultFile.bytes.toString('utf8'));
  validateAbortForensic(forensic,forensicFile.sha256);
  if(snapshot.sha256!==OLD_LEDGER_SHA256||result.preAbortLedgerSha256!==OLD_LEDGER_SHA256||authorization.preAbortLedgerSha256!==OLD_LEDGER_SHA256||
     result.authorizationSha256!==authorizationFile.sha256||result.abortEvidenceSha256!==forensicFile.sha256||
     authorization.abortEvidenceSha256!==forensicFile.sha256||result.decision!=='STAGE3E_PRE_RENDER_ABORT_RECOVERY_COMPLETE'||
     authorization.decision!=='STAGE3E_PRE_RENDER_ABORT_RECOVERY_AUTHORIZED'||authorization.attemptIndex!==1||result.attemptIndex!==1||
     !same(authorization.targetCell,TARGET)||!same(result.targetCell,TARGET)||authorization.abortedBeforeRenderCalls!==0||
     result.abortedBeforeRenderCalls!==0||authorization.acousticRendersDuringRecovery!==0||result.acousticRendersDuringRecovery!==0||
     authorization.searchCompletedAtRecovery!==0||result.pendingAfterRecovery!==1512||result.inProgressAfterRecovery!==0||
     result.completeAfterRecovery!==0||!same(result.transitions,[
       {sequence:2,eventType:'ABORTED_BEFORE_RENDER'},{sequence:3,eventType:'REQUEUE_AUTHORIZED'}]))
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','recovery result or authorization binding mismatch');
  const bridge=compatibilityV3.readBundle(roots);
  compatibilityV3.validateRecord(bridge.record,{root,head:currentHead(root),manifest,v1Sha256:v2Bundle.v1Sha256,v2Sha256:v2Bundle.sha256,
    sourceAuditSha256:sourceAudit.sha256,inventorySha256:compatibilityV2.fixedInventorySha(sourceAudit.audit),preAbortEvidenceSha256:forensicFile.sha256});
  if(authorization.compatibilityV3Sha256!==bridge.sha256||result.compatibilityV3Sha256!==bridge.sha256)
    error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY','recovery is not bound to the current immutable v3 bridge');
  const ledgerFile=readDual(roots,'low/low-ledger.json'),ledger=JSON.parse(ledgerFile.bytes.toString('utf8'));
  if(ledgerFile.sha256!==result.recoveredLedgerSha256||result.recoveredLedgerSha256!==authorization.recoveredLedgerSha256||
     !same(counts(ledger),{PENDING:1512,IN_PROGRESS:0,COMPLETE:0})||ledger.accounting?.renderCalls!==0)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','post-recovery low ledger counts or SHA mismatch');
  const transitions=preflight.readTransitionEntries(roots,manifest),renderStarts=preflight.readRenderStartEntries(roots,manifest);
  const recoveryEvents=transitions.filter(entry=>entry.eventType==='ABORTED_BEFORE_RENDER'||entry.eventType==='REQUEUE_AUTHORIZED');
  if(transitions.length!==3||recoveryEvents.length!==2||recoveryEvents[0].eventType!=='ABORTED_BEFORE_RENDER'||recoveryEvents[1].eventType!=='REQUEUE_AUTHORIZED'||
     recoveryEvents.some(entry=>entry.cellKey!==TARGET_KEY||entry.compatibilitySha256!==bridge.sha256||entry.recoveryAuthorizationSha256!==authorizationFile.sha256||
       entry.recoveryResultSha256!==resultFile.sha256||entry.abortEvidenceSha256!==forensicFile.sha256||entry.attemptIndex!==1||entry.abortedBeforeRenderCalls!==0)||
     renderStarts.length!==0||recoveryEvents[1].nextLedgerSha256!==ledgerFile.sha256)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','recovery journal events are missing, duplicated, or changed');
  const originalTransition=transitions[0];
  if(originalTransition.compatibilitySha256!==v2Bundle.sha256||originalTransition.nextLedgerSha256!==OLD_LEDGER_SHA256)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','historical first transition was rewritten');
  const replay=evidenceValidator.validateLedgerTransitions({genesisLedgerBytes:readDual(roots,'ledger-transition-journal/genesis-ledger.json').bytes,
    currentLedgerBytes:ledgerFile.bytes,transitionEntries:transitions,renderStartEntries:renderStarts,expectedCells:search.expectedLowScreenCells(),
    bindings:{manifestSha256:manifestFile.sha256,proofSha256:evidenceValidator.SOURCE_AUDIT_SHA256,
      compatibilitySha256:bridge.sha256,acceptedCompatibilitySha256s:[v2Bundle.sha256],recoveryCompatibilitySha256:bridge.sha256,
      recoveryResultSha256:resultFile.sha256}});
  if(replay.pending!==1512||replay.inProgress!==0||replay.complete!==0||replay.renderCalls!==0)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','journal replay did not return exact zero-render state');
  const dryLedgerSha=ledgerFile.sha256;
  const generation2DryRun=generation2.run({mode:'--dry-run',root,home});
  if(generation2DryRun.builds!==0||generation2DryRun.renders!==0||generation2DryRun.acousticRenders!==0||generation2DryRun.evidenceWrites!==0||
     generation2DryRun.decision!=='GENERATION2_SEARCH_READY'||generation2DryRun.preflightValidatedLowScreenRows!==1512)
    error('BLOCKED_STAGE3E_DIAGNOSTIC_PREFLIGHT','direct Generation-2 dry-run did not pass read-only readiness');
  const masterDryRun=masterOrchestrator.run({mode:'--dry-run',root,home});
  if(masterDryRun.builds!==0||masterDryRun.renders!==0||masterDryRun.acousticRenders!==0||masterDryRun.evidenceWrites!==0||
     masterDryRun.decision!=='STAGE3E_MASTER_DRY_RUN_READY'||masterDryRun.phaseEntry?.stage3?.authorizedRenderCount!==486||
     masterDryRun.phaseEntry?.stage4?.authorizedRenderCount!==1423)
    error('BLOCKED_STAGE3E_MASTER_PHASE_ENTRY','master dry-run failed a read-only phase gate');
  if(readDual(roots,'low/low-ledger.json').sha256!==dryLedgerSha)
    error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','dry-run mutated the live low ledger');
  const postDryRunAudit=amendment.assertSourceAudit({root,home});
  if(postDryRunAudit.sha256!==sourceAudit.sha256||!same(postDryRunAudit.inventoryValidation,sourceAudit.inventoryValidation))
    error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE','read-only dry-runs changed frozen evidence inventory or metadata');
  const finalized=durable.verifyDualCopy(path.join(sidecar.primary,'evidence-manifest.json'),path.join(sidecar.secondary,'evidence-manifest.json')),
    finalizedSha=durable.verifyDualCopy(path.join(sidecar.primary,'evidence-manifest.sha256'),path.join(sidecar.secondary,'evidence-manifest.sha256'));
  if(finalizedSha.bytes.toString('utf8')!==finalized.sha256+'\n')error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','recovery evidence manifest hash file mismatch');
  const finalManifest=JSON.parse(finalized.bytes.toString('utf8')),currentInventory=durable.assertMatchingInventory(sidecar.primary,sidecar.secondary);
  if(!same(finalManifest.files,currentInventory))error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','recovery evidence inventory changed after finalization');
  const archive=readDual({primary:sidecar.primary,secondary:sidecar.secondary},`archives/${ARCHIVE}`);
  if(!execFileSync('tar',['-tzf',path.join(sidecar.primary,'archives',ARCHIVE)],{encoding:'utf8'}).includes(`./${AUTHORIZATION}`))
    error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','recovery archive does not contain authorization');
  const genesisFile=readDual(roots,'ledger-transition-journal/genesis-ledger.json');
  const lastTransitionFile=readDual(roots,'ledger-transition-journal/transition-000003.json');
  return {decision:'STAGE3E_PRE_RENDER_ABORT_RECOVERY_COMPLETE',oldLocalHead:OLD_HEAD,recoveryCommit:bridge.record.recoveryCommit,currentHead:currentHead(root),
    v1Sha256:v2Bundle.v1Sha256,v2Sha256:v2Bundle.sha256,
    v3Sha256:bridge.sha256,forensicSha256:forensicFile.sha256,authorizationSha256:authorizationFile.sha256,
    recoveryResultSha256:resultFile.sha256,bootstrapLedgerSha256:evidenceValidator.LOW_GENESIS_SHA256,
    preAbortLedgerSha256:snapshot.sha256,recoveredLedgerSha256:ledgerFile.sha256,
    preAbortCellId:TARGET_KEY,preAbortOriginalRowStatus:'IN_PROGRESS',forensicProof:'PASS',
    immutableInventoryCount:sourceAudit.inventoryValidation.frozenCount,immutableMismatchCount:0,
    harnessConstructionCount:reproductionCount(forensic),acousticRendersBeforeRecovery:0,
    originalJournalSha256:forensic.originalJournalSha256,genesisSourceSha256:genesisFile.sha256,
    lastTransitionSha256:lastTransitionFile.sha256,masterDryRun:masterDryRun.decision,gen2DryRun:generation2DryRun.decision,
    pendingAfterRecovery:replay.pending,inProgressAfterRecovery:replay.inProgress,completeAfterRecovery:replay.complete,
    renderCalls:replay.renderCalls,archiveSha256:archive.sha256,builds:0,renders:0,evidenceWrites:0};
}

function verifyBridgeAndPreAbort({root=ROOT,home=process.env.HOME}={}){
  const state=readOriginalArtifacts({root,home}),bridge=readAndValidateBridge(state,{root});
  return {decision:'STAGE3E_PRE_RENDER_RECOVERY_READY',bridgeSha256:bridge.sha256,bridgeArchiveSha256:bridge.archiveSha256,
    previousLedgerSha256:state.ledgerSha256,genesisLedgerSha256:evidenceValidator.LOW_GENESIS_SHA256,
    originalJournalSha256:state.originalJournalSha256,targetCell:state.targetCell,
    pending:state.replay.pending,inProgress:state.replay.inProgress,complete:state.replay.complete,
    renderCalls:state.replay.renderCalls,builds:0,renders:0,evidenceWrites:0};
}

function executeRecovery({root=ROOT,home=process.env.HOME}={}){
  const ready=verifyBridgeAndPreAbort({root,home});
  const roots=rootPaths(root,home),state=readOriginalArtifacts({root,home}),bridge=readAndValidateBridge(state,{root});
  const sidecar=state.sidecar;
  const oldCode={captureHelperSha256:state.forensic.oldHelperSha256,generation2RunnerSha256:state.forensic.oldGeneration2RunnerSha256};
  const newCode={captureHelperSha256:bridge.record.pinnedExecutorHashes.captureHelper,generation2RunnerSha256:bridge.record.pinnedExecutorHashes.generation2Runner};
  const oldCodeSha256=sha256(Buffer.from(JSON.stringify(stable(oldCode))+'\n')),
    newCodeSha256=sha256(Buffer.from(JSON.stringify(stable(newCode))+'\n'));
  if(sha256(generation2.jsonBytes(state.ledger))!==state.ledgerSha256)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','pre-abort ledger is not byte-identical to the runner canonical serialization');
  const nextLedger=recoveryLedger(state.ledger,TARGET_KEY),nextLedgerBytes=generation2.jsonBytes(nextLedger),nextLedgerSha256=sha256(nextLedgerBytes);
  const authorization={schemaVersion:1,decision:'STAGE3E_PRE_RENDER_ABORT_RECOVERY_AUTHORIZED',attemptIndex:1,
    targetCell:TARGET,oldLocalHead:OLD_HEAD,recoveryCommit:bridge.record.recoveryCommit,
    compatibilityV3Sha256:bridge.sha256,v1Sha256:state.v2Bundle.v1Sha256,v2Sha256:state.v2Bundle.sha256,
    searchManifestSha256:state.manifestSha256,bootstrapLedgerSha256:evidenceValidator.LOW_GENESIS_SHA256,
    preAbortLedgerSha256:state.ledgerSha256,preAbortSnapshotSha256:state.snapshotSha256,
    abortEvidenceSha256:state.forensicSha256,originalJournalSha256:state.originalJournalSha256,
    oldExecutorHashes:oldCode,newExecutorHashes:newCode,oldCodeSha256,newCodeSha256,
    recoveredLedgerSha256:nextLedgerSha256,abortedBeforeRenderCalls:0,searchCompletedAtRecovery:0,
    acousticRendersDuringRecovery:0,createdAt:new Date().toISOString()};
  const authorizationBytes=generation2.jsonBytes(authorization),authorizationSha256=sha256(authorizationBytes);
  const result={schemaVersion:1,decision:'STAGE3E_PRE_RENDER_ABORT_RECOVERY_COMPLETE',attemptIndex:1,
    targetCell:TARGET,authorizationSha256,abortEvidenceSha256:state.forensicSha256,compatibilityV3Sha256:bridge.sha256,
    preAbortLedgerSha256:state.ledgerSha256,recoveredLedgerSha256:nextLedgerSha256,
    originalJournalSha256:state.originalJournalSha256,transitions:[
      {sequence:2,eventType:'ABORTED_BEFORE_RENDER'},{sequence:3,eventType:'REQUEUE_AUTHORIZED'}],
    pendingAfterRecovery:1512,inProgressAfterRecovery:0,completeAfterRecovery:0,abortedBeforeRenderCalls:0,
    acousticRendersDuringRecovery:0,createdAt:new Date().toISOString()};
  const resultBytes=generation2.jsonBytes(result),resultSha256=sha256(resultBytes);
  durable.writeDualCopy(path.join(sidecar.primary,AUTHORIZATION),path.join(sidecar.secondary,AUTHORIZATION),authorizationBytes);
  durable.writeDualCopy(path.join(sidecar.primary,RESULT),path.join(sidecar.secondary,RESULT),resultBytes);
  const journalRoots=generation2.ledgerJournalRoots(roots),journalContext={journalRoots,manifestSha256:state.manifestSha256,
    proofSha256:evidenceValidator.SOURCE_AUDIT_SHA256,compatibilitySha256:bridge.sha256};
  const first=generation2.appendLedgerTransition({roots,ledger:state.ledger,cell:state.targetCell,
    oldState:'IN_PROGRESS',newState:'IN_PROGRESS',previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,
    recoveryAuthorizationSha256:authorizationSha256,recoveryResultSha256:resultSha256,abortEvidenceSha256:state.forensicSha256,
    attemptIndex:1,abortedBeforeRenderCalls:0,oldCodeSha256,newCodeSha256,eventType:'ABORTED_BEFORE_RENDER',...journalContext});
  state.ledger.cells[TARGET_KEY].state='PENDING';delete state.ledger.cells[TARGET_KEY].startedAt;delete state.ledger.cells[TARGET_KEY].completedAt;
  const second=generation2.appendLedgerTransition({roots,ledger:state.ledger,cell:state.targetCell,oldState:'IN_PROGRESS',newState:'PENDING',
    previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,recoveryAuthorizationSha256:authorizationSha256,
    recoveryResultSha256:resultSha256,abortEvidenceSha256:state.forensicSha256,attemptIndex:1,abortedBeforeRenderCalls:0,
    oldCodeSha256,newCodeSha256,eventType:'REQUEUE_AUTHORIZED',...journalContext});
  if(second.nextLedgerSha256!==nextLedgerSha256||first.nextLedgerSha256!==state.ledgerSha256)
    error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','recovery ledger SHA differs from the precomputed authorization');
  const currentResult=durable.verifyDualCopy(path.join(sidecar.primary,RESULT),path.join(sidecar.secondary,RESULT));
  if(currentResult.sha256!==resultSha256)error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','recovery result changed during journal append');
  const metadata={creatorRevision:currentHead(root),executionId:'generation-2',generation:2,
    runnerSha256:newCode.generation2RunnerSha256,helperSha256:newCode.captureHelperSha256,
    wasmSha256:bridge.record.protectedStage3eWasmSha256,startedAt:authorization.createdAt,
    finalizedAt:new Date().toISOString(),decision:'STAGE3E_PRE_RENDER_ABORT_RECOVERY_COMPLETE'};
  durable.writeFinalizedManifest({primaryRoot:sidecar.primary,secondaryRoot:sidecar.secondary,metadata});
  const archive=durable.createPhaseArchive({primaryRoot:sidecar.primary,secondaryRoot:sidecar.secondary,phase:RECOVERY_DIR});
  const verified=verifyRecoveredState({root,home});
  return {...verified,decision:'STAGE3E_PRE_RENDER_ABORT_RECOVERY_COMPLETE',lastTransitionSha256:sha256(generation2.jsonBytes(second.entry)),
    archiveSha256:archive.sha256,builds:0,renders:0,evidenceWrites:8,alreadyReady:ready.decision};
}

function dryRun({root=ROOT,home=process.env.HOME}={}){
  const roots=rootPaths(root,home),ledger=readDual(roots,'low/low-ledger.json');
  if(ledger.sha256===OLD_LEDGER_SHA256)return {...verifyBridgeAndPreAbort({root,home}),mode:'pre-recovery',evidenceWrites:0};
  const verified=verifyRecoveredState({root,home});return {...verified,mode:'post-recovery',evidenceWrites:0};
}
function run({mode,root=ROOT,home=process.env.HOME}={}){
  if(mode==='--create-v3')return createCompatibilityV3({root,home});
  if(mode==='--dry-run')return dryRun({root,home});
  if(mode==='--execute'){
    const roots=rootPaths(root,home),ledger=readDual(roots,'low/low-ledger.json');
    if(ledger.sha256!==OLD_LEDGER_SHA256){const verified=verifyRecoveredState({root,home});return {...verified,alreadyComplete:true};}
    return executeRecovery({root,home});
  }
  if(mode==='--verify')return verifyRecoveredState({root,home});
  throw new Error('supported modes: --create-v3, --dry-run, --execute, --verify');
}
function main(argv=process.argv.slice(2)){if(argv.length!==1)throw new Error('one explicit mode is required');process.stdout.write(JSON.stringify(run({mode:argv[0]}))+'\n');}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,RECOVERY_DIR,PRE_ABORT_LEDGER,FORENSIC,AUTHORIZATION,RESULT,ARCHIVE,TARGET_KEY,OLD_HEAD,OLD_LEDGER_SHA256,
  FORENSIC_SHA256,V1_SHA256,V2_SHA256,TARGET,sha256,jsonBytes,stable,same,rootPaths,sidecarRoots,counts,validateAbortForensic,
  lowLedgerIdentityMatchesManifest,priorExecutionLogMatches,readOriginalArtifacts,readAndValidateBridge,createCompatibilityV3,recoveryLedger,verifyRecoveredState,verifyBridgeAndPreAbort,
  executeRecovery,dryRun,run,main};
