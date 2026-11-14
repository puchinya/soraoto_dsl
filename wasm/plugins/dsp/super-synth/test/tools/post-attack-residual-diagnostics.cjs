#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {captureMatrix} = require('./capture-supersynth-matrix.cjs');
const {postAttackResiduals, brightnessDirectionMetrics} = require('./stage3-direct-reference-metrics.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const FIXTURE_PATH = path.join(ROOT, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
const SCRATCH = path.join(ROOT, '.agent-state/issues/7/post-attack-residual');
const VELOCITIES = [14, 61, 124];
const SOURCE_TREE_SHA256 = 'ffe3d5ce954db003cd684d4f0d9fc9f2936236f1e5db965d92f5c910fe580c2d';
const CANDIDATE_ROOT = path.join(ROOT, 'build/wasm/calibration/stage2d-velocity-hardness');
const CANDIDATES = Object.freeze({
  A: {directory: 'stage2d-center-a-a000', amount: 0},
  A1: {directory: 'stage2d-center-a-a100', amount: 1},
  B: {directory: 'stage2d-center-b-a000', amount: 0},
  B05: {directory: 'stage2d-center-b-a050', amount: 0.5}
});

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function key(pitch, velocity) { return `${pitch}:${velocity}`; }

function candidateIdentity(candidateKey) {
  const candidate = CANDIDATES[candidateKey];
  if (!candidate) throw new Error(`unknown candidate ${candidateKey}`);
  const root = path.join(CANDIDATE_ROOT, candidate.directory);
  const candidatePath = path.join(root, 'candidate.json');
  const resultPath = path.join(root, 'stage1-result.json');
  const candidateJson = read(candidatePath);
  const stage1 = read(resultPath);
  const buildRoot = path.join(root, 'build');
  const wasmPath = path.join(buildRoot, 'plugins/dsp/super-synth/plugin.wasm');
  const actualWasm = sha256(wasmPath);
  if (candidateJson.candidateId !== candidate.directory || stage1.candidateId !== candidate.directory) {
    throw new Error(`candidate identity mismatch at ${candidate.directory}`);
  }
  if (stage1.sourceTreeSha256 !== SOURCE_TREE_SHA256 || stage1.productionSimd !== true
      || stage1.wasmSha256 !== actualWasm || !stage1.configSha256) {
    throw new Error(`candidate provenance/SIMD/hash mismatch at ${candidate.directory}`);
  }
  const amount = candidateJson.parameters?.['hammer.velocity_hardness_amount'];
  if (amount !== candidate.amount) throw new Error(`hardness amount mismatch at ${candidate.directory}: ${amount}`);
  return {
    candidateId: candidateJson.candidateId,
    buildRoot,
    sourceTreeSha256: stage1.sourceTreeSha256,
    configSha256: stage1.configSha256,
    wasmSha256: actualWasm,
    productionSimd: stage1.productionSimd,
    parameters: candidateJson.parameters
  };
}

function conditions() {
  const A = candidateIdentity('A'), A1 = candidateIdentity('A1');
  const B = candidateIdentity('B'), B05 = candidateIdentity('B05');
  return [
    {id: 'A_AMOUNT_0', family: 'hardness', candidate: A, parameters: {}, componentCapture: true},
    {id: 'A_AMOUNT_1', family: 'hardness', candidate: A1, parameters: {}, componentCapture: false},
    {id: 'B_AMOUNT_0', family: 'hardness', candidate: B, parameters: {}, componentCapture: true},
    {id: 'B_AMOUNT_0_5', family: 'hardness', candidate: B05, parameters: {}, componentCapture: false},
    {id: 'A_DAMPING_0', family: 'string_damping', candidate: A, parameters: {piano_string_damping: 0}, componentCapture: false},
    {id: 'A_DAMPING_1', family: 'string_damping', candidate: A, parameters: {piano_string_damping: 1}, componentCapture: false},
    {id: 'A_RADIATION_BYPASS_DELTA', family: 'radiation_bypass', label: 'RADIATION_BYPASS_DELTA', candidate: A, parameters: {piano_soundboard_mix: 0}, componentCapture: true},
    {id: 'B_RADIATION_BYPASS_DELTA', family: 'radiation_bypass', label: 'RADIATION_BYPASS_DELTA', candidate: B, parameters: {piano_soundboard_mix: 0}, componentCapture: true}
  ];
}
function requestedCells(pitches = read(FIXTURE_PATH).coverage.pitches) {
  if (!Array.isArray(pitches) || pitches.length !== 30) throw new Error('diagnostic matrix requires exactly 30 direct pitch centers');
  const cells = pitches.flatMap(pitch => VELOCITIES.map(velocity => ({pitch, velocity})));
  if (cells.length !== 90 || new Set(cells.map(cell => key(cell.pitch, cell.velocity))).size !== 90) {
    throw new Error('diagnostic matrix must contain exactly 90 unique pitch/velocity cells');
  }
  return cells;
}

function metricSummary(metrics) {
  const pitch = metrics.pitchMeasurement;
  return {
    envelopeDbfs: metrics.envelopeDbfs,
    peakDbfs: metrics.peakDbfs,
    fullRenderPeakDbfs: metrics.fullRenderPeakDbfs,
    finite: metrics.finite,
    guardHits: metrics.outputGuardHits,
    brightness: {spectralCentroidHz: metrics.spectralCentroidHz, above2kPowerRatio: metrics.above2kPowerRatio},
    pitch: pitch ? {measurement_valid: pitch.measurement_valid, result: pitch.result,
      pitch_error_cents: pitch.pitch_error_cents, fitted_B: pitch.fitted_B,
      confidence_ratio: pitch.confidence_ratio, usable_partial_count: pitch.usable_partial_count} : null,
    soundboardDiagnostics: metrics.soundboardDiagnostics ?? null
  };
}

function collect({onProgress = () => {}, includeTransparency = false} = {}) {
  const fixture = read(FIXTURE_PATH);
  const pitches = fixture.coverage.pitches;
  if (pitches.length !== 30) throw new Error('expected exactly the 30 pinned Salamander direct pitch centers');
  const cells = requestedCells(pitches);
  const reference = new Map(fixture.directCells.map(cell => [key(cell.pitch, cell.velocity), cell.metrics]));
  const output = [];
  const previousBuild = process.env.SORAOTO_WASM_BUILD_DIR;
  try {
    for (const condition of conditions()) {
      process.env.SORAOTO_WASM_BUILD_DIR = condition.candidate.buildRoot;
      const parameters = {...condition.parameters};
      const componentCapture = condition.componentCapture;
      const captured = captureMatrix({cells, parameters, includePitchHealth: true, includeCalibrationDiagnostics: true,
        includeSoundboardDiagnostics: componentCapture,
        onProgress: (pitch, count) => onProgress(condition.id, pitch, count, 90)});
      if (captured.render.wasmSha256 !== condition.candidate.wasmSha256
          || captured.render.sourceRevision !== read(path.join(condition.candidate.buildRoot, '..', 'stage1-result.json')).sourceRevision) {
        throw new Error(`captured render does not match frozen candidate ${condition.candidate.candidateId}`);
      }
      const rows = captured.matrix.map(row => {
        const ref = reference.get(key(row.pitch, row.velocity));
        if (!ref) throw new Error(`pinned reference missing ${key(row.pitch, row.velocity)}`);
        const residual = postAttackResiduals(row.metrics, ref);
        const pitch = row.metrics.pitchMeasurement;
        return {pitch: row.pitch, velocity: row.velocity, velocityNormalized: row.velocity / 127,
          residual: {...residual}, measured: {...metricSummary(row.metrics), referenceEnvelopeDbfs: ref.envelopeDbfs},
          referenceBrightness: {spectralCentroidHz: ref.spectralCentroidHz, above2kPowerRatio: ref.above2kPowerRatio},
          pitchValid: pitch?.measurement_valid === true,
          pitchErrorCents: pitch?.pitch_error_cents ?? null,
          referenceLoss: referenceLoss(row.pitch, row.velocity)};
      });
      output.push({id: condition.id, family: condition.family, label: condition.label ?? condition.id,
        candidateId: condition.candidate.candidateId, candidateParameters: condition.candidate.parameters,
        overrideParameters: parameters, sourceTreeSha256: condition.candidate.sourceTreeSha256,
        configSha256: condition.candidate.configSha256, wasmSha256: condition.candidate.wasmSha256,
        sourceRevision: captured.render.sourceRevision, productionSimd: condition.candidate.productionSimd,
        componentCapture, calibrationDiagnostics: captured.diagnostics,
        soundboardMode: condition.family === 'radiation_bypass' ? 'RADIATION_BYPASS' : 'NORMAL',
        renderMetadata: {sampleRate: captured.render.sampleRate, durationMs: captured.render.durationMs,
          boardRadiationScale: captured.render.boardRadiationScale, presetConfigSha256: captured.render.presetConfigSha256},
        cells: rows});
      write(path.join(SCRATCH, 'captures', `${condition.id}.json`), output.at(-1));
    }
  } finally {
    if (previousBuild === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR = previousBuild;
  }
  const transparency = includeTransparency ? verifyDiagnosticTransparency(conditions()[0].candidate.buildRoot) : null;
  return {schemaVersion: 1, metricDefinition: 'stage3-direct-reference-post-attack-v1',
    sourceTreeSha256: SOURCE_TREE_SHA256, directPitchCount: pitches.length,
    velocities: VELOCITIES, cellCountPerCondition: cells.length, conditionCount: output.length,
    matrixCellRenderCount: cells.length * output.length,
    calibrationDiagnosticRenderCount: output.length * 3,
    diagnosticTransparencyRenderCount: includeTransparency ? 2 : 0,
    totalFreshRenders: cells.length * output.length + output.length * 3 + (includeTransparency ? 2 : 0),
    diagnosticTransparency: transparency, conditions: output};
}

function referenceLoss(pitch, velocity) {
  const keyNormalized = clamp((pitch - 21) / 87, 0, 1);
  const registerFactor = clamp((0.68 - keyNormalized) / 0.45, 0, 1);
  const velocityNormalized = velocity / 127;
  return {base: 0.0014, registerStart: 0.68, registerWidth: 0.45,
    velocityBase: 1.82, velocityScale: 0.82, keyNormalized, registerFactor,
    velocityNormalized, effective: 0.0014 * registerFactor * (1.82 - 0.82 * velocityNormalized)};
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function residualStats(cells, field) {
  const values = cells.map(cell => cell.residual[field]).filter(Number.isFinite);
  const sorted = values.slice().sort((a, b) => a - b);
  const absSorted = values.map(Math.abs).sort((a, b) => a - b);
  return {count: values.length, mean: mean(values), median: percentile(sorted, .5),
    p10: percentile(sorted, .1), p50: percentile(sorted, .5), p90: percentile(sorted, .9),
    maxPositive: values.length ? Math.max(0, ...values) : null,
    minNegative: values.length ? Math.min(0, ...values) : null,
    medianAbs: percentile(absSorted, .5), p90Abs: percentile(absSorted, .9), failuresAbsGt10Db: values.filter(value => Math.abs(value) > 10).length};
}
function dominantCounts(cells) {
  return cells.reduce((counts, cell) => { counts[cell.residual.dominantResidual]++; return counts; }, {EARLY: 0, LATE: 0, TIE: 0});
}
function sign(value) { return value > 0 ? 1 : value < 0 ? -1 : 0; }
function signFlips(cells, field, axis) {
  const groups = new Map();
  for (const cell of cells) {
    const groupKey = axis === 'velocity' ? String(cell.pitch) : `${register(cell.pitch)}:${cell.velocity}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(cell);
  }
  let flips = 0, adjacent = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => axis === 'velocity' ? a.velocity - b.velocity : a.pitch - b.pitch);
    for (let i = 1; i < group.length; i++) {
      const a = sign(group[i - 1].residual[field]), b = sign(group[i].residual[field]);
      if (a && b) { adjacent++; if (a !== b) flips++; }
    }
  }
  return {axis, flips, comparableAdjacentPairs: adjacent, rate: adjacent ? flips / adjacent : null};
}
function register(pitch) { return pitch <= 48 ? 'bass_21_48' : pitch <= 81 ? 'mid_51_81' : 'treble_84_108'; }
function aggregate(cells) {
  const groups = {all: cells};
  for (const pitch of [...new Set(cells.map(cell => cell.pitch))]) groups[`pitch_${pitch}`] = cells.filter(cell => cell.pitch === pitch);
  for (const velocity of [...new Set(cells.map(cell => cell.velocity))]) groups[`velocity_${velocity}`] = cells.filter(cell => cell.velocity === velocity);
  for (const name of ['bass_21_48', 'mid_51_81', 'treble_84_108']) groups[name] = cells.filter(cell => register(cell.pitch) === name);
  const result = {};
  for (const [name, subset] of Object.entries(groups)) {
    result[name] = {count: subset.length, early: residualStats(subset, 'earlyResidualDb'),
      late: residualStats(subset, 'lateResidualDb'), dominant: dominantCounts(subset)};
  }
  result.signFlips = {earlyAcrossVelocities: signFlips(cells, 'earlyResidualDb', 'velocity'),
    lateAcrossVelocities: signFlips(cells, 'lateResidualDb', 'velocity'),
    earlyAcrossPitchByRegisterAndVelocity: signFlips(cells, 'earlyResidualDb', 'pitch'),
    lateAcrossPitchByRegisterAndVelocity: signFlips(cells, 'lateResidualDb', 'pitch')};
  return result;
}
function pearson(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const ma = mean(a), mb = mean(b);
  const numerator = a.reduce((sum, value, i) => sum + (value - ma) * (b[i] - mb), 0);
  const da = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return da && db ? numerator / (da * db) : null;
}
function refLossCorrelations(cells) {
  const valid = cells.filter(cell => Number.isFinite(cell.referenceLoss.effective));
  const loss = valid.map(cell => cell.referenceLoss.effective);
  const early = valid.map(cell => cell.residual.earlyResidualDb);
  const late = valid.map(cell => cell.residual.lateResidualDb);
  const absLate = late.map(Math.abs);
  const shape = valid.map(cell => cell.residual.postAttackShapeErrorDb);
  return {interpretation: 'diagnostic correlation only; no causal claim', n: valid.length,
    pearson: {earlyResidualDb: pearson(loss, early), lateResidualDb: pearson(loss, late),
      absoluteLateResidualDb: pearson(loss, absLate), shapeErrorDb: pearson(loss, shape)}};
}

function pairedDelta(a, b, field) {
  const right = new Map(b.cells.map(cell => [key(cell.pitch, cell.velocity), cell]));
  const movement = a.cells.map(cell => {
    const other = right.get(key(cell.pitch, cell.velocity));
    if (!other) throw new Error(`paired matrix missing cell ${key(cell.pitch, cell.velocity)}`);
    return {pitch: cell.pitch, velocity: cell.velocity,
      deltaDb: other.residual[field] - cell.residual[field],
      absoluteResidualImprovementDb: Math.abs(cell.residual[field]) - Math.abs(other.residual[field])};
  });
  const deltas = movement.map(cell => cell.deltaDb).sort((x, y) => x - y);
  const improvements = movement.map(cell => cell.absoluteResidualImprovementDb).sort((x, y) => x - y);
  const coherentGroups = [];
  for (const groupName of ['bass_21_48', 'mid_51_81', 'treble_84_108']) {
    const group = movement.filter(cell => register(cell.pitch) === groupName);
    const positive = group.filter(cell => cell.deltaDb >= 2.5).length;
    const negative = group.filter(cell => cell.deltaDb <= -2.5).length;
    if (Math.max(positive, negative) >= Math.ceil(group.length * .5)) {
      coherentGroups.push({register: groupName, cells: group.length, positiveAtLeast2_5Db: positive,
        negativeAtLeast2_5Db: negative, direction: positive >= negative ? 'positive' : 'negative'});
    }
  }
  return {from: a.id, to: b.id, field, count: movement.length,
    medianDeltaDb: percentile(deltas, .5), p90AbsoluteMovementDb: percentile(movement.map(cell => Math.abs(cell.deltaDb)).sort((x, y) => x - y), .9),
    medianAbsoluteResidualImprovementDb: percentile(improvements, .5),
    cellsMovingAtLeast2_5Db: movement.filter(cell => Math.abs(cell.deltaDb) >= 2.5).length,
    coherentPitchGroupMovement: coherentGroups, perCell: movement};
}
function classifyMechanism(baseline, comparisons) {
  const failing = baseline.cells.filter(cell => cell.residual.postAttackShapeErrorDb > 10);
  if (!failing.length) return {mechanism: 'MIXED_OR_UNRESOLVED', reason: 'no currently failing post-attack cells in the selected baseline'};
  const counts = dominantCounts(failing);
  const familyShare = {EARLY: counts.EARLY / failing.length, LATE: counts.LATE / failing.length, TIE: counts.TIE / failing.length};
  const coherent = comparison => comparison?.coherentPitchGroupMovement?.length > 0
    && comparison.p90AbsoluteMovementDb >= 2.5;
  const lateDamping = comparisons.damping0to1Late;
  const lateRadiation = comparisons.a0ToBypassLate;
  const earlyHardness = comparisons.a0to1Early;
  const lateHardness = comparisons.a0to1Late;
  if (familyShare.LATE > .5 && coherent(lateDamping)
      && (!coherent(lateRadiation) || lateRadiation.medianAbsoluteResidualImprovementDb < 2.5)) {
    return {mechanism: 'STRING_TERMINATION_DECAY', reason: 'late residuals dominate failures, damping moves a coherent pitch/register group by >=2.5 dB, and radiation bypass is not the stronger explanation', failureDominantShare: familyShare, supportingComparison: 'damping0to1Late'};
  }
  if (familyShare.LATE > .5 && coherent(lateRadiation)
      && lateRadiation.medianAbsoluteResidualImprovementDb >= 2.5) {
    return {mechanism: 'BOARD_RADIATION_DECAY', reason: 'normal-versus-bypass paired late residual shows a coherent >=2.5 dB movement and component capture is available', failureDominantShare: familyShare, supportingComparison: 'a0ToBypassLate'};
  }
  if (familyShare.EARLY > .5 && coherent(earlyHardness)
      && (!coherent(lateHardness) || lateHardness.medianAbsoluteResidualImprovementDb < 2.5)) {
    return {mechanism: 'HAMMER_OR_EARLY_TRANSFER', reason: 'early residuals dominate failures and hardness OAT moves early response without a comparable late movement', failureDominantShare: familyShare, supportingComparison: 'a0to1Early'};
  }
  return {mechanism: 'MIXED_OR_UNRESOLVED', reason: 'no subsystem meets the required dominant-family and controlled >=2.5 dB movement criteria', failureDominantShare: familyShare};
}

function candidateResponse(condition) {
  const validPitch = condition.cells.filter(cell => cell.pitchValid && Number.isFinite(cell.pitchErrorCents));
  const perPitch = [...new Set(condition.cells.map(cell => cell.pitch))].map(pitch => {
    const cells = condition.cells.filter(cell => cell.pitch === pitch).sort((a, b) => a.velocity - b.velocity);
    const actualLevels = cells.map(cell => cell.measured.envelopeDbfs[3]);
    const referenceLevels = cells.map(cell => cell.measured.referenceEnvelopeDbfs[3]);
    const actualSpan = Math.max(...actualLevels) - Math.min(...actualLevels);
    const referenceSpan = Math.max(...referenceLevels) - Math.min(...referenceLevels);
    const low = cells[0], high = cells.at(-1);
    const lowMetrics = {spectralCentroidHz: low.measured.brightness.spectralCentroidHz,
      above2kPowerRatio: low.measured.brightness.above2kPowerRatio};
    const highMetrics = {spectralCentroidHz: high.measured.brightness.spectralCentroidHz,
      above2kPowerRatio: high.measured.brightness.above2kPowerRatio};
    const refLow = {spectralCentroidHz: low.referenceBrightness.spectralCentroidHz,
      above2kPowerRatio: low.referenceBrightness.above2kPowerRatio};
    const refHigh = {spectralCentroidHz: high.referenceBrightness.spectralCentroidHz,
      above2kPowerRatio: high.referenceBrightness.above2kPowerRatio};
    const shapeErrors = cells.map(cell => cell.residual.postAttackShapeErrorDb);
    return {pitch, threeLayerActualSpanDb: actualSpan, threeLayerReferenceSpanDb: referenceSpan,
      threeLayerSpanDifferenceDb: actualSpan - referenceSpan,
      brightnessDirection: brightnessDirectionMetrics(lowMetrics, highMetrics, refLow, refHigh),
      postAttackShapeWorstDb: Math.max(...shapeErrors)};
  });
  const pitchErrors = validPitch.map(cell => cell.pitchErrorCents);
  const calibration = condition.calibrationDiagnostics;
  return {condition: condition.id, pitchValidCount: validPitch.length,
    worstValidPitchErrorCents: pitchErrors.length ? Math.max(...pitchErrors.map(Math.abs)) : null,
    measurementInvalidCount: condition.cells.length - validPitch.length,
    peakWorstDbfs: Math.max(...condition.cells.map(cell => cell.measured.fullRenderPeakDbfs ?? cell.measured.peakDbfs)),
    guardHits: condition.cells.reduce((sum, cell) => sum + (cell.measured.guardHits || 0), 0),
    maxPostAttackShapeErrorDb: Math.max(...condition.cells.map(cell => cell.residual.postAttackShapeErrorDb)),
    threeLayerDynamicSpan: {medianDifferenceDb: percentile(perPitch.map(row => row.threeLayerSpanDifferenceDb).sort((a,b)=>a-b), .5),
      p90AbsoluteDifferenceDb: percentile(perPitch.map(row => Math.abs(row.threeLayerSpanDifferenceDb)).sort((a,b)=>a-b), .9),
      definition: 'three measured sentinel velocities [14,61,124], diagnostic only'},
    brightnessDirection: {passingPitchCount: perPitch.filter(row => !row.brightnessDirection.fails).length,
      totalPitchCount: perPitch.length, c4VelocityBrightness: calibration?.velocityBrightness ?? null},
    lowRegisterBuzz: calibration?.lowRegisterBuzz ?? null,
    diagnosticRenderPeaks: calibration?.diagnosticRenders ?? null};
}

function verifyDiagnosticTransparency(buildRoot) {
  const prior = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = buildRoot;
  try {
    const {renderNormalized} = require('./capture-supersynth-matrix.cjs');
    const ordinary = renderNormalized(60, 61 / 127, {}, {includePitchHealth: true, returnSamples: true});
    const instrumented = renderNormalized(60, 61 / 127, {}, {includePitchHealth: true, includeSoundboardDiagnostics: true, returnSamples: true});
    const {soundboardDiagnostics: ignoredA, ...a} = ordinary.metrics;
    const {soundboardDiagnostics: ignoredB, ...b} = instrumented.metrics;
    const changed = [];
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push('metrics');
    if (ordinary.left.length !== instrumented.left.length || ordinary.right.length !== instrumented.right.length) changed.push('sample-count');
    let changedSamples = 0, maxAbsSampleDifference = 0;
    for (let i = 0; i < Math.min(ordinary.left.length, instrumented.left.length); i++) {
      const dl = Math.abs(ordinary.left[i] - instrumented.left[i]);
      const dr = Math.abs(ordinary.right[i] - instrumented.right[i]);
      if (dl !== 0) changedSamples++;
      if (dr !== 0) changedSamples++;
      maxAbsSampleDifference = Math.max(maxAbsSampleDifference, dl, dr);
    }
    const result = {changedSamples, maxAbsSampleDifference,
      metricsIdentical: JSON.stringify(a) === JSON.stringify(b), guardIdentical: a.outputGuardHits === b.outputGuardHits,
      componentDiagnosticsPresent: Boolean(ignoredB?.signals), changedFields: changed};
    if (result.changedSamples !== 0 || result.maxAbsSampleDifference !== 0 || !result.metricsIdentical
        || !result.guardIdentical || !result.componentDiagnosticsPresent) {
      throw new Error(`diagnostic instrumentation transparency failed: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    if (prior === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
    else process.env.SORAOTO_WASM_BUILD_DIR = prior;
  }
}

function analyze(captureSet) {
  const byId = new Map(captureSet.conditions.map(condition => [condition.id, condition]));
  const comparisons = {
    a0to1Early: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_AMOUNT_1'), 'earlyResidualDb'),
    a0to1Late: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_AMOUNT_1'), 'lateResidualDb'),
    b0to05Early: pairedDelta(byId.get('B_AMOUNT_0'), byId.get('B_AMOUNT_0_5'), 'earlyResidualDb'),
    b0to05Late: pairedDelta(byId.get('B_AMOUNT_0'), byId.get('B_AMOUNT_0_5'), 'lateResidualDb'),
    damping0to1Early: pairedDelta(byId.get('A_DAMPING_0'), byId.get('A_DAMPING_1'), 'earlyResidualDb'),
    damping0to1Late: pairedDelta(byId.get('A_DAMPING_0'), byId.get('A_DAMPING_1'), 'lateResidualDb'),
    a0toDamping0Early: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_DAMPING_0'), 'earlyResidualDb'),
    a0toDamping0Late: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_DAMPING_0'), 'lateResidualDb'),
    a0toDamping1Early: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_DAMPING_1'), 'earlyResidualDb'),
    a0toDamping1Late: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_DAMPING_1'), 'lateResidualDb'),
    a0ToBypassEarly: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_RADIATION_BYPASS_DELTA'), 'earlyResidualDb'),
    a0ToBypassLate: pairedDelta(byId.get('A_AMOUNT_0'), byId.get('A_RADIATION_BYPASS_DELTA'), 'lateResidualDb'),
    b0ToBypassEarly: pairedDelta(byId.get('B_AMOUNT_0'), byId.get('B_RADIATION_BYPASS_DELTA'), 'earlyResidualDb'),
    b0ToBypassLate: pairedDelta(byId.get('B_AMOUNT_0'), byId.get('B_RADIATION_BYPASS_DELTA'), 'lateResidualDb')
  };
  const baseline = byId.get('A_AMOUNT_0');
  const invalidPitchCells = captureSet.conditions.flatMap(condition => condition.cells
    .filter(cell => !cell.pitchValid).map(cell => `${condition.id}:${cell.pitch}:${cell.velocity}`));
  const responses = captureSet.conditions.map(candidateResponse);
  const responseById = new Map(responses.map(row => [row.condition, row]));
  const board = captureSet.conditions.filter(condition => condition.componentCapture)
    .map(condition => ({condition: condition.id, mode: condition.soundboardMode,
      label: condition.label, totals: sumBoardSignals(condition.cells)}));
  return {schemaVersion: 1, metricDefinition: captureSet.metricDefinition,
    matrix: {directPitches: captureSet.directPitchCount, velocities: captureSet.velocities,
      cellsPerCondition: captureSet.cellCountPerCondition, conditionCount: captureSet.conditionCount,
      matrixCellRenders: captureSet.matrixCellRenderCount,
      calibrationDiagnosticRenders: captureSet.calibrationDiagnosticRenderCount,
      diagnosticTransparencyRenders: captureSet.diagnosticTransparencyRenderCount,
      totalFreshRenders: captureSet.totalFreshRenders},
    residualAggregation: Object.fromEntries(captureSet.conditions.map(condition => [condition.id, aggregate(condition.cells)])),
    fixedReferenceLoss: {coefficients: {base: .0014, registerStart: .68, registerWidth: .45, velocityBase: 1.82, velocityScale: .82},
      correlations: refLossCorrelations(baseline.cells), perCell: baseline.cells.map(cell => ({pitch: cell.pitch, velocity: cell.velocity, ...cell.referenceLoss}))},
    controlledComparisons: comparisons, velocityHardnessInteraction: {
      CenterA_amount0_to1: {early: comparisons.a0to1Early, late: comparisons.a0to1Late,
        responseDelta: responseDelta(responseById.get('A_AMOUNT_0'), responseById.get('A_AMOUNT_1'))},
      CenterB_amount0_to0_5: {early: comparisons.b0to05Early, late: comparisons.b0to05Late,
        responseDelta: responseDelta(responseById.get('B_AMOUNT_0'), responseById.get('B_AMOUNT_0_5'))}},
    conditionResponses: responses,
    soundboardAttribution: {comparisonLabel: 'RADIATION_BYPASS_DELTA', modes: board,
      normalVsBypass: {CenterA: boardSignalDelta(byId.get('A_AMOUNT_0'), byId.get('A_RADIATION_BYPASS_DELTA')),
        CenterB: boardSignalDelta(byId.get('B_AMOUNT_0'), byId.get('B_RADIATION_BYPASS_DELTA'))},
      caution: 'soundboard_mix=0 removes board radiation contribution for comparison; remaining output is not labeled DRY_STRING_ONLY'},
    mechanismAssessment: classifyMechanism(baseline, comparisons),
    health: {pitchMeasurementInvalidCount: invalidPitchCells.length, pitchMeasurementInvalidCells: invalidPitchCells,
      guardHits: captureSet.conditions.reduce((sum, condition) => sum + condition.cells.reduce((n, cell) => n + (cell.measured.guardHits || 0), 0), 0),
      nonFiniteCells: captureSet.conditions.flatMap(condition => condition.cells.filter(cell => !cell.measured.finite).map(cell => `${condition.id}:${cell.pitch}:${cell.velocity}`)),
      peakWorstDbfs: Math.max(...captureSet.conditions.flatMap(condition => condition.cells.map(cell => cell.measured.fullRenderPeakDbfs ?? cell.measured.peakDbfs)))},
    diagnosticTransparency: captureSet.diagnosticTransparency ?? null,
    conditions: captureSet.conditions.map(({cells, ...condition}) => condition)};
}
function sumBoardSignals(cells) {
  const totals = {};
  for (const cell of cells) for (const [name, signal] of Object.entries(cell.measured.soundboardDiagnostics?.signals ?? {})) {
    if (!totals[name]) totals[name] = {rmsSum: 0, peak: 0, count: 0};
    totals[name].rmsSum += signal.rms; totals[name].peak = Math.max(totals[name].peak, signal.peak); totals[name].count++;
  }
  for (const value of Object.values(totals)) value.rmsMean = value.count ? value.rmsSum / value.count : null;
  return totals;
}
function boardSignalDelta(normal, bypass) {
  const a = sumBoardSignals(normal.cells), b = sumBoardSignals(bypass.cells);
  const signals = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const normalRms = a[name]?.rmsMean ?? null, bypassRms = b[name]?.rmsMean ?? null;
    signals[name] = {normalRmsMean: normalRms, bypassRmsMean: bypassRms,
      rmsMeanDelta: Number.isFinite(normalRms) && Number.isFinite(bypassRms) ? normalRms - bypassRms : null,
      normalPeak: a[name]?.peak ?? null, bypassPeak: b[name]?.peak ?? null};
  }
  return signals;
}
function responseDelta(before, after) {
  const beforeBuzz = before.lowRegisterBuzz?.value;
  const afterBuzz = after.lowRegisterBuzz?.value;
  return {worstValidPitchErrorCents: delta(after.worstValidPitchErrorCents, before.worstValidPitchErrorCents),
    peakWorstDbfs: delta(after.peakWorstDbfs, before.peakWorstDbfs),
    maxPostAttackShapeErrorDb: delta(after.maxPostAttackShapeErrorDb, before.maxPostAttackShapeErrorDb),
    threeLayerDynamicSpanDifferenceDb: delta(after.threeLayerDynamicSpan.medianDifferenceDb, before.threeLayerDynamicSpan.medianDifferenceDb),
    brightnessDirectionPassingPitchCount: delta(after.brightnessDirection.passingPitchCount, before.brightnessDirection.passingPitchCount),
    c4VelocityBrightnessRatio: delta(after.brightnessDirection.c4VelocityBrightness?.ratio, before.brightnessDirection.c4VelocityBrightness?.ratio),
    lowRegisterBuzz: delta(afterBuzz, beforeBuzz),
    definition: 'after minus before; three-layer dynamic span is diagnostic only'};
}
function delta(after, before) { return Number.isFinite(after) && Number.isFinite(before) ? after - before : null; }

function run({outputPath = path.join(SCRATCH, 'diagnostics.json'), onProgress = () => {}} = {}) {
  const started = performance.now();
  const captureSet = collect({onProgress, includeTransparency: true});
  const report = analyze(captureSet);
  report.elapsedSeconds = (performance.now() - started) / 1000;
  report.sourceRevision = captureSet.conditions[0].sourceRevision;
  report.sourceTreeSha256 = SOURCE_TREE_SHA256;
  write(outputPath, report);
  return report;
}

if (require.main === module) {
  try {
    const outputArg = process.argv[2];
    const report = run({outputPath: outputArg ? path.resolve(outputArg) : undefined,
      onProgress: (condition, pitch, count, total) => process.stderr.write(`${condition}: MIDI ${pitch} (${count}/${total})\n`)});
    console.log(JSON.stringify({output: outputArg ?? path.relative(ROOT, path.join(SCRATCH, 'diagnostics.json')),
      renders: report.matrix.totalFreshRenders, conditions: report.matrix.conditionCount,
      invalidPitch: report.health.pitchMeasurementInvalidCount, guardHits: report.health.guardHits,
      peakWorstDbfs: report.health.peakWorstDbfs, mechanism: report.mechanismAssessment.mechanism,
      elapsedSeconds: report.elapsedSeconds}));
  } catch (error) {
    console.error(`POST-ATTACK DIAGNOSTICS ERROR: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {VELOCITIES, candidateIdentity, conditions, requestedCells, collect, analyze,
  referenceLoss, residualStats, aggregate, pairedDelta, classifyMechanism, verifyDiagnosticTransparency};
