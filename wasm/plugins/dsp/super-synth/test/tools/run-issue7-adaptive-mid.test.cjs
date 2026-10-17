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

function identityWorkspace(target){
  const source=stage3eRunner.identityRecord(adaptiveRunner.ROOT),reportPath='docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json';
  fs.mkdirSync(target,{recursive:true});
  const files=[...Object.values(source.inputs).map(entry=>entry.path),source.toolchain.toolchainFile,reportPath,
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-core.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs'];
  for(const build of Object.values(source.builds))files.push(`${build.buildDirectory}/CMakeCache.txt`,
    `${build.buildDirectory}/${build.wasm.path}`,`${build.buildDirectory}/generated/super-synth_descriptor.cbor`,
    `${build.buildDirectory}/generated/super-synth_descriptor.h`);
  for(const relative of files){
    const destination=path.join(target,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});
    const isInput=Object.values(source.inputs).some(entry=>entry.path===relative);
    const bytes=isInput?execFileSync('rtk',['proxy','git','show',`${source.sourceCommit}:${relative}`],
      {cwd:adaptiveRunner.ROOT,maxBuffer:16*1024*1024}):fs.readFileSync(path.join(adaptiveRunner.ROOT,relative));
    fs.writeFileSync(destination,bytes);
  }
  const record=structuredClone(source);
  record.toolchain.toolchainFileSha256=core.sha256(fs.readFileSync(path.join(target,record.toolchain.toolchainFile)));
  for(const entry of Object.values(record.inputs))entry.sha256=core.sha256(fs.readFileSync(path.join(target,entry.path)));
  for(const build of Object.values(record.builds)){
    build.cmakeCacheSha256=core.sha256(fs.readFileSync(path.join(target,`${build.buildDirectory}/CMakeCache.txt`)));
    build.wasm.sha256=core.sha256(fs.readFileSync(path.join(target,`${build.buildDirectory}/${build.wasm.path}`)));
  }
  const production=record.builds.production.buildDirectory;
  record.metadataOutputs.descriptorCborSha256=core.sha256(fs.readFileSync(path.join(target,`${production}/generated/super-synth_descriptor.cbor`)));
  record.metadataOutputs.descriptorHeaderSha256=core.sha256(fs.readFileSync(path.join(target,`${production}/generated/super-synth_descriptor.h`)));
  fs.writeFileSync(path.join(target,reportPath),`${JSON.stringify(record,null,2)}\n`);
  return {record,identity:stage3eRunner.currentIdentity(target,record)};
}

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
  const root=path.join(temp,'repo'),fixture=identityWorkspace(root);
  const roots=adaptiveRunner.sidecarRoots(root,home,core.EPOCH,commonDirectory);
  const {record,identity}=fixture;
  const parent={root,home,commonDirectory,roots,record,identity,
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

test('runtime revision 1 acceptance validates its original journal schema without a revision number',()=>{
  const revision={sha256:'a'.repeat(64),value:{firstProbe:{resultSha256:'b'.repeat(64)}}};
  const event={type:'RUNTIME_REVISION_ACCEPTED',runtimeRevisionSha256:revision.sha256,firstProbeResultSha256:revision.value.firstProbe.resultSha256};
  assert.equal(adaptiveRunner.runtimeRevision1AcceptedEvent([event],revision),true);
  assert.equal(adaptiveRunner.runtimeRevision1AcceptedEvent([{...event,firstProbeResultSha256:'c'.repeat(64)}],revision),false);
  assert.equal(adaptiveRunner.runtimeRevision1AcceptedEvent([event,event],revision),false);
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

test('runtime revision 5 binds the unchanged 136-cell lineage and accepts exactly one matching event',()=>{
  const cells={};
  for(let index=0;index<136;index++){
    const kind=index<48?'probe':index<72?'screen':'full',key=`${kind}-${String(index).padStart(3,'0')}`;
    cells[key]={key,kind,state:'COMPLETE',markerSha256:'1'.repeat(64),observationSha256:'2'.repeat(64)};
  }
  const executionPlanSha256='8'.repeat(64),ledger={renderCount:136,executionPlanSha256,cells,
    probes:Array.from({length:3},(_,index)=>({resultSha256:String(index+3).repeat(64)}))};
  const priorLedgerSha256=core.sha256(core.canonicalBytes(ledger)),counts={probes:48,screen:24,full:64,total:136};
  const previous={sha256:'a'.repeat(64),value:{revisionNumber:4,priorLedgerSnapshot:ledger,priorLedgerSha256,priorCounts:counts,
    probeResultSha256:ledger.probes.map(item=>item.resultSha256),screenResultSha256:'b'.repeat(64),
    fullResultSha256:'c'.repeat(64),extensionResultSha256:'d'.repeat(64),selectionSha256:'e'.repeat(64)}};
  const selection={selectionSha256:previous.value.selectionSha256,selection:{probeResultSha256:previous.value.probeResultSha256},
    extension:{executionPlanSha256}};
  const results={screen:{sha256:previous.value.screenResultSha256},full:{sha256:previous.value.fullResultSha256},
    extension:{sha256:previous.value.extensionResultSha256,value:{decision:'ADAPTIVE_MID_FULL_PASS'}}};
  const revision={revisionNumber:5,previousRuntimeRevisionSha256:previous.sha256,priorLedgerSnapshot:ledger,priorLedgerSha256,
    priorCounts:counts,probeResultSha256:previous.value.probeResultSha256,screenResultSha256:previous.value.screenResultSha256,
    fullResultSha256:previous.value.fullResultSha256,terminalResultSha256:previous.value.extensionResultSha256,
    extensionResultSha256:previous.value.extensionResultSha256,selectionSha256:previous.value.selectionSha256,executionPlanSha256};
  const ledgerState={ledger,sha256:priorLedgerSha256},plan={sha256:executionPlanSha256};
  assert.equal(adaptiveRunner.validateRuntimeRevision5Snapshot(revision,previous,selection,results,ledgerState,plan),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision5Snapshot({...revision,terminalResultSha256:'f'.repeat(64)},
    previous,selection,results,ledgerState,plan),/revision 5 does not preserve the exact selected 136-cell checkpoint/);
  const event={type:'RUNTIME_REVISION_ACCEPTED',revisionNumber:5,runtimeRevisionSha256:'9'.repeat(64),
    previousRuntimeRevisionSha256:previous.sha256,codeRevision:'7'.repeat(40),promotionCommit:'6'.repeat(40),
    promotionReceiptSha256:'5'.repeat(64),priorLedgerSha256,selectionSha256:selection.selectionSha256,
    changedPaths:adaptiveRunner.RUNTIME_REVISION_05_PATHS};
  const record={...revision,previousRuntimeRevisionSha256:previous.sha256,codeRevision:event.codeRevision,
    promotionCommit:event.promotionCommit,promotionReceiptSha256:event.promotionReceiptSha256,
    priorLedgerSha256,selectionSha256:selection.selectionSha256,changedPaths:adaptiveRunner.RUNTIME_REVISION_05_PATHS};
  assert.equal(adaptiveRunner.runtimeRevision5AcceptedEvent([event],record,event.runtimeRevisionSha256),true);
  assert.equal(adaptiveRunner.runtimeRevision5AcceptedEvent([],record,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision5AcceptedEvent([event,event],record,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision5AcceptedEvent([{...event,promotionReceiptSha256:'0'.repeat(64)}],record,event.runtimeRevisionSha256),false);
});

test('runtime revision 6 preserves the selected 136-cell checkpoint and accepts exactly one matching event',()=>{
  const previous={sha256:'a'.repeat(64),value:{revisionNumber:5,codeRevision:adaptiveRunner.RUNTIME_REVISION_05_CODE_REVISION,
    priorLedgerSha256:'1'.repeat(64),priorLedgerSnapshot:{renderCount:136},priorCounts:{probes:48,screen:24,full:64,total:136},
    probeResultSha256:['2'.repeat(64)],screenResultSha256:'3'.repeat(64),fullResultSha256:'4'.repeat(64),
    terminalResultSha256:'5'.repeat(64),extensionResultSha256:'5'.repeat(64),selectionSha256:'6'.repeat(64),
    executionPlanSha256:'7'.repeat(64)}};
  const revision={...previous.value,revisionNumber:6,previousCodeRevision:previous.value.codeRevision,
    previousRuntimeRevisionSha256:previous.sha256};
  assert.equal(adaptiveRunner.validateRuntimeRevision6Snapshot(revision,previous),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision6Snapshot({...revision,selectionSha256:'8'.repeat(64)},previous),
    /does not preserve the exact R5 136-cell checkpoint/);
  const event={type:'RUNTIME_REVISION_ACCEPTED',revisionNumber:6,runtimeRevisionSha256:'9'.repeat(64),
    previousRuntimeRevisionSha256:previous.sha256,codeRevision:'b'.repeat(40),priorLedgerSha256:revision.priorLedgerSha256,
    selectionSha256:revision.selectionSha256,changedPaths:adaptiveRunner.RUNTIME_REVISION_06_PATHS};
  const record={...revision,codeRevision:event.codeRevision,changedPaths:adaptiveRunner.RUNTIME_REVISION_06_PATHS};
  assert.equal(adaptiveRunner.runtimeRevision6AcceptedEvent([event],record,event.runtimeRevisionSha256),true);
  assert.equal(adaptiveRunner.runtimeRevision6AcceptedEvent([],record,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision6AcceptedEvent([event,event],record,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision6AcceptedEvent([{...event,selectionSha256:'0'.repeat(64)}],record,event.runtimeRevisionSha256),false);
});

test('runtime revision 7 preserves R6 evidence and accepts exactly one matching event',()=>{
  const previous={sha256:adaptiveRunner.RUNTIME_REVISION_06_SHA256,value:{schemaVersion:1,
    schema:'issue7-stage3e-adaptive-runtime-revision/v1',issue:7,extension:adaptiveRunner.EXTENSION,epoch:core.EPOCH,
    parentManifestSha256:'f'.repeat(64),revisionNumber:6,
    codeRevision:adaptiveRunner.RUNTIME_REVISION_06_CODE_REVISION,priorLedgerSha256:'1'.repeat(64),
    priorLedgerSnapshot:{renderCount:136},priorCounts:{probes:48,screen:24,full:64,total:136},
    probeResultSha256:['2'.repeat(64)],screenResultSha256:'3'.repeat(64),fullResultSha256:'4'.repeat(64),
    terminalResultSha256:'5'.repeat(64),extensionResultSha256:'5'.repeat(64),selectionSha256:'6'.repeat(64),
    executionPlanSha256:'7'.repeat(64)}};
  const revision={...previous.value,revisionNumber:7,previousCodeRevision:previous.value.codeRevision,
    previousRuntimeRevisionSha256:previous.sha256};
  assert.equal(adaptiveRunner.validateRuntimeRevision7Snapshot(revision,previous),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision7Snapshot({...revision,fullResultSha256:'8'.repeat(64)},previous),
    /does not preserve the exact R6 136-cell checkpoint/);
  const event={type:'RUNTIME_REVISION_ACCEPTED',revisionNumber:7,runtimeRevisionSha256:'9'.repeat(64),
    previousRuntimeRevisionSha256:previous.sha256,codeRevision:'b'.repeat(40),priorLedgerSha256:revision.priorLedgerSha256,
    selectionSha256:revision.selectionSha256,changedPaths:adaptiveRunner.RUNTIME_REVISION_07_PATHS};
  const record={...revision,codeRevision:event.codeRevision,changedPaths:adaptiveRunner.RUNTIME_REVISION_07_PATHS};
  assert.equal(adaptiveRunner.runtimeRevision7AcceptedEvent([event],record,event.runtimeRevisionSha256),true);
  assert.equal(adaptiveRunner.runtimeRevision7AcceptedEvent([],record,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision7AcceptedEvent([event,event],record,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision7AcceptedEvent([{...event,previousRuntimeRevisionSha256:'0'.repeat(64)}],record,event.runtimeRevisionSha256),false);
});

test('runtime revision count is read from the verified parent checkpoint',()=>{
  assert.equal(adaptiveRunner.runtimeRevisionCount({parent:{runtimeRevisions:Array(6).fill({})}}),6);
  assert.equal(adaptiveRunner.runtimeRevisionCount({parent:{runtimeRevisions:Array(7).fill({})}}),7);
  assert.equal(adaptiveRunner.runtimeRevisionCount({runtimeRevisions:Array(6).fill({})}),0);
});

test('runtime revision 6 accepts only the six approved files after fixed R5 and rejects path or SHA drift',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-runtime-revision-06-code-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  execFileSync('rtk',['git','init','-b','issue7-r6-test',root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 runtime revision 6 test']);git(['config','user.email','issue7-r6@example.invalid']);
  git(['remote','add','upstream',adaptiveRunner.ROOT]);
  git(['fetch','--quiet','--no-tags','upstream',adaptiveRunner.RUNTIME_REVISION_05_CODE_REVISION]);
  git(['checkout','-b','issue7-r6-test-code',adaptiveRunner.RUNTIME_REVISION_05_CODE_REVISION]);
  const previousCodeRevision=adaptiveRunner.RUNTIME_REVISION_05_CODE_REVISION;
  for(const relative of adaptiveRunner.RUNTIME_REVISION_06_PATHS){
    const target=path.join(root,relative);fs.appendFileSync(target,'\n// runtime revision 6 test delta\n');
  }
  git(['add','--',...adaptiveRunner.RUNTIME_REVISION_06_PATHS]);git(['commit','-m','Issue 7 runtime revision 6 code']);
  const adaptiveRunnerPath='wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs';
  const stage3eRunnerPath='wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.cjs';
  const frozenHelpers={helperHashes:{[adaptiveRunnerPath]:'c'.repeat(64),[stage3eRunnerPath]:'d'.repeat(64)}};
  const r5={value:{codeRevision:previousCodeRevision}};
  assert.equal(adaptiveRunner.hasExactRuntimeRevision6Code(root,r5),true);
  assert.deepEqual(adaptiveRunner.parentManifestHelperHashOverrides(root,frozenHelpers,
    {runtimeRevisionExists:true,revision5:r5}),{[adaptiveRunnerPath]:'c'.repeat(64),[stage3eRunnerPath]:'d'.repeat(64)});
  const codeRevision=git(['rev-parse','HEAD']),changedFileSha256=Object.fromEntries(adaptiveRunner.RUNTIME_REVISION_06_PATHS.map(relative=>[
    relative,core.sha256(fs.readFileSync(path.join(root,relative)))]));
  const diff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',`${previousCodeRevision}..${codeRevision}`,
    '--',...adaptiveRunner.RUNTIME_REVISION_06_PATHS],{cwd:root});
  const previousRunnerSha256=core.sha256(execFileSync('rtk',['proxy','git','show',`${previousCodeRevision}:wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs`],{cwd:root}));
  const previous={sha256:'a'.repeat(64),value:{revisionNumber:5,codeRevision:previousCodeRevision,
    newRunnerSha256:previousRunnerSha256,promotionCommit:adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT,
    promotionParentCommit:'b'.repeat(40),promotionParentTree:'c'.repeat(40),promotionCommitTree:'d'.repeat(40),
    promotionIntentSha256:'1'.repeat(64),supersededPromotionIntentSha256:'2'.repeat(64),promotionReceiptSha256:'3'.repeat(64),
    priorLedgerSha256:'4'.repeat(64),priorLedgerSnapshot:{renderCount:136},priorCounts:{probes:48,screen:24,full:64,total:136},
    probeResultSha256:['5'.repeat(64)],screenResultSha256:'6'.repeat(64),fullResultSha256:'7'.repeat(64),
    terminalResultSha256:'8'.repeat(64),extensionResultSha256:'8'.repeat(64),selectionSha256:'9'.repeat(64),executionPlanSha256:'a'.repeat(64)}};
  const frozen={epoch:core.EPOCH,creatorRevision:previousCodeRevision},parentManifestSha256='f'.repeat(64);
  const revision={schemaVersion:1,schema:'issue7-stage3e-adaptive-runtime-revision/v1',issue:7,revisionNumber:6,
    extension:adaptiveRunner.EXTENSION,epoch:core.EPOCH,parentManifestSha256,previousCreatorRevision:previousCodeRevision,
    previousCodeRevision,previousRuntimeRevisionSha256:previous.sha256,previousRunnerSha256:previousRunnerSha256,
    newRunnerSha256:changedFileSha256['wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs'],
    newTestSha256:changedFileSha256['wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.test.cjs'],
    changedPaths:adaptiveRunner.RUNTIME_REVISION_06_PATHS,changedFileSha256,
    approvalSha256:adaptiveRunner.RUNTIME_REVISION_06_APPROVAL_SHA256,...Object.fromEntries(
      ['promotionCommit','promotionParentCommit','promotionParentTree','promotionCommitTree','promotionIntentSha256',
        'supersededPromotionIntentSha256','promotionReceiptSha256'].map(key=>[key,previous.value[key]])),
    ...Object.fromEntries(['priorLedgerSha256','priorLedgerSnapshot','priorCounts','probeResultSha256','screenResultSha256',
      'fullResultSha256','terminalResultSha256','extensionResultSha256','selectionSha256','executionPlanSha256']
      .map(key=>[key,previous.value[key]])),codeRevision,diffSha256:core.sha256(diff)};
  assert.equal(adaptiveRunner.validateRuntimeRevision6Code(root,frozen,parentManifestSha256,previous,revision),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision6Code(root,frozen,'0'.repeat(64),previous,revision),
    /revision 6 identity or exact six-file path set/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision6Code(root,frozen,parentManifestSha256,previous,
    {...revision,changedFileSha256:{...changedFileSha256,[adaptiveRunner.RUNTIME_REVISION_06_PATHS[0]]:'0'.repeat(64)}}),
  /revision 6 committed or working bytes differ/);
  const extra='README.md';fs.writeFileSync(path.join(root,extra),'unapproved seventh path\n');git(['add',extra]);git(['commit','-m','unapproved extra path']);
  assert.equal(adaptiveRunner.hasExactRuntimeRevision6Code(root,r5),false);
  assert.deepEqual(adaptiveRunner.parentManifestHelperHashOverrides(root,frozenHelpers,
    {runtimeRevisionExists:true,revision5:r5}),{[adaptiveRunnerPath]:'c'.repeat(64)});
  const badHead=git(['rev-parse','HEAD']),badPaths=[...adaptiveRunner.RUNTIME_REVISION_06_PATHS,extra].sort();
  const badFiles=Object.fromEntries(badPaths.map(relative=>[relative,core.sha256(fs.readFileSync(path.join(root,relative)))]));
  const badDiff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',`${previousCodeRevision}..${badHead}`,
    '--',...badPaths],{cwd:root});
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision6Code(root,frozen,parentManifestSha256,previous,
    {...revision,codeRevision:badHead,changedPaths:badPaths,changedFileSha256:badFiles,diffSha256:core.sha256(badDiff)}),
  /revision 6 identity or exact six-file path set/);
});

test('runtime revision 7 binds the exact R6 child, seven paths, file SHAs, diff, and approval token',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-runtime-revision-07-code-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  execFileSync('rtk',['git','init','-b','issue7-r7-test',root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 runtime revision 7 test']);git(['config','user.email','issue7-r7@example.invalid']);
  git(['remote','add','upstream',adaptiveRunner.ROOT]);
  git(['fetch','--quiet','--no-tags','upstream',adaptiveRunner.RUNTIME_REVISION_06_CODE_REVISION]);
  git(['checkout','-b','issue7-r7-test-code',adaptiveRunner.RUNTIME_REVISION_06_CODE_REVISION]);
  for(const relative of adaptiveRunner.RUNTIME_REVISION_07_PATHS)
    fs.appendFileSync(path.join(root,relative),'\n// runtime revision 7 test delta\n');
  git(['add','--',...adaptiveRunner.RUNTIME_REVISION_07_PATHS]);git(['commit','-m','Issue 7 runtime revision 7 code']);
  const codeRevision=git(['rev-parse','HEAD']),previousCodeRevision=adaptiveRunner.RUNTIME_REVISION_06_CODE_REVISION;
  const changedFileSha256=Object.fromEntries(adaptiveRunner.RUNTIME_REVISION_07_PATHS.map(relative=>[
    relative,core.sha256(fs.readFileSync(path.join(root,relative)))]));
  const diff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',`${previousCodeRevision}..${codeRevision}`,
    '--',...adaptiveRunner.RUNTIME_REVISION_07_PATHS],{cwd:root});
  const previousRunnerSha256=core.sha256(execFileSync('rtk',['proxy','git','show',
    `${previousCodeRevision}:wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs`],{cwd:root}));
  const previous={sha256:adaptiveRunner.RUNTIME_REVISION_06_SHA256,value:{schemaVersion:1,
    schema:'issue7-stage3e-adaptive-runtime-revision/v1',issue:7,extension:adaptiveRunner.EXTENSION,epoch:core.EPOCH,
    parentManifestSha256:'f'.repeat(64),revisionNumber:6,
    previousCreatorRevision:adaptiveRunner.RUNTIME_REVISION_05_CODE_REVISION,codeRevision:previousCodeRevision,
    newRunnerSha256:previousRunnerSha256,promotionCommit:adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT,
    promotionReceiptSha256:'3'.repeat(64),priorLedgerSha256:'4'.repeat(64),priorLedgerSnapshot:{renderCount:136},
    priorCounts:{probes:48,screen:24,full:64,total:136},probeResultSha256:['5'.repeat(64)],screenResultSha256:'6'.repeat(64),
    fullResultSha256:'7'.repeat(64),terminalResultSha256:'8'.repeat(64),extensionResultSha256:'8'.repeat(64),
    selectionSha256:'9'.repeat(64),executionPlanSha256:'a'.repeat(64)}};
  const parent={manifest:{epoch:core.EPOCH,creatorRevision:adaptiveRunner.RUNTIME_REVISION_05_CODE_REVISION},
    parentManifestSha256:'f'.repeat(64)};
  const revision=adaptiveRunner.createRuntimeRevision7Candidate(root,parent,previous);
  assert.equal(revision.codeRevision,codeRevision);
  assert.deepEqual(revision.changedPaths,adaptiveRunner.RUNTIME_REVISION_07_PATHS);
  assert.equal(revision.diffSha256,core.sha256(diff));
  assert.equal(adaptiveRunner.validateRuntimeRevision7Code(root,parent.manifest,parent.parentManifestSha256,previous,revision),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision7Code(root,parent.manifest,parent.parentManifestSha256,previous,
    {...revision,approvalSha256:'0'.repeat(64)}),/revision 7 identity or exact seven-file path set/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision7Code(root,parent.manifest,parent.parentManifestSha256,previous,
    {...revision,changedFileSha256:{...revision.changedFileSha256,[adaptiveRunner.RUNTIME_REVISION_07_PATHS[0]]:'0'.repeat(64)}}),
  /revision 7 committed or working bytes differ/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision7Code(root,parent.manifest,parent.parentManifestSha256,previous,
    {...revision,changedPaths:[...adaptiveRunner.RUNTIME_REVISION_07_PATHS,'README.md'].sort()}),
  /revision 7 identity or exact seven-file path set/);
});

function syntheticRuntimeRevision7(root){
  const gitBytes=args=>execFileSync('rtk',['proxy','git',...args],{cwd:root,encoding:'buffer'}),
    digestAt=(commit,relative)=>core.sha256(gitBytes(['show',`${commit}:${relative}`])),
    frozen={epoch:core.EPOCH,creatorRevision:'a'.repeat(40)},parentManifestSha256='f'.repeat(64),
    snapshot={priorLedgerSha256:'1'.repeat(64),priorLedgerSnapshot:{renderCount:136,cells:{}},
      priorCounts:{probes:48,screen:24,full:64,total:136},probeResultSha256:['2'.repeat(64)],screenResultSha256:'3'.repeat(64),
      fullResultSha256:'4'.repeat(64),terminalResultSha256:'5'.repeat(64),extensionResultSha256:'5'.repeat(64),
      selectionSha256:'6'.repeat(64),executionPlanSha256:'7'.repeat(64)},
    promotion={promotionCommit:adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT,promotionParentCommit:'8'.repeat(40),
      promotionParentTree:'9'.repeat(40),promotionCommitTree:'b'.repeat(40),promotionIntentSha256:'c'.repeat(64),
      supersededPromotionIntentSha256:'d'.repeat(64),promotionReceiptSha256:'e'.repeat(64)},
    r6Code=adaptiveRunner.RUNTIME_REVISION_06_CODE_REVISION,r7Code=adaptiveRunner.RUNTIME_REVISION_07_CODE_REVISION,
    previous6={sha256:adaptiveRunner.RUNTIME_REVISION_06_SHA256,value:{schemaVersion:1,
      schema:'issue7-stage3e-adaptive-runtime-revision/v1',issue:7,revisionNumber:6,epoch:core.EPOCH,
      extension:adaptiveRunner.EXTENSION,parentManifestSha256,previousCreatorRevision:frozen.creatorRevision,
      codeRevision:r6Code,newRunnerSha256:digestAt(r6Code,'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs'),
      ...snapshot,...promotion}},
    revision7={...previous6.value,revisionNumber:7,previousCodeRevision:r6Code,
      previousRuntimeRevisionSha256:previous6.sha256,codeRevision:r7Code,previousRunnerSha256:previous6.value.newRunnerSha256,
      newRunnerSha256:digestAt(r7Code,'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs'),
      newTestSha256:digestAt(r7Code,'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.test.cjs'),
      changedPaths:adaptiveRunner.RUNTIME_REVISION_07_PATHS,
      changedFileSha256:Object.fromEntries(adaptiveRunner.RUNTIME_REVISION_07_PATHS.map(relative=>[relative,digestAt(r7Code,relative)])),
      approvalSha256:adaptiveRunner.RUNTIME_REVISION_07_APPROVAL_SHA256,
      diffSha256:core.sha256(gitBytes(['diff','--binary','--no-ext-diff',`${r6Code}..${r7Code}`,'--',...adaptiveRunner.RUNTIME_REVISION_07_PATHS]))};
  return {frozen,parentManifestSha256,previous6,previous7:{sha256:adaptiveRunner.RUNTIME_REVISION_07_SHA256,value:revision7},
    parent:{manifest:frozen,parentManifestSha256}};
}

test('runtime revision 8 accepts only the exact R7 child and preserves its historical code and 136-cell evidence',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-runtime-revision-08-code-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  execFileSync('rtk',['git','init','-b','issue7-r8-test',root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 runtime revision 8 test']);git(['config','user.email','issue7-r8@example.invalid']);
  git(['remote','add','upstream',adaptiveRunner.ROOT]);
  git(['fetch','--quiet','--no-tags','upstream',adaptiveRunner.RUNTIME_REVISION_07_CODE_REVISION]);
  git(['checkout','-b','issue7-r8-test-code',adaptiveRunner.RUNTIME_REVISION_07_CODE_REVISION]);
  const {frozen,parentManifestSha256,previous6,previous7,parent}=syntheticRuntimeRevision7(root);
  for(const relative of adaptiveRunner.RUNTIME_REVISION_08_PATHS)
    fs.appendFileSync(path.join(root,relative),'\n// runtime revision 8 test delta\n');
  git(['add','--',...adaptiveRunner.RUNTIME_REVISION_08_PATHS]);git(['commit','-m','Issue 7 runtime revision 8 code']);
  const revision=adaptiveRunner.createRuntimeRevision8Candidate(root,parent,previous7);
  assert.equal(revision.revisionNumber,8);
  assert.equal(revision.previousRuntimeRevisionSha256,adaptiveRunner.RUNTIME_REVISION_07_SHA256);
  assert.deepEqual(revision.changedPaths,adaptiveRunner.RUNTIME_REVISION_08_PATHS);
  assert.equal(revision.changedPaths.length,6);
  assert.equal(adaptiveRunner.validateRuntimeRevision7Code(root,frozen,parentManifestSha256,previous6,previous7.value),true);
  assert.equal(adaptiveRunner.validateRuntimeRevision8Code(root,frozen,parentManifestSha256,previous7,revision),true);
  assert.equal(adaptiveRunner.validateRuntimeRevision8Snapshot(revision,previous7),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision8Code(root,frozen,parentManifestSha256,
    {...previous7,sha256:'0'.repeat(64)},revision),/identity or exact six-file path set/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision8Code(root,frozen,parentManifestSha256,previous7,
    {...revision,approvalSha256:'0'.repeat(64)}),/identity or exact six-file path set/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision8Code(root,frozen,parentManifestSha256,previous7,
    {...revision,changedFileSha256:{...revision.changedFileSha256,[adaptiveRunner.RUNTIME_REVISION_08_PATHS[0]]:'0'.repeat(64)}}),
  /committed or working bytes differ/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision8Code(root,frozen,parentManifestSha256,previous7,
    {...revision,diffSha256:'0'.repeat(64)}),/exact source diff SHA-256 differs/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision8Snapshot({...revision,fullResultSha256:'0'.repeat(64)},previous7),
    /does not preserve the exact R7 136-cell checkpoint/);
  const event={type:'RUNTIME_REVISION_ACCEPTED',revisionNumber:8,runtimeRevisionSha256:core.sha256(core.canonicalBytes(revision)),
    previousRuntimeRevisionSha256:adaptiveRunner.RUNTIME_REVISION_07_SHA256,codeRevision:revision.codeRevision,
    priorLedgerSha256:revision.priorLedgerSha256,selectionSha256:revision.selectionSha256,
    changedPaths:adaptiveRunner.RUNTIME_REVISION_08_PATHS};
  assert.equal(adaptiveRunner.runtimeRevision8AcceptedEvent([event],revision,event.runtimeRevisionSha256),true);
  assert.equal(adaptiveRunner.runtimeRevision8AcceptedEvent([],revision,event.runtimeRevisionSha256),false);
  assert.equal(adaptiveRunner.runtimeRevision8AcceptedEvent([event,event],revision,event.runtimeRevisionSha256),false);
  fs.writeFileSync(path.join(root,'README.md'),'unapproved follow-up\n');git(['add','README.md']);git(['commit','-m','unapproved follow-up']);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision7Code(root,frozen,parentManifestSha256,previous6,previous7.value),
    /revision 7 identity or exact seven-file path set/);
});

test('runtime revision 9 binds one exact R8 child and keeps the original 136-cell snapshot',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-runtime-revision-09-code-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  execFileSync('rtk',['git','init','-b','issue7-r9-test',root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim(),
    gitBytes=args=>execFileSync('rtk',['proxy','git',...args],{cwd:root,encoding:'buffer'});
  git(['config','user.name','Issue 7 runtime revision 9 test']);git(['config','user.email','issue7-r9@example.invalid']);
  git(['remote','add','upstream',adaptiveRunner.ROOT]);
  git(['fetch','--quiet','--no-tags','upstream',adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION]);
  git(['checkout','-b','issue7-r9-test-code',adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION]);
  const digestAt=(commit,relative)=>core.sha256(gitBytes(['show',`${commit}:${relative}`])),
    previous7=syntheticRuntimeRevision7(root).previous7,
    runnerRel='wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs',
    testRel='wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.test.cjs',
    previous8={sha256:'e247ef01385996ecd6fee220cbf44b95bc31c9f0c1319d64222c81e60e9b7404',value:{
      ...previous7.value,revisionNumber:8,previousCodeRevision:previous7.value.codeRevision,
      previousRuntimeRevisionSha256:previous7.sha256,codeRevision:adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION,
      previousRunnerSha256:previous7.value.newRunnerSha256,
      newRunnerSha256:digestAt(adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION,runnerRel),
      newTestSha256:digestAt(adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION,testRel),
      changedPaths:adaptiveRunner.RUNTIME_REVISION_08_PATHS,
      changedFileSha256:Object.fromEntries(adaptiveRunner.RUNTIME_REVISION_08_PATHS.map(relative=>[
        relative,digestAt(adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION,relative)])),
      approvalSha256:adaptiveRunner.RUNTIME_REVISION_08_APPROVAL_SHA256,
      diffSha256:core.sha256(gitBytes(['diff','--binary','--no-ext-diff',
        `${adaptiveRunner.RUNTIME_REVISION_07_CODE_REVISION}..${adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION}`,
        '--',...adaptiveRunner.RUNTIME_REVISION_08_PATHS]))}};
  for(const relative of adaptiveRunner.RUNTIME_REVISION_09_PATHS)
    fs.appendFileSync(path.join(root,relative),'\n// runtime revision 9 test delta\n');
  git(['add','--',...adaptiveRunner.RUNTIME_REVISION_09_PATHS]);git(['commit','-m','Issue 7 runtime revision 9 code']);
  const parent={manifest:{epoch:core.EPOCH,creatorRevision:'a'.repeat(40)},parentManifestSha256:'f'.repeat(64)};
  const revision=adaptiveRunner.createRuntimeRevision9Candidate(root,parent,previous8);
  assert.equal(revision.revisionNumber,9);assert.equal(revision.previousRuntimeRevisionSha256,previous8.sha256);
  assert.equal(revision.previousCodeRevision,adaptiveRunner.RUNTIME_REVISION_08_CODE_REVISION);
  assert.deepEqual(revision.changedPaths,adaptiveRunner.RUNTIME_REVISION_09_PATHS);
  assert.equal(adaptiveRunner.validateRuntimeRevision9Code(root,parent.manifest,parent.parentManifestSha256,previous8,revision),true);
  assert.equal(adaptiveRunner.validateRuntimeRevision9Snapshot(revision,previous8),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision9Code(root,parent.manifest,parent.parentManifestSha256,
    {...previous8,sha256:'0'.repeat(64)},revision),/identity or exact six-file path set/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision9Code(root,parent.manifest,parent.parentManifestSha256,previous8,
    {...revision,approvalSha256:'0'.repeat(64)}),/identity or exact six-file path set/);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision9Snapshot({...revision,selectionSha256:'0'.repeat(64)},previous8),
    /does not preserve the exact R8 136-cell checkpoint/);
  const event={type:'RUNTIME_REVISION_ACCEPTED',revisionNumber:9,runtimeRevisionSha256:core.sha256(core.canonicalBytes(revision)),
    previousRuntimeRevisionSha256:previous8.sha256,codeRevision:revision.codeRevision,priorLedgerSha256:revision.priorLedgerSha256,
    selectionSha256:revision.selectionSha256,changedPaths:adaptiveRunner.RUNTIME_REVISION_09_PATHS};
  assert.equal(adaptiveRunner.runtimeRevision9AcceptedEvent([event],revision,event.runtimeRevisionSha256),true);
  assert.equal(adaptiveRunner.runtimeRevision9AcceptedEvent([event,event],revision,event.runtimeRevisionSha256),false);
});

test('opt-in real-snapshot copy: runtime revision 8 recorder writes both immutable copies and recovers a missing event',
  {skip:process.env.ISSUE7_RUN_CANONICAL_ACCEPTANCE!=='1'},t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-runtime-revision-08-record-')),
    root=path.join(temp,'repo'),home=path.join(temp,'home'),commonDirectory=path.join(temp,'common');
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(home);fs.mkdirSync(commonDirectory);
  execFileSync('rtk',['git','init','-b','issue7-r8-recorder',root],{stdio:'pipe'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 runtime revision 8 recorder test']);
  git(['config','user.email','issue7-r8-recorder@example.invalid']);
  git(['remote','add','upstream',adaptiveRunner.ROOT]);
  git(['fetch','--quiet','--no-tags','upstream',adaptiveRunner.RUNTIME_REVISION_07_CODE_REVISION]);
  git(['checkout','-b','issue7-r8-recorder-code',adaptiveRunner.RUNTIME_REVISION_07_CODE_REVISION]);
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  for(const relative of adaptiveRunner.RUNTIME_REVISION_08_PATHS)
    fs.copyFileSync(path.join(adaptiveRunner.ROOT,relative),path.join(root,relative));
  git(['add','--',...adaptiveRunner.RUNTIME_REVISION_08_PATHS]);git(['commit','-m','Issue 7 runtime revision 8 recorder fixture']);
  fs.cpSync(path.join(adaptiveRunner.ROOT,'build'),path.join(root,'build'),{recursive:true});
  for(const stage of core.STAGES){
    const source=core.resolveRoots(adaptiveRunner.ROOT,stage,core.EPOCH,{home:os.homedir()}),
      target=core.resolveRoots(root,stage,core.EPOCH,{home,commonDirectory});
    fs.mkdirSync(path.dirname(target.primary),{recursive:true});fs.mkdirSync(path.dirname(target.secondary),{recursive:true});
    if(stage==='stage3e'||stage==='stage3'){
      fs.cpSync(source.primary,target.primary,{recursive:true});fs.cpSync(source.secondary,target.secondary,{recursive:true});
    }else{fs.mkdirSync(target.primary,{recursive:true});fs.mkdirSync(target.secondary,{recursive:true});}
  }
  const roots=adaptiveRunner.sidecarRoots(root,home,core.EPOCH,commonDirectory);
  const record=()=>core.withRunAllLock({commonDirectory},owner=>adaptiveRunner.recordRuntimeRevision8({root,home,
    epoch:core.EPOCH,commonDirectory,runAllOwner:owner}));
  const recordPaths=core.dualPaths(roots,adaptiveRunner.RUNTIME_REVISION_08_REL);
  const journalPaths=core.dualPaths(roots,'journal/events.jsonl');
  const removeR8Event=()=>{
    for(const file of [journalPaths.primary,journalPaths.secondary]){
      const kept=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean)
        .filter(line=>{const event=JSON.parse(line);return !(event.type==='RUNTIME_REVISION_ACCEPTED'&&event.revisionNumber===8);});
      fs.writeFileSync(file,kept.length?`${kept.join('\n')}\n`:'');
    }
  };
  for(const file of [recordPaths.primary,recordPaths.secondary])if(fs.existsSync(file))fs.rmSync(file);
  removeR8Event();
  const first=record();
  assert.equal(first.decision,'ADAPTIVE_MID_RUNTIME_REVISION_08_RECORDED',first.reason);
  assert.equal(first.previousRuntimeRevisionSha256,adaptiveRunner.RUNTIME_REVISION_07_SHA256);
  assert.equal(first.renderCount,136);assert.equal(first.builds,0);assert.equal(first.renders,0);assert.equal(first.acousticRenders,0);
  assert.deepEqual(fs.readFileSync(recordPaths.primary),fs.readFileSync(recordPaths.secondary));
  const firstRecordBytes=fs.readFileSync(recordPaths.primary),firstSha=core.sha256(firstRecordBytes);
  removeR8Event();
  const recovered=record();
  assert.equal(recovered.decision,'ADAPTIVE_MID_RUNTIME_REVISION_08_RECORDED',recovered.reason);
  assert.equal(recovered.runtimeRevisionSha256,firstSha);assert.equal(recovered.writes,1);
  assert.equal(adaptiveRunner.runtimeRevision8AcceptedEvent(core.readDualJournal(roots,'journal/events.jsonl').events,
    JSON.parse(firstRecordBytes.toString('utf8')),firstSha),true);
  removeR8Event();
  fs.rmSync(recordPaths.secondary);
  const before=fs.readFileSync(recordPaths.primary);
  assert.throws(()=>core.readDualBytes(roots,adaptiveRunner.RUNTIME_REVISION_08_REL));
  assert.deepEqual(fs.readFileSync(recordPaths.primary),before);
  assert.equal(fs.existsSync(recordPaths.secondary),false);
});

test('runtime revision 5 source validator accepts only the eight paths after the fixed promotion commit',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-runtime-revision-05-code-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  execFileSync('rtk',['git','init','-b','issue7-r5-test',root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 runtime revision 5 test']);git(['config','user.email','issue7-r5@example.invalid']);
  git(['remote','add','upstream',adaptiveRunner.ROOT]);
  git(['fetch','--quiet','--no-tags','upstream',adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT]);
  git(['checkout','-b','issue7-r5-test-code',adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT]);
  const previousCodeRevision=git(['rev-parse',`${adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT}^`]);
  for(const relative of adaptiveRunner.RUNTIME_REVISION_05_PATHS){
    const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`runtime revision 5 ${relative}\n`);
  }
  git(['add','--',...adaptiveRunner.RUNTIME_REVISION_05_PATHS]);git(['commit','-m','Issue 7 runtime revision 5 code']);
  const codeRevision=git(['rev-parse','HEAD']),changedFileSha256=Object.fromEntries(adaptiveRunner.RUNTIME_REVISION_05_PATHS.map(relative=>[
    relative,core.sha256(fs.readFileSync(path.join(root,relative)))]));
  const diff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',
    `${adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT}..${codeRevision}`,'--',...adaptiveRunner.RUNTIME_REVISION_05_PATHS],{cwd:root});
  const promotionBinding={promotionCommit:adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT,
    promotionParentCommit:previousCodeRevision,promotionParentTree:git(['rev-parse',`${adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT}^^{tree}`]),
    promotionCommitTree:git(['rev-parse',`${adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT}^{tree}`]),
    promotionIntentSha256:'1'.repeat(64),supersededPromotionIntentSha256:'2'.repeat(64),promotionReceiptSha256:'3'.repeat(64)};
  const previous={sha256:'4'.repeat(64),value:{codeRevision:previousCodeRevision,newRunnerSha256:'5'.repeat(64)}};
  const frozen={epoch:core.EPOCH,creatorRevision:previousCodeRevision},parentManifestSha256='6'.repeat(64);
  const revision={schemaVersion:1,schema:'issue7-stage3e-adaptive-runtime-revision/v1',issue:7,revisionNumber:5,
    extension:adaptiveRunner.EXTENSION,epoch:core.EPOCH,parentManifestSha256,previousCreatorRevision:previousCodeRevision,
    previousCodeRevision,previousRuntimeRevisionSha256:previous.sha256,previousRunnerSha256:previous.value.newRunnerSha256,
    codeRevision,newRunnerSha256:changedFileSha256['wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs'],
    newTestSha256:changedFileSha256['wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.test.cjs'],
    changedPaths:adaptiveRunner.RUNTIME_REVISION_05_PATHS,changedFileSha256,
    approvalSha256:adaptiveRunner.RUNTIME_REVISION_05_APPROVAL_SHA256,...promotionBinding,
    diffSha256:core.sha256(diff)};
  assert.equal(adaptiveRunner.validateRuntimeRevision5Code(root,frozen,parentManifestSha256,previous,revision,promotionBinding),true);
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision5Code(root,frozen,parentManifestSha256,previous,
    {...revision,diffSha256:'f'.repeat(64)},promotionBinding),/revision 5 exact source diff SHA/);
  const extra='README.md';fs.writeFileSync(path.join(root,extra),'unapproved fifth file\n');git(['add',extra]);git(['commit','-m','unapproved extra path']);
  const badHead=git(['rev-parse','HEAD']),badPaths=[...adaptiveRunner.RUNTIME_REVISION_05_PATHS,extra].sort();
  const badFiles=Object.fromEntries(badPaths.map(relative=>[relative,core.sha256(fs.readFileSync(path.join(root,relative)))]));
  const badDiff=execFileSync('rtk',['proxy','git','diff','--binary','--no-ext-diff',
    `${adaptiveRunner.RUNTIME_REVISION_05_PROMOTION_COMMIT}..${badHead}`,'--',...badPaths],{cwd:root});
  assert.throws(()=>adaptiveRunner.validateRuntimeRevision5Code(root,frozen,parentManifestSha256,previous,
    {...revision,codeRevision:badHead,changedPaths:badPaths,changedFileSha256:badFiles,diffSha256:core.sha256(badDiff)},promotionBinding),
  /revision 5 identity, promotion binding, or exact eight-file path set/);
});
