#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const {getPianoPitchAnalysisPlan}=require('./piano-pitch-estimator.cjs');

const pitches=[21,36,48,60,72,84,96,108];
for(const pitch of pitches){
  const shortBlock=getPianoPitchAnalysisPlan(pitch,{sampleRate:48000,blockSize:128,minimumDurationMs:1600});
  const matrixBlock=getPianoPitchAnalysisPlan(pitch,{sampleRate:48000,blockSize:2048,minimumDurationMs:1600});
  assert.equal(shortBlock.windows.length,2,`MIDI ${pitch} has two shared analysis windows`);
  assert.deepEqual(shortBlock.windows,matrixBlock.windows,`MIDI ${pitch} shares its windows across renderers`);
  for(const plan of [shortBlock,matrixBlock]){
    const maxWindowFrames=Math.ceil(plan.maximumWindowEndMs*plan.sampleRate/1000);
    assert.equal(plan.requiredFrames%plan.blockSize,0,`MIDI ${pitch} duration aligns to the render block`);
    assert.ok(plan.requiredFrames>=maxWindowFrames+plan.alignmentMarginFrames,`MIDI ${pitch} includes window and block margin`);
    assert.ok(plan.requiredDurationMs>=1600,`MIDI ${pitch} retains the previously qualified minimum duration`);
  }
  assert.deepEqual(shortBlock,getPianoPitchAnalysisPlan(pitch,{sampleRate:48000,blockSize:128,minimumDurationMs:1600}),`MIDI ${pitch} policy is deterministic`);
}

process.stdout.write(JSON.stringify({pitches:pitches.length,plans:pitches.length*2,result:'PASS'})+'\n');
