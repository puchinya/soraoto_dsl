#!/usr/bin/env python3
"""Sequential constrained GPSampler search for Issue #7 Stage 1/2."""

from __future__ import annotations

import hashlib
from importlib import metadata
import json
import math
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import optuna
from optuna.trial import TrialState

from constraints import combined_trial_constraints, is_feasible, stage1_constraints, stage2_constraints
from objective import objective_result

ROOT = Path(__file__).resolve().parents[6]
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
SEARCH_PATH = TUNING / "gpsampler-search-space.json"
OLD_SEARCH_PATH = TUNING / "active-search-space.json"
PITCH_REPORT = ROOT / ".agent-state/issues/7/full-reoptimization/qmc/pitch-replay/recomputed-pitch-ped-anova-and-active-set.json"
QMC_MANIFEST = ROOT / ".agent-state/issues/7/full-reoptimization/qmc/run-manifest.json"
DATABASE = ROOT / ".agent-state/issues/7/calibration-optuna/study.db"
RUNS = ROOT / ".agent-state/issues/7/calibration-optuna/gpsampler/runs"
RESULTS = ROOT / ".agent-state/issues/7/calibration-optuna/gpsampler/results"
SCRATCH = ROOT / "build/wasm/calibration/gpsampler"
NODE_EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs"
MAX_BUDGET = 50
NO_FEASIBLE_REVIEW_COUNT = 30
MAX_FEASIBLE = 3
MEASUREMENT_HEALTH_WINDOW = 20
MEASUREMENT_INVALID_RATE = 0.10

