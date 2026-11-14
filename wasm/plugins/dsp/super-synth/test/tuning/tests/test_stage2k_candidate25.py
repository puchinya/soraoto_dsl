from __future__ import annotations

import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[7]
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
TOOLS = ROOT / "wasm/plugins/dsp/super-synth/test/tools"
sys.path.insert(0, str(TUNING))
import complete_stage2k_candidate25 as stage2k  # noqa: E402
from constraints import STAGE2E_CONSTRAINT_KEYS  # noqa: E402


class Stage2KArtifactTests(unittest.TestCase):
    def test_matching_wasm_hash_is_accepted_and_one_byte_mismatch_blocks(self):
        with tempfile.TemporaryDirectory() as temporary:
            wasm = Path(temporary) / "plugin.wasm"
            wasm.write_bytes(b"candidate-25")
            expected = stage2k.sha256_file(wasm)
            self.assertEqual(stage2k.verify_wasm_hash(wasm, expected), expected)
            wasm.write_bytes(b"candidate-26")
            with self.assertRaisesRegex(stage2k.Stage2KError, "BLOCKED_CANDIDATE25_ARTIFACT_UNAVAILABLE"):
                stage2k.verify_wasm_hash(wasm, expected)

    def test_partial_measurements_require_exact_artifact_and_tool_identities(self):
        acoustic = {"candidateId": "candidate-25", "wasmSha256": "a" * 64}
        tools = {"metricDefinition": stage2k.METRIC_DEFINITION,
                 "heldReleaseExtractorSha256": "b" * 64,
                 "c8CaptureSha256": "c" * 64,
                 "stage3MetricDefinitionSha256": "d" * 64}
        with tempfile.TemporaryDirectory() as temporary:
            partial_path = Path(temporary) / "held.json"
            partial_path.write_text(json.dumps({"acousticArtifactIdentity": acoustic,
                                                "measurementToolIdentity": tools,
                                                "metrics": {"heldDecayRatio": 0.5}}))
            self.assertEqual(stage2k.load_matching_partial(partial_path, acoustic, tools)["metrics"]["heldDecayRatio"], 0.5)
            with self.assertRaisesRegex(stage2k.Stage2KError, "PARTIAL_IDENTITY"):
                stage2k.load_matching_partial(partial_path, {**acoustic, "wasmSha256": "c" * 64}, tools)
            with self.assertRaisesRegex(stage2k.Stage2KError, "PARTIAL_TOOL_IDENTITY"):
                stage2k.load_matching_partial(partial_path, acoustic, {**tools, "heldReleaseExtractorSha256": "e" * 64})


class Stage2KHeldReleaseTests(unittest.TestCase):
    def test_standalone_extractor_conformance(self):
        result = subprocess.run(["rtk", "node", str(TOOLS / "capture-stage2k-held-release.cjs"), "--self-test"],
                                cwd=ROOT, text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)["status"], "PASS")

    def test_helper_does_not_call_full_concert_grand_regression(self):
        source = (ROOT / "wasm/plugins/dsp/super-synth/test/tools/capture-stage2k-held-release.cjs").read_text()
        self.assertNotIn("concert-grand-regression.test.js", source)


class Stage2KConstraintTests(unittest.TestCase):
    @staticmethod
    def base_metrics():
        metrics = {
            "brightnessRatio": 1.4,
            "peakDbfs": -3.0,
            "guardHits": 0,
            "measurementInvalidCount": 0,
            "lowRegisterBuzz": 0.1,
            "pitchErrorsCents": [0.0],
            "finite": True,
            "harmonicSparsity": {"h2ToH1": 0.2, "h3ToH1": 0.1},
        }
        return metrics

    def test_all_32_constraints_are_finite_ordered_and_keep_positive_stage2b_fails(self):
        stage1 = self.base_metrics()
        stage2 = self.base_metrics()
        direct = {
            "postAttackShape": {"maxViolationDb": 2.10144},
            "dynamicSpan": {"maxViolationDb": 3.528952},
            "brightnessDirection": {"minimumDirectionMargin": 0.3},
            "directLevel": {"maxViolationDb": -2.0},
            "peakWorstDbfs": -3.0,
            "guardHitTotal": 0,
            "finite": True,
        }
        held_release = {
            "heldDecayRatio": 0.5,
            "releaseTail1": 0.001,
            "releaseTail2": 0.0001,
            "releaseTail3": 0.0002,
            "releaseTail3To2Ratio": 2.0,
            "finiteRelease": True,
            "stuckVoiceCount": 0,
        }
        ordinary = {"stage1Metrics": stage1, "stage2Metrics": stage2,
                    "metrics": {"directProxy": direct}}
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            preset_dir = source / "wasm/plugins/dsp/super-synth"
            preset_dir.mkdir(parents=True)
            (preset_dir / "presets.json").write_text(json.dumps({"concert_grand": {
                "piano_string_unison": 0.9, "piano_soundboard_mix": 0.62}}))
            held_release["releaseTail3To2Ratio"] = held_release["releaseTail3"] / held_release["releaseTail2"]
            constraints = stage2k.combine_constraints(ordinary, held_release, source)
        self.assertEqual(tuple(constraints), STAGE2E_CONSTRAINT_KEYS)
        self.assertEqual(len(constraints), 32)
        self.assertTrue(all(math.isfinite(value) for value in constraints.values()))
        self.assertGreater(constraints["post_attack_shape_violation_db"], 0)
        self.assertGreater(constraints["dynamic_span_violation_db"], 0)
        self.assertGreater(constraints["release_tail2_min_violation"], 0)

    def test_c8_requires_exact_five_diagnostic_only_variants(self):
        names = ["normal", "board_off", "board_off_no_dry_transverse",
                 "board_off_no_dry_bridge", "board_off_no_dry_contact"]
        row = {"earlyResidualDb": 1.0, "lateResidualDb": 2.0, "postAttackShapeErrorDb": 3.0}
        result = {"candidateId": "candidate-25", "wasmSha256": "a" * 64,
                  "variantNames": names, "variants": [{"name": name, **row} for name in names],
                  "diagnosticOnly": True, "stage2PromotionEvidence": False}
        stage2k.validate_c8_result(result, "candidate-25", "a" * 64)
        result["stage2PromotionEvidence"] = True
        with self.assertRaisesRegex(stage2k.Stage2KError, "C8_PROMOTION"):
            stage2k.validate_c8_result(result, "candidate-25", "a" * 64)

    def test_fixed_candidate_budget_never_increments(self):
        source = (TUNING / "complete_stage2k_candidate25.py").read_text()
        self.assertIn('"candidateCountDelta": 0', source)
        self.assertIn('"physicalBudgetAfter": 25', source)
        self.assertIn("STAGE2_CURRENT_HEAD_FAIL", source)


if __name__ == "__main__":
    unittest.main()
