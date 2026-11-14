#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'../../../../../../');
const STAGE2L_ROOT=path.join(ROOT,'.agent-state/issues/7/calibration-optuna/stage2l-model-revision-2');
const DEFAULT_CANDIDATE=path.join(STAGE2L_ROOT,'results/candidates/stage2l-r2-candidate-01.json');
const DEFAULT_RESULT=path.join(ROOT,'.agent-state/issues/7/calibration-optuna/stage2m-factorial/factorial-result.json');
const DEFAULT_BUILD=path.join(ROOT,'build/wasm/calibration/stage2m-factorial');
const SEARCH_REL='wasm/plugins/dsp/super-synth/test/tuning/stage2l-model-revision-search-space.json';
const FACTORS=Object.freeze([
  {mask:0,label:'000',N:'legacy',V:'legacy',H:'legacy'},
  {mask:1,label:'001',N:'revision-2',V:'legacy',H:'legacy'},
  {mask:2,label:'010',N:'legacy',V:'revision-2',H:'legacy'},
  {mask:3,label:'011',N:'revision-2',V:'revision-2',H:'legacy'},
  {mask:4,label:'100',N:'legacy',V:'legacy',H:'revision-2'},
  {mask:5,label:'101',N:'revision-2',V:'legacy',H:'revision-2'},
  {mask:6,label:'110',N:'legacy',V:'revision-2',H:'revision-2'},
  {mask:7,label:'111',N:'revision-2',V:'revision-2',H:'revision-2'}
]);
const MIDI45_VELOCITIES=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const REQUIRED_PROTECTED=[
  '.agent-state/issues/7/stage2f-anchor-manifest.json',
  '.agent-state/issues/7/calibration-optuna/stage2f/runs/20260930T045213Z.json',
  '.agent-state/issues/7/calibration-optuna/stage2f-v2/manifests/stage2f-v2-anchor-manifest.json',
  '.agent-state/issues/7/calibration-optuna/stage2f-v2/diagnostics/residual-attribution.json',
  '.agent-state/issues/7/calibration-optuna/stage2l-model-revision-2/results/candidates/stage2l-r2-candidate-01.json',
  '.agent-state/issues/7/calibration-optuna/stage2l-model-revision-2/results/stage2l-r2-candidate-01.json',
  'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json',
  'wasm/plugins/dsp/super-synth/test/tuning/stage2l-model-revision-search-space.json'
];

