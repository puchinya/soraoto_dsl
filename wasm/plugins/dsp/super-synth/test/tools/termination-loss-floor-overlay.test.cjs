'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const {SPACE,PRESETS_PATH,baselineFor}=require('../tuning/candidate-overlay.cjs');
const {FLOOR_PATHS,SLOPE_PATHS,applyTerminationLossFloorScale,createCandidatePreset,encodePresets,configSha256}=require('./termination-loss-floor-overlay.cjs');

const source=JSON.parse(fs.readFileSync(PRESETS_PATH,'utf8'));
const baseline=JSON.parse(JSON.stringify(source));
const preset=baseline[SPACE.preset];
const get=(root,parts)=>parts.reduce((value,key)=>value[key],root);
const set=(root,parts,value)=>{parts.slice(0,-1).reduce((value,key)=>value[key],root)[parts.at(-1)]=value;};
const parameters=Object.fromEntries(SPACE.dimensions.map(dimension=>[dimension.name,baselineFor(dimension.name,preset)]));
parameters['hammer.velocity_hardness_amount']=0;

const one=applyTerminationLossFloorScale(baseline,1);
assert.deepEqual(one.presetsDocument,baseline,'scale 1 must preserve the input config byte-value structure');
const zero=applyTerminationLossFloorScale(baseline,0);
for(const parts of FLOOR_PATHS)assert.equal(get(zero.presetsDocument[SPACE.preset],parts),0);
for(const parts of SLOPE_PATHS)assert.equal(get(zero.presetsDocument[SPACE.preset],parts),get(baseline[SPACE.preset],parts));
assert.deepEqual(zero.presetsDocument[SPACE.preset].engine_config.string.reference_loss_base,
  baseline[SPACE.preset].engine_config.string.reference_loss_base,'reference loss must be unchanged');
const restored=JSON.parse(JSON.stringify(zero.presetsDocument));
for(const parts of FLOOR_PATHS)set(restored[SPACE.preset],parts,get(baseline[SPACE.preset],parts));
assert.deepEqual(restored,baseline,'the overlay may alter only the two damping_base floors');
for(const scale of [0,.25,.5,.75,1])assert.equal(applyTerminationLossFloorScale(baseline,scale).scale,scale);
for(const scale of [-.01,1.01,NaN])assert.throws(()=>applyTerminationLossFloorScale(baseline,scale),RangeError);

const center=createCandidatePreset(source,parameters,1);
assert.deepEqual(center.presetsDocument,source,'candidate overlay at baseline values must preserve authoritative config');
assert.equal(configSha256(center.presetsDocument),configSha256(source));
assert.equal(encodePresets(center.presetsDocument).endsWith('\n'),true);
console.log('PASS termination floor overlay preserves all but the two preset-owned zero-damping floors');
