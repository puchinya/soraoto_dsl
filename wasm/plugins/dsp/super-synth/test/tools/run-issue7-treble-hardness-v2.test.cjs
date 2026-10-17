'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const core=require('./issue7-treble-hardness-v2-core.cjs');
const stage3=require('./run-stage3-production-recovery.cjs');
const stage4Capture=require('./capture-supersynth-stage4-lifecycle.cjs');
const runner=require('./run-issue7-treble-hardness-v2.cjs');
const {PluginHarness}=require('../../../../../test/helpers/plugin-harness.cjs');

function tempRoots(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'issue7-treble-v2-')));const roots={primary:path.join(root,'primary'),secondary:path.join(root,'secondary')};fs.mkdirSync(roots.primary);fs.mkdirSync(roots.secondary);return {root,roots};}
function sampleMetrics(){return {finite:true,peakDbfs:-8,fullRenderPeakDbfs:-7,outputGuardHits:0,envelopeDbfs:[-30,-20,-15,-10,-8,-6],spectralCentroidHz:1800,above2kPowerRatio:0.3};}
function screenRows(){return core.SCREEN_PITCHES.flatMap(pitch=>core.SCREEN_VELOCITIES.map(velocity=>({pitch,velocity,metrics:sampleMetrics()})));}
function referenceRows(){return screenRows();}

test('frozen exact phase plans and lifetime maximum are internally consistent',()=>{
  assert.equal(core.makeEquivalenceCells().length,12);
  assert.equal(core.makeScreenCells().length,200);
  assert.equal(stage3.CELL_SPECS.length,486);
  assert.equal(stage4Capture.LIFECYCLE_CELLS.length+stage4Capture.REPEAT_CELLS.length,1423);
  assert.equal(core.OLD_CALLS+12+200+486+1423,4978);
  assert.equal(core.accountTotal([{accounting:{charged:12}},{accounting:{charged:200}},{accounting:{charged:486}},{accounting:{charged:1423}}]),4978);
});

test('plan creation rejects missing and duplicate cells in every stage',()=>{
  assert.throws(()=>core.makePlan('equivalence',{identity:{},cells:core.makeEquivalenceCells().slice(1)}),/PLAN_COUNT/);
  const cells=core.makeScreenCells();cells[1]={...cells[0]};
  assert.throws(()=>core.makePlan('screen',{identity:{},cells}),/PLAN_DUPLICATE/);
  assert.throws(()=>core.exactCells([{kind:'x',pitch:1,velocity:1},{kind:'x',pitch:1,velocity:1}],2,'test'),/PLAN_DUPLICATE/);
});

test('equivalence comparator uses numeric tolerance and exact integer/guard values',()=>{
  assert.equal(core.compareMetrics({x:1.0000005,guard:0,finite:true},{x:1,guard:0,finite:true}),null);
  assert.match(core.compareMetrics({x:1,guard:0},{x:1,guard:1}).path,/guard/);
  assert.match(core.compareMetrics({x:1.00001},{x:1}).path,/x/);
  assert.match(core.compareMetrics({a:[1,2]},{a:[1]}).path,/a/);
});

test('independent treble smoothstep has exact boundaries and midpoint',()=>{
  assert.equal(core.trebleGate(64.5,0.5,1),0);
  assert.equal(core.trebleGate(108,0.5,1),1);
  assert.equal(core.trebleGate(86.25,0.5,1),0.5);
  assert.throws(()=>core.trebleGate(80,1,1),/zone/);
});

test('screen evaluates frozen offset, full 50-cell coverage, span, brightness, and tie-break',()=>{
  const candidates=core.SCREEN_T.map(T=>core.evaluateScreenCandidate(T,referenceRows(),screenRows()));
  assert.ok(candidates.every(c=>c.decision==='SCREEN_PASS'));
  assert.equal(core.selectScreenCandidate(candidates).T,1);
  assert.equal(candidates[0].rows[0].levelErrorDb,core.SCREEN_GAIN_OFFSET_DB);
  assert.throws(()=>core.evaluateScreenCandidate(1,referenceRows(),screenRows().slice(1)),/COVERAGE/);
  const broken=screenRows();broken[0].metrics.outputGuardHits=1;
  assert.equal(core.evaluateScreenCandidate(0.5,referenceRows(),broken).decision,'SCREEN_FAIL');
});

