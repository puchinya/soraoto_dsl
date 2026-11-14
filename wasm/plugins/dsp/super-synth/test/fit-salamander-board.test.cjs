'use strict';

const assert = require('node:assert/strict');
const { fitRadiationScale, maximumSafeScaleFromComponents, assertCompatibleFitMatrices } = require('./tools/fit-salamander-board.cjs');

const currentScale = 0.1;
const dry = [Float64Array.from([0.5, -0.42, 0.2]), Float64Array.from([-0.1, 0.35, -0.25])];
const wet = [Float64Array.from([0.55, -0.47, 0.24]), Float64Array.from([-0.16, 0.39, -0.3])];
const componentHeadroom = maximumSafeScaleFromComponents(dry, wet, currentScale);
const headroomLimited = fitRadiationScale(currentScale, 33.67, componentHeadroom.maximumSafeScale);
assert.equal(headroomLimited.limitedByHeadroom, true);
assert.equal(headroomLimited.scale, componentHeadroom.maximumSafeScale);
assert(headroomLimited.scale > currentScale, 'component model should allow scale growth when dry output has headroom');
assert(componentHeadroom.limiting !== null, 'component headroom must identify the limiting sample');

const levelLimited = fitRadiationScale(0.5, 0, 0.75);
assert.equal(levelLimited.limitedByHeadroom, false);
assert.equal(levelLimited.scale, 0.5);

const commonRender={calibrationConfigSha256:'same-profile',hammerForceScale:300,preset:'concert_grand',sampleRate:48000};
assert.doesNotThrow(() => assertCompatibleFitMatrices(
  {render:{...commonRender,sourcePluginSha256:'same-code',soundboardBypassed:true}},
  {render:{...commonRender,sourcePluginSha256:'same-code',soundboardBypassed:false,boardRadiationScale:0.0003}}
));
assert.throws(() => assertCompatibleFitMatrices(
  {render:{...commonRender,sourcePluginSha256:'stale-dry-code',soundboardBypassed:true}},
  {render:{...commonRender,sourcePluginSha256:'current-measured-code',soundboardBypassed:false}}
), /disagree on sourcePluginSha256/);

assert.throws(() => fitRadiationScale(0, 0, -6), /positive current/);
assert.throws(() => maximumSafeScaleFromComponents([Float32Array.of(0)], [Float32Array.of(20)], 0.1), /feasible component headroom interval/);
console.log('PASS: board fit uses exact dry-plus-board component headroom and matching capture provenance');
