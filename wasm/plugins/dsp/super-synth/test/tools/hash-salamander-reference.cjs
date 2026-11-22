#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SFZ_NAME = 'SalamanderGrandPiano-V3+20200602.sfz';
const PACKAGE_NAME = 'SalamanderGrandPiano-SFZ+FLAC-V3+20200602';
const EXPECTED_ARCHIVE_SHA256 = 'b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b';
const PROVENANCE_NAMES = ['ATTRIBUTION.md', 'CALIBRATION_README.txt', 'LICENSE.txt', 'SHA256SUMS.txt'];
const OUT = path.resolve(__dirname, '../reference/salamander-grand-piano-v3-file-hashes.json');

function usage() {
  return 'Usage: hash-salamander-reference.cjs --reference-dir <extracted-package-dir> --provenance-dir <tracked-provenance-dir> --archive <verified-archive.tar.gz>';
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!['--reference-dir', '--provenance-dir', '--archive'].includes(name) || !argv[i + 1]) throw new Error(usage());
    out[name.slice(2)] = path.resolve(argv[++i]);
  }
  if (!out['reference-dir'] || !out['provenance-dir'] || !out.archive) throw new Error(usage());
  return out;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function portableRelative(root, name) {
  const portable = name.replace(/\\/g, '/');
  if (portable.startsWith('/') || /^[A-Za-z]:/.test(portable) || portable.split('/').includes('..')) {
    throw new Error(`unsafe package path ${name}`);
  }
  const resolved = path.resolve(root, portable);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`package path escapes root: ${name}`);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) throw new Error(`required file is missing: ${portable}`);
  return { path: portable, resolved };
}

function parseSampleReferences(text) {
  const samples = new Set();
  const token = /\bsample\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match;
  while ((match = token.exec(text))) samples.add((match[1] || match[2] || match[3]).trim().replace(/\\/g, '/'));
  return [...samples].sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const referenceRoot = args['reference-dir'];
  const provenanceRoot = args['provenance-dir'];
  const archiveSha256 = await hashFile(args.archive);
  if (archiveSha256 !== EXPECTED_ARCHIVE_SHA256) throw new Error(`archive SHA-256 mismatch: ${archiveSha256}`);
  const primary = portableRelative(referenceRoot, SFZ_NAME);
  const sfzBytes = fs.readFileSync(primary.resolved);
  const samples = parseSampleReferences(sfzBytes.toString('utf8'));
  if (samples.length !== 641) throw new Error(`expected 641 unique sample references, found ${samples.length}`);

  const packageFiles = [
    { kind: 'primary-sfz', ...primary },
    ...samples.map(name => ({ kind: 'audio-sample', ...portableRelative(referenceRoot, name) })),
    { kind: 'package-readme', ...portableRelative(referenceRoot, 'readme.txt') },
  ];
  for (const file of packageFiles) file.sha256 = await hashFile(file.resolved);
  const hashedPackageFiles = packageFiles.map(({ kind, path: filePath, sha256 }) => ({ kind, path: filePath, sha256 }));

  const provenanceFiles = [];
  for (const name of PROVENANCE_NAMES) {
    const { resolved } = portableRelative(provenanceRoot, name);
    provenanceFiles.push({ path: `salamander-provenance/${name}`, sha256: await hashFile(resolved) });
  }
  const checksumText = fs.readFileSync(path.join(provenanceRoot, 'SHA256SUMS.txt'), 'utf8');
  const listedArchive = checksumText.split(/\r?\n/).find(line => line.endsWith('SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz'))?.split(/\s+/)[0];
  if (listedArchive !== EXPECTED_ARCHIVE_SHA256) throw new Error('official SHA256SUMS.txt does not match the verified archive');

  const manifest = {
    schemaVersion: 1,
    source: {
      package: PACKAGE_NAME,
      archiveFile: 'SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz',
      archiveSha256,
      primarySfz: SFZ_NAME,
      primarySfzSha256: hashedPackageFiles[0].sha256,
      license: 'CC BY 3.0',
      uniqueReferencedAudioFiles: samples.length,
    },
    packageFiles: hashedPackageFiles,
    provenanceFiles,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const temp = `${OUT}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temp, OUT);
  console.log(JSON.stringify({ output: OUT, archiveSha256, primarySfzSha256: manifest.source.primarySfzSha256, referencedAudioFiles: samples.length, packageFiles: packageFiles.length, provenanceFiles: provenanceFiles.length }));
}

main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
