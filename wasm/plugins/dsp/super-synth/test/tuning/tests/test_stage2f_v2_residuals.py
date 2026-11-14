import copy
import importlib.util
import json
import math
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[7]
ANALYZER_PATH = ROOT / "wasm/plugins/dsp/super-synth/test/tuning/analyze_stage2f_v2_residuals.py"
SPEC = importlib.util.spec_from_file_location("stage2f_v2_residuals", ANALYZER_PATH)
analyzer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = analyzer
SPEC.loader.exec_module(analyzer)


def cell(early, late, pitch=60, velocity=61):
    render_early, ref_early = early, 0.0
    render_late, ref_late = late, 0.0
    shape = max(abs(early), abs(late))
    return {
        "pitch": pitch, "velocity": velocity,
        "renderEarlyRelDb": render_early, "referenceEarlyRelDb": ref_early,
        "earlyResidualDb": early, "renderLateRelDb": render_late, "referenceLateRelDb": ref_late,
        "lateResidualDb": late, "postAttackShapeErrorDb": shape,
        "postAttackShapeViolationDb": shape - analyzer.POST_LIMIT,
        "dominantResidual": "EARLY" if abs(early) > abs(late) else "LATE" if abs(late) > abs(early) else "TIE",
    }


def complete_result(params=None):
    keys = analyzer.constraint_keys()
    cells = [cell(0.0, 0.0)]
    velocities = [{"pitch": 45 + i, "actualSpanDb": 8.0, "referenceSpanDb": 0.0,
                   "errorDb": 8.0, "violationDb": 0.0} for i in range(16)]
    pitch_cells = [{"pitch": pitch, "velocity": velocity,
                    "pitchMeasurement": {"measurement_valid": True, "pitch_error_cents": 0.0}}
                   for pitch in (21, 36, 48, 60, 72, 84, 96, 108) for velocity in (14, 61, 124)]
    return {
        "candidateId": "candidate", "result": "COMPLETE", "stageReached": 2, "stage2bReached": True,
        "parameters": params or {"axis": 0.5}, "sourceRevision": "rev", "evaluatorSha256": "eval",
        "subsetSha256": "subset", "productionSimd": True,
        "constraints": {key: 0.0 for key in keys}, "constraintSchema": list(keys),
        "directProxy": {"cells": cells, "velocity": velocities},
        "metrics": {"directProxy": {
            "postAttackShape": {"maxViolationDb": -10.0, "failCount": 0},
            "dynamicSpan": {"maxViolationDb": 0.0, "maxAbsoluteErrorDb": 8.0, "failingPitchCount": 0,
                            "perPitch": [{"pitch": row["pitch"], "errorDb": row["errorDb"],
                                          "violationDb": row["violationDb"]} for row in velocities]},
        }},
        "stage2Metrics": {"pitchCells": pitch_cells, "measurementInvalidCount": 0},
    }


class ResidualMathTests(unittest.TestCase):
    def test_early_dominance_sign_and_violation(self):
        result = analyzer.recompute_cell(cell(11.0, 3.0), pathlib.Path("fixture"))
        self.assertEqual(result["dominant"], "EARLY")
        self.assertEqual(result["earlyDb"], 11.0)
        self.assertEqual(result["violationDb"], 1.0)
        result = analyzer.recompute_cell(cell(-2.0, -12.0), pathlib.Path("fixture"))
        self.assertEqual(result["dominant"], "LATE")
        self.assertEqual(result["lateDb"], -12.0)
        self.assertEqual(result["violationDb"], 2.0)

    def test_post_attack_limit_exact_and_just_over(self):
        self.assertEqual(analyzer.recompute_cell(cell(10.0, -10.0), pathlib.Path("fixture"))["violationDb"], 0.0)
        self.assertAlmostEqual(analyzer.recompute_cell(cell(-10.0001, 0), pathlib.Path("fixture"))["violationDb"], 0.0001)

    def test_nonfinite_cell_is_rejected(self):
        bad = cell(math.nan, 0.0)
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.recompute_cell(bad, pathlib.Path("fixture"))

    def test_stored_cell_aggregate_mismatch_is_rejected(self):
        bad = cell(11.0, 3.0)
        bad["earlyResidualDb"] = 10.0
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.recompute_cell(bad, pathlib.Path("fixture"))


