'use strict';
const assert=require('node:assert/strict');
const compatibility=require('./stage3e-search-compatibility.cjs');
const validator=require('./stage3e-evidence-validator.cjs');
const root='/tmp/stage3e-compatibility-fixture';
const accepted='a'.repeat(40),descendant='b'.repeat(40),bad='c'.repeat(40);
const v1={schemaVersion:1,decision:'STAGE3E_SEARCH_VERIFIER_COMPATIBLE',
  originalLocalCommit:compatibility.ORIGINAL_LOCAL_COMMIT,verifierFixCommit:compatibility.V1_FIX_COMMIT};
const manifestIdentity={candidateId:'candidate',captureHelperSha256:'1'.repeat(64),protectedIdentity:{
  candidateId:'candidate',sourceRevision:'creator-revision',stage3eRunnerSha256:'old-runner',
  sourcePluginSha256:'2'.repeat(64),diagnosticWasmSha256:compatibility.STAGE3E_WASM_SHA256,
  configSha256:'3'.repeat(64),profileSha256:'4'.repeat(64),presetsSha256:'5'.repeat(64),
  referenceFixtureSha256:'6'.repeat(64),stage3eCaptureHelperSha256:'1'.repeat(64)}};
const artifacts={verifierModules:{'stage3e-preflight.cjs':'7'.repeat(64)},
  protectedSearchArtifacts:{trackedFiles:{'plugin.c':'2'.repeat(64)},stage3eWasm:{path:'/tmp/plugin.wasm',
    sha256:compatibility.STAGE3E_WASM_SHA256,cmakeOptions:{stage3e:'ON'}},candidateIdentity:compatibility.candidateAcousticIdentity(manifestIdentity.protectedIdentity)}};
const diff={files:['stage3e-preflight.cjs'],sha256:'8'.repeat(64)};
const tests=[{file:'injected-render-simulation',exitCode:0,outputSha256:'9'.repeat(64)}];
const record={schemaVersion:2,kind:'STAGE3E_SEARCH_VERIFIER_COMPATIBILITY',decision:'STAGE3E_SEARCH_VERIFIER_COMPATIBLE',
  predecessorV1Sha256:compatibility.V1_SHA256,originalLocalCommit:compatibility.ORIGINAL_LOCAL_COMMIT,
  originalVerifierFixCommit:compatibility.V1_FIX_COMMIT,correctionBaseCommit:compatibility.CORRECTION_BASE_COMMIT,
  acceptedVerifierCommit:accepted,predecessorIdentityScopeProofSha256:'e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb',
  sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,midi41AmendmentResultSha256:compatibility.AMENDMENT_RESULT_SHA256,
  searchManifestSha256:compatibility.SEARCH_MANIFEST_SHA256,initialLowLedgerSha256:compatibility.LOW_GENESIS_SHA256,
  searchLedgerBootstrap:{authorized:1512,pending:1512,inProgress:0,complete:0,renderCalls:0,cellPayloadFiles:0},
  originalFixedInventorySha256:'a'.repeat(64),protectedSearchArtifacts:artifacts.protectedSearchArtifacts,
  verifierModules:artifacts.verifierModules,candidateIdentity:{candidateId:'candidate',
    sourcePluginSha256:'2'.repeat(64),diagnosticWasmSha256:compatibility.STAGE3E_WASM_SHA256,
    configSha256:'3'.repeat(64),profileSha256:'4'.repeat(64),presetsSha256:'5'.repeat(64),
    referenceFixtureSha256:'6'.repeat(64),captureHelperSha256:'1'.repeat(64),stage3eCaptureHelperSha256:'1'.repeat(64)},
  baselineAcceptance:{decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',effectivePassCount:12,effectiveCellCount:12,
    maxMetricDifference:0,tolerance:0.000001,amendmentResultSha256:compatibility.AMENDMENT_RESULT_SHA256},
  allowedVerifierOnlyDiffSha256:diff.sha256,allowedVerifierOnlyDiffFiles:diff.files,testedCommands:tests,
  unitAndInjectedIntegrationResultSha256:compatibility.jsonDigest(tests),primarySecondaryIntegrity:'PASS'};
function isAncestor(_root,from,to){
  if(from===compatibility.V1_FIX_COMMIT||from===compatibility.CORRECTION_BASE_COMMIT)return to===accepted;
  if(from===accepted)return to===accepted||to===descendant;
  return false;
}
function validate(change={},head=accepted,currentArtifacts=artifacts){return compatibility.validateRecord({root,compatibility:{...record,...change},
  v1,v1Sha256:compatibility.V1_SHA256,manifestIdentity,sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,
  inventorySha256:'a'.repeat(64),artifacts:currentArtifacts,diff,head,isAncestorCheck:isAncestor,assertClean:()=>true});}
assert.equal(validate().acceptedVerifierCommit,accepted);
assert.equal(validate({},descendant).currentHead,descendant);
assert.throws(()=>validate({},bad),/not an ancestor of current HEAD/);
assert.throws(()=>validate({predecessorV1Sha256:'0'.repeat(64)}),/predecessorV1Sha256 mismatch/);
assert.throws(()=>validate({verifierModules:{'stage3e-preflight.cjs':'0'.repeat(64)}}),/pinned verifier or acoustic artifact SHA changed/);
assert.throws(()=>validate({protectedSearchArtifacts:{...artifacts.protectedSearchArtifacts,trackedFiles:{'plugin.c':'0'.repeat(64)}}}),
  /pinned verifier or acoustic artifact SHA changed/);
const driftedCandidate={...artifacts,protectedSearchArtifacts:{...artifacts.protectedSearchArtifacts,
  candidateIdentity:{...compatibility.candidateAcousticIdentity(manifestIdentity.protectedIdentity),configSha256:'0'.repeat(64)}}};
assert.throws(()=>validate({},accepted,driftedCandidate),/pinned verifier or acoustic artifact SHA changed/);
assert.throws(()=>compatibility.validateRecord({root,compatibility:record,v1,v1Sha256:'0'.repeat(64),
  manifestIdentity,sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,inventorySha256:'a'.repeat(64),
  artifacts,diff,head:accepted,isAncestorCheck:isAncestor,assertClean:()=>true}),/immutable v1 predecessor identity mismatch/);
console.log('PASS Stage3E v2 compatibility anchor, descendant, immutable predecessor, and pinned identities');
