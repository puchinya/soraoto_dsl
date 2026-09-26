#define MAX_DRUM_VOICES 48

typedef struct {
  int active,id,type,note;
  float age,vel,phase1,phase2,phase3,var,pan;
  float noise_fast,noise_slow;
} Voice;

static Voice g_v[MAX_DRUM_VOICES];
static int g_sr=48000;
static unsigned g_rng=0x31415926u;
static float g_kit=0,g_tone=.52f,g_punch=.62f,g_room=.08f,g_human=.12f,g_out=.32f;
static float g_roomL=0,g_roomR=0;
void dsp_reset(void);

static float absf(float x){return x<0?-x:x;}
static float clampf(float x,float a,float b){return x<a?a:(x>b?b:x);}
static float wrap(float x){while(x>=1)x-=1;while(x<0)x+=1;return x;}
static float fast_sine(float p){p=wrap(p);float x=p*2-1,y=4*x*(1-absf(x));y=.225f*(y*absf(y)-y)+y;return -y;}
static float rnd(void){g_rng=g_rng*1664525u+1013904223u;return ((float)((g_rng>>8)&0xffffff)/8388607.5f)-1;}
static float soft(float x){return x/(1+.42f*absf(x));}
static float decay(float t,float rate){float x=t*rate;return 1.0f/(1.0f+x*x*.86f+x*.88f);}
static float expish(float t,float speed){float x=t*speed;return 1.0f/(1.0f+x+x*x*.72f+x*x*x*.20f);}
static float coef(float hz){return clampf(6.2831853f*hz/(float)g_sr,.0001f,.96f);}
static float band_noise(Voice*q,float low,float high){
  float n=rnd();
  float af=coef(high),as=coef(low);
  q->noise_fast += af*(n-q->noise_fast);
  q->noise_slow += as*(n-q->noise_slow);
  return q->noise_fast-q->noise_slow;
}
static float metal(float p){return (fast_sine(p)+.56f*fast_sine(p*1.4142f)+.38f*fast_sine(p*1.732f)+.23f*fast_sine(p*2.137f))*.46f;}

static int type_for_pitch(float p){
  int n=(int)(p+.5f);
  if(n==35||n==36)return 0;
  if(n==38||n==40)return 1;
  if(n==39)return 2;
  if(n==42||n==44)return 3;
  if(n==46)return 4;
  if(n==41||n==43||n==45||n==47||n==48||n==50)return 5;
  if(n==51||n==53||n==59)return 6;
  if(n==49||n==52||n==55||n==57)return 7;
  if(n==37)return 8;
  return 3;
}

static float kit01(int k,float a,float b,float c,float d,float e){switch(k){case 0:return a;case 1:return b;case 2:return c;case 3:return d;default:return e;}}
static int kit_index(void){int k=(int)(g_kit+.5f);return k<0?0:(k>4?4:k);}

void dsp_init(int sr,int max_frames){(void)max_frames;g_sr=sr>8000?sr:48000;dsp_reset();}
void dsp_reset(void){for(int i=0;i<MAX_DRUM_VOICES;i++)g_v[i].active=0;g_roomL=g_roomR=0;}
void dsp_set_parameter(int id,float v,int sample_offset){
  (void)sample_offset;
  switch(id){
    case 0:g_kit=clampf(v,0,4);break;
    case 1:g_tone=clampf(v,0,1);break;
    case 2:g_punch=clampf(v,0,1);break;
    case 3:g_room=clampf(v,0,1);break;
    case 4:g_human=clampf(v,0,1);break;
    case 5:g_out=clampf(v,0,1);break;
  }
}

