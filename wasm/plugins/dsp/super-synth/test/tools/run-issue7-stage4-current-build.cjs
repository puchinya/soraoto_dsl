'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const core=require('./issue7-current-build-core.cjs');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');
const evaluator=require('./stage4-full-range-evaluator.cjs');
const stage3=require('./run-issue7-stage3-current-build.cjs');
const generation=require('./stage3e-generation2-core.cjs');

const ROOT=core.ROOT;
const STAGE='stage4';
const PHASE='stage4';
const AUTH_REL='.agent-state/issues/7/current-build-v1/authorizations/stage4-execute.json';
const IDENTITY_REL='docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json';
const CAPTURE_REL='wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage4-lifecycle.cjs';
const EVALUATOR_REL='wasm/plugins/dsp/super-synth/test/tools/stage4-full-range-evaluator.cjs';
const COMPARISON_REL='wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs';
const RUNNER_REL='wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.cjs';
const OUTPUT_FIELDS=Object.freeze(generation.BASELINE_METRIC_FIELDS.filter(name=>!['fullRenderPeakDbfs','finite','outputGuardHits'].includes(name)));
const CELL_SPECS=Object.freeze([
  ...capture.LIFECYCLE_CELLS.map(cell=>Object.freeze({...cell,key:capture.key(cell)})),
  ...capture.REPEAT_CELLS.map(cell=>Object.freeze({...cell,key:capture.key(cell)}))
]);

