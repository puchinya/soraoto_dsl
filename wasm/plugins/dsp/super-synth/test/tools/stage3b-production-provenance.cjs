'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const STAGE2Q='28e2c06c09683f7c077c0411a9eb1a1e6495fb7d';
const STAGE3A='d2bc990a9e669e4e5496d9a745d171fc0434ca99';
const STAGE3B='c1fd7f39b1c5d8353862169cadf7e187a7ed6eb6';
const AUTHORITATIVE_WASM='9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2';
const FIXED_PROFILE='cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66';
const FIXED_PRESETS='cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431';
const FIXED_REFERENCE='5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7';
const PRODUCTION_PATHS=[
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/plugins/dsp/super-synth/descriptor.json',
  'wasm/plugins/dsp/super-synth/interface.soraoto',
  'wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h',
  'wasm/cmake/wasm_plugin.cmake',
  'wasm/cmake/generate_plugin_metadata.py',
  'wasm/cmake/super_synth_metadata.py',
  'wasm/cmake/append_custom_sections.py',
  'wasm/cmake/wasm32-clang.cmake'
];
const RUNTIME_ARRAYS=[
  'soraoto_param_ids','soraoto_param_min','soraoto_param_max','soraoto_param_default_norm',
  'soraoto_param_type','soraoto_param_scale','soraoto_param_interpolation','soraoto_param_scale_aux',
  'soraoto_factory_preset_ids','soraoto_factory_preset_norm','soraoto_program_ids',
  'soraoto_program_info_offsets','soraoto_program_info_bytes'
];

function sha256(buffer){return crypto.createHash('sha256').update(buffer).digest('hex');}
function sha256File(file){return sha256(fs.readFileSync(file));}

function rtk(args,{cwd,encoding='buffer',maxBuffer=32*1024*1024}={}){
  const result=spawnSync('rtk',args,{cwd,encoding,maxBuffer});
  if(result.error)throw result.error;
  if(result.status!==0){
    const output=Buffer.isBuffer(result.stderr)?result.stderr.toString('utf8'):String(result.stderr||'');
    throw new Error(`rtk ${args.join(' ')} failed (${result.status}): ${output.slice(0,1600)}`);
  }
  return result.stdout;
}
function rtkStatus(args,{cwd}={}){
  const result=spawnSync('rtk',args,{cwd,encoding:'buffer',maxBuffer:32*1024*1024});
  if(result.error)throw result.error;
  return {status:result.status,stdout:Buffer.from(result.stdout||[]),stderr:Buffer.from(result.stderr||[])};
}

function extractNamedCustomSections(wasmBytes,names){
  const module=new WebAssembly.Module(wasmBytes);
  const output={};
  for(const name of names){
    const sections=WebAssembly.Module.customSections(module,name);
    if(sections.length!==1)throw new Error(`expected exactly one ${name} custom section, found ${sections.length}`);
    output[name]=Buffer.from(sections[0]);
  }
  return output;
}

