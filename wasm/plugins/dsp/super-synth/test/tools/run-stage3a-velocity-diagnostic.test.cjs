'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {MASK,EQUIVALENCE_CELLS,MATRIX_PITCHES,VELOCITIES,MIDI41_NORMALIZED,
  assertFixedCells,assertMask,compareEquivalence,gainDecomposition,assertHammerInvariants,assertSupplementalCells,
  validateSupplementalRow,MIDI41_EXPECTED_DERIVATIVE,DIAGNOSTIC_SIGNALS,RECOVERY_BASELINE_HEAD,
  RECOVERY_AUTHORIZED_CELLS,assertRecoveryAuthorization,assertRecoveryCell,makeRecoveryLedger,recoveryCounts,
  recoveryPaths,cellFilePath,inspectRecoveryState,runRecovery}
  =require('./run-stage3a-velocity-diagnostic.cjs');

assert.equal(MASK,3);
assert.deepEqual(EQUIVALENCE_CELLS,[[36,14],[36,124],[51,14],[51,124],[96,31],[96,124]]);
assert.equal(MATRIX_PITCHES.length*VELOCITIES.length+MIDI41_NORMALIZED.length,195);
assert.deepEqual(MIDI41_NORMALIZED,[0.25,0.55,0.9]);
const supplemental=MIDI41_NORMALIZED.map(velocityNormalized=>({pitch:41,velocityNormalized}));
assert.doesNotThrow(()=>assertSupplementalCells(supplemental));
assert.throws(()=>assertSupplementalCells(supplemental.slice(0,2)),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([...supplemental,supplemental[0]]),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([{pitch:40,velocityNormalized:.25},...supplemental.slice(1)]),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([{pitch:41,velocityNormalized:.25},{pitch:41,velocityNormalized:.55},{pitch:41,velocityNormalized:.91}]),/exactly MIDI 41/);
assert.throws(()=>assertSupplementalCells([...supplemental].reverse()),/exactly MIDI 41/);

function midi41Row(index,derivative=MIDI41_EXPECTED_DERIVATIVE[index],window=[30,180]){
  return {pitch:41,velocityNormalized:MIDI41_NORMALIZED[index],metrics:{
    stage2mFactorMask:3,stage2mHammer:{effectiveHardness:.3,initialHammerVelocity:.7,contactDurationSamples:120,
      peakForce:20,maxCompression:.0005,postContactTransverseEnergy:100},
    velocityDerivative:derivative,velocityDerivativeWindowMs:window,envelopeDbfs:[-40,-39,-38,-37,-36],
    peakDbfs:-12,fullRenderPeakDbfs:-11.9,finite:true,outputGuardHits:0,
    soundboardDiagnostics:{signals:Object.fromEntries(DIAGNOSTIC_SIGNALS.map(name=>[name,{rms:.01,peak:.02}]))}
  }};
}
assert.equal(validateSupplementalRow(midi41Row(0),0).equivalencePass,true);
assert.equal(validateSupplementalRow(midi41Row(1,MIDI41_EXPECTED_DERIVATIVE[1]+0.9e-6),1).equivalencePass,true);
assert.equal(validateSupplementalRow(midi41Row(2,MIDI41_EXPECTED_DERIVATIVE[2]+1.1e-6),2).equivalencePass,false);
assert.throws(()=>validateSupplementalRow(midi41Row(0,MIDI41_EXPECTED_DERIVATIVE[0],[0,160]),0),/30–180 ms/);
assert.throws(()=>validateSupplementalRow({...midi41Row(0),metrics:{...midi41Row(0).metrics,outputGuardHits:1}},0),/acoustic\/safety diagnostics/);

const cells=MATRIX_PITCHES.flatMap(pitch=>VELOCITIES.map(velocity=>({pitch,velocity})));
assert.doesNotThrow(()=>assertFixedCells(cells));
assert.throws(()=>assertFixedCells(cells.slice(1)),/exactly the 192/);
assert.throws(()=>assertFixedCells([...cells,cells[0]]),/exactly the 192/);

assert.doesNotThrow(()=>assertMask({stage2mFactorMask:3,stage2mHammer:{}}));
assert.throws(()=>assertMask({stage2mFactorMask:1,stage2mHammer:{}}),/requires Stage2M factor mask 3/);
assert.throws(()=>assertMask({stage2mFactorMask:3}),/requires Stage2M factor mask 3/);

const production={envelopeDbfs:[-20,-21,-22,-23,-24],spectralCentroidHz:1000,above2kPowerRatio:.2,
  peakDbfs:-8,finite:true,outputGuardHits:0};
const within={...production,envelopeDbfs:[...production.envelopeDbfs],spectralCentroidHz:1000+5e-7};
assert.equal(compareEquivalence(production,within).pass,true);
assert.ok(compareEquivalence(production,{...within,peakDbfs:-7.999998}).pass===false);