function fileSha(root,relative){return core.sha256(fs.readFileSync(path.join(root,relative)));}
function identityRecord(root=ROOT){return JSON.parse(fs.readFileSync(path.join(root,IDENTITY_REL),'utf8'));}
function authPath(root=ROOT){return path.join(root,AUTH_REL);}
function readAuthorization(root,provided){
  if(provided!==undefined)return {authorization:provided,bytes:core.canonicalBytes(provided),sha256:core.sha256(core.canonicalBytes(provided))};
  return core.readAuthorization(root,{path:authPath(root)});
}
function buildDirectory(root,record){
  const item=record.builds?.stage4;if(!item)throw new Error('BLOCKED_STAGE4_BUILD_IDENTITY: Stage4 diagnostic build is missing');
  return path.resolve(root,item.buildDirectory);
}
function stage4Wasm(root,record){
  const item=record.builds?.stage4;
  if(!item?.wasm?.path)throw new Error('BLOCKED_STAGE4_BUILD_IDENTITY: Stage4 diagnostic WASM identity is missing');
  return path.join(buildDirectory(root,record),item.wasm.path);
}
function assertStage4Exports(root,record){
  const module=new WebAssembly.Module(fs.readFileSync(stage4Wasm(root,record)));
  const names=WebAssembly.Module.exports(module).map(item=>item.name);
  for(const name of ['soraoto_plugin_abi_version','soraoto_plugin_init','soraoto_plugin_process','soraoto_plugin_terminate',
    'soraoto_supersynth_guard_hit_count','soraoto_supersynth_active_voice_count'])
    if(!names.includes(name))throw new Error(`BLOCKED_STAGE4_BUILD_IDENTITY: Stage4 export missing ${name}`);
  if(names.some(name=>name.includes('stage3e_')))throw new Error('BLOCKED_STAGE4_BUILD_IDENTITY: Stage4 build contains Stage3E response controls');
  return names.sort();
}
function readStage3(root=ROOT,home=os.homedir(),epoch=core.EPOCH){
  const roots=core.resolveRoots(root,'stage3',epoch,{home});
  let final,artifact,prepared,derived;
  try{
    final=core.readFinal(roots,'stage3');
    artifact=core.readDualBytes(roots,'artifacts/production-plugin.wasm');
    prepared=stage3.prepare({root,home,epoch});
    derived=core.readDualJson(roots,stage3.DERIVED_IDENTITY_REL);
  }catch(error){throw new Error(`BLOCKED_STAGE4_STAGE3_REQUIRED: ${error.message}`);}
  if(final.result.decision!=='STAGE3_READY_FOR_STAGE4')throw new Error('BLOCKED_STAGE4_STAGE3_REQUIRED: Stage3 did not reach STAGE3_READY_FOR_STAGE4');
  if(final.result.summary?.syntheticTest===true||!core.same(final.result.identity,prepared.identity))
    throw new Error('BLOCKED_STAGE4_STAGE3_IDENTITY: finalized Stage3 identity differs from current production inputs');
  if(!core.same(derived,prepared.derivedBuildIdentity)||final.result.identity.productionBuildIdentitySha256!==prepared.productionBuildIdentitySha256)
    throw new Error('BLOCKED_STAGE4_STAGE3_IDENTITY: immutable derived production identity differs');
  const expected=final.result.identity.builds?.production?.wasmSha256;
  if(!expected||artifact.sha256!==expected||expected!==prepared.derivedBuildIdentity.builds.production.wasm.sha256)
    throw new Error('BLOCKED_STAGE4_STAGE3_IDENTITY: preserved Stage3 production WASM does not match the current identity');
  return {roots,final,artifact,prepared,derived,stage3Identity:{resultSha256:final.sha256,identity:final.result.identity}};
}
function currentIdentity({root=ROOT,home=os.homedir(),epoch=core.EPOCH,record=identityRecord(root),stage3State}={}){
  const completed=stage3State||readStage3(root,home,epoch);
  const derived=completed.prepared.derivedBuildIdentity;
  return {issue:7,epoch,stage:STAGE,sourceCommit:record.sourceCommit,buildIdentitySha256:derived.parentBuildIdentitySha256,
    toolchain:record.toolchain,inputs:derived.inputs,builds:completed.prepared.identity.builds,
    productionBuildIdentitySha256:completed.prepared.productionBuildIdentitySha256,
    stage3ResultSha256:completed.final.sha256,stage3Identity:completed.final.result.identity,
    productionWasmSha256:derived.builds.production.wasm.sha256,stage4WasmSha256:derived.builds.stage4.wasm.sha256,
    captureHelperSha256:fileSha(root,CAPTURE_REL),evaluatorSha256:fileSha(root,EVALUATOR_REL),
    outputComparisonHelperSha256:fileSha(root,COMPARISON_REL),runnerSha256:fileSha(root,RUNNER_REL)};
}
function cells(){
  if(capture.LIFECYCLE_CELLS.length!==1408||capture.REPEAT_CELLS.length!==15||CELL_SPECS.length!==1423)
    throw new Error('BLOCKED_STAGE4_CELL_SET: exact 1,408 lifecycle and 15 repeat cells are required');
  if(new Set(CELL_SPECS.map(cell=>cell.key)).size!==1423)throw new Error('BLOCKED_STAGE4_CELL_SET: duplicate lifecycle/repeat key');
  return CELL_SPECS.map(cell=>({...cell,phase:PHASE,buildRole:'stage4'}));
}
function phaseManifest({root,record,identity,authorizationSha256,phaseCells,now}){
  return {schemaVersion:1,issue:7,epoch:core.EPOCH,stage:STAGE,phase:PHASE,candidateId:`issue7-${core.EPOCH}-stage4`,
    creatorCommit:require('node:child_process').execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    referenceFixtureSha256:record.inputs.referenceMetrics.sha256,sourcePluginSha256:record.inputs.pluginC.sha256,
    presetsSha256:record.inputs.presets.sha256,profileSha256:record.inputs.generatedProfile.sha256,
    captureHelperSha256:identity.captureHelperSha256,evaluatorSha256:identity.evaluatorSha256,
    outputComparisonHelperSha256:identity.outputComparisonHelperSha256,runnerSha256:identity.runnerSha256,
    builds:identity.builds,identity,stage3ResultSha256:identity.stage3ResultSha256,stage3IdentitySha256:core.sha256(core.canonicalBytes(identity.stage3Identity)),
    productionWasmSha256:identity.productionWasmSha256,stage4WasmSha256:identity.stage4WasmSha256,
    authorizationSha256,authorizedCellKeys:phaseCells.map(cell=>cell.key),renderBudget:phaseCells.length,createdAt:now()};
}
function withStage4Build(root,record,action){
  const key='SORAOTO_WASM_BUILD_DIR',prior=process.env[key];process.env[key]=buildDirectory(root,record);
  try{return action();}finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
}
function renderDefault({root=ROOT,record,cell}={}){
  return withStage4Build(root,record,()=>capture.captureLifecycleCell({pitch:cell.pitch,velocity:cell.velocity,repoRoot:root}));
}
function readRows(roots,phaseCells){
  const rows=phaseCells.map(cell=>{
    const stored=core.readCell(roots,PHASE,cell.key);
    if(stored.cell.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE4_PHASE_INCOMPLETE: ${cell.key}`);
    const row=stored.observation.observation;
    if(row.pitch!==cell.pitch||row.velocity!==cell.velocity)throw new Error(`BLOCKED_STAGE4_CELL_IDENTITY: ${cell.key}`);
    return {...row,kind:cell.kind};
  });
  return {matrix:rows.filter(row=>row.kind==='lifecycle'),repeats:rows.filter(row=>row.kind==='repeat')};
}
function safeLegacyConformance({root,roots,document}={}){
  const relative='lifecycle-capture.json';
  core.writeImmutableDual(roots,relative,core.canonicalBytes(document));
  const matrixPath=core.dualPaths(roots,relative).primary;
  const env={...process.env,SUPERSYNTH_LIFECYCLE_PATH:path.resolve(matrixPath),SUPERSYNTH_REPORT_DIR:''};
  const result=spawnSync('rtk',['node',evaluator.LEGACY_TEST],{cwd:root,encoding:'utf8',env});
  return {pass:result.status===0,status:result.status,stdout:(result.stdout||'').trim(),stderr:(result.stderr||'').trim()};
}
function compareMetric(expected,actual,pathName,differences,maxDifference,tolerance=1e-6){
  if(typeof expected==='number'&&typeof actual==='number'){
    if(!Number.isFinite(expected)||!Number.isFinite(actual)){differences.push(`${pathName}: non-finite`);return;}
    const delta=Math.abs(expected-actual);maxDifference.value=Math.max(maxDifference.value,delta);
    if(delta>tolerance)differences.push(`${pathName}: delta ${delta}`);
    return;
  }
  if(Array.isArray(expected)||Array.isArray(actual)){
    if(!Array.isArray(expected)||!Array.isArray(actual)||expected.length!==actual.length){differences.push(`${pathName}: array shape mismatch`);return;}
    expected.forEach((value,index)=>compareMetric(value,actual[index],`${pathName}[${index}]`,differences,maxDifference,tolerance));return;
  }
  if(expected!==actual)differences.push(`${pathName}: value mismatch`);
}
function compareStage3Output(stage3Rows,matrix,{tolerance=1e-6}={}){
  const actual=new Map(matrix.map(row=>[`${row.pitch}:${row.velocity}`,row])),differences=[],maxDifference={value:0};
  if(stage3Rows.length!==486)differences.push(`Stage3 coverage ${stage3Rows.length}/486`);
  for(const source of stage3Rows){
    const row=actual.get(`${source.pitch}:${source.velocity}`);
    if(!row){differences.push(`missing Stage4 output ${source.pitch}:${source.velocity}`);continue;}
    for(const field of OUTPUT_FIELDS){
      if(!(field in (source.metrics||{}))||!(field in (row.metrics||{}))){differences.push(`${source.pitch}:${source.velocity}.${field}: missing`);continue;}
      compareMetric(source.metrics[field],row.metrics[field],`${source.pitch}:${source.velocity}.${field}`,differences,maxDifference,tolerance);
    }
  }
  return {pass:differences.length===0,comparedCells:stage3Rows.length,tolerance,maximumDifference:maxDifference.value,differences:differences.slice(0,100)};
}
function evaluate({root,roots,identity,stage3Identity,matrix,repeats,stage3Rows}={}){
  const summary=evaluator.evaluate({root,identity,stage3Identity,matrix,repeats,legacyMatrixPath:core.dualPaths(roots,'lifecycle-capture.json').primary,
    legacy:({document})=>safeLegacyConformance({root,roots,document})});
  const outputEquivalence=compareStage3Output(stage3Rows,matrix);
  summary.outputEquivalence=outputEquivalence;
  if(!outputEquivalence.pass)summary.decision='BLOCKED_STAGE4_OUTPUT_EQUIVALENCE';
  return summary;
}
function authCheck(root,authorization){
  const phaseCells=cells(),record=readAuthorization(root,authorization),approved=record?.authorization;
  if(!approved)throw new Error('AUTHORIZATION_REQUIRED: Issue #7 approval for the exact 1,423 Stage4 cells is required');
  const validated=core.validateAuthorization(approved,{stage:STAGE,phase:PHASE,cells:phaseCells.map(cell=>cell.key),renderBudget:1423});
  return {phaseCells,approved,validated};
}
function execute({root=ROOT,home=os.homedir(),epoch=core.EPOCH,authorization,render=renderDefault,now=()=>new Date().toISOString(),
  githubReadback=core.readGitHubApproval}={}){
  const checked=authCheck(root,authorization),roots=core.resolveRoots(root,STAGE,epoch,{home});
  return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>executeLocked({root,home,epoch,render,now,roots,githubReadback,...checked}));
}
function executeLocked({root,home,epoch,render,now,roots,phaseCells,approved,validated,githubReadback=core.readGitHubApproval}={}){
  const record=identityRecord(root),stage3State=readStage3(root,home,epoch),identity=currentIdentity({root,home,epoch,record,stage3State});
  const verified=core.verifyAndPersistAuthorization(approved,{roots,stage:STAGE,phase:PHASE,cells:phaseCells.map(cell=>cell.key),renderBudget:1423,
    readback:details=>githubReadback({...details,root})});
  const exports=assertStage4Exports(root,record),previous=core.readPhaseLedger(roots,PHASE);
  const manifest=phaseManifest({root,record:stage3State.prepared.productionRecord,identity,authorizationSha256:verified.sha256,phaseCells,
    now:previous?.manifest.createdAt?()=>previous.manifest.createdAt:now});
  core.initializePhase({roots,phase:PHASE,manifest,cells:phaseCells,renderBudget:1423,now});
  core.writeImmutableDual(roots,'execution-identity.json',core.canonicalBytes(identity));
  core.writeImmutableDual(roots,'production-build-identity.json',core.canonicalBytes(stage3State.derived));
  core.writeImmutableDual(roots,'artifacts/stage3-production-plugin.wasm',stage3State.artifact.bytes);
  core.writeImmutableDual(roots,'artifacts/stage4-diagnostic-plugin.wasm',fs.readFileSync(stage4Wasm(root,record)));
  let calls=0,unsafe=false;
  for(const cell of phaseCells){
    const existing=core.readCell(roots,PHASE,cell.key);
    if(existing.cell.state==='COMPLETE')continue;
    const started=core.startCell({roots,phase:PHASE,cellKey:cell.key,cell,identity,
      identityNow:()=>currentIdentity({root,home,epoch,record:identityRecord(root),stage3State:readStage3(root,home,epoch)}),now});
    if(started.skipped)continue;
    calls+=1;
    let observed;
    try{observed=render({root,record,identity,cell,authorization:approved});}
    catch(error){
      try{core.markAmbiguous({roots,phase:PHASE,cellKey:cell.key,reason:error.message,now});}catch{}
      throw new Error(`BLOCKED_STAGE4_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}; started=${calls}; ${error.message}`);
    }
    if(!observed||typeof observed!=='object'){
      try{core.markAmbiguous({roots,phase:PHASE,cellKey:cell.key,reason:'render returned no observation',now});}catch{}
      throw new Error(`BLOCKED_STAGE4_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}; started=${calls}; no observation returned`);
    }
    const row={...observed,kind:cell.kind,...(validated.syntheticTest?{syntheticTest:true,label:'SYNTHETIC TEST'}:{})};
    const completed=core.completeCell({roots,phase:PHASE,cellKey:cell.key,observation:row,now});
    if(completed.decision==='FAIL'){unsafe=true;break;}
  }
  const ledger=core.readPhaseLedger(roots,PHASE).ledger,count=Object.values(ledger.cells).filter(cell=>cell.state==='COMPLETE').length;
  if(unsafe||count!==1423)return {decision:unsafe?'BLOCKED_STAGE4_UNSAFE_OBSERVATION':'BLOCKED_STAGE4_PHASE_INCOMPLETE',phase:PHASE,calls,renderCount:ledger.renderCount,completeCells:count,acousticRenders:calls,exports};
  const {matrix,repeats}=readRows(roots,phaseCells),stage3Identity=stage3State.stage3Identity;
  const stage3Rows=stage3.readRows(stage3State.roots,stage3.cells());
  const summary=evaluate({root,roots,identity,stage3Identity,matrix,repeats,stage3Rows});
  if(validated.syntheticTest)summary.syntheticTest=true;
  const result=core.finalizePhase({roots,phase:PHASE,decision:summary.decision,summary,now});
  return {decision:result.result.decision,phase:PHASE,calls,renderCount:result.result.renderCount,completeCells:count,
    summary,resultSha256:result.sha256,archiveSha256:result.archiveSha256,syntheticTest:validated.syntheticTest,acousticRenders:calls,exports};
}
function run({mode,root=ROOT,home=os.homedir(),epoch=core.EPOCH,authorization,render=renderDefault,
  now=()=>new Date().toISOString(),githubReadback=core.readGitHubApproval}={}){
  if(!['dry-run','execute','finalize','verify'].includes(mode))throw new Error('explicit mode required: dry-run, execute, finalize, or verify');
  if(mode==='execute')return execute({root,home,epoch,authorization,render,now,githubReadback});
  const roots=core.resolveRoots(root,STAGE,epoch,{home});
  if(mode==='verify'){
    const final=core.readFinal(roots,PHASE);
    const current=currentIdentity({root,home,epoch,record:identityRecord(root)});
    core.checkFrozenIdentity(final.result.identity,current);
    return {decision:final.result.decision,phase:PHASE,resultSha256:final.sha256,archiveSha256:final.archiveSha256,
      renderCount:final.result.renderCount,builds:0,renders:0,writes:0,acousticRenders:0};
  }
  if(mode==='finalize'){
    return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>{
      const final=core.readFinal(roots,PHASE);
      const current=currentIdentity({root,home,epoch,record:identityRecord(root)});
      core.checkFrozenIdentity(final.result.identity,current);
      return {decision:final.result.decision,phase:PHASE,resultSha256:final.sha256,archiveSha256:final.archiveSha256,
        renderCount:final.result.renderCount,builds:0,renders:0,writes:0,acousticRenders:0};
    });
  }
  try{
    const record=identityRecord(root),stage3State=readStage3(root,home,epoch),identity=currentIdentity({root,home,epoch,record,stage3State});
    const exports=assertStage4Exports(root,record);
    return {decision:'STAGE4_DRY_RUN_READY',phase:PHASE,identitySha256:core.sha256(core.canonicalBytes(identity)),
      lifecycleCells:1408,repeatCells:15,adjacentComparisons:1392,builds:0,renders:0,writes:0,acousticRenders:0,exports};
  }catch(error){
    return {decision:error.message.split(':')[0],reason:error.message,phase:PHASE,lifecycleCells:1408,repeatCells:15,
      adjacentComparisons:1392,builds:0,renders:0,writes:0,acousticRenders:0};
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
  if(/^AUTHORIZATION_REQUIRED|^BLOCKED_/.test(result.decision||''))process.exitCode=2;
  return result;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=/^AUTHORIZATION_REQUIRED/.test(error.message)?2:1;}}

module.exports={ROOT,STAGE,PHASE,AUTH_REL,CELL_SPECS,fileSha,identityRecord,authPath,readAuthorization,
  buildDirectory,stage4Wasm,assertStage4Exports,readStage3,currentIdentity,cells,phaseManifest,renderDefault,readRows,
  safeLegacyConformance,OUTPUT_FIELDS,compareMetric,compareStage3Output,evaluate,authCheck,execute,executeLocked,run,parseMode,main};
