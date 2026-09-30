'use strict';

const {estimateExpectedPitch} = require('./salamander-metrics.cjs');

const MIN_CONFIDENCE_RATIO = 1.03; // diagnostic compatibility only; not a validity gate
const DEFAULT_WINDOW_MS = [20, 550];
const MAX_PARTIALS = 8;
const MAX_ANALYSIS_HZ_RATIO = 0.45;
const MAX_WINDOW_PITCH_SPREAD_CENTS = 8;
const MAX_PARTIAL_F0_SPREAD_CENTS = 8;
const MAX_PARTIAL_FIT_RESIDUAL_CENTS = 12;
const MAX_MEASUREMENT_UNCERTAINTY_CENTS = 8;
const LOCAL_MATCH_RADIUS_CENTS = 32;
const MIN_PEAK_SNR_AMPLITUDE = 3;
const MIN_LOCAL_UNIQUENESS = 1.02;

function midiToHz(pitch) {
  return 440 * 2 ** ((pitch - 69) / 12);
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result <<= 1;
  return result;
}

function detectOnset(left, right, sampleRate) {
  const block = Math.max(32, Math.floor(sampleRate * 0.002));
  let peak = 0;
  const limit = Math.min(left.length, Math.floor(sampleRate * 0.6));
  for (let i = 0; i < limit; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  if (!(peak > 0)) return 0;
  const threshold = Math.max(peak * 0.015, 1e-6);
  for (let start = 0; start < limit; start += block) {
    const end = Math.min(limit, start + block);
    let energy = 0;
    for (let i = start; i < end; i++) energy += left[i] * left[i] + right[i] * right[i];
    if (Math.sqrt(energy / Math.max(1, 2 * (end - start))) >= threshold) return start;
  }
  return 0;
}

function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let base = 0; base < n; base += length) {
      let wr = 1, wi = 0;
      for (let j = 0; j < length / 2; j++) {
        const even = base + j, odd = even + length / 2;
        const tr = wr * real[odd] - wi * imag[odd];
        const ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
        const nextWr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nextWr;
      }
    }
  }
}

function makeSpectrum(left, right, sampleRate, onset, startMs, endMs, expectedHz) {
  const start = onset + Math.floor(sampleRate * startMs / 1000);
  const end = Math.min(left.length, right.length, onset + Math.floor(sampleRate * endMs / 1000));
  const length = end - start;
  const minimumWindowSeconds = Math.max(0.08, 5 / expectedHz);
  if (length < Math.floor(sampleRate * minimumWindowSeconds)) return null;
  const fftSize = Math.max(32768, nextPowerOfTwo(length * 8));
  const real = new Float64Array(fftSize), imag = new Float64Array(fftSize);
  let mean = 0;
  for (let i = 0; i < length; i++) mean += (left[start + i] + right[start + i]) * 0.5;
  mean /= length;
  for (let i = 0; i < length; i++) {
    const mono = (left[start + i] + right[start + i]) * 0.5 - mean;
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, length - 1));
    real[i] = mono * hann;
  }
  fft(real, imag);
  const bins = new Float64Array(fftSize / 2 + 1);
  let maximumPower = 0;
  for (let i = 0; i < bins.length; i++) {
    bins[i] = real[i] * real[i] + imag[i] * imag[i];
    if (bins[i] > maximumPower) maximumPower = bins[i];
  }
  return {bins, binHz: sampleRate / fftSize, maximumPower, start, end, fftSize, sampleRate, windowLength: length};
}

function modelFrequency(f0, partial, inharmonicity) {
  return f0 * partial * Math.sqrt(1 + inharmonicity * partial * partial);
}

function interpolatePower(spectrum, frequency) {
  const x = frequency / spectrum.binHz;
  const index = Math.floor(x);
  if (index < 0 || index + 1 >= spectrum.bins.length) return 0;
  const fraction = x - index;
  return spectrum.bins[index] * (1 - fraction) + spectrum.bins[index + 1] * fraction;
}

