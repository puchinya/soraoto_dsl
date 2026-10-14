'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-issue7-stage3e-current-build.cjs');
const core=require('./issue7-current-build-core.cjs');

function metricsForBaseline(){
  return Object.fromEntries([...runner.BASELINE_FIELDS,...runner.MIDI41_FIELDS].map(field=>[field,0]));
}
function baselineRows(){
  return runner.baselineCells().map(cell=>({cellKey:cell.key,observation:{metrics:metricsForBaseline()}}));
}
function midi51Evidence(errorDb){
  const velocities=runner.MIDI51_VELOCITIES;
  const fixture={directCells:velocities.map((velocity,index)=>({pitch:51,velocity,metrics:{envelopeDbfs:[0,0,0,index===velocities.length-1?2:0,0]}}))};
  const rows=velocities.map((velocity,index)=>({pitch:51,velocity,metrics:{
    envelopeDbfs:[0,0,0,index===velocities.length-1?10+errorDb-8:0,0],
    finite:true,outputGuardHits:0,peakDbfs:-1,fullRenderPeakDbfs:-1,
    stage2mHammer:{effectiveHardness:0.5,initialHammerVelocity:0.5,contactDurationSamples:10,peakForce:1,maxCompression:0.2,postContactTransverseEnergy:0.1},
    soundboardDiagnostics:{signals:{}},stage3eVelocityResponse:{low:1,mid:1,bassHardness:1}
  }}));
  return {fixture,rows};
}
function treeSnapshot(root){
  if(!fs.existsSync(root))return {exists:false};
  const entries=[];
  function walk(dir,relative=''){
    for(const name of fs.readdirSync(dir).sort()){
      const absolute=path.join(dir,name),rel=relative?`${relative}/${name}`:name,stat=fs.lstatSync(absolute);
      if(stat.isSymbolicLink())entries.push({path:rel,type:'symlink',target:fs.readlinkSync(absolute),mtimeMs:stat.mtimeMs});
      else if(stat.isDirectory()){entries.push({path:rel,type:'directory',mtimeMs:stat.mtimeMs});walk(absolute,rel);}
      else entries.push({path:rel,type:'file',size:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),mtimeMs:stat.mtimeMs});
    }
  }
  walk(root);
  return {exists:true,entries};
}
function seedFinalPhase(roots,phase,cells,decision,summary={}){
  const identity=runner.currentIdentity(runner.ROOT,runner.identityRecord()),createdAt='2026-10-13T00:00:00.000Z';
  const manifest={schemaVersion:1,issue:7,epoch:core.EPOCH,stage:'stage3e',phase,candidateId:`synthetic-${phase}`,
    creatorCommit:core.gitHead(runner.ROOT),identity,authorizationSha256:'a'.repeat(64),runnerSha256:'b'.repeat(64),
    captureHelperSha256:'c'.repeat(64),primaryWasmSha256:'d'.repeat(64),createdAt};
  core.initializePhase({roots,phase,manifest,cells,renderBudget:cells.length,now:()=>createdAt});
  for(const cell of cells){
    core.startCell({roots,phase,cellKey:cell.key,cell,identity,identityNow:()=>identity,now:()=>createdAt});
    core.completeCell({roots,phase,cellKey:cell.key,observation:{syntheticTest:true,label:'SYNTHETIC TEST',metrics:{finite:true,outputGuardHits:0,peakDbfs:-1,fullRenderPeakDbfs:-1}},now:()=>createdAt});
  }
  return core.finalizePhase({roots,phase,decision,summary,now:()=>createdAt});
}

test('baseline plan contains the exact 12 coordinate pairs and 24 build captures',()=>{
  const coordinates=runner.baselineCoordinates();
  const cells=runner.baselineCells();
  assert.equal(coordinates.length,12);
  assert.equal(coordinates.filter(cell=>cell.kind==='direct').length,9);
  assert.equal(coordinates.filter(cell=>cell.kind==='midi41-derivative').length,3);
  assert.equal(cells.length,24);
  assert.equal(new Set(cells.map(cell=>cell.key)).size,24);
  assert.deepEqual([...new Set(cells.map(cell=>cell.buildRole))],['production','stage3e']);
  assert.deepEqual(runner.MIDI41_FIELDS,['velocityDerivative','velocityDerivativeWindowMs']);
});

