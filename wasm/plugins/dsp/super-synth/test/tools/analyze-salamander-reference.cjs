#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {analyzeStereo, decodeWav24Stereo} = require('./salamander-metrics.cjs');

const EXPECTED_CENTERS = [21,24,27,30,33,36,39,42,45,48,51,54,57,60,63,66,69,72,75,78,81,84,87,90,93,96,99,102,105,108];
const EXPECTED_VELOCITIES = [14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const ARCHIVE_SHA256 = 'b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b';
const SFZ_NAME = 'SalamanderGrandPiano-V3+20200602.sfz';
const FILE_HASHES_NAME = 'salamander-grand-piano-v3-file-hashes.json';

function usage() {
  return 'Usage: analyze-salamander-reference.cjs --reference-dir <extracted-package-dir> --output <metrics.json> [--flac-bin <path>]';
}

function parseArgs(argv) {
  const args = {};
  for (let i=0; i<argv.length; i++) {
    const key = argv[i];
    if (!['--reference-dir','--output','--flac-bin'].includes(key) || !argv[i+1]) throw new Error(usage());
    args[key.slice(2)] = argv[++i];
  }
  if (!args['reference-dir'] || !args.output) throw new Error(usage());
  return args;
}

function parseSfz(text) {
  let scope = 'global';
  let globalOps = {}, groupOps = {}, regionOps = null;
  const regions = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '');
    const token = /<([^>]+)>|([A-Za-z0-9_]+)=((?:"[^"]*")|(?:'[^']*')|[^\s]+)/g;
    let match;
    while ((match = token.exec(line))) {
      if (match[1]) {
        const next = match[1].toLowerCase();
        if (scope === 'region' && regionOps) regions.push({...globalOps,...groupOps,...regionOps});
        if (next === 'global') { scope = 'global'; groupOps = {}; regionOps = null; }
        else if (next === 'group') { scope = 'group'; groupOps = {}; regionOps = null; }
        else if (next === 'region') { scope = 'region'; regionOps = {}; }
        else { scope = 'other'; regionOps = null; }
      } else {
        const key = match[2].toLowerCase();
        const value = match[3].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_,dq,sq)=>dq??sq);
        const target = scope === 'region' ? regionOps : scope === 'group' ? groupOps : scope === 'global' ? globalOps : null;
        if (target) target[key] = value;
      }
    }
  }
  if (scope === 'region' && regionOps) regions.push({...globalOps,...groupOps,...regionOps});
  return regions;
}

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function number(op, fallback) {
  const value = Number(op);
  return Number.isFinite(value) ? value : fallback;
}

function validateReference(root, relative) {
  const portable = relative.replace(/\\/g,'/');
  if (portable.startsWith('/') || /^[A-Za-z]:/.test(portable) || portable.split('/').includes('..')) throw new Error(`unsafe SFZ sample path: ${relative}`);
  const resolved = path.resolve(root, portable);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`sample escapes reference package: ${relative}`);
  if (!fs.statSync(resolved, {throwIfNoEntry:false})?.isFile()) throw new Error(`SFZ sample does not exist: ${relative}`);
  return {resolved,portable};
}

function verifyReferenceHashes(root) {
  const manifestPath = path.join(__dirname, '../reference', FILE_HASHES_NAME);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.source?.archiveSha256 !== ARCHIVE_SHA256) {
    throw new Error('reference hash manifest schema/archive identity mismatch');
  }
  if (manifest.source?.primarySfz !== SFZ_NAME || manifest.source?.uniqueReferencedAudioFiles !== 641) {
    throw new Error('reference hash manifest package identity/count mismatch');
  }
  const primary = manifest.packageFiles?.filter(x => x.kind === 'primary-sfz') || [];
  const audio = manifest.packageFiles?.filter(x => x.kind === 'audio-sample') || [];
  const readme = manifest.packageFiles?.filter(x => x.kind === 'package-readme') || [];
  if (primary.length !== 1 || audio.length !== 641 || readme.length !== 1) {
    throw new Error(`reference hash manifest file counts differ: sfz=${primary.length}, audio=${audio.length}, readme=${readme.length}`);
  }
  const packageFiles = [...primary, ...audio, ...readme];
  const checkedPaths = new Set();
  for (const entry of packageFiles) {
    const file = validateReference(root, entry.path);
    if (checkedPaths.has(file.portable)) throw new Error(`duplicate path in reference hash manifest: ${file.portable}`);
    checkedPaths.add(file.portable);
    const actual = sha256(fs.readFileSync(file.resolved));
    if (actual !== entry.sha256) throw new Error(`reference file SHA-256 mismatch: ${file.portable}`);
  }
  if (primary[0].sha256 !== manifest.source.primarySfzSha256) throw new Error('primary SFZ hash differs within manifest');

  const provenanceRoot = path.resolve(__dirname, '../reference');
  const provenance = manifest.provenanceFiles || [];
  if (provenance.length < 4) throw new Error('reference hash manifest omits license/provenance files');
  for (const entry of provenance) {
    const portable = entry.path.replace(/\\/g, '/');
    if (portable.startsWith('/') || portable.split('/').includes('..')) throw new Error(`unsafe provenance path ${entry.path}`);
    const resolved = path.resolve(provenanceRoot, portable);
    if (!resolved.startsWith(`${provenanceRoot}${path.sep}`) || !fs.statSync(resolved, {throwIfNoEntry:false})?.isFile()) {
      throw new Error(`reference provenance file is missing: ${portable}`);
    }
    if (sha256(fs.readFileSync(resolved)) !== entry.sha256) throw new Error(`provenance SHA-256 mismatch: ${portable}`);
  }
  return {manifest,packageFiles:packageFiles.length,provenanceFiles:provenance.length};
}

