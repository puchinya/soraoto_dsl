#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PluginHarness}=require('../../../../../test/helpers/plugin-harness.cjs');

const REPO=path.resolve(__dirname,'../../../../../../');
const WASM='plugins/dsp/super-synth/plugin.wasm';
const SAMPLE_RATE=48000,BLOCK=128;
const WARMUPS=Math.max(3,Number(process.env.SORAOTO_KERNEL_BENCH_WARMUPS||3));
const RUNS=Math.max(10,Number(process.env.SORAOTO_KERNEL_BENCH_RUNS||10));
const ITERATIONS=Math.max(10000,Number(process.env.SORAOTO_KERNEL_BENCH_ITERATIONS||250000));

function percentile(sorted,p){return sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1))];}
function measure(buildDir,kernel){
  process.env.SORAOTO_WASM_BUILD_DIR=buildDir;
  const harness=new PluginHarness(REPO,WASM,{sampleRate:SAMPLE_RATE,maxFrames:BLOCK});
  try{
    harness.applyPreset('concert_grand');
    for(const [name,value] of [['voice_drift',0],['lfo1_pitch',0],['chorus_mix',0]])harness.setPlain(name,value);
    const exportName=kernel==='soundboard'?'soraoto_supersynth_benchmark_soundboard':'soraoto_supersynth_benchmark_sympathetic';
    const bench=harness.e[exportName];if(typeof bench!=='function')throw new Error(`${buildDir}: missing ${exportName}`);
    for(let i=0;i<WARMUPS;i++){const value=bench(ITERATIONS);if(!Number.isFinite(value))throw new Error(`${kernel} warmup returned ${value}`);}
    const times=[],checksums=[];
    for(let i=0;i<RUNS;i++){
      const start=process.hrtime.bigint(),value=bench(ITERATIONS),elapsed=Number(process.hrtime.bigint()-start)/1e6;
      if(!Number.isFinite(value))throw new Error(`${kernel} run returned ${value}`);
      times.push(elapsed);checksums.push(value);
    }
    const sorted=[...times].sort((a,b)=>a-b);
    return {kernel,iterations:ITERATIONS,warmups:WARMUPS,measuredRuns:RUNS,medianMs:percentile(sorted,.5),p90Ms:percentile(sorted,.9),checksums};
  }finally{harness.close();}
}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

function main(){
  const [simdDir,scalarDir,output]=process.argv.slice(2);
  if(!simdDir||!scalarDir||!output)throw new Error('Usage: benchmark-supersynth-v9-kernels.cjs <simd-build-dir> <scalar-build-dir> <output.json>');
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;
  try{
    const simd={},scalar={};
    for(const kernel of ['soundboard','sympathetic']){
      simd[kernel]=measure(path.resolve(simdDir),kernel);
      scalar[kernel]=measure(path.resolve(scalarDir),kernel);
    }
    const report={schemaVersion:1,benchmark:'supersynth-v9-isolated-simd-kernels',runtime:process.version,platform:`${process.platform}-${process.arch}`,sampleRate:SAMPLE_RATE,blockFrames:BLOCK,simdWasmSha256:sha(path.join(path.resolve(simdDir),WASM)),scalarWasmSha256:sha(path.join(path.resolve(scalarDir),WASM)),simd,scalar,speedups:{soundboard:scalar.soundboard.medianMs/simd.soundboard.medianMs,sympathetic:scalar.sympathetic.medianMs/simd.sympathetic.medianMs},requiredSpeedups:{soundboard:1.8,sympathetic:2.0}};
    report.pass=report.speedups.soundboard>=report.requiredSpeedups.soundboard&&report.speedups.sympathetic>=report.requiredSpeedups.sympathetic;
    fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(path.resolve(output),`${JSON.stringify(report,null,2)}\n`);
    process.stdout.write(`${JSON.stringify(report,null,2)}\n`);if(!report.pass)process.exitCode=1;
  }finally{if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;}
}

main();