function peakFrequencyInRange(spectrum, lowHz, highHz) {
  const low = Math.max(1, Math.floor(lowHz / spectrum.binHz));
  const high = Math.min(spectrum.bins.length - 2, Math.ceil(highHz / spectrum.binHz));
  let bestBin = low, bestPower = 0;
  for (let i = low; i <= high; i++) {
    if (spectrum.bins[i] > bestPower) { bestPower = spectrum.bins[i]; bestBin = i; }
  }
  if (!(bestPower > 0)) return {frequency: 0, power: 0};
  const before = Math.log(Math.max(spectrum.bins[bestBin - 1], 1e-300));
  const center = Math.log(Math.max(bestPower, 1e-300));
  const after = Math.log(Math.max(spectrum.bins[bestBin + 1], 1e-300));
  const denominator = before - 2 * center + after;
  const fraction = Math.abs(denominator) > 1e-12
    ? Math.max(-0.5, Math.min(0.5, 0.5 * (before - after) / denominator)) : 0;
  const frequency = (bestBin + fraction) * spectrum.binHz;
  return {frequency, power: interpolatePower(spectrum, frequency)};
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function weightedMedian(values) {
  const sorted = [...values].filter(item => item.weight > 0 && Number.isFinite(item.value)).sort((a, b) => a.value - b.value);
  if (!sorted.length) return null;
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= totalWeight * 0.5) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

function medianSidebandPower(spectrum, frequency) {
  const center = Math.round(frequency / spectrum.binHz);
  const oversample = spectrum.fftSize / spectrum.windowLength;
  // Hann's main lobe spans about two unpadded bins. Sidebands begin beyond it.
  const firstOffset = Math.max(3, Math.ceil(2.5 * oversample));
  const lastOffset = Math.max(firstOffset + 4, Math.ceil(6.5 * oversample));
  const powers = [];
  for (let offset = firstOffset; offset <= lastOffset; offset++) {
    for (const index of [center - offset, center + offset]) {
      if (index > 0 && index < spectrum.bins.length - 1) powers.push(spectrum.bins[index]);
    }
  }
  return Math.max(median(powers) ?? 0, spectrum.maximumPower * 1e-24, 1e-300);
}

function lowerBound(peaks, frequency) {
  let low = 0, high = peaks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (peaks[middle].frequency < frequency) low = middle + 1;
    else high = middle;
  }
  return low;
}

function makePartialPeaks(spectrum, expectedHz) {
  const minF0 = expectedHz * 2 ** (-100 / 1200);
  const maxF0 = expectedHz * 2 ** (100 / 1200);
  const analysisLimitHz = spectrum.sampleRate * MAX_ANALYSIS_HZ_RATIO;
  const partials = [];
  for (let n = 1; n <= MAX_PARTIALS; n++) {
    const lowHz = modelFrequency(minF0, n, 0);
    const highHz = Math.min(analysisLimitHz, modelFrequency(maxF0, n, 0.02));
    if (lowHz >= analysisLimitHz) break;
    const low = Math.max(2, Math.floor(lowHz / spectrum.binHz));
    const high = Math.min(spectrum.bins.length - 2, Math.ceil(highHz / spectrum.binHz));
    const rawPeaks = [];
    let bandMaximum = 0;
    for (let i = low; i <= high; i++) bandMaximum = Math.max(bandMaximum, spectrum.bins[i]);
    for (let i = low + 1; i < high; i++) {
      if (spectrum.bins[i] < spectrum.bins[i - 1] || spectrum.bins[i] <= spectrum.bins[i + 1]) continue;
      const peak = peakFrequencyInRange(spectrum, (i - 0.6) * spectrum.binHz, (i + 0.6) * spectrum.binHz);
      if (peak.frequency > 0) rawPeaks.push({frequency: peak.frequency, power: peak.power, binHz: spectrum.binHz});
    }
    rawPeaks.sort((a, b) => a.frequency - b.frequency);
    const filteredPeaks = [];
    for (const peak of rawPeaks) {
      const sidebandPower = medianSidebandPower(spectrum, peak.frequency);
      const snrAmplitude = Math.sqrt(peak.power / sidebandPower);
      if (snrAmplitude < MIN_PEAK_SNR_AMPLITUDE) continue;
      // Sideband prominence is the local uniqueness measure. A competing peak
      // elsewhere in the wide B/f0 search band is not evidence against this peak.
      const uniquenessRatio = snrAmplitude;
      const amplitudeRatio = Math.sqrt(peak.power / Math.max(bandMaximum, 1e-300));
      const snrEvidence = snrAmplitude / (snrAmplitude + 1.5);
      const uniquenessEvidence = uniquenessRatio / (uniquenessRatio + 1);
      const strength = Math.max(0, Math.min(1, snrEvidence * uniquenessEvidence));
      filteredPeaks.push({
        ...peak, n, lowHz, highHz, sidebandPower, snrAmplitude, uniquenessRatio,
        amplitudeRatio, strength, usable: uniquenessRatio >= MIN_LOCAL_UNIQUENESS
      });
    }
    filteredPeaks.sort((a, b) => a.frequency - b.frequency);
    partials.push({n, lowHz, highHz, bandMaximum, peaks: filteredPeaks});
  }
  return partials;
}

