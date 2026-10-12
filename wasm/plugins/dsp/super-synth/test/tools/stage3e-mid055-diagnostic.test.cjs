'use strict';

const assert=require('node:assert/strict');
const diagnostic=require('./stage3e-mid055-diagnostic.cjs');
const generation2=require('./run-stage3e-generation2.cjs');

const cells=diagnostic.exactCells();
assert.equal(cells.length,12);
assert.deepEqual(cells.map(cell=>`${cell.pitch}:${cell.velocity}`),[48,51,54,57].flatMap(pitch=>[14,61,124].map(v=>`${pitch}:${v}`)));
assert.equal(cells[0].key,'mid055-screen-L0.35-M0.55-H0.5-midi-048-v110');
assert.equal(cells[11].velocityNormalized,124/127);
assert.equal(diagnostic.validateCells(cells).length,12);
assert.throws(()=>diagnostic.validateCells([...cells,cells[0]]),/exactly twelve/);
assert.throws(()=>diagnostic.validateCells(cells.map((cell,index)=>index===1?{...cell,response:{...cell.response,mid:0.6}}:cell)),/identity mismatch/);
assert.throws(()=>diagnostic.validateCells([cells[1],cells[0],...cells.slice(2)]),/identity mismatch/);
assert.throws(()=>diagnostic.validateCells(cells.map((cell,index)=>index===0?{...cell,velocityNormalized:14/128}:cell)),/identity mismatch/);
assert.deepEqual(cells.map(diagnostic.captureOptionsForCell),cells.map(generation2.captureOptionsForCell),
  'Issue #9 uses the unchanged normal Stage3E screen capture options');

const identityCells=cells.map(cell=>({...cell,captureOptions:diagnostic.captureOptionsForCell(cell)}));
const genesisLedger=diagnostic.freshLedger(identityCells,{executionId:'test-run',manifestSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),createdAt:'t0'});
const genesisLedgerBytes=diagnostic.jsonBytes(genesisLedger);
const genesis={value:{schemaVersion:1,kind:'ISSUE9_MID055_DIAGNOSTIC_GENESIS',executionId:'test-run',
  initialLedgerSha256:diagnostic.sha256(genesisLedgerBytes),attemptCount:0}};
function transitioned(ledger,{oldState,newState,cellIndex=0,completedSha=null}){
  const previous=diagnostic.jsonBytes(ledger),next=JSON.parse(previous.toString('utf8')),row=next.cells[cellIndex],cell=identityCells[cellIndex];
  if(oldState==='PENDING'){
    next.attemptCount++;row.state='IN_PROGRESS';row.attempt={number:next.attemptCount,startedAt:'start',renderStartMarker:null};
  }else{row.state='COMPLETE';row.sha256=completedSha;row.completedAt='end';}
  next.transitionCount++;
  const nextBytes=diagnostic.jsonBytes(next),sequence=next.transitionCount;
  return {next,record:{schemaVersion:1,kind:'ISSUE9_MID055_LEDGER_TRANSITION',sequence,executionId:'test-run',cellKey:cell.key,
    oldState,newState,previousLedgerSha256:diagnostic.sha256(previous),nextLedgerSha256:diagnostic.sha256(nextBytes),
    previousAttemptCount:ledger.attemptCount,nextAttemptCount:next.attemptCount,completedCellSha256:completedSha,createdAt:'transition',nextLedger:next}};
}
const started=transitioned(genesisLedger,{oldState:'PENDING',newState:'IN_PROGRESS'});
const marker={schemaVersion:1,kind:'ISSUE9_MID055_RENDER_START',sequence:1,transitionSequence:1,cellKey:identityCells[0].key,
  executionId:'test-run',ledgerSha256:started.record.nextLedgerSha256,transitionSha256:diagnostic.sha256(diagnostic.jsonBytes(started.record))};
assert.equal(diagnostic.replayJournal({ledger:started.next,genesis,genesisLedgerBytes,transitions:[started.record],renderStarts:[marker],
  cells:identityCells,allowInProgress:true}).attemptCount,1,'a durable start consumes exactly one attempt before rendering');
assert.throws(()=>diagnostic.replayJournal({ledger:started.next,genesis,genesisLedgerBytes,transitions:[started.record],renderStarts:[marker],cells:identityCells}),
  /ambiguous or over-budget active attempt/);
const cellSha='c'.repeat(64),completed=transitioned(started.next,{oldState:'IN_PROGRESS',newState:'COMPLETE',completedSha:cellSha});
assert.equal(diagnostic.replayJournal({ledger:completed.next,genesis,genesisLedgerBytes,
  transitions:[started.record,completed.record],renderStarts:[marker],cells:identityCells}).counts.COMPLETE,1);
assert.throws(()=>diagnostic.replayJournal({ledger:completed.next,genesis,genesisLedgerBytes,
  transitions:[started.record,completed.record],renderStarts:[],cells:identityCells}),/no durable render-start marker/);
