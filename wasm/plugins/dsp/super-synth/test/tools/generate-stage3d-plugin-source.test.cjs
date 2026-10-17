#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const stage3d = require('./run-stage3d-localized-contact-transformer.cjs');

const root = path.resolve(__dirname, '../../../../../../');
const paths = {
  historicalPlugin: path.join(root, 'wasm/plugins/dsp/super-synth/src/plugin.c'),
  historicalCmake: path.join(root, 'wasm/cmake/wasm_plugin.cmake'),
  stage3dPlugin: path.join(root, 'wasm/plugins/dsp/super-synth/src/plugin_stage3d.c'),
  cmake: path.join(root, 'wasm/CMakeLists.txt'),
  capture: path.join(root, 'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3d-matrix.cjs'),
  runner: path.join(root, 'wasm/plugins/dsp/super-synth/test/tools/run-stage3d-localized-contact-transformer.cjs'),
  identity: path.join(root, '.agent-state/issues/7/stage3d/build-identity.json'),
  productionWasm: path.join(root, 'build/wasm/plugins/dsp/super-synth/plugin.wasm'),
  historicalStage3dWasm: path.join(root, 'build/wasm-stage3d/plugins/dsp/super-synth/plugin.wasm'),
};
const EXPECTED = {
  historicalPlugin: '8368f8af3deb17fb24dc6611ec7ec5e01f23df569240086e4d3fa8c91a0e1ae4',
  historicalCmake: '32ccc9905d2fa5dbe76dbf3838d5d04907a36c5fac7ec5ef26cdc6d7766ee797',
  productionWasm: '9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  stage3dWasm: '9883b54eaa888b5a8d2e4d9da0490de92dd4c31915fb0d97d47cc03ce123a63a',
};

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function exportsOf(file) {
  return new Set(WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(file))).map(({ name }) => name));
}

assert.equal(sha(paths.historicalPlugin), EXPECTED.historicalPlugin, 'historical plugin.c identity changed');
assert.equal(sha(paths.historicalCmake), EXPECTED.historicalCmake, 'historical wasm_plugin.cmake identity changed');
assert.ok(fs.existsSync(paths.stage3dPlugin), 'isolated plugin_stage3d.c is missing');

const cmakeText = fs.readFileSync(paths.cmake, 'utf8');
assert.match(cmakeText, /option\(SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS[\s\S]*?OFF\)/);
assert.match(cmakeText, /if\(SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS\)[\s\S]*?set_property\(TARGET \$\{stage3d_target\} PROPERTY SOURCES\s+"\$\{CMAKE_CURRENT_SOURCE_DIR\}\/plugins\/dsp\/super-synth\/src\/plugin_stage3d\.c"\)/);
assert.match(cmakeText, /target_compile_definitions\(\$\{stage3d_target\} PRIVATE SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS=1\)/);
assert.match(cmakeText, /--export=soraoto_supersynth_stage3d_set_variant/);
assert.match(cmakeText, /--export=soraoto_supersynth_stage3d_get_variant/);

const source = fs.readFileSync(paths.stage3dPlugin, 'utf8');
assert.match(source, /#if defined\(SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS\)\s*int soraoto_supersynth_stage3d_set_variant/);
assert.match(source, /#if defined\(SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS\)\s*int soraoto_supersynth_stage3d_set_variant[\s\S]*?unsigned int soraoto_supersynth_stage3d_get_variant\(void\)/);

assert.equal(sha(paths.productionWasm), EXPECTED.productionWasm, 'production WASM identity changed');
assert.equal(sha(paths.historicalStage3dWasm), EXPECTED.stage3dWasm, 'historical Stage3D WASM identity changed');
const productionExports = exportsOf(paths.productionWasm);
const historicalStage3dExports = exportsOf(paths.historicalStage3dWasm);
assert.equal(historicalStage3dExports.has('soraoto_supersynth_stage3d_set_variant'), true);
assert.equal(historicalStage3dExports.has('soraoto_supersynth_stage3d_get_variant'), true);
assert.equal(productionExports.has('soraoto_supersynth_stage3d_set_variant'), false);
assert.equal(productionExports.has('soraoto_supersynth_stage3d_get_variant'), false);

const identity = JSON.parse(fs.readFileSync(paths.identity, 'utf8'));
const currentIdentity = stage3d.buildIdentity(root);
const verifierDifferences = stage3d.compareStrictCoreIdentity(identity, currentIdentity);
assert.deepEqual(stage3d.VERIFIER_ONLY_FIELDS, ['sourceRevision', 'runnerSha256', 'stage3dCaptureEvaluatorSha256']);
for (const field of stage3d.VERIFIER_ONLY_FIELDS) {
  assert.equal(verifierDifferences[field].historical, identity[field]);
  assert.equal(verifierDifferences[field].current, currentIdentity[field]);
}
assert.notEqual(verifierDifferences.runnerSha256.historical, verifierDifferences.runnerSha256.current);
assert.notEqual(verifierDifferences.stage3dCaptureEvaluatorSha256.historical,
  verifierDifferences.stage3dCaptureEvaluatorSha256.current);
assert.equal(identity.stage3dDiagnosticWasmSha256, EXPECTED.stage3dWasm);
assert.equal(identity.stage3dPluginSourceSha256, sha(paths.stage3dPlugin));
assert.equal(identity.stage3dCmakeSourceSha256, sha(paths.cmake));
assert.equal(currentIdentity.stage3dCaptureEvaluatorSha256, sha(paths.capture));
assert.equal(currentIdentity.runnerSha256, sha(paths.runner));
assert.equal(identity.pluginSourceSha256, sha(paths.historicalPlugin));
assert.equal(identity.cmakeSourceSha256, sha(paths.historicalCmake));

assert.equal(currentIdentity.stage3dDiagnosticWasmSha256, EXPECTED.stage3dWasm);
console.log(JSON.stringify({ pass: true, productionWasmSha256: sha(paths.productionWasm), stage3dWasmSha256: identity.stage3dDiagnosticWasmSha256,
  verifierIdentity:{historical:Object.fromEntries(stage3d.VERIFIER_ONLY_FIELDS.map(field=>[field,identity[field]])),
    current:Object.fromEntries(stage3d.VERIFIER_ONLY_FIELDS.map(field=>[field,currentIdentity[field]]))} }));
