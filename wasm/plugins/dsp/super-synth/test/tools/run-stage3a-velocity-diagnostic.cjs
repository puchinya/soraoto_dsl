#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '../../../../../../');
const STAGE3_ROOT = path.join(ROOT, '.agent-state/issues/7/calibration-optuna/stage3');
const PRIVATE_ROOT = path.join(ROOT, '.agent-state/issues/7/stage3a');
const SUPPLEMENTAL_LEDGER_PATH = path.join(PRIVATE_ROOT, 'supplemental-3-render-ledger.json');
const SUPPLEMENTAL_RESULT_PATH = path.join(PRIVATE_ROOT, 'supplemental-3-render-result.json');
const CAPTURE_PATH = path.join(STAGE3_ROOT, 'direct-capture.json');
const EVALUATION_PATH = path.join(STAGE3_ROOT, 'direct-evaluation.json');
const FIXTURE_PATH = path.join(ROOT, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
const PRESETS_PATH = path.join(ROOT, 'wasm/plugins/dsp/super-synth/presets.json');
const PROFILE_PATH = path.join(ROOT, 'wasm/shared/generated/super-synth_grand_profiles.h');
const PRODUCTION_WASM = path.join(ROOT, 'build/wasm/plugins/dsp/super-synth/plugin.wasm');
const DIAGNOSTIC_WASM = path.join(ROOT, 'build/wasm-stage3a/plugins/dsp/super-synth/plugin.wasm');
const EXPECTED_WASM_SHA256 = '9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2';
const EXPECTED_CONFIG_SHA256 = '792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d';
const EXPECTED_STAGE3A_HEAD = '27be3eaa6bbba168a7c0830b5acc23ebcba77988';
const EXPECTED_PRESETS_SHA256 = 'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431';
const EXPECTED_PROFILE_SHA256 = 'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66';
const EXPECTED_FIXTURE_SHA256 = '5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7';
const MASK = 3;
const EQUIVALENCE_CELLS = [[36,14],[36,124],[51,14],[51,124],[96,31],[96,124]];
const MATRIX_PITCHES = [33,36,39,42,45,48,51,54,57,93,96,99];
const VELOCITIES = [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const MIDI41_NORMALIZED = [0.25,0.55,0.90];
const DIAGNOSTIC_SIGNALS = [
  'dry_transverse','dry_bridge','dry_contact','dry_longitudinal','dry_mix',
  'bridge_b','bridge_m','bridge_t','board_drive_b','board_drive_m','board_drive_t',
  'modal_l','modal_r','pre_radiation_l','pre_radiation_r','post_radiation_l','post_radiation_r',
  'longitudinal_bridge_drive'
];
const CLOSE = 1e-6;
const MIDI41_EXPECTED_DERIVATIVE = [0.06299055264228781,0.05389008449437237,0.24231471764008602];

function assertSupplementalCells(cells) {
  const expected = MIDI41_NORMALIZED.map(velocityNormalized=>`41:${velocityNormalized}`);
  const actual = cells.map(cell=>`${cell.pitch}:${cell.velocityNormalized}`);
  if (actual.length!==3 || new Set(actual).size!==3 || JSON.stringify(actual)!==JSON.stringify(expected)) {
    throw new Error('supplemental authorization permits exactly MIDI 41 at normalized velocities 0.25, 0.55, and 0.90');
  }
}

function writeJsonAtomic(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});
  fs.renameSync(temporary,file);
}

function gitHead(root) {
  return require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
}

