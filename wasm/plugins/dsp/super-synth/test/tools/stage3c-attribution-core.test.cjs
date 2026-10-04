'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('./stage3c-attribution-core.cjs');

const f=core.factorial(0,2,6,10);
assert.deepEqual(f,{M0:0,MC:2,MB:6,MI:10,C_main:3,B_main:7,interaction:2,C_improvement:-3,B_improvement:-7});
for(const [c,b,expected] of [[1,1,'BOTH'],[1,0,'CONTACT'],[0,1,'BRIDGE'],[0,0,'NEITHER']])assert.equal(core.benefitOrigin(c,b),expected);
for(const [bySplit,fullI,expected] of [
  [{}, {}, 'NONE'],
  [{'mask-1:midi-36':{unsafeCellCount:1}}, {}, 'CONTACT'],
  [{'mask-2:midi-36':{unsafeCellCount:1}}, {}, 'BRIDGE'],
  [{'mask-1:midi-36':{unsafeCellCount:1},'mask-2:midi-36':{unsafeCellCount:1}}, {}, 'BOTH'],
  [{}, {'midi-36':{unsafeCellCount:1}}, 'INTERACTION']
])assert.equal(core.classifySafety(bySplit,fullI),expected);

function metrics(level,derivative=0){
  const m={envelopeDbfs:[-1,-2,-3,level,-5],spectralCentroidHz:level,above2kPowerRatio:level/100,
    peakDbfs:-2,fullRenderPeakDbfs:-1,finite:true,outputGuardHits:0,velocityDerivative:derivative,
    velocityDerivativeWindowMs:[30,180],stage2mHammer:{contactDurationSamples:level,peakForce:level*2,postContactTransverseEnergy:level*3},
    soundboardDiagnostics:{signals:{}}};
  for(const name of ['bridge_b','board_drive_b','post_radiation_l'])m.soundboardDiagnostics.signals[name]={rms:level,peak:level/2};
  return m;
}
const baseline=new Map();
for(const pitch of [...core.DYNAMIC_PITCHES,...core.TREBLE_PITCHES]){
  const velocities=core.DYNAMIC_PITCHES.includes(pitch)?core.DYNAMIC_VELOCITIES:core.TREBLE_VELOCITIES;
  for(const [i,velocity] of velocities.entries())baseline.set(`${pitch}:${velocity}`,{pitch,velocity,metrics:metrics(i)});
}
const supplement={rows:core.MIDI41_NORMALIZED.map((velocityNormalized,i)=>({pitch:41,velocity:null,velocityNormalized,metrics:metrics(i,.1+i*.1)}))};
const stage3bRows=[];
for(const pitch of [...core.DYNAMIC_PITCHES,...core.TREBLE_PITCHES]){
  const velocities=core.DYNAMIC_PITCHES.includes(pitch)?core.DYNAMIC_VELOCITIES:core.TREBLE_VELOCITIES;
  for(let i=0;i<velocities.length;i++)stage3bRows.push({pitch,velocity:velocities[i],stage3bMask:1,metrics:metrics(10+i,.2)});
}
for(let i=0;i<core.MIDI41_NORMALIZED.length;i++)stage3bRows.push({pitch:41,velocity:null,velocityNormalized:core.MIDI41_NORMALIZED[i],stage3bMask:1,metrics:metrics(10+i,.2+i*.1)});
const stage3bAnalysis={spanTables:core.DYNAMIC_PITCHES.map(pitch=>({pitch,stringCount:pitch<36?1:pitch<48?2:3,group:'test',
  spanByMask:{M0:{referenceSpanDb:15}}})),diagnosticRows:stage3bRows,
  trebleGuardrail:core.TREBLE_PITCHES.flatMap(pitch=>core.TREBLE_VELOCITIES.map(velocity=>({pitch,velocity,errors:{M0:{referenceDbfs:-20}}})))};
const stage3cRows=[];
for(const stage3cMask of [1,2])for(const pitch of [...core.DYNAMIC_PITCHES,...core.TREBLE_PITCHES]){
  const velocities=core.DYNAMIC_PITCHES.includes(pitch)?core.DYNAMIC_VELOCITIES:core.TREBLE_VELOCITIES;
  for(const [i,velocity] of velocities.entries())stage3cRows.push({cell:{kind:core.DYNAMIC_PITCHES.includes(pitch)?'dynamic':'treble',pitch,velocity,stage3cMask},
    metrics:metrics((stage3cMask===1?2:6)+i)});
}
for(const stage3cMask of [1,2])for(let i=0;i<core.MIDI41_NORMALIZED.length;i++)stage3cRows.push({cell:{kind:'midi41',pitch:41,velocity:null,velocityNormalized:core.MIDI41_NORMALIZED[i],stage3cMask},
  metrics:metrics(stage3cMask===1?2+i:6+i,.3+i*.1)});
assert.equal(stage3cRows.length,286);
const result=core.calculateAttribution({candidateId:'stage2n-r3-candidate-01',stage3aBaseline:baseline,stage3aSupplement:supplement,
  stage3bAnalysis,stage3cRows,stage3bAggregateCount:39,equivalenceSha256:'a'.repeat(64),continuationLedgerSha256:'b'.repeat(64),
  accounting:{cumulativeDiagnosticCalls:1180}});
assert.equal(result.decision,'STAGE3C_SPLIT_ATTRIBUTION_COMPLETE');
assert.equal(result.dynamicSpan.spanTables.length,8);
assert.equal(result.dynamicSpan.spanTables[0].spanByMask.M0.synthSpanDb,15);
assert.equal(result.dynamicSpan.spanTables[0].spanByMask.M0.referenceSpanDb,15);
assert.equal(result.dynamicSpan.spanTables.find(row=>row.pitch===51).benefitOrigin,'NEITHER');
assert.equal(result.trebleGuardrail.length,12);
assert.equal(result.midi41.length,3);
assert.deepEqual(result.midi41[0].velocityDerivativeWindowMs,[30,180]);
assert.equal(result.pathAttribution.contactDurationSamples.cellCount,143);
assert.equal(result.pathAttribution.contactDurationSamples.C_main,3);
assert.equal(result.pathAttribution.contactDurationSamples.B_main,7);
assert.equal(result.pathAttribution.contactDurationSamples.interaction,2);
assert.equal(Object.keys(result.pathAttribution).length,8);
assert.equal(result.ledgerSha256,'b'.repeat(64));
const source=fs.readFileSync(path.join(__dirname,'stage3c-attribution-core.cjs'),'utf8');
assert.doesNotMatch(source,/\.agent-state/);
console.log(JSON.stringify({pass:true,checks:18,syntheticRows:stage3cRows.length,pathMetrics:Object.keys(result.pathAttribution).length}));
