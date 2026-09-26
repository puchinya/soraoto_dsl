#ifndef SORAOTO_PLUGIN_ABI_RUNTIME_H
#define SORAOTO_PLUGIN_ABI_RUNTIME_H

#include <stdint.h>
#include PLUGIN_DESCRIPTOR_HEADER

#define SORAOTO_ABI_VERSION 0x00010000u
#define SORAOTO_OK 0
#define SORAOTO_E_INVALID_ARGUMENT -1
#define SORAOTO_E_BAD_STATE -2
#define SORAOTO_E_UNSUPPORTED -3
#define SORAOTO_E_BUFFER_TOO_SMALL -4
#define SORAOTO_E_INCOMPATIBLE_LAYOUT -5
#define SORAOTO_E_OUT_OF_MEMORY -6
#define SORAOTO_E_STATE_INCOMPATIBLE -7
#define SORAOTO_E_INTERNAL -9

#define SORAOTO_CONTROL_GET_DESCRIPTOR 1
#define SORAOTO_CONTROL_CONFIGURE 2
#define SORAOTO_CONTROL_GET_ACTIVE_CONFIG 3
#define SORAOTO_CONTROL_GET_PARAMETER_SNAPSHOT 4
#define SORAOTO_CONTROL_LOAD_FACTORY_PRESET 10
#define SORAOTO_CONTROL_GET_PROGRAM_INFO 20
#define SORAOTO_CONTROL_LOAD_PROGRAM 21

#define SORAOTO_EVENT_NOTE_ON 1
#define SORAOTO_EVENT_NOTE_OFF 2
#define SORAOTO_EVENT_NOTE_EXPRESSION 3

#define ST_CREATED 0
#define ST_INITIALIZED 1
#define ST_CONFIGURED 2
#define ST_ACTIVE 3
#define ST_PROCESSING 4

static int soraoto_state=ST_CREATED;
static uint32_t soraoto_heap_cursor=0;
static uint32_t soraoto_heap_peak=0;
#define SORAOTO_ALLOC_STACK_CAP 1024u
static uint32_t soraoto_alloc_ptrs[SORAOTO_ALLOC_STACK_CAP];
static uint32_t soraoto_alloc_prev[SORAOTO_ALLOC_STACK_CAP];
static uint32_t soraoto_alloc_ends[SORAOTO_ALLOC_STACK_CAP];
static uint32_t soraoto_alloc_count=0;
static unsigned char soraoto_config_bytes[4096];
static uint32_t soraoto_config_len=0;
static float soraoto_param_norm[(PLUGIN_PARAM_COUNT>0)?PLUGIN_PARAM_COUNT:1];
extern unsigned char __heap_base;

static uint32_t rd32(uint32_t p){return *(uint32_t*)(uintptr_t)p;}
static uint64_t rd64(uint32_t p){return *(uint64_t*)(uintptr_t)p;}
static float rdf32(uint32_t p){return *(float*)(uintptr_t)p;}
static double rdf64(uint32_t p){return *(double*)(uintptr_t)p;}
static void wr32(uint32_t p,uint32_t v){*(uint32_t*)(uintptr_t)p=v;}
static void wr64(uint32_t p,uint64_t v){*(uint64_t*)(uintptr_t)p=v;}

static void bytes_copy(unsigned char* d,const unsigned char* s,uint32_t n){for(uint32_t i=0;i<n;i++)d[i]=s[i];}
static int bytes_equal(const unsigned char* a,const unsigned char* b,uint32_t n){for(uint32_t i=0;i<n;i++)if(a[i]!=b[i])return 0;return 1;}

static uint32_t memory_bytes(void){return (uint32_t)__builtin_wasm_memory_size(0)*65536u;}
static int ensure_memory(uint32_t end){
  uint32_t now=memory_bytes();if(end<=now)return 1;
  uint32_t need=end-now,pages=(need+65535u)/65536u;
  return __builtin_wasm_memory_grow(0,pages)!=0xffffffffu;
}

