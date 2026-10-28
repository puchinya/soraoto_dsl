'use strict';

const BASELINES = Object.freeze([1.05, 0.5, 0.018]);
const MAX_POINTS = 12;
const OUTPUTS = 14;
const RIDGE = 1e-4;
const MAX_CONDITION = 1e5;
const MAX_LOO_ERROR_DB = 0.20;
const MAX_PREDICTED_SHAPE_DB = 9.95;
const DUPLICATE_TOLERANCE = 1e-9;
const GRID_INDICES = Object.freeze([-4, -3, -2, -1, 0, 1, 2, 3, 4]);

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`BLOCKED_V5_INVALID_${label}`);
}

function validateValues(values) {
  if (!Array.isArray(values) || values.length !== BASELINES.length) throw new Error('BLOCKED_V5_INVALID_VECTOR');
  values.forEach((value, index) => {
    finiteNumber(value, 'VECTOR');
    if (value < BASELINES[index] * 0.9 || value > BASELINES[index] * 1.1) throw new Error('BLOCKED_V5_VECTOR_OUTSIDE_APPROVED_BOX');
  });
  return values.slice();
}

function normalized(values) {
  return validateValues(values).map((value, index) => (value / BASELINES[index] - 1) / 0.1);
}

function distance(left, right) {
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0));
}

function maxCoordinateDifference(left, right) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

function compareScores(left, right) {
  for (const key of ['violation', 'loss']) {
    finiteNumber(left[key], 'SCORE');
    finiteNumber(right[key], 'SCORE');
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  const distanceDelta = distance(normalized(left.values), [0, 0, 0]) - distance(normalized(right.values), [0, 0, 0]);
  return distanceDelta || String(left.id).localeCompare(String(right.id));
}

function residualVector(observation) {
  if (Array.isArray(observation.residuals)) {
    if (observation.residuals.length !== OUTPUTS) throw new Error('BLOCKED_V5_RESIDUAL_DIMENSION');
    observation.residuals.forEach(value => finiteNumber(value, 'RESIDUAL'));
    return observation.residuals.slice();
  }
  const cells = observation.official?.cells;
  if (!Array.isArray(cells) || cells.length !== 7) throw new Error('BLOCKED_V5_RESIDUAL_CELLS');
  const result = cells.flatMap(cell => [cell.earlyResidualDb, cell.lateResidualDb]);
  if (result.length !== OUTPUTS) throw new Error('BLOCKED_V5_RESIDUAL_DIMENSION');
  result.forEach(value => finiteNumber(value, 'RESIDUAL'));
  return result;
}

function uniqueObservations(observations) {
  const sorted = [...observations].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const unique = [];
  for (const observation of sorted) {
    if (!observation || typeof observation.id !== 'string' || !observation.id) throw new Error('BLOCKED_V5_INVALID_OBSERVATION_ID');
    validateValues(observation.values);
    const point = normalized(observation.values);
    if (!unique.some(existing => maxCoordinateDifference(normalized(existing.values), point) <= DUPLICATE_TOLERANCE)) unique.push(observation);
  }
  return unique;
}

function nearestObservations(observations, best, count = MAX_POINTS) {
  if (!Array.isArray(observations) || !observations.length) throw new Error('BLOCKED_V5_NO_OBSERVATIONS');
  const anchor = normalized(best.values);
  return uniqueObservations(observations)
    .map(observation => ({observation, distance: distance(normalized(observation.values), anchor)}))
    .sort((a, b) => a.distance - b.distance || String(a.observation.id).localeCompare(String(b.observation.id)))
    .slice(0, count).map(item => item.observation);
}

function designRows(points, anchor) {
  return points.map(point => {
    const x = normalized(point.values);
    const weight = 1 / (0.05 + distance(x, anchor) ** 2);
    return {x: [1, ...x], weight};
  });
}

function gramMatrix(points, anchor) {
  const gram = Array.from({length: 4}, () => Array(4).fill(0));
  for (const {x, weight} of designRows(points, anchor)) {
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) gram[row][column] += weight * x[row] * x[column];
  }
  return gram;
}

