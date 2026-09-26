#include <stdint.h>
#define PLUGIN_HAS_DYNAMIC_TAIL 1
#define PRE_MAX 32768
#define COMBS 6
#define COMB_MAX 8192
#define AP_MAX 2048
#define DSP_STATE_LIMIT 64.0f

static int g_sr=48000,g_pre_pos=0,g_ap1pL=0,g_ap1pR=0,g_ap2pL=0,g_ap2pR=0;
void dsp_reset(void);
static float g_mix=.22f,g_decay=2.2f,g_damp=.36f,g_predelay=.02f,g_width=1.0f,g_earlylate=.68f,g_room=.72f;
static float g_preL[PRE_MAX],g_preR[PRE_MAX];
static float g_combL[COMBS][COMB_MAX],g_combR[COMBS][COMB_MAX],g_comb_lpL[COMBS],g_comb_lpR[COMBS];
static int g_comb_pos[COMBS];
static float g_ap1L[AP_MAX],g_ap1R[AP_MAX],g_ap2L[AP_MAX],g_ap2R[AP_MAX];
static int g_state_fault=0;

static float clampf(float x,float a,float b){
  if(!(x==x))return a;
  return x<a?a:(x>b?b:x);
}
static float lerp(float a,float b,float t){return a+(b-a)*t;}
static float sane_state(float x){
  if(!(x==x)||x>DSP_STATE_LIMIT||x<-DSP_STATE_LIMIT){g_state_fault=1;return 0.0f;}
  return x;
}
/* Reset is transport-boundary code, not a render hot path. Volatile scalar
   stores intentionally keep the clear loop simple for WebKit/JSC WASM tiers. */
static void zero(float* p,int n){
  volatile float* q=(volatile float*)p;
  for(int i=0;i<n;i++)q[i]=0.0f;
}

