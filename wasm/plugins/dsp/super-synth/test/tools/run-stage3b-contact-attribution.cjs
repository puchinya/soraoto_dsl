#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {assertRecoveryCell,assertRecoveryLedgerIdentity,recoveryCounts,RECOVERY_BASELINE_HEAD,
  RECOVERY_AUTHORIZED_CELLS,cellFilePath,DIAGNOSTIC_SIGNALS}=require('./run-stage3a-velocity-diagnostic.cjs');
const provenance=require('./stage3b-production-provenance.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const PRIVATE_ROOT=path.join(ROOT,'.agent-state/issues/7/stage3b');
const PROVENANCE_FILE=path.join(ROOT,'.agent-state/issues/7/stage3b/preflight-provenance.json');
const MASK0_AUTHORIZATION_FILE=path.join(PRIVATE_ROOT,'mask0-equivalence-authorization.json');
const STAGE3A_ROOT=path.join(ROOT,'.agent-state/issues/7/stage3a');
const STAGE3A_RECOVERY=path.join(STAGE3A_ROOT,'recovery');
const STAGE3A_LEDGER=path.join(STAGE3A_RECOVERY,'recovery-ledger.json');
const STAGE3A_FINAL=path.join(STAGE3A_ROOT,'velocity-diagnostic.json');
const STAGE3A_SUPPLEMENT=path.join(STAGE3A_ROOT,'supplemental-3-render-result.json');
const FIXTURE=path.join(ROOT,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
const PRESETS=path.join(ROOT,'wasm/plugins/dsp/super-synth/presets.json');
const PROFILE=path.join(ROOT,'wasm/shared/generated/super-synth_grand_profiles.h');
const PROD_WASM=path.join(ROOT,'build/wasm/plugins/dsp/super-synth/plugin.wasm');
const STAGE3A_WASM=path.join(ROOT,'build/wasm-stage3a/plugins/dsp/super-synth/plugin.wasm');
const STAGE3B_WASM_REL='plugins/dsp/super-synth/plugin.wasm';
const EXPECTED_HEAD='c1fd7f39b1c5d8353862169cadf7e187a7ed6eb6';
const CANDIDATE='stage2n-r3-candidate-01';
const EXPECTED={productionWasm:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  stage3aWasm:'59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3',
  config:'792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d',
  profile:'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66',
  presets:'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431',
  fixture:'5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7'};
const DYNAMIC_PITCHES=[33,36,39,42,45,48,51,54,57];
const TREBLE_PITCHES=[93,96,99];
const FAIL_PITCHES=[36,39,51,54];
const CONTROL_PITCHES=[33,42,45,48,57];
const VELOCITIES=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const TREBLE_VELOCITIES=[14,31,61,124];
const MIDI41_NORMALIZED=[0.25,0.55,0.90];
const MASKS=[1,2,3];
const CLOSE=1e-6;
const DERIVATIVE_WINDOW=[30,180];
const SUBSET=MASKS.flatMap(stage3bMask=>[
  ...DYNAMIC_PITCHES.flatMap(pitch=>VELOCITIES.map(velocity=>({kind:'dynamic',stage3bMask,pitch,velocity,velocityNormalized:velocity/127}))),
  ...TREBLE_PITCHES.flatMap(pitch=>TREBLE_VELOCITIES.map(velocity=>({kind:'treble',stage3bMask,pitch,velocity,velocityNormalized:velocity/127}))),
  ...MIDI41_NORMALIZED.map(velocityNormalized=>({kind:'midi41',stage3bMask,pitch:41,velocity:null,velocityNormalized}))
]);
const CELL_COUNT=SUBSET.length;
const SIGNAL_INDEX={bridge_b:0,board_drive_b:3,post_radiation_l:12};
const HAMMER_FIELDS=['effectiveHardness','initialHammerVelocity','contactDurationSamples','peakForce','maxCompression','postContactTransverseEnergy'];

function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function sha256Text(value){return crypto.createHash('sha256').update(value).digest('hex');}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});
  fs.renameSync(temporary,file);
}
function gitHead(root=ROOT){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function assertStage3BHeadLineage(root=ROOT,base=EXPECTED_HEAD){
  const current=gitHead(root),ancestor=provenance.rtkStatus(['git','merge-base','--is-ancestor',base,current],{cwd:root});
  if(ancestor.status!==0)throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: current HEAD ${current} is not descended from ${base}`);
  const protectedDiff=provenance.rtkStatus(['git','diff','--exit-code',base,current,'--',...provenance.PRODUCTION_PATHS],{cwd:root});
  if(protectedDiff.status!==0)throw new Error('BLOCKED_STAGE3B_PRODUCTION_PROVENANCE_UNRESOLVED: committed production inputs changed after preflight baseline');
  return current;
}
function cellKey(cell){
  const velocity=cell.velocity===null?`n${Math.round(cell.velocityNormalized*100)}`:`v${String(cell.velocity).padStart(3,'0')}`;
  return `mask-${cell.stage3bMask}:midi-${String(cell.pitch).padStart(3,'0')}:${velocity}`;
}
function cellPath(paths,cell){
  const velocity=cell.velocity===null?`normalized-${Math.round(cell.velocityNormalized*100)}`:`velocity-${String(cell.velocity).padStart(3,'0')}`;
  return path.join(paths.cells,`mask-${cell.stage3bMask}`,`midi-${String(cell.pitch).padStart(3,'0')}-${velocity}.json`);
}
function stage3bPaths(root=ROOT){
  const base=path.join(root,'.agent-state/issues/7/stage3b');
  return {base,ledger:path.join(base,'ledger.json'),cells:path.join(base,'cells'),aggregates:path.join(base,'aggregates'),final:path.join(base,'factorial-analysis.json')};
}
function expectedSubset(){
  if(CELL_COUNT!==477||SUBSET.some(row=>row.stage3bMask===0))throw new Error('Stage3B authorization must contain exactly 477 masks 1/2/3 identities');
  if(new Set(SUBSET.map(cellKey)).size!==CELL_COUNT)throw new Error('Stage3B authorization contains duplicate render identities');
  return SUBSET;
}

function loadStage3ABaseline(root=ROOT){
  const paths={ledger:STAGE3A_LEDGER,final:STAGE3A_FINAL,supplement:STAGE3A_SUPPLEMENT,cells:path.join(STAGE3A_RECOVERY,'cells'),pitches:path.join(STAGE3A_RECOVERY,'pitches')};
  for(const file of Object.values(paths))if(!fs.existsSync(file))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: missing Stage3A accepted evidence ${path.relative(root,file)}`);
  const ledger=readJson(paths.ledger),identity=ledger.identity;
  assertRecoveryLedgerIdentity(ledger,identity);
  if(ledger.baselineHead!==RECOVERY_BASELINE_HEAD||ledger.candidateId!==CANDIDATE||ledger.authorizedIdentityCount!==192
      ||JSON.stringify(recoveryCounts(ledger))!==JSON.stringify({PENDING:0,IN_PROGRESS:0,COMPLETE:192}))
    throw new Error('BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: Stage3A recovery ledger is not complete');
  const final=readJson(paths.final);
  if(sha256(paths.final)!==ledger.finalResultSha256||final.decision!=='STAGE3A_DIAGNOSTIC_COMPLETE'
      ||final.candidateId!==CANDIDATE||final.candidateDelta!==0||final.stage4Renders!==0
      ||final.productionWasmSha256!==EXPECTED.productionWasm||final.diagnosticWasmSha256!==EXPECTED.stage3aWasm
      ||final.configSha256!==EXPECTED.config)
    throw new Error('BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: Stage3A final result hash/identity mismatch');
  const stage3a=require('./run-stage3a-velocity-diagnostic.cjs');
  const baseline=new Map();
  for(const cell of RECOVERY_AUTHORIZED_CELLS){
    const file=cellFilePath({ledger:paths.ledger,cells:paths.cells},cell.pitch,cell.velocity),entry=ledger.cells[`${cell.pitch}:${cell.velocity}`];
    if(!entry||entry.state!=='COMPLETE'||!fs.existsSync(file)||entry.sha256!==sha256(file)
        ||entry.path!==path.relative(path.dirname(paths.ledger),file))
      throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: Stage3A cell hash/state mismatch ${cell.pitch}:${cell.velocity}`);
    baseline.set(`${cell.pitch}:${cell.velocity}`,stage3a.assertRecoveryCell(readJson(file),identity));
  }
  for(const pitch of [33,36,39,42,45,48,51,54,57,93,96,99]){
    const entry=ledger.pitchAggregates?.[String(pitch)];
    const file=path.join(paths.pitches,`midi-${String(pitch).padStart(3,'0')}.json`);
    if(!entry||!fs.existsSync(file)||entry.sha256!==sha256(file)||entry.cellCount!==16)
      throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: Stage3A pitch aggregate hash mismatch ${pitch}`);
  }
  const supplement=readJson(paths.supplement);
  if(sha256(paths.supplement)!==identity.supplementalResultSha256||supplement.decision!=='SUPPLEMENTAL_RENDERS_VALID'
      ||supplement.acceptedReplacementCount!==3||supplement.authorizedRenderCount!==3||supplement.mask!==3
      ||supplement.identity?.productionWasmSha256!==EXPECTED.productionWasm||supplement.identity?.diagnosticWasmSha256!==EXPECTED.stage3aWasm
      ||supplement.identity?.configSha256!==EXPECTED.config||supplement.identity?.candidateId!==CANDIDATE)
    throw new Error('BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: Stage3A supplemental MIDI41 identity mismatch');
  for(let i=0;i<MIDI41_NORMALIZED.length;i++){
    const row=supplement.rows?.[i],m=row?.metrics;
    if(row?.pitch!==41||row.velocityNormalized!==MIDI41_NORMALIZED[i]||!m||m.stage2mFactorMask!==3
        ||m.velocityDerivativeWindowMs?.[0]!==30||m.velocityDerivativeWindowMs?.[1]!==180
        ||m.finite!==true||m.outputGuardHits!==0||!(m.peakDbfs<0)
        ||!Number.isFinite(m.velocityDerivative)||HAMMER_FIELDS.some(key=>!Number.isFinite(m.stage2mHammer?.[key])))
      throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: invalid accepted Stage3A MIDI41 baseline ${i}`);
    for(const name of DIAGNOSTIC_SIGNALS){const signal=m.soundboardDiagnostics?.signals?.[name];
      if(!signal||!Number.isFinite(signal.rms)||!Number.isFinite(signal.peak))throw new Error(`Stage3A MIDI41 missing path signal ${name}`);}
    baseline.set(`41:${Math.round(row.velocityNormalized*100)}`,row);
  }
  return {baseline,ledger,final,supplement,paths,identity:{stage3aLedgerSha256:sha256(paths.ledger),stage3aFinalSha256:sha256(paths.final),
    stage3aSupplementSha256:sha256(paths.supplement),stage3aSourceRevision:final.sourceRevision}};
}

function assertDiagnosticExports(wasmFile){
  const exports=WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(wasmFile))).map(item=>item.name);
  for(const name of ['soraoto_supersynth_stage3b_set_variant_mask','soraoto_supersynth_stage3b_get_variant_mask',
    'soraoto_supersynth_stage2m_set_factor_mask','soraoto_supersynth_stage2m_get_factor_mask',
    'soraoto_supersynth_stage2m_hammer_diag_reset','soraoto_supersynth_stage2m_hammer_diag_value',
    'soraoto_supersynth_guard_hit_count','soraoto_supersynth_active_voice_count',
    'soraoto_supersynth_soundboard_diag_reset','soraoto_supersynth_soundboard_diag_sum_squares',
    'soraoto_supersynth_soundboard_diag_peak','soraoto_supersynth_soundboard_diag_frames'])
    if(!exports.includes(name))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: missing export ${name}`);
  return exports;
}
function assertProductionStage3BAbsent(wasmFile){
  const exports=WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(wasmFile))).map(item=>item.name);
  for(const name of ['soraoto_supersynth_stage3b_set_variant_mask','soraoto_supersynth_stage3b_get_variant_mask'])
    if(exports.includes(name))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: production build unexpectedly exports ${name}`);
  return exports;
}
function assertVariantMaskApi(root,buildRoot){
  const {PluginHarness}=require('../../../../../test/helpers/plugin-harness.cjs');
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=buildRoot;
  const harness=new PluginHarness(root,STAGE3B_WASM_REL,{sampleRate:48000,maxFrames:128});
  try{
    const e=harness.e;
    for(const mask of [0,1,2,3]){
      if((e.soraoto_supersynth_stage3b_set_variant_mask(mask)|0)!==0
          ||(e.soraoto_supersynth_stage3b_get_variant_mask()>>>0)!==mask)
        throw new Error(`Stage3B variant mask roundtrip failed for ${mask}`);
    }
    if((e.soraoto_supersynth_stage3b_set_variant_mask(4)|0)!==-1
        ||(e.soraoto_supersynth_stage3b_get_variant_mask()>>>0)!==3)
      throw new Error('Stage3B mask accepted higher bits or changed state after rejection');
    if((e.soraoto_supersynth_stage2m_set_factor_mask(3)|0)!==0
        ||(e.soraoto_supersynth_stage2m_get_factor_mask()>>>0)!==3)
      throw new Error('Stage3B build cannot hold the required Stage2M factor mask 3');
  }finally{
    harness.close();
    if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;
  }
  const source=fs.readFileSync(path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c'),'utf8');
  const setter=source.match(/int soraoto_supersynth_stage3b_set_variant_mask\(unsigned int mask\)\{([\s\S]*?)\n\}/)?.[1]||'';
  if(!/mask&~3u/.test(setter)||!/dsp_reset\(\)/.test(setter))throw new Error('Stage3B mask setter must reject higher bits and reset DSP state on changes');
}

function assertAuthoritativeProductionIdentity(root=ROOT){
  const required=[PROD_WASM,PRESETS,PROFILE,FIXTURE];
  for(const file of required)if(!fs.existsSync(file))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: missing ${path.relative(root,file)}`);
  const hashes={productionWasmSha256:sha256(PROD_WASM),configSha256:EXPECTED.config,presetsSha256:sha256(PRESETS),profileSha256:sha256(PROFILE),
    referenceFixtureSha256:sha256(FIXTURE)};
  if(hashes.productionWasmSha256!==EXPECTED.productionWasm||hashes.presetsSha256!==EXPECTED.presets
      ||hashes.profileSha256!==EXPECTED.profile||hashes.referenceFixtureSha256!==EXPECTED.fixture)
    throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: authoritative artifact hash mismatch ${JSON.stringify(hashes)}`);
  assertProductionStage3BAbsent(PROD_WASM);
  return {hashes,candidateId:CANDIDATE,productionSimd:true};
}

function assertStage3AEvidenceIdentity(root=ROOT){
  const baseline=loadStage3ABaseline(root);
  return {identity:baseline.identity,candidateId:CANDIDATE};
}

function assertStage3BDiagnosticBuildIdentity(root=ROOT){
  const buildRoot=process.env.SORAOTO_WASM_BUILD_DIR?path.resolve(process.env.SORAOTO_WASM_BUILD_DIR):path.join(root,'build/wasm-stage3b');
  const wasm=path.join(buildRoot,STAGE3B_WASM_REL),cache=path.join(buildRoot,'CMakeCache.txt');
  const required=[wasm,cache];
  for(const file of required)if(!fs.existsSync(file))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: missing ${path.relative(root,file)}`);
  const currentHead=assertStage3BHeadLineage(root);
  const authoritative=assertAuthoritativeProductionIdentity(root);
  const stage3a=assertStage3AEvidenceIdentity(root);
  const hashes={...authoritative.hashes,stage3aWasmSha256:sha256(STAGE3A_WASM),stage3bWasmSha256:sha256(wasm),
    configSha256:EXPECTED.config,
    pluginSourceSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c')),
    cmakeSourceSha256:sha256(path.join(root,'wasm/cmake/wasm_plugin.cmake')),
    captureEvaluatorSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs')),
    runnerSha256:sha256(__filename)};
  if(hashes.stage3aWasmSha256!==EXPECTED.stage3aWasm)
    throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: protected hash mismatch ${JSON.stringify(hashes)}`);
  const cmake=fs.readFileSync(cache,'utf8');
  for(const option of ['SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:BOOL=ON','SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:BOOL=ON','SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:BOOL=ON'])
    if(!cmake.includes(option))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: missing CMake option ${option}`);
  assertDiagnosticExports(wasm);
  assertVariantMaskApi(root,buildRoot);
  const subsetHash=sha256Text(JSON.stringify(expectedSubset()));
  return {buildRoot,wasm,hashes,subsetSha256:subsetHash,constraintSchemaSha256:sha256Text(JSON.stringify({stage2mMask:3,stage3bMasks:MASKS,
    requiredMetrics:['envelopeDbfs[5]','envelopeDbfs[3]','spectralCentroidHz','above2kPowerRatio','peakDbfs','finite','outputGuardHits',
      'velocityDerivative','stage2mHammer',...DIAGNOSTIC_SIGNALS]})),sourceRevision:EXPECTED_HEAD,candidateId:CANDIDATE,productionSimd:true,
    stage2mFactorMask:3,authorizedRenderCount:CELL_COUNT,sourceRevision:currentHead};
}

