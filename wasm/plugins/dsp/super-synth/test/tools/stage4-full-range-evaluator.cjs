#!/usr/bin/env node
'use strict';

const path=require('node:path');
const {spawnSync}=require('node:child_process');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const EXPECTED_ADJACENT=1392;
const LEGACY_TEST='wasm/plugins/dsp/super-synth/test/supersynth-v9-full-range-calibration.test.js';
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function rowKey(row){return `${row.pitch}:${row.velocity}`;}
function exactRows(rows,expected,label){
  const actual=rows.map(row=>rowKey(row));const wanted=expected.map(row=>rowKey(row));
  if(actual.length!==wanted.length||new Set(actual).size!==wanted.length||wanted.some(key=>!actual.includes(key)))
    throw new Error(`BLOCKED_STAGE4_EVIDENCE: ${label} coverage mismatch`);
}
function safeRow(row){const m=row.metrics||{},life=m.lifecycle||{},pitch=m.pitchMeasurement||{};
  const errors=[];
  if(m.finite!==true||m.finiteThroughout!==true)errors.push('finite-throughout');
  if(m.finiteRelease!==true||m.postReleaseFinite!==true||life.postReleaseFinite!==true)errors.push('post-release-finite');
  if(pitch.measurement_valid!==true||!Number.isFinite(pitch.pitch_error_cents)||Math.abs(pitch.pitch_error_cents)>15)errors.push('pitch');
  if(m.outputGuardHits!==0||life.guardHits!==0)errors.push('guard');
  if(!Number.isFinite(m.peakDbfs)||m.peakDbfs>=0||!Number.isFinite(m.fullRenderPeakDbfs)||m.fullRenderPeakDbfs>=0)errors.push('peak');
  if(life.noteOffProcessed!==true)errors.push('note-off');
  if(life.releasedWithinLimit!==true||!Number.isFinite(life.inactiveAfterNoteOffMs)||life.inactiveAfterNoteOffMs>1000)errors.push('release-timeout');
  if(life.postReleaseProcessed!==true||life.finalActiveVoiceCount!==0)errors.push('stuck-voice');
  return errors;
}
function invokeLegacy({root=ROOT,matrixPath}={}){
  const script=path.join(root,LEGACY_TEST);
  const result=spawnSync('rtk',['node',script],{cwd:root,encoding:'utf8',env:{...process.env,SUPERSYNTH_LIFECYCLE_PATH:path.resolve(matrixPath)}});
  return {pass:result.status===0,status:result.status,stdout:(result.stdout||'').trim(),stderr:(result.stderr||'').trim()};
}
function evaluate({root=ROOT,identity,stage3Identity,matrix,repeats,legacyMatrixPath,legacy=invokeLegacy}={}){
  exactRows(matrix,capture.LIFECYCLE_CELLS,'lifecycle');exactRows(repeats,capture.REPEAT_CELLS,'repeat');
  const byMain=new Map(matrix.map(row=>[rowKey(row),row]));
  const cellFailures=matrix.flatMap(row=>safeRow(row).map(reason=>({pitch:row.pitch,velocity:row.velocity,reason})));
  const repeatFailures=[];
  for(const repeat of repeats){const original=byMain.get(rowKey(repeat));
    if(!original||!same(original.metrics,repeat.metrics))repeatFailures.push({pitch:repeat.pitch,velocity:repeat.velocity,reason:'persisted-metrics-not-identical'});
  }
  const stage3Stable=identity?.stage3ResultSha256===stage3Identity?.resultSha256
    &&same(identity?.stage3Identity,stage3Identity?.identity);
  const document={schemaVersion:1,decision:'STAGE4_LIFECYCLE_CAPTURE_COMPLETE',identity,
    coverage:{lifecycleCells:matrix.length,adjacentComparisons:EXPECTED_ADJACENT,repeatCells:repeats.length},
    render:require('./capture-supersynth-stage4-lifecycle.cjs').renderMetadata(root),matrix,repeats};
  const conformance=legacy({root,matrixPath:legacyMatrixPath,document});
  const conformancePass=conformance?.pass===true;
  const pass=cellFailures.length===0&&repeatFailures.length===0&&stage3Stable&&conformancePass;
  const decision=pass?'STAGE4_FULL_RANGE_COMPLETE':!stage3Stable?'BLOCKED_STAGE4_STAGE3_IDENTITY':cellFailures.length||repeatFailures.length?'BLOCKED_STAGE4_LIFECYCLE':'BLOCKED_STAGE4_CONFORMANCE';
  return {schemaVersion:1,decision,identity,coverage:{lifecycleCells:matrix.length,adjacentComparisons:EXPECTED_ADJACENT,repeatCells:repeats.length},
    counts:{lifecycleFailures:cellFailures.length,adjacentFailures:conformance?.adjacentFailures??null,velocityFailures:conformance?.velocityFailures??null,
      repeatPasses:repeats.length-repeatFailures.length,repeatFailures:repeatFailures.length},
    cellFailures:cellFailures.slice(0,100),repeatFailures,stage3IdentityStable:stage3Stable,legacyConformance:conformance};
}

module.exports={ROOT,EXPECTED_ADJACENT,LEGACY_TEST,same,rowKey,exactRows,safeRow,invokeLegacy,evaluate};
