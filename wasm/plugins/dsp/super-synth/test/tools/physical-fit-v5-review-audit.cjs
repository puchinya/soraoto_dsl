'use strict';

// Pure, read-only audit of the frozen Physical Fit v5 planner's 9x9x9 grid.
// The frozen planner's public generateCandidates API is used to enumerate the
// private fixed grid with a synthetic zero-residual model. Real model math,
// baselines, predictions, and eligible ordering all come from its public API.

const model = require('./physical-fit-v5-local-model.cjs');
const v5core = require('./issue7-physical-fit-v5-core.cjs');

const DUPLICATE_TOLERANCE = 1e-9;
const SUPPORT_LIMIT = 0.01;
const CLASSIFICATIONS = Object.freeze([
  'CENTER', 'OUT_OF_BOX', 'MEASURED_DUPLICATE', 'S_AND_P', 'S_ONLY', 'P_ONLY', 'NEITHER'
]);

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`BLOCKED_REVIEW_AUDIT_NONFINITE: ${label}`);
  return value;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function classifyGridPoint({indices, values, observed, nearest, predicted14, upperBoundDb}) {
  if (indices.every(value => value === 0)) return {classification: 'CENTER', reason: ['CENTER']};
  if (values.some((value, index) => value < model.BASELINES[index] * 0.9 - 1e-12
      || value > model.BASELINES[index] * 1.1 + 1e-12)) {
    return {classification: 'OUT_OF_BOX', reason: ['OUTSIDE_PARAMETER_BOX']};
  }
  const normalizedValues = model.normalized(values);
  if (observed.some(item => model.maxCoordinateDifference(normalizedValues, model.normalized(item.values)) <= DUPLICATE_TOLERANCE)) {
    return {classification: 'MEASURED_DUPLICATE', reason: ['MEASURED_POINT_WITHIN_1E_9']};
  }
  const supported = nearest.some(item => Math.max(...values.map((value, index) =>
    Math.abs(value - item.values[index]) / model.BASELINES[index])) <= SUPPORT_LIMIT);
  const predictedPass = upperBoundDb <= model.MAX_PREDICTED_SHAPE_DB;
  const reason = [];
  if (!supported) reason.push('OUTSIDE_LOCAL_SUPPORT_0.01');
  if (!predictedPass) reason.push('UPPER_BOUND_EXCEEDS_9.95_DB');
  for (const value of predicted14) finite(value, 'predicted14');
  if (supported && predictedPass) return {classification: 'S_AND_P', reason: ['SUPPORTED_AND_PREDICTED']};
  if (supported) return {classification: 'S_ONLY', reason};
  if (predictedPass) return {classification: 'P_ONLY', reason};
  return {classification: 'NEITHER', reason};
}

function assertSameEligibleAsFrozenPlanner(auditedEligible, frozenEligible) {
  const actual = auditedEligible.map(item => item.values);
  const expected = frozenEligible.map(item => item.values);
  if (!same(actual, expected)) throw new Error('BLOCKED_REVIEW_AUDIT_FROZEN_PLANNER_MISMATCH');
  return {count: actual.length, values: actual};
}

function summarizeSet(rows) {
  if (!rows.length) return {count: 0, minU: null, minMaxAbsPredicted: null,
    minSupportDistance: null, maxSupportDistance: null};
  const support = rows.map(item => item.maxRelativeCoordinateDistance);
  return {
    count: rows.length,
    minU: Math.min(...rows.map(item => item.U)),
    minMaxAbsPredicted: Math.min(...rows.map(item => item.maxAbsPredicted)),
    minSupportDistance: Math.min(...support),
    maxSupportDistance: Math.max(...support)
  };
}

function gridSummary(points) {
  if (!Array.isArray(points) || points.length !== 729) throw new Error('BLOCKED_REVIEW_AUDIT_GRID_COUNT');
  const counts = Object.fromEntries(CLASSIFICATIONS.map(name => [name, 0]));
  for (const point of points) {
    if (!Object.hasOwn(counts, point.classification)) throw new Error('BLOCKED_REVIEW_AUDIT_CLASSIFICATION');
    counts[point.classification]++;
  }
  const supported = points.filter(item => item.classification === 'S_AND_P' || item.classification === 'S_ONLY');
  const predicted = points.filter(item => item.classification === 'S_AND_P' || item.classification === 'P_ONLY');
  return {
    total: points.length,
    counts,
    eligibleCount: counts.S_AND_P,
    all: summarizeSet(points),
    supportSatisfied: summarizeSet(supported),
    predictionSatisfied: summarizeSet(predicted)
  };
}

function enumerateFrozenGrid(best) {
  if (!best || !Array.isArray(best.values) || best.values.length !== 3) throw new Error('BLOCKED_REVIEW_AUDIT_GRID_ANCHOR');
  const centerKey = JSON.stringify(best.values);
  const points = new Map([[centerKey, [...best.values]]]);
  const nearest = [{id: 'synthetic-grid-seed', values: [...best.values]}];
  const coefficients = Array.from({length: model.OUTPUTS}, () => [0, 0, 0, 0]);
  for (let iteration = 0; iteration < 12 && points.size < 729; iteration++) {
    const candidates = model.generateCandidates({best, observed: [], nearest, coefficients, looErrorDb: 0});
    let added = 0;
    for (const candidate of candidates) {
      const key = JSON.stringify(candidate.values);
      if (points.has(key)) continue;
      const values = [...candidate.values];
      points.set(key, values);
      nearest.push({id: `synthetic-grid-${points.size}`, values});
      added++;
    }
    if (!added) break;
  }
  if (points.size !== 729) throw new Error(`BLOCKED_REVIEW_AUDIT_GRID_ENUMERATION: ${points.size}`);
  const values = [...points.values()];
  const axes = [0, 1, 2].map(parameter => [...new Set(values.map(row => row[parameter]))].sort((a, b) => a - b));
  if (axes.some(axis => axis.length !== 9)) throw new Error('BLOCKED_REVIEW_AUDIT_GRID_AXES');
  const center = (axes[0].length - 1) / 2;
  return values.map(row => ({values: row,
    indices: row.map((value, parameter) => axes[parameter].indexOf(value) - center)}))
    .sort((left, right) => left.values[0] - right.values[0] || left.values[1] - right.values[1]
      || left.values[2] - right.values[2]);
}

