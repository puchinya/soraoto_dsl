'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const generation2=require('./run-stage3e-generation2.cjs');
const preflight=require('./stage3e-preflight.cjs');
const evidenceValidator=require('./stage3e-evidence-validator.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');
const amendment=require('./run-stage3e-midi41-evidence-amendment.cjs');
const compatibilityV2=require('./stage3e-search-compatibility.cjs');

const ROOT=search.ROOT;
const RECOVERY_DIR='pre-render-abort-recovery-v1';
const PRE_ABORT_LEDGER='pre-abort-low-ledger.json';
const FORENSIC='forensic-evidence.json';
const TARGET_KEY='low-screen-L1-M1-H0-midi-036-v110';
const OLD_HEAD='01c059ae9497119e5ef22d273958ca33eeade9a0';
const OLD_LEDGER_SHA256='c8c0d162aafcf30908e4b1d7637245ecb6418328a75cee35d76303328960109f';
const FORENSIC_SHA256='e601de82fbb382065b0d3c7efed6da8540c25681d5e622a11fb74a4cf12bb482';
const LEGACY_AUTHORIZATION_SHA256='54fe051d4eeb2a406c702305e9adfd50ff3fe942bff1c6eaf38d533b07f6d63a';
const LEGACY_INVALID_RESULT_SHA256='ee1bc4f286fadd25cfdaad4fff69951522b50b1d1ebdfef7417d121f7919eaa3';
const JOURNAL_PROOF_SHA256=preflight.PROOF_SHA256;
const V1_SHA256='331279140ef707c71c81cf716eed052f443e8537616bac83ad88e002bf61b1e5';
const V2_SHA256='5f3340f7b993bb879aa29bca4214e5192008f54308d20160282aac0cfcc6f797';
const TARGET=Object.freeze({pitch:36,velocity:14,velocityNormalized:14/127,phase:'low-screen',response:{low:1,mid:1,bassHardness:0},key:TARGET_KEY});

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fail(token,detail){throw new Error(`${token}: ${detail}`);}
function rootPaths(root=ROOT,home=process.env.HOME){return preflight.searchRoots(root,home);}
function readDual(roots,relative){return durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative));}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells||{}).filter(row=>row.state===state).length]));}
function priorExecutionLogMatches(bytes,prior){
  if(!Buffer.isBuffer(bytes)||!prior||typeof prior.content!=='string'||!Number.isInteger(prior.sizeBytes)||
     !/^[0-9a-f]{64}$/.test(prior.sha256||'')||sha256(bytes)!==prior.sha256||bytes.length!==prior.sizeBytes)return false;
  const recorded=Buffer.from(prior.content,'utf8');
  return bytes.equals(recorded)||(!prior.content.endsWith('\n')&&bytes.length===recorded.length+1&&bytes[bytes.length-1]===0x0a&&bytes.subarray(0,-1).equals(recorded));
}
function lowLedgerIdentityMatchesManifest(ledgerIdentity,manifest){
  const base=manifest?.identity,referenceSetSha256=base?.referenceSetSha256;
  if(typeof referenceSetSha256!=='string'||!/^[0-9a-f]{64}$/.test(referenceSetSha256))return false;
  return same(ledgerIdentity,generation2.lowPhaseIdentity(base,referenceSetSha256));
}
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
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','immutable forensic record does not prove this exact pre-render abort');
  const prior=forensic.priorExecutionLog;
  if(prior&&fs.existsSync(prior.path)&&!priorExecutionLogMatches(fs.readFileSync(prior.path),prior))
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','saved original execution log changed');
  return true;
}
function readOriginalArtifacts({root=ROOT,home=process.env.HOME}={}){
  const roots=rootPaths(root,home),resolvedManifest=readDual(roots,'generation-2-manifest.json');
  if(resolvedManifest.sha256!==evidenceValidator.SEARCH_MANIFEST_SHA256)
    fail('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','immutable search manifest SHA changed');
  const manifest=JSON.parse(resolvedManifest.bytes.toString('utf8'));
  const resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest);
  const ledgerFile=durable.verifyDualCopy(resolved.primary.lowLedger,resolved.secondary.lowLedger);
  if(ledgerFile.sha256!==OLD_LEDGER_SHA256)fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','pre-abort low ledger SHA changed');
  const sidecar={primary:path.join(roots.primary,RECOVERY_DIR),secondary:path.join(roots.secondary,RECOVERY_DIR)};
  const snapshot=readDual(roots,`${RECOVERY_DIR}/${PRE_ABORT_LEDGER}`),forensicFile=readDual(roots,`${RECOVERY_DIR}/${FORENSIC}`);
  const forensic=JSON.parse(forensicFile.bytes.toString('utf8'));
  validateAbortForensic(forensic,forensicFile.sha256);
  if(snapshot.sha256!==OLD_LEDGER_SHA256||!snapshot.bytes.equals(ledgerFile.bytes))
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','immutable pre-abort ledger snapshot does not match current ledger');
  const ledger=JSON.parse(ledgerFile.bytes.toString('utf8')),cells=search.expectedLowScreenCells();
  if(ledger.authorizedCellCount!==1512||!same(Object.keys(ledger.cells||{}),cells.map(cell=>cell.key))||
     !lowLedgerIdentityMatchesManifest(ledger.identity,manifest)||ledger.accounting?.renderCalls!==0||!same(counts(ledger),{PENDING:1511,IN_PROGRESS:1,COMPLETE:0}))
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','low ledger state/count/order changed');
  const inProgress=Object.entries(ledger.cells).filter(([,row])=>row.state==='IN_PROGRESS');
  if(inProgress.length!==1||inProgress[0][0]!==TARGET_KEY||!same(inProgress[0][1].identity,TARGET))
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','the only IN_PROGRESS row is not the authorized MIDI36/v14 cell');
  const targetCell=cells.find(cell=>cell.key===TARGET_KEY);
  if(!targetCell||!same(targetCell,TARGET))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','authorized coordinate is not in the fixed screen matrix');
  const cellDirPrimary=path.join(roots.primary,'low','cells'),cellDirSecondary=path.join(roots.secondary,'low','cells');
  const payloads=[cellDirPrimary,cellDirSecondary].filter(dir=>fs.existsSync(dir)).flatMap(dir=>fs.readdirSync(dir));
  if(fs.existsSync(path.join(cellDirPrimary,TARGET_KEY+'.json'))||fs.existsSync(path.join(cellDirSecondary,TARGET_KEY+'.json'))||
     payloads.length||ledger.cells[TARGET_KEY].sha256!==null)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','target or low cell payload already has captured evidence');
  const v2Bundle=compatibilityV2.readBundle(roots);
  if(v2Bundle.v1Sha256!==V1_SHA256||v2Bundle.sha256!==V2_SHA256)
    fail('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY','immutable v1/v2 SHA changed');
  const genesis=durable.verifyDualCopy(resolved.primary.genesisLedger,resolved.secondary.genesisLedger);
  const genesisRecordFile=durable.verifyDualCopy(resolved.primary.genesisRecord,resolved.secondary.genesisRecord);
  const genesisRecord=JSON.parse(genesisRecordFile.bytes.toString('utf8'));
  if(genesis.sha256!==evidenceValidator.LOW_GENESIS_SHA256||genesisRecord.genesisLedgerSha256!==genesis.sha256||
     genesisRecord.manifestSha256!==resolvedManifest.sha256||genesisRecord.proofSha256!==JOURNAL_PROOF_SHA256||
     genesisRecord.compatibilitySha256!==v2Bundle.sha256||!same(genesisRecord.identity,ledger.identity))
    fail('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE','original genesis binding is invalid');
  const transitionEntries=preflight.readTransitionEntries(roots,manifest),renderStartEntries=preflight.readRenderStartEntries(roots,manifest);
  const journalRoot=resolved.primary.journalRoot,secondaryJournal=resolved.secondary.journalRoot;
  const originalNames=['genesis-ledger.json','genesis.json','transition-000001.json'];
  const actualNames=fs.readdirSync(journalRoot).sort(),secondaryNames=fs.readdirSync(secondaryJournal).sort();
  if(!same(actualNames,originalNames)||!same(secondaryNames,originalNames)||renderStartEntries.length!==0||transitionEntries.length!==1)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','original journal topology has unexpected files or events');
  const liveJournal=originalNames.map(name=>{const stored=durable.verifyDualCopy(path.join(journalRoot,name),path.join(secondaryJournal,name));return {name,sha256:stored.sha256,sizeBytes:stored.sizeBytes};});
  if(!same(liveJournal,forensic.originalJournalFiles))fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','original journal bytes differ from forensic snapshot');
  const replay=evidenceValidator.validateLedgerTransitions({genesisLedgerBytes:genesis.bytes,currentLedgerBytes:ledgerFile.bytes,
    transitionEntries,renderStartEntries,expectedCells:cells,bindings:{manifestSha256:resolvedManifest.sha256,
      proofSha256:JOURNAL_PROOF_SHA256,compatibilitySha256:v2Bundle.sha256}});
  if(replay.pending!==1511||replay.inProgress!==1||replay.complete!==0||replay.renderCalls!==0||replay.currentLedgerSha256!==ledgerFile.sha256)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','journal does not terminate at the exact pre-abort ledger');
  const wasmPath=path.join(path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm-stage3e')),'plugins/dsp/super-synth/plugin.wasm');
  if(!fs.existsSync(wasmPath)||sha256(fs.readFileSync(wasmPath))!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
     forensic.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221')
    fail('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT','Stage3E diagnostic WASM identity changed');
  const legacyAuthorization=readDual(roots,`${RECOVERY_DIR}/recovery-authorization.json`);
  const legacyResult=readDual(roots,`${RECOVERY_DIR}/recovery-result.json`);
  if(legacyAuthorization.sha256!==LEGACY_AUTHORIZATION_SHA256||legacyResult.sha256!==LEGACY_INVALID_RESULT_SHA256)
    fail('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING','immutable legacy recovery records changed');
  const audit=amendment.assertSourceAudit({root,home}),amendmentResult=amendment.verify({root,home});
  if(audit.sha256!==evidenceValidator.SOURCE_AUDIT_SHA256||amendmentResult.resultSha256!==compatibilityV2.AMENDMENT_RESULT_SHA256||
     amendmentResult.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendmentResult.result?.effectivePassCount!==12)
    fail('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT','frozen evidence or Generation-2 12/12 baseline changed');
  return {roots,resolved,manifest,manifestSha256:resolvedManifest.sha256,ledger,ledgerBytes:ledgerFile.bytes,
    ledgerSha256:ledgerFile.sha256,genesisBytes:genesis.bytes,genesis:{bytes:genesis.bytes,sha256:genesis.sha256},genesisRecord,
    v2Bundle,v1v2:v2Bundle,forensic,forensicSha256:forensicFile.sha256,oldAuthSha256:legacyAuthorization.sha256,oldResultSha256:legacyResult.sha256,
    snapshotSha256:snapshot.sha256,cells,targetCell,replay,audit,amendmentResult,sidecar,
    originalJournalSha256:forensic.originalJournalSha256,transitionEntries,renderStartEntries};
}

module.exports={ROOT,RECOVERY_DIR,PRE_ABORT_LEDGER,FORENSIC,TARGET_KEY,OLD_HEAD,OLD_LEDGER_SHA256,FORENSIC_SHA256,
  LEGACY_AUTHORIZATION_SHA256,LEGACY_INVALID_RESULT_SHA256,JOURNAL_PROOF_SHA256,V1_SHA256,V2_SHA256,TARGET,
  sha256,same,rootPaths,counts,priorExecutionLogMatches,lowLedgerIdentityMatchesManifest,validateAbortForensic,readOriginalArtifacts};
