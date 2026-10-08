#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

const STAGE3D_WASM_SHA256='9883b54eaa888b5a8d2e4d9da0490de92dd4c31915fb0d97d47cc03ce123a63a';
const STAGE3D_SOURCE_SHA256='968488b7d325c42e41570c1d7add10003050ab4c87779774a6e5337244c64886';
const HISTORICAL_PLUGIN_SHA256='8368f8af3deb17fb24dc6611ec7ec5e01f23df569240086e4d3fa8c91a0e1ae4';
const HISTORICAL_CMAKE_MACRO_SHA256='32ccc9905d2fa5dbe76dbf3838d5d04907a36c5fac7ec5ef26cdc6d7766ee797';
const PRODUCTION_WASM_SHA256='9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2';
const CONFIG_SHA256='792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d';
const PROFILE_SHA256='cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66';
const PRESETS_SHA256='cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431';
const FIXTURE_SHA256='5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7';
const WASM_REL='plugins/dsp/super-synth/plugin.wasm';
const BASE='wasm/plugins/dsp/super-synth';
const EXPECTED_FLAGS={
  BUILD_TESTING:'OFF',
  SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'ON',
  SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'ON',
  SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',
  SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',
  SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'ON',
  SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'OFF',
};

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fileSha(file){return sha256(fs.readFileSync(file));}
function mainCheckoutRoot(root){
  const common=execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();
  return path.dirname(path.resolve(root,common));
}
function provenancePath(root){return path.join(mainCheckoutRoot(root),'.agent-state/issues/7/stage3b/preflight-provenance.json');}
function assertHash(label,actual,expected){if(actual!==expected)throw new Error(`BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: ${label} expected ${expected}, got ${actual}`);}
function validateProductionLineage({root,provenanceFile=provenancePath(root)}={}){
  let bytes,document;
  try{bytes=fs.readFileSync(provenanceFile);document=JSON.parse(bytes.toString('utf8'));}
  catch(error){throw new Error(`BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: accepted provenance evidence missing or invalid: ${error.message}`);}
  const classification=document.classification;
  if(document.schemaVersion!==1||document.preflightReady!==true||document.provenanceError!==null
      ||!['EXACT_REBUILD_PROVENANCE','SUFFICIENT_METADATA_PROVENANCE'].includes(classification)
      ||document.classificationEvidence?.classification!==classification
      ||document.preflightResult?.decision!=='STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE')
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: existing accepted Stage3B provenance is not ready');
  if(document.authoritativeProductionWasmSha256!==PRODUCTION_WASM_SHA256
      ||document.preflightResult?.checks?.authoritativeProduction?.candidateId!=='stage2n-r3-candidate-01')
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: authoritative historical identity changed');
  const expectedHashes={productionWasmSha256:PRODUCTION_WASM_SHA256,configSha256:CONFIG_SHA256,presetsSha256:PRESETS_SHA256,profileSha256:PROFILE_SHA256,referenceFixtureSha256:FIXTURE_SHA256};
  const actualHashes=document.preflightResult?.checks?.authoritativeProduction?.hashes||{};
  for(const [name,value] of Object.entries(expectedHashes))if(actualHashes[name]!==value)
    throw new Error(`BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: ${name} is not the accepted Stage2Q value`);
  if(classification==='SUFFICIENT_METADATA_PROVENANCE'
      &&document.isolatedProductionBuild?.sha256!=='eef4fb43c8df85d7840bacd258e289448d2f841c95a02157d29d45803341df47')
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: sufficient-provenance rebuild identity changed');
  if(document.productionEmbeddedInterface?.matchesStage2qInterface!==true
      ||document.productionEmbeddedInterface?.sha256!=='be532c4d5d21a89ac53c41dd4e98ed334cce823c6afa3352db75c39c8fbc67cd'
      ||document.cleanStage2qMetadata?.profileSha256!==PROFILE_SHA256
      ||document.cleanStage3bBaselineMetadata?.profileSha256!==PROFILE_SHA256
      ||document.cleanStage2qMetadata?.runtimeMetadataFingerprintSha256!==document.cleanStage3bBaselineMetadata?.runtimeMetadataFingerprintSha256)
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: interface, profile, or runtime metadata lineage changed');
  for(const key of ['committedProductionPathDiff','postBaselineProductionPathDiff'])if(document[key]?.unchanged!==true)
    throw new Error(`BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: ${key} is not unchanged`);
  const descriptor=document.workingTreeDescriptorState;
  if(descriptor?.unchanged!==true||descriptor.before?.sha256!==descriptor.after?.sha256)
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: preserved dirty descriptor identity changed');
  const mainRoot=mainCheckoutRoot(root);
  assertHash('preserved dirty descriptor',fileSha(path.join(mainRoot,`${BASE}/descriptor.json`)),descriptor.before.sha256);
  const toolchainSha=document.toolchain?.toolchainFileSha256;
  if(!/^[0-9a-f]{64}$/.test(toolchainSha||'')
      ||fileSha(path.join(mainRoot,'wasm/cmake/wasm32-clang.cmake'))!==toolchainSha
      ||!document.toolchain?.clang?.version||!document.toolchain?.wasmLd?.version||!document.toolchain?.cmake)
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: toolchain provenance is incomplete or changed');
  return {classification,sha256:sha256(bytes),path:provenanceFile,bytes,document,mainRoot};
}
function sourceIdentity({root,provenance}){
  const mainRoot=provenance?.mainRoot||mainCheckoutRoot(root);
  const wasmRoot=path.join(mainRoot,'wasm');
  const files={
    stage3dPlugin:`${BASE}/src/plugin_stage3d.c`,
    historicalPlugin:`${BASE}/src/plugin.c`,
    historicalCmakeMacro:'wasm/cmake/wasm_plugin.cmake',
    wasmCmakeLists:'wasm/CMakeLists.txt',
    toolchain:'wasm/cmake/wasm32-clang.cmake',
    descriptor:`${BASE}/descriptor.json`,
    presets:`${BASE}/presets.json`,
    profile:'wasm/shared/generated/super-synth_grand_profiles.h',
    referenceFixture:`${BASE}/test/reference/salamander-grand-piano-v3-metrics.json`,
    generatedDescriptorCbor:'wasm/shared/generated/super-synth_descriptor.cbor',
    generatedDescriptorHeader:'wasm/shared/generated/super-synth_descriptor.h',
    generatedInterface:'wasm/shared/generated/super-synth_interface.soraoto',
  };
  const hashes={};
  for(const [name,relative] of Object.entries(files)){
    const full=path.join(mainRoot,relative);
    if(!fs.existsSync(full))throw new Error(`BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: missing source input ${relative}`);
    hashes[name]=fileSha(full);
  }
  assertHash('Stage3D isolated source',hashes.stage3dPlugin,STAGE3D_SOURCE_SHA256);
  assertHash('historical plugin source',hashes.historicalPlugin,HISTORICAL_PLUGIN_SHA256);
  assertHash('historical CMake macro',hashes.historicalCmakeMacro,HISTORICAL_CMAKE_MACRO_SHA256);
  assertHash('presets',hashes.presets,PRESETS_SHA256);assertHash('profile',hashes.profile,PROFILE_SHA256);
  assertHash('reference fixture',hashes.referenceFixture,FIXTURE_SHA256);
  assertHash('preserved dirty descriptor',hashes.descriptor,provenance.document.workingTreeDescriptorState.before.sha256);
  assertHash('toolchain file',hashes.toolchain,provenance.document.toolchain.toolchainFileSha256);
  const metadata=provenance.document.dirtyDescriptorSnapshotMetadata;
  if(metadata?.profileSha256!==hashes.profile)
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: profile differs from accepted provenance');
  return {mainRoot,wasmRoot,files,hashes,provenanceSha256:provenance.sha256,
    acceptedDescriptorSnapshotMetadata:metadata,
    candidateId:'stage2n-r3-candidate-01',productionWasmSha256:PRODUCTION_WASM_SHA256,
    isolatedProductionBuildSha256:provenance.document.isolatedProductionBuild.sha256,
    productionProvenanceClassification:provenance.classification};
}
function exportsOf(wasm){return new Set(WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(wasm))).map(item=>item.name));}
function verifyDiagnosticControls({root,buildDir,wasmPath}={}){
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=buildDir;
  try{
    const {PluginHarness}=require(path.join(root,'wasm/test/helpers/plugin-harness.cjs'));
    const harness=new PluginHarness(root,WASM_REL,{sampleRate:48000,maxFrames:2048});
    try{
      const e=harness.e;
      if((e.soraoto_supersynth_stage3d_set_variant(0)|0)!==0||e.soraoto_supersynth_stage3d_get_variant()!==0)
        throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: Stage3D variant 0 round-trip failed');
      if((e.soraoto_supersynth_stage2m_set_factor_mask(3)>>>0)!==0||e.soraoto_supersynth_stage2m_get_factor_mask()!==3)
        throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: Stage2M mask 3 round-trip failed');
      return {stage3dVariant:0,stage2mFactorMask:3,acousticRenders:0};
    }finally{harness.close();}
  }finally{if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;}
}
function buildExactStage3dSurrogate({root,tempRoot,provenance=validateProductionLineage({root}),runTool=execFileSync}={}){
  const inputs=sourceIdentity({root,provenance});
  const tmp=tempRoot||fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-stage3d-surrogate-'));
  const ownsTemp=!tempRoot;fs.mkdirSync(tmp,{recursive:true});
  const source=path.join(tmp,'wasm'),buildDir=path.join(tmp,'build');
  const logs={};
  try{
    fs.cpSync(inputs.wasmRoot,source,{recursive:true,filter:(from)=>!/(^|[\\/])(build|CMakeFiles)([\\/]|$)|CMakeCache\.txt$/.test(from)});
    const flags={...EXPECTED_FLAGS};
    const cmakeFlags=Object.entries(flags).map(([key,value])=>`-D${key}=${value}`);
    const toolchain=path.join(source,'cmake/wasm32-clang.cmake');
    const configure=['cmake','-S',source,'-B',buildDir,`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,...cmakeFlags];
    logs.configure=runTool('rtk',[...configure],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
    logs.build=runTool('rtk',['cmake','--build',buildDir,'--target','soraoto_dsp_super_synth'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
    const wasmPath=path.join(buildDir,WASM_REL);if(!fs.existsSync(wasmPath))throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: output WASM missing');
    const wasmSha256=fileSha(wasmPath);assertHash('Stage3D diagnostic WASM',wasmSha256,STAGE3D_WASM_SHA256);
    const cachePath=path.join(buildDir,'CMakeCache.txt'),cache=fs.readFileSync(cachePath,'utf8');
    const expectedCache={BUILD_TESTING:'BOOL=OFF',SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'BOOL=ON',
      SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'BOOL=ON',SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'BOOL=OFF',
      SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'BOOL=OFF',SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'BOOL=ON',
      SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'UNINITIALIZED=OFF'};
    for(const [name,value] of Object.entries(expectedCache))if(!cache.includes(`${name}:${value}`))
      throw new Error(`BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: CMake flag ${name} mismatch`);
    const targetFile=path.join(buildDir,'plugins/dsp/super-synth/CMakeFiles/soraoto_dsp_super_synth.dir/build.make');
    const target=fs.readFileSync(targetFile,'utf8');
    if(!/src\/plugin_stage3d\.c/.test(target)||/src\/plugin\.c(?:\.(?:o|obj))?\b/.test(target))
      throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: diagnostic target does not use plugin_stage3d.c exclusively');
    const names=exportsOf(wasmPath);
    for(const name of ['soraoto_supersynth_stage3d_set_variant','soraoto_supersynth_stage3d_get_variant',
      'soraoto_supersynth_stage2m_set_factor_mask','soraoto_supersynth_stage2m_get_factor_mask'])if(!names.has(name))
      throw new Error(`BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: missing export ${name}`);
    const forbidden=[...names].filter(name=>/stage3[bce].*(set_variant|set_response|set_velocity)/i.test(name));
    if(forbidden.length)throw new Error(`BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: forbidden exports ${forbidden.join(',')}`);
    const controls=verifyDiagnosticControls({root,buildDir,wasmPath});
    const identity={schemaVersion:1,decision:'STAGE3E_STAGE3D_SURROGATE_EXACT_REBUILD',wasmSha256,
      productionLineage:{classification:provenance.classification,provenanceSha256:provenance.sha256,
        authoritativeProductionWasmSha256:PRODUCTION_WASM_SHA256,isolatedOrdinaryBuildSha256:provenance.document.isolatedProductionBuild.sha256},
      sourceIdentity:inputs,cmakeFlags:flags,cacheSha256:fileSha(cachePath),targetUsesPluginStage3d:true,
      stage3dAndStage2mExportsPresent:true,stage3bStage3cStage3eExportsAbsent:true,controls,
      toolchain:{fileSha256:inputs.hashes.toolchain,cacheToolchainPath:(cache.match(/^CMAKE_TOOLCHAIN_FILE:[^=]+=([^\n]+)$/m)||[])[1]||null},
      acousticRenders:0};
    return {tmp,ownsTemp,source,buildDir,wasmPath,identity,logs,cleanup(){if(ownsTemp)fs.rmSync(tmp,{recursive:true,force:true});}};
  }catch(error){if(ownsTemp)fs.rmSync(tmp,{recursive:true,force:true});throw error;}
}

module.exports={STAGE3D_WASM_SHA256,STAGE3D_SOURCE_SHA256,HISTORICAL_PLUGIN_SHA256,HISTORICAL_CMAKE_MACRO_SHA256,
  PRODUCTION_WASM_SHA256,CONFIG_SHA256,PROFILE_SHA256,PRESETS_SHA256,FIXTURE_SHA256,EXPECTED_FLAGS,
  sha256,fileSha,mainCheckoutRoot,provenancePath,validateProductionLineage,sourceIdentity,verifyDiagnosticControls,
  buildExactStage3dSurrogate,exportsOf};