function auditFixedGrid({best, observed, nearest, coefficients, looErrorDb}) {
  if (!best || !Array.isArray(best.values) || best.values.length !== 3
      || !Array.isArray(observed) || !observed.length || !Array.isArray(nearest) || nearest.length !== model.MAX_POINTS
      || !Array.isArray(coefficients) || coefficients.length !== model.OUTPUTS
      || !Number.isFinite(looErrorDb) || looErrorDb < 0) {
    throw new Error('BLOCKED_REVIEW_AUDIT_INPUT');
  }
  const points = [];
  const frozenGrid = enumerateFrozenGrid(best);
  for (const {indices, values} of frozenGrid) {
    const predicted14 = model.predict(coefficients, values);
    if (predicted14.length !== model.OUTPUTS) throw new Error('BLOCKED_REVIEW_AUDIT_OUTPUT_COUNT');
    const maxIndex = predicted14.reduce((bestIndex, value, current) =>
      Math.abs(value) > Math.abs(predicted14[bestIndex]) ? current : bestIndex, 0);
    const maxAbsPredicted = Math.max(...predicted14.map(Math.abs));
    const U = maxAbsPredicted + looErrorDb;
    finite(U, 'U');

    const normalizedValues = model.normalized(values);
    const distanceFromBest = model.distance(normalizedValues, model.normalized(best.values));
    const distances = nearest.map(item => ({
      id: item.id,
      distance: model.distance(normalizedValues, model.normalized(item.values)),
      maxRelativeCoordinateDistance: Math.max(...values.map((value, index) =>
        Math.abs(value - item.values[index]) / model.BASELINES[index]))
    })).sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
    if (!distances.length || !Number.isFinite(distances[0].distance)) throw new Error('BLOCKED_REVIEW_AUDIT_NEAREST');
    const nearestPoint = distances[0];
    const state = classifyGridPoint({indices, values, observed, nearest, predicted14, upperBoundDb: U});
    points.push({
      index: {k0: indices[0], k1: indices[1], k2: indices[2]}, values, predicted14, maxAbsPredicted, U,
      nearestId: nearestPoint.id,
      nearestDistance: nearestPoint.distance,
      distanceFromBest,
      maxRelativeCoordinateDistance: Math.min(...distances.map(item => item.maxRelativeCoordinateDistance)),
      maxSignedResidualId: `${v5core.STRESS_CELLS[Math.floor(maxIndex / 2)].pitch}-${v5core.STRESS_CELLS[Math.floor(maxIndex / 2)].velocity}-${maxIndex % 2 === 0 ? 'EARLY' : 'LATE'}`,
      classification: state.classification,
      reason: state.reason
    });
  }
  if (frozenGrid.length !== 729 || points.length !== 729) throw new Error('BLOCKED_REVIEW_AUDIT_GRID_COUNT');
  const eligible = points.filter(item => item.classification === 'S_AND_P')
    .sort((left, right) => left.U - right.U || left.distanceFromBest - right.distanceFromBest
      || left.values[0] - right.values[0] || left.values[1] - right.values[1] || left.values[2] - right.values[2]);
  const frozen = model.generateCandidates({best, observed, nearest, coefficients, looErrorDb});
  const plannerMatch = assertSameEligibleAsFrozenPlanner(eligible, frozen);
  return {
    schemaVersion: 1,
    order: 'k0-major,k1-middle,k2-minor;-4..4',
    points,
    summary: gridSummary(points),
    plannerMatch,
    best5: eligible.slice(0, 5).map(({values, U, nearestId, nearestDistance, maxSignedResidualId}) =>
      ({values, U, nearestTrainingId: nearestId, nearestDistance, maxSignedResidualId}))
  };
}

function auditObservations(observations) {
  const modelResult = model.evaluateLocalModel(observations);
  if (!modelResult.coefficients || modelResult.rank !== 4 || modelResult.looErrorDb === null) {
    throw new Error(`BLOCKED_REVIEW_AUDIT_MODEL: ${modelResult.decision}`);
  }
  const report = auditFixedGrid({best: modelResult.best, observed: observations, nearest: modelResult.nearest,
    coefficients: modelResult.coefficients, looErrorDb: modelResult.looErrorDb});
  return {...report, model: {
    bestId: modelResult.best.id,
    bestValues: modelResult.best.values,
    rank: modelResult.rank,
    conditionNumber: modelResult.conditionNumber,
    looErrorDb: modelResult.looErrorDb,
    observationCount: observations.length,
    nearestIds: modelResult.nearest.map(item => item.id),
    candidateCount: modelResult.candidates.length
  }};
}

module.exports = {CLASSIFICATIONS, classifyGridPoint, gridSummary, enumerateFrozenGrid,
  assertSameEligibleAsFrozenPlanner, auditFixedGrid, auditObservations};
