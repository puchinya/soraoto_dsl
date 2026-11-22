#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const surrogate=require('./stage3e-surrogate-provenance.cjs');
const capture=require('./capture-supersynth-stage3d-matrix.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const CANDIDATE_ID='stage2n-r3-candidate-01';
const EXECUTION_ID='baseline-surrogate-reference-v1';
const REFERENCE_SET_ID='stage3e-baseline-surrogate-reference-v1';
const REFERENCE_FILE='surrogate-reference-set.json';
const TOLERANCE=1e-6;
const DERIVATIVE_EXPECTED=[0.06299055264228781,0.05389008449437237,0.24231471764008602];
const PRODUCTION_CELLS=[[36,14],[36,124],[39,14],[39,124],[51,14],[51,124],[54,14],[54,124],[96,31]]
  .map(([pitch,velocity])=>({kind:'production',pitch,velocity,velocityNormalized:velocity/127}));
const STAGE3A_CELLS=[.25,.55,.90].map(velocityNormalized=>({kind:'stage3a',pitch:41,
  velocity:Math.round(velocityNormalized*127),velocityNormalized,derivativeWindowMs:[30,180]}));
const AUTHORIZED_CELLS=[...PRODUCTION_CELLS,...STAGE3A_CELLS];
const WASM_REL='plugins/dsp/super-synth/plugin.wasm';
const BASE='wasm/plugins/dsp/super-synth';
const CAPTURE_REL=`${BASE}/test/tools/capture-supersynth-stage3d-matrix.cjs`;
const SURROGATE_HELPER_REL=`${BASE}/test/tools/stage3e-surrogate-provenance.cjs`;
const RUNNER_REL=`${BASE}/test/tools/run-stage3e-historical-reference-requalification.cjs`;
const HAMMER_FIELDS=['effectiveHardness','initialHammerVelocity','contactDurationSamples','peakForce','maxCompression','postContactTransverseEnergy'];
const REQUIRED_BASELINE_FIELDS=['envelopeDbfs','spectralCentroidHz','above2kPowerRatio','peakDbfs','fullRenderPeakDbfs','finite','outputGuardHits'];

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fileSha(file){return sha256(fs.readFileSync(file));}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function canonicalBytes(value){return Buffer.from(JSON.stringify(stable(value),null,2)+'\n');}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function cellKey(cell){return cell.kind==='production'
  ?`production-midi-${String(cell.pitch).padStart(3,'0')}-velocity-${String(cell.velocity).padStart(3,'0')}`
  :`stage3a-midi-041-v${String(Math.round(cell.velocityNormalized*1000)).padStart(3,'0')}`;}
function exactCellList(){return AUTHORIZED_CELLS.map(cell=>({...cell,key:cellKey(cell)}));}
function assertAuthorizedCells(cells=exactCellList()){
  const expected=exactCellList();
  if(!Array.isArray(cells)||cells.length!==12||!same(cells.map(cell=>({...cell,key:cell.key||cellKey(cell)})),expected))
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_IDENTITY: exactly the authorized 12-cell set is required');
  if(new Set(cells.map(cell=>cell.key||cellKey(cell))).size!==12)
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_IDENTITY: duplicate cell identity');
  return expected;
}
function roots(root=ROOT,home=process.env.HOME){return durable.resolveRoots({root,issue:'7',task:'stage3e',executionId:EXECUTION_ID,home});}
function nearestExistingDirectory(file){let dir=path.dirname(file);while(!fs.existsSync(dir)){const parent=path.dirname(dir);if(parent===dir)throw new Error(`no existing parent for ${file}`);dir=parent;}return dir;}
function assertDurableDestinationsWritable(rootSet){
  for(const directory of [rootSet.primary,rootSet.secondary])fs.accessSync(nearestExistingDirectory(directory),fs.constants.W_OK);
}
function assertRootsOutsideExecutionRoots(rootSet,root=ROOT){
  const within=(base,value)=>value===base||value.startsWith(base+path.sep);
  const build=path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build'));
  for(const candidate of [rootSet.primary,rootSet.secondary]){
    const resolved=path.resolve(candidate);
    if(within(path.resolve(root),resolved)||within(build,resolved))throw new Error('BLOCKED_STAGE3E_EVIDENCE_ROOT_INSIDE_WORKTREE_OR_BUILD');
  }
}
function durableWrite(rootSet,relative,bytes){return durable.writeDualCopy(path.join(rootSet.primary,relative),path.join(rootSet.secondary,relative),bytes);}
function durableRead(rootSet,relative){return durable.verifyDualCopy(path.join(rootSet.primary,relative),path.join(rootSet.secondary,relative));}
function durableWriteIfChanged(rootSet,relative,bytes){
  const a=path.join(rootSet.primary,relative),b=path.join(rootSet.secondary,relative);
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: partial durable artifact ${relative}`);
    const existing=durable.verifyDualCopy(a,b);
    if(existing.bytes.equals(bytes))return existing;
  }
  return durableWrite(rootSet,relative,bytes);
}
function immutableWrite(rootSet,relative,bytes){
  const a=path.join(rootSet.primary,relative),b=path.join(rootSet.secondary,relative);
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: partial immutable artifact ${relative}`);
    const stored=durable.verifyDualCopy(a,b);
    if(!stored.bytes.equals(bytes))throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: immutable artifact changed ${relative}`);
    return stored;
  }
  return durable.writeDualCopy(a,b,bytes);
}
function fileIdentity({root,provenance,built}){
  const source=surrogate.sourceIdentity({root,provenance});
  const capturePath=path.join(root,CAPTURE_REL),helperPath=path.join(root,SURROGATE_HELPER_REL),runnerPath=path.join(root,RUNNER_REL);
  const wasmSha256=fileSha(built.wasmPath);
  if(wasmSha256!==surrogate.STAGE3D_WASM_SHA256)throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: current surrogate WASM changed');
  const commit=execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const normalizedBuild={decision:built.identity.decision,wasmSha256:built.identity.wasmSha256,
    cmakeFlags:built.identity.cmakeFlags,sourceHashes:built.identity.sourceIdentity.hashes,
    targetUsesPluginStage3d:built.identity.targetUsesPluginStage3d,
    stage3dAndStage2mExportsPresent:built.identity.stage3dAndStage2mExportsPresent,
    stage3bStage3cStage3eExportsAbsent:built.identity.stage3bStage3cStage3eExportsAbsent,
    controls:built.identity.controls,toolchain:built.identity.toolchain.fileSha256};
  return {schemaVersion:1,executionId:EXECUTION_ID,referenceSetId:REFERENCE_SET_ID,candidateId:CANDIDATE_ID,
    executionSourceRevision:commit,authoritativeProductionWasmSha256:surrogate.PRODUCTION_WASM_SHA256,
    productionProvenanceClassification:provenance.classification,productionProvenanceSha256:provenance.sha256,
    isolatedOrdinaryProductionBuildSha256:provenance.document.isolatedProductionBuild.sha256,
    stage3dWasmSha256:surrogate.STAGE3D_WASM_SHA256,stage3dSourceSha256:source.hashes.stage3dPlugin,
    historicalPluginSha256:source.hashes.historicalPlugin,historicalCmakeMacroSha256:source.hashes.historicalCmakeMacro,
    stage3dBuildIdentity:normalizedBuild,configSha256:surrogate.CONFIG_SHA256,profileSha256:surrogate.PROFILE_SHA256,
    presetsSha256:surrogate.PRESETS_SHA256,referenceFixtureSha256:surrogate.FIXTURE_SHA256,
    generatedDescriptorCborSha256:source.hashes.generatedDescriptorCbor,
    generatedDescriptorHeaderSha256:source.hashes.generatedDescriptorHeader,
    acceptedDescriptorSnapshotMetadata:source.acceptedDescriptorSnapshotMetadata,
    stage3dCaptureHelperSha256:fileSha(capturePath),surrogateVerifierSha256:fileSha(helperPath),runnerSha256:fileSha(runnerPath),
    stage2mFactorMask:3,stage3dVariant:0,tolerance:TOLERANCE,authorizedCells:exactCellList()};
}
function validateMetrics(cell,metrics,{diagnosticNames=capture.SOUNDBOARD_DIAGNOSTIC_NAMES}={}){
  if(!metrics||typeof metrics!=='object')throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: metrics missing ${cell.key}`);
  for(const key of REQUIRED_BASELINE_FIELDS)if(!(key in metrics))throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: missing ${key} ${cell.key}`);
  if(!Array.isArray(metrics.envelopeDbfs)||metrics.envelopeDbfs.length!==5||metrics.envelopeDbfs.some(value=>!Number.isFinite(value)))
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: invalid envelope ${cell.key}`);
  for(const key of ['spectralCentroidHz','above2kPowerRatio','peakDbfs','fullRenderPeakDbfs'])if(!Number.isFinite(metrics[key]))
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: non-finite ${key} ${cell.key}`);
  if(metrics.finite!==true||metrics.outputGuardHits!==0||metrics.peakDbfs>=0||metrics.fullRenderPeakDbfs>=0)
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_DIAGNOSTIC_SAFETY: unsafe render ${cell.key}`);
  if(metrics.stage2mFactorMask!==3||metrics.stage3dVariant!==0)throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: diagnostic control mismatch ${cell.key}`);
  if(!metrics.stage2mHammer||HAMMER_FIELDS.some(key=>!Number.isFinite(metrics.stage2mHammer[key])))
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: incomplete Stage2M hammer metrics ${cell.key}`);
  const soundboard=metrics.soundboardDiagnostics;
  if(!soundboard||!Number.isInteger(soundboard.frames)||soundboard.frames<=0||!soundboard.signals||!same(Object.keys(soundboard.signals).sort(),[...diagnosticNames].sort()))
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: incomplete soundboard diagnostics ${cell.key}`);
  for(const [name,signal] of Object.entries(soundboard.signals))if(!Number.isFinite(signal.rms)||!Number.isFinite(signal.peak))
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: invalid soundboard signal ${name} ${cell.key}`);
  if(cell.kind==='stage3a'){
    if(!Number.isFinite(metrics.velocityDerivative)||!same(metrics.velocityDerivativeWindowMs,[30,180]))
      throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: MIDI41 derivative window must be [30,180] ${cell.key}`);
  }else if('velocityDerivative' in metrics||'velocityDerivativeWindowMs' in metrics){
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: direct row must use the canonical direct metric window ${cell.key}`);
  }
  return metrics;
}
function makeRow(cell,metrics){
  const body={schemaVersion:1,cellKey:cell.key,kind:cell.kind,pitch:cell.pitch,velocity:cell.velocity,
    velocityNormalized:cell.velocityNormalized,stage2mFactorMask:3,stage3dVariant:0,metrics};
  return {...body,rowSha256:sha256(canonicalBytes(body))};
}
function verifyRow(cell,row,identity){
  if(!row||row.cellKey!==cell.key||row.pitch!==cell.pitch||row.velocity!==cell.velocity||row.kind!==cell.kind
      ||row.velocityNormalized!==cell.velocityNormalized||row.stage2mFactorMask!==3||row.stage3dVariant!==0)
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: cell identity mismatch ${cell.key}`);
  const {rowSha256,rowFileSha256,...body}=row;
  if(!/^[0-9a-f]{64}$/.test(rowSha256||'')||sha256(canonicalBytes(body))!==rowSha256)
    throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: cell payload hash mismatch ${cell.key}`);
  validateMetrics(cell,row.metrics);
  return row;
}
function freshLedger(identity,now=()=>new Date().toISOString()){
  const cells={};for(const cell of exactCellList())cells[cell.key]={state:'PENDING',identity:cell,relativePath:`cells/${cell.key}.json`,sha256:null};
  return {schemaVersion:1,decision:'STAGE3E_BASELINE_SURROGATE_REFERENCE_IN_PROGRESS',executionId:EXECUTION_ID,
    identity,authorizedRenderCount:12,accounting:{newRenderCalls:0},startedAt:now(),finalizedAt:null,cells};
}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells).filter(cell=>cell.state===state).length]));}
function assertIdentityArtifacts(rootSet,identity,provenanceBytes,built){
  const storedIdentity=durableRead(rootSet,'identity.json');
  if(!storedIdentity.bytes.equals(jsonBytes(identity)))throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_IDENTITY: identity artifact changed');
  const storedProvenance=durableRead(rootSet,'production-provenance.json');
  if(!storedProvenance.bytes.equals(provenanceBytes))throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: provenance bytes changed');
  const storedBuild=durableRead(rootSet,'stage3d-surrogate-identity.json');
  if(!same(JSON.parse(storedBuild.bytes.toString('utf8')),identity.stage3dBuildIdentity))
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: persisted surrogate build identity changed');
  if(fileSha(built.wasmPath)!==identity.stage3dWasmSha256)throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: current scratch WASM changed');
}
function loadExistingLedger(rootSet,identity,{create=false,now}={}){
  const a=path.join(rootSet.primary,'ledger.json'),b=path.join(rootSet.secondary,'ledger.json');
  if(!fs.existsSync(a)&&!fs.existsSync(b)){
    if(!create)return null;
    const ledger=freshLedger(identity,now);durableWrite(rootSet,'ledger.json',jsonBytes(ledger));return ledger;
  }
  if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: partial ledger copy');
  const parsed=JSON.parse(durableRead(rootSet,'ledger.json').bytes.toString('utf8'));
  if(parsed.schemaVersion!==1||parsed.executionId!==EXECUTION_ID||parsed.authorizedRenderCount!==12
      ||!same(parsed.identity,identity)||Object.keys(parsed.cells||{}).length!==12
      ||parsed.accounting?.newRenderCalls!==Object.values(parsed.cells||{}).filter(cell=>cell.state==='COMPLETE').length)
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_IDENTITY: ledger identity changed');
  for(const cell of exactCellList()){
    const state=parsed.cells[cell.key];
    if(!state||!same(state.identity,cell)||state.relativePath!==`cells/${cell.key}.json`)
      throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_IDENTITY: unauthorized cell ${cell.key}`);
    if(state.state==='IN_PROGRESS')throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key}`);
    if(!['PENDING','COMPLETE'].includes(state.state))throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: invalid cell state ${cell.key}`);
    if(state.state==='COMPLETE'){
      const bytes=durableRead(rootSet,state.relativePath);
      if(bytes.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: completed cell hash mismatch ${cell.key}`);
      verifyRow(cell,JSON.parse(bytes.bytes.toString('utf8')),identity);
    }
  }
  return parsed;
}
function createEvidenceHeader(rootSet,identity,provenance,built){
  for(const directory of [rootSet.primary,rootSet.secondary])if(fs.existsSync(directory)&&fs.readdirSync(directory).length)
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: evidence exists without a 12-cell ledger');
  for(const relative of ['identity.json','production-provenance.json','stage3d-surrogate-identity.json','ledger.json'])
    if(fs.existsSync(path.join(rootSet.primary,relative))||fs.existsSync(path.join(rootSet.secondary,relative)))
      throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: incomplete pre-render header ${relative}`);
  for(const directory of [path.join(rootSet.primary,'cells'),path.join(rootSet.secondary,'cells')])
    if(fs.existsSync(directory)&&fs.readdirSync(directory).length)
      throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: cell files exist without an authoritative ledger');
  for(const relative of [REFERENCE_FILE,`${REFERENCE_FILE}.sha256`,'evidence-manifest.json','evidence-manifest.sha256'])
    if(fs.existsSync(path.join(rootSet.primary,relative))||fs.existsSync(path.join(rootSet.secondary,relative)))
      throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: unexpected pre-existing artifact ${relative}`);
  durableWrite(rootSet,'production-provenance.json',provenance.bytes);
  durableWrite(rootSet,'identity.json',jsonBytes(identity));
  durableWrite(rootSet,'stage3d-surrogate-identity.json',jsonBytes(identity.stage3dBuildIdentity));
  return loadExistingLedger(rootSet,identity,{create:true});
}
function defaultCaptureCell(cell,{buildDir}){
  const previous=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=buildDir;
  try{
    const options={stage2mFactorMask:3,stage3dVariant:0,includeSoundboardDiagnostics:true};
    if(cell.kind==='stage3a')Object.assign(options,{includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180});
    return capture.renderNormalized(cell.pitch,cell.velocityNormalized,{},options);
  }finally{if(previous===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=previous;}
}
function currentIdentity({root,validateLineage,buildSurrogate,identityFactory,built,initial}){
  const provenance=validateLineage({root});
  if(provenance.sha256!==initial.productionProvenanceSha256||provenance.classification!==initial.productionProvenanceClassification)
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: provenance changed during capture');
  if(fileSha(built.wasmPath)!==initial.stage3dWasmSha256)
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: scratch artifact changed during capture');
  const value=identityFactory({root,provenance,built});
  if(!same(value,initial))throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_IDENTITY: source or authorization identity changed');
  return {provenance,identity:value};
}
function writeCell(rootSet,cell,row){
  const bytes=jsonBytes(row),stored=durableWrite(rootSet,`cells/${cell.key}.json`,bytes);
  if(stored.sha256!==sha256(bytes))throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: persisted cell hash mismatch ${cell.key}`);
  return stored;
}
function executePending({root,rootSet,ledger,identity,provenance,built,validateLineage,identityFactory,captureCell}){
  let renders=0;
  for(const cell of exactCellList()){
    const state=ledger.cells[cell.key];if(state.state==='COMPLETE')continue;
    currentIdentity({root,validateLineage,identityFactory,built,initial:identity});
    state.state='IN_PROGRESS';durableWrite(rootSet,'ledger.json',jsonBytes(ledger));
    const metrics=captureCell(cell,{buildDir:built.buildDir});renders++;
    validateMetrics(cell,metrics);
    const row=makeRow(cell,metrics),written=writeCell(rootSet,cell,row);
    state.sha256=written.sha256;state.state='COMPLETE';ledger.accounting.newRenderCalls++;
    if(ledger.accounting.newRenderCalls>12)throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_ACCOUNTING: more than 12 acoustic renders');
  durableWriteIfChanged(rootSet,'ledger.json',jsonBytes(ledger));
  }
  return {renders,ledger,counts:counts(ledger)};
}
function referenceSetFromLedger(rootSet,ledger,identity){
  const rows=[];
  for(const cell of exactCellList()){
    const state=ledger.cells[cell.key];if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: incomplete cell ${cell.key}`);
    const stored=durableRead(rootSet,state.relativePath);if(stored.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: cell hash mismatch ${cell.key}`);
    rows.push({...verifyRow(cell,JSON.parse(stored.bytes.toString('utf8')),identity),rowFileSha256:stored.sha256});
  }
  return {schemaVersion:1,decision:'STAGE3E_BASELINE_SURROGATE_REQUALIFIED',referenceSetId:REFERENCE_SET_ID,
    candidateId:CANDIDATE_ID,authoritativeHistoricalProductionWasmSha256:identity.authoritativeProductionWasmSha256,
    productionProvenanceClassification:identity.productionProvenanceClassification,productionProvenanceSha256:identity.productionProvenanceSha256,
    isolatedOrdinaryProductionBuildSha256:identity.isolatedOrdinaryProductionBuildSha256,
    stage3dWasmSha256:identity.stage3dWasmSha256,stage3dSourceSha256:identity.stage3dSourceSha256,
    stage2mFactorMask:3,stage3dVariant:0,configSha256:identity.configSha256,profileSha256:identity.profileSha256,
    presetsSha256:identity.presetsSha256,referenceFixtureSha256:identity.referenceFixtureSha256,
    authorizedCellCount:12,acousticRenderCalls:ledger.accounting.newRenderCalls,
    productionCandidateDelta:0,stage4Renders:0,startedAt:ledger.startedAt,finalizedAt:ledger.finalizedAt,rows};
}
function finalizeReferenceSet({rootSet,ledger,identity,now=()=>new Date().toISOString()}){
  const c=counts(ledger);if(c.PENDING!==0||c.IN_PROGRESS!==0||c.COMPLETE!==12||ledger.accounting.newRenderCalls!==12)
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: finalization requires exactly 12 COMPLETE cells');
  ledger.finalizedAt=ledger.finalizedAt||now();ledger.decision='STAGE3E_BASELINE_SURROGATE_REQUALIFIED';
  const referenceSet=referenceSetFromLedger(rootSet,ledger,identity),bytes=jsonBytes(referenceSet);
  const written=immutableWrite(rootSet,REFERENCE_FILE,bytes);
  immutableWrite(rootSet,`${REFERENCE_FILE}.sha256`,Buffer.from(`${written.sha256}\n`));
  ledger.referenceSetSha256=written.sha256;durableWriteIfChanged(rootSet,'ledger.json',jsonBytes(ledger));
  const manifest=durable.writeFinalizedManifest({primaryRoot:rootSet.primary,secondaryRoot:rootSet.secondary,
    metadata:{creatorRevision:identity.executionSourceRevision,executionId:EXECUTION_ID,generation:REFERENCE_SET_ID,
      runnerSha256:identity.runnerSha256,helperSha256:identity.stage3dCaptureHelperSha256,wasmSha256:identity.stage3dWasmSha256,
      startedAt:ledger.startedAt,finalizedAt:ledger.finalizedAt,decision:referenceSet.decision},
    artifactRoles:{[REFERENCE_FILE]:'stage3e-surrogate-reference-set', 'production-provenance.json':'production-lineage-provenance',
      'stage3d-surrogate-identity.json':'exact-stage3d-surrogate-build'}});
  const archive=durable.createPhaseArchive({primaryRoot:rootSet.primary,secondaryRoot:rootSet.secondary,phase:'historical-reference-requalification'});
  const replay=durable.verifyDualCopy(path.join(rootSet.primary,REFERENCE_FILE),path.join(rootSet.secondary,REFERENCE_FILE));
  if(replay.sha256!==written.sha256)throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: finalized reference replay hash changed');
  return {referenceSet,referenceSetSha256:written.sha256,manifestSha256:manifest.sha256,archiveSha256:archive.sha256};
}
function readLedgerIfPresent(rootSet,identity){return loadExistingLedger(rootSet,identity,{create:false});}
function run({mode,root=ROOT,home=process.env.HOME,validateLineage=surrogate.validateProductionLineage,
  buildSurrogate=surrogate.buildExactStage3dSurrogate,captureCell=defaultCaptureCell,
  rootsFactory=roots,identityFactory=({root:r,provenance,built})=>fileIdentity({root:r,provenance,built}),now=()=>new Date().toISOString()}={}){
  if(!['--dry-run','--execute','--finalize'].includes(mode))throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  const provenance=validateLineage({root});
  if(!['EXACT_REBUILD_PROVENANCE','SUFFICIENT_METADATA_PROVENANCE'].includes(provenance.classification))
    throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED: unsupported accepted provenance classification');
  const built=buildSurrogate({root,provenance});
  try{
    const identity=identityFactory({root,provenance,built});
    const rootSet=rootsFactory(root,home);assertRootsOutsideExecutionRoots(rootSet,root);assertDurableDestinationsWritable(rootSet);
    let ledger=null;
    if(mode==='--dry-run'){
      const ledgerExists=fs.existsSync(path.join(rootSet.primary,'ledger.json'))||fs.existsSync(path.join(rootSet.secondary,'ledger.json'));
      const anyEvidence=[rootSet.primary,rootSet.secondary].some(directory=>fs.existsSync(directory)&&fs.readdirSync(directory).length>0);
      if(anyEvidence&&!ledgerExists)throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: partial evidence exists without an authoritative ledger');
      if(ledgerExists){
        ledger=readLedgerIfPresent(rootSet,identity);
        if(ledger)assertIdentityArtifacts(rootSet,identity,provenance.bytes,built);
      }
      return {decision:ledger?.decision||'STAGE3E_BASELINE_SURROGATE_REFERENCE_READY',builds:1,renders:0,acousticRenders:0,
        authorizedRenderCount:12,complete:ledger?counts(ledger).COMPLETE:0,pending:ledger?counts(ledger).PENDING:12,
        inProgress:ledger?counts(ledger).IN_PROGRESS:0,referenceSetId:REFERENCE_SET_ID,
        productionProvenanceClassification:provenance.classification,productionProvenanceSha256:provenance.sha256,
        stage3dWasmSha256:identity.stage3dWasmSha256,stage3dVariant:0,stage2mFactorMask:3,authorizedCells:exactCellList()};
    }
    if(mode==='--execute'){
      fs.mkdirSync(rootSet.primary,{recursive:true,mode:0o700});fs.mkdirSync(rootSet.secondary,{recursive:true,mode:0o700});
      const hasLedger=fs.existsSync(path.join(rootSet.primary,'ledger.json'))||fs.existsSync(path.join(rootSet.secondary,'ledger.json'));
      if(hasLedger){ledger=loadExistingLedger(rootSet,identity,{create:false});assertIdentityArtifacts(rootSet,identity,provenance.bytes,built);}
      else ledger=createEvidenceHeader(rootSet,identity,provenance,built);
      const executed=executePending({root,rootSet,ledger,identity,provenance,built,validateLineage,identityFactory,captureCell});
      return {decision:'STAGE3E_BASELINE_SURROGATE_REFERENCE_IN_PROGRESS',builds:1,renders:executed.renders,acousticRenders:executed.renders,
        authorizedRenderCount:12,counts:executed.counts,accounting:ledger.accounting,identitySha256:sha256(jsonBytes(identity)),stage3dWasmSha256:identity.stage3dWasmSha256};
    }
    ledger=loadExistingLedger(rootSet,identity,{create:false});
    if(!ledger)throw new Error('BLOCKED_STAGE3E_SURROGATE_REFERENCE_EVIDENCE: ledger is absent');
    assertIdentityArtifacts(rootSet,identity,provenance.bytes,built);
    currentIdentity({root,validateLineage,identityFactory,built,initial:identity});
    const finalized=finalizeReferenceSet({rootSet,ledger,identity,now});
    return {decision:finalized.referenceSet.decision,builds:1,renders:0,acousticRenders:0,counts:counts(ledger),
      authorizedRenderCount:12,referenceSetSha256:finalized.referenceSetSha256,manifestSha256:finalized.manifestSha256,
      archiveSha256:finalized.archiveSha256,productionProvenanceClassification:provenance.classification,
      productionProvenanceSha256:provenance.sha256,stage3dWasmSha256:identity.stage3dWasmSha256};
  }finally{built.cleanup?.();}
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==1)throw new Error('explicit mode required: --dry-run, --execute, or --finalize');
  process.stdout.write(JSON.stringify(run({mode:argv[0]} ) )+'\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,CANDIDATE_ID,EXECUTION_ID,REFERENCE_SET_ID,REFERENCE_FILE,PRODUCTION_CELLS,STAGE3A_CELLS,AUTHORIZED_CELLS,DERIVATIVE_EXPECTED,
  TOLERANCE,REQUIRED_BASELINE_FIELDS,HAMMER_FIELDS,sha256,fileSha,stable,canonicalBytes,same,cellKey,exactCellList,assertAuthorizedCells,
  roots,validateMetrics,makeRow,verifyRow,freshLedger,counts,fileIdentity,assertRootsOutsideExecutionRoots,assertDurableDestinationsWritable,
  loadExistingLedger,createEvidenceHeader,defaultCaptureCell,referenceSetFromLedger,finalizeReferenceSet,run,main};
