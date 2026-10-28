#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const stage3b=require('./run-stage3b-contact-attribution.cjs');
const continuation=require('./run-stage3c-equivalence-correction-and-split.cjs');
const core=require('./stage3c-attribution-core.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const BASE='.agent-state/issues/7/stage3c';
const CANDIDATE='stage2n-r3-candidate-01';
const AUTHORITATIVE_RESULT=Object.freeze({
  sha256:'1a6f5c251ae06379b199bee7aebb08774412d2f388443837a66fbefec1e63737',
  schemaVersion:1,
  decision:'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE',
  candidateId:CANDIDATE,
  equivalenceDecision:'STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE',
  correctedEquivalenceSha256:'e28178043baaf087dae5795d63e3de5acb74cc06904972e88a5755f8860a8b97',
  correctionLedgerSha256:'5fe8da6e32b7195a1b186f724ed41638b54db379ef2da64c2c00d75b09aef46b',
  continuationLedgerSha256:'6cd380fe66f7b0d0a7a410f00ba8e40fc403f6c9b227382c4d53cd903d6d5d19',
  ledgerSha256:'6cd380fe66f7b0d0a7a410f00ba8e40fc403f6c9b227382c4d53cd903d6d5d19',
  continuationAggregateCount:24,
  stage3bAggregateCount:39,
  executionSourceRevision:'d3fa2e359dae0a8a21c04f1f535259d4a89cc59b',
  finalizerSourceRevision:'d88ee6f0c061548409f8a19d452c5276560999de',
  finalizerSha256:'ea567b05b950ad08395ab7e08938a1660c5e32978ffac25e92dc6fad5c6da08c',
  attributionCoreSha256:'0d1ffa7d6bf4ba5b711b2e211a99aaa012290bf7d2aa86b6bbf33bd322960bdf',
  accounting:Object.freeze({stage3aHistoricalCalls:390,stage3bMask0Calls:6,stage3bFactorCalls:477,
    stage3cHistoricalEquivalenceCalls:20,stage3cCorrectionCalls:1,stage3cSplitCalls:286,cumulativeDiagnosticCalls:1180,
    physicalCandidateDelta:0,stage4Renders:0}),
  productionCandidateDelta:0,
  stage4Renders:0
});
const EXPECTED={
  originalLedger:'348409a1fe0ded9fd9f60d5cd91dcfd80990d4df1d8635578e079c86b7ca5055',
  originalBlockedEvaluation:'4141debf0673e8b36cd6c34363e0a8f0e91540e6cb228fef9e00dd3714d3fcf9',
  correctionLedger:'5fe8da6e32b7195a1b186f724ed41638b54db379ef2da64c2c00d75b09aef46b',
  correctionCell:'018da7dd3687006eb7989881d33b2daaf9b2fe93918c66ba7d084f64a42eb925',
  correctedEquivalence:'e28178043baaf087dae5795d63e3de5acb74cc06904972e88a5755f8860a8b97',
  continuationLedger:'6cd380fe66f7b0d0a7a410f00ba8e40fc403f6c9b227382c4d53cd903d6d5d19',
  stage3bLedger:'3c688ce49877dd7a94a2920c02bc9ddb7145709d06b1e7a04a7aecda4b18fbaf',
  stage3bAnalysis:'220c4904fc858ee671002ce84de85a75abd2271f78a53f433dbf5bd4021675cb',
  stage3aLedger:'e43d6d1b88f57766d0c48e413801916b313580cec83d629b54835be0f23060e9',
  stage3aFinal:'e953ba33a363f378a006aafcbe4066cb1b05d69ac42ca1f401cd68d7e7261cd4',
  stage3aSupplement:'91b6b4df895a2a044135752156b88d1ab04806f02ebd338a8518f703e29c1713',
  stage3cWasm:'387c12fa16f684435f904a9c18c063099141332b53b28cd5cbd35bca15482235',
  productionWasm:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  correctedDecision:'STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE',
  executionSourceRevision:'d3fa2e359dae0a8a21c04f1f535259d4a89cc59b'
};
const EXPECTED_PATHS={
  originalLedger:`${BASE}/equivalence/ledger.json`,originalBlockedEvaluation:`${BASE}/equivalence.json`,
  correctionLedger:`${BASE}/correction/ledger.json`,correctedEquivalence:`${BASE}/correction/equivalence-corrected.json`,
  continuationLedger:`${BASE}/continuation/ledger.json`,stage3bLedger:'.agent-state/issues/7/stage3b/ledger.json',
  stage3bAnalysis:'.agent-state/issues/7/stage3b/factorial-analysis.json',
  stage3aLedger:'.agent-state/issues/7/stage3a/recovery/recovery-ledger.json',
  stage3aFinal:'.agent-state/issues/7/stage3a/velocity-diagnostic.json',
  stage3aSupplement:'.agent-state/issues/7/stage3a/supplemental-3-render-result.json',
  buildIdentity:`${BASE}/build-identity.json`,stage3cWasm:'build/wasm-stage3c/plugins/dsp/super-synth/plugin.wasm',
  continuationRunner:'wasm/plugins/dsp/super-synth/test/tools/run-stage3c-equivalence-correction-and-split.cjs',
  historicalRunner:'wasm/plugins/dsp/super-synth/test/tools/run-stage3c-impedance-split-diagnostic.cjs',
  captureEvaluator:'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
  pluginSource:'wasm/plugins/dsp/super-synth/src/plugin.c',cmakeSource:'wasm/cmake/wasm_plugin.cmake'
};

function shaFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function shaBytes(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function cellKey(cell){
  const velocity=cell.velocity===null?`n${String(Math.round(cell.velocityNormalized*100)).padStart(2,'0')}`:`v${String(cell.velocity).padStart(3,'0')}`;
  return `${cell.kind}:mask-${cell.stage3cMask}:midi-${String(cell.pitch).padStart(3,'0')}:${velocity}`;
}
function resultPath(root=ROOT){return path.join(root,BASE,'continuation/split-attribution.json');}
function fail(kind,message){throw new Error(`${kind}: ${message}`);}
function checkSha(root,relative,expected,label,kind='BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY'){
  const file=path.join(root,relative);
  if(!fs.existsSync(file)||shaFile(file)!==expected)fail(kind,`${label} SHA mismatch or missing`);
  return file;
}
function fixedEvidence(root,expected=EXPECTED){
  if(fs.existsSync(path.join(root,BASE,'split')))
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','obsolete split evidence path must remain absent');
  const files={};
  for(const [key,relative] of Object.entries(EXPECTED_PATHS)){
    if(Object.hasOwn(expected,key))files[key]=checkSha(root,relative,expected[key],key,
      key==='continuationLedger'||key==='correctedEquivalence'||key==='correctionLedger'?'BLOCKED_STAGE3C_CONTINUATION_EVIDENCE':'BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY');
  }
  for(const key of ['continuationRunner','historicalRunner','captureEvaluator','pluginSource','cmakeSource'])files[key]=path.join(root,EXPECTED_PATHS[key]);
  files.buildIdentity=path.join(root,EXPECTED_PATHS.buildIdentity);
  if(!fs.existsSync(files.buildIdentity))fail('BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY','persisted historical build identity is missing');
  const continuationLedger=readJson(files.continuationLedger),identity=continuationLedger.identity;
  if(continuationLedger.phase!=='continuation'||continuationLedger.candidateId!==CANDIDATE||continuationLedger.authorizedRenderCount!==286
      ||continuationLedger.accounting?.newRenderCalls!==286||continuationLedger.accounting?.productionCandidateDelta!==0
      ||continuationLedger.accounting?.stage4Renders!==0||identity?.executionSourceRevision!==expected.executionSourceRevision)
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','continuation ledger header/accounting/source revision mismatch');
  const buildIdentity=readJson(files.buildIdentity);
  if(buildIdentity.candidateId!==CANDIDATE||buildIdentity.stage3cDiagnosticWasmSha256!==expected.stage3cWasm
      ||buildIdentity.productionWasmSha256!==expected.productionWasm||buildIdentity.aggregateCount!==39
      ||shaFile(files.buildIdentity)!==identity.historicalBuildIdentitySha256)
    fail('BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY','persisted historical build identity mismatch');
  const sources=[['continuationRunner','continuationRunnerSha256'],['historicalRunner','historicalRunnerSha256'],
    ['captureEvaluator','captureEvaluatorSha256']];
  for(const [fileKey,idKey] of sources)if(shaFile(files[fileKey])!==identity[idKey])
    fail('BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY',`${fileKey} no longer matches persisted execution identity`);
  for(const [fileKey,idKey] of [['pluginSource','pluginSourceSha256'],['cmakeSource','cmakeSourceSha256']])
    if(shaFile(files[fileKey])!==buildIdentity[idKey])fail('BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY',`${fileKey} no longer matches persisted historical build identity`);
  if(identity.stage3cDiagnosticWasmSha256!==expected.stage3cWasm||buildIdentity.stage3cWasmPath!==path.join(root,'build/wasm-stage3c/plugins/dsp/super-synth/plugin.wasm')
      ||shaFile(files.stage3cWasm)!==expected.stage3cWasm)
    fail('BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY','Stage3C WASM identity mismatch');
  if(identity.originalEquivalenceLedgerSha256!==expected.originalLedger||identity.originalBlockedEvaluationSha256!==expected.originalBlockedEvaluation
      ||identity.stage3aSupplementSha256!==expected.stage3aSupplement||identity.stage3bLedgerSha256!==expected.stage3bLedger
      ||identity.stage3bFactorialAnalysisSha256!==expected.stage3bAnalysis)
    fail('BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY','persisted continuation evidence bindings changed');
  const corrected=readJson(files.correctedEquivalence);
  if(corrected.decision!==expected.correctedDecision||corrected.effectiveEquivalenceCellCount!==20||corrected.historicalPassCount!==19
      ||corrected.correctionPassCount!==1||corrected.maxMetricDifference>1e-6
      ||corrected.identitySha256!==crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')
      ||corrected.correctionCellSha256!==expected.correctionCell
      ||continuationLedger.correctedEquivalenceSha256!==expected.correctedEquivalence)
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','corrected-equivalence evidence is incomplete or not bound');
  const correctionLedger=readJson(files.correctionLedger);
  if(JSON.stringify(correctionLedger.identity)!==JSON.stringify(identity))
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','correction and continuation identities differ');
  let correctionCounts;
  try{correctionCounts=continuation.validateLedger(correctionLedger,correctionLedger.identity,'correction',1);}
  catch(error){fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE',error.message||String(error));}
  if(!sameCounts(correctionCounts,{COMPLETE:1,PENDING:0,IN_PROGRESS:0}))
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','correction ledger is not one COMPLETE row');
  const correctionEntry=Object.values(correctionLedger.cells||{})[0];
  if(!correctionEntry||correctionEntry.state!=='COMPLETE')fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','correction ledger cell missing');
  const correctionCellFile=path.resolve(path.dirname(files.correctionLedger),correctionEntry.path);
  if(!fs.existsSync(correctionCellFile)||shaFile(correctionCellFile)!==expected.correctionCell||correctionEntry.sha256!==expected.correctionCell)
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','correction cell hash mismatch');
  const correctionCell=readJson(correctionCellFile);
  if(correctionCell.metrics?.finite!==true||correctionCell.comparison?.pass!==true
      ||correctionCell.identity?.executionSourceRevision!==expected.executionSourceRevision)
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','correction cell is not a finite passing comparison');
  return {files,identity,buildIdentity,continuationLedger,correctedEquivalence:corrected,correctionLedger,correctionCellFile};
}
function sameCounts(a,b){return Object.keys(b).every(key=>a[key]===b[key])&&Object.keys(a).every(key=>b[key]===a[key]);}
function validateContinuation(root=ROOT,expected=EXPECTED,modules={continuation,stage3b}){
  const evidence=fixedEvidence(root,expected),{continuationLedger:ledger,identity,correctedEquivalence}=evidence;
  const counts=modules.continuation.validateLedger(ledger,identity,'continuation',286);
  if(!sameCounts(counts,{COMPLETE:286,PENDING:0,IN_PROGRESS:0})||Object.keys(ledger.cells||{}).length!==286||Object.keys(ledger.aggregates||{}).length!==24)
    fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','continuation requires 286 COMPLETE rows and 24 aggregates');
  const cells=modules.continuation.splitCells();
  if(cells.length!==286)fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','continuation authorization cell count changed');
  const rows=cells.map(cell=>{
    const key=cellKey(cell),entry=ledger.cells[key];
    const file=path.resolve(root,BASE,'continuation',entry?.path||'');
    if(!entry||!fs.existsSync(file)||shaFile(file)!==entry.sha256)
      fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE',`cell hash/state mismatch ${key}`);
    const persisted=readJson(file);
    if(persisted.metrics?.finite!==true)fail('BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC',`non-finite continuation row ${key}`);
    return modules.continuation.validateContinuationCell(ledger,cell,identity,expected.correctedEquivalence,root);
  });
  if(rows.length!==286)fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','continuation cell validation count mismatch');
  if(rows.some(row=>row.metrics?.finite!==true))fail('BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC','non-finite continuation row');
  const aggregateCount=modules.continuation.validateAggregates(ledger,rows,identity,expected.correctedEquivalence,root);
  if(aggregateCount!==24)fail('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE','continuation aggregate count mismatch');
  const baselineResult=modules.stage3b.loadStage3ABaseline(root);
  if(typeof modules.stage3b.assertAuthoritativeProductionIdentity==='function')modules.stage3b.assertAuthoritativeProductionIdentity(root);
  if(typeof modules.stage3b.assertStage3AEvidenceIdentity==='function'){
    const stage3aIdentity=modules.stage3b.assertStage3AEvidenceIdentity(root)?.identity;
    if(stage3aIdentity&&(stage3aIdentity.stage3aLedgerSha256!==expected.stage3aLedger
        ||stage3aIdentity.stage3aFinalSha256!==expected.stage3aFinal||stage3aIdentity.stage3aSupplementSha256!==expected.stage3aSupplement))
      fail('BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY','accepted Stage3A evidence identity mismatch');
  }
  const supplement=readJson(evidence.files.stage3aSupplement);
  const stage3bAnalysis=readJson(evidence.files.stage3bAnalysis);
  const accounting={stage3aHistoricalCalls:390,stage3bMask0Calls:6,stage3bFactorCalls:477,stage3cHistoricalEquivalenceCalls:20,
    stage3cCorrectionCalls:1,stage3cSplitCalls:286,cumulativeDiagnosticCalls:1180,physicalCandidateDelta:0,stage4Renders:0};
  const attribution=core.calculateAttribution({candidateId:CANDIDATE,identity:{...evidence.buildIdentity,aggregateCount:39},
    stage3aBaseline:baselineResult.baseline,stage3aSupplement:supplement,stage3bAnalysis,stage3cRows:rows,
    stage3bAggregateCount:39,equivalenceSha256:expected.correctedEquivalence,
    continuationLedgerSha256:shaFile(evidence.files.continuationLedger),accounting});
  return {...evidence,counts,rows,aggregateCount,attribution,continuationLedgerSha256:shaFile(evidence.files.continuationLedger)};
}
function validateAuthoritativeResult(file,ready,expected=AUTHORITATIVE_RESULT){
  if(!fs.existsSync(file))fail('BLOCKED_STAGE3C_FINALIZER_EVIDENCE','authoritative attribution result is missing');
  let bytes,result;
  try{bytes=fs.readFileSync(file);result=JSON.parse(bytes.toString('utf8'));}
  catch{fail('BLOCKED_STAGE3C_FINALIZER_EVIDENCE','authoritative attribution result is malformed');}
  if(shaBytes(bytes)!==expected.sha256)fail('BLOCKED_STAGE3C_FINALIZER_EVIDENCE','authoritative attribution result SHA mismatch');
  const fields=['schemaVersion','decision','candidateId','equivalenceDecision','correctedEquivalenceSha256','correctionLedgerSha256',
    'continuationLedgerSha256','ledgerSha256','continuationAggregateCount','stage3bAggregateCount','executionSourceRevision',
    'finalizerSourceRevision','finalizerSha256','attributionCoreSha256','productionCandidateDelta','stage4Renders'];
  if(fields.some(key=>result[key]!==expected[key]))
    fail('BLOCKED_STAGE3C_FINALIZER_EVIDENCE','authoritative result identity/evidence/creator binding mismatch');
  const readyBindings={
    correctedEquivalenceSha256:shaFile(ready.files.correctedEquivalence),
    correctionLedgerSha256:shaFile(ready.files.correctionLedger),
    continuationLedgerSha256:ready.continuationLedgerSha256,
    ledgerSha256:ready.continuationLedgerSha256,
    continuationAggregateCount:ready.aggregateCount,
    stage3bAggregateCount:ready.attribution.stage3bAggregateCount,
    executionSourceRevision:ready.identity.executionSourceRevision
  };
  if(Object.entries(readyBindings).some(([key,value])=>result[key]!==value))
    fail('BLOCKED_STAGE3C_FINALIZER_EVIDENCE','authoritative result no longer matches validated evidence');
  const accounting=expected.accounting;
  if(!result.accounting||Object.entries(accounting).some(([key,value])=>result.accounting[key]!==value)
      ||Object.keys(result.accounting).length!==Object.keys(accounting).length
      ||ready.attribution.accounting&&Object.entries(accounting).some(([key,value])=>ready.attribution.accounting[key]!==value)
      ||result.productionCandidateDelta!==0||result.stage4Renders!==0)
    fail('BLOCKED_STAGE3C_FINALIZER_EVIDENCE','authoritative result accounting mismatch');
  return result;
}
function dryRun(root=ROOT,options={}){
  const ready=validateContinuation(root,options.expected||EXPECTED,options.modules||{continuation,stage3b});
  const file=resultPath(root);
  return {decision:'STAGE3C_FINALIZER_DRY_RUN_READY',builds:0,renders:0,acousticRenders:0,correctionReady:true,
    continuationComplete:true,continuationCells:ready.rows.length,continuationAggregates:ready.aggregateCount,
    continuationLedgerSha256:ready.continuationLedgerSha256,resultExists:fs.existsSync(file)};
}
function finalize(root=ROOT,options={}){
  const ready=validateContinuation(root,options.expected||EXPECTED,options.modules||{continuation,stage3b});
  const resultFile=resultPath(root);
  const existing=validateAuthoritativeResult(resultFile,ready);
  return {...existing,builds:0,renders:0,acousticRenders:0};
}
function modes(argv){if(argv.length!==1||!['--dry-run','--finalize'].includes(argv[0]))throw new Error('explicit mode required: --dry-run or --finalize');return argv[0];}
function run({mode,root=ROOT,options={}}){
  if(mode==='--dry-run')return dryRun(root,options);
  if(mode==='--finalize')return finalize(root,options);
  throw new Error('unsupported mode');
}
function main(){const mode=modes(process.argv.slice(2));process.stdout.write(`${JSON.stringify(run({mode}))}\n`);}
if(require.main===module){try{main();}catch(error){process.stderr.write(`Stage3C finalizer ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,CANDIDATE,EXPECTED,EXPECTED_PATHS,AUTHORITATIVE_RESULT,resultPath,shaFile,readJson,cellKey,fixedEvidence,validateContinuation,validateAuthoritativeResult,dryRun,finalize,modes,run};
