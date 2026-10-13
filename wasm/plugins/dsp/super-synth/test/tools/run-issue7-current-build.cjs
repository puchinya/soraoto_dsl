'use strict';

const fs=require('node:fs');
const os=require('node:os');
const core=require('./issue7-current-build-core.cjs');
const stage3e=require('./run-issue7-stage3e-current-build.cjs');
const stage3=require('./run-issue7-stage3-current-build.cjs');
const stage4=require('./run-issue7-stage4-current-build.cjs');

const ROOT=core.ROOT;
const PHASE_FLOW=Object.freeze([
  {phase:'baseline',mode:'baseline',success:'STAGE3E_BASELINE_EQUIVALENCE_PASS'},
  {phase:'midi51-diagnostic',mode:'screen',success:'STAGE3E_MIDI51_PASS',accepted:['STAGE3E_MIDI51_DIAGNOSTIC_FAIL']},
  {phase:'low-screen',mode:'screen',success:'STAGE3E_LOW_SCREEN_COMPLETE'},
  {phase:'midi51-candidate-diagnostic',mode:'screen',success:'STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',conditional:true},
  {phase:'low-full',mode:'full',success:'STAGE3E_LOW_FULL_PASS'},
  {phase:'mid-screen',mode:'screen',success:'STAGE3E_MID_SCREEN_COMPLETE'},
  {phase:'midi51-final-diagnostic',mode:'screen',success:'STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE'},
  {phase:'mid-full',mode:'full',success:'STAGE3E_MID_FULL_PASS'}
]);

