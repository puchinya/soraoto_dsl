#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const direct=require('./run-stage3-direct-reference.cjs');
const capture=require('./capture-supersynth-matrix.cjs');
const generation=require('./run-stage3e-generation2.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const WASM_RELATIVE='plugins/dsp/super-synth/plugin.wasm';
const ISSUE='7',TASK='stage3',CELL_COUNT=486,TOLERANCE=1e-6;
const REQUIRED_REGRESSIONS=['concertGrand','pianoRealism','pianoClick','pianoVoiceSteal','pluginInterfaceV1','playbackSafety'];
const CELL_SPECS=[...direct.EXPECTED_PITCHES.flatMap(pitch=>direct.EXPECTED_VELOCITIES.map(velocity=>({kind:'direct',pitch,velocity}))),
  ...direct.SENTINELS.map(cell=>({kind:'sentinel',...cell}))];

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fileSha(file){return sha256(fs.readFileSync(file));}
function key(cell){return `${cell.kind}:${cell.pitch}:${cell.velocity}`;}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function same(a,b){return JSON.stringify(generation.stable(a))===JSON.stringify(generation.stable(b));}
function stage3Roots(root=ROOT,home=process.env.HOME,executionId=process.env.SORAOTO_STAGE3_EXECUTION_ID||'authoritative'){
  if(!['preflight','authoritative'].includes(executionId))throw new Error('BLOCKED_STAGE3_EVIDENCE: execution ID must be preflight or authoritative');
  return durable.resolveRoots({root,issue:ISSUE,task:TASK,executionId,home});
}
function buildRoot(root=ROOT){return path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm'));}
function wasmPath(root=ROOT){return path.join(buildRoot(root),WASM_RELATIVE);}
function selectedResponse(root=ROOT,home=process.env.HOME){
  const generationRoots=generation.generationRoots(root,home);
  const selectedRoots=generation.phaseRoots(generationRoots,'stage3e-selection');
  const stored=durable.verifyDualCopy(path.join(selectedRoots.primary,'selection.json'),path.join(selectedRoots.secondary,'selection.json'));
  const selection=JSON.parse(stored.bytes.toString('utf8'));
  const tuple=selection.selected;
  if(selection.decision!=='STAGE3E_SELECTED_RESPONSE'||!tuple||selection.productionCandidateDelta!==0
      ||![tuple.low,tuple.mid,tuple.bassHardness].every(Number.isFinite))throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: Stage3E selection missing or invalid');
  return {...selection,selectionSha256:stored.sha256};
}
function currentIdentity({root=ROOT,roots=stage3Roots(root),selected=null,sourceRevision=null}={}){
  const presetsFile=path.join(root,'wasm/plugins/dsp/super-synth/presets.json');
  const profileFile=path.join(root,'wasm/shared/generated/super-synth_grand_profiles.h');
  const fixtureFile=path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
  const sourceFile=path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c');
  const build=buildRoot(root),wasm=wasmPath(root);
  const runnerFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3-production-recovery.cjs');
  const captureFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
  const evaluatorFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3-direct-reference.cjs');
  const fixture=JSON.parse(fs.readFileSync(fixtureFile,'utf8'));
  const preset=JSON.parse(fs.readFileSync(presetsFile,'utf8')).concert_grand;
  if(!selected?.selected)throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: selected Stage3E tuple is required');
  const hammer=preset.engine_config?.hammer||{};
  if(hammer.velocity_launch_scale_low!==selected.selected.low
      ||hammer.velocity_launch_scale_mid!==selected.selected.mid
      ||hammer.velocity_hardness_scale_bass!==selected.selected.bassHardness)
    throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: concert_grand does not contain the selected Stage3E tuple');
  sourceRevision=sourceRevision||execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  return {schemaVersion:1,issue:7,task:TASK,executionId:path.basename(roots.primary),sourceRevision,
    candidateId:'stage2n-r3-candidate-01',wasmSha256:fileSha(wasm),sourcePluginSha256:fileSha(sourceFile),
    configSha256:sha256(Buffer.from(JSON.stringify(preset))),presetsSha256:fileSha(presetsFile),profileSha256:fileSha(profileFile),
    fixtureSha256:fileSha(fixtureFile),captureHelperSha256:fileSha(captureFile),runnerSha256:fileSha(runnerFile),evaluatorSha256:fileSha(evaluatorFile),
    buildRootSha256:sha256(Buffer.from(build)),selectionSha256:selected.selectionSha256,selectedResponse:selected.selected,coverage:{directCells:480,sentinels:6,total:CELL_COUNT},
    reference:{archiveSha256:fixture.source?.archiveSha256,directCells:fixture.coverage?.directCells}};
}
function assertSourceAncestor(root,sourceRevision){
  try{execFileSync('rtk',['git','merge-base','--is-ancestor',sourceRevision,'HEAD'],{cwd:root,stdio:'ignore'});}
  catch{throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: evidence creator revision is not an ancestor of current HEAD');}
}
function sourceRevisionForRun({root=ROOT,roots,mode}={}){
  const candidates=['stage3-result.json','ledger.json'];
  for(const relative of candidates){
    const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
    if(fs.existsSync(a)||fs.existsSync(b)){
      const stored=readDualJson(roots,relative),revision=relative==='stage3-result.json'?stored.identity?.sourceRevision:stored.identity?.sourceRevision;
      if(!revision)throw new Error('BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: creator revision is missing');assertSourceAncestor(root,revision);return revision;
    }
  }
  return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
}
function exactCells(cells=CELL_SPECS){
  if(cells.length!==CELL_COUNT||new Set(cells.map(key)).size!==CELL_COUNT)throw new Error('BLOCKED_STAGE3_CAPTURE_COVERAGE: expected 480 direct + 6 sentinel identities');
  const expected=new Set(CELL_SPECS.map(key));if(cells.some(cell=>!expected.has(key(cell)))||CELL_SPECS.some(cell=>!cells.some(other=>key(cell)===key(other))))throw new Error('BLOCKED_STAGE3_CAPTURE_COVERAGE: cell identities differ');
  return cells;
}
function freshLedger(identity,cells=CELL_SPECS){
  const states={};for(const cell of exactCells(cells)){const id=key(cell);states[id]={state:'PENDING',identity:cell,relativePath:`cells/${id.replaceAll(':','-')}.json`,sha256:null};}
  return {schemaVersion:1,executionId:identity.executionId,identity,authorizedCellCount:CELL_COUNT,accounting:{renderCalls:0},cells:states};
}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells||{}).filter(cell=>cell.state===state).length]));}
function readDualJson(roots,relative){return JSON.parse(durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.toString('utf8'));}
function writeDualJson(roots,relative,value){return durable.writeDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),jsonBytes(value));}
function writeImmutableDual(roots,relative,bytes){
  const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: partial immutable ${relative}`);
    const stored=durable.verifyDualCopy(a,b);if(!stored.bytes.equals(data))throw new Error(`BLOCKED_STAGE3_PRODUCTION_IDENTITY: immutable ${relative} changed`);return stored;
  }
  return durable.writeDualCopy(a,b,data);
}
function ensureExecutionManifest(roots,{identity,regressionSha,snapshot,now=()=>new Date().toISOString()}={}){
  const relative='execution-manifest.json',a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
  const expected={schemaVersion:1,identity,regressionResultsSha256:regressionSha,buildSnapshotSha256:sha256(jsonBytes(snapshot)),authorizedCellCount:CELL_COUNT};
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: partial execution manifest');
    const stored=readDualJson(roots,relative);for(const [key,value] of Object.entries(expected))if(!same(stored[key],value))throw new Error(`BLOCKED_STAGE3_PRODUCTION_IDENTITY: execution manifest ${key} changed`);
    return stored;
  }
  const manifest={...expected,createdAt:now()};writeImmutableDual(roots,relative,jsonBytes(manifest));return manifest;
}
function buildSnapshot(root=ROOT){
  const build=buildRoot(root),cache=path.join(build,'CMakeCache.txt'),toolchain=path.join(root,'wasm/cmake/wasm32-clang.cmake');
  if(!fs.existsSync(cache)||!fs.existsSync(toolchain))throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: CMake cache/toolchain snapshot is unavailable');
  const cacheBytes=fs.readFileSync(cache),toolchainBytes=fs.readFileSync(toolchain);
  return {buildDirectory:build,cmakeCacheSha256:sha256(cacheBytes),cmakeCacheBytes:cacheBytes.toString('base64'),
    toolchainPath:path.relative(root,toolchain),toolchainSha256:sha256(toolchainBytes),
    wasmSha256:fileSha(wasmPath(root)),wasmRelativePath:path.relative(root,wasmPath(root))};
}
function loadLedger(roots,identity,{create=false,cells=CELL_SPECS}={}){
  const a=path.join(roots.primary,'ledger.json'),b=path.join(roots.secondary,'ledger.json');
  if(!fs.existsSync(a)&&!fs.existsSync(b)){if(!create)throw new Error('BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: ledger missing');const fresh=freshLedger(identity,cells);writeDualJson(roots,'ledger.json',fresh);return fresh;}
  const ledger=readDualJson(roots,'ledger.json');if(!same(ledger.identity,identity)||ledger.authorizedCellCount!==CELL_COUNT||Object.keys(ledger.cells||{}).length!==CELL_COUNT)throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: ledger identity/coverage mismatch');
  const busy=Object.entries(ledger.cells).filter(([,state])=>state.state==='IN_PROGRESS');if(busy.length)throw new Error(`BLOCKED_STAGE3_AMBIGUOUS_RENDER_ACCOUNTING: ${busy.map(([id])=>id).join(',')}`);
  for(const cell of exactCells(cells)){const state=ledger.cells[key(cell)];if(!state||!same(state.identity,cell))throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: unauthorized ${key(cell)}`);if(state.state==='COMPLETE'){const row=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(row.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: cell hash mismatch ${key(cell)}`);const payload=JSON.parse(row.bytes.toString('utf8'));if(!same(payload.identity,identity)||!same(payload.cell,cell))throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: cell identity mismatch ${key(cell)}`);}}
  return ledger;
}
function persistLedger(roots,ledger){writeDualJson(roots,'ledger.json',ledger);}
function validateRegressionResults(results){
  for(const name of REQUIRED_REGRESSIONS)if(results?.[name]?.result!=='PASS')throw new Error(`BLOCKED_STAGE3_REGRESSION_RESULTS: ${name} is not PASS`);
  return {names:REQUIRED_REGRESSIONS,result:'PASS'};
}
function captureOne(root,cell){
  const out=capture.captureMatrix({cells:[{pitch:cell.pitch,velocity:cell.velocity}],parameters:{}});
  if(out.matrix.length!==1)throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: capture returned ${out.matrix.length} rows for ${key(cell)}`);
  return {pitch:cell.pitch,velocity:cell.velocity,metrics:out.matrix[0].metrics};
}
function assertSafe(row){const m=row?.metrics;if(m?.finite!==true||(m.outputGuardHits??0)!==0||!Number.isFinite(m.peakDbfs)||m.peakDbfs>=0||!Number.isFinite(m.fullRenderPeakDbfs)||m.fullRenderPeakDbfs>=0)throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_SAFETY: ${row?.cell?.kind}:${row?.cell?.pitch}:${row?.cell?.velocity}`);}
function execute({root=ROOT,roots,identity,ledger,cells=CELL_SPECS,render=captureOne,identityNow,assertAuthorization,now=()=>new Date().toISOString()}={}){
  let calls=0;
  for(const cell of exactCells(cells)){
    const state=ledger.cells[key(cell)];if(state.state==='COMPLETE')continue;if(state.state!=='PENDING')throw new Error(`BLOCKED_STAGE3_AMBIGUOUS_RENDER_ACCOUNTING: ${key(cell)}`);
    if(!same(identityNow(),identity))throw new Error(`BLOCKED_STAGE3_PRODUCTION_IDENTITY: drift before ${key(cell)}`);
    if(assertAuthorization)assertAuthorization();
    state.state='IN_PROGRESS';state.startedAt=now();persistLedger(roots,ledger);
    const measured=render(root,cell);const row={schemaVersion:1,cell,identity,pitch:measured.pitch,velocity:measured.velocity,metrics:measured.metrics,capturedAt:now()};assertSafe(row);
    const written=durable.writeDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath),jsonBytes(row));
    state.state='COMPLETE';state.sha256=written.sha256;state.completedAt=now();ledger.accounting.renderCalls++;calls++;persistLedger(roots,ledger);
  }
  return {calls,...counts(ledger)};
}
function readRows(roots,ledger,cells=CELL_SPECS){return exactCells(cells).map(cell=>{const state=ledger.cells[key(cell)];if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: incomplete ${key(cell)}`);const stored=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(stored.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: hash mismatch ${key(cell)}`);const row=JSON.parse(stored.bytes.toString('utf8'));assertSafe(row);return row;});}
function buildEvaluation(fixture,rows,regressions){
  const directRows=rows.filter(row=>row.cell.kind==='direct').map(row=>({pitch:row.pitch,velocity:row.velocity,metrics:row.metrics}));
  const sentinelRows=rows.filter(row=>row.cell.kind==='sentinel').map(row=>({pitch:row.pitch,velocity:row.velocity,metrics:row.metrics}));
  const directEval=direct.evaluateDirect(fixture,{matrix:directRows});const by=new Map(directRows.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const sentinel=sentinelRows.map(row=>({pitch:row.pitch,velocity:row.velocity,...direct.compareSentinelMetrics(by.get(`${row.pitch}:${row.velocity}`),row)}));
  const deterministic=sentinel.every(row=>row.pass),regressionsPass=REQUIRED_REGRESSIONS.every(name=>regressions[name]?.result==='PASS');
  const decision=direct.selectStage3Decision({deterministic,directPass:directEval.pass,regressionsPass});
  return {schemaVersion:1,decision,coverage:{directCells:directRows.length,sentinels:sentinelRows.length,total:rows.length},
    direct:{pass:directEval.pass,counts:directEval.counts,metrics:directEval.direct.metrics,diagnostics:directEval.diagnostics},sentinel:{pass:deterministic,tolerance:TOLERANCE,rows:sentinel},
    independentRegressions:regressions,productionCandidateDelta:0,stage4Renders:0};
}
function verifyFinalized(roots,identity){
  const file=durable.verifyDualCopy(path.join(roots.primary,'stage3-result.json'),path.join(roots.secondary,'stage3-result.json'));
  const result=JSON.parse(file.bytes.toString('utf8'));if(!same(result.identity,identity))throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: finalized result identity mismatch');
  return {result,sha256:file.sha256};
}
function finalize({roots,identity,ledger,fixture,regressions,now=()=>new Date().toISOString()}={}){
  const rows=readRows(roots,ledger),evaluated=buildEvaluation(fixture,rows,regressions),countsNow=counts(ledger);
  if(countsNow.PENDING!==0||countsNow.IN_PROGRESS!==0||countsNow.COMPLETE!==CELL_COUNT)throw new Error('BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: finalization requires 486 complete rows');
  const existingA=path.join(roots.primary,'stage3-result.json'),existingB=path.join(roots.secondary,'stage3-result.json');
  let result,output;
  if(fs.existsSync(existingA)||fs.existsSync(existingB)){
    const stored=verifyFinalized(roots,identity);result=stored.result;
    if(!same(result.evaluation,evaluated)||result.renderCalls!==ledger.accounting.renderCalls||result.authorizedRenderCount!==CELL_COUNT)
      throw new Error('BLOCKED_STAGE3_DIAGNOSTIC_EVIDENCE: finalized result changed');
    output={sha256:stored.sha256};
  }else{
    result={schemaVersion:1,identity,renderCalls:ledger.accounting.renderCalls,authorizedRenderCount:CELL_COUNT,evaluation:evaluated,completedAt:now()};
    output=writeDualJson(roots,'stage3-result.json',result);
  }
  const startedAt=ledger.startedAt||result.completedAt||now();
  durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.sourceRevision,executionId:identity.executionId,generation:identity.executionId,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.wasmSha256,startedAt,finalizedAt:result.completedAt||now(),decision:evaluated.decision}});
  const archive=durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase:'stage3'});
  return {decision:evaluated.decision,builds:0,renders:0,acousticRenders:0,...countsNow,resultSha256:output.sha256,archiveSha256:archive.sha256,evaluation:evaluated};
}
function assertExecutionInputs({root,home,roots,identity,regressionPath,regressionSha,snapshot,regressionSummary}={}){
  const selection=selectedResponse(root,home);assertSourceAncestor(root,identity.sourceRevision);
  const current=currentIdentity({root,roots,selected:selection,sourceRevision:identity.sourceRevision});
  if(!same(current,identity))throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: selected response/build identity changed');
  if(!regressionPath||fileSha(path.resolve(regressionPath))!==regressionSha)
    throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: source regression evidence changed');
  const storedIdentity=readDualJson(roots,'identity.json');
  if(!same(storedIdentity.regressions,regressionSummary)||storedIdentity.regressionResultsSha256!==regressionSha
      ||storedIdentity.productionWasmArtifactSha256!==identity.wasmSha256)
    throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: persisted execution identity changed');
  const regression=durable.verifyDualCopy(path.join(roots.primary,'regression-results.json'),path.join(roots.secondary,'regression-results.json'));
  if(regression.sha256!==regressionSha)throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: persisted regression evidence changed');
  const storedSnapshot=readDualJson(roots,'build-snapshot.json');
  if(!same(storedSnapshot,snapshot)||!same(buildSnapshot(root),snapshot))throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: CMake cache/toolchain snapshot changed');
  const manifest=readDualJson(roots,'execution-manifest.json');
  if(!same(manifest.identity,identity)||manifest.regressionResultsSha256!==regressionSha
      ||manifest.buildSnapshotSha256!==sha256(jsonBytes(snapshot))||manifest.authorizedCellCount!==CELL_COUNT)
    throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: execution manifest changed');
  return true;
}
function loadFinalizationInputs({root,roots,identity}={}){
  const storedIdentity=readDualJson(roots,'identity.json');
  for(const [name,value] of Object.entries(identity))if(!same(storedIdentity[name],value))throw new Error(`BLOCKED_STAGE3_PRODUCTION_IDENTITY: persisted ${name} changed`);
  const artifact=durable.verifyDualCopy(path.join(roots.primary,'artifacts/production-plugin.wasm'),path.join(roots.secondary,'artifacts/production-plugin.wasm'));
  if(artifact.sha256!==identity.wasmSha256)throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: preserved production WASM changed');
  const regressionFile=durable.verifyDualCopy(path.join(roots.primary,'regression-results.json'),path.join(roots.secondary,'regression-results.json'));
  if(regressionFile.sha256!==storedIdentity.regressionResultsSha256)throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: persisted regression hash mismatch');
  const regressions=JSON.parse(regressionFile.bytes.toString('utf8'));validateRegressionResults(regressions);
  const snapshot=readDualJson(roots,'build-snapshot.json');
  if(!same(snapshot,buildSnapshot(root)))throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: build cache/toolchain changed');
  const manifest=readDualJson(roots,'execution-manifest.json');
  if(!same(manifest.identity,identity)||manifest.regressionResultsSha256!==regressionFile.sha256
      ||manifest.buildSnapshotSha256!==sha256(jsonBytes(snapshot))||manifest.authorizedCellCount!==CELL_COUNT)
    throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: execution manifest mismatch');
  return regressions;
}
function run({mode,root=ROOT,home=process.env.HOME,executionId=process.env.SORAOTO_STAGE3_EXECUTION_ID||'authoritative',regressionResultsPath=process.env.SORAOTO_STAGE3_REGRESSION_RESULTS,render=captureOne,now=()=>new Date().toISOString()}={}){
  if(!['--dry-run','--execute','--finalize'].includes(mode))throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
  direct.validateReferenceFixture(fixture);
  const selection=selectedResponse(root,home),roots=stage3Roots(root,home,executionId),sourceRevision=sourceRevisionForRun({root,roots,mode});
  const identity=currentIdentity({root,roots,selected:selection,sourceRevision});
  const wasm=wasmPath(root);if(!fs.existsSync(wasm))throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: production SIMD artifact is missing');
  if(mode==='--dry-run')return {decision:'STAGE3_DRY_RUN_READY',builds:0,renders:0,acousticRenders:0,authorizedRenderCount:CELL_COUNT,identity};
  if(mode==='--execute'){
    if(!regressionResultsPath||!fs.existsSync(path.resolve(regressionResultsPath)))throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: --execute requires persisted six-regression PASS result');
    const regression=JSON.parse(fs.readFileSync(path.resolve(regressionResultsPath),'utf8'));validateRegressionResults(regression);
    for(const destination of [roots.primary,roots.secondary])fs.mkdirSync(destination,{recursive:true,mode:0o700});
    const snapshot=buildSnapshot(root),regressionPath=path.resolve(regressionResultsPath),regressionBytes=fs.readFileSync(regressionPath),regressionSha=sha256(regressionBytes);
    const artifact=writeImmutableDual(roots,'artifacts/production-plugin.wasm',fs.readFileSync(wasm));
    const regressionSummary=validateRegressionResults(regression);
    writeImmutableDual(roots,'identity.json',jsonBytes({...identity,productionWasmArtifactSha256:artifact.sha256,regressions:regressionSummary,regressionResultsSha256:regressionSha}));
    writeImmutableDual(roots,'regression-results.json',regressionBytes);
    writeImmutableDual(roots,'build-snapshot.json',jsonBytes(snapshot));
    ensureExecutionManifest(roots,{identity,regressionSha,snapshot,now});
    const ledger=loadLedger(roots,identity,{create:true});
    if(!ledger.startedAt){ledger.startedAt=now();persistLedger(roots,ledger);}
    const result=execute({root,roots,identity,ledger,render,identityNow:()=>currentIdentity({root,roots,selected:selectedResponse(root,home),sourceRevision}),
      assertAuthorization:()=>assertExecutionInputs({root,home,roots,identity,regressionPath,regressionSha,snapshot,regressionSummary}),now});
    return {decision:'STAGE3_CAPTURE_IN_PROGRESS',builds:0,renders:result.calls,acousticRenders:result.calls,...counts(ledger),authorizedRenderCount:CELL_COUNT};
  }
  const regression=loadFinalizationInputs({root,roots,identity}),ledger=loadLedger(roots,identity,{create:false});
  return finalize({roots,identity,ledger,fixture,regressions:regression,now});
}
function main(argv=process.argv.slice(2)){
  const args=[...argv];if(args.length<1)throw new Error('explicit mode required');const mode=args.shift();let regressionResultsPath=null;
  if(args.length===2&&args[0]==='--regressions')regressionResultsPath=args[1];else if(args.length)throw new Error('Usage: run-stage3-production-recovery.cjs --dry-run | --execute --regressions <results.json> | --finalize');
  const result=run({mode,regressionResultsPath});process.stdout.write(JSON.stringify(result)+'\n');if(mode==='--finalize'&&result.decision!=='STAGE3_READY_FOR_STAGE4')process.exitCode=2;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={ROOT,WASM_RELATIVE,ISSUE,TASK,CELL_COUNT,TOLERANCE,REQUIRED_REGRESSIONS,CELL_SPECS,sha256,fileSha,key,jsonBytes,same,stage3Roots,buildRoot,wasmPath,selectedResponse,currentIdentity,assertSourceAncestor,sourceRevisionForRun,exactCells,freshLedger,counts,readDualJson,writeDualJson,writeImmutableDual,buildSnapshot,ensureExecutionManifest,loadLedger,persistLedger,validateRegressionResults,captureOne,assertSafe,execute,readRows,buildEvaluation,verifyFinalized,finalize,assertExecutionInputs,loadFinalizationInputs,run,main};