function candidateMatch(partial, predictedHz, radiusCents = LOCAL_MATCH_RADIUS_CENTS) {
  const peaks = partial.peaks;
  if (!peaks.length) return null;
  const radius = Math.max(0.5, radiusCents);
  const lowHz = predictedHz * 2 ** (-radius / 1200);
  const highHz = predictedHz * 2 ** (radius / 1200);
  const index = lowerBound(peaks, lowHz);
  let best = null;
  for (let i = Math.max(0, index - 1); i < Math.min(peaks.length, index + 6); i++) {
    const peak = peaks[i];
    if (peak.frequency > highHz) break;
    const residualCents = 1200 * Math.log2(peak.frequency / predictedHz);
    const proximity = Math.exp(-0.5 * (residualCents / Math.max(8, radius / 2)) ** 2);
    const value = peak.strength * proximity;
    if (!best || value > best.value) best = {...peak, residualCents, value};
  }
  return best;
}

function candidateScore(partials, expectedHz, cents, inharmonicity) {
  const f0 = expectedHz * 2 ** (cents / 1200);
  let weighted = 0, totalWeight = 0, matchedWeight = 0;
  const matches = [];
  for (const partial of partials) {
    const weight = 1 / partial.n;
    totalWeight += weight;
    const predicted = modelFrequency(f0, partial.n, inharmonicity);
    if (predicted >= partial.highHz || predicted <= partial.lowHz) continue;
    const match = candidateMatch(partial, predicted);
    if (!match) continue;
    weighted += weight * match.value;
    matchedWeight += weight;
    matches.push({...match, partial: partial.n, predictedFrequencyHz: predicted, weight});
  }
  const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  const meanEvidence = matchedWeight > 0 ? weighted / matchedWeight : 0;
  return {score: coverage * meanEvidence, coverage, meanEvidence, matches};
}

function values(start, end, step) {
  const result = [];
  for (let value = start; value <= end + step * 1e-7; value += step) result.push(Number(value.toFixed(8)));
  if (result.length && result[result.length - 1] < end - step * 1e-7) result.push(end);
  return result;
}

function gridSearch(partials, expectedHz, centsValues, bValues, records) {
  let best = null;
  for (const cents of centsValues) {
    for (const inharmonicity of bValues) {
      const measurement = candidateScore(partials, expectedHz, cents, inharmonicity);
      const candidate = {cents, inharmonicity, ...measurement};
      records.push(candidate);
      if (!best || candidate.score > best.score) best = candidate;
    }
  }
  return best;
}

function weightedHuber(valuesWithWeights, delta = 3) {
  const total = valuesWithWeights.reduce((sum, item) => sum + item.weight, 0);
  if (!(total > 0)) return Infinity;
  return valuesWithWeights.reduce((sum, item) => {
    const value = Math.abs(item.value);
    const loss = value <= delta ? 0.5 * value * value : delta * (value - 0.5 * delta);
    return sum + item.weight * loss;
  }, 0) / total;
}

function fitAtInharmonicity(matches, expectedHz, inharmonicity) {
  const adjusted = matches.map(item => ({
    value: item.frequency / (item.partial * Math.sqrt(1 + inharmonicity * item.partial * item.partial)),
    weight: Math.max(0.02, item.strength) / item.partial,
    item
  }));
  const f0 = weightedMedian(adjusted);
  if (!(f0 > 0)) return null;
  const cents = 1200 * Math.log2(f0 / expectedHz);
  if (cents < -100 || cents > 100) return null;
  const residuals = adjusted.map(value => ({
    value: 1200 * Math.log2(value.value / f0),
    weight: value.weight
  }));
  return {f0, cents, inharmonicity, residuals, loss: weightedHuber(residuals)};
}

