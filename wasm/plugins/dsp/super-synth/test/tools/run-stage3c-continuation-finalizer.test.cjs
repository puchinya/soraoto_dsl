'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const runner=require('./run-stage3c-continuation-finalizer.cjs');
const continuation=require('./run-stage3c-equivalence-correction-and-split.cjs');
const core=require('./stage3c-attribution-core.cjs');
const tempRoots=[];

const shaBytes=value=>crypto.createHash('sha256').update(value).digest('hex');
const shaFile=file=>shaBytes(fs.readFileSync(file));
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);};
function metrics(level=1,derivative=.1){
  const value={envelopeDbfs:[-1,-2,-3,level,-5],spectralCentroidHz:1000+level,above2kPowerRatio:.1+level/1000,
    peakDbfs:-2,fullRenderPeakDbfs:-1,finite:true,outputGuardHits:0,velocityDerivative:derivative,velocityDerivativeWindowMs:[30,180],
    stage2mFactorMask:3,stage3cVariantMask:0,stage2mHammer:{contactDurationSamples:level,peakForce:level*2,postContactTransverseEnergy:level*3},
    soundboardDiagnostics:{signals:{}}};
  for(const name of ['bridge_b','board_drive_b','post_radiation_l'])value.soundboardDiagnostics.signals[name]={rms:level/100,peak:level/50};
  return value;
}
function makeSyntheticRoot(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3c-finalizer-'));
  tempRoots.push(root);
  const rel=runner.EXPECTED_PATHS;
  const baseline=new Map();
  for(const pitch of [...core.DYNAMIC_PITCHES,...core.TREBLE_PITCHES]){
    const velocities=core.DYNAMIC_PITCHES.includes(pitch)?core.DYNAMIC_VELOCITIES:core.TREBLE_VELOCITIES;
    velocities.forEach((velocity,i)=>baseline.set(`${pitch}:${velocity}`,{pitch,velocity,metrics:metrics(i)}));
  }
  const supplement={rows:core.MIDI41_NORMALIZED.map((velocityNormalized,i)=>({pitch:41,velocity:null,velocityNormalized,metrics:metrics(i,.1+i*.1)}))};
  const diagnosticRows=[];
  for(const pitch of [...core.DYNAMIC_PITCHES,...core.TREBLE_PITCHES]){
    const velocities=core.DYNAMIC_PITCHES.includes(pitch)?core.DYNAMIC_VELOCITIES:core.TREBLE_VELOCITIES;
    velocities.forEach((velocity,i)=>diagnosticRows.push({stage3bMask:1,pitch,velocity,metrics:metrics(i+10,.2)}));
  }
  core.MIDI41_NORMALIZED.forEach((velocityNormalized,i)=>diagnosticRows.push({stage3bMask:1,pitch:41,velocity:null,velocityNormalized,metrics:metrics(i+10,.2+i*.1)}));
  const stage3bAnalysis={diagnosticRows,spanTables:core.DYNAMIC_PITCHES.map(pitch=>({pitch,stringCount:pitch<36?1:pitch<48?2:3,group:'fixture',spanByMask:{M0:{referenceSpanDb:15}}})),
    trebleGuardrail:core.TREBLE_PITCHES.flatMap(pitch=>core.TREBLE_VELOCITIES.map(velocity=>({pitch,velocity,errors:{M0:{referenceDbfs:-20}}})))};
  for(const key of ['originalLedger','originalBlockedEvaluation','stage3aLedger','stage3aFinal'])writeJson(path.join(root,rel[key]),{fixture:key});
  writeJson(path.join(root,rel.stage3bLedger),{fixture:'stage3b'});
  writeJson(path.join(root,rel.stage3bAnalysis),stage3bAnalysis);
  writeJson(path.join(root,rel.stage3aSupplement),supplement);
  const sourceContents={continuationRunner:'continuation historical source',historicalRunner:'historical source',captureEvaluator:'capture source',
    pluginSource:'plugin source',cmakeSource:'cmake source'};
  const sourceHashes={};for(const [key,content] of Object.entries(sourceContents)){const file=path.join(root,rel[key]);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);sourceHashes[key]=shaFile(file);}
  const wasmFile=path.join(root,rel.stage3cWasm);fs.mkdirSync(path.dirname(wasmFile),{recursive:true});fs.writeFileSync(wasmFile,'stage3c-wasm');
  const expected={};
  for(const [key,relative] of Object.entries(rel))if(['originalLedger','originalBlockedEvaluation','stage3bLedger','stage3bAnalysis','stage3aLedger','stage3aFinal','stage3aSupplement','stage3cWasm'].includes(key))expected[key]=shaFile(path.join(root,relative));
  expected.productionWasm='a'.repeat(64);expected.correctedDecision='STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE';
  expected.executionSourceRevision='d3fa2e359dae0a8a21c04f1f535259d4a89cc59b';
  const identity={schemaVersion:1,candidateId:runner.CANDIDATE,executionSourceRevision:expected.executionSourceRevision,
    historicalBuildIdentitySha256:'',stage3cDiagnosticWasmSha256:expected.stage3cWasm,originalEquivalenceLedgerSha256:expected.originalLedger,
    originalBlockedEvaluationSha256:expected.originalBlockedEvaluation,stage3aSupplementSha256:expected.stage3aSupplement,
    stage3bLedgerSha256:expected.stage3bLedger,stage3bFactorialAnalysisSha256:expected.stage3bAnalysis,
    captureEvaluatorSha256:sourceHashes.captureEvaluator,historicalRunnerSha256:sourceHashes.historicalRunner,
    continuationRunnerSha256:sourceHashes.continuationRunner,productionWasmSha256:expected.productionWasm};
  const buildIdentity={candidateId:runner.CANDIDATE,stage3cDiagnosticWasmSha256:expected.stage3cWasm,productionWasmSha256:expected.productionWasm,
    aggregateCount:39,pluginSourceSha256:sourceHashes.pluginSource,cmakeSourceSha256:sourceHashes.cmakeSource,stage3cWasmPath:wasmFile};
  writeJson(path.join(root,rel.buildIdentity),buildIdentity);
  identity.historicalBuildIdentitySha256=shaFile(path.join(root,rel.buildIdentity));
  const corrected={decision:expected.correctedDecision,effectiveEquivalenceCellCount:20,historicalPassCount:19,correctionPassCount:1,maxMetricDifference:0};
  const correctedFile=path.join(root,rel.correctedEquivalence);writeJson(correctedFile,corrected);expected.correctedEquivalence=shaFile(correctedFile);
  const correctionCell={schemaVersion:1,candidateId:runner.CANDIDATE,identity,cell:{kind:'midi41',pitch:41,velocity:null,velocityNormalized:.25,stage3cMask:0},
    metrics:metrics(),comparison:{pass:true,maxMetricDifference:0}};
  const correctionCellFile=path.join(root,runner.EXPECTED_PATHS.correctionLedger.replace('ledger.json','cells/midi-041-normalized-025-mask-0.json'));
  writeJson(correctionCellFile,correctionCell);expected.correctionCell=shaFile(correctionCellFile);
  corrected.identitySha256=shaBytes(JSON.stringify(identity));corrected.correctionCellSha256=expected.correctionCell;
  writeJson(correctedFile,corrected);expected.correctedEquivalence=shaFile(correctedFile);
  const correctionLedgerFile=path.join(root,rel.correctionLedger),correctionCellRel=path.relative(path.dirname(correctionLedgerFile),correctionCellFile);
  const idHash=shaBytes(JSON.stringify(identity));
  writeJson(correctionLedgerFile,{schemaVersion:1,phase:'correction',candidateId:runner.CANDIDATE,identity,identitySha256:idHash,authorizedRenderCount:1,
    cells:{'midi-041-normalized-025-mask-0':{state:'COMPLETE',path:correctionCellRel,sha256:expected.correctionCell}},
    accounting:{newRenderCalls:1,productionCandidateDelta:0,stage4Renders:0}});
  expected.correctionLedger=shaFile(correctionLedgerFile);
  const continuationRoot=path.join(root,runner.EXPECTED_PATHS.continuationLedger.slice(0,runner.EXPECTED_PATHS.continuationLedger.lastIndexOf('/')));
  const ledger={schemaVersion:1,phase:'continuation',candidateId:runner.CANDIDATE,identity,identitySha256:idHash,correctionIdentitySha256:idHash,
    correctedEquivalenceSha256:expected.correctedEquivalence,authorizedRenderCount:286,cells:{},aggregates:{},
    accounting:{newRenderCalls:286,productionCandidateDelta:0,stage4Renders:0}};
  const rows=continuation.splitCells();
  for(const cell of rows){
    const file=continuation.continuationCellPath(cell,root),row={schemaVersion:1,candidateId:runner.CANDIDATE,identity,cell,
      correctionEquivalenceSha256:expected.correctedEquivalence,metrics:metrics(cell.pitch+(cell.velocity||cell.velocityNormalized*10))};
    row.metrics.stage3cVariantMask=cell.stage3cMask;writeJson(file,row);
    ledger.cells[continuation.original?.keyOf?.(cell)||require('./run-stage3c-impedance-split-diagnostic.cjs').keyOf(cell)]={
      identity:cell,state:'COMPLETE',path:path.relative(continuationRoot,file),sha256:shaFile(file)};
  }
  const byGroup=new Map();for(const row of rows){const cell=row,key=`${cell.stage3cMask}:${cell.kind}:${cell.pitch}`;if(!byGroup.has(key))byGroup.set(key,[]);byGroup.get(key).push(cell);}
  for(const [key,group] of byGroup){const [mask,kind,pitch]=key.split(':').map((v,i)=>i===0||i===2?Number(v):v);
    const file=continuation.continuationAggregatePath(mask,kind,pitch,root);
    const aggregate={schemaVersion:1,mask,kind,pitch,cellCount:group.length,identitySha256:idHash,correctionEquivalenceSha256:expected.correctedEquivalence,
      cells:group.map(cell=>({cell,sha256:shaFile(continuation.continuationCellPath(cell,root))}))};
    writeJson(file,aggregate);ledger.aggregates[key]={path:path.relative(continuationRoot,file),sha256:shaFile(file),cellCount:group.length};
  }
  const continuationFile=path.join(root,rel.continuationLedger);writeJson(continuationFile,ledger);expected.continuationLedger=shaFile(continuationFile);
  return {root,expected,baseline,supplement,stage3bAnalysis,files:{correctionCellFile,continuationFile}};
}
const stubbed=fixture=>({continuation,stage3b:{loadStage3ABaseline:()=>({baseline:fixture.baseline}),
  assertAuthoritativeProductionIdentity:()=>({}),assertStage3AEvidenceIdentity:()=>({identity:{stage3aLedgerSha256:fixture.expected.stage3aLedger,
    stage3aFinalSha256:fixture.expected.stage3aFinal,stage3aSupplementSha256:fixture.expected.stage3aSupplement}})}});
