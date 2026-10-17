#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-stage3-production-recovery.cjs');
const durable=require('./durable-evidence.cjs');
const direct=require('./run-stage3-direct-reference.cjs');

function tempRoots(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stage3-runner-test-'));return {dir,roots:{primary:path.join(dir,'primary'),secondary:path.join(dir,'secondary')}};}
function identity(){return {schemaVersion:1,issue:7,task:'stage3',executionId:'preflight',candidateId:'stage2n-r3-candidate-01',wasmSha256:'a'.repeat(64),runnerSha256:'b'.repeat(64)};}
function print(){process.stdout.write('PASS Stage3 production recovery runner tests\n');}

assert.equal(runner.CELL_COUNT,486);
assert.equal(runner.CELL_SPECS.filter(x=>x.kind==='direct').length,480);
assert.equal(runner.CELL_SPECS.filter(x=>x.kind==='sentinel').length,6);
assert.equal(new Set(runner.CELL_SPECS.map(runner.key)).size,486);
assert.throws(()=>runner.exactCells(runner.CELL_SPECS.slice(1)),/BLOCKED_STAGE3_CAPTURE_COVERAGE/);
assert.throws(()=>runner.stage3Roots(process.cwd(),process.env.HOME,'preflight'),/one authoritative execution only/);
assert.equal(runner.stage3Roots(process.cwd(),process.env.HOME,'authoritative').primary.endsWith('/authoritative'),true);
assert.equal(runner.validateSelectedValuesCommitMetadata({subject:runner.SELECTED_VALUES_COMMIT_SUBJECT,dirtyPaths:[],
  selectedTuple:{low:.75,mid:.85,bassHardness:1.25},presetTuple:{low:.75,mid:.85,bassHardness:1.25}}),true);
assert.throws(()=>runner.validateSelectedValuesCommitMetadata({subject:'other',dirtyPaths:[],selectedTuple:{low:1,mid:1,bassHardness:1},
  presetTuple:{low:1,mid:1,bassHardness:1}}),/selected-values commit is required/);
assert.throws(()=>runner.validateSelectedValuesCommitMetadata({subject:runner.SELECTED_VALUES_COMMIT_SUBJECT,dirtyPaths:[' M presets.json'],
  selectedTuple:{low:1,mid:1,bassHardness:1},presetTuple:{low:1,mid:1,bassHardness:1}}),/tracked production inputs are dirty/);
assert.throws(()=>runner.validateSelectedValuesCommitMetadata({subject:runner.SELECTED_VALUES_COMMIT_SUBJECT,dirtyPaths:[],
  selectedTuple:{low:.5,mid:1,bassHardness:1},presetTuple:{low:1,mid:1,bassHardness:1}}),/do not match the committed concert_grand preset/);
const ordinaryCache=['SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:BOOL=OFF','SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:BOOL=OFF',
  'SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:BOOL=OFF','SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:BOOL=OFF'].join('\n');
assert.equal(runner.assertOrdinaryProductionCache(ordinaryCache),true);
for(const option of ['STAGE3B','STAGE3C','STAGE3D','STAGE3E'])
  assert.throws(()=>runner.assertOrdinaryProductionCache(ordinaryCache.replace(`${option}_DIAGNOSTICS:BOOL=OFF`,`${option}_DIAGNOSTICS:BOOL=ON`)),
    new RegExp(`ordinary production build requires SORAOTO_SUPERSYNTH_${option}_DIAGNOSTICS=OFF`));
{
  const {dir,roots}=tempRoots();
  try{
    assert.equal(runner.assertFreshStage3Execution(roots),true);
    fs.mkdirSync(roots.primary,{recursive:true});
    fs.writeFileSync(path.join(roots.primary,'stage3-result.json'),'{}\n');
    assert.throws(()=>runner.assertFreshStage3Execution(roots),/BLOCKED_STAGE3_DUPLICATE_EXECUTION/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

const good={cell:{kind:'direct',pitch:21,velocity:14},metrics:{finite:true,outputGuardHits:0,peakDbfs:-2,fullRenderPeakDbfs:-2}};
assert.doesNotThrow(()=>runner.assertSafe(good));
for(const metrics of [{...good.metrics,finite:false},{...good.metrics,outputGuardHits:1},{...good.metrics,peakDbfs:0},{...good.metrics,fullRenderPeakDbfs:0}])
  assert.throws(()=>runner.assertSafe({...good,metrics}),/BLOCKED_STAGE3_DIAGNOSTIC_SAFETY/);

{
  const {dir,roots}=tempRoots();
  const original=durable.writeDualCopy;
  try{
    const memory=new Map();
    durable.writeDualCopy=(a,b,bytes)=>{const data=Buffer.from(bytes);memory.set(a,data);memory.set(b,data);return {sizeBytes:data.length,sha256:runner.sha256(data)};};
    const ledger=runner.freshLedger(identity());
    const skipped=runner.CELL_SPECS[0];ledger.cells[runner.key(skipped)].state='COMPLETE';ledger.cells[runner.key(skipped)].sha256='already-complete';
    let rendered=0;
    const result=runner.execute({roots,identity:ledger.identity,ledger,
      identityNow:()=>ledger.identity,
      render:(_root,cell)=>{rendered++;return {pitch:cell.pitch,velocity:cell.velocity,metrics:good.metrics};},
      now:()=>new Date(0).toISOString()});
    assert.equal(result.calls,485);
    assert.equal(rendered,485);
    assert.equal(result.COMPLETE,486);
    assert.equal(ledger.cells[runner.key(skipped)].sha256,'already-complete');
    const before=runner.freshLedger(identity());let transitioned=false;
    assert.throws(()=>runner.execute({roots,identity:before.identity,ledger:before,identityNow:()=>({...before.identity,wasmSha256:'c'.repeat(64)}),
      render:()=>{throw new Error('must not render');}}),/BLOCKED_STAGE3_PRODUCTION_IDENTITY/);
    assert.equal(Object.values(before.cells).some(x=>x.state==='IN_PROGRESS'),false);
    assert.throws(()=>runner.execute({roots,identity:before.identity,ledger:before,identityNow:()=>before.identity,
      assertAuthorization:()=>{throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: changed');},render:()=>{transitioned=true;return {pitch:21,velocity:14,metrics:good.metrics};}}),/BLOCKED_STAGE3_REGRESSION_RESULTS/);
    assert.equal(transitioned,false);
    assert.equal(Object.values(before.cells).some(x=>x.state==='IN_PROGRESS'),false);
  }finally{durable.writeDualCopy=original;fs.rmSync(dir,{recursive:true,force:true});}
}

{
  const {dir,roots}=tempRoots();
  try{
    const ledger=runner.freshLedger(identity()),first=runner.CELL_SPECS[0],state=ledger.cells[runner.key(first)];
    state.state='IN_PROGRESS';runner.persistLedger(roots,ledger);
    assert.throws(()=>runner.loadLedger(roots,ledger.identity),/BLOCKED_STAGE3_AMBIGUOUS_RENDER_ACCOUNTING/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

{
  const {dir,roots}=tempRoots();
  try{
    const ledger=runner.freshLedger(identity()),first=runner.CELL_SPECS[0],state=ledger.cells[runner.key(first)];
    state.state='COMPLETE';state.sha256='f'.repeat(64);
    const cell={...first};const row={schemaVersion:1,cell,identity:ledger.identity,pitch:cell.pitch,velocity:cell.velocity,metrics:good.metrics};
    const bytes=runner.jsonBytes(row);durable.writeDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath),bytes);
    runner.persistLedger(roots,ledger);
    assert.throws(()=>runner.loadLedger(roots,ledger.identity),/cell hash mismatch/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

{
  const {dir,roots}=tempRoots();
  const originalVerify=durable.verifyDualCopy,originalManifest=durable.writeFinalizedManifest,originalArchive=durable.createPhaseArchive;
  try{
    const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
    const byKey=new Map(fixture.directCells.map(row=>[`${row.pitch}:${row.velocity}`,row.metrics]));
    const ledger=runner.freshLedger(identity()),cellBytes=new Map();
    for(const cell of runner.CELL_SPECS){
      const state=ledger.cells[runner.key(cell)],source=byKey.get(`${cell.pitch}:${cell.velocity}`);
      const metrics={...source,finite:true,outputGuardHits:0,fullRenderPeakDbfs:source.peakDbfs};
      const row={schemaVersion:1,cell,identity:ledger.identity,pitch:cell.pitch,velocity:cell.velocity,metrics};
      const bytes=runner.jsonBytes(row),hash=crypto.createHash('sha256').update(bytes).digest('hex');
      state.state='COMPLETE';state.sha256=hash;state.completedAt='2000-01-01T00:00:00.000Z';cellBytes.set(path.join(roots.primary,state.relativePath),{bytes,hash});
      ledger.accounting.renderCalls++;
    }
    ledger.startedAt='2000-01-01T00:00:00.000Z';
    const realVerify=originalVerify;
    durable.verifyDualCopy=(a,b)=>{
      const item=cellBytes.get(a);if(item)return {bytes:item.bytes,sha256:item.hash,sizeBytes:item.bytes.length};
      return realVerify(a,b);
    };
    durable.writeFinalizedManifest=()=>({sha256:'manifest'});
    durable.createPhaseArchive=()=>({sha256:'archive'});
    const regressions=Object.fromEntries(runner.REQUIRED_REGRESSIONS.map(name=>[name,{result:'PASS'}]));
    let tick=0;const now=()=>`2000-01-01T00:00:${String(tick++).padStart(2,'0')}.000Z`;
    const first=runner.finalize({roots,identity:ledger.identity,ledger,fixture,regressions,now});
    const bytesBefore=fs.readFileSync(path.join(roots.primary,'stage3-result.json'));
    const second=runner.finalize({roots,identity:ledger.identity,ledger,fixture,regressions,now});
    const bytesAfter=fs.readFileSync(path.join(roots.primary,'stage3-result.json'));
    assert.equal(first.resultSha256,second.resultSha256);
    assert.deepEqual(bytesAfter,bytesBefore);
    assert.equal(second.renders,0);
  }finally{
    durable.verifyDualCopy=originalVerify;durable.writeFinalizedManifest=originalManifest;durable.createPhaseArchive=originalArchive;
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

print();
