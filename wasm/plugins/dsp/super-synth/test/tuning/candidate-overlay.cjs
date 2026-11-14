'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../../../../../');
const PRESETS_PATH = path.join(REPO, 'wasm/plugins/dsp/super-synth/presets.json');
const SPACE_PATH = process.env.SUPERSYNTH_CALIBRATION_SEARCH_SPACE
  ? path.resolve(REPO, process.env.SUPERSYNTH_CALIBRATION_SEARCH_SPACE)
  : path.join(__dirname, 'active-search-space.json');
const SPACE = JSON.parse(fs.readFileSync(SPACE_PATH, 'utf8'));
const PRESETS = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
const BASE_PRESET = PRESETS[SPACE.preset];
const C4_KEY = (60 - 21) / 87;

function close(a, b, tolerance = 1e-12) {
  return Math.abs(a - b) <= tolerance;
}

function baselineFor(name, preset = BASE_PRESET) {
  if (name === 'effective_strike_position_c4') {
    const string = preset.engine_config.string;
    return string.strike_position_bass
      + (string.strike_position_treble - string.strike_position_bass) * C4_KEY;
  }
  if (name === 'hammer.compression_scale') return preset.engine_config.hammer.compression_scale;
  if (name === 'hammer.velocity_hardness_amount') return preset.engine_config.hammer.velocity_hardness_amount;
  if (name === 'termination_loss_floor_scale') return 1.0;
  return preset[name];
}

function validateSearchSpace(preset = BASE_PRESET) {
  if (!preset || !preset.engine_config) throw new Error('concert_grand engine_config is missing');
  if (preset.engine_config.hammer.force_scale !== 300) throw new Error('hammer.force_scale must remain FIXED_CALIBRATED=300');
  const hasVelocityHardness=SPACE.dimensions.some(item=>item.name==='hammer.velocity_hardness_amount');
  const hasTerminationFloor=SPACE.dimensions.some(item=>item.name==='termination_loss_floor_scale');
  const expectedCount=6+(hasVelocityHardness?1:0)+(hasTerminationFloor?1:0);
  if (SPACE.dimensions.length !== expectedCount) throw new Error(`expected exactly ${expectedCount} calibration dimensions, got ${SPACE.dimensions.length}`);
  const names = new Set();
  for (const dimension of SPACE.dimensions) {
    if (names.has(dimension.name)) throw new Error(`duplicate QMC dimension ${dimension.name}`);
    names.add(dimension.name);
    if (dimension.type !== 'float' || dimension.scale !== 'linear'
      || !Number.isFinite(dimension.min) || !Number.isFinite(dimension.max)
      || !Number.isFinite(dimension.baseline) || dimension.min > dimension.max
      || dimension.baseline < dimension.min || dimension.baseline > dimension.max) {
      throw new Error(`invalid search-space entry ${dimension.name}`);
    }
    const actualBaseline = baselineFor(dimension.name, preset);
    if (!Number.isFinite(actualBaseline) || !close(actualBaseline, dimension.baseline)) {
      throw new Error(`${dimension.name} baseline changed: search-space=${dimension.baseline}, preset=${actualBaseline}`);
    }
  }
  const expected = [
    'piano_hammer_hardness', 'hammer.compression_scale', 'effective_strike_position_c4',
    'piano_string_damping', 'piano_string_unison', 'piano_inharmonicity'
  ];
  if (hasVelocityHardness) expected.push('hammer.velocity_hardness_amount');
  if (hasTerminationFloor) expected.push('termination_loss_floor_scale');
  if (expected.some(name => !names.has(name))) throw new Error('search space does not contain the six authorized dimensions');
  if(hasTerminationFloor){
    const floor=SPACE.dimensions.find(item=>item.name==='termination_loss_floor_scale');
    if(SPACE.dimensions.at(-1)!==floor||floor.min!==0||floor.max!==1||floor.baseline!==1) {
      throw new Error('termination_loss_floor_scale must be the final [0,1] calibration-only dimension with baseline 1');
    }
  }
  for (const name of ['piano_hammer_hardness', 'piano_string_damping', 'piano_string_unison', 'piano_inharmonicity']) {
    const value = preset[name];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
  }
  return true;
}

