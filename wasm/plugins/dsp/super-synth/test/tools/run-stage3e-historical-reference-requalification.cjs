#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const PRODUCTION_REVISION='28e2c06c09683f7c077c0411a9eb1a1e6495fb7d';
const STAGE3A_REVISION='d2bc990a9e669e4e5496d9a745d171fc0434ca99';
const CAPTURE_HELPER_REVISION='0a25e10ae0e023b0f335fed642ab743638ffbd92';
const PRODUCTION_WASM_SHA256='9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2';
const STAGE3A_WASM_SHA256='59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3';
const CAPTURE_HELPER_SHA256='780087c6fd91cc431127e740f909f4c62202f46c21e0bb788856d999093064d8';
const CONFIG_SHA256='792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d';
const PROFILE_SHA256='cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66';
const PRESETS_SHA256='cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431';
const FIXTURE_SHA256='5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7';
const CANDIDATE_ID='stage2n-r3-candidate-01';
const EXECUTION_ID='historical-reference-requalification-v1';
const DERIVATIVE_EXPECTED=[0.06299055264228781,0.05389008449437237,0.24231471764008602];
const PRODUCTION_CELLS=[[36,14],[36,124],[39,14],[39,124],[51,14],[51,124],[54,14],[54,124],[96,31]]
  .map(([pitch,velocity])=>({kind:'production',pitch,velocity,velocityNormalized:velocity/127}));
