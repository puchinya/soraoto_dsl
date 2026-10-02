#!/usr/bin/env python3
"""Bounded Stage2L revision-2 model evaluation using the existing Stage2E evaluator."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import optuna

ROOT = Path(__file__).resolve().parents[6]
HERE = Path(__file__).resolve().parent
SEARCH_PATH = HERE / "stage2l-model-revision-search-space.json"
STATE_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2l-model-revision-2"
MANIFESTS = STATE_ROOT / "runs"
RESULTS = STATE_ROOT / "results"
SCRATCH = ROOT / "build/wasm/calibration/stage2l-model-revision-2"
SUBSET_PATH = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
MAX_CANDIDATES = 12
SEED = 7

sys.path.insert(0, str(HERE))
import run_stage2e_termination_joint as stage2e  # noqa: E402
from stage2l_policy import direction_result  # noqa: E402


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def source_identity(search: dict) -> dict:
    source_paths = (
        "wasm/plugins/dsp/super-synth/src/plugin.c",
        "wasm/plugins/dsp/super-synth/src/grand_loss_math.h",
        "wasm/plugins/dsp/super-synth/presets.json",
        "wasm/cmake/super_synth_metadata.py",
    )
    evaluator_paths = (
        *source_paths,
        "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
        "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
        "wasm/plugins/dsp/super-synth/test/tuning/stage2l_policy.py",
        "wasm/plugins/dsp/super-synth/test/tuning/stage2l-model-revision-search-space.json",
        "wasm/plugins/dsp/super-synth/test/tuning/run_stage2e_termination_joint.py",
        "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
        "wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js",
        "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
    )
    qmc_evaluator_paths = (
        "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/verify-qmc-scratch-equivalence.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
        "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
        "wasm/plugins/dsp/super-synth/test/tuning/run_level1_qmc.py",
        "wasm/plugins/dsp/super-synth/test/tuning/README.md",
        "wasm/plugins/dsp/super-synth/test/tuning/requirements.txt",
        "wasm/plugins/dsp/super-synth/test/tuning/active-search-space.json",
        "wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.json",
        "web-player/src/js/plugin-cbor.js",
        "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json",
        "wasm/plugins/dsp/super-synth/src/plugin.c",
        "wasm/cmake/super_synth_metadata.py",
        "wasm/cmake/generate_plugin_metadata.py",
        "wasm/CMakeLists.txt",
        "wasm/cmake/wasm_plugin.cmake",
    )

    def hash_paths(paths: tuple[str, ...]) -> str:
        hasher = hashlib.sha256()
        for relative in paths:
            hasher.update(relative.encode())
            hasher.update(b"\0")
            hasher.update((ROOT / relative).read_bytes())
            hasher.update(b"\0")
        return hasher.hexdigest()

    revision = subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    tree_hash = stage2e.hash_tree(ROOT / "wasm")
    search_hash = digest(SEARCH_PATH.read_bytes())
    evaluator_hash = hash_paths(tuple(sorted(evaluator_paths)))
    subset_document = read_json(SUBSET_PATH)
    subset_hash = subset_document.get("subsetSha256")
    if not isinstance(subset_hash, str) or len(subset_hash) != 64:
        raise ValueError("Stage2B subset manifest has no valid semantic subsetSha256")
    return {
        "sourceRevision": revision,
        "sourceDirty": bool(subprocess.check_output(["rtk", "git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
        "sourceTreeSha256": tree_hash,
        "sourceConfigSha256": hash_paths(source_paths),
        "evaluatorSha256": evaluator_hash,
        "candidateEvaluatorSha256": hash_paths(tuple(sorted(qmc_evaluator_paths))),
        "searchSpaceSha256": search_hash,
        "subsetSha256": subset_hash,
        "subsetManifestFileSha256": digest(SUBSET_PATH.read_bytes()),
        "studyName": f"{search['studyNamePrefix']}-{search_hash}-{evaluator_hash[:12]}-{subset_hash[:8]}",
    }


def validate_search(search: dict) -> None:
    if search.get("modelRevision") != 2 or search.get("maximumCandidateIdentities") != MAX_CANDIDATES:
        raise ValueError("Stage2L revision or candidate-budget declaration changed")
    if len(search.get("dimensions", [])) != 7:
        raise ValueError("Stage2L must contain exactly the seven approved semantic dimensions")
    names = [item.get("name") for item in search["dimensions"]]
    if len(set(names)) != 7 or "termination_loss_floor_scale" in names:
        raise ValueError("Stage2L search space contains duplicates or a forbidden dimension")
    candidate = search.get("candidate1", {})
    if set(candidate) != set(names):
        raise ValueError("candidate 1 must define exactly the approved search dimensions")
    for dimension in search["dimensions"]:
        value = candidate[dimension["name"]]
        if not isinstance(value, (int, float)) or not dimension["min"] <= value <= dimension["max"]:
            raise ValueError(f"candidate 1 value outside approved domain: {dimension['name']}")
    if search.get("candidateBudget", {}).get("remainingGPSamplerCandidates") != MAX_CANDIDATES - 1:
        raise ValueError("Stage2L must reserve exactly eleven GPSampler candidates after candidate 1")


def bind_stage2e_scratch() -> None:
    stage2e.SEARCH_PATH = SEARCH_PATH
    stage2e.STATE_ROOT = STATE_ROOT
    stage2e.RESULTS = RESULTS
    stage2e.SCRATCH = SCRATCH


def evaluated_constraints(result: dict) -> dict[str, float]:
    direct = result["metrics"]["directProxy"]
    constraints = stage2e.stage2e_constraints(
        result["stage1Metrics"], result["stage2Metrics"], direct,
        result["heldRelease"], result["localTopology"],
    )
    if tuple(constraints) != stage2e.STAGE2E_CONSTRAINT_KEYS:
        raise ValueError("Stage2E constraint schema/order mismatch")
    return {key: float(constraints[key]) for key in stage2e.STAGE2E_CONSTRAINT_KEYS}


def recover_candidate1_measurements(candidate_id: str, parameters: dict, identity: dict) -> dict | None:
    """Complete a prior render from its Stage2B result and held/release metrics log."""
    result_path = RESULTS / f"{candidate_id}.json"
    build_root = SCRATCH / candidate_id
    if not result_path.is_file():
        return None
    result = read_json(result_path)
    expected_params = {key: float(value) for key, value in parameters.items()}
    actual_params = {key: float(value) for key, value in result.get("parameters", {}).items()}
    if actual_params != expected_params:
        raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE1_PROVENANCE: stored candidate vector differs")
    if (result.get("sourceRevision") != identity["sourceRevision"]
            or result.get("subsetSha256") != identity["subsetSha256"]
            or result.get("evaluatorSha256") != identity["candidateEvaluatorSha256"]
            or result.get("productionSimd") is not True
            or result.get("stage2bReached") is not True
            or result.get("result") != "COMPLETE"):
        raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE1_PROVENANCE: Stage2B source/SIMD/subset evidence mismatch")
    config_path = build_root / "source/wasm/plugins/dsp/super-synth/presets.json"
    wasm_path = build_root / "build/plugins/dsp/super-synth/plugin.wasm"
    held_stdout = build_root / "held-release.stdout.log"
    if not config_path.is_file() or not wasm_path.is_file() or not held_stdout.is_file():
        raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE1_PROVENANCE: incomplete candidate build or held/release artifacts")
    if digest(config_path.read_bytes()) != result.get("configSha256"):
        raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE1_PROVENANCE: scratch config hash mismatch")
    if digest(wasm_path.read_bytes()) != result.get("wasmSha256"):
        raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE1_PROVENANCE: production-SIMD WASM hash mismatch")
    held_line = next((line[len("HELD_RELEASE_METRICS "):] for line in held_stdout.read_text(encoding="utf-8").splitlines()
                      if line.startswith("HELD_RELEASE_METRICS ")), None)
    if held_line is None:
        raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE1_PROVENANCE: held/release metrics missing")
    held_raw = json.loads(held_line)
    result["heldRelease"] = {key: held_raw[key] for key in (
        "heldDecayRatio", "releaseTail1", "releaseTail2", "releaseTail3",
        "releaseTail3To2Ratio", "finiteRelease", "stuckVoiceCount",
    )}
    result["heldReleaseDiagnostics"] = held_raw
    preset = read_json(config_path)["concert_grand"]
    result["localTopology"] = {
        "pianoStringUnison": float(preset["piano_string_unison"]),
        "pianoSoundboardMix": float(preset["piano_soundboard_mix"]),
    }
    result["stage2lProvenance"] = {**identity, "historicalReplay": True,
                                   "replayReason": "Stage2B and held/release renders completed before Stage2E-only metadata aggregation failed"}
    write_json(result_path, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="validate provenance and budget without building or rendering")
    parser.add_argument("--execute", action="store_true", help="authorize candidate-1 evaluation and gated continuation")
    args = parser.parse_args()
    if args.dry_run == args.execute:
        parser.error("specify exactly one of --dry-run or --execute")
    if optuna.__version__ != "5.0.0":
        raise RuntimeError(f"Stage2L requires Optuna 5.0.0, found {optuna.__version__}")
    search = read_json(SEARCH_PATH)
    validate_search(search)
    if not SUBSET_PATH.is_file():
        raise FileNotFoundError(f"Stage2B diagnostic subset missing: {SUBSET_PATH}")
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    MANIFESTS.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    bind_stage2e_scratch()
    identity = source_identity(search)
    DATABASE = STATE_ROOT / "study.db"
    study = optuna.create_study(
        study_name=identity["studyName"], storage=f"sqlite:///{DATABASE}", load_if_exists=True,
        direction="minimize", sampler=optuna.samplers.GPSampler(seed=SEED, deterministic_objective=True, n_startup_trials=10),
    )
    frozen = study.user_attrs.get("stage2l_identity")
    if frozen is not None and frozen != identity:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED: Stage2L study identity differs from current source/search")
    study.set_user_attr("stage2l_identity", identity)
    study.set_user_attr("constraint_schema", list(stage2e.STAGE2E_CONSTRAINT_KEYS))
    stamp = datetime.now(timezone.utc)
    manifest_path = MANIFESTS / f"{stamp.strftime('%Y%m%dT%H%M%S%fZ')}.json"
    complete = [trial for trial in study.trials if trial.state == optuna.trial.TrialState.COMPLETE]
    rendered = {trial.user_attrs.get("candidate_id") for trial in study.trials
                if trial.user_attrs.get("physical_evaluation_started") and trial.user_attrs.get("candidate_id")}
    rendered.update(path.stem for path in RESULTS.glob("stage2l-r2-candidate-*.json")
                    if path.is_file() and json.loads(path.read_text(encoding="utf-8")).get("stage2bReached") is True)
    manifest = {
        **identity, "modelRevision": 2, "seed": SEED, "optunaVersion": optuna.__version__,
        "candidateBudgetMaximum": MAX_CANDIDATES, "physicalCandidatesBefore": len(rendered),
        "completedTrialsBefore": len(complete), "startTimestamp": stamp.isoformat(),
        "stopReason": "DRY_RUN_NO_RENDER" if args.dry_run else None,
    }
    write_json(manifest_path, manifest)
    if args.dry_run:
        print(json.dumps({"dryRun": True, "builds": 0, "physicalRenders": 0,
                          "studyName": identity["studyName"], "candidateBudgetUsed": len(rendered),
                          "candidateBudgetMaximum": MAX_CANDIDATES, "candidate1": search["candidate1"],
                          "manifest": str(manifest_path)}, sort_keys=True))
        return 0

    existing_first = next((trial for trial in complete if trial.user_attrs.get("candidate_index") == 1), None)
    if existing_first:
        direction = existing_first.user_attrs.get("directional_gate")
        if not direction or not direction.get("pass"):
            manifest.update({"stopReason": "BLOCKED_STAGE2L_MODEL_DIRECTION", "candidate1Direction": direction,
                             "endTimestamp": datetime.now(timezone.utc).isoformat()})
            write_json(manifest_path, manifest)
            print(json.dumps({"stopReason": "BLOCKED_STAGE2L_MODEL_DIRECTION", "candidate1Direction": direction,
                              "manifest": str(manifest_path)}, sort_keys=True))
            return 0

    dimensions = search["dimensions"]
    candidate1 = search["candidate1"]
    used_ids = {trial.user_attrs.get("candidate_id") for trial in study.trials if trial.user_attrs.get("candidate_id")}
    used_ids.update(path.stem for path in RESULTS.glob("stage2l-r2-candidate-*.json")
                    if path.is_file() and json.loads(path.read_text(encoding="utf-8")).get("stage2bReached") is True)
    started_now = 0
    stop_reason = "CANDIDATE_BUDGET_EXHAUSTED"

    def objective(trial):
        nonlocal started_now
        index = 1 + sum(1 for row in study.trials if row.user_attrs.get("physical_evaluation_started"))
        # Optuna includes the current RUNNING trial in study.trials, so the sum above counts it.
        if index > MAX_CANDIDATES:
            raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE_BUDGET_EXHAUSTED")
        if index == 1:
            parameters = candidate1
        else:
            parameters = {d["name"]: trial.suggest_float(d["name"], float(d["min"]), float(d["max"])) for d in dimensions}
        trial.set_user_attr("candidate_index", index)
        trial.set_user_attr("parameters", parameters)
        trial.set_user_attr("source_revision", identity["sourceRevision"])
        trial.set_user_attr("source_tree_sha256", identity["sourceTreeSha256"])
        trial.set_user_attr("source_config_sha256", identity["sourceConfigSha256"])
        trial.set_user_attr("evaluator_sha256", identity["evaluatorSha256"])
        trial.set_user_attr("search_space_sha256", identity["searchSpaceSha256"])
        candidate_id = f"stage2l-r2-candidate-{index:02d}"
        existing_artifact = (RESULTS / f"{candidate_id}.json").is_file()
        if candidate_id in used_ids and not (index == 1 and existing_artifact):
            raise RuntimeError(f"duplicate Stage2L candidate identity: {candidate_id}")
        trial.set_user_attr("candidate_id", candidate_id)
        trial.set_user_attr("physical_evaluation_started", True)
        result = recover_candidate1_measurements(candidate_id, parameters, identity) if index == 1 else None
        if result is not None:
            trial.set_user_attr("historical_replay", True)
        else:
            if index == 1 and existing_artifact:
                raise RuntimeError("BLOCKED_STAGE2L_CANDIDATE1_PROVENANCE: refusing to rerender existing evidence")
            started_now += 1
            result = stage2e.run_candidate(candidate_id, parameters, {**identity, "oatResultSha256": None})
            result.pop("stage2eProvenance", None)
            result["stage2lProvenance"] = {**identity, "historicalReplay": False}
            write_json(RESULTS / f"{candidate_id}.json", result)
            trial.set_user_attr("historical_replay", False)
        constraints = evaluated_constraints(result)
        for name in stage2e.STAGE2E_CONSTRAINT_KEYS:
            trial.set_constraint(name, constraints[name])
        loss = float(result["metrics"]["directProxyReferenceFitLoss"])
        if not (loss == loss and abs(loss) != float("inf")):
            raise ValueError("Stage2L reference-fit objective must be finite")
        feasible = all(value <= 0.0 for value in constraints.values())
        direction = direction_result(constraints) if index == 1 else None
        trial.set_user_attr("constraints", constraints)
        trial.set_user_attr("reference_fit_loss", loss)
        trial.set_user_attr("result_path", str(RESULTS / f"{candidate_id}.json"))
        trial.set_user_attr("stage_reached", 2)
        trial.set_user_attr("measurement_invalid_count", result.get("measurement", {}).get("invalidCount"))
        trial.set_user_attr("feasible", feasible)
        trial.set_user_attr("directional_gate", direction)
        trial.set_user_attr("elapsed_seconds", result.get("elapsedSeconds"))
        return loss

    if not any(trial.user_attrs.get("candidate_index") == 1 for trial in study.trials):
        study.enqueue_trial(candidate1)
    remaining = max(0, MAX_CANDIDATES - len(rendered))
    try:
        for _ in range(remaining):
            if source_identity(search) != identity:
                stop_reason = "BLOCKED_SOURCE_CHANGED"
                break
            study.optimize(objective, n_trials=1, n_jobs=1, catch=())
            latest = max((t for t in study.trials if t.user_attrs.get("physical_evaluation_started")), key=lambda t: t.number)
            if latest.user_attrs.get("candidate_index") == 1:
                direction = latest.user_attrs.get("directional_gate")
                if not direction or not direction.get("pass"):
                    stop_reason = "BLOCKED_STAGE2L_MODEL_DIRECTION"
                    break
            if latest.user_attrs.get("feasible"):
                stop_reason = "STAGE2E_FULLY_FEASIBLE"
                break
        else:
            stop_reason = "STAGE2L_CANDIDATE_BUDGET_EXHAUSTED"
    except Exception as error:
        stop_reason = "INFRASTRUCTURE_FAILURE"
        manifest["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        all_trials = study.trials
        rendered_after = {t.user_attrs.get("candidate_id") for t in all_trials
                          if t.user_attrs.get("physical_evaluation_started") and t.user_attrs.get("candidate_id")}
        rendered_after.update(path.stem for path in RESULTS.glob("stage2l-r2-candidate-*.json")
                              if path.is_file() and json.loads(path.read_text(encoding="utf-8")).get("stage2bReached") is True)
        manifest.update({"endTimestamp": datetime.now(timezone.utc).isoformat(), "stopReason": stop_reason,
                         "physicalCandidatesAfter": len(rendered_after), "candidatesRenderedThisRun": started_now,
                         "completedTrials": sum(t.state == optuna.trial.TrialState.COMPLETE for t in all_trials),
                         "feasibleTrials": sum(bool(t.user_attrs.get("feasible")) for t in all_trials),
                         "stage2lResults": str(RESULTS)})
        write_json(manifest_path, manifest)
    print(json.dumps({"studyName": identity["studyName"], "stopReason": stop_reason,
                      "physicalCandidates": len(rendered_after), "candidateBudgetMaximum": MAX_CANDIDATES,
                      "manifest": str(manifest_path)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
