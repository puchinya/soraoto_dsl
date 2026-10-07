#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const capture=require('./capture-supersynth-stage3d-matrix.cjs');
const stage3b=require('./run-stage3b-contact-attribution.cjs');
const stage3c=require('./run-stage3c-impedance-split-diagnostic.cjs');
const directMetrics=require('./stage3-direct-reference-metrics.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const CANDIDATE='stage2n-r3-candidate-01';
const START_HEAD='4821d5eb2e4657fc303793dfcc3ad94ed908c47b';
const TOL=1e-6, MASKS=[1,2,3], VELOCITIES=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const VERIFIER_ONLY_FIELDS=Object.freeze(['sourceRevision','runnerSha256','stage3dCaptureEvaluatorSha256']);
const CORRECTION_VERIFIER_FIELD_MAP=Object.freeze({sourceRevision:['executionSourceRevision','executionSourceRevision'],
  runnerSha256:['stage3dRunnerSha256','stage3dRunnerSha256'],
  stage3dCaptureEvaluatorSha256:['stage3dDedicatedCaptureHelperSha256','stage3dDedicatedCaptureHelperSha256']});
const DYNAMIC=[48,51,54,57], TREBLE=[93,96,99], TRANSITION=[49,50,55,56], NORM=[.25,.55,.9];
const EQUIVALENCE_COORDS=[{kind:'dynamic',pitch:36,velocity:124},{kind:'dynamic',pitch:39,velocity:124},
  {kind:'dynamic',pitch:45,velocity:69},{kind:'dynamic',pitch:48,velocity:69},{kind:'dynamic',pitch:51,velocity:14},
  {kind:'dynamic',pitch:51,velocity:124},{kind:'dynamic',pitch:54,velocity:124},{kind:'dynamic',pitch:57,velocity:124},
  {kind:'dynamic',pitch:96,velocity:31},{kind:'midi41',pitch:41,velocity:null,velocityNormalized:.25}];
const EQUIVALENCE_CELLS=EQUIVALENCE_COORDS.map(cell=>({...cell,stage3dVariant:0}));
const CORRECTION_COORDS=EQUIVALENCE_COORDS.slice(0,9);
const CORRECTION_CELLS=CORRECTION_COORDS.map(cell=>({...cell,stage3dVariant:0,velocityDerivativeStartMs:0,velocityDerivativeEndMs:160}));
const SELECTION_CELLS=[
  ...DYNAMIC.flatMap(pitch=>VELOCITIES.flatMap(velocity=>MASKS.map(stage3dVariant=>({kind:'dynamic',pitch,velocity,stage3dVariant})))),
  ...TREBLE.flatMap(pitch=>[14,31,61,124].flatMap(velocity=>MASKS.map(stage3dVariant=>({kind:'treble',pitch,velocity,stage3dVariant})))),
  ...NORM.flatMap(velocityNormalized=>MASKS.map(stage3dVariant=>({kind:'midi41',pitch:41,velocity:null,velocityNormalized,stage3dVariant}))),
  ...TRANSITION.flatMap(pitch=>[14,124].flatMap(velocity=>MASKS.map(stage3dVariant=>({kind:'transition',pitch,velocity,stage3dVariant}))))
] .map(cell=>({...cell,velocityDerivativeStartMs:derivativeWindow(cell)[0],velocityDerivativeEndMs:derivativeWindow(cell)[1]}));
function derivativeWindow(cell){
  if(cell.pitch===48||cell.pitch===57||cell.pitch>=93)return [0,160];
  return [30,180];
}
const DIAGNOSTIC_SIGNALS=stage3c.DIAGNOSTIC_SIGNALS;
const HAMMER_FIELDS=stage3c.HAMMER_FIELDS;
const EXPECTED={
  productionWasm:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  stage3aWasm:'59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3',
  stage3bWasm:'2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9',
  stage3cWasm:'387c12fa16f684435f904a9c18c063099141332b53b28cd5cbd35bca15482235',
  historicalPluginSource:'8368f8af3deb17fb24dc6611ec7ec5e01f23df569240086e4d3fa8c91a0e1ae4',
  historicalPluginCmake:'32ccc9905d2fa5dbe76dbf3838d5d04907a36c5fac7ec5ef26cdc6d7766ee797',
  config:'792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d',
  profile:'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66',
  presets:'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431',
  fixture:'5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7',
  stage3cResult:'1a6f5c251ae06379b199bee7aebb08774412d2f388443837a66fbefec1e63737',
  stage3dCorrectedEquivalenceResult:'153a8b7265ae1a4e5d8a79fce5af87611602315b6d3affc345eb3aec74a7050a',
  stage3dSelectionFinalLedger:'70f1f2311c09adcd79e2be48ae9b1d6af4ae094912bf29e5eecc3d555ad15914',
  stage3dSelectionResult:'a331b4785d7d554c7aaf0c0b688ee3f28c217a1ffa5f69784683a2dd337f1b3c',
  preflight:'f69e8adf900db451bc91c48928f914dc8b7da28b732e533f1742d5b49d9ce1dc',
  stage3aLedger:'e43d6d1b88f57766d0c48e413801916b313580cec83d629b54835be0f23060e9',
  stage3aFinal:'e953ba33a363f378a006aafcbe4066cb1b05d69ac42ca1f401cd68d7e7261cd4',
  stage3aSupplement:'91b6b4df895a2a044135752156b88d1ab04806f02ebd338a8518f703e29c1713'
};
const STAGE3D_ROOT=path.join(ROOT,'.agent-state/issues/7/stage3d');

function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeAtomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});fs.renameSync(temp,file);}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function compareStrictCoreIdentity(persisted,current,fieldMap=Object.fromEntries(VERIFIER_ONLY_FIELDS.map(field=>[field,[field,field]]))){
  const persistedSkip=new Set(Object.values(fieldMap).map(fields=>fields[0])),currentSkip=new Set(Object.values(fieldMap).map(fields=>fields[1]));
  const historicalCore=Object.fromEntries(Object.entries(persisted||{}).filter(([field])=>!persistedSkip.has(field)));
  const currentCore=Object.fromEntries(Object.entries(current||{}).filter(([field])=>!currentSkip.has(field)));
  if(!same(historicalCore,currentCore)){
    const fields=[...new Set([...Object.keys(historicalCore),...Object.keys(currentCore)])].filter(field=>!same(historicalCore[field],currentCore[field]));
    throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: strict-core mismatch ${fields.join(',')}`);
  }
  return Object.fromEntries(VERIFIER_ONLY_FIELDS.map(field=>{const [historicalField,currentField]=fieldMap[field];
    return [field,{historical:persisted?.[historicalField]??null,current:current?.[currentField]??null}];}));
}
function currentHead(root=ROOT){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function paths(root=ROOT){const base=path.join(root,'.agent-state/issues/7/stage3d');return {
  root:base,identity:path.join(base,'build-identity.json'),eqDir:path.join(base,'equivalence'),
  eqLedger:path.join(base,'equivalence/ledger.json'),eqCells:path.join(base,'equivalence/cells'),eqResult:path.join(base,'equivalence.json'),
  correctionDir:path.join(base,'equivalence-correction'),correctionIdentity:path.join(base,'equivalence-correction/identity.json'),
  correctionLedger:path.join(base,'equivalence-correction/ledger.json'),correctionCells:path.join(base,'equivalence-correction/cells'),
  correctionResult:path.join(base,'equivalence-correction/corrected-equivalence.json'),
  selDir:path.join(base,'selection'),selLedger:path.join(base,'selection/ledger.json'),selCells:path.join(base,'selection/cells'),
  aggregates:path.join(base,'selection/aggregates'),selResult:path.join(base,'selection-result.json')};}
function hasAcousticEvidence(p){
  if([p.eqLedger,p.eqResult,p.correctionLedger,p.correctionResult,p.selLedger,p.selResult].some(file=>fs.existsSync(file)))return true;
  return [p.eqCells,p.correctionCells,p.selCells,p.aggregates].some(dir=>fs.existsSync(dir)&&fs.readdirSync(dir).length>0);
}
function key(cell){const vel=cell.velocity===null?`n${String(Math.round(cell.velocityNormalized*100)).padStart(2,'0')}`:`v${String(cell.velocity).padStart(3,'0')}`;
  return `${cell.kind}:variant-${cell.stage3dVariant}:midi-${String(cell.pitch).padStart(3,'0')}:${vel}`;}
function fileName(cell){const vel=cell.velocity===null?`normalized-${String(Math.round(cell.velocityNormalized*100)).padStart(2,'0')}`:`velocity-${String(cell.velocity).padStart(3,'0')}`;
  return `midi-${String(cell.pitch).padStart(3,'0')}-${vel}-variant-${cell.stage3dVariant}.json`;}
function eqFile(cell,p){return path.join(p.eqCells,fileName(cell));}
function selectionFile(cell,p){return path.join(p.selCells,`variant-${cell.stage3dVariant}`,fileName(cell));}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(s=>[s,Object.values(ledger.cells||{}).filter(x=>x.state===s).length]));}
function assertAuthorized(cells,expected,label){if(cells.length!==expected.length||new Set(cells.map(key)).size!==expected.length||!same(cells,expected))
  throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: ${label} authorization mismatch`);return cells;}
