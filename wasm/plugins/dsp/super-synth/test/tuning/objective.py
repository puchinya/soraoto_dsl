"""Fixed-schema objectives for the independent Issue #7 GP studies."""

from __future__ import annotations

import math
from typing import Callable

from constraints import (
    STAGE1_CONSTRAINT_KEYS,
    STAGE2_CONSTRAINT_KEYS,
    STAGE2B_CONSTRAINT_KEYS,
    combined_trial_constraints,
    stage1_constraints,
    stage2_constraints,
    stage2b_constraints,
)


def _finite_loss(result: dict, stage: int) -> float:
    loss = result.get("metrics", {}).get("referenceFitLoss")
    if not isinstance(loss, (int, float)) or not math.isfinite(loss):
        raise ValueError(f"Stage-{stage} evaluation must provide a finite referenceFitLoss")
    return float(loss)


def _record(trial, keys: tuple[str, ...], constraints: dict[str, float]) -> None:
    if tuple(constraints) != keys:
        raise ValueError(f"constraint schema/order mismatch: expected {keys}, got {tuple(constraints)}")
    # The tuple order is part of each study's persisted GPSampler schema.
    for name in keys:
        trial.set_constraint(name, float(constraints[name]))
    trial.set_user_attr("constraints", constraints)


def stage1_objective_result(trial, parameters: dict, evaluate_stage: Callable[[int], dict]) -> tuple[float, dict]:
    """Measure Stage 1 only; acoustic failures remain completed GP observations."""
    stage1 = evaluate_stage(1)
    loss = _finite_loss(stage1, 1)
    constraints = stage1_constraints(stage1["metrics"])
    _record(trial, STAGE1_CONSTRAINT_KEYS, constraints)
    trial.set_user_attr("parameters", parameters)
    trial.set_user_attr("stage_reached", 1)
    trial.set_user_attr("stage1_metrics", stage1["metrics"])
    trial.set_user_attr("measurement_invalid_count", stage1.get("measurement", {}).get("invalidCount", 0))
    trial.set_user_attr("candidate_result", stage1.get("result"))
    return loss, {"stage1": stage1, "constraints": constraints, "stage_reached": 1}


def objective_result(trial, parameters: dict, evaluate_stage: Callable[[int], dict]) -> tuple[float, dict]:
    """Compatibility name retained for older tests; now Stage-1-only semantics."""
    return stage1_objective_result(trial, parameters, evaluate_stage)


def stage2_objective_result(trial, parameters: dict, evaluate_stage: Callable[[int], dict]) -> tuple[float, dict]:
    """Always collect both stages so every Stage-2 GP observation has one schema."""
    stage1 = evaluate_stage(1)
    stage2 = evaluate_stage(2)
    loss = _finite_loss(stage2, 2)
    constraints1 = stage1_constraints(stage1["metrics"])
    constraints2 = stage2_constraints(stage2["metrics"])
    constraints = combined_trial_constraints(constraints1, constraints2)
    _record(trial, STAGE2_CONSTRAINT_KEYS, constraints)
    trial.set_user_attr("parameters", parameters)
    trial.set_user_attr("stage_reached", 2)
    trial.set_user_attr("stage1_metrics", stage1["metrics"])
    trial.set_user_attr("stage2_metrics", stage2["metrics"])
    trial.set_user_attr("measurement_invalid_count", stage2.get("measurement", {}).get("invalidCount", 0))
    trial.set_user_attr("candidate_result", stage2.get("result"))
    return loss, {"stage1": stage1, "stage2": stage2, "constraints": constraints, "stage_reached": 2}


def stage2b_objective_result(trial, parameters: dict, evaluate: Callable[[], dict]) -> tuple[float, dict]:
    """Stage 2B has no acoustic early exit; all proxy constraints are measured."""
    result = evaluate()
    accepted_results = {"PASS", "FAIL", "MEASUREMENT_INVALID"}
    if result.get("stage1Result") not in accepted_results or result.get("stage2Result") not in accepted_results:
        raise ValueError("Stage-2B must physically complete Stage 1 and Stage 2")
    loss = _finite_loss({"metrics": result.get("stage2Metrics")}, "2B")
    constraints = stage2b_constraints(result["stage1Metrics"], result["stage2Metrics"], result["metrics"]["directProxy"])
    _record(trial, STAGE2B_CONSTRAINT_KEYS, constraints)
    trial.set_user_attr("parameters", parameters)
    trial.set_user_attr("stage_reached", "2B")
    trial.set_user_attr("stage1_pass", result["stage1Result"] == "PASS")
    trial.set_user_attr("stage2_pass", result["stage2Result"] == "PASS")
    trial.set_user_attr("stage2b_pass", constraints["stage2b_violation"] <= 0)
    trial.set_user_attr("stage1_metrics", result["stage1Metrics"])
    trial.set_user_attr("stage2_metrics", result["stage2Metrics"])
    trial.set_user_attr("stage2b_metrics", result["metrics"]["directProxy"])
    trial.set_user_attr("measurement_invalid_count", result.get("measurement", {}).get("invalidCount"))
    trial.set_user_attr("candidate_result", "PASS" if constraints["stage2b_violation"] <= 0 else "FAIL")
    return loss, {"result": result, "constraints": constraints, "stage_reached": "2B"}
