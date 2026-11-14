from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "analyze_stage2q_pitch.py"
SPEC = importlib.util.spec_from_file_location("analyze_stage2q_pitch", MODULE_PATH)
ANALYZER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(ANALYZER)


def fit(*, valid: bool = True, cents: float = 0.0, b: float = 0.01, reason: str | None = None) -> dict:
    return {
        "measurement_valid": valid,
        "result": "PASS" if valid and abs(cents) <= 15 else "FAIL" if valid else "MEASUREMENT_INVALID",
        "reason": reason,
        "estimated_f0": 27.5,
        "candidate_estimated_f0": 27.5,
        "pitch_error_cents": cents,
        "candidate_pitch_error_cents": cents,
        "fitted_B": b if valid else None,
        "candidate_fitted_B": b,
        "inharmonicity_basis": "fixed-note-level",
        "usable_partial_count": 4,
        "usable_partials": [1, 2, 3, 4],
        "rejected_partials": [],
        "partial_f0_spread_cents": 0.1,
        "partial_fit_residual_cents": 0.1,
        "estimated_uncertainty_cents": 0.2,
        "best_score": 1.0,
        "competing_score": 0.5,
        "confidence_ratio": 2.0,
        "confidence_components": {},
        "partial_candidates": [],
        "start_ms": 20.0,
        "end_ms": 100.0,
        "sample_count": 32768,
        "exact_window": True,
    }


def make_cell(pitch: int, velocity: int, *, valid: bool = True, b_valid: bool = True,
              cents: float = 0.0, instability: bool = False, peak: float = -6.0,
              guard: int = 0, finite: bool = True) -> dict:
    fixed = {name: fit(valid=valid, cents=cents, reason="test-invalid" if not valid else None)
             for name in ("full", "early", "late")}
    free = {name: fit(cents=0.0, b=0.009 + i * 0.001) for i, name in enumerate(("full", "early", "late"))}
    measurement = {
        "pitch_estimator_revision": 4,
        "measurement_valid": valid,
        "result": "FAIL" if instability or (valid and abs(cents) > 15) else "PASS" if valid else "MEASUREMENT_INVALID",
        "reason": "analysis-window-pitch-instability" if instability else "note-level-inharmonicity-unresolved" if not b_valid else None,
        "pitch_error_cents": cents if valid else None,
        "estimated_f0": 27.5 if valid else None,
        "fitted_B": 0.01 if b_valid else None,
        "measurement_basis": "low-register-fixed-B-multi-window",
        "low_register_diagnostics": {
            "note_level_B": 0.01 if b_valid else None,
            "note_level_B_valid": b_valid,
            "note_level_B_source": "full-window-free-fit",
            "free_B_spread": 0.002,
            "free_windows": free,
            "windows": fixed,
            "valid_window_names": ["full", "early", "late"] if valid else [],
            "overall_valid_window_spread_cents": 1.0,
            "stable_cluster_names": ["full", "early", "late"] if valid else [],
            "physical_instability": instability,
            "diagnostic_only": {
                "stage2o_source_A": {"eligible": False, "reason": "weak-h1"},
                "stage2o_autocorrelation": {"eligible": True, "cents": 50.0},
                "revision3_result": {"result": "FAIL" if instability else "PASS"},
                "revision2_result": {"result": "MEASUREMENT_INVALID"},
                "legacy_short_window_result": {"result": "FAIL"},
            },
        },
    }
    return {"pitch": pitch, "velocity": velocity, "metrics": {
        "pitchMeasurement": measurement, "peakDbfs": peak, "fullRenderPeakDbfs": peak,
        "outputGuardHits": guard, "finite": finite,
    }}


def capture(cells: list[dict]) -> dict:
    return {"candidateId": "stage2n-r3-candidate-01", "sourceRevision": "fa54334",
            "candidateVector": {"fixed": True}, "configSha256": "config-sha", "wasmSha256": "wasm-sha",
            "productionSimd": True, "candidateBudgetDelta": 0,
            "capture": {"matrix": cells}}


def all_cells(**kwargs) -> list[dict]:
    return [make_cell(pitch, velocity, **kwargs) for pitch, velocity in ANALYZER.EXPECTED_CELLS]


class Stage2QPitchAnalyzerTests(unittest.TestCase):
    def test_exact_matrix_is_eligible_for_stage2e(self) -> None:
        result = ANALYZER.summarize_capture(capture(all_cells()))
        self.assertEqual(result["decision"], "MATRIX_PASS_STAGE2E_ELIGIBLE")
        self.assertEqual(result["requestedCellCount"], 24)
        self.assertEqual(result["noteLevelBValidCount"], 24)
        self.assertEqual(result["validCount"], 24)
        self.assertEqual(result["candidateBudgetDelta"], 0)
        self.assertEqual(result["cells"][0]["fixedWindows"]["full"]["inharmonicityBasis"], "fixed-note-level")
        self.assertFalse(result["cells"][0]["stage2oSourceA"]["eligible"])

    def test_unresolved_b_or_fixed_b_measurement_blocks(self) -> None:
        cells = all_cells()
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], valid=False, b_valid=False)
        result = ANALYZER.summarize_capture(capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2Q_ESTIMATOR_UNRESOLVED")
        self.assertEqual(result["invalidCount"], 1)

    def test_pitch_and_trajectory_failures_are_physical_blockers(self) -> None:
        cells = all_cells()
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], cents=16)
        self.assertEqual(ANALYZER.summarize_capture(capture(cells))["decision"], "BLOCKED_STAGE2Q_PHYSICAL_PITCH")
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], cents=12, instability=True)
        result = ANALYZER.summarize_capture(capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2Q_PHYSICAL_PITCH")
        self.assertEqual(result["trajectoryFailureCount"], 1)

    def test_safety_failure_takes_precedence(self) -> None:
        cells = all_cells()
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], peak=0.0)
        self.assertEqual(ANALYZER.summarize_capture(capture(cells))["decision"], "BLOCKED_STAGE2Q_MODEL_REGRESSION")

    def test_revision_and_exact_coverage_are_required(self) -> None:
        cells = all_cells()
        cells[0]["metrics"]["pitchMeasurement"]["pitch_estimator_revision"] = 3
        with self.assertRaisesRegex(ValueError, "revision 4"):
            ANALYZER.summarize_capture(capture(cells))
        cells = all_cells()
        with self.assertRaisesRegex(ValueError, "missing"):
            ANALYZER.summarize_capture(capture(cells[:-1]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            ANALYZER.summarize_capture(capture(cells + [cells[0]]))
        with self.assertRaisesRegex(ValueError, "unexpected"):
            ANALYZER.summarize_capture(capture(cells[:-1] + [make_cell(20, 14)]))


if __name__ == "__main__":
    unittest.main()