uint32_t soraoto_alloc(int32_t size,int32_t align){
  if(soraoto_state==ST_PROCESSING||size<=0||align<8||align>64||(align&(align-1))||soraoto_alloc_count>=SORAOTO_ALLOC_STACK_CAP)return 0;
  uint32_t a=(uint32_t)align;
  if(!soraoto_heap_cursor)soraoto_heap_cursor=(uint32_t)(uintptr_t)&__heap_base;
  uint32_t prev=soraoto_heap_cursor,p=(prev+a-1u)&~(a-1u),end=p+(uint32_t)size;
  if(end<p||!ensure_memory(end))return 0;
  soraoto_alloc_ptrs[soraoto_alloc_count]=p;soraoto_alloc_prev[soraoto_alloc_count]=prev;soraoto_alloc_ends[soraoto_alloc_count]=end;soraoto_alloc_count++;
  soraoto_heap_cursor=end;if(end>soraoto_heap_peak)soraoto_heap_peak=end;return p;
}
void soraoto_free(int32_t ptr,int32_t size,int32_t align){
  /* General non-LIFO frees remain deferred until terminate, but LIFO control
     buffers restore the exact pre-alignment cursor so repeated queries do not
     leak alignment padding. */
  if(soraoto_state==ST_PROCESSING||ptr<=0||size<=0||align<8||align>64||!soraoto_alloc_count)return;
  uint32_t i=soraoto_alloc_count-1u,p=(uint32_t)ptr,n=(uint32_t)size,end=p+n;
  if(end>=p&&soraoto_alloc_ptrs[i]==p&&soraoto_alloc_ends[i]==end){soraoto_heap_cursor=soraoto_alloc_prev[i];soraoto_alloc_count=i;}
}

/* Minimal deterministic-CBOR reader used only for CONFIGURE. */
typedef struct {const unsigned char* p;const unsigned char* end;} CborCur;
static int cbor_uint_ai(CborCur* c,unsigned ai,uint64_t* out){
  if(ai<24){*out=ai;return 1;}
  unsigned n=ai==24?1:ai==25?2:ai==26?4:ai==27?8:0;if(!n||c->p+n>c->end)return 0;
  uint64_t v=0;for(unsigned i=0;i<n;i++)v=(v<<8)|*c->p++;*out=v;return 1;
}
static int cbor_skip(CborCur* c);
static int cbor_head(CborCur* c,unsigned* major,uint64_t* val,unsigned* ai){
  if(c->p>=c->end)return 0;unsigned b=*c->p++;*major=b>>5;*ai=b&31;return cbor_uint_ai(c,*ai,val);
}
static int cbor_skip(CborCur* c){
  unsigned m,ai;uint64_t n;if(!cbor_head(c,&m,&n,&ai))return 0;
  if(m==0||m==1)return 1;
  if(m==2||m==3){if(n>(uint64_t)(c->end-c->p))return 0;c->p+=(uint32_t)n;return 1;}
  if(m==4){for(uint64_t i=0;i<n;i++)if(!cbor_skip(c))return 0;return 1;}
  if(m==5){for(uint64_t i=0;i<n;i++)if(!cbor_skip(c)||!cbor_skip(c))return 0;return 1;}
  if(m==7){if(ai==27)return c->p<=c->end;return ai==20||ai==21||ai==22;}
  return 0;
}
static int keyeq(const unsigned char* p,uint32_t n,const char* s){uint32_t i=0;for(;s[i];i++)if(i>=n||p[i]!=(unsigned char)s[i])return 0;return i==n;}
static int parse_config(const unsigned char* p,uint32_t n,double* sample_rate,uint32_t* max_frames){
  CborCur c={p,p+n};unsigned m,ai;uint64_t count;if(!cbor_head(&c,&m,&count,&ai)||m!=5)return 0;
  int got_sr=0,got_mf=0;
  for(uint64_t i=0;i<count;i++){
    unsigned km,kai;uint64_t kn;if(!cbor_head(&c,&km,&kn,&kai)||km!=3||kn>(uint64_t)(c.end-c.p))return 0;
    const unsigned char* kp=c.p;c.p+=(uint32_t)kn;
    if(keyeq(kp,(uint32_t)kn,"sample_rate")){
      if(c.p>=c.end||*c.p++!=0xfb||c.p+8>c.end)return 0;
      uint64_t bits=0;for(int j=0;j<8;j++)bits=(bits<<8)|*c.p++; union{uint64_t u;double d;}x;x.u=bits;*sample_rate=x.d;got_sr=1;
    }else if(keyeq(kp,(uint32_t)kn,"max_frames")){
      unsigned vm,vai;uint64_t v;if(!cbor_head(&c,&vm,&v,&vai)||vm!=0||v>0xffffffffu)return 0;*max_frames=(uint32_t)v;got_mf=1;
    }else if(!cbor_skip(&c))return 0;
  }
  return got_sr&&got_mf&&c.p==c.end&&*sample_rate>0&&*max_frames>0;
}