const STAGE3A_CELLS=[.25,.55,.90].map(velocityNormalized=>({kind:'stage3a',pitch:41,velocity:Math.round(velocityNormalized*127),velocityNormalized,derivativeWindowMs:[30,180]}));
const AUTHORIZED_CELLS=[...PRODUCTION_CELLS,...STAGE3A_CELLS];
const TOLERANCE=1e-6;
const BASE='wasm/plugins/dsp/super-synth';
const PRESETS_REL=`${BASE}/presets.json`;
const PROFILE_REL='wasm/shared/generated/super-synth_grand_profiles.h';
const FIXTURE_REL=`${BASE}/test/reference/salamander-grand-piano-v3-metrics.json`;
const CAPTURE_REL=`${BASE}/test/tools/capture-supersynth-matrix.cjs`;
const STAGE2Q_CANDIDATE_PRESETS_REL='.agent-state/issues/7/calibration-optuna/stage2n-revision3/scratch/stage2n-r3-candidate-01/source/wasm/plugins/dsp/super-synth/presets.json';
const WASM_REL='plugins/dsp/super-synth/plugin.wasm';

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fileSha(file){return sha256(fs.readFileSync(file));}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
function canonicalBytes(value){return Buffer.from(JSON.stringify(stable(value),null,2)+'\n');}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function runTool(tool,args,{cwd=ROOT,env=process.env}={}){
  try{return execFileSync('rtk',[tool,...args],{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});}
  catch(error){const output=[error.stdout,error.stderr].filter(Boolean).join('\n');throw new Error(`BLOCKED_STAGE3E_HISTORICAL_BUILD: rtk ${tool} ${args.join(' ')} failed${output?`\n${output}`:''}`);}
}
function gitBlob(root,revision,relative){return execFileSync('rtk',['git','show',`${revision}:${relative}`],{cwd:root,encoding:null,stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});}
function assertCommit(root,revision){try{execFileSync('rtk',['git','cat-file','-e',`${revision}^{commit}`],{cwd:root,stdio:'ignore'});}catch{throw new Error(`BLOCKED_STAGE3E_HISTORICAL_SOURCE_REVISION_MISSING: ${revision}`);}}
function mainCheckoutRoot(root=ROOT){const common=execFileSync('rtk',['git','rev-parse','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();return path.dirname(path.resolve(root,common));}
function readStage2QCandidatePresets(root=ROOT){const file=path.join(mainCheckoutRoot(root),STAGE2Q_CANDIDATE_PRESETS_REL);if(!fs.existsSync(file))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_STAGE2Q_CONFIG_EVIDENCE: missing ${STAGE2Q_CANDIDATE_PRESETS_REL}`);const bytes=fs.readFileSync(file);assertHash('Stage2Q candidate config',sha256(bytes),CONFIG_SHA256,'BLOCKED_STAGE3E_HISTORICAL_STAGE2Q_CONFIG_EVIDENCE');return {file,bytes,sha256:sha256(bytes)};}
function assertCandidateConfigMatchesSource(candidateBytes,sourcePresetBytes,label){if(!same(JSON.parse(candidateBytes.toString('utf8')),JSON.parse(sourcePresetBytes.toString('utf8'))))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_STAGE2Q_CONFIG_EVIDENCE: ${label} parsed preset content differs from the exact Stage2Q candidate config`);}
function assertHash(name,actual,expected,blocker){if(actual!==expected)throw new Error(`${blocker}: ${name} expected ${expected}, got ${actual}`);}
function captureHelperIdentityFromRevision(root=ROOT,revision=CAPTURE_HELPER_REVISION){
  assertCommit(root,revision);
  const helper=gitBlob(root,revision,CAPTURE_REL),presets=gitBlob(root,revision,PRESETS_REL),profile=gitBlob(root,revision,PROFILE_REL),fixture=gitBlob(root,revision,FIXTURE_REL);
  const identity={sourceRevision:revision,sha256:sha256(helper),presetsSha256:sha256(presets),profileSha256:sha256(profile),referenceFixtureSha256:sha256(fixture)};
  assertHash('capture helper',identity.sha256,CAPTURE_HELPER_SHA256,'BLOCKED_STAGE3E_HISTORICAL_CAPTURE_HELPER_IDENTITY');
  assertHash('capture-helper presets',identity.presetsSha256,PRESETS_SHA256,'BLOCKED_STAGE3E_HISTORICAL_CAPTURE_HELPER_IDENTITY');
  assertHash('capture-helper profile',identity.profileSha256,PROFILE_SHA256,'BLOCKED_STAGE3E_HISTORICAL_CAPTURE_HELPER_IDENTITY');
  assertHash('capture-helper reference fixture',identity.referenceFixtureSha256,FIXTURE_SHA256,'BLOCKED_STAGE3E_HISTORICAL_CAPTURE_HELPER_IDENTITY');
  return identity;
}
function productionIdentityFromRevision(root=ROOT,revision=PRODUCTION_REVISION){
  const presets=gitBlob(root,revision,PRESETS_REL),profile=gitBlob(root,revision,PROFILE_REL),fixture=gitBlob(root,revision,FIXTURE_REL);
  const candidateConfig=readStage2QCandidatePresets(root);assertCandidateConfigMatchesSource(candidateConfig.bytes,presets,'production source');
  const identity={candidateId:CANDIDATE_ID,sourceRevision:revision,presetsSha256:sha256(presets),profileSha256:sha256(profile),referenceFixtureSha256:sha256(fixture),configSha256:candidateConfig.sha256};
  assertHash('config',identity.configSha256,CONFIG_SHA256,'BLOCKED_STAGE3E_HISTORICAL_PRODUCTION_REBUILD');
  assertHash('profile',identity.profileSha256,PROFILE_SHA256,'BLOCKED_STAGE3E_HISTORICAL_PRODUCTION_REBUILD');
  assertHash('presets',identity.presetsSha256,PRESETS_SHA256,'BLOCKED_STAGE3E_HISTORICAL_PRODUCTION_REBUILD');
  assertHash('fixture',identity.referenceFixtureSha256,FIXTURE_SHA256,'BLOCKED_STAGE3E_HISTORICAL_PRODUCTION_REBUILD');
  return identity;
}
function assertHistoricalSources(root=ROOT){
  for(const revision of [PRODUCTION_REVISION,STAGE3A_REVISION])assertCommit(root,revision);
  const production=productionIdentityFromRevision(root);
  const captureHelper=captureHelperIdentityFromRevision(root),candidateConfig=readStage2QCandidatePresets(root),stage3aPresets=gitBlob(root,STAGE3A_REVISION,PRESETS_REL);
  assertCandidateConfigMatchesSource(candidateConfig.bytes,stage3aPresets,'Stage3A source');
  return {production,stage3a:{sourceRevision:STAGE3A_REVISION,diagnosticWasmSha256:STAGE3A_WASM_SHA256,configSha256:candidateConfig.sha256},captureHelper,stage2qCandidateConfigBytes:candidateConfig.bytes,stage2qCandidateConfigPath:candidateConfig.file};
}
function cellKey(cell){return cell.kind==='production'?`production-midi-${String(cell.pitch).padStart(3,'0')}-velocity-${String(cell.velocity).padStart(3,'0')}`:`stage3a-midi-041-v${String(Math.round(cell.velocityNormalized*1000)).padStart(3,'0')}`;}
function exactCellList(){return AUTHORIZED_CELLS.map(cell=>({...cell,key:cellKey(cell)}));}
function assertAuthorizedCells(cells){
  if(!Array.isArray(cells)||cells.length!==12)throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_IDENTITY: exactly 12 cells are authorized');
  const expected=exactCellList();
  if(!same(cells.map(cell=>({...cell,key:cellKey(cell)})),expected))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_IDENTITY: authorized cell set mismatch');
  if(new Set(cells.map(cell=>cellKey(cell))).size!==12)throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_IDENTITY: duplicate cell');
  return expected;
}
function roots(root=ROOT,home=process.env.HOME){return durable.resolveRoots({root,issue:'7',task:'stage3e',executionId:EXECUTION_ID,home});}
function nearestExistingDirectory(file){let dir=path.dirname(file);while(!fs.existsSync(dir)){const parent=path.dirname(dir);if(parent===dir)throw new Error(`no existing parent for ${file}`);dir=parent;}return dir;}
function assertDurableDestinationsWritable(rootSet){for(const directory of [rootSet.primary,rootSet.secondary]){const parent=nearestExistingDirectory(directory);fs.accessSync(parent,fs.constants.W_OK);}}
function assertNoWorktreeOrBuildRoot(rootSet,root=ROOT){const within=(base,value)=>value===base||value.startsWith(base+path.sep);const build=path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build'));for(const candidate of [rootSet.primary,rootSet.secondary])if(within(path.resolve(root),candidate)||within(build,candidate))throw new Error('BLOCKED_STAGE3E_EVIDENCE_ROOT_INSIDE_WORKTREE_OR_BUILD');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function durableWrite(rootsSet,relative,bytes){return durable.writeDualCopy(path.join(rootsSet.primary,relative),path.join(rootsSet.secondary,relative),bytes);}
function durableRead(rootsSet,relative){return durable.verifyDualCopy(path.join(rootsSet.primary,relative),path.join(rootsSet.secondary,relative));}
function immutableWrite(rootsSet,relative,bytes){const a=path.join(rootsSet.primary,relative),b=path.join(rootsSet.secondary,relative);if(fs.existsSync(a)||fs.existsSync(b)){if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: partial immutable artifact');const existing=durable.verifyDualCopy(a,b);if(!existing.bytes.equals(bytes))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: immutable artifact identity changed');return existing;}return durable.writeDualCopy(a,b,bytes);}
function freshLedger(identity){const cells={};for(const row of exactCellList())cells[row.key]={state:'PENDING',identity:row,relativePath:`cells/${row.key}.json`,sha256:null,renderObserved:false};return {schemaVersion:1,decision:'HISTORICAL_REFERENCE_REQUALIFICATION_IN_PROGRESS',executionId:EXECUTION_ID,identity,authorizedRenderCount:12,accounting:{newRenderCalls:0},cells};}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells).filter(x=>x.state===state).length]));}
function currentIdentity(root=ROOT,sourceIdentity,buildIdentity,captureHelper,runnerSha256){
  const runnerPath=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-historical-reference-requalification.cjs');
  const returnValue={...sourceIdentity,productionRevision:PRODUCTION_REVISION,stage3aRevision:STAGE3A_REVISION,captureHelperSha256:captureHelper.sha256,captureHelperSourceRevision:captureHelper.sourceRevision,
    productionWasmSha256:buildIdentity.productionWasmSha256,stage3aDiagnosticWasmSha256:buildIdentity.stage3aDiagnosticWasmSha256,
    executionSourceRevision:execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    runnerSha256:runnerSha256||fileSha(runnerPath),
    productionBuildFlags:buildIdentity.productionBuildFlags,stage3aBuildFlags:buildIdentity.stage3aBuildFlags};
  return returnValue;
}
function createWorktree(root,revision,directory){runTool('git',['worktree','add','--detach',directory,revision],{cwd:root});}
function removeWorktree(root,directory){try{runTool('git',['worktree','remove','--force',directory],{cwd:root});}catch{try{fs.rmSync(directory,{recursive:true,force:true});runTool('git',['worktree','prune'],{cwd:root});}catch{}}}
function cmakeOptionArgs(flags){return Object.entries(flags).map(([key,value])=>`-D${key}=${value}`);}
function configureAndBuild(root,worktree,buildDir,kind,logs){
  const toolchain=path.join(worktree,'wasm/cmake/wasm32-clang.cmake');
  const flags={SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:kind==='stage3a'?'ON':'OFF',SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:kind==='stage3a'?'ON':'OFF',SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'OFF'};
  const args=['-S',path.join(worktree,'wasm'),'-B',buildDir,`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,'-DBUILD_TESTING=OFF',...cmakeOptionArgs(flags)];
  const configOut=runTool('cmake',args,{cwd:root});logs[`${kind}-configure.stdout.txt`]=configOut;
  const buildOut=runTool('cmake',['--build',buildDir,'--target','soraoto_dsp_super_synth'],{cwd:root});logs[`${kind}-build.stdout.txt`]=buildOut;
  const wasm=path.join(buildDir,WASM_REL);if(!fs.existsSync(wasm))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_${kind.toUpperCase()}_REBUILD: output WASM missing`);
  const expected=kind==='production'?PRODUCTION_WASM_SHA256:STAGE3A_WASM_SHA256;
  assertHash(`${kind} WASM`,fileSha(wasm),expected,kind==='production'?'BLOCKED_STAGE3E_HISTORICAL_PRODUCTION_REBUILD':'BLOCKED_STAGE3E_HISTORICAL_STAGE3A_REBUILD');
  const cache=path.join(buildDir,'CMakeCache.txt');
  for(const [key,value] of Object.entries(flags)){const text=fs.readFileSync(cache,'utf8');if(!new RegExp(`^${key}:BOOL=${value}$`,'m').test(text))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_BUILD_CONFIGURATION: ${key} is not ${value}`);}
  return {buildDir,wasmPath:wasm,wasmSha256:fileSha(wasm),cachePath:cache,flags};
}
function buildHistoricalPair({root=ROOT,tempRoot,sourceIdentity=assertHistoricalSources(root)}={}){
  const tmp=tempRoot||fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-historical-requalification-'));
  const ownTemp=!tempRoot;fs.mkdirSync(tmp,{recursive:true});
  const prodCheckout=path.join(tmp,'production-source'),stage3aCheckout=path.join(tmp,'stage3a-source'),helperCheckout=path.join(tmp,'capture-helper-source');
  const prodBuild=path.join(tmp,'production-build'),stage3aBuild=path.join(tmp,'stage3a-build');
  const logs={};let prodAdded=false,stage3aAdded=false,helperAdded=false;
  try{
    createWorktree(root,PRODUCTION_REVISION,prodCheckout);prodAdded=true;
    createWorktree(root,STAGE3A_REVISION,stage3aCheckout);stage3aAdded=true;
    createWorktree(root,CAPTURE_HELPER_REVISION,helperCheckout);helperAdded=true;
    const production=configureAndBuild(root,prodCheckout,prodBuild,'production',logs);
    const stage3a=configureAndBuild(root,stage3aCheckout,stage3aBuild,'stage3a',logs);
    const helperPath=path.join(helperCheckout,CAPTURE_REL);
    assertHash('historical capture helper',fileSha(helperPath),sourceIdentity.captureHelper.sha256,'BLOCKED_STAGE3E_HISTORICAL_CAPTURE_HELPER_IDENTITY');
    const prodPresets=path.join(prodCheckout,PRESETS_REL),prodProfile=path.join(prodCheckout,PROFILE_REL),prodFixture=path.join(prodCheckout,FIXTURE_REL);
    const stage3aPresets=path.join(stage3aCheckout,PRESETS_REL),stage3aProfile=path.join(stage3aCheckout,PROFILE_REL),stage3aFixture=path.join(stage3aCheckout,FIXTURE_REL);
    if(!Buffer.isBuffer(sourceIdentity.stage2qCandidateConfigBytes))throw new Error('BLOCKED_STAGE3E_HISTORICAL_STAGE2Q_CONFIG_EVIDENCE: exact candidate config bytes are unavailable');
    assertHash('Stage2Q candidate config',sha256(sourceIdentity.stage2qCandidateConfigBytes),CONFIG_SHA256,'BLOCKED_STAGE3E_HISTORICAL_STAGE2Q_CONFIG_EVIDENCE');
    assertCandidateConfigMatchesSource(sourceIdentity.stage2qCandidateConfigBytes,fs.readFileSync(prodPresets),'production checkout');
    assertCandidateConfigMatchesSource(sourceIdentity.stage2qCandidateConfigBytes,fs.readFileSync(stage3aPresets),'Stage3A checkout');
    const actual={productionWasmSha256:production.wasmSha256,stage3aDiagnosticWasmSha256:stage3a.wasmSha256,
      configSha256:sha256(sourceIdentity.stage2qCandidateConfigBytes),profileSha256:fileSha(prodProfile),presetsSha256:fileSha(prodPresets),referenceFixtureSha256:fileSha(prodFixture),captureHelperSha256:fileSha(helperPath),captureHelperSourceRevision:CAPTURE_HELPER_REVISION};
    for(const [key,expected] of Object.entries({productionWasmSha256:PRODUCTION_WASM_SHA256,stage3aDiagnosticWasmSha256:STAGE3A_WASM_SHA256,configSha256:CONFIG_SHA256,profileSha256:PROFILE_SHA256,presetsSha256:PRESETS_SHA256,referenceFixtureSha256:FIXTURE_SHA256,captureHelperSha256:CAPTURE_HELPER_SHA256,captureHelperSourceRevision:CAPTURE_HELPER_REVISION}))assertHash(key,actual[key],expected,key==='productionWasmSha256'?'BLOCKED_STAGE3E_HISTORICAL_PRODUCTION_REBUILD':key==='stage3aDiagnosticWasmSha256'?'BLOCKED_STAGE3E_HISTORICAL_STAGE3A_REBUILD':key.startsWith('captureHelper')?'BLOCKED_STAGE3E_HISTORICAL_CAPTURE_HELPER_IDENTITY':'BLOCKED_STAGE3E_HISTORICAL_PRODUCTION_REBUILD');
    for(const [name,file,expected] of [['Stage3A profile',stage3aProfile,PROFILE_SHA256],['Stage3A presets',stage3aPresets,PRESETS_SHA256],['Stage3A reference fixture',stage3aFixture,FIXTURE_SHA256]]){
      const actualHash=fileSha(file);
      assertHash(name,actualHash,expected,'BLOCKED_STAGE3E_HISTORICAL_STAGE3A_REBUILD');
    }
    const buildIdentity={...actual,productionBuildFlags:production.flags,stage3aBuildFlags:stage3a.flags};
    return {tmp,ownTemp,prodCheckout,stage3aCheckout,helperCheckout,production,stage3a,buildIdentity,logs,cleanup(){if(helperAdded)removeWorktree(root,helperCheckout);if(stage3aAdded)removeWorktree(root,stage3aCheckout);if(prodAdded)removeWorktree(root,prodCheckout);if(ownTemp)fs.rmSync(tmp,{recursive:true,force:true});}};
  }catch(error){if(helperAdded)removeWorktree(root,helperCheckout);if(stage3aAdded)removeWorktree(root,stage3aCheckout);if(prodAdded)removeWorktree(root,prodCheckout);if(ownTemp)fs.rmSync(tmp,{recursive:true,force:true});throw error;}
}
function withBuildEnv(buildDir,fn){const before=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=buildDir;try{return fn();}finally{if(before===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=before;}}
function loadCapture(checkout,buildDir){const helper=path.join(checkout,CAPTURE_REL);const resolved=require.resolve(helper);delete require.cache[resolved];return withBuildEnv(buildDir,()=>require(resolved));}
function assertJsonFinite(value,where='metrics'){
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_SAFETY: non-finite ${where}`);
  if(Array.isArray(value))value.forEach((item,i)=>assertJsonFinite(item,`${where}[${i}]`));
  else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))assertJsonFinite(item,`${where}.${key}`);
}
function validateMetrics(cell,metrics){
  if(!metrics||typeof metrics!=='object')throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: metrics missing');
  assertJsonFinite(metrics);
  if(metrics.finite!==true)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_SAFETY: ${cellKey(cell)} finite != true`);
  if(!Number.isFinite(metrics.peakDbfs)||metrics.peakDbfs>=0||!Number.isFinite(metrics.fullRenderPeakDbfs)||metrics.fullRenderPeakDbfs>=0)
    throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_SAFETY: ${cellKey(cell)} peak safety failed`);
  if(cell.kind==='stage3a'){
    const index=STAGE3A_CELLS.findIndex(row=>row.velocityNormalized===cell.velocityNormalized);
    if(metrics.stage2mFactorMask!==3||metrics.outputGuardHits!==0)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_STAGE3A_SAFETY: ${cellKey(cell)} mask/guard mismatch`);
    if(JSON.stringify(metrics.velocityDerivativeWindowMs)!==JSON.stringify([30,180]))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_STAGE3A_WINDOW: ${cellKey(cell)}`);
    if(!Number.isFinite(metrics.velocityDerivative)||Math.abs(metrics.velocityDerivative-DERIVATIVE_EXPECTED[index])>TOLERANCE)
      throw new Error(`BLOCKED_STAGE3E_HISTORICAL_STAGE3A_DERIVATIVE: ${cellKey(cell)} expected ${DERIVATIVE_EXPECTED[index]}, got ${metrics.velocityDerivative}`);
    if(!metrics.soundboardDiagnostics||!metrics.stage2mHammer)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_STAGE3A_EVIDENCE: ${cellKey(cell)} diagnostics missing`);
  }
  return metrics;
}
function captureOne(cell,built){
  if(cell.kind==='production'){
    const capture=loadCapture(built.helperCheckout,built.production.buildDir);
    const metrics=capture.render(cell.pitch,cell.velocity,{},{});
    return {pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized,kind:cell.kind,metrics:validateMetrics(cell,metrics)};
  }
  const capture=loadCapture(built.helperCheckout,built.stage3a.buildDir);
  const metrics=capture.renderNormalized(cell.pitch,cell.velocityNormalized,{}, {stage2mFactorMask:3,includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,includeSoundboardDiagnostics:true});
  return {pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized,kind:cell.kind,metrics:validateMetrics(cell,metrics)};
}
function expectedLedgerIdentity(sourceIdentity,buildIdentity,runnerSha,executionSourceRevision){return {candidateId:CANDIDATE_ID,productionRevision:PRODUCTION_REVISION,stage3aRevision:STAGE3A_REVISION,...sourceIdentity.production,
  captureHelperSha256:sourceIdentity.captureHelper.sha256,captureHelperSourceRevision:sourceIdentity.captureHelper.sourceRevision,
  productionWasmSha256:buildIdentity.productionWasmSha256,
  stage3aDiagnosticWasmSha256:buildIdentity.stage3aDiagnosticWasmSha256,productionBuildFlags:buildIdentity.productionBuildFlags,
  stage3aBuildFlags:buildIdentity.stage3aBuildFlags,executionSourceRevision,runnerSha256:runnerSha,authorizedCells:exactCellList()};}
function loadOrCreateLedger(rootsSet,identity){
  const primary=path.join(rootsSet.primary,'ledger.json'),secondary=path.join(rootsSet.secondary,'ledger.json');
  if(!fs.existsSync(primary)&&!fs.existsSync(secondary)){
    const ledger=freshLedger(identity);durableWrite(rootsSet,'ledger.json',jsonBytes(ledger));return ledger;
  }
  if(!fs.existsSync(primary)||!fs.existsSync(secondary))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: partial ledger copy');
  const bytes=durableRead(rootsSet,'ledger.json').bytes;const ledger=JSON.parse(bytes.toString('utf8'));
  if(ledger.executionId!==EXECUTION_ID||ledger.authorizedRenderCount!==12||!same(ledger.identity,identity)||Object.keys(ledger.cells||{}).length!==12)
    throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_IDENTITY: ledger identity changed');
  for(const row of exactCellList())if(!ledger.cells[row.key]||!same(ledger.cells[row.key].identity,row))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_IDENTITY: ledger cell ${row.key} changed`);
  const inProgress=Object.entries(ledger.cells).filter(([,cell])=>cell.state==='IN_PROGRESS');
  if(inProgress.length)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_AMBIGUOUS_RENDER_ACCOUNTING: ${inProgress.map(([key])=>key).join(',')}`);
  for(const [key,cell] of Object.entries(ledger.cells))if(cell.state==='COMPLETE'){
    const evidence=durableRead(rootsSet,cell.relativePath);if(evidence.sha256!==cell.sha256)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: completed row hash mismatch ${key}`);
    const stored=JSON.parse(evidence.bytes.toString('utf8'));if(stored.cellKey!==key||stored.rowSha256!==cell.rowSha256||!same(stored.identity,identity))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: completed row identity mismatch ${key}`);
    const rowBody={...stored};delete rowBody.rowSha256;if(sha256(canonicalBytes(rowBody))!==stored.rowSha256)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: completed row payload hash mismatch ${key}`);
    validateMetrics(cell.identity,stored.metrics);
  }
  return ledger;
}
function persistBuildEvidence(rootsSet,built,identity,startedAt,sourceIdentity){
  const productionCache=fs.readFileSync(built.production.cachePath,'utf8'),stage3aCache=fs.readFileSync(built.stage3a.cachePath,'utf8');
  const cacheSummary=kind=>Object.fromEntries(Object.entries(kind==='production'?built.production.flags:built.stage3a.flags).map(([key,value])=>[key,value]));
  const objects=[['build/production/plugin.wasm',fs.readFileSync(built.production.wasmPath)],['build/stage3a/plugin.wasm',fs.readFileSync(built.stage3a.wasmPath)],
    ['source/stage2q-candidate-presets.json',sourceIdentity.stage2qCandidateConfigBytes],
    ['build/production/configuration.json',jsonBytes({sourceRevision:PRODUCTION_REVISION,flags:cacheSummary('production'),toolchain:'wasm/cmake/wasm32-clang.cmake',cacheHasToolchain:/CMAKE_TOOLCHAIN_FILE:FILEPATH=/.test(productionCache)})],
    ['build/stage3a/configuration.json',jsonBytes({sourceRevision:STAGE3A_REVISION,flags:cacheSummary('stage3a'),toolchain:'wasm/cmake/wasm32-clang.cmake',cacheHasToolchain:/CMAKE_TOOLCHAIN_FILE:FILEPATH=/.test(stage3aCache)})],
    ['source/capture-helper/capture-supersynth-matrix.cjs',fs.readFileSync(path.join(built.helperCheckout,CAPTURE_REL))],['source/capture-helper/source-revision.txt',Buffer.from(`${identity.captureHelperSourceRevision}\n`)],['source/production/presets.json',fs.readFileSync(path.join(built.prodCheckout,PRESETS_REL))],['source/production/super-synth_grand_profiles.h',fs.readFileSync(path.join(built.prodCheckout,PROFILE_REL))],['source/production/reference-fixture.json',fs.readFileSync(path.join(built.prodCheckout,FIXTURE_REL))]];
  for(const [relative,bytes] of objects)immutableWrite(rootsSet,relative,bytes);
  for(const [name,output] of Object.entries(built.logs)){
    const relative=`logs/${name}`,a=path.join(rootsSet.primary,relative),b=path.join(rootsSet.secondary,relative);
    if(fs.existsSync(a)||fs.existsSync(b)){if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: partial log copy');durable.verifyDualCopy(a,b);}
    else durableWrite(rootsSet,relative,Buffer.from(output));
  }
  immutableWrite(rootsSet,'identity.json',jsonBytes(identity));
  immutableWrite(rootsSet,'execution-manifest.json',jsonBytes({schemaVersion:1,executionId:EXECUTION_ID,generation:'historical-reference-requalification-v1',state:'ACQUIRING',candidateId:CANDIDATE_ID,identity,authorizedCells:exactCellList(),createdAt:startedAt}));
}
function loadExistingReferenceSet(rootsSet){
  const file=path.join(rootsSet.primary,'historical-reference-set.json'),second=path.join(rootsSet.secondary,'historical-reference-set.json');
  if(!fs.existsSync(file)&&!fs.existsSync(second))return null;
  if(!fs.existsSync(file)||!fs.existsSync(second))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: incomplete finalized set');
  const stored=durableRead(rootsSet,'historical-reference-set.json');const hash=durableRead(rootsSet,'historical-reference-set.sha256');
  if(hash.bytes.toString('utf8')!==`${stored.sha256}\n`)throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: finalized set hash file mismatch');
  const parsed=JSON.parse(stored.bytes.toString('utf8'));
  if(parsed.decision!=='STAGE3E_HISTORICAL_REFERENCE_REQUALIFIED'||parsed.rows?.length!==12||parsed.acousticRenderCalls!==12||parsed.authorizedCells?.length!==12||parsed.productionCandidateDelta!==0||parsed.stage4Renders!==0||parsed.equivalenceTolerance!==TOLERANCE)
    throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: finalized set invalid');
  const keys=parsed.rows.map(row=>row.cellKey);if(new Set(keys).size!==12||!same(keys,exactCellList().map(row=>row.key)))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: finalized cell set mismatch');
  return {result:parsed,sha256:stored.sha256};
}
function validateFinalRows(rootsSet,ledger){
  const entries=[];
  for(const row of exactCellList()){
    const state=ledger.cells[row.key];if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: ${row.key} is ${state.state}`);
    const file=durableRead(rootsSet,state.relativePath);if(file.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: ${row.key} hash mismatch`);
    const doc=JSON.parse(file.bytes.toString('utf8'));if(doc.cellKey!==row.key||!same(doc.identity,ledger.identity))throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: ${row.key} identity mismatch`);
    const rowBody={...doc};delete rowBody.rowSha256;if(sha256(canonicalBytes(rowBody))!==doc.rowSha256||doc.rowSha256!==state.rowSha256)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: ${row.key} row hash mismatch`);
    validateMetrics(row,doc.metrics);entries.push({...doc,rowFileSha256:file.sha256});
  }
  return entries;
}
function finalize({root=ROOT,rootsSet,ledger,now=()=>new Date().toISOString()}={}){
  const existing=loadExistingReferenceSet(rootsSet);if(existing){
    const metadata={creatorRevision:ledger.identity.executionSourceRevision||ledger.identity.runnerSha256,executionId:EXECUTION_ID,generation:'historical-reference-requalification-v1',runnerSha256:ledger.identity.runnerSha256,helperSha256:CAPTURE_HELPER_SHA256,wasmSha256:PRODUCTION_WASM_SHA256,startedAt:ledger.startedAt||existing.result.completedAt,finalizedAt:existing.result.completedAt,decision:existing.result.decision};
    const manifest=durable.writeFinalizedManifest({primaryRoot:rootsSet.primary,secondaryRoot:rootsSet.secondary,metadata});
    const archive=durable.createPhaseArchive({primaryRoot:rootsSet.primary,secondaryRoot:rootsSet.secondary,phase:'historical-reference-requalification'});
    return {...existing,manifestSha256:manifest.sha256,archiveSha256:archive.sha256,renderCalls:0,idempotent:true};
  }
  const status=counts(ledger);if(status.COMPLETE!==12||status.PENDING!==0||status.IN_PROGRESS!==0)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: expected 12 COMPLETE, got ${JSON.stringify(status)}`);
  const rows=validateFinalRows(rootsSet,ledger);
  const result={schemaVersion:1,decision:'STAGE3E_HISTORICAL_REFERENCE_REQUALIFIED',candidateId:CANDIDATE_ID,productionRevision:PRODUCTION_REVISION,stage3aRevision:STAGE3A_REVISION,identity:ledger.identity,authorizedCells:exactCellList(),rows,acousticRenderCalls:ledger.accounting.newRenderCalls,equivalenceTolerance:TOLERANCE,completedAt:now(),productionCandidateDelta:0,stage4Renders:0};
  if(result.acousticRenderCalls!==12)throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_ACCOUNTING: expected 12 calls, got ${result.acousticRenderCalls}`);
  const bytes=jsonBytes(result),written=immutableWrite(rootsSet,'historical-reference-set.json',bytes);immutableWrite(rootsSet,'historical-reference-set.sha256',Buffer.from(written.sha256+'\n'));
  const manifest=durable.writeFinalizedManifest({primaryRoot:rootsSet.primary,secondaryRoot:rootsSet.secondary,metadata:{creatorRevision:ledger.identity.executionSourceRevision||ledger.identity.runnerSha256,executionId:EXECUTION_ID,generation:'historical-reference-requalification-v1',runnerSha256:ledger.identity.runnerSha256,helperSha256:CAPTURE_HELPER_SHA256,wasmSha256:PRODUCTION_WASM_SHA256,startedAt:ledger.startedAt||result.completedAt,finalizedAt:result.completedAt,decision:result.decision}});
  const archive=durable.createPhaseArchive({primaryRoot:rootsSet.primary,secondaryRoot:rootsSet.secondary,phase:'historical-reference-requalification'});
  return {result,sha256:written.sha256,manifestSha256:manifest.sha256,archiveSha256:archive.sha256,renderCalls:0,idempotent:false};
}
function run({mode,root=ROOT,home=process.env.HOME,build=buildHistoricalPair,capture=captureOne,now=()=>new Date().toISOString(),validateSources=assertHistoricalSources,rootsFactory=roots}={}){
  if(!['--dry-run','--execute','--finalize'].includes(mode))throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  const sourceIdentity=validateSources(root);const rootSet=rootsFactory(root,home);assertNoWorktreeOrBuildRoot(rootSet,root);
  const runnerSha=fileSha(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-historical-reference-requalification.cjs'));
  if(mode==='--dry-run'){
    assertDurableDestinationsWritable(rootSet);
    const existing=loadExistingReferenceSet(rootSet);
    const historicalSourceIdentities={production:sourceIdentity.production,stage3a:sourceIdentity.stage3a,captureHelper:sourceIdentity.captureHelper};
    return {decision:existing?.result.decision||'STAGE3E_HISTORICAL_REFERENCE_REQUALIFICATION_READY',builds:0,renders:0,acousticRenders:0,authorizedRenderCount:12,authorizedCells:exactCellList(),historicalSourceIdentities,finalizedReferenceSetSha256:existing?.sha256||null};
  }
  if(mode==='--execute'){
    const existing=loadExistingReferenceSet(rootSet);
    if(existing)return {decision:existing.result.decision,builds:0,renders:0,acousticRenders:0,idempotent:true,finalizedReferenceSetSha256:existing.sha256};
  }
  if(mode==='--finalize'){
    const ledgerPath=path.join(rootSet.primary,'ledger.json');if(!fs.existsSync(ledgerPath)||!fs.existsSync(path.join(rootSet.secondary,'ledger.json')))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_EVIDENCE: ledger missing');
    const staticBuildIdentity={productionWasmSha256:PRODUCTION_WASM_SHA256,stage3aDiagnosticWasmSha256:STAGE3A_WASM_SHA256,
      productionBuildFlags:{SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'OFF'},
      stage3aBuildFlags:{SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'ON',SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'ON',SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'OFF',SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'OFF'}};
    const expected=expectedLedgerIdentity(sourceIdentity,staticBuildIdentity,runnerSha,execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
    const ledger=loadOrCreateLedger(rootSet,expected);
    const finalized=finalize({root,rootsSet:rootSet,ledger,now});return {decision:finalized.result.decision,builds:0,renders:0,acousticRenders:0,...finalized};
  }
  const built=build({root,sourceIdentity});
  try{
    const identity=currentIdentity(root,sourceIdentity.production,built.buildIdentity,sourceIdentity.captureHelper,runnerSha);
    assertDurableDestinationsWritable(rootSet);
    const ledger=loadOrCreateLedger(rootSet,identity);
    if(!ledger.startedAt){ledger.startedAt=now();durableWrite(rootSet,'ledger.json',jsonBytes(ledger));}
    persistBuildEvidence(rootSet,built,identity,ledger.startedAt,sourceIdentity);
    let rendersThisInvocation=0;
    for(const row of exactCellList()){
      const cell=ledger.cells[row.key];if(cell.state==='COMPLETE')continue;
      if(cell.state!=='PENDING')throw new Error(`BLOCKED_STAGE3E_HISTORICAL_REFERENCE_AMBIGUOUS_RENDER_ACCOUNTING: ${row.key} is ${cell.state}`);
      const current=currentIdentity(root,sourceIdentity.production,built.buildIdentity,sourceIdentity.captureHelper,runnerSha);
      if(!same(current,identity))throw new Error('BLOCKED_STAGE3E_HISTORICAL_REFERENCE_IDENTITY: identity drift before render');
      cell.state='IN_PROGRESS';cell.startedAt=now();durableWrite(rootSet,'ledger.json',jsonBytes(ledger));
      const captured=capture(row,built);const cellDoc={schemaVersion:1,cellKey:row.key,identity,row:{...row},metrics:captured.metrics,capturedAt:now()};
      rendersThisInvocation++;
      const rowBody={...cellDoc};cellDoc.rowSha256=sha256(canonicalBytes(rowBody));
      const cellBytes=jsonBytes(cellDoc);const saved=durableWrite(rootSet,cell.relativePath,cellBytes);
      ledger.accounting.newRenderCalls++;cell.state='COMPLETE';cell.sha256=saved.sha256;cell.rowSha256=cellDoc.rowSha256;cell.renderObserved=true;cell.completedAt=now();durableWrite(rootSet,'ledger.json',jsonBytes(ledger));
    }
    return {decision:'STAGE3E_HISTORICAL_REFERENCE_REQUALIFICATION_CELLS_COMPLETE',builds:2,renders:rendersThisInvocation,acousticRenders:rendersThisInvocation,totalNewRenderCalls:ledger.accounting.newRenderCalls,...counts(ledger),authorizedRenderCount:12};
  }finally{built.cleanup?.();}
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==1)throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  const result=run({mode:argv[0]});process.stdout.write(JSON.stringify(result)+'\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={ROOT,PRODUCTION_REVISION,STAGE3A_REVISION,CAPTURE_HELPER_REVISION,PRODUCTION_WASM_SHA256,STAGE3A_WASM_SHA256,CAPTURE_HELPER_SHA256,CONFIG_SHA256,PROFILE_SHA256,PRESETS_SHA256,FIXTURE_SHA256,CANDIDATE_ID,EXECUTION_ID,DERIVATIVE_EXPECTED,PRODUCTION_CELLS,STAGE3A_CELLS,AUTHORIZED_CELLS,TOLERANCE,sha256,fileSha,stable,canonicalBytes,same,mainCheckoutRoot,readStage2QCandidatePresets,assertCandidateConfigMatchesSource,captureHelperIdentityFromRevision,productionIdentityFromRevision,assertHistoricalSources,cellKey,exactCellList,assertAuthorizedCells,roots,durableRead,durableWrite,assertDurableDestinationsWritable,assertNoWorktreeOrBuildRoot,buildHistoricalPair,configureAndBuild,cmakeOptionArgs,validateMetrics,freshLedger,counts,expectedLedgerIdentity,loadOrCreateLedger,persistBuildEvidence,loadExistingReferenceSet,validateFinalRows,finalize,run,main};
