'use strict';

// Pure identity, journal, safety, and screen-analysis helpers for Issue #9.
// This module deliberately has no runner or renderer imports.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const search=require('./stage3e-search-core.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');
const durable=require('./durable-evidence.cjs');

const SCHEMA_VERSION=1;
const ISSUE=9;
const PHASE='mid055-screen';
const NAMESPACE='generation-2/diagnostics/mid-0.55-screen-v1';
const PARENT_MANIFEST_SHA256='27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095';
const V14_ATTESTATION_SHA256='f913fb5597c584c293e0106c50242ead507bf52f1e32097543c9f1c6b25771f1';
const V14_ACCEPTED_COMMIT='f3abab2d5999f86e959e2c5e57a09bddc2a8adbe';
const SAMPLE_RATE=48000;
const BLOCK=2048;
const DURATION_MS=380;
const RESPONSE=Object.freeze({low:0.35,mid:0.55,bassHardness:0.5});
const CONTROL_RESPONSE=Object.freeze({low:0.35,mid:0.60,bassHardness:0.5});
const PITCHES=Object.freeze([48,51,54,57]);
const VELOCITIES=Object.freeze([14,61,124]);
const ATTEMPT_LIMIT=12;
const FILES=Object.freeze({authorization:'authorization.json',manifest:'diagnostic-manifest.json',ledger:'diagnostic-ledger.json',
  result:'result.json',genesis:'ledger-transition-journal/genesis.json',genesisLedger:'ledger-transition-journal/genesis-ledger.json',
  evidenceManifest:'evidence-manifest.json',evidenceManifestSha:'evidence-manifest.sha256',
  archive:'archives/mid-0.55-screen-v1.tar.gz'});
const DECISIONS=Object.freeze({improved:'SCREEN_IMPROVED_FULL_VALIDATION_DECISION_REQUIRED',
  unchanged:'SCREEN_NO_SUPPORTED_PROMOTION',blocked:'BLOCKED_DIAGNOSTIC'});

