'use strict';

const FFT_SIZE = 16384;
const WINDOWS_MS = [[0, 10], [10, 30], [30, 80], [80, 200], [200, 350]];

function db(value) {
  return 20 * Math.log10(Math.max(value, 1e-12));
}

function onsetIndex(left, right, sampleRate) {
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

function rmsWindow(left, right, start, end, onset) {
  const lo = Math.max(0, onset + start);
  const hi = Math.min(left.length, right.length, onset + end);
  if (hi <= lo) return -240;
  let energy = 0;
  for (let i = lo; i < hi; i++) energy += left[i] * left[i] + right[i] * right[i];
  return db(Math.sqrt(energy / (2 * (hi - lo))));
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
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let base = 0; base < n; base += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const even = base + j, odd = even + len / 2;
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

function spectrum(left, right, sampleRate, onset, startMs = 20, size = FFT_SIZE) {
  const real = new Float64Array(size), imag = new Float64Array(size);
  const start = onset + Math.floor(sampleRate * startMs / 1000);
  const available = Math.min(size, left.length - start, right.length - start);
  if (available < Math.floor(size * 0.75)) return null;
  let mean = 0;
  for (let i = 0; i < available; i++) mean += (left[start + i] + right[start + i]) * 0.5;
  mean /= available;
  for (let i = 0; i < available; i++) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, available - 1));
    real[i] = ((left[start + i] + right[start + i]) * 0.5 - mean) * hann;
  }
  fft(real, imag);
  const count = size / 2 + 1;
  const magnitude = new Float64Array(count);
  for (let i = 0; i < count; i++) magnitude[i] = Math.hypot(real[i], imag[i]);
  return {magnitude, binHz: sampleRate / size};
}

function peakNear(magnitude, binHz, hz) {
  const center = Math.max(1, Math.round(hz / binHz));
  const radius = Math.max(2, Math.ceil(center * 0.025));
  let best = Math.max(1, center - radius);
  for (let i = best + 1; i <= Math.min(magnitude.length - 2, center + radius); i++) {
    if (magnitude[i] > magnitude[best]) best = i;
  }
  const a = magnitude[best - 1], b = magnitude[best], c = magnitude[best + 1];
  const denom = a - 2 * b + c;
  const fraction = Math.abs(denom) > 1e-20 ? 0.5 * (a - c) / denom : 0;
  return {hz: (best + Math.max(-0.5, Math.min(0.5, fraction))) * binHz, amplitude: b};
}

function spectralBandPowerRatios(magnitude, binHz) {
  const bands = 64, lo = 40, hi = 16000, ratio = hi / lo;
  let total = 0;
  for (let i = 1; i < magnitude.length; i++) total += magnitude[i] * magnitude[i];
  const result = [];
  for (let b = 0; b < bands; b++) {
    const f0 = lo * ratio ** (b / bands), f1 = lo * ratio ** ((b + 1) / bands);
    const start = Math.max(1, Math.floor(f0 / binHz)), end = Math.min(magnitude.length, Math.max(start + 1, Math.ceil(f1 / binHz)));
    let power = 0;
    for (let i = start; i < end; i++) power += magnitude[i] * magnitude[i];
    result.push(roundMetric(power / Math.max(total, 1e-20)));
  }
  return result;
}

function nonHarmonicPeaks(spec, pitch, partials) {
  if (!spec) return [];
  const {magnitude, binHz} = spec;
  const peaks = [];
  const start = Math.max(2, Math.ceil(650 / binHz));
  const end = Math.min(magnitude.length - 1, Math.floor(10000 / binHz));
  const reference = Math.max(partials[0]?.amplitude || 0, 1e-15);
  const f1 = partials[0]?.hz || 0;
  const bEstimates = [];
  for (let i = 1; i < partials.length; i++) {
    const n = i + 1;
    const ratio = (partials[i].hz / Math.max(1e-12, n * f1)) ** 2;
    const denominator = n * n - ratio;
    if (denominator > 0) {
      const b = (ratio - 1) / denominator;
      if (Number.isFinite(b) && b >= 0 && b <= 0.01) bEstimates.push(b);
    }
  }
  bEstimates.sort((a,b)=>a-b);
  const inharmonicityB = bEstimates.length ? bEstimates[Math.floor(bEstimates.length / 2)] : 0;
  for (let i = start; i < end; i++) {
    const amp = magnitude[i];
    if (amp < reference * 0.006 || amp < magnitude[i - 1] || amp < magnitude[i + 1]) continue;
    let harmonic = false;
    for (let n = 1; n * f1 <= 10000; n++) {
      const partialHz = n * f1 * Math.sqrt((1 + inharmonicityB * n * n) / (1 + inharmonicityB));
      if (Math.abs(i * binHz - partialHz) < Math.max(18, partialHz * 0.022)) { harmonic = true; break; }
    }
    if (!harmonic) peaks.push({hz:i * binHz,ratio:amp / reference});
  }
  peaks.sort((a,b)=>b.ratio-a.ratio);
  const chosen = [];
  for (const p of peaks) {
    if (chosen.some(q=>Math.abs(q.hz-p.hz)<Math.max(24,p.hz*0.018))) continue;
    chosen.push(p);
    if (chosen.length === 8) break;
  }
  return chosen;
}

