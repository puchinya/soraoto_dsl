#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {REPO,SPACE,PRESETS_PATH,writeCandidatePresets}=require('../tuning/candidate-overlay.cjs');
const {hashFiles,hashTree,EVALUATOR_FILES}=require('./evaluate-qmc-candidate.cjs');
const {postAttackResiduals,LIMITS}=require('./stage3-direct-reference-metrics.cjs');

const VELOCITIES=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const CELLS=[...VELOCITIES.map(velocity=>({pitch:45,velocity})),{pitch:108,velocity:14},{pitch:21,velocity:14}];
const ROOT=REPO;
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);}
function run(args,cwd,log){
  try{const out=execFileSync('rtk',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});fs.writeFileSync(log,out);return out;}
  catch(error){const out=`${error.stdout?.toString?.()||''}\n${error.stderr?.toString?.()||''}`;fs.writeFileSync(log,out);throw new Error(`rtk ${args.join(' ')} failed: ${out.slice(-4000)}`);}
}
function assertCellCoverage(rows){
  if(rows.length!==18)throw new Error(`expected exactly 18 Stage2N cells, got ${rows.length}`);
  const expected=CELLS.map(cell=>`${cell.pitch}:${cell.velocity}`),actual=rows.map(row=>`${row.pitch}:${row.velocity}`);
  if(new Set(actual).size!==18||JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Stage2N cell coverage/order mismatch');
}
function summarize(captured,reference){
  assertCellCoverage(captured.matrix);
  const byKey=new Map(captured.matrix.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const refByKey=new Map(reference.directCells.map(cell=>[`${cell.pitch}:${cell.velocity}`,cell]));
  const midi45=captured.matrix.slice(0,16).map(row=>({velocity:row.velocity,
    level80to200Dbfs:row.metrics.envelopeDbfs[3],
    reference80to200Dbfs:refByKey.get(`45:${row.velocity}`).metrics.envelopeDbfs[3]}));
  const span=values=>Math.max(...values)-Math.min(...values);
  const synthSpanDb=span(midi45.map(row=>row.level80to200Dbfs));
  const referenceSpanDb=span(midi45.map(row=>row.reference80to200Dbfs));
  const c8=byKey.get('108:14').metrics;
  const c8Reference=refByKey.get('108:14').metrics;
  const residuals=postAttackResiduals(c8,c8Reference);
  const c8ShapeErrorDb=residuals.postAttackShapeErrorDb;
  const midi21=byKey.get('21:14').metrics;
  const result={
    cellCount:captured.matrix.length,
    cells:captured.matrix.map(row=>({pitch:row.pitch,velocity:row.velocity,metrics:row.metrics})),
    midi45:{layers:midi45,synthSpanDb,referenceSpanDb,signedSpanDifferenceDb:synthSpanDb-referenceSpanDb},
    c8:{postAttackShapeErrorDb:c8ShapeErrorDb,postAttackShapeViolationDb:c8ShapeErrorDb-LIMITS.postAttackShapeErrorDb,
      earlyResidualDb:residuals.earlyResidualDb,lateResidualDb:residuals.lateResidualDb,
      level80to200Dbfs:c8.envelopeDbfs[3],level200to350Dbfs:c8.envelopeDbfs[4],finite:c8.finite,
      peakDbfs:c8.fullRenderPeakDbfs??c8.peakDbfs,guardHits:c8.outputGuardHits},
    midi21:{currentEstimatorCents:midi21.pitchMeasurement?.pitch_error_cents??null,
      measurementValid:midi21.pitchMeasurement?.measurement_valid??false,
      constrainedNearFundamentalCents:midi21.nearFundamentalProbe?.cents??null,
      constrainedNearFundamentalFrequency:midi21.nearFundamentalProbe?.frequencyHz??null,
      finite:midi21.finite,peakDbfs:midi21.fullRenderPeakDbfs??midi21.peakDbfs,guardHits:midi21.outputGuardHits},
    finite:captured.matrix.every(row=>row.metrics.finite===true),
    guardHits:captured.matrix.reduce((total,row)=>total+(row.metrics.outputGuardHits||0),0),
    peakWorstDbfs:Math.max(...captured.matrix.map(row=>row.metrics.fullRenderPeakDbfs??row.metrics.peakDbfs))
  };
  result.equivalence={
    midi45SpanDeltaDb:synthSpanDb-26.526804,
    c8ShapeViolationDeltaDb:result.c8.postAttackShapeViolationDb-(-0.221763),
    midi21EstimatorDeltaCents:result.midi21.currentEstimatorCents-29.485665486244464,
    midi21NearFundamentalDeltaCents:result.midi21.constrainedNearFundamentalCents-13.04792250285121,
    toleranceDb:1.1e-5,pitchToleranceCents:0.05,
  };
  result.equivalence.pass=result.finite&&result.guardHits===0
    &&Math.abs(result.equivalence.midi45SpanDeltaDb)<=result.equivalence.toleranceDb
    &&Math.abs(result.equivalence.c8ShapeViolationDeltaDb)<=result.equivalence.toleranceDb
    &&Math.abs(result.equivalence.midi21EstimatorDeltaCents)<=result.equivalence.pitchToleranceCents
    &&Math.abs(result.equivalence.midi21NearFundamentalDeltaCents)<=result.equivalence.pitchToleranceCents;
  return result;
}
function capture(candidatePath,buildRoot,outputPath){
  const candidate=readJson(candidatePath);
  if(candidate.candidateId!=='stage2n-r3-candidate-01')throw new Error('unexpected Stage2N candidate identity');
  const sourceRevision=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  const sourceTreeSha256=hashTree(path.join(ROOT,'wasm'));
  const evaluatorSha256=hashFiles(EVALUATOR_FILES);
  const sourceRoot=path.join(buildRoot,'source');
  const scratchWasm=path.join(sourceRoot,'wasm');
  const scratchBuild=path.join(buildRoot,'build');
  fs.mkdirSync(buildRoot,{recursive:true});
  if(!fs.existsSync(scratchWasm))fs.cpSync(path.join(ROOT,'wasm'),scratchWasm,{recursive:true,errorOnExist:true,force:false});
  const stamp={sourceRevision,sourceTreeSha256,evaluatorSha256,candidateId:candidate.candidateId};
  const stampPath=path.join(buildRoot,'candidate-source.json');
  if(fs.existsSync(stampPath)&&JSON.stringify(readJson(stampPath))!==JSON.stringify(stamp))throw new Error('Stage2N scratch source provenance mismatch');
  if(!fs.existsSync(stampPath))writeJson(stampPath,stamp);
  const cborRelative='web-player/src/js/plugin-cbor.js';
  const scratchCbor=path.join(sourceRoot,cborRelative);fs.mkdirSync(path.dirname(scratchCbor),{recursive:true});
  fs.copyFileSync(path.join(ROOT,cborRelative),scratchCbor);
  const scratchPresets=path.join(scratchWasm,'plugins/dsp/super-synth/presets.json');
  const overlay=writeCandidatePresets(PRESETS_PATH,scratchPresets,candidate.parameters);
  const encoded=fs.readFileSync(scratchPresets);
  writeJson(path.join(buildRoot,'candidate.json'),{candidateId:candidate.candidateId,parameters:candidate.parameters,
    sourceRevision,sourceTreeSha256,evaluatorSha256,configSha256:sha256(encoded),derived:overlay.derived});
  const toolchain=path.join(ROOT,'wasm/cmake/wasm32-clang.cmake');
  run(['cmake','-S',scratchWasm,'-B',scratchBuild,`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,'-DBUILD_TESTING=ON',
    '-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON','-DSORAOTO_FORCE_SCALAR_GRAND=OFF'],ROOT,path.join(buildRoot,'configure.log'));
  run(['cmake','--build',scratchBuild,'--target','soraoto_dsp_super_synth'],ROOT,path.join(buildRoot,'build.log'));
  const wasmPath=path.join(scratchBuild,'plugins/dsp/super-synth/plugin.wasm');
  const wasmBytes=fs.readFileSync(wasmPath),wasmSha256=sha256(wasmBytes);
  const exports=WebAssembly.Module.exports(new WebAssembly.Module(wasmBytes)).map(item=>item.name);
  if(exports.some(name=>name.includes('stage2m')))throw new Error('production candidate unexpectedly exposes Stage2M factor exports');
  const capturePath=path.join(scratchWasm,'plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
  const {captureMatrix}=require(capturePath);
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=scratchBuild;
  let captured;
  try{captured=captureMatrix({cells:CELLS,includePitchHealth:true,includeNearFundamentalProbe:true,
    onProgress:(_pitch,count)=>process.stderr.write(`Stage2N 18-cell preflight ${count}/18\n`)});}
  finally{if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;}
  const reference=readJson(path.join(scratchWasm,'plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'));
  const summary=summarize(captured,reference);
  const result={candidateId:candidate.candidateId,parameters:candidate.parameters,sourceRevision,sourceTreeSha256,evaluatorSha256,
    configSha256:sha256(encoded),wasmSha256,productionSimd:true,stage2mExportsAbsent:true,requestedCells:CELLS,preflight:summary};
  writeJson(outputPath,result);return result;
}
module.exports={CELLS,VELOCITIES,assertCellCoverage,summarize,capture};
if(require.main===module){
  try{const args=process.argv.slice(2);const values={};for(let i=0;i<args.length;i++){if(!['--candidate','--build-root','--output'].includes(args[i])||!args[i+1])throw new Error('Usage: capture-stage2n-revision3.cjs --candidate <candidate.json> --build-root <scratch> --output <result.json>');values[args[i].slice(2)]=args[++i];}for(const key of ['candidate','build-root','output'])if(!values[key])throw new Error(`missing --${key}`);const result=capture(path.resolve(values.candidate),path.resolve(values['build-root']),path.resolve(values.output));process.stdout.write(JSON.stringify({candidateId:result.candidateId,cellCount:result.preflight.cellCount,pass:result.preflight.equivalence.pass,wasmSha256:result.wasmSha256})+'\n');}
  catch(error){process.stderr.write(`Stage2N preflight ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}
}
