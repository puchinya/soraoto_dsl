"""Constraint calculations shared by the Stage-1/2 Optuna objective."""

from __future__ import annotations

import math
from typing import Any

BRIGHTNESS_MIN = 1.25
PEAK_MAX_DBFS = 0.0
PITCH_MAX_CENTS = 15.0
BUZZ_MAX = 0.12
H2_H1_MIN = 0.12
H3_H1_MIN = 0.05

DETAIL_CONSTRAINT_KEYS = (
    "brightness_violation",
    "peak_violation",
    "guard_violation",
    "pitch_violation",
    "measurement_invalid",
    "finite_violation",
    "sparsity_violation",
    "buzz_violation",
)
STAGE1_CONSTRAINT_KEYS = (*DETAIL_CONSTRAINT_KEYS, "stage1_violation")
STAGE2_CONSTRAINT_KEYS = (
    *(f"stage1_{key}" for key in DETAIL_CONSTRAINT_KEYS),
    "stage1_violation",
    *(f"stage2_{key}" for key in DETAIL_CONSTRAINT_KEYS),
    "stage2_violation",
)
STAGE2B_PROXY_CONSTRAINT_KEYS = (
    "post_attack_shape_violation_db",
    "dynamic_span_violation_db",
    "brightness_direction_violation",
    "direct_level_violation_db",
    "direct_peak_violation_dbfs",
    "direct_guard_violation",
    "direct_finite_violation",
)
STAGE2B_CONSTRAINT_KEYS = (*STAGE2_CONSTRAINT_KEYS, *STAGE2B_PROXY_CONSTRAINT_KEYS, "stage2b_violation")
STAGE2E_HELD_RELEASE_CONSTRAINT_KEYS = (
    "held_decay_ratio_violation",
    "release_tail1_min_violation",
    "release_tail2_min_violation",
    "release_tail_decay_ratio_violation",
    "release_finite_violation",
    "stuck_voice_violation",
)
STAGE2E_CONSTRAINT_KEYS = (*STAGE2B_CONSTRAINT_KEYS, *STAGE2E_HELD_RELEASE_CONSTRAINT_KEYS)