test('Stage3E cumulative budget includes baseline and initial diagnostic and reports the conditional 80-call skip',()=>{
  const budget=runner.budgetPlan();
  assert.equal(budget.maximumCalls,2555);
  assert.deepEqual(budget.phases.map(({phase,maxCalls})=>[phase,maxCalls]),[
    ['baseline',24],['midi51-diagnostic',16],['low-screen',1512],['midi51-candidate-diagnostic',80],
    ['low-full',415],['mid-screen',108],['midi51-final-diagnostic',80],['mid-full',320]
  ]);
  assert.deepEqual(budget.initialDiagnosticPass,{skippedPhase:'midi51-candidate-diagnostic',skippedCalls:80,maximumCalls:2475});
});

test('current-build production runners do not read approval JSON or call GitHub',()=>{
  for(const name of ['run-issue7-current-build.cjs','run-issue7-stage3e-current-build.cjs',
    'run-issue7-stage3-current-build.cjs','run-issue7-stage4-current-build.cjs']){
    const source=fs.readFileSync(path.join(__dirname,name),'utf8');
    assert.doesNotMatch(source,/readGitHubApproval|verifyAndPersistAuthorization|authorizations\/|AUTHORIZATION_REQUIRED|gh\s+(?:api|issue|pr)/,name);
  }
});

test('synthetic test rendering is isolated from the production renderer and explicit before markers',t=>{
  assert.throws(()=>runner.validateExecutionMode({syntheticTest:true,render:runner.renderDefault}),/cannot invoke the production WASM renderer/);
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-synthetic-boundary-home-'));
  const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-synthetic-boundary-common-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
  const roots=core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home,commonDirectory:common});
  let calls=0;
  assert.throws(()=>runner.run({mode:'baseline',root:runner.ROOT,home,commonDirectory:common,
    render:()=>{calls++;return {};}}),/injected renderers require explicit syntheticTest mode/);
  assert.equal(calls,0);
  assert.equal(fs.existsSync(roots.primary),false);
  assert.equal(fs.existsSync(roots.secondary),false);
});

test('selection creation requires explicit finalized result and SHA and binds the SHA identically',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-selection-sha-home-'));
  const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-selection-sha-common-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
  const roots=core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home,commonDirectory:common});
  const identity={identity:'synthetic'},summary={selectedTuple:{low:0.9,mid:0.95,bassHardness:0.5},syntheticTest:true};
  const final={result:{decision:'STAGE3E_MID_FULL_PASS'},sha256:'a'.repeat(64)};
  assert.throws(()=>runner.createSelection(roots,identity,summary,{result:final.result}),/finalized phase result and SHA-256/);
  const paths=core.dualPaths(roots,'selection.json');
  assert.equal(fs.existsSync(paths.primary),false);
  const selection=runner.createSelection(roots,identity,summary,final,()=> '2026-10-14T00:00:00.000Z');
  assert.equal(selection.phaseResultSha256,final.sha256);
  assert.equal(core.readDualJson(roots,'selection.json').phaseResultSha256,final.sha256);
});

