#include <stdint.h>
static int g_sr=48000;
static float p[19]={80.0f,180.0f,0.0f,0.8f,1200.0f,0.0f,1.0f,7200.0f,0.0f,0.8f,18000.0f,-18.0f,2.0f,0.012f,0.16f,0.0f,1.0f,0.0f,1.0f};
static float hpL=0,hpR=0,lpL=0,lpR=0,env=0;
typedef struct{float low,band;} SVF;
static SVF lowL={0},lowR={0},midL={0},midR={0},highL={0},highR={0};
static float absf(float x){return x<0?-x:x;}static float clampf(float x,float a,float b){return x<a?a:(x>b?b:x);}static float maxf(float a,float b){return a>b?a:b;}
static float exp2fast(float x){int n=(int)x;if(x<0&&x!=(float)n)n--;float f=x-(float)n;float y=1.0f+.69314718f*f+.24022651f*f*f+.05550411f*f*f*f;if(n>0)while(n--)y*=2;else while(n++)y*=.5f;return y;}
static float log2fast(float x){if(x<=0.0000001f)return -24.0f;int e=0;while(x>=2.0f){x*=0.5f;e++;}while(x<1.0f){x*=2.0f;e--;}float f=x-1.0f;float y=f*(1.44269504f+f*(-0.72134752f+f*(0.48089835f-f*0.36067376f)));return (float)e+y;}
static float powfast(float x,float a){return exp2fast(log2fast(x)*a);}
static float dbgain(float db){return exp2fast(db/6.020599913f);} 
static float coef(float hz){float x=6.2831853f*clampf(hz,10.0f,(float)g_sr*.43f)/(float)g_sr;return clampf(x,0.0001f,1.35f);} 
static float onepole_lp(float x,float* z,float hz){float a=coef(hz);if(a>.92f)a=.92f;*z += a*(x-*z);return *z;}
static float bell(float x,SVF* s,float hz,float q,float gainDb){float f=coef(hz);if(f>.92f)f=.92f;float damp=clampf(1.0f/clampf(q,.2f,8.0f),.08f,2.0f);float high=x-s->low-damp*s->band;s->band+=f*high;s->low+=f*s->band;float g=dbgain(gainDb)-1.0f;return x+s->band*g*.78f;}
static void dsp_init(int sr,int max_frames){(void)max_frames;g_sr=sr>8000?sr:48000;hpL=hpR=lpL=lpR=env=0;lowL=(SVF){0};lowR=(SVF){0};midL=(SVF){0};midR=(SVF){0};highL=(SVF){0};highR=(SVF){0};}
static void dsp_reset(void){dsp_init(g_sr,0);} 
static void dsp_set_parameter(int id,float v,int sample_offset){(void)sample_offset;if(id<0||id>=19)return;p[id]=v;}
static float channel(float x,float* hpz,float* lpz,SVF* lo,SVF* mi,SVF* hi){float l=onepole_lp(x,hpz,p[0]);x=x-l;x=bell(x,lo,p[1],p[3],p[2]);x=bell(x,mi,p[4],p[6],p[5]);x=bell(x,hi,p[7],p[9],p[8]);return onepole_lp(x,lpz,p[10]);}
static void dsp_process(int frames,float* inL,float* inR,float* sideL,float* sideR,float* outL,float* outR){(void)sideL;(void)sideR;float threshold=dbgain(p[11]),ratio=clampf(p[12],1,20),atk=1.0f/(maxf(.0005f,p[13])*(float)g_sr+1),rel=1.0f/(maxf(.01f,p[14])*(float)g_sr+1),makeup=dbgain(p[15]);float width=clampf(p[16],0,2),bal=clampf(p[17],-1,1),mix=clampf(p[18],0,1);for(int i=0;i<frames;i++){float dryL=inL[i],dryR=inR[i];float L=channel(dryL,&hpL,&lpL,&lowL,&midL,&highL);float R=channel(dryR,&hpR,&lpR,&lowR,&midR,&highR);float peak=maxf(absf(L),absf(R));float ec=peak>env?atk:rel;env+=(peak-env)*ec;float gr=1;if(env>threshold&&threshold>0){float over=env/threshold;float target=threshold*powfast(over,1.0f/ratio);gr=target/env;}L*=gr*makeup;R*=gr*makeup;float mid=(L+R)*.5f,side=(L-R)*.5f*width;L=mid+side;R=mid-side;if(bal<0)R*=1.0f+bal;else if(bal>0)L*=1.0f-bal;outL[i]=dryL*(1-mix)+L*mix;outR[i]=dryR*(1-mix)+R*mix;}}
#include "plugin_abi_runtime.h"
