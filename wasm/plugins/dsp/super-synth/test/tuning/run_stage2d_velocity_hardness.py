"""Stage-2D OAT qualification and, only when authorized, constrained GPSampler."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import optuna

from constraints import STAGE2B_CONSTRAINT_KEYS, stage2b_constraints

ROOT = Path(__file__).resolve().parents[6]
HERE = Path(__file__).resolve().parent
SEARCH_PATH = HERE / "stage2d-velocity-hardness-search-space.json"
SUBSET_PATH = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs"
STATE_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2d-velocity-hardness"
DATABASE = STATE_ROOT / "study.db"
RUNS = STATE_ROOT / "runs"
RESULTS = STATE_ROOT / "results"
SCRATCH = ROOT / "build/wasm/calibration/stage2d-velocity-hardness"

PARAMETER_NAMES = (
    "effective_strike_position_c4",
    "hammer.compression_scale",
    "piano_hammer_hardness",
    "piano_inharmonicity",
    "piano_string_damping",
    "piano_string_unison",
)
IDENTITY_PATHS = (
    "wasm/plugins/dsp/super-synth/src/plugin.c",
    "wasm/plugins/dsp/super-synth/presets.json",
    "wasm/cmake/super_synth_metadata.py",
    "wasm/cmake/generate_plugin_metadata.py",
    "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
    "wasm/plugins/dsp/super-synth/test/tuning/stage2d-velocity-hardness-search-space.json",
    "wasm/plugins/dsp/super-synth/test/tuning/run_stage2d_velocity_hardness.py",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _center_paths(center: dict) -> tuple[Path, Path]:
    run = ROOT / ".agent-state/issues/7/calibration-optuna/gpsampler-split/runs/stage2-20260928T133429Z"
    return run / "candidates" / f"{center['candidateId']}.json", ROOT / ".agent-state/issues/7/calibration-optuna/gpsampler-split/results" / f"{center['candidateId']}.stage2.json"


def validate_centers(search: dict) -> None:
    centers = search.get("oatCenters")
    if not isinstance(centers, list) or [item.get("key") for item in centers] != ["center-a", "center-b"]:
        raise ValueError("Stage-2D requires the ordered Center A and Center B provenance records")
    for center in centers:
        candidate_path, result_path = _center_paths(center)
        candidate = read_json(candidate_path)
        if candidate.get("candidateId") != center["candidateId"] or candidate.get("parameters") != center["parameters"]:
            raise ValueError(f"stored {center['key']} candidate does not match its frozen source parameter vector")
        result = read_json(result_path)
        measured = result.get("result", {})
        if measured.get("candidateId") != center["candidateId"]:
            raise ValueError(f"stored {center['key']} result ID does not match its candidate")
        identity = center["historicalSourceIdentity"]
        for key in ("sourceRevision", "sourceTreeSha256", "evaluatorSha256", "configSha256", "wasmSha256"):
            if measured.get(key) != identity.get(key):
                raise ValueError(f"stored {center['key']} {key} differs from the frozen provenance")

    center_b = centers[1]
    if center_b.get("resolvedFromCandidateId") != "stage2b-v1-0001":
        raise ValueError("Center B must retain the resolved Stage-2B source ID")
    stage2b_root = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b"
    source_candidate = read_json(stage2b_root / "candidates/stage2b-v1-0001.json")
    source_result = read_json(stage2b_root / "results/stage2b-v1-0001.json")
    if source_candidate.get("parameters") != center_b["parameters"]:
        raise ValueError("Center B parameter-vector resolution from stage2b-v1-0001 is no longer exact")
    if source_result.get("stage1Result") != "PASS" or source_result.get("stage2Result") != "PASS":
        raise ValueError("Center B source is no longer a Stage-2 PASS candidate")


def validate_search(search: dict) -> None:
    dimensions = search.get("dimensions")
    expected = [*PARAMETER_NAMES, "hammer.velocity_hardness_amount"]
    names = [item.get("name") for item in dimensions or []]
    if names != expected:
        raise ValueError(f"Stage-2D requires exactly the authorized seven dimensions in order, got {names}")
    if search.get("oatAmounts") != [0.0, 0.25, 0.5, 0.75, 1.0]:
        raise ValueError("Stage-2D OAT amounts must be exactly [0,.25,.5,.75,1]")
    amount = dimensions[-1]
    if (amount.get("min"), amount.get("max"), amount.get("baseline")) != (0.0, 1.0, 0.0):
        raise ValueError("velocity_hardness_amount must use the authorized [0,1] domain and zero baseline")
    for dimension in dimensions:
        if dimension.get("type") != "float" or dimension.get("scale") != "linear":
            raise ValueError(f"unsupported search dimension: {dimension.get('name')}")
        values = [float(dimension[key]) for key in ("min", "max", "baseline")]
        if not all(math.isfinite(value) for value in values) or values[0] > values[1] or not values[0] <= values[2] <= values[1]:
            raise ValueError(f"invalid finite range for {dimension.get('name')}")
    if len(search["oatCenters"]) != 2 or sum(len(search["oatAmounts"]) for _ in search["oatCenters"]) != 10:
        raise ValueError("Stage-2D requires exactly ten two-center OAT candidates")
    budget = search.get("blockModeBudget", {})
    if (budget.get("maxPhysicalCandidates"), budget.get("oatCandidates"), budget.get("maxGpCandidates")) != (25, 10, 15):
        raise ValueError("Stage-2D physical candidate budget differs from the contract")
    validate_centers(search)


def file_identity(search: dict) -> dict:
    source_files = IDENTITY_PATHS[:4]
    source = hashlib.sha256()
    for relative in source_files:
        source.update(relative.encode())
        source.update(b"\0")
        source.update((ROOT / relative).read_bytes())
        source.update(b"\0")
    evaluator = hashlib.sha256()
    for relative in sorted(IDENTITY_PATHS):
        evaluator.update(relative.encode())
        evaluator.update(b"\0")
        evaluator.update((ROOT / relative).read_bytes())
        evaluator.update(b"\0")
    center_inputs = {}
    for center in search["oatCenters"]:
        candidate_path, result_path = _center_paths(center)
        center_inputs[center["candidateId"]] = {
            "candidateSha256": sha256(candidate_path.read_bytes()),
            "resultSha256": sha256(result_path.read_bytes()),
        }
    return {
        "sourceRevision": subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sourceDirty": bool(subprocess.check_output(["rtk", "git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
        "sourceTreeSha256": hash_tree(ROOT / "wasm"),
        "sourceConfigSha256": source.hexdigest(),
        "evaluatorSha256": evaluator.hexdigest(),
        "searchSpaceSha256": sha256(SEARCH_PATH.read_bytes()),
        "subsetSha256": sha256(SUBSET_PATH.read_bytes()),
        "centerInputs": center_inputs,
        "studyName": f"{search['studyNamePrefix']}-{sha256(SEARCH_PATH.read_bytes())}",
    }


def constraint_vector(stage1: dict, stage2: dict, direct: dict) -> dict[str, float]:
    vector = stage2b_constraints(stage1, stage2, direct)
    if tuple(vector) != STAGE2B_CONSTRAINT_KEYS:
        raise ValueError("Stage-2D fixed constraint schema/order mismatch")
    if not all(math.isfinite(value) for value in vector.values()):
        raise ValueError("Stage-2D constraints must be finite measured values")
    return vector


def row_is_measurement_valid(row: dict) -> bool:
    # Accept both the evaluator envelope and the flattened OAT report row.
    result = row.get("result", row)
    stage1 = result["stage1Metrics"]
    stage2 = result["stage2Metrics"]
    direct = result.get("metrics", {}).get("directProxy", result.get("directProxy"))
    if direct is None:
        return False
    return (
        result["measurement"].get("invalidCount") == 0
        and stage1.get("finite") is True
        and stage2.get("finite") is True
        and direct.get("finite") is True
        and stage1.get("guardHits") == 0
        and stage2.get("guardHits") == 0
        and direct.get("guardHitTotal") == 0
    )


def authority_decision(rows: list[dict]) -> dict:
    centers: dict[str, dict[float, dict]] = {}
    for row in rows:
        centers.setdefault(row["centerKey"], {})[float(row["amount"])] = row
    if set(centers) != {"center-a", "center-b"} or any(set(points) != {0.0, 0.25, 0.5, 0.75, 1.0} for points in centers.values()):
        return {"decision": "INCOMPLETE_OAT", "authorized": False, "families": {}}

    family_results: dict[str, dict] = {}
    for metric_name, metric_key, threshold in (
        ("post_attack", "post_attack_shape_violation_db", 2.5),
        ("dynamic_span", "dynamic_span_violation_db", 2.0),
    ):
        improvements = []
        for center_key, points in centers.items():
            baseline = points[0.0]["constraints"][metric_key]
            for amount, row in points.items():
                if amount == 0.0 or not row_is_measurement_valid(row):
                    continue
                improvement = baseline - row["constraints"][metric_key]
                if improvement >= threshold:
                    improvements.append({"center": center_key, "amount": amount, "improvementDb": improvement})
        family_results[metric_name] = {"requiredImprovementDb": threshold, "demonstrated": bool(improvements), "probes": improvements}

    brightness_probes = []
    for amount, row in centers["center-b"].items():
        if amount == 0.0 or not row_is_measurement_valid(row):
            continue
        violation = row["constraints"]["brightness_direction_violation"]
        if violation <= 0.0:
            brightness_probes.append({"center": "center-b", "amount": amount, "violation": violation})
    family_results["brightness_direction"] = {
        "requiredFeasibleViolation": 0.0,
        "demonstrated": bool(brightness_probes),
        "probes": brightness_probes,
    }

    valid_families = [value["demonstrated"] for value in family_results.values()]
    if all(valid_families):
        decision = "VELOCITY_HARDNESS_AXIS_AUTHORIZED"
    elif any(valid_families):
        decision = "BLOCKED_PARTIAL_VELOCITY_HARDNESS_AUTHORITY"
    else:
        decision = "BLOCKED_VELOCITY_HARDNESS_AXIS_INSUFFICIENT"
    return {"decision": decision, "authorized": all(valid_families), "families": family_results}


def run_candidate(candidate_id: str, center: dict, amount: float, identity: dict) -> dict:
    parameters = {**center["parameters"], "hammer.velocity_hardness_amount": amount}
    candidate = {"candidateId": candidate_id, "parameters": parameters}
    candidate_path = RESULTS / "candidates" / f"{candidate_id}.json"
    result_path = RESULTS / f"{candidate_id}.json"
    write_json(candidate_path, candidate)
    build_root = SCRATCH / candidate_id
    command = [
        "rtk", "node", str(EVALUATOR), "--candidate", str(candidate_path), "--subset", str(SUBSET_PATH),
        "--build-root", str(build_root), "--output", str(result_path),
    ]
    env = os.environ.copy()
    env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(SEARCH_PATH)
    completed = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True)
    build_root.mkdir(parents=True, exist_ok=True)
    (build_root / "stage2b.stdout.log").write_text(completed.stdout, encoding="utf-8")
    (build_root / "stage2b.stderr.log").write_text(completed.stderr, encoding="utf-8")
    if completed.returncode != 0:
        raise RuntimeError(f"Stage-2B evaluator failed ({completed.returncode}): {completed.stderr[-4000:]}")
    result = read_json(result_path)
    if result.get("result") != "COMPLETE" or result.get("stage2bReached") is not True:
        raise ValueError("Stage-2D candidate did not complete Stage 1, Stage 2, and Stage-2B proxy measurements")
    if result.get("productionSimd") is not True or result.get("sourceRevision") != identity["sourceRevision"]:
        raise ValueError("Stage-2D candidate production/source identity differs from the frozen run")
    if result.get("sourceTreeSha256") != identity["sourceTreeSha256"]:
        raise ValueError("Stage-2D candidate source tree differs from the frozen run")
    center_record = next((item for item in read_json(SEARCH_PATH)["oatCenters"]
                          if item["key"] == center.get("key")), None)
    result["stage2dProvenance"] = {
        "studyName": identity["studyName"],
        "searchSpaceSha256": identity["searchSpaceSha256"],
        "stage2dEvaluatorSha256": identity["evaluatorSha256"],
        "centerKey": center.get("key", "gpsampler"),
        "resolvedCenterCandidateId": center.get("candidateId"),
        "resolvedFromCandidateId": center.get("resolvedFromCandidateId"),
        "centerParameterVector": center["parameters"],
        "centerSourceIdentity": center_record["historicalSourceIdentity"] if center_record else None,
    }
    write_json(result_path, result)
    return result


def make_objective(search: dict, identity: dict):
    def objective(trial):
        if file_identity(search) != identity:
            raise RuntimeError("BLOCKED_SOURCE_CHANGED: source/config/evaluator/search-space identity changed")
        parameters = {
            dimension["name"]: trial.suggest_float(dimension["name"], float(dimension["min"]), float(dimension["max"]))
            for dimension in search["dimensions"]
        }
        seed = trial.user_attrs.get("seed")
        if seed:
            center = next(item for item in search["oatCenters"] if item["key"] == seed["centerKey"])
            amount = float(seed["amount"])
            candidate_id = f"stage2d-{seed['centerKey']}-a{int(amount * 100):03d}"
        else:
            center = {"parameters": {key: parameters[key] for key in PARAMETER_NAMES}}
            amount = parameters["hammer.velocity_hardness_amount"]
            candidate_id = f"stage2d-gp-{trial.number:04d}"
        parameters = {**center["parameters"], "hammer.velocity_hardness_amount": amount}
        trial.set_user_attr("candidate_id", candidate_id)
        trial.set_user_attr("center_key", seed["centerKey"] if seed else "gpsampler")
        trial.set_user_attr("parameters", parameters)
        trial.set_user_attr("source_revision", identity["sourceRevision"])
        trial.set_user_attr("source_tree_sha256", identity["sourceTreeSha256"])
        trial.set_user_attr("source_config_sha256", identity["sourceConfigSha256"])
        trial.set_user_attr("evaluator_sha256", identity["evaluatorSha256"])
        trial.set_user_attr("search_space_sha256", identity["searchSpaceSha256"])
        result = run_candidate(candidate_id, center, amount, identity)
        constraints = constraint_vector(result["stage1Metrics"], result["stage2Metrics"], result["metrics"]["directProxy"])
        for name in STAGE2B_CONSTRAINT_KEYS:
            trial.set_constraint(name, float(constraints[name]))
        loss = float(result["metrics"]["directProxyReferenceFitLoss"])
        if not math.isfinite(loss):
            raise ValueError("Stage-2D reference-fit loss is not finite")
        trial.set_user_attr("stage_reached", "2B")
        trial.set_user_attr("stage1_result", result["stage1Result"])
        trial.set_user_attr("stage2_result", result["stage2Result"])
        trial.set_user_attr("measurement_invalid_count", result["measurement"]["invalidCount"])
        trial.set_user_attr("constraints", constraints)
        trial.set_user_attr("reference_fit_loss", loss)
        trial.set_user_attr("candidate_config_sha256", result["configSha256"])
        trial.set_user_attr("wasm_sha256", result["wasmSha256"])
        trial.set_user_attr("result_path", str(RESULTS / f"{candidate_id}.json"))
        trial.set_user_attr("elapsed_seconds", float(result["elapsedSeconds"]))
        trial.set_user_attr("oat", seed is not None)
        trial.set_user_attr("measurement_valid", row_is_measurement_valid({"result": result}))
        trial.set_user_attr("feasible", all(value <= 0.0 for value in constraints.values()))
        return loss

    return objective


def oat_rows(study) -> list[dict]:
    rows = []
    for trial in study.trials:
        if trial.state != optuna.trial.TrialState.COMPLETE or not trial.user_attrs.get("oat"):
            continue
        result = read_json(Path(trial.user_attrs["result_path"]))
        rows.append({
            "candidateId": trial.user_attrs["candidate_id"],
            "centerKey": trial.user_attrs["center_key"],
            "amount": trial.user_attrs["parameters"]["hammer.velocity_hardness_amount"],
            "parameters": trial.user_attrs["parameters"],
            "stage1Result": result["stage1Result"],
            "stage2Result": result["stage2Result"],
            "stage1Metrics": result["stage1Metrics"],
            "stage2Metrics": result["stage2Metrics"],
            "directProxy": result["metrics"]["directProxy"],
            "measurement": result["measurement"],
            "constraints": trial.user_attrs["constraints"],
            "referenceFitLoss": trial.user_attrs["reference_fit_loss"],
            "sourceRevision": result["sourceRevision"],
            "sourceTreeSha256": result["sourceTreeSha256"],
            "evaluatorSha256": result["evaluatorSha256"],
            "configSha256": result["configSha256"],
            "wasmSha256": result["wasmSha256"],
            "stage2dProvenance": result.get("stage2dProvenance"),
            "elapsedSeconds": result["elapsedSeconds"],
            "measurementValid": row_is_measurement_valid({"result": result}),
            "resultPath": trial.user_attrs["result_path"],
        })
    return sorted(rows, key=lambda row: (row["centerKey"], row["amount"]))


def feasible_trials(study) -> list:
    return [trial for trial in study.trials
            if trial.state == optuna.trial.TrialState.COMPLETE
            and len(trial.user_attrs.get("constraints", {})) == len(STAGE2B_CONSTRAINT_KEYS)
            and all(float(value) <= 0.0 for value in trial.user_attrs["constraints"].values())]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--oat-only", action="store_true")
    parser.add_argument("--max-gp-candidates", type=int, default=15)
    args = parser.parse_args()
    if not 0 <= args.max_gp_candidates <= 15:
        parser.error("--max-gp-candidates must be in [0,15]")

    search = read_json(SEARCH_PATH)
    validate_search(search)
    if not SUBSET_PATH.is_file():
        raise FileNotFoundError(f"Stage-2B diagnostic subset missing: {SUBSET_PATH}")
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    RUNS.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    identity = file_identity(search)
    study = optuna.create_study(
        study_name=identity["studyName"],
        storage=f"sqlite:///{DATABASE}",
        load_if_exists=True,
        direction="minimize",
        sampler=optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=10),
    )
    frozen = study.user_attrs.get("frozen_identity")
    if frozen is not None and frozen != identity:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED: existing Stage-2D study identity does not match this source")
    study.set_user_attr("frozen_identity", identity)
    study.set_user_attr("constraint_schema", list(STAGE2B_CONSTRAINT_KEYS))
    study.set_user_attr("search_space_sha256", identity["searchSpaceSha256"])

    started = datetime.now(timezone.utc)
    run_id = started.strftime("%Y%m%dT%H%M%SZ")
    manifest_path = RUNS / f"{run_id}.json"
    manifest = {**identity, "pythonVersion": sys.version, "optunaVersion": optuna.__version__,
                "seed": 7, "startingTrialNumber": len(study.trials), "candidateBudget": 25,
                "oatCandidateBudget": 10, "gpCandidateBudget": 15,
                "startTimestamp": started.isoformat(), "stopReason": None}
    write_json(manifest_path, manifest)

    completed_oat = {(trial.user_attrs.get("center_key"), float(trial.user_attrs.get("parameters", {}).get("hammer.velocity_hardness_amount", -1)))
                     for trial in study.trials
                     if trial.state == optuna.trial.TrialState.COMPLETE and trial.user_attrs.get("oat")}
    objective = make_objective(search, identity)
    for center in search["oatCenters"]:
        for amount in search["oatAmounts"]:
            key = (center["key"], float(amount))
            if key in completed_oat:
                continue
            parameters = {dimension["name"]: dimension["baseline"] for dimension in search["dimensions"]}
            parameters.update(center["parameters"])
            parameters["hammer.velocity_hardness_amount"] = float(amount)
            study.enqueue_trial(parameters, user_attrs={"seed": {"centerKey": center["key"], "amount": float(amount)}, "oat": True})
            study.optimize(objective, n_trials=1, n_jobs=1, catch=())

    rows = oat_rows(study)
    authority = authority_decision(rows)
    oat_path = STATE_ROOT / "oat-authority.json"
    write_json(oat_path, {"studyName": identity["studyName"], "identity": identity,
                          "centerProvenance": search["oatCenters"], "oatCount": len(rows),
                          "constraintSchema": list(STAGE2B_CONSTRAINT_KEYS), "oatRows": rows,
                          "authority": authority})

    if len(rows) != 10:
        stop_reason = "BLOCKED_INCOMPLETE_TWO_CENTER_OAT"
    elif not authority["authorized"]:
        stop_reason = authority["decision"]
    elif args.oat_only:
        stop_reason = "VELOCITY_HARDNESS_AXIS_AUTHORIZED_GP_NOT_REQUESTED"
    else:
        gp_trials = [trial for trial in study.trials if not trial.user_attrs.get("oat") and trial.state != optuna.trial.TrialState.WAITING]
        attempted = len(gp_trials)
        feasible_count = len(feasible_trials(study))
        requested = min(args.max_gp_candidates, 15 - attempted, 25 - 10 - attempted)
        if feasible_count >= 3:
            requested = 0
            stop_reason = "THREE_STAGE2D_FEASIBLE_CANDIDATES"
        elif requested > 0:
            study.optimize(objective, n_trials=requested, n_jobs=1, catch=())
            stop_reason = "GP_BUDGET_OR_FEASIBILITY_STOP"
        else:
            stop_reason = "GP_BUDGET_EXHAUSTED_OR_DISABLED"
        if len(feasible_trials(study)) >= 3:
            stop_reason = "THREE_STAGE2D_FEASIBLE_CANDIDATES"

    trials = study.trials
    completed = [trial for trial in trials if trial.state == optuna.trial.TrialState.COMPLETE]
    gp_complete = [trial for trial in completed if not trial.user_attrs.get("oat")]
    manifest.update({"endTimestamp": datetime.now(timezone.utc).isoformat(), "stopReason": stop_reason,
                     "oatComplete": len(rows), "gpComplete": len(gp_complete),
                     "totalComplete": len(completed), "feasibleCount": len(feasible_trials(study)),
                     "authority": authority, "oatResultPath": str(oat_path)})
    write_json(manifest_path, manifest)
    print(json.dumps({"studyName": identity["studyName"], "oatComplete": len(rows),
                      "authority": authority, "gpComplete": len(gp_complete),
                      "feasibleCount": len(feasible_trials(study)), "stopReason": stop_reason,
                      "manifest": str(manifest_path), "oatResult": str(oat_path)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
