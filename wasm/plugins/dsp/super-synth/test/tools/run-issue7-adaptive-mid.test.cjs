'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const adaptive=require('./issue7-adaptive-mid-core.cjs');
const core=require('./issue7-current-build-core.cjs');
const adaptiveRunner=require('./run-issue7-adaptive-mid.cjs');
const evaluator=require('./issue7-adaptive-mid-evaluator.cjs');
const master=require('./run-issue7-current-build.cjs');

function result(mid,spanErrorDb,kind){return {mid,spanErrorDb,safe:true,diagnosticsComplete:true,kind};}

test('adaptive planner starts at 0.55 and bisects toward the largest passing mid at fixed four decimals',()=>{
  assert.deepEqual(adaptive.nextProbe([]),{done:false,mid:0.55,kind:'grid',ordinal:1});
  const first=[result(0.55,7.9,'grid')];
  assert.deepEqual(adaptive.nextProbe(first).mid,0.575);
  const second=[...first,result(0.575,7.99,'bisection')];
  assert.deepEqual(adaptive.nextProbe(second).mid,0.5875);
  const third=[...second,result(0.5875,8.2,'bisection')];
  assert.equal(adaptive.nextProbe(third).decision,'ADAPTIVE_MID_PROBES_COMPLETE');
  assert.deepEqual(adaptive.nextProbe(third).passingCandidates.map(item=>item.mid),[0.575,0.55]);
});

test('safe quality FAIL at 0.55 descends through the fixed grid and bisects the first passing bracket',()=>{
  const history=[result(0.55,8.9,'grid')];
  assert.equal(adaptive.nextProbe(history).mid,0.5);
  history.push(result(0.5,8.2,'grid'));
  assert.equal(adaptive.nextProbe(history).mid,0.45);
  history.push(result(0.45,7.8,'grid'));
  assert.deepEqual(adaptive.nextProbe(history).bracket,{pass:0.45,fail:0.5});
  assert.equal(adaptive.nextProbe(history).mid,0.475);
  history.push(result(0.475,7.9,'bisection'));
  assert.equal(adaptive.nextProbe(history).mid,0.4875);
  history.push(result(0.4875,8.1,'bisection'));
  assert.equal(adaptive.nextProbe(history).passingCandidates[0].mid,0.475);
});

test('all seven permitted probes can be consumed without duplicate mid values',()=>{
  const history=[result(0.55,9,'grid'),result(0.5,9,'grid'),result(0.45,9,'grid'),result(0.4,9,'grid'),
    result(0.35,7.5,'grid'),result(0.375,7.6,'bisection'),result(0.3875,8.1,'bisection')];
  assert.equal(history.length,adaptive.MAX_PROBES);
  assert.equal(adaptive.nextProbe(history).done,true);
  assert.equal(new Set(history.map(row=>row.mid)).size,7);
});

test('a safe FAIL at every fixed mid value blocks without inventing a PASS',()=>{
  const history=[0.55,0.5,0.45,0.4,0.35].map(mid=>result(mid,8.01,'grid'));
  const outcome=adaptive.nextProbe(history);
  assert.equal(outcome.done,true);
  assert.equal(outcome.decision,'BLOCKED_NO_FEASIBLE_MID_RESPONSE');
  assert.deepEqual(outcome.passingCandidates,[]);
});

test('unsafe, incomplete, non-finite, duplicate, and non-four-decimal histories fail closed',()=>{
  assert.throws(()=>adaptive.nextProbe([{...result(0.55,8),safe:false}]),/unsafe, incomplete/);
  assert.throws(()=>adaptive.nextProbe([{...result(0.55,7),diagnosticsComplete:false}]),/unsafe, incomplete/);
  assert.throws(()=>adaptive.nextProbe([result(0.55,Number.NaN)]),/unsafe, incomplete/);
  assert.throws(()=>adaptive.nextProbe([result(0.55,7),result(0.55,7)]),/duplicate probe/);
  assert.throws(()=>adaptive.nextProbe([result(0.55555,7)]),/four decimal places/);
  assert.throws(()=>adaptive.nextProbe([{...result(0.55,8,'grid'),outcome:'FAIL'}]),/outcome disagrees/);
});

test('adaptive cell planners enforce the official velocity grid and exact per-candidate sizes',()=>{
  const probes=adaptive.probeCells(0.55);
  assert.equal(probes.length,16);
  assert.deepEqual(probes.map(cell=>cell.velocity),adaptive.OFFICIAL_VELOCITIES);
  assert.ok(probes.every(cell=>cell.pitch===51&&cell.response.low===0.35&&cell.response.bassHardness===0.5));
  const candidates=[{mid:0.55},{mid:0.5}];
  assert.equal(adaptive.screenCells(candidates).length,24);
  assert.equal(adaptive.fullCells(candidates[0]).length,64);
  assert.throws(()=>adaptive.screenCells([{mid:0.55},{mid:0.5},{mid:0.45}]),/top two/);
  assert.equal(new Set([...probes,...adaptive.screenCells(candidates)].map(cell=>cell.key)).size,40);
});

