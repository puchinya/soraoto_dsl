#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

/*
 * SuperSynth v9 reference DSP for soraotoDSL.
 * Freestanding WebAssembly build, no libc/libm, no allocation in process().
 *
 * Design goals:
 * - band-limited mipmapped procedural wavetables with frame morphing
 * - 8-way stereo unison, two wavetable oscillators + sub + colored noise
 * - FM/phase modulation + ring blend + phase warp
 * - per-note expression (pitch/pressure/timbre/pan)
 * - independent amp/filter envelopes
 * - per-voice resonant 2-pole multimode filter
 * - 2x internal oversampling option
 * - parameter smoothing, stereo chorus, saturation, output width
 */

#define MAX_VOICES 32
#define MAX_UNISON 8
#define WT_BASE_FRAMES 8
#define WT_FRAMES 16
#define WT_MIPS 7
#define WT_SIZE 1024
#define CHORUS_SIZE 4096
#define MAX_WG_DELAY 8192
#define GRAND_SEG_MAX 4096
#define GRAND_SB_MODES 24
#define HB_TAPS 31
#define PARAM_COUNT 157

/* v8 parameter indices. Descriptor IDs are index + 1. */
#define P_ENGINE 53
#define P_PHYSICAL_MIX 54
#define P_VOICE_DRIFT 55
#define P_VOICE_LFO_SPREAD 56
#define P_VOICE_AGE_MOTION 57
#define P_VOICE_TIMBRE_SPREAD 58
#define P_VOICE_PAN_SPREAD 59
#define P_PLUCK_PICK_POSITION 60
#define P_PLUCK_HARDNESS 61
#define P_PLUCK_DAMPING 62
#define P_PLUCK_DISPERSION 63
#define P_PLUCK_BODY_SIZE 64
#define P_PLUCK_BODY_MIX 65
#define P_PLUCK_SYMPATHETIC 66
#define P_PLUCK_BRIDGE_LOSS 67
#define P_PIANO_HAMMER_HARDNESS 68
#define P_PIANO_HAMMER_NOISE 69
#define P_PIANO_STRING_DAMPING 70
#define P_PIANO_STRING_UNISON 71
#define P_PIANO_INHARMONICITY 72
#define P_PIANO_SOUNDBOARD_SIZE 73
#define P_PIANO_SOUNDBOARD_MIX 74
#define P_PIANO_SYMPATHETIC 75
#define P_PIANO_STEREO_WIDTH 76
#define P_TINE_HAMMER_HARDNESS 77
#define P_TINE_DECAY 78
#define P_TINE_STIFFNESS 79
#define P_TINE_PICKUP_POSITION 80
#define P_TINE_PICKUP_DRIVE 81
#define P_TINE_BODY 82
#define P_TINE_BELL_MIX 83
#define P_BOW_PRESSURE 84
#define P_BOW_VELOCITY 85
#define P_BOW_POSITION 86
#define P_BOW_FRICTION 87
#define P_BOW_ROSIN_NOISE 88
#define P_BOW_STRING_DAMPING 89
#define P_BOW_STRING_STIFFNESS 90
#define P_BOW_BODY_SIZE 91
#define P_BOW_BODY_MIX 92
#define P_BOW_SYMPATHETIC 93
#define P_FLUTE_BREATH_PRESSURE 94
#define P_FLUTE_JET_RATIO 95
#define P_FLUTE_EMBOUCHURE 96
#define P_FLUTE_AIR_NOISE 97
#define P_FLUTE_BORE_LOSS 98
#define P_FLUTE_END_REFLECTION 99
#define P_FLUTE_BODY_SIZE 100
#define P_FLUTE_BODY_MIX 101
#define P_REED_BREATH_PRESSURE 102
#define P_REED_STIFFNESS 103
#define P_REED_APERTURE 104
#define P_REED_DAMPING 105
#define P_REED_NOISE 106
#define P_REED_BORE_CONICITY 107
#define P_REED_BELL_LOSS 108
#define P_REED_BODY_MIX 109
#define P_BRASS_BREATH_PRESSURE 110
#define P_BRASS_LIP_TENSION 111
#define P_BRASS_LIP_MASS 112
#define P_BRASS_LIP_DAMPING 113
#define P_BRASS_MOUTHPIECE 114
#define P_BRASS_BORE_FLARE 115
#define P_BRASS_BELL_LOSS 116
#define P_BRASS_AIR_NOISE 117
#define P_BRASS_BODY_MIX 118
#define P_VOCAL_GLOTTAL_TENSION 119
#define P_VOCAL_OPEN_QUOTIENT 120
#define P_VOCAL_BREATHINESS 121
#define P_VOCAL_VOWEL_MORPH 122
#define P_VOCAL_FORMANT_SHIFT 123
#define P_VOCAL_FORMANT_BANDWIDTH 124
#define P_VOCAL_FORMANT_3 125
#define P_VOCAL_FORMANT_4 126
#define P_VOCAL_CHEST 127
#define P_VOCAL_NASALITY 128
#define P_FILTER_QUALITY 129
#define P_STEREO_FILTER 130
#define P_DECIMATION_QUALITY 131
#define P_MOD1_SOURCE 132
#define P_MOD1_DEST 133
#define P_MOD1_AMOUNT 134
#define P_MOD2_SOURCE 135
#define P_MOD2_DEST 136
#define P_MOD2_AMOUNT 137
#define P_MOD3_SOURCE 138
#define P_MOD3_DEST 139
#define P_MOD3_AMOUNT 140
#define P_MOD4_SOURCE 141
#define P_MOD4_DEST 142
#define P_MOD4_AMOUNT 143
#define P_VOICE_MODE 144
#define P_NOTE_PRIORITY 145
#define P_POLYPHONY_LIMIT 146
#define P_DYNAMIC_VOICE_LIMIT 147
#define P_SUSTAIN_PEDAL 148
#define P_SOSTENUTO_PEDAL 149
#define P_LEGATO_RETRIGGER 150
#define P_HARD_SYNC 151
#define P_SYNC_RATIO 152
#define P_FM_SOURCE 153
#define P_PHASE_DISTORTION 154
#define P_ADAPTIVE_QUALITY 155
#define P_CPU_BUDGET 156


static int g_sr = 48000;
static unsigned int g_noise = 0x7f4a7c15u;
static float g_wt[WT_FRAMES][WT_MIPS][WT_SIZE];
static float g_params[PARAM_COUNT];
static float g_cutoff_smooth = 7200.0f;
static float g_master_smooth = 0.12f;
static float g_lfo1_phase = 0.0f;
static float g_lfo2_phase = 0.0f;
static float g_chorus_phase = 0.0f;
static float g_chorus_l[CHORUS_SIZE];
static float g_chorus_r[CHORUS_SIZE];
static int g_chorus_pos = 0;
static float g_noise_lp = 0.0f;
static float g_waveguide[MAX_VOICES][MAX_WG_DELAY];
/* Grand-piano v9 string topology.  Each unison string has four one-way
   traveling-wave segments around the physical hammer junction:
     hammer -> agraffe, agraffe -> hammer, hammer -> bridge, bridge -> hammer.
   This makes strike position an actual propagation distance instead of a
   spectral post-filter, and exposes the bridge-arrival wave to the soundboard. */
static float g_grand_h2a[3][MAX_VOICES][GRAND_SEG_MAX];
static float g_grand_a2h[3][MAX_VOICES][GRAND_SEG_MAX];
static float g_grand_h2b[3][MAX_VOICES][GRAND_SEG_MAX];
static float g_grand_b2h[3][MAX_VOICES][GRAND_SEG_MAX];

/* Distributed bridge/soundboard: bass, tenor and treble bridge zones feed a
   dense low-Q modal radiation field.  Feedback is returned per bridge zone,
   so active strings interact through the same physical body. */
static float g_grand_sb_ic1[GRAND_SB_MODES],g_grand_sb_ic2[GRAND_SB_MODES];
static float g_grand_board_drive[3]={0.0f,0.0f,0.0f};
static float g_grand_board_feedback[3]={0.0f,0.0f,0.0f};
static float g_grand_board_broad[3]={0.0f,0.0f,0.0f};
typedef struct { float z[HB_TAPS]; int pos; } HalfbandState;
static HalfbandState g_hb1_l,g_hb1_r,g_hb2_l,g_hb2_r;
static const float g_hb[HB_TAPS]={
 -0.00210427764f,0.00000193441f,0.00464657820f,-0.00000073722f,-0.00942193859f,0.00000287440f,0.01720493230f,-0.00000203912f,
 -0.02977845220f,0.00000516903f,0.05152179480f,-0.00000413558f,-0.09841637850f,0.00000478497f,0.31567875700f,0.49999566700f,
 0.31567875700f,0.00000478497f,-0.09841637850f,-0.00000413558f,0.05152179480f,0.00000516903f,-0.02977845220f,-0.00000203912f,
 0.01720493230f,0.00000287440f,-0.00942193859f,-0.00000073722f,0.00464657820f,0.00000193441f,-0.00210427764f
};

static float absf(float x){ return x < 0.0f ? -x : x; }
static float clampf(float x,float lo,float hi){ return x<lo?lo:(x>hi?hi:x); }
static int clampi(int x,int lo,int hi){ return x<lo?lo:(x>hi?hi:x); }
static float lerpf(float a,float b,float t){ return a + (b-a)*t; }
static float wrap01(float x){ while(x>=1.0f)x-=1.0f; while(x<0.0f)x+=1.0f; return x; }
static float phase_lerp(float a,float b,float t){float d=wrap01(b)-wrap01(a);if(d>0.5f)d-=1.0f;if(d<-0.5f)d+=1.0f;return wrap01(a+d*clampf(t,0.0f,1.0f));}
static float phase_distort(float p,float amount){
  p=wrap01(p);amount=clampf(amount,-1.0f,1.0f);if(absf(amount)<0.0001f)return p;
  float bp=0.5f+amount*0.42f;bp=clampf(bp,0.08f,0.92f);
  return p<bp?(p/bp)*0.5f:0.5f+((p-bp)/(1.0f-bp))*0.5f;
}
static float softclip(float x){ float a=absf(x); return x/(1.0f+0.55f*a); }

/* Phase p is cycles in [0,1). Good-quality fast sine approximation, no libm. */
static float fast_sine(float p){
  p=wrap01(p);
  float x=p*2.0f-1.0f;
  float y=4.0f*x*(1.0f-absf(x));
  y=0.225f*(y*absf(y)-y)+y;
  return -y;
}

/* exp2 for the small ranges used by tuning/filter tracking. */
static float fast_exp2(float x){
  int n=(int)x;
  if(x<0.0f && (float)n!=x)n--;
  float f=x-(float)n;
  float y=1.0f + 0.69314718f*f + 0.24022651f*f*f + 0.05550411f*f*f*f;
  if(n>0){ while(n--) y*=2.0f; }
  else { while(n++) y*=0.5f; }
  return y;
}
static float midi_hz(float pitch){ return 440.0f*fast_exp2((pitch-69.0f)/12.0f); }
static float cents_factor(float cents){ return fast_exp2(cents/1200.0f); }

static float rnd(void){
  g_noise=g_noise*1664525u+1013904223u;
  return ((float)((g_noise>>8)&0x00ffffffu)/8388607.5f)-1.0f;
}

static float base_frame_weight(int frame,int h){
  float hf=(float)h;
  if(frame==0) return h==1?1.0f:0.0f;
  if(frame==1){ if((h&1)==0)return 0.0f;float w=1.0f/(hf*hf);return ((h&3)==1)?w:-w; }
  if(frame==2) return 1.0f/hf;
  if(frame==3) return (h&1)?(1.0f/hf):0.0f;
  if(frame==4) return fast_sine(0.19f*hf)/hf;
  if(frame==5){float peak=(h>=4&&h<=7)?1.0f:((h>=11&&h<=14)?0.55f:0.15f);return peak/hf*2.2f;}
  if(frame==6){if(h==1)return .8f;if(h==2)return -.45f;if(h==5)return .72f;if(h==7)return -.55f;if(h==11)return .42f;if(h==13)return -.32f;return 0.0f;}
  return ((h&1)?1.0f:-0.45f)/(0.55f+0.48f*hf);
}

/* v8 builds 16 frames by interpolating harmonic coefficients before waveform
   synthesis. This is spectral-domain morphing rather than crossfading already
   synthesized tables, so intermediate frames preserve a coherent spectrum. */
static float frame_weight(int frame,int h){
  float p=(float)frame*(float)(WT_BASE_FRAMES-1)/(float)(WT_FRAMES-1);
  int f0=(int)p;int f1=f0<WT_BASE_FRAMES-1?f0+1:f0;float t=p-(float)f0;
  return lerpf(base_frame_weight(f0,h),base_frame_weight(f1,h),t);
}

static void build_wavetables(void){
  static const int max_h[WT_MIPS]={64,32,16,8,4,2,1};
  for(int f=0;f<WT_FRAMES;f++){
    for(int m=0;m<WT_MIPS;m++){
      float maxabs=0.000001f;
      for(int i=0;i<WT_SIZE;i++){
        float p=(float)i/(float)WT_SIZE;
        float x=0.0f;
        for(int h=1;h<=max_h[m];h++){
          float w=frame_weight(f,h);
          if(w!=0.0f)x += w*fast_sine(p*(float)h);
        }
        g_wt[f][m][i]=x;
        float a=absf(x); if(a>maxabs)maxabs=a;
      }
      float norm=0.92f/maxabs;
      for(int i=0;i<WT_SIZE;i++)g_wt[f][m][i]*=norm;
    }
  }
}

static int mip_for_freq(float freq){
  static const int max_h[WT_MIPS]={64,32,16,8,4,2,1};
  float limit=(float)g_sr*0.43f;
  for(int m=0;m<WT_MIPS;m++)if(freq*(float)max_h[m] <= limit)return m;
  return WT_MIPS-1;
}

static float wt_lookup(float phase,float pos,float freq,float warp,float pulse_width){
  phase=wrap01(phase);
  /* PWM-style phase remap is strongest around the square/pulse frames. */
  float frame_pos=clampf(pos,0.0f,1.0f)*(float)(WT_FRAMES-1);
  float pulse_weight=1.0f-clampf(absf(frame_pos-3.5f)/1.5f,0.0f,1.0f);
  if(pulse_weight>0.0001f){
    float pw=clampf(pulse_width,0.05f,0.95f);
    float remapped=phase<pw ? (phase/pw)*0.5f : 0.5f+((phase-pw)/(1.0f-pw))*0.5f;
    phase=lerpf(phase,remapped,pulse_weight);
  }
  if(warp>0.0001f){
    phase=wrap01(phase + fast_sine(phase)*warp*0.115f);
  }
  pos=clampf(pos,0.0f,1.0f)*(float)(WT_FRAMES-1);
  int f0=(int)pos;
  int f1=f0<WT_FRAMES-1?f0+1:f0;
  float ft=pos-(float)f0;
  int mip=mip_for_freq(freq);
  float idx=phase*(float)WT_SIZE;
  int i0=(int)idx;
  if(i0>=WT_SIZE)i0=0;
  int i1=i0+1; if(i1>=WT_SIZE)i1=0;
  float it=idx-(float)i0;
  float a0=lerpf(g_wt[f0][mip][i0],g_wt[f0][mip][i1],it);
  float a1=lerpf(g_wt[f1][mip][i0],g_wt[f1][mip][i1],it);
  return lerpf(a0,a1,ft);
}

