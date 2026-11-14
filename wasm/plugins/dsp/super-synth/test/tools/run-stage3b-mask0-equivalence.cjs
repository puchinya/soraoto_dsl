#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const stage3a=require('./run-stage3a-velocity-diagnostic.cjs');
const stage3b=require('./run-stage3b-contact-attribution.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const PRIVATE_ROOT=path.join(ROOT,'.agent-state/issues/7/stage3b');
const DIRECT_CAPTURE=path.join(ROOT,'.agent-state/issues/7/calibration-optuna/stage3/direct-capture.json');
const MASK0_ROOT=path.join(PRIVATE_ROOT,'mask0');
const LEDGER_FILE=path.join(MASK0_ROOT,'ledger.json');
const CELLS_DIR=path.join(MASK0_ROOT,'cells');
const EVALUATION_FILE=path.join(MASK0_ROOT,'evaluation.json');
const RESULT_FILE=path.join(PRIVATE_ROOT,'mask0-equivalence.json');
const TOLERANCE=1e-6;
const CELLS=stage3a.EQUIVALENCE_CELLS.map(([pitch,velocity])=>({pitch,velocity,velocityNormalized:velocity/127,
  stage2mFactorMask:3,stage3bVariantMask:0}));
const HAMMER_FIELDS=['effectiveHardness','initialHammerVelocity','contactDurationSamples','peakForce','maxCompression','postContactTransverseEnergy'];

function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function sha256Text(value){return crypto.createHash('sha256').update(value).digest('hex');}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeJsonAtomic(file,value,{exclusive=false}={}){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});
  try{if(exclusive)fs.linkSync(temporary,file);else fs.renameSync(temporary,file);}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function cellKey(cell){return `${cell.pitch}:${cell.velocity}`;}