static int soraoto_param_slot(uint32_t id){
  for(uint32_t i=0;i<PLUGIN_PARAM_COUNT;i++)if(soraoto_param_ids[i]==id)return (int)i;
  return -1;
}
static float soraoto_fast_exp2(float x){
  int k=(int)x;if(x<0.0f&&(float)k!=x)k--;float f=x-(float)k;
  float y=1.0f+0.69314718f*f+0.24022651f*f*f+0.05550411f*f*f*f;
  if(k>0){while(k--)y*=2.0f;}else{while(k++)y*=0.5f;}return y;
}
static float soraoto_norm_to_plain_slot(uint32_t slot,double n){
  if(slot>=PLUGIN_PARAM_COUNT)return 0.0f;if(!(n==n))n=0;if(n<0)n=0;if(n>1)n=1;
  float lo=soraoto_param_min[slot],hi=soraoto_param_max[slot];
  if(soraoto_param_type[slot]==3)return n>=0.5?1.0f:0.0f;
  if(soraoto_param_type[slot]==1||soraoto_param_type[slot]==2){
    int N=(int)(hi-lo+1.0f);if(N<1)N=1;int idx=(int)(n*(double)N);if(idx>=N)idx=N-1;return lo+(float)idx;
  }
  if(soraoto_param_scale[slot]==1 && lo>0.0f)return lo*soraoto_fast_exp2(soraoto_param_scale_aux[slot]*(float)n);
  return lo+(float)n*(hi-lo);
}
static void apply_param_slot(uint32_t slot,double n){
  if(slot>=PLUGIN_PARAM_COUNT)return;if(!(n==n))n=0;if(n<0)n=0;if(n>1)n=1;
  soraoto_param_norm[slot]=(float)n;dsp_set_parameter((int)slot,soraoto_norm_to_plain_slot(slot,n),0);
}
static void apply_param(uint32_t id,double n){
  int slot=soraoto_param_slot(id);if(slot<0)return;apply_param_slot((uint32_t)slot,n);
}
static void init_param_defaults(void){for(uint32_t i=0;i<PLUGIN_PARAM_COUNT;i++){soraoto_param_norm[i]=soraoto_param_default_norm[i];dsp_set_parameter((int)i,soraoto_norm_to_plain_slot(i,soraoto_param_norm[i]),0);}}

int32_t soraoto_plugin_abi_version(void){return (int32_t)SORAOTO_ABI_VERSION;}
int32_t soraoto_plugin_init(int32_t host_abi){
  if(soraoto_state!=ST_CREATED)return SORAOTO_E_BAD_STATE;
  if(((uint32_t)host_abi>>16)!=1u)return SORAOTO_E_INCOMPATIBLE_LAYOUT;
  soraoto_state=ST_INITIALIZED;return SORAOTO_OK;
}
void soraoto_plugin_terminate(void){
  /* Exact ABI shutdown has no separate unconfigure export: after deactivate the
     instance is Configured and terminate completes the reverse transition. */
  if(soraoto_state==ST_INITIALIZED||soraoto_state==ST_CONFIGURED){soraoto_state=ST_CREATED;soraoto_heap_cursor=0;soraoto_heap_peak=0;soraoto_alloc_count=0;soraoto_config_len=0;}
}

