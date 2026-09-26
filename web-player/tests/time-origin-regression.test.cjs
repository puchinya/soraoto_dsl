const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
let Processor=null;
class AWP{constructor(){this.port={postMessage(){},onmessage:null};}}
const context={AudioWorkletProcessor:AWP,registerProcessor:(n,k)=>{if(n==='soraoto-plugin-v1')Processor=k;},WebAssembly,Uint8Array,Float32Array,DataView,Map,Set,Number,Math,Error,console,currentFrame:999999,currentTime:5,sampleRate:48000};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/worklets','soraoto-plugin-processor.js'),'utf8'),context,{filename:'soraoto-plugin-processor.js'});
assert(Processor,'processor not registered');
const p=Object.create(Processor.prototype);
assert.equal(context.currentFrame,999999);
assert.equal(vm.runInContext('renderFrame()',context),240000,'AudioContext currentTime must be authoritative over currentFrame');
p.queue=[{type:'parameter',id:1,normalized:.2,frame:248640}];p.queueHead=0;p.queueDirty=true;p.paramInterpolation=new Map([[1,'linear']]);p.paramAnchors=new Map([[1,{frame:240000,normalized:.8,authored:false}]]);
let due=p._dueMessages(240000,128);assert.equal(due.params.length,0,'static value must hold before first authored point');
p.queue=[{type:'parameter',id:1,normalized:.2,frame:248640},{type:'parameter',id:1,normalized:.6,frame:260000}];p.queueHead=0;p.queueDirty=true;p.paramAnchors=new Map([[1,{frame:240000,normalized:.8,authored:false}]]);
due=p._dueMessages(248576,128);assert(due.params.some(x=>x.id===1&&x.offset===64&&!x.synthetic),'first authored point missing');assert(due.params.some(x=>x.id===1&&x.offset===127&&x.synthetic),'linear continuation missing');assert.equal(p.paramAnchors.get(1).authored,true);
p.layout={ctx:0};p.memory={buffer:new ArrayBuffer(192)};p.dv=new DataView(p.memory.buffer);p.u8=new Uint8Array(p.memory.buffer);p.projectOriginFrame=248640;p._writeContext(250000);
function u64(off){return p.dv.getUint32(off,true)+p.dv.getUint32(off+4,true)*4294967296;}
assert.equal(u64(16),1360);assert.equal(u64(24),1360);console.log('PASS time-origin regression',{projectSample:u64(16)});
