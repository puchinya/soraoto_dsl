'use strict';

const assert = require('node:assert/strict');
const {
  BASE_PRESET, SPACE, deriveCandidate, validateSearchSpace
} = require('./candidate-overlay.cjs');

function baselineParameters() {
  return Object.fromEntries(SPACE.dimensions.map(item => [item.name, item.baseline]));
}

function checkCandidate(parameters) {
  const {preset, derived} = deriveCandidate(parameters);
  assert.ok(Math.abs(derived.strikePositionC4 - parameters.effective_strike_position_c4) <= 1e-10);
  assert.ok(Math.abs(derived.strikeSlope - (BASE_PRESET.engine_config.string.strike_position_treble
    - BASE_PRESET.engine_config.string.strike_position_bass)) <= 1e-12);
  assert.equal(preset.engine_config.hammer.force_scale, 300);
  assert.equal(preset.engine_config.hammer.compression_scale, parameters['hammer.compression_scale']);
  return {preset, derived};
}

function run() {
  validateSearchSpace();
  const baseline = baselineParameters();
  const baselineApplied = checkCandidate(baseline).preset;
  assert.deepEqual(baselineApplied, BASE_PRESET, 'baseline overlay must preserve the entire authoritative preset');

  for (const strike of [0.13, 0.14958620689655173, 0.17]) {
    const candidate = {...baseline, effective_strike_position_c4: strike};
    const {preset, derived} = checkCandidate(candidate);
    assert.equal(preset.engine_config.string.strike_position_bass,
      BASE_PRESET.engine_config.string.strike_position_bass + derived.strikeOffset);
    assert.equal(preset.engine_config.string.strike_position_treble,
      BASE_PRESET.engine_config.string.strike_position_treble + derived.strikeOffset);
  }

  const changed = {...baseline,
    piano_hammer_hardness: 0.42,
    'hammer.compression_scale': 0.0015,
    effective_strike_position_c4: 0.16,
    piano_string_damping: 0.37,
    piano_string_unison: 0.81,
    piano_inharmonicity: 0.64
  };
  if (Object.hasOwn(changed, 'termination_loss_floor_scale')) changed.termination_loss_floor_scale = 0.5;
  const output = checkCandidate(changed).preset;
  for (const name of ['piano_hammer_hardness', 'piano_string_damping', 'piano_string_unison', 'piano_inharmonicity']) {
    assert.equal(output[name], changed[name]);
  }
  for (const name of ['kind', 'revision']) assert.equal(output.engine_config[name], BASE_PRESET.engine_config[name]);
  for (const key of ['stiffness_soft', 'stiffness_hard', 'mass_soft', 'mass_hard', 'contact_loss_soft', 'contact_loss_hard']) {
    assert.equal(output.engine_config.hammer[key], BASE_PRESET.engine_config.hammer[key], `${key} must remain fixed`);
  }
  if (Object.hasOwn(changed, 'termination_loss_floor_scale')) {
    assert.equal(output.engine_config.string.agraffe.damping_base,
      BASE_PRESET.engine_config.string.agraffe.damping_base * 0.5);
    assert.equal(output.engine_config.string.bridge_termination.damping_base,
      BASE_PRESET.engine_config.string.bridge_termination.damping_base * 0.5);
    assert.equal(output.engine_config.string.agraffe.damping_coefficient,
      BASE_PRESET.engine_config.string.agraffe.damping_coefficient);
    assert.equal(output.engine_config.string.bridge_termination.damping_coefficient,
      BASE_PRESET.engine_config.string.bridge_termination.damping_coefficient);
  }
  assert.throws(() => deriveCandidate({...baseline, piano_hammer_noise: 0.2}), new RegExp(`exactly the ${SPACE.dimensions.length} authorized fields`));
  assert.throws(() => deriveCandidate({...baseline, piano_hammer_hardness: 1.01}), /outside/);
  console.log(JSON.stringify({result: 'PASS', baselineTransparent: true, strikePointsTested: 3,
    commonOffsetPreservesSlope: true, dimensionsOnly: SPACE.dimensions.map(item=>item.name)}));
}

if (require.main === module) run();
module.exports = {run};
