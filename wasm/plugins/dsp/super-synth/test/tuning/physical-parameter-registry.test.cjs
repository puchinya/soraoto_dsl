'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../../../../../../');
const registry = JSON.parse(fs.readFileSync(path.join(HERE, 'physical-parameter-registry.json'), 'utf8'));
const searchSpace = JSON.parse(fs.readFileSync(path.join(HERE, 'active-search-space.json'), 'utf8'));
const presets = JSON.parse(fs.readFileSync(path.join(REPO, 'wasm/plugins/dsp/super-synth/presets.json'), 'utf8'));
const preset = presets.concert_grand;
const allowed = new Set([
  'FIXED_CALIBRATED', 'FIXED_ARCHITECTURE', 'FIXED_ARCHITECTURE_ENDPOINTS',
  'FIXED_ARCHITECTURE_MAPPING', 'FIXED_ARCHITECTURE_SHAPE', 'FITTER_OWNED',
  'LATE_STAGE_CONTROL', 'OPTIMIZABLE_SEMANTIC_CONTROL', 'OPTIMIZABLE_CALIBRATION_AXIS'
]);

function readRelative(symbol) {
  assert.ok(symbol.startsWith('concert_grand.'), `source symbol has no preset root: ${symbol}`);
  return symbol.slice('concert_grand.'.length).split('.').reduce((value, key) => value?.[key], preset);
}

function flatten(value, prefix) {
  const result = [];
  for (const [key, child] of Object.entries(value)) {
    const current = `${prefix}.${key}`;
    if (child && typeof child === 'object' && !Array.isArray(child)) result.push(...flatten(child, current));
    else result.push(current);
  }
  return result;
}

function run() {
  assert.equal(registry.inventoryComplete, true);
  const covered = new Map();
  for (const group of registry.groups) {
    assert.ok(allowed.has(group.classification), `${group.id} has unresolved/unknown classification`);
    assert.ok(group.boundBasis?.trim(), `${group.id} is missing bound basis`);
    assert.ok(group.rationale?.trim(), `${group.id} is missing rationale`);
    assert.ok(group.sourcePath || registry.sourcePath, `${group.id} is missing source path`);
    assert.ok(group.sourceSymbols.length > 0, `${group.id} has no source symbols`);
    for (const sourceSymbol of group.sourceSymbols.map(symbol => `${group.sourcePrefix}${symbol}`)) {
      assert.notEqual(readRelative(sourceSymbol), undefined, `${group.id} points to missing ${sourceSymbol}`);
      assert.equal(covered.has(sourceSymbol), false, `${sourceSymbol} classified more than once`);
      covered.set(sourceSymbol, group);
    }
  }

  const scoped = registry.scopeRoots.flatMap(root => flatten(root.split('.').reduce((v, key) => v[key], preset), `concert_grand.${root}`));
  for (const sourceSymbol of scoped) assert.ok(covered.has(sourceSymbol), `unclassified Group A-C field ${sourceSymbol}`);
  const extras = [...covered.keys()].filter(symbol => !scoped.includes(symbol)
    && !symbol.startsWith('concert_grand.piano_')
    && symbol !== 'concert_grand.engine_config.radiation.dry_longitudinal_gain');
  assert.deepEqual(extras, [], `registry covers unexpected fields: ${extras.join(', ')}`);

  assert.equal(preset.engine_config.hammer.force_scale, 300);
  const force = [...covered.entries()].find(([symbol]) => symbol.endsWith('engine_config.hammer.force_scale'))?.[1];
  assert.equal(force?.classification, 'FIXED_CALIBRATED');
  assert.equal(force?.fixedValue, 300);
  assert.equal(force?.optimizerEligible, false);

  assert.equal(searchSpace.dimensions.length, 6);
  const names = searchSpace.dimensions.map(item => item.name);
  assert.deepEqual(names, [
    'piano_hammer_hardness', 'hammer.compression_scale', 'effective_strike_position_c4',
    'piano_string_damping', 'piano_string_unison', 'piano_inharmonicity'
  ]);
  for (const dimension of searchSpace.dimensions) {
    assert.ok(Number.isFinite(dimension.min) && Number.isFinite(dimension.max) && Number.isFinite(dimension.baseline));
    assert.ok(dimension.min <= dimension.baseline && dimension.baseline <= dimension.max);
    assert.equal(dimension.scale, 'linear');
  }
  for (const name of ['piano_hammer_hardness', 'piano_string_damping', 'piano_string_unison', 'piano_inharmonicity']) {
    assert.ok(preset[name] >= 0 && preset[name] <= 1, `${name} outside its public normalized range`);
  }
  const summary = {};
  for (const group of registry.groups) summary[group.classification] = (summary[group.classification] || 0) + group.sourceSymbols.length;
  console.log(JSON.stringify({result: 'PASS', scopedFields: scoped.length, classifiedScopeFields: scoped.length,
    groups: registry.groups.length, classificationCounts: summary, qmcDimensions: names.length}));
}

if (require.main === module) run();
module.exports = {run};
