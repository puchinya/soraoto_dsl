const path=require('path');
const {PluginHarness,ext}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'), FILE='plugins/dsp/super-synth/plugin.wasm', SR=48000;
function check(x,m){if(!x)throw new Error(m)}
function rms(a,s,e){let q=0,n=0;for(let i=s;i<Math.min(e,a.length);i++){q+=a[i]*a[i];n++;}return Math.sqrt(q/Math.max(1,n));}
function derivRatio(a,s,e){let q=0,p=0,n=0;for(let i=Math.max(1,s);i<Math.min(e,a.length);i++){const d=a[i]-a[i-1];q+=d*d;p+=a[i]*a[i];n++;}return Math.sqrt(q/Math.max(1,n))/Math.max(1e-12,Math.sqrt(p/Math.max(1,n)));}
function toneMag(a,f,s=.04,e=.70){let re=0,im=0,wSum=0;const i0=Math.floor(s*SR),i1=Math.min(a.length,Math.floor(e*SR));for(let i=i0;i<i1;i++){const w=.5-.5*Math.cos(2*Math.PI*(i-i0)/Math.max(1,i1-i0-1)),ph=2*Math.PI*f*i/SR;re+=a[i]*w*Math.cos(ph);im-=a[i]*w*Math.sin(ph);wSum+=w;}return Math.hypot(re,im)/Math.max(1e-12,wSum);}
function render({pitch=60,velocity=.72,seconds=2.3}={}){
  const h=new PluginHarness(R,FILE,{sampleRate:SR,maxFrames:128}); h.applyPreset('soft_piano');
  const N=Math.floor(seconds*SR), L=new Float64Array(N), RR=new Float64Array(N); let pos=0,peak=0;
  while(pos<N){const n=Math.min(128,N-pos),ev=pos===0?[{kind:1,noteId:1,pitch,velocity,offset:0}]:[];const o=h.process(n,{events:ev})[0];L.set(o[0],pos);RR.set(o[1],pos);for(let i=0;i<n;i++){check(Number.isFinite(o[0][i])&&Number.isFinite(o[1][i]),'non-finite piano sample');peak=Math.max(peak,Math.abs(o[0][i]),Math.abs(o[1][i]));}pos+=n;}h.close();return {L,R:RR,peak};
}
function balance(x,s,e){const l=rms(x.L,s,e),r=rms(x.R,s,e);return (r-l)/Math.max(1e-12,r+l)}
const probe=new PluginHarness(R,FILE);const preset=ext(probe.descriptor).presets.soft_piano;probe.close();
check(preset.engine_model==='piano','soft_piano must use piano model');
for(const k of ['osc_a_level','osc_b_level','sub_level','noise_level'])check(Number(preset[k]||0)===0,`soft_piano synth leakage: ${k}`);
check(preset.oversample==='x1','soft_piano must avoid unnecessary oversampling in the physical piano path');
check(Number(preset.saturation||0)===0,'soft_piano must keep the acoustic path free of synth saturation');
check(Number(preset.piano_hammer_noise||0)<=.30,'soft_piano hammer noise must not dominate felt contact');
const soft=render({pitch:60,velocity:.25}), medium=render({pitch:60,velocity:.72}), hard=render({pitch:60,velocity:.9}), bass=render({pitch:40}), treble=render({pitch:76});
const early=[0,7200],late=[72000,105600];
const softBright=derivRatio(soft.L,...early),hardBright=derivRatio(hard.L,...early);
check(hardBright>softBright*1.035,`hammer velocity brightness weak ${softBright}/${hardBright}`);
const bassTail=rms(bass.L,...late)/Math.max(1e-12,rms(bass.L,...early));
const trebleTail=rms(treble.L,...late)/Math.max(1e-12,rms(treble.L,...early));
check(bassTail>trebleTail*1.6,`key-dependent piano decay weak ${bassTail}/${trebleTail}`);
const bassPan=balance(bass,...early),treblePan=balance(treble,...early);
check(bassPan<-.03&&treblePan>.01,`piano keyboard stereo image missing ${bassPan}/${treblePan}`);
const f0=261.625565, fundamental=toneMag(medium.L,f0), second=toneMag(medium.L,f0*2), third=toneMag(medium.L,f0*3), falseFifth=toneMag(medium.L,f0*1.5);
check(second>fundamental*.20&&third>fundamental*.05,`piano harmonic string spectrum too sparse ${fundamental}/${second}/${third}`);
check(falseFifth<second*.08,`piano contains synthetic 1.5x sympathetic pitch ${falseFifth}/${second}`);
check(hard.peak<.95,`piano unsafe peak ${hard.peak}`);
console.log('PASS piano realism regression',{velocityBrightness:+(hardBright/softBright).toFixed(3),bassTail:+bassTail.toFixed(4),trebleTail:+trebleTail.toFixed(4),bassPan:+bassPan.toFixed(3),treblePan:+treblePan.toFixed(3),h2:+(second/fundamental).toFixed(3),h3:+(third/fundamental).toFixed(3),falseFifth:+(falseFifth/second).toFixed(4),peak:+hard.peak.toFixed(4)});