function buildRoot(root=ROOT){const val=process.env.SORAOTO_WASM_BUILD_DIR?path.resolve(process.env.SORAOTO_WASM_BUILD_DIR):path.join(root,'build/wasm-stage3d');
  if(val!==path.join(root,'build/wasm-stage3d'))throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: use build/wasm-stage3d');return val;}
function exportsOf(file){return new Set(WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(file))).map(x=>x.name));}
function assertAncestor(root=ROOT){try{execFileSync('rtk',['git','merge-base','--is-ancestor',START_HEAD,currentHead(root)],{cwd:root,stdio:'ignore'});}
  catch{throw new Error(`BLOCKED_STAGE3D_BASELINE_IDENTITY: HEAD is not descended from ${START_HEAD}`);}}
function buildIdentity(root=ROOT){
  assertAncestor(root);
  const authoritative=stage3b.assertAuthoritativeProductionIdentity(root);
  const expectedIdentity={productionWasmSha256:EXPECTED.productionWasm,configSha256:EXPECTED.config,profileSha256:EXPECTED.profile,
    presetsSha256:EXPECTED.presets,referenceFixtureSha256:EXPECTED.fixture};
  for(const [name,value] of Object.entries(expectedIdentity))if(authoritative.hashes[name]!==value)
    throw new Error(`BLOCKED_STAGE3D_BASELINE_IDENTITY: fixed ${name} changed`);
  const preflightFile=path.join(root,'.agent-state/issues/7/stage3b/preflight-provenance.json');
  if(!fs.existsSync(preflightFile)||sha(preflightFile)!==EXPECTED.preflight)throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: preflight evidence changed');
  const preflight=readJson(preflightFile);if(preflight.classification!=='SUFFICIENT_METADATA_PROVENANCE')throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: provenance classification changed');
  if(preflight.preflightReady!==true||preflight.preflightResult?.decision!=='STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE'
      ||preflight.preflightResult?.checks?.stage3bDiagnosticBuild?.hashes?.stage3bWasmSha256!==EXPECTED.stage3bWasm)
    throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: persisted accepted Stage3B preflight is incomplete');
  const stage3a=stage3b.assertStage3AEvidenceIdentity(root);
  const stage3aHashes={ledger:stage3a.identity?.stage3aLedgerSha256,final:stage3a.identity?.stage3aFinalSha256,supplement:stage3a.identity?.stage3aSupplementSha256};
  if(!same(stage3aHashes,{ledger:EXPECTED.stage3aLedger,final:EXPECTED.stage3aFinal,supplement:EXPECTED.stage3aSupplement}))
    throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3A evidence hashes changed');
  const stage3cFile=path.join(root,'.agent-state/issues/7/stage3c/continuation/split-attribution.json');
  if(!fs.existsSync(stage3cFile)||sha(stage3cFile)!==EXPECTED.stage3cResult||readJson(stage3cFile).decision!=='STAGE3C_SPLIT_ATTRIBUTION_COMPLETE')
    throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3C authoritative result changed');
  const prod=path.join(root,'build/wasm/plugins/dsp/super-synth/plugin.wasm');
  const wasm=path.join(buildRoot(root),'plugins/dsp/super-synth/plugin.wasm'),cacheFile=path.join(buildRoot(root),'CMakeCache.txt');
  if(!fs.existsSync(prod)||sha(prod)!==EXPECTED.productionWasm||!fs.existsSync(wasm)||!fs.existsSync(cacheFile))
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: production or Stage3D artifact missing/changed');
  const cache=fs.readFileSync(cacheFile,'utf8');
  for(const flag of ['SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:BOOL=ON','SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:BOOL=ON',
    'SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:BOOL=OFF','SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:BOOL=OFF','SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS:BOOL=ON'])
    if(!cache.includes(flag))throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: missing cache flag ${flag}`);
  const exp=exportsOf(wasm);for(const name of ['soraoto_supersynth_stage3d_set_variant','soraoto_supersynth_stage3d_get_variant'])if(!exp.has(name))
    throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: missing ${name}`);
  for(const name of ['soraoto_supersynth_stage3b_set_variant_mask','soraoto_supersynth_stage3c_set_variant_mask'])if(exp.has(name))
    throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: mutually exclusive export present ${name}`);
  const stage3cWasm=path.join(root,'build/wasm-stage3c/plugins/dsp/super-synth/plugin.wasm');
  if(!fs.existsSync(stage3cWasm)||sha(stage3cWasm)!==EXPECTED.stage3cWasm)throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3C diagnostic WASM changed');
  const historicalPlugin=path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c');
  const historicalCmake=path.join(root,'wasm/cmake/wasm_plugin.cmake');
  if(sha(historicalPlugin)!==EXPECTED.historicalPluginSource||sha(historicalCmake)!==EXPECTED.historicalPluginCmake)
    throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3C-pinned plugin source or CMake helper changed');
  const stage3dPlugin=path.join(root,'wasm/plugins/dsp/super-synth/src/plugin_stage3d.c');
  if(!fs.existsSync(stage3dPlugin))throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: isolated Stage3D source missing');
  const stage3dCmake=path.join(root,'wasm/CMakeLists.txt');
  const historicalCaptureFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
  if(sha(historicalCaptureFile)!=='780087c6fd91cc431127e740f909f4c62202f46c21e0bb788856d999093064d8')
    throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3C historical capture evaluator changed');
  const captureFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3d-matrix.cjs');
  if(!fs.existsSync(captureFile))throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: Stage3D capture evaluator missing');
  const runnerFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3d-localized-contact-transformer.cjs');
  const directCapture=path.join(root,'.agent-state/issues/7/calibration-optuna/stage3/direct-capture.json');
  const directEval=path.join(root,'.agent-state/issues/7/calibration-optuna/stage3/direct-evaluation.json');
  if(!fs.existsSync(directCapture)||!fs.existsSync(directEval))throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3 direct-reference evidence missing');
  const stage3Capture=readJson(directCapture),stage3Evaluation=readJson(directEval);
  if(stage3Capture.render?.wasmSha256!==EXPECTED.productionWasm||stage3Capture.matrix?.length!==480
      ||stage3Evaluation.coverage?.captured!==480||stage3Evaluation.coverage?.unique!==480
      ||stage3Evaluation.identity?.wasmSha256!==EXPECTED.productionWasm||stage3Evaluation.identity?.candidateId!==CANDIDATE
      ||stage3Evaluation.identity?.candidateDelta!==0)
    throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3 direct-reference evidence is not the accepted fixed baseline');
  const productionExports=exportsOf(prod);if(productionExports.has('soraoto_supersynth_stage3d_set_variant')||productionExports.has('soraoto_supersynth_stage3d_get_variant'))
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: ordinary production unexpectedly exports Stage3D controls');
  return {schemaVersion:1,candidateId:CANDIDATE,sourceRevision:currentHead(root),productionSimd:true,
    productionWasmSha256:sha(prod),stage3aDiagnosticWasmSha256:EXPECTED.stage3aWasm,stage3bDiagnosticWasmSha256:EXPECTED.stage3bWasm,
    stage3cDiagnosticWasmSha256:EXPECTED.stage3cWasm,stage3cResultSha256:sha(stage3cFile),stage3dDiagnosticWasmSha256:sha(wasm),
    pluginSourceSha256:sha(historicalPlugin),cmakeSourceSha256:sha(historicalCmake),
    stage3dPluginSourceSha256:sha(stage3dPlugin),stage3dCmakeSourceSha256:sha(stage3dCmake),
    stage3cCaptureEvaluatorSha256:sha(historicalCaptureFile),stage3dCaptureEvaluatorSha256:sha(captureFile),runnerSha256:sha(runnerFile),
    configSha256:authoritative.hashes.configSha256,profileSha256:authoritative.hashes.profileSha256,presetsSha256:authoritative.hashes.presetsSha256,
    referenceFixtureSha256:authoritative.hashes.referenceFixtureSha256,preflightProvenanceSha256:sha(preflightFile),
    stage3aEvidenceSha256:stage3aHashes,directCaptureSha256:sha(directCapture),directEvaluationSha256:sha(directEval),
    cmakeCacheSha256:sha(cacheFile),buildRoot:buildRoot(root),authorizedEquivalenceRenders:10,authorizedSelectionRenders:261};
}
function ensureBuildIdentity(root=ROOT,{write=false}={}){const p=paths(root),now=buildIdentity(root);
  if(fs.existsSync(p.identity)&&!same(readJson(p.identity),now)){
    const prior=readJson(p.identity);
    if(hasAcousticEvidence(p)){
      compareStrictCoreIdentity(prior,now);
      return now;
    }
    if(!write)throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: persisted identity changed');
    const priorSha=sha(p.identity),archive=path.join(p.root,`build-identity-superseded-${priorSha.slice(0,12)}.json`);
    if(fs.existsSync(archive)){if(sha(archive)!==priorSha)throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: prior dry-run identity archive mismatch');}
    else fs.copyFileSync(p.identity,archive,fs.constants.COPYFILE_EXCL);
    writeAtomic(p.identity,now);
  } else if(!fs.existsSync(p.identity)){if(write)writeAtomic(p.identity,now);else throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: build identity not persisted');}
  return now;}
function baselineInputs(root=ROOT){const base=stage3b.loadStage3ABaseline(root),supp=base.supplement;
  return {baseline:base.baseline,supplement:supp};}
function referenceRow(cell,inputs){if(cell.kind==='midi41')return inputs.supplement.rows.find(row=>row.pitch===41&&row.velocityNormalized===cell.velocityNormalized);
  return inputs.baseline.get(`${cell.pitch}:${cell.velocity}`);}
function captureCell(cell){const options={stage2mFactorMask:3,stage3dVariant:cell.stage3dVariant,includeSoundboardDiagnostics:true,
  includeVelocityDerivative:true,velocityDerivativeStartMs:cell.velocityDerivativeStartMs,velocityDerivativeEndMs:cell.velocityDerivativeEndMs};
  const metrics=cell.velocity===null?capture.renderNormalized(cell.pitch,cell.velocityNormalized,{},options):capture.render(cell.pitch,cell.velocity,{},options);
  if(metrics.stage3dVariant!==cell.stage3dVariant||metrics.stage2mFactorMask!==3||metrics.outputGuardHits===null)
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: capture omitted/misreported Stage3D or Stage2M mask');
  return metrics;}
function makeLedger(identity,cells,phase){assertAuthorized(cells,phase==='equivalence'?EQUIVALENCE_CELLS:SELECTION_CELLS,phase);
  return {schemaVersion:1,phase,candidateId:CANDIDATE,identity,identitySha256:digest(identity),authorizedRenderCount:cells.length,
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),cells:Object.fromEntries(cells.map(cell=>[key(cell),
      {identity:cell,state:'PENDING',path:null,sha256:null}])),accounting:{newRenderCalls:0,productionCandidateDelta:0,stage4Renders:0}};}
function ledgerPaths(p,phase){return phase==='equivalence'?{ledger:p.eqLedger,dir:p.eqDir,cells:p.eqCells}:{ledger:p.selLedger,dir:p.selDir,cells:p.selCells};}
function loadLedger(p,identity,phase,{create=false}={}){const cells=phase==='equivalence'?EQUIVALENCE_CELLS:SELECTION_CELLS,pp=ledgerPaths(p,phase);
  assertAuthorized(cells,cells,phase);
  if(!fs.existsSync(pp.ledger)){if(!create)throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: missing ${phase} ledger`);const l=makeLedger(identity,cells,phase);writeAtomic(pp.ledger,l);return l;}
  const ledger=readJson(pp.ledger);if(ledger.phase!==phase||ledger.identitySha256!==digest(identity)||!same(ledger.identity,identity)||ledger.authorizedRenderCount!==cells.length
    ||Object.keys(ledger.cells||{}).length!==cells.length||cells.some(c=>!ledger.cells[key(c)]||!same(ledger.cells[key(c)].identity,c)))
    throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: ${phase} ledger identity/authorization mismatch`);
  return ledger;}
function validateCellRow(row,cell,identity){if(!same(row.identity,identity)||!same(row.cell,cell)||row.candidateId!==CANDIDATE||!row.metrics
  ||row.metrics.stage3dVariant!==cell.stage3dVariant||row.metrics.stage2mFactorMask!==3
  ||(cell.velocityDerivativeStartMs!==undefined&&!same(row.metrics.velocityDerivativeWindowMs,[cell.velocityDerivativeStartMs,cell.velocityDerivativeEndMs])))
  throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: cell identity/window mismatch ${key(cell)}`);
  const m=row.metrics;if(typeof m.finite!=='boolean'||!Number.isFinite(m.peakDbfs)||!Number.isFinite(m.fullRenderPeakDbfs)||!Number.isInteger(m.outputGuardHits))
    throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: required metric missing ${key(cell)}`);
  return row;}
function loadCell(pp,ledger,cell,identity){const e=ledger.cells[key(cell)],file=typeof e?.path==='string'?path.join(pp.dir,e.path):null;
  if(e?.state!=='COMPLETE'||!file||!fs.existsSync(file)||!fs.statSync(file).isFile()||sha(file)!==e.sha256)
  throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: complete cell absent/corrupt ${key(cell)}`);return validateCellRow(readJson(file),cell,identity);}
