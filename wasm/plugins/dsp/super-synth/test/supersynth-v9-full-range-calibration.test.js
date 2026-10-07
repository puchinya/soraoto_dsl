'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {captureMatrix, VELOCITIES} = require('./tools/capture-supersynth-matrix.cjs');

const ROOT = path.resolve(__dirname, '../../../../../');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference/salamander-grand-piano-v3-metrics.json'), 'utf8'));
const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'wasm/plugins/dsp/super-synth/presets.json'), 'utf8')).concert_grand;
const PITCHES = Array.from({length: 88}, (_, i) => i + 21);
const CENTERS = fixture.coverage.pitches;
const ENVELOPE_WINDOWS = ['0to10', '10to30', '30to80', '80to200', '200to350'];

// Broad gates protect against a missed key, an unstable render, or a severe local
// mismatch. Shape-only checks use post-attack windows; mic image and near-zero
// harmonic ratios remain visible diagnostics because the synth is not a sample clone.
const LIMITS = {
  peakMaxDbfs: 1.6,
  peakMinDbfs: -90,
  directLevelErrorDb: 20,
  centroidRatio: 8,
  centroidEnergyFloor: 0.001,
  above2kDelta: 1,
  postAttackShapeErrorDb: 10,
  adjacentLevelJumpDb: 10,
  adjacentCentroidRatio: 4.5,
  adjacentAbove2kDelta: 0.5,
  adjacentLateDecayDeltaDb: 8,
  adjacentStereoPanDelta: 0.3,
  velocityLevelDropDb: 1,
  minimumVelocityLevelSpanDb: 6
};

function check(value, message) {
  if (!value) throw new Error(message);
}

function cellKey(pitch, velocity) {
  return `${pitch}:${velocity}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function distribution(values) {
  return {
    p50: +percentile(values, 0.50).toFixed(4),
    p90: +percentile(values, 0.90).toFixed(4),
    p95: +percentile(values, 0.95).toFixed(4),
    max: +Math.max(...values).toFixed(4)
  };
}

function interpolate(a, b, t) {
  return a + (b - a) * t;
}

function interpolateArray(a, b, t, log = false) {
  return a.map((value, i) => log
    ? Math.exp(interpolate(Math.log(Math.max(1e-6, value)), Math.log(Math.max(1e-6, b[i] ?? value)), t))
    : interpolate(value, b[i] ?? value, t));
}

function buildExpectedMatrix() {
  check(CENTERS.length === 30 && fixture.coverage.directCells === 480, 'Salamander reference coverage is not 30 centers / 480 cells');
  check(JSON.stringify(VELOCITIES) === JSON.stringify(fixture.coverage.velocityRepresentatives), 'reference velocity representatives changed');
  const direct = new Map(fixture.directCells.map(row => [cellKey(row.pitch, row.velocity), row.metrics]));
  const expected = new Map();
  for (const pitch of PITCHES) {
    let hiIndex = CENTERS.findIndex(center => center >= pitch);
    if (hiIndex < 0) hiIndex = CENTERS.length - 1;
    const leftPitch = CENTERS[Math.max(0, hiIndex - (CENTERS[hiIndex] === pitch ? 0 : 1))];
    const rightPitch = CENTERS[hiIndex];
    const mix = leftPitch === rightPitch ? 0 : (pitch - leftPitch) / (rightPitch - leftPitch);
    for (const velocity of VELOCITIES) {
      const left = direct.get(cellKey(leftPitch, velocity));
      const right = direct.get(cellKey(rightPitch, velocity));
      check(left && right, `missing Salamander source mapping for ${pitch}:${velocity}`);
      const metrics = {
        onsetMs: interpolate(left.onsetMs, right.onsetMs, mix),
        peakDbfs: interpolate(left.peakDbfs, right.peakDbfs, mix),
        spectralCentroidHz: Math.exp(interpolate(Math.log(left.spectralCentroidHz), Math.log(right.spectralCentroidHz), mix)),
        above2kPowerRatio: interpolate(left.above2kPowerRatio, right.above2kPowerRatio, mix),
        envelopeDbfs: interpolateArray(left.envelopeDbfs, right.envelopeDbfs, mix),
        envelope20msDbfs: interpolateArray(left.envelope20msDbfs, right.envelope20msDbfs, mix),
        harmonicRatiosH2ToH6: interpolateArray(left.harmonicRatiosH2ToH6, right.harmonicRatiosH2ToH6, mix, true),
        stereoWidth: interpolate(left.stereoWidth, right.stereoWidth, mix),
        stereoPan: interpolate(left.stereoPan, right.stereoPan, mix),
        inharmonicityB: interpolate(left.inharmonicityB, right.inharmonicityB, mix),
        spectralSpreadHz: Math.exp(interpolate(Math.log(left.spectralSpreadHz), Math.log(right.spectralSpreadHz), mix))
      };
      expected.set(cellKey(pitch, velocity), {pitch, velocity, metrics, direct: leftPitch === pitch, leftPitch, rightPitch, mix});
    }
  }
  return expected;
}

function loadRenderedMatrix() {
  if (process.env.SUPERSYNTH_MATRIX_PATH) {
    const matrixPath = path.resolve(process.env.SUPERSYNTH_MATRIX_PATH);
    const document = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
    check(document.render?.pluginVersion === '9.0.0', 'matrix is not a SuperSynth 9.0.0 render');
    check(document.render?.preset === 'concert_grand', 'matrix was not rendered with concert_grand');
    return document;
  }
  return captureMatrix({pitches: PITCHES, velocities: VELOCITIES});
}

function csv(rows, columns) {
  const quote = value => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${columns.join(',')}\n${rows.map(row => columns.map(column => quote(row[column])).join(',')).join('\n')}\n`;
}

