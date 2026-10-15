'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const core=require('./issue7-current-build-core.cjs');
const stage3e=require('./run-issue7-stage3e-current-build.cjs');
const planner=require('./issue7-adaptive-mid-core.cjs');
const evaluator=require('./issue7-adaptive-mid-evaluator.cjs');

const ROOT=core.ROOT;
const EXTENSION='adaptive-mid-01';
const FIXTURE_REL='wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json';
const RUNNER_REL='wasm/plugins/dsp/super-synth/test/tools/run-issue7-adaptive-mid.cjs';
const PLANNER_REL='wasm/plugins/dsp/super-synth/test/tools/issue7-adaptive-mid-core.cjs';
const EVALUATOR_REL='wasm/plugins/dsp/super-synth/test/tools/issue7-adaptive-mid-evaluator.cjs';
const PARENT_EVALUATOR_REL='wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.cjs';
const GENERATION_REL='wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs';
const METRICS_REL='wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs';
const PARENT_PHASES=Object.freeze([
  ['baseline','STAGE3E_BASELINE_EQUIVALENCE_PASS',24],
  ['midi51-diagnostic',null,16],
  ['low-screen','STAGE3E_LOW_SCREEN_COMPLETE',1512],
  ['midi51-candidate-diagnostic','STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',80],
  ['low-full','STAGE3E_LOW_FULL_PASS',415],
  ['mid-screen','STAGE3E_MID_SCREEN_COMPLETE',108],
  ['midi51-final-diagnostic','STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE',80]
]);
const PARENT_RENDER_COUNT=2235;
const LOCK_REL='soraoto-agent-state/7/locks/current-build-v1.adaptive-mid-01.lock';

function fileSha(root,relative){return core.sha256(fs.readFileSync(path.join(root,relative)));}
function existsDual(roots,relative){const paths=core.dualPaths(roots,relative),exists=[fs.existsSync(paths.primary),fs.existsSync(paths.secondary)];
  if(exists[0]!==exists[1])throw new Error(`BLOCKED_ADAPTIVE_MID_DUAL_STORE: ${relative} exists in only one canonical store`);
  return exists[0];}
function readOptional(roots,relative){if(!existsDual(roots,relative))return null;const stored=core.readDualBytes(roots,relative),value=JSON.parse(stored.bytes.toString('utf8'));
  if(!stored.bytes.equals(core.canonicalBytes(value)))throw new Error(`BLOCKED_ADAPTIVE_MID_EVIDENCE: ${relative} is not canonical`);
  return {value,sha256:stored.sha256,bytes:stored.bytes};}