function assertBuildIdentity(root=ROOT){
  const authoritative=assertAuthoritativeProductionIdentity(root);
  const stage3a=assertStage3AEvidenceIdentity(root);
  const diagnostic=assertStage3BDiagnosticBuildIdentity(root);
  return {...diagnostic,hashes:{...authoritative.hashes,stage3aWasmSha256:diagnostic.hashes.stage3aWasmSha256,
    stage3bWasmSha256:diagnostic.hashes.stage3bWasmSha256,configSha256:EXPECTED.config,
    pluginSourceSha256:diagnostic.hashes.pluginSourceSha256,cmakeSourceSha256:diagnostic.hashes.cmakeSourceSha256,
    captureEvaluatorSha256:diagnostic.hashes.captureEvaluatorSha256,runnerSha256:diagnostic.hashes.runnerSha256},
    stage3aEvidence:stage3a.identity};
}

function loadProductionProvenance(root=ROOT,file=PROVENANCE_FILE){
  if(!fs.existsSync(file))throw new Error('BLOCKED_STAGE3B_PRODUCTION_PROVENANCE_UNRESOLVED: preflight provenance artifact is missing');
  const artifact=readJson(file),descriptor=provenance.descriptorWorkingTreeState(root);
  const currentHead=assertStage3BHeadLineage(root,artifact.preflightCheckedHead||EXPECTED_HEAD);
  const variants=[artifact.cleanStage2qMetadata,artifact.cleanStage3bBaselineMetadata,artifact.dirtyDescriptorSnapshotMetadata];
  const checkedClassification=provenance.classifyProvenance({embeddedDescriptorSha256:artifact.productionEmbeddedDescriptor?.sha256,
    embeddedInterfaceMatchesStage2q:artifact.productionEmbeddedInterface?.matchesStage2qInterface,variants,
    isolatedProductionBuildSha256:artifact.isolatedProductionBuild?.sha256,profileSha256:artifact.isolatedProductionBuild?.profileSha256,
    productionPathsUnchanged:artifact.committedProductionPathDiff?.unchanged,
    authoritativeWasmSha256:artifact.authoritativeProductionWasmSha256,dirtyDescriptorUnchanged:artifact.workingTreeDescriptorState?.unchanged});
  if(artifact.stage3bStartingCommit!==EXPECTED_HEAD||artifact.authoritativeProductionWasmSha256!==EXPECTED.productionWasm
      ||artifact.fixedIdentities?.presets!==EXPECTED.presets||artifact.fixedIdentities?.profile!==EXPECTED.profile
      ||artifact.fixedIdentities?.referenceFixture!==EXPECTED.fixture||artifact.fixedIdentities?.config!==EXPECTED.config
      ||artifact.workingTreeDescriptorState?.unchanged!==true
      ||JSON.stringify(artifact.workingTreeDescriptorState?.after)!==JSON.stringify(descriptor)
      ||artifact.committedProductionPathDiff?.unchanged!==true
      ||artifact.productionEmbeddedInterface?.matchesStage2qInterface!==true
      ||artifact.postBaselineProductionPathDiff?.unchanged!==true
      ||artifact.classificationEvidence?.matchingVariants?.length!==1
      ||checkedClassification.classification!==artifact.classification
      ||JSON.stringify(checkedClassification.matchingVariants)!==JSON.stringify(artifact.classificationEvidence?.matchingVariants)
      ||artifact.preflightResult?.decision!=='STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE'
      ||artifact.preflightResult?.checks?.selectionGateTests?.pass!==true
      ||!artifact.preflightReady||!['EXACT_REBUILD_PROVENANCE','SUFFICIENT_METADATA_PROVENANCE'].includes(artifact.classification))
    throw new Error('BLOCKED_STAGE3B_PRODUCTION_PROVENANCE_UNRESOLVED: provenance no longer matches current source/artifact state');
  return {...artifact,currentCheckedHead:currentHead};
}

