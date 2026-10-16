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

test('derived production identity binds the selected tuple to a dedicated promotion commit and preserves diagnostic builds',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3-derived-'));
  try{
    const record=structuredClone(runner.identityRecord()),sourceRoot=runner.ROOT;
    record.sourceCommit='1'.repeat(40);
    for(const entry of Object.values(record.inputs)){
      const target=path.join(root,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(sourceRoot,entry.path),target);
    }
    for(const relative of runner.PROMOTION_PATHS.filter(file=>file.endsWith('super-synth_descriptor.cbor')||file.endsWith('super-synth_descriptor.h'))){
      const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(sourceRoot,relative),target);
    }
    const toolchainTarget=path.join(root,record.toolchain.toolchainFile);
    fs.mkdirSync(path.dirname(toolchainTarget),{recursive:true});fs.copyFileSync(path.join(sourceRoot,record.toolchain.toolchainFile),toolchainTarget);
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
    const parentFiles=new Map(runner.PROMOTION_PATHS.map(relative=>[relative,fs.readFileSync(path.join(sourceRoot,relative))]));
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

test('Stage3 runner exposes only the contract modes and no legacy authoritative namespace',()=>{
  assert.deepEqual(['--dry-run','--execute','--finalize','--verify'].map(arg=>runner.parseMode([arg])),['dry-run','execute','finalize','verify']);
  assert.throws(()=>runner.parseMode(['--next']),/unsupported mode/);
  const source=fs.readFileSync(path.join(__dirname,'run-issue7-stage3-current-build.cjs'),'utf8');
  assert.doesNotMatch(source,/stage3\/authoritative|run-stage3e-master-orchestrator\.cjs/);
  assert.doesNotMatch(source,/readGitHubApproval|verifyAndPersistAuthorization|AUTHORIZATION_REQUIRED/);
});