function rankAndCondition(points, anchor) {
  // One-sided Jacobi SVD avoids squaring the condition number in A^T A, which
  // otherwise makes exact rank loss look full-rank through round-off noise.
  const rows = designRows(points, anchor).map(row => row.x.map(value => Math.sqrt(row.weight) * value));
  for (let sweep = 0; sweep < 100; sweep++) {
    let changed = false;
    for (let left = 0; left < 4; left++) for (let right = left + 1; right < 4; right++) {
      let aa = 0, bb = 0, ab = 0;
      for (const row of rows) { aa += row[left] ** 2; bb += row[right] ** 2; ab += row[left] * row[right]; }
      if (Math.abs(ab) <= Number.EPSILON * Math.sqrt(aa * bb) * rows.length) continue;
      const tau = (bb - aa) / (2 * ab);
      const tangent = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const cosine = 1 / Math.sqrt(1 + tangent * tangent), sine = tangent * cosine;
      for (const row of rows) {
        const a = row[left], b = row[right];
        row[left] = cosine * a - sine * b;
        row[right] = sine * a + cosine * b;
      }
      changed = true;
    }
    if (!changed) break;
  }
  const singularValues = Array.from({length: 4}, (_, column) => Math.sqrt(rows.reduce((sum, row) => sum + row[column] ** 2, 0)))
    .sort((a, b) => b - a);
  const tolerance = Math.max(points.length, 4) * Number.EPSILON * singularValues[0];
  const rank = singularValues.filter(value => value > tolerance).length;
  return {rank, conditionNumber: singularValues[3] > 0 ? singularValues[0] / singularValues[3] : Infinity, singularValues};
}

function solve(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-14) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index < 5; index++) rows[column][index] /= divisor;
    for (let row = 0; row < 4; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index < 5; index++) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map(row => row[4]);
}

function fitWls(points, anchor, targets) {
  if (points.length !== targets.length) throw new Error('BLOCKED_V5_WLS_ROW_COUNT');
  const gram = gramMatrix(points, anchor);
  for (let index = 1; index < 4; index++) gram[index][index] += RIDGE;
  const rows = designRows(points, anchor), coefficients = [];
  for (let output = 0; output < OUTPUTS; output++) {
    const rhs = Array(4).fill(0);
    for (let row = 0; row < rows.length; row++) {
      const target = targets[row][output];
      finiteNumber(target, 'RESIDUAL');
      for (let index = 0; index < 4; index++) rhs[index] += rows[row].weight * rows[row].x[index] * target;
    }
    const beta = solve(gram, rhs);
    if (!beta || beta.some(value => !Number.isFinite(value))) return null;
    coefficients.push(beta);
  }
  return coefficients;
}

function predict(coefficients, values) {
  const x = [1, ...normalized(values)];
  return coefficients.map(beta => beta.reduce((sum, value, index) => sum + value * x[index], 0));
}

function generateCandidates({best, observed, nearest, coefficients, looErrorDb}) {
  const anchor = normalized(best.values), measured = observed.map(item => normalized(item.values));
  const candidates = [];
  for (const a of GRID_INDICES) for (const b of GRID_INDICES) for (const c of GRID_INDICES) {
    const indices = [a, b, c];
    if (indices.every(value => value === 0)) continue;
    const values = best.values.map((value, index) => value + indices[index] * 0.005 * BASELINES[index]);
    if (values.some((value, index) => value < BASELINES[index] * 0.9 - 1e-12 || value > BASELINES[index] * 1.1 + 1e-12)) continue;
    const point = normalized(values);
    if (measured.some(existing => maxCoordinateDifference(existing, point) <= DUPLICATE_TOLERANCE)) continue;
    const nearTrainingPoint = nearest.some(item => Math.max(...values.map((value, index) => Math.abs(value - item.values[index]) / BASELINES[index])) <= 0.01);
    if (!nearTrainingPoint) continue;
    const residuals = predict(coefficients, values);
    const upperBoundDb = Math.max(...residuals.map(Math.abs)) + looErrorDb;
    if (upperBoundDb <= MAX_PREDICTED_SHAPE_DB) candidates.push({values, upperBoundDb, distanceFromBest: distance(point, anchor)});
  }
  return candidates.sort((left, right) => left.upperBoundDb - right.upperBoundDb
    || left.distanceFromBest - right.distanceFromBest
    || left.values[0] - right.values[0] || left.values[1] - right.values[1] || left.values[2] - right.values[2]);
}

