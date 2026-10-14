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

test('Stage3 execution has no approval gate and blocks before rendering when Stage3E selection is absent',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3-no-approval-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  assert.throws(()=>runner.run({mode:'execute',root:runner.ROOT,home}),/BLOCKED_STAGE3E_SELECTION_REQUIRED/);
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

test('derived production identity binds the selected tuple to a dedicated promotion commit and preserves diagnostic builds',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3-derived-'));
  try{
    const record=structuredClone(runner.identityRecord()),sourceRoot=runner.ROOT;
    record.sourceCommit='1'.repeat(40);
    for(const entry of Object.values(record.inputs)){
      const target=path.join(root,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(sourceRoot,entry.path),target);
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
    const baselineIdentity={sourceCommit:record.sourceCommit,buildIdentitySha256:core.sha256(fs.readFileSync(identityPath)),
      inputs:Object.fromEntries(Object.entries(record.inputs).map(([key,value])=>[key,{path:value.path,sha256:value.sha256}])),
      builds:Object.fromEntries(Object.entries(record.builds).map(([role,build])=>[role,{cmakeCacheSha256:build.cmakeCacheSha256,wasmSha256:build.wasm.sha256}]))};
    const parentFiles=new Map(runner.PROMOTION_PATHS.map(relative=>[relative,fs.readFileSync(path.join(sourceRoot,relative))]));
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
    assert.throws(()=>runner.deriveProductionBuildIdentity({root,record,selection,promotion:{...promotion,changedPaths:[...runner.PROMOTION_PATHS,'README.md']}}),/BLOCKED_STAGE3_PROMOTION/);
    const damaged={...promotion,readCommitFile:relative=>relative===runner.PROMOTION_PATHS[0]?parentFiles.get(relative):fs.readFileSync(path.join(root,relative))};
    assert.throws(()=>runner.deriveProductionBuildIdentity({root,record,selection,promotion:damaged}),/BLOCKED_STAGE3_PROMOTION/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Stage3 runner exposes only the contract modes and no legacy authoritative namespace',()=>{
  assert.deepEqual(['--dry-run','--execute','--finalize','--verify'].map(arg=>runner.parseMode([arg])),['dry-run','execute','finalize','verify']);
  assert.throws(()=>runner.parseMode(['--next']),/unsupported mode/);
  const source=fs.readFileSync(path.join(__dirname,'run-issue7-stage3-current-build.cjs'),'utf8');
  assert.doesNotMatch(source,/stage3\/authoritative|run-stage3e-master-orchestrator\.cjs/);
  assert.doesNotMatch(source,/readGitHubApproval|verifyAndPersistAuthorization|AUTHORIZATION_REQUIRED/);
});
