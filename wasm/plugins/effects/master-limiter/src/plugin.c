#define PLUGIN_HAS_DYNAMIC_LATENCY 1
#define RING 4096
#define TP_TAPS 16
static int g_sr=48000,g_pos=0,g_look=240;void dsp_reset(void);
static float g_ceiling=-1.0f,g_release=.12f,g_lookahead=.005f,g_soft=0.0f,g_input=0.0f,g_gain=1.0f,g_hold_target=1.0f,g_attack_step=0.0f;static int g_hold_remaining=0;
static float g_ringL[RING],g_ringR[RING],g_tp_histL[TP_TAPS],g_tp_histR[TP_TAPS];
static const float g_tp4[4][TP_TAPS]={
 {0.0000000000f,0.0008206534f,-0.0044606124f,0.0142018460f,-0.0358343932f,0.0802155793f,-0.1802155157f,0.6252724426f,0.6252724426f,-0.1802155157f,0.0802155793f,-0.0358343932f,0.0142018460f,-0.0044606124f,0.0008206534f,0.0000000000f},
 {0.0000000000f,0.0006062182f,-0.0033192024f,0.0106808112f,-0.0274107296f,0.0633070493f,-0.1536063898f,0.8882498471f,0.2960832824f,-0.1097188498f,0.0517966767f,-0.0237559656f,0.0095565153f,-0.0030305761f,0.0005613131f,0.0000000000f},
 {0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,1.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f,0.0000000000f},
 {0.0000000000f,-0.0006831121f,0.0038032097f,-0.0125491048f,0.0335832023f,-0.0843815279f,0.2654048624f,0.9208438353f,-0.1841687671f,0.0884682875f,-0.0454362073f,0.0217303074f,-0.0089636463f,0.0028904394f,-0.0005417785f,0.0000000000f}
};
static float absf(float x){return x<0?-x:x;}static float clampf(float x,float a,float b){return x<a?a:(x>b?b:x);}
static float fast_exp2(float x){int n=(int)x;if(x<0&&(float)n!=x)n--;float f=x-(float)n;float y=1+.69314718f*f+.24022651f*f*f+.05550411f*f*f*f;if(n>0){while(n--)y*=2;}else{while(n++)y*=.5f;}return y;}static float db2lin(float x){return fast_exp2(x/6.020599913f);}
/* Optional soft clip is a ceiling-local soft knee. Below the knee it is exactly
   transparent, unlike the old x/(1+k|x|) transfer which distorted every sample. */
static float soft_knee(float x,float ceiling,float amt){if(amt<=0)return x;float a=absf(x),knee=ceiling*(1.0f-.5f*amt);if(knee<ceiling*.45f)knee=ceiling*.45f;if(a<=knee)return x;float span=ceiling-knee,d=a-knee;float y=knee+span*(d/(span+d));return x<0?-y:y;}
static float tp4_peak(float xL,float xR){for(int k=TP_TAPS-1;k>0;k--){g_tp_histL[k]=g_tp_histL[k-1];g_tp_histR[k]=g_tp_histR[k-1];}g_tp_histL[0]=xL;g_tp_histR[0]=xR;float pk=0;for(int p=0;p<4;p++){float yL=0,yR=0;for(int k=0;k<TP_TAPS;k++){float c=g_tp4[p][k];yL+=g_tp_histL[k]*c;yR+=g_tp_histR[k]*c;}float a=absf(yL),b=absf(yR);if(a>pk)pk=a;if(b>pk)pk=b;}return pk;}
void dsp_init(int sr,int max_frames){(void)max_frames;g_sr=sr>8000?sr:48000;dsp_reset();}
void dsp_reset(void){for(int i=0;i<RING;i++)g_ringL[i]=g_ringR[i]=0;for(int i=0;i<TP_TAPS;i++)g_tp_histL[i]=g_tp_histR[i]=0;g_pos=0;g_gain=1;g_hold_target=1;g_attack_step=0;g_hold_remaining=0;g_look=(int)(g_lookahead*g_sr);if(g_look<1)g_look=1;if(g_look>=RING)g_look=RING-1;}
void dsp_set_parameter(int id,float v,int sample_offset){(void)sample_offset;switch(id){case 0:g_ceiling=clampf(v,-6,0);break;case 1:g_release=clampf(v,.02f,1.5f);break;case 2:g_lookahead=clampf(v,.001f,.01f);g_look=(int)(g_lookahead*g_sr);if(g_look<1)g_look=1;if(g_look>=RING)g_look=RING-1;break;case 3:g_soft=clampf(v,0,1);break;case 4:g_input=clampf(v,-12,12);break;}}
void dsp_process(int frames,float* inL,float* inR,float* sideL,float* sideR,float* outL,float* outR){(void)sideL;(void)sideR;float ceiling=db2lin(g_ceiling),ing=db2lin(g_input);float rel=1.0f/(g_release*(float)g_sr);if(rel>1)rel=1;/* Conservative detector guard covers the finite 4x FIR and gain-envelope reconstruction error. */float detectCeiling=ceiling*.97f;for(int i=0;i<frames;i++){float xL=soft_knee(inL[i]*ing,ceiling,g_soft),xR=soft_knee(inR[i]*ing,ceiling,g_soft);float pk=tp4_peak(xL,xR);float target=pk>detectCeiling&&pk>1e-9f?detectCeiling/pk:1.0f;int horizon=g_look-8;if(horizon<1)horizon=1;if(target<1.0f){if(target<g_hold_target){g_hold_target=target;g_attack_step=(g_gain-g_hold_target)/(float)horizon;if(g_attack_step<0)g_attack_step=0;}if(g_hold_remaining<horizon)g_hold_remaining=horizon;}if(g_hold_remaining>0){if(g_gain>g_hold_target){g_gain-=g_attack_step;if(g_gain<g_hold_target)g_gain=g_hold_target;}g_hold_remaining--;if(g_hold_remaining==0&&g_gain>g_hold_target)g_gain=g_hold_target;}else{g_hold_target=1.0f;g_attack_step=0;g_gain+=(1.0f-g_gain)*rel;if(g_gain>1)g_gain=1;}g_ringL[g_pos]=xL;g_ringR[g_pos]=xR;int rp=g_pos-g_look;if(rp<0)rp+=RING;outL[i]=clampf(g_ringL[rp]*g_gain,-ceiling,ceiling);outR[i]=clampf(g_ringR[rp]*g_gain,-ceiling,ceiling);if(++g_pos>=RING)g_pos=0;}}
int dsp_latency_samples(void){return g_look;}
#include "plugin_abi_runtime.h"