function assertPreflightReady(root=ROOT,{provenanceFile=PROVENANCE_FILE}={}){
  const authoritative=assertAuthoritativeProductionIdentity(root),stage3a=assertStage3AEvidenceIdentity(root);
  const diagnostic=assertStage3BDiagnosticBuildIdentity(root),production=loadProductionProvenance(root,provenanceFile);
  const recorded=production.preflightResult?.checks?.stage3bDiagnosticBuild?.hashes;
  for(const key of ['stage3bWasmSha256','pluginSourceSha256','cmakeSourceSha256','captureEvaluatorSha256','runnerSha256'])
    if(!recorded||recorded[key]!==diagnostic.hashes[key])throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: preflight ${key} no longer matches`);
  return {authoritative,stage3a,diagnostic,production};
}

function assertMask0EquivalenceAuthorization(root=ROOT,{authorizationFile=root===ROOT?MASK0_AUTHORIZATION_FILE:path.join(root,'.agent-state/issues/7/stage3b/mask0-equivalence-authorization.json'),
  provenanceFile=path.join(root,'.agent-state/issues/7/stage3b/preflight-provenance.json'),
  preflightCheck=assertPreflightReady,identityProvider=assertBuildIdentity}={}){
  try{
    preflightCheck(root,{provenanceFile});
    const identity=identityProvider(root);
    if(!fs.existsSync(authorizationFile))throw new Error('authorization artifact is missing');
    if(!fs.existsSync(provenanceFile))throw new Error('preflight provenance artifact is missing');
    const authorization=readJson(authorizationFile);
    const expected={schemaVersion:1,decision:'STAGE3B_MASK0_EQUIVALENT',authorization:'AUTHORIZE_STAGE3B_477_RENDER_MATRIX',
      candidateId:identity.candidateId,authoritativeProductionWasmSha256:identity.hashes.productionWasmSha256,
      stage3bDiagnosticWasmSha256:identity.hashes.stage3bWasmSha256,preflightProvenanceSha256:sha256(provenanceFile),
      productionCandidateDelta:0,stage4Renders:0};
    for(const [key,value] of Object.entries(expected))if(authorization[key]!==value)
      throw new Error(`authorization field ${key} mismatch`);
    return {identity,authorization,preflightProvenanceSha256:expected.preflightProvenanceSha256};
  }catch(error){
    if(String(error?.message||error).startsWith('BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED'))throw error;
    throw new Error(`BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED: ${error.message||error}`);
  }
}

function gateCorrectionSelfTest(root=ROOT){
  const sample=[36,39,51,54].map((pitch,index)=>({pitch,spanByMask:{M0:{absoluteSpanErrorDb:[12.580882,12.069386,20.696187,9.249924][index]}}}));
  assert.equal(worstBaselineFailingPitch(sample),51);
  const alternate=sample.map(row=>({...row,spanByMask:{M0:{absoluteSpanErrorDb:row.pitch===39?25:1}}}));
  assert.equal(worstBaselineFailingPitch(alternate),39);
  const base={failingImprovements:[7,4,4,1],baselineWorstPitchImprovement:5.999,controlWorsening:[0,0,0,0,0],safe:true,
    midi96WorseningDb:3,midi41Guard:true,twoStringImprovementDb:2,threeStringImprovementDb:2};
  assert.equal(supportGates(base).baselineWorstPitchImprovesBy6,false);
  assert.equal(supportGates({...base,baselineWorstPitchImprovement:6}).baselineWorstPitchImprovesBy6,true);
  assert.equal(supportGates({...base,failingImprovements:[7,6,4,4],baselineWorstPitchImprovement:5.9}).threeOfFourImproveBy4,true);
  assert.equal(supportGates({...base,midi96WorseningDb:3.000001}).midi96v31FactorWorseningAtMost3,false);
  assert.equal(supportGates({...base,midi96WorseningDb:3}).midi96v31FactorWorseningAtMost3,true);
  const mid=[{velocityNormalized:.25,derivatives:{M0:.1,M1:.21,M2:.1,M3:.1}},
    {velocityNormalized:.55,derivatives:{M0:.3,M1:.3,M2:.3,M3:.3}},
    {velocityNormalized:.90,derivatives:{M0:.5,M1:.5,M2:.5,M3:.5}}];
  assert.equal(midi41FactorGuard(mid,[1,3]).pass,false);
  assert.equal(midi41FactorGuard(mid,[2,3]).pass,true);
  const safe=iGates=>Object.fromEntries(Object.keys(iGates).map(key=>[key,true]));
  assert.equal(selectDecision({iSafe:false,pSafe:true,iGates:safe(base),pGates:safe(base),meanAbsoluteInteractionDb:9,
    twoI:1,threeI:-1,twoP:1,threeP:1,iMeanImprovementDb:9,pMeanImprovementDb:1}),'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN');
  assert.equal(selectDecision({iSafe:true,pSafe:false,iGates:safe(base),pGates:safe(base),meanAbsoluteInteractionDb:9,
    twoI:1,threeI:1,twoP:1,threeP:1,iMeanImprovementDb:9,pMeanImprovementDb:1}),'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE');
  assert.equal(selectDecision({iSafe:false,pSafe:false,iGates:safe(base),pGates:safe(base),meanAbsoluteInteractionDb:0,
    twoI:1,threeI:1,twoP:1,threeP:1,iMeanImprovementDb:9,pMeanImprovementDb:1}),'BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY');
  const baseline=loadStage3ABaseline(root),reference=readReference(root),errors=FAIL_PITCHES.map(pitch=>{
    const levels=VELOCITIES.map(velocity=>stage3aRow(baseline.baseline,{kind:'dynamic',pitch,velocity}).metrics.envelopeDbfs[3]);
    const referenceLevels=VELOCITIES.map(velocity=>level(refFor(reference,pitch,velocity)));
    return {pitch,absoluteSpanErrorDb:Math.abs((max(levels)-Math.min(...levels))-(max(referenceLevels)-Math.min(...referenceLevels)))};
  });
  const maxRow=errors.sort((a,b)=>b.absoluteSpanErrorDb-a.absoluteSpanErrorDb||a.pitch-b.pitch)[0];
  if(maxRow.pitch!==51)throw new Error(`Stage3A actual M0 worst pitch is MIDI${maxRow.pitch}, expected MIDI51`);
  return {pass:true,realBaselineWorstPitch:maxRow.pitch,baselineErrors:errors};
}

function runPreflight({root=ROOT,progress=()=>{},provenanceFile=PROVENANCE_FILE}={}){
  assertStage3BHeadLineage(root);
  const checks={authoritativeProduction:null,stage3aEvidence:null,stage3bDiagnosticBuild:null,selectionGateTests:null};
  let provenanceResult=null,provenanceError=null;
  try{checks.authoritativeProduction=assertAuthoritativeProductionIdentity(root);}catch(error){checks.authoritativeProduction={pass:false,error:String(error.message||error)};}
  try{checks.stage3aEvidence=assertStage3AEvidenceIdentity(root);}catch(error){checks.stage3aEvidence={pass:false,error:String(error.message||error)};}
  try{checks.selectionGateTests=gateCorrectionSelfTest(root);}catch(error){checks.selectionGateTests={pass:false,error:String(error.message||error)};}
  try{checks.stage3bDiagnosticBuild=assertStage3BDiagnosticBuildIdentity(root);}catch(error){checks.stage3bDiagnosticBuild={pass:false,error:String(error.message||error)};}
  try{provenanceResult=provenance.runProvenanceReconciliation({root,outputFile:provenanceFile,
    diagnosticBuildCache:process.env.SORAOTO_WASM_BUILD_DIR?path.join(path.resolve(process.env.SORAOTO_WASM_BUILD_DIR),'CMakeCache.txt'):path.join(root,'build/wasm-stage3b/CMakeCache.txt'),
    knownIsolatedProductionSha256:'5267226ff61d6228e91c3203bbe8f6a634c509cf73412f5dd5c827d144099b23'});}
  catch(error){provenanceError=String(error.message||error);}
  const provenancePass=provenanceResult?.preflightReady===true;
  const identityPass=checks.authoritativeProduction?.hashes?.productionWasmSha256===EXPECTED.productionWasm
    &&Boolean(checks.stage3aEvidence?.identity)&&checks.stage3bDiagnosticBuild?.hashes?.stage3bWasmSha256;
  const gatePass=checks.selectionGateTests?.pass===true;
  let decision='STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE';
  if(!provenancePass)decision='BLOCKED_STAGE3B_PRODUCTION_PROVENANCE_UNRESOLVED';
  else if(!identityPass)decision='BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY';
  else if(!gatePass)decision='BLOCKED_STAGE3B_PREFLIGHT_GATE_IMPLEMENTATION';
  const result={schemaVersion:1,decision,stage3bStartingCommit:EXPECTED_HEAD,candidateId:CANDIDATE,
    acousticRenders:0,productionCandidateDelta:0,stage4Renders:0,stage3bAcousticLedgerCreated:false,
    authorizedFutureRenderIdentities:CELL_COUNT,masks:MASKS,checks,provenance:provenanceResult?{
      classification:provenanceResult.classification,preflightReady:provenanceResult.preflightReady,
      authoritativeProductionWasmSha256:provenanceResult.authoritativeProductionWasmSha256,
      embeddedDescriptor:provenanceResult.productionEmbeddedDescriptor,
      embeddedInterface:provenanceResult.productionEmbeddedInterface,
      variants:['cleanStage2qMetadata','cleanStage3bBaselineMetadata','dirtyDescriptorSnapshotMetadata'].map(key=>({
        name:provenanceResult[key]?.name,descriptorCborSha256:provenanceResult[key]?.descriptorCborSha256,
        descriptorCborBytes:provenanceResult[key]?.descriptorCborBytes,descriptorHeaderSha256:provenanceResult[key]?.descriptorHeaderSha256,
        runtimeMetadataFingerprintSha256:provenanceResult[key]?.runtimeMetadataFingerprintSha256,profileSha256:provenanceResult[key]?.profileSha256})),
      isolatedProductionBuild:provenanceResult.isolatedProductionBuild,workingTreeDescriptorState:provenanceResult.workingTreeDescriptorState,
      committedProductionPathDiff:provenanceResult.committedProductionPathDiff,toolchain:provenanceResult.toolchain}:null,
    provenanceError,completedAt:new Date().toISOString()};
  if(provenanceResult){provenanceResult.preflightResult={decision,checks,acousticRenders:0};provenance.writeJsonAtomic(provenanceFile,provenanceResult);}
  progress(JSON.stringify({decision,acousticRenders:0,builds:provenanceResult?1:0,authorizedFutureRenderIdentities:CELL_COUNT,
    provenance:provenanceResult?.classification||'UNRESOLVED'}));
  return result;
}

function identityDigest(identity){return sha256Text(JSON.stringify(identity));}
function makeLedger(identity){
  const cells=Object.fromEntries(expectedSubset().map(cell=>[cellKey(cell),{...cell,state:'PENDING'}]));
  return {schemaVersion:1,status:'PENDING',candidateId:CANDIDATE,authorizedRenderCount:CELL_COUNT,identity,identitySha256:identityDigest(identity),
    cells,aggregates:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),accounting:{newRenderCalls:0,stage4Renders:0,physicalCandidateDelta:0}};
}
function counts(ledger){const out={PENDING:0,IN_PROGRESS:0,COMPLETE:0};for(const row of Object.values(ledger.cells))out[row.state]=(out[row.state]||0)+1;return out;}
function assertLedger(ledger,identity){
  const expected=expectedSubset(),keys=expected.map(cellKey).sort();
  if(!ledger||ledger.schemaVersion!==1||ledger.candidateId!==CANDIDATE||ledger.authorizedRenderCount!==CELL_COUNT
      ||ledger.identitySha256!==identityDigest(identity)||JSON.stringify(ledger.identity)!==JSON.stringify(identity)
      ||JSON.stringify(Object.keys(ledger.cells||{}).sort())!==JSON.stringify(keys))
    throw new Error('BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: ledger provenance/authorization mismatch');
  for(const cell of expected){const row=ledger.cells[cellKey(cell)];
    if(row.pitch!==cell.pitch||row.velocity!==cell.velocity||row.velocityNormalized!==cell.velocityNormalized||row.stage3bMask!==cell.stage3bMask
        ||!['PENDING','IN_PROGRESS','COMPLETE'].includes(row.state))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: malformed ledger row ${cellKey(cell)}`);
  }
  return ledger;
}

