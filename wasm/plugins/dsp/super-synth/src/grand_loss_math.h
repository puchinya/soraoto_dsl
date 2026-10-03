#ifndef SORAOTO_SUPERSYNTH_GRAND_LOSS_MATH_H
#define SORAOTO_SUPERSYNTH_GRAND_LOSS_MATH_H

/* Bounded, freestanding approximation for the cached per-circulation loss
   normalization. Inputs are constrained by the authored profile and MIDI
   range; this is intentionally not a general-purpose math replacement. */
static inline float grand_loss_exp_approx(float x) {
  float x2=x*x;
  return 1.0f+x+x2*(0.5f+x*(0.16666666666666667f+x*(0.041666666666666664f+x*(0.008333333333333333f+x*(0.001388888888888889f+x*(0.0001984126984126984f+x*(0.0000248015873015873f+x*(0.0000027557319223985893f+x*0.0000002755731922398589f))))))));
}

static inline float grand_loss_pow2_approx(float x) {
  if(x < -4.0f)x=-4.0f;
  if(x > 3.25f)x=3.25f;
  int whole=(int)x;
  if((float)whole>x)whole--;
  float fraction=x-(float)whole;
  float value=grand_loss_exp_approx(fraction*0.6931471805599453f);
  if(whole>0)for(int i=0;i<whole;i++)value*=2.0f;
  else for(int i=0;i>whole;i--)value*=0.5f;
  return value;
}

static inline float grand_loss_ln_near_unity(float value) {
  float u=(value-1.0f)/(value+1.0f);
  float u2=u*u;
  return 2.0f*u*(1.0f+u2*(0.3333333333333333f+u2*(0.2f+u2*(0.14285714285714285f+u2*0.1111111111111111f))));
}

static inline float grand_loss_time_normalize(float gain,float pitch,float reference_midi) {
  if(gain<0.0f)gain=0.0f;
  if(gain>1.0f)gain=1.0f;
  if(gain<=0.0f)return 0.0f;
  if(gain>=1.0f)return 1.0f;
  float exponent=grand_loss_pow2_approx((reference_midi-pitch)*(1.0f/12.0f));
  float result=grand_loss_exp_approx(grand_loss_ln_near_unity(gain)*exponent);
  if(result<0.0f)result=0.0f;
  if(result>1.0f)result=1.0f;
  return result;
}

#endif