static int parse_u32_field_map(const unsigned char* p,uint32_t n,const char* key1,uint32_t* v1,const char* key2,uint32_t* v2){
  CborCur c={p,p+n};unsigned m,ai;uint64_t count;if(!cbor_head(&c,&m,&count,&ai)||m!=5)return 0;
  int got1=0,got2=key2?0:1;
  for(uint64_t i=0;i<count;i++){
    unsigned km,kai;uint64_t kn;if(!cbor_head(&c,&km,&kn,&kai)||km!=3||kn>(uint64_t)(c.end-c.p))return 0;
    const unsigned char* kp=c.p;c.p+=(uint32_t)kn;
    unsigned vm,vai;uint64_t value;
    if(keyeq(kp,(uint32_t)kn,key1)){
      if(!cbor_head(&c,&vm,&value,&vai)||vm!=0||value>0xffffffffu)return 0;*v1=(uint32_t)value;got1=1;
    }else if(key2&&keyeq(kp,(uint32_t)kn,key2)){
      if(!cbor_head(&c,&vm,&value,&vai)||vm!=0||value>0xffffffffu)return 0;*v2=(uint32_t)value;got2=1;
    }else if(!cbor_skip(&c))return 0;
  }
  return got1&&got2&&c.p==c.end;
}
static uint32_t cbor_put_head(unsigned char* out,uint32_t cap,uint32_t at,unsigned major,uint64_t v){
  uint32_t need=v<24?1:v<=0xff?2:v<=0xffff?3:v<=0xffffffffu?5:9;if(at+need>cap)return 0xffffffffu;
  if(v<24){out[at++]=(unsigned char)((major<<5)|(unsigned)v);return at;}
  unsigned ai=v<=0xff?24:v<=0xffff?25:v<=0xffffffffu?26:27;out[at++]=(unsigned char)((major<<5)|ai);
  unsigned n=ai==24?1:ai==25?2:ai==26?4:8;for(unsigned i=0;i<n;i++)out[at+i]=(unsigned char)(v>>(8*(n-1-i)));return at+n;
}
static uint32_t cbor_put_text(unsigned char* out,uint32_t cap,uint32_t at,const char* s){uint32_t n=0;while(s[n])n++;at=cbor_put_head(out,cap,at,3,n);if(at==0xffffffffu||at+n>cap)return 0xffffffffu;for(uint32_t i=0;i<n;i++)out[at+i]=(unsigned char)s[i];return at+n;}
static uint32_t cbor_put_f64(unsigned char* out,uint32_t cap,uint32_t at,double v){if(at+9>cap)return 0xffffffffu;out[at++]=0xfb;union{double d;uint64_t u;}x;x.d=v;for(int i=7;i>=0;i--)out[at++]=(unsigned char)(x.u>>(i*8));return at;}
static uint32_t parameter_snapshot_size(void){
  /* {"values":[{"parameter_id":id,"value":{"kind":"numeric","normalized":f64}}, ...]} */
  uint32_t n=1+1+6+1; /* map1 + text(values) + array header */
  if(PLUGIN_PARAM_COUNT>=24)n+=1;
  for(uint32_t i=0;i<PLUGIN_PARAM_COUNT;i++){
    uint32_t id=soraoto_param_ids[i];n+=1+1+12+(id<24?1:id<=0xff?2:id<=0xffff?3:5)+1+5+1+1+4+1+7+1+10+9;
  }
  return n;
}
static int32_t write_parameter_snapshot(int32_t outp,int32_t cap){
  uint32_t need=parameter_snapshot_size();if(!outp&&!cap)return (int32_t)need;if(outp<=0||cap<0||(uint32_t)cap<need)return SORAOTO_E_BUFFER_TOO_SMALL;
  unsigned char* out=(unsigned char*)(uintptr_t)(uint32_t)outp;uint32_t at=0,C=(uint32_t)cap;
  at=cbor_put_head(out,C,at,5,1);at=cbor_put_text(out,C,at,"values");at=cbor_put_head(out,C,at,4,PLUGIN_PARAM_COUNT);
  for(uint32_t i=0;i<PLUGIN_PARAM_COUNT;i++){
    at=cbor_put_head(out,C,at,5,2);at=cbor_put_text(out,C,at,"parameter_id");at=cbor_put_head(out,C,at,0,soraoto_param_ids[i]);
    at=cbor_put_text(out,C,at,"value");at=cbor_put_head(out,C,at,5,2);at=cbor_put_text(out,C,at,"kind");at=cbor_put_text(out,C,at,"numeric");at=cbor_put_text(out,C,at,"normalized");at=cbor_put_f64(out,C,at,(double)soraoto_param_norm[i]);
    if(at==0xffffffffu)return SORAOTO_E_INTERNAL;
  }
  return (int32_t)at;
}
#ifdef PLUGIN_FACTORY_PRESET_COUNT
static int apply_factory_preset_id(uint32_t id){
  for(uint32_t p=0;p<PLUGIN_FACTORY_PRESET_COUNT;p++)if(soraoto_factory_preset_ids[p]==id){for(uint32_t i=0;i<PLUGIN_PARAM_COUNT;i++)apply_param(soraoto_param_ids[i],soraoto_factory_preset_norm[p][i]);return 1;}return 0;
}
#endif

