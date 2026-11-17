'use strict';

const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../../../');
const space = path.join(root, 'wasm/plugins/dsp/super-synth/test/tuning/stage2d-velocity-hardness-search-space.json');
const overlay = path.join(root, 'wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs');

function run() {
  const script = `
    const assert = require('node:assert/strict');
    const {BASE_PRESET, SPACE, deriveCandidate, validateSearchSpace} = require(${JSON.stringify(overlay)});
    assert.equal(SPACE.dimensions.length, 7);
    validateSearchSpace();
    const params = Object.fromEntries(SPACE.dimensions.map(d => [d.name, d.baseline]));
    const baseline = deriveCandidate(params).preset;
    assert.deepEqual(baseline, BASE_PRESET);
    for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
      const candidate = {...params, 'hammer.velocity_hardness_amount': amount};
      assert.equal(deriveCandidate(candidate).preset.engine_config.hammer.velocity_hardness_amount, amount);
    }
    for (const amount of [-1e-9, 1 + 1e-9]) {
      const candidate = {...params, 'hammer.velocity_hardness_amount': amount};
      assert.throws(() => deriveCandidate(candidate), /outside/);
    }
    assert.throws(() => deriveCandidate({...params, 'hammer.velocity_span_scale': 1}), /exactly/);
    process.stdout.write('PASS');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: {...process.env, SUPERSYNTH_CALIBRATION_SEARCH_SPACE: space}
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'PASS');
  process.stdout.write(JSON.stringify({result: 'PASS', dimensions: 7,
    baselineTransparent: true, amountBounds: [0, 1], rejectedVelocitySpan: true}) + '\n');
}

if (require.main === module) run();
module.exports = {run};