class IdentityAndSpanTests(unittest.TestCase):
    def test_dynamic_span_boundary_and_over_limit(self):
        result = complete_result()
        expected = {"candidate": {"anchor": {}, "point": {"point": "L1", "parameters": {"axis": 0.5}}}}
        analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(), None)
        result["directProxy"]["velocity"][0]["actualSpanDb"] = 8.0001
        result["directProxy"]["velocity"][0]["errorDb"] = 8.0001
        violation = 8.0001 - 8.0
        result["directProxy"]["velocity"][0]["violationDb"] = violation
        result["metrics"]["directProxy"]["dynamicSpan"]["maxViolationDb"] = violation
        result["metrics"]["directProxy"]["dynamicSpan"]["maxAbsoluteErrorDb"] = 8.0001
        result["metrics"]["directProxy"]["dynamicSpan"]["failingPitchCount"] = 1
        result["metrics"]["directProxy"]["dynamicSpan"]["perPitch"][0]["errorDb"] = 8.0001
        result["metrics"]["directProxy"]["dynamicSpan"]["perPitch"][0]["violationDb"] = violation
        candidate = analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(), None)
        self.assertAlmostEqual(candidate["spanMax"], violation)
        self.assertEqual(candidate["spanRows"][0]["actualSpanDb"], 8.0001)
        self.assertEqual(candidate["spanRows"][0]["referenceSpanDb"], 0.0)

    def test_incomplete_velocity_spans_are_not_accepted(self):
        result = complete_result()
        result["directProxy"]["velocity"].pop()
        expected = {"candidate": {"anchor": {}, "point": {"point": "L1", "parameters": {"axis": 0.5}}}}
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(), None)

    def test_constraint_schema_must_be_exact_and_finite(self):
        expected = {"candidate": {"anchor": {}, "point": {"point": "L1", "parameters": {"axis": 0.5}}}}
        result = complete_result()
        del result["constraints"][next(iter(result["constraints"]))]
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(), None)
        result = complete_result()
        result["constraints"][next(iter(result["constraints"]))] = math.nan
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(), None)

    def test_simd_and_cross_candidate_identity_are_hard_requirements(self):
        expected = {"candidate": {"anchor": {}, "point": {"point": "L1", "parameters": {"axis": 0.5}}}}
        result = complete_result()
        result["productionSimd"] = False
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(), None)
        result = complete_result()
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(),
                                         {"sourceRevision": "other", "evaluatorSha256": "eval",
                                          "subsetSha256": "subset", "productionSimd": True})

    def test_missing_duplicate_and_extra_candidate_sets_fail_closed(self):
        required = analyzer.ids_expected()
        missing = set(required)
        missing.remove(next(iter(missing)))
        with self.assertRaises(analyzer.EvidenceError) as missing_error:
            analyzer.validate_result_file_set([pathlib.Path(f"{name}.json") for name in missing])
        self.assertEqual(missing_error.exception.status, "BLOCKED_MISSING_PRIVATE_EVIDENCE")
        duplicated_names = list(required) + [next(iter(required))]
        with self.assertRaises(analyzer.EvidenceError) as duplicate_error:
            analyzer.validate_result_file_set([pathlib.Path(f"{name}.json") for name in duplicated_names])
        self.assertEqual(duplicate_error.exception.status, "BLOCKED_EVIDENCE_IDENTITY")
        with self.assertRaises(analyzer.EvidenceError):
            analyzer.validate_result_file_set([pathlib.Path(f"{name}.json") for name in required | {"unexpected"}])

    def test_oat_rejects_any_unrelated_parameter_movement(self):
        base = {"parameters": {"hammer.velocity_hardness_amount": 0.5, "fixed": 1.0}}
        changed = {"parameters": {"hammer.velocity_hardness_amount": 0.25, "fixed": 2.0}}
        result = analyzer.verify_oat(base, changed, "hardness")
        self.assertEqual(result["status"], "REJECTED_NOT_ONE_FACTOR")
        self.assertEqual(result["changedParameters"], ["fixed", "hammer.velocity_hardness_amount"])

    def test_failed_cell_calculation_does_not_mutate_input(self):
        result = complete_result()
        result["metrics"]["directProxy"]["postAttackShape"]["maxViolationDb"] = 1.0
        before = json.dumps(result, sort_keys=True)
        with self.assertRaises(analyzer.EvidenceError):
            expected = {"candidate": {"anchor": {}, "point": {"point": "L1", "parameters": {"axis": 0.5}}}}
            analyzer.validate_candidate(result, pathlib.Path("fixture.json"), expected, analyzer.constraint_keys(), None)
        self.assertEqual(json.dumps(result, sort_keys=True), before)


