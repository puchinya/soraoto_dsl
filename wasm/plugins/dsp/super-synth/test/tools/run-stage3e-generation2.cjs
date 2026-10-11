#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const legacy=require('./stage3e-search-core.cjs');
const captureDefaults=require('./capture-supersynth-stage3e-matrix.cjs');
const core=require('./stage3e-generation2-core.cjs');
const historical=require('./run-stage3e-historical-reference-requalification.cjs');
const midi41Amendment=require('./run-stage3e-midi41-evidence-amendment.cjs');
const searchPreflight=require('./stage3e-preflight.cjs');
const evidenceValidator=require('./stage3e-evidence-validator.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');
const incrementalVerification=require('./stage3e-incremental-verification.cjs');

const ROOT=legacy.ROOT;
const EXECUTION_ID='generation-2';
const TOLERANCE=1e-6;
const LOW_SCREEN_VELOCITIES=[14,61,124];
const MID_SCREEN_VELOCITIES=[14,61,124];
const OFFICIAL_VELOCITIES=legacy.OFFICIAL_VELOCITIES;

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function sameExecutionIdentity(current,expected){
  const keys=['schemaVersion','generation','executionId','creatorRevision','candidateId','protectedIdentity',
    'referenceSetSha256','captureHelperSha256','runnerSha256','coreSha256','searchEpoch',
    'midi41AmendmentResultSha256','historicalGeneration2ManifestSha256','activeSearchCaptureIdentity'];
  return keys.every(key=>same(current?.[key],expected?.[key]));
}
function cellId(cell){
  const tuple=cell.response?`L${cell.response.low}-M${cell.response.mid}-H${cell.response.bassHardness}`:'';
  const velocity=cell.velocityNormalized!==undefined?`v${String(Math.round(cell.velocityNormalized*1000)).padStart(3,'0')}`:`v${String(cell.velocity).padStart(3,'0')}`;
  return `${cell.phase||'cell'}-${tuple?`${tuple}-`:''}midi-${String(cell.pitch).padStart(3,'0')}-${velocity}`;
}
function historicalRoots(root=ROOT,home=process.env.HOME){return durable.resolveRoots({root,issue:'7',task:'stage3e',executionId:historical.EXECUTION_ID,home});}
function generationRoots(root=ROOT,home=process.env.HOME){return durable.resolveRoots({root,issue:'7',task:'stage3e',executionId:EXECUTION_ID,home});}
function phaseRoots(generation,phase){
  return evidencePaths.resolvePhaseRoots(generation,phase);
}
function readDualJson(roots,relative){return JSON.parse(durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.toString('utf8'));}
function writeDualJson(roots,relative,value){return durable.writeDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),jsonBytes(value));}
function immutableDualJson(roots,relative,value){const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative),bytes=jsonBytes(value);if(fs.existsSync(a)||fs.existsSync(b)){if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_EVIDENCE_SECONDARY_PERSISTENCE');const stored=durable.verifyDualCopy(a,b);if(!stored.bytes.equals(bytes))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: immutable ${relative} changed`);return stored;}return durable.writeDualCopy(a,b,bytes);}
function getGeneration2Roots({root=ROOT,home=process.env.HOME,evidenceRoot=process.env.SORAOTO_STAGE3E_EVIDENCE_ROOT}={}){
  const base=generationRoots(root,home),roots={primary:path.join(base.primary,'search-v1'),secondary:path.join(base.secondary,'search-v1')},expected=path.resolve(roots.primary);
  if(evidenceRoot&&path.resolve(evidenceRoot)!==expected)throw new Error('BLOCKED_STAGE3E_EVIDENCE_ROOT_IDENTITY');
  const build=path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build'));
  const within=(a,b)=>b===a||b.startsWith(a+path.sep);
  for(const candidate of [roots.primary,roots.secondary])if(within(path.resolve(root),candidate)||within(build,candidate))throw new Error('BLOCKED_STAGE3E_EVIDENCE_ROOT_INSIDE_WORKTREE_OR_BUILD');
  return roots;
}
function currentGenerationIdentity({root=ROOT,referenceSetSha256,protectedIdentity=legacy.currentProtectedIdentity(root),midi41AmendmentResultSha256,historicalGeneration2ManifestSha256}={}){
  if(!midi41AmendmentResultSha256||!historicalGeneration2ManifestSha256)throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: finalized MIDI41 amendment is required');
  const runnerFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs');
  const coreFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs');
  const helperFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs');
  const captureHelperSha256=sha256(fs.readFileSync(helperFile)),runnerSha256=sha256(fs.readFileSync(runnerFile));
  return {schemaVersion:1,generation:2,executionId:EXECUTION_ID,searchEpoch:'search-v1',creatorRevision:protectedIdentity.sourceRevision,
    candidateId:protectedIdentity.candidateId,protectedIdentity,referenceSetSha256,midi41AmendmentResultSha256,historicalGeneration2ManifestSha256,
    captureHelperSha256,runnerSha256,coreSha256:sha256(fs.readFileSync(coreFile)),
    activeSearchCaptureIdentity:{captureHelperSha256,velocityResponseRunnerSha256:protectedIdentity.stage3eRunnerSha256,
      generation2RunnerSha256:runnerSha256,midi41AmendmentResultSha256,historicalGeneration2ManifestSha256,searchEpoch:'search-v1'}};
}
function assertGenerationManifest(roots,identity,now=()=>new Date().toISOString()){
  const file='generation-2-manifest.json',a=path.join(roots.primary,file),b=path.join(roots.secondary,file);
  const value={schemaVersion:1,executionId:EXECUTION_ID,searchEpoch:'search-v1',generation:2,state:'ACTIVE',identity,createdAt:now(),
    authorizedCells:{baselineRowsReused:12,baselineRenders:0,lowGrid:legacy.lowGridTuples().length,midGrid:legacy.MID_GRID.length}};
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: partial generation manifest');
    const old=readDualJson(roots,file);if(!same(old.identity,identity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY');return old;
  }
  writeDualJson(roots,file,value);return value;
}
function assertExistingGenerationManifest(roots,identity){
  const stored=durable.verifyDualCopy(path.join(roots.primary,'generation-2-manifest.json'),path.join(roots.secondary,'generation-2-manifest.json'));
  const manifest=JSON.parse(stored.bytes.toString('utf8'));
  if(manifest.searchEpoch!=='search-v1'||!same(manifest.identity,identity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: active search manifest mismatch');
  return manifest;
}
function cellSpecs(phase,rows,response=null){return rows.map(row=>{const selectedResponse=response?{...response}:row.response?{...row.response}:null;return {...row,phase,response:selectedResponse,key:cellId({...row,phase,response:selectedResponse})};});}
function freshCellLedger(phase,identity,cells){const states={};for(const cell of cells)states[cell.key]={state:'PENDING',identity:cell,relativePath:`cells/${cell.key}.json`,sha256:null};return {schemaVersion:1,generation:2,executionId:EXECUTION_ID,phase,identity,authorizedCellCount:cells.length,accounting:{renderCalls:0},cells:states};}
function ledgerCounts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells).filter(cell=>cell.state===state).length]));}
function loadLedger(roots,phase,identity,cells,{create=false}={}){
  const file=`${phase}-ledger.json`,a=path.join(roots.primary,file),b=path.join(roots.secondary,file);
  if(!fs.existsSync(a)&&!fs.existsSync(b)){
    if(!create)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: ${phase} ledger missing`);
    const fresh=freshCellLedger(phase,identity,cells);writeDualJson(roots,file,fresh);return fresh;
  }
  if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: partial ${phase} ledger`);
  const ledger=readDualJson(roots,file);
  if(ledger.phase!==phase||ledger.generation!==2||!same(ledger.identity,identity)||ledger.authorizedCellCount!==cells.length||Object.keys(ledger.cells||{}).length!==cells.length)
    throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: ${phase} ledger identity mismatch`);
  for(const cell of cells){const state=ledger.cells[cell.key];if(!state||!same(state.identity,cell))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: unauthorized or changed cell ${cell.key}`);}
  const inProgress=Object.entries(ledger.cells).filter(([,value])=>value.state==='IN_PROGRESS');if(inProgress.length)throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: ${inProgress.map(([key])=>key).join(',')}`);
  for(const [key,state] of Object.entries(ledger.cells))if(state.state==='COMPLETE'){
    const bytes=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(bytes.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: completed cell SHA mismatch ${key}`);
    const row=JSON.parse(bytes.bytes.toString('utf8'));if(row.cellKey!==key||!same(row.identity,identity)||!same(row.cell,state.identity))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: completed cell identity mismatch ${key}`);
  }
  return ledger;
}
function writeCellState(roots,ledger){return writeDualJson(roots,`${ledger.phase}-ledger.json`,ledger);}
function ledgerJournalRoots(base,relative='ledger-transition-journal'){
  const primaryManifest=path.join(base.primary,'generation-2-manifest.json'),secondaryManifest=path.join(base.secondary,'generation-2-manifest.json');
  if(relative==='ledger-transition-journal'&&fs.existsSync(primaryManifest)&&fs.existsSync(secondaryManifest)){
    const manifest=readDualJson(base,'generation-2-manifest.json'),resolved=evidencePaths.resolveStage3eEvidencePaths(base,manifest);
    return {primary:resolved.primary.journalRoot,secondary:resolved.secondary.journalRoot};
  }
  return {primary:path.join(base.primary,relative),secondary:path.join(base.secondary,relative)};
}
function immutableDualBytes(roots,relative,bytes){
  const primary=path.join(roots.primary,relative),secondary=path.join(roots.secondary,relative);
  if(fs.existsSync(primary)||fs.existsSync(secondary)){
    if(!fs.existsSync(primary)||!fs.existsSync(secondary))throw new Error(`BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial immutable ${relative}`);
    const stored=durable.verifyDualCopy(primary,secondary);
    if(!stored.bytes.equals(bytes))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: immutable ${relative} changed`);
    return stored;
  }
  return durable.writeDualCopy(primary,secondary,bytes);
}
function transitionEntries(roots){
  if(!fs.existsSync(roots.primary)&&!fs.existsSync(roots.secondary))return [];
  if(!fs.existsSync(roots.primary)||!fs.existsSync(roots.secondary))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial ledger journal');
  const p=fs.readdirSync(roots.primary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort();
  const s=fs.readdirSync(roots.secondary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort();
  if(!same(p,s))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: journal path sets differ');
  return p.map(name=>JSON.parse(durable.verifyDualCopy(path.join(roots.primary,name),path.join(roots.secondary,name)).bytes.toString('utf8')));
}
function renderStartEntries(roots){
  if(!fs.existsSync(roots.primary)&&!fs.existsSync(roots.secondary))return [];
  if(!fs.existsSync(roots.primary)||!fs.existsSync(roots.secondary))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial render-start journal');
  const pattern=/^render-start-[0-9]{6}\.json$/,p=fs.readdirSync(roots.primary).filter(name=>pattern.test(name)).sort(),s=fs.readdirSync(roots.secondary).filter(name=>pattern.test(name)).sort();
  if(!same(p,s))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: render-start journal path sets differ');
  return p.map(name=>{const stored=durable.verifyDualCopy(path.join(roots.primary,name),path.join(roots.secondary,name));return {...JSON.parse(stored.bytes.toString('utf8')),_sha256:stored.sha256};});
}
function ensureLedgerGenesis({roots,ledger,identity,compatibilitySha256,acceptedCompatibilitySha256s=[],journalRoots,manifestSha256,proofSha256,verificationContext=null}={}){
  if(!/^[0-9a-f]{64}$/.test(compatibilitySha256||'')||!Array.isArray(acceptedCompatibilitySha256s)||
     acceptedCompatibilitySha256s.some(value=>!/^[0-9a-f]{64}$/.test(value||'')))
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: invalid ledger compatibility identity');
  const acceptedCompatibilitySha256sSet=new Set([compatibilitySha256,...acceptedCompatibilitySha256s]);
  const ledgerFile=`${ledger.phase}-ledger.json`,stored=durable.verifyDualCopy(path.join(roots.primary,ledgerFile),path.join(roots.secondary,ledgerFile));
  const genesisFile='genesis-ledger.json',genesisRecord='genesis.json';
  const ledgerPathRoots=journalRoots||ledgerJournalRoots(roots);
  const existingGenesis=path.join(ledgerPathRoots.primary,genesisFile),existingSecondary=path.join(ledgerPathRoots.secondary,genesisFile);
  if(fs.existsSync(existingGenesis)||fs.existsSync(existingSecondary)){
    if(!fs.existsSync(existingGenesis)||!fs.existsSync(existingSecondary))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial ledger genesis');
    const original=durable.verifyDualCopy(existingGenesis,existingSecondary),record=JSON.parse(durable.verifyDualCopy(path.join(ledgerPathRoots.primary,genesisRecord),path.join(ledgerPathRoots.secondary,genesisRecord)).bytes.toString('utf8'));
    if(record.genesisLedgerSha256!==original.sha256||record.manifestSha256!==manifestSha256||record.proofSha256!==proofSha256||
       !acceptedCompatibilitySha256sSet.has(record.compatibilitySha256)||record.phase!==ledger.phase||!same(record.identity,identity))
      throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: ledger genesis identity changed');
    return {sha256:original.sha256,bytes:original.bytes,roots:ledgerPathRoots,records:verificationContext?.transitionEntries||transitionEntries(ledgerPathRoots)};
  }
  const records=verificationContext?.transitionEntries||transitionEntries(ledgerPathRoots);
  if(records.length||(ledger.phase==='low'&&stored.sha256!==evidenceValidator.LOW_GENESIS_SHA256))
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: missing genesis attestation for mutable ledger');
  if(ledger.accounting?.renderCalls!==0||Object.values(ledger.cells||{}).some(cell=>cell.state!=='PENDING'))
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: low ledger is not pristine at genesis');
  immutableDualBytes(ledgerPathRoots,genesisFile,stored.bytes);
  const record={schemaVersion:1,decision:'STAGE3E_SEARCH_LEDGER_GENESIS',phase:ledger.phase,
    genesisLedgerSha256:stored.sha256,manifestSha256,proofSha256,compatibilitySha256,identity,
    authorizedCellCount:ledger.authorizedCellCount,renderCalls:0,attestedAt:new Date().toISOString()};
  immutableDualJson(ledgerPathRoots,genesisRecord,record);
  return {sha256:stored.sha256,bytes:stored.bytes,roots:ledgerPathRoots,records:[]};
}
function appendLedgerTransition({roots,ledger,cell,oldState,newState,previousRenderCount,newRenderCount,capturedCellSha256,
  manifestSha256,proofSha256,compatibilitySha256,journalRoots,renderStartMarkerSha256=null,eventType=null,
  recoveryAuthorizationSha256=null,recoveryResultSha256=null,abortEvidenceSha256=null,attemptIndex=null,abortedBeforeRenderCalls=null,oldCodeSha256=null,newCodeSha256=null,
  verificationContext=null}={}){
  const ledgerFile=`${ledger.phase}-ledger.json`,current=durable.verifyDualCopy(path.join(roots.primary,ledgerFile),path.join(roots.secondary,ledgerFile));
  const journal=journalRoots||ledgerJournalRoots(roots),entries=verificationContext?.transitionEntries||transitionEntries(journal);
  const genesisSha256=verificationContext?.genesisSha256||durable.verifyDualCopy(path.join(journal.primary,'genesis-ledger.json'),path.join(journal.secondary,'genesis-ledger.json')).sha256;
  const expectedPrevious=entries.at(-1)?.nextLedgerSha256||genesisSha256;
  const oldBytes=current.bytes,oldSha=current.sha256;
  if(verificationContext)verificationContext.assertLedgerSha(oldSha);
  if(oldSha!==expectedPrevious)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: ledger does not match journal tip before transition');
  const next=writeCellState(roots,ledger);
  const entry={schemaVersion:1,sequence:entries.length+1,previousLedgerSha256:oldSha,nextLedgerSha256:next.sha256,
    cellKey:cell.key,cellIdentity:cell,oldState,newState,previousRenderCount,newRenderCount,capturedCellSha256,
    manifestSha256,proofSha256,compatibilitySha256,transitionedAt:new Date().toISOString()};
  if(renderStartMarkerSha256)entry.renderStartMarkerSha256=renderStartMarkerSha256;
  if(eventType)entry.eventType=eventType;
  if(recoveryAuthorizationSha256)entry.recoveryAuthorizationSha256=recoveryAuthorizationSha256;
  if(abortEvidenceSha256)entry.abortEvidenceSha256=abortEvidenceSha256;
  if(recoveryResultSha256)entry.recoveryResultSha256=recoveryResultSha256;
  if(attemptIndex!==null)entry.attemptIndex=attemptIndex;
  if(abortedBeforeRenderCalls!==null)entry.abortedBeforeRenderCalls=abortedBeforeRenderCalls;
  if(oldCodeSha256)entry.oldCodeSha256=oldCodeSha256;
  if(newCodeSha256)entry.newCodeSha256=newCodeSha256;
  const name=`transition-${String(entry.sequence).padStart(6,'0')}.json`;
  const stored=immutableDualJson(journal,name,entry);
  if(verificationContext)verificationContext.recordTransition({entry,stored,previousLedgerSha256:oldSha,nextLedgerSha256:next.sha256});
  return {entry,previousLedgerSha256:oldSha,nextLedgerSha256:next.sha256,previousLedgerBytes:oldBytes};
}
function appendRenderStartMarker({journalRoots,ledger,cell,manifestSha256,proofSha256,compatibilitySha256,transition,verificationContext=null}={}){
  if(!journalRoots||!transition?.entry||transition.entry.newState!=='IN_PROGRESS')
    throw new Error('BLOCKED_STAGE3E_RENDER_START: PENDING to IN_PROGRESS journal transition is required');
  const prefix='render-start-',names=verificationContext?verificationContext.renderStartEntries:
    (fs.existsSync(journalRoots.primary)?fs.readdirSync(journalRoots.primary).filter(name=>/^render-start-[0-9]{6}\.json$/.test(name)).sort():[]);
  if(!verificationContext){
    const secondaryNames=fs.existsSync(journalRoots.secondary)?fs.readdirSync(journalRoots.secondary).filter(name=>/^render-start-[0-9]{6}\.json$/.test(name)).sort():[];
    if(!same(names,secondaryNames))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: render-start path sets differ');
  }
  const sequence=names.length+1,name=`${prefix}${String(sequence).padStart(6,'0')}.json`,marker={schemaVersion:1,kind:'STAGE3E_RENDER_START',sequence,
    cellKey:cell.key,cellIdentity:cell,ledgerSha256:transition.nextLedgerSha256,transitionSequence:transition.entry.sequence,
    transitionSha256:sha256(jsonBytes(transition.entry)),manifestSha256,proofSha256,compatibilitySha256,
    renderCallIndex:ledger.accounting.renderCalls+1,startedAt:new Date().toISOString()};
  const stored=immutableDualJson(journalRoots,name,marker);
  if(verificationContext)verificationContext.recordRenderStart({stored,marker});
  return {relativePath:name,sha256:stored.sha256,marker};
}
function validateReferenceSet(roots){return core.loadFinalizedReferenceSet(roots);}
function assertBaselineReferenceIdentity(currentSha256,expectedSha256){
  if(currentSha256!==expectedSha256)throw new Error('BLOCKED_STAGE3E_BASELINE_REFERENCE_CHANGED: finalized surrogate reference SHA changed');
  return currentSha256;
}
function renderOne(cell,response,capture){
  const effectiveResponse=response??cell.response??capture.DEFAULT_RESPONSE;
  const options=captureOptionsForCell(cell);
  if(cell.velocityNormalized!==undefined){
    const captured=capture.renderNormalized(cell.pitch,cell.velocityNormalized,effectiveResponse,options);
    return {pitch:cell.pitch,velocity:Math.round(cell.velocityNormalized*127),velocityNormalized:cell.velocityNormalized,kind:cell.kind||'search',metrics:captured.metrics};
  }
  const captured=capture.render(cell.pitch,cell.velocity,effectiveResponse,options);return {pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocity/127,kind:cell.kind||'search',metrics:captured.metrics};
}
function captureOptionsForCell(cell){
  const diagnostics=cell.pitch===41||cell.phase==='baseline';
  return {stage2mFactorMask:diagnostics?3:undefined,includeVelocityDerivative:cell.pitch===41,
    velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,includeSoundboardDiagnostics:diagnostics};
}
function capturePhaseRows({roots,ledger,cells,identity,capture= captureDefaults,render=renderOne,response,identityNow,
  now=()=>new Date().toISOString(),journalContext=null}={}){
  const verificationContext=journalContext?.verificationContext||null;
  let calls=0;
  for(const cell of cells){
    const state=ledger.cells[cell.key];
    if(!state)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: missing ledger row ${cell.key}`);
    if(state.state==='COMPLETE')continue;
    if(state.state!=='PENDING')throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key} is ${state.state}`);
    const requestedResponse=response??cell.response??capture.DEFAULT_RESPONSE;
    if(typeof capture.validateCaptureRequest==='function')
      capture.validateCaptureRequest(cell.pitch,cell.velocityNormalized??cell.velocity/127,requestedResponse,captureOptionsForCell(cell));
    else if(typeof capture.requireResponse==='function')capture.requireResponse(requestedResponse);
  }
  if(journalContext)ensureLedgerGenesis({roots,ledger,identity,...journalContext,verificationContext});
  for(const cell of cells){
    const state=ledger.cells[cell.key];if(state.state==='COMPLETE')continue;
    if(state.state!=='PENDING')throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key} is ${state.state}`);
    const current=verificationContext?verificationContext.beforeCell():identityNow();if(!sameExecutionIdentity(current,identity))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: identity drift before ${cell.key}`);
    const effectiveResponse=response??cell.response??capture.DEFAULT_RESPONSE;
    if(typeof capture.validateCaptureRequest==='function')
      capture.validateCaptureRequest(cell.pitch,cell.velocityNormalized??cell.velocity/127,effectiveResponse,captureOptionsForCell(cell));
    else if(typeof capture.requireResponse==='function')capture.requireResponse(effectiveResponse);
    if(journalContext&&(verificationContext?verificationContext.hasRenderStart(cell.key):renderStartEntries(journalContext.journalRoots).some(marker=>marker.cellKey===cell.key)))
      throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: prior render-start marker exists for ${cell.key}`);
    const previousRenderCount=ledger.accounting.renderCalls;
    state.state='IN_PROGRESS';state.startedAt=now();
    let renderStart=null;
    if(journalContext){
      const transition=appendLedgerTransition({roots,ledger,cell,oldState:'PENDING',newState:'IN_PROGRESS',
        previousRenderCount,newRenderCount:previousRenderCount,capturedCellSha256:null,...journalContext,verificationContext});
      renderStart=appendRenderStartMarker({journalRoots:journalContext.journalRoots,ledger,cell,...journalContext,transition,verificationContext});
    }else writeCellState(roots,ledger);
    const measured=render(cell,effectiveResponse,capture);const row={schemaVersion:1,cellKey:cell.key,cell,identity,pitch:measured.pitch,velocity:measured.velocity,velocityNormalized:measured.velocityNormalized,kind:measured.kind,metrics:measured.metrics,capturedAt:now()};
    const bytes=jsonBytes(row),sha=durable.writeDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath),bytes);
    if(verificationContext)verificationContext.recordCell({cell,state,stored:sha});
    state.state='COMPLETE';state.sha256=sha.sha256;state.completedAt=now();ledger.accounting.renderCalls++;calls++;
    if(journalContext)appendLedgerTransition({roots,ledger,cell,oldState:'IN_PROGRESS',newState:'COMPLETE',
      previousRenderCount,newRenderCount:ledger.accounting.renderCalls,capturedCellSha256:sha.sha256,
      renderStartMarkerSha256:renderStart?.sha256,...journalContext,verificationContext});
    else writeCellState(roots,ledger);
    if(verificationContext)verificationContext.addCompletedCell({ledger});
  }
  return {ledger,calls,counts:ledgerCounts(ledger)};
}
function readCompletedRows(roots,ledger,cells){return cells.map(cell=>{const state=ledger.cells[cell.key];if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: incomplete ${cell.key}`);const stored=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(stored.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: SHA mismatch ${cell.key}`);return JSON.parse(stored.bytes.toString('utf8'));});}
function finalizePhase({roots,phase,identity,ledger,decision,result,now=()=>new Date().toISOString()}={}){
  const counts=ledgerCounts(ledger);
  if(counts.PENDING!==0||counts.IN_PROGRESS!==0||counts.COMPLETE!==ledger.authorizedCellCount)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: cannot finalize ${phase} while cells are incomplete`);
  const existing=loadResult(roots,phase,identity);
  if(existing){
    if(existing.decision!==decision||existing.cellCount!==ledger.authorizedCellCount||existing.renderCalls!==ledger.accounting.renderCalls||!same(existing.result,result))
      throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: finalized ${phase} result changed`);
    durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:ledger.startedAt||existing.finalizedAt,finalizedAt:existing.finalizedAt,decision}});
    const archive=durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase});
    return {...existing,archiveSha256:archive.sha256};
  }
  const output={schemaVersion:1,generation:2,phase,decision,identity,cellCount:ledger.authorizedCellCount,renderCalls:ledger.accounting.renderCalls,ledgerSha256:durable.verifyDualCopy(path.join(roots.primary,`${phase}-ledger.json`),path.join(roots.secondary,`${phase}-ledger.json`)).sha256,result,finalizedAt:now(),productionCandidateDelta:0,stage4Renders:0};
  immutableDualJson(roots,`${phase}-result.json`,output);
  durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:ledger.startedAt||output.finalizedAt,finalizedAt:output.finalizedAt,decision}});
  const archive=durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase});
  return {...output,archiveSha256:archive.sha256};
}
function loadResult(roots,phase,identity){
  const a=path.join(roots.primary,`${phase}-result.json`),b=path.join(roots.secondary,`${phase}-result.json`);if(!fs.existsSync(a)&&!fs.existsSync(b))return null;
  if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: partial ${phase} result`);
  const result=readDualJson(roots,`${phase}-result.json`);if(!same(result.identity,identity))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: ${phase} result identity mismatch`);return result;
}
function assertFinalizedRootReadOnly(roots,archiveName){
  const primaryManifest=path.join(roots.primary,'evidence-manifest.json'),secondaryManifest=path.join(roots.secondary,'evidence-manifest.json');
  const primaryHash=path.join(roots.primary,'evidence-manifest.sha256'),secondaryHash=path.join(roots.secondary,'evidence-manifest.sha256');
  const manifest=durable.verifyDualCopy(primaryManifest,secondaryManifest);
  if(fs.readFileSync(primaryHash,'utf8')!==`${manifest.sha256}\n`||fs.readFileSync(secondaryHash,'utf8')!==`${manifest.sha256}\n`)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: finalized manifest hash mismatch');
  const value=JSON.parse(manifest.bytes.toString('utf8'));
  const current=durable.assertMatchingInventory(roots.primary,roots.secondary);
  if(!same(value.files,current))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: finalized inventory drift');
  return durable.verifyDualCopy(path.join(roots.primary,'archives',archiveName),path.join(roots.secondary,'archives',archiveName));
}
function baselineCells(){
  return [...legacy.BASELINE_EQUIVALENCE_CELLS.map(([pitch,velocity])=>({kind:'production',pitch,velocity,velocityNormalized:velocity/127})),...legacy.MIDI41_NORMALIZED.map(velocityNormalized=>({kind:'stage3a',pitch:41,velocity:Math.round(velocityNormalized*127),velocityNormalized}))];
}
function buildFixtureMap(root){return core.loadReferenceFixture(root);}
function makeResponse(tuple){return {low:tuple.low,mid:tuple.mid,bassHardness:tuple.bassHardness};}
function lowCandidateScreenCells(tuple){return [...legacy.lowScreenCells()].map(cell=>({...cell,response:{low:tuple.low,mid:1,bassHardness:tuple.bassHardness}}));}
function midCandidateScreenCells(tuple){return [...legacy.midScreenCells()].map(cell=>({...cell,response:{low:tuple.low,mid:tuple.mid,bassHardness:tuple.bassHardness}}));}
function fullCellsFor(tuple,pitches,phase){return [...legacy.gridCells(pitches,OFFICIAL_VELOCITIES)].map(cell=>({...cell,phase,response:{...tuple}}));}
function fullLowCells(tuple){return [...fullCellsFor(tuple,[33,36,39,42,45],'low-full'),...legacy.MIDI41_NORMALIZED.map(velocityNormalized=>({phase:'low-full',pitch:41,velocity:Math.round(velocityNormalized*127),velocityNormalized,response:{...tuple}}))];}
function validateCaptureCells(cells,capture=captureDefaults){
  if(typeof capture?.validateCaptureRequest!=='function')throw new Error('BLOCKED_STAGE3E_CAPTURE_PREFLIGHT: pure capture request validator is unavailable');
  for(const cell of cells){
    const response=cell.response??capture.DEFAULT_RESPONSE;
    capture.validateCaptureRequest(cell.pitch,cell.velocityNormalized??cell.velocity/127,response,captureOptionsForCell(cell));
  }
  return cells.length;
}
function validateAuthorizedSearchResponses(capture=captureDefaults){
  let lowCount=0,lowFullCandidateCellCount=0,midCount=0,midFullCandidateCellCount=0;
  for(const tuple of legacy.lowGridTuples()){
    lowCount+=validateCaptureCells(lowCandidateScreenCells(tuple),capture);
    lowFullCandidateCellCount+=validateCaptureCells(cellSpecs(`low-full-${tuple.low}-${tuple.bassHardness}`,
      fullLowCells({low:tuple.low,mid:1,bassHardness:tuple.bassHardness})),capture);
  }
  for(const low of legacy.lowGridTuples())for(const mid of legacy.MID_GRID){
    const tuple={low:low.low,mid,bassHardness:low.bassHardness};
    midCount+=validateCaptureCells(midCandidateScreenCells(tuple),capture);
    midFullCandidateCellCount+=validateCaptureCells(cellSpecs(`mid-full-${mid}`,
      fullCellsFor(tuple,[48,51,54,57],`mid-full-${mid}`)),capture);
  }
  return {lowCount,lowFullCandidateCellCount,midCount,midFullCandidateCellCount};
}
function candidateSummary(rows,tuple,fixture,kind){return kind==='low'?core.lowScreenResult(tuple,rows,fixture):core.midScreenResult(tuple,rows,fixture);}
function evidencePreflight({root=ROOT,home=process.env.HOME}={}){
  return searchPreflight.preflight({root,home,verifySourceAudit:midi41Amendment.assertSourceAudit,verifyAmendment:midi41Amendment.verify});
}
function phaseIdentity(identity,phase,referenceSetSha256,extra={}){return { ...identity,phase,referenceSetSha256,...extra};}
function lowPhaseIdentity(identity,referenceSetSha256){return phaseIdentity(identity,'low',referenceSetSha256,{authorizedGrid:legacy.lowGridTuples(),screenCoordinates:legacy.lowScreenCells()});}
function midPhaseIdentity(identity,referenceSetSha256,selected){return phaseIdentity(identity,'mid',referenceSetSha256,{authorizedGrid:legacy.midGridTuples(selected),screenCoordinates:legacy.midScreenCells(),lowSelection:selected});}
function writeReferenceComparison(roots,result,now){
  const phase='baseline';const cells=cellSpecs(phase,baselineCells());
  const identity=phaseIdentity(result.identity,phase,result.referenceSetSha256,{response:captureDefaults.DEFAULT_RESPONSE,tolerance:TOLERANCE});
  const ledger=loadLedger(phaseRoots(roots,phase),phase,identity,cells,{create:false});
  const rows=readCompletedRows(phaseRoots(roots,phase),ledger,cells);
  const comparison=core.validateBaselineRows(result.referenceSet,rows,{tolerance:TOLERANCE});
  if(!comparison.pass)throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');
  return finalizePhase({roots:phaseRoots(roots,phase),phase,identity,ledger,decision:'STAGE3E_BASELINE_EQUIVALENCE_PASS',result:comparison,now});
}
function assertBaselined(roots,identity,amendmentEvidence){
  const evidence=amendmentEvidence||midi41Amendment.verify({root:ROOT});
  if(evidence.resultSha256!==identity.midi41AmendmentResultSha256||evidence.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||
     evidence.result?.effectivePassCount!==12||evidence.result?.effectiveCellCount!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: MIDI41 amendment result is absent or changed');
  return evidence.result;
}
function runBaseline({roots,identity,referenceSet,capture,preflight,identityNow,render,now}){
  throw new Error('BLOCKED_STAGE3E_BASELINE_CAPTURE_RETIRED: immutable 12-cell Gen2 baseline cannot be rerendered; use the finalized MIDI41 amendment overlay');
}
function screenLedgerRows(roots,phase,identity,cells,capture,response,identityNow,now,render=renderOne,compatibilitySha256,historicalCompatibilitySha256){
  const pr=phaseRoots(roots,phase),isExistingLowScreen=phase==='low';
  const ledger=loadLedger(pr,phase,identity,cells,{create:!isExistingLowScreen});
  const journalRoots=isExistingLowScreen?ledgerJournalRoots(roots):ledgerJournalRoots(pr);
  const phaseRootRelative=path.relative(roots.primary,pr.primary).split(path.sep).join('/');
  const journalRootRelative=path.relative(roots.primary,journalRoots.primary).split(path.sep).join('/');
  if(!phaseRootRelative||phaseRootRelative==='..'||phaseRootRelative.startsWith('../')||!journalRootRelative||journalRootRelative==='..'||journalRootRelative.startsWith('../'))
    throw new Error('BLOCKED_STAGE3E_VERIFICATION_CHECKPOINT: phase/journal roots escape search-v1');
  const journalContext={journalRoots,manifestSha256:searchPreflight.MANIFEST_SHA256,proofSha256:searchPreflight.PROOF_SHA256,
    compatibilitySha256,acceptedCompatibilitySha256s:historicalCompatibilitySha256?[historicalCompatibilitySha256]:[]};
  const ledgerFile=`${phase}-ledger.json`,ledgerPath=durable.verifyDualCopy(path.join(pr.primary,ledgerFile),path.join(pr.secondary,ledgerFile));
  const priorTransitions=transitionEntries(journalRoots),priorMarkers=renderStartEntries(journalRoots);
  let verificationContext=null;
  const fullAudit=()=>{
    const observed=identityNow();
    if(!sameExecutionIdentity(observed,identity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: runtime identity drift during phase');
    return identity;
  };
  const readCurrentState=()=>{
    const live=durable.verifyDualCopy(path.join(pr.primary,ledgerFile),path.join(pr.secondary,ledgerFile));
    const currentLedger=JSON.parse(live.bytes.toString('utf8'));
    const transitions=verificationContext?.transitionEntries||priorTransitions;
    const tip=transitions.at(-1);
    const tipStored=tip?
      durable.verifyDualCopy(path.join(journalRoots.primary,`transition-${String(tip.sequence).padStart(6,'0')}.json`),path.join(journalRoots.secondary,`transition-${String(tip.sequence).padStart(6,'0')}.json`)):
      durable.verifyDualCopy(path.join(journalRoots.primary,'genesis-ledger.json'),path.join(journalRoots.secondary,'genesis-ledger.json'));
    const counts=ledgerCounts(currentLedger);
    if(counts.IN_PROGRESS!==0)throw new Error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: IN_PROGRESS during verification checkpoint');
    return {ledgerSha256:live.sha256,journalTipSequence:tip?.sequence||0,journalTipSha256:tipStored.sha256,
      completeCount:counts.COMPLETE,renderCalls:currentLedger.accounting?.renderCalls};
  };
  const currentLedgerSha=ledgerPath.sha256;
  verificationContext=incrementalVerification.createPhaseVerificationContext({phase,executionId:EXECUTION_ID,identity,
    searchRoots:roots,phaseRoots:pr,journalRoots,phaseRootRelative,journalRootRelative,ledger,ledgerSha256:currentLedgerSha,
    transitionEntries:priorTransitions,renderStartEntries:priorMarkers,manifestSha256:searchPreflight.MANIFEST_SHA256,
    proofSha256:searchPreflight.PROOF_SHA256,compatibilitySha256,fullAudit,readCurrentState,now});
  journalContext.verificationContext=verificationContext;
  capturePhaseRows({roots:pr,ledger,cells,identity,capture,response,identityNow,now,render,journalContext});
  const rows=readCompletedRows(pr,ledger,cells),verification=verificationContext.finish(ledger);
  return {ledger,rows,verification};
}
function executeLow({roots,identity,referenceSet,capture,identityNow,render,now,amendmentEvidence,compatibilitySha256,historicalCompatibilitySha256}){
  assertBaselined(roots,identity,amendmentEvidence);
  const fixture=buildFixtureMap(ROOT),screenRows=[];
  const tuples=legacy.lowGridTuples();
  const screenCells=tuples.flatMap(tuple=>lowCandidateScreenCells(tuple));
  validateCaptureCells(screenCells,capture);
  for(const tuple of tuples)validateCaptureCells(cellSpecs(`low-full-${tuple.low}-${tuple.bassHardness}`,
    fullLowCells({low:tuple.low,mid:1,bassHardness:tuple.bassHardness})),capture);
  const screenId=lowPhaseIdentity(identity,referenceSet.sha256);
  const existing=loadResult(phaseRoots(roots,'low'),'low',screenId);if(existing)return existing;
  const screen=screenLedgerRows(roots,'low',screenId,cellSpecs('low-screen',screenCells),capture,null,identityNow,now,render,compatibilitySha256,historicalCompatibilitySha256);
  const screenByTuple=new Map();for(const row of screen.rows){const key=`${row.cell.response.low}:${row.cell.response.bassHardness}`;if(!screenByTuple.has(key))screenByTuple.set(key,[]);screenByTuple.get(key).push(row);}
  for(const tuple of tuples){const rows=screenByTuple.get(`${tuple.low}:${tuple.bassHardness}`)||[];screenRows.push(candidateSummary(rows,tuple,fixture,'low'));}
  const ranked=legacy.rankLowCandidates(screenRows),top=legacy.topFive(ranked);let selected=null;const fullResults=[];let fullCalls=0;
  for(const candidate of top){
    const tuple={low:candidate.low,mid:1,bassHardness:candidate.bassHardness};const cells=cellSpecs(`low-full-${candidate.low}-${candidate.bassHardness}`,fullLowCells(tuple));
    const phase=cells[0]?.phase||`low-full-${candidate.low}-${candidate.bassHardness}`;
    const phaseId=phaseIdentity(identity,phase,referenceSet.sha256,{response:tuple,lowScreenResultSha256:sha256(jsonBytes(candidate))});
    const full=screenLedgerRows(roots,phase,phaseId,cells,capture,makeResponse(tuple),identityNow,now,render,compatibilitySha256,historicalCompatibilitySha256);fullCalls+=full.ledger.accounting.renderCalls;
    const evaluation=core.validateLowFullRows(full.rows,fixture);fullResults.push({tuple,pass:evaluation.pass,pitchDiagnostics:{derivatives:evaluation.derivatives,brightness:evaluation.brightness},directEvaluation:evaluation.evaluation});
    immutableDualJson(phaseRoots(roots,phase),`${phase}-validation.json`,{identity:phaseId,evaluation:fullResults.at(-1)});
    finalizePhase({roots:phaseRoots(roots,phase),phase,identity:phaseId,ledger:full.ledger,
      decision:evaluation.pass?'STAGE3E_LOW_CANDIDATE_FULL_PASS':'STAGE3E_LOW_CANDIDATE_FULL_FAIL',result:fullResults.at(-1),now});
    if(evaluation.pass){selected={...tuple,rank:{rankMaxError:candidate.rankMaxError,rankSumSquares:candidate.rankSumSquares}};break;}
  }
  const decision=selected?'STAGE3E_LOW_RESPONSE_FAMILY_PASS':'BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY';
  const result={identity:screenId,decision,selected,screenCandidateCount:tuples.length,rankedCandidates:ranked.map(({low,bassHardness,rankMaxError,rankSumSquares})=>({low,bassHardness,rankMaxError,rankSumSquares})),fullyValidated:fullResults,topFiveCount:top.length,searchRenderCalls:screen.ledger.accounting.renderCalls+fullCalls};
  const aggregatePhaseRoots=phaseRoots(roots,'low');
  immutableDualJson(aggregatePhaseRoots,'low-result.json',result);
  // The screen and each candidate full validation are separately immutable; this archive binds their current inventories.
  durable.writeFinalizedManifest({primaryRoot:aggregatePhaseRoots.primary,secondaryRoot:aggregatePhaseRoots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:screen.ledger.startedAt||now(),finalizedAt:now(),decision}});
  const archive=durable.createPhaseArchive({primaryRoot:aggregatePhaseRoots.primary,secondaryRoot:aggregatePhaseRoots.secondary,phase:'low-selection'});
  if(!selected)throw new Error('BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY');
  return {...result,archiveSha256:archive.sha256};
}
function executeMid({roots,identity,referenceSet,capture,identityNow,render,now,amendmentEvidence,compatibilitySha256,historicalCompatibilitySha256}){
  assertBaselined(roots,identity,amendmentEvidence);
  const low=readDualJson(phaseRoots(roots,'low'),'low-result.json');
  const expectedLowId=lowPhaseIdentity(identity,referenceSet.sha256);
  if(!same(low.identity,expectedLowId)||low.decision!=='STAGE3E_LOW_RESPONSE_FAMILY_PASS'||!low.selected)throw new Error('BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY');
  const fixture=buildFixtureMap(ROOT),tuples=legacy.midGridTuples(low.selected),screenCells=tuples.flatMap(tuple=>midCandidateScreenCells(tuple));
  validateCaptureCells(screenCells,capture);
  for(const tuple of tuples)validateCaptureCells(cellSpecs(`mid-full-${tuple.mid}`,
    fullCellsFor({low:low.selected.low,mid:tuple.mid,bassHardness:low.selected.bassHardness},[48,51,54,57],`mid-full-${tuple.mid}`)),capture);
  const screenId=midPhaseIdentity(identity,referenceSet.sha256,low.selected);
  const existing=loadResult(phaseRoots(roots,'mid'),'mid',screenId);if(existing)return existing;
  const screen=screenLedgerRows(roots,'mid',screenId,cellSpecs('mid-screen',screenCells),capture,null,identityNow,now,render,compatibilitySha256,historicalCompatibilitySha256);
  const grouped=new Map();for(const row of screen.rows){const key=String(row.cell.response.mid);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
  const scored=tuples.map(tuple=>candidateSummary(grouped.get(String(tuple.mid))||[],tuple,fixture,'mid'));
  const ranked=legacy.rankMidCandidates(scored),top=legacy.topFive(ranked);let selected=null;const fullResults=[];let fullCalls=0;
  for(const candidate of top){
    const tuple={low:low.selected.low,mid:candidate.mid,bassHardness:low.selected.bassHardness};const phase=`mid-full-${candidate.mid}`;
    const cells=cellSpecs(phase,fullCellsFor(tuple,[48,51,54,57],phase));
    const phaseId=phaseIdentity(identity,phase,referenceSet.sha256,{response:tuple,midScreenResultSha256:sha256(jsonBytes(candidate))});
    const full=screenLedgerRows(roots,phase,phaseId,cells,capture,makeResponse(tuple),identityNow,now,render,compatibilitySha256,historicalCompatibilitySha256);fullCalls+=full.ledger.accounting.renderCalls;
    const evaluation=core.validateFullRows(full.rows,{pitches:[48,51,54,57],fixture});fullResults.push({tuple,pass:evaluation.pass,directEvaluation:evaluation.evaluation});
    immutableDualJson(phaseRoots(roots,phase),`${phase}-validation.json`,{identity:phaseId,evaluation:fullResults.at(-1)});
    finalizePhase({roots:phaseRoots(roots,phase),phase,identity:phaseId,ledger:full.ledger,
      decision:evaluation.pass?'STAGE3E_MID_CANDIDATE_FULL_PASS':'STAGE3E_MID_CANDIDATE_FULL_FAIL',result:fullResults.at(-1),now});
    if(evaluation.pass){selected={...tuple,rank:{rankMaxError:candidate.rankMaxError,rankSumSquares:candidate.rankSumSquares}};break;}
  }
  const decision=selected?'STAGE3E_MID_RESPONSE_FAMILY_PASS':'BLOCKED_STAGE3E_MID_RESPONSE_FAMILY';
  const result={identity:screenId,decision,selected,lowSelection:low.selected,screenCandidateCount:tuples.length,rankedCandidates:ranked.map(({mid,rankMaxError,rankSumSquares})=>({mid,rankMaxError,rankSumSquares})),fullyValidated:fullResults,topFiveCount:top.length,searchRenderCalls:screen.ledger.accounting.renderCalls+fullCalls};
  const aggregate=phaseRoots(roots,'mid');immutableDualJson(aggregate,'mid-result.json',result);
  durable.writeFinalizedManifest({primaryRoot:aggregate.primary,secondaryRoot:aggregate.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:screen.ledger.startedAt||now(),finalizedAt:now(),decision}});
  const archive=durable.createPhaseArchive({primaryRoot:aggregate.primary,secondaryRoot:aggregate.secondary,phase:'mid-selection'});
  if(!selected)throw new Error('BLOCKED_STAGE3E_MID_RESPONSE_FAMILY');return {...result,archiveSha256:archive.sha256};
}
function dryRun({root=ROOT,home=process.env.HOME,evidenceRoot=process.env.SORAOTO_STAGE3E_EVIDENCE_ROOT,preflight=evidencePreflight,amendmentCheck=midi41Amendment.verify,capture=captureDefaults}={}){
  const readiness=preflight({root,home});legacy.assertGeneration1Abandoned(root);const refs=validateReferenceSet(historicalRoots(root,home));const roots=getGeneration2Roots({root,home,evidenceRoot});
  const amendment=amendmentCheck({root,home});
  if(amendment.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendment.result?.effectivePassCount!==12||amendment.result?.effectiveCellCount!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: MIDI41 amendment is not finalized 12/12');
  const prior=durable.verifyDualCopy(path.join(generationRoots(root,home).primary,'generation-2-manifest.json'),path.join(generationRoots(root,home).secondary,'generation-2-manifest.json'));
  const identity=readiness?.creatorIdentity||currentGenerationIdentity({root,referenceSetSha256:refs.sha256,midi41AmendmentResultSha256:amendment.resultSha256,
    historicalGeneration2ManifestSha256:prior.sha256});
  const manifestFile=path.join(roots.primary,'generation-2-manifest.json');
  if(fs.existsSync(manifestFile))assertExistingGenerationManifest(roots,identity);
  const capturePreflight=validateAuthorizedSearchResponses(capture);
  return {decision:'GENERATION2_SEARCH_READY',builds:0,renders:0,acousticRenders:0,generation:2,searchEpoch:'search-v1',
    baselineRowsReused:12,baselineRenders:0,midi41AmendmentDecision:amendment.result.decision,midi41AmendmentResultSha256:amendment.resultSha256,
    historicalGeneration2ManifestSha256:prior.sha256,lowGridCandidates:legacy.lowGridTuples().length,midCandidates:legacy.MID_GRID.length,
    preflightValidatedLowScreenRows:capturePreflight.lowCount,preflightValidatedMidScreenRows:capturePreflight.midCount,
    historicalReferenceSetSha256:refs.sha256,activeSearchRoot:roots.primary,identity,searchEnabled:true};
}
function run({mode,root=ROOT,home=process.env.HOME,evidenceRoot=process.env.SORAOTO_STAGE3E_EVIDENCE_ROOT,preflight=evidencePreflight,capture=captureDefaults,render=renderOne,now=()=>new Date().toISOString(),amendmentCheck=midi41Amendment.verify}={}){
  const allowed=['--dry-run','--baseline','--low','--mid','--finalize'];if(!allowed.includes(mode))throw new Error(`explicit Generation-2 mode required: ${allowed.join(' or ')}`);
  if(mode==='--baseline')throw new Error('BLOCKED_STAGE3E_BASELINE_CAPTURE_RETIRED: no Generation-2 baseline rerender is authorized');
  if(mode==='--dry-run')return dryRun({root,home,evidenceRoot,preflight,amendmentCheck,capture});
  const readiness=preflight({root,home});legacy.assertGeneration1Abandoned(root);
  const refs=validateReferenceSet(historicalRoots(root,home)),roots=getGeneration2Roots({root,home,evidenceRoot});
  const amendment=amendmentCheck({root,home});
  if(amendment.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendment.result?.effectivePassCount!==12||amendment.result?.effectiveCellCount!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: MIDI41 amendment is not finalized 12/12');
  const historicalRootsSet=generationRoots(root,home),historicalManifest=durable.verifyDualCopy(path.join(historicalRootsSet.primary,'generation-2-manifest.json'),path.join(historicalRootsSet.secondary,'generation-2-manifest.json'));
  const protectedIdentity=legacy.currentProtectedIdentity(root),identity=readiness?.creatorIdentity||currentGenerationIdentity({root,referenceSetSha256:refs.sha256,protectedIdentity,
    midi41AmendmentResultSha256:amendment.resultSha256,historicalGeneration2ManifestSha256:historicalManifest.sha256});
  if(mode==='--low'||mode==='--mid')assertGenerationManifest(roots,identity,now);else assertExistingGenerationManifest(roots,identity);
  const identityNow=()=>{
    const validated=searchPreflight.validateRuntimeIdentity({root,home,manifestIdentity:identity,
      compatibilitySha256:readiness?.compatibilitySha256,
      performanceVerifierCompatibilitySha256:readiness?.performanceVerifierCompatibilitySha256,
      verifySourceAudit:midi41Amendment.assertSourceAudit,verifyAmendment:amendmentCheck});
    if(validated.compatibilitySha256!==readiness?.compatibilitySha256)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: compatibility identity changed');
    if(validated.performanceVerifierCompatibilitySha256!==readiness?.performanceVerifierCompatibilitySha256)
      throw new Error('BLOCKED_STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY: performance verifier identity changed');
    if(validated.recoveryReconciliationCompatibilitySha256!==readiness?.recoveryReconciliationCompatibilitySha256)
      throw new Error('BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COMPATIBILITY: reconciliation verifier identity changed');
    return identity;
  };
  let writerLock=null;
  if(mode!=='--dry-run')writerLock=searchPreflight.acquireWriterLock({root,phase:mode.slice(2),executionIdentity:sha256(jsonBytes(identity))});
  try{
  if(mode==='--low')return executeLow({roots,identity,referenceSet:refs,capture,identityNow,render,now,amendmentEvidence:amendment,
    compatibilitySha256:readiness?.compatibilitySha256,historicalCompatibilitySha256:readiness?.historicalCompatibilitySha256});
  if(mode==='--mid'){
    const result=executeMid({roots,identity,referenceSet:refs,capture,identityNow,render,now,amendmentEvidence:amendment,
      compatibilitySha256:readiness?.compatibilitySha256,historicalCompatibilitySha256:readiness?.historicalCompatibilitySha256});
    if(result.selected){
      const selectedRoots=phaseRoots(roots,'stage3e-selection');
      const selection={schemaVersion:1,decision:'STAGE3E_SELECTED_RESPONSE',identity,selected:result.selected,
        lowResultSha256:durable.verifyDualCopy(path.join(phaseRoots(roots,'low').primary,'low-result.json'),path.join(phaseRoots(roots,'low').secondary,'low-result.json')).sha256,
        midResultSha256:durable.verifyDualCopy(path.join(phaseRoots(roots,'mid').primary,'mid-result.json'),path.join(phaseRoots(roots,'mid').secondary,'mid-result.json')).sha256,productionCandidateDelta:0};
      immutableDualJson(selectedRoots,'selection.json',selection);
      const stored=readDualJson(selectedRoots,'selection.json');
      durable.writeFinalizedManifest({primaryRoot:selectedRoots.primary,secondaryRoot:selectedRoots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:now(),finalizedAt:now(),decision:stored.decision}});
      durable.createPhaseArchive({primaryRoot:selectedRoots.primary,secondaryRoot:selectedRoots.secondary,phase:'stage3e-selection'});
      durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:now(),finalizedAt:now(),decision:stored.decision}});
      durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase:'stage3e-selection'});
    }
    return result;
  }
  // Read-only replay after status commits. Never creates a ledger or performs a render.
  const baseline=assertBaselined(roots,identity),low=readDualJson(phaseRoots(roots,'low'),'low-result.json'),mid=readDualJson(phaseRoots(roots,'mid'),'mid-result.json');
  if(!same(low.identity,lowPhaseIdentity(identity,refs.sha256))||!low.selected)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: low selection identity mismatch');
  if(low.decision!=='STAGE3E_LOW_RESPONSE_FAMILY_PASS'||mid.decision!=='STAGE3E_MID_RESPONSE_FAMILY_PASS')throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: selected low/mid result is incomplete');
  if(!same(mid.identity,midPhaseIdentity(identity,refs.sha256,low.selected))||!mid.selected)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: mid selection identity mismatch');
  const selectedRoots=phaseRoots(roots,'stage3e-selection'),selection=readDualJson(selectedRoots,'selection.json');
  if(selection.decision!=='STAGE3E_SELECTED_RESPONSE'||!same(selection.identity,identity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: missing or changed final selection');
  const selectedResultSha=durable.verifyDualCopy(path.join(selectedRoots.primary,'selection.json'),path.join(selectedRoots.secondary,'selection.json')).sha256;
  if(!selection.selected||selection.lowResultSha256!==durable.verifyDualCopy(path.join(phaseRoots(roots,'low').primary,'low-result.json'),path.join(phaseRoots(roots,'low').secondary,'low-result.json')).sha256
      ||selection.midResultSha256!==durable.verifyDualCopy(path.join(phaseRoots(roots,'mid').primary,'mid-result.json'),path.join(phaseRoots(roots,'mid').secondary,'mid-result.json')).sha256)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: final selection bindings changed');
  assertFinalizedRootReadOnly(selectedRoots,'stage3e-selection.tar.gz');
  assertFinalizedRootReadOnly(roots,'stage3e-selection.tar.gz');
  return {decision:'STAGE3E_SELECTION_READY_FOR_PRODUCTION_PREFLIGHT',builds:0,renders:0,acousticRenders:0,baseline,low,mid,selection,selectionSha256:selectedResultSha};
  }finally{if(writerLock)writerLock.release();}
}
function main(argv=process.argv.slice(2)){if(argv.length!==1)throw new Error('one explicit mode is required');const result=run({mode:argv[0]});process.stdout.write(JSON.stringify(result)+'\n');}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={ROOT,EXECUTION_ID,TOLERANCE,LOW_SCREEN_VELOCITIES,MID_SCREEN_VELOCITIES,OFFICIAL_VELOCITIES,sha256,jsonBytes,stable,same,sameExecutionIdentity,cellId,historicalRoots,generationRoots,phaseRoots,readDualJson,writeDualJson,immutableDualJson,getGeneration2Roots,currentGenerationIdentity,assertGenerationManifest,cellSpecs,freshCellLedger,ledgerCounts,loadLedger,writeCellState,ledgerJournalRoots,transitionEntries,renderStartEntries,ensureLedgerGenesis,appendLedgerTransition,appendRenderStartMarker,validateReferenceSet,assertBaselineReferenceIdentity,renderOne,captureOptionsForCell,capturePhaseRows,readCompletedRows,finalizePhase,loadResult,screenLedgerRows,baselineCells,buildFixtureMap,makeResponse,lowCandidateScreenCells,midCandidateScreenCells,fullCellsFor,fullLowCells,candidateSummary,validateCaptureCells,validateAuthorizedSearchResponses,phaseIdentity,lowPhaseIdentity,midPhaseIdentity,runBaseline,executeLow,executeMid,dryRun,run,main};