static int write_response(const unsigned char* src,uint32_t len,int32_t outp,int32_t cap){
  if(!outp&&!cap)return (int)len;if(outp<=0||cap<0)return SORAOTO_E_INVALID_ARGUMENT;if((uint32_t)cap<len)return SORAOTO_E_BUFFER_TOO_SMALL;
  if((uint32_t)outp+len<(uint32_t)outp||(uint32_t)outp+len>memory_bytes())return SORAOTO_E_INVALID_ARGUMENT;
  bytes_copy((unsigned char*)(uintptr_t)(uint32_t)outp,src,len);return (int)len;
}
int32_t soraoto_plugin_control(int32_t opcode,int32_t request_ptr,int32_t request_len,int32_t response_ptr,int32_t response_capacity){
  if(soraoto_state<ST_INITIALIZED||soraoto_state>ST_ACTIVE)return SORAOTO_E_BAD_STATE;
  if(opcode==SORAOTO_CONTROL_GET_DESCRIPTOR){
    if(request_len!=1||request_ptr<=0||*(unsigned char*)(uintptr_t)(uint32_t)request_ptr!=0xf6)return SORAOTO_E_INVALID_ARGUMENT;
    return write_response(soraoto_descriptor_bytes,SORAOTO_DESCRIPTOR_LEN,response_ptr,response_capacity);
  }
  if(opcode==SORAOTO_CONTROL_CONFIGURE){
    if(soraoto_state!=ST_INITIALIZED&&soraoto_state!=ST_CONFIGURED&&soraoto_state!=ST_ACTIVE)return SORAOTO_E_BAD_STATE;
    if(request_ptr<=0||request_len<=0||(uint32_t)request_len>sizeof(soraoto_config_bytes))return SORAOTO_E_INVALID_ARGUMENT;
    double rate=0;uint32_t frames=0;const unsigned char* req=(const unsigned char*)(uintptr_t)(uint32_t)request_ptr;
    if(!parse_config(req,(uint32_t)request_len,&rate,&frames)||frames>8192)return SORAOTO_E_INVALID_ARGUMENT;
    bytes_copy(soraoto_config_bytes,req,(uint32_t)request_len);soraoto_config_len=(uint32_t)request_len;
    dsp_init((int)(rate+0.5),(int)frames);init_param_defaults();soraoto_state=ST_CONFIGURED;return SORAOTO_OK;
  }
  if(opcode==SORAOTO_CONTROL_GET_ACTIVE_CONFIG){
    if(soraoto_state<ST_CONFIGURED)return SORAOTO_E_BAD_STATE;
    if(request_len!=1||request_ptr<=0||*(unsigned char*)(uintptr_t)(uint32_t)request_ptr!=0xf6)return SORAOTO_E_INVALID_ARGUMENT;
    return write_response(soraoto_config_bytes,soraoto_config_len,response_ptr,response_capacity);
  }
  if(opcode==SORAOTO_CONTROL_GET_PARAMETER_SNAPSHOT){
    if(request_len!=1||request_ptr<=0||*(unsigned char*)(uintptr_t)(uint32_t)request_ptr!=0xf6)return SORAOTO_E_INVALID_ARGUMENT;
    return write_parameter_snapshot(response_ptr,response_capacity);
  }
  if(opcode==SORAOTO_CONTROL_LOAD_FACTORY_PRESET){
    if(soraoto_state!=ST_CONFIGURED&&soraoto_state!=ST_ACTIVE)return SORAOTO_E_BAD_STATE;
    if(request_ptr<=0||request_len<=0||response_ptr||response_capacity)return SORAOTO_E_INVALID_ARGUMENT;
    uint32_t preset_id=0;if(!parse_u32_field_map((const unsigned char*)(uintptr_t)(uint32_t)request_ptr,(uint32_t)request_len,"preset_id",&preset_id,0,0))return SORAOTO_E_INVALID_ARGUMENT;
#ifdef PLUGIN_FACTORY_PRESET_COUNT
    return apply_factory_preset_id(preset_id)?SORAOTO_OK:SORAOTO_E_INVALID_ARGUMENT;
#else
    return SORAOTO_E_UNSUPPORTED;
#endif
  }
  if(opcode==SORAOTO_CONTROL_GET_PROGRAM_INFO){
#ifdef PLUGIN_PROGRAM_COUNT
    uint32_t list_id=0,program_id=0;if(request_ptr<=0||request_len<=0||!parse_u32_field_map((const unsigned char*)(uintptr_t)(uint32_t)request_ptr,(uint32_t)request_len,"program_list_id",&list_id,"program_id",&program_id))return SORAOTO_E_INVALID_ARGUMENT;
    if(list_id!=PLUGIN_PROGRAM_LIST_ID)return SORAOTO_E_INVALID_ARGUMENT;
    for(uint32_t i=0;i<PLUGIN_PROGRAM_COUNT;i++)if(soraoto_program_ids[i]==program_id){uint32_t a=soraoto_program_info_offsets[i],b=soraoto_program_info_offsets[i+1];return write_response(soraoto_program_info_bytes+a,b-a,response_ptr,response_capacity);}return SORAOTO_E_INVALID_ARGUMENT;
#else
    return SORAOTO_E_UNSUPPORTED;
#endif
  }
  if(opcode==SORAOTO_CONTROL_LOAD_PROGRAM){
    if(soraoto_state!=ST_CONFIGURED&&soraoto_state!=ST_ACTIVE)return SORAOTO_E_BAD_STATE;
#ifdef PLUGIN_PROGRAM_COUNT
    uint32_t list_id=0,program_id=0;if(response_ptr||response_capacity||request_ptr<=0||request_len<=0||!parse_u32_field_map((const unsigned char*)(uintptr_t)(uint32_t)request_ptr,(uint32_t)request_len,"program_list_id",&list_id,"program_id",&program_id))return SORAOTO_E_INVALID_ARGUMENT;
    if(list_id!=PLUGIN_PROGRAM_LIST_ID)return SORAOTO_E_INVALID_ARGUMENT;
    return apply_factory_preset_id(program_id)?SORAOTO_OK:SORAOTO_E_INVALID_ARGUMENT;
#else
    return SORAOTO_E_UNSUPPORTED;
#endif
  }
  return SORAOTO_E_UNSUPPORTED;
}
int32_t soraoto_plugin_activate(void){if(soraoto_state!=ST_CONFIGURED)return SORAOTO_E_BAD_STATE;soraoto_state=ST_ACTIVE;return SORAOTO_OK;}
void soraoto_plugin_deactivate(void){if(soraoto_state==ST_ACTIVE)soraoto_state=ST_CONFIGURED;}
int32_t soraoto_plugin_start_processing(void){if(soraoto_state!=ST_ACTIVE)return SORAOTO_E_BAD_STATE;soraoto_state=ST_PROCESSING;return SORAOTO_OK;}
void soraoto_plugin_stop_processing(void){if(soraoto_state==ST_PROCESSING)soraoto_state=ST_ACTIVE;}
void soraoto_plugin_reset(void){if(soraoto_state==ST_ACTIVE)dsp_reset();}

