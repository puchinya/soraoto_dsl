(() => {
"use strict";
const te=new TextEncoder(),td=new TextDecoder();
function head(major,n){
  n=Number(n);if(n<24)return Uint8Array.of((major<<5)|n);
  if(n<=0xff)return Uint8Array.of((major<<5)|24,n);
  if(n<=0xffff){const a=new Uint8Array(3),v=new DataView(a.buffer);a[0]=(major<<5)|25;v.setUint16(1,n,false);return a;}
  if(n<=0xffffffff){const a=new Uint8Array(5),v=new DataView(a.buffer);a[0]=(major<<5)|26;v.setUint32(1,n,false);return a;}
  const a=new Uint8Array(9),v=new DataView(a.buffer);a[0]=(major<<5)|27;v.setBigUint64(1,BigInt(n),false);return a;
}
function cat(parts){const n=parts.reduce((s,p)=>s+p.length,0),o=new Uint8Array(n);let at=0;for(const p of parts){o.set(p,at);at+=p.length;}return o;}
function encode(v){
  if(v&&typeof v==="object"&&Object.prototype.hasOwnProperty.call(v,"__soraotoCborFloat64")){const n=Number(v.__soraotoCborFloat64);if(!Number.isFinite(n))throw new Error("CBOR non-finite f64");const a=new Uint8Array(9),d=new DataView(a.buffer);a[0]=0xfb;d.setFloat64(1,Object.is(n,-0)?0:n,false);return a;}
  if(v===null)return Uint8Array.of(0xf6);if(v===false)return Uint8Array.of(0xf4);if(v===true)return Uint8Array.of(0xf5);
  if(typeof v==="number"){
    if(!Number.isFinite(v))throw new Error("CBOR non-finite number");
    if(Number.isInteger(v)&&v>=0)return head(0,v);
    if(Number.isInteger(v)&&v<0)return head(1,-1-v);
    const a=new Uint8Array(9),d=new DataView(a.buffer);a[0]=0xfb;d.setFloat64(1,Object.is(v,-0)?0:v,false);return a;
  }
  if(typeof v==="bigint")return v>=0n?head(0,v):head(1,-1n-v);
  if(typeof v==="string"){const b=te.encode(v.normalize("NFC"));return cat([head(3,b.length),b]);}
  if(v instanceof Uint8Array)return cat([head(2,v.length),v]);
  if(Array.isArray(v))return cat([head(4,v.length),...v.map(encode)]);
  if(v&&typeof v==="object"){
    const xs=Object.keys(v).map(k=>[te.encode(k.normalize("NFC")),k]).sort((a,b)=>{const A=a[0],B=b[0],n=Math.min(A.length,B.length);for(let i=0;i<n;i++)if(A[i]!==B[i])return A[i]-B[i];return A.length-B.length;});
    return cat([head(5,xs.length),...xs.flatMap(([,k])=>[encode(k),encode(v[k])])]);
  }
  throw new Error(`CBOR unsupported type ${typeof v}`);
}
function decode(bytes){
  const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let p=0;
  const need=n=>{if(p+n>u.length)throw new Error("CBOR truncated");};
  function nval(ai){if(ai<24)return ai;const d=new DataView(u.buffer,u.byteOffset,u.byteLength);if(ai===24){need(1);return u[p++];}if(ai===25){need(2);const x=d.getUint16(p,false);p+=2;return x;}if(ai===26){need(4);const x=d.getUint32(p,false);p+=4;return x;}if(ai===27){need(8);const x=d.getBigUint64(p,false);p+=8;return x<=BigInt(Number.MAX_SAFE_INTEGER)?Number(x):x;}throw new Error("CBOR indefinite/reserved not allowed");}
  function one(){need(1);const b=u[p++],m=b>>5,ai=b&31,d=new DataView(u.buffer,u.byteOffset,u.byteLength);if(m===0)return nval(ai);if(m===1){const n=nval(ai);return typeof n==="bigint"?-1n-n:-1-n;}if(m===2||m===3){const n=Number(nval(ai));need(n);const b=u.slice(p,p+n);p+=n;return m===2?b:td.decode(b).normalize("NFC");}if(m===4){const n=Number(nval(ai)),a=[];for(let i=0;i<n;i++)a.push(one());return a;}if(m===5){const n=Number(nval(ai)),o={};for(let i=0;i<n;i++){const k=one();if(typeof k!=="string")throw new Error("CBOR map key must be text");o[k]=one();}return o;}if(m===7){if(ai===20)return false;if(ai===21)return true;if(ai===22)return null;if(ai===27){need(8);const x=d.getFloat64(p,false);p+=8;if(!Number.isFinite(x))throw new Error("CBOR non-finite float");return Object.is(x,-0)?0:x;}throw new Error("CBOR simple value unsupported");}throw new Error("CBOR tag unsupported");}
  const v=one();if(p!==u.length)throw new Error("CBOR trailing bytes");return v;
}
window.SoraotoPluginCBOR={encode,decode,float64:(v)=>({__soraotoCborFloat64:Number(v)})};
})();
