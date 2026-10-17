#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const capture=require('./capture-supersynth-matrix.cjs');
const stage3b=require('./run-stage3b-contact-attribution.cjs');
const original=require('./run-stage3c-impedance-split-diagnostic.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const BASE=path.join(ROOT,'.agent-state/issues/7/stage3c');
const CANDIDATE=original.CANDIDATE;
const TOL=1e-6;
const EXPECTED={
  originalLedger:'348409a1fe0ded9fd9f60d5cd91dcfd80990d4df1d8635578e079c86b7ca5055',
  originalEvaluation:'4141debf0673e8b36cd6c34363e0a8f0e91540e6cb228fef9e00dd3714d3fcf9',
  stage3cWasm:'387c12fa16f684435f904a9c18c063099141332b53b28cd5cbd35bca15482235',
  stage3bLedger:'3c688ce49877dd7a94a2920c02bc9ddb7145709d06b1e7a04a7aecda4b18fbaf',
  stage3bAnalysis:'220c4904fc858ee671002ce84de85a75abd2271f78a53f433dbf5bd4021675cb',
  stage3aLedger:'e43d6d1b88f57766d0c48e413801916b313580cec83d629b54835be0f23060e9',
  stage3aFinal:'e953ba33a363f378a006aafcbe4066cb1b05d69ac42ca1f401cd68d7e7261cd4',
  stage3aSupplement:'91b6b4df895a2a044135752156b88d1ab04806f02ebd338a8518f703e29c1713',
  production:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  stage3aWasm:'59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3',
  stage3bWasm:'2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9',
  config:'792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d',
  profile:'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66',
  presets:'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431',
  fixture:'5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7',
  preflight:'f69e8adf900db451bc91c48928f914dc8b7da28b732e533f1742d5b49d9ce1dc',
  mask0:'fc54305c158e706ca5a28eeacdf9390c029a932283d94d047c9a443a28eb702a'
};
const CORRECTION_CELL={kind:'midi41',pitch:41,velocity:null,velocityNormalized:.25,stage3cMask:0};
const CORRECTION_KEY='midi-041-normalized-025-mask-0';
const MODES=new Set(['--dry-run','--correct-equivalence','--execute','--finalize']);

function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function textSha(value){return crypto.createHash('sha256').update(value).digest('hex');}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function writeAtomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const t=`${file}.${process.pid}.tmp`;fs.writeFileSync(t,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});fs.renameSync(t,file);}
function modes(argv){if(argv.length!==1||!MODES.has(argv[0]))throw new Error('explicit mode required: --dry-run, --correct-equivalence, --execute, or --finalize');return argv[0];}
function correctionCells(){return [{...CORRECTION_CELL}];}
function splitCells(){return original.expectedSplitCells();}
function correctionKey(){return CORRECTION_KEY;}
function correctionCellPath(root=ROOT){return path.join(root,'.agent-state/issues/7/stage3c/correction/cells/midi-041-normalized-025-mask-0.json');}
function correctedResultPath(root=ROOT){return path.join(root,'.agent-state/issues/7/stage3c/correction/equivalence-corrected.json');}
function continuationCellPath(cell,root=ROOT){return path.join(root,'.agent-state/issues/7/stage3c/continuation/cells',`mask-${cell.stage3cMask}`,original.fileName(cell));}
function continuationAggregatePath(mask,kind,pitch,root=ROOT){return path.join(root,'.agent-state/issues/7/stage3c/continuation/aggregates',`mask-${mask}`,`${kind}-midi-${String(pitch).padStart(3,'0')}.json`);}
function stateCounts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(s=>[s,Object.values(ledger.cells||{}).filter(x=>x.state===s).length]));}
function shaExpected(file,expected,label){if(!fs.existsSync(file)||sha256(file)!==expected)throw new Error(`BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: ${label} SHA mismatch or missing`);}

