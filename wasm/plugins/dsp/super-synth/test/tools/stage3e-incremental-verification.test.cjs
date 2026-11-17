'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const durable=require('./durable-evidence.cjs');
const incremental=require('./stage3e-incremental-verification.cjs');
const generation2=require('./run-stage3e-generation2.cjs');
const evidenceValidator=require('./stage3e-evidence-validator.cjs');

function tempRoots(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-incremental-'));
  const searchRoots={primary:path.join(root,'primary','generation-2','search-v1'),secondary:path.join(root,'secondary','generation-2','search-v1')};
  const phaseRoots={primary:path.join(searchRoots.primary,'low'),secondary:path.join(searchRoots.secondary,'low')};
  const journalRoots={primary:path.join(searchRoots.primary,'ledger-transition-journal'),secondary:path.join(searchRoots.secondary,'ledger-transition-journal')};
  fs.mkdirSync(phaseRoots.primary,{recursive:true});fs.mkdirSync(phaseRoots.secondary,{recursive:true});
  fs.mkdirSync(journalRoots.primary,{recursive:true});fs.mkdirSync(journalRoots.secondary,{recursive:true});
  return {root,searchRoots,phaseRoots,journalRoots};
}
function baseLedger(identity,cells){const states={};for(const cell of cells)states[cell.key]={state:'PENDING',identity:cell,relativePath:`cells/${cell.key}.json`,sha256:null};return {schemaVersion:1,generation:2,executionId:'generation-2',phase:'low',identity,authorizedCellCount:cells.length,accounting:{renderCalls:0},cells:states};}
function writeLedger(roots,ledger){return durable.writeDualCopy(path.join(roots.phaseRoots.primary,'low-ledger.json'),path.join(roots.phaseRoots.secondary,'low-ledger.json'),Buffer.from(JSON.stringify(ledger,null,2)+'\n'));}
function readState(roots,ledger){
  const stored=durable.verifyDualCopy(path.join(roots.phaseRoots.primary,'low-ledger.json'),path.join(roots.phaseRoots.secondary,'low-ledger.json'));
  const journalFiles=fs.readdirSync(roots.journalRoots.primary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort();
  let journalTipSha256=null,journalTipSequence=0;
  if(journalFiles.length){const name=journalFiles.at(-1),tip=durable.verifyDualCopy(path.join(roots.journalRoots.primary,name),path.join(roots.journalRoots.secondary,name));journalTipSha256=tip.sha256;journalTipSequence=Number(name.match(/([0-9]{6})\.json$/)[1]);}
  return {ledgerSha256:stored.sha256,journalTipSha256,journalTipSequence,
    completeCount:Object.values(ledger.cells).filter(cell=>cell.state==='COMPLETE').length,renderCalls:ledger.accounting.renderCalls};
}
function installContext(roots,ledger,identity,fullAudits){
  const current=durable.verifyDualCopy(path.join(roots.phaseRoots.primary,'low-ledger.json'),path.join(roots.phaseRoots.secondary,'low-ledger.json'));
  const transitions=fs.readdirSync(roots.journalRoots.primary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort().map(name=>JSON.parse(fs.readFileSync(path.join(roots.journalRoots.primary,name),'utf8')));
  const markers=fs.readdirSync(roots.journalRoots.primary).filter(name=>/^render-start-[0-9]{6}\.json$/.test(name)).sort().map(name=>JSON.parse(fs.readFileSync(path.join(roots.journalRoots.primary,name),'utf8')));
  return incremental.createPhaseVerificationContext({phase:'low',executionId:'generation-2',identity,searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots,
    journalRoots:roots.journalRoots,ledger,ledgerSha256:current.sha256,transitionEntries:transitions,renderStartEntries:markers,
    manifestSha256:'1'.repeat(64),proofSha256:'2'.repeat(64),compatibilitySha256:'3'.repeat(64),
    fullAudit:()=>{fullAudits.count++;return identity;},readCurrentState:()=>readState(roots,ledger)});
}
function completeCell(roots,context,ledger,cell,markerIndex){
  function transition(oldState,newState,renderCount,capturedCellSha256=null,renderStartMarkerSha256=null){
    const old=durable.verifyDualCopy(path.join(roots.phaseRoots.primary,'low-ledger.json'),path.join(roots.phaseRoots.secondary,'low-ledger.json'));
    ledger.cells[cell.key].state=newState;
    if(newState==='IN_PROGRESS')ledger.cells[cell.key].startedAt='2026-10-10T00:00:00.000Z';
    if(newState==='COMPLETE'){ledger.cells[cell.key].sha256=capturedCellSha256;ledger.cells[cell.key].completedAt='2026-10-10T00:00:01.000Z';ledger.accounting.renderCalls++;}
    const next=writeLedger(roots,ledger),sequence=context.transitionEntries.length+1;
    const entry={schemaVersion:1,sequence,previousLedgerSha256:old.sha256,nextLedgerSha256:next.sha256,cellKey:cell.key,cellIdentity:cell,
      oldState,newState,previousRenderCount:renderCount,newRenderCount:ledger.accounting.renderCalls,capturedCellSha256,
      manifestSha256:'1'.repeat(64),proofSha256:'2'.repeat(64),compatibilitySha256:'3'.repeat(64)};
    if(renderStartMarkerSha256)entry.renderStartMarkerSha256=renderStartMarkerSha256;
    const name=`transition-${String(sequence).padStart(6,'0')}.json`,stored=durable.writeDualCopy(path.join(roots.journalRoots.primary,name),path.join(roots.journalRoots.secondary,name),Buffer.from(JSON.stringify(entry,null,2)+'\n'));
    context.recordTransition({entry,stored,previousLedgerSha256:old.sha256,nextLedgerSha256:next.sha256});
    return {entry,stored};
  }
  const priorRenderCount=ledger.accounting.renderCalls;
  const start=transition('PENDING','IN_PROGRESS',priorRenderCount);
  const marker={schemaVersion:1,kind:'STAGE3E_RENDER_START',sequence:markerIndex,cellKey:cell.key,cellIdentity:cell,
    ledgerSha256:start.entry.nextLedgerSha256,transitionSequence:start.entry.sequence,
    transitionSha256:incremental.sha256(Buffer.from(JSON.stringify(start.entry,null,2)+'\n')),
    manifestSha256:'1'.repeat(64),proofSha256:'2'.repeat(64),compatibilitySha256:'3'.repeat(64),renderCallIndex:priorRenderCount+1};
  const markerName=`render-start-${String(markerIndex).padStart(6,'0')}.json`;
  const markerStored=durable.writeDualCopy(path.join(roots.journalRoots.primary,markerName),path.join(roots.journalRoots.secondary,markerName),Buffer.from(JSON.stringify(marker,null,2)+'\n'));
  context.recordRenderStart({stored:markerStored,marker});
  const cellBytes=Buffer.from(JSON.stringify({cellKey:cell.key,cell,identity:ledger.identity},null,2)+'\n');
  const cellStored=durable.writeDualCopy(path.join(roots.phaseRoots.primary,ledger.cells[cell.key].relativePath),path.join(roots.phaseRoots.secondary,ledger.cells[cell.key].relativePath),cellBytes);
  context.recordCell({cell,state:ledger.cells[cell.key],stored:cellStored});
  transition('IN_PROGRESS','COMPLETE',priorRenderCount,cellStored.sha256,markerStored.sha256);
  context.addCompletedCell({ledger});
}

{
  const roots=tempRoots(),identity={schemaVersion:1,executionId:'generation-2',candidateId:'test'},cells=Array.from({length:65},(_,index)=>({
    key:`low-screen-test-${String(index+1).padStart(3,'0')}`,phase:'low-screen',pitch:36,velocity:index+1,response:{low:1,mid:1,bassHardness:0}}));
  try{
    let ledger=baseLedger(identity,cells);writeLedger(roots,ledger);let fullAudits={count:0};
    let context=installContext(roots,ledger,identity,fullAudits);
    for(let i=0;i<64;i++){context.beforeCell();completeCell(roots,context,ledger,cells[i],i+1);}
    const checkpointPath=path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json');
    const checkpoint=JSON.parse(fs.readFileSync(checkpointPath,'utf8'));
    assert.equal(checkpoint.newlyCompletedCellCount,64);
    assert.equal(checkpoint.cumulativeComplete,64);
    assert.equal(checkpoint.cumulativeAcousticRenderCalls,64);
    assert.equal(checkpoint.deltaEvidenceEntries.filter(entry=>entry.type==='cell').length,64);
    assert.equal(checkpoint.deltaEvidenceEntries.filter(entry=>entry.type==='journal').length,192);
    assert.equal(fullAudits.count,1,'phase entry is the only full audit before the phase boundary');
    assert.equal(durable.verifyDualCopy(checkpointPath,path.join(roots.phaseRoots.secondary,'verification-checkpoints','checkpoint-000001.json')).sha256,
      incremental.sha256(fs.readFileSync(checkpointPath)));
    context.finish(ledger);
    assert.equal(fullAudits.count,2,'phase entry and phase exit are the only full audits; checkpoint validates its new delta only');

    ledger=JSON.parse(durable.verifyDualCopy(path.join(roots.phaseRoots.primary,'low-ledger.json'),path.join(roots.phaseRoots.secondary,'low-ledger.json')).bytes.toString('utf8'));
    fullAudits={count:0};context=installContext(roots,ledger,identity,fullAudits);
    context.beforeCell();completeCell(roots,context,ledger,cells[64],65);context.finish(ledger);
    const secondPath=path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000002.json');
    const second=JSON.parse(fs.readFileSync(secondPath,'utf8'));
    assert.equal(second.fromJournalSequenceExclusive,128);
    assert.equal(second.throughJournalSequenceInclusive,130);
    assert.equal(second.newlyCompletedCellCount,1);
    assert.equal(second.cumulativeComplete,65);
    assert.equal(second.deltaEvidenceEntries.filter(entry=>entry.type==='cell').length,1);
    assert.equal(fullAudits.count,2,'restart phase entry and phase exit are fully audited; residual checkpoint validates only its delta');
    assert.equal(incremental.validateCheckpointChain({phase:'low',executionId:'generation-2',searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots}).length,2);
    const tamperedPath=path.join('low','cells',cells[0].key+'.json');
    const primaryCellPath=path.join(roots.searchRoots.primary,tamperedPath);
    const secondaryCellPath=path.join(roots.searchRoots.secondary,tamperedPath);
    const checkpointBytes=fs.readFileSync(checkpointPath),originalCell=fs.readFileSync(primaryCellPath);
    const sameSizeMutation=Buffer.from(originalCell);sameSizeMutation[0]^=1;
    fs.writeFileSync(primaryCellPath,sameSizeMutation);fs.writeFileSync(secondaryCellPath,sameSizeMutation);
    assert.equal(fs.readFileSync(checkpointPath).equals(checkpointBytes),true,'checkpoint identity remains unchanged');
    assert.throws(()=>incremental.validateCheckpointChain({phase:'low',executionId:'generation-2',searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots}),
      /BLOCKED_STAGE3E_VERIFICATION_CHECKPOINT: delta SHA-256 mismatch/);
  }finally{fs.rmSync(roots.root,{recursive:true,force:true});}
}

{
  const roots=tempRoots(),identity={schemaVersion:1,executionId:'generation-2',candidateId:'bounded-checkpoint-delta-reads'},
    cells=Array.from({length:256},(_,index)=>({key:`low-bounded-delta-${String(index+1).padStart(3,'0')}`,phase:'low-screen',
      pitch:36,velocity:index+1,response:{low:1,mid:1,bassHardness:0}}));
  let originalVerify=durable.verifyDualCopy;
  try{
    const ledger=baseLedger(identity,cells);writeLedger(roots,ledger);
    const audits={count:0},context=installContext(roots,ledger,identity,audits),cellReads=[];
    durable.verifyDualCopy=function(primary,secondary,...args){
      if(String(primary).includes(`${path.sep}cells${path.sep}`))cellReads.push(path.basename(primary,'.json'));
      return originalVerify.call(durable,primary,secondary,...args);
    };
    for(let i=0;i<cells.length;i++){
      context.beforeCell();completeCell(roots,context,ledger,cells[i],i+1);
      if((i+1)%64===0){
        const completedThrough=i+1,expected=cells.slice(completedThrough-64,completedThrough).map(cell=>cell.key);
        assert.deepEqual(cellReads.slice(-64),expected,`checkpoint ${completedThrough} reads only its uncheckpointed 64-cell delta`);
        assert.equal(cellReads.length,completedThrough,'no prior COMPLETE cell raw is reopened during normal checkpoint progress');
        assert.equal(audits.count,1,'64-cell checkpoints do not invoke a full history audit');
      }
    }
    context.finish(ledger);
    assert.equal(audits.count,2,'phase entry and phase exit perform full audits');
    assert.equal(cellReads.length,256,'phase completion does not replay checkpoint history');
    const chain=incremental.validateCheckpointChain({phase:'low',executionId:'generation-2',searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots});
    assert.equal(chain.length,4);
    assert.equal(cellReads.length,512,'explicit full-chain verification re-reads every cell once');
    const checkpointPath=path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json');
    const checkpointBytes=fs.readFileSync(checkpointPath),cellPath=path.join(roots.phaseRoots.primary,'cells',`${cells[0].key}.json`);
    const original=fs.readFileSync(cellPath),mutation=Buffer.from(original);mutation[0]^=1;
    fs.writeFileSync(cellPath,mutation);fs.writeFileSync(path.join(roots.phaseRoots.secondary,'cells',`${cells[0].key}.json`),mutation);
    assert.equal(fs.readFileSync(checkpointPath).equals(checkpointBytes),true,'immutable checkpoint bytes are unchanged');
    assert.throws(()=>incremental.validateCheckpointChain({phase:'low',executionId:'generation-2',searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots}),
      /BLOCKED_STAGE3E_VERIFICATION_CHECKPOINT: delta SHA-256 mismatch/);
  }finally{durable.verifyDualCopy=originalVerify;fs.rmSync(roots.root,{recursive:true,force:true});}
}

{
  const roots=tempRoots(),identity={schemaVersion:1,executionId:'generation-2',candidateId:'write-checkpoint-hash-binding'},cells=[{
    key:'low-write-checkpoint-hash-binding',phase:'low-screen',pitch:36,velocity:14,response:{low:1,mid:1,bassHardness:0}}];
  try{
    const ledger=baseLedger(identity,cells);writeLedger(roots,ledger);
    const context=installContext(roots,ledger,identity,{count:0});context.beforeCell();completeCell(roots,context,ledger,cells[0],1);
    const relative=path.join('low','cells',cells[0].key+'.json');
    const primaryCellPath=path.join(roots.searchRoots.primary,relative),secondaryCellPath=path.join(roots.searchRoots.secondary,relative);
    const original=fs.readFileSync(primaryCellPath),sameSizeMutation=Buffer.from(original);sameSizeMutation[0]^=1;
    fs.writeFileSync(primaryCellPath,sameSizeMutation);fs.writeFileSync(secondaryCellPath,sameSizeMutation);
    assert.throws(()=>context.writeCheckpoint(ledger),/BLOCKED_STAGE3E_VERIFICATION_CHECKPOINT: delta SHA-256 mismatch/);
    assert.equal(fs.existsSync(path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json')),false,
      'a checkpoint is not written after the delta payload hash changes');
  }finally{fs.rmSync(roots.root,{recursive:true,force:true});}
}

{
  const roots=tempRoots(),identity={schemaVersion:1,executionId:'generation-2',candidateId:'resume-test'},cells=Array.from({length:3},(_,index)=>({
    key:`low-resume-${index+1}`,phase:'low-screen',pitch:36,velocity:14+index,response:{low:1,mid:1,bassHardness:0}}));
  try{
    const ledger=baseLedger(identity,cells);writeLedger(roots,ledger);let audits={count:0};
    let context=installContext(roots,ledger,identity,audits);
    for(let i=0;i<cells.length;i++){context.beforeCell();completeCell(roots,context,ledger,cells[i],i+1);}
    assert.equal(fs.existsSync(path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json')),false);
    ledger.cells[cells[0].key].state='COMPLETE';
    audits={count:0};context=installContext(roots,ledger,identity,audits);
    assert.equal(context.completedSinceCheckpoint,3,'uncheckpointed completed cells are reconstructed after process restart');
    context.finish(ledger);
    const checkpoint=JSON.parse(fs.readFileSync(path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json'),'utf8'));
    assert.equal(checkpoint.newlyCompletedCellCount,3);
    assert.equal(checkpoint.fromJournalSequenceExclusive,0);
    assert.equal(checkpoint.throughJournalSequenceInclusive,6);
    assert.equal(incremental.validateCheckpointChain({phase:'low',executionId:'generation-2',searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots}).length,1);
  }finally{fs.rmSync(roots.root,{recursive:true,force:true});}
}

{
  const roots=tempRoots(),identity={schemaVersion:1,executionId:'generation-2',candidateId:'legacy-checkpoint-bootstrap'},cells=Array.from({length:128},(_,index)=>({
    key:`low-legacy-${String(index+1).padStart(3,'0')}`,phase:'low-screen',pitch:36,velocity:index+1,response:{low:1,mid:1,bassHardness:0}}));
  try{
    const ledger=baseLedger(identity,cells);writeLedger(roots,ledger);
    const seed={transitionEntries:[],recordTransition({entry}){this.transitionEntries.push(entry);},recordRenderStart(){},recordCell(){},addCompletedCell(){}};
    for(let i=0;i<70;i++)completeCell(roots,seed,ledger,cells[i],i+1);
    const audits={count:0},context=installContext(roots,ledger,identity,audits);
    assert.equal(context.baseComplete,64,'phase-entry audit anchors the existing completed prefix at the previous 64-cell boundary');
    assert.equal(context.completedSinceCheckpoint,6,'only the audited residual after the boundary remains pending checkpointing');
    assert.equal(context.deltaEvidenceEntries.filter(entry=>entry.type==='cell').length,6);
    for(let i=70;i<128;i++){context.beforeCell();completeCell(roots,context,ledger,cells[i],i+1);}
    const checkpoint=JSON.parse(fs.readFileSync(path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json'),'utf8'));
    assert.equal(checkpoint.baseComplete,64);
    assert.equal(checkpoint.newlyCompletedCellCount,64);
    assert.equal(checkpoint.cumulativeComplete,128,'checkpoint is written at the next cumulative 64-cell boundary');
    assert.equal(checkpoint.fromJournalSequenceExclusive,128);
    assert.equal(checkpoint.throughJournalSequenceInclusive,256);
    context.finish(ledger);
    assert.equal(incremental.validateCheckpointChain({phase:'low',executionId:'generation-2',searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots}).length,1);
  }finally{fs.rmSync(roots.root,{recursive:true,force:true});}
}

{
  const roots=tempRoots(),identity={schemaVersion:1,executionId:'generation-2',candidateId:'legacy-checkpoint-bootstrap'},cells=Array.from({length:128},(_,index)=>({
    key:`low-legacy-${String(index+1).padStart(3,'0')}`,phase:'low-screen',pitch:36,velocity:index+1,response:{low:1,mid:1,bassHardness:0}}));
  try{
    const ledger=baseLedger(identity,cells);writeLedger(roots,ledger);
    const seed={transitionEntries:[],recordTransition({entry}){this.transitionEntries.push(entry);},recordRenderStart(){},recordCell(){},addCompletedCell(){}};
    for(let i=0;i<70;i++)completeCell(roots,seed,ledger,cells[i],i+1);
    const audits={count:0},context=installContext(roots,ledger,identity,audits);
    assert.equal(context.baseComplete,64,'phase-entry audit anchors the existing completed prefix at the previous 64-cell boundary');
    assert.equal(context.completedSinceCheckpoint,6,'only the audited residual after the boundary remains pending checkpointing');
    assert.equal(context.deltaEvidenceEntries.filter(entry=>entry.type==='cell').length,6);
    for(let i=70;i<128;i++){context.beforeCell();completeCell(roots,context,ledger,cells[i],i+1);}
    const checkpoint=JSON.parse(fs.readFileSync(path.join(roots.phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json'),'utf8'));
    assert.equal(checkpoint.baseComplete,64);
    assert.equal(checkpoint.newlyCompletedCellCount,64);
    assert.equal(checkpoint.cumulativeComplete,128,'checkpoint is written at the next cumulative 64-cell boundary');
    assert.equal(checkpoint.fromJournalSequenceExclusive,128);
    assert.equal(checkpoint.throughJournalSequenceInclusive,256);
    context.finish(ledger);
    assert.equal(incremental.validateCheckpointChain({phase:'low',executionId:'generation-2',searchRoots:roots.searchRoots,phaseRoots:roots.phaseRoots}).length,1);
  }finally{fs.rmSync(roots.root,{recursive:true,force:true});}
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-runner-incremental-'));
  const searchRoots={primary:path.join(root,'primary','generation-2','search-v1'),secondary:path.join(root,'secondary','generation-2','search-v1')};
  const identity={schemaVersion:1,generation:2,executionId:'generation-2',creatorRevision:'revision',candidateId:'candidate',protectedIdentity:{},
    referenceSetSha256:'a'.repeat(64),captureHelperSha256:'b'.repeat(64),runnerSha256:'c'.repeat(64),coreSha256:'d'.repeat(64),searchEpoch:'search-v1',
    midi41AmendmentResultSha256:'e'.repeat(64),historicalGeneration2ManifestSha256:'f'.repeat(64),activeSearchCaptureIdentity:{}};
  const phaseIdentity={...identity,phase:'mid',authorizedGrid:[],screenCoordinates:[]};
  const cells=generation2.cellSpecs('mid-screen',[{pitch:36,velocity:14,response:{low:1,mid:1,bassHardness:0}}]);
  try{
    fs.mkdirSync(searchRoots.primary,{recursive:true});fs.mkdirSync(searchRoots.secondary,{recursive:true});
    const roots={primary:searchRoots.primary,secondary:searchRoots.secondary};
    const phaseRoots=generation2.phaseRoots(roots,'mid');fs.mkdirSync(phaseRoots.primary,{recursive:true});fs.mkdirSync(phaseRoots.secondary,{recursive:true});
    const ledger=generation2.freshCellLedger('mid',phaseIdentity,cells);generation2.writeCellState(phaseRoots,ledger);
    const audits={count:0},capture={DEFAULT_RESPONSE:{}};
    const result=generation2.screenLedgerRows(roots,'mid',phaseIdentity,cells,capture,null,()=>{audits.count++;return identity;},
      ()=>`2026-10-11T00:00:00.000Z`,cell=>({pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocity/127,kind:'search',metrics:{finite:true}}),'1'.repeat(64));
    assert.equal(result.ledger.accounting.renderCalls,1);
    assert.equal(result.ledger.cells[cells[0].key].state,'COMPLETE');
    assert.equal(audits.count,2,'one-cell phase uses phase-entry and phase-exit audits; checkpoint readback is local');
    const cp=JSON.parse(fs.readFileSync(path.join(phaseRoots.primary,'verification-checkpoints','checkpoint-000001.json'),'utf8'));
    assert.equal(cp.newlyCompletedCellCount,1);
    assert.equal(cp.deltaEvidenceEntries.filter(entry=>entry.type==='cell').length,1);
    assert.equal(cp.deltaEvidenceEntries.filter(entry=>entry.type==='journal').length,3);
    assert.equal(incremental.validateCheckpointChain({phase:'mid',executionId:'generation-2',searchRoots,phaseRoots}).length,1);
    assert.equal(evidenceValidator.isSearchAddition('generation-2/search-v1/mid/verification-checkpoints/checkpoint-000001.json'),true);
    assert.equal(evidenceValidator.isSearchAddition('generation-2/search-v1/unknown/verification-checkpoints/checkpoint-000001.json'),false);
    const cellPath=path.join(phaseRoots.primary,'cells',`${cells[0].key}.json`),cellBytes=fs.readFileSync(cellPath);
    fs.writeFileSync(cellPath,Buffer.concat([cellBytes,Buffer.from('tamper')]));
    assert.throws(()=>incremental.validateCheckpointChain({phase:'mid',executionId:'generation-2',searchRoots,phaseRoots}),
      /BLOCKED_STAGE3E_VERIFICATION_CHECKPOINT|BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

console.log('Stage3E incremental verification checkpoint tests passed');
