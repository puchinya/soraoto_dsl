'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-issue7-stage4-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');
const stage3=require('./run-issue7-stage3-current-build.cjs');

function outputMetrics(){
  return Object.fromEntries(runner.OUTPUT_FIELDS.map(field=>[field,
    ['envelopeDbfs','envelope20msDbfs','harmonicRatiosH2ToH6'].includes(field)?[0,1,2]:1]));
}

test('Stage4 cell plan is exactly 1,408 lifecycle plus 15 repeat cells',()=>{
  const cells=runner.cells();
  assert.equal(cells.length,1423);
  assert.equal(cells.filter(cell=>cell.kind==='lifecycle').length,1408);
  assert.equal(cells.filter(cell=>cell.kind==='repeat').length,15);
  assert.equal(new Set(cells.map(cell=>cell.key)).size,1423);
  assert.ok(cells.every(cell=>/^[a-z0-9._-]+$/.test(cell.key)),'phase ledger keys must use the safe key alphabet');
  assert.equal(capture.LIFECYCLE_CELLS[0].pitch,21);
  assert.equal(capture.LIFECYCLE_CELLS.at(-1).pitch,108);
});

test('Stage4 execute without Issue 7 authorization stops before any render',()=>{
  let calls=0;
  assert.throws(()=>runner.run({mode:'execute',root:os.tmpdir(),authorization:null,render:()=>{calls+=1;return {};}}),/AUTHORIZATION_REQUIRED/);
  assert.equal(calls,0);
});

test('Stage4 dry-run reports the missing Stage3 result without writes or renders',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage4-dry-run-'));
  try{
    const roots=core.resolveRoots(runner.ROOT,'stage4',core.EPOCH,{home});
    const before={primary:fs.existsSync(roots.primary),secondary:fs.existsSync(roots.secondary)};
    let calls=0;
    const result=runner.run({mode:'dry-run',root:runner.ROOT,home,render:()=>{calls+=1;return {};}});
    const after={primary:fs.existsSync(roots.primary),secondary:fs.existsSync(roots.secondary)};
    assert.match(result.decision,/^BLOCKED_STAGE4_STAGE3_REQUIRED$/);
    assert.equal(result.lifecycleCells,1408);
    assert.equal(result.repeatCells,15);
    assert.equal(result.adjacentComparisons,1392);
    assert.equal(result.builds,0);
    assert.equal(result.renders,0);
    assert.equal(result.writes,0);
    assert.equal(result.acousticRenders,0);
    assert.equal(calls,0);
    assert.deepEqual(after,before);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('Stage4 identity consumes the immutable derived production SHA from Stage3',()=>{
  const record=runner.identityRecord(runner.ROOT),baselineSha='a'.repeat(64);
  const derivedBuildIdentity={schemaVersion:1,parentBuildIdentitySha256:baselineSha,selectedResponse:{low:0.9,mid:0.95,bassHardness:0.5},
    inputs:{presets:{path:'wasm/plugins/dsp/super-synth/presets.json',sha256:'f'.repeat(64)}},
    builds:{production:{wasm:{path:'plugin.wasm',sha256:'b'.repeat(64)}},stage4:{wasm:{path:'stage4.wasm',sha256:'c'.repeat(64)}}}};
  const productionBuildIdentitySha256=core.sha256(core.canonicalBytes(derivedBuildIdentity));
  const stage3Identity={productionBuildIdentitySha256,builds:{production:{wasmSha256:'b'.repeat(64)}}};
  const stage3State={final:{sha:'e'.repeat(64),result:{identity:stage3Identity}},prepared:{
    productionBuildIdentitySha256,identity:{builds:{production:{wasmSha256:'b'.repeat(64)},stage4:{wasmSha256:'c'.repeat(64)}}},derivedBuildIdentity
  }};
  const identity=runner.currentIdentity({root:runner.ROOT,record,stage3State});
  assert.notEqual(productionBuildIdentitySha256,baselineSha,'promotion must have a distinct derived identity');
  assert.equal(identity.productionBuildIdentitySha256,productionBuildIdentitySha256);
  assert.equal(identity.productionWasmSha256,'b'.repeat(64));
  assert.equal(identity.stage4WasmSha256,'c'.repeat(64));
  assert.equal(identity.buildIdentitySha256,baselineSha);
  assert.deepEqual(identity.inputs,stage3State.prepared.derivedBuildIdentity.inputs);
  const manifest=runner.phaseManifest({root:runner.ROOT,record,identity,authorizationSha256:'9'.repeat(64),phaseCells:runner.cells(),
    now:()=> '2026-10-13T00:00:00.000Z'});
  assert.equal(manifest.identity.productionBuildIdentitySha256,productionBuildIdentitySha256);
  assert.equal(manifest.productionWasmSha256,'b'.repeat(64));
  assert.equal(manifest.authorizedCellKeys.length,1423);
});

test('Stage4 evaluator contract requires 1,392 adjacent comparisons',()=>{
  assert.equal(require('./stage4-full-range-evaluator.cjs').EXPECTED_ADJACENT,1392);
  assert.deepEqual(['--dry-run','--execute','--finalize','--verify'].map(arg=>runner.parseMode([arg])),['dry-run','execute','finalize','verify']);
  assert.throws(()=>runner.parseMode(['--next']),/unsupported mode/);
  const source=fs.readFileSync(path.join(__dirname,'run-issue7-stage4-current-build.cjs'),'utf8');
  assert.doesNotMatch(source,/stage3\/authoritative|stage4\/authoritative/);
});

test('Stage4 compares the shared 486-cell acoustic output against Stage3 production',()=>{
  const stage3Rows=stage3.cells().map(cell=>({pitch:cell.pitch,velocity:cell.velocity,metrics:outputMetrics()}));
  const matrix=capture.LIFECYCLE_CELLS.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,metrics:outputMetrics()}));
  const pass=runner.compareStage3Output(stage3Rows,matrix);
  assert.equal(pass.pass,true);
  assert.equal(pass.comparedCells,486);
  const changed=matrix.map(row=>({...row,metrics:{...row.metrics}}));
  const first=stage3Rows[0];
  changed.find(row=>row.pitch===first.pitch&&row.velocity===first.velocity).metrics.peakDbfs+=0.00001;
  const fail=runner.compareStage3Output(stage3Rows,changed);
  assert.equal(fail.pass,false);
  assert.equal(fail.differences.length>0,true);
});
