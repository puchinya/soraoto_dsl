static float amount_db=-8.0f, attack_sec=0.005f, release_sec=0.120f, env=0.0f, gain_now=1.0f; static int sr=48000;
static float absf(float x){return x<0?-x:x;}
static float db_to_gain(float db){
  // Fast polynomial-ish approximation is unnecessary here: use repeated square approximation around 6dB steps.
  // This is intentionally conservative for a compact no-libc WASM module.
  float g=1.0f; if(db<0){float n=-db/6.0f; int whole=(int)n; for(int i=0;i<whole;i++)g*=0.501187f; float frac=n-whole; g*=1.0f-frac*(1.0f-0.501187f);} return g;
}
static void dsp_init(int sample_rate, int max_block_size){(void)max_block_size;sr=sample_rate;env=0;gain_now=1;}
static void dsp_reset(void){env=0;gain_now=1;}
static void dsp_set_parameter(int id,float value,int sample_offset){(void)sample_offset;if(id==0)amount_db=value;else if(id==1)attack_sec=value;else if(id==2)release_sec=value;}
static void dsp_process(int frames,float* inL,float* inR,float* sideL,float* sideR,float* outL,float* outR){
  float targetDuck=db_to_gain(amount_db);
  float atk=1.0f/(attack_sec*sr+1.0f), rel=1.0f/(release_sec*sr+1.0f);
  for(int i=0;i<frames;i++){
    float sc=(absf(sideL[i])+absf(sideR[i]))*0.5f;
    float ec=sc>env?atk:rel; env += (sc-env)*ec;
    float target=env>0.025f?targetDuck:1.0f;
    float gc=target<gain_now?atk:rel; gain_now+=(target-gain_now)*gc;
    outL[i]=inL[i]*gain_now; outR[i]=inR[i]*gain_now;
  }
}

#include "plugin_abi_runtime.h"