typedef struct {
  int active;
  int id;
  int amp_stage;
  int filt_stage;
  float pitch;
  float base_pitch;
  float velocity;
  float pressure;
  float pressure_target;
  float timbre;
  float timbre_target;
  float expr_volume;
  float expr_volume_target;
  float expr_pan;
  float expr_pan_target;
  float amp_env;
  float filt_env;
  float amp_release_start;
  float filt_release_start;
  float glide_pitch;
  float phase_a[MAX_UNISON];
  float phase_b[MAX_UNISON];
  float phase_sub;
  float lp1;
  float lp2;
  float svf_ic1_l;
  float svf_ic2_l;
  float svf_ic1_r;
  float svf_ic2_r;
  float modal1_ic1;
  float modal1_ic2;
  float modal2_ic1;
  float modal2_ic2;
  float modal3_ic1;
  float modal3_ic2;
  float modal4_ic1;
  float modal4_ic2;
  float modal5_ic1;
  float modal5_ic2;
  float modal6_ic1;
  float modal6_ic2;
  float modal7_ic1;
  float modal7_ic2;
  float modal8_ic1;
  float modal8_ic2;
  float modal9_ic1;
  float modal9_ic2;
  float modal10_ic1;
  float modal10_ic2;
  float form1_ic1;
  float form1_ic2;
  float form2_ic1;
  float form2_ic2;
  int wg_pos;
  int wg_len;
  int grand_a_pos[3];
  int grand_a_len[3];
  float grand_a_frac[3];
  int grand_b_pos[3];
  int grand_b_len[3];
  float grand_b_frac[3];
  float grand_agraffe_lp[3];
  float grand_bridge_lp[3];
  float grand_disp_a[3];
  float grand_disp_b[3];
  /* Unity-magnitude fractional-delay states for the four traveling directions.
     Linear interpolation was stable but acted as an unintended HF loss on
     every round trip. */
  float grand_fd_a2h_x[3],grand_fd_a2h_y[3];
  float grand_fd_h2a_x[3],grand_fd_h2a_y[3];
  float grand_fd_b2h_x[3],grand_fd_b2h_y[3];
  float grand_fd_h2b_x[3],grand_fd_h2b_y[3];
  float grand_bridge_radiation_prev;
  float lfo1_phase;
  float lfo2_phase;
  float drift_phase;
  float res1;
  float res2;
  float physical_prev;
  float physical_aux;
  /* De-click state for voice stealing.  When all 32 voices are busy, keep
     the stolen voice's final contribution and crossfade it into the new
     voice instead of hard-resetting the waveform at the note boundary. */
  float steal_tail_l;
  float steal_tail_r;
  float steal_fade;
  float last_out_l;
  float last_out_r;
  float age;
  float voice_timbre_bias;
  float voice_pan_bias;
  int key_down;
  int sostenuto_latched;
  unsigned int note_order;
  float mod_body_ic1;
  float mod_body_ic2;
} Voice;

static Voice g_voices[MAX_VOICES];
typedef struct { int down; int id; float pitch; float velocity; unsigned int order; } HeldNote;
static HeldNote g_held[MAX_VOICES];
static unsigned int g_note_order=1;

static void release_voice(Voice* q){
  if(!q->active||q->amp_stage==3)return;
  q->amp_stage=3;q->filt_stage=3;q->amp_release_start=q->amp_env;q->filt_release_start=q->filt_env;
}
static void release_unheld_voices(void){
  for(int i=0;i<MAX_VOICES;i++)if(g_voices[i].active&&!g_voices[i].key_down&&!g_voices[i].sostenuto_latched)release_voice(&g_voices[i]);
}
static void held_add(int id,float pitch,float velocity){
  int slot=-1;for(int i=0;i<MAX_VOICES;i++){if(g_held[i].down&&g_held[i].id==id){slot=i;break;}if(slot<0&&!g_held[i].down)slot=i;}
  if(slot<0){unsigned int best=0xffffffffu;slot=0;for(int i=0;i<MAX_VOICES;i++)if(g_held[i].order<best){best=g_held[i].order;slot=i;}}
  g_held[slot].down=1;g_held[slot].id=id;g_held[slot].pitch=pitch;g_held[slot].velocity=velocity;g_held[slot].order=g_note_order++;
}
static void held_remove(int id){for(int i=0;i<MAX_VOICES;i++)if(g_held[i].down&&g_held[i].id==id){g_held[i].down=0;return;}}
static HeldNote* held_select(void){
  HeldNote* best=0;int pri=clampi((int)(g_params[P_NOTE_PRIORITY]+0.5f),0,2);
  for(int i=0;i<MAX_VOICES;i++)if(g_held[i].down){HeldNote* h=&g_held[i];if(!best)best=h;else if(pri==0&&h->order>best->order)best=h;else if(pri==1&&h->pitch<best->pitch)best=h;else if(pri==2&&h->pitch>best->pitch)best=h;}
  return best;
}

static void defaults(void){
  for(int i=0;i<PARAM_COUNT;i++)g_params[i]=0.0f;
  g_params[0]=0.12f; g_params[1]=0.72f; g_params[2]=0.42f; g_params[3]=0.18f;
  g_params[4]=1.0f; g_params[5]=0.30f; g_params[6]=0.10f; g_params[7]=0.015f;
  g_params[8]=0.0f; g_params[9]=7.0f; g_params[10]=3.0f; g_params[11]=12.0f;
  g_params[12]=0.66f; g_params[13]=0.0f; g_params[14]=0.0f;
  g_params[15]=0.008f; g_params[16]=0.16f; g_params[17]=0.72f; g_params[18]=0.32f;
  g_params[19]=7200.0f; g_params[20]=0.16f; g_params[21]=0.08f; g_params[22]=0.0f;
  g_params[23]=0.42f; g_params[24]=0.004f; g_params[25]=0.24f; g_params[26]=0.18f; g_params[27]=0.28f;
  g_params[28]=0.32f; g_params[29]=0.22f; g_params[30]=0.25f; g_params[31]=0.28f;
  g_params[32]=5.2f; g_params[33]=0.0f; g_params[34]=0.0f; g_params[35]=0.21f; g_params[36]=0.0f;
  g_params[37]=0.72f; g_params[38]=0.0f; g_params[39]=0.0f;
  g_params[40]=0.12f; g_params[41]=0.31f; g_params[42]=0.34f; g_params[43]=0.08f;
  g_params[44]=0.12f; g_params[45]=1.0f; g_params[46]=0.0f; g_params[47]=0.0f;
  g_params[48]=0.50f; g_params[49]=-1.0f; g_params[50]=-0.10f; g_params[51]=1.05f; g_params[52]=1.0f;
  g_params[P_ENGINE]=0.0f; g_params[P_PHYSICAL_MIX]=1.0f;
  g_params[P_VOICE_DRIFT]=2.0f; g_params[P_VOICE_LFO_SPREAD]=0.55f; g_params[P_VOICE_AGE_MOTION]=0.35f; g_params[P_VOICE_TIMBRE_SPREAD]=0.12f; g_params[P_VOICE_PAN_SPREAD]=0.10f;
  g_params[P_PLUCK_PICK_POSITION]=0.22f; g_params[P_PLUCK_HARDNESS]=0.55f; g_params[P_PLUCK_DAMPING]=0.28f; g_params[P_PLUCK_DISPERSION]=0.18f; g_params[P_PLUCK_BODY_SIZE]=0.55f; g_params[P_PLUCK_BODY_MIX]=0.55f; g_params[P_PLUCK_SYMPATHETIC]=0.15f; g_params[P_PLUCK_BRIDGE_LOSS]=0.22f;
  g_params[P_PIANO_HAMMER_HARDNESS]=0.35f; g_params[P_PIANO_HAMMER_NOISE]=0.62f; g_params[P_PIANO_STRING_DAMPING]=0.28f; g_params[P_PIANO_STRING_UNISON]=0.45f; g_params[P_PIANO_INHARMONICITY]=0.35f; g_params[P_PIANO_SOUNDBOARD_SIZE]=0.65f; g_params[P_PIANO_SOUNDBOARD_MIX]=0.65f; g_params[P_PIANO_SYMPATHETIC]=0.35f; g_params[P_PIANO_STEREO_WIDTH]=0.55f;
  g_params[P_TINE_HAMMER_HARDNESS]=0.62f; g_params[P_TINE_DECAY]=0.50f; g_params[P_TINE_STIFFNESS]=0.58f; g_params[P_TINE_PICKUP_POSITION]=0.38f; g_params[P_TINE_PICKUP_DRIVE]=0.28f; g_params[P_TINE_BODY]=0.35f; g_params[P_TINE_BELL_MIX]=0.38f;
  g_params[P_BOW_PRESSURE]=0.58f; g_params[P_BOW_VELOCITY]=0.52f; g_params[P_BOW_POSITION]=0.18f; g_params[P_BOW_FRICTION]=0.65f; g_params[P_BOW_ROSIN_NOISE]=0.08f; g_params[P_BOW_STRING_DAMPING]=0.12f; g_params[P_BOW_STRING_STIFFNESS]=0.18f; g_params[P_BOW_BODY_SIZE]=0.65f; g_params[P_BOW_BODY_MIX]=0.60f; g_params[P_BOW_SYMPATHETIC]=0.25f;
  g_params[P_FLUTE_BREATH_PRESSURE]=0.62f; g_params[P_FLUTE_JET_RATIO]=0.33f; g_params[P_FLUTE_EMBOUCHURE]=0.50f; g_params[P_FLUTE_AIR_NOISE]=0.18f; g_params[P_FLUTE_BORE_LOSS]=0.10f; g_params[P_FLUTE_END_REFLECTION]=0.88f; g_params[P_FLUTE_BODY_SIZE]=0.45f; g_params[P_FLUTE_BODY_MIX]=0.35f;
  g_params[P_REED_BREATH_PRESSURE]=0.68f; g_params[P_REED_STIFFNESS]=0.55f; g_params[P_REED_APERTURE]=0.45f; g_params[P_REED_DAMPING]=0.18f; g_params[P_REED_NOISE]=0.10f; g_params[P_REED_BORE_CONICITY]=0.62f; g_params[P_REED_BELL_LOSS]=0.20f; g_params[P_REED_BODY_MIX]=0.45f;
  g_params[P_BRASS_BREATH_PRESSURE]=0.72f; g_params[P_BRASS_LIP_TENSION]=0.55f; g_params[P_BRASS_LIP_MASS]=0.45f; g_params[P_BRASS_LIP_DAMPING]=0.18f; g_params[P_BRASS_MOUTHPIECE]=0.50f; g_params[P_BRASS_BORE_FLARE]=0.58f; g_params[P_BRASS_BELL_LOSS]=0.18f; g_params[P_BRASS_AIR_NOISE]=0.05f; g_params[P_BRASS_BODY_MIX]=0.50f;
  g_params[P_VOCAL_GLOTTAL_TENSION]=0.55f; g_params[P_VOCAL_OPEN_QUOTIENT]=0.50f; g_params[P_VOCAL_BREATHINESS]=0.08f; g_params[P_VOCAL_VOWEL_MORPH]=0.45f; g_params[P_VOCAL_FORMANT_SHIFT]=0.0f; g_params[P_VOCAL_FORMANT_BANDWIDTH]=0.45f; g_params[P_VOCAL_FORMANT_3]=0.55f; g_params[P_VOCAL_FORMANT_4]=0.45f; g_params[P_VOCAL_CHEST]=0.35f; g_params[P_VOCAL_NASALITY]=0.12f;
  g_params[P_FILTER_QUALITY]=1.0f; g_params[P_STEREO_FILTER]=1.0f; g_params[P_DECIMATION_QUALITY]=1.0f;
  g_params[P_MOD1_SOURCE]=0.0f;g_params[P_MOD1_DEST]=0.0f;g_params[P_MOD1_AMOUNT]=0.0f;
  g_params[P_MOD2_SOURCE]=0.0f;g_params[P_MOD2_DEST]=1.0f;g_params[P_MOD2_AMOUNT]=0.0f;
  g_params[P_MOD3_SOURCE]=0.0f;g_params[P_MOD3_DEST]=7.0f;g_params[P_MOD3_AMOUNT]=0.0f;
  g_params[P_MOD4_SOURCE]=0.0f;g_params[P_MOD4_DEST]=8.0f;g_params[P_MOD4_AMOUNT]=0.0f;
  g_params[P_VOICE_MODE]=0.0f;g_params[P_NOTE_PRIORITY]=0.0f;g_params[P_POLYPHONY_LIMIT]=32.0f;g_params[P_DYNAMIC_VOICE_LIMIT]=1.0f;
  g_params[P_SUSTAIN_PEDAL]=0.0f;g_params[P_SOSTENUTO_PEDAL]=0.0f;g_params[P_LEGATO_RETRIGGER]=0.0f;
  g_params[P_HARD_SYNC]=0.0f;g_params[P_SYNC_RATIO]=2.0f;g_params[P_FM_SOURCE]=0.0f;g_params[P_PHASE_DISTORTION]=0.0f;g_params[P_ADAPTIVE_QUALITY]=0.0f;g_params[P_CPU_BUDGET]=0.75f;
  g_cutoff_smooth=g_params[19]; g_master_smooth=g_params[0];
}

void dsp_init(int sample_rate,int max_block_size){
  (void)max_block_size;
  g_sr=sample_rate>8000?sample_rate:48000;
  defaults();
  build_wavetables();
  for(int i=0;i<MAX_VOICES;i++){g_voices[i].active=0;g_held[i].down=0;}g_note_order=1;
  for(int i=0;i<CHORUS_SIZE;i++){g_chorus_l[i]=0.0f;g_chorus_r[i]=0.0f;}
  g_chorus_pos=0;g_lfo1_phase=g_lfo2_phase=g_chorus_phase=0.0f;g_noise_lp=0.0f;
  for(int i=0;i<HB_TAPS;i++){g_hb1_l.z[i]=g_hb1_r.z[i]=g_hb2_l.z[i]=g_hb2_r.z[i]=0.0f;}g_hb1_l.pos=g_hb1_r.pos=g_hb2_l.pos=g_hb2_r.pos=0;
  for(int i=0;i<GRAND_SB_MODES;i++){g_grand_sb_ic1[i]=0.0f;g_grand_sb_ic2[i]=0.0f;}
  for(int i=0;i<3;i++){g_grand_board_drive[i]=0.0f;g_grand_board_feedback[i]=0.0f;g_grand_board_broad[i]=0.0f;}
}

