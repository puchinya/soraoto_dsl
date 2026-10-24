#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {evaluateDirectReferenceMatrix}=require('./stage3-direct-reference-metrics.cjs');
const {referenceFit}=require('./evaluate-qmc-candidate.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const CANDIDATE_EVALUATOR=path.join(__dirname,'evaluate-calibration-candidate.cjs');
const FIXTURE_PATH=path.join(ROOT,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');

function parseArgs(argv){
  const a={};
  for(let i=0;i<argv.length;i++){
    if(!['--candidate','--subset','--build-root','--output'].includes(argv[i])||!argv[i+1])throw new Error('Usage: evaluate-stage2b-candidate.cjs --candidate <candidate.json> --subset <manifest.json> --build-root <scratch-dir> --output <result.json>');
    a[argv[i].slice(2)]=argv[++i];
  }
  if(!a.candidate||!a.subset||!a['build-root']||!a.output)throw new Error('candidate, subset, build-root, and output are required');
  return {candidate:path.resolve(a.candidate),subset:path.resolve(a.subset),buildRoot:path.resolve(a['build-root']),output:path.resolve(a.output)};
}

function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`);fs.renameSync(tmp,file);}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function runStage(stage,candidate,root,out){
  const run=spawnSync('rtk',['node',CANDIDATE_EVALUATOR,'--candidate',candidate,'--stage',String(stage),'--build-root',root,'--output',out],{cwd:ROOT,encoding:'utf8',maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(root,`stage${stage}-stdout.log`),run.stdout||'');
  fs.writeFileSync(path.join(root,`stage${stage}-stderr.log`),run.stderr||'');
  if(run.status!==0)throw new Error(`Stage ${stage} candidate evaluation failed: ${(run.stderr||run.error?.message||'').slice(-3000)}`);
  return read(out);
}

function evaluate(args){
  const started=performance.now();
  const candidate=read(args.candidate), subset=read(args.subset);
  if(!/^[a-zA-Z0-9_-]+$/.test(candidate.candidateId||''))throw new Error('candidateId must be a simple identifier');
  if(!subset.subsetSha256||!Array.isArray(subset.cells)||!subset.cells.length)throw new Error('diagnostic subset manifest is invalid');
  const candidateRoot=args.buildRoot;
  const stage1=runStage(1,args.candidate,candidateRoot,path.join(candidateRoot,'stage1-result.json'));
  // Stage 2B always measures Stage 2 even when Stage 1 reports acoustic FAIL.
  const stage2=runStage(2,args.candidate,candidateRoot,path.join(candidateRoot,'stage2-result.json'));
  const sourceRoot=path.join(candidateRoot,'source');
  const buildRoot=path.join(candidateRoot,'build');
  const capturePath=path.join(sourceRoot,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
  const {captureMatrix}=require(capturePath);
  const fixture=read(path.join(sourceRoot,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'));
  const expectedFixtureSha256=sha(fs.readFileSync(FIXTURE_PATH));
  if(subset.referenceFixtureSha256!==expectedFixtureSha256)throw new Error('diagnostic subset reference fixture hash differs from current fixture');
  const selectedKeys=new Set(subset.cells.map(cell=>`${cell.pitch}:${cell.velocity}`));
  const referenceCells=fixture.directCells.filter(cell=>selectedKeys.has(`${cell.pitch}:${cell.velocity}`));
  if(referenceCells.length!==selectedKeys.size)throw new Error('diagnostic subset includes cells absent from the authoritative direct reference');
  const priorBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=buildRoot;
  let captured;
  try{
    captured=captureMatrix({cells:subset.cells.map(({pitch,velocity})=>({pitch,velocity})),
      onProgress:(pitch,count)=>process.stderr.write(`${candidate.candidateId}: Stage-2B cell ${pitch} (${count}/${subset.cells.length})\n`)});
  }finally{
    if(priorBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;
  }
  if(captured.matrix.length!==subset.cells.length)throw new Error(`Stage-2B captured ${captured.matrix.length}/${subset.cells.length} cells`);
  const direct=evaluateDirectReferenceMatrix(referenceCells,captured.matrix,{requiredVelocityLayers:fixture.coverage.velocityRepresentatives});
  const fit=referenceFit(captured.matrix,fixture);
  const actualCells=captured.matrix.map(cell=>cell.metrics);
  const peakWorstDbfs=Math.max(...actualCells.map(metric=>metric.fullRenderPeakDbfs??metric.peakDbfs));
  const guardHitTotal=actualCells.reduce((sum,metric)=>sum+(metric.outputGuardHits||0),0);
  const finite=actualCells.every(metric=>metric.finite===true&&Number.isFinite(metric.peakDbfs));
  const result={schemaVersion:1,candidateId:candidate.candidateId,parameters:candidate.parameters,
    stageReached:2,stage2bReached:true,sourceRevision:stage2.sourceRevision,sourceDirty:stage2.sourceDirty,
    sourceTreeSha256:stage2.sourceTreeSha256,evaluatorSha256:stage2.evaluatorSha256,
    configSha256:stage2.configSha256,wasmSha256:stage2.wasmSha256,productionSimd:true,
    elapsedSeconds:(performance.now()-started)/1000,subsetSha256:subset.subsetSha256,
    stage1Result:stage1.result,stage2Result:stage2.result,stage1Metrics:stage1.metrics,stage2Metrics:stage2.metrics,
    metrics:{referenceFitLoss:stage2.metrics.referenceFitLoss,directProxyReferenceFitLoss:fit.value,
      directProxy:direct.metrics,peakWorstDbfs,guardHitTotal,finite,
      measurementInvalidCount:stage2.measurement?.invalidCount??null,
      directCellCount:captured.matrix.length},
    directProxy:{coverage:direct.coverage,sharedGainOffsetDb:direct.sharedGainOffsetDb,
      cells:direct.cells,velocity:direct.velocity},
    measurement:{invalidCount:stage2.measurement?.invalidCount??null,totalCount:stage2.measurement?.totalCount??null,
      directProxyCellCount:captured.matrix.length},
    result:'COMPLETE'};
  write(args.output,result);
  return result;
}

try{
  const result=evaluate(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({candidateId:result.candidateId,result:result.result,
    elapsedSeconds:+result.elapsedSeconds.toFixed(2),subsetCells:result.metrics.directCellCount,
    peakWorstDbfs:result.metrics.peakWorstDbfs,guardHitTotal:result.metrics.guardHitTotal,
    stage2Invalid:result.measurement.invalidCount,referenceFitLoss:result.metrics.referenceFitLoss})+'\n');
}catch(error){process.stderr.write(`Stage-2B evaluator ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}
