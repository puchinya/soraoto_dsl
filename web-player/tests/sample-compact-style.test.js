const fs=require("fs");
const path=require("path");
global.window=global;
const R=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(R,"src/js/compiler.js"),"utf8"));

function assert(x,m){if(!x)throw new Error(m);}
const files=[
 "blue-summer.soraoto","midnight-platform.soraoto","first-snow.soraoto",
 "skyline-rush.soraoto","afterimage-protocol.soraoto","prism-parade.soraoto"
];

for(const file of files){
  const src=fs.readFileSync(path.join(R,"public/songs",file),"utf8");
  assert(/\)\s*\*\s*[248]/.test(src),`${file}: repeat syntax is not used`);
  assert(/notes\s*\{[\s\S]*?@8:\s*(?:,\s*){4}/m.test(src),`${file}: comma-only rest bars are not used`);
  assert(!/_ _ _ _ _ _ _ _ ,/.test(src),`${file}: verbose full-rest bar remains`);
  assert(/!(?:p|mp|mf|f|ff):/.test(src),`${file}: dynamics aliases are not used`);
  const ir=SoraotoCompiler.compile(src);
  const errs=ir.diagnostics.filter(d=>d.kind==="error");
  assert(!errs.length,`${file}: ${JSON.stringify(errs)}`);
  const lead=ir.tracks.find(t=>t.name==="Lead");
  const hook=ir.tracks.find(t=>t.name==="CounterHook");
  assert(lead?.events.length>70,`${file}: lead unexpectedly sparse`);
  assert(hook,`${file}: CounterHook missing`);
  console.log("PASS compact sample",file,{
    chars:src.length,
    leadEvents:lead.events.length,
    counterEvents:hook.events.length
  });
}
