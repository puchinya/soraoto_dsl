#!/usr/bin/env python3
"""Stage-2B direct-reference proxy study using the approved six dimensions."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import optuna
from optuna.trial import TrialState

from constraints import STAGE2B_CONSTRAINT_KEYS
from objective import stage2b_objective_result

ROOT = Path(__file__).resolve().parents[6]
SPACE_PATH = ROOT / "wasm/plugins/dsp/super-synth/test/tuning/gpsampler-search-space.json"
SUBSET_PATH = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
STAGE2_EVIDENCE = ROOT / ".agent-state/issues/7/calibration-optuna/gpsampler-split/runs/stage2-20260928T133429Z"
DATABASE = ROOT / ".agent-state/issues/7/calibration-optuna/study.db"
V1_RUN_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b"
RUN_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/recovery-v2"
EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs"
IDENTITY_FILES = [
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/supersynth-v9-full-range-calibration.test.js",
    "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
    "wasm/plugins/dsp/super-synth/test/tuning/objective.py",
    "wasm/plugins/dsp/super-synth/test/tuning/run_stage2b_gpsampler.py",
    "wasm/plugins/dsp/super-synth/test/tuning/gpsampler-search-space.json",
    "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json",
    "wasm/plugins/dsp/super-synth/src/plugin.c",
    "wasm/plugins/dsp/super-synth/presets.json",
    "wasm/cmake/super_synth_metadata.py",
    "wasm/cmake/generate_plugin_metadata.py",
    "web-player/src/js/plugin-cbor.js",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def identity(search: dict, subset: dict) -> dict:
    evaluator = hashlib.sha256()
    for relative in sorted(IDENTITY_FILES):
        evaluator.update(relative.encode())
        evaluator.update(b"\0")
        evaluator.update((ROOT / relative).read_bytes())
        evaluator.update(b"\0")
    revision = subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(["rtk", "git", "status", "--porcelain"], cwd=ROOT, text=True).strip())
    return {
        "sourceRevision": revision,
        "sourceDirty": dirty,
        "sourceTreeSha256": hash_tree(ROOT / "wasm"),
        "evaluatorSha256": evaluator.hexdigest(),
        "searchSpaceSha256": search["searchSpaceHash"],
        "subsetSha256": subset["subsetSha256"],
        "presetSha256": sha256(ROOT / "wasm/plugins/dsp/super-synth/presets.json"),
    }


def canonical(params: dict) -> str:
    normalized = {key: (float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else value)
                  for key, value in params.items()}
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"))


def study_name(search: dict, version: int = 2) -> str:
    return f"issue-7-grand-v9-stage2b-direct-proxy-v{version}-{search['searchSpaceHash']}"


def existing_stage2_candidates(storage: str, search: dict) -> list[dict]:
    name = f"issue-7-grand-v9-stage2-gp-v3-{search['searchSpaceHash']}"
    names = {summary.study_name for summary in optuna.get_all_study_summaries(storage)}
    if name not in names:
        raise RuntimeError(f"required current Stage-2 study is missing: {name}")
    study = optuna.load_study(study_name=name, storage=storage)
    trials = sorted((trial for trial in study.trials if trial.state == TrialState.COMPLETE
                     and trial.user_attrs.get("stage_reached") == 2), key=lambda trial: trial.number)
    if len(trials) != 16:
        raise RuntimeError(f"Stage-2 baseline changed: expected 16 COMPLETE observations, found {len(trials)}")
    return [{"parameters": dict(trial.params), "sourceCandidateId": trial.user_attrs.get("candidate_id"),
             "sourceTrialNumber": trial.number, "sourceLoss": float(trial.value)} for trial in trials]


def make_oat_probes(candidates: list[dict], dimensions: list[dict]) -> list[dict]:
    center = min(candidates, key=lambda candidate: candidate["sourceLoss"])
    probes = []
    for dimension in dimensions:
        name, low, high = dimension["name"], float(dimension["min"]), float(dimension["max"])
        current = float(center["parameters"][name])
        targets = [high, (low + high) / 2] if current <= low else [low, (low + high) / 2] if current >= high else [low, high]
        for direction, target in zip(("low", "high"), targets):
            params = dict(center["parameters"])
            params[name] = target
            if canonical(params) != canonical(center["parameters"]):
                probes.append({"parameters": params, "sourceCandidateId": center["sourceCandidateId"],
                               "parameter": name, "direction": direction})
    unique = {}
    for probe in probes:
        unique.setdefault(canonical(probe["parameters"]), probe)
    return list(unique.values())


def enqueue_missing(study, seeds: list[dict], seed_kind: str) -> int:
    existing = set()
    for trial in study.trials:
        if trial.params:
            existing.add(canonical(trial.params))
        if trial.state == TrialState.WAITING:
            fixed = trial.system_attrs.get("fixed_params", {})
            if fixed:
                existing.add(canonical(fixed))
    added = 0
    for index, seed in enumerate(seeds, 1):
        params = seed["parameters"]
        key = canonical(params)
        if key in existing:
            continue
        attrs = {"seed_kind": seed.get("seedKind", seed_kind), "seed_index": index,
                 "source_candidate_id": seed.get("sourceCandidateId"),
                 "source_trial_number": seed.get("sourceTrialNumber"),
                 "oat_parameter": seed.get("parameter"), "oat_direction": seed.get("direction"),
                 "historical_result_path": seed.get("resultPath"),
                 "historical_parent_trial_number": seed.get("parentTrialNumber"),
                 "historical_parent_study": seed.get("parentStudy")}
        study.enqueue_trial(params, user_attrs=attrs)
        existing.add(key)
        added += 1
    return added


def complete_unique_trials(trials: list) -> list:
    unique = {}
    for trial in sorted(trials, key=lambda item: item.number):
        if trial.state != TrialState.COMPLETE or not trial.params:
            continue
        unique.setdefault(canonical(trial.params), trial)
    return list(unique.values())


def historical_stage2b_seeds(v1_study, parent_identity: dict, prior: list[dict], oat: list[dict]) -> list[dict]:
    """Return one validated, render-free replay seed per unique v1 observation."""
    if v1_study.user_attrs.get("sourceIdentity") != parent_identity:
        raise RuntimeError("v1 source identity does not match its stored recovery identity")
    if v1_study.user_attrs.get("constraintSchema") != list(STAGE2B_CONSTRAINT_KEYS):
        raise RuntimeError("v1 Stage-2B constraint schema does not match the fixed v2 schema")

    expected_oat = {canonical(seed["parameters"]): seed for seed in oat}
    expected_prior = {canonical(seed["parameters"]): seed for seed in prior}
    unique_trials = {}
    for trial in sorted(v1_study.trials, key=lambda item: item.number):
        if trial.state != TrialState.COMPLETE or trial.user_attrs.get("stage_reached") != "2B":
            continue
        if trial.user_attrs.get("duplicate_reused"):
            continue
        if trial.user_attrs.get("historical_replay"):
            continue
        key = canonical(trial.params)
        unique_trials.setdefault(key, trial)

    seeds = []
    result_evaluator_identity = None
    for key, trial in unique_trials.items():
        if trial.user_attrs.get("source_tree_sha256") != parent_identity["sourceTreeSha256"]:
            raise RuntimeError(f"v1 trial {trial.number} has a different source tree identity")
        if trial.user_attrs.get("evaluator_identity_sha256") != parent_identity["evaluatorSha256"]:
            raise RuntimeError(f"v1 trial {trial.number} has a different evaluator identity")
        if trial.user_attrs.get("search_space_sha256") != parent_identity["searchSpaceSha256"]:
            raise RuntimeError(f"v1 trial {trial.number} has a different search-space identity")
        if trial.user_attrs.get("subset_sha256") != parent_identity["subsetSha256"]:
            raise RuntimeError(f"v1 trial {trial.number} has a different diagnostic-subset identity")
        relative = trial.user_attrs.get("result_path")
        if not relative:
            raise RuntimeError(f"v1 trial {trial.number} has no persisted result path")
        result_path = ROOT / relative
        if not result_path.is_file():
            raise RuntimeError(f"v1 result file is missing for trial {trial.number}: {relative}")
        result = json.loads(result_path.read_text())
        if result.get("result") != "COMPLETE" or result.get("stage2bReached") is not True:
            raise RuntimeError(f"v1 result file is incomplete for trial {trial.number}")
        if canonical(result.get("parameters", {})) != key:
            raise RuntimeError(f"v1 result parameters do not match trial {trial.number}")
        if result.get("sourceTreeSha256") != parent_identity["sourceTreeSha256"]:
            raise RuntimeError(f"v1 result source-tree identity mismatch for trial {trial.number}")
        if result_evaluator_identity is None:
            result_evaluator_identity = result.get("evaluatorSha256")
        elif result.get("evaluatorSha256") != result_evaluator_identity:
            raise RuntimeError(f"v1 result evaluator identity differs for trial {trial.number}")
        if result.get("subsetSha256") != parent_identity["subsetSha256"]:
            raise RuntimeError(f"v1 result subset identity mismatch for trial {trial.number}")
        if result.get("configSha256") != trial.user_attrs.get("config_sha256"):
            raise RuntimeError(f"v1 config hash mismatch for trial {trial.number}")
        if result.get("wasmSha256") != trial.user_attrs.get("wasm_sha256"):
            raise RuntimeError(f"v1 WASM hash mismatch for trial {trial.number}")
        if len(trial.user_attrs.get("constraints", {})) != len(STAGE2B_CONSTRAINT_KEYS):
            raise RuntimeError(f"v1 trial {trial.number} lacks the complete Stage-2B constraint vector")

        metadata = expected_oat.get(key)
        kind = "one-at-a-time-authority-probe" if metadata else "stage2-prior-candidate"
        if not metadata and key not in expected_prior:
            raise RuntimeError(f"v1 unique observation {trial.number} is neither a known Stage-2 seed nor OAT probe")
        seeds.append({
            "parameters": dict(trial.params),
            "sourceCandidateId": (trial.user_attrs.get("source_candidate_id")
                                  or trial.user_attrs.get("candidate_id")),
            "sourceTrialNumber": trial.number,
            "sourceLoss": float(trial.value),
            "seedKind": kind,
            "parameter": metadata.get("parameter") if metadata else None,
            "direction": metadata.get("direction") if metadata else None,
            "resultEvaluatorSha256": result.get("evaluatorSha256"),
            "resultPath": str(result_path.relative_to(ROOT)),
            "parentTrialNumber": trial.number,
            "parentStudy": v1_study.study_name,
        })

    historical_oat_keys = {key for key, trial in unique_trials.items()
                           if trial.user_attrs.get("seed_kind") == "one-at-a-time-authority-probe"}
    if not historical_oat_keys <= set(expected_oat):
        raise RuntimeError("v1 contains an OAT vector that is not part of the current 12-probe design")
    expected_keys = set(expected_prior) | historical_oat_keys
    if set(unique_trials) != expected_keys:
        missing = sorted(expected_keys - set(unique_trials))
        extra = sorted(set(unique_trials) - expected_keys)
        raise RuntimeError(f"v1 recovery observations mismatch expected vectors (missing={len(missing)}, extra={len(extra)})")
    if len(seeds) != 18:
        raise RuntimeError(f"v2 recovery expected exactly 18 unique v1 observations, found {len(seeds)}")
    return seeds


def suggest(trial, dimensions: list[dict]) -> dict:
    result = {}
    for dimension in dimensions:
        result[dimension["name"]] = trial.suggest_float(dimension["name"], float(dimension["min"]), float(dimension["max"]))
    return result


def analyze_authority(trials: list, center_id: str) -> dict:
    complete = [trial for trial in trials if trial.state == TrialState.COMPLETE and trial.user_attrs.get("stage_reached") == "2B"]
    center = next((trial for trial in complete if trial.user_attrs.get("candidate_id") == center_id), None)
    if center is None:
        center = min(complete, key=lambda trial: trial.value)
    feasible_stage2 = [trial for trial in complete
                       if trial.user_attrs["constraints"].get("stage1_violation", 1) <= 0
                       and trial.user_attrs["constraints"].get("stage2_violation", 1) <= 0]
    targets = {
        "postAttackShape": "post_attack_shape_violation_db",
        "dynamicSpan": "dynamic_span_violation_db",
        "brightnessDirection": "brightness_direction_violation",
    }
    movement = {}
    for family, key in targets.items():
        base = float(center.user_attrs["constraints"][key])
        values = [(trial, float(trial.user_attrs["constraints"][key])) for trial in feasible_stage2]
        best = min((value for _, value in values), default=base)
        movement[family] = {"centerViolation": base, "bestStage2FeasibleViolation": best,
            "improvement": base - best, "stage2FeasibleTrialsMeasured": len(values),
            "movedTowardAcceptance": best < base - 1e-6}
    sufficient = all(item["movedTowardAcceptance"] for item in movement.values())
    return {"status": "CURRENT_SPACE_SUFFICIENT" if sufficient else "BLOCKED_MISSING_PHYSICAL_DEGREE_OF_FREEDOM",
            "centerCandidateId": center.user_attrs.get("candidate_id"),
            "stage2FeasibleTrialCount": len(feasible_stage2), "families": movement,
            "decisionRule": "Each dominant proxy violation must decrease by more than 1e-6 in at least one Stage-2-feasible observation, compared with the best Stage-2 baseline candidate."}


def run_evaluator(candidate_path: Path, build_root: Path, output_path: Path) -> dict:
    build_root.mkdir(parents=True, exist_ok=True)
    command = ["rtk", "node", str(EVALUATOR), "--candidate", str(candidate_path),
               "--subset", str(SUBSET_PATH), "--build-root", str(build_root), "--output", str(output_path)]
    process = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    (build_root / "stage2b-stdout.log").write_text(process.stdout)
    (build_root / "stage2b-stderr.log").write_text(process.stderr)
    if process.returncode:
        raise RuntimeError(f"Stage-2B evaluator failed: {process.stderr[-3000:]}")
    return json.loads(output_path.read_text())


def replay_stage2b_result(trial, parameters: dict, result: dict, result_path: Path,
                          parent_identity: dict, parent_study_name: str) -> float:
    """Populate one v2 COMPLETE observation from a validated v1 result, without rendering."""
    if canonical(result.get("parameters", {})) != canonical(parameters):
        raise RuntimeError("historical replay parameters differ from enqueued v2 candidate")
    trial.set_user_attr("candidate_id", result.get("candidateId"))
    trial.set_user_attr("historical_replay", True)
    trial.set_user_attr("historical_parent_study", parent_study_name)
    trial.set_user_attr("historical_parent_trial_number", trial.user_attrs.get("historical_parent_trial_number"))
    trial.set_user_attr("source_revision", result.get("sourceRevision"))
    trial.set_user_attr("source_tree_sha256", result.get("sourceTreeSha256"))
    trial.set_user_attr("evaluator_identity_sha256", parent_identity["evaluatorSha256"])
    trial.set_user_attr("result_evaluator_sha256", result.get("evaluatorSha256"))
    trial.set_user_attr("search_space_sha256", parent_identity["searchSpaceSha256"])
    trial.set_user_attr("subset_sha256", result.get("subsetSha256"))
    trial.set_user_attr("source_dirty", result.get("sourceDirty"))
    trial.set_user_attr("config_sha256", result.get("configSha256"))
    trial.set_user_attr("wasm_sha256", result.get("wasmSha256"))
    trial.set_user_attr("result_path", str(result_path.relative_to(ROOT)))
    trial.set_user_attr("elapsed_seconds", 0.0)
    trial.set_user_attr("measurement_invalid_count", result["measurement"]["invalidCount"])
    trial.set_user_attr("measurement_invalid_total_count", result["measurement"]["invalidCount"]
                        + result["stage1Metrics"].get("measurementInvalidCount", 0))
    trial.set_user_attr("stage2b_result", result.get("result"))
    trial.set_user_attr("result_metrics", result.get("metrics"))
    value, _details = stage2b_objective_result(trial, parameters, lambda: result)
    return value


def run(max_trials: int = 34, dry_run: bool = False) -> dict:
    if not 1 <= max_trials <= 34:
        raise ValueError("--max-new-trials must be between 1 and 34")
    search, subset = json.loads(SPACE_PATH.read_text()), json.loads(SUBSET_PATH.read_text())
    identity_now = identity(search, subset)
    name = study_name(search)
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    storage = f"sqlite:///{DATABASE.resolve()}"
    study = optuna.create_study(study_name=name, storage=storage, direction="minimize", load_if_exists=True,
        sampler=optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=10))
    old_identity = study.user_attrs.get("sourceIdentity")
    if old_identity is not None and old_identity != identity_now and study.trials:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED: Stage-2B study identity differs from current source")
    old_schema = study.user_attrs.get("constraintSchema")
    if old_schema is not None and old_schema != list(STAGE2B_CONSTRAINT_KEYS):
        raise RuntimeError("Stage-2B fixed constraint schema changed; use a new versioned study")
    study.set_user_attr("sourceIdentity", identity_now)
    study.set_user_attr("constraintSchema", list(STAGE2B_CONSTRAINT_KEYS))
    study.set_user_attr("workflowState", "ACTIVE_STAGE2B_V2_RECOVERY")
    study.set_user_attr("recoveryParentStudy", study_name(search, version=1))
    prior = existing_stage2_candidates(storage, search)
    oat = make_oat_probes(prior, search["dimensions"])
    parent_study = optuna.load_study(study_name=study_name(search, version=1), storage=storage)
    parent_identity = parent_study.user_attrs.get("sourceIdentity")
    if not isinstance(parent_identity, dict):
        raise RuntimeError("v1 study has no persisted source identity")
    for key in ("sourceRevision", "searchSpaceSha256", "subsetSha256", "presetSha256"):
        if parent_identity.get(key) != identity_now.get(key):
            raise RuntimeError(f"BLOCKED_SOURCE_CHANGED: v1 and v2 disagree on {key}")
    historical = historical_stage2b_seeds(parent_study, parent_identity, prior, oat)
    manifest_path = RUN_ROOT / "run-manifest.json"
    manifest = {"schemaVersion": 1, "studyName": name, "storagePath": str(DATABASE.relative_to(ROOT)),
        "searchSpaceSha256": search["searchSpaceHash"], "subsetSha256": subset["subsetSha256"],
        "subsetCellCount": subset["cellCount"], "sourceIdentity": identity_now,
        "recoveryParentStudy": parent_study.study_name, "recoveryParentSourceIdentity": parent_identity,
        "historicalUniqueObservations": len(historical),
        "historicalStage2Vectors": sum(seed["seedKind"] == "stage2-prior-candidate" for seed in historical),
        "historicalOatProbes": sum(seed["seedKind"] == "one-at-a-time-authority-probe" for seed in historical),
        "orchestrationOnlyIdentityChange": True,
        "pythonVersion": __import__("sys").version, "optunaVersion": optuna.__version__, "seed": 7,
        "stage2BaselineCount": len(prior), "oatProbeCount": len(oat), "constraintSchema": list(STAGE2B_CONSTRAINT_KEYS),
        "maxUniqueCompleteCandidates": max_trials, "startTimeUtc": utc_now(), "stopReason": "DRY_RUN" if dry_run else None}
    if dry_run:
        # Verify the exact intended import plan without enqueueing trials or building candidates.
        completed = complete_unique_trials(study.trials)
        completed_keys = {canonical(trial.params) for trial in completed}
        waiting_keys = {canonical(trial.system_attrs.get("fixed_params", {})) for trial in study.trials
                        if trial.state == TrialState.WAITING and trial.system_attrs.get("fixed_params")}
        already_planned = completed_keys | waiting_keys
        historical_missing = [seed for seed in historical
                              if canonical(seed["parameters"]) not in already_planned]
        already_planned |= {canonical(seed["parameters"]) for seed in historical_missing}
        manifest["v2ExistingUniqueComplete"] = len(completed)
        manifest["v2ExistingWaiting"] = len(waiting_keys)
        manifest["historicalToEnqueue"] = len(historical_missing)
        manifest["oatToEnqueue"] = sum(canonical(seed["parameters"]) not in already_planned for seed in oat)
        manifest["endTimeUtc"] = utc_now()
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        return {**manifest, "dryRun": True}
    started = time.monotonic()

    # Replays and OAT probes are each enqueued at most once, including WAITING rows
    # whose parameters live in Optuna's fixed_params system attribute.
    enqueue_missing(study, historical, "historical-replay")
    enqueue_missing(study, oat, "one-at-a-time-authority-probe")

    def one_trial() -> None:
        if identity(search, subset) != identity_now:
            raise RuntimeError("BLOCKED_SOURCE_CHANGED: source/config/evaluator identity changed during Stage-2B")
        study.optimize(objective, n_trials=1, n_jobs=1, catch=())

    def objective(trial):
        parameters = suggest(trial, search["dimensions"])
        candidate_id = f"stage2b-v2-{trial.number + 1:04d}"
        replay_relative = trial.user_attrs.get("historical_result_path")
        if replay_relative:
            result_path = ROOT / replay_relative
            result = json.loads(result_path.read_text())
            trial.set_user_attr("recovery_candidate_id", candidate_id)
            return replay_stage2b_result(trial, parameters, result, result_path, parent_identity,
                                         parent_study.study_name)

        duplicate = next((prior_trial for prior_trial in study.trials
                          if prior_trial.state == TrialState.COMPLETE and canonical(prior_trial.params) == canonical(parameters)), None)
        if duplicate is not None:
            constraints = duplicate.user_attrs["constraints"]
            for key in STAGE2B_CONSTRAINT_KEYS:
                trial.set_constraint(key, float(constraints[key]))
            trial.set_user_attr("constraints", constraints)
            for key in ("stage_reached", "stage1_pass", "stage2_pass", "stage2b_pass", "stage1_metrics",
                        "stage2_metrics", "stage2b_metrics", "measurement_invalid_count", "stage2b_result",
                        "result_path", "config_sha256", "wasm_sha256", "result_metrics"):
                if key in duplicate.user_attrs:
                    trial.set_user_attr(key, duplicate.user_attrs[key])
            trial.set_user_attr("candidate_id", duplicate.user_attrs.get("candidate_id"))
            trial.set_user_attr("historical_replay", False)
            trial.set_user_attr("duplicate_reused", True)
            trial.set_user_attr("elapsed_seconds", 0.0)
            return float(duplicate.value)
        candidate = {"candidateId": candidate_id, "parameters": parameters}
        candidate_path = RUN_ROOT / "candidates" / f"{candidate_id}.json"
        result_path = RUN_ROOT / "results" / f"{candidate_id}.json"
        candidate_path.parent.mkdir(parents=True, exist_ok=True)
        candidate_path.write_text(json.dumps(candidate, indent=2) + "\n")
        build_root = ROOT / "build/wasm/calibration/gpsampler/stage2b" / candidate_id
        trial.set_user_attr("candidate_id", candidate_id)
        trial.set_user_attr("stage_study", "stage2b")
        trial.set_user_attr("source_revision", identity_now["sourceRevision"])
        trial.set_user_attr("source_tree_sha256", identity_now["sourceTreeSha256"])
        trial.set_user_attr("evaluator_identity_sha256", identity_now["evaluatorSha256"])
        trial.set_user_attr("result_evaluator_sha256", result.get("evaluatorSha256"))
        trial.set_user_attr("search_space_sha256", identity_now["searchSpaceSha256"])
        trial.set_user_attr("subset_sha256", identity_now["subsetSha256"])
        trial.set_user_attr("source_dirty", identity_now["sourceDirty"])
        result = run_evaluator(candidate_path, build_root, result_path)
        trial.set_user_attr("config_sha256", result["configSha256"])
        trial.set_user_attr("wasm_sha256", result["wasmSha256"])
        trial.set_user_attr("result_path", str(result_path.relative_to(ROOT)))
        trial.set_user_attr("elapsed_seconds", result["elapsedSeconds"])
        trial.set_user_attr("measurement_invalid_count", result["measurement"]["invalidCount"])
        trial.set_user_attr("measurement_invalid_total_count", result["measurement"]["invalidCount"]
                            + result["stage1Metrics"].get("measurementInvalidCount", 0))
        trial.set_user_attr("stage2b_result", result["result"])
        trial.set_user_attr("source_stage2_candidate_id", trial.user_attrs.get("source_candidate_id"))
        trial.set_user_attr("oat_parameter", trial.user_attrs.get("oat_parameter"))
        trial.set_user_attr("result_metrics", result["metrics"])
        trial.set_user_attr("stage2b_trial_result_path", str(result_path))
        value, _details = stage2b_objective_result(trial, parameters, lambda: result)
        return value

    def unique_stage2b_feasible() -> list:
        return [trial for trial in complete_unique_trials(study.trials)
                if trial.user_attrs.get("constraints", {}).get("stage2b_violation", 1.0) <= 0]

    def run_waiting() -> None:
        while len(complete_unique_trials(study.trials)) < max_trials:
            if not any(trial.state == TrialState.WAITING for trial in study.trials):
                break
            one_trial()

    run_waiting()
    complete_now = len(complete_unique_trials(study.trials))
    feasible_now = len(unique_stage2b_feasible())
    authority = None
    measured_oat = sum(trial.user_attrs.get("seed_kind") == "one-at-a-time-authority-probe"
                       for trial in complete_unique_trials(study.trials))
    if feasible_now < 3 and complete_now < max_trials and measured_oat == len(oat):
        authority_trials = complete_unique_trials(study.trials)
        center = min(prior, key=lambda candidate: candidate["sourceLoss"])
        center_id = next((trial.user_attrs.get("candidate_id") for trial in authority_trials
                          if trial.user_attrs.get("source_candidate_id") == center["sourceCandidateId"]), None)
        authority = analyze_authority(authority_trials, center_id or "")
        manifest["currentSpaceAuthority"] = authority
        if authority["status"] != "CURRENT_SPACE_SUFFICIENT":
            manifest["stopReason"] = authority["status"]
            manifest["endTimeUtc"] = utc_now()
            manifest["elapsedSeconds"] = time.monotonic() - started
            manifest["completeCount"] = complete_now
            manifest["trialRowCompleteCount"] = sum(trial.state == TrialState.COMPLETE for trial in study.trials)
            manifest["stage2bFeasibleCount"] = feasible_now
            manifest["oatProbesMeasured"] = measured_oat
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
            return {**manifest, "dryRun": False}

    while complete_now < max_trials and feasible_now < 3:
        if any(trial.state == TrialState.WAITING for trial in study.trials):
            run_waiting()
            complete_now = len(complete_unique_trials(study.trials))
            feasible_now = len(unique_stage2b_feasible())
            if complete_now >= max_trials or feasible_now >= 3:
                break
        one_trial()
        complete_now = len(complete_unique_trials(study.trials))
        feasible_now = len(unique_stage2b_feasible())
        recent = complete_unique_trials(study.trials)[-20:]
        invalid = sum((trial.user_attrs.get("measurement_invalid_total_count", trial.user_attrs.get("measurement_invalid_count")) or 0) > 0 for trial in recent)
        if len(recent) == 20 and invalid / 20 > .20:
            manifest["stopReason"] = "BLOCKED_BY_MEASUREMENT_VALIDITY"
            break
    else:
        manifest["stopReason"] = "THREE_STAGE2B_FEASIBLE_CANDIDATES" if feasible_now >= 3 else "STAGE2B_BUDGET_REACHED"

    manifest.update({"endTimeUtc": utc_now(), "elapsedSeconds": time.monotonic() - started,
        "completeCount": complete_now,
        "trialRowCompleteCount": sum(trial.state == TrialState.COMPLETE for trial in study.trials),
        "failCount": sum(trial.state == TrialState.FAIL for trial in study.trials),
        "stage2bFeasibleCount": feasible_now,
        "historicalReplaysComplete": sum(trial.user_attrs.get("historical_replay") is True
                                          for trial in complete_unique_trials(study.trials)),
        "historicalStage2VectorsMeasured": sum(trial.user_attrs.get("seed_kind") == "stage2-prior-candidate"
                                                for trial in complete_unique_trials(study.trials)),
        "oatProbesMeasured": sum(trial.user_attrs.get("seed_kind") == "one-at-a-time-authority-probe"
                                 for trial in complete_unique_trials(study.trials)),
        "physicalRenders": sum(not trial.user_attrs.get("historical_replay")
                               and not trial.user_attrs.get("duplicate_reused")
                               for trial in complete_unique_trials(study.trials)),
        "trialNumbers": [trial.number for trial in study.trials if trial.state == TrialState.COMPLETE]})
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-new-trials", type=int, default=34)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.max_new_trials, args.dry_run), sort_keys=True))


if __name__ == "__main__":
    main()
