const fs=require("fs");const path=require("path");const R=path.resolve(__dirname,"..");
function check(x,m){if(!x)throw new Error(m);}
const html=fs.readFileSync(path.join(R,"index.html"),"utf8");
const compiler=fs.readFileSync(path.join(R,"src/js","compiler.js"),"utf8");
const readme=fs.readFileSync(path.join(R,"README.md"),"utf8");
const profile=fs.readFileSync(path.join(R,"docs","specs","reference-player-profile.md"),"utf8");
const catalog=JSON.parse(fs.readFileSync(path.join(R,"public/songs","index.json"),"utf8")).songs;
check(html.includes('js/compiler.js?v='),"compiler.js is not loaded");
check(!html.includes('compiler-v4.js')&&!html.includes('compiler-v5.js'),"layered legacy compiler still published");
check(!fs.existsSync(path.join(R,'src/js','compiler-v4.js'))&&!fs.existsSync(path.join(R,'src/js','compiler-v5.js')),"legacy compiler file exists");
check(compiler.includes('LANGUAGE_VERSION="Draft v0.5"'),"Draft v0.5 language identity missing");
check(compiler.includes('COMPONENT_ABI="soraoto:component@1.0.0"'),"Component ABI identity missing");
check(compiler.includes('PLUGIN_ABI="1.0"'),"Plugin ABI identity missing");
check(compiler.includes("import dsp is not supported"),"legacy import rejection missing");
check(compiler.includes("const is removed; use immutable let bindings"),"v0.5 const rejection missing");
check(compiler.includes('soraoto-vocal-v1'),"v0.5 lyric dialect missing");
check(/Draft v0\.5/.test(readme),"README is not Draft v0.5");
check(/Language:\s+soraotoDSL Draft v0\.5/.test(profile),"reference-player language profile missing");
for(const song of catalog){const src=fs.readFileSync(path.join(R,"public/songs",song.file),"utf8");check(!/\bimport\s+dsp\b/.test(src),`${song.id}: legacy import dsp`);check(!/\bconst\s+[A-Za-z_]\w*\s*=/.test(src),`${song.id}: removed const binding`);}
console.log("PASS Draft v0.5 publication",{songs:catalog.length,compiler:"single",pluginAbi:"1.0"});
