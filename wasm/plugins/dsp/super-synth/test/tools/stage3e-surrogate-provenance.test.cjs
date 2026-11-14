#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const provenance=require('./stage3e-surrogate-provenance.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');

const accepted=provenance.validateProductionLineage({root:ROOT});
assert.equal(accepted.classification,'SUFFICIENT_METADATA_PROVENANCE');
assert.equal(accepted.document.authoritativeProductionWasmSha256,provenance.PRODUCTION_WASM_SHA256);
assert.equal(accepted.document.isolatedProductionBuild.sha256,'eef4fb43c8df85d7840bacd258e289448d2f841c95a02157d29d45803341df47');
assert.notEqual(accepted.document.isolatedProductionBuild.sha256,provenance.PRODUCTION_WASM_SHA256,
  'the sufficient-provenance build is production lineage, not an acoustic reference');

const source=provenance.sourceIdentity({root:ROOT,provenance:accepted});
assert.equal(source.hashes.stage3dPlugin,provenance.STAGE3D_SOURCE_SHA256);
assert.equal(source.hashes.historicalPlugin,provenance.HISTORICAL_PLUGIN_SHA256);
assert.equal(source.hashes.historicalCmakeMacro,provenance.HISTORICAL_CMAKE_MACRO_SHA256);
assert.equal(source.productionWasmSha256,provenance.PRODUCTION_WASM_SHA256);

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-provenance-negative-'));
try{
  const changed={...accepted.document,classificationEvidence:{...accepted.document.classificationEvidence,classification:'EXACT_REBUILD_PROVENANCE'}};
  const changedPath=path.join(temp,'changed-provenance.json');
  fs.writeFileSync(changedPath,JSON.stringify(changed));
  assert.throws(()=>provenance.validateProductionLineage({root:ROOT,provenanceFile:changedPath}),
    /BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED/);

  const interfaceMismatch={...accepted.document,productionEmbeddedInterface:{...accepted.document.productionEmbeddedInterface,sha256:'0'.repeat(64)}};
  const interfacePath=path.join(temp,'interface-mismatch.json');
  fs.writeFileSync(interfacePath,JSON.stringify(interfaceMismatch));
  assert.throws(()=>provenance.validateProductionLineage({root:ROOT,provenanceFile:interfacePath}),
    /BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED/);
}finally{fs.rmSync(temp,{recursive:true,force:true});}

const built=provenance.buildExactStage3dSurrogate({root:ROOT,provenance:accepted});
try{
  assert.equal(built.identity.decision,'STAGE3E_STAGE3D_SURROGATE_EXACT_REBUILD');
  assert.equal(built.identity.wasmSha256,'9883b54eaa888b5a8d2e4d9da0490de92dd4c31915fb0d97d47cc03ce123a63a');
  assert.equal(built.identity.controls.stage3dVariant,0);
  assert.equal(built.identity.controls.stage2mFactorMask,3);
  assert.equal(built.identity.controls.acousticRenders,0);
  assert.equal(built.identity.targetUsesPluginStage3d,true);
  assert.equal(built.identity.stage3bStage3cStage3eExportsAbsent,true);
}finally{built.cleanup();}

console.log('PASS Stage3E production lineage and exact Stage3D surrogate provenance; acoustic renders=0');
