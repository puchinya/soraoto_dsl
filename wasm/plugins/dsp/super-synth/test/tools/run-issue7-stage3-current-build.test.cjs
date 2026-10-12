'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-issue7-stage3-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');

test('Stage3 uses exactly 480 direct cells and six sentinels with unique keys',()=>{
  const cells=runner.cells();
  assert.equal(cells.length,486);
  assert.equal(cells.filter(cell=>cell.kind==='direct').length,480);
  assert.equal(cells.filter(cell=>cell.kind==='sentinel').length,6);
  assert.equal(new Set(cells.map(cell=>cell.key)).size,486);
  assert.ok(cells.every(cell=>cell.phase==='stage3'&&cell.buildRole==='production'));
});

test('Stage3 execute without Issue 7 authorization stops before any render',()=>{
  let calls=0;
  assert.throws(()=>runner.run({mode:'execute',root:os.tmpdir(),authorization:null,render:()=>{calls+=1;return {};}}),/AUTHORIZATION_REQUIRED/);
  assert.equal(calls,0);
});

test('Stage3 dry-run reports the missing Stage3E selection without writes or renders',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3-dry-run-'));
  try{
    const roots=core.resolveRoots(runner.ROOT,'stage3',core.EPOCH,{home});
    const before={primary:fs.existsSync(roots.primary),secondary:fs.existsSync(roots.secondary)};
    let calls=0;
    const result=runner.run({mode:'dry-run',root:runner.ROOT,home,render:()=>{calls+=1;return {};}});
    const after={primary:fs.existsSync(roots.primary),secondary:fs.existsSync(roots.secondary)};
    assert.match(result.decision,/^BLOCKED_STAGE3E_SELECTION_REQUIRED$/);
    assert.equal(result.builds,0);
    assert.equal(result.renders,0);
    assert.equal(result.writes,0);
    assert.equal(result.acousticRenders,0);
    assert.equal(calls,0);
    assert.deepEqual(after,before);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('Stage3 runner exposes only the contract modes and no legacy authoritative namespace',()=>{
  assert.deepEqual(['--dry-run','--execute','--finalize','--verify'].map(arg=>runner.parseMode([arg])),['dry-run','execute','finalize','verify']);
  assert.throws(()=>runner.parseMode(['--next']),/unsupported mode/);
  const source=fs.readFileSync(path.join(__dirname,'run-issue7-stage3-current-build.cjs'),'utf8');
  assert.doesNotMatch(source,/stage3\/authoritative|run-stage3e-master-orchestrator\.cjs/);
});
