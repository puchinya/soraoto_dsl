'use strict';

const assert = require('node:assert/strict');
const {estimatePianoPitch, midiToHz, getPianoPitchAnalysisPlan,
  PITCH_ESTIMATOR_REVISION, LOW_REGISTER_FFT_SIZE, LOW_REGISTER_AGREEMENT_CENTS,
  recoverSpectralBaseF0, classifyLowRegisterWindows, estimateSingleWindow} = require('./piano-pitch-estimator.cjs');
const {spectrum, peakNearExpected, spectralPeakProminence} = require('./salamander-metrics.cjs');

const SAMPLE_RATE = 48000;
const FRAME_COUNT = Math.floor(SAMPLE_RATE * 1.6);
const PITCHES = [21, 36, 48, 60, 72, 84, 96, 108];
const OFFSETS = [-15, 0, 15];
const INHARMONICITY = [0, 0.001, 0.005, 0.02];

function fixture(pitch, offsetCents, B, variant, profile = {}) {
  const left = new Float64Array(FRAME_COUNT);
  const right = new Float64Array(FRAME_COUNT);
  const expectedHz = midiToHz(pitch);
  const injectedHz = expectedHz * 2 ** (offsetCents / 1200);
  const weakFundamental = expectedHz <= 3000 && variant % 2 === 0;
  const partials = [];
  for (let n = 1; n <= 8; n++) {
    let frequency = injectedHz * n * Math.sqrt(1 + B * n * n);
    if (frequency >= SAMPLE_RATE * 0.45) break;
    let amplitude = 1 / n ** 1.25;
    if (weakFundamental && n === 1) amplitude = 0.018;
    if (weakFundamental && n === 2) amplitude = 0.72;
    if (weakFundamental && n === 3) amplitude = 0.82;
    if (profile.amplitudes) amplitude = profile.amplitudes[n] ?? 0;
    if (profile.outlier?.partial === n) frequency *= 2 ** (profile.outlier.cents / 1200);
    partials.push({n, frequency, amplitude});
  }
  for (let i = 0; i < FRAME_COUNT; i++) {
    const time = i / SAMPLE_RATE;
    let sample = 0;
    for (const partial of partials) {
      const decay = Math.exp(-time * (0.16 + 0.035 * partial.n));
      const spread = variant % 3 === 1 ? 0.35 : 0;
      const detune = spread / 1200;
      const lower = partial.frequency * 2 ** (-detune / 2);
      const upper = partial.frequency * 2 ** (detune / 2);
      const tone = spread ? 0.5 * (Math.cos(2 * Math.PI * lower * time) + Math.cos(2 * Math.PI * upper * time)) : Math.cos(2 * Math.PI * partial.frequency * time);
      sample += partial.amplitude * decay * tone;
    }
    if (profile.misleading) {
      const {partial, cents, amplitude} = profile.misleading;
      const gate = Math.exp(-(((time - 0.12) / 0.065) ** 8));
      const misleadingHz = injectedHz * partial * Math.sqrt(1 + B * partial * partial) * 2 ** (cents / 1200);
      sample += amplitude * gate * Math.cos(2 * Math.PI * misleadingHz * time);
    }
    left[i] = sample * 0.5;
    right[i] = sample * 0.5;
  }
  return {left, right, expectedHz, injectedHz, partials};
}

function pitchTrajectoryFixture(pitch, earlyCents, lateCents, B) {
  const left = new Float64Array(FRAME_COUNT);
  const right = new Float64Array(FRAME_COUNT);
  const expectedHz = midiToHz(pitch);
  const phases = new Float64Array(9);
  for (let i = 0; i < FRAME_COUNT; i++) {
    const time = i / SAMPLE_RATE;
    const offsetCents = time < 0.45 ? earlyCents : lateCents;
    const f0 = expectedHz * 2 ** (offsetCents / 1200);
    let sample = 0;
    for (let n = 1; n <= 8; n++) {
      const frequency = f0 * n * Math.sqrt(1 + B * n * n);
      if (frequency >= SAMPLE_RATE * 0.45) break;
      phases[n] += 2 * Math.PI * frequency / SAMPLE_RATE;
      sample += Math.cos(phases[n]) * Math.exp(-time * (0.16 + 0.035 * n)) / n ** 1.25;
    }
    left[i] = sample * 0.5;
    right[i] = sample * 0.5;
  }
  return {left, right};
}