function cellPath(paths,cell){return path.join(paths.cells,`midi-${String(cell.pitch).padStart(3,'0')}-velocity-${String(cell.velocity).padStart(3,'0')}.json`);}
function pathsFor(root=ROOT){const base=path.join(root,'.agent-state/issues/7/stage3b/mask0');return {base,ledger:path.join(base,'ledger.json'),cells:path.join(base,'cells'),evaluation:path.join(base,'evaluation.json'),result:path.join(root,'.agent-state/issues/7/stage3b/mask0-equivalence.json')};}
function assertAuthorizedCells(cells){
  if(!Array.isArray(cells)||cells.length!==6)throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: exactly six mask-0 cells are authorized');
  const keys=cells.map(cellKey),expected=CELLS.map(cellKey);
  if(new Set(keys).size!==6||JSON.stringify(keys)!==JSON.stringify(expected))
    throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: unauthorized, duplicate, or reordered mask-0 cell identity');
  if(cells.some((cell,index)=>cell.stage2mFactorMask!==3||cell.stage3bVariantMask!==0
      ||cell.velocityNormalized!==CELLS[index].velocityNormalized))
    throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: mask-0 requires Stage2M mask 3 and Stage3B mask 0');
  return cells;
}
function acceptedIdentity(root=ROOT){
  try{
    const preflight=stage3b.assertPreflightReady(root);
    const build=stage3b.assertBuildIdentity(root);
    const accepted=stage3b.assertStage3AEvidenceIdentity(root);
    const loaded=stage3b.loadStage3ABaseline(root);
    const provenanceFile=path.join(root,'.agent-state/issues/7/stage3b/preflight-provenance.json');
    const captureFile=path.join(root,'.agent-state/issues/7/calibration-optuna/stage3/direct-capture.json');
    const capture=readJson(captureFile);
    const identities={candidateId:build.candidateId,
      productionWasmSha256:build.hashes.productionWasmSha256,
      stage3aDiagnosticWasmSha256:build.hashes.stage3aWasmSha256,
      stage3bDiagnosticWasmSha256:build.hashes.stage3bWasmSha256,
      configSha256:build.hashes.configSha256,profileSha256:build.hashes.profileSha256,
      presetsSha256:build.hashes.presetsSha256,referenceFixtureSha256:build.hashes.referenceFixtureSha256,
      preflightProvenanceClassification:preflight.production.classification,
      preflightProvenanceSha256:sha256(provenanceFile),
      stage3aLedgerSha256:accepted.identity.stage3aLedgerSha256,
      stage3aFinalSha256:accepted.identity.stage3aFinalSha256,
      stage3aSupplementSha256:accepted.identity.stage3aSupplementSha256,
      productionCaptureSha256:sha256(captureFile),authorizedCells:CELLS,equivalenceTolerance:TOLERANCE};
    if(identities.productionWasmSha256!=='9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2'
        ||identities.stage3aDiagnosticWasmSha256!=='59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3'
        ||identities.stage3bDiagnosticWasmSha256!=='2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9'
        ||identities.configSha256!=='792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d'
        ||identities.profileSha256!=='cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66'
        ||identities.presetsSha256!=='cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431'
        ||identities.referenceFixtureSha256!=='5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7'
        ||identities.preflightProvenanceClassification!=='SUFFICIENT_METADATA_PROVENANCE')
      throw new Error('fixed Stage3B acoustic identity changed');
    if(capture.render?.wasmSha256!==identities.productionWasmSha256||capture.render?.preset!=='concert_grand'
        ||capture.render?.soundboardBypassed!==false||!Array.isArray(capture.matrix)||capture.matrix.length!==480)
      throw new Error('saved production Stage3 capture identity/coverage mismatch');
    const productionByKey=new Map();
    for(const row of capture.matrix){
      const key=`${row.pitch}:${row.velocity}`;
      if(productionByKey.has(key))throw new Error(`duplicate saved production cell ${key}`);
      productionByKey.set(key,row.metrics);
    }
    for(const cell of CELLS)if(!productionByKey.get(cellKey(cell)))throw new Error(`saved production cell missing ${cellKey(cell)}`);
    return {identity:identities,baseline:loaded.baseline,productionByKey};
  }catch(error){
    if(String(error?.message||error).startsWith('BLOCKED_STAGE3B_MASK0_'))throw error;
    throw new Error(`BLOCKED_STAGE3B_MASK0_IDENTITY: ${error.message||error}`);
  }
}
function identityDigest(identity){return sha256Text(JSON.stringify(identity));}
function makeLedger(identity){
  assertAuthorizedCells(identity.authorizedCells);
  const cells=Object.fromEntries(CELLS.map(cell=>[cellKey(cell),{...cell,state:'PENDING'}]));
  return {schemaVersion:1,candidateId:identity.candidateId,status:'PENDING',identity,identitySha256:identityDigest(identity),
    authorizedRenderCount:6,cells,accounting:{newRenderCalls:0,productionCandidateDelta:0,stage4Renders:0},
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function counts(ledger){const result={PENDING:0,IN_PROGRESS:0,COMPLETE:0};for(const row of Object.values(ledger.cells||{}))result[row.state]=(result[row.state]||0)+1;return result;}
function assertLedger(ledger,identity){
  const expectedKeys=CELLS.map(cellKey).sort();
  if(!ledger||ledger.schemaVersion!==1||ledger.candidateId!==identity.candidateId||ledger.authorizedRenderCount!==6
      ||ledger.identitySha256!==identityDigest(identity)||JSON.stringify(ledger.identity)!==JSON.stringify(identity)
      ||JSON.stringify(Object.keys(ledger.cells||{}).sort())!==JSON.stringify(expectedKeys)
      ||ledger.accounting?.productionCandidateDelta!==0||ledger.accounting?.stage4Renders!==0)
    throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: mask-0 ledger identity mismatch');
  for(const cell of CELLS){const row=ledger.cells[cellKey(cell)];
    if(row.pitch!==cell.pitch||row.velocity!==cell.velocity||row.velocityNormalized!==cell.velocityNormalized
        ||row.stage2mFactorMask!==3||row.stage3bVariantMask!==0||!['PENDING','IN_PROGRESS','COMPLETE'].includes(row.state))
      throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: malformed mask-0 ledger cell ${cellKey(cell)}`);
  }
  const tally=counts(ledger);
  if(ledger.accounting.newRenderCalls!==tally.COMPLETE||ledger.accounting.newRenderCalls>6)
    throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: mask-0 render accounting mismatch');
  return ledger;
}
function numericDiff(actual,expected){return typeof actual==='number'&&typeof expected==='number'&&Number.isFinite(actual)&&Number.isFinite(expected)?Math.abs(actual-expected):null;}
function compareDiagnostics(actual,expected){
  const diffs={},exact={},invalid=[];
  const number=(name,a,e)=>{const d=numericDiff(a,e);diffs[name]=d;if(d===null)invalid.push(name);};
  const same=(name,a,e)=>{exact[name]=a!==undefined&&e!==undefined&&JSON.stringify(a)===JSON.stringify(e);if(!exact[name])invalid.push(name);};
  number('fullRenderPeakDbfs',actual?.fullRenderPeakDbfs,expected?.fullRenderPeakDbfs);
  number('velocityDerivative',actual?.velocityDerivative,expected?.velocityDerivative);
  same('velocityDerivativeWindowMs',actual?.velocityDerivativeWindowMs,expected?.velocityDerivativeWindowMs);
  if(!Array.isArray(actual?.velocityDerivativeWindowMs)||actual.velocityDerivativeWindowMs.length!==2
      ||actual.velocityDerivativeWindowMs[0]!==0||actual.velocityDerivativeWindowMs[1]!==160
      ||!Array.isArray(expected?.velocityDerivativeWindowMs)||expected.velocityDerivativeWindowMs.length!==2
      ||expected.velocityDerivativeWindowMs[0]!==0||expected.velocityDerivativeWindowMs[1]!==160)
    invalid.push('velocityDerivativeWindowMs must be the default [0,160] window');
  same('stage2mFactorMask',actual?.stage2mFactorMask,expected?.stage2mFactorMask);
  if(actual?.stage2mFactorMask!==3||expected?.stage2mFactorMask!==3)invalid.push('stage2mFactorMask must be 3');
  for(const field of HAMMER_FIELDS)number(`stage2mHammer.${field}`,actual?.stage2mHammer?.[field],expected?.stage2mHammer?.[field]);
  same('soundboardDiagnostics.frames',actual?.soundboardDiagnostics?.frames,expected?.soundboardDiagnostics?.frames);
  if(!Number.isInteger(actual?.soundboardDiagnostics?.frames)||actual.soundboardDiagnostics.frames<0
      ||!Number.isInteger(expected?.soundboardDiagnostics?.frames)||expected.soundboardDiagnostics.frames<0)
    invalid.push('soundboardDiagnostics.frames must be a non-negative integer');
  for(const signal of stage3a.DIAGNOSTIC_SIGNALS)for(const field of ['rms','peak'])
    number(`soundboardDiagnostics.signals.${signal}.${field}`,actual?.soundboardDiagnostics?.signals?.[signal]?.[field],expected?.soundboardDiagnostics?.signals?.[signal]?.[field]);
  const values=Object.values(diffs).filter(Number.isFinite),maxAbsoluteDiff=values.length?Math.max(...values):null;
  return {pass:invalid.length===0&&Object.values(exact).every(Boolean)&&maxAbsoluteDiff!==null&&maxAbsoluteDiff<=TOLERANCE,
    maxAbsoluteDiff, diffs,exact,invalidFields:invalid};
}
function safety(metrics){return {pass:metrics?.finite===true&&metrics?.outputGuardHits===0&&Number.isFinite(metrics?.peakDbfs)
    &&metrics.peakDbfs<0&&Number.isFinite(metrics?.fullRenderPeakDbfs)&&metrics.fullRenderPeakDbfs<0,
  finite:metrics?.finite===true,guardHits:metrics?.outputGuardHits,peakDbfs:metrics?.peakDbfs,fullRenderPeakDbfs:metrics?.fullRenderPeakDbfs};}
function productionEvidenceErrors(metrics,production){
  const errors=[];
  for(const [label,row] of [['render',metrics],['production baseline',production]]){
    if(!row||!Array.isArray(row.envelopeDbfs)||row.envelopeDbfs.length!==5
        ||row.envelopeDbfs.some(value=>!Number.isFinite(value)))errors.push(`${label} envelopeDbfs must contain five finite values`);
    for(const field of ['spectralCentroidHz','above2kPowerRatio','peakDbfs'])
      if(!Number.isFinite(row?.[field]))errors.push(`${label} ${field} must be finite`);
    if(typeof row?.finite!=='boolean')errors.push(`${label} finite must be boolean`);
    if(!Number.isInteger(row?.outputGuardHits))errors.push(`${label} outputGuardHits must be an integer`);
  }
  return errors;
}
function numericDiffValues(value){
  if(Array.isArray(value))return value.flatMap(numericDiffValues);
  if(value&&typeof value==='object')return Object.values(value).flatMap(numericDiffValues);
  return typeof value==='number'&&Number.isFinite(value)?[Math.abs(value)]:[];
}
function evaluateCell(cell,metrics,production,diagnostic,identity){
  const outputSafety=safety(metrics),evidenceErrors=[];
  if(!metrics||metrics.stage3bVariantMask!==0||metrics.stage2mFactorMask!==3)evidenceErrors.push('rendered factor masks do not read back as Stage2M=3 / Stage3B=0');
  evidenceErrors.push(...productionEvidenceErrors(metrics,production));
  let productionComparison,stage3aDiagnosticComparison;
  try{productionComparison=stage3a.compareEquivalence(production,metrics);}catch(error){productionComparison={pass:false,maxAbsoluteDiff:null,error:String(error.message||error)};evidenceErrors.push(`production comparison: ${error.message||error}`);}
  stage3aDiagnosticComparison=compareDiagnostics(metrics,diagnostic);
  if(stage3aDiagnosticComparison.invalidFields.length)evidenceErrors.push(`Stage3A diagnostic fields invalid: ${stage3aDiagnosticComparison.invalidFields.join(', ')}`);
  const diffs=[...numericDiffValues(productionComparison.diffs||{}),...numericDiffValues(stage3aDiagnosticComparison.diffs||{})];
  const cellMaxMetricDifference=diffs.length?Math.max(...diffs):null;
  return {schemaVersion:1,candidateId:identity.candidateId,pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized,
    productionWasmSha256:identity.productionWasmSha256,stage3aDiagnosticWasmSha256:identity.stage3aDiagnosticWasmSha256,
    stage3bDiagnosticWasmSha256:identity.stage3bDiagnosticWasmSha256,configSha256:identity.configSha256,
    profileSha256:identity.profileSha256,presetsSha256:identity.presetsSha256,referenceFixtureSha256:identity.referenceFixtureSha256,
    preflightProvenanceSha256:identity.preflightProvenanceSha256,stage3aLedgerSha256:identity.stage3aLedgerSha256,
    stage3aFinalSha256:identity.stage3aFinalSha256,stage3aSupplementSha256:identity.stage3aSupplementSha256,
    stage2mFactorMask:3,stage3bVariantMask:0,metrics,productionComparison,stage3aDiagnosticComparison,
    cellMaxMetricDifference,finite:metrics?.finite===true,guardHits:metrics?.outputGuardHits,safety:outputSafety,evidenceErrors,
    result:outputSafety.pass&&evidenceErrors.length===0&&productionComparison.pass&&stage3aDiagnosticComparison.pass
      &&cellMaxMetricDifference!==null&&cellMaxMetricDifference<=TOLERANCE?'PASS':'FAIL',capturedAt:new Date().toISOString()};
}
function validateCompletedCell(row,cell,identity,production,diagnostic){
  if(!row||row.schemaVersion!==1||row.pitch!==cell.pitch||row.velocity!==cell.velocity||row.velocityNormalized!==cell.velocityNormalized
      ||row.candidateId!==identity.candidateId||row.stage2mFactorMask!==3||row.stage3bVariantMask!==0)
    throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: cell identity mismatch ${cellKey(cell)}`);
  const expected=evaluateCell(cell,row.metrics,production,diagnostic,identity);
  for(const key of ['productionWasmSha256','stage3aDiagnosticWasmSha256','stage3bDiagnosticWasmSha256','configSha256','profileSha256',
    'presetsSha256','referenceFixtureSha256','preflightProvenanceSha256','stage3aLedgerSha256','stage3aFinalSha256','stage3aSupplementSha256'])
    if(row[key]!==identity[key])throw new Error(`BLOCKED_STAGE3B_MASK0_IDENTITY: cell ${key} mismatch ${cellKey(cell)}`);
  if(JSON.stringify(row.productionComparison)!==JSON.stringify(expected.productionComparison)
      ||JSON.stringify(row.stage3aDiagnosticComparison)!==JSON.stringify(expected.stage3aDiagnosticComparison)
      ||row.cellMaxMetricDifference!==expected.cellMaxMetricDifference||row.result!==expected.result
      ||JSON.stringify(row.safety)!==JSON.stringify(expected.safety))
    throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: saved comparison/safety changed ${cellKey(cell)}`);
  return row;
}
function inspectState(paths,identity,context){
  if(!fs.existsSync(paths.ledger)){
    if(fs.existsSync(paths.cells)&&fs.readdirSync(paths.cells).length)
      throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: orphan cell files exist without a ledger');
    if(fs.existsSync(paths.evaluation))throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: evaluation exists without its ledger');
    return {ledger:makeLedger(identity),created:false,counts:{PENDING:6,IN_PROGRESS:0,COMPLETE:0},cells:[]};
  }
  let ledger;try{ledger=readJson(paths.ledger);}catch(error){throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: invalid ledger JSON: ${error.message}`);}
  assertLedger(ledger,identity);
  const tally=counts(ledger);
  if(tally.IN_PROGRESS)throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: ambiguous IN_PROGRESS cells=${tally.IN_PROGRESS}`);
  const completeFiles=CELLS.filter(cell=>ledger.cells[cellKey(cell)].state==='COMPLETE').map(cell=>path.basename(cellPath(paths,cell))).sort();
  const actualFiles=fs.existsSync(paths.cells)?fs.readdirSync(paths.cells).sort():[];
  if(JSON.stringify(actualFiles)!==JSON.stringify(completeFiles))
    throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: cell directory contains missing or unauthorized evidence files');
  const rows=[];
  for(const cell of CELLS){const item=ledger.cells[cellKey(cell)];if(item.state!=='COMPLETE')continue;
    const file=cellPath(paths,cell);
    if(!fs.existsSync(file)||item.path!==path.relative(path.dirname(paths.ledger),file)||item.sha256!==sha256(file))
      throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: COMPLETE cell missing/hash mismatch ${cellKey(cell)}`);
    const row=readJson(file);rows.push(validateCompletedCell(row,cell,identity,context.productionByKey.get(cellKey(cell)),context.baseline.get(cellKey(cell))?.metrics));
  }
  return {ledger,created:true,counts:tally,cells:rows};
}
function currentContext(root=ROOT){return acceptedIdentity(root);}
function sameIdentity(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function mask0SuccessArtifact(identity,summary){return {schemaVersion:1,decision:'STAGE3B_MASK0_EQUIVALENCE_COMPLETE',candidateId:identity.candidateId,
  productionWasmSha256:identity.productionWasmSha256,stage3bDiagnosticWasmSha256:identity.stage3bDiagnosticWasmSha256,
  preflightProvenanceClassification:identity.preflightProvenanceClassification,preflightProvenanceSha256:identity.preflightProvenanceSha256,
  stage3aEvidence:{ledgerSha256:identity.stage3aLedgerSha256,finalSha256:identity.stage3aFinalSha256,supplementSha256:identity.stage3aSupplementSha256},
  mask0RenderCount:6,finite:true,guardHits:0,equivalenceTolerance:TOLERANCE,maxMetricDifference:summary.maxMetricDifference,
  productionCandidateDelta:0,stage4Renders:0,authorizedCells:CELLS,productionCaptureSha256:identity.productionCaptureSha256,
  stage3aDiagnosticWasmSha256:identity.stage3aDiagnosticWasmSha256,stage3bCalls:6,evaluationSha256:summary.evaluationSha256};}
function classify(rows){
  const maxes=rows.map(row=>row.cellMaxMetricDifference).filter(Number.isFinite);
  const maxMetricDifference=maxes.length?Math.max(...maxes):null;
  const finite=rows.length===6&&rows.every(row=>row.finite===true);
  const guardHits=rows.reduce((sum,row)=>sum+(Number.isFinite(row.guardHits)?row.guardHits:0),0);
  let decision='STAGE3B_MASK0_EQUIVALENCE_COMPLETE';
  if(rows.some(row=>!row.safety?.pass))decision='BLOCKED_STAGE3B_MASK0_DIAGNOSTIC_SAFETY';
  else if(rows.length!==6||rows.some(row=>row.evidenceErrors?.length))decision='BLOCKED_STAGE3B_MASK0_EVIDENCE';
  else if(rows.some(row=>!row.productionComparison?.pass||!row.stage3aDiagnosticComparison?.pass)
      ||maxMetricDifference===null||maxMetricDifference>TOLERANCE)decision='BLOCKED_STAGE3B_MASK0_NON_EQUIVALENT';
  return {decision,finite,guardHits,maxMetricDifference,equivalenceTolerance:TOLERANCE,
    cellResults:rows.map(row=>({pitch:row.pitch,velocity:row.velocity,productionMaxMetricDifference:row.productionComparison.maxAbsoluteDiff,
      stage3aDiagnosticMaxMetricDifference:row.stage3aDiagnosticComparison.maxAbsoluteDiff,cellMaxMetricDifference:row.cellMaxMetricDifference,
      finite:row.finite,guardHits:row.guardHits,peakDbfs:row.metrics?.peakDbfs,fullRenderPeakDbfs:row.metrics?.fullRenderPeakDbfs,
      productionPass:row.productionComparison.pass,stage3aDiagnosticPass:row.stage3aDiagnosticComparison.pass,result:row.result}))};
}
function buildEvaluation(identity,rows,ledger){
  const summary=classify(rows);
  return {schemaVersion:1,...summary,candidateId:identity.candidateId,identity,
    accounting:{historicalStage3aDiagnosticCalls:390,newMask0RenderCalls:ledger.accounting.newRenderCalls,
      mask0Calls:rows.length,cumulativeDiagnosticCalls:390+rows.length,stage3bFactorRenders:0,
      futureStage3bFactorRenders:477,productionCandidateDelta:0,stage4Renders:0},
    completedCellCount:rows.length,cells:rows,completedAt:new Date().toISOString()};
}
function returnSummary(evaluation,paths,renders){return {decision:evaluation.decision,renders,authorizedRenderCount:6,
  counts:{PENDING:0,IN_PROGRESS:0,COMPLETE:evaluation.completedCellCount},maxMetricDifference:evaluation.maxMetricDifference,
  evaluationPath:path.relative(ROOT,paths.evaluation),resultPath:fs.existsSync(paths.result)?path.relative(ROOT,paths.result):null};}
function assertCurrentIdentity(root,identity,identityProvider=currentContext){
  const current=identityProvider(root);
  if(!sameIdentity(current.identity,identity))throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: protected identity changed during mask-0 run');
  return current;
}
function execute({root=ROOT,progress=()=>{},renderFn=null,identityProvider=currentContext,baselineContext=null,
  mask0Validator=stage3b.assertMask0EquivalenceReady}={}){
  const paths=pathsFor(root),context=baselineContext||identityProvider(root),identity=context.identity;
  if(fs.existsSync(paths.result)){
    let authorization;try{authorization=mask0Validator(root);}catch(error){throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: existing success artifact rejected: ${error.message||error}`);}
    authorizationIdentity(authorization,identity);
    assertFinalArtifact(authorization);
    if(!fs.existsSync(paths.evaluation)||!fs.existsSync(paths.ledger))throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: immutable success artifact is missing its ledger/evaluation');
    const completed=inspectState(paths,identity,context),saved=readJson(paths.evaluation);
    if(completed.counts.COMPLETE!==6||authorization.mask0Result.evaluationSha256!==sha256(paths.evaluation)
        ||sha256(paths.result)!==completed.ledger.mask0EquivalenceSha256)
      throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: immutable success artifact binding mismatch');
    return {...returnSummary(saved,paths,0),builds:0,renderCalls:0,idempotent:true};
  }
  const state=inspectState(paths,identity,context),ledger=state.ledger;
  if(state.counts.IN_PROGRESS)throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: ambiguous IN_PROGRESS');
  if(!state.created)writeJsonAtomic(paths.ledger,ledger);
  let captureRender=renderFn;
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;
  try{
    if(!captureRender){process.env.SORAOTO_WASM_BUILD_DIR=path.join(root,'build/wasm-stage3b');captureRender=require('./capture-supersynth-matrix.cjs').render;}
    let renderCalls=0;
    for(const cell of CELLS){const entry=ledger.cells[cellKey(cell)];if(entry.state==='COMPLETE')continue;
      if(entry.state!=='PENDING')throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: ${cellKey(cell)} is ${entry.state}`);
      if(fs.existsSync(paths.result))throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: success artifact appeared during mask-0 execution');
      const current=assertCurrentIdentity(root,identity,identityProvider);
      if(!sameIdentity(current.identity,identity))throw new Error(`BLOCKED_STAGE3B_MASK0_IDENTITY: changed before ${cellKey(cell)}`);
      entry.state='IN_PROGRESS';entry.startedAt=new Date().toISOString();ledger.status='IN_PROGRESS';ledger.updatedAt=new Date().toISOString();
      writeJsonAtomic(paths.ledger,ledger);
      const metrics=captureRender(cell.pitch,cell.velocity,{}, {stage2mFactorMask:3,stage3bVariantMask:0,
        includeVelocityDerivative:true,includeSoundboardDiagnostics:true});
      renderCalls++;ledger.accounting.newRenderCalls++;
      const row=evaluateCell(cell,metrics,current.productionByKey.get(cellKey(cell)),current.baseline.get(cellKey(cell))?.metrics,identity);
      const file=cellPath(paths,cell);writeJsonAtomic(file,row);
      entry.state='COMPLETE';entry.path=path.relative(path.dirname(paths.ledger),file);entry.sha256=sha256(file);
      entry.completedAt=new Date().toISOString();delete entry.startedAt;ledger.updatedAt=new Date().toISOString();
      writeJsonAtomic(paths.ledger,ledger);progress(`mask0 ${ledger.accounting.newRenderCalls}/6 MIDI ${cell.pitch} v${cell.velocity}`);
    }
    const completed=inspectState(paths,identity,context);
    const evaluation=buildEvaluation(identity,completed.cells,completed.ledger);
    const decision=evaluation.decision==='STAGE3B_MASK0_EQUIVALENCE_COMPLETE'
      ?'STAGE3B_MASK0_CELLS_COMPLETE_FINALIZE_REQUIRED':evaluation.decision;
    return {...returnSummary({...evaluation,decision},paths,renderCalls),builds:0,renderCalls};
  }finally{
    if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;
  }
}
function dryRun({root=ROOT,identityProvider=currentContext}={}){
  const context=identityProvider(root);
  return {decision:'STAGE3B_MASK0_DRY_RUN',builds:0,renders:0,authorizedRenderCount:6,
    authorizedCells:CELLS.map(({pitch,velocity,stage2mFactorMask,stage3bVariantMask})=>({pitch,velocity,stage2mFactorMask,stage3bVariantMask})),
    identity:context.identity};
}
function finalize({root=ROOT,identityProvider=currentContext,baselineContext=null,mask0Validator=stage3b.assertMask0EquivalenceReady}={}){
  const paths=pathsFor(root),context=baselineContext||identityProvider(root),identity=context.identity;
  if(fs.existsSync(paths.result)){
    let authorization;try{authorization=mask0Validator(root);}catch(error){throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: existing success artifact rejected: ${error.message||error}`);}
    if(!sameIdentity(authorizationIdentity(authorization,identity),identity))throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: immutable success artifact identity changed');
    assertFinalArtifact(authorization);
    if(!fs.existsSync(paths.evaluation)||!fs.existsSync(paths.ledger))throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: immutable evaluation or ledger is missing');
    const saved=readJson(paths.evaluation);
    const completed=inspectState(paths,identity,context);
    if(completed.counts.COMPLETE!==6||authorization.mask0Result.evaluationSha256!==sha256(paths.evaluation)
        ||sha256(paths.result)!==completed.ledger.mask0EquivalenceSha256)
      throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: immutable evaluation hash mismatch');
    return {...returnSummary(saved,paths,0),decision:'STAGE3B_MASK0_EQUIVALENCE_COMPLETE',renders:0,idempotent:true};
  }
  const state=inspectState(paths,identity,context);
  if(state.counts.PENDING!==0||state.counts.IN_PROGRESS!==0||state.counts.COMPLETE!==6)
    throw new Error(`BLOCKED_STAGE3B_MASK0_EVIDENCE: finalization requires six COMPLETE cells, got ${JSON.stringify(state.counts)}`);
  const evaluation=buildEvaluation(identity,state.cells,state.ledger);
  if(fs.existsSync(paths.evaluation))throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: evaluation already exists without immutable success result');
  writeJsonAtomic(paths.evaluation,evaluation,{exclusive:true});
  const evaluationSha256=sha256(paths.evaluation);
  evaluation.evaluationSha256=evaluationSha256;
  if(evaluation.decision!=='STAGE3B_MASK0_EQUIVALENCE_COMPLETE')return returnSummary(evaluation,paths,0);
  const artifact=mask0SuccessArtifact(identity,{...evaluation,evaluationSha256});
  try{
    writeJsonAtomic(paths.result,artifact,{exclusive:true});
    assertFinalArtifact(mask0Validator(root));
  }catch(error){if(fs.existsSync(paths.result))fs.unlinkSync(paths.result);
    evaluation.decision='BLOCKED_STAGE3B_MASK0_EVIDENCE';evaluation.blocker=String(error.message||error);delete evaluation.evaluationSha256;
    writeJsonAtomic(paths.evaluation,evaluation);return returnSummary(evaluation,paths,0);}
  state.ledger.status='COMPLETE';state.ledger.finalizedAt=new Date().toISOString();state.ledger.evaluationSha256=evaluationSha256;
  state.ledger.mask0EquivalenceSha256=sha256(paths.result);state.ledger.updatedAt=new Date().toISOString();writeJsonAtomic(paths.ledger,state.ledger);
  return returnSummary(evaluation,paths,0);
}
function authorizationIdentity(authorization,expected){
  const result=authorization.mask0Result;
  if(result.candidateId!==expected.candidateId||result.productionWasmSha256!==expected.productionWasmSha256
      ||result.stage3bDiagnosticWasmSha256!==expected.stage3bDiagnosticWasmSha256
      ||result.preflightProvenanceSha256!==expected.preflightProvenanceSha256
      ||result.stage3aEvidence?.ledgerSha256!==expected.stage3aLedgerSha256
      ||result.stage3aEvidence?.finalSha256!==expected.stage3aFinalSha256
      ||result.stage3aEvidence?.supplementSha256!==expected.stage3aSupplementSha256)
    throw new Error('BLOCKED_STAGE3B_MASK0_IDENTITY: existing success artifact does not match current identity');
  return expected;
}
function assertFinalArtifact(authorization){
  const result=authorization?.mask0Result;
  if(!result||result.schemaVersion!==1||result.decision!=='STAGE3B_MASK0_EQUIVALENCE_COMPLETE'
      ||result.mask0RenderCount!==6||result.finite!==true||result.guardHits!==0
      ||result.equivalenceTolerance!==TOLERANCE||!Number.isFinite(result.maxMetricDifference)
      ||result.maxMetricDifference>TOLERANCE||result.productionCandidateDelta!==0||result.stage4Renders!==0
      ||!Array.isArray(result.authorizedCells))
    throw new Error('BLOCKED_STAGE3B_MASK0_EVIDENCE: authoritative result does not prove the exact six-cell success gate');
  assertAuthorizedCells(result.authorizedCells);
  return authorization;
}
function run({mode,root=ROOT,...options}={}){
  if(!['dry-run','execute','finalize'].includes(mode))throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  if(mode==='dry-run')return dryRun({root,identityProvider:options.identityProvider});
  if(mode==='execute')return execute({root,progress:options.progress,renderFn:options.renderFn,
    identityProvider:options.identityProvider,baselineContext:options.baselineContext});
  return finalize({root,identityProvider:options.identityProvider,baselineContext:options.baselineContext,mask0Validator:options.mask0Validator});
}
function main(){
  const args=process.argv.slice(2);if(args.length!==1||!['--dry-run','--execute','--finalize'].includes(args[0]))
    throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  const mode={'--dry-run':'dry-run','--execute':'execute','--finalize':'finalize'}[args[0]];
  const result=run({mode,progress:message=>process.stderr.write(`${message}\n`)});
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if(result.decision.startsWith('BLOCKED_'))process.exitCode=1;
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`Stage3B mask-0 equivalence ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,CELLS,TOLERANCE,pathsFor,cellKey,cellPath,assertAuthorizedCells,acceptedIdentity,makeLedger,counts,assertLedger,
  compareDiagnostics,productionEvidenceErrors,numericDiffValues,safety,evaluateCell,validateCompletedCell,inspectState,classify,buildEvaluation,
  mask0SuccessArtifact,assertFinalArtifact,dryRun,execute,finalize,authorizationIdentity,run};
