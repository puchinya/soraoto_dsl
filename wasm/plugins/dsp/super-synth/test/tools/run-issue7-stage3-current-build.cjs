'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const core=require('./issue7-current-build-core.cjs');
const capture=require('./capture-supersynth-matrix.cjs');
const evaluator=require('./run-stage3-production-recovery.cjs');
const direct=require('./stage3-direct-reference-metrics.cjs');

const ROOT=core.ROOT;
const STAGE='stage3';
const PHASE='stage3';
const AUTH_REL='.agent-state/issues/7/current-build-v1/authorizations/stage3-execute.json';
const REGRESSION_REL='.agent-state/issues/7/current-build-v1/stage3-regression-results.json';
const IDENTITY_REL='docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json';
const FIXTURE_REL='wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json';
const SOURCE_REL='wasm/plugins/dsp/super-synth/src/plugin.c';
const PRESETS_REL='wasm/plugins/dsp/super-synth/presets.json';
const PROFILE_REL='wasm/shared/generated/super-synth_grand_profiles.h';
const CAPTURE_REL='wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs';
const EVALUATOR_REL='wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs';
const RUNNER_REL='wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs';
const REQUIRED_REGRESSIONS=Object.freeze([...evaluator.REQUIRED_REGRESSIONS]);
const CELL_SPECS=Object.freeze(evaluator.CELL_SPECS.map(cell=>Object.freeze({...cell,key:evaluator.key(cell)})));

