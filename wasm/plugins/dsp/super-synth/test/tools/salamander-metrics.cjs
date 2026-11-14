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
  return {magnitude, binHz: sampleRate / size, sampleCount: available, startIndex: start};
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

function peakNearExpected(magnitude,binHz,hz,maxCents=12){
  const ratio=2**(maxCents/1200);
  const first=Math.max(1,Math.ceil((hz/ratio)/binHz));
  const last=Math.min(magnitude.length-2,Math.floor((hz*ratio)/binHz));
  if(last<first)return null;
  let best=first;
  for(let i=first+1;i<=last;i++)if(magnitude[i]>magnitude[best])best=i;
  const a=magnitude[best-1],b=magnitude[best],c=magnitude[best+1];
  const denom=a-2*b+c;
  const fraction=Math.abs(denom)>1e-20?0.5*(a-c)/denom:0;
  return {hz:(best+Math.max(-0.5,Math.min(0.5,fraction)))*binHz,amplitude:b};
}

function spectralPeakProminence(magnitude, binHz, hz, peakAmplitude) {
  const center=Math.round(hz/binHz),neighbors=[];
  for(let i=Math.max(1,center-6);i<=Math.min(magnitude.length-2,center+6);i++){
    if(Math.abs(i-center)>2)neighbors.push(magnitude[i]);
  }
  neighbors.sort((a,b)=>a-b);
  const floor=neighbors.length?neighbors[Math.floor(neighbors.length/2)]:0;
  return peakAmplitude/Math.max(floor,1e-12);
}

function estimateExpectedPitch(left,right,expectedHz,sampleRate,{onset=0,startMs=20,endMs=350,maxDeviationCents=85}={}) {
  const start=Math.max(0,onset+Math.floor(startMs*sampleRate/1000));
  const end=Math.min(left.length,right.length,onset+Math.floor(endMs*sampleRate/1000));
  const length=end-start,period=sampleRate/expectedHz;
  if(length<Math.floor(period*2.5))return null;
  const ratio=2**(maxDeviationCents/1200),minLag=Math.max(2,Math.floor(period/ratio)-1),maxLag=Math.ceil(period*ratio)+1;
  const l=new Float64Array(length),r=new Float64Array(length);
  let meanL=0,meanR=0;
  for(let i=0;i<length;i++){meanL+=left[start+i];meanR+=right[start+i];}
  meanL/=length;meanR/=length;
  let energy=0;
  for(let i=0;i<length;i++){
    const window=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,length-1));
    l[i]=(left[start+i]-meanL)*window;r[i]=(right[start+i]-meanR)*window;
    energy+=l[i]*l[i]+r[i]*r[i];
  }
  if(!(energy>1e-16))return null;
  const scores=new Map();let bestLag=0,bestScore=-Infinity;
  for(let lag=minLag;lag<=maxLag;lag++){
    let cross=0,energyA=0,energyB=0;
    for(let i=0;i<length-lag;i++){
      const al=l[i],ar=r[i],bl=l[i+lag],br=r[i+lag];
      cross+=al*bl+ar*br;energyA+=al*al+ar*ar;energyB+=bl*bl+br*br;
    }
    const score=cross/Math.sqrt(Math.max(1e-30,energyA*energyB));
    scores.set(lag,score);
    if(score>bestScore){bestScore=score;bestLag=lag;}
  }
  if(!bestLag||!Number.isFinite(bestScore))return null;
  const before=scores.get(bestLag-1),after=scores.get(bestLag+1);
  let fraction=0;
  if(Number.isFinite(before)&&Number.isFinite(after)){
    const denominator=before-2*bestScore+after;
    if(Math.abs(denominator)>1e-12)fraction=Math.max(-.5,Math.min(.5,.5*(before-after)/denominator));
  }
  const hz=sampleRate/(bestLag+fraction),cents=1200*Math.log2(hz/expectedHz);
  return Number.isFinite(hz)&&Math.abs(cents)<=maxDeviationCents?{hz,cents,score:bestScore}:null;
}