test('screen candidates use the existing worst-error, sum-square, higher-mid rank objective',()=>{
  const ranked=adaptive.rankScreenCandidates([
    {mid:0.55,safetyPass:true,spanErrorsByPitch:{48:[2,0,0],51:[0,0,0],54:[0,0,0],57:[0,0,0]}},
    {mid:0.5,safetyPass:true,spanErrorsByPitch:{48:[1,1,1],51:[1,1,1],54:[1,1,1],57:[1,1,1]}},
    {mid:0.6,safetyPass:false,spanErrorsByPitch:{48:[0,0,0],51:[0,0,0],54:[0,0,0],57:[0,0,0]}}
  ]);
  assert.deepEqual(ranked.map(row=>row.mid),[0.5,0.55]);
  assert.equal(ranked[0].rankMaxError,1);
  assert.equal(ranked[1].rankSumSquares,4);
});

test('budget arithmetic caps probes, screen, full, Stage3E, downstream, and global use independently',()=>{
  assert.deepEqual(adaptive.assertBudget({extension:{probes:112,screen:24,full:128,total:264},stage3Count:486,stage4Count:1423}),
    {parentCount:2235,extensionCount:264,stage3Count:486,stage4Count:1423,total:4408,remainingGlobal:56});
  assert.throws(()=>adaptive.assertBudget({extension:{probes:113,total:113}}),/extension allocation/);
  assert.throws(()=>adaptive.assertBudget({extension:265}),/extension allocation/);
  assert.throws(()=>adaptive.assertBudget({extension:264,parentCount:2236}),/Stage3E cap/);
  assert.throws(()=>adaptive.assertBudget({extension:264,stage3Count:487}),/downstream stage cap/);
  assert.throws(()=>adaptive.assertBudget({extension:264,stage4Count:1424}),/downstream stage cap/);
});

test('started and ambiguous cells consume the extension budget and cannot disappear from accounting',()=>{
  assert.deepEqual(adaptive.countCalls({cells:{a:{kind:'probe',state:'IN_PROGRESS'},b:{kind:'screen',state:'COMPLETE'},
    c:{kind:'full',state:'AMBIGUOUS'},d:{kind:'full',state:'PENDING'}}}),{probes:1,screen:1,full:1,total:3});
});

test('master schedules the adaptive sidecar and reserves no calls for the historical mid-full tranche',()=>{
  assert.equal(master.PHASE_FLOW.at(-1).phase,'adaptive-mid-01');
  assert.equal(master.PHASE_FLOW.some(item=>item.phase==='mid-full'),false);
  assert.equal(master.STAGE3E_BUDGETS['mid-full'],0);
  assert.equal(master.STAGE3E_BUDGETS['adaptive-mid-01'],264);
  assert.equal(master.TOTAL_RENDER_BUDGET,4408);
  assert.equal(adaptiveRunner.EXTENSION,'adaptive-mid-01');
  assert.equal(adaptiveRunner.PARENT_RENDER_COUNT,2235);
});