function sha256(bytes){return core.sha256(bytes);}
function fileSha(root,relative){return sha256(fs.readFileSync(path.join(root,relative)));}
function identityRecord(root=ROOT){return JSON.parse(fs.readFileSync(path.join(root,IDENTITY_REL),'utf8'));}
function git(root,args){return execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8'}).trim();}
function isAncestor(root,ancestor){
  try{execFileSync('rtk',['git','merge-base','--is-ancestor',ancestor,'HEAD'],{cwd:root,stdio:'ignore'});return true;}
  catch{return false;}
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
  const module=new WebAssembly.Module(fs.readFileSync(productionWasm(root,record)));
  const names=WebAssembly.Module.exports(module).map(item=>item.name);
  if(names.some(name=>name.includes('stage3e_')))throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: production exports Stage3E diagnostic controls');
  for(const name of ['soraoto_plugin_abi_version','soraoto_plugin_init','soraoto_plugin_process','soraoto_plugin_terminate'])
    if(!names.includes(name))throw new Error(`BLOCKED_STAGE3_BUILD_IDENTITY: production export missing ${name}`);
  return names.sort();
}
function readSelection(root=ROOT,home=os.homedir(),epoch=core.EPOCH){
  const roots=core.resolveRoots(root,'stage3e',epoch,{home});
  let stored,final;
  try{
    stored=core.readDualBytes(roots,'selection.json');
    final=core.readFinal(roots,'mid-full');
  }catch(error){throw new Error(`BLOCKED_STAGE3E_SELECTION_REQUIRED: ${error.message}`);}
  const selection=JSON.parse(stored.bytes.toString('utf8'));
  if(selection.issue!==7||selection.epoch!==epoch||selection.decision!=='STAGE3E_SELECTED_RESPONSE'||selection.syntheticTest===true)
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
  const bytes=fs.readFileSync(file),results=JSON.parse(bytes.toString('utf8'));
  evaluator.validateRegressionResults(results);
  return {file,relative:rel,bytes,sha256:sha256(bytes),results};
}
function currentIdentity({root=ROOT,home=os.homedir(),epoch=core.EPOCH,record=identityRecord(root),selection,regressions,regressionPath=REGRESSION_REL}={}){
  const selected=selection||readSelection(root,home,epoch),regression=regressions||readRegressions(root,regressionPath);
  return {...core.hashInputs(root,record),issue:7,epoch,stage:STAGE,selectionSha256:selected.selectionSha256,
    selectedResponse:selected.tuple,stage3eResultSha256:selected.final.sha256,
    regressionResultsSha256:regression.sha256,regressions:evaluator.validateRegressionResults(regression.results),
    captureHelperSha256:fileSha(root,CAPTURE_REL),evaluatorSha256:fileSha(root,EVALUATOR_REL),runnerSha256:fileSha(root,RUNNER_REL)};
}
function cells(){
  if(CELL_SPECS.length!==486||CELL_SPECS.filter(cell=>cell.kind==='direct').length!==480||CELL_SPECS.filter(cell=>cell.kind==='sentinel').length!==6)
    throw new Error('BLOCKED_STAGE3_CELL_SET: canonical 486-cell set changed');
  if(new Set(CELL_SPECS.map(cell=>cell.key)).size!==486)throw new Error('BLOCKED_STAGE3_CELL_SET: duplicate cell key');
  return CELL_SPECS.map(cell=>({...cell,phase:PHASE,buildRole:'production'}));
}
function authPath(root=ROOT){return path.join(root,AUTH_REL);}
function readAuthorization(root,provided){
  if(provided!==undefined)return {authorization:provided,bytes:core.canonicalBytes(provided),sha256:sha256(core.canonicalBytes(provided))};
  return core.readAuthorization(root,{path:authPath(root)});
}
function phaseManifest({root,record,identity,authorizationSha256,now,cells:phaseCells}){
  return {schemaVersion:1,issue:7,epoch:core.EPOCH,stage:STAGE,phase:PHASE,
    creatorCommit:git(root,['rev-parse','HEAD']),candidateId:`issue7-${core.EPOCH}-stage3`,
    referenceFixtureSha256:record.inputs.referenceMetrics.sha256,sourcePluginSha256:record.inputs.pluginC.sha256,
    presetsSha256:record.inputs.presets.sha256,profileSha256:record.inputs.generatedProfile.sha256,
    captureHelperSha256:identity.captureHelperSha256,evaluatorSha256:identity.evaluatorSha256,runnerSha256:identity.runnerSha256,
    builds:identity.builds,identity,selectionSha256:identity.selectionSha256,stage3eResultSha256:identity.stage3eResultSha256,
    regressionResultsSha256:identity.regressionResultsSha256,primaryWasmSha256:record.builds.production.wasm.sha256,
    authorizationSha256,authorizedCellKeys:phaseCells.map(cell=>cell.key),renderBudget:phaseCells.length,createdAt:now()};
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
function prepare({root=ROOT,home=os.homedir(),epoch=core.EPOCH,regressionResultsPath=REGRESSION_REL}={}){
  const record=identityRecord(root),selected=readSelection(root,home,epoch),regressions=readRegressions(root,regressionResultsPath);
  assertPromotedValues(root,selected.tuple);
  const identity=currentIdentity({root,home,epoch,record,selection:selected,regressions,regressionPath:regressionResultsPath});
  const exports=assertProductionExports(root,record);
  return {record,selected,regressions,identity,exports};
}
function execute({root=ROOT,home=os.homedir(),epoch=core.EPOCH,authorization,regressionResultsPath=REGRESSION_REL,render=renderDefault,now=()=>new Date().toISOString()}={}){
  const phaseCells=cells(),authorizationRecord=readAuthorization(root,authorization),approved=authorizationRecord?.authorization;
  if(!approved)throw new Error('AUTHORIZATION_REQUIRED: Issue #7 approval for the exact 486 Stage3 cells is required');
  const auth=core.validateAuthorization(approved,{stage:STAGE,phase:PHASE,cells:phaseCells.map(cell=>cell.key),renderBudget:486});
  const roots=core.resolveRoots(root,STAGE,epoch,{home});
  return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>executeAuthorized({root,home,epoch,approved,auth,phaseCells,regressionResultsPath,render,now,roots}));
}
function executeAuthorized({root,home,epoch,approved,auth,phaseCells,regressionResultsPath,render,now,roots}){
  const prepared=prepare({root,home,epoch,regressionResultsPath});
  if(prepared.record.sourceCommit&&!isAncestor(root,prepared.record.sourceCommit))
    throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: build source commit is not an ancestor of current HEAD');
  const previous=core.readPhaseLedger(roots,PHASE);
  const manifest=phaseManifest({root,record:prepared.record,identity:prepared.identity,authorizationSha256:auth.sha256,
    now:previous?.manifest.createdAt?()=>previous.manifest.createdAt:now,cells:phaseCells});
  core.initializePhase({roots,phase:PHASE,manifest,cells:phaseCells,renderBudget:486,now});
  core.writeImmutableDual(roots,'execution-identity.json',core.canonicalBytes(prepared.identity));
  core.writeImmutableDual(roots,'regression-results.json',prepared.regressions.bytes);
  core.writeImmutableDual(roots,'artifacts/production-plugin.wasm',fs.readFileSync(productionWasm(root,prepared.record)));
  let calls=0,unsafe=false;
  for(const cell of phaseCells){
    const existing=core.readCell(roots,PHASE,cell.key);
    if(existing.cell.state==='COMPLETE')continue;
    const started=core.startCell({roots,phase:PHASE,cellKey:cell.key,cell,identity:prepared.identity,
      identityNow:()=>currentIdentity({root,home,epoch,record:identityRecord(root),regressionPath:regressionResultsPath}),now});
    if(started.skipped)continue;
    calls+=1;
    let observed;
    try{observed=render({root,record:prepared.record,identity:prepared.identity,cell,authorization:approved});}
    catch(error){
      try{core.markAmbiguous({roots,phase:PHASE,cellKey:cell.key,reason:error.message,now});}catch{}
      throw new Error(`BLOCKED_STAGE3_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}; started=${calls}; ${error.message}`);
    }
    if(!observed||typeof observed!=='object'){
      try{core.markAmbiguous({roots,phase:PHASE,cellKey:cell.key,reason:'render returned no observation',now});}catch{}
      throw new Error(`BLOCKED_STAGE3_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}; started=${calls}; no observation returned`);
    }
    const row={...observed,pitch:cell.pitch,velocity:cell.velocity,kind:cell.kind,
      ...(auth.syntheticTest?{syntheticTest:true,label:'SYNTHETIC TEST'}:{})};
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
  if(auth.syntheticTest)evaluation.syntheticTest=true;
  const finalized=core.finalizePhase({roots,phase:PHASE,decision:evaluation.decision,summary:evaluation,now});
  return {decision:finalized.result.decision,phase:PHASE,calls,renderCount:finalized.result.renderCount,counts,
    summary:evaluation,resultSha256:finalized.sha256,archiveSha256:finalized.archiveSha256,syntheticTest:auth.syntheticTest,acousticRenders:calls};
}
function run({mode,root=ROOT,home=os.homedir(),epoch=core.EPOCH,authorization,regressionResultsPath=REGRESSION_REL,render=renderDefault,now=()=>new Date().toISOString()}={}){
  if(!['dry-run','execute','finalize','verify'].includes(mode))throw new Error('explicit mode required: dry-run, execute, finalize, or verify');
  if(mode==='execute')return execute({root,home,epoch,authorization,regressionResultsPath,render,now});
  const roots=core.resolveRoots(root,STAGE,epoch,{home});
  if(mode==='verify'){
    const final=core.readFinal(roots,PHASE);
    const prepared=prepare({root,home,epoch,regressionResultsPath});
    core.checkFrozenIdentity(final.result.identity,prepared.identity);
    return {decision:final.result.decision,phase:PHASE,resultSha256:final.sha256,archiveSha256:final.archiveSha256,
      renderCount:final.result.renderCount,builds:0,renders:0,writes:0,acousticRenders:0};
  }
  if(mode==='finalize'){
    return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>{
      const identity=core.readDualJson(roots,'execution-identity.json');
      const prepared=prepare({root,home,epoch,regressionResultsPath});
      core.checkFrozenIdentity(identity,prepared.identity);
      const regressionBytes=core.readDualBytes(roots,'regression-results.json'),regressions=JSON.parse(regressionBytes.bytes.toString('utf8'));
      if(core.sha256(regressionBytes.bytes)!==prepared.regressions.sha256)throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: stored regression evidence changed');
      const artifact=core.readDualBytes(roots,'artifacts/production-plugin.wasm');
      if(artifact.sha256!==prepared.record.builds.production.wasm.sha256)throw new Error('BLOCKED_STAGE3_BUILD_IDENTITY: preserved production WASM changed');
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
  if(/^AUTHORIZATION_REQUIRED|^BLOCKED_/.test(result.decision||''))process.exitCode=2;
  return result;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=/^AUTHORIZATION_REQUIRED/.test(error.message)?2:1;}}

module.exports={ROOT,STAGE,PHASE,AUTH_REL,REGRESSION_REL,REQUIRED_REGRESSIONS,CELL_SPECS,
  sha256,fileSha,identityRecord,buildDirectory,productionWasm,assertProductionExports,readSelection,assertPromotedValues,
  readRegressions,currentIdentity,cells,authPath,readAuthorization,phaseManifest,renderDefault,readRows,evaluate,finalize,prepare,execute,run,parseMode,main};
