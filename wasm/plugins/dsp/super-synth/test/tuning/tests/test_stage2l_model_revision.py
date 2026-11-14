import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


PLUGIN = pathlib.Path(__file__).resolve().parents[3]
ROOT = PLUGIN.parents[3]
SPACE = PLUGIN / "test/tuning/stage2l-model-revision-search-space.json"
SOURCE = PLUGIN / "src/plugin.c"
MATH_HEADER = PLUGIN / "src/grand_loss_math.h"
PRESETS = PLUGIN / "presets.json"
METADATA = PLUGIN.parents[2] / "cmake/super_synth_metadata.py"
TUNING = PLUGIN / "test/tuning"
sys.path.insert(0, str(TUNING))
import stage2l_policy as stage2l  # noqa: E402


class Stage2LModelRevisionTests(unittest.TestCase):
    def test_profile_revision_and_preset_schema_match_contract(self):
        config = json.loads(PRESETS.read_text(encoding="utf-8"))["concert_grand"]["engine_config"]
        self.assertEqual(config["kind"], "grand_piano_v1")
        self.assertEqual(config["revision"], 3)
        string = config["string"]
        self.assertEqual(string["decay_reference_midi"], 60.0)
        self.assertEqual(string["reference_loss_base"], 0.0019965984251968504)
        self.assertNotIn("reference_loss_velocity_base", string)
        self.assertNotIn("reference_loss_velocity_scale", string)
        metadata = METADATA.read_text(encoding="utf-8")
        schema = metadata.split("_GRAND_PROFILE_SCHEMA={", 1)[1].split("\n}", 1)[0]
        self.assertIn("'decay_reference_midi'", schema)
        self.assertNotIn("reference_loss_velocity_base", schema)
        self.assertNotIn("reference_loss_velocity_scale", schema)
        self.assertIn("GRAND_PROFILE_REVISION=3", metadata)

    def test_candidate_budget_and_search_dimensions_are_frozen(self):
        search = json.loads(SPACE.read_text(encoding="utf-8"))
        self.assertEqual(search["modelRevision"], 2)
        self.assertEqual(search["maximumCandidateIdentities"], 12)
        self.assertEqual(search["candidateBudget"]["remainingGPSamplerCandidates"], 11)
        self.assertEqual({row["name"] for row in search["dimensions"]}, {
            "effective_strike_position_c4", "hammer.compression_scale", "piano_hammer_hardness",
            "piano_inharmonicity", "piano_string_damping", "piano_string_unison",
            "hammer.velocity_hardness_amount",
        })
        self.assertNotIn("termination_loss_floor_scale", {row["name"] for row in search["dimensions"]})

    def test_loss_math_header_matches_host_pow_over_supported_domain(self):
        compiler = shutil.which("cc") or shutil.which("clang") or shutil.which("gcc")
        if compiler is None:
            self.skipTest("host C compiler unavailable")
        test_source = r'''#include <math.h>
#include <stdio.h>
#include "grand_loss_math.h"
int main(void) {
  float worst=0.0f;
  for (int gi=0;gi<=140;gi++) {
    float gain=0.93f+(0.9998f-0.93f)*(float)gi/140.0f;
    for (int pitch=21;pitch<=108;pitch++) {
      float exponent=powf(2.0f,(60.0f-(float)pitch)/12.0f);
      float expected=powf(gain,exponent);
      float actual=grand_loss_time_normalize(gain,(float)pitch,60.0f);
      float error=fabsf(actual-expected);
      if(error>worst)worst=error;
      if(!(actual>=0.0f&&actual<=1.0f))return 2;
    }
  }
  printf("worst_error=%.9g\n",(double)worst);
  return worst<=5e-5f?0:1;
}
'''
        with tempfile.TemporaryDirectory(prefix="stage2l-loss-math-") as temp:
            c_path = pathlib.Path(temp) / "check.c"
            exe_path = pathlib.Path(temp) / "check"
            c_path.write_text(test_source, encoding="utf-8")
            subprocess.run([compiler, "-std=c99", "-O2", "-I", str(MATH_HEADER.parent),
                            str(c_path), "-lm", "-o", str(exe_path)], check=True, capture_output=True, text=True)
            result = subprocess.run([str(exe_path)], check=True, capture_output=True, text=True)
        worst = float(result.stdout.strip().split("=", 1)[1])
        self.assertLessEqual(worst, 5e-5)

    def test_cache_refresh_is_outside_sample_loop_and_damping_only_refreshes_cache(self):
        source = SOURCE.read_text(encoding="utf-8")
        step = source.split("static float grand_strings_step(", 1)[1].split("static inline float grand_hammer_launch_velocity", 1)[0]
        self.assertNotIn("grand_loss_", step)
        self.assertIn("grand_refresh_string_loss_cache(&g_voices[i])", source)
        self.assertIn("grand_string_prepared_pitch", source)
        self.assertIn("q->amp_stage==3?q->grand_bridge_released_gain:q->grand_bridge_held_gain", step)
        self.assertNotIn("reference_loss_velocity_base", source)
        self.assertNotIn("reference_loss_velocity_scale", source)

    def test_velocity_hardness_uses_continuous_pivot_mapping(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("if(v<=pivot){", source)
        self.assertIn("return h*(1.0f-amount*t);", source)
        self.assertIn("return h+(1.0f-h)*amount*t;", source)
        self.assertIn("grand_effective_felt_hardness(g_params[P_PIANO_HAMMER_HARDNESS],q->velocity,g_grand_config.hammer.velocity_hardness_amount)", source)

    def test_candidate1_direction_gate_requires_both_improvements_and_no_new_safety(self):
        baseline = {
            "post_attack_shape_violation_db": 2.0,
            "dynamic_span_violation_db": 3.5,
            "stage1_violation": 3.5,
            "stage2_violation": 3.5,
            "stage2b_violation": 3.5,
            "direct_peak_violation_dbfs": -1.0,
        }
        self.assertTrue(stage2l.direction_result(baseline)["pass"])
        baseline["dynamic_span_violation_db"] = 3.528952
        self.assertFalse(stage2l.direction_result(baseline)["pass"])
        baseline["dynamic_span_violation_db"] = 3.5
        baseline["direct_peak_violation_dbfs"] = 0.01
        self.assertFalse(stage2l.direction_result(baseline)["pass"])


if __name__ == "__main__":
    unittest.main()