def _finite_number(value: Any, name: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite measured number")
    return float(value)


def _strict_upper_violation(value: float, limit: float, scale: float = 1.0) -> float:
    if value == limit:
        return 1e-12
    return (value - limit) / scale


def _strict_lower_violation(value: float, limit: float, scale: float) -> float:
    if value == limit:
        return 1e-12
    return (limit - value) / scale


def measured_constraints(metrics: dict[str, Any]) -> dict[str, float]:
    """Return signed constraints; values <= 0 pass and > 0 fail."""
    brightness = _finite_number(metrics.get("brightnessRatio"), "brightnessRatio")
    peak = _finite_number(metrics.get("peakDbfs"), "peakDbfs")
    guard = _finite_number(metrics.get("guardHits"), "guardHits")
    invalid = _finite_number(metrics.get("measurementInvalidCount"), "measurementInvalidCount")
    buzz = _finite_number(metrics.get("lowRegisterBuzz"), "lowRegisterBuzz")
    errors = metrics.get("pitchErrorsCents")
    if not isinstance(errors, list):
        raise ValueError("pitchErrorsCents must be a measured list")
    if errors:
        worst_pitch = max(abs(_finite_number(error, "pitchErrorsCents item")) for error in errors)
        pitch_violation = (worst_pitch - PITCH_MAX_CENTS) / PITCH_MAX_CENTS
    elif invalid > 0:
        # The pitch gate is unknown, not failed or passed; the separate positive
        # measurement_invalid constraint makes this observation infeasible.
        worst_pitch = 0.0
        pitch_violation = 0.0
    else:
        raise ValueError("pitchErrorsCents is empty while measurementInvalidCount is zero")
    sparsity = metrics.get("harmonicSparsity")
    if not isinstance(sparsity, dict):
        raise ValueError("harmonicSparsity must be measured before it can be constrained")
    h2_h1 = _finite_number(sparsity.get("h2ToH1"), "harmonicSparsity.h2ToH1")
    h3_h1 = _finite_number(sparsity.get("h3ToH1"), "harmonicSparsity.h3ToH1")
    finite = metrics.get("finite")
    if not isinstance(finite, bool):
        raise ValueError("finite must be an explicit measured boolean")

    return {
        "brightness_violation": _strict_lower_violation(brightness, BRIGHTNESS_MIN, BRIGHTNESS_MIN),
        "peak_violation": _strict_upper_violation(peak, PEAK_MAX_DBFS),
        "guard_violation": guard,
        "pitch_violation": pitch_violation,
        "measurement_invalid": invalid,
        "finite_violation": -1.0 if finite else 1.0,
        "sparsity_violation": max(
            _strict_lower_violation(h2_h1, H2_H1_MIN, H2_H1_MIN),
            _strict_lower_violation(h3_h1, H3_H1_MIN, H3_H1_MIN),
        ),
        "buzz_violation": _strict_upper_violation(buzz, BUZZ_MAX, BUZZ_MAX),
    }


def aggregate_violation(constraints: dict[str, float]) -> float:
    if not constraints:
        raise ValueError("cannot aggregate an empty constraint set")
    return max(constraints.values())


def stage1_constraints(metrics: dict[str, Any]) -> dict[str, float]:
    details = measured_constraints(metrics)
    return {**details, "stage1_violation": aggregate_violation(details)}


def stage2_constraints(metrics: dict[str, Any]) -> dict[str, float]:
    details = measured_constraints(metrics)
    return {**details, "stage2_violation": aggregate_violation(details)}


def is_feasible(constraints: dict[str, float], aggregate_name: str) -> bool:
    return constraints[aggregate_name] <= 0.0


def combined_trial_constraints(stage1: dict[str, float], stage2: dict[str, float] | None = None) -> dict[str, float]:
    """Build the Stage-2 study's fixed, disjoint constraint vector."""
    if stage2 is None:
        raise ValueError("Stage-2 constraints require measurements from both stages")
    result = {f"stage1_{key}": stage1[key] for key in DETAIL_CONSTRAINT_KEYS}
    result["stage1_violation"] = stage1["stage1_violation"]
    result.update({f"stage2_{key}": stage2[key] for key in DETAIL_CONSTRAINT_KEYS})
    result["stage2_violation"] = stage2["stage2_violation"]
    return result


def stage2b_constraints(stage1_metrics: dict[str, Any], stage2_metrics: dict[str, Any], direct: dict[str, Any]) -> dict[str, float]:
    """Fixed Stage-2B schema: ordinary Stage-2 checks plus direct Stage-3 proxies."""
    stage1 = stage1_constraints(stage1_metrics)
    stage2 = stage2_constraints(stage2_metrics)
    combined = combined_trial_constraints(stage1, stage2)
    required = {
        "post_attack_shape_violation_db": direct.get("postAttackShape", {}).get("maxViolationDb"),
        "dynamic_span_violation_db": direct.get("dynamicSpan", {}).get("maxViolationDb"),
        "brightness_direction_violation": -direct.get("brightnessDirection", {}).get("minimumDirectionMargin")
            if direct.get("brightnessDirection", {}).get("minimumDirectionMargin") is not None else None,
        "direct_level_violation_db": direct.get("directLevel", {}).get("maxViolationDb"),
        "direct_peak_violation_dbfs": direct.get("peakWorstDbfs"),
        "direct_guard_violation": direct.get("guardHitTotal"),
        "direct_finite_violation": 0.0 if direct.get("finite") is True else 1.0,
    }
    proxy = {key: _finite_number(required[key], key) for key in STAGE2B_PROXY_CONSTRAINT_KEYS}
    result = {**combined, **proxy}
    result["stage2b_violation"] = max(result[key] for key in (*STAGE2_CONSTRAINT_KEYS, *STAGE2B_PROXY_CONSTRAINT_KEYS))
    if tuple(result) != STAGE2B_CONSTRAINT_KEYS:
        raise AssertionError("Stage-2B constraint schema/order construction drifted")
    return result


def stage2e_constraints(stage1_metrics: dict[str, Any], stage2_metrics: dict[str, Any],
                        direct: dict[str, Any], held_release: dict[str, Any],
                        local_topology: dict[str, Any]) -> dict[str, float]:
    """Stage-2E adds measured held-decay/release constraints to fixed Stage-2B evidence."""
    result = stage2b_constraints(stage1_metrics, stage2_metrics, direct)
    held_ratio = _finite_number(held_release.get("heldDecayRatio"), "heldRelease.heldDecayRatio")
    tail1 = _finite_number(held_release.get("releaseTail1"), "heldRelease.releaseTail1")
    tail2 = _finite_number(held_release.get("releaseTail2"), "heldRelease.releaseTail2")
    tail3 = _finite_number(held_release.get("releaseTail3"), "heldRelease.releaseTail3")
    tail_ratio = _finite_number(held_release.get("releaseTail3To2Ratio"), "heldRelease.releaseTail3To2Ratio")
    expected_tail_ratio = tail3 / max(1e-12, tail2)
    if not math.isclose(tail_ratio, expected_tail_ratio, rel_tol=1e-9, abs_tol=1e-12):
        raise ValueError("heldRelease.releaseTail3To2Ratio must agree with the measured tail3/tail2 values")
    stuck = _finite_number(held_release.get("stuckVoiceCount"), "heldRelease.stuckVoiceCount")
    finite_release = held_release.get("finiteRelease")
    if not isinstance(finite_release, bool):
        raise ValueError("heldRelease.finiteRelease must be an explicit measured boolean")
    unison = _finite_number(local_topology.get("pianoStringUnison"), "localTopology.pianoStringUnison")
    soundboard_mix = _finite_number(local_topology.get("pianoSoundboardMix"), "localTopology.pianoSoundboardMix")
    topology_violation = max((0.40 - unison) / 0.40, (0.50 - soundboard_mix) / 0.50)

    held = max(
        _strict_lower_violation(held_ratio, 0.40, 0.40),
        _strict_upper_violation(held_ratio, 1.02, 1.02),
    )
    tail1_violation = _strict_lower_violation(tail1, 0.0003, 0.0003)
    tail2_violation = _strict_lower_violation(tail2, 0.00015, 0.00015)
    tail_ratio_violation = _strict_upper_violation(tail_ratio, 0.55, 0.55)
    result.update({
        "held_decay_ratio_violation": held,
        "release_tail1_min_violation": tail1_violation,
        "release_tail2_min_violation": tail2_violation,
        "release_tail_decay_ratio_violation": tail_ratio_violation,
        "release_finite_violation": 0.0 if finite_release else 1.0,
        "stuck_voice_violation": stuck,
    })
    # Preserve the existing concert-grand preset topology gate inside the
    # already-fixed aggregate slot; this adds no Optuna vector dimension.
    result["stage2b_violation"] = max(result["stage2b_violation"], topology_violation)
    if tuple(result) != STAGE2E_CONSTRAINT_KEYS:
        raise AssertionError("Stage-2E fixed constraint schema/order drifted")
    if not all(math.isfinite(value) for value in result.values()):
        raise ValueError("Stage-2E constraints must be finite measured values")
    return result
