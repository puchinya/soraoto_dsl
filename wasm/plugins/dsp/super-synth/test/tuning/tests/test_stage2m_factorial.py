import importlib.util
import json
import pathlib
import copy
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "analyze_stage2m_factorial.py"
spec = importlib.util.spec_from_file_location("analyze_stage2m_factorial", SCRIPT)
stage2m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage2m)


class Stage2MFactorialTests(unittest.TestCase):
    def test_known_factorial_effects_and_interactions(self):
        # Y = 10 + 2N - 3V + 4H + 5NV - 6NH + 7VH + 8NVH.
        # The contract's effect is a difference of group means, twice the
        # regression coefficient in this coded polynomial.
        expected = {"N": 4, "V": -6, "H": 8, "N×V": 10, "N×H": -12, "V×H": 14, "N×V×H": 16}
        values = {}
        for mask in range(8):
            n, v, h = (1 if mask & bit else -1 for bit in (1, 2, 4))
            values[mask] = 10 + 2*n - 3*v + 4*h + 5*n*v - 6*n*h + 7*v*h + 8*n*v*h
        self.assertEqual(stage2m.factorial_effects(values), expected)

    def test_matched_pairs_change_one_factor_and_use_revision2_minus_legacy(self):
        values = {mask: float(mask) for mask in range(8)}
        pairs = stage2m.matched_pairs(values, 2)
        self.assertEqual(len(pairs), 4)
        self.assertTrue(all(row["revision2Mask"] == row["legacyMask"] | 2 for row in pairs))
        self.assertTrue(all(row["revision2MinusLegacy"] == 2.0 for row in pairs))

    def test_span_requires_exactly_expected_layers(self):
        rows = [{"velocity": v, "level80to200Dbfs": -40 + i,
                 "reference80to200Dbfs": -41 + i, "level200to350Dbfs": -45 + i,
                 "peakDbfs": -10, "finite": True, "guardHits": 0,
                 "hammer": {k: 0.0 for k in ("effectiveHardness", "initialHammerVelocity", "contactDurationSamples", "peakForce", "maxCompression", "postContactTransverseEnergy")}}
                for i, v in enumerate(stage2m.EXPECTED_VELOCITIES)]
        summary = stage2m._span_metrics(rows)
        self.assertEqual(summary["synthSpanDb"], 15.0)
        self.assertEqual(summary["referenceSpanDb"], 15.0)
        self.assertEqual(summary["existing8DbViolationDb"], -8.0)
        with self.assertRaises(stage2m.EvidenceError):
            stage2m.validate_and_analyze({"combinations": []}, {})

    def test_mask_labels_are_explicit_msb_to_lsb_display_over_n_v_h_bits(self):
        self.assertEqual([f"{mask:03b}" for mask in range(8)], ["000", "001", "010", "011", "100", "101", "110", "111"])
        self.assertEqual(stage2m.FACTOR_NAMES, ("N", "V", "H"))

    @unittest.skipUnless(stage2m.STATE.joinpath("factorial-result-long-window.json").is_file(),
                         "requires private completed Stage2M matrix")
    def test_completed_matrix_passes_identity_and_111_reproduction(self):
        result = json.loads(stage2m.STATE.joinpath("factorial-result-long-window.json").read_text())
        stage2l = json.loads(stage2m.DEFAULT_STAGE2L.read_text())
        report = stage2m.validate_and_analyze(result, stage2l)
        self.assertTrue(report["stage2lCandidate1Equivalence"]["pass"])
        self.assertEqual(report["decision"]["midi21EstimatorDisagreementMasks"], [3, 4, 6, 7])
        broken = copy.deepcopy(result)
        broken["combinations"].pop()
        with self.assertRaisesRegex(stage2m.EvidenceError, "exactly eight"):
            stage2m.validate_and_analyze(broken, stage2l)

    @unittest.skipUnless(stage2m.STATE.joinpath("factorial-result-long-window.json").is_file(),
                         "requires private completed Stage2M matrix")
    def test_completed_matrix_rejects_missing_velocity_layer(self):
        result = json.loads(stage2m.STATE.joinpath("factorial-result-long-window.json").read_text())
        stage2l = json.loads(stage2m.DEFAULT_STAGE2L.read_text())
        result["combinations"][0]["midi45"].pop()
        with self.assertRaisesRegex(stage2m.EvidenceError, "exactly 16"):
            stage2m.validate_and_analyze(result, stage2l)


if __name__ == "__main__":
    unittest.main()