function robustFit(matches, expectedHz, initialB) {
  if (!matches.length) return null;
  let best = null;
  for (const B of values(0, 0.02, 0.00002)) {
    const fit = fitAtInharmonicity(matches, expectedHz, B);
    if (fit && (!best || fit.loss < best.loss || (fit.loss === best.loss && Math.abs(B - initialB) < Math.abs(best.inharmonicity - initialB)))) best = fit;
  }
  if (!best) return null;
  const refinementStart = Math.max(0, best.inharmonicity - 0.000025);
  const refinementEnd = Math.min(0.02, best.inharmonicity + 0.000025);
  for (const B of values(refinementStart, refinementEnd, 0.000001)) {
    const fit = fitAtInharmonicity(matches, expectedHz, B);
    if (fit && fit.loss < best.loss) best = fit;
  }

  let retained = matches;
  let fit = best;
  const residuals = matches.map(item => ({item, residual: Math.abs(1200 * Math.log2(
    item.frequency / modelFrequency(best.f0, item.partial, best.inharmonicity)
  ))}));
  const inliers = residuals.filter(item => item.residual <= MAX_PARTIAL_FIT_RESIDUAL_CENTS).map(item => item.item);
  if (inliers.length >= 2 && inliers.length < matches.length) {
    retained = inliers;
    let refined = null;
    for (const B of values(Math.max(0, best.inharmonicity - 0.0002), Math.min(0.02, best.inharmonicity + 0.0002), 0.000005)) {
      const candidate = fitAtInharmonicity(retained, expectedHz, B);
      if (candidate && (!refined || candidate.loss < refined.loss)) refined = candidate;
    }
    if (refined) fit = refined;
  }
  const finalResiduals = retained.map(item => ({
    item,
    residual: 1200 * Math.log2(item.frequency / modelFrequency(fit.f0, item.partial, fit.inharmonicity)),
    weight: Math.max(0.02, item.strength) / item.partial
  }));
  const residualMedian = weightedMedian(finalResiduals.map(item => ({value: Math.abs(item.residual), weight: item.weight}))) ?? 0;
  const partialF0s = retained.map(item => ({
    partial: item.partial,
    f0: item.frequency / (item.partial * Math.sqrt(1 + fit.inharmonicity * item.partial * item.partial)),
    frequency: item.frequency,
    residualCents: 1200 * Math.log2(item.frequency / modelFrequency(fit.f0, item.partial, fit.inharmonicity)),
    weight: Math.max(0.02, item.strength) / item.partial,
    snrAmplitude: item.snrAmplitude,
    uniquenessRatio: item.uniquenessRatio,
    amplitudeRatio: item.amplitudeRatio,
    usable: item.usable
  }));
  const weightedCenter = weightedMedian(partialF0s.map(item => ({value: item.f0, weight: item.weight})));
  const spread = Math.sqrt(partialF0s.reduce((sum, item) => sum + item.weight *
    (1200 * Math.log2(item.f0 / weightedCenter)) ** 2, 0) /
    Math.max(1e-30, partialF0s.reduce((sum, item) => sum + item.weight, 0)));
  const minFrequency = fit.f0;
  const binHz = matches[0]?.binHz ?? 0.5;
  const binUncertaintyCents = 1200 * Math.log2(1 + (binHz / Math.sqrt(12)) / minFrequency);
  const uncertainty = Math.max(binUncertaintyCents, residualMedian * 1.4826 / Math.sqrt(Math.max(1, retained.length)));
  return {fit, matches: retained, rejectedPartials: matches.filter(item => !retained.includes(item)).map(item => item.partial),
    partialF0s, spread, residual: Math.sqrt(finalResiduals.reduce((sum, item) => sum + item.weight * item.residual ** 2, 0) /
      Math.max(1e-30, finalResiduals.reduce((sum, item) => sum + item.weight, 0))), uncertainty};
}

function describePartial(partial, used) {
  return {
    partial: partial.n,
    candidate_count: partial.peaks.length,
    used: Boolean(used),
    peak_frequency_hz: used?.frequency ?? null,
    peak_snr_amplitude: used?.snrAmplitude ?? null,
    local_uniqueness_ratio: used?.uniquenessRatio ?? null,
    amplitude_ratio: used?.amplitudeRatio ?? null,
    inferred_f0_hz: used?.f0 ?? null,
    residual_cents: used?.residualCents ?? null,
    usable: Boolean(used?.usable)
  };
}

