(() => {
"use strict";
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function writeString(view,offset,s){for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));}
function encode(buffer,bitDepth=24,normalize=false){
  bitDepth=bitDepth===16?16:24;
  const channels=Math.min(2,buffer.numberOfChannels||1),frames=buffer.length;
  let peak=0;
  if(normalize){for(let ch=0;ch<channels;ch++){const d=buffer.getChannelData(ch);for(let i=0;i<frames;i++)peak=Math.max(peak,Math.abs(d[i]));}}
  const scale=normalize&&peak>1e-9?Math.min(1,0.999/peak):1;
  const bytesPerSample=bitDepth/8,blockAlign=channels*bytesPerSample,dataSize=frames*blockAlign;
  const ab=new ArrayBuffer(44+dataSize),v=new DataView(ab);
  writeString(v,0,"RIFF");v.setUint32(4,36+dataSize,true);writeString(v,8,"WAVE");writeString(v,12,"fmt ");
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);
  v.setUint32(28,buffer.sampleRate*blockAlign,true);v.setUint16(32,blockAlign,true);v.setUint16(34,bitDepth,true);writeString(v,36,"data");v.setUint32(40,dataSize,true);
  let off=44;
  for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){
    const x=clamp(buffer.getChannelData(ch)[i]*scale,-1,1);
    if(bitDepth===16){v.setInt16(off,Math.round(x*(x<0?32768:32767)),true);off+=2;}
    else {let n=Math.round(x*(x<0?8388608:8388607));if(n<0)n+=0x1000000;v.setUint8(off,n&255);v.setUint8(off+1,(n>>8)&255);v.setUint8(off+2,(n>>16)&255);off+=3;}
  }
  return new Uint8Array(ab);
}
function download(bytes,name){const blob=new Blob([bytes],{type:"audio/wav"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
window.SoraotoWav={encode,download};
})();