function evaluateLocalModel(observations) {
  if (!Array.isArray(observations) || observations.length < MAX_POINTS) throw new Error('BLOCKED_V5_INSUFFICIENT_OBSERVATIONS');
  const best = [...observations].sort(compareScores)[0];
  const nearest = nearestObservations(observations, best, MAX_POINTS);
  if (nearest.length !== MAX_POINTS) throw new Error('BLOCKED_V5_INSUFFICIENT_UNIQUE_OBSERVATIONS');
  const anchor = normalized(best.values), targets = nearest.map(residualVector);
  const matrix = rankAndCondition(nearest, anchor);
  if (matrix.rank < 4 || matrix.conditionNumber > MAX_CONDITION) {
    return {decision: 'BLOCKED_V5_LOCAL_IDENTIFIABILITY', best, nearest, rank: matrix.rank, conditionNumber: matrix.conditionNumber,
      singularValues: matrix.singularValues, looErrorDb: null, coefficients: null, candidates: []};
  }
  const coefficients = fitWls(nearest, anchor, targets);
  if (!coefficients) return {decision: 'BLOCKED_V5_LOCAL_IDENTIFIABILITY', best, nearest, ...matrix, looErrorDb: null, coefficients: null, candidates: []};

  let looErrorDb = 0;
  for (let omitted = 0; omitted < nearest.length; omitted++) {
    const training = nearest.filter((_, index) => index !== omitted);
    const trainingTargets = targets.filter((_, index) => index !== omitted);
    const fold = rankAndCondition(training, anchor);
    if (fold.rank < 4 || fold.conditionNumber > MAX_CONDITION) {
      return {decision: 'BLOCKED_V5_LOCAL_IDENTIFIABILITY', best, nearest, ...matrix, looErrorDb: null, coefficients, candidates: []};
    }
    const foldCoefficients = fitWls(training, anchor, trainingTargets);
    if (!foldCoefficients) return {decision: 'BLOCKED_V5_LOCAL_IDENTIFIABILITY', best, nearest, ...matrix, looErrorDb: null, coefficients, candidates: []};
    const predicted = predict(foldCoefficients, nearest[omitted].values);
    for (let output = 0; output < OUTPUTS; output++) looErrorDb = Math.max(looErrorDb, Math.abs(predicted[output] - targets[omitted][output]));
  }
  const candidates = looErrorDb > MAX_LOO_ERROR_DB ? []
    : generateCandidates({best, observed: observations, nearest, coefficients, looErrorDb});
  return {decision: looErrorDb > MAX_LOO_ERROR_DB ? 'BLOCKED_V5_SURROGATE_UNRELIABLE'
    : candidates.length ? 'V5_READ_ONLY_DIAGNOSTICS_PASS' : 'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT',
  best, nearest, ...matrix, looErrorDb, coefficients, candidates};
}

module.exports = {BASELINES, MAX_POINTS, OUTPUTS, RIDGE, MAX_CONDITION, MAX_LOO_ERROR_DB, MAX_PREDICTED_SHAPE_DB,
  normalized, distance, maxCoordinateDifference, compareScores, residualVector, uniqueObservations, nearestObservations, rankAndCondition,
  fitWls, predict, generateCandidates, evaluateLocalModel};