function cArrayDeclarations(headerText){
  const declarations=new Map();
  const re=/static\s+const\s+[^;{}]+?\b(\w+)\s*((?:\[\s*\d+\s*\])+?)\s*=\s*\{([\s\S]*?)\};/g;
  let match;
  while((match=re.exec(headerText))!==null){
    const dims=[...match[2].matchAll(/\[\s*(\d+)\s*\]/g)].map(item=>Number(item[1]));
    const values=[...match[3].matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map(item=>Number(item[0]));
    declarations.set(match[1],{dims,values});
  }
  return declarations;
}

function reshape(values,dims){
  if(dims.length===0)return values[0];
  let offset=0;
  function nest(depth){
    const count=dims[depth],result=[];
    if(depth===dims.length-1){for(let i=0;i<count;i++)result.push(values[offset++]);}
    else for(let i=0;i<count;i++)result.push(nest(depth+1));
    return result;
  }
  const result=nest(0);
  if(offset!==values.length)throw new Error('C metadata array reshape did not consume all values');
  return result;
}

function runtimeMetadataFingerprint(headerText){
  const arrays=cArrayDeclarations(headerText),metadata={};
  for(const name of RUNTIME_ARRAYS){
    const item=arrays.get(name);
    if(!item)throw new Error(`generated descriptor header missing runtime metadata array ${name}`);
    const expectedCount=item.dims.reduce((product,dimension)=>product*dimension,1);
    if(item.values.length!==expectedCount)throw new Error(`${name} has ${item.values.length} values, expected ${expectedCount}`);
    metadata[name]=reshape(item.values,item.dims);
  }
  for(const [name,item] of arrays){
    if(name==='soraoto_descriptor_bytes')continue;
    if(!Object.hasOwn(metadata,name))metadata[name]=reshape(item.values,item.dims);
  }
  const macros={};
  for(const line of headerText.split(/\r?\n/)){
    const match=line.match(/^\s*#define\s+(\w+)(?:\s+(.*?))?\s*$/);
    if(!match||match[1]==='SORAOTO_DESCRIPTOR_LEN')continue;
    const value=(match[2]||'').trim();
    macros[match[1]]=value===''?true:(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)?Number(value):value);
  }
  const count=headerText.match(/^#define PLUGIN_PARAM_COUNT (\d+)$/m);
  const listId=headerText.match(/^#define PLUGIN_PROGRAM_LIST_ID (\d+)$/m);
  const programCount=headerText.match(/^#define PLUGIN_PROGRAM_COUNT (\d+)$/m);
  if(!count||!listId||!programCount)throw new Error('generated header missing parameter/program count macros');
  metadata.PLUGIN_PARAM_COUNT=Number(count[1]);
  metadata.PLUGIN_PROGRAM_LIST_ID=Number(listId[1]);
  metadata.PLUGIN_PROGRAM_COUNT=Number(programCount[1]);
  metadata.macros=macros;
  if(metadata.soraoto_param_ids.length!==metadata.PLUGIN_PARAM_COUNT
      ||metadata.soraoto_factory_preset_norm.some(row=>row.length!==metadata.PLUGIN_PARAM_COUNT))
    throw new Error('generated metadata count macros disagree with runtime tables');
  const canonical=Buffer.from(JSON.stringify(metadata),'utf8');
  return {sha256:sha256(canonical),metadata};
}

function classifyProvenance({embeddedDescriptorSha256,embeddedInterfaceMatchesStage2q,
  variants,isolatedProductionBuildSha256,profileSha256,productionPathsUnchanged,authoritativeWasmSha256,
  dirtyDescriptorUnchanged}){
  const matching=variants.filter(row=>row.descriptorCborSha256===embeddedDescriptorSha256);
  if(isolatedProductionBuildSha256===AUTHORITATIVE_WASM&&variants.some(row=>row.name==='B'
      &&row.descriptorCborSha256===embeddedDescriptorSha256))return {classification:'EXACT_REBUILD_PROVENANCE',matchingVariants:matching.map(x=>x.name)};
  const stage2q=variants.find(row=>row.name==='A');
  const sufficient=embeddedInterfaceMatchesStage2q===true&&matching.length===1&&stage2q
    &&matching[0].runtimeMetadataFingerprintSha256===stage2q.runtimeMetadataFingerprintSha256
    &&profileSha256===FIXED_PROFILE&&productionPathsUnchanged===true
    &&authoritativeWasmSha256===AUTHORITATIVE_WASM&&dirtyDescriptorUnchanged===true;
  return {classification:sufficient?'SUFFICIENT_METADATA_PROVENANCE':'UNRESOLVED',matchingVariants:matching.map(x=>x.name)};
}

function commandVersion(args,{cwd}={}){
  const result=rtkStatus(args,{cwd});
  return result.status===0?result.stdout.toString('utf8').trim():null;
}
function cmakeCacheMetadata(cacheFile){
  if(!fs.existsSync(cacheFile))return null;
  const text=fs.readFileSync(cacheFile,'utf8'),take=key=>{
    const match=text.match(new RegExp(`^${key}:[^=]+=([^\\r\\n]*)$`,'m'));
    return match?match[1]:null;
  };
  return {compilerPath:take('CMAKE_C_COMPILER'),linkerPath:take('CMAKE_LINKER'),
    cFlags:take('CMAKE_C_FLAGS'),exeLinkerFlags:take('CMAKE_EXE_LINKER_FLAGS'),
    toolchainFile:path.basename(take('CMAKE_TOOLCHAIN_FILE')||'wasm32-clang.cmake'),
    guardDiagnostics:take('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS'),
    stage2mDiagnostics:take('SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS'),
    stage3bDiagnostics:take('SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS')};
}

function captureToolchain(root,stage3bBuildCache){
  const baseCache=path.join(root,'build/wasm/CMakeCache.txt');
  const cache=cmakeCacheMetadata(stage3bBuildCache)||cmakeCacheMetadata(baseCache)||{};
  const clangPath=cache.compilerPath||'/opt/homebrew/bin/clang';
  const linkerPath=cache.linkerPath||'/opt/homebrew/bin/wasm-ld';
  const toolchainFile=path.join(root,'wasm/cmake/wasm32-clang.cmake');
  return {clang:{path:clangPath,version:commandVersion(['proxy',clangPath,'--version'],{cwd:root})},
    wasmLd:{path:linkerPath,version:commandVersion(['proxy',linkerPath,'--version'],{cwd:root})},
    cmake:commandVersion(['proxy','cmake','--version'],{cwd:root}),
    python:commandVersion(['proxy','python3','--version'],{cwd:root}),
    node:commandVersion(['proxy','node','--version'],{cwd:root}),
    toolchainFileSha256:fs.existsSync(toolchainFile)?sha256File(toolchainFile):null,
    relevantCMakeCache:cache};
}

function metadataVariant(name,checkout,buildDir){
  const generated=path.join(buildDir,'generated');
  const cbor=path.join(generated,'super-synth_descriptor.cbor');
  const header=path.join(generated,'super-synth_descriptor.h');
  const profile=path.join(checkout,'wasm/shared/generated/super-synth_grand_profiles.h');
  for(const file of [cbor,header,profile])if(!fs.existsSync(file))throw new Error(`${name} metadata generator did not produce ${path.basename(file)}`);
  const fingerprint=runtimeMetadataFingerprint(fs.readFileSync(header,'utf8'));
  return {name,descriptorCborSha256:sha256File(cbor),descriptorCborBytes:fs.statSync(cbor).size,
    descriptorHeaderSha256:sha256File(header),descriptorHeaderBytes:fs.statSync(header).size,
    runtimeMetadataFingerprintSha256:fingerprint.sha256,profileSha256:sha256File(profile)};
}

function generateVariant({gitRoot,parent,name,commit,descriptorSnapshot,buildDir,runRtk}){
  const checkout=path.join(parent,name);
  runRtk(['git','worktree','add','--detach',checkout,commit],gitRoot);
  if(descriptorSnapshot)fs.copyFileSync(descriptorSnapshot,path.join(checkout,'wasm/plugins/dsp/super-synth/descriptor.json'));
  const generator=path.join(checkout,'wasm/cmake/generate_plugin_metadata.py');
  runRtk(['proxy','python3',generator,buildDir],checkout);
  return {checkout,metadata:metadataVariant(name,checkout,buildDir),buildDir};
}

function descriptorWorkingTreeState(root){
  const rel='wasm/plugins/dsp/super-synth/descriptor.json',file=path.join(root,rel);
  const bytes=fs.readFileSync(file),headBytes=rtk(['git','show',`HEAD:${rel}`],{cwd:root});
  const status=rtk(['git','status','--short','--',rel],{cwd:root}).toString('utf8').trim();
  const patch=rtk(['git','diff','--binary','HEAD','--',rel],{cwd:root});
  return {sha256:sha256(bytes),sizeBytes:bytes.length,gitStatus:status||'clean',differsFromHead:!bytes.equals(headBytes),
    diffPatchSha256:sha256(patch)};
}

function committedProductionPathDiff(root){
  const result=rtkStatus(['git','diff','--exit-code',STAGE2Q,STAGE3A,'--',...PRODUCTION_PATHS],{cwd:root});
  return {from:STAGE2Q,to:STAGE3A,paths:PRODUCTION_PATHS,unchanged:result.status===0,
    changedPaths:result.status===0?[]:result.stdout.toString('utf8').split('\n').filter(line=>/^diff --git a\//.test(line))};
}

function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  fs.renameSync(temp,file);
}

function runProvenanceReconciliation({root,outputFile,diagnosticBuildCache=null,knownIsolatedProductionSha256=null}={}){
  if(!root||!outputFile)throw new Error('root and private outputFile are required');
  const head=rtk(['git','rev-parse','HEAD'],{cwd:root}).toString('utf8').trim();
  const ancestor=rtkStatus(['git','merge-base','--is-ancestor',STAGE3B,head],{cwd:root});
  const postBaselineDiff=rtkStatus(['git','diff','--exit-code',STAGE3B,head,'--',...PRODUCTION_PATHS],{cwd:root});
  if(ancestor.status!==0||postBaselineDiff.status!==0)
    throw new Error(`Stage3B HEAD must descend from ${STAGE3B} without production-input changes, got ${head}`);
  const before=descriptorWorkingTreeState(root),prod=path.join(root,'build/wasm/plugins/dsp/super-synth/plugin.wasm');
  if(!fs.existsSync(prod)||sha256File(prod)!==AUTHORITATIVE_WASM)
    throw new Error('authoritative production artifact is missing or changed');
  const sections=extractNamedCustomSections(fs.readFileSync(prod),['soraoto.plugin.v1','soraoto.interface']);
  const expectedInterface=rtk(['git','show',`${STAGE2Q}:wasm/plugins/dsp/super-synth/interface.soraoto`],{cwd:root});
  const embeddedDescriptor={sha256:sha256(sections['soraoto.plugin.v1']),lengthBytes:sections['soraoto.plugin.v1'].length};
  const embeddedInterface={sha256:sha256(sections['soraoto.interface']),lengthBytes:sections['soraoto.interface'].length,
    stage2qInterfaceSha256:sha256(expectedInterface),
    matchesStage2qInterface:sections['soraoto.interface'].equals(expectedInterface)};
  const pathDiff=committedProductionPathDiff(root);
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'stage3b-provenance-'));
  const variants=[];let productionBuild=null,provenanceError=null,gitRoot=path.join(parent,'repository');
  const runRtk=(args,cwd)=>rtk(args,{cwd,maxBuffer:128*1024*1024});
  try{
    runRtk(['git','clone','--shared','--no-checkout',root,gitRoot],root);
    const a=generateVariant({gitRoot,parent,name:'A',commit:STAGE2Q,buildDir:path.join(parent,'build-A'),runRtk});variants.push(a.metadata);
    const b=generateVariant({gitRoot,parent,name:'B',commit:STAGE3B,buildDir:path.join(parent,'build-B'),runRtk});variants.push(b.metadata);
    const c=generateVariant({gitRoot,parent,name:'C',commit:STAGE2Q,descriptorSnapshot:path.join(root,'wasm/plugins/dsp/super-synth/descriptor.json'),
      buildDir:path.join(parent,'build-C'),runRtk});variants.push(c.metadata);
    const buildDir=path.join(parent,'build-ordinary-B');
    runRtk(['cmake','-S',path.join(b.checkout,'wasm'),'-B',buildDir,
      `-DCMAKE_TOOLCHAIN_FILE=${path.join(b.checkout,'wasm/cmake/wasm32-clang.cmake')}`,
      '-DBUILD_TESTING=OFF','-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=OFF',
      '-DSORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=OFF','-DSORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS=OFF'],root);
    runRtk(['cmake','--build',buildDir],root);
    const builtWasm=path.join(buildDir,'plugins/dsp/super-synth/plugin.wasm');
    const builtHeader=path.join(buildDir,'generated/super-synth_descriptor.h');
    const builtCbor=path.join(buildDir,'generated/super-synth_descriptor.cbor');
    const builtProfile=path.join(b.checkout,'wasm/shared/generated/super-synth_grand_profiles.h');
    const bMetadata=metadataVariant('B',b.checkout,buildDir);
    variants[1]=bMetadata;
    productionBuild={sha256:sha256File(builtWasm),descriptorCborSha256:sha256File(builtCbor),
      runtimeMetadataFingerprintSha256:runtimeMetadataFingerprint(fs.readFileSync(builtHeader,'utf8')).sha256,
      profileSha256:sha256File(builtProfile),diagnostics:{guard:false,stage2m:false,stage3b:false},
      cmakeCache:cmakeCacheMetadata(path.join(buildDir,'CMakeCache.txt'))};
    if(knownIsolatedProductionSha256&&productionBuild.sha256!==knownIsolatedProductionSha256)
      productionBuild.previousIsolatedBuildSha256=knownIsolatedProductionSha256;
  }catch(error){
    provenanceError=String(error.message||error);
  }finally{
    for(const name of ['C','B','A']){
      const checkout=path.join(parent,name);
      if(fs.existsSync(path.join(checkout,'.git'))){
        const result=spawnSync('rtk',['git','worktree','remove','--force',checkout],{cwd:gitRoot,encoding:'utf8'});
        if(result.status!==0)throw new Error(`failed to remove temporary metadata worktree ${name}: ${String(result.stderr||'').slice(0,1000)}`);
      }
    }
    if(fs.existsSync(gitRoot))fs.rmSync(gitRoot,{recursive:true,force:true});
    fs.rmSync(parent,{recursive:true,force:true});
  }
  const after=descriptorWorkingTreeState(root);
  const dirtyDescriptorUnchanged=JSON.stringify(before)===JSON.stringify(after);
  const classified=provenanceError?{classification:'UNRESOLVED',matchingVariants:[]}:classifyProvenance({embeddedDescriptorSha256:embeddedDescriptor.sha256,
    embeddedInterfaceMatchesStage2q:embeddedInterface.matchesStage2qInterface,variants,
    isolatedProductionBuildSha256:productionBuild.sha256,profileSha256:productionBuild.profileSha256,
    productionPathsUnchanged:pathDiff.unchanged,authoritativeWasmSha256:sha256File(prod),dirtyDescriptorUnchanged});
  const cborMatches=variants.filter(row=>row.descriptorCborSha256===embeddedDescriptor.sha256).map(row=>row.name);
  const artifact={schemaVersion:1,generatedAt:new Date().toISOString(),authoritativeProductionWasmSha256:sha256File(prod),
    fixedIdentities:{productionWasm:AUTHORITATIVE_WASM,presets:FIXED_PRESETS,profile:FIXED_PROFILE,referenceFixture:FIXED_REFERENCE,
      config:'792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d'},
    stage2qCommit:STAGE2Q,stage3bStartingCommit:STAGE3B,preflightCheckedHead:head,
    postBaselineProductionPathDiff:{from:STAGE3B,to:head,unchanged:postBaselineDiff.status===0},committedProductionPathDiff:pathDiff,
    workingTreeDescriptorState:{before,after,unchanged:dirtyDescriptorUnchanged},
    productionEmbeddedDescriptor:{...embeddedDescriptor,matchedVariants:cborMatches},
    productionEmbeddedInterface:embeddedInterface,cleanStage2qMetadata:variants[0],cleanStage3bBaselineMetadata:variants[1],
    dirtyDescriptorSnapshotMetadata:{...variants[2],sourceDescriptor:before},isolatedProductionBuild:productionBuild,
    toolchain:captureToolchain(root,diagnosticBuildCache),classification:classified.classification,
    classificationEvidence:classified,provenanceError};
  artifact.preflightReady=['EXACT_REBUILD_PROVENANCE','SUFFICIENT_METADATA_PROVENANCE'].includes(artifact.classification)
    &&pathDiff.unchanged&&dirtyDescriptorUnchanged&&embeddedInterface.matchesStage2qInterface;
  writeJsonAtomic(outputFile,artifact);
  return artifact;
}

module.exports={STAGE2Q,STAGE3A,STAGE3B,AUTHORITATIVE_WASM,FIXED_PROFILE,FIXED_PRESETS,FIXED_REFERENCE,PRODUCTION_PATHS,RUNTIME_ARRAYS,
  sha256,sha256File,rtkStatus,extractNamedCustomSections,cArrayDeclarations,runtimeMetadataFingerprint,classifyProvenance,
  cmakeCacheMetadata,captureToolchain,descriptorWorkingTreeState,committedProductionPathDiff,runProvenanceReconciliation,writeJsonAtomic};
