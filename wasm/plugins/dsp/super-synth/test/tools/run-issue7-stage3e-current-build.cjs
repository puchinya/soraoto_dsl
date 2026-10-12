'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const core=require('./issue7-current-build-core.cjs');
const productionCapture=require('./capture-supersynth-matrix.cjs');
const diagnosticCapture=require('./capture-supersynth-stage3e-matrix.cjs');
const search=require('./stage3e-search-core.cjs');
const generation=require('./stage3e-generation2-core.cjs');
const directMetrics=require('./stage3-direct-reference-metrics.cjs');

const ROOT=core.ROOT;
const STAGE='stage3e';
const DEFAULT_RESPONSE=Object.freeze({low:1,mid:1,bassHardness:1});
const BASELINE_FIELDS=generation.BASELINE_METRIC_FIELDS;
// The accepted Generation-2 helper keeps its MIDI41 diagnostic field list private.
const MIDI41_FIELDS=Object.freeze(['velocityDerivative','velocityDerivativeWindowMs']);
const MIDI51_VELOCITIES=Object.freeze([...search.OFFICIAL_VELOCITIES]);
const PHASE_SEQUENCE=Object.freeze([
  ['baseline','STAGE3E_BASELINE_EQUIVALENCE_PASS'],['midi51-diagnostic','STAGE3E_MIDI51_PASS'],
  ['low-screen','STAGE3E_LOW_SCREEN_COMPLETE'],['low-full','STAGE3E_LOW_FULL_PASS'],
  ['mid-screen','STAGE3E_MID_SCREEN_COMPLETE'],['mid-full','STAGE3E_MID_FULL_PASS']
]);
const AUTH_DIR='.agent-state/issues/7/current-build-v1/authorizations';
const EXTRA_INPUTS=Object.freeze([
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs'
]);

function fileSha(root,relative){return core.sha256(fs.readFileSync(path.join(root,relative)));}
function identityRecord(root=ROOT){return JSON.parse(fs.readFileSync(path.join(root,'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json'),'utf8'));}
function currentIdentity(root=ROOT,record=identityRecord(root)){
  const base=core.hashInputs(root,record),helperInputs={};
  for(const relative of EXTRA_INPUTS)helperInputs[relative]=fileSha(root,relative);
  return {...base,helperInputs,runnerSha256:fileSha(root,'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3e-current-build.cjs')};
}
function buildDirectory(root,record,role){
  const item=record.builds?.[role];if(!item)throw new Error(`BLOCKED_STAGE3E_BUILD_IDENTITY: missing ${role} build`);
  return path.resolve(root,item.buildDirectory);
}
function assertBuildExports(root,record){
  const names={};
  for(const role of ['production','stage3e','stage4']){
    const build=record.builds[role],wasmPath=path.join(root,build.buildDirectory,build.wasm.path);
    const module=new WebAssembly.Module(fs.readFileSync(wasmPath));
    names[role]=new Set(WebAssembly.Module.exports(module).map(entry=>entry.name));
  }
  const productionDiagnostic=[...names.production].filter(name=>name.includes('stage3e_'));
  if(productionDiagnostic.length)throw new Error('BLOCKED_STAGE3E_BUILD_IDENTITY: production exports Stage3E controls');
  for(const name of ['soraoto_supersynth_stage3e_set_velocity_response','soraoto_supersynth_stage3e_get_low','soraoto_supersynth_stage3e_get_mid','soraoto_supersynth_stage3e_get_bass_hardness',
    'soraoto_supersynth_stage2m_set_factor_mask','soraoto_supersynth_stage2m_get_factor_mask','soraoto_supersynth_guard_hit_count'])
    if(!names.stage3e.has(name))throw new Error(`BLOCKED_STAGE3E_BUILD_IDENTITY: missing Stage3E export ${name}`);
  for(const name of ['soraoto_supersynth_active_voice_count','soraoto_supersynth_guard_hit_count'])
    if(!names.stage4.has(name))throw new Error(`BLOCKED_STAGE3E_BUILD_IDENTITY: missing Stage4 export ${name}`);
  return Object.fromEntries(Object.entries(names).map(([role,set])=>[role,[...set].sort()]));
}
function numberToken(value){return String(value).replace(/\./g,'p').replace(/-/g,'m');}
function coordinateToken(cell){return cell.velocityNormalized!==undefined&&cell.pitch===41?`n${Math.round(cell.velocityNormalized*1000)}`:String(cell.velocity);}
function baselineCoordinates(){
  return [
    ...search.BASELINE_EQUIVALENCE_CELLS.map(([pitch,velocity])=>({kind:'direct',pitch,velocity,velocityNormalized:velocity/127})),
    ...search.MIDI41_NORMALIZED.map(velocityNormalized=>({kind:'midi41-derivative',pitch:41,velocity:Math.round(velocityNormalized*127),velocityNormalized,velocityDerivativeWindowMs:[30,180]}))
  ];
}
function baselineCells(){
  return baselineCoordinates().flatMap(coordinate=>['production','stage3e'].map(buildRole=>({
    ...coordinate,phase:'baseline',buildRole,response:DEFAULT_RESPONSE,
    key:`${buildRole}-${coordinate.pitch}-${coordinateToken(coordinate)}`
  })));
}
function midi51Cells(){return MIDI51_VELOCITIES.map(velocity=>({phase:'midi51-diagnostic',buildRole:'stage3e',pitch:51,velocity,velocityNormalized:velocity/127,
  includeSoundboardDiagnostics:true,response:DEFAULT_RESPONSE,key:`stage3e-51-${velocity}`}));}