function validateCell(row,cell,identity){
  if(!row||row.schemaVersion!==1||cellKey(row)!==cellKey(cell)||row.candidateId!==CANDIDATE
      ||row.productionWasmSha256!==identity.hashes.productionWasmSha256||row.stage3aWasmSha256!==identity.hashes.stage3aWasmSha256
      ||row.stage3bWasmSha256!==identity.hashes.stage3bWasmSha256||row.configSha256!==identity.hashes.configSha256
      ||row.profileSha256!==identity.hashes.profileSha256||row.presetsSha256!==identity.hashes.presetsSha256
      ||row.referenceFixtureSha256!==identity.hashes.referenceFixtureSha256||row.stage2mFactorMask!==3)
    throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: cell provenance/identity mismatch ${cellKey(cell)}`);
  const m=row.metrics;
  if(!m||m.stage2mFactorMask!==3||m.stage3bVariantMask!==cell.stage3bMask||!Array.isArray(m.envelopeDbfs)||m.envelopeDbfs.length!==5
      ||m.envelopeDbfs.some(value=>!Number.isFinite(value))||!Number.isFinite(m.spectralCentroidHz)||!Number.isFinite(m.above2kPowerRatio)
      ||!Number.isFinite(m.peakDbfs)||!Number.isFinite(m.fullRenderPeakDbfs)||typeof m.finite!=='boolean'
      ||!Number.isFinite(m.outputGuardHits)||!Number.isFinite(m.velocityDerivative)
      ||JSON.stringify(m.velocityDerivativeWindowMs)!==JSON.stringify(DERIVATIVE_WINDOW)
      ||HAMMER_FIELDS.some(key=>!Number.isFinite(m.stage2mHammer?.[key])))
    throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: missing required metric ${cellKey(cell)}`);
  for(const name of DIAGNOSTIC_SIGNALS){const signal=m.soundboardDiagnostics?.signals?.[name];
    if(!signal||!Number.isFinite(signal.rms)||!Number.isFinite(signal.peak))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: missing ${name}`);}
  row.safety={pass:m.finite===true&&m.outputGuardHits===0&&m.peakDbfs<0&&m.fullRenderPeakDbfs<0,
    finite:m.finite,guardHits:m.outputGuardHits,peakDbfs:m.peakDbfs,fullRenderPeakDbfs:m.fullRenderPeakDbfs};
  return row;
}

function loadCell(paths,ledger,cell,identity){
  const key=cellKey(cell),entry=ledger.cells[key];
  if(entry.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: cell is not COMPLETE ${key}`);
  const file=cellPath(paths,cell);
  if(!fs.existsSync(file)||entry.path!==path.relative(path.dirname(paths.ledger),file)||entry.sha256!==sha256(file))
    throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: COMPLETE cell missing/hash mismatch ${key}`);
  return validateCell(readJson(file),cell,identity);
}

function inspectState(paths,identity){
  if(!fs.existsSync(paths.ledger))return {ledger:makeLedger(identity),created:false,counts:{PENDING:CELL_COUNT,IN_PROGRESS:0,COMPLETE:0}};
  let ledger;try{ledger=readJson(paths.ledger);}catch(error){throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: invalid ledger JSON: ${error.message}`);}
  assertLedger(ledger,identity);const stateCounts=counts(ledger);
  if(stateCounts.IN_PROGRESS)throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: ambiguous IN_PROGRESS cells=${stateCounts.IN_PROGRESS}`);
  for(const cell of expectedSubset())if(ledger.cells[cellKey(cell)].state==='COMPLETE')loadCell(paths,ledger,cell,identity);
  for(const [key,item] of Object.entries(ledger.aggregates||{})){
    const file=path.join(paths.aggregates,`${key.replaceAll(':','-')}.json`);
    if(!fs.existsSync(file)||item.sha256!==sha256(file)||item.path!==path.relative(path.dirname(paths.ledger),file))
      throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: aggregate hash mismatch ${key}`);
  }
  return {ledger,created:true,counts:stateCounts};
}

