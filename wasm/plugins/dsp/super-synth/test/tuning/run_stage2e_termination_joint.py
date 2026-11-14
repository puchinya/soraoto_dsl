"""Run the bounded termination-loss-floor Stage-2E GPSampler campaign."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import optuna

from constraints import STAGE2E_CONSTRAINT_KEYS, stage2e_constraints

ROOT = Path(__file__).resolve().parents[6]
HERE = Path(__file__).resolve().parent
SEARCH_PATH = HERE / "stage2e-termination-joint-search-space.json"
SUBSET_PATH = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
OAT_PATH = ROOT / ".agent-state/issues/7/termination-loss-floor/oat-results.json"
EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs"
STATE_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2e-termination-joint"
DATABASE = STATE_ROOT / "study.db"
RUNS = STATE_ROOT / "runs"
RESULTS = STATE_ROOT / "results"
SCRATCH = ROOT / "build/wasm/calibration/stage2e-termination-joint"
REGRESSION = ROOT / "wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js"
VENUE = ROOT / ".agent-state/issues/7/calibration-optuna/venv"

IDENTITY_PATHS = (
    "wasm/plugins/dsp/super-synth/src/plugin.c",
    "wasm/plugins/dsp/super-synth/presets.json",
    "wasm/cmake/super_synth_metadata.py",
    "wasm/cmake/generate_plugin_metadata.py",
    "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
    "wasm/plugins/dsp/super-synth/test/tuning/stage2e-termination-joint-search-space.json",
    "wasm/plugins/dsp/super-synth/test/tuning/run_stage2e_termination_joint.py",
    "wasm/plugins/dsp/super-synth/test/tools/termination-loss-floor-overlay.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
    "wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js",
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".tmp-{os.getpid()}")
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


def read_search() -> dict:
    search = read_json(SEARCH_PATH)
    dimensions = search.get("dimensions", [])
    names = [item.get("name") for item in dimensions]
    expected = [
        "effective_strike_position_c4",
        "hammer.compression_scale",
        "piano_hammer_hardness",
        "piano_inharmonicity",
        "piano_string_damping",
        "piano_string_unison",
        "hammer.velocity_hardness_amount",
        "termination_loss_floor_scale",
    ]
    if names != expected:
        raise ValueError(f"Stage-2E requires exactly the eight approved axes, got {names}")
    if search.get("physicalCandidateBudget") != {
        "maximumTotal": 25,
        "completedOatCandidates": 5,
        "maximumNewJointCandidates": 20,
        "stopAfterFeasible": 3,
    }:
        raise ValueError("Stage-2E physical candidate budget differs from the contract")
    for dimension in dimensions:
        if dimension.get("type") != "float" or dimension.get("scale") != "linear":
            raise ValueError(f"unsupported search dimension: {dimension.get('name')}")
        low, high, baseline = (float(dimension[key]) for key in ("min", "max", "baseline"))
        if not all(math.isfinite(value) for value in (low, high, baseline)) or not low <= baseline <= high:
            raise ValueError(f"invalid range/baseline for {dimension.get('name')}")
    floor = dimensions[-1]
    if (float(floor["min"]), float(floor["max"]), float(floor["baseline"])) != (0.0, 1.0, 1.0):
        raise ValueError("termination_loss_floor_scale must be scratch-only [0,1] with baseline 1")
    return search


def verify_oat_authority() -> dict:
    oat = read_json(OAT_PATH)
    if oat.get("decision") != "TERMINATION_FLOOR_AUTHORIZED":
        raise RuntimeError(f"BLOCKED_OAT_AUTHORITY: {oat.get('decision')}")
    scales = sorted(float(row["scale"]) for row in oat.get("scales", []))
    if scales != [0.0, 0.25, 0.5, 0.75, 1.0] or sorted(oat.get("authorizedScales", [])) != [0.0, 0.25, 0.5]:
        raise RuntimeError("BLOCKED_OAT_AUTHORITY: the five required scales or authorized scale set changed")
    if oat.get("selectedScale") is not None:
        raise RuntimeError("OAT report must not claim a final scale without a zero-shape-failure condition")
    for row in oat["scales"]:
        if row["coverage"].get("cells") != 90 or row["heldRelease"].get("testStatus") not in ("PASS", "FAIL"):
            raise RuntimeError("OAT report is incomplete for coverage or held/release evidence")
        held = row["heldRelease"]
        if not all(key in held for key in ("heldDecayRatio", "releaseTail1", "releaseTail2", "releaseTail3", "finiteRelease", "stuckVoiceCount")):
            raise RuntimeError("OAT report lacks required held/release observations")
        if row["authorization"].get("authorized") and not (
            held["heldDecayPass"] and held["releaseTailPass"] and held["finiteRelease"]
            and held["noStuckVoice"] and held["guardHits"] == 0
        ):
            raise RuntimeError("OAT authorized a scale without passing every held/release safety predicate")
    return oat


def file_identity(search: dict) -> dict:
    source = hashlib.sha256()
    for relative in IDENTITY_PATHS[:4]:
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
    search_bytes = SEARCH_PATH.read_bytes()
    oat_bytes = OAT_PATH.read_bytes()
    subset_bytes = SUBSET_PATH.read_bytes()
    return {
        "sourceRevision": subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sourceDirty": bool(subprocess.check_output(["rtk", "git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
        "sourceTreeSha256": hash_tree(ROOT / "wasm"),
        "sourceConfigSha256": source.hexdigest(),
        "evaluatorSha256": evaluator.hexdigest(),
        "searchSpaceSha256": sha256(search_bytes),
        "oatResultSha256": sha256(oat_bytes),
        "subsetSha256": sha256(subset_bytes),
        "studyName": f"{search['studyNamePrefix']}-{sha256(search_bytes)}",
    }


def completed_trials(study) -> list:
    return [trial for trial in study.trials if trial.state == optuna.trial.TrialState.COMPLETE]


def feasible_trials(study) -> list:
    return [trial for trial in completed_trials(study)
            if trial.user_attrs.get("feasible") is True
            and len(trial.user_attrs.get("constraints", {})) == len(STAGE2E_CONSTRAINT_KEYS)]


def prior_stage2e_physical_attempts(storage_url: str, current_name: str) -> int:
    """Preserve the 20-candidate ceiling across evaluator-version study changes."""
    attempts = 0
    for summary in optuna.study.get_all_study_summaries(storage=storage_url):
        if not summary.study_name.startswith("issue-7-grand-v9-stage2e-termination-joint-"):
            continue
        if summary.study_name == current_name:
            continue
        prior_study = optuna.load_study(study_name=summary.study_name, storage=storage_url)
        for trial in prior_study.trials:
            if trial.state == optuna.trial.TrialState.WAITING or trial.user_attrs.get("deduplicated") is True:
                continue
            params = trial.user_attrs.get("parameters") or trial.params
            if params:
                attempts += 1
    return attempts


def identical_completed_trial(study, parameters: dict):
    canonical = json.dumps(parameters, sort_keys=True, separators=(",", ":"))
    for trial in reversed(study.trials):
        if trial.state != optuna.trial.TrialState.COMPLETE:
            continue
        prior = trial.user_attrs.get("parameters")
        if prior and json.dumps(prior, sort_keys=True, separators=(",", ":")) == canonical:
            return trial
    return None


def held_release_metrics(candidate_id: str, build_root: Path) -> tuple[dict, dict]:
    env = os.environ.copy()
    env["SORAOTO_WASM_BUILD_DIR"] = str(build_root / "build")
    env["SUPERSYNTH_HELD_RELEASE_ONLY"] = "1"
    env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(SEARCH_PATH)
    run = subprocess.run(["rtk", "node", str(REGRESSION)], cwd=ROOT, env=env, text=True, capture_output=True)
    build_root.mkdir(parents=True, exist_ok=True)
    stdout_path = build_root / "held-release.stdout.log"
    stderr_path = build_root / "held-release.stderr.log"
    stdout_path.write_text(run.stdout or "", encoding="utf-8")
    stderr_path.write_text(run.stderr or "", encoding="utf-8")
    marker = next((line[len("HELD_RELEASE_METRICS "):] for line in (run.stdout or "").splitlines()
                   if line.startswith("HELD_RELEASE_METRICS ")), None)
    if marker is None:
        raise RuntimeError(f"{candidate_id}: regression emitted no held/release metrics; see {stderr_path}")
    measured = json.loads(marker)
    if run.returncode not in (0, 1):
        raise RuntimeError(f"{candidate_id}: held/release evaluator crashed with {run.returncode}; see {stderr_path}")
    stage = {
        "heldDecayRatio": measured["heldDecayRatio"],
        "releaseTail1": measured["releaseTail1"],
        "releaseTail2": measured["releaseTail2"],
        "releaseTail3": measured["releaseTail3"],
        "releaseTail3To2Ratio": measured["releaseTail3To2Ratio"],
        "finiteRelease": measured["finiteRelease"],
        "stuckVoiceCount": measured["stuckVoiceCount"],
    }
    measured["regressionProcessStatus"] = "PASS" if run.returncode == 0 else "FAIL"
    measured["regressionExitCode"] = run.returncode
    return stage, measured


def run_candidate(candidate_id: str, parameters: dict, identity: dict) -> dict:
    candidate_path = RESULTS / "candidates" / f"{candidate_id}.json"
    result_path = RESULTS / f"{candidate_id}.json"
    candidate = {"candidateId": candidate_id, "parameters": parameters}
    write_json(candidate_path, candidate)
    build_root = SCRATCH / candidate_id
    env = os.environ.copy()
    env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(SEARCH_PATH)
    command = ["rtk", "node", str(EVALUATOR), "--candidate", str(candidate_path), "--subset", str(SUBSET_PATH),
               "--build-root", str(build_root), "--output", str(result_path)]
    started = time.monotonic()
    run = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True)
    build_root.mkdir(parents=True, exist_ok=True)
    (build_root / "stage2b.stdout.log").write_text(run.stdout or "", encoding="utf-8")
    (build_root / "stage2b.stderr.log").write_text(run.stderr or "", encoding="utf-8")
    if run.returncode != 0:
        raise RuntimeError(f"Stage-2B evaluator failed ({run.returncode}): {(run.stderr or '')[-4000:]}")
    result = read_json(result_path)
    if result.get("result") != "COMPLETE" or result.get("stage2bReached") is not True:
        raise ValueError("candidate did not complete Stage 1, Stage 2, and direct-reference proxy evaluation")
    if result.get("productionSimd") is not True or result.get("sourceRevision") != identity["sourceRevision"]:
        raise ValueError("candidate production-SIMD or source-revision identity differs from the frozen run")
    if result.get("sourceTreeSha256") != identity["sourceTreeSha256"]:
        raise ValueError("candidate source-tree identity differs from the frozen run")
    held, held_raw = held_release_metrics(candidate_id, build_root)
    scratch_presets = read_json(build_root / "source/wasm/plugins/dsp/super-synth/presets.json")
    preset = scratch_presets["concert_grand"]
    local_topology = {
        "pianoStringUnison": float(preset["piano_string_unison"]),
        "pianoSoundboardMix": float(preset["piano_soundboard_mix"]),
    }
    result["heldRelease"] = held
    result["heldReleaseDiagnostics"] = held_raw
    result["localTopology"] = local_topology
    result["stage2eProvenance"] = {
        "studyName": identity["studyName"],
        "searchSpaceSha256": identity["searchSpaceSha256"],
        "oatResultSha256": identity["oatResultSha256"],
        "stage2eEvaluatorSha256": identity["evaluatorSha256"],
        "candidateBudgetIncludesOat": 5,
    }
    result["elapsedSeconds"] = time.monotonic() - started
    write_json(result_path, result)
    return result


def make_objective(search: dict, identity: dict, study):
    def objective(trial):
        if file_identity(search) != identity:
            raise RuntimeError("BLOCKED_SOURCE_CHANGED: source/config/evaluator/OAT/search identity changed")
        parameters = {
            dimension["name"]: trial.suggest_float(dimension["name"], float(dimension["min"]), float(dimension["max"]))
            for dimension in search["dimensions"]
        }
        trial.set_user_attr("parameters", parameters)
        trial.set_user_attr("source_revision", identity["sourceRevision"])
        trial.set_user_attr("source_tree_sha256", identity["sourceTreeSha256"])
        trial.set_user_attr("source_config_sha256", identity["sourceConfigSha256"])
        trial.set_user_attr("evaluator_sha256", identity["evaluatorSha256"])
        trial.set_user_attr("search_space_sha256", identity["searchSpaceSha256"])
        trial.set_user_attr("historical_replay", False)
        prior = identical_completed_trial(study, parameters)
        if prior is not None:
            constraints = prior.user_attrs["constraints"]
            for name in STAGE2E_CONSTRAINT_KEYS:
                trial.set_constraint(name, float(constraints[name]))
            trial.set_user_attr("candidate_id", prior.user_attrs["candidate_id"])
            trial.set_user_attr("duplicate_of_trial", prior.number)
            trial.set_user_attr("constraints", constraints)
            trial.set_user_attr("reference_fit_loss", prior.user_attrs["reference_fit_loss"])
            trial.set_user_attr("result_path", prior.user_attrs["result_path"])
            trial.set_user_attr("stage_reached", prior.user_attrs["stage_reached"])
            trial.set_user_attr("measurement_invalid_count", prior.user_attrs["measurement_invalid_count"])
            trial.set_user_attr("feasible", prior.user_attrs["feasible"])
            trial.set_user_attr("elapsed_seconds", 0.0)
            trial.set_user_attr("deduplicated", True)
            return float(prior.user_attrs["reference_fit_loss"])

        candidate_id = f"stage2e-{identity['searchSpaceSha256'][:8]}-gp-{trial.number:04d}"
        trial.set_user_attr("candidate_id", candidate_id)
        result = run_candidate(candidate_id, parameters, identity)
        direct = result["metrics"]["directProxy"]
        constraints = stage2e_constraints(result["stage1Metrics"], result["stage2Metrics"], direct,
                                          result["heldRelease"], result["localTopology"])
        # Stage-3 peak acceptance is strictly below 0 dBFS; make an exact-zero reading positive.
        if float(direct["peakWorstDbfs"]) == 0.0:
            constraints["direct_peak_violation_dbfs"] = 1e-12
            constraints["stage2b_violation"] = max(
                constraints[key] for key in constraints if key.endswith("_violation") and key in (
                    "stage1_violation", "stage2_violation", "post_attack_shape_violation_db",
                    "dynamic_span_violation_db", "brightness_direction_violation", "direct_level_violation_db",
                    "direct_peak_violation_dbfs", "direct_guard_violation", "direct_finite_violation",
                )
            )
        if tuple(constraints) != STAGE2E_CONSTRAINT_KEYS:
            raise ValueError("Stage-2E fixed constraint schema/order mismatch")
        for name in STAGE2E_CONSTRAINT_KEYS:
            trial.set_constraint(name, float(constraints[name]))
        loss = float(result["metrics"]["directProxyReferenceFitLoss"])
        if not math.isfinite(loss):
            raise ValueError("Stage-2E reference-fit loss is not finite")
        feasible = all(value <= 0.0 for value in constraints.values())
        trial.set_user_attr("stage_reached", 2)
        trial.set_user_attr("stage1_result", result["stage1Result"])
        trial.set_user_attr("stage2_result", result["stage2Result"])
        trial.set_user_attr("measurement_invalid_count", result["measurement"]["invalidCount"])
        trial.set_user_attr("constraints", constraints)
        trial.set_user_attr("reference_fit_loss", loss)
        trial.set_user_attr("candidate_config_sha256", result["configSha256"])
        trial.set_user_attr("wasm_sha256", result["wasmSha256"])
        trial.set_user_attr("result_path", str(result_path_for(candidate_id)))
        trial.set_user_attr("elapsed_seconds", float(result["elapsedSeconds"]))
        trial.set_user_attr("measurement_valid", result["measurement"]["invalidCount"] == 0)
        trial.set_user_attr("feasible", feasible)
        trial.set_user_attr("deduplicated", False)
        return loss

    return objective


def result_path_for(candidate_id: str) -> Path:
    return RESULTS / f"{candidate_id}.json"


def save_promotion(study, identity: dict) -> Path:
    feasible = sorted(feasible_trials(study), key=lambda trial: (
        float(trial.user_attrs["reference_fit_loss"]),
        float(trial.user_attrs["constraints"]["post_attack_shape_violation_db"]),
        float(trial.user_attrs["constraints"]["dynamic_span_violation_db"]),
        float(trial.user_attrs["constraints"]["brightness_direction_violation"]),
        json.dumps(trial.user_attrs["parameters"], sort_keys=True),
    ))[:3]
    path = STATE_ROOT / "promotion-stage3.json"
    write_json(path, {
        "studyName": identity["studyName"],
        "stage3Candidates": [{
            "trialNumber": trial.number,
            "candidateId": trial.user_attrs["candidate_id"],
            "parameters": trial.user_attrs["parameters"],
            "referenceFitLoss": trial.user_attrs["reference_fit_loss"],
            "constraints": trial.user_attrs["constraints"],
            "resultPath": trial.user_attrs["result_path"],
        } for trial in feasible],
        "promotionCount": len(feasible),
        "fullStage3RequiredBeforeStage4": True,
    })
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-gp-candidates", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.max_gp_candidates <= 20:
        parser.error("--max-gp-candidates must be in [0,20]")
    if optuna.__version__ != "5.0.0":
        raise RuntimeError(f"Stage-2E requires Optuna 5.0.0, found {optuna.__version__}")
    search = read_search()
    oat = verify_oat_authority()
    if not SUBSET_PATH.is_file():
        raise FileNotFoundError(f"Stage-2B diagnostic subset missing: {SUBSET_PATH}")
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    RUNS.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    identity = file_identity(search)
    sampler = optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=10)
    study = optuna.create_study(study_name=identity["studyName"], storage=f"sqlite:///{DATABASE}",
                                load_if_exists=True, direction="minimize", sampler=sampler)
    frozen = study.user_attrs.get("frozen_identity")
    if frozen is not None and frozen != identity:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED: existing Stage-2E identity differs from source/config/evaluator/OAT")
    study.set_user_attr("frozen_identity", identity)
    study.set_user_attr("constraint_schema", list(STAGE2E_CONSTRAINT_KEYS))
    study.set_user_attr("search_space_sha256", identity["searchSpaceSha256"])
    study.set_user_attr("oat_decision", oat["decision"])

    started = datetime.now(timezone.utc)
    run_id = started.strftime("%Y%m%dT%H%M%SZ")
    manifest_path = RUNS / f"{run_id}.json"
    prior_gp = [trial for trial in study.trials if trial.state != optuna.trial.TrialState.WAITING]
    previous_physical_attempts = prior_stage2e_physical_attempts(f"sqlite:///{DATABASE}", identity["studyName"])
    manifest = {
        **identity,
        "pythonVersion": sys.version,
        "optunaVersion": optuna.__version__,
        "torchVersion": None,
        "scipyVersion": None,
        "seed": 7,
        "constraintSchema": list(STAGE2E_CONSTRAINT_KEYS),
        "startingTrialNumber": len(study.trials),
        "previousGpAttempts": len(prior_gp),
        "previousStudyPhysicalAttempts": previous_physical_attempts,
        "oatCandidates": 5,
        "candidateBudgetTotal": 25,
        "candidateBudgetGp": 20,
        "requestedGpCandidates": args.max_gp_candidates,
        "startTimestamp": started.isoformat(),
        "stopReason": None,
        "oatDecision": oat["decision"],
        "oatSelectedScale": oat.get("selectedScale"),
    }
    for module_name, attr in (("torch", "torchVersion"), ("scipy", "scipyVersion")):
        try:
            module = __import__(module_name)
            manifest[attr] = getattr(module, "__version__", "unknown")
        except Exception:
            pass
    write_json(manifest_path, manifest)
    if args.dry_run:
        manifest.update({"endTimestamp": datetime.now(timezone.utc).isoformat(), "stopReason": "DRY_RUN_NO_RENDER"})
        write_json(manifest_path, manifest)
        print(json.dumps({"studyName": identity["studyName"], "dryRun": True,
                          "existingTrials": len(study.trials), "manifest": str(manifest_path)}, sort_keys=True))
        return 0

    objective = make_objective(search, identity, study)
    current_unique_candidates = len({
        json.dumps(trial.user_attrs.get("parameters") or trial.params, sort_keys=True, separators=(",", ":"))
        for trial in prior_gp
        if trial.user_attrs.get("deduplicated") is not True
        and (trial.user_attrs.get("parameters") or trial.params)
    })
    requested = min(args.max_gp_candidates, max(0, 20 - previous_physical_attempts - current_unique_candidates))
    stop_reason = "GP_BUDGET_DISABLED_OR_EXHAUSTED"
    completed_now = 0
    try:
        for _ in range(max(0, requested)):
            if file_identity(search) != identity:
                stop_reason = "BLOCKED_SOURCE_CHANGED"
                break
            if len(feasible_trials(study)) >= 3:
                stop_reason = "THREE_PROXY_FEASIBLE_CANDIDATES"
                break
            study.optimize(objective, n_trials=1, n_jobs=1, catch=())
            completed_now += 1
            if len(feasible_trials(study)) >= 3:
                stop_reason = "THREE_PROXY_FEASIBLE_CANDIDATES"
                break
        else:
            stop_reason = "GP_BUDGET_EXHAUSTED" if requested > 0 else "GP_BUDGET_DISABLED_OR_EXHAUSTED"
    except Exception as error:
        stop_reason = "INFRASTRUCTURE_OR_SOURCE_ERROR"
        manifest["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        promotion_path = save_promotion(study, identity)
        trials = study.trials
        complete = completed_trials(study)
        failed = [trial for trial in trials if trial.state == optuna.trial.TrialState.FAIL]
        manifest.update({
            "endTimestamp": datetime.now(timezone.utc).isoformat(),
            "stopReason": stop_reason,
            "gpComplete": len(complete),
            "gpFail": len(failed),
            "completeThisRun": completed_now,
            "feasibleCount": len(feasible_trials(study)),
            "measurementInvalidCompleteCount": sum(trial.user_attrs.get("measurement_invalid_count", 0) > 0 for trial in complete),
            "promotionPath": str(promotion_path),
        })
        write_json(manifest_path, manifest)

    print(json.dumps({"studyName": identity["studyName"], "gpComplete": len(completed_trials(study)),
                      "gpFail": len([trial for trial in study.trials if trial.state == optuna.trial.TrialState.FAIL]),
                      "feasibleCount": len(feasible_trials(study)), "stopReason": stop_reason,
                      "manifest": str(manifest_path), "promotion": str(STATE_ROOT / 'promotion-stage3.json')}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