function assertSupplementalIdentity(root) {
  if(gitHead(root)!==EXPECTED_STAGE3A_HEAD) throw new Error(`BLOCKED_STAGE3A_BASELINE_CHANGED: expected ${EXPECTED_STAGE3A_HEAD}`);
  const required=[PRODUCTION_WASM,DIAGNOSTIC_WASM,CAPTURE_PATH,EVALUATION_PATH,FIXTURE_PATH,PRESETS_PATH,PROFILE_PATH,
    path.join(root,'build/wasm-stage3a/CMakeCache.txt'),path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c')];
  for(const file of required) if(!fs.existsSync(file)) throw new Error(`BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCOMPLETE: missing ${path.relative(root,file)}`);
  const hashes={
    productionWasmSha256:sha256(PRODUCTION_WASM),
    presetsSha256:sha256(PRESETS_PATH),
    profileSha256:sha256(PROFILE_PATH),
    referenceFixtureSha256:sha256(FIXTURE_PATH),
    pluginSourceSha256:sha256(path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c')),
    diagnosticWasmSha256:sha256(DIAGNOSTIC_WASM)
  };
  if(hashes.productionWasmSha256!==EXPECTED_WASM_SHA256
      ||hashes.presetsSha256!==EXPECTED_PRESETS_SHA256
      ||hashes.profileSha256!==EXPECTED_PROFILE_SHA256
      ||hashes.referenceFixtureSha256!==EXPECTED_FIXTURE_SHA256)
    throw new Error(`BLOCKED_STAGE3A_PRODUCTION_IDENTITY: protected hash mismatch ${JSON.stringify(hashes)}`);
  const cache=fs.readFileSync(path.join(root,'build/wasm-stage3a/CMakeCache.txt'),'utf8');
  for(const option of ['SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS:BOOL=ON','SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS:BOOL=ON'])
    if(!cache.includes(option)) throw new Error(`BLOCKED_STAGE3A_DIAGNOSTIC_BUILD_IDENTITY_CHANGED: missing ${option}`);
  const exports=WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(DIAGNOSTIC_WASM))).map(item=>item.name);
  for(const name of ['soraoto_supersynth_stage2m_set_factor_mask','soraoto_supersynth_stage2m_get_factor_mask',
    'soraoto_supersynth_stage2m_hammer_diag_reset','soraoto_supersynth_stage2m_hammer_diag_value',
    'soraoto_supersynth_soundboard_diag_reset','soraoto_supersynth_soundboard_diag_sum_squares',
    'soraoto_supersynth_soundboard_diag_peak','soraoto_supersynth_soundboard_diag_frames'])
    if(!exports.includes(name)) throw new Error(`BLOCKED_STAGE3A_DIAGNOSTIC_BUILD_IDENTITY_CHANGED: missing diagnostic export ${name}`);
  const capture=readJson(CAPTURE_PATH),evaluation=readJson(EVALUATION_PATH);
  if(capture.render.wasmSha256!==EXPECTED_WASM_SHA256||evaluation.identity?.wasmSha256!==EXPECTED_WASM_SHA256
      ||evaluation.identity?.configSha256!==EXPECTED_CONFIG_SHA256
      ||evaluation.identity?.candidateId!=='stage2n-r3-candidate-01'
      ||capture.matrix.length!==480||evaluation.coverage?.captured!==480
      ||evaluation.capture?.stage3CandidateDelta!==0||evaluation.capture?.stage4Renders!==0)
    throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCOMPLETE: saved Stage3 candidate evidence is incompatible');
  return {head:gitHead(root),...hashes,diagnosticBuildOptions:{guardDiagnostics:true,stage2mDiagnostics:true},
    productionSimd:true,candidateId:evaluation.identity.candidateId,configSha256:evaluation.identity.configSha256,
    stage2lBudget:'1/12',stage2nBudget:'1/1',candidateDelta:0,stage3DirectCells:480};
}

function validateSupplementalRow(row,index) {
  const m=row.metrics;
  if(row.pitch!==41||row.velocityNormalized!==MIDI41_NORMALIZED[index]) throw new Error('supplemental render identity changed');
  if(m.stage2mFactorMask!==MASK||!m.stage2mHammer) throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCONSISTENT: factor mask 3 was not read back');
  if(JSON.stringify(m.velocityDerivativeWindowMs)!==JSON.stringify([30,180])) throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCONSISTENT: derivative interval is not exactly 30–180 ms');
  const hammer=['effectiveHardness','initialHammerVelocity','contactDurationSamples','peakForce','maxCompression','postContactTransverseEnergy'];
  for(const field of hammer) if(!Number.isFinite(m.stage2mHammer[field])) throw new Error(`missing hammer diagnostic ${field}`);
  for(const name of DIAGNOSTIC_SIGNALS){
    const signal=m.soundboardDiagnostics?.signals?.[name];
    if(!signal||!Number.isFinite(signal.rms)||!Number.isFinite(signal.peak)) throw new Error(`missing path diagnostic ${name}`);
  }
  if(!Array.isArray(m.envelopeDbfs)||m.envelopeDbfs.length!==5||!Number.isFinite(m.peakDbfs)
      ||m.finite!==true||m.outputGuardHits!==0) throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCONSISTENT: invalid acoustic/safety diagnostics');
  const difference=Math.abs(m.velocityDerivative-MIDI41_EXPECTED_DERIVATIVE[index]);
  return {...row,productionBaseline:MIDI41_EXPECTED_DERIVATIVE[index],absoluteDifference:difference,equivalencePass:difference<=CLOSE};
}