test('baseline comparison accepts matching metrics and rejects missing, NaN, and over-tolerance values',()=>{
  const rows=baselineRows();
  assert.equal(runner.compareBaseline(rows).decision,'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  const within=baselineRows();
  within.find(row=>row.cellKey.startsWith('stage3e-36-14')).observation.metrics.peakDbfs=0.0000005;
  assert.equal(runner.compareBaseline(within).pass,true);
  const outside=baselineRows();
  outside.find(row=>row.cellKey.startsWith('stage3e-36-14')).observation.metrics.peakDbfs=0.0000011;
  assert.equal(runner.compareBaseline(outside).decision,'BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');
  const missing=baselineRows();
  delete missing.find(row=>row.cellKey.startsWith('stage3e-41-')).observation.metrics.velocityDerivative;
  assert.equal(runner.compareBaseline(missing).pass,false);
  const nonfinite=baselineRows();
  nonfinite.find(row=>row.cellKey.startsWith('stage3e-36-14')).observation.metrics.peakDbfs=Number.NaN;
  assert.equal(runner.compareBaseline(nonfinite).pass,false);
});

test('fresh MIDI51 gate fails above 8 dB and passes exactly at 8 dB when safety checks pass',()=>{
  const over=midi51Evidence(8.000001);
  const overResult=runner.evaluateMidi51(over.rows,over.fixture);
  assert.ok(Math.abs(overResult.span.errorDb-8.000001)<1e-12);
  assert.equal(overResult.pass,false);
  assert.equal(overResult.decision,'STAGE3E_MIDI51_DIAGNOSTIC_FAIL');
  assert.equal(overResult.qualityPass,false);
  const boundary=midi51Evidence(8);
  const boundaryResult=runner.evaluateMidi51(boundary.rows,boundary.fixture);
  assert.equal(boundaryResult.span.errorDb,8);
  assert.equal(boundaryResult.safe,true);
  assert.equal(boundaryResult.diagnosticsComplete,true);
  assert.equal(boundaryResult.pass,true);
  assert.equal(boundaryResult.decision,'STAGE3E_MIDI51_PASS');
  delete boundary.rows[0].metrics.stage2mHammer;
  const incomplete=runner.evaluateMidi51(boundary.rows,boundary.fixture);
  assert.equal(incomplete.pass,false);
  assert.equal(incomplete.decision,'BLOCKED_STAGE3E_MID_DIAGNOSTICS');
});

test('safe complete MIDI51 diagnostic FAIL is preserved and can unlock only the bounded low grid',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-diagnostic-home-'));
  const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-diagnostic-common-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
  const roots=core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home,commonDirectory:common});
  seedFinalPhase(roots,'baseline',runner.baselineCells(),'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  seedFinalPhase(roots,'midi51-diagnostic',runner.midi51Cells(),'STAGE3E_MIDI51_DIAGNOSTIC_FAIL',{safe:true,diagnosticsComplete:true,qualityPass:false});
  assert.equal(core.readFinal(roots,'midi51-diagnostic').result.decision,'STAGE3E_MIDI51_DIAGNOSTIC_FAIL');
  assert.deepEqual(runner.nextEvidencePhase(runner.ROOT,home,core.EPOCH,common),{phase:'low-screen'});
  const cells=runner.authorizedCells(runner.ROOT,'low-screen',{candidateTuples:require('./stage3e-search-core.cjs').lowGridTuples()},roots,null);
  assert.equal(cells.length,1512);
  assert.equal(new Set(cells.map(cell=>cell.candidate.low+':'+cell.candidate.bassHardness)).size,126);
});