static float* bus_channel(uint32_t buses,uint32_t count,uint32_t bus_index,uint32_t channel){
  if(bus_index>=count)return (float*)0;uint32_t b=buses+bus_index*32u,cc=rd32(b+4),table=rd32(b+8);if(channel>=cc||!table)return (float*)0;
  uint32_t p=rd32(table+channel*4u);return p?(float*)(uintptr_t)p:(float*)0;
}
static void apply_points_at(uint32_t pp,uint32_t pc,uint32_t* pi,uint32_t sample){
  while(*pi<pc){uint32_t p=pp+(*pi)*24u,off=rd32(p+4);if(off>sample)break;if(off==sample)apply_param(rd32(p),rdf64(p+8));(*pi)++;}
}
#define SORAOTO_NO_POINT 0xffffffffu
typedef struct {uint32_t next_index;uint32_t anchor_sample;float anchor_norm;} SoraotoParamRampV1;
static uint32_t soraoto_find_next_param_point(uint32_t pp,uint32_t pc,uint32_t start,uint32_t id){
  for(uint32_t i=start;i<pc;i++){uint32_t p=pp+i*24u;if(rd32(p)==id)return i;}return SORAOTO_NO_POINT;
}
static void soraoto_init_param_ramps(uint32_t pp,uint32_t pc,SoraotoParamRampV1* ramps){
  for(uint32_t slot=0;slot<PLUGIN_PARAM_COUNT;slot++){
    ramps[slot].anchor_sample=0;ramps[slot].anchor_norm=soraoto_param_norm[slot];
    ramps[slot].next_index=soraoto_find_next_param_point(pp,pc,0,soraoto_param_ids[slot]);
  }
}
static void soraoto_apply_param_ramps_at(uint32_t pp,uint32_t pc,SoraotoParamRampV1* ramps,uint32_t sample){
  for(uint32_t slot=0;slot<PLUGIN_PARAM_COUNT;slot++){
    SoraotoParamRampV1* r=&ramps[slot];
    while(r->next_index!=SORAOTO_NO_POINT){
      uint32_t p=pp+r->next_index*24u,off=rd32(p+4);if(off>sample)break;
      double n=rdf64(p+8);if(!(n==n))n=0;if(n<0)n=0;if(n>1)n=1;
      apply_param_slot(slot,n);r->anchor_sample=off;r->anchor_norm=(float)n;
      r->next_index=soraoto_find_next_param_point(pp,pc,r->next_index+1u,soraoto_param_ids[slot]);
    }
    if(soraoto_param_interpolation[slot]&&r->next_index!=SORAOTO_NO_POINT){
      uint32_t p=pp+r->next_index*24u,end=rd32(p+4);
      if(end>sample&&end>r->anchor_sample){
        double target=rdf64(p+8);if(!(target==target))target=0;if(target<0)target=0;if(target>1)target=1;
        double t=(double)(sample-r->anchor_sample)/(double)(end-r->anchor_sample);
        apply_param_slot(slot,(double)r->anchor_norm+(target-(double)r->anchor_norm)*t);
      }
    }
  }
}
#if PLUGIN_IS_INSTRUMENT
static void apply_events_at(uint32_t ep,uint32_t ec,uint32_t* ei,uint32_t sample){
  while(*ei<ec){uint32_t p=ep+(*ei)*64u,off=rd32(p+12);if(off>sample)break;if(off==sample){
    uint16_t kind=*(uint16_t*)(uintptr_t)p;uint64_t event_id=rd64(p+16);int note_id=(int)(uint32_t)event_id;
    if(kind==SORAOTO_EVENT_NOTE_ON)dsp_note_on(note_id,(float)rdf64(p+24),rdf32(p+32),0);
    else if(kind==SORAOTO_EVENT_NOTE_OFF)dsp_note_off(note_id,rdf32(p+32),0);
    else if(kind==SORAOTO_EVENT_NOTE_EXPRESSION){uint32_t xid=rd32(p+24);int dk=-1;if(xid==1)dk=1;else if(xid==2)dk=2;else if(xid==3)dk=3;else if(xid==4)dk=0;else if(xid==5)dk=4;if(dk>=0)dsp_note_expression(note_id,dk,(float)rdf64(p+32),0);}
  }(*ei)++;}
}
#endif

