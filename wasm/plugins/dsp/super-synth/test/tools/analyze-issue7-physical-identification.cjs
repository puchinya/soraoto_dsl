'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {analyzeStereo} = require('./salamander-metrics.cjs');

const ARCHIVE_SHA256 = 'b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b';
const SFZ_NAME = 'SalamanderGrandPiano-V3+20200602.sfz';
const SFZ_ARCHIVE_MEMBER = 'SalamanderGrandPiano-SFZ+FLAC-V3+20200602/SalamanderGrandPiano-V3+20200602.sfz';
const WINDOWS_MS = Object.freeze([[0, 10], [10, 30], [30, 80], [80, 200], [200, 500]]);

function midiHz(pitch) { return 440 * 2 ** ((pitch - 69) / 12); }
function db(value) { return 20 * Math.log10(Math.max(value, 1e-12)); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256'), stream = fs.createReadStream(file);
    stream.on('data', bytes => hash.update(bytes)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function locateGoogleDriveArchive({cloudStorage = path.join(os.homedir(), 'Library', 'CloudStorage')} = {}) {
  if (!fs.existsSync(cloudStorage)) return null;
  for (const account of fs.readdirSync(cloudStorage).filter(name => name.startsWith('GoogleDrive-'))) {
    const accountDir = path.join(cloudStorage, account);
    let entries;
    try { entries = fs.readdirSync(accountDir); } catch { continue; }
    const drive = entries.find(name => name.normalize('NFC') === 'マイドライブ');
    if (!drive) continue;
    const folder = path.join(accountDir, drive, 'soraoto_dsl', 'reference-audio', 'supersynth-v9', 'salamander-grand-piano');
    const archive = path.join(folder, 'SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz');
    try { if (fs.lstatSync(archive).isFile()) return archive; } catch {}
  }
  return null;
}
function fft(real, imag) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length, wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let base = 0; base < size; base += length) {
      let wr = 1, wi = 0;
      for (let j = 0; j < length / 2; j++) {
        const even = base + j, odd = even + length / 2;
        const tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
        real[even] += tr; imag[even] += ti;
        const nextWr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0; wr = nextWr;
      }
    }
  }
}
function magnitudeSpectrum(signal, sampleRate, start, size) {
  if (start < 0 || start + size > signal.length) throw new Error('BLOCKED_PHYSICAL_ANALYSIS_WINDOW');
  const real = new Float64Array(size), imag = new Float64Array(size);
  let mean = 0;
  for (let i = 0; i < size; i++) mean += signal[start + i];
  mean /= size;
  let windowSum = 0;
  for (let i = 0; i < size; i++) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
    real[i] = (signal[start + i] - mean) * hann; windowSum += hann;
  }
  fft(real, imag);
  const magnitude = new Float64Array(size / 2 + 1);
  for (let bin = 0; bin < magnitude.length; bin++) magnitude[bin] = Math.hypot(real[bin], imag[bin]) / Math.max(windowSum, 1e-12);
  return magnitude;
}
function parseSfz(text) {
  let scope = 'global', globalOps = {}, groupOps = {}, current = null;
  const regions = [];
  const applyLine = (ops, line) => {
    const cleaned = line.replace(/\/\/.*$/, '').trim();
    for (const match of cleaned.matchAll(/([A-Za-z0-9_]+)=([^\s]+)/g)) ops[match[1]] = match[2];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const tag = line.match(/^<(global|group|region)>/i);
    if (tag) {
      if (scope === 'region' && current) regions.push({...globalOps, ...groupOps, ...current});
      scope = tag[1].toLowerCase();
      if (scope === 'group') groupOps = {};
      if (scope === 'region') current = {};
      const trailing = line.slice(tag[0].length).trim();
      if (trailing) {
        if (scope === 'global') applyLine(globalOps, trailing);
        else if (scope === 'group') applyLine(groupOps, trailing);
        else applyLine(current, trailing);
      }
      continue;
    }
    if (scope === 'global') applyLine(globalOps, line);
    else if (scope === 'group') applyLine(groupOps, line);
    else if (current) applyLine(current, line);
  }
  if (scope === 'region' && current) regions.push({...globalOps, ...groupOps, ...current});
  if (!regions.length) throw new Error('BLOCKED_PHYSICAL_SFZ_NO_REGIONS');
  return {globalOps, regions};
}
function extractReferenceFiles(archivePath, cells, destination) {
  const sfzMember = SFZ_ARCHIVE_MEMBER;
  const sfzBytes = execFileSync('rtk', ['run', 'tar', '-xOzf', archivePath, sfzMember], {maxBuffer: 16 * 1024 * 1024});
  const parsed = parseSfz(sfzBytes.toString('utf8'));
  const rootMember = path.posix.dirname(sfzMember), relativeSamples = new Set();
  for (const cell of cells) {
    const matches = parsed.regions.filter(region => {
      const root = Number(region.key ?? region.pitch_keycenter ?? cell.pitch);
      const lowKey = Number(region.lokey ?? root), highKey = Number(region.hikey ?? root);
      const lowVelocity = Number(region.lovel ?? 1), highVelocity = Number(region.hivel ?? 127);
      return region.trigger !== 'release' && cell.pitch >= lowKey && cell.pitch <= highKey
        && cell.velocity >= lowVelocity && cell.velocity <= highVelocity && region.sample;
    });
    if (matches.length !== 1) throw new Error(`BLOCKED_PHYSICAL_SFZ_MAPPING: ${cell.pitch}/${cell.velocity}/${matches.length}`);
    const relative = path.posix.normalize(path.posix.join(parsed.globalOps.default_path || '.', matches[0].sample));
    if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) throw new Error('BLOCKED_PHYSICAL_REFERENCE_MEMBER_ESCAPE');
    relativeSamples.add(relative);
  }
  const referenceDir = path.resolve(destination, rootMember);
  const members = [sfzMember, ...[...relativeSamples].map(relative => path.posix.normalize(path.posix.join(rootMember, relative)))];
  for (const member of members) {
    if (path.posix.isAbsolute(member) || member.split('/').some(part => part === '..')) throw new Error('BLOCKED_PHYSICAL_REFERENCE_MEMBER_ESCAPE');
  }
  const verifyExtracted = root => {
    const dir = path.resolve(root, rootMember);
    for (const relative of [SFZ_NAME, ...relativeSamples]) {
      const target = path.resolve(dir, relative);
      if (!target.startsWith(`${dir}${path.sep}`) || fs.realpathSync(target) !== target || !fs.lstatSync(target).isFile())
        throw new Error(`BLOCKED_PHYSICAL_REFERENCE_EXTRACTED_FILE: ${relative}`);
    }
    return dir;
  };
  if (fs.existsSync(destination)) return {referenceDir: verifyExtracted(destination), sfzMember, samples: [...relativeSamples].sort()};
  const parentDir = path.dirname(path.resolve(destination));
  fs.mkdirSync(parentDir, {recursive: true});
  const staging = `${path.resolve(destination)}.staging-${process.pid}-${crypto.randomUUID()}`;
  fs.mkdirSync(staging, {mode: 0o700});
  try {
    execFileSync('rtk', ['run', 'tar', '-xzf', archivePath, '-C', staging, '--no-same-owner', '--no-same-permissions', '--', ...members],
      {maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
    verifyExtracted(staging);
    fs.renameSync(staging, destination);
  } catch (error) {
    fs.rmSync(staging, {recursive: true, force: true});
    throw error;
  }
  return {referenceDir, sfzMember, samples: [...relativeSamples].sort()};
}

function decodeWav24Stereo(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('BLOCKED_PHYSICAL_FLAC_DECODE');
  let offset = 12, format = null, dataOffset = -1, dataSize = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), body = offset + 8;
    if (body + size > wav.length) throw new Error(`BLOCKED_PHYSICAL_TRUNCATED_WAV: ${id}`);
    if (id === 'fmt ') {
      const encoding = wav.readUInt16LE(body);
      format = {encoding, subtype: encoding === 0xfffe && size >= 40 ? wav.readUInt32LE(body + 24) : encoding, channels: wav.readUInt16LE(body + 2), sampleRate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14)};
    }
    if (id === 'data') { dataOffset = body; dataSize = size; }
    offset = body + size + (size & 1);
  }
  if (!format || dataOffset < 0 || format.subtype !== 1 || format.channels !== 2 || format.bits !== 24 || format.sampleRate !== 48000) throw new Error(`BLOCKED_PHYSICAL_REFERENCE_FORMAT: ${JSON.stringify(format)}`);
  const frames = Math.floor(dataSize / 6), left = new Float32Array(frames), right = new Float32Array(frames);
  for (let i = 0, p = dataOffset; i < frames; i++, p += 6) {
    let l = wav[p] | (wav[p + 1] << 8) | (wav[p + 2] << 16), r = wav[p + 3] | (wav[p + 4] << 8) | (wav[p + 5] << 16);
    if (l & 0x800000) l |= 0xff000000; if (r & 0x800000) r |= 0xff000000;
    left[i] = l / 8388608; right[i] = r / 8388608;
  }
  return {left, right, sampleRate: format.sampleRate};
}
function sampleForCell(referenceDir, parsed, pitch, velocity) {
  const matches = parsed.regions.filter(region => {
    const root = Number(region.key ?? region.pitch_keycenter ?? pitch);
    const lowKey = Number(region.lokey ?? root), highKey = Number(region.hikey ?? root);
    const lowVelocity = Number(region.lovel ?? 1), highVelocity = Number(region.hivel ?? 127);
    return region.trigger !== 'release' && pitch >= lowKey && pitch <= highKey
      && velocity >= lowVelocity && velocity <= highVelocity && region.sample;
  });
  if (matches.length !== 1) throw new Error(`BLOCKED_PHYSICAL_SFZ_MAPPING: ${pitch}/${velocity}/${matches.length}`);
  const base = path.resolve(referenceDir, parsed.globalOps.default_path || '.');
  const sample = path.resolve(base, matches[0].sample);
  const root = path.resolve(referenceDir);
  if (!sample.startsWith(`${root}${path.sep}`) || fs.realpathSync(sample) !== sample || !fs.lstatSync(sample).isFile()) throw new Error(`BLOCKED_PHYSICAL_REFERENCE_SAMPLE: ${pitch}/${velocity}`);
  return {sample, region: matches[0]};
}
function analyze(left, right, pitch, sampleRate = 48000) {
  if (!(left instanceof Float32Array || left instanceof Float64Array) || !(right instanceof Float32Array || right instanceof Float64Array) || left.length !== right.length || sampleRate !== 48000 || left.length < sampleRate * 0.5) throw new Error('BLOCKED_PHYSICAL_AUDIO_SHAPE');
  let peak = 0; const mono = new Float64Array(Math.floor(sampleRate * 0.5));
  for (let i = 0; i < mono.length; i++) {
    const l = left[i], r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error('BLOCKED_PHYSICAL_NONFINITE_AUDIO');
    peak = Math.max(peak, Math.abs(l), Math.abs(r)); mono[i] = (l + r) * 0.5;
  }
  const envelopeDbfs = WINDOWS_MS.map(([startMs, endMs]) => {
    const start = Math.floor(startMs * sampleRate / 1000), end = Math.min(mono.length, Math.floor(endMs * sampleRate / 1000));
    let energy = 0;
    for (let i = start; i < end; i++) energy += left[i] * left[i] + right[i] * right[i];
    return db(Math.sqrt(energy / Math.max(1, 2 * (end - start))));
  });
  const expectedHz = 440 * 2 ** ((pitch - 69) / 12), f0Spectrum = magnitudeSpectrum(mono, sampleRate, Math.floor(sampleRate * 0.02), 4096);
  const binHz = sampleRate / 4096, ratio = 2 ** (6 / 1200);
  const first = Math.max(1, Math.ceil(expectedHz / ratio / binHz)), last = Math.min(f0Spectrum.length - 2, Math.floor(expectedHz * ratio / binHz));
  if (first > last) throw new Error('BLOCKED_PHYSICAL_F0_RANGE');
  let best = first;
  for (let i = first + 1; i <= last; i++) if (f0Spectrum[i] > f0Spectrum[best]) best = i;
  const a = f0Spectrum[best - 1], b = f0Spectrum[best], c = f0Spectrum[best + 1], denom = a - 2 * b + c;
  const f0Hz = (best + (Math.abs(denom) > 1e-20 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom)) : 0)) * binHz;
  const stft = {};
  for (const size of [1024, 2048, 4096]) {
    const hop = size / 4, average = new Float64Array(size / 2 + 1), count = Math.floor((mono.length - size) / hop) + 1;
    for (let frame = 0; frame < count; frame++) {
      const magnitude = magnitudeSpectrum(mono, sampleRate, frame * hop, size);
      for (let bin = 0; bin < average.length; bin++) average[bin] += magnitude[bin] / count;
    }
    let weighted = 0, total = 0, harmonic = 0;
    for (let bin = 1; bin < average.length; bin++) {
      const power = average[bin] * average[bin], hz = bin * sampleRate / size;
      weighted += hz * average[bin]; total += average[bin];
      if (size === 4096 && Math.abs(hz / f0Hz - Math.round(hz / f0Hz)) <= Math.max(0.012 * Math.round(hz / f0Hz), 1e-9)) harmonic += power;
    }
    stft[size] = {frameCount: count, centroidHz: weighted / Math.max(total, 1e-20), magnitude: Array.from(average, value => Number(value.toPrecision(8)))};
    if (size === 4096) stft[size].harmonicPowerShare = harmonic / Math.max(1e-20, average.reduce((sum, value) => sum + value * value, 0));
  }
  const pitchErrorCents = 1200 * Math.log2(f0Hz / expectedHz);
  if (![peak, f0Hz, pitchErrorCents, ...envelopeDbfs, ...Object.values(stft).flatMap(x => [x.centroidHz, ...x.magnitude])].every(Number.isFinite)) throw new Error('BLOCKED_PHYSICAL_NONFINITE_FEATURE');
  const official = analyzeStereo(left.subarray(0, mono.length), right.subarray(0, mono.length), pitch, {sampleRate, pitchWindowMs: [20, 350], onsetIndexOverride: 0});
  official.finite = true;
  official.outputGuardHits = 0;
  return {sampleRate, frames: mono.length, peak, peakDbfs: db(peak), pitch, expectedHz, f0Hz, pitchErrorCents, envelopeDbfs, stft, official};
}
function gainOffsetDb(referenceRows, baselineRows) {
  if (referenceRows.length !== baselineRows.length || !referenceRows.length) throw new Error('BLOCKED_PHYSICAL_GAIN_CALIBRATION_COVERAGE');
  const values = referenceRows.map((reference, index) => reference.envelopeDbfs[3] - baselineRows[index].envelopeDbfs[3]).sort((a, b) => a - b);
  return values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
}
function featureVector(metrics, gainDb = 0) {
  const vector = [metrics.pitchErrorCents / 10, ...metrics.envelopeDbfs.map(value => (value + gainDb) / 6)];
  for (const size of [1024, 2048, 4096]) for (const magnitude of metrics.stft[size].magnitude) vector.push((db(magnitude) + gainDb) / 6);
  return vector;
}
async function referenceCorpus(referenceDir, cells, {archivePath = process.env.SUPERSYNTH_V9_SALAMANDER_ARCHIVE, archiveSha256: verifiedArchiveSha256 = null, flacBin = 'flac'} = {}) {
  if (!archivePath || !fs.existsSync(archivePath) || !fs.lstatSync(archivePath).isFile()) throw new Error('BLOCKED_PHYSICAL_REFERENCE_ARCHIVE_PATH');
  const archiveSha256 = verifiedArchiveSha256 || await sha256File(archivePath);
  if (archiveSha256 !== ARCHIVE_SHA256) throw new Error('BLOCKED_PHYSICAL_REFERENCE_ARCHIVE_SHA');
  const dir = fs.realpathSync(path.resolve(referenceDir));
  const sfzPath = path.join(dir, SFZ_NAME);
  if (!fs.statSync(sfzPath).isFile()) throw new Error('BLOCKED_PHYSICAL_REFERENCE_SFZ_MISSING');
  const parsed = parseSfz(fs.readFileSync(sfzPath, 'utf8')), cache = new Map();
  const rows = cells.map(cell => {
    const mapping = sampleForCell(dir, parsed, cell.pitch, cell.velocity), sampleBytes = fs.readFileSync(mapping.sample);
    if (!cache.has(mapping.sample)) {
      const wav = execFileSync('rtk', ['run', flacBin, '-d', '-c', '--silent', mapping.sample], {maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
      const decoded = decodeWav24Stereo(wav); cache.set(mapping.sample, analyze(decoded.left, decoded.right, cell.pitch, decoded.sampleRate));
    }
    return {pitch: cell.pitch, velocity: cell.velocity, sample: path.relative(dir, mapping.sample).split(path.sep).join('/'), sampleSha256: sha256(sampleBytes), metrics: cache.get(mapping.sample)};
  });
  return {source: {sfz: SFZ_NAME, sfzSha256: sha256(fs.readFileSync(sfzPath)), archiveName: path.basename(archivePath), archiveSha256, referenceDir: dir}, rows};
}

module.exports = {ARCHIVE_SHA256, SFZ_NAME, WINDOWS_MS, midiHz, sha256, sha256File, locateGoogleDriveArchive,
  extractReferenceFiles, fft, parseSfz, decodeWav24Stereo, sampleForCell, analyze, gainOffsetDb, featureVector, referenceCorpus};