const badMarker={...marker,ledgerSha256:'0'.repeat(64)};
assert.throws(()=>diagnostic.replayJournal({ledger:started.next,genesis,genesisLedgerBytes,
  transitions:[started.record],renderStarts:[badMarker],cells:identityCells,allowInProgress:true}),/does not bind transition/);
const tamperedLedger=JSON.parse(JSON.stringify(started.next));tamperedLedger.cells[1].state='IN_PROGRESS';
const tamperedTransition={...started.record,nextLedger:tamperedLedger,nextLedgerSha256:diagnostic.sha256(diagnostic.jsonBytes(tamperedLedger))};
const tamperedMarker={...marker,ledgerSha256:tamperedTransition.nextLedgerSha256,
  transitionSha256:diagnostic.sha256(diagnostic.jsonBytes(tamperedTransition))};
assert.throws(()=>diagnostic.replayJournal({ledger:tamperedLedger,genesis,genesisLedgerBytes,
  transitions:[tamperedTransition],renderStarts:[tamperedMarker],cells:identityCells,allowInProgress:true}),/mutates unrelated ledger state/);
assert.throws(()=>diagnostic.assertLedger({...completed.next,attemptCount:13},{cells:identityCells}),/schema or attempt budget/);

function metrics(level,{guard=0,peak=-2,fullPeak=-1}={}){
  return {finite:true,outputGuardHits:guard,peakDbfs:peak,fullRenderPeakDbfs:fullPeak,
    envelopeDbfs:[level-3,level-2,level-1,level,level+1]};
}
function rowsFor(levelFn){return [48,51,54,57].flatMap(pitch=>[14,61,124].map(velocity=>({pitch,velocity,
  metrics:metrics(levelFn(pitch,velocity))})));}
const referenceRows=rowsFor((pitch,velocity)=>({14:-30,61:-24,124:-18}[velocity]-(pitch-48)/2));
const controlRows=rowsFor((pitch,velocity)=>{
  const ref=({14:-30,61:-24,124:-18}[velocity]-(pitch-48)/2);
  if(pitch===51)return ref+({14:0,61:2,124:4}[velocity]);
  if(pitch===54)return ref+({14:0,61:1,124:2}[velocity]);
  return ref;
});
const improvedRows=rowsFor((pitch,velocity)=>{
  const ref=({14:-30,61:-24,124:-18}[velocity]-(pitch-48)/2);
  if(pitch===54)return ref+({14:0,61:1,124:2}[velocity]);
  return ref;
});
const improved=diagnostic.compareScreen({diagnosticRows:improvedRows,controlRows,referenceRows,cells});
assert.equal(improved.decision,diagnostic.DECISIONS.improved);
assert.equal(improved.byPitch[51].screenWorstAbsResidualDb,0);
assert.ok(improved.byPitch[51].screenWorstAbsResidualDb<improved.byPitch[51].controlWorstAbsResidualDb);
assert.equal(improved.zeroGateControlEqual,true);
assert.equal(improved.official16LayerAcceptance,'NOT_RUN');
const unchanged=diagnostic.compareScreen({diagnosticRows:controlRows,controlRows,referenceRows,cells});
assert.equal(unchanged.decision,diagnostic.DECISIONS.unchanged,'equal MIDI 51 residual is not a strict improvement');
const worse54=rowsFor((pitch,velocity)=>{
  const ref=({14:-30,61:-24,124:-18}[velocity]-(pitch-48)/2);
  return pitch===54?ref+({14:0,61:3,124:6}[velocity]):pitch===51?ref:ref;
});
assert.equal(diagnostic.compareScreen({diagnosticRows:worse54,controlRows,referenceRows,cells}).decision,diagnostic.DECISIONS.unchanged,
  'MIDI 54 worsening rejects an otherwise improved MIDI 51 screen');
const changedZeroGate=improvedRows.map(row=>row.pitch===48?{...row,metrics:metrics(row.metrics.envelopeDbfs[3]+0.01)}:row);
assert.equal(diagnostic.compareScreen({diagnosticRows:changedZeroGate,controlRows,referenceRows,cells}).decision,diagnostic.DECISIONS.unchanged,
  'MIDI 48 and 57 controls require exact level equality');
const unsafe=improvedRows.map(row=>row.pitch===51&&row.velocity===61?{...row,metrics:metrics(-23,{guard:1})}:row);
assert.equal(diagnostic.compareScreen({diagnosticRows:unsafe,controlRows,referenceRows,cells}).decision,diagnostic.DECISIONS.blocked);
assert.throws(()=>diagnostic.validateSafeMetrics(metrics(-2,{peak:0})),/safety checks/);
assert.throws(()=>diagnostic.validateSafeMetrics({...metrics(-2),envelopeDbfs:[0,0,0,NaN]}),/safety checks/);

console.log('PASS Issue #9 exact twelve-cell grammar, journal replay, metric safety, and bounded screen decisions');