function inspectLedger(p,identity,phase){const cells=phase==='equivalence'?EQUIVALENCE_CELLS:SELECTION_CELLS,pp=ledgerPaths(p,phase),ledger=loadLedger(p,identity,phase);
  if(ledger.status==='BLOCKED')throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: ledger blocked (${ledger.lastError||'unknown'})`);
  const c=counts(ledger);if(c.IN_PROGRESS){const id=Object.keys(ledger.cells).find(k=>ledger.cells[k].state==='IN_PROGRESS');throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: ambiguous IN_PROGRESS ${id}`);}
  if(ledger.accounting?.newRenderCalls!==c.COMPLETE||ledger.accounting.newRenderCalls>cells.length)throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: ledger render accounting mismatch');
  for(const cell of cells)if(ledger.cells[key(cell)].state==='COMPLETE')loadCell(pp,ledger,cell,identity);return {ledger,counts:c,pp};}
function loadEquivalence(root,p,identity,inputs){if(!fs.existsSync(p.eqResult))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE: required variant-0 equivalence is absent');
  const result=readJson(p.eqResult);if(result.decision!=='STAGE3D_EQUIVALENCE_COMPLETE'||result.identitySha256!==digest(identity)||result.completedCellCount!==10
    ||result.maxMetricDifference>TOL||!result.rows?.every(r=>r.result==='PASS'))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE: variant-0 equivalence did not pass');
  const state=inspectLedger(p,identity,'equivalence');if(state.counts.COMPLETE!==10)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE: equivalence ledger incomplete');
  return result;}
