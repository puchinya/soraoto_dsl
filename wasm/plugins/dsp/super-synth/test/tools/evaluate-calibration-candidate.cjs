#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {REPO,SPACE}=require('../tuning/candidate-overlay.cjs');
const {evaluate:screenCandidate,referenceFit}=require('./evaluate-qmc-candidate.cjs');
const {captureMatrix}=require('./capture-supersynth-matrix.cjs');

const FIXTURE_PATH=path.join(REPO,SPACE.screening.referenceFixture);
const PITCHES=[21,36,48,60,72,84,96,108];
const VELOCITIES=[14,61,124];
const SCREEN_PITCHES=SPACE.screening.pitches;
const SCREEN_VELOCITIES=SPACE.screening.velocities;

function parseArgs(argv){
  const result={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!['--candidate','--stage','--build-root','--output'].includes(key)||!argv[i+1])throw new Error('Usage: evaluate-calibration-candidate.cjs --candidate <candidate.json> --stage <1|2> --build-root <scratch-dir> --output <result.json>');
    result[key.slice(2)]=argv[++i];
  }
  if(!result.candidate||!['1','2'].includes(result.stage)||!result['build-root']||!result.output)throw new Error('candidate, stage, build-root, and output are required');
  return {candidate:path.resolve(result.candidate),stage:Number(result.stage),buildRoot:path.resolve(result['build-root']),output:path.resolve(result.output)};
}

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.tmp-${process.pid}`;fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`);fs.renameSync(temp,file);}
function sha256(data){return crypto.createHash('sha256').update(data).digest('hex');}
function maxAbs(values){return values.length?Math.max(...values.map(Math.abs)):null;}
function stageStatus(m){
  if(m.measurementInvalidCount>0)return 'MEASUREMENT_INVALID';
  const pitch=maxAbs(m.pitchErrorsCents);
  const sparse=m.harmonicSparsity;
  const failed=!m.finite||m.guardHits!==0||!(m.peakDbfs<0)||!(m.brightnessRatio>1.25)
    ||!(pitch!==null&&pitch<=15)||!(m.lowRegisterBuzz<0.12)
    ||!(sparse.h2ToH1>0.12)||!(sparse.h3ToH1>0.05);
  return failed?'FAIL':'PASS';
}

function compactStage1(screen){
  const metrics=screen.metrics;
  const pitchCells=metrics.cells.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,
    valid:Boolean(cell.metrics.pitchMeasurement?.measurement_valid),
    errorCents:cell.metrics.pitchMeasurement?.pitch_error_cents??null,
    result:cell.metrics.pitchMeasurement?.result??'MEASUREMENT_INVALID',
    boundaryHit:Boolean(cell.metrics.pitchMeasurement?.search_boundary_hit),
    windows:cell.metrics.pitchMeasurement?.window_results?.map(window=>({startMs:window.start_ms,endMs:window.end_ms,valid:window.measurement_valid,reason:window.reason}))??[]}));
  const harmonicSparsity=metrics.harmonicSparsity;
  const pitchCellsWithHardProbe=pitchCells.concat([{
    pitch:60,velocity:'0.90 probe',valid:Boolean(harmonicSparsity.pitchMeasurement?.measurement_valid),
    errorCents:harmonicSparsity.pitchMeasurement?.pitch_error_cents??null,
    result:harmonicSparsity.pitchMeasurement?.result??'MEASUREMENT_INVALID',
    boundaryHit:Boolean(harmonicSparsity.pitchMeasurement?.search_boundary_hit),
    windows:harmonicSparsity.pitchMeasurement?.window_results?.map(window=>({startMs:window.start_ms,endMs:window.end_ms,valid:window.measurement_valid,reason:window.reason}))??[]
  }]);
  const validPitchCells=pitchCellsWithHardProbe.filter(cell=>cell.valid);
  const errors=validPitchCells.map(cell=>cell.errorCents);
  const measurementInvalidCount=pitchCellsWithHardProbe.length-validPitchCells.length;
  const hard={
    referenceFitLoss:metrics.referenceFitLoss.value,
    brightnessRatio:metrics.brightness.ratio,
    brightnessMargin:metrics.brightness.marginAbove1_25,
    peakDbfs:metrics.peak.worstDbfs,
    peakHeadroomDb:metrics.peak.headroomDb,
    guardHits:metrics.guardHits,
    finite:metrics.finite,
    measurementInvalidCount,
    pitchErrorsCents:errors,
    pitchCells:pitchCellsWithHardProbe,
    boundaryHitCount:pitchCellsWithHardProbe.filter(cell=>cell.boundaryHit).length,
    lowRegisterBuzz:metrics.lowRegisterBuzz.value,
    harmonicSparsity:{h1:harmonicSparsity.h1,h2:harmonicSparsity.h2,h3:harmonicSparsity.h3,
      h2ToH1:harmonicSparsity.h2ToH1,h3ToH1:harmonicSparsity.h3ToH1,
      minimumH2ToH1:harmonicSparsity.minimumH2ToH1,minimumH3ToH1:harmonicSparsity.minimumH3ToH1},
    stageMeasurement:{pitchCells:SCREEN_PITCHES.length*SCREEN_VELOCITIES.length,hardC4Probe:1,
      noteOnFrame:0,noteOffFrame:null,sustainHeld:true,sympatheticEnabled:true}
  };
  return {metrics:hard,pitchCells:pitchCellsWithHardProbe};
}