void dsp_reset(void){
  for(int i=0;i<MAX_VOICES;i++){g_voices[i].active=0;g_held[i].down=0;}g_note_order=1;
  for(int i=0;i<CHORUS_SIZE;i++){g_chorus_l[i]=0.0f;g_chorus_r[i]=0.0f;}
  g_chorus_pos=0;g_lfo1_phase=g_lfo2_phase=g_chorus_phase=0.0f;g_noise_lp=0.0f;
  for(int i=0;i<HB_TAPS;i++){g_hb1_l.z[i]=g_hb1_r.z[i]=g_hb2_l.z[i]=g_hb2_r.z[i]=0.0f;}g_hb1_l.pos=g_hb1_r.pos=g_hb2_l.pos=g_hb2_r.pos=0;
  for(int i=0;i<GRAND_SB_MODES;i++){g_grand_sb_ic1[i]=0.0f;g_grand_sb_ic2[i]=0.0f;}
  for(int i=0;i<3;i++){g_grand_board_drive[i]=0.0f;g_grand_board_feedback[i]=0.0f;g_grand_board_broad[i]=0.0f;}
}

void dsp_set_parameter(int id,float value,int sample_offset){
  (void)sample_offset;
  if(id<0||id>=PARAM_COUNT)return;
  float old_value=g_params[id];
  if(id>=P_PHYSICAL_MIX && id<=P_VOCAL_NASALITY && id!=P_VOICE_DRIFT && id!=P_VOCAL_FORMANT_SHIFT){
    value=clampf(value,0.0f,1.0f);
  }else switch(id){
    case 0:case 1:case 2:case 3:case 4:case 5:case 6:case 7:case 12:case 13:case 14:
    case 17:case 20:case 21:case 26:case 28:case 29:case 30:case 31:case 37:case 40:case 42:case 43:case 44:case 46:case 47:
      value=clampf(value,0.0f,1.0f);break;
    case 10:value=(float)clampi((int)(value+0.5f),1,MAX_UNISON);break;
    case 11:value=clampf(value,0.0f,60.0f);break;
    case 19:value=clampf(value,20.0f,20000.0f);break;
    case 22:value=(float)clampi((int)(value+0.5f),0,2);break;
    case 23:case 34:case 36:case 38:case 50:value=clampf(value,-1.0f,1.0f);break;
    case 32:value=clampf(value,0.01f,40.0f);break;
    case 35:value=clampf(value,0.01f,20.0f);break;
    case 45:value=(float)clampi((int)(value+0.5f),0,2);break;
    case 48:value=clampf(value,0.05f,0.95f);break;
    case 49:value=(float)clampi((int)value,-2,0);break;
    case 51:value=clampf(value,0.0f,2.0f);break;
    case 52:value=value>=0.5f?1.0f:0.0f;break;
    case P_ENGINE:value=(float)clampi((int)(value+0.5f),0,9);break;
    case P_VOICE_DRIFT:value=clampf(value,0.0f,20.0f);break;
    case P_VOCAL_FORMANT_SHIFT:value=clampf(value,-1.0f,1.0f);break;
    case P_FILTER_QUALITY:case P_DECIMATION_QUALITY:value=(float)clampi((int)(value+0.5f),0,1);break;
    case P_STEREO_FILTER:case P_DYNAMIC_VOICE_LIMIT:case P_SUSTAIN_PEDAL:case P_SOSTENUTO_PEDAL:case P_LEGATO_RETRIGGER:case P_ADAPTIVE_QUALITY:value=value>=0.5f?1.0f:0.0f;break;
    case P_MOD1_SOURCE:case P_MOD2_SOURCE:case P_MOD3_SOURCE:case P_MOD4_SOURCE:value=(float)clampi((int)(value+0.5f),0,9);break;
    case P_MOD1_DEST:case P_MOD2_DEST:case P_MOD3_DEST:case P_MOD4_DEST:value=(float)clampi((int)(value+0.5f),0,8);break;
    case P_MOD1_AMOUNT:case P_MOD2_AMOUNT:case P_MOD3_AMOUNT:case P_MOD4_AMOUNT:case P_PHASE_DISTORTION:value=clampf(value,-1.0f,1.0f);break;
    case P_VOICE_MODE:case P_NOTE_PRIORITY:case P_FM_SOURCE:value=(float)clampi((int)(value+0.5f),0,2);break;
    case P_POLYPHONY_LIMIT:value=(float)clampi((int)(value+0.5f),1,MAX_VOICES);break;
    case P_HARD_SYNC:value=clampf(value,0.0f,1.0f);break;
    case P_SYNC_RATIO:value=clampf(value,1.0f,8.0f);break;
    case P_CPU_BUDGET:value=clampf(value,0.25f,1.0f);break;
    default:break;
  }
  g_params[id]=value;
  if(id==P_SOSTENUTO_PEDAL && old_value<0.5f && value>=0.5f){for(int i=0;i<MAX_VOICES;i++)if(g_voices[i].active&&g_voices[i].key_down)g_voices[i].sostenuto_latched=1;}
  if(id==P_SOSTENUTO_PEDAL && old_value>=0.5f && value<0.5f){for(int i=0;i<MAX_VOICES;i++)g_voices[i].sostenuto_latched=0;if(g_params[P_SUSTAIN_PEDAL]<0.5f)release_unheld_voices();}
  if(id==P_SUSTAIN_PEDAL && old_value>=0.5f && value<0.5f)release_unheld_voices();
}

static int voice_index(Voice* q){return (int)(q-g_voices);}

static void prepare_waveguide(Voice* q,float pitch,float velocity){
  int vi=voice_index(q);
  int osm=clampi((int)(g_params[45]+0.5f),0,2);
  float rate=(float)g_sr*(float)(1<<osm),hz=midi_hz(pitch);
  int len=clampi((int)(rate/(hz>8.0f?hz:8.0f)+0.5f),8,MAX_WG_DELAY-2);
  q->wg_len=len;q->wg_pos=0;
  for(int i=0;i<len;i++)g_waveguide[vi][i]=0.0f;
  if(clampi((int)(g_params[P_ENGINE]+0.5f),0,9)==1){
    float hard=g_params[P_PLUCK_HARDNESS],smooth=0.06f+(1.0f-hard)*0.80f,prev=0.0f;
    for(int i=0;i<len;i++){float n=rnd();float shaped=lerpf(n,prev,smooth);prev=shaped;g_waveguide[vi][i]=shaped;}
    int off=clampi((int)(g_params[P_PLUCK_PICK_POSITION]*(float)len),2,len-2);
    float scale=velocity*(0.14f+0.46f*hard);
    for(int i=0;i<len;i++){int j=i+off;if(j>=len)j-=len;g_waveguide[vi][i]=(g_waveguide[vi][i]-g_waveguide[vi][j])*scale;}
  }
}

static int grand_string_count(float pitch){return pitch<36.0f?1:(pitch<48.0f?2:3);}

static void grand_setup_segment(float delay,int* len,float* frac){
  delay=clampf(delay,1.05f,(float)(GRAND_SEG_MAX-2));
  int base=(int)delay;
  int n=base+((float)base<delay?1:0);
  n=clampi(n,2,GRAND_SEG_MAX-2);
  *len=n;*frac=clampf((float)n-delay,0.0f,.9999f);
}

static float grand_delay_read(float* z,int pos,int len,float frac){
  if(len<2)return 0.0f;
  if(pos>=len)pos=0;
  int next=pos+1;if(next>=len)next=0;
  return lerpf(z[pos],z[next],frac);
}

/* First-order Thiran-style fractional delay.  The integer tap is len-1 samples
   old and the all-pass contributes the remaining 1-frac sample.  Magnitude is
   unity, so fractional tuning no longer erases upper string partials. */
static float grand_delay_read_ap(float* z,int pos,int len,float frac,float* xp,float* yp){
  if(len<2)return 0.0f;
  if(pos>=len)pos=0;
  int next=pos+1;if(next>=len)next=0;
  float x=z[next];
  float d=clampf(1.0f-frac,.002f,.998f);
  float a=(1.0f-d)/(1.0f+d);
  float y=a*x+*xp-a*(*yp);
  *xp=x;*yp=y;
  return y;
}

static float grand_allpass(float x,float a,float* state){
  a=clampf(a,-.72f,.72f);
  float y=*state-a*x;
  *state=x+a*y;
  return y;
}

static void grand_zone_weights(float key,float* bass,float* tenor,float* treble){
  key=clampf(key,0.0f,1.0f);
  float b=clampf(1.0f-key*2.0f,0.0f,1.0f);
  float t=clampf(key*2.0f-1.0f,0.0f,1.0f);
  float m=1.0f-b-t;
  /* Only the lowest wound strings need less tenor-bridge leakage.  Above the
     bass transition, preserve the already-calibrated v9 zone geometry exactly. */
  if(key<.32f){
    float gate=clampf((key-.14f)/.18f,0.0f,1.0f);
    m*=gate;b=1.0f-m;t=0.0f;
  }
  *bass=b;*tenor=m;*treble=t;
}

static void prepare_grand_strings(Voice* q,float pitch){
  int vi=voice_index(q);
  int osm=clampi((int)(g_params[45]+0.5f),0,2);
  float rate=(float)g_sr*(float)(1<<osm);
  float key=clampf((pitch-21.0f)/87.0f,0.0f,1.0f);
  /* Real grands strike close to one end of the speaking length.  Moving the
     hammer slightly closer to the termination in the treble keeps the expected
     register-dependent spectral notch without exposing another public control. */
  float strike=lerpf(.145f,.095f,key);
  float uni=g_params[P_PIANO_STRING_UNISON]*clampf((pitch-29.0f)/43.0f,0.0f,1.0f);
  float cents=(.045f+1.02f*uni)*(.68f+.46f*key);
  const float offs[3]={0.0f,1.0f,-.84f};
  int count=grand_string_count(pitch);
  for(int st=0;st<3;st++){
    float hz=midi_hz(pitch+(st<count?offs[st]*cents/100.0f:0.0f));
    /* A real unison is not three geometrically identical strings.  Tiny strike-
       position/support differences fill the unrealistically perfect 7th/8th-
       partial notch of a point-hammer model and produce the measured richer
       upper-partial envelope without adding an oscillator. */
    const float strike_off[3]={0.0f,1.0f,-.82f};
    float strike_delta=(.0022f+.0065f*uni)*strike_off[st];
    float strike_st=clampf(strike+strike_delta,.070f,.175f);
    /* Boundary filters/all-pass sections contribute about one internal sample
       of phase delay, so shorten the geometric delay by that termination delay. */
    float one_way=rate/(2.0f*(hz>8.0f?hz:8.0f))-1.0f;
    grand_setup_segment(one_way*strike_st,&q->grand_a_len[st],&q->grand_a_frac[st]);
    grand_setup_segment(one_way*(1.0f-strike_st),&q->grand_b_len[st],&q->grand_b_frac[st]);
    q->grand_a_pos[st]=q->grand_b_pos[st]=0;
    q->grand_agraffe_lp[st]=q->grand_bridge_lp[st]=0.0f;
    q->grand_disp_a[st]=q->grand_disp_b[st]=0.0f;
    q->grand_fd_a2h_x[st]=q->grand_fd_a2h_y[st]=0.0f;
    q->grand_fd_h2a_x[st]=q->grand_fd_h2a_y[st]=0.0f;
    q->grand_fd_b2h_x[st]=q->grand_fd_b2h_y[st]=0.0f;
    q->grand_fd_h2b_x[st]=q->grand_fd_h2b_y[st]=0.0f;
    int al=q->grand_a_len[st],bl=q->grand_b_len[st];
    for(int i=0;i<al;i++){g_grand_h2a[st][vi][i]=0.0f;g_grand_a2h[st][vi][i]=0.0f;}
    for(int i=0;i<bl;i++){g_grand_h2b[st][vi][i]=0.0f;g_grand_b2h[st][vi][i]=0.0f;}
  }
  q->grand_bridge_radiation_prev=0.0f;
}

/* Hammer-point displacement/velocity proxy from the two incoming traveling
   waves.  This is sampled before scattering so the nonlinear felt force is
   genuinely coupled to the current string state. */
static float grand_string_contact(Voice* q){
  int vi=voice_index(q),count=grand_string_count(q->glide_pitch);
  float mean=0.0f;
  for(int st=0;st<count;st++){
    float ia=grand_delay_read(g_grand_a2h[st][vi],q->grand_a_pos[st],q->grand_a_len[st],q->grand_a_frac[st]);
    float ib=grand_delay_read(g_grand_b2h[st][vi],q->grand_b_pos[st],q->grand_b_len[st],q->grand_b_frac[st]);
    mean+=(ia+ib)*.5f;
  }
  return mean/(count>0?(float)count:1.0f);
}

/* Four-segment traveling-wave piano string.  The hammer is a matched scattering
   junction; agraffe and bridge are separate, frequency-dependent terminations.
   Stiffness is represented by weak all-pass dispersion in the reflected waves.
   The bridge-arrival force is exported separately to the shared soundboard. */