function fail(message,code='BLOCKED_DIAGNOSTIC'){
  const error=new Error(`${code}: ${message}`);error.code=code;throw error;
}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function exactCells(){
  return PITCHES.flatMap(pitch=>VELOCITIES.map(velocity=>{
    const cell={phase:PHASE,response:{...RESPONSE},pitch,velocity,velocityNormalized:velocity/127};
    return {...cell,key:search.cellId(cell),relativePath:`cells/${search.cellId(cell)}.json`};
  }));
}
function captureOptionsForCell(cell){
  const diagnostics=cell.pitch===41||cell.phase==='baseline';
  return {stage2mFactorMask:diagnostics?3:undefined,includeVelocityDerivative:cell.pitch===41,
    velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,includeSoundboardDiagnostics:diagnostics};
}
function expectedCaptureIdentity(searchIdentity,cells=exactCells()){
  return {captureHelperSha256:searchIdentity?.captureHelperSha256,
    diagnosticWasmSha256:searchIdentity?.protectedIdentity?.diagnosticWasmSha256,
    sampleRate:SAMPLE_RATE,block:BLOCK,durationMs:DURATION_MS,response:{...RESPONSE},
    cellOptions:cells.map(cell=>({key:cell.key,options:captureOptionsForCell(cell)}))};
}
function validateCells(cells){
  const expected=exactCells();
  if(!Array.isArray(cells)||cells.length!==ATTEMPT_LIMIT)fail('exactly twelve diagnostic cell identities are required','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  for(let i=0;i<expected.length;i++){
    const actual=cells[i],want=expected[i];
    if(!actual||actual.key!==want.key||actual.relativePath!==want.relativePath||actual.phase!==PHASE||
       actual.pitch!==want.pitch||actual.velocity!==want.velocity||actual.velocityNormalized!==want.velocityNormalized||
       !same(actual.response,RESPONSE))
      fail(`diagnostic cell order or identity mismatch at index ${i}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    const allowed=new Set(['phase','response','pitch','velocity','velocityNormalized','key','relativePath','captureOptions']);
    if(Object.keys(actual).some(key=>!allowed.has(key)))fail(`unexpected diagnostic cell field for ${want.key}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    if(actual.captureOptions!==undefined&&!same(actual.captureOptions,captureOptionsForCell(want)))
      fail(`capture options differ from the existing screen identity for ${want.key}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  }
  return expected;
}
function freshLedger(cells=exactCells(),{executionId,manifestSha256,sourceCommit,createdAt}={}){
  validateCells(cells);
  return {schemaVersion:SCHEMA_VERSION,kind:'ISSUE9_MID055_DIAGNOSTIC_LEDGER',issue:ISSUE,phase:PHASE,
    executionId,manifestSha256,sourceCommit,attemptCount:0,transitionCount:0,createdAt,
    cells:cells.map(cell=>({identity:cell,relativePath:cell.relativePath,state:'PENDING',sha256:null,attempt:null}))};
}
function ledgerCounts(ledger){
  const counts={PENDING:0,IN_PROGRESS:0,COMPLETE:0};
  for(const row of ledger?.cells||[])if(Object.hasOwn(counts,row.state))counts[row.state]++;
  return counts;
}
function assertLedger(ledger,{cells=exactCells(),executionId,manifestSha256,sourceCommit}={}){
  validateCells(cells);
  if(!ledger||ledger.schemaVersion!==SCHEMA_VERSION||ledger.kind!=='ISSUE9_MID055_DIAGNOSTIC_LEDGER'||ledger.issue!==ISSUE||
     ledger.phase!==PHASE||ledger.cells?.length!==ATTEMPT_LIMIT||!Number.isInteger(ledger.attemptCount)||ledger.attemptCount<0||ledger.attemptCount>ATTEMPT_LIMIT||
     !Number.isInteger(ledger.transitionCount)||ledger.transitionCount<0)
    fail('diagnostic ledger schema or attempt budget is invalid','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  if((executionId!==undefined&&ledger.executionId!==executionId)||(manifestSha256!==undefined&&ledger.manifestSha256!==manifestSha256)||
     (sourceCommit!==undefined&&ledger.sourceCommit!==sourceCommit))
    fail('diagnostic ledger source or execution identity differs','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  for(let i=0;i<cells.length;i++){
    const row=ledger.cells[i],cell=cells[i];
    if(!row||row.relativePath!==cell.relativePath||!same(row.identity,cell)||!['PENDING','IN_PROGRESS','COMPLETE'].includes(row.state)||
       (row.state==='PENDING'&&row.sha256!==null)||(row.state==='COMPLETE'&&!/^[0-9a-f]{64}$/.test(row.sha256||'')))
      fail(`diagnostic ledger row mismatch for ${cell.key}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  }
  return ledger;
}
function isFiniteTree(value){
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.every(isFiniteTree);
  if(value&&typeof value==='object')return Object.values(value).every(isFiniteTree);
  return true;
}
function validateSafeMetrics(metrics){
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||!isFiniteTree(metrics)||metrics.finite!==true||metrics.outputGuardHits!==0||
     !Number.isFinite(metrics.peakDbfs)||metrics.peakDbfs>=0||!Number.isFinite(metrics.fullRenderPeakDbfs)||metrics.fullRenderPeakDbfs>=0||
     !Array.isArray(metrics.envelopeDbfs)||metrics.envelopeDbfs.length<4||!Number.isFinite(metrics.envelopeDbfs[3]))
    fail('captured metrics fail finite, guard, peak, or envelope safety checks','BLOCKED_DIAGNOSTIC');
  return true;
}
function validateAuthorization(value,expected={}){
  if(!value||value.schemaVersion!==SCHEMA_VERSION||value.kind!=='ISSUE9_MID055_RENDER_AUTHORIZATION'||value.issue!==ISSUE||
     !value.pullRequest||value.maxAttemptedCalls!==ATTEMPT_LIMIT||!value.executionId||
     !(typeof value.authorizationUrl==='string'&&/^https:\/\//.test(value.authorizationUrl))&&
       !/^[0-9a-f]{64}$/.test(value.authorizationTextSha256||''))
    fail('separate Issue #9 render authorization is missing or malformed','BLOCKED_DIAGNOSTIC_AUTHORIZATION');
  if(!same(value.response,RESPONSE)||!same(value.cells,exactCells().map(({key,pitch,velocity,velocityNormalized,response})=>({key,pitch,velocity,velocityNormalized,response}))))
    fail('render authorization does not bind the exact response and cells','BLOCKED_DIAGNOSTIC_AUTHORIZATION');
  for(const [field,want] of Object.entries(expected))if(want!==undefined&&value[field]!==want)
    fail(`render authorization ${field} does not match the approved source identity`,'BLOCKED_DIAGNOSTIC_AUTHORIZATION');
  if(!/^[0-9a-f]{64}$/.test(value.parentManifestSha256||'')||! /^[0-9a-f]{40}$/.test(value.sourceCommit||'')||
     !/^[0-9a-f]{64}$/.test(value.v15AttestationSha256||'')||!value.captureIdentity||typeof value.captureIdentity!=='object')
    fail('render authorization is missing immutable source or capture identity','BLOCKED_DIAGNOSTIC_AUTHORIZATION');
  if(expected.captureIdentity&&!same(value.captureIdentity,expected.captureIdentity))
    fail('render authorization capture identity differs','BLOCKED_DIAGNOSTIC_AUTHORIZATION');
  return value;
}
function validateDiagnosticManifest(value,{sourceCommit,parentManifestSha256=PARENT_MANIFEST_SHA256,cells=exactCells(),
  expectedSearchIdentity,expectedAcousticIdentity,expectedCaptureIdentity:expectedCapture,expectedControls}={}){
  validateCells(cells);
  if(!value||value.schemaVersion!==SCHEMA_VERSION||value.kind!=='ISSUE9_MID055_DIAGNOSTIC_MANIFEST'||value.issue!==ISSUE||
     value.phase!=='mid-0.55-screen-v1'||value.parentManifestSha256!==parentManifestSha256||
     !/^[0-9a-f]{40}$/.test(value.sourceCommit||'')||!/^[0-9a-f]{64}$/.test(value.v15AttestationSha256||'')||
     (sourceCommit!==undefined&&value.sourceCommit!==sourceCommit)||!value.executionId||!value.captureIdentity||!value.acousticIdentity||!value.searchIdentity||
     value.official16LayerAcceptance!=='NOT_RUN'||!Array.isArray(value.cells)||value.cells.length!==ATTEMPT_LIMIT||
     !Array.isArray(value.controls)||value.controls.length!==ATTEMPT_LIMIT||!value.sourceCompatibility||
     !/^[0-9a-f]{64}$/.test(value.runnerSha256||'')||! /^[0-9a-f]{64}$/.test(value.verifierSha256||''))
    fail('diagnostic manifest identity or schema differs','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const expectedCompatibility={v14AcceptedCommit:V14_ACCEPTED_COMMIT,v14AttestationSha256:V14_ATTESTATION_SHA256,
    v15AcceptedCommit:value.sourceCommit,v15AttestationSha256:value.v15AttestationSha256};
  if(!same(value.sourceCompatibility,expectedCompatibility)||
     (expectedSearchIdentity&&!same(value.searchIdentity,expectedSearchIdentity))||
     (expectedAcousticIdentity&&!same(value.acousticIdentity,expectedAcousticIdentity))||
     !same(value.captureIdentity,expectedCapture||expectedCaptureIdentity(expectedSearchIdentity,cells)))
    fail('diagnostic manifest does not match the immutable v14/v15, parent search, acoustic, or capture identity','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  for(let i=0;i<ATTEMPT_LIMIT;i++){
    const controlCell={phase:'mid-screen',response:{...CONTROL_RESPONSE},pitch:cells[i].pitch,velocity:cells[i].velocity,
      velocityNormalized:cells[i].velocityNormalized},controlKey=search.cellId(controlCell);
    const bound=value.controls[i],mismatch=[];
    if(!same(value.cells[i],cells[i]))mismatch.push('cell');
    if(bound?.pitch!==cells[i].pitch||bound?.velocity!==cells[i].velocity)mismatch.push('tuple');
    if(bound?.diagnosticCellKey!==cells[i].key||bound?.controlCellKey!==controlKey)mismatch.push('cell key');
    if(!same(bound?.response,CONTROL_RESPONSE))mismatch.push('response');
    if(bound?.relativePath!==`mid/cells/${controlKey}.json`)mismatch.push('path');
    if(!/^[0-9a-f]{64}$/.test(bound?.sha256||''))mismatch.push('sha');
    if(expectedControls){
      const control=expectedControls[i];
      if(!control||bound?.controlCellKey!==control.cellKey||bound?.relativePath!==control.relativePath||bound?.sha256!==control.sha256||
         bound?.pitch!==control.pitch||bound?.velocity!==control.velocity||!same(bound?.response,control.response))mismatch.push('frozen control');
    }
    if(mismatch.length)fail(`diagnostic manifest cell/control binding differs at index ${i}: ${mismatch.join(', ')}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  }
  return value;
}
function readDualJson(roots,relative){
  const stored=durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative));
  let value;try{value=JSON.parse(stored.bytes.toString('utf8'));}catch{fail(`invalid JSON at ${relative}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');}
  return {value,...stored};
}
function bindMid060Controls({searchRoots,parentManifestSha256=PARENT_MANIFEST_SHA256,cells=exactCells()}={}){
  validateCells(cells);
  const manifest=readDualJson(searchRoots,'generation-2-manifest.json');
  if(manifest.sha256!==parentManifestSha256||manifest.value.searchEpoch!=='search-v1'||manifest.value.state!=='ACTIVE')
    fail('parent Generation-2 search manifest does not match the frozen identity','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const ledger=readDualJson(searchRoots,'mid/mid-ledger.json').value;
  if(!ledger||ledger.phase!=='mid'||ledger.generation!==2||!same(ledger.identity,manifest.value.identity))
    fail('existing mid-screen ledger creator identity differs from its manifest','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return cells.map(cell=>{
    const controlCell={phase:'mid-screen',response:{...CONTROL_RESPONSE},pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized};
    const key=search.cellId(controlCell),relativePath=`mid/cells/${key}.json`,row=ledger.cells?.[key];
    if(!row||row.state!=='COMPLETE'||row.sha256==null||row.relativePath!==`cells/${key}.json`||!same(row.identity,{...controlCell,key}))
      fail(`existing COMPLETE mid=0.60 control is missing or mismatched for ${cell.key}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
    const stored=durable.verifyDualCopy(path.join(searchRoots.primary,relativePath),path.join(searchRoots.secondary,relativePath));
    if(stored.sha256!==row.sha256)fail(`existing mid=0.60 control SHA differs for ${cell.key}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
    let value;try{value=JSON.parse(stored.bytes.toString('utf8'));}catch{fail(`existing control JSON is invalid for ${cell.key}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');}
    if(value.cellKey!==key||!same(value.cell,row.identity)||!same(value.identity,manifest.value.identity)||value.pitch!==cell.pitch||value.velocity!==cell.velocity)
      fail(`existing mid=0.60 control provenance differs for ${cell.key}`,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
    validateSafeMetrics(value.metrics);
    return {cellKey:key,pitch:cell.pitch,velocity:cell.velocity,response:{...CONTROL_RESPONSE},relativePath,sha256:stored.sha256,metrics:value.metrics};
  });
}
function transitionPath(sequence){return `ledger-transition-journal/transition-${String(sequence).padStart(6,'0')}.json`;}
function renderStartPath(sequence){return `ledger-transition-journal/render-start-${String(sequence).padStart(6,'0')}.json`;}
function replayJournal({ledger,genesis,genesisLedgerBytes,transitions,renderStarts,cells=exactCells(),allowInProgress=false}={}){
  assertLedger(ledger,{cells});
  const genesisValue=genesis?.value;
  if(!genesisValue||genesisValue.schemaVersion!==SCHEMA_VERSION||genesisValue.kind!=='ISSUE9_MID055_DIAGNOSTIC_GENESIS'||
     genesisValue.initialLedgerSha256!==sha256(genesisLedgerBytes)||genesisValue.attemptCount!==0||!genesisValue.executionId)
    fail('diagnostic journal genesis is invalid','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  let state;try{state=JSON.parse(genesisLedgerBytes.toString('utf8'));}catch{fail('genesis ledger is invalid JSON','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');}
  assertLedger(state,{cells,executionId:genesisValue.executionId});
  let previousSha=sha256(genesisLedgerBytes),attemptCount=0,seenStarts=new Set();
  if(!Array.isArray(transitions)||!Array.isArray(renderStarts))fail('diagnostic journal entries are malformed','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  for(let i=0;i<transitions.length;i++){
    const transition=transitions[i],next=transition?.nextLedger,bytes=next&&jsonBytes(next),sequence=i+1;
    if(!transition||transition.schemaVersion!==SCHEMA_VERSION||transition.kind!=='ISSUE9_MID055_LEDGER_TRANSITION'||
       transition.executionId!==genesisValue.executionId||transition.sequence!==sequence||transition.previousLedgerSha256!==previousSha||
       transition.nextLedgerSha256!==sha256(bytes||Buffer.alloc(0))||
       transition.previousAttemptCount!==attemptCount||!Number.isInteger(transition.nextAttemptCount))
      fail(`diagnostic transition ${sequence} link is invalid`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    assertLedger(next,{cells,executionId:genesisValue.executionId});
    const rowIndex=state.cells.findIndex(row=>row.identity.key===transition.cellKey),oldRow=state.cells[rowIndex],newRow=next.cells[rowIndex];
    if(!oldRow||!newRow||oldRow.state!==transition.oldState||newRow.state!==transition.newState)
      fail(`diagnostic transition ${sequence} state is invalid`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    const expectedNext=JSON.parse(JSON.stringify(state));
    expectedNext.transitionCount=sequence;
    if(transition.oldState==='PENDING'&&transition.newState==='IN_PROGRESS'){
      if(seenStarts.has(transition.cellKey)||oldRow.attempt!==null||newRow.attempt?.number!==attemptCount+1||
         typeof newRow.attempt?.startedAt!=='string'||!newRow.attempt.startedAt||newRow.attempt.renderStartMarker!==null||
         newRow.sha256!==null||transition.completedCellSha256!==null)
        fail(`duplicate or miscounted diagnostic start for ${transition.cellKey}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
      expectedNext.cells[rowIndex]={...oldRow,state:'IN_PROGRESS',attempt:{number:attemptCount+1,startedAt:newRow.attempt.startedAt,renderStartMarker:null}};
      seenStarts.add(transition.cellKey);attemptCount++;
    }else if(transition.oldState==='IN_PROGRESS'&&transition.newState==='COMPLETE'){
      if(!seenStarts.has(transition.cellKey)||newRow.attempt?.number!==oldRow.attempt?.number||
         !/^[0-9a-f]{64}$/.test(transition.completedCellSha256||'')||newRow.sha256!==transition.completedCellSha256||
         typeof newRow.completedAt!=='string'||!newRow.completedAt||!same(newRow.attempt,oldRow.attempt))
        fail(`diagnostic completion does not follow a unique start for ${transition.cellKey}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
      expectedNext.cells[rowIndex]={...oldRow,state:'COMPLETE',sha256:transition.completedCellSha256,completedAt:newRow.completedAt};
    }else fail(`unsupported diagnostic transition ${transition.oldState} to ${transition.newState}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    expectedNext.attemptCount=attemptCount;
    if(!same(next,expectedNext))fail(`diagnostic transition ${sequence} mutates unrelated ledger state`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    if(transition.nextAttemptCount!==attemptCount||next.attemptCount!==attemptCount||next.transitionCount!==sequence)
      fail(`diagnostic transition ${sequence} accounting differs`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    state=next;previousSha=transition.nextLedgerSha256;
  }
  const markerBySequence=new Map(renderStarts.map(marker=>[marker.sequence,marker]));
  if(markerBySequence.size!==renderStarts.length)fail('duplicate render-start sequence','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  for(const transition of transitions){
    if(transition.oldState!=='PENDING')continue;
    const marker=markerBySequence.get(transition.sequence);
    if(marker&&(marker.schemaVersion!==SCHEMA_VERSION||marker.kind!=='ISSUE9_MID055_RENDER_START'||
       marker.executionId!==transition.executionId||marker.transitionSequence!==transition.sequence||marker.cellKey!==transition.cellKey||
       marker.transitionSha256!==sha256(jsonBytes(transition))||marker.ledgerSha256!==transition.nextLedgerSha256))
      fail(`render-start marker does not bind transition ${transition.sequence}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    if(!marker&&ledger.cells.find(row=>row.identity.key===transition.cellKey)?.state==='COMPLETE')
      fail(`completed cell has no durable render-start marker: ${transition.cellKey}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    if(!marker&&ledger.cells.find(row=>row.identity.key===transition.cellKey)?.state==='IN_PROGRESS')
      fail(`active cell has no durable render-start marker: ${transition.cellKey}`,'BLOCKED_DIAGNOSTIC');
  }
  for(const marker of renderStarts)if(!transitions.some(item=>item.sequence===marker.sequence&&item.cellKey===marker.cellKey&&item.newState==='IN_PROGRESS'))
    fail(`orphan render-start marker ${marker.sequence}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  const currentBytes=jsonBytes(ledger);
  if(!same(state,ledger)||sha256(currentBytes)!==previousSha||ledger.attemptCount!==attemptCount||ledger.transitionCount!==transitions.length)
    fail('current diagnostic ledger does not match immutable journal replay','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  const counts=ledgerCounts(ledger);
  if((counts.IN_PROGRESS&&!allowInProgress)||attemptCount!==seenStarts.size||attemptCount>ATTEMPT_LIMIT)
    fail('diagnostic ledger has an ambiguous or over-budget active attempt','BLOCKED_DIAGNOSTIC');
  return {attemptCount,transitionCount:transitions.length,counts,ledgerSha256:previousSha,startedCellKeys:[...seenStarts]};
}
function compareScreen({diagnosticRows,controlRows,referenceRows,cells=exactCells()}={}){
  validateCells(cells);
  const index=rows=>new Map(rows.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const actual=index(diagnosticRows||[]),controls=index(controlRows||[]),reference=index(referenceRows||[]);
  const expectedKeys=new Set(cells.map(cell=>`${cell.pitch}:${cell.velocity}`));
  if(actual.size!==ATTEMPT_LIMIT||controls.size!==ATTEMPT_LIMIT||reference.size!==ATTEMPT_LIMIT||
     [...expectedKeys].some(key=>!actual.has(key)||!controls.has(key)||!reference.has(key)))
    fail('screen requires exactly twelve matching diagnostic, control, and reference rows','BLOCKED_DIAGNOSTIC');
  const pairs=[[14,61],[61,124],[14,124]],byPitch={},comparisons=[];
  for(const pitch of PITCHES){
    const residuals=[],controlResiduals=[];
    for(const [low,high] of pairs){
      const aLow=actual.get(`${pitch}:${low}`)?.metrics?.envelopeDbfs?.[3],aHigh=actual.get(`${pitch}:${high}`)?.metrics?.envelopeDbfs?.[3];
      const cLow=controls.get(`${pitch}:${low}`)?.metrics?.envelopeDbfs?.[3],cHigh=controls.get(`${pitch}:${high}`)?.metrics?.envelopeDbfs?.[3];
      const rLow=reference.get(`${pitch}:${low}`)?.metrics?.envelopeDbfs?.[3],rHigh=reference.get(`${pitch}:${high}`)?.metrics?.envelopeDbfs?.[3];
      if(![aLow,aHigh,cLow,cHigh,rLow,rHigh].every(Number.isFinite))fail(`missing finite screen/reference level for MIDI ${pitch}`,'BLOCKED_DIAGNOSTIC');
      const signedResidualDb=(aHigh-aLow)-(rHigh-rLow),controlResidualDb=(cHigh-cLow)-(rHigh-rLow);
      residuals.push(signedResidualDb);controlResiduals.push(controlResidualDb);
      comparisons.push({pitch,lowVelocity:low,highVelocity:high,signedResidualDb,controlSignedResidualDb:controlResidualDb,
        signedDeltaDb:signedResidualDb-controlResidualDb});
    }
    byPitch[pitch]={signedResidualsDb:residuals,controlSignedResidualsDb:controlResiduals,
      screenWorstAbsResidualDb:Math.max(...residuals.map(Math.abs)),controlWorstAbsResidualDb:Math.max(...controlResiduals.map(Math.abs))};
  }
  const zeroGateControlEqual=[48,57].every(pitch=>VELOCITIES.every(velocity=>
    actual.get(`${pitch}:${velocity}`).metrics.envelopeDbfs[3]===controls.get(`${pitch}:${velocity}`).metrics.envelopeDbfs[3]));
  const safe=diagnosticRows.every(row=>{try{return validateSafeMetrics(row.metrics);}catch{return false;}});
  const allComplete=diagnosticRows.length===ATTEMPT_LIMIT;
  const informative=safe&&allComplete&&byPitch[51].screenWorstAbsResidualDb<byPitch[51].controlWorstAbsResidualDb&&
    byPitch[54].screenWorstAbsResidualDb<=byPitch[54].controlWorstAbsResidualDb&&zeroGateControlEqual;
  const perCellMetrics=cells.map(cell=>{
    const row=actual.get(`${cell.pitch}:${cell.velocity}`),control=controls.get(`${cell.pitch}:${cell.velocity}`),ref=reference.get(`${cell.pitch}:${cell.velocity}`);
    return {cellKey:cell.key,pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized,
      diagnosticMetrics:row.metrics,controlMetrics:control.metrics,
      diagnosticEnvelopeDbfs3:row.metrics.envelopeDbfs[3],controlEnvelopeDbfs3:control.metrics.envelopeDbfs[3],
      referenceEnvelopeDbfs3:ref.metrics?.envelopeDbfs?.[3]};
  });
  return {schemaVersion:SCHEMA_VERSION,kind:'ISSUE9_MID055_SCREEN_RESULT',decision:!safe||!allComplete?DECISIONS.blocked:
      informative?DECISIONS.improved:DECISIONS.unchanged,
    attemptedCount:diagnosticRows.length,completedCount:diagnosticRows.length,perCellMetrics,byPitch,comparisons,zeroGateControlEqual,
    allMetricsFinite:diagnosticRows.every(row=>isFiniteTree(row.metrics)),outputGuardHits:diagnosticRows.reduce((sum,row)=>sum+(row.metrics?.outputGuardHits||0),0),
    allPeaksBelowZero:diagnosticRows.every(row=>Number.isFinite(row.metrics?.peakDbfs)&&row.metrics.peakDbfs<0&&
      Number.isFinite(row.metrics?.fullRenderPeakDbfs)&&row.metrics.fullRenderPeakDbfs<0),official16LayerAcceptance:'NOT_RUN'};
}
function walkNamespace(root){
  if(!fs.existsSync(root))return [];
  const rows=[];
  function walk(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(entry.name.startsWith('._'))fail(`AppleDouble entry is forbidden: ${entry.name}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
      const file=path.join(dir,entry.name),relative=path.relative(root,file).split(path.sep).join('/');
      if(entry.isSymbolicLink())fail(`symlink is forbidden: ${relative}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
      if(entry.isDirectory()){walk(file);continue;}
      if(!entry.isFile())fail(`non-file namespace entry: ${relative}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
      rows.push({path:relative,sha256:sha256(fs.readFileSync(file)),sizeBytes:fs.statSync(file).size});
    }
  }
  walk(root);return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
function validateMid055DiagnosticNamespace({primaryRoot,secondaryRoot,sourceCommit,parentManifestSha256=PARENT_MANIFEST_SHA256,
  v15AttestationSha256,expectedCaptureIdentity:expectedCaptureIdentityOption,cells=exactCells(),allowMissingFinalizationSidecars=false,allowArchiveMissing=false}={}){
  const roots=evidencePaths.resolveMid055DiagnosticRoots({primary:primaryRoot,secondary:secondaryRoot});
  const hasPrimary=fs.existsSync(roots.primary),hasSecondary=fs.existsSync(roots.secondary);
  if(hasPrimary!==hasSecondary)fail('diagnostic namespace exists in only one evidence store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(!hasPrimary)return {decision:'NOT_STARTED',exists:false,attemptCount:0};
  const p=walkNamespace(roots.primary),s=walkNamespace(roots.secondary);
  if(!same(p,s))fail('diagnostic namespace copies differ','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  const parentRoots={primary:path.join(primaryRoot,'generation-2','search-v1'),secondary:path.join(secondaryRoot,'generation-2','search-v1')};
  const parentManifest=readDualJson(parentRoots,'generation-2-manifest.json');
  if(parentManifest.sha256!==parentManifestSha256||parentManifest.value.searchEpoch!=='search-v1'||parentManifest.value.state!=='ACTIVE')
    fail('diagnostic parent search manifest does not match the frozen identity','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const controls=bindMid060Controls({searchRoots:parentRoots,parentManifestSha256:parentManifest.sha256,cells});
  const captureIdentityExpected=expectedCaptureIdentity(parentManifest.value.identity,cells);
  if(expectedCaptureIdentityOption&&!same(expectedCaptureIdentityOption,captureIdentityExpected))
    fail('current capture identity differs from the immutable parent search identity','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  if(p.length===1&&p[0].path===FILES.authorization){
    const auth=readDualJson(roots,FILES.authorization);
    validateAuthorization(auth.value,{parentManifestSha256,v15AttestationSha256,sourceCommit,
      captureIdentity:captureIdentityExpected});
    return {decision:'NOT_STARTED',exists:true,authorized:true,authorizationSha256:auth.sha256,attemptCount:0,roots};
  }
  const manifest=readDualJson(roots,FILES.manifest);
  if(!Array.isArray(manifest.value?.cells))fail('diagnostic manifest cell identities are missing','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  cells=manifest.value.cells;
  validateDiagnosticManifest(manifest.value,{sourceCommit,parentManifestSha256,cells,expectedSearchIdentity:parentManifest.value.identity,
    expectedAcousticIdentity:parentManifest.value.identity.protectedIdentity,expectedCaptureIdentity:captureIdentityExpected,expectedControls:controls});
  const ledgerStored=readDualJson(roots,FILES.ledger),ledger=assertLedger(ledgerStored.value,{cells,executionId:manifest.value.executionId,
    manifestSha256:manifest.sha256,sourceCommit});
  const genesis=readDualJson(roots,FILES.genesis),genesisLedger=durable.verifyDualCopy(path.join(roots.primary,FILES.genesisLedger),path.join(roots.secondary,FILES.genesisLedger));
  const journalFiles=p.filter(row=>row.path.startsWith('ledger-transition-journal/transition-'));
  const markerFiles=p.filter(row=>row.path.startsWith('ledger-transition-journal/render-start-'));
  const transitions=journalFiles.map((row,index)=>{
    if(row.path!==transitionPath(index+1))fail(`unregistered transition path ${row.path}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    return readDualJson(roots,row.path).value;
  });
  const renderStarts=markerFiles.map(row=>{
    const match=row.path.match(/^ledger-transition-journal\/render-start-(\d{6})\.json$/);
    if(!match||row.path!==renderStartPath(Number(match[1])))fail(`unregistered render-start path ${row.path}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    return readDualJson(roots,row.path).value;
  });
  const replay=replayJournal({ledger,genesis,genesisLedgerBytes:genesisLedger.bytes,transitions,renderStarts,cells});
  const expectedFiles=new Set([FILES.manifest,FILES.ledger,FILES.genesis,FILES.genesisLedger,
    ...transitions.map((_,i)=>transitionPath(i+1)),...markerFiles.map(row=>row.path),
    ...ledger.cells.filter(row=>row.state==='COMPLETE').map(row=>row.relativePath)]);
  const hasAuthPrimary=fs.existsSync(path.join(roots.primary,FILES.authorization)),hasAuthSecondary=fs.existsSync(path.join(roots.secondary,FILES.authorization));
  if(hasAuthPrimary!==hasAuthSecondary)fail('diagnostic authorization exists in only one store','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
  if(hasAuthPrimary){
    const auth=readDualJson(roots,FILES.authorization);
    validateAuthorization(auth.value,{parentManifestSha256:manifest.value.parentManifestSha256,sourceCommit:manifest.value.sourceCommit,
      v15AttestationSha256:manifest.value.v15AttestationSha256,captureIdentity:manifest.value.captureIdentity});
    expectedFiles.add(FILES.authorization);
  }
  const terminal=fs.existsSync(path.join(roots.primary,FILES.result))||fs.existsSync(path.join(roots.secondary,FILES.result));
  if(replay.counts.COMPLETE===ATTEMPT_LIMIT&&!terminal)fail('twelve completed cells are missing their immutable result','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  if(terminal&&(replay.counts.COMPLETE!==ATTEMPT_LIMIT||replay.counts.PENDING!==0||replay.attemptCount!==ATTEMPT_LIMIT))
    fail('terminal result exists before twelve safe completed attempts','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  if(terminal){
    expectedFiles.add(FILES.result);
    const hasManifest=fs.existsSync(path.join(roots.primary,FILES.evidenceManifest));
    const hasManifestHash=fs.existsSync(path.join(roots.primary,FILES.evidenceManifestSha));
    const hasArchive=fs.existsSync(path.join(roots.primary,FILES.archive));
    if(hasManifest!==hasManifestHash)fail('finalized manifest and hash sidecar must be present together','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
    if(!hasManifest&&!allowMissingFinalizationSidecars)fail('terminal diagnostic is missing finalized manifest sidecars','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    if(hasManifest){expectedFiles.add(FILES.evidenceManifest);expectedFiles.add(FILES.evidenceManifestSha);}
    if(!hasArchive&&!allowArchiveMissing)fail('finalized diagnostic archive is missing','BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    if(hasArchive)expectedFiles.add(FILES.archive);
  }
  const actual=p.map(row=>row.path);
  if(actual.length!==expectedFiles.size||actual.some(name=>!expectedFiles.has(name)))
    fail(`diagnostic namespace file allowlist mismatch: ${actual.filter(name=>!expectedFiles.has(name)).join(',')}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
  if(v15AttestationSha256&&manifest.value.v15AttestationSha256!==v15AttestationSha256)fail('v15 attestation SHA differs','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  for(let i=0;i<ledger.cells.length;i++)if(ledger.cells[i].state==='COMPLETE'){
    const row=readDualJson(roots,ledger.cells[i].relativePath);
    const identity=ledger.cells[i].identity;
    if(row.sha256!==ledger.cells[i].sha256||row.value.schemaVersion!==SCHEMA_VERSION||row.value.kind!=='ISSUE9_MID055_CELL'||
       row.value.cellKey!==identity.key||row.value.pitch!==identity.pitch||row.value.velocity!==identity.velocity||
       row.value.velocityNormalized!==identity.velocityNormalized||!same(row.value.response,RESPONSE)||!same(row.value.cell,identity)||
       !same(row.value.captureOptions,manifest.value.cells[i].captureOptions)||
       !same(row.value.identity,manifest.value.searchIdentity))
      fail(`completed diagnostic cell identity or SHA differs: ${ledger.cells[i].identity.key}`,'BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE');
    validateSafeMetrics(row.value.metrics);
  }
  return {decision:replay.counts.COMPLETE===ATTEMPT_LIMIT?'COMPLETE':DECISIONS.blocked,state:'IN_PROGRESS',exists:true,roots,manifestSha256:manifest.sha256,
    ledgerSha256:ledgerStored.sha256,...replay,files:p};
}

module.exports={SCHEMA_VERSION,ISSUE,PHASE,NAMESPACE,PARENT_MANIFEST_SHA256,V14_ATTESTATION_SHA256,V14_ACCEPTED_COMMIT,
  SAMPLE_RATE,BLOCK,DURATION_MS,RESPONSE,CONTROL_RESPONSE,PITCHES,VELOCITIES,ATTEMPT_LIMIT,
  FILES,DECISIONS,fail,sha256,jsonBytes,stable,same,exactCells,validateCells,freshLedger,ledgerCounts,assertLedger,isFiniteTree,
  captureOptionsForCell,expectedCaptureIdentity,validateSafeMetrics,validateAuthorization,validateDiagnosticManifest,readDualJson,bindMid060Controls,transitionPath,renderStartPath,
  replayJournal,compareScreen,walkNamespace,validateMid055DiagnosticNamespace};