test('screen fails closed for each frozen per-cell safety and acoustic limit',()=>{
  const mutate=[
    m=>{m.finite=false;},
    m=>{m.peakDbfs=0;},
    m=>{m.outputGuardHits=1;},
    m=>{m.envelopeDbfs[3]+=5;},
    m=>{m.spectralCentroidHz=20000;},
    m=>{m.above2kPowerRatio=2;},
    m=>{m.envelopeDbfs[4]+=20;},
    m=>{m.envelopeDbfs[1]=NaN;},
    m=>{m.fullRenderPeakDbfs=0;}
  ];
  for(const change of mutate){const rows=screenRows();change(rows[0].metrics);assert.equal(core.evaluateScreenCandidate(0.5,referenceRows(),rows).decision,'SCREEN_FAIL');}
  const refs=referenceRows(),rows=screenRows();for(const ref of refs){if(ref.velocity===124){ref.metrics.spectralCentroidHz=2200;ref.metrics.above2kPowerRatio=0.5;}}
  for(const actual of rows){if(actual.velocity===124){actual.metrics.spectralCentroidHz=1000;actual.metrics.above2kPowerRatio=0.1;}}
  const brightness=core.evaluateScreenCandidate(0.5,refs,rows);assert.ok(brightness.pitchResults.every(p=>p.failures.includes('brightnessDirection')));
  const wrongT=screenRows().map(c=>({...c,T:2}));assert.equal(core.evaluateScreenCandidate(0.5,referenceRows(),wrongT).decision,'SCREEN_FAIL');
  const span=screenRows();for(const actual of span){if(actual.pitch===66&&actual.velocity===124)actual.metrics.envelopeDbfs[3]+=9;}
  assert.ok(core.evaluateScreenCandidate(0.5,referenceRows(),span).pitchResults.find(p=>p.pitch===66).failures.includes('dynamicSpan'));
});

test('treble formula and all three production lifecycle callsites are present without zone mixer changes',()=>{
  const source=fs.readFileSync(path.join(core.ROOT,'wasm/plugins/dsp/super-synth/src/plugin.c'),'utf8');
  assert.match(source,/velocity_hardness_scale_treble/);
  assert.match(source,/legacy_amount\*\(1\.0f\+g_t\*\(treble-1\.0f\)\)/);
  assert.match(source,/low==1\.0f&&mid==1\.0f&&bass==1\.0f&&treble==1\.0f/);
  assert.equal((source.match(/grand_stage3e_velocity_response\(h,/g)||[]).length,3);
  assert.match(source,/grand_zone_weights\(float key,float\* bass,float\* tenor,float\* treble\)/);
});

test('marker-before-render charge, immutable cell, COMPLETE skip, and crash-after-marker fail closed',()=>{
  const {roots}=tempRoots(),plan=core.makePlan('equivalence',{identity:{wasm:'a'},cells:core.makeEquivalenceCells()}),ledger=core.freshLedger(plan),cell=plan.cells[0];
  core.startCell(roots,plan,ledger,cell,{ownerId:'synthetic'});
  assert.equal(ledger.accounting.charged,1);
  assert.throws(()=>core.startCell(roots,plan,ledger,cell,{ownerId:'duplicate'}),/NO_RERENDER/);
  assert.throws(()=>core.assertLedger(roots,plan,ledger),/AMBIGUOUS_CELL/);
  core.completeCell(roots,plan,ledger,cell,{metrics:sampleMetrics()});
  assert.equal(core.counts(ledger).COMPLETE,1);
  assert.throws(()=>core.startCell(roots,plan,ledger,cell),/NO_RERENDER/);
  assert.equal(core.assertLedger(roots,plan,ledger).COMPLETE,1);
  const capped=core.freshLedger(plan);capped.accounting.charged=core.MAX_CALLS-core.OLD_CALLS;
  assert.throws(()=>core.startCell(roots,plan,capped,plan.cells[1]),/BUDGET/);
  assert.equal(fs.existsSync(path.join(roots.primary,'equivalence',capped.cells[core.cellKey(plan.cells[1])].marker)),false);
});

test('partial and divergent dual stores fail closed; immutable evidence cannot be replaced',()=>{
  const {roots}=tempRoots();
  core.writeImmutableDual(roots,'equivalence/fixed.json',Buffer.from('fixed'));
  assert.equal(core.readDual(roots,'equivalence/fixed.json').bytes.toString(),'fixed');
  assert.throws(()=>core.writeImmutableDual(roots,'equivalence/fixed.json',Buffer.from('changed')),/IMMUTABLE_CONFLICT/);
  fs.writeFileSync(path.join(roots.primary,'equivalence/partial.json'),'a');
  assert.throws(()=>core.readDual(roots,'equivalence/partial.json'),/PARTIAL_DUAL_COPY/);
});

test('append-only transition events reject duplicates and divergent history',()=>{
  const {roots}=tempRoots();core.appendJournal(roots,{eventId:'e1',type:'synthetic'});
  assert.equal(core.validateJournal(roots).events,1);
  assert.throws(()=>core.appendJournal(roots,{eventId:'e1',type:'synthetic'}),/DUPLICATE_EVENT/);
  fs.appendFileSync(path.join(roots.secondary,'journal/transitions.jsonl'),'{}\n');
  assert.throws(()=>core.validateJournal(roots),/DIVERGENT_DUAL_COPY/);
});

test('R10/R11 immutable runtime revisions require exact predecessor and unique accepted events',()=>{
  const {roots}=tempRoots(),r10={revisionNumber:10,previousRuntimeRevisionSha256:core.R9_SHA256,gitSha:'a'.repeat(40),createdAt:'2026-10-17T00:00:00.000Z'};
  const one=core.recordRuntimeRevision(roots,10,r10);
  assert.equal(core.verifyRuntimeRevision(roots,10,core.R9_SHA256).sha256,one.runtimeRevisionSha256);
  const paths=core.revisionPaths(10);for(const relative of paths.slice(1)){for(const root of [roots.primary,roots.secondary])fs.unlinkSync(path.join(root,relative));}
  assert.equal(core.recordRuntimeRevision(roots,10,r10).runtimeRevisionSha256,one.runtimeRevisionSha256);
  assert.equal(core.verifyRuntimeRevision(roots,10,core.R9_SHA256).sha256,one.runtimeRevisionSha256);
  const r11={revisionNumber:11,previousRuntimeRevisionSha256:one.runtimeRevisionSha256,gitSha:'b'.repeat(40)};
  const two=core.recordRuntimeRevision(roots,11,r11);
  assert.equal(core.verifyRuntimeRevision(roots,11,one.runtimeRevisionSha256).sha256,two.runtimeRevisionSha256);
  assert.throws(()=>core.verifyRuntimeRevision(roots,11,core.R9_SHA256),/LINEAGE/);
  assert.throws(()=>core.recordRuntimeRevision(roots,10,{...r10,gitSha:'c'.repeat(40)}),/CONFLICT/);
});

test('exclusive dual-store owner lock blocks a second runner and never age-cleans',()=>{
  const {roots}=tempRoots(),lock=core.acquireLocks(roots,'first');
  assert.throws(()=>core.acquireLocks(roots,'second'),/MASTER_LOCK/);
  lock.release();
  assert.doesNotThrow(()=>core.acquireLocks(roots,'after-release').release());
});

test('stale or partial lock owner is not automatically removed',()=>{
  const {roots}=tempRoots(),file=path.join(roots.primary,'journal/master.lock');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({pid:999999,createdAt:'2000-01-01T00:00:00Z'}));
  assert.throws(()=>core.acquireLocks(roots,'new-run'),/MASTER_LOCK/);assert.ok(fs.existsSync(file));
});

