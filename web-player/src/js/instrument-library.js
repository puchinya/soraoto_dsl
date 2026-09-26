(() => {
"use strict";

const caches=new WeakMap();
const SUPER_SYNTH_URL="wasm/plugins/dsp/super-synth/plugin.wasm";
const DRUM_PLUGIN_URL="wasm/plugins/dsp/drum-machine/plugin.wasm";
function resources(ctx){let r=caches.get(ctx);if(!r){r={noise:null,pluck:new Map(),curves:new Map()};caches.set(ctx,r);}return r;}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function hz(p){return 440*Math.pow(2,(p-69)/12);}
function val(x){return x&&typeof x==="object"&&"value" in x?x.value:x;}
function descriptorPreset(track){const p=track.instrumentDescriptor?.params?.preset;return p!=null?String(val(p)):null;}
function presetFor(track){
  const explicit=descriptorPreset(track);if(explicit)return explicit;
  const inst=String(track.instrument||"").toLowerCase(),name=String(track.name||"").toLowerCase();
  if(inst.includes("epiano")||name.includes("epiano")||name.includes("electric piano"))return "ep_bell";
  if(inst.includes("piano"))return "concert_grand";
  if(inst.includes("bass"))return name.includes("sub")?"sub_bass":"picked_bass";
  if(inst.includes("guitar"))return /drive|dist|rock|rhythm/.test(name)?"driven_guitar":"clean_guitar";
  if(name.includes("pad"))return "airy_pad";
  if(inst.includes("violin")||inst.includes("string"))return "strings_wide";
  if(inst.includes("organ"))return "organ_drawbar";
  if(inst.includes("harp"))return "harp_glass";
  if(inst.includes("sax"))return "sax_warm";
  if(inst.includes("brass"))return "brass_pop";
  if(inst.includes("wind")||inst.includes("flute"))return "flute_air";
  if(inst.includes("vocal")||inst.includes("voice"))return "vocal_ah";
  if(name.includes("arp")||name.includes("counter")||name.includes("hook"))return "bright_pluck";
  if(name.includes("lead")||name.includes("vocalguide"))return "supersaw_lead";
  if(name.includes("bell")||name.includes("mallet"))return "digital_bell";
  return "soft_keys";
}
function superSynthPresetFor(track){
  if(!track||track.instrumentDescriptor?.kind==="wasm-plugin")return null;
  if(!(track.events||[]).some(e=>e.type==="note"))return null;
  return presetFor(track);
}
function drumPresetFor(track){
  const n=String(track?.name||"").toLowerCase(),i=String(track?.instrument||"").toLowerCase();
  if(/edm|techno|electro|club/.test(n+" "+i))return "edm";
  if(/rock|metal/.test(n+" "+i))return "rock";
  if(/lofi|lo-fi|chill/.test(n+" "+i))return "lofi";
  if(/pop|anime|jpop|j-pop/.test(n+" "+i))return "pop";
  return "studio";
}
function drumPitchFor(event){
  const n=String(event?.drum||"").toLowerCase().replace(/[._\s-]/g,"");
  if(n.includes("kick"))return 36;
  if(n.includes("bassdrum"))return 35;
  if(n.includes("clap"))return 39;
  if(n.includes("snare"))return 38;
  if(n.includes("rim"))return 37;
  if(n.includes("openhat")||n.includes("openhihat"))return 46;
  if(n.includes("pedalhat")||n.includes("pedalhihat"))return 44;
  if(n.includes("hat")||n.includes("hihat"))return 42;
  if(n.includes("floor")&&n.includes("low"))return 41;
  if(n.includes("floor")||n.includes("tomlow"))return 43;
  if(n.includes("tom")&&n.includes("high"))return 50;
  if(n.includes("tom"))return 47;
  if(n.includes("ride"))return 51;
  if(n.includes("crash")||n.includes("cymbal"))return 49;
  return 42;
}
function panConnect(ctx,node,dest,pan){if(ctx.createStereoPanner){const p=ctx.createStereoPanner();p.pan.value=clamp(Number(pan)||0,-1,1);node.connect(p);p.connect(dest);return p;}node.connect(dest);return dest;}
function env(ctx,{t0,end,attack=.01,decay=.1,sustain=.7,release=.2,peak=.1}){const g=ctx.createGain(),a=Math.max(.001,attack),d=Math.max(.001,decay),r=Math.max(.01,release);g.gain.setValueAtTime(.0001,t0);g.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),t0+a);const ds=Math.min(end,t0+a+d);g.gain.exponentialRampToValueAtTime(Math.max(.0002,peak*sustain),ds);g.gain.setValueAtTime(Math.max(.0002,peak*sustain),end);g.gain.exponentialRampToValueAtTime(.0001,end+r);return {gain:g,stop:end+r+.03};}
function osc(ctx,type,freq,t0,stop,detune=0){const o=ctx.createOscillator();o.type=type;o.frequency.value=freq;o.detune.value=detune;o.start(t0);o.stop(stop);return o;}
function noiseBuffer(ctx){const r=resources(ctx);if(r.noise)return r.noise;const b=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*2),ctx.sampleRate),d=b.getChannelData(0);let z=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;z=z*.12+w*.88;d[i]=z;}r.noise=b;return b;}
function driveCurve(ctx,amount=.4){const r=resources(ctx),key=amount.toFixed(2);if(r.curves.has(key))return r.curves.get(key);const n=2048,c=new Float32Array(n),k=1+amount*18;for(let i=0;i<n;i++){const x=i/(n-1)*2-1;c[i]=Math.tanh(k*x)/Math.tanh(k);}r.curves.set(key,c);return c;}
function peak(event,track,base=.1){
  return Math.min(.105,base*.68*clamp(event.velocity||.8,0,1.2)*clamp(track.gain??1,0,2));
}
function trackBrightness(track){return clamp(Number(track.brightness)||1,.25,2);}

