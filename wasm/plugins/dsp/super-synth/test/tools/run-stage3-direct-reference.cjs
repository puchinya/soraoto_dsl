#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const {captureMatrix, VELOCITIES} = require('./capture-supersynth-matrix.cjs');
const {LIMITS, evaluateDirectReferenceMatrix} = require('./stage3-direct-reference-metrics.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const BASELINE_HEAD = '28e2c06c09683f7c077c0411a9eb1a1e6495fb7d';
const CANDIDATE_ID = 'stage2n-r3-candidate-01';
const EXPECTED_WASM_SHA256 = '9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2';
const EXPECTED_CONFIG_SHA256 = '792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d';
const EXPECTED_PRESETS_SHA256 = 'cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431';
const EXPECTED_PROFILE_SHA256 = 'cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66';
const EXPECTED_ARCHIVE_SHA256 = 'b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b';
const EXPECTED_PITCHES = [21,24,27,30,33,36,39,42,45,48,51,54,57,60,63,66,69,72,75,78,81,84,87,90,93,96,99,102,105,108];
const EXPECTED_VELOCITIES = [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const SENTINELS = [
  {pitch:21,velocity:14},{pitch:21,velocity:124},
  {pitch:60,velocity:14},{pitch:60,velocity:124},
  {pitch:108,velocity:14},{pitch:108,velocity:124}
];
const SERIALIZATION_TOLERANCE = 1e-6;
const FIXTURE_PATH = path.join(ROOT, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
const WASM_PATH = path.join(ROOT, 'build/wasm/plugins/dsp/super-synth/plugin.wasm');
const PRESETS_PATH = path.join(ROOT, 'wasm/plugins/dsp/super-synth/presets.json');
const PROFILE_PATH = path.join(ROOT, 'wasm/shared/generated/super-synth_grand_profiles.h');
const STAGE2Q_SUMMARY_PATH = path.join(ROOT, '.agent-state/issues/7/calibration-optuna/stage2q/summary.json');
const OUT_DIR = path.join(ROOT, '.agent-state/issues/7/calibration-optuna/stage3');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function currentHead() {
  return execFileSync('rtk', ['git', 'rev-parse', 'HEAD'], {cwd:ROOT, encoding:'utf8'}).trim();
}
function assertCleanAgainstHead(files) {
  const result = spawnSync('rtk', ['git', 'diff', '--quiet', 'HEAD', '--', ...files], {cwd:ROOT, encoding:'utf8'});
  if (result.status !== 0) throw new Error(`BLOCKED_STAGE3_PRODUCTION_IDENTITY: protected production files differ from Stage2Q HEAD (${files.join(', ')})`);
}
function cellKey(cell) { return `${cell.pitch}:${cell.velocity}`; }

function validateReferenceFixture(fixture) {
  if (fixture.schemaVersion !== 3
      || fixture.source?.name !== 'Salamander Grand Piano V3'
      || fixture.source?.license !== 'CC BY 3.0'
      || fixture.source?.archiveSha256 !== EXPECTED_ARCHIVE_SHA256
      || fixture.coverage?.directCells !== 480
      || fixture.coverage?.uniqueAudioReferences !== 641
      || JSON.stringify(fixture.coverage?.pitches) !== JSON.stringify(EXPECTED_PITCHES)
      || JSON.stringify(fixture.coverage?.velocityRepresentatives) !== JSON.stringify(EXPECTED_VELOCITIES)
      || fixture.directCells?.length !== 480) {
    throw new Error('BLOCKED_STAGE3_REFERENCE_IDENTITY');
  }
  const keys = fixture.directCells.map(cellKey);
  if (new Set(keys).size !== 480) throw new Error('BLOCKED_STAGE3_REFERENCE_IDENTITY: duplicate direct reference cells');
  const expected = new Set(EXPECTED_PITCHES.flatMap(pitch => EXPECTED_VELOCITIES.map(velocity => `${pitch}:${velocity}`)));
  if (keys.some(key => !expected.has(key)) || expected.size !== keys.length) {
    throw new Error('BLOCKED_STAGE3_REFERENCE_IDENTITY: reference coverage differs from 30 x 16');
  }
  return {schemaVersion:fixture.schemaVersion,source:fixture.source.name,license:fixture.source.license,
    archiveSha256:fixture.source.archiveSha256,directCells:fixture.coverage.directCells,
    uniqueAudioReferences:fixture.coverage.uniqueAudioReferences,pitches:[...fixture.coverage.pitches],
    velocities:[...fixture.coverage.velocityRepresentatives],fixtureSha256:sha256(FIXTURE_PATH)};
}

function assertExactCoverage(cells, pitches = EXPECTED_PITCHES, velocities = EXPECTED_VELOCITIES) {
  const expected = pitches.flatMap(pitch => velocities.map(velocity => `${pitch}:${velocity}`));
  const actual = cells.map(cellKey);
  if (actual.length !== 480 || new Set(actual).size !== 480 || expected.length !== 480
      || expected.some(key => !actual.includes(key)) || actual.some(key => !expected.includes(key))) {
    throw new Error('BLOCKED_STAGE3_CAPTURE_COVERAGE');
  }
  return {requested:480,captured:actual.length,unique: new Set(actual).size,directPitches:pitches.length,velocityLayers:velocities.length};
}

function compareSentinelMetrics(mainRow, repeatRow, tolerance = SERIALIZATION_TOLERANCE) {
  if (!mainRow || !repeatRow || cellKey(mainRow) !== cellKey(repeatRow)) return {pass:false,reason:'sentinel cell identity mismatch'};
  const fields = ['spectralCentroidHz','above2kPowerRatio','peakDbfs'];
  const a = mainRow.metrics, b = repeatRow.metrics;
  const differences = {};
  for (const field of fields) {
    if (!Number.isFinite(a[field]) || !Number.isFinite(b[field])) return {pass:false,reason:`non-finite ${field}`};
    differences[field] = Math.abs(a[field] - b[field]);
  }
  if (!Array.isArray(a.envelopeDbfs) || !Array.isArray(b.envelopeDbfs)
      || a.envelopeDbfs.length < 5 || b.envelopeDbfs.length < 5) return {pass:false,reason:'missing envelope windows'};
  differences.envelopeDbfs = Math.max(...Array.from({length:5},(_,i)=>Math.abs(a.envelopeDbfs[i]-b.envelopeDbfs[i])));
  differences.finite = a.finite === b.finite ? 0 : 1;
  differences.outputGuardHits = a.outputGuardHits === b.outputGuardHits ? 0 : 1;
  const numericPass = Object.entries(differences).filter(([key])=>!['finite','outputGuardHits'].includes(key))
    .every(([,value])=>value <= tolerance);
  const pass = numericPass && differences.finite === 0 && differences.outputGuardHits === 0
    && a.finite === true && (a.outputGuardHits || 0) === 0;
  return {pass,tolerance,differences};
}

function countHardFailures(direct) {
  const names = ['directLevel','centroid','above2k','postAttackShape','peak','guard','finite'];
  const cellCounts = Object.fromEntries(names.map(name => [name, direct.cells.filter(cell => cell.hardFailures.includes(name)).length]));
  return {...cellCounts,
    totalCells:direct.cells.length,
    cellFailureCount:direct.metrics.cellFailureCount,
    dynamicSpanFailingPitches:direct.metrics.dynamicSpan.failingPitchCount,
    brightnessDirectionFailingPitches:direct.metrics.brightnessDirection.failingPitchCount,
    totalFailingPitches:direct.metrics.directPitchFailureCount};
}

function percentileSummary(values) {
  if (!values.length) return {count:0,min:null,p50:null,p90:null,p95:null,max:null};
  const sorted=[...values].sort((a,b)=>a-b);
  const at=q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))];
  return {count:sorted.length,min:sorted[0],p50:at(.5),p90:at(.9),p95:at(.95),max:sorted.at(-1)};
}