function estimateSingleWindow(left, right, sampleRate, targetHz, onset, startMs, endMs) {
  const spectrum = makeSpectrum(left, right, sampleRate, onset, startMs, endMs, targetHz);
  const invalid = (reason, details = {}) => ({
    estimated_f0: null, pitch_error_cents: null, fitted_B: null,
    usable_partial_count: details.usedPartials?.length ?? 0,
    usable_partials: details.usedPartials?.map(item => item.partial) ?? [],
    partial_f0_spread_cents: details.spread ?? null,
    partial_fit_residual_cents: details.residual ?? null,
    estimated_uncertainty_cents: details.uncertainty ?? null,
    best_score: details.best?.score ?? 0,
    competing_score: details.competingScore ?? 0,
    confidence_ratio: details.confidenceRatio ?? 1,
    confidence_components: details.confidenceComponents ?? null,
    inferred_f0_by_partial: details.usedPartials ?? [],
    rejected_partials: details.rejectedPartials ?? [],
    partial_candidates: details.partials?.map(partial => describePartial(partial, details.usedPartials?.find(item => item.partial === partial.n))) ?? [],
    search_boundary_hit: details.searchBoundaryHit ?? false,
    measurement_valid: false, result: 'MEASUREMENT_INVALID', reason,
    analysis_start_index: spectrum?.start ?? null, analysis_end_index: spectrum?.end ?? null
  });
  if (!spectrum) return invalid('insufficient-analysis-window');
  const partials = makePartialPeaks(spectrum, targetHz);
  const candidatePartials = partials.filter(partial => partial.peaks.length > 0);
  if (!candidatePartials.length) return invalid('no-trustworthy-local-partial-peaks', {partials});

  const records = [];
  let best = gridSearch(partials, targetHz, values(-100, 100, 4), values(0, 0.02, 0.0002), records);
  for (const stage of [
    {centsRadius: 4, centsStep: 0.25, bRadius: 0.0004, bStep: 0.00002},
    {centsRadius: 0.25, centsStep: 0.05, bRadius: 0.00004, bStep: 0.000002}
  ]) {
    const next = gridSearch(partials, targetHz,
      values(Math.max(-100, best.cents - stage.centsRadius), Math.min(100, best.cents + stage.centsRadius), stage.centsStep),
      values(Math.max(0, best.inharmonicity - stage.bRadius), Math.min(0.02, best.inharmonicity + stage.bRadius), stage.bStep), records);
    if (next.score >= best.score) best = next;
  }
  let competingScore = 0;
  for (const candidate of records) {
    if (Math.abs(candidate.cents - best.cents) >= 20) competingScore = Math.max(competingScore, candidate.score);
  }
  const confidenceRatio = Math.min(1e6, best.score / Math.max(competingScore, 1e-12));
  const searchBoundaryHit = Math.abs(best.cents) >= 99.95;
  const matched = candidateScore(partials, targetHz, best.cents, best.inharmonicity).matches;
  const robust = robustFit(matched, targetHz, best.inharmonicity);
  if (!robust) return invalid(searchBoundaryHit ? 'pitch-search-boundary' : 'robust-partial-fit-failed', {best, competingScore, confidenceRatio, partials, searchBoundaryHit});
  const fittedCents = robust.fit.cents;
  const used = robust.partialF0s;
  const uniqueCount = used.filter(item => item.usable && item.uniquenessRatio >= MIN_LOCAL_UNIQUENESS).length;
  const minUsedUniqueness = used.length ? Math.min(...used.map(item => item.uniquenessRatio)) : 0;
  const minSnr = used.length ? Math.min(...used.map(item => item.snrAmplitude)) : 0;
  const confidenceComponents = {
    partial_consistency: Math.exp(-robust.spread / MAX_PARTIAL_F0_SPREAD_CENTS),
    fit_residual: Math.exp(-robust.residual / MAX_PARTIAL_FIT_RESIDUAL_CENTS),
    uncertainty: Math.exp(-robust.uncertainty / MAX_MEASUREMENT_UNCERTAINTY_CENTS),
    local_uniqueness: Math.min(1, minUsedUniqueness / 2),
    minimum_snr_amplitude: minSnr
  };
  const requiredCount = targetHz < 1000 ? 2 : targetHz <= 3000 ? 2 : 1;
  const highFundamental = targetHz > 3000 ? used.find(item => item.partial === 1) : true;
  let reason = searchBoundaryHit ? 'pitch-search-boundary'
    : uniqueCount < requiredCount ? 'insufficient-coherent-partials'
      : targetHz < 1000 && uniqueCount < 2 ? 'insufficient-low-order-partials'
        : targetHz > 3000 && !highFundamental ? 'expected-f0-local-mode-not-supported'
          : robust.spread > MAX_PARTIAL_F0_SPREAD_CENTS ? 'partial-f0-disagreement'
            : robust.residual > MAX_PARTIAL_FIT_RESIDUAL_CENTS ? 'inharmonic-partial-fit-residual'
              : robust.uncertainty > MAX_MEASUREMENT_UNCERTAINTY_CENTS ? 'pitch-uncertainty-too-high'
                : null;
  const measurementValid = reason === null;
  return {
    estimated_f0: measurementValid ? robust.fit.f0 : null,
    pitch_error_cents: measurementValid ? fittedCents : null,
    candidate_estimated_f0: robust.fit.f0,
    candidate_pitch_error_cents: fittedCents,
    candidate_fitted_B: robust.fit.inharmonicity,
    fitted_B: measurementValid ? robust.fit.inharmonicity : null,
    usable_partial_count: used.length,
    usable_partials: used.map(item => item.partial),
    partial_f0_spread_cents: robust.spread,
    partial_fit_residual_cents: robust.residual,
    estimated_uncertainty_cents: robust.uncertainty,
    best_score: best.score,
    competing_score: competingScore,
    confidence_ratio: confidenceRatio,
    confidence_components: confidenceComponents,
    inferred_f0_by_partial: used,
    rejected_partials: robust.rejectedPartials,
    partial_candidates: partials.map(partial => describePartial(partial, used.find(item => item.partial === partial.n))),
    search_boundary_hit: searchBoundaryHit,
    measurement_valid: measurementValid,
    result: !measurementValid ? 'MEASUREMENT_INVALID' : Math.abs(fittedCents) <= 15 ? 'PASS' : 'FAIL',
    reason,
    analysis_start_index: spectrum.start,
    analysis_end_index: spectrum.end
  };
}

