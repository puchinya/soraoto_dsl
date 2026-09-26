const path=require('path');
const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../');
function check(x,m){if(!x)throw new Error(m);}
function finite(a){return a.every(Number.isFinite);}
function peak(a){let p=0;for(const x of a)p=Math.max(p,Math.abs(x));return p;}

{
  const h=new PluginHarness(R,'plugins/effects/sidechain/plugin.wasm');h.setPlain('amount',-8);let first=0,last=0;for(let b=0;b<96;b++){const main=Float32Array.from({length:128},()=>.5),side=Float32Array.from({length:128},()=>.5);const o=h.process(128,{inputs:[[main,main],[side,side]]})[0];check(finite(o[0]),'sidechain nonfinite');const q=peak(o[0]);if(b===0)first=q;last=q;}check(first>0&&last<first*.9,`sidechain did not duck ${first} -> ${last}`);h.close();
}
console.log('PASS sidechain plugin processing');