const d14=gainDecomposition(-30,14/127,.7,.3);
const d124=gainDecomposition(-10,124/127,.7,.3);
assert.ok(Math.abs((d124.velocityGainDb-d14.velocityGainDb)-2.635308)<1e-5);
assert.ok(d14.preOutputGainEquivalentDb!==-30);

const invariantRows=[];
for(const pitch of [33,36,39]) for(const velocity of [14,124]) invariantRows.push({pitch,velocity,metrics:{stage2mHammer:{effectiveHardness:.4,initialHammerVelocity:1.2}}});
assert.ok(assertHammerInvariants(invariantRows).every(row=>row.pass));
invariantRows[0].metrics.stage2mHammer.effectiveHardness=.40001;
assert.throws(()=>assertHammerInvariants(invariantRows),/not pitch-invariant/);

assert.equal(RECOVERY_BASELINE_HEAD,'90dac1247560c16b274eadbde3977baacdc5f149');
assert.equal(RECOVERY_AUTHORIZED_CELLS.length,192);
assert.doesNotThrow(()=>assertRecoveryAuthorization(RECOVERY_AUTHORIZED_CELLS));
assert.throws(()=>assertRecoveryAuthorization(RECOVERY_AUTHORIZED_CELLS.slice(1)),/exactly the 192/);
assert.throws(()=>assertRecoveryAuthorization([...RECOVERY_AUTHORIZED_CELLS,RECOVERY_AUTHORIZED_CELLS[0]]),/exactly the 192/);
assert.throws(()=>assertRecoveryAuthorization(RECOVERY_AUTHORIZED_CELLS.map((cell,index)=>index===0?{...cell,factorMask:1}:cell)),/factor mask 3/);
assert.ok(!RECOVERY_AUTHORIZED_CELLS.some(cell=>cell.pitch===41));

const recoveryIdentity={sourceRevision:RECOVERY_BASELINE_HEAD,candidateId:'stage2n-r3-candidate-01',productionSimd:true,
  productionWasmSha256:'a'.repeat(64),diagnosticWasmSha256:'b'.repeat(64),configSha256:'c'.repeat(64),
  profileSha256:'d'.repeat(64),presetsSha256:'e'.repeat(64),referenceFixtureSha256:'f'.repeat(64)};
function recoveryMetrics(){return {stage2mFactorMask:3,
  stage2mHammer:{effectiveHardness:.3,initialHammerVelocity:.7,contactDurationSamples:120,peakForce:20,maxCompression:.0005,postContactTransverseEnergy:100},
  envelopeDbfs:[-40,-39,-38,-37,-36],spectralCentroidHz:1000,above2kPowerRatio:.2,peakDbfs:-12,
  fullRenderPeakDbfs:-11.9,finite:true,outputGuardHits:0,velocityDerivative:.1,velocityDerivativeWindowMs:[0,160],
  soundboardDiagnostics:{signals:Object.fromEntries(DIAGNOSTIC_SIGNALS.map(name=>[name,{rms:.01,peak:.02}]))}};}
const recoverySample={schemaVersion:1,candidateId:'stage2n-r3-candidate-01',sourceRevision:RECOVERY_BASELINE_HEAD,
  pitch:33,velocity:14,velocityNormalized:14/127,factorMask:3,productionWasmSha256:recoveryIdentity.productionWasmSha256,
  diagnosticWasmSha256:recoveryIdentity.diagnosticWasmSha256,configSha256:recoveryIdentity.configSha256,
  profileSha256:recoveryIdentity.profileSha256,presetsSha256:recoveryIdentity.presetsSha256,
  referenceFixtureSha256:recoveryIdentity.referenceFixtureSha256,metrics:recoveryMetrics()};
assert.doesNotThrow(()=>assertRecoveryCell(recoverySample,recoveryIdentity));
assert.throws(()=>assertRecoveryCell({...recoverySample,factorMask:1},recoveryIdentity),/outside the authorized matrix/);
const initialLedger=makeRecoveryLedger(recoveryIdentity);
assert.deepEqual(recoveryCounts(initialLedger),{PENDING:192,IN_PROGRESS:0,COMPLETE:0});

