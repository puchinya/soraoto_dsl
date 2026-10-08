'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const {evaluateDirectReferenceMatrix,LIMITS,dynamicSpanMetrics}=require('./stage3-direct-reference-metrics.cjs');
const requalification=require('./run-stage3e-historical-reference-requalification.cjs');

const BASELINE_METRIC_FIELDS=['onsetMs','peakDbfs','fullRenderPeakDbfs','spectralCentroidHz','above2kPowerRatio','envelopeDbfs','envelope20msDbfs','harmonicRatiosH2ToH6','stereoWidth','stereoPan','inharmonicityB','spectralSpreadHz','finite','outputGuardHits'];
const DIAGNOSTIC_METRIC_FIELDS=['stage2mFactorMask','stage2mHammer','soundboardDiagnostics'];
const MIDI41_DIAGNOSTIC_FIELDS=['velocityDerivative','velocityDerivativeWindowMs'];
const KEY=(pitch,velocity)=>`${pitch}:${velocity}`;
const SURROGATE_ARTIFACT_ROLES=Object.freeze({[requalification.REFERENCE_FILE]:'stage3e-surrogate-reference-set',
  'production-provenance.json':'production-lineage-provenance','stage3d-surrogate-identity.json':'exact-stage3d-surrogate-build'});

function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function compareValue(expected,actual,{tolerance,pathName='value'}={}){
  if(typeof expected==='number'||typeof actual==='number'){
    if(!Number.isFinite(expected)||!Number.isFinite(actual))return {pass:false,maxDifference:Infinity,failures:[`${pathName}: non-finite`]};
    const difference=Math.abs(expected-actual),exact=/(?:^|\.)(?:frames|outputGuardHits|stage2mFactorMask|contactDurationSamples)$|(?:^|\.)velocityDerivativeWindowMs\[\d+\]$/.test(pathName)
      ||(Number.isInteger(expected)&&Number.isInteger(actual)),pass=exact?difference===0:difference<=tolerance;
    return {pass,maxDifference:difference,failures:pass?[]:[`${pathName}: ${difference} ${exact?'!=':'>'} ${exact?0:tolerance}`]};
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
  const fields=[...BASELINE_METRIC_FIELDS,...DIAGNOSTIC_METRIC_FIELDS,...(kind==='stage3a'?MIDI41_DIAGNOSTIC_FIELDS:[])];
  const result={};for(const field of fields){if(!(field in metrics))throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: missing canonical metric ${field}`);result[field]=metrics[field];}
  const names=Object.keys(metrics.soundboardDiagnostics?.signals||{}).sort();
  if(names.length!==20||metrics.stage2mFactorMask!==3||!metrics.stage2mHammer||!Number.isInteger(metrics.soundboardDiagnostics?.frames))
    throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: Stage2M/soundboard diagnostic identity mismatch');
  if(kind==='stage3a'&&(!Number.isFinite(metrics.velocityDerivative)||JSON.stringify(metrics.velocityDerivativeWindowMs)!==JSON.stringify([30,180])))
    throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: MIDI41 derivative window mismatch');
  if(kind==='production'&&('velocityDerivative' in metrics||'velocityDerivativeWindowMs' in metrics))
    throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: direct row has non-canonical derivative metrics');
  return result;
}
function validateHistoricalReferenceSet(referenceSet,{expectedSource=requalification}={}){
  if(!referenceSet||referenceSet.schemaVersion!==1||referenceSet.decision!=='STAGE3E_BASELINE_SURROGATE_REQUALIFIED'
    ||referenceSet.referenceSetId!=='stage3e-baseline-surrogate-reference-v1'
    ||referenceSet.candidateId!==expectedSource.CANDIDATE_ID||referenceSet.acousticRenderCalls!==12
    ||referenceSet.authorizedCellCount!==12||referenceSet.productionCandidateDelta!==0||referenceSet.stage4Renders!==0
    ||referenceSet.stage3dVariant!==0||referenceSet.stage2mFactorMask!==3
    ||referenceSet.stage3dWasmSha256!=='9883b54eaa888b5a8d2e4d9da0490de92dd4c31915fb0d97d47cc03ce123a63a'
    ||referenceSet.stage3dSourceSha256!=='968488b7d325c42e41570c1d7add10003050ab4c87779774a6e5337244c64886'
    ||referenceSet.configSha256!=='792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d'
    ||referenceSet.profileSha256!=='cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66'
    ||referenceSet.presetsSha256!=='cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431'
    ||referenceSet.referenceFixtureSha256!=='5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7'
    ||!/^([0-9a-f]{64})$/.test(referenceSet.productionProvenanceSha256||'')
    ||!['EXACT_REBUILD_PROVENANCE','SUFFICIENT_METADATA_PROVENANCE'].includes(referenceSet.productionProvenanceClassification)
    ||referenceSet.rows?.length!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: historical reference set header mismatch');
  const expected=new Map(expectedSource.exactCellList().map(cell=>[cell.key,cell]));const observed=new Set();
  for(const row of referenceSet.rows){
    const cell=expected.get(row.cellKey);if(!cell||observed.has(row.cellKey))throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: unauthorized or duplicate ${row.cellKey}`);
    observed.add(row.cellKey);if(row.pitch!==cell.pitch||row.velocity!==cell.velocity||row.kind!==cell.kind||!row.metrics)throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: row identity mismatch ${row.cellKey}`);
    projectMetrics(row.metrics,row.kind);
    if(row.metrics.finite!==true||row.metrics.outputGuardHits!==0||row.metrics.peakDbfs>=0||row.metrics.fullRenderPeakDbfs>=0)
      throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: unsafe surrogate row ${row.cellKey}`);
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
  const stored=durable.verifyDualCopy(path.join(rootsSet.primary,requalification.REFERENCE_FILE),path.join(rootsSet.secondary,requalification.REFERENCE_FILE));
  const hash=durable.verifyDualCopy(path.join(rootsSet.primary,`${requalification.REFERENCE_FILE}.sha256`),path.join(rootsSet.secondary,`${requalification.REFERENCE_FILE}.sha256`));
  if(hash.bytes.toString('utf8')!==`${stored.sha256}\n`)throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: reference-set SHA file mismatch');
  const value=JSON.parse(stored.bytes.toString('utf8'));validateHistoricalReferenceSet(value);
  for(const row of value.rows){
    const cell=expectedCellPath(row),cellStored=durable.verifyDualCopy(path.join(rootsSet.primary,cell),path.join(rootsSet.secondary,cell));
    if(cellStored.sha256!==row.rowFileSha256)throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: surrogate cell file hash mismatch ${row.cellKey}`);
    const cellRow=JSON.parse(cellStored.bytes.toString('utf8')),{rowFileSha256,...referenceRow}=row;
    if(!same(cellRow,referenceRow))throw new Error(`BLOCKED_STAGE3E_BASELINE_EVIDENCE: reference row differs from durable cell ${row.cellKey}`);
  }
  const manifestStored=durable.verifyDualCopy(path.join(rootsSet.primary,'evidence-manifest.json'),path.join(rootsSet.secondary,'evidence-manifest.json'));
  const manifestHash=durable.verifyDualCopy(path.join(rootsSet.primary,'evidence-manifest.sha256'),path.join(rootsSet.secondary,'evidence-manifest.sha256'));
  if(manifestHash.bytes.toString('utf8')!==`${manifestStored.sha256}\n`)throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: finalized manifest SHA mismatch');
  const manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  const inventory=durable.assertMatchingInventory(rootsSet.primary,rootsSet.secondary,SURROGATE_ARTIFACT_ROLES);
  if(manifest.state!=='FINALIZED'||manifest.decision!==value.decision||manifest.generation!==value.referenceSetId
      ||!same(manifest.files,inventory))throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: finalized manifest identity/inventory mismatch');
  const archive=durable.verifyDualCopy(path.join(rootsSet.primary,'archives/historical-reference-requalification.tar.gz'),path.join(rootsSet.secondary,'archives/historical-reference-requalification.tar.gz'));
  const entries=execFileSync('tar',['-tzf',path.join(rootsSet.primary,'archives/historical-reference-requalification.tar.gz')],{encoding:'utf8'});
  if(!entries.includes(REFERENCE_FILE)||archive.sizeBytes===0)throw new Error('BLOCKED_STAGE3E_BASELINE_EVIDENCE: finalized phase archive is incomplete');
  return {referenceSet:value,sha256:stored.sha256};
}
function expectedCellPath(row){return `cells/${row.cellKey}.json`;}
function compareReferenceRow(referenceRow,measuredRow,{tolerance=1e-6}={}){
  if(referenceRow.pitch!==measuredRow.pitch||referenceRow.velocity!==measuredRow.velocity||referenceRow.kind!==measuredRow.kind
      ||(referenceRow.kind==='stage3a'&&referenceRow.velocityNormalized!==measuredRow.velocityNormalized))
    return {pass:false,maxDifference:Infinity,failures:['cell identity mismatch']};
  const a=projectMetrics(referenceRow.metrics,referenceRow.kind),b=projectMetrics(measuredRow.metrics,referenceRow.kind);
  return compareValue(a,b,{tolerance,pathName:KEY(referenceRow.pitch,referenceRow.velocity)});
}
function validateBaselineRows(referenceSet,measuredRows,{tolerance=1e-6}={}){
  validateHistoricalReferenceSet(referenceSet);
  if(!Array.isArray(measuredRows)||measuredRows.length!==12)throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: expected exactly 12 fresh baseline rows');
  const keyFor=row=>row.kind==='production'
    ?`production-midi-${String(row.pitch).padStart(3,'0')}-velocity-${String(row.velocity).padStart(3,'0')}`
    :`stage3a-midi-041-v${String(Math.round(row.velocityNormalized*1000)).padStart(3,'0')}`;
  const ref=new Map(referenceSet.rows.map(row=>[keyFor(row),row]));const keys=new Set();let maximumDifference=0;
  const cells=measuredRows.map(row=>{
    const key=keyFor(row);
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

module.exports={BASELINE_METRIC_FIELDS,DIAGNOSTIC_METRIC_FIELDS,LIMITS,KEY,SURROGATE_ARTIFACT_ROLES,stable,same,compareValue,projectMetrics,validateHistoricalReferenceSet,loadFinalizedReferenceSet,compareReferenceRow,validateBaselineRows,loadReferenceFixture,safetyPass,groupRows,expectedRowsFor,screenSpanErrors,derivativeSet,lowScreenResult,midScreenResult,firstFivePassing,validateFullRows,validateLowFullRows};
