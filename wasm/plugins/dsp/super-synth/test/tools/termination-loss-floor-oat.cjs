#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {SPACE,PRESETS_PATH}=require('../tuning/candidate-overlay.cjs');
const {createCandidatePreset,encodePresets,configSha256}=require('./termination-loss-floor-overlay.cjs');
const {captureMatrix}=require('./capture-supersynth-matrix.cjs');
const {evaluateDirectReferenceMatrix,median}=require('./stage3-direct-reference-metrics.cjs');

const REPO=path.resolve(__dirname,'../../../../../../');
const CANDIDATE_PATH=path.join(REPO,'build/wasm/calibration/stage2d-velocity-hardness/stage2d-center-a-a000/candidate.json');
const STAGE1_PATH=path.join(path.dirname(CANDIDATE_PATH),'stage1-result.json');
const REFERENCE_PATH=path.join(REPO,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
const OAT_SCALES=[0,.25,.5,.75,1];
const VELOCITIES=[14,61,124];
const SAMPLE_ROOT=path.join(REPO,'.agent-state/issues/7/termination-loss-floor');
const OUTPUT_PATH=path.join(SAMPLE_ROOT,'oat-results.json');

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function hashTree(root){
  const files=[];
  function visit(directory,relative=''){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const full=path.join(directory,entry.name),rel=path.posix.join(relative,entry.name);
      if(entry.isDirectory())visit(full,rel);else if(entry.isFile())files.push([rel,fs.readFileSync(full)]);
    }
  }
  visit(root);const hash=crypto.createHash('sha256');
  for(const [rel,data] of files)hash.update(rel).update('\0').update(data).update('\0');
  return hash.digest('hex');
}
function writeJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`);fs.renameSync(temp,file);
}
function execLogged(args,outputPath,env=process.env){
  try{
    const output=execFileSync('rtk',args,{cwd:REPO,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
    fs.writeFileSync(outputPath,output);return {status:'PASS',output};
  }catch(error){
    const output=`${error.stdout?.toString?.()||''}\n${error.stderr?.toString?.()||''}`;
    fs.writeFileSync(outputPath,output);
    return {status:'FAIL',output,code:error.status??null};
  }
}
function pctl(values,p){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];
}
function cellKey(cell){return `${cell.pitch}:${cell.velocity}`;}
function isTreble(pitch){return pitch>=84;}
function region(pitch){return pitch<=48?'bass':pitch<=81?'mid':'treble';}

function runScale(scale,sourceTreeSha256,sourceRevision){
  const started=performance.now();
  const label=scale.toFixed(2);
  const candidateId=`termination-floor-s${label.replace('.','-')}`;
  const root=path.join(REPO,'build/wasm/calibration/termination-loss-floor-oat-v1',candidateId);
  const scratchSource=path.join(root,'source/wasm');
  const scratchBuild=path.join(root,'build');
  const scratchPresets=path.join(scratchSource,'plugins/dsp/super-synth/presets.json');
  const resultPath=path.join(SAMPLE_ROOT,`${candidateId}.json`);
  const candidate=JSON.parse(fs.readFileSync(CANDIDATE_PATH,'utf8'));
  const stage1=JSON.parse(fs.readFileSync(STAGE1_PATH,'utf8'));
  if(candidate.candidateId!=='stage2d-center-a-a000'||stage1.candidateId!==candidate.candidateId
      ||stage1.sourceTreeSha256!==candidate.sourceTreeSha256||stage1.configSha256!==candidate.configSha256
      ||stage1.wasmSha256!=='e72a03781d812d7a2cdea0290bff5b591856fdab0d06073814c000adc393f17c'
      ||stage1.productionSimd!==true)throw new Error('Center A amount-0 candidate provenance or production-SIMD identity does not match the pinned baseline');
  if(candidate.sourceRevision!==sourceRevision)throw new Error(`Center A source revision mismatch: ${candidate.sourceRevision} vs ${sourceRevision}`);
  if(!fs.existsSync(scratchSource)){
    fs.mkdirSync(path.dirname(scratchSource),{recursive:true});
    fs.cpSync(path.join(REPO,'wasm'),scratchSource,{recursive:true,errorOnExist:true,force:false});
  }
  if(hashTree(scratchSource)!==sourceTreeSha256)throw new Error(`${candidateId} scratch source differs from the frozen working WASM tree`);

  const overlay=createCandidatePreset(JSON.parse(fs.readFileSync(PRESETS_PATH,'utf8')),candidate.parameters,scale);
  const encoded=encodePresets(overlay.presetsDocument);
  const currentFloorConfigSha=configSha256(overlay.presetsDocument);
  if(scale===1&&currentFloorConfigSha!==candidate.configSha256)throw new Error('s=1.0 does not reproduce the recorded Center A candidate config hash');
  fs.writeFileSync(scratchPresets,encoded);
  const toolchain=path.join(REPO,'wasm/cmake/wasm32-clang.cmake');
  const configure=execLogged(['cmake','-S',scratchSource,'-B',scratchBuild,`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
    '-DBUILD_TESTING=ON','-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON','-DSORAOTO_FORCE_SCALAR_GRAND=OFF'],path.join(root,'configure.log'));
  if(configure.status!=='PASS')throw new Error(`${candidateId} scratch configure failed; see ${path.join(root,'configure.log')}`);
  const build=execLogged(['cmake','--build',scratchBuild,'--target','soraoto_dsp_super_synth'],path.join(root,'build.log'));
  if(build.status!=='PASS')throw new Error(`${candidateId} scratch SIMD build failed; see ${path.join(root,'build.log')}`);
  const wasmPath=path.join(scratchBuild,'plugins/dsp/super-synth/plugin.wasm');
  const wasmSha256=sha256(fs.readFileSync(wasmPath));
  if(scale===1&&wasmSha256!==stage1.wasmSha256)throw new Error(`s=1.0 deterministic WASM identity mismatch: ${wasmSha256} != ${stage1.wasmSha256}`);

  const fixture=JSON.parse(fs.readFileSync(REFERENCE_PATH,'utf8'));
  if(fixture.coverage.pitches.length!==30||fixture.coverage.directCells!==480)throw new Error('pinned direct-reference fixture must contain 30 centers / 480 cells');
  const references=fixture.directCells.filter(cell=>fixture.coverage.pitches.includes(cell.pitch)&&VELOCITIES.includes(cell.velocity));
  if(references.length!==90||new Set(references.map(cell=>cellKey(cell))).size!==90)throw new Error('reference OAT subset must contain exactly 90 unique direct cells');
  const previousBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=scratchBuild;
  let captured;
  try{
    captured=captureMatrix({pitches:fixture.coverage.pitches,velocities:VELOCITIES,includePitchHealth:true,includeCalibrationDiagnostics:true,
      onProgress:(pitch,count)=>process.stderr.write(`${candidateId}: MIDI ${pitch} (${count}/90)\n`)});
  }finally{
    if(previousBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previousBuildDir;
  }
  const direct=evaluateDirectReferenceMatrix(references,captured.matrix,{requiredVelocityLayers:VELOCITIES});
  const stages=execLogged(['node','wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js'],
    path.join(root,'held-release-regression.log'),{...process.env,SORAOTO_WASM_BUILD_DIR:scratchBuild,SUPERSYNTH_STAGE1_ONLY:'1'});
  const stageMetricsMatch=stages.output.match(/STAGE1_METRICS (\{[^\n]+\})/);
  if(!stageMetricsMatch)throw new Error(`${candidateId} held/release semantics test emitted no STAGE1_METRICS; see ${path.join(root,'held-release-regression.log')}`);
  const stageMetrics=JSON.parse(stageMetricsMatch[1]);
  const cells=direct.cells.map(cell=>{
    const source=captured.matrix.find(item=>item.pitch===cell.pitch&&item.velocity===cell.velocity);
    const pitch=source.metrics.pitchMeasurement;
    return {...cell,region:region(cell.pitch),pitchMeasurement:pitch?{
      result:pitch.result,valid:pitch.measurement_valid===true,errorCents:pitch.pitch_error_cents??null
    }:null};
  });
  const treble=cells.filter(cell=>isTreble(cell.pitch));
  const bassMid=cells.filter(cell=>region(cell.pitch)!=='treble');
  const validPitch=cells.filter(cell=>cell.pitchMeasurement?.valid).map(cell=>Math.abs(cell.pitchMeasurement.errorCents));
  const invalidPitchCount=cells.length-validPitch.length;
  const allMatrixMetrics=captured.matrix.map(cell=>cell.metrics);
  const calibrationMetrics=Object.values(captured.diagnostics.diagnosticRenders);
  const candidateResult={
    candidateId,scale,productionSimd:true,sourceRevision,sourceTreeSha256,centerCandidateId:candidate.candidateId,
    centerSourceTreeSha256:candidate.sourceTreeSha256,centerConfigSha256:candidate.configSha256,
    configSha256:currentFloorConfigSha,wasmSha256,baselineWasmSha256:stage1.wasmSha256,
    parameters:{...candidate.parameters,termination_loss_floor_scale:scale},
    terminationFloors:overlay.candidateFloors,terminationSlopes:overlay.slopes,
    coverage:{pitches:fixture.coverage.pitches,velocities:VELOCITIES,cells:cells.length},
    metrics:{
      postAttackShape:{failCount:direct.metrics.postAttackShape.failCount,worstDb:direct.metrics.postAttackShape.max,
        signedEarlyResidualDb:cells.map(cell=>cell.earlyResidualDb),signedLateResidualDb:cells.map(cell=>cell.lateResidualDb),
        cells:cells.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,earlyResidualDb:cell.earlyResidualDb,
          lateResidualDb:cell.lateResidualDb,postAttackShapeErrorDb:cell.postAttackShapeErrorDb,dominantResidual:cell.dominantResidual}))},
      trebleLate:{median:median(treble.map(cell=>cell.lateResidualDb)),p90Absolute:pctl(treble.map(cell=>Math.abs(cell.lateResidualDb)),.9),
        worstSigned:treble.reduce((worst,cell)=>Math.abs(cell.lateResidualDb)>Math.abs(worst.lateResidualDb)?cell:worst,treble[0]),
        shapeFailureCount:treble.filter(cell=>cell.postAttackShapeErrorDb>10).length},
      bassMidFailures:bassMid.filter(cell=>cell.postAttackShapeErrorDb>10).map(cell=>({pitch:cell.pitch,velocity:cell.velocity,shapeDb:cell.postAttackShapeErrorDb})),
      pitch:{invalidCount:invalidPitchCount,worstValidAbsoluteCents:validPitch.length?Math.max(...validPitch):null},
      directLevel:{medianAbsoluteErrorDb:median(direct.cells.map(cell=>Math.abs(cell.levelErrorDb))),worstAbsoluteErrorDb:Math.max(...direct.cells.map(cell=>Math.abs(cell.levelErrorDb))),failureCount:direct.metrics.directLevel.failCount},
      brightnessDirection:direct.metrics.brightnessDirection,
      dynamicSpanProxy:direct.metrics.dynamicSpan,
      buzz:captured.diagnostics.lowRegisterBuzz.value,
      peakWorstDbfs:Math.max(...allMatrixMetrics.concat(calibrationMetrics).map(metric=>metric.fullRenderPeakDbfs)),
      guardHits:allMatrixMetrics.concat(calibrationMetrics).reduce((sum,metric)=>sum+(metric.outputGuardHits||0),0),
      finite:allMatrixMetrics.concat(calibrationMetrics).every(metric=>metric.finite===true),
      measurement:{invalidCount:invalidPitchCount,totalCount:cells.length}
    },
    heldRelease:{testStatus:stages.status,hardGateFailures:stageMetrics.hardGateFailures,
      pitchExcludedFromOatGate:true,heldDecayRatio:stageMetrics.heldDecayRatio,heldDecayPass:stageMetrics.heldDecayRatio>.4&&stageMetrics.heldDecayRatio<1.02,
      releaseTail1:stageMetrics.releaseTailRms['1.10to1.35s'],releaseTail2:stageMetrics.releaseTailRms['1.8to2.1s'],
      releaseTail3:stageMetrics.releaseTailRms['2.8to3.2s'],
      releaseTail3To2Ratio:stageMetrics.releaseTailRms['2.8to3.2s']/Math.max(1e-12,stageMetrics.releaseTailRms['1.8to2.1s']),
      releaseTailPass:stageMetrics.releaseTailRms['1.10to1.35s']>.0003&&stageMetrics.releaseTailRms['1.8to2.1s']>.00015
        &&stageMetrics.releaseTailRms['2.8to3.2s']<stageMetrics.releaseTailRms['1.8to2.1s']*.55,
      finiteRelease:stageMetrics.finiteRelease,stuckVoiceCount:stageMetrics.stuckVoiceCount,
      noStuckVoice:stageMetrics.stuckVoiceCount===0,
      finite:stageMetrics.finite,guardHits:stageMetrics.outputGuardHits,stageMetrics},
    elapsedSeconds:(performance.now()-started)/1000
  };
  candidateResult.metrics.bassMidFailureCount=candidateResult.metrics.bassMidFailures.length;
  writeJson(resultPath,candidateResult);
  return candidateResult;
}