int32_t soraoto_plugin_process(int32_t process_block_ptr){
  if(soraoto_state!=ST_PROCESSING)return SORAOTO_E_BAD_STATE;if(process_block_ptr<=0)return SORAOTO_E_INVALID_ARGUMENT;
  uint32_t pb=(uint32_t)process_block_ptr;if(rd32(pb)<176||rd32(pb+4)!=SORAOTO_ABI_VERSION)return SORAOTO_E_INVALID_ARGUMENT;
  uint32_t frames=rd32(pb+8),inb=rd32(pb+16),inc=rd32(pb+20),outb=rd32(pb+24),outc=rd32(pb+28),ep=rd32(pb+32),ec=rd32(pb+36),pp=rd32(pb+56),pc=rd32(pb+60);
  if(outc<1)return SORAOTO_E_INCOMPATIBLE_LAYOUT;
  float* outL=bus_channel(outb,outc,0,0),*outR=bus_channel(outb,outc,0,1);if(!outL||!outR)return SORAOTO_E_INVALID_ARGUMENT;
  uint32_t pi=0;SoraotoParamRampV1 ramps[(PLUGIN_PARAM_COUNT>0)?PLUGIN_PARAM_COUNT:1];
#if PLUGIN_IS_INSTRUMENT
  uint32_t ei=0;
  if(frames==0){apply_points_at(pp,pc,&pi,0);apply_events_at(ep,ec,&ei,0);return SORAOTO_OK;}
  soraoto_init_param_ramps(pp,pc,ramps);
  for(uint32_t i=0;i<frames;i++){soraoto_apply_param_ramps_at(pp,pc,ramps,i);apply_events_at(ep,ec,&ei,i);dsp_process(1,outL+i,outR+i);}
#else
  float* inL=bus_channel(inb,inc,0,0),*inR=bus_channel(inb,inc,0,1);if(!inL||!inR)return SORAOTO_E_INCOMPATIBLE_LAYOUT;
  float* sideL=inL,*sideR=inR;
#if PLUGIN_INPUT_BUS_COUNT > 1
  sideL=bus_channel(inb,inc,1,0);sideR=bus_channel(inb,inc,1,1);if(!sideL||!sideR)return SORAOTO_E_INCOMPATIBLE_LAYOUT;
#endif
  if(frames==0){apply_points_at(pp,pc,&pi,0);return SORAOTO_OK;}
  soraoto_init_param_ramps(pp,pc,ramps);
  for(uint32_t i=0;i<frames;i++){soraoto_apply_param_ramps_at(pp,pc,ramps,i);dsp_process(1,inL+i,inR+i,sideL+i,sideR+i,outL+i,outR+i);}
#endif
  wr32(pb+48,0);wr32(pb+72,0);wr32(pb+112,0);wr32(pb+128,0);wr32(pb+148,0);wr32(pb+152,0);wr32(pb+168,0);return SORAOTO_OK;
}

