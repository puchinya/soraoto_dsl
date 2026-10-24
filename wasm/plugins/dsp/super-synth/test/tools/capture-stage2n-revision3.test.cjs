'use strict';

const assert=require('node:assert/strict');
const {CELLS,assertCellCoverage,summarize}=require('./capture-stage2n-revision3.cjs');

assert.equal(CELLS.length,18);
assert.equal(new Set(CELLS.map(cell=>`${cell.pitch}:${cell.velocity}`)).size,18);
assert.doesNotThrow(()=>assertCellCoverage(CELLS.map(cell=>({pitch:cell.pitch,velocity:cell.velocity}))));
assert.throws(()=>assertCellCoverage(CELLS.slice(1).map(cell=>({pitch:cell.pitch,velocity:cell.velocity}))),/exactly 18/);
assert.throws(()=>assertCellCoverage([...CELLS.slice(0,-1),CELLS[0]].map(cell=>({pitch:cell.pitch,velocity:cell.velocity}))),/coverage\/order/);

const envelope=(a,b,c,d,e)=>[a,b,c,d,e];
const rows=CELLS.map(({pitch,velocity})=>({pitch,velocity,metrics:{
  envelopeDbfs:pitch===45?envelope(0,0,-30+velocity/100,-40+velocity/100,-50+velocity/100):envelope(0,0,-32,-42,-52),
  finite:true,peakDbfs:-12,fullRenderPeakDbfs:-11,outputGuardHits:0,
  pitchMeasurement:pitch===21?{pitch_error_cents:29,measurement_valid:true}:null,
  nearFundamentalProbe:pitch===21?{cents:13.0,frequencyHz:27.7}:null,
}}));
const reference={directCells:CELLS.map(({pitch,velocity})=>({pitch,velocity,metrics:{envelopeDbfs:pitch===45?envelope(0,0,-30+velocity/100,-40+velocity/100,-50+velocity/100):envelope(0,0,-32,-42,-52)}}))};
const result=summarize({matrix:rows},reference);
assert.equal(result.cellCount,18);
assert.equal(result.finite,true);
assert.equal(result.guardHits,0);
assert.equal(result.midi21.currentEstimatorCents,29);
assert.equal(result.midi21.constrainedNearFundamentalCents,13);
console.log('PASS Stage2N exact 18-cell coverage and summary');
