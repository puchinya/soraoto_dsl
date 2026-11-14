#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {postAttackResiduals}=require('./stage3-direct-reference-metrics.cjs');

const SAMPLE_RATE=48000, BLOCK=2048, DURATION_MS=380;
const DIAGNOSTIC_NAMES=[
  'bridge_b','bridge_m','bridge_t','board_drive_b','board_drive_m','board_drive_t',
  'modal_l','modal_r','residual_l','residual_r','pre_radiation_l','pre_radiation_r',
  'post_radiation_l','post_radiation_r','dry_transverse','dry_bridge','dry_contact',
  'dry_longitudinal','dry_mix','longitudinal_bridge_drive'
];
const REQUIRED_EXPORTS=[
  'soraoto_supersynth_diagnostic_set_ablation_mask',
  'soraoto_supersynth_soundboard_diag_reset',
  'soraoto_supersynth_soundboard_diag_sum_squares',
  'soraoto_supersynth_soundboard_diag_peak',
  'soraoto_supersynth_soundboard_diag_frames',
  'soraoto_supersynth_guard_hit_count'
];
const VARIANTS=Object.freeze([
  {name:'normal',mask:0,boardMix:null},
  {name:'board_off',mask:0,boardMix:0},
  {name:'board_off_no_dry_transverse',mask:1,boardMix:0},
  {name:'board_off_no_dry_bridge',mask:2,boardMix:0},
  {name:'board_off_no_dry_contact',mask:4,boardMix:0}
]);

