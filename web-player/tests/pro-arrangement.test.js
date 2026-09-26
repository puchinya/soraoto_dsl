const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));
function check(x,m){if(!x)throw new Error(m);}
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs;
for(const song of catalog.filter(x=>x.category!=="Chopin")){
  const src=fs.readFileSync(path.join(R,"public/songs",song.file),"utf8");
  const ir=SoraotoCompiler.compile(src);
  const autos=ir.automations||[];
  check(autos.length>=3,`${song.id}: needs >=3 arrangement automations, got ${autos.length}`);
  check(src.includes("PRO_ARRANGEMENT_AUTOMATION_BEGIN"),`${song.id}: arrangement marker missing`);
  if(["J-POP","Anime","Game Battle","Techno","Jazz"].includes(song.category)){
    check(/humanize\s*\{/.test(src),`${song.id}: drums are not humanized`);
    const drums=(ir.tracks||[]).find(t=>t.name==="Drums");
    check(drums&&drums.events.length>0,`${song.id}: drum performance missing`);
    check(drums.events.some(e=>e.provenance?.kind==="humanize"),`${song.id}: humanize not lowered into IR`);
  }
  if(["J-POP","Anime","Game Battle"].includes(song.category)){
    check(/\bTom\s+"/.test(src),`${song.id}: transition tom fill missing`);
    check(/\bCrash\s+"/.test(src),`${song.id}: transition crash missing`);
    check(/\bOpenHat\s+"/.test(src),`${song.id}: open-hat lift missing`);
  }
  if(song.category==="Techno"){
    check(/\bClap\s+"/.test(src),`${song.id}: drop clap layer missing`);
    check(/\bOpenHat\s+"/.test(src),`${song.id}: offbeat open hat missing`);
  }
  if(song.category==="Jazz"){
    check(src.includes("@8t:"),`${song.id}: triplet-grid swing articulation missing`);
    check(/\bRide\s+"/.test(src),`${song.id}: ride pattern missing`);
  }
}
console.log("PASS pro arrangements",catalog.filter(x=>x.category!=="Chopin").length);
