'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const runner=require('./run-issue7-stage3-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');
const adaptiveMid=require('./run-issue7-adaptive-mid.cjs');

function isolatedRepo(t,{identity=false}={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3-isolated-repo-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo'),home=path.join(temp,'home');
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(home,{recursive:true});
  execFileSync('rtk',['git','init',root],{stdio:'ignore'});
  if(identity){
    const relative='docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json';
    const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(runner.ROOT,relative),target);
  }
  return {root,home};
}
function promotionRepo(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-promotion-index-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  execFileSync('rtk',['git','init','-b',runner.PROMOTION_BRANCH,root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 promotion test']);git(['config','user.email','issue7-promotion-test@example.invalid']);
  for(const relative of runner.PROMOTION_PATHS){
    const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,`baseline:${relative}\n`);
  }
  git(['add','--',...runner.PROMOTION_PATHS]);git(['commit','-m','synthetic promotion parent']);
  return {root,git};
}
function recoveryPromotionRepo(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-promotion-recovery-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo'),home=path.join(temp,'home');fs.mkdirSync(root,{recursive:true});fs.mkdirSync(home,{recursive:true});
  execFileSync('rtk',['git','init','-b',runner.PROMOTION_BRANCH,root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 promotion recovery test']);git(['config','user.email','issue7-promotion-recovery@example.invalid']);
  for(const relative of runner.PROMOTION_PATHS){const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`baseline:${relative}\n`);}
  git(['add','--',...runner.PROMOTION_PATHS]);git(['commit','-m','synthetic stale promotion parent']);
  const staleParent=git(['rev-parse','HEAD']),tuple={low:0.35,mid:0.55,bassHardness:0.5};
  const identity=structuredClone(runner.identityRecord());identity.sourceCommit=staleParent;
  const identityPath=path.join(root,'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json');
  fs.mkdirSync(path.dirname(identityPath),{recursive:true});fs.writeFileSync(identityPath,JSON.stringify(identity,null,2)+'\n');
  const presets=runner.PROMOTION_PATHS.find(relative=>relative.endsWith('/presets.json'));
  const profile=runner.PROMOTION_PATHS.find(relative=>relative.endsWith('_profiles.h'));
  const record={sourceCommit:staleParent,inputs:{presets:{sha256:core.sha256(fs.readFileSync(path.join(root,presets)))},
    generatedProfile:{sha256:core.sha256(fs.readFileSync(path.join(root,profile)))}}};
  const selection={tuple,selection:{selectedAt:'2026-10-17T00:00:00.000Z'},selectionSha256:'e'.repeat(64),final:{sha256:'f'.repeat(64)}};
  const roots=core.resolveRoots(root,'stage3',core.EPOCH,{home});
  const oldIntent=runner.promotionIntent(root,record,selection,staleParent,git(['rev-parse',`${staleParent}^{tree}`]));
  runner.storeDualObject(roots,runner.PROMOTION_INTENT_REL,oldIntent);
  const oldBytes=core.readDualBytes(roots,runner.PROMOTION_INTENT_REL);
  const oldPaths=core.dualPaths(roots,runner.PROMOTION_INTENT_REL);
  const oldStats=[oldPaths.primary,oldPaths.secondary].map(file=>fs.statSync(file).mtimeMs);
  const recoveryPaths=adaptiveMid.RUNTIME_REVISION_04_PATHS;
  const reviewPath='wasm/plugins/dsp/super-synth/test/tools/run-issue7-current-build.cjs';
  fs.mkdirSync(path.dirname(path.join(root,reviewPath)),{recursive:true});fs.writeFileSync(path.join(root,reviewPath),'review-only descendant\n');
  git(['add','--',reviewPath]);git(['commit','-m','review-only descendant']);
  const reviewOnly=git(['rev-parse','HEAD']);
  for(const relative of recoveryPaths){const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`recovery R:${relative}\n`);}
  git(['add','--',...recoveryPaths]);git(['commit','-m','runtime revision 4 recovery R']);
  const recoveryCommit=git(['rev-parse','HEAD']);
  return {root,home,git,roots,staleParent,reviewOnly,recoveryCommit,record,selection,oldIntent,oldBytes,oldPaths,oldStats};
}

test('Stage3 uses exactly 480 direct cells and six sentinels with unique keys',()=>{
  const cells=runner.cells();
  assert.equal(cells.length,486);
  assert.equal(cells.filter(cell=>cell.kind==='direct').length,480);
  assert.equal(cells.filter(cell=>cell.kind==='sentinel').length,6);
  assert.equal(new Set(cells.map(cell=>cell.key)).size,486);
  assert.ok(cells.every(cell=>cell.phase==='stage3'&&cell.buildRole==='production'));
});

test('Stage3 execution has no approval gate and blocks before rendering when Stage3E selection is absent',t=>{
  const {root,home}=isolatedRepo(t),roots3e=core.resolveRoots(root,'stage3e',core.EPOCH,{home}),roots3=core.resolveRoots(root,'stage3',core.EPOCH,{home});
  let calls=0;
  assert.throws(()=>runner.run({mode:'execute',root,home,render:()=>{calls+=1;return {};}}),/BLOCKED_STAGE3E_SELECTION_REQUIRED/);
  assert.equal(calls,0);
  assert.deepEqual([roots3e.primary,roots3e.secondary,roots3.primary,roots3.secondary].map(fs.existsSync),[false,false,false,false]);
});

test('Stage3 dry-run reports the missing Stage3E selection without writes or renders',t=>{
  const {root,home}=isolatedRepo(t,{identity:true}),roots3e=core.resolveRoots(root,'stage3e',core.EPOCH,{home}),roots3=core.resolveRoots(root,'stage3',core.EPOCH,{home});
  const before=[roots3e.primary,roots3e.secondary,roots3.primary,roots3.secondary].map(fs.existsSync);
  let calls=0;
  const result=runner.run({mode:'dry-run',root,home,render:()=>{calls+=1;return {};}});
  const after=[roots3e.primary,roots3e.secondary,roots3.primary,roots3.secondary].map(fs.existsSync);
  assert.equal(result.decision,'BLOCKED_STAGE3E_SELECTION_REQUIRED');
  assert.equal(result.builds,0);assert.equal(result.renders,0);assert.equal(result.writes,0);
  assert.equal(result.acousticRenders,0);assert.equal(calls,0);assert.deepEqual(after,before);
});

test('Stage3 selection reader accepts a controlled adaptive PASS fixture without writing evidence',t=>{
  const {root,home}=isolatedRepo(t),roots=core.resolveRoots(root,'stage3e',core.EPOCH,{home});
  const fixture={selection:{schema:'issue7-stage3e-extension-selection/v1',decision:'ADAPTIVE_MID_FULL_PASS'},
    selectionSha256:'a'.repeat(64),tuple:{low:0.35,mid:0.55,bassHardness:0.5},
    final:{result:{decision:'ADAPTIVE_MID_FULL_PASS'}}};
  const original=adaptiveMid.loadSelection;adaptiveMid.loadSelection=()=>fixture;t.after(()=>{adaptiveMid.loadSelection=original;});
  assert.equal(runner.readSelection(root,home,core.EPOCH),fixture);
  assert.deepEqual([roots.primary,roots.secondary].map(fs.existsSync),[false,false]);
});

test('Stage3 prerequisite keeps adaptive terminal-result and full-result hashes distinct and archive-free',()=>{
  const terminal='a'.repeat(64),full='b'.repeat(64),screen='c'.repeat(64),plan='d'.repeat(64),selectionSha='e'.repeat(64);
  const selected={extensionSelection:true,final:{sha256:full,result:{decision:'ADAPTIVE_MID_FULL_PASS'}},
    extension:{resultSha256:terminal,parentManifestSha256:'f'.repeat(64),executionPlanSha256:plan,
      parentManifest:{creatorRevision:'1'.repeat(40)},screenResultSha256:screen,fullResultSha256:full},
    selection:{schema:'issue7-stage3e-extension-selection/v1',probeResultSha256:['2'.repeat(64)]},selectionSha256:selectionSha};
  const prerequisite=runner.stage3ExecutionPrerequisite(selected);
  assert.equal(prerequisite.resultSha256,terminal);
  assert.equal(prerequisite.fullResultSha256,full);
  assert.notEqual(prerequisite.resultSha256,prerequisite.fullResultSha256);
  assert.equal(prerequisite.executionPlanSha256,plan);
  assert.equal(Object.hasOwn(prerequisite,'archiveSha256'),false);
});

test('derived production identity binds the selected tuple to a dedicated promotion commit and preserves diagnostic builds',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3-derived-'));
  try{
    const record=structuredClone(runner.identityRecord()),sourceRoot=runner.ROOT,sourceCommit=record.sourceCommit;
    record.sourceCommit='1'.repeat(40);
    for(const entry of Object.values(record.inputs)){
      const target=path.join(root,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,execFileSync('rtk',['proxy','git','show',`${sourceCommit}:${entry.path}`],{cwd:sourceRoot,maxBuffer:16*1024*1024}));
    }
    for(const relative of runner.PROMOTION_PATHS.filter(file=>file.endsWith('super-synth_descriptor.cbor')||file.endsWith('super-synth_descriptor.h'))){
      const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,execFileSync('rtk',['proxy','git','show',`${sourceCommit}:${relative}`],{cwd:sourceRoot,maxBuffer:16*1024*1024}));
    }
    const toolchainTarget=path.join(root,record.toolchain.toolchainFile);
    fs.mkdirSync(path.dirname(toolchainTarget),{recursive:true});
    fs.writeFileSync(toolchainTarget,execFileSync('rtk',['proxy','git','show',`${sourceCommit}:${record.toolchain.toolchainFile}`],{cwd:sourceRoot,maxBuffer:16*1024*1024}));
    for(const build of Object.values(record.builds)){
      for(const relative of ['CMakeCache.txt',build.wasm.path,'generated/super-synth_descriptor.cbor','generated/super-synth_descriptor.h']){
        const source=path.join(sourceRoot,build.buildDirectory,relative),target=path.join(root,build.buildDirectory,relative);
        fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
      }
    }
    const productionWasm=path.join(root,record.builds.production.buildDirectory,record.builds.production.wasm.path),originalWasm=fs.readFileSync(productionWasm);
    const sectionName=Buffer.from('issue7-test'),sectionBody=Buffer.concat([Buffer.from([sectionName.length]),sectionName,Buffer.from([1])]);
    fs.writeFileSync(productionWasm,Buffer.concat([originalWasm,Buffer.from([0,sectionBody.length]),sectionBody]));
    const identityPath=path.join(root,'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json');
    fs.mkdirSync(path.dirname(identityPath),{recursive:true});fs.writeFileSync(identityPath,JSON.stringify(record,null,2)+'\n');
    const tuple={low:0.9,mid:0.95,bassHardness:0.5};
    const presetsPath=path.join(root,record.inputs.presets.path),presets=JSON.parse(fs.readFileSync(presetsPath,'utf8'));
    Object.assign(presets.concert_grand.engine_config.hammer,{velocity_launch_scale_low:tuple.low,velocity_launch_scale_mid:tuple.mid,velocity_hardness_scale_bass:tuple.bassHardness});
    fs.writeFileSync(presetsPath,JSON.stringify(presets,null,2)+'\n');
    const profilePath=path.join(root,record.inputs.generatedProfile.path);
    let profile=fs.readFileSync(profilePath,'utf8');
    for(const [field,value] of Object.entries(tuple)){
      const name=field==='low'?'velocity_launch_scale_low':field==='mid'?'velocity_launch_scale_mid':'velocity_hardness_scale_bass';
      profile=profile.replace(new RegExp(`(\\.${name}\\s*=\\s*)([-+0-9.eE]+)f`),`$1${value}f`);
    }
    fs.writeFileSync(profilePath,profile);
    for(const relative of runner.PROMOTION_PATHS.filter(file=>file.endsWith('super-synth_descriptor.cbor')||file.endsWith('super-synth_descriptor.h'))){
      const target=path.join(root,relative),before=fs.readFileSync(target);
      fs.writeFileSync(target,Buffer.concat([before,Buffer.from('\nissue7-selected-metadata-fixture\n')]));
    }
    const baselineIdentity={sourceCommit:record.sourceCommit,buildIdentitySha256:core.sha256(fs.readFileSync(identityPath)),
      inputs:Object.fromEntries(Object.entries(record.inputs).map(([key,value])=>[key,{path:value.path,sha256:value.sha256}])),
      builds:Object.fromEntries(Object.entries(record.builds).map(([role,build])=>[role,{cmakeCacheSha256:build.cmakeCacheSha256,wasmSha256:build.wasm.sha256}]))};
    const parentFiles=new Map(runner.PROMOTION_PATHS.map(relative=>[relative,
      execFileSync('rtk',['proxy','git','show',`${sourceCommit}:${relative}`],{cwd:sourceRoot,maxBuffer:16*1024*1024})]));
    assert.deepEqual(runner.PROMOTION_PATHS,[
      'wasm/plugins/dsp/super-synth/presets.json',
      'wasm/shared/generated/super-synth_descriptor.cbor',
      'wasm/shared/generated/super-synth_descriptor.h',
      'wasm/shared/generated/super-synth_grand_profiles.h'
    ]);
    const selection={selectionSha256:'a'.repeat(64),tuple,final:{sha256:'b'.repeat(64),result:{decision:'STAGE3E_MID_FULL_PASS',identity:baselineIdentity}}};
    const promotion={commit:'d'.repeat(40),parent:'c'.repeat(40),parentTree:'e'.repeat(40),commitTree:'f'.repeat(40),
      changedPaths:[...runner.PROMOTION_PATHS],sourceCommitIsAncestor:true,currentHeadDescendsFromPromotion:true,
      readParentFile:relative=>parentFiles.get(relative),readCommitFile:relative=>fs.readFileSync(path.join(root,relative))};
    const result=runner.deriveProductionBuildIdentity({root,record,selection,promotion});
    assert.equal(result.derived.parentBuildIdentitySha256,baselineIdentity.buildIdentitySha256);
    assert.deepEqual(result.derived.selectedResponse,tuple);
    assert.notEqual(result.productionBuildIdentitySha256,baselineIdentity.buildIdentitySha256);
    assert.notEqual(result.derived.builds.production.wasm.sha256,record.builds.production.wasm.sha256);
    assert.equal(result.derived.builds.stage3e.wasm.sha256,record.builds.stage3e.wasm.sha256);
    assert.equal(result.derived.builds.stage4.wasm.sha256,record.builds.stage4.wasm.sha256);
    assert.equal(result.productionRecord.builds.production.wasm.sha256,result.derived.builds.production.wasm.sha256);
    const adaptiveSelection={...selection,extensionSelection:true,selection:{schema:'issue7-stage3e-extension-selection/v1',
      decision:'ADAPTIVE_MID_FULL_PASS',selectedAt:'2026-10-16T00:00:00.000Z',probeResultSha256:['1'.repeat(64)]},
      extension:{resultSha256:'2'.repeat(64),parentManifestSha256:'3'.repeat(64),screenResultSha256:'4'.repeat(64),fullResultSha256:'b'.repeat(64),
        parentManifest:{parents:{'low-full':{decision:'STAGE3E_LOW_FULL_PASS'},'midi51-final-diagnostic':{decision:'STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE'}}}},
      final:{sha256:'b'.repeat(64),result:{decision:'ADAPTIVE_MID_FULL_PASS',identity:baselineIdentity,
        summary:{selectedTuple:tuple,candidates:[{tuple,pass:true}]}}}};
    const adaptiveDerived=runner.deriveProductionBuildIdentity({root,record,selection:adaptiveSelection,promotion});
    assert.equal(adaptiveDerived.derived.stage3eSelectionSchema,'issue7-stage3e-extension-selection/v1');
    assert.equal(adaptiveDerived.derived.stage3eExtensionResultSha256,'2'.repeat(64));
    assert.equal(adaptiveDerived.derived.stage3eExtensionParentManifestSha256,'3'.repeat(64));
    assert.deepEqual(adaptiveDerived.derived.stage3eProbeResultSha256,['1'.repeat(64)]);
    assert.equal(adaptiveMid.assertPromotedDerivedIdentity(baselineIdentity,adaptiveSelection,adaptiveDerived.derived),true);
    assert.throws(()=>adaptiveMid.assertPromotedDerivedIdentity(baselineIdentity,adaptiveSelection,
      {...adaptiveDerived.derived,stage3eFullResultSha256:'9'.repeat(64)}),/does not bind this adaptive extension selection/);
    assert.throws(()=>runner.deriveProductionBuildIdentity({root,record,selection,promotion:{...promotion,changedPaths:[...runner.PROMOTION_PATHS,'README.md']}}),/BLOCKED_STAGE3_PROMOTION/);
    assert.throws(()=>runner.validatePromotionDetails({...promotion,changedPaths:runner.PROMOTION_PATHS.slice(1)},record.sourceCommit),/BLOCKED_STAGE3_PROMOTION/);
    const damaged={...promotion,readCommitFile:relative=>relative===runner.PROMOTION_PATHS[0]?parentFiles.get(relative):fs.readFileSync(path.join(root,relative))};
    assert.throws(()=>runner.deriveProductionBuildIdentity({root,record,selection,promotion:damaged}),/BLOCKED_STAGE3_PROMOTION/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('promotion status rejects partial staging without changing the index or worktree',t=>{
  const {root,git}=promotionRepo(t),paths=runner.PROMOTION_PATHS;
  for(const relative of paths){
    const target=path.join(root,relative);fs.writeFileSync(target,`promoted:${relative}\n`);
  }
  git(['add','--',paths[0]]);
  const indexBefore=git(['write-tree']),worktreeBefore=paths.map(relative=>fs.readFileSync(path.join(root,relative)));
  assert.throws(()=>runner.promotionStatus(root),/partial promotion staging/);
  assert.equal(git(['write-tree']),indexBefore);
  assert.deepEqual(paths.map(relative=>fs.readFileSync(path.join(root,relative))),worktreeBefore);
});

test('a restarted promotion runner accepts only complete four-path staging and validates its one-commit readback',t=>{
  const {root,git}=promotionRepo(t),paths=runner.PROMOTION_PATHS;
  for(const relative of paths)fs.writeFileSync(path.join(root,relative),`promoted:${relative}\n`);
  git(['add','--',...paths]);
  const modulePath=path.join(__dirname,'run-issue7-stage3-current-build.cjs');
  const restarted=JSON.parse(execFileSync(process.execPath,['-e',
    `const runner=require(${JSON.stringify(modulePath)});process.stdout.write(JSON.stringify(runner.promotionStatus(process.argv[1])));`,root],
    {encoding:'utf8'}));
  assert.deepEqual(restarted.stagedChanges,paths);
  assert.deepEqual(restarted.unstagedChanges,[]);
  git(['commit','-m',runner.PROMOTION_SUBJECT]);
  const commit=git(['rev-parse','HEAD']),parent=git(['rev-parse','HEAD^']);
  const details={commit,parent,parentTree:git(['rev-parse',`${parent}^{tree}`]),commitTree:git(['rev-parse',`${commit}^{tree}`]),
    changedPaths:git(['diff-tree','--no-commit-id','--name-only','-r','HEAD']).split(/\r?\n/).filter(Boolean).sort(),
    sourceCommitIsAncestor:true,currentHeadDescendsFromPromotion:true,
    readParentFile:relative=>execFileSync('rtk',['git','show',`${parent}:${relative}`],{cwd:root}),
    readCommitFile:relative=>execFileSync('rtk',['git','show',`${commit}:${relative}`],{cwd:root})};
  assert.equal(runner.validatePromotionDetails(details,parent),true);
  assert.deepEqual(runner.promotionStatus(root).stagedChanges,[]);
});

test('promotion readback resolves its frozen commit when HEAD is a later descendant',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-promotion-descendant-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  execFileSync('rtk',['git','init','-b',runner.PROMOTION_BRANCH,root],{stdio:'ignore'});
  const git=args=>execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();
  git(['config','user.name','Issue 7 frozen promotion test']);git(['config','user.email','issue7-frozen-promotion@example.invalid']);
  const tuple={low:0.35,mid:0.55,bassHardness:0.5},values={velocity_launch_scale_low:tuple.low,
    velocity_launch_scale_mid:tuple.mid,velocity_hardness_scale_bass:tuple.bassHardness};
  const presetsPath=runner.PROMOTION_PATHS.find(relative=>relative.endsWith('/presets.json'));
  const profilePath=runner.PROMOTION_PATHS.find(relative=>relative.endsWith('_profiles.h'));
  const presets={concert_grand:{engine_config:{hammer:{velocity_launch_scale_low:0.1,velocity_launch_scale_mid:0.1,
    velocity_hardness_scale_bass:0.1}}}};
  const profile=`.velocity_launch_scale_low = 0.1f\n.velocity_launch_scale_mid = 0.1f\n.velocity_hardness_scale_bass = 0.1f\n`;
  const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
  write(presetsPath,JSON.stringify(presets,null,2)+'\n');write(profilePath,profile);
  for(const relative of runner.PROMOTION_PATHS.filter(item=>item!==presetsPath&&item!==profilePath))write(relative,`baseline ${relative}\n`);
  const identityPath='docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json';
  write(identityPath,JSON.stringify({sourceCommit:'0'.repeat(40)},null,2)+'\n');
  git(['add','--',...runner.PROMOTION_PATHS,identityPath]);git(['commit','-m','baseline identity']);
  const sourceCommit=git(['rev-parse','HEAD']);
  write(identityPath,JSON.stringify({sourceCommit},null,2)+'\n');git(['add','--',identityPath]);git(['commit','-m','pin source identity']);
  const parentCommit=git(['rev-parse','HEAD']),parentTree=git(['rev-parse','HEAD^{tree}']);
  const record={sourceCommit,inputs:{presets:{sha256:core.sha256(fs.readFileSync(path.join(root,presetsPath)))},
    generatedProfile:{sha256:core.sha256(fs.readFileSync(path.join(root,profilePath)))}}};
  const selection={tuple,selectionSha256:'a'.repeat(64),selection:{selectedAt:'2026-10-17T00:00:00.000Z'},final:{sha256:'b'.repeat(64)}};
  const intent=runner.promotionIntent(root,record,selection,parentCommit,parentTree,{supersedesIntentSha256:'c'.repeat(64)});
  const promoted=JSON.parse(fs.readFileSync(path.join(root,presetsPath),'utf8'));
  Object.assign(promoted.concert_grand.engine_config.hammer,values);write(presetsPath,JSON.stringify(promoted,null,2)+'\n');
  let promotedProfile=fs.readFileSync(path.join(root,profilePath),'utf8');
  for(const [field,value] of Object.entries(values))promotedProfile=promotedProfile.replace(new RegExp(`(\\.${field}\\s*=\\s*)([-+0-9.eE]+)f`),`$1${value}f`);
  write(profilePath,promotedProfile);
  for(const relative of runner.PROMOTION_PATHS.filter(item=>item!==presetsPath&&item!==profilePath))write(relative,`promoted ${relative}\n`);
  git(['add','--',...runner.PROMOTION_PATHS]);git(['commit','-m',runner.PROMOTION_SUBJECT]);
  const promotionCommit=git(['rev-parse','HEAD']),promotionParentTree=git(['rev-parse','HEAD^^{tree}']);
  const promotionCommitTree=git(['rev-parse','HEAD^{tree}']);
  const receipt={intent,promotionCommit,promotionParentCommit:parentCommit,promotionParentTree,
    promotionCommitTree};
  write('README.md','later approved code descendant\n');git(['add','README.md']);git(['commit','-m','later code descendant']);
  assert.throws(()=>runner.readPromotionCommit(root,intent,record),/current commit does not match the pending dedicated promotion intent/);
  assert.equal(runner.readPromotionCommit(root,intent,record,receipt).commit,promotionCommit);
});

test('promotion readback rejects a commit that contains only a subset of the four paths',t=>{
  const {root,git}=promotionRepo(t),paths=runner.PROMOTION_PATHS.slice(0,3);
  for(const relative of paths)fs.writeFileSync(path.join(root,relative),`partial:${relative}\n`);
  git(['add','--',...paths]);git(['commit','-m',runner.PROMOTION_SUBJECT]);
  const commit=git(['rev-parse','HEAD']),parent=git(['rev-parse','HEAD^']);
  const details={commit,parent,parentTree:git(['rev-parse',`${parent}^{tree}`]),commitTree:git(['rev-parse',`${commit}^{tree}`]),
    changedPaths:git(['diff-tree','--no-commit-id','--name-only','-r','HEAD']).split(/\r?\n/).filter(Boolean).sort(),
    sourceCommitIsAncestor:true,currentHeadDescendsFromPromotion:true,readParentFile:()=>Buffer.alloc(0),readCommitFile:()=>Buffer.alloc(0)};
  assert.throws(()=>runner.validatePromotionDetails(details,parent),/exactly the four approved promotion paths/);
});

test('recovery appends one successor intent at R and resumes the exact four-path single-parent promotion',t=>{
  const fixture=recoveryPromotionRepo(t),{root,home,git,roots,record,selection,recoveryCommit,oldBytes,oldPaths,oldStats}=fixture;
  let acousticCalls=0,prepareCalls=0,verifyCalls=0;
  const verifyRevision4=()=>{verifyCalls++;return {sha256:'9'.repeat(64),value:{revisionNumber:4,codeRevision:recoveryCommit}};};
  const writeSelected=(target,selectedRecord,tuple)=>{
    prepareCalls++;
    const presets=runner.PROMOTION_PATHS.find(relative=>relative.endsWith('/presets.json'));
    const profile=runner.PROMOTION_PATHS.find(relative=>relative.endsWith('_profiles.h'));
    fs.writeFileSync(path.join(target,presets),JSON.stringify({concert_grand:{engine_config:{hammer:{
      velocity_launch_scale_low:tuple.low,velocity_launch_scale_mid:tuple.mid,velocity_hardness_scale_bass:tuple.bassHardness}}}},null,2)+'\n');
    fs.writeFileSync(path.join(target,profile),`.velocity_launch_scale_low = ${tuple.low}f;\n.velocity_launch_scale_mid = ${tuple.mid}f;\n.velocity_hardness_scale_bass = ${tuple.bassHardness}f;\n`);
    for(const relative of runner.PROMOTION_PATHS.filter(item=>item!==presets&&item!==profile))
      fs.writeFileSync(path.join(target,relative),`derived:${selectedRecord.sourceCommit}:${relative}\n`);
  };
  const common={root,record,selection,roots,now:()=>selection.selection.selectedAt,verifyRevision4};
  assert.throws(()=>runner.ensurePromotionCommit({...common,prepareSelectedFiles:()=>{throw new Error('simulated interruption after intent write');}}),
    /simulated interruption after intent write/);
  assert.equal(git(['rev-parse','HEAD']),recoveryCommit);
  assert.equal(acousticCalls,0);
  const successorRelative=runner.PROMOTION_INTENT_02_REL,successorPaths=core.dualPaths(roots,successorRelative);
  const successorBytes=core.readDualBytes(roots,successorRelative),successor=runner.maybeReadDualObject(roots,successorRelative);
  assert.equal(successor.parentCommit,recoveryCommit);
  assert.equal(successor.parentTree,git(['rev-parse',`${recoveryCommit}^{tree}`]));
  assert.equal(successor.supersedesIntentSha256,oldBytes.sha256);
  assert.deepEqual(fs.readFileSync(successorPaths.primary),fs.readFileSync(successorPaths.secondary));
  assert.deepEqual(fs.readFileSync(oldPaths.primary),oldBytes.bytes);assert.deepEqual(fs.readFileSync(oldPaths.secondary),oldBytes.bytes);
  assert.deepEqual([oldPaths.primary,oldPaths.secondary].map(file=>fs.statSync(file).mtimeMs),oldStats);
  assert.ok(successorBytes.sha256);
  writeSelected(root,record,selection.tuple);
  git(['add','--',...runner.PROMOTION_PATHS]);
  const promoted=runner.ensurePromotionCommit({...common,prepareSelectedFiles:writeSelected});
  assert.equal(promoted.details.parent,recoveryCommit);
  assert.deepEqual(promoted.details.changedPaths,runner.PROMOTION_PATHS);
  assert.equal(git(['rev-list','--parents','-n','1','HEAD']).split(/\s+/).length,2);
  const promotionCommit=git(['rev-parse','HEAD']);
  assert.equal(git(['rev-parse','HEAD^']),recoveryCommit);
  assert.deepEqual([oldPaths.primary,oldPaths.secondary].map(file=>fs.statSync(file).mtimeMs),oldStats);
  assert.deepEqual(fs.readFileSync(oldPaths.primary),oldBytes.bytes);assert.deepEqual(fs.readFileSync(oldPaths.secondary),oldBytes.bytes);
  assert.equal(acousticCalls,0);
  assert.equal(runner.ensurePromotionCommit({...common,prepareSelectedFiles:writeSelected}).reused,true);
  assert.equal(git(['rev-parse','HEAD']),promotionCommit);
  const receiptPaths=core.dualPaths(roots,runner.PROMOTION_RECEIPT_REL);
  fs.rmSync(receiptPaths.primary);fs.rmSync(receiptPaths.secondary);
  const recoveredAfterCommit=runner.ensurePromotionCommit({...common,prepareSelectedFiles:writeSelected});
  assert.equal(recoveredAfterCommit.details.commit,promotionCommit);
  assert.equal(git(['rev-parse','HEAD']),promotionCommit);
  assert.equal(prepareCalls,2);
  assert.equal(verifyCalls>=4,true);
  assert.equal(acousticCalls,0);
  fs.writeFileSync(path.join(root,'README.md'),'unexpected later HEAD\n');git(['add','README.md']);git(['commit','-m','unexpected later HEAD']);
  assert.throws(()=>runner.ensurePromotionCommit({...common,prepareSelectedFiles:writeSelected}),/BLOCKED_STAGE3_PROMOTION/);
});

test('successor intent recovery blocks without revision 4 and rejects old receipt, mismatched stores, and extra intents',t=>{
  const withoutRevision4=recoveryPromotionRepo(t);
  assert.throws(()=>runner.ensurePromotionCommit({root:withoutRevision4.root,record:withoutRevision4.record,
    selection:withoutRevision4.selection,roots:withoutRevision4.roots,verifyRevision4:()=>{throw new Error('revision 4 absent');}}),/revision 4 absent/);
  assert.equal(fs.existsSync(core.dualPaths(withoutRevision4.roots,runner.PROMOTION_INTENT_02_REL).primary),false);

  const oldReceipt=recoveryPromotionRepo(t);
  runner.storeDualObject(oldReceipt.roots,runner.PROMOTION_RECEIPT_REL,{intent:oldReceipt.oldIntent});
  assert.throws(()=>runner.ensurePromotionCommit({root:oldReceipt.root,record:oldReceipt.record,selection:oldReceipt.selection,
    roots:oldReceipt.roots,verifyRevision4:()=>({value:{revisionNumber:4,codeRevision:oldReceipt.recoveryCommit}})}),/old receipt prevents successor intent/);
  assert.equal(fs.existsSync(core.dualPaths(oldReceipt.roots,runner.PROMOTION_INTENT_02_REL).primary),false);

  const oneStore=recoveryPromotionRepo(t);
  const oneStoreValue=runner.promotionIntent(oneStore.root,oneStore.record,oneStore.selection,oneStore.recoveryCommit,
    oneStore.git(['rev-parse',`${oneStore.recoveryCommit}^{tree}`]),{supersedesIntentSha256:oneStore.oldBytes.sha256});
  const oneStorePaths=core.dualPaths(oneStore.roots,runner.PROMOTION_INTENT_02_REL);
  fs.mkdirSync(path.dirname(oneStorePaths.primary),{recursive:true});fs.writeFileSync(oneStorePaths.primary,core.canonicalBytes(oneStoreValue));
  assert.throws(()=>runner.ensurePromotionCommit({root:oneStore.root,record:oneStore.record,selection:oneStore.selection,
    roots:oneStore.roots,verifyRevision4:()=>({value:{revisionNumber:4,codeRevision:oneStore.recoveryCommit}})}),/intent directory entries differ/);

  const mismatched=recoveryPromotionRepo(t);
  const wrongIntent=runner.promotionIntent(mismatched.root,mismatched.record,mismatched.selection,mismatched.recoveryCommit,
    mismatched.git(['rev-parse',`${mismatched.recoveryCommit}^{tree}`]),{supersedesIntentSha256:'0'.repeat(64)});
  runner.storeDualObject(mismatched.roots,runner.PROMOTION_INTENT_02_REL,wrongIntent);
  assert.throws(()=>runner.ensurePromotionCommit({root:mismatched.root,record:mismatched.record,selection:mismatched.selection,
    roots:mismatched.roots,verifyRevision4:()=>({value:{revisionNumber:4,codeRevision:mismatched.recoveryCommit}})}),/intent differs from the immutable selection/);

  const third=recoveryPromotionRepo(t);
  runner.storeDualObject(third.roots,'promotion/intent-03.json',{schemaVersion:1,third:true});
  assert.throws(()=>runner.ensurePromotionCommit({root:third.root,record:third.record,selection:third.selection,
    roots:third.roots,verifyRevision4:()=>({value:{revisionNumber:4,codeRevision:third.recoveryCommit}})}),/unexpected third promotion intent/);

  const changedR=recoveryPromotionRepo(t);
  fs.writeFileSync(path.join(changedR.root,'README.md'),'changed after R\n');changedR.git(['add','README.md']);changedR.git(['commit','-m','changed R']);
  assert.throws(()=>runner.ensurePromotionCommit({root:changedR.root,record:changedR.record,selection:changedR.selection,
    roots:changedR.roots,verifyRevision4:()=>({value:{revisionNumber:4,codeRevision:changedR.recoveryCommit}})}),/no exact accepted revision-4 recovery commit is active at HEAD/);
});

test('Stage3 runner exposes only the contract modes and no legacy authoritative namespace',()=>{
  assert.deepEqual(['--dry-run','--execute','--finalize','--verify'].map(arg=>runner.parseMode([arg])),['dry-run','execute','finalize','verify']);
  assert.throws(()=>runner.parseMode(['--next']),/unsupported mode/);
  const source=fs.readFileSync(path.join(__dirname,'run-issue7-stage3-current-build.cjs'),'utf8');
  assert.doesNotMatch(source,/stage3\/authoritative|run-stage3e-master-orchestrator\.cjs/);
  assert.doesNotMatch(source,/readGitHubApproval|verifyAndPersistAuthorization|AUTHORIZATION_REQUIRED/);
});
