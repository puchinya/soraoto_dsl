#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const stage3=require('./run-stage3-production-recovery.cjs');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');
const evaluator=require('./stage4-full-range-evaluator.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const ISSUE='7',TASK='stage4',EXECUTION_ID='authoritative';
const MAIN_COUNT=1408,REPEAT_COUNT=15,CELL_COUNT=1423;
const WASM_RELATIVE=capture.WASM_RELATIVE;
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fileSha(file){return sha256(fs.readFileSync(file));}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function same(a,b){return stage3.same(a,b);}
function key(cell){return `${cell.kind}:${cell.pitch}:${cell.velocity}`;}
function rootsFor(root=ROOT,home=process.env.HOME){return durable.resolveRoots({root,issue:ISSUE,task:TASK,executionId:EXECUTION_ID,home});}
function buildRoot(root=ROOT){return path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm-stage4'));}
function wasmPath(root=ROOT){return path.join(buildRoot(root),WASM_RELATIVE);}
function stage3Roots(root=ROOT,home=process.env.HOME){return stage3.stage3Roots(root,home,'authoritative');}
function currentStage3Identity(root,roots,home,sourceRevision=null){
  const prior=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=path.join(root,'build/wasm');
  try{return stage3.currentIdentity({root,roots,selected:stage3.selectedResponse(root,home),sourceRevision});}
  finally{if(prior===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=prior;}
}
function readDualJson(roots,relative){return JSON.parse(durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.toString('utf8'));}
function writeDualJson(roots,relative,value){return durable.writeDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),jsonBytes(value));}
function writeImmutableDual(roots,relative,bytes){
  const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE4_EVIDENCE: partial immutable ${relative}`);
    const stored=durable.verifyDualCopy(a,b);if(!stored.bytes.equals(data))throw new Error(`BLOCKED_STAGE4_IDENTITY: immutable ${relative} changed`);return stored;
  }
  return durable.writeDualCopy(a,b,data);
}
function ensureExecutionManifest(roots,{identity,now=()=>new Date().toISOString()}={}){
  const relative='execution-manifest.json',a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
  const expected={schemaVersion:1,identity,authorizedCellCount:CELL_COUNT};
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE4_EVIDENCE: partial execution manifest');
    const stored=readDualJson(roots,relative);for(const [key,value] of Object.entries(expected))if(!stage3.same(stored[key],value))throw new Error(`BLOCKED_STAGE4_IDENTITY: manifest ${key} changed`);
    return stored;
  }
  const manifest={...expected,createdAt:now()};writeImmutableDual(roots,relative,jsonBytes(manifest));return manifest;
}
function exactCells(cells=capture.LIFECYCLE_CELLS.concat(capture.REPEAT_CELLS)){
  const expected=capture.LIFECYCLE_CELLS.concat(capture.REPEAT_CELLS),actual=cells.map(key),wanted=expected.map(key);
  if(cells.length!==CELL_COUNT||new Set(actual).size!==CELL_COUNT||wanted.some(id=>!actual.includes(id))||actual.some(id=>!wanted.includes(id)))
    throw new Error('BLOCKED_STAGE4_CAPTURE_COVERAGE: expected 1408 lifecycle + 15 repeat identities');
  return cells;
}
function loadStage3({root=ROOT,home=process.env.HOME}={}){
  const roots=stage3Roots(root,home),resultFile=durable.verifyDualCopy(path.join(roots.primary,'stage3-result.json'),path.join(roots.secondary,'stage3-result.json'));
  const result=JSON.parse(resultFile.bytes.toString('utf8'));
  if(result.evaluation?.decision!=='STAGE3_READY_FOR_STAGE4'||result.evaluation?.productionCandidateDelta!==0)
    throw new Error('BLOCKED_STAGE4_STAGE3_NOT_READY: authoritative Stage3 has not passed');
  stage3.assertSourceAncestor(root,result.identity.sourceRevision);
  const identityNow=currentStage3Identity(root,roots,home,result.identity.sourceRevision);
  if(!stage3.same(identityNow,result.identity))throw new Error('BLOCKED_STAGE4_STAGE3_IDENTITY: authoritative Stage3 identity changed');
  const productionArtifact=durable.verifyDualCopy(path.join(roots.primary,'artifacts/production-plugin.wasm'),path.join(roots.secondary,'artifacts/production-plugin.wasm'));
  if(productionArtifact.sha256!==result.identity.wasmSha256)throw new Error('BLOCKED_STAGE4_STAGE3_EVIDENCE: preserved Stage3 WASM mismatch');
  const manifest=durable.verifyDualCopy(path.join(roots.primary,'evidence-manifest.json'),path.join(roots.secondary,'evidence-manifest.json'));
  const manifestHash=durable.verifyDualCopy(path.join(roots.primary,'evidence-manifest.sha256'),path.join(roots.secondary,'evidence-manifest.sha256'));
  if(manifestHash.bytes.toString('utf8')!==manifest.sha256+'\n'||JSON.parse(manifest.bytes.toString('utf8')).decision!=='STAGE3_READY_FOR_STAGE4')
    throw new Error('BLOCKED_STAGE4_STAGE3_EVIDENCE: Stage3 manifest hash/decision mismatch');
  return {roots,result,resultSha256:resultFile.sha256,manifestSha256:manifest.sha256};
}
function checkExports(wasm){
  const bytes=fs.readFileSync(wasm),module=new WebAssembly.Module(bytes),names=new Set(WebAssembly.Module.exports(module).map(x=>x.name));
  for(const name of ['soraoto_supersynth_active_voice_count','soraoto_supersynth_guard_hit_count'])if(!names.has(name))throw new Error(`BLOCKED_STAGE4_BUILD_IDENTITY: missing ${name}`);
  return {sha256:sha256(bytes),exports:['soraoto_supersynth_active_voice_count','soraoto_supersynth_guard_hit_count']};
}
function buildSnapshot(root=ROOT){
  const build=buildRoot(root),cache=path.join(build,'CMakeCache.txt'),toolchain=path.join(root,'wasm/cmake/wasm32-clang.cmake');
  if(!fs.existsSync(cache)||!fs.existsSync(toolchain))throw new Error('BLOCKED_STAGE4_BUILD_IDENTITY: CMake cache/toolchain missing');
  const cacheBytes=fs.readFileSync(cache),toolchainBytes=fs.readFileSync(toolchain);
  return {buildDirectory:build,cmakeCacheSha256:sha256(cacheBytes),cmakeCacheBase64:cacheBytes.toString('base64'),
    toolchainSha256:sha256(toolchainBytes),toolchainPath:path.relative(root,toolchain),diagnosticWasmSha256:fileSha(wasmPath(root))};
}
function currentIdentity({root=ROOT,home=process.env.HOME,stage3State=loadStage3({root,home}),sourceRevision=null}={}){
  const presetPath=path.join(root,'wasm/plugins/dsp/super-synth/presets.json'),profilePath=path.join(root,'wasm/shared/generated/super-synth_grand_profiles.h');
  const fixturePath=path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
  const sourcePath=path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c'),helperPath=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage4-lifecycle.cjs');
  const runnerPath=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage4-full-range.cjs');
  const evaluatorPath=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/stage4-full-range-evaluator.cjs');
  const presets=JSON.parse(fs.readFileSync(presetPath,'utf8')),fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
  const build=buildSnapshot(root),exports=checkExports(wasmPath(root));
  if(build.diagnosticWasmSha256!==exports.sha256)throw new Error('BLOCKED_STAGE4_BUILD_IDENTITY: WASM changed during identity collection');
  if(stage3State.result.identity.wasmSha256!==fileSha(path.join(root,'build/wasm',WASM_RELATIVE)))throw new Error('BLOCKED_STAGE4_STAGE3_IDENTITY: production WASM differs from Stage3 result');
  sourceRevision=sourceRevision||execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  stage3.assertSourceAncestor(root,sourceRevision);
  return {schemaVersion:1,issue:7,task:TASK,executionId:EXECUTION_ID,sourceRevision,
    candidateId:stage3State.result.identity.candidateId,stage3ResultSha256:stage3State.resultSha256,stage3ManifestSha256:stage3State.manifestSha256,
    stage3Identity:stage3State.result.identity,productionWasmSha256:stage3State.result.identity.wasmSha256,
    diagnosticWasmSha256:exports.sha256,stage3eSelectionSha256:stage3State.result.identity.selectionSha256,
    configSha256:crypto.createHash('sha256').update(JSON.stringify(presets.concert_grand)).digest('hex'),presetsSha256:fileSha(presetPath),
    profileSha256:fileSha(profilePath),fixtureSha256:fileSha(fixturePath),fixtureCoverage:{directCells:fixture.coverage.directCells,pitches:fixture.coverage.pitches,velocities:fixture.coverage.velocityRepresentatives},
    sourcePluginSha256:fileSha(sourcePath),captureHelperSha256:fileSha(helperPath),runnerSha256:fileSha(runnerPath),evaluatorSha256:fileSha(evaluatorPath),
    buildSnapshotSha256:sha256(jsonBytes(build)),buildDirectorySha256:sha256(Buffer.from(build.buildDirectory)),authorizedCellCount:CELL_COUNT,coverage:{lifecycle:MAIN_COUNT,repeats:REPEAT_COUNT}};
}
function sourceRevisionForRun({root=ROOT,roots}={}){
  for(const relative of ['stage4-result.json','ledger.json','identity.json']){
    const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
    if(fs.existsSync(a)||fs.existsSync(b)){
      const value=readDualJson(roots,relative),revision=relative==='stage4-result.json'?value.identity?.sourceRevision:relative==='ledger.json'?value.identity?.sourceRevision:value.sourceRevision;
      if(!revision)throw new Error('BLOCKED_STAGE4_EVIDENCE: creator revision is missing');stage3.assertSourceAncestor(root,revision);return revision;
    }
  }
  return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
}
function freshLedger(identity,cells=exactCells()){
  const states={};for(const cell of cells){const id=key(cell);states[id]={state:'PENDING',identity:cell,relativePath:`cells/${cell.kind}-midi-${String(cell.pitch).padStart(3,'0')}-velocity-${String(cell.velocity).padStart(3,'0')}.json`,sha256:null};}
  return {schemaVersion:1,identity,authorizedCellCount:CELL_COUNT,accounting:{renderCalls:0},cells:states};
}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells).filter(x=>x.state===state).length]));}
function persistLedger(roots,ledger){writeDualJson(roots,'ledger.json',ledger);}
function loadLedger(roots,identity,{create=false,cells=exactCells()}={}){
  const a=path.join(roots.primary,'ledger.json'),b=path.join(roots.secondary,'ledger.json');
  if(!fs.existsSync(a)&&!fs.existsSync(b)){if(!create)throw new Error('BLOCKED_STAGE4_EVIDENCE: ledger missing');const fresh=freshLedger(identity,cells);persistLedger(roots,fresh);return fresh;}
  const ledger=readDualJson(roots,'ledger.json');if(!stage3.same(ledger.identity,identity)||ledger.authorizedCellCount!==CELL_COUNT||Object.keys(ledger.cells||{}).length!==CELL_COUNT)throw new Error('BLOCKED_STAGE4_IDENTITY: ledger identity/coverage mismatch');
  const busy=Object.entries(ledger.cells).filter(([,x])=>x.state==='IN_PROGRESS');if(busy.length)throw new Error(`BLOCKED_STAGE4_AMBIGUOUS_RENDER_ACCOUNTING: ${busy.map(([id])=>id).join(',')}`);
  for(const cell of exactCells(cells)){const state=ledger.cells[key(cell)];if(!state||!stage3.same(state.identity,cell))throw new Error(`BLOCKED_STAGE4_EVIDENCE: unauthorized ${key(cell)}`);
    if(state.state==='COMPLETE'){const stored=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(stored.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE4_EVIDENCE: cell hash mismatch ${key(cell)}`);const row=JSON.parse(stored.bytes.toString('utf8'));if(!stage3.same(row.identity,identity)||!stage3.same(row.cell,cell))throw new Error(`BLOCKED_STAGE4_EVIDENCE: cell identity mismatch ${key(cell)}`);}}
  return ledger;
}
function captureOne(root,cell){return capture.captureLifecycleCell({repoRoot:root,pitch:cell.pitch,velocity:cell.velocity});}
function execute({root=ROOT,roots,identity,ledger,cells=exactCells(),render=captureOne,identityNow,assertAuthorization,now=()=>new Date().toISOString()}={}){
  let calls=0;
  for(const cell of exactCells(cells)){const state=ledger.cells[key(cell)];if(state.state==='COMPLETE')continue;if(state.state!=='PENDING')throw new Error(`BLOCKED_STAGE4_AMBIGUOUS_RENDER_ACCOUNTING: ${key(cell)}`);
    if(!stage3.same(identityNow(),identity))throw new Error(`BLOCKED_STAGE4_IDENTITY: drift before ${key(cell)}`);
    if(assertAuthorization)assertAuthorization();
    state.state='IN_PROGRESS';state.startedAt=now();persistLedger(roots,ledger);
    const measured=render(root,cell),row={schemaVersion:1,identity,cell,...measured,capturedAt:measured.capturedAt||now()};
    const stored=durable.writeDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath),jsonBytes(row));
    state.state='COMPLETE';state.sha256=stored.sha256;state.completedAt=now();ledger.accounting.renderCalls++;calls++;persistLedger(roots,ledger);
  }
  return {calls,...counts(ledger)};
}
function readRows(roots,ledger,cells=exactCells()){
  return exactCells(cells).map(cell=>{const state=ledger.cells[key(cell)];if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE4_EVIDENCE: incomplete ${key(cell)}`);
    const stored=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(stored.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE4_EVIDENCE: cell hash mismatch ${key(cell)}`);
    const row=JSON.parse(stored.bytes.toString('utf8'));if(!stage3.same(row.identity,ledger.identity)||!stage3.same(row.cell,cell))throw new Error(`BLOCKED_STAGE4_EVIDENCE: row identity mismatch ${key(cell)}`);return row;});
}
function validateStage3Again({root,home,identity}={}){const state=loadStage3({root,home});const now=currentIdentity({root,home,stage3State:state,sourceRevision:identity.sourceRevision});if(!stage3.same(now,identity))throw new Error('BLOCKED_STAGE4_IDENTITY: production or Stage3 identity changed');return true;}
function assertStoredInputs({root,home,roots,identity}={}){
  validateStage3Again({root,home,identity});
  for(const [name,value] of Object.entries(identity)){const stored=readDualJson(roots,'identity.json');if(!stage3.same(stored[name],value))throw new Error(`BLOCKED_STAGE4_IDENTITY: persisted ${name} changed`);}
  const wasm=durable.verifyDualCopy(path.join(roots.primary,'artifacts/stage4-plugin.wasm'),path.join(roots.secondary,'artifacts/stage4-plugin.wasm'));
  if(wasm.sha256!==identity.diagnosticWasmSha256)throw new Error('BLOCKED_STAGE4_IDENTITY: diagnostic WASM artifact changed');
  const snapshot=readDualJson(roots,'build-snapshot.json');if(sha256(jsonBytes(snapshot))!==identity.buildSnapshotSha256||!stage3.same(snapshot,buildSnapshot(root)))throw new Error('BLOCKED_STAGE4_IDENTITY: build cache/toolchain changed');
  const manifest=readDualJson(roots,'execution-manifest.json');if(!stage3.same(manifest.identity,identity)||manifest.authorizedCellCount!==CELL_COUNT)throw new Error('BLOCKED_STAGE4_IDENTITY: execution manifest mismatch');
  return true;
}
function verifyFinalized(roots,identity){const stored=durable.verifyDualCopy(path.join(roots.primary,'stage4-result.json'),path.join(roots.secondary,'stage4-result.json'));const result=JSON.parse(stored.bytes.toString('utf8'));if(!stage3.same(result.identity,identity))throw new Error('BLOCKED_STAGE4_IDENTITY: finalized identity mismatch');return {result,sha256:stored.sha256};}
function finalize({root=ROOT,roots,identity,ledger,stage3State,now=()=>new Date().toISOString(),legacy=evaluator.invokeLegacy}={}){
  const rows=readRows(roots,ledger),main=rows.filter(row=>row.cell.kind==='lifecycle'),repeats=rows.filter(row=>row.cell.kind==='repeat');
  if(counts(ledger).PENDING!==0||counts(ledger).IN_PROGRESS!==0||counts(ledger).COMPLETE!==CELL_COUNT||main.length!==MAIN_COUNT||repeats.length!==REPEAT_COUNT)
    throw new Error('BLOCKED_STAGE4_EVIDENCE: finalization requires 1408 lifecycle and 15 repeat cells');
  const matrixDocument={schemaVersion:1,decision:'STAGE4_LIFECYCLE_CAPTURE_COMPLETE',identity,
    coverage:{lifecycleCells:main.length,adjacentComparisons:1392,repeatCells:repeats.length},render:capture.renderMetadata(root),matrix:main,repeats};
  writeImmutableDual(roots,'lifecycle-matrix.json',jsonBytes(matrixDocument));
  const legacyResult=legacy({root,matrixPath:path.join(roots.primary,'lifecycle-matrix.json'),document:matrixDocument});
  const evaluation=evaluator.evaluate({root,identity,stage3Identity:{resultSha256:stage3State.resultSha256,identity:stage3State.result.identity},matrix:main,repeats,
    legacyMatrixPath:path.join(roots.primary,'lifecycle-matrix.json'),legacy:()=>legacyResult});
  const oldA=path.join(roots.primary,'stage4-result.json'),oldB=path.join(roots.secondary,'stage4-result.json');let result,stored;
  const evalA=path.join(roots.primary,'stage4-evaluation.json'),evalB=path.join(roots.secondary,'stage4-evaluation.json');
  if(fs.existsSync(oldA)||fs.existsSync(oldB)){
    const existing=verifyFinalized(roots,identity);result=existing.result;stored={sha256:existing.sha256};
    const priorEvaluation=readDualJson(roots,'stage4-evaluation.json');
    if(!stage3.same(priorEvaluation,evaluation)||!stage3.same(result.evaluation,evaluation))throw new Error('BLOCKED_STAGE4_EVIDENCE: finalized evaluation changed');
  }else{
    writeImmutableDual(roots,'stage4-evaluation.json',jsonBytes(evaluation));
    result={schemaVersion:1,decision:evaluation.decision,identity,renderCalls:ledger.accounting.renderCalls,authorizedCellCount:CELL_COUNT,evaluation,completedAt:now()};
    stored=writeDualJson(roots,'stage4-result.json',result);
  }
  const manifest=durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.sourceRevision,executionId:identity.executionId,generation:4,
    runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.diagnosticWasmSha256,startedAt:ledger.startedAt||result.completedAt,
    finalizedAt:result.completedAt,decision:evaluation.decision}});
  const archive=durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase:'stage4'});
  return {decision:evaluation.decision,builds:0,renders:0,acousticRenders:0,...counts(ledger),resultSha256:stored.sha256,manifestSha256:manifest.sha256,archiveSha256:archive.sha256,evaluation};
}
function run({mode,root=ROOT,home=process.env.HOME,render=captureOne,legacy=evaluator.invokeLegacy,now=()=>new Date().toISOString()}={}){
  if(!['--dry-run','--execute','--finalize'].includes(mode))throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  const stage3State=loadStage3({root,home}),roots=rootsFor(root,home),sourceRevision=sourceRevisionForRun({root,roots});
  const identity=currentIdentity({root,home,stage3State,sourceRevision});
  if(mode==='--dry-run')return {decision:'STAGE4_DRY_RUN_READY',builds:0,renders:0,acousticRenders:0,authorizedLifecycleCells:MAIN_COUNT,authorizedRepeatCells:REPEAT_COUNT,authorizedRenderCount:CELL_COUNT,stage3ResultSha256:stage3State.resultSha256,identity};
  if(mode==='--execute'){
    const build=buildSnapshot(root),wasm=fs.readFileSync(wasmPath(root));
    for(const dir of [roots.primary,roots.secondary])fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const prodArtifact=fs.readFileSync(path.join(stage3State.roots.primary,'artifacts/production-plugin.wasm'));
    writeImmutableDual(roots,'artifacts/production-plugin.wasm',prodArtifact);
    writeImmutableDual(roots,'artifacts/stage4-plugin.wasm',wasm);
    writeImmutableDual(roots,'stage3-result.json',durable.verifyDualCopy(path.join(stage3State.roots.primary,'stage3-result.json'),path.join(stage3State.roots.secondary,'stage3-result.json')).bytes);
    writeImmutableDual(roots,'identity.json',jsonBytes(identity));writeImmutableDual(roots,'build-snapshot.json',jsonBytes(build));
    ensureExecutionManifest(roots,{identity,now});
    const ledger=loadLedger(roots,identity,{create:true});if(!ledger.startedAt){ledger.startedAt=now();persistLedger(roots,ledger);}
    const result=execute({root,roots,identity,ledger,render,
      identityNow:()=>currentIdentity({root,home,stage3State:loadStage3({root,home}),sourceRevision}),assertAuthorization:()=>assertStoredInputs({root,home,roots,identity}),now});
    return {decision:'STAGE4_CAPTURE_IN_PROGRESS',builds:0,renders:result.calls,acousticRenders:result.calls,...counts(ledger),authorizedRenderCount:CELL_COUNT};
  }
  assertStoredInputs({root,home,roots,identity});
  const ledger=loadLedger(roots,identity,{create:false});
  return finalize({root,roots,identity,ledger,stage3State,legacy,now});
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==1)throw new Error('one explicit mode is required: --dry-run, --execute, or --finalize');
  const result=run({mode:argv[0]});process.stdout.write(JSON.stringify(result)+'\n');
  if(argv[0]==='--finalize'&&result.decision!=='STAGE4_FULL_RANGE_COMPLETE')process.exitCode=2;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,ISSUE,TASK,EXECUTION_ID,MAIN_COUNT,REPEAT_COUNT,CELL_COUNT,WASM_RELATIVE,sha256,fileSha,jsonBytes,same,key,rootsFor,buildRoot,wasmPath,stage3Roots,currentStage3Identity,sourceRevisionForRun,readDualJson,writeDualJson,writeImmutableDual,ensureExecutionManifest,exactCells,loadStage3,checkExports,buildSnapshot,currentIdentity,freshLedger,counts,persistLedger,loadLedger,captureOne,execute,readRows,validateStage3Again,assertStoredInputs,verifyFinalized,finalize,run,main};
