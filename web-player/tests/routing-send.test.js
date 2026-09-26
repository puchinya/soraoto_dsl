const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));
function check(x,m){if(!x)throw new Error(m);}
const probe=`project {
 version: 1
 tempo: 120bpm
 meter: 4/4
 key: C.major
 structure { A { bars: 1 } }
 track Lead { instrument: piano gain: -10db A { notes { @4: c4, } } }
 bus D { gain: -3db }
 bus P { gain: -3db }
 routing {
   Lead -> Master
   Lead -> D { gain: -16db mode: post_fader }
   Lead -> P { gain: -12db mode: pre_fader }
   D -> Master
   P -> Master
 }
}`;
const pir=SoraotoCompiler.compile(probe);
const send=pir.audioGraph.edges.find(e=>e.from==="Lead"&&e.to==="D");
check(send,"inline send missing");
check(Number.isFinite(send.gain),`inline send gain non-finite: ${send.gain}`);
check(Math.abs(send.gain-Math.pow(10,-16/20))<1e-9,`bad send gain ${send.gain}`);
check(send.mode==="post_fader","inline mode parse failed");
const pre=pir.audioGraph.edges.find(e=>e.from==="Lead"&&e.to==="P");
check(pre,"pre-fader send missing");
check(pre.mode==="pre_fader","pre-fader mode parse failed");
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs;
for(const song of catalog){
 const ir=SoraotoCompiler.compile(fs.readFileSync(path.join(R,"public/songs",song.file),"utf8"));
 for(const e of ir.audioGraph.edges||[]) check(Number.isFinite(Number(e.gain)),`${song.id}: invalid routing gain ${e.gain}`);
}
const graph=fs.readFileSync(path.join(R,"src/js","audio-graph.js"),"utf8");
check(graph.includes("Number.isFinite(rawGain)?rawGain:1"),"AudioGraph finite-gain guard missing");
check(graph.includes('routeMode==="pre_fader"&&a.preFaderOutput'),"AudioGraph pre-fader tap selection missing");
check(graph.includes("const preFaderOutput=tail"),"AudioGraph pre-fader tap must be after inserts");
check(graph.includes("trackFader=ctx.createGain()"),"AudioGraph track fader stage missing");
const app=fs.readFileSync(path.join(R,"src/js","app.js"),"utf8");
check(app.includes("gain:expressionAt(track,event.time),pan:0"),"native sources still bake track fader gain into voices");
check(app.includes("const clipGain=clip.gain??1"),"audio clips still bake track fader gain before inserts");
console.log("PASS routing send",{post:send,pre});