function lowRegisterFixture(pitch, offsetCents, B, weakFundamental, phaseMode='zero', profile={}) {
  const frameCount=Math.floor(SAMPLE_RATE*(20/1000+LOW_REGISTER_FFT_SIZE/SAMPLE_RATE))+4096;
  const left=new Float64Array(frameCount),right=new Float64Array(frameCount);
  const expectedHz=midiToHz(pitch),injectedHz=expectedHz*2**(offsetCents/1200);
  const phases=phaseMode==='seeded'
    ?Array.from({length:9},(_,n)=>((pitch*17+n*43)%360)*Math.PI/180)
    :Array.from({length:9},()=>0);
  let seed=(pitch*73856093 + Math.round((offsetCents+40)*19349663) + Math.round(B*1e6)*83492791)>>>0;
  for(let i=0;i<frameCount;i++){
    const time=i/SAMPLE_RATE;let sample=0;
    for(let n=1;n<=8;n++){
      const hz=injectedHz*n*Math.sqrt(1+B*n*n);
      if(hz>=SAMPLE_RATE*0.45)break;
      let amplitude=1/n**1.25;
      if(weakFundamental&&n===1)amplitude=0.018;
      if(weakFundamental&&n===2)amplitude=0.82;
      if(weakFundamental&&n===3)amplitude=0.74;
      if(time>=0.72){
        amplitude*=profile.latePartialScales?.[n]??profile.lateAmplitudeScale??1;
      }
      phases[n]+=2*Math.PI*hz/SAMPLE_RATE;
      sample+=amplitude*Math.cos(phases[n])*Math.exp(-time*(0.12+0.025*n));
      if(n===1&&Number.isFinite(profile.h1SideToneCents)){
        const sideHz=hz*2**(profile.h1SideToneCents/1200);
        sample+=(profile.h1SideToneAmplitude??0)*Math.cos(2*Math.PI*sideHz*time)*Math.exp(-time*0.145);
      }
    }
    seed=(1664525*seed+1013904223)>>>0;
    const noise=((seed/0x100000000)-0.5)*(time>=0.72?(profile.lateNoiseAmplitude??profile.noiseAmplitude??1e-6):(profile.noiseAmplitude??1e-6));
    left[i]=right[i]=(sample+noise)*0.5;
  }
  return {left,right,expectedHz,injectedHz};
}

const outcomes = [];
const conformanceFailures = [];
for (const pitch of PITCHES) {
  for (const offset of OFFSETS) {
    for (const B of INHARMONICITY) {
      const variant = (PITCHES.indexOf(pitch) + OFFSETS.indexOf(offset) + INHARMONICITY.indexOf(B)) % 4;
      const audio = fixture(pitch, offset, B, variant);
      const result = estimatePianoPitch(audio.left, audio.right, {
        sampleRate: SAMPLE_RATE,
        expectedMidiPitch: pitch,
        onsetIndex: 0,
        startMs: 20,
        endMs: 550
      });
      const actualError = 1200 * Math.log2(result.estimated_f0 / audio.injectedHz);
      outcomes.push({pitch, offset, B, variant, actualError, result});
      if (audio.expectedHz >= 100 && (result.result === 'MEASUREMENT_INVALID' || Math.abs(actualError) > 2
        || result.usable_partial_count < (audio.expectedHz <= 3000 ? 2 : 1))) {
        conformanceFailures.push({pitch, offset, B, variant, actualError, result});
      }
    }
  }
}

let octaveLocks = 0, partialLocks = 0;
for (const item of outcomes) {
  if (midiToHz(item.pitch) < 100) continue;
  const errorFromInjected = Math.abs(item.actualError);
  if (Math.abs(errorFromInjected - 1200) <= 2) octaveLocks++;
  if (errorFromInjected > 2) partialLocks++;
}
if (conformanceFailures.length) console.log('CONFORMANCE_FAILURES', JSON.stringify(conformanceFailures.map(item => ({
  pitch: item.pitch, offset: item.offset, B: item.B, variant: item.variant,
  actualErrorCents: Number(item.actualError.toFixed(3)),
  estimatedErrorCents: item.result.pitch_error_cents,
  result: item.result.result, reason: item.result.reason,
  sources: item.result.low_register_diagnostics?.sources?.map(source => ({
    name: source.name, eligible: source.eligible, cents: source.cents,
    prominence: source.prominence, valid: source.valid
  })),
  cluster: item.result.low_register_diagnostics?.agreement_cluster
}))));
assert.equal(octaveLocks, 0, 'synthetic estimator locked to an octave');
assert.equal(partialLocks, 0, 'synthetic estimator locked to a partial');
assert.equal(conformanceFailures.length, 0, 'one or more synthetic pitch fixtures exceeded conformance limits');

function profileResult(pitch, B, profile) {
  const audio = fixture(pitch, 0, B, 3, profile);
  const result = estimatePianoPitch(audio.left, audio.right, {
    sampleRate: SAMPLE_RATE, expectedMidiPitch: pitch, onsetIndex: 0
  });
  const error = 1200 * Math.log2(result.estimated_f0 / audio.injectedHz);
  assert.notEqual(result.result, 'MEASUREMENT_INVALID', `supported profile pitch ${pitch} was measurement-invalid: ${result.reason}`);
  assert.ok(Math.abs(error) <= 2, `supported profile pitch ${pitch} error ${error} cents`);
  return {result, error};
}

