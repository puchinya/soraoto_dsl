import copy
import hashlib
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "analyze_stage2h_window_span.py"
SPEC = importlib.util.spec_from_file_location("analyze_stage2h_window_span", SCRIPT)
stage2h = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(stage2h)


def reference_cell(pitch, velocity, levels=None):
    return {"pitch": pitch, "velocity": velocity, "sample": f"samples/{pitch}_{velocity}.flac",
            "metrics": {"envelopeDbfs": levels or [-20.0, -25.0, -30.0, -30.0, -35.0]}}


def full_fixture():
    cells = [reference_cell(pitch, velocity)
             for pitch in stage2h.EXPECTED_PITCHES for velocity in stage2h.EXPECTED_VELOCITIES]
    return {"schemaVersion": 3, "source": {"name": "Salamander Grand Piano V3",
            "archiveSha256": stage2h.EXPECTED_ARCHIVE_SHA, "sfzSha256": "a" * 64},
            "coverage": {"pitches": stage2h.EXPECTED_PITCHES,
                         "velocityRepresentatives": stage2h.EXPECTED_VELOCITIES},
            "directCells": cells}


def subset_fixture():
    keys = set(stage2h.C8_KEYS)
    for pitches in stage2h.SPAN_TARGETS.values():
        for pitch in pitches:
            keys.update((pitch, velocity) for velocity in stage2h.EXPECTED_VELOCITIES)
    return {"cells": [{"pitch": p, "velocity": v} for p, v in sorted(keys)]}


