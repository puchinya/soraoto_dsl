#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const provenance = require('./stage3b-production-provenance.cjs');

const root = path.resolve(__dirname, '../../../../../../');
const sourceWasm = path.join(root, 'wasm');
const historicalWasm = path.join(root, 'build/wasm-stage3d/plugins/dsp/super-synth/plugin.wasm');
const productionWasm = path.join(root, 'build/wasm/plugins/dsp/super-synth/plugin.wasm');
const identityPath = path.join(root, '.agent-state/issues/7/stage3d/build-identity.json');
const toolchainFile = path.join(root, 'wasm/cmake/wasm32-clang.cmake');
const expected = {
  historicalWasmSha256: '9883b54eaa888b5a8d2e4d9da0490de92dd4c31915fb0d97d47cc03ce123a63a',
  productionWasmSha256: '9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  pluginSourceSha256: '968488b7d325c42e41570c1d7add10003050ab4c87779774a6e5337244c64886',
  historicalPluginSha256: '8368f8af3deb17fb24dc6611ec7ec5e01f23df569240086e4d3fa8c91a0e1ae4',
  historicalCmakeSha256: '32ccc9905d2fa5dbe76dbf3838d5d04907a36c5fac7ec5ef26cdc6d7766ee797',
};
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soraoto-stage3d-provenance-'));
const scratchWasm = path.join(scratchRoot, 'wasm');
const scratchBuild = path.join(scratchRoot, 'build');

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function exportsOf(file) {
  return new Set(WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(file))).map(({ name }) => name));
}
function rtk(...args) {
  execFileSync('rtk', args, { cwd: root, stdio: 'inherit', env: process.env });
}
function classifyScratchProvenance({ historicalArtifactValid, binaryIdentical, sourceIdentityMatches, flagsMatch,
  targetSourceMatches, exportTopologyMatches, descriptorMatches, interfaceMatches }) {
  if (![historicalArtifactValid, sourceIdentityMatches, flagsMatch, targetSourceMatches,
    exportTopologyMatches, descriptorMatches, interfaceMatches].every(Boolean)) {
    throw new Error('BLOCKED_STAGE3D_REBUILD_PROVENANCE_UNRESOLVED');
  }
  return binaryIdentical ? 'EXACT_REBUILD_PROVENANCE' : 'SUFFICIENT_STAGE3D_REBUILD_PROVENANCE';
}

// Exercise both classifications and prove that metadata drift always fails closed.
const allProvenanceChecks = { historicalArtifactValid: true, binaryIdentical: true, sourceIdentityMatches: true, flagsMatch: true,
  targetSourceMatches: true, exportTopologyMatches: true, descriptorMatches: true, interfaceMatches: true };
assert.equal(classifyScratchProvenance({ ...allProvenanceChecks, binaryIdentical: false }),
  'SUFFICIENT_STAGE3D_REBUILD_PROVENANCE');
assert.equal(classifyScratchProvenance(allProvenanceChecks), 'EXACT_REBUILD_PROVENANCE');
assert.throws(() => classifyScratchProvenance({ ...allProvenanceChecks, descriptorMatches: false }),
  /BLOCKED_STAGE3D_REBUILD_PROVENANCE_UNRESOLVED/);
assert.throws(() => classifyScratchProvenance({ ...allProvenanceChecks, interfaceMatches: false }),
  /BLOCKED_STAGE3D_REBUILD_PROVENANCE_UNRESOLVED/);