function writeReports(dir, reports) {
  if (!dir) return;
  const output = path.resolve(dir);
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, 'full-range-cells.csv'), csv(reports.cells, [
    'pitch', 'velocity', 'directReference', 'referencePitchLeft', 'referencePitchRight', 'referencePitchMix',
    'onsetMs', 'referenceOnsetMs', 'onsetDeltaMs', 'earlyAttackShapeErrorDb',
    'peakDbfs', 'referencePeakDbfs', 'peakDeltaDb', 'levelErrorDb',
    ...ENVELOPE_WINDOWS.flatMap(window => [`renderEnvelope${window}Dbfs`, `referenceEnvelope${window}Dbfs`]),
    'centroidHz', 'referenceCentroidHz', 'centroidRatio', 'centroidComparable',
    'above2kPowerRatio', 'referenceAbove2kPowerRatio', 'above2kDelta', 'postAttackShapeErrorDb',
    ...[2, 3, 4, 5, 6].flatMap(n => [`renderH${n}ToH1`, `referenceH${n}ToH1`]),
    'h2ToH6MaxFactor', 'stereoWidth', 'referenceStereoWidth', 'stereoWidthDelta',
    'stereoPan', 'referenceStereoPan', 'inharmonicityB', 'referenceInharmonicityB',
    'spectralSpreadHz', 'referenceSpectralSpreadHz', 'hardFailures'
  ]));
  fs.writeFileSync(path.join(output, 'adjacent-continuity.csv'), csv(reports.adjacent, [
    'lowerPitch', 'upperPitch', 'velocity', 'levelJumpDb', 'centroidRatio', 'centroidComparable', 'above2kDelta',
    'lateDecayDeltaDb', 'inharmonicityDelta', 'spectralSpreadRatio', 'stereoPanDelta',
    'stereoWidthDelta', 'hardFailures'
  ]));
  fs.writeFileSync(path.join(output, 'velocity-progression.csv'), csv(reports.velocity, [
    'pitch', 'firstVelocity', 'lastVelocity', 'levelSpanDb', 'lowToHighCentroidRatio',
    'lowToHighAbove2kDelta', 'inversionsOverLimit', 'minimumAdjacentLevelChangeDb'
  ]));
  fs.writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(reports.summary, null, 2)}\n`);
}

function main() {
  const rendered = loadRenderedMatrix();
  const matrix = rendered.matrix;
  check(matrix.length === 1408, `render coverage ${matrix.length}/1408`);
  const actual = new Map(matrix.map(row => [cellKey(row.pitch, row.velocity), row.metrics]));
  check(actual.size === 1408, `unique render cells ${actual.size}/1408`);
  check(rendered.render.pluginId === 'net.puchinya.soraotodsl.super-synth-v8', `Plugin ID ${rendered.render.pluginId}`);
  check(JSON.stringify(rendered.render.velocityRepresentatives) === JSON.stringify(VELOCITIES), 'render velocity representatives changed');
  check(Math.abs(rendered.render.pianoHammerHardness - preset.piano_hammer_hardness) < 1e-9, 'matrix hardness does not match concert_grand preset');
  check(Math.abs(rendered.render.pianoHammerNoise - preset.piano_hammer_noise) < 1e-9, 'matrix hammer noise does not match concert_grand preset');
  const repeat = captureMatrix({pitches: [21, 60, 83, 87, 108], velocities: [14, 61, 124]});
  for (const sample of repeat.matrix) {
    const original = actual.get(cellKey(sample.pitch, sample.velocity));
    check(JSON.stringify(sample.metrics) === JSON.stringify(original), `non-deterministic render ${cellKey(sample.pitch, sample.velocity)}`);
  }
  const expected = buildExpectedMatrix();
  const directOffsets = [];
  for (const source of fixture.directCells) {
    const measured = actual.get(cellKey(source.pitch, source.velocity));
    check(measured, `missing direct render ${cellKey(source.pitch, source.velocity)}`);
    directOffsets.push(source.metrics.envelopeDbfs[3] - measured.envelopeDbfs[3]);
  }
  const sharedGainOffsetDb = median(directOffsets);
  const cells = [];
  const cellFailures = [];
  let lowEnergyCentroidOutliers = 0;
  const cellMetrics = {level: [], directLevel: [], interpolatedLevel: [], peak: [], centroid: [], comparableCentroid: [], above2k: [], shape: [], harmonicFactor: [], stereoWidth: [], inharmonicity: [], spreadRatio: [], onset: [], attackShape: []};

  for (const [key, target] of expected) {
    const measured = actual.get(key), reference = target.metrics;
    const levelErrorDb = measured.envelopeDbfs[3] + sharedGainOffsetDb - reference.envelopeDbfs[3];
    const centroidRatio = Math.max(measured.spectralCentroidHz / reference.spectralCentroidHz, reference.spectralCentroidHz / measured.spectralCentroidHz);
    const above2kDelta = Math.abs(measured.above2kPowerRatio - reference.above2kPowerRatio);
    const centroidComparable = Math.max(measured.above2kPowerRatio, reference.above2kPowerRatio) >= LIMITS.centroidEnergyFloor;
    if (!centroidComparable && centroidRatio > LIMITS.centroidRatio) lowEnergyCentroidOutliers++;
    const onsetDeltaMs = measured.onsetMs - reference.onsetMs;
    const earlyAttackShapeErrorDb = Math.max(...measured.envelope20msDbfs.slice(0, 5).map((value, i) =>
      Math.abs((value - measured.envelope20msDbfs[3]) - (reference.envelope20msDbfs[i] - reference.envelope20msDbfs[3]))));
    const postAttackShapeErrorDb = Math.max(
      Math.abs((measured.envelopeDbfs[2] - measured.envelopeDbfs[3]) - (reference.envelopeDbfs[2] - reference.envelopeDbfs[3])),
      Math.abs((measured.envelopeDbfs[4] - measured.envelopeDbfs[3]) - (reference.envelopeDbfs[4] - reference.envelopeDbfs[3]))
    );
    const harmonicFactors = measured.harmonicRatiosH2ToH6.flatMap((value, i) => {
      const targetValue = reference.harmonicRatiosH2ToH6[i];
      if (!Number.isFinite(targetValue)) return [];
      return Math.max((value + 0.01) / (targetValue + 0.01), (targetValue + 0.01) / (value + 0.01));
    });
    const h2ToH6MaxFactor = harmonicFactors.length ? Math.max(...harmonicFactors) : 0;
    const stereoWidthDelta = Math.abs(measured.stereoWidth - reference.stereoWidth);
    const hardFailures = [];
    if (measured.peakDbfs > LIMITS.peakMaxDbfs || measured.peakDbfs < LIMITS.peakMinDbfs) hardFailures.push('peakSafety');
    if (target.direct && Math.abs(levelErrorDb) > LIMITS.directLevelErrorDb) hardFailures.push('directLevel');
    if (centroidComparable && centroidRatio > LIMITS.centroidRatio) hardFailures.push('centroid');
    if (above2kDelta > LIMITS.above2kDelta) hardFailures.push('above2k');
    if (postAttackShapeErrorDb > LIMITS.postAttackShapeErrorDb) hardFailures.push('postAttackShape');
    if (hardFailures.length) cellFailures.push(`${key}: ${hardFailures.join('+')}`);
    cells.push({
      pitch: target.pitch, velocity: target.velocity, directReference: target.direct,
      referencePitchLeft: target.leftPitch, referencePitchRight: target.rightPitch, referencePitchMix: +target.mix.toFixed(4),
      onsetMs: measured.onsetMs, referenceOnsetMs: +reference.onsetMs.toFixed(4), onsetDeltaMs: +onsetDeltaMs.toFixed(4),
      earlyAttackShapeErrorDb: +earlyAttackShapeErrorDb.toFixed(4),
      peakDbfs: measured.peakDbfs, referencePeakDbfs: +reference.peakDbfs.toFixed(4), peakDeltaDb: +(measured.peakDbfs - reference.peakDbfs).toFixed(4),
      levelErrorDb: +levelErrorDb.toFixed(4),
      ...Object.fromEntries(ENVELOPE_WINDOWS.flatMap((window, i) => [
        [`renderEnvelope${window}Dbfs`, measured.envelopeDbfs[i]],
        [`referenceEnvelope${window}Dbfs`, +reference.envelopeDbfs[i].toFixed(4)]
      ])),
      centroidHz: measured.spectralCentroidHz, referenceCentroidHz: +reference.spectralCentroidHz.toFixed(4), centroidRatio: +centroidRatio.toFixed(4), centroidComparable,
      above2kPowerRatio: measured.above2kPowerRatio, referenceAbove2kPowerRatio: +reference.above2kPowerRatio.toFixed(6), above2kDelta: +above2kDelta.toFixed(6),
      postAttackShapeErrorDb: +postAttackShapeErrorDb.toFixed(4), h2ToH6MaxFactor: +h2ToH6MaxFactor.toFixed(4),
      ...Object.fromEntries([2, 3, 4, 5, 6].flatMap((n, i) => [
        [`renderH${n}ToH1`, measured.harmonicRatiosH2ToH6[i] ?? null],
        [`referenceH${n}ToH1`, Number.isFinite(reference.harmonicRatiosH2ToH6[i]) ? +reference.harmonicRatiosH2ToH6[i].toFixed(6) : null]
      ])),
      stereoWidth: measured.stereoWidth, referenceStereoWidth: +reference.stereoWidth.toFixed(6), stereoWidthDelta: +stereoWidthDelta.toFixed(6),
      stereoPan: measured.stereoPan, referenceStereoPan: +reference.stereoPan.toFixed(6),
      inharmonicityB: measured.inharmonicityB, referenceInharmonicityB: +reference.inharmonicityB.toFixed(8),
      spectralSpreadHz: measured.spectralSpreadHz, referenceSpectralSpreadHz: +reference.spectralSpreadHz.toFixed(4),
      hardFailures: hardFailures.join(';')
    });
    cellMetrics.level.push(Math.abs(levelErrorDb));
    (target.direct ? cellMetrics.directLevel : cellMetrics.interpolatedLevel).push(Math.abs(levelErrorDb));
    cellMetrics.peak.push(measured.peakDbfs);
    cellMetrics.centroid.push(centroidRatio);
    if (centroidComparable) cellMetrics.comparableCentroid.push(centroidRatio);
    cellMetrics.above2k.push(above2kDelta);
    cellMetrics.shape.push(postAttackShapeErrorDb);
    cellMetrics.harmonicFactor.push(h2ToH6MaxFactor);
    cellMetrics.stereoWidth.push(stereoWidthDelta);
    cellMetrics.inharmonicity.push(Math.abs(measured.inharmonicityB - reference.inharmonicityB));
    cellMetrics.spreadRatio.push(Math.max(measured.spectralSpreadHz / reference.spectralSpreadHz, reference.spectralSpreadHz / measured.spectralSpreadHz));
    cellMetrics.onset.push(Math.abs(onsetDeltaMs));
    cellMetrics.attackShape.push(earlyAttackShapeErrorDb);
  }

  const adjacent = [];
  const adjacentFailures = [];
  let lowEnergyAdjacentCentroidOutliers = 0;
  const adjacentMetrics = {level: [], centroid: [], comparableCentroid: [], above2k: [], lateDecay: [], pan: []};
  for (let pitch = 21; pitch < 108; pitch++) {
    for (const velocity of VELOCITIES) {
      const a = actual.get(cellKey(pitch, velocity)), b = actual.get(cellKey(pitch + 1, velocity));
      const levelJumpDb = Math.abs(b.envelopeDbfs[3] - a.envelopeDbfs[3]);
      const centroidRatio = Math.max(b.spectralCentroidHz / a.spectralCentroidHz, a.spectralCentroidHz / b.spectralCentroidHz);
      const above2kDelta = Math.abs(b.above2kPowerRatio - a.above2kPowerRatio);
      const centroidComparable = Math.max(a.above2kPowerRatio, b.above2kPowerRatio) >= LIMITS.centroidEnergyFloor;
      if (!centroidComparable && centroidRatio > LIMITS.adjacentCentroidRatio) lowEnergyAdjacentCentroidOutliers++;
      const lateDecayDeltaDb = Math.abs((b.envelopeDbfs[4] - b.envelopeDbfs[3]) - (a.envelopeDbfs[4] - a.envelopeDbfs[3]));
      const inharmonicityDelta = Math.abs(b.inharmonicityB - a.inharmonicityB);
      const spectralSpreadRatio = Math.max(b.spectralSpreadHz / a.spectralSpreadHz, a.spectralSpreadHz / b.spectralSpreadHz);
      const stereoPanDelta = Math.abs(b.stereoPan - a.stereoPan);
      const stereoWidthDelta = Math.abs(b.stereoWidth - a.stereoWidth);
      const hardFailures = [];
      if (levelJumpDb > LIMITS.adjacentLevelJumpDb) hardFailures.push('levelJump');
      if (centroidComparable && centroidRatio > LIMITS.adjacentCentroidRatio) hardFailures.push('centroidJump');
      if (above2kDelta > LIMITS.adjacentAbove2kDelta) hardFailures.push('above2kJump');
      if (lateDecayDeltaDb > LIMITS.adjacentLateDecayDeltaDb) hardFailures.push('lateDecayJump');
      if (stereoPanDelta > LIMITS.adjacentStereoPanDelta) hardFailures.push('stereoPanJump');
      if (hardFailures.length) adjacentFailures.push(`${pitch}-${pitch + 1}:${velocity}: ${hardFailures.join('+')}`);
      adjacent.push({pitch, lowerPitch: pitch, upperPitch: pitch + 1, velocity,
        levelJumpDb: +levelJumpDb.toFixed(4), centroidRatio: +centroidRatio.toFixed(4), centroidComparable,
        above2kDelta: +above2kDelta.toFixed(6), lateDecayDeltaDb: +lateDecayDeltaDb.toFixed(4),
        inharmonicityDelta: +inharmonicityDelta.toFixed(8), spectralSpreadRatio: +spectralSpreadRatio.toFixed(4),
        stereoPanDelta: +stereoPanDelta.toFixed(6), stereoWidthDelta: +stereoWidthDelta.toFixed(6), hardFailures: hardFailures.join(';')});
      adjacentMetrics.level.push(levelJumpDb);
      adjacentMetrics.centroid.push(centroidRatio);
      if (centroidComparable) adjacentMetrics.comparableCentroid.push(centroidRatio);
      adjacentMetrics.above2k.push(above2kDelta);
      adjacentMetrics.lateDecay.push(lateDecayDeltaDb);
      adjacentMetrics.pan.push(stereoPanDelta);
    }
  }
  check(adjacent.length === 1392, `adjacent coverage ${adjacent.length}/1392`);

  const velocity = [];
  const velocityFailures = [];
  let brighteningPitches = 0;
  for (const pitch of PITCHES) {
    const row = VELOCITIES.map(v => actual.get(cellKey(pitch, v)));
    const levels = row.map(item => item.envelopeDbfs[3]);
    const minimumAdjacentLevelChangeDb = Math.min(...levels.slice(1).map((value, i) => value - levels[i]));
    const inversionsOverLimit = levels.slice(1).filter((value, i) => value < levels[i] - LIMITS.velocityLevelDropDb).length;
    const levelSpanDb = Math.max(...levels) - Math.min(...levels);
    const lowToHighCentroidRatio = row.at(-1).spectralCentroidHz / row[0].spectralCentroidHz;
    const lowToHighAbove2kDelta = row.at(-1).above2kPowerRatio - row[0].above2kPowerRatio;
    if (inversionsOverLimit) velocityFailures.push(`${pitch}: ${inversionsOverLimit} layer drop(s) exceed ${LIMITS.velocityLevelDropDb} dB`);
    if (levelSpanDb < LIMITS.minimumVelocityLevelSpanDb) velocityFailures.push(`${pitch}: velocity level span ${levelSpanDb.toFixed(1)} dB`);
    if (lowToHighCentroidRatio >= 1.05 || lowToHighAbove2kDelta >= 0.03) brighteningPitches++;
    velocity.push({pitch, firstVelocity: VELOCITIES[0], lastVelocity: VELOCITIES.at(-1),
      levelSpanDb: +levelSpanDb.toFixed(4), lowToHighCentroidRatio: +lowToHighCentroidRatio.toFixed(4),
      lowToHighAbove2kDelta: +lowToHighAbove2kDelta.toFixed(6), inversionsOverLimit,
      minimumAdjacentLevelChangeDb: +minimumAdjacentLevelChangeDb.toFixed(4)});
  }
  const brightnessCoverage = brighteningPitches / PITCHES.length;
  if (brightnessCoverage < 0.75) velocityFailures.push(`only ${brighteningPitches}/88 pitches brighten across velocity (${(brightnessCoverage * 100).toFixed(1)}%)`);

  const summary = {
    schemaVersion: 1,
    reference: 'Salamander Grand Piano V3; derived numeric metrics only',
    render: {pluginVersion: rendered.render.pluginVersion, preset: rendered.render.preset, sampleRate: rendered.render.sampleRate,
      durationMs: rendered.render.durationMs, velocityRepresentatives: rendered.render.velocityRepresentatives,
      pianoHammerHardness: preset.piano_hammer_hardness, pianoHammerNoise: preset.piano_hammer_noise},
    coverage: {directReferenceCells: fixture.directCells.length, renderCells: cells.length,
      pitches: PITCHES.length, velocityLayers: VELOCITIES.length, adjacentComparisons: adjacent.length,
      interpolatedPitches: PITCHES.length - CENTERS.length},
    sharedGainOffsetDb: +sharedGainOffsetDb.toFixed(4),
    limits: LIMITS,
    directAndFullRangeErrorDistribution: {
      absoluteLevelErrorDbAllCells: distribution(cellMetrics.level),
      directReferenceAbsoluteLevelErrorDb: distribution(cellMetrics.directLevel),
      interpolatedKeyAbsoluteLevelErrorDb: distribution(cellMetrics.interpolatedLevel),
      peakDbfs: distribution(cellMetrics.peak),
      centroidRatio: distribution(cellMetrics.centroid),
      centroidRatioWhenEnergyFloorMet: distribution(cellMetrics.comparableCentroid),
      lowEnergyCentroidOutliersDiagnostic: lowEnergyCentroidOutliers,
      above2kAbsoluteDelta: distribution(cellMetrics.above2k), postAttackShapeErrorDb: distribution(cellMetrics.shape),
      maxHarmonicRatioFactorWith0_01Floor: distribution(cellMetrics.harmonicFactor),
      stereoWidthDeltaDiagnostic: distribution(cellMetrics.stereoWidth),
      inharmonicityAbsoluteDeltaDiagnostic: distribution(cellMetrics.inharmonicity),
      spectralSpreadRatioDiagnostic: distribution(cellMetrics.spreadRatio),
      onsetAbsoluteDeltaMsDiagnostic: distribution(cellMetrics.onset),
      earlyAttackShapeErrorDbDiagnostic: distribution(cellMetrics.attackShape)
    },
    adjacentContinuityDistribution: {
      levelJumpDb: distribution(adjacentMetrics.level), centroidRatio: distribution(adjacentMetrics.centroid),
      centroidRatioWhenEnergyFloorMet: distribution(adjacentMetrics.comparableCentroid),
      above2kAbsoluteDelta: distribution(adjacentMetrics.above2k), lateDecayDeltaDb: distribution(adjacentMetrics.lateDecay),
      stereoPanDelta: distribution(adjacentMetrics.pan), lowEnergyCentroidOutliersDiagnostic: lowEnergyAdjacentCentroidOutliers
    },
    velocityResponse: {pitchesWithBrightnessEvolution: brighteningPitches, brightnessEvolutionCoverage: +brightnessCoverage.toFixed(4),
      levelDropToleranceDb: LIMITS.velocityLevelDropDb, minimumLevelSpanDb: LIMITS.minimumVelocityLevelSpanDb},
    failures: {directAndInterpolatedCells: cellFailures.length, adjacentComparisons: adjacentFailures.length,
      velocityPitchesOrLayers: velocityFailures.length, examples: [...cellFailures, ...adjacentFailures, ...velocityFailures].slice(0, 20)}
  };
  const reports = {cells, adjacent, velocity, summary};
  writeReports(process.env.SUPERSYNTH_REPORT_DIR, reports);

  const failures = [...cellFailures.map(x => `cell ${x}`), ...adjacentFailures.map(x => `adjacent ${x}`), ...velocityFailures.map(x => `velocity ${x}`)];
  if (failures.length) {
    throw new Error(`SuperSynth V9 full-range calibration failed (${failures.length}; shared gain offset ${sharedGainOffsetDb.toFixed(2)} dB). Full per-cell and pair records are available through SUPERSYNTH_REPORT_DIR.\n${failures.slice(0, 40).join('\n')}`);
  }
  console.log('PASS SuperSynth V9 full-range calibration', summary);
}

main();
