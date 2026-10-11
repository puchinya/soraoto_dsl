'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const os=require('node:os');
const preflight=require('./stage3e-preflight.cjs');
const generation2=require('./run-stage3e-generation2.cjs');
const amendment=require('./run-stage3e-midi41-evidence-amendment.cjs');
const velocity=require('./run-stage3e-velocity-response.cjs');

const compatibilityV2=require('./stage3e-search-compatibility.cjs');
const validator=require('./stage3e-evidence-validator.cjs');

{
  const root=path.resolve(__dirname,'../../../../../../');
  const accepted='a'.repeat(40),descendant='b'.repeat(40),fakeRoot=os.tmpdir();
  const protectedIdentity={candidateId:'stage2n-r3-candidate-01',diagnosticWasmSha256:'1'.repeat(64),sourcePluginSha256:'2'.repeat(64),
    stage3eCaptureHelperSha256:'3'.repeat(64),stage3eRunnerSha256:'4'.repeat(64),presetsSha256:'5'.repeat(64),profileSha256:'6'.repeat(64),
    configSha256:'7'.repeat(64),referenceFixtureSha256:'8'.repeat(64)};
  const manifestIdentity={creatorRevision:'79121646babd0e1031de03aae1a5bed486e59f8a',candidateId:protectedIdentity.candidateId,
    captureHelperSha256:'3'.repeat(64),protectedIdentity};
  const v1={schemaVersion:1,decision:'STAGE3E_SEARCH_VERIFIER_COMPATIBLE',
    originalLocalCommit:compatibilityV2.ORIGINAL_LOCAL_COMMIT,verifierFixCommit:compatibilityV2.V1_FIX_COMMIT};
  const artifacts={verifierModules:{'stage3e-preflight.cjs':'9'.repeat(64)},
    protectedSearchArtifacts:{trackedFiles:{'plugin.c':'2'.repeat(64)},stage3eWasm:{path:'/private/build/plugin.wasm',sha256:'1'.repeat(64),cmakeOptions:{stage3e:'ON'}}}};
  const diff={files:['stage3e-preflight.cjs'],sha256:'c'.repeat(64)};
  const commands=[{file:'injected',exitCode:0,outputSha256:'d'.repeat(64)}];
  const record={schemaVersion:2,kind:'STAGE3E_SEARCH_VERIFIER_COMPATIBILITY',decision:'STAGE3E_SEARCH_VERIFIER_COMPATIBLE',
    predecessorV1Sha256:compatibilityV2.V1_SHA256,originalLocalCommit:compatibilityV2.ORIGINAL_LOCAL_COMMIT,
    originalVerifierFixCommit:compatibilityV2.V1_FIX_COMMIT,correctionBaseCommit:compatibilityV2.CORRECTION_BASE_COMMIT,
    acceptedVerifierCommit:accepted,predecessorIdentityScopeProofSha256:'e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb',
    sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,midi41AmendmentResultSha256:compatibilityV2.AMENDMENT_RESULT_SHA256,
    searchManifestSha256:compatibilityV2.SEARCH_MANIFEST_SHA256,initialLowLedgerSha256:compatibilityV2.LOW_GENESIS_SHA256,
    searchLedgerBootstrap:{authorized:1512,pending:1512,inProgress:0,complete:0,renderCalls:0,cellPayloadFiles:0},
    originalFixedInventorySha256:'f'.repeat(64),protectedSearchArtifacts:artifacts.protectedSearchArtifacts,
    verifierModules:artifacts.verifierModules,candidateIdentity:{candidateId:protectedIdentity.candidateId,
      sourcePluginSha256:protectedIdentity.sourcePluginSha256,diagnosticWasmSha256:protectedIdentity.diagnosticWasmSha256,
      configSha256:protectedIdentity.configSha256,profileSha256:protectedIdentity.profileSha256,presetsSha256:protectedIdentity.presetsSha256,
      referenceFixtureSha256:protectedIdentity.referenceFixtureSha256,captureHelperSha256:manifestIdentity.captureHelperSha256,
      stage3eCaptureHelperSha256:protectedIdentity.stage3eCaptureHelperSha256},
    baselineAcceptance:{decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',effectivePassCount:12,effectiveCellCount:12,
      maxMetricDifference:0,tolerance:0.000001,amendmentResultSha256:compatibilityV2.AMENDMENT_RESULT_SHA256},
    allowedVerifierOnlyDiffSha256:diff.sha256,allowedVerifierOnlyDiffFiles:diff.files,testedCommands:commands,
    unitAndInjectedIntegrationResultSha256:compatibilityV2.jsonDigest(commands),primarySecondaryIntegrity:'PASS'};
  function ancestor(_root,from,to){
    if(from===compatibilityV2.V1_FIX_COMMIT||from===compatibilityV2.CORRECTION_BASE_COMMIT)return to===accepted;
    if(from===accepted)return to===accepted||to===descendant;
    return false;
  }
  function validate(change={},head=accepted){
    return compatibilityV2.validateRecord({root:fakeRoot,compatibility:{...record,...change},v1,
      v1Sha256:compatibilityV2.V1_SHA256,manifestIdentity,sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,
      inventorySha256:'f'.repeat(64),artifacts,diff,head,isAncestorCheck:ancestor,assertClean:()=>true});
  }
  assert.equal(validate().acceptedVerifierCommit,accepted,'anchor HEAD is valid');
  assert.equal(validate({},descendant).currentHead,descendant,'a pinned-hash-identical descendant is valid');
  assert.throws(()=>validate({},'c'.repeat(40)),/not an ancestor of current HEAD/);
  assert.throws(()=>validate({predecessorV1Sha256:'0'.repeat(64)}),/predecessorV1Sha256 mismatch/);
  assert.throws(()=>validate({verifierModules:{'stage3e-preflight.cjs':'0'.repeat(64)}}),/pinned verifier or acoustic artifact SHA changed/);
  assert.throws(()=>compatibilityV2.validateRecord({root:fakeRoot,compatibility:record,v1,v1Sha256:'0'.repeat(64),
    manifestIdentity,sourceAuditSha256:validator.SOURCE_AUDIT_SHA256,inventorySha256:'f'.repeat(64),artifacts,diff,
    head:accepted,isAncestorCheck:ancestor,assertClean:()=>true}),/immutable v1 predecessor identity mismatch/);
}

