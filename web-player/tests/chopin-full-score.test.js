const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));
function check(x,m){if(!x)throw new Error(m);}
const expected={
  "chopin-prelude-op28-no4":{beats:101,minEvents:240,label:"25-measure complete score"},
  "chopin-prelude-op28-no7":{beats:49,minEvents:70,label:"16-measure complete score"},
  "chopin-prelude-op28-no20":{beats:52,minEvents:110,label:"13-measure complete score"},
  "chopin-waltz-a-minor-b150":{beats:241,minEvents:590,label:"57 written / 81 performance measures"},
};
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs;
for(const [id,want] of Object.entries(expected)){
  const song=catalog.find(x=>x.id===id); check(song,`${id}: missing from catalog`);
  const src=fs.readFileSync(path.join(R,"public/songs",song.file),"utf8");
  const ir=SoraotoCompiler.compile(src);
  const errors=ir.diagnostics.filter(d=>d.kind==="error");
  check(!errors.length,`${id}: ${JSON.stringify(errors)}`);
  check(Math.abs(ir.length-want.beats)<1e-6,`${id}: expected ${want.beats} beats, got ${ir.length}`);
  check(ir.events.length>=want.minEvents,`${id}: score too sparse (${ir.events.length})`);
  check(ir.tracks.length===2,`${id}: expected exactly RH/LH tracks`);
  check(ir.tracks.some(t=>t.name==="RightHand")&&ir.tracks.some(t=>t.name==="LeftHand"),`${id}: missing piano hand`);
  check(!/\)\s*\*\s*\d+/.test(src),`${id}: abbreviated loop remains in full score`);
  check(!/\bstructure\s*\{[\s\S]{0,500}\bA\s*\{\s*bars:\s*8/.test(src),`${id}: old 8-bar sketch structure remains`);
  console.log("PASS full Chopin score",id,{beats:ir.length,events:ir.events.length,label:want.label});
}
const waltz=fs.readFileSync(path.join(R,"public/songs","chopin-waltz-a-minor-b150.soraoto"),"utf8");
check(/81 performance measures/.test(waltz),"B.150: repeat-unfold provenance missing");
