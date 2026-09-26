const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));
function assert(x,m){if(!x)throw new Error(m);}
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs;
assert(catalog.length===22,`expected 22 songs, got ${catalog.length}`);
const counts={};
for(const s of catalog){
  counts[s.category]=(counts[s.category]||0)+1;
  const src=fs.readFileSync(path.join(R,"public/songs",s.file),"utf8");
  const ir=SoraotoCompiler.compile(src);
  const errors=ir.diagnostics.filter(d=>d.kind==="error");
  if(errors.length){
    console.error("FAIL",s.id,errors);
    process.exitCode=1;
    continue;
  }
  console.log("PASS",s.category,s.id,{events:ir.events.length,tracks:ir.tracks.length,length:ir.length});
}
assert(counts["J-POP"]===4,"J-POP count");
assert(counts["Anime"]===4,"Anime count");
assert(counts["Game Battle"]===2,"battle count");
assert(counts["Game Field"]===2,"field count");
assert(counts["Techno"]===4,"techno count");
assert(counts["Jazz"]===2,"jazz count");
assert(counts["Chopin"]===4,"Chopin count");
if(process.exitCode)process.exit(process.exitCode);
console.log("PASS new catalog",counts);
