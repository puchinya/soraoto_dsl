'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const runner=require('./run-issue7-stage4-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');
const stage3=require('./run-issue7-stage3-current-build.cjs');

function outputMetrics(){
  return Object.fromEntries(runner.OUTPUT_FIELDS.map(field=>[field,
    ['envelopeDbfs','envelope20msDbfs','harmonicRatiosH2ToH6'].includes(field)?[0,1,2]:1]));
}
function lifecycleSafety(){
  return {finite:true,finiteThroughout:true,finiteRelease:true,postReleaseFinite:true,outputGuardHits:0,peakDbfs:-1,fullRenderPeakDbfs:-1,
    pitchMeasurement:{measurement_valid:true,pitch_error_cents:0},lifecycle:{postReleaseFinite:true,guardHits:0,noteOffProcessed:true,
      releasedWithinLimit:true,inactiveAfterNoteOffMs:0,postReleaseProcessed:true,finalActiveVoiceCount:0}};
}
function syntheticMetrics(referenceMetrics,fields){
  const defaults=Object.fromEntries(fields.map(field=>[field,
    ['envelopeDbfs','envelope20msDbfs','harmonicRatiosH2ToH6'].includes(field)?[0,1,2]:1]));
  return {...defaults,...referenceMetrics,...lifecycleSafety()};
}
function git(root,args){return execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();}
function copyFile(sourceRoot,targetRoot,relative){
  const source=path.join(sourceRoot,relative),target=path.join(targetRoot,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
}
function appendCustomSection(file){
  const name=Buffer.from('issue7-stage4-test'),payload=Buffer.concat([Buffer.from([name.length]),name,Buffer.from([1])]);
  fs.appendFileSync(file,Buffer.concat([Buffer.from([0,payload.length]),payload]));
}
function promoteProfile(root,record,tuple){
  const presetsPath=path.join(root,record.inputs.presets.path),presets=JSON.parse(fs.readFileSync(presetsPath,'utf8'));
  Object.assign(presets.concert_grand.engine_config.hammer,{velocity_launch_scale_low:tuple.low,
    velocity_launch_scale_mid:tuple.mid,velocity_hardness_scale_bass:tuple.bassHardness});
  fs.writeFileSync(presetsPath,JSON.stringify(presets,null,2)+'\n');
  const profilePath=path.join(root,record.inputs.generatedProfile.path);let profile=fs.readFileSync(profilePath,'utf8');
  for(const [field,value] of Object.entries({velocity_launch_scale_low:tuple.low,velocity_launch_scale_mid:tuple.mid,
    velocity_hardness_scale_bass:tuple.bassHardness})){
    const pattern=new RegExp(`(\\.${field}\\s*=\\s*)([-+0-9.eE]+)f`);
    if(!pattern.test(profile))throw new Error(`synthetic profile field missing: ${field}`);
    profile=profile.replace(pattern,`$1${value}f`);
  }
  fs.writeFileSync(profilePath,profile);
}
function createPromotedStage3Fixture(root,sourceRoot){
  const record=structuredClone(stage3.identityRecord(sourceRoot));
  for(const entry of Object.values(record.inputs))copyFile(sourceRoot,root,entry.path);
  for(const build of Object.values(record.builds))for(const relative of ['CMakeCache.txt',build.wasm.path,
    'generated/super-synth_descriptor.cbor','generated/super-synth_descriptor.h'])copyFile(sourceRoot,root,`${build.buildDirectory}/${relative}`);
  for(const relative of ['wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage4-lifecycle.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage4-full-range-evaluator.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.cjs'])copyFile(sourceRoot,root,relative);
  fs.writeFileSync(path.join(root,'.gitignore'),'build/\n');
  git(root,['init']);git(root,['config','user.name','Issue 7 synthetic integration']);git(root,['config','user.email','issue7-test@example.invalid']);
  git(root,['add','.']);git(root,['commit','-m','synthetic Issue 7 source']);
  record.sourceCommit=git(root,['rev-parse','HEAD']);
  const identityPath=path.join(root,'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json');
  fs.mkdirSync(path.dirname(identityPath),{recursive:true});fs.writeFileSync(identityPath,JSON.stringify(record,null,2)+'\n');
  appendCustomSection(path.join(root,record.builds.production.buildDirectory,record.builds.production.wasm.path));
  git(root,['add',identityPath]);git(root,['commit','-m','synthetic Issue 7 build identity']);
  const tuple={low:0.9,mid:0.95,bassHardness:0.5};promoteProfile(root,record,tuple);
  git(root,['add',...stage3.PROMOTION_PATHS]);git(root,['commit','-m','synthetic selected tuple promotion']);
  const identityBytes=fs.readFileSync(identityPath),baselineIdentity={sourceCommit:record.sourceCommit,buildIdentitySha256:core.sha256(identityBytes),
    inputs:Object.fromEntries(Object.entries(record.inputs).map(([key,value])=>[key,{path:value.path,sha256:value.sha256}])),
    builds:Object.fromEntries(Object.entries(record.builds).map(([role,build])=>[role,{cmakeCacheSha256:build.cmakeCacheSha256,wasmSha256:build.wasm.sha256}]))};
  const selection={selectionSha256:'a'.repeat(64),tuple,final:{sha256:'b'.repeat(64),result:{decision:'STAGE3E_MID_FULL_PASS',identity:baselineIdentity}}};
  const production=stage3.deriveProductionBuildIdentity({root,record,selection});
  const regressions={sha256:'c'.repeat(64),results:Object.fromEntries(stage3.REQUIRED_REGRESSIONS.map(name=>[name,{result:'PASS'}]))};
  const identity=stage3.currentIdentity({root,record,selection,regressions,production});
  return {record,selection,production,regressions,identity,baselineBuildIdentitySha256:baselineIdentity.buildIdentitySha256};
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

test('synthetic Stage3 identity flows through every Stage4 cell and final evaluation',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage4-memory-root-'));
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage4-memory-home-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true});});
  const sourceRoot=runner.ROOT,phaseCells=runner.cells(),fixtureState=createPromotedStage3Fixture(root,sourceRoot);
  const {record,selection,production,regressions,identity:stage3Identity,baselineBuildIdentitySha256}=fixtureState;
  const derivedBuildIdentity=production.derived,productionBuildIdentitySha256=production.productionBuildIdentitySha256;
  const prepared={record,productionRecord:production.productionRecord,derivedBuildIdentity,productionBuildIdentitySha256,
    selection,regressions,identity:stage3Identity,exports:production.derived.productionExports};
  const stage3Final={sha:'e'.repeat(64),result:{decision:'STAGE3_READY_FOR_STAGE4',summary:{syntheticTest:true},identity:stage3Identity}};
  const stage3Artifact={bytes:fs.readFileSync(stage3.productionWasm(root,production.productionRecord)),
    sha256:derivedBuildIdentity.builds.production.wasm.sha256};
  const stage3Roots=core.resolveRoots(root,'stage3',core.EPOCH,{home});
  const stage3State={roots:stage3Roots,final:stage3Final,artifact:stage3Artifact,prepared,derived:derivedBuildIdentity,
    stage3Identity:{resultSha256:stage3Final.sha,identity:stage3Identity}};
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
  const fixtureRows=new Map(fixture.directCells.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const stage3Rows=stage3.cells().map(cell=>{
    const source=fixtureRows.get(`${cell.pitch}:${cell.velocity}`);assert.ok(source,`fixture missing ${cell.pitch}:${cell.velocity}`);
    return {...cell,pitch:cell.pitch,velocity:cell.velocity,metrics:syntheticMetrics(source.metrics,runner.OUTPUT_FIELDS)};
  });
  const stage3ByCell=new Map(stage3Rows.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const completed=new Map();let initializedManifest=null,identityChecks=0,renderCalls=0;
  const savedCore={};
  // Exercise the complete Stage4 control/evaluation path; durable dual-store behavior is covered by core tests.
  const coreOverrides={
    readFinal:()=>stage3Final,
    readDualBytes:()=>stage3Artifact,
    readDualJson:()=>derivedBuildIdentity,
    verifyAndPersistAuthorization:approved=>({sha256:core.sha256(core.canonicalBytes(approved)),syntheticTest:true}),
    readPhaseLedger:()=>initializedManifest?{manifest:initializedManifest,ledger:{phase:'stage4',renderCount:completed.size,
      cells:Object.fromEntries(phaseCells.map(cell=>[cell.key,{state:completed.has(cell.key)?'COMPLETE':'PENDING'}]))}}:null,
    initializePhase:({manifest,cells,renderBudget})=>{
      assert.equal(renderBudget,1423);assert.equal(cells.length,1423);initializedManifest=manifest;
    },
    writeImmutableDual:()=>({sha256:'f'.repeat(64)}),
    readCell:(roots,phase,cellKey)=>{
      const observation=completed.get(cellKey);
      return observation?{cell:{state:'COMPLETE'},observation:{observation}}:{cell:{state:'PENDING'},observation:null};
    },
    startCell:({identity,identityNow})=>{
      core.checkFrozenIdentity(identity,identityNow());identityChecks++;
      core.checkFrozenIdentity(identity,identityNow());identityChecks++;
      return {skipped:false};
    },
    completeCell:({cellKey,observation})=>{completed.set(cellKey,observation);return {decision:'PASS'};},
    finalizePhase:({decision,summary})=>({result:{decision,summary,renderCount:completed.size},sha256:'1'.repeat(64),archiveSha256:'2'.repeat(64)})
  };
  const originalPrepare=stage3.prepare,originalReadRows=stage3.readRows;
  const promotion=stage3.promotionDetails(root);
  function prepareCurrentStage3(){
    const currentRecord=stage3.identityRecord(root);
    const currentProduction=stage3.deriveProductionBuildIdentity({root,record:currentRecord,selection,promotion});
    const currentIdentity=stage3.currentIdentity({root,record:currentRecord,selection,regressions,production:currentProduction});
    return {...prepared,record:currentRecord,productionRecord:currentProduction.productionRecord,
      derivedBuildIdentity:currentProduction.derived,productionBuildIdentitySha256:currentProduction.productionBuildIdentitySha256,
      identity:currentIdentity,exports:currentProduction.derived.productionExports};
  }
  for(const [name,value] of Object.entries(coreOverrides)){savedCore[name]=core[name];core[name]=value;}
  stage3.prepare=prepareCurrentStage3;
  stage3.readRows=()=>stage3Rows;
  try{
    const authorization={synthetic:true,label:'SYNTHETIC TEST',issue:7,epoch:core.EPOCH,stage:'stage4',phase:'stage4'};
    const validated=core.validateAuthorization(authorization,{stage:'stage4',phase:'stage4',cells:phaseCells.map(cell=>cell.key),
      renderBudget:1423,allowSynthetic:true});
    const roots=core.resolveRoots(root,'stage4',core.EPOCH,{home});
    const result=runner.executeLocked({root,home,epoch:core.EPOCH,roots,phaseCells,approved:authorization,validated,allowSyntheticTest:true,
      legacyConformance:()=>({pass:true,status:0,adjacentFailures:0,velocityFailures:0}),now:()=> '2026-10-13T03:00:00.000Z',
      render:({cell})=>{
        renderCalls++;
        const source=stage3ByCell.get(`${cell.pitch}:${cell.velocity}`)||fixtureRows.get(`${cell.pitch}:${cell.velocity}`);
        return {pitch:cell.pitch,velocity:cell.velocity,metrics:syntheticMetrics(source?.metrics||{},runner.OUTPUT_FIELDS)};
      }});
    assert.equal(renderCalls,1423);
    assert.equal(identityChecks,2846);
    assert.equal(result.decision,'STAGE4_FULL_RANGE_COMPLETE');
    assert.equal(result.renderCount,1423);
    assert.equal(result.completeCells,1423);
    assert.equal(result.syntheticTest,true);
    assert.equal(result.summary.syntheticTest,true);
    assert.equal(result.summary.outputEquivalence.pass,true);
    assert.equal(result.summary.outputEquivalence.comparedCells,486);
    assert.equal(result.summary.coverage.lifecycleCells,1408);
    assert.equal(result.summary.coverage.repeatCells,15);
    assert.equal(initializedManifest.identity.productionBuildIdentitySha256,productionBuildIdentitySha256);
    assert.notEqual(initializedManifest.identity.productionBuildIdentitySha256,baselineBuildIdentitySha256);
    assert.equal(initializedManifest.identity.stage3Identity.productionBuildIdentitySha256,productionBuildIdentitySha256);
  }finally{
    stage3.prepare=originalPrepare;stage3.readRows=originalReadRows;
    for(const [name,value] of Object.entries(savedCore))core[name]=value;
  }
});
