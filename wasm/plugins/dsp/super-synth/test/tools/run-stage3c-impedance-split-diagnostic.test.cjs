'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PluginHarness}=require('../../../../../test/helpers/plugin-harness.cjs');
const runner=require('./run-stage3c-impedance-split-diagnostic.cjs');

function syntheticMetrics(){
  const metrics={envelopeDbfs:[-1,-2,-3,-4,0],spectralCentroidHz:3000,above2kPowerRatio:.25,peakDbfs:-3,
    fullRenderPeakDbfs:-2,finite:true,outputGuardHits:0,velocityDerivative:.1,velocityDerivativeWindowMs:[30,180],
    stage2mFactorMask:3,stage2mHammer:Object.fromEntries(runner.HAMMER_FIELDS.map((field,index)=>[field,index+1])),
    soundboardDiagnostics:{frames:7680,signals:{}}};
  for(const name of runner.DIAGNOSTIC_SIGNALS)metrics.soundboardDiagnostics.signals[name]={rms:.01,peak:.1};
  return metrics;
}

const eq=runner.expectedEquivalenceCells();
assert.equal(eq.length,20);
assert.deepEqual([...new Set(eq.map(row=>row.stage3cMask))],[0,3]);
assert.equal(new Set(eq.map(runner.keyOf)).size,20);
assert.deepEqual(runner.EQUIVALENCE_COORDS.map(({pitch,velocity,velocityNormalized})=>[pitch,velocity,velocityNormalized??null]),[
  [36,124,null],[39,124,null],[45,69,null],[48,69,null],[51,14,null],[51,124,null],[54,124,null],[57,124,null],[96,31,null],[41,null,.25]
]);

const split=runner.expectedSplitCells();
assert.equal(split.length,286);
assert.equal(split.filter(row=>row.kind==='dynamic').length,256);
assert.equal(split.filter(row=>row.kind==='treble').length,24);
assert.equal(split.filter(row=>row.kind==='midi41').length,6);
assert.deepEqual([...new Set(split.map(row=>row.stage3cMask))],[1,2]);
assert.equal(new Set(split.map(runner.keyOf)).size,286);
assert.equal(runner.EQUIVALENCE_COUNT+runner.SPLIT_COUNT,306);

assert.deepEqual(runner.factorial(10,7,12,8),{
  M0:10,MC:7,MB:12,MI:8,C_main:-3.5,B_main:1.5,interaction:-1,
  C_improvement:3.5,B_improvement:-1.5
});
assert.equal(runner.benefitOrigin(1,2),'BOTH');
assert.equal(runner.benefitOrigin(1,-2),'CONTACT');
assert.equal(runner.benefitOrigin(-1,2),'BRIDGE');
assert.equal(runner.benefitOrigin(-1,-2),'NEITHER');

const reference=syntheticMetrics();let actual=syntheticMetrics();
actual.envelopeDbfs[4]+=1e-6;
assert.equal(runner.compareMetrics(actual,reference).pass,true);
actual.envelopeDbfs[4]+=1e-12;
assert.equal(runner.compareMetrics(actual,reference).pass,false);
actual=syntheticMetrics();
actual.stage2mFactorMask=2;
assert.throws(()=>runner.compareMetrics(actual,reference),/exact field mismatch: stage2mFactorMask/);

const identity={schemaVersion:1,candidateId:runner.CANDIDATE};
const eqLedger=runner.makeLedger(identity,eq,'equivalence');
assert.deepEqual(runner.counts(eqLedger),{PENDING:20,IN_PROGRESS:0,COMPLETE:0});
const tempRoot=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'stage3c-ledger-'));
try{
  const ep={dir:path.join(tempRoot,'equivalence'),ledger:path.join(tempRoot,'equivalence/ledger.json'),cells:path.join(tempRoot,'equivalence/cells')};
  fs.mkdirSync(ep.dir,{recursive:true});
  fs.writeFileSync(ep.ledger,JSON.stringify(eqLedger));
  assert.deepEqual(runner.counts(runner.loadOrCreateLedger(ep,identity,eq,'equivalence')),{PENDING:20,IN_PROGRESS:0,COMPLETE:0});
  eqLedger.cells[runner.keyOf(eq[0])].state='IN_PROGRESS';
  fs.writeFileSync(ep.ledger,JSON.stringify(eqLedger));
  assert.throws(()=>runner.inspectLedger(ep,eqLedger,eq,identity),/ambiguous IN_PROGRESS/);
  assert.throws(()=>runner.loadOrCreateLedger(ep,{...identity,sourceRevision:'changed'},eq,'equivalence'),/identity\/authorization mismatch/);
}finally{fs.rmSync(tempRoot,{recursive:true,force:true});}