function readSampleMetrics(samplePath, pitch, flacBin) {
  const wav = execFileSync(flacBin, ['-d','-c','--silent',samplePath], {maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
  const decoded = decodeWav24Stereo(wav);
  return analyzeStereo(decoded.left, decoded.right, pitch, {sampleRate:decoded.sampleRate});
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args['reference-dir']);
  if (!fs.statSync(root, {throwIfNoEntry:false})?.isDirectory()) throw new Error(`reference package directory not found: ${root}`);
  const hashVerification = verifyReferenceHashes(root);
  const sfzPath = path.join(root, SFZ_NAME);
  if (!fs.statSync(sfzPath, {throwIfNoEntry:false})?.isFile()) throw new Error(`expected SFZ is missing from package root: ${SFZ_NAME}`);
  const sfzBytes = fs.readFileSync(sfzPath);
  const regions = parseSfz(sfzBytes.toString('utf8'));
  const references = new Map();
  for (const region of regions) {
    if (!region.sample) continue;
    const ref = validateReference(root, region.sample);
    references.set(ref.portable,ref.resolved);
  }
  if (references.size !== 641) throw new Error(`expected 641 unique SFZ audio references, found ${references.size}`);

  const direct = regions.filter(r => r.sample && /^([A-G](?:#|b)?\d+)v\d+\.flac$/i.test(path.posix.basename(r.sample)) && r.lokey !== undefined && r.hikey !== undefined && r.lovel !== undefined && r.trigger !== 'release');
  const keyed = new Map();
  for (const region of direct) {
    // SFZ's default pitch_keycenter is MIDI 60; the package omits it on its C4 regions.
    const pitch = number(region.pitch_keycenter,60), low = number(region.lovel,1), high = number(region.hivel,127);
    const velocity = Math.round((low + high) / 2);
    const key = `${pitch}:${velocity}`;
    if (keyed.has(key)) throw new Error(`duplicate direct SFZ cell ${key}`);
    if (!EXPECTED_CENTERS.includes(pitch)) throw new Error(`unexpected direct sample pitch ${pitch}`);
    keyed.set(key,{pitch,velocity,velocityRange:[low,high],sample:region.sample,samplePath:references.get(region.sample)});
  }
  if (direct.length !== 480 || keyed.size !== 480) throw new Error(`expected 480 direct regions/cells, found ${direct.length}/${keyed.size}`);
  const actualPitches = [...new Set([...keyed.values()].map(x=>x.pitch))].sort((a,b)=>a-b);
  const actualVelocities = [...new Set([...keyed.values()].map(x=>x.velocity))].sort((a,b)=>a-b);
  if (JSON.stringify(actualPitches) !== JSON.stringify(EXPECTED_CENTERS)) throw new Error(`direct pitches differ: ${actualPitches.join(',')}`);
  if (JSON.stringify(actualVelocities) !== JSON.stringify(EXPECTED_VELOCITIES)) throw new Error(`velocity representatives differ: ${actualVelocities.join(',')}`);
  for (const pitch of EXPECTED_CENTERS) for (const velocity of EXPECTED_VELOCITIES) if (!keyed.has(`${pitch}:${velocity}`)) throw new Error(`missing direct cell pitch=${pitch} velocity=${velocity}`);

  const measurements = [];
  let i=0;
  for (const cell of [...keyed.values()].sort((a,b)=>a.pitch-b.pitch||a.velocity-b.velocity)) {
    measurements.push({pitch:cell.pitch,velocity:cell.velocity,velocityRange:cell.velocityRange,sample:cell.sample,metrics:readSampleMetrics(cell.samplePath,cell.pitch,args['flac-bin']||'flac')});
    if (++i % 40 === 0 || i === direct.length) process.stderr.write(`measured ${i}/${direct.length} direct cells\n`);
  }
  const result = {
    schemaVersion:3,
    source:{
      name:'Salamander Grand Piano V3',
      package:'SalamanderGrandPiano-SFZ+FLAC-V3+20200602',
      archiveSha256:ARCHIVE_SHA256,
      sfzFile:SFZ_NAME,
      sfzSha256:sha256(sfzBytes),
      fileHashesManifest:FILE_HASHES_NAME,
      verifiedPackageFiles:hashVerification.packageFiles,
      verifiedProvenanceFiles:hashVerification.provenanceFiles,
      officialSource:'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html',
      license:'CC BY 3.0',
      licenseUrl:'https://creativecommons.org/licenses/by/3.0/',
      attribution:'Alexander Holm; FLAC package prepared by Roberto S.'
    },
    analysis:{sampleRate:48000,channels:2,sourceEncoding:'24-bit PCM decoded from FLAC',onsetAligned:true,dcRemoved:true,analysisFftSize:16384,analysisStartMs:20,spectralBandCount:64,lowRegisterPersistentNonHarmonicPeaks:{pitchMax:45,frequencyRangeHz:[650,10000],windowsMs:[20,160]},absoluteDynamicsNormalized:false,metricCode:'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs'},
    coverage:{uniqueAudioReferences:references.size,directRegions:direct.length,directCells:keyed.size,pitches:EXPECTED_CENTERS,velocityRepresentatives:EXPECTED_VELOCITIES},
    directCells:measurements
  };
  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const temp = `${output}.tmp-${process.pid}`;
  fs.writeFileSync(temp,`${JSON.stringify(result,null,2)}\n`);
  fs.renameSync(temp,output);
  console.log(JSON.stringify({output,directCells:measurements.length,uniqueAudioReferences:references.size,verifiedPackageFiles:hashVerification.packageFiles,verifiedProvenanceFiles:hashVerification.provenanceFiles,sfzSha256:result.source.sfzSha256,archiveSha256:ARCHIVE_SHA256}));
}

try { main(); }
catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode=1; }