{
  const root=path.resolve(__dirname,'../../../../../../'),roots=preflight.searchRoots(root);
  const manifestBytes=fs.readFileSync(path.join(roots.primary,'generation-2-manifest.json'));
  const ledgerPath=path.join(roots.primary,'low/low-ledger.json');
  const currentLedgerBytes=fs.readFileSync(ledgerPath);
  const journalDir=path.join(roots.primary,'ledger-transition-journal');
  const genesisPath=path.join(journalDir,'genesis-ledger.json');
  const genesisBytes=fs.existsSync(genesisPath)?fs.readFileSync(genesisPath):currentLedgerBytes;
  assert.equal(require('node:crypto').createHash('sha256').update(genesisBytes).digest('hex'),preflight.GENESIS_SHA256);
  const v2=compatibilityV2.readBundle(roots),v3=require('./stage3e-search-compatibility-v3.cjs').readBundle(roots),
    reconciliation=require('./stage3e-recovery-reconciliation-v2.cjs').readCompatibility(roots);
  const live=preflight.validateSearchLedger({roots,manifestBytes,ledgerBytes:currentLedgerBytes,compatibilitySha256:v3.sha256,
    historicalCompatibilitySha256:v2.sha256,recoveryReconciliationCompatibilitySha256:reconciliation.sha256});
  assert.equal(live.inProgress,0,'valid append-only search transitions are accepted after recovery');
  assert.equal(live.renderCalls,JSON.parse(currentLedgerBytes.toString('utf8')).accounting.renderCalls,
    'ledger accounting agrees with its persisted transition/render-start journal');
  assert.equal(live.pending+live.complete,1512,'search progress remains within the original fixed grid');
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-genesis-fixture-'));
  const pRoot=path.join(base,'primary'),sRoot=path.join(base,'secondary');
  try{
    for(const evidenceRoot of [pRoot,sRoot]){
      fs.mkdirSync(path.join(evidenceRoot,'low'),{recursive:true});
      fs.mkdirSync(path.join(evidenceRoot,'ledger-transition-journal'),{recursive:true});
      fs.writeFileSync(path.join(evidenceRoot,'generation-2-manifest.json'),manifestBytes);
      fs.writeFileSync(path.join(evidenceRoot,'low/low-ledger.json'),genesisBytes);
      fs.writeFileSync(path.join(evidenceRoot,'ledger-transition-journal/genesis-ledger.json'),genesisBytes);
    }
    const ledger=JSON.parse(genesisBytes.toString('utf8'));
    const attestation={schemaVersion:1,decision:'STAGE3E_SEARCH_LEDGER_GENESIS',phase:'low',
      genesisLedgerSha256:preflight.GENESIS_SHA256,manifestSha256:preflight.MANIFEST_SHA256,
      proofSha256:preflight.PROOF_SHA256,compatibilitySha256:'a'.repeat(64),identity:ledger.identity,
      authorizedCellCount:1512,renderCalls:0};
    const recordBytes=Buffer.from(JSON.stringify(attestation));
    for(const evidenceRoot of [pRoot,sRoot])fs.writeFileSync(path.join(evidenceRoot,'ledger-transition-journal/genesis.json'),recordBytes);
    const accepted=preflight.validateSearchLedger({roots:{primary:pRoot,secondary:sRoot},manifestBytes,
      ledgerBytes:genesisBytes,compatibilitySha256:'a'.repeat(64)});
    assert.equal(accepted.genesisRequired,false,'raw ledger snapshot and attestation are separate files');
    assert.equal(accepted.renderCalls,0);
  }finally{fs.rmSync(base,{recursive:true,force:true});}
}