function syntheticAuthoritativeResult(ready,fixture){
  return {...ready.attribution,schemaVersion:1,decision:'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE',candidateId:runner.CANDIDATE,
    equivalenceDecision:fixture.expected.correctedDecision,correctedEquivalenceSha256:fixture.expected.correctedEquivalence,
    correctionLedgerSha256:fixture.expected.correctionLedger,continuationLedgerSha256:fixture.expected.continuationLedger,
    ledgerSha256:fixture.expected.continuationLedger,continuationAggregateCount:24,stage3bAggregateCount:39,
    executionSourceRevision:fixture.expected.executionSourceRevision,
    finalizerSourceRevision:runner.AUTHORITATIVE_RESULT.finalizerSourceRevision,
    finalizerSha256:runner.AUTHORITATIVE_RESULT.finalizerSha256,attributionCoreSha256:runner.AUTHORITATIVE_RESULT.attributionCoreSha256,
    physicalCandidateDelta:0,productionCandidateDelta:0,stage4Renders:0,finalizedAt:'2026-10-04T15:41:00.790Z'};
}

assert.throws(()=>runner.modes([]),/explicit mode required/);
assert.throws(()=>runner.modes(['--execute']),/explicit mode required/);
for(const mode of ['--dry-run','--finalize'])assert.equal(runner.modes([mode]),mode);

