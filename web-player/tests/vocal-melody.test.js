const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));

function assert(x,m){if(!x)throw new Error(m);}
function trackBlock(src,name){
  const start=src.indexOf(`track ${name}`);
  if(start<0)return "";
  let open=src.indexOf("{",start),d=1,i=open+1,q=null,esc=false;
  for(;i<src.length&&d;i++){
    const ch=src[i];
    if(q){
      if(esc)esc=false;
      else if(ch==="\\")esc=true;
      else if(ch===q)q=null;
      continue;
    }
    if(ch==='"'||ch==="'"){q=ch;continue;}
    if(ch==="{")d++;
    else if(ch==="}")d--;
  }
  return src.slice(start,i);
}

const files=[
  "blue-summer.soraoto","midnight-platform.soraoto","first-snow.soraoto",
  "skyline-rush.soraoto","afterimage-protocol.soraoto","prism-parade.soraoto"
];

for(const file of files){
  const src=fs.readFileSync(path.join(R,"public/songs",file),"utf8");
  const ir=SoraotoCompiler.compile(src);
  const errs=ir.diagnostics.filter(d=>d.kind==="error");
  assert(!errs.length,`${file}: ${JSON.stringify(errs)}`);

  const lead=ir.tracks.find(t=>t.name==="Lead");
  assert(lead&&lead.events.length>70,`${file}: missing vocal lead`);

  const pitches=lead.events.flatMap(e=>e.pitches||[]);
  const range=Math.max(...pitches)-Math.min(...pitches);
  assert(range<=28,`${file}: vocal range too wide (${range} semitones)`);

  const leadSrc=trackBlock(src,"Lead");
  const rel=(leadSrc.match(/(?:^|\s)(?:\+|-|\+\d+|-\d+)(?=\s|,)/gm)||[]).length;
  const sustains=(leadSrc.match(/(?:^|\s)~(?=\s|,)/gm)||[]).length;
  const explicitRests=(leadSrc.match(/(?:^|\s)_(?=\s|,)/gm)||[]).length;
  const silentBars=(leadSrc.match(/^\s*,\s*$/gm)||[]).length;

  // 36 bars × 8 eighth-note slots. Underfilled bars terminated by comma
  // intentionally become rests, so compiled event density is the robust
  // measure of whether the melody leaves vocal breathing room.
  const density=lead.events.length/(36*8);

  assert(rel>=24,`${file}: relative pitch notation underused`);
  assert(sustains>=20,`${file}: not enough held vocal notes`);
  assert(density<0.68,`${file}: vocal line too dense (${density.toFixed(2)})`);
  assert(density>0.22,`${file}: vocal line too sparse (${density.toFixed(2)})`);

  console.log("PASS vocal melody",file,{
    leadEvents:lead.events.length,
    rangeSemitones:range,
    relativeTokens:rel,
    sustains,
    explicitRests,
    silentBars,
    density:Number(density.toFixed(3))
  });
}