function loadHistoricalEquivalence(root=ROOT,p=paths(root),inputs=baselineInputs(root)){
  if(!fs.existsSync(p.eqLedger)||!fs.existsSync(p.eqResult))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE: original historical evidence is absent');
  const ledger=readJson(p.eqLedger),result=readJson(p.eqResult),identity=ledger.identity;
  if(ledger.phase!=='equivalence'||ledger.authorizedRenderCount!==10||ledger.accounting?.newRenderCalls!==10
      ||result.decision!=='BLOCKED_STAGE3D_EQUIVALENCE'||result.completedCellCount!==10||result.identitySha256!==digest(identity))
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: historical equivalence identity/state changed');
  const pp=ledgerPaths(p,'equivalence'),c=counts(ledger);
  if(c.COMPLETE!==10||c.PENDING||c.IN_PROGRESS)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: historical equivalence is not 10 COMPLETE');
  const rows=EQUIVALENCE_CELLS.map(cell=>loadCell(pp,ledger,cell,identity));
  const byKey=new Map((result.rows||[]).map(row=>[key(row.cell),row]));
  let ordinaryFailures=0,midi41Pass=0;
  for(const cell of EQUIVALENCE_CELLS){const row=rows.find(r=>same(r.cell,cell)),midi=cell.kind==='midi41';
    if(!safety(row.metrics).pass)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: historical safety failure');
    const decision=byKey.get(key(cell));
    const rowWindow=row.metrics.velocityDerivativeWindowMs,ref=referenceRow(cell,inputs)?.metrics?.velocityDerivativeWindowMs;
    if(midi){const cmp=compareEquivalence(cell,row,inputs);if(!same(rowWindow,[30,180])||!same(ref,[30,180])||!cmp.pass||decision?.result!=='PASS')throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: historical MIDI41 pass changed');midi41Pass++;}
    else {if(!same(rowWindow,[30,180])||!same(ref,[0,160])||decision?.result!=='FAIL'||!String(decision.error||'').includes('velocityDerivativeWindowMs'))
        throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: ordinary mismatch topology changed');ordinaryFailures++;}
  }
  if(ordinaryFailures!==9||midi41Pass!==1)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: expected nine ordinary failures and one MIDI41 pass');
  const cellShas=Object.fromEntries(EQUIVALENCE_CELLS.map(cell=>[key(cell),sha(eqFile(cell,p))]));
  return {ledger,result,identity,rows,cellShas,ledgerSha256:sha(p.eqLedger),resultSha256:sha(p.eqResult),identitySha256:digest(identity)};
}
function correctionIdentity(identity,historical){return {schemaVersion:1,candidateId:CANDIDATE,executionSourceRevision:identity.sourceRevision,
  isolatedBuildIdentitySha256:digest({wasm:identity.stage3dDiagnosticWasmSha256,source:identity.stage3dPluginSourceSha256,
    cmake:identity.stage3dCmakeSourceSha256,cache:identity.cmakeCacheSha256,buildRoot:identity.buildRoot}),
  stage3dDiagnosticWasmSha256:identity.stage3dDiagnosticWasmSha256,stage3dGeneratedDiagnosticSourceSha256:identity.stage3dPluginSourceSha256,
  stage3dDedicatedCaptureHelperSha256:identity.stage3dCaptureEvaluatorSha256,stage3dRunnerSha256:identity.runnerSha256,
  originalEquivalenceLedgerSha256:historical.ledgerSha256,originalBlockedResultSha256:historical.resultSha256,
  stage3aRecoveryLedgerSha256:identity.stage3aEvidenceSha256.ledger,stage3aRecoveryFinalSha256:identity.stage3aEvidenceSha256.final,
  stage3aSupplementSha256:identity.stage3aEvidenceSha256.supplement,stage3cAuthoritativeResultSha256:identity.stage3cResultSha256,
  productionWasmSha256:identity.productionWasmSha256,configSha256:identity.configSha256,profileSha256:identity.profileSha256,
  presetsSha256:identity.presetsSha256,referenceFixtureSha256:identity.referenceFixtureSha256,
  historicalMIDI41CellSha256:historical.cellShas[key(EQUIVALENCE_CELLS[9])]};}
function loadCorrectionLedger(p,identity,{create=false}={}){
  assertAuthorized(CORRECTION_CELLS,CORRECTION_CELLS,'equivalence correction');
  if(!fs.existsSync(p.correctionIdentity)){if(!create)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_IDENTITY: identity absent');writeAtomic(p.correctionIdentity,identity);}
  if(!same(readJson(p.correctionIdentity),identity))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_IDENTITY: correction identity changed');
  if(!fs.existsSync(p.correctionLedger)){if(!create)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: correction ledger absent');
    const ledger={schemaVersion:1,phase:'equivalence-correction',candidateId:CANDIDATE,identity,identitySha256:digest(identity),authorizedRenderCount:9,
      status:'PENDING',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),cells:Object.fromEntries(CORRECTION_CELLS.map(cell=>[key(cell),
        {identity:cell,state:'PENDING',path:null,sha256:null}])),accounting:{newRenderCalls:0,productionCandidateDelta:0,stage4Renders:0}};
    writeAtomic(p.correctionLedger,ledger);return ledger;}
  const ledger=readJson(p.correctionLedger);
  if(ledger.phase!=='equivalence-correction'||ledger.authorizedRenderCount!==9||ledger.identitySha256!==digest(identity)||!same(ledger.identity,identity)
      ||Object.keys(ledger.cells||{}).length!==9||CORRECTION_CELLS.some(c=>!ledger.cells[key(c)]||!same(ledger.cells[key(c)].identity,c)))
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: correction ledger identity/authorization mismatch');
  return ledger;
}
function correctionPaths(p){return {ledger:p.correctionLedger,dir:p.correctionDir,cells:p.correctionCells};}
function validateCorrectionRow(row,cell,identity){if(!same(row.identity,identity)||!same(row.cell,cell)||row.stage2mFactorMask!==3||row.stage3dVariant!==0
    ||!same(row.metrics?.velocityDerivativeWindowMs,[0,160]))throw new Error(`BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: invalid correction cell ${key(cell)}`);
  if(!safety(row.metrics).pass)throw new Error(`BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: unsafe correction cell ${key(cell)}`);return row;}
function loadCorrectionCell(pp,ledger,cell,identity){const e=ledger.cells[key(cell)],file=e?.path?path.join(pp.dir,e.path):null;
  if(e?.state!=='COMPLETE'||!file||!fs.existsSync(file)||sha(file)!==e.sha256)throw new Error(`BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: missing/corrupt COMPLETE ${key(cell)}`);
  return validateCorrectionRow(readJson(file),cell,identity);}
function inspectCorrection(p,identity){const ledger=loadCorrectionLedger(p,identity),c=counts(ledger),pp=correctionPaths(p);
  if(c.IN_PROGRESS)throw new Error(`BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: ambiguous IN_PROGRESS ${Object.keys(ledger.cells).find(k=>ledger.cells[k].state==='IN_PROGRESS')}`);
  if(ledger.accounting?.newRenderCalls!==c.COMPLETE||c.COMPLETE>9)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: correction accounting mismatch');
  for(const cell of CORRECTION_CELLS)if(ledger.cells[key(cell)].state==='COMPLETE')loadCorrectionCell(pp,ledger,cell,identity);
  return {ledger,counts:c,pp};}
function executeCorrection(root,p,identity,progress=()=>{}){
  if(fs.existsSync(p.selLedger)||fs.existsSync(p.selResult))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: selection evidence exists before correction');
  const historical=loadHistoricalEquivalence(root,p,baselineInputs(root));
  if(historical.ledger.accounting?.newRenderCalls!==10)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: original equivalence call count is not 10');
  const expected=correctionIdentity(identity,historical);const ledger=loadCorrectionLedger(p,expected,{create:true}),pp=correctionPaths(p);let renders=0;
  const c=counts(ledger);if(c.IN_PROGRESS)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: ambiguous IN_PROGRESS blocks correction');
  if(ledger.accounting.newRenderCalls!==c.COMPLETE||c.COMPLETE>9)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: correction budget mismatch');
  for(const cell of CORRECTION_CELLS){const e=ledger.cells[key(cell)];if(e.state==='COMPLETE'){loadCorrectionCell(pp,ledger,cell,expected);continue;}
    const current=ensureBuildIdentity(root);const currentExpected=correctionIdentity(current,loadHistoricalEquivalence(root,p,baselineInputs(root)));
    if(!same(currentExpected,expected))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_IDENTITY: changed before corrective render');
    e.state='IN_PROGRESS';e.startedAt=new Date().toISOString();writeAtomic(pp.ledger,ledger);
    const metrics=captureCell(cell),row={schemaVersion:1,candidateId:CANDIDATE,identity:expected,cell,kind:cell.kind,pitch:cell.pitch,velocity:cell.velocity,
      velocityNormalized:cell.velocity/127,productionWasmSha256:identity.productionWasmSha256,stage3dDiagnosticWasmSha256:identity.stage3dDiagnosticWasmSha256,
      configSha256:identity.configSha256,profileSha256:identity.profileSha256,presetsSha256:identity.presetsSha256,referenceFixtureSha256:identity.referenceFixtureSha256,
      stage3aEvidenceSha256:identity.stage3aEvidenceSha256,stage3cResultSha256:identity.stage3cResultSha256,stage2mFactorMask:3,stage3dVariant:0,metrics,
      safety:safety(metrics),capturedAt:new Date().toISOString()};
    validateCorrectionRow(row,cell,expected);const file=path.join(pp.cells,fileName(cell));writeAtomic(file,row);
    e.state='COMPLETE';e.path=path.relative(pp.dir,file);e.sha256=sha(file);e.completedAt=new Date().toISOString();ledger.accounting.newRenderCalls++;
    ledger.updatedAt=new Date().toISOString();writeAtomic(pp.ledger,ledger);renders++;progress(`equivalence-correction ${ledger.accounting.newRenderCalls}/9 ${key(cell)}`);
  }
  return {decision:'STAGE3D_EQUIVALENCE_CORRECTION_RENDERING_COMPLETE',renderCalls:renders,counts:counts(ledger),ledgerSha256:sha(pp.ledger)};
}
function finalizeCorrection(root=ROOT,p=paths(root),identity=ensureBuildIdentity(root),inputs=baselineInputs(root)){
  const historical=loadHistoricalEquivalence(root,p,inputs),expected=correctionIdentity(identity,historical),state=inspectCorrection(p,expected);
  if(state.counts.PENDING||state.counts.IN_PROGRESS||state.counts.COMPLETE!==9)throw new Error(`BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: requires nine COMPLETE ${JSON.stringify(state.counts)}`);
  const rows=CORRECTION_CELLS.map(cell=>{const row=loadCorrectionCell(state.pp,state.ledger,cell,expected),comparison=compareEquivalence(cell,row,inputs);
    return {cell,comparison,safety:safety(row.metrics),result:comparison.pass&&comparison.maxMetricDifference<=TOL?'PASS':'FAIL'};});
  const midi41=historical.result.rows.find(row=>row.cell.kind==='midi41');
  const historicalMidi41CellSha=historical.cellShas[key(EQUIVALENCE_CELLS[9])];
  if(midi41?.result!=='PASS'||expectedHistoricalMidi41Sha(identity,historical)!==historicalMidi41CellSha)
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: MIDI41 historical pass unavailable');
  const max=Math.max(...rows.map(row=>row.comparison.maxMetricDifference));
  const pass=rows.every(row=>row.result==='PASS')&&max<=TOL;
  const result={schemaVersion:1,decision:pass?'STAGE3D_EQUIVALENCE_CORRECTION_COMPLETE':'BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION',candidateId:CANDIDATE,
    historicalEquivalenceAuthorized:10,historicalEquivalenceActual:10,correctionAuthorized:9,correctionActual:9,historicalReusedPassCount:1,correctionPassCount:rows.filter(r=>r.result==='PASS').length,
    effectiveEquivalenceCellCount:10,equivalenceTolerance:TOL,maxMetricDifference:max,rows,historicalMIDI41:{result:'PASS',cellSha256:historicalMidi41CellSha},
    correctionIdentitySha256:digest(expected),bindings:{originalEquivalenceLedgerSha256:historical.ledgerSha256,originalBlockedResultSha256:historical.resultSha256,historicalMIDI41CellSha256:historicalMidi41CellSha,
      correctionLedgerSha256:sha(p.correctionLedger),correctionCellSha256:Object.fromEntries(CORRECTION_CELLS.map(c=>[key(c),state.ledger.cells[key(c)].sha256])),
      stage3dBuildIdentitySha256:expected.isolatedBuildIdentitySha256,stage3dWasmSha256:expected.stage3dDiagnosticWasmSha256,
      stage3dCaptureHelperSha256:expected.stage3dDedicatedCaptureHelperSha256,stage3dRunnerSha256:expected.stage3dRunnerSha256},
    productionCandidateDelta:0,stage4Renders:0,finalizedAt:new Date().toISOString()};
  writeAtomic(p.correctionResult,result);
  if(!pass)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION: one or more corrected cells differ');return result;
}
function expectedHistoricalMidi41Sha(identity,historical){return correctionIdentity(identity,historical).historicalMIDI41CellSha256;}
function loadCorrectedEquivalence(root=ROOT,p=paths(root),identity=ensureBuildIdentity(root),inputs=baselineInputs(root)){
  const historical=loadHistoricalEquivalence(root,p,inputs),expected=correctionIdentity(identity,historical);
  if(!fs.existsSync(p.correctionResult))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION: corrected equivalence is absent');
  const result=readJson(p.correctionResult),state=inspectCorrection(p,expected);
  if(result.decision!=='STAGE3D_EQUIVALENCE_CORRECTION_COMPLETE'||result.effectiveEquivalenceCellCount!==10||result.correctionPassCount!==9
      ||result.historicalReusedPassCount!==1||!Number.isFinite(result.maxMetricDifference)||result.maxMetricDifference>TOL||state.counts.COMPLETE!==9
      ||result.rows?.length!==9||!result.rows.every(row=>row.result==='PASS')||result.correctionIdentitySha256!==digest(expected)
      ||result.bindings?.originalEquivalenceLedgerSha256!==historical.ledgerSha256||result.bindings?.originalBlockedResultSha256!==historical.resultSha256
      ||result.bindings?.historicalMIDI41CellSha256!==expected.historicalMIDI41CellSha256
      ||result.bindings?.correctionLedgerSha256!==sha(p.correctionLedger))
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION: corrected equivalence did not pass');return result;
}
function validatePersistedCorrection(root=ROOT,p=paths(root),identity=ensureBuildIdentity(root),inputs=baselineInputs(root)){
  if(!fs.existsSync(p.correctionIdentity)||!fs.existsSync(p.correctionResult))
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: completed correction artifacts absent');
  const resultSha256=sha(p.correctionResult);
  if(resultSha256!==EXPECTED.stage3dCorrectedEquivalenceResult)
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: corrected result hash mismatch');
  const historical=loadHistoricalEquivalence(root,p,inputs),persistedIdentity=readJson(p.correctionIdentity);
  const currentExpected=correctionIdentity(identity,historical);
  const verifierDifferences=compareStrictCoreIdentity(persistedIdentity,currentExpected,CORRECTION_VERIFIER_FIELD_MAP);
  const state=inspectCorrection(p,persistedIdentity),ledger=state.ledger;
  const result=readJson(p.correctionResult);
  if(state.counts.COMPLETE!==9||state.counts.PENDING!==0||state.counts.IN_PROGRESS!==0
      ||ledger.accounting?.newRenderCalls!==9||ledger.identitySha256!==digest(persistedIdentity)||!same(ledger.identity,persistedIdentity))
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: correction is not 9/0/0');
  const actualCellShas=Object.fromEntries(CORRECTION_CELLS.map(cell=>[key(cell),ledger.cells[key(cell)].sha256]));
  if(result.decision!=='STAGE3D_EQUIVALENCE_CORRECTION_COMPLETE'||result.candidateId!==CANDIDATE
      ||result.correctionIdentitySha256!==digest(persistedIdentity)||result.correctionPassCount!==9
      ||result.historicalReusedPassCount!==1||result.effectiveEquivalenceCellCount!==10
      ||!Number.isFinite(result.maxMetricDifference)||result.maxMetricDifference>TOL
      ||!same(result.bindings?.correctionCellSha256,actualCellShas)
      ||result.bindings?.correctionLedgerSha256!==sha(p.correctionLedger)
      ||result.bindings?.originalEquivalenceLedgerSha256!==historical.ledgerSha256
      ||result.bindings?.originalBlockedResultSha256!==historical.resultSha256
      ||result.bindings?.historicalMIDI41CellSha256!==persistedIdentity.historicalMIDI41CellSha256
      ||result.bindings?.stage3dRunnerSha256!==persistedIdentity.stage3dRunnerSha256
      ||result.bindings?.stage3dCaptureHelperSha256!==persistedIdentity.stage3dDedicatedCaptureHelperSha256
      ||result.bindings?.stage3dBuildIdentitySha256!==persistedIdentity.isolatedBuildIdentitySha256
      ||result.bindings?.stage3dWasmSha256!==persistedIdentity.stage3dDiagnosticWasmSha256)
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: immutable correction binding mismatch');
  const rows=CORRECTION_CELLS.map(cell=>loadCorrectionCell(state.pp,ledger,cell,persistedIdentity));
  const comparisons=rows.map((row,index)=>compareEquivalence(CORRECTION_CELLS[index],row,inputs));
  const maxMetricDifference=Math.max(...comparisons.map(c=>c.maxMetricDifference));
  if(comparisons.some(c=>!c.pass||c.maxMetricDifference>TOL)||maxMetricDifference!==result.maxMetricDifference
      ||result.rows?.length!==9||!result.rows.every(row=>row.result==='PASS'))
    throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: persisted correction comparison failed');
  return {identity:persistedIdentity,state,result,verifierDifferences,resultSha256};
}
function assertSelectionCompletionShape(ledger,result,resultSha256){
  const c=counts(ledger),accounting=result.accounting||{};
  const expectedAccounting={historicalCallsBeforeStage3d:1180,originalEquivalenceRenders:10,correctionRenders:9,selectionRenders:261,
    maximumStage3dCalls:280,totalCumulativeCalls:1460,productionCandidateDelta:0,stage4Renders:0};
  if(ledger.phase!=='selection'||ledger.status!=='COMPLETE'||ledger.authorizedRenderCount!==261
      ||c.COMPLETE!==261||c.PENDING!==0||c.IN_PROGRESS!==0||ledger.accounting?.newRenderCalls!==261
      ||ledger.accounting?.productionCandidateDelta!==0||ledger.accounting?.stage4Renders!==0
      ||ledger.identitySha256!==digest(ledger.identity)||ledger.finalResultSha256!==resultSha256
      ||result.decision!=='BLOCKED_STAGE3D_CONTACT_TRANSFORMER_FAMILY'||result.authorizedRenderCount!==261
      ||result.completedCellCount!==261||result.selectedVariant!==null||result.identitySha256!==ledger.identitySha256
      ||!same(accounting,expectedAccounting)||typeof result.ledgerSha256!=='string'||! /^[0-9a-f]{64}$/.test(result.ledgerSha256))
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: completed selection result/ledger shape mismatch');
}
function validateCompletedSelection(root=ROOT,p=paths(root),currentIdentity=ensureBuildIdentity(root)){
  if(!fs.existsSync(p.selLedger)||!fs.existsSync(p.selResult))
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: completed selection artifacts absent');
  const ledgerSha256=sha(p.selLedger),resultSha256=sha(p.selResult);
  if(ledgerSha256!==EXPECTED.stage3dSelectionFinalLedger||resultSha256!==EXPECTED.stage3dSelectionResult)
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: fixed completed selection artifact hash mismatch');
  const ledger=readJson(p.selLedger),result=readJson(p.selResult);
  assertSelectionCompletionShape(ledger,result,resultSha256);
  if(result.ledgerSha256===ledgerSha256)
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: expected historical pre-finalization ledger SHA');
  const verifierDifferences=compareStrictCoreIdentity(ledger.identity,currentIdentity);
  const state=inspectLedger(p,ledger.identity,'selection');
  if(state.counts.COMPLETE!==261||state.counts.PENDING!==0||state.counts.IN_PROGRESS!==0)
    throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: selection is not 261/0/0');
  validateAggregates(p,ledger,ledger.identity);
  const rows=SELECTION_CELLS.map(cell=>loadCell(state.pp,ledger,cell,ledger.identity));
  if(rows.length!==261)throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: selection cell count mismatch');
  return {ledger,result,rows,verifierDifferences,ledgerSha256,resultSha256,preFinalizationLedgerSha256:result.ledgerSha256};
}
function compareEquivalence(cell,row,inputs){const expected=referenceRow(cell,inputs);if(!expected?.metrics)throw new Error(`BLOCKED_STAGE3D_BASELINE_IDENTITY: missing Stage3A reference ${key(cell)}`);
  return stage3c.compareMetrics(row.metrics,expected.metrics);}
function safety(m){return {finite:m.finite===true,guardHits:m.outputGuardHits,peakDbfs:m.peakDbfs,fullRenderPeakDbfs:m.fullRenderPeakDbfs,
  pass:m.finite===true&&m.outputGuardHits===0&&m.peakDbfs<0&&m.fullRenderPeakDbfs<0};}
function finalizeEquivalence(root=ROOT,p=paths(root),identity=ensureBuildIdentity(root),inputs=baselineInputs(root)){
  const state=inspectLedger(p,identity,'equivalence');if(state.counts.PENDING||state.counts.IN_PROGRESS||state.counts.COMPLETE!==10)
    throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: equivalence requires 10 COMPLETE, got ${JSON.stringify(state.counts)}`);
  const rows=EQUIVALENCE_CELLS.map(cell=>{const row=loadCell(state.pp,state.ledger,cell,identity);try{const cmp=compareEquivalence(cell,row,inputs),safe=safety(row.metrics);
    return {cell,comparison:cmp,safety:safe,result:cmp.pass&&safe.pass?'PASS':'FAIL'};}catch(e){return {cell,result:'FAIL',error:String(e.message||e),safety:safety(row.metrics)};}});
  const max=Math.max(...rows.map(x=>x.comparison?.maxMetricDifference??Infinity));
  const pass=rows.length===10&&rows.every(x=>x.result==='PASS')&&max<=TOL;
  const result={schemaVersion:1,decision:pass?'STAGE3D_EQUIVALENCE_COMPLETE':'BLOCKED_STAGE3D_EQUIVALENCE',candidateId:CANDIDATE,
    identitySha256:digest(identity),authorizedRenderCount:10,completedCellCount:10,stage2mFactorMask:3,stage3dVariant:0,
    equivalenceTolerance:TOL,maxMetricDifference:max,rows,productionCandidateDelta:0,stage4Renders:0,finalizedAt:new Date().toISOString()};
  writeAtomic(p.eqResult,result);state.ledger.status=pass?'COMPLETE':'BLOCKED';state.ledger.finalResultSha256=sha(p.eqResult);state.ledger.updatedAt=new Date().toISOString();writeAtomic(p.eqLedger,state.ledger);
  if(!pass)throw new Error('BLOCKED_STAGE3D_EQUIVALENCE: one or more variant-0 cells differ from accepted Stage3A baseline');return result;}
function evaluateNoOps(rows,inputs){const candidates=rows.filter(row=>isNoOp(row.cell));const output=[];
  for(const row of candidates){try{const expected=referenceRow(row.cell,inputs);const cmp=stage3c.compareMetrics(row.metrics,expected.metrics);
    output.push({cell:row.cell,pass:cmp.pass&&cmp.maxMetricDifference<=TOL,maxMetricDifference:cmp.maxMetricDifference});}
    catch(e){output.push({cell:row.cell,pass:false,error:String(e.message||e)});}}
  return {pass:output.length>0&&output.every(x=>x.pass),rows:output,maxMetricDifference:Math.max(0,...output.map(x=>x.maxMetricDifference??Infinity))};}
function isNoOp(cell){return cell.pitch===48||cell.pitch===57||cell.pitch>=93||cell.pitch===41;}
function loadDirectBaseline(root=ROOT){const file=path.join(root,'.agent-state/issues/7/calibration-optuna/stage3/direct-capture.json');
  const data=readJson(file);if(data.matrix?.length!==480||data.render?.wasmSha256!==EXPECTED.productionWasm)throw new Error('BLOCKED_STAGE3D_BASELINE_IDENTITY: Stage3 direct capture incomplete');
  return new Map(data.matrix.map(row=>[`${row.pitch}:${row.velocity}`,row.metrics]));}
function evaluateCandidate(variant,rows,inputs,root=ROOT){const directBaseline=loadDirectBaseline(root),fixture=readJson(path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'));
  const variantRows=rows.filter(r=>r.cell.stage3dVariant===variant),noOp=evaluateNoOps(variantRows,inputs);
  const actual=new Map(directBaseline);for(const row of variantRows)if(row.cell.velocity!==null&&fixture.directCells.some(ref=>ref.pitch===row.cell.pitch&&ref.velocity===row.cell.velocity))
    actual.set(`${row.cell.pitch}:${row.cell.velocity}`,row.metrics);
  const directCells=[...actual.entries()].map(([k,metrics])=>{const [pitch,velocity]=k.split(':').map(Number);return {pitch,velocity,metrics};});
  const refCells=fixture.directCells;const evaluated=directMetrics.evaluateDirectReferenceMatrix(refCells,directCells);
  const directByCell=new Map(evaluated.cells.map(row=>[`${row.pitch}:${row.velocity}`,row]));
  const candidateDirectRows=variantRows.filter(r=>r.cell.kind==='dynamic'||r.cell.kind==='treble').map(r=>directByCell.get(`${r.cell.pitch}:${r.cell.velocity}`));
  const directPass=candidateDirectRows.length===76&&candidateDirectRows.every(r=>r&&r.hardFailures.length===0);
  const spanFor=pitch=>{const rows=variantRows.filter(r=>r.cell.pitch===pitch&&r.cell.kind==='dynamic');const levels=rows.map(r=>r.metrics.envelopeDbfs[3]);
    const refs=fixture.directCells.filter(r=>r.pitch===pitch).map(r=>(r.metrics||r).envelopeDbfs[3]);
    if(rows.length!==16||refs.length!==16)throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: span coverage incomplete MIDI ${pitch}`);
    return directMetrics.dynamicSpanMetrics(levels,refs);};
  const span51=spanFor(51),span54=spanFor(54);
  const safetyRows=variantRows.map(r=>({cell:r.cell,...safety(r.metrics)}));const failedSafety=safetyRows.filter(x=>!x.pass);
  const finiteFailure=safetyRows.find(x=>!x.finite);
  if(finiteFailure)throw new Error(`BLOCKED_STAGE3D_NONFINITE_DIAGNOSTIC: ${key(finiteFailure.cell)}`);
  const transition=variantRows.filter(r=>r.cell.kind==='transition').map(r=>({cell:r.cell,...safety(r.metrics),metricsFinite:finiteTree(r.metrics)}));
  const transitionPass=transition.length===24&&transition.every(x=>x.pass&&x.metricsFinite);
  const spanPass=span51.errorDb<=8&&span54.errorDb<=8;
  const eligible=noOp.pass&&failedSafety.length===0&&spanPass&&directPass&&transitionPass;
  return {variant,eligible,noOp,safety:{pass:failedSafety.length===0,failed:failedSafety},directReference:{pass:directPass,sharedGainOffsetDb:evaluated.sharedGainOffsetDb,
      failures:candidateDirectRows.filter(r=>r?.hardFailures.length).map(r=>({pitch:r.pitch,velocity:r.velocity,hardFailures:r.hardFailures,levelErrorDb:r.levelErrorDb,
        centroidRatio:r.centroidRatio,above2kDelta:r.above2kDelta,postAttackShapeErrorDb:r.postAttackShapeErrorDb}))},
    dynamicSpan:{MIDI51:span51,MIDI54:span54,pass:spanPass},transition:{pass:transitionPass,rows:transition},noOpCellCount:noOp.rows.length};}