function historical(root=ROOT){
  const p=path.join(root,'.agent-state/issues/7/stage3c');
  const ledgerFile=path.join(p,'equivalence/ledger.json'),resultFile=path.join(p,'equivalence.json');
  shaExpected(ledgerFile,EXPECTED.originalLedger,'original equivalence ledger');
  shaExpected(resultFile,EXPECTED.originalEvaluation,'original blocked evaluation');
  const ledger=readJson(ledgerFile),result=readJson(resultFile),cells=original.expectedEquivalenceCells();
  const c=stateCounts(ledger),rows=result.rows||[];
  if(!same(c,{PENDING:0,IN_PROGRESS:0,COMPLETE:20})||ledger.authorizedRenderCount!==20
      ||result.decision!=='BLOCKED_STAGE3C_EQUIVALENCE'||result.completedCellCount!==20
      ||rows.length!==20||rows.filter(r=>r.result==='PASS').length!==19||rows.filter(r=>r.result==='FAIL').length!==1)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: original evidence counts/decision differ');
  const failed=rows.filter(r=>r.result==='FAIL')[0];
  if(!failed||failed.cell?.pitch!==41||failed.cell?.velocityNormalized!==.25||failed.cell?.stage3cMask!==0
      ||!String(failed.error||'').includes('velocityDerivativeWindowMs'))
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical failure is not the contracted window mismatch');
  if(rows.filter(r=>r.cell?.stage3cMask===3&&r.result==='PASS').length!==10
      ||rows.filter(r=>r.cell?.stage3cMask===0&&r.result==='PASS').length!==9
      ||rows.filter(r=>r.result==='PASS').some(r=>r.comparison?.maxMetricDifference>TOL))
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical passing rows differ');
  const byKey=new Map(cells.map(cell=>[original.keyOf(cell),cell]));
  const passedKeys=new Set(rows.filter(r=>r.result==='PASS').map(r=>original.keyOf(r.cell)));
  const rowKeys=rows.map(r=>original.keyOf(r.cell));
  if(passedKeys.size!==19||[...passedKeys].some(key=>!byKey.has(key))||new Set(rowKeys).size!==20||rowKeys.some(key=>!byKey.has(key)))
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical identities differ or duplicate');
  const failedFile=path.join(p,'equivalence',ledger.cells[original.keyOf(failed.cell)].path),failedPersisted=readJson(failedFile),supplement=supplementRow(root);
  if(!same(failedPersisted.metrics.velocityDerivativeWindowMs,[0,160])||!same(supplement.metrics.velocityDerivativeWindowMs,[30,180]))
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical derivative-window evidence differs');
  const correctedMetrics={...failedPersisted.metrics,velocityDerivative:supplement.metrics.velocityDerivative,
    velocityDerivativeWindowMs:supplement.metrics.velocityDerivativeWindowMs};
  if(!original.compareMetrics(correctedMetrics,supplement.metrics).pass)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical failed row has differences beyond the derivative window');
  for(const cell of cells){
    const key=original.keyOf(cell),entry=ledger.cells[key],file=path.join(p,'equivalence',entry?.path||path.join('cells',original.fileName(cell)));
    if(!entry||entry.state!=='COMPLETE'||!fs.existsSync(file)||sha256(file)!==entry.sha256)
      throw new Error(`BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical cell evidence mismatch ${key}`);
    const persisted=readJson(file);
    if(!same(persisted.identity,ledger.identity)||!same(persisted.cell,cell)||!persisted.metrics)
      throw new Error(`BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical cell binding mismatch ${key}`);
  }
  return {ledger,result,ledgerFile,resultFile,rows,cells,failed,passedRows:rows.filter(r=>r.result==='PASS')};
}

