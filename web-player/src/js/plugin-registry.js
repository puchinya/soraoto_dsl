(() => {
"use strict";

const registry=new Map();
const aliases=new Map();

function key(name){return String(name||"").trim().toLowerCase().replace(/[\s_-]+/g,"");}
function raw(prop,fallback=null){return prop?.raw ?? prop?.value ?? fallback;}
function value(prop,fallback=null){return prop?.value ?? fallback;}
function secondsFromMusical(input,tempo){
  const s=String(raw(input,input??"")).trim();
  let m=s.match(/^(\d+)\/(\d+)(d?)$/);
  if(m){let beats=4/Number(m[2]);if(m[3])beats*=1.5;return beats*60/tempo;}
  m=s.match(/^(-?\d+(?:\.\d+)?)(ms|s)$/i);
  if(m)return Number(m[1])*(m[2].toLowerCase()==="ms"?.001:1);
  const n=Number(value(input,input));return Number.isFinite(n)?n:0;
}
function cloneProps(props){return Object.fromEntries(Object.entries(props||{}).map(([k,v])=>[k,v]));}
function register(name,spec){
  const canonical=key(name);registry.set(canonical,Object.freeze({name,...spec}));aliases.set(canonical,canonical);
  for(const alias of spec.aliases||[])aliases.set(key(alias),canonical);
}
function lookup(name){const canonical=aliases.get(key(name))||key(name);return registry.get(canonical)||null;}

register("Gain",{
  module:"wasm/plugins/effects/gain/plugin.wasm",
  aliases:["PluginGain","WasmGain"],
  onlyPluginKind:true,
  fallback:"bypass"
});
register("StereoDelay",{
  module:"wasm/plugins/effects/stereo-delay/plugin.wasm",
  aliases:["Stereo Delay"],
  fallback:"native-delay",
  mapProps(fx,{tempo}){
    const props=cloneProps(fx.props),ff=(fx.children||[]).find(c=>key(c.name)==="feedbackfilter"),mode=String(raw(props.mode,"ping_pong"));
    delete props.mode;
    props.time={value:secondsFromMusical(props.time??"1/8d",tempo)};
    props.left={value:secondsFromMusical(props.left??0,tempo)};
    props.right={value:secondsFromMusical(props.right??0,tempo)};
    props.ping_pong={value:mode==="ping_pong"};
    if(ff?.props?.high_pass!=null)props.feedback_high_pass=ff.props.high_pass;
    if(ff?.props?.low_pass!=null)props.feedback_low_pass=ff.props.low_pass;
    return props;
  }
});
register("Sidechain",{
  module:"wasm/plugins/effects/sidechain/plugin.wasm",
  aliases:["SidechainDucker","Sidechain Ducker"],
  sidechain:true,
  fallback:"native-sidechain"
});
register("Reverb",{
  module:"wasm/plugins/effects/reverb/plugin.wasm",
  aliases:["SoraotoReverb","Soraoto Reverb"],
  fallback:"mute-on-bus"
});
register("ChannelStrip",{
  module:"wasm/plugins/effects/channel-strip/plugin.wasm",
  aliases:["Channel Strip","SoraotoChannelStrip","Soraoto Channel Strip"],
  fallback:"bypass"
});
register("Limiter",{
  module:"wasm/plugins/effects/master-limiter/plugin.wasm",
  aliases:["MasterLimiter","Master Limiter","True Peak Master Limiter"],
  fallback:"native-limiter"
});

function resolveEffect(fx,{tempo=120,placement=null}={}){
  if(!fx)return null;
  // Explicit imported plugins always win over built-ins with the same display name.
  if(fx.kind==="plugin"&&fx.module)return {name:fx.name,module:fx.module,props:cloneProps(fx.props),sidechain:false,fallback:"bypass",external:true};
  const spec=lookup(fx.name);if(!spec)return null;
  if(spec.onlyPluginKind&&fx.kind!=="plugin")return null;
  const props=spec.mapProps?spec.mapProps(fx,{tempo}):cloneProps(fx.props);
  // Send/return buses must be wet-only. A dry component here duplicates the source
  // path at the master and causes level build-up / combing. Inserts retain their
  // authored mix value.
  if(placement?.ownerKind==="bus" && (spec.name==="Reverb" || spec.name==="StereoDelay")) props.mix={value:1,raw:"1"};
  return {name:spec.name,module:spec.module,props,sidechain:!!spec.sidechain,fallback:spec.fallback||"bypass",external:false};
}

window.SoraotoPluginRegistry={register,lookup,resolveEffect,entries:()=>[...registry.values()]};
})();
