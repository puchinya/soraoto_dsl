'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const core=require('./issue7-current-build-core.cjs');
const adaptiveMid=require('./run-issue7-adaptive-mid.cjs');
const capture=require('./capture-supersynth-matrix.cjs');
const evaluator=require('./run-stage3-production-recovery.cjs');
const direct=require('./stage3-direct-reference-metrics.cjs');

const ROOT=core.ROOT;
const STAGE='stage3';
const PHASE='stage3';
const REGRESSION_REL='.agent-state/issues/7/current-build-v1/stage3-regression-results.json';
const IDENTITY_REL='docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json';
const FIXTURE_REL='wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json';
const SOURCE_REL='wasm/plugins/dsp/super-synth/src/plugin.c';
const PRESETS_REL='wasm/plugins/dsp/super-synth/presets.json';
const PROFILE_REL='wasm/shared/generated/super-synth_grand_profiles.h';
const GENERATED_DESCRIPTOR_CBO_REL='wasm/shared/generated/super-synth_descriptor.cbor';
const GENERATED_DESCRIPTOR_HEADER_REL='wasm/shared/generated/super-synth_descriptor.h';
const CAPTURE_REL='wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs';
const EVALUATOR_REL='wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs';
const RUNNER_REL='wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs';
const DERIVED_IDENTITY_REL='production-build-identity.json';
const PROMOTION_PATHS=Object.freeze([PRESETS_REL,PROFILE_REL,GENERATED_DESCRIPTOR_CBO_REL,GENERATED_DESCRIPTOR_HEADER_REL].sort());
const PROMOTION_INTENT_REL='promotion/intent.json';
const PROMOTION_INTENT_02_REL='promotion/intent-02.json';
const PROMOTION_RECEIPT_REL='promotion/receipt.json';
const PROMOTION_BRANCH='codex/issue-7-supersynth-v9';
const PROMOTION_SUBJECT='stage3e: promote selected velocity response';
const REGRESSION_TESTS=Object.freeze({
  concertGrand:'wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js',
  pianoRealism:'wasm/plugins/dsp/super-synth/test/piano-realism-regression.test.js',
  pianoClick:'wasm/plugins/dsp/super-synth/test/piano-click-regression.test.js',
  pianoVoiceSteal:'wasm/plugins/dsp/super-synth/test/piano-voice-steal-regression.test.js',
  pluginInterfaceV1:'wasm/plugins/dsp/super-synth/test/plugin-interface-v1.test.js',
  playbackSafety:'wasm/plugins/dsp/super-synth/test/playback-safety-regression.test.js'
});
const FILE_BYTES_CACHE=new Map(),FILE_SHA_CACHE=new Map(),PROMOTION_CACHE=new Map(),COMMIT_BLOB_CACHE=new Map(),COMMIT_BLOB_SHA_CACHE=new WeakMap(),EXPORTS_CACHE=new Map();
const REQUIRED_REGRESSIONS=Object.freeze([...evaluator.REQUIRED_REGRESSIONS]);
const CELL_SPECS=Object.freeze(evaluator.CELL_SPECS.map(cell=>Object.freeze({...cell,key:evaluator.key(cell).replaceAll(':','-')})));

