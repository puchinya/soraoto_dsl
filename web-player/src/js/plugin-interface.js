(() => {
"use strict";
const SECTION="soraoto.interface";
const ALLOWED_TYPES=new Set(["Int","Float","Bool","String","Norm","Hz","Db","Time","Bpm","Semitone","Cent","Pan","Width"]);
function fail(m){throw new Error(`soraoto.interface: ${m}`);}
function matchBrace(s,open){let d=1,q=null,esc=false;for(let i=open+1;i<s.length;i++){const c=s[i];if(q){if(esc)esc=false;else if(c==="\\")esc=true;else if(c===q)q=null;}else if(c==='"'||c==="'")q=c;else if(c==="{")d++;else if(c==="}"&&!--d)return i;}return -1;}
function findOuter(source){const m=/\bplugin\s+interface\s+([A-Za-z_]\w*)\s*\{/.exec(source);if(!m)fail("plugin interface declaration missing");const open=source.indexOf("{",m.index),end=matchBrace(source,open);if(end<0)fail("unbalanced plugin interface");if(source.slice(end+1).trim())fail("content after plugin interface declaration");return {name:m[1],body:source.slice(open+1,end)};}
function blocks(src,keyword){const out=[];let pos=0,re=new RegExp(`\\b${keyword}\\b`,'g');while(true){re.lastIndex=pos;const m=re.exec(src);if(!m)break;const open=src.indexOf('{',m.index+m[0].length);if(open<0)break;const end=matchBrace(src,open);if(end<0)fail(`unbalanced ${keyword}`);out.push({head:src.slice(m.index,open).trim(),body:src.slice(open+1,end)});pos=end+1;}return out;}
function prop(body,name,pattern="([^\\s}]+)",fallback=null){const m=new RegExp(`\\b${name}\\s*:\\s*${pattern}`).exec(body);return m?m[1]:fallback;}
function scalar(token,type,enums){let s=String(token).trim().replace(/,$/,'');if(type==='Bool'){if(s!=='true'&&s!=='false')fail(`invalid Bool ${s}`);return s==='true';}if(type.startsWith('Enum<')){const v=enums[type.slice(5,-1)]||[],i=v.indexOf(s);if(i<0)fail(`invalid enum value ${s}`);return i;}let mul=1;for(const [u,k] of [['khz',1000],['hz',1],['ms',.001],['s',1]])if(s.toLowerCase().endsWith(u)){s=s.slice(0,-u.length);mul=k;break;}const n=Number(s);if(!Number.isFinite(n))fail(`invalid scalar ${token}`);return type==='Int'?Math.round(n*mul):n*mul;}
function normalizeSource(source){if(source.startsWith('\ufeff'))fail('BOM forbidden');if(source.includes('\r'))fail('LF line endings required');if(!source.endsWith('\n'))fail('final LF required');if(source!==source.normalize('NFC'))fail('Unicode NFC required');return source;}
function parse(source){
  normalizeSource(source);
  for(const re of [/\bproject\s*\{/,/\btrack\s+\w+\s*\{/,/\bnotes\s*\{/,/\bdrums\s*\{/,/\blyrics\s*\{/,/\bpattern\s+/,/\bmacro\s+/,/\bfn\s+\w+\s*\([^)]*\)\s*\{/])if(re.test(source))fail(`executable construct forbidden: ${re}`);
  const outer=findOuter(source),body=outer.body,enums={};for(const m of body.matchAll(/\benum\s+(\w+)\s*\{([^}]*)\}/g))enums[m[1]]=m[2].trim().split(/\s+/).filter(Boolean);
  const str=n=>prop(body,n,'"([^"]*)"',null);
  const abi=str('abi');if(abi!=="1.0")fail('abi must be "1.0"');
  const kind=prop(body,'kind','([A-Za-z_][\\w-]*)',null);if(!kind)fail('kind missing');
  const id=str('id'),name=str('name'),version=str('version');for(const [k,v] of Object.entries({id,name,version}))if(!v)fail(`${k} missing`);
  const controlModulationMaxQuantum=Number(prop(body,'control_modulation_max_quantum','(\\d+)','64'));if(!Number.isInteger(controlModulationMaxQuantum)||controlModulationMaxQuantum<1)fail('control_modulation_max_quantum invalid');
  const params=[];
  for(const b of blocks(body,'parameter')){
    const m=/^parameter\s+([A-Za-z_][\w.]*)\s*:\s*([^\s{]+)/.exec(b.head);if(!m)continue;
    const path=m[1],type=m[2],enumName=type.startsWith('Enum<')&&type.endsWith('>')?type.slice(5,-1):null;if(!enumName&&!ALLOWED_TYPES.has(type))fail(`${path}: unsupported type ${type}`);if(enumName&&!enums[enumName])fail(`${path}: unknown enum ${enumName}`);
    const pid=Number(prop(b.body,'id','(\\d+)',null));if(!Number.isInteger(pid)||pid<1||pid>0xfffffffe)fail(`${path}: invalid id`);
    const defTok=prop(b.body,'default');if(defTok==null)fail(`${path}: default missing`);
    const enumValues=enumName?enums[enumName]:null;const rr=/\brange\s*:\s*([^\s}]+)\.\.([^\s}]+)/.exec(b.body);let min=null,max=null;
    if(rr){min=scalar(rr[1],type,enums);max=scalar(rr[2],type,enums);if(!(Number(min)<Number(max)))fail(`${path}: invalid range`);}else if(enumValues){min=0;max=enumValues.length-1;}
    const ptype=enumName?'enum':({Bool:'bool',Int:'int',String:'string'}[type]||'float');
    const unit=({Norm:'norm',Hz:'hz',Db:'db',Time:'seconds',Bpm:'bpm',Semitone:'semitone',Cent:'cent',Pan:'pan',Width:'width'}[type]||'none');
    const scaleToken=prop(b.body,'scale','([A-Za-z_]+)','linear');const scale=scaleToken==='logarithmic'?'log':scaleToken;if(!['linear','log'].includes(scale))fail(`${path}: unsupported scale ${scaleToken}`);
    const automation=prop(b.body,'automation','([A-Za-z_]+)','none');if(!['none','sample_accurate'].includes(automation))fail(`${path}: invalid automation ${automation}`);
    const mk=prop(b.body,'modulation','([A-Za-z_]+)','none');if(!['none','control','audio'].includes(mk))fail(`${path}: invalid modulation ${mk}`);let modulation={kind:mk};if(mk==='control')modulation.max_quantum_samples=controlModulationMaxQuantum;
    if(['bool','int','enum'].includes(ptype)&&modulation.kind==='audio')fail(`${path}: discrete parameter cannot use audio-rate modulation`);
    const smoothing=prop(b.body,'smoothing','([^\\s}]+)',null);
    params.push({path,type,id:pid,ptype,unit,default:scalar(defTok,type,enums),min,max,enumValues,scale,automation,modulation,smoothing});
  }
  if(new Set(params.map(p=>p.id)).size!==params.length)fail('duplicate parameter id');if(new Set(params.map(p=>p.path)).size!==params.length)fail('duplicate parameter path');
  const audioBlock=blocks(body,'audio')[0]?.body||'',eventBlock=blocks(body,'events')[0]?.body||'';
  const audio=[...audioBlock.matchAll(/\b(input|output)\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g)].map(m=>({direction:m[1],name:m[2],type:m[3]}));
  const events=[...eventBlock.matchAll(/\b(input|output)\s+([A-Za-z_]\w*)\s*:\s*"([^"]+)"/g)].map(m=>({direction:m[1],name:m[2],dialect:m[3]}));
  return {interfaceName:outer.name,abiMajor:1,abiMinor:0,id,name,version,kind,controlModulationMaxQuantum,params,audio,events};
}
function eqNum(a,b){return (a==null&&b==null)||(Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<1e-9);}
function validateDescriptor(model,d){
  if(model.abiMajor!==d.abi_major||model.abiMinor!==d.abi_minor)fail('ABI mismatch');for(const k of ['id','name','version'])if(model[k]!==d[k])fail(`${k} mismatch`);if(!Array.isArray(d.kinds)||d.kinds.length!==1||d.kinds[0]!==model.kind)fail('kind mismatch');
  const dp=new Map((d.parameters||[]).map(p=>[p.path,p]));if(dp.size!==model.params.length)fail('parameter count mismatch');
  for(const p of model.params){const q=dp.get(p.path);if(!q)fail(`${p.path}: descriptor entry missing`);if(q.id!==p.id||q.type!==p.ptype||q.unit!==p.unit)fail(`${p.path}: id/type/unit mismatch`);if(!eqNum(q.default,p.default)||!eqNum(q.min,p.min)||!eqNum(q.max,p.max))fail(`${p.path}: default/range mismatch`);if((q.scale?.kind||'linear')!==p.scale)fail(`${p.path}: scale mismatch`);if(q.automation!==p.automation)fail(`${p.path}: automation mismatch`);if((q.modulation?.kind||'none')!==p.modulation.kind)fail(`${p.path}: modulation mismatch`);if(p.modulation.kind==='control'&&Number(q.modulation.max_quantum_samples)!==p.modulation.max_quantum_samples)fail(`${p.path}: control quantum mismatch`);if(p.enumValues&&JSON.stringify(q.enum_values||[])!==JSON.stringify(p.enumValues))fail(`${p.path}: enum mismatch`);}
  const db=d.audio_buses||[];if(model.audio.length!==db.length)fail('audio bus count mismatch');for(const a of model.audio){const q=db.find(x=>x.direction===a.direction&&String(x.name).toLowerCase().includes(a.name.toLowerCase()));if(!q)fail(`audio bus ${a.direction} ${a.name} missing`);if(a.type==='AudioStereo'){const l=q.supported_layouts?.[0];if(!l||l.kind!=='speakers'||JSON.stringify(l.channels)!==JSON.stringify(['L','R']))fail(`audio bus ${a.name}: AudioStereo mismatch`);}}
  const eb=d.event_buses||[];if(model.events.length!==eb.length)fail('event bus count mismatch');for(const e of model.events){const q=eb.find(x=>x.direction===e.direction&&(x.dialects||[]).includes(e.dialect));if(!q)fail(`event bus ${e.direction} ${e.dialect} missing`);}return model;
}
function validateModule(module,descriptor){const sections=WebAssembly.Module.customSections(module,SECTION);if(sections.length>1)fail(`custom section count ${sections.length}`);if(!sections.length)return null;let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(sections[0]);}catch{fail('invalid UTF-8');}return validateDescriptor(parse(source),descriptor);}
window.SoraotoPluginInterface={SECTION,parse,validateDescriptor,validateModule};
})();
