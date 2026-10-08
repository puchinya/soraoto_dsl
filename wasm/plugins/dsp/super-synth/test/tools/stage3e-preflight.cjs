'use strict';

// Read-only evidence gate shared by the CLI wrapper and the Generation-2 runner.
// This module may import validators and capture capability probes, but never a
// CLI runner, so dependency direction stays acyclic.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const validator=require('./stage3e-evidence-validator.cjs');
const search=require('./stage3e-search-core.cjs');
const capture=require('./capture-supersynth-stage3e-matrix.cjs');

const MANIFEST_SHA256=validator.SEARCH_MANIFEST_SHA256;
const GENESIS_SHA256=validator.LOW_GENESIS_SHA256;
const PROOF_SHA256='e6cc3049b6f5f20529c50c2bcab5bfa66a6afdfbe5bf9241b5b9cf7f53a130eb';
const AMENDMENT_RESULT_SHA256='690221637732fe46c4c7420254175b1b36720b181051b6c04a5710e13d8e0744';
const REFERENCE_SHA256='813a3069d384656419f1cf976c2b501a567909dfd2de5703fc58277f0096c0d8';
const COMPATIBILITY_RELATIVE='generation-2/search-v1/verifier-compatibility-v1.json';
const GENESIS_RELATIVE='generation-2/search-v1/ledger-transition-journal/genesis-ledger.json';
const JOURNAL_RELATIVE='generation-2/search-v1/ledger-transition-journal';
const ALLOWED_TRACKED_DIFFS=new Set([
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-search-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.test.cjs',
  'docs/agent-workflow/evidence-preservation.md',
  'docs/design/plugins/dsp/super-synth/super-synth-design.md',
]);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function readDualJson(roots,relative){return JSON.parse(durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.toString('utf8'));}
function readDualBytes(roots,relative){return durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative));}
function searchRoots(root=search.ROOT,home=process.env.HOME){
  const common=search.gitCommonDir(root),repository=path.basename(path.resolve(root));
  const base={primary:path.join(common,'soraoto-agent-state','7','stage3e'),secondary:path.join(home,'.soraoto-agent-archive',repository,'7','stage3e')};
  return {primary:path.join(base.primary,'generation-2/search-v1'),secondary:path.join(base.secondary,'generation-2/search-v1'),base};
}
function currentFiles(root){
  const current=search.currentProtectedIdentity(root);
  const runner=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs');
  const helper=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs');
  const core=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs');
  return {...current,generation2RunnerSha256:sha256(fs.readFileSync(runner)),captureHelperSha256:sha256(fs.readFileSync(helper)),
    coreSha256:sha256(fs.readFileSync(core))};
}
function gitBytes(root,args){return execFileSync('git',args,{cwd:root,maxBuffer:64*1024*1024});}
function trackedDiff(root,from,to){
  const names=gitBytes(root,['diff','--name-only',`${from}..${to}`]).toString('utf8').split(/\r?\n/).filter(Boolean);
  const unexpected=names.filter(name=>!ALLOWED_TRACKED_DIFFS.has(name));
  if(unexpected.length)throw new Error(`BLOCKED_STAGE3E_ACOUSTIC_CREATOR_DRIFT: non-verifier tracked diff ${unexpected.join(', ')}`);
  const patch=gitBytes(root,['diff','--binary','--no-ext-diff',`${from}..${to}`]);
  return {files:names.sort(),sha256:sha256(patch),patchBytes:patch.length};
}
function assertTrackedWorktreeClean(root){
  const status=gitBytes(root,['status','--porcelain','--untracked-files=no']).toString('utf8').trim();
  if(status)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: tracked worktree is dirty');
  return true;
}
function runCompatibilityTests(root){
  const files=[
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-midi41-evidence-amendment.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-historical-reference-requalification.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/stage3e-surrogate-provenance.test.cjs',
  ];
  const results=files.map(file=>{
    try{const output=execFileSync('rtk',['node',file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
      if(!/\bPASS\b/.test(output))return {file,exitCode:1,outputSha256:sha256(Buffer.from(output))};
      return {file,exitCode:0,outputSha256:sha256(Buffer.from(output))};}
    catch(error){return {file,exitCode:Number.isInteger(error.status)?error.status:1,outputSha256:sha256(Buffer.from(`${error.stdout||''}${error.stderr||''}`))};}
  });
  const failed=results.filter(item=>item.exitCode!==0);
  if(failed.length)throw new Error(`BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: zero-render tests failed ${failed.map(item=>item.file).join(', ')}`);
  return results;
}
function buildCompatibilityRecord({root=search.ROOT,manifestIdentity,zeroRenderTestResults=runCompatibilityTests(root)}={}){
  assertTrackedWorktreeClean(root);
  const verifierFixCommit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const ancestor=execFileSync('git',['merge-base','--is-ancestor','79121646babd0e1031de03aae1a5bed486e59f8a',verifierFixCommit],{cwd:root,stdio:'ignore'});
  void ancestor;
  const roots=searchRoots(root),stored=readDualBytes(roots,'generation-2-manifest.json'),manifest=JSON.parse(stored.bytes.toString('utf8'));
  if(stored.sha256!==MANIFEST_SHA256||!same(manifest.identity,manifestIdentity||manifest.identity))
    throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: fixed manifest identity unavailable');
  const fixedIdentity=manifest.identity,current=currentFiles(root),diff=trackedDiff(root,'79121646babd0e1031de03aae1a5bed486e59f8a',verifierFixCommit);
  const captureControls={sampleRate:capture.SAMPLE_RATE,durationMs:capture.DURATION_MS,stage2mFactorMask:3,
    stage3eBaselineResponse:{low:1,mid:1,bassHardness:1},includeSoundboardDiagnostics:true,
    midi41Derivative:{enabled:true,windowMs:[30,180],velocityMode:'normalized'}};
  const testResultsBytes=Buffer.from(JSON.stringify(stable(zeroRenderTestResults))+'\n');
  if(!Array.isArray(zeroRenderTestResults)||zeroRenderTestResults.length===0||zeroRenderTestResults.some(item=>item.exitCode!==0))
    throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: zero-render test result is incomplete');
  const record={schemaVersion:1,decision:'STAGE3E_SEARCH_VERIFIER_COMPATIBLE',
    originalLocalCommit:'79121646babd0e1031de03aae1a5bed486e59f8a',verifierFixCommit,
    originalProofSha256:PROOF_SHA256,originalAmendmentResultSha256:AMENDMENT_RESULT_SHA256,
    originalSearchManifestSha256:MANIFEST_SHA256,lowGenesisLedgerSha256:GENESIS_SHA256,
    originalRunnerSha256:fixedIdentity.runnerSha256,newRunnerSha256:current.generation2RunnerSha256,
    originalCaptureHelperSha256:fixedIdentity.captureHelperSha256,newCaptureHelperSha256:current.captureHelperSha256,
    stage3eWasmSha256:fixedIdentity.protectedIdentity.diagnosticWasmSha256,
    configSha256:fixedIdentity.protectedIdentity.configSha256,profileSha256:fixedIdentity.protectedIdentity.profileSha256,
    presetsSha256:fixedIdentity.protectedIdentity.presetsSha256,fixtureSha256:fixedIdentity.protectedIdentity.referenceFixtureSha256,
    originalVelocityResponseRunnerSha256:fixedIdentity.protectedIdentity.stage3eRunnerSha256,
    newVelocityResponseRunnerSha256:current.stage3eRunnerSha256,
    originalCaptureHelperSha256FromCandidate:fixedIdentity.protectedIdentity.stage3eCaptureHelperSha256,
    newCaptureHelperSha256FromCandidate:current.stage3eCaptureHelperSha256,
    allowedVerifierOnlyDiffSha256:diff.sha256,allowedVerifierOnlyDiffFiles:diff.files,
    zeroRenderTestResults,unitAndInjectedIntegrationResultSha256:sha256(testResultsBytes),
    captureControls,captureControlsSha256:sha256(Buffer.from(JSON.stringify(stable(captureControls)))),
    primarySecondaryIntegrity:'PASS',createdAt:new Date().toISOString()};
  validateCompatibility({root,compatibility:record,manifestIdentity:fixedIdentity,current});
  return record;
}
function validateCompatibility({root=search.ROOT,compatibility,manifestIdentity,current,assertClean=assertTrackedWorktreeClean,originalProofSha256=PROOF_SHA256,
  amendmentResultSha256=AMENDMENT_RESULT_SHA256,searchManifestSha256=MANIFEST_SHA256,lowGenesisSha256=GENESIS_SHA256,
  allowedDiffSha256,unitAndInjectedIntegrationResultSha256}={}){
  const fail=detail=>{throw new Error(`BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: ${detail}`);};
  if(!compatibility||compatibility.schemaVersion!==1||compatibility.decision!=='STAGE3E_SEARCH_VERIFIER_COMPATIBLE')fail('sidecar schema/decision');
  const head=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  if(compatibility.verifierFixCommit!==head)fail('verifier fix commit is not current HEAD');
  assertClean(root);
  const original=manifestIdentity||{};
  const protectedIdentity=original.protectedIdentity||{};
  const fixed={originalLocalCommit:'79121646babd0e1031de03aae1a5bed486e59f8a',
    originalProofSha256,originalAmendmentResultSha256:amendmentResultSha256,originalSearchManifestSha256:searchManifestSha256,
    lowGenesisLedgerSha256:lowGenesisSha256,originalRunnerSha256:original.runnerSha256,
    newRunnerSha256:current.generation2RunnerSha256,originalCaptureHelperSha256:original.captureHelperSha256,
    newCaptureHelperSha256:current.captureHelperSha256,stage3eWasmSha256:protectedIdentity.diagnosticWasmSha256,
    configSha256:protectedIdentity.configSha256,profileSha256:protectedIdentity.profileSha256,
    presetsSha256:protectedIdentity.presetsSha256,fixtureSha256:protectedIdentity.referenceFixtureSha256,
    originalVelocityResponseRunnerSha256:protectedIdentity.stage3eRunnerSha256,
    newVelocityResponseRunnerSha256:current.stage3eRunnerSha256,
    originalCaptureHelperSha256FromCandidate:protectedIdentity.stage3eCaptureHelperSha256,
    newCaptureHelperSha256FromCandidate:current.stage3eCaptureHelperSha256};
  for(const [key,value] of Object.entries(fixed))if(compatibility[key]!==value)fail(`${key} mismatch`);
  for(const key of ['sourcePluginSha256','diagnosticWasmSha256','presetsSha256','profileSha256','configSha256','referenceFixtureSha256'])
    if(protectedIdentity[key]!==current[key])fail(`audio identity changed: ${key}`);
  if(original.coreSha256!==current.coreSha256)fail('generation-2 metric/evaluation core changed');
  for(const key of ['originalCaptureHelperSha256','newCaptureHelperSha256','originalCaptureHelperSha256FromCandidate','newCaptureHelperSha256FromCandidate']){
    const value=compatibility[key];if(!/^[0-9a-f]{64}$/.test(value||''))fail(`${key} schema`);
  }
  if(compatibility.originalCaptureHelperSha256!==compatibility.newCaptureHelperSha256||
     compatibility.originalCaptureHelperSha256FromCandidate!==compatibility.newCaptureHelperSha256FromCandidate)fail('capture helper identity changed');
  const diff=trackedDiff(root,compatibility.originalLocalCommit,compatibility.verifierFixCommit);
  if(!/^[0-9a-f]{64}$/.test(compatibility.allowedVerifierOnlyDiffSha256||'')||
     compatibility.allowedVerifierOnlyDiffSha256!==diff.sha256||(allowedDiffSha256&&compatibility.allowedVerifierOnlyDiffSha256!==allowedDiffSha256))fail('allowed diff hash');
  const testResultsBytes=Buffer.from(JSON.stringify(stable(compatibility.zeroRenderTestResults))+'\n');
  const testResultsSha256=sha256(testResultsBytes);
  if(!Array.isArray(compatibility.zeroRenderTestResults)||compatibility.zeroRenderTestResults.length===0||
     compatibility.zeroRenderTestResults.some(item=>item.exitCode!==0)||
     !/^[0-9a-f]{64}$/.test(compatibility.unitAndInjectedIntegrationResultSha256||'')||
     compatibility.unitAndInjectedIntegrationResultSha256!==testResultsSha256||
     (unitAndInjectedIntegrationResultSha256&&compatibility.unitAndInjectedIntegrationResultSha256!==unitAndInjectedIntegrationResultSha256))fail('injected verification report hash');
  if(compatibility.primarySecondaryIntegrity!=='PASS')fail('dual-store integrity');
  if(compatibility.captureControls?.sampleRate!==48000||compatibility.captureControls?.durationMs!==380||
     compatibility.captureControls?.stage2mFactorMask!==3||compatibility.captureControls?.stage3eBaselineResponse?.low!==1||
     compatibility.captureControls?.stage3eBaselineResponse?.mid!==1||compatibility.captureControls?.stage3eBaselineResponse?.bassHardness!==1)
    fail('capture controls differ from original Generation-2 baseline');
  const captureControlsSha256=sha256(Buffer.from(JSON.stringify(stable(compatibility.captureControls))));
  if(compatibility.captureControlsSha256!==captureControlsSha256)fail('capture controls digest');
  return {pass:true,captureControlsSha256,compatibility};
}
function readTransitionEntries(roots){
  const primary=path.join(roots.primary,JOURNAL_RELATIVE),secondary=path.join(roots.secondary,JOURNAL_RELATIVE);
  if(!fs.existsSync(primary)&&!fs.existsSync(secondary))return [];
  if(!fs.existsSync(primary)||!fs.existsSync(secondary))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial transition journal');
  const names=fs.readdirSync(primary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort();
  const secondNames=fs.readdirSync(secondary).filter(name=>/^transition-[0-9]{6}\.json$/.test(name)).sort();
  if(!same(names,secondNames))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: transition journal path sets differ');
  return names.map(name=>JSON.parse(durable.verifyDualCopy(path.join(primary,name),path.join(secondary,name)).bytes.toString('utf8')));
}
function validateSearchLedger({roots,manifestBytes,ledgerBytes,compatibilitySha256,proofSha256=PROOF_SHA256}={}){
  const cells=search.expectedLowScreenCells(),ledger=JSON.parse(ledgerBytes.toString('utf8'));
  if(sha256(manifestBytes)!==MANIFEST_SHA256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: search manifest SHA mismatch');
  if(sha256(ledgerBytes)===GENESIS_SHA256){
    const manifest=JSON.parse(manifestBytes.toString('utf8'));
    const expectedLedgerIdentity={...manifest.identity,phase:'low',referenceSetSha256:manifest.identity.referenceSetSha256,
      authorizedGrid:search.lowGridTuples(),screenCoordinates:search.lowScreenCells()};
    const accepted=validator.validateLowGenesis({manifestBytes,ledgerBytes,expectedCells:cells,expectedLedgerIdentity});
    const journal=path.join(roots.primary,JOURNAL_RELATIVE),journalSecondary=path.join(roots.secondary,JOURNAL_RELATIVE);
    if(fs.existsSync(journal)||fs.existsSync(journalSecondary))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: journal exists before genesis transition');
    return {...accepted,genesisRequired:true,compatibilitySha256};
  }
  const genesisFile=readDualBytes(roots,GENESIS_RELATIVE),genesisLedger=JSON.parse(genesisFile.bytes.toString('utf8'));
  if(genesisFile.sha256!==GENESIS_SHA256||genesisLedger.genesisLedgerSha256!==GENESIS_SHA256||
     genesisLedger.manifestSha256!==MANIFEST_SHA256||genesisLedger.proofSha256!==proofSha256||
     genesisLedger.compatibilitySha256!==compatibilitySha256||genesisLedger.schemaVersion!==1||
     genesisLedger.decision!=='STAGE3E_SEARCH_LEDGER_GENESIS'||genesisLedger.phase!=='low'||
     genesisLedger.authorizedCellCount!==1512||genesisLedger.renderCalls!==0||!same(genesisLedger.identity,ledger.identity))
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: genesis attestation identity mismatch');
  const entries=readTransitionEntries(roots);
  const result=validator.validateLedgerTransitions({genesisLedgerBytes:genesisFile.bytes,currentLedgerBytes:ledgerBytes,
    transitionEntries:entries,expectedCells:cells,bindings:{manifestSha256:MANIFEST_SHA256,proofSha256,compatibilitySha256}});
  if(result.inProgress!==0)throw new Error('BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: unresolved IN_PROGRESS cell');
  for(const cell of cells){
    const state=ledger.cells[cell.key];
    const cellPrimary=path.join(roots.primary,'low',`cells/${cell.key}.json`),cellSecondary=path.join(roots.secondary,'low',`cells/${cell.key}.json`);
    if(state.state==='PENDING'){
      if(fs.existsSync(cellPrimary)||fs.existsSync(cellSecondary))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: cell exists before completion ${cell.key}`);
      continue;
    }
    if(state.state!=='COMPLETE')continue;
    if(state.relativePath!==`cells/${cell.key}.json`)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: unexpected path for ${cell.key}`);
    const rowBytes=durable.verifyDualCopy(path.join(roots.primary,'low',state.relativePath),path.join(roots.secondary,'low',state.relativePath));
    if(rowBytes.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: cell hash mismatch ${cell.key}`);
    const row=JSON.parse(rowBytes.bytes.toString('utf8'));
    if(row.cellKey!==cell.key||!search.same(row.cell,cell)||!search.same(row.identity,ledger.identity))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: completed cell identity mismatch ${cell.key}`);
  }
  return {...result,genesisRequired:false,compatibilitySha256};
}
function validateRuntimeIdentity({root=search.ROOT,home=process.env.HOME,manifestIdentity,compatibilitySha256,
  verifySourceAudit,verifyAmendment}={}){
  if(typeof verifySourceAudit!=='function'||typeof verifyAmendment!=='function')throw new Error('BLOCKED_STAGE3E_PREFLIGHT_DEPENDENCY: explicit pure verifier functions are required');
  const audit=verifySourceAudit({root,home}),amendmentResult=verifyAmendment({root,home});
  if(audit.sha256!==validator.SOURCE_AUDIT_SHA256||amendmentResult.resultSha256!==AMENDMENT_RESULT_SHA256||
     amendmentResult.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendmentResult.result?.effectivePassCount!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: frozen proof or amendment changed');
  const roots=searchRoots(root,home),manifestStored=readDualBytes(roots,'generation-2-manifest.json');
  if(manifestStored.sha256!==MANIFEST_SHA256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: initial search manifest changed');
  const manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  if(!same(manifest.identity,manifestIdentity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: creator manifest identity changed');
  const compatibilityStored=readDualBytes(roots,'verifier-compatibility-v1.json');
  if(compatibilityStored.sha256!==compatibilitySha256)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: sidecar bytes changed');
  const compatibility=JSON.parse(compatibilityStored.bytes.toString('utf8'));
  validateCompatibility({root,compatibility,manifestIdentity:manifest.identity,current:currentFiles(root)});
  return {pass:true,identity:manifest.identity,compatibilitySha256,auditSha256:audit.sha256,amendmentResultSha256:amendmentResult.resultSha256};
}
function acquireWriterLock({root=search.ROOT,phase='low',executionIdentity}={}){
  if(!executionIdentity)throw new Error('BLOCKED_STAGE3E_WRITER_LOCK_IDENTITY: missing execution identity');
  const common=search.gitCommonDir(root),lockRoot=path.join(common,'soraoto-agent-locks');
  fs.mkdirSync(lockRoot,{recursive:true,mode:0o700});
  const lockPath=path.join(lockRoot,`issue-7-stage3e-generation-2-${phase}.lock`);
  const payload=Buffer.from(JSON.stringify({schemaVersion:1,pid:process.pid,phase,executionIdentity,createdAt:new Date().toISOString()})+'\n');
  let fd;
  try{fd=fs.openSync(lockPath,'wx',0o600);fs.writeSync(fd,payload);fs.fsyncSync(fd);}
  catch(error){
    if(fd!==undefined)try{fs.closeSync(fd);}catch{}
    throw new Error(`BLOCKED_STAGE3E_WRITER_LOCKED: ${lockPath}${fs.existsSync(lockPath)?' (existing lock is never removed automatically)':''}`);
  }
  let released=false;
  return {path:lockPath,release(){
    if(released)return;
    try{fs.closeSync(fd);}catch{}
    if(!fs.existsSync(lockPath)||!fs.readFileSync(lockPath).equals(payload))throw new Error('BLOCKED_STAGE3E_WRITER_LOCK_IDENTITY: lock ownership changed');
    fs.unlinkSync(lockPath);released=true;
  }};
}
function preflight({root=search.ROOT,home=process.env.HOME,requireCompatibility=true,capabilityProbe=capture.preflightDiagnosticCapabilities,
  verifySourceAudit,verifyAmendment}={}){
  if(typeof verifySourceAudit!=='function'||typeof verifyAmendment!=='function')throw new Error('BLOCKED_STAGE3E_PREFLIGHT_DEPENDENCY: explicit pure verifier functions are required');
  const capability=capabilityProbe({root});
  search.assertGeneration1Abandoned(root);
  const audit=verifySourceAudit({root,home});
  const amendmentResult=verifyAmendment({root,home});
  if(amendmentResult.result?.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||amendmentResult.result?.effectivePassCount!==12||amendmentResult.result?.effectiveCellCount!==12)
    throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: MIDI41 amendment must pass 12/12');
  const roots=searchRoots(root,home);
  const manifestStored=readDualBytes(roots,'generation-2-manifest.json');
  if(manifestStored.sha256!==MANIFEST_SHA256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: initial search manifest changed');
  const manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  if(manifest.state!=='ACTIVE'||manifest.searchEpoch!=='search-v1'||manifest.identity?.searchEpoch!=='search-v1'||
     manifest.identity?.midi41AmendmentResultSha256!==AMENDMENT_RESULT_SHA256||
     manifest.identity?.referenceSetSha256!==REFERENCE_SHA256)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: search manifest binding mismatch');
  const current=currentFiles(root),compatibilityPath=path.join(roots.primary,'verifier-compatibility-v1.json');
  let compatibility=null,compatibilitySha256=null;
  if(fs.existsSync(compatibilityPath)||fs.existsSync(path.join(roots.secondary,'verifier-compatibility-v1.json'))){
    const compatibilityStored=readDualBytes(roots,'verifier-compatibility-v1.json');compatibility=JSON.parse(compatibilityStored.bytes.toString('utf8'));
    compatibilitySha256=compatibilityStored.sha256;
  validateCompatibility({root,compatibility,manifestIdentity:manifest.identity,current});
  }else if(requireCompatibility)throw new Error('BLOCKED_STAGE3E_SEARCH_VERIFIER_COMPATIBILITY: sidecar absent');
  const ledgerStored=readDualBytes(roots,'low/low-ledger.json');
  const ledgerSummary=validateSearchLedger({roots,manifestBytes:manifestStored.bytes,ledgerBytes:ledgerStored.bytes,compatibilitySha256});
  const extras=audit.inventoryValidation;
  return {decision:'STAGE3E_SEARCH_PREFLIGHT_READY',builds:0,renders:0,acousticRenders:0,evidenceWrites:0,
    capability,auditSha256:audit.sha256,amendmentResultSha256:amendmentResult.resultSha256,
    manifestSha256:manifestStored.sha256,ledgerSha256:ledgerStored.sha256,ledgerSummary,
    compatibilitySha256,compatibility,inventory:{frozenCount:extras.frozenCount,additionCount:extras.additionCount},
    roots,manifest,creatorIdentity:manifest.identity,currentVerifierIdentity:current};
}

module.exports={MANIFEST_SHA256,GENESIS_SHA256,PROOF_SHA256,AMENDMENT_RESULT_SHA256,REFERENCE_SHA256,COMPATIBILITY_RELATIVE,
  GENESIS_RELATIVE,JOURNAL_RELATIVE,ALLOWED_TRACKED_DIFFS,sha256,stable,same,searchRoots,currentFiles,
  validateCompatibility,readTransitionEntries,validateSearchLedger,validateRuntimeIdentity,acquireWriterLock,
  trackedDiff,assertTrackedWorktreeClean,runCompatibilityTests,buildCompatibilityRecord,preflight};
