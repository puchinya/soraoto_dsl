const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..');
const registrySrc=fs.readFileSync(path.join(root,'src/js/plugin-registry.js'),'utf8');
const graphSrc=fs.readFileSync(path.join(root,'src/js/audio-graph.js'),'utf8');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(registrySrc,ctx);
const R=ctx.window.SoraotoPluginRegistry;assert(R,'registry exported');
const expected={
  Gain:'wasm/plugins/effects/gain/plugin.wasm',
  Reverb:'wasm/plugins/effects/reverb/plugin.wasm',
  ChannelStrip:'wasm/plugins/effects/channel-strip/plugin.wasm',
  Limiter:'wasm/plugins/effects/master-limiter/plugin.wasm',
  Sidechain:'wasm/plugins/effects/sidechain/plugin.wasm',
  StereoDelay:'wasm/plugins/effects/stereo-delay/plugin.wasm',
};
for(const [name,module] of Object.entries(expected)){
  const hit=R.resolveEffect({name,kind:name==='Sidechain'||name==='StereoDelay'?'component':'plugin',module:null,props:{}},{tempo:120});
  assert(hit,`${name} resolves`);assert.strictEqual(hit.module,module,`${name} module`);
}
assert.strictEqual(R.resolveEffect({name:'Gain',kind:'primitive',props:{gain:{value:1}}},{tempo:120}),null,'primitive Gain remains native');
const delay=R.resolveEffect({name:'StereoDelay',kind:'component',props:{time:{raw:'1/8d'},feedback:{value:.4},mix:{value:.25},mode:{value:'ping_pong'}},children:[{name:'feedback_filter',props:{high_pass:{value:120},low_pass:{value:6500}}}]},{tempo:120});
assert(Math.abs(delay.props.time.value-.375)<1e-9,'musical delay converted to seconds');
assert.strictEqual(delay.props.ping_pong.value,true,'mode mapped to ping_pong');
assert.strictEqual(delay.props.feedback_high_pass.value,120,'nested high pass flattened');
assert.strictEqual(delay.props.feedback_low_pass.value,6500,'nested low pass flattened');
const external=R.resolveEffect({name:'Reverb',kind:'plugin',module:'plugins/custom-reverb.wasm',props:{mix:{value:.5}}},{tempo:120});
assert.strictEqual(external.module,'plugins/custom-reverb.wasm','explicit imported plugin wins');
assert.strictEqual(external.external,true,'external marked');
assert(graphSrc.includes('SoraotoPluginRegistry?.resolveEffect?.'),'audio graph delegates plugin resolution');
for(const module of Object.values(expected))assert(!graphSrc.includes(`SoraotoPluginHost.createEffect(ctx,"${module}"`),`audio graph does not hardcode ${module}`);
assert(graphSrc.includes('if(placement?.ownerKind==="bus"&&fx?.kind==="plugin")return createMutedEffect(ctx);'),'unresolved bus plugin is muted');
console.log('PASS plugin resolver',Object.keys(expected).length,'built-ins');
