import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import run_stage2d_velocity_hardness as stage2d  # noqa: E402
from constraints import STAGE2B_CONSTRAINT_KEYS  # noqa: E402


def make_row(center, amount, *, post=6.0, dynamic=6.0, brightness=0.1, valid=True):
    constraints = {key: 0.0 for key in STAGE2B_CONSTRAINT_KEYS}
    constraints.update({
        "post_attack_shape_violation_db": post,
        "dynamic_span_violation_db": dynamic,
        "brightness_direction_violation": brightness,
        "stage2b_violation": max(post, dynamic, brightness),
    })
    return {
        "centerKey": center,
        "amount": amount,
        "constraints": constraints,
        "measurementValid": valid,
        "result": {
            "measurement": {"invalidCount": 0 if valid else 1},
            "stage1Metrics": {"finite": True, "guardHits": 0},
            "stage2Metrics": {"finite": True, "guardHits": 0},
            "metrics": {"directProxy": {"finite": True, "guardHitTotal": 0}},
        },
    }


class Stage2DVelocityHardnessTests(unittest.TestCase):
    def test_search_resolves_both_centers_and_declares_exact_budget(self):
        search = stage2d.read_json(stage2d.SEARCH_PATH)
        stage2d.validate_search(search)
        self.assertEqual([center["candidateId"] for center in search["oatCenters"]],
                         ["split-v3-s2-0002", "split-v3-s2-0001"])
        self.assertEqual(search["oatCenters"][1]["resolvedFromCandidateId"], "stage2b-v1-0001")
        self.assertEqual(search["blockModeBudget"]["maxPhysicalCandidates"], 25)

    def test_stage2b_constraints_use_one_fixed_order(self):
        stage = {
            "referenceFitLoss": 0.5, "brightnessRatio": 1.3, "peakDbfs": -1,
            "guardHits": 0, "measurementInvalidCount": 0, "lowRegisterBuzz": 0.1,
            "pitchErrorsCents": [1.0], "finite": True,
            "harmonicSparsity": {"h2ToH1": 0.3, "h3ToH1": 0.2},
        }
        direct = {
            "postAttackShape": {"maxViolationDb": 2.0}, "dynamicSpan": {"maxViolationDb": 3.0},
            "brightnessDirection": {"minimumDirectionMargin": -0.1},
            "directLevel": {"maxViolationDb": 1.0}, "peakWorstDbfs": -1.0,
            "guardHitTotal": 0, "finite": True,
        }
        passed = stage2d.constraint_vector(stage, stage, direct)
        self.assertEqual(tuple(passed), STAGE2B_CONSTRAINT_KEYS)
        direct["finite"] = False
        failed = stage2d.constraint_vector(stage, stage, direct)
        self.assertEqual(tuple(failed), STAGE2B_CONSTRAINT_KEYS)
        self.assertGreater(failed["stage2b_violation"], 0.0)

    def test_flattened_oat_report_checks_actual_direct_proxy_metrics(self):
        row = {
            "measurement": {"invalidCount": 0},
            "stage1Metrics": {"finite": True, "guardHits": 0},
            "stage2Metrics": {"finite": True, "guardHits": 0},
            "metrics": {"directProxy": {"finite": True, "guardHitTotal": 0}},
        }
        self.assertTrue(stage2d.row_is_measurement_valid(row))
        row["metrics"]["directProxy"]["guardHitTotal"] = 1
        self.assertFalse(stage2d.row_is_measurement_valid(row))

    def test_authority_requires_all_three_families_across_two_centers(self):
        rows = []
        for center in ("center-a", "center-b"):
            for amount in (0.0, 0.25, 0.5, 0.75, 1.0):
                rows.append(make_row(center, amount))
        rows.extend([
            make_row("center-a", 0.25, post=3.4, dynamic=3.9),
            make_row("center-a", 0.5, post=5.8, dynamic=3.9),
            make_row("center-b", 0.5, brightness=0.0),
        ])
        result = stage2d.authority_decision(rows)
        self.assertEqual(result["decision"], "VELOCITY_HARDNESS_AXIS_AUTHORIZED")
        self.assertTrue(all(family["demonstrated"] for family in result["families"].values()))

    def test_partial_authority_blocks_gp_and_invalid_probes_do_not_count(self):
        rows = [make_row(center, amount) for center in ("center-a", "center-b")
                for amount in (0.0, 0.25, 0.5, 0.75, 1.0)]
        rows.extend([
            make_row("center-a", 0.25, post=1.0, dynamic=4.0, valid=False),
            make_row("center-a", 0.5, post=1.0, dynamic=4.1),
            make_row("center-b", 0.5, brightness=0.0),
        ])
        partial = stage2d.authority_decision(rows)
        self.assertEqual(partial["decision"], "BLOCKED_PARTIAL_VELOCITY_HARDNESS_AUTHORITY")
        self.assertTrue(partial["families"]["post_attack"]["demonstrated"])
        self.assertFalse(partial["families"]["dynamic_span"]["demonstrated"])
        self.assertTrue(partial["families"]["brightness_direction"]["demonstrated"])

    def test_no_authority_has_a_separate_stop_reason(self):
        rows = [make_row(center, amount) for center in ("center-a", "center-b")
                for amount in (0.0, 0.25, 0.5, 0.75, 1.0)]
        result = stage2d.authority_decision(rows)
        self.assertEqual(result["decision"], "BLOCKED_VELOCITY_HARDNESS_AXIS_INSUFFICIENT")
        self.assertFalse(result["authorized"])


if __name__ == "__main__":
    unittest.main()
