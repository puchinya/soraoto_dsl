#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {captureMatrix,VELOCITIES}=require('./capture-supersynth-matrix.cjs');
const {evaluateDirectReferenceMatrix}=require('./stage3-direct-reference-metrics.cjs');
const {referenceFit}=require('./evaluate-qmc-candidate.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const FIXTURE_PATH=path.join(ROOT,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');

function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`);fs.renameSync(tmp,file);}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

function evaluate(candidateRoot,candidatePath,expected,outputPath){
  const root=path.resolve(candidateRoot),candidate=read(candidatePath);
  const candidateMeta=read(path.join(root,'candidate.json'));
  const stage1=read(path.join(root,'stage1-result.json'));
  const buildRoot=path.join(root,'build');
  const wasmPath=path.join(buildRoot,'plugins/dsp/super-synth/plugin.wasm');
  const wasmSha256=hash(wasmPath);
  if(candidateMeta.candidateId!==candidate.candidateId||stage1.candidateId!==candidate.candidateId
      ||candidateMeta.configSha256!==expected.configSha256||wasmSha256!==expected.wasmSha256
      ||stage1.sourceTreeSha256!==expected.sourceTreeSha256){
    throw new Error(`Stage-3 candidate identity mismatch: ${candidate.candidateId}`);
  }
  const fixture=read(FIXTURE_PATH);
  if(fixture.coverage.directCells!==480||fixture.coverage.pitches.length!==30
      ||fixture.coverage.velocityRepresentatives.length!==16
      ||JSON.stringify(fixture.coverage.velocityRepresentatives)!==JSON.stringify(VELOCITIES)){
    throw new Error('authoritative direct reference coverage must remain 30 x 16 = 480');
  }
  const prior=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=buildRoot;
  let captured;
  try{
    captured=captureMatrix({pitches:fixture.coverage.pitches,velocities:VELOCITIES,
      onProgress:(pitch,count)=>process.stderr.write(`${candidate.candidateId}: Stage 3 MIDI ${pitch} (${count}/480)\n`)});
  }finally{
    if(prior===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR=prior;
  }
  const direct=evaluateDirectReferenceMatrix(fixture.directCells,captured.matrix,
    {requiredVelocityLayers:fixture.coverage.velocityRepresentatives});
  const fit=referenceFit(captured.matrix,fixture);
  const failures=[];
  for(const cell of direct.cells)if(cell.hardFailures.length)failures.push(`${cell.pitch}:${cell.velocity}:${cell.hardFailures.join('+')}`);
  for(const row of direct.velocity)if(row.failures.length)failures.push(`pitch ${row.pitch}:${row.failures.join('+')}`);
  const result={schemaVersion:1,candidateId:candidate.candidateId,parameters:candidate.parameters,
    stageReached:3,sourceTreeSha256:stage1.sourceTreeSha256,configSha256:candidateMeta.configSha256,
    wasmSha256,productionSimd:true,subsetSha256:null,
    coverage:{directPitches:fixture.coverage.pitches.length,velocities:VELOCITIES.length,cells:captured.matrix.length},
    referenceFitLoss:fit.value,sharedGainOffsetDb:direct.sharedGainOffsetDb,
    metrics:direct.metrics,result:failures.length?'FAIL':'PASS',failures,
    cells:direct.cells,velocity:direct.velocity};
  write(outputPath,result);
  return result;
}

function main(){
  const [candidateRoot,candidatePath,expectedPath,outputPath]=process.argv.slice(2);
  if(!candidateRoot||!candidatePath||!expectedPath||!outputPath)throw new Error('usage: evaluate-stage3-direct-reference.cjs <candidate-root> <candidate.json> <expected.json> <output.json>');
  const result=evaluate(candidateRoot,candidatePath,read(expectedPath),outputPath);
  process.stdout.write(JSON.stringify({candidateId:result.candidateId,result:result.result,
    coverage:result.coverage,metrics:result.metrics,failures:result.failures.slice(0,20)})+'\n');
}

if(require.main===module){try{main();}catch(error){process.stderr.write(`Stage-3 direct evaluator ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}}
module.exports={evaluate};
