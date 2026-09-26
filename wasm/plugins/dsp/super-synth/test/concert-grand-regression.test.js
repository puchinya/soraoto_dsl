const path=require('path');
const {PluginHarness,ext}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'),FILE='plugins/dsp/super-synth/plugin.wasm',SR=48000;
function check(x,m){if(!x)throw new Error(m)}
function rms(a,s,e){let q=0,n=0;for(let i=Math.max(0,Math.floor(s));i<Math.min(a.length,Math.floor(e));i++){q+=a[i]*a[i];n++;}return Math.sqrt(q/Math.max(1,n));}
function deriv(a,s,e){let q=0,p=0,n=0;for(let i=Math.max(1,Math.floor(s));i<Math.min(a.length,Math.floor(e));i++){const d=a[i]-a[i-1];q+=d*d;p+=a[i]*a[i];n++;}return Math.sqrt(q/Math.max(1,n))/Math.max(1e-12,Math.sqrt(p/Math.max(1,n)));}
function goertzel(a,s,e,f){const w=2*Math.PI*f/SR,c=2*Math.cos(w);let q0=0,q1=0,q2=0;for(let i=Math.floor(s);i<Math.min(a.length,Math.floor(e));i++){q0=c*q1-q2+a[i];q2=q1;q1=q0;}return q1*q1+q2*q2-c*q1*q2;}
function estimate(a,s,e,target){let bestF=0,best=-1;for(let cents=-30;cents<=30;cents+=1){const f=target*Math.pow(2,cents/1200),p=goertzel(a,s,e,f);if(p>best){best=p;bestF=f;}}return 1200*Math.log2(bestF/target);}
function toneMag(a,f,s=.08,e=.65){let re=0,im=0,wSum=0;const i0=Math.floor(s*SR),i1=Math.min(a.length,Math.floor(e*SR));for(let i=i0;i<i1;i++){const w=.5-.5*Math.cos(2*Math.PI*(i-i0)/Math.max(1,i1-i0-1)),ph=2*Math.PI*f*i/SR;re+=a[i]*w*Math.cos(ph);im-=a[i]*w*Math.sin(ph);wSum+=w;}return Math.hypot(re,im)/Math.max(1e-12,wSum);}
function signalDiff(a,b,s=.03,e=1.2){let q=0,n=0;for(let i=Math.floor(s*SR);i<Math.min(a.length,b.length,Math.floor(e*SR));i++){const d=a[i]-b[i];q+=d*d;n++;}return Math.sqrt(q/Math.max(1,n));}
function render({pitch=60,velocity=.72,seconds=3.4,noteOff=1.0,over={}}={}){
 const h=new PluginHarness(R,FILE,{sampleRate:SR,maxFrames:128});h.applyPreset('concert_grand');h.setPlain('voice_drift',0);h.setPlain('lfo1_pitch',0);for(const[k,v]of Object.entries(over))h.setPlain(k,v);
 const N=Math.floor(seconds*SR),L=new Float64Array(N),RR=new Float64Array(N);let pos=0,peak=0,offSent=false;
 while(pos<N){const n=Math.min(128,N-pos),events=[];if(pos===0)events.push({kind:1,noteId:1,pitch,velocity,offset:0});if(!offSent&&noteOff!=null&&pos<=noteOff*SR&&pos+n>noteOff*SR){events.push({kind:2,noteId:1,pitch,velocity:0,offset:Math.floor(noteOff*SR-pos)});offSent=true;}const o=h.process(n,{events})[0];L.set(o[0],pos);RR.set(o[1],pos);for(let i=0;i<n;i++){check(Number.isFinite(o[0][i])&&Number.isFinite(o[1][i]),'non-finite concert grand sample');peak=Math.max(peak,Math.abs(o[0][i]),Math.abs(o[1][i]));}pos+=n;}h.close();return {L,R:RR,peak};
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
check(hard.peak<=Math.pow(10,1.6/20)&&hard.peak>.001,`unsafe/silent grand peak ${hard.peak}`);
const bright=deriv(hard.L,0,.16*SR)/Math.max(1e-12,deriv(soft.L,0,.16*SR));check(bright>1.25,`felt hammer velocity brightness weak ${bright}`);
const bassPan=balance(bass,.05*SR,.8*SR),treblePan=balance(treble,.05*SR,.8*SR);check(bassPan<-.025&&treblePan>.02,`keyboard radiation stereo image missing ${bassPan}/${treblePan}`);
const f0=261.625565,h1=toneMag(hard.L,f0),h2=toneMag(hard.L,f0*2),h3=toneMag(hard.L,f0*3);check(h2>h1*.12&&h3>h1*.05,`string harmonic spectrum too sparse ${h1}/${h2}/${h3}`);
const p60=Math.abs(estimate(hard.L,.45*SR,1.35*SR,f0)),p76=Math.abs(estimate(treble.L,.35*SR,1.35*SR,659.255114));check(p60<=15&&p76<=15,`concert grand pitch error ${p60}/${p76} cent`);
// Keep a broad C4 plausibility guard while the Salamander-derived fixture and
// full-range evaluator cover the complete 30-center × 16-layer reference set.
// The two-microphone recording and physical model have different spectra, so
// harmonic ratios here are sanity bounds rather than a per-partial fitting target.
const realCal=render({pitch:60,velocity:.82,seconds:1.6,noteOff:null});
const rc1=toneMag(realCal.L,f0,.03,.18),rc2=toneMag(realCal.L,f0*2,.03,.18),rc3=toneMag(realCal.L,f0*3,.03,.18),rc4=toneMag(realCal.L,f0*4,.03,.18),rc5=toneMag(realCal.L,f0*5,.03,.18);
const rr2=rc2/Math.max(1e-12,rc1),rr3=rc3/Math.max(1e-12,rc1),rr4=rc4/Math.max(1e-12,rc1),rr5=rc5/Math.max(1e-12,rc1);
check(rr2>.30&&rr2<1.20,`C4 h2 plausibility ${rr2}`);check(rr3>.03&&rr3<.45,`C4 h3 plausibility ${rr3}`);check(rr4>.02&&rr4<.50,`C4 h4 plausibility ${rr4}`);check(rr5>.02&&rr5<.50,`C4 h5 plausibility ${rr5}`);
const refDecayEarly=rms(realCal.L,.08*SR,.25*SR),refDecayMid=rms(realCal.L,.25*SR,.60*SR),refDecayRatio=refDecayMid/Math.max(1e-12,refDecayEarly);check(refDecayRatio>.40&&refDecayRatio<1.02,`C4 early decay plausibility ${refDecayRatio}`);
const tail1=rms(release.L,1.10*SR,1.35*SR),tail2=rms(release.L,1.8*SR,2.1*SR),tail3=rms(release.L,2.8*SR,3.2*SR);check(tail1>.0003&&tail2>.00015,`soundboard release tail missing ${tail1}/${tail2}`);check(tail3<tail2*.55,`damper/soundboard tail fails to decay ${tail2}/${tail3}`);
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
const boardOff=render({pitch:60,velocity:.72,seconds:.8,noteOff:null,over:{piano_soundboard_mix:0,piano_sympathetic:0}});
const boardOn=render({pitch:60,velocity:.72,seconds:.8,noteOff:null,over:{piano_soundboard_mix:.62,piano_sympathetic:0}});
const boardOffRms=rms(boardOff.L,.08*SR,.55*SR),boardOnRms=rms(boardOn.L,.08*SR,.55*SR);
check(boardOffRms<boardOnRms*.35,`soundboard zero-mix is not a true radiation bypass ${boardOffRms}/${boardOnRms}`);

const bassSoftDyn=render({pitch:41,velocity:.25,seconds:.8,noteOff:null}),bassMidDyn=render({pitch:41,velocity:.55,seconds:.8,noteOff:null}),bassHardDyn=render({pitch:41,velocity:.90,seconds:.8,noteOff:null});
const bassSoftBright=deriv(bassSoftDyn.L,.03*SR,.18*SR),bassMidBright=deriv(bassMidDyn.L,.03*SR,.18*SR),bassHardBright=deriv(bassHardDyn.L,.03*SR,.18*SR);
check(bassMidBright>bassSoftBright*1.05&&bassHardBright>bassMidBright*1.05,`bass felt velocity shape regressed ${bassSoftBright}/${bassMidBright}/${bassHardBright}`);
console.log('PASS concert grand regression',{pitchC4:+p60.toFixed(1),pitchE5:+p76.toFixed(1),velocityBrightness:+bright.toFixed(2),bassPan:+bassPan.toFixed(3),treblePan:+treblePan.toFixed(3),h2:+(h2/h1).toFixed(3),h3:+(h3/h1).toFixed(3),tail1:+tail1.toFixed(6),tail2:+tail2.toFixed(6),tail3:+tail3.toFixed(6),boardDiff:+boardDiff.toFixed(6),feltContactDiff:+feltContactDiff.toFixed(6),dispersionDiff:+dispersionDiff.toFixed(6),unisonDiff:+unisonDiff.toFixed(6),boardSizeDiff:+boardSizeDiff.toFixed(6),lowBassBuzz:+lowBassBuzz.toFixed(4),boardOffRatio:+(boardOffRms/Math.max(1e-12,boardOnRms)).toFixed(3),bassVelocityShape:+(bassMidBright/Math.max(1e-12,bassSoftBright)).toFixed(2),refH2:+rr2.toFixed(3),refH3:+rr3.toFixed(3),refH4:+rr4.toFixed(3),refH5:+rr5.toFixed(3),refDecay:+refDecayRatio.toFixed(3),peak:+hard.peak.toFixed(4)});
