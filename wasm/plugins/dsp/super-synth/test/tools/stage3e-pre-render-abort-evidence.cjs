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
function within(root,candidate){const relative=path.relative(root,candidate);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`));}
function readSourceCopy(root,relative,label){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA',`unsafe ${label} path`);
  const candidate=path.resolve(root,relative),realRoot=fs.realpathSync(root);
  let realCandidate;
  try{realCandidate=fs.realpathSync(candidate);}
  catch(error){fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA',`${label} is missing or cannot be resolved: ${error.message}`);}
  if(!within(root,candidate)||!within(realRoot,realCandidate)||!fs.statSync(realCandidate).isFile())
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA',`${label} escapes its canonical evidence root or is not a file`);
  const bytes=fs.readFileSync(candidate);
  return {path:relative,bytes,sha256:sha256(bytes)};
}
function parseSourceJson(copy,label){
  try{return JSON.parse(copy.bytes.toString('utf8'));}
  catch(error){fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA',`${label} is not valid JSON: ${error.message}`);}
}
function normalizeRecoverySourceView({roots,manifest,transitionEntries,expectedTransitionBytes}={}){
  if(!roots||!manifest||(transitionEntries!==undefined&&!Array.isArray(transitionEntries)))
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','roots and saved manifest are required; producer transitionEntries must be an array when supplied');
  if(Array.isArray(transitionEntries)){
    const sequences=transitionEntries.map(entry=>entry?.sequence);
    if(sequences.some(sequence=>!Number.isInteger(sequence))||new Set(sequences).size!==sequences.length||
       sequences.some((sequence,index)=>sequence!==index+1))
      fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','producer transitionEntries must have unique contiguous sequences starting at 1');
  }
  let resolved;
  try{resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest);}
  catch(error){fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA',error.message);}
  const primaryRoot=fs.realpathSync(roots.primary),secondaryRoot=fs.realpathSync(roots.secondary);
  const lowRelative=path.relative(roots.primary,resolved.primary.lowLedger).split(path.sep).join('/');
  const genesisRelative=path.relative(roots.primary,resolved.primary.genesisLedger).split(path.sep).join('/');
  if(lowRelative!=='low/low-ledger.json'||genesisRelative!=='ledger-transition-journal/genesis-ledger.json')
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','canonical resolver returned an unexpected ledger or genesis path');
  const lowPrimary=readSourceCopy(primaryRoot,lowRelative,'primary low ledger');
  const lowSecondary=readSourceCopy(secondaryRoot,lowRelative,'secondary low ledger');
  const lowPrimaryParsed=parseSourceJson(lowPrimary,'primary low ledger'),lowSecondaryParsed=parseSourceJson(lowSecondary,'secondary low ledger');
  const genesisPrimary=readSourceCopy(primaryRoot,genesisRelative,'primary genesis ledger');
  const genesisSecondary=readSourceCopy(secondaryRoot,genesisRelative,'secondary genesis ledger');
  if(genesisPrimary.sha256!==genesisSecondary.sha256||!genesisPrimary.bytes.equals(genesisSecondary.bytes))
    fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','genesis ledger copies differ');
  const genesisParsed=parseSourceJson(genesisPrimary,'genesis ledger');
  const journalRelative=path.relative(roots.primary,resolved.primary.journalRoot).split(path.sep).join('/');
  if(journalRelative!=='ledger-transition-journal')
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','canonical resolver returned an unexpected transition journal path');
  const primaryJournal=path.join(primaryRoot,journalRelative),secondaryJournal=path.join(secondaryRoot,journalRelative);
  const transitionPattern=/^transition-([0-9]{6})\.json$/;
  const namesFor=root=>{
    const entries=fs.readdirSync(root);
    if(entries.some(name=>name.startsWith('transition-')&&!transitionPattern.test(name)))
      fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','transition journal contains an invalid filename');
    return entries.filter(name=>transitionPattern.test(name)).sort();
  };
  const primaryNames=namesFor(primaryJournal),secondaryNames=namesFor(secondaryJournal);
  const allowedNames=['transition-000001.json','transition-000002.json'];
  if(primaryNames.some(name=>!allowedNames.includes(name))||secondaryNames.some(name=>!allowedNames.includes(name)))
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','transition journal contains an unauthorized sequence');
  const partialSecond=primaryNames.includes('transition-000002.json')!==secondaryNames.includes('transition-000002.json');
  if(!primaryNames.includes('transition-000001.json')||!secondaryNames.includes('transition-000001.json')||
     (primaryNames.includes('transition-000002.json')&&!secondaryNames.includes('transition-000002.json')&&!partialSecond)||
     (secondaryNames.includes('transition-000002.json')&&!primaryNames.includes('transition-000002.json')&&!partialSecond))
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','transition journal sequence is incomplete');
  if(partialSecond&&(!Buffer.isBuffer(expectedTransitionBytes)||!expectedTransitionBytes.length))
    fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','one-sided transition 000002 has no exact staged bytes binding');
  const presentTransitionNames=[...new Set([...primaryNames,...secondaryNames])].filter(name=>allowedNames.includes(name));
  if(Array.isArray(transitionEntries)&&transitionEntries.length!==presentTransitionNames.length&&!partialSecond)
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','producer transitionEntries count differs from journal files');
  const normalized=[];
  for(const sequence of [1,2]){
    const name=`transition-${String(sequence).padStart(6,'0')}.json`;
    const existsPrimary=primaryNames.includes(name),existsSecondary=secondaryNames.includes(name);
    if(!existsPrimary&&!existsSecondary)continue;
    const relative=path.join(journalRelative,name).split(path.sep).join('/');
    const primary=existsPrimary?readSourceCopy(primaryRoot,relative,`primary ${name}`):null;
    const secondary=existsSecondary?readSourceCopy(secondaryRoot,relative,`secondary ${name}`):null;
    if(primary&&secondary&&(primary.sha256!==secondary.sha256||!primary.bytes.equals(secondary.bytes)))
      fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE',`${name} copies differ`);
    const selected=primary||secondary;
    if(sequence===1&&(!primary||!secondary))
      fail('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE','original transition 000001 is not present in both stores');
    if(sequence===2&&expectedTransitionBytes&& !selected.bytes.equals(expectedTransitionBytes))
      fail('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COLLISION','one-sided transition 000002 differs from the staged transaction bytes');
    const parsed=parseSourceJson(selected,name);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.sequence!==sequence)
      fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA',`${name} has an invalid sequence schema`);
    const supplied=Array.isArray(transitionEntries)?transitionEntries.find(entry=>entry?.sequence===sequence):undefined;
    if(supplied&&!same(supplied,parsed))
      fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA',`${name} parsed bytes differ from producer transitionEntries`);
    if(Array.isArray(transitionEntries)&&sequence===1&&!supplied)
      fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','producer transitionEntries is missing sequence 1');
    if(Array.isArray(transitionEntries)&&sequence===2&&!partialSecond&&!supplied)
      fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','producer transitionEntries is missing sequence 2');
    normalized.push({sequence,path:relative,bytes:selected.bytes,sha256:selected.sha256,parsed,
      primaryPresent:!!primary,secondaryPresent:!!secondary});
  }
  if(normalized.length<1||normalized[0].sequence!==1||normalized.some((entry,index)=>entry.sequence!==index+1))
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','transition entries must be unique, ordered, and contiguous from sequence 1');
  return {lowLedger:{path:lowRelative,bytes:lowPrimary.bytes,sha256:lowPrimary.sha256,parsed:lowPrimaryParsed,
      copies:{primary:lowPrimary,secondary:lowSecondary},copiesMatch:lowPrimary.sha256===lowSecondary.sha256&&lowPrimary.bytes.equals(lowSecondary.bytes)},
    genesis:{path:genesisRelative,bytes:genesisPrimary.bytes,sha256:genesisPrimary.sha256,parsed:genesisParsed},
    transitionEntries:normalized,journalTipSha256:normalized.at(-1).sha256};
}
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
  const sourceView=normalizeRecoverySourceView({roots,manifest,transitionEntries});
  if(!sourceView.lowLedger.bytes.equals(ledgerFile.bytes)||sourceView.lowLedger.sha256!==ledgerFile.sha256||
     !sourceView.genesis.bytes.equals(genesis.bytes)||sourceView.genesis.sha256!==genesis.sha256||
     !sourceView.lowLedger.copiesMatch||sourceView.transitionEntries.length!==transitionEntries.length)
    fail('BLOCKED_STAGE3E_RECOVERY_SOURCE_SCHEMA','normalized recovery source view differs from the validated producer inputs');
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
    originalJournalSha256:forensic.originalJournalSha256,transitionEntries,sourceView,renderStartEntries};
}

module.exports={ROOT,RECOVERY_DIR,PRE_ABORT_LEDGER,FORENSIC,TARGET_KEY,OLD_HEAD,OLD_LEDGER_SHA256,FORENSIC_SHA256,
  LEGACY_AUTHORIZATION_SHA256,LEGACY_INVALID_RESULT_SHA256,JOURNAL_PROOF_SHA256,V1_SHA256,V2_SHA256,TARGET,
  sha256,same,rootPaths,counts,priorExecutionLogMatches,lowLedgerIdentityMatchesManifest,validateAbortForensic,
  normalizeRecoverySourceView,readOriginalArtifacts};