function evaluateStage1(candidate,candidatePath,buildRoot,started){
  const screenPath=path.join(buildRoot,'qmc-stage1-result.json');
  const screen=screenCandidate(candidatePath,screenPath,buildRoot);
  const compact=compactStage1(screen);
  const result={schemaVersion:1,candidateId:candidate.candidateId,parameters:candidate.parameters,
    stageReached:1,sourceRevision:screen.sourceRevision,sourceDirty:screen.sourceDirty,
    sourceTreeSha256:screen.sourceTreeSha256,evaluatorSha256:screen.evaluatorSha256,
    configSha256:screen.configSha256,wasmSha256:screen.wasmSha256,productionSimd:true,
    elapsedSeconds:(performance.now()-started)/1000,metrics:compact.metrics,
    measurement:{invalidCount:compact.metrics.measurementInvalidCount,totalCount:compact.pitchCells.length},
    result:stageStatus(compact.metrics)};
  return result;
}

function evaluateStage2(candidate,buildRoot,stage1Path,started){
  const stage1=readJson(stage1Path);
  if(stage1.candidateId!==candidate.candidateId||JSON.stringify(stage1.parameters)!==JSON.stringify(candidate.parameters))throw new Error('Stage-1 candidate identity/parameters do not match Stage 2');
  const candidateConfig=readJson(path.join(buildRoot,'candidate.json'));
  if(candidateConfig.candidateId!==candidate.candidateId||candidateConfig.configSha256!==stage1.configSha256)throw new Error('Stage-1 candidate scratch configuration identity changed before Stage 2');
  const buildPath=path.join(buildRoot,'build');
  process.env.SORAOTO_WASM_BUILD_DIR=buildPath;
  const captured=captureMatrix({pitches:PITCHES,velocities:VELOCITIES,includePitchHealth:true,includeCalibrationDiagnostics:true,
    onProgress:(pitch,count)=>process.stderr.write(`${candidate.candidateId}: Stage-2 rendered MIDI ${pitch} (${count}/${PITCHES.length*VELOCITIES.length})\n`)});
  const fixture=readJson(FIXTURE_PATH);
  const pitchCells=captured.matrix.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,
    finite:cell.metrics.finite,peakDbfs:cell.metrics.fullRenderPeakDbfs,
    guardHits:cell.metrics.outputGuardHits,pitchMeasurement:cell.metrics.pitchMeasurement,
    pitchCapture:cell.metrics.pitchCapture}));
  const diagnostics=captured.diagnostics;
  const allMetrics=captured.matrix.map(row=>row.metrics).concat(Object.values(diagnostics.diagnosticRenders));
  const guardHits=allMetrics.reduce((sum,m)=>sum+(m.outputGuardHits||0),0);
  const peakDbfs=Math.max(...allMetrics.map(m=>m.fullRenderPeakDbfs??m.peakDbfs));
  const finite=allMetrics.every(m=>m.finite!==false&&Number.isFinite(m.fullRenderPeakDbfs??m.peakDbfs));
  const invalidPitchCount=pitchCells.filter(cell=>!cell.pitchMeasurement.measurement_valid).length;
  const probe=diagnostics.harmonicSparsity;
  const measurementInvalidCount=invalidPitchCount+(probe.pitchMeasurement.measurement_valid?0:1);
  const errors=pitchCells.filter(cell=>cell.pitchMeasurement.measurement_valid).map(cell=>cell.pitchMeasurement.pitch_error_cents);
  if(probe.pitchMeasurement.measurement_valid)errors.push(probe.pitchMeasurement.pitch_error_cents);
  const metrics={
    referenceFitLoss:referenceFit(captured.matrix,fixture).value,
    brightnessRatio:diagnostics.velocityBrightness.ratio,
    brightnessMargin:diagnostics.velocityBrightness.ratio-1.25,
    peakDbfs,peakHeadroomDb:-peakDbfs,guardHits,finite,
    measurementInvalidCount,invalidStage2PitchCells:invalidPitchCount,
    pitchErrorsCents:errors,pitchCells,
    boundaryHitCount:pitchCells.filter(cell=>cell.pitchMeasurement.search_boundary_hit).length+(probe.pitchMeasurement.search_boundary_hit?1:0),
    lowRegisterBuzz:diagnostics.lowRegisterBuzz.value,
    harmonicSparsity:{h1:probe.h1,h2:probe.h2,h3:probe.h3,h2ToH1:probe.h2ToH1,h3ToH1:probe.h3ToH1,minimumH2ToH1:probe.minimumH2ToH1,minimumH3ToH1:probe.minimumH3ToH1},
    stageMeasurement:{cells:pitchCells.length,pitches:PITCHES,velocities:VELOCITIES,hardC4Probe:1,
      noteOnFrame:0,noteOffFrame:null,sustainHeld:true,sympatheticEnabled:true,
      pitchWindowPolicy:captured.render.pitchWindowPolicy}
  };
  const result={schemaVersion:1,candidateId:candidate.candidateId,parameters:candidate.parameters,
    stageReached:2,sourceRevision:stage1.sourceRevision,sourceDirty:stage1.sourceDirty,
    sourceTreeSha256:stage1.sourceTreeSha256,evaluatorSha256:stage1.evaluatorSha256,
    configSha256:stage1.configSha256,wasmSha256:stage1.wasmSha256,productionSimd:true,
    stage1Result:stage1.result,stage1Metrics:stage1.metrics,
    elapsedSeconds:(performance.now()-started)/1000,metrics,
    measurement:{invalidCount:measurementInvalidCount,totalCount:pitchCells.length+1},
    result:stageStatus(metrics)};
  return result;
}