test('MIDI51 failure derives top-five candidate gates and formal PASS sets before full phases',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-midi51-gates-home-'));
  const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-midi51-gates-common-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
  const roots=core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home,commonDirectory:common}),one=[{key:'synthetic'}];
  const search=require('./stage3e-search-core.cjs'),lowTop=search.lowGridTuples().slice(0,5);
  seedFinalPhase(roots,'baseline',runner.baselineCells(),'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  seedFinalPhase(roots,'midi51-diagnostic',runner.midi51Cells(),'STAGE3E_MIDI51_DIAGNOSTIC_FAIL',{safe:true,diagnosticsComplete:true,qualityPass:false});
  seedFinalPhase(roots,'low-screen',one,'STAGE3E_LOW_SCREEN_COMPLETE',{topFive:lowTop});
  assert.deepEqual(runner.nextEvidencePhase(runner.ROOT,home,core.EPOCH,common),{phase:'midi51-candidate-diagnostic'});
  const lowDiagCells=runner.authorizedCells(runner.ROOT,'midi51-candidate-diagnostic',{candidateTuples:lowTop},roots,null);
  assert.equal(lowDiagCells.length,80);
  assert.ok(lowDiagCells.every(cell=>cell.response.low!==undefined&&cell.response.mid===1&&cell.response.bassHardness!==undefined));
  const lowPassing=[lowTop[0],lowTop[2]];
  seedFinalPhase(roots,'midi51-candidate-diagnostic',lowDiagCells,'STAGE3E_MIDI51_CANDIDATE_DIAGNOSTIC_COMPLETE',
    {candidates:lowTop.map(tuple=>({tuple,pass:lowPassing.includes(tuple),safe:true,diagnosticsComplete:true})),passingCandidates:lowPassing});
  const lowFullCells=runner.authorizedCells(runner.ROOT,'low-full',{candidateTuples:lowPassing},roots,null);
  assert.equal(lowFullCells.length,lowPassing.length*search.lowFullCells().length);
  const lowSelected=lowPassing[0];
  seedFinalPhase(roots,'low-full',one,'STAGE3E_LOW_FULL_PASS',{selectedTuple:lowSelected});
  const midGrid=search.midGridTuples(lowSelected);
  assert.equal(runner.authorizedCells(runner.ROOT,'mid-screen',{candidateTuples:midGrid},roots,null).length,9*search.midScreenCells().length);
  const midTop=midGrid.slice(0,5).map((tuple,index)=>({mid:tuple.mid,rankMaxError:index+0.1,rankSumSquares:index+0.2}));
  seedFinalPhase(roots,'mid-screen',one,'STAGE3E_MID_SCREEN_COMPLETE',{topFive:midTop});
  assert.deepEqual(runner.nextEvidencePhase(runner.ROOT,home,core.EPOCH,common),{phase:'midi51-final-diagnostic'});
  const normalized=runner.normalizeMidFullTuples(lowSelected,midTop),finalDiagCells=runner.authorizedCells(runner.ROOT,'midi51-final-diagnostic',{candidateTuples:normalized},roots,null);
  assert.equal(finalDiagCells.length,80);
  const finalPassing=[normalized[1]];
  seedFinalPhase(roots,'midi51-final-diagnostic',finalDiagCells,'STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE',
    {candidates:normalized.map(tuple=>({tuple,pass:finalPassing.includes(tuple),safe:true,diagnosticsComplete:true})),passingCandidates:finalPassing});
  assert.equal(runner.authorizedCells(runner.ROOT,'mid-full',{candidateTuples:finalPassing},roots,null).length,search.midFullCells().length);
});

test('low-screen candidates are the fixed ordered 126-tuple grid',()=>{
  const grid=require('./stage3e-search-core.cjs').lowGridTuples();
  assert.equal(grid.length,126);
  assert.deepEqual(runner.validateLowScreenTuples(grid),grid);
  assert.throws(()=>runner.validateLowScreenTuples(grid.slice(0,-1)),/deterministic 126-tuple grid/);
  assert.throws(()=>runner.validateLowScreenTuples([...grid].reverse()),/deterministic 126-tuple grid/);
});

test('mid-full authorization converts ranked metadata into the exact selected response tuple',()=>{
  const selected={low:0.75,mid:1,bassHardness:1.25};
  const ranked=[{mid:0.9,rankMaxError:0.4,rankSumSquares:0.8,rows:[1]},
    {mid:0.85,rankMaxError:0.6,rankSumSquares:1.2,safetyPass:true}];
  const tuples=runner.normalizeMidFullTuples(selected,ranked);
  assert.deepEqual(tuples,[{low:0.75,mid:0.9,bassHardness:1.25},{low:0.75,mid:0.85,bassHardness:1.25}]);
  assert.ok(tuples.every(tuple=>Object.keys(tuple).sort().join(',')==='bassHardness,low,mid'));
  assert.throws(()=>runner.normalizeMidFullTuples(selected,[...ranked,{mid:0.123}]),/outside the fixed mid grid/);
});