static float grand_strings_step(Voice* q,float hammer,float rate,float* bridge_out){
  int vi=voice_index(q),count=grand_string_count(q->glide_pitch);
  float key=clampf((q->glide_pitch-21.0f)/87.0f,0.0f,1.0f);
  float damping=g_params[P_PIANO_STRING_DAMPING];
  float inh=g_params[P_PIANO_INHARMONICITY];
  float sy=g_params[P_PIANO_SYMPATHETIC];
  float zb,zm,zt;grand_zone_weights(key,&zb,&zm,&zt);
  float body_fb=g_grand_board_feedback[0]*zb+g_grand_board_feedback[1]*zm+g_grand_board_feedback[2]*zt;
  float string_sum=0.0f,bridge_sum=0.0f;
  float release=q->amp_stage==3?(0.00006f+.00025f*damping+.00008f*key):0.0f;
  float disp=.018f+inh*(.045f+.16f*key);
  const float imp[3]={1.0f,.965f,1.035f};
  for(int st=0;st<count;st++){
    int ap=q->grand_a_pos[st],al=q->grand_a_len[st];
    int bp=q->grand_b_pos[st],bl=q->grand_b_len[st];
    float in_a=grand_delay_read_ap(g_grand_a2h[st][vi],ap,al,q->grand_a_frac[st],&q->grand_fd_a2h_x[st],&q->grand_fd_a2h_y[st]);
    float in_b=grand_delay_read_ap(g_grand_b2h[st][vi],bp,bl,q->grand_b_frac[st],&q->grand_fd_b2h_x[st],&q->grand_fd_b2h_y[st]);
    float at_a=grand_delay_read_ap(g_grand_h2a[st][vi],ap,al,q->grand_a_frac[st],&q->grand_fd_h2a_x[st],&q->grand_fd_h2a_y[st]);
    float at_b=grand_delay_read_ap(g_grand_h2b[st][vi],bp,bl,q->grand_b_frac[st],&q->grand_fd_h2b_x[st],&q->grand_fd_h2b_y[st]);

    /* Boundary impedance is lossy and increasingly low-pass toward the treble.
       The bridge is less rigid than the agraffe and receives soundboard motion. */
    float aa=clampf(.79f-.10f*damping-.035f*key,.58f,.84f);
    float ab=clampf(.76f-.13f*damping-.055f*key,.52f,.82f);
    q->grand_agraffe_lp[st]+=aa*(at_a-q->grand_agraffe_lp[st]);
    q->grand_bridge_lp[st]+=ab*(at_b-q->grand_bridge_lp[st]);
    float wound=clampf((48.0f-q->glide_pitch)/19.0f,0.0f,1.0f);
    float hf_a=.002f+.012f*damping+.003f*key + wound*.026f;
    float hf_b=.004f+.020f*damping+.006f*key + wound*.044f;
    float fa=lerpf(at_a,q->grand_agraffe_lp[st],hf_a);
    float fb=lerpf(at_b,q->grand_bridge_lp[st],hf_b);
    float loss_a=.99980f-(.00010f+.0011f*key)*(.38f+1.05f*damping);
    float loss_b=.99955f-(.00025f+.0020f*key)*(.42f+1.15f*damping)-release;
    /* Real-note calibration: low/mid strings need more per-roundtrip loss than
       the old nearly-constant reflection model, while upper strings already
       accumulate enough loss through their much faster round trips. */
    float ref_loss=.00140f*clampf((.68f-key)/.45f,0.0f,1.0f)*(1.82f-.82f*q->velocity);
    loss_a-=ref_loss;loss_b-=ref_loss*1.08f;
    loss_a=clampf(loss_a,.970f,.9998f);loss_b=clampf(loss_b,.930f,.9996f);
    float ret_a=grand_allpass(-fa*loss_a,disp*.72f,&q->grand_disp_a[st]);
    float ret_b=grand_allpass(-fb*loss_b,disp,&q->grand_disp_b[st]);
    /* The board-to-string mobility is much lower in the wound-bass register.
       Strong low-register feedback turns shared plate modes into a drone when
       pedalled chords accumulate, so scale the coupling with register. */
    float board_string_couple=.00030f+.00068f*key;
    ret_b += body_fb*sy*board_string_couple;

    /* Equal-impedance hammer junction.  Incoming energy crosses to the opposite
       segment; contact force launches waves in both directions. */
    /* The old launch scale left the modeled string roughly 20 dB below the
       recorded reference after the shared output stage. Calibrate wave energy
       at the hammer junction so the bridge and string paths retain headroom. */
    float inj=hammer*(.032f+.032f*(1.0f-key))*imp[st]/(.78f+.22f*(float)count);
    float out_a=softclip((in_b+inj)*1.0004f);
    float out_b=softclip((in_a+inj)*1.0004f);

    g_grand_h2a[st][vi][ap]=out_a;
    g_grand_a2h[st][vi][ap]=ret_a;
    g_grand_h2b[st][vi][bp]=out_b;
    g_grand_b2h[st][vi][bp]=ret_b;
    ap++;if(ap>=al)ap=0;bp++;if(bp>=bl)bp=0;
    q->grand_a_pos[st]=ap;q->grand_b_pos[st]=bp;

    float junction=(in_a+in_b)*.5f;
    float bridge_force=at_b-ret_b;
    string_sum+=junction;
    bridge_sum+=bridge_force;
  }
  float inv=1.0f/(count>0?(float)count:1.0f);
  *bridge_out=bridge_sum*inv;
  return string_sum*inv;
}

static void init_voice(Voice* q,int note_id,float pitch,float velocity){
  float old=q->glide_pitch;
  q->active=1;q->id=note_id;q->base_pitch=pitch;q->pitch=pitch;
  q->velocity=clampf(velocity,0.0f,1.0f);
  /* Continuous-excitation instruments need a sensible MIDI-note baseline even
     when no MPE pressure event is sent. A later pressure expression can still
     drive them all the way to zero. */
  int engine=clampi((int)(g_params[P_ENGINE]+0.5f),0,9);
  q->pressure=q->pressure_target=0.0f;
  q->timbre=q->timbre_target=0.5f;
  q->expr_volume=q->expr_volume_target=1.0f;
  q->expr_pan=q->expr_pan_target=0.0f;
  if(g_params[39]>0.0001f && old>0.0f)q->glide_pitch=old;else q->glide_pitch=pitch;
  if(g_params[52]>=0.5f || q->amp_env<0.0001f){q->amp_env=0.0f;q->filt_env=0.0f;q->amp_stage=0;q->filt_stage=0;}
  q->amp_release_start=q->filt_release_start=0.0f;q->lp1=q->lp2=0.0f;q->res1=q->res2=0.0f;q->physical_prev=q->physical_aux=0.0f;
  q->steal_tail_l=q->steal_tail_r=q->steal_fade=q->last_out_l=q->last_out_r=0.0f;q->age=0.0f;
  q->svf_ic1_l=q->svf_ic2_l=q->svf_ic1_r=q->svf_ic2_r=0.0f;
  q->modal1_ic1=q->modal1_ic2=q->modal2_ic1=q->modal2_ic2=0.0f;
  q->modal3_ic1=q->modal3_ic2=q->modal4_ic1=q->modal4_ic2=0.0f;
  q->modal5_ic1=q->modal5_ic2=q->modal6_ic1=q->modal6_ic2=0.0f;
  q->modal7_ic1=q->modal7_ic2=q->modal8_ic1=q->modal8_ic2=0.0f;
  q->modal9_ic1=q->modal9_ic2=q->modal10_ic1=q->modal10_ic2=0.0f;
  q->form1_ic1=q->form1_ic2=q->form2_ic1=q->form2_ic2=0.0f;
  q->lfo1_phase=wrap01(rnd()*0.5f);q->lfo2_phase=wrap01(rnd()*0.5f);q->drift_phase=wrap01(rnd()*0.5f);
  q->voice_timbre_bias=rnd();q->voice_pan_bias=rnd();q->key_down=1;q->sostenuto_latched=0;q->note_order=g_note_order++;q->mod_body_ic1=q->mod_body_ic2=0.0f;
  float randamt=g_params[37];
  for(int u=0;u<MAX_UNISON;u++){
    float seed=wrap01((float)(u+1)*0.173205f + rnd()*0.5f*randamt);
    q->phase_a[u]=seed;
    q->phase_b[u]=wrap01(seed+0.2718f+rnd()*0.35f*randamt);
  }
  q->phase_sub=wrap01(rnd()*0.5f*randamt);
  prepare_waveguide(q,pitch,q->velocity);
  if(engine==9)prepare_grand_strings(q,pitch);
}

static int effective_voice_limit(void){
  int limit=clampi((int)(g_params[P_POLYPHONY_LIMIT]+0.5f),1,MAX_VOICES);
  if(g_params[P_DYNAMIC_VOICE_LIMIT]<0.5f)return limit;
  float budget=clampf(g_params[P_CPU_BUDGET],0.25f,1.0f);
  int engine=clampi((int)(g_params[P_ENGINE]+0.5f),0,9),os=1<<clampi((int)(g_params[45]+0.5f),0,2),uni=clampi((int)(g_params[10]+0.5f),1,MAX_UNISON);
  float cost=1.0f;
  if(engine==0)cost*=1.0f+0.12f*(float)(uni-1);else cost*=engine==9?2.0f:1.45f;
  if(os==2)cost*=1.35f;else if(os==4)cost*=1.85f;
  int dyn=(int)((float)MAX_VOICES*budget/cost+0.5f);dyn=clampi(dyn,4,MAX_VOICES);
  return dyn<limit?dyn:limit;
}

static void retarget_voice(Voice* q,int note_id,float pitch,float velocity,int retrigger){
  if(retrigger){init_voice(q,note_id,pitch,velocity);return;}
  q->id=note_id;q->base_pitch=pitch;q->pitch=pitch;q->velocity=clampf(velocity,0.0f,1.0f);q->key_down=1;q->sostenuto_latched=0;q->note_order=g_note_order++;
  q->pressure_target=0.0f;q->timbre_target=0.5f;q->expr_volume_target=1.0f;q->expr_pan_target=0.0f;
  /* Continuous reed/brass/flute/bowed models can change pitch without resetting
     their resonant state. Pluck/grand delay-line models require a retune and are
     deliberately re-prepared if a user chooses legato for those families. */
  int engine=clampi((int)(g_params[P_ENGINE]+0.5f),0,9);
  if(engine==1)prepare_waveguide(q,pitch,q->velocity);
  if(engine==9)prepare_grand_strings(q,pitch);
}

void dsp_note_on(int note_id,float pitch,float velocity,int sample_offset){
  (void)sample_offset;held_add(note_id,pitch,velocity);
  int mode=clampi((int)(g_params[P_VOICE_MODE]+0.5f),0,2);
  if(mode!=0){
    int slot=0;for(int i=0;i<MAX_VOICES;i++)if(g_voices[i].active){slot=i;break;}
    for(int i=0;i<MAX_VOICES;i++)if(i!=slot&&g_voices[i].active)release_voice(&g_voices[i]);
    if(!g_voices[slot].active)init_voice(&g_voices[slot],note_id,pitch,velocity);
    else retarget_voice(&g_voices[slot],note_id,pitch,velocity,mode==1 || g_params[P_LEGATO_RETRIGGER]>=0.5f);
    return;
  }
  int limit=effective_voice_limit(),slot=-1;
  for(int i=0;i<limit;i++)if(!g_voices[i].active){slot=i;break;}
  int stolen=0;float tail_l=0.0f,tail_r=0.0f;
  if(slot<0){
    float best=1e9f;
    for(int i=0;i<limit;i++){
      /* Release-stage voices are always preferred, then quiet/old voices. */
      float score=g_voices[i].amp_env+(g_voices[i].amp_stage==3?-2.0f:0.0f)-0.00005f*g_voices[i].age;
      if(score<best){best=score;slot=i;}
    }
    stolen=1;tail_l=g_voices[slot].last_out_l;tail_r=g_voices[slot].last_out_r;
  }
  init_voice(&g_voices[slot],note_id,pitch,velocity);
  if(stolen){g_voices[slot].steal_tail_l=tail_l;g_voices[slot].steal_tail_r=tail_r;g_voices[slot].steal_fade=1.0f;}
}

void dsp_note_off(int note_id,float velocity,int sample_offset){
  (void)velocity;(void)sample_offset;held_remove(note_id);
  int mode=clampi((int)(g_params[P_VOICE_MODE]+0.5f),0,2);
  if(mode!=0){
    Voice* current=0;for(int i=0;i<MAX_VOICES;i++)if(g_voices[i].active&&g_voices[i].id==note_id){current=&g_voices[i];break;}
    if(!current)return;current->key_down=0;
    HeldNote* next=held_select();
    if(next){retarget_voice(current,next->id,next->pitch,next->velocity,mode==1 || g_params[P_LEGATO_RETRIGGER]>=0.5f);return;}
    if(g_params[P_SUSTAIN_PEDAL]>=0.5f||current->sostenuto_latched)return;
    release_voice(current);return;
  }
  for(int i=0;i<MAX_VOICES;i++)if(g_voices[i].active&&g_voices[i].id==note_id){
    g_voices[i].key_down=0;
    if(g_params[P_SUSTAIN_PEDAL]<0.5f&&!g_voices[i].sostenuto_latched)release_voice(&g_voices[i]);
  }
}

void dsp_note_expression(int note_id,int kind,float value,int sample_offset){
  (void)sample_offset;
  for(int i=0;i<MAX_VOICES;i++)if(g_voices[i].active&&g_voices[i].id==note_id){
    Voice* q=&g_voices[i];
    if(kind==0)q->expr_volume_target=clampf(value,0.0f,1.0f);
    else if(kind==1)q->pitch=q->base_pitch+clampf(value,-48.0f,48.0f);
    else if(kind==2)q->pressure_target=clampf(value,0.0f,1.0f);
    else if(kind==3)q->timbre_target=clampf(value,0.0f,1.0f);
    else if(kind==4)q->expr_pan_target=clampf(value,-1.0f,1.0f);
  }
}

static float advance_env(float env,int* stage,float attack,float decay,float sustain,float release,float release_start,float rate){
  attack=attack<0.0005f?0.0005f:attack;decay=decay<0.001f?0.001f:decay;release=release<0.002f?0.002f:release;
  sustain=clampf(sustain,0.0f,1.0f);
  if(*stage==0){env += 1.0f/(attack*rate);if(env>=1.0f){env=1.0f;*stage=1;}}
  else if(*stage==1){env -= (1.0f-sustain)/(decay*rate);if(env<=sustain){env=sustain;*stage=2;}}
  else if(*stage==2)env=sustain;
  else {env -= (release_start+0.0001f)/(release*rate);if(env<=0.00002f)env=0.0f;}
  return env;
}

static float colored_noise(float color){
  float white=rnd();
  float a=0.02f + (color+1.0f)*0.20f;
  g_noise_lp += clampf(a,0.01f,0.42f)*(white-g_noise_lp);
  if(color<0.0f)return lerpf(white,g_noise_lp,-color);
  return lerpf(white,white-g_noise_lp,color);
}

static float legacy_filter_voice(Voice* q,float x,float cutoff,float resonance,float drive,int mode,float rate){
  float drv=1.0f+clampf(drive,0.0f,1.0f)*7.0f;
  x=softclip(x*drv);
  cutoff=clampf(cutoff,20.0f,rate*0.42f);
  float a=cutoff/(cutoff+rate*0.15915494f);
  a=clampf(a,0.0001f,0.92f);
  float res=clampf(resonance,0.0f,0.96f);
  float fb=(q->lp1-q->lp2)*(res*2.7f);
  float in=x-fb;
  q->lp1 += a*(in-q->lp1);
  q->lp2 += a*(q->lp1-q->lp2);
  float lp=q->lp2;
  float hp=x-lp;
  float bp=q->lp1-q->lp2;
  if(mode==1)return bp*2.0f;
  if(mode==2)return hp;
  return lp;
}

/* TPT state-variable filter.  fast_sine gives a stable tan(pi*f/fs)
   approximation without libc/libm: tan(x)=sin(x)/cos(x). */
static float tpt_filter_step(float x,float cutoff,float resonance,float drive,int mode,float rate,float* ic1,float* ic2){
  float drv=1.0f+clampf(drive,0.0f,1.0f)*6.0f;
  x=softclip(x*drv);
  cutoff=clampf(cutoff,20.0f,rate*0.445f);
  float n=cutoff/rate;
  float sn=fast_sine(n*0.5f);
  float cs=fast_sine(n*0.5f+0.25f);
  if(absf(cs)<0.035f)cs=cs<0.0f?-0.035f:0.035f;
  float g=sn/cs;
  g=clampf(g,0.0001f,8.0f);
  float k=2.0f-clampf(resonance,0.0f,0.96f)*1.90f;
  float a1=1.0f/(1.0f+g*(g+k));
  float v3=x-*ic2;
  float v1=(*ic1+g*v3)*a1;
  float v2=*ic2+g*v1;
  /* Soft-state limiting makes high-Q sweeps robust under strong drive. */
  v1=softclip(v1*1.04f);v2=softclip(v2*1.02f);
  *ic1=2.0f*v1-*ic1;
  *ic2=2.0f*v2-*ic2;
  float lp=v2;
  float bp=v1;
  float hp=v3-k*v1-v2;
  if(mode==1)return bp*1.45f;
  if(mode==2)return hp;
  return lp;
}

/* Accurate low-frequency tan(pi*f/fs) for modal tuning.  The previous
   parabolic sine approximation accumulated 10--25 cent tuning errors in the
   physical resonators.  This Pade form is effectively exact over the modal
   range used by the instrument; high normalized frequencies fall back to the
   bounded sine-ratio approximation. */