try {
  // Copy the source so CMake's metadata generation and all build output stay outside the worktree.
  fs.cpSync(sourceWasm, scratchWasm, { recursive: true });
  rtk('proxy', 'cmake', '-S', scratchWasm, '-B', scratchBuild,
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`,
    '-DBUILD_TESTING=OFF',
    '-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON',
    '-DSORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=ON',
    '-DSORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS=OFF',
    '-DSORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS=OFF',
    '-DSORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS=ON');

  const cacheFile = path.join(scratchBuild, 'CMakeCache.txt');
  const cache = fs.readFileSync(cacheFile, 'utf8');
  const requiredFlags = [
    'BUILD_TESTING:BOOL=OFF',
    'SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:BOOL=ON',
    'SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:BOOL=ON',
    'SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:BOOL=OFF',
    'SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:BOOL=OFF',
    'SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:BOOL=ON',
  ];
  for (const flag of requiredFlags) assert.ok(cache.includes(flag), `scratch build has incorrect option: ${flag}`);

  rtk('proxy', 'cmake', '--build', scratchBuild, '--target', 'soraoto_dsp_super_synth');
  const scratchArtifact = path.join(scratchBuild, 'plugins/dsp/super-synth/plugin.wasm');
  assert.ok(fs.existsSync(scratchArtifact), 'scratch Stage3D WASM was not produced');

  const historicalWasmSha256 = sha(historicalWasm);
  const productionWasmSha256 = sha(productionWasm);
  const scratchStage3dWasmSha256 = sha(scratchArtifact);
  assert.equal(historicalWasmSha256, expected.historicalWasmSha256, 'historical Stage3D WASM changed');
  assert.equal(productionWasmSha256, expected.productionWasmSha256, 'production WASM changed');
  assert.equal(sha(path.join(root, 'wasm/plugins/dsp/super-synth/src/plugin_stage3d.c')), expected.pluginSourceSha256);
  assert.equal(sha(path.join(root, 'wasm/plugins/dsp/super-synth/src/plugin.c')), expected.historicalPluginSha256);
  assert.equal(sha(path.join(root, 'wasm/cmake/wasm_plugin.cmake')), expected.historicalCmakeSha256);

  const scratchExports = exportsOf(scratchArtifact);
  const historicalExports = exportsOf(historicalWasm);
  const productionExports = exportsOf(productionWasm);
  const stage3dExports = ['soraoto_supersynth_stage3d_set_variant', 'soraoto_supersynth_stage3d_get_variant'];
  for (const name of stage3dExports) {
    assert.ok(scratchExports.has(name), `scratch WASM missing ${name}`);
    assert.ok(historicalExports.has(name), `historical Stage3D WASM missing ${name}`);
    assert.equal(productionExports.has(name), false, `production WASM unexpectedly exports ${name}`);
  }
  for (const name of [
    'soraoto_supersynth_stage3b_set_variant_mask', 'soraoto_supersynth_stage3b_get_variant_mask',
    'soraoto_supersynth_stage3c_set_variant_mask', 'soraoto_supersynth_stage3c_get_variant_mask',
  ]) assert.equal(scratchExports.has(name), false, `scratch WASM leaks ${name}`);

  const targetBuildFile = path.join(scratchBuild, 'plugins/dsp/super-synth/CMakeFiles/soraoto_dsp_super_synth.dir/build.make');
  const targetBuild = fs.readFileSync(targetBuildFile, 'utf8');
  assert.match(targetBuild, /src\/plugin_stage3d\.c/);
  assert.doesNotMatch(targetBuild, /src\/plugin\.c/);

  const sections = ['soraoto.plugin.v1', 'soraoto.interface'];
  const historicalSections = provenance.extractNamedCustomSections(fs.readFileSync(historicalWasm), sections);
  const scratchSections = provenance.extractNamedCustomSections(fs.readFileSync(scratchArtifact), sections);
  assert.deepEqual(scratchSections['soraoto.plugin.v1'], historicalSections['soraoto.plugin.v1'], 'embedded descriptor differs');
  assert.deepEqual(scratchSections['soraoto.interface'], historicalSections['soraoto.interface'], 'embedded interface differs');

  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const cmakeCache = provenance.cmakeCacheMetadata(cacheFile);
  const toolchain = provenance.captureToolchain(root, cacheFile);
  const classification = classifyScratchProvenance({
    ...allProvenanceChecks,
    historicalArtifactValid: historicalWasmSha256 === expected.historicalWasmSha256,
    binaryIdentical: scratchStage3dWasmSha256 === historicalWasmSha256,
    sourceIdentityMatches: identity.stage3dPluginSourceSha256 === expected.pluginSourceSha256
      && identity.stage3dCmakeSourceSha256 === sha(path.join(root, 'wasm/CMakeLists.txt')),
    flagsMatch: requiredFlags.every(flag => cache.includes(flag)),
    targetSourceMatches: /src\/plugin_stage3d\.c/.test(targetBuild) && !/src\/plugin\.c/.test(targetBuild),
    exportTopologyMatches: stage3dExports.every(name => scratchExports.has(name))
      && ![...scratchExports].some(name => /stage3b_set_variant_mask|stage3c_set_variant_mask/.test(name)),
    descriptorMatches: scratchSections['soraoto.plugin.v1'].equals(historicalSections['soraoto.plugin.v1']),
    interfaceMatches: scratchSections['soraoto.interface'].equals(historicalSections['soraoto.interface']),
  });
  const result = {
    pass: true,
    classification,
    historicalStage3dWasmSha256: historicalWasmSha256,
    scratchStage3dWasmSha256,
    descriptorSha256: provenance.sha256(scratchSections['soraoto.plugin.v1']),
    interfaceSha256: provenance.sha256(scratchSections['soraoto.interface']),
    descriptorMatches: true,
    interfaceMatches: true,
    stage3dExportsPresent: true,
    stage3bStage3cExportsAbsent: true,
    productionStage3dExportsAbsent: true,
    cmakeFlags: Object.fromEntries(requiredFlags.map(flag => [flag.split(':')[0], flag.split('=').at(-1)])),
    cmakeCache,
    toolchain: { ...toolchain, toolchainFileSha256: provenance.sha256File(toolchainFile) },
    acousticRenders: 0,
  };
  console.log(JSON.stringify(result));
} catch (error) {
  if (String(error.message).includes('BLOCKED_STAGE3D_REBUILD_PROVENANCE_UNRESOLVED')) throw error;
  throw new Error(`BLOCKED_STAGE3D_REBUILD_PROVENANCE_UNRESOLVED: ${error.message}`, { cause: error });
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
}
