const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));
eval(fs.readFileSync(path.join(R,"src/js/instrument-library.js"),"utf8"));
function check(x,m){if(!x)throw new Error(m);}
function namedBlock(src,kind,name){const re=new RegExp(`\\b${kind}\\s+${name}\\s*\\{`);const m=re.exec(src);if(!m)return "";const open=src.indexOf("{",m.index);let d=1,i=open+1,q=null;for(;i<src.length&&d;i++){const c=src[i];if(q){if(c===q&&src[i-1]!=="\\")q=null;}else if(c==='"'||c==="'")q=c;else if(c==="{")d++;else if(c==="}")d--;}return src.slice(open+1,i-1);}
const badPitchedPresets=new Set(["ring_texture","noise_riser","filter_motion","pulse_motion"]);
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs.filter(x=>x.category!=="Chopin");
for(const song of catalog){
  const src=fs.readFileSync(path.join(R,"public/songs",song.file),"utf8");
  const ir=SoraotoCompiler.compile(src); const errors=ir.diagnostics.filter(d=>d.kind==="error");
  check(!errors.length,`${song.id}: ${JSON.stringify(errors)}`);
  const lead=ir.tracks.find(t=>t.name==="Lead"); check(lead,`${song.id}: Lead missing`);
  const notes=(lead.events||[]).filter(e=>e.type==="note");
  const pcs=new Set(notes.flatMap(e=>e.pitches||[]).map(p=>((p%12)+12)%12));
  const durs=new Set(notes.map(e=>Math.round((e.duration||0)*1000)));
  check(notes.length>=120,`${song.id}: Lead too sparse (${notes.length})`);
  check(pcs.size>=7,`${song.id}: Lead pitch vocabulary too narrow (${pcs.size})`);
  check(durs.size>=2,`${song.id}: Lead rhythm too uniform`);
  const leadSrc=namedBlock(src,"track","Lead");
  check(!/\)\s*\*\s*\d+/.test(leadSrc),`${song.id}: Lead still uses copy-loop shorthand`);
  const preset=lead.instrumentDescriptor?.params?.preset?.value || window.SoraotoInstruments.presetFor(lead);
  if(preset)check(!badPitchedPresets.has(preset),`${song.id}: FX/motion preset ${preset} used as Lead timbre`);
  const counter=ir.tracks.find(t=>t.name==="Counter");
  if(counter){
    const ce=(counter.events||[]).filter(e=>e.type==="note");check(ce.length>=40,`${song.id}: Counter too sparse`);
    const cp=counter.instrumentDescriptor?.params?.preset?.value || window.SoraotoInstruments.presetFor(counter);
    if(cp)check(!badPitchedPresets.has(cp),`${song.id}: FX/motion preset ${cp} used as Counter timbre`);
  }
  const hook=ir.structure.find(s=>s.name==="Hook"),fin=ir.structure.find(s=>s.name==="Final");
  if(hook&&fin){
    const sig=sec=>notes.filter(e=>e.time>=sec.startBeat&&e.time<sec.endBeat).map(e=>[(e.time-sec.startBeat).toFixed(3),(e.pitches||[]).join("."),(e.duration||0).toFixed(3)]).join("|");
    check(sig(hook)!==sig(fin),`${song.id}: Final is an exact Hook copy`);
  }
  console.log("PASS modern song quality",song.id,{leadEvents:notes.length,pitchClasses:pcs.size,rhythms:durs.size,preset:preset||lead.instrument});
}