function readReference(root=ROOT){
  const fixture=readJson(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'));
  const map=new Map();
  for(const row of fixture.directCells||[])map.set(`${row.pitch}:${row.velocity}`,row.metrics||row);
  return map;
}
function level(metrics){return metrics.envelopeDbfs[3];}
function refFor(refMap,pitch,velocity){const r=refMap.get(`${pitch}:${velocity}`);if(!r||!Number.isFinite(r.envelopeDbfs?.[3]))throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: reference layer missing ${pitch}:${velocity}`);return r;}
function stage3aRow(baseline,cell){
  if(cell.kind==='midi41')return baseline.get(`41:${Math.round(cell.velocityNormalized*100)}`);
  return baseline.get(`${cell.pitch}:${cell.velocity}`);
}
function metricScalar(row,name){
  const m=row.metrics;
  if(name==='level80_200Dbfs')return level(m);
  if(name==='contactDurationSamples')return m.stage2mHammer.contactDurationSamples;
  if(name==='peakForce')return m.stage2mHammer.peakForce;
  if(name==='postContactTransverseEnergy')return m.stage2mHammer.postContactTransverseEnergy;
  if(name==='bridgeBRms')return m.soundboardDiagnostics.signals.bridge_b.rms;
  if(name==='boardDriveBRms')return m.soundboardDiagnostics.signals.board_drive_b.rms;
  if(name==='postRadiationLRms')return m.soundboardDiagnostics.signals.post_radiation_l.rms;
  if(name==='velocityDerivative')return m.velocityDerivative;
  if(name==='spectralCentroidHz')return m.spectralCentroidHz;
  if(name==='above2kPowerRatio')return m.above2kPowerRatio;
  throw new Error(`unknown Stage3B metric ${name}`);
}
function factorial(m0,m1,m2,m3){return {M0:m0,M1:m1,M2:m2,M3:m3,
  I_main:((m1-m0)+(m3-m2))/2,P_main:((m2-m0)+(m3-m1))/2,interaction:m3-m2-m1+m0};}
function normalizeActiveImpedances(raw,count){
  if(!Array.isArray(raw)||!Number.isInteger(count)||count<1||count>3||raw.length<3||raw.slice(0,count).some(x=>!Number.isFinite(x)||x<=0))
    throw new Error('active impedance normalization requires 1..3 positive finite lanes');
  const sum=raw.slice(0,count).reduce((a,b)=>a+b,0),out=[0,0,0,0];
  for(let i=0;i<count;i++)out[i]=raw[i]/sum;
  return {effective:out,activeCount:count,activeSum:out.slice(0,count).reduce((a,b)=>a+b,0),rawSum:sum};
}
function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:NaN;}
function max(values){return Math.max(...values);}
function median(values){const xs=[...values].sort((a,b)=>a-b);return xs.length%2?xs[(xs.length-1)/2]:(xs[xs.length/2-1]+xs[xs.length/2])/2;}
function worstBaselineFailingPitch(spanRows){
  const rows=spanRows.filter(row=>FAIL_PITCHES.includes(row.pitch));
  if(rows.length!==FAIL_PITCHES.length)throw new Error('baseline worst-pitch selection requires all four failing pitches');
  return [...rows].sort((a,b)=>b.spanByMask.M0.absoluteSpanErrorDb-a.spanByMask.M0.absoluteSpanErrorDb||a.pitch-b.pitch)[0].pitch;
}
function supportGates({failingImprovements,baselineWorstPitchImprovement,controlWorsening,safe,midi96WorseningDb,midi41Guard,
  twoStringImprovementDb,threeStringImprovementDb}){
  return {threeOfFourImproveBy4:failingImprovements.filter(value=>value>=4).length>=3,
    baselineWorstPitchImprovesBy6:baselineWorstPitchImprovement>=6,
    controlsDoNotWorsen3:controlWorsening.every(value=>value<=3),safe,
    midi96v31FactorWorseningAtMost3:midi96WorseningDb<=3,midi41DerivativeGuard:midi41Guard,
    noTwoThreeDirectionReversal:twoStringImprovementDb*threeStringImprovementDb>=0};
}
function midi41FactorGuard(midi41Rows,masks){
  const byVelocity=new Map(midi41Rows.map(row=>[row.velocityNormalized,row.derivatives]));
  const soft=byVelocity.get(0.25),mid=byVelocity.get(0.55),hard=byVelocity.get(0.90);
  if(!soft||!mid||!hard)throw new Error('MIDI41 factor guard requires soft/mid/hard rows');
  const rows=[];
  for(const mask of masks){
    const deltaByVelocity={soft:Math.abs(soft[`M${mask}`]-soft.M0),mid:Math.abs(mid[`M${mask}`]-mid.M0),hard:Math.abs(hard[`M${mask}`]-hard.M0)};
    rows.push({mask,hardAboveMid:hard[`M${mask}`]>mid[`M${mask}`],deltaByVelocity,
      withinPointOne:Object.values(deltaByVelocity).every(value=>value<=0.10)});
  }
  return {pass:rows.every(row=>row.hardAboveMid&&row.withinPointOne),rows};
}
function factorSafety(rows,masks){
  const relevant=rows.filter(row=>masks.includes(row.stage3bMask));
  const failed=relevant.filter(row=>!(row.metrics?.finite===true&&row.metrics?.outputGuardHits===0
    &&row.metrics?.peakDbfs<0&&row.metrics?.fullRenderPeakDbfs<0));
  return {pass:failed.length===0,checkedCells:relevant.length,failedCells:failed.map(row=>cellKey(row))};
}
function selectDecision({iSafe,pSafe,iGates,pGates,meanAbsoluteInteractionDb,twoI,threeI,twoP,threeP,
  iMeanImprovementDb,pMeanImprovementDb}){
  if(!iSafe&&!pSafe)return 'BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY';
  const iEligible=iSafe&&Object.values(iGates).every(Boolean),pEligible=pSafe&&Object.values(pGates).every(Boolean);
  if(iSafe&&pSafe&&(meanAbsoluteInteractionDb>=2||twoI*threeI<0||twoP*threeP<0))return 'STAGE3B_CONTACT_PHASE_INTERACTION';
  if(iSafe&&!pSafe)return iEligible?'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE':'BLOCKED_STAGE3B_CONTACT_UNISON_HYPOTHESIS';
  if(pSafe&&!iSafe)return pEligible?'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN':'BLOCKED_STAGE3B_CONTACT_UNISON_HYPOTHESIS';
  if(iEligible&&!pEligible)return 'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE';
  if(pEligible&&!iEligible)return 'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN';
  if(iEligible&&pEligible){
    const difference=iMeanImprovementDb-pMeanImprovementDb;
    if(difference>=2)return 'STAGE3B_SELECT_BUNDLE_IMPEDANCE_ARCHITECTURE';
    if(difference<=-2)return 'STAGE3B_PHASE_GEOMETRY_REQUIRES_DESIGN';
    return 'STAGE3B_CONTACT_PHASE_INTERACTION';
  }
  return 'BLOCKED_STAGE3B_CONTACT_UNISON_HYPOTHESIS';
}

function makeAggregate(paths,ledger,identity,mask,pitch,rows){
  const expected=expectedSubset().filter(cell=>cell.stage3bMask===mask&&cell.pitch===pitch);
  if(rows.length!==expected.length||rows.some((row,i)=>cellKey(row)!==cellKey(expected[i])))throw new Error(`Stage3B aggregate coverage mismatch ${mask}:${pitch}`);
  const key=`${mask}:${pitch}`,file=path.join(paths.aggregates,`${key.replaceAll(':','-')}.json`);
  const aggregate={schemaVersion:1,stage3bMask:mask,pitch,candidateId:CANDIDATE,identitySha256:identityDigest(identity),rows};
  writeJsonAtomic(file,aggregate);ledger.aggregates[key]={path:path.relative(path.dirname(paths.ledger),file),sha256:sha256(file),cellCount:rows.length};
}

function calculateAnalysis({root,baseline,newRows,identity,ledger}){
  const reference=readReference(root),rowsByKey=new Map(newRows.map(row=>[cellKey(row),row]));
  const byIdentity=new Map();
  for(const cell of expectedSubset()){
    const row=rowsByKey.get(cellKey(cell));if(!row)throw new Error(`missing Stage3B row ${cellKey(cell)}`);
    byIdentity.set(`${cell.stage3bMask}:${cell.pitch}:${cell.velocity===null?Math.round(cell.velocityNormalized*100):cell.velocity}`,row);
  }
  const directLevel=(mask,pitch,velocity)=>mask===0?stage3aRow(baseline,{pitch,velocity}).metrics.envelopeDbfs[3]
    :byIdentity.get(`${mask}:${pitch}:${velocity}`).metrics.envelopeDbfs[3];
  const scalarRow=(mask,pitch,velocity,normalized,name)=>{
    const row=mask===0?stage3aRow(baseline,{kind:normalized===null?'dynamic':'midi41',pitch,velocity,velocityNormalized:normalized})
      :byIdentity.get(`${mask}:${pitch}:${velocity===null?Math.round(normalized*100):velocity}`);
    if(!row)throw new Error(`missing Stage3B scalar ${mask}:${pitch}:${velocity??normalized}:${name}`);
    return metricScalar(row,name);
  };
  const allPitches=[...DYNAMIC_PITCHES,...TREBLE_PITCHES];
  const spans=[];
  for(const pitch of allPitches){
    const velocityList=DYNAMIC_PITCHES.includes(pitch)?VELOCITIES:TREBLE_VELOCITIES;
    const refLevels=velocityList.map(velocity=>level(refFor(reference,pitch,velocity)));
    const refSpan=max(refLevels)-Math.min(...refLevels);
    const spanByMask={};
    for(const mask of [0,1,2,3]){
      const levels=velocityList.map(velocity=>directLevel(mask,pitch,velocity));
      const synthSpan=max(levels)-Math.min(...levels),spanError=Math.abs(synthSpan-refSpan);
      spanByMask[`M${mask}`]={synthSpanDb:synthSpan,referenceSpanDb:refSpan,absoluteSpanErrorDb:spanError,
        signedSpanDifferenceDb:synthSpan-refSpan};
    }
    spans.push({pitch,stringCount:pitch<36?1:(pitch<48?2:3),group:FAIL_PITCHES.includes(pitch)?'failure':CONTROL_PITCHES.includes(pitch)?'control':
      TREBLE_PITCHES.includes(pitch)?'treble':'boundary-control',spanByMask,
      factorial:factorial(spanByMask.M0.absoluteSpanErrorDb,spanByMask.M1.absoluteSpanErrorDb,
        spanByMask.M2.absoluteSpanErrorDb,spanByMask.M3.absoluteSpanErrorDb)});
  }
  const treble=[];
  for(const pitch of TREBLE_PITCHES)for(const velocity of TREBLE_VELOCITIES){
    const ref=level(refFor(reference,pitch,velocity)),errs={};
    for(const mask of [0,1,2,3]){
      const rendered=directLevel(mask,pitch,velocity);errs[`M${mask}`]={renderDbfs:rendered,referenceDbfs:ref,
        signedDirectLevelErrorDb:rendered-ref,absoluteDirectLevelErrorDb:Math.abs(rendered-ref)};
    }
    treble.push({pitch,velocity,errors:errs,factorial:factorial(errs.M0.absoluteDirectLevelErrorDb,errs.M1.absoluteDirectLevelErrorDb,
      errs.M2.absoluteDirectLevelErrorDb,errs.M3.absoluteDirectLevelErrorDb)});
  }
  const midi41=[];
  for(const normalized of MIDI41_NORMALIZED){
    const derivatives={};for(const mask of [0,1,2,3])derivatives[`M${mask}`]=scalarRow(mask,41,null,normalized,'velocityDerivative');
    midi41.push({pitch:41,velocityNormalized:normalized,derivatives,factorial:factorial(derivatives.M0,derivatives.M1,derivatives.M2,derivatives.M3)});
  }
  const scalarMetrics=['contactDurationSamples','peakForce','postContactTransverseEnergy','bridgeBRms','boardDriveBRms','postRadiationLRms',
    'spectralCentroidHz','above2kPowerRatio'];
  const pathFactorial={};
  for(const name of scalarMetrics){
    const values=[];
    for(const cell of SUBSET){
      const norm=cell.velocity===null?cell.velocityNormalized:null;
      const row={};for(const mask of [0,1,2,3])row[`M${mask}`]=scalarRow(mask,cell.pitch,cell.velocity,norm,name);
      values.push({kind:cell.kind,pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:norm,
        factorial:factorial(row.M0,row.M1,row.M2,row.M3)});
    }
    pathFactorial[name]={cells:values,pooled:{I_main:mean(values.map(x=>x.factorial.I_main)),P_main:mean(values.map(x=>x.factorial.P_main)),
      interaction:mean(values.map(x=>x.factorial.interaction)),meanAbsoluteInteraction:mean(values.map(x=>Math.abs(x.factorial.interaction)))}};
  }
  const failRows=spans.filter(row=>FAIL_PITCHES.includes(row.pitch));
  const controlRows=spans.filter(row=>CONTROL_PITCHES.includes(row.pitch));
  const iReductions=failRows.map(row=>({pitch:row.pitch,improvementDb:-row.factorial.I_main,
    beforeErrorDb:row.spanByMask.M0.absoluteSpanErrorDb,afterIErrorDb:mean([row.spanByMask.M1.absoluteSpanErrorDb,row.spanByMask.M3.absoluteSpanErrorDb])}));
  const pReductions=failRows.map(row=>({pitch:row.pitch,improvementDb:-row.factorial.P_main,
    beforeErrorDb:row.spanByMask.M0.absoluteSpanErrorDb,afterPErrorDb:mean([row.spanByMask.M2.absoluteSpanErrorDb,row.spanByMask.M3.absoluteSpanErrorDb])}));
  const twoI=mean(iReductions.filter(row=>row.pitch===36||row.pitch===39).map(row=>row.improvementDb));
  const threeI=mean(iReductions.filter(row=>row.pitch===51||row.pitch===54).map(row=>row.improvementDb));
  const twoP=mean(pReductions.filter(row=>row.pitch===36||row.pitch===39).map(row=>row.improvementDb));
  const threeP=mean(pReductions.filter(row=>row.pitch===51||row.pitch===54).map(row=>row.improvementDb));
  const iControls=controlRows.map(row=>({pitch:row.pitch,worseningDb:mean([row.spanByMask.M1.absoluteSpanErrorDb,row.spanByMask.M3.absoluteSpanErrorDb])
    -row.spanByMask.M0.absoluteSpanErrorDb}));
  const pControls=controlRows.map(row=>({pitch:row.pitch,worseningDb:mean([row.spanByMask.M2.absoluteSpanErrorDb,row.spanByMask.M3.absoluteSpanErrorDb])
    -row.spanByMask.M0.absoluteSpanErrorDb}));
  const midi96v31={};for(const mask of [0,1,2,3]){
    const rendered=directLevel(mask,96,31),ref=level(refFor(reference,96,31));
    midi96v31[`M${mask}`]={absoluteDirectLevelErrorDb:Math.abs(rendered-ref),signedDirectLevelErrorDb:rendered-ref};
  }
  const baselineWorstPitch=worstBaselineFailingPitch(spans);
  if(baselineWorstPitch!==51)throw new Error(`Stage3A baseline worst failing pitch changed: expected MIDI51, found MIDI${baselineWorstPitch}`);
  const iWorstPitchImprovement=iReductions.find(row=>row.pitch===baselineWorstPitch)?.improvementDb;
  const pWorstPitchImprovement=pReductions.find(row=>row.pitch===baselineWorstPitch)?.improvementDb;
  const midi96Factorial=factorial(midi96v31.M0.absoluteDirectLevelErrorDb,midi96v31.M1.absoluteDirectLevelErrorDb,
    midi96v31.M2.absoluteDirectLevelErrorDb,midi96v31.M3.absoluteDirectLevelErrorDb);
  const midi41IGuard=midi41FactorGuard(midi41,[1,3]),midi41PGuard=midi41FactorGuard(midi41,[2,3]);
  const iSafety=factorSafety(newRows,[1,3]),pSafety=factorSafety(newRows,[2,3]);
  const overallSafety=iSafety.pass&&pSafety.pass;
  const interactionAbs=mean(failRows.map(row=>Math.abs(row.factorial.interaction)));
  const iGates=supportGates({failingImprovements:iReductions.map(row=>row.improvementDb),
    baselineWorstPitchImprovement:iWorstPitchImprovement,controlWorsening:iControls.map(row=>row.worseningDb),safe:iSafety.pass,
    midi96WorseningDb:midi96Factorial.I_main,midi41Guard:midi41IGuard.pass,
    twoStringImprovementDb:twoI,threeStringImprovementDb:threeI});
  const pGates=supportGates({failingImprovements:pReductions.map(row=>row.improvementDb),
    baselineWorstPitchImprovement:pWorstPitchImprovement,controlWorsening:pControls.map(row=>row.worseningDb),safe:pSafety.pass,
    midi96WorseningDb:midi96Factorial.P_main,midi41Guard:midi41PGuard.pass,
    twoStringImprovementDb:twoP,threeStringImprovementDb:threeP});
  const iMeanImprovementDb=mean(iReductions.map(row=>row.improvementDb)),pMeanImprovementDb=mean(pReductions.map(row=>row.improvementDb));
  const decision=selectDecision({iSafe:iSafety.pass,pSafe:pSafety.pass,iGates,pGates,meanAbsoluteInteractionDb:interactionAbs,
    twoI,threeI,twoP,threeP,iMeanImprovementDb,pMeanImprovementDb});
  return {schemaVersion:1,decision,sourceRevision:identity.sourceRevision,candidateId:CANDIDATE,identity,
    accounting:{authorizedNewRenders:CELL_COUNT,completedNewRenders:newRows.length,baselineMask0Renders:0,
      stage3aHistoricalTotalCalls:390,totalStage3aAndStage3bCalls:390+newRows.length,physicalCandidateDelta:0,stage4Renders:0,
    stage2lBudget:'1/12',stage2nBudget:'1/1'},safety:{allPass:overallSafety,i:iSafety,p:pSafety,failedCells:newRows.filter(row=>!row.safety?.pass).map(row=>cellKey(row)),
      finiteCount:newRows.filter(row=>row.metrics.finite).length,guardHitTotal:newRows.reduce((n,row)=>n+row.metrics.outputGuardHits,0),
      worstPeakDbfs:Math.max(...newRows.map(row=>row.metrics.fullRenderPeakDbfs))},
    spanTables:spans,trebleGuardrail:treble,midi41Brightness:midi41,scalarFactorial:pathFactorial,
    subgroup:{twoString:{pitches:[36,39],I_meanImprovementDb:twoI,P_meanImprovementDb:twoP},
      threeString:{pitches:[51,54],I_meanImprovementDb:threeI,P_meanImprovementDb:threeP},pooledFailingPitches:{I_meanImprovementDb:mean(iReductions.map(row=>row.improvementDb)),
        P_meanImprovementDb:mean(pReductions.map(row=>row.improvementDb)),meanAbsoluteInteractionDb:interactionAbs},
      controls:{impedance:iControls,phase:pControls}},
    guardrails:{i:iGates,p:pGates,iPitchReductions:iReductions,pPitchReductions:pReductions,
      baselineWorstFailingPitch:baselineWorstPitch,iWorstPitchImprovementDb:iWorstPitchImprovement,pWorstPitchImprovementDb:pWorstPitchImprovement,
      midi96Velocity31:{...midi96v31,factorial:midi96Factorial},midi41I:midi41IGuard,midi41P:midi41PGuard,
      iMeanImprovementDb,pMeanImprovementDb,meanAbsoluteFailingInteractionDb:interactionAbs},
    diagnosticRows:newRows,stage3aEvidenceSha256:{ledger:sha256(STAGE3A_LEDGER),final:sha256(STAGE3A_FINAL),supplement:sha256(STAGE3A_SUPPLEMENT)}};
}

function validateAggregateFiles(paths,ledger,identity){
  const required=[];
  for(const mask of MASKS){for(const pitch of [...DYNAMIC_PITCHES,...TREBLE_PITCHES,41])required.push(`${mask}:${pitch}`);}
  for(const key of required){const item=ledger.aggregates?.[key],file=path.join(paths.aggregates,`${key.replaceAll(':','-')}.json`);
    if(!item||!fs.existsSync(file)||item.sha256!==sha256(file)||item.path!==path.relative(path.dirname(paths.ledger),file))
      throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: missing/corrupt per-mask pitch aggregate ${key}`);
    const data=readJson(file),expected=SUBSET.filter(cell=>cell.stage3bMask===Number(key.split(':')[0])&&cell.pitch===Number(key.split(':')[1]));
    if(data.stage3bMask!==Number(key.split(':')[0])||data.pitch!==Number(key.split(':')[1])||data.identitySha256!==identityDigest(identity)
        ||data.rows?.length!==expected.length)throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: malformed per-mask pitch aggregate ${key}`);
  }
}

function finalize({root=ROOT,paths=stage3bPaths(root),identityOverride=null}={}){
  const identity=identityOverride||assertMask0EquivalenceAuthorization(root).identity;
  const state=inspectState(paths,identity),ledger=state.ledger;
  if(state.counts.PENDING!==0||state.counts.IN_PROGRESS!==0||state.counts.COMPLETE!==CELL_COUNT)
    throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: finalization requires 477 COMPLETE cells, got ${JSON.stringify(state.counts)}`);
  validateAggregateFiles(paths,ledger,identity);
  const rows=expectedSubset().map(cell=>loadCell(paths,ledger,cell,identity));
  const base=loadStage3ABaseline(root);
  const result=calculateAnalysis({root,baseline:base.baseline,newRows:rows,identity,ledger});
  result.accounting.ledgerSha256=sha256(paths.ledger);
  writeJsonAtomic(paths.final,result);
  ledger.status='COMPLETE';ledger.finalizedAt=new Date().toISOString();ledger.finalResultSha256=sha256(paths.final);ledger.updatedAt=new Date().toISOString();
  writeJsonAtomic(paths.ledger,ledger);
  result.ledgerSha256=sha256(paths.ledger);result.resultSha256=sha256(paths.final);
  return {decision:result.decision,renderCalls:0,cellCount:rows.length,ledgerSha256:result.ledgerSha256,
    resultSha256:result.resultSha256,resultPath:path.relative(root,paths.final),safety:result.safety,subgroup:result.subgroup,guardrails:result.guardrails};
}

