'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const recovery=require('./run-stage3e-pre-render-abort-recovery.cjs');

const OLD_HELPER='wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs';

function reproduceOriginalAbort(){
  const source=execFileSync('rtk',['git','show',`${recovery.OLD_HEAD}:${OLD_HELPER}`],{
    cwd:recovery.ROOT,encoding:'utf8',
  });
  let harnessConstructionCount=0,processCalls=0;
  class PluginHarness{
    constructor(){harnessConstructionCount++;}
    process(){processCalls++;return [];}
  }
  const module={exports:{}};
  const sandbox={
    require(id){
      if(id.includes('plugin-harness.cjs'))return {PluginHarness};
      if(id.endsWith('salamander-metrics.cjs'))return {analyzeStereo(){return {};}};
      if(id.endsWith('capture-supersynth-stage3d-matrix.cjs'))return {SOUNDBOARD_DIAGNOSTIC_NAMES:[]};
      return require(id);
    },
    module,exports:module.exports,
    __dirname:path.dirname(path.join(recovery.ROOT,OLD_HELPER)),
    process:{env:{}},console,Buffer,Float32Array,Uint8Array,Math,Number,Object,Array,Set,Map,Error,
  };
  vm.runInNewContext(source,sandbox,{filename:OLD_HELPER});
  let failure;
  try{
    module.exports.renderNormalized(36,14/127,{low:1,mid:1,bassHardness:0},{});
  }catch(error){failure=error;}
  assert.equal(failure?.name,'TypeError');
  assert.match(failure?.message||'',/values is not iterable/);
  assert.equal(harnessConstructionCount,0,'the original abort happened before PluginHarness construction');
  assert.equal(processCalls,0,'the original abort made no audio process call');
  return {errorName:failure.name,errorMessage:failure.message,harnessConstructionCount,processCalls};
}

function fixtureLedger(){
  return {
    accounting:{renderCalls:0},
    cells:{
      [recovery.TARGET_KEY]:{identity:recovery.TARGET,state:'IN_PROGRESS',sha256:null,startedAt:'old-start'},
      'another-authorized-cell':{identity:{pitch:39,velocity:14},state:'PENDING',sha256:null},
    },
  };
}

assert.deepEqual(reproduceOriginalAbort(),{
  errorName:'TypeError',errorMessage:'values is not iterable',harnessConstructionCount:0,processCalls:0,
});

{
  const before=fixtureLedger();
  const after=recovery.recoveryLedger(before,recovery.TARGET_KEY);
  assert.equal(before.cells[recovery.TARGET_KEY].state,'IN_PROGRESS','input ledger remains immutable');
  assert.equal(after.cells[recovery.TARGET_KEY].state,'PENDING');
  assert.equal(after.cells[recovery.TARGET_KEY].sha256,null);
  assert.equal(Object.hasOwn(after.cells[recovery.TARGET_KEY],'startedAt'),false);
  assert.deepEqual(after.cells['another-authorized-cell'],before.cells['another-authorized-cell']);
  assert.equal(after.accounting.renderCalls,0);
}

for(const invalid of [
  {change(ledger){ledger.cells[recovery.TARGET_KEY].state='COMPLETE';}},
  {change(ledger){ledger.cells['another-authorized-cell'].state='IN_PROGRESS';}},
  {change(ledger){ledger.accounting.renderCalls=1;}},
  {change(ledger){ledger.cells[recovery.TARGET_KEY].sha256='a'.repeat(64);}},
]){
  const ledger=fixtureLedger();invalid.change(ledger);
  assert.throws(()=>recovery.recoveryLedger(ledger,recovery.TARGET_KEY),/BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING/);
}

assert.throws(()=>recovery.recoveryLedger(fixtureLedger(),'different-cell'),/BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING/);
process.stdout.write('Stage3E pre-render abort recovery tests passed\n');
