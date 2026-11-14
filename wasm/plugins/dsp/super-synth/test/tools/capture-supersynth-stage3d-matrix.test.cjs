#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const capture=require('./capture-supersynth-stage3d-matrix.cjs');

assert.deepEqual(capture.velocityDerivativeWindow({velocityDerivativeStartMs:0,velocityDerivativeEndMs:160}),[0,160]);
assert.deepEqual(capture.velocityDerivativeWindow({velocityDerivativeStartMs:30,velocityDerivativeEndMs:180}),[30,180]);
for(const options of [{},{velocityDerivativeStartMs:0},{velocityDerivativeStartMs:5,velocityDerivativeEndMs:5},
  {velocityDerivativeStartMs:-1,velocityDerivativeEndMs:10},{velocityDerivativeStartMs:NaN,velocityDerivativeEndMs:10}])
  assert.throws(()=>capture.velocityDerivativeWindow(options),/must be supplied explicitly and be valid/);

console.log('PASS Stage3D capture requires caller-owned derivative windows');