function basicLayer(ctx,dest,pitch,event,track,t0,duration,opt){
  const end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:opt.attack,decay:opt.decay,sustain:opt.sustain,release:opt.release,peak:peak(event,track,opt.amp)});
  const filter=ctx.createBiquadFilter();filter.type=opt.filterType||"lowpass";filter.frequency.value=clamp((opt.cutoff||8000)*trackBrightness(track),40,19000);filter.Q.value=opt.q||.3;
  const mix=ctx.createGain();mix.gain.value=1;mix.connect(filter);filter.connect(gain);panConnect(ctx,gain,dest,track.pan);
  const nodes=[];for(const spec of opt.oscs){const o=osc(ctx,spec.type,hz(pitch)*(spec.ratio||1),t0,stop,spec.detune||0),g=ctx.createGain();g.gain.value=spec.gain;o.connect(g);g.connect(mix);nodes.push(o);}
  return nodes;
}

function softPiano(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:.004,decay:.42,sustain:.20,release:.48,peak:peak(event,track,.115)}),filter=ctx.createBiquadFilter();filter.type="lowpass";filter.frequency.value=clamp((3600+f*5)*trackBrightness(track),1800,11000);filter.Q.value=.45;filter.connect(gain);panConnect(ctx,gain,dest,track.pan);const nodes=[];[["triangle",1,1],["sine",2.01,.21],["sine",3.98,.08],["sine",6.03,.035]].forEach(([type,ratio,mix])=>{const o=osc(ctx,type,f*ratio,t0,stop),g=ctx.createGain();g.gain.value=mix;o.connect(g);g.connect(filter);nodes.push(o);});return nodes;}
function epBell(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:.003,decay:.55,sustain:.24,release:.7,peak:peak(event,track,.105)}),carrier=osc(ctx,"sine",f,t0,stop),mod=osc(ctx,"sine",f*2.01,t0,stop),modGain=ctx.createGain(),tone=ctx.createBiquadFilter();modGain.gain.setValueAtTime(f*2.0,t0);modGain.gain.exponentialRampToValueAtTime(Math.max(1,f*.06),Math.min(stop,t0+.7));mod.connect(modGain);modGain.connect(carrier.frequency);tone.type="lowpass";tone.frequency.value=9000;carrier.connect(tone);tone.connect(gain);panConnect(ctx,gain,dest,track.pan);return [carrier,mod];}
function pickedBass(ctx,dest,pitch,event,track,t0,duration){return basicLayer(ctx,dest,pitch,event,track,t0,duration,{attack:.004,decay:.12,sustain:.58,release:.12,amp:.145,cutoff:1100,q:1.1,oscs:[{type:"sawtooth",gain:.68},{type:"sine",gain:.62},{type:"triangle",ratio:2,gain:.08}]});}
function subBass(ctx,dest,pitch,event,track,t0,duration){return basicLayer(ctx,dest,pitch,event,track,t0,duration,{attack:.008,decay:.08,sustain:.86,release:.16,amp:.16,cutoff:520,q:.35,oscs:[{type:"sine",gain:1},{type:"triangle",gain:.24}]});}
function supersaw(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:.009,decay:.16,sustain:.72,release:.28,peak:peak(event,track,.08)}),filter=ctx.createBiquadFilter();filter.type="lowpass";filter.frequency.value=clamp(7000*trackBrightness(track),1800,15000);filter.Q.value=.7;filter.connect(gain);panConnect(ctx,gain,dest,track.pan);const nodes=[],dets=[-19,-9,0,9,19];for(const d of dets){const o=osc(ctx,"sawtooth",f,t0,stop,d),g=ctx.createGain();g.gain.value=.20;o.connect(g);g.connect(filter);nodes.push(o);}return nodes;}
function brightPluck(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+Math.min(duration,.35),{gain,stop}=env(ctx,{t0,end,attack:.002,decay:.085,sustain:.08,release:.15,peak:peak(event,track,.11)}),filter=ctx.createBiquadFilter();filter.type="lowpass";filter.frequency.setValueAtTime(clamp(10000*trackBrightness(track),3000,16000),t0);filter.frequency.exponentialRampToValueAtTime(1800,Math.min(stop,t0+.18));filter.Q.value=1.3;filter.connect(gain);panConnect(ctx,gain,dest,track.pan);const a=osc(ctx,"sawtooth",f,t0,stop,-5),b=osc(ctx,"square",f,t0,stop,5),ga=ctx.createGain(),gb=ctx.createGain();ga.gain.value=.72;gb.gain.value=.18;a.connect(ga);b.connect(gb);ga.connect(filter);gb.connect(filter);return[a,b];}
function airyPad(ctx,dest,pitch,event,track,t0,duration){return basicLayer(ctx,dest,pitch,event,track,t0,duration,{attack:.38,decay:.7,sustain:.78,release:1.7,amp:.055,cutoff:4800,q:.28,oscs:[{type:"sawtooth",gain:.28,detune:-13},{type:"sawtooth",gain:.28,detune:13},{type:"triangle",gain:.34,detune:-5},{type:"triangle",gain:.34,detune:5}]});}
function strings(ctx,dest,pitch,event,track,t0,duration){const nodes=basicLayer(ctx,dest,pitch,event,track,t0,duration,{attack:.14,decay:.45,sustain:.84,release:.9,amp:.06,cutoff:6200,q:.22,oscs:[{type:"sawtooth",gain:.30,detune:-8},{type:"sawtooth",gain:.30,detune:8},{type:"triangle",gain:.28}]});return nodes;}
function brass(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:.035,decay:.18,sustain:.76,release:.22,peak:peak(event,track,.082)}),filter=ctx.createBiquadFilter();filter.type="lowpass";filter.Q.value=1.2;filter.frequency.setValueAtTime(950,t0);filter.frequency.exponentialRampToValueAtTime(clamp(5200*trackBrightness(track),1800,9000),t0+.09);filter.frequency.exponentialRampToValueAtTime(2800,Math.min(end,t0+.28));filter.connect(gain);panConnect(ctx,gain,dest,track.pan);const a=osc(ctx,"sawtooth",f,t0,stop,-4),b=osc(ctx,"square",f,t0,stop,4),ga=ctx.createGain(),gb=ctx.createGain();ga.gain.value=.68;gb.gain.value=.18;a.connect(ga);b.connect(gb);ga.connect(filter);gb.connect(filter);return[a,b];}
function organ(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:.008,decay:.03,sustain:.96,release:.12,peak:peak(event,track,.075)});panConnect(ctx,gain,dest,track.pan);const partials=[[1,.62],[2,.42],[3,.20],[4,.16],[6,.09],[8,.05]],nodes=[];for(const [ratio,mix] of partials){const o=osc(ctx,"sine",f*ratio,t0,stop),g=ctx.createGain();g.gain.value=mix;o.connect(g);g.connect(gain);nodes.push(o);}return nodes;}
function digitalBell(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+Math.min(duration,.4),{gain,stop}=env(ctx,{t0,end,attack:.001,decay:.75,sustain:.025,release:1.25,peak:peak(event,track,.09)}),carrier=osc(ctx,"sine",f,t0,stop),mod=osc(ctx,"sine",f*3.01,t0,stop),mg=ctx.createGain();mg.gain.setValueAtTime(f*4,t0);mg.gain.exponentialRampToValueAtTime(f*.08,Math.min(stop,t0+.8));mod.connect(mg);mg.connect(carrier.frequency);carrier.connect(gain);panConnect(ctx,gain,dest,track.pan);return[carrier,mod];}
function pluckBuffer(ctx,pitch){const r=resources(ctx),key=Math.round(pitch);if(r.pluck.has(key))return r.pluck.get(key);const f=hz(key),seconds=2,len=Math.ceil(ctx.sampleRate*seconds),delay=Math.max(2,Math.round(ctx.sampleRate/f)),b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<delay;i++)d[i]=(Math.random()*2-1)*.82;const damp=key<48?.9965:key>72?.9885:.993;for(let i=delay;i<len;i++)d[i]=(d[i-delay]+d[Math.max(0,i-delay-1)])*.5*damp;r.pluck.set(key,b);return b;}
function guitar(ctx,dest,pitch,event,track,t0,duration,driven){const src=ctx.createBufferSource(),base=Math.round(pitch);src.buffer=pluckBuffer(ctx,base);src.playbackRate.value=Math.pow(2,(pitch-base)/12);const lp=ctx.createBiquadFilter(),body=ctx.createBiquadFilter(),g=ctx.createGain();lp.type="lowpass";lp.frequency.value=driven?6500:5200;lp.Q.value=.42;body.type="peaking";body.frequency.value=driven?330:205;body.Q.value=.85;body.gain.value=driven?1.5:3;const end=t0+Math.min(1.8,Math.max(.25,duration+.35));g.gain.setValueAtTime(peak(event,track,driven?.11:.12),t0);g.gain.exponentialRampToValueAtTime(.0001,end);src.connect(lp);let tail=lp;if(driven){const ws=ctx.createWaveShaper();ws.curve=driveCurve(ctx,.32);ws.oversample="2x";tail.connect(ws);tail=ws;}tail.connect(body);body.connect(g);panConnect(ctx,g,dest,track.pan);src.start(t0);src.stop(end+.03);return[src];}
function flute(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:.07,decay:.12,sustain:.82,release:.18,peak:peak(event,track,.07)}),tone=osc(ctx,"sine",f,t0,stop),harm=osc(ctx,"sine",f*2,t0,stop),hg=ctx.createGain();hg.gain.value=.09;tone.connect(gain);harm.connect(hg);hg.connect(gain);const ns=ctx.createBufferSource(),ng=ctx.createGain(),bp=ctx.createBiquadFilter();ns.buffer=noiseBuffer(ctx);bp.type="bandpass";bp.frequency.value=4500;bp.Q.value=.7;ng.gain.value=.012*event.velocity;ns.connect(bp);bp.connect(ng);ng.connect(gain);ns.start(t0,0,Math.min(2,stop-t0));panConnect(ctx,gain,dest,track.pan);return[tone,harm,ns];}
function vocal(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+duration,{gain,stop}=env(ctx,{t0,end,attack:.035,decay:.12,sustain:.8,release:.25,peak:peak(event,track,.065)}),src=osc(ctx,"sawtooth",f,t0,stop),pre=ctx.createGain();pre.gain.value=.5;src.connect(pre);const sum=ctx.createGain();for(const [freq,q,mix] of [[800,7,.65],[1150,8,.45],[2900,10,.22]]){const bp=ctx.createBiquadFilter(),bg=ctx.createGain();bp.type="bandpass";bp.frequency.value=freq;bp.Q.value=q;bg.gain.value=mix;pre.connect(bp);bp.connect(bg);bg.connect(sum);}sum.connect(gain);panConnect(ctx,gain,dest,track.pan);return[src];}
function harp(ctx,dest,pitch,event,track,t0,duration){const f=hz(pitch),end=t0+Math.min(duration,.45),{gain,stop}=env(ctx,{t0,end,attack:.002,decay:.5,sustain:.06,release:1.1,peak:peak(event,track,.095)}),filter=ctx.createBiquadFilter();filter.type="lowpass";filter.frequency.value=9500;filter.connect(gain);panConnect(ctx,gain,dest,track.pan);const nodes=[];[["triangle",1,.7],["sine",2,.24],["sine",3,.12],["sine",5,.05]].forEach(([type,ratio,mix])=>{const o=osc(ctx,type,f*ratio,t0,stop),g=ctx.createGain();g.gain.value=mix;o.connect(g);g.connect(filter);nodes.push(o);});return nodes;}


