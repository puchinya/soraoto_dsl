'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const core=require('./issue7-current-build-core.cjs');
const stage3e=require('./run-issue7-stage3e-current-build.cjs');
const adaptiveMid=require('./run-issue7-adaptive-mid.cjs');
const stage3=require('./run-issue7-stage3-current-build.cjs');
const stage4=require('./run-issue7-stage4-current-build.cjs');

const ROOT=core.ROOT;
const HISTORICAL_PHASE_FLOW=Object.freeze([
  {phase:'baseline',mode:'baseline',success:'STAGE3E_BASELINE_EQUIVALENCE_PASS'},
  {phase:'midi51-diagnostic',mode:'screen',success:'STAGE3E_MIDI51_PASS',accepted:['STAGE3E_MIDI51_DIAGNOSTIC_FAIL']},
  {phase:'low-screen',mode:'screen',success:'STAGE3E_LOW_SCREEN_COMPLETE'},
  {phase:'midi51-candidate-diagnostic',mode:'screen',success:'STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',conditional:true},
  {phase:'low-full',mode:'full',success:'STAGE3E_LOW_FULL_PASS'},
  {phase:'mid-screen',mode:'screen',success:'STAGE3E_MID_SCREEN_COMPLETE'},
  {phase:'midi51-final-diagnostic',mode:'screen',success:'STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE'},
  {phase:'mid-full',mode:'full',success:'STAGE3E_MID_FULL_PASS'}
]);
const PHASE_FLOW=Object.freeze([
  ...HISTORICAL_PHASE_FLOW.slice(0,-1),
  {phase:'adaptive-mid-01',mode:'adaptive',success:'ADAPTIVE_MID_FULL_PASS'}
]);
const STAGE3E_BUDGETS=Object.freeze({baseline:24,'midi51-diagnostic':16,'low-screen':1512,'midi51-candidate-diagnostic':80,
  'low-full':415,'mid-screen':108,'midi51-final-diagnostic':80,'mid-full':0,'adaptive-mid-01':264});
const TOTAL_RENDER_BUDGET=4408;
const RUN_ALL_JOURNAL='run-all/events.jsonl';
const FOCUSED_TESTS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/issue7-current-build-core.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-current-build.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.test.cjs'
]);