const weakH1 = profileResult(60, 0.001, {amplitudes: {1: 0.01, 2: 0.7, 3: 1, 4: 0.45, 5: 0.3, 6: 0.2}});
assert.ok(weakH1.result.usable_partials.some(partial => partial >= 2), 'weak H1 profile should have upper-partial support');
const weakH2H3Dominant = profileResult(72, 0.005, {amplitudes: {1: 0.55, 2: 0.005, 3: 1, 4: 0.42, 5: 0.3, 6: 0.2}});
assert.ok(weakH2H3Dominant.result.usable_partials.includes(1) || weakH2H3Dominant.result.usable_partials.includes(3), 'weak H2 profile should be supported without relying on a fixed H1/H2 pair');
assert.ok(weakH2H3Dominant.result.usable_partials.includes(3), 'H3-dominant profile should retain H3 evidence');
const twoHighPartials = profileResult(108, 0.001, {amplitudes: {1: 1, 2: 0.55}});
assert.equal(twoHighPartials.result.usable_partial_count, 2, 'high-register two-partial fixture should use exactly two partials');
const partialOutlier = profileResult(60, 0.001, {outlier: {partial: 5, cents: 45}});
assert.ok(partialOutlier.result.window_results.some(window => window.rejected_partials.includes(5)), 'robust fit should reject the injected partial outlier');
const misleadingWindow = profileResult(72, 0.001, {misleading: {partial: 2, cents: 45, amplitude: 2.5}});
assert.ok(misleadingWindow.result.window_results[0].measurement_valid && misleadingWindow.result.window_results[1].measurement_valid,
  'the misleading first-window peak must not override independent-window pitch evidence');

const pitchTrajectoryAudio = pitchTrajectoryFixture(21, -8.8, 23.5, 0.015);
const pitchTrajectory = estimatePianoPitch(pitchTrajectoryAudio.left, pitchTrajectoryAudio.right, {
  sampleRate: SAMPLE_RATE, expectedMidiPitch: 21, onsetIndex: 0
});
assert.equal(pitchTrajectory.measurement_valid,true,
  `all-window pitch trajectory must be physical evidence: ${pitchTrajectory.reason}`);
assert.equal(pitchTrajectory.result,'FAIL');
assert.equal(pitchTrajectory.reason,'analysis-window-pitch-instability');
assert.deepEqual(pitchTrajectory.low_register_diagnostics.valid_window_names,['full','early','late']);
assert.ok(pitchTrajectory.low_register_diagnostics.overall_valid_window_spread_cents>8);
const worstTrajectoryError = pitchTrajectory.low_register_diagnostics.legacy_diagnostic.window_pitch_errors_cents
  .reduce((worst, cents) => Math.abs(cents) > Math.abs(worst) ? cents : worst);
assert.equal(pitchTrajectory.low_register_diagnostics.legacy_diagnostic.measurement_valid, true,
  'the prior short-window estimator must remain available for diagnostics');
assert.equal(pitchTrajectory.low_register_diagnostics.legacy_diagnostic.result, 'FAIL',
  'the legacy diagnostic must preserve the short-window physical pitch trajectory');
assert.equal(pitchTrajectory.low_register_diagnostics.legacy_diagnostic.reason, 'analysis-window-pitch-instability');
assert.ok(Math.abs(pitchTrajectory.low_register_diagnostics.legacy_diagnostic.pitch_error_cents - worstTrajectoryError) < 1e-9,
  'legacy diagnostics must preserve the worst absolute short-window offset');

const deterministicAudio = fixture(21, 0, 0.005, 1);
const first = estimatePianoPitch(deterministicAudio.left, deterministicAudio.right, {sampleRate: SAMPLE_RATE, expectedMidiPitch: 21, onsetIndex: 0});
const second = estimatePianoPitch(deterministicAudio.left, deterministicAudio.right, {sampleRate: SAMPLE_RATE, expectedMidiPitch: 21, onsetIndex: 0});
assert.deepEqual(first, second, 'estimator output changed across repeated deterministic runs');

const highFundamentalOnlyLeft = new Float64Array(FRAME_COUNT);
const highFundamentalOnlyRight = new Float64Array(FRAME_COUNT);
const highFundamentalHz = midiToHz(108);
for (let i = 0; i < FRAME_COUNT; i++) {
  const sample = Math.cos(2 * Math.PI * highFundamentalHz * i / SAMPLE_RATE) * Math.exp(-i / SAMPLE_RATE * 0.5);
  highFundamentalOnlyLeft[i] = sample;
  highFundamentalOnlyRight[i] = sample;
}
const highFundamentalOnly = estimatePianoPitch(highFundamentalOnlyLeft, highFundamentalOnlyRight, {
  sampleRate: SAMPLE_RATE, expectedMidiPitch: 108, onsetIndex: 0
});
assert.equal(highFundamentalOnly.result, 'PASS', 'a strong high-register fundamental with no measurable supporting partial must remain measurable');
assert.ok(Math.abs(highFundamentalOnly.pitch_error_cents) <= 2, 'high-register fundamental-only pitch estimate exceeded the 2 cent conformance tolerance');
assert.equal(highFundamentalOnly.usable_partial_count, 1, 'fundamental-only fixture should report one usable partial');