function historicalBuildIdentity(root=ROOT){
  const file=path.join(root,'.agent-state/issues/7/stage3c/build-identity.json');
  if(!fs.existsSync(file))throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical build identity missing');
  const id=readJson(file),f=(rel)=>sha256(path.join(root,rel));
  const wasm=path.join(root,'build/wasm-stage3c/plugins/dsp/super-synth/plugin.wasm');
  const checks=[
    [id.stage3cDiagnosticWasmSha256,EXPECTED.stage3cWasm,'recorded Stage3C WASM'],
    [id.pluginSourceSha256,f('wasm/plugins/dsp/super-synth/src/plugin.c'),'plugin.c'],
    [id.cmakeSourceSha256,f('wasm/cmake/wasm_plugin.cmake'),'wasm_plugin.cmake'],
    [id.captureEvaluatorSha256,f('wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs'),'capture evaluator'],
    [id.runnerSha256,f('wasm/plugins/dsp/super-synth/test/tools/run-stage3c-impedance-split-diagnostic.cjs'),'historical runner'],
    [id.productionWasmSha256,EXPECTED.production,'production WASM'],
    [id.stage3aDiagnosticWasmSha256,EXPECTED.stage3aWasm,'Stage3A WASM'],
    [id.stage3bDiagnosticWasmSha256,EXPECTED.stage3bWasm,'Stage3B WASM'],
    [id.configSha256,EXPECTED.config,'config'],[id.profileSha256,EXPECTED.profile,'profile'],
    [id.presetsSha256,EXPECTED.presets,'presets'],[id.referenceFixtureSha256,EXPECTED.fixture,'reference fixture']
  ];
  if(checks.some(([a,b])=>a!==b)||!fs.existsSync(wasm)||sha256(wasm)!==EXPECTED.stage3cWasm)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: historical build/source identity mismatch');
  const files={
    stage3bLedger:path.join(root,'.agent-state/issues/7/stage3b/ledger.json'),
    stage3bAnalysis:path.join(root,'.agent-state/issues/7/stage3b/factorial-analysis.json'),
    stage3aLedger:path.join(root,'.agent-state/issues/7/stage3a/recovery/recovery-ledger.json'),
    stage3aFinal:path.join(root,'.agent-state/issues/7/stage3a/velocity-diagnostic.json'),
    stage3aSupplement:path.join(root,'.agent-state/issues/7/stage3a/supplemental-3-render-result.json'),
    preflight:path.join(root,'.agent-state/issues/7/stage3b/preflight-provenance.json'),
    mask0:path.join(root,'.agent-state/issues/7/stage3b/mask0-equivalence.json')
  };
  const wanted={stage3bLedger:EXPECTED.stage3bLedger,stage3bAnalysis:EXPECTED.stage3bAnalysis,stage3aLedger:EXPECTED.stage3aLedger,
    stage3aFinal:EXPECTED.stage3aFinal,stage3aSupplement:EXPECTED.stage3aSupplement,preflight:EXPECTED.preflight,mask0:EXPECTED.mask0};
  for(const [key,expected] of Object.entries(wanted))shaExpected(files[key],expected,key);
  const current=stage3b.assertAuthoritativeProductionIdentity(root);
  if(current.hashes.productionWasmSha256!==EXPECTED.production||current.hashes.configSha256!==EXPECTED.config
      ||current.hashes.profileSha256!==EXPECTED.profile||current.hashes.presetsSha256!==EXPECTED.presets
      ||current.hashes.referenceFixtureSha256!==EXPECTED.fixture)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: current authoritative production/config/profile/preset/reference identity changed');
  const acceptedStage3a=stage3b.assertStage3AEvidenceIdentity(root);
  if(acceptedStage3a.identity.stage3aLedgerSha256!==EXPECTED.stage3aLedger
      ||acceptedStage3a.identity.stage3aFinalSha256!==EXPECTED.stage3aFinal
      ||acceptedStage3a.identity.stage3aSupplementSha256!==EXPECTED.stage3aSupplement)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: current accepted Stage3A identity changed');
  const provenance=readJson(files.preflight);
  if(provenance.classification!=='SUFFICIENT_METADATA_PROVENANCE'||provenance.preflightReady!==true
      ||provenance.preflightResult?.decision!=='STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE')
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: accepted provenance classification/result changed');
  if(id.stage3bEvidenceSha256?.ledger!==EXPECTED.stage3bLedger||id.stage3bEvidenceSha256?.analysis!==EXPECTED.stage3bAnalysis
      ||id.stage3aEvidenceSha256?.ledger!==EXPECTED.stage3aLedger||id.stage3aEvidenceSha256?.final!==EXPECTED.stage3aFinal
      ||id.stage3aEvidenceSha256?.supplement!==EXPECTED.stage3aSupplement)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: accepted Stage3A/Stage3B evidence binding mismatch');
  if(!id.productionSimd||id.candidateId!==CANDIDATE||id.aggregateCount!==39)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: candidate/SIMD/aggregate identity mismatch');
  return {file,id,sha256:sha256(file),files,hashes:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,sha256(v)]))};
}