IDENTITY_FILES = [
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/active-search-space.json",
    "wasm/plugins/dsp/super-synth/test/tuning/gpsampler-search-space.json",
    "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
    "wasm/plugins/dsp/super-synth/test/tuning/objective.py",
    "wasm/plugins/dsp/super-synth/test/tuning/optimize_gpsampler.py",
    "wasm/plugins/dsp/super-synth/test/tuning/run_split_gpsampler.py",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load(path: Path):
    return json.loads(path.read_text())


def write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".tmp-{os.getpid()}")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hash_files(relative_paths: list[str]) -> str:
    digest = hashlib.sha256()
    for relative in sorted(relative_paths):
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update((ROOT / relative).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def hash_tree(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        relative = path.relative_to(directory).as_posix()
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def git_value(*args: str) -> str:
    return subprocess.run(["rtk", "git", *args], cwd=ROOT, check=True, text=True, capture_output=True).stdout.strip()


def search_identity(search: dict) -> str:
    qmc = load(QMC_MANIFEST)
    dimensions = [{key: dim[key] for key in ("name", "type", "min", "max", "scale", "baseline")} for dim in search["dimensions"]]
    payload = {
        "dimensions": dimensions,
        "sourceQmcSearchSpaceSha256": qmc["searchSpaceSha256"],
        "pitchSensitivitySha256": sha256(PITCH_REPORT),
        "activeParameters": search["screeningEvidence"]["activeParameters"],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def source_identity(search: dict) -> dict:
    return {
        "sourceRevision": git_value("rev-parse", "HEAD"),
        "sourceDirty": bool(git_value("status", "--porcelain")),
        "wasmTreeSha256": hash_tree(ROOT / "wasm"),
        "presetSha256": sha256(ROOT / "wasm/plugins/dsp/super-synth/presets.json"),
        "evaluatorSha256": hash_files(IDENTITY_FILES),
        "searchSpaceSha256": search["searchSpaceHash"],
        "pitchSensitivitySha256": sha256(PITCH_REPORT),
    }


def optional_distribution_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def verify_search(search: dict) -> None:
    if search_identity(search) != search["searchSpaceHash"]:
        raise RuntimeError("GPSampler search-space identity hash does not match its frozen dimensions/evidence")
    if search["studyName"] != f"issue-7-grand-v9-opt-{search['searchSpaceHash'][:12]}":
        raise RuntimeError("GPSampler study name does not match the frozen active-search-space hash")
    dimension_names = [dim["name"] for dim in search["dimensions"]]
    if len(dimension_names) != len(set(dimension_names)) or set(search["screeningEvidence"]["activeParameters"]) != set(dimension_names):
        raise RuntimeError("GPSampler dimensions do not match the QMC-derived active set")
    if len(search["dimensions"]) > 6:
        raise RuntimeError("joint GPSampler search exceeds the six-parameter contract limit")


def suggest_parameters(trial, dimensions: list[dict]) -> dict:
    result = {}
    for dimension in dimensions:
        result[dimension["name"]] = trial.suggest_float(
            dimension["name"], float(dimension["min"]), float(dimension["max"]),
            log=dimension.get("scale") == "log",
        )
    return result


def result_path(candidate_id: str, stage: int) -> Path:
    return RESULTS / f"{candidate_id}.stage{stage}.json"


def evaluate_stage(candidate: dict, stage: int, build_root: Path, candidate_path: Path) -> dict:
    output = build_root / "stage1-result.json" if stage == 1 else result_path(candidate["candidateId"], 2)
    command = ["rtk", "node", str(NODE_EVALUATOR), "--candidate", str(candidate_path),
               "--stage", str(stage), "--build-root", str(build_root), "--output", str(output)]
    completed = subprocess.run(command, cwd=ROOT, check=False, text=True, capture_output=True)
    (build_root / f"stage{stage}-stdout.log").write_text(completed.stdout)
    (build_root / f"stage{stage}-stderr.log").write_text(completed.stderr)
    if completed.returncode != 0:
        raise RuntimeError(
            f"candidate evaluator Stage {stage} exited {completed.returncode}; "
            f"stderr={completed.stderr[-2000:]} stdout={completed.stdout[-1000:]}"
        )
    return load(output)


def duplicate_observation(study, parameters: dict, identity: dict):
    for old in reversed(study.get_trials(deepcopy=False, states=(TrialState.COMPLETE,))):
        if old.user_attrs.get("source_revision") != identity["sourceRevision"]:
            continue
        if old.user_attrs.get("source_tree_sha256") != identity["wasmTreeSha256"]:
            continue
        if old.user_attrs.get("evaluator_sha256") != identity["evaluatorSha256"]:
            continue
        if old.user_attrs.get("search_space_sha256") != identity["searchSpaceSha256"]:
            continue
        if old.params == parameters and old.user_attrs.get("constraints") is not None:
            return old
    return None


def completed_stage2(study):
    return [trial for trial in study.get_trials(deepcopy=False, states=(TrialState.COMPLETE,))
            if trial.user_attrs.get("stage_reached") == 2 and trial.user_attrs.get("historical_replay") is not True]


def feasible_stage2_trials(study):
    result = []
    for trial in completed_stage2(study):
        constraints = trial.user_attrs.get("constraints", {})
        if constraints.get("stage2_violation", 1.0) <= 0.0 and constraints.get("stage1_violation", 1.0) <= 0.0:
            result.append(trial)
    return result


def measurement_health_stop(study) -> bool:
    recent = completed_stage2(study)[-MEASUREMENT_HEALTH_WINDOW:]
    if len(recent) < MEASUREMENT_HEALTH_WINDOW:
        return False
    invalid = sum((trial.user_attrs.get("measurement_invalid_count") or 0) > 0 for trial in recent)
    return invalid / len(recent) > MEASUREMENT_INVALID_RATE


def boundary_review(study, dimensions: list[dict]) -> dict | None:
    candidates = sorted(completed_stage2(study), key=lambda trial: trial.value or math.inf)[:5]
    if len(candidates) < 5:
        return None
    for dimension in dimensions:
        low, high = float(dimension["min"]), float(dimension["max"])
        width = high - low
        count = 0
        for trial in candidates:
            value = trial.params[dimension["name"]]
            normalized = (value - low) / width
            if normalized <= 0.02 or normalized >= 0.98:
                count += 1
        if count >= 4:
            return {"parameter": dimension["name"], "min": low, "max": high,
                    "bestFiveOuterTwoPercentCount": count}
    return None


def record_trial_identity(trial, candidate_id: str, identity: dict, result: dict | None, candidate_path: Path, elapsed: float, historical: bool) -> None:
    attributes = {
        "candidate_id": candidate_id,
        "stage_reached": result.get("stageReached", 0) if result else 0,
        "source_revision": identity["sourceRevision"],
        "source_tree_sha256": identity["wasmTreeSha256"],
        "evaluator_sha256": identity["evaluatorSha256"],
        "search_space_sha256": identity["searchSpaceSha256"],
        "config_sha256": result.get("configSha256") if result else None,
        "wasm_sha256": result.get("wasmSha256") if result else None,
        "result_path": str(candidate_path),
        "elapsed_seconds": elapsed,
        "measurement_invalid_count": result.get("measurement", {}).get("invalidCount", 0) if result else 0,
        "historical_replay": historical,
        "new_candidate_evaluation": not historical,
    }
    for name, value in attributes.items():
        trial.set_user_attr(name, value)


def run_candidate(study, trial, parameters: dict, identity: dict, run_directory: Path, dimensions: list[dict]) -> float:
    start = time.monotonic()
    duplicate = duplicate_observation(study, parameters, identity)
    if duplicate:
        constraints = duplicate.user_attrs["constraints"]
        for name, value in constraints.items():
            trial.set_constraint(name, float(value))
        for name in (
            "stage_reached", "stage1_metrics", "stage2_metrics", "measurement_invalid_count",
            "candidate_result", "config_sha256", "wasm_sha256",
        ):
            if name in duplicate.user_attrs:
                trial.set_user_attr(name, duplicate.user_attrs[name])
        candidate_id = duplicate.user_attrs["candidate_id"]
        # Reuse the completed observation without overwriting its reached stage or
        # artifact hashes with empty values from a renderless replay.
        for name, value in {
            "candidate_id": candidate_id,
            "source_revision": identity["sourceRevision"],
            "source_tree_sha256": identity["wasmTreeSha256"],
            "evaluator_sha256": identity["evaluatorSha256"],
            "search_space_sha256": identity["searchSpaceSha256"],
            "result_path": duplicate.user_attrs["result_path"],
            "elapsed_seconds": time.monotonic() - start,
            "historical_replay": False,
            "duplicate_reused": True,
            "new_candidate_evaluation": False,
        }.items():
            trial.set_user_attr(name, value)
        trial.set_user_attr("constraints", constraints)
        return float(duplicate.value)

    candidate_id = f"gps-e{identity['evaluatorSha256'][:8]}-{trial.number + 1:04d}"
    candidate_path = run_directory / "candidates" / f"{candidate_id}.json"
    build_root = SCRATCH / candidate_id
    candidate = {"candidateId": candidate_id, "parameters": parameters}
    write(candidate_path, candidate)
    result_for_attrs = None
    try:
        stage1_result = evaluate_stage(candidate, 1, build_root, candidate_path)
        def evaluate_stage_callback(stage: int) -> dict:
            nonlocal result_for_attrs
            if stage == 1:
                result_for_attrs = stage1_result
                return stage1_result
            stage2_result = evaluate_stage(candidate, 2, build_root, candidate_path)
            result_for_attrs = stage2_result
            return stage2_result

        loss, detail = objective_result(trial, parameters, evaluate_stage_callback)
        final_result = result_for_attrs or stage1_result
        final_result_path = result_path(candidate_id, 2) if detail["stage_reached"] == 2 else build_root / "stage1-result.json"
        record_trial_identity(trial, candidate_id, identity, final_result, final_result_path,
                              time.monotonic() - start, False)
        trial.set_user_attr("constraints", detail["constraints"])
        trial.set_user_attr("candidate_result", final_result.get("result"))
        trial.set_user_attr("config_sha256", final_result.get("configSha256"))
        trial.set_user_attr("wasm_sha256", final_result.get("wasmSha256"))
        return loss
    except Exception as error:
        error_path = run_directory / "errors" / f"{candidate_id}.json"
        write(error_path, {"candidateId": candidate_id, "parameters": parameters,
                           "sourceRevision": identity["sourceRevision"], "error": str(error),
                           "errorType": type(error).__name__, "recordedAtUtc": utc_now()})
        trial.set_user_attr("candidate_id", candidate_id)
        trial.set_user_attr("error_path", str(error_path))
        trial.set_user_attr("error", f"{type(error).__name__}: {error}")
        raise


def run(max_new_trials: int = MAX_BUDGET, dry_run: bool = False) -> dict:
    raise RuntimeError(
        "READ_ONLY_ARCHIVE: the mixed Stage-1/Stage-2 constraint study cannot be resumed; "
        "use run_split_gpsampler.py --stage 1 or --stage 2"
    )

    # Retained below only as historical implementation evidence; unreachable.
    search = load(SEARCH_PATH)
    verify_search(search)
    if max_new_trials < 1 or max_new_trials > MAX_BUDGET:
        raise ValueError(f"--max-new-trials must be between 1 and {MAX_BUDGET}")
    identity = source_identity(search)
    # Keep observations from different evaluator implementations in separate GP
    # studies, even when the physical search space itself has not changed.
    study_name = f"{search['studyName']}-e{identity['evaluatorSha256'][:8]}"
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_directory = RUNS / run_id
    run_directory.mkdir(parents=True, exist_ok=False)
    storage = f"sqlite:///{DATABASE.resolve()}"
    sampler = optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=10)
    study = optuna.create_study(study_name=study_name, storage=storage, load_if_exists=True,
                                direction="minimize", sampler=sampler)
    starting_trial_number = max((trial.number for trial in study.get_trials(deepcopy=False)), default=-1) + 1
    manifest = {
        "schemaVersion": 1, "runId": run_id, "studyName": study_name,
        "storagePath": str(DATABASE.relative_to(ROOT)), "pythonVersion": sys.version,
        "optunaVersion": optuna.__version__,
        "torchVersion": optional_distribution_version("torch"),
        "scipyVersion": optional_distribution_version("scipy"),
        "seed": 7, "searchSpaceSha256": search["searchSpaceHash"],
        "sourceRevision": identity["sourceRevision"], "sourceDirty": identity["sourceDirty"],
        "wasmTreeSha256": identity["wasmTreeSha256"], "presetSha256": identity["presetSha256"],
        "evaluatorSha256": identity["evaluatorSha256"],
        "startingTrialNumber": starting_trial_number, "maxNewTrials": max_new_trials,
        "startTimeUtc": utc_now(), "endTimeUtc": None, "stopReason": "RUNNING",
        "platform": platform.platform(), "dryRun": dry_run,
    }
    manifest_path = run_directory / "manifest.json"
    write(manifest_path, manifest)
    if dry_run:
        manifest["stopReason"] = "DRY_RUN_NO_RENDER"
        manifest["endTimeUtc"] = utc_now()
        write(manifest_path, manifest)
        print(json.dumps({"studyName": study_name, "studyTrials": len(study.get_trials()),
                          "searchSpaceSha256": search["searchSpaceHash"], "sourceRevision": identity["sourceRevision"],
                          "stopReason": manifest["stopReason"], "runManifest": str(manifest_path)}))
        return manifest

    new_candidate_count = 0
    duplicate_replay_count = 0
    stop_reason = "MAX_NEW_CANDIDATES"
    while new_candidate_count < max_new_trials:
        if source_identity(search) != identity:
            stop_reason = "BLOCKED_SOURCE_CHANGED"
            break
        feasible = feasible_stage2_trials(study)
        if len(feasible) >= MAX_FEASIBLE:
            stop_reason = "THREE_STAGE2_FEASIBLE_CANDIDATES"
            break
        if measurement_health_stop(study):
            stop_reason = "BLOCKED_BY_MEASUREMENT_VALIDITY"
            break
        review = boundary_review(study, search["dimensions"])
        if review:
            write(run_directory / "boundary-review.json", review)
            stop_reason = "STOP_PARAMETER_BOUND_REVIEW"
            break
        valid_stage2 = [t for t in completed_stage2(study) if not t.user_attrs.get("measurement_invalid_count")]
        if len(valid_stage2) >= NO_FEASIBLE_REVIEW_COUNT and not feasible:
            stop_reason = "NO_FEASIBLE_AFTER_30_VALID_STAGE2_TRIALS"
            break

        trial = study.ask()
        parameters = suggest_parameters(trial, search["dimensions"])
        trial.set_user_attr("source_revision", identity["sourceRevision"])
        trial.set_user_attr("source_tree_sha256", identity["wasmTreeSha256"])
        trial.set_user_attr("evaluator_sha256", identity["evaluatorSha256"])
        trial.set_user_attr("search_space_sha256", identity["searchSpaceSha256"])
        try:
            value = run_candidate(study, trial, parameters, identity, run_directory, search["dimensions"])
            study.tell(trial, value)
            if trial.user_attrs.get("new_candidate_evaluation"):
                new_candidate_count += 1
            else:
                duplicate_replay_count += 1
            print(json.dumps({"candidateId": trial.user_attrs.get("candidate_id"),
                              "trialNumber": trial.number,
                              "stageReached": trial.user_attrs.get("stage_reached"),
                              "result": trial.user_attrs.get("candidate_result"),
                              "constraints": trial.user_attrs.get("constraints"),
                              "referenceFitLoss": value,
                              "newCandidates": new_candidate_count,
                              "stage2Feasible": len(feasible_stage2_trials(study))}, sort_keys=True), flush=True)
        except Exception:
            study.tell(trial, state=TrialState.FAIL)
            raise

    manifest["endTimeUtc"] = utc_now()
    manifest["stopReason"] = stop_reason
    manifest["newCandidateCount"] = new_candidate_count
    manifest["duplicateReplayCount"] = duplicate_replay_count
    manifest["stage1EarlyExitCount"] = sum(t.user_attrs.get("stage_reached") == 1 for t in study.get_trials(deepcopy=False, states=(TrialState.COMPLETE,)))
    manifest["stage2CompleteCount"] = len(completed_stage2(study))
    manifest["stage2FeasibleCount"] = len(feasible_stage2_trials(study))
    manifest["measurementInvalidStage2Count"] = sum((t.user_attrs.get("measurement_invalid_count") or 0) > 0 for t in completed_stage2(study))
    write(manifest_path, manifest)
    print(json.dumps({"studyName": study_name, "stopReason": stop_reason,
                      "newCandidateCount": new_candidate_count, "stage1EarlyExitCount": manifest["stage1EarlyExitCount"],
                      "stage2CompleteCount": manifest["stage2CompleteCount"],
                      "stage2FeasibleCount": manifest["stage2FeasibleCount"],
                      "measurementInvalidStage2Count": manifest["measurementInvalidStage2Count"],
                      "runManifest": str(manifest_path)}, sort_keys=True))
    return manifest


def main() -> None:
    raise SystemExit(
        "The mixed-constraint GPSampler study is READ_ONLY_ARCHIVE. "
        "Use run_split_gpsampler.py --stage 1 or --stage 2."
    )


if __name__ == "__main__":
    main()