function finiteTree(value){if(typeof value==='number')return Number.isFinite(value);if(Array.isArray(value))return value.every(finiteTree);if(value&&typeof value==='object')return Object.values(value).every(finiteTree);return true;}
function finalizeSelection(root=ROOT,p=paths(root),identity=ensureBuildIdentity(root),inputs=baselineInputs(root)){
  const eq=loadCorrectedEquivalence(root,p,identity,inputs),state=inspectLedger(p,identity,'selection');
  if(state.counts.PENDING||state.counts.IN_PROGRESS||state.counts.COMPLETE!==261)throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: selection requires 261 COMPLETE, got ${JSON.stringify(state.counts)}`);
  validateAggregates(p,state.ledger,identity);
  const rows=SELECTION_CELLS.map(cell=>loadCell(state.pp,state.ledger,cell,identity));
  const noOpGlobal={variants:{}};for(const v of MASKS)noOpGlobal.variants[v]=evaluateNoOps(rows.filter(r=>r.cell.stage3dVariant===v),inputs);
  if(Object.values(noOpGlobal.variants).some(v=>!v.pass)){
    const result={schemaVersion:1,decision:'BLOCKED_STAGE3D_LOCALIZATION_EQUIVALENCE',candidateId:CANDIDATE,identitySha256:digest(identity),
      equivalenceDecision:eq.decision,noOp:noOpGlobal,productionCandidateDelta:0,stage4Renders:0,finalizedAt:new Date().toISOString()};
    writeAtomic(p.selResult,result);throw new Error('BLOCKED_STAGE3D_LOCALIZATION_EQUIVALENCE: one or more required no-op rows differ');}
  const candidates=MASKS.map(v=>evaluateCandidate(v,rows,inputs,root));
  const selected=selectCandidate(candidates);
  const result={schemaVersion:1,decision:selected?'STAGE3D_CONTACT_TRANSFORMER_SELECTED':'BLOCKED_STAGE3D_CONTACT_TRANSFORMER_FAMILY',candidateId:CANDIDATE,
    identitySha256:digest(identity),equivalence:{decision:eq.decision,maxMetricDifference:eq.maxMetricDifference},authorizedRenderCount:261,completedCellCount:261,
    accounting:{historicalCallsBeforeStage3d:1180,originalEquivalenceRenders:10,correctionRenders:9,selectionRenders:261,
      maximumStage3dCalls:280,totalCumulativeCalls:1460,productionCandidateDelta:0,stage4Renders:0},
    noOp:noOpGlobal,candidates,selectedVariant:selected?.variant??null,selectedPlateauRatio:selected?plateauFormula(selected.variant):null,
    selectedFormula:selected?plateauFormulaText(selected.variant):null,selectedResult:selected?{MIDI51:selected.dynamicSpan.MIDI51,MIDI54:selected.dynamicSpan.MIDI54,
      safety:selected.safety,noOp:selected.noOp,transition:selected.transition}:null,ledgerSha256:sha(p.selLedger),finalizedAt:new Date().toISOString()};
  writeAtomic(p.selResult,result);state.ledger.status='COMPLETE';state.ledger.finalResultSha256=sha(p.selResult);state.ledger.updatedAt=new Date().toISOString();writeAtomic(p.selLedger,state.ledger);
  return result;}
function plateauFormula(v){return v===1?'sqrt((Z0+Z1)/(Z0+Z1+Z2))':v===2?'sqrt(Z0/(Z0+Z1+Z2))':'Z0/(Z0+Z1+Z2)';}
function plateauFormulaText(v){return `r${v} = ${plateauFormula(v)}`;}
function selectCandidate(candidates){for(const variant of MASKS){const found=candidates.find(c=>c.variant===variant&&c.eligible);if(found)return found;}return null;}
function gateValue(pitch){if(pitch<=48||pitch>=57)return 0;let t;if(pitch<51)t=(pitch-48)/3;else if(pitch<=54)return 1;else t=(57-pitch)/3;
  t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
function plateauRatio(variant,[z0,z1,z2]){const s=z0+z1+z2;if(!(s>0))return 1;
  return variant===1?Math.sqrt((z0+z1)/s):variant===2?Math.sqrt(z0/s):variant===3?z0/s:1;}
function transformerTerms(vBundle,fHammer,r,s){return r===1?{vContact:vBundle,fString:fHammer,deltaV:fHammer/(2*s)}:
  {vContact:vBundle/r,fString:fHammer/r,deltaV:(fHammer/r)/(2*s)};}
function aggregateComplete(p,ledger,identity,variant,pitch){const cells=SELECTION_CELLS.filter(c=>c.stage3dVariant===variant&&c.pitch===pitch);
  if(!cells.length||!cells.every(c=>ledger.cells[key(c)].state==='COMPLETE'))return;
  const rows=cells.map(c=>loadCell(ledgerPaths(p,'selection'),ledger,c,identity));const file=path.join(p.aggregates,`variant-${variant}-midi-${String(pitch).padStart(3,'0')}.json`);
  writeAtomic(file,{schemaVersion:1,variant,pitch,identitySha256:digest(identity),authorizedCellCount:cells.length,rows});
  ledger.aggregates??={};ledger.aggregates[`${variant}:${pitch}`]={path:path.relative(path.dirname(p.selLedger),file),sha256:sha(file),cellCount:cells.length};}
function validateAggregates(p,ledger,identity){const needed=new Set(SELECTION_CELLS.map(c=>`${c.stage3dVariant}:${c.pitch}`));
  for(const k of needed){const item=ledger.aggregates?.[k],file=item&&path.resolve(path.dirname(p.selLedger),item.path);if(!item||!file||!fs.existsSync(file)||sha(file)!==item.sha256)
      throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: missing/corrupt aggregate ${k}`);
    const data=readJson(file);if(data.identitySha256!==digest(identity)||data.rows?.length!==item.cellCount)throw new Error(`BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: aggregate identity mismatch ${k}`);}}
