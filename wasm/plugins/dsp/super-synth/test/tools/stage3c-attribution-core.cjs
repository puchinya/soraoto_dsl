'use strict';

const DYNAMIC_PITCHES=[36,39,42,45,48,51,54,57];
const TREBLE_PITCHES=[93,96,99];
const DYNAMIC_VELOCITIES=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const TREBLE_VELOCITIES=[14,31,61,124];
const MIDI41_NORMALIZED=[0.25,0.55,0.90];
const PATH_METRICS=['contactDurationSamples','peakForce','postContactTransverseEnergy','bridge_b RMS','board_drive_b RMS',
  'post_radiation_l RMS','spectralCentroidHz','above2kPowerRatio'];

function metrics(row){return row?.metrics??row;}
function mean(values){return values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);}
function factorial(m0,mc,mb,mi){
  const c=((mc-m0)+(mi-mb))/2,b=((mb-m0)+(mi-mc))/2;
  return {M0:m0,MC:mc,MB:mb,MI:mi,C_main:c,B_main:b,interaction:mi-mb-mc+m0,C_improvement:-c,B_improvement:-b};
}
function benefitOrigin(contact,bridge){return contact>0&&bridge>0?'BOTH':contact>0?'CONTACT':bridge>0?'BRIDGE':'NEITHER';}
function velocitySpan(rows){const levels=rows.map(row=>{
  const value=metrics(row).envelopeDbfs?.[3];
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error('required 80-200 ms envelope level missing');
  return value;
});return Math.max(...levels)-Math.min(...levels);}
function unsafe(row){const m=metrics(row);return m.finite!==true||m.outputGuardHits!==0||m.peakDbfs>=0||m.fullRenderPeakDbfs>=0;}
function safetySummary(rows){
  const bad=rows.filter(unsafe);
  return {cellCount:rows.length,unsafeCellCount:bad.length,guardHitTotal:rows.reduce((sum,row)=>sum+(metrics(row).outputGuardHits||0),0),
    worstPeakDbfs:Math.max(...rows.map(row=>metrics(row).fullRenderPeakDbfs)),
    firstUnsafeVelocity:bad.length?(bad[0].cell?.velocity??bad[0].cell?.velocityNormalized??bad[0].velocity??bad[0].velocityNormalized):null,
    lastUnsafeVelocity:bad.length?(bad.at(-1).cell?.velocity??bad.at(-1).cell?.velocityNormalized??bad.at(-1).velocity??bad.at(-1).velocityNormalized):null,
    unsafeCells:bad.map(row=>row.cell?`${row.cell.kind}:mask-${row.cell.stage3cMask}:midi-${String(row.cell.pitch).padStart(3,'0')}:${row.cell.velocity??row.cell.velocityNormalized}`:
      `mask-${row.stage3bMask}:midi-${String(row.pitch).padStart(3,'0')}:${row.velocity??row.velocityNormalized}`)};
}
function classifySafety(bySplit,fullI){
  const c=Object.entries(bySplit).some(([key,row])=>key.startsWith('mask-1:')&&row.unsafeCellCount>0);
  const b=Object.entries(bySplit).some(([key,row])=>key.startsWith('mask-2:')&&row.unsafeCellCount>0);
  const i=Object.values(fullI).some(row=>row.unsafeCellCount>0);
  return c&&b?'BOTH':c?'CONTACT':b?'BRIDGE':i?'INTERACTION':'NONE';
}
function findStage3a(cell,baseline,supplement){
  if(cell.velocity===null){
    const row=supplement.rows.find(item=>item.pitch===cell.pitch&&Math.abs(item.velocityNormalized-cell.velocityNormalized)<1e-12);
    if(!row)throw new Error(`Stage3A supplement coordinate missing ${cell.pitch}:${cell.velocityNormalized}`);return row;
  }
  const row=baseline.get(`${cell.pitch}:${cell.velocity}`);
  if(!row)throw new Error(`Stage3A coordinate missing ${cell.pitch}:${cell.velocity}`);return row;
}
function findStage3b(cell,analysis){
  const row=analysis.diagnosticRows.find(item=>item.stage3bMask===1&&item.pitch===cell.pitch&&
    (cell.velocity===null?Math.abs(item.velocityNormalized-cell.velocityNormalized)<1e-12:item.velocity===cell.velocity));
  if(!row)throw new Error(`Stage3B mask1 coordinate missing ${cell.pitch}:${cell.velocity??cell.velocityNormalized}`);return row;
}
function findStage3c(cell,rows,mask){
  const row=rows.find(item=>item.cell.stage3cMask===mask&&item.cell.kind===cell.kind&&item.cell.pitch===cell.pitch&&
    (cell.velocity===null?item.cell.velocity===null&&Math.abs(item.cell.velocityNormalized-cell.velocityNormalized)<1e-12:item.cell.velocity===cell.velocity));
  if(!row)throw new Error(`Stage3C coordinate missing mask ${mask}, MIDI ${cell.pitch}, velocity ${cell.velocity??cell.velocityNormalized}`);return row;
}
function envelopeLevel(row){const value=metrics(row).envelopeDbfs?.[3];if(typeof value!=='number'||!Number.isFinite(value))throw new Error('required 80-200 ms envelope level missing');return value;}
function aggregateSpanTable(pitch,baseline,analysis,rows){
  const ref=analysis.spanTables.find(row=>row.pitch===pitch);if(!ref)throw new Error(`Stage3B span reference missing MIDI ${pitch}`);
  const coords=DYNAMIC_VELOCITIES.map(velocity=>({kind:'dynamic',pitch,velocity}));
  const m0rows=coords.map(cell=>findStage3a(cell,baseline,null));
  const maskRows=mask=>coords.map(cell=>findStage3c(cell,rows,mask));
  const stage3bRows=analysis.diagnosticRows.filter(row=>row.stage3bMask===1&&row.pitch===pitch);
  const referenceSpanDb=ref.spanByMask.M0.referenceSpanDb;
  const error=renderRows=>{const span=velocitySpan(renderRows);return {synthSpanDb:span,referenceSpanDb,signedSpanDifferenceDb:span-referenceSpanDb,absoluteSpanErrorDb:Math.abs(span-referenceSpanDb)};};
  const M0=error(m0rows),MC=error(maskRows(1)),MB=error(maskRows(2)),MI=error(stage3bRows);
  const f=factorial(M0.absoluteSpanErrorDb,MC.absoluteSpanErrorDb,MB.absoluteSpanErrorDb,MI.absoluteSpanErrorDb);
  return {pitch,stringCount:ref.stringCount,group:ref.group,spanByMask:{M0,MC,MB,MI},factorial:f,
    benefitOrigin:[51,54].includes(pitch)?benefitOrigin(f.C_improvement,f.B_improvement):undefined};
}
function source(cell,which,baseline,supplement,analysis,rows){
  if(which==='M0')return findStage3a(cell,baseline,supplement);
  if(which==='MI')return findStage3b(cell,analysis);
  return findStage3c(cell,rows,which==='MC'?1:2);
}
function flatten(row,name){
  const m=metrics(row);
  if(name==='bridge_b RMS')return m.soundboardDiagnostics?.signals?.bridge_b?.rms;
  if(name==='board_drive_b RMS')return m.soundboardDiagnostics?.signals?.board_drive_b?.rms;
  if(name==='post_radiation_l RMS')return m.soundboardDiagnostics?.signals?.post_radiation_l?.rms;
  if(name==='spectralCentroidHz'||name==='above2kPowerRatio')return m[name];
  return m.stage2mHammer?.[name];
}
function scalarAttribution(baseline,supplement,analysis,rows){
  const output={};
  for(const name of PATH_METRICS){
    const factors=[];
    for(const row of rows.filter(item=>item.cell.stage3cMask===1)){
      const cell=row.cell;
      const values=['M0','MC','MB','MI'].map(which=>flatten(source(cell,which,baseline,supplement,analysis,rows),name));
      if(values.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error(`path attribution metric missing: ${name}`);
      factors.push(factorial(...values));
    }
    output[name]={C_main:mean(factors.map(row=>row.C_main)),B_main:mean(factors.map(row=>row.B_main)),
      interaction:mean(factors.map(row=>row.interaction)),meanAbsoluteInteraction:mean(factors.map(row=>Math.abs(row.interaction))),cellCount:factors.length};
  }
  return output;
}
function trebleRows(baseline,supplement,analysis,rows){
  const out=[];
  for(const pitch of TREBLE_PITCHES)for(const velocity of TREBLE_VELOCITIES){
    const cell={kind:'treble',pitch,velocity};
    const referenceDbfs=analysis.trebleGuardrail.find(row=>row.pitch===pitch&&row.velocity===velocity)?.errors.M0.referenceDbfs;
    if(!Number.isFinite(referenceDbfs))throw new Error(`missing direct-level reference ${pitch}:${velocity}`);
    const direct=which=>envelopeLevel(source(cell,which,baseline,supplement,analysis,rows))-referenceDbfs;
    const f=factorial(direct('M0'),direct('MC'),direct('MB'),direct('MI'));
    const mc=findStage3c(cell,rows,1),mb=findStage3c(cell,rows,2);
    out.push({pitch,velocity,referenceDbfs,directLevelErrorDb:{M0:f.M0,MC:f.MC,MB:f.MB,MI:f.MI},factorial:f,
      safety:{MC:metrics(mc).finite===true&&metrics(mc).outputGuardHits===0&&metrics(mc).peakDbfs<0&&metrics(mc).fullRenderPeakDbfs<0,
        MB:metrics(mb).finite===true&&metrics(mb).outputGuardHits===0&&metrics(mb).peakDbfs<0&&metrics(mb).fullRenderPeakDbfs<0}});
  }
  return out;
}
function midi41Rows(baseline,supplement,analysis,rows){
  return MIDI41_NORMALIZED.map(velocityNormalized=>{
    const cell={kind:'midi41',pitch:41,velocity:null,velocityNormalized};
    const f=factorial(metrics(source(cell,'M0',baseline,supplement,analysis,rows)).velocityDerivative,
      metrics(source(cell,'MC',baseline,supplement,analysis,rows)).velocityDerivative,
      metrics(source(cell,'MB',baseline,supplement,analysis,rows)).velocityDerivative,
      metrics(source(cell,'MI',baseline,supplement,analysis,rows)).velocityDerivative);
    return {pitch:41,velocityNormalized,velocityDerivativeWindowMs:[30,180],derivatives:{M0:f.M0,MC:f.MC,MB:f.MB,MI:f.MI},factorial:f};
  });
}
function calculateAttribution(input){
  const {candidateId,stage3aBaseline,stage3aSupplement,stage3bAnalysis,stage3cRows,stage3bAggregateCount,
    equivalenceSha256,continuationLedgerSha256,accounting,identity}=input;
  if(!(stage3aBaseline instanceof Map)||!Array.isArray(stage3cRows)||stage3cRows.length!==286)throw new Error('invalid attribution input set');
  const analysis=stage3bAnalysis,spanTables=DYNAMIC_PITCHES.map(pitch=>aggregateSpanTable(pitch,stage3aBaseline,analysis,stage3cRows));
  const byMaskAndPitch={};
  for(const mask of [1,2])for(const pitch of [...DYNAMIC_PITCHES,...TREBLE_PITCHES,41]){
    const cells=stage3cRows.filter(row=>row.cell.stage3cMask===mask&&row.cell.pitch===pitch);
    if(cells.length)byMaskAndPitch[`mask-${mask}:midi-${pitch}`]=safetySummary(cells);
  }
  const fullI={};
  for(const pitch of [...DYNAMIC_PITCHES,...TREBLE_PITCHES,41]){
    const cells=analysis.diagnosticRows.filter(row=>row.stage3bMask===1&&row.pitch===pitch);
    if(cells.length)fullI[`midi-${pitch}`]=safetySummary(cells);
  }
  return {schemaVersion:1,decision:'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE',candidateId,identity,
    equivalenceSha256,accounting,safety:{safetyOrigin:classifySafety(byMaskAndPitch,fullI),byStage3cMaskAndPitch:byMaskAndPitch,fullIByPitch:fullI},
    dynamicSpan:{spanTables,subgroups:{twoString:spanTables.filter(row=>row.stringCount===2).map(row=>({pitch:row.pitch,C_improvement:row.factorial.C_improvement,B_improvement:row.factorial.B_improvement})),
      threeString:spanTables.filter(row=>row.stringCount===3).map(row=>({pitch:row.pitch,C_improvement:row.factorial.C_improvement,B_improvement:row.factorial.B_improvement}))},
      keyBenefitOrigins:Object.fromEntries(spanTables.filter(row=>row.benefitOrigin).map(row=>[String(row.pitch),row.benefitOrigin]))},
    trebleGuardrail:trebleRows(stage3aBaseline,stage3aSupplement,analysis,stage3cRows),midi41:midi41Rows(stage3aBaseline,stage3aSupplement,analysis,stage3cRows),
    pathAttribution:scalarAttribution(stage3aBaseline,stage3aSupplement,analysis,stage3cRows),stage3bAggregateCount,
    ledgerSha256:continuationLedgerSha256,productionCandidateDelta:0,stage4Renders:0};
}

module.exports={DYNAMIC_PITCHES,TREBLE_PITCHES,DYNAMIC_VELOCITIES,TREBLE_VELOCITIES,MIDI41_NORMALIZED,PATH_METRICS,
  factorial,benefitOrigin,velocitySpan,safetySummary,classifySafety,calculateAttribution};
