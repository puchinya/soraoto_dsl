#!/usr/bin/env python3
"""Read-only reconstruction of Stage2F C8 windows and selected velocity spans."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze_stage2f_v2_residuals as stage2f  # noqa: E402

DEFAULT_RESULTS = ROOT / stage2f.DEFAULT_RESULTS
DEFAULT_OUTPUT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2h/window-span-attribution.json"
FIXTURE_REL = Path("wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json")
HASHES_REL = Path("wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-file-hashes.json")
SUBSET_REL = Path(".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json")
CHECKSUMS_REL = Path("wasm/plugins/dsp/super-synth/test/reference/salamander-provenance/SHA256SUMS.txt")
METRICS_MODULE_REL = Path("wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs")
ARCHIVE_NAME = "SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz"
EXPECTED_ARCHIVE_SHA = "b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b"
EXPECTED_PITCHES = list(range(21, 109, 3))
EXPECTED_VELOCITIES = [14, 31, 36, 40, 45, 49, 54, 61, 69, 77, 85, 93, 101, 109, 117, 124]
C8_KEYS = ((108, 14), (108, 31), (108, 40), (108, 61), (105, 14))
SPAN_TARGETS = {
    ("0015", "L1"): (45, 90, 99), ("0016", "L1"): (45, 90, 99),
    ("0015", "L3"): (93, 108), ("0016", "L3"): (93, 108),
}
POST_LIMIT_DB = 10.0
SPAN_LIMIT_DB = 8.0
TOLERANCE_DB = 1e-9
RAW_METRIC_TOLERANCE = 1e-6
NODE_DECODE_SCRIPT = r"""
const fs = require('node:fs');
const {decodeWav24Stereo, analyzeStereo} = require(process.env.STAGE2H_METRICS_MODULE);
const pitch = Number(process.env.STAGE2H_PITCH);
const decoded = decodeWav24Stereo(fs.readFileSync(0));
const result = analyzeStereo(decoded.left, decoded.right, pitch, {sampleRate: decoded.sampleRate});
process.stdout.write(JSON.stringify({envelopeDbfs: result.envelopeDbfs,
  envelope20msDbfs: result.envelope20msDbfs, peakDbfs: result.peakDbfs}));
