'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runner=require('./run-stage3c-equivalence-correction-and-split.cjs');
const original=require('./run-stage3c-impedance-split-diagnostic.cjs');

assert.throws(()=>runner.modes([]),/explicit mode required/);
assert.throws(()=>runner.modes(['--equivalence']),/explicit mode required/);
assert.throws(()=>runner.modes(['--execute','--finalize']),/explicit mode required/);
for(const mode of ['--dry-run','--correct-equivalence','--execute','--finalize'])assert.equal(runner.modes([mode]),mode);

const correction=runner.correctionCells();
assert.equal(correction.length,1);
assert.deepEqual(correction[0],{kind:'midi41',pitch:41,velocity:null,velocityNormalized:.25,stage3cMask:0});
assert.equal(runner.correctionKey(),'midi-041-normalized-025-mask-0');
assert.equal(runner.splitCells().length,286);
assert.deepEqual([...new Set(runner.splitCells().map(cell=>cell.stage3cMask))],[1,2]);
assert.equal(runner.splitCells().filter(cell=>cell.kind==='dynamic').length,256);
assert.equal(runner.splitCells().filter(cell=>cell.kind==='treble').length,24);
assert.equal(runner.splitCells().filter(cell=>cell.kind==='midi41').length,6);
assert.equal(new Set(runner.splitCells().map(original.keyOf)).size,286);

const historical=runner.historical();
assert.equal(historical.rows.length,20);
assert.equal(historical.passedRows.length,19);
assert.equal(historical.failed.cell.pitch,41);
assert.equal(historical.failed.cell.velocityNormalized,.25);
assert.equal(historical.failed.cell.stage3cMask,0);
assert.match(historical.failed.error,/velocityDerivativeWindowMs/);
assert.equal(runner.historicalBuildIdentity().id.aggregateCount,39);
assert.equal(runner.EXPECTED.stage3cWasm,'387c12fa16f684435f904a9c18c063099141332b53b28cd5cbd35bca15482235');

function metrics(){
  const value={envelopeDbfs:[-1,-2,-3,-4,-5],spectralCentroidHz:3000,above2kPowerRatio:.25,peakDbfs:-3,
    fullRenderPeakDbfs:-2,finite:true,outputGuardHits:0,velocityDerivative:.1,velocityDerivativeWindowMs:[30,180],
    stage2mFactorMask:3,stage3cVariantMask:0,
    stage2mHammer:{effectiveHardness:.1,initialHammerVelocity:2,contactDurationSamples:3,peakForce:4,maxCompression:5,postContactTransverseEnergy:6},
    soundboardDiagnostics:{frames:7680,signals:{}}};
  for(const name of original.DIAGNOSTIC_SIGNALS)value.soundboardDiagnostics.signals[name]={rms:.01,peak:.1};
  return value;
}
const good=metrics(),reference={metrics:metrics()};
assert.equal(runner.compareCorrection(good,reference).pass,true);
for(const [mutate,pattern] of [
  [m=>m.velocityDerivativeWindowMs=[0,160],/window capture mismatch/],
  [m=>m.stage3cVariantMask=3,/mask\/window capture mismatch/],
  [m=>m.stage2mFactorMask=2,/mask\/window capture mismatch/]
]){const bad=metrics();mutate(bad);assert.throws(()=>runner.compareCorrection(bad,reference),pattern);}
const outOfTolerance=metrics();outOfTolerance.spectralCentroidHz+=1.000001e-6;
assert.equal(runner.compareCorrection(outOfTolerance,reference).pass,false);

const identity={schemaVersion:1,candidateId:runner.CANDIDATE,sourceRevision:'test',continuationRunnerSha256:'a'.repeat(64)};
const corrLedger=runner.correctionLedger(identity);
assert.deepEqual(runner.stateCounts(corrLedger),{PENDING:1,IN_PROGRESS:0,COMPLETE:0});
assert.deepEqual(runner.validateLedger(corrLedger,identity,'correction',1),{PENDING:1,IN_PROGRESS:0,COMPLETE:0});
corrLedger.accounting.newRenderCalls=1;corrLedger.cells[runner.CORRECTION_KEY].state='COMPLETE';
assert.deepEqual(runner.validateLedger(corrLedger,identity,'correction',1),{PENDING:0,IN_PROGRESS:0,COMPLETE:1});
corrLedger.cells[runner.CORRECTION_KEY].state='IN_PROGRESS';
assert.throws(()=>runner.validateLedger(corrLedger,identity,'correction',1),/ambiguous IN_PROGRESS/);
const splitLedger=runner.continuationLedger(identity,'b'.repeat(64));
assert.deepEqual(runner.stateCounts(splitLedger),{PENDING:286,IN_PROGRESS:0,COMPLETE:0});
assert.equal(Object.keys(splitLedger.cells).length,286);
assert.equal(splitLedger.correctedEquivalenceSha256,'b'.repeat(64));

const syntheticHist={passedRows:historical.passedRows};
const corrected=runner.correctedResult(syntheticHist,{sha256:'c'.repeat(64),comparison:{pass:true,maxMetricDifference:0}},
  {...identity,historicalFailedCellSha256:'d'.repeat(64)},'e'.repeat(64));
assert.equal(corrected.decision,'STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE');
assert.equal(corrected.historicalPassCount,19);
assert.equal(corrected.correctionPassCount,1);
assert.equal(corrected.effectiveEquivalenceCellCount,20);
assert.equal(corrected.rows.length,20);
assert.equal(corrected.historicalFailedCellSha256,'d'.repeat(64));
assert.equal(corrected.maxMetricDifference,0);

const baselineFiles=[
  '.agent-state/issues/7/stage3c/equivalence/ledger.json',
  '.agent-state/issues/7/stage3c/equivalence.json',
  '.agent-state/issues/7/stage3c/build-identity.json',
  'build/wasm-stage3c/plugins/dsp/super-synth/plugin.wasm'
];
const before=baselineFiles.map(file=>fs.readFileSync(path.join(runner.ROOT,file)));
for(let i=0;i<baselineFiles.length;i++)assert.deepEqual(fs.readFileSync(path.join(runner.ROOT,baselineFiles[i])),before[i]);

const plan=runner.dryRun();
assert.equal(plan.builds,0);
assert.equal(plan.renders,0);
assert.equal(plan.acousticRenders,0);
assert.equal(plan.historicalEquivalenceRenders,20);
assert.equal(plan.historicalValidRows,19);
assert.equal(plan.historicalInvalidRows,1);
assert.equal(plan.correctionAuthorized,1);
assert.equal(plan.splitAuthorized,286);
assert.equal(plan.maximumNewCalls,287);

console.log(JSON.stringify({pass:true,historicalPasses:19,historicalFailures:1,correctionRendersAuthorized:1,splitCells:286,dryRunRenders:plan.renders}));