test('synthetic fake-DSP chain reaches mid-full using only deterministic response tuples',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-mid-full-home-'));
  const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-mid-full-common-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
  const roots=core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home,commonDirectory:common});
  const one=[{key:'synthetic'}],lowSelected={low:0.75,mid:1,bassHardness:1.25};
  seedFinalPhase(roots,'baseline',runner.baselineCells(),'STAGE3E_BASELINE_EQUIVALENCE_PASS');
  seedFinalPhase(roots,'midi51-diagnostic',runner.midi51Cells(),'STAGE3E_MIDI51_PASS',{safe:true,diagnosticsComplete:true});
  seedFinalPhase(roots,'low-screen',one,'STAGE3E_LOW_SCREEN_COMPLETE',{topFive:[{low:0.75,bassHardness:1.25}]});
  seedFinalPhase(roots,'low-full',one,'STAGE3E_LOW_FULL_PASS',{selectedTuple:lowSelected});
  const mids=require('./stage3e-search-core.cjs').midGridTuples(lowSelected).slice(0,5).map(tuple=>tuple.mid);
  const ranked=mids.map((mid,index)=>({mid,rankMaxError:index+0.1,rankSumSquares:index+0.2,safetyPass:true}));
  seedFinalPhase(roots,'mid-screen',one,'STAGE3E_MID_SCREEN_COMPLETE',{topFive:ranked});
  const candidates=runner.normalizeMidFullTuples(lowSelected,ranked);
  seedFinalPhase(roots,'midi51-final-diagnostic',one,'STAGE3E_MIDI51_FINAL_DIAGNOSTIC_COMPLETE',
    {candidates:candidates.map(tuple=>({tuple,pass:true,safe:true,diagnosticsComplete:true})),passingCandidates:candidates});
  const cells=runner.authorizedCells(runner.ROOT,'mid-full',{candidateTuples:candidates},roots,null);
  assert.equal(cells.length,320);
  assert.ok(cells.every(cell=>Object.keys(cell.response).sort().join(',')==='bassHardness,low,mid'));
  const ignoredApprovalLikeData={candidateTuples:ranked};
  assert.deepEqual(runner.authorizedCells(runner.ROOT,'mid-full',ignoredApprovalLikeData,roots,null).map(cell=>cell.candidate).filter((tuple,index,all)=>index===0||tuple!==all[index-1]),
    candidates);
  assert.equal(fs.existsSync(core.dualPaths(roots,'phases/mid-full/manifest.json').primary),false);
  const fixture=JSON.parse(fs.readFileSync(path.join(runner.ROOT,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
  const fixtureRows=new Map(fixture.directCells.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const requests=[];
  const result=runner.run({mode:'full',root:runner.ROOT,home,commonDirectory:common,syntheticTest:true,
    render:({cell})=>{
      requests.push(cell.response);
      const source=fixtureRows.get(`${cell.pitch}:${cell.velocity}`);
      return {pitch:cell.pitch,velocity:cell.velocity,kind:cell.kind||cell.phase,buildRole:cell.buildRole,
        metrics:{...source.metrics,finite:true,outputGuardHits:0,fullRenderPeakDbfs:source.metrics.peakDbfs}};
    }});
  assert.equal(result.decision,'STAGE3E_MID_FULL_PASS');
  assert.equal(result.syntheticTest,true);
  assert.equal(requests.length,320);
  assert.ok(requests.every(tuple=>Object.keys(tuple).sort().join(',')==='bassHardness,low,mid'));
  assert.deepEqual([...new Set(requests.map(tuple=>`${tuple.low}:${tuple.mid}:${tuple.bassHardness}`))],
    candidates.map(tuple=>`${tuple.low}:${tuple.mid}:${tuple.bassHardness}`));
  const selection=core.readDualJson(roots,'selection.json');
  assert.deepEqual(selection.selectedResponse,candidates[0]);
  assert.equal(selection.phaseResultSha256,core.readFinal(roots,'mid-full').sha256);
  assert.equal(selection.syntheticTest,true);
});

test('baseline execution needs no approval JSON or GitHub comment and labels fake results synthetic',t=>{
  let record;
  try{record=runner.identityRecord(runner.ROOT);runner.assertBuildExports(runner.ROOT,record);}
  catch{t.skip('current-build identity/build artifacts are unavailable');return;}
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-no-approval-home-'));
  const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-no-approval-common-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
  let calls=0;const previous=core.readGitHubApproval;core.readGitHubApproval=()=>{throw new Error('GitHub access is forbidden in the phase runner');};
  try{
    const result=runner.run({mode:'baseline',root:runner.ROOT,home,commonDirectory:common,syntheticTest:true,render:({cell})=>{
      calls+=1;
      return {pitch:cell.pitch,velocity:cell.velocity,kind:cell.kind,metrics:{...metricsForBaseline(),finite:true,outputGuardHits:0,peakDbfs:-1,fullRenderPeakDbfs:-1}};
    }});
    assert.equal(result.syntheticTest,true);
    assert.equal(calls,24);
    assert.equal(result.renderCount,24);
    assert.equal(fs.existsSync(path.join(common,'soraoto-agent-state','7','stage3e',core.EPOCH,'authorizations')),false);
    const plan=core.readDualJson(core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home,commonDirectory:common}),'phases/baseline/execution-plan.json');
    assert.equal(plan.renderBudget,24);
    assert.equal(plan.maxCalls,24);
  }finally{core.readGitHubApproval=previous;}
});