function parseArgs(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--check-exports') { out.checkExports=true; continue; }
    if(!['--repo-root','--candidate-build','--candidate','--output','--wasm'].includes(key)||!argv[i+1])
      throw new Error('Usage: capture-stage2j-c8-path.cjs --repo-root <root> --candidate-build <build> --candidate <candidate.json> --output <result.json> | --check-exports --wasm <plugin.wasm>');
    out[key.slice(2)]=argv[++i];
  }
  if(out.checkExports){if(!out.wasm)throw new Error('--wasm is required with --check-exports');return out;}
  for(const name of ['repo-root','candidate-build','candidate','output'])if(!out[name])throw new Error(`--${name} is required`);
  for(const name of ['repo-root','candidate-build','candidate','output'])out[name]=path.resolve(out[name]);
  return out;
}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`);fs.renameSync(tmp,file);}
function dbfs(value){return value>0?20*Math.log10(value):-240;}

function checkWasmExports(wasmPath){
  const module=new WebAssembly.Module(fs.readFileSync(wasmPath));
  const exports=new Set(WebAssembly.Module.exports(module).map(row=>row.name));
  const missing=REQUIRED_EXPORTS.filter(name=>!exports.has(name));
  if(missing.length)throw new Error(`required diagnostic exports missing: ${missing.join(', ')}`);
  return {status:'PASS',requiredExports:REQUIRED_EXPORTS,wasmSha256:sha(fs.readFileSync(wasmPath))};
}
function buildRootFromWasm(wasmPath){return path.resolve(path.dirname(wasmPath),'../../../');}

function setMask(harness,mask){
  const setter=harness.e.soraoto_supersynth_diagnostic_set_ablation_mask;
  if(typeof setter!=='function')throw new Error('diagnostic ablation mask export is unavailable');
  setter(mask);
}
function withAblationMask(harness,mask,action){
  let actionError;
  try{setMask(harness,mask);return action();}
  catch(error){actionError=error;throw error;}
  finally{try{setMask(harness,0);}catch(resetError){if(!actionError)throw resetError;}}
}

function renderVariant({repoRoot,wasmPath,parameters,reference,variant,normalBoardMix}){
  const {PluginHarness}=require(path.join(repoRoot,'wasm/test/helpers/plugin-harness.cjs'));
  const {analyzeStereo}=require(path.join(repoRoot,'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs'));
  const priorBuild=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=buildRootFromWasm(wasmPath);
  let harness;
  try{harness=new PluginHarness(repoRoot,'plugins/dsp/super-synth/plugin.wasm',{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});}
  catch(error){if(priorBuild===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=priorBuild;throw error;}
  const before=typeof harness.e.soraoto_supersynth_guard_hit_count==='function'
    ?harness.e.soraoto_supersynth_guard_hit_count():null;
  let thrown;
  try{
    for(const name of REQUIRED_EXPORTS)if(typeof harness.e[name]!=='function')throw new Error(`required diagnostic export missing ${name}`);
    harness.applyPreset('concert_grand');
    for(const [name,value]of [['voice_drift',0],['lfo1_pitch',0],['chorus_mix',0],...Object.entries(parameters)])harness.setPlain(name,value);
    if(variant.boardMix!==null)harness.setPlain('piano_soundboard_mix',variant.boardMix);
    harness.e.soraoto_supersynth_soundboard_diag_reset();
    return withAblationMask(harness,variant.mask,()=>{
      const frames=Math.floor(SAMPLE_RATE*DURATION_MS/1000),left=new Float32Array(frames),right=new Float32Array(frames);
      let position=0,finite=true,peak=0;
      while(position<frames){
        const count=Math.min(BLOCK,frames-position);
        const events=position===0?[{kind:1,noteId:1,pitch:108,velocity:14/127,offset:0}]:[];
        const outputs=harness.process(count,{events})[0];
        left.set(outputs[0],position);right.set(outputs[1],position);
        for(let index=0;index<count;index++){
          const l=outputs[0][index],r=outputs[1][index];
          if(!Number.isFinite(l)||!Number.isFinite(r))finite=false;
          peak=Math.max(peak,Math.abs(l),Math.abs(r));
        }
        position+=count;
      }
      const metrics=analyzeStereo(left,right,108,{sampleRate:SAMPLE_RATE});
      const guardHits=before===null?null:harness.e.soraoto_supersynth_guard_hit_count()-before;
      const diagnosticFrames=harness.e.soraoto_supersynth_soundboard_diag_frames()>>>0;
      const soundboardDiagnostics={frames:diagnosticFrames,signals:Object.fromEntries(DIAGNOSTIC_NAMES.map((name,index)=>{
        const sum=harness.e.soraoto_supersynth_soundboard_diag_sum_squares(index)||0;
        return [name,{rms:Math.sqrt(sum/Math.max(1,diagnosticFrames)),peak:harness.e.soraoto_supersynth_soundboard_diag_peak(index)}];
      }))};
      const relative=postAttackResiduals(metrics,reference.metrics);
      const envelopes=metrics.envelopeDbfs;
      return {
        name:variant.name,boardMix:variant.boardMix===null?normalBoardMix:variant.boardMix,ablationMask:variant.mask,
        envelopeDbfs:envelopes,
        level0to10MsDbfs:envelopes[0],level10to30MsDbfs:envelopes[1],
        level30to80MsDbfs:envelopes[2],level80to200MsDbfs:envelopes[3],
        level200to350MsDbfs:envelopes[4],peakDbfs:metrics.peakDbfs,
        fullRenderPeakDbfs:dbfs(peak),finite,outputGuardHits:guardHits,
        soundboardDiagnostics,reference80to200MsDbfs:reference.metrics.envelopeDbfs[3],
        reference200to350MsDbfs:reference.metrics.envelopeDbfs[4],
        renderEarlyRelativeDb:relative.renderEarlyRelDb,referenceEarlyRelativeDb:relative.referenceEarlyRelDb,
        earlyResidualDb:relative.earlyResidualDb,renderLateRelativeDb:relative.renderLateRelDb,
        referenceLateRelativeDb:relative.referenceLateRelDb,lateResidualDb:relative.lateResidualDb,
        postAttackShapeErrorDb:relative.postAttackShapeErrorDb,
        postAttackShapeViolationDb:relative.postAttackShapeErrorDb-10
      };
    });
  }catch(error){thrown=error;throw error;}
  finally{
    try{setMask(harness,0);}catch(resetError){if(!thrown)throw resetError;}
    harness.close();
    if(priorBuild===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR=priorBuild;
  }
}

function capture(args){
  const repo=args['repo-root'],candidateBuild=args['candidate-build'];
  const candidate=JSON.parse(fs.readFileSync(args.candidate,'utf8'));
  const source=path.join(candidateBuild,'source'),build=path.join(candidateBuild,'build');
  const wasm=path.join(build,'plugins/dsp/super-synth/plugin.wasm');
  const fixture=JSON.parse(fs.readFileSync(path.join(repo,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
  const reference=fixture.directCells.find(cell=>cell.pitch===108&&cell.velocity===14);
  if(!reference)throw new Error('pinned fixture is missing C8 velocity 14');
  if(!fs.existsSync(wasm))throw new Error('candidate production-SIMD WASM is missing');
  const wasmProof=checkWasmExports(wasm);
  const preset=JSON.parse(fs.readFileSync(path.join(source,'wasm/plugins/dsp/super-synth/presets.json'),'utf8')).concert_grand;
  if(!Number.isFinite(Number(preset.piano_soundboard_mix)))throw new Error('candidate preset has no piano_soundboard_mix');
  const started=performance.now(),variants=[];
  for(const variant of VARIANTS)variants.push(renderVariant({repoRoot:source,wasmPath:wasm,parameters:{},reference,variant,
    normalBoardMix:Number(preset.piano_soundboard_mix)}));
  return {schemaVersion:1,candidateId:candidate.candidateId,productionSimd:true,
    wasmSha256:wasmProof.wasmSha256,diagnosticExportsValidated:true,fixtureCell:{pitch:108,velocity:14},
    normalBoardMix:preset.piano_soundboard_mix,variantNames:VARIANTS.map(v=>v.name),
    variants,diagnosticOnly:true,stage2PromotionEvidence:false,
    elapsedSeconds:(performance.now()-started)/1000};
}

function main(){
  const args=parseArgs(process.argv.slice(2));
  if(args.checkExports){console.log(JSON.stringify(checkWasmExports(path.resolve(args.wasm))));return;}
  write(args.output,capture(args));
  console.log(JSON.stringify({status:'PASS',candidateId:JSON.parse(fs.readFileSync(args.candidate,'utf8')).candidateId,
    variants:VARIANTS.map(v=>v.name),renders:VARIANTS.length}));
}

if(require.main===module){try{main();}catch(error){console.error(`Stage2J C8 capture ERROR: ${error.stack||error.message}`);process.exitCode=1;}}
module.exports={VARIANTS,REQUIRED_EXPORTS,checkWasmExports,buildRootFromWasm,setMask,withAblationMask,renderVariant,capture};
