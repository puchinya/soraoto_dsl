const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));
function check(x,m){if(!x)throw new Error(m);}
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs;
const items=catalog.filter(x=>x.category==="Chopin");
check(items.length===4,`expected 4 Chopin works, got ${items.length}`);
const expected=[
  "Chopin — Prelude in E minor, Op. 28 No. 4",
  "Chopin — Prelude in A major, Op. 28 No. 7",
  "Chopin — Prelude in C minor, Op. 28 No. 20",
  "Chopin — Waltz in A minor, B. 150"
];
for(const title of expected)check(items.some(x=>x.title===title),`missing ${title}`);
for(const song of items){
  check(/Frédéric Chopin · complete original piano work/.test(song.style),`${song.id}: catalog not marked as Chopin work`);
  const ir=SoraotoCompiler.compile(fs.readFileSync(path.join(R,"public/songs",song.file),"utf8"));
  check(!ir.diagnostics.some(d=>d.kind==="error"),`${song.id}: compile error`);
  check(ir.tracks.length===2,`${song.id}: piano two-hand realization expected`);
}
for(const wrong of ["Ashen Moon","Velvet Stair","Winter Window","Rain of Ivory"])
  check(!items.some(x=>x.title.includes(wrong)),`generated Chopin-style title remains: ${wrong}`);
console.log("PASS Chopin-composed catalog",items.map(x=>x.title));
