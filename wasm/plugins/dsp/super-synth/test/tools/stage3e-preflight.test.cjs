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

function digest(value){return require('node:crypto').createHash('sha256').update(Buffer.from(JSON.stringify(preflight.stable(value)))).digest('hex');}
{
  const protectedIdentity={candidateId:'stage2n-r3-candidate-01',diagnosticWasmSha256:'1'.repeat(64),sourcePluginSha256:'2'.repeat(64),
    stage3eCaptureHelperSha256:'3'.repeat(64),stage3eRunnerSha256:'4'.repeat(64),presetsSha256:'5'.repeat(64),profileSha256:'6'.repeat(64),
    configSha256:'7'.repeat(64),referenceFixtureSha256:'8'.repeat(64)};
  const manifestIdentity={creatorRevision:'79121646babd0e1031de03aae1a5bed486e59f8a',runnerSha256:'9'.repeat(64),
    captureHelperSha256:'3'.repeat(64),coreSha256:'f'.repeat(64),protectedIdentity};
  const current={generation2RunnerSha256:'a'.repeat(64),captureHelperSha256:'3'.repeat(64),candidateId:protectedIdentity.candidateId,
    coreSha256:'f'.repeat(64),
    diagnosticWasmSha256:protectedIdentity.diagnosticWasmSha256,sourcePluginSha256:protectedIdentity.sourcePluginSha256,
    stage3eCaptureHelperSha256:protectedIdentity.stage3eCaptureHelperSha256,stage3eRunnerSha256:protectedIdentity.stage3eRunnerSha256,
    presetsSha256:protectedIdentity.presetsSha256,profileSha256:protectedIdentity.profileSha256,configSha256:protectedIdentity.configSha256,
    referenceFixtureSha256:protectedIdentity.referenceFixtureSha256};
  const captureControls={sampleRate:48000,durationMs:380,stage2mFactorMask:3,stage3eBaselineResponse:{low:1,mid:1,bassHardness:1}};
  const root=path.resolve(__dirname,'../../../../../../');
  const head=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const testResults=[{file:'injected-fixture',exitCode:0,outputSha256:'e'.repeat(64)}];
  const diff=preflight.trackedDiff(root,'79121646babd0e1031de03aae1a5bed486e59f8a',head);
  const compatibility={schemaVersion:1,decision:'STAGE3E_SEARCH_VERIFIER_COMPATIBLE',originalLocalCommit:'79121646babd0e1031de03aae1a5bed486e59f8a',
    verifierFixCommit:head,originalProofSha256:preflight.PROOF_SHA256,originalAmendmentResultSha256:preflight.AMENDMENT_RESULT_SHA256,
    originalSearchManifestSha256:preflight.MANIFEST_SHA256,lowGenesisLedgerSha256:preflight.GENESIS_SHA256,
    originalRunnerSha256:manifestIdentity.runnerSha256,newRunnerSha256:current.generation2RunnerSha256,
    originalCaptureHelperSha256:manifestIdentity.captureHelperSha256,newCaptureHelperSha256:current.captureHelperSha256,
    stage3eWasmSha256:protectedIdentity.diagnosticWasmSha256,configSha256:protectedIdentity.configSha256,
    profileSha256:protectedIdentity.profileSha256,presetsSha256:protectedIdentity.presetsSha256,fixtureSha256:protectedIdentity.referenceFixtureSha256,
    originalVelocityResponseRunnerSha256:protectedIdentity.stage3eRunnerSha256,newVelocityResponseRunnerSha256:current.stage3eRunnerSha256,
    originalCaptureHelperSha256FromCandidate:protectedIdentity.stage3eCaptureHelperSha256,newCaptureHelperSha256FromCandidate:current.stage3eCaptureHelperSha256,
    allowedVerifierOnlyDiffSha256:diff.sha256,unitAndInjectedIntegrationResultSha256:require('node:crypto').createHash('sha256').update(Buffer.from(JSON.stringify(preflight.stable(testResults))+'\n')).digest('hex'),
    zeroRenderTestResults:testResults,captureControls,
    captureControlsSha256:digest(captureControls),primarySecondaryIntegrity:'PASS'};
  const testOnlyClean=()=>true;
  assert.equal(preflight.validateCompatibility({root,compatibility,manifestIdentity,current,assertClean:testOnlyClean}).pass,true);
  assert.throws(()=>preflight.validateCompatibility({root,compatibility:{...compatibility,newCaptureHelperSha256:'e'.repeat(64)},manifestIdentity,current,assertClean:testOnlyClean}),
    /BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY/);
  assert.throws(()=>preflight.validateCompatibility({root,compatibility,manifestIdentity,current:{...current,configSha256:'f'.repeat(64)},assertClean:testOnlyClean}),
    /BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY/);
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