function executePhase(root,p,identity,phase,progress=()=>{}){const cells=phase==='equivalence'?EQUIVALENCE_CELLS:SELECTION_CELLS;
  if(phase==='selection')loadCorrectedEquivalence(root,p,identity,baselineInputs(root));
  const pp=ledgerPaths(p,phase),ledger=loadLedger(p,identity,phase,{create:true});let renders=0;
  const c=counts(ledger);if(c.IN_PROGRESS)throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: ambiguous IN_PROGRESS blocks execute');
  const eqCalls=fs.existsSync(p.eqLedger)?readJson(p.eqLedger).accounting?.newRenderCalls||0:0;
  const correctionCalls=fs.existsSync(p.correctionLedger)?readJson(p.correctionLedger).accounting?.newRenderCalls||0:0;
  const selCalls=fs.existsSync(p.selLedger)?readJson(p.selLedger).accounting?.newRenderCalls||0:0;
  if(eqCalls+correctionCalls+selCalls>280)throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: total Stage3D render budget exceeded');
  for(const cell of cells){const e=ledger.cells[key(cell)];if(e.state==='COMPLETE'){loadCell(pp,ledger,cell,identity);continue;}
    const currentEq=fs.existsSync(p.eqLedger)?readJson(p.eqLedger).accounting?.newRenderCalls||0:0;
    const currentCorrection=fs.existsSync(p.correctionLedger)?readJson(p.correctionLedger).accounting?.newRenderCalls||0:0;
    const currentSel=fs.existsSync(p.selLedger)?readJson(p.selLedger).accounting?.newRenderCalls||0:0;
    if(currentEq+currentCorrection+currentSel>=280)throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_EVIDENCE: total Stage3D render budget exhausted');
    const current=ensureBuildIdentity(root);if(!same(current,identity))throw new Error('BLOCKED_STAGE3D_DIAGNOSTIC_BUILD_IDENTITY: changed before cell render');
    e.state='IN_PROGRESS';e.startedAt=new Date().toISOString();writeAtomic(pp.ledger,ledger);
    const metrics=captureCell(cell);
    const row={schemaVersion:1,candidateId:CANDIDATE,identity,cell,kind:cell.kind,pitch:cell.pitch,velocity:cell.velocity,
      velocityNormalized:cell.velocity===null?cell.velocityNormalized:cell.velocity/127,productionWasmSha256:identity.productionWasmSha256,
      stage3dDiagnosticWasmSha256:identity.stage3dDiagnosticWasmSha256,configSha256:identity.configSha256,profileSha256:identity.profileSha256,
      presetsSha256:identity.presetsSha256,referenceFixtureSha256:identity.referenceFixtureSha256,stage3cResultSha256:identity.stage3cResultSha256,
      stage2mFactorMask:3,stage3dVariant:cell.stage3dVariant,metrics,safety:safety(metrics),capturedAt:new Date().toISOString()};
    validateCellRow(row,cell,identity);const file=phase==='equivalence'?eqFile(cell,p):selectionFile(cell,p);writeAtomic(file,row);
    e.state='COMPLETE';e.path=path.relative(pp.dir,file);e.sha256=sha(file);e.completedAt=new Date().toISOString();
    ledger.accounting.newRenderCalls++;ledger.updatedAt=new Date().toISOString();writeAtomic(pp.ledger,ledger);renders++;
    if(phase==='selection')aggregateComplete(p,ledger,identity,cell.stage3dVariant,cell.pitch);
    writeAtomic(pp.ledger,ledger);progress(`${phase} ${ledger.accounting.newRenderCalls}/${cells.length} ${key(cell)}`);
    if(!metrics.finite)throw new Error(`BLOCKED_STAGE3D_NONFINITE_DIAGNOSTIC: ${key(cell)}`);
  }
  return {decision:phase==='equivalence'?'STAGE3D_EQUIVALENCE_RENDERING_COMPLETE':'STAGE3D_SELECTION_RENDERING_COMPLETE',renderCalls:renders,
    counts:counts(ledger),ledgerSha256:sha(pp.ledger)};}