function drumGain(track,event,base){
  return base*.66*clamp(event.velocity||.8,0,1.2)*clamp(track.gain??1,0,2);
}
function drumKick(ctx,dest,event,track,t0){const body=ctx.createOscillator(),sub=ctx.createOscillator(),g=ctx.createGain(),sg=ctx.createGain();body.type="sine";sub.type="sine";body.frequency.setValueAtTime(155,t0);body.frequency.exponentialRampToValueAtTime(47,t0+.105);sub.frequency.setValueAtTime(72,t0);sub.frequency.exponentialRampToValueAtTime(42,t0+.16);g.gain.setValueAtTime(drumGain(track,event,.28),t0);g.gain.exponentialRampToValueAtTime(.0001,t0+.24);sg.gain.setValueAtTime(drumGain(track,event,.12),t0);sg.gain.exponentialRampToValueAtTime(.0001,t0+.28);body.connect(g);sub.connect(sg);g.connect(dest);sg.connect(dest);body.start(t0);sub.start(t0);body.stop(t0+.25);sub.stop(t0+.3);return[body,sub];}
function drumSnare(ctx,dest,event,track,t0){const ns=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),ng=ctx.createGain(),tone=ctx.createOscillator(),tg=ctx.createGain();ns.buffer=noiseBuffer(ctx);bp.type="bandpass";bp.frequency.value=2100;bp.Q.value=.65;ng.gain.setValueAtTime(drumGain(track,event,.19),t0);ng.gain.exponentialRampToValueAtTime(.0001,t0+.19);tone.type="triangle";tone.frequency.setValueAtTime(205,t0);tone.frequency.exponentialRampToValueAtTime(155,t0+.10);tg.gain.setValueAtTime(drumGain(track,event,.075),t0);tg.gain.exponentialRampToValueAtTime(.0001,t0+.13);ns.connect(bp);bp.connect(ng);ng.connect(dest);tone.connect(tg);tg.connect(dest);ns.start(t0,0,.22);tone.start(t0);tone.stop(t0+.14);return[ns,tone];}
function drumClap(ctx,dest,event,track,t0){const nodes=[];for(const d of [0,.018,.036]){const ns=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),g=ctx.createGain();ns.buffer=noiseBuffer(ctx);hp.type="highpass";hp.frequency.value=1200;g.gain.setValueAtTime(drumGain(track,event,.095),t0+d);g.gain.exponentialRampToValueAtTime(.0001,t0+d+.075);ns.connect(hp);hp.connect(g);g.connect(dest);ns.start(t0+d,Math.random()*.2,.09);nodes.push(ns);}return nodes;}
function drumHat(ctx,dest,event,track,t0,open){const ns=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),bp=ctx.createBiquadFilter(),g=ctx.createGain();ns.buffer=noiseBuffer(ctx);hp.type="highpass";hp.frequency.value=6500;bp.type="bandpass";bp.frequency.value=9500;bp.Q.value=.6;const len=open?.32:.065;g.gain.setValueAtTime(drumGain(track,event,open?.075:.065),t0);g.gain.exponentialRampToValueAtTime(.0001,t0+len);ns.connect(hp);hp.connect(bp);bp.connect(g);g.connect(dest);ns.start(t0,Math.random()*.4,len+.03);return[ns];}
function drumTom(ctx,dest,event,track,t0){const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.setValueAtTime(185,t0);o.frequency.exponentialRampToValueAtTime(105,t0+.19);g.gain.setValueAtTime(drumGain(track,event,.19),t0);g.gain.exponentialRampToValueAtTime(.0001,t0+.32);o.connect(g);g.connect(dest);o.start(t0);o.stop(t0+.34);return[o];}
function drumCymbal(ctx,dest,event,track,t0,ride){const ns=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),g=ctx.createGain();ns.buffer=noiseBuffer(ctx);hp.type="highpass";hp.frequency.value=ride?4800:3800;const len=ride?.8:1.4;g.gain.setValueAtTime(drumGain(track,event,ride?.055:.07),t0);g.gain.exponentialRampToValueAtTime(.0001,t0+len);ns.connect(hp);hp.connect(g);g.connect(dest);ns.start(t0,Math.random()*.2,Math.min(1.8,len+.1));const bell=ctx.createOscillator(),bg=ctx.createGain();bell.type="square";bell.frequency.value=ride?2850:4100;bg.gain.setValueAtTime(drumGain(track,event,ride?.016:.010),t0);bg.gain.exponentialRampToValueAtTime(.0001,t0+(ride?.35:.18));bell.connect(bg);bg.connect(dest);bell.start(t0);bell.stop(t0+(ride?.38:.2));return[ns,bell];}
function drumRim(ctx,dest,event,track,t0){const o=ctx.createOscillator(),g=ctx.createGain(),bp=ctx.createBiquadFilter();o.type="triangle";o.frequency.value=720;bp.type="bandpass";bp.frequency.value=2400;bp.Q.value=2.4;g.gain.setValueAtTime(drumGain(track,event,.09),t0);g.gain.exponentialRampToValueAtTime(.0001,t0+.055);o.connect(bp);bp.connect(g);g.connect(dest);o.start(t0);o.stop(t0+.06);return[o];}
function scheduleDrumVoice(ctx,dest,event,track,t0){const n=String(event.drum||"").toLowerCase();let nodes;if(n.includes("kick")||n.includes("bassdrum"))nodes=drumKick(ctx,dest,event,track,t0);else if(n.includes("clap"))nodes=drumClap(ctx,dest,event,track,t0);else if(n.includes("snare"))nodes=drumSnare(ctx,dest,event,track,t0);else if(n.includes("rim"))nodes=drumRim(ctx,dest,event,track,t0);else if(n.includes("open")&&n.includes("hat"))nodes=drumHat(ctx,dest,event,track,t0,true);else if(n.includes("hat"))nodes=drumHat(ctx,dest,event,track,t0,false);else if(n.includes("tom"))nodes=drumTom(ctx,dest,event,track,t0);else if(n.includes("ride"))nodes=drumCymbal(ctx,dest,event,track,t0,true);else if(n.includes("crash")||n.includes("cymbal"))nodes=drumCymbal(ctx,dest,event,track,t0,false);else nodes=drumHat(ctx,dest,event,track,t0,false);return{nodes};}
function scheduleDrum(ctx,dest,event,track,t0){
  let voiceResult=null;
  const life=attachVoiceLifetime(ctx,dest,voiceDest=>{
    voiceResult=scheduleDrumVoice(ctx,voiceDest,event,track,t0);
    return voiceResult?.nodes||[];
  });
  return {nodes:life.nodes,dispose:life.dispose,done:life.done};
}

