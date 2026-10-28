#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../../../../../../');
const generation2=require('./run-stage3e-generation2.cjs');
const stage3e=require('./run-stage3e-velocity-response.cjs');
const stage3=require('./run-stage3-production-recovery.cjs');
const stage4=require('./run-stage4-full-range.cjs');
const preflight=require('./stage3e-preflight.cjs');

const REGRESSIONS={
  concertGrand:'wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js',
  pianoRealism:'wasm/plugins/dsp/super-synth/test/piano-realism-regression.test.js',
  pianoClick:'wasm/plugins/dsp/super-synth/test/piano-click-regression.test.js',
  pianoVoiceSteal:'wasm/plugins/dsp/super-synth/test/piano-voice-steal-regression.test.js',
  pluginInterfaceV1:'wasm/plugins/dsp/super-synth/test/plugin-interface-v1.test.js',
  playbackSafety:'wasm/plugins/dsp/super-synth/test/playback-safety-regression.test.js'
};
const SELECTED_INPUTS=['wasm/plugins/dsp/super-synth/presets.json','wasm/shared/generated/super-synth_grand_profiles.h'];
const STATUS_FILE='docs/status/plugins/dsp/super-synth/stage3b-contact-attribution.md';
const PR_BRANCH='codex/issue-7-supersynth-v9';
const REPORT_MARKER='## Stage3E Search Resume → Stage4 Completion';
const STAGE3E_EXPORT_MARKER='soraoto_supersynth_stage3e_';

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function withBuildDirectory(directory,operation){
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=directory;
  try{return operation();}
  finally{if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;}
}
function stage3eExportNames(exports){return exports.filter(name=>name.includes(STAGE3E_EXPORT_MARKER)).sort();}
function stage3eExports(wasmPath){
  const module=new WebAssembly.Module(fs.readFileSync(wasmPath));
  return stage3eExportNames(WebAssembly.Module.exports(module).map(({name})=>name));
}
function acquireMasterExecutionLock(commonDir,{pid=process.pid,identity='stage3e-master'}={}){
  const lockPath=path.join(commonDir,'stage3e-master-execution.lock');
  const payload=JSON.stringify({schemaVersion:1,pid,identity,createdAt:new Date().toISOString()})+'\n';
  let fd;
  try{fd=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(fd,payload);fs.fsyncSync(fd);fs.closeSync(fd);}
  catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{};if(error.code==='EEXIST')throw new Error(`BLOCKED_STAGE3E_MASTER_WRITER_LOCK: existing lock ${lockPath}; inspect its owner before recovery`);throw error;}
  return {lockPath,payload,release(){
    if(!fs.existsSync(lockPath))throw new Error(`BLOCKED_STAGE3E_MASTER_WRITER_LOCK: owned lock disappeared ${lockPath}`);
    if(fs.readFileSync(lockPath,'utf8')!==payload)throw new Error(`BLOCKED_STAGE3E_MASTER_WRITER_LOCK: lock ownership changed ${lockPath}`);
    fs.unlinkSync(lockPath);
  }};
}
function runCommand(program,args,{root=ROOT,env=process.env,quiet=false}={}){
  try{return execFileSync(program,args,{cwd:root,env,encoding:'utf8',stdio:quiet?'pipe':'inherit'});}
  catch(error){const tail=String(error.stdout||'')+'\n'+String(error.stderr||'');throw new Error(`BLOCKED_STAGE3E_MASTER_COMMAND: ${program} ${args.join(' ')}\n${tail.slice(-3000)}`);}
}
function requireApi(adapters){
  const names=['preflight','stage3eDryRun','phaseEntryDryRun','low','mid','selection','promoteAndRegress','commitSelectedValues','productionBuild','stage3DryRun','stage3Execute','stage3Finalize','stage4DryRun','stage4Execute','stage4Finalize','fullVerification','reviewHandoff'];
  for(const name of names)if(typeof adapters?.[name]!=='function')throw new Error(`BLOCKED_STAGE3E_MASTER_API: ${name} is not a function`);
  return adapters;
}
function assertDecision(result,expected,stage){
  if(typeof result?.decision==='string'&&result.decision.startsWith('BLOCKED_'))throw new Error(`${result.decision}: ${stage} phase returned a blocked decision`);
  if(result?.decision!==expected)throw new Error(`BLOCKED_STAGE3E_MASTER_${stage.toUpperCase()}: expected ${expected}, got ${result?.decision||'no decision'}`);
}
function assertZeroRender(result,stage){
  if(result?.renders!==0||result?.acousticRenders!==0||result?.builds!==0||(result?.evidenceWrites??0)!==0)
    throw new Error(`BLOCKED_STAGE3E_MASTER_${stage.toUpperCase()}: dry-run must be zero-build, zero-render, zero-write`);
}
function validatePipelinePhaseContracts({stage3Api=stage3,stage4Api=stage4}={}){
  if(typeof stage3Api?.run!=='function'||typeof stage3Api?.exactCells!=='function'||typeof stage3Api?.key!=='function'||
     typeof stage4Api?.run!=='function'||typeof stage4Api?.exactCells!=='function'||typeof stage4Api?.key!=='function')
    throw new Error('BLOCKED_STAGE3E_MASTER_API: Stage3/Stage4 phase entry exports are incomplete');
  const stage3Cells=stage3Api.exactCells(),stage4Cells=stage4Api.exactCells();
  if(!Array.isArray(stage3Cells)||stage3Cells.length!==486||new Set(stage3Cells.map(stage3Api.key)).size!==486)
    throw new Error('BLOCKED_STAGE3E_MASTER_STAGE3_SCHEMA: expected 480 direct + 6 sentinel identities');
  if(!Array.isArray(stage4Cells)||stage4Cells.length!==1423||new Set(stage4Cells.map(stage4Api.key)).size!==1423||
     stage4Api.MAIN_COUNT!==1408||stage4Api.REPEAT_COUNT!==15||stage4Api.CELL_COUNT!==1423)
    throw new Error('BLOCKED_STAGE3E_MASTER_STAGE4_SCHEMA: expected 1408 lifecycle + 15 repeat identities');
  return {decision:'STAGE3E_PIPELINE_PHASES_DRY_RUN_READY',builds:0,renders:0,acousticRenders:0,evidenceWrites:0,
    stage3:{authorizedDirectCells:480,authorizedSentinels:6,authorizedRenderCount:stage3Cells.length},
    stage4:{authorizedLifecycleCells:stage4Api.MAIN_COUNT,authorizedRepeatCells:stage4Api.REPEAT_COUNT,authorizedRenderCount:stage4Cells.length}};
}
function summarizePreflight(result){
  const summary={};
  for(const key of ['decision','builds','renders','acousticRenders','evidenceWrites','auditSha256','amendmentResultSha256',
    'manifestSha256','ledgerSha256','compatibilitySha256','frozenCount','authorizedAdditionsCount'])
    if(result?.[key]!==undefined)summary[key]=result[key];
  if(result?.ledger&&typeof result.ledger==='object'){
    const cells=Array.isArray(result.ledger.cells)?result.ledger.cells:Object.values(result.ledger.cells||{});
    summary.ledgerCounts=cells.reduce((counts,cell)=>{const state=cell.state||cell.status;counts[state]=(counts[state]||0)+1;return counts;},{});
    summary.accounting=result.ledger.accounting;
  }
  return summary;
}
function summarizeStage3eDryRun(result){
  const summary={};
  for(const key of ['decision','builds','renders','acousticRenders','evidenceWrites','generation','searchEpoch','baselineRowsReused',
    'baselineRenders','midi41AmendmentDecision','midi41AmendmentResultSha256','historicalGeneration2ManifestSha256',
    'lowGridCandidates','midCandidates','historicalReferenceSetSha256','searchEnabled'])
    if(result?.[key]!==undefined)summary[key]=result[key];
  return summary;
}
function summarizeStageResult(result){
  if(!result||typeof result!=='object')return result;
  const summary={};
  for(const key of ['decision','builds','renders','acousticRenders','authorizedRenderCount','authorizedCellCount','cellCount','renderCalls',
    'searchRenderCalls','resultSha256','manifestSha256','archiveSha256','ledgerSha256','selectionSha256','maximumDifference',
    'tolerance','baselineRowsReused','baselineRenders','screenCandidateCount','topFiveCount','fullyValidated'])
    if(result[key]!==undefined){
      const value=result[key];
      summary[key]=key==='fullyValidated'&&Array.isArray(value)?value.map(row=>({decision:row.decision,pass:row.pass,renderCalls:row.renderCalls})):value;
    }
  if(result.selection?.selected)summary.selected=result.selection.selected;
  if(result.selected)summary.selected=result.selected;
  if(result.evaluation?.decision)summary.evaluationDecision=result.evaluation.decision;
  if(result.coverage)summary.coverage=result.coverage;
  if(result.counts)summary.counts=result.counts;
  return summary;
}
function phaseReportLines(name,result){
  const keys=['decision','searchRenderCalls','renders','authorizedRenderCount','cellCount','renderCalls','resultSha256','manifestSha256',
    'archiveSha256','ledgerSha256','selectionSha256','screenCandidateCount','topFiveCount','maximumDifference','tolerance'];
  const facts=[];
  for(const key of keys)if(result?.[key]!==undefined)facts.push(`${key}=${JSON.stringify(result[key])}`);
  if(result?.selected)facts.push(`selected=${JSON.stringify(result.selected)}`);
  if(result?.selection?.selected)facts.push(`selected=${JSON.stringify(result.selection.selected)}`);
  if(Array.isArray(result?.fullyValidated))facts.push(`fullyValidated=${JSON.stringify(result.fullyValidated.map(row=>({decision:row.decision,pass:row.pass,renderCalls:row.renderCalls})))}`);
  if(result?.evaluation?.coverage)facts.push(`coverage=${JSON.stringify(result.evaluation.coverage)}`);
  return `- ${name}: ${facts.length?facts.join('; '):'no compact facts exposed'}`;
}
function completionReport({root,home,results}={}){
  const lowCalls=results.low?.searchRenderCalls,midCalls=results.mid?.searchRenderCalls;
  if(!Number.isInteger(lowCalls)||!Number.isInteger(midCalls))throw new Error('BLOCKED_STAGE3E_COMPLETION_ACCOUNTING: low/mid search render calls are unavailable');
  const stage3Calls=results.stage3Execute?.renders,stage4Calls=results.stage4Execute?.renders;
  if(stage3Calls!==486||stage4Calls!==1423)throw new Error('BLOCKED_STAGE3E_COMPLETION_ACCOUNTING: finalized Stage3/Stage4 render totals do not match authorization');
  const selected=results.selection?.selection?.selected;
  if(!selected)throw new Error('BLOCKED_STAGE3E_COMPLETION_REPORT: selected response tuple is missing');
  const common=runCommand('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{root,quiet:true}).trim();
  const evidenceRoot=path.join(common,'soraoto-agent-state/7/stage3e');
  const inline=value=>'`'+String(value)+'`';
  return [REPORT_MARKER,'',
    '**Decision:** `STAGE3E_GENERATION2_BASELINE_EQUIVALENT` → `STAGE3_READY_FOR_STAGE4` → `STAGE4_FULL_RANGE_COMPLETE`','',
    '**Identity anchors:**',
    `- Frozen-source proof: ${inline('e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb')}`,
    `- Surrogate result: ${inline('813a3069d384656419f1cf976c2b501a567909dfd2de5703fc58277f0096c0d8')}; manifest: ${inline('1df4c3ce0f0ebf79a662a53aedd215a4240d73401f0dcf1d0cb217151df2b816')}`,
    `- MIDI41 amendment result: ${inline('690221637732fe46c4c7420254175b1b36720b181051b6c04a5710e13d8e0744')}; effective baseline: 12/12 PASS`,
    `- Search manifest: ${inline('27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095')}; verifier compatibility: ${inline(results.identity?.compatibilitySha256||'recorded in the immutable preflight')}`,
    '', '**Stage3E search:**',
    phaseReportLines('low screen and top-five validation',results.low),
    phaseReportLines('mid screen and top-five validation',results.mid),
    phaseReportLines('final selection',results.selection),
    `- selected L/M/H tuple: ${inline(JSON.stringify(selected))}`,
    '', '**Production promotion and authoritative Stage3:**',
    `- Focused regressions: ${results.promotion.regressionDecision}; dual-copy result: ${inline(path.relative(evidenceRoot,results.promotion.regressionResultsPath))}`,
    `- Selected-values commit: ${inline(results.selectedValuesCommit.commit)}; production WASM SHA-256: ${inline(results.productionBuild.wasmSha256)}`,
    `- Stage3: 480 direct + 6 sentinels = ${stage3Calls} calls; decision ${inline(results.stage3.decision)}; result SHA-256 ${inline(results.stage3.resultSha256)}`,
    '', '**Stage4:**',
    `- Lifecycle cells: 1408; deterministic repeats: 15; acoustic calls: ${stage4Calls}; adjacent comparisons: 1392 computed from persisted cells with 0 renders`,
    `- Decision ${inline(results.stage4.decision)}; result SHA-256 ${inline(results.stage4.resultSha256)}`,
    '', '**Accounting and verification:**',
    `- Previously completed new renders: 27; Stage3E search renders: ${lowCalls+midCalls}; Stage3: 486; Stage4: 1423; production candidate delta: 0`,
    `- Full CTest: PASS; Web Player tests/build: PASS; diff/privacy checks: ${results.verification.privacyScan}`,
    `- Durable roots verified by phase: primary ${inline('<GIT_COMMON_DIR>/soraoto-agent-state/7/stage3e/')}; secondary ${inline('$HOME/.soraoto-agent-archive/soraoto_dsl/7/stage3e/')}`,
    '- Issue #7 remains OPEN / `phase:review`; PR #8 remains OPEN and retains `Closes #7`.',
    '- Stage3E selection is diagnostic evidence. Stage3 is authoritative; Stage4 is complete. No PR merge was performed.',''
  ].join('\n');
}
function parseJsonOutput(output){const start=output.indexOf('{');if(start<0)throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: command did not return JSON');return JSON.parse(output.slice(start));}
function withTemporaryBody(report,operation){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-review-'));
  const file=path.join(directory,'completion-report.md');
  try{fs.writeFileSync(file,report,{mode:0o600});return operation(file);}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
}
function updateStatusAndCommit({root,report}={}){
  const file=path.join(root,STATUS_FILE),current=fs.readFileSync(file,'utf8'),marker=current.indexOf(REPORT_MARKER);
  if(marker>=0){
    const existing=current.slice(marker).trim();
    if(existing!==report.trim())throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: existing status completion report differs');
    const commit=runCommand('rtk',['git','log','-1','--format=%H','--',STATUS_FILE],{root,quiet:true}).trim();
    if(!/^[0-9a-f]{40}$/.test(commit))throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: status report commit is missing');
    return {report:existing,statusCommit:commit,reused:true};
  }
  if(runCommand('rtk',['git','status','--porcelain','--untracked-files=no'],{root,quiet:true}).trim())
    throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: tracked worktree is dirty before status-only report');
  if(runCommand('rtk',['git','diff','--cached','--name-only'],{root,quiet:true}).trim())
    throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: index is not clean before status-only report');
  const temp=`${file}.tmp-${process.pid}`,mode=fs.statSync(file).mode&0o777;
  fs.writeFileSync(temp,`${current.trimEnd()}\n\n${report}`,{mode});fs.renameSync(temp,file);
  runCommand('rtk',['git','add','--',STATUS_FILE],{root});
  const staged=runCommand('rtk',['git','diff','--cached','--name-only'],{root,quiet:true}).trim();
  if(staged!==STATUS_FILE)throw new Error(`BLOCKED_ISSUE_7_REVIEW_HANDOFF: status-only staged path mismatch: ${staged}`);
  runCommand('rtk',['git','diff','--cached','--check'],{root});
  runCommand('rtk',['git','commit','-m','docs(supersynth): report Stage3E through Stage4 completion'],{root});
  return {report,statusCommit:runCommand('rtk',['git','rev-parse','HEAD'],{root,quiet:true}).trim(),reused:false};
}
function publishReviewHandoff({root,home,results}={}){
  let report=completionReport({root,home,results});
  const saved=updateStatusAndCommit({root,report});report=saved.report;
  const statusCommit=saved.statusCommit;
  const branch=runCommand('rtk',['git','fetch','origin',`refs/heads/${PR_BRANCH}:refs/remotes/origin/${PR_BRANCH}`],{root,quiet:true});
  void branch;
  const remoteHead=runCommand('rtk',['git','rev-parse',`refs/remotes/origin/${PR_BRANCH}`],{root,quiet:true}).trim();
  const localHead=runCommand('rtk',['git','rev-parse','HEAD'],{root,quiet:true}).trim();
  try{runCommand('rtk',['git','merge-base','--is-ancestor',remoteHead,localHead],{root,quiet:true});}
  catch{throw new Error(`BLOCKED_ISSUE_7_REVIEW_HANDOFF: PR branch ${PR_BRANCH} is not an ancestor of local HEAD`);}
  const prBefore=parseJsonOutput(runCommand('rtk',['gh','pr','view','8','--json','state,headRefName,body'],{root,quiet:true}));
  if(prBefore.state!=='OPEN'||prBefore.headRefName!==PR_BRANCH||!/#7\b/i.test(prBefore.body||''))
    throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: PR #8 state, branch, or Closes #7 body contract changed');
  runCommand('rtk',['git','push','origin',`HEAD:refs/heads/${PR_BRANCH}`],{root});
  const prBody=`${report}\n\nStatus report commit: \`${statusCommit}\``;
  let body=prBefore.body||'';
  const oldIndex=body.indexOf(REPORT_MARKER);
  if(oldIndex>=0){if(body.slice(oldIndex).trim()!==prBody.trim())throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: PR #8 already has a different completion report');}
  else{
    body=`${body.trimEnd()}\n\n---\n\n${prBody}\n`;
    withTemporaryBody(body,file=>runCommand('rtk',['gh','pr','edit','8','--body-file',file],{root}));
  }
  const prAfter=parseJsonOutput(runCommand('rtk',['gh','pr','view','8','--json','state,headRefName,headRefOid,body'],{root,quiet:true}));
  if(prAfter.state!=='OPEN'||prAfter.headRefName!==PR_BRANCH||prAfter.headRefOid!==localHead||!/#7\b/i.test(prAfter.body||'')||!prAfter.body.includes(REPORT_MARKER))
    throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: pushed PR #8 does not retain the expected head/body state');
  const comments=runCommand('rtk',['gh','api','repos/puchinya/soraoto_dsl/issues/7/comments','--paginate','--jq','.[].body'],{root,quiet:true});
  if(!comments.includes(REPORT_MARKER)||!comments.includes(statusCommit)){
    const issueComment=`${report}\n\nStatus report commit: \`${statusCommit}\``;
    withTemporaryBody(issueComment,file=>runCommand('rtk',['gh','issue','comment','7','--body-file',file],{root}));
  }
  runCommand('rtk',['gh','issue','edit','7','--add-label','phase:review','--remove-label','phase:implementation','--remove-label','blocked'],{root});
  const issue=parseJsonOutput(runCommand('rtk',['gh','issue','view','7','--json','state,labels'],{root,quiet:true}));
  const labels=(issue.labels||[]).map(label=>typeof label==='string'?label:label.name);
  if(issue.state!=='OPEN'||!labels.includes('phase:review')||labels.includes('blocked')||labels.includes('phase:implementation'))
    throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: Issue #7 did not reach OPEN / phase:review');
  return {decision:'ISSUE_7_PHASE_REVIEW',statusCommit,prHead:localHead,prUrl:'https://github.com/puchinya/soraoto_dsl/pull/8',issueLabels:labels};
}
function runPipeline({mode,adapters}={}){
  requireApi(adapters);
  if(mode==='--dry-run'){
    const identity=adapters.preflight();
    const dry=adapters.stage3eDryRun();
    assertZeroRender(dry,'dry-run');
    const phaseEntry=adapters.phaseEntryDryRun();
    if(phaseEntry?.decision!=='STAGE3E_PIPELINE_PHASES_DRY_RUN_READY')
      throw new Error(`BLOCKED_STAGE3E_MASTER_PHASE_ENTRY: phase contract dry-run failed: ${phaseEntry?.decision||'no decision'}`);
    assertZeroRender(phaseEntry,'phase-entry-dry-run');
    if(phaseEntry.stage3?.authorizedRenderCount!==486||phaseEntry.stage4?.authorizedRenderCount!==1423)
      throw new Error('BLOCKED_STAGE3E_MASTER_PHASE_ENTRY: Stage3/Stage4 authorization schema mismatch');
    return {decision:'STAGE3E_MASTER_DRY_RUN_READY',builds:0,renders:0,acousticRenders:0,evidenceWrites:0,
      identity:summarizePreflight(identity),stage3e:summarizeStage3eDryRun(dry),phaseEntry,stage3eSearchEnabled:true,
      stage3:'LOCKED_UNTIL_STAGE3E_SELECTION',stage4:'LOCKED_UNTIL_STAGE3_READY'};
  }
  if(mode!=='--execute')throw new Error('explicit master mode required: --dry-run or --execute');
  const results={};
  results.identity=summarizePreflight(adapters.preflight());
  const dry=adapters.stage3eDryRun();assertZeroRender(dry,'pre-execution-dry-run');
  results.low=adapters.low();assertDecision(results.low,'STAGE3E_LOW_RESPONSE_FAMILY_PASS','low');
  results.mid=adapters.mid();assertDecision(results.mid,'STAGE3E_MID_RESPONSE_FAMILY_PASS','mid');
  results.selection=adapters.selection();assertDecision(results.selection,'STAGE3E_SELECTION_READY_FOR_PRODUCTION_PREFLIGHT','selection');
  if(!results.selection.selection?.selected)throw new Error('BLOCKED_STAGE3E_MASTER_SELECTION: selected tuple is missing');
  results.promotion=adapters.promoteAndRegress(results.selection.selection);
  if(results.promotion?.regressionDecision!=='PASS'||!results.promotion.regressionResultsPath)
    throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: six focused regressions did not pass or were not persisted');
  results.selectedValuesCommit=adapters.commitSelectedValues(results.selection.selection);
  if(!/^[0-9a-f]{40}$/.test(results.selectedValuesCommit?.commit||''))throw new Error('BLOCKED_STAGE3_SELECTED_VALUES_COMMIT: commit identity is missing');
  results.productionBuild=adapters.productionBuild(results.selectedValuesCommit);
  if(results.productionBuild?.stage3eExportsPresent!==false)throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: Stage3E diagnostic exports are present in production build');
  results.stage3DryRun=adapters.stage3DryRun(results.promotion);
  assertZeroRender(results.stage3DryRun,'stage3-dry-run');
  if(results.stage3DryRun.authorizedRenderCount!==486)throw new Error('BLOCKED_STAGE3_CAPTURE_COVERAGE: expected 480 direct + 6 sentinels');
  results.stage3Execute=adapters.stage3Execute(results.promotion);
  if(results.stage3Execute?.renders!==486)throw new Error('BLOCKED_STAGE3_CAPTURE_COVERAGE: authoritative Stage3 must spend exactly 486 calls');
  results.stage3=adapters.stage3Finalize(results.promotion);
  assertDecision(results.stage3,'STAGE3_READY_FOR_STAGE4','stage3');
  results.stage4DryRun=adapters.stage4DryRun();assertZeroRender(results.stage4DryRun,'stage4-dry-run');
  if(results.stage4DryRun.authorizedRenderCount!==1423)throw new Error('BLOCKED_STAGE4_CAPTURE_COVERAGE: expected 1408 lifecycle + 15 repeats');
  results.stage4Execute=adapters.stage4Execute();
  if(results.stage4Execute?.renders!==1423)throw new Error('BLOCKED_STAGE4_CAPTURE_COVERAGE: expected 1423 lifecycle/repeat calls');
  results.stage4=adapters.stage4Finalize();assertDecision(results.stage4,'STAGE4_FULL_RANGE_COMPLETE','stage4');
  results.verification=adapters.fullVerification();
  if(results.verification?.decision!=='PASS')throw new Error('BLOCKED_STAGE4_FINAL_VERIFICATION: required test suite did not pass');
  results.review=adapters.reviewHandoff(results);
  if(results.review?.decision!=='ISSUE_7_PHASE_REVIEW')throw new Error('BLOCKED_ISSUE_7_REVIEW_HANDOFF: delivery did not reach phase:review');
  return {decision:'ISSUE_7_PHASE_REVIEW',identity:results.identity,low:summarizeStageResult(results.low),mid:summarizeStageResult(results.mid),
    selection:summarizeStageResult(results.selection),promotion:summarizeStageResult(results.promotion),selectedValuesCommit:results.selectedValuesCommit,
    productionBuild:results.productionBuild,stage3DryRun:summarizeStageResult(results.stage3DryRun),stage3Execute:summarizeStageResult(results.stage3Execute),
    stage3:summarizeStageResult(results.stage3),stage4DryRun:summarizeStageResult(results.stage4DryRun),
    stage4Execute:summarizeStageResult(results.stage4Execute),stage4:summarizeStageResult(results.stage4),
    verification:results.verification,review:results.review};
}
function requirePreflightExports(){
  if(typeof preflight.preflight!=='function'||typeof stage3e.run!=='function'||typeof generation2.run!=='function'||
     typeof stage3.run!=='function'||typeof stage4.run!=='function')throw new Error('BLOCKED_STAGE3E_MASTER_API: required phase API export is undefined');
}
function createRealAdapters({root=ROOT,home=process.env.HOME}={}){
  const buildStage3e=path.resolve(root,'build/wasm-stage3e'),buildProduction=path.resolve(root,'build/wasm');
  let regressionResultsPath=null,selectedTuple=null;
  const node=(file,env,quiet=true)=>runCommand('rtk',['node',file],{root,env,quiet});
  function stage3ePhase(mode){return withBuildDirectory(buildStage3e,()=>generation2.run({mode,root,home}));}
  function promoteAndRegress(selection){
    selectedTuple=selection.selected;
    const presetPath=path.join(root,SELECTED_INPUTS[0]),presets=JSON.parse(fs.readFileSync(presetPath,'utf8'));
    const hammer=presets.concert_grand?.engine_config?.hammer;
    if(!hammer)throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROMOTION: concert_grand hammer settings missing');
    hammer.velocity_launch_scale_low=selectedTuple.low;
    hammer.velocity_launch_scale_mid=selectedTuple.mid;
    hammer.velocity_hardness_scale_bass=selectedTuple.bassHardness;
    fs.writeFileSync(presetPath,JSON.stringify(presets,null,2)+'\n');
    runCommand('rtk',['python3','wasm/cmake/generate_plugin_metadata.py',buildStage3e],{root});
    runCommand('rtk',['cmake','--build',buildStage3e,'--target','soraoto_dsp_super_synth'],{root});
    const env={...process.env,SORAOTO_WASM_BUILD_DIR:buildStage3e},testResults={};
    for(const [name,file] of Object.entries(REGRESSIONS)){
      const output=node(file,env,true);testResults[name]={result:'PASS',exitCode:0,outputSha256:sha256(Buffer.from(output))};
    }
    stage3.validateRegressionResults(testResults);
    const roots=stage3.stage3Roots(root,home),relative='focused-regressions.json';
    const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative),bytes=Buffer.from(JSON.stringify(testResults,null,2)+'\n');
    if(fs.existsSync(a)||fs.existsSync(b)){
      const stored=require('./durable-evidence.cjs').verifyDualCopy(a,b);
      if(!stored.bytes.equals(bytes))throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: immutable focused regression result differs');
    }else stage3.writeDualJson(roots,relative,testResults);
    regressionResultsPath=a;
    return {regressionDecision:'PASS',regressionResultsPath,results:testResults};
  }
  return {
    preflight:()=>withBuildDirectory(buildStage3e,()=>stage3e.evidencePreflight({root,home})),
    stage3eDryRun:()=>withBuildDirectory(buildStage3e,()=>generation2.run({mode:'--dry-run',root,home})),
    phaseEntryDryRun:()=>validatePipelinePhaseContracts(),
    low:()=>stage3ePhase('--low'),mid:()=>stage3ePhase('--mid'),selection:()=>stage3ePhase('--finalize'),
    promoteAndRegress,
    commitSelectedValues:()=>{
      const status=runCommand('rtk',['git','status','--porcelain','--untracked-files=no'],{root,quiet:true}).trim();
      const changed=status?status.split(/\r?\n/).map(line=>line.slice(3)).sort():[];
      if(changed.length===0){
        const subject=runCommand('rtk',['git','log','-1','--format=%s'],{root,quiet:true}).trim();
        const commitPaths=runCommand('rtk',['git','diff-tree','--no-commit-id','--name-only','-r','HEAD'],{root,quiet:true}).trim().split(/\r?\n/).filter(Boolean).sort();
        if(subject!==stage3.SELECTED_VALUES_COMMIT_SUBJECT||JSON.stringify(commitPaths)!==JSON.stringify([...SELECTED_INPUTS].sort()))
          throw new Error('BLOCKED_STAGE3_SELECTED_VALUES_COMMIT: no pending selected-value change and HEAD is not the existing selected-values commit');
        return {commit:runCommand('rtk',['git','rev-parse','HEAD'],{root,quiet:true}).trim(),reused:true};
      }
      if(changed.length!==2||!changed.every(file=>SELECTED_INPUTS.includes(file)))
        throw new Error(`BLOCKED_STAGE3_SELECTED_VALUES_COMMIT: unexpected changed production paths ${changed.join(',')}`);
      runCommand('rtk',['git','add','--',...SELECTED_INPUTS],{root});
      const staged=runCommand('rtk',['git','diff','--cached','--name-only'],{root,quiet:true}).trim().split(/\r?\n/).filter(Boolean).sort();
      if(JSON.stringify(staged)!==JSON.stringify([...SELECTED_INPUTS].sort()))throw new Error('BLOCKED_STAGE3_SELECTED_VALUES_COMMIT: staged path set differs');
      runCommand('rtk',['git','commit','-m',stage3.SELECTED_VALUES_COMMIT_SUBJECT],{root});
      return {commit:runCommand('rtk',['git','rev-parse','HEAD'],{root,quiet:true}).trim()};
    },
    productionBuild:()=>{
      const toolchain=path.join(root,'wasm/cmake/wasm32-clang.cmake');
      runCommand('rtk',['cmake','-S','wasm','-B',buildProduction,`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
        '-DBUILD_TESTING=ON','-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=OFF','-DSORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=OFF',
        '-DSORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS=OFF','-DSORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS=OFF',
        '-DSORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS=OFF','-DSORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS=OFF'],{root});
      runCommand('rtk',['cmake','--build',buildProduction],{root});
      const wasmPath=path.join(buildProduction,stage3.WASM_RELATIVE),exported=stage3eExports(wasmPath);
      return {stage3eExportsPresent:exported.length!==0,stage3eExports:exported,wasmSha256:stage3.fileSha(wasmPath)};
    },
    stage3DryRun:()=>withBuildDirectory(buildProduction,()=>stage3.run({mode:'--dry-run',root,home})),
    stage3Execute:()=>withBuildDirectory(buildProduction,()=>stage3.run({mode:'--execute',root,home,regressionResultsPath})),
    stage3Finalize:()=>withBuildDirectory(buildProduction,()=>stage3.run({mode:'--finalize',root,home,regressionResultsPath})),
    stage4DryRun:()=>withBuildDirectory(buildProduction,()=>stage4.run({mode:'--dry-run',root,home})),
    stage4Execute:()=>withBuildDirectory(buildProduction,()=>stage4.run({mode:'--execute',root,home})),
    stage4Finalize:()=>withBuildDirectory(buildProduction,()=>stage4.run({mode:'--finalize',root,home})),
    fullVerification:()=>{
      runCommand('rtk',['ctest','--test-dir',buildProduction,'--output-on-failure'],{root});
      runCommand('rtk',['npm','test'],{root:path.join(root,'web-player')});
      runCommand('rtk',['npm','run','build'],{root:path.join(root,'web-player')});
      runCommand('rtk',['git','diff','--check'],{root});
      const changed=runCommand('rtk',['git','diff','--name-only','0deb72ad09f9db53e4619ea3e48c5cb1e4626fb0...HEAD'],{root,quiet:true});
      if(/(^|\/)(\.agent-state|soraoto-agent-state|\.soraoto-agent-archive)(\/|$)|\.(wav|aiff|flac|caf|wasm)$/im.test(changed))
        throw new Error('BLOCKED_STAGE3E_PRIVACY_SCAN: private evidence or binary artifact path appears in tracked diff');
      return {decision:'PASS',privacyScan:'PASS',commands:['rtk ctest --test-dir build/wasm --output-on-failure','(cd web-player && rtk npm test)','(cd web-player && rtk npm run build)','rtk git diff --check']};
    },
    reviewHandoff:results=>publishReviewHandoff({root,home,results})
  };
}
function run({mode,root=ROOT,home=process.env.HOME,adapters=null}={}){
  requirePreflightExports();
  if(mode!=='--execute')return runPipeline({mode,adapters:adapters||createRealAdapters({root,home})});
  const commonDir=runCommand('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{root,quiet:true}).trim();
  const executionIdentity=sha256(Buffer.from(`${runCommand('rtk',['git','rev-parse','HEAD'],{root,quiet:true}).trim()}\n${mode}`));
  const lock=acquireMasterExecutionLock(commonDir,{identity:executionIdentity});
  try{return runPipeline({mode,adapters:adapters||createRealAdapters({root,home})});}
  finally{lock.release();}
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==1)throw new Error('one explicit mode is required: --dry-run or --execute');
  const result=run({mode:argv[0]});process.stdout.write(JSON.stringify(result)+'\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={ROOT,REGRESSIONS,SELECTED_INPUTS,STATUS_FILE,PR_BRANCH,REPORT_MARKER,sha256,runCommand,withBuildDirectory,stage3eExportNames,stage3eExports,
  acquireMasterExecutionLock,requireApi,assertDecision,assertZeroRender,summarizePreflight,summarizeStage3eDryRun,summarizeStageResult,
  validatePipelinePhaseContracts,phaseReportLines,completionReport,updateStatusAndCommit,publishReviewHandoff,runPipeline,requirePreflightExports,createRealAdapters,run,main};