function currentRevision(root=ROOT){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function continuationIdentity(root=ROOT){
  const hist=historical(root),build=historicalBuildIdentity(root),runner=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3c-equivalence-correction-and-split.cjs');
  if(!fs.existsSync(runner))throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: continuation runner missing');
  return {schemaVersion:1,candidateId:CANDIDATE,historicalBuildIdentitySha256:build.sha256,
    stage3cDiagnosticWasmSha256:EXPECTED.stage3cWasm,originalEquivalenceLedgerSha256:sha256(hist.ledgerFile),
    originalBlockedEvaluationSha256:sha256(hist.resultFile),historicalFailedCellSha256:sha256(path.join(root,'.agent-state/issues/7/stage3c/equivalence/cells',original.fileName(hist.failed.cell))),
    stage3aSupplementSha256:build.hashes.stage3aSupplement,
    stage3bLedgerSha256:build.hashes.stage3bLedger,stage3bFactorialAnalysisSha256:build.hashes.stage3bAnalysis,
    productionWasmSha256:EXPECTED.production,configSha256:EXPECTED.config,profileSha256:EXPECTED.profile,
    presetsSha256:EXPECTED.presets,referenceFixtureSha256:EXPECTED.fixture,captureEvaluatorSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs')),
    historicalRunnerSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3c-impedance-split-diagnostic.cjs')),
    continuationRunnerSha256:sha256(runner),executionSourceRevision:currentRevision(root),preflightProvenanceSha256:build.hashes.preflight};
}
function assertIdentity(expected,root=ROOT){if(!same(expected,continuationIdentity(root)))throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: continuation identity changed');return expected;}
function correctionLedger(identity){return {schemaVersion:1,phase:'correction',candidateId:CANDIDATE,identity,identitySha256:textSha(JSON.stringify(identity)),
  authorizedRenderCount:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),cells:{[CORRECTION_KEY]:{identity:CORRECTION_CELL,state:'PENDING',path:null,sha256:null}},
  accounting:{newRenderCalls:0,productionCandidateDelta:0,stage4Renders:0}};}
function continuationLedger(identity,correctionSha){const cells=splitCells();return {schemaVersion:1,phase:'continuation',candidateId:CANDIDATE,identity,identitySha256:textSha(JSON.stringify(identity)),
  correctionIdentitySha256:textSha(JSON.stringify(identity)),correctedEquivalenceSha256:correctionSha,authorizedRenderCount:286,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
  cells:Object.fromEntries(cells.map(c=>[original.keyOf(c),{identity:c,state:'PENDING',path:null,sha256:null}])),aggregates:{},
  accounting:{newRenderCalls:0,productionCandidateDelta:0,stage4Renders:0}};}
function validateLedger(ledger,expected,phase,budget){
  if(ledger.phase!==phase||ledger.identitySha256!==textSha(JSON.stringify(expected))||!same(ledger.identity,expected)||ledger.authorizedRenderCount!==budget)
    throw new Error(`BLOCKED_STAGE3C_${phase==='correction'?'CORRECTION':'CONTINUATION'}_EVIDENCE: ledger identity/authorization mismatch`);
  const c=stateCounts(ledger),keys=Object.keys(ledger.cells||{}),wanted=phase==='correction'?[CORRECTION_KEY]:splitCells().map(original.keyOf);
  if(keys.length!==budget||wanted.some(k=>!ledger.cells[k])||keys.some(k=>!wanted.includes(k)))throw new Error(`BLOCKED_STAGE3C_${phase==='correction'?'CORRECTION':'CONTINUATION'}_EVIDENCE: ledger cell set mismatch`);
  if(c.IN_PROGRESS)throw new Error(`BLOCKED_STAGE3C_${phase==='correction'?'CORRECTION':'CONTINUATION'}_EVIDENCE: ambiguous IN_PROGRESS ${Object.entries(ledger.cells).find(([,v])=>v.state==='IN_PROGRESS')?.[0]}`);
  if(ledger.accounting?.newRenderCalls!==c.COMPLETE||c.COMPLETE>budget)throw new Error(`BLOCKED_STAGE3C_${phase==='correction'?'CORRECTION':'CONTINUATION'}_EVIDENCE: render accounting mismatch`);
  if(ledger.accounting?.productionCandidateDelta!==0||ledger.accounting?.stage4Renders!==0)
    throw new Error(`BLOCKED_STAGE3C_${phase==='correction'?'CORRECTION':'CONTINUATION'}_EVIDENCE: forbidden candidate/Stage4 accounting`);
  return c;
}
function supplementRow(root=ROOT){const doc=readJson(path.join(root,'.agent-state/issues/7/stage3a/supplemental-3-render-result.json'));const row=doc.rows.find(r=>r.pitch===41&&Math.abs(r.velocityNormalized-.25)<1e-12);if(!row)throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: Stage3A MIDI41 supplement row missing');return row;}
function compareCorrection(metrics,reference){
  if(metrics.stage3cVariantMask!==0||metrics.stage2mFactorMask!==3||!same(metrics.velocityDerivativeWindowMs,[30,180]))throw new Error('BLOCKED_STAGE3C_CORRECTION_EVIDENCE: mask/window capture mismatch');
  const result=original.compareMetrics(metrics,reference.metrics);
  if(metrics.finite!==true)throw new Error('BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC: correction render is non-finite');
  return result;
}
function readCorrectionCell(root=ROOT){const file=correctionCellPath(root);if(!fs.existsSync(file))throw new Error('BLOCKED_STAGE3C_CORRECTION_EVIDENCE: correction cell missing');return {file,row:readJson(file),sha256:sha256(file)};}
function validateCorrectionComplete(ledger,identity,root=ROOT){
  const c=validateLedger(ledger,identity,'correction',1);if(!same(c,{PENDING:0,IN_PROGRESS:0,COMPLETE:1}))throw new Error('BLOCKED_STAGE3C_CORRECTION_EVIDENCE: correction incomplete');
  const {file,row,sha256:hash}=readCorrectionCell(root),entry=ledger.cells[CORRECTION_KEY];
  if(entry.path!==path.relative(path.dirname(path.join(root,'.agent-state/issues/7/stage3c/correction/ledger.json')),file)||entry.sha256!==hash||!same(row.identity,identity)||!same(row.cell,CORRECTION_CELL))throw new Error('BLOCKED_STAGE3C_CORRECTION_EVIDENCE: correction cell binding/hash mismatch');
  const comparison=compareCorrection(row.metrics,supplementRow(root));if(!comparison.pass)throw new Error('BLOCKED_STAGE3C_CORRECTION_EQUIVALENCE: correction comparison exceeds 1e-6');
  return {file,row,sha256:hash,comparison};
}
function correctedResult(hist,correction,identity,identitySha){
  const rows=hist.passedRows.map(row=>({cell:row.cell,result:'PASS',comparison:row.comparison,source:'historical',sourceSha256:EXPECTED.originalEvaluation}));
  rows.push({cell:CORRECTION_CELL,result:'PASS',comparison:correction.comparison,source:'correction',sourceSha256:correction.sha256});
  const max=Math.max(...rows.map(r=>r.comparison.maxMetricDifference));
  return {schemaVersion:1,decision:'STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE',candidateId:CANDIDATE,
    historicalAuthorizedRenderCount:20,historicalActualRenderCount:20,correctionAuthorizedRenderCount:1,correctionActualRenderCount:1,
    effectiveEquivalenceCellCount:20,historicalPassCount:19,correctionPassCount:1,equivalenceTolerance:TOL,maxMetricDifference:max,rows,
    historicalLedgerSha256:EXPECTED.originalLedger,historicalBlockedEvaluationSha256:EXPECTED.originalEvaluation,
    historicalFailedCellSha256:identity.historicalFailedCellSha256,correctionCellSha256:correction.sha256,
    supersededHistoricalFailure:{pitch:41,velocityNormalized:.25,stage3cMask:0,reason:'velocityDerivativeWindowMs mismatch',cellSha256:identity.historicalFailedCellSha256},
    stage3aSupplementSha256:identity.stage3aSupplementSha256,stage3cWasmSha256:EXPECTED.stage3cWasm,continuationRunnerSha256:identity.continuationRunnerSha256,
    identitySha256:identitySha,productionCandidateDelta:0,stage4Renders:0,correctedAt:new Date().toISOString()};
}
function loadCorrection(root=ROOT){
  const identity=continuationIdentity(root),hist=historical(root),idFile=path.join(root,'.agent-state/issues/7/stage3c/correction/identity.json');
  if(!fs.existsSync(idFile))throw new Error('BLOCKED_STAGE3C_CORRECTION_EVIDENCE: correction identity missing');
  const persisted=readJson(idFile);if(!same(persisted,identity))throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: persisted correction identity changed');
  const ledger=readJson(path.join(root,'.agent-state/issues/7/stage3c/correction/ledger.json'));
  const complete=validateCorrectionComplete(ledger,identity,root);
  const correctedFile=correctedResultPath(root);if(!fs.existsSync(correctedFile))throw new Error('BLOCKED_STAGE3C_CORRECTION_EVIDENCE: corrected result missing');
  const result=readJson(correctedFile);
  if(result.decision!=='STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE'||result.maxMetricDifference>TOL||result.effectiveEquivalenceCellCount!==20
      ||result.identitySha256!==textSha(JSON.stringify(identity))||result.historicalPassCount!==19||result.correctionPassCount!==1
      ||result.correctionCellSha256!==complete.sha256||result.historicalFailedCellSha256!==identity.historicalFailedCellSha256
      ||result.historicalLedgerSha256!==EXPECTED.originalLedger||result.historicalBlockedEvaluationSha256!==EXPECTED.originalEvaluation)
    throw new Error('BLOCKED_STAGE3C_CORRECTION_EQUIVALENCE: corrected result binding/decision mismatch');
  return {identity,hist,ledger,complete,result,resultSha256:sha256(correctedFile)};
}
function runCapture(cell,root=ROOT,options){
  const renderOptions={includeSoundboardDiagnostics:true,includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,stage2mFactorMask:3,stage3cVariantMask:cell.stage3cMask,...options};
  return cell.velocity===null?capture.renderNormalized(cell.pitch,cell.velocityNormalized,{},renderOptions):capture.render(cell.pitch,cell.velocity,{},renderOptions);
}
function executeCorrection(root=ROOT,progress=()=>{}){
  const identity=continuationIdentity(root),hist=historical(root),dir=path.join(root,'.agent-state/issues/7/stage3c/correction'),idFile=path.join(dir,'identity.json');
  const ledgerFile=path.join(dir,'ledger.json'),resultPath=correctedResultPath(root);
  if(fs.existsSync(resultPath)){
    const existing=readJson(resultPath);
    if(existing.decision==='STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE'){
      const ready=loadCorrection(root);return {decision:ready.result.decision,renderCalls:0,correctionSha256:ready.complete.sha256,
        correctedEquivalenceSha256:ready.resultSha256,maxMetricDifference:ready.result.maxMetricDifference};
    }
    return {decision:existing.decision||'BLOCKED_STAGE3C_CORRECTION_EVIDENCE',renderCalls:0,reason:existing.reason||'immutable correction result already records a blocker'};
  }
  if(!fs.existsSync(idFile))writeAtomic(idFile,identity);else if(!same(readJson(idFile),identity))throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: correction identity changed');
  let ledger;if(!fs.existsSync(ledgerFile)){ledger=correctionLedger(identity);writeAtomic(ledgerFile,ledger);}else ledger=readJson(ledgerFile);
  const counts=validateLedger(ledger,identity,'correction',1);if(counts.COMPLETE===1){
    const done=validateCorrectionComplete(ledger,identity,root),failed=path.join(root,'.agent-state/issues/7/stage3c/equivalence/cells',original.fileName(hist.failed.cell));
    const result=correctedResult(hist,done,identity,textSha(JSON.stringify(identity)));
    if(!fs.existsSync(resultPath))writeAtomic(resultPath,result);
    const checked=loadCorrection(root);return {decision:checked.result.decision,renderCalls:0,correctionSha256:done.sha256,correctedEquivalenceSha256:checked.resultSha256,maxMetricDifference:checked.result.maxMetricDifference};
  }
  if(fs.existsSync(correctionCellPath(root)))throw new Error('BLOCKED_STAGE3C_CORRECTION_EVIDENCE: unbound correction cell file exists');
  assertIdentity(identity,root);ledger.cells[CORRECTION_KEY].state='IN_PROGRESS';ledger.updatedAt=new Date().toISOString();writeAtomic(ledgerFile,ledger);
  let metrics;try{metrics=runCapture(CORRECTION_CELL,root);}catch(error){ledger.status='BLOCKED';ledger.lastError=String(error.message||error);ledger.updatedAt=new Date().toISOString();writeAtomic(ledgerFile,ledger);throw error;}
  if(metrics.finite!==true) {ledger.status='BLOCKED';ledger.lastError='BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC';ledger.updatedAt=new Date().toISOString();writeAtomic(ledgerFile,ledger);throw new Error(ledger.lastError);}
  let comparison,comparisonError=null;try{comparison=compareCorrection(metrics,supplementRow(root));}catch(error){comparison={pass:false,maxMetricDifference:null,differences:{}};comparisonError=String(error.message||error);}
  const cell={schemaVersion:1,candidateId:CANDIDATE,identity,cell:CORRECTION_CELL,metrics,comparison,comparisonError,capturedAt:new Date().toISOString()};
  const file=correctionCellPath(root);writeAtomic(file,cell);ledger.cells[CORRECTION_KEY]={identity:CORRECTION_CELL,state:'COMPLETE',path:path.relative(dir,file),sha256:sha256(file)};
  ledger.accounting.newRenderCalls=1;ledger.updatedAt=new Date().toISOString();writeAtomic(ledgerFile,ledger);progress(`correction COMPLETE ${CORRECTION_KEY}`);
  if(!comparison.pass){const failResult={schemaVersion:1,decision:'BLOCKED_STAGE3C_CORRECTION_EQUIVALENCE',candidateId:CANDIDATE,
    historicalLedgerSha256:EXPECTED.originalLedger,historicalBlockedEvaluationSha256:EXPECTED.originalEvaluation,correctionCellSha256:sha256(file),
    historicalFailedCellSha256:identity.historicalFailedCellSha256,correctionComparison:comparison,reason:comparisonError,
    correctionAuthorizedRenderCount:1,correctionActualRenderCount:1,productionCandidateDelta:0,stage4Renders:0};
    writeAtomic(resultPath,failResult);return {decision:failResult.decision,renderCalls:1,correctionSha256:sha256(file),reason:comparisonError};}
  const done=validateCorrectionComplete(ledger,identity,root);
  const result=correctedResult(hist,done,identity,textSha(JSON.stringify(identity)));
  writeAtomic(resultPath,result);
  const checked=loadCorrection(root);
  return {decision:checked.result.decision,renderCalls:1,correctionSha256:checked.complete.sha256,correctedEquivalenceSha256:checked.resultSha256,maxMetricDifference:checked.result.maxMetricDifference};
}

function continuationPaths(root=ROOT){return {dir:path.join(root,'.agent-state/issues/7/stage3c/continuation'),ledger:path.join(root,'.agent-state/issues/7/stage3c/continuation/ledger.json')};}
function newContinuationLedger(identity,correctionSha,root=ROOT){const l=continuationLedger(identity,correctionSha);writeAtomic(continuationPaths(root).ledger,l);return l;}
function validateContinuationCell(ledger,cell,identity,correctionSha,root=ROOT){
  const key=original.keyOf(cell),entry=ledger.cells[key],file=continuationCellPath(cell,root);
  if(!entry||entry.state!=='COMPLETE'||entry.path!==path.relative(continuationPaths(root).dir,file)||!fs.existsSync(file)||sha256(file)!==entry.sha256)
    throw new Error(`BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: cell hash/state mismatch ${key}`);
  const row=readJson(file);if(!same(row.identity,identity)||!same(row.cell,cell)||row.correctionEquivalenceSha256!==correctionSha
      ||row.metrics?.stage3cVariantMask!==cell.stage3cMask||row.metrics?.stage2mFactorMask!==3||row.metrics?.finite!==true
      ||!same(row.metrics?.velocityDerivativeWindowMs,[30,180]))
    throw new Error(`BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: cell identity/metrics mismatch ${key}`);
  return row;
}
function validateAggregates(ledger,rows,identity,correctionSha,root=ROOT){
  const groups=new Map();for(const row of rows){const c=row.cell,k=`${c.stage3cMask}:${c.kind}:${c.pitch}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
  if(groups.size!==24||Object.keys(ledger.aggregates||{}).length!==24)throw new Error('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: aggregate count must be 24');
  for(const [key,group] of groups){const [mask,kind,pitch]=key.split(':');const file=continuationAggregatePath(Number(mask),kind,Number(pitch),root),entry=ledger.aggregates[key];
    const expected={schemaVersion:1,mask:Number(mask),kind,pitch:Number(pitch),cellCount:group.length,identitySha256:ledger.identitySha256,correctionEquivalenceSha256:correctionSha,
      cells:group.map(row=>({cell:row.cell,sha256:sha256(continuationCellPath(row.cell,root))}))};
    if(!entry||entry.path!==path.relative(continuationPaths(root).dir,file)||!fs.existsSync(file)||entry.sha256!==sha256(file)||!same(readJson(file),expected))
      throw new Error(`BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: aggregate binding mismatch ${key}`);
  }
  return groups.size;
}
function createReadyAggregates(ledger,identity,correctionSha,root=ROOT){
  const groups=new Map();for(const cell of splitCells()){const key=`${cell.stage3cMask}:${cell.kind}:${cell.pitch}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(cell);}
  for(const [key,group] of groups){if(!group.every(cell=>ledger.cells[original.keyOf(cell)]?.state==='COMPLETE'))continue;
    const [mask,kind,pitch]=key.split(':'),file=continuationAggregatePath(Number(mask),kind,Number(pitch),root),entry=ledger.aggregates[key];
    const rows=group.map(cell=>validateContinuationCell(ledger,cell,identity,correctionSha,root));
    const data={schemaVersion:1,mask:Number(mask),kind,pitch:Number(pitch),cellCount:group.length,identitySha256:ledger.identitySha256,
      correctionEquivalenceSha256:correctionSha,cells:rows.map(row=>({cell:row.cell,sha256:sha256(continuationCellPath(row.cell,root))}))};
    if(entry){if(!fs.existsSync(file)||entry.path!==path.relative(continuationPaths(root).dir,file)||entry.sha256!==sha256(file)||!same(readJson(file),data))
        throw new Error(`BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: aggregate binding mismatch ${key}`);}
    else {if(fs.existsSync(file))throw new Error(`BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: unbound aggregate exists ${key}`);writeAtomic(file,data);
      ledger.aggregates[key]={path:path.relative(continuationPaths(root).dir,file),sha256:sha256(file),cellCount:group.length};}
  }
  ledger.updatedAt=new Date().toISOString();writeAtomic(continuationPaths(root).ledger,ledger);
}
function executeSplit(root=ROOT,progress=()=>{}){
  const correction=loadCorrection(root),identity=correction.identity,cells=splitCells(),paths=continuationPaths(root);
  let ledger;if(!fs.existsSync(paths.ledger))ledger=newContinuationLedger(identity,correction.resultSha256,root);else ledger=readJson(paths.ledger);
  const counts=validateLedger(ledger,identity,'continuation',286);
  if(ledger.correctedEquivalenceSha256!==correction.resultSha256||ledger.correctionIdentitySha256!==textSha(JSON.stringify(identity)))throw new Error('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: corrected equivalence/identity SHA mismatch');
  if(counts.COMPLETE===286){const rows=cells.map(cell=>validateContinuationCell(ledger,cell,identity,correction.resultSha256,root));createReadyAggregates(ledger,identity,correction.resultSha256,root);validateAggregates(ledger,rows,identity,correction.resultSha256,root);return {decision:'STAGE3C_SPLIT_RENDERING_COMPLETE',renderCalls:0,counts};}
  for(const cell of cells){const key=original.keyOf(cell),entry=ledger.cells[key];if(entry.state==='COMPLETE'){validateContinuationCell(ledger,cell,identity,correction.resultSha256,root);continue;}
    if(fs.existsSync(continuationCellPath(cell,root)))throw new Error(`BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: unbound cell file exists ${key}`);
    const current=loadCorrection(root);if(current.resultSha256!==correction.resultSha256||!same(current.identity,identity))throw new Error('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: correction authorization changed before render');
    if(!same(continuationIdentity(root),identity))throw new Error('BLOCKED_STAGE3C_CORRECTION_BASELINE_IDENTITY: identity changed before split render');
    entry.state='IN_PROGRESS';ledger.updatedAt=new Date().toISOString();writeAtomic(paths.ledger,ledger);
    let metrics;try{metrics=runCapture(cell,root,{stage3cVariantMask:cell.stage3cMask});}catch(error){ledger.status='BLOCKED';ledger.lastError=String(error.message||error);ledger.updatedAt=new Date().toISOString();writeAtomic(paths.ledger,ledger);throw error;}
    if(metrics.finite!==true){ledger.status='BLOCKED';ledger.lastError=`BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC ${key}`;ledger.updatedAt=new Date().toISOString();writeAtomic(paths.ledger,ledger);throw new Error(ledger.lastError);}
    const row={schemaVersion:1,candidateId:CANDIDATE,identity,cell,correctionEquivalenceSha256:correction.resultSha256,metrics,capturedAt:new Date().toISOString()};
    const file=continuationCellPath(cell,root);writeAtomic(file,row);entry.state='COMPLETE';entry.path=path.relative(paths.dir,file);entry.sha256=sha256(file);
    ledger.accounting.newRenderCalls++;ledger.updatedAt=new Date().toISOString();writeAtomic(paths.ledger,ledger);
    createReadyAggregates(ledger,identity,correction.resultSha256,root);progress(`split ${ledger.accounting.newRenderCalls}/286 ${key}`);
  }
  const rows=cells.map(cell=>validateContinuationCell(ledger,cell,identity,correction.resultSha256,root));createReadyAggregates(ledger,identity,correction.resultSha256,root);
  return {decision:'STAGE3C_SPLIT_RENDERING_COMPLETE',renderCalls:ledger.accounting.newRenderCalls,counts:stateCounts(ledger),aggregateCount:Object.keys(ledger.aggregates).length};
}
function dryRun(root=ROOT){
  const hist=historical(root),build=historicalBuildIdentity(root),identity=continuationIdentity(root),corrDir=path.join(root,'.agent-state/issues/7/stage3c/correction'),contDir=path.join(root,'.agent-state/issues/7/stage3c/continuation');
  return {decision:'STAGE3C_CORRECTION_CONTINUATION_DRY_RUN_READY',builds:0,renders:0,acousticRenders:0,historicalEquivalenceRenders:20,
    historicalValidRows:19,historicalInvalidRows:1,correctionAuthorized:1,splitAuthorized:286,maximumNewCalls:287,
    correctionEvidenceExists:fs.existsSync(corrDir),
    splitEvidenceExists:fs.existsSync(contDir),stage3cWasmSha256:EXPECTED.stage3cWasm,identitySha256:textSha(JSON.stringify(identity)),
    originalLedgerSha256:sha256(hist.ledgerFile),originalEvaluationSha256:sha256(hist.resultFile),aggregateCount:build.id.aggregateCount};
}
function finalize(root=ROOT){
  const correction=loadCorrection(root),paths=continuationPaths(root);if(!fs.existsSync(paths.ledger))throw new Error('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: split ledger missing');
  const ledger=readJson(paths.ledger),cells=splitCells(),counts=validateLedger(ledger,correction.identity,'continuation',286);
  if(ledger.correctedEquivalenceSha256!==correction.resultSha256||ledger.correctionIdentitySha256!==textSha(JSON.stringify(correction.identity))
      ||!same(counts,{PENDING:0,IN_PROGRESS:0,COMPLETE:286}))throw new Error('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: split is not complete/bound');
  const rows=cells.map(cell=>validateContinuationCell(ledger,cell,correction.identity,correction.resultSha256,root));
  const aggregateCount=validateAggregates(ledger,rows,correction.identity,correction.resultSha256,root);if(aggregateCount!==24)throw new Error('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: missing aggregates');
  const result=original.calculateAttribution({identity:{...readJson(path.join(root,'.agent-state/issues/7/stage3c/build-identity.json')),aggregateCount:39},ledger,stage3cRows:rows,root});
  result.decision='STAGE3C_SPLIT_ATTRIBUTION_COMPLETE';result.equivalenceDecision='STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE';
  result.correctedEquivalenceSha256=correction.resultSha256;result.correctionIdentitySha256=textSha(JSON.stringify(correction.identity));
  result.continuationLedgerSha256=sha256(paths.ledger);result.continuationAggregateCount=24;
  result.accounting={stage3aHistoricalCalls:390,stage3bMask0Calls:6,stage3bFactorCalls:477,stage3cHistoricalEquivalenceCalls:20,
    stage3cCorrectionCalls:1,stage3cSplitCalls:286,cumulativeDiagnosticCalls:1180,physicalCandidateDelta:0,stage4Renders:0};
  result.productionCandidateDelta=0;result.stage4Renders=0;
  const file=path.join(paths.dir,'split-attribution.json');if(fs.existsSync(file)){const prev=readJson(file);
    if(prev.decision==='STAGE3C_SPLIT_ATTRIBUTION_COMPLETE'&&prev.correctedEquivalenceSha256===correction.resultSha256
        &&prev.continuationLedgerSha256===sha256(paths.ledger)&&prev.continuationAggregateCount===24)return prev;
    throw new Error('BLOCKED_STAGE3C_CONTINUATION_EVIDENCE: immutable split result already exists with a different binding');}
  writeAtomic(file,result);return result;
}
function run({mode,root=ROOT,progress=()=>{}}){
  if(mode==='--dry-run')return dryRun(root);
  if(mode==='--correct-equivalence')return executeCorrection(root,progress);
  if(mode==='--execute')return executeSplit(root,progress);
  if(mode==='--finalize')return finalize(root);
  throw new Error('unsupported mode');
}
function main(){const mode=modes(process.argv.slice(2));const result=run({mode,progress:m=>process.stderr.write(`${m}\n`)});process.stdout.write(`${JSON.stringify(result)}\n`);}
if(require.main===module){try{main();}catch(error){process.stderr.write(`Stage3C correction/continuation ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,CANDIDATE,EXPECTED,TOL,CORRECTION_CELL,CORRECTION_KEY,correctionCells,splitCells,correctionKey,correctionCellPath,correctedResultPath,continuationCellPath,
  continuationAggregatePath,stateCounts,modes,historical,historicalBuildIdentity,continuationIdentity,assertIdentity,correctionLedger,continuationLedger,
  validateLedger,supplementRow,compareCorrection,correctedResult,loadCorrection,validateContinuationCell,validateAggregates,createReadyAggregates,dryRun,run};
