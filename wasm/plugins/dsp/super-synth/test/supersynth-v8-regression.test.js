const path=require('path');
const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'),FILE='plugins/dsp/super-synth/plugin.wasm';
function check(x,m){if(!x)throw new Error(m)}
function stats(xs){let s=0,p=0;for(const x of xs){check(Number.isFinite(x),'non-finite');s+=x*x;p=Math.max(p,Math.abs(x));}return{rms:Math.sqrt(s/Math.max(1,xs.length)),peak:p}}
function diff(a,b){let s=0,n=Math.min(a.length,b.length);for(let i=0;i<n;i++){const d=a[i]-b[i];s+=d*d}return Math.sqrt(s/Math.max(1,n))}
function render(preset,over={},pitch=64,blocks=100){const h=new PluginHarness(R,FILE);h.applyPreset(preset);for(const[k,v]of Object.entries(over))h.setPlain(k,v);const xs=[];for(let b=0;b<blocks;b++){const ev=b===0?[{kind:1,noteId:1,pitch,velocity:.83,offset:0}]:[];xs.push(...h.process(128,{events:ev})[0][0]);}h.close();return xs}

const probe=new PluginHarness(R,FILE),d=probe.descriptor;probe.close();
check(d.version==='8.0.0',`version ${d.version}`);check(d.parameters.length===157,`params ${d.parameters.length}`);
for(const p of ['mod1_source','mod4_amount','voice_mode','note_priority','polyphony_limit','sustain_pedal','sostenuto_pedal','hard_sync','sync_ratio','fm_source','phase_distortion','adaptive_quality','cpu_budget'])check(d.parameters.some(x=>x.path===p),`missing ${p}`);

// Mod matrix: velocity -> pitch must produce a clearly distinct but safe render.
const mod0=render('soft_lead',{mod1_source:'off'},64,80),mod1=render('soft_lead',{mod1_source:'velocity',mod1_destination:'pitch',mod1_amount:.42},64,80);
const modDiff=diff(mod0,mod1);check(modDiff>2e-4,`mod matrix inactive ${modDiff}`);check(stats(mod1).peak<1.2,'mod unsafe');

// Wavetable v8: sync, spectral-resolution/phase-distortion and FM-source selection.
const sync0=render('pulse_motion',{hard_sync:0,phase_distortion:0,fm_amount:.28},72,70),sync1=render('pulse_motion',{hard_sync:.9,sync_ratio:2.5,phase_distortion:.34,fm_amount:.28},72,70);
const syncDiff=diff(sync0,sync1);check(syncDiff>2e-4,`sync/PD inactive ${syncDiff}`);
const fmA=render('ring_texture',{fm_source:'b_to_a',fm_amount:.48},69,70),fmB=render('ring_texture',{fm_source:'a_to_b',fm_amount:.48},69,70),fmDiff=diff(fmA,fmB);check(fmDiff>1e-4,`fm source inactive ${fmDiff}`);

// Vocal formant and physical-body destinations are live destinations, not metadata-only.
const vocal0=render('vocal_ah',{mod1_source:'off'},60,70),vocal1=render('vocal_ah',{mod1_source:'velocity',mod1_destination:'formant',mod1_amount:.65},60,70);check(diff(vocal0,vocal1)>1e-5,'formant matrix inactive');
const body0=render('picked_bass',{mod1_source:'off'},43,70),body1=render('picked_bass',{mod1_source:'velocity',mod1_destination:'body_resonance',mod1_amount:.7},43,70);check(diff(body0,body1)>1e-5,'body matrix inactive');

// Mono-legato priority: releasing the newest note returns to the still-held note.
{
 const h=new PluginHarness(R,FILE);h.applyPreset('mono_lead');h.setPlain('amp_release',.004);h.setPlain('voice_mode','legato');h.setPlain('note_priority','last');
 h.process(128,{events:[{kind:1,noteId:1,pitch:60,velocity:.8}]});for(let i=0;i<16;i++)h.process(128);
 h.process(128,{events:[{kind:1,noteId:2,pitch:67,velocity:.8}]});for(let i=0;i<10;i++)h.process(128);
 h.process(128,{events:[{kind:2,noteId:2,pitch:67,velocity:0}]});let tail=[];for(let i=0;i<30;i++)tail.push(...h.process(128)[0][0]);
 check(stats(tail).rms>1e-4,'legato priority failed to return to held note');h.close();
}

// Sustain and sostenuto retain released notes, then release cleanly when pedal lifts.
for(const pedal of ['sustain_pedal','sostenuto_pedal']){
 const h=new PluginHarness(R,FILE);h.applyPreset('soft_lead');h.setPlain('amp_release',.006);h.setPlain(pedal,true);
 h.process(128,{events:[{kind:1,noteId:10,pitch:62,velocity:.82}]});for(let i=0;i<14;i++)h.process(128);
 h.process(128,{events:[{kind:2,noteId:10,pitch:62,velocity:0}]});let held=[];for(let i=0;i<18;i++)held.push(...h.process(128)[0][0]);
 h.setPlain(pedal,false);let released=[];for(let i=0;i<24;i++)released.push(...h.process(128)[0][0]);
 const a=stats(held).rms,b=stats(released).rms;check(a>2e-4,`${pedal} did not hold`);check(b<a*.6,`${pedal} did not release ${a}/${b}`);h.close();
}

// Remaining sweep coverage: pitch, resonance, FM and all oversampling modes.
let maxPeak=0,cases=0;
for(const os of ['x1','x2','x4'])for(const res of [.05,.7,.92])for(const fm of [0,.35,.8]){
 const xs=render('supersaw_lead',{oversample:os,adaptive_quality:false,filter_resonance:res,fm_amount:fm},res>.8?88:52,26),st=stats(xs);check(st.rms>1e-6,`silent ${os}/${res}/${fm}`);check(st.peak<1.2,`unsafe ${os}/${res}/${fm}: ${st.peak}`);maxPeak=Math.max(maxPeak,st.peak);cases++;
}
console.log('PASS SuperSynth v8 regression',{params:d.parameters.length,modDiff:+modDiff.toFixed(5),syncDiff:+syncDiff.toFixed(5),fmDiff:+fmDiff.toFixed(5),sweepCases:cases,maxPeak:+maxPeak.toFixed(4)});