const ambiguousLeft = new Float64Array(FRAME_COUNT);
const ambiguousRight = new Float64Array(FRAME_COUNT);
for (const offset of [-25, 25]) {
  const voice = fixture(60, offset, 0.001, 1);
  for (let i = 0; i < FRAME_COUNT; i++) {
    ambiguousLeft[i] += voice.left[i] * 0.5;
    ambiguousRight[i] += voice.right[i] * 0.5;
  }
}
const ambiguous = estimatePianoPitch(ambiguousLeft, ambiguousRight, {
  sampleRate: SAMPLE_RATE, expectedMidiPitch: 60, onsetIndex: 0
});
assert.equal(ambiguous.result, 'MEASUREMENT_INVALID', 'ambiguous pitch must not fall through to PASS/FAIL');
assert.ok(ambiguous.reason, 'ambiguous pitch must report why its measurement is invalid');

assert.equal(PITCH_ESTIMATOR_REVISION,4,'Stage2Q evaluator provenance must identify pitch estimator revision 4');
assert.equal(LOW_REGISTER_FFT_SIZE,65536);
assert.equal(LOW_REGISTER_AGREEMENT_CENTS,8);

const lowPlan=getPianoPitchAnalysisPlan(21,{sampleRate:SAMPLE_RATE,blockSize:2048,minimumDurationMs:1000});
assert.equal(lowPlan.lowRegisterWindow.sampleCount,65536);
assert.equal(lowPlan.lowRegisterWindow.startMs,20);
assert.equal(lowPlan.lowRegisterWindow.endMs,20+65536*1000/SAMPLE_RATE);
assert.deepEqual(lowPlan.lowRegisterWindows,{
  full:{startMs:20,endMs:20+65536*1000/SAMPLE_RATE,sampleCount:65536,startFrame:960,endFrame:66496},
  early:{startMs:20,endMs:20+32768*1000/SAMPLE_RATE,sampleCount:32768,startFrame:960,endFrame:33728},
  late:{startMs:20+32768*1000/SAMPLE_RATE,endMs:20+65536*1000/SAMPLE_RATE,
    sampleCount:32768,startFrame:33728,endFrame:66496}
});
assert.ok(lowPlan.requiredFrames>=lowPlan.lowRegisterWindow.startFrame+65536+2048,
  'low-register capture plan must include all exact-window frames and a full block alignment margin');
for(const pitch of [48,60,84,108]){
  const plan=getPianoPitchAnalysisPlan(pitch,{sampleRate:SAMPLE_RATE,blockSize:2048,minimumDurationMs:1600});
  assert.equal(plan.requiredFrames,77824,`high/mid-register plan for MIDI ${pitch} must not be extended`);
}

const lowWindowAudio=lowRegisterFixture(21,0,0.003,false);
const lowWindowSpectrum=spectrum(lowWindowAudio.left,lowWindowAudio.right,SAMPLE_RATE,0,20,LOW_REGISTER_FFT_SIZE);
assert.equal(lowWindowSpectrum.sampleCount,65536,'Source A must use the exact full spectrum window');
assert.equal(lowWindowSpectrum.startIndex,960,'Source A must start at onset + 20 ms');
const lowWindowPeak=peakNearExpected(lowWindowSpectrum.magnitude,lowWindowSpectrum.binHz,lowWindowAudio.expectedHz,100);
assert.ok(lowWindowPeak,'Source A must search around expected f0');
assert.ok(spectralPeakProminence(lowWindowSpectrum.magnitude,lowWindowSpectrum.binHz,lowWindowPeak.hz,lowWindowPeak.amplitude)>=3,
  'the nominal spectral fundamental must clear the existing prominence gate');

for(const B of [0,0.003,0.01,0.02]){
  const f0=27.5,p1=f0*Math.sqrt(1+B),p2=2*f0*Math.sqrt(1+4*B);
  const recovered=recoverSpectralBaseF0(p1,p2,f0,3.1,3.2);
  assert.equal(recovered.eligible,true,`B=${B} exact partial pair must be eligible`);
  assert.ok(Math.abs(recovered.B_A-B)<=1e-10,`B=${B} recovered ${recovered.B_A}`);
  assert.ok(Math.abs(recovered.f0_A/f0-1)<=1e-10,`B=${B} relative f0 error ${recovered.f0_A/f0-1}`);
}
for(const B of [0,0.003,0.01,0.02]){
  for(const offset of [-30,0,30]){
    const audio=lowRegisterFixture(21,offset,B,true,'seeded');
    const fit=estimateSingleWindow(audio.left,audio.right,SAMPLE_RATE,audio.expectedHz,0,20,
      20+LOW_REGISTER_FFT_SIZE*1000/SAMPLE_RATE,{fixedInharmonicity:B});
    assert.equal(fit.measurement_valid,true,`fixed B=${B} offset=${offset} invalid: ${fit.reason}`);
    assert.equal(fit.fitted_B,B,'fixed-B fitter must preserve the exact supplied B');
    assert.equal(fit.inharmonicity_basis,'fixed-note-level');
    assert.ok(Math.abs(fit.pitch_error_cents-offset)<=0.5,
      `fixed-B recovery B=${B}, offset=${offset}: ${fit.pitch_error_cents} cents`);
  }
}
const fixedInvalidB=estimateSingleWindow(lowWindowAudio.left,lowWindowAudio.right,SAMPLE_RATE,
  lowWindowAudio.expectedHz,0,20,20+LOW_REGISTER_FFT_SIZE*1000/SAMPLE_RATE,{fixedInharmonicity:0.020001});