const cmake=fs.readFileSync(path.join(__dirname,'../../../../../../wasm/cmake/wasm_plugin.cmake'),'utf8');
assert.match(cmake,/option\(SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS[\s\S]*?OFF\)/);
assert.match(cmake,/Stage3B and Stage3C diagnostics are mutually exclusive/);
assert.match(cmake,/Stage3C diagnostics require SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON and SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=ON/);

const plugin=fs.readFileSync(path.join(__dirname,'../../src/plugin.c'),'utf8');
assert.match(plugin,/if\(mask&~3u\)return -1;[\s\S]*?g_stage3c_variant_mask=mask;[\s\S]*?dsp_reset\(\);/);
assert.match(plugin,/contact_weighted=grand_hsum_f32x4\(wasm_f32x4_mul\(v_contact_impedance,pair\)\)/);
assert.match(plugin,/v_bridge_impedance,v_at_bridge/);
assert.match(plugin,/bridge_zsum\+zb_imp/);
assert.match(plugin,/contact_impedance\[st\]\*\(in_a\[st\]\+in_b\[st\]\)\*\.5f/);
assert.match(plugin,/bridge_impedance\[st\]\*at_b\[st\]/);

const capturePath=path.join(__dirname,'capture-supersynth-matrix.cjs');
const capture=require(capturePath);
assert.throws(()=>capture.render(36,124,{}, {stage3bVariantMask:1,stage3cVariantMask:0}),/cannot be requested together/);
assert.throws(()=>capture.renderNormalized(41,.25,{}, {stage3bVariantMask:1,stage3cVariantMask:0}),/cannot be requested together/);

const productionBuild=path.resolve(__dirname,'../../../../../../build/wasm');
const priorBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
process.env.SORAOTO_WASM_BUILD_DIR=productionBuild;
const productionHarness=new PluginHarness(path.resolve(__dirname,'../../../../../../'), 'plugins/dsp/super-synth/plugin.wasm');
try{
  assert.equal(typeof productionHarness.e.soraoto_supersynth_stage3c_set_variant_mask,'undefined');
  assert.equal(typeof productionHarness.e.soraoto_supersynth_stage3c_get_variant_mask,'undefined');
}finally{productionHarness.close();if(priorBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;}
assert.ok(fs.existsSync(path.join(productionBuild,'plugins/dsp/super-synth/plugin.wasm')),'ordinary production artifact must remain available');

const stage3cBuild=path.resolve(__dirname,'../../../../../../build/wasm-stage3c');
process.env.SORAOTO_WASM_BUILD_DIR=stage3cBuild;
const diagnosticHarness=new PluginHarness(path.resolve(__dirname,'../../../../../../'),'plugins/dsp/super-synth/plugin.wasm');
try{
  const api=diagnosticHarness.e;
  assert.equal(api.soraoto_supersynth_stage3c_get_variant_mask()>>>0,0);
  for(let mask=0;mask<=3;mask++){
    assert.equal(api.soraoto_supersynth_stage3c_set_variant_mask(mask)|0,0);
    assert.equal(api.soraoto_supersynth_stage3c_get_variant_mask()>>>0,mask);
  }
  assert.equal(api.soraoto_supersynth_stage3c_set_variant_mask(4)|0,-1);
  assert.equal(api.soraoto_supersynth_stage3c_get_variant_mask()>>>0,3,'invalid mask must preserve prior state');
  assert.match(plugin,/g_stage3c_variant_mask=mask;[\s\S]*?dsp_reset\(\);/);
}finally{diagnosticHarness.close();if(priorBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;}

console.log(JSON.stringify({pass:true,equivalenceCells:20,splitCells:286,authorizedTotal:306,stage3bAndStage3cCaptureConflict:'PASS'}));