function authPath(root,phase){return path.join(root,AUTH_DIR,`${STAGE}-${phase}.json`);}
function readAuth(root,phase,provided){
  if(provided!==undefined)return {authorization:provided,bytes:core.canonicalBytes(provided),sha256:core.sha256(core.canonicalBytes(provided))};
  return core.readAuthorization(root,{path:authPath(root,phase)});
}
function gitHead(root){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function phaseManifest({root,record,identity,authorizationHash,phase,cells,now}){
  const helpers=identity.helperInputs;
  return {schemaVersion:1,issue:7,epoch:core.EPOCH,stage:STAGE,phase,candidateId:`issue7-${core.EPOCH}-${phase}`,
    creatorCommit:gitHead(root),sourceCommit:record.sourceCommit,referenceFixtureSha256:record.inputs.referenceMetrics.sha256,
    sourcePluginSha256:record.inputs.pluginC.sha256,presetsSha256:record.inputs.presets.sha256,profileSha256:record.inputs.generatedProfile.sha256,
    captureHelperSha256:helpers['wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs'],
    evaluatorSha256:helpers['wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs'],
    runnerSha256:identity.runnerSha256,builds:identity.builds,identity,primaryWasmSha256:record.builds.stage3e.wasm.sha256,
    authorizationSha256:authorizationHash,authorizedCellKeys:cells.map(cell=>cell.key),renderBudget:cells.length,createdAt:now()};
}
function captureOptions(cell){
  const baselineDiagnostics=cell.phase==='baseline'&&cell.pitch===41;
  return {includeVelocityDerivative:cell.pitch===41,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,
    includeSoundboardDiagnostics:baselineDiagnostics||cell.includeSoundboardDiagnostics===true};
}
function withBuild(root,record,role,action){
  const key='SORAOTO_WASM_BUILD_DIR',prior=process.env[key];
  process.env[key]=buildDirectory(root,record,role);
  try{return action();}finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
}
function renderDefault({root=ROOT,record,cell}={}){
  const normalized=cell.velocityNormalized??cell.velocity/127,options=captureOptions(cell),response=cell.response||DEFAULT_RESPONSE;
  if(cell.buildRole==='stage3e'){
    const captured=withBuild(root,record,'stage3e',()=>diagnosticCapture.renderNormalized(cell.pitch,normalized,response,options));
    return {...captured,kind:cell.kind||cell.phase,buildRole:cell.buildRole};
  }
  if(cell.buildRole==='production'){
    const captured=withBuild(root,record,'production',()=>productionCapture.renderNormalized(cell.pitch,normalized,{},options));
    const metrics=captured.metrics||captured;
    return {pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:normalized,kind:cell.kind||cell.phase,buildRole:cell.buildRole,metrics};
  }
  throw new Error(`BLOCKED_STAGE3E_BUILD_ROLE: ${cell.buildRole}`);
}
function compareValue(expected,actual,{pathName='metric',tolerance=1e-6,differences=[],maxDifference={value:0}}={}){
  if(typeof expected==='number'&&typeof actual==='number'){
    if(!Number.isFinite(expected)||!Number.isFinite(actual)){if(expected!==actual)differences.push(`${pathName}: non-finite or missing`);return;}
    const delta=Math.abs(expected-actual);maxDifference.value=Math.max(maxDifference.value,delta);
    if(delta>tolerance)differences.push(`${pathName}: ${expected} vs ${actual} (delta ${delta})`);
    return;
  }
  if(Array.isArray(expected)||Array.isArray(actual)){
    if(!Array.isArray(expected)||!Array.isArray(actual)||expected.length!==actual.length){differences.push(`${pathName}: array shape mismatch`);return;}
    expected.forEach((value,index)=>compareValue(value,actual[index],{pathName:`${pathName}[${index}]`,tolerance,differences,maxDifference}));return;
  }
  if(expected&&typeof expected==='object'||actual&&typeof actual==='object'){
    if(!expected||!actual||typeof expected!=='object'||typeof actual!=='object'){differences.push(`${pathName}: missing object`);return;}
    const keys=[...new Set([...Object.keys(expected),...Object.keys(actual)])].sort();
    for(const key of keys)compareValue(expected[key],actual[key],{pathName:`${pathName}.${key}`,tolerance,differences,maxDifference});return;
  }
  if(expected!==actual)differences.push(`${pathName}: ${String(expected)} vs ${String(actual)}`);
}
function compareBaseline(rows,{tolerance=1e-6}={}){
  const byKey=new Map(rows.map(row=>[row.cellKey,row.observation?.observation||row.observation]));
  const differences=[],maxDifference={value:0};
  for(const coordinate of baselineCoordinates()){
    const token=coordinateToken(coordinate),prod=byKey.get(`production-${coordinate.pitch}-${token}`),diag=byKey.get(`stage3e-${coordinate.pitch}-${token}`);
    if(!prod||!diag){differences.push(`missing pair ${coordinate.pitch}:${token}`);continue;}
    const fields=[...BASELINE_FIELDS,...(coordinate.pitch===41?MIDI41_FIELDS:[])];
    for(const field of fields){
      if(!(field in (prod.metrics||{}))||!(field in (diag.metrics||{}))){differences.push(`${coordinate.pitch}:${token}.${field}: missing`);continue;}
      compareValue(prod.metrics[field],diag.metrics[field],{pathName:`${coordinate.pitch}:${token}.${field}`,tolerance,differences,maxDifference});
    }
  }
  return {decision:differences.length?'BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT':'STAGE3E_BASELINE_EQUIVALENCE_PASS',pass:differences.length===0,
    cellCount:rows.length/2,pairCount:rows.length/2,maximumDifference:maxDifference.value,tolerance,differences:differences.slice(0,100)};
}
function referenceByPitchVelocity(fixture){return new Map((fixture.directCells||[]).map(row=>[`${row.pitch}:${row.velocity}`,row]));}
function diagnoseMidi51(rows){
  const fields=['effectiveHardness','initialHammerVelocity','contactDurationSamples','peakForce','maxCompression','postContactTransverseEnergy'];
  const complete=rows.every(row=>fields.every(field=>Number.isFinite(row.metrics?.stage2mHammer?.[field]))
    &&row.metrics?.soundboardDiagnostics&&row.metrics?.stage3eVelocityResponse&&Number.isFinite(row.metrics?.fullRenderPeakDbfs));
  return {diagnosed:complete,physicallyProved:false,channels:{
    velocityToLaunch:rows.map(row=>({velocity:row.velocity,response:row.metrics?.stage3eVelocityResponse,derivative:row.metrics?.velocityDerivative??null})),
    velocityToFeltHardness:rows.map(row=>({velocity:row.velocity,effectiveHardness:row.metrics?.stage2mHammer?.effectiveHardness??null})),
    effectiveContact:rows.map(row=>({velocity:row.velocity,hammer:row.metrics?.stage2mHammer||null})),
    radiationAndOutput:rows.map(row=>({velocity:row.velocity,soundboard:row.metrics?.soundboardDiagnostics||null,fullRenderPeakDbfs:row.metrics?.fullRenderPeakDbfs??null}))
  }};
}
function evaluateMidi51(rows,fixture){
  const refs=referenceByPitchVelocity(fixture),actual=[],reference=[];
  for(const velocity of MIDI51_VELOCITIES){
    const row=rows.find(item=>item.pitch===51&&item.velocity===velocity),ref=refs.get(`51:${velocity}`);
    if(!row||!ref||!Number.isFinite(row.metrics?.envelopeDbfs?.[3])||!Number.isFinite(ref.metrics?.envelopeDbfs?.[3]))
      return {decision:'BLOCKED_STAGE3E_MID_RESPONSE_EVIDENCE',pass:false,missingVelocity:velocity,diagnosis:diagnoseMidi51(rows)};
    actual.push(row.metrics.envelopeDbfs[3]);reference.push(ref.metrics.envelopeDbfs[3]);
  }
  const span=directMetrics.dynamicSpanMetrics(actual,reference),safe=generation.safetyPass(rows),diagnosis=diagnoseMidi51(rows);
  const pass=safe&&diagnosis.diagnosed&&span.errorDb<=generation.LIMITS.dynamicSpanErrorDb;
  const decision=!diagnosis.diagnosed?'BLOCKED_STAGE3E_MID_DIAGNOSTICS':pass?'STAGE3E_MIDI51_PASS':'BLOCKED_STAGE3E_MID_RESPONSE_FAMILY';
  return {decision,pass,safe,diagnosticsComplete:diagnosis.diagnosed,
    freshCurrentBuild:true,velocityCount:rows.length,span,limitDb:generation.LIMITS.dynamicSpanErrorDb,diagnosis};
}
function valueToken(value){return numberToken(value);}
function candidateKey(tuple){return `l${valueToken(tuple.low)}-m${valueToken(tuple.mid)}-b${valueToken(tuple.bassHardness)}`;}
function cellToken(cell){return cell.velocityNormalized!==undefined&&cell.pitch===41?`n${Math.round(cell.velocityNormalized*1000)}`:String(cell.velocity);}
function lowScreenCells(tuple){
  return search.lowScreenCells().map(cell=>({...cell,phase:'low-screen',buildRole:'stage3e',candidate:tuple,response:{low:tuple.low,mid:1,bassHardness:tuple.bassHardness},
    key:`low-screen-${candidateKey(tuple)}-${cell.pitch}-${cellToken(cell)}`}));
}
function midScreenCells(tuple){
  return search.midScreenCells().map(cell=>({...cell,phase:'mid-screen',buildRole:'stage3e',candidate:tuple,response:{...tuple},
    key:`mid-screen-${candidateKey(tuple)}-${cell.pitch}-${cellToken(cell)}`}));
}
function fullCells(tuple,phase){
  const cells=phase==='low-full'?search.lowFullCells():search.midFullCells();
  return cells.map(cell=>({...cell,phase,buildRole:'stage3e',candidate:tuple,response:{...tuple},key:`${phase}-${candidateKey(tuple)}-${cell.pitch}-${cellToken(cell)}`}));
}
function loadFinalMaybe(roots,phase){
  const rel=core.phaseRelative(phase,'phase-result.json'),p=core.dualPaths(roots,rel);
  if(!fs.existsSync(p.primary)&&!fs.existsSync(p.secondary))return null;
  return core.readFinal(roots,phase).result;
}
function rowsForPhase(roots,phase){
  const state=core.readPhaseLedger(roots,phase);if(!state)throw new Error(`BLOCKED_STAGE3E_PHASE_MISSING: ${phase}`);
  const rows=[];
  for(const key of state.manifest.authorizedCellKeys){const cell=core.readCell(roots,phase,key);if(cell.cell.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3E_PHASE_INCOMPLETE: ${key}`);rows.push({cellKey:key,observation:cell.observation});}
  return rows;
}
function phaseCompletedWith(roots,phase,decision){
  const result=loadFinalMaybe(roots,phase);if(!result)throw new Error(`BLOCKED_STAGE3E_PHASE_REQUIRED: ${phase}`);
  if(result.decision!==decision)throw new Error(`BLOCKED_STAGE3E_PHASE_DECISION: ${phase} is ${result.decision}`);
  return result;
}
function screenLowerBounds(rows,fixture,pitches){
  const ref=referenceByPitchVelocity(fixture),result={};
  for(const pitch of pitches){
    const low=rows.find(row=>row.pitch===pitch&&row.velocity===14)?.metrics?.envelopeDbfs?.[3];
    const high=rows.find(row=>row.pitch===pitch&&row.velocity===124)?.metrics?.envelopeDbfs?.[3];
    const refLow=ref.get(`${pitch}:14`)?.metrics?.envelopeDbfs?.[3],refHigh=ref.get(`${pitch}:124`)?.metrics?.envelopeDbfs?.[3];
    if(![low,high,refLow,refHigh].every(Number.isFinite)){result[pitch]={proven:false,reason:'missing or non-finite endpoints'};continue;}
    const lowerBoundDb=Math.abs(high-low)-Math.abs(refHigh-refLow);
    result[pitch]={proven:Number.isFinite(lowerBoundDb)&&lowerBoundDb>generation.LIMITS.dynamicSpanErrorDb,lowerBoundDb,
      decision:Number.isFinite(lowerBoundDb)&&lowerBoundDb>generation.LIMITS.dynamicSpanErrorDb?'PROVEN_UNABLE_TO_PASS_8_DB':'FULL_REQUIRED'};
  }
  return result;
}
function evaluateScreen(phase,cells,rows,fixture){
  const byCandidate=new Map();
  for(const cell of cells){const key=candidateKey(cell.candidate);if(!byCandidate.has(key))byCandidate.set(key,{tuple:cell.candidate,rows:[]});
    const stored=rows.find(row=>row.cellKey===cell.key);if(stored)byCandidate.get(key).rows.push(stored.observation.observation);}
  const results=[];
  for(const entry of byCandidate.values()){
    const output=phase==='low-screen'?generation.lowScreenResult(entry.tuple,entry.rows,fixture):generation.midScreenResult(entry.tuple,entry.rows,fixture);
    output.lowerBounds=screenLowerBounds(entry.rows,fixture,phase==='low-screen'?[36,39,42]:[48,51,54,57]);
    output.provenUnableToPass=Object.values(output.lowerBounds).some(value=>value.proven);
    results.push(output);
  }
  const ranked=phase==='low-screen'?search.rankLowCandidates(results):search.rankMidCandidates(results);
  return {decision:ranked.length?(phase==='low-screen'?'STAGE3E_LOW_SCREEN_COMPLETE':'STAGE3E_MID_SCREEN_COMPLETE'):'BLOCKED_STAGE3E_SCREEN_NO_ELIGIBLE_CANDIDATE',
    pass:ranked.length>0,candidateCount:results.length,eligibleCount:ranked.length,ranked,topFive:search.topFive(ranked)};
}
function evaluateFull(phase,cells,rows,fixture){
  const byCandidate=new Map();
  for(const cell of cells){const key=candidateKey(cell.candidate);if(!byCandidate.has(key))byCandidate.set(key,{tuple:cell.candidate,rows:[]});
    const stored=rows.find(row=>row.cellKey===cell.key);if(stored)byCandidate.get(key).rows.push(stored.observation.observation);}
  const candidates=[];
  for(const entry of byCandidate.values()){
    const evaluation=phase==='low-full'?generation.validateLowFullRows(entry.rows,fixture):generation.validateFullRows(entry.rows,{pitches:[48,51,54,57],fixture});
    candidates.push({tuple:entry.tuple,...evaluation});
  }
  const passing=candidates.filter(candidate=>candidate.pass===true),selected=passing[0]||null;
  return {decision:selected?(phase==='low-full'?'STAGE3E_LOW_FULL_PASS':'STAGE3E_MID_FULL_PASS'):
      (phase==='low-full'?'BLOCKED_STAGE3E_LOW_FULL':'BLOCKED_STAGE3E_MID_FULL'),pass:Boolean(selected),candidates,selectedTuple:selected?.tuple||null};
}
function nextEvidencePhase(root=ROOT,home=os.homedir(),epoch=core.EPOCH){
  const roots=core.resolveRoots(root,STAGE,epoch,{home});
  for(const [phase,success] of PHASE_SEQUENCE){
    const result=loadFinalMaybe(roots,phase);
    if(result){if(result.decision!==success)return {phase,blocked:result.decision};continue;}
    return {phase};
  }
  return {phase:null,complete:true};
}
function expectedPhaseForMode(root,home,mode,epoch=core.EPOCH){
  const next=nextEvidencePhase(root,home,epoch);
  if(next.blocked)return null;
  if(mode==='baseline')return next.phase==='baseline'?'baseline':null;
  if(mode==='screen')return ['midi51-diagnostic','low-screen','mid-screen'].includes(next.phase)?next.phase:null;
  if(mode==='full')return ['low-full','mid-full'].includes(next.phase)?next.phase:null;
  return null;
}
function authorizedCells(root,phase,authorization,roots,fixture){
  if(phase==='baseline')return baselineCells();
  if(phase==='midi51-diagnostic'){
    phaseCompletedWith(roots,'baseline','STAGE3E_BASELINE_EQUIVALENCE_PASS');
    return midi51Cells();
  }
  if(phase==='low-screen'){
    phaseCompletedWith(roots,'midi51-diagnostic','STAGE3E_MIDI51_PASS');
    const candidates=authorization?.candidateTuples;
    if(!Array.isArray(candidates)||!candidates.length)throw new Error('AUTHORIZATION_REQUIRED: low-screen candidate tuples are missing');
    const allowed=search.lowGridTuples();
    for(const candidate of candidates)if(!allowed.some(item=>core.same(item,candidate)))throw new Error('AUTHORIZATION_REQUIRED: low-screen tuple is outside the fixed grid');
    return candidates.flatMap(lowScreenCells);
  }
  if(phase==='low-full'){
    const prior=phaseCompletedWith(roots,'low-screen','STAGE3E_LOW_SCREEN_COMPLETE');
    const candidates=authorization?.candidateTuples,expected=prior.summary?.topFive?.map(item=>({low:item.low,mid:1,bassHardness:item.bassHardness}))||[];
    if(!Array.isArray(candidates)||!core.same(candidates,expected))throw new Error('AUTHORIZATION_REQUIRED: low-full candidates must be the ranked top five from low-screen');
    return candidates.flatMap(tuple=>fullCells(tuple,'low-full'));
  }
  if(phase==='mid-screen'){
    const selected=loadFinalMaybe(roots,'low-full')?.summary?.selectedTuple;
    if(!selected)throw new Error('BLOCKED_STAGE3E_LOW_FULL_REQUIRED');
    const candidates=authorization?.candidateTuples,expected=search.midGridTuples(selected);
    if(!Array.isArray(candidates)||!core.same(candidates,expected))throw new Error('AUTHORIZATION_REQUIRED: mid-screen must use the fixed mid grid for the selected low tuple');
    return candidates.flatMap(midScreenCells);
  }
  if(phase==='mid-full'){
    const prior=phaseCompletedWith(roots,'mid-screen','STAGE3E_MID_SCREEN_COMPLETE');
    const candidates=authorization?.candidateTuples,expected=prior.summary?.topFive||[];
    if(!Array.isArray(candidates)||!core.same(candidates,expected))throw new Error('AUTHORIZATION_REQUIRED: mid-full candidates must be the ranked top five from mid-screen');
    return candidates.flatMap(tuple=>fullCells(tuple,'mid-full'));
  }
  throw new Error(`BLOCKED_STAGE3E_PHASE: unsupported phase ${phase}`);
}
function evaluatePhase(phase,cells,roots,fixture){
  const rows=rowsForPhase(roots,phase);
  if(phase==='baseline')return compareBaseline(rows,{tolerance:1e-6});
  if(phase==='midi51-diagnostic')return evaluateMidi51(rows.map(row=>row.observation.observation),fixture);
  if(phase==='low-screen'||phase==='mid-screen')return evaluateScreen(phase,cells,rows,fixture);
  if(phase==='low-full'||phase==='mid-full')return evaluateFull(phase,cells,rows,fixture);
  throw new Error(`unsupported Stage3E phase ${phase}`);
}
function createSelection(roots,identity,summary,finalResult,now){
  if(finalResult.decision!=='STAGE3E_MID_FULL_PASS'||!summary.selectedTuple)throw new Error('BLOCKED_STAGE3E_SELECTION: no passing full candidate');
  const selectedResponse={low:summary.selectedTuple.low,mid:summary.selectedTuple.mid,bassHardness:summary.selectedTuple.bassHardness};
  const paths=core.dualPaths(roots,'selection.json');
  if(fs.existsSync(paths.primary)||fs.existsSync(paths.secondary)){
    const stored=core.readDualBytes(roots,'selection.json'),existing=JSON.parse(stored.bytes.toString('utf8'));
    const expected={schemaVersion:1,issue:7,epoch:core.EPOCH,decision:'STAGE3E_SELECTED_RESPONSE',selectedResponse,
      identitySha256:core.sha256(core.canonicalBytes(identity)),phaseResultSha256:finalResult.sha256,syntheticTest:summary.syntheticTest===true};
    for(const [key,value] of Object.entries(expected))if(!Object.hasOwn(existing,key)||!core.same(existing[key],value))throw new Error('BLOCKED_STAGE3E_SELECTION: immutable selection differs');
    return {...existing,sha256:stored.sha256};
  }
  const value={schemaVersion:1,issue:7,epoch:core.EPOCH,decision:'STAGE3E_SELECTED_RESPONSE',selectedResponse,
    identitySha256:core.sha256(core.canonicalBytes(identity)),phaseResultSha256:finalResult.sha256,selectedAt:now(),syntheticTest:summary.syntheticTest===true};
  const stored=core.writeImmutableDual(roots,'selection.json',core.canonicalBytes(value));
  return {...value,sha256:stored.sha256};
}
function runCells(options={}){
  const {roots,phase,cells,authorization,syntheticTest=false}=options;
  const keys=cells.map(cell=>cell.key),auth=core.validateAuthorization(authorization,{stage:STAGE,phase,cells:keys,renderBudget:keys.length,allowSynthetic:syntheticTest});
  return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>runCellsLocked({...options,validatedAuthorization:auth}));
}
function runCellsLocked({root,roots,record,identity,phase,cells,authorization,validatedAuthorization:auth,syntheticTest=false,render=renderDefault,now=()=>new Date().toISOString()}={}){
  const existing=core.readPhaseLedger(roots,phase),phaseNow=existing?.manifest.createdAt?()=>existing.manifest.createdAt:now;
  const manifest=phaseManifest({root,record,identity,authorizationHash:auth.sha256,phase,cells,now:phaseNow});
  core.initializePhase({roots,phase,manifest,cells,renderBudget:cells.length,now});
  let calls=0,unsafe=false;
  for(const cell of cells){
    const existing=core.readCell(roots,phase,cell.key);
    if(existing.cell.state==='COMPLETE')continue;
    const started=core.startCell({roots,phase,cellKey:cell.key,cell,identity,identityNow:()=>currentIdentity(root,record),now});
    if(started.skipped)continue;
    let measured;calls+=1;
    try{
      measured=render({root,record,identity,cell,authorization,syntheticTest});
    }catch(error){
      try{core.markAmbiguous({roots,phase,cellKey:cell.key,reason:error.message,now});}catch{}
      throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}: ${error.message}`);
    }
    if(!measured||typeof measured!=='object'){
      try{core.markAmbiguous({roots,phase,cellKey:cell.key,reason:'render returned no observation',now});}catch{}
      throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}: no observation returned`);
    }
    const observation={...measured,phase,buildRole:cell.buildRole||'stage3e',candidate:cell.candidate||null,
      ...(auth.syntheticTest?{syntheticTest:true,label:'SYNTHETIC TEST'}:{})};
    const result=core.completeCell({roots,phase,cellKey:cell.key,observation,now});
    if(result.decision==='FAIL'){unsafe=true;break;}
  }
  const after=core.readPhaseLedger(roots,phase).ledger;
  const counts=Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE','AMBIGUOUS'].map(state=>[state,Object.values(after.cells).filter(item=>item.state===state).length]));
  if(unsafe||counts.COMPLETE!==cells.length)return {decision:unsafe?`BLOCKED_UNSAFE_OBSERVATION:${phase}`:'BLOCKED_STAGE3E_PHASE_INCOMPLETE',phase,calls,renderCount:after.renderCount,counts,acousticRenders:calls};
  const evaluation=evaluatePhase(phase,cells,roots,JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8')));
  const synthetic=auth.syntheticTest===true;
  if(synthetic)evaluation.syntheticTest=true;
  const finalized=core.finalizePhase({roots,phase,decision:evaluation.decision,summary:evaluation,now});
  if(phase==='mid-full'&&evaluation.pass)createSelection(roots,identity,evaluation,finalized.result,now);
  return {decision:finalized.result.decision,phase,calls,renderCount:finalized.result.renderCount,counts,summary:evaluation,
    resultSha256:finalized.sha256,archiveSha256:finalized.archiveSha256,syntheticTest:synthetic,acousticRenders:calls};
}
function run({mode,root=ROOT,home=os.homedir(),epoch=core.EPOCH,render=renderDefault,now=()=>new Date().toISOString(),authorization,syntheticTest=false,commonDirectory}={}){
  if(!['dry-run','baseline','screen','full','finalize','verify'].includes(mode))throw new Error('explicit mode required: dry-run, baseline, screen, full, finalize, or verify');
  let phase=null,authRecord=null,auth=null;
  if(mode==='baseline'||mode==='screen'||mode==='full'){
    phase=expectedPhaseForMode(root,home,mode,epoch);
    if(!phase){
      const progress=nextEvidencePhase(root,home,epoch);
      if(progress.blocked)throw new Error(`BLOCKED_STAGE3E_PHASE: prior ${progress.phase} result is ${progress.blocked}`);
      throw new Error('AUTHORIZATION_REQUIRED: no Issue #7 approval record exists for the next Stage3E phase');
    }
    authRecord=readAuth(root,phase,authorization);
    auth=authRecord?.authorization;
    if(!auth)throw new Error('AUTHORIZATION_REQUIRED: no Issue #7 approval record exists for this phase');
  }
  const record=identityRecord(root),identity=currentIdentity(root,record),exports=assertBuildExports(root,record),roots=core.resolveRoots(root,STAGE,epoch,{home,commonDirectory});
  const plan={baselineCells:24,midi51DiagnosticCells:16,lowScreenCellsPerCandidate:search.lowScreenCells().length,
    lowFullCellsPerCandidate:search.lowFullCells().length,midScreenCellsPerCandidate:search.midScreenCells().length,
    midFullCellsPerCandidate:search.midFullCells().length,maxGridCalls:2355};
  if(mode==='dry-run'){
    const progress=nextEvidencePhase(root,home,epoch);
    if(progress.blocked)return {decision:'BLOCKED_STAGE3E_PHASE',phase:progress.phase,reason:progress.blocked,builds:0,renders:0,writes:0,acousticRenders:0,plan,exports};
    return {decision:'STAGE3E_DRY_RUN_READY',phase:progress.phase,identitySha256:core.sha256(core.canonicalBytes(identity)),builds:0,renders:0,writes:0,acousticRenders:0,plan,exports};
  }
  if(mode==='verify'){
    const phases={};
    for(const phase of core.PHASES){
      if(!['baseline','midi51-diagnostic','low-screen','low-full','mid-screen','mid-full'].includes(phase))continue;
      const result=loadFinalMaybe(roots,phase);if(result)phases[phase]={decision:result.decision,renderCount:result.renderCount,identityMatches:core.same(result.identity,identity)};
    }
    if(Object.values(phases).some(value=>!value.identityMatches))throw new Error('BLOCKED_STAGE3E_IDENTITY: finalized evidence identity differs from current files');
    const selectionPath=core.dualPaths(roots,'selection.json');
    const selection=fs.existsSync(selectionPath.primary)||fs.existsSync(selectionPath.secondary)?core.readDualJson(roots,'selection.json'):null;
    return {decision:selection?'STAGE3E_SELECTED_RESPONSE':'STAGE3E_VERIFY_OK',phases,selection,builds:0,renders:0,writes:0,acousticRenders:0};
  }
  if(mode==='finalize'){
    return core.withWriterLock({commonDirectory:roots.commonDirectory},()=>{
      let finalizePhase=authorization?.phase;
      if(!finalizePhase){
        const open=PHASE_SEQUENCE.map(([name])=>name).filter(name=>!loadFinalMaybe(roots,name)&&core.readPhaseLedger(roots,name));
        if(open.length!==1)throw new Error(open.length?'BLOCKED_STAGE3E_PHASE_AMBIGUOUS: multiple unfinished phases':'BLOCKED_STAGE3E_PHASE_NOT_STARTED');
        finalizePhase=open[0];
      }
      const ledger=core.readPhaseLedger(roots,finalizePhase);if(!ledger)throw new Error('BLOCKED_STAGE3E_PHASE_NOT_STARTED');
      if(!core.same(ledger.manifest.identity,identity))throw new Error('BLOCKED_STAGE3E_IDENTITY: phase identity differs from current inputs');
      const phaseCells=ledger.manifest.authorizedCellKeys.map(key=>{
        const cell=core.readCell(roots,finalizePhase,key).marker?.cell;
        if(!cell)throw new Error(`BLOCKED_STAGE3E_PHASE_INCOMPLETE: render marker missing for ${key}`);
        return cell;
      });
      const evaluation=evaluatePhase(finalizePhase,phaseCells,roots,JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8')));
      const final=core.finalizePhase({roots,phase:finalizePhase,decision:evaluation.decision,summary:evaluation,now});
      if(finalizePhase==='mid-full'&&evaluation.pass)createSelection(roots,identity,evaluation,final.result,now);
      return {decision:final.result.decision,phase:finalizePhase,resultSha256:final.sha256,archiveSha256:final.archiveSha256,builds:0,renders:0,acousticRenders:0};
    });
  }
  if(!phase||!auth)throw new Error(`BLOCKED_STAGE3E_MODE: unsupported mode ${mode}`);
  const cells=authorizedCells(root,phase,auth,roots,null);
  if(phase==='low-screen'||phase==='mid-screen'||phase==='low-full'||phase==='mid-full'){
    if(!Array.isArray(auth.authorizedCellKeys)||auth.maxCalls!==cells.length)throw new Error('AUTHORIZATION_REQUIRED: exact cell set and budget are required');
  }
  return runCells({root,roots,record,identity,phase,cells,authorization:auth,authorizationRecord:authRecord,syntheticTest,render,now});
}
function parseMode(argv){if(argv.length!==1)throw new Error('select exactly one mode: --dry-run, --baseline, --screen, --full, --finalize, --verify');const map={'--dry-run':'dry-run','--baseline':'baseline','--screen':'screen','--full':'full','--finalize':'finalize','--verify':'verify'};if(!map[argv[0]])throw new Error(`unsupported mode: ${argv[0]}`);return map[argv[0]];}
function main(argv=process.argv.slice(2)){
  const mode=parseMode(argv),result=run({mode});process.stdout.write(JSON.stringify(result)+'\n');
  if(/^AUTHORIZATION_REQUIRED|^BLOCKED_/.test(result.decision||''))process.exitCode=2;
  return result;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=/^AUTHORIZATION_REQUIRED/.test(error.message)?2:1;}}

module.exports={ROOT,STAGE,DEFAULT_RESPONSE,BASELINE_FIELDS,MIDI41_FIELDS,MIDI51_VELOCITIES,EXTRA_INPUTS,
  fileSha,identityRecord,currentIdentity,buildDirectory,assertBuildExports,baselineCoordinates,baselineCells,midi51Cells,
  authPath,readAuth,phaseManifest,captureOptions,renderDefault,compareValue,compareBaseline,evaluateMidi51,diagnoseMidi51,
  lowScreenCells,midScreenCells,fullCells,loadFinalMaybe,rowsForPhase,phaseCompletedWith,screenLowerBounds,evaluateScreen,
  evaluateFull,nextEvidencePhase,expectedPhaseForMode,authorizedCells,evaluatePhase,createSelection,runCells,runCellsLocked,run,parseMode,main};