function readFinal(roots,phase,reader=stage3e.loadFinalMaybe){
  try{return reader(roots,phase);}catch(error){return {decision:'BLOCKED_EVIDENCE_READBACK',reason:error.message};}
}
function stage3eProgress({root=ROOT,home=os.homedir(),epoch=core.EPOCH,readPhase=stage3e.loadFinalMaybe,adaptiveRunner=adaptiveMid}={}){
  const roots=core.resolveRoots(root,'stage3e',epoch,{home}),completed={};
  for(const item of PHASE_FLOW){
    if(item.phase==='adaptive-mid-01'){
      let result;try{result=adaptiveRunner.loadFinalMaybe(root,home,epoch);}catch(error){return {decision:'BLOCKED_EVIDENCE_READBACK',phase:item.phase,reason:error.message,completed};}
      if(!result)return {decision:'NEXT_PHASE_READY',stage:'stage3e',phase:item.phase,mode:item.mode,completed};
      completed[item.phase]=result.decision;
      if(result.decision!=='ADAPTIVE_MID_FULL_PASS')return {decision:result.decision,stage:'stage3e',phase:item.phase,reason:result.reason||null,completed};
      let selection;try{selection=adaptiveRunner.loadSelection(root,home,epoch);}catch(error){return {decision:'BLOCKED_STAGE3E_SELECTION_REQUIRED',stage:'stage3e',phase:item.phase,reason:error.message,completed};}
      if(!selection)return {decision:'BLOCKED_STAGE3E_SELECTION_REQUIRED',stage:'stage3e',phase:item.phase,completed};
      return {decision:'STAGE3E_SELECTED_RESPONSE',stage:'stage3e',phase:item.phase,selectionSchema:selection.selection.schema,
        selectionSha256:selection.selectionSha256,completed};
    }
    if(item.conditional&&completed['midi51-diagnostic']==='STAGE3E_MIDI51_PASS')continue;
    const result=readFinal(roots,item.phase,readPhase);
    if(result?.decision==='BLOCKED_EVIDENCE_READBACK')return {decision:result.decision,phase:item.phase,reason:result.reason,completed};
    if(result){
      completed[item.phase]=result.decision;
      if(result.decision!==item.success&&!(item.accepted||[]).includes(result.decision))return {decision:result.decision,phase:item.phase,completed};
      if(item.phase==='midi51-candidate-diagnostic'){
        const passingCandidates=result.summary?.passingCandidates;
        if(!Array.isArray(passingCandidates))return {decision:'BLOCKED_STAGE3E_MIDI51_CANDIDATE_RESULT_INVALID',phase:item.phase,completed};
        // The pre-low-full MIDI51 result is diagnostic; the fixed M=1 low search cannot tune it.
      }
      if(item.phase==='midi51-final-diagnostic'){
        const passingCandidates=result.summary?.passingCandidates;
        if(!Array.isArray(passingCandidates))return {decision:'BLOCKED_STAGE3E_MIDI51_FINAL_CANDIDATE_RESULT_INVALID',phase:item.phase,completed};
        if(result.summary.candidates?.length!==5||result.summary.candidates.some(candidate=>candidate.safe!==true
          ||candidate.diagnosticsComplete!==true||candidate.pass!==false))
          return {decision:'BLOCKED_STAGE3E_MIDI51_FINAL_CANDIDATE_RESULT_INVALID',phase:item.phase,completed};
      }
      continue;
    }
    return {decision:'NEXT_PHASE_READY',stage:'stage3e',phase:item.phase,mode:item.mode,completed};
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
function status({root=ROOT,home=os.homedir(),epoch=core.EPOCH,runners={stage3e,adaptiveMid,stage3,stage4},readPhase=stage3e.loadFinalMaybe}={}){
  const progress=stage3eProgress({root,home,epoch,readPhase,adaptiveRunner:runners.adaptiveMid||adaptiveMid});
  let builds;
  if(progress.phase==='adaptive-mid-01'||progress.decision==='STAGE3E_SELECTED_RESPONSE')
    builds={decision:'ADAPTIVE_MID_EXTENSION_READY',phase:'adaptive-mid-01',builds:0,renders:0,writes:0,acousticRenders:0};
  else try{builds=runners.stage3e.run({mode:'dry-run',root,home,epoch});}
  catch(error){builds={decision:'BLOCKED_STAGE3E_PREFLIGHT',reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
  let stage3Status,stage4Status;
  try{stage3Status=runners.stage3.run({mode:'dry-run',root,home,epoch});}
  catch(error){stage3Status={decision:'BLOCKED_STAGE3_PREFLIGHT',reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
  try{stage4Status=runners.stage4.run({mode:'dry-run',root,home,epoch});}
  catch(error){stage4Status={decision:'BLOCKED_STAGE4_PREFLIGHT',reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
  let adaptiveStatus={decision:'ADAPTIVE_MID_NOT_CURRENT',builds:0,renders:0,writes:0,acousticRenders:0};
  if(progress.phase==='adaptive-mid-01'||progress.decision==='STAGE3E_SELECTED_RESPONSE'){
    try{adaptiveStatus=(runners.adaptiveMid||adaptiveMid).run({mode:'dry-run',root,home,epoch});}
    catch(error){adaptiveStatus={decision:'BLOCKED_ADAPTIVE_MID_PREFLIGHT',reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
  }
  const roots=core.resolveRoots(root,'stage3e',epoch,{home});
  return {decision:'ISSUE7_CURRENT_BUILD_STATUS',issue:7,epoch,stage3e:progress,builds,adaptiveMid:adaptiveStatus,stage3:stage3Status,stage4:stage4Status,
    lock:lockStatus(root,epoch),runAllLock:runAllLockStatus(roots.commonDirectory,epoch),buildsStarted:0,renders:0,writes:0,acousticRenders:0};
}
function runAllLockStatus(commonDirectory,epoch=core.EPOCH){
  const file=core.runAllLockPath(commonDirectory,epoch);
  if(!fs.existsSync(file))return {locked:false};
  try{return {locked:true,owner:JSON.parse(fs.readFileSync(file,'utf8'))};}
  catch(error){return {locked:true,ownerReadable:false,reason:error.message};}
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
function verify({root=ROOT,home=os.homedir(),epoch=core.EPOCH,runners={stage3e,adaptiveMid,stage3,stage4},readPhase=stage3e.loadFinalMaybe}={}){
  const roots3=core.resolveRoots(root,'stage3',epoch,{home}),roots4=core.resolveRoots(root,'stage4',epoch,{home});
  const stage3Final=finalizedStage({root,home,epoch,stage:'stage3',phase:'stage3'});
  const stage4Final=finalizedStage({root,home,epoch,stage:'stage4',phase:'stage4'});
  const progress=stage3eProgress({root,home,epoch,readPhase,adaptiveRunner:runners.adaptiveMid||adaptiveMid});
  const evidence={stage3e:runners.stage3e.run({mode:'verify',root,home,epoch}),adaptiveMid:null,stage3:null,stage4:null};
  if(progress.phase==='adaptive-mid-01'||progress.decision==='STAGE3E_SELECTED_RESPONSE')
    evidence.adaptiveMid=(runners.adaptiveMid||adaptiveMid).run({mode:'verify',root,home,epoch});
  if(stage3Final)evidence.stage3=stage3Final.decision==='BLOCKED_EVIDENCE_READBACK'?stage3Final:runners.stage3.run({mode:'verify',root,home,epoch});
  if(stage4Final)evidence.stage4=stage4Final.decision==='BLOCKED_EVIDENCE_READBACK'?stage4Final:runners.stage4.run({mode:'verify',root,home,epoch});
  const blocked=/^BLOCKED_/.test(progress.decision||'')
    ||Object.values(evidence).some(value=>value&&/^BLOCKED_/.test(value.decision||''));
  return {decision:blocked?'BLOCKED_ISSUE7_CURRENT_BUILD_VERIFY':'ISSUE7_CURRENT_BUILD_VERIFY_OK',progress,evidence,
    roots:{stage3:roots3.primary,stage4:roots4.primary},builds:0,renders:0,writes:0,acousticRenders:0};
}
function stage3eNextMode(progress){
  const item=PHASE_FLOW.find(phase=>progress.stage==='stage3e'&&phase.phase===progress.phase);
  return item||null;
}
function preMidSearchLowFullPlan({root=ROOT,home=os.homedir(),epoch=core.EPOCH,runners={stage3e,adaptiveMid,stage3,stage4},readPhase=stage3e.loadFinalMaybe}={}){
  const roots=core.resolveRoots(root,'stage3e',epoch,{home});
  const initial=readFinal(roots,'midi51-diagnostic',readPhase);
  const low=readFinal(roots,'low-screen',readPhase);
  const diagnostic=readFinal(roots,'midi51-candidate-diagnostic',readPhase);
  if(initial?.decision!=='STAGE3E_MIDI51_DIAGNOSTIC_FAIL'||initial.summary?.safe!==true||initial.summary?.diagnosticsComplete!==true
    ||low?.decision!=='STAGE3E_LOW_SCREEN_COMPLETE'||diagnostic?.decision!=='STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE')return null;
  const engine=runners.stage3e;
  const tuples=engine.lowScreenTopTuples(low.summary?.topFive);
  const passing=engine.passingCandidates(diagnostic.summary,tuples,'midi51-candidate-diagnostic');
  const evaluatedPassing=diagnostic.summary.candidates?.filter(candidate=>candidate.pass===true).map(candidate=>candidate.tuple);
  if(!Array.isArray(evaluatedPassing)||!core.same(evaluatedPassing,passing))
    throw new Error('BLOCKED_STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC: passing tuple summary is inconsistent');
  if(passing.length)return null;
  if(!Array.isArray(diagnostic.summary?.candidates)||diagnostic.summary.candidates.length!==tuples.length
    ||diagnostic.summary.candidates.some(candidate=>candidate.safe!==true||candidate.diagnosticsComplete!==true||candidate.pass!==false))
    throw new Error('BLOCKED_STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC: incomplete or unsafe evidence cannot defer the MIDI51 quality gate');
  return {roots,tuples,initialErrorDb:initial.summary.span?.errorDb??null};
}
function runPreMidSearchLowFull({root,plan,runners,runAllOwner}){
  const engine=runners.stage3e;
  const cells=plan.tuples.flatMap(tuple=>engine.fullCells(tuple,'low-full'));
  if(!cells.length||cells.length>STAGE3E_BUDGETS['low-full'])
    throw new Error('BLOCKED_ISSUE7_RENDER_BUDGET: fixed low-full candidate set exceeds its phase cap');
  const record=engine.identityRecord(root),identity=engine.currentIdentity(root,record);
  return engine.runCells({root,roots:plan.roots,record,identity,phase:'low-full',cells,runAllOwner});
}
function dispatchNext({root=ROOT,home=os.homedir(),epoch=core.EPOCH,runners={stage3e,adaptiveMid,stage3,stage4},readPhase=stage3e.loadFinalMaybe,runAllOwner,
  preLowFullPlan}={}){
  const roots=core.resolveRoots(root,'stage3e',epoch,{home});
  core.assertRunAllLockAccess(roots.commonDirectory,runAllOwner);
  const preflight=status({root,home,epoch,runners,readPhase});
  const progress=preflight.stage3e;
  if(progress.decision==='NEXT_PHASE_READY'&&progress.stage==='stage3e'){
    const item=stage3eNextMode(progress);
    const isAdaptive=item?.mode==='adaptive',adaptiveRunner=runners.adaptiveMid||adaptiveMid;
    const prerequisite=isAdaptive?preflight.adaptiveMid:preflight.builds;
    const ready=isAdaptive?'ADAPTIVE_MID_DRY_RUN_READY':'STAGE3E_DRY_RUN_READY';
    if(prerequisite?.decision!==ready)return {...prerequisite,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
    try{
      let lowFullPlan=preLowFullPlan;
      if(item.phase==='low-full'&&lowFullPlan===undefined)lowFullPlan=preMidSearchLowFullPlan({root,home,epoch,runners,readPhase});
      const result=item.phase==='low-full'&&lowFullPlan
        ?runPreMidSearchLowFull({root,plan:lowFullPlan,runners,runAllOwner})
        :isAdaptive?adaptiveRunner.run({mode:'execute',root,home,epoch,runAllOwner})
          :runners.stage3e.run({mode:item.mode,root,home,epoch,phase:item.phase,runAllOwner});
      return {...result,stage:'stage3e',phase:item.phase,stoppedAfterStep:true,nextPhasePending:true};
    }catch(error){
      return {decision:'BLOCKED_STAGE3E_EXECUTION',stage:'stage3e',phase:item.phase,reason:error.message,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
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
    const result=runners[selectedRunner].run({mode:'execute',root,home,epoch,runAllOwner});
    return {...result,stage:selectedRunner,stoppedAfterStep:true,nextPhasePending:true};
  }catch(error){
    return {decision:`BLOCKED_${selectedRunner.toUpperCase()}_EXECUTION`,stage:selectedRunner,phase:selectedRunner,reason:error.message,stoppedAfterStep:true,buildsStarted:0,renders:0,writes:0,acousticRenders:0};
  }
}
function next(options={}){return dispatchNext(options);}
function phaseRenderCount(root,home,epoch,commonDirectory){
  let total=0;const phases=[];
  for(const phase of Object.keys(STAGE3E_BUDGETS)){
    const roots=core.resolveRoots(root,'stage3e',epoch,{home,commonDirectory});let count=0;
    if(phase==='adaptive-mid-01'){
      const adaptiveRoots=adaptiveMid.sidecarRoots(root,home,epoch,commonDirectory),state=adaptiveMid.readLedger(adaptiveRoots);
      count=state?.ledger?.renderCount||0;
      if(state){
        const observed=Object.values(state.ledger.cells||{}).filter(cell=>['IN_PROGRESS','COMPLETE','AMBIGUOUS'].includes(cell.state)).length;
        const byKind={probe:0,screen:0,full:0};
        for(const cell of Object.values(state.ledger.cells||{}))if(['IN_PROGRESS','COMPLETE','AMBIGUOUS'].includes(cell.state))byKind[cell.kind]=(byKind[cell.kind]||0)+1;
        if(observed!==count||Object.keys(byKind).some(kind=>!['probe','screen','full'].includes(kind))
          ||byKind.probe>112||byKind.screen>24||byKind.full>128)
          throw new Error('BLOCKED_ISSUE7_RENDER_BUDGET: adaptive sidecar ledger disagrees with its per-kind caps');
      }
    }else{
      const state=core.readPhaseLedger(roots,phase);count=state?.ledger?.renderCount||0;
    }
    if(count>STAGE3E_BUDGETS[phase])throw new Error(`BLOCKED_ISSUE7_RENDER_BUDGET: ${phase} recorded ${count} beyond ${STAGE3E_BUDGETS[phase]}`);
    total+=count;phases.push({stage:'stage3e',phase,count,limit:STAGE3E_BUDGETS[phase]});
  }
  for(const [stage,limit] of [['stage3',486],['stage4',1423]]){
    const roots=core.resolveRoots(root,stage,epoch,{home,commonDirectory}),state=core.readPhaseLedger(roots,stage),count=state?.ledger?.renderCount||0;
    if(count>limit)throw new Error(`BLOCKED_ISSUE7_RENDER_BUDGET: ${stage} recorded ${count} beyond ${limit}`);
    total+=count;phases.push({stage,phase:stage,count,limit});
  }
  if(total>TOTAL_RENDER_BUDGET)throw new Error(`BLOCKED_ISSUE7_RENDER_BUDGET: cumulative ${total} exceeds ${TOTAL_RENDER_BUDGET}`);
  return {total,phases};
}
function recordRunAllEvent(roots,owner,event,now){
  return core.appendDualJournal(roots,{schemaVersion:1,issue:7,epoch:core.EPOCH,ownerId:owner.ownerId,pid:owner.pid,
    occurredAt:now(),...event},{relative:RUN_ALL_JOURNAL});
}
function resultDecision(result){return typeof result?.decision==='string'?result.decision:'BLOCKED_ISSUE7_UNKNOWN_RESULT';}
function phaseDecisionValid(item,result){
  const allowed=[item.success,...(item.accepted||[])];return allowed.includes(resultDecision(result));
}
function runVerificationSuite({root=ROOT,now=()=>new Date().toISOString(),spawn=spawnSync}={}){
  const toolchain=path.resolve(root,'wasm/cmake/wasm32-clang.cmake');
  const commands=[
    ['focused-current-build-tests',['node','--test',...FOCUSED_TESTS]],
    ['web-player-test',['npm','--prefix','web-player','test']],
    ['web-player-build',['npm','--prefix','web-player','run','build']],
    ['super-synth-metadata',['python3','wasm/cmake/test_super_synth_metadata.py']],
    ['cmake-configure',['cmake','-S','wasm','-B','build/wasm',`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`]],
    ['cmake-build',['cmake','--build','build/wasm']],
    ['cmake-ctest',['ctest','--test-dir','build/wasm','--output-on-failure']],
    ['git-diff-check',['git','diff','--check']]
  ];
  const results=[];
  for(const [name,args] of commands){
    const command=`rtk ${args.map(value=>JSON.stringify(value)).join(' ')}`;
    const child=spawn('rtk',args,{cwd:root,encoding:'buffer',maxBuffer:64*1024*1024});
    const stdout=child.stdout||Buffer.alloc(0),stderr=child.stderr||Buffer.alloc(0),exitCode=Number.isInteger(child.status)?child.status:1;
    const item={name,command,exitCode,signal:child.signal||null,stdoutSha256:crypto.createHash('sha256').update(stdout).digest('hex'),
      stderrSha256:crypto.createHash('sha256').update(stderr).digest('hex'),result:exitCode===0?'PASS':'FAIL',completedAt:now()};
    results.push(item);
    if(exitCode!==0)return {decision:'BLOCKED_ISSUE7_FULL_SUITE',failed:name,results};
  }
  return {decision:'ISSUE7_FULL_SUITE_PASS',results};
}
function snapshotEvidence(root,home,epoch,commonDirectory){
  const result={};
  for(const stage of core.STAGES){
    const roots=core.resolveRoots(root,stage,epoch,{home,commonDirectory});
    for(const base of [roots.primary,roots.secondary]){
      if(!fs.existsSync(base))continue;
      const walk=(dir)=>{
        for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
          const file=path.join(dir,entry.name),relative=path.relative(base,file).split(path.sep).join('/');
          const stat=fs.lstatSync(file);
          if(stat.isSymbolicLink())throw new Error(`BLOCKED_ISSUE7_READ_ONLY_CHECK: symlink in evidence store ${file}`);
          if(entry.isDirectory())walk(file);
          else result[`${stage}:${base===roots.primary?'primary':'secondary'}:${relative}`]={sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),mtimeMs:stat.mtimeMs,size:stat.size};
        }
      };
      walk(base);
    }
  }
  return result;
}
function runReadOnlyFinalGate({root,home,epoch,runners,readPhase,commonDirectory,verifyReadOnly=verify,statusReadOnly=status,dryRunReadOnly=dryRun}={}){
  const before=snapshotEvidence(root,home,epoch,commonDirectory);
  const observed={status:statusReadOnly({root,home,epoch,runners,readPhase}),dryRun:dryRunReadOnly({root,home,epoch,runners,readPhase}),verify:verifyReadOnly({root,home,epoch,runners})};
  if(Object.values(observed).some(item=>item.builds!==0||item.renders!==0||item.writes!==0||item.acousticRenders!==0))
    throw new Error('BLOCKED_ISSUE7_READ_ONLY_CHECK: status/dry-run/verify reported a stateful operation');
  const after=snapshotEvidence(root,home,epoch,commonDirectory);
  if(!core.same(before,after))throw new Error('BLOCKED_ISSUE7_READ_ONLY_CHECK: evidence SHA or mtime changed during status/dry-run/verify');
  if(observed.verify.decision!=='ISSUE7_CURRENT_BUILD_VERIFY_OK')throw new Error(`BLOCKED_ISSUE7_FINAL_VERIFY: ${observed.verify.decision}`);
  return {decision:'ISSUE7_READ_ONLY_FINAL_GATE_PASS',observed,evidenceSnapshotSha256:core.sha256(core.canonicalBytes(after))};
}
function buildRunAllReport({root,home,epoch,roots,spend,runAcousticRenders,fullSuite,readOnlyGate,now}){
  const promotion=stage3.promotionDetails(root),originalRecord=stage3.identityRecord(root),stage3State=stage4.readStage3(root,home,epoch);
  const phaseResults=HISTORICAL_PHASE_FLOW.map(item=>{
    const final=readFinal(roots,item.phase);
    return {stage:'stage3e',phase:item.phase,decision:final?.decision||null,renderCount:final?.renderCount??null,
      resultSha256:final?.sha256||null,archiveSha256:final?.archiveSha256||null};
  });
  const adaptive=adaptiveMid.loadFinalMaybe(root,home,epoch),adaptiveLedger=adaptiveMid.readLedger(adaptiveMid.sidecarRoots(root,home,epoch));
  phaseResults.push({stage:'stage3e',phase:'adaptive-mid-01',decision:adaptive?.decision||null,
    renderCount:adaptiveLedger?.ledger?.renderCount||0,resultSha256:adaptive?.sha256||null,archiveSha256:null});
  for(const [stage,phase] of [['stage3','stage3'],['stage4','stage4']]){
    const final=finalizedStage({root,home,epoch,stage,phase});
    phaseResults.push({stage,phase,decision:final?.result?.decision||null,renderCount:final?.result?.renderCount??null,
      resultSha256:final?.sha256||null,archiveSha256:final?.archiveSha256||null});
  }
  const selection=stage3.readSelection(root,home,epoch).selection,regression=stage3.readRegressions(root);
  return {schemaVersion:1,issue:7,epoch,decision:'ISSUE7_READY_FOR_REVIEW',head:core.gitHead(root),phases:phaseResults,
    selectedResponse:selection,promotion:{commit:promotion.commit,parent:promotion.parent,parentTree:promotion.parentTree,
      commitTree:promotion.commitTree,changedPaths:promotion.changedPaths},
    originalProductionWasmSha256:originalRecord.builds.production.wasm.sha256,
    productionWasmSha256:stage3State.derived.builds.production.wasm.sha256,
    stage4AcceptanceWasmSha256:stage3State.derived.builds.production.wasm.sha256,
    historicalStage4WasmSha256:stage3State.derived.builds.stage4.wasm.sha256,
    regressionResultsSha256:regression.sha256,regressions:stage3.REQUIRED_REGRESSIONS,
    acousticRenders:runAcousticRenders,cumulativeRenderCount:spend.total,renderBudget:TOTAL_RENDER_BUDGET,fullSuite,readOnlyGate,
    externalBackup:'NOT AVAILABLE',platformsNotRun:['Windows','Linux'],completedAt:now()};
}
function runAll({root=ROOT,home=os.homedir(),epoch=core.EPOCH,runners={stage3e,adaptiveMid,stage3,stage4},readPhase=stage3e.loadFinalMaybe,
  now=()=>new Date().toISOString(),commonDirectory,promoteSelection=stage3.promoteSelection,runSuite=runVerificationSuite,
  verifyReadOnly=verify,statusReadOnly=status,dryRunReadOnly=dryRun,getStageFinal=finalizedStage,
  runFinalGate=runReadOnlyFinalGate,buildReport=buildRunAllReport}={}){
  const roots=core.resolveRoots(root,'stage3e',epoch,{home,commonDirectory}),append=(owner,event)=>recordRunAllEvent(roots,owner,event,now);
  return core.withRunAllLock({commonDirectory:roots.commonDirectory,now},owner=>{
    let spend,startRenderCount=0;
    try{
      spend=phaseRenderCount(root,home,epoch,roots.commonDirectory);startRenderCount=spend.total;
      append(owner,{type:'RUN_STARTED',head:core.gitHead(root)});
      const preflight=statusReadOnly({root,home,epoch,runners,readPhase});
      if(preflight.lock?.locked)throw new Error('BLOCKED_WRITER_LOCK: an Issue #7 phase writer is active');
      if(preflight.buildsStarted!==0||preflight.builds?.builds!==0||preflight.builds?.renders!==0||preflight.builds?.writes!==0
        ||preflight.stage3?.builds!==0||preflight.stage3?.renders!==0||preflight.stage3?.writes!==0
        ||preflight.stage4?.builds!==0||preflight.stage4?.renders!==0||preflight.stage4?.writes!==0)
        throw new Error('BLOCKED_ISSUE7_ZERO_RENDER_PREFLIGHT: status detected a build, render, or write');
      const verified=verifyReadOnly({root,home,epoch,runners});
      if(verified.decision.startsWith('BLOCKED_'))throw new Error(`BLOCKED_ISSUE7_PREFLIGHT_VERIFY: ${verified.decision}`);
      const progress=preflight.stage3e;
      if(progress.decision.startsWith('BLOCKED_'))throw new Error(`${progress.decision}: ${progress.reason||progress.phase||'preflight stopped'}`);
      spend=phaseRenderCount(root,home,epoch,roots.commonDirectory);
      append(owner,{type:'PREFLIGHT_PASSED',verifyDecision:verified.decision,renderCount:spend.total,renderBudget:TOTAL_RENDER_BUDGET});
      let steps=0;
      while(steps<PHASE_FLOW.length+4){
        steps+=1;
        const current=stage3eProgress({root,home,epoch,readPhase,adaptiveRunner:runners.adaptiveMid||adaptiveMid});
        if(current.decision.startsWith('BLOCKED_'))throw new Error(`${current.decision}: ${current.reason||current.phase||'phase gate failed'}`);
        if(current.decision==='NEXT_PHASE_READY'&&current.stage==='stage3e'){
          const item=stage3eNextMode(current);
          if(!item)throw new Error(`BLOCKED_ISSUE7_PHASE_TRANSITION: no phase mapping for ${current.phase}`);
          const before=phaseRenderCount(root,home,epoch,roots.commonDirectory);
          if(before.total>TOTAL_RENDER_BUDGET||before.phases.find(entry=>entry.phase===item.phase)?.count>STAGE3E_BUDGETS[item.phase])
            throw new Error('BLOCKED_ISSUE7_RENDER_BUDGET: Stage3E phase budget exhausted');
          const preLowFullPlan=item.phase==='low-full'?preMidSearchLowFullPlan({root,home,epoch,runners,readPhase}):null;
          if(preLowFullPlan)append(owner,{type:'PRE_LOW_FULL_MIDI51_GATE_DEFERRED',stage:'stage3e',phase:'low-full',
            reason:'MID_REGISTER_SEARCH_FOLLOWS_LOW_FULL',candidateCount:preLowFullPlan.tuples.length,
            candidates:preLowFullPlan.tuples,initialMidi51ErrorDb:preLowFullPlan.initialErrorDb});
          const result=dispatchNext({root,home,epoch,runners,readPhase,runAllOwner:owner,preLowFullPlan});
          const after=phaseRenderCount(root,home,epoch,roots.commonDirectory),phaseSpend=after.phases.find(entry=>entry.phase===item.phase)?.count||0;
          append(owner,{type:'PHASE_FINISHED',stage:'stage3e',phase:item.phase,decision:resultDecision(result),
            acousticRenders:after.total-before.total,renderCount:phaseSpend});
          if(!phaseDecisionValid(item,result))throw new Error(`${resultDecision(result)}: ${result.reason||item.phase}`);
          if(after.total>TOTAL_RENDER_BUDGET||after.total<before.total)throw new Error('BLOCKED_ISSUE7_RENDER_BUDGET: cumulative render accounting is invalid');
          continue;
        }
        if(current.decision!=='STAGE3E_SELECTED_RESPONSE')throw new Error(`BLOCKED_ISSUE7_PHASE_TRANSITION: unexpected Stage3E state ${current.decision}`);
        const stage3Final=getStageFinal({root,home,epoch,stage:'stage3',phase:'stage3'});
        if(stage3Final?.decision==='BLOCKED_EVIDENCE_READBACK')throw new Error(`BLOCKED_STAGE3_EVIDENCE_READBACK: ${stage3Final.reason}`);
        if(!stage3Final){
          const promotion=promoteSelection({root,home,epoch,runAllOwner:owner,now});
          append(owner,{type:'PROMOTION_FINISHED',decision:resultDecision(promotion),promotionCommit:promotion.promotionCommit||null,
            productionWasmSha256:promotion.productionWasmSha256||null,regressionResultsSha256:promotion.regressionResultsSha256||null});
          if(resultDecision(promotion)!=='STAGE3_PROMOTION_READY')throw new Error(`${resultDecision(promotion)}: ${promotion.reason||'production promotion failed'}`);
          const stage3Dry=runners.stage3.run({mode:'dry-run',root,home,epoch,runAllOwner:owner});
          if(stage3Dry.decision!=='STAGE3_DRY_RUN_READY')throw new Error(`${stage3Dry.decision}: Stage3 promotion preflight failed`);
          const before=phaseRenderCount(root,home,epoch,roots.commonDirectory);
          if(before.total+486>TOTAL_RENDER_BUDGET)throw new Error('BLOCKED_ISSUE7_RENDER_BUDGET: Stage3 would exceed cumulative render budget');
          const result=runners.stage3.run({mode:'execute',root,home,epoch,runAllOwner:owner});
          const after=phaseRenderCount(root,home,epoch,roots.commonDirectory);
          append(owner,{type:'PHASE_FINISHED',stage:'stage3',phase:'stage3',decision:resultDecision(result),
            acousticRenders:after.total-before.total,renderCount:after.phases.find(entry=>entry.stage==='stage3')?.count||0});
          if(resultDecision(result)!=='STAGE3_READY_FOR_STAGE4')throw new Error(`${resultDecision(result)}: Stage3 acceptance failed`);
          continue;
        }
        if(stage3Final.result?.decision!=='STAGE3_READY_FOR_STAGE4')throw new Error(`${stage3Final.result?.decision||'BLOCKED_STAGE3_RESULT'}: Stage3 did not pass`);
        const stage4Final=getStageFinal({root,home,epoch,stage:'stage4',phase:'stage4'});
        if(stage4Final?.decision==='BLOCKED_EVIDENCE_READBACK')throw new Error(`BLOCKED_STAGE4_EVIDENCE_READBACK: ${stage4Final.reason}`);
        if(!stage4Final){
          const stage4Dry=runners.stage4.run({mode:'dry-run',root,home,epoch,runAllOwner:owner});
          if(stage4Dry.decision!=='STAGE4_DRY_RUN_READY')throw new Error(`${stage4Dry.decision}: Stage4 promotion preflight failed`);
          const before=phaseRenderCount(root,home,epoch,roots.commonDirectory);
          if(before.total+1423>TOTAL_RENDER_BUDGET)throw new Error('BLOCKED_ISSUE7_RENDER_BUDGET: Stage4 would exceed cumulative render budget');
          const result=runners.stage4.run({mode:'execute',root,home,epoch,runAllOwner:owner});
          const after=phaseRenderCount(root,home,epoch,roots.commonDirectory);
          append(owner,{type:'PHASE_FINISHED',stage:'stage4',phase:'stage4',decision:resultDecision(result),
            acousticRenders:after.total-before.total,renderCount:after.phases.find(entry=>entry.stage==='stage4')?.count||0});
          if(resultDecision(result)!=='STAGE4_FULL_RANGE_COMPLETE')throw new Error(`${resultDecision(result)}: Stage4 acceptance failed`);
          continue;
        }
        if(stage4Final.result?.decision!=='STAGE4_FULL_RANGE_COMPLETE')throw new Error(`${stage4Final.result?.decision||'BLOCKED_STAGE4_RESULT'}: Stage4 acceptance failed`);
        const finalSuite=runSuite({root,home,epoch,runners,now});
        append(owner,{type:'FULL_SUITE_FINISHED',decision:resultDecision(finalSuite),failed:finalSuite.failed||null,
          checks:(finalSuite.results||[]).map(item=>({name:item.name,result:item.result,exitCode:item.exitCode}))});
        if(resultDecision(finalSuite)!=='ISSUE7_FULL_SUITE_PASS')throw new Error(`${resultDecision(finalSuite)}: ${finalSuite.failed||'full verification failed'}`);
        const finalGate=runFinalGate({root,home,epoch,runners,readPhase,commonDirectory:roots.commonDirectory,
          verifyReadOnly,statusReadOnly,dryRunReadOnly});
        const finalSpend=phaseRenderCount(root,home,epoch,roots.commonDirectory);
        if(finalSpend.total>TOTAL_RENDER_BUDGET)throw new Error('BLOCKED_ISSUE7_RENDER_BUDGET: final cumulative render count exceeds cap');
        const report=buildReport({root,home,epoch,roots,spend:finalSpend,runAcousticRenders:finalSpend.total-startRenderCount,
          fullSuite:finalSuite,readOnlyGate:finalGate,now});
        if(report.decision!=='ISSUE7_READY_FOR_REVIEW')throw new Error(`BLOCKED_ISSUE7_FINAL_REPORT: ${report.decision||'wrong final decision'}`);
        const reportRelative=`run-all/reports/${owner.ownerId}.json`;
        const reportStored=core.writeImmutableDual(roots,reportRelative,core.canonicalBytes(report));
        append(owner,{type:'RUN_FINISHED',decision:report.decision,reportRelative,reportSha256:reportStored.sha256,acousticRenders:report.acousticRenders});
        return {...report,reportSha256:reportStored.sha256,journalSha256:core.readDualJournal(roots,RUN_ALL_JOURNAL).sha256};
      }
      throw new Error('BLOCKED_ISSUE7_PHASE_TRANSITION: run-all exceeded its bounded transition count');
    }catch(error){
      const decision=/^BLOCKED_[A-Z0-9_]+/.exec(error.message)?.[0]||'BLOCKED_ISSUE7_RUN_ALL';
      let total=startRenderCount;try{total=phaseRenderCount(root,home,epoch,roots.commonDirectory).total;}catch{}
      try{append(owner,{type:'RUN_STOPPED',decision,reason:error.message,cumulativeRenderCount:total,
        runAcousticRenders:Math.max(0,total-startRenderCount)});}catch{}
      return {decision,reason:error.message,acousticRenders:Math.max(0,total-startRenderCount),cumulativeRenderCount:total,
        renderBudget:TOTAL_RENDER_BUDGET,journalSha256:(()=>{try{return core.readDualJournal(roots,RUN_ALL_JOURNAL).sha256;}catch{return null;}})()};
    }
  });
}
function run({mode,root=ROOT,home=os.homedir(),epoch=core.EPOCH,runners}={}){
  if(mode==='status')return status({root,home,epoch,runners});
  if(mode==='dry-run')return dryRun({root,home,epoch,runners});
  if(mode==='next')return next({root,home,epoch,runners});
  if(mode==='run-all')return runAll({root,home,epoch,runners});
  if(mode==='verify')return verify({root,home,epoch,runners});
  throw new Error('explicit mode required: status, dry-run, or next');
}
function parseMode(argv){
  if(argv.length!==1)throw new Error('select exactly one mode: --status, --dry-run, --verify, --next, or --run-all');
  const values={'--status':'status','--dry-run':'dry-run','--verify':'verify','--next':'next','--run-all':'run-all'};
  if(!values[argv[0]])throw new Error(`unsupported mode: ${argv[0]}`);
  return values[argv[0]];
}
function main(argv=process.argv.slice(2)){
  const result=run({mode:parseMode(argv)});process.stdout.write(JSON.stringify(result)+'\n');
  if(/^BLOCKED_/.test(result.decision||''))process.exitCode=2;
  return result;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=/^BLOCKED_/.test(error.message)?2:1;}}

module.exports={ROOT,PHASE_FLOW,STAGE3E_BUDGETS,TOTAL_RENDER_BUDGET,RUN_ALL_JOURNAL,readFinal,stage3eProgress,lockStatus,
  runAllLockStatus,status,finalizedStage,dryRun,verify,stage3eNextMode,dispatchNext,next,phaseRenderCount,runVerificationSuite,
  preMidSearchLowFullPlan,runPreMidSearchLowFull,snapshotEvidence,runReadOnlyFinalGate,buildRunAllReport,runAll,run,parseMode,main};