static float resonator_g(float n){
  n=clampf(n,0.00001f,0.43f);
  if(n<0.22f){
    float x=3.14159265359f*n;
    float x2=x*x,x4=x2*x2;
    float den=105.0f-45.0f*x2+6.0f*x4;
    if(absf(den)>0.0001f)return clampf(x*(105.0f-10.0f*x2+x4)/den,0.0001f,7.0f);
  }
  float sn=fast_sine(n*0.5f),cs=fast_sine(n*0.5f+0.25f);
  if(absf(cs)<0.04f)cs=cs<0.0f?-0.04f:0.04f;
  return clampf(sn/cs,0.0001f,7.0f);
}

static float resonator_step(float x,float freq,float q,float rate,float* ic1,float* ic2){
  freq=clampf(freq,20.0f,rate*0.43f);
  float g=resonator_g(freq/rate);
  float k=1.0f/clampf(q,0.55f,2400.0f);
  float a1=1.0f/(1.0f+g*(g+k));
  float v3=x-*ic2;
  float v1=(*ic1+g*v3)*a1;
  float v2=*ic2+g*v1;
  *ic1=2.0f*v1-*ic1;*ic2=2.0f*v2-*ic2;
  return v1;
}

#ifdef __wasm_simd128__
static void resonator_step4(float x,float rate,
  float f0,float q0,float* a10,float* a20,
  float f1,float q1,float* a11,float* a21,
  float f2,float q2,float* a12,float* a22,
  float f3,float q3,float* a13,float* a23,float out[4]){
  f0=clampf(f0,20.0f,rate*.43f);f1=clampf(f1,20.0f,rate*.43f);f2=clampf(f2,20.0f,rate*.43f);f3=clampf(f3,20.0f,rate*.43f);
  v128_t g;
  if(f0<rate*.22f&&f1<rate*.22f&&f2<rate*.22f&&f3<rate*.22f){
    v128_t n=wasm_f32x4_div(wasm_f32x4_make(f0,f1,f2,f3),wasm_f32x4_splat(rate));
    v128_t vx=wasm_f32x4_mul(n,wasm_f32x4_splat(3.14159265359f));
    v128_t x2=wasm_f32x4_mul(vx,vx),x4=wasm_f32x4_mul(x2,x2);
    v128_t num=wasm_f32x4_add(wasm_f32x4_sub(wasm_f32x4_splat(105.0f),wasm_f32x4_mul(wasm_f32x4_splat(10.0f),x2)),x4);
    v128_t den=wasm_f32x4_add(wasm_f32x4_sub(wasm_f32x4_splat(105.0f),wasm_f32x4_mul(wasm_f32x4_splat(45.0f),x2)),wasm_f32x4_mul(wasm_f32x4_splat(6.0f),x4));
    g=wasm_f32x4_div(wasm_f32x4_mul(vx,num),den);
  }else{
    g=wasm_f32x4_make(resonator_g(f0/rate),resonator_g(f1/rate),resonator_g(f2/rate),resonator_g(f3/rate));
  }
  v128_t q=wasm_f32x4_make(clampf(q0,.55f,2400.0f),clampf(q1,.55f,2400.0f),clampf(q2,.55f,2400.0f),clampf(q3,.55f,2400.0f));
  v128_t k=wasm_f32x4_div(wasm_f32x4_splat(1.0f),q);
  v128_t one=wasm_f32x4_splat(1.0f);
  v128_t a1=wasm_f32x4_div(one,wasm_f32x4_add(one,wasm_f32x4_mul(g,wasm_f32x4_add(g,k))));
  v128_t ic1=wasm_f32x4_make(*a10,*a11,*a12,*a13);
  v128_t ic2=wasm_f32x4_make(*a20,*a21,*a22,*a23);
  v128_t v3=wasm_f32x4_sub(wasm_f32x4_splat(x),ic2);
  v128_t v1=wasm_f32x4_mul(wasm_f32x4_add(ic1,wasm_f32x4_mul(g,v3)),a1);
  v128_t v2=wasm_f32x4_add(ic2,wasm_f32x4_mul(g,v1));
  v128_t two=wasm_f32x4_splat(2.0f);
  v128_t ni1=wasm_f32x4_sub(wasm_f32x4_mul(two,v1),ic1);
  v128_t ni2=wasm_f32x4_sub(wasm_f32x4_mul(two,v2),ic2);
  float s1[4],s2[4];
  wasm_v128_store(s1,ni1);wasm_v128_store(s2,ni2);wasm_v128_store(out,v1);
  *a10=s1[0];*a11=s1[1];*a12=s1[2];*a13=s1[3];
  *a20=s2[0];*a21=s2[1];*a22=s2[2];*a23=s2[3];
}
#endif

static float waveguide_step(Voice* q,float excitation,float damping,float body){
  int vi=voice_index(q);int len=q->wg_len;
  if(len<8)return excitation;
  int pos=q->wg_pos;if(pos>=len)pos=0;
  int next=pos+1;if(next>=len)next=0;
  float a=g_waveguide[vi][pos],b=g_waveguide[vi][next];
  float d=clampf(damping,0.0f,1.0f);
  float loss=0.99988f-d*0.0140f;
  float avg=(a+b)*0.5f;
  /* Damping controls both decay and the bridge low-pass, as on a lossy string. */
  float bridge=lerpf(a,avg,0.10f+d*0.82f);
  bridge=lerpf(bridge,a,body*0.10f);
  g_waveguide[vi][pos]=softclip((bridge*loss+excitation)*1.015f);
  q->wg_pos=next;
  return a;
}

/* Dedicated v7 physical models. */
static float bowed_string_v7(Voice* q,float base_hz,float rate){
  float pressure=g_params[P_BOW_PRESSURE]*(0.72f+0.28f*q->pressure);
  if(pressure<=0.000001f){q->physical_prev*=0.995f;return q->physical_prev;}
  float bowv=(0.035f+0.34f*g_params[P_BOW_VELOCITY])*(0.70f+0.30f*q->velocity);
  float rel=bowv-q->physical_prev;
  float fr=g_params[P_BOW_FRICTION],rr=rel*(2.8f+15.0f*fr+7.0f*pressure);
  float friction=rr/(1.0f+rr*rr*(0.50f+2.8f*pressure));
  float drive=(friction*(0.014f+0.075f*pressure)+rnd()*g_params[P_BOW_ROSIN_NOISE]*pressure*0.0045f)*(0.55f+0.45f*q->velocity);
  float damping=g_params[P_BOW_STRING_DAMPING],stiff=g_params[P_BOW_STRING_STIFFNESS];
  float q0=(105.0f+(1.0f-damping)*560.0f)*(0.95f+0.12f*g_params[P_BOW_BODY_SIZE]);
  float pos=g_params[P_BOW_POSITION];
  float w1=absf(fast_sine(pos*.5f)),w2=absf(fast_sine(pos)),w3=absf(fast_sine(pos*1.5f)),w4=absf(fast_sine(pos*2.0f));
  float h1=resonator_step(drive,base_hz,q0,rate,&q->modal1_ic1,&q->modal1_ic2);
  float h2=resonator_step(drive,base_hz*2.0f*(1.0f+stiff*.0014f),q0*.56f,rate,&q->modal2_ic1,&q->modal2_ic2);
  float h3=resonator_step(drive,base_hz*3.0f*(1.0f+stiff*.0032f),q0*.40f,rate,&q->modal3_ic1,&q->modal3_ic2);
  float h4=resonator_step(drive,base_hz*4.0f*(1.0f+stiff*.0058f),q0*.30f,rate,&q->modal4_ic1,&q->modal4_ic2);
  float string=h1*(.82f+.18f*w1)+h2*(.11f+.24f*w2)+h3*(.04f+.15f*w3)+h4*(.015f+.09f*w4);
  q->physical_prev=clampf(string,-.38f,.38f);
  float bs=g_params[P_BOW_BODY_SIZE],bm=g_params[P_BOW_BODY_MIX];
  float b1=resonator_step(string,lerpf(140.0f,255.0f,bs),4.0f+bs*7.0f,rate,&q->modal5_ic1,&q->modal5_ic2);
  float b2=resonator_step(string,lerpf(380.0f,650.0f,bs),5.0f+bs*9.0f,rate,&q->modal6_ic1,&q->modal6_ic2);
  float sy=g_params[P_BOW_SYMPATHETIC],syr=resonator_step(string,base_hz*1.5006f,30.0f+sy*130.0f,rate,&q->modal7_ic1,&q->modal7_ic2);
  return string*(.90f-.16f*bm)+(b1*.22f+b2*.12f)*bm+syr*sy*.14f;
}

static float flute_v7(Voice* q,float base_hz,float rate){
  float pressure=g_params[P_FLUTE_BREATH_PRESSURE]*(0.72f+0.28f*q->pressure);
  if(pressure<=0.000001f){q->physical_prev*=0.992f;return q->physical_prev;}
  float emb=g_params[P_FLUTE_EMBOUCHURE],ratio=g_params[P_FLUTE_JET_RATIO];
  /* Jet turbulence is broadband; the open bore selects the played pitch.
     This prevents an arbitrary control-loop frequency from replacing the
     acoustic tube resonance. */
  float turbulence=rnd()*pressure*(.010f+.060f*g_params[P_FLUTE_AIR_NOISE]);
  float jet_target=pressure*(.16f+.42f*q->velocity)+turbulence-q->physical_prev*(.055f+.085f*emb);
  float k=.010f+.060f*(1.0f-ratio);
  q->res1+=k*(jet_target-q->res1);q->res2+=k*(q->res1-q->res2);
  float jet=q->res2;
  float nonlinear=jet*(1.0f-clampf(jet*jet*(.70f+1.05f*emb),0.0f,.94f));
  q->physical_aux+=(.006f+.010f*ratio)*(nonlinear-q->physical_aux);
  float edge=(nonlinear-q->physical_aux)*.015f+turbulence*(.95f+.75f*pressure);
  float loss=g_params[P_FLUTE_BORE_LOSS],refl=g_params[P_FLUTE_END_REFLECTION];
  float q0=(105.0f+(1.0f-loss)*430.0f)*(0.86f+.32f*refl);
  float h1=resonator_step(edge,base_hz,q0,rate,&q->modal1_ic1,&q->modal1_ic2);
  float h2=resonator_step(edge,base_hz*2.001f,q0*.44f,rate,&q->modal2_ic1,&q->modal2_ic2);
  float h3=resonator_step(edge,base_hz*3.003f,q0*.28f,rate,&q->modal3_ic1,&q->modal3_ic2);
  float bore=(h1+h2*(.05f+.20f*emb)+h3*(.012f+.075f*emb))*5.0f+turbulence*.018f;
  q->physical_prev=clampf(bore,-.38f,.38f);
  float bs=g_params[P_FLUTE_BODY_SIZE],bm=g_params[P_FLUTE_BODY_MIX];
  float body=resonator_step(bore,lerpf(560.0f,1160.0f,bs),3.0f+bs*5.0f,rate,&q->modal4_ic1,&q->modal4_ic2);
  return bore+body*bm*.14f;
}

static float reed_v7(Voice* q,float base_hz,float rate){
  float pressure=g_params[P_REED_BREATH_PRESSURE]*(0.72f+0.28f*q->pressure);
  if(pressure<=0.000001f){q->physical_prev*=0.992f;return q->physical_prev;}
  float stiff=g_params[P_REED_STIFFNESS],ap=g_params[P_REED_APERTURE],rd=g_params[P_REED_DAMPING];
  float mouth=pressure*(.22f+.58f*q->velocity),dp=mouth-q->physical_prev*(.62f+.20f*g_params[P_REED_BORE_CONICITY]);
  float opening=clampf(ap-dp*(.36f+1.10f*stiff),0.0f,1.0f);
  float flow=softclip(dp*(1.8f+2.0f*stiff))*opening/(1.0f+rd*absf(dp)*3.0f);
  float noise=rnd()*g_params[P_REED_NOISE]*pressure*opening*.014f;
  float raw=flow+noise;q->physical_aux+=(.012f+.030f*(1.0f-rd))*(raw-q->physical_aux);
  float drive=(raw-q->physical_aux)*(.075f+.080f*pressure);
  float con=g_params[P_REED_BORE_CONICITY],bell=g_params[P_REED_BELL_LOSS];
  float q0=(95.0f+(1.0f-bell)*340.0f)*(0.88f+.18f*con);
  float h1=resonator_step(drive,base_hz,q0,rate,&q->modal1_ic1,&q->modal1_ic2);
  float h2=resonator_step(drive,base_hz*2.002f,q0*.60f,rate,&q->modal2_ic1,&q->modal2_ic2);
  float h3=resonator_step(drive,base_hz*3.006f,q0*.44f,rate,&q->modal3_ic1,&q->modal3_ic2);
  float h4=resonator_step(drive,base_hz*4.012f,q0*.33f,rate,&q->modal4_ic1,&q->modal4_ic2);
  float bore=h1+h2*(.06f+.34f*con)+h3*(.12f+.10f*(1.0f-con))+h4*(.03f+.08f*con);
  q->physical_prev=clampf(bore,-.36f,.36f);
  float bm=g_params[P_REED_BODY_MIX],body=resonator_step(bore,lerpf(480.0f,980.0f,con),4.0f+bm*6.0f,rate,&q->modal5_ic1,&q->modal5_ic2);
  return bore+body*bm*.14f;
}

static float brass_v7(Voice* q,float base_hz,float rate){
  float pressure=g_params[P_BRASS_BREATH_PRESSURE]*(0.72f+0.28f*q->pressure);
  if(pressure<=0.000001f){q->physical_prev*=0.992f;return q->physical_prev;}
  float tension=g_params[P_BRASS_LIP_TENSION],mass=g_params[P_BRASS_LIP_MASS],ld=g_params[P_BRASS_LIP_DAMPING];
  float flare=g_params[P_BRASS_BORE_FLARE],bell=g_params[P_BRASS_BELL_LOSS];
  /* The player's lips are a pressure-driven mass/spring reed.  The bore sets
     the played note; lip tension/mass only move the lip resonance inside the
     bore's locking range rather than retuning the MIDI note by semitones. */
  float lip_hz=base_hz*(1.0f+(tension-.5f)*.010f-(mass-.5f)*.008f);
  float air=rnd()*pressure*(.0035f+.030f*g_params[P_BRASS_AIR_NOISE]);
  float lip_drive=air;
  float lip_q=lerpf(42.0f,12.0f,ld)*(0.88f+.22f*tension);
  float lip=resonator_step(lip_drive,lip_hz,lip_q,rate,&q->res1,&q->res2);
  float mouth=pressure*(.30f+.62f*q->velocity),dp=mouth-q->physical_prev*(.50f+.18f*flare);
  float opening=clampf(.34f+lip*(3.0f+2.2f*tension)-dp*(.035f+.080f*ld),0.0f,.92f);
  float flow=opening*softclip(dp*(1.65f+1.45f*tension));
  q->physical_aux+=(.010f+.014f*ld)*(flow-q->physical_aux);
  float acflow=flow-q->physical_aux;
  float mp=g_params[P_BRASS_MOUTHPIECE];
  float cup=resonator_step(acflow+lip*.30f,lerpf(380.0f,1050.0f,mp),4.0f+mp*9.0f,rate,&q->modal5_ic1,&q->modal5_ic2);
  float drive=(lip*(.70f+.40f*pressure)+acflow*.24f+cup*.10f)*(0.42f+0.38f*pressure);
  float q0=(120.0f+(1.0f-bell)*430.0f)*(0.92f+.18f*flare);
  float h1=resonator_step(drive,base_hz,q0,rate,&q->modal1_ic1,&q->modal1_ic2);
  float h2=resonator_step(drive,base_hz*2.002f,q0*.60f,rate,&q->modal2_ic1,&q->modal2_ic2);
  float h3=resonator_step(drive,base_hz*3.006f,q0*.45f,rate,&q->modal3_ic1,&q->modal3_ic2);
  float h4=resonator_step(drive,base_hz*4.012f,q0*.34f,rate,&q->modal4_ic1,&q->modal4_ic2);
  float brightness=clampf(.10f+pressure*.56f+flare*.34f,0.0f,1.0f);
  float bore=(h1+h2*(.08f+.34f*brightness)+h3*(.025f+.22f*brightness)+h4*(.008f+.11f*brightness))*3.0f;
  q->physical_prev=clampf(bore,-.42f,.42f);
  float bm=g_params[P_BRASS_BODY_MIX],body=resonator_step(bore,lerpf(240.0f,620.0f,flare),3.5f+bm*5.0f,rate,&q->modal6_ic1,&q->modal6_ic2);
  return bore+cup*.06f+body*bm*.12f;
}

