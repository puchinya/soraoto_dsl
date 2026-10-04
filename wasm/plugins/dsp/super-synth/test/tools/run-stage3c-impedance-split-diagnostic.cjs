#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const capture=require('./capture-supersynth-matrix.cjs');
const stage3b=require('./run-stage3b-contact-attribution.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const CANDIDATE='stage2n-r3-candidate-01';
const REQUIRED_HEAD='ec4e3fa8816d83a9274fcd98c80ac01f26514bbd';
const EXPECTED={
  productionWasm:'9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2',
  stage3aWasm:'59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3',
  stage3bWasm:'2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9',
  config:'792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d',
  profile:'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66',
  presets:'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431',
  fixture:'5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7',
  stage3bLedger:'3c688ce49877dd7a94a2920c02bc9ddb7145709d06b1e7a04a7aecda4b18fbaf',
  stage3bAnalysis:'220c4904fc858ee671002ce84de85a75abd2271f78a53f433dbf5bd4021675cb',
  stage3aLedger:'e43d6d1b88f57766d0c48e413801916b313580cec83d629b54835be0f23060e9',
  stage3aFinal:'e953ba33a363f378a006aafcbe4066cb1b05d69ac42ca1f401cd68d7e7261cd4',
  stage3aSupplement:'91b6b4df895a2a044135752156b88d1ab04806f02ebd338a8518f703e29c1713',
  mask0:'fc54305c158e706ca5a28eeacdf9390c029a932283d94d047c9a443a28eb702a',
  preflight:'f69e8adf900db451bc91c48928f914dc8b7da28b732e533f1742d5b49d9ce1dc'
};
const STAGE3B_ROOT=path.join(ROOT,'.agent-state/issues/7/stage3b');
const STAGE3A_ROOT=path.join(ROOT,'.agent-state/issues/7/stage3a');
const STAGE3C_ROOT=path.join(ROOT,'.agent-state/issues/7/stage3c');
const STAGE3C_WASM_REL='plugins/dsp/super-synth/plugin.wasm';
const TOLERANCE=1e-6;
const DYNAMIC_PITCHES=[36,39,42,45,48,51,54,57];
const TREBLE_PITCHES=[93,96,99];
const DYNAMIC_VELOCITIES=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const TREBLE_VELOCITIES=[14,31,61,124];
const MIDI41_NORMALIZED=[0.25,0.55,0.90];
const SPLIT_MASKS=[1,2];
const EQUIVALENCE_COORDS=[
  {pitch:36,velocity:124},{pitch:39,velocity:124},{pitch:45,velocity:69},{pitch:48,velocity:69},
  {pitch:51,velocity:14},{pitch:51,velocity:124},{pitch:54,velocity:124},{pitch:57,velocity:124},
  {pitch:96,velocity:31},{pitch:41,velocity:null,velocityNormalized:0.25}
];
const EQUIVALENCE_CELLS=EQUIVALENCE_COORDS.flatMap(cell=>[0,3].map(stage3cMask=>({...cell,stage3cMask,kind:'equivalence'})));
const SPLIT_CELLS=[
  ...DYNAMIC_PITCHES.flatMap(pitch=>DYNAMIC_VELOCITIES.flatMap(velocity=>SPLIT_MASKS.map(stage3cMask=>({kind:'dynamic',pitch,velocity,stage3cMask})))),
  ...TREBLE_PITCHES.flatMap(pitch=>TREBLE_VELOCITIES.flatMap(velocity=>SPLIT_MASKS.map(stage3cMask=>({kind:'treble',pitch,velocity,stage3cMask})))),
  ...MIDI41_NORMALIZED.flatMap(velocityNormalized=>SPLIT_MASKS.map(stage3cMask=>({kind:'midi41',pitch:41,velocity:null,velocityNormalized,stage3cMask})))
];
const EQUIVALENCE_COUNT=EQUIVALENCE_CELLS.length;
const SPLIT_COUNT=SPLIT_CELLS.length;
const DIAGNOSTIC_SIGNALS=['bridge_b','bridge_m','bridge_t','board_drive_b','board_drive_m','board_drive_t','modal_l','modal_r',
  'residual_l','residual_r','pre_radiation_l','pre_radiation_r','post_radiation_l','post_radiation_r','dry_transverse',
  'dry_bridge','dry_contact','dry_longitudinal','dry_mix','longitudinal_bridge_drive'];
const HAMMER_FIELDS=['effectiveHardness','initialHammerVelocity','contactDurationSamples','peakForce','maxCompression','postContactTransverseEnergy'];
const PATH_METRICS=['contactDurationSamples','peakForce','postContactTransverseEnergy','bridge_b RMS','board_drive_b RMS','post_radiation_l RMS','spectralCentroidHz','above2kPowerRatio'];

function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function hashText(value){return crypto.createHash('sha256').update(value).digest('hex');}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});
  fs.renameSync(temp,file);
}
function deepEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function keyOf(cell){
  const velocity=cell.velocity===null?`n${String(Math.round(cell.velocityNormalized*100)).padStart(2,'0')}`:`v${String(cell.velocity).padStart(3,'0')}`;
  return `${cell.kind}:mask-${cell.stage3cMask}:midi-${String(cell.pitch).padStart(3,'0')}:${velocity}`;
}
function fileName(cell){
  const velocity=cell.velocity===null?`normalized-${String(Math.round(cell.velocityNormalized*100)).padStart(2,'0')}`:`velocity-${String(cell.velocity).padStart(3,'0')}`;
  return `midi-${String(cell.pitch).padStart(3,'0')}-${velocity}-mask-${cell.stage3cMask}.json`;
}
function eqPaths(root=STAGE3C_ROOT){return {dir:path.join(root,'equivalence'),ledger:path.join(root,'equivalence/ledger.json'),cells:path.join(root,'equivalence/cells'),result:path.join(root,'equivalence.json')};}
function splitPaths(root=STAGE3C_ROOT){return {dir:path.join(root,'split'),ledger:path.join(root,'split/ledger.json'),cells:path.join(root,'split/cells'),aggregates:path.join(root,'split/aggregates'),result:path.join(root,'split-attribution.json')};}
function cellPath(paths,cell){return cell.kind==='equivalence'?path.join(paths.cells,fileName(cell)):path.join(paths.cells,`mask-${cell.stage3cMask}`,fileName(cell));}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells).filter(row=>row.state===state).length]));}
function assertUnique(cells,count,label){
  if(cells.length!==count||new Set(cells.map(keyOf)).size!==count)throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: ${label} authorization count/identity mismatch`);
  return cells;
}
function expectedEquivalenceCells(){return assertUnique(EQUIVALENCE_CELLS,EQUIVALENCE_COUNT,'equivalence');}
function expectedSplitCells(){return assertUnique(SPLIT_CELLS,SPLIT_COUNT,'split');}
function modeFromArgs(argv){
  const modes=new Map([['--dry-run','dry-run'],['--equivalence','equivalence'],['--execute','execute'],['--finalize','finalize']]);
  if(argv.length!==1||!modes.has(argv[0]))throw new Error('explicit mode required: --dry-run, --equivalence, --execute, or --finalize');
  return modes.get(argv[0]);
}
function stage3cBuildRoot(root=ROOT){
  const value=process.env.SORAOTO_WASM_BUILD_DIR?path.resolve(process.env.SORAOTO_WASM_BUILD_DIR):path.join(root,'build/wasm-stage3c');
  if(path.resolve(value)!==path.join(root,'build/wasm-stage3c'))throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: Stage3C must use build/wasm-stage3c');
  return value;
}
function readBuildExports(wasm){return new Set(WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(wasm))).map(item=>item.name));}
function currentHead(root=ROOT){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function assertAncestor(root=ROOT){
  try{execFileSync('rtk',['git','merge-base','--is-ancestor',REQUIRED_HEAD,currentHead(root)],{cwd:root,stdio:'ignore'});}
  catch{throw new Error(`BLOCKED_STAGE3C_BASELINE_IDENTITY: HEAD is not descended from ${REQUIRED_HEAD}`);}
}
function stage3bBaseline(root=ROOT){
  const ledgerFile=path.join(root,'.agent-state/issues/7/stage3b/ledger.json');
  const analysisFile=path.join(root,'.agent-state/issues/7/stage3b/factorial-analysis.json');
  if(!fs.existsSync(ledgerFile)||!fs.existsSync(analysisFile)||sha256(ledgerFile)!==EXPECTED.stage3bLedger||sha256(analysisFile)!==EXPECTED.stage3bAnalysis)
    throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: persisted Stage3B ledger/factorial hashes changed');
  const ledger=readJson(ledgerFile),analysis=readJson(analysisFile);
  if(ledger.candidateId!==CANDIDATE||ledger.authorizedRenderCount!==477||ledger.accounting?.newRenderCalls!==477
      ||analysis.decision!=='BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY'||analysis.candidateId!==CANDIDATE
      ||analysis.diagnosticRows?.length!==477||Object.keys(ledger.aggregates||{}).length!==39)
    throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: Stage3B finalized evidence is incomplete or inconsistent');
  return {ledger,analysis,ledgerFile,analysisFile};
}
function stage3aIdentity(root=ROOT){
  const files={ledger:path.join(root,'.agent-state/issues/7/stage3a/recovery/recovery-ledger.json'),
    final:path.join(root,'.agent-state/issues/7/stage3a/velocity-diagnostic.json'),
    supplement:path.join(root,'.agent-state/issues/7/stage3a/supplemental-3-render-result.json')};
  const hashes={ledger:sha256(files.ledger),final:sha256(files.final),supplement:sha256(files.supplement)};
  if(hashes.ledger!==EXPECTED.stage3aLedger||hashes.final!==EXPECTED.stage3aFinal||hashes.supplement!==EXPECTED.stage3aSupplement)
    throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: Stage3A evidence hashes changed');
  return {files,hashes};
}
function readCmakeCache(file){return fs.readFileSync(file,'utf8');}
function buildIdentity(root=ROOT){
  assertAncestor(root);
  const authoritative=stage3b.assertAuthoritativeProductionIdentity(root);
  if(authoritative.hashes.productionWasmSha256!==EXPECTED.productionWasm||authoritative.hashes.configSha256!==EXPECTED.config
      ||authoritative.hashes.profileSha256!==EXPECTED.profile||authoritative.hashes.presetsSha256!==EXPECTED.presets
      ||authoritative.hashes.referenceFixtureSha256!==EXPECTED.fixture)
    throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: fixed production/config/profile/preset/reference identity changed');
  const stage3a=stage3bIdentity(root);
  const preflightFile=path.join(root,'.agent-state/issues/7/stage3b/preflight-provenance.json');
  if(!fs.existsSync(preflightFile)||sha256(preflightFile)!==EXPECTED.preflight)
    throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: accepted Stage3B preflight provenance SHA changed');
  const productionProvenance=readJson(preflightFile);
  if(productionProvenance.classification!=='SUFFICIENT_METADATA_PROVENANCE'||productionProvenance.preflightReady!==true
      ||productionProvenance.preflightResult?.decision!=='STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE')
    throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: accepted Stage3B provenance classification/result mismatch');
  const stage3bEvidence=stage3bBaseline(root);
  const stage3aHashes={ledger:EXPECTED.stage3aLedger,final:EXPECTED.stage3aFinal,supplement:EXPECTED.stage3aSupplement};
  const buildRoot=stage3cBuildRoot(root),wasm=path.join(buildRoot,STAGE3C_WASM_REL),cachePath=path.join(buildRoot,'CMakeCache.txt');
  if(!fs.existsSync(wasm)||!fs.existsSync(cachePath))throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: dedicated Stage3C diagnostic build is missing');
  const cache=readCmakeCache(cachePath);
  for(const flag of ['SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:BOOL=ON','SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:BOOL=ON',
    'SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS:BOOL=OFF','SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS:BOOL=ON'])
    if(!cache.includes(flag))throw new Error(`BLOCKED_STAGE3C_BASELINE_IDENTITY: CMake cache lacks ${flag}`);
  if(cache.includes('SORAOTO_FORCE_SCALAR_GRAND:BOOL=ON'))throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: scalar build is not accepted');
  const exports=readBuildExports(wasm);
  for(const name of ['soraoto_supersynth_stage3c_set_variant_mask','soraoto_supersynth_stage3c_get_variant_mask'])if(!exports.has(name))
    throw new Error(`BLOCKED_STAGE3C_BASELINE_IDENTITY: missing Stage3C diagnostic export ${name}`);
  for(const name of ['soraoto_supersynth_stage3b_set_variant_mask','soraoto_supersynth_stage3b_get_variant_mask'])if(exports.has(name))
    throw new Error(`BLOCKED_STAGE3C_BASELINE_IDENTITY: Stage3B exports unexpectedly coexist with Stage3C ${name}`);
  const stage3bHashes={wasm:EXPECTED.stage3bWasm,ledger:EXPECTED.stage3bLedger,analysis:EXPECTED.stage3bAnalysis};
  const mask0File=path.join(root,'.agent-state/issues/7/stage3b/mask0-equivalence.json');
  if(!fs.existsSync(mask0File)||sha256(mask0File)!==EXPECTED.mask0||readJson(mask0File).decision!=='STAGE3B_MASK0_EQUIVALENCE_COMPLETE')
    throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: accepted Stage3B mask-0 equivalence identity changed');
  return {
    schemaVersion:1,candidateId:CANDIDATE,sourceRevision:currentHead(root),productionSimd:true,
    productionWasmSha256:authoritative.hashes.productionWasmSha256,
    stage3aDiagnosticWasmSha256:EXPECTED.stage3aWasm,
    stage3bDiagnosticWasmSha256:EXPECTED.stage3bWasm,
    stage3bMask0EquivalenceSha256:EXPECTED.mask0,
    stage3cDiagnosticWasmSha256:sha256(wasm),
    configSha256:authoritative.hashes.configSha256,profileSha256:authoritative.hashes.profileSha256,
    presetsSha256:authoritative.hashes.presetsSha256,referenceFixtureSha256:authoritative.hashes.referenceFixtureSha256,
    preflightProvenanceSha256:sha256(preflightFile),
    preflightProvenanceClassification:productionProvenance.classification,
    stage3aEvidenceSha256:stage3aHashes,stage3bEvidenceSha256:stage3bHashes,
    pluginSourceSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c')),
    cmakeSourceSha256:sha256(path.join(root,'wasm/cmake/wasm_plugin.cmake')),
    captureEvaluatorSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs')),
    runnerSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3c-impedance-split-diagnostic.cjs')),
    cmakeCacheSha256:sha256(cachePath),
    buildRoot,stage3cWasmPath:wasm,authorizedEquivalenceRenders:EQUIVALENCE_COUNT,authorizedSplitRenders:SPLIT_COUNT,
    aggregateCount:Object.keys(stage3bEvidence.ledger.aggregates||{}).length
  };
}
function stage3bIdentity(root){
  const identity=stage3b.assertStage3AEvidenceIdentity(root);
  return identity;
}
function assertStableIdentity(expected,root=ROOT){
  const current=buildIdentity(root);
  if(!deepEqual(current,expected))throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: source/build/evidence identity changed during Stage3C');
  return current;
}
function ensureBuildIdentity(root=ROOT,{write=false}={}){
  const identity=buildIdentity(root),file=path.join(root,'.agent-state/issues/7/stage3c/build-identity.json');
  if(fs.existsSync(file)){
    const previous=readJson(file);
    if(!deepEqual(previous,identity))throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: persisted build identity differs from current build');
  }else if(write)writeJsonAtomic(file,identity);
  return {identity,file};
}
function stage3aBaseline(root=ROOT){return stage3b.loadStage3ABaseline(root).baseline;}
function stage3aSupplement(root=ROOT){return readJson(path.join(root,'.agent-state/issues/7/stage3a/supplemental-3-render-result.json'));}
function findStage3aRef(cell,baseline,supplement){
  if(cell.velocity===null){
    const row=supplement.rows.find(item=>item.pitch===cell.pitch&&Math.abs(item.velocityNormalized-cell.velocityNormalized)<1e-12);
    if(!row)throw new Error(`BLOCKED_STAGE3C_BASELINE_IDENTITY: missing Stage3A supplement coordinate ${cell.pitch}:${cell.velocityNormalized}`);
    return row;
  }
  const row=baseline.get(`${cell.pitch}:${cell.velocity}`);
  if(!row)throw new Error(`BLOCKED_STAGE3C_BASELINE_IDENTITY: missing Stage3A coordinate ${cell.pitch}:${cell.velocity}`);
  return row;
}
function findStage3bRef(cell,analysis){
  const row=analysis.diagnosticRows.find(item=>item.stage3bMask===1&&item.pitch===cell.pitch
    &&(cell.velocity===null?Math.abs(item.velocityNormalized-cell.velocityNormalized)<1e-12:item.velocity===cell.velocity));
  if(!row)throw new Error(`BLOCKED_STAGE3C_BASELINE_IDENTITY: missing Stage3B mask1 coordinate ${cell.pitch}:${cell.velocity??cell.velocityNormalized}`);
  return row;
}
function pathsForIdentity(cell,identity){
  const refWindow=cell.stage3cMask===0?null:[30,180];
  return {includeSoundboardDiagnostics:true,includeVelocityDerivative:true,
    velocityDerivativeStartMs:refWindow?.[0]??0,velocityDerivativeEndMs:refWindow?.[1]??160,
    stage2mFactorMask:3,stage3cVariantMask:cell.stage3cMask};
}
function renderCell(cell,identity){
  const options={...pathsForIdentity(cell,identity)};
  const metrics=cell.velocity===null
    ?capture.renderNormalized(cell.pitch,cell.velocityNormalized,{},options)
    :capture.render(cell.pitch,cell.velocity,{},options);
  if(metrics.stage3cVariantMask!==cell.stage3cMask||metrics.stage2mFactorMask!==3||metrics.outputGuardHits===null)
    throw new Error('BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: capture omitted/misreported diagnostic masks or guard data');
  return metrics;
}
function makeLedger(identity,cells,phase){
  const authorized=assertUnique(cells,cells.length,phase);
  return {schemaVersion:1,phase,candidateId:CANDIDATE,identity,identitySha256:hashText(JSON.stringify(identity)),
    authorizedRenderCount:authorized.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    cells:Object.fromEntries(authorized.map(cell=>[keyOf(cell),{identity:cell,state:'PENDING',path:null,sha256:null}])),
    accounting:{newRenderCalls:0,productionCandidateDelta:0,stage4Renders:0}};
}
function loadOrCreateLedger(paths,identity,cells,phase,{allowCreate=true}={}){
  if(!fs.existsSync(paths.ledger)){
    if(!allowCreate)throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: missing ${phase} ledger`);
    const ledger=makeLedger(identity,cells,phase);writeJsonAtomic(paths.ledger,ledger);return ledger;
  }
  const ledger=readJson(paths.ledger),expected=assertUnique(cells,cells.length,phase),keys=Object.keys(ledger.cells||{});
  if(ledger.phase!==phase||ledger.candidateId!==CANDIDATE||ledger.identitySha256!==hashText(JSON.stringify(identity))
      ||!deepEqual(ledger.identity,identity)||ledger.authorizedRenderCount!==expected.length
      ||keys.length!==expected.length||expected.some(cell=>!ledger.cells[keyOf(cell)]||!deepEqual(ledger.cells[keyOf(cell)].identity,cell)))
    throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: ${phase} ledger identity/authorization mismatch`);
  return ledger;
}
function validateCompletedCell(paths,ledger,cell,identity){
  const entry=ledger.cells[keyOf(cell)];
  if(entry?.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: incomplete cell ${keyOf(cell)}`);
  const file=path.join(paths.dir,entry.path||path.relative(paths.dir,cellPath(paths,cell)));
  if(!fs.existsSync(file)||sha256(file)!==entry.sha256)throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: cell hash mismatch ${keyOf(cell)}`);
  const row=readJson(file);
  if(!deepEqual(row.identity,identity)||!deepEqual(row.cell,cell)||!row.metrics
      ||row.metrics.stage3cVariantMask!==cell.stage3cMask||row.metrics.stage2mFactorMask!==3)
    throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: cell identity mismatch ${keyOf(cell)}`);
  return row;
}
function inspectLedger(paths,ledger,cells,identity){
  if(ledger.status==='BLOCKED')throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: ledger is blocked (${ledger.lastError||'unspecified'})`);
  const c=counts(ledger);
  if(c.IN_PROGRESS)throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: ambiguous IN_PROGRESS ${Object.entries(ledger.cells).find(([,v])=>v.state==='IN_PROGRESS')?.[0]}`);
  const budget=cells.length;
  if(!Number.isInteger(ledger.accounting?.newRenderCalls)||ledger.accounting.newRenderCalls<0||ledger.accounting.newRenderCalls>budget
      ||ledger.accounting.newRenderCalls!==c.COMPLETE)
    throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: render accounting mismatch ${JSON.stringify({renders:ledger.accounting?.newRenderCalls,complete:c.COMPLETE,budget})}`);
  for(const cell of cells)if(ledger.cells[keyOf(cell)]?.state==='COMPLETE')validateCompletedCell(paths,ledger,cell,identity);
  return c;
}
function getPath(object,dotted){return dotted.split('.').reduce((value,key)=>value==null?undefined:value[key],object);}
const EQUIVALENCE_NUMERIC_FIELDS=['envelopeDbfs.0','envelopeDbfs.1','envelopeDbfs.2','envelopeDbfs.3','envelopeDbfs.4',
  'spectralCentroidHz','above2kPowerRatio','peakDbfs','fullRenderPeakDbfs','velocityDerivative',
  ...HAMMER_FIELDS.map(field=>`stage2mHammer.${field}`),...DIAGNOSTIC_SIGNALS.flatMap(name=>[
    `soundboardDiagnostics.signals.${name}.rms`,`soundboardDiagnostics.signals.${name}.peak`])];
const EQUIVALENCE_EXACT_FIELDS=['finite','outputGuardHits','velocityDerivativeWindowMs','stage2mFactorMask','soundboardDiagnostics.frames'];
function compareMetrics(actual,expected){
  const differences={};let max=0;
  for(const field of EQUIVALENCE_NUMERIC_FIELDS){const a=getPath(actual,field),e=getPath(expected,field);
    if(typeof a!=='number'||typeof e!=='number'||!Number.isFinite(a)||!Number.isFinite(e))throw new Error(`equivalence field missing/non-finite: ${field}`);
    differences[field]=Math.abs(a-e);max=Math.max(max,differences[field]);}
  for(const field of EQUIVALENCE_EXACT_FIELDS){const a=getPath(actual,field),e=getPath(expected,field);
    if(a===undefined||e===undefined||!deepEqual(a,e))throw new Error(`equivalence exact field mismatch: ${field}`);}
  return {pass:max<=TOLERANCE,maxMetricDifference:max,differences};
}
function equivalenceReference(cell,baseline,supplement,analysis){return cell.stage3cMask===0?findStage3aRef(cell,baseline,supplement):findStage3bRef(cell,analysis);}
function makeEquivalenceEvaluation(paths,ledger,identity,inputs){
  const rows=EQUIVALENCE_CELLS.map(cell=>{
    const persisted=validateCompletedCell(paths,ledger,cell,identity),expected=equivalenceReference(cell,inputs.baseline,inputs.supplement,inputs.stage3b.analysis);
    try{
      const comparison=compareMetrics(persisted.metrics,expected.metrics);
      return {cell,comparison,finite:persisted.metrics.finite===true,guardHits:persisted.metrics.outputGuardHits,
        peakDbfs:persisted.metrics.peakDbfs,fullRenderPeakDbfs:persisted.metrics.fullRenderPeakDbfs,result:comparison.pass?'PASS':'FAIL'};
    }catch(error){return {cell,result:'FAIL',error:String(error.message||error),finite:persisted.metrics.finite===true,
      guardHits:persisted.metrics.outputGuardHits,peakDbfs:persisted.metrics.peakDbfs,fullRenderPeakDbfs:persisted.metrics.fullRenderPeakDbfs};}
  });
  const maxMetricDifference=Math.max(...rows.map(row=>row.comparison?.maxMetricDifference??Infinity));
  const pass=rows.length===20&&rows.every(row=>row.result==='PASS'&&row.finite)&&maxMetricDifference<=TOLERANCE;
  return {schemaVersion:1,decision:pass?'STAGE3C_EQUIVALENCE_COMPLETE':'BLOCKED_STAGE3C_EQUIVALENCE',candidateId:CANDIDATE,
    identitySha256:ledger.identitySha256,authorizedRenderCount:20,completedCellCount:rows.length,stage2mFactorMask:3,
    stage3cMasks:[0,3],equivalenceTolerance:TOLERANCE,maxMetricDifference,rows,
    stage3aEvidenceSha256:identity.stage3aEvidenceSha256,stage3bEvidenceSha256:identity.stage3bEvidenceSha256,
    productionCandidateDelta:0,stage4Renders:0,finalizedAt:new Date().toISOString()};
}
function loadInputs(root=ROOT){
  const baseline=stage3aBaseline(root),supplement=stage3aSupplement(root),stage3b=stage3bBaseline(root);
  return {baseline,supplement,stage3b};
}
function ensureEquivalence(paths,identity,inputs){
  if(!fs.existsSync(paths.result))throw new Error('BLOCKED_STAGE3C_EQUIVALENCE: complete the 20-render equivalence gate first');
  const result=readJson(paths.result);
  if(result.decision!=='STAGE3C_EQUIVALENCE_COMPLETE'||result.identitySha256!==hashText(JSON.stringify(identity))
      ||result.completedCellCount!==20||result.maxMetricDifference>TOLERANCE||result.equivalenceTolerance!==TOLERANCE)
    throw new Error('BLOCKED_STAGE3C_EQUIVALENCE: persisted equivalence result failed validation');
  for(const cell of EQUIVALENCE_CELLS)validateCompletedCell(paths,readJson(paths.ledger),cell,identity);
  return {result,sha256:sha256(paths.result)};
}
function makeAggregate(paths,ledger,identity,mask,kind,pitch,cells){
  const file=path.join(paths.aggregates,`mask-${mask}`,`${kind}-midi-${String(pitch).padStart(3,'0')}.json`);
  const rows=cells.map(cell=>validateCompletedCell(paths,ledger,cell,identity));
  const aggregate={schemaVersion:1,identitySha256:ledger.identitySha256,mask,kind,pitch,cellCount:rows.length,
    cells:rows.map(row=>({cell:row.cell,cellSha256:sha256(path.join(paths.dir,ledger.cells[keyOf(row.cell)].path))})),createdAt:new Date().toISOString()};
  writeJsonAtomic(file,aggregate);
  ledger.aggregates[keyOf({kind,pitch,stage3cMask:mask,velocity:null,velocityNormalized:0})]={path:path.relative(paths.dir,file),sha256:sha256(file),cellCount:rows.length};
}
function ensureAggregates(paths,ledger,identity,cells){
  ledger.aggregates??={};
  const groups=new Map();
  for(const cell of cells){const key=keyOf({...cell,velocity:null,velocityNormalized:0});if(!groups.has(key))groups.set(key,[]);groups.get(key).push(cell);}
  for(const group of groups.values()){
    if(!group.every(cell=>ledger.cells[keyOf(cell)].state==='COMPLETE'))continue;
    const sample=group[0],key=keyOf({...sample,velocity:null,velocityNormalized:0});
    const entry=ledger.aggregates[key],file=path.join(paths.aggregates,`mask-${sample.stage3cMask}`,`${sample.kind}-midi-${String(sample.pitch).padStart(3,'0')}.json`);
    if(entry){
      if(!fs.existsSync(file)||entry.path!==path.relative(paths.dir,file)||entry.sha256!==sha256(file)||entry.cellCount!==group.length)
        throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: aggregate evidence mismatch ${key}`);
    }else{
      if(fs.existsSync(file))throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: unbound aggregate evidence ${key}`);
      makeAggregate(paths,ledger,identity,sample.stage3cMask,sample.kind,sample.pitch,group);
    }
  }
  writeJsonAtomic(paths.ledger,ledger);
}
function checkNoNonfinite(metrics){
  if(metrics.finite!==true||!Number.isFinite(metrics.peakDbfs)||!Number.isFinite(metrics.fullRenderPeakDbfs))return false;
  if(!Number.isInteger(metrics.outputGuardHits)||metrics.outputGuardHits<0)return false;
  return true;
}
function persistRender(paths,ledger,cell,identity,metrics){
  const key=keyOf(cell),entry=ledger.cells[key];
  const row={schemaVersion:1,candidateId:CANDIDATE,cell,identity,metrics,capturedAt:new Date().toISOString(),
    safe:metrics.finite===true&&metrics.outputGuardHits===0&&metrics.peakDbfs<0&&metrics.fullRenderPeakDbfs<0};
  const file=cellPath(paths,cell);writeJsonAtomic(file,row);
  entry.state='COMPLETE';entry.path=path.relative(paths.dir,file);entry.sha256=sha256(file);entry.completedAt=new Date().toISOString();
  ledger.accounting.newRenderCalls+=1;ledger.updatedAt=new Date().toISOString();writeJsonAtomic(paths.ledger,ledger);
  return row;
}
function executeCells({paths,cells,identity,root=ROOT,renderOptions,progress=()=>{},phase}){
  const ledger=loadOrCreateLedger(paths,identity,cells,phase);
  let currentCounts=inspectLedger(paths,ledger,cells,identity),renderCalls=0;
  for(const cell of cells){
    const entry=ledger.cells[keyOf(cell)];
    if(entry.state==='COMPLETE')continue;
    if(entry.state==='IN_PROGRESS')throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: ambiguous IN_PROGRESS ${keyOf(cell)}`);
    const current=assertStableIdentity(identity,root);
    if(!deepEqual(current,identity))throw new Error('BLOCKED_STAGE3C_BASELINE_IDENTITY: authorization changed before render');
    entry.state='IN_PROGRESS';entry.startedAt=new Date().toISOString();ledger.updatedAt=new Date().toISOString();writeJsonAtomic(paths.ledger,ledger);
    const options=renderOptions(cell);
    let metrics;
    try{metrics=cell.velocity===null?capture.renderNormalized(cell.pitch,cell.velocityNormalized,{},options):capture.render(cell.pitch,cell.velocity,{},options);}
    catch(error){throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: capture failed at ${keyOf(cell)} after IN_PROGRESS: ${error.message||error}`);}
    if(metrics.stage3cVariantMask!==cell.stage3cMask||metrics.stage2mFactorMask!==3)
      throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: mask readback mismatch ${keyOf(cell)}`);
    if(!checkNoNonfinite(metrics)){
      persistRender(paths,ledger,cell,identity,metrics);renderCalls++;
      ledger.status='BLOCKED';ledger.lastError=`nonfinite diagnostic ${keyOf(cell)}`;ledger.updatedAt=new Date().toISOString();writeJsonAtomic(paths.ledger,ledger);
      throw new Error(`BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC: invalid finite/peak/guard telemetry ${keyOf(cell)}`);
    }
    persistRender(paths,ledger,cell,identity,metrics);renderCalls++;progress(`${phase} ${renderCalls} mask ${cell.stage3cMask} MIDI ${cell.pitch} ${cell.velocity??cell.velocityNormalized}`);
    if(phase==='split'){
      const group=cells.filter(row=>row.stage3cMask===cell.stage3cMask&&row.kind===cell.kind&&row.pitch===cell.pitch);
      if(group.every(row=>ledger.cells[keyOf(row)].state==='COMPLETE')){
        ledger.aggregates??={};makeAggregate(paths,ledger,identity,cell.stage3cMask,cell.kind,cell.pitch,group);writeJsonAtomic(paths.ledger,ledger);
      }
    }
  }
  currentCounts=inspectLedger(paths,ledger,cells,identity);
  if(phase==='split')ensureAggregates(paths,ledger,identity,cells);
  currentCounts=inspectLedger(paths,ledger,cells,identity);
  return {ledger,renderCalls,counts:currentCounts,ledgerSha256:sha256(paths.ledger)};
}
function finalizeEquivalence(root=ROOT){
  const {identity}=ensureBuildIdentity(root),paths=eqPaths(path.join(root,'.agent-state/issues/7/stage3c'));
  const inputs=loadInputs(root),ledger=loadOrCreateLedger(paths,identity,expectedEquivalenceCells(),'equivalence',{allowCreate:false});
  if(!deepEqual(counts(ledger),{PENDING:0,IN_PROGRESS:0,COMPLETE:20}))throw new Error('BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: equivalence is not 20/20 complete');
  const result=makeEquivalenceEvaluation(paths,ledger,identity,inputs);
  if(fs.existsSync(paths.result)){
    const previous=readJson(paths.result);
    if(previous.decision==='STAGE3C_EQUIVALENCE_COMPLETE'&&result.decision==='STAGE3C_EQUIVALENCE_COMPLETE'&&previous.identitySha256===result.identitySha256)
      return previous;
  }
  writeJsonAtomic(paths.result,result);
  if(!result.decision.startsWith('STAGE3C_EQUIVALENCE_COMPLETE'))throw new Error(`${result.decision}: max difference ${result.maxMetricDifference}`);
  return result;
}
function rowMetrics(row){return row.metrics;}
function coordinateKey(row){return row.velocity===null?`${row.pitch}:n${row.velocityNormalized}`:`${row.pitch}:v${row.velocity}`;}
function findRow(rows,cell){return rows.find(row=>row.pitch===cell.pitch&&(cell.velocity===null?row.velocity===null&&Math.abs(row.velocityNormalized-cell.velocityNormalized)<1e-12:row.velocity===cell.velocity));}
function stage3bRowFor(cell,analysis){return findRow(analysis.diagnosticRows.filter(row=>row.stage3bMask===1),cell);}
function stage3aRowFor(cell,baseline,supplement){return findStage3aRef(cell,baseline,supplement);}
function envelopeLevel(row){const value=rowMetrics(row).envelopeDbfs?.[3];if(typeof value!=='number'||!Number.isFinite(value))throw new Error('required 80-200 ms envelope level missing');return value;}
function velocitySpan(rows){const values=rows.map(envelopeLevel);return Math.max(...values)-Math.min(...values);}
function factorial(m0,mc,mb,mi){return {M0:m0,MC:mc,MB:mb,MI:mi,C_main:((mc-m0)+(mi-mb))/2,B_main:((mb-m0)+(mi-mc))/2,interaction:mi-mb-mc+m0,
  C_improvement:-((mc-m0)+(mi-mb))/2,B_improvement:-((mb-m0)+(mi-mc))/2};}
