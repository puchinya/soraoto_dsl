'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../../../');
const source = fs.readFileSync(path.join(root, 'wasm/plugins/dsp/super-synth/src/plugin.c'), 'utf8');
const pivot = 61 / 127;

function feltHardness(hardness, velocity, amount) {
  const h = Math.min(1, Math.max(0, hardness));
  const v = Math.min(1, Math.max(0, velocity));
  if (amount === 0) return h;
  if (v <= pivot) return h * (1 - amount * ((pivot - v) / pivot));
  return h + (1 - h) * amount * ((v - pivot) / (1 - pivot));
}

function run() {
  assert.ok(source.includes('static inline float grand_effective_felt_hardness('));
  assert.ok(source.includes('if(amount==0.0f)return h;'));
  assert.ok(source.includes('const float pivot=61.0f/127.0f;'));
  assert.ok(source.includes('const float t=(pivot-v)/pivot;'));
  assert.ok(source.includes('const float t=(v-pivot)/(1.0f-pivot);'));
  assert.equal((source.match(/grand_effective_felt_hardness\(base_hardness,q->velocity,h->velocity_hardness_amount\)/g) || []).length, 1,
    'the shared contact step must calculate felt hardness once');
  assert.ok(source.includes('grand_contact_power(normalized,h->felt_exponent_hard),felt_hardness'));
  assert.ok(source.includes('h->stiffness_hard,felt_hardness'));
  assert.ok(source.includes('h->contact_loss_hard,felt_hardness'));
  assert.ok(source.includes('h->mass_hard,felt_hardness'));
  assert.ok(source.includes('h->noise_filter_hardness_scale*base_hardness'));
  assert.ok(source.includes('h->noise_gain_hardness_scale*base_hardness'));

  const launchHelper = source.match(/static inline float grand_hammer_launch_velocity\([\s\S]*?\n}/)?.[0];
  assert.ok(launchHelper, 'legacy launch helper must remain shared by note-on and retarget');
  assert.ok(launchHelper.includes('(h->initial_velocity_base+h->initial_velocity_velocity_scale*velocity)'));
  assert.ok(!launchHelper.includes('velocity_hardness_amount'));
  assert.equal((source.match(/grand_hammer_launch_velocity\(h,q->velocity,hard\)/g) || []).length, 2);

  const nativeTest = `
    #include <assert.h>
    #include <math.h>
    #include <string.h>
    typedef struct {
      float force_scale,initial_velocity_base,initial_velocity_velocity_scale;
      float initial_velocity_hardness_base,initial_velocity_hardness_scale;
      float velocity_hardness_amount;
    } GrandHammerConfig;
    static inline float clampf(float x,float low,float high){return x<low?low:(x>high?high:x);}
    ${source.match(/static inline float grand_effective_felt_hardness\([\s\S]*?\n}/)[0]}
    ${launchHelper}
    int main(void){
      const float hs[]={0.0f,0.25f,0.5f,0.75f,1.0f};
      const float as[]={0.0f,0.25f,0.5f,0.75f,1.0f};
      for(unsigned hi=0;hi<5;hi++)for(unsigned ai=0;ai<5;ai++){
        float h=hs[hi],a=as[ai],previous=-1.0f;
        assert(grand_effective_felt_hardness(h,61.0f/127.0f,a)==h);
        for(unsigned midi=0;midi<128;midi++){
          float value=grand_effective_felt_hardness(h,(float)midi/127.0f,a);
          assert(value>=0.0f&&value<=1.0f&&value>=previous); previous=value;
          if(a==0.0f)assert(memcmp(&value,&h,sizeof(float))==0);
        }
        if(a==1.0f){
          assert(grand_effective_felt_hardness(h,0.0f,a)==0.0f);
          assert(grand_effective_felt_hardness(h,1.0f,a)==1.0f);
        }
      }
      GrandHammerConfig config={0};
      config.initial_velocity_base=0.42f;config.initial_velocity_velocity_scale=1.05f;
      config.initial_velocity_hardness_base=0.78f;config.initial_velocity_hardness_scale=0.42f;
      float expected=(config.initial_velocity_base+config.initial_velocity_velocity_scale*(61.0f/127.0f))
        *(config.initial_velocity_hardness_base+config.initial_velocity_hardness_scale*0.85f);
      assert(grand_hammer_launch_velocity(&config,61.0f/127.0f,0.85f)==expected);
      return 0;
    }
  `;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'soraoto-velocity-hardness-'));
  try {
    const cPath = path.join(temp, 'conformance.c');
    const exePath = path.join(temp, 'conformance');
    fs.writeFileSync(cPath, nativeTest);
    execFileSync(process.env.CC || 'cc', ['-std=c11', '-O0', cPath, '-lm', '-o', exePath]);
    execFileSync(exePath);
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }

  const velocities = Array.from({length: 128}, (_, value) => value / 127);
  for (const hardness of [0, 0.25, 0.5, 0.75, 1]) {
    for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
      const values = velocities.map(velocity => feltHardness(hardness, velocity, amount));
      assert.equal(feltHardness(hardness, 61 / 127, amount), hardness, 'pivot must preserve base hardness');
      assert.ok(values.every(value => value >= 0 && value <= 1), 'hardness must stay bounded');
      assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]), 'hardness must be monotonic');
      if (amount === 0) assert.ok(values.every(value => value === hardness), 'amount zero must return exact base hardness');
      if (amount === 1) {
        assert.equal(values[0], 0, 'maximum amount must reach soft endpoint at MIDI 0');
        assert.equal(values[127], 1, 'maximum amount must reach hard endpoint at MIDI 127');
      }
    }
  }
  const launch = (h, velocity) => (0.42 + 1.05 * velocity) * (0.78 + 0.42 * h);
  const launchAcrossAmounts = [0, 0.25, 0.5, 0.75, 1].map(() => launch(0.85, 61 / 127));
  assert.ok(launchAcrossAmounts.every(value => Object.is(value, launchAcrossAmounts[0])),
    'initial launch expression is independent of felt-hardness amount');
  process.stdout.write(JSON.stringify({result: 'PASS', midiVelocities: 128, hardnessValues: 5,
    amounts: 5, pivotInvariant: true, launchIndependent: true}) + '\n');
}

if (require.main === module) run();
module.exports = {run, feltHardness};