void dsp_note_on(int note_id,float pitch,float velocity,int sample_offset){
  (void)sample_offset;int s=-1;
  for(int i=0;i<MAX_DRUM_VOICES;i++)if(!g_v[i].active){s=i;break;}
  if(s<0){float oldest=-1;for(int i=0;i<MAX_DRUM_VOICES;i++)if(g_v[i].age>oldest){oldest=g_v[i].age;s=i;}}
  Voice*q=&g_v[s];
  q->active=1;q->id=note_id;q->note=(int)(pitch+.5f);q->type=type_for_pitch(pitch);q->age=0;
  q->vel=clampf(velocity,0,1);q->var=rnd()*g_human;q->phase1=wrap(rnd()*.25f);q->phase2=wrap(rnd()*.25f);q->phase3=wrap(rnd()*.25f);
  q->pan=clampf(rnd()*g_human*.28f,-.18f,.18f);q->noise_fast=q->noise_slow=0;
}
void dsp_note_off(int note_id,float velocity,int sample_offset){(void)note_id;(void)velocity;(void)sample_offset;}
void dsp_note_expression(int note_id,int kind,float value,int sample_offset){
  (void)sample_offset;if(kind==0)for(int i=0;i<MAX_DRUM_VOICES;i++)if(g_v[i].active&&g_v[i].id==note_id)g_v[i].vel=clampf(value,0,1);
}