function benefitOrigin(c,b){return c>0&&b>0?'BOTH':c>0?'CONTACT':b>0?'BRIDGE':'NEITHER';}
function safetySummary(rows){
  const unsafe=rows.filter(row=>{const m=rowMetrics(row);return m.finite!==true||m.outputGuardHits!==0||m.peakDbfs>=0||m.fullRenderPeakDbfs>=0;});
  return {cellCount:rows.length,unsafeCellCount:unsafe.length,guardHitTotal:rows.reduce((sum,row)=>sum+(rowMetrics(row).outputGuardHits||0),0),
    worstPeakDbfs:Math.max(...rows.map(row=>rowMetrics(row).fullRenderPeakDbfs)),firstUnsafeVelocity:unsafe.length?unsafe[0].velocity??unsafe[0].velocityNormalized:null,
    lastUnsafeVelocity:unsafe.length?unsafe.at(-1).velocity??unsafe.at(-1).velocityNormalized:null,
    unsafeCells:unsafe.map(row=>row.cell?keyOf(row.cell):`mask-${row.stage3bMask}:midi-${String(row.pitch).padStart(3,'0')}:${row.velocity??row.velocityNormalized}`)};
}
function aggregateSpanTable(pitch,baseline,stage3bAnalysis,stage3cRows){
  const baseSpan=stage3bAnalysis.spanTables.find(row=>row.pitch===pitch);
  if(!baseSpan)throw new Error(`Stage3B span reference missing MIDI ${pitch}`);
  const coords=DYNAMIC_VELOCITIES.map(velocity=>({kind:'dynamic',pitch,velocity}));
  const getMaskRows=mask=>coords.map(cell=>{
    const row=stage3cRows.find(item=>item.cell.stage3cMask===mask&&item.cell.pitch===pitch&&item.cell.velocity===cell.velocity);
    if(!row)throw new Error(`Stage3C dynamic cell missing ${pitch}:${cell.velocity}:mask${mask}`);return row;
  });
  const stage3aRows=coords.map(cell=>stage3aRowFor(cell,baseline,null));
  const oldI=stage3bAnalysis.diagnosticRows.filter(row=>row.stage3bMask===1&&row.pitch===pitch);
  const refSpan=baseSpan.spanByMask.M0.referenceSpanDb;
  const spanError=(renderRows)=>{const span=velocitySpan(renderRows);return {synthSpanDb:span,referenceSpanDb:refSpan,signedSpanDifferenceDb:span-refSpan,absoluteSpanErrorDb:Math.abs(span-refSpan)};};
  const m0=spanError(stage3aRows),mc=spanError(getMaskRows(1)),mb=spanError(getMaskRows(2)),mi=spanError(oldI);
  const f=factorial(m0.absoluteSpanErrorDb,mc.absoluteSpanErrorDb,mb.absoluteSpanErrorDb,mi.absoluteSpanErrorDb);
  return {pitch,stringCount:baseSpan.stringCount,group:baseSpan.group,spanByMask:{M0:m0,MC:mc,MB:mb,MI:mi},factorial:f,
    benefitOrigin:([51,54].includes(pitch)?benefitOrigin(f.C_improvement,f.B_improvement):undefined)};
}
function flattenMetric(row,name){
  if(name==='bridge_b RMS')return rowMetrics(row).soundboardDiagnostics?.signals?.bridge_b?.rms;
  if(name==='board_drive_b RMS')return rowMetrics(row).soundboardDiagnostics?.signals?.board_drive_b?.rms;
  if(name==='post_radiation_l RMS')return rowMetrics(row).soundboardDiagnostics?.signals?.post_radiation_l?.rms;
  if(name==='spectralCentroidHz'||name==='above2kPowerRatio')return rowMetrics(row)[name];
  return rowMetrics(row).stage2mHammer?.[name];
}
function sourceRowFor(cell,source,baseline,supplement,stage3bRows,stage3cRows,mask){
  if(source==='M0')return stage3aRowFor(cell,baseline,supplement);
  if(source==='MI')return stage3bRowFor(cell,{diagnosticRows:stage3bRows});
  const found=stage3cRows.find(row=>row.cell.stage3cMask===mask&&coordinateKey(row.cell)===coordinateKey(cell));
  if(!found)throw new Error(`Stage3C path row missing ${keyOf({...cell,stage3cMask:mask})}`);return found;
}
function scalarAttribution(stage3aRows,stage3bRows,stage3cRows,baseline,supplement){
  const outputs={};
  for(const name of PATH_METRICS){
    const factors=[];
    for(const cell of SPLIT_CELLS.filter(row=>row.stage3cMask===1)){
      const m0=flattenMetric(sourceRowFor(cell,'M0',baseline,supplement,stage3bRows,stage3cRows,0),name);
      const mc=flattenMetric(sourceRowFor(cell,'MC',baseline,supplement,stage3bRows,stage3cRows,1),name);
      const mb=flattenMetric(sourceRowFor(cell,'MB',baseline,supplement,stage3bRows,stage3cRows,2),name);
      const mi=flattenMetric(sourceRowFor(cell,'MI',baseline,supplement,stage3bRows,stage3cRows,0),name);
      if([m0,mc,mb,mi].some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error(`path attribution metric missing: ${name}`);
      factors.push(factorial(m0,mc,mb,mi));
    }
    outputs[name]={I_main:mean(factors.map(row=>row.C_main)),B_main:mean(factors.map(row=>row.B_main)),
      interaction:mean(factors.map(row=>row.interaction)),meanAbsoluteInteraction:mean(factors.map(row=>Math.abs(row.interaction))),
      cellCount:factors.length};
  }
  return outputs;
}
function mean(values){return values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);}
function trebleRows(stage3aRows,stage3bRows,stage3cRows,baseline,supplement,analysis){
  const out=[];
  for(const pitch of TREBLE_PITCHES)for(const velocity of TREBLE_VELOCITIES){
    const cell={kind:'treble',pitch,velocity};
    const m0=stage3aRowFor(cell,baseline,supplement),mi=stage3bRowFor(cell,analysis);
    const referenceDbfs=analysis.trebleGuardrail.find(row=>row.pitch===pitch&&row.velocity===velocity)?.errors.M0.referenceDbfs;
    if(!Number.isFinite(referenceDbfs))throw new Error(`missing direct-level reference ${pitch}:${velocity}`);
    const direct=row=>envelopeLevel(row)-referenceDbfs;
    const mc=sourceRowFor(cell,'MC',baseline,supplement,stage3bRows,stage3cRows,1),mb=sourceRowFor(cell,'MB',baseline,supplement,stage3bRows,stage3cRows,2);
    const f=factorial(direct(m0),direct(mc),direct(mb),direct(mi));
    out.push({pitch,velocity,referenceDbfs,directLevelErrorDb:{M0:direct(m0),MC:direct(mc),MB:direct(mb),MI:direct(mi)},factorial:f,
      safety:{MC:rowMetrics(mc).finite===true&&rowMetrics(mc).outputGuardHits===0&&rowMetrics(mc).peakDbfs<0&&rowMetrics(mc).fullRenderPeakDbfs<0,
        MB:rowMetrics(mb).finite===true&&rowMetrics(mb).outputGuardHits===0&&rowMetrics(mb).peakDbfs<0&&rowMetrics(mb).fullRenderPeakDbfs<0}});
  }
  return out;
}
function midi41Rows(stage3aRows,stage3bRows,stage3cRows,baseline,supplement,analysis){
  return MIDI41_NORMALIZED.map(velocityNormalized=>{
    const cell={kind:'midi41',pitch:41,velocity:null,velocityNormalized};
    const m0=stage3aRowFor(cell,baseline,supplement),mi=stage3bRowFor(cell,analysis);
    const mc=sourceRowFor(cell,'MC',baseline,supplement,stage3bRows,stage3cRows,1),mb=sourceRowFor(cell,'MB',baseline,supplement,stage3bRows,stage3cRows,2);
    const f=factorial(rowMetrics(m0).velocityDerivative,rowMetrics(mc).velocityDerivative,rowMetrics(mb).velocityDerivative,rowMetrics(mi).velocityDerivative);
    return {pitch:41,velocityNormalized,velocityDerivativeWindowMs:[30,180],derivatives:{M0:f.M0,MC:f.MC,MB:f.MB,MI:f.MI},factorial:f};
  });
}
function calculateAttribution({identity,ledger,stage3cRows,root=ROOT}){
  const inputs=loadInputs(root),analysis=inputs.stage3b.analysis,stage3bRows=analysis.diagnosticRows.filter(row=>row.stage3bMask===1);
  const spanTables=DYNAMIC_PITCHES.map(pitch=>aggregateSpanTable(pitch,inputs.baseline,analysis,stage3cRows));
  const safety={};
  for(const mask of [1,2])for(const pitch of [...DYNAMIC_PITCHES,...TREBLE_PITCHES,41]){
    const cells=stage3cRows.filter(row=>row.cell.stage3cMask===mask&&row.cell.pitch===pitch);
    if(cells.length)safety[`mask-${mask}:midi-${pitch}`]=safetySummary(cells);
  }
  const fullISafety={};
  for(const pitch of [...DYNAMIC_PITCHES,...TREBLE_PITCHES,41]){
    const rows=stage3bRows.filter(row=>row.pitch===pitch&&row.stage3bMask===1);
    if(rows.length)fullISafety[`midi-${pitch}`]=safetySummary(rows);
  }
  const safetyOrigin=classifySafety(safety,fullISafety);
  const trebleGuardrail=trebleRows(null,stage3bRows,stage3cRows,inputs.baseline,inputs.supplement,analysis);
  const midi41=midi41Rows(null,stage3bRows,stage3cRows,inputs.baseline,inputs.supplement,analysis);
  const pathAttribution=scalarAttribution(null,stage3bRows,stage3cRows,inputs.baseline,inputs.supplement);
  const dynamicSubgroups={twoString:spanTables.filter(row=>row.stringCount===2).map(row=>({pitch:row.pitch,C_improvement:row.factorial.C_improvement,B_improvement:row.factorial.B_improvement})),
    threeString:spanTables.filter(row=>row.stringCount===3).map(row=>({pitch:row.pitch,C_improvement:row.factorial.C_improvement,B_improvement:row.factorial.B_improvement}))};
  return {schemaVersion:1,decision:'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE',candidateId:CANDIDATE,identity,
    equivalenceSha256:sha256(path.join(root,'.agent-state/issues/7/stage3c/equivalence.json')),
    accounting:{stage3aHistoricalCalls:390,stage3bMask0Calls:6,stage3bFactorCalls:477,stage3cEquivalenceCalls:20,stage3cSplitCalls:ledger.accounting.newRenderCalls,
      cumulativeDiagnosticCalls:390+6+477+20+ledger.accounting.newRenderCalls,authorizedStage3cEquivalence:20,authorizedStage3cSplit:286,
      physicalCandidateDelta:0,stage4Renders:0},
    safety:{safetyOrigin,byStage3cMaskAndPitch:safety,fullIByPitch:fullISafety},dynamicSpan:{spanTables,subgroups:dynamicSubgroups,
      keyBenefitOrigins:Object.fromEntries(spanTables.filter(row=>row.benefitOrigin).map(row=>[String(row.pitch),row.benefitOrigin]))},
    trebleGuardrail,midi41,pathAttribution,stage3bAggregateCount:identity.aggregateCount,
    ledgerSha256:sha256(path.join(root,'.agent-state/issues/7/stage3c/split/ledger.json')),
    productionCandidateDelta:0,stage4Renders:0,finalizedAt:new Date().toISOString()};
}
function classifySafety(bySplit,fullI){
  const c=Object.entries(bySplit).filter(([key])=>key.startsWith('mask-1:')).reduce((sum,[,row])=>sum+row.unsafeCellCount,0)>0;
  const b=Object.entries(bySplit).filter(([key])=>key.startsWith('mask-2:')).reduce((sum,[,row])=>sum+row.unsafeCellCount,0)>0;
  const i=Object.values(fullI).some(row=>row.unsafeCellCount>0);
  return c&&b?'BOTH':c?'CONTACT':b?'BRIDGE':i?'INTERACTION':'NONE';
}
function finalizeSplit(root=ROOT){
  const {identity}=ensureBuildIdentity(root),eq=eqPaths(path.join(root,'.agent-state/issues/7/stage3c'));
  const eqResult=ensureEquivalence(eq,identity,loadInputs(root));
  const paths=splitPaths(path.join(root,'.agent-state/issues/7/stage3c'));
  const ledger=loadOrCreateLedger(paths,identity,expectedSplitCells(),'split',{allowCreate:false});
  const c=inspectLedger(paths,ledger,expectedSplitCells(),identity);
  if(!deepEqual(c,{PENDING:0,IN_PROGRESS:0,COMPLETE:SPLIT_COUNT}))throw new Error(`BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: split counts ${JSON.stringify(c)}`);
  const rows=SPLIT_CELLS.map(cell=>validateCompletedCell(paths,ledger,cell,identity));
  const expectedAggregateCount=24;
  if(Object.keys(ledger.aggregates||{}).length!==expectedAggregateCount)throw new Error('BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: required per-mask/pitch aggregates are incomplete');
  for(const entry of Object.values(ledger.aggregates))if(!fs.existsSync(path.join(paths.dir,entry.path))||sha256(path.join(paths.dir,entry.path))!==entry.sha256)
    throw new Error('BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: aggregate hash mismatch');
  if(rows.some(row=>row.metrics.finite!==true))throw new Error('BLOCKED_STAGE3C_NONFINITE_DIAGNOSTIC: non-finite split cell');
  const result=calculateAttribution({identity,ledger,stage3cRows:rows,root});
  result.equivalenceDecision=eqResult.decision;
  writeJsonAtomic(paths.result,result);
  return result;
}
function dryRun(root=ROOT){
  const {identity}=ensureBuildIdentity(root),eq=eqPaths(path.join(root,'.agent-state/issues/7/stage3c')),split=splitPaths(path.join(root,'.agent-state/issues/7/stage3c'));
  const eqCounts=fs.existsSync(eq.ledger)?inspectLedger(eq,readJson(eq.ledger),EQUIVALENCE_CELLS,identity):{PENDING:20,IN_PROGRESS:0,COMPLETE:0};
  const splitCounts=fs.existsSync(split.ledger)?inspectLedger(split,readJson(split.ledger),SPLIT_CELLS,identity):{PENDING:286,IN_PROGRESS:0,COMPLETE:0};
  return {decision:'STAGE3C_DRY_RUN_READY',builds:0,renders:0,acousticRenders:0,authorizedEquivalenceRenders:20,
    authorizedSplitRenders:286,maximumNewCalls:306,equivalenceCounts:eqCounts,splitCounts,
    equivalenceCells:EQUIVALENCE_CELLS,splitIdentityCount:SPLIT_COUNT,masks:[1,2],mask0AndMask3SplitRenders:0,identity};
}
function run({mode,root=ROOT,progress=()=>{}}){
  if(EQUIVALENCE_COUNT!==20||SPLIT_COUNT!==286)throw new Error('BLOCKED_STAGE3C_DIAGNOSTIC_EVIDENCE: authorization matrix count changed');
  if(mode==='dry-run')return dryRun(root);
  const {identity}=ensureBuildIdentity(root,{write:true});
  const eq=eqPaths(path.join(root,'.agent-state/issues/7/stage3c'));
  if(mode==='equivalence'){
    const result=executeCells({paths:eq,cells:EQUIVALENCE_CELLS,identity,root,phase:'equivalence',progress,
      renderOptions:cell=>pathsForIdentity(cell,identity)});
    const eqResult=finalizeEquivalence(root);
    return {...result,decision:eqResult.decision,equivalenceSha256:sha256(eq.result),authorizedRenders:20,renderCalls:result.renderCalls};
  }
  if(mode==='execute'){
    ensureEquivalence(eq,identity,loadInputs(root));
    const paths=splitPaths(path.join(root,'.agent-state/issues/7/stage3c'));
    const result=executeCells({paths,cells:SPLIT_CELLS,identity,root,phase:'split',progress,
      renderOptions:cell=>({stage2mFactorMask:3,stage3cVariantMask:cell.stage3cMask,includeSoundboardDiagnostics:true,
        includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180})});
    return {...result,decision:result.counts.COMPLETE===286?'STAGE3C_SPLIT_RENDERING_COMPLETE':'STAGE3C_SPLIT_RENDERING_INCOMPLETE',authorizedRenders:286};
  }
  if(mode==='finalize')return finalizeSplit(root);
  throw new Error(`unsupported mode ${mode}`);
}
function stage3bIdentity(root){
  const a=stage3b.assertStage3AEvidenceIdentity(root);
  return {identity:a.identity,hashes:{ledger:EXPECTED.stage3bLedger,analysis:EXPECTED.stage3bAnalysis,stage3a:a.identity}};
}
function main(){
  const mode=modeFromArgs(process.argv.slice(2)),result=run({mode,progress:message=>process.stderr.write(`${message}\n`)});
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`Stage3C impedance split ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}}

module.exports={ROOT,CANDIDATE,REQUIRED_HEAD,EXPECTED,TOLERANCE,DYNAMIC_PITCHES,TREBLE_PITCHES,DYNAMIC_VELOCITIES,TREBLE_VELOCITIES,
  MIDI41_NORMALIZED,EQUIVALENCE_COORDS,EQUIVALENCE_CELLS,SPLIT_CELLS,EQUIVALENCE_COUNT,SPLIT_COUNT,DIAGNOSTIC_SIGNALS,HAMMER_FIELDS,PATH_METRICS,
  keyOf,fileName,eqPaths,splitPaths,expectedEquivalenceCells,expectedSplitCells,modeFromArgs,buildIdentity,assertStableIdentity,
  makeLedger,loadOrCreateLedger,counts,inspectLedger,compareMetrics,factorial,benefitOrigin,velocitySpan,safetySummary,classifySafety,
  calculateAttribution,finalizeEquivalence,finalizeSplit,dryRun,run};