assert.equal(fixedInvalidB.measurement_valid,false);
assert.equal(fixedInvalidB.reason,'fixed-inharmonicity-out-of-range');
const fixedOutlierAudio=fixture(60,0,0.001,1,{outlier:{partial:5,cents:20}});
const fixedOutlier=estimateSingleWindow(fixedOutlierAudio.left,fixedOutlierAudio.right,SAMPLE_RATE,
  fixedOutlierAudio.expectedHz,0,20,550,{fixedInharmonicity:0.001});
assert.equal(fixedOutlier.fitted_B,0.001,'fixed-B outlier refit must not change B');
assert.ok(fixedOutlier.rejected_partials.includes(5),'fixed-B robust refit must reject the injected partial outlier');
const unrestrictedAudio=lowRegisterFixture(21,0,0.003,false);
const unrestrictedA=estimateSingleWindow(unrestrictedAudio.left,unrestrictedAudio.right,SAMPLE_RATE,
  unrestrictedAudio.expectedHz,0,20,20+LOW_REGISTER_FFT_SIZE*1000/SAMPLE_RATE);
const unrestrictedB=estimateSingleWindow(unrestrictedAudio.left,unrestrictedAudio.right,SAMPLE_RATE,
  unrestrictedAudio.expectedHz,0,20,20+LOW_REGISTER_FFT_SIZE*1000/SAMPLE_RATE,{});
assert.deepEqual(unrestrictedB,unrestrictedA,'omitting fixedInharmonicity must preserve unrestricted behavior');
assert.equal(recoverSpectralBaseF0(100,400,100,5,5).reason,'invalid-inharmonicity-denominator');
assert.equal(recoverSpectralBaseF0(100,190,100,5,5).reason,'inharmonicity-out-of-range');
const bOverLimit=0.03,f0OverLimit=100;
const overRangeEstimate=recoverSpectralBaseF0(f0OverLimit*Math.sqrt(1+bOverLimit),
  2*f0OverLimit*Math.sqrt(1+4*bOverLimit),f0OverLimit,5,5);
assert.equal(overRangeEstimate.eligible,false);
assert.ok(overRangeEstimate.B_A>0.02,'invalid B_A must be reported unchanged rather than clamped');
assert.equal(recoverSpectralBaseF0(null,200,100,5,5).eligible,false,'missing H1 must be ineligible');
assert.equal(recoverSpectralBaseF0(100,null,100,5,5).eligible,false,'missing H2 must be ineligible');
assert.equal(recoverSpectralBaseF0(100,200,100,2.99,5).reason,'insufficient-h1-h2-prominence');
assert.equal(recoverSpectralBaseF0(100,200,100,5,2.99).reason,'insufficient-h1-h2-prominence');

