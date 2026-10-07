#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../../../../../');
const DEFAULT_METRICS = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
const DEFAULT_DRY = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/reference/supersynth-v9-board-dry-matrix.json');
const DEFAULT_FIT = path.join(REPO, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-board-fit.json');
const DEFAULT_HEADER = path.join(REPO, 'wasm/plugins/dsp/super-synth/src/grand_physics_fit_v9.h');
const BAND_COUNT = 64, BAND_LOW_HZ = 40, BAND_HIGH_HZ = 16000, LONG_PITCHES = [21,24,27,30,33,36,39,42,45];

function usage() {
  return 'Usage: fit-salamander-board.cjs [--metrics <fixture.json>] [--dry-matrix <matrix.json>] [--measured <current-fit-matrix.json>] [--output <fit.json>] [--header <fit.h>]';
}

function parseArgs(argv) {
  const out = { metrics:DEFAULT_METRICS, 'dry-matrix':DEFAULT_DRY, measured:null, output:DEFAULT_FIT, header:DEFAULT_HEADER };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--metrics','--dry-matrix','--measured','--output','--header'].includes(key) || !argv[i + 1]) throw new Error(usage());
    out[key.slice(2)] = path.resolve(argv[++i]);
  }
  return out;
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function avg(xs) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function median(xs) { if(!xs.length)return NaN;const sorted=xs.slice().sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)/2)]; }
function round(x, places=6) { const p=10**places; return Math.round(x*p)/p; }
function zone(pitch) { return pitch < 48 ? 0 : pitch < 72 ? 1 : 2; }
function bandCenter(i) { return BAND_LOW_HZ * (BAND_HIGH_HZ/BAND_LOW_HZ)**((i+.5)/BAND_COUNT); }

function regressSlope(values, stepSeconds) {
  const points=values.map((value,i)=>[i*stepSeconds,value]).filter(([,v])=>Number.isFinite(v));
  if(points.length<3)return 0;
  const mx=avg(points.map(p=>p[0])),my=avg(points.map(p=>p[1]));
  let num=0,den=0;
  for(const [x,y] of points){num+=(x-mx)*(y-my);den+=(x-mx)*(x-mx);}
  return den>0?num/den:0;
}

function clusterLongitudinalCells(cells) {
  return LONG_PITCHES.map(pitch=>{
    const clusters=[];
    for(const cell of cells.filter(c=>c.pitch===pitch)){
      const hs=cell.metrics.lowRegisterNonHarmonicPeakHz||[];
      const amps=cell.metrics.lowRegisterNonHarmonicPeakAmplitudeRatio||[];
      const qs=cell.metrics.lowRegisterNonHarmonicPeakQ||[];
      for(let i=0;i<hs.length;i++){
        const f=hs[i],amp=Math.max(0,amps[i]||0),q=Math.max(2,qs[i]||8);
        let c=clusters.find(x=>Math.abs(x.frequency-f)<=Math.max(24,x.frequency*.03));
        if(!c){c={frequency:f,weight:0,weightedFrequency:0,weightedQ:0,count:0};clusters.push(c);}
        const w=Math.log1p(amp);c.weight+=w;c.weightedFrequency+=f*w;c.weightedQ+=q*w;c.count++;
      }
    }
    const selected=clusters.filter(c=>c.count>=2).sort((a,b)=>b.weight-a.weight).slice(0,2)
      .map(c=>({frequencyHz:c.weightedFrequency/c.weight,q:clamp(c.weightedQ/c.weight,2,80),gain:clamp(c.weight/(c.count+1),0,1),observations:c.count}));
    selected.sort((a,b)=>a.frequencyHz-b.frequencyHz);
    return {pitch,modes:selected};
  });
}

function fillMissingLongitudinal(rows) {
  const all=rows.map(row=>({pitch:row.pitch,modes:[...row.modes]}));
  for(let mode=0;mode<2;mode++)for(let i=0;i<all.length;i++){
    if(all[i].modes[mode])continue;
    const before=all.slice(0,i).reverse().find(x=>x.modes[mode]);
    const after=all.slice(i+1).find(x=>x.modes[mode]);
    if(!before&&!after)throw new Error(`reference has no measured longitudinal mode ${mode+1}`);
    const value=before&&after?{
      frequencyHz:before.modes[mode].frequencyHz+(after.modes[mode].frequencyHz-before.modes[mode].frequencyHz)*(all[i].pitch-before.pitch)/(after.pitch-before.pitch),
      q:avg([before.modes[mode].q,after.modes[mode].q]),gain:avg([before.modes[mode].gain,after.modes[mode].gain]),observations:0,
    }:before?.modes[mode]||after?.modes[mode];
    all[i].modes[mode]=value;
  }
  return all;
}

