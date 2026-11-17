'use strict';

const assert=require('node:assert/strict');
const {captureMatrix}=require('./capture-supersynth-matrix.cjs');

const production=process.env.SORAOTO_PRODUCTION_BUILD_ROOT;
const diagnostic=process.env.SORAOTO_DIAGNOSTIC_BUILD_ROOT;
if(!production||!diagnostic)throw new Error('set SORAOTO_PRODUCTION_BUILD_ROOT and SORAOTO_DIAGNOSTIC_BUILD_ROOT');
function capture(buildRoot){
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR=buildRoot;
  try{return captureMatrix({pitches:[60],velocities:[85]}).matrix[0].metrics;}
  finally{if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;}
}
const productionMetrics=capture(production);
const diagnosticMetrics=capture(diagnostic);
const productionSignalMetrics={...productionMetrics};
const diagnosticSignalMetrics={...diagnosticMetrics};
delete productionSignalMetrics.outputGuardHits;
delete diagnosticSignalMetrics.outputGuardHits;
assert.deepEqual(diagnosticSignalMetrics,productionSignalMetrics,'diagnostic instrumentation changed the production SIMD render');
assert.equal(diagnosticMetrics.outputGuardHits,0,'diagnostic build reports unexpected output-guard activation');
console.log('PASS soundboard diagnostic build preserves production audio metrics exactly; guard instrumentation reports zero hits');