function writeImmutableObject(roots,relative,value){return core.writeImmutableDual(roots,relative,core.canonicalBytes(value));}
function baseRoots(root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory){
  return core.resolveRoots(root,'stage3e',epoch,{home,commonDirectory});
}
function sidecarRoots(root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory){
  const base=baseRoots(root,home,epoch,commonDirectory);
  return {...base,primary:path.join(base.primary,EXTENSION),secondary:path.join(base.secondary,EXTENSION),namespace:EXTENSION};
}
function oldPhaseExists(roots,phase){const relative=core.phaseRelative(phase,'phase-result.json');return existsDual(roots,relative);}
function buildParentManifest({root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory,identityOverride,creatorRevisionOverride,
  now=()=>new Date().toISOString()}={}){
  const roots=baseRoots(root,home,epoch,commonDirectory),record=stage3e.identityRecord(root),identity=identityOverride||stage3e.currentIdentity(root,record),parents={};
  if(oldPhaseExists(roots,'mid-full'))throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: old mid-full evidence exists; adaptive extension is not its replacement');
  if(existsDual(roots,'selection.json'))throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: legacy selection exists and conflicts with the approved extension schema');
  for(const [phase,expectedDecision,expectedCalls] of PARENT_PHASES){
    let final;try{final=core.readFinal(roots,phase);}catch(error){throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: ${phase} is not finalized: ${error.message}`);}
    core.verifyFinalizedIdentity({root,final,identity});
    if(!/^([a-f0-9]{64})$/.test(final.sha256||'')||!/^([a-f0-9]{64})$/.test(final.archiveSha256||''))
      throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: ${phase} result/archive SHA-256 pair is incomplete`);
    const actualDecision=final.result.decision;
    let knownFailEvidence;
    if(phase==='midi51-diagnostic'){
      if(!['STAGE3E_MIDI51_PASS','STAGE3E_MIDI51_DIAGNOSTIC_FAIL'].includes(actualDecision)||final.result.summary?.safe!==true
        ||final.result.summary?.diagnosticsComplete!==true)
        throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: initial MIDI51 diagnostic is not a safe complete result');
    }else if(actualDecision!==expectedDecision)throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: ${phase} decision is ${actualDecision}`);
    if(final.result.renderCount!==expectedCalls)throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: ${phase} render count is ${final.result.renderCount}, expected ${expectedCalls}`);
    if(phase==='low-full'&&(!final.result.summary?.selectedTuple||!final.result.summary?.candidates?.some(item=>item.pass===true
      &&core.same(item.tuple,final.result.summary.selectedTuple))))throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: low-full PASS is not bound to its selected candidate');
    if(phase==='midi51-final-diagnostic'){
      const summary=final.result.summary,candidates=summary?.candidates;
      if(!Array.isArray(candidates)||candidates.length!==5||!Array.isArray(summary.passingCandidates)||summary.passingCandidates.length!==0
        ||candidates.some(item=>item.safe!==true||item.diagnosticsComplete!==true||item.pass!==false))
        throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: final MIDI51 evidence must be the preserved safe complete 0/5 result');
      const knownFail=candidates.find(item=>core.same(item.tuple,{low:planner.LOW,mid:planner.KNOWN_FAIL_MID,bassHardness:planner.BASS_HARDNESS}));
      if(!knownFail||!Number.isFinite(knownFail.span?.errorDb)||knownFail.span.errorDb<=planner.LIMIT_DB)
        throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: approved mid=0.60 tuple is not a safe complete quality FAIL');
      knownFailEvidence={tuple:knownFail.tuple,spanErrorDb:knownFail.span.errorDb,safe:knownFail.safe,
        diagnosticsComplete:knownFail.diagnosticsComplete,result:'FAIL'};
    }
    parents[phase]={decision:actualDecision,renderCount:final.result.renderCount,resultSha256:final.sha256,archiveSha256:final.archiveSha256,
      executionPlanSha256:final.result.executionPlanSha256||final.executionPlanSha256||null,
      creatorRevision:final.manifest?.creatorRevision||final.manifest?.creatorCommit||null,...(knownFailEvidence?{knownFail:knownFailEvidence}:{})};
  }
  const count=Object.values(parents).reduce((sum,item)=>sum+item.renderCount,0);
  if(count!==PARENT_RENDER_COUNT)throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: immutable parent render total is ${count}, expected ${PARENT_RENDER_COUNT}`);
  const identitySha256=core.sha256(core.canonicalBytes(identity)),recordSha256=core.sha256(core.canonicalBytes(record));
  const helperHashes={};for(const relative of [RUNNER_REL,PLANNER_REL,EVALUATOR_REL,PARENT_EVALUATOR_REL,GENERATION_REL,METRICS_REL])helperHashes[relative]=fileSha(root,relative);
  const creatorRevision=creatorRevisionOverride||core.gitHead(root);
  const manifest={schemaVersion:1,schema:'issue7-stage3e-adaptive-parent/v1',issue:7,epoch,extension:EXTENSION,creatorRevision,
    sourceCommit:record.sourceCommit,recordSha256,identitySha256,identity,sourceHashes:{plugin:record.inputs.pluginC.sha256,presets:record.inputs.presets.sha256,
      generatedProfile:record.inputs.generatedProfile.sha256,referenceMetrics:record.inputs.referenceMetrics.sha256,
      stage3eWasm:record.builds.stage3e.wasm.sha256},helperHashes,parentRenderCount:count,parents};
  return {root,home,commonDirectory:roots.commonDirectory,roots,record,identity,manifest,identitySha256,recordSha256,
    parentManifestSha256:core.sha256(core.canonicalBytes(manifest))};
}
function verifyParentManifest({root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory,write=false,now=()=>new Date().toISOString()}={}){
  const roots=sidecarRoots(root,home,epoch,commonDirectory),existing=readOptional(roots,'parent-manifest.json');
  if(existing){
    const frozen=existing.value,record=stage3e.identityRecord(root);
    if(core.sha256(core.canonicalBytes(record))!==frozen.recordSha256)throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: base build identity record changed');
    let current,currentError;
    try{current=stage3e.currentIdentity(root,record);}catch(error){currentError=error;}
    if(currentError||!core.same(current,frozen.identity))verifyPromotedIdentity(root,home,epoch,commonDirectory,roots,frozen);
    if(!core.commitIsAncestor(root,frozen.creatorRevision))throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: extension creator revision is not an ancestor of current HEAD');
    const built=buildParentManifest({root,home,epoch,commonDirectory,identityOverride:frozen.identity,creatorRevisionOverride:frozen.creatorRevision,now});
    if(!core.same(frozen,built.manifest))
      throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: immutable parent manifest no longer matches the approved build and old evidence');
    return {...built,root,home,commonDirectory:roots.commonDirectory,roots,manifest:frozen,parentManifestSha256:existing.sha256};
  }
  const built=buildParentManifest({root,home,epoch,commonDirectory,now});
  if(!write)return {...built,roots};
  const manifest=built.manifest,stored=writeImmutableObject(roots,'parent-manifest.json',manifest);
  return {...built,root,home,commonDirectory:roots.commonDirectory,roots,manifest,parentManifestSha256:stored.sha256};
}
function assertPromotedDerivedIdentity(frozenIdentity,selection,derived){
  const links=derived?.stage3eSelectionSchema===selection.selection.schema
    &&derived.stage3eSelectionSha256===selection.selectionSha256
    &&derived.stage3eResultSha256===selection.final.sha256
    &&derived.stage3eIdentitySha256===core.sha256(core.canonicalBytes(selection.final.result.identity))
    &&derived.stage3eExtensionParentManifestSha256===selection.extension.parentManifestSha256
    &&derived.stage3eExtensionResultSha256===selection.extension.resultSha256
    &&core.same(derived.stage3eProbeResultSha256,selection.selection.probeResultSha256)
    &&derived.stage3eScreenResultSha256===selection.extension.screenResultSha256
    &&derived.stage3eFullResultSha256===selection.extension.fullResultSha256
    &&core.same(derived.selectedResponse,selection.tuple)
    &&derived.parentBuildIdentitySha256===frozenIdentity.buildIdentitySha256
    &&derived.parentSourceCommit===frozenIdentity.sourceCommit;
  if(!links)throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: Stage3 promotion identity does not bind this adaptive extension selection and frozen build');
  for(const role of ['stage3e','stage4'])
    if(derived.builds?.[role]?.cmakeCacheSha256!==frozenIdentity.builds?.[role]?.cmakeCacheSha256
      ||derived.builds?.[role]?.wasm?.sha256!==frozenIdentity.builds?.[role]?.wasmSha256)
      throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: immutable ${role} build changed during Stage3 promotion`);
  const before=frozenIdentity.builds?.production,after=derived.builds?.production;
  if(!before||!after||before.cmakeCacheSha256!==after.cmakeCacheSha256||before.wasmSha256===after.wasm?.sha256)
    throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: Stage3 production build identity is incomplete or does not represent a promoted build');
  const allowedInputs=new Set(['presets','generatedProfile']);
  if(!core.same(Object.keys(derived.inputs||{}).sort(),Object.keys(frozenIdentity.inputs||{}).sort()))
    throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: Stage3 production input set differs from the frozen build');
  for(const [key,beforeInput] of Object.entries(frozenIdentity.inputs||{})){
    const afterInput=derived.inputs[key];
    if(!afterInput||afterInput.path!==beforeInput.path||(!allowedInputs.has(key)&&afterInput.sha256!==beforeInput.sha256))
      throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: non-promotion input changed during Stage3 promotion: ${key}`);
  }
  return true;
}
function verifyPromotedIdentity(root,home,epoch,commonDirectory,roots,frozen){
  const parent=buildParentManifest({root,home,epoch,commonDirectory,identityOverride:frozen.identity,
    creatorRevisionOverride:frozen.creatorRevision});
  if(!core.same(parent.manifest,frozen))
    throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: frozen parent evidence or helper hashes changed during Stage3 promotion');
  for(const [relative,expected] of Object.entries(frozen.identity.helperInputs||{}))
    if(fileSha(root,relative)!==expected)throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: frozen Stage3E helper changed: ${relative}`);
  if(fileSha(root,'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.cjs')!==frozen.identity.runnerSha256)
    throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: frozen Stage3E runner changed');
  const selection=loadSelection(root,home,epoch,{commonDirectory,parentOverride:parent});
  if(!selection)throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: mutable Stage3E inputs changed before an immutable extension selection exists');
  assertAppliedTuple(root,selection.tuple);
  const stage3=require('./run-issue7-stage3-current-build.cjs');
  const stage3Roots=core.resolveRoots(root,'stage3',epoch,{home,commonDirectory});
  const stored=readOptional(stage3Roots,stage3.DERIVED_IDENTITY_REL);
  const actualProductionSha=core.sha256(fs.readFileSync(stage3.productionWasm(root,parent.record)));
  if(actualProductionSha===frozen.identity.builds.production.wasmSha256){
    // The dedicated tuple commit may be durable while its production rebuild is still pending.
    // Validate that exact commit and all live source/build inputs before allowing run-all to resume it.
    const promotion=stage3.promotionDetails(root,stored?.value);
    stage3.validatePromotionDetails(promotion,parent.record.sourceCommit);
    const snapshot=stage3.derivedBuildSnapshot(root,parent.record,selection.final.result.identity,promotion);
    if(snapshot.builds.production.wasm.sha256!==frozen.identity.builds.production.wasmSha256)
      throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: pending Stage3 production build does not match its frozen baseline');
    if(stored)throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: stored Stage3 identity exists before the promoted production WASM');
    return;
  }
  let production;
  try{production=stage3.deriveProductionBuildIdentity({root,record:parent.record,selection});}
  catch(error){throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: promoted Stage3 build cannot be verified: ${error.message}`);}
  assertPromotedDerivedIdentity(frozen.identity,selection,production.derived);
  if(stored&&!core.same(stored.value,production.derived))
    throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: stored Stage3 promotion identity differs from the verified production build');
}
function assertAppliedTuple(root,tuple){
  const presets=JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/presets.json'),'utf8'));
  const hammer=presets.concert_grand?.engine_config?.hammer,expected={velocity_launch_scale_low:tuple?.low,
    velocity_launch_scale_mid:tuple?.mid,velocity_hardness_scale_bass:tuple?.bassHardness};
  if(!hammer||Object.entries(expected).some(([key,value])=>!Number.isFinite(value)||hammer[key]!==value))
    throw new Error('BLOCKED_ADAPTIVE_MID_PARENT: promoted preset does not retain the extension-selected tuple');
  const profile=fs.readFileSync(path.join(root,'wasm/shared/generated/super-synth_grand_profiles.h'),'utf8');
  for(const [field,value] of Object.entries(expected)){
    const match=profile.match(new RegExp(`\\.${field}\\s*=\\s*([-+0-9.eE]+)f`));
    if(!match||Math.abs(Number(match[1])-value)>1e-6)throw new Error(`BLOCKED_ADAPTIVE_MID_PARENT: promoted profile differs at ${field}`);
  }
}
function makeExecutionPlan(parent){
  return {schemaVersion:1,schema:'issue7-stage3e-adaptive-mid-plan/v1',issue:7,epoch:parent.manifest.epoch,extension:EXTENSION,
    parentManifestSha256:parent.parentManifestSha256,creatorRevision:parent.manifest.creatorRevision,runnerSha256:parent.manifest.helperHashes[RUNNER_REL],
    plannerSha256:parent.manifest.helperHashes[PLANNER_REL],evaluatorSha256:parent.manifest.helperHashes[EVALUATOR_REL],
    search:{firstMid:0.55,knownFailMid:0.6,downwardGrid:[0.5,0.45,0.4,0.35],maxBisections:2,maxUniqueProbes:7,
      passGate:'safe && diagnosticsComplete && dynamic-span absolute error <= 8 dB',fixedDecimals:4},
    screen:{candidateCount:2,pitches:planner.PITCHES,velocities:planner.SCREEN_VELOCITIES,ranking:'existing rankMidCandidates'},
    full:{maxCandidates:2,pitches:planner.PITCHES,velocities:planner.OFFICIAL_VELOCITIES,cellsPerCandidate:64},
    budgets:{probes:planner.MAX_PROBE_CALLS,screen:planner.MAX_SCREEN_CALLS,full:planner.MAX_FULL_CALLS,total:planner.MAX_EXTENSION_CALLS,
      parent:planner.MAX_STAGE3E_CALLS,stage3:planner.MAX_STAGE3_CALLS,stage4:planner.MAX_STAGE4_CALLS,totalIssue7:planner.MAX_TOTAL_CALLS,
      global:planner.ISSUE7_GLOBAL_CAP}};
}
function ensureExecutionPlan(parent,{write=false}={}){
  const expected=makeExecutionPlan(parent),existing=readOptional(parent.roots,'execution-plan.json');
  if(existing){if(!core.same(existing.value,expected))throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: immutable execution plan differs from the approved contract');
    return {plan:existing.value,sha256:existing.sha256};}
  if(!write)return {plan:expected,sha256:core.sha256(core.canonicalBytes(expected))};
  return {plan:expected,...writeImmutableObject(parent.roots,'execution-plan.json',expected)};
}
function emptyLedger(parent,plan){return {schemaVersion:1,schema:'issue7-stage3e-adaptive-mid-ledger/v1',issue:7,epoch:parent.manifest.epoch,
  extension:EXTENSION,parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,renderCount:0,cells:{},probes:[],screen:null,full:[],decision:null};}
function readLedger(roots){const stored=readOptional(roots,'ledger.json');return stored?{ledger:stored.value,sha256:stored.sha256}:null;}
function writeLedger(roots,ledger){const stored=core.writeMutableDual(roots,'ledger.json',core.canonicalBytes(ledger));return {...stored,ledger};}
function ensureLedger(parent,plan,{write=false}={}){
  const found=readLedger(parent.roots);
  if(found){const ledger=found.ledger;
    if(ledger.schema!=='issue7-stage3e-adaptive-mid-ledger/v1'||ledger.parentManifestSha256!==parent.parentManifestSha256
      ||ledger.executionPlanSha256!==plan.sha256)throw new Error('BLOCKED_ADAPTIVE_MID_LEDGER: ledger is bound to a different parent manifest or execution plan');
    validateLedger(ledger);
    return found;
  }
  const ledger=emptyLedger(parent,plan);if(!write)return {ledger,sha256:core.sha256(core.canonicalBytes(ledger))};
  return writeLedger(parent.roots,ledger);
}
function validateLedger(ledger){
  const cells=Object.values(ledger.cells||{}),started=cells.filter(cell=>['IN_PROGRESS','COMPLETE','AMBIGUOUS'].includes(cell.state)).length;
  if(!Number.isSafeInteger(ledger.renderCount)||ledger.renderCount!==started||cells.some(cell=>!['probe','screen','full'].includes(cell.kind)
      ||!['IN_PROGRESS','COMPLETE','AMBIGUOUS','PENDING'].includes(cell.state)))
    throw new Error('BLOCKED_ADAPTIVE_MID_LEDGER: cell states or render count are invalid');
  const counts=planner.countCalls(ledger);
  if(counts.probes>planner.MAX_PROBE_CALLS||counts.screen>planner.MAX_SCREEN_CALLS||counts.full>planner.MAX_FULL_CALLS
      ||counts.total>planner.MAX_EXTENSION_CALLS)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: ledger exceeds an extension allocation');
  return true;
}
function appendEvent(roots,event,now){return core.appendDualJournal(roots,{schemaVersion:1,issue:7,epoch:core.EPOCH,extension:EXTENSION,occurredAt:now(),...event},{relative:'journal/events.jsonl'});}
function safeCellKey(key){if(typeof key!=='string'||!/^[A-Za-z0-9._-]+$/.test(key))throw new Error('BLOCKED_ADAPTIVE_MID_CELL: invalid cell key');return key;}
function cellRelative(key,suffix){return `cells/${safeCellKey(key)}.${suffix}.json`;}
function loadObservation(roots,cell,record){
  const marker=readOptional(roots,cellRelative(cell.key,'started')),stored=readOptional(roots,cellRelative(cell.key,'observation'));
  if(!marker||!stored||record?.state!=='COMPLETE'||record.markerSha256!==marker.sha256||record.observationSha256!==stored.sha256)
    throw new Error(`BLOCKED_ADAPTIVE_MID_CELL: completed observation is missing or differs for ${cell.key}`);
  const doc=stored.value;
  if(!core.same(marker.value.cell,cell)||!core.same(doc.cell,cell)||!doc.observation||typeof doc.observation!=='object')
    throw new Error(`BLOCKED_ADAPTIVE_MID_CELL: observation identity differs for ${cell.key}`);
  return doc.observation;
}
function markAmbiguous(roots,ledger,cell,reason,now){
  ledger.cells[cell.key]={...(ledger.cells[cell.key]||{}),key:cell.key,kind:cell.kind,state:'AMBIGUOUS',reason:String(reason),updatedAt:now()};
  writeLedger(roots,ledger);appendEvent(roots,{type:'CELL_AMBIGUOUS',key:cell.key,kind:cell.kind,reason:String(reason)},now);
}
function runCells({root,home,epoch,commonDirectory,parent,plan,ledger,cells,now,render=stage3e.renderDefault}={}){
  const keys=cells.map(cell=>cell.key);
  if(new Set(keys).size!==keys.length)throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: duplicate cell key in step');
  const step={schemaVersion:1,schema:'issue7-stage3e-adaptive-mid-step-plan/v1',issue:7,epoch,extension:EXTENSION,
    parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,ordinal:ledger.stepsCount||0,
    cells:cells.map(cell=>({key:cell.key,kind:cell.kind,pitch:cell.pitch,velocity:cell.velocity,candidate:cell.candidate,response:cell.response}))};
  const stepName=`steps/${cells[0]?.kind||'empty'}-${core.sha256(core.canonicalBytes(step)).slice(0,16)}.json`;
  const oldPlan=readOptional(parent.roots,stepName);
  if(oldPlan){if(!core.same(oldPlan.value,step))throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: stored step plan differs');}
  else writeImmutableObject(parent.roots,stepName,step);
  for(const cell of cells){
    const current=ledger.cells[cell.key];
    if(current?.state==='COMPLETE')continue;
    if(current?.state==='IN_PROGRESS'||current?.state==='AMBIGUOUS')throw new Error(`BLOCKED_ADAPTIVE_MID_AMBIGUOUS: prior render started for ${cell.key}; refusing to repeat it`);
    if(readOptional(parent.roots,cellRelative(cell.key,'started'))){
      markAmbiguous(parent.roots,ledger,cell,'start marker exists without a completed ledger row',now);
      throw new Error(`BLOCKED_ADAPTIVE_MID_AMBIGUOUS: start marker exists for ${cell.key}; refusing to repeat it`);
    }
    const currentIdentity=stage3e.currentIdentity(root,parent.record);
    if(!core.same(currentIdentity,parent.identity))throw new Error('BLOCKED_ADAPTIVE_MID_IDENTITY: frozen Stage3E build identity changed during extension');
    const started={schemaVersion:1,extension:EXTENSION,key:cell.key,kind:cell.kind,cell,identitySha256:parent.identitySha256,
      executionPlanSha256:plan.sha256,startedAt:now()};
    const marker=writeImmutableObject(parent.roots,cellRelative(cell.key,'started'),started);
    ledger.cells[cell.key]={key:cell.key,kind:cell.kind,state:'IN_PROGRESS',markerSha256:marker.sha256,startedAt:started.startedAt};
    ledger.renderCount+=1;
    const counts=planner.countCalls(ledger);planner.assertBudget({extension:counts,stage3Count:0,stage4Count:0});
    writeLedger(parent.roots,ledger);appendEvent(parent.roots,{type:'CELL_STARTED',key:cell.key,kind:cell.kind,markerSha256:marker.sha256},now);
    let observation;
    try{observation=render({root,record:parent.record,identity:parent.identity,cell});}
    catch(error){markAmbiguous(parent.roots,ledger,cell,error.message,now);throw new Error(`BLOCKED_ADAPTIVE_MID_AMBIGUOUS: ${cell.key}: ${error.message}`);}
    if(!observation||typeof observation!=='object'||Array.isArray(observation)){
      markAmbiguous(parent.roots,ledger,cell,'render returned no observation object',now);
      throw new Error(`BLOCKED_ADAPTIVE_MID_AMBIGUOUS: ${cell.key}: no observation object`);
    }
    const document={schemaVersion:1,extension:EXTENSION,key:cell.key,cell,observation,completedAt:now()};
    const stored=writeImmutableObject(parent.roots,cellRelative(cell.key,'observation'),document);
    ledger.cells[cell.key]={key:cell.key,kind:cell.kind,state:'COMPLETE',markerSha256:marker.sha256,observationSha256:stored.sha256,
      startedAt:started.startedAt,completedAt:document.completedAt};
    writeLedger(parent.roots,ledger);appendEvent(parent.roots,{type:'CELL_COMPLETED',key:cell.key,kind:cell.kind,observationSha256:stored.sha256},now);
  }
  return cells.map(cell=>({cellKey:cell.key,observation:{observation:loadObservation(parent.roots,cell,ledger.cells[cell.key])}}));
}
function persistStepResult(roots,relative,result,ledger,now){
  const stored=writeImmutableObject(roots,relative,result);appendEvent(roots,{type:'STEP_FINISHED',path:relative,decision:result.decision,resultSha256:stored.sha256},now);
  return {...stored,result};
}
function readStepResult(roots,relative){return readOptional(roots,relative);}
function probeResultPath(ordinal){return `probe-results/${String(ordinal).padStart(2,'0')}.json`;}
function screenResultPath(){return 'screen-result.json';}
function fullResultPath(){return 'full-result.json';}
function extensionResultPath(){return 'extension-result.json';}
function selectionPath(){return 'selection.json';}
function fixture(root){return JSON.parse(fs.readFileSync(path.join(root,FIXTURE_REL),'utf8'));}
function addProbeToLedger(parent,ledger,probe,now){
  const map=new Map(ledger.probes.map(item=>[item.ordinal,item]));map.set(probe.ordinal,probe);ledger.probes=[...map.values()].sort((a,b)=>a.ordinal-b.ordinal);
  writeLedger(parent.roots,ledger);appendEvent(parent.roots,{type:'PROBE_RECORDED',ordinal:probe.ordinal,mid:probe.mid,outcome:probe.outcome,resultSha256:probe.resultSha256},now);
}
function loadProbeHistory(parent,ledger){
  const probes=[];
  for(let ordinal=1;ordinal<=planner.MAX_PROBES;ordinal++){
    const stored=readStepResult(parent.roots,probeResultPath(ordinal));if(!stored)break;
    const value=stored.value;
    if(value.ordinal!==ordinal||value.parentManifestSha256!==parent.parentManifestSha256||value.resultSha256!==undefined)
      throw new Error(`BLOCKED_ADAPTIVE_MID_PROBE: probe ${ordinal} result binding is invalid`);
    probes.push({...value,resultSha256:stored.sha256});
  }
  if(ledger.probes.length&&!core.same(ledger.probes,probes))throw new Error('BLOCKED_ADAPTIVE_MID_LEDGER: probe ledger differs from immutable probe results');
  if(!core.same(ledger.probes,probes)){ledger.probes=probes;writeLedger(parent.roots,ledger);}
  return probes;
}
function makeProbe(parent,ledger,plan,step,now,render){
  const relative=probeResultPath(step.ordinal),existing=readStepResult(parent.roots,relative);
  if(existing)return existing;
  const cells=planner.probeCells(step.mid),rows=runCells({root:parent.root,home:parent.home,epoch:parent.manifest.epoch,
    commonDirectory:parent.commonDirectory,parent,plan,ledger,cells,now,render});
  const output=evaluator.evaluateProbe(rows.map(row=>row.observation.observation),fixture(parent.root));
  if(output.safe!==true||output.diagnosticsComplete!==true||!Number.isFinite(output.span?.errorDb))
    throw new Error(`BLOCKED_ADAPTIVE_MID_UNSAFE: probe ${step.mid.toFixed(4)} is unsafe, incomplete, or non-finite (${output.decision})`);
  const probe={schemaVersion:1,issue:7,epoch:parent.manifest.epoch,extension:EXTENSION,ordinal:step.ordinal,mid:step.mid,kind:step.kind,
    bracket:step.bracket||null,safe:output.safe,diagnosticsComplete:output.diagnosticsComplete,spanErrorDb:output.span.errorDb,
    outcome:output.adaptiveOutcome,decision:output.decision,summary:output,
    parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,
    cellKeys:cells.map(cell=>cell.key),cellObservationSha256:cells.map(cell=>ledger.cells[cell.key].observationSha256)};
  return persistStepResult(parent.roots,relative,probe,ledger,now);
}
function completeProbes(parent,plan,ledger,now,render){
  let history=loadProbeHistory(parent,ledger);
  for(let i=0;i<planner.MAX_PROBES;i++){
    const next=planner.nextProbe(history);
    if(next.done)return {decision:next.decision,passingCandidates:next.passingCandidates,probes:history};
    const stored=makeProbe(parent,ledger,plan,next,now,render),probe={...stored.value,resultSha256:stored.sha256};
    addProbeToLedger(parent,ledger,probe,now);history=loadProbeHistory(parent,ledger);
  }
  const next=planner.nextProbe(history);
  if(!next.done)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: probe planner requested more than seven unique probes');
  return {decision:next.decision,passingCandidates:next.passingCandidates,probes:history};
}
function completeScreen(parent,plan,ledger,probeSummary,now,render){
  const existing=readStepResult(parent.roots,screenResultPath());if(existing)return existing;
  const candidates=probeSummary.passingCandidates.slice(0,2),cells=planner.screenCells(candidates);
  if(!cells.length||cells.length>planner.MAX_SCREEN_CALLS)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: screen cell count is outside its approved cap');
  const rows=runCells({root:parent.root,home:parent.home,epoch:parent.manifest.epoch,commonDirectory:parent.commonDirectory,
    parent,plan,ledger,cells,now,render});
  const evaluation=evaluator.evaluateScreen(cells,rows,fixture(parent.root));
  const ranked=evaluation.ranked.slice(0,2);
  if(!ranked.length)throw new Error('BLOCKED_ADAPTIVE_MID_SCREEN: neither passing MIDI51 probe is eligible after the existing mid-screen objective');
  const screen={schemaVersion:1,issue:7,epoch:parent.manifest.epoch,extension:EXTENSION,decision:'ADAPTIVE_MID_SCREEN_COMPLETE',
    parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,probeCandidates:candidates.map(item=>item.mid),
    candidateCount:candidates.length,cells:cells.map(cell=>cell.key),evaluation,ranked,selectedCandidates:ranked.map(item=>({low:planner.LOW,mid:item.mid,bassHardness:planner.BASS_HARDNESS}))};
  return persistStepResult(parent.roots,screenResultPath(),screen,ledger,now);
}
function completeFull(parent,plan,ledger,screen,now,render){
  const existing=readStepResult(parent.roots,fullResultPath());if(existing)return existing;
  const candidates=screen.value.selectedCandidates.slice(0,2),candidateResults=[];
  for(const candidate of candidates){
    const cells=planner.fullCells(candidate);
    if(cells.length!==64)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: full candidate is not exactly 64 cells');
    const rows=runCells({root:parent.root,home:parent.home,epoch:parent.manifest.epoch,commonDirectory:parent.commonDirectory,
      parent,plan,ledger,cells,now,render});
    const evaluation=evaluator.evaluateFull(cells,rows,fixture(parent.root));
    const item=evaluation.candidates.find(row=>core.same(row.tuple,candidate));
    if(!item||item.pitchHealth!==true)throw new Error(`BLOCKED_ADAPTIVE_MID_FULL: ${candidate.mid} full result is unsafe or incomplete`);
    candidateResults.push({tuple:candidate,pass:item.pass===true,pitchHealth:item.pitchHealth,evaluation:item.evaluation,
      cellKeys:cells.map(cell=>cell.key),cellObservationSha256:cells.map(cell=>ledger.cells[cell.key].observationSha256)});
    const passing=candidateResults.find(row=>row.pass===true);
    if(passing)break;
  }
  const selected=candidateResults.find(item=>item.pass===true)||null;
  const result={schemaVersion:1,issue:7,epoch:parent.manifest.epoch,extension:EXTENSION,
    decision:selected?'ADAPTIVE_MID_FULL_PASS':'BLOCKED_ADAPTIVE_MID_FULL',pass:Boolean(selected),selectedTuple:selected?.tuple||null,
    parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,screenResultSha256:screen.sha256,
    candidates:candidateResults,maximumCandidates:2};
  return persistStepResult(parent.roots,fullResultPath(),result,ledger,now);
}
function terminalResult(parent,plan,ledger,{decision,probeSummary,screen,full,reason,now}){
  const counts=planner.countCalls(ledger),downstream=getDownstreamCounts(parent.root,parent.home,parent.manifest.epoch,parent.commonDirectory);
  const budget=planner.assertBudget({parentCount:PARENT_RENDER_COUNT,extension:counts,stage3Count:downstream.stage3,stage4Count:downstream.stage4});
  const result={schemaVersion:1,schema:'issue7-stage3e-adaptive-mid-result/v1',issue:7,epoch:parent.manifest.epoch,extension:EXTENSION,
    decision,parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,creatorRevision:parent.manifest.creatorRevision,
    parentRenderCount:PARENT_RENDER_COUNT,renderCount:counts.total,counts,probes:probeSummary?.probes||[],
    probeResultSha256:probeSummary?.probes?.map(item=>item.resultSha256)||[],screenResultSha256:screen?.sha256||null,
    fullResultSha256:full?.sha256||null,summary:{selectedTuple:full?.value?.selectedTuple||null,candidates:full?.value?.candidates||[],
      passingCandidates:probeSummary?.passingCandidates?.map(item=>({low:planner.LOW,mid:item.mid,bassHardness:planner.BASS_HARDNESS}))||[]},
    reason:reason||null,budget,completedAt:now()};
  const stored=writeImmutableObject(parent.roots,extensionResultPath(),result);
  ledger.decision=decision;ledger.extensionResultSha256=stored.sha256;writeLedger(parent.roots,ledger);
  return {...result,sha256:stored.sha256};
}
function createSelection(parent,plan,probeSummary,screen,full,terminal,now){
  if(full.value.decision!=='ADAPTIVE_MID_FULL_PASS'||!full.value.selectedTuple)throw new Error('BLOCKED_ADAPTIVE_MID_SELECTION: a passing full candidate is required');
  const selectedAt=now(),selection={schemaVersion:1,schema:'issue7-stage3e-extension-selection/v1',issue:7,epoch:parent.manifest.epoch,
    extension:EXTENSION,decision:'ADAPTIVE_MID_FULL_PASS',selectedResponse:full.value.selectedTuple,
    parent:{manifestSha256:parent.parentManifestSha256,renderCount:PARENT_RENDER_COUNT,
      lowFullResultSha256:parent.manifest.parents['low-full'].resultSha256,
      finalMidi51ResultSha256:parent.manifest.parents['midi51-final-diagnostic'].resultSha256,
      finalMidi51Outcome:'FAIL',finalMidi51PassingCandidates:0},
    probeResultSha256:probeSummary.probes.map(item=>item.resultSha256),screenResultSha256:screen.sha256,
    fullResultSha256:full.sha256,extensionResultSha256:terminal.sha256,identitySha256:parent.identitySha256,
    executionPlanSha256:plan.sha256,creatorRevision:parent.manifest.creatorRevision,selectedAt};
  const stored=writeImmutableObject(parent.roots,selectionPath(),selection);
  appendEvent(parent.roots,{type:'EXTENSION_SELECTION_CREATED',selectionSha256:stored.sha256,fullResultSha256:full.sha256,selectedResponse:selection.selectedResponse},now);
  return {selection,selectionSha256:stored.sha256};
}
function getDownstreamCounts(root,home,epoch,commonDirectory){
  const out={stage3:0,stage4:0};
  for(const stage of ['stage3','stage4']){const roots=core.resolveRoots(root,stage,epoch,{home,commonDirectory}),state=core.readPhaseLedger(roots,stage);out[stage]=state?.ledger?.renderCount||0;}
  return out;
}
function withAdaptiveLock(parent,action,now){
  const file=path.join(parent.commonDirectory,LOCK_REL),owner={schemaVersion:1,issue:7,epoch:parent.manifest.epoch,extension:EXTENSION,
    ownerId:crypto.randomUUID(),token:crypto.randomUUID(),pid:process.pid,hostname:os.hostname(),createdAt:now()};
  core.makeDirChain(parent.commonDirectory,path.dirname(file));let fd;
  try{fd=fs.openSync(file,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw new Error('BLOCKED_ADAPTIVE_MID_LOCK: another adaptive extension execution owns the sidecar lock');throw error;}
  try{const bytes=core.canonicalBytes(owner);let offset=0;while(offset<bytes.length)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);fs.fsyncSync(fd);}finally{fs.closeSync(fd);fd=undefined;}
  try{
    const result=action();
    const current=JSON.parse(fs.readFileSync(file,'utf8'));
    if(current.token!==owner.token||current.ownerId!==owner.ownerId)throw new Error('BLOCKED_ADAPTIVE_MID_LOCK_OWNER: lock owner changed');
    return result;
  }finally{
    let current;try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){throw new Error(`BLOCKED_ADAPTIVE_MID_LOCK_OWNER: lock readback failed: ${error.message}`);}
    if(current.token!==owner.token||current.ownerId!==owner.ownerId)throw new Error('BLOCKED_ADAPTIVE_MID_LOCK_OWNER: refusing to release another owner lock');
    fs.unlinkSync(file);
  }
}
function lockStatus(root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory){
  const roots=sidecarRoots(root,home,epoch,commonDirectory),file=path.join(roots.commonDirectory,LOCK_REL);
  if(!fs.existsSync(file))return {locked:false};
  try{const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())return {locked:true,ownerReadable:false,reason:'unsafe lock record'};
    return {locked:true,owner:JSON.parse(fs.readFileSync(file,'utf8'))};}
  catch(error){return {locked:true,ownerReadable:false,reason:error.message};}
}
function preflight(options={}){
  const parent=verifyParentManifest(options),plan=ensureExecutionPlan(parent),state=ensureLedger(parent,plan);
  const counts=planner.countCalls(state.ledger),downstream=getDownstreamCounts(options.root||ROOT,options.home||os.homedir(),options.epoch||core.EPOCH,options.commonDirectory);
  const budget=planner.assertBudget({parentCount:PARENT_RENDER_COUNT,extension:counts,stage3Count:downstream.stage3,stage4Count:downstream.stage4});
  validateLedger(state.ledger);
  return {parent,plan,state,counts,budget,downstream};
}
function run({mode,root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory,runAllOwner,now=()=>new Date().toISOString()}={}){
  if(!['dry-run','verify','execute'].includes(mode))throw new Error('explicit mode required: dry-run, verify, or execute');
  const options={root,home,epoch,commonDirectory,now};
  try{
    const prepared=preflight(options),{parent,plan,state,counts,budget}=prepared;
    const lock=lockStatus(root,home,epoch,commonDirectory);
    if(lock.locked)return {decision:'BLOCKED_ADAPTIVE_MID_LOCK',phase:EXTENSION,lock,builds:0,renders:0,writes:0,acousticRenders:0};
    if(mode==='dry-run')return {decision:'ADAPTIVE_MID_DRY_RUN_READY',phase:EXTENSION,counts,budget,identitySha256:parent.identitySha256,
      parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,builds:0,renders:0,writes:0,acousticRenders:0};
    if(mode==='verify')return {decision:'ADAPTIVE_MID_VERIFY_OK',phase:EXTENSION,started:Boolean(readLedger(parent.roots)),counts,
      parentManifestSha256:parent.parentManifestSha256,executionPlanSha256:plan.sha256,builds:0,renders:0,writes:0,acousticRenders:0};
    if(!runAllOwner)throw new Error('BLOCKED_ADAPTIVE_MID_RUN_ALL_REQUIRED: acoustic execution is permitted only inside the approved --run-all master lock');
    core.assertRunAllLockAccess(parent.commonDirectory,runAllOwner);
    return withAdaptiveLock(parent,()=>{
      const persistedParent=verifyParentManifest({...options,write:true});
      const persistedPlan=ensureExecutionPlan(persistedParent,{write:true});
      const persistedLedger=ensureLedger(persistedParent,persistedPlan,{write:true});
      return executeAdaptive({...prepared,parent:persistedParent,plan:persistedPlan,state:persistedLedger},now);
    },now);
  }catch(error){const decision=/^BLOCKED_[A-Z0-9_]+/.exec(error.message)?.[0]||'BLOCKED_ADAPTIVE_MID_EXECUTION';
    return {decision,phase:EXTENSION,reason:error.message,builds:0,renders:0,writes:0,acousticRenders:0};}
}
function executeAdaptive(prepared,now){
  const {parent,plan}=prepared;let ledger=ensureLedger(parent,plan,{write:true}).ledger;const startCount=planner.countCalls(ledger).total;
  appendEvent(parent.roots,{type:'EXTENSION_RUN_STARTED',creatorRevision:parent.manifest.creatorRevision,renderCount:startCount},now);
  let probeSummary,screen,full;
  try{
    const existingTerminal=readStepResult(parent.roots,extensionResultPath());
    if(existingTerminal){
      if(existingTerminal.value.decision==='ADAPTIVE_MID_FULL_PASS'&&!readOptional(parent.roots,selectionPath())){
        const probes=loadProbeHistory(parent,ledger),probeSummary={decision:'ADAPTIVE_MID_PROBES_COMPLETE',probes,
          passingCandidates:probes.filter(item=>item.outcome==='PASS').sort((a,b)=>b.mid-a.mid||Math.abs(a.spanErrorDb)-Math.abs(b.spanErrorDb)).slice(0,2)};
        const screen=readStepResult(parent.roots,screenResultPath()),full=readStepResult(parent.roots,fullResultPath());
        if(!screen||!full)throw new Error('BLOCKED_ADAPTIVE_MID_SELECTION: terminal PASS is missing immutable screen or full results');
        createSelection(parent,plan,probeSummary,screen,full,{value:existingTerminal.value,sha256:existingTerminal.sha256},now);
      }
      return {...existingTerminal.value,sha256:existingTerminal.sha256};
    }
    probeSummary=completeProbes(parent,plan,ledger,now,stage3e.renderDefault);
    ledger=readLedger(parent.roots).ledger;
    if(probeSummary.decision!=='ADAPTIVE_MID_PROBES_COMPLETE'){
      const terminal=terminalResult(parent,plan,ledger,{decision:'BLOCKED_NO_FEASIBLE_MID_RESPONSE',probeSummary,now});
      return {...terminal,phase:EXTENSION,acousticRenders:planner.countCalls(ledger).total-startCount,builds:0,renders:planner.countCalls(ledger).total-startCount,writes:1};
    }
    screen=completeScreen(parent,plan,ledger,probeSummary,now,stage3e.renderDefault);ledger=readLedger(parent.roots).ledger;
    const screenData=screen.value;
    if(!screenData.selectedCandidates?.length)throw new Error('BLOCKED_ADAPTIVE_MID_SCREEN: no eligible screen candidate');
    full=completeFull(parent,plan,ledger,screenData,now,stage3e.renderDefault);ledger=readLedger(parent.roots).ledger;
    const decision=full.value.decision;
    const terminal=terminalResult(parent,plan,ledger,{decision,probeSummary,screen,full,now});
    if(decision==='ADAPTIVE_MID_FULL_PASS')createSelection(parent,plan,probeSummary,screen,full,terminal,now);
    const calls=planner.countCalls(ledger).total-startCount;
    return {...terminal,phase:EXTENSION,acousticRenders:calls,builds:0,renders:calls,writes:calls+4};
  }catch(error){
    const current=readLedger(parent.roots)?.ledger||ledger,counts=planner.countCalls(current),calls=counts.total-startCount;
    const decision=/^BLOCKED_[A-Z0-9_]+/.exec(error.message)?.[0]||'BLOCKED_ADAPTIVE_MID_EXECUTION';
    appendEvent(parent.roots,{type:'EXTENSION_RUN_STOPPED',decision,reason:error.message,renderCount:counts.total},now);
    return {decision,phase:EXTENSION,reason:error.message,counts,acousticRenders:calls,builds:0,renders:calls,writes:calls+1};
  }
}
function loadFinalMaybe(root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory){
  const roots=sidecarRoots(root,home,epoch,commonDirectory),stored=readOptional(roots,extensionResultPath());return stored?{...stored.value,sha256:stored.sha256}:null;
}
function loadSelection(root=ROOT,home=os.homedir(),epoch=core.EPOCH,{commonDirectory,parentOverride}={}){
  const base=baseRoots(root,home,epoch,commonDirectory),roots=sidecarRoots(root,home,epoch,commonDirectory),stored=readOptional(roots,selectionPath());
  if(!stored)return null;
  const parent=parentOverride||verifyParentManifest({root,home,epoch,commonDirectory}),plan=ensureExecutionPlan(parent),result=readOptional(roots,extensionResultPath()),full=readOptional(roots,fullResultPath()),screen=readOptional(roots,screenResultPath());
  const selection=stored.value;
  const probeResults=[];
  for(let ordinal=1;ordinal<=selection.probeResultSha256?.length;ordinal++){
    const probe=readOptional(roots,probeResultPath(ordinal));
    if(!probe||probe.sha256!==selection.probeResultSha256[ordinal-1])throw new Error(`BLOCKED_ADAPTIVE_MID_SELECTION: probe ${ordinal} result SHA differs`);
    probeResults.push(probe);
  }
  if(!result||!full||!screen||selection.schema!=='issue7-stage3e-extension-selection/v1'||selection.decision!=='ADAPTIVE_MID_FULL_PASS'
    ||!Array.isArray(selection.probeResultSha256)||selection.probeResultSha256.length<1||selection.probeResultSha256.length>planner.MAX_PROBES
    ||result.value.decision!=='ADAPTIVE_MID_FULL_PASS'||selection.parent?.manifestSha256!==parent.parentManifestSha256
    ||selection.identitySha256!==parent.identitySha256||selection.executionPlanSha256!==plan.sha256
    ||selection.extensionResultSha256!==result.sha256||selection.fullResultSha256!==full.sha256||selection.screenResultSha256!==screen.sha256
    ||result.value.parentManifestSha256!==parent.parentManifestSha256||result.value.executionPlanSha256!==plan.sha256
    ||result.value.fullResultSha256!==full.sha256||result.value.screenResultSha256!==screen.sha256
    ||!core.same(result.value.probeResultSha256,selection.probeResultSha256)
    ||result.value.creatorRevision!==parent.manifest.creatorRevision
    ||!core.same(selection.selectedResponse,full.value.selectedTuple)||selection.parent.lowFullResultSha256!==parent.manifest.parents['low-full'].resultSha256
    ||selection.parent.finalMidi51ResultSha256!==parent.manifest.parents['midi51-final-diagnostic'].resultSha256
    ||selection.parent.finalMidi51Outcome!=='FAIL'||selection.parent.finalMidi51PassingCandidates!==0)
    throw new Error('BLOCKED_ADAPTIVE_MID_SELECTION: extension selection does not match its immutable parent, probe, screen, and full evidence');
  const selectedFull=full.value.candidates.find(item=>item.pass===true&&core.same(item.tuple,selection.selectedResponse));
  if(!selectedFull)throw new Error('BLOCKED_ADAPTIVE_MID_SELECTION: selected tuple has no passing full result');
  const final={sha256:full.sha256,result:{decision:'ADAPTIVE_MID_FULL_PASS',identity:parent.identity,
    executionPlanSha256:plan.sha256,summary:{selectedTuple:selection.selectedResponse,candidates:full.value.candidates,syntheticTest:false}},
    manifest:{creatorRevision:parent.manifest.creatorRevision},executionPlan:{identity:parent.identity,creatorRevision:parent.manifest.creatorRevision}};
  return {roots:base,selection,selectionSha256:stored.sha256,tuple:selection.selectedResponse,final,extensionSelection:true,
    extension:{roots,selection,selectionSha256:stored.sha256,parentManifest:parent.manifest,parentManifestSha256:parent.parentManifestSha256,
      result:result.value,resultSha256:result.sha256,screen:screen.value,screenResultSha256:screen.sha256,full:full.value,fullResultSha256:full.sha256,
      plan:plan.plan,executionPlanSha256:plan.sha256}};
}
function verify({root=ROOT,home=os.homedir(),epoch=core.EPOCH,commonDirectory}={}){
  const prepared=preflight({root,home,epoch,commonDirectory}),selection=loadSelection(root,home,epoch,{commonDirectory});
  const ledger=prepared.state.ledger;
  for(const cell of Object.values(ledger.cells||{})){
    if(cell.state==='IN_PROGRESS'||cell.state==='AMBIGUOUS')throw new Error(`BLOCKED_ADAPTIVE_MID_AMBIGUOUS: ${cell.key} has a started render without a verified completion`);
    if(cell.state==='COMPLETE'){
      const started=readOptional(prepared.parent.roots,cellRelative(cell.key,'started'));
      const observed=readOptional(prepared.parent.roots,cellRelative(cell.key,'observation'));
      if(!started||started.sha256!==cell.markerSha256||!observed||observed.sha256!==cell.observationSha256
        ||started.value.identitySha256!==prepared.parent.identitySha256||started.value.executionPlanSha256!==prepared.plan.sha256)
        throw new Error(`BLOCKED_ADAPTIVE_MID_EVIDENCE: cell record is inconsistent for ${cell.key}`);
    }
  }
  if(selection)return {decision:'ADAPTIVE_MID_VERIFY_OK',selectedResponse:selection.tuple,selectionSha256:selection.selectionSha256,
    parentManifestSha256:selection.extension.parentManifestSha256,renderCount:prepared.counts.total,builds:0,renders:0,writes:0,acousticRenders:0};
  const result=loadFinalMaybe(root,home,epoch,commonDirectory);
  if(result&&/^BLOCKED_/.test(result.decision))throw new Error(`BLOCKED_ADAPTIVE_MID_RESULT: ${result.decision}`);
  if(result&&result.decision==='ADAPTIVE_MID_FULL_PASS')throw new Error('BLOCKED_ADAPTIVE_MID_SELECTION: passing extension result has no immutable selection');
  return {decision:'ADAPTIVE_MID_VERIFY_OK',result:result?.decision||null,renderCount:prepared.counts.total,
    parentManifestSha256:prepared.parent.parentManifestSha256,builds:0,renders:0,writes:0,acousticRenders:0};
}

module.exports={ROOT,EXTENSION,PARENT_PHASES,PARENT_RENDER_COUNT,baseRoots,sidecarRoots,buildParentManifest,verifyParentManifest,assertPromotedDerivedIdentity,
  makeExecutionPlan,ensureExecutionPlan,readLedger,validateLedger,preflight,lockStatus,loadFinalMaybe,loadSelection,verify,run};
