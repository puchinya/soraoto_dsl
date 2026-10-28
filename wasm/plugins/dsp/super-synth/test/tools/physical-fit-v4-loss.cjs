'use strict';

const analyzer = require('./analyze-issue7-physical-identification.cjs');

const LOSS_VERSION = 'physical-feature-loss-v2';
const SAMPLE_RATE = 48000;
const SAMPLE_COUNT = 24000;
const WINDOWS_MS = Object.freeze([[0, 10], [10, 30], [30, 80], [80, 200], [200, 500]]);
const FFT_SIZES = Object.freeze([1024, 2048, 4096]);
const FAMILY_WEIGHTS = Object.freeze({f0: 0.15, rms: 0.4, spectral: 0.45});

function decodeFloat32StereoWav(wav) {
  if (!Buffer.isBuffer(wav) || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('BLOCKED_PHYSICAL_V4_WAV_HEADER');
  let offset = 12, format = null, dataOffset = -1, dataSize = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), body = offset + 8;
    if (body + size > wav.length) throw new Error(`BLOCKED_PHYSICAL_V4_WAV_TRUNCATED: ${id}`);
    if (id === 'fmt ') format = {encoding: wav.readUInt16LE(body), channels: wav.readUInt16LE(body + 2), sampleRate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14)};
    if (id === 'data') { dataOffset = body; dataSize = size; }
    offset = body + size + (size & 1);
  }
  if (!format || dataOffset < 0 || format.encoding !== 3 || format.channels !== 2 || format.sampleRate !== SAMPLE_RATE || format.bits !== 32 || dataSize % 8 !== 0) throw new Error(`BLOCKED_PHYSICAL_V4_WAV_FORMAT: ${JSON.stringify(format)}`);
  const frames = dataSize / 8, left = new Float32Array(frames), right = new Float32Array(frames);
  for (let i = 0, p = dataOffset; i < frames; i++, p += 8) {
    left[i] = wav.readFloatLE(p); right[i] = wav.readFloatLE(p + 4);
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('BLOCKED_PHYSICAL_V4_NONFINITE_WAV');
  }
  if (frames < SAMPLE_COUNT) throw new Error('BLOCKED_PHYSICAL_V4_SHORT_WAV');
  return {sampleRate: SAMPLE_RATE, left: left.subarray(0, SAMPLE_COUNT), right: right.subarray(0, SAMPLE_COUNT)};
}
function validateAudio(audio) {
  if (!audio || audio.sampleRate !== SAMPLE_RATE || !(audio.left instanceof Float32Array || audio.left instanceof Float64Array)
      || !(audio.right instanceof Float32Array || audio.right instanceof Float64Array) || audio.left.length < SAMPLE_COUNT || audio.right.length < SAMPLE_COUNT) throw new Error('BLOCKED_PHYSICAL_V4_AUDIO_SHAPE');
  for (let i = 0; i < SAMPLE_COUNT; i++) if (!Number.isFinite(audio.left[i]) || !Number.isFinite(audio.right[i])) throw new Error('BLOCKED_PHYSICAL_V4_NONFINITE_AUDIO');
  return audio;
}
function monoOf(audio) {
  validateAudio(audio);
  const mono = new Float64Array(SAMPLE_COUNT);
  for (let i = 0; i < SAMPLE_COUNT; i++) mono[i] = (audio.left[i] + audio.right[i]) * 0.5;
  return mono;
}
function features(audio, pitch) {
  const valid = validateAudio(audio);
  return analyzer.analyze(valid.left.subarray(0, SAMPLE_COUNT), valid.right.subarray(0, SAMPLE_COUNT), pitch, SAMPLE_RATE);
}
function frameMagnitude(mono, start, size) {
  if (start < 0 || start + size > mono.length) throw new Error('BLOCKED_PHYSICAL_V4_STFT_WINDOW');
  const real = new Float64Array(size), imag = new Float64Array(size);
  let mean = 0;
  for (let i = 0; i < size; i++) mean += mono[start + i];
  mean /= size;
  let windowSum = 0;
  for (let i = 0; i < size; i++) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
    real[i] = (mono[start + i] - mean) * hann;
    windowSum += hann;
  }
  analyzer.fft(real, imag);
  const bins = new Float64Array(size / 2 + 1);
  for (let bin = 0; bin < bins.length; bin++) bins[bin] = Math.hypot(real[bin], imag[bin]) / Math.max(windowSum, 1e-12);
  return bins;
}
function frameSpectra(audio, size) {
  const mono = monoOf(audio), hop = size / 4, count = Math.floor((SAMPLE_COUNT - size) / hop) + 1;
  if (count < 1 || !Number.isInteger(hop)) throw new Error(`BLOCKED_PHYSICAL_V4_STFT_SIZE: ${size}`);
  const frames = [];
  for (let frame = 0; frame < count; frame++) frames.push(frameMagnitude(mono, frame * hop, size));
  return frames;
}
function db(value) { return 20 * Math.log10(Math.max(value, 1e-12)); }
function mean(values, label) {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error(`BLOCKED_PHYSICAL_V4_EMPTY_OR_NONFINITE_FEATURE: ${label}`);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function sharedGainDb(referenceMetrics, baselineMetrics) {
  const gain = analyzer.gainOffsetDb(referenceMetrics, baselineMetrics);
  if (!Number.isFinite(gain)) throw new Error('BLOCKED_PHYSICAL_V4_SHARED_GAIN');
  return gain;
}
function cellLoss(referenceAudio, modelAudio, pitch, gainDb) {
  if (!Number.isFinite(gainDb)) throw new Error('BLOCKED_PHYSICAL_V4_SHARED_GAIN');
  const reference = features(referenceAudio, pitch), model = features(modelAudio, pitch);
  const f0 = ((model.pitchErrorCents - reference.pitchErrorCents) / 10) ** 2;
  const rmsTerms = model.envelopeDbfs.map((value, index) => ((value + gainDb - reference.envelopeDbfs[index]) / 6) ** 2);
  if (rmsTerms.length !== WINDOWS_MS.length) throw new Error('BLOCKED_PHYSICAL_V4_RMS_WINDOW_COUNT');
  const spectral = {};
  for (const size of FFT_SIZES) {
    const refFrames = frameSpectra(referenceAudio, size), modelFrames = frameSpectra(modelAudio, size);
    if (refFrames.length !== modelFrames.length || refFrames.length === 0) throw new Error(`BLOCKED_PHYSICAL_V4_STFT_FRAME_COUNT: ${size}`);
    const terms = [], maxBin = Math.min(refFrames[0].length - 1, Math.floor(20000 * size / SAMPLE_RATE));
    for (let frame = 0; frame < refFrames.length; frame++) {
      const ref = refFrames[frame], actual = modelFrames[frame];
      let refMaximum = 0;
      for (let bin = 1; bin <= maxBin; bin++) refMaximum = Math.max(refMaximum, ref[bin]);
      if (!(refMaximum > 0) || !Number.isFinite(refMaximum)) throw new Error(`BLOCKED_PHYSICAL_V4_SILENT_REFERENCE_FRAME: ${size}:${frame}`);
      const floorDb = db(refMaximum) - 60;
      let active = 0;
      for (let bin = 1; bin <= maxBin; bin++) {
        if (db(ref[bin]) < floorDb) continue;
        const difference = db(actual[bin]) + gainDb - db(ref[bin]);
        if (!Number.isFinite(difference)) throw new Error(`BLOCKED_PHYSICAL_V4_NONFINITE_STFT: ${size}:${frame}:${bin}`);
        const clipped = Math.max(-10, Math.min(10, difference / 6));
        terms.push(clipped * clipped); active++;
      }
      if (!active) throw new Error(`BLOCKED_PHYSICAL_V4_EMPTY_ACTIVE_MASK: ${size}:${frame}`);
    }
    spectral[size] = {loss: mean(terms, `stft-${size}`), frameCount: refFrames.length, activeFeatureCount: terms.length};
  }
  const f0Loss = f0, rmsLoss = mean(rmsTerms, 'rms');
  const spectralLoss = mean(FFT_SIZES.map(size => spectral[size].loss), 'spectral-resolution-mean');
  const total = FAMILY_WEIGHTS.f0 * f0Loss + FAMILY_WEIGHTS.rms * rmsLoss + FAMILY_WEIGHTS.spectral * spectralLoss;
  if (!Number.isFinite(total)) throw new Error('BLOCKED_PHYSICAL_V4_NONFINITE_LOSS');
  return {lossVersion: LOSS_VERSION, total, contributions: {f0: f0Loss, rms: rmsLoss, spectral: spectralLoss},
    weightedContributions: {f0: FAMILY_WEIGHTS.f0 * f0Loss, rms: FAMILY_WEIGHTS.rms * rmsLoss, spectral: FAMILY_WEIGHTS.spectral * spectralLoss},
    featureCounts: {f0: 1, rms: rmsTerms.length, spectral: Object.fromEntries(FFT_SIZES.map(size => [size, spectral[size].activeFeatureCount]))},
    spectral};
}
function candidateLoss(pairs, gainDb) {
  if (!Array.isArray(pairs) || pairs.length !== 7) throw new Error('BLOCKED_PHYSICAL_V4_LOSS_CELL_COUNT');
  const cells = pairs.map(pair => cellLoss(pair.reference, pair.model, pair.pitch, gainDb));
  const byFamily = Object.fromEntries(['f0', 'rms', 'spectral'].map(name => [name, mean(cells.map(cell => cell.contributions[name]), name)]));
  const spectralBySize = Object.fromEntries(FFT_SIZES.map(size => [size, mean(cells.map(cell => cell.spectral[size].loss), `stft-${size}`)]));
  const total = FAMILY_WEIGHTS.f0 * byFamily.f0 + FAMILY_WEIGHTS.rms * byFamily.rms + FAMILY_WEIGHTS.spectral * mean(FFT_SIZES.map(size => spectralBySize[size]), 'spectral-resolution-mean');
  const counts = {cells: cells.length, f0: cells.length, rms: cells.reduce((sum, cell) => sum + cell.featureCounts.rms, 0),
    spectral: Object.fromEntries(FFT_SIZES.map(size => [size, cells.reduce((sum, cell) => sum + cell.featureCounts.spectral[size], 0)]))};
  return {lossVersion: LOSS_VERSION, total, contributions: byFamily, weightedContributions: {f0: FAMILY_WEIGHTS.f0 * byFamily.f0,
    rms: FAMILY_WEIGHTS.rms * byFamily.rms, spectral: FAMILY_WEIGHTS.spectral * mean(FFT_SIZES.map(size => spectralBySize[size]), 'spectral-resolution-mean')},
    spectralBySize, featureCounts: counts, cells};
}

module.exports = {LOSS_VERSION, SAMPLE_RATE, SAMPLE_COUNT, WINDOWS_MS, FFT_SIZES, FAMILY_WEIGHTS,
  decodeFloat32StereoWav, validateAudio, monoOf, features, frameMagnitude, frameSpectra, sharedGainDb, cellLoss, candidateLoss};
