'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-issue7-stage3e-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');

function metricsForBaseline(){
  return Object.fromEntries([...runner.BASELINE_FIELDS,...runner.MIDI41_FIELDS].map(field=>[field,0]));
}
function baselineRows(){
  return runner.baselineCells().map(cell=>({cellKey:cell.key,observation:{metrics:metricsForBaseline()}}));
}
function midi51Evidence(errorDb){
  const velocities=runner.MIDI51_VELOCITIES;
  const fixture={directCells:velocities.map((velocity,index)=>({pitch:51,velocity,metrics:{envelopeDbfs:[0,0,0,index===velocities.length-1?2:0,0]}}))};
  const rows=velocities.map((velocity,index)=>({pitch:51,velocity,metrics:{
    envelopeDbfs:[0,0,0,index===velocities.length-1?10+errorDb-8:0,0],
    finite:true,outputGuardHits:0,peakDbfs:-1,fullRenderPeakDbfs:-1,
    stage2mHammer:{effectiveHardness:0.5,initialHammerVelocity:0.5,contactDurationSamples:10,peakForce:1,maxCompression:0.2,postContactTransverseEnergy:0.1},
    soundboardDiagnostics:{signals:{}},stage3eVelocityResponse:{low:1,mid:1,bassHardness:1}
  }}));
  return {fixture,rows};
}
function treeSnapshot(root){
  if(!fs.existsSync(root))return {exists:false};
  const entries=[];
  function walk(dir,relative=''){
    for(const name of fs.readdirSync(dir).sort()){
      const absolute=path.join(dir,name),rel=relative?`${relative}/${name}`:name,stat=fs.lstatSync(absolute);
      if(stat.isSymbolicLink())entries.push({path:rel,type:'symlink',target:fs.readlinkSync(absolute),mtimeMs:stat.mtimeMs});
      else if(stat.isDirectory()){entries.push({path:rel,type:'directory',mtimeMs:stat.mtimeMs});walk(absolute,rel);}
      else entries.push({path:rel,type:'file',size:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),mtimeMs:stat.mtimeMs});
    }
  }
  walk(root);
  return {exists:true,entries};
}

test('baseline plan contains the exact 12 coordinate pairs and 24 build captures',()=>{
  const coordinates=runner.baselineCoordinates();
  const cells=runner.baselineCells();
  assert.equal(coordinates.length,12);
  assert.equal(coordinates.filter(cell=>cell.kind==='direct').length,9);
  assert.equal(coordinates.filter(cell=>cell.kind==='midi41-derivative').length,3);
  assert.equal(cells.length,24);
  assert.equal(new Set(cells.map(cell=>cell.key)).size,24);
  assert.deepEqual([...new Set(cells.map(cell=>cell.buildRole))],['production','stage3e']);
  assert.deepEqual(runner.MIDI41_FIELDS,['velocityDerivative','velocityDerivativeWindowMs']);
});

test('baseline comparison accepts matching metrics and rejects missing, NaN, and over-tolerance values',()=>{
  const rows=baselineRows();
  assert.equal(runner.compareBaseline(rows).decision,'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  const within=baselineRows();
  within.find(row=>row.cellKey.startsWith('stage3e-36-14')).observation.metrics.peakDbfs=0.0000005;
  assert.equal(runner.compareBaseline(within).pass,true);
  const outside=baselineRows();
  outside.find(row=>row.cellKey.startsWith('stage3e-36-14')).observation.metrics.peakDbfs=0.0000011;
  assert.equal(runner.compareBaseline(outside).decision,'BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');
  const missing=baselineRows();
  delete missing.find(row=>row.cellKey.startsWith('stage3e-41-')).observation.metrics.velocityDerivative;
  assert.equal(runner.compareBaseline(missing).pass,false);
  const nonfinite=baselineRows();
  nonfinite.find(row=>row.cellKey.startsWith('stage3e-36-14')).observation.metrics.peakDbfs=Number.NaN;
  assert.equal(runner.compareBaseline(nonfinite).pass,false);
});

test('fresh MIDI51 gate fails above 8 dB and passes exactly at 8 dB when safety checks pass',()=>{
  const over=midi51Evidence(8.000001);
  const overResult=runner.evaluateMidi51(over.rows,over.fixture);
  assert.ok(Math.abs(overResult.span.errorDb-8.000001)<1e-12);
  assert.equal(overResult.pass,false);
  assert.equal(overResult.decision,'BLOCKED_STAGE3E_MID_RESPONSE_FAMILY');
  const boundary=midi51Evidence(8);
  const boundaryResult=runner.evaluateMidi51(boundary.rows,boundary.fixture);
  assert.equal(boundaryResult.span.errorDb,8);
  assert.equal(boundaryResult.safe,true);
  assert.equal(boundaryResult.diagnosticsComplete,true);
  assert.equal(boundaryResult.pass,true);
  assert.equal(boundaryResult.decision,'STAGE3E_MIDI51_PASS');
  delete boundary.rows[0].metrics.stage2mHammer;
  const incomplete=runner.evaluateMidi51(boundary.rows,boundary.fixture);
  assert.equal(incomplete.pass,false);
  assert.equal(incomplete.decision,'BLOCKED_STAGE3E_MID_DIAGNOSTICS');
});

test('baseline mode without Issue 7 authorization fails before any render call',()=>{
  let calls=0;
  assert.throws(()=>runner.run({mode:'baseline',root:runner.ROOT,authorization:null,render:()=>{calls+=1;return {};}}),/AUTHORIZATION_REQUIRED/);
  assert.equal(calls,0);
});

test('dry-run does not change either canonical Stage3E store',t=>{
  let record;
  try{record=runner.identityRecord(runner.ROOT);}catch{t.skip('current-build identity/build artifacts are unavailable');return;}
  for(const role of ['production','stage3e','stage4']){
    const item=record.builds?.[role];
    if(!item||!fs.existsSync(path.join(runner.ROOT,item.buildDirectory,item.wasm.path))){t.skip('current-build identity/build artifacts are unavailable');return;}
  }
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-dry-run-'));
  try{
    const roots=core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home});
    const before={primary:treeSnapshot(roots.primary),secondary:treeSnapshot(roots.secondary)};
    let calls=0;
    const result=runner.run({mode:'dry-run',root:runner.ROOT,home,render:()=>{calls+=1;return {};}});
    const after={primary:treeSnapshot(roots.primary),secondary:treeSnapshot(roots.secondary)};
    assert.equal(result.decision,'STAGE3E_DRY_RUN_READY');
    assert.equal(result.builds,0);
    assert.equal(result.renders,0);
    assert.equal(result.writes,0);
    assert.equal(result.acousticRenders,0);
    assert.equal(calls,0);
    assert.deepEqual(after,before);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
