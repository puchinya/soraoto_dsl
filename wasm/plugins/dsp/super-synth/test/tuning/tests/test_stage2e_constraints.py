from __future__ import annotations

import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from constraints import STAGE2E_CONSTRAINT_KEYS, stage2e_constraints


def valid_metrics():
    metrics = {
        "brightnessRatio": 1.30,
        "peakDbfs": -3.0,
        "guardHits": 0,
        "measurementInvalidCount": 0,
        "lowRegisterBuzz": 0.10,
        "pitchErrorsCents": [1.0, -2.0],
        "harmonicSparsity": {"h2ToH1": 0.2, "h3ToH1": 0.1},
        "finite": True,
    }
    direct = {
        "postAttackShape": {"maxViolationDb": -1.0},
        "dynamicSpan": {"maxViolationDb": -1.0},
        "brightnessDirection": {"minimumDirectionMargin": 0.1},
        "directLevel": {"maxViolationDb": -2.0},
        "peakWorstDbfs": -3.0,
        "guardHitTotal": 0,
        "finite": True,
    }
    held = {
        "heldDecayRatio": 0.7,
        "releaseTail1": 0.001,
        "releaseTail2": 0.0003,
        "releaseTail3": 0.00001,
        "releaseTail3To2Ratio": 0.00001 / 0.0003,
        "finiteRelease": True,
        "stuckVoiceCount": 0,
    }
    topology = {"pianoStringUnison": 0.58, "pianoSoundboardMix": 1.0}
    return metrics, direct, held, topology


class Stage2EConstraintsTests(unittest.TestCase):
    def test_fixed_order_and_feasible_signs(self):
        metrics, direct, held, topology = valid_metrics()
        constraints = stage2e_constraints(metrics, metrics, direct, held, topology)
        self.assertEqual(tuple(constraints), STAGE2E_CONSTRAINT_KEYS)
        self.assertTrue(all(value <= 0 for value in constraints.values()))

    def test_held_decay_limits_are_strict(self):
        metrics, direct, held, topology = valid_metrics()
        held["heldDecayRatio"] = 0.401
        self.assertLessEqual(stage2e_constraints(metrics, metrics, direct, held, topology)["held_decay_ratio_violation"], 0)
        held["heldDecayRatio"] = 0.40
        self.assertGreater(stage2e_constraints(metrics, metrics, direct, held, topology)["held_decay_ratio_violation"], 0)
        held["heldDecayRatio"] = 0.399
        self.assertGreater(stage2e_constraints(metrics, metrics, direct, held, topology)["held_decay_ratio_violation"], 0)
        held["heldDecayRatio"] = 1.02
        self.assertGreater(stage2e_constraints(metrics, metrics, direct, held, topology)["held_decay_ratio_violation"], 0)
        held["heldDecayRatio"] = 1.019
        self.assertLessEqual(stage2e_constraints(metrics, metrics, direct, held, topology)["held_decay_ratio_violation"], 0)
        held["heldDecayRatio"] = 1.021
        self.assertGreater(stage2e_constraints(metrics, metrics, direct, held, topology)["held_decay_ratio_violation"], 0)
        held["heldDecayRatio"] = 0.7
        held["releaseTail1"] = 0.000301
        held["releaseTail2"] = 0.000151
        held["releaseTail3"] = 0.00001
        held["releaseTail3To2Ratio"] = held["releaseTail3"] / held["releaseTail2"]
        result = stage2e_constraints(metrics, metrics, direct, held, topology)
        self.assertLessEqual(result["release_tail1_min_violation"], 0)
        self.assertLessEqual(result["release_tail2_min_violation"], 0)
        held["releaseTail1"] = 0.0003
        held["releaseTail2"] = 0.00015
        held["releaseTail3"] = 0.00001
        held["releaseTail3To2Ratio"] = held["releaseTail3"] / held["releaseTail2"]
        result = stage2e_constraints(metrics, metrics, direct, held, topology)
        self.assertGreater(result["release_tail1_min_violation"], 0)
        self.assertGreater(result["release_tail2_min_violation"], 0)

    def test_release_minima_ratio_finite_and_stuck_constraints(self):
        metrics, direct, held, topology = valid_metrics()
        held["releaseTail1"] = 0.0003
        held["releaseTail2"] = 0.00015
        held["releaseTail3"] = 0.55 * held["releaseTail2"]
        held["releaseTail3To2Ratio"] = 0.55
        result = stage2e_constraints(metrics, metrics, direct, held, topology)
        self.assertGreater(result["release_tail1_min_violation"], 0)
        self.assertGreater(result["release_tail2_min_violation"], 0)
        self.assertGreater(result["release_tail_decay_ratio_violation"], 0)
        held["releaseTail1"] = 0.000299
        held["releaseTail2"] = 0.000149
        held["releaseTail3"] = 0.000083
        held["releaseTail3To2Ratio"] = held["releaseTail3"] / held["releaseTail2"]
        held["finiteRelease"] = False
        held["stuckVoiceCount"] = 1
        result = stage2e_constraints(metrics, metrics, direct, held, topology)
        self.assertGreater(result["release_tail1_min_violation"], 0)
        self.assertGreater(result["release_tail2_min_violation"], 0)
        self.assertGreater(result["release_finite_violation"], 0)
        self.assertGreater(result["stuck_voice_violation"], 0)

    def test_release_ratio_must_match_measured_tails(self):
        metrics, direct, held, topology = valid_metrics()
        held["releaseTail3To2Ratio"] *= 1.1
        with self.assertRaisesRegex(ValueError, "must agree"):
            stage2e_constraints(metrics, metrics, direct, held, topology)

    def test_existing_grand_topology_gate_is_measured_without_extending_schema(self):
        metrics, direct, held, topology = valid_metrics()
        topology["pianoStringUnison"] = 0.4
        exact = stage2e_constraints(metrics, metrics, direct, held, topology)
        self.assertLessEqual(exact["stage2b_violation"], 0)
        topology["pianoStringUnison"] = 0.399
        below = stage2e_constraints(metrics, metrics, direct, held, topology)
        self.assertGreater(below["stage2b_violation"], 0)
        self.assertEqual(tuple(below), STAGE2E_CONSTRAINT_KEYS)


if __name__ == "__main__":
    unittest.main()
