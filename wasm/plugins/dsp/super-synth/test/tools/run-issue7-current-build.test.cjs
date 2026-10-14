'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const master=require('./run-issue7-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');

function fakeRunner(name,calls,{dry='READY',execute='AUTHORIZATION_REQUIRED'}={}){
  return {run(options){calls.push({name,...options});return options.mode==='dry-run'?{decision:dry,builds:0,renders:0,writes:0,acousticRenders:0}:{decision:execute,builds:0,renders:0,writes:0,acousticRenders:0};}};
}

test('master exposes read-only status, dry-run, verify, and one-step next modes',()=>{
  assert.deepEqual(['--status','--dry-run','--verify','--next'].map(arg=>master.parseMode([arg])),['status','dry-run','verify','next']);
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
});