test('step results expose their payload and resume reconciles only SHA-verified completed probe evidence',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-adaptive-ledger-recovery-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo'),home=path.join(temp,'home'),commonDirectory=path.join(root,'.git','soraoto-agent-state','7');
  fs.mkdirSync(commonDirectory,{recursive:true});fs.mkdirSync(home,{recursive:true});
  const roots=adaptiveRunner.sidecarRoots(root,home,core.EPOCH,commonDirectory),plan={sha256:'c'.repeat(64)};
  const parent={roots,parentManifestSha256:'a'.repeat(64),identitySha256:'b'.repeat(64)};
  const cells=adaptive.probeCells(0.55),records={},cellObservationSha256=[];
  for(const cell of cells){
    const marker={schemaVersion:1,extension:adaptiveRunner.EXTENSION,key:cell.key,kind:'probe',cell,
      identitySha256:parent.identitySha256,executionPlanSha256:plan.sha256,startedAt:'2026-10-16T00:00:00.000Z'};
    const markerStored=core.writeImmutableDual(roots,`cells/${cell.key}.started.json`,core.canonicalBytes(marker));
    const observation={schemaVersion:1,extension:adaptiveRunner.EXTENSION,key:cell.key,cell,
      observation:{pitch:cell.pitch,velocity:cell.velocity,metrics:{peakDbfs:-20}}};
    const observationStored=core.writeImmutableDual(roots,`cells/${cell.key}.observation.json`,core.canonicalBytes(observation));
    records[cell.key]={key:cell.key,kind:'probe',state:'COMPLETE',markerSha256:markerStored.sha256,observationSha256:observationStored.sha256};
    cellObservationSha256.push(observationStored.sha256);
  }
  const probe={schemaVersion:1,ordinal:1,mid:0.55,kind:'grid',safe:true,diagnosticsComplete:true,spanErrorDb:7.9,
    outcome:'PASS',decision:'STAGE3E_MIDI51_PASS',parentManifestSha256:parent.parentManifestSha256,
    executionPlanSha256:plan.sha256,cellKeys:cells.map(cell=>cell.key),cellObservationSha256};
  const resultStored=core.writeImmutableDual(roots,'probe-results/01.json',core.canonicalBytes(probe));
  const ledger={renderCount:cells.length,cells:records,probes:[{resultSha256:resultStored.sha256}]};
  const saved=adaptiveRunner.persistStepResult(roots,'steps/payload.json',{decision:'STEP_COMPLETE'},ledger,()=> '2026-10-16T00:00:00.000Z');
  assert.deepEqual(saved.value,{decision:'STEP_COMPLETE'});
  const history=adaptiveRunner.loadProbeHistory(parent,ledger,plan,()=> '2026-10-16T00:00:00.000Z');
  assert.deepEqual(history,[{...probe,resultSha256:resultStored.sha256}]);
  assert.deepEqual(ledger.probes,history);
  assert.equal(ledger.renderCount,16);
  const events=core.readDualBytes(roots,'journal/events.jsonl').bytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(events.some(event=>event.type==='PROBE_LEDGER_RECONCILED'&&event.probeResultSha256[0]===resultStored.sha256));
  const tampered={...ledger,probes:[{resultSha256:'d'.repeat(64)}]};
  assert.throws(()=>adaptiveRunner.loadProbeHistory(parent,tampered,plan),/probe ledger differs/);
  assert.deepEqual(tampered.probes,[{resultSha256:'d'.repeat(64)}]);
});

test('runtime revision accepts only the intact first 16-cell 0.55 PASS state',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-adaptive-runtime-revision-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo'),home=path.join(temp,'home'),commonDirectory=path.join(root,'.git');
  fs.mkdirSync(commonDirectory,{recursive:true});fs.mkdirSync(home,{recursive:true});
  const fixturePath=path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
  fs.mkdirSync(path.dirname(fixturePath),{recursive:true});
  const cells=adaptive.probeCells(0.55),fixture={directCells:cells.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,
    metrics:{envelopeDbfs:[-40,-30,-20,-20-cell.velocity/20]}}))};
  fs.writeFileSync(fixturePath,JSON.stringify(fixture));
  const roots=adaptiveRunner.sidecarRoots(root,home,core.EPOCH,commonDirectory),plan={sha256:'c'.repeat(64),plan:{runnerSha256:'e'.repeat(64)}};
  const parent={root,home,commonDirectory,roots,manifest:{epoch:core.EPOCH,helperHashes:{
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs':'e'.repeat(64)}},
    parentManifestSha256:'a'.repeat(64),identitySha256:'b'.repeat(64)};
  const records={},observations=[],cellObservationSha256=[];
  for(const cell of cells){
    const marker={schemaVersion:1,extension:adaptiveRunner.EXTENSION,key:cell.key,kind:'probe',cell,
      identitySha256:parent.identitySha256,executionPlanSha256:plan.sha256,startedAt:'2026-10-16T00:00:00.000Z'};
    const markerStored=core.writeImmutableDual(roots,`cells/${cell.key}.started.json`,core.canonicalBytes(marker));
    const observation={pitch:cell.pitch,velocity:cell.velocity,metrics:{finite:true,peakDbfs:-20,fullRenderPeakDbfs:-20,outputGuardHits:0,
      envelopeDbfs:[-40,-30,-20,-20-cell.velocity/20],stage2mHammer:{effectiveHardness:1,initialHammerVelocity:1,
        contactDurationSamples:1,peakForce:1,maxCompression:1,postContactTransverseEnergy:1},
      soundboardDiagnostics:{},stage3eVelocityResponse:{}}};
    const observationStored=core.writeImmutableDual(roots,`cells/${cell.key}.observation.json`,core.canonicalBytes({
      schemaVersion:1,extension:adaptiveRunner.EXTENSION,key:cell.key,cell,observation}));
    records[cell.key]={key:cell.key,kind:'probe',state:'COMPLETE',markerSha256:markerStored.sha256,
      observationSha256:observationStored.sha256};
    observations.push(observation);cellObservationSha256.push(observationStored.sha256);
  }
  const summary=evaluator.evaluateProbe(observations,fixture);
  assert.equal(summary.adaptiveOutcome,'PASS');
  const result={schemaVersion:1,issue:7,epoch:core.EPOCH,extension:adaptiveRunner.EXTENSION,ordinal:1,mid:0.55,kind:'grid',
    safe:summary.safe,diagnosticsComplete:summary.diagnosticsComplete,spanErrorDb:summary.span.errorDb,outcome:summary.adaptiveOutcome,
    decision:summary.decision,summary,parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,
    cellKeys:cells.map(cell=>cell.key),cellObservationSha256};
  const saved=core.writeImmutableDual(roots,'probe-results/01.json',core.canonicalBytes(result));
  const ledger={schemaVersion:1,schema:'issue7-stage3e-adaptive-mid-ledger/v1',parentManifestSha256:parent.parentManifestSha256,
    executionPlanSha256:plan.sha256,renderCount:16,cells:records,probes:[{resultSha256:saved.sha256}],screen:null,full:[],decision:null};
  const ledgerState={ledger,sha256:core.sha256(core.canonicalBytes(ledger))};
  const revision={initialLedgerSha256:ledgerState.sha256,firstProbe:{ordinal:1,resultSha256:saved.sha256,mid:0.55,outcome:'PASS',
    decision:summary.decision,spanErrorDb:summary.span.errorDb,safe:true,diagnosticsComplete:true,renderCount:16}};
  assert.equal(adaptiveRunner.verifyRevisionProbe(parent,plan,ledgerState,revision,{initialOnly:true}).sha256,saved.sha256);
  const revisionBinding={value:revision,sha256:'f'.repeat(64)};
  assert.equal(adaptiveRunner.verifyRevisionProbe({...parent,runtimeRevision:revisionBinding,runtimeRevisions:[revisionBinding]},
    plan,ledgerState,revision,{initialOnly:true}).sha256,saved.sha256);
  assert.throws(()=>adaptiveRunner.verifyRevisionProbe(parent,plan,{...ledgerState,ledger:{...ledger,renderCount:17}},revision,
    {initialOnly:true}),/BLOCKED_ADAPTIVE_MID_LEDGER/);
});