function decide(rows){
  const baseline=rows.find(row=>row.scale===1);
  if(!baseline)throw new Error('OAT is missing baseline s=1.0');
  const baselineFailKeys=new Set(baseline.metrics.bassMidFailures.map(item=>`${item.pitch}:${item.velocity}`));
  for(const row of rows){
    const newBassMid=row.metrics.bassMidFailures.filter(item=>!baselineFailKeys.has(`${item.pitch}:${item.velocity}`));
    row.metrics.newBassMidFailures=newBassMid;
    const trebleP90Improvement=baseline.metrics.trebleLate.p90Absolute-row.metrics.trebleLate.p90Absolute;
    const worstShapeImprovement=baseline.metrics.postAttackShape.worstDb-row.metrics.postAttackShape.worstDb;
    row.authorization={
      trebleLateP90ImprovementDb:trebleP90Improvement,worstShapeImprovementDb:worstShapeImprovement,
      lowerShapeFailureCount:row.metrics.postAttackShape.failCount<baseline.metrics.postAttackShape.failCount,
      noNewBassMidFailures:newBassMid.length===0,
      heldDecayPass:row.heldRelease.heldDecayPass,releaseTailPass:row.heldRelease.releaseTailPass,
      measurementUsable:row.metrics.measurement.invalidCount===0,finite:row.metrics.finite,
      zeroGuards:row.metrics.guardHits===0,
      authorized:row.scale<1&&trebleP90Improvement>=2.5&&worstShapeImprovement>=2.5
        &&row.metrics.postAttackShape.failCount<baseline.metrics.postAttackShape.failCount&&newBassMid.length===0
      &&row.heldRelease.heldDecayPass&&row.heldRelease.releaseTailPass&&row.metrics.measurement.invalidCount===0
        &&row.heldRelease.finiteRelease&&row.heldRelease.noStuckVoice&&row.heldRelease.guardHits===0
        &&row.metrics.finite&&row.metrics.guardHits===0
    };
  }
  const passing=rows.filter(row=>row.authorization.authorized);
  const zeroShape=passing.filter(row=>row.metrics.postAttackShape.failCount===0);
  const ranked=zeroShape.sort((a,b)=>Math.abs(a.scale-1)-Math.abs(b.scale-1)
    ||a.metrics.trebleLate.p90Absolute-b.metrics.trebleLate.p90Absolute
    ||a.metrics.postAttackShape.worstDb-b.metrics.postAttackShape.worstDb);
  return {decision:passing.length?'TERMINATION_FLOOR_AUTHORIZED':'BLOCKED_TERMINATION_LOSS_FLOOR_INSUFFICIENT',
    baselineScale:1,authorizedScales:passing.map(row=>row.scale),selectedScale:ranked[0]?.scale??null,
    selectionStatus:ranked.length?'ZERO_SHAPE_FAILURE_SCALE_SELECTED':'NO_ZERO_SHAPE_FAILURE_SCALE; JOINT_SEARCH_ONLY',
    baselineFailures:{shape:baseline.metrics.postAttackShape.failCount,bassMid:baseline.metrics.bassMidFailureCount,
      trebleLateP90Absolute:baseline.metrics.trebleLate.p90Absolute,worstShape:baseline.metrics.postAttackShape.worstDb}};
}