function fitBoard(reference, dry, measured=null) {
  if(reference.schemaVersion!==3 || reference.coverage?.directCells!==480 || reference.directCells?.length!==480) throw new Error('reference metrics must be the hash-verified 480-cell schema v3 fixture');
  if(!dry.render?.soundboardBypassed || dry.render?.preset!=='concert_grand') throw new Error('dry matrix must use the concert_grand preset with piano_soundboard_mix=0');
  const dryByKey=new Map(dry.matrix.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const measuredByKey=measured?new Map(measured.matrix.map(row=>[`${row.pitch}:${row.velocity}`,row])):null;
  if(measured&&measured.matrix?.length!==reference.directCells.length)throw new Error('measured fit matrix must have one cell for every direct reference cell');
  const perZone=Array.from({length:3},()=>Array.from({length:BAND_COUNT},()=>({ref:0,dry:0,count:0})));
  const levelDelta=Array.from({length:3},()=>[]),pans=Array.from({length:3},()=>[]),lowQ=[];
  let matched=0;
  for(const cell of reference.directCells){
    const row=dryByKey.get(`${cell.pitch}:${cell.velocity}`);
    if(!row)throw new Error(`dry matrix is missing ${cell.pitch}:${cell.velocity}`);
    const rb=cell.metrics.spectralBandPowerRatios,db=row.metrics.spectralBandPowerRatios;
    if(rb?.length!==BAND_COUNT||db?.length!==BAND_COUNT)throw new Error(`spectral band data missing for ${cell.pitch}:${cell.velocity}`);
    const z=zone(cell.pitch),acc=perZone[z];
    for(let b=0;b<BAND_COUNT;b++){acc[b].ref+=rb[b];acc[b].dry+=db[b];acc[b].count++;}
    const re=cell.metrics.envelopeDbfs?.[3],de=row.metrics.envelopeDbfs?.[3];
    if(Number.isFinite(re)&&Number.isFinite(de))levelDelta[z].push(re-de);
    if(Number.isFinite(cell.metrics.stereoPan))pans[z].push(cell.metrics.stereoPan);
    if(cell.metrics.inharmonicityB>=0)lowQ.push({pitch:cell.pitch,b:cell.metrics.inharmonicityB});
    matched++;
  }
  if(matched!==480||dry.matrix.length!==480)throw new Error(`expected 480 matched direct cells, got ${matched}/${dry.matrix.length}`);

  const zoneExcess=perZone.map(zoneRows=>zoneRows.map(x=>{
    const r=x.ref/Math.max(1,x.count),d=x.dry/Math.max(1,x.count);
    return Math.max(0,Math.sqrt((r+1e-8)/(d+1e-8))-1);
  }));
  const overall=Array.from({length:BAND_COUNT},(_,b)=>avg(zoneExcess.map(z=>z[b])));
  const smooth=overall.map((x,i)=>(overall[Math.max(0,i-1)]+2*x+overall[Math.min(BAND_COUNT-1,i+1)])/4);
  const candidates=[];
  for(let i=0;i<BAND_COUNT;i++)if(smooth[i]>=smooth[Math.max(0,i-1)]&&smooth[i]>=smooth[Math.min(BAND_COUNT-1,i+1)])candidates.push(i);
  candidates.sort((a,b)=>smooth[b]-smooth[a]);
  const chosen=[];
  for(const i of candidates)if(chosen.length<24&&chosen.every(j=>Math.abs(i-j)>=2))chosen.push(i);
  for(let i=0;i<BAND_COUNT&&chosen.length<24;i++)if(!chosen.includes(i))chosen.push(i);
  chosen.sort((a,b)=>a-b);

  const zonePan=pans.map(xs=>clamp(avg(xs),-.8,.8));
  const modes=chosen.map(b=>{
    const peak=smooth[b];let left=b,right=b;
    while(left>0&&smooth[left-1]>=peak*.5)left--;
    while(right<BAND_COUNT-1&&smooth[right+1]>=peak*.5)right++;
    const hz=bandCenter(b),width=Math.max(bandCenter(right)-bandCenter(left),hz*.06);
    const excess=zoneExcess.map(z=>z[b]),sum=excess.reduce((a,x)=>a+x,0);
    const coupling=sum>1e-9?excess.map(x=>x/sum):[1/3,1/3,1/3];
    const gain=clamp(peak/(1+peak),0,.88);
    const pan=clamp(coupling.reduce((a,x,i)=>a+x*zonePan[i],0),-.8,.8);
    return {frequencyHz:round(hz,3),q:round(clamp(hz/width,2,64),4),gain:round(gain,7),zoneCoupling:coupling.map(x=>round(x,7)),pan:round(pan,6),fitBand:b};
  });
  const residualAlpha=[],residualGain=[],feedbackScale=[];
  for(let z=0;z<3;z++){
    const rows=reference.directCells.filter(c=>zone(c.pitch)===z);
    const slopes=rows.map(c=>regressSlope(c.metrics.envelope20msDbfs||[],.02)).filter(s=>s<-.01);
    if(!slopes.length)throw new Error(`reference zone ${z} has no measurable decay slopes`);
    const zoneTau=clamp(median(slopes.map(s=>8.686/(-s))),.002,2);
    residualAlpha.push(round(clamp(1-Math.exp(-1/(zoneTau*48000)),.00002,.01),9));
    const gainDelta=10**(median(levelDelta[z])/20)-1;
    residualGain.push(round(clamp(gainDelta/(1+Math.max(0,gainDelta)),0,.8),7));
    const meanExcess=avg(zoneExcess[z]);
    feedbackScale.push(round(clamp(meanExcess/(1+meanExcess)*.04,0,.04),8));
  }
  let radiationScale=1,radiationScaleRequested=1,radiationScaleHeadroom=1,radiationScaleCurrent=1,maxMeasuredPeakDbfs=null;
  if(measured){
    radiationScaleCurrent=Number(measured.render?.boardRadiationScale??1);
    if(!Number.isFinite(radiationScaleCurrent)||radiationScaleCurrent<=0)throw new Error('measured matrix has an invalid current board radiation scale');
    const corrections=reference.directCells.map(cell=>{
    const row=measuredByKey.get(`${cell.pitch}:${cell.velocity}`);
    if(!row)throw new Error(`measured fit matrix is missing ${cell.pitch}:${cell.velocity}`);
    if(Number(row.metrics.outputGuardHits)>0)throw new Error(`measured fit matrix hit the final output guard at ${cell.pitch}:${cell.velocity}`);
    return cell.metrics.peakDbfs-row.metrics.peakDbfs;
    });
    maxMeasuredPeakDbfs=Math.max(...measured.matrix.map(row=>row.metrics.peakDbfs));
    radiationScaleRequested=radiationScaleCurrent*10**(median(corrections)/20);
    radiationScaleHeadroom=radiationScaleCurrent*10**((-.5-maxMeasuredPeakDbfs)/20);
    radiationScale=clamp(Math.min(radiationScaleRequested,radiationScaleHeadroom),.001,100);
  }

  const pitchList=reference.coverage.pitches;
  const stringB=pitchList.map(p=>{
    const xs=reference.directCells.filter(c=>c.pitch===p).map(c=>c.metrics.inharmonicityB).filter(Number.isFinite);
    if(!xs.length)throw new Error(`reference has no inharmonicity observations for MIDI ${p}`);
    return round(clamp(median(xs),0,.02),8);
  });
  const longRows=fillMissingLongitudinal(clusterLongitudinalCells(reference.directCells));
  const decayTaus=[];
  for(const c of reference.directCells){
    const slope=regressSlope(c.metrics.envelope20msDbfs||[],.02);
    if(slope<-.05)decayTaus.push(8.686/(-slope));
  }
  if(!decayTaus.length)throw new Error('reference has no measurable decay slopes for sympathetic Q fitting');
  const tau=clamp(median(decayTaus),.03,1.5);
  const h2Power=avg(reference.directCells.map(c=>{
    const f0=440*2**((c.pitch-69)/12),i=Math.max(0,Math.min(BAND_COUNT-1,Math.floor(Math.log(f0*2/BAND_LOW_HZ)/Math.log(BAND_HIGH_HZ/BAND_LOW_HZ)*BAND_COUNT)));
    return c.metrics.spectralBandPowerRatios[i]||0;
  }));
  const h3Power=avg(reference.directCells.map(c=>{
    const f0=440*2**((c.pitch-69)/12),i=Math.max(0,Math.min(BAND_COUNT-1,Math.floor(Math.log(f0*3/BAND_LOW_HZ)/Math.log(BAND_HIGH_HZ/BAND_LOW_HZ)*BAND_COUNT)));
    return c.metrics.spectralBandPowerRatios[i]||0;
  }));
  const sympQ=[clamp(Math.PI*440*tau,4,220),clamp(Math.PI*660*tau,4,220)];
  const sympDampedQ=sympQ.map(q=>Math.max(1.5,Math.sqrt(q)));
  const fit={
    schemaVersion:1,
    method:'deterministic positive-gain log-band transfer fit; effective bridge-to-radiation proxy only',
    reference:{archiveSha256:reference.source.archiveSha256,sfzSha256:reference.source.sfzSha256,fileHashesManifest:reference.source.fileHashesManifest,metricSchemaVersion:reference.schemaVersion},
    dryMatrix:{matchedCells:matched,sourceRevision:dry.render.sourceRevision||'not-recorded',sourceTreeDirty:dry.render.sourceTreeDirty??null,sourcePluginSha256:dry.render.sourcePluginSha256||null,fitHeaderSha256:dry.render.fitHeaderSha256||null,wasmSha256:dry.render.wasmSha256||null,soundboardBypassed:true,preset:dry.render.preset},
    fitConstraints:{modes:24,bands:BAND_COUNT,frequencyRangeHz:[BAND_LOW_HZ,BAND_HIGH_HZ],nonNegativeRadiationGain:true,maximumModeGain:.88,stringInharmonicityBRange:[0,.02],peakHeadroomDbfs:-.5,radiationScaleFit:measured?'median peak level ratio limited by measured output headroom':'bootstrap'},
    board:{modes,zonePan:zonePan.map(x=>round(x,6)),residualAlpha,residualGain,feedbackScale,radiationScale:round(radiationScale,7),radiationScaleRequested:round(radiationScaleRequested,7),radiationScaleHeadroomLimit:round(radiationScaleHeadroom,7),radiationScaleCurrent:round(radiationScaleCurrent,7),maxMeasuredPeakDbfs:maxMeasuredPeakDbfs===null?null:round(maxMeasuredPeakDbfs,6)},
    stringInharmonicity:{pitches:pitchList,b: stringB},
    sympathetic:{qUndamped:sympQ.map(x=>round(x,5)),qDamped:sympDampedQ.map(x=>round(x,5)),gain:[round(Math.sqrt(h2Power),7),round(Math.sqrt(h3Power),7)],dampedGain:sympQ.map((q,i)=>round(sympDampedQ[i]/q,8)),excitationGain:round(Math.sqrt(h2Power+h3Power),7),returnGain:round(avg(feedbackScale),8)},
    longitudinal:{pitches:longRows.map(row=>row.pitch),modes:longRows.map(row=>row.modes.map(m=>({frequencyHz:round(m.frequencyHz,4),q:round(m.q,4),gain:round(m.gain,7),observations:m.observations})))},
  };
  return fit;
}

function f(value) { return `${Number(value).toFixed(9)}f`; }
function cArray(name, values, align=true) {
  const suffix=align?' __attribute__((aligned(16)))':'';
  return `static const float ${name}[${values.length}]${suffix} = { ${values.map(f).join(', ')} };`;
}
function cMatrix(name, rows) {
  return `static const float ${name}[${rows.length}][${rows[0].length}] __attribute__((aligned(16))) = {\n${rows.map(row=>`  { ${row.map(f).join(', ')} }`).join(',\n')}\n};`;
}
function makeHeader(fit) {
  const modes=fit.board.modes;
  const arrays=[
    cArray('GRAND_FIT_PITCHES',fit.stringInharmonicity.pitches),
    cArray('GRAND_FIT_STRING_INHARMONICITY_B',fit.stringInharmonicity.b),
    cArray('GRAND_FIT_BOARD_FREQ_HZ',modes.map(x=>x.frequencyHz)),
    cArray('GRAND_FIT_BOARD_Q',modes.map(x=>x.q)),
    cArray('GRAND_FIT_BOARD_GAIN',modes.map(x=>x.gain)),
    cArray('GRAND_FIT_BOARD_PAN',modes.map(x=>x.pan)),
    cArray('GRAND_FIT_BOARD_ZONE_B',modes.map(x=>x.zoneCoupling[0])),
    cArray('GRAND_FIT_BOARD_ZONE_M',modes.map(x=>x.zoneCoupling[1])),
    cArray('GRAND_FIT_BOARD_ZONE_T',modes.map(x=>x.zoneCoupling[2])),
    cArray('GRAND_FIT_BOARD_FEEDBACK_B',modes.map(x=>x.gain*x.zoneCoupling[0]*.015)),
    cArray('GRAND_FIT_BOARD_FEEDBACK_M',modes.map(x=>x.gain*x.zoneCoupling[1]*.015)),
    cArray('GRAND_FIT_BOARD_FEEDBACK_T',modes.map(x=>x.gain*x.zoneCoupling[2]*.015)),
    cArray('GRAND_FIT_BOARD_ZONE_PAN',fit.board.zonePan),
    cArray('GRAND_FIT_BOARD_RESIDUAL_ALPHA',fit.board.residualAlpha),
    cArray('GRAND_FIT_BOARD_RESIDUAL_GAIN',fit.board.residualGain),
    cArray('GRAND_FIT_BOARD_FEEDBACK_SCALE',fit.board.feedbackScale),
    cArray('GRAND_FIT_SYMP_Q_UNDAMPED',fit.sympathetic.qUndamped,false),
    cArray('GRAND_FIT_SYMP_Q_DAMPED',fit.sympathetic.qDamped,false),
    cArray('GRAND_FIT_SYMP_GAIN',fit.sympathetic.gain,false),
    cArray('GRAND_FIT_SYMP_DAMPED_GAIN',fit.sympathetic.dampedGain,false),
    cMatrix('GRAND_FIT_LONG_FREQ_HZ',fit.longitudinal.modes.map(row=>row.map(x=>x.frequencyHz))),
    cMatrix('GRAND_FIT_LONG_Q',fit.longitudinal.modes.map(row=>row.map(x=>x.q))),
    cMatrix('GRAND_FIT_LONG_GAIN',fit.longitudinal.modes.map(row=>row.map(x=>x.gain))),
    cArray('GRAND_FIT_LONG_PITCH',fit.longitudinal.pitches),
  ];
  return `#ifndef SORAOTO_SUPERSYNTH_GRAND_PHYSICS_FIT_V9_H\n#define SORAOTO_SUPERSYNTH_GRAND_PHYSICS_FIT_V9_H\n\n#define GRAND_FIT_PITCH_COUNT ${fit.stringInharmonicity.pitches.length}\n#define GRAND_FIT_LONG_PITCH_COUNT ${fit.longitudinal.pitches.length}\n#define GRAND_FIT_BOARD_RADIATION_SCALE ${f(fit.board.radiationScale)}\n#define GRAND_FIT_SYMP_EXCITATION_GAIN ${f(fit.sympathetic.excitationGain)}\n#define GRAND_FIT_SYMP_RETURN_GAIN ${f(fit.sympathetic.returnGain)}\n\n${arrays.join('\n\n')}\n\n#endif\n`;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.tmp-${process.pid}`;fs.writeFileSync(temp,text);fs.renameSync(temp,file);
}

function main() {
  const args=parseArgs(process.argv.slice(2));
  const reference=JSON.parse(fs.readFileSync(args.metrics,'utf8'));
  const dry=JSON.parse(fs.readFileSync(args['dry-matrix'],'utf8'));
  const measured=args.measured?JSON.parse(fs.readFileSync(args.measured,'utf8')):null;
  const fit=fitBoard(reference,dry,measured);
  writeAtomic(args.output,`${JSON.stringify(fit,null,2)}\n`);
  writeAtomic(args.header,makeHeader(fit));
  console.log(JSON.stringify({fit:args.output,header:args.header,matchedCells:fit.dryMatrix.matchedCells,boardModes:fit.board.modes.length,longitudinalPitches:fit.longitudinal.pitches.length,archiveSha256:fit.reference.archiveSha256}));
}

try { main(); }
catch (error) { console.error(`ERROR: ${error.stack||error.message}`); process.exitCode=1; }

module.exports={fitBoard,makeHeader};
