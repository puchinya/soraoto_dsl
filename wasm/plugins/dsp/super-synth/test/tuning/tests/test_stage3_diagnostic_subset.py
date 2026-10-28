from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_stage3_diagnostic_subset import build_subset  # noqa: E402


class Stage3DiagnosticSubsetTests(unittest.TestCase):
    def test_subset_is_deterministic_and_contains_required_layers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = {"stageReached": 3, "result": "FAIL", "sourceTreeSha256": "same-source",
                    "configSha256": "config", "wasmSha256": "wasm"}
            first = {**base, "candidateId": "one", "failures": [
                "21:31:postAttackShape", "pitch 21:dynamicSpan", "pitch 36:brightnessDirection"]}
            second = {**base, "candidateId": "two", "failures": [
                "24:45:directLevel+postAttackShape", "pitch 36:dynamicSpan"]}
            files = [root / "one.json", root / "two.json"]
            for file, report in zip(files, (first, second)):
                file.write_text(json.dumps(report))

            subset_a = build_subset(files)
            subset_b = build_subset(list(reversed(files)))
            self.assertEqual(subset_a["subsetSha256"], subset_b["subsetSha256"])
            cells = {(cell["pitch"], cell["velocity"]): cell for cell in subset_a["cells"]}
            self.assertEqual(subset_a["cellCount"], len(cells))
            velocities = json.loads((Path(__file__).resolve().parents[2] / "reference/salamander-grand-piano-v3-metrics.json").read_text())["coverage"]["velocityRepresentatives"]
            self.assertTrue(all((pitch, velocity) in cells for pitch in (21, 36) for velocity in velocities))
            self.assertIn((21, velocities[0]), cells)
            self.assertIn((21, velocities[-1]), cells)
            self.assertIn((24, 45), cells)
            self.assertEqual(subset_a["purpose"], "diagnostic-only; cannot produce Stage-3 PASS")

    def test_mixed_source_reports_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reports = []
            for candidate, source in (("one", "a"), ("two", "b")):
                path = root / f"{candidate}.json"
                path.write_text(json.dumps({"stageReached": 3, "result": "FAIL", "candidateId": candidate,
                    "sourceTreeSha256": source, "configSha256": "c", "wasmSha256": "w", "failures": []}))
                reports.append(path)
            with self.assertRaisesRegex(ValueError, "mixed source-tree"):
                build_subset(reports)


if __name__ == "__main__":
    unittest.main()