function withRecoveryRoot(callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3a-recovery-test-'));
  try{return callback(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
withRecoveryRoot(root=>{
  const dry=runRecovery({root,mode:'dry-run',identityOverride:recoveryIdentity});
  assert.equal(dry.renders,0);assert.equal(dry.authorizedIdentities,192);
  assert.equal(fs.existsSync(recoveryPaths(root).ledger),false);
});

withRecoveryRoot(root=>{
  let calls=0;
  assert.throws(()=>runRecovery({root,mode:'execute',identityOverride:recoveryIdentity,renderFn:()=>{calls++;return recoveryMetrics();},
    failurePoint:point=>{if(point==='after-in-progress')throw new Error('injected-before-render');}}),/injected-before-render/);
  assert.equal(calls,0);
  assert.throws(()=>runRecovery({root,mode:'dry-run',identityOverride:recoveryIdentity}),/AMBIGUOUS_RENDER_ACCOUNTING/);
});

withRecoveryRoot(root=>{
  let calls=0;
  assert.throws(()=>runRecovery({root,mode:'execute',identityOverride:recoveryIdentity,renderFn:()=>{calls++;return recoveryMetrics();},
    failurePoint:point=>{if(point==='after-cell-write')throw new Error('injected-after-cell-write');}}),/injected-after-cell-write/);
  assert.equal(calls,1);
  const ledger=JSON.parse(fs.readFileSync(recoveryPaths(root).ledger,'utf8'));
  const first=ledger.cells['33:14'];
  assert.equal(first.state,'IN_PROGRESS');
  assert.equal(fs.existsSync(cellFilePath(recoveryPaths(root),33,14)),true);
  assert.throws(()=>inspectRecoveryState(recoveryPaths(root),recoveryIdentity),/AMBIGUOUS_RENDER_ACCOUNTING/);
});

withRecoveryRoot(root=>{
  let calls=0;
  assert.throws(()=>runRecovery({root,mode:'execute',identityOverride:recoveryIdentity,renderFn:()=>{calls++;return recoveryMetrics();},
    failurePoint:(point,cell)=>{if(point==='after-complete'&&cell.pitch===33&&cell.velocity===14)throw new Error('injected-after-complete');}}),/injected-after-complete/);
  assert.equal(calls,1);
  const resumedCalls=[];
  assert.throws(()=>runRecovery({root,mode:'execute',identityOverride:recoveryIdentity,
    renderFn:(pitch,velocity)=>{resumedCalls.push(`${pitch}:${velocity}`);return recoveryMetrics();},
    failurePoint:(point,cell)=>{if(point==='after-complete'&&cell.pitch===33&&cell.velocity===31)throw new Error('injected-between-cells');}}),/injected-between-cells/);
  assert.deepEqual(resumedCalls,['33:31']);
});

withRecoveryRoot(root=>{
  const paths=recoveryPaths(root),ledger=makeRecoveryLedger(recoveryIdentity),row={...recoverySample};
  fs.mkdirSync(paths.cells,{recursive:true});
  fs.writeFileSync(cellFilePath(paths,33,14),JSON.stringify(row));
  ledger.cells['33:14']={...ledger.cells['33:14'],state:'COMPLETE',path:path.relative(path.dirname(paths.ledger),cellFilePath(paths,33,14)),sha256:'0'.repeat(64)};
  fs.mkdirSync(path.dirname(paths.ledger),{recursive:true});fs.writeFileSync(paths.ledger,JSON.stringify(ledger));
  assert.throws(()=>inspectRecoveryState(paths,recoveryIdentity),/hash\/path mismatch/);
});

withRecoveryRoot(root=>{
  const paths=recoveryPaths(root),ledger=makeRecoveryLedger(recoveryIdentity);
  ledger.cells['33:14']={...ledger.cells['33:14'],state:'COMPLETE',path:'cells/midi-033-velocity-014.json',sha256:'0'.repeat(64)};
  fs.mkdirSync(path.dirname(paths.ledger),{recursive:true});fs.writeFileSync(paths.ledger,JSON.stringify(ledger));
  assert.throws(()=>inspectRecoveryState(paths,recoveryIdentity),/COMPLETE cell missing/);
});

withRecoveryRoot(root=>{
  let initialCalls=0;
  assert.throws(()=>runRecovery({root,mode:'execute',identityOverride:recoveryIdentity,
    renderFn:()=>{initialCalls++;return recoveryMetrics();},
    failurePoint:(point,cell)=>{if(point==='after-complete'&&cell.pitch===33&&cell.velocity===124)throw new Error('injected-between-pitches');}}),/injected-between-pitches/);
  assert.equal(initialCalls,16);
  const resumedCalls=[];
  const resumed=runRecovery({root,mode:'execute',identityOverride:recoveryIdentity,
    renderFn:(pitch,velocity)=>{resumedCalls.push(`${pitch}:${velocity}`);return recoveryMetrics();}});
  assert.equal(resumed.newRenderCalls,176);
  assert.equal(resumed.counts.COMPLETE,192);
  assert.equal(resumedCalls.includes('33:14'),false);
  assert.equal(fs.existsSync(path.join(recoveryPaths(root).pitches,'midi-033.json')),true);
});

withRecoveryRoot(root=>{
  const paths=recoveryPaths(root),ledger=makeRecoveryLedger(recoveryIdentity);
  assert.throws(()=>runRecovery({root,mode:'finalize',identityOverride:recoveryIdentity}),/persisted 0\/192/);
});

console.log('PASS Stage3A diagnostic cell, mask, equivalence, gain and hammer-invariant checks');
