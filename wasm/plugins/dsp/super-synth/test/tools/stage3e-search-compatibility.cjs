'use strict';

const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const validator=require('./stage3e-evidence-validator.cjs');
const search=require('./stage3e-search-core.cjs');

const V1_RELATIVE='verifier-compatibility-v1.json';
const V1_SHA256='331279140ef707c71c81cf716eed052f443e8537616bac83ad88e002bf61b1e5';
const IDENTITY_SCOPE_PROOF_SHA256='e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb';
const V1_FIX_COMMIT='ecfe1d2617d3f8ffc5e9cb8ae5b91a619e2d841d';
const ORIGINAL_LOCAL_COMMIT='79121646babd0e1031de03aae1a5bed486e59f8a';
const CORRECTION_BASE_COMMIT='7093573d569d84fe8cf57efda7f19e7eda764ec9';
const PROOF_SHA256='e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb';
const AMENDMENT_RESULT_SHA256='690221637732fe46c4c7420254175b1b36720b181051b6c04a5710e13d8e0744';
const SEARCH_MANIFEST_SHA256='27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095';
const LOW_GENESIS_SHA256='d8b2b7e299174b605c1cdcb576ab70645ec725cbfa03d76c003abe92854e754d';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const V2_RELATIVE='verifier-compatibility-v2.json';
const V2_SHA_RELATIVE='verifier-compatibility-v2.sha256';
const V2_ARCHIVE_RELATIVE='archives/verifier-compatibility-v2.tar.gz';
const V2_ARCHIVE_SHA_RELATIVE='archives/verifier-compatibility-v2.tar.gz.sha256';
const VERIFIER_MODULE_PATHS=[
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-compatibility.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/durable-evidence.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-master-orchestrator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs'
];
const CANDIDATE_ACOUSTIC_IDENTITY_FIELDS=['candidateId','diagnosticWasmSha256','sourcePluginSha256',
  'stage3eCaptureHelperSha256','presetsSha256','profileSha256','configSha256','referenceFixtureSha256'];
