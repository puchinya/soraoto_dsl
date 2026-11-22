#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {render}=require('./capture-supersynth-matrix.cjs');
const {REPO}=require('../tuning/candidate-overlay.cjs');

function rms(values){let sum=0;for(const value of values)sum+=value*value;return Math.sqrt(sum/Math.max(1,values.length));}
function diffRms(a,b){if(a.length!==b.length)throw new Error('audio lengths differ');let sum=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];sum+=d*d;}return Math.sqrt(sum/Math.max(1,a.length));}
function correlation(a,b){
  if(a.length!==b.length)throw new Error('correlation vectors differ in length');
  const mean=x=>x.reduce((sum,value)=>sum+value,0)/Math.max(1,x.length);
  const ma=mean(a),mb=mean(b);let cov=0,va=0,vb=0;
  for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;cov+=x*y;va+=x*x;vb+=y*y;}
  return cov/Math.sqrt(Math.max(1e-24,va*vb));
}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function report(){
  const fitPath=path.join(REPO,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-board-fit.json');
  const presetPath=path.join(REPO,'wasm/plugins/dsp/super-synth/presets.json');
  const generatedPath=path.join(REPO,'wasm/shared/generated/super-synth_grand_profiles.h');
  const fit=JSON.parse(fs.readFileSync(fitPath,'utf8'));
  const preset=JSON.parse(fs.readFileSync(presetPath,'utf8')).concert_grand;
  const header=fs.readFileSync(generatedPath,'utf8');
  const headerScale=Number(header.match(/\.radiation_scale\s*=\s*([0-9.eE+-]+)f/)[1]);
  const candidateFile=path.join(REPO,'.agent-state/issues/7/calibration-optuna/gpsampler-split/runs/stage2-20260928T133429Z/candidates/split-v3-s2-0016.json');
  const candidate=JSON.parse(fs.readFileSync(candidateFile,'utf8'));
  const {deriveCandidate}=require('../tuning/candidate-overlay.cjs');
  const overlay=deriveCandidate(candidate.parameters).preset.engine_config.soundboard.radiation_scale;
  const sourceScale=preset.engine_config.soundboard.radiation_scale;
  const fitScale=fit.board?.radiationScale;
  if(!Number.isFinite(fitScale))throw new Error('could not locate authoritative fitted radiationScale in fit JSON');
  const identity={sourceScale,overlayScale:overlay,headerScale,fitScale,
    sourceMatchesOverlay:sourceScale===overlay,sourceMatchesHeader:sourceScale===headerScale,
    sourceMatchesFit:sourceScale===fitScale,fitSha256:sha(fitPath),presetSha256:sha(presetPath),generatedHeaderSha256:sha(generatedPath)};
  if(!identity.sourceMatchesOverlay||!identity.sourceMatchesHeader||!identity.sourceMatchesFit)throw new Error(`soundboard source mismatch: ${JSON.stringify(identity)}`);

  const sample=(parameters)=>render(60,85,parameters,{includeSoundboardDiagnostics:true,returnSamples:true});
  const mix0=sample({piano_soundboard_mix:0});
  const mix062=sample({piano_soundboard_mix:.62});
  const mix005=sample({piano_soundboard_mix:.05});
  const mix090=sample({piano_soundboard_mix:.90});
  const size005=sample({piano_soundboard_mix:.62,piano_soundboard_size:.05});
  const size095=sample({piano_soundboard_mix:.62,piano_soundboard_size:.95});
  const baselineRms=Math.sqrt((rms(mix0.left)**2+rms(mix0.right)**2)/2);
  const boardContributionL=mix062.left.map((value,index)=>value-mix0.left[index]);
  const boardContributionR=mix062.right.map((value,index)=>value-mix0.right[index]);
  const boardContributionRms=Math.sqrt((rms(boardContributionL)**2+rms(boardContributionR)**2)/2);
  const dryStereo=[...mix0.left,...mix0.right];
  const boardStereo=[...boardContributionL,...boardContributionR];
  const signal=diag=>diag.metrics.soundboardDiagnostics.signals;
  const summary={schemaVersion:1,preset:'concert_grand',pitch:60,velocity:85,durationMs:380,
    productionSimd:true,diagnosticBuild:true,fitIdentity:identity,
    mixZeroVsPoint62:{outputDifferenceRms:diffRms(mix0.left,mix062.left),
      stereoOutputDifferenceRms:Math.sqrt((diffRms(mix0.left,mix062.left)**2+diffRms(mix0.right,mix062.right)**2)/2),
      normalizedDifference:boardContributionRms/Math.max(1e-12,baselineRms),
      dryRms:baselineRms,boardContributionRms, dryBoardCorrelation:correlation(dryStereo,boardStereo),
      mix0:signal(mix0),mix062:signal(mix062)},
    mixPoint005VsPoint90:{stereoOutputDifferenceRms:Math.sqrt((diffRms(mix005.left,mix090.left)**2+diffRms(mix005.right,mix090.right)**2)/2),
      mix005:signal(mix005),mix090:signal(mix090)},
    boardSizePoint05VsPoint95:{stereoOutputDifferenceRms:Math.sqrt((diffRms(size005.left,size095.left)**2+diffRms(size005.right,size095.right)**2)/2),
      size005:signal(size005),size095:signal(size095)},
    safety:{peakWorstDbfs:Math.max(...[mix0,mix062,mix005,mix090,size005,size095].map(item=>item.metrics.fullRenderPeakDbfs)),
      guardHits:[mix0,mix062,mix005,mix090,size005,size095].reduce((sum,item)=>sum+item.metrics.outputGuardHits,0),
      finite:[mix0,mix062,mix005,mix090,size005,size095].every(item=>item.metrics.finite)}};
  return summary;
}

try{const result=report();process.stdout.write(`${JSON.stringify(result,null,2)}\n`);}catch(error){process.stderr.write(`Soundboard diagnostic ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}
