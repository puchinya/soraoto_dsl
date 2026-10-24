#!/usr/bin/env python3
"""Run the fixed-schema Stage-1 and Stage-2 Issue #7 GPSampler studies."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import optuna
from optuna.trial import TrialState

from constraints import STAGE1_CONSTRAINT_KEYS, STAGE2_CONSTRAINT_KEYS, stage1_constraints
from objective import stage1_objective_result, stage2_objective_result
from optimize_gpsampler import (
    DATABASE, IDENTITY_FILES, NODE_EVALUATOR, ROOT, SEARCH_PATH, SCRATCH, TUNING,
    hash_files, hash_tree, load, optional_distribution_version, search_identity,
    sha256, suggest_parameters, verify_search, write,
)

ISSUE_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/gpsampler-split"
ARCHIVE_PATH = ISSUE_ROOT / "mixed-study-archive.json"
PILOT_ARCHIVE_PATH = ISSUE_ROOT / "superseded-split-pilot-archive.json"
RUNS = ISSUE_ROOT / "runs"
RESULTS = ISSUE_ROOT / "results"
OLD_PREFIX = "issue-7-grand-v9-opt-"
STAGE1_STUDY_VERSION = "v4"
STAGE2_STUDY_VERSION = "v3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical(parameters: dict) -> str:
    return json.dumps(parameters, sort_keys=True, separators=(",", ":"))


def current_identity(search: dict) -> dict:
    return {
        "sourceRevision": subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sourceDirty": bool(subprocess.check_output(["rtk", "git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
        "sourceTreeSha256": hash_tree(ROOT / "wasm"),
        "evaluatorSha256": hash_files(IDENTITY_FILES),
        "searchSpaceSha256": search["searchSpaceHash"],
        "presetSha256": sha256(ROOT / "wasm/plugins/dsp/super-synth/presets.json"),
    }


def archive_mixed_studies(storage: str, identity: dict) -> dict:
    """Mark all old mixed-vector studies read-only and export every trial verbatim."""
    summaries = []
    for summary in optuna.get_all_study_summaries(storage):
        if not summary.study_name.startswith(OLD_PREFIX):
            continue
        study = optuna.load_study(study_name=summary.study_name, storage=storage)
        study.set_user_attr("workflow_state", "READ_ONLY_ARCHIVE")
        rows = []
        for trial in study.get_trials(deepcopy=False):
            attrs = trial.user_attrs
            provenance_ok = (
                attrs.get("source_revision") == identity["sourceRevision"]
                and attrs.get("source_tree_sha256") == identity["sourceTreeSha256"]
                and attrs.get("evaluator_sha256") == identity["evaluatorSha256"]
                and attrs.get("search_space_sha256") == identity["searchSpaceSha256"]
            )
            rows.append({
                "trialId": trial.number,
                "number": trial.number,
                "state": trial.state.name,
                "parameters": trial.params,
                "objective": trial.value,
                "constraints": trial.system_attrs.get("constraints"),
                "userAttributes": attrs,
                "systemAttributes": trial.system_attrs,
                "provenanceCompatibleWithCurrent": provenance_ok,
            })
        summaries.append({
            "studyName": study.study_name,
            "workflowState": "READ_ONLY_ARCHIVE",
            "trialCount": len(rows),
            "sourceIdentity": study.user_attrs.get("identity"),
            "trials": rows,
        })
    document = {
        "schemaVersion": 1,
        "generatedAtUtc": utc_now(),
        "databasePath": str(DATABASE.relative_to(ROOT)),
        "currentIdentity": identity,
        "mixedStudyCount": len(summaries),
        "studies": summaries,
    }
    write(ARCHIVE_PATH, document)
    return document


def archive_superseded_split_pilots(storage: str, stage: int, target_study: str) -> dict:
    archived = []
    prefix = "issue-7-grand-v9-stage1-gp-" if stage == 1 else "issue-7-grand-v9-stage2-gp-"
    version = STAGE1_STUDY_VERSION if stage == 1 else STAGE2_STUDY_VERSION
    for summary in optuna.get_all_study_summaries(storage):
        if not summary.study_name.startswith(prefix) or summary.study_name == target_study:
            continue
        study = optuna.load_study(study_name=summary.study_name, storage=storage)
        study.set_user_attr("workflowState", "READ_ONLY_ARCHIVE")
        trials = []
        for trial in study.get_trials(deepcopy=False):
            trials.append({"trialId": trial.number, "number": trial.number, "state": trial.state.name,
                "parameters": trial.params, "objective": trial.value,
                "constraints": trial.user_attrs.get("constraints"),
                "userAttributes": trial.user_attrs, "systemAttributes": trial.system_attrs})
        archived.append({"studyName": study.study_name, "workflowState": "READ_ONLY_ARCHIVE",
                          "supersededByVersion": version, "trials": trials})
    result = {"schemaVersion": 1, "generatedAtUtc": utc_now(),
              "databasePath": str(DATABASE.relative_to(ROOT)), "studies": archived,
              "trialCount": sum(len(item["trials"]) for item in archived)}
    write(PILOT_ARCHIVE_PATH, result)
    return result


def stage_study_name(stage: int, search_hash: str) -> str:
    prefix = f"issue-7-grand-v9-stage1-gp-{STAGE1_STUDY_VERSION}-" if stage == 1 else f"issue-7-grand-v9-stage2-gp-{STAGE2_STUDY_VERSION}-"
    return prefix + search_hash


def ordered_constraints(stage: int) -> tuple[str, ...]:
    return STAGE1_CONSTRAINT_KEYS if stage == 1 else STAGE2_CONSTRAINT_KEYS


def set_study_constraints(trial, stage: int, constraints: dict) -> None:
    keys = ordered_constraints(stage)
    if tuple(constraints) != keys:
        raise ValueError(f"persisted constraint schema/order mismatch for Stage {stage}")
    for key in keys:
        trial.set_constraint(key, float(constraints[key]))
    trial.set_user_attr("constraints", constraints)


def compatible_legacy_candidates(archive: dict, identity: dict) -> list[dict]:
    found = {}
    for study in archive["studies"]:
        for row in study["trials"]:
            if row["state"] != "COMPLETE" or not row["parameters"]:
                continue
            attrs = row["userAttributes"]
            if not row["provenanceCompatibleWithCurrent"]:
                continue
            if any(attrs.get(key) != identity.get(identity_key) for key, identity_key in (
                ("source_revision", "sourceRevision"),
                ("source_tree_sha256", "sourceTreeSha256"),
                ("evaluator_sha256", "evaluatorSha256"),
                ("search_space_sha256", "searchSpaceSha256"),
            )):
                continue
            if not attrs.get("config_sha256") or not attrs.get("wasm_sha256"):
                continue
            params = row["parameters"]
            key = canonical(params)
            entry = found.setdefault(key, {"parameters": params, "candidateId": attrs.get("candidate_id"),
                "configSha256": attrs.get("config_sha256"), "wasmSha256": attrs.get("wasm_sha256"),
                "resultPath": attrs.get("result_path"),
                "stage1": None, "stage2": None})
            if entry["stage1"] is None and attrs.get("stage1_metrics"):
                entry["stage1"] = {"metrics": attrs["stage1_metrics"], "measurement": {"invalidCount": attrs.get("measurement_invalid_count", 0)}, "result": attrs.get("candidate_result")}
                entry["stage1Loss"] = row["objective"]
            if attrs.get("stage2_metrics"):
                entry["stage2"] = {"metrics": attrs["stage2_metrics"], "measurement": {"invalidCount": attrs.get("measurement_invalid_count", 0)}, "result": attrs.get("candidate_result")}
                entry["stage2Loss"] = row["objective"]
    return list(found.values())


def old_candidate_vectors(archive: dict) -> list[dict]:
    found = {}
    for study in archive["studies"]:
        for row in study["trials"]:
            if row["state"] == "COMPLETE" and row["parameters"]:
                found.setdefault(canonical(row["parameters"]), row["parameters"])
    return list(found.values())


def previous_stage2_pass_vector(archive: dict) -> dict | None:
    for study in archive["studies"]:
        for row in study["trials"]:
            attrs = row["userAttributes"]
            if row["state"] == "COMPLETE" and attrs.get("stage_reached") == 2 and attrs.get("candidate_result") == "PASS":
                return {"parameters": row["parameters"], "candidateId": attrs.get("candidate_id")}
    return None


def create_or_validate_study(study_name: str, storage: str, identity: dict, keys: tuple[str, ...]):
    sampler = optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=10)
    study = optuna.create_study(study_name=study_name, storage=storage, load_if_exists=True,
                                direction="minimize", sampler=sampler)
    old_identity = study.user_attrs.get("sourceIdentity")
    if old_identity is not None and old_identity != identity:
        if study.get_trials(deepcopy=False):
            raise RuntimeError("BLOCKED_SOURCE_CHANGED: existing split study identity differs from current source")
        # A dry-run creates a named but empty study. Rebind that empty shell to
        # the finalized source identity; no observation is carried across hashes.
        study.set_user_attr("sourceIdentity", identity)
    old_schema = study.user_attrs.get("constraintSchema")
    if old_schema is not None and old_schema != list(keys):
        raise RuntimeError("study constraint schema changed; create a new versioned study")
    study.set_user_attr("sourceIdentity", identity)
    study.set_user_attr("constraintSchema", list(keys))
    study.set_user_attr("workflowState", "ACTIVE_SPLIT_STUDY")
    return study


def constraint_feasible(values: dict, aggregate: str) -> bool:
    return float(values.get(aggregate, math.inf)) <= 0.0


def enqueue_once(study, parameters: dict, tag: str, payload: dict | None = None) -> bool:
    key = canonical(parameters)
    for trial in study.get_trials(deepcopy=False):
        if trial.user_attrs.get("seed_canonical") == key or (trial.state == TrialState.COMPLETE and canonical(trial.params) == key):
            return False
    attrs = {"seed_canonical": key, "seed_kind": tag}
    if payload is not None:
        attrs["historical_payload"] = payload
    study.enqueue_trial(parameters, user_attrs=attrs, skip_if_exists=True)
    return True


def duplicate_observation(study, parameters: dict, identity: dict):
    for old in reversed(study.get_trials(deepcopy=False, states=(TrialState.COMPLETE,))):
        attrs = old.user_attrs
        if attrs.get("source_revision") != identity["sourceRevision"]:
            continue
        if attrs.get("source_tree_sha256") != identity["sourceTreeSha256"]:
            continue
        if attrs.get("evaluator_sha256") != identity["evaluatorSha256"]:
            continue
        if attrs.get("search_space_sha256") != identity["searchSpaceSha256"]:
            continue
        if old.params == parameters and attrs.get("constraints") is not None:
            return old
    return None


def evaluate_candidate(candidate: dict, stage: int, build_root: Path, candidate_path: Path) -> dict:
    output = build_root / "stage1-result.json" if stage == 1 else RESULTS / f"{candidate['candidateId']}.stage2.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    command = ["rtk", "node", str(NODE_EVALUATOR), "--candidate", str(candidate_path), "--stage", str(stage),
               "--build-root", str(build_root), "--output", str(output)]
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    (build_root / f"stage{stage}-stdout.log").write_text(completed.stdout)
    (build_root / f"stage{stage}-stderr.log").write_text(completed.stderr)
    if completed.returncode != 0:
        raise RuntimeError(f"candidate evaluator Stage {stage} failed: {completed.stderr[-2000:]}")
    return load(output)


def stage1_rank(trial):
    constraints = trial.user_attrs.get("constraints", {})
    margin = min((max(0.0, -float(v)) for k, v in constraints.items() if k != "stage1_violation"), default=0.0)
    return (0 if constraints.get("stage1_violation", 1.0) <= 0 else 1,
            float(constraints.get("stage1_violation", math.inf)),
            float(trial.value if trial.value is not None else math.inf), -margin)


def stage2_stop_reason(study, dimensions: list[dict]) -> str | None:
    completed = [trial for trial in study.get_trials(deepcopy=False, states=(TrialState.COMPLETE,))
                 if trial.user_attrs.get("stage_reached") == 2]
    feasible = [trial for trial in completed
                if trial.user_attrs.get("constraints", {}).get("stage1_violation", 1.0) <= 0.0
                and trial.user_attrs.get("constraints", {}).get("stage2_violation", 1.0) <= 0.0]
    if len(feasible) >= 3:
        return "THREE_STAGE2_FEASIBLE_CANDIDATES"
    recent = completed[-20:]
    if len(recent) == 20 and sum((trial.user_attrs.get("measurement_invalid_count") or 0) > 0 for trial in recent) / 20 > 0.20:
        return "BLOCKED_BY_MEASUREMENT_VALIDITY"
    valid = [trial for trial in completed if not (trial.user_attrs.get("measurement_invalid_count") or 0)]
    if len(valid) >= 30 and not feasible:
        return "NO_FEASIBLE_AFTER_30_VALID_STAGE2_TRIALS"
    best = sorted(completed, key=lambda trial: float(trial.value if trial.value is not None else math.inf))[:5]
    if len(best) == 5:
        for dimension in dimensions:
            low, high = float(dimension["min"]), float(dimension["max"])
            width = high - low
            outer = sum((trial.params[dimension["name"]] - low) / width <= 0.02
                        or (trial.params[dimension["name"]] - low) / width >= 0.98 for trial in best)
            if outer >= 4:
                return "STOP_PARAMETER_BOUND_REVIEW"
    return None


def choose_stage2_seeds(study, historical_pass: dict | None, wanted: int = 10) -> list[tuple[dict, str, dict | None]]:
    selected = []
    used = set()
    if historical_pass:
        params = historical_pass["parameters"]
        selected.append((params, "previous-stage2-pass-current-rerender", None))
        used.add(canonical(params))
    completed = [trial for trial in study.get_trials(deepcopy=False, states=(TrialState.COMPLETE,))
                 if trial.user_attrs.get("stage_reached") == 1]
    ranked = sorted(completed, key=stage1_rank)
    while ranked and len(selected) < wanted:
        available = [trial for trial in ranked if canonical(trial.params) not in used]
        if not available:
            break
        pool = available[:min(len(available), max(3, wanted - len(selected)))]
        if selected:
            def diversity(trial):
                return min(sum((float(trial.params[n]) - float(p[n])) ** 2 for n in trial.params) for p, _, _ in selected)
            choice = max(pool, key=lambda trial: ( -stage1_rank(trial)[0], -stage1_rank(trial)[1], -stage1_rank(trial)[2], diversity(trial)))
        else:
            choice = pool[0]
        params = dict(choice.params)
        selected.append((params, "stage1-ranked-seed", None))
        used.add(canonical(params))
    return selected[:wanted]


def run(stage: int, max_new_trials: int = 40, dry_run: bool = False) -> dict:
    search = load(SEARCH_PATH)
    verify_search(search)
    if not 1 <= max_new_trials <= 40:
        raise ValueError("--max-new-trials must be between 1 and 40")
    identity = current_identity(search)
    storage = f"sqlite:///{DATABASE.resolve()}"
    study_name = stage_study_name(stage, search["searchSpaceHash"])
    pilot_archive = archive_superseded_split_pilots(storage, stage, study_name)
    archive = archive_mixed_studies(storage, identity)
    keys = ordered_constraints(stage)
    study = create_or_validate_study(study_name, storage, identity, keys)
    existing_trial_numbers = {trial.number for trial in study.get_trials(deepcopy=False)}
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = RUNS / f"stage{stage}-{run_id}"
    run_dir.mkdir(parents=True, exist_ok=False)
    manifest = {
        "schemaVersion": 1, "runId": run_id, "studyName": study_name, "stage": stage,
        "storagePath": str(DATABASE.relative_to(ROOT)), "archivePath": str(ARCHIVE_PATH.relative_to(ROOT)),
        "supersededSplitArchivePath": str(PILOT_ARCHIVE_PATH.relative_to(ROOT)),
        "supersededSplitPilotTrials": pilot_archive["trialCount"],
        "pythonVersion": sys.version, "optunaVersion": optuna.__version__,
        "torchVersion": optional_distribution_version("torch"), "scipyVersion": optional_distribution_version("scipy"),
        "seed": 7, "searchSpaceSha256": search["searchSpaceHash"], "sourceIdentity": identity,
        "constraintSchema": list(keys), "startingTrialNumber": len(study.trials),
        "maxNewTrials": max_new_trials, "startTimeUtc": utc_now(), "endTimeUtc": None,
        "stopReason": "DRY_RUN_NO_RENDER" if dry_run else "RUNNING",
        "historicalMixedCandidateCount": len(old_candidate_vectors(archive)),
        "compatibleHistoricalCount": len(compatible_legacy_candidates(archive, identity)),
        "incompatibleHistoricalCount": len(old_candidate_vectors(archive)) - len(compatible_legacy_candidates(archive, identity)),
        "sourceDirty": identity["sourceDirty"], "platform": platform.platform(),
    }
    write(run_dir / "manifest.json", manifest)
    if dry_run:
        manifest["endTimeUtc"] = utc_now()
        write(run_dir / "manifest.json", manifest)
        return manifest

    if stage == 2:
        already_stopped = stage2_stop_reason(study, search["dimensions"])
        if already_stopped:
            manifest["stopReason"] = already_stopped
            manifest["endTimeUtc"] = utc_now()
            write(run_dir / "manifest.json", manifest)
            return manifest

    if stage == 1:
        for candidate in compatible_legacy_candidates(archive, identity):
            payload = candidate if candidate.get("stage1") else None
            enqueue_once(study, candidate["parameters"],
                         "historical-compatible-replay" if payload else "compatible-missing-metrics-rerender", payload)
    else:
        stage1_name = stage_study_name(1, search["searchSpaceHash"])
        stage1_study = optuna.load_study(study_name=stage1_name, storage=storage)
        historical_pass = previous_stage2_pass_vector(archive)
        for entry in compatible_legacy_candidates(archive, identity):
            if entry.get("stage2") and entry["stage2"].get("result") == "PASS":
                historical_pass = entry
                break
        seeds = choose_stage2_seeds(stage1_study, historical_pass, wanted=10)
        if len(seeds) < 10:
            manifest["stopReason"] = "BLOCKED_INSUFFICIENT_DISTINCT_STAGE1_SEEDS"
            manifest["stage1SeedCount"] = len(seeds)
            manifest["endTimeUtc"] = utc_now()
            write(run_dir / "manifest.json", manifest)
            return manifest
        for params, kind, payload in seeds:
            enqueue_once(study, params, kind, payload)

    budget = max_new_trials

    def objective(trial):
        if current_identity(search) != identity:
            raise RuntimeError("BLOCKED_SOURCE_CHANGED: source/config/evaluator hashes changed during run")
        parameters = suggest_parameters(trial, search["dimensions"])
        seed_kind = trial.user_attrs.get("seed_kind")
        payload = trial.user_attrs.get("historical_payload")
        start = time.monotonic()
        version = STAGE1_STUDY_VERSION if stage == 1 else STAGE2_STUDY_VERSION
        candidate_id = f"split-{version}-s{stage}-{trial.number + 1:04d}"
        trial.set_user_attr("candidate_id", candidate_id)
        for key, value in (("source_revision", identity["sourceRevision"]), ("source_tree_sha256", identity["sourceTreeSha256"]),
                           ("evaluator_sha256", identity["evaluatorSha256"]), ("search_space_sha256", identity["searchSpaceSha256"])):
            trial.set_user_attr(key, value)
        duplicate = duplicate_observation(study, parameters, identity)
        if duplicate is not None:
            set_study_constraints(trial, stage, duplicate.user_attrs["constraints"])
            for key in ("stage_reached", "stage1_metrics", "stage2_metrics", "measurement_invalid_count",
                        "candidate_result", "config_sha256", "wasm_sha256", "candidate_provenance"):
                if key in duplicate.user_attrs:
                    trial.set_user_attr(key, duplicate.user_attrs[key])
            trial.set_user_attr("candidate_id", duplicate.user_attrs.get("candidate_id"))
            trial.set_user_attr("result_path", duplicate.user_attrs.get("result_path"))
            trial.set_user_attr("historical_replay", False)
            trial.set_user_attr("duplicate_reused", True)
            trial.set_user_attr("new_candidate_evaluation", False)
            trial.set_user_attr("elapsed_seconds", 0.0)
            return float(duplicate.value)
        if payload:
            stage1_result, stage2_result = payload.get("stage1"), payload.get("stage2")
            if stage == 1 and stage1_result:
                value = float(payload["stage1Loss"])
                constraints = stage1_constraints(stage1_result["metrics"])
                from objective import _record
                _record(trial, STAGE1_CONSTRAINT_KEYS, constraints)
                trial.set_user_attr("stage_reached", 1)
                trial.set_user_attr("stage1_metrics", stage1_result["metrics"])
                trial.set_user_attr("historical_replay", True)
                trial.set_user_attr("new_candidate_evaluation", False)
                trial.set_user_attr("candidate_id", payload.get("candidateId"))
                trial.set_user_attr("result_path", payload.get("resultPath"))
                trial.set_user_attr("elapsed_seconds", 0.0)
                trial.set_user_attr("config_sha256", payload.get("configSha256"))
                trial.set_user_attr("wasm_sha256", payload.get("wasmSha256"))
                trial.set_user_attr("candidate_result", stage1_result.get("result"))
                trial.set_user_attr("measurement_invalid_count", stage1_result.get("measurement", {}).get("invalidCount", 0))
                return value
            if stage == 2 and stage1_result and stage2_result:
                from constraints import stage2_constraints, combined_trial_constraints
                c1, c2 = stage1_constraints(stage1_result["metrics"]), stage2_constraints(stage2_result["metrics"])
                constraints = combined_trial_constraints(c1, c2)
                set_study_constraints(trial, 2, constraints)
                trial.set_user_attr("stage_reached", 2)
                trial.set_user_attr("stage1_metrics", stage1_result["metrics"])
                trial.set_user_attr("stage2_metrics", stage2_result["metrics"])
                trial.set_user_attr("historical_replay", True)
                trial.set_user_attr("new_candidate_evaluation", False)
                trial.set_user_attr("candidate_id", payload.get("candidateId"))
                trial.set_user_attr("result_path", payload.get("resultPath"))
                trial.set_user_attr("elapsed_seconds", 0.0)
                trial.set_user_attr("config_sha256", payload.get("configSha256"))
                trial.set_user_attr("wasm_sha256", payload.get("wasmSha256"))
                trial.set_user_attr("measurement_invalid_count", stage2_result.get("measurement", {}).get("invalidCount", 0))
                trial.set_user_attr("candidate_result", stage2_result.get("result"))
                return float(payload["stage2Loss"])

        candidate = {"candidateId": candidate_id, "parameters": parameters}
        candidate_path = run_dir / "candidates" / f"{candidate_id}.json"
        write(candidate_path, candidate)
        build_root = SCRATCH / "split" / f"stage{stage}" / candidate_id
        def evaluate(which: int):
            return evaluate_candidate(candidate, which, build_root, candidate_path)
        if stage == 1:
            value, details = stage1_objective_result(trial, parameters, evaluate)
            final = details["stage1"]
        else:
            value, details = stage2_objective_result(trial, parameters, evaluate)
            final = details["stage2"]
        trial.set_user_attr("historical_replay", False)
        trial.set_user_attr("new_candidate_evaluation", True)
        trial.set_user_attr("seed_kind", seed_kind or "gpsampler")
        trial.set_user_attr("result_path", str(candidate_path))
        trial.set_user_attr("elapsed_seconds", time.monotonic() - start)
        trial.set_user_attr("config_sha256", final.get("configSha256"))
        trial.set_user_attr("wasm_sha256", final.get("wasmSha256"))
        trial.set_user_attr("candidate_result", final.get("result"))
        trial.set_user_attr("measurement_invalid_count", final.get("measurement", {}).get("invalidCount", 0))
        trial.set_user_attr("candidate_provenance", {key: final.get(key) for key in ("sourceRevision", "sourceTreeSha256", "evaluatorSha256", "configSha256", "wasmSha256")})
        write(RESULTS / f"{candidate_id}.stage{stage}.json", {"stage1": details.get("stage1"), "stage2": details.get("stage2"), "result": final})
        return value

    stop_state = {"reason": None}

    def stop_after_trial(current_study, _frozen_trial):
        if stage == 2:
            reason = stage2_stop_reason(current_study, search["dimensions"])
            if reason:
                stop_state["reason"] = reason
                current_study.stop()

    try:
        study.optimize(objective, n_trials=budget, n_jobs=1, callbacks=[stop_after_trial], catch=())
    except RuntimeError as error:
        if "BLOCKED_SOURCE_CHANGED" in str(error):
            stop_state["reason"] = "BLOCKED_SOURCE_CHANGED"
        else:
            manifest["endTimeUtc"] = utc_now()
            manifest["stopReason"] = "INFRASTRUCTURE_FAILURE"
            manifest["error"] = f"{type(error).__name__}: {error}"
            write(run_dir / "manifest.json", manifest)
            raise
    new_trials = [trial for trial in study.trials
                  if trial.number not in existing_trial_numbers and trial.state != TrialState.WAITING]
    manifest["endTimeUtc"] = utc_now()
    manifest["stopReason"] = stop_state["reason"] or "TRIAL_BUDGET_REACHED"
    manifest["newTrialCount"] = len(new_trials)
    manifest["completeCount"] = sum(t.state == TrialState.COMPLETE for t in new_trials)
    manifest["failCount"] = sum(t.state == TrialState.FAIL for t in new_trials)
    manifest["newCandidateEvaluationCount"] = sum(t.user_attrs.get("new_candidate_evaluation") is True for t in new_trials)
    manifest["duplicateReuseCount"] = sum(t.user_attrs.get("duplicate_reused") is True for t in new_trials)
    manifest["historicalReplayCount"] = sum(t.user_attrs.get("historical_replay") is True for t in new_trials)
    manifest["stage1EarlyExitCount"] = sum(t.user_attrs.get("stage_reached") == 1 for t in study.trials if t.state == TrialState.COMPLETE)
    manifest["stage2CompleteCount"] = sum(t.user_attrs.get("stage_reached") == 2 for t in study.trials if t.state == TrialState.COMPLETE)
    manifest["stage2FeasibleCount"] = sum(
        t.user_attrs.get("constraints", {}).get("stage2_violation", 1.0) <= 0
        and t.user_attrs.get("constraints", {}).get("stage1_violation", 1.0) <= 0
        for t in study.trials if t.state == TrialState.COMPLETE
    )
    manifest["trialNumbers"] = [t.number for t in new_trials]
    manifest["archiveTrialCount"] = sum(item["trialCount"] for item in archive["studies"])
    write(run_dir / "manifest.json", manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, type=int, choices=(1, 2))
    parser.add_argument("--max-new-trials", type=int, default=40)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.stage, args.max_new_trials, args.dry_run)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