const LOW_PITCHES=[21,27,36,42],LOW_OFFSETS=[-30,-16,-14,0,14,16,30],LOW_B=[0,0.003,0.01];
const lowMatrix=[],validLowRows=[];let worstLowKnownError=0;
for(let pitchIndex=0;pitchIndex<LOW_PITCHES.length;pitchIndex++){
  const pitch=LOW_PITCHES[pitchIndex];
  for(let offsetIndex=0;offsetIndex<LOW_OFFSETS.length;offsetIndex++){
    const offset=LOW_OFFSETS[offsetIndex];
    for(let bIndex=0;bIndex<LOW_B.length;bIndex++){
      const B=LOW_B[bIndex];
      const audio=lowRegisterFixture(pitch,offset,B,(pitchIndex+offsetIndex+bIndex)%2===1);
      const result=estimatePianoPitch(audio.left,audio.right,{sampleRate:SAMPLE_RATE,expectedF0:audio.expectedHz,onsetIndex:0});
      assert.equal(result.pitch_estimator_revision,4,`pitch ${pitch} offset ${offset} B ${B} revision`);
      assert.ok(result.low_register_diagnostics.legacy_diagnostic,
        'the prior two-short-window result must remain available as a diagnostic');
      assert.ok(result.low_register_diagnostics.revision2_diagnostic,
        'the Stage2O decision must remain diagnostic-only');
      assert.ok(result.low_register_diagnostics.diagnostic_only.revision3_result,
        'Stage2P free-B classification must remain diagnostic-only');
      assert.equal(result.low_register_diagnostics.note_level_B_source,'full-window-free-fit');
      assert.equal(result.low_register_diagnostics.note_level_B_valid,true,
        `pitch ${pitch} offset ${offset} B ${B} must resolve note-level B from FULL`);
      const Bnote=result.low_register_diagnostics.note_level_B;
      assert.equal(result.low_register_diagnostics.windows.full.fitted_B,Bnote);
      assert.equal(result.low_register_diagnostics.windows.early.fitted_B,Bnote);
      assert.equal(result.low_register_diagnostics.windows.late.fitted_B,Bnote);
      assert.equal(result.low_register_diagnostics.windows.full.inharmonicity_basis,'fixed-note-level');
      assert.deepEqual(Object.keys(result.low_register_diagnostics.windows),['full','early','late']);
      for(const [name,window] of Object.entries(result.low_register_diagnostics.windows)){
        assert.equal(window.sample_count,name==='full'?65536:32768,`${name} window sample count`);
        assert.equal(window.exact_window,true,`${name} window must use exact frame coverage`);
      }
      const row={pitch,offset,B,result:result.result,measurementValid:result.measurement_valid,
        reason:result.reason,sources:result.low_register_diagnostics.sources};
      lowMatrix.push(row);
      if(!result.measurement_valid) continue;
      assert.ok(result.low_register_diagnostics.valid_window_names.length>=2,
        `pitch ${pitch} offset ${offset} B ${B} needs two valid windows`);
      assert.equal(result.measurement_basis,'low-register-fixed-B-multi-window');
      const knownError=1200*Math.log2(result.estimated_f0/audio.injectedHz);
      row.knownError=knownError;
      validLowRows.push(row);
      worstLowKnownError=Math.max(worstLowKnownError,Math.abs(knownError));
      assert.ok(Math.abs(knownError)<=2,`pitch ${pitch} offset ${offset} B ${B} known-f0 error ${knownError} cents`);
      const expectedOutcome=Math.abs(offset)<=14?'PASS':'FAIL';
      assert.equal(result.result,expectedOutcome,`pitch ${pitch} offset ${offset} B ${B} must retain the ±15-cent gate`);
      assert.ok(Math.abs(result.pitch_error_cents-offset)<=2,
        `pitch ${pitch} offset ${offset} B ${B} reported offset ${result.pitch_error_cents}`);
      const stableCents=result.low_register_diagnostics.valid_window_names.map(name=>
        result.low_register_diagnostics.windows[name].pitch_error_cents).sort((a,b)=>a-b);
      const medianStableCents=stableCents.length%2?stableCents[Math.floor(stableCents.length/2)]
        :(stableCents[stableCents.length/2-1]+stableCents[stableCents.length/2])/2;
      assert.equal(result.pitch_error_cents,medianStableCents,
        'valid low-register authority must be the median stable window estimate');
    }
  }
}

for(const offset of LOW_OFFSETS){
  const valid=validLowRows.filter(row=>row.offset===offset);
  assert.ok(valid.length>0,`offset ${offset} has no measurable A/C conformance case`);
  const expected=Math.abs(offset)<=14?'PASS':'FAIL';
  assert.ok(valid.every(row=>row.result===expected),`offset ${offset} has a false PASS/FAIL classification`);
}
assert.equal(lowMatrix.filter(row=>!row.measurementValid).length,0,
  'all nominally measurable synthetic low-register fixtures must yield valid multi-window estimates');
const blockingAudio=lowRegisterFixture(21,-30,0.01,true,'seeded');
const blocking=estimatePianoPitch(blockingAudio.left,blockingAudio.right,{sampleRate:SAMPLE_RATE,expectedF0:blockingAudio.expectedHz,onsetIndex:0});
assert.equal(blocking.measurement_valid,true,`blocking MIDI21/-30/B=.01 fixture invalid: ${blocking.reason}`);
assert.equal(blocking.result,'FAIL','blocking fixture must remain a physical pitch failure');
assert.ok(Math.abs(blocking.pitch_error_cents+30)<=2,'blocking fixture Source C must recover the true -30 cent base-f0');
assert.ok(blocking.low_register_diagnostics.valid_window_names.length>=2,
  'former Stage2O blocker needs at least two valid multi-partial windows');
assert.ok(blocking.low_register_diagnostics.sources[0],
  'the former blocker retains Source A as diagnostic evidence');

const weakLowAudio=lowRegisterFixture(21,0,0.01,true,'seeded',{noiseAmplitude:3});
const weakLow=estimatePianoPitch(weakLowAudio.left,weakLowAudio.right,
  {sampleRate:SAMPLE_RATE,expectedF0:weakLowAudio.expectedHz,onsetIndex:0});
assert.equal(weakLow.measurement_valid,true,'weak H1 must not invalidate stable multi-window comb evidence');
assert.equal(weakLow.result,'PASS');
assert.ok(weakLow.low_register_diagnostics.sources[0],
  'weak-H1 Source A diagnostics must remain available without controlling validity');
assert.ok(weakLow.low_register_diagnostics.sources[0].h1Prominence < 3,
  `weak-H1 fixture must fall below Source A's former prominence gate: ${weakLow.low_register_diagnostics.sources[0].h1Prominence}`);
assert.ok(weakLow.low_register_diagnostics.valid_window_names.some(name =>
  weakLow.low_register_diagnostics.windows[name].usable_partials.some(partial => partial >= 2)),
'weak-H1 fixture must remain supported by higher partials');

