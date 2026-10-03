#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');

function usage(){throw new Error('Usage: compare-supersynth-reference.cjs --reference <salamander-metrics.json> --measured <supersynth-matrix.json> --output <summary.json>');}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){const k=argv[i];if(!['--reference','--measured','--output'].includes(k)||!argv[i+1])usage();out[k.slice(2)]=path.resolve(argv[++i]);}if(!out.reference||!out.measured||!out.output)usage();return out;}
function percentile(values,p){const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*p)]||0;}
function summarize(values){const abs=values.map(Math.abs);return{mean:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),medianAbs:percentile(abs,.5),p90Abs:percentile(abs,.9),maxAbs:Math.max(0,...abs)};}
function round(x){return Number(x.toFixed(6));}
function main(){
  const args=parseArgs(process.argv.slice(2));
  const reference=JSON.parse(fs.readFileSync(args.reference,'utf8'));
  const measured=JSON.parse(fs.readFileSync(args.measured,'utf8'));
  if(reference.schemaVersion!==3||reference.directCells?.length!==480)throw new Error('reference must be the hash-verified Salamander schema v3 fixture with 480 direct cells');
  if(measured.matrix?.length!==480)throw new Error('measured matrix must contain 480 pitch/velocity cases');
  const byKey=new Map(measured.matrix.map(c=>[`${c.pitch}:${c.velocity}`,c]));
  const peak=[],envelope=[],spectral=[],centroid=[],onset=[];
  for(const ref of reference.directCells){
    const got=byKey.get(`${ref.pitch}:${ref.velocity}`);if(!got)throw new Error(`measured matrix missing ${ref.pitch}:${ref.velocity}`);
    const rm=ref.metrics,gm=got.metrics;
    peak.push(gm.peakDbfs-rm.peakDbfs);
    onset.push(gm.onsetMs-rm.onsetMs);
    centroid.push(20*Math.log10(Math.max(gm.spectralCentroidHz,1)/Math.max(rm.spectralCentroidHz,1)));
    if(rm.envelopeDbfs?.length!==gm.envelopeDbfs?.length)throw new Error(`envelope window count mismatch at ${ref.pitch}:${ref.velocity}`);
    for(let i=0;i<rm.envelopeDbfs.length;i++)envelope.push(gm.envelopeDbfs[i]-rm.envelopeDbfs[i]);
    if(rm.spectralBandPowerRatios?.length!==64||gm.spectralBandPowerRatios?.length!==64)throw new Error(`spectral bands missing at ${ref.pitch}:${ref.velocity}`);
    for(let i=0;i<64;i++)spectral.push(10*Math.log10((gm.spectralBandPowerRatios[i]+1e-9)/(rm.spectralBandPowerRatios[i]+1e-9)));
  }
  const result={schemaVersion:1,reference:{archiveSha256:reference.source.archiveSha256,sampleCells:reference.directCells.length},measured:{sourceRevision:measured.render.sourceRevision,sourceTreeDirty:measured.render.sourceTreeDirty,sourcePluginSha256:measured.render.sourcePluginSha256,fitHeaderSha256:measured.render.fitHeaderSha256,wasmSha256:measured.render.wasmSha256,preset:measured.render.preset,parameterOverrides:measured.render.parameterOverrides},comparisons:{peakDbfs:peak.length?Object.fromEntries(Object.entries(summarize(peak)).map(([k,v])=>[k,round(v)])):null,envelopeDbfs:Object.fromEntries(Object.entries(summarize(envelope)).map(([k,v])=>[k,round(v)])),normalizedSpectralBandPowerDb:Object.fromEntries(Object.entries(summarize(spectral)).map(([k,v])=>[k,round(v)])),centroidRatioDb:Object.fromEntries(Object.entries(summarize(centroid)).map(([k,v])=>[k,round(v)])),onsetMs:Object.fromEntries(Object.entries(summarize(onset)).map(([k,v])=>[k,round(v)]))}};
  fs.mkdirSync(path.dirname(args.output),{recursive:true});const tmp=`${args.output}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(result,null,2)}\n`);fs.renameSync(tmp,args.output);console.log(JSON.stringify({output:args.output,cells:reference.directCells.length,peakP90Db:result.comparisons.peakDbfs.p90Abs,envelopeP90Db:result.comparisons.envelopeDbfs.p90Abs,spectrumBandP90Db:result.comparisons.normalizedSpectralBandPowerDb.p90Abs}));
}
if(require.main===module){try{main();}catch(error){console.error(`ERROR: ${error.stack||error.message}`);process.exitCode=1;}}