function run({root=ROOT,mode='--dry-run',progress=()=>{}}={}){if(!['--dry-run','--equivalence','--correct-equivalence','--execute','--finalize'].includes(mode))throw new Error('explicit mode required');
  const p=paths(root),identity=ensureBuildIdentity(root,{write:false});
  if(mode==='--dry-run'){
    const historical=loadHistoricalEquivalence(root,p,baselineInputs(root));
    const correction=validatePersistedCorrection(root,p,identity,baselineInputs(root));
    const selection=validateCompletedSelection(root,p,identity);
    const windowCounts={'0-160':SELECTION_CELLS.filter(c=>c.velocityDerivativeStartMs===0&&c.velocityDerivativeEndMs===160).length,
      '30-180':SELECTION_CELLS.filter(c=>c.velocityDerivativeStartMs===30&&c.velocityDerivativeEndMs===180).length};
    const windowPolicyValid=windowCounts['0-160']===132&&windowCounts['30-180']===129;
    if(!windowPolicyValid)throw new Error('BLOCKED_STAGE3D_WINDOW_POLICY: selection window counts differ');
    const persistedBuildIdentity=readJson(p.identity);
    return {decision:'DRY_RUN',builds:0,renders:0,acousticRenders:0,historicalEquivalenceCalls:10,historicalEquivalenceComplete:10,
      historicalEquivalenceDecision:historical.result.decision,correctionAuthorized:9,correctionComplete:correction.state.counts.COMPLETE,
      correctedEquivalenceDecision:correction.result.decision,selectionAuthorized:261,selectionComplete:selection.rows.length,
      selectionDecision:selection.result.decision,selectionExists:true,selectionWindowCounts:windowCounts,windowPolicyValid,
      revisedStage3dMaximumCalls:280,historicalCallsBeforeStage3d:1180,maximumCumulativeCalls:1460,
      productionCandidateDelta:0,stage4Renders:0,
      verifierIdentity:{historical:Object.fromEntries(VERIFIER_ONLY_FIELDS.map(field=>[field,persistedBuildIdentity[field]])),
        current:Object.fromEntries(VERIFIER_ONLY_FIELDS.map(field=>[field,identity[field]])),
        correctionHistorical:correction.verifierDifferences},
      selectionBinding:{preFinalizationLedgerSha256:selection.preFinalizationLedgerSha256,
        finalLedgerSha256:selection.ledgerSha256,selectionResultSha256:selection.resultSha256,
        preFinalizationDiffersFromFinal:selection.preFinalizationLedgerSha256!==selection.ledgerSha256}};}
  const inputs=baselineInputs(root);
  if(mode==='--equivalence'){
    const historical=loadHistoricalEquivalence(root,p,inputs);return {decision:historical.result.decision,renderCalls:0,
      equivalenceSha256:historical.resultSha256,authorizedRenderCount:10,historicalEvidenceImmutable:true};
  }
  if(mode==='--correct-equivalence'){
    if(fs.existsSync(p.selLedger)||fs.existsSync(p.selResult))throw new Error('BLOCKED_STAGE3D_EQUIVALENCE_CORRECTION_EVIDENCE: selection evidence exists before correction');
    const historical=loadHistoricalEquivalence(root,p,inputs),expected=correctionIdentity(identity,historical);
    if(fs.existsSync(p.correctionResult)){const existing=loadCorrectedEquivalence(root,p,identity,inputs);return {decision:existing.decision,renderCalls:0,
      correctionSha256:sha(p.correctionResult),authorizedRenderCount:9};}
    const executed=executeCorrection(root,p,identity,progress);
    if(executed.counts.COMPLETE!==9)return executed;
    const result=finalizeCorrection(root,p,identity,inputs);return {...executed,decision:result.decision,correctedEquivalenceSha256:sha(p.correctionResult)};
  }
  if(mode==='--execute')return executePhase(root,p,identity,'selection',progress);
  if(mode==='--finalize'){
    const result=finalizeSelection(root,p,identity,inputs);validateAggregates(p,readJson(p.selLedger),identity);
    return {decision:result.decision,renderCalls:0,cellCount:261,selectionResultSha256:sha(p.selResult),ledgerSha256:sha(p.selLedger),result};}
  throw new Error('explicit mode required');}
