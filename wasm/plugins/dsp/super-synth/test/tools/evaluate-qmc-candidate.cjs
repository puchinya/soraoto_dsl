#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {REPO, SPACE, PRESETS_PATH, applyCandidateToPresets} = require('../tuning/candidate-overlay.cjs');

const PITCHES = SPACE.screening.pitches;
const VELOCITIES = SPACE.screening.velocities;
const FIXTURE_PATH = path.join(REPO, SPACE.screening.referenceFixture);
const EVALUATOR_FILES = [
  'wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/verify-qmc-scratch-equivalence.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs',
  'wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs',
  'wasm/plugins/dsp/super-synth/test/tuning/run_level1_qmc.py',
  'wasm/plugins/dsp/super-synth/test/tuning/README.md',
  'wasm/plugins/dsp/super-synth/test/tuning/requirements.txt',
  'wasm/plugins/dsp/super-synth/test/tuning/active-search-space.json',
  'wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.json',
  'web-player/src/js/plugin-cbor.js',
  'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json',
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/cmake/super_synth_metadata.py',
  'wasm/cmake/generate_plugin_metadata.py',
  'wasm/CMakeLists.txt',
  'wasm/cmake/wasm_plugin.cmake'
];

function parseArgs(argv) {
  const args = {};
  for (let i=0; i<argv.length; i++) {
    const key = argv[i];
    if (!['--candidate','--output','--build-root'].includes(key) || !argv[i+1]) {
      throw new Error('Usage: evaluate-qmc-candidate.cjs --candidate <candidate.json> --output <result.json> --build-root <build/wasm/calibration/candidate-id>');
    }
    args[key.slice(2)] = path.resolve(argv[++i]);
  }
  if (!args.candidate || !args.output || !args['build-root']) throw new Error('candidate, output, and build-root are required');
  return args;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashFiles(relativePaths) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of [...relativePaths].sort()) {
    hash.update(relativePath).update('\0').update(fs.readFileSync(path.join(REPO, relativePath))).update('\0');
  }
  return hash.digest('hex');
}

function hashTree(root) {
  const files = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true}).sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const child = path.join(directory, entry.name), rel = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(child, rel);
      else if (entry.isFile()) files.push([rel.split(path.sep).join('/'), fs.readFileSync(child)]);
    }
  }
  visit(root);
  files.sort((a,b)=>a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const hash = crypto.createHash('sha256');
  for (const [relative, bytes] of files) hash.update(relative).update('\0').update(bytes).update('\0');
  return hash.digest('hex');
}

function execLogged(args, cwd, outputPath) {
  try {
    const output = execFileSync('rtk', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:32*1024*1024});
    fs.writeFileSync(outputPath, output);
    return output;
  } catch (error) {
    const stdout = error.stdout?.toString?.() || '';
    const stderr = error.stderr?.toString?.() || '';
    fs.writeFileSync(outputPath, `${stdout}\n${stderr}`);
    const detail = `${error.message}\n${stdout}\n${stderr}`.trim();
    throw new Error(`command failed: rtk ${args.join(' ')}\n${detail}`);
  }
}

function referenceFit(rows, fixture) {
  const referenceByKey = new Map(fixture.directCells.map(cell => [`${cell.pitch}:${cell.velocity}`,cell]));
  const normalizedErrors = [];
  const components = {level:[], centroid:[], above2k:[], postAttackShape:[]};
  for (const row of rows) {
    const ref = referenceByKey.get(`${row.pitch}:${row.velocity}`);
    if (!ref) throw new Error(`Salamander fixture has no ${row.pitch}:${row.velocity}`);
    const actual = row.metrics, expected = ref.metrics;
    const level = Math.abs(actual.envelopeDbfs[3] - expected.envelopeDbfs[3]) / 20;
    const centroidRatio = Math.max(actual.spectralCentroidHz/expected.spectralCentroidHz,
      expected.spectralCentroidHz/actual.spectralCentroidHz);
    const centroid = Math.abs(Math.log(centroidRatio)) / Math.log(8);
    const above2k = Math.abs(actual.above2kPowerRatio - expected.above2kPowerRatio) / 1;
    const postAttackShape = Math.max(
      Math.abs((actual.envelopeDbfs[2]-actual.envelopeDbfs[3])-(expected.envelopeDbfs[2]-expected.envelopeDbfs[3])),
      Math.abs((actual.envelopeDbfs[4]-actual.envelopeDbfs[3])-(expected.envelopeDbfs[4]-expected.envelopeDbfs[3]))
    ) / 10;
    for (const [key,value] of Object.entries({level,centroid,above2k,postAttackShape})) {
      if (!Number.isFinite(value)) throw new Error(`non-finite reference error ${key} at ${row.pitch}:${row.velocity}`);
      normalizedErrors.push(value);
      components[key].push(value);
    }
  }
  normalizedErrors.sort((a,b)=>a-b);
  const trim = Math.floor(normalizedErrors.length*0.1);
  const kept = normalizedErrors.slice(trim, normalizedErrors.length-trim || normalizedErrors.length);
  return {
    definition: '10-percent-trimmed mean of existing normalized full-range errors; level/20dB, log(centroid ratio)/log(8), above-2k delta/1, post-attack shape/10dB',
    value: kept.reduce((sum,value)=>sum+value,0)/kept.length,
    normalizedErrorCount: normalizedErrors.length,
    components: Object.fromEntries(Object.entries(components).map(([key,values])=>[key,{mean:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values)}]))
  };
}

