'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {evaluateDirectReferenceMatrix,LIMITS,dynamicSpanMetrics}=require('./stage3-direct-reference-metrics.cjs');
const requalification=require('./run-stage3e-historical-reference-requalification.cjs');

const BASELINE_METRIC_FIELDS=['onsetMs','peakDbfs','fullRenderPeakDbfs','spectralCentroidHz','above2kPowerRatio','envelopeDbfs','envelope20msDbfs','harmonicRatiosH2ToH6','stereoWidth','stereoPan','inharmonicityB','spectralSpreadHz','finite'];
const DIAGNOSTIC_METRIC_FIELDS=['stage2mFactorMask','velocityDerivative','velocityDerivativeWindowMs','stage2mHammer','soundboardDiagnostics'];
const KEY=(pitch,velocity)=>`${pitch}:${velocity}`;

function compareValue(expected,actual,{tolerance,pathName='value'}={}){
  if(typeof expected==='number'||typeof actual==='number'){
    if(!Number.isFinite(expected)||!Number.isFinite(actual))return {pass:false,maxDifference:Infinity,failures:[`${pathName}: non-finite`]};
    const difference=Math.abs(expected-actual);return {pass:difference<=tolerance,maxDifference:difference,failures:difference<=tolerance?[]:[`${pathName}: ${difference} > ${tolerance}`]};
  }
  if(expected===null||actual===null||typeof expected!=='object'||typeof actual!=='object'){
    const pass=expected===actual;return {pass,maxDifference:pass?0:Infinity,failures:pass?[]:[`${pathName}: exact value mismatch`]};
  }
  if(Array.isArray(expected)!==Array.isArray(actual))return {pass:false,maxDifference:Infinity,failures:[`${pathName}: array/object mismatch`]};
  if(Array.isArray(expected)){
    if(expected.length!==actual.length)return {pass:false,maxDifference:Infinity,failures:[`${pathName}: length ${actual.length} != ${expected.length}`]};
    const items=expected.map((value,index)=>compareValue(value,actual[index],{tolerance,pathName:`${pathName}[${index}]`}));
    return {pass:items.every(item=>item.pass),maxDifference:Math.max(0,...items.map(item=>item.maxDifference)),failures:items.flatMap(item=>item.failures)};
  }
  const e=Object.keys(expected).sort(),a=Object.keys(actual).sort();
  if(e.length!==a.length||e.some((key,index)=>key!==a[index]))return {pass:false,maxDifference:Infinity,failures:[`${pathName}: object keys differ`]};
  const items=e.map(key=>compareValue(expected[key],actual[key],{tolerance,pathName:`${pathName}.${key}`}));
  return {pass:items.every(item=>item.pass),maxDifference:Math.max(0,...items.map(item=>item.maxDifference)),failures:items.flatMap(item=>item.failures)};
}
function projectMetrics(metrics,kind){
  if(!metrics||typeof metrics!=='object')throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: metric payload missing');
  const fields=kind==='stage3a'?[...BASELINE_METRIC_FIELDS,...DIAGNOSTIC_METRIC_FIELDS]:BASELINE_METRIC_FIELDS;
  const result={};for(const field of fields){if(!(field in metrics))throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: missing canonical metric ${field}`);result[field]=metrics[field];}
  if(kind==='stage3a'){
    const names=Object.keys(metrics.soundboardDiagnostics?.signals||{}).sort();
    if(names.length!==20||metrics.stage2mFactorMask!==3||JSON.stringify(metrics.velocityDerivativeWindowMs)!==JSON.stringify([30,180]))throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: Stage3A diagnostic identity mismatch');
  }
  return result;
}
function validateHistoricalReferenceSet(referenceSet,{expectedSource=requalification}={}){
  if(!referenceSet||referenceSet.schemaVersion!==1||referenceSet.decision!=='STAGE3E_HISTORICAL_REFERENCE_REQUALIFIED'
    ||referenceSet.candidateId!==expectedSource.CANDIDATE_ID||referenceSet.productionRevision!==expectedSource.PRODUCTION_REVISION
    ||referenceSet.stage3aRevision!==expectedSource.STAGE3A_REVISION||referenceSet.acousticRenderCalls!==12
    ||referenceSet.productionCandidateDelta!==0||referenceSet.stage4Renders!==0||referenceSet.rows?.length!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: historical reference set header mismatch');
  const expected=new Map(expectedSource.exactCellList().map(cell=>[cell.key,cell]));const observed=new Set();
  for(const row of referenceSet.rows){
    const cell=expected.get(row.cellKey);if(!cell||observed.has(row.cellKey))throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: unauthorized or duplicate ${row.cellKey}`);
    observed.add(row.cellKey);if(row.pitch!==cell.pitch||row.velocity!==cell.velocity||row.kind!==cell.kind||!row.metrics)throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: row identity mismatch ${row.cellKey}`);
    projectMetrics(row.metrics,row.kind);
    const body={...row};delete body.rowFileSha256;delete body.rowSha256;
    const candidateHashes=[row.rowSha256,row.rowFileSha256].filter(Boolean);
    if(candidateHashes.length===0)throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: row SHA absent ${row.cellKey}`);
    if(row.rowSha256&&requalification.sha256(requalification.canonicalBytes(body))!==row.rowSha256)throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: row payload SHA mismatch ${row.cellKey}`);
    if(row.kind==='stage3a'){
      const i=expectedSource.STAGE3A_CELLS.findIndex(x=>x.velocityNormalized===row.velocityNormalized);
      if(!Number.isFinite(row.metrics.velocityDerivative)||Math.abs(row.metrics.velocityDerivative-expectedSource.DERIVATIVE_EXPECTED[i])>1e-6)throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: MIDI41 derivative mismatch ${row.cellKey}`);
    }
  }
  if(observed.size!==12)throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: historical reference coverage is incomplete');
  return referenceSet;
}
function loadFinalizedReferenceSet(rootsSet){
  const stored=requalification.durableRead(rootsSet,'historical-reference-set.json');
  const hash=requalification.durableRead(rootsSet,'historical-reference-set.sha256');
  if(hash.bytes.toString('utf8')!==`${stored.sha256}\n`)throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: reference-set SHA file mismatch');
  const value=JSON.parse(stored.bytes.toString('utf8'));validateHistoricalReferenceSet(value);
  return {referenceSet:value,sha256:stored.sha256};
}
function compareReferenceRow(referenceRow,measuredRow,{tolerance=1e-6}={}){
  if(referenceRow.pitch!==measuredRow.pitch||referenceRow.velocity!==measuredRow.velocity||referenceRow.kind!==measuredRow.kind)
    return {pass:false,maxDifference:Infinity,failures:['cell identity mismatch']};
  const a=projectMetrics(referenceRow.metrics,referenceRow.kind),b=projectMetrics(measuredRow.metrics,referenceRow.kind);
  return compareValue(a,b,{tolerance,pathName:KEY(referenceRow.pitch,referenceRow.velocity)});
}
function validateBaselineRows(referenceSet,measuredRows,{tolerance=1e-6}={}){
  validateHistoricalReferenceSet(referenceSet);
  if(!Array.isArray(measuredRows)||measuredRows.length!==12)throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: expected exactly 12 fresh baseline rows');
  const ref=new Map(referenceSet.rows.map(row=>[row.cellKey,row]));const keys=new Set();let maximumDifference=0;
  const cells=measuredRows.map(row=>{
    const key=row.cellKey||`${row.kind}-${String(row.pitch).padStart(3,'0')}-${row.kind==='production'?`velocity-${String(row.velocity).padStart(3,'0')}`:`v${String(Math.round(row.velocityNormalized*1000)).padStart(3,'0')}`}`;
    if(keys.has(key)||!ref.has(key))throw new Error(`BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: unauthorized or duplicate measured cell ${key}`);keys.add(key);
    const comparison=compareReferenceRow(ref.get(key),row,{tolerance});maximumDifference=Math.max(maximumDifference,comparison.maxDifference);
    return {cellKey:key,pass:comparison.pass,maxDifference:comparison.maxDifference,failures:comparison.failures};
  });
  if(keys.size!==12||cells.some(cell=>!cell.pass))return {decision:'BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT',pass:false,cellCount:cells.length,maximumDifference,tolerance,cells};
  return {decision:'STAGE3E_BASELINE_EQUIVALENCE_PASS',pass:true,cellCount:cells.length,maximumDifference,tolerance,cells};
}
function loadReferenceFixture(root){return JSON.parse(fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));}
function safetyPass(rows){return rows.every(row=>row.metrics?.finite===true&&(row.metrics.outputGuardHits??0)===0&&Number.isFinite(row.metrics.peakDbfs)&&row.metrics.peakDbfs<0&&Number.isFinite(row.metrics.fullRenderPeakDbfs)&&row.metrics.fullRenderPeakDbfs<0);}
function groupRows(rows){const by=new Map();for(const row of rows){const key=KEY(row.pitch,row.velocity);by.set(key,row);}return by;}
function expectedRowsFor(fixture,pitches,velocities){const by=groupRows(fixture.directCells);return pitches.flatMap(pitch=>velocities.map(velocity=>{const row=by.get(KEY(pitch,velocity));if(!row)throw new Error(`reference fixture missing ${KEY(pitch,velocity)}`);return row;}));}
function screenSpanErrors(rows,fixture,pitches,velocities){
  const actual=groupRows(rows),reference=groupRows(fixture.directCells),result={};
  const pairs=[[velocities[0],velocities[1]],[velocities[1],velocities[2]],[velocities[0],velocities[2]]];
  for(const pitch of pitches){const levels=velocities.map(v=>actual.get(KEY(pitch,v))?.metrics?.envelopeDbfs?.[3]);const refs=velocities.map(v=>reference.get(KEY(pitch,v))?.metrics?.envelopeDbfs?.[3]);
    if(levels.some(x=>!Number.isFinite(x))||refs.some(x=>!Number.isFinite(x)))throw new Error(`BLOCKED_STAGE3E_SEARCH_EVIDENCE: incomplete screen layers for MIDI ${pitch}`);
    result[pitch]=pairs.map(([low,high])=>{const li=velocities.indexOf(low),hi=velocities.indexOf(high);return dynamicSpanMetrics([levels[li],levels[hi]],[refs[li],refs[hi]]).errorDb;});
  }
  return result;
}
function derivativeSet(rows){return [.25,.55,.90].map(v=>rows.find(row=>row.pitch===41&&row.velocityNormalized===v)?.metrics?.velocityDerivative);}
function lowScreenResult(tuple,rows,fixture){return {low:tuple.low,bassHardness:tuple.bassHardness,safetyPass:safetyPass(rows),midi41Derivatives:derivativeSet(rows),spanErrorsByPitch:screenSpanErrors(rows,fixture,[36,39,42],[14,61,124]),rows};}
function midScreenResult(tuple,rows,fixture){return {mid:tuple.mid,safetyPass:safetyPass(rows),spanErrorsByPitch:screenSpanErrors(rows,fixture,[48,51,54,57],[14,61,124]),rows};}
function firstFivePassing(candidates,evaluate){for(const candidate of candidates.slice(0,5)){const result=evaluate(candidate);if(result.pass)return {candidate,result};}return null;}
function validateFullRows(rows,{pitches,fixture}){
  const expected=expectedRowsFor(fixture,pitches,Array.from({length:16},(_,i)=>[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124][i]));
  const evaluation=evaluateDirectReferenceMatrix(expected,rows,{requiredVelocityLayers:[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124]});
  const pitchHealth=rows.every(row=>row.metrics?.finite===true&&(row.metrics.outputGuardHits??0)===0&&row.metrics.peakDbfs<0&&row.metrics.fullRenderPeakDbfs<0);
  return {pass:evaluation.metrics.cellFailureCount===0&&evaluation.metrics.directPitchFailureCount===0&&pitchHealth,evaluation,pitchHealth};
}
function validateLowFullRows(rows,fixture){
  const acoustic=validateFullRows(rows.filter(row=>row.pitch!==41),{pitches:[33,36,39,42,45],fixture});
  const derivatives=derivativeSet(rows),brightness=derivatives.length===3&&derivatives.every(Number.isFinite)&&derivatives[1]>derivatives[0]*1.05&&derivatives[2]>derivatives[1]*1.05;
  return {...acoustic,brightness,derivatives,pass:acoustic.pass&&brightness};
}

module.exports={BASELINE_METRIC_FIELDS,DIAGNOSTIC_METRIC_FIELDS,LIMITS,KEY,compareValue,projectMetrics,validateHistoricalReferenceSet,loadFinalizedReferenceSet,compareReferenceRow,validateBaselineRows,loadReferenceFixture,safetyPass,groupRows,expectedRowsFor,screenSpanErrors,derivativeSet,lowScreenResult,midScreenResult,firstFivePassing,validateFullRows,validateLowFullRows};