static float vocal_v7(Voice* q,float ph,float rate,float formant_mod){
  float tension=g_params[P_VOCAL_GLOTTAL_TENSION],oq=lerpf(.28f,.72f,g_params[P_VOCAL_OPEN_QUOTIENT]);
  float glot;
  if(ph<oq){float t=ph/oq;glot=fast_sine(t*.5f)*(1.0f-.25f*t);}
  else{float t=(ph-oq)/(1.0f-oq);glot=-.20f*fast_sine(t*.5f)*(1.0f-t);}
  glot=softclip(glot*(1.0f+tension*1.7f))+rnd()*g_params[P_VOCAL_BREATHINESS]*.018f;
  float v=clampf(g_params[P_VOCAL_VOWEL_MORPH]+(q->timbre-.5f)*.30f+formant_mod*.28f,0.0f,1.0f),oct=fast_exp2(g_params[P_VOCAL_FORMANT_SHIFT]+formant_mod*.45f);
  float bw=g_params[P_VOCAL_FORMANT_BANDWIDTH];
  float f1=lerpf(730.0f,270.0f,v)*oct,f2=lerpf(1090.0f,2290.0f,v)*oct,f3=lerpf(2440.0f,3010.0f,v)*oct,f4=lerpf(3400.0f,3700.0f,v)*oct;
  float r1=resonator_step(glot,f1,lerpf(14.0f,4.5f,bw),rate,&q->form1_ic1,&q->form1_ic2);
  float r2=resonator_step(glot,f2,lerpf(17.0f,5.0f,bw),rate,&q->form2_ic1,&q->form2_ic2);
  float r3=resonator_step(glot,f3,lerpf(21.0f,6.0f,bw),rate,&q->modal8_ic1,&q->modal8_ic2);
  float r4=resonator_step(glot,f4,lerpf(25.0f,7.0f,bw),rate,&q->modal9_ic1,&q->modal9_ic2);
  float nas=g_params[P_VOCAL_NASALITY],nasal=resonator_step(glot,lerpf(240.0f,315.0f,v),5.5f,rate,&q->modal10_ic1,&q->modal10_ic2);
  float chest=g_params[P_VOCAL_CHEST],ch=resonator_step(glot,lerpf(105.0f,235.0f,chest),3.0f+chest*7.0f,rate,&q->modal1_ic1,&q->modal1_ic2);
  return glot*.08f+r1*.84f+r2*.58f+r3*(.12f+.38f*g_params[P_VOCAL_FORMANT_3])+r4*(.06f+.28f*g_params[P_VOCAL_FORMANT_4])+nasal*nas*.28f+ch*chest*.18f;
}

typedef struct { float pitch,filter,pos_a,pos_b,formant,body,vibrato,amplitude,pan; } ModState;
static float mod_source_value(Voice* q,int src,float lfo1,float lfo2){
  if(src==1)return lfo1;if(src==2)return lfo2;if(src==3)return q->amp_env;if(src==4)return q->filt_env;
  if(src==5)return q->velocity;if(src==6)return q->pressure;if(src==7)return q->timbre;
  if(src==8)return clampf(q->age/(q->age+1.0f),0.0f,1.0f);if(src==9)return q->voice_timbre_bias;return 0.0f;
}
static ModState modulation_matrix(Voice* q,float lfo1,float lfo2){
  ModState m={0};const int srcp[4]={P_MOD1_SOURCE,P_MOD2_SOURCE,P_MOD3_SOURCE,P_MOD4_SOURCE};
  const int dstp[4]={P_MOD1_DEST,P_MOD2_DEST,P_MOD3_DEST,P_MOD4_DEST};const int amtp[4]={P_MOD1_AMOUNT,P_MOD2_AMOUNT,P_MOD3_AMOUNT,P_MOD4_AMOUNT};
  for(int i=0;i<4;i++){int src=clampi((int)(g_params[srcp[i]]+0.5f),0,9),dst=clampi((int)(g_params[dstp[i]]+0.5f),0,8);float v=mod_source_value(q,src,lfo1,lfo2)*g_params[amtp[i]];
    if(dst==0)m.pitch+=v*2.0f;else if(dst==1)m.filter+=v*4.0f;else if(dst==2)m.pos_a+=v*.45f;else if(dst==3)m.pos_b+=v*.45f;else if(dst==4)m.formant+=v;else if(dst==5)m.body+=v;else if(dst==6)m.vibrato+=v;else if(dst==7)m.amplitude+=v;else m.pan+=v;
  }
  return m;
}