class Stage2HWindowSpanTests(unittest.TestCase):
    def test_c8_formula_reconciles_and_preserves_minus240_sentinel(self):
        ref = reference_cell(108, 14, [-20, -25, -28, -30, -35])
        cell = {"pitch": 108, "velocity": 14, "levelErrorDb": 2.0,
                "renderLateRelDb": -17.0, "renderEarlyRelDb": -8.0,
                "referenceEarlyRelDb": -10.0, "referenceLateRelDb": -5.0,
                "earlyResidualDb": 2.0, "lateResidualDb": -12.0,
                "postAttackShapeErrorDb": 12.0, "postAttackShapeViolationDb": 2.0}
        before = copy.deepcopy((ref, cell))
        row = stage2h.reconstruct_c8(ref, cell, 4.0)
        self.assertEqual((row["R3_reference80_200Dbfs"], row["R4_reference200_350Dbfs"]), (-30, -35))
        self.assertEqual((row["S3_render80_200Dbfs"], row["S4_render200_350Dbfs"]), (-32, -49))
        self.assertEqual((row["RR_referenceRelativeDb"], row["lateResidualDb"], row["shapeViolationDb"]), (-5, -12, 2))
        self.assertEqual((ref, cell), before)

        sentinel_ref = reference_cell(108, 14, [-240, -240, -240, -240, -240])
        sentinel_cell = {**cell, "levelErrorDb": 0.0, "renderLateRelDb": 0.0,
                         "referenceLateRelDb": 0.0, "earlyResidualDb": 2.0,
                         "lateResidualDb": 0.0, "postAttackShapeErrorDb": 2.0,
                         "postAttackShapeViolationDb": -8.0}
        sentinel = stage2h.reconstruct_c8(sentinel_ref, sentinel_cell, 0.0)
        self.assertEqual(sentinel["rmsSentinelsMinus240"], {"R3": -240.0, "R4": -240.0, "S3": -240.0, "S4": -240.0})

    def make_span(self, actual_levels, ref_levels=None):
        velocities = stage2h.EXPECTED_VELOCITIES
        ref_levels = ref_levels or [float(-50 - (i % 11)) for i in range(16)]
        refs = [reference_cell(45, velocity, [-20, -25, -30, value, value - 3])
                for velocity, value in zip(velocities, ref_levels)]
        renders = {(45, velocity): {"levelErrorDb": actual - reference}
                   for velocity, actual, reference in zip(velocities, actual_levels, ref_levels)}
        stored = {"actualSpanDb": max(actual_levels) - min(actual_levels),
                  "referenceSpanDb": max(ref_levels) - min(ref_levels),
                  "errorDb": abs((max(actual_levels) - min(actual_levels)) -
                                 (max(ref_levels) - min(ref_levels)))}
        stored["violationDb"] = stored["errorDb"] - stage2h.SPAN_LIMIT_DB
        return refs, renders, stored

    def test_span_boundary_direction_and_interior_extrema(self):
        ref_levels = [-50.0, -60.0, -54.0, -55.0, -56.0, -57.0, -58.0, -59.0,
                      -53.0, -52.0, -51.0, -54.0, -56.0, -49.0, -55.0, -57.0]
        exact = list(ref_levels)
        exact[13] += 8.0
        refs, renders, stored = self.make_span(exact, ref_levels)
        row = stage2h.reconstruct_span_curve(45, refs, renders, 0.0, stored)
        self.assertEqual(row["absoluteSpanErrorDb"], 8.0)
        self.assertEqual(row["spanViolationDb"], 0.0)
        self.assertEqual(row["direction"], "SYNTH_SPAN_GREATER")
        self.assertEqual(row["referenceMinimumVelocities"], [31])
        self.assertEqual(row["referenceMaximumVelocities"], [109])
        self.assertEqual(row["renderMaximumVelocities"], [109])

        over = list(exact)
        over[13] += 0.001
        refs, renders, stored = self.make_span(over, ref_levels)
        row = stage2h.reconstruct_span_curve(45, refs, renders, 0.0, stored)
        self.assertAlmostEqual(row["spanViolationDb"], 0.001)

        smaller = [-55.0] * 16
        smaller[0], smaller[1] = -59.0, -57.0
        refs, renders, stored = self.make_span(smaller, ref_levels)
        row = stage2h.reconstruct_span_curve(45, refs, renders, 0.0, stored)
        self.assertEqual(row["direction"], "SYNTH_SPAN_SMALLER")
        self.assertEqual(row["signedSpanDifferenceDb"], -7.0)

    def test_rejects_duplicate_or_missing_fixture_cells_and_subset_layers(self):
        fixture = full_fixture()
        stage2h.validate_fixture_matrix(fixture)
        duplicated = copy.deepcopy(fixture)
        duplicated["directCells"][-1] = copy.deepcopy(duplicated["directCells"][0])
        with self.assertRaises(stage2h.stage2f.EvidenceError):
            stage2h.validate_fixture_matrix(duplicated)
        missing = copy.deepcopy(fixture)
        missing["directCells"].pop()
        with self.assertRaises(stage2h.stage2f.EvidenceError):
            stage2h.validate_fixture_matrix(missing)

        subset = subset_fixture()
        stage2h.validate_subset_keys(subset)
        bad_subset = copy.deepcopy(subset)
        bad_subset["cells"].append(copy.deepcopy(bad_subset["cells"][0]))
        with self.assertRaises(stage2h.stage2f.EvidenceError):
            stage2h.validate_subset_keys(bad_subset)
        missing_layer = copy.deepcopy(subset)
        missing_layer["cells"].remove({"pitch": 45, "velocity": 14})
        with self.assertRaises(stage2h.stage2f.EvidenceError):
            stage2h.validate_subset_keys(missing_layer)

    def test_rejects_nonfinite_values_and_incomplete_span_layers(self):
        ref = reference_cell(108, 14)
        cell = {"pitch": 108, "velocity": 14, "levelErrorDb": math.nan,
                "renderLateRelDb": 0, "renderEarlyRelDb": 0,
                "referenceEarlyRelDb": 0, "referenceLateRelDb": 0,
                "earlyResidualDb": 0, "lateResidualDb": 0,
                "postAttackShapeErrorDb": 0, "postAttackShapeViolationDb": -10}
        with self.assertRaises(stage2h.stage2f.EvidenceError):
            stage2h.reconstruct_c8(ref, cell, 0)
        refs, renders, stored = self.make_span([float(-55)] * 16)
        with self.assertRaises(stage2h.stage2f.EvidenceError):
            stage2h.reconstruct_span_curve(45, refs[:-1], renders, 0, stored)
        missing_render = dict(renders)
        missing_render.pop((45, 14))
        with self.assertRaises(stage2h.stage2f.EvidenceError):
            stage2h.reconstruct_span_curve(45, refs, missing_render, 0, stored)

    def test_fixture_sha_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for relative in (stage2h.FIXTURE_REL, stage2h.HASHES_REL, stage2h.SUBSET_REL,
                             stage2h.CHECKSUMS_REL, Path(".agent-state/issues/7/calibration-optuna/stage2b/run-manifest.json")):
                (root / relative).parent.mkdir(parents=True, exist_ok=True)
            fixture = full_fixture()
            fixture["source"].update({"sfzSha256": "a" * 64, "uniqueReferencedAudioFiles": 641})
            fixture_path = root / stage2h.FIXTURE_REL
            fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
            hashes = {"schemaVersion": 1, "source": {"archiveSha256": stage2h.EXPECTED_ARCHIVE_SHA,
                      "primarySfzSha256": "a" * 64},
                      "packageFiles": [{"path": f"p/{i}", "sha256": "b" * 64} for i in range(643)],
                      "provenanceFiles": [{"path": f"q/{i}", "sha256": "c" * 64} for i in range(4)]}
            (root / stage2h.HASHES_REL).write_text(json.dumps(hashes), encoding="utf-8")
            subset = subset_fixture()
            subset["referenceFixtureSha256"] = "0" * 64
            subset["subsetSha256"] = stage2h.stage2f.canonical_sha({k: v for k, v in subset.items() if k != "subsetSha256"})
            (root / stage2h.SUBSET_REL).write_text(json.dumps(subset), encoding="utf-8")
            (root / ".agent-state/issues/7/calibration-optuna/stage2b/run-manifest.json").write_text(
                json.dumps({"subsetSha256": subset["subsetSha256"]}), encoding="utf-8")
            (root / stage2h.CHECKSUMS_REL).write_text(
                f"{stage2h.EXPECTED_ARCHIVE_SHA}  {stage2h.ARCHIVE_NAME}\n", encoding="utf-8")
            with self.assertRaises(stage2h.stage2f.EvidenceError):
                stage2h.validate_reference_assets(root)

    def test_package_hash_mismatch_prevents_any_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "C8-v14.flac").write_bytes(b"not the pinned source")
            hashes = {"packageFiles": [{"path": "C8-v14.flac", "sha256": "0" * 64}]}
            fixture = {"directCells": []}
            with mock.patch.dict("os.environ", {"SUPERSYNTH_V9_SALAMANDER_REF": str(root)}):
                with mock.patch.object(stage2h, "decode_and_measure") as decode:
                    result, _ = stage2h.optional_source_reanalysis(Path.cwd(), fixture, hashes)
            self.assertEqual(result["status"], "FAIL")
            self.assertEqual(result["decodedSamples"], 0)
            decode.assert_not_called()

    def source_reanalysis_fixture(self, root):
        rows = []
        package_files = []
        for index, (pitch, velocity) in enumerate(stage2h.C8_KEYS):
            relative = f"samples/c8-{pitch}-{velocity}.flac"
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"verified fixture sample {index}".encode())
            metrics = {"envelopeDbfs": [-40.0 - index - i for i in range(5)],
                       "envelope20msDbfs": [-35.0 - index - i / 10 for i in range(18)],
                       "peakDbfs": -12.0 - index}
            rows.append({"pitch": pitch, "velocity": velocity, "sample": relative, "metrics": metrics})
            package_files.append({"path": relative, "sha256": stage2h.sha(path)})
        for index in range(643 - len(package_files)):
            relative = f"inventory/asset-{index}.bin"
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"asset {index}".encode())
            package_files.append({"path": relative, "sha256": stage2h.sha(path)})
        hashes = {"packageFiles": package_files}
        return {"directCells": rows}, hashes, rows

    def test_optional_source_reanalysis_passes_without_onset_metric(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture, hashes, rows = self.source_reanalysis_fixture(root)
            measured = {(row["pitch"], row["velocity"]): copy.deepcopy(row["metrics"]) for row in rows}
            with mock.patch.dict("os.environ", {"SUPERSYNTH_V9_SALAMANDER_REF": str(root)}):
                with mock.patch.object(stage2h.shutil, "which", side_effect=lambda name: name):
                    with mock.patch.object(stage2h, "decode_and_measure",
                                           side_effect=lambda path, pitch, flac, node:
                                           measured[next(key for key in measured if f"{key[0]}-{key[1]}" in path.name)]) as decode:
                        result, protected = stage2h.optional_source_reanalysis(Path.cwd(), fixture, hashes)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["decodedSamples"], 5)
            self.assertEqual(result["maximumAbsoluteDeltas"], {
                "envelopeDbfs": 0.0, "envelope20msDbfs": 0.0, "peakDbfs": 0.0})
            self.assertTrue(all("onsetMs" not in row["maxAbsDeltas"] for row in result["samples"]))
            self.assertEqual(len(protected), 643)
            self.assertEqual(decode.call_count, 5)

    def test_optional_source_reanalysis_missing_metric_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture, hashes, rows = self.source_reanalysis_fixture(root)
            bad_metrics = copy.deepcopy(rows[0]["metrics"])
            bad_metrics.pop("envelope20msDbfs")
            with mock.patch.dict("os.environ", {"SUPERSYNTH_V9_SALAMANDER_REF": str(root)}):
                with mock.patch.object(stage2h.shutil, "which", side_effect=lambda name: name):
                    with mock.patch.object(stage2h, "decode_and_measure", return_value=bad_metrics) as decode:
                        result, _ = stage2h.optional_source_reanalysis(Path.cwd(), fixture, hashes)
            self.assertEqual(result["status"], "FAIL")
            self.assertEqual(result["decodedSamples"], 0)
            self.assertEqual(result["reason"], "redecoded window metric coverage differs")
            decode.assert_called_once()


if __name__ == "__main__":
    unittest.main()