function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`);fs.renameSync(tmp,file);}
function digestFile(file){return sha(fs.readFileSync(file));}
function sourceTreeSha(){
  const output=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  return output;
}
function fileSetSha(paths){const h=crypto.createHash('sha256');for(const rel of [...paths].sort())h.update(rel).update('\0').update(fs.readFileSync(path.join(ROOT,rel))).update('\0');return h.digest('hex');}
function parseArgs(argv){
  const args={candidate:DEFAULT_CANDIDATE,output:DEFAULT_RESULT,'build-root':DEFAULT_BUILD,dryRun:false,execute:false};
  for(let i=0;i<argv.length;i++){
    const item=argv[i];
    if(item==='--dry-run'){args.dryRun=true;continue;}
    if(item==='--execute'){args.execute=true;continue;}
    if(!['--candidate','--output','--build-root'].includes(item)||!argv[i+1])throw new Error('Usage: capture-stage2m-factorial.cjs [--dry-run|--execute] [--candidate <candidate.json>] [--build-root <scratch-dir>] [--output <result.json>]');
    args[item.slice(2)]=path.resolve(argv[++i]);
  }
  if(args.dryRun===args.execute)throw new Error('specify exactly one of --dry-run or --execute');
  args.candidate=path.resolve(args.candidate);args.output=path.resolve(args.output);args.buildRoot=path.resolve(args['build-root']);
  return args;
}
function candidateData(candidatePath){
  const candidate=read(candidatePath);
  if(candidate.candidateId!=='stage2l-r2-candidate-01'||!candidate.parameters||Object.keys(candidate.parameters).length!==7)
    throw new Error('BLOCKED_STAGE2M_CANDIDATE_IDENTITY: expected the exact Stage2L candidate-1 vector');
  process.env.SUPERSYNTH_CALIBRATION_SEARCH_SPACE=SEARCH_REL;
  const {deriveCandidate}=require('../tuning/candidate-overlay.cjs');
  deriveCandidate(candidate.parameters);
  const resultPath=path.join(STAGE2L_ROOT,'results/stage2l-r2-candidate-01.json');
  if(!fs.existsSync(resultPath))throw new Error('BLOCKED_STAGE2M_CANDIDATE_EVIDENCE: Stage2L candidate-1 result is missing');
  const result=read(resultPath);
  if(result.candidateId!==candidate.candidateId||canonical(result.parameters)!==canonical(candidate.parameters)
      ||result.result!=='COMPLETE'||result.productionSimd!==true)
    throw new Error('BLOCKED_STAGE2M_CANDIDATE_EVIDENCE: Stage2L candidate-1 result/vector/prod-SIMD identity differs');
  return {candidate,result,resultPath};
}
function protectedHashes(){
  const out={};
  for(const rel of REQUIRED_PROTECTED){const p=path.join(ROOT,rel);if(!fs.existsSync(p)||!fs.statSync(p).isFile())throw new Error(`BLOCKED_PROTECTED_EVIDENCE_MISSING: ${rel}`);out[rel]=digestFile(p);}
  return out;
}
function runLogged(args,cwd,logPath){
  const result=spawnSync('rtk',args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024});
  fs.writeFileSync(logPath,`${result.stdout||''}\n${result.stderr||''}`);
  if(result.status!==0)throw new Error(`command failed: rtk ${args.join(' ')}\n${(result.stderr||result.error?.message||'').slice(-4000)}`);
}
function sourceIdentity(){
  const paths=[
    'wasm/plugins/dsp/super-synth/src/plugin.c','wasm/cmake/wasm_plugin.cmake',
    'wasm/plugins/dsp/super-synth/test/tools/capture-stage2m-factorial.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs',
    'wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs',SEARCH_REL,
    'wasm/plugins/dsp/super-synth/presets.json','wasm/cmake/super_synth_metadata.py',
    'wasm/CMakeLists.txt'
  ];
  const ordinaryWasm=path.join(ROOT,'build/wasm/plugins/dsp/super-synth/plugin.wasm');
  return {sourceRevision:sourceTreeSha(),sourceDirty:Boolean(execFileSync('rtk',['git','status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim()),
    stage2mEvaluatorSha256:fileSetSha(paths),pluginSha256:digestFile(path.join(ROOT,'wasm/plugins/dsp/super-synth/src/plugin.c')),
    presetSha256:digestFile(path.join(ROOT,'wasm/plugins/dsp/super-synth/presets.json')),
    searchSpaceSha256:digestFile(path.join(ROOT,SEARCH_REL)),referenceFixtureSha256:digestFile(path.join(ROOT,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json')),
    ordinaryWasmSha256:fs.existsSync(ordinaryWasm)?digestFile(ordinaryWasm):null};
}
function validateStage2lBudget(){
  const runsDir=path.join(STAGE2L_ROOT,'runs');
  const completed=fs.readdirSync(runsDir).filter(name=>name.endsWith('.json'))
    .map(name=>({name,row:read(path.join(runsDir,name))}))
    .filter(({row})=>row.endTimestamp&&row.candidateBudgetMaximum===12&&row.physicalCandidatesAfter===1)
    .sort((a,b)=>String(a.row.endTimestamp).localeCompare(String(b.row.endTimestamp))||a.name.localeCompare(b.name));
  const latest=completed.at(-1);
  if(!latest)throw new Error('BLOCKED_STAGE2M_BUDGET: no completed Stage2L run proves candidate budget 1/12');
  return {candidateIdentities:latest.row.physicalCandidatesAfter,maximumCandidateIdentities:latest.row.candidateBudgetMaximum,
    completedRun:latest.name,endTimestamp:latest.row.endTimestamp};
}
function run(){
  const args=parseArgs(process.argv.slice(2));
  const {candidate,result:priorResult}=candidateData(args.candidate);
  const identity=sourceIdentity();
  const protectedBefore=protectedHashes();
  const budgetBefore=validateStage2lBudget();
  const completedPath=args.output;
  if(fs.existsSync(completedPath)){
    const saved=read(completedPath);
    if(saved.candidateId!==candidate.candidateId||canonical(saved.parameters)!==canonical(candidate.parameters)
        ||saved.sourceRevision!==identity.sourceRevision||saved.stage2mEvaluatorSha256!==identity.stage2mEvaluatorSha256
        ||JSON.stringify(saved.protectedEvidenceSha256)!==JSON.stringify(protectedBefore)||saved.complete!==true)
      throw new Error('BLOCKED_STAGE2M_REUSE_PROVENANCE: existing output does not match the completed diagnostic identity');
    process.stdout.write(JSON.stringify({status:'REUSED_COMPLETE_EVIDENCE',builds:0,physicalCandidateDelta:0,combinations:saved.combinations.length})+'\n');
    return saved;
  }
  if(args.dryRun){
    process.stdout.write(JSON.stringify({status:'DRY_RUN_PASS',candidateId:candidate.candidateId,sourceRevision:identity.sourceRevision,
      combinations:FACTORS.map(x=>x.label),plannedCells:8*(MIDI45_VELOCITIES.length+2),builds:0,physicalRenders:0,
      candidateBudgetBefore:budgetBefore.candidateIdentities,candidateBudgetAfter:budgetBefore.candidateIdentities,
      candidateBudgetMaximum:budgetBefore.maximumCandidateIdentities,protectedHashCount:Object.keys(protectedBefore).length})+'\n');
    return null;
  }
  if(fs.existsSync(args.buildRoot))throw new Error('BLOCKED_STAGE2M_INCOMPLETE_SCRATCH: build root exists without a complete reusable result');
  fs.mkdirSync(args.buildRoot,{recursive:true});
  const sourceRoot=path.join(args.buildRoot,'source');
  const scratchWasm=path.join(sourceRoot,'wasm');
  fs.mkdirSync(sourceRoot,{recursive:true});
  fs.cpSync(path.join(ROOT,'wasm'),scratchWasm,{recursive:true,errorOnExist:true,force:false});
  const cborRel='web-player/src/js/plugin-cbor.js';
  const scratchCbor=path.join(sourceRoot,cborRel);fs.mkdirSync(path.dirname(scratchCbor),{recursive:true});fs.copyFileSync(path.join(ROOT,cborRel),scratchCbor);
  process.env.SUPERSYNTH_CALIBRATION_SEARCH_SPACE=SEARCH_REL;
  const {writeCandidatePresets}=require('../tuning/candidate-overlay.cjs');
  const candidatePresetPath=path.join(scratchWasm,'plugins/dsp/super-synth/presets.json');
  const overlay=writeCandidatePresets(path.join(ROOT,'wasm/plugins/dsp/super-synth/presets.json'),candidatePresetPath,candidate.parameters);
  const configSha256=overlay.configSha256;
  const scratchBuild=path.join(args.buildRoot,'build');
  runLogged(['cmake','-S',scratchWasm,'-B',scratchBuild,`-DCMAKE_TOOLCHAIN_FILE=${path.join(ROOT,'wasm/cmake/wasm32-clang.cmake')}`,
    '-DBUILD_TESTING=ON','-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON','-DSORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=ON',
    '-DSORAOTO_FORCE_SCALAR_GRAND=OFF'],ROOT,path.join(args.buildRoot,'configure.log'));
  runLogged(['cmake','--build',scratchBuild,'--target','soraoto_dsp_super_synth'],ROOT,path.join(args.buildRoot,'build.log'));
  const wasmPath=path.join(scratchBuild,'plugins/dsp/super-synth/plugin.wasm');
  const wasmSha256=digestFile(wasmPath);
  const {captureMatrix}=require(path.join(scratchWasm,'plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs'));
  const priorBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=scratchBuild;
  const cells=[...MIDI45_VELOCITIES.map(velocity=>({pitch:45,velocity})),{pitch:108,velocity:14},{pitch:21,velocity:14}];
  const fixture=read(path.join(scratchWasm,'plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'));
  const refMap=new Map(fixture.directCells.map(cell=>[`${cell.pitch}:${cell.velocity}`,cell.metrics]));
  const combinations=[];
  try{
    for(const factor of FACTORS){
      const captured=captureMatrix({cells,includePitchHealth:true,stage2mFactorMask:factor.mask,
        onProgress:(pitch,count)=>process.stderr.write(`Stage2M ${factor.label}: ${pitch}:${count} / ${cells.length}\n`)});
      const rowMap=new Map(captured.matrix.map(cell=>[`${cell.pitch}:${cell.velocity}`,cell.metrics]));
      if(rowMap.size!==cells.length)throw new Error(`Stage2M ${factor.label}: expected ${cells.length} unique cells`);
      const midi45=MIDI45_VELOCITIES.map(velocity=>{
        const metrics=rowMap.get(`45:${velocity}`),reference=refMap.get(`45:${velocity}`);
        if(!metrics||!reference)throw new Error(`Stage2M ${factor.label}: missing MIDI45 ${velocity}`);
        return {velocity,level80to200Dbfs:metrics.envelopeDbfs[3],level200to350Dbfs:metrics.envelopeDbfs[4],
          peakDbfs:metrics.fullRenderPeakDbfs??metrics.peakDbfs,finite:metrics.finite,guardHits:metrics.outputGuardHits,
          pitchEstimator:metrics.pitchMeasurement,hammer:metrics.stage2mHammer,
          reference80to200Dbfs:reference.envelopeDbfs[3],reference200to350Dbfs:reference.envelopeDbfs[4]};
      });
      const c8=rowMap.get('108:14'),c8Reference=refMap.get('108:14'),midi21=rowMap.get('21:14');
      if(!c8||!c8Reference||!midi21||!midi21.stage2mPitchProbe)throw new Error(`Stage2M ${factor.label}: required C8/MIDI21 probe missing`);
      const residuals=require(path.join(scratchWasm,'plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs'))
        .postAttackResiduals(c8,c8Reference);
      const peakWorstDbfs=Math.max(...[...midi45.map(item=>item.peakDbfs),c8.fullRenderPeakDbfs??c8.peakDbfs,midi21.fullRenderPeakDbfs??midi21.peakDbfs]);
      const guardHits=[...midi45.map(item=>item.guardHits||0),c8.outputGuardHits||0,midi21.outputGuardHits||0].reduce((a,b)=>a+b,0);
      const finite=[...midi45.map(item=>item.finite),c8.finite,midi21.finite].every(Boolean);
      combinations.push({mask:factor.mask,label:factor.label,factors:{N:factor.N,V:factor.V,H:factor.H},
        midi45,c8:{envelopeDbfs:c8.envelopeDbfs,earlyResidualDb:residuals.earlyResidualDb,lateResidualDb:residuals.lateResidualDb,
          postAttackShapeErrorDb:residuals.postAttackShapeErrorDb,postAttackShapeViolationDb:residuals.postAttackShapeErrorDb-10,
          peakDbfs:c8.fullRenderPeakDbfs??c8.peakDbfs,finite:c8.finite,guardHits:c8.outputGuardHits,
          level80to200Dbfs:c8.envelopeDbfs[3],level200to350Dbfs:c8.envelopeDbfs[4]},
        midi21:{pitchMeasurement:midi21.pitchMeasurement,...midi21.stage2mPitchProbe,
          peakDbfs:midi21.fullRenderPeakDbfs??midi21.peakDbfs,finite:midi21.finite,guardHits:midi21.outputGuardHits},
        diagnostics:{peakWorstDbfs,guardHits,finite}});
      process.stderr.write(`Stage2M ${factor.label} completed\n`);
    }
  }finally{
    if(priorBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;
  }
  const protectedAfter=protectedHashes();
  if(JSON.stringify(protectedBefore)!==JSON.stringify(protectedAfter))throw new Error('BLOCKED_PROTECTED_EVIDENCE_CHANGED');
  const budgetAfter=validateStage2lBudget();
  if(JSON.stringify(budgetBefore)!==JSON.stringify(budgetAfter))
    throw new Error('BLOCKED_STAGE2M_BUDGET: revision-2 candidate budget is not exactly 1/12');
  const output={schemaVersion:1,complete:true,diagnosticOnly:true,candidateId:candidate.candidateId,parameters:candidate.parameters,
    candidateBudgetBefore:1,candidateBudgetAfter:1,candidateCountDelta:0,gpsamplerTrialsCreated:0,
    sourceRevision:identity.sourceRevision,sourceDirty:identity.sourceDirty,stage2mEvaluatorSha256:identity.stage2mEvaluatorSha256,
    pluginSha256:identity.pluginSha256,presetSha256:identity.presetSha256,searchSpaceSha256:identity.searchSpaceSha256,
    referenceFixtureSha256:identity.referenceFixtureSha256,configSha256,wasmSha256,productionSimd:true,
    factorDefinition:{maskBits:{N:0,V:1,H:2},bitValue1:'revision-2',bitValue0:'legacy'},
    combinations,protectedEvidenceSha256:protectedAfter,protectedHashCount:Object.keys(protectedAfter).length,
    stage2lCandidateBudgetObserved:{before:budgetBefore,after:budgetAfter},
    stage2lCandidateSha256:digestFile(args.candidate),priorStage2lResultSha256:digestFile(path.join(STAGE2L_ROOT,'results/stage2l-r2-candidate-01.json')),
    ordinaryWasmBeforeSha256:identity.ordinaryWasmSha256,ordinaryWasmAfterSha256:digestFile(path.join(ROOT,'build/wasm/plugins/dsp/super-synth/plugin.wasm')),
    feasible:false,promotionEligible:false};
  write(completedPath,output);
  process.stdout.write(JSON.stringify({status:'COMPLETE_DIAGNOSTIC_ONLY',combinations:combinations.length,candidateCountDelta:0,
    wasmSha256,configSha256,protectedHashCount:output.protectedHashCount,physicalCells:8*cells.length})+'\n');
  return output;
}

try{run();}catch(error){process.stderr.write(`Stage2M capture ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}