function sha256(bytes){return core.sha256(bytes);}
function fileSha(root,relative){return sha256(fs.readFileSync(path.join(root,relative)));}
function identityRecord(root=ROOT){return JSON.parse(fs.readFileSync(path.join(root,IDENTITY_REL),'utf8'));}
function repoSha(root,relative){
  const bytes=repoFile(root,relative),absolute=path.resolve(fs.realpathSync(path.resolve(root)),relative),cached=FILE_SHA_CACHE.get(absolute);
  const entry=FILE_BYTES_CACHE.get(absolute);
  if(cached?.bytes===bytes)return cached.sha256;
  const digest=sha256(bytes);FILE_SHA_CACHE.set(absolute,{bytes,sha256:digest});
  if(entry)entry.sha256=digest;
  return digest;
}
function git(root,args){return execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();}
function gitRaw(root,args){return execFileSync('rtk',['proxy','git',...args],{cwd:root,encoding:'utf8'}).trim();}
function isCommitAncestor(root,ancestor,descendant='HEAD'){
  try{execFileSync('rtk',['git','merge-base','--is-ancestor',ancestor,descendant],{cwd:root,stdio:'ignore'});return true;}
  catch{return false;}
}
function isAncestor(root,ancestor){return isCommitAncestor(root,ancestor,'HEAD');}
function repoFile(root,relative){
  const canonicalRoot=fs.realpathSync(path.resolve(root)),absolute=path.resolve(canonicalRoot,relative);
  if(!core.inside(canonicalRoot,absolute))throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: path escaped repository root: ${relative}`);
  if(fs.realpathSync(absolute)!==absolute)throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: symlink input: ${relative}`);
  const statKey=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');
  const before=fs.statSync(absolute,{bigint:true}),fingerprint=statKey(before),cached=FILE_BYTES_CACHE.get(absolute);
  if(cached?.fingerprint===fingerprint)return cached.bytes;
  const bytes=fs.readFileSync(absolute),after=fs.statSync(absolute,{bigint:true});
  if(statKey(after)!==fingerprint)throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: input changed during identity read: ${relative}`);
  FILE_BYTES_CACHE.set(absolute,{fingerprint,bytes});
  return bytes;
}
function readStoredPromotionIdentity(root,selection){
  const selectedRoots=selection?.roots;
  if(!selectedRoots?.commonDirectory||!selectedRoots?.home)return null;
  const roots=core.resolveRoots(root,STAGE,core.EPOCH,{home:selectedRoots.home,commonDirectory:selectedRoots.commonDirectory});
  const paths=core.dualPaths(roots,DERIVED_IDENTITY_REL);
  if(!fs.existsSync(paths.primary)&&!fs.existsSync(paths.secondary))return null;
  const stored=core.readDualBytes(roots,DERIVED_IDENTITY_REL),derived=JSON.parse(stored.bytes.toString('utf8'));
  if(!stored.bytes.equals(core.canonicalBytes(derived)))throw new Error('BLOCKED_STAGE3_PROMOTION: stored production identity is not canonical');
  return derived;
}
function validateFrozenPromotion(details,frozen){
  if(!frozen)return details;
  if(details.commit!==frozen.promotionCommit||details.parent!==frozen.promotionParentCommit
      ||details.parentTree!==frozen.promotionParentTree||details.commitTree!==frozen.promotionCommitTree)
    throw new Error('BLOCKED_STAGE3_PROMOTION: promotion commit, parent, or tree differs from immutable production identity');
  if(details.currentHeadDescendsFromPromotion!==true)
    throw new Error('BLOCKED_STAGE3_PROMOTION: current HEAD is not a descendant of the immutable promotion commit');
  return details;
}
function promotionDetails(root,frozen){
  const canonicalRoot=fs.realpathSync(path.resolve(root)),status=git(root,['status','--porcelain=v2','--branch','--untracked-files=no']);
  const statusLines=status.split(/\r?\n/),branch=statusLines.find(line=>line.startsWith('# branch.oid '));
  const head=branch?.slice('# branch.oid '.length),commit=frozen?.promotionCommit||head,cacheKey=`${canonicalRoot}:${head}:${commit}`;
  if(!head||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(head)||!commit||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))
    throw new Error('BLOCKED_STAGE3_PROMOTION: current HEAD or promotion identity is unavailable');
  if(statusLines.some(line=>line&&!line.startsWith('# ')))throw new Error('BLOCKED_STAGE3_PROMOTION: tracked worktree changes remain after the dedicated promotion commit');
  const cached=PROMOTION_CACHE.get(cacheKey);if(cached)return validateFrozenPromotion(cached,frozen);
  if(frozen&&!isCommitAncestor(root,commit,head))throw new Error('BLOCKED_STAGE3_PROMOTION: current HEAD is not a descendant of the immutable promotion commit');
  const parents=gitRaw(root,['rev-list','--parents','-n','1',commit]).split(/\s+/).filter(Boolean);
  if(parents.length!==2||parents[0]!==commit)throw new Error('BLOCKED_STAGE3_PROMOTION: promotion must be a single-parent commit');
  const parent=parents[1],changedPaths=gitRaw(root,['diff-tree','--no-commit-id','--name-only','-r','--no-renames',commit]).split(/\r?\n/).filter(Boolean).sort();
  const parentTree=git(root,['rev-parse',`${parent}^{tree}`]),commitTree=git(root,['rev-parse',`${commit}^{tree}`]);
  const readBlob=(revision,relative)=>{
    const key=`${canonicalRoot}:${revision}:${relative}`;
    // rtk git show decodes opaque CBOR bytes as UTF-8, which corrupts promotion identity hashes.
    if(!COMMIT_BLOB_CACHE.has(key))COMMIT_BLOB_CACHE.set(key,execFileSync('git',['show',`${revision}:${relative}`],{cwd:root,maxBuffer:16*1024*1024}));
    return COMMIT_BLOB_CACHE.get(key);
  };
  const details={commit,parent,parentTree,commitTree,changedPaths,currentHead:head,currentHeadDescendsFromPromotion:isCommitAncestor(root,commit,head),
    readParentFile:relative=>readBlob(parent,relative),
    readCommitFile:relative=>readBlob(commit,relative),
    sourceCommitIsAncestor:isCommitAncestor(root,identityRecord(root).sourceCommit,parent)};
  PROMOTION_CACHE.set(cacheKey,details);
  return validateFrozenPromotion(details,frozen);
}
function validatePromotionDetails(details,sourceCommit){
  if(!details||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(details.commit||'')||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(details.parent||''))
    throw new Error('BLOCKED_STAGE3_PROMOTION: promotion commit identity is invalid');
  if(!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(details.parentTree||'')||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(details.commitTree||''))
    throw new Error('BLOCKED_STAGE3_PROMOTION: promotion parent and commit tree identities are required');
  if(!core.same(details.changedPaths,PROMOTION_PATHS))
    throw new Error('BLOCKED_STAGE3_PROMOTION: dedicated promotion commit must change exactly the four approved promotion paths');
  if(details.sourceCommitIsAncestor!==true)throw new Error('BLOCKED_STAGE3_PROMOTION: original build source commit is not an ancestor of the promotion parent');
  if(details.currentHeadDescendsFromPromotion!==true)throw new Error('BLOCKED_STAGE3_PROMOTION: current HEAD must descend from the dedicated promotion commit');
  if(typeof details.readParentFile!=='function'||typeof details.readCommitFile!=='function')
    throw new Error('BLOCKED_STAGE3_PROMOTION: immutable parent and commit file readback is required');
  for(const relative of PROMOTION_PATHS){
    const before=Buffer.from(details.readParentFile(relative)),after=Buffer.from(details.readCommitFile(relative));
    if(sha256(before)===sha256(after))throw new Error(`BLOCKED_STAGE3_PROMOTION: promotion path is unchanged in the commit: ${relative}`);
  }
  return true;
}
function derivedBuildSnapshot(root,record,baselineIdentity,promotion){
  const toolchainFile=record.toolchain?.toolchainFile,expectedToolchainSha256=record.toolchain?.toolchainFileSha256;
  if(!toolchainFile||!/^([a-f0-9]{64})$/.test(expectedToolchainSha256||''))
    throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: toolchain file identity is missing');
  const toolchainFileSha256=repoSha(root,toolchainFile);
  if(toolchainFileSha256!==expectedToolchainSha256)
    throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: toolchain file changed: ${toolchainFile}`);
  const inputs={};
  for(const [key,entry] of Object.entries(record.inputs||{})){
    const bytes=repoFile(root,entry.path),actual=repoSha(root,entry.path),baseline=baselineIdentity.inputs?.[key]?.sha256;
    const promoted=key==='presets'||key==='generatedProfile';
    if(!baseline||baseline!==entry.sha256)throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: Stage3E baseline identity differs for ${entry.path}`);
    if(!promoted&&actual!==entry.sha256)throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: non-promotion input changed: ${entry.path}`);
    if(promoted&&hashCommitBlob(promotion,entry.path,'parent')!==entry.sha256)
      throw new Error(`BLOCKED_STAGE3_PROMOTION: parent tree does not preserve baseline ${entry.path}`);
    if(hashCommitBlob(promotion,entry.path,'commit')!==actual)
      throw new Error(`BLOCKED_STAGE3_PROMOTION: committed ${entry.path} differs from the working tree`);
    inputs[key]={path:entry.path,sha256:actual};
  }
  for(const relative of [GENERATED_DESCRIPTOR_CBO_REL,GENERATED_DESCRIPTOR_HEADER_REL]){
    const digest=repoSha(root,relative),parentDigest=hashCommitBlob(promotion,relative,'parent'),commitDigest=hashCommitBlob(promotion,relative,'commit');
    if(parentDigest===commitDigest)throw new Error(`BLOCKED_STAGE3_PROMOTION: generated metadata is unchanged in the promotion commit: ${relative}`);
    if(commitDigest!==digest)throw new Error(`BLOCKED_STAGE3_PROMOTION: committed generated metadata differs from the working tree: ${relative}`);
  }
  const builds={},metadataOutputs={};
  for(const [role,build] of Object.entries(record.builds||{})){
    const base=baselineIdentity.builds?.[role];
    if(!base||base.cmakeCacheSha256!==build.cmakeCacheSha256||base.wasmSha256!==build.wasm.sha256)
      throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: Stage3E baseline build differs for ${role}`);
    const cacheBytes=repoFile(root,`${build.buildDirectory}/CMakeCache.txt`),cacheSha=repoSha(root,`${build.buildDirectory}/CMakeCache.txt`),cacheValues=core.parseCache(cacheBytes);
    if(cacheSha!==build.cmakeCacheSha256)throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: ${role} CMakeCache changed`);
    for(const [name,expected] of Object.entries(build.flags||{})){
      const normalized=String(expected).replace(/\s*\(repository default\)$/,'');
      if(cacheValues[`SORAOTO_SUPERSYNTH_${name}`]!==normalized)throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: ${role} flag ${name} changed`);
    }
    const wasmBytes=repoFile(root,`${build.buildDirectory}/${build.wasm.path}`),wasmSha=repoSha(root,`${build.buildDirectory}/${build.wasm.path}`);
    if(role!=='production'&&wasmSha!==build.wasm.sha256)throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: immutable ${role} WASM changed`);
    const descriptors={};
    for(const [name,relative] of Object.entries({descriptorCbor:`${build.buildDirectory}/generated/super-synth_descriptor.cbor`,descriptorHeader:`${build.buildDirectory}/generated/super-synth_descriptor.h`})){
      const bytes=repoFile(root,relative),digest=repoSha(root,relative),expected=record.metadataOutputs[`${name}Sha256`];
      if(role!=='production'&&digest!==expected)
        throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: immutable ${role} ${name} changed`);
      descriptors[name]={path:relative,bytes:bytes.length,sha256:digest};
    }
    builds[role]={buildDirectory:build.buildDirectory,target:build.target,cmakeCacheSha256:cacheSha,flags:build.flags,
      wasm:{path:build.wasm.path,bytes:wasmBytes.length,sha256:wasmSha}};
    metadataOutputs[role]=descriptors;
  }
  return {inputs,builds,metadataOutputs,toolchainFileSha256};
}
function hashCommitBlob(promotion,relative,side){
  let digests=COMMIT_BLOB_SHA_CACHE.get(promotion);
  if(!digests){digests=new Map();COMMIT_BLOB_SHA_CACHE.set(promotion,digests);}
  const key=`${side}:${relative}`;
  if(digests.has(key))return digests.get(key);
  const bytes=side==='parent'?promotion.readParentFile(relative):promotion.readCommitFile(relative),digest=sha256(bytes);
  digests.set(key,digest);return digest;
}
function deriveProductionBuildIdentity({root=ROOT,record=identityRecord(root),selection,promotion:providedPromotion}={}){
  const adaptive=selection?.extensionSelection===true;
  const acceptedDecision=adaptive?'ADAPTIVE_MID_FULL_PASS':'STAGE3E_MID_FULL_PASS';
  if(!selection||selection.final?.result?.decision!==acceptedDecision)
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: a passing Stage3E full result under a recognized selection schema is required for promotion');
  if(adaptive&&(selection.selection?.schema!=='issue7-stage3e-extension-selection/v1'||selection.selection.decision!=='ADAPTIVE_MID_FULL_PASS'
      ||selection.extension?.parentManifest?.parents?.['midi51-final-diagnostic']?.decision!=='STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE'
      ||selection.extension?.parentManifest?.parents?.['low-full']?.decision!=='STAGE3E_LOW_FULL_PASS'))
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: adaptive extension schema is not bound to the approved parent results');
  const selectionIdentity=selection.final.result.identity,identityBytes=repoFile(root,IDENTITY_REL),identitySha256=sha256(identityBytes);
  if(!core.same(JSON.parse(identityBytes.toString('utf8')),record))throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: supplied original build record differs from the immutable tracked bytes');
  if(selectionIdentity?.buildIdentitySha256!==identitySha256||selectionIdentity?.sourceCommit!==record.sourceCommit)
    throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: Stage3E result is not bound to the immutable original build identity');
  const frozenPromotion=readStoredPromotionIdentity(root,selection);
  const promotion=providedPromotion||promotionDetails(root,frozenPromotion);
  validatePromotionDetails(promotion,record.sourceCommit);
  const snapshot=derivedBuildSnapshot(root,record,selectionIdentity,promotion);
  const tuple=selection.tuple;
  assertPromotedValues(root,tuple);
  if(snapshot.inputs.presets.sha256===record.inputs.presets.sha256&&snapshot.inputs.generatedProfile.sha256===record.inputs.generatedProfile.sha256)
    throw new Error('BLOCKED_STAGE3_PROMOTION: selected tuple produced no committed preset/profile change');
  const productionBuild=snapshot.builds.production;
  if(productionBuild.wasm.sha256===record.builds.production.wasm.sha256)
    throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: promoted production WASM SHA did not change with the selected profile');
  const productionRecord={...record,inputs:snapshot.inputs,builds:{...record.builds,production:{...record.builds.production,
      cmakeCacheSha256:productionBuild.cmakeCacheSha256,wasm:productionBuild.wasm}},
    metadataOutputs:{...record.metadataOutputs,
      descriptorCborBytes:snapshot.metadataOutputs.production.descriptorCbor.bytes,
      descriptorCborSha256:snapshot.metadataOutputs.production.descriptorCbor.sha256,
      descriptorHeaderBytes:snapshot.metadataOutputs.production.descriptorHeader.bytes,
      descriptorHeaderSha256:snapshot.metadataOutputs.production.descriptorHeader.sha256,
      allThreeBuildsIdentical:Object.values(snapshot.metadataOutputs).every(item=>core.same(item,snapshot.metadataOutputs.production))}};
  const exports=assertProductionExports(root,productionRecord);
  const derived={schemaVersion:1,issue:7,epoch:core.EPOCH,stage:'stage3-production',promotionCommit:promotion.commit,
    promotionParentCommit:promotion.parent,promotionParentTree:promotion.parentTree,promotionCommitTree:promotion.commitTree,
    parentBuildIdentitySha256:identitySha256,parentSourceCommit:record.sourceCommit,toolchainFileSha256:snapshot.toolchainFileSha256,
    stage3eSelectionSchema:adaptive?'issue7-stage3e-extension-selection/v1':'legacy-mid-full-selection/v1',
    stage3eSelectionSha256:selection.selectionSha256,stage3eResultSha256:selection.final.sha256,
    stage3eIdentitySha256:sha256(core.canonicalBytes(selectionIdentity)),selectedResponse:tuple,
    ...(adaptive?{stage3eExtensionResultSha256:selection.extension.resultSha256,
      stage3eExtensionParentManifestSha256:selection.extension.parentManifestSha256,
      stage3eProbeResultSha256:selection.selection.probeResultSha256,
      stage3eScreenResultSha256:selection.extension.screenResultSha256,
      stage3eFullResultSha256:selection.extension.fullResultSha256}:{}),
    inputs:snapshot.inputs,builds:snapshot.builds,metadataOutputs:snapshot.metadataOutputs,productionExports:exports};
  return {derived,productionRecord,productionBuildIdentitySha256:sha256(core.canonicalBytes(derived))};
}
function buildDirectory(root,record){
  const item=record.builds?.production;
  if(!item)throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: production build is missing');
  return path.resolve(root,item.buildDirectory);
}
function productionWasm(root,record){
  const item=record.builds?.production;
  if(!item?.wasm?.path)throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: production WASM identity is missing');
  return path.join(buildDirectory(root,record),item.wasm.path);
}
function assertProductionExports(root,record){
  const item=record.builds?.production,relative=`${item?.buildDirectory}/${item?.wasm?.path}`;
  if(!item?.wasm?.path)throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: production WASM identity is missing');
  const bytes=repoFile(root,relative),cacheKey=`${fs.realpathSync(root)}:${sha256(bytes)}`;
  let names=EXPORTS_CACHE.get(cacheKey);
  if(!names){names=WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(entry=>entry.name).sort();EXPORTS_CACHE.set(cacheKey,names);}
  if(names.some(name=>name.includes('stage3e_')))throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: production exports Stage3E diagnostic controls');
  for(const name of ['soraoto_plugin_abi_version','soraoto_plugin_init','soraoto_plugin_process','soraoto_plugin_terminate'])
    if(!names.includes(name))throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: production export missing ${name}`);
  return names.sort();
}
function readSelection(root=ROOT,home=os.homedir(),epoch=core.EPOCH,{allowSyntheticTest=false}={}){
  const roots=core.resolveRoots(root,'stage3e',epoch,{home});
  let stored,final;
  const extension=adaptiveMid.loadSelection(root,home,epoch);
  if(extension){
    if(extension.selection.decision!=='ADAPTIVE_MID_FULL_PASS'||extension.selection.schema!=='issue7-stage3e-extension-selection/v1'
        ||(extension.selection.syntheticTest===true&&!allowSyntheticTest))
      throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: adaptive extension selection is invalid or synthetic');
    return extension;
  }
  try{
    stored=core.readDualBytes(roots,'selection.json');
    final=core.readFinal(roots,'mid-full');
  }catch(error){throw new Error(`BLOCKED_STAGE3E_SELECTION_REQUIRED: ${error.message}`);}
  const selection=JSON.parse(stored.bytes.toString('utf8'));
  if(selection.issue!==7||selection.epoch!==epoch||selection.decision!=='STAGE3E_SELECTED_RESPONSE'
      ||(selection.syntheticTest===true&&!allowSyntheticTest))
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: selection is invalid or synthetic');
  if(final.result.decision!=='STAGE3E_MID_FULL_PASS'||selection.phaseResultSha256!==final.sha256)
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: selection is not bound to a passing mid-full result');
  if(selection.identitySha256!==sha256(core.canonicalBytes(final.result.identity)))
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: selected identity does not match the immutable result');
  const tuple=selection.selectedResponse;
  if(!tuple||![tuple.low,tuple.mid,tuple.bassHardness].every(Number.isFinite))
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: selected tuple is invalid');
  return {roots,selection,selectionSha256:stored.sha256,tuple,final};
}
function assertPromotedValues(root,tuple){
  const presets=JSON.parse(fs.readFileSync(path.join(root,PRESETS_REL),'utf8'));
  const hammer=presets.concert_grand?.engine_config?.hammer;
  const expected={velocity_launch_scale_low:tuple.low,velocity_launch_scale_mid:tuple.mid,velocity_hardness_scale_bass:tuple.bassHardness};
  if(!hammer||Object.entries(expected).some(([name,value])=>hammer[name]!==value))
    throw new Error('BLOCKED_STAGE3_PROMOTION: concert_grand preset does not contain the selected Stage3E values');
  const profile=fs.readFileSync(path.join(root,PROFILE_REL),'utf8');
  for(const [field,value] of Object.entries({velocity_launch_scale_low:tuple.low,velocity_launch_scale_mid:tuple.mid,velocity_hardness_scale_bass:tuple.bassHardness})){
    const match=profile.match(new RegExp(`\\.${field}\\s*=\\s*([-+0-9.eE]+)f`));
    if(!match||Math.abs(Number(match[1])-value)>1e-6)throw new Error(`BLOCKED_STAGE3_PROMOTION: generated profile differs at ${field}`);
  }
  return true;
}
function readRegressions(root=ROOT,relative=REGRESSION_REL){
  const rel=String(relative).replaceAll('\\','/');
  if(!rel.startsWith('.agent-state/issues/7/current-build-v1/'))throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: results must be under the private Issue #7 current-build-v1 state');
  const file=path.resolve(root,rel);
  if(!file.startsWith(`${path.resolve(root)}${path.sep}`))throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: path escaped repository root');
  if(!fs.existsSync(file))throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: six passing regression results are required');
  const bytes=fs.readFileSync(file),document=JSON.parse(bytes.toString('utf8')),results=document.results||document;
  evaluator.validateRegressionResults(results);
  return {file,relative:rel,bytes,sha256:sha256(bytes),document,results};
}