static void render_voice_step(Voice* q,float lfo1,float lfo2,float rate,float* l,float* r){
  q->amp_env=advance_env(q->amp_env,&q->amp_stage,g_params[15],g_params[16],g_params[17],g_params[18],q->amp_release_start,rate);
  q->filt_env=advance_env(q->filt_env,&q->filt_stage,g_params[24],g_params[25],g_params[26],g_params[27],q->filt_release_start,rate);
  if(q->amp_stage==3 && q->amp_env<=0.00002f){q->active=0;return;}

  /* Note-expression points arrive as sample-accurate events.  Treating volume,
     pan, pressure or timbre as hard steps creates an audible discontinuity in
     exposed piano material.  A short rate-normalized de-zipper preserves the
     authored point timing while removing single-sample edges. */
  float expr_k=1.0f/(0.004f*rate);if(expr_k>1.0f)expr_k=1.0f;
  q->expr_volume+=(q->expr_volume_target-q->expr_volume)*expr_k;
  q->expr_pan+=(q->expr_pan_target-q->expr_pan)*expr_k;
  q->pressure+=(q->pressure_target-q->pressure)*expr_k;
  q->timbre+=(q->timbre_target-q->timbre)*expr_k;

  float porta=g_params[39];
  if(porta>0.0001f){float k=1.0f/(porta*rate);if(k>1.0f)k=1.0f;q->glide_pitch += (q->pitch-q->glide_pitch)*k;}else q->glide_pitch=q->pitch;

  float spread=g_params[P_VOICE_LFO_SPREAD];
  float voice_lfo1=fast_sine(q->lfo1_phase),voice_lfo2=fast_sine(q->lfo2_phase);
  float local_lfo1=lerpf(lfo1,voice_lfo1,spread),local_lfo2=lerpf(lfo2,voice_lfo2,spread);
  float drift=fast_sine(q->drift_phase)*g_params[P_VOICE_DRIFT]/100.0f;
  ModState mod=modulation_matrix(q,local_lfo1,local_lfo2);
  q->lfo1_phase=wrap01(q->lfo1_phase+(g_params[32]*(0.965f+0.07f*wrap01(q->drift_phase)))/rate);
  q->lfo2_phase=wrap01(q->lfo2_phase+(g_params[35]*(0.94f+0.12f*wrap01(q->lfo1_phase)))/rate);
  q->drift_phase=wrap01(q->drift_phase+(0.055f+0.11f*spread)/rate);
  float pitch_mod=local_lfo1*g_params[33]/100.0f + drift + mod.pitch + mod.vibrato*local_lfo1*.55f;
  float base_hz=midi_hz(q->glide_pitch+pitch_mod);
  int uni=clampi((int)(g_params[10]+0.5f),1,MAX_UNISON);
  float detune=g_params[11];
  float age_motion=g_params[P_VOICE_AGE_MOTION];
  float age_curve=clampf(q->age/(0.20f+2.8f*(1.0f-age_motion)),0.0f,1.0f);
  float age_wave=fast_sine(q->drift_phase*0.73f+age_curve*0.21f)*age_motion;
  float timbre_bias=q->voice_timbre_bias*g_params[P_VOICE_TIMBRE_SPREAD]*0.24f;
  float pos_a=clampf(g_params[2] + local_lfo2*g_params[36]*0.25f + (q->timbre-0.5f)*g_params[31] + timbre_bias + age_wave*0.045f + mod.pos_a,0.0f,1.0f);
  float pos_b=clampf(g_params[3] - local_lfo2*g_params[36]*0.18f + (q->timbre-0.5f)*g_params[31]*0.7f - timbre_bias*0.62f - age_wave*0.03f + mod.pos_b,0.0f,1.0f);
  float voice_l=0.0f,voice_r=0.0f;
  /* A fully physical voice does not need two procedural wavetable lookups per
     sample.  Keep oscillator phases moving so physical_mix automation remains
     click-free, but skip the expensive table reads when their contribution is
     exactly inaudible.  This matters for dense piano scores in 128-frame
     AudioWorklet callbacks. */
  int engine=clampi((int)(g_params[P_ENGINE]+0.5f),0,9);
  float physical_mix=g_params[P_PHYSICAL_MIX];
  int render_generic=(engine==0 || physical_mix<0.9995f);
  float physical_phase=q->phase_a[0];
  for(int u=0;u<uni;u++){
    float upos=uni==1?0.0f:((float)u/(float)(uni-1))*2.0f-1.0f;
    float fa=base_hz*cents_factor(upos*detune);
    float fb=base_hz*fast_exp2(g_params[8]/12.0f)*cents_factor(g_params[9]-upos*detune*0.37f);
    if(render_generic){
      float pd=g_params[P_PHASE_DISTORTION],sync=clampf(g_params[P_HARD_SYNC],0.0f,1.0f);
      float aphase=phase_distort(q->phase_a[u],pd);
      float sync_phase=phase_distort(wrap01(q->phase_a[u]*g_params[P_SYNC_RATIO]),-pd*.65f);
      float bphase=phase_lerp(phase_distort(q->phase_b[u],-pd*.55f),sync_phase,sync);
      int fms=clampi((int)(g_params[P_FM_SOURCE]+0.5f),0,2);float a,b;
      if(fms==1){a=wt_lookup(aphase,pos_a,fa,g_params[46],g_params[48]);b=wt_lookup(bphase+a*g_params[13]*.18f,pos_b,fb,g_params[47],g_params[48]);}
      else if(fms==2){float n=fast_sine(q->drift_phase*7.13f+q->voice_timbre_bias*.37f);a=wt_lookup(aphase+n*g_params[13]*.12f,pos_a,fa,g_params[46],g_params[48]);b=wt_lookup(bphase,pos_b,fb,g_params[47],g_params[48]);}
      else{b=wt_lookup(bphase,pos_b,fb,g_params[47],g_params[48]);a=wt_lookup(aphase+b*g_params[13]*0.18f,pos_a,fa,g_params[46],g_params[48]);}
      float mix=a*g_params[4] + b*g_params[5];
      float ring=a*b;
      mix=lerpf(mix,ring,g_params[14]);
      float pan=clampf(g_params[38]+q->expr_pan+upos*g_params[12]+q->voice_pan_bias*g_params[P_VOICE_PAN_SPREAD]*0.38f+age_wave*g_params[P_VOICE_PAN_SPREAD]*0.08f+mod.pan*.72f,-1.0f,1.0f);
      float gl=0.70710678f*(1.0f-pan*0.62f);
      float gr=0.70710678f*(1.0f+pan*0.62f);
      voice_l += mix*gl;
      voice_r += mix*gr;
    }
    q->phase_a[u]=wrap01(q->phase_a[u]+fa/rate);
    q->phase_b[u]=wrap01(q->phase_b[u]+fb/rate);
  }
  if(render_generic){voice_l/=(float)uni;voice_r/=(float)uni;}

  /* v8 dedicated physical engines. */
  if(engine>0){
    float ph=physical_phase,m=0.0f,side=0.0f;
    if(engine==1){
      float d=g_params[P_PLUCK_DAMPING],disp=g_params[P_PLUCK_DISPERSION],bridge=g_params[P_PLUCK_BRIDGE_LOSS];
      float string=waveguide_step(q,0.0f,clampf(d+bridge*.28f,0.0f,1.0f),clampf(1.0f-disp*.45f,0.0f,1.0f));
      float bs=g_params[P_PLUCK_BODY_SIZE],bm=g_params[P_PLUCK_BODY_MIX];
      float b1=resonator_step(string,lerpf(105.0f,250.0f,bs),4.0f+bs*7.0f,rate,&q->modal1_ic1,&q->modal1_ic2);
      float b2=resonator_step(string,lerpf(300.0f,720.0f,bs),5.0f+bs*8.0f,rate,&q->modal2_ic1,&q->modal2_ic2);
      float sy=g_params[P_PLUCK_SYMPATHETIC],syr=resonator_step(string,base_hz*1.5006f,30.0f+sy*150.0f,rate,&q->modal3_ic1,&q->modal3_ic2);
      m=string*(.90f-.22f*bm)+(b1*.35f+b2*.18f)*bm+syr*sy*.16f;
    }else if(engine==2){
      /* Acoustic-piano modal bank.  A short half-sine felt contact pulse excites
         three slightly detuned unison strings plus stretched integer partials.
         The old model used broadband noise and a 1.5x "sympathetic" mode,
         which read as a synthetic bell/fifth rather than a struck piano wire. */
      float key=clampf((q->glide_pitch-21.0f)/87.0f,0.0f,1.0f),vel=clampf(q->velocity,0.0f,1.0f);
      float hard=clampf(g_params[P_PIANO_HAMMER_HARDNESS]*.56f+vel*.44f,0.0f,1.0f);
      float alen=lerpf(.0105f,.00165f,hard),t=q->age/alen;
      float contact=t<1.0f?fast_sine(t*.5f):0.0f;
      float white=rnd();q->physical_aux+=(.025f+hard*.18f)*(white-q->physical_aux);
      float felt_noise=(white-q->physical_aux)*g_params[P_PIANO_HAMMER_NOISE]*(.035f+.105f*hard);
      float vel_curve=vel*(1.35f-.35f*vel);
      float hammer=(contact*(.38f+.62f*hard)+felt_noise)*(.12f+.88f*vel_curve);

      float inh=(.000035f+.00042f*g_params[P_PIANO_INHARMONICITY])*(.62f+.76f*absf(key*2.0f-1.0f));
      float damping=g_params[P_PIANO_STRING_DAMPING];
      float qbase=(95.0f+(1.0f-damping)*650.0f)*lerpf(1.55f,.62f,key);
      float uni=g_params[P_PIANO_STRING_UNISON]*clampf((q->glide_pitch-31.0f)/34.0f,0.0f,1.0f);
      float cents=(.07f+.72f*uni)*(.72f+.42f*key);
      float f1=base_hz*cents_factor(cents),f2=base_hz*cents_factor(-cents*.86f);

      float strike=.105f+.022f*key;
      float w2=.52f+.48f*absf(fast_sine(strike));
      float w3=.52f+.48f*absf(fast_sine(strike*1.5f));
      float w4=.52f+.48f*absf(fast_sine(strike*2.0f));
      float w5=.52f+.48f*absf(fast_sine(strike*2.5f));
      float w6=.52f+.48f*absf(fast_sine(strike*3.0f));
      float fh2=base_hz*2.0f*(1.0f+2.0f*inh),fh3=base_hz*3.0f*(1.0f+4.5f*inh);
      float fh4=base_hz*4.0f*(1.0f+8.0f*inh),fh5=base_hz*5.0f*(1.0f+12.5f*inh),fh6=base_hz*6.0f*(1.0f+18.0f*inh);
      float fh7=base_hz*7.0f*(1.0f+24.5f*inh),fh8=base_hz*8.0f*(1.0f+32.0f*inh);
      float s0,s1,s2,h2,h3,h4,h5,h6,h7,h8;
#ifdef __wasm_simd128__
      float rv0[4],rv1[4];
      resonator_step4(hammer,rate,
        base_hz,qbase,&q->modal1_ic1,&q->modal1_ic2,
        f1,qbase*.992f,&q->modal2_ic1,&q->modal2_ic2,
        f2,qbase*.978f,&q->modal3_ic1,&q->modal3_ic2,
        fh2,qbase*.62f,&q->modal4_ic1,&q->modal4_ic2,rv0);
      s0=rv0[0];s1=rv0[1];s2=rv0[2];h2=rv0[3];
      resonator_step4(hammer,rate,
        fh3,qbase*.43f,&q->modal5_ic1,&q->modal5_ic2,
        fh4,qbase*.31f,&q->modal6_ic1,&q->modal6_ic2,
        fh5,qbase*.24f,&q->modal9_ic1,&q->modal9_ic2,
        fh6,qbase*.19f,&q->modal10_ic1,&q->modal10_ic2,rv1);
      h3=rv1[0];h4=rv1[1];h5=rv1[2];h6=rv1[3];
      h7=resonator_step(hammer,fh7,qbase*.145f,rate,&q->form1_ic1,&q->form1_ic2);
      h8=resonator_step(hammer,fh8,qbase*.115f,rate,&q->form2_ic1,&q->form2_ic2);
#else
      s0=resonator_step(hammer,base_hz,qbase,rate,&q->modal1_ic1,&q->modal1_ic2);
      s1=resonator_step(hammer,f1,qbase*.992f,rate,&q->modal2_ic1,&q->modal2_ic2);
      s2=resonator_step(hammer,f2,qbase*.978f,rate,&q->modal3_ic1,&q->modal3_ic2);
      h2=resonator_step(hammer,fh2,qbase*.62f,rate,&q->modal4_ic1,&q->modal4_ic2);
      h3=resonator_step(hammer,fh3,qbase*.43f,rate,&q->modal5_ic1,&q->modal5_ic2);
      h4=resonator_step(hammer,fh4,qbase*.31f,rate,&q->modal6_ic1,&q->modal6_ic2);
      h5=resonator_step(hammer,fh5,qbase*.24f,rate,&q->modal9_ic1,&q->modal9_ic2);
      h6=resonator_step(hammer,fh6,qbase*.19f,rate,&q->modal10_ic1,&q->modal10_ic2);
      h7=resonator_step(hammer,fh7,qbase*.145f,rate,&q->form1_ic1,&q->form1_ic2);
      h8=resonator_step(hammer,fh8,qbase*.115f,rate,&q->form2_ic1,&q->form2_ic2);
#endif
      float bright=.10f+.58f*hard+.32f*vel;
      float strings=s0+(s1+s2)*(.08f+.24f*uni)
        +h2*w2*(.16f+.34f*bright)+h3*w3*(.075f+.20f*bright)
        +h4*w4*(.032f+.115f*bright)+h5*w5*(.014f+.065f*bright)+h6*w6*(.006f+.036f*bright)
        +h7*(.0025f+.019f*bright)+h8*(.0015f+.012f*bright);

      /* Soundboard modes are broad, fixed resonances fed primarily by string
         energy.  "sympathetic" lengthens/opens this coupling instead of
         injecting an unrelated pitch into every key. */
      float sb=g_params[P_PIANO_SOUNDBOARD_SIZE],sbm=g_params[P_PIANO_SOUNDBOARD_MIX],sy=g_params[P_PIANO_SYMPATHETIC];
      float bin=hammer*.055f+strings*(.20f+.10f*sy);
      float b1=resonator_step(bin,lerpf(92.0f,176.0f,sb),3.6f+sb*5.0f+sy*8.0f,rate,&q->modal7_ic1,&q->modal7_ic2);
      float b2=resonator_step(bin,lerpf(315.0f,690.0f,sb),4.0f+sb*6.0f+sy*6.0f,rate,&q->modal8_ic1,&q->modal8_ic2);
      m=(strings+(b1*.30f+b2*.15f)*sbm)*3.45f;
      side=(key-.5f)*g_params[P_PIANO_STEREO_WIDTH];
    }else if(engine==9){
      /* Grand Piano v9: nonlinear felt hammer coupled at a physical strike
         junction to four one-way traveling-wave segments per unison string. */
      float key=clampf((q->glide_pitch-21.0f)/87.0f,0.0f,1.0f),vel=clampf(q->velocity,0.0f,1.0f);
      float bass_hammer=clampf((48.0f-q->glide_pitch)/12.0f,0.0f,1.0f);
      float hard=clampf(g_params[P_PIANO_HAMMER_HARDNESS]*.52f+vel*.48f+bass_hammer*.18f*(.30f+.70f*vel),0.0f,1.0f);
      float one_minus_h=1.0f-hard;
      float contact_len=.00200f+.0125f*one_minus_h*one_minus_h*one_minus_h,t=q->age/contact_len;
      /* Hammer trajectory is velocity-like and returns to zero, avoiding a DC
         displacement step while retaining a finite physical contact window. */
      float hammer_path=t<1.0f?fast_sine(t*.5f):0.0f;
      float string_x=grand_string_contact(q);
      float string_v=(string_x-q->physical_prev)*rate;q->physical_prev=string_x;
      float contact_fb=lerpf(.86f,.46f,key);
      float compression=hammer_path-contact_fb*(string_x*(2.8f+2.6f*hard)+string_v*(.00022f+.00018f*hard));
      if(compression<0.0f)compression=0.0f;if(compression>1.15f)compression=1.15f;
      /* Hunt-Crossley-like felt law: stiffness and damping increase with
         compression, so velocity changes both level and spectrum. */
      float felt_force=compression*compression*(.34f+.66f*compression)*(1.0f+1.65f*hard);
      float white=rnd();q->physical_aux+=(.024f+.19f*hard)*(white-q->physical_aux);
      float vel2=vel*vel,vel3=vel2*vel,vel5=vel3*vel2;
      float vel_noise=.03f*vel+.97f*vel5;
      float mid_vel=clampf(1.0f-absf(vel-.55f)/.35f,0.0f,1.0f);
      vel_noise += bass_hammer*.30f*mid_vel*mid_vel*mid_vel;
      float bass_noise=1.0f+bass_hammer*(2.2f+3.0f*mid_vel);
      float felt_noise=(white-q->physical_aux)*g_params[P_PIANO_HAMMER_NOISE]*hard*(.004f+.030f*hard)*compression*(.10f+.90f*vel_noise)*bass_noise;
      /* Keep the softest SFZ layers audible across the short upper-string
         round trips while retaining a monotonic velocity response. */
      float vcurve=.72f+.28f*vel;
      float micro_gate=t<.40f?(1.0f-t/.40f):0.0f;
      float micro_hp=white-q->physical_aux;
      q->res2+=.18f*(micro_hp-q->res2);
      /* Contact noise follows hammer travel so it cannot excite the string before the strike. */
      float micro=q->res2*g_params[P_PIANO_HAMMER_NOISE]*hard*vel_noise*micro_gate*clampf(hammer_path,0.0f,1.0f)*25.0f*bass_noise;
      float force=(felt_force+felt_noise+micro)*(.075f+.925f*vcurve);
      float bridge=0.0f,string=grand_strings_step(q,force,rate,&bridge);

      /* Route the physically observed bridge force to three spatial soundboard
         zones.  Direct string radiation is deliberately small: the acoustic
         piano is heard predominantly through the bridge and soundboard. */
      float wb,wm,wt;grand_zone_weights(key,&wb,&wm,&wt);
      float voice_amp=(.32f+.68f*vel)*q->expr_volume*q->amp_env*g_params[1];
      float high_register=clampf((q->glide_pitch-60.0f)/36.0f,0.0f,1.0f);
      float board_gain=voice_amp*(.42f+.34f*g_params[P_PIANO_SYMPATHETIC])*
        lerpf(1.0f,2.2f,key)*lerpf(1.0f,4.0f,high_register);
      /* A microphone hears soundboard velocity, while the string/bridge junction
         state is closer to displacement/force.  A bounded first difference is
         therefore part of the physical bridge-radiation transfer; it restores
         the upper partials without adding a post-synthesis EQ. */
      float bridge_delta=bridge-q->grand_bridge_radiation_prev;
      q->grand_bridge_radiation_prev=bridge;
      float bridge_diff_gain=(5.0f-2.0f*key)+2.0f*vel2-3.0f*key*vel3;
      float bridge_radiated=bridge+bridge_delta*bridge_diff_gain;
      g_grand_board_drive[0]+=bridge_radiated*board_gain*wb;
      g_grand_board_drive[1]+=bridge_radiated*board_gain*wm;
      g_grand_board_drive[2]+=bridge_radiated*board_gain*wt;
      float impact=(t<1.0f?(white-q->physical_aux)*compression:0.0f)*(.006f+.030f*hard)*hard*vel_noise*1.8f*bass_noise;
      /* The bare string radiates very inefficiently into air, especially in the
         wound-bass register.  Let the bridge/soundboard carry the low register
         instead of exposing displacement as a strong direct "buzzy" tone. */
      /* Bare-string air radiation is extremely inefficient in the wound-bass
         register.  The previous floor still exposed a near-periodic string
         displacement directly and produced an audible sustained "buzz" under
         pedalled chords.  Fade that path in only above the low register and
         leave bass radiation to the bridge/soundboard. */
      float key_air=clampf((key-.16f)/.55f,0.0f,1.0f);
      float bass_air=clampf((48.0f-q->glide_pitch)/15.0f,0.0f,1.0f);
      float direct_string=lerpf(.001f+.020f*key_air*key_air,.004f+.020f*key_air*key_air,bass_air);
      float direct_bridge=lerpf(.003f+.018f*key_air,.012f+.015f*key_air,bass_air);
      m=(string*direct_string+bridge*direct_bridge+impact)*2.75f;
      side=(key-.5f)*g_params[P_PIANO_STEREO_WIDTH]*.52f;
    }else if(engine==3){
      float vel=q->velocity,hard=g_params[P_TINE_HAMMER_HARDNESS],alen=lerpf(.0075f,.0016f,hard),a=q->age<alen?(1.0f-q->age/alen):0.0f;
      float exc=(rnd()*(.20f+.65f*hard)+fast_sine(ph)*.22f)*a*(.12f+.48f*vel),st=.0002f+.0032f*g_params[P_TINE_STIFFNESS],q0=90.0f+(1.0f-g_params[P_TINE_DECAY])*620.0f;
      float f0=resonator_step(exc,base_hz,q0,rate,&q->modal1_ic1,&q->modal1_ic2),f2=resonator_step(exc,base_hz*2.0f*(1.0f+st*2.0f),q0*.55f,rate,&q->modal2_ic1,&q->modal2_ic2),f3=resonator_step(exc,base_hz*3.0f*(1.0f+st*4.5f),q0*.38f,rate,&q->modal3_ic1,&q->modal3_ic2);
      float pos=g_params[P_TINE_PICKUP_POSITION],pickup=f0*(.72f+.28f*pos)-f2*(.10f+.42f*absf(pos-.5f))+f3*(.04f+.18f*(1.0f-pos));pickup=softclip(pickup*(1.0f+g_params[P_TINE_PICKUP_DRIVE]*7.0f));
      float bell=g_params[P_TINE_BELL_MIX],body=g_params[P_TINE_BODY],bellm=resonator_step(pickup,base_hz*4.03f,18.0f+bell*70.0f,rate,&q->modal4_ic1,&q->modal4_ic2),bodym=resonator_step(pickup,lerpf(170.0f,420.0f,body),4.0f+body*7.0f,rate,&q->modal5_ic1,&q->modal5_ic2);
      m=pickup*.72f+bellm*bell*.26f+bodym*body*.18f;
    }else if(engine==4){m=bowed_string_v7(q,base_hz,rate);side=fast_sine(q->lfo2_phase+.17f)*(.012f+.032f*spread);
    }else if(engine==5){m=flute_v7(q,base_hz,rate);
    }else if(engine==6){m=reed_v7(q,base_hz,rate);
    }else if(engine==7){m=brass_v7(q,base_hz,rate);
    }else{m=vocal_v7(q,ph,rate,mod.formant);}
    if(absf(mod.body)>0.0001f){float bf=lerpf(145.0f,760.0f,clampf(.5f+.5f*mod.body,0.0f,1.0f));float br=resonator_step(m,bf,4.0f+absf(mod.body)*9.0f,rate,&q->mod_body_ic1,&q->mod_body_ic2);m+=br*mod.body*.30f;}
    float pan=clampf(g_params[38]+q->expr_pan+side+q->voice_pan_bias*g_params[P_VOICE_PAN_SPREAD]*.28f+age_wave*g_params[P_VOICE_PAN_SPREAD]*.06f+mod.pan*.72f,-1.0f,1.0f);
    float gl=.70710678f*(1.0f-pan*.62f),gr=.70710678f*(1.0f+pan*.62f);
    voice_l=lerpf(voice_l,m*gl,physical_mix);voice_r=lerpf(voice_r,m*gr,physical_mix);
  }

  {
    float generic_tail=engine==0?1.0f:(1.0f-physical_mix);
    float sub_hz=base_hz*fast_exp2(g_params[49]);
    q->phase_sub=wrap01(q->phase_sub+sub_hz/rate);
    if(generic_tail>0.0001f){
      float sub=fast_sine(q->phase_sub)*g_params[6]*generic_tail;
      float noise=colored_noise(g_params[50])*g_params[7]*generic_tail;
      voice_l += sub*0.7071f + noise*0.62f;
      voice_r += sub*0.7071f + noise*0.62f;
    }
  }

  float env_oct=g_params[23]*q->filt_env*4.0f;
  float vel_oct=(q->velocity-0.5f)*g_params[29]*2.0f;
  float pressure_oct=q->pressure*g_params[30]*2.0f;
  float key_oct=((q->glide_pitch-60.0f)/12.0f)*g_params[28];
  float lfo_oct=local_lfo1*g_params[34]*1.5f;
  float cutoff=g_cutoff_smooth*fast_exp2(env_oct+vel_oct+pressure_oct+key_oct+lfo_oct+mod.filter);
  int mode=clampi((int)(g_params[22]+0.5f),0,2);

  float xL,xR;
  int filter_quality=clampi((int)(g_params[P_FILTER_QUALITY]+0.5f),0,1);
  int stereo_filter=g_params[P_STEREO_FILTER]>=0.5f;
  if(filter_quality==0){
    float mid=(voice_l+voice_r)*0.5f,side=(voice_l-voice_r)*0.5f;
    float filtered=legacy_filter_voice(q,mid,cutoff,g_params[20],g_params[21],mode,rate);
    xL=filtered+side*0.72f;xR=filtered-side*0.72f;
  }else if(stereo_filter){
    xL=tpt_filter_step(voice_l,cutoff,g_params[20],g_params[21],mode,rate,&q->svf_ic1_l,&q->svf_ic2_l);
    xR=tpt_filter_step(voice_r,cutoff,g_params[20],g_params[21],mode,rate,&q->svf_ic1_r,&q->svf_ic2_r);
  }else{
    float mid=(voice_l+voice_r)*0.5f,side=(voice_l-voice_r)*0.5f;
    float filtered=tpt_filter_step(mid,cutoff,g_params[20],g_params[21],mode,rate,&q->svf_ic1_l,&q->svf_ic2_l);
    xL=filtered+side*0.72f;xR=filtered-side*0.72f;
  }
  /* Piano velocity is already encoded in hammer energy.  Keep a modest
     keyboard-loudness curve here instead of multiplying velocity twice. */
  float velocity_gain=engine==9?(0.70f+0.30f*q->velocity):(engine==2?(0.35f+0.65f*q->velocity):q->velocity);
  float amp=velocity_gain*q->expr_volume*q->amp_env*g_params[1]*clampf(1.0f+mod.amplitude*.72f,0.0f,1.72f);
  float out_l=xL*amp,out_r=xR*amp;
  if(q->steal_fade>0.0f){
    float f=q->steal_fade;
    out_l=q->steal_tail_l*f+out_l*(1.0f-f);
    out_r=q->steal_tail_r*f+out_r*(1.0f-f);
    q->steal_fade-=1.0f/(rate*0.004f);
    if(q->steal_fade<=0.0f){q->steal_fade=0.0f;q->steal_tail_l=q->steal_tail_r=0.0f;}
  }
  q->last_out_l=out_l;q->last_out_r=out_r;
  *l += out_l;
  *r += out_r;
  q->age += 1.0f/rate;
}

