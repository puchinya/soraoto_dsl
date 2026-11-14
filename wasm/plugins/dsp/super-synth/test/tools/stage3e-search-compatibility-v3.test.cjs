'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const v2=require('./stage3e-search-compatibility.cjs');
const v3=require('./stage3e-search-compatibility-v3.cjs');
const validator=require('./stage3e-evidence-validator.cjs');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-v3-test-'));
try{
  const roots={primary:path.join(root,'primary'),secondary:path.join(root,'secondary')};
  fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
  const manifest={identity:{candidateId:'stage2n-r3-candidate-01',protectedIdentity:{candidateId:'stage2n-r3-candidate-01',
    diagnosticWasmSha256:'a'.repeat(64),sourcePluginSha256:'b'.repeat(64),configSha256:'c'.repeat(64),profileSha256:'d'.repeat(64),
    presetsSha256:'e'.repeat(64),referenceFixtureSha256:'f'.repeat(64)}}};
  const record={schemaVersion:3,kind:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBILITY',decision:'STAGE3E_PRE_RENDER_RECOVERY_COMPATIBLE',
    v1Sha256:v2.V1_SHA256,v2Sha256:'5f3340f7b993bb879aa29bca4214e5192008f54308d20160282aac0cfcc6f797',
    v2AcceptedCommit:v3.V2_ACCEPTED_COMMIT,recoveryCommit:'8'.repeat(40),originalProofSha256:v2.PROOF_SHA256,originalManifestSha256:validator.SEARCH_MANIFEST_SHA256,
    bootstrapLedgerSha256:validator.LOW_GENESIS_SHA256,preAbortLedgerSha256:v3.PRE_ABORT_LEDGER_SHA256,
    protectedStage3eWasmSha256:v2.STAGE3E_WASM_SHA256,fixed35InventorySha256:'25e4bb121a8714bc90cd83ed00df1c8eb577208b87d2e272b15fc389fd212adf',
    preRenderAbortEvidenceSha256:'e601de82fbb382065b0d3c7efed6da8540c25681d5e622a11fb74a4cf12bb482',
    searchCompletedAtBridgeCreation:0,allowedUnchangedAcousticRenders:0,primarySecondaryIntegrity:'PASS',
    pinnedExecutorHashes:Object.fromEntries(Object.keys(v3.PINNED_PATHS).map(key=>[key,'9'.repeat(64)])),
    acousticCriticalInputs:v3.acousticCriticalInputs(manifest),
    baselineAcceptance:{decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',effectiveCellCount:12,effectivePassCount:12,
      maximumDifference:0,tolerance:1e-6,amendmentResultSha256:v2.AMENDMENT_RESULT_SHA256}};
  const currentIdentity=Object.fromEntries(v3.IDENTITY_FIELDS.map(key=>[key,record.acousticCriticalInputs[key]]));
  const options={root,head:'8'.repeat(40),manifest,v1Sha256:record.v1Sha256,v2Sha256:record.v2Sha256,
    sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,inventorySha256:record.fixed35InventorySha256,
    preAbortEvidenceSha256:record.preRenderAbortEvidenceSha256,pinned:record.pinnedExecutorHashes,currentIdentity,
    isAncestorCheck:()=>true};
  assert.equal(v3.validateRecord(record,options).pass,true);
  assert.throws(()=>v3.validateRecord({...record,pinnedExecutorHashes:{...record.pinnedExecutorHashes,captureHelper:'0'.repeat(64)}},options),/pinned verifier\/executor SHA changed/);
  assert.throws(()=>v3.validateRecord({...record,originalProofSha256:'0'.repeat(64)},options),/v3 originalProofSha256 mismatch/);
  assert.throws(()=>v3.validateRecord({...record,preAbortLedgerSha256:'0'.repeat(64)},options),/preAbortLedgerSha256 mismatch/);
  const saved=v3.writeBundle(roots,record);assert.match(saved.sha256,/^[0-9a-f]{64}$/);
  const replay=v3.readBundle(roots);assert.equal(replay.sha256,saved.sha256);assert.equal(replay.archiveSha256,saved.archiveSha256);
  assert.throws(()=>v3.writeBundle(roots,{...record,decision:'REPLACEMENT'}),/already exists/,'v3 is immutable and cannot be re-signed');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS Stage3E verifier compatibility v3 ancestry, pinning, dual-copy, and immutable archive');
