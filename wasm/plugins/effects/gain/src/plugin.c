static float gain_value = 1.0f;
static void dsp_init(int sample_rate, int max_block_size) { (void)sample_rate; (void)max_block_size; gain_value = 1.0f; }
static void dsp_reset(void) { gain_value = 1.0f; }
static void dsp_set_parameter(int id, float value, int sample_offset) { (void)sample_offset; if (id == 0) gain_value = value; }
static void dsp_process(int frames, float* inL, float* inR, float* sideL, float* sideR, float* outL, float* outR) {
  (void)sideL; (void)sideR;
  for (int i=0;i<frames;i++) { outL[i]=inL[i]*gain_value; outR[i]=inR[i]*gain_value; }
}

#include "plugin_abi_runtime.h"