test('legacy comment data cannot trigger GitHub access or rendering',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-auth-home-'));
  const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-auth-common-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
  const keys=runner.baselineCells().map(cell=>cell.key).sort(),authorization={issue:7,epoch:core.EPOCH,contractSha256:core.CONTRACT_SHA256,
    stage:'stage3e',phase:'baseline',planCommentUrl:'https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12344',
    planCommentSha256:'a'.repeat(64),approvalCommentUrl:'https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12345',
    approvalCommentSha256:'b'.repeat(64),authorizedCellKeys:keys,maxCalls:24,approvedAtEpochMs:Date.parse('2026-10-13T00:00:00Z')};
  let calls=0;
  assert.throws(()=>runner.run({mode:'baseline',root:runner.ROOT,home,commonDirectory:common,authorization,
    githubReadback:()=>{throw new Error('GitHub access is forbidden in the phase runner');},render:()=>{calls+=1;return {};}}),/BLOCKED_SYNTHETIC_RENDER/);
  assert.equal(calls,0);
  assert.equal(fs.existsSync(path.join(common,'soraoto-agent-state','7','stage3e',core.EPOCH)),false);
  assert.equal(fs.existsSync(path.join(home,'.soraoto-agent-archive','repo','7','stage3e',core.EPOCH)),false);
});