void dsp_process(int frames,float*outL,float*outR){
  int kit=kit_index();
  for(int n=0;n<frames;n++){
    float L=0,R=0;
    for(int i=0;i<MAX_DRUM_VOICES;i++){
      Voice*q=&g_v[i];if(!q->active)continue;
      float t=q->age,x=0,f,body,noise,env;
      switch(q->type){
        case 0:{
          float base=kit01(kit,47,50,44,43,49),start=kit01(kit,150,165,138,178,120),tail=kit01(kit,.56f,.48f,.66f,.42f,.45f);
          f=base+(start-base)/(1+t*(42+30*g_punch));f*=1+q->var*.025f;
          q->phase1=wrap(q->phase1+f/g_sr);q->phase2=wrap(q->phase2+(f*.505f)/g_sr);
          env=expish(t,7.0f+4.5f*g_punch);
          body=fast_sine(q->phase1)*.90f+fast_sine(q->phase2)*.16f;
          float click=band_noise(q,1800,7000)*expish(t,95.0f)*kit01(kit,.06f,.075f,.08f,.11f,.035f);
          x=(body*env+click)*(1.0f+.18f*g_punch);
          if(t>tail)q->active=0;
        }break;
        case 1:{
          float bf=kit01(kit,185,198,174,205,166)*(1+q->var*.035f);
          q->phase1=wrap(q->phase1+bf/g_sr);q->phase2=wrap(q->phase2+(bf*1.79f)/g_sr);
          float bodyEnv=expish(t,15.5f),noiseEnv=expish(t,20.0f);
          body=(fast_sine(q->phase1)*.64f+fast_sine(q->phase2)*.22f)*bodyEnv;
          noise=band_noise(q,kit01(kit,900,1200,850,1450,650),kit01(kit,5200,6500,4800,7800,3600))*noiseEnv;
          float nm=kit01(kit,.32f,.38f,.34f,.43f,.24f)*(.72f+.45f*g_tone);
          x=body*.58f+noise*nm;
          if(t>kit01(kit,.38f,.32f,.46f,.29f,.34f))q->active=0;
        }break;
        case 2:{
          float burst=(t<.012f?1:0)+(t>.020f&&t<.032f?.72f:0)+(t>.040f&&t<.052f?.48f:0);
          noise=band_noise(q,kit01(kit,900,1300,1000,1600,650),kit01(kit,6200,7600,6500,9000,4200));
          float tail=expish(t,24.0f)*.20f;
          x=noise*(burst*.62f+tail)*kit01(kit,.62f,.68f,.70f,.76f,.48f);
          if(t>.22f)q->active=0;
        }break;
        case 3:{
          float bright=kit01(kit,1.0f,1.08f,.94f,1.18f,.74f)*(0.86f+.28f*g_tone);
          q->phase1=wrap(q->phase1+(6100*bright)*(1+q->var*.04f)/g_sr);
          q->phase2=wrap(q->phase2+(8350*bright)*(1-q->var*.03f)/g_sr);
          q->phase3=wrap(q->phase3+(10100*bright)/g_sr);
          float m=(metal(q->phase1)*.52f+metal(q->phase2)*.29f+fast_sine(q->phase3)*.10f);
          noise=band_noise(q,5000*bright,12000*bright);
          x=(m*.88f+noise*.12f)*expish(t,kit01(kit,39,45,34,52,27));
          if(t>kit01(kit,.115f,.095f,.13f,.085f,.15f))q->active=0;
        }break;
        case 4:{
          float bright=kit01(kit,1.0f,1.08f,.95f,1.16f,.72f)*(0.86f+.28f*g_tone);
          q->phase1=wrap(q->phase1+(5750*bright)*(1+q->var*.04f)/g_sr);
          q->phase2=wrap(q->phase2+(7900*bright)/g_sr);
          float m=metal(q->phase1)*.64f+metal(q->phase2)*.27f;
          noise=band_noise(q,4300*bright,11500*bright);
          x=(m*.82f+noise*.14f)*expish(t,kit01(kit,6.2f,7.4f,5.4f,8.5f,4.5f));
          if(t>kit01(kit,.62f,.48f,.72f,.42f,.78f))q->active=0;
        }break;
        case 5:{
          float sem=(q->note==41?-5:q->note==43?-3:q->note==45?-1:q->note==47?1:q->note==48?3:q->note==50?5:0);
          float ratio=1.0f+sem*.045f;
          float tf=kit01(kit,126,136,112,142,104)*ratio*(1+q->var*.035f)/(1+t*1.45f);
          q->phase1=wrap(q->phase1+tf/g_sr);q->phase2=wrap(q->phase2+(tf*2.02f)/g_sr);
          x=(fast_sine(q->phase1)*.82f+fast_sine(q->phase2)*.11f)*expish(t,kit01(kit,5.2f,6.4f,4.3f,7.0f,3.9f));
          if(t>kit01(kit,.58f,.48f,.76f,.42f,.82f))q->active=0;
        }break;
        case 6:{
          float bright=kit01(kit,1.0f,1.06f,.92f,1.12f,.72f)*(0.90f+.20f*g_tone);
          q->phase1=wrap(q->phase1+(4300*bright)/g_sr);q->phase2=wrap(q->phase2+(6250*bright)/g_sr);
          float m=metal(q->phase1)*.60f+metal(q->phase2)*.30f;
          noise=band_noise(q,3600*bright,10500*bright);
          x=(m*.86f+noise*.10f)*expish(t,kit01(kit,2.2f,2.6f,1.85f,3.0f,1.55f));
          if(t>kit01(kit,1.25f,1.0f,1.55f,.9f,1.65f))q->active=0;
        }break;
        case 7:{
          float bright=kit01(kit,1.0f,1.08f,.94f,1.16f,.70f)*(0.90f+.22f*g_tone);
          q->phase1=wrap(q->phase1+(3900*bright)/g_sr);q->phase2=wrap(q->phase2+(5700*bright)/g_sr);q->phase3=wrap(q->phase3+(8200*bright)/g_sr);
          float m=metal(q->phase1)*.50f+metal(q->phase2)*.30f+metal(q->phase3)*.16f;
          noise=band_noise(q,3000*bright,11000*bright);
          x=(m*.82f+noise*.12f)*expish(t,kit01(kit,1.55f,1.8f,1.35f,2.2f,1.15f));
          if(t>kit01(kit,1.8f,1.5f,2.2f,1.35f,2.4f))q->active=0;
        }break;
        default:{
          q->phase1=wrap(q->phase1+920/g_sr);q->phase2=wrap(q->phase2+1780/g_sr);
          x=(fast_sine(q->phase1)*.58f+fast_sine(q->phase2)*.25f+band_noise(q,1200,5200)*.12f)*expish(t,45.0f);
          if(t>.10f)q->active=0;
        }break;
      }
      x*=q->vel*(.46f+.34f*g_punch);
      float gl=.7071f*(1-q->pan*.58f),gr=.7071f*(1+q->pan*.58f);L+=x*gl;R+=x*gr;
      q->age+=1.0f/g_sr;
    }
    float wetL=g_roomL*.68f+R*.08f,wetR=g_roomR*.68f+L*.08f;g_roomL=wetL;g_roomR=wetR;
    L=soft((L+wetL*g_room*.16f)*g_out);R=soft((R+wetR*g_room*.16f)*g_out);
    outL[n]=L;outR[n]=R;
  }
}

#include "plugin_abi_runtime.h"
