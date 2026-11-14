#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {analyzeStereo,estimateExpectedPitch} = require('./salamander-metrics.cjs');

const sampleRate=48000;
const expectedHz=27.5;
const inharmonicity=0.02;
const frames=Math.floor(sampleRate*0.38);
const left=new Float64Array(frames);
const right=new Float64Array(frames);
const amplitudes=[1,6.2,0.125,0.0438,0.0264,0.021];
const partials=amplitudes.map((_,index)=>{
  const n=index+1;
  return n*expectedHz*Math.sqrt((1+inharmonicity*n*n)/(1+inharmonicity));
});

for(let i=0;i<frames;i++){
  const time=i/sampleRate;
  let sample=0;
  for(let n=0;n<partials.length;n++)sample+=amplitudes[n]*Math.sin(2*Math.PI*partials[n]*time);
  left[i]=sample;
  right[i]=sample;
}

const broadbandEstimate=estimateExpectedPitch(left,right,expectedHz,sampleRate,{startMs:20,endMs:350});
const measured=analyzeStereo(left,right,21,{sampleRate});
assert.ok(broadbandEstimate&&Math.abs(broadbandEstimate.cents)>40,'regression signal must expose upper-partial autocorrelation bias');
assert.ok(Math.abs(measured.pitchErrorCents)<=15,`expected-f0 measurement should recover A0, got ${measured.pitchErrorCents} cents`);
console.log('PASS expected-f0 pitch measurement',{
  broadbandAutocorrelationCents:broadbandEstimate.cents,
  measuredFundamentalHz:measured.fundamentalHz,
  measuredPitchErrorCents:measured.pitchErrorCents,
});

const midPitch=24;
const midExpectedHz=440*2**((midPitch-69)/12);
const midLeft=new Float64Array(frames);
const midRight=new Float64Array(frames);
const midPartials=amplitudes.map((_,index)=>{
  const n=index+1;
  return n*midExpectedHz*Math.sqrt((1+inharmonicity*n*n)/(1+inharmonicity));
});
for(let i=0;i<frames;i++){
  const time=i/sampleRate;
  let sample=0;
  for(let n=0;n<midPartials.length;n++)sample+=amplitudes[n]*Math.sin(2*Math.PI*midPartials[n]*time);
  midLeft[i]=sample;midRight[i]=sample;
}
const midAutocorrelation=estimateExpectedPitch(midLeft,midRight,midExpectedHz,sampleRate,{startMs:20,endMs:350});
const midMeasured=analyzeStereo(midLeft,midRight,midPitch,{sampleRate,includePitchDiagnostics:true});
assert.ok(midAutocorrelation&&Math.abs(midAutocorrelation.cents)>40,'mid-register regression signal must expose upper-partial autocorrelation bias');
assert.ok(Math.abs(midMeasured.pitchErrorCents)<=15,`confident expected-H1 measurement should recover MIDI ${midPitch}, got ${midMeasured.pitchErrorCents} cents`);
assert.equal(midMeasured.pitchDiagnostics.selectionMethod,'expected-f0-inharmonic-harmonic-comb');
assert.ok(midMeasured.pitchDiagnostics.harmonicCombConfidence>=0.3,'mid-register harmonic comb must have sufficient confidence');
console.log('PASS mid-register expected-f0 harmonic-comb measurement',{
  autocorrelationCents:midAutocorrelation.cents,
  measuredPitchErrorCents:midMeasured.pitchErrorCents,
  harmonicCombConfidence:midMeasured.pitchDiagnostics.harmonicCombConfidence,
});

const highPitch=102;
const highExpectedHz=440*2**((highPitch-69)/12);
const highFundamentalHz=highExpectedHz*2**(-4/1200);
const interferingToneHz=highExpectedHz*2**(-55/1200);
const highLeft=new Float64Array(frames);
const highRight=new Float64Array(frames);
for(let i=0;i<frames;i++){
  const time=i/sampleRate;
  const sample=Math.sin(2*Math.PI*highFundamentalHz*time)+Math.sin(2*Math.PI*interferingToneHz*time);
  highLeft[i]=sample;
  highRight[i]=sample;
}
const highAutocorrelation=estimateExpectedPitch(highLeft,highRight,highExpectedHz,sampleRate,{startMs:20,endMs:350});
const highMeasured=analyzeStereo(highLeft,highRight,highPitch,{sampleRate,includePitchDiagnostics:true});
assert.ok(highAutocorrelation&&Math.abs(highAutocorrelation.cents)>20,'regression signal must expose high-register autocorrelation bias');
assert.ok(Math.abs(highMeasured.pitchErrorCents)<=10,`confident H1 peak should correct high-register pitch, got ${highMeasured.pitchErrorCents} cents`);
assert.equal(highMeasured.pitchDiagnostics.selectionMethod,'confident-expected-fundamental-spectrum','resolved treble H1 should take precedence over harmonic-comb fitting');
console.log('PASS high-register pitch confidence fallback',{
  autocorrelationCents:highAutocorrelation.cents,
  measuredFundamentalHz:highMeasured.fundamentalHz,
  measuredPitchErrorCents:highMeasured.pitchErrorCents,
});
