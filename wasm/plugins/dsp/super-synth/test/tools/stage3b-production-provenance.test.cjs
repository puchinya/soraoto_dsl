'use strict';

const assert=require('node:assert/strict');
const {
  FIXED_PROFILE,extractNamedCustomSections,runtimeMetadataFingerprint,classifyProvenance
}=require('./stage3b-production-provenance.cjs');

function leb(value){const bytes=[];do{let byte=value&0x7f;value>>>=7;if(value)byte|=0x80;bytes.push(byte);}while(value);return Buffer.from(bytes);}
function customSection(name,payload=Buffer.from([1,2,3])){
  const nameBytes=Buffer.from(name),body=Buffer.concat([leb(nameBytes.length),nameBytes,payload]);
  return Buffer.concat([Buffer.from([0]),leb(body.length),body]);
}
function wasmWith(...sections){return Buffer.concat([Buffer.from([0,97,115,109,1,0,0,0]),...sections]);}

const wasm=wasmWith(customSection('soraoto.plugin.v1'),customSection('soraoto.interface'));
assert.deepEqual(Object.keys(extractNamedCustomSections(wasm,['soraoto.plugin.v1','soraoto.interface'])).sort(),
  ['soraoto.interface','soraoto.plugin.v1']);
assert.throws(()=>extractNamedCustomSections(wasmWith(customSection('soraoto.plugin.v1'),customSection('soraoto.plugin.v1')),
  ['soraoto.plugin.v1']),/exactly one/);
assert.throws(()=>extractNamedCustomSections(wasm,['missing']),/exactly one/);

const arrays=[
  'static const unsigned int soraoto_param_ids[2] = { 1, 2 };',
  'static const double soraoto_param_min[2] = { 0, 0 };',
  'static const double soraoto_param_max[2] = { 1, 1 };',
  'static const double soraoto_param_default_norm[2] = { 0, 0 };',
  'static const unsigned char soraoto_param_type[2] = { 0, 0 };',
  'static const unsigned char soraoto_param_scale[2] = { 0, 0 };',
  'static const unsigned char soraoto_param_interpolation[2] = { 0, 0 };',
  'static const double soraoto_param_scale_aux[2] = { 0, 0 };',
  'static const unsigned int soraoto_factory_preset_ids[1] = { 9 };',
  'static const double soraoto_factory_preset_norm[1][2] = { { 0, 0 } };',
  'static const unsigned int soraoto_program_ids[1] = { 9 };',
  'static const unsigned int soraoto_program_info_offsets[1] = { 0 };',
  'static const unsigned char soraoto_program_info_bytes[1] = { 0 };',
  '#define PLUGIN_PARAM_COUNT 2','#define PLUGIN_PROGRAM_LIST_ID 9','#define PLUGIN_PROGRAM_COUNT 1'
].join('\n');
const original=runtimeMetadataFingerprint(arrays);
const changedOnlyDescriptor=`static const unsigned char soraoto_descriptor_bytes[5] = { 9, 8, 7, 6, 5 };\n#define SORAOTO_DESCRIPTOR_LEN 5\n${arrays}`;
assert.equal(runtimeMetadataFingerprint(changedOnlyDescriptor).sha256,original.sha256);
const changedRuntime=arrays.replace('soraoto_param_default_norm[2] = { 0, 0 }','soraoto_param_default_norm[2] = { 0, 0.1 }');
assert.notEqual(runtimeMetadataFingerprint(changedRuntime).sha256,original.sha256);

const fp='a'.repeat(64),profile=FIXED_PROFILE,embedded='b'.repeat(64);
const variants=[{name:'A',descriptorCborSha256:embedded,runtimeMetadataFingerprintSha256:fp,profileSha256:profile},
  {name:'B',descriptorCborSha256:'c'.repeat(64),runtimeMetadataFingerprintSha256:'d'.repeat(64),profileSha256:profile},
  {name:'C',descriptorCborSha256:'e'.repeat(64),runtimeMetadataFingerprintSha256:'f'.repeat(64),profileSha256:profile}];
assert.deepEqual(classifyProvenance({embeddedDescriptorSha256:embedded,embeddedInterfaceMatchesStage2q:true,variants,
  isolatedProductionBuildSha256:'0'.repeat(64),profileSha256:profile,productionPathsUnchanged:true,
  authoritativeWasmSha256:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',dirtyDescriptorUnchanged:true}),
  {classification:'SUFFICIENT_METADATA_PROVENANCE',matchingVariants:['A']});
assert.equal(classifyProvenance({embeddedDescriptorSha256:embedded,embeddedInterfaceMatchesStage2q:true,
  variants:[...variants,{...variants[1],name:'C',descriptorCborSha256:embedded}],isolatedProductionBuildSha256:'0'.repeat(64),
  profileSha256:profile,productionPathsUnchanged:true,authoritativeWasmSha256:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  dirtyDescriptorUnchanged:true}).classification,'UNRESOLVED');
assert.equal(classifyProvenance({embeddedDescriptorSha256:embedded,embeddedInterfaceMatchesStage2q:false,variants,
  isolatedProductionBuildSha256:'0'.repeat(64),profileSha256:profile,productionPathsUnchanged:true,
  authoritativeWasmSha256:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',dirtyDescriptorUnchanged:true}).classification,'UNRESOLVED');
assert.equal(classifyProvenance({embeddedDescriptorSha256:embedded,embeddedInterfaceMatchesStage2q:false,
  variants:[{...variants[1],name:'B',descriptorCborSha256:embedded}],isolatedProductionBuildSha256:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  profileSha256:'0'.repeat(64),productionPathsUnchanged:false,
  authoritativeWasmSha256:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',dirtyDescriptorUnchanged:false}).classification,
  'EXACT_REBUILD_PROVENANCE');
console.log('Stage3B provenance tests passed: custom-section uniqueness, structural metadata fingerprint, deterministic exact/sufficient/unresolved classification.');
