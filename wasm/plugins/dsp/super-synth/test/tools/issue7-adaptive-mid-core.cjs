'use strict';

const OFFICIAL_VELOCITIES=Object.freeze([14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124]);
const SCREEN_VELOCITIES=Object.freeze([14,61,124]);
const PITCHES=Object.freeze([48,51,54,57]);
const LOW=0.35;
const BASS_HARDNESS=0.5;
const LIMIT_DB=8;
const KNOWN_FAIL_MID=0.6;
const DOWNWARD_GRID=Object.freeze([0.5,0.45,0.4,0.35]);
const MAX_PROBES=7;
const MAX_PROBE_CALLS=112;
const MAX_SCREEN_CALLS=24;
const MAX_FULL_CALLS=128;
const MAX_EXTENSION_CALLS=264;
const MAX_STAGE3E_CALLS=2499;
const MAX_STAGE3_CALLS=486;
const MAX_STAGE4_CALLS=1423;
const MAX_TOTAL_CALLS=4408;
const ISSUE7_GLOBAL_CAP=4464;

function fixedMid(value){
  if(!Number.isFinite(value)||value<0.35||value>0.6)throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: mid value is outside the approved search range');
  const ticks=Math.round(value*10000);
  if(Math.abs(ticks/10000-value)>1e-9)throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: mid value has more than four decimal places');
  return ticks/10000;
}
function midpoint(a,b){
  const left=Math.round(fixedMid(a)*10000),right=Math.round(fixedMid(b)*10000);
  const ticks=Math.round((left+right)/2);
  return fixedMid(ticks/10000);
}
function normalizeProbeHistory(history){
  if(!Array.isArray(history))throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: probe history must be an array');
  const seen=new Set();
  return history.map((item,index)=>{
    const mid=fixedMid(item?.mid),key=mid.toFixed(4);
    if(seen.has(key))throw new Error(`BLOCKED_ADAPTIVE_MID_PLAN: duplicate probe ${key}`);
    seen.add(key);
    if(item.safe!==true||item.diagnosticsComplete!==true||!Number.isFinite(item.spanErrorDb))
      throw new Error(`BLOCKED_ADAPTIVE_MID_UNSAFE: probe ${key} is unsafe, incomplete, or non-finite`);
    const expected=item.spanErrorDb<=LIMIT_DB?'PASS':'FAIL';
    if(item.outcome!==undefined&&item.outcome!==expected)
      throw new Error(`BLOCKED_ADAPTIVE_MID_PLAN: probe ${key} outcome disagrees with the fixed ${LIMIT_DB} dB gate`);
    if(index===0&&mid!==0.55)throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: first probe must be mid=0.55');
    return {...item,mid,outcome:expected,kind:item.kind|| (index===0||DOWNWARD_GRID.includes(mid)?'grid':'bisection')};
  });
}
function probeResult(history){
  const rows=normalizeProbeHistory(history);
  const passing=rows.filter(row=>row.outcome==='PASS');
  return passing.sort((a,b)=>b.mid-a.mid||Math.abs(a.spanErrorDb)-Math.abs(b.spanErrorDb));
}
function nextProbe(history){
  const rows=normalizeProbeHistory(history);
  if(!rows.length)return {done:false,mid:0.55,kind:'grid',ordinal:1};
  if(rows.length>MAX_PROBES)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: more than seven probes were recorded');
  const mids=new Set(rows.map(row=>row.mid.toFixed(4)));
  const passing=rows.filter(row=>row.outcome==='PASS');
  const bisections=rows.filter(row=>row.kind==='bisection').length;
  if(!passing.length){
    if(rows[0].outcome==='PASS')throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: passing probe history was lost');
    for(const mid of DOWNWARD_GRID){
      const key=mid.toFixed(4);
      if(!mids.has(key))return {done:false,mid,kind:'grid',ordinal:rows.length+1};
      const row=rows.find(item=>item.mid.toFixed(4)===key);
      if(row.outcome==='PASS')break;
    }
    if(rows.every(row=>row.outcome==='FAIL'))return {done:true,decision:'BLOCKED_NO_FEASIBLE_MID_RESPONSE',passingCandidates:[]};
  }
  if(bisections>=2){
    const candidates=probeResult(rows).slice(0,2);
    return {done:true,decision:candidates.length?'ADAPTIVE_MID_PROBES_COMPLETE':'BLOCKED_NO_FEASIBLE_MID_RESPONSE',passingCandidates:candidates};
  }
  const best=passing.reduce((a,b)=>b.mid>a.mid?b:a);
  const failingAbove=rows.filter(row=>row.outcome==='FAIL'&&row.mid>best.mid).sort((a,b)=>a.mid-b.mid)[0];
  const failMid=failingAbove?.mid??(best.mid<KNOWN_FAIL_MID?KNOWN_FAIL_MID:null);
  if(failMid===null)return {done:true,decision:'ADAPTIVE_MID_PROBES_COMPLETE',passingCandidates:probeResult(rows).slice(0,2)};
  const mid=midpoint(best.mid,failMid),key=mid.toFixed(4);
  if(mids.has(key))throw new Error(`BLOCKED_ADAPTIVE_MID_PLAN: bisection would repeat ${key}`);
  return {done:false,mid,kind:'bisection',ordinal:rows.length+1,bracket:{pass:best.mid,fail:failMid}};
}
function probeCells(mid){
  const value=fixedMid(mid),token=value.toFixed(4).replace('.','p');
  return OFFICIAL_VELOCITIES.map(velocity=>({phase:'adaptive-mid-01-probe',kind:'probe',buildRole:'stage3e',
    pitch:51,velocity,velocityNormalized:velocity/127,includeSoundboardDiagnostics:true,
    candidate:{low:LOW,mid:value,bassHardness:BASS_HARDNESS},response:{low:LOW,mid:value,bassHardness:BASS_HARDNESS},
    key:`adaptive-mid-01-probe-m${token}-51-v${String(velocity).padStart(3,'0')}`}));
}
function screenCells(candidates){
  if(!Array.isArray(candidates)||candidates.length<1||candidates.length>2)throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: screen is bounded to the top two passing probes');
  return candidates.flatMap(candidate=>PITCHES.flatMap(pitch=>SCREEN_VELOCITIES.map(velocity=>({phase:'adaptive-mid-01-screen',kind:'screen',
    buildRole:'stage3e',pitch,velocity,velocityNormalized:velocity/127,candidate:{low:LOW,mid:fixedMid(candidate.mid),bassHardness:BASS_HARDNESS},
    response:{low:LOW,mid:fixedMid(candidate.mid),bassHardness:BASS_HARDNESS},
    key:`adaptive-mid-01-screen-m${fixedMid(candidate.mid).toFixed(4).replace('.','p')}-${pitch}-v${velocity}`}))));
}
function fullCells(candidate){
  if(!candidate||!Number.isFinite(candidate.mid))throw new Error('BLOCKED_ADAPTIVE_MID_PLAN: full candidate is missing');
  const mid=fixedMid(candidate.mid),token=mid.toFixed(4).replace('.','p');
  return PITCHES.flatMap(pitch=>OFFICIAL_VELOCITIES.map(velocity=>({phase:'adaptive-mid-01-full',kind:'full',buildRole:'stage3e',
    pitch,velocity,velocityNormalized:velocity/127,candidate:{low:LOW,mid,bassHardness:BASS_HARDNESS},
    response:{low:LOW,mid,bassHardness:BASS_HARDNESS},key:`adaptive-mid-01-full-m${token}-${pitch}-v${velocity}`})));
}
function rankScreenCandidates(candidates){
  const ranked=[];
  for(const candidate of candidates||[]){
    const errors=candidate?.spanErrorsByPitch;
    if(candidate?.safetyPass!==true||!errors||!PITCHES.every(pitch=>Array.isArray(errors[pitch])&&errors[pitch].length===3&&errors[pitch].every(Number.isFinite)))continue;
    const values=PITCHES.flatMap(pitch=>errors[pitch]);
    ranked.push({...candidate,rankMaxError:Math.max(...values.map(Math.abs)),rankSumSquares:values.reduce((sum,value)=>sum+value*value,0)});
  }
  return ranked.sort((a,b)=>a.rankMaxError-b.rankMaxError||a.rankSumSquares-b.rankSumSquares||b.mid-a.mid);
}
function countCalls(ledger){
  const cells=Object.values(ledger?.cells||{});
  const started=cells.filter(cell=>cell.state==='IN_PROGRESS'||cell.state==='COMPLETE'||cell.state==='AMBIGUOUS');
  return {
    probes:started.filter(cell=>cell.kind==='probe').length,
    screen:started.filter(cell=>cell.kind==='screen').length,
    full:started.filter(cell=>cell.kind==='full').length,
    total:started.length
  };
}
function assertBudget({parentCount=2235,extension,stage3Count=0,stage4Count=0}={}){
  const ext=typeof extension==='number'?{total:extension}:extension||{total:0,probes:0,screen:0,full:0};
  if((ext.probes||0)>MAX_PROBE_CALLS||(ext.screen||0)>MAX_SCREEN_CALLS||(ext.full||0)>MAX_FULL_CALLS||(ext.total||0)>MAX_EXTENSION_CALLS)
    throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: extension allocation exceeded');
  if(parentCount+(ext.total||0)>MAX_STAGE3E_CALLS)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: Stage3E cap exceeded');
  if(stage3Count>MAX_STAGE3_CALLS||stage4Count>MAX_STAGE4_CALLS)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: downstream stage cap exceeded');
  const total=parentCount+(ext.total||0)+stage3Count+stage4Count;
  if(total>MAX_TOTAL_CALLS||total>ISSUE7_GLOBAL_CAP)throw new Error('BLOCKED_ADAPTIVE_MID_BUDGET: total call cap exceeded');
  return {parentCount,extensionCount:ext.total||0,stage3Count,stage4Count,total,remainingGlobal:ISSUE7_GLOBAL_CAP-total};
}

module.exports={OFFICIAL_VELOCITIES,SCREEN_VELOCITIES,PITCHES,LOW,BASS_HARDNESS,LIMIT_DB,KNOWN_FAIL_MID,DOWNWARD_GRID,
  MAX_PROBES,MAX_PROBE_CALLS,MAX_SCREEN_CALLS,MAX_FULL_CALLS,MAX_EXTENSION_CALLS,MAX_STAGE3E_CALLS,MAX_STAGE3_CALLS,
  MAX_STAGE4_CALLS,MAX_TOTAL_CALLS,ISSUE7_GLOBAL_CAP,fixedMid,midpoint,normalizeProbeHistory,probeResult,nextProbe,
  probeCells,screenCells,fullCells,rankScreenCandidates,countCalls,assertBudget};