function main(){
  const args=parseArgs(process.argv.slice(2));
  const started=performance.now();
  const candidate=readJson(args.candidate);
  if(!/^[a-zA-Z0-9_-]+$/.test(candidate.candidateId||''))throw new Error('candidateId must contain only letters, digits, underscore, or hyphen');
  if(!candidate.parameters||typeof candidate.parameters!=='object')throw new Error('candidate.parameters is required');
  let result;
  if(args.stage===1)result=evaluateStage1(candidate,args.candidate,args.buildRoot,started);
  else{
    const stage1Path=path.join(args.buildRoot,'stage1-result.json');
    result=evaluateStage2(candidate,args.buildRoot,stage1Path,started);
  }
  writeJson(args.output,result);
  process.stdout.write(JSON.stringify({candidateId:result.candidateId,stageReached:result.stageReached,result:result.result,
    measurement:result.measurement,peakDbfs:result.metrics.peakDbfs,guardHits:result.metrics.guardHits,
    pitchWorstCents:maxAbs(result.metrics.pitchErrorsCents),brightness:result.metrics.brightnessRatio,
    lowRegisterBuzz:result.metrics.lowRegisterBuzz,referenceFitLoss:result.metrics.referenceFitLoss})+'\n');
}

try{main();}catch(error){process.stderr.write(`Calibration candidate evaluation ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}
