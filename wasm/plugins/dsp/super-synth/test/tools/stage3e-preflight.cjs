'use strict';

// Read-only evidence gate shared by the CLI wrapper and the Generation-2 runner.
// This module may import validators and capture capability probes, but never a
// CLI runner, so dependency direction stays acyclic.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const validator=require('./stage3e-evidence-validator.cjs');
const search=require('./stage3e-search-core.cjs');
const capture=require('./capture-supersynth-stage3e-matrix.cjs');
const compatibilityV2=require('./stage3e-search-compatibility.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');
const compatibilityV3=require('./stage3e-search-compatibility-v3.cjs');

const MANIFEST_SHA256=validator.SEARCH_MANIFEST_SHA256;
const GENESIS_SHA256=validator.LOW_GENESIS_SHA256;
const PROOF_SHA256='e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb';
const AMENDMENT_RESULT_SHA256='690221637732fe46c4c7420254175b1b36720b181051b6c04a5710e13d8e0744';
const REFERENCE_SHA256='813a3069d384656419f1cf976c2b501a567909dfd2de5703fc58277f0096c0d8';
const V1_COMPATIBILITY_RELATIVE='verifier-compatibility-v1.json';
const COMPATIBILITY_RELATIVE=compatibilityV2.V2_RELATIVE;
const COMPATIBILITY_V3_RELATIVE=compatibilityV3.RELATIVE;
const PERFORMANCE_COMPATIBILITY_RELATIVE='performance-verifier-compatibility-v1.json';
const PERFORMANCE_CONTINUATION_RELATIVE='performance-verifier-compatibility-v2.json';
const PERFORMANCE_CONTINUATION_V3_RELATIVE='performance-verifier-compatibility-v3.json';
const GENESIS_RELATIVE='ledger-transition-journal/genesis-ledger.json';
const GENESIS_RECORD_RELATIVE='ledger-transition-journal/genesis.json';
const JOURNAL_RELATIVE='ledger-transition-journal';
const ALLOWED_TRACKED_DIFFS=new Set([
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-compatibility.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-compatibility.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.test.cjs',
  'wasm/CMakeLists.txt',
  'docs/agent-workflow/evidence-preservation.md',
  'docs/status/plugins/dsp/super-synth/stage3b-contact-attribution.md',
  'docs/design/plugins/dsp/super-synth/super-synth-design.md',
]);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function validateRecoveryCompatibility({reconciliation,bundle,root,roots,manifest,manifestSha256,bridge,forensicSha256,sourceAuditSha256,oldResultSha256,testReportSha256}){
  return reconciliation.validateCompatibilityRecord(bundle.record,{root,manifest,manifestSha256,bridge,forensicSha256,
    sourceAuditSha256,oldResultSha256,testReportSha256,evidenceRoots:roots});
}
function selectPerformanceVerifier({roots,verify}={}){
  if(verify)return verify;
  const primaryV2=path.join(roots.primary,PERFORMANCE_CONTINUATION_RELATIVE);
  const secondaryV2=path.join(roots.secondary,PERFORMANCE_CONTINUATION_RELATIVE);
  const hasPrimaryV2=fs.existsSync(primaryV2),hasSecondaryV2=fs.existsSync(secondaryV2);
  if(hasPrimaryV2!==hasSecondaryV2)throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: performance continuation exists in only one store');
  const primaryV3=path.join(roots.primary,PERFORMANCE_CONTINUATION_V3_RELATIVE);
  const secondaryV3=path.join(roots.secondary,PERFORMANCE_CONTINUATION_V3_RELATIVE);
  const hasPrimaryV3=fs.existsSync(primaryV3),hasSecondaryV3=fs.existsSync(secondaryV3);
  if(hasPrimaryV3!==hasSecondaryV3)throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: performance v3 continuation exists in only one store');
  return hasPrimaryV3
    ?require('./stage3e-performance-verifier-continuation-v3.cjs').runtimeContext
    :hasPrimaryV2?require('./stage3e-performance-verifier-continuation-v2.cjs').runtimeContext
      :require('./stage3e-performance-verifier-compatibility-v1.cjs').runtimeContext;
}
function validatePerformanceVerifierBinding({root,manifest,bundle,roots,expectedSha256,verify}={}){
  const verifier=selectPerformanceVerifier({roots,verify});
  if(!bundle||typeof verifier!=='function')throw new Error('BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY: verifier binding inputs are incomplete');
  const result=verifier({root,manifest,v3Record:bundle.record,v3Sha256:bundle.sha256,roots});
  if(expectedSha256!==undefined&&(result?.sha256||null)!==(expectedSha256||null))
    throw new Error('BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY: performance verifier binding changed');
  return result;
}
function readDualJson(roots,relative){return JSON.parse(durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.toString('utf8'));}
function readDualBytes(roots,relative){return durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative));}
function readLowLedgerBytes(roots){return durable.verifyDualCopy(evidencePaths.lowLedgerPath(roots.primary),evidencePaths.lowLedgerPath(roots.secondary));}
function searchRoots(root=search.ROOT,home=process.env.HOME){
  const common=search.gitCommonDir(root),repository=path.basename(path.resolve(root));
  const base={primary:path.join(common,'soraoto-agent-state','7','stage3e'),secondary:path.join(home,'.soraoto-agent-archive',repository,'7','stage3e')};
  return {primary:path.join(base.primary,'generation-2/search-v1'),secondary:path.join(base.secondary,'generation-2/search-v1'),base};
}
function currentFiles(root){
  const current=search.currentProtectedIdentity(root);
  const runner=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs');
  const helper=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs');
  const core=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs');
  return {...current,generation2RunnerSha256:sha256(fs.readFileSync(runner)),captureHelperSha256:sha256(fs.readFileSync(helper)),
    coreSha256:sha256(fs.readFileSync(core))};
}
function gitBytes(root,args){return execFileSync('git',args,{cwd:root,maxBuffer:64*1024*1024});}
function trackedDiff(root,from,to){
  const names=gitBytes(root,['diff','--name-only',`${from}..${to}`]).toString('utf8').split(/\r?\n/).filter(Boolean);
  const unexpected=names.filter(name=>!ALLOWED_TRACKED_DIFFS.has(name));
  if(unexpected.length)throw new Error(`BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT: non-verifier tracked diff ${unexpected.join(', ')}`);
  const patch=gitBytes(root,['diff','--binary','--no-ext-diff',`${from}..${to}`]);
  return {files:names.sort(),sha256:sha256(patch),patchBytes:patch.length};
}
function assertTrackedWorktreeClean(root){
  const status=gitBytes(root,['status','--porcelain','--untracked-files=no']).toString('utf8').trim();
  if(status)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: tracked worktree is dirty');
  return true;
}
function runCompatibilityTests(root){
  const files=[
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-compatibility.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-historical-reference-requalification.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-surrogate-provenance.test.cjs',
    'wasm/cmake/test_super_synth_metadata.py',
  ];
  const results=files.map(file=>{
    const python=file.endsWith('.py'),command=`rtk ${python?'python3':'node'} ${file}`,args=[python?'python3':'node',file];
    try{const output=execFileSync('rtk',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
      return {command,file,exitCode:0,outputSha256:sha256(Buffer.from(output))};}
    catch(error){return {command,file,exitCode:Number.isInteger(error.status)?error.status:1,
      outputSha256:sha256(Buffer.from(String(error.stdout||'')+String(error.stderr||'')))};}
  });
  const failed=results.filter(item=>item.exitCode!==0);
  if(failed.length)throw new Error(`BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: zero-render tests failed ${failed.map(item=>item.file).join(', ')}`);
  return results;
}
function readV1Compatibility(roots){
  const stored=readDualBytes(roots,V1_COMPATIBILITY_RELATIVE),record=JSON.parse(stored.bytes.toString('utf8'));
  compatibilityV2.validateV1(record,stored.sha256);
  return {record,sha256:stored.sha256};
}
function buildCompatibilityV2Record({root=search.ROOT,manifestIdentity,sourceAudit,zeroRenderTestResults=runCompatibilityTests(root)}={}){
  assertTrackedWorktreeClean(root);
  const roots=searchRoots(root),v1=readV1Compatibility(roots);
  const manifest=readDualBytes(roots,'generation-2-manifest.json');
  const ledger=readLowLedgerBytes(roots);
  if(manifest.sha256!==MANIFEST_SHA256||ledger.sha256!==GENESIS_SHA256)
    throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: bootstrap manifest or ledger changed before adoption');
  if(!manifestIdentity||!same(JSON.parse(manifest.bytes.toString('utf8')).identity,manifestIdentity))
    throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: creator manifest identity mismatch');
  const journal=path.join(roots.primary,JOURNAL_RELATIVE),journalSecondary=path.join(roots.secondary,JOURNAL_RELATIVE);
  if(fs.existsSync(journal)||fs.existsSync(journalSecondary))
    throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: low ledger has pre-existing transition history');
  const lowCells=path.join(roots.primary,'low/cells'),lowCellsSecondary=path.join(roots.secondary,'low/cells');
  for(const cellsDir of [lowCells,lowCellsSecondary])if(fs.existsSync(cellsDir)&&fs.readdirSync(cellsDir).length)
    throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: low payload exists before adoption');
  const accepted=validator.validateLowGenesis({manifestBytes:manifest.bytes,ledgerBytes:ledger.bytes,
    expectedCells:search.expectedLowScreenCells(),
    expectedLedgerIdentity:{...manifestIdentity,phase:'low',referenceSetSha256:manifestIdentity.referenceSetSha256,
      authorizedGrid:search.lowGridTuples(),screenCoordinates:search.lowScreenCells()}});
  if(accepted.pending!==1512||accepted.inProgress!==0||accepted.complete!==0||accepted.renderCalls!==0)
    throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: low ledger bootstrap accounting mismatch');
  const head=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const diff=trackedDiff(root,compatibilityV2.ORIGINAL_LOCAL_COMMIT,head);
  return compatibilityV2.buildRecord({root,manifestIdentity,v1:v1.record,v1Sha256:v1.sha256,
    sourceAudit,zeroRenderTestResults,allowedDiff:diff});
}
function validateCompatibility({root=search.ROOT,compatibility,manifestIdentity,current,sourceAudit,v1,v1Sha256,
  sourceAuditSha256,inventorySha256,assertClean=assertTrackedWorktreeClean,head,isAncestorCheck,artifacts,diff}={}){
  const acceptedCommit=compatibility&&compatibility.acceptedVerifierCommit;
  const actualHead=head||execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const fixedDiff=diff||trackedDiff(root,compatibilityV2.ORIGINAL_LOCAL_COMMIT,acceptedCommit);
  return compatibilityV2.validateRecord({root,compatibility,v1,v1Sha256,manifestIdentity,
    sourceAuditSha256,inventorySha256,artifacts:artifacts||compatibilityV2.currentArtifacts(root),
    diff:fixedDiff,head:actualHead,isAncestorCheck,assertClean});
}
function readTransitionEntries(roots,manifest){
  const resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest),primary=resolved.primary.journalRoot,secondary=resolved.secondary.journalRoot;
  if(!fs.existsSync(primary)&&!fs.existsSync(secondary))return [];
  if(!fs.existsSync(primary)||!fs.existsSync(secondary))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial transition journal');
  const names=fs.readdirSync(primary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort();
  const secondNames=fs.readdirSync(secondary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort();
  if(!same(names,secondNames))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: transition journal path sets differ');
  return names.map(name=>JSON.parse(durable.verifyDualCopy(path.join(primary,name),path.join(secondary,name)).bytes.toString('utf8')));
}
function readRenderStartEntries(roots,manifest){
  const resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest),primary=resolved.primary.journalRoot,secondary=resolved.secondary.journalRoot;
  if(!fs.existsSync(primary)&&!fs.existsSync(secondary))return [];
  if(!fs.existsSync(primary)||!fs.existsSync(secondary))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial render-start journal');
  const pattern=/^render-start-[0-9]{6}\.json$/,names=fs.readdirSync(primary).filter(name=>pattern.test(name)).sort(),secondaryNames=fs.readdirSync(secondary).filter(name=>pattern.test(name)).sort();
  if(!same(names,secondaryNames))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: render-start path sets differ');
  return names.map(name=>{const stored=durable.verifyDualCopy(path.join(primary,name),path.join(secondary,name));return {...JSON.parse(stored.bytes.toString('utf8')),_sha256:stored.sha256};});
}
function validateSearchLedger({roots,manifestBytes,ledgerBytes,compatibilitySha256,historicalCompatibilitySha256,
  recoveryReconciliationCompatibilitySha256,proofSha256=PROOF_SHA256}={}){
  const cells=search.expectedLowScreenCells(),ledger=JSON.parse(ledgerBytes.toString('utf8'));
  if(sha256(manifestBytes)!==MANIFEST_SHA256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: search manifest SHA mismatch');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  const resolved=evidencePaths.resolveStage3eEvidencePaths(roots,manifest);
  const expectedLedgerIdentity={...manifest.identity,phase:'low',referenceSetSha256:manifest.identity.referenceSetSha256,
    authorizedGrid:search.lowGridTuples(),screenCoordinates:search.lowScreenCells()};
  const journal=resolved.primary.journalRoot,journalSecondary=resolved.secondary.journalRoot;
  const snapshotPrimary=resolved.primary.genesisLedger,snapshotSecondary=resolved.secondary.genesisLedger;
  const recordPrimary=resolved.primary.genesisRecord,recordSecondary=resolved.secondary.genesisRecord;
  const snapshotExists=fs.existsSync(snapshotPrimary)||fs.existsSync(snapshotSecondary);
  const recordExists=fs.existsSync(recordPrimary)||fs.existsSync(recordSecondary);
  const journalExists=fs.existsSync(journal)||fs.existsSync(journalSecondary);
  const pristine=sha256(ledgerBytes)===GENESIS_SHA256;
  if(pristine){
    const accepted=validator.validateLowGenesis({manifestBytes,ledgerBytes,expectedCells:cells,expectedLedgerIdentity});
    if(!snapshotExists&&!recordExists&&!journalExists)return {...accepted,genesisRequired:true,compatibilitySha256};
  }
  if(!snapshotExists||!recordExists||!fs.existsSync(snapshotPrimary)||!fs.existsSync(snapshotSecondary)||
     !fs.existsSync(recordPrimary)||!fs.existsSync(recordSecondary))
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: partial or absent low genesis snapshot/attestation');
  const genesisFile=durable.verifyDualCopy(snapshotPrimary,snapshotSecondary),recordFile=durable.verifyDualCopy(recordPrimary,recordSecondary);
  const genesisRecord=JSON.parse(recordFile.bytes.toString('utf8'));
  if(genesisFile.sha256!==GENESIS_SHA256||genesisRecord.genesisLedgerSha256!==GENESIS_SHA256||
     genesisRecord.manifestSha256!==MANIFEST_SHA256||genesisRecord.proofSha256!==proofSha256||
     genesisRecord.compatibilitySha256!==(historicalCompatibilitySha256||compatibilitySha256)||genesisRecord.schemaVersion!==1||
     genesisRecord.decision!=='STAGE3E_SEARCH_LEDGER_GENESIS'||genesisRecord.phase!=='low'||
     genesisRecord.authorizedCellCount!==1512||genesisRecord.renderCalls!==0||
     !same(genesisRecord.identity,ledger.identity)||!same(genesisRecord.identity,expectedLedgerIdentity))
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: genesis attestation identity mismatch');
  const entries=readTransitionEntries(roots,manifest),renderStarts=readRenderStartEntries(roots,manifest);
  const result=validator.validateLedgerTransitions({genesisLedgerBytes:genesisFile.bytes,currentLedgerBytes:ledgerBytes,
    transitionEntries:entries,renderStartEntries:renderStarts,expectedCells:cells,bindings:{manifestSha256:MANIFEST_SHA256,proofSha256,
      compatibilitySha256,acceptedCompatibilitySha256s:historicalCompatibilitySha256?[historicalCompatibilitySha256]:[],
      recoveryCompatibilitySha256:compatibilitySha256,recoveryReconciliationCompatibilitySha256}});
  if(result.inProgress!==0)throw new Error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: unresolved IN_PROGRESS cell');
  for(const cell of cells){
    const state=ledger.cells[cell.key];
    const cellPrimary=path.join(roots.primary,'low','cells',cell.key+'.json'),cellSecondary=path.join(roots.secondary,'low','cells',cell.key+'.json');
    if(state.state==='PENDING'){
      if(fs.existsSync(cellPrimary)||fs.existsSync(cellSecondary))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: cell exists before completion '+cell.key);
      continue;
    }
    if(state.state!=='COMPLETE')continue;
    if(state.relativePath!=='cells/'+cell.key+'.json')throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: unexpected path for '+cell.key);
    const rowBytes=durable.verifyDualCopy(path.join(roots.primary,'low',state.relativePath),path.join(roots.secondary,'low',state.relativePath));
    if(rowBytes.sha256!==state.sha256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: cell hash mismatch '+cell.key);
    const row=JSON.parse(rowBytes.bytes.toString('utf8'));
    if(row.cellKey!==cell.key||!search.same(row.cell,cell)||!search.same(row.identity,ledger.identity))
      throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: completed cell identity mismatch '+cell.key);
  }
  return {...result,genesisRequired:false,compatibilitySha256};
}
function validateRuntimeIdentity({root=search.ROOT,home=process.env.HOME,manifestIdentity,compatibilitySha256,
  performanceVerifierCompatibilitySha256,verifySourceAudit,verifyAmendment,verifyPerformanceCompatibility}={}){
  if(typeof verifySourceAudit!=='function'||typeof verifyAmendment!=='function')throw new Error('BLOCKED_STAGE3E_PREFLIGHT_DEPENDENCY: explicit pure verifier functions are required');
  const audit=verifySourceAudit({root,home}),amendmentResult=verifyAmendment({root,home});
  if(audit.sha256!==validator.SOURCE_AUDIT_SHA256||amendmentResult.resultSha256!==AMENDMENT_RESULT_SHA256||
     amendmentResult.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendmentResult.result?.effectivePassCount!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: frozen proof or amendment changed');
  const roots=searchRoots(root,home),manifestStored=readDualBytes(roots,'generation-2-manifest.json');
  if(manifestStored.sha256!==MANIFEST_SHA256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: initial search manifest changed');
  const manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  if(!same(manifest.identity,manifestIdentity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: creator manifest identity changed');
  const v2Bundle=compatibilityV2.readBundle(roots),bundle=compatibilityV3.readBundle(roots);
  if(bundle.sha256!==compatibilitySha256)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: v3 sidecar bytes changed');
  const forensic=readDualBytes(roots,compatibilityV3.FORENSIC_RELATIVE);
  compatibilityV3.validateRecord(bundle.record,{root,manifest,head:execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    v1Sha256:v2Bundle.v1Sha256,v2Sha256:v2Bundle.sha256,sourceAuditSha256:audit.sha256,
    inventorySha256:compatibilityV2.fixedInventorySha(audit.audit),preAbortEvidenceSha256:forensic.sha256,
    pinned:bundle.record.pinnedExecutorHashes});
  const performanceVerifierCompatibility=validatePerformanceVerifierBinding({root,manifest,bundle,roots,
    expectedSha256:performanceVerifierCompatibilitySha256,verify:verifyPerformanceCompatibility});
  const transitions=readTransitionEntries(roots,manifest),admin=transitions.filter(entry=>entry.eventType==='ADMIN_REQUEUE_NO_RENDER');
  let recoveryReconciliationCompatibilitySha256=null;
  if(admin.length){
    if(admin.length!==1)throw new Error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: duplicate ADMIN_REQUEUE_NO_RENDER');
    const reconciliation=require('./stage3e-recovery-reconciliation-v2.cjs'),bundleV2=reconciliation.readCompatibility(roots);
    validateRecoveryCompatibility({reconciliation,bundle:bundleV2,root,roots,manifest,manifestSha256:manifestStored.sha256,bridge:bundle,
      forensicSha256:forensic.sha256,sourceAuditSha256:audit.sha256,oldResultSha256:reconciliation.INVALID_RESULT_SHA256,
      testReportSha256:bundleV2.record.zeroRenderVerifierTestReportSha256});
    recoveryReconciliationCompatibilitySha256=bundleV2.sha256;
    if(admin[0].recoveryReconciliationCompatibilitySha256!==recoveryReconciliationCompatibilitySha256)
      throw new Error('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY: journal binding differs from v2 sidecar');
  }
  return {pass:true,identity:manifest.identity,compatibilitySha256,performanceVerifierCompatibilitySha256:performanceVerifierCompatibility?.sha256||null,
    recoveryReconciliationCompatibilitySha256,
    auditSha256:audit.sha256,amendmentResultSha256:amendmentResult.resultSha256};
}
function acquireWriterLock({root=search.ROOT,phase='low',executionIdentity}={}){
  if(!executionIdentity)throw new Error('BLOCKED_STAGE3E_WRITER_LOCK_IDENTITY: missing execution identity');
  const common=search.gitCommonDir(root),lockRoot=path.join(common,'soraoto-agent-locks');
  fs.mkdirSync(lockRoot,{recursive:true,mode:0o700});
  const lockPath=path.join(lockRoot,`issue-7-stage3e-generation-2-${phase}.lock`);
  const payload=Buffer.from(JSON.stringify({schemaVersion:1,pid:process.pid,phase,executionIdentity,createdAt:new Date().toISOString()})+'\n');
  let fd;
  try{fd=fs.openSync(lockPath,'wx',0o600);fs.writeSync(fd,payload);fs.fsyncSync(fd);}
  catch(error){
    if(fd!==undefined)try{fs.closeSync(fd);}catch{}
    throw new Error(`BLOCKED_STAGE3E_WRITER_LOCKED: ${lockPath}${fs.existsSync(lockPath)?' (existing lock is never removed automatically)':''}`);
  }
  let released=false;
  return {path:lockPath,release(){
    if(released)return;
    try{fs.closeSync(fd);}catch{}
    if(!fs.existsSync(lockPath)||!fs.readFileSync(lockPath).equals(payload))throw new Error('BLOCKED_STAGE3E_WRITER_LOCK_IDENTITY: lock ownership changed');
    fs.unlinkSync(lockPath);released=true;
  }};
}
function preflight({root=search.ROOT,home=process.env.HOME,requireCompatibility=true,capabilityProbe=capture.preflightDiagnosticCapabilities,
  verifySourceAudit,verifyAmendment,verifyPerformanceCompatibility}={}){
  if(typeof verifySourceAudit!=='function'||typeof verifyAmendment!=='function')throw new Error('BLOCKED_STAGE3E_PREFLIGHT_DEPENDENCY: explicit pure verifier functions are required');
  const capability=capabilityProbe({root});
  search.assertGeneration1Abandoned(root);
  const audit=verifySourceAudit({root,home});
  const amendmentResult=verifyAmendment({root,home});
  if(amendmentResult.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendmentResult.result?.effectivePassCount!==12||amendmentResult.result?.effectiveCellCount!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: MIDI41 amendment must pass 12/12');
  const roots=searchRoots(root,home);
  const manifestStored=readDualBytes(roots,'generation-2-manifest.json');
  if(manifestStored.sha256!==MANIFEST_SHA256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: initial search manifest changed');
  const manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  if(manifest.state!=='ACTIVE'||manifest.searchEpoch!=='search-v1'||manifest.identity?.searchEpoch!=='search-v1'||
     manifest.identity?.midi41AmendmentResultSha256!==AMENDMENT_RESULT_SHA256||
     manifest.identity?.referenceSetSha256!==REFERENCE_SHA256)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: search manifest binding mismatch');
  const v1=readDualBytes(roots,V1_COMPATIBILITY_RELATIVE),v1Record=JSON.parse(v1.bytes.toString('utf8'));
  compatibilityV2.validateV1(v1Record,v1.sha256);
  const v2Files=[compatibilityV2.V2_RELATIVE,compatibilityV2.V2_SHA_RELATIVE,
    compatibilityV2.V2_ARCHIVE_RELATIVE,compatibilityV2.V2_ARCHIVE_SHA_RELATIVE];
  const v2Exists=v2Files.some(relative=>fs.existsSync(path.join(roots.primary,relative))||fs.existsSync(path.join(roots.secondary,relative)));
  let compatibility=null,compatibilitySha256=null,bundle=null,v2Bundle=null;
  if(v2Exists)v2Bundle=compatibilityV2.readBundle(roots);
  else if(requireCompatibility)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: v2 sidecar absent');
  const v3Files=[compatibilityV3.RELATIVE,compatibilityV3.SHA_RELATIVE,compatibilityV3.ARCHIVE_RELATIVE,compatibilityV3.ARCHIVE_SHA_RELATIVE];
  const v3Exists=v3Files.some(relative=>fs.existsSync(path.join(roots.primary,relative))||fs.existsSync(path.join(roots.secondary,relative)));
  let forensicFile=null;
  if(v3Exists){
    bundle=compatibilityV3.readBundle(roots);compatibility=bundle.record;compatibilitySha256=bundle.sha256;
    forensicFile=readDualBytes(roots,compatibilityV3.FORENSIC_RELATIVE);
    compatibilityV3.validateRecord(bundle.record,{root,manifest,head:execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
      v1Sha256:v2Bundle?.v1Sha256,v2Sha256:v2Bundle?.sha256,sourceAuditSha256:audit.sha256,
      inventorySha256:compatibilityV2.fixedInventorySha(audit.audit),preAbortEvidenceSha256:forensicFile.sha256,
      pinned:bundle.record.pinnedExecutorHashes});
  }else if(requireCompatibility)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: v3 bridge absent');
  const performanceVerifierCompatibility=bundle?validatePerformanceVerifierBinding({root,manifest,bundle,roots,
    verify:verifyPerformanceCompatibility}):null;
  const entries=readTransitionEntries(roots,manifest),administrative=entries.filter(entry=>entry.eventType==='ADMIN_REQUEUE_NO_RENDER');
  let reconciliationCompatibilitySha256=null;
  if(administrative.length){
    if(administrative.length!==1)throw new Error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: duplicate administrative requeue event');
    const reconciliation=require('./stage3e-recovery-reconciliation-v2.cjs');
    const bundleV2=reconciliation.readCompatibility(roots);
    validateRecoveryCompatibility({reconciliation,bundle:bundleV2,root,roots,manifest,manifestSha256:manifestStored.sha256,bridge:bundle,
      forensicSha256:forensicFile?.sha256,sourceAuditSha256:audit.sha256,
      oldResultSha256:reconciliation.INVALID_RESULT_SHA256,
      testReportSha256:bundleV2.record.zeroRenderVerifierTestReportSha256});
    reconciliationCompatibilitySha256=bundleV2.sha256;
    if(administrative[0].recoveryReconciliationCompatibilitySha256!==reconciliationCompatibilitySha256)
      throw new Error('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY: administrative event binding differs');
  }
  const ledgerStored=readLowLedgerBytes(roots);
  const ledgerSummary=validateSearchLedger({roots,manifestBytes:manifestStored.bytes,ledgerBytes:ledgerStored.bytes,compatibilitySha256,
    historicalCompatibilitySha256:v2Bundle?.sha256,recoveryReconciliationCompatibilitySha256:reconciliationCompatibilitySha256});
  const extras=audit.inventoryValidation;
  return {decision:'STAGE3E_SEARCH_PREFLIGHT_READY',builds:0,renders:0,acousticRenders:0,evidenceWrites:0,
    capability,auditSha256:audit.sha256,amendmentResultSha256:amendmentResult.resultSha256,
    manifestSha256:manifestStored.sha256,ledgerSha256:ledgerStored.sha256,ledgerSummary,
    compatibilitySha256,compatibility,compatibilityArchiveSha256:bundle?.archiveSha256,historicalCompatibilitySha256:v2Bundle?.sha256,
    performanceVerifierCompatibilitySha256:performanceVerifierCompatibility?.sha256||null,
    recoveryReconciliationCompatibilitySha256:reconciliationCompatibilitySha256,
    inventory:{frozenCount:extras.frozenCount,additionCount:extras.additionCount},
    roots,manifest,creatorIdentity:manifest.identity,currentVerifierIdentity:currentFiles(root),sourceAudit:audit.audit};
}

module.exports={MANIFEST_SHA256,GENESIS_SHA256,PROOF_SHA256,AMENDMENT_RESULT_SHA256,REFERENCE_SHA256,V1_COMPATIBILITY_RELATIVE,COMPATIBILITY_RELATIVE,COMPATIBILITY_V3_RELATIVE,PERFORMANCE_COMPATIBILITY_RELATIVE,PERFORMANCE_CONTINUATION_RELATIVE,PERFORMANCE_CONTINUATION_V3_RELATIVE,validateRecoveryCompatibility,
  GENESIS_RELATIVE,GENESIS_RECORD_RELATIVE,JOURNAL_RELATIVE,ALLOWED_TRACKED_DIFFS,sha256,stable,same,searchRoots,currentFiles,
  validateCompatibility,readTransitionEntries,readRenderStartEntries,validateSearchLedger,validateRuntimeIdentity,acquireWriterLock,
  trackedDiff,assertTrackedWorktreeClean,runCompatibilityTests,buildCompatibilityV2Record,selectPerformanceVerifier,validatePerformanceVerifierBinding,preflight};