function estimateInharmonicHarmonicComb(partials,expectedHz,binHz,maxDeviationCents=85) {
  const peakAmplitude=Math.max(0,...partials.map(p=>p.amplitude));
  if(!(peakAmplitude>0))return null;
  const observations=partials.map((p,index)=>({
    n:index+1,
    amplitudeRatio:p.amplitude/peakAmplitude,
    cents:1200*Math.log2(p.hz/((index+1)*expectedHz)),
  })).filter(x=>x.amplitudeRatio>=0.005&&Number.isFinite(x.cents));
  if(observations.length<3)return null;
  const weights=observations.map(x=>Math.sqrt(x.amplitudeRatio)*(x.n===1?1.5:1/Math.sqrt(x.n)));
  const weightTotal=weights.reduce((sum,x)=>sum+x,0);
  if(!(weightTotal>0))return null;
  let best={score:-Infinity,cents:0,inharmonicityB:0};
  for(let bIndex=0;bIndex<=20;bIndex++){
    const inharmonicityB=bIndex*0.001;
    for(let cents=-maxDeviationCents;cents<=maxDeviationCents;cents++){
      let score=0;
      for(let i=0;i<observations.length;i++){
        const o=observations[i];
        const ratio=(1+inharmonicityB*o.n*o.n)/(1+inharmonicityB);
        const predictedCents=cents+600*Math.log2(ratio);
        const predictedHz=o.n*expectedHz*2**(predictedCents/1200);
        const sigma=Math.max(8,0.35*1731*binHz/predictedHz);
        const residual=(o.cents-predictedCents)/sigma;
        score+=weights[i]*Math.exp(-0.5*residual*residual);
      }
      if(score>best.score)best={score,cents,inharmonicityB};
    }
  }
  const confidence=best.score/weightTotal;
  return {hz:expectedHz*2**(best.cents/1200),cents:best.cents,inharmonicityB:best.inharmonicityB,confidence};
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

function analyzeStereo(left, right, pitch, {sampleRate = 48000,pitchWindowMs = [20,350],onsetIndexOverride = null,includePitchDiagnostics = false} = {}) {
  if (!(left instanceof Float32Array || left instanceof Float64Array) || !(right instanceof Float32Array || right instanceof Float64Array)) {
    throw new TypeError('left and right must be floating point sample arrays');
  }
  if (left.length !== right.length || left.length < Math.floor(sampleRate * 0.38)) throw new Error('audio must contain at least 380 ms of stereo samples');
  const onset = Number.isInteger(onsetIndexOverride)?Math.max(0,Math.min(left.length,onsetIndexOverride)):onsetIndex(left, right, sampleRate);
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
  const narrowExpectedFundamental=expectedHz>=300?peakNearExpected(magnitude,binHz,expectedHz,12):null;
  const narrowExpectedProminence=narrowExpectedFundamental
    ?spectralPeakProminence(magnitude,binHz,narrowExpectedFundamental.hz,narrowExpectedFundamental.amplitude):0;
  const measuredFundamentalCandidate=narrowExpectedProminence>=5?narrowExpectedFundamental:partials[0];
  const pitchEstimate=estimateExpectedPitch(left,right,expectedHz,sampleRate,{onset,startMs:pitchWindowMs[0],endMs:pitchWindowMs[1]});
  const fundamentalPeakProminence=spectralPeakProminence(magnitude,binHz,measuredFundamentalCandidate?.hz||expectedHz,measuredFundamentalCandidate?.amplitude||0);
  const strongestUpperPartial=partials.slice(1).reduce((best,p)=>Math.max(best,p.amplitude),0);
  const fundamentalToUpperPartialRatio=(measuredFundamentalCandidate?.amplitude||0)/Math.max(strongestUpperPartial,1e-20);
  /* In the lowest three piano notes, broadband autocorrelation can lock to a
     strong stiff-string partial. Prefer the expected fundamental peak only
     when it stands above its local spectral floor; otherwise keep autocorrelation. */
  const lowRegisterFundamental=expectedHz<=31.0&&fundamentalPeakProminence>=3&&measuredFundamentalCandidate
    &&Math.abs(1200*Math.log2(measuredFundamentalCandidate.hz/expectedHz))<=85?measuredFundamentalCandidate:null;
  const spectralFallback=expectedHz>=binHz*40?partials[0]:null;
  /* Once the expected fundamental is spectrally resolved, prefer its local
     peak when it is prominent and still inside the expected-f0 search band.
     Broadband autocorrelation can otherwise lock onto a strong upper partial
     even when the true H1 is visible in the spectrum. */
  const fundamentalStrengthSufficient=expectedHz>=300||fundamentalToUpperPartialRatio>=0.15;
  const confidentSpectralFundamental=expectedHz>31&&fundamentalPeakProminence>=5&&fundamentalStrengthSufficient&&measuredFundamentalCandidate
    &&Math.abs(1200*Math.log2(measuredFundamentalCandidate.hz/expectedHz))<=85?measuredFundamentalCandidate:null;
  const spectralFundamental=lowRegisterFundamental||confidentSpectralFundamental||(!pitchEstimate?spectralFallback:null);
  const harmonicCombEstimate=estimateInharmonicHarmonicComb(partials,expectedHz,binHz);
  const spectralCents=spectralFundamental?1200*Math.log2(spectralFundamental.hz/expectedHz):null;
  const combMatchesSpectral=harmonicCombEstimate&&spectralCents!==null&&Math.abs(harmonicCombEstimate.cents-spectralCents)<=12;
  const combMatchesAutocorrelation=harmonicCombEstimate&&pitchEstimate&&Math.abs(harmonicCombEstimate.cents-pitchEstimate.cents)<=12;
  /* Above 1.3 kHz, the resolved H1 is more stable than this short-window
     inharmonic fit; higher partial-bin quantization otherwise biases pitch. */
  /* In the lower register, either the local H1 or constrained autocorrelation
     may confirm the multi-partial fit when the other estimator locks to a stiff partial. */
  const useHarmonicComb=expectedHz<=1300&&harmonicCombEstimate?.confidence>=0.3
    &&(combMatchesSpectral||combMatchesAutocorrelation);
  const measuredPitch=useHarmonicComb
    ?harmonicCombEstimate
    :spectralFundamental
    ?{hz:spectralFundamental.hz,cents:1200*Math.log2(spectralFundamental.hz/expectedHz)}
    :pitchEstimate||null;
  const pitchSelectionMethod=useHarmonicComb
    ?'expected-f0-inharmonic-harmonic-comb'
    :lowRegisterFundamental
    ?'low-register-spectral-fundamental'
    :confidentSpectralFundamental
      ?'confident-expected-fundamental-spectrum'
      :pitchEstimate
        ?'expected-lag-autocorrelation'
        :spectralFallback
          ?'spectral-fallback'
          :'unavailable';
  const f1 = measuredPitch?.hz || expectedHz;
  const inharmonicBaseHz=partials[0]?.hz||expectedHz;
  const harmonicRatios = partials.slice(1, 6).map(p => p.amplitude / Math.max(partials[0].amplitude, 1e-15));
  const longitudinalPeaks = persistentNonHarmonicPeaks(left, right, sampleRate, onset, pitch, partials);
  let inharmonicSum = 0, inharmonicWeight = 0;
  for (let i = 1; i < partials.length; i++) {
    const n = i + 1;
    const b = ((partials[i].hz / (n * inharmonicBaseHz)) ** 2 - 1) / Math.max(1, n * n - 1);
    const weight = partials[i].amplitude;
    inharmonicSum += b * weight; inharmonicWeight += weight;
  }
  const midRms = Math.sqrt(sumMid / Math.max(1, Math.min(left.length - onset, Math.floor(sampleRate * 0.35))));
  const sideRms = Math.sqrt(sumSide / Math.max(1, Math.min(left.length - onset, Math.floor(sampleRate * 0.35))));
  const totalLR = sumL + sumR;
  const metrics = {
    onsetMs: onset * 1000 / sampleRate,
    fundamentalHz: measuredPitch?.hz ?? NaN,
    pitchErrorCents: measuredPitch?.cents ?? NaN,
    fundamentalPeakProminence,
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
  for (const [key,value] of Object.entries(metrics)) {
    if(key==='fundamentalHz'||key==='pitchErrorCents')continue;
    for(const item of (Array.isArray(value)?value:[value]))if(!Number.isFinite(item))throw new Error(`non-finite ${key} metric for pitch ${pitch}`);
  }
  const result=Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, Array.isArray(v) ? v.map(roundMetric) : roundMetric(v)]));
  if(includePitchDiagnostics){
    result.pitchDiagnostics={
      expectedHz,
      autocorrelationHz:pitchEstimate?.hz??null,
      autocorrelationCents:pitchEstimate?.cents??null,
      autocorrelationScore:pitchEstimate?.score??null,
      h1Hz:measuredFundamentalCandidate?.hz??null,
      h1Amplitude:measuredFundamentalCandidate?.amplitude??null,
      h1Prominence:fundamentalPeakProminence,
      h1ToStrongestUpperPartialRatio:fundamentalToUpperPartialRatio,
      harmonicCombCents:harmonicCombEstimate?.cents??null,
      harmonicCombInharmonicityB:harmonicCombEstimate?.inharmonicityB??null,
      harmonicCombConfidence:harmonicCombEstimate?.confidence??null,
      partials:partials.slice(0,6).map(p=>({hz:p.hz,amplitude:p.amplitude})),
      selectionMethod:pitchSelectionMethod,
      selectedHz:measuredPitch?.hz??null,
      selectedCents:measuredPitch?.cents??null,
    };
  }
  return result;
}

function roundMetric(value) { return Number.isFinite(value)?Math.round(value * 1e6) / 1e6:null; }

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

function toneMag(signal, frequencyHz, startSeconds=0.08, endSeconds=0.65, sampleRate=48000) {
  let real=0,imaginary=0,windowSum=0;
  const start=Math.max(0,Math.floor(startSeconds*sampleRate));
  const end=Math.min(signal.length,Math.floor(endSeconds*sampleRate));
  for(let i=start;i<end;i++){
    const window=0.5-0.5*Math.cos(2*Math.PI*(i-start)/Math.max(1,end-start-1));
    const phase=2*Math.PI*frequencyHz*i/sampleRate;
    real+=signal[i]*window*Math.cos(phase);
    imaginary-=signal[i]*window*Math.sin(phase);
    windowSum+=window;
  }
  return Math.hypot(real,imaginary)/Math.max(1e-12,windowSum);
}

module.exports = {FFT_SIZE, WINDOWS_MS, analyzeStereo, estimateExpectedPitch, spectrum, peakNear, peakNearExpected, spectralPeakProminence, decodeWav24Stereo, toneMag};
