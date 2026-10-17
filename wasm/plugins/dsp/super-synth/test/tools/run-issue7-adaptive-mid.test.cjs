'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const adaptive=require('./issue7-adaptive-mid-core.cjs');
const core=require('./issue7-current-build-core.cjs');
const adaptiveRunner=require('./run-issue7-adaptive-mid.cjs');
const stage3eRunner=require('./run-issue7-stage3e-current-build.cjs');
const evaluator=require('./issue7-adaptive-mid-evaluator.cjs');
const master=require('./run-issue7-current-build.cjs');

function result(mid,spanErrorDb,kind){return {mid,spanErrorDb,safe:true,diagnosticsComplete:true,kind};}

function selectedEvidenceFixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-adaptive-verify-fixture-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const home=path.join(temp,'home'),commonDirectory=path.join(temp,'common');
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(commonDirectory,{recursive:true});
  const root=adaptiveRunner.ROOT,roots=adaptiveRunner.sidecarRoots(root,home,core.EPOCH,commonDirectory);
  const rev1={sha256:'a'.repeat(64),value:{codeRevision:'1'.repeat(40),newRunnerSha256:'b'.repeat(64)}};
  const rev2={sha256:'c'.repeat(64),value:{codeRevision:'2'.repeat(40),newRunnerSha256:'d'.repeat(64)}};
  const parent={root,home,commonDirectory,roots,parentManifestSha256:'e'.repeat(64),identity:{fixture:true},
    identitySha256:'f'.repeat(64),runtimeRevision:rev2,runtimeRevisions:[rev1,rev2],
    manifest:{epoch:core.EPOCH,creatorRevision:'2'.repeat(40),helperHashes:{
      'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs':rev2.value.newRunnerSha256,
      'wasm/plugins/dsp/super-synth/test/tools/issue7-adaptive-mid-core.cjs':'3'.repeat(64),
      'wasm/plugins/dsp/super-synth/test/tools/issue7-adaptive-mid-evaluator.cjs':'4'.repeat(64)},
      parents:{'low-full':{resultSha256:'5'.repeat(64)},'midi51-final-diagnostic':{resultSha256:'6'.repeat(64)}}}};
  const plan=adaptiveRunner.ensureExecutionPlan(parent),tuple={low:0.35,mid:0.55,bassHardness:0.5};
  const store=(relative,value)=>core.writeImmutableDual(roots,relative,core.canonicalBytes(value));
  const probe=store('probe-results/01.json',{ordinal:1,runtimeRevisionSha256:rev2.sha256,runnerSha256:rev2.value.newRunnerSha256});
  const screen=store('screen-result.json',{runtimeRevisionSha256:rev2.sha256,runnerSha256:rev2.value.newRunnerSha256,selectedCandidates:[tuple]});
  const full=store('full-result.json',{decision:'ADAPTIVE_MID_FULL_PASS',runtimeRevisionSha256:rev2.sha256,runnerSha256:rev2.value.newRunnerSha256,
    selectedTuple:tuple,candidates:[{tuple,pass:true}]});
  const extension=store('extension-result.json',{decision:'ADAPTIVE_MID_FULL_PASS',parentManifestSha256:parent.parentManifestSha256,
    executionPlanSha256:plan.sha256,fullResultSha256:full.sha256,screenResultSha256:screen.sha256,
    runtimeRevisionSha256:rev2.sha256,probeResultSha256:[probe.sha256],creatorRevision:parent.manifest.creatorRevision});
  const selection={schemaVersion:1,schema:'issue7-stage3e-extension-selection/v1',decision:'ADAPTIVE_MID_FULL_PASS',
    runtimeRevisionSha256:rev2.sha256,selectedResponse:tuple,identitySha256:parent.identitySha256,executionPlanSha256:plan.sha256,
    extensionResultSha256:extension.sha256,fullResultSha256:full.sha256,screenResultSha256:screen.sha256,probeResultSha256:[probe.sha256],
    parent:{manifestSha256:parent.parentManifestSha256,lowFullResultSha256:'5'.repeat(64),
      finalMidi51ResultSha256:'6'.repeat(64),finalMidi51Outcome:'FAIL',finalMidi51PassingCandidates:0}};
  const savedSelection=store('selection.json',selection);
  const prepared={parent,plan,state:{ledger:{renderCount:136,cells:{}}},counts:{probes:48,screen:24,full:64,total:136},budget:{total:2037}};
  return {root,home,commonDirectory,roots,parent,prepared,selection,savedSelection,extension,full,screen,probe};
}