const fixture=makeSyntheticRoot();
const ready=runner.validateContinuation(fixture.root,fixture.expected,stubbed(fixture));
assert.equal(ready.rows.length,286);assert.equal(ready.aggregateCount,24);
assert.equal(ready.attribution.decision,'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE');
assert.equal(fs.existsSync(path.join(fixture.root,'.agent-state/issues/7/stage3c/split')),false);
assert.equal(fs.existsSync(runner.resultPath(fixture.root)),false);
const dry=runner.dryRun(fixture.root,{expected:fixture.expected,modules:stubbed(fixture)});
assert.equal(dry.renders,0);assert.equal(dry.acousticRenders,0);assert.equal(dry.continuationCells,286);assert.equal(dry.continuationAggregates,24);
assert.equal(fs.existsSync(runner.resultPath(fixture.root)),false);
assert.throws(()=>runner.finalize(fixture.root,{expected:fixture.expected,modules:stubbed(fixture)}),/BLOCKED_STAGE3C_FINALIZER_EVIDENCE/,
  'a missing finalized result must block rather than be recreated');

const syntheticResult=syntheticAuthoritativeResult(ready,fixture),syntheticResultFile=path.join(fixture.root,'synthetic-split-attribution.json');
writeJson(syntheticResultFile,syntheticResult);
const syntheticExpected={...runner.AUTHORITATIVE_RESULT,sha256:shaFile(syntheticResultFile),
  correctedEquivalenceSha256:fixture.expected.correctedEquivalence,correctionLedgerSha256:fixture.expected.correctionLedger,
  continuationLedgerSha256:fixture.expected.continuationLedger,ledgerSha256:fixture.expected.continuationLedger,
  executionSourceRevision:fixture.expected.executionSourceRevision};
