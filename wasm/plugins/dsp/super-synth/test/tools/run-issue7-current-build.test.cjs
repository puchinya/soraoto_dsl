'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const master=require('./run-issue7-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');

function fakeRunner(name,calls,{dry='READY',execute='AUTHORIZATION_REQUIRED'}={}){
  return {run(options){calls.push({name,...options});return options.mode==='dry-run'?{decision:dry,builds:0,renders:0,writes:0,acousticRenders:0}:{decision:execute,builds:0,renders:0,writes:0,acousticRenders:0};}};
}

test('master exposes read-only status, dry-run, verify, and one-step next modes',()=>{
  assert.deepEqual(['--status','--dry-run','--verify','--next','--run-all'].map(arg=>master.parseMode([arg])),['status','dry-run','verify','next','run-all']);
  assert.throws(()=>master.parseMode(['--execute']),/unsupported mode/);
  assert.equal(core.PHASES.includes('midi51-diagnostic'),true);
});

test('master next dispatches one eligible phase and stops even when it succeeds',()=>{
  const calls=[],runners={
    stage3e:fakeRunner('stage3e',calls,{dry:'STAGE3E_DRY_RUN_READY',execute:'STAGE3E_BASELINE_EQUIVALENCE_PASS'}),
    stage3:fakeRunner('stage3',calls,{dry:'BLOCKED_STAGE3E_SELECTION_REQUIRED',execute:'STAGE3_READY_FOR_STAGE4'}),
    stage4:fakeRunner('stage4',calls,{dry:'BLOCKED_STAGE4_STAGE3_REQUIRED',execute:'STAGE4_FULL_RANGE_COMPLETE'})
  };
  const result=master.dispatchNext({root:master.ROOT,runners,readPhase:()=>null});
  assert.equal(result.decision,'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  assert.equal(result.stoppedAfterStep,true);
  assert.equal(result.nextPhasePending,true);
  const stateful=calls.filter(call=>call.mode!=='dry-run');
  assert.equal(stateful.length,1);
  assert.equal(stateful[0].name,'stage3e');
  assert.equal(stateful[0].mode,'baseline');
  assert.equal(calls.some(call=>call.name==='stage3'&&call.mode==='execute'),false);
  assert.equal(calls.some(call=>call.name==='stage4'&&call.mode==='execute'),false);
});

test('master next runs one eligible phase without a per-phase approval comment',()=>{
  const calls=[],runners={
    stage3e:fakeRunner('stage3e',calls,{dry:'STAGE3E_DRY_RUN_READY',execute:'STAGE3E_BASELINE_EQUIVALENCE_PASS'}),
    stage3:fakeRunner('stage3',calls,{dry:'BLOCKED_STAGE3E_SELECTION_REQUIRED'}),
    stage4:fakeRunner('stage4',calls,{dry:'BLOCKED_STAGE4_STAGE3_REQUIRED'})
  };
  const result=master.dispatchNext({root:master.ROOT,runners,readPhase:()=>null});
  assert.equal(result.decision,'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  assert.equal(result.acousticRenders,0);
  assert.equal(calls.filter(call=>call.mode!=='dry-run').length,1);
  assert.equal(Object.hasOwn(calls.find(call=>call.mode!=='dry-run'),'authorization'),false);
});

test('master blocks low-full before execution when no MIDI51 candidate passes',()=>{
  const calls=[],results={
    baseline:{decision:'STAGE3E_BASELINE_EQUIVALENCE_PASS'},
    'midi51-diagnostic':{decision:'STAGE3E_MIDI51_DIAGNOSTIC_FAIL'},
    'low-screen':{decision:'STAGE3E_LOW_SCREEN_COMPLETE'},
    'midi51-candidate-diagnostic':{
      decision:'STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',
      summary:{candidates:[{tuple:{low:0.35,mid:1,bassHardness:0.5}}],passingCandidates:[]}
    }
  };
  const runners={
    stage3e:fakeRunner('stage3e',calls,{dry:'STAGE3E_DRY_RUN_READY'}),
    stage3:fakeRunner('stage3',calls,{dry:'BLOCKED_STAGE3E_SELECTION_REQUIRED'}),
    stage4:fakeRunner('stage4',calls,{dry:'BLOCKED_STAGE4_STAGE3_REQUIRED'})
  };
  const result=master.dispatchNext({root:master.ROOT,runners,readPhase:(_roots,phase)=>results[phase]||null});
  assert.equal(result.decision,'BLOCKED_STAGE3E_MIDI51_NO_PASSING_CANDIDATE');
  assert.equal(result.phase,'low-full');
  assert.equal(result.passingCandidates,0);
  assert.equal(calls.some(call=>call.mode!=='dry-run'),false);
});

test('master implementation never calls the legacy auto-executing orchestrator',()=>{
  const source=fs.readFileSync(path.join(__dirname,'run-issue7-current-build.cjs'),'utf8');
  assert.doesNotMatch(source,/run-stage3e-master-orchestrator\.cjs|--execute/);
  assert.doesNotMatch(source,/readGitHubApproval|verifyAndPersistAuthorization|\bgh\b/);
});

function runAllFixture(t,{initialDiagnostic='STAGE3E_MIDI51_DIAGNOSTIC_FAIL'}={}){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-run-all-')),root=path.join(base,'repo'),home=path.join(base,'home');
  fs.mkdirSync(root);fs.mkdirSync(home);
  const git=(args)=>execFileSync('rtk',['git',...args],{cwd:root,stdio:'pipe'});
  git(['init']);git(['config','user.name','Issue 7 run-all test']);git(['config','user.email','issue7-run-all@example.invalid']);
  fs.writeFileSync(path.join(root,'README.md'),'run-all test fixture\n');git(['add','README.md']);git(['commit','-m','test fixture']);
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const phases={},stageFinals=new Map(),calls=[],tuple={low:0.8,mid:0.9,bassHardness:0.7};
  const resultFor={
    baseline:'STAGE3E_BASELINE_EQUIVALENCE_PASS',
    'midi51-diagnostic':initialDiagnostic,
    'low-screen':'STAGE3E_LOW_SCREEN_COMPLETE',
    'midi51-candidate-diagnostic':'STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',
    'low-full':'STAGE3E_LOW_FULL_PASS','mid-screen':'STAGE3E_MID_SCREEN_COMPLETE',
    'midi51-final-diagnostic':'STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE','mid-full':'STAGE3E_MID_FULL_PASS'
  };
  const readPhase=(roots,phase)=>{
    if(phases[phase]?.decision&&phase==='mid-full'&&!phases.selectionWritten){
      const value={schemaVersion:1,issue:7,epoch:core.EPOCH,decision:'STAGE3E_SELECTED_RESPONSE',selectedResponse:tuple};
      core.writeImmutableDual(roots,'selection.json',core.canonicalBytes(value));phases.selectionWritten=true;
    }
    return phases[phase]||null;
  };
  const stage3e={run(options){
    calls.push({stage:'stage3e',mode:options.mode,phase:options.phase||null});
    if(options.mode==='dry-run')return {decision:'STAGE3E_DRY_RUN_READY',builds:0,renders:0,writes:0,acousticRenders:0};
    if(options.mode==='verify')return {decision:'STAGE3E_VERIFY_OK',builds:0,renders:0,writes:0,acousticRenders:0};
    const phase=options.phase,decision=resultFor[phase];
    phases[phase]={decision,renderCount:0,...(phase==='midi51-candidate-diagnostic'?{summary:{passingCandidates:[tuple]}}:{}),
      ...(phase==='mid-full'?{summary:{selectedTuple:tuple}}:{})};
    return {decision,phase,calls:0,renderCount:0,acousticRenders:0};
  }};
  const stage3={run(options){
    calls.push({stage:'stage3',mode:options.mode});
    if(options.mode==='dry-run')return {decision:'STAGE3_DRY_RUN_READY',builds:0,renders:0,writes:0,acousticRenders:0};
    if(options.mode==='verify')return {decision:'STAGE3_READY_FOR_STAGE4',builds:0,renders:0,writes:0,acousticRenders:0};
    stageFinals.set('stage3',{result:{decision:'STAGE3_READY_FOR_STAGE4',renderCount:0},sha256:'a'.repeat(64)});
    return {decision:'STAGE3_READY_FOR_STAGE4',renderCount:0,acousticRenders:0};
  }};
  const stage4={run(options){
    calls.push({stage:'stage4',mode:options.mode});
    if(options.mode==='dry-run')return {decision:'STAGE4_DRY_RUN_READY',builds:0,renders:0,writes:0,acousticRenders:0};
    if(options.mode==='verify')return {decision:'STAGE4_FULL_RANGE_COMPLETE',builds:0,renders:0,writes:0,acousticRenders:0};
    stageFinals.set('stage4',{result:{decision:'STAGE4_FULL_RANGE_COMPLETE',renderCount:0},sha256:'b'.repeat(64)});
    return {decision:'STAGE4_FULL_RANGE_COMPLETE',renderCount:0,acousticRenders:0};
  }};
  const counters={promotion:0,suite:0,report:0};
  const options={root,home,runners:{stage3e,stage3,stage4},readPhase,
    verifyReadOnly:()=>({decision:'ISSUE7_CURRENT_BUILD_VERIFY_OK',builds:0,renders:0,writes:0,acousticRenders:0}),
    promoteSelection:()=>{counters.promotion++;return {decision:'STAGE3_PROMOTION_READY'};},
    runSuite:()=>{counters.suite++;return {decision:'ISSUE7_FULL_SUITE_PASS',results:[]};},
    getStageFinal:({stage})=>stageFinals.get(stage)||null,
    runFinalGate:()=>({decision:'ISSUE7_READ_ONLY_FINAL_GATE_PASS'}),
    buildReport:({spend,runAcousticRenders})=>{counters.report++;return {decision:'ISSUE7_READY_FOR_REVIEW',acousticRenders:runAcousticRenders,cumulativeRenderCount:spend.total};}};
  return {root,home,phases,stageFinals,calls,counters,options};
}

test('run-all drives every eligible stage in one call and records append-only dual-store events',t=>{
  const fixture=runAllFixture(t),result=master.runAll(fixture.options);
  assert.equal(result.decision,'ISSUE7_READY_FOR_REVIEW');
  assert.deepEqual(fixture.calls.filter(call=>call.stage==='stage3e'&&!['dry-run','verify'].includes(call.mode)).map(call=>call.phase),
    ['baseline','midi51-diagnostic','low-screen','midi51-candidate-diagnostic','low-full','mid-screen','midi51-final-diagnostic','mid-full']);
  assert.equal(fixture.calls.filter(call=>call.stage==='stage3'&&call.mode==='execute').length,1);
  assert.equal(fixture.calls.filter(call=>call.stage==='stage4'&&call.mode==='execute').length,1);
  assert.equal(fixture.counters.promotion,1);assert.equal(fixture.counters.suite,1);
  assert.equal(result.acousticRenders,0);
  const roots=core.resolveRoots(fixture.root,'stage3e',core.EPOCH,{home:fixture.home});
  const journal=core.readDualJournal(roots);
  assert.equal(journal.events[0].type,'RUN_STARTED');
  assert.equal(journal.events.at(-1).type,'RUN_FINISHED');
  assert.deepEqual(fs.readFileSync(core.dualPaths(roots,master.RUN_ALL_JOURNAL).primary),
    fs.readFileSync(core.dualPaths(roots,master.RUN_ALL_JOURNAL).secondary));
});

test('run-all follows the safe initial MIDI51 diagnostic FAIL branch and skips candidate diagnostics after initial PASS',t=>{
  const failing=runAllFixture(t,{initialDiagnostic:'STAGE3E_MIDI51_DIAGNOSTIC_FAIL'});
  const result=master.runAll(failing.options);
  assert.equal(result.decision,'ISSUE7_READY_FOR_REVIEW');
  assert.equal(failing.calls.some(call=>call.phase==='midi51-candidate-diagnostic'),true);
  const passing=runAllFixture(t,{initialDiagnostic:'STAGE3E_MIDI51_PASS'});
  const passResult=master.runAll(passing.options);
  assert.equal(passResult.decision,'ISSUE7_READY_FOR_REVIEW');
  assert.equal(passing.calls.some(call=>call.phase==='midi51-candidate-diagnostic'),false);
});

test('run-all stops at the fixed no-passing-candidate gate without starting low-full or downstream work',t=>{
  const fixture=runAllFixture(t),original=fixture.options.runners.stage3e.run;
  fixture.options.runners.stage3e.run=function(options){
    if(options.phase==='midi51-candidate-diagnostic'){
      fixture.calls.push({stage:'stage3e',mode:options.mode,phase:options.phase});
      fixture.phases[options.phase]={decision:'STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',summary:{passingCandidates:[]},renderCount:0};
      return {decision:'STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',renderCount:0,acousticRenders:0};
    }
    return original.call(this,options);
  };
  const result=master.runAll(fixture.options);
  assert.equal(result.decision,'BLOCKED_STAGE3E_MIDI51_NO_PASSING_CANDIDATE');
  assert.equal(fixture.calls.some(call=>call.phase==='low-full'&&call.mode!=='dry-run'),false);
  assert.equal(fixture.counters.promotion,0);
  assert.equal(fixture.calls.some(call=>call.stage==='stage3'&&call.mode==='execute'),false);
});

test('run-all resume skips finalized phases and does not create a second promotion commit',t=>{
  const fixture=runAllFixture(t),first=master.runAll(fixture.options);
  assert.equal(first.decision,'ISSUE7_READY_FOR_REVIEW');
  const acousticBefore=fixture.calls.filter(call=>['baseline','screen','full','execute'].includes(call.mode)).length;
  const promotionsBefore=fixture.counters.promotion,stage3Before=fixture.calls.filter(call=>call.stage==='stage3'&&call.mode==='execute').length,
    stage4Before=fixture.calls.filter(call=>call.stage==='stage4'&&call.mode==='execute').length;
  const second=master.runAll(fixture.options);
  assert.equal(second.decision,'ISSUE7_READY_FOR_REVIEW');
  assert.equal(fixture.calls.filter(call=>['baseline','screen','full','execute'].includes(call.mode)).length,acousticBefore);
  assert.equal(fixture.counters.promotion,promotionsBefore);
  assert.equal(fixture.calls.filter(call=>call.stage==='stage3'&&call.mode==='execute').length,stage3Before);
  assert.equal(fixture.calls.filter(call=>call.stage==='stage4'&&call.mode==='execute').length,stage4Before);
});

test('run-all fixed per-phase and cumulative render budgets sum to 4,464',()=>{
  assert.equal(Object.values(master.STAGE3E_BUDGETS).reduce((sum,value)=>sum+value,0),2555);
  assert.equal(master.STAGE3E_BUDGETS['midi51-candidate-diagnostic'],80);
  assert.equal(master.TOTAL_RENDER_BUDGET,2555+486+1423);
});

test('status, dry-run, and verify retain evidence SHA and mtime',t=>{
  const fixture=runAllFixture(t),runners=fixture.options.runners;
  const result=master.runReadOnlyFinalGate({root:fixture.root,home:fixture.home,epoch:core.EPOCH,runners,
    commonDirectory:execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:fixture.root,encoding:'utf8'}).trim(),
    statusReadOnly:()=>({decision:'STATUS',builds:0,renders:0,writes:0,acousticRenders:0}),
    dryRunReadOnly:()=>({decision:'DRY_RUN',builds:0,renders:0,writes:0,acousticRenders:0}),
    verifyReadOnly:()=>({decision:'ISSUE7_CURRENT_BUILD_VERIFY_OK',builds:0,renders:0,writes:0,acousticRenders:0})});
  assert.equal(result.decision,'ISSUE7_READ_ONLY_FINAL_GATE_PASS');
});

test('full-suite CTest failure is BLOCKED and cannot reach the final diff check',()=>{
  const commands=[],result=master.runVerificationSuite({root:master.ROOT,spawn:(_bin,args)=>{
    commands.push(args[0]);return {status:args[0]==='ctest'?1:0,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
  }});
  assert.equal(result.decision,'BLOCKED_ISSUE7_FULL_SUITE');
  assert.equal(result.failed,'cmake-ctest');
  assert.equal(result.results.at(-1).result,'FAIL');
  assert.equal(commands.at(-1),'ctest');
  assert.equal(commands.includes('git'),false);
});
