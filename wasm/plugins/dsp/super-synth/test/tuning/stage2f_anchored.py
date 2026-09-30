"""Deterministic Stage2F anchor resolution and local-design helpers."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from constraints import STAGE2E_CONSTRAINT_KEYS

ROOT = Path(__file__).resolve().parents[6]
MAX_WINDOW_PITCH_SPREAD_CENTS = 8.0  # Existing MAX_WINDOW_PITCH_SPREAD_CENTS in piano-pitch-estimator.cjs.
ANCHOR_IDS = ("stage2b-v1-0001", "stage2b-v1-0015", "stage2b-v1-0016")
V3_RUN_ID = "stage2-20260928T133429Z"
FROZEN_AXES = (
    "effective_strike_position_c4",
    "hammer.compression_scale",
    "piano_hammer_hardness",
    "piano_inharmonicity",
    "piano_string_unison",
)
ALL_ORIGINAL_AXES = (*FROZEN_AXES, "piano_string_damping")
RELEASE_TAIL2_MIN = 0.00015
MAX_SEED_TAIL2_SHORTFALL = 0.05
# Stage2F is searching these fit constraints locally; seed qualification applies to safety only.
STAGE2F_RECOVERY_OBJECTIVE_KEYS = frozenset({
    "post_attack_shape_violation_db",
    "dynamic_span_violation_db",
    "brightness_direction_violation",
    "direct_level_violation_db",
    "stage2b_violation",
})


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_anchors(root: Path = ROOT) -> list[dict[str, Any]]:
    """Resolve Stage2B result IDs through exact vectors and preserved v3 provenance."""
    base = root / ".agent-state/issues/7/calibration-optuna"
    v3_candidates = base / "gpsampler-split/runs" / V3_RUN_ID / "candidates"
    v3_results = base / "gpsampler-split/results"
    hardness_oat = read_json(base / "stage2d-velocity-hardness/results/stage2d-center-b-a000.json")
    center = hardness_oat.get("stage2dProvenance", {}).get("resolvedCenterCandidateId")
    resolved: list[dict[str, Any]] = []

    for result_id in ANCHOR_IDS:
        result_path = base / "stage2b/results" / f"{result_id}.json"
        candidate_path = base / "stage2b/candidates" / f"{result_id}.json"
        result = read_json(result_path)
        candidate = read_json(candidate_path)
        vector = candidate.get("parameters")
        if result.get("parameters") != vector:
            raise ValueError(f"{result_id}: result and candidate vectors differ")
        if result.get("result") != "COMPLETE" or result.get("stage2bReached") is not True:
            raise ValueError(f"{result_id}: historical Stage2B observation is not complete")

        matches: list[tuple[str, Path]] = []
        for path in sorted(v3_candidates.glob("*.json")):
            source = read_json(path)
            if source.get("parameters") == vector:
                matches.append((str(source.get("candidateId")), path))
        if result_id == "stage2b-v1-0001":
            # Stage2D's preserved source mapping explicitly resolves this anchor across duplicate studies.
            source_id = center
            matches = [match for match in matches if match[0] == source_id]
        if len(matches) != 1:
            raise ValueError(f"{result_id}: expected one provenance-backed v3 vector match, found {len(matches)}")

        source_id, source_candidate_path = matches[0]
        source_result_path = v3_results / f"{source_id}.stage2.json"
        source_result = read_json(source_result_path).get("result", {})
        if source_result.get("candidateId") != source_id or source_result.get("parameters") != vector:
            raise ValueError(f"{result_id}: source Stage-2 result does not match resolved vector/id")
        if source_result.get("result") != "PASS":
            raise ValueError(f"{result_id}: resolved source Stage-2 result is not PASS")

        resolved.append({
            "historicalResultId": result_id,
            "sourceCandidateId": source_id,
            "sourceStage2TrialId": source_id,
            "sourceStage2RunId": V3_RUN_ID,
            "parameters": vector,
            "sourceRevision": result.get("sourceRevision"),
            "historicalSourceTreeSha256": result.get("sourceTreeSha256"),
            "historicalEvaluatorSha256": result.get("evaluatorSha256"),
            "historicalConfigSha256": result.get("configSha256"),
            "historicalWasmSha256": result.get("wasmSha256"),
            "historicalStage2Result": "PASS",
            "historicalResultPath": str(result_path.relative_to(root)),
            "sourceCandidatePath": str(source_candidate_path.relative_to(root)),
            "sourceStage2ResultPath": str(source_result_path.relative_to(root)),
            "historicalResultSha256": hashlib.sha256(result_path.read_bytes()).hexdigest(),
            "sourceCandidateSha256": hashlib.sha256(source_candidate_path.read_bytes()).hexdigest(),
            "sourceStage2ResultSha256": hashlib.sha256(source_result_path.read_bytes()).hexdigest(),
        })
    return resolved


def build_anchor_manifest(root: Path = ROOT) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "resolutionMethod": "exact six-axis parameter vector plus preserved Stage2B-v2/Stage2-v3 provenance",
        "sourceStage2RunId": V3_RUN_ID,
        "anchors": resolve_anchors(root),
    }
    manifest["canonicalSha256"] = canonical_sha256(manifest)
    return manifest


def verify_manifest(manifest: dict[str, Any]) -> bool:
    claimed = manifest.get("canonicalSha256")
    unhashed = {key: value for key, value in manifest.items() if key != "canonicalSha256"}
    return claimed == canonical_sha256(unhashed)


def recoverable_seed_qualification(
    anchor_result_id: str, constraints: dict[str, float], topology: dict[str, float], tail2: float,
) -> tuple[bool, str, list[str], float]:
    """Qualify only the three named search seeds; this never changes candidate feasibility."""
    if anchor_result_id not in ANCHOR_IDS:
        return False, "INELIGIBLE", ["anchor_id_not_authorized"], math.inf
    if not math.isfinite(tail2) or tail2 <= 0.0:
        return False, "INELIGIBLE", ["release_tail2_not_finite_positive"], math.inf
    if tuple(constraints) != STAGE2E_CONSTRAINT_KEYS:
        raise ValueError("recoverable seed requires the complete ordered Stage2E constraint vector")
    for name, value in constraints.items():
        if not math.isfinite(float(value)):
            raise ValueError(f"non-finite Stage2E constraint: {name}")

    shortfall = max(0.0, (RELEASE_TAIL2_MIN - tail2) / RELEASE_TAIL2_MIN)
    failures = [name for name, value in constraints.items()
                if name != "release_tail2_min_violation"
                and name not in STAGE2F_RECOVERY_OBJECTIVE_KEYS
                and float(value) > 0.0]
    if topology.get("pianoStringUnison", -math.inf) < 0.4:
        failures.append("piano_string_unison_below_calibration_floor")
    if topology.get("pianoSoundboardMix", -math.inf) < 0.5:
        failures.append("piano_soundboard_mix_below_0.5")
    if failures:
        return False, "INELIGIBLE", failures, shortfall

    tail2_constraint = float(constraints["release_tail2_min_violation"])
    if tail2 > RELEASE_TAIL2_MIN and tail2_constraint <= 0.0:
        return True, "STAGE2F_SEED", [], 0.0
    minimum_seed_tail2 = RELEASE_TAIL2_MIN * (1.0 - MAX_SEED_TAIL2_SHORTFALL)
    if minimum_seed_tail2 <= tail2 < RELEASE_TAIL2_MIN and tail2_constraint > 0.0:
        return True, "RECOVERABLE_SEED", [], shortfall
    return False, "INELIGIBLE", ["release_tail2_outside_seed_exception"], shortfall


def local_points(anchor: dict[str, Any]) -> list[dict[str, float | str]]:
    params = anchor["parameters"]
    d0 = float(params["piano_string_damping"])
    points = [
        ("L1", 0.50, 0.00, 0.0),
        ("L2", 0.25, 0.00, 0.0),
        ("L3", 0.75, 0.00, 0.0),
        ("L4", 0.50, 0.25, 0.0),
        ("L5", 0.50, 0.50, 0.0),
        ("L6", 0.50, 0.00, 0.5 * d0),
        ("L7", 0.50, 0.00, d0),
    ]
    rows: list[dict[str, float | str]] = []
    for label, hardness, floor, damping in points:
        values: dict[str, float | str] = {key: float(params[key]) for key in ALL_ORIGINAL_AXES}
        values.update({
            "hammer.velocity_hardness_amount": hardness,
            "termination_loss_floor_scale": floor,
            "piano_string_damping": damping,
            "point": label,
        })
        for key in FROZEN_AXES:
            if values[key] != float(params[key]):
                raise AssertionError(f"frozen axis changed: {key}")
        if not 0.0 <= damping <= d0:
            raise AssertionError("local damping escaped [0, anchor damping]")
        rows.append(values)
    return rows


def pitch_diagnostics(metrics: dict[str, Any]) -> dict[str, Any]:
    """Preserve estimator windows; never change the evaluator's hard pitch result."""
    errors: list[float] = []
    invalid = int(metrics.get("measurementInvalidCount", 0) or 0)
    cells = metrics.get("pitchCells", [])
    any_instability = False
    window_spreads: list[float] = []
    for cell in cells:
        measurement = cell.get("pitchMeasurement", {})
        windows = measurement.get("window_results", measurement.get("windows", []))
        window_errors = [float(w["pitch_error_cents"]) for w in windows if isinstance(w.get("pitch_error_cents"), (int, float))]
        if not window_errors and isinstance(measurement.get("window_pitch_errors_cents"), list):
            window_errors = [float(value) for value in measurement["window_pitch_errors_cents"] if isinstance(value, (int, float))]
        errors.extend(window_errors)
        spread = measurement.get("window_pitch_spread_cents")
        if isinstance(spread, (int, float)):
            window_spreads.append(float(spread))
            any_instability = any_instability or float(spread) > MAX_WINDOW_PITCH_SPREAD_CENTS
        if "measurementInvalidCount" not in metrics and (cell.get("valid") is False or measurement.get("measurement_valid") is False):
            invalid += 1
    worst = max((abs(value) for value in errors), default=0.0)
    # Class labels are descriptive only; hard PASS/FAIL remains in the current constraint vector.
    if invalid:
        classification = "MEASUREMENT_INVALID"
    elif worst <= 15.0:
        classification = "PASS"
    elif any_instability:
        classification = "WINDOW_INSTABILITY"
    else:
        classification = "OFFSET"
    return {
        "pitchWindowErrorsCents": errors,
        "pitchWorstAbsCents": worst,
        "pitchWindowDisagreementCents": max(window_spreads, default=None),
        "pitchFailureClass": classification,
    }