"""


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fail(message: str, path: Path | None = None) -> None:
    raise stage2f.EvidenceError("BLOCKED_EVIDENCE_IDENTITY", message,
                                stage2f.rel(path) if path is not None else None)


def finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        fail(f"{label} must be finite")
    return float(value)


def close(stored: Any, computed: float, label: str, tolerance: float = TOLERANCE_DB) -> None:
    actual = finite(stored, label)
    if abs(actual - computed) > tolerance:
        fail(f"{label} mismatch: delta={actual - computed:.12g} dB")


def safe_relative(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        fail(f"{label} must be a non-empty relative path")
    portable = value.replace("\\", "/")
    path = Path(portable)
    if path.is_absolute() or ".." in path.parts or (len(portable) > 1 and portable[1] == ":"):
        fail(f"{label} is not a safe package-relative path")
    return portable


def validate_fixture_matrix(fixture: dict[str, Any]) -> dict[tuple[int, int], dict[str, Any]]:
    pitches = fixture.get("coverage", {}).get("pitches")
    velocities = fixture.get("coverage", {}).get("velocityRepresentatives")
    cells = fixture.get("directCells")
    if pitches != EXPECTED_PITCHES or velocities != EXPECTED_VELOCITIES or not isinstance(cells, list) or len(cells) != 480:
        fail("reference fixture must contain the exact 30 by 16 direct matrix")
    fixture_map: dict[tuple[int, int], dict[str, Any]] = {}
    for cell in cells:
        key = (int(cell.get("pitch", -1)), int(cell.get("velocity", -1)))
        if key in fixture_map or key[0] not in EXPECTED_PITCHES or key[1] not in EXPECTED_VELOCITIES:
            fail("reference fixture direct-cell key is duplicated or unexpected")
        metric = cell.get("metrics", {})
        levels = metric.get("envelopeDbfs")
        if not isinstance(levels, list) or len(levels) != 5:
            fail("reference fixture must preserve all five absolute windows")
        for index, value in enumerate(levels):
            finite(value, f"reference envelopeDbfs[{index}]")
        safe_relative(cell.get("sample"), "fixture sample")
        fixture_map[key] = cell
    expected = {(pitch, velocity) for pitch in EXPECTED_PITCHES for velocity in EXPECTED_VELOCITIES}
    if set(fixture_map) != expected:
        fail("reference fixture coverage is not exactly 480 unique cells")
    return fixture_map


def validate_subset_keys(subset: dict[str, Any]) -> set[tuple[int, int]]:
    subset_cells = subset.get("cells")
    if not isinstance(subset_cells, list) or not subset_cells:
        fail("diagnostic subset has no selected cells")
    subset_keys = [(int(cell.get("pitch", -1)), int(cell.get("velocity", -1))) for cell in subset_cells]
    if len(set(subset_keys)) != len(subset_keys):
        fail("diagnostic subset contains duplicate pitch/velocity keys")
    subset_set = set(subset_keys)
    if not set(C8_KEYS).issubset(subset_set):
        fail("diagnostic subset is missing a required C8/control cell")
    for (anchor, point), target_pitches in SPAN_TARGETS.items():
        for pitch in target_pitches:
            if not all((pitch, velocity) in subset_set for velocity in EXPECTED_VELOCITIES):
                fail(f"diagnostic subset is missing a required 16-layer span curve for {anchor}/{point}/{pitch}")
    return subset_set


def validate_reference_assets(root: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], set[tuple[int, int]], list[Path]]:
    fixture_path, hashes_path = root / FIXTURE_REL, root / HASHES_REL
    subset_path, checksums_path = root / SUBSET_REL, root / CHECKSUMS_REL
    fixture = stage2f.read_json(fixture_path)
    hashes = stage2f.read_json(hashes_path)
    subset = stage2f.read_json(subset_path)
    if fixture.get("schemaVersion") != 3 or fixture.get("source", {}).get("name") != "Salamander Grand Piano V3":
        fail("reference fixture schema/source mismatch", fixture_path)
    fixture_sha = sha(fixture_path)
    if subset.get("referenceFixtureSha256") != fixture_sha:
        fail("diagnostic subset does not bind the current reference fixture SHA", subset_path)
    if subset.get("subsetSha256") != stage2f.canonical_sha({k: v for k, v in subset.items() if k != "subsetSha256"}):
        fail("diagnostic subset canonical SHA mismatch", subset_path)
    if subset.get("subsetSha256") != json.loads((root / ".agent-state/issues/7/calibration-optuna/stage2b/run-manifest.json").read_text(encoding="utf-8")).get("subsetSha256"):
        fail("diagnostic subset differs from its Stage2B run manifest", subset_path)

    source, hash_source = fixture.get("source", {}), hashes.get("source", {})
    archive_sha = source.get("archiveSha256")
    if (not isinstance(archive_sha, str) or archive_sha != EXPECTED_ARCHIVE_SHA
            or hash_source.get("archiveSha256") != archive_sha):
        fail("fixture and package hash index do not identify the pinned source archive", hashes_path)
    if source.get("sfzSha256") != hash_source.get("primarySfzSha256"):
        fail("fixture and package hash index SFZ identity mismatch", hashes_path)
    checksum_lines = checksums_path.read_text(encoding="utf-8").splitlines()
    listed = [line.split()[0] for line in checksum_lines
              if len(line.split()) >= 2 and line.split()[-1] == ARCHIVE_NAME]
    if listed != [archive_sha]:
        fail("tracked source checksum does not match the fixture archive identity", checksums_path)
    package_files, provenance_files = hashes.get("packageFiles"), hashes.get("provenanceFiles")
    if (hashes.get("schemaVersion") != 1 or not isinstance(package_files, list) or len(package_files) != 643
            or not isinstance(provenance_files, list) or len(provenance_files) != 4
            or hash_source.get("uniqueReferencedAudioFiles") != 641):
        fail("tracked reference package hash inventory is incomplete", hashes_path)
    for row in package_files + provenance_files:
        safe_relative(row.get("path"), "reference hash path")
        if not isinstance(row.get("sha256"), str) or len(row["sha256"]) != 64:
            fail("reference hash inventory contains an invalid SHA-256", hashes_path)

    fixture_map = validate_fixture_matrix(fixture)
    subset_set = validate_subset_keys(subset)
    protected = [fixture_path, hashes_path, subset_path, checksums_path,
                 root / ".agent-state/issues/7/calibration-optuna/stage2b/run-manifest.json"]
    return fixture, hashes, subset, subset_set, protected


def reconstruct_c8(reference: dict[str, Any], cell: dict[str, Any], shared_gain_offset: Any) -> dict[str, Any]:
    metric = reference.get("metrics", {})
    envelope = metric.get("envelopeDbfs")
    if not isinstance(envelope, list) or len(envelope) != 5:
        fail("C8 reference window coverage is invalid")
    r3, r4 = finite(envelope[3], "R3"), finite(envelope[4], "R4")
    rr = r4 - r3
    level_error = finite(cell.get("levelErrorDb"), "L levelErrorDb")
    gain = finite(shared_gain_offset, "G sharedGainOffsetDb")
    dr = finite(cell.get("renderLateRelDb"), "DR renderLateRelDb")
    s3 = level_error - gain + r3
    s4 = s3 + dr
    early = finite(cell.get("renderEarlyRelDb"), "renderEarlyRelDb") - finite(
        cell.get("referenceEarlyRelDb"), "referenceEarlyRelDb")
    late = dr - rr
    shape_error = max(abs(early), abs(late))
    shape_violation = shape_error - POST_LIMIT_DB
    close(cell.get("referenceLateRelDb"), rr, "saved referenceLateRelDb")
    close(cell.get("earlyResidualDb"), early, "saved earlyResidualDb")
    close(cell.get("lateResidualDb"), late, "saved lateResidualDb")
    close(cell.get("postAttackShapeErrorDb"), shape_error, "saved postAttackShapeErrorDb")
    close(cell.get("postAttackShapeViolationDb"), shape_violation, "saved postAttackShapeViolationDb")
    sentinel = {name: value for name, value in (("R3", r3), ("R4", r4), ("S3", s3), ("S4", s4)) if value == -240.0}
    return {"pitch": int(cell["pitch"]), "velocity": int(cell["velocity"]),
            "R3_reference80_200Dbfs": r3, "R4_reference200_350Dbfs": r4,
            "RR_referenceRelativeDb": rr, "L_levelErrorDb": level_error,
            "G_sharedGainOffsetDb": gain, "S3_render80_200Dbfs": s3,
            "S4_render200_350Dbfs": s4, "DR_renderRelativeDb": dr,
            "earlyResidualDb": early, "lateResidualDb": late,
            "shapeErrorDb": shape_error, "shapeViolationDb": shape_violation,
            "rmsSentinelsMinus240": sentinel,
            "reconcilesStoredMetrics": True}


def reconstruct_span_curve(pitch: int, reference_cells: list[dict[str, Any]], render_cells: dict[tuple[int, int], dict[str, Any]],
                           shared_gain_offset: Any, stored_span: dict[str, Any]) -> dict[str, Any]:
    reference_by_velocity = {}
    for row in reference_cells:
        velocity = int(row["velocity"])
        if velocity in reference_by_velocity:
            fail(f"duplicate reference velocity for span pitch {pitch}")
        reference_by_velocity[velocity] = row
    if set(reference_by_velocity) != set(EXPECTED_VELOCITIES):
        fail(f"span pitch {pitch} must include all 16 reference velocity layers")
    gain = finite(shared_gain_offset, "span sharedGainOffsetDb")
    layers = []
    for velocity in EXPECTED_VELOCITIES:
        ref = reference_by_velocity[velocity]
        key = (pitch, velocity)
        if key not in render_cells:
            fail(f"span pitch {pitch} is missing rendered velocity {velocity}")
        render = render_cells[key]
        r3 = finite(ref.get("metrics", {}).get("envelopeDbfs", [])[3], "span R3")
        level_error = finite(render.get("levelErrorDb"), "span levelErrorDb")
        s3 = level_error - gain + r3
        layers.append({"velocity": velocity, "R3_reference80_200Dbfs": r3,
                       "S3_render80_200Dbfs": s3, "layerLevelErrorDb": s3 - r3})
    ref_levels = [row["R3_reference80_200Dbfs"] for row in layers]
    render_levels = [row["S3_render80_200Dbfs"] for row in layers]
    reference_span = max(ref_levels) - min(ref_levels)
    actual_span = max(render_levels) - min(render_levels)
    signed_difference = actual_span - reference_span
    absolute_error = abs(signed_difference)
    violation = absolute_error - SPAN_LIMIT_DB
    close(stored_span.get("actualSpanDb"), actual_span, "saved actualSpanDb")
    close(stored_span.get("referenceSpanDb"), reference_span, "saved referenceSpanDb")
    close(stored_span.get("errorDb"), absolute_error, "saved span errorDb")
    close(stored_span.get("violationDb"), violation, "saved span violationDb")
    return {"pitch": pitch, "actualSpanDb": actual_span, "referenceSpanDb": reference_span,
            "signedSpanDifferenceDb": signed_difference, "absoluteSpanErrorDb": absolute_error,
            "spanViolationDb": violation,
            "direction": "SYNTH_SPAN_GREATER" if signed_difference > 0 else
                         "SYNTH_SPAN_SMALLER" if signed_difference < 0 else "EQUAL",
            "withinExistingEightDbLimit": violation <= 0.0,
            "referenceMinimumVelocities": [layers[i]["velocity"] for i, v in enumerate(ref_levels) if v == min(ref_levels)],
            "referenceMaximumVelocities": [layers[i]["velocity"] for i, v in enumerate(ref_levels) if v == max(ref_levels)],
            "renderMinimumVelocities": [layers[i]["velocity"] for i, v in enumerate(render_levels) if v == min(render_levels)],
            "renderMaximumVelocities": [layers[i]["velocity"] for i, v in enumerate(render_levels) if v == max(render_levels)],
            "layers": layers,
            "allSmallAndSentinelLevelsPreserved": True,
            "rmsSentinelLayers": [row for row in layers if row["R3_reference80_200Dbfs"] == -240.0
                                   or row["S3_render80_200Dbfs"] == -240.0],
            "reconcilesStoredMetrics": True}


def sha_reference_package(reference_root: Path, hashes: dict[str, Any]) -> tuple[list[Path], list[str]]:
    package_files = hashes.get("packageFiles", [])
    protected: list[Path] = []
    errors = []
    resolved_root = reference_root.resolve()
    for row in package_files:
        relative = safe_relative(row.get("path"), "package path")
        path = (reference_root / relative).resolve()
        if resolved_root not in path.parents:
            errors.append("package path escapes reference root")
            continue
        protected.append(path)
        if not path.is_file() or sha(path) != row.get("sha256"):
            errors.append("reference package file hash mismatch")
    return protected, errors


def decode_and_measure(sample_path: Path, pitch: int, flac_bin: str, node_bin: str) -> dict[str, Any]:
    decoded = subprocess.run([flac_bin, "-d", "-c", "--silent", str(sample_path)],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if decoded.returncode != 0:
        raise RuntimeError("FLAC decode failed")
    env = dict(os.environ)
    env["STAGE2H_METRICS_MODULE"] = str(ROOT / METRICS_MODULE_REL)
    env["STAGE2H_PITCH"] = str(pitch)
    measured = subprocess.run([node_bin, "-e", NODE_DECODE_SCRIPT], input=decoded.stdout,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, check=False)
    if measured.returncode != 0:
        raise RuntimeError("reference metrics analysis failed")
    try:
        return json.loads(measured.stdout)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("reference metrics output was invalid") from exc


def optional_source_reanalysis(root: Path, fixture: dict[str, Any], hashes: dict[str, Any]) -> tuple[dict[str, Any], list[Path]]:
    reference_value = os.environ.get("SUPERSYNTH_V9_SALAMANDER_REF")
    if not reference_value:
        return {"status": "NOT_AVAILABLE", "decodedSamples": 0,
                "reason": "verified extracted Salamander package is not configured"}, []
    reference_root = Path(reference_value).expanduser()
    if not reference_root.is_dir():
        return {"status": "FAIL", "decodedSamples": 0, "reason": "configured source package directory is unavailable"}, []
    protected, hash_errors = sha_reference_package(reference_root, hashes)
    if hash_errors:
        return {"status": "FAIL", "decodedSamples": 0,
                "reason": "source package hashes did not verify; decode was not attempted"}, protected
    flac_bin, node_bin = shutil.which("flac"), shutil.which("node")
    if not flac_bin or not node_bin:
        return {"status": "NOT_AVAILABLE", "decodedSamples": 0,
                "reason": "verified package exists but FLAC or Node decoder is unavailable"}, protected
    fixture_map = {(int(row["pitch"]), int(row["velocity"])): row for row in fixture["directCells"]}
    sample_rows = []
    max_abs_deltas = {key: 0.0 for key in ("envelopeDbfs", "envelope20msDbfs", "peakDbfs")}
    try:
        for pitch, velocity in C8_KEYS:
            ref = fixture_map[(pitch, velocity)]
            relative = safe_relative(ref.get("sample"), "reference sample")
            sample_path = (reference_root / relative).resolve()
            if reference_root.resolve() not in sample_path.parents or not sample_path.is_file():
                raise RuntimeError("fixture-selected source sample is missing")
            measured = decode_and_measure(sample_path, pitch, flac_bin, node_bin)
            expected = ref["metrics"]
            deltas: dict[str, float] = {}
            expected_lengths = {"envelopeDbfs": 5, "envelope20msDbfs": 18}
            for key, expected_length in expected_lengths.items():
                actual_values, expected_values = measured.get(key), expected.get(key)
                if (not isinstance(actual_values, list) or len(actual_values) != expected_length
                        or not isinstance(expected_values, list) or len(expected_values) != expected_length):
                    raise RuntimeError("redecoded window metric coverage differs")
                delta = max(abs(finite(a, key) - finite(e, key)) for a, e in zip(actual_values, expected_values))
                deltas[key] = delta
            for key in ("peakDbfs",):
                deltas[key] = abs(finite(measured.get(key), key) - finite(expected.get(key), key))
            for key, delta in deltas.items():
                max_abs_deltas[key] = max(max_abs_deltas[key], delta)
                if delta > RAW_METRIC_TOLERANCE:
                    raise RuntimeError("redecoded source metric differs from committed fixture")
            sample_rows.append({"pitch": pitch, "velocity": velocity, "result": "PASS", "maxAbsDeltas": deltas})
    except (RuntimeError, KeyError, TypeError, ValueError, stage2f.EvidenceError) as exc:
        return {"status": "FAIL", "decodedSamples": len(sample_rows),
                "reason": str(exc) if str(exc) in ("FLAC decode failed", "reference metrics analysis failed",
                    "reference metrics output was invalid", "fixture-selected source sample is missing",
                    "redecoded window metric coverage differs", "redecoded source metric differs from committed fixture")
                    else "source reanalysis did not complete", "samples": sample_rows}, protected
    return {"status": "PASS", "decodedSamples": len(sample_rows), "toleranceDb": RAW_METRIC_TOLERANCE,
            "samples": sample_rows, "maximumAbsoluteDeltas": max_abs_deltas}, protected


def build_report(candidates: list[dict[str, Any]], evidence: dict[str, Any], fixture: dict[str, Any],
                 subset_keys: set[tuple[int, int]], source_audit: dict[str, Any]) -> dict[str, Any]:
    fixture_map = {(int(row["pitch"]), int(row["velocity"])): row for row in fixture["directCells"]}
    c8_rows = []
    sentinel_cells = []
    for candidate in sorted(candidates, key=lambda row: row["candidateId"]):
        direct = candidate["raw"].get("directProxy", {})
        rendered = {(int(cell["pitch"]), int(cell["velocity"])): cell for cell in direct.get("cells", [])}
        if len(rendered) != len(direct.get("cells", [])) or set(rendered) != subset_keys:
            fail("candidate direct cell coverage does not equal the preserved diagnostic subset")
        gain = direct.get("sharedGainOffsetDb")
        for key in C8_KEYS:
            if key not in subset_keys:
                continue
            reconstructed = reconstruct_c8(fixture_map[key], rendered[key], gain)
            reconstructed["candidateId"] = candidate["candidateId"]
            reconstructed["requiredC8Probe"] = key == (108, 14)
            reconstructed["controlProbe"] = key != (108, 14)
            c8_rows.append(reconstructed)
            if reconstructed["rmsSentinelsMinus240"]:
                sentinel_cells.append({"candidateId": candidate["candidateId"], "pitch": key[0],
                                      "velocity": key[1], "metrics": reconstructed["rmsSentinelsMinus240"]})

    byid = {candidate["candidateId"]: candidate for candidate in candidates}
    curves = []
    for (anchor, point), pitches in SPAN_TARGETS.items():
        candidate_id = f"stage2f-split-v3-s2-{anchor}-{point}"
        if candidate_id not in byid:
            fail(f"required span candidate is missing: {anchor}/{point}")
        candidate = byid[candidate_id]
        direct = candidate["raw"].get("directProxy", {})
        rendered = {(int(cell["pitch"]), int(cell["velocity"])): cell for cell in direct.get("cells", [])}
        saved_spans = {int(row["pitch"]): row for row in direct.get("velocity", [])}
        validated_spans = {int(row["pitch"]): row for row in candidate["spanRows"]}
        for pitch in pitches:
            if pitch not in saved_spans or pitch not in validated_spans:
                fail(f"saved dynamic span row missing for {anchor}/{point}/{pitch}")
            ref_rows = [row for row in fixture["directCells"] if int(row["pitch"]) == pitch]
            curve = reconstruct_span_curve(pitch, ref_rows, rendered, direct.get("sharedGainOffsetDb"), saved_spans[pitch])
            for key in ("actualSpanDb", "referenceSpanDb", "errorDb", "violationDb"):
                close(validated_spans[pitch].get(key), finite(saved_spans[pitch].get(key), key),
                      f"validated span {key}")
            curve.update({"anchor": anchor, "point": point, "candidateId": candidate_id})
            curves.append(curve)
    by_curve = {(row["anchor"], row["point"], row["pitch"]): row for row in curves}
    c45a, c45b = by_curve[("0015", "L1", 45)], by_curve[("0016", "L1", 45)]
    directions = (c45a["direction"], c45b["direction"])
    common45 = {"pitch": 45, "anchor0015L1Direction": directions[0], "anchor0016L1Direction": directions[1],
                "directionsAgree": directions[0] == directions[1],
                "signedDifferenceDeltaDb": c45b["signedSpanDifferenceDb"] - c45a["signedSpanDifferenceDb"],
                "anchor0015L1SignedDifferenceDb": c45a["signedSpanDifferenceDb"],
                "anchor0016L1SignedDifferenceDb": c45b["signedSpanDifferenceDb"]}
    c8_small_levels = {}
    for name in ("R3_reference80_200Dbfs", "R4_reference200_350Dbfs",
                 "S3_render80_200Dbfs", "S4_render200_350Dbfs"):
        values = [row[name] for row in c8_rows]
        c8_small_levels[name] = {"minimumDbfs": min(values), "maximumDbfs": max(values)}
    lowest_render_late = min(row["S4_render200_350Dbfs"] for row in c8_rows)
    return {"schemaVersion": 1, "status": "COMPLETE_NUMERIC_WINDOW_SPAN_AUDIT",
            "generatedAt": datetime.now(timezone.utc).isoformat(), "renderCount": 0,
            "stage3Or4Run": False, "stage2FeasibilityClaim": False,
            "evidence": {**evidence, "candidateCount": len(candidates)},
            "reference": {"fixtureSha256": evidence["referenceFixtureSha256"],
                          "subsetSha256": evidence["subsetSha256"],
                          "sourceArchiveSha256": fixture["source"]["archiveSha256"],
                          "sourceArchiveIdentityVerified": True,
                          "directFixtureCellCount": len(fixture["directCells"])},
            "c8WindowAudit": {"windowNamesMs": [[0, 10], [10, 30], [30, 80], [80, 200], [200, 350]],
                              "cellCount": len(c8_rows), "requiredProbeCount": sum(r["requiredC8Probe"] for r in c8_rows),
                              "controlCellKeys": [[p, v] for p, v in C8_KEYS if (p, v) in subset_keys and (p, v) != (108, 14)],
                              "rmsSentinelCount": len(sentinel_cells), "rmsSentinelsMinus240": sentinel_cells,
                              "measurementAuditStatus": "REFERENCE_OR_MEASUREMENT_AUDIT_REQUIRED" if sentinel_cells else "NO_MINUS240_SENTINEL",
                              "smallLevelSummaryDbfs": c8_small_levels,
                              "smallLevelReviewRequired": True,
                              "smallLevelReviewReason": f"lowest reconstructed C8 200-350 ms absolute level is {lowest_render_late:.6f} dBFS; values are retained and no acceptance threshold is inferred",
                              "allReportedLevelsRetainedWithoutThresholding": True,
                              "cells": c8_rows},
            "velocitySpanAudit": {"existingLimitDb": SPAN_LIMIT_DB, "curveCount": len(curves),
                                  "layersPerCurve": len(EXPECTED_VELOCITIES), "commonPitch45Direction": common45,
                                  "curves": curves},
            "originalAudioReanalysis": source_audit,
            "interpretation": {"negativeLateResidualMeansOnly":
                "render 200-350 ms relative level is lower than reference relative to 80-200 ms",
                "physicalCauseConfirmed": False,
                "nextStep": "Any causal model change or new renders require separate design, budget, and Issue approval."}}


def run(results_root: Path, output: Path) -> dict[str, Any]:
    results_root, output = results_root.resolve(), output.resolve()
    if ROOT.resolve() not in results_root.parents:
        fail("results root must remain inside the repository")
    candidates, evidence, protected, _ = stage2f.validate_evidence(ROOT.resolve(), results_root)
    fixture, hashes, subset, subset_keys, additional = validate_reference_assets(ROOT.resolve())
    evidence = {**evidence, "referenceFixtureSha256": sha(ROOT / FIXTURE_REL),
                "subsetSha256": subset["subsetSha256"], "sourceArchiveSha256": fixture["source"]["archiveSha256"]}
    source_audit, source_paths = optional_source_reanalysis(ROOT, fixture, hashes)
    protected_all = sorted(set(protected + additional + source_paths), key=str)
    stage2f.ensure_output_safe(output, results_root, protected_all)
    before = stage2f.snapshot(protected_all)
    report = build_report(candidates, evidence, fixture, subset_keys, source_audit)
    if stage2f.snapshot(protected_all) != before:
        fail("protected Stage2H inputs changed during analysis")
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + f".tmp-{os.getpid()}")
    temp.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(output)
    if stage2f.snapshot(protected_all) != before:
        output.unlink(missing_ok=True)
        fail("protected Stage2H inputs changed before report publication")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results-root", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        report = run(args.results_root, args.output)
        print(json.dumps({"status": report["status"], "candidateCount": report["evidence"]["candidateCount"],
                          "c8Cells": report["c8WindowAudit"]["cellCount"],
                          "spanCurves": report["velocitySpanAudit"]["curveCount"], "renderCount": 0,
                          "originalAudioReanalysis": report["originalAudioReanalysis"]["status"],
                          "protectedFileCount": report["evidence"]["protectedFileCount"],
                          "output": stage2f.rel(args.output)}))
        return 0
    except stage2f.EvidenceError as exc:
        print(json.dumps({"status": exc.status, "message": str(exc), "path": exc.path}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
