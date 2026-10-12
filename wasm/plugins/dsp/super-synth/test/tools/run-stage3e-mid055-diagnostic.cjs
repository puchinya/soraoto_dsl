#!/usr/bin/env node
'use strict';

// Issue #9 has an independent namespace, explicit CLI modes, and an explicit
// authorization gate. This runner never invokes the Generation-2 phase CLI.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const generationCore=require('./stage3e-generation2-core.cjs');
const preflight=require('./stage3e-preflight.cjs');
const midi41Amendment=require('./run-stage3e-midi41-evidence-amendment.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');
const captureDefault=require('./capture-supersynth-stage3e-matrix.cjs');
const v15=require('./stage3e-performance-verifier-continuation-v15.cjs');
const diagnostic=require('./stage3e-mid055-diagnostic.cjs');

const ROOT=search.ROOT;
const EXECUTION_LOCK_PHASE='mid-0.55-screen-v1';
const ARCHIVE_NAME='mid-0.55-screen-v1.tar.gz';
const GENERATION=2;

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return diagnostic.jsonBytes(value);}
function same(a,b){return diagnostic.same(a,b);}
function immutableDualJson(roots,relative,value){
  const primary=path.join(roots.primary,relative),secondary=path.join(roots.secondary,relative),bytes=jsonBytes(value);
  if(fs.existsSync(primary)||fs.existsSync(secondary)){
    if(!fs.existsSync(primary)||!fs.existsSync(secondary))throw new Error(`BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial immutable ${relative}`);
    const old=durable.verifyDualCopy(primary,secondary);
    if(!old.bytes.equals(bytes))throw new Error(`BLOCKED_DIAGNOSTIC: immutable ${relative} already exists with different bytes`);
    return old;
  }
  return durable.writeDualCopy(primary,secondary,bytes);
}
function readJson(roots,relative){return diagnostic.readDualJson(roots,relative);}
function baseRootsFor(root=ROOT,home=process.env.HOME){return v15.rootsFor(root,home).base;}
function searchRootsFor(root=ROOT,home=process.env.HOME){return v15.rootsFor(root,home);}
function cellsForCapture(){return diagnostic.exactCells().map(cell=>({...cell,captureOptions:diagnostic.captureOptionsForCell(cell)}));}
function currentIdentity(root){return search.currentProtectedIdentity(root);}
function captureIdentity(root,protectedIdentity,cells){
  const helper=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs');
  return {captureHelperSha256:sha256(fs.readFileSync(helper)),diagnosticWasmSha256:protectedIdentity.diagnosticWasmSha256,
    sampleRate:captureDefault.SAMPLE_RATE,block:captureDefault.BLOCK,durationMs:captureDefault.DURATION_MS,
    response:{...diagnostic.RESPONSE},cellOptions:cells.map(cell=>({key:cell.key,options:cell.captureOptions}))};
}
function parentSearchPreflight({root=ROOT,home=process.env.HOME}={}){
  return preflight.preflight({root,home,verifySourceAudit:midi41Amendment.assertSourceAudit,verifyAmendment:midi41Amendment.verify});
}
function assertProtectedIdentity(actual,expected){
  const ignored=new Set(['sourceRevision']);
  const left=Object.fromEntries(Object.entries(actual||{}).filter(([key])=>!ignored.has(key)));
  const right=Object.fromEntries(Object.entries(expected||{}).filter(([key])=>!ignored.has(key)));
  if(!same(left,right))throw new Error('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT: current protected inputs differ from the parent search manifest');
  return true;
}
function readOnlyPreflight({root=ROOT,home=process.env.HOME,roots=searchRootsFor(root,home),sourceVerifier=v15.runtimeContext,
  searchPreflightVerifier=parentSearchPreflight,capture=captureDefault,identityProvider=currentIdentity,
  expectedParentManifestSha256=diagnostic.PARENT_MANIFEST_SHA256}={}){
  const source=sourceVerifier({root,home,roots});
  if(source.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||source.builds!==0||source.acousticRenders!==0||source.evidenceWrites!==0)
    throw new Error('BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY: v15 did not provide a zero-render source attestation');
  const parentSearch=searchPreflightVerifier({root,home});
  if(parentSearch.decision!=='STAGE3E_SEARCH_PREFLIGHT_READY'||parentSearch.builds!==0||parentSearch.acousticRenders!==0||parentSearch.evidenceWrites!==0)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: parent search preflight did not pass read-only');
  const parentManifest=diagnostic.readDualJson(roots,'generation-2-manifest.json');
  if(parentManifest.sha256!==expectedParentManifestSha256||parentManifest.value.searchEpoch!=='search-v1'||parentManifest.value.state!=='ACTIVE')
    throw new Error('BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT: parent Generation-2 manifest SHA or identity differs');
  const cells=cellsForCapture();
  for(const cell of cells)capture.validateCaptureRequest(cell.pitch,cell.velocityNormalized,diagnostic.RESPONSE,cell.captureOptions);
  const protectedIdentity=identityProvider(root);
  assertProtectedIdentity(protectedIdentity,parentManifest.value.identity?.protectedIdentity);
  const controls=diagnostic.bindMid060Controls({searchRoots:roots,parentManifestSha256:parentManifest.sha256,cells});
  const namespace=diagnostic.validateMid055DiagnosticNamespace({primaryRoot:roots.base.primary,secondaryRoot:roots.base.secondary,
    sourceCommit:source.acceptedCommit,parentManifestSha256:parentManifest.sha256,v15AttestationSha256:source.sha256,
    expectedCaptureIdentity:captureIdentity(root,protectedIdentity,cells),cells});
  return {source,parentSearch,parentManifest,cells,controls,protectedIdentity,captureIdentity:captureIdentity(root,protectedIdentity,cells),namespace,
    builds:0,acousticRenders:0,evidenceWrites:0};
}
function snapshotEvidenceRoots(baseRoots){
  const snapshot={};
  for(const [side,root] of Object.entries(baseRoots)){
    const rows=[];
    function walk(directory){
      for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        const file=path.join(directory,entry.name),relative=path.relative(root,file).split(path.sep).join('/');
        const stat=fs.lstatSync(file);
        if(stat.isSymbolicLink())throw new Error(`BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: symlink ${relative}`);
        if(stat.isDirectory()){walk(file);continue;}
        if(!stat.isFile())throw new Error(`BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: non-file ${relative}`);
        rows.push({path:relative,sha256:sha256(fs.readFileSync(file)),sizeBytes:stat.size,
          mtimeNs:stat.mtimeNs?.toString(),ctimeNs:stat.ctimeNs?.toString()});
      }
    }
    walk(root);snapshot[side]=rows.sort((a,b)=>a.path.localeCompare(b.path));
  }
  return snapshot;
}
function verifyFinalization({roots,namespace}){
  if(namespace.decision!=='COMPLETE')throw new Error('BLOCKED_DIAGNOSTIC: finalization requires twelve COMPLETE cells');
  const manifest=readJson(roots,diagnostic.FILES.evidenceManifest);
  const hash=durable.verifyDualCopy(path.join(roots.primary,diagnostic.FILES.evidenceManifestSha),path.join(roots.secondary,diagnostic.FILES.evidenceManifestSha));
  if(hash.bytes.toString('utf8')!==`${manifest.sha256}\n`)throw new Error('BLOCKED_DIAGNOSTIC: finalized evidence manifest hash differs');
  const actual=durable.assertMatchingInventory(roots.primary,roots.secondary);
  if(!same(manifest.value.files,actual))throw new Error('BLOCKED_DIAGNOSTIC: finalized diagnostic inventory differs');
  const archive=durable.verifyDualCopy(path.join(roots.primary,diagnostic.FILES.archive),path.join(roots.secondary,diagnostic.FILES.archive));
  const names=execFileSync('tar',['-tzf',path.join(roots.primary,diagnostic.FILES.archive)],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  const expected=diagnostic.walkNamespace(namespace.roots.primary).map(row=>row.path).filter(name=>name!==diagnostic.FILES.archive).sort();
  const normalized=names.map(name=>name.replace(/^\.\//,'')).sort();
  if(!same(normalized,expected)||normalized.some(name=>name.startsWith('/')||name.split('/').some(part=>part==='..'||part.startsWith('._'))))
    throw new Error('BLOCKED_DIAGNOSTIC: final archive has unknown, unsafe, or missing members');
  const listing=execFileSync('tar',['-tvzf',path.join(roots.primary,diagnostic.FILES.archive)],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
  if(listing.some(line=>line[0]!=='-'))throw new Error('BLOCKED_DIAGNOSTIC: final archive contains non-regular members');
  return {manifestSha256:manifest.sha256,archiveSha256:archive.sha256,archiveEntries:normalized.length};
}
function validateResult({roots,namespace,referenceRows,controls,cells}){
  if(namespace.decision!=='COMPLETE')return null;
  const rows=ledgerRows(roots,namespace.ledgerSha256,cells);
  const result=readJson(roots,diagnostic.FILES.result);
  const expected=diagnostic.compareScreen({diagnosticRows:rows,controlRows:controls,referenceRows,cells});
  if(result.value.schemaVersion!==1||result.value.kind!=='ISSUE9_MID055_FINAL_RESULT'||!same(result.value.screen,expected)||
     result.value.official16LayerAcceptance!=='NOT_RUN'||result.value.attemptedCount!==12||result.value.completedCount!==12)
    throw new Error('BLOCKED_DIAGNOSTIC: finalized result differs from immutable cell metrics or screen rules');
  return result.value;
}
function ledgerRows(roots,ledgerSha256,cells){
  const stored=readJson(roots,diagnostic.FILES.ledger);
  if(stored.sha256!==ledgerSha256)throw new Error('BLOCKED_DIAGNOSTIC: ledger changed while validating cells');
  return stored.value.cells.map((state,index)=>{
    const item=readJson(roots,state.relativePath);
    if(item.sha256!==state.sha256||!same(item.value.cell,cells[index])||!same(item.value.captureOptions,cells[index].captureOptions))
      throw new Error(`BLOCKED_DIAGNOSTIC: completed cell source binding differs: ${cells[index].key}`);
    diagnostic.validateSafeMetrics(item.value.metrics);return item.value;
  });
}
function makeTransition({ledger,cell,oldState,newState,completedCellSha256=null,now}){
  const previousBytes=jsonBytes(ledger),previousLedgerSha256=sha256(previousBytes),next=JSON.parse(previousBytes.toString('utf8'));
  const row=next.cells.find(item=>item.identity.key===cell.key);
  if(!row||row.state!==oldState)throw new Error(`BLOCKED_DIAGNOSTIC: invalid pre-transition state for ${cell.key}`);
  if(oldState==='PENDING'&&newState==='IN_PROGRESS'){
    if(next.attemptCount>=diagnostic.ATTEMPT_LIMIT||row.attempt!==null)throw new Error('BLOCKED_DIAGNOSTIC_AUTHORIZATION: the 12-attempt budget is exhausted');
    next.attemptCount++;row.attempt={number:next.attemptCount,startedAt:now(),renderStartMarker:null};row.state='IN_PROGRESS';
  }else if(oldState==='IN_PROGRESS'&&newState==='COMPLETE'){
    if(!row.attempt||!Number.isInteger(row.attempt.number)||!completedCellSha256)throw new Error('BLOCKED_DIAGNOSTIC: completion has no recorded attempt or cell SHA');
    row.state='COMPLETE';row.sha256=completedCellSha256;row.completedAt=now();
  }else throw new Error(`BLOCKED_DIAGNOSTIC: unsupported transition ${oldState} to ${newState}`);
  next.transitionCount++;
  const bytes=jsonBytes(next),sequence=next.transitionCount;
  const transition={schemaVersion:1,kind:'ISSUE9_MID055_LEDGER_TRANSITION',sequence,executionId:next.executionId,
    cellKey:cell.key,oldState,newState,previousLedgerSha256,nextLedgerSha256:sha256(bytes),
    previousAttemptCount:ledger.attemptCount,nextAttemptCount:next.attemptCount,completedCellSha256,createdAt:now(),nextLedger:next};
  return {transition,nextLedger:next};
}
function storeTransition({roots,ledger,cell,oldState,newState,completedCellSha256=null,now}){
  const {transition,nextLedger}=makeTransition({ledger,cell,oldState,newState,completedCellSha256,now});
  const relative=diagnostic.transitionPath(transition.sequence);
  const stored=immutableDualJson(roots,relative,transition);
  const ledgerStored=durable.writeDualCopy(path.join(roots.primary,diagnostic.FILES.ledger),path.join(roots.secondary,diagnostic.FILES.ledger),jsonBytes(nextLedger));
  if(ledgerStored.sha256!==transition.nextLedgerSha256)throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: transition next-ledger SHA differs');
  if(!durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.equals(jsonBytes(transition)))
    throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: transition readback differs');
  return {transition,ledger:nextLedger,transitionSha256:stored.sha256,ledgerSha256:ledgerStored.sha256};
}
function appendRenderStart({roots,ledger,cell,transition,transitionSha256,now}){
  const marker={schemaVersion:1,kind:'ISSUE9_MID055_RENDER_START',sequence:transition.sequence,transitionSequence:transition.sequence,
    cellKey:cell.key,executionId:ledger.executionId,transitionSha256:sha256(jsonBytes(transition)),ledgerSha256:transition.nextLedgerSha256,createdAt:now()};
  const stored=immutableDualJson(roots,diagnostic.renderStartPath(transition.sequence),marker);
  // The render-start marker is a separate immutable journal entry, outside the ledger hash chain.
  return {marker,sha256:stored.sha256,ledger};
}
function listJournal(roots){
  const journal=path.join(roots.primary,'ledger-transition-journal');
  if(!fs.existsSync(journal))return {transitions:[],renderStarts:[]};
  const entries=fs.readdirSync(journal).sort();
  const transitions=[],renderStarts=[];
  for(const file of entries){
    if(/^transition-\d{6}\.json$/.test(file))transitions.push(readJson(roots,`ledger-transition-journal/${file}`).value);
    else if(/^render-start-\d{6}\.json$/.test(file))renderStarts.push(readJson(roots,`ledger-transition-journal/${file}`).value);
    else if(!['genesis.json','genesis-ledger.json'].includes(file))throw new Error(`BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: unknown journal entry ${file}`);
  }
  return {transitions,renderStarts};
}
function replayCurrent(roots,ledger,cells){
  const genesis=readJson(roots,diagnostic.FILES.genesis),genesisLedger=durable.verifyDualCopy(path.join(roots.primary,diagnostic.FILES.genesisLedger),path.join(roots.secondary,diagnostic.FILES.genesisLedger));
  const journal=listJournal(roots);
  return diagnostic.replayJournal({ledger,genesis,genesisLedgerBytes:genesisLedger.bytes,...journal,cells});
}
function assertNoOtherWriterLocks(root){
  const lockRoot=path.join(search.gitCommonDir(root),'soraoto-agent-locks');
  if(!fs.existsSync(lockRoot))return true;
  const existing=fs.readdirSync(lockRoot).filter(name=>/^issue-7-stage3e-generation-2-.+\.lock$/.test(name));
  if(existing.length)throw new Error(`BLOCKED_STAGE3E_WRITER_LOCKED: existing Stage3E writer lock(s): ${existing.join(', ')}`);
  return true;
}
function createManifest({root,source,parentManifest,cells,controls,protectedIdentity,captureId,sourceContext,executionId,now}){
  const runnerPath=path.join(__dirname,'run-stage3e-mid055-diagnostic.cjs'),verifierPath=path.join(__dirname,'stage3e-performance-verifier-continuation-v15.cjs');
  return {schemaVersion:1,kind:'ISSUE9_MID055_DIAGNOSTIC_MANIFEST',issue:diagnostic.ISSUE,phase:'mid-0.55-screen-v1',
    parentManifestSha256:parentManifest.sha256,sourceCommit:sourceContext.acceptedCommit,v15AttestationSha256:sourceContext.sha256,
    sourceCompatibility:{v14AcceptedCommit:v15.PARENT_ACCEPTED_COMMIT,v14AttestationSha256:v15.PARENT_SHA256,
      v15AcceptedCommit:sourceContext.acceptedCommit,v15AttestationSha256:sourceContext.sha256},
    executionId,createdAt:now(),acousticIdentity:protectedIdentity,searchIdentity:parentManifest.value.identity,captureIdentity:captureId,
    cells,controls:controls.map(control=>({diagnosticCellKey:cells.find(cell=>cell.pitch===control.pitch&&cell.velocity===control.velocity).key,
      controlCellKey:control.cellKey,pitch:control.pitch,velocity:control.velocity,response:control.response,
      relativePath:control.relativePath,sha256:control.sha256})),
    outputMetricIdentity:{field:'metrics.envelopeDbfs[3]',residual:'((actualHigh-actualLow)-(referenceHigh-referenceLow))',pairs:[[14,61],[61,124],[14,124]]},
    runnerSha256:sha256(fs.readFileSync(runnerPath)),verifierSha256:sha256(fs.readFileSync(verifierPath)),official16LayerAcceptance:'NOT_RUN'};
}
function safeCreateArchive({roots,allowedFiles,now=Date.now}={}){
  if(!Array.isArray(allowedFiles)||new Set(allowedFiles).size!==allowedFiles.length)
    throw new Error('BLOCKED_DIAGNOSTIC: archive requires a unique validated namespace allowlist');
  const files=diagnostic.walkNamespace(roots.primary).map(row=>row.path).filter(name=>name!==diagnostic.FILES.archive).sort();
  if(!same(files,[...allowedFiles].sort()))throw new Error('BLOCKED_DIAGNOSTIC: archive source files differ from the validated namespace allowlist');
  for(const relative of files){
    if(path.posix.isAbsolute(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('._')))
      throw new Error(`BLOCKED_DIAGNOSTIC: unsafe archive path ${relative}`);
  }
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue9-mid055-archive-')),archive=path.join(temp,ARCHIVE_NAME);
  try{
    const env={...process.env,COPYFILE_DISABLE:'1'};
    execFileSync('tar',['-czf',archive,'-C',roots.primary,'--',...files],{env,stdio:'pipe'});
    const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).map(name=>name.replace(/^\.\//,''));
    if(!same(names.sort(),files)||names.some(name=>path.posix.isAbsolute(name)||name.split('/').some(part=>part==='..')||path.posix.basename(name).startsWith('._')))
      throw new Error('BLOCKED_DIAGNOSTIC: archive member list differs from the exact evidence allowlist');
    const verbose=execFileSync('tar',['-tvzf',archive],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
    if(verbose.some(line=>line[0]!=='-'))throw new Error('BLOCKED_DIAGNOSTIC: archive contains a non-regular member');
    const stored=durable.writeDualCopy(path.join(roots.primary,diagnostic.FILES.archive),path.join(roots.secondary,diagnostic.FILES.archive),fs.readFileSync(archive));
    return {sha256:stored.sha256,entries:files.length,createdAt:new Date(now()).toISOString()};
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
function initialize({roots,manifest,executionId,sourceCommit,now}){
  fs.mkdirSync(roots.primary,{recursive:true,mode:0o700});fs.mkdirSync(roots.secondary,{recursive:true,mode:0o700});
  const manifestStored=immutableDualJson(roots,diagnostic.FILES.manifest,manifest);
  const ledger=diagnostic.freshLedger(manifest.cells,{executionId,manifestSha256:manifestStored.sha256,sourceCommit,createdAt:now()});
  const ledgerStored=immutableDualJson(roots,diagnostic.FILES.genesisLedger,ledger);
  immutableDualJson(roots,diagnostic.FILES.ledger,ledger);
  immutableDualJson(roots,diagnostic.FILES.genesis,{schemaVersion:1,kind:'ISSUE9_MID055_DIAGNOSTIC_GENESIS',executionId,
    manifestSha256:manifestStored.sha256,initialLedgerSha256:ledgerStored.sha256,attemptCount:0,createdAt:now()});
  return {manifest,manifestSha256:manifestStored.sha256,ledger};
}
function executeDiagnostic({root,roots,ready,capture,now}){
  const resolved=evidencePaths.resolveMid055DiagnosticRoots({primary:roots.base.primary,secondary:roots.base.secondary});
  const auth=readJson(resolved,diagnostic.FILES.authorization);
  diagnostic.validateAuthorization(auth.value,{parentManifestSha256:ready.parentManifest.sha256,sourceCommit:ready.source.acceptedCommit,
    v15AttestationSha256:ready.source.sha256,captureIdentity:ready.captureIdentity});
  if(ready.namespace.decision!=='NOT_STARTED'||(ready.namespace.exists&&!ready.namespace.authorized)||ready.namespace.attemptCount!==0)
    throw new Error('BLOCKED_DIAGNOSTIC: execute is single-use and cannot resume or rerender');
  const cells=ready.cells;
  const manifest=createManifest({root,source:ready.source,parentManifest:ready.parentManifest,cells,controls:ready.controls,
    protectedIdentity:ready.protectedIdentity,captureId:ready.captureIdentity,sourceContext:ready.source,executionId:auth.value.executionId,now});
  const initialized=initialize({roots:resolved,manifest,executionId:auth.value.executionId,sourceCommit:ready.source.acceptedCommit,now});
  let ledger=initialized.ledger;
  for(const cell of cells){
    const state=ledger.cells.find(row=>row.identity.key===cell.key);
    if(state.state!=='PENDING')throw new Error(`BLOCKED_DIAGNOSTIC: non-pending cell ${cell.key}; no retry is permitted`);
    const started=storeTransition({roots:resolved,ledger,cell,oldState:'PENDING',newState:'IN_PROGRESS',now});
    ledger=started.ledger;
    const marker=appendRenderStart({roots:resolved,ledger,cell,transition:started.transition,transitionSha256:started.transitionSha256,now});
    const journal=listJournal(resolved);
    diagnostic.replayJournal({ledger,genesis:readJson(resolved,diagnostic.FILES.genesis),
      genesisLedgerBytes:durable.verifyDualCopy(path.join(resolved.primary,diagnostic.FILES.genesisLedger),path.join(resolved.secondary,diagnostic.FILES.genesisLedger)).bytes,
      ...journal,cells,allowInProgress:true});
    if(!marker.sha256)throw new Error(`BLOCKED_DIAGNOSTIC: durable render-start marker missing for ${cell.key}`);
    const options={...cell.captureOptions,velocityNormalized:cell.velocityNormalized};
    capture.validateCaptureRequest(cell.pitch,cell.velocityNormalized,diagnostic.RESPONSE,cell.captureOptions);
    const measured=capture.render(cell.pitch,cell.velocity,diagnostic.RESPONSE,options);
    diagnostic.validateSafeMetrics(measured?.metrics);
    const row={schemaVersion:1,kind:'ISSUE9_MID055_CELL',cellKey:cell.key,cell,captureOptions:cell.captureOptions,
      identity:ready.parentManifest.value.identity,pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized,
      response:{...diagnostic.RESPONSE},metrics:measured.metrics,capturedAt:now()};
    const stored=durable.writeDualCopy(path.join(resolved.primary,cell.relativePath),path.join(resolved.secondary,cell.relativePath),jsonBytes(row));
    const complete=storeTransition({roots:resolved,ledger,cell,oldState:'IN_PROGRESS',newState:'COMPLETE',completedCellSha256:stored.sha256,now});
    ledger=complete.ledger;
    diagnostic.replayJournal({ledger,genesis:readJson(resolved,diagnostic.FILES.genesis),
      genesisLedgerBytes:durable.verifyDualCopy(path.join(resolved.primary,diagnostic.FILES.genesisLedger),path.join(resolved.secondary,diagnostic.FILES.genesisLedger)).bytes,
      ...listJournal(resolved),cells});
  }
  const rows=ledgerRows(resolved,readJson(resolved,diagnostic.FILES.ledger).sha256,cells),fixture=generationCore.loadReferenceFixture(root);
  const screen=diagnostic.compareScreen({diagnosticRows:rows,controlRows:ready.controls,referenceRows:fixture.directCells,cells});
  const result={schemaVersion:1,kind:'ISSUE9_MID055_FINAL_RESULT',executionId:auth.value.executionId,
    sourceCommit:ready.source.acceptedCommit,v15AttestationSha256:ready.source.sha256,attemptedCount:ledger.attemptCount,
    completedCount:diagnostic.ledgerCounts(ledger).COMPLETE,screen,official16LayerAcceptance:'NOT_RUN',finalizedAt:now()};
  immutableDualJson(resolved,diagnostic.FILES.result,result);
  const preFinalNamespace=diagnostic.validateMid055DiagnosticNamespace({primaryRoot:roots.base.primary,secondaryRoot:roots.base.secondary,
    sourceCommit:ready.source.acceptedCommit,parentManifestSha256:ready.parentManifest.sha256,v15AttestationSha256:ready.source.sha256,
    expectedCaptureIdentity:ready.captureIdentity,cells,allowMissingFinalizationSidecars:true,allowArchiveMissing:true});
  if(preFinalNamespace.decision!=='COMPLETE')throw new Error('BLOCKED_DIAGNOSTIC: result did not pass complete namespace validation');
  validateResult({roots:resolved,namespace:preFinalNamespace,referenceRows:fixture.directCells,controls:ready.controls,cells});
  const finalizedManifest=readJson(resolved,diagnostic.FILES.manifest).value;
  durable.writeFinalizedManifest({primaryRoot:resolved.primary,secondaryRoot:resolved.secondary,metadata:{creatorRevision:ready.source.acceptedCommit,
    executionId:auth.value.executionId,generation:GENERATION,runnerSha256:finalizedManifest.runnerSha256,helperSha256:ready.captureIdentity.captureHelperSha256,
    wasmSha256:ready.protectedIdentity.diagnosticWasmSha256,startedAt:finalizedManifest.createdAt,finalizedAt:result.finalizedAt,decision:screen.decision}});
  const preArchiveNamespace=diagnostic.validateMid055DiagnosticNamespace({primaryRoot:roots.base.primary,secondaryRoot:roots.base.secondary,
    sourceCommit:ready.source.acceptedCommit,parentManifestSha256:ready.parentManifest.sha256,v15AttestationSha256:ready.source.sha256,
    expectedCaptureIdentity:ready.captureIdentity,cells,allowArchiveMissing:true});
  const archive=safeCreateArchive({roots:resolved,allowedFiles:preArchiveNamespace.files.map(row=>row.path)});
  const namespace=diagnostic.validateMid055DiagnosticNamespace({primaryRoot:roots.base.primary,secondaryRoot:roots.base.secondary,
    sourceCommit:ready.source.acceptedCommit,parentManifestSha256:ready.parentManifest.sha256,v15AttestationSha256:ready.source.sha256,
    expectedCaptureIdentity:ready.captureIdentity,cells});
  if(namespace.decision!=='COMPLETE')throw new Error('BLOCKED_DIAGNOSTIC: completed diagnostic failed read-back validation');
  const finalResult=validateResult({roots:resolved,namespace,referenceRows:fixture.directCells,controls:ready.controls,cells});
  const archiveCheck=verifyFinalization({roots:resolved,namespace});
  return {decision:screen.decision,attemptedCount:ledger.attemptCount,completedCount:result.completedCount,
    official16LayerAcceptance:'NOT_RUN',archiveSha256:archive.sha256,verifiedResult:finalResult.decision,archiveEntries:archiveCheck.archiveEntries};
}
function run({mode,root=ROOT,home=process.env.HOME,roots=searchRootsFor(root,home),sourceVerifier=v15.runtimeContext,
  searchPreflightVerifier=parentSearchPreflight,capture=captureDefault,identityProvider=currentIdentity,
  expectedParentManifestSha256=diagnostic.PARENT_MANIFEST_SHA256,now=()=>new Date().toISOString()}={}){
  if(!['--dry-run','--verify','--execute'].includes(mode))throw new Error('explicit mode required: --dry-run, --verify, or --execute');
  if(mode==='--dry-run'||mode==='--verify'){
    const before=snapshotEvidenceRoots(roots.base);
    const ready=readOnlyPreflight({root,home,roots,sourceVerifier,searchPreflightVerifier,capture,identityProvider,expectedParentManifestSha256});
    let answer;
    if(mode==='--verify'){
      answer=ready.namespace.decision==='NOT_STARTED'?{decision:'NOT_STARTED',namespaceExists:false,attemptedCount:0,completedCount:0}:
        {...ready.namespace,official16LayerAcceptance:'NOT_RUN'};
      if(ready.namespace.decision==='COMPLETE'){
        const fixture=generationCore.loadReferenceFixture(root),final=validateResult({roots:ready.namespace.roots,namespace:ready.namespace,
          referenceRows:fixture.directCells,controls:ready.controls,cells:ready.cells});
        const archival=verifyFinalization({roots:ready.namespace.roots,namespace:ready.namespace});
        answer={...answer,result:final,archive:archival};
      }
    }else{
      answer={decision:'DRY_RUN_READY',namespace:ready.namespace.decision,cells:ready.cells.map(cell=>cell.key),
        parentManifestSha256:ready.parentManifest.sha256,v15AttestationSha256:ready.source.sha256,
        attemptedCount:ready.namespace.attemptCount||0,builds:0,acousticRenders:0,evidenceWrites:0,writerLockCreated:false};
    }
    const after=snapshotEvidenceRoots(roots.base);
    if(!same(before,after))throw new Error('BLOCKED_DIAGNOSTIC_READ_ONLY: --dry-run/--verify changed canonical evidence bytes, mtimes, or ctimes');
    return answer;
  }
  assertNoOtherWriterLocks(root);
  const sourceCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const lock=preflight.acquireWriterLock({root,phase:EXECUTION_LOCK_PHASE,
    executionIdentity:sha256(jsonBytes({issue:diagnostic.ISSUE,phase:EXECUTION_LOCK_PHASE,sourceCommit,namespace:diagnostic.NAMESPACE}))});
  try{
    const ready=readOnlyPreflight({root,home,roots,sourceVerifier,searchPreflightVerifier,capture,identityProvider,expectedParentManifestSha256});
    return executeDiagnostic({root,roots,ready,capture,now});
  }finally{lock.release();}
}
function main(argv=process.argv.slice(2),options={}){
  if(argv.length!==1)throw new Error('one explicit mode is required');
  const result=run({mode:argv[0],...options});process.stdout.write(JSON.stringify(result)+'\n');return result;
}

module.exports={ROOT,EXECUTION_LOCK_PHASE,ARCHIVE_NAME,sha256,jsonBytes,same,immutableDualJson,readJson,baseRootsFor,searchRootsFor,
  cellsForCapture,currentIdentity,captureIdentity,assertProtectedIdentity,readOnlyPreflight,snapshotEvidenceRoots,verifyFinalization,
  validateResult,ledgerRows,makeTransition,storeTransition,appendRenderStart,listJournal,replayCurrent,assertNoOtherWriterLocks,
  createManifest,safeCreateArchive,initialize,run,main};

if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
