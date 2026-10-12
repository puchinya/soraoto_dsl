const path=require('path');
const {PluginHarness,ext}=require('../../../../test/helpers/plugin-harness.cjs');
const {estimatePianoPitch}=require('./tools/piano-pitch-estimator.cjs');
const {toneMag}=require('./tools/salamander-metrics.cjs');
const R=path.resolve(__dirname,'../../../../../'),FILE='plugins/dsp/super-synth/plugin.wasm',SR=48000;
function check(x,m){if(!x)throw new Error(m)}
function rms(a,s,e){let q=0,n=0;for(let i=Math.max(0,Math.floor(s));i<Math.min(a.length,Math.floor(e));i++){q+=a[i]*a[i];n++;}return Math.sqrt(q/Math.max(1,n));}
function deriv(a,s,e){let q=0,p=0,n=0;for(let i=Math.max(1,Math.floor(s));i<Math.min(a.length,Math.floor(e));i++){const d=a[i]-a[i-1];q+=d*d;p+=a[i]*a[i];n++;}return Math.sqrt(q/Math.max(1,n))/Math.max(1e-12,Math.sqrt(p/Math.max(1,n)));}
function signalDiff(a,b,s=.03,e=1.2){let q=0,n=0;for(let i=Math.floor(s*SR);i<Math.min(a.length,b.length,Math.floor(e*SR));i++){const d=a[i]-b[i];q+=d*d;n++;}return Math.sqrt(q/Math.max(1,n));}
function soundboardDiagnostics(e){
 const required=['soraoto_supersynth_soundboard_diag_reset','soraoto_supersynth_soundboard_diag_sum_squares','soraoto_supersynth_soundboard_diag_frames'];
 for(const name of required)check(typeof e[name]==='function',`soundboard diagnostic export missing ${name}`);
 const frames=e.soraoto_supersynth_soundboard_diag_frames()>>>0;
 check(frames>0,'soundboard diagnostic captured no frames');
 const rmsAt=index=>Math.sqrt((e.soraoto_supersynth_soundboard_diag_sum_squares(index)||0)/frames);
 return {frames,raw:{left:rmsAt(10),right:rmsAt(11)},applied:{left:rmsAt(12),right:rmsAt(13)}};
}
function render({pitch=60,velocity=.72,seconds=3.4,noteOff=1.0,over={},captureSoundboardDiagnostics=false}={}){
 const h=new PluginHarness(R,FILE,{sampleRate:SR,maxFrames:128});h.applyPreset('concert_grand');h.setPlain('voice_drift',0);h.setPlain('lfo1_pitch',0);for(const[k,v]of Object.entries(over))h.setPlain(k,v);
 if(captureSoundboardDiagnostics){for(const name of ['soraoto_supersynth_soundboard_diag_reset','soraoto_supersynth_soundboard_diag_sum_squares','soraoto_supersynth_soundboard_diag_frames'])check(typeof h.e[name]==='function',`soundboard diagnostic export missing ${name}`);h.e.soraoto_supersynth_soundboard_diag_reset();}
 const guardBefore=typeof h.e.soraoto_supersynth_guard_hit_count==='function'?h.e.soraoto_supersynth_guard_hit_count():null;
 const N=Math.floor(seconds*SR),L=new Float64Array(N),RR=new Float64Array(N);let pos=0,peak=0,offSent=false;
 while(pos<N){const n=Math.min(128,N-pos),events=[];if(pos===0)events.push({kind:1,noteId:1,pitch,velocity,offset:0});if(!offSent&&noteOff!=null&&pos<=noteOff*SR&&pos+n>noteOff*SR){events.push({kind:2,noteId:1,pitch,velocity:0,offset:Math.floor(noteOff*SR-pos)});offSent=true;}const o=h.process(n,{events})[0];L.set(o[0],pos);RR.set(o[1],pos);for(let i=0;i<n;i++){check(Number.isFinite(o[0][i])&&Number.isFinite(o[1][i]),'non-finite concert grand sample');peak=Math.max(peak,Math.abs(o[0][i]),Math.abs(o[1][i]));}pos+=n;}const outputGuardHits=guardBefore===null?null:h.e.soraoto_supersynth_guard_hit_count()-guardBefore;const activeVoiceCountAtEnd=typeof h.e.soraoto_supersynth_active_voice_count==='function'?h.e.soraoto_supersynth_active_voice_count():null;const boardDiagnostics=captureSoundboardDiagnostics?soundboardDiagnostics(h.e):null;h.close();return {L,R:RR,peak,outputGuardHits,activeVoiceCountAtEnd,finite:true,boardDiagnostics};
}
if(process.env.SUPERSYNTH_HELD_RELEASE_ONLY==='1'){
const held=render({pitch:60,velocity:.82,seconds:1.6,noteOff:null}),releaseOnly=render({pitch:60,velocity:.72,seconds:3.4,noteOff:1.0});
const heldDecayRatio=rms(held.L,.25*SR,.60*SR)/Math.max(1e-12,rms(held.L,.08*SR,.25*SR));
const tail1=rms(releaseOnly.L,1.10*SR,1.35*SR),tail2=rms(releaseOnly.L,1.8*SR,2.1*SR),tail3=rms(releaseOnly.L,2.8*SR,3.2*SR);
const outputGuardHits=(held.outputGuardHits||0)+(releaseOnly.outputGuardHits||0);
const measured={finite:held.finite&&releaseOnly.finite,finiteRelease:releaseOnly.finite,
 stuckVoiceCount:releaseOnly.activeVoiceCountAtEnd,outputGuardHits,heldDecayRatio,
 releaseTail1:tail1,releaseTail2:tail2,releaseTail3:tail3,releaseTail3To2Ratio:tail3/Math.max(1e-12,tail2),
 peakDbfs:20*Math.log10(Math.max(1e-12,Math.max(held.peak,releaseOnly.peak)))};
console.log(`HELD_RELEASE_METRICS ${JSON.stringify(measured)}`);
check(measured.finite&&measured.finiteRelease,'non-finite held/release samples');
check(measured.outputGuardHits===0,'held/release output guard activation');
check(measured.stuckVoiceCount===0,`held/release left ${measured.stuckVoiceCount} active voices`);
check(heldDecayRatio>.40&&heldDecayRatio<1.02,`C4 held decay plausibility ${heldDecayRatio}`);
check(tail1>.0003&&tail2>.00015&&tail3<tail2*.55,`C4 release tail gate ${tail1}/${tail2}/${tail3}`);
process.exit(0);
}
function balance(x,s,e){const l=rms(x.L,s,e),r=rms(x.R,s,e);return (r-l)/Math.max(1e-12,r+l)}
const probe=new PluginHarness(R,FILE);const d=probe.descriptor,preset=ext(d).presets.concert_grand;const engine=d.parameters.find(x=>x.path==='engine_model');probe.close();
check(preset&&preset.engine_model==='concert_grand','concert_grand factory preset missing');
check(engine&&engine.enum_values.includes('concert_grand'),'engine_model enum missing concert_grand');
for(const k of ['osc_a_level','osc_b_level','sub_level','noise_level'])check(Number(preset[k]||0)===0,`concert grand synth leakage: ${k}`);
check(Number(preset.piano_soundboard_mix)>=.5,'concert grand must use shared soundboard strongly');
check(Number(preset.piano_string_unison)>=.4,'concert grand must use coupled multi-string unison');
const soft=render({pitch:60,velocity:.25,noteOff:null,seconds:1.6}),hard=render({pitch:60,velocity:.9,noteOff:null,seconds:1.6});
const bass=render({pitch:40,seconds:2.0,noteOff:null}),treble=render({pitch:76,seconds:2.0,noteOff:null}),release=render({pitch:60,velocity:.72,seconds:3.4,noteOff:1.0});
const bright=deriv(hard.L,0,.16*SR)/Math.max(1e-12,deriv(soft.L,0,.16*SR));
const bassPan=balance(bass,.05*SR,.8*SR),treblePan=balance(treble,.05*SR,.8*SR);
const f0=261.625565,h1=toneMag(hard.L,f0),h2=toneMag(hard.L,f0*2),h3=toneMag(hard.L,f0*3);
const p60Estimate=estimatePianoPitch(hard.L,hard.R,{sampleRate:SR,expectedMidiPitch:60}),p76Estimate=estimatePianoPitch(treble.L,treble.R,{sampleRate:SR,expectedMidiPitch:76});
const p60=p60Estimate.result==='MEASUREMENT_INVALID'?Infinity:Math.abs(p60Estimate.pitch_error_cents),p76=p76Estimate.result==='MEASUREMENT_INVALID'?Infinity:Math.abs(p76Estimate.pitch_error_cents);
// Same-metric audit of the pinned SFZ-selected C4 source gives H2/H1=14.456522
// at this probe velocity. H2-H5 therefore remain diagnostics here; the direct
// Salamander fixture and full-range comparison own reference spectral fit.
const realCal=render({pitch:60,velocity:.82,seconds:1.6,noteOff:null});
const rc1=toneMag(realCal.L,f0,.03,.18),rc2=toneMag(realCal.L,f0*2,.03,.18),rc3=toneMag(realCal.L,f0*3,.03,.18),rc4=toneMag(realCal.L,f0*4,.03,.18),rc5=toneMag(realCal.L,f0*5,.03,.18);
const rr2=rc2/Math.max(1e-12,rc1),rr3=rc3/Math.max(1e-12,rc1),rr4=rc4/Math.max(1e-12,rc1),rr5=rc5/Math.max(1e-12,rc1);
const refDecayEarly=rms(realCal.L,.08*SR,.25*SR),refDecayMid=rms(realCal.L,.25*SR,.60*SR),refDecayRatio=refDecayMid/Math.max(1e-12,refDecayEarly);
const tail1=rms(release.L,1.10*SR,1.35*SR),tail2=rms(release.L,1.8*SR,2.1*SR),tail3=rms(release.L,2.8*SR,3.2*SR);
const windowHarmonics=(start,end)=>{const fundamental=Math.max(1e-12,toneMag(realCal.L,f0,start,end));return Object.fromEntries([3,4,5].map(n=>[`h${n}`,toneMag(realCal.L,f0*n,start,end)/fundamental]));};
const hWindows={ms30to80:windowHarmonics(.03,.08),ms80to200:windowHarmonics(.08,.20)};
const stage1GuardHits=[soft,hard,bass,treble,realCal,release].reduce((sum,result)=>sum+(result.outputGuardHits||0),0);
const c4HardFailures=[];
if(hard.peak>=1)c4HardFailures.push('peak-not-below-0-dbfs');
if(stage1GuardHits>0)c4HardFailures.push('output-guard-hit');
if(!(bright>1.25))c4HardFailures.push('velocity-brightness');
if(!(p60<=15&&p76<=15))c4HardFailures.push('pitch');
if(!(refDecayRatio>.40&&refDecayRatio<1.02))c4HardFailures.push('held-decay');
if(!(tail1>.0003&&tail2>.00015&&tail3<tail2*.55))c4HardFailures.push('release-tail');
if(release.activeVoiceCountAtEnd!==0)c4HardFailures.push('stuck-voice');
console.log(`STAGE1_METRICS ${JSON.stringify({finite:true,finiteRelease:release.finite,stuckVoiceCount:release.activeVoiceCountAtEnd,outputGuardHits:stage1GuardHits,peakDbfs:20*Math.log10(Math.max(1e-12,hard.peak)),peakMarginDb:-20*Math.log10(Math.max(1e-12,hard.peak)),pitchC4Cents:p60,pitchE5Cents:p76,pitchMarginCents:15-Math.max(p60,p76),pitchEstimator:{c4:p60Estimate,e5:p76Estimate},velocityBrightness:bright,velocityBrightnessMargin:bright-1.25,h3ToH1H4ToH5Windows:hWindows,harmonicRatios:{h2:rr2,h3:rr3,h4:rr4,h5:rr5},heldDecayRatio:refDecayRatio,releaseTailRms:{'1.10to1.35s':tail1,'1.8to2.1s':tail2,'2.8to3.2s':tail3},hardGateFailures:c4HardFailures})}`);
check(stage1GuardHits===0,`concert grand output guard activations ${stage1GuardHits}`);
check(hard.peak<1.0&&hard.peak>.001,`unsafe/silent grand peak ${hard.peak}`);
check(bright>1.25,`felt hammer velocity brightness weak ${bright}`);
check(bassPan<-.025&&treblePan>.02,`keyboard radiation stereo image missing ${bassPan}/${treblePan}`);
check(h2>h1*.12&&h3>h1*.05,`string harmonic spectrum too sparse ${h1}/${h2}/${h3}`);
check(p60<=15&&p76<=15,`concert grand pitch error ${p60}/${p76} cent`);
check(refDecayRatio>.40&&refDecayRatio<1.02,`C4 early decay plausibility ${refDecayRatio}`);
check(tail1>.0003&&tail2>.00015,`soundboard release tail missing ${tail1}/${tail2}`);check(tail3<tail2*.55,`damper/soundboard tail fails to decay ${tail2}/${tail3}`);
check(release.activeVoiceCountAtEnd===0,`concert grand release left ${release.activeVoiceCountAtEnd} active voices`);
if(process.env.SUPERSYNTH_STAGE1_ONLY==='1'){
console.log('PASS C4 local Stage-1 regression');
}else{
const boardDry=render({pitch:60,velocity:.72,seconds:1.6,noteOff:null,over:{piano_soundboard_mix:.05}}),boardWet=render({pitch:60,velocity:.72,seconds:1.6,noteOff:null,over:{piano_soundboard_mix:.9}});let dq=0,n=0;for(let i=Math.floor(.08*SR);i<Math.floor(1.2*SR);i++){const x=boardDry.L[i]-boardWet.L[i];dq+=x*x;n++;}const boardDiff=Math.sqrt(dq/Math.max(1,n));check(boardDiff>.0004,`shared soundboard control ineffective ${boardDiff}`);
const feltSoft=render({pitch:60,velocity:.72,seconds:1.0,noteOff:null,over:{piano_hammer_hardness:.05}}),feltHard=render({pitch:60,velocity:.72,seconds:1.0,noteOff:null,over:{piano_hammer_hardness:.9}});let fq=0,fn=0;for(let i=0;i<Math.floor(.16*SR);i++){const x=feltSoft.L[i]-feltHard.L[i];fq+=x*x;fn++;}const feltContactDiff=Math.sqrt(fq/Math.max(1,fn));check(feltContactDiff>.002,`nonlinear felt contact ineffective ${feltContactDiff}`);
// v9 physical topology controls must affect the propagating string/body, not metadata only.
const dispLo=render({pitch:76,velocity:.78,seconds:1.5,noteOff:null,over:{piano_inharmonicity:0}}),dispHi=render({pitch:76,velocity:.78,seconds:1.5,noteOff:null,over:{piano_inharmonicity:.9}});
const dispersionDiff=signalDiff(dispLo.L,dispHi.L);check(dispersionDiff>.0002,`traveling-wave dispersion ineffective ${dispersionDiff}`);
const uniLo=render({pitch:76,velocity:.78,seconds:1.5,noteOff:null,over:{piano_string_unison:0}}),uniHi=render({pitch:76,velocity:.78,seconds:1.5,noteOff:null,over:{piano_string_unison:.95}});
const unisonDiff=signalDiff(uniLo.L,uniHi.L);check(unisonDiff>.00005,`register unison strings ineffective ${unisonDiff}`);
const boardSmall=render({pitch:60,velocity:.78,seconds:1.5,noteOff:null,over:{piano_soundboard_size:.05}}),boardLarge=render({pitch:60,velocity:.78,seconds:1.5,noteOff:null,over:{piano_soundboard_size:.95}});
const boardSizeDiff=signalDiff(boardSmall.L,boardLarge.L);check(boardSizeDiff>.00015,`distributed soundboard size ineffective ${boardSizeDiff}`);
// Low-register buzz sanity guard, complementary to the per-cell Salamander
// full-range metrics below the direct-reference pitch centers.
const lowBass=render({pitch:29,velocity:.55,seconds:1.4,noteOff:null});
const lowBassBuzz=deriv(lowBass.L,.05*SR,.25*SR);
check(lowBassBuzz>.001&&lowBassBuzz<.12,`low-register buzz guard ${lowBassBuzz}`);
// soundboard_mix=0 must be a real radiation bypass for diagnostics.
const boardOff=render({pitch:60,velocity:.72,seconds:.8,noteOff:null,over:{piano_soundboard_mix:0,piano_sympathetic:0},captureSoundboardDiagnostics:true});
const boardOn=render({pitch:60,velocity:.72,seconds:.8,noteOff:null,over:{piano_soundboard_mix:.62,piano_sympathetic:0},captureSoundboardDiagnostics:true});
check(boardOff.outputGuardHits===0&&boardOn.outputGuardHits===0,`soundboard bypass diagnostic guard hits ${boardOff.outputGuardHits}/${boardOn.outputGuardHits}`);
check(boardOff.peak<1&&boardOn.peak<1,`soundboard bypass diagnostic peak reached 0 dBFS ${boardOff.peak}/${boardOn.peak}`);
for(const channel of ['left','right']){
 check(boardOff.boardDiagnostics.raw[channel]>0,`zero-mix raw board radiation ${channel} is silent`);
 check(boardOff.boardDiagnostics.applied[channel]===0,`zero-mix applied board radiation ${channel} is non-zero ${boardOff.boardDiagnostics.applied[channel]}`);
 check(boardOn.boardDiagnostics.raw[channel]>0,`non-zero-mix raw board radiation ${channel} is silent`);
 check(boardOn.boardDiagnostics.applied[channel]>0,`non-zero-mix applied board radiation ${channel} is silent`);
}
const boardOnUnobserved=render({pitch:60,velocity:.72,seconds:.8,noteOff:null,over:{piano_soundboard_mix:.62,piano_sympathetic:0}});
let diagnosticMaxDifference=0;for(let i=0;i<boardOn.L.length;i++)diagnosticMaxDifference=Math.max(diagnosticMaxDifference,Math.abs(boardOn.L[i]-boardOnUnobserved.L[i]),Math.abs(boardOn.R[i]-boardOnUnobserved.R[i]));
check(diagnosticMaxDifference===0,`soundboard diagnostic capture changed output ${diagnosticMaxDifference}`);

const bassSoftDyn=render({pitch:41,velocity:.25,seconds:.8,noteOff:null}),bassMidDyn=render({pitch:41,velocity:.55,seconds:.8,noteOff:null}),bassHardDyn=render({pitch:41,velocity:.90,seconds:.8,noteOff:null});
const bassSoftBright=deriv(bassSoftDyn.L,.03*SR,.18*SR),bassMidBright=deriv(bassMidDyn.L,.03*SR,.18*SR),bassHardBright=deriv(bassHardDyn.L,.03*SR,.18*SR);
check(bassMidBright>bassSoftBright*1.05&&bassHardBright>bassMidBright*1.05,`bass felt velocity shape regressed ${bassSoftBright}/${bassMidBright}/${bassHardBright}`);
console.log('PASS concert grand regression',{pitchC4:+p60.toFixed(1),pitchE5:+p76.toFixed(1),velocityBrightness:+bright.toFixed(2),bassPan:+bassPan.toFixed(3),treblePan:+treblePan.toFixed(3),h2:+(h2/h1).toFixed(3),h3:+(h3/h1).toFixed(3),tail1:+tail1.toFixed(6),tail2:+tail2.toFixed(6),tail3:+tail3.toFixed(6),boardControlDiff:+boardDiff.toFixed(6),soundboardZeroMix:{raw:boardOff.boardDiagnostics.raw,applied:boardOff.boardDiagnostics.applied},soundboardMix062:{raw:boardOn.boardDiagnostics.raw,applied:boardOn.boardDiagnostics.applied},diagnosticMaxDifference,feltContactDiff:+feltContactDiff.toFixed(6),dispersionDiff:+dispersionDiff.toFixed(6),unisonDiff:+unisonDiff.toFixed(6),boardSizeDiff:+boardSizeDiff.toFixed(6),lowBassBuzz:+lowBassBuzz.toFixed(4),bassVelocityShape:+(bassMidBright/Math.max(1e-12,bassSoftBright)).toFixed(2),refH2:+rr2.toFixed(3),refH3:+rr3.toFixed(3),refH4:+rr4.toFixed(3),refH5:+rr5.toFixed(3),refDecay:+refDecayRatio.toFixed(3),peak:+hard.peak.toFixed(4)});
}