const PROTECTED_TRACKED_PATHS=[
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/CMakeLists.txt',
  'wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h',
  'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs',
  ...VERIFIER_MODULE_PATHS
];

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function candidateAcousticIdentity(identity){return Object.fromEntries(CANDIDATE_ACOUSTIC_IDENTITY_FIELDS.map(key=>[key,identity[key]]));}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function jsonDigest(value){return sha256(Buffer.from(JSON.stringify(stable(value))+'\n'));}
function fail(detail,token='BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY'){throw new Error(token+': '+detail);}
function isAncestor(root,from,to){
  try{execFileSync('git',['merge-base','--is-ancestor',from,to],{cwd:root,stdio:'ignore'});return true;}
  catch{return false;}
}
function currentArtifacts(root){
  const hashFiles=paths=>Object.fromEntries(paths.map(relative=>{
    const target=path.join(root,relative);
    if(!fs.existsSync(target)||!fs.statSync(target).isFile())fail('protected file missing: '+relative,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
    return [relative,sha256(fs.readFileSync(target))];
  }));
  const verifierModules=hashFiles(VERIFIER_MODULE_PATHS);
  const tracked=hashFiles(PROTECTED_TRACKED_PATHS);
  const candidateIdentity=candidateAcousticIdentity(search.currentProtectedIdentity(root));
  const buildDir=path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm-stage3e'));
  const wasmPath=path.join(buildDir,'plugins/dsp/super-synth/plugin.wasm');
  const cachePath=path.join(buildDir,'CMakeCache.txt');
  if(!fs.existsSync(wasmPath)||!fs.existsSync(cachePath))fail('Stage3E diagnostic artifact or CMake cache missing','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const cache=fs.readFileSync(cachePath,'utf8'),cmakeOptions={};
  for(const line of cache.split(/\r?\n/)){
    const match=line.match(/^(SORAOTO_SUPERSYNTH_[A-Z0-9_]+):[^=]+=([^#]+)$/);
    if(match)cmakeOptions[match[1]]=match[2];
  }
  const required={
    SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:'ON',
    SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:'ON',
    SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:'OFF',
    SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:'OFF',
    SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:'OFF',
    SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS:'ON'
  };
  for(const [key,value] of Object.entries(required))if(cmakeOptions[key]!==value)fail('CMake option '+key+' expected '+value,'BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  const stage3eWasm={path:wasmPath,sha256:sha256(fs.readFileSync(wasmPath)),cmakeOptions:required};
  if(stage3eWasm.sha256!==STAGE3E_WASM_SHA256)fail('Stage3E WASM SHA differs from accepted Gen2 artifact','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  return {verifierModules,protectedSearchArtifacts:{trackedFiles:tracked,stage3eWasm,candidateIdentity}};
}
function fixedInventorySha(sourceAudit){
  const inventory=sourceAudit&&sourceAudit.immutablePreexistingFileInventory;
  const primary=inventory&&inventory.primary&&inventory.primary.files;
  const secondary=inventory&&inventory.secondary&&inventory.secondary.files;
  const identityFields=files=>Array.isArray(files)?files.map(({path,sizeBytes,sha256})=>({path,sizeBytes,sha256})).sort((a,b)=>a.path.localeCompare(b.path)):null;
  const primaryIdentity=identityFields(primary),secondaryIdentity=identityFields(secondary);
  const valid=files=>Array.isArray(files)&&files.length===35&&new Set(files.map(item=>item.path)).size===35&&
    files.every(item=>typeof item.path==='string'&&Number.isSafeInteger(item.sizeBytes)&&item.sizeBytes>=0&&/^[0-9a-f]{64}$/.test(item.sha256||''));
  if(!valid(primary)||!valid(secondary)||!same(primaryIdentity,secondaryIdentity))
    fail('fixed 35-file path/size/SHA inventory is unavailable or differs between stores','BLOCKED_STAGE3E_AMENDMENT_EVIDENCE');
  return jsonDigest(primaryIdentity);
}
function validateV1(v1,sha){
  if(sha!==V1_SHA256||!v1||v1.schemaVersion!==1||v1.decision!=='STAGE3E_SEARCH_VERIFIER_COMPATIBLE'||
     v1.originalLocalCommit!==ORIGINAL_LOCAL_COMMIT||v1.verifierFixCommit!==V1_FIX_COMMIT)
    fail('immutable v1 predecessor identity mismatch');
  return true;
}
function buildRecord({root,manifestIdentity,v1,v1Sha256,sourceAudit,zeroRenderTestResults,allowedDiff}={}){
  const head=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const clean=execFileSync('rtk',['git','status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim();
  if(clean)fail('tracked worktree must be clean before v2 creation');
  validateV1(v1,v1Sha256);
  for(const base of [V1_FIX_COMMIT,CORRECTION_BASE_COMMIT])if(!isAncestor(root,base,head))fail('accepted verifier commit does not descend from '+base);
  if(!manifestIdentity||manifestIdentity.creatorRevision!==ORIGINAL_LOCAL_COMMIT)fail('search manifest creator identity mismatch');
  const artifacts=currentArtifacts(root);
  if(manifestIdentity.candidateId!==manifestIdentity.protectedIdentity.candidateId||
     !same(artifacts.protectedSearchArtifacts.candidateIdentity,candidateAcousticIdentity(manifestIdentity.protectedIdentity)))
    fail('current acoustic candidate identity differs from the immutable search manifest','BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT');
  if(!Array.isArray(zeroRenderTestResults)||!zeroRenderTestResults.length||zeroRenderTestResults.some(row=>row.exitCode!==0))
    fail('zero-render verification results are incomplete');
  if(!allowedDiff||!Array.isArray(allowedDiff.files)||!/^[0-9a-f]{64}$/.test(allowedDiff.sha256||''))fail('verifier-only diff proof unavailable');
  const tests=stable(zeroRenderTestResults),testSha=jsonDigest(tests);
  return {
    schemaVersion:2,kind:'STAGE3E_SEARCH_VERIFIER_COMPATIBILITY',decision:'STAGE3E_SEARCH_VERIFIER_COMPATIBLE',
    predecessorV1Sha256:V1_SHA256,originalLocalCommit:ORIGINAL_LOCAL_COMMIT,
    originalVerifierFixCommit:V1_FIX_COMMIT,correctionBaseCommit:CORRECTION_BASE_COMMIT,acceptedVerifierCommit:head,
    predecessorIdentityScopeProofSha256:IDENTITY_SCOPE_PROOF_SHA256,sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,
    midi41AmendmentResultSha256:AMENDMENT_RESULT_SHA256,searchManifestSha256:SEARCH_MANIFEST_SHA256,
    initialLowLedgerSha256:LOW_GENESIS_SHA256,
    searchLedgerBootstrap:{authorized:1512,pending:1512,inProgress:0,complete:0,renderCalls:0,cellPayloadFiles:0},
    originalFixedInventorySha256:fixedInventorySha(sourceAudit),
    protectedSearchArtifacts:artifacts.protectedSearchArtifacts,verifierModules:artifacts.verifierModules,
    candidateIdentity:{candidateId:manifestIdentity.candidateId,sourcePluginSha256:manifestIdentity.protectedIdentity.sourcePluginSha256,
      diagnosticWasmSha256:manifestIdentity.protectedIdentity.diagnosticWasmSha256,
      configSha256:manifestIdentity.protectedIdentity.configSha256,profileSha256:manifestIdentity.protectedIdentity.profileSha256,
      presetsSha256:manifestIdentity.protectedIdentity.presetsSha256,referenceFixtureSha256:manifestIdentity.protectedIdentity.referenceFixtureSha256,
      captureHelperSha256:manifestIdentity.captureHelperSha256,stage3eCaptureHelperSha256:manifestIdentity.protectedIdentity.stage3eCaptureHelperSha256},
    baselineAcceptance:{decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',effectivePassCount:12,effectiveCellCount:12,
      maxMetricDifference:0,tolerance:0.000001,amendmentResultSha256:AMENDMENT_RESULT_SHA256},
    allowedVerifierOnlyDiffSha256:allowedDiff.sha256,allowedVerifierOnlyDiffFiles:allowedDiff.files,
    testedCommands:tests,unitAndInjectedIntegrationResultSha256:testSha,primarySecondaryIntegrity:'PASS'
  };
}
function validateRecord({root,compatibility,v1,v1Sha256,manifestIdentity,sourceAuditSha256,inventorySha256,
  artifacts,diff,head,isAncestorCheck=isAncestor,assertClean=()=>true}={}){
  const failCompat=detail=>fail(detail);
  if(!compatibility||compatibility.schemaVersion!==2||compatibility.kind!=='STAGE3E_SEARCH_VERIFIER_COMPATIBILITY'||
     compatibility.decision!=='STAGE3E_SEARCH_VERIFIER_COMPATIBLE')failCompat('v2 schema/decision');
  validateV1(v1,v1Sha256);
  for(const [field,value] of Object.entries({
    predecessorV1Sha256:V1_SHA256,originalLocalCommit:ORIGINAL_LOCAL_COMMIT,originalVerifierFixCommit:V1_FIX_COMMIT,
    correctionBaseCommit:CORRECTION_BASE_COMMIT,predecessorIdentityScopeProofSha256:IDENTITY_SCOPE_PROOF_SHA256,sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,
    midi41AmendmentResultSha256:AMENDMENT_RESULT_SHA256,searchManifestSha256:SEARCH_MANIFEST_SHA256,
    initialLowLedgerSha256:LOW_GENESIS_SHA256
  }))if(compatibility[field]!==value)failCompat(field+' mismatch');
  if(!/^[0-9a-f]{40}$/.test(compatibility.acceptedVerifierCommit||''))failCompat('accepted verifier commit schema');
  const currentHead=head||execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  for(const base of [V1_FIX_COMMIT,CORRECTION_BASE_COMMIT])if(!isAncestorCheck(root,base,compatibility.acceptedVerifierCommit))
    failCompat('accepted verifier commit is not a descendant of '+base);
  if(!isAncestorCheck(root,compatibility.acceptedVerifierCommit,currentHead))failCompat('accepted verifier commit is not an ancestor of current HEAD');
  assertClean(root);
  if(compatibility.sourceAuditSha256!==validator.SOURCE_AUDIT_SHA256)failCompat('source evidence audit SHA mismatch');
  if(sourceAuditSha256!==undefined&&sourceAuditSha256!==validator.SOURCE_AUDIT_SHA256)failCompat('source evidence audit SHA mismatch');
  if(inventorySha256!==undefined&&compatibility.originalFixedInventorySha256!==inventorySha256)failCompat('fixed inventory digest mismatch');
  if(!same(compatibility.searchLedgerBootstrap,{authorized:1512,pending:1512,inProgress:0,complete:0,renderCalls:0,cellPayloadFiles:0}))
    failCompat('low-ledger bootstrap state mismatch');
  if(compatibility.primarySecondaryIntegrity!=='PASS')failCompat('dual store integrity');
  const currentArtifactsValue=artifacts||currentArtifacts(root);
  if(!same(compatibility.verifierModules,currentArtifactsValue.verifierModules)||
     !same(compatibility.protectedSearchArtifacts,currentArtifactsValue.protectedSearchArtifacts))
    failCompat('pinned verifier or acoustic artifact SHA changed');
  if(!manifestIdentity||!compatibility.candidateIdentity||
     compatibility.candidateIdentity.candidateId!==manifestIdentity.candidateId||
     compatibility.candidateIdentity.sourcePluginSha256!==manifestIdentity.protectedIdentity.sourcePluginSha256||
     compatibility.candidateIdentity.diagnosticWasmSha256!==manifestIdentity.protectedIdentity.diagnosticWasmSha256||
     compatibility.candidateIdentity.configSha256!==manifestIdentity.protectedIdentity.configSha256||
     compatibility.candidateIdentity.profileSha256!==manifestIdentity.protectedIdentity.profileSha256||
     compatibility.candidateIdentity.presetsSha256!==manifestIdentity.protectedIdentity.presetsSha256||
     compatibility.candidateIdentity.referenceFixtureSha256!==manifestIdentity.protectedIdentity.referenceFixtureSha256||
     compatibility.candidateIdentity.captureHelperSha256!==manifestIdentity.captureHelperSha256||
     compatibility.candidateIdentity.stage3eCaptureHelperSha256!==manifestIdentity.protectedIdentity.stage3eCaptureHelperSha256)
    failCompat('search-manifest acoustic identity mismatch');
  if(!same(compatibility.baselineAcceptance,{decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',effectivePassCount:12,
    effectiveCellCount:12,maxMetricDifference:0,tolerance:0.000001,amendmentResultSha256:AMENDMENT_RESULT_SHA256}))
    failCompat('effective baseline acceptance mismatch');
  const currentDiff=diff;
  if(!currentDiff)failCompat('verifier-only diff proof unavailable');
  if(compatibility.allowedVerifierOnlyDiffSha256!==currentDiff.sha256||
     !same(compatibility.allowedVerifierOnlyDiffFiles,currentDiff.files))failCompat('verifier-only diff changed');
  const testSha=jsonDigest(compatibility.testedCommands);
  if(!Array.isArray(compatibility.testedCommands)||!compatibility.testedCommands.length||
     compatibility.testedCommands.some(row=>row.exitCode!==0)||
     compatibility.unitAndInjectedIntegrationResultSha256!==testSha)failCompat('test record integrity');
  return {pass:true,decision:compatibility.decision,acceptedVerifierCommit:compatibility.acceptedVerifierCommit,
    currentHead:currentHead,verifierModules:compatibility.verifierModules,protectedSearchArtifacts:compatibility.protectedSearchArtifacts};
}
function readArchiveMember(archivePath,name){
  try{return execFileSync('tar',['-xOzf',archivePath,name],{maxBuffer:16*1024*1024});}
  catch(error){fail('compatibility archive missing member '+name+': '+error.message,'BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY');}
}
function readBundle(roots){
  const v1=durable.verifyDualCopy(path.join(roots.primary,V1_RELATIVE),path.join(roots.secondary,V1_RELATIVE));
  validateV1(JSON.parse(v1.bytes.toString('utf8')),v1.sha256);
  const v2=durable.verifyDualCopy(path.join(roots.primary,V2_RELATIVE),path.join(roots.secondary,V2_RELATIVE));
  const v2ShaFile=durable.verifyDualCopy(path.join(roots.primary,V2_SHA_RELATIVE),path.join(roots.secondary,V2_SHA_RELATIVE));
  if(v2ShaFile.bytes.toString('utf8')!==v2.sha256+'\n')fail('v2 SHA registration mismatch');
  const archive=durable.verifyDualCopy(path.join(roots.primary,V2_ARCHIVE_RELATIVE),path.join(roots.secondary,V2_ARCHIVE_RELATIVE));
  const archiveShaFile=durable.verifyDualCopy(path.join(roots.primary,V2_ARCHIVE_SHA_RELATIVE),path.join(roots.secondary,V2_ARCHIVE_SHA_RELATIVE));
  if(archiveShaFile.bytes.toString('utf8')!==archive.sha256+'\n')fail('v2 archive SHA registration mismatch');
  for(const archivePath of [path.join(roots.primary,V2_ARCHIVE_RELATIVE),path.join(roots.secondary,V2_ARCHIVE_RELATIVE)]){
    if(!readArchiveMember(archivePath,V2_RELATIVE).equals(v2.bytes)||
       !readArchiveMember(archivePath,V2_SHA_RELATIVE).equals(v2ShaFile.bytes))fail('v2 archive payload mismatch');
  }
  return {v1:JSON.parse(v1.bytes.toString('utf8')),v1Sha256:v1.sha256,record:JSON.parse(v2.bytes.toString('utf8')),
    bytes:v2.bytes,sha256:v2.sha256,archiveSha256:archive.sha256};
}
function storeImmutablePair(roots,relative,bytes){
  const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
  const ea=fs.existsSync(a),eb=fs.existsSync(b);
  if(ea&&eb){
    const old=durable.verifyDualCopy(a,b);
    if(!old.bytes.equals(bytes))fail('immutable sidecar collision: '+relative);
    return old;
  }
  if(ea||eb){
    const present=ea?a:b,missing=ea?b:a,old=fs.readFileSync(present);
    if(!old.equals(bytes))fail('partial immutable sidecar conflicts: '+relative);
    durable.atomicWrite(missing,old);
    const stored=durable.verifyDualCopy(a,b);
    if(!stored.bytes.equals(bytes))fail('recovered sidecar differs: '+relative);
    return stored;
  }
  return durable.writeDualCopy(a,b,bytes);
}
function makeArchiveBytes(recordBytes,shaBytes){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-verifier-v2-'));
  try{
    fs.writeFileSync(path.join(dir,V2_RELATIVE),recordBytes,{flag:'wx'});
    fs.writeFileSync(path.join(dir,V2_SHA_RELATIVE),shaBytes,{flag:'wx'});
    const out=path.join(dir,'bundle.tar.gz');
    execFileSync('tar',['-czf',out,'-C',dir,V2_RELATIVE,V2_SHA_RELATIVE],{stdio:'pipe'});
    return fs.readFileSync(out);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function writeBundle(roots,record){
  const bytes=Buffer.from(JSON.stringify(stable(record),null,2)+'\n'),sha=sha256(bytes),shaBytes=Buffer.from(sha+'\n');
  storeImmutablePair(roots,V2_RELATIVE,bytes);
  storeImmutablePair(roots,V2_SHA_RELATIVE,shaBytes);
  const a=path.join(roots.primary,V2_ARCHIVE_RELATIVE),b=path.join(roots.secondary,V2_ARCHIVE_RELATIVE);
  const ea=fs.existsSync(a),eb=fs.existsSync(b);
  let archiveBytes;
  if(ea||eb){
    const present=ea?a:b;
    archiveBytes=fs.readFileSync(present);
    if(!readArchiveMember(present,V2_RELATIVE).equals(bytes)||!readArchiveMember(present,V2_SHA_RELATIVE).equals(shaBytes))
      fail('existing immutable archive conflicts');
    if(ea&&eb&&!durable.verifyDualCopy(a,b).bytes.equals(archiveBytes))fail('archive copies differ','BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE');
    if(ea!==eb)durable.atomicWrite(ea?b:a,archiveBytes);
  }else{
    archiveBytes=makeArchiveBytes(bytes,shaBytes);
    durable.writeDualCopy(a,b,archiveBytes);
  }
  const archiveSha=sha256(archiveBytes),archiveShaBytes=Buffer.from(archiveSha+'\n');
  storeImmutablePair(roots,V2_ARCHIVE_SHA_RELATIVE,archiveShaBytes);
  return {sha256:sha,archiveSha256:archiveSha};
}

module.exports={V1_RELATIVE,V1_SHA256,V1_FIX_COMMIT,ORIGINAL_LOCAL_COMMIT,CORRECTION_BASE_COMMIT,
  PROOF_SHA256,AMENDMENT_RESULT_SHA256,SEARCH_MANIFEST_SHA256,LOW_GENESIS_SHA256,STAGE3E_WASM_SHA256,
  V2_RELATIVE,V2_SHA_RELATIVE,V2_ARCHIVE_RELATIVE,V2_ARCHIVE_SHA_RELATIVE,VERIFIER_MODULE_PATHS,PROTECTED_TRACKED_PATHS,
  CANDIDATE_ACOUSTIC_IDENTITY_FIELDS,candidateAcousticIdentity,sha256,stable,same,jsonDigest,isAncestor,currentArtifacts,fixedInventorySha,validateV1,buildRecord,validateRecord,
  readArchiveMember,readBundle,writeBundle,storeImmutablePair};
