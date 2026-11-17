'use strict';

const crypto = require('node:crypto');
const {SPACE,PRESETS_PATH,applyCandidateToPresets} = require('../tuning/candidate-overlay.cjs');

const FLOOR_PATHS = Object.freeze([
  ['engine_config','string','agraffe','damping_base'],
  ['engine_config','string','bridge_termination','damping_base']
]);
const SLOPE_PATHS = Object.freeze([
  ['engine_config','string','agraffe','damping_coefficient'],
  ['engine_config','string','bridge_termination','damping_coefficient']
]);

function at(root,parts) {
  return parts.reduce((value,key)=>value?.[key],root);
}

function setAt(root,parts,value) {
  const owner=parts.slice(0,-1).reduce((parent,key)=>parent[key],root);
  owner[parts.at(-1)]=value;
}

function applyTerminationLossFloorScale(presetsDocument,scale) {
  if(!Number.isFinite(scale)||scale<0||scale>1)throw new RangeError(`termination_loss_floor_scale must be in [0,1], got ${scale}`);
  const next=JSON.parse(JSON.stringify(presetsDocument));
  const preset=next[SPACE.preset];
  if(!preset?.engine_config?.string?.agraffe||!preset.engine_config.string.bridge_termination) {
    throw new Error(`preset ${SPACE.preset} is missing preset-owned termination config`);
  }
  const floors=FLOOR_PATHS.map(parts=>at(preset,parts));
  const slopes=SLOPE_PATHS.map(parts=>at(preset,parts));
  if(floors.some(value=>!Number.isFinite(value)||value<0)||slopes.some(value=>!Number.isFinite(value))) {
    throw new Error('termination floor/slope coefficients must be finite numbers');
  }
  FLOOR_PATHS.forEach((parts,index)=>setAt(preset,parts,floors[index]*scale));
  if(JSON.stringify(SLOPE_PATHS.map(parts=>at(preset,parts)))!==JSON.stringify(slopes)) {
    throw new Error('termination floor overlay changed a damping slope');
  }
  return {
    presetsDocument:next,
    scale,
    baselineFloors:Object.fromEntries(FLOOR_PATHS.map((parts,index)=>[parts.join('.'),floors[index]])),
    candidateFloors:Object.fromEntries(FLOOR_PATHS.map((parts,index)=>[parts.join('.'),at(preset,parts)])),
    slopes:Object.fromEntries(SLOPE_PATHS.map(parts=>[parts.join('.'),at(preset,parts)]))
  };
}

function createCandidatePreset(sourcePresets,centerParameters,scale) {
  const parameters={...centerParameters};
  // The active QMC space has six dimensions. Center A's approved velocity-
  // hardness amount is fixed at zero in the authoritative preset.
  if(!SPACE.dimensions.some(dimension=>dimension.name==='hammer.velocity_hardness_amount')) {
    if(parameters['hammer.velocity_hardness_amount']!==0
        ||sourcePresets[SPACE.preset]?.engine_config?.hammer?.velocity_hardness_amount!==0) {
      throw new Error('Center A must preserve the fixed zero velocity-hardness amount');
    }
    delete parameters['hammer.velocity_hardness_amount'];
  }
  const center=applyCandidateToPresets(sourcePresets,parameters);
  const floored=applyTerminationLossFloorScale(center.presetsDocument,scale);
  return {...center,...floored,preset:floored.presetsDocument[SPACE.preset],presetsDocument:floored.presetsDocument};
}

function encodePresets(presetsDocument) {
  return `${JSON.stringify(presetsDocument,null,2)}\n`;
}

function configSha256(presetsDocument) {
  return crypto.createHash('sha256').update(encodePresets(presetsDocument)).digest('hex');
}

module.exports={FLOOR_PATHS,SLOPE_PATHS,applyTerminationLossFloorScale,createCandidatePreset,encodePresets,configSha256,PRESETS_PATH};