function snapshotEvidence(roots){
  const out=[];
  for(const base of [roots.primary,roots.secondary]){
    if(!fs.existsSync(base))continue;
    const visit=directory=>{
      for(const name of fs.readdirSync(directory).sort()){
        const file=path.join(directory,name),stat=fs.lstatSync(file);
        if(stat.isDirectory())visit(file);
        else out.push({file:path.relative(base,file),bytes:fs.readFileSync(file).length,
          sha256:core.sha256(fs.readFileSync(file)),mtimeMs:stat.mtimeMs});
      }
    };
    visit(base);
  }
  return out;
}

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

test('budget exhaustion is checked before step plan, CELL_STARTED marker, ledger, or DSP write',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-adaptive-budget-preflight-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const home=path.join(temp,'home'),commonDirectory=path.join(temp,'common');
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(commonDirectory,{recursive:true});
  const roots=adaptiveRunner.sidecarRoots(adaptiveRunner.ROOT,home,core.EPOCH,commonDirectory);
  const record=stage3eRunner.identityRecord(adaptiveRunner.ROOT),identity=stage3eRunner.currentIdentity(adaptiveRunner.ROOT,record);
  const parent={root:adaptiveRunner.ROOT,home,commonDirectory,roots,record,identity,
    identitySha256:core.sha256(core.canonicalBytes(identity)),parentManifestSha256:'a'.repeat(64),
    manifest:{epoch:core.EPOCH,helperHashes:{["wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs"]:'b'.repeat(64)}}};
  const plan={sha256:'c'.repeat(64)},ledger={renderCount:0,cells:{},probes:[],screen:null,full:[],decision:null};
  const before=structuredClone(ledger),cell=adaptive.probeCells(0.55)[0],originalAssertBudget=adaptive.assertBudget;
  let budgetInput=null,renderCalls=0;
  adaptive.assertBudget=input=>{budgetInput=input;throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: injected cap exhaustion');};
  t.after(()=>{adaptive.assertBudget=originalAssertBudget;});
  assert.throws(()=>adaptiveRunner.runCells({root:parent.root,home,epoch:core.EPOCH,commonDirectory,parent,plan,ledger,cells:[cell],
    now:()=> '2026-10-17T00:00:00.000Z',render:()=>{renderCalls+=1;return {};}}),/BLOCKED_ADAPTIVE_MID_BUDGET/);
  assert.deepEqual(budgetInput.extension,{probes:1,screen:0,full:0,total:1});
  assert.equal(budgetInput.stage3Count,0);assert.equal(budgetInput.stage4Count,0);
  assert.equal(renderCalls,0);assert.deepEqual(ledger,before);
  assert.deepEqual([roots.primary,roots.secondary].map(directory=>fs.existsSync(directory)),[false,false]);
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

test('adaptive --verify validates a valid full-pass selection read-only',t=>{
  const fixture=selectedEvidenceFixture(t),result=adaptiveRunner.run({mode:'verify',root:fixture.root,home:fixture.home,
    commonDirectory:fixture.commonDirectory,readOnlyPreflight:()=>fixture.prepared});
  assert.equal(result.decision,'ADAPTIVE_MID_VERIFY_OK');
  assert.equal(result.selectedResponse.mid,0.55);
  assert.equal(result.renders,0);assert.equal(result.writes,0);
});

test('adaptive --verify blocks matching dual-store selection bytes with a mismatched full-result SHA and writes nothing',t=>{
  const fixture=selectedEvidenceFixture(t),corrupt={...fixture.selection,fullResultSha256:'9'.repeat(64)};
  const bytes=core.canonicalBytes(corrupt);
  for(const file of [path.join(fixture.roots.primary,'selection.json'),path.join(fixture.roots.secondary,'selection.json')])
    fs.writeFileSync(file,bytes);
  const before=snapshotEvidence(fixture.roots),result=adaptiveRunner.run({mode:'verify',root:fixture.root,home:fixture.home,
    commonDirectory:fixture.commonDirectory,readOnlyPreflight:()=>fixture.prepared});
  const after=snapshotEvidence(fixture.roots);
  assert.equal(result.decision,'BLOCKED_ADAPTIVE_MID_SELECTION');
  assert.deepEqual(after,before);
  assert.equal(result.renders,0);assert.equal(result.writes,0);
});

test('adaptive --verify blocks a missing selection while a PASS terminal result remains and writes nothing',t=>{
  const fixture=selectedEvidenceFixture(t);
  for(const file of [path.join(fixture.roots.primary,'selection.json'),path.join(fixture.roots.secondary,'selection.json')])fs.rmSync(file);
  const before=snapshotEvidence(fixture.roots),result=adaptiveRunner.run({mode:'verify',root:fixture.root,home:fixture.home,
    commonDirectory:fixture.commonDirectory,readOnlyPreflight:()=>fixture.prepared});
  assert.equal(result.decision,'BLOCKED_ADAPTIVE_MID_SELECTION');
  assert.deepEqual(snapshotEvidence(fixture.roots),before);
  assert.equal(result.renders,0);assert.equal(result.writes,0);
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

test('runtime revision 2 remains verifiable from its immutable commit while a separately approved revision 3 is pending',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-adaptive-runtime-revision-chain-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root);
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['init']);git(['config','user.name','Issue 7 revision test']);git(['config','user.email','issue7-revision@example.invalid']);
  const runnerRel='wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs';
  const testRel='wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.test.cjs';
  const write=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  write(runnerRel,'revision 1 runner\n');write(testRel,'revision 1 test\n');
  git(['add',runnerRel,testRel]);git(['commit','-m','revision 1']);
  const revision1Head=git(['rev-parse','HEAD']),revision1RunnerSha=core.sha256(fs.readFileSync(path.join(root,runnerRel)));
  const previousRevision={sha256:'a'.repeat(64),value:{codeRevision:revision1Head,newRunnerSha256:revision1RunnerSha}};
  const frozen={epoch:core.EPOCH,creatorRevision:revision1Head},parentManifestSha256='b'.repeat(64);
  write(runnerRel,'revision 2 runner\n');write(testRel,'revision 2 test\n');
  git(['add',runnerRel,testRel]);git(['commit','-m','revision 2']);
  const revision2Head=git(['rev-parse','HEAD']),revision2RunnerSha=core.sha256(fs.readFileSync(path.join(root,runnerRel))),
    revision2TestSha=core.sha256(fs.readFileSync(path.join(root,testRel)));
  const revision2Diff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',`${revision1Head}..${revision2Head}`,'--',runnerRel,testRel],
    {cwd:root});
  const revision2={schemaVersion:1,schema:'issue7-stage3e-adaptive-runtime-revision/v1',revisionNumber:2,issue:7,
    extension:adaptiveRunner.EXTENSION,epoch:core.EPOCH,parentManifestSha256,previousCreatorRevision:revision1Head,
    previousCodeRevision:revision1Head,previousRuntimeRevisionSha256:previousRevision.sha256,
    previousRunnerSha256:revision1RunnerSha,approvalSha256:'1c45f66a9c83e651ceab2b4e593f1c43c938fcc0827b5015f73981950e207574',
    codeRevision:revision2Head,newRunnerSha256:revision2RunnerSha,newTestSha256:revision2TestSha,
    changedPaths:[runnerRel,testRel].sort(),diffSha256:core.sha256(revision2Diff)};
  write(runnerRel,'revision 3 runner\n');write(testRel,'revision 3 test\n');
  git(['add',runnerRel,testRel]);git(['commit','-m','revision 3']);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision2Code(root,frozen,parentManifestSha256,previousRevision,revision2),
    /revision 2 committed bytes differ/);
  assert.equal(adaptiveRunner.validateRuntimeRevision2Code(root,frozen,parentManifestSha256,previousRevision,revision2,
    {requireCurrentSource:false}),true);
});