void dsp_init(int sr,int max_frames){
  (void)max_frames;
  g_sr=(sr>=8000&&sr<=384000)?sr:48000;
  dsp_reset();
}
void dsp_reset(void){
  zero(g_preL,PRE_MAX);zero(g_preR,PRE_MAX);
  for(int c=0;c<COMBS;c++){
    zero(g_combL[c],COMB_MAX);zero(g_combR[c],COMB_MAX);
    g_comb_lpL[c]=g_comb_lpR[c]=0.0f;g_comb_pos[c]=0;
  }
  zero(g_ap1L,AP_MAX);zero(g_ap1R,AP_MAX);zero(g_ap2L,AP_MAX);zero(g_ap2R,AP_MAX);
  g_pre_pos=g_ap1pL=g_ap1pR=g_ap2pL=g_ap2pR=0;
  g_state_fault=0;
}
void dsp_set_parameter(int id,float v,int sample_offset){
  (void)sample_offset;
  switch(id){
    case 0:g_mix=clampf(v,0,1);break;
    case 1:g_decay=clampf(v,.2f,12);break;
    case 2:g_damp=clampf(v,0,1);break;
    case 3:g_predelay=clampf(v,0,.2f);break;
    case 4:g_width=clampf(v,0,2);break;
    case 5:g_earlylate=clampf(v,0,1);break;
    case 6:g_room=clampf(v,0,1);break;
  }
}
static float allpass(float x,float* b,int* pos,int len){
  if(len<1)len=1;if(len>AP_MAX)len=AP_MAX;
  int p=*pos;if(p<0||p>=len)p=0;
  x=sane_state(x);
  float d=sane_state(b[p]);
  float y=sane_state(-x+d);
  b[p]=sane_state(x+d*.5f);
  p++;if(p>=len)p=0;*pos=p;
  return y;
}
static void wet_sample(float xL,float xR,float* wL,float* wR){
  const int sr=(g_sr>=8000&&g_sr<=384000)?g_sr:48000;
  xL=sane_state(xL);xR=sane_state(xR);
  float predelay=clampf(g_predelay,0,.2f);
  int pre=(int)(predelay*(float)sr);if(pre<1)pre=1;if(pre>=PRE_MAX)pre=PRE_MAX-1;
  if(g_pre_pos<0||g_pre_pos>=PRE_MAX){g_state_fault=1;g_pre_pos=0;}
  int rp=g_pre_pos-pre;if(rp<0)rp+=PRE_MAX;
  float pL=sane_state(g_preL[rp]),pR=sane_state(g_preR[rp]);
  g_preL[g_pre_pos]=xL;g_preR[g_pre_pos]=xR;if(++g_pre_pos>=PRE_MAX)g_pre_pos=0;

  static const float base[COMBS]={.0297f,.0371f,.0411f,.0437f,.005f,.0117f};
  float lateL=0,lateR=0;
  float room=clampf(g_room,0,1),decay=clampf(g_decay,.2f,12),damping=clampf(g_damp,0,1);
  float roomScale=.72f+room*.58f;
  float fb=.52f+clampf((decay-.2f)/11.8f,0,1)*.435f;
  float damp=.04f+damping*.86f;
  for(int c=0;c<COMBS;c++){
    int len=(int)(base[c]*roomScale*(float)sr);if(len<31)len=31;if(len>=COMB_MAX)len=COMB_MAX-1;
    int p=g_comb_pos[c];if(p<0||p>=len){if(p<0)g_state_fault=1;p=0;}
    float dl=sane_state(g_combL[c][p]),dr=sane_state(g_combR[c][p]);
    float lpL=sane_state(g_comb_lpL[c]),lpR=sane_state(g_comb_lpR[c]);
    lpL=sane_state(lpL+damp*(dl-lpL));lpR=sane_state(lpR+damp*(dr-lpR));
    g_comb_lpL[c]=lpL;g_comb_lpR[c]=lpR;
    float inLc=pL+(c&1?pR*.13f:pR*.04f),inRc=pR+(c&1?pL*.04f:pL*.13f);
    g_combL[c][p]=sane_state(inLc+lpL*fb);g_combR[c][p]=sane_state(inRc+lpR*fb);
    g_comb_pos[c]=p+1;
    lateL=sane_state(lateL+dl);lateR=sane_state(lateR+dr);
  }
  lateL=sane_state(lateL/COMBS);lateR=sane_state(lateR/COMBS);
  int a1=(int)(.0047f*sr),a2=(int)(.0019f*sr);
  if(a1<17)a1=17;if(a1>=AP_MAX)a1=AP_MAX-1;if(a2<11)a2=11;if(a2>=AP_MAX)a2=AP_MAX-1;
  lateL=allpass(lateL,g_ap1L,&g_ap1pL,a1);lateR=allpass(lateR,g_ap1R,&g_ap1pR,a1-7);
  lateL=allpass(lateL,g_ap2L,&g_ap2pL,a2);lateR=allpass(lateR,g_ap2R,&g_ap2pR,a2-5);

  float earlyL=sane_state(pL*.55f+pR*.18f),earlyR=sane_state(pR*.55f+pL*.18f);
  float earlylate=clampf(g_earlylate,0,1),width=clampf(g_width,0,2);
  float L=sane_state(lerp(earlyL,lateL,earlylate)),R=sane_state(lerp(earlyR,lateR,earlylate));
  float m=sane_state((L+R)*.5f),s=sane_state((L-R)*.5f*width);

  /* A send reverb must not behave like a gain stage. Long decay presets store
     more energy, so trim the wet return as decay increases. */
  float decayNorm=clampf((decay-.7f)/4.1f,0,1);
  float wetNorm=.72f-.18f*decayNorm;
  *wL=sane_state((m+s)*wetNorm);*wR=sane_state((m-s)*wetNorm);
}
void dsp_process(int frames,float* inL,float* inR,float* sideL,float* sideR,float* outL,float* outR){
  (void)sideL;(void)sideR;
  for(int i=0;i<frames;i++){
    g_state_fault=0;
    float dryInL=sane_state(inL[i]),dryInR=sane_state(inR[i]),wL=0,wR=0;
    wet_sample(dryInL,dryInR,&wL,&wR);
    if(g_state_fault){
      /* A corrupted delay/index state must never be allowed into the WebAudio
         graph. Flush transient state and emit dry-only for this sample. */
      dsp_reset();wL=wR=0;
    }
    float mix=clampf(g_mix,0,1),dry=1.0f-mix;
    outL[i]=sane_state(dryInL*dry+wL*mix);
    outR[i]=sane_state(dryInR*dry+wR*mix);
    if(g_state_fault){dsp_reset();outL[i]=outR[i]=0.0f;}
  }
}
int64_t dsp_tail_samples(void){
  float t=clampf(g_decay,.2f,12)*1.6f+.25f;
  return (int64_t)(t*(float)((g_sr>=8000&&g_sr<=384000)?g_sr:48000));
}
#include "plugin_abi_runtime.h"