// Import direction is part of the regression: CLI wrappers may depend on the
// phase runner, but phase runners and pure preflight must not import the wrapper.
for(const name of ['run-stage3e-generation2.cjs','run-stage3e-midi41-evidence-amendment.cjs','stage3e-preflight.cjs']){
  const source=fs.readFileSync(path.join(__dirname,name),'utf8');
  assert.equal(source.includes("require('./run-stage3e-velocity-response.cjs')"),false,`${name} must not create a back-edge to the wrapper`);
}
assert.equal(typeof generation2.run,'function');assert.equal(typeof amendment.verify,'function');
assert.equal(typeof velocity.evidencePreflight,'function');assert.equal(typeof preflight.preflight,'function');
{
  const roots={primary:'/evidence/primary',secondary:'/evidence/secondary'},bundle={record:{decision:'fixed'}};
  let received=null;
  const reconciliation={validateCompatibilityRecord(record,options){received={record,options};return {pass:true};}};
  const result=preflight.validateRecoveryCompatibility({reconciliation,bundle,root:'/repo',roots,manifest:{id:'manifest'},
    manifestSha256:'a'.repeat(64),bridge:{sha256:'b'.repeat(64)},forensicSha256:'c'.repeat(64),
    sourceAuditSha256:'d'.repeat(64),oldResultSha256:'e'.repeat(64),testReportSha256:'f'.repeat(64)});
  assert.equal(result.pass,true);
  assert.equal(received.record,bundle.record);
  assert.equal(received.options.evidenceRoots,roots,'reconciliation validation receives the canonical evidence roots');
}
{
  const roots={primary:'/evidence/primary',secondary:'/evidence/secondary'},bundle={record:{decision:'v3'},sha256:'a'.repeat(64)};
  const injected=()=>({sha256:'b'.repeat(64),record:{decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'}});
  assert.throws(()=>preflight.selectPerformanceVerifier({roots,verify:injected}),/injected verifier overrides are not allowed/);
  assert.throws(()=>preflight.validatePerformanceVerifierBinding({root:'/repo',manifest:{id:'manifest'},bundle,roots,
    expectedSha256:'b'.repeat(64),verify:injected}),/injected verifier overrides are not allowed/);
}
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-perf-verifier-select-'));
  const roots={primary:path.join(root,'primary'),secondary:path.join(root,'secondary')};
  try{
    fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
    const v2=require('./stage3e-performance-verifier-continuation-v2.cjs');
    const v3=require('./stage3e-performance-verifier-continuation-v3.cjs');
    const v4=require('./stage3e-performance-verifier-continuation-v4.cjs');
    const v5=require('./stage3e-performance-verifier-continuation-v5.cjs');
    const v6=require('./stage3e-performance-verifier-continuation-v6.cjs');
    const v7=require('./stage3e-performance-verifier-continuation-v7.cjs');
    const v8=require('./stage3e-performance-verifier-continuation-v8.cjs');
    const v9=require('./stage3e-performance-verifier-continuation-v9.cjs');
    const v10=require('./stage3e-performance-verifier-continuation-v10.cjs');
    const v11=require('./stage3e-performance-verifier-continuation-v11.cjs');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v1');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v2');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V3_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v3','the newest dual-saved verifier continuation is selected');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V4_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v4','the newest dual-saved verifier continuation is selected');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V5_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v5','the newest dual-saved verifier continuation is selected');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V6_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v6','v6 is selected ahead of immutable older continuations');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V7_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v7','v7 is selected ahead of immutable older continuations');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V8_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v8','v8 is selected ahead of immutable older continuations');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V9_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v9','v9 is selected ahead of immutable older continuations');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V10_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}),v11.runtimeContext,
      'a v10-only root still goes through the source-binding guard');
    for(const side of Object.values(roots))fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V11_RELATIVE),'{}');
    assert.equal(preflight.selectPerformanceVerifier({roots}),v11.runtimeContext,'v11 source authorization is selected when present');
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V11_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v11 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V11_RELATIVE));
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V10_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v10 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V10_RELATIVE));
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v9','v9 remains available when v10 is absent');
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V9_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v9 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V9_RELATIVE));
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V8_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v8 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V8_RELATIVE));
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v7','v7 is preserved as fallback when v8 is absent');
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V7_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v7 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V7_RELATIVE));
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V6_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v6 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V6_RELATIVE));
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V5_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v5 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V5_RELATIVE));
    assert.equal(preflight.selectPerformanceVerifier({roots}).sourceVerifierVersion,'v4','v4 remains the fallback when v5 is absent');
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V4_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v4 continuation exists in only one store/);
    fs.rmSync(path.join(roots.primary,preflight.PERFORMANCE_CONTINUATION_V4_RELATIVE));
    fs.rmSync(path.join(roots.secondary,preflight.PERFORMANCE_CONTINUATION_V3_RELATIVE));
    assert.throws(()=>preflight.selectPerformanceVerifier({roots}),/performance v3 continuation exists in only one store/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-perf-verifier-source-'));
  const evidenceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-perf-verifier-roots-'));
  const relative='wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs';
  const verifier=require('./stage3e-performance-verifier-continuation-v9.cjs');
  const originalRuntime=verifier.runtimeContext;
  try{
    execFileSync('rtk',['git','init','--quiet'],{cwd:root});
    execFileSync('rtk',['git','config','user.name','Stage3E verifier test'],{cwd:root});
    execFileSync('rtk',['git','config','user.email','stage3e-test@example.invalid'],{cwd:root});
    const source=path.join(root,relative);fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,'approved verifier source\n');
    execFileSync('rtk',['git','add',relative],{cwd:root});
    execFileSync('rtk',['git','commit','--quiet','-m','approved verifier source'],{cwd:root});
    const acceptedCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    verifier.runtimeContext=()=>({decision:'TEST_PASS',acceptedCommit});
    const roots={primary:path.join(evidenceRoot,'primary'),secondary:path.join(evidenceRoot,'secondary')};
    for(const side of Object.values(roots)){fs.mkdirSync(side,{recursive:true});fs.writeFileSync(path.join(side,preflight.PERFORMANCE_CONTINUATION_V9_RELATIVE),'{}');}
    const selected=preflight.selectPerformanceVerifier({roots});
    assert.equal(selected.sourceVerifierVersion,'v9');
    assert.equal(selected({root}).decision,'TEST_PASS');
    fs.writeFileSync(source,'tampered verifier source\n');
    assert.throws(()=>selected({root}),/current incremental verifier differs from its authorized source hash/,
      'legacy fallback branches also bind the current incremental verifier source');
  }finally{
    verifier.runtimeContext=originalRuntime;
    fs.rmSync(root,{recursive:true,force:true});fs.rmSync(evidenceRoot,{recursive:true,force:true});
  }
}
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-lock-'));
  try{
    execFileSync('rtk',['git','init','--quiet'],{cwd:root});
    const first=preflight.acquireWriterLock({root,phase:'low',executionIdentity:'fixed-run'});
    assert.throws(()=>preflight.acquireWriterLock({root,phase:'low',executionIdentity:'second-run'}),/BLOCKED_STAGE3E_WRITER_LOCKED/);
    first.release();
    const second=preflight.acquireWriterLock({root,phase:'low',executionIdentity:'fixed-run'});second.release();
    const common=execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();
    const stale=path.join(common,'soraoto-agent-locks','issue-7-stage3e-generation-2-low.lock');
    fs.mkdirSync(path.dirname(stale),{recursive:true});fs.writeFileSync(stale,'stale');
    assert.throws(()=>preflight.acquireWriterLock({root,phase:'low',executionIdentity:'fixed-run'}),/BLOCKED_STAGE3E_WRITER_LOCKED/);
    assert.equal(fs.readFileSync(stale,'utf8'),'stale','stale lock is never removed automatically');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
console.log('PASS Stage3E preflight identity scopes and acyclic runner dependency direction');
