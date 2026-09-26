#define MAX_DELAY 384000
static float ringL[MAX_DELAY], ringR[MAX_DELAY];
static int write_pos=0, sr=48000;
static float delay_sec=0.375f,left_sec=0.0f,right_sec=0.0f,feedback=0.35f,mix=0.30f,hp_hz=0.0f,lp_hz=20000.0f,pingpong=1.0f;
static float lpL=0,lpR=0,hpYL=0,hpYR=0,hpXL=0,hpXR=0;
static void dsp_init(int sample_rate,int max_block_size){(void)max_block_size;sr=sample_rate;write_pos=0;lpL=lpR=hpYL=hpYR=hpXL=hpXR=0;}
static void dsp_reset(void){for(int i=0;i<MAX_DELAY;i++){ringL[i]=0;ringR[i]=0;}write_pos=0;lpL=lpR=hpYL=hpYR=hpXL=hpXR=0;}
static void dsp_set_parameter(int id,float value,int sample_offset){(void)sample_offset;if(id==0)delay_sec=value;else if(id==1)feedback=value;else if(id==2)mix=value;else if(id==3)left_sec=value;else if(id==4)right_sec=value;else if(id==5)hp_hz=value;else if(id==6)lp_hz=value;else if(id==7)pingpong=value;}
static int delay_samples(float sec){int d=(int)(sec*sr);if(d<1)d=1;if(d>=MAX_DELAY)d=MAX_DELAY-1;return d;}
static float lowpass(float x,float* state){if(lp_hz<=0||lp_hz>=20000){*state=x;return x;}float a=lp_hz/(lp_hz+sr*0.15915494f);*state += a*(x-*state);return *state;}
static float highpass(float x,float* y,float* prevx){if(hp_hz<=0){*prevx=x;*y=x;return x;}float a=1.0f/(1.0f+6.2831853f*hp_hz/sr);float o=a*((*y)+x-(*prevx));*prevx=x;*y=o;return o;}
/* Preserve normal delay tone but keep pathological near-unity feedback from
   accumulating unbounded internal level. The guard is exactly linear below
   1.5 and approaches 3.0 smoothly above it. */
static float feedback_guard(float x){float a=x<0?-x:x;if(a<=1.5f)return x;float d=a-1.5f,y=1.5f+1.5f*(d/(1.5f+d));return x<0?-y:y;}
static void dsp_process(int frames,float* inL,float* inR,float* sideL,float* sideR,float* outL,float* outR){
  (void)sideL;(void)sideR;float ls=left_sec>0?left_sec:delay_sec,rs=right_sec>0?right_sec:delay_sec;int dL=delay_samples(ls),dR=delay_samples(rs);float fb=feedback;if(fb>0.98f)fb=0.98f;if(fb<0)fb=0;float mx=mix;if(mx<0)mx=0;if(mx>1)mx=1;
  for(int i=0;i<frames;i++){
    int rpL=write_pos-dL;if(rpL<0)rpL+=MAX_DELAY;int rpR=write_pos-dR;if(rpR<0)rpR+=MAX_DELAY;
    float dl=ringL[rpL],dr=ringR[rpR];
    float fl=highpass(lowpass(dl,&lpL),&hpYL,&hpXL),fr=highpass(lowpass(dr,&lpR),&hpYR,&hpXR);
    float feedL=pingpong>=0.5f?fr:fl,feedR=pingpong>=0.5f?fl:fr;
    ringL[write_pos]=feedback_guard(inL[i]+feedL*fb);ringR[write_pos]=feedback_guard(inR[i]+feedR*fb);
    outL[i]=inL[i]*(1-mx)+dl*mx;outR[i]=inR[i]*(1-mx)+dr*mx;
    write_pos++;if(write_pos>=MAX_DELAY)write_pos=0;
  }
}

#include "plugin_abi_runtime.h"
