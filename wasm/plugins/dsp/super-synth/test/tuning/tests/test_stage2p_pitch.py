from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "analyze_stage2p_pitch.py"
SPEC = importlib.util.spec_from_file_location("analyze_stage2p_pitch", MODULE_PATH)
ANALYZER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(ANALYZER)


def make_cell(pitch: int, velocity: int, *, valid: bool = True, cents: float = 0.0,
              reason: str | None = None, peak: float = -6.0, guard: int = 0,
              finite: bool = True, instability: bool = False) -> dict:
    windows = {
        "full": {"measurement_valid": True, "result": "PASS", "pitch_error_cents": cents,
                 "estimated_f0": 27.5, "fitted_B": 0.01, "usable_partial_count": 4,
                 "usable_partials": [1, 2, 3, 4], "start_ms": 20, "end_ms": 1385.33,
                 "sample_count": 65536, "exact_window": True},
        "early": {"measurement_valid": True, "result": "PASS", "pitch_error_cents": cents + 1,
                  "estimated_f0": 27.5, "fitted_B": 0.01, "usable_partial_count": 4,
                  "usable_partials": [1, 2, 3, 4], "start_ms": 20, "end_ms": 702.67,
                  "sample_count": 32768, "exact_window": True},
        "late": {"measurement_valid": False, "result": "MEASUREMENT_INVALID", "reason": "test-invalid",
                 "sample_count": 32768, "exact_window": True},
    }
    measurement = {
        "pitch_estimator_revision": 3,
        "measurement_valid": valid,
        "result": "FAIL" if instability or (valid and abs(cents) > 15) else "PASS" if valid else "MEASUREMENT_INVALID",
        "reason": reason or ("analysis-window-pitch-instability" if instability else None),
        "pitch_error_cents": cents,
        "estimated_f0": 27.5,
        "fitted_B": 0.01,
        "measurement_basis": "low-register-multi-window-pitch-trajectory" if instability else "low-register-multi-window-inharmonic-comb",
        "low_register_diagnostics": {
            "windows": windows,
            "valid_window_names": ["full", "early"] if valid else ["full"],
            "stable_cluster_names": [] if instability else ["full", "early"] if valid else [],
            "stable_cluster_spread_cents": None if instability else 1.0,
            "overall_valid_window_spread_cents": 20.0 if instability else 1.0,
            "physical_instability": instability,
            "sources": [{"name": "spectralBaseF0", "eligible": False, "h1Prominence": 1.5, "B_A": -0.001},
                        {"name": "autocorrelation", "eligible": True, "cents": 40.0}],
            "revision2_diagnostic": {"result": "MEASUREMENT_INVALID"},
            "legacy_diagnostic": {"result": "PASS"},
        },
    }
    return {"pitch": pitch, "velocity": velocity, "metrics": {
        "pitchMeasurement": measurement, "peakDbfs": peak, "fullRenderPeakDbfs": peak,
        "outputGuardHits": guard, "finite": finite}}


def capture(cells: list[dict]) -> dict:
    return {"candidateId": "stage2n-r3-candidate-01", "sourceRevision": "source-sha",
            "candidateVector": {"fixed": True}, "configSha256": "config-sha", "wasmSha256": "wasm-sha",
            "productionSimd": True, "candidateBudgetDelta": 0,
            "capture": {"matrix": cells}}


def all_cells(**kwargs) -> list[dict]:
    return [make_cell(pitch, velocity, **kwargs)
            for pitch, velocity in ANALYZER.EXPECTED_CELLS]


class Stage2PPitchAnalyzerTests(unittest.TestCase):
    def test_exact_24_cell_matrix_passes_for_stage2e_eligibility(self) -> None:
        result = ANALYZER.summarize_capture(capture(all_cells()))
        self.assertEqual(result["decision"], "MATRIX_PASS_STAGE2E_ELIGIBLE")
        self.assertEqual(result["requestedCellCount"], 24)
        self.assertEqual(result["validCount"], 24)
        self.assertEqual(result["candidateBudgetDelta"], 0)
        self.assertEqual(result["cells"][0]["windows"]["full"]["sampleCount"], 65536)
        self.assertFalse(result["cells"][0]["sourceA"]["eligible"])
        self.assertEqual(result["cells"][0]["autocorrelationDiagnostic"]["cents"], 40.0)

    def test_any_invalid_measurement_blocks_as_estimator_unresolved(self) -> None:
        cells = all_cells()
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], valid=False, reason="insufficient-valid-low-register-windows")
        result = ANALYZER.summarize_capture(capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2P_ESTIMATOR_UNRESOLVED")
        self.assertEqual(result["invalidCount"], 1)

    def test_pitch_fail_and_window_instability_block_as_physical_pitch(self) -> None:
        cells = all_cells()
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], cents=20)
        result = ANALYZER.summarize_capture(capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2P_PHYSICAL_PITCH")
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], cents=12, instability=True)
        result = ANALYZER.summarize_capture(capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2P_PHYSICAL_PITCH")
        self.assertEqual(result["trajectoryFailureCount"], 1)

    def test_safety_failure_is_not_hidden_by_valid_pitch(self) -> None:
        cells = all_cells()
        cells[0] = make_cell(*ANALYZER.EXPECTED_CELLS[0], peak=0.0)
        self.assertEqual(ANALYZER.summarize_capture(capture(cells))["decision"], "BLOCKED_STAGE2P_MODEL_REGRESSION")

    def test_incomplete_duplicate_and_unexpected_coverage_reject(self) -> None:
        cells = all_cells()
        with self.assertRaisesRegex(ValueError, "missing"):
            ANALYZER.summarize_capture(capture(cells[:-1]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            ANALYZER.summarize_capture(capture(cells + [cells[0]]))
        with self.assertRaisesRegex(ValueError, "unexpected"):
            ANALYZER.summarize_capture(capture(cells[:-1] + [make_cell(20, 14)]))


if __name__ == "__main__":
    unittest.main()
