#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');

assert.equal(capture.PITCHES.length,88);
assert.equal(capture.VELOCITIES.length,16);
assert.equal(capture.LIFECYCLE_CELLS.length,1408);
assert.equal(capture.REPEAT_CELLS.length,15);
assert.equal(new Set(capture.LIFECYCLE_CELLS.map(capture.key)).size,1408);
assert.equal(new Set(capture.REPEAT_CELLS.map(capture.key)).size,15);
assert.doesNotThrow(()=>capture.assertExactCells(capture.LIFECYCLE_CELLS));
assert.throws(()=>capture.assertExactCells(capture.LIFECYCLE_CELLS.slice(1)),/BLOCKED_STAGE4_CAPTURE_COVERAGE/);

let active=0,guard=0;const events=[];
const harness={
  e:{soraoto_supersynth_active_voice_count:()=>active,soraoto_supersynth_guard_hit_count:()=>guard},
  applyPreset:()=>{},setPlain:()=>{},
  process(frames,{events:batch=[]}={}){
    for(const event of batch){events.push(event.kind);if(event.kind===1)active=1;if(event.kind===2)active=0;}
    return [[new Float32Array(frames).fill(.1),new Float32Array(frames).fill(.1)]];
  },close(){}
};
const row=capture.captureLifecycleCell({pitch:60,velocity:61,repoRoot:'/unused',holdMs:20,releaseLimitMs:50,blockSize:128,
  createHarness:()=>harness,analyze:()=>({peakDbfs:-20,envelopeDbfs:[-20,-20,-20,-20,-20]}),
  estimatePitch:()=>({measurement_valid:true,pitch_error_cents:0}),now:()=> '2000-01-01T00:00:00.000Z'});
assert.deepEqual(events,[1,2]);
assert.equal(row.metrics.lifecycle.noteOnProcessed,true);
assert.equal(row.metrics.lifecycle.noteOffProcessed,true);
assert.equal(row.metrics.lifecycle.postReleaseProcessed,true);
assert.equal(row.metrics.lifecycle.finalActiveVoiceCount,0);
assert.equal(row.metrics.lifecycle.releasedWithinLimit,true);
assert.equal(row.metrics.outputGuardHits,0);
assert.equal(row.metrics.finiteThroughout,true);
assert.equal(row.metrics.postReleaseFinite,true);
assert.equal(Object.hasOwn(row.metrics,'capturedAt'),false);

process.stdout.write('PASS Stage4 lifecycle capture tests\n');
