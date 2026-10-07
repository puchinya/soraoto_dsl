#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');
const evaluator=require('./stage4-full-range-evaluator.cjs');

function metrics(){return {finite:true,finiteThroughout:true,finiteRelease:true,postReleaseFinite:true,outputGuardHits:0,peakDbfs:-6,fullRenderPeakDbfs:-5,
  pitchMeasurement:{measurement_valid:true,pitch_error_cents:0},
  lifecycle:{noteOffProcessed:true,releasedWithinLimit:true,inactiveAfterNoteOffMs:120,postReleaseProcessed:true,finalActiveVoiceCount:0,guardHits:0,postReleaseFinite:true}};}
const matrix=capture.LIFECYCLE_CELLS.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,metrics:metrics()}));
const by=new Map(matrix.map(row=>[`${row.pitch}:${row.velocity}`,row]));
const repeats=capture.REPEAT_CELLS.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,metrics:JSON.parse(JSON.stringify(by.get(`${cell.pitch}:${cell.velocity}`).metrics))}));
const identity={stage3ResultSha256:'a'.repeat(64),stage3Identity:{sourceRevision:'x',wasmSha256:'b'.repeat(64)}};
const stage3Identity={resultSha256:identity.stage3ResultSha256,identity:identity.stage3Identity};
const passing=evaluator.evaluate({identity,stage3Identity,matrix,repeats,legacy:()=>({pass:true,status:0,stdout:'PASS legacy',stderr:''})});
assert.equal(passing.decision,'STAGE4_FULL_RANGE_COMPLETE');
assert.deepEqual(passing.coverage,{lifecycleCells:1408,adjacentComparisons:1392,repeatCells:15});
assert.equal(passing.counts.lifecycleFailures,0);
assert.equal(passing.counts.repeatFailures,0);

const pitchFail=matrix.map(row=>({...row,metrics:row.pitch===21&&row.velocity===14?{...row.metrics,pitchMeasurement:{measurement_valid:false,pitch_error_cents:40}}:row.metrics}));
const failed=evaluator.evaluate({identity,stage3Identity,matrix:pitchFail,repeats,legacy:()=>({pass:true,status:0})});
assert.equal(failed.decision,'BLOCKED_STAGE4_LIFECYCLE');
const repeatFail=repeats.map((row,i)=>i===0?{...row,metrics:{...row.metrics,fullRenderPeakDbfs:-4}}:row);
assert.equal(evaluator.evaluate({identity,stage3Identity,matrix,repeats:repeatFail,legacy:()=>({pass:true,status:0})}).decision,'BLOCKED_STAGE4_LIFECYCLE');
assert.equal(evaluator.evaluate({identity,stage3Identity,matrix,repeats,legacy:()=>({pass:false,status:1,stderr:'legacy gate'})}).decision,'BLOCKED_STAGE4_CONFORMANCE');
assert.throws(()=>evaluator.evaluate({identity,stage3Identity,matrix:matrix.slice(1),repeats,legacy:()=>({pass:true})}),/BLOCKED_STAGE4_EVIDENCE/);
assert.equal(evaluator.safeRow({...matrix[0],metrics:{...matrix[0].metrics,fullRenderPeakDbfs:0}}).includes('peak'),true);

process.stdout.write('PASS Stage4 full-range evaluator tests\n');