const handlers={concert_grand:softPiano,soft_piano:softPiano,ep_bell:epBell,picked_bass:pickedBass,sub_bass:subBass,supersaw_lead:supersaw,bright_pluck:brightPluck,airy_pad:airyPad,strings_wide:strings,synth_strings:strings,brass_pop:brass,organ_drawbar:organ,digital_bell:digitalBell,clean_guitar:(...a)=>guitar(...a,false),driven_guitar:(...a)=>guitar(...a,true),flute_air:flute,vocal_ah:vocal,harp_glass:harp,soft_keys:epBell};
function attachVoiceLifetime(ctx,dest,makeNodes){
  // Every note/drum gets a tiny root bus. Internal filters/gains/panners only
  // connect to this bus. Once every scheduled source for the voice has ended,
  // disconnecting the root detaches the entire subgraph from the live mix and
  // makes it collectible. This prevents long songs from accumulating thousands
  // of silent AudioNodes on iOS/Safari.
  const root=ctx.createGain();
  root.gain.value=1;
  root.connect(dest);
  const nodes=makeNodes(root)||[];
  let remaining=nodes.length,disposed=false,resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const dispose=()=>{
    if(disposed)return;
    disposed=true;
    try{root.disconnect();}catch{}
    resolveDone?.();resolveDone=null;
  };
  if(!remaining){dispose();return {nodes,dispose,done};}
  const ended=()=>{
    remaining--;
    if(remaining<=0)dispose();
  };
  for(const n of nodes){
    if(n?.addEventListener)n.addEventListener("ended",ended,{once:true});
    else if(n){
      const old=n.onended;
      n.onended=()=>{try{old?.();}finally{ended();}};
    }else ended();
  }
  return {nodes,dispose,done};
}

function schedule(ctx,dest,pitch,event,track,t0,duration){
  const preset=presetFor(track),fn=handlers[preset]||epBell;
  const life=attachVoiceLifetime(ctx,dest,voiceDest=>fn(ctx,voiceDest,pitch,event,track,t0,duration));
  return {preset,nodes:life.nodes,dispose:life.dispose,done:life.done};
}
function releaseContext(ctx){if(ctx)caches.delete(ctx);}
window.SoraotoInstruments={
  schedule,scheduleDrum,presetFor,superSynthPresetFor,superSynthUrl:SUPER_SYNTH_URL,releaseContext,
  drumPresetFor,drumPitchFor,drumPluginUrl:DRUM_PLUGIN_URL,
  presets:Object.keys(handlers)
};
})();