test('read-only snapshots detect hidden timestamp, size, or content mutation',()=>{
  const {roots}=tempRoots();core.writeImmutableDual(roots,'artifacts/fixed.bin',Buffer.from('x'));
  const clean=core.readOnlySnapshot(roots,()=>({decision:'STATUS',builds:0,renders:0,writes:0}));
  assert.equal(clean.renders,0);
  assert.throws(()=>core.readOnlySnapshot(roots,()=>fs.writeFileSync(path.join(roots.primary,'artifacts/fixed.bin'),'y')),/READ_ONLY_MUTATION/);
});

test('legacy R9 fixed identity remains the accepted v1 predecessor',()=>{
  assert.equal(core.R9_SHA256,'14a5b051436b3266ae30b2d847bd70e96a4506b8a01f46fdb09f802f39764ac9');
  assert.equal(core.STAGES.equivalence,12);
  assert.equal(core.MAX_CALLS-core.OLD_CALLS,2121);
});

test('real Stage3 FAIL blocks Stage4 before any Stage4 cell or render can start',()=>{
  assert.throws(()=>runner.runStage4({}, {decision:'BLOCKED_STAGE3_DIRECT_REFERENCE'}, {record:{}}, path.join(core.ROOT,'build/unused')),/STAGE4_REQUIRES_STAGE3_PASS/);
});

test('diagnostic scale setters enforce bounds and production omits both exports',()=>{
  const diagBuild=path.join(core.ROOT,'build/issue7-treble-hardness-v2/r10-diagnostic');
  const prodBuild=path.join(core.ROOT,'build/issue7-treble-hardness-v2/r10-production');
  assert.ok(fs.existsSync(path.join(diagBuild,'plugins/dsp/super-synth/plugin.wasm')),'build R10 diagnostic WASM before this suite');
  assert.ok(fs.existsSync(path.join(prodBuild,'plugins/dsp/super-synth/plugin.wasm')),'build R10 production WASM before this suite');
  const prod=runner.ALLOWLIST&&require('node:fs').readFileSync(path.join(prodBuild,'plugins/dsp/super-synth/plugin.wasm'));
  const prodNames=WebAssembly.Module.exports(new WebAssembly.Module(prod)).map(x=>x.name);
  assert.ok(!prodNames.includes('soraoto_supersynth_treble_hardness_set_scale'));
  assert.ok(!prodNames.includes('soraoto_supersynth_treble_hardness_get_scale'));
  const prior=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=diagBuild;
  const harness=new PluginHarness(core.ROOT,'plugins/dsp/super-synth/plugin.wasm');
  try{const e=harness.e,set=e.soraoto_supersynth_treble_hardness_set_scale,get=e.soraoto_supersynth_treble_hardness_get_scale;assert.equal(typeof set,'function');assert.equal(typeof get,'function');
    for(const value of [0.5,1,2]){assert.equal(set(value)|0,0);assert.equal(get(),value);}
    for(const value of [0.499,2.001,NaN,Infinity,-Infinity]){const before=get();assert.equal(set(value)|0,-1);assert.equal(get(),before);}
  }finally{harness.e.soraoto_plugin_stop_processing();harness.e.soraoto_plugin_deactivate();harness.e.soraoto_plugin_terminate();if(prior===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=prior;}
});