test('legacy approval comments are ignored and the runner never reads them',t=>{
  let record;
  try{record=runner.identityRecord(runner.ROOT);runner.assertBuildExports(runner.ROOT,record);}
  catch{t.skip('current-build identity/build artifacts are unavailable');return;}
  const cells=runner.baselineCells().map(cell=>cell.key),authorizedCellKeys=[...cells].sort();
  const identity=runner.currentIdentity(runner.ROOT,record);
  const executionIdentity=core.makeExecutionIdentity({stage:'stage3e',phase:'baseline',cells,
    renderBudget:cells.length,prHeadSha:core.gitHead(runner.ROOT),identity});
  const executionIdentitySha256=core.executionIdentitySha256(executionIdentity);
  const planId='12344',approvalId='12345';
  const planUrl=`https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-${planId}`;
  const approvalUrl=`https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-${approvalId}`;
  const expectedStatement=core.expectedApprovalStatement({stage:'stage3e',phase:'baseline',cells,
    renderBudget:cells.length,planCommentId:planId,executionIdentitySha256});
  const planBody=`Identity-bound plan cellSetSha256=${core.cellSetSha256(cells)}; executionIdentitySha256=${executionIdentitySha256}\n${core.executionIdentityMarker(executionIdentity)}\n\nApproval template: ${expectedStatement}`;
  const planTime='2026-10-12T23:00:00.000Z',approvalTime='2026-10-13T00:00:00.000Z';
  const comment=(id,url,body,created_at)=>({id,html_url:url,issue_url:'https://api.github.com/repos/puchinya/soraoto_dsl/issues/7',
    body,created_at,updated_at:created_at,user:{login:'puchinya'}});
  const authorization={issue:7,epoch:core.EPOCH,contractSha256:core.CONTRACT_SHA256,stage:'stage3e',phase:'baseline',
    planCommentUrl:planUrl,planCommentSha256:core.sha256(Buffer.from(planBody,'utf8')),
    approvalCommentUrl:approvalUrl,approvalCommentSha256:'',executionIdentitySha256,
    authorizedCellKeys,maxCalls:cells.length,approvedAtEpochMs:Date.parse(approvalTime)};
  const scenarios=[
    {name:'same plan and approval comment with matching body SHA',approvalCommentUrl:planUrl,
      approvedAtEpochMs:Date.parse(planTime),
      approvalCommentSha256:core.sha256(Buffer.from(planBody,'utf8')),
      comments:{[planId]:comment(planId,planUrl,planBody,planTime)}},
    {name:'separate comment quoting the approval statement',approvalCommentUrl:approvalUrl,
      approvalBody:`Requested format: “${expectedStatement}”`,
      comments:{[planId]:comment(planId,planUrl,planBody,planTime),[approvalId]:comment(approvalId,approvalUrl,`Requested format: “${expectedStatement}”`,approvalTime)}}
  ];
  for(const scenario of scenarios){
    const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-comment-boundary-home-'));
    const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-comment-boundary-common-'));
    t.after(()=>{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(common,{recursive:true,force:true});});
    const auth={...authorization,approvalCommentUrl:scenario.approvalCommentUrl,
      approvedAtEpochMs:scenario.approvedAtEpochMs??Date.parse(approvalTime),
      approvalCommentSha256:scenario.approvalCommentSha256??core.sha256(Buffer.from(scenario.approvalBody,'utf8'))};
    let renders=0,readbacks=0;
    assert.throws(()=>runner.run({mode:'baseline',root:runner.ROOT,home,commonDirectory:common,authorization:auth,
      githubReadback:()=>{readbacks+=1;return {authenticatedLogin:'puchinya',comments:scenario.comments};},
      render:()=>{renders+=1;throw new Error('unexpected renderer call');}}),/BLOCKED_SYNTHETIC_RENDER/,scenario.name);
    assert.equal(renders,0,scenario.name);
    assert.equal(fs.existsSync(path.join(common,'soraoto-agent-state','7','stage3e',core.EPOCH)),false,scenario.name);
    assert.equal(fs.existsSync(path.join(home,'.soraoto-agent-archive','repo','7','stage3e',core.EPOCH)),false,scenario.name);
    assert.equal(readbacks,0,scenario.name);
  }
});

test('dry-run does not change either canonical Stage3E store',t=>{
  let record;
  try{record=runner.identityRecord(runner.ROOT);}catch{t.skip('current-build identity/build artifacts are unavailable');return;}
  for(const role of ['production','stage3e','stage4']){
    const item=record.builds?.[role];
    if(!item||!fs.existsSync(path.join(runner.ROOT,item.buildDirectory,item.wasm.path))){t.skip('current-build identity/build artifacts are unavailable');return;}
  }
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-dry-run-'));
  try{
    const common=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-stage3e-dry-common-'));
    t.after(()=>fs.rmSync(common,{recursive:true,force:true}));
    const roots=core.resolveRoots(runner.ROOT,'stage3e',core.EPOCH,{home,commonDirectory:common});
    const before={primary:treeSnapshot(roots.primary),secondary:treeSnapshot(roots.secondary)};
    let calls=0;
    const result=runner.run({mode:'dry-run',root:runner.ROOT,home,commonDirectory:common,render:()=>{calls+=1;return {};}});
    const after={primary:treeSnapshot(roots.primary),secondary:treeSnapshot(roots.secondary)};
    assert.equal(result.decision,'STAGE3E_DRY_RUN_READY');
    assert.equal(result.builds,0);
    assert.equal(result.renders,0);
    assert.equal(result.writes,0);
    assert.equal(result.acousticRenders,0);
    assert.equal(result.plan.maxGridCalls,2555);
    assert.deepEqual(result.plan.budget,runner.budgetPlan());
    assert.equal(calls,0);
    assert.deepEqual(after,before);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