const validatedSynthetic=runner.validateAuthoritativeResult(syntheticResultFile,ready,syntheticExpected);
assert.equal(validatedSynthetic.finalizerSourceRevision,'d88ee6f0c061548409f8a19d452c5276560999de');
const tamperedResultFile=path.join(fixture.root,'tampered-split-attribution.json');
fs.copyFileSync(syntheticResultFile,tamperedResultFile);fs.appendFileSync(tamperedResultFile,' ');
assert.throws(()=>runner.validateAuthoritativeResult(tamperedResultFile,ready,syntheticExpected),/BLOCKED_STAGE3C_FINALIZER_EVIDENCE/);
assert.throws(()=>runner.validateAuthoritativeResult(path.join(fixture.root,'missing-split-attribution.json'),ready,syntheticExpected),
  /BLOCKED_STAGE3C_FINALIZER_EVIDENCE/);
for(const key of ['finalizerSourceRevision','finalizerSha256','attributionCoreSha256']){
  const wrongCreator={...syntheticResult,[key]:key==='finalizerSourceRevision'?'f'.repeat(40):'f'.repeat(64)};
  const wrongCreatorFile=path.join(fixture.root,`wrong-creator-${key}.json`);writeJson(wrongCreatorFile,wrongCreator);
  assert.throws(()=>runner.validateAuthoritativeResult(wrongCreatorFile,ready,{...syntheticExpected,sha256:shaFile(wrongCreatorFile)}),
    /BLOCKED_STAGE3C_FINALIZER_EVIDENCE/,`historical ${key} must remain fixed even with matching test file SHA`);
}

const corrupt=makeSyntheticRoot();
const sampleCell=continuation.splitCells()[0],sampleFile=continuation.continuationCellPath(sampleCell,corrupt.root);fs.unlinkSync(sampleFile);
assert.throws(()=>runner.validateContinuation(corrupt.root,corrupt.expected,stubbed(corrupt)),/BLOCKED_STAGE3C_CONTINUATION_EVIDENCE/);
assert.equal(fs.existsSync(path.join(corrupt.root,'.agent-state/issues/7/stage3c/split')),false);