function deriveCandidate(parameters, preset = BASE_PRESET) {
  validateSearchSpace(preset);
  const authorized = new Set(SPACE.dimensions.map(item => item.name));
  const expectedCount=authorized.size;
  const supplied = Object.keys(parameters || {}).sort();
  const expected = [...authorized].sort();
  if (JSON.stringify(supplied) !== JSON.stringify(expected)) {
    throw new Error(`candidate must provide exactly the ${expectedCount} authorized fields; got ${supplied.join(',')}`);
  }
  for (const dimension of SPACE.dimensions) {
    const value = parameters[dimension.name];
    if (!Number.isFinite(value) || value < dimension.min || value > dimension.max) {
      throw new RangeError(`${dimension.name}=${value} is outside [${dimension.min},${dimension.max}]`);
    }
  }

  const baselineString = preset.engine_config.string;
  const baselineStrikeC4 = baselineFor('effective_strike_position_c4', preset);
  const delta = parameters.effective_strike_position_c4 - baselineStrikeC4;
  const strikeBass = baselineString.strike_position_bass + delta;
  const strikeTreble = baselineString.strike_position_treble + delta;
  const interpolatedC4 = strikeBass + (strikeTreble - strikeBass) * C4_KEY;
  if (!close(interpolatedC4, parameters.effective_strike_position_c4, 1e-10)) {
    throw new Error(`C4 strike mapping mismatch: expected ${parameters.effective_strike_position_c4}, got ${interpolatedC4}`);
  }
  if (!close(strikeTreble - strikeBass,
    baselineString.strike_position_treble - baselineString.strike_position_bass, 1e-12)) {
    throw new Error('strike endpoint mapping changed the bass-to-treble slope');
  }

  const next = JSON.parse(JSON.stringify(preset));
  next.piano_hammer_hardness = parameters.piano_hammer_hardness;
  next.piano_string_damping = parameters.piano_string_damping;
  next.piano_string_unison = parameters.piano_string_unison;
  next.piano_inharmonicity = parameters.piano_inharmonicity;
  next.engine_config.hammer.compression_scale = parameters['hammer.compression_scale'];
  if (authorized.has('hammer.velocity_hardness_amount')) {
    next.engine_config.hammer.velocity_hardness_amount = parameters['hammer.velocity_hardness_amount'];
  }
  next.engine_config.string.strike_position_bass = strikeBass;
  next.engine_config.string.strike_position_treble = strikeTreble;
  const terminationFloors={};
  if(authorized.has('termination_loss_floor_scale')){
    const scale=parameters.termination_loss_floor_scale;
    const agraffe=next.engine_config.string.agraffe,bridge=next.engine_config.string.bridge_termination;
    terminationFloors.agraffeDampingBase=agraffe.damping_base*scale;
    terminationFloors.bridgeDampingBase=bridge.damping_base*scale;
    agraffe.damping_base=terminationFloors.agraffeDampingBase;
    bridge.damping_base=terminationFloors.bridgeDampingBase;
  }
  if (next.engine_config.hammer.force_scale !== 300) throw new Error('candidate changed the fixed hammer force scale');
  return {
    preset: next,
    parameters: {...parameters},
    derived: {
      strikePositionBass: strikeBass,
      strikePositionTreble: strikeTreble,
      strikePositionC4: interpolatedC4,
      strikeOffset: delta,
      strikeSlope: strikeTreble - strikeBass,
      ...(authorized.has('termination_loss_floor_scale')?{
        terminationLossFloorScale:parameters.termination_loss_floor_scale,
        terminationFloors
      }:{})
    }
  };
}

function applyCandidateToPresets(presetsDocument, parameters) {
  if (!presetsDocument || !presetsDocument[SPACE.preset]) throw new Error(`preset ${SPACE.preset} missing`);
  const result = JSON.parse(JSON.stringify(presetsDocument));
  const derived = deriveCandidate(parameters, result[SPACE.preset]);
  result[SPACE.preset] = derived.preset;
  return {...derived, presetsDocument: result};
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function writeCandidatePresets(sourcePresetsPath, outputPresetsPath, parameters) {
  const original = JSON.parse(fs.readFileSync(sourcePresetsPath, 'utf8'));
  const result = applyCandidateToPresets(original, parameters);
  const text = `${JSON.stringify(result.presetsDocument, null, 2)}\n`;
  fs.mkdirSync(path.dirname(outputPresetsPath), {recursive: true});
  const temporary = `${outputPresetsPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, outputPresetsPath);
  return {...result, configSha256: require('node:crypto').createHash('sha256').update(text).digest('hex')};
}

validateSearchSpace();

module.exports = {
  REPO,
  SPACE,
  PRESETS_PATH,
  BASE_PRESET,
  baselineFor,
  validateSearchSpace,
  deriveCandidate,
  applyCandidateToPresets,
  canonicalJson,
  writeCandidatePresets
};
