'use strict';

const fs=require('node:fs');
const path=require('node:path');
const fixturePath=path.join(__dirname,'reference/salamander-grand-piano-v3-metrics.json');
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const hashesPath=path.join(__dirname,'reference/salamander-grand-piano-v3-file-hashes.json');
const hashes=JSON.parse(fs.readFileSync(hashesPath,'utf8'));
function check(value,message){if(!value)throw new Error(message)}

const expectedPitches=Array.from({length:30},(_,i)=>21+i*3);
const expectedVelocities=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
check(fixture.schemaVersion===3,'unsupported Salamander metric fixture schema');
check(fixture.source?.name==='Salamander Grand Piano V3','unexpected reference source');
check(fixture.source?.license==='CC BY 3.0'&&/^https:\/\//.test(fixture.source?.licenseUrl||''),'reference license attribution is missing');
check(fixture.source?.archiveSha256==='b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b','reference archive checksum mismatch');
check(fixture.source?.fileHashesManifest==='salamander-grand-piano-v3-file-hashes.json','reference file-hash manifest missing');
check(hashes.schemaVersion===1&&hashes.source?.archiveSha256===fixture.source.archiveSha256,'reference file-hash manifest archive identity mismatch');
check(hashes.packageFiles?.length===fixture.source.verifiedPackageFiles&&hashes.provenanceFiles?.length===fixture.source.verifiedProvenanceFiles,'reference file-hash manifest counts mismatch');
check(hashes.packageFiles.filter(x=>x.kind==='primary-sfz').length===1&&hashes.packageFiles.filter(x=>x.kind==='audio-sample').length===641,'reference SFZ/audio hash coverage mismatch');
check([...hashes.packageFiles,...hashes.provenanceFiles].every(x=>/^[a-f0-9]{64}$/.test(x.sha256||'')),'reference file-hash manifest contains an invalid SHA-256');
check(fixture.coverage?.uniqueAudioReferences===641,'SFZ unique sample reference count mismatch');
check(fixture.coverage?.directRegions===480&&fixture.directCells?.length===480,'direct calibration matrix must contain 480 measured cells');
check(JSON.stringify(fixture.coverage.pitches)===JSON.stringify(expectedPitches),'reference pitch centers mismatch');
check(JSON.stringify(fixture.coverage.velocityRepresentatives)===JSON.stringify(expectedVelocities),'reference velocity centers mismatch');
const seen=new Set();
for(const cell of fixture.directCells){
  const key=`${cell.pitch}:${cell.velocity}`;
  check(!seen.has(key),`duplicate source cell ${key}`);seen.add(key);
  check(expectedPitches.includes(cell.pitch)&&expectedVelocities.includes(cell.velocity),`unexpected source cell ${key}`);
  check(typeof cell.sample==='string'&&!path.isAbsolute(cell.sample)&&!cell.sample.split('/').includes('..'),`unsafe sample provenance for ${key}`);
  const m=cell.metrics;
  check(Array.isArray(m.envelopeDbfs)&&m.envelopeDbfs.length===5,`envelope windows missing for ${key}`);
  check(Array.isArray(m.envelope20msDbfs)&&m.envelope20msDbfs.length===18,`20 ms envelope missing for ${key}`);
  check(Array.isArray(m.harmonicRatiosH2ToH6)&&m.harmonicRatiosH2ToH6.length>=1,`harmonic metrics missing for ${key}`);
  check(Object.values(m).flat().every(Number.isFinite),`non-finite metrics in ${key}`);
}
check(seen.size===480,'incomplete source cell matrix');
console.log('PASS Salamander reference fixture',{directCells:seen.size,uniqueAudioReferences:fixture.coverage.uniqueAudioReferences,archiveSha256:fixture.source.archiveSha256});