const changedRunner=makeSyntheticRoot();
fs.appendFileSync(path.join(changedRunner.root,runner.EXPECTED_PATHS.continuationRunner),'changed');
assert.throws(()=>runner.validateContinuation(changedRunner.root,changedRunner.expected,stubbed(changedRunner)),/BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY/);
const changedHistorical=makeSyntheticRoot();
fs.appendFileSync(path.join(changedHistorical.root,runner.EXPECTED_PATHS.historicalRunner),'changed');
assert.throws(()=>runner.validateContinuation(changedHistorical.root,changedHistorical.expected,stubbed(changedHistorical)),/BLOCKED_STAGE3C_FINALIZER_BASELINE_IDENTITY/);

const changedCorrectionBinding=makeSyntheticRoot();
const changedLedgerPath=path.join(changedCorrectionBinding.root,runner.EXPECTED_PATHS.continuationLedger);
const changedLedger=JSON.parse(fs.readFileSync(changedLedgerPath,'utf8'));changedLedger.correctedEquivalenceSha256='f'.repeat(64);
writeJson(changedLedgerPath,changedLedger);changedCorrectionBinding.expected.continuationLedger=shaFile(changedLedgerPath);
assert.throws(()=>runner.validateContinuation(changedCorrectionBinding.root,changedCorrectionBinding.expected,stubbed(changedCorrectionBinding)),/BLOCKED_STAGE3C_CONTINUATION_EVIDENCE/);

const missingAggregate=makeSyntheticRoot();
const aggregatePath=continuation.continuationAggregatePath(1,'dynamic',36,missingAggregate.root);fs.unlinkSync(aggregatePath);
assert.throws(()=>runner.validateContinuation(missingAggregate.root,missingAggregate.expected,stubbed(missingAggregate)),/BLOCKED_STAGE3C_CONTINUATION_EVIDENCE/);

const changedAggregate=makeSyntheticRoot();
const changedAggregatePath=continuation.continuationAggregatePath(1,'dynamic',36,changedAggregate.root);
fs.appendFileSync(changedAggregatePath,' ');
assert.throws(()=>runner.validateContinuation(changedAggregate.root,changedAggregate.expected,stubbed(changedAggregate)),/BLOCKED_STAGE3C_CONTINUATION_EVIDENCE/);

const wrongCount=makeSyntheticRoot();
const wrongCountLedgerPath=path.join(wrongCount.root,runner.EXPECTED_PATHS.continuationLedger);
const wrongCountLedger=JSON.parse(fs.readFileSync(wrongCountLedgerPath,'utf8'));
delete wrongCountLedger.aggregates[Object.keys(wrongCountLedger.aggregates)[0]];
writeJson(wrongCountLedgerPath,wrongCountLedger);wrongCount.expected.continuationLedger=shaFile(wrongCountLedgerPath);
assert.throws(()=>runner.validateContinuation(wrongCount.root,wrongCount.expected,stubbed(wrongCount)),/BLOCKED_STAGE3C_CONTINUATION_EVIDENCE/);

const pendingCell=makeSyntheticRoot();
const pendingLedgerPath=path.join(pendingCell.root,runner.EXPECTED_PATHS.continuationLedger);
const pendingLedger=JSON.parse(fs.readFileSync(pendingLedgerPath,'utf8'));
pendingLedger.cells[Object.keys(pendingLedger.cells)[0]].state='PENDING';
writeJson(pendingLedgerPath,pendingLedger);pendingCell.expected.continuationLedger=shaFile(pendingLedgerPath);
assert.throws(()=>runner.validateContinuation(pendingCell.root,pendingCell.expected,stubbed(pendingCell)),/BLOCKED_STAGE3C_CONTINUATION_EVIDENCE/);