function main(){
  if(!fs.existsSync(CANDIDATE_PATH)||!fs.existsSync(STAGE1_PATH))throw new Error('provenance-resolved Center A amount-0 candidate artifacts are missing');
  const sourceRevision=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
  const sourceTreeSha256=hashTree(path.join(REPO,'wasm'));
  fs.mkdirSync(SAMPLE_ROOT,{recursive:true});
  const rows=[];
  for(const scale of OAT_SCALES){
    process.stderr.write(`Starting termination-loss-floor OAT s=${scale.toFixed(2)}\n`);
    rows.push(runScale(scale,sourceTreeSha256,sourceRevision));
  }
  const summary=decide(rows);
  const output={schemaVersion:1,studyName:'issue-7-termination-loss-floor-oat-v1',sourceRevision,sourceTreeSha256,
    candidateArtifact:CANDIDATE_PATH,candidateStage1Artifact:STAGE1_PATH,referenceFixture:REFERENCE_PATH,
    parameters:{...rows[0].parameters},scales:rows.map(row=>({scale:row.scale,resultPath:path.relative(REPO,path.join(SAMPLE_ROOT,`termination-floor-s${row.scale.toFixed(2).replace('.','-')}.json`)),...row})),...summary};
  writeJson(OUTPUT_PATH,output);
  process.stdout.write(`${JSON.stringify({output:OUTPUT_PATH,decision:summary.decision,selectedScale:summary.selectedScale,
    authorizedScales:summary.authorizedScales,candidates:rows.map(row=>({scale:row.scale,shapeFailures:row.metrics.postAttackShape.failCount,
      trebleLateP90Absolute:row.metrics.trebleLate.p90Absolute,worstShape:row.metrics.postAttackShape.worstDb,
      invalid:row.metrics.measurement.invalidCount,heldDecayRatio:row.heldRelease.heldDecayRatio,
      release:[row.heldRelease.releaseTail1,row.heldRelease.releaseTail2,row.heldRelease.releaseTail3],
      peak:row.metrics.peakWorstDbfs,guards:row.metrics.guardHits}))})}\n`);
}

if(require.main===module){try{main();}catch(error){process.stderr.write(`Termination loss floor OAT failed: ${error.stack||error.message}\n`);process.exitCode=1;}}
module.exports={OAT_SCALES,VELOCITIES,runScale,decide};