function runSupplemental({root=ROOT,dryRun=false,progress=()=>{}}={}) {
  const identity=assertSupplementalIdentity(root);
  const authorizedCells=MIDI41_NORMALIZED.map(velocityNormalized=>({pitch:41,velocityNormalized}));
  assertSupplementalCells(authorizedCells);
  if(fs.existsSync(SUPPLEMENTAL_LEDGER_PATH)) throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCONSISTENT: supplemental render ledger already exists; refusing any possible fourth render');
  if(fs.existsSync(SUPPLEMENTAL_RESULT_PATH)) throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCONSISTENT: supplemental result already exists; refusing rerender');
  if(dryRun) return {decision:'DRY_RUN',builds:0,renders:0,authorizedCells,identity};

  const ledger={schemaVersion:1,status:'IN_PROGRESS',authorizedCells,completed:[],identity};
  writeJsonAtomic(SUPPLEMENTAL_LEDGER_PATH,ledger);
  const priorBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  const {renderNormalized}=require('./capture-supersynth-matrix.cjs');
  const rows=[];
  try {
    for(let i=0;i<authorizedCells.length;i++){
      const {pitch,velocityNormalized}=authorizedCells[i];
      process.env.SORAOTO_WASM_BUILD_DIR=path.join(root,'build/wasm-stage3a');
      const metrics=renderNormalized(pitch,velocityNormalized,{}, {stage2mFactorMask:MASK,
        includeVelocityDerivative:true,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,
        includeSoundboardDiagnostics:true});
      const row=validateSupplementalRow({pitch,velocityNormalized,metrics},i);
      rows.push(row);
      ledger.completed.push({pitch,velocityNormalized,derivative:metrics.velocityDerivative,
        factorMask:metrics.stage2mFactorMask,finite:metrics.finite,outputGuardHits:metrics.outputGuardHits});
      writeJsonAtomic(SUPPLEMENTAL_LEDGER_PATH,ledger);
      progress(`supplemental ${rows.length}/3 MIDI41 ${velocityNormalized}`);
    }
  } catch(error) {
    ledger.status='BLOCKED';ledger.error=String(error.message||error);
    writeJsonAtomic(SUPPLEMENTAL_LEDGER_PATH,ledger);
    throw error;
  } finally {
    if(priorBuildDir===undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;
  }
  const currentIdentity=assertSupplementalIdentity(root);
  if(JSON.stringify(identity)!==JSON.stringify(currentIdentity)) throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_BUILD_IDENTITY_CHANGED: identity changed during supplemental renders');
  const decision=rows.length===3&&rows.every(row=>row.equivalencePass)?'SUPPLEMENTAL_RENDERS_VALID':'BLOCKED_STAGE3A_DIAGNOSTIC_BUILD_NON_EQUIVALENT';
  const result={schemaVersion:1,decision,identity,authorizedRenderCount:3,acceptedReplacementCount:rows.length,
    derivativeWindowMs:[30,180],mask:3,expectedDerivative:MIDI41_EXPECTED_DERIVATIVE,rows,
    accounting:{originalRenderCalls:195,supplementalReplacementCalls:rows.length,totalRenderCalls:195+rows.length,
      acceptedEvidenceRenders:192+rows.length,supersededRenders:3,physicalCandidateDelta:0,stage4Renders:0},
    reused:{stage3DirectCells:480,equivalenceCells:6,stage3aDiagnosticCells:192},
    stage3Decision:'BLOCKED_STAGE3_DIRECT_REFERENCE',fullStage3aCompletion:false};
  ledger.status='COMPLETE';writeJsonAtomic(SUPPLEMENTAL_LEDGER_PATH,ledger);
  writeJsonAtomic(SUPPLEMENTAL_RESULT_PATH,result);
  return result;
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function cellKey(pitch, velocity) { return `${pitch}:${velocity}`; }
function assertFixedCells(rows) {
  const got = rows.map(row => cellKey(row.pitch, row.velocity)).sort();
  const expected = MATRIX_PITCHES.flatMap(p => VELOCITIES.map(v => cellKey(p,v))).sort();
  if (got.length !== 192 || new Set(got).size !== got.length || JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new Error('diagnostic matrix must contain exactly the 192 contracted pitch/velocity cells');
  }
}
function assertMask(metrics, expected=MASK) {
  if (expected !== 3 || metrics.stage2mFactorMask !== expected || !metrics.stage2mHammer) {
    throw new Error(`Stage2A requires Stage2M factor mask ${MASK} and readable hammer diagnostics`);
  }
}
function maxDiff(actual, expected) {
  if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual-expected);
  return actual === expected ? 0 : Infinity;
}
function compareEquivalence(production, diagnostic) {
  const fields = ['spectralCentroidHz','above2kPowerRatio','peakDbfs','finite','outputGuardHits'];
  const diffs = {};
  if (!Array.isArray(production.envelopeDbfs) || production.envelopeDbfs.length !== 5
      || !Array.isArray(diagnostic.envelopeDbfs) || diagnostic.envelopeDbfs.length !== 5) {
    throw new Error('six-cell equivalence requires exactly five envelope windows');
  }
  diffs.envelopeDbfs = production.envelopeDbfs.map((value,i)=>maxDiff(diagnostic.envelopeDbfs[i],value));
  for (const field of fields) diffs[field] = maxDiff(diagnostic[field],production[field]);
  const maxAbsoluteDiff = Math.max(...Object.values(diffs).flat());
  return {pass:maxAbsoluteDiff <= CLOSE, maxAbsoluteDiff, diffs};
}
function spread(values) { return Math.max(...values)-Math.min(...values); }
function gainDecomposition(envelopeDbfs3, velocityNormalized, base, scale) {
  const velocityGain = base + scale * velocityNormalized;
  const velocityGainDb = 20 * Math.log10(velocityGain);
  return {velocityGain,velocityGainDb,preOutputGainEquivalentDb:envelopeDbfs3-velocityGainDb};
}
function assertHammerInvariants(rows) {
  const byVelocity = new Map();
  for (const row of rows) {
    const values = row.metrics.stage2mHammer;
    const velocityKey = String(row.velocity);
    if (!byVelocity.has(velocityKey)) byVelocity.set(velocityKey, []);
    byVelocity.get(velocityKey).push(values);
  }
  const results = [];
  for (const [velocity, values] of byVelocity) {
    const hardnessSpread = spread(values.map(x=>x.effectiveHardness));
    const launchSpread = spread(values.map(x=>x.initialHammerVelocity));
    results.push({velocity:Number(velocity),hardnessSpread,launchVelocitySpread:launchSpread,
      pass:hardnessSpread <= CLOSE && launchSpread <= CLOSE});
  }
  if (results.some(row=>!row.pass)) throw new Error('hammer hardness/launch velocity are not pitch-invariant at fixed velocity');
  return results;
}

function makeDiagnosticTables(capture, evaluation, fixture, rows, midRows) {
  const source = new Map(capture.matrix.map(row=>[cellKey(row.pitch,row.velocity),row.metrics]));
  const reference = new Map(fixture.directCells.map(row=>[cellKey(row.pitch,row.velocity),row.metrics ?? row]));
  const byCell = new Map(rows.map(row=>[cellKey(row.pitch,row.velocity),row]));
  const failPitches = new Set([36,39,51,54]);
  const controlPitches = new Set([33,42,45,48,57]);
  const treblePitches = new Set([93,96,99]);
  const direct = [...failPitches,...controlPitches,...treblePitches];
  const pitchRows = [];
  for (const pitch of direct) {
    for (const velocity of VELOCITIES) {
      const key=cellKey(pitch,velocity), measured=byCell.get(key)?.metrics, old=source.get(key), ref=reference.get(key);
      if (!measured || !old || !ref) throw new Error(`diagnostic table missing contracted source cell ${key}`);
      const gain=gainDecomposition(measured.envelopeDbfs[3],velocity/127,
        Number(readJson(PRESETS_PATH).concert_grand.engine_config.velocity.output_gain_base),
        Number(readJson(PRESETS_PATH).concert_grand.engine_config.velocity.output_gain_velocity_scale));
      pitchRows.push({pitch,velocity,synthLevelDbfs:measured.envelopeDbfs[3],referenceLevelDbfs:ref.envelopeDbfs[3],
        sharedStage3LevelErrorDb:measured.envelopeDbfs[3]+evaluation.sharedGainOffsetDb-ref.envelopeDbfs[3],
        velocityGainDb:gain.velocityGainDb,preOutputGainEquivalentDb:gain.preOutputGainEquivalentDb,
        hammer:measured.stage2mHammer,path:Object.fromEntries(DIAGNOSTIC_SIGNALS.map(name=>[name,measured.soundboardDiagnostics.signals[name]]))});
    }
  }
  const pitches = [...new Set(direct)];
  const spanRows = pitches.map(pitch=>{
    const layerRows=pitchRows.filter(row=>row.pitch===pitch).sort((a,b)=>a.velocity-b.velocity);
    const synth=layerRows.map(row=>row.synthLevelDbfs),pre=layerRows.map(row=>row.preOutputGainEquivalentDb);
    const refs=layerRows.map(row=>row.referenceLevelDbfs), old=source;
    const orig=VELOCITIES.map(v=>old.get(cellKey(pitch,v)).envelopeDbfs[3]);
    const actualSpanDb=Math.max(...synth)-Math.min(...synth),referenceSpanDb=Math.max(...refs)-Math.min(...refs);
    const preOutputSpanDb=Math.max(...pre)-Math.min(...pre);
    return {pitch,synthSpanDb:actualSpanDb,preOutputGainEquivalentSpanDb:preOutputSpanDb,referenceSpanDb,
      stage3SpanErrorDb:Math.abs(actualSpanDb-referenceSpanDb),explicitVelocityGainSpanDb:
        gainDecomposition(-100,124/127,0.7,0.3).velocityGainDb-gainDecomposition(-100,14/127,0.7,0.3).velocityGainDb,
      adjacentLayerDeltasDb:layerRows.slice(1).map((row,i)=>({from:row.velocity,to:layerRows[i+1].velocity,
        synthDb:row.synthLevelDbfs-layerRows[i].synthLevelDbfs,
        preGainDb:row.preOutputGainEquivalentDb-layerRows[i].preOutputGainEquivalentDb,
        referenceDb:row.referenceLevelDbfs-layerRows[i].referenceLevelDbfs})),originalCapturedSpanDb:Math.max(...orig)-Math.min(...orig)};
  });
  return {pitchRows,spanRows,midRows};
}

function run({root=ROOT,progress=()=>{}}={}) {
  const started=performance.now();
  const requiredBuildFiles=[PRODUCTION_WASM,DIAGNOSTIC_WASM,CAPTURE_PATH,EVALUATION_PATH,FIXTURE_PATH,PRESETS_PATH,PROFILE_PATH];
  for (const file of requiredBuildFiles) if(!fs.existsSync(file)) throw new Error(`required Stage3A artifact is missing: ${path.relative(root,file)}`);
  const productionSha=sha256(PRODUCTION_WASM), diagnosticSha=sha256(DIAGNOSTIC_WASM);
  if(productionSha!==EXPECTED_WASM_SHA256) throw new Error(`BLOCKED_STAGE3A_PRODUCTION_IDENTITY: production WASM SHA ${productionSha}`);
  const capture=readJson(CAPTURE_PATH), evaluation=readJson(EVALUATION_PATH), fixture=readJson(FIXTURE_PATH), presets=readJson(PRESETS_PATH);
  if(capture.render.wasmSha256!==EXPECTED_WASM_SHA256 || evaluation.identity?.wasmSha256!==EXPECTED_WASM_SHA256
      || evaluation.identity?.configSha256!==EXPECTED_CONFIG_SHA256 || evaluation.identity?.candidateId!=='stage2n-r3-candidate-01')
    throw new Error('BLOCKED_STAGE3A_PRODUCTION_IDENTITY: saved Stage3 provenance does not match the approved Stage2N candidate');
  if(capture.matrix.length!==480 || evaluation.coverage?.captured!==480 || evaluation.capture?.stage3CandidateDelta!==0 || evaluation.capture?.stage4Renders!==0)
    throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCOMPLETE: saved Stage3 capture is not complete');
  const outputGain=presets.concert_grand.engine_config?.velocity;
  const gainBase=Number(outputGain?.output_gain_base), gainScale=Number(outputGain?.output_gain_velocity_scale);
  if(gainBase!==0.7 || gainScale!==0.3) throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCONSISTENT: baked velocity gain is not the contracted 0.7 + 0.3*v');
  if(crypto.createHash('sha256').update(fs.readFileSync(PROFILE_PATH)).digest('hex')!==evaluation.identity.profileSha256)
    throw new Error('BLOCKED_STAGE3A_PRODUCTION_IDENTITY: generated profile SHA differs from Stage3 provenance');
  const protectedFiles=[PRODUCTION_WASM,PRESETS_PATH,PROFILE_PATH,FIXTURE_PATH,
    path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c')];
  const protectedHashes=Object.fromEntries(protectedFiles.map(file=>[path.relative(root,file),sha256(file)]));

  const priorBuildDir=process.env.SORAOTO_WASM_BUILD_DIR;
  const {renderNormalized}=require('./capture-supersynth-matrix.cjs');
  const render=(buildDir,pitch,velocity,renderOptions={})=>{
    process.env.SORAOTO_WASM_BUILD_DIR=buildDir;
    const v=typeof velocity==='number'&&velocity<=1 ? velocity : velocity/127;
    return renderNormalized(pitch,v,{}, {stage2mFactorMask:MASK,includeVelocityDerivative:true,includeSoundboardDiagnostics:true,...renderOptions});
  };
  let equivalence=[];
  let diagnosticRows=[],midRows=[];
  try {
    const captureRows=new Map(capture.matrix.map(row=>[cellKey(row.pitch,row.velocity),row.metrics]));
    const diagnosticByCell=new Map();
    for(const [pitch,velocity] of EQUIVALENCE_CELLS){
      const production=captureRows.get(cellKey(pitch,velocity));
      if(!production)throw new Error(`saved production Stage3 capture missing ${pitch}/${velocity}`);
      const metrics=render(path.join(root,'build/wasm-stage3a'),pitch,velocity);
      assertMask(metrics);
      diagnosticByCell.set(cellKey(pitch,velocity),{pitch,velocity,velocityNormalized:velocity/127,metrics});
      const comparison=compareEquivalence(production,metrics);
      equivalence.push({pitch,velocity,factorMask:metrics.stage2mFactorMask,...comparison});
      progress(`equivalence ${pitch}/${velocity}`);
    }
    if(equivalence.some(row=>!row.pass))throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_BUILD_NON_EQUIVALENT: six-cell diagnostic build equivalence failed');

    for(const pitch of MATRIX_PITCHES){
      for(const velocity of VELOCITIES){
        const key=cellKey(pitch,velocity);
        let row=diagnosticByCell.get(key);
        if(!row){
          const metrics=render(path.join(root,'build/wasm-stage3a'),pitch,velocity);
          assertMask(metrics);
          row={pitch,velocity,velocityNormalized:velocity/127,metrics};
          diagnosticByCell.set(key,row);
        }
        diagnosticRows.push(row);
        progress(`diagnostic ${diagnosticRows.length}/195 MIDI ${pitch} v${velocity}`);
      }
    }
    assertFixedCells(diagnosticRows);
    for(const velocityNormalized of MIDI41_NORMALIZED){
      const metrics=render(path.join(root,'build/wasm-stage3a'),41,velocityNormalized,
        {velocityDerivativeStartMs:30,velocityDerivativeEndMs:180});
      assertMask(metrics);
      midRows.push({pitch:41,velocityNormalized,metrics});
      progress(`MIDI41 ${midRows.length}/3 ${velocityNormalized}`);
    }
  }finally{
    if(priorBuildDir===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;
  }
  if(diagnosticRows.length!==192||midRows.length!==3)throw new Error('BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCOMPLETE: expected exactly 195 renders');
  const midDerivative=midRows.map(row=>row.metrics.velocityDerivative);
  const expectedMid=[0.06299055264228781,0.05389008449437237,0.24231471764008602];
  const midDerivativeDiff=midDerivative.map((value,i)=>Math.abs(value-expectedMid[i]));
  if(midDerivativeDiff.some(value=>value>CLOSE))throw new Error(`BLOCKED_STAGE3A_DIAGNOSTIC_BUILD_NON_EQUIVALENT: MIDI41 brightness derivative mismatch ${midDerivativeDiff}`);
  const invariantResults=assertHammerInvariants(diagnosticRows);
  const tables=makeDiagnosticTables(capture,evaluation,fixture,diagnosticRows,midRows);
  const afterHashes=Object.fromEntries(protectedFiles.map(file=>[path.relative(root,file),sha256(file)]));
  if(JSON.stringify(protectedHashes)!==JSON.stringify(afterHashes))throw new Error('BLOCKED_STAGE3A_PRODUCTION_IDENTITY: protected production files changed during diagnostic');
  if(sha256(PRODUCTION_WASM)!==productionSha||sha256(DIAGNOSTIC_WASM)!==diagnosticSha)throw new Error('WASM identity changed during diagnostic');
  const result={schemaVersion:1,decision:'STAGE3A_DIAGNOSTIC_COMPLETE',candidateId:evaluation.identity.candidateId,
    sourceRevision:evaluation.identity.head,productionWasmSha256:productionSha,diagnosticWasmSha256:diagnosticSha,
    configSha256:evaluation.identity.configSha256,profileSha256:evaluation.identity.profileSha256,
    productionSimd:true,candidateDelta:0,stage2lBudget:'1/12',stage2nBudget:'1/1',stage4Renders:0,
    stage3:{primaryDecision:'BLOCKED_STAGE3_DIRECT_REFERENCE',measurementsChanged:false},
    equivalence:{cells:equivalence,pass:equivalence.length===6&&equivalence.every(row=>row.pass),tolerance:CLOSE},
    velocityGain:{base:gainBase,scale:gainScale,softToHardDb:gainDecomposition(-100,124/127,gainBase,gainScale).velocityGainDb-gainDecomposition(-100,14/127,gainBase,gainScale).velocityGainDb},
    diagnosticMatrix:{pitchCount:MATRIX_PITCHES.length,velocityCount:VELOCITIES.length,cells:diagnosticRows.length,rows:diagnosticRows},
    midi41:{normalizedVelocities:MIDI41_NORMALIZED,expectedDerivative:expectedMid,measuredDerivative:midDerivative,absoluteDiff:midDerivativeDiff,rows:midRows},
    hammerInvariants:invariantResults,tables,
    protectedHashes,elapsedSeconds:(performance.now()-started)/1000};
  fs.mkdirSync(PRIVATE_ROOT,{recursive:true});
  fs.writeFileSync(path.join(PRIVATE_ROOT,'velocity-diagnostic.json'),`${JSON.stringify(result,null,2)}\n`);
  return result;
}

if(require.main===module){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==='--dry-run'){
      const result=runSupplemental({dryRun:true});
      process.stdout.write(JSON.stringify({decision:result.decision,builds:result.builds,renders:result.renders,
        authorizedCells:result.authorizedCells,productionWasmSha256:result.identity.productionWasmSha256})+'\n');
    }else if(args.length===1&&args[0]==='--supplemental-execute'){
      const result=runSupplemental({progress:message=>process.stderr.write(`${message}\n`)});
      process.stdout.write(JSON.stringify({decision:result.decision,renderCount:result.acceptedReplacementCount,
        derivativeWindowMs:result.derivativeWindowMs,derivatives:result.rows.map(row=>row.metrics.velocityDerivative),
        absoluteDifferences:result.rows.map(row=>row.absoluteDifference),productionWasmSha256:result.identity.productionWasmSha256})+'\n');
    }else{
      throw new Error('explicit mode required: use --dry-run or --supplemental-execute; the latter consumes exactly the three authorized MIDI41 renders');
    }
  }catch(error){process.stderr.write(`Stage3A velocity diagnostic ERROR: ${error.stack||error.message}\n`);process.exitCode=1;}
}

module.exports={MASK,EQUIVALENCE_CELLS,MATRIX_PITCHES,VELOCITIES,MIDI41_NORMALIZED,assertFixedCells,assertMask,
  compareEquivalence,gainDecomposition,assertHammerInvariants,assertSupplementalCells,validateSupplementalRow,
  MIDI41_EXPECTED_DERIVATIVE,DIAGNOSTIC_SIGNALS,runSupplemental};
