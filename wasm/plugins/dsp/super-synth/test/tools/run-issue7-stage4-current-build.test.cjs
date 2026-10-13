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
const stage3e=require('./run-issue7-stage3e-current-build.cjs');
const stage3eSearch=require('./stage3e-search-core.cjs');

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
  copyFile(sourceRoot,root,record.toolchain.toolchainFile);
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
function createIssue7E2EBase(root,sourceRoot){
  const record=structuredClone(stage3.identityRecord(sourceRoot));
  for(const entry of Object.values(record.inputs))copyFile(sourceRoot,root,entry.path);
  copyFile(sourceRoot,root,record.toolchain.toolchainFile);
  for(const build of Object.values(record.builds))for(const relative of ['CMakeCache.txt',build.wasm.path,
    'generated/super-synth_descriptor.cbor','generated/super-synth_descriptor.h'])copyFile(sourceRoot,root,`${build.buildDirectory}/${relative}`);
  const toolFiles=[...stage3e.EXTRA_INPUTS,'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3-production-recovery.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage4-lifecycle.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage4-full-range-evaluator.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.cjs'];
  for(const relative of new Set(toolFiles))copyFile(sourceRoot,root,relative);
  fs.writeFileSync(path.join(root,'.gitignore'),'build/\n');
  const regressions={};for(const name of stage3.REQUIRED_REGRESSIONS)regressions[name]={result:'PASS'};
  const regressionPath=path.join(root,stage3.REGRESSION_REL);fs.mkdirSync(path.dirname(regressionPath),{recursive:true});
  fs.writeFileSync(regressionPath,JSON.stringify(regressions,null,2)+'\n');
  git(root,['init']);git(root,['config','user.name','Issue 7 synthetic integration']);git(root,['config','user.email','issue7-test@example.invalid']);
  git(root,['add','.']);git(root,['commit','-m','synthetic Issue 7 source and fixture']);
  record.sourceCommit=git(root,['rev-parse','HEAD']);
  const identityPath=path.join(root,'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json');
  const productionWasm=path.join(root,record.builds.production.buildDirectory,record.builds.production.wasm.path);
  appendCustomSection(productionWasm);record.builds.production.wasm.sha256=core.sha256(fs.readFileSync(productionWasm));
  record.builds.production.wasm.bytes=fs.statSync(productionWasm).size;
  fs.mkdirSync(path.dirname(identityPath),{recursive:true});fs.writeFileSync(identityPath,JSON.stringify(record,null,2)+'\n');
  git(root,['add',identityPath]);git(root,['commit','-m','synthetic immutable build identity']);
  return {record,identityPath,regressionPath,productionWasm};
}
function commitSyntheticPromotion(root,record,tuple,productionWasm){
  promoteProfile(root,record,tuple);git(root,['add',...stage3.PROMOTION_PATHS]);git(root,['commit','-m','synthetic selected tuple promotion']);
  appendCustomSection(productionWasm);
  assert.equal(git(root,['status','--porcelain']),'','synthetic promotion and ignored production rebuild must leave a clean worktree');
}
function installIssue7MemoryStore(){
  const names=['dualPaths','writeImmutableDual','readDualBytes','readDualJson','readPhaseLedger','initializePhase','readCell',
    'startCell','completeCell','finalizePhase','readFinal','verifyAndPersistAuthorization','withWriterLock'];
  const originals=Object.fromEntries(names.map(name=>[name,core[name]])),files=new Map(),phases=new Map(),existsSync=fs.existsSync;
  const absolute=value=>path.resolve(String(value));
  const phaseKey=(roots,phase)=>`${roots.primary}\0${phase}`;
  core.dualPaths=(roots,relative)=>{
    const normalized=String(relative).replaceAll('\\','/');
    if(!normalized||normalized.startsWith('/')||normalized.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('invalid synthetic evidence path');
    return {primary:path.resolve(roots.primary,normalized),secondary:path.resolve(roots.secondary,normalized),relative:normalized};
  };
  fs.existsSync=function(file){return files.has(absolute(file))||existsSync.call(fs,file);};
  core.writeImmutableDual=(roots,relative,bytes)=>{
    const paths=core.dualPaths(roots,relative),data=Buffer.from(bytes),priorA=files.get(paths.primary),priorB=files.get(paths.secondary);
    if((priorA&&!priorA.equals(data))||(priorB&&!priorB.equals(data)))throw new Error(`synthetic immutable bytes changed at ${relative}`);
    files.set(paths.primary,Buffer.from(data));files.set(paths.secondary,Buffer.from(data));
    return {sizeBytes:data.length,sha256:core.sha256(data)};
  };
  core.readDualBytes=(roots,relative)=>{
    const paths=core.dualPaths(roots,relative),primary=files.get(paths.primary),secondary=files.get(paths.secondary);
    if(!primary||!secondary||!primary.equals(secondary))throw new Error(`synthetic dual evidence missing or divergent: ${relative}`);
    return {bytes:Buffer.from(primary),sizeBytes:primary.length,sha256:core.sha256(primary)};
  };
  core.readDualJson=(roots,relative)=>JSON.parse(core.readDualBytes(roots,relative).bytes.toString('utf8'));
  core.readPhaseLedger=(roots,phase)=>phases.get(phaseKey(roots,phase))||null;
  core.initializePhase=({roots,phase,manifest,cells,renderBudget})=>{
    const key=phaseKey(roots,phase),existing=phases.get(key);
    if(existing){assert.deepEqual(existing.manifest,manifest);return existing;}
    const state={manifest:structuredClone(manifest),ledger:{phase,renderCount:0,renderBudget,
      cells:Object.fromEntries(cells.map(cell=>[cell.key,{state:'PENDING'}]))},cells:new Map(cells.map(cell=>[cell.key,{cell:structuredClone(cell),state:'PENDING'}]))};
    phases.set(key,state);return state;
  };
  core.readCell=(roots,phase,cellKey)=>{
    const state=phases.get(phaseKey(roots,phase)),stored=state?.cells.get(cellKey);
    if(!stored)throw new Error(`synthetic authorized cell missing: ${cellKey}`);
    return {cell:state.ledger.cells[cellKey],marker:{cell:stored.cell},observation:stored.observation?{observation:stored.observation}:null};
  };
  core.startCell=({roots,phase,cellKey})=>{
    const state=phases.get(phaseKey(roots,phase)),cell=state?.cells.get(cellKey);
    if(!cell)throw new Error(`synthetic authorized cell missing: ${cellKey}`);
    if(cell.state==='COMPLETE')return {skipped:true,state:'COMPLETE'};
    if(cell.state!=='PENDING')throw new Error(`synthetic cell is ${cell.state}: ${cellKey}`);
    cell.state='IN_PROGRESS';state.ledger.cells[cellKey]={state:'IN_PROGRESS'};state.ledger.renderCount++;
    return {skipped:false,state:'IN_PROGRESS'};
  };
  core.completeCell=({roots,phase,cellKey,observation})=>{
    const state=phases.get(phaseKey(roots,phase)),cell=state?.cells.get(cellKey);
    if(!cell||cell.state!=='IN_PROGRESS')throw new Error(`synthetic cell was not started: ${cellKey}`);
    const decision=core.assessSafety(observation).decision;cell.state='COMPLETE';cell.observation=structuredClone(observation);
    state.ledger.cells[cellKey]={state:'COMPLETE',decision};return {decision,state:'COMPLETE'};
  };
  core.finalizePhase=({roots,phase,decision,summary})=>{
    const state=phases.get(phaseKey(roots,phase));
    if(!state)throw new Error(`synthetic phase missing: ${phase}`);
    if(Object.values(state.ledger.cells).some(cell=>cell.state!=='COMPLETE'))throw new Error(`synthetic phase incomplete: ${phase}`);
    const result={schemaVersion:1,issue:7,epoch:core.EPOCH,stage:roots.stage,phase,identity:state.manifest.identity,
      authorizationSha256:state.manifest.authorizationSha256,renderCount:state.ledger.renderCount,decision,summary,
      rows:[...state.cells].map(([cellKey,cell])=>({cellKey,observation:{observation:cell.observation}}))};
    const sha256=core.sha256(core.canonicalBytes(result)),final={result,sha256,archiveSha256:core.sha256(Buffer.from(`${phase}:${sha256}`))};
    state.final=final;const rel=core.phaseRelative(phase,'phase-result.json'),paths=core.dualPaths(roots,rel),bytes=core.canonicalBytes(result);
    files.set(paths.primary,Buffer.from(bytes));files.set(paths.secondary,Buffer.from(bytes));
    return final;
  };
  core.readFinal=(roots,phase)=>{
    const final=phases.get(phaseKey(roots,phase))?.final;
    if(!final)throw new Error(`synthetic final result missing: ${phase}`);
    return final;
  };
  core.verifyAndPersistAuthorization=(authorization,details)=>{
    const validated=core.validateAuthorization(authorization,{stage:details.stage,phase:details.phase,cells:details.cells,
      renderBudget:details.renderBudget,allowSynthetic:true});
    if(!validated.syntheticTest)throw new Error('synthetic E2E requires explicitly labeled test authorization');
    return validated;
  };
  core.withWriterLock=(_options,action)=>action();
  return ()=>{fs.existsSync=existsSync;for(const [name,value] of Object.entries(originals))core[name]=value;};
}
function syntheticAuthorization(stage,phase,cells,extra={}){
  return {synthetic:true,label:'SYNTHETIC TEST',issue:7,epoch:core.EPOCH,stage,phase,
    authorizedCellKeys:cells.map(cell=>cell.key).sort(),maxCalls:cells.length,...extra};
}
function referenceMetricsFor(fixture,byCell,pitch,velocity){
  const exact=byCell.get(`${pitch}:${velocity}`);if(exact)return exact.metrics;
  return [...fixture.directCells].sort((a,b)=>Math.abs(a.pitch-pitch)-Math.abs(b.pitch-pitch)||Math.abs(a.velocity-velocity)-Math.abs(b.velocity))[0].metrics;
}
function syntheticIssue7Metrics(source,cell,{stage3eDiagnostic=false,stage4=false}={}){
  const metrics={...structuredClone(source),fullRenderPeakDbfs:source.peakDbfs,finite:true,outputGuardHits:0};
  if(cell.pitch===41){
    const normalized=cell.velocityNormalized??cell.velocity/127;
    metrics.velocityDerivative=normalized<=.25?1:normalized<=.55?2:3;metrics.velocityDerivativeWindowMs=[30,180];
  }
  if(stage3eDiagnostic){
    const normalized=cell.velocityNormalized??cell.velocity/127;
    metrics.stage2mFactorMask=3;metrics.stage2mHammer={effectiveHardness:normalized,initialHammerVelocity:normalized,
      contactDurationSamples:100,peakForce:1,maxCompression:.1,postContactTransverseEnergy:.01};
    metrics.soundboardDiagnostics={frames:1,signals:Object.fromEntries(Array.from({length:20},(_,index)=>[`signal${index}`,0]))};
    metrics.stage3eVelocityResponse={launchVelocity:normalized,hardnessAmount:.5};
  }
  if(stage4)Object.assign(metrics,{finiteThroughout:true,finiteRelease:true,postReleaseFinite:true,
    pitchMeasurement:{measurement_valid:true,pitch_error_cents:0},lifecycle:{postReleaseFinite:true,guardHits:0,noteOffProcessed:true,
      releasedWithinLimit:true,inactiveAfterNoteOffMs:0,postReleaseProcessed:true,finalActiveVoiceCount:0}});
  return metrics;
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

test('continuous synthetic Stage3E selection, Stage3 promotion, and Stage4 acceptance stay test-labeled',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-continuous-e2e-root-'));
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-continuous-e2e-home-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true});});
  const {record,productionWasm}=createIssue7E2EBase(root,runner.ROOT);
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
  const fixtureByCell=new Map(fixture.directCells.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const restore=installIssue7MemoryStore();
  try{
    const completedStage3e=[],stage3eCalls={count:0},stage3Calls={count:0},stage4Calls={count:0};
    const stage3eRoots=core.resolveRoots(root,'stage3e',core.EPOCH,{home});
    const executeStage3e=(phase,mode,candidateTuples=[])=>{
      const proposed={candidateTuples},cells=stage3e.authorizedCells(root,phase,proposed,stage3eRoots,fixture);
      const authorization=syntheticAuthorization('stage3e',phase,cells,{candidateTuples});
      const result=stage3e.run({mode,root,home,commonDirectory:stage3eRoots.commonDirectory,authorization,syntheticTest:true,
        render:({cell})=>{
          stage3eCalls.count++;
          const source=referenceMetricsFor(fixture,fixtureByCell,cell.pitch,cell.velocity);
          return {pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized??cell.velocity/127,
            kind:cell.kind||cell.phase,buildRole:cell.buildRole,
            metrics:syntheticIssue7Metrics(source,cell,{stage3eDiagnostic:cell.buildRole==='stage3e'})};
        }});
      assert.equal(result.decision,phase==='baseline'?'STAGE3E_BASELINE_EQUIVALENCE_PASS':
        phase==='midi51-diagnostic'?'STAGE3E_MIDI51_PASS':
        phase==='low-screen'?'STAGE3E_LOW_SCREEN_COMPLETE':
        phase==='low-full'?'STAGE3E_LOW_FULL_PASS':
        phase==='mid-screen'?'STAGE3E_MID_SCREEN_COMPLETE':
        phase==='midi51-final-diagnostic'?'STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE':'STAGE3E_MID_FULL_PASS');
      assert.equal(result.syntheticTest,true);completedStage3e.push({phase,calls:result.calls,decision:result.decision});return result;
    };
    executeStage3e('baseline','baseline');
    executeStage3e('midi51-diagnostic','screen');
    executeStage3e('low-screen','screen',stage3eSearch.lowGridTuples());
    const lowScreen=core.readFinal(stage3eRoots,'low-screen').result.summary;
    const lowCandidates=stage3e.lowScreenTopTuples(lowScreen.topFive);
    executeStage3e('low-full','full',lowCandidates);
    const lowSelected=core.readFinal(stage3eRoots,'low-full').result.summary.selectedTuple;
    const midCandidates=stage3eSearch.midGridTuples(lowSelected);
    executeStage3e('mid-screen','screen',midCandidates);
    const midScreen=core.readFinal(stage3eRoots,'mid-screen').result.summary;
    const finalCandidates=stage3e.normalizeMidFullTuples(lowSelected,midScreen.topFive);
    executeStage3e('midi51-final-diagnostic','screen',finalCandidates);
    const finalDiagnostic=core.readFinal(stage3eRoots,'midi51-final-diagnostic').result.summary;
    const selectedCandidates=stage3e.passingCandidates(finalDiagnostic,finalCandidates,'midi51-final-diagnostic');
    executeStage3e('mid-full','full',selectedCandidates);
    assert.deepEqual(completedStage3e.map(item=>item.phase),['baseline','midi51-diagnostic','low-screen','low-full','mid-screen','midi51-final-diagnostic','mid-full']);
    assert.equal(completedStage3e.reduce((sum,item)=>sum+item.calls,0),2475);
    assert.equal(stage3eCalls.count,2475);
    const selection=stage3.readSelection(root,home,core.EPOCH,{allowSyntheticTest:true});
    assert.equal(selection.selection.syntheticTest,true);
    assert.equal(selection.selection.phaseResultSha256,selection.final.sha256);
    assert.throws(()=>stage3.readSelection(root,home,core.EPOCH),/selection is invalid or synthetic/);

    commitSyntheticPromotion(root,record,selection.tuple,productionWasm);
    const stage3Cells=stage3.cells(),stage3Authorization=syntheticAuthorization('stage3','stage3',stage3Cells);
    const stage3Validated=core.validateAuthorization(stage3Authorization,{stage:'stage3',phase:'stage3',
      cells:stage3Cells.map(cell=>cell.key),renderBudget:stage3Cells.length,allowSynthetic:true});
    assert.throws(()=>stage3.executeAuthorized({approved:stage3Authorization,auth:stage3Validated}),/explicit test adapter/);
    const stage3Roots=core.resolveRoots(root,'stage3',core.EPOCH,{home});
    const stage3Result=stage3.executeAuthorized({root,home,epoch:core.EPOCH,approved:stage3Authorization,auth:stage3Validated,
      allowSyntheticTest:true,phaseCells:stage3Cells,regressionResultsPath:stage3.REGRESSION_REL,roots:stage3Roots,
      now:()=> '2026-10-14T00:00:00.000Z',render:({cell})=>{
        stage3Calls.count++;
        const source=referenceMetricsFor(fixture,fixtureByCell,cell.pitch,cell.velocity);
        return {pitch:cell.pitch,velocity:cell.velocity,kind:cell.kind,metrics:syntheticIssue7Metrics(source,cell)};
      }});
    assert.equal(stage3Calls.count,486);
    assert.equal(stage3Result.decision,'STAGE3_READY_FOR_STAGE4');
    assert.equal(stage3Result.summary.syntheticTest,true);
    assert.equal(stage3Result.renderCount,486);
    assert.throws(()=>runner.readStage3(root,home,core.EPOCH),/BLOCKED_STAGE4_STAGE3_REQUIRED/);

    const stage3DocsPath='docs/status/plugins/dsp/super-synth/stage3-promotion-descendant-verification.md';
    fs.writeFileSync(path.join(root,stage3DocsPath),'Synthetic docs-only descendant commit after Stage3 identity was frozen.\n');
    git(root,['add',stage3DocsPath]);git(root,['commit','-m','docs: verify Stage3 promotion descendant']);
    assert.deepEqual(git(root,['diff-tree','--no-commit-id','--name-only','-r','HEAD']).split(/\r?\n/).filter(Boolean),[stage3DocsPath]);
    const stage3CallsBeforeVerify=stage3Calls.count;
    const stage3Verified=stage3.run({mode:'verify',root,home,allowSyntheticTest:true});
    assert.equal(stage3Verified.decision,'STAGE3_READY_FOR_STAGE4');
    assert.equal(stage3Verified.acousticRenders,0);
    assert.equal(stage3Calls.count,stage3CallsBeforeVerify);

    const stage3Rows=stage3.readRows(stage3Roots,stage3Cells),stage3ByCell=new Map(stage3Rows.map(row=>[`${row.pitch}:${row.velocity}`,row]));
    const stage4Cells=runner.cells(),stage4Authorization=syntheticAuthorization('stage4','stage4',stage4Cells);
    const stage4Validated=core.validateAuthorization(stage4Authorization,{stage:'stage4',phase:'stage4',
      cells:stage4Cells.map(cell=>cell.key),renderBudget:stage4Cells.length,allowSynthetic:true});
    assert.throws(()=>runner.executeLocked({approved:stage4Authorization,validated:stage4Validated}),/explicit test adapter/);
    const stage4Roots=core.resolveRoots(root,'stage4',core.EPOCH,{home});
    const stage4Result=runner.executeLocked({root,home,epoch:core.EPOCH,roots:stage4Roots,phaseCells:stage4Cells,
      approved:stage4Authorization,validated:stage4Validated,allowSyntheticTest:true,
      legacyConformance:()=>({pass:true,status:0,adjacentFailures:0,velocityFailures:0}),now:()=> '2026-10-14T00:01:00.000Z',
      render:({cell})=>{
        stage4Calls.count++;
        const common=stage3ByCell.get(`${cell.pitch}:${cell.velocity}`);
        const source=common?.metrics||referenceMetricsFor(fixture,fixtureByCell,cell.pitch,cell.velocity);
        return {pitch:cell.pitch,velocity:cell.velocity,metrics:syntheticIssue7Metrics(source,cell,{stage4:true})};
      }});
    assert.equal(stage4Calls.count,1423);
    assert.equal(stage4Result.decision,'STAGE4_FULL_RANGE_COMPLETE');
    assert.equal(stage4Result.syntheticTest,true);
    assert.equal(stage4Result.summary.syntheticTest,true);
    assert.equal(stage4Result.summary.outputEquivalence.pass,true);
    assert.equal(stage4Result.summary.outputEquivalence.comparedCells,486);
    assert.deepEqual(stage4Result.summary.coverage,{lifecycleCells:1408,adjacentComparisons:1392,repeatCells:15});
    assert.equal(core.readCell(stage3Roots,'stage3',stage3Cells[0].key).observation.observation.syntheticTest,true);
    assert.equal(core.readCell(stage4Roots,'stage4',stage4Cells[0].key).observation.observation.syntheticTest,true);

    const docsPath='docs/status/plugins/dsp/super-synth/stage4-promotion-descendant-verification.md';
    fs.writeFileSync(path.join(root,docsPath),'Synthetic docs-only descendant commit for Stage4 identity verification.\n');
    git(root,['add',docsPath]);git(root,['commit','-m','docs: verify Stage4 promotion descendant']);
    assert.deepEqual(git(root,['diff-tree','--no-commit-id','--name-only','-r','HEAD']).split(/\r?\n/).filter(Boolean),[docsPath]);
    const stage3CallsBeforeFinalVerify=stage3Calls.count,stage4CallsBeforeVerify=stage4Calls.count;
    const stage3FinalVerified=stage3.run({mode:'verify',root,home,allowSyntheticTest:true});
    const stage4Verified=runner.run({mode:'verify',root,home,allowSyntheticTest:true});
    assert.equal(stage3FinalVerified.decision,'STAGE3_READY_FOR_STAGE4');
    assert.equal(stage4Verified.decision,'STAGE4_FULL_RANGE_COMPLETE');
    assert.equal(stage3FinalVerified.acousticRenders,0);
    assert.equal(stage4Verified.acousticRenders,0);
    assert.equal(stage3Calls.count,stage3CallsBeforeFinalVerify);
    assert.equal(stage4Calls.count,stage4CallsBeforeVerify);
  }finally{restore();}
});