function defaultAnalysisWindows(targetHz, startMs) {
  const base = startMs - DEFAULT_WINDOW_MS[0];
  const windows = targetHz < 100 ? [[20, 420], [480, 880]]
    : targetHz < 250 ? [[20, 320], [360, 660]]
    : targetHz < 1000 ? [[20, 240], [270, 490]]
      : targetHz <= 3000 ? [[180, 340], [420, 580]]
        : targetHz > 3000 ? [[80, 240], [300, 460]]
          : [[20, 160], [180, 320]];
  return windows.map(([start, end]) => [start + base, end + base]);
}

function getPianoPitchAnalysisPlan(expectedMidiPitch, {
  sampleRate = 48000,
  blockSize = 2048,
  minimumDurationMs = 1600,
  startMs = DEFAULT_WINDOW_MS[0]
} = {}) {
  const targetHz = midiToHz(expectedMidiPitch);
  if (!(sampleRate > 0) || !Number.isInteger(blockSize) || blockSize <= 0
    || !(minimumDurationMs > 0) || !(targetHz > 0)) {
    throw new RangeError('expected MIDI pitch, sample rate, block size, and minimum duration must be valid');
  }
  const windows = defaultAnalysisWindows(targetHz, startMs);
  const maximumWindowEndMs = Math.max(...windows.map(window => window[1]));
  const alignmentMarginFrames = blockSize;
  const requiredWindowFrames = Math.ceil(maximumWindowEndMs * sampleRate / 1000);
  const minimumFrames = Math.ceil(minimumDurationMs * sampleRate / 1000);
  const requiredFrames = Math.ceil(Math.max(
    minimumFrames,
    requiredWindowFrames + alignmentMarginFrames
  ) / blockSize) * blockSize;
  return {
    expectedMidiPitch,
    expectedF0: targetHz,
    sampleRate,
    blockSize,
    windows,
    maximumWindowEndMs,
    alignmentMarginFrames,
    requiredFrames,
    requiredDurationMs: requiredFrames * 1000 / sampleRate
  };
}