class FocusAttributionTests(unittest.TestCase):
    def test_focus_lists_measured_failures_and_keeps_buzz_and_all_constraints_visible(self):
        candidates = []
        for anchor, point, pitch, velocity in (
            ("0001", "L1", 108, 14), ("0015", "L1", 60, 61), ("0015", "L3", 72, 61),
            ("0016", "L1", 60, 61), ("0016", "L3", 84, 61),
        ):
            constraints = {key: 0.0 for key in analyzer.constraint_keys()}
            buzz = 0.121478 if (anchor, point) == ("0015", "L3") else 0.119
            if buzz > 0.12:
                constraints["stage2_buzz_violation"] = buzz - 0.12
            candidates.append({
                "candidateId": f"stage2f-split-v3-s2-{anchor}-{point}",
                "anchor": {"historicalResultId": f"stage2b-v1-{anchor}"}, "point": point,
                "cells": [{"pitch": pitch, "velocity": velocity, "earlyDb": 0.0, "lateDb": 12.0,
                           "dominant": "LATE", "violationDb": 2.0}],
                "spanRows": [{"pitch": 60, "actualSpanDb": 15.0, "referenceSpanDb": 6.0,
                              "errorDb": 9.0, "violationDb": 1.0}],
                "pitchRows": [{"pitch": 60, "velocity": 61, "valid": True, "errorCents": 4.0, "failed": False}],
                "constraints": constraints,
                "raw": {"stage2Metrics": {"lowRegisterBuzz": buzz, "peakDbfs": -8.0, "guardHits": 0,
                                           "finite": True, "measurementInvalidCount": 0},
                        "heldReleaseDiagnostics": {"releaseTail2": 0.00014, "finiteRelease": True,
                                                   "stuckVoiceCount": 0}},
            })

        report = analyzer.focused_attribution(candidates, (108, 14))
        self.assertEqual(report["globalMaxAbsoluteLateCell"], {"pitch": 108, "velocity": 14})
        self.assertTrue(report["l1FailureKeyVsGlobalMaxLate"]["0001"]["matchesGlobalMaxAbsoluteLateCell"])
        self.assertFalse(report["allThreeL1SingleFailureKeysMatch"])
        focus_0015_l3 = report["candidates"]["stage2f-split-v3-s2-0015-L3"]
        self.assertEqual(focus_0015_l3["postAttackShapeViolations"][0]["dominantResidual"], "LATE")
        self.assertEqual(focus_0015_l3["dynamicSpanViolations"][0]["actualSpanDb"], 15.0)
        self.assertEqual(focus_0015_l3["dynamicSpanViolations"][0]["referenceSpanDb"], 6.0)
        self.assertEqual(focus_0015_l3["constraintCount"], 32)
        self.assertIn("stage2_buzz_violation", focus_0015_l3["positiveIndependentConstraints"])
        self.assertFalse(focus_0015_l3["hardFeasible"])
        self.assertEqual(report["sameAnchorL1L3"]["0015"]["L3"]["lowRegisterBuzz"], 0.121478)
        self.assertEqual(report["sameAnchorL1L3"]["0015"]["L1"]["constraintCount"], 32)


if __name__ == "__main__":
    unittest.main()