test('continuous synthetic negative path blocks Stage3E search and downstream stages after baseline mismatch',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-continuous-negative-root-'));
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-continuous-negative-home-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true});});
  createIssue7E2EBase(root,runner.ROOT);
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
  const fixtureByCell=new Map(fixture.directCells.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const restore=installIssue7MemoryStore();
  try{
    const roots=core.resolveRoots(root,'stage3e',core.EPOCH,{home}),cells=stage3e.baselineCells();let calls=0;
    const authorization=syntheticAuthorization('stage3e','baseline',cells);
    const result=stage3e.run({mode:'baseline',root,home,commonDirectory:roots.commonDirectory,authorization,syntheticTest:true,
      render:({cell})=>{
        calls++;
        const source=referenceMetricsFor(fixture,fixtureByCell,cell.pitch,cell.velocity);
        const metrics=syntheticIssue7Metrics(source,cell,{stage3eDiagnostic:cell.buildRole==='stage3e'});
        if(cell.buildRole==='stage3e'&&cell.key===cells[1].key)metrics.onsetMs+=0.01;
        return {pitch:cell.pitch,velocity:cell.velocity,kind:cell.kind,buildRole:cell.buildRole,metrics};
      }});
    assert.equal(result.decision,'BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');
    assert.equal(result.syntheticTest,true);
    assert.equal(calls,24);
    assert.equal(core.readCell(roots,'baseline',cells[1].key).observation.observation.syntheticTest,true);
    assert.throws(()=>stage3e.run({mode:'screen',root,home,commonDirectory:roots.commonDirectory,render:()=>{calls++;return {};}}),
      /BLOCKED_STAGE3E_PHASE: prior baseline result is BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT/);
    assert.equal(calls,24,'blocked search must stop before another render marker or callback');
    assert.throws(()=>stage3.prepare({root,home}),/BLOCKED_STAGE3E_SELECTION_REQUIRED/);
    let stage4Calls=0;
    const dryRun=runner.run({mode:'dry-run',root,home,render:()=>{stage4Calls++;return {};}});
    assert.equal(dryRun.decision,'BLOCKED_STAGE4_STAGE3_REQUIRED');
    assert.equal(dryRun.renders,0);
    assert.equal(stage4Calls,0);
    const selectionPath=core.dualPaths(roots,'selection.json');
    assert.equal(fs.existsSync(selectionPath.primary)||fs.existsSync(selectionPath.secondary),false);
  }finally{restore();}
});
