import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from constraints import (DETAIL_CONSTRAINT_KEYS, STAGE1_CONSTRAINT_KEYS, STAGE2_CONSTRAINT_KEYS,
                         STAGE2B_CONSTRAINT_KEYS, measured_constraints, stage1_constraints,
                         stage2_constraints, stage2b_constraints)  # noqa: E402


def metrics(**updates):
    value = {
        "brightnessRatio": 1.30,
        "peakDbfs": -1.0,
        "guardHits": 0,
        "measurementInvalidCount": 0,
        "lowRegisterBuzz": 0.10,
        "pitchErrorsCents": [-4.0, 8.0],
        "finite": True,
        "harmonicSparsity": {"h2ToH1": 0.30, "h3ToH1": 0.20},
    }
    value.update(updates)
    return value


class ConstraintBoundaryTests(unittest.TestCase):
    def assert_signed(self, updates, name, expected_sign):
        result = measured_constraints(metrics(**updates))[name]
        if expected_sign == "pass":
            self.assertLessEqual(result, 0.0, (name, result))
        else:
            self.assertGreater(result, 0.0, (name, result))

    def test_brightness_strict_minimum(self):
        self.assert_signed({"brightnessRatio": 1.25 + 1e-9}, "brightness_violation", "pass")
        self.assert_signed({"brightnessRatio": 1.25}, "brightness_violation", "fail")
        self.assert_signed({"brightnessRatio": 1.25 - 1e-9}, "brightness_violation", "fail")

    def test_peak_strict_maximum(self):
        self.assert_signed({"peakDbfs": -1e-9}, "peak_violation", "pass")
        self.assert_signed({"peakDbfs": 0.0}, "peak_violation", "fail")
        self.assert_signed({"peakDbfs": 1e-9}, "peak_violation", "fail")

    def test_guard_zero_requirement(self):
        self.assert_signed({"guardHits": 0}, "guard_violation", "pass")
        self.assert_signed({"guardHits": 1}, "guard_violation", "fail")

    def test_pitch_inclusive_boundary(self):
        self.assert_signed({"pitchErrorsCents": [15.0]}, "pitch_violation", "pass")
        self.assert_signed({"pitchErrorsCents": [15.0 + 1e-9]}, "pitch_violation", "fail")

    def test_measurement_invalid_count(self):
        self.assert_signed({"measurementInvalidCount": 0}, "measurement_invalid", "pass")
        self.assert_signed({"measurementInvalidCount": 1}, "measurement_invalid", "fail")

    def test_finite_output(self):
        self.assert_signed({"finite": True}, "finite_violation", "pass")
        self.assert_signed({"finite": False}, "finite_violation", "fail")

    def test_buzz_strict_maximum(self):
        self.assert_signed({"lowRegisterBuzz": 0.12 - 1e-9}, "buzz_violation", "pass")
        self.assert_signed({"lowRegisterBuzz": 0.12}, "buzz_violation", "fail")
        self.assert_signed({"lowRegisterBuzz": 0.12 + 1e-9}, "buzz_violation", "fail")

    def test_harmonic_sparsity_strict_minima(self):
        self.assert_signed({"harmonicSparsity": {"h2ToH1": 0.12 + 1e-9, "h3ToH1": 0.05 + 1e-9}}, "sparsity_violation", "pass")
        self.assert_signed({"harmonicSparsity": {"h2ToH1": 0.12, "h3ToH1": 0.05 + 1e-9}}, "sparsity_violation", "fail")
        self.assert_signed({"harmonicSparsity": {"h2ToH1": 0.12 + 1e-9, "h3ToH1": 0.05}}, "sparsity_violation", "fail")

    def test_aggregate_and_stage_labels(self):
        failing = metrics(brightnessRatio=1.20)
        first = stage1_constraints(failing)
        second = stage2_constraints(failing)
        self.assertGreater(first["stage1_violation"], 0.0)
        self.assertGreater(second["stage2_violation"], 0.0)
        self.assertEqual(first["stage1_violation"], max(v for k, v in first.items() if k != "stage1_violation"))

    def test_stage_schemas_are_fixed_disjoint_and_ordered(self):
        self.assertEqual(tuple(measured_constraints(metrics())), DETAIL_CONSTRAINT_KEYS)
        self.assertEqual(tuple(stage1_constraints(metrics())), STAGE1_CONSTRAINT_KEYS)
        self.assertEqual(tuple(stage2_constraints(metrics())), (*DETAIL_CONSTRAINT_KEYS, "stage2_violation"))
        self.assertNotIn("stage2_violation", STAGE1_CONSTRAINT_KEYS)
        self.assertEqual(len(STAGE2_CONSTRAINT_KEYS), 2 * len(DETAIL_CONSTRAINT_KEYS) + 2)

    def test_stage2b_has_fixed_extended_schema_and_signed_margins(self):
        stage1 = metrics()
        stage2 = metrics(pitchErrorsCents=[3.0])
        direct = {"postAttackShape": {"maxViolationDb": -1.0},
                  "dynamicSpan": {"maxViolationDb": 2.0},
                  "brightnessDirection": {"minimumDirectionMargin": -.2},
                  "directLevel": {"maxViolationDb": -4.0},
                  "peakWorstDbfs": -2.0, "guardHitTotal": 0, "finite": True}
        result = stage2b_constraints(stage1, stage2, direct)
        self.assertEqual(tuple(result), STAGE2B_CONSTRAINT_KEYS)
        self.assertEqual(result["post_attack_shape_violation_db"], -1.0)
        self.assertEqual(result["dynamic_span_violation_db"], 2.0)
        self.assertEqual(result["brightness_direction_violation"], .2)
        self.assertEqual(result["stage2b_violation"], 2.0)


if __name__ == "__main__":
    unittest.main()