test('runtime revision 2 binds the exact completed 72-cell checkpoint and immutable screen result',()=>{
  const previousRevision={sha256:'a'.repeat(64),value:{codeRevision:'b'.repeat(40),newRunnerSha256:'c'.repeat(64)}};
  const cells={};
  for(let index=0;index<72;index++){
    const kind=index<48?'probe':'screen',key=kind+'-'+String(index).padStart(2,'0');
    cells[key]={key,kind,state:'COMPLETE',markerSha256:'d'.repeat(64),observationSha256:'e'.repeat(64)};
  }
  const ledger={renderCount:72,cells,probes:['f','1','2'].map(value=>({resultSha256:value.repeat(64)})),full:[],decision:null};
  const screen={sha256:'9'.repeat(64),value:{runtimeRevisionSha256:previousRevision.sha256,
    runnerSha256:previousRevision.value.newRunnerSha256,selectedCandidates:[{mid:0.55},{mid:0.5625}]}};
  const counts=adaptive.countCalls(ledger),revision={revisionNumber:2,
    approvalSha256:'1c45f66a9c83e651ceab2b4e593f1c43c938fcc0827b5015f73981950e207574',
    previousRuntimeRevisionSha256:previousRevision.sha256,previousCodeRevision:previousRevision.value.codeRevision,
    previousRunnerSha256:previousRevision.value.newRunnerSha256,priorLedgerSnapshot:ledger,
    priorLedgerSha256:core.sha256(core.canonicalBytes(ledger)),priorCounts:counts,
    probeResultSha256:ledger.probes.map(item=>item.resultSha256),screenResultSha256:screen.sha256};
  assert.equal(adaptiveRunner.validateRuntimeRevision2Snapshot(revision,previousRevision,screen,screen.sha256),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision2Snapshot({...revision,
    priorCounts:{...counts,total:71}},previousRevision,screen,screen.sha256),/exact approved 72-cell screen checkpoint/);
  const changedScreen={...screen,sha256:'8'.repeat(64)};
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision2Snapshot(revision,previousRevision,
    changedScreen,changedScreen.sha256),/exact approved 72-cell screen checkpoint/);
});

test('screen-to-full handoff reads candidates from the immutable step-result wrapper',()=>{
  const selectedCandidates=[{low:0.35,mid:0.55,bassHardness:0.5},{low:0.35,mid:0.5625,bassHardness:0.5}];
  assert.deepEqual(adaptiveRunner.fullCandidatesFromScreen({value:{selectedCandidates}}),selectedCandidates);
  assert.throws(()=>adaptiveRunner.fullCandidatesFromScreen({selectedCandidates}),
    /immutable screen result has no selected candidates/);
});
