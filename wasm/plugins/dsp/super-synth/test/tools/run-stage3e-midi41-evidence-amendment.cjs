#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const capture3e=require('./capture-supersynth-stage3e-matrix.cjs');
const capture3d=require('./capture-supersynth-stage3d-matrix.cjs');
const legacy=require('./run-stage3e-velocity-response.cjs');
const historical=require('./run-stage3e-historical-reference-requalification.cjs');
const core=require('./stage3e-generation2-core.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const EXECUTION_ID='generation-2';
const AMENDMENT_ID='midi41-derivative-amendment-v1';
const AMENDMENT_RELATIVE=`generation-2/${AMENDMENT_ID}`;
const STAGE3D_PLUGIN_WASM='plugins/dsp/super-synth/plugin.wasm';
const SOURCE_AUDIT_SHA256='eda9e25c490162e4b46e8e72e98da25e84bfd4980afe16c1df773d9020c53560';
const REFERENCE_SHA256='813a3069d384656419f1cf976c2b501a567909dfd2de5703fc58277f0096c0d8';
const REFERENCE_MANIFEST_SHA256='1df4c3ce0f0ebf79a662a53aedd215a4240d73401f0dcf1d0cb217151df2b816';
const GENERATION2_LEDGER_SHA256='99c40b2f33b01d95c4b7ecc41d32b1c67afc1f5d93ed7e7673cf1fda2f6ab5b7';
const STAGE3D_WASM_SHA256='9883b54eaa888b5a8d2e4d9da0490de92dd4c31915fb0d97d47cc03ce123a63a';
const STAGE3E_WASM_SHA256='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221';
const FIXED={production:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  config:'792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d',
  profile:'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66',
  presets:'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431',
  fixture:'5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7'};
const STAGE3A_DERIVATIVES=[0.06299055264228781,0.05389008449437237,0.24231471764008602];
const MIDI41=[.25,.55,.90];
const TOLERANCE=1e-6;

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fileSha(file){return sha256(fs.readFileSync(file));}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function stage3eRoots(root=ROOT,home=process.env.HOME){
  const common=durable.commonDir(root),repository=path.basename(path.resolve(root));
  return {primary:path.join(common,'soraoto-agent-state','7','stage3e'),secondary:path.join(home,'.soraoto-agent-archive',repository,'7','stage3e'),common,repository};
}
function amendmentRoots(root=ROOT,home=process.env.HOME){const base=stage3eRoots(root,home);return {primary:path.join(base.primary,...AMENDMENT_RELATIVE.split('/')),secondary:path.join(base.secondary,...AMENDMENT_RELATIVE.split('/')),base};}
function generation2Roots(root=ROOT,home=process.env.HOME){const base=stage3eRoots(root,home);return {primary:path.join(base.primary,EXECUTION_ID),secondary:path.join(base.secondary,EXECUTION_ID),base};}
function surrogateRoots(root=ROOT,home=process.env.HOME){const base=stage3eRoots(root,home);return {primary:path.join(base.primary,'baseline-surrogate-reference-v1'),secondary:path.join(base.secondary,'baseline-surrogate-reference-v1'),base};}
function stage3dBuildRoot(root=ROOT){return path.resolve(process.env.SORAOTO_STAGE3D_WASM_BUILD_DIR||path.join(path.dirname(durable.commonDir(root)),'build/wasm-stage3d'));}
function readDualJson(roots,relative){return JSON.parse(durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.toString('utf8'));}
function writeDualJson(roots,relative,value){return durable.writeDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),jsonBytes(value));}
function immutableDualJson(roots,relative,value){
  const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative),bytes=jsonBytes(value);
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: partial immutable artifact ${relative}`);
    const old=durable.verifyDualCopy(a,b);if(!old.bytes.equals(bytes))throw new Error(`BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: ${relative}`);return old;
  }
  return durable.writeDualCopy(a,b,bytes);
}
function fileInventory(root){
  const result=[];
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name),relative=path.relative(root,file).split(path.sep).join('/');if(entry.isDirectory()){if(relative===AMENDMENT_RELATIVE||relative.startsWith(AMENDMENT_RELATIVE+'/'))continue;walk(file);}else{const bytes=fs.readFileSync(file);result.push({path:relative,sizeBytes:bytes.length,sha256:sha256(bytes),mtimeNs:fs.statSync(file,{bigint:true}).mtimeNs.toString()});}}}
  walk(root);return result.sort((a,b)=>a.path.localeCompare(b.path));
}
function assertSourceAudit({root=ROOT,home=process.env.HOME}={}){
  const roots=amendmentRoots(root,home),audit=durable.verifyDualCopy(path.join(roots.primary,'source-evidence-audit.json'),path.join(roots.secondary,'source-evidence-audit.json'));
  if(audit.sha256!==SOURCE_AUDIT_SHA256)throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: source audit SHA changed');
  const doc=JSON.parse(audit.bytes.toString('utf8'));
  const missing=doc.missingDerivativeAudit;
  if(doc.decision!=='STAGE3E_MIDI41_AMENDMENT_SOURCE_AUDIT'||
     !same(missing?.surrogate,[])||!same(missing?.generation2,[.25,.55,.90])||
     missing?.authorizedRenderCount!==3||missing?.maximumAllowed!==6||
     !Array.isArray(missing?.authorizedSupplementIdentities)||missing.authorizedSupplementIdentities.length!==3||
     missing.authorizedSupplementIdentities.some((cell,index)=>cell.side!=='generation2'||cell.pitch!==41||
       cell.velocityNormalized!==[.25,.55,.90][index]||cell.stage3dVariant!==null||cell.stage2mFactorMask!==3||!same(cell.windowMs,[30,180])))
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_SOURCE_AUDIT_INVALID');
  const current={primary:fileInventory(roots.base.primary),secondary:fileInventory(roots.base.secondary)};
  for(const name of ['primary','secondary'])if(!same(current[name],doc.immutablePreexistingFileInventory?.[name]?.files))
    throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: original ${name} inventory/hash/mtime changed`);
  return {roots,audit:doc,sha256:audit.sha256,inventory:current};
}
function assertWritable(rootSet){
  for(const target of [rootSet.primary,rootSet.secondary]){
    fs.mkdirSync(target,{recursive:true,mode:0o700});
    const probe=path.join(target,`.stage3e-write-probe-${process.pid}-${crypto.randomUUID()}`);
    let fd;
    try{fd=fs.openSync(probe,'wx',0o600);fs.writeSync(fd,'probe');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.unlinkSync(probe);}
    catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{};try{fs.unlinkSync(probe);}catch{};throw new Error(`BLOCKED_STAGE3E_AMENDMENT_DURABLE_PREFLIGHT: ${target}: ${error.message}`);}
  }
}
function assertImmutableIdentityFiles(ctx){
  const authorization=durable.verifyDualCopy(path.join(ctx.roots.primary,'authorization.json'),path.join(ctx.roots.secondary,'authorization.json'));
  const captureIdentity=durable.verifyDualCopy(path.join(ctx.roots.primary,'capture-identity.json'),path.join(ctx.roots.secondary,'capture-identity.json'));
  if(authorization.sha256!==ctx.authorizationSha256||!authorization.bytes.equals(jsonBytes(ctx.auth))||
     captureIdentity.sha256!==ctx.captureIdentitySha256||!captureIdentity.bytes.equals(jsonBytes(ctx.captureIdentity)))
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: authorization or capture identity changed');
}
function rowKey(row){return row.kind==='stage3a'?`stage3a-midi-041-v${String(Math.round(row.velocityNormalized*1000)).padStart(3,'0')}`:row.cellKey;}
function missingDerivative(rows){return rows.filter(row=>row.pitch===41&&row.kind==='stage3a'&&(!Number.isFinite(row.metrics?.velocityDerivative)||!same(row.metrics?.velocityDerivativeWindowMs,[30,180])));}
function loadBaselineRows({root=ROOT,home=process.env.HOME}={}){
  const sr=surrogateRoots(root,home),gr=generation2Roots(root,home),ref=core.loadFinalizedReferenceSet(sr);
  if(ref.sha256!==REFERENCE_SHA256)throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: surrogate reference SHA changed');
  const refLedger=readDualJson(sr,'ledger.json'),genLedger=readDualJson(gr,'baseline/baseline-ledger.json');
  const genManifest=durable.verifyDualCopy(path.join(gr.primary,'generation-2-manifest.json'),path.join(gr.secondary,'generation-2-manifest.json'));
  if(sha256(fs.readFileSync(path.join(sr.primary,'evidence-manifest.json')))!==REFERENCE_MANIFEST_SHA256||
     sha256(fs.readFileSync(path.join(gr.primary,'baseline/baseline-ledger.json')))!==GENERATION2_LEDGER_SHA256)
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: accepted baseline evidence SHA changed');
  if(refLedger.decision!=='STAGE3E_BASELINE_SURROGATE_REQUALIFIED'||refLedger.authorizedRenderCount!==12||refLedger.accounting?.newRenderCalls!==12||
     genLedger.generation!==2||genLedger.authorizedCellCount!==12||genLedger.accounting?.renderCalls!==12||Object.values(genLedger.cells||{}).some(x=>x.state!=='COMPLETE'))
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: original baseline ledgers are incomplete');
  if(genManifest.sha256===undefined)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: Generation-2 historical manifest missing');
  const historicalGen2Identity=JSON.parse(genManifest.bytes.toString('utf8')).identity;
  const readCells=(ledger,base,side)=>Object.entries(ledger.cells).map(([key,state])=>{
    if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: original ${side} row not COMPLETE ${key}`);
    const bytes=durable.verifyDualCopy(path.join(base.primary,state.relativePath),path.join(base.secondary,state.relativePath));
    if(bytes.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: original ${side} cell SHA mismatch ${key}`);
    const row=JSON.parse(bytes.bytes.toString('utf8'));return {...row,_key:key,_relativePath:state.relativePath,_sha256:bytes.sha256,_side:side};
  });
  const refRows=readCells(refLedger,sr,'surrogate'),genRows=readCells(genLedger,{primary:path.join(gr.primary,'baseline'),secondary:path.join(gr.secondary,'baseline')},'generation2');
  if(refRows.length!==12||genRows.length!==12)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: expected 12 rows per baseline');
  const refByKey=new Map(ref.referenceSet.rows.map(row=>[row.cellKey,row]));
  for(const row of refRows){const canonical=refByKey.get(row.cellKey);if(!canonical||canonical.rowFileSha256!==row._sha256)throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: surrogate row binding mismatch ${row.cellKey}`);}
  const stripDerivative=metrics=>{const result={...metrics};delete result.velocityDerivative;delete result.velocityDerivativeWindowMs;return result;};
  let maxNonDerivativeDifference=0;
  for(const refRow of ref.referenceSet.rows){const genRow=genRows.find(row=>row.pitch===refRow.pitch&&row.velocityNormalized===refRow.velocityNormalized);
    if(!genRow)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: paired Generation-2 row missing');
    const a=core.projectMetrics(stripDerivative(refRow.metrics),'production'),b=core.projectMetrics(stripDerivative(genRow.metrics),'production');
    const comparison=core.compareValue(a,b,{tolerance:TOLERANCE,pathName:`${refRow.cellKey}.preAmendment`});
    if(!comparison.pass)throw new Error('BLOCKED_STAGE3E_AMENDMENT_ORIGINAL_METRICS_MISMATCH: '+refRow.cellKey);
    maxNonDerivativeDifference=Math.max(maxNonDerivativeDifference,comparison.maxDifference||0);
  }
  const refMissing=missingDerivative(refRows),genMissing=missingDerivative(genRows);
  const exactReference=[.25,.55,.90];
  if(refMissing.length||!same(genMissing.map(x=>x.velocityNormalized).sort((a,b)=>a-b),exactReference))
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: derivative missing set differs from source audit');
  for(let i=0;i<3;i++){const row=refRows.find(x=>x.pitch===41&&x.velocityNormalized===exactReference[i]);
    if(row.metrics.velocityDerivative!==STAGE3A_DERIVATIVES[i]||!same(row.metrics.velocityDerivativeWindowMs,[30,180]))throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: surrogate derivative reference mismatch');}
  const provenance=readDualJson(sr,'production-provenance.json');
  if(!['EXACT_REBUILD_PROVENANCE','SUFFICIENT_METADATA_PROVENANCE'].includes(provenance.classification))throw new Error('BLOCKED_STAGE3E_PRODUCTION_PROVENANCE_UNRESOLVED');
  if(historicalGen2Identity?.protectedIdentity?.sourcePluginSha256!==fileSha(path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c')))
    throw new Error('BLOCKED_STAGE3E_MEASUREMENT_IDENTITY_DRIFT: production DSP source differs from historical Generation-2 baseline');
  return {roots:{surrogate:sr,generation2:gr},referenceSet:ref.referenceSet,referenceSetSha256:ref.sha256,
    referenceManifestSha256:REFERENCE_MANIFEST_SHA256,referenceLedgerSha256:sha256(fs.readFileSync(path.join(sr.primary,'ledger.json'))),
    generation2ManifestSha256:genManifest.sha256,generation2BaselineLedgerSha256:GENERATION2_LEDGER_SHA256,
    historicalGeneration2Identity:historicalGen2Identity,
    historicalCaptureIdentity:{creatorRevision:historicalGen2Identity.creatorRevision,
      helperSha256:historicalGen2Identity.captureHelperSha256,runnerSha256:historicalGen2Identity.runnerSha256},
    productionProvenanceClassification:provenance.classification,refRows,genRows,refMissing,genMissing,maxNonDerivativeDifference};
}
function supplementId(row){return `${row._side}-midi-041-v${String(Math.round(row.velocityNormalized*1000)).padStart(3,'0')}`;}
function exactSupplementIdentities(baseline){
  return [...baseline.refMissing,...baseline.genMissing].map(row=>({key:supplementId(row),side:row._side,pitch:41,
    velocityNormalized:row.velocityNormalized,originalCellRelativePath:row._relativePath,originalCellSha256:row._sha256,
    response:row._side==='generation2'?[1,1,1]:null,stage3dVariant:row._side==='surrogate'?0:null,stage2mFactorMask:3,
    velocityDerivativeWindowMs:[30,180],includeSoundboardDiagnostics:true})).sort((a,b)=>a.key.localeCompare(b.key));
}
function currentBuildIdentities({root=ROOT}={}){
  const env=process.env.SORAOTO_WASM_BUILD_DIR,wasm3e=path.join(capture3e.buildRoot(root),capture3e.WASM),wasm3d=path.join(stage3dBuildRoot(root),STAGE3D_PLUGIN_WASM);
  if(env!==undefined)process.env.SORAOTO_WASM_BUILD_DIR=path.join(root,'build/wasm-stage3e');
  let stage3e;try{stage3e=capture3e.identity();}finally{if(env===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=env;}
  const stage3dSha=fileSha(wasm3d),stage3eSha=fileSha(wasm3e);
  if(stage3dSha!==STAGE3D_WASM_SHA256||stage3eSha!==STAGE3E_WASM_SHA256)throw new Error('BLOCKED_STAGE3E_MEASUREMENT_IDENTITY_DRIFT: diagnostic WASM mismatch');
  const profile=path.join(root,'wasm/shared/generated/super-synth_grand_profiles.h'),presets=path.join(root,'wasm/plugins/dsp/super-synth/presets.json'),source3d=path.join(root,'wasm/plugins/dsp/super-synth/src/plugin_stage3d.c');
  const presetDocument=JSON.parse(fs.readFileSync(presets,'utf8')),calibration=JSON.parse(JSON.stringify(presetDocument.concert_grand));delete calibration.engine_config.soundboard.radiation_scale;
  const configSha256=sha256(Buffer.from(JSON.stringify(calibration)));
  if(configSha256!==FIXED.config||fileSha(presets)!==FIXED.presets||fileSha(profile)!==FIXED.profile||fileSha(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'))!==FIXED.fixture)
    throw new Error('BLOCKED_STAGE3E_MEASUREMENT_IDENTITY_DRIFT: protected product inputs changed');
  if(fileSha(source3d)!=='968488b7d325c42e41570c1d7add10003050ab4c87779774a6e5337244c64886')
    throw new Error('BLOCKED_STAGE3E_SURROGATE_REBUILD_PROVENANCE: Stage3D source identity changed');
  return {authoritativeProductionWasmSha256:FIXED.production,stage3dWasmSha256:stage3dSha,stage3eWasmSha256:stage3eSha,stage3dSourceSha256:fileSha(source3d),stage3eSourceSha256:fileSha(path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c')),
    configSha256:FIXED.config,profileSha256:fileSha(profile),presetsSha256:fileSha(presets),referenceFixtureSha256:FIXED.fixture,
    stage3dCaptureHelperSha256:fileSha(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3d-matrix.cjs')),
    stage3eCaptureHelperSha256:fileSha(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs')),
    stage3eAmendmentRunnerSha256:fileSha(__filename),stage3eVelocityRunnerSha256:fileSha(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs')),
    stage3eGeneration2RunnerSha256:fileSha(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs')),
    stage3eCoreSha256:fileSha(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs')),
    sourceRevision:execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sampleRate:capture3e.SAMPLE_RATE,durationMs:capture3e.DURATION_MS,
    stage2mFactorMask:3,stage3dVariant:0,baselineResponse:[1,1,1]};
}
function makeAuthorization({audit,baseline,buildIdentity}){
  const identities=exactSupplementIdentities(baseline);
  if(identities.length>6||identities.some(x=>x.pitch!==41||!MIDI41.includes(x.velocityNormalized)||!same(x.velocityDerivativeWindowMs,[30,180])))
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_RENDER_BUDGET');
  return {schemaVersion:1,decision:'STAGE3E_MIDI41_DERIVATIVE_AMENDMENT_AUTHORIZED',amendmentId:AMENDMENT_ID,
    sourceEvidenceAuditSha256:audit.sha256,sourceEvidenceAuditDecision:audit.audit.decision,sourceSnapshotSha256ByStore:{primary:sha256(jsonBytes(audit.audit.immutablePreexistingFileInventory.primary.files)),secondary:sha256(jsonBytes(audit.audit.immutablePreexistingFileInventory.secondary.files))},
    surrogateResultSha256:REFERENCE_SHA256,surrogateManifestSha256:REFERENCE_MANIFEST_SHA256,generation2BaselineLedgerSha256:GENERATION2_LEDGER_SHA256,
    generation2ManifestSha256:baseline.generation2ManifestSha256,authorizedCells:identities,authorizedRenderCount:identities.length,
    maxAdditionalAcousticCalls:6,stage2mFactorMask:3,stage3dVariant:0,velocityDerivativeWindowMs:[30,180],tolerance:TOLERANCE,
    productionCandidateDelta:0,stage3SearchCalls:0,stage3Calls:0,stage4Calls:0,buildIdentity:buildIdentity};
}
function makeCaptureIdentity({baseline,buildIdentity,authorizationSha256}){
  return {schemaVersion:1,decision:'STAGE3E_MIDI41_AMENDMENT_CAPTURE_IDENTITY',amendmentId:AMENDMENT_ID,
    executionSourceRevision:buildIdentity.sourceRevision,authorizationSha256,sourceAuditSha256:SOURCE_AUDIT_SHA256,
    historicalCaptureIdentity:baseline.historicalCaptureIdentity,historicalGeneration2ManifestSha256:baseline.generation2ManifestSha256,
    historicalGeneration2BaselineLedgerSha256:GENERATION2_LEDGER_SHA256,amendmentCaptureIdentity:{stage3eCaptureHelperSha256:buildIdentity.stage3eCaptureHelperSha256,
      stage3dCaptureHelperSha256:buildIdentity.stage3dCaptureHelperSha256,amendmentRunnerSha256:buildIdentity.stage3eAmendmentRunnerSha256,
      velocityRunnerSha256:buildIdentity.stage3eVelocityRunnerSha256,generation2RunnerSha256:buildIdentity.stage3eGeneration2RunnerSha256,
      stage3eCoreSha256:buildIdentity.stage3eCoreSha256},buildIdentity,
    acousticControls:{sampleRate:48000,durationMs:380,preset:'concert_grand',stage2mFactorMask:3,stage3dVariant:0,
      generation2Response:[1,1,1],normalizedVelocities:MIDI41,derivativeWindowMs:[30,180]},
    acousticIdentityDelta:'measurement and verifier only; plugin source, fixed WASM identities, presets, profile, config, fixture, sample rate, duration, and controls are bound above'};
}
function assertCurrentCaptureIdentity(expected,{root=ROOT,baseline,authorizationSha256}={}){
  const current=makeCaptureIdentity({baseline,buildIdentity:currentBuildIdentities({root}),authorizationSha256});
  const comparison={...current,executionSourceRevision:expected.executionSourceRevision};
  if(!same(comparison,expected))throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: measurement capture identity changed');
  const currentHead=current.buildIdentity.sourceRevision;
  try{execFileSync('rtk',['git','merge-base','--is-ancestor',expected.executionSourceRevision,currentHead],{cwd:root,stdio:'ignore'});}catch{throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: current HEAD is not descended from capture commit');}
  return expected;
}
function assertAuthorization(auth,expected){
  if(!auth||auth.decision!=='STAGE3E_MIDI41_DERIVATIVE_AMENDMENT_AUTHORIZED'||auth.amendmentId!==AMENDMENT_ID||
     auth.sourceEvidenceAuditSha256!==SOURCE_AUDIT_SHA256||auth.surrogateResultSha256!==REFERENCE_SHA256||
     auth.surrogateManifestSha256!==REFERENCE_MANIFEST_SHA256||auth.generation2BaselineLedgerSha256!==GENERATION2_LEDGER_SHA256||
     !same(auth.authorizedCells,expected)||auth.authorizedRenderCount!==expected.length||auth.authorizedRenderCount>6||auth.maxAdditionalAcousticCalls!==6||
     auth.stage2mFactorMask!==3||auth.stage3dVariant!==0||!same(auth.velocityDerivativeWindowMs,[30,180])||auth.tolerance!==TOLERANCE)
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_RENDER_BUDGET');
  return auth;
}
function freshLedger(auth,authorizationSha256,captureIdentity,captureIdentitySha256,now=()=>new Date().toISOString()){
  const cells={};for(const cell of auth.authorizedCells)cells[cell.key]={state:'PENDING',identity:cell,relativePath:`cells/${cell.key}.json`,sha256:null};
  return {schemaVersion:1,decision:'STAGE3E_MIDI41_AMENDMENT_IN_PROGRESS',amendmentId:AMENDMENT_ID,identity:captureIdentity,
    authorizationSha256,captureIdentitySha256,authorizedRenderCount:auth.authorizedRenderCount,accounting:{newRenderCalls:0},startedAt:now(),finalizedAt:null,cells};
}
function ledgerCounts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells||{}).filter(cell=>cell.state===state).length]));}
function compareOriginalMetrics(original,supplement){
  const before={...original.metrics},after={...supplement.metrics};delete before.velocityDerivative;delete before.velocityDerivativeWindowMs;delete after.velocityDerivative;delete after.velocityDerivativeWindowMs;
  const comparison=core.compareValue(before,after,{tolerance:TOLERANCE,pathName:'supplement.metrics'});
  if(!comparison.pass)throw new Error('BLOCKED_STAGE3E_AMENDMENT_ORIGINAL_METRICS_MISMATCH');
  return comparison.maxDifference;
}
function validateSupplementCell(cell,record,baseline){
  if(!record||record.schemaVersion!==1||record.amendmentId!==AMENDMENT_ID||record.key!==cell.key||
    record.side!==cell.side||record.pitch!==41||record.velocityNormalized!==cell.velocityNormalized||
    record.originalCellRelativePath!==cell.originalCellRelativePath||record.originalCellSha256!==cell.originalCellSha256||
    record.stage2mFactorMask!==3||(cell.side==='surrogate'&&record.stage3dVariant!==0)||
    !same(record.velocityDerivativeWindowMs,[30,180]))throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: supplement identity mismatch ${cell.key}`);
  const metrics=record.metrics;
  if(!Number.isFinite(metrics?.velocityDerivative)||!same(metrics?.velocityDerivativeWindowMs,[30,180])||metrics.finite!==true||metrics.outputGuardHits!==0||
    !Number.isFinite(metrics.fullRenderPeakDbfs)||metrics.fullRenderPeakDbfs>=0||!Number.isFinite(metrics.peakDbfs)||metrics.peakDbfs>=0)
    throw new Error(`BLOCKED_STAGE3E_AMENDMENT_DIAGNOSTIC_SAFETY: invalid supplement ${cell.key}`);
  const original=(cell.side==='surrogate'?baseline.refRows:baseline.genRows).find(row=>row._sha256===cell.originalCellSha256);
  if(!original)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: original supplement cell missing');
  const difference=compareOriginalMetrics(original,record);
  if(cell.side==='surrogate'){
    const index=MIDI41.indexOf(cell.velocityNormalized);
    if(index<0||Math.abs(metrics.velocityDerivative-STAGE3A_DERIVATIVES[index])>TOLERANCE)throw new Error('BLOCKED_STAGE3E_AMENDMENT_SURROGATE_DERIVATIVE_MISMATCH');
  }
  return {originalMetricMaxDifference:difference};
}
function assertLedger(roots,ledger,auth,captureIdentity,authorizationSha256,captureIdentitySha256,baseline){
  if(!ledger||ledger.amendmentId!==AMENDMENT_ID||ledger.authorizationSha256!==authorizationSha256||ledger.captureIdentitySha256!==captureIdentitySha256||
     !same(ledger.identity,captureIdentity)||ledger.authorizedRenderCount!==auth.authorizedRenderCount||Object.keys(ledger.cells||{}).length!==auth.authorizedCells.length)
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: ledger binding mismatch');
  const pending=[],complete=[];
  for(const cell of auth.authorizedCells){const state=ledger.cells[cell.key];if(!state||!same(state.identity,cell)||state.relativePath!==`cells/${cell.key}.json`)throw new Error('BLOCKED_STAGE3E_AMENDMENT_RENDER_BUDGET');
    if(state.state==='IN_PROGRESS')throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: ambiguous IN_PROGRESS ${cell.key}`);
    if(state.state==='PENDING'){if(state.sha256!==null||fs.existsSync(path.join(roots.primary,state.relativePath))||fs.existsSync(path.join(roots.secondary,state.relativePath)))throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: pending cell has evidence ${cell.key}`);pending.push(cell);continue;}
    if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: invalid state ${cell.key}`);
    const stored=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(stored.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: completed hash mismatch ${cell.key}`);
    const record=JSON.parse(stored.bytes.toString('utf8'));
    if(record.captureIdentitySha256!==captureIdentitySha256)throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: capture identity mismatch ${cell.key}`);
    validateSupplementCell(cell,record,baseline);complete.push(cell);
  }
  if(ledger.accounting?.newRenderCalls!==complete.length||ledger.accounting.newRenderCalls>6)throw new Error('BLOCKED_STAGE3E_AMENDMENT_RENDER_BUDGET');
  const dir=path.join(roots.primary,'cells');if(fs.existsSync(dir)){const names=fs.readdirSync(dir).sort(),expected=complete.map(c=>path.basename(ledger.cells[c.key].relativePath)).sort();if(!same(names,expected))throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: extra or missing cell files');}
  return {pending,complete,counts:ledgerCounts(ledger)};
}
function loadOrCreateImmutable(roots,relative,value){const bytes=jsonBytes(value),a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative);
  if(fs.existsSync(a)||fs.existsSync(b)){if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: partial ${relative}`);const old=durable.verifyDualCopy(a,b);if(!old.bytes.equals(bytes))throw new Error(`BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: ${relative}`);return old;}
  return durable.writeDualCopy(a,b,bytes);
}
function initialize({root=ROOT,home=process.env.HOME,createRecords=true}={}){
  const audit=assertSourceAudit({root,home}),baseline=loadBaselineRows({root,home}),buildIdentity=currentBuildIdentities({root});
  const auth=makeAuthorization({audit,baseline,buildIdentity});
  const stored=(relative,value)=>{
    if(createRecords)return loadOrCreateImmutable(audit.roots,relative,value);
    return durable.verifyDualCopy(path.join(audit.roots.primary,relative),path.join(audit.roots.secondary,relative));
  };
  const authStored=stored('authorization.json',auth);if(!authStored.bytes.equals(jsonBytes(auth)))throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: authorization changed');
  const captureIdentity=makeCaptureIdentity({baseline,buildIdentity,authorizationSha256:authStored.sha256});
  const captureStored=stored('capture-identity.json',captureIdentity);if(!captureStored.bytes.equals(jsonBytes(captureIdentity)))throw new Error('BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION: capture identity changed');
  assertAuthorization(JSON.parse(authStored.bytes.toString('utf8')),exactSupplementIdentities(baseline));
  return {audit,baseline,buildIdentity,auth:JSON.parse(authStored.bytes.toString('utf8')),authorizationSha256:authStored.sha256,
    captureIdentity:JSON.parse(captureStored.bytes.toString('utf8')),captureIdentitySha256:captureStored.sha256,roots:audit.roots};
}
function loadLedgerOrCreate(ctx,{create=false,now}={}){
  const a=path.join(ctx.roots.primary,'ledger.json'),b=path.join(ctx.roots.secondary,'ledger.json');
  if(!fs.existsSync(a)&&!fs.existsSync(b)){if(!create)return null;const fresh=freshLedger(ctx.auth,ctx.authorizationSha256,ctx.captureIdentity,ctx.captureIdentitySha256,now);writeDualJson(ctx.roots,'ledger.json',fresh);return fresh;}
  if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: partial ledger');
  return readDualJson(ctx.roots,'ledger.json');
}
function withBuildDirectory(root,dir,callback){const prior=process.env.SORAOTO_WASM_BUILD_DIR;process.env.SORAOTO_WASM_BUILD_DIR=dir;try{return callback();}finally{if(prior===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=prior;}}
function renderSupplement(cell,{root=ROOT,captureGeneration2=capture3e.renderNormalized,captureSurrogate=capture3d.renderNormalized}={}){
  const options={includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,includeSoundboardDiagnostics:true};
  let captured;
  if(cell.side==='generation2')captured=withBuildDirectory(root,path.join(root,'build/wasm-stage3e'),()=>captureGeneration2(cell.pitch,cell.velocityNormalized,[1,1,1],options));
  else captured=withBuildDirectory(root,stage3dBuildRoot(root),()=>captureSurrogate(cell.pitch,cell.velocityNormalized,{},
    {...options,stage2mFactorMask:3,stage3dVariant:0}));
  if(!captured||captured.pitch!==41||captured.velocityNormalized!==cell.velocityNormalized||!captured.metrics)
    throw new Error(`BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: capture identity mismatch ${cell.key}`);
  return {pitch:41,velocityNormalized:cell.velocityNormalized,metrics:captured.metrics,stage2mFactorMask:captured.metrics.stage2mFactorMask,
    stage3dVariant:cell.side==='surrogate'?captured.metrics.stage3dVariant:undefined};
}
function execute({root=ROOT,home=process.env.HOME,captureCell=renderSupplement,identityCheck=assertCurrentCaptureIdentity,now=()=>new Date().toISOString()}={}){
  const ctx=initialize({root,home}),ledger=loadLedgerOrCreate(ctx,{create:true,now});let state=assertLedger(ctx.roots,ledger,ctx.auth,ctx.captureIdentity,ctx.authorizationSha256,ctx.captureIdentitySha256,ctx.baseline);
  let calls=0;
  for(const cell of state.pending){
    assertSourceAudit({root,home});assertImmutableIdentityFiles(ctx);identityCheck(ctx.captureIdentity,{root,baseline:ctx.baseline,authorizationSha256:ctx.authorizationSha256});
    assertWritable(ctx.roots);
    if(ledger.accounting.newRenderCalls>=ctx.auth.maxAdditionalAcousticCalls)throw new Error('BLOCKED_STAGE3E_AMENDMENT_RENDER_BUDGET');
    const slot=ledger.cells[cell.key];slot.state='IN_PROGRESS';slot.startedAt=now();writeDualJson(ctx.roots,'ledger.json',ledger);
    const capture=captureCell(cell,{root});
    ledger.accounting.newRenderCalls++;calls++;writeDualJson(ctx.roots,'ledger.json',ledger);
    const record={schemaVersion:1,amendmentId:AMENDMENT_ID,key:cell.key,side:cell.side,pitch:cell.pitch,velocityNormalized:cell.velocityNormalized,
      originalCellRelativePath:cell.originalCellRelativePath,originalCellSha256:cell.originalCellSha256,stage2mFactorMask:3,
      ...(cell.side==='surrogate'?{stage3dVariant:0}:{}),velocityDerivativeWindowMs:[30,180],metrics:capture.metrics,capturedAt:now(),captureIdentitySha256:ctx.captureIdentitySha256};
    validateSupplementCell(cell,record,ctx.baseline);
    const stored=durable.writeDualCopy(path.join(ctx.roots.primary,slot.relativePath),path.join(ctx.roots.secondary,slot.relativePath),jsonBytes(record));
    slot.state='COMPLETE';slot.sha256=stored.sha256;slot.completedAt=now();writeDualJson(ctx.roots,'ledger.json',ledger);
    state=assertLedger(ctx.roots,ledger,ctx.auth,ctx.captureIdentity,ctx.authorizationSha256,ctx.captureIdentitySha256,ctx.baseline);
  }
  assertSourceAudit({root,home});return {decision:'STAGE3E_MIDI41_AMENDMENT_CAPTURE_COMPLETE',builds:0,acousticRenders:calls,newAcousticCalls:ledger.accounting.newRenderCalls,
    authorizedRenderCount:ctx.auth.authorizedRenderCount,counts:state.counts,authorizedCells:ctx.auth.authorizedCells,authorizationSha256:ctx.authorizationSha256,
    originalEvidenceUnchanged:true,primarySecondaryHashesMatch:true};
}
function effectiveRows(ctx,ledger){
  const overlays=new Map();for(const [key,state] of Object.entries(ledger.cells)){if(state.state!=='COMPLETE')continue;const row=JSON.parse(durable.verifyDualCopy(path.join(ctx.roots.primary,state.relativePath),path.join(ctx.roots.secondary,state.relativePath)).bytes.toString('utf8'));overlays.set(row.side+':'+row.pitch+':'+row.velocityNormalized,row);}
  function overlay(rows,side){return rows.map(original=>{const supplement=overlays.get(side+':'+original.pitch+':'+original.velocityNormalized);if(!supplement)return original;
    if(Number.isFinite(original.metrics.velocityDerivative)||original.metrics.velocityDerivativeWindowMs!==undefined)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: duplicate derivative supplement');
    return {...original,metrics:{...original.metrics,velocityDerivative:supplement.metrics.velocityDerivative,velocityDerivativeWindowMs:[30,180]}};});}
  const referenceRows=overlay(ctx.baseline.referenceSet.rows,'surrogate');
  const effectiveReference={...ctx.baseline.referenceSet,rows:referenceRows};
  const genRows=overlay(ctx.baseline.genRows,'generation2').map(row=>({kind:row.kind,pitch:row.pitch,velocity:row.velocity,velocityNormalized:row.velocityNormalized,metrics:row.metrics}));
  return {effectiveReference,genRows};
}
function resultFromPersisted(ctx,ledger){
  const state=assertLedger(ctx.roots,ledger,ctx.auth,ctx.captureIdentity,ctx.authorizationSha256,ctx.captureIdentitySha256,ctx.baseline);
  if(state.pending.length||state.counts.IN_PROGRESS||state.counts.COMPLETE!==ctx.auth.authorizedRenderCount)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: not all authorized supplements COMPLETE');
  const effective=effectiveRows(ctx,ledger),comparison=core.validateBaselineRows(effective.effectiveReference,effective.genRows,{tolerance:TOLERANCE});
  if(!comparison.pass)throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: effective Generation-2 baseline did not pass 12/12');
  if(ctx.baseline.maxNonDerivativeDifference>TOLERANCE)throw new Error('BLOCKED_STAGE3E_AMENDMENT_ORIGINAL_METRICS_MISMATCH');
  return {schemaVersion:1,decision:'STAGE3E_GENERATION2_BASELINE_EQUIVALENT',amendmentId:AMENDMENT_ID,
    referenceSetId:'stage3e-baseline-surrogate-reference-v1',referenceSetSha256:ctx.baseline.referenceSetSha256,
    sourceEvidenceAuditSha256:ctx.audit.sha256,authorizationSha256:ctx.authorizationSha256,captureIdentitySha256:ctx.captureIdentitySha256,
    historicalGeneration2ManifestSha256:ctx.baseline.generation2ManifestSha256,historicalGeneration2BaselineLedgerSha256:GENERATION2_LEDGER_SHA256,
    historicalCaptureIdentity:ctx.baseline.historicalCaptureIdentity,amendmentCaptureIdentity:ctx.captureIdentity.amendmentCaptureIdentity,
    originalSurrogateRows:12,originalGeneration2Rows:12,supplementAuthorized:ctx.auth.authorizedRenderCount,
    supplementActual:ledger.accounting.newRenderCalls,supplements:ctx.auth.authorizedCells.map(cell=>({key:cell.key,side:cell.side,
      velocityNormalized:cell.velocityNormalized,sha256:ledger.cells[cell.key].sha256})),
    maxNonDerivativeMetricDifference:ctx.baseline.maxNonDerivativeDifference,effectiveBaseline:comparison,
    effectivePassCount:comparison.cells.filter(cell=>cell.pass).length,effectiveCellCount:comparison.cellCount,
    tolerance:TOLERANCE,originalEvidenceMutationCount:0,productionCandidateDelta:0,stage3Calls:0,stage4Calls:0};
}
function verifyFinalized(ctx){
  assertSourceAudit({root:ctx.root,home:ctx.home});
  const resultBytes=durable.verifyDualCopy(path.join(ctx.roots.primary,'amendment-result.json'),path.join(ctx.roots.secondary,'amendment-result.json'));
  const manifestBytes=durable.verifyDualCopy(path.join(ctx.roots.primary,'evidence-manifest.json'),path.join(ctx.roots.secondary,'evidence-manifest.json'));
  const hashBytes=durable.verifyDualCopy(path.join(ctx.roots.primary,'evidence-manifest.sha256'),path.join(ctx.roots.secondary,'evidence-manifest.sha256'));
  if(hashBytes.bytes.toString('utf8')!==manifestBytes.sha256+'\n')throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: manifest SHA mismatch');
  const manifest=JSON.parse(manifestBytes.bytes.toString('utf8')),result=JSON.parse(resultBytes.bytes.toString('utf8'));
  const inventory=durable.assertMatchingInventory(ctx.roots.primary,ctx.roots.secondary);
  if(!same(manifest.files,inventory)||manifest.decision!==result.decision||result.decision!=='STAGE3E_GENERATION2_BASELINE_EQUIVALENT'||
     result.sourceEvidenceAuditSha256!==SOURCE_AUDIT_SHA256||result.referenceSetSha256!==REFERENCE_SHA256||
     manifest.amendmentResultSha256!==resultBytes.sha256||result.authorizationSha256!==ctx.authorizationSha256||result.captureIdentitySha256!==ctx.captureIdentitySha256)
    throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: finalized identity/inventory mismatch');
  const archive=durable.verifyDualCopy(path.join(ctx.roots.primary,'archives/midi41-derivative-amendment.tar.gz'),path.join(ctx.roots.secondary,'archives/midi41-derivative-amendment.tar.gz'));
  return {result,resultSha256:resultBytes.sha256,manifestSha256:manifestBytes.sha256,archiveSha256:archive.sha256,inventoryCount:inventory.length};
}
function finalize({root=ROOT,home=process.env.HOME,now=()=>new Date().toISOString()}={}){
  const ctx=initialize({root,home,createRecords:false}),ledger=loadLedgerOrCreate(ctx,{create:false});if(!ledger)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: ledger missing');
  assertCurrentCaptureIdentity(ctx.captureIdentity,{root,baseline:ctx.baseline,authorizationSha256:ctx.authorizationSha256});
  if(fs.existsSync(path.join(ctx.roots.primary,'amendment-result.json'))||fs.existsSync(path.join(ctx.roots.secondary,'amendment-result.json'))){
    const finalized=verifyFinalized(ctx);return {...finalized,acousticRenders:0,immutableReplay:true};
  }
  const result=resultFromPersisted(ctx,ledger),stored=immutableDualJson(ctx.roots,'amendment-result.json',result);
  ledger.decision=result.decision;ledger.finalizedAt=now();writeDualJson(ctx.roots,'ledger.json',ledger);
  const manifest=durable.writeFinalizedManifest({primaryRoot:ctx.roots.primary,secondaryRoot:ctx.roots.secondary,
    metadata:{creatorRevision:ctx.captureIdentity.executionSourceRevision,executionId:AMENDMENT_ID,generation:2,runnerSha256:ctx.captureIdentity.amendmentCaptureIdentity.amendmentRunnerSha256,
      helperSha256:ctx.captureIdentity.amendmentCaptureIdentity.stage3eCaptureHelperSha256,wasmSha256:ctx.captureIdentity.buildIdentity.stage3eWasmSha256,
      startedAt:ledger.startedAt,finalizedAt:now(),decision:result.decision,amendmentResultSha256:stored.sha256,sourceEvidenceAuditSha256:SOURCE_AUDIT_SHA256,
      historicalReferenceSha256:REFERENCE_SHA256,historicalGeneration2ManifestSha256:ctx.baseline.generation2ManifestSha256}});
  const archive=durable.createPhaseArchive({primaryRoot:ctx.roots.primary,secondaryRoot:ctx.roots.secondary,phase:'midi41-derivative-amendment'});
  assertSourceAudit({root,home});
  return {decision:result.decision,builds:0,acousticRenders:0,newAcousticCalls:ledger.accounting.newRenderCalls,
    authorizedRenderCount:ctx.auth.authorizedRenderCount,counts:ledgerCounts(ledger),resultSha256:stored.sha256,manifestSha256:manifest.sha256,archiveSha256:archive.sha256,
    maxMetricDifference:result.effectiveBaseline.maximumDifference,originalEvidenceUnchanged:true};
}
function verify({root=ROOT,home=process.env.HOME}={}){
  const ctx=initialize({root,home,createRecords:false}),ledger=loadLedgerOrCreate(ctx,{create:false});if(!ledger)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: ledger missing');
  assertCurrentCaptureIdentity(ctx.captureIdentity,{root,baseline:ctx.baseline,authorizationSha256:ctx.authorizationSha256});
  assertLedger(ctx.roots,ledger,ctx.auth,ctx.captureIdentity,ctx.authorizationSha256,ctx.captureIdentitySha256,ctx.baseline);
  const finalized=verifyFinalized(ctx);return {...finalized,builds:0,acousticRenders:0,evidenceWrites:0,originalEvidenceUnchanged:true};
}
function dryRun({root=ROOT,home=process.env.HOME,now}={}){
  const ctx=initialize({root,home}),ledger=loadLedgerOrCreate(ctx,{create:false});
  if(ledger)assertLedger(ctx.roots,ledger,ctx.auth,ctx.captureIdentity,ctx.authorizationSha256,ctx.captureIdentitySha256,ctx.baseline);
  return {decision:'STAGE3E_MIDI41_AMENDMENT_READY',builds:0,acousticRenders:0,authorizedCells:ctx.auth.authorizedCells,
    authorizedRenderCount:ctx.auth.authorizedRenderCount,completed:ledger?ledgerCounts(ledger).COMPLETE:0,
    originalEvidenceUnchanged:true,sourceAuditSha256:ctx.audit.sha256,authorizationSha256:ctx.authorizationSha256,
    captureIdentitySha256:ctx.captureIdentitySha256,nonDerivativeMetricRows:12,maxNonDerivativeDifference:ctx.baseline.maxNonDerivativeDifference};
}
function run({mode,...options}={}){
  if(mode==='--dry-run')return dryRun(options);if(mode==='--execute')return execute(options);if(mode==='--finalize')return finalize(options);if(mode==='--verify')return verify(options);
  throw new Error('explicit mode required: --dry-run, --execute, --finalize, or --verify');
}
function main(argv=process.argv.slice(2)){if(argv.length!==1)throw new Error('one explicit mode required');const result=run({mode:argv[0]});process.stdout.write(JSON.stringify(result)+'\n');}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,EXECUTION_ID,AMENDMENT_ID,AMENDMENT_RELATIVE,SOURCE_AUDIT_SHA256,REFERENCE_SHA256,REFERENCE_MANIFEST_SHA256,GENERATION2_LEDGER_SHA256,
  STAGE3D_WASM_SHA256,STAGE3E_WASM_SHA256,FIXED,STAGE3A_DERIVATIVES,MIDI41,TOLERANCE,sha256,fileSha,jsonBytes,stable,same,
  stage3eRoots,amendmentRoots,generation2Roots,surrogateRoots,stage3dBuildRoot,assertSourceAudit,fileInventory,rowKey,missingDerivative,loadBaselineRows,
  exactSupplementIdentities,currentBuildIdentities,makeAuthorization,makeCaptureIdentity,assertCurrentCaptureIdentity,assertAuthorization,
  freshLedger,ledgerCounts,compareOriginalMetrics,validateSupplementCell,assertLedger,loadOrCreateImmutable,initialize,loadLedgerOrCreate,
  renderSupplement,effectiveRows,resultFromPersisted,verifyFinalized,dryRun,execute,finalize,verify,run,main};