int32_t soraoto_plugin_state_snapshot(int32_t dst_ptr,int32_t capacity){
  if(soraoto_state<ST_CONFIGURED||soraoto_state>ST_PROCESSING)return SORAOTO_E_BAD_STATE;uint32_t need=8u+PLUGIN_PARAM_COUNT*4u;
  if(!dst_ptr&&!capacity)return (int32_t)need;if(dst_ptr<=0||capacity<(int32_t)need)return SORAOTO_E_BUFFER_TOO_SMALL;
  uint32_t p=(uint32_t)dst_ptr;wr32(p,0x3154534du);wr32(p+4,PLUGIN_PARAM_COUNT);for(uint32_t i=0;i<PLUGIN_PARAM_COUNT;i++)*(float*)(uintptr_t)(p+8+i*4)=soraoto_param_norm[i];return (int32_t)need;
}
int32_t soraoto_plugin_state_load(int32_t src_ptr,int32_t len,int32_t context_ptr,int32_t context_len){
  (void)context_ptr;(void)context_len;if(soraoto_state!=ST_CONFIGURED&&soraoto_state!=ST_ACTIVE)return SORAOTO_E_BAD_STATE;uint32_t need=8u+PLUGIN_PARAM_COUNT*4u;
  if(src_ptr<=0||(uint32_t)len!=need)return SORAOTO_E_STATE_INCOMPATIBLE;uint32_t p=(uint32_t)src_ptr;if(rd32(p)!=0x3154534du||rd32(p+4)!=PLUGIN_PARAM_COUNT)return SORAOTO_E_STATE_INCOMPATIBLE;
  for(uint32_t i=0;i<PLUGIN_PARAM_COUNT;i++)apply_param(soraoto_param_ids[i],*(float*)(uintptr_t)(p+8+i*4));return SORAOTO_OK;
}
int32_t soraoto_plugin_latency_samples(void){
#ifdef PLUGIN_HAS_DYNAMIC_LATENCY
  return dsp_latency_samples();
#else
  return 0;
#endif
}
int64_t soraoto_plugin_tail_samples(void){
#ifdef PLUGIN_HAS_DYNAMIC_TAIL
  return dsp_tail_samples();
#else
  return 0;
#endif
}

#endif
