#!/usr/bin/env python3
"""Read-only residual attribution for the preserved Stage2F v2 result set."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[6]
DEFAULT_RESULTS = Path(".agent-state/issues/7/calibration-optuna/stage2f-v2/results")
DEFAULT_OUTPUT = Path(".agent-state/issues/7/calibration-optuna/stage2f-v2/diagnostics/residual-attribution.json")
V2_MANIFEST = Path(".agent-state/issues/7/calibration-optuna/stage2f-v2/manifests/stage2f-v2-anchor-manifest.json")
V2_RUN = Path(".agent-state/issues/7/calibration-optuna/stage2f-v2/runs/20260930T133629367177Z.json")
ANCHORS = ("0001", "0015", "0016")
POINTS = tuple(f"L{i}" for i in range(1, 8))
POST_LIMIT = 10.0
SPAN_LIMIT = 8.0
SENTINEL_KEYS = {(pitch, velocity) for pitch in (21, 36, 48, 60, 72, 84, 96, 108)
                 for velocity in (14, 61, 124)}


class EvidenceError(Exception):
    def __init__(self, status: str, message: str, path: str | None = None):
        super().__init__(message)
        self.status, self.path = status, path


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return path.name


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def canonical_sha(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def read_json(path: Path) -> Any:
    if not path.is_file():
        raise EvidenceError("BLOCKED_MISSING_PRIVATE_EVIDENCE", "required private evidence file missing", rel(path))
    try:
        return json.loads(path.read_text(encoding="utf-8"),
                          parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"JSON read/parse failed ({type(exc).__name__})", rel(path)) from exc


def number(value: Any, label: str, path: Path) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"{label} must be finite", rel(path))
    return float(value)


def exact(stored: Any, calculated: float, label: str, path: Path) -> None:
    value = number(stored, label, path)
    if value != calculated:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY",
                            f"{label} mismatch: stored={value!r}, recomputed={calculated!r}", rel(path))


def constraint_keys() -> tuple[str, ...]:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from constraints import STAGE2E_CONSTRAINT_KEYS
    except Exception as exc:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "cannot load authoritative constraint schema") from exc
    keys = tuple(STAGE2E_CONSTRAINT_KEYS)
    if len(keys) != 32:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"authoritative schema has {len(keys)} keys, expected 32")
    return keys


def expected_points(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from stage2f_anchored import local_points
        result: dict[str, dict[str, Any]] = {}
        for anchor in manifest["anchors"]:
            suffix = str(anchor["historicalResultId"]).rsplit("-", 1)[-1]
            for point in local_points(anchor):
                cid = f"stage2f-split-v3-s2-{suffix}-{point['point']}"
                result[cid] = {"anchor": anchor, "point": point}
        return result
    except (KeyError, TypeError, ValueError) as exc:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "manifest cannot resolve local point vectors") from exc


def ids_expected() -> set[str]:
    return {f"stage2f-split-v3-s2-{anchor}-{point}" for anchor in ANCHORS for point in POINTS}


def recompute_cell(cell: dict[str, Any], path: Path) -> dict[str, Any]:
    early = number(cell.get("renderEarlyRelDb"), "renderEarlyRelDb", path) - number(
        cell.get("referenceEarlyRelDb"), "referenceEarlyRelDb", path)
    late = number(cell.get("renderLateRelDb"), "renderLateRelDb", path) - number(
        cell.get("referenceLateRelDb"), "referenceLateRelDb", path)
    shape = max(abs(early), abs(late))
    violation = shape - POST_LIMIT
    exact(cell.get("earlyResidualDb"), early, "earlyResidualDb", path)
    exact(cell.get("lateResidualDb"), late, "lateResidualDb", path)
    exact(cell.get("postAttackShapeErrorDb"), shape, "postAttackShapeErrorDb", path)
    exact(cell.get("postAttackShapeViolationDb"), violation, "postAttackShapeViolationDb", path)
    dominant = "EARLY" if abs(early) > abs(late) else "LATE" if abs(late) > abs(early) else "TIE"
    if cell.get("dominantResidual") != dominant:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "dominantResidual mismatch", rel(path))
    return {"pitch": int(cell["pitch"]), "velocity": int(cell["velocity"]), "earlyDb": early,
            "lateDb": late, "shapeDb": shape, "violationDb": violation, "dominant": dominant}


def ensure_finite_tree(value: Any, label: str, path: Path) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"nonfinite value at {label}", rel(path))
    if isinstance(value, dict):
        for key, child in value.items():
            ensure_finite_tree(child, f"{label}.{key}", path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            ensure_finite_tree(child, f"{label}[{index}]", path)


def validate_result_file_set(paths: list[Path]) -> None:
    stems = [path.stem for path in paths]
    counts = Counter(stems)
    duplicate = sorted(name for name, count in counts.items() if count > 1)
    missing = sorted(ids_expected() - set(stems))
    extra = sorted(set(stems) - ids_expected())
    if missing:
        raise EvidenceError("BLOCKED_MISSING_PRIVATE_EVIDENCE",
                            f"required candidate result missing; missing={missing}, duplicate={duplicate}, unexpected={extra}")
    if len(paths) != 21 or duplicate or extra:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY",
                            f"result set must be exactly 21; duplicate={duplicate}, unexpected={extra}")


def validate_candidate(result: dict[str, Any], path: Path, expected: dict[str, Any],
                       keys: tuple[str, ...], common_identity: dict[str, Any] | None) -> dict[str, Any]:
    cid = result.get("candidateId")
    if cid not in expected or result.get("result") != "COMPLETE" or result.get("stageReached") != 2 or result.get("stage2bReached") is not True:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"unexpected or incomplete candidate {cid!r}", rel(path))
    spec = expected[cid]
    expected_parameters = spec["point"].get(
        "parameters", {key: value for key, value in spec["point"].items() if key != "point"})
    if result.get("parameters") != expected_parameters:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "parameters do not match anchor local_points", rel(path))
    for key in ("sourceRevision", "evaluatorSha256", "subsetSha256"):
        if not isinstance(result.get(key), str) or not result[key]:
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"missing {key}", rel(path))
    if result.get("productionSimd") is not True:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "productionSimd must be true", rel(path))
    identity = {key: result.get(key) for key in ("sourceRevision", "evaluatorSha256", "subsetSha256", "productionSimd")}
    if common_identity and identity != common_identity:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "source/evaluator/subset/SIMD identity differs across candidates", rel(path))
    constraints = result.get("constraints")
    if not isinstance(constraints, dict) or len(constraints) != 32 or set(constraints) != set(keys):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "constraints must contain exactly the 32 authoritative keys", rel(path))
    if result.get("constraintSchema") != list(keys):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "constraintSchema differs from authoritative ordered schema", rel(path))
    for name, value in constraints.items():
        number(value, f"constraints.{name}", path)
    for section in ("metrics", "directProxy", "stage1Metrics", "stage2Metrics", "heldReleaseDiagnostics"):
        ensure_finite_tree(result.get(section), section, path)
    direct = result.get("directProxy", {})
    cells = direct.get("cells")
    if not isinstance(cells, list) or not cells:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "directProxy.cells missing or empty", rel(path))
    residuals = [recompute_cell(cell, path) for cell in cells]
    post = result.get("metrics", {}).get("directProxy", {}).get("postAttackShape", {})
    max_post = max(row["violationDb"] for row in residuals)
    exact(post.get("maxViolationDb"), max_post, "postAttackShape.maxViolationDb", path)
    post_fails = sum(row["violationDb"] > 0 for row in residuals)
    if post.get("failCount") != post_fails:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "postAttackShape.failCount mismatch", rel(path))
    velocity = direct.get("velocity")
    if not isinstance(velocity, list) or len(velocity) != 16:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "velocity spans must include all 16 direct pitches", rel(path))
    spans, seen = [], set()
    for row in velocity:
        pitch = int(row["pitch"])
        if pitch in seen:
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"duplicate velocity pitch {pitch}", rel(path))
        seen.add(pitch)
        error = abs(number(row.get("actualSpanDb"), "actualSpanDb", path) -
                    number(row.get("referenceSpanDb"), "referenceSpanDb", path))
        violation = error - SPAN_LIMIT
        exact(row.get("errorDb"), error, "velocity.errorDb", path)
        exact(row.get("violationDb"), violation, "velocity.violationDb", path)
        spans.append({"pitch": pitch, "errorDb": error, "violationDb": violation})
    dynamic = result.get("metrics", {}).get("directProxy", {}).get("dynamicSpan", {})
    stored_per_pitch = dynamic.get("perPitch")
    if not isinstance(stored_per_pitch, list) or len(stored_per_pitch) != len(spans):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "dynamicSpan.perPitch must match the 16 stored spans", rel(path))
    stored_by_pitch = {int(row["pitch"]): row for row in stored_per_pitch}
    if len(stored_by_pitch) != len(stored_per_pitch):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "duplicate metrics.dynamicSpan.perPitch pitch", rel(path))
    for row in spans:
        aggregate_row = stored_by_pitch.get(row["pitch"])
        if aggregate_row is None:
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "dynamicSpan.perPitch pitch mismatch", rel(path))
        exact(aggregate_row.get("errorDb"), row["errorDb"], "dynamicSpan.perPitch.errorDb", path)
        exact(aggregate_row.get("violationDb"), row["violationDb"], "dynamicSpan.perPitch.violationDb", path)
    max_span, max_error = max(r["violationDb"] for r in spans), max(r["errorDb"] for r in spans)
    exact(dynamic.get("maxViolationDb"), max_span, "dynamicSpan.maxViolationDb", path)
    exact(dynamic.get("maxAbsoluteErrorDb"), max_error, "dynamicSpan.maxAbsoluteErrorDb", path)
    span_fails = sum(r["violationDb"] > 0 for r in spans)
    if dynamic.get("failingPitchCount") != span_fails:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "dynamicSpan.failingPitchCount mismatch", rel(path))
    pitch_cells = result.get("stage2Metrics", {}).get("pitchCells")
    if not isinstance(pitch_cells, list) or len(pitch_cells) != 24:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "stage2 pitchCells must contain 24 sentinel cells", rel(path))
    pitch_rows = []
    for cell in pitch_cells:
        measurement = cell.get("pitchMeasurement", {})
        valid = measurement.get("measurement_valid") is True
        error = number(measurement.get("pitch_error_cents"), "pitch_error_cents", path) if valid else None
        pitch_rows.append({"pitch": int(cell["pitch"]), "velocity": int(cell["velocity"]), "valid": valid,
                           "errorCents": error, "failed": bool(valid and abs(error) > 15.0)})
    observed_pitch_keys = {(row["pitch"], row["velocity"]) for row in pitch_rows}
    invalid_count = sum(not row["valid"] for row in pitch_rows)
    reported_invalid = result.get("stage2Metrics", {}).get("measurementInvalidCount")
    if observed_pitch_keys != SENTINEL_KEYS or len(observed_pitch_keys) != 24:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "stage2 pitchCells do not match the exact 24 sentinel set", rel(path))
    if reported_invalid != invalid_count:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "measurementInvalidCount differs from pitchCells", rel(path))
    return {"candidateId": cid, "anchor": spec["anchor"], "point": spec["point"]["point"],
            "parameters": result["parameters"], "constraints": constraints, "cells": residuals, "spanRows": spans,
            "pitchRows": pitch_rows, "postMax": max_post, "postFails": post_fails, "spanMax": max_span,
            "spanError": max_error, "spanFails": span_fails, "raw": result, "path": rel(path)}


def verify_oat(base: dict[str, Any], changed: dict[str, Any], axis: str) -> dict[str, Any]:
    names = {"hardness": "hammer.velocity_hardness_amount",
             "terminationLossFloor": "termination_loss_floor_scale",
             "stringDamping": "piano_string_damping"}
    target = names[axis]
    a, b = base["parameters"], changed["parameters"]
    diffs = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    if diffs != [target]:
        return {"status": "REJECTED_NOT_ONE_FACTOR", "changedParameters": diffs}
    return {"status": "VALID_OAT", "axis": target, "from": a[target], "to": b[target]}


def candidate_public(c: dict[str, Any]) -> dict[str, Any]:
    stage2 = c["raw"].get("stage2Metrics", {})
    independent = [k for k, v in c["constraints"].items() if float(v) > 0 and
                   k not in ("stage1_violation", "stage2_violation", "stage2b_violation")]
    return {"candidateId": c["candidateId"], "anchorId": c["anchor"]["historicalResultId"], "point": c["point"],
            "postAttack": {"result": "PASS" if c["postMax"] <= 0 else "FAIL",
                           "maxViolationDb": c["postMax"], "failCells": c["postFails"]},
            "dynamicSpan": {"result": "PASS" if c["spanMax"] <= 0 else "FAIL", "maxViolationDb": c["spanMax"],
                            "maxAbsoluteErrorDb": c["spanError"], "failingPitches": c["spanFails"]},
            "safety": {"peakWorstDbfs": stage2.get("peakDbfs"), "guardHitTotal": stage2.get("guardHits"),
                       "finite": stage2.get("finite"), "lowRegisterBuzz": stage2.get("lowRegisterBuzz"),
                       "tail2": c["raw"].get("heldReleaseDiagnostics", {}).get("releaseTail2"),
                       "measurementInvalidCount": stage2.get("measurementInvalidCount"),
                       "worstAbsolutePitchErrorCents": max(
                           (abs(row["errorCents"]) for row in c["pitchRows"] if row["valid"]), default=None),
                       "releaseFinite": c["raw"].get("heldReleaseDiagnostics", {}).get("finiteRelease"),
                       "stuckVoiceCount": c["raw"].get("heldReleaseDiagnostics", {}).get("stuckVoiceCount"),
                       "positiveIndependentConstraints": sorted(independent)}}


def build_report(candidates: list[dict[str, Any]], evidence: dict[str, Any]) -> dict[str, Any]:
    byid = {c["candidateId"]: c for c in candidates}
    rows = [r for c in candidates for r in c["cells"]]
    ec = Counter("positive" if r["earlyDb"] > 0 else "negative" if r["earlyDb"] < 0 else "zero" for r in rows)
    lc = Counter("positive" if r["lateDb"] > 0 else "negative" if r["lateDb"] < 0 else "zero" for r in rows)
    dom = Counter(r["dominant"] for r in rows)
    maxe, maxl = max(rows, key=lambda r: abs(r["earlyDb"])), max(rows, key=lambda r: abs(r["lateDb"]))
    recurrent = Counter((p["pitch"], p["velocity"]) for c in candidates for p in c["pitchRows"] if p["failed"])
    axes = {"hardness": ("L2", "L3"), "terminationLossFloor": ("L4", "L5"), "stringDamping": ("L6", "L7")}
    oat = {}
    for suffix in ANCHORS:
        base = byid[f"stage2f-split-v3-s2-{suffix}-L1"]
        oat[suffix] = {}
        for axis, labels in axes.items():
            oat[suffix][axis] = []
            for label in labels:
                other = byid[f"stage2f-split-v3-s2-{suffix}-{label}"]
                check = verify_oat(base, other, axis)
                if check["status"] != "VALID_OAT":
                    raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"non-OAT comparison for {suffix}/{label}: {check}")
                ds, dv = other["postMax"] - base["postMax"], other["spanMax"] - base["spanMax"]
                oat[suffix][axis].append({"point": label, **check, "postAttackMaxViolationDeltaDb": ds,
                    "dynamicSpanMaxViolationDeltaDb": dv, "postAttackImproved": ds < 0, "dynamicSpanImproved": dv < 0,
                    "bothImproved": ds < 0 and dv < 0, "simultaneousTradeoff": (ds < 0) != (dv < 0)})
    anchors = {}
    for suffix in ("0015", "0016"):
        c = byid[f"stage2f-split-v3-s2-{suffix}-L1"]
        s2 = c["raw"].get("stage2Metrics", {})
        anchors[suffix] = {"pitch": {"validCells": sum(p["valid"] for p in c["pitchRows"]), "totalCells": 24,
                                     "worstAbsoluteErrorCents": max(
                                         (abs(p["errorCents"]) for p in c["pitchRows"] if p["valid"]), default=None),
                                     "failedCells": [{"pitch": p["pitch"], "velocity": p["velocity"], "errorCents": p["errorCents"]}
                                                     for p in c["pitchRows"] if p["failed"]]},
            "dynamicSpan": {"maxViolationDb": c["spanMax"], "maxAbsoluteErrorDb": c["spanError"], "failingPitchCount": c["spanFails"]},
            "tail2": c["raw"].get("heldReleaseDiagnostics", {}).get("releaseTail2"), "lowRegisterBuzz": s2.get("lowRegisterBuzz"),
            "peakWorstDbfs": s2.get("peakDbfs"), "guardHitTotal": s2.get("guardHits"), "finite": s2.get("finite"),
            "measurementInvalidCount": s2.get("measurementInvalidCount"),
            "releaseFinite": c["raw"].get("heldReleaseDiagnostics", {}).get("finiteRelease"),
            "stuckVoiceCount": c["raw"].get("heldReleaseDiagnostics", {}).get("stuckVoiceCount"),
            "positiveIndependentConstraints": {k: v for k, v in c["constraints"].items() if float(v) > 0 and
                k not in ("stage1_violation", "stage2_violation", "stage2b_violation")}}
    return {"schemaVersion": 1, "status": "COMPLETE_READ_ONLY_ATTRIBUTION",
        "generatedAt": datetime.now(timezone.utc).isoformat(), "renderCount": 0, "stage3Or4Run": False,
        "feasibilityClaim": False, "evidence": evidence, "candidateCount": len(candidates),
        "candidateFamilies": [candidate_public(c) for c in sorted(candidates, key=lambda x: x["candidateId"])],
        "residualDistribution": {"cellCount": len(rows), "earlySignCounts": dict(ec), "lateSignCounts": dict(lc),
            "dominanceCounts": dict(dom), "earlyFailCount": sum(abs(r["earlyDb"]) > POST_LIMIT for r in rows),
            "lateFailCount": sum(abs(r["lateDb"]) > POST_LIMIT for r in rows),
            "maxAbsEarlyDb": abs(maxe["earlyDb"]), "maxEarlyCell": {k: maxe[k] for k in ("pitch", "velocity", "earlyDb")},
            "maxAbsLateDb": abs(maxl["lateDb"]), "maxLateCell": {k: maxl[k] for k in ("pitch", "velocity", "lateDb")}},
        "recurrentPitchFailures": [{"pitch": p, "velocity": v, "candidateCount": n}
                                   for (p, v), n in sorted(recurrent.items(), key=lambda x: (-x[1], x[0]))],
        "anchorSafetyAndCalibration": anchors, "oneFactorComparisons": oat,
        "interpretation": {"observedFailuresAreLocalToThisDesign": True, "physicalModelInfeasibilityProven": False,
            "pitchEstimatorAggregateConformance": "96/96 PASS",
            "physicalPitchTrajectorySubcase": "FAIL; remains unresolved",
            "nextStep": "Use these measurements for a separate design decision; do not infer global infeasibility or run Stage 3/4."}}


def protected_paths(root: Path, results_root: Path, manifest: dict[str, Any], run: dict[str, Any]) -> list[Path]:
    paths = {root / V2_MANIFEST, root / V2_RUN,
             root / ".agent-state/issues/7/calibration-optuna/study.db",
             root / ".agent-state/issues/7/calibration-optuna/stage2e-termination-joint/study.db",
             root / run.get("parentV1ManifestPath", ""),
             root / run.get("parentV1RunPath", "")}
    paths.update(results_root.glob("*.json"))
    paths.update((root / ".agent-state/issues/7/calibration-optuna/stage2f-v2/candidates").glob("*.json"))
    paths.add(root / "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json")
    for anchor in manifest.get("anchors", []):
        for key in ("historicalResultPath", "sourceCandidatePath", "sourceStage2ResultPath", "v1ResultPath"):
            if anchor.get(key):
                paths.add(root / anchor[key])
    return sorted((p.resolve() for p in paths), key=str)


def snapshot(paths: list[Path]) -> dict[str, str]:
    out = {}
    for path in paths:
        if not path.is_file():
            raise EvidenceError("BLOCKED_MISSING_PRIVATE_EVIDENCE", "required private evidence missing", rel(path))
        out[rel(path)] = sha(path)
    return out


def validate_evidence(root: Path, results_root: Path) -> tuple[list[dict[str, Any]], dict[str, Any], list[Path], dict[str, str]]:
    if not results_root.is_dir():
        raise EvidenceError("BLOCKED_MISSING_PRIVATE_EVIDENCE", "private Stage2F v2 result directory missing", rel(results_root))
    mp, rp = root / V2_MANIFEST, root / V2_RUN
    manifest, run = read_json(mp), read_json(rp)
    if manifest.get("canonicalSha256") != canonical_sha({k: v for k, v in manifest.items() if k != "canonicalSha256"}):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "v2 manifest canonical SHA mismatch", rel(mp))
    if run.get("runSha256") != canonical_sha({k: v for k, v in run.items() if k != "runSha256"}):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "v2 run SHA mismatch", rel(rp))
    if run.get("anchorManifestSha256") != manifest.get("canonicalSha256"):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "v2 run does not bind manifest hash", rel(rp))
    v1_manifest_path = root / run.get("parentV1ManifestPath", "")
    v1_manifest = read_json(v1_manifest_path)
    v1_digest = canonical_sha({k: v for k, v in v1_manifest.items() if k != "canonicalSha256"})
    if (v1_manifest.get("canonicalSha256") != v1_digest or
            manifest.get("parentV1ManifestSha256") != v1_digest or
            run.get("parentV1ManifestSha256") != v1_digest):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "v1/v2 parent manifest identity mismatch", rel(v1_manifest_path))
    expected = expected_points(manifest)
    if len(manifest.get("anchors", [])) != 3 or set(expected) != ids_expected():
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "manifest is not the expected three-anchor by seven-point design", rel(mp))
    files = sorted(results_root.glob("*.json"))
    try:
        validate_result_file_set(files)
    except EvidenceError as exc:
        if exc.path is None:
            exc.path = rel(results_root)
        raise
    keys, candidates, common = constraint_keys(), [], None
    for path in files:
        raw = read_json(path)
        if common is None:
            common = {k: raw.get(k) for k in ("sourceRevision", "evaluatorSha256", "subsetSha256", "productionSimd")}
        candidates.append(validate_candidate(raw, path, expected, keys, common))
    anchor_map = {str(a["historicalResultId"]).rsplit("-", 1)[-1]: a for a in manifest["anchors"]}
    for c in candidates:
        suffix = c["candidateId"].split("-")[-2]
        anchor = anchor_map.get(suffix)
        raw = c["raw"]
        if not anchor or raw.get("sourceRevision") != anchor.get("sourceRevision") or raw.get("evaluatorSha256") != anchor.get("evaluatorSha256"):
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "result source/evaluator identity differs from anchor", c["path"])
    cell_keys = None
    span_pitches = None
    pitch_keys = None
    for c in candidates:
        current_cells = {(r["pitch"], r["velocity"]) for r in c["cells"]}
        current_spans = {r["pitch"] for r in c["spanRows"]}
        current_pitch_keys = {(r["pitch"], r["velocity"]) for r in c["pitchRows"]}
        if len(current_cells) != len(c["cells"]) or len(current_pitch_keys) != 24:
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "duplicate direct or sentinel cell identity", c["path"])
        if cell_keys is None:
            cell_keys, span_pitches, pitch_keys = current_cells, current_spans, current_pitch_keys
        elif current_cells != cell_keys or current_spans != span_pitches or current_pitch_keys != pitch_keys:
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "direct or sentinel cell coverage differs across candidates", c["path"])
    inventory = {r.get("candidateId"): r for r in run.get("localCandidates", [])}
    if set(inventory) != ids_expected():
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "run inventory does not enumerate exact 21 results", rel(rp))
    for c in candidates:
        embedded = dict(inventory[c["candidateId"]].get("result", {}))
        embedded.pop("candidateEvidenceReused", None)
        stored = dict(c["raw"])
        stored.pop("candidateEvidenceReused", None)
        if embedded != stored:
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "result differs from preserved run inventory", c["path"])
    if run.get("sourceIdentity", {}).get("sourceRevision") != common.get("sourceRevision"):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "run and results sourceRevision differ", rel(rp))
    # Verify every explicit v1 anchor reference against its preserved manifest digest.
    digest_fields = (("historicalResultPath", "historicalResultSha256"),
                     ("sourceCandidatePath", "sourceCandidateSha256"),
                     ("sourceStage2ResultPath", "sourceStage2ResultSha256"),
                     ("v1ResultPath", "v1ResultSha256"))
    for anchor in manifest["anchors"]:
        for path_key, hash_key in digest_fields:
            if not anchor.get(path_key) or not anchor.get(hash_key):
                raise EvidenceError("BLOCKED_MISSING_PRIVATE_EVIDENCE", f"anchor evidence reference incomplete: {path_key}")
            evidence_path = root / anchor[path_key]
            if not evidence_path.is_file():
                raise EvidenceError("BLOCKED_MISSING_PRIVATE_EVIDENCE", "manifest-referenced v1 evidence missing", rel(evidence_path))
            if sha(evidence_path) != anchor[hash_key]:
                raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", f"manifest SHA mismatch for {path_key}", rel(evidence_path))
    protected = protected_paths(root, results_root, manifest, run)
    hashes = snapshot(protected)
    evidence = {"resultIdentity": common, "v2ManifestSha256": hashes[rel(mp)], "v2RunSha256": hashes[rel(rp)],
                "parentV1ManifestSha256": hashes.get(rel(root / run["parentV1ManifestPath"])),
                "parentV1RunSha256": hashes.get(rel(root / run["parentV1RunPath"])),
                "protectedFileCount": len(hashes), "protectedSha256": hashes}
    return candidates, evidence, protected, hashes


def ensure_output_safe(output: Path, results: Path, protected: list[Path]) -> None:
    out = output.resolve()
    for directory in (results.resolve(), (ROOT / DEFAULT_RESULTS).resolve()):
        if out == directory or directory in out.parents or out in directory.parents:
            raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "output overlaps evidence/result directory", rel(output))
    if any(out == p.resolve() for p in protected):
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "output overlaps protected input", rel(output))
    if (ROOT / ".agent-state/issues/7").resolve() not in out.parents:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "output must stay under .agent-state/issues/7", rel(output))


def run(results_root: Path, output: Path) -> dict[str, Any]:
    root = ROOT.resolve()
    results_root, output = results_root.resolve(), output.resolve()
    if root not in results_root.parents:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "results root must be inside repository", rel(results_root))
    candidates, evidence, protected, before = validate_evidence(root, results_root)
    ensure_output_safe(output, results_root, protected)
    report = build_report(candidates, evidence)
    if snapshot(protected) != before:
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "protected evidence changed during analysis")
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + f".tmp-{os.getpid()}")
    temp.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(output)
    if snapshot(protected) != before:
        output.unlink(missing_ok=True)
        raise EvidenceError("BLOCKED_EVIDENCE_IDENTITY", "protected evidence changed at publication")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results-root", type=Path, default=ROOT / DEFAULT_RESULTS)
    parser.add_argument("--output", type=Path, default=ROOT / DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        result = run(args.results_root, args.output)
        print(json.dumps({"status": result["status"], "candidateCount": result["candidateCount"], "renderCount": 0,
                          "output": rel(args.output), "protectedFileCount": result["evidence"]["protectedFileCount"]}))
        return 0
    except EvidenceError as exc:
        print(json.dumps({"status": exc.status, "message": str(exc), "path": exc.path}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