function persistentNonHarmonicPeaks(left, right, sampleRate, onset, pitch, partials) {
  if (pitch > 45) return [];
  const later = nonHarmonicPeaks(spectrum(left, right, sampleRate, onset, 160), pitch, partials);
  const early = nonHarmonicPeaks(spectrum(left, right, sampleRate, onset, 20), pitch, partials);
  const joined = [];
  for (const a of early) {
    const b = later.find(p => Math.abs(p.hz-a.hz) <= Math.max(24, a.hz*0.025));
    if (b) {
      const hz=(a.hz+b.hz)*0.5,decay=Math.max(.02,Math.min(.995,b.ratio/Math.max(a.ratio,1e-12)));
      const tau=-.140/Math.log(decay),q=Math.max(2,Math.min(80,Math.PI*hz*tau));
      joined.push({hz,ratio:(a.ratio+b.ratio)*0.5,q});
    }
  }
  return joined.sort((a,b)=>b.ratio-a.ratio).slice(0,4);
}

function analyzeStereo(left, right, pitch, {sampleRate = 48000} = {}) {
  if (!(left instanceof Float32Array || left instanceof Float64Array) || !(right instanceof Float32Array || right instanceof Float64Array)) {
    throw new TypeError('left and right must be floating point sample arrays');
  }
  if (left.length !== right.length || left.length < Math.floor(sampleRate * 0.38)) throw new Error('audio must contain at least 380 ms of stereo samples');
  const onset = onsetIndex(left, right, sampleRate);
  const envelopeDbfs = WINDOWS_MS.map(([a, b]) => rmsWindow(left, right, Math.floor(a * sampleRate / 1000), Math.floor(b * sampleRate / 1000), onset));
  let peak = 0, sumL = 0, sumR = 0, sumMid = 0, sumSide = 0;
  const envelope20msDbfs = [];
  for (let i = onset; i < Math.min(left.length, onset + Math.floor(sampleRate * 0.5)); i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  for (let i = onset; i < Math.min(left.length, onset + Math.floor(sampleRate * 0.35)); i++) {
    const l = left[i], r = right[i], mid = (l + r) * 0.5, side = (l - r) * 0.5;
    sumL += l * l; sumR += r * r; sumMid += mid * mid; sumSide += side * side;
  }
  const hop = Math.floor(sampleRate * 0.02);
  for (let start = 0; start < Math.floor(sampleRate * 0.35); start += hop) {
    envelope20msDbfs.push(rmsWindow(left, right, start, Math.min(start + hop, Math.floor(sampleRate * 0.35)), onset));
  }
  const spec = spectrum(left, right, sampleRate, onset);
  if (!spec) throw new Error(`not enough audio after onset for pitch ${pitch}`);
  const {magnitude, binHz} = spec;
  let weighted = 0, total = 0, totalPower = 0, above2k = 0, spreadEnergy = 0;
  for (let i = 1; i < magnitude.length; i++) {
    const hz = i * binHz, power = magnitude[i] * magnitude[i];
    weighted += hz * magnitude[i]; total += magnitude[i];
    totalPower += power;
    if (hz >= 2000) above2k += power;
  }
  const centroidHz = total > 0 ? weighted / total : 0;
  for (let i = 1; i < magnitude.length; i++) spreadEnergy += magnitude[i] * (i * binHz - centroidHz) ** 2;
  const expectedHz = 440 * 2 ** ((pitch - 69) / 12);
  const partials = [];
  for (let n = 1; n <= 8 && n * expectedHz < sampleRate * 0.48; n++) partials.push(peakNear(magnitude, binHz, n * expectedHz));
  const f1 = partials[0]?.hz || expectedHz;
  const harmonicRatios = partials.slice(1, 6).map(p => p.amplitude / Math.max(partials[0].amplitude, 1e-15));
  const longitudinalPeaks = persistentNonHarmonicPeaks(left, right, sampleRate, onset, pitch, partials);
  let inharmonicSum = 0, inharmonicWeight = 0;
  for (let i = 1; i < partials.length; i++) {
    const n = i + 1;
    const b = ((partials[i].hz / (n * f1)) ** 2 - 1) / Math.max(1, n * n - 1);
    const weight = partials[i].amplitude;
    inharmonicSum += b * weight; inharmonicWeight += weight;
  }
  const midRms = Math.sqrt(sumMid / Math.max(1, Math.min(left.length - onset, Math.floor(sampleRate * 0.35))));
  const sideRms = Math.sqrt(sumSide / Math.max(1, Math.min(left.length - onset, Math.floor(sampleRate * 0.35))));
  const totalLR = sumL + sumR;
  const metrics = {
    onsetMs: onset * 1000 / sampleRate,
    fundamentalHz: f1,
    pitchErrorCents: 1200 * Math.log2(f1 / expectedHz),
    peakDbfs: db(peak),
    envelopeDbfs,
    envelope20msDbfs,
    spectralCentroidHz: centroidHz,
    above2kPowerRatio: above2k / Math.max(totalPower, 1e-20),
    harmonicRatiosH2ToH6: harmonicRatios,
    inharmonicityB: inharmonicWeight > 0 ? inharmonicSum / inharmonicWeight : 0,
    spectralSpreadHz: Math.sqrt(spreadEnergy / Math.max(total, 1e-20)),
    spectralBandPowerRatios: spectralBandPowerRatios(magnitude, binHz),
    lowRegisterNonHarmonicPeakHz: longitudinalPeaks.map(p=>p.hz),
    lowRegisterNonHarmonicPeakAmplitudeRatio: longitudinalPeaks.map(p=>p.ratio),
    lowRegisterNonHarmonicPeakQ: longitudinalPeaks.map(p=>p.q),
    stereoWidth: sideRms / Math.max(midRms, 1e-12),
    stereoPan: (sumR - sumL) / Math.max(totalLR, 1e-20)
  };
  for (const value of Object.values(metrics).flat()) if (!Number.isFinite(value)) throw new Error(`non-finite metric for pitch ${pitch}`);
  return Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, Array.isArray(v) ? v.map(roundMetric) : roundMetric(v)]));
}

