#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {captureMatrix} = require('./capture-supersynth-matrix.cjs');
const {SPACE} = require('../tuning/candidate-overlay.cjs');

function parseArgs(argv) {
  const args={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!['--scratch-matrix','--output'].includes(key)||!argv[i+1])throw new Error('Usage: verify-qmc-scratch-equivalence.cjs --scratch-matrix <matrix.json> --output <report.json>');
    args[key.slice(2)]=path.resolve(argv[++i]);
  }
  if(!args['scratch-matrix']||!args.output)throw new Error('scratch-matrix and output are required');
  return args;
}

function differences(a,b,prefix='') {
  const out=[];
  if(typeof a==='number'&&typeof b==='number'){
    if(!Object.is(a,b))out.push({path:prefix,production:a,scratch:b,absoluteDifference:Math.abs(a-b)});
    return out;
  }
  if(Array.isArray(a)&&Array.isArray(b)){
    if(a.length!==b.length)out.push({path:`${prefix}.length`,production:a.length,scratch:b.length});
    for(let i=0;i<Math.min(a.length,b.length);i++)out.push(...differences(a[i],b[i],`${prefix}[${i}]`));
    return out;
  }
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    const keys=new Set([...Object.keys(a),...Object.keys(b)]);
    for(const key of keys){
      if(!(key in a)||!(key in b))out.push({path:`${prefix}.${key}`,production:key in a,scratch:key in b});
      else out.push(...differences(a[key],b[key],prefix?`${prefix}.${key}`:key));
    }
    return out;
  }
  if(a!==b)out.push({path:prefix,production:a,scratch:b});
  return out;
}

function run() {
  const args=parseArgs(process.argv.slice(2));
  const scratch=JSON.parse(fs.readFileSync(args['scratch-matrix'],'utf8'));
  const production=captureMatrix({pitches:SPACE.screening.pitches,velocities:SPACE.screening.velocities,
    includePitchHealth:true,includeCalibrationDiagnostics:true});
  const mismatches=differences({matrix:production.matrix,diagnostics:production.diagnostics},
    {matrix:scratch.matrix,diagnostics:scratch.diagnostics});
  const report={schemaVersion:1,comparison:'ordinary production SIMD build vs current-value scratch-overlay build',
    productionWasmSha256:production.render.wasmSha256,scratchWasmSha256:scratch.render.wasmSha256,
    wasmByteIdentical:production.render.wasmSha256===scratch.render.wasmSha256,
    matrixCells:production.matrix.length,exactMetricMismatches:mismatches.length,mismatches:mismatches.slice(0,20),
    pass:production.matrix.length===15&&scratch.matrix.length===15&&mismatches.length===0};
  fs.mkdirSync(path.dirname(args.output),{recursive:true});
  fs.writeFileSync(args.output,`${JSON.stringify(report,null,2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if(!report.pass)process.exitCode=1;
}

if(require.main===module){try{run();}catch(error){process.stderr.write(`scratch equivalence failed: ${error.stack||error.message}\n`);process.exitCode=1;}}
module.exports={differences};