const negativeBA=lowMatrix.find(row=>row.measurementValid&&row.sources[0].B_A<0);
assert.ok(negativeBA,'the synthetic matrix must include a negative diagnostic B_A case');
assert.ok(negativeBA.measurementValid,'negative diagnostic B_A must not invalidate comb authority');

const identifiabilityAudio=lowRegisterFixture(21,0,0.01,true,'seeded',
  {lateAmplitudeScale:0.05,lateNoiseAmplitude:0.005});
const identifiability=estimatePianoPitch(identifiabilityAudio.left,identifiabilityAudio.right,
  {sampleRate:SAMPLE_RATE,expectedF0:identifiabilityAudio.expectedHz,onsetIndex:0});
const identifiabilityDiagnostics=identifiability.low_register_diagnostics;
const freeFull=identifiabilityDiagnostics.free_windows.full;
const freeLate=identifiabilityDiagnostics.free_windows.late;
assert.equal(freeFull.measurement_valid,true,'constant-f0 identifiability fixture needs a valid FULL free fit');
assert.equal(freeLate.measurement_valid,true,'weakened LATE spectrum must still have a valid free fit');
assert.ok(Math.abs(freeLate.candidate_fitted_B-freeFull.candidate_fitted_B)>=0.0002,
  `weakened LATE spectrum must reproduce free-B drift: FULL=${freeFull.candidate_fitted_B}, LATE=${freeLate.candidate_fitted_B}`);
assert.ok(Math.abs(freeLate.candidate_pitch_error_cents-freeFull.candidate_pitch_error_cents)>=3,
  'the free f0/B pair must show a measurable alternate solution');
assert.equal(identifiability.measurement_valid,true,
  `fixed note-level B must resolve the constant-pitch note: ${identifiability.reason}`);
assert.equal(identifiability.result,'PASS');
assert.ok(identifiabilityDiagnostics.windows.full.measurement_valid
  && identifiabilityDiagnostics.windows.early.measurement_valid
  && identifiabilityDiagnostics.windows.late.measurement_valid);
assert.ok(identifiabilityDiagnostics.overall_valid_window_spread_cents<=8);
assert.ok(Math.abs(identifiability.pitch_error_cents)<=0.5,
  `fixed-B final pitch must follow the injected constant f0: ${identifiability.pitch_error_cents}`);
const unresolvedAudio={left:new Float64Array(FRAME_COUNT),right:new Float64Array(FRAME_COUNT)};
const unresolved=estimatePianoPitch(unresolvedAudio.left,unresolvedAudio.right,
  {sampleRate:SAMPLE_RATE,expectedMidiPitch:21,onsetIndex:0});
assert.equal(unresolved.measurement_valid,false,'invalid FULL free fit must not fall back to another window');
assert.equal(unresolved.reason,'note-level-inharmonicity-unresolved');
assert.equal(unresolved.low_register_diagnostics.note_level_B,null);

const classifierWindow=(cents,valid=true)=>({measurement_valid:valid,pitch_error_cents:cents,
  estimated_f0:midiToHz(21)*2**(cents/1200),fitted_B:0.01,expected_f0:midiToHz(21)});
const stableThree=classifyLowRegisterWindows({full:classifierWindow(1),early:classifierWindow(2),late:classifierWindow(3)});
assert.equal(stableThree.result,'PASS');
assert.equal(stableThree.pitch_error_cents,2);
assert.deepEqual(stableThree.stable_cluster_names,['full','early','late']);
const stableTwo=classifyLowRegisterWindows({full:classifierWindow(0),early:classifierWindow(4),late:classifierWindow(99,false)});
assert.equal(stableTwo.measurement_valid,true,'two coherent windows must establish validity');
assert.equal(stableTwo.pitch_error_cents,2);
const unstableThree=classifyLowRegisterWindows({full:classifierWindow(-2),early:classifierWindow(0),late:classifierWindow(12)});
assert.equal(unstableThree.measurement_valid,true);
assert.equal(unstableThree.result,'FAIL');
assert.equal(unstableThree.reason,'analysis-window-pitch-instability');
assert.equal(unstableThree.pitch_error_cents,12);
const disagreeingTwo=classifyLowRegisterWindows({full:classifierWindow(-10),early:classifierWindow(1),late:classifierWindow(0,false)});
assert.equal(disagreeingTwo.result,'MEASUREMENT_INVALID');
assert.equal(disagreeingTwo.reason,'low-register-window-disagreement');
const insufficient=classifyLowRegisterWindows({full:classifierWindow(0),early:classifierWindow(1,false),late:classifierWindow(2,false)});
assert.equal(insufficient.result,'MEASUREMENT_INVALID');
assert.equal(insufficient.reason,'insufficient-valid-low-register-windows');
for(const [offset,expected] of [[-30,'FAIL'],[-16,'FAIL'],[-14,'PASS'],[0,'PASS'],[14,'PASS'],[16,'FAIL'],[30,'FAIL']]){
  const result=classifyLowRegisterWindows({full:classifierWindow(offset),early:classifierWindow(offset+0.2),late:classifierWindow(offset-0.2)});
  assert.equal(result.result,expected,`cross-window classifier changed ±15-cent rule at ${offset}`);
}

