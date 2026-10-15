'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const adaptive=require('./issue7-adaptive-mid-core.cjs');
const adaptiveRunner=require('./run-issue7-adaptive-mid.cjs');
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