function diagnostics(direct) {
  const cells=direct.cells;
  return {
    directLevelDb:percentileSummary(cells.map(cell=>cell.levelErrorDb)),
    comparableCentroidRatio:percentileSummary(cells.filter(cell=>cell.centroidComparable).map(cell=>cell.centroidRatio)),
    above2kAbsoluteDelta:percentileSummary(cells.map(cell=>cell.above2kDelta)),
    postAttackShapeDb:percentileSummary(cells.map(cell=>cell.postAttackShapeErrorDb)),
    peakDbfs:percentileSummary(cells.map(cell=>cell.peakDbfs))
  };
}

function productionIdentity() {
  const stage2q=readJson(STAGE2Q_SUMMARY_PATH);
  if (stage2q.candidateId !== CANDIDATE_ID || stage2q.configSha256 !== EXPECTED_CONFIG_SHA256
      || stage2q.wasmSha256 !== EXPECTED_WASM_SHA256) throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: Stage2Q identity record mismatch');
  const actual={head:currentHead(),wasmSha256:sha256(WASM_PATH),configSha256:stage2q.configSha256,
    presetsSha256:sha256(PRESETS_PATH),profileSha256:sha256(PROFILE_PATH)};
  if (actual.head !== BASELINE_HEAD || actual.wasmSha256 !== EXPECTED_WASM_SHA256
      || actual.configSha256 !== EXPECTED_CONFIG_SHA256 || actual.presetsSha256 !== EXPECTED_PRESETS_SHA256
      || actual.profileSha256 !== EXPECTED_PROFILE_SHA256) throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY');
  assertCleanAgainstHead(['wasm/plugins/dsp/super-synth/src/plugin.c','wasm/plugins/dsp/super-synth/presets.json',
    'wasm/shared/generated/super-synth_grand_profiles.h']);
  return {...actual,candidateId:CANDIDATE_ID,productionSimd:true,stage2nBudget:'1/1',stage2lBudget:'1/12',candidateDelta:0};
}