function run({root=ROOT,mode='dry-run',progress=()=>{},renderFn=null,identityOverride=null,failurePoint=null}={}){
  expectedSubset();
  if(mode==='preflight')return runPreflight({root,progress});
  if(!['dry-run','execute','finalize'].includes(mode))throw new Error(`explicit mode required: --dry-run, --execute, or --finalize`);
  let identity;
  if(identityOverride)identity=identityOverride;
  else if(mode==='dry-run'){
    assertPreflightReady(root);
    identity=assertBuildIdentity(root);
  }else identity=assertMask0EquivalenceAuthorization(root).identity;
  const paths=stage3bPaths(root),state=inspectState(paths,identity),ledger=state.ledger;
  if(mode==='dry-run'){
    return {decision:'STAGE3B_DRY_RUN',builds:0,renders:0,acousticRenders:0,authorizedNewRenders:CELL_COUNT,
      masks:MASKS,mask0Renders:0,counts:state.counts,identity};
  }
  if(mode==='finalize')return identityOverride?finalize({root,paths,identityOverride}):finalize({root,paths});
  if(!state.created)writeJsonAtomic(paths.ledger,ledger);
  const priorBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  const {render}=renderFn?{}:require('./capture-supersynth-matrix.cjs');
  const capture=renderFn||((cell)=>{
    process.env.SORAOTO_WASM_BUILD_DIR=identity.buildRoot;
    return render(cell.pitch,cell.velocity===null?cell.velocityNormalized*127:cell.velocity,{},
      {stage2mFactorMask:3,stage3bVariantMask:cell.stage3bMask,includeSoundboardDiagnostics:true,
        includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180});
  });
  let renderCalls=0;
  try{
    for(const cell of expectedSubset()){
      const key=cellKey(cell),entry=ledger.cells[key];
      if(entry.state==='COMPLETE')continue;
      if(entry.state!=='PENDING')throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_EVIDENCE: ${key} is ${entry.state}`);
      if(!identityOverride){const current=assertBuildIdentity(root);if(JSON.stringify(current)!==JSON.stringify(identity))
        throw new Error(`BLOCKED_STAGE3B_DIAGNOSTIC_BUILD_IDENTITY: changed before render ${key}`);}
      entry.state='IN_PROGRESS';entry.startedAt=new Date().toISOString();ledger.status='IN_PROGRESS';ledger.updatedAt=new Date().toISOString();
      writeJsonAtomic(paths.ledger,ledger);failurePoint?.('after-in-progress',cell);
      const metrics=capture(cell);renderCalls++;
      const row=validateCell({schemaVersion:1,candidateId:CANDIDATE,stage3bMask:cell.stage3bMask,stage2mFactorMask:3,pitch:cell.pitch,
        velocity:cell.velocity,velocityNormalized:cell.velocityNormalized,productionWasmSha256:identity.hashes.productionWasmSha256,
        stage3aWasmSha256:identity.hashes.stage3aWasmSha256,stage3bWasmSha256:identity.hashes.stage3bWasmSha256,
        configSha256:identity.hashes.configSha256,profileSha256:identity.hashes.profileSha256,presetsSha256:identity.hashes.presetsSha256,
        referenceFixtureSha256:identity.hashes.referenceFixtureSha256,capturedAt:new Date().toISOString(),metrics},cell,identity);
      const file=cellPath(paths,cell);writeJsonAtomic(file,row);failurePoint?.('after-cell-write',cell);
      entry.state='COMPLETE';entry.path=path.relative(path.dirname(paths.ledger),file);entry.sha256=sha256(file);entry.completedAt=new Date().toISOString();
      ledger.accounting.newRenderCalls=(ledger.accounting.newRenderCalls||0)+1;ledger.updatedAt=new Date().toISOString();
      writeJsonAtomic(paths.ledger,ledger);failurePoint?.('after-complete',cell);
      const pitchCells=expectedSubset().filter(x=>x.stage3bMask===cell.stage3bMask&&x.pitch===cell.pitch);
      if(pitchCells.every(x=>ledger.cells[cellKey(x)].state==='COMPLETE')){
        const complete=pitchCells.map(x=>loadCell(paths,ledger,x,identity));makeAggregate(paths,ledger,identity,cell.stage3bMask,cell.pitch,complete);
        writeJsonAtomic(paths.ledger,ledger);
      }
      progress(`Stage3B ${renderCalls}/${CELL_COUNT} mask ${cell.stage3bMask} MIDI ${cell.pitch} ${cell.velocity??cell.velocityNormalized}`);
    }
  }catch(error){ledger.status='BLOCKED';ledger.lastError=String(error.message||error);ledger.updatedAt=new Date().toISOString();writeJsonAtomic(paths.ledger,ledger);throw error;
  }finally{
    if(priorBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;
  }
  const after=inspectState(paths,identity);
  return {decision:'STAGE3B_RENDERING_COMPLETE',renderCalls,authorizedNewRenders:CELL_COUNT,counts:after.counts,
    ledgerSha256:sha256(paths.ledger),identity};
}

function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--preflight','--dry-run','--execute','--finalize'].includes(args[0]))throw new Error('explicit mode required: --preflight, --dry-run, --execute, or --finalize');
  const mode={'--preflight':'preflight','--dry-run':'dry-run','--execute':'execute','--finalize':'finalize'}[args[0]],started=performance.now();
  const result=run({mode,progress:message=>process.stderr.write(`${message}\n`)});
  process.stdout.write(JSON.stringify({...result,elapsedSeconds:+((performance.now()-started)/1000).toFixed(2)})+'\n');
}

if(require.main===module){try{main();}catch(error){process.stderr.write(`Stage3B contact attribution ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,EXPECTED_HEAD,CANDIDATE,EXPECTED,DYNAMIC_PITCHES,TREBLE_PITCHES,FAIL_PITCHES,CONTROL_PITCHES,VELOCITIES,
  TREBLE_VELOCITIES,MIDI41_NORMALIZED,MASKS,SUBSET,CELL_COUNT,DERIVATIVE_WINDOW,stage3bPaths,cellKey,cellPath,expectedSubset,
  assertDiagnosticExports,assertProductionStage3BAbsent,assertVariantMaskApi,loadStage3ABaseline,
  assertAuthoritativeProductionIdentity,assertStage3AEvidenceIdentity,assertStage3BDiagnosticBuildIdentity,loadProductionProvenance,assertPreflightReady,
  MASK0_AUTHORIZATION_FILE,assertMask0EquivalenceAuthorization,
  assertBuildIdentity,gateCorrectionSelfTest,runPreflight,makeLedger,counts,assertLedger,validateCell,inspectState,loadCell,
  normalizeActiveImpedances,factorial,mean,worstBaselineFailingPitch,supportGates,midi41FactorGuard,factorSafety,selectDecision,
  calculateAnalysis,validateAggregateFiles,finalize,run};