const nonfinite=makeSyntheticRoot();
const nonfiniteLedgerPath=path.join(nonfinite.root,runner.EXPECTED_PATHS.continuationLedger);
const nonfiniteLedger=JSON.parse(fs.readFileSync(nonfiniteLedgerPath,'utf8'));
const nonfiniteCell=continuation.splitCells()[0],nonfiniteCellPath=continuation.continuationCellPath(nonfiniteCell,nonfinite.root);
const badRow=JSON.parse(fs.readFileSync(nonfiniteCellPath,'utf8'));badRow.metrics.finite=false;writeJson(nonfiniteCellPath,badRow);
const nonfiniteKey=require('./run-stage3c-impedance-split-diagnostic.cjs').keyOf(nonfiniteCell);
nonfiniteLedger.cells[nonfiniteKey].sha256=shaFile(nonfiniteCellPath);
const aggregateKey=`${nonfiniteCell.stage3cMask}:${nonfiniteCell.kind}:${nonfiniteCell.pitch}`;
const aggregateFile=continuation.continuationAggregatePath(nonfiniteCell.stage3cMask,nonfiniteCell.kind,nonfiniteCell.pitch,nonfinite.root);
const aggregate=JSON.parse(fs.readFileSync(aggregateFile,'utf8'));
aggregate.cells.find(row=>row.cell.velocity===nonfiniteCell.velocity&&row.cell.pitch===nonfiniteCell.pitch).sha256=shaFile(nonfiniteCellPath);
writeJson(aggregateFile,aggregate);nonfiniteLedger.aggregates[aggregateKey].sha256=shaFile(aggregateFile);
writeJson(nonfiniteLedgerPath,nonfiniteLedger);nonfinite.expected.continuationLedger=shaFile(nonfiniteLedgerPath);
assert.throws(()=>runner.validateContinuation(nonfinite.root,nonfinite.expected,stubbed(nonfinite)),/BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC/);

const root=runner.ROOT,realResult=runner.resultPath(root);
assert.equal(fs.existsSync(realResult),true,'authoritative result must already exist for replay');
assert.equal(shaFile(realResult),runner.AUTHORITATIVE_RESULT.sha256);
const integration=runner.validateContinuation(root);
assert.equal(integration.rows.length,286);assert.equal(integration.aggregateCount,24);
assert.equal(integration.attribution.decision,'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE');
assert.equal(integration.continuationLedgerSha256,runner.EXPECTED.continuationLedger);
assert.equal(fs.existsSync(path.join(root,'.agent-state/issues/7/stage3c/split')),false);
const beforeReplay=fs.readFileSync(realResult),beforeReplayMtime=fs.statSync(realResult).mtimeMs;
const dryReal=runner.dryRun(root);assert.equal(dryReal.renders,0);assert.equal(dryReal.acousticRenders,0);
const replay=runner.finalize(root,{currentRevision:()=>{throw new Error('currentRevision must not be read on authoritative replay');}});
assert.equal(replay.decision,'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE');assert.equal(replay.builds,0);assert.equal(replay.renders,0);assert.equal(replay.acousticRenders,0);
assert.deepEqual(fs.readFileSync(realResult),beforeReplay);assert.equal(shaFile(realResult),runner.AUTHORITATIVE_RESULT.sha256);
assert.equal(fs.statSync(realResult).mtimeMs,beforeReplayMtime);
const secondReplay=runner.finalize(root,{currentRevision:()=>{throw new Error('currentRevision must not be read on repeated replay');}});
assert.equal(secondReplay.decision,'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE');assert.deepEqual(fs.readFileSync(realResult),beforeReplay);
assert.equal(shaFile(realResult),runner.AUTHORITATIVE_RESULT.sha256);assert.equal(fs.statSync(realResult).mtimeMs,beforeReplayMtime);
for(const temporaryRoot of tempRoots)fs.rmSync(temporaryRoot,{recursive:true,force:true});
console.log(JSON.stringify({pass:true,syntheticCells:ready.rows.length,syntheticAggregates:ready.aggregateCount,
  integrationCells:integration.rows.length,integrationAggregates:integration.aggregateCount,preStatusReplay:true,repeatReplay:true,
  currentRevisionCalls:0,resultWrites:0,resultSha256:shaFile(realResult),resultMtimeUnchanged:true,builds:0,renders:0,acousticRenders:0}));
