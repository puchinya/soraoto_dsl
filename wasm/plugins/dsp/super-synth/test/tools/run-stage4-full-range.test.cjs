#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-stage4-full-range.cjs');
const durable=require('./durable-evidence.cjs');
const capture=require('./capture-supersynth-stage4-lifecycle.cjs');

const identity={schemaVersion:1,task:'stage4',executionId:'authoritative',stage3ResultSha256:'a'.repeat(64),diagnosticWasmSha256:'b'.repeat(64)};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage4-runner-test-'));
const roots={primary:path.join(temp,'primary'),secondary:path.join(temp,'secondary')};
assert.equal(runner.MAIN_COUNT,1408);
assert.equal(runner.REPEAT_COUNT,15);
assert.equal(runner.CELL_COUNT,1423);
assert.equal(runner.exactCells().length,1423);
assert.throws(()=>runner.exactCells(capture.LIFECYCLE_CELLS),/BLOCKED_STAGE4_CAPTURE_COVERAGE/);
assert.equal(runner.counts(runner.freshLedger(identity)).PENDING,1423);

const safeMetrics={finite:true,finiteThroughout:true,finiteRelease:true,postReleaseFinite:true,outputGuardHits:0,peakDbfs:-8,fullRenderPeakDbfs:-7,
  pitchMeasurement:{measurement_valid:true,pitch_error_cents:0},
  lifecycle:{noteOffProcessed:true,releasedWithinLimit:true,inactiveAfterNoteOffMs:100,postReleaseProcessed:true,finalActiveVoiceCount:0,guardHits:0,postReleaseFinite:true}};
const original=durable.writeDualCopy;
try{
  durable.writeDualCopy=(a,b,bytes)=>{const data=Buffer.from(bytes);return {sizeBytes:data.length,sha256:runner.sha256(data)};};
  const ledger=runner.freshLedger(identity),first=runner.exactCells()[0];
  ledger.cells[runner.key(first)].state='COMPLETE';ledger.cells[runner.key(first)].sha256='existing';let renders=0;
  const complete=runner.execute({roots,identity,ledger,identityNow:()=>identity,
    render:(_root,cell)=>{renders++;return {pitch:cell.pitch,velocity:cell.velocity,metrics:safeMetrics};},now:()=> '2000-01-01T00:00:00.000Z'});
  assert.equal(complete.calls,1422);assert.equal(renders,1422);assert.equal(complete.COMPLETE,1423);
  assert.equal(ledger.cells[runner.key(first)].sha256,'existing');

  const blocked=runner.freshLedger(identity);let called=false;
  assert.throws(()=>runner.execute({roots,identity,ledger:blocked,identityNow:()=>({...identity,diagnosticWasmSha256:'c'.repeat(64)}),render:()=>{called=true;}}),/BLOCKED_STAGE4_IDENTITY/);
  assert.equal(called,false);assert.equal(runner.counts(blocked).IN_PROGRESS,0);
  assert.throws(()=>runner.execute({roots,identity,ledger:blocked,identityNow:()=>identity,assertAuthorization:()=>{throw new Error('identity changed');},render:()=>{called=true;}}),/identity changed/);
  assert.equal(called,false);assert.equal(runner.counts(blocked).IN_PROGRESS,0);
}finally{durable.writeDualCopy=original;fs.rmSync(temp,{recursive:true,force:true});}

process.stdout.write('PASS Stage4 full-range runner tests\n');