function mode(argv){if(argv.length!==1||!['--dry-run','--equivalence','--correct-equivalence','--execute','--finalize'].includes(argv[0]))throw new Error('explicit mode required: --dry-run, --equivalence, --correct-equivalence, --execute, or --finalize');return argv[0];}
if(require.main===module){try{const m=mode(process.argv.slice(2));const out=run({mode:m,progress:s=>process.stderr.write(`${s}\n`)});process.stdout.write(`${JSON.stringify(out)}\n`);}
  catch(e){process.stderr.write(`Stage3D localized contact transformer ERROR: ${e.stack||e.message}\n`);process.exitCode=1;}}
module.exports={ROOT,CANDIDATE,START_HEAD,EXPECTED,TOL,MASKS,VELOCITIES,DYNAMIC,TREBLE,TRANSITION,NORM,EQUIVALENCE_CELLS,CORRECTION_CELLS,SELECTION_CELLS,derivativeWindow,
  DIAGNOSTIC_SIGNALS,VERIFIER_ONLY_FIELDS,CORRECTION_VERIFIER_FIELD_MAP,compareStrictCoreIdentity,paths,key,fileName,counts,assertAuthorized,buildRoot,buildIdentity,ensureBuildIdentity,hasAcousticEvidence,makeLedger,loadLedger,validateCellRow,
  inspectLedger,safety,compareEquivalence,evaluateNoOps,isNoOp,plateauFormula,plateauFormulaText,selectCandidate,gateValue,plateauRatio,transformerTerms,
  finalizeEquivalence,loadHistoricalEquivalence,correctionIdentity,loadCorrectionLedger,inspectCorrection,executeCorrection,finalizeCorrection,loadCorrectedEquivalence,
  evaluateCandidate,finalizeSelection,validateAggregates,validatePersistedCorrection,assertSelectionCompletionShape,validateCompletedSelection,executePhase,run,mode};