function roundMetric(value) { return Math.round(value * 1e6) / 1e6; }

function decodeWav24Stereo(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('FLAC decoder did not return a RIFF/WAVE file');
  let offset = 12, format = null, dataOffset = -1, dataSize = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), body = offset + 8;
    if (body + size > wav.length) throw new Error(`truncated WAV chunk ${id}`);
    if (id === 'fmt ') {
      const encoding = wav.readUInt16LE(body);
      format = {encoding,pcmSubtype:encoding===0xfffe&&size>=40?wav.readUInt32LE(body+24):encoding,channels:wav.readUInt16LE(body+2),sampleRate:wav.readUInt32LE(body+4),bits:wav.readUInt16LE(body+14)};
    }
    if (id === 'data') {dataOffset=body;dataSize=size;}
    offset = body + size + (size & 1);
  }
  if (!format || dataOffset < 0 || format.pcmSubtype !== 1 || format.channels !== 2 || format.bits !== 24 || format.sampleRate !== 48000) throw new Error(`expected 48 kHz 24-bit stereo PCM, got ${JSON.stringify(format)}`);
  const frames = Math.floor(dataSize / 6), left = new Float32Array(frames), right = new Float32Array(frames);
  for (let i=0, p=dataOffset; i<frames; i++, p+=6) {
    let l=wav[p]|(wav[p+1]<<8)|(wav[p+2]<<16), r=wav[p+3]|(wav[p+4]<<8)|(wav[p+5]<<16);
    if (l&0x800000) l|=0xff000000;
    if (r&0x800000) r|=0xff000000;
    left[i]=l/8388608; right[i]=r/8388608;
  }
  return {left,right,sampleRate:format.sampleRate};
}

module.exports = {FFT_SIZE, WINDOWS_MS, analyzeStereo, decodeWav24Stereo};