function summarizeMatrix(captured, fixture, parameters, derived, provenance) {
  const rows = captured.matrix;
  if (rows.length !== PITCHES.length*VELOCITIES.length) throw new Error(`expected 15 screening cells, got ${rows.length}`);
  const invalid = rows.filter(row => !row.metrics.pitchMeasurement?.measurement_valid);
  const valid = rows.filter(row => row.metrics.pitchMeasurement?.measurement_valid);
  const pitchErrors = valid.map(row=>row.metrics.pitchMeasurement.pitch_error_cents);
  const worstAbsPitch = pitchErrors.length?Math.max(...pitchErrors.map(Math.abs)):null;
  const a0 = rows.filter(row=>row.pitch===21).map(row=>({velocity:row.velocity,measurement:row.metrics.pitchMeasurement}));
  const c8 = rows.filter(row=>row.pitch===108).map(row=>({velocity:row.velocity,measurement:row.metrics.pitchMeasurement}));
  const allRenders = rows.map(row=>row.metrics).concat(Object.values(captured.diagnostics.diagnosticRenders));
  const guardHits = allRenders.reduce((sum,metrics)=>sum+(metrics.outputGuardHits||0),0);
  const peakDbfs = Math.max(...allRenders.map(metrics=>metrics.fullRenderPeakDbfs??metrics.peakDbfs));
  const velocity = captured.diagnostics.velocityBrightness;
  const lowBuzz = captured.diagnostics.lowRegisterBuzz;
  const finite = allRenders.every(metrics=>metrics.finite!==false&&Number.isFinite(metrics.fullRenderPeakDbfs??metrics.peakDbfs)
    && Object.entries(metrics).every(([key,value])=>key==='pitchErrorCents'||key==='fundamentalHz'||key==='pitchMeasurement'||(Array.isArray(value)?value.every(Number.isFinite):typeof value==='number'?Number.isFinite(value):true)));
  const reference = referenceFit(rows,fixture);
  const mean = values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return {
    parameters:{...parameters,...derived},
    cellCount:rows.length,
    cells:rows.map(row=>({pitch:row.pitch,velocity:row.velocity,metrics:row.metrics})),
    pitch:{
      a0ByVelocity:a0.map(cell=>({velocity:cell.velocity,result:cell.measurement?.result??'MEASUREMENT_INVALID',errorCents:cell.measurement?.pitch_error_cents??null,confidenceRatio:cell.measurement?.confidence_ratio??null,usablePartials:cell.measurement?.usable_partials??[],fittedB:cell.measurement?.fitted_B??null})),
      c8ByVelocity:c8.map(cell=>({velocity:cell.velocity,result:cell.measurement?.result??'MEASUREMENT_INVALID',errorCents:cell.measurement?.pitch_error_cents??null,confidenceRatio:cell.measurement?.confidence_ratio??null,usablePartials:cell.measurement?.usable_partials??[],fittedB:cell.measurement?.fitted_B??null})),
      worstAbsoluteValidPitchErrorCents:worstAbsPitch,
      violationMarginCents:worstAbsPitch===null?null:worstAbsPitch-15,
      invalidCount:invalid.length,
      validCount:valid.length
    },
    brightness:{...velocity,marginAbove1_25:velocity.ratio-1.25},
    referenceFitLoss:reference,
    harmonicReference:{meanH2ToH1:mean(rows.map(row=>row.metrics.harmonicRatiosH2ToH6[0])),meanH3ToH1:mean(rows.map(row=>row.metrics.harmonicRatiosH2ToH6[1])),meanH4ToH1:mean(rows.map(row=>row.metrics.harmonicRatiosH2ToH6[2])),meanH5ToH1:mean(rows.map(row=>row.metrics.harmonicRatiosH2ToH6[3])),meanInharmonicityB:mean(rows.map(row=>row.metrics.inharmonicityB))},
    attack:{meanOnsetMs:mean(rows.map(row=>row.metrics.onsetMs)),mean0to10Dbfs:mean(rows.map(row=>row.metrics.envelopeDbfs[0])),mean10to30Dbfs:mean(rows.map(row=>row.metrics.envelopeDbfs[1]))},
    decay:{mean30to80Dbfs:mean(rows.map(row=>row.metrics.envelopeDbfs[2])),mean80to200Dbfs:mean(rows.map(row=>row.metrics.envelopeDbfs[3])),mean200to350Dbfs:mean(rows.map(row=>row.metrics.envelopeDbfs[4]))},
    lowRegisterBuzz:{...lowBuzz,limit:0.12,margin:0.12-lowBuzz.value},
    peak:{worstDbfs:peakDbfs,headroomDb:-peakDbfs,limitDbfs:0},
    guardHits,
    finite,
    measurement:{invalidCount:invalid.length+(captured.diagnostics.harmonicSparsity.pitchMeasurement?.measurement_valid?0:1),totalCount:rows.length+1},
    harmonicSparsity:captured.diagnostics.harmonicSparsity,
    referenceArchiveSha256:fixture.source.archiveSha256,
    wasmSha256:provenance.wasmSha256,
    configSha256:provenance.configSha256
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive:true});
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value,null,2)}\n`);
  fs.renameSync(temporary,filePath);
}

function evaluate(candidatePath, outputPath, buildRoot) {
  const started = performance.now();
  const candidate = JSON.parse(fs.readFileSync(candidatePath,'utf8'));
  const candidateId = candidate.candidateId;
  if (!/^[a-zA-Z0-9_-]+$/.test(candidateId||'')) throw new Error('candidateId must contain only letters, digits, underscore, or hyphen');
  const parameters = candidate.parameters;
  if (!parameters || typeof parameters !== 'object') throw new Error('candidate.parameters is required');
  const sourceRevision = execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
  const sourceDirty = Boolean(execFileSync('rtk',['git','status','--porcelain'],{cwd:REPO,encoding:'utf8'}).trim());
  const sourceTreeSha256 = hashTree(path.join(REPO,'wasm'));
  const evaluatorSha256 = hashFiles(EVALUATOR_FILES);
  const candidateRoot = buildRoot;
  const sourceRoot = path.join(candidateRoot,'source');
  const scratchWasm = path.join(sourceRoot,'wasm');
  const scratchBuild = path.join(candidateRoot,'build');
  const presetOutput = path.join(scratchWasm,'plugins/dsp/super-synth/presets.json');
  fs.mkdirSync(candidateRoot,{recursive:true});

  const stampPath = path.join(candidateRoot,'candidate-source.json');
  if (!fs.existsSync(scratchWasm)) {
    fs.mkdirSync(sourceRoot,{recursive:true});
    fs.cpSync(path.join(REPO,'wasm'),scratchWasm,{recursive:true,errorOnExist:true,force:false});
    writeJson(stampPath,{sourceRevision,sourceTreeSha256,evaluatorSha256,candidateId});
  } else {
    if (!fs.existsSync(stampPath)) throw new Error(`scratch source exists without provenance stamp: ${scratchWasm}`);
    const prior = JSON.parse(fs.readFileSync(stampPath,'utf8'));
    if (prior.sourceRevision!==sourceRevision||prior.sourceTreeSha256!==sourceTreeSha256||prior.evaluatorSha256!==evaluatorSha256||prior.candidateId!==candidateId) {
      throw new Error(`scratch source identity mismatch for ${candidateId}; refusing to overwrite it`);
    }
  }

  // The existing PluginHarness resolves this shared descriptor decoder from
  // the repository root. Mirror that single test dependency into scratch so
  // the established harness can run against the candidate-specific WASM.
  const cborRelative = 'web-player/src/js/plugin-cbor.js';
  const scratchCbor = path.join(sourceRoot,cborRelative);
  fs.mkdirSync(path.dirname(scratchCbor),{recursive:true});
  fs.copyFileSync(path.join(REPO,cborRelative),scratchCbor);

  const overlay = applyCandidateToPresets(JSON.parse(fs.readFileSync(PRESETS_PATH,'utf8')),parameters);
  const encodedPresets = `${JSON.stringify(overlay.presetsDocument,null,2)}\n`;
  fs.writeFileSync(presetOutput,encodedPresets);
  const configSha256 = sha256(encodedPresets);
  writeJson(path.join(candidateRoot,'candidate.json'),{
    candidateId,parameters,derived:overlay.derived,sourceRevision,sourceDirty,sourceTreeSha256,evaluatorSha256,configSha256
  });

  const toolchain = path.join(REPO,'wasm/cmake/wasm32-clang.cmake');
  execLogged(['cmake','-S',scratchWasm,'-B',scratchBuild,`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,'-DBUILD_TESTING=ON',
    '-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON','-DSORAOTO_FORCE_SCALAR_GRAND=OFF'],REPO,path.join(candidateRoot,'configure.log'));
  execLogged(['cmake','--build',scratchBuild,'--target','soraoto_dsp_super_synth'],REPO,path.join(candidateRoot,'build.log'));

  const wasmPath = path.join(scratchBuild,'plugins/dsp/super-synth/plugin.wasm');
  const wasmSha256 = sha256(fs.readFileSync(wasmPath));
  const capturePath = path.join(scratchWasm,'plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs');
  const {captureMatrix} = require(capturePath);
  const priorBuildDir = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = scratchBuild;
  let captured;
  try {
    captured = captureMatrix({
      pitches:PITCHES,velocities:VELOCITIES,parameters:{},includePitchHealth:true,includeCalibrationDiagnostics:true,
      onProgress:(pitch,count)=>process.stderr.write(`QMC ${candidateId}: rendered MIDI ${pitch} (${count}/${PITCHES.length*VELOCITIES.length})\n`)
    });
  } finally {
    if (priorBuildDir===undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR=priorBuildDir;
  }
  if (captured.matrix.length!==15||captured.diagnostics===undefined) throw new Error('candidate evaluator did not produce the 15-cell matrix and auxiliary diagnostics');
  captured.render.sourceTreeDirty=sourceDirty;
  writeJson(path.join(candidateRoot,'matrix.json'),captured);
  const fixture = JSON.parse(fs.readFileSync(path.join(scratchWasm,'plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'),'utf8'));
  const metrics = summarizeMatrix(captured,fixture,parameters,overlay.derived,{wasmSha256,configSha256});
  const result = {
    schemaVersion:1,candidateId,parameters:{...parameters,...overlay.derived},stageReached:1,sourceRevision,sourceDirty,
    sourceTreeSha256,evaluatorSha256,configSha256,wasmSha256,productionSimd:true,
    elapsedSeconds:(performance.now()-started)/1000,metrics,
    measurement:{invalidCount:metrics.measurement.invalidCount,totalCount:metrics.measurement.totalCount},
    screeningStatus:'COMPLETED'
  };
  writeJson(outputPath,result);
  return result;
}

function main() {
  const args=parseArgs(process.argv.slice(2));
  const result=evaluate(args.candidate,args.output,args['build-root']);
  process.stdout.write(`${JSON.stringify({candidateId:result.candidateId,screeningStatus:result.screeningStatus,elapsedSeconds:+result.elapsedSeconds.toFixed(2),measurement:result.measurement,guardHits:result.metrics.guardHits,peakWorstDbfs:result.metrics.peak.worstDbfs,brightness:result.metrics.brightness.ratio,referenceFitLoss:result.metrics.referenceFitLoss.value,wasmSha256:result.wasmSha256})}\n`);
}

if (require.main===module) {
  try {main();}
  catch(error) {process.stderr.write(`QMC candidate evaluation failed: ${error.stack||error.message}\n`);process.exitCode=1;}
}

module.exports={evaluate,referenceFit,summarizeMatrix,hashFiles,hashTree,EVALUATOR_FILES};
