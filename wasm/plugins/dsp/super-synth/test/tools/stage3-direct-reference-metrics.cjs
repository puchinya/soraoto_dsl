'use strict';

const LIMITS = Object.freeze({
  directLevelErrorDb: 20,
  centroidRatio: 8,
  centroidEnergyFloor: 0.001,
  above2kDelta: 1,
  postAttackShapeErrorDb: 10,
  dynamicSpanErrorDb: 8,
  brightnessCentroidRatio: 1.05,
  brightnessAbove2kDelta: 0.03,
  peakMaxDbfs: 0
});

function postAttackResiduals(actual, reference) {
  if (!actual?.envelopeDbfs || !reference?.envelopeDbfs
      || actual.envelopeDbfs.length < 5 || reference.envelopeDbfs.length < 5) {
    throw new Error('post-attack residuals require five envelope windows for render and reference');
  }
  const renderEarlyRelDb = actual.envelopeDbfs[2] - actual.envelopeDbfs[3];
  const referenceEarlyRelDb = reference.envelopeDbfs[2] - reference.envelopeDbfs[3];
  const earlyResidualDb = renderEarlyRelDb - referenceEarlyRelDb;
  const renderLateRelDb = actual.envelopeDbfs[4] - actual.envelopeDbfs[3];
  const referenceLateRelDb = reference.envelopeDbfs[4] - reference.envelopeDbfs[3];
  const lateResidualDb = renderLateRelDb - referenceLateRelDb;
  const earlyMagnitude = Math.abs(earlyResidualDb), lateMagnitude = Math.abs(lateResidualDb);
  return {
    renderEarlyRelDb, referenceEarlyRelDb, earlyResidualDb,
    renderLateRelDb, referenceLateRelDb, lateResidualDb,
    postAttackShapeErrorDb: Math.max(earlyMagnitude, lateMagnitude),
    dominantResidual: earlyMagnitude > lateMagnitude ? 'EARLY' : lateMagnitude > earlyMagnitude ? 'LATE' : 'TIE'
  };
}

function postAttackShapeErrorDb(actual, reference) {
  return postAttackResiduals(actual, reference).postAttackShapeErrorDb;
}

function dynamicSpanMetrics(actualLevels, referenceLevels) {
  if (!actualLevels.length || actualLevels.length !== referenceLevels.length) {
    throw new Error('dynamic-span inputs must contain the same non-empty set of velocity layers');
  }
  const actualSpanDb = Math.max(...actualLevels) - Math.min(...actualLevels);
  const referenceSpanDb = Math.max(...referenceLevels) - Math.min(...referenceLevels);
  const errorDb = Math.abs(actualSpanDb - referenceSpanDb);
  return {actualSpanDb, referenceSpanDb, errorDb, violationDb: errorDb - LIMITS.dynamicSpanErrorDb};
}