function estimatePianoPitch(left, right, {
  sampleRate = 48000,
  expectedMidiPitch,
  expectedF0,
  onsetIndex = null,
  startMs = DEFAULT_WINDOW_MS[0],
  endMs = DEFAULT_WINDOW_MS[1],
  analysisWindows = null,
  autocorrelationEndMs = 350
} = {}) {
  if (!(left instanceof Float32Array || left instanceof Float64Array)
    || !(right instanceof Float32Array || right instanceof Float64Array)
    || left.length !== right.length) {
    throw new TypeError('left and right must be equal-length Float32Array or Float64Array buffers');
  }
  const targetHz = Number.isFinite(expectedF0) ? expectedF0 : midiToHz(expectedMidiPitch);
  if (!(sampleRate > 0) || !(targetHz > 0) || !(endMs > startMs)) throw new RangeError('sampleRate, expected MIDI pitch or f0, and analysis window must be valid');
  const onset = Number.isInteger(onsetIndex) ? Math.max(0, Math.min(left.length, onsetIndex)) : detectOnset(left, right, sampleRate);
  const windows = analysisWindows || defaultAnalysisWindows(targetHz, startMs);
  if (!Array.isArray(windows) || windows.length < 2 || windows.some(window => !Array.isArray(window) || window.length !== 2 || !(window[1] > window[0]))) {
    throw new RangeError('analysisWindows must contain at least two increasing [startMs, endMs] windows');
  }
  const windowResults = windows.map(([windowStart, windowEnd]) => ({
    start_ms: windowStart, end_ms: windowEnd,
    ...estimateSingleWindow(left, right, sampleRate, targetHz, onset, windowStart, windowEnd)
  }));
  const auto = estimateExpectedPitch(left, right, targetHz, sampleRate, {
    onset, startMs, endMs: Math.max(autocorrelationEndMs, ...windows.map(window => window[1]))
  });
  const autocorrelationCents = auto?.cents ?? null;
  const validWindows = windowResults.filter(window => window.measurement_valid && Number.isFinite(window.pitch_error_cents));
  const invalid = (reason, details = {}) => ({
    estimated_f0: null, pitch_error_cents: null, fitted_B: null,
    usable_partial_count: details.usablePartialCount ?? 0,
    usable_partials: details.usablePartials ?? [],
    partial_peak_frequencies_hz: [],
    best_score: details.bestScore ?? 0,
    competing_score: details.competingScore ?? 0,
    confidence_ratio: details.confidenceRatio ?? 1,
    confidence_components: details.confidenceComponents ?? null,
    partial_f0_spread_cents: details.partialF0SpreadCents ?? null,
    partial_fit_residual_cents: details.partialFitResidualCents ?? null,
    estimated_uncertainty_cents: details.uncertaintyCents ?? null,
    window_pitch_spread_cents: details.windowPitchSpreadCents ?? null,
    autocorrelation_pitch_cents: autocorrelationCents,
    estimator_disagreement_cents: null,
    search_boundary_hit: windowResults.some(window => window.search_boundary_hit),
    window_results: windowResults,
    measurement_valid: false,
    result: 'MEASUREMENT_INVALID', reason, onset_index: onset
  });

  if (windowResults.some(window => window.search_boundary_hit)) return invalid('pitch-search-boundary');
  if (validWindows.length !== windowResults.length) return invalid('insufficient-valid-analysis-windows');
  const pitchValues = validWindows.map(window => window.pitch_error_cents);
  const windowPitchSpreadCents = Math.max(...pitchValues) - Math.min(...pitchValues);
  const unstablePitchTrajectory = windowPitchSpreadCents > MAX_WINDOW_PITCH_SPREAD_CENTS;
  const worstPitchWindow = validWindows.reduce((worst, window) =>
    Math.abs(window.pitch_error_cents) > Math.abs(worst.pitch_error_cents) ? window : worst);
  // When individually valid windows disagree, preserve the worst absolute
  // window error as a physical pitch failure instead of hiding it in a median
  // or relabeling the measured pitch movement as invalid instrumentation.
  const pitchCents = unstablePitchTrajectory ? worstPitchWindow.pitch_error_cents : median(pitchValues);
  const fittedB = median(validWindows.map(window => window.fitted_B));
  const confidenceRatio = Math.min(1e6, validWindows.reduce((product, window) => product * Math.max(window.confidence_ratio, 1e-12), 1));
  const partialF0SpreadCents = Math.max(...validWindows.map(window => window.partial_f0_spread_cents ?? 0));
  const partialFitResidualCents = Math.max(...validWindows.map(window => window.partial_fit_residual_cents ?? 0));
  const uncertaintyCents = Math.max(...validWindows.map(window => window.estimated_uncertainty_cents ?? 0));
  if (partialF0SpreadCents > MAX_PARTIAL_F0_SPREAD_CENTS) return invalid('partial-f0-disagreement', {windowPitchSpreadCents, confidenceRatio, partialF0SpreadCents, partialFitResidualCents, uncertaintyCents});
  if (partialFitResidualCents > MAX_PARTIAL_FIT_RESIDUAL_CENTS) return invalid('inharmonic-partial-fit-residual', {windowPitchSpreadCents, confidenceRatio, partialF0SpreadCents, partialFitResidualCents, uncertaintyCents});
  if (uncertaintyCents > MAX_MEASUREMENT_UNCERTAINTY_CENTS) return invalid('pitch-uncertainty-too-high', {windowPitchSpreadCents, confidenceRatio, partialF0SpreadCents, partialFitResidualCents, uncertaintyCents});

  const commonPartials = validWindows[0].usable_partials.filter(partial => validWindows.every(window => window.usable_partials.includes(partial)));
  const requiredCrossWindowPartials = targetHz < 1000 ? 2 : targetHz <= 3000 ? 2 : 1;
  if (!unstablePitchTrajectory && (commonPartials.length < requiredCrossWindowPartials || (targetHz > 3000 && !commonPartials.includes(1)))) {
    return invalid('insufficient-cross-window-partial-agreement', {usablePartialCount: commonPartials.length,
      usablePartials: commonPartials, windowPitchSpreadCents, confidenceRatio, partialF0SpreadCents, partialFitResidualCents, uncertaintyCents});
  }
  const usedCommon = commonPartials.map(partial => {
    const measurements = validWindows.map(window => window.inferred_f0_by_partial.find(item => item.partial === partial));
    return {
      partial,
      frequency_hz: median(measurements.map(item => item.frequency)),
      inferred_f0_hz: median(measurements.map(item => item.f0)),
      amplitude_ratio: median(measurements.map(item => item.amplitudeRatio)),
      local_uniqueness_ratio: median(measurements.map(item => item.uniquenessRatio))
    };
  });
  const confidenceComponents = {
    partial_consistency: Math.exp(-partialF0SpreadCents / MAX_PARTIAL_F0_SPREAD_CENTS),
    fit_residual: Math.exp(-partialFitResidualCents / MAX_PARTIAL_FIT_RESIDUAL_CENTS),
    uncertainty: Math.exp(-uncertaintyCents / MAX_MEASUREMENT_UNCERTAINTY_CENTS),
    independent_window_agreement: Math.exp(-windowPitchSpreadCents / MAX_WINDOW_PITCH_SPREAD_CENTS),
    local_peak_uniqueness: Math.min(...validWindows.map(window => window.confidence_components?.local_uniqueness ?? 0))
  };
  return {
    estimated_f0: targetHz * 2 ** (pitchCents / 1200),
    pitch_error_cents: pitchCents,
    fitted_B: fittedB,
    usable_partial_count: Math.min(...validWindows.map(window => window.usable_partial_count)),
    usable_partials: commonPartials,
    partial_peak_frequencies_hz: usedCommon,
    best_score: validWindows.reduce((sum, window) => sum + window.best_score, 0) / validWindows.length,
    competing_score: validWindows.reduce((sum, window) => sum + window.competing_score, 0) / validWindows.length,
    confidence_ratio: confidenceRatio,
    confidence_components: confidenceComponents,
    partial_f0_spread_cents: partialF0SpreadCents,
    partial_fit_residual_cents: partialFitResidualCents,
    estimated_uncertainty_cents: uncertaintyCents,
    window_pitch_spread_cents: windowPitchSpreadCents,
    window_pitch_errors_cents: validWindows.map(window => window.pitch_error_cents),
    worst_window_pitch_error_cents: worstPitchWindow.pitch_error_cents,
    shared_usable_partial_count: commonPartials.length,
    shared_usable_partials: commonPartials,
    autocorrelation_pitch_cents: autocorrelationCents,
    estimator_disagreement_cents: autocorrelationCents === null ? null : Math.abs(pitchCents - autocorrelationCents),
    search_boundary_hit: false,
    measurement_valid: true,
    window_results: windowResults,
    measurement_basis: unstablePitchTrajectory ? 'individually-valid-window-pitch-trajectory' : 'stable-cross-window-harmonic-comb',
    result: !unstablePitchTrajectory && Math.abs(pitchCents) <= 15 ? 'PASS' : 'FAIL',
    reason: unstablePitchTrajectory ? 'analysis-window-pitch-instability' : null,
    onset_index: onset
  };
}

module.exports = {
  MIN_CONFIDENCE_RATIO,
  MAX_WINDOW_PITCH_SPREAD_CENTS,
  MAX_PARTIAL_F0_SPREAD_CENTS,
  MAX_PARTIAL_FIT_RESIDUAL_CENTS,
  estimatePianoPitch,
  midiToHz,
  defaultAnalysisWindows,
  getPianoPitchAnalysisPlan
};
