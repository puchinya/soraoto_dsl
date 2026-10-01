import copy
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[7]
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
sys.path.insert(0, str(TUNING))

import analyze_stage2f_v2_residuals as stage2f  # noqa: E402
import analyze_stage2i_loss_authority as stage2i  # noqa: E402


class Stage2ILossAuthorityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        presets = json.loads((ROOT / stage2i.PRESETS_REL).read_text(encoding="utf-8"))
        preset = presets["concert_grand"]
        cls.values = stage2i.config_values(preset["engine_config"]["string"])
        cls.damping = preset["piano_string_damping"]

    def test_current_config_c8_gate_is_zero_and_pitch45_mapping_is_active(self):
        c8_soft = stage2i.compute_loss_terms(108, 14, self.damping, self.values)
        c8_hard = stage2i.compute_loss_terms(108, 124, self.damping, self.values)
        self.assertEqual(c8_soft["normalizedKey"], 1.0)
        self.assertEqual(c8_soft["referenceLossRegisterGate"], 0.0)
        self.assertEqual(c8_soft["referenceLoss"], 0.0)
        self.assertEqual(c8_hard["referenceLoss"], 0.0)

        pitch45_soft = stage2i.compute_loss_terms(45, 14, self.damping, self.values)
        pitch45_hard = stage2i.compute_loss_terms(45, 124, self.damping, self.values)
        self.assertAlmostEqual(pitch45_soft["referenceLossRegisterGate"], 0.8980842911877396, places=14)
        self.assertAlmostEqual(pitch45_soft["referenceLoss"], 0.002174665146167074, places=14)
        self.assertAlmostEqual(pitch45_hard["referenceLoss"], 0.001281672356472682, places=14)
        self.assertGreater(pitch45_soft["referenceLoss"], pitch45_hard["referenceLoss"])

    def test_passive_loss_clamps_are_applied_at_both_stages(self):
        values = copy.deepcopy(self.values)
        values["agraffe"]["passive_min"], values["agraffe"]["passive_max"] = 0.4, 0.6
        values["bridge"]["passive_min"], values["bridge"]["passive_max"] = 0.3, 0.5
        terms = stage2i.compute_loss_terms(60, 61, self.damping, values)
        for key in ("aa", "loss_a"):
            self.assertGreaterEqual(terms["agraffe"][key], 0.4)
            self.assertLessEqual(terms["agraffe"][key], 0.6)
        for key in ("ab", "loss_b"):
            self.assertGreaterEqual(terms["bridge"][key], 0.3)
            self.assertLessEqual(terms["bridge"][key], 0.5)

    def test_missing_stage2h_probe_or_span_curve_fails_closed(self):
        ids = [f"stage2f-split-v3-s2-{anchor}-L1" for anchor in stage2i.ANCHORS]
        rows = [{"candidateId": candidate, "pitch": pitch, "velocity": velocity}
                for candidate in ids for pitch, velocity in stage2i.C8_KEYS_ORDERED]
        curves = [{"candidateId": candidate, "pitch": 45,
                   "layers": [{"velocity": velocity} for velocity in stage2i.stage2h.EXPECTED_VELOCITIES],
                   "referenceMinimumVelocities": [14], "referenceMaximumVelocities": [124],
                   "renderMinimumVelocities": [14], "renderMaximumVelocities": [124],
                   "signedSpanDifferenceDb": 0.0}
                  for candidate in stage2i.PITCH45_CANDIDATES]
        report = {"status": "COMPLETE_NUMERIC_WINDOW_SPAN_AUDIT", "renderCount": 0,
                  "c8WindowAudit": {"cells": rows}, "velocitySpanAudit": {"curves": curves}}
        self.assertEqual(len(stage2i.select_stage2h_inputs(report)[0]), 3)

        report["c8WindowAudit"]["cells"].pop()
        with self.assertRaises(stage2f.EvidenceError):
            stage2i.select_stage2h_inputs(report)

        report["c8WindowAudit"]["cells"] = rows
        report["velocitySpanAudit"]["curves"].pop()
        with self.assertRaises(stage2f.EvidenceError):
            stage2i.select_stage2h_inputs(report)

    def test_nonfinite_or_invalid_inputs_fail_closed(self):
        for bad in (math.nan, math.inf, -math.inf, True, "0.1"):
            with self.subTest(value=repr(bad)), self.assertRaises(stage2f.EvidenceError):
                stage2i.compute_loss_terms(60, 61, bad, self.values)
        with self.assertRaises(stage2f.EvidenceError):
            stage2i.compute_loss_terms(60, 0, self.damping, self.values)

    def test_formula_drift_is_detected(self):
        plugin = "\n".join(stage2i.FORMULA_LINES)
        capture = "\n".join(stage2i.HELD_CAPTURE_LINES)
        self.assertEqual(len(stage2i.verify_formula_source(plugin, capture)), 64)
        with self.assertRaises(stage2f.EvidenceError):
            stage2i.verify_formula_source(plugin.replace(stage2i.FORMULA_LINES[0], "float key=0.0f;"), capture)
        with self.assertRaises(stage2f.EvidenceError):
            stage2i.verify_formula_source(plugin, capture.replace(stage2i.HELD_CAPTURE_LINES[0], "const DURATION_MS = 100;"))

    def test_protected_snapshot_mismatch_fails_closed(self):
        stage2i.ensure_snapshot_unchanged({"config.json": "a"}, {"config.json": "a"}, "test")
        with self.assertRaises(stage2f.EvidenceError):
            stage2i.ensure_snapshot_unchanged({"config.json": "a"}, {"config.json": "b"}, "test")


if __name__ == "__main__":
    unittest.main()
