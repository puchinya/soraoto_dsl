const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));

function assert(x,m){if(!x)throw new Error(m);}
const files=[
  "blue-summer.soraoto",
  "midnight-platform.soraoto",
  "first-snow.soraoto",
  "skyline-rush.soraoto",
  "afterimage-protocol.soraoto",
  "prism-parade.soraoto",
];
for(const file of files){
  const src=fs.readFileSync(path.join(R,"public/songs",file),"utf8");
  const rel=(src.match(/(?:^|\s)(?:\+|-|\+\d+|-\d+)(?=\s|,)/gm)||[]).length;
  assert(rel>=12,`${file}: relative-note syntax is not meaningfully used (${rel})`);
  const ir=SoraotoCompiler.compile(src);
  const errors=ir.diagnostics.filter(d=>d.kind==="error");
  assert(!errors.length,`${file}: ${JSON.stringify(errors)}`);
  const lead=ir.tracks.find(t=>t.name==="Lead");
  assert(lead&&lead.events.length>20,`${file}: Lead did not compile`);
  console.log("PASS sample",file,{relativeTokens:rel,events:ir.events.length,leadEvents:lead.events.length});
}