function evaluateDirect(fixture, capture) {
  assertExactCoverage(capture.matrix);
  const direct=evaluateDirectReferenceMatrix(fixture.directCells,capture.matrix,{requiredVelocityLayers:EXPECTED_VELOCITIES});
  const counts=countHardFailures(direct);
  const pass=direct.coverage.cells===480&&direct.coverage.pitches===30&&counts.cellFailureCount===0
    &&counts.dynamicSpanFailingPitches===0&&counts.brightnessDirectionFailingPitches===0
    &&direct.metrics.guardHitTotal===0&&direct.metrics.finite===true&&direct.metrics.peakWorstDbfs<0;
  return {direct,counts,diagnostics:diagnostics(direct),pass};
}

function sanitizeCapture(capture) {
  const {wasmBuildRoot: _privateBuildPath, ...render}=capture.render;
  return {...capture,render};
}

function writeJson(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`);
  fs.renameSync(tmp,file);
}

function assertUnchanged(before) {
  if (currentHead()!==before.identity.head || sha256(WASM_PATH)!==before.identity.wasmSha256
      || sha256(PRESETS_PATH)!==before.identity.presetsSha256 || sha256(PROFILE_PATH)!==before.identity.profileSha256
      || sha256(FIXTURE_PATH)!==before.reference.fixtureSha256) throw new Error('BLOCKED_STAGE3_PRODUCTION_IDENTITY: identity changed during capture');
  assertCleanAgainstHead(['wasm/plugins/dsp/super-synth/src/plugin.c','wasm/plugins/dsp/super-synth/presets.json',
    'wasm/shared/generated/super-synth_grand_profiles.h']);
}

function run(mode, regressionResultsPath = null) {
  if (!['--dry-run','--execute'].includes(mode)) throw new Error('Specify exactly one of --dry-run or --execute.');
  const fixture=readJson(FIXTURE_PATH);
  const reference=validateReferenceFixture(fixture);
  const identity=productionIdentity();
  if (mode==='--dry-run') {
    process.stdout.write(`${JSON.stringify({result:'DRY_RUN_PASS',buildCount:0,physicalRenderCount:0,identity,reference,coverage:{pitches:30,velocities:16,cells:480}})}\n`);
    return;
  }
  if (!regressionResultsPath) throw new Error('BLOCKED_STAGE3_REGRESSION_RESULTS: --execute requires --regressions <private-results.json>');
  const regressionResults=readJson(path.resolve(regressionResultsPath));
  for (const name of ['concertGrand','pianoRealism']) {
    if (!['PASS','FAIL'].includes(regressionResults[name]?.result)) throw new Error(`BLOCKED_STAGE3_REGRESSION_RESULTS: missing ${name} result`);
  }
  if (fs.existsSync(path.join(OUT_DIR,'direct-evaluation.json'))) throw new Error('BLOCKED_STAGE3_EVIDENCE_EXISTS: refusing duplicate 480-cell capture');
  const before={identity,reference};
  const started=new Date().toISOString();
  const capture=captureMatrix({pitches:EXPECTED_PITCHES,velocities:EXPECTED_VELOCITIES,parameters:{},
    onProgress:(pitch,count)=>process.stderr.write(`Stage3 capture MIDI ${pitch} (${count}/480)\n`)});
  const sanitizedCapture=sanitizeCapture(capture);
  const coverage=assertExactCoverage(capture.matrix);
  const result=evaluateDirect(fixture,capture);
  const mainByKey=new Map(capture.matrix.map(row=>[cellKey(row),row]));
  const repeat=captureMatrix({cells:SENTINELS.map(cell=>({...cell})),parameters:{},
    onProgress:(pitch,count)=>process.stderr.write(`Stage3 sentinel MIDI ${pitch} (${count}/6)\n`)});
  const sentinelResults=repeat.matrix.map(row=>({pitch:row.pitch,velocity:row.velocity,
    ...compareSentinelMetrics(mainByKey.get(cellKey(row)),row)}));
  const deterministic=sentinelResults.every(row=>row.pass);
  assertUnchanged(before);
  const failures=result.direct.cells.filter(cell=>cell.hardFailures.length).map(cell=>({pitch:cell.pitch,velocity:cell.velocity,
    categories:cell.hardFailures,levelErrorDb:cell.levelErrorDb,centroidRatio:cell.centroidRatio,
    centroidComparable:cell.centroidComparable,above2kDelta:cell.above2kDelta,
    earlyResidualDb:cell.earlyResidualDb,lateResidualDb:cell.lateResidualDb,
    shapeErrorDb:cell.postAttackShapeErrorDb,peakDbfs:cell.peakDbfs,guardHits:cell.guardHits,finite:cell.finite}));
  const directPass=result.pass;
  const regressionsPass=['concertGrand','pianoRealism'].every(name=>regressionResults[name].result==='PASS');
  const stage3Pass=reference.directCells===480&&coverage.unique===480&&directPass&&deterministic&&regressionsPass;
  const decision=stage3Pass?'STAGE3_READY_FOR_STAGE4':!regressionsPass?'BLOCKED_STAGE3_INDEPENDENT_REGRESSION'
    :!deterministic?'BLOCKED_STAGE3_NONDETERMINISTIC_CAPTURE':!directPass?'BLOCKED_STAGE3_DIRECT_REFERENCE':'BLOCKED_STAGE3_CAPTURE_COVERAGE';
  const finished=new Date().toISOString();
  const evidence={schemaVersion:1,decision,started,finished,identity,reference,coverage,
    capture:{pitches:EXPECTED_PITCHES,velocities:EXPECTED_VELOCITIES,cells:480,uniqueCells:480,
      preset:'concert_grand',sampleRate:capture.render.sampleRate,durationMs:capture.render.durationMs,
      parameterOverrides:{},stage3CandidateDelta:0,stage4Renders:0},
    sharedGainOffsetDb:result.direct.sharedGainOffsetDb,metrics:result.direct.metrics,counts:result.counts,
    diagnostics:result.diagnostics,failedCells:failures,velocity:result.direct.velocity,
    deterministic:{pass:deterministic,tolerance:SERIALIZATION_TOLERANCE,sentinels:sentinelResults},
    independentRegressions:regressionResults};
  fs.mkdirSync(OUT_DIR,{recursive:true});
  writeJson(path.join(OUT_DIR,'direct-capture.json'),sanitizedCapture);
  writeJson(path.join(OUT_DIR,'direct-evaluation.json'),evidence);
  const output={decision,coverage,sharedGainOffsetDb:evidence.sharedGainOffsetDb,counts:result.counts,metrics:evidence.metrics,
    sentinelPass:deterministic,regressions:regressionResults,failedCells:failures};
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (decision!=='STAGE3_READY_FOR_STAGE4') process.exitCode=2;
}

if (require.main===module) {
  try {
    const args=process.argv.slice(2);
    if (args.length<1||args.length>3||args.filter(arg=>arg==='--dry-run'||arg==='--execute').length!==1) {
      throw new Error('Usage: run-stage3-direct-reference.cjs (--dry-run | --execute --regressions <private-results.json>)');
    }
    const mode=args[0], regressionFlag=args[1]==='--regressions'?args[2]:null;
    if (args.length>1&&(!regressionFlag||args[1]!=='--regressions')) throw new Error('Invalid arguments.');
    run(mode,regressionFlag);
  } catch(error) {
    process.stderr.write(`Stage3 runner ERROR: ${error.stack||error.message}\n`);
    process.exitCode=1;
  }
}

module.exports={BASELINE_HEAD,CANDIDATE_ID,EXPECTED_WASM_SHA256,EXPECTED_CONFIG_SHA256,EXPECTED_ARCHIVE_SHA256,
  EXPECTED_PITCHES,EXPECTED_VELOCITIES,SENTINELS,SERIALIZATION_TOLERANCE,validateReferenceFixture,
  assertExactCoverage,compareSentinelMetrics,countHardFailures,percentileSummary,evaluateDirect};