static void grand_soundboard_step(float rate,float* l,float* r){
  float sb=g_params[P_PIANO_SOUNDBOARD_SIZE],mix=g_params[P_PIANO_SOUNDBOARD_MIX];
  float in[3]={g_grand_board_drive[0],g_grand_board_drive[1],g_grand_board_drive[2]};
  for(int z=0;z<3;z++)g_grand_board_drive[z]=0.0f;
  /* Irregular, overlapping soundboard modes.  Their low Q and spatially varying
     bridge-zone participation approximate a distributed plate rather than six
     obvious tuned resonators. */
  const float basef[GRAND_SB_MODES]={
    54.0f,72.0f,96.0f,127.0f,166.0f,216.0f,279.0f,358.0f,
    455.0f,573.0f,716.0f,888.0f,1092.0f,1334.0f,1618.0f,1950.0f,
    2330.0f,2765.0f,3260.0f,3815.0f,4440.0f,5135.0f,5905.0f,6750.0f};
  /* Real-studio calibration showed a shallow 455-1334 Hz radiation deficit in
     the tenor bridge zone.  Keep only a modest ~8% plate-mobility lift here;
     larger boosts overfit the reference mic and regress the C4 harmonic guard. */
  const float weight[GRAND_SB_MODES]={
    .055f,.070f,.092f,.128f,.168f,.205f,.225f,.225f,.2268f,.1998f,.17496f,.15228f,
    .13068f,.11016f,.084f,.068f,.145f,.118f,.092f,.068f,.014f,.010f,.007f,.005f};
  float zone_fb[3]={0.0f,0.0f,0.0f},sl=0.0f,sr=0.0f;
  float zone_energy=absf(in[0])+absf(in[1])+absf(in[2])+1e-9f;
  float zone_pan=clampf((absf(in[2])-absf(in[0]))/zone_energy,-1.0f,1.0f);
  float bass_share=absf(in[0])/zone_energy;
  float bass_focus=clampf((bass_share-.42f)/.38f,0.0f,1.0f);
  float size_scale=.88f+.24f*sb;
  for(int i=0;i<GRAND_SB_MODES;i++){
    float t=(float)i/(float)(GRAND_SB_MODES-1);
    float mode_hz=basef[i]*size_scale;
    float br=mode_hz/420.0f,br2=br*br;
    float bass_lp=1.0f/(1.0f+br2*br2);
    /* Apply the steep bass transfer only when the bass bridge actually dominates.
       This keeps C4/tenor calibration unchanged while preventing F1/A1 from
       exciting the full fixed modal bank. */
    float cb_old=clampf(1.18f-1.12f*t,0.08f,1.10f);
    float cb_bass=clampf((.18f-.04f*t)*bass_lp,0.0008f,.18f);
    float cb=lerpf(cb_old,cb_bass,bass_focus);
    float ct=clampf(.10f+1.08f*t,0.10f,1.12f);
    float cm=.38f+.68f*(1.0f-absf(t-.5f)*2.0f);
    float drive=in[0]*cb+in[1]*cm+in[2]*ct;
    /* A real soundboard is a poor acoustic radiator at the very lowest
       structural modes.  Keep those modes for mechanical coupling, but do not
       let them dominate the microphone signal as quasi-sine drones. */
    float low_rad=.18f+.82f*clampf((basef[i]-72.0f)/210.0f,0.0f,1.0f);
    float q=2.10f+sb*2.15f+t*1.25f;
    float y=resonator_step(drive,mode_hz,q,rate,&g_grand_sb_ic1[i],&g_grand_sb_ic2[i]);
    float w=weight[i];
    float pan=zone_pan*.62f+(t-.5f)*.32f+((i&1)?-.09f:.09f);
    sl+=y*w*low_rad*(1.0f-pan*.52f);sr+=y*w*low_rad*(1.0f+pan*.52f);
    float mech_fb=lerpf(.42f,1.0f,low_rad);
    zone_fb[0]+=y*w*cb*mech_fb;zone_fb[1]+=y*w*cm*mech_fb;zone_fb[2]+=y*w*ct*mech_fb;
  }
  /* Broadband plate motion prevents the modal bank from sounding like a set of
     bells and preserves the short wooden/bridge transient. */
  float broad_l=0.0f,broad_r=0.0f;
  const float zp[3]={-.72f,0.0f,.72f};
  for(int z=0;z<3;z++){
    float bass_a=.010f+.018f*sb,normal_a=.020f+.055f*sb;
    float a=z==0?lerpf(normal_a,bass_a,bass_focus):normal_a;
    g_grand_board_broad[z]+=a*(in[z]-g_grand_board_broad[z]);
    float hp=z==0?lerpf(.12f,.008f,bass_focus):(z==1?.070f:.12f);
    float lp_gain=z==0?lerpf(.46f,1.00f,bass_focus):.46f;
    float broad=g_grand_board_broad[z]*lp_gain+(in[z]-g_grand_board_broad[z])*hp;
    float broad_gain=z==0?lerpf(1.0f,2.30f,bass_focus):1.0f;
    broad_l+=broad*broad_gain*(1.0f-zp[z]*.48f);broad_r+=broad*broad_gain*(1.0f+zp[z]*.48f);
    g_grand_board_feedback[z]=clampf(zone_fb[z]*(.44f+.32f*sb),-.20f,.20f);
  }
  float wet=8.69f*mix;
  *l+=(sl+broad_l*.24f)*wet;
  *r+=(sr+broad_r*.24f)*wet;
}

static float chorus_read(float* buf,float delay){
  float rp=(float)g_chorus_pos-delay;
  while(rp<0.0f)rp+=(float)CHORUS_SIZE;
  int i0=(int)rp;int i1=i0+1;if(i1>=CHORUS_SIZE)i1=0;
  return lerpf(buf[i0],buf[i1],rp-(float)i0);
}

static void chorus(float inL,float inR,float* outL,float* outR){
  float mix=g_params[40];
  if(mix<=0.0001f){*outL=inL;*outR=inR;return;}
  float depth=g_params[42];
  float base=(0.014f+0.004f*depth)*(float)g_sr;
  float swing=(0.0015f+0.0075f*depth)*(float)g_sr;
  float dl=base+swing*(0.5f+0.5f*fast_sine(g_chorus_phase));
  float dr=base+swing*(0.5f+0.5f*fast_sine(g_chorus_phase+0.31f));
  float wetL=chorus_read(g_chorus_l,dl);
  float wetR=chorus_read(g_chorus_r,dr);
  float fb=g_params[43];
  g_chorus_l[g_chorus_pos]=inL+wetR*fb;
  g_chorus_r[g_chorus_pos]=inR+wetL*fb;
  g_chorus_pos++;if(g_chorus_pos>=CHORUS_SIZE)g_chorus_pos=0;
  g_chorus_phase=wrap01(g_chorus_phase+g_params[41]/(float)g_sr);
  *outL=lerpf(inL,wetL,mix);
  *outR=lerpf(inR,wetR,mix);
}


static float hb_tick(HalfbandState* s,float x){
  int p=s->pos;s->z[p]=x;float y=0.0f;
  for(int k=0;k<HB_TAPS;k++){int i=p-k;while(i<0)i+=HB_TAPS;y+=g_hb[k]*s->z[i];}
  s->pos=p+1;if(s->pos>=HB_TAPS)s->pos=0;return y;
}


static int effective_oversample(void){
  int requested=1<<clampi((int)(g_params[45]+0.5f),0,2);
  if(g_params[P_ADAPTIVE_QUALITY]<0.5f)return requested;
  int engine=clampi((int)(g_params[P_ENGINE]+0.5f),0,9);
  if(engine!=0)return requested; /* physical delay/resonance tuning remains exact */
  float budget=clampf(g_params[P_CPU_BUDGET],0.25f,1.0f);int uni=clampi((int)(g_params[10]+0.5f),1,MAX_UNISON);
  int active=0;for(int i=0;i<MAX_VOICES;i++)if(g_voices[i].active)active++;
  int os=requested;
  if(os==4 && ((uni>=6&&budget<.88f)||(active>=18&&budget<.82f)||(active>=26&&budget<.95f)))os=2;
  if(os>=2 && active>=26 && budget<.45f && g_params[13]<.18f && g_params[20]<.55f && g_params[44]<.18f)os=1;
  /* Keep at least 2x for strong nonlinear/FM/filter settings even under load. */
  if(requested>=2 && (g_params[13]>.35f||g_params[20]>.72f||g_params[44]>.35f) && os<2)os=2;
  return os;
}

void dsp_process(int frames,float* outL,float* outR){
  int os=effective_oversample();
  int decim=clampi((int)(g_params[P_DECIMATION_QUALITY]+0.5f),0,1);
  float internal_rate=(float)g_sr*(float)os;
  for(int i=0;i<frames;i++){
    g_cutoff_smooth += (g_params[19]-g_cutoff_smooth)*0.012f;
    g_master_smooth += (g_params[0]-g_master_smooth)*0.008f;
    float sumL=0.0f,sumR=0.0f,outOsL=0.0f,outOsR=0.0f;
    for(int sub=0;sub<os;sub++){
      float lfo1=fast_sine(g_lfo1_phase);
      float lfo2=fast_sine(g_lfo2_phase);
      g_lfo1_phase=wrap01(g_lfo1_phase+g_params[32]/internal_rate);
      g_lfo2_phase=wrap01(g_lfo2_phase+g_params[35]/internal_rate);
      float l=0.0f,r=0.0f;
      for(int z=0;z<3;z++)g_grand_board_drive[z]=0.0f;
      for(int v=0;v<MAX_VOICES;v++)if(g_voices[v].active)render_voice_step(&g_voices[v],lfo1,lfo2,internal_rate,&l,&r);
      if(clampi((int)(g_params[P_ENGINE]+0.5f),0,9)==9)grand_soundboard_step(internal_rate,&l,&r);
      float sat_amt=clampf(g_params[44],0.0f,1.0f);
      if(sat_amt>0.0001f){
        float drive=1.0f+sat_amt*5.0f;
        float wetL=softclip(l*drive)/drive,wetR=softclip(r*drive)/drive;
        l=lerpf(l,wetL,sat_amt);r=lerpf(r,wetR,sat_amt);
      }
      if(decim==0 || os==1){sumL+=l;sumR+=r;}
      else if(os==2){
        float fL=hb_tick(&g_hb1_l,l),fR=hb_tick(&g_hb1_r,r);
        if(sub==1){outOsL=fL;outOsR=fR;}
      }else{
        float s1L=hb_tick(&g_hb1_l,l),s1R=hb_tick(&g_hb1_r,r);
        if((sub&1)==1){
          float s2L=hb_tick(&g_hb2_l,s1L),s2R=hb_tick(&g_hb2_r,s1R);
          if(sub==3){outOsL=s2L;outOsR=s2R;}
        }
      }
    }
    float l,r;
    if(decim==1 && os>1){l=outOsL;r=outOsR;}else{l=sumL*(1.0f/(float)os);r=sumR*(1.0f/(float)os);}
    chorus(l,r,&l,&r);

    float width=g_params[51];
    float mid=(l+r)*0.5f;
    float side=(l-r)*0.5f*width;
    l=mid+side;r=mid-side;
    l*=g_master_smooth;r*=g_master_smooth;
    /* Final guard is transparent in the normal -1..+1 range.  The previous
       always-on softclip introduced low-level intermodulation on dense piano
       chords even with the saturation parameter at zero. */
    if(absf(l)>1.0f){float a=absf(l)-1.0f;l=(l<0.0f?-1.0f:1.0f)*(1.0f+a/(1.0f+3.0f*a));}
    if(absf(r)>1.0f){float a=absf(r)-1.0f;r=(r<0.0f?-1.0f:1.0f)*(1.0f+a/(1.0f+3.0f*a));}
    outL[i]=clampf(l,-1.2f,1.2f);
    outR[i]=clampf(r,-1.2f,1.2f);
  }
}

#include "plugin_abi_runtime.h"