function maybeReadDualObject(roots,relative){
  const paths=core.dualPaths(roots,relative),exists=[fs.existsSync(paths.primary),fs.existsSync(paths.secondary)];
  if(!exists[0]&&!exists[1])return null;
  if(exists[0]!==exists[1])throw new Error(`BLOCKED_STAGE3_PROMOTION: ${relative} exists in only one canonical store`);
  const stored=core.readDualBytes(roots,relative),value=JSON.parse(stored.bytes.toString('utf8'));
  if(!stored.bytes.equals(core.canonicalBytes(value)))throw new Error(`BLOCKED_STAGE3_PROMOTION: ${relative} is not canonical`);
  return value;
}
function storeDualObject(roots,relative,value){
  const existing=maybeReadDualObject(roots,relative);
  if(existing){if(!core.same(existing,value))throw new Error(`BLOCKED_STAGE3_PROMOTION: immutable ${relative} differs`);return core.readDualBytes(roots,relative);}
  return core.writeImmutableDual(roots,relative,core.canonicalBytes(value));
}
function promotionIntentNames(roots){
  const paths=core.dualPaths(roots,'promotion');
  const names=[paths.primary,paths.secondary].map(directory=>fs.existsSync(directory)
    ?fs.readdirSync(directory).filter(name=>name.startsWith('intent')).sort():[]);
  if(!core.same(names[0],names[1]))throw new Error('BLOCKED_STAGE3_PROMOTION: intent directory entries differ between canonical stores');
  if(names[0].some(name=>![path.basename(PROMOTION_INTENT_REL),path.basename(PROMOTION_INTENT_02_REL)].includes(name)))
    throw new Error('BLOCKED_STAGE3_PROMOTION: unexpected third promotion intent exists');
  if(names[0].includes(path.basename(PROMOTION_INTENT_02_REL))&&!names[0].includes(path.basename(PROMOTION_INTENT_REL)))
    throw new Error('BLOCKED_STAGE3_PROMOTION: successor intent exists without its immutable predecessor');
  return names[0];
}
function validatePromotionIntentSelection(root,record,selection,intent,{supersedesIntentSha256}={}){
  if(!intent||typeof intent.parentCommit!=='string'||typeof intent.parentTree!=='string'
    ||git(root,['rev-parse',`${intent.parentCommit}^{tree}`])!==intent.parentTree
    ||!isCommitAncestor(root,record.sourceCommit,intent.parentCommit))
    throw new Error('BLOCKED_STAGE3_PROMOTION: intent parent tree or source ancestry is invalid');
  const expected=promotionIntent(root,record,selection,intent.parentCommit,intent.parentTree,
    supersedesIntentSha256?{supersedesIntentSha256}:{});
  if(!core.same(intent,expected))throw new Error('BLOCKED_STAGE3_PROMOTION: intent differs from the immutable selection or baseline identity');
  return true;
}
function verifiedRuntimeRevision4({root,home,commonDirectory}){
  const verified=adaptiveMid.verifyParentManifest({root,home,epoch:core.EPOCH,commonDirectory});
  if(verified.runtimeRevisions?.length!==4||verified.runtimeRevision?.value?.revisionNumber!==4
    ||verified.runtimeRevision.sha256!==verified.runtimeRevisions[3].sha256)
    throw new Error('BLOCKED_STAGE3_PROMOTION: accepted runtime revision 4 is required before successor intent');
  return verified.runtimeRevision;
}
function expectedTupleValues(tuple){
  if(!tuple||![tuple.low,tuple.mid,tuple.bassHardness].every(Number.isFinite))throw new Error('BLOCKED_STAGE3_PROMOTION: selected tuple must contain three finite values');
  return {velocity_launch_scale_low:tuple.low,velocity_launch_scale_mid:tuple.mid,velocity_hardness_scale_bass:tuple.bassHardness};
}
function assertSelectedFullPass(selection){
  const tuple=selection?.tuple,summary=selection?.final?.result?.summary;
  expectedTupleValues(tuple);
  const decision=selection.extensionSelection===true?'ADAPTIVE_MID_FULL_PASS':'STAGE3E_MID_FULL_PASS';
  if(selection.final.result.decision!==decision||!core.same(summary?.selectedTuple,tuple)
      ||!summary?.candidates?.some(candidate=>candidate.pass===true&&core.same(candidate.tuple,tuple)))
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: selected tuple is not the passing full candidate for its explicit selection schema');
  return true;
}
function promotionIntent(root,record,selection,parentCommit,parentTree,{supersedesIntentSha256}={}){
  const tuple={...selection.tuple};
  return {schemaVersion:1,issue:7,epoch:core.EPOCH,type:'stage3e-promotion-intent',parentCommit,parentTree,
    sourceCommit:record.sourceCommit,tuple,selectionSha256:selection.selectionSha256,stage3eResultSha256:selection.final.sha256,
    ...(selection.extensionSelection===true?{selectionSchema:selection.selection.schema,
      extensionResultSha256:selection.extension.resultSha256,parentManifestSha256:selection.extension.parentManifestSha256,
      probeResultSha256:selection.selection.probeResultSha256,screenResultSha256:selection.extension.screenResultSha256,
      fullResultSha256:selection.extension.fullResultSha256}:{}),
    baselinePresetsSha256:record.inputs.presets.sha256,baselineProfileSha256:record.inputs.generatedProfile.sha256,
    createdAt:selection.selection.selectedAt,...(supersedesIntentSha256?{supersedesIntentSha256}:{})};
}
function promotionStatus(root){
  const status=git(root,['status','--porcelain=v2','--branch','--untracked-files=no']),lines=status.split(/\r?\n/);
  const branch=lines.find(line=>line.startsWith('# branch.head '))?.slice('# branch.head '.length);
  const changes=lines.filter(line=>line&&!line.startsWith('# ')),entries=changes.map(line=>{
    if(!line.startsWith('1 '))throw new Error('BLOCKED_STAGE3_PROMOTION: unresolved or renamed Git index state is not allowed');
    const fields=line.split(' '),xy=fields[1],file=fields.slice(8).join(' ');
    if(!xy||!file)throw new Error('BLOCKED_STAGE3_PROMOTION: Git status entry is invalid');
    return {xy,file};
  });
  if(branch!==PROMOTION_BRANCH)throw new Error(`BLOCKED_STAGE3_PROMOTION: expected branch ${PROMOTION_BRANCH}, found ${branch||'unknown'}`);
  if(entries.some(entry=>!PROMOTION_PATHS.includes(entry.file)))throw new Error('BLOCKED_STAGE3_PROMOTION: tracked changes outside the four promotion paths');
  const stagedChanges=entries.filter(entry=>entry.xy[0]!=='.').map(entry=>entry.file).sort();
  const unstagedChanges=entries.filter(entry=>entry.xy[1]!=='.').map(entry=>entry.file).sort();
  if(stagedChanges.length&&!core.same(stagedChanges,PROMOTION_PATHS))
    throw new Error('BLOCKED_STAGE3_PROMOTION: partial promotion staging is not allowed; stage all four paths atomically');
  return {branch,changes,stagedChanges,unstagedChanges};
}
function ensureSelectedFiles(root,record,tuple){
  const beforePresets=fileSha(root,PRESETS_REL),expected=expectedTupleValues(tuple);
  const presets=JSON.parse(fs.readFileSync(path.join(root,PRESETS_REL),'utf8'));
  const hammer=presets.concert_grand?.engine_config?.hammer;
  if(!hammer)throw new Error('BLOCKED_STAGE3_PROMOTION: concert_grand hammer preset is missing');
  const alreadySelected=Object.entries(expected).every(([name,value])=>hammer[name]===value);
  if(!alreadySelected&&beforePresets!==record.inputs.presets.sha256)
    throw new Error('BLOCKED_STAGE3_PROMOTION: interrupted preset does not match baseline or selected tuple');
  if(!alreadySelected){
    Object.assign(hammer,expected);
    fs.writeFileSync(path.join(root,PRESETS_REL),JSON.stringify(presets,null,2)+'\n',{mode:0o600});
  }
  execFileSync('rtk',['python3','wasm/cmake/super_synth_metadata.py'],{cwd:root,stdio:'pipe',maxBuffer:16*1024*1024});
  assertPromotedValues(root,tuple);
  const changes=[...new Set([
    ...gitRaw(root,['diff','--name-only','--no-renames']).split(/\r?\n/).filter(Boolean),
    ...gitRaw(root,['diff','--cached','--name-only','--no-renames']).split(/\r?\n/).filter(Boolean)
  ])].sort();
  if(!core.same(changes,PROMOTION_PATHS))throw new Error(`BLOCKED_STAGE3_PROMOTION: generated tracked diff must be exactly the four promotion paths; found ${changes.join(',')}`);
  return {presetsSha256:fileSha(root,PRESETS_REL),profileSha256:fileSha(root,PROFILE_REL),
    descriptorCborSha256:fileSha(root,GENERATED_DESCRIPTOR_CBO_REL),descriptorHeaderSha256:fileSha(root,GENERATED_DESCRIPTOR_HEADER_REL)};
}
function readPromotionCommit(root,intent,record){
  const details=promotionDetails(root),subject=git(root,['show','-s','--format=%s',details.commit]);
  if(details.parent!==intent.parentCommit||details.parentTree!==intent.parentTree
      ||(intent.supersedesIntentSha256&&details.commit!==git(root,['rev-parse','HEAD']))
      ||subject!==PROMOTION_SUBJECT||!core.same(details.changedPaths,PROMOTION_PATHS)
      ||details.sourceCommitIsAncestor!==true||details.currentHeadDescendsFromPromotion!==true)
    throw new Error('BLOCKED_STAGE3_PROMOTION: current commit does not match the pending dedicated promotion intent');
  for(const [relative,expected] of [[PRESETS_REL,intent.baselinePresetsSha256],[PROFILE_REL,intent.baselineProfileSha256]])
    if(hashCommitBlob(details,relative,'parent')!==expected)throw new Error(`BLOCKED_STAGE3_PROMOTION: parent does not preserve ${relative}`);
  const committedPresets=JSON.parse(details.readCommitFile(PRESETS_REL).toString('utf8'));
  const expected=expectedTupleValues(intent.tuple),hammer=committedPresets.concert_grand?.engine_config?.hammer;
  if(!hammer||Object.entries(expected).some(([name,value])=>hammer[name]!==value))throw new Error('BLOCKED_STAGE3_PROMOTION: committed preset does not match selected tuple');
  const profile=details.readCommitFile(PROFILE_REL).toString('utf8');
  for(const [field,value] of Object.entries({velocity_launch_scale_low:intent.tuple.low,velocity_launch_scale_mid:intent.tuple.mid,
      velocity_hardness_scale_bass:intent.tuple.bassHardness})){
    const match=profile.match(new RegExp(`\\.${field}\\s*=\\s*([-+0-9.eE]+)f`));
    if(!match||Math.abs(Number(match[1])-value)>1e-6)throw new Error(`BLOCKED_STAGE3_PROMOTION: committed generated profile differs at ${field}`);
  }
  return details;
}
function ensurePromotionCommit({root,record,selection,roots,now,prepareSelectedFiles=ensureSelectedFiles,
  verifyRevision4=verifiedRuntimeRevision4}={}){
  const current=git(root,['rev-parse','HEAD']),parentTree=git(root,['rev-parse',`${current}^{tree}`]);
  const intentNames=promotionIntentNames(roots);
  let originalIntent=maybeReadDualObject(roots,PROMOTION_INTENT_REL),successorIntent=maybeReadDualObject(roots,PROMOTION_INTENT_02_REL);
  const state=promotionStatus(root),existingReceipt=maybeReadDualObject(roots,PROMOTION_RECEIPT_REL);
  if(existingReceipt&&!originalIntent)throw new Error('BLOCKED_STAGE3_PROMOTION: receipt exists without its immutable intent');
  if(!originalIntent&&state.changes.length)throw new Error('BLOCKED_STAGE3_PROMOTION: tracked worktree must be clean before creating the promotion intent');
  let intent=null,proposed=null;
  if(originalIntent){
    validatePromotionIntentSelection(root,record,selection,originalIntent);
    const originalBytes=core.readDualBytes(roots,PROMOTION_INTENT_REL),originalSha256=originalBytes.sha256;
    if(successorIntent){
      if(existingReceipt&&core.same(existingReceipt.intent,originalIntent))
        throw new Error('BLOCKED_STAGE3_PROMOTION: old promotion receipt exists; successor intent cannot supersede it');
      validatePromotionIntentSelection(root,record,selection,successorIntent,{supersedesIntentSha256:originalSha256});
      const revision4=verifyRevision4({root,home:roots.home,commonDirectory:roots.commonDirectory});
      if(revision4?.value?.revisionNumber!==4||successorIntent.parentCommit!==revision4.value.codeRevision
        ||successorIntent.parentTree!==git(root,['rev-parse',`${revision4.value.codeRevision}^{tree}`]))
        throw new Error('BLOCKED_STAGE3_PROMOTION: successor intent does not use the accepted revision-4 recovery commit R');
      intent=successorIntent;
      proposed=promotionIntent(root,record,selection,intent.parentCommit,intent.parentTree,{supersedesIntentSha256:originalSha256});
    }else if(existingReceipt&&core.same(existingReceipt.intent,originalIntent)){
      if(current!==existingReceipt.promotionCommit||existingReceipt.promotionParentCommit!==originalIntent.parentCommit)
        throw new Error('BLOCKED_STAGE3_PROMOTION: old receipt prevents successor intent');
      intent=originalIntent;
      proposed=promotionIntent(root,record,selection,intent.parentCommit,intent.parentTree);
    }else if(current===originalIntent.parentCommit){
      intent=originalIntent;
      proposed=promotionIntent(root,record,selection,intent.parentCommit,intent.parentTree);
    }else{
      if(existingReceipt)throw new Error('BLOCKED_STAGE3_PROMOTION: old receipt prevents successor intent recovery');
      if(state.changes.length)throw new Error('BLOCKED_STAGE3_PROMOTION: recovery parent must be clean before successor intent');
      const revision4=verifyRevision4({root,home:roots.home,commonDirectory:roots.commonDirectory});
      if(revision4?.value?.revisionNumber!==4||revision4.value.codeRevision!==current
        ||!isCommitAncestor(root,originalIntent.parentCommit,current))
        throw new Error('BLOCKED_STAGE3_PROMOTION: no exact accepted revision-4 recovery commit is active at HEAD');
      proposed=promotionIntent(root,record,selection,current,parentTree,{supersedesIntentSha256:originalSha256});
      const saved=storeDualObject(roots,PROMOTION_INTENT_02_REL,proposed);
      if(saved.sha256!==core.sha256(core.canonicalBytes(proposed)))
        throw new Error('BLOCKED_STAGE3_PROMOTION: successor intent immutable dual-store readback differs');
      successorIntent=maybeReadDualObject(roots,PROMOTION_INTENT_02_REL);
      if(!successorIntent||!core.same(successorIntent,proposed)||!core.readDualBytes(roots,PROMOTION_INTENT_02_REL).bytes.equals(core.canonicalBytes(proposed)))
        throw new Error('BLOCKED_STAGE3_PROMOTION: successor intent failed canonical dual-store readback');
      intent=successorIntent;
    }
  }else if(!successorIntent){
    const currentSubject=git(root,['show','-s','--format=%s',current]);
    if(currentSubject===PROMOTION_SUBJECT){
      const candidate=promotionDetails(root),candidateIntent=promotionIntent(root,record,selection,candidate.parent,candidate.parentTree);
      readPromotionCommit(root,candidateIntent,record);
      intent=candidateIntent;storeDualObject(roots,PROMOTION_INTENT_REL,intent);
    }else{
      proposed=promotionIntent(root,record,selection,current,parentTree);
      intent=proposed;storeDualObject(roots,PROMOTION_INTENT_REL,intent);
    }
  }
  if(!intent||!intentNames.includes(path.basename(PROMOTION_INTENT_REL)))
    throw new Error('BLOCKED_STAGE3_PROMOTION: active promotion intent is missing');
  if(intent.supersedesIntentSha256){
    const oldSha256=core.readDualBytes(roots,PROMOTION_INTENT_REL).sha256;
    if(intent.supersedesIntentSha256!==oldSha256||!successorIntent||!core.same(intent,successorIntent))
      throw new Error('BLOCKED_STAGE3_PROMOTION: successor intent chain or immutable predecessor SHA differs');
    const revision4=verifyRevision4({root,home:roots.home,commonDirectory:roots.commonDirectory});
    if(revision4?.value?.revisionNumber!==4||intent.parentCommit!==revision4.value.codeRevision)
      throw new Error('BLOCKED_STAGE3_PROMOTION: successor intent is not authorized by runtime revision 4');
  }
  proposed=proposed||promotionIntent(root,record,selection,intent.parentCommit,intent.parentTree,
    intent.supersedesIntentSha256?{supersedesIntentSha256:intent.supersedesIntentSha256}:{});
  if(!core.same(intent,proposed))throw new Error('BLOCKED_STAGE3_PROMOTION: pending intent differs from the immutable selection');
  let receipt=existingReceipt;
  if(receipt){
    if(!core.same(receipt.intent,intent))throw new Error('BLOCKED_STAGE3_PROMOTION: receipt belongs to a different intent');
    const details=promotionDetails(root,{promotionCommit:receipt.promotionCommit,promotionParentCommit:receipt.promotionParentCommit,
      promotionParentTree:receipt.promotionParentTree,promotionCommitTree:receipt.promotionCommitTree});
    validatePromotionDetails(details,record.sourceCommit);
    if(intent.supersedesIntentSha256)readPromotionCommit(root,intent,record);
    return {intent,receipt,details,reused:true};
  }
  const head=git(root,['rev-parse','HEAD']);
  let details;
  if(head===intent.parentCommit){
    promotionStatus(root);
    prepareSelectedFiles(root,record,selection.tuple);
    execFileSync('rtk',['git','add','--',...PROMOTION_PATHS],{cwd:root,stdio:'pipe'});
    const staged=gitRaw(root,['diff','--cached','--name-only','--no-renames']).split(/\r?\n/).filter(Boolean).sort();
    if(!core.same(staged,PROMOTION_PATHS))throw new Error(`BLOCKED_STAGE3_PROMOTION: staged paths do not match the exact four-file set; found ${staged.join(',')}`);
    execFileSync('rtk',['git','commit','-m',PROMOTION_SUBJECT],{cwd:root,stdio:'pipe',maxBuffer:16*1024*1024});
    promotionStatus(root);
    details=readPromotionCommit(root,intent,record);
  }else{
    details=readPromotionCommit(root,intent,record);
  }
  receipt={schemaVersion:1,issue:7,epoch:core.EPOCH,type:'stage3e-promotion-receipt',intent,
    promotionCommit:details.commit,promotionParentCommit:details.parent,promotionParentTree:details.parentTree,
    promotionCommitTree:details.commitTree,selectedTuple:selection.tuple,createdAt:now()};
  storeDualObject(roots,PROMOTION_RECEIPT_REL,receipt);
  return {intent,receipt,details,reused:false};
}
function runRequiredRegressions({root=ROOT,productionRecord,production,selection,receipt,runner=spawnSync}={}){
  const buildDir=buildDirectory(root,productionRecord),wasmSha256=production.derived.builds.production.wasm.sha256;
  const testInputs=Object.fromEntries(Object.entries(REGRESSION_TESTS).map(([name,relative])=>[name,fileSha(root,relative)]));
  const input={issue:7,epoch:core.EPOCH,promotionCommit:receipt.promotionCommit,selectedTuple:selection.tuple,
    productionBuildIdentitySha256:production.productionBuildIdentitySha256,productionWasmSha256:wasmSha256,testInputs};
  const inputDigest=sha256(core.canonicalBytes(input)),file=path.resolve(root,REGRESSION_REL);
  if(!file.startsWith(`${path.resolve(root)}${path.sep}`))throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: path escaped repository root');
  if(fs.existsSync(file)){
    const bytes=fs.readFileSync(file),document=JSON.parse(bytes.toString('utf8'));
    if(document.inputDigest!==inputDigest||!core.same(document.input,input))throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: existing results do not match the promoted production input digest');
    const results=document.results||{};evaluator.validateRegressionResults(results);
    return {file,bytes,sha256:sha256(bytes),inputDigest,results,reused:true};
  }
  const results={};
  for(const [name,relative] of Object.entries(REGRESSION_TESTS)){
    const command=`rtk node --test ${relative}`;
    const child=runner('rtk',['node','--test',relative],{cwd:root,encoding:'buffer',maxBuffer:32*1024*1024,
      env:{...process.env,SORAOTO_WASM_BUILD_DIR:buildDir}});
    const stdout=child.stdout||Buffer.alloc(0),stderr=child.stderr||Buffer.alloc(0),exitCode=Number.isInteger(child.status)?child.status:1;
    results[name]={result:exitCode===0?'PASS':'FAIL',command,exitCode,signal:child.signal||null,inputDigest,
      outputSha256:sha256(Buffer.concat([stdout,Buffer.from('\n--stderr--\n'),stderr]))};
  }
  const document={schemaVersion:1,input,inputDigest,productionWasmSha256:wasmSha256,promotionCommit:receipt.promotionCommit,
    selectedResponse:selection.tuple,results};
  const bytes=core.canonicalBytes(document);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  try{fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: result file appeared concurrently; refusing overwrite');}
  const failed=Object.entries(results).filter(([,result])=>result.result!=='PASS').map(([name])=>name);
  if(failed.length)return {decision:'BLOCKED_STAGE3_REGRESSION_RESULTS',failed,file,bytes,sha256:sha256(bytes),inputDigest,results,reused:false};
  evaluator.validateRegressionResults(results);
  return {decision:'STAGE3_REGRESSIONS_PASS',file,bytes,sha256:sha256(bytes),inputDigest,results,reused:false};
}
function promoteSelection({root=ROOT,home=os.homedir(),epoch=core.EPOCH,runAllOwner,now=()=>new Date().toISOString(),
  buildProduction,regressionRunner}={}){
  const roots=core.resolveRoots(root,STAGE,epoch,{home});
  core.assertRunAllLockAccess(roots.commonDirectory,runAllOwner);
  try{
    const record=identityRecord(root),selection=readSelection(root,home,epoch);
    assertSelectedFullPass(selection);
    const receiptState=ensurePromotionCommit({root,record,selection,roots,now});
    const buildDir=buildDirectory(root,record);
    if(buildProduction)buildProduction({root,record,buildDir});
    else execFileSync('rtk',['cmake','--build',buildDir],{cwd:root,stdio:'pipe',maxBuffer:32*1024*1024});
    const production=deriveProductionBuildIdentity({root,record,selection,promotion:receiptState.details});
    const derivedStored=storeDualObject(roots,DERIVED_IDENTITY_REL,production.derived);
    const regression=runRequiredRegressions({root,productionRecord:production.productionRecord,production,selection,
      receipt:receiptState.receipt,runner:regressionRunner||spawnSync});
    if(regression.decision&&regression.decision!=='STAGE3_REGRESSIONS_PASS')
      return {decision:regression.decision,reason:`required regressions failed: ${regression.failed?.join(',')||'unknown'}`,
        promotionCommit:receiptState.details.commit,productionWasmSha256:production.derived.builds.production.wasm.sha256,
        regressionResultsSha256:regression.sha256};
    if(regression.results&&Object.values(regression.results).some(result=>result.result!=='PASS'))
      return {decision:'BLOCKED_STAGE3_REGRESSION_RESULTS',reason:'reused regression evidence is not all PASS',
        promotionCommit:receiptState.details.commit,productionWasmSha256:production.derived.builds.production.wasm.sha256,
        regressionResultsSha256:regression.sha256};
    return {decision:'STAGE3_PROMOTION_READY',promotionCommit:receiptState.details.commit,
      promotionParent:receiptState.details.parent,promotionParentTree:receiptState.details.parentTree,
      promotionCommitTree:receiptState.details.commitTree,selectedTuple:selection.tuple,
      originalProductionWasmSha256:record.builds.production.wasm.sha256,
      productionWasmSha256:production.derived.builds.production.wasm.sha256,
      productionBuildIdentitySha256:production.productionBuildIdentitySha256,derivedIdentitySha256:derivedStored.sha256,
      regressionResultsSha256:regression.sha256,regressions:REQUIRED_REGRESSIONS.map(name=>({name,...regression.results[name]})),
      reusedPromotion:receiptState.reused,reusedRegressions:regression.reused===true};
  }catch(error){return {decision:error.message.split(':')[0].startsWith('BLOCKED_')?error.message.split(':')[0]:'BLOCKED_STAGE3_PROMOTION',reason:error.message};}
}
function currentIdentity({root=ROOT,home=os.homedir(),epoch=core.EPOCH,record=identityRecord(root),selection,regressions,regressionPath=REGRESSION_REL,production:providedProduction,allowSyntheticTest=false}={}){
  const selected=selection||readSelection(root,home,epoch,{allowSyntheticTest}),regression=regressions||readRegressions(root,regressionPath);
  const production=providedProduction||deriveProductionBuildIdentity({root,record,selection:selected});
  const builds=Object.fromEntries(Object.entries(production.derived.builds).map(([role,build])=>[role,
    {cmakeCacheSha256:build.cmakeCacheSha256,wasmSha256:build.wasm.sha256,flags:build.flags}]));
  return {issue:7,epoch,stage:STAGE,sourceCommit:record.sourceCommit,buildIdentitySha256:production.derived.parentBuildIdentitySha256,
    toolchain:record.toolchain,inputs:production.derived.inputs,builds,
    productionBuildIdentitySha256:production.productionBuildIdentitySha256,
    stage3eSelectionSchema:selected.selection?.schema||'legacy-mid-full-selection/v1',
    selectionSha256:selected.selectionSha256,
    selectedResponse:selected.tuple,stage3eResultSha256:selected.final.sha256,
    ...(selected.extensionSelection?{stage3eExtensionParentManifestSha256:selected.extension.parentManifestSha256,
      stage3eExtensionResultSha256:selected.extension.resultSha256,stage3eProbeResultSha256:selected.selection.probeResultSha256,
      stage3eScreenResultSha256:selected.extension.screenResultSha256,stage3eFullResultSha256:selected.extension.fullResultSha256}:{}),
    regressionResultsSha256:regression.sha256,regressions:evaluator.validateRegressionResults(regression.results),
    captureHelperSha256:fileSha(root,CAPTURE_REL),evaluatorSha256:fileSha(root,EVALUATOR_REL),runnerSha256:fileSha(root,RUNNER_REL)};
}
function cells(){
  if(CELL_SPECS.length!==486||CELL_SPECS.filter(cell=>cell.kind==='direct').length!==480||CELL_SPECS.filter(cell=>cell.kind==='sentinel').length!==6)
    throw new Error('BLOCKED_STAGE3_CELL_SET: canonical 486-cell set changed');
  if(new Set(CELL_SPECS.map(cell=>cell.key)).size!==486)throw new Error('BLOCKED_STAGE3_CELL_SET: duplicate cell key');
  return CELL_SPECS.map(cell=>({...cell,phase:PHASE,buildRole:'production'}));
}
function verifyStage3ePrerequisite(root,selected,{allowSyntheticTest=false}={}){
  const final=selected?.final,creator=final?.manifest?.creatorRevision||final?.manifest?.creatorCommit||final?.executionPlan?.creatorRevision;
  const synthetic=final?.result?.summary?.syntheticTest===true;
  if(selected?.extensionSelection===true){
    if(selected.selection?.schema!=='issue7-stage3e-extension-selection/v1'||selected.selection?.decision!=='ADAPTIVE_MID_FULL_PASS'
        ||selected.extension?.parentManifestSha256!==selected.selection.parent?.manifestSha256
        ||selected.extension?.fullResultSha256!==selected.selection.fullResultSha256
        ||selected.extension?.screenResultSha256!==selected.selection.screenResultSha256)
      throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: adaptive extension result binding differs');
  }
  if(!(synthetic&&allowSyntheticTest)&&!core.commitIsAncestor(root,creator))
    throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: Stage3E creator revision is not an ancestor of current HEAD');
  const frozen=final.executionPlan?.identity;
  if(frozen){
    for(const [relative,expected] of Object.entries(frozen.helperInputs||{}))
      if(fileSha(root,relative)!==expected)throw new Error(`BLOCKED_STAGE3E_SELECTION_REQUIRED: Stage3E helper changed: ${relative}`);
    const runnerSha=fileSha(root,'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.cjs');
    if(runnerSha!==frozen.runnerSha256)throw new Error('BLOCKED_STAGE3E_SELECTION_REQUIRED: Stage3E runner changed after the frozen phase plan');
  }
  return true;
}
function phaseManifest({root,record,identity,executionPlan,now,cells:phaseCells}){
  return {schemaVersion:1,issue:7,epoch:core.EPOCH,stage:STAGE,phase:PHASE,
    creatorCommit:executionPlan.creatorRevision,candidateId:`issue7-${core.EPOCH}-stage3`,
    referenceFixtureSha256:record.inputs.referenceMetrics.sha256,sourcePluginSha256:record.inputs.pluginC.sha256,
    presetsSha256:record.inputs.presets.sha256,profileSha256:record.inputs.generatedProfile.sha256,
    captureHelperSha256:identity.captureHelperSha256,evaluatorSha256:identity.evaluatorSha256,runnerSha256:identity.runnerSha256,
    builds:identity.builds,identity,selectionSha256:identity.selectionSha256,stage3eResultSha256:identity.stage3eResultSha256,
    regressionResultsSha256:identity.regressionResultsSha256,productionBuildIdentitySha256:identity.productionBuildIdentitySha256,
    primaryWasmSha256:identity.builds.production.wasmSha256,
    executionPlanSha256:sha256(core.canonicalBytes(executionPlan)),authorizedCellKeys:phaseCells.map(cell=>cell.key),renderBudget:phaseCells.length,createdAt:now()};
}
function withProductionBuild(root,record,action){
  const key='SORAOTO_WASM_BUILD_DIR',prior=process.env[key];process.env[key]=buildDirectory(root,record);
  try{return action();}finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
}
function renderDefault({root=ROOT,record,cell}={}){
  const velocityNormalized=cell.velocity/127;
  const options=cell.pitch===41?{includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180}:{};
  const output=withProductionBuild(root,record,()=>capture.renderNormalized(cell.pitch,velocityNormalized,{},options));
  return {pitch:cell.pitch,velocity:cell.velocity,kind:cell.kind,metrics:output.metrics||output};
}
function readRows(roots,phaseCells){
  return phaseCells.map(cell=>{
    const stored=core.readCell(roots,PHASE,cell.key);
    if(stored.cell.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3_PHASE_INCOMPLETE: ${cell.key}`);
    const row=stored.observation.observation;
    if(row.pitch!==cell.pitch||row.velocity!==cell.velocity||row.kind!==cell.kind)throw new Error(`BLOCKED_STAGE3_CELL_IDENTITY: ${cell.key}`);
    return {cell,pitch:row.pitch,velocity:row.velocity,metrics:row.metrics};
  });
}
function evaluate(rows,fixture,regressions){
  if(rows.length!==486)throw new Error('BLOCKED_STAGE3_COVERAGE: exactly 486 cells are required');
  return evaluator.buildEvaluation(fixture,rows,regressions);
}
function finalize({roots,identity,regressions,now=()=>new Date().toISOString()}={}){
  const state=core.readPhaseLedger(roots,PHASE);
  if(!state)throw new Error('BLOCKED_STAGE3_PHASE_NOT_STARTED');
  const phaseCells=cells(),ledger=state.ledger;
  if(Object.keys(ledger.cells).length!==486||Object.values(ledger.cells).filter(cell=>cell.state==='COMPLETE').length!==486)
    throw new Error('BLOCKED_STAGE3_PHASE_INCOMPLETE: finalization requires all 486 cells');
  const rows=readRows(roots,phaseCells),fixture=JSON.parse(fs.readFileSync(path.join(ROOT,FIXTURE_REL),'utf8'));
  evaluator.validateRegressionResults(regressions);
  const evaluation=evaluate(rows,fixture,regressions.results),result=core.finalizePhase({roots,phase:PHASE,decision:evaluation.decision,summary:evaluation,now});
  return {decision:result.result.decision,phase:PHASE,renderCount:result.result.renderCount,coverage:evaluation.coverage,
    resultSha256:result.sha256,archiveSha256:result.archiveSha256,summary:evaluation,identitySha256:sha256(core.canonicalBytes(identity)),acousticRenders:0};
}
function prepare({root=ROOT,home=os.homedir(),epoch=core.EPOCH,regressionResultsPath=REGRESSION_REL,allowSyntheticTest=false}={}){
  const record=identityRecord(root),selected=readSelection(root,home,epoch,{allowSyntheticTest}),regressions=readRegressions(root,regressionResultsPath);
  verifyStage3ePrerequisite(root,selected,{allowSyntheticTest});
  assertPromotedValues(root,selected.tuple);
  const production=deriveProductionBuildIdentity({root,record,selection:selected});
  const identity=currentIdentity({root,home,epoch,record,selection:selected,regressions,regressionPath:regressionResultsPath,production});
  const stageRoots=core.resolveRoots(root,STAGE,epoch,{home,commonDirectory:selected.roots.commonDirectory});
  const paths=core.dualPaths(stageRoots,DERIVED_IDENTITY_REL);
  if([paths.primary,paths.secondary].some(fs.existsSync)){
    const stored=core.readDualBytes(stageRoots,DERIVED_IDENTITY_REL);
    if(!stored.bytes.equals(core.canonicalBytes(production.derived)))throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: immutable derived production identity differs');
  }
  return {record,productionRecord:production.productionRecord,derivedBuildIdentity:production.derived,
    productionBuildIdentitySha256:production.productionBuildIdentitySha256,selected,regressions,identity,exports:production.derived.productionExports};
}
function execute({root=ROOT,home=os.homedir(),epoch=core.EPOCH,regressionResultsPath=REGRESSION_REL,render=renderDefault,
  now=()=>new Date().toISOString(),allowSyntheticTest=false,runAllOwner}={}){
  const phaseCells=cells();
  const roots=core.resolveRoots(root,STAGE,epoch,{home});
  core.assertRunAllLockAccess(roots.commonDirectory,runAllOwner);
  if(!runAllOwner)readSelection(root,home,epoch,{allowSyntheticTest});
  return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>executeAuthorized({root,home,epoch,phaseCells,regressionResultsPath,render,now,roots,allowSyntheticTest}));
}
function executeAuthorized({root,home,epoch,phaseCells,regressionResultsPath,render,now,roots,allowSyntheticTest=false}){
  const syntheticTest=allowSyntheticTest===true;
  if(syntheticTest&&render===renderDefault)throw new Error('BLOCKED_SYNTHETIC_RENDER: synthetic mode cannot invoke the production WASM renderer');
  if(!syntheticTest&&render!==renderDefault)throw new Error('BLOCKED_SYNTHETIC_RENDER: injected renderers require explicit synthetic-test mode');
  const prepared=prepare({root,home,epoch,regressionResultsPath,allowSyntheticTest});
  if(prepared.record.sourceCommit&&!isAncestor(root,prepared.record.sourceCommit))
    throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: build source commit is not an ancestor of current HEAD');
  const prerequisite=prepared.selected.final;
  const frozen=core.verifyAndPersistExecutionPlan({roots,root,stage:STAGE,phase:PHASE,cells:phaseCells,renderBudget:486,identity:prepared.identity,
    prerequisites:[{stage:'stage3e',phase:prepared.selected.extensionSelection?'adaptive-mid-01':'mid-full',decision:prerequisite.result.decision,resultSha256:prerequisite.sha256,
      archiveSha256:prerequisite.archiveSha256,creatorRevision:prerequisite.manifest?.creatorRevision||prerequisite.manifest?.creatorCommit||
        (syntheticTest?core.gitHead(root):undefined),
      ...(prepared.selected.extensionSelection?{selectionSchema:prepared.selected.selection.schema,
        selectionSha256:prepared.selected.selectionSha256,parentManifestSha256:prepared.selected.extension.parentManifestSha256,
        extensionResultSha256:prepared.selected.extension.resultSha256,screenResultSha256:prepared.selected.extension.screenResultSha256,
        fullResultSha256:prepared.selected.extension.fullResultSha256}:{}),
      ...(prerequisite.result.executionPlanSha256?{executionPlanSha256:prerequisite.result.executionPlanSha256}:{})}]});
  const previous=core.readPhaseLedger(roots,PHASE);
  const manifest=phaseManifest({root,record:prepared.productionRecord,identity:prepared.identity,executionPlan:frozen.plan,
    now:previous?.manifest.createdAt?()=>previous.manifest.createdAt:now,cells:phaseCells});
  core.writeImmutableDual(roots,DERIVED_IDENTITY_REL,core.canonicalBytes(prepared.derivedBuildIdentity));
  core.initializePhase({roots,phase:PHASE,manifest,cells:phaseCells,renderBudget:486,now});
  core.writeImmutableDual(roots,'execution-identity.json',core.canonicalBytes(prepared.identity));
  core.writeImmutableDual(roots,'regression-results.json',prepared.regressions.bytes);
  core.writeImmutableDual(roots,'artifacts/production-plugin.wasm',fs.readFileSync(productionWasm(root,prepared.productionRecord)));
  let calls=0,unsafe=false;
  for(const cell of phaseCells){
    const existing=core.readCell(roots,PHASE,cell.key);
    if(existing.cell.state==='COMPLETE')continue;
    const started=core.startCell({roots,phase:PHASE,cellKey:cell.key,cell,identity:prepared.identity,
      identityNow:()=>currentIdentity({root,home,epoch,record:identityRecord(root),regressionPath:regressionResultsPath,allowSyntheticTest}),now});
    if(started.skipped)continue;
    calls+=1;
    let observed;
    try{observed=render({root,record:prepared.productionRecord,identity:prepared.identity,cell,syntheticTest});}
    catch(error){
      try{core.markAmbiguous({roots,phase:PHASE,cellKey:cell.key,reason:error.message,now});}catch{}
      throw new Error(`BLOCKED_STAGE3_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}; started=${calls}; ${error.message}`);
    }
    if(!observed||typeof observed!=='object'){
      try{core.markAmbiguous({roots,phase:PHASE,cellKey:cell.key,reason:'render returned no observation',now});}catch{}
      throw new Error(`BLOCKED_STAGE3_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}; started=${calls}; no observation returned`);
    }
    const row={...observed,pitch:cell.pitch,velocity:cell.velocity,kind:cell.kind,
      ...(syntheticTest?{syntheticTest:true,label:'SYNTHETIC TEST'}:{})};
    const completed=core.completeCell({roots,phase:PHASE,cellKey:cell.key,observation:row,now});
    if(completed.decision==='FAIL'){unsafe=true;break;}
  }
  const state=core.readPhaseLedger(roots,PHASE),counts={complete:Object.values(state.ledger.cells).filter(cell=>cell.state==='COMPLETE').length,
    pending:Object.values(state.ledger.cells).filter(cell=>cell.state==='PENDING').length,
    inProgress:Object.values(state.ledger.cells).filter(cell=>cell.state==='IN_PROGRESS').length,
    ambiguous:Object.values(state.ledger.cells).filter(cell=>cell.state==='AMBIGUOUS').length};
  if(unsafe||counts.complete!==486)return {decision:unsafe?'BLOCKED_STAGE3_UNSAFE_OBSERVATION':'BLOCKED_STAGE3_PHASE_INCOMPLETE',phase:PHASE,calls,renderCount:state.ledger.renderCount,counts,acousticRenders:calls};
  const fixture=JSON.parse(fs.readFileSync(path.join(root,FIXTURE_REL),'utf8'));
  const evaluation=evaluate(readRows(roots,phaseCells),fixture,prepared.regressions.results);
  if(syntheticTest)evaluation.syntheticTest=true;
  const finalized=core.finalizePhase({roots,phase:PHASE,decision:evaluation.decision,summary:evaluation,now});
  return {decision:finalized.result.decision,phase:PHASE,calls,renderCount:finalized.result.renderCount,counts,
    summary:evaluation,resultSha256:finalized.sha256,archiveSha256:finalized.archiveSha256,syntheticTest,acousticRenders:calls};
}
function run({mode,root=ROOT,home=os.homedir(),epoch=core.EPOCH,regressionResultsPath=REGRESSION_REL,render=renderDefault,
  now=()=>new Date().toISOString(),allowSyntheticTest=false,runAllOwner}={}){
  if(!['dry-run','execute','finalize','verify'].includes(mode))throw new Error('explicit mode required: dry-run, execute, finalize, or verify');
  const roots=core.resolveRoots(root,STAGE,epoch,{home});
  if(!['dry-run','verify'].includes(mode))core.assertRunAllLockAccess(roots.commonDirectory,runAllOwner);
  if(mode==='execute')return execute({root,home,epoch,regressionResultsPath,render,now,allowSyntheticTest,runAllOwner});
  if(mode==='verify'){
    const final=core.readFinal(roots,PHASE);
    const prepared=prepare({root,home,epoch,regressionResultsPath,allowSyntheticTest});
    core.verifyFinalizedIdentity({root,final,identity:prepared.identity,allowSyntheticTest});
    return {decision:final.result.decision,phase:PHASE,resultSha256:final.sha256,archiveSha256:final.archiveSha256,
      renderCount:final.result.renderCount,builds:0,renders:0,writes:0,acousticRenders:0};
  }
  if(mode==='finalize'){
    return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>{
      const identity=core.readDualJson(roots,'execution-identity.json');
      const prepared=prepare({root,home,epoch,regressionResultsPath,allowSyntheticTest});
      core.verifyFinalizedIdentity({root,final:core.readFinal(roots,PHASE),identity:prepared.identity,allowSyntheticTest});
      const regressionBytes=core.readDualBytes(roots,'regression-results.json'),regressionDocument=JSON.parse(regressionBytes.bytes.toString('utf8')),
        regressions=regressionDocument.results||regressionDocument;
      if(core.sha256(regressionBytes.bytes)!==prepared.regressions.sha256)throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: stored regression evidence changed');
      const artifact=core.readDualBytes(roots,'artifacts/production-plugin.wasm');
      if(artifact.sha256!==prepared.identity.builds.production.wasmSha256)throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: preserved production WASM changed');
      const result=finalize({roots,identity,regressions,now});
      return {...result,builds:0,renders:0,writes:0};
    });
  }
  try{
    const prepared=prepare({root,home,epoch,regressionResultsPath});
    return {decision:'STAGE3_DRY_RUN_READY',phase:PHASE,identitySha256:sha256(core.canonicalBytes(prepared.identity)),
      cellCount:CELL_SPECS.length,directCells:480,sentinelCells:6,builds:0,renders:0,writes:0,acousticRenders:0,exports:prepared.exports};
  }catch(error){
    return {decision:error.message.split(':')[0],reason:error.message,phase:PHASE,cellCount:486,builds:0,renders:0,writes:0,acousticRenders:0};
  }
}
function parseMode(argv){
  if(argv.length!==1)throw new Error('select exactly one mode: --dry-run, --execute, --finalize, or --verify');
  const values={'--dry-run':'dry-run','--execute':'execute','--finalize':'finalize','--verify':'verify'};
  if(!values[argv[0]])throw new Error(`unsupported mode: ${argv[0]}`);
  return values[argv[0]];
}
function main(argv=process.argv.slice(2)){
  const result=run({mode:parseMode(argv)});process.stdout.write(JSON.stringify(result)+'\n');
  if(/^BLOCKED_/.test(result.decision||''))process.exitCode=2;
  return result;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=/^BLOCKED_/.test(error.message)?2:1;}}

module.exports={ROOT,STAGE,PHASE,REGRESSION_REL,REQUIRED_REGRESSIONS,REGRESSION_TESTS,CELL_SPECS,
  sha256,fileSha,identityRecord,buildDirectory,productionWasm,assertProductionExports,readSelection,assertPromotedValues,
  isCommitAncestor,promotionDetails,validatePromotionDetails,derivedBuildSnapshot,deriveProductionBuildIdentity,DERIVED_IDENTITY_REL,PROMOTION_PATHS,
  PROMOTION_INTENT_REL,PROMOTION_INTENT_02_REL,PROMOTION_RECEIPT_REL,PROMOTION_BRANCH,PROMOTION_SUBJECT,
  readRegressions,maybeReadDualObject,storeDualObject,promotionIntentNames,validatePromotionIntentSelection,verifiedRuntimeRevision4,
  expectedTupleValues,assertSelectedFullPass,promotionIntent,promotionStatus,ensureSelectedFiles,readPromotionCommit,ensurePromotionCommit,
  runRequiredRegressions,promoteSelection,currentIdentity,cells,verifyStage3ePrerequisite,phaseManifest,renderDefault,readRows,
  evaluate,finalize,prepare,execute,executeAuthorized,run,parseMode,main};
