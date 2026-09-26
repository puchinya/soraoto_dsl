const path=require('path');
const {PluginHarness}=require('../../../../test/helpers/plugin-harness.cjs');
const R=path.resolve(__dirname,'../../../../../'),FILE='plugins/dsp/super-synth/plugin.wasm',SR=48000,BLOCK=128;
function check(x,m){if(!x)throw new Error(m)}
function render(pitch,velocity=.90,seconds=.40){
  const h=new PluginHarness(R,FILE,{sampleRate:SR,maxFrames:BLOCK});
  h.applyPreset('concert_grand');h.setPlain('voice_drift',0);h.setPlain('lfo1_pitch',0);h.setPlain('chorus_mix',0);
  const N=Math.floor(seconds*SR),x=new Float64Array(N);let pos=0;
  while(pos<N){const n=Math.min(BLOCK,N-pos),ev=pos===0?[{kind:1,noteId:1,pitch,velocity,offset:0}]:[];const o=h.process(n,{events:ev})[0][0];x.set(o,pos);pos+=n;}h.close();return x;
}
function reverseBits(x,bits){let y=0;for(let i=0;i<bits;i++){y=(y<<1)|(x&1);x>>>=1;}return y;}
function spectralMetrics(x,startSec=.020,endSec=.180){
  const s=Math.floor(startSec*SR),e=Math.min(x.length,Math.floor(endSec*SR));const m=e-s;let n=1;while(n<m)n<<=1;n=Math.min(n,16384);
  const re=new Float64Array(n),im=new Float64Array(n);let mean=0;for(let i=0;i<m;i++)mean+=x[s+i];mean/=m;
  const bits=Math.round(Math.log2(n));
  for(let i=0;i<n;i++){const v=i<m?(x[s+i]-mean)*(.5-.5*Math.cos(2*Math.PI*i/(m-1))):0;re[reverseBits(i,bits)]=v;}
  for(let len=2;len<=n;len<<=1){const half=len>>1,step=-2*Math.PI/len;for(let i=0;i<n;i+=len){for(let j=0;j<half;j++){const c=Math.cos(step*j),ss=Math.sin(step*j),ar=re[i+j],ai=im[i+j],br=re[i+j+half],bi=im[i+j+half],tr=br*c-bi*ss,ti=br*ss+bi*c;re[i+j]=ar+tr;im[i+j]=ai+ti;re[i+j+half]=ar-tr;im[i+j+half]=ai-ti;}}}
  let sum=0,weighted=0,high=0;for(let k=1;k<n/2;k++){const p=re[k]*re[k]+im[k]*im[k],f=k*SR/n;sum+=p;weighted+=f*p;if(f>2000)high+=p;}
  return {centroid:weighted/Math.max(1e-30,sum),brightness:high/Math.max(1e-30,sum)};
}
// Golden target: published aggregate Salamander Grand Piano (Yamaha C5) comparison:
// spectral centroid ~555 Hz and >2 kHz energy ratio ~0.037. This test intentionally
// uses no copyrighted reference audio fixture; it guards our synthesized C2-C5 aggregate
// against drifting away from those public acoustic reference metrics.
const REF_CENTROID=555,REF_BRIGHTNESS=.037;
const rows=[];for(const pitch of [36,48,60,72])rows.push({pitch,...spectralMetrics(render(pitch))});
const centroid=rows.reduce((s,x)=>s+x.centroid,0)/rows.length;
const brightness=rows.reduce((s,x)=>s+x.brightness,0)/rows.length;
const centroidRatio=centroid/REF_CENTROID,brightnessRatio=brightness/REF_BRIGHTNESS;
check(centroidRatio>.60&&centroidRatio<1.45,`grand centroid too far from reference ${centroid}/${REF_CENTROID}`);
check(brightnessRatio>.40&&brightnessRatio<2.40,`grand >2k brightness too far from reference ${brightness}/${REF_BRIGHTNESS}`);
check(rows.every(x=>Number.isFinite(x.centroid)&&Number.isFinite(x.brightness)), 'non-finite reference metric');
console.log('PASS piano reference calibration',{reference:'Salamander Yamaha C5 published aggregate',windowMs:'20-180',centroidHz:+centroid.toFixed(1),referenceCentroidHz:REF_CENTROID,brightness:+brightness.toFixed(4),referenceBrightness:REF_BRIGHTNESS,perNote:rows.map(x=>({pitch:x.pitch,centroid:+x.centroid.toFixed(1),brightness:+x.brightness.toFixed(4)}))});
