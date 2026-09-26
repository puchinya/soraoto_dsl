const fs=require('fs'),path=require('path');global.window=global;
const R=path.resolve(__dirname,'../../../../../');
const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
eval(fs.readFileSync(path.join(R,'web-player/src/js/compiler.js'),'utf8'));
function check(x,m){if(!x)throw new Error(m);}
const songsDir=path.join(R,'web-player', 'public/songs');
let duplicateScalar=0,explicitTracks=0;
for(const name of fs.readdirSync(songsDir).filter(x=>x.endsWith('.soraoto'))){
  const src=fs.readFileSync(path.join(songsDir,name),'utf8');
  if(src.includes('SuperSynth {')){
    const n=(src.match(/^\s*instrument:\s*synth\s*$/gm)||[]).length;
    duplicateScalar+=n;
    check(n===0,`${name}: legacy instrument: synth remains beside SuperSynth`);
  }
  const ir=SoraotoCompiler.compile(src);
  check(!(ir.diagnostics||[]).some(d=>d.kind==='error'),`${name}: compile error`);
  for(const t of ir.tracks||[])if(t.instrumentDescriptor?.name==='SuperSynth'){
    explicitTracks++;
    check(t.instrument==='SuperSynth',`${name}/${t.name}: IR instrument ${t.instrument}`);
  }
}
check(duplicateScalar===0,'duplicate scalar instruments remain');
check(explicitTracks>0,`no explicit SuperSynth tracks found`);

const html=fs.readFileSync(path.join(R,'web-player','index.html'),'utf8');
const m=html.match(/SORAOTO_BUILD_ID="([^"]+)"/);check(m&&m[1].length>0,'build id missing');
for(const f of ['compiler.js','plugin-host.js','audio-graph.js','instrument-library.js','app.js'])check(html.includes(`${f}?v=${m[1]}`),`${f}: build-id cache bust missing`);

const h=new PluginHarness(R,'plugins/dsp/super-synth/plugin.wasm',{sampleRate:48000,maxFrames:128});
const master=h.descriptor.parameters.find(p=>p.path==='master_gain');
check(master&&Number(master.default)<=0.2,`unsafe SuperSynth default master gain ${master?.default}`);
let peak=0;
for(let b=0;b<160;b++){
  const ev=b===0?[{kind:1,noteId:1,pitch:69,velocity:.8,offset:0}]:[];
  const o=h.process(128,{events:ev})[0];for(const ch of o)for(const x of ch)peak=Math.max(peak,Math.abs(x));
}
check(peak>0.001&&peak<0.15,`unsafe preset-less SuperSynth peak ${peak}`);
h.close();

// Descriptor IDs are 1=Pitch,2=Pressure,3=Timbre,4=Volume,5=Pan.
const x=new PluginHarness(R,'plugins/dsp/super-synth/plugin.wasm',{sampleRate:48000,maxFrames:128});x.applyPreset('octave_lead');
let pre=0,post=0;
for(let b=0;b<100;b++){
  const ev=[];if(b===0)ev.push({kind:1,noteId:7,pitch:64,velocity:.8,offset:0});
  if(b===40)ev.push({kind:3,noteId:7,expressionId:4,value:0,offset:0});
  const o=x.process(128,{events:ev})[0];let s=0,n=0;for(const ch of o)for(const v of ch){s+=v*v;n++;}
  const r=Math.sqrt(s/Math.max(1,n));if(b>=20&&b<35)pre+=r;if(b>=65&&b<90)post+=r;
}
x.close();
check(pre>1e-4,`volume expression probe silent ${pre}`);
check(post<pre*0.08,`expression id 4 is not Volume (${post}/${pre})`);


const app=fs.readFileSync(path.join(R,'web-player/src/js/app.js'),'utf8');
const graph=fs.readFileSync(path.join(R,'web-player/src/js/audio-graph.js'),'utf8');
const host=fs.readFileSync(path.join(R,'web-player/src/js/plugin-host.js'),'utf8');
const worklet=fs.readFileSync(path.join(R,'web-player/src/worklets/soraoto-plugin-processor.js'),'utf8');
check(host.includes('initialParameters:init.parameters'),'Plugin initial parameters must be transferred in processorOptions');
check(host.includes('factoryPresetRequest:init.factoryPresetRequest'),'factory preset must be transferred before Worklet ready');
const initPos=worklet.indexOf('this._initialize(o)'),readyPos=worklet.indexOf('this.port.postMessage({type:"ready"');
check(initPos>=0&&readyPos>initPos,'Worklet must initialize preset/parameters before ready');
check(worklet.includes('const initial=(o.initialParameters||[])'),'Worklet startup parameter application missing');
check(host.includes('node.setTransportOrigin'),'Plugin host transport-origin API missing');
check(worklet.includes('this.projectOriginFrame'),'Worklet project origin frame missing');
check(worklet.includes('authored:false'),'initial Plugin parameter state must not be treated as authored automation');
check(worklet.includes('!anchor.authored'),'pre-first-point linear interpolation guard missing');
check(graph.includes('n.setTransportOrigin?.(time)'),'Audio graph must align Plugin project origin to transport start');

check(graph.includes('const masterStartGain=ctx.createGain()'),'master startup gate missing');
check(graph.includes('gate.linearRampToValueAtTime(1,startAt+.015)'),'master startup fade missing');
check(graph.includes('soft_clip:{value:0}'),'final limiter must stay transparent below ceiling');
check(!graph.includes('soft_clip:{value:.08}'),'stale always-on final soft clip remains');
console.log('PASS playback safety regression',{explicitTracks,build:m[1],defaultPeak:+peak.toFixed(6),volumeExpressionRatio:+(post/pre).toFixed(6)});

check(worklet.includes('transport_origin'),'transport origin handling missing');
check(worklet.includes('trace_config'),'worklet trace config missing');
check(app.includes('debugEvent(\"meter.CLIP\"'),'GUI clip debug log missing');
