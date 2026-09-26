const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');const R=path.resolve(__dirname,'..');
const ctx={window:{},console};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(R,'src/js/compiler.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(R,'src/js/plugin-registry.js'),'utf8'),ctx);
const cat=JSON.parse(fs.readFileSync(path.join(R,'public/songs/index.json'),'utf8')).songs;
let songs=0,effects=0,resolved=0,unresolved=[];
for(const s of cat){const file=path.join(R,'public/songs',s.file);if(!fs.existsSync(file))continue;const ir=ctx.SoraotoCompiler.compile(fs.readFileSync(file,'utf8'));const errs=(ir.diagnostics||[]).filter(d=>d.kind==='error');assert.strictEqual(errs.length,0,`${s.id}: compile errors`);songs++;
 for(const n of ir.audioGraph.nodes||[])for(const fx of n.effects||[]){effects++;const hit=ctx.SoraotoPluginRegistry.resolveEffect(fx,{tempo:ir.tempo});if(hit)resolved++;else if(fx.kind==='plugin'||fx.kind==='component')unresolved.push(`${s.id}/${n.id}/${fx.name}`);}}
assert.deepStrictEqual(unresolved,[],`unresolved plugin effects: ${unresolved.join(', ')}`);
console.log('PASS all plugin resolution',{songs,effects,resolved});