test('screen-to-full handoff reads candidates from the immutable step-result wrapper',()=>{
  const selectedCandidates=[{low:0.35,mid:0.55,bassHardness:0.5},{low:0.35,mid:0.5625,bassHardness:0.5}];
  assert.deepEqual(adaptiveRunner.fullCandidatesFromScreen({value:{selectedCandidates}}),selectedCandidates);
  assert.throws(()=>adaptiveRunner.fullCandidatesFromScreen({selectedCandidates}),
    /immutable screen result has no selected candidates/);
});

test('revision 3 stays bound to its recorded commit while revision 4 binds the exact six-file recovery commit',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-runtime-revision-04-chain-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root);
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['init','-b','codex/issue-7-supersynth-v9']);
  git(['config','user.name','Issue 7 revision 4 test']);git(['config','user.email','issue7-revision4@example.invalid']);
  const remediationPaths=[
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-current-build.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-current-build.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.test.cjs'
  ].sort();
  const recoveryPaths=adaptiveRunner.RUNTIME_REVISION_04_PATHS;
  const write=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  for(const relative of remediationPaths)write(relative,`revision 2:${relative}\n`);
  git(['add','--',...remediationPaths]);git(['commit','-m','revision 2 creator']);
  const creatorRevision=git(['rev-parse','HEAD']),runnerRel=remediationPaths[0],testRel=remediationPaths[1];
  const previousRevision={sha256:'a'.repeat(64),value:{revisionNumber:2,codeRevision:creatorRevision,
    newRunnerSha256:core.sha256(fs.readFileSync(path.join(root,runnerRel)))}};
  const frozen={epoch:core.EPOCH,creatorRevision},parentManifestSha256='b'.repeat(64);
  for(const relative of remediationPaths)write(relative,`revision 3:${relative}\n`);
  git(['add','--',...remediationPaths]);git(['commit','-m','revision 3 recorded source']);
  const revision3Code=git(['rev-parse','HEAD']),revision3Paths=execFileSync('rtk',['proxy','git','diff','--name-only','--no-renames',
    `${creatorRevision}..${revision3Code}`],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).sort();
  const revision3Changed=Object.fromEntries(revision3Paths.map(relative=>[relative,core.sha256(fs.readFileSync(path.join(root,relative)))]));
  const revision3Diff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',`${creatorRevision}..${revision3Code}`,
    '--',...revision3Paths],{cwd:root});
  const revision3={schemaVersion:1,schema:'issue7-stage3e-adaptive-runtime-revision/v1',issue:7,revisionNumber:3,
    extension:adaptiveRunner.EXTENSION,epoch:core.EPOCH,parentManifestSha256,previousCreatorRevision:creatorRevision,
    previousCodeRevision:creatorRevision,previousRuntimeRevisionSha256:previousRevision.sha256,
    previousRunnerSha256:previousRevision.value.newRunnerSha256,codeRevision:revision3Code,
    newRunnerSha256:revision3Changed[runnerRel],newTestSha256:revision3Changed[testRel],
    changedPaths:revision3Paths,changedFileSha256:revision3Changed,
    approvalSha256:'ac8b3a410e426edb09889dfccaffef23628415cc4acbd72f4be7544abc85dce6',diffSha256:core.sha256(revision3Diff)};
  const revision3Sha256=core.sha256(core.canonicalBytes(revision3)),recordedRevision3={sha256:revision3Sha256,value:revision3};
  for(const relative of recoveryPaths)write(relative,`revision 4:${relative}\n`);
  git(['add','--',...recoveryPaths]);git(['commit','-m','revision 4 recovery code']);
  const recoveryCommit=git(['rev-parse','HEAD']),changedFileSha256=Object.fromEntries(recoveryPaths.map(relative=>[
    relative,core.sha256(fs.readFileSync(path.join(root,relative)))]));
  const recoveryDiff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',`${revision3Code}..${recoveryCommit}`,
    '--',...recoveryPaths],{cwd:root});
  const revision4={schemaVersion:1,schema:'issue7-stage3e-adaptive-runtime-revision/v1',issue:7,revisionNumber:4,
    extension:adaptiveRunner.EXTENSION,epoch:core.EPOCH,parentManifestSha256,previousCreatorRevision:creatorRevision,
    previousCodeRevision:revision3Code,previousRuntimeRevisionSha256:revision3Sha256,
    previousRunnerSha256:revision3.newRunnerSha256,codeRevision:recoveryCommit,
    newRunnerSha256:changedFileSha256[runnerRel],newTestSha256:changedFileSha256[testRel],
    changedPaths:recoveryPaths,changedFileSha256,approvalSha256:adaptiveRunner.RUNTIME_REVISION_04_APPROVAL_SHA256,
    diffSha256:core.sha256(recoveryDiff)};
  assert.equal(adaptiveRunner.validateRuntimeRevision3Code(root,frozen,parentManifestSha256,previousRevision,revision3),true);
  assert.equal(adaptiveRunner.validateRuntimeRevision4Code(root,frozen,parentManifestSha256,recordedRevision3,revision4),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision3Code(root,frozen,parentManifestSha256,previousRevision,
    {...revision3,diffSha256:'f'.repeat(64)}),/revision 3 exact source diff/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision4Code(root,frozen,parentManifestSha256,recordedRevision3,
    {...revision4,changedPaths:[...recoveryPaths,'README.md'].sort()}),/revision 4 identity/);
  for(const relative of [
    'wasm/plugins/dsp/super-synth/presets.json','wasm/shared/generated/super-synth_grand_profiles.h',
    'wasm/shared/generated/super-synth_descriptor.cbor','wasm/shared/generated/super-synth_descriptor.h'
  ])write(relative,`promotion:${relative}\n`);
  const promotionPaths=[
    'wasm/plugins/dsp/super-synth/presets.json','wasm/shared/generated/super-synth_grand_profiles.h',
    'wasm/shared/generated/super-synth_descriptor.cbor','wasm/shared/generated/super-synth_descriptor.h'
  ].sort();
  git(['add','--',...promotionPaths]);git(['commit','-m','stage3e: promote selected velocity response']);
  assert.equal(adaptiveRunner.validateRuntimeRevision4Code(root,frozen,parentManifestSha256,recordedRevision3,revision4),true);
  write('README.md','unexpected after R\n');git(['add','README.md']);git(['commit','-m','unexpected later HEAD']);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision4Code(root,frozen,parentManifestSha256,recordedRevision3,revision4),
    /HEAD after revision 4 is not its exact single-parent four-path promotion/);
});

