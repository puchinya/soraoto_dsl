import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "analyze_stage2o_pitch.py"
SPEC = importlib.util.spec_from_file_location("analyze_stage2o_pitch", MODULE_PATH)
ANALYZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ANALYZER)


def capture_cell(pitch, velocity, *, valid=True, cents=0.0, source_a=True, source_c=True):
    return {
        "pitch": pitch,
        "velocity": velocity,
        "metrics": {
            "finite": True,
            "outputGuardHits": 0,
            "peakDbfs": -3.0,
            "pitchMeasurement": {
                "measurement_valid": valid,
                "result": "PASS" if valid and abs(cents) <= 15 else "FAIL" if valid else "MEASUREMENT_INVALID",
                "reason": None if valid else "low-register-spectral-comb-disagreement",
                "pitch_error_cents": cents if valid else None,
                "low_register_diagnostics": {
                    "sources": [
                        {"name": "spectralBaseF0", "eligible": source_a,
                         "h1Hz": 27.7, "h2Hz": 55.2, "rawH1Cents": 13.04792250285121,
                         "B_A": 0.01, "f0_A": 27.5, "cents_A": 0.0},
                        {"name": "autocorrelation", "eligible": False, "cents": 73.0},
                        {"name": "harmonicComb", "eligible": source_c,
                         "B_C": 0.01, "f0_C": 27.5, "cents_C": cents},
                    ],
                    "agreement_cluster": {"spreadCents": 0.0 if valid else None},
                },
            },
        },
    }


def full_capture(cells):
    return {"candidateId": "stage2n-r3-candidate-01", "sourceRevision": "baseline",
            "configSha256": "config", "wasmSha256": "wasm", "capture": {"matrix": cells}}


class Stage2OPitchAnalysisTests(unittest.TestCase):
    def test_requires_exact_24_cell_coverage(self):
        cells = [capture_cell(p, v) for p, v in ANALYZER.EXPECTED_CELLS]
        self.assertEqual(ANALYZER.summarize_capture(full_capture(cells))["requestedCellCount"], 24)
        with self.assertRaisesRegex(ValueError, "BLOCKED_STAGE2O_REQUIRED_COVERAGE"):
            ANALYZER.summarize_capture(full_capture(cells[:-1]))
        with self.assertRaisesRegex(ValueError, "BLOCKED_STAGE2O_REQUIRED_COVERAGE"):
            ANALYZER.summarize_capture(full_capture(cells + [cells[0]]))

    def test_missing_or_invalid_a_c_is_estimator_block(self):
        cells = [capture_cell(p, v) for p, v in ANALYZER.EXPECTED_CELLS]
        cells[0] = capture_cell(21, 14, valid=False, source_a=False)
        result = ANALYZER.summarize_capture(full_capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2O_ESTIMATOR_UNRESOLVED")
        self.assertEqual(result["measurementInvalidCount"], 1)

    def test_valid_source_c_outside_pitch_limit_is_physical_block(self):
        cells = [capture_cell(p, v) for p, v in ANALYZER.EXPECTED_CELLS]
        cells[0] = capture_cell(21, 14, cents=16.0)
        result = ANALYZER.summarize_capture(full_capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2O_PHYSICAL_PITCH")
        self.assertEqual(result["cells"][0]["finalCents"], 16.0)

    def test_midi21_raw_h1_provenance_is_mandatory(self):
        cells = [capture_cell(p, v) for p, v in ANALYZER.EXPECTED_CELLS]
        cells[0]["metrics"]["pitchMeasurement"]["low_register_diagnostics"]["sources"][0]["rawH1Cents"] = 20
        result = ANALYZER.summarize_capture(full_capture(cells))
        self.assertEqual(result["decision"], "BLOCKED_STAGE2O_LOW_REGISTER_PROVENANCE")
        self.assertFalse(result["midi21RawH1ProvenancePass"])


if __name__ == "__main__":
    unittest.main()
