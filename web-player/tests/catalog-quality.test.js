const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));
function check(x,m){if(!x)throw new Error(m);}
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs;
const expected={"J-POP":4,"Anime":4,"Game Battle":2,"Game Field":2,"Techno":4,"Jazz":2,"Chopin":4};
const counts={};
for(const song of catalog)counts[song.category]=(counts[song.category]||0)+1;
check(JSON.stringify(counts)===JSON.stringify(expected),`catalog distribution mismatch ${JSON.stringify(counts)}`);
for(const song of catalog){
  const src=fs.readFileSync(path.join(R,"public/songs",song.file),"utf8");
  const ir=SoraotoCompiler.compile(src);
  const errs=ir.diagnostics.filter(d=>d.kind==="error");
  check(!errs.length,`${song.id}: ${JSON.stringify(errs)}`);
  if(song.category!=="Chopin"){
    const structureEnd=(ir.structure||[]).at(-1)?.endBeat||0;
    check(Math.abs(ir.length-structureEnd)<0.001,`${song.id}: playback length ${ir.length} != structure ${structureEnd}`);
    check(src.includes("chords Harmony"),`${song.id}: harmony timeline missing`);
    check(/!(?:mp|mf|f|ff):/.test(src),`${song.id}: dynamics not used`);
    check((ir.tracks||[]).length>=4,`${song.id}: arrangement too thin`);
    check(src.includes("Limiter"),`${song.id}: master limiter missing`);
  }else{
    check(/track RightHand/.test(src)&&/track LeftHand/.test(src),`${song.id}: two-hand piano score missing`);
    check((ir.tracks||[]).length===2,`${song.id}: Chopin sample must remain piano-focused`);
    check(/complete original piano work/.test(song.style),`${song.id}: catalog must identify complete Chopin work`);
    check(/Chopin — /.test(song.title),`${song.id}: Chopin title missing composer attribution`);
  }
}
console.log("PASS catalog quality",{songs:catalog.length,categories:counts});