function readFinal(roots,phase,reader=stage3e.loadFinalMaybe){
  try{return reader(roots,phase);}catch(error){return {decision:'BLOCKED_EVIDENCE_READBACK',reason:error.message};}
}
function stage3eProgress({root=ROOT,home=os.homedir(),epoch=core.EPOCH,readPhase=stage3e.loadFinalMaybe}={}){
  const roots=core.resolveRoots(root,'stage3e',epoch,{home}),completed={};
  for(const item of PHASE_FLOW){
    if(item.conditional&&completed['midi51-diagnostic']==='STAGE3E_MIDI51_PASS')continue;
    const result=readFinal(roots,item.phase,readPhase);
    if(result?.decision==='BLOCKED_EVIDENCE_READBACK')return {decision:result.decision,phase:item.phase,reason:result.reason,completed};
    if(result){
      completed[item.phase]=result.decision;
      if(result.decision!==item.success&&!(item.accepted||[]).includes(result.decision))return {decision:result.decision,phase:item.phase,completed};
      continue;
    }
    return {decision:'AUTHORIZATION_REQUIRED',stage:'stage3e',phase:item.phase,mode:item.mode,completed};
  }
  let selected;
  try{selected=core.readDualBytes(roots,'selection.json');}
  catch(error){return {decision:'BLOCKED_STAGE3E_SELECTION_REQUIRED',reason:error.message,completed};}
  return {decision:'STAGE3E_SELECTED_RESPONSE',stage:'stage3e',selectionSha256:selected.sha256,completed};
}
function lockStatus(root=ROOT,epoch=core.EPOCH){
  const common=core.resolveRoots(root,'stage3e',epoch).commonDirectory,file=core.lockPath(common,epoch);
  if(!fs.existsSync(file))return {locked:false};
  try{return {locked:true,owner:JSON.parse(fs.readFileSync(file,'utf8'))};}
  catch(error){return {locked:true,ownerReadable:false,reason:error.message};}
}
function status({root=ROOT,home=os.homedir(),epoch=core.EPOCH,runners={stage3e,stage3,stage4}}={}){
  const progress=stage3eProgress({root,home,epoch});
  let builds;
  try{builds=runners.stage3e.run({mode:'dry-run',root,home,epoch});}
  catch(error){builds={decision:'BLOCKED_STAGE3E_PREFLIGHT',reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
  let stage3Status,stage4Status;
  try{stage3Status=runners.stage3.run({mode:'dry-run',root,home,epoch});}
  catch(error){stage3Status={decision:'BLOCKED_STAGE3_PREFLIGHT',reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
  try{stage4Status=runners.stage4.run({mode:'dry-run',root,home,epoch});}
  catch(error){stage4Status={decision:'BLOCKED_STAGE4_PREFLIGHT',reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
  return {decision:'ISSUE7_CURRENT_BUILD_STATUS',issue:7,epoch,stage3e:progress,builds,stage3:stage3Status,stage4:stage4Status,
    lock:lockStatus(root,epoch),buildsStarted:0,renders:0,writes:0,acousticRenders:0};
}
function finalizedStage({root=ROOT,home=os.homedir(),epoch=core.EPOCH,stage,phase}={}){
  const roots=core.resolveRoots(root,stage,epoch,{home}),relative=core.phaseRelative(phase,'phase-result.json'),paths=core.dualPaths(roots,relative);
  if(!fs.existsSync(paths.primary)&&!fs.existsSync(paths.secondary))return null;
  try{return core.readFinal(roots,phase);}catch(error){return {decision:'BLOCKED_EVIDENCE_READBACK',reason:error.message};}
}
function dryRun(options={}){
  const result=status(options);
  return {...result,decision:'ISSUE7_CURRENT_BUILD_DRY_RUN',dryRun:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
}
function stage3eNextMode(progress){
  const item=PHASE_FLOW.find(phase=>progress.stage==='stage3e'&&phase.phase===progress.phase);
  return item||null;
}
function dispatchNext({root=ROOT,home=os.homedir(),epoch=core.EPOCH,authorization,runners={stage3e,stage3,stage4}}={}){
  const preflight=status({root,home,epoch,runners});
  const progress=preflight.stage3e;
  if(progress.decision==='AUTHORIZATION_REQUIRED'&&progress.stage==='stage3e'){
    const item=stage3eNextMode(progress);
    const prerequisite=preflight.builds;
    if(prerequisite.decision!=='STAGE3E_DRY_RUN_READY')return {...prerequisite,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
    try{
      const result=runners.stage3e.run({mode:item.mode,root,home,epoch,authorization});
      return {...result,stage:'stage3e',phase:item.phase,stoppedAfterStep:true,nextPhasePending:true};
    }catch(error){
      const decision=/^AUTHORIZATION_REQUIRED/.test(error.message)?'AUTHORIZATION_REQUIRED':'BLOCKED_STAGE3E_EXECUTION';
      return {decision,stage:'stage3e',phase:item.phase,reason:error.message,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
    }
  }
  if(progress.decision!=='STAGE3E_SELECTED_RESPONSE')return {...progress,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
  const stage3Final=finalizedStage({root,home,epoch,stage:'stage3',phase:'stage3'});
  if(stage3Final&&stage3Final.decision==='BLOCKED_EVIDENCE_READBACK')return {...stage3Final,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
  let selectedRunner='stage3';
  if(stage3Final){
    if(stage3Final.result?.decision!=='STAGE3_READY_FOR_STAGE4')return {decision:stage3Final.result?.decision||'BLOCKED_STAGE3_RESULT',stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
    const stage4Final=finalizedStage({root,home,epoch,stage:'stage4',phase:'stage4'});
    if(stage4Final?.decision==='BLOCKED_EVIDENCE_READBACK')return {...stage4Final,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
    if(stage4Final)return {decision:stage4Final.result?.decision||'BLOCKED_STAGE4_RESULT',resultSha256:stage4Final.sha256,
      stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0,nextAction:'Gate 7 full-suite verification and PR review'};
    if(preflight.stage4.decision!=='STAGE4_DRY_RUN_READY')return {...preflight.stage4,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
    selectedRunner='stage4';
  }else if(preflight.stage3.decision!=='STAGE3_DRY_RUN_READY'){
    return {...preflight.stage3,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
  }
  try{
    const result=runners[selectedRunner].run({mode:'execute',root,home,epoch,authorization});
    return {...result,stage:selectedRunner,stoppedAfterStep:true,nextPhasePending:true};
  }catch(error){
    const decision=/^AUTHORIZATION_REQUIRED/.test(error.message)?'AUTHORIZATION_REQUIRED':`BLOCKED_${selectedRunner.toUpperCase()}_EXECUTION`;
    return {decision,stage:selectedRunner,phase:selectedRunner,reason:error.message,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
  }
}
function next(options={}){return dispatchNext(options);}
function run({mode,root=ROOT,home=os.homedir(),epoch=core.EPOCH,authorization,runners}={}){
  if(mode==='status')return status({root,home,epoch,runners});
  if(mode==='dry-run')return dryRun({root,home,epoch,runners});
  if(mode==='next')return next({root,home,epoch,authorization,runners});
  throw new Error('explicit mode required: status, dry-run, or next');
}
function parseMode(argv){
  if(argv.length!==1)throw new Error('select exactly one mode: --status, --dry-run, or --next');
  const values={'--status':'status','--dry-run':'dry-run','--next':'next'};
  if(!values[argv[0]])throw new Error(`unsupported mode: ${argv[0]}`);
  return values[argv[0]];
}
function main(argv=process.argv.slice(2)){
  const result=run({mode:parseMode(argv)});process.stdout.write(JSON.stringify(result)+'\n');
  if(/^AUTHORIZATION_REQUIRED|^BLOCKED_/.test(result.decision||''))process.exitCode=2;
  return result;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=/^AUTHORIZATION_REQUIRED/.test(error.message)?2:1;}}

module.exports={ROOT,PHASE_FLOW,readFinal,stage3eProgress,lockStatus,status,finalizedStage,dryRun,stage3eNextMode,dispatchNext,next,run,parseMode,main};