function highGoldenFixture(pitch){
  const expectedHz=midiToHz(pitch),B=0.003,left=new Float64Array(FRAME_COUNT),right=new Float64Array(FRAME_COUNT);
  for(let i=0;i<FRAME_COUNT;i++){
    const time=i/SAMPLE_RATE;let sample=0;
    for(let n=1;n<=8;n++){
      const hz=expectedHz*n*Math.sqrt(1+B*n*n);
      if(hz>=SAMPLE_RATE*0.45)break;
      sample+=Math.cos(2*Math.PI*hz*time)*Math.exp(-time*(0.16+0.035*n))/n**1.25;
    }
    left[i]=right[i]=sample*0.5;
  }
  return estimatePianoPitch(left,right,{sampleRate:SAMPLE_RATE,expectedMidiPitch:pitch,onsetIndex:0});
}
const HIGH_GOLDENS=[
  {pitch:48,f0:130.81277106864462,cents:-0.00015327673205097457,B:0.003,partials:[1,2,3,4,5,6,7,8],windows:[-0.00010026405654230697,-0.00020628940755964217]},
  {pitch:60,f0:261.6255659752338,cents:0.000004464209591810956,B:0.003,partials:[1,2,3,4,5,6,7,8],windows:[0.000011580977228129014,-0.000002652558044507101]},
  {pitch:84,f0:1046.5022394224702,cents:-0.00003603064082049028,B:0.003,partials:[1,2,3,4,5,6,7,8],windows:[-0.000036346147264445315,-0.00003571513437653524]},
  {pitch:108,f0:4186.00901175724,cents:-0.000013669662880382547,B:0.003,partials:[1,2,3,4],windows:[-0.000013669782720569,-0.000013669543040196092]}
];
for(const golden of HIGH_GOLDENS){
  const result=highGoldenFixture(golden.pitch);
  assert.equal(result.pitch_estimator_revision,4);
  assert.equal(result.result,'PASS');
  assert.equal(result.measurement_valid,true);
  assert.ok(Math.abs(result.estimated_f0-golden.f0)<=1e-8,`MIDI ${golden.pitch} f0 changed: ${result.estimated_f0}`);
  assert.ok(Math.abs(result.pitch_error_cents-golden.cents)<=1e-9,`MIDI ${golden.pitch} cents changed: ${result.pitch_error_cents}`);
  assert.equal(result.fitted_B,golden.B);
  assert.deepEqual(result.usable_partials,golden.partials);
  for(let i=0;i<golden.windows.length;i++)assert.ok(Math.abs(result.window_pitch_errors_cents[i]-golden.windows[i])<=1e-9,
    `MIDI ${golden.pitch} analysis window ${i} changed`);
}

console.log('PASS piano pitch estimator conformance', JSON.stringify({
  fixtureCount: outcomes.length,
  worstAbsolutePitchErrorCents: Math.max(...outcomes.filter(item=>Number.isFinite(item.actualError)).map(item => Math.abs(item.actualError))),
  octaveLockCount: octaveLocks,
  partialLockCount: partialLocks,
  minimumConfidenceRatio: Math.min(...outcomes.map(item => item.result.confidence_ratio)),
  deterministic: true,
  highRegisterFundamentalOnly: highFundamentalOnly.result,
  lowConfidenceBehavior: ambiguous.result,
  specialFixtures: {
    weakH1: weakH1.result.result,
    weakH2H3Dominant: weakH2H3Dominant.result.result,
    twoHighPartials: twoHighPartials.result.result,
    partialOutlier: partialOutlier.result.result,
    misleadingWindow: misleadingWindow.result.result,
    physicalPitchTrajectory: pitchTrajectory.result
  },
  lowRegisterFixtureCount:lowMatrix.length,
  lowRegisterInvalidFixtureCount:lowMatrix.filter(row=>!row.measurementValid).length,
  lowRegisterInvalidFixtures:lowMatrix.filter(row=>!row.measurementValid).map(row=>({pitch:row.pitch,offset:row.offset,B:row.B,
    reason:row.reason,sourceAEligible:row.sources[0].eligible,sourceCEligible:row.sources[2].eligible})),
  lowRegisterWorstKnownPitchErrorCents:worstLowKnownError,
  identifiabilityRegression:{
    freeBDelta:Math.abs(freeLate.candidate_fitted_B-freeFull.candidate_fitted_B),
    freeCentsDelta:Math.abs(freeLate.candidate_pitch_error_cents-freeFull.candidate_pitch_error_cents),
    fixedB:identifiabilityDiagnostics.note_level_B,
    fixedWindowSpread:identifiabilityDiagnostics.overall_valid_window_spread_cents,
    result:identifiability.result
  },
  highRegisterGoldenCount:HIGH_GOLDENS.length,
  estimatorRevision:PITCH_ESTIMATOR_REVISION
}));
