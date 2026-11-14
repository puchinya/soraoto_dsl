"""Pure Stage2L candidate gates, intentionally independent of Optuna and rendering."""

STAGE2K_BASELINE = {
    "post_attack_shape_violation_db": 2.101440,
    "dynamic_span_violation_db": 3.528952,
}
PRIMARY_DIRECTION_KEYS = tuple(STAGE2K_BASELINE)
AGGREGATE_KEYS = {"stage1_violation", "stage2_violation", "stage2b_violation"}


def direction_result(constraints: dict[str, float]) -> dict:
    missing = [key for key in (*PRIMARY_DIRECTION_KEYS, "stage1_violation", "stage2_violation", "stage2b_violation")
               if key not in constraints]
    if missing:
        raise ValueError(f"Stage2E result is missing directional constraints: {missing}")
    primary = {key: float(constraints[key]) for key in PRIMARY_DIRECTION_KEYS}
    new_safety = {
        key: float(value) for key, value in constraints.items()
        if key not in PRIMARY_DIRECTION_KEYS and key not in AGGREGATE_KEYS and float(value) > 0.0
    }
    passed = (primary["post_attack_shape_violation_db"] < STAGE2K_BASELINE["post_attack_shape_violation_db"]
              and primary["dynamic_span_violation_db"] < STAGE2K_BASELINE["dynamic_span_violation_db"]
              and not new_safety)
    return {"pass": passed, "primary": primary, "newPositiveIndependentConstraints": new_safety}