function brightnessDirectionMetrics(actualLow, actualHigh, referenceLow, referenceHigh) {
  const referenceCentroidRatio = referenceHigh.spectralCentroidHz / referenceLow.spectralCentroidHz;
  const referenceAbove2kDelta = referenceHigh.above2kPowerRatio - referenceLow.above2kPowerRatio;
  const referenceBrightens = referenceCentroidRatio >= LIMITS.brightnessCentroidRatio
    || referenceAbove2kDelta >= LIMITS.brightnessAbove2kDelta;
  const actualCentroidRatio = actualHigh.spectralCentroidHz / actualLow.spectralCentroidHz;
  const actualAbove2kDelta = actualHigh.above2kPowerRatio - actualLow.above2kPowerRatio;
  const centroidMargin = actualCentroidRatio - 1 / LIMITS.brightnessCentroidRatio;
  const above2kMargin = actualAbove2kDelta + LIMITS.brightnessAbove2kDelta;
  // The authoritative gate fails only when both independent brightness measures
  // show material darkening; a passing either measure satisfies the direction gate.
  const violation = referenceBrightens ? Math.max(0, -Math.max(centroidMargin, above2kMargin)) : 0;
  return {referenceBrightens, actualCentroidRatio, actualAbove2kDelta,
    centroidMargin, above2kMargin, minimumDirectionMargin: referenceBrightens ? Math.max(centroidMargin, above2kMargin) : null,
    violation, fails: violation > 0};
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function key(pitch, velocity) { return `${pitch}:${velocity}`; }

function evaluateDirectReferenceMatrix(referenceCells, measuredCells, {requiredVelocityLayers = null} = {}) {
  if (!referenceCells.length || !measuredCells.length) throw new Error('direct-reference matrix cannot be empty');
  const references = new Map(referenceCells.map(cell => [key(cell.pitch, cell.velocity), cell.metrics ?? cell]));
  const measured = new Map(measuredCells.map(cell => [key(cell.pitch, cell.velocity), cell.metrics ?? cell]));
  const completeLayers = requiredVelocityLayers ?? [...new Set(referenceCells.map(cell => cell.velocity))].sort((a, b) => a - b);
  const matched = measuredCells.map(cell => {
    const k = key(cell.pitch, cell.velocity), actual = measured.get(k), reference = references.get(k);
    if (!reference) throw new Error(`reference is missing ${k}`);
    if (!actual) throw new Error(`render is missing ${k}`);
    return {pitch: cell.pitch, velocity: cell.velocity, actual, reference};
  });
  const sharedGainOffsetDb = median(matched.map(cell => cell.reference.envelopeDbfs[3] - cell.actual.envelopeDbfs[3]));
  const cells = matched.map(({pitch, velocity, actual, reference}) => {
    const levelErrorDb = actual.envelopeDbfs[3] + sharedGainOffsetDb - reference.envelopeDbfs[3];
    const centroidRatio = Math.max(actual.spectralCentroidHz / reference.spectralCentroidHz,
      reference.spectralCentroidHz / actual.spectralCentroidHz);
    const above2kDelta = Math.abs(actual.above2kPowerRatio - reference.above2kPowerRatio);
    const centroidComparable = Math.max(actual.above2kPowerRatio, reference.above2kPowerRatio) >= LIMITS.centroidEnergyFloor;
    const shapeResiduals = postAttackResiduals(actual, reference);
    const shapeErrorDb = shapeResiduals.postAttackShapeErrorDb;
    const hardFailures = [];
    if (!actual.finite) hardFailures.push('finite');
    if (actual.peakDbfs >= LIMITS.peakMaxDbfs) hardFailures.push('peak');
    if ((actual.outputGuardHits || 0) !== 0) hardFailures.push('guard');
    if (Math.abs(levelErrorDb) > LIMITS.directLevelErrorDb) hardFailures.push('directLevel');
    if (centroidComparable && centroidRatio > LIMITS.centroidRatio) hardFailures.push('centroid');
    if (above2kDelta > LIMITS.above2kDelta) hardFailures.push('above2k');
    if (shapeErrorDb > LIMITS.postAttackShapeErrorDb) hardFailures.push('postAttackShape');
    return {pitch, velocity, finite: actual.finite, peakDbfs: actual.peakDbfs,
      guardHits: actual.outputGuardHits || 0, levelErrorDb, directLevelViolationDb: Math.abs(levelErrorDb) - LIMITS.directLevelErrorDb,
      centroidRatio, centroidComparable, above2kDelta, postAttackShapeErrorDb: shapeErrorDb,
      ...shapeResiduals,
      postAttackPass: shapeErrorDb <= LIMITS.postAttackShapeErrorDb,
      postAttackShapeViolationDb: shapeErrorDb - LIMITS.postAttackShapeErrorDb, hardFailures};
  });

  const velocitiesByPitch = new Map();
  for (const cell of matched) {
    if (!velocitiesByPitch.has(cell.pitch)) velocitiesByPitch.set(cell.pitch, []);
    velocitiesByPitch.get(cell.pitch).push(cell);
  }
  const velocity = [];
  for (const [pitch, row] of [...velocitiesByPitch.entries()].sort((a, b) => a[0] - b[0])) {
    const actual = row.slice().sort((a, b) => a.velocity - b.velocity);
    if (actual.length !== completeLayers.length || actual.some((cell, index) => cell.velocity !== completeLayers[index])) continue;
    const refs = actual.map(cell => references.get(key(pitch, cell.velocity)));
    const uniqueLayers = new Set(actual.map(cell => cell.velocity));
    if (uniqueLayers.size !== row.length || actual.length < 2) throw new Error(`duplicate velocity layers for pitch ${pitch}`);
    const span = dynamicSpanMetrics(actual.map(cell => cell.actual.envelopeDbfs[3]), refs.map(ref => ref.envelopeDbfs[3]));
    const direction = brightnessDirectionMetrics(actual[0].actual, actual.at(-1).actual, refs[0], refs.at(-1));
    const failures = [];
    if (span.violationDb > 0) failures.push('dynamicSpan');
    if (direction.fails) failures.push('brightnessDirection');
    velocity.push({pitch, ...span, ...direction, failures});
  }
  const values = array => array.length ? {
    p50: +percentile(array, 0.50).toFixed(4), p90: +percentile(array, 0.90).toFixed(4),
    p95: +percentile(array, 0.95).toFixed(4), max: +Math.max(...array).toFixed(4)
  } : {p50: null, p90: null, p95: null, max: null};
  const percentile = (array, fraction) => {
    const sorted = [...array].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  };
  const shapeValues = cells.map(cell => cell.postAttackShapeErrorDb);
  const levelViolations = cells.map(cell => cell.directLevelViolationDb);
  const peakWorstDbfs = Math.max(...cells.map(cell => cell.peakDbfs));
  const guardHitTotal = cells.reduce((sum, cell) => sum + cell.guardHits, 0);
  const finite = cells.every(cell => cell.finite === true);
  const maxPositive = array => Math.max(0, ...array);
  return {
    schemaVersion: 1, sharedGainOffsetDb, limits: LIMITS, coverage: {cells: cells.length, pitches: velocity.length},
    cells, velocity,
    metrics: {
      peakWorstDbfs, guardHitTotal, finite,
      cellFailureCount: cells.filter(cell => cell.hardFailures.length).length,
      directPitchFailureCount: velocity.filter(pitch => pitch.failures.length).length,
      postAttackShape: {failCount: cells.filter(cell => cell.hardFailures.includes('postAttackShape')).length,
        maxViolationDb: Math.max(...cells.map(cell => cell.postAttackShapeViolationDb)), ...values(shapeValues)},
      dynamicSpan: {failingPitchCount: velocity.filter(pitch => pitch.failures.includes('dynamicSpan')).length,
        maxAbsoluteErrorDb: Math.max(0, ...velocity.map(pitch => pitch.errorDb)),
        maxViolationDb: velocity.length ? Math.max(...velocity.map(pitch => pitch.violationDb)) : null,
        perPitch: velocity.map(({pitch, actualSpanDb, referenceSpanDb, errorDb, violationDb}) => ({pitch, actualSpanDb, referenceSpanDb, errorDb, violationDb}))},
      brightnessDirection: {failingPitchCount: velocity.filter(pitch => pitch.failures.includes('brightnessDirection')).length,
        minimumDirectionMargin: velocity.some(pitch => pitch.minimumDirectionMargin !== null)
          ? Math.min(...velocity.filter(pitch => pitch.minimumDirectionMargin !== null).map(pitch => pitch.minimumDirectionMargin)) : null,
        perPitch: velocity.map(({pitch, referenceBrightens, minimumDirectionMargin, violation}) => ({pitch, referenceBrightens, minimumDirectionMargin, violation}))},
      directLevel: {failCount: cells.filter(cell => cell.hardFailures.includes('directLevel')).length,
        maxViolationDb: Math.max(...levelViolations)},
      peakViolationDbfs: peakWorstDbfs,
      guardViolation: guardHitTotal,
      finiteViolation: finite ? 0 : 1
    }
  };
}

module.exports = {LIMITS, postAttackResiduals, postAttackShapeErrorDb, dynamicSpanMetrics, brightnessDirectionMetrics,
  median, evaluateDirectReferenceMatrix};