test('runtime revision 4 snapshot and acceptance event fail closed on drift, missing journal, or duplicates',()=>{
  const cells={};
  for(let index=0;index<136;index++){
    const kind=index<48?'probe':index<72?'screen':'full',key=`${kind}-${String(index).padStart(3,'0')}`;
    cells[key]={key,kind,state:'COMPLETE',markerSha256:'1'.repeat(64),observationSha256:'2'.repeat(64)};
  }
  const ledger={renderCount:136,cells,probes:Array.from({length:3},(_,index)=>({resultSha256:String(index+3).repeat(64)}))};
  const priorLedgerSha256=core.sha256(core.canonicalBytes(ledger)),counts={probes:48,screen:24,full:64,total:136};
  const previous={sha256:'a'.repeat(64),value:{priorLedgerSnapshot:ledger,priorLedgerSha256,priorCounts:counts,
    probeResultSha256:ledger.probes.map(item=>item.resultSha256),screenResultSha256:'b'.repeat(64),
    fullResultSha256:'c'.repeat(64),extensionResultSha256:'d'.repeat(64),selectionSha256:'e'.repeat(64)}};
  const selection={selectionSha256:previous.value.selectionSha256};
  const results={screen:{sha256:previous.value.screenResultSha256},full:{sha256:previous.value.fullResultSha256},
    extension:{sha256:previous.value.extensionResultSha256,value:{decision:'ADAPTIVE_MID_FULL_PASS'}}};
  const revision={revisionNumber:4,previousRuntimeRevisionSha256:previous.sha256,priorLedgerSnapshot:ledger,priorLedgerSha256,
    priorCounts:counts,probeResultSha256:previous.value.probeResultSha256,screenResultSha256:previous.value.screenResultSha256,
    fullResultSha256:previous.value.fullResultSha256,extensionResultSha256:previous.value.extensionResultSha256,
    selectionSha256:previous.value.selectionSha256};
  const ledgerState={ledger,sha256:priorLedgerSha256};
  assert.equal(adaptiveRunner.validateRuntimeRevision4Snapshot(revision,previous,selection,results,ledgerState),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision4Snapshot({...revision,selectionSha256:'f'.repeat(64)},previous,selection,results,ledgerState),
    /does not preserve the exact complete 136-cell/);
  const event={type:'RUNTIME_REVISION_ACCEPTED',revisionNumber:4,runtimeRevisionSha256:'f'.repeat(64),
    previousRuntimeRevisionSha256:previous.sha256,codeRevision:'9'.repeat(40),priorLedgerSha256,selectionSha256:selection.selectionSha256,
    changedPaths:adaptiveRunner.RUNTIME_REVISION_04_PATHS};
  const eventRecord={...revision,previousRuntimeRevisionSha256:previous.sha256,codeRevision:event.codeRevision,
    priorLedgerSha256,selectionSha256:selection.selectionSha256,changedPaths:adaptiveRunner.RUNTIME_REVISION_04_PATHS};
  assert.equal(adaptiveRunner.runtimeRevision4AcceptedEvent([event],eventRecord,event.runtimeRevisionSha256),true);
  assert.equal(adaptiveRunner.runtimeRevision4AcceptedEvent([],eventRecord,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision4AcceptedEvent([event,event],eventRecord,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision4AcceptedEvent([{...event,previousRuntimeRevisionSha256:'0'.repeat(64)}],eventRecord,event.runtimeRevisionSha256),false);
});
