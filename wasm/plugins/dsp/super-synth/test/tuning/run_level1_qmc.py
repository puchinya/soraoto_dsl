#!/usr/bin/env python3
"""Run the Issue #7 baseline plus the approved 64-point Level-1 Sobol screen."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[6]
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
SPACE_PATH = TUNING / "active-search-space.json"
REGISTRY_PATH = TUNING / "physical-parameter-registry.json"
EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs"
EQUIVALENCE = ROOT / "wasm/plugins/dsp/super-synth/test/tools/verify-qmc-scratch-equivalence.cjs"
PRESETS = ROOT / "wasm/plugins/dsp/super-synth/presets.json"
ISSUE_ROOT = ROOT / ".agent-state/issues/7"
OPTUNA_ROOT = ISSUE_ROOT / "calibration-optuna"
ARTIFACT_ROOT = ISSUE_ROOT / "full-reoptimization/qmc"
RESULT_ROOT = ARTIFACT_ROOT / "results"
LOG_ROOT = ARTIFACT_ROOT / "logs"
SCRATCH_ROOT = ROOT / "build/wasm/calibration"
DATABASE = OPTUNA_ROOT / "study.db"
EVALUATOR_FILES = [
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/verify-qmc-scratch-equivalence.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/run_level1_qmc.py",
    "wasm/plugins/dsp/super-synth/test/tuning/README.md",
    "wasm/plugins/dsp/super-synth/test/tuning/requirements.txt",
    "wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.json",
    "wasm/plugins/dsp/super-synth/test/tuning/active-search-space.json",
    "web-player/src/js/plugin-cbor.js",
    "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json",
    "wasm/plugins/dsp/super-synth/src/plugin.c",
    "wasm/cmake/super_synth_metadata.py",
    "wasm/cmake/generate_plugin_metadata.py",
    "wasm/CMakeLists.txt",
    "wasm/cmake/wasm_plugin.cmake",
]


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_files(relative_paths: list[str]) -> str:
    digest = hashlib.sha256()
    for relative in sorted(relative_paths):
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update((ROOT / relative).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(path for path in root.rglob("*") if path.is_file())
    for path in files:
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def git_output(*args: str) -> str:
    return subprocess.check_output(["rtk", "git", *args], cwd=ROOT, text=True).strip()


def identity() -> dict:
    return {
        "sourceRevision": git_output("rev-parse", "HEAD"),
        "sourceDirty": bool(git_output("status", "--porcelain")),
        "sourceTreeSha256": hash_tree(ROOT / "wasm"),
        "evaluatorSha256": hash_files(EVALUATOR_FILES),
        "searchSpaceSha256": sha256_bytes(SPACE_PATH.read_bytes()),
        "registrySha256": sha256_bytes(REGISTRY_PATH.read_bytes()),
        "presetFileSha256": sha256_bytes(PRESETS.read_bytes()),
    }


def assert_identity(expected: dict, where: str) -> None:
    observed = identity()
    mismatches = {key: {"expected": expected.get(key), "observed": observed.get(key)}
                  for key in expected if observed.get(key) != expected.get(key)}
    if mismatches:
        raise RuntimeError(f"BLOCKED_SOURCE_CHANGED at {where}: {json.dumps(mismatches, sort_keys=True)}")


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".tmp-{os.getpid()}")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def load_optuna():
    try:
        import optuna
    except ImportError as error:
        raise RuntimeError("Optuna is not installed; install test/tuning/requirements.txt into the isolated calibration-optuna venv") from error
    if optuna.__version__ != "5.0.0":
        raise RuntimeError(f"expected optuna==5.0.0, found {optuna.__version__}")
    return optuna


def resolved_version(module: str) -> str | None:
    if importlib.util.find_spec(module) is None:
        return None
    try:
        return importlib.metadata.version(module)
    except importlib.metadata.PackageNotFoundError:
        return "installed-version-unavailable"


def suggest(trial, space: dict) -> dict:
    values = {}
    for dimension in space["dimensions"]:
        values[dimension["name"]] = trial.suggest_float(
            dimension["name"],
            float(dimension["min"]),
            float(dimension["max"]),
            log=dimension["scale"] == "log",
        )
    return values


def check_vector(values: dict, space: dict) -> None:
    expected = {item["name"] for item in space["dimensions"]}
    if set(values) != expected:
        raise RuntimeError(f"Sobol vector dimension mismatch: {sorted(values)}")
    for dimension in space["dimensions"]:
        value = values[dimension["name"]]
        if not math.isfinite(value) or value < dimension["min"] or value > dimension["max"]:
            raise RuntimeError(f"out-of-domain Sobol value {dimension['name']}={value}")


def generate_vectors(optuna, space: dict, count: int = 64) -> dict:
    from optuna.samplers import QMCSampler, RandomSampler

    sampler = QMCSampler(
        qmc_type="sobol", scramble=True, seed=7,
        independent_sampler=RandomSampler(seed=7),
    )
    design = optuna.create_study(direction="minimize", sampler=sampler)
    # QMCSampler needs one completed set of distributions before its relative
    # search space is established. This seeded sampler-initialization trial is
    # design metadata only and is never included among the 64 QMC candidates.
    bootstrap = design.ask()
    suggest(bootstrap, space)
    design.tell(bootstrap, 0.0)
    vectors = []
    for index in range(count):
        trial = design.ask()
        params = suggest(trial, space)
        check_vector(params, space)
        vectors.append({"qmcIndex": index, "candidateId": f"sobol-{index + 1:03d}", "parameters": params})
        design.tell(trial, 0.0)
    serialized = [json.dumps(vector["parameters"], sort_keys=True, separators=(",", ":")) for vector in vectors]
    if len(set(serialized)) != count:
        raise RuntimeError(f"Sobol design contains duplicate candidates ({count - len(set(serialized))} duplicates)")
    return {
        "schemaVersion": 1,
        "sampler": {"library": "optuna", "class": "QMCSampler", "qmcType": "sobol", "scramble": True, "seed": 7},
        "designBootstrapTrials": 1,
        "candidateCount": count,
        "dimensions": [item["name"] for item in space["dimensions"]],
        "searchSpaceSha256": sha256_bytes(SPACE_PATH.read_bytes()),
        "vectors": vectors,
    }


def run_command(command: list[str], log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, check=False)
    log_path.write_text(completed.stdout)
    if completed.returncode:
        excerpt = "\n".join(completed.stdout.splitlines()[-60:])
        raise RuntimeError(f"command exited {completed.returncode}: {' '.join(command)}\n{excerpt}")


def candidate_paths(candidate_id: str) -> tuple[Path, Path, Path]:
    return (
        RESULT_ROOT / f"{candidate_id}.candidate.json",
        RESULT_ROOT / f"{candidate_id}.json",
        SCRATCH_ROOT / candidate_id,
    )


def evaluate_candidate(candidate_id: str, params: dict, frozen_identity: dict) -> dict:
    assert_identity(frozen_identity, f"before {candidate_id}")
    candidate_path, result_path, build_root = candidate_paths(candidate_id)
    candidate_input = {"schemaVersion": 1, "candidateId": candidate_id, "parameters": params,
                       "searchSpaceSha256": frozen_identity["searchSpaceSha256"]}
    if result_path.exists():
        result = load_json(result_path)
        recorded = result.get("parameters", {})
        if result.get("candidateId") != candidate_id or {name: recorded.get(name) for name in params} != params:
            raise RuntimeError(f"stored candidate result does not match requested {candidate_id}")
        for key in ("sourceRevision", "sourceTreeSha256", "evaluatorSha256", "configSha256", "wasmSha256"):
            if key in frozen_identity and result.get(key) != frozen_identity[key] and key not in ("configSha256", "wasmSha256"):
                raise RuntimeError(f"stored candidate {candidate_id} has incompatible {key}")
        return result
    atomic_json(candidate_path, candidate_input)
    run_command(["rtk", "node", str(EVALUATOR), "--candidate", str(candidate_path), "--output", str(result_path),
                 "--build-root", str(build_root)], LOG_ROOT / f"{candidate_id}.log")
    assert_identity(frozen_identity, f"after {candidate_id}")
    result = load_json(result_path)
    if result.get("candidateId") != candidate_id or result.get("screeningStatus") != "COMPLETED":
        raise RuntimeError(f"invalid candidate result for {candidate_id}")
    return result


def run_baseline(frozen_identity: dict) -> tuple[dict, dict]:
    candidate_id = f"baseline-{frozen_identity['evaluatorSha256'][:12]}"
    _, result_path, _ = candidate_paths(candidate_id)
    if result_path.exists():
        result = load_json(result_path)
        for key in ("sourceRevision", "sourceTreeSha256", "evaluatorSha256"):
            if result.get(key) != frozen_identity.get(key):
                raise RuntimeError(f"stored baseline has incompatible {key}")
    else:
        baseline = {item["name"]: float(item["baseline"]) for item in load_json(SPACE_PATH)["dimensions"]}
        result = evaluate_candidate(candidate_id, baseline, frozen_identity)
    assert_identity(frozen_identity, "after baseline scratch build")
    scratch_matrix = SCRATCH_ROOT / candidate_id / "matrix.json"
    equivalence_path = ARTIFACT_ROOT / f"{candidate_id}-equivalence.json"
    run_command(["rtk", "node", str(EQUIVALENCE), "--scratch-matrix", str(scratch_matrix), "--output", str(equivalence_path)],
                LOG_ROOT / f"{candidate_id}-equivalence.log")
    equivalence = load_json(equivalence_path)
    if not equivalence.get("pass"):
        raise RuntimeError(f"BLOCKED_SCRATCH_BASELINE_MISMATCH: {json.dumps(equivalence, sort_keys=True)}")
    assert_identity(frozen_identity, "after ordinary-vs-scratch equivalence")
    return result, equivalence


def sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.resolve()}"


def queue_design(optuna, space: dict, vectors: dict):
    from optuna.samplers import QMCSampler, RandomSampler

    study_name = space["studyName"]
    sampler = QMCSampler(
        qmc_type="sobol", scramble=True, seed=7,
        independent_sampler=RandomSampler(seed=7),
    )
    study = optuna.create_study(study_name=study_name, storage=sqlite_url(DATABASE), load_if_exists=True,
                                direction="minimize", sampler=sampler)
    prior_trials = study.get_trials(deepcopy=False)
    starting_trial_number = max((trial.number for trial in prior_trials), default=-1) + 1
    known = {trial.user_attrs.get("qmc_index") for trial in prior_trials}
    for vector in vectors["vectors"]:
        index = vector["qmcIndex"]
        if index not in known:
            study.enqueue_trial(vector["parameters"], user_attrs={"qmc_index": index,
                                                                   "candidate_id": vector["candidateId"]})
    return study, starting_trial_number


def trial_parameters(trial, space: dict) -> dict:
    params = suggest(trial, space)
    check_vector(params, space)
    return params


def core_user_metrics(result: dict) -> dict:
    metrics = result["metrics"]
    return {
        "a0MeanAbsPitchCents": mean_valid_pitch(metrics["pitch"]["a0ByVelocity"]),
        "c8MeanAbsPitchCents": mean_valid_pitch(metrics["pitch"]["c8ByVelocity"]),
        "worstAbsolutePitchCents": metrics["pitch"]["worstAbsoluteValidPitchErrorCents"],
        "pitchViolationMarginCents": metrics["pitch"]["violationMarginCents"],
        "brightness": metrics["brightness"]["ratio"],
        "referenceFitLoss": metrics["referenceFitLoss"]["value"],
        "lowRegisterBuzz": metrics["lowRegisterBuzz"]["value"],
        "peakHeadroomDb": metrics["peak"]["headroomDb"],
        "guardHits": metrics["guardHits"],
        "finite": metrics["finite"],
        "measurementInvalidCount": metrics["measurement"]["invalidCount"],
    }


def mean_valid_pitch(cells: list[dict]) -> float | None:
    values = [abs(cell["errorCents"]) for cell in cells if cell.get("result") != "MEASUREMENT_INVALID"
              and isinstance(cell.get("errorCents"), (int, float)) and math.isfinite(cell["errorCents"])]
    return sum(values) / len(values) if values else None


def run_pending_trials(optuna, study, space: dict, vectors: dict, frozen_identity: dict,
                       starting_trials: int) -> tuple[int, str]:
    from optuna.trial import TrialState

    vector_by_index = {vector["qmcIndex"]: vector for vector in vectors["vectors"]}
    attempted = 0
    stop_reason = "64_CANDIDATES_COMPLETE"

    # Recover trials interrupted after their candidate identity and params were persisted.
    for frozen in study.get_trials(deepcopy=False, states=(TrialState.RUNNING,)):
        index = frozen.user_attrs.get("qmc_index", frozen.number)
        if index not in vector_by_index or not frozen.params:
            study.tell(frozen.number, state=TrialState.FAIL)
            stop_reason = "BLOCKED_INCOMPLETE_RUNNING_TRIAL"
            return attempted, stop_reason
        vector = vector_by_index[index]
        if any(frozen.params.get(name) != value for name, value in vector["parameters"].items()):
            study.tell(frozen.number, state=TrialState.FAIL)
            stop_reason = "BLOCKED_RUNNING_TRIAL_PARAM_MISMATCH"
            return attempted, stop_reason
        result = evaluate_candidate(vector["candidateId"], vector["parameters"], frozen_identity)
        study.tell(frozen.number, float(result["metrics"]["referenceFitLoss"]["value"]))
        attempted += 1

    while True:
        trials = study.get_trials(deepcopy=False)
        completed_indices = {trial.user_attrs.get("qmc_index", trial.number) for trial in trials
                             if trial.state == TrialState.COMPLETE}
        if len(completed_indices) >= 64:
            break
        assert_identity(frozen_identity, f"before QMC proposal {len(completed_indices) + 1}")
        trial = study.ask()
        index = trial.user_attrs.get("qmc_index", trial.number)
        if index not in vector_by_index:
            study.tell(trial, state=TrialState.FAIL)
            stop_reason = "BLOCKED_UNEXPECTED_TRIAL"
            return attempted, stop_reason
        vector = vector_by_index[index]
        params = trial_parameters(trial, space)
        if params != vector["parameters"]:
            study.tell(trial, state=TrialState.FAIL)
            stop_reason = "BLOCKED_ENQUEUED_PARAM_MISMATCH"
            return attempted, stop_reason
        candidate_id = vector["candidateId"]
        result_path = candidate_paths(candidate_id)[1]
        for key,value in {
            "candidate_id":candidate_id,"qmc_index":index,"stage_reached":1,
            "source_revision":frozen_identity["sourceRevision"],
            "source_tree_sha256":frozen_identity["sourceTreeSha256"],
            "evaluator_sha256":frozen_identity["evaluatorSha256"],
            "result_path":str(result_path),"historical_replay":False
        }.items(): trial.set_user_attr(key,value)
        try:
            result=evaluate_candidate(candidate_id,params,frozen_identity)
            summary=core_user_metrics(result)
            for key,value in summary.items(): trial.set_user_attr(key,value)
            trial.set_user_attr("config_sha256",result["configSha256"])
            trial.set_user_attr("wasm_sha256",result["wasmSha256"])
            trial.set_user_attr("elapsed_seconds",result["elapsedSeconds"])
            study.tell(trial,float(result["metrics"]["referenceFitLoss"]["value"]))
            attempted+=1
            print(json.dumps({"candidateId":candidate_id,"qmcIndex":index,
                              "measurementInvalidCount":summary["measurementInvalidCount"],
                              "worstPitchCents":summary["worstAbsolutePitchCents"],
                              "brightness":summary["brightness"],"peakHeadroomDb":summary["peakHeadroomDb"],
                              "lowRegisterBuzz":summary["lowRegisterBuzz"],"guardHits":summary["guardHits"],
                              "referenceFitLoss":summary["referenceFitLoss"]}),flush=True)
            assert_identity(frozen_identity,f"after {candidate_id}")
        except Exception:
            study.tell(trial,state=TrialState.FAIL)
            raise
    return attempted, stop_reason


def create_metric_study(optuna, trials, metric_name: str, target_key: str, sign: float = 1.0):
    from optuna.trial import create_trial

    metric_study = optuna.create_study(direction="minimize")
    sample_count=0
    for trial in trials:
        value=trial.user_attrs.get(target_key)
        if value is None or not isinstance(value,(int,float)) or not math.isfinite(value):
            continue
        metric_study.add_trial(create_trial(params=trial.params,distributions=trial.distributions,
                                             value=sign*float(value)))
        sample_count+=1
    return metric_study,sample_count


def ped_anova(optuna, study, vectors: dict) -> dict:
    from optuna.importance import PedAnovaImportanceEvaluator, get_param_importances
    from optuna.trial import TrialState

    complete=[trial for trial in study.get_trials(deepcopy=False,states=(TrialState.COMPLETE,))
              if trial.user_attrs.get("qmc_index") is not None]
    targets={
        "A0 pitch error":("a0MeanAbsPitchCents",1.0,15.0),
        "C8 pitch error":("c8MeanAbsPitchCents",1.0,15.0),
        "worst pitch error":("worstAbsolutePitchCents",1.0,15.0),
        "brightness":("brightness",-1.0,None),
        "reference-fit loss":("referenceFitLoss",1.0,1.0),
        "low-register buzz":("lowRegisterBuzz",1.0,0.12),
        "peak headroom":("peakHeadroomDb",-1.0,None),
    }
    evaluator=PedAnovaImportanceEvaluator()
    reports={}
    importance_union=set()
    all_dimensions=[dimension["name"] for dimension in load_json(SPACE_PATH)["dimensions"]]
    for label,(key,sign,tolerance) in targets.items():
        metric_study,sample_count=create_metric_study(optuna,complete,label,key,sign)
        if sample_count<10:
            reports[label]={"sampleCount":sample_count,"status":"INSUFFICIENT_METRIC_OBSERVATIONS","importance":{},"measuredSpanHits":[]}
            continue
        importance=get_param_importances(metric_study,evaluator=evaluator,params=all_dimensions,normalize=True)
        ranked=sorted(importance.items(),key=lambda item:(-item[1],item[0]))
        selected=set()
        cumulative=0.0
        for name,value in ranked:
            selected.add(name)
            cumulative+=value
            if cumulative>=0.90: break
        selected.update(name for name,value in importance.items() if value>=0.10)
        span_hits=[]
        if tolerance is not None:
            for name in all_dimensions:
                pairs=[]
                for trial in complete:
                    value=trial.user_attrs.get(key)
                    parameter=trial.params.get(name)
                    if isinstance(value,(int,float)) and math.isfinite(value) and parameter is not None:
                        pairs.append((parameter,sign*float(value)))
                if len(pairs)<10: continue
                pairs.sort(key=lambda pair:pair[0])
                half=len(pairs)//2
                low=[value for _,value in pairs[:half]]
                high=[value for _,value in pairs[-half:]]
                low_median=sorted(low)[len(low)//2]
                high_median=sorted(high)[len(high)//2]
                measured_span=abs(high_median-low_median)
                if measured_span>=0.25*tolerance:
                    span_hits.append({"parameter":name,"lowHighMedianEffect":measured_span,"quarterTolerance":0.25*tolerance})
                    selected.add(name)
        importance_union.update(selected)
        reports[label]={"sampleCount":sample_count,"status":"COMPUTED","importance":importance,
                        "ranked":ranked,"selectedAt90PercentOrPoint10":sorted(selected),"measuredSpanHits":span_hits}
    return {"schemaVersion":1,"studyName":study.study_name,"candidateTrials":len(complete),
            "metrics":reports,"activeLevel1Set":sorted(importance_union),
            "selectionRule":"union: smallest set reaching 90% cumulative importance per target, all individual importance >=0.10, plus measured high/low median effects >=25% of a known tolerance"}


def write_manifest(space: dict, frozen_identity: dict, optuna, starting_trials: int,
                   stop_reason: str, vector_file: Path, baseline: dict | None,
                   equivalence: dict | None, end_time: str | None = None) -> dict:
    return {
        "schemaVersion":1,"pythonVersion":sys.version,"platform":platform.platform(),
        "optunaVersion":optuna.__version__,"torchVersion":resolved_version("torch"),
        "scipyVersion":resolved_version("scipy"),"seed":7,
        "searchSpaceSha256":frozen_identity["searchSpaceSha256"],
        "registrySha256":frozen_identity["registrySha256"],
        "evaluatorSha256":frozen_identity["evaluatorSha256"],
        "sourceRevision":frozen_identity["sourceRevision"],"sourceDirty":frozen_identity["sourceDirty"],
        "sourceTreeSha256":frozen_identity["sourceTreeSha256"],
        "configSha256":baseline.get("configSha256") if baseline else None,
        "wasmSha256":baseline.get("wasmSha256") if baseline else None,
        "studyName":space["studyName"],"storagePath":str(DATABASE),"startingTrialNumber":starting_trials,
        "candidateBudget":64,"vectorFile":str(vector_file),
        "vectorFileSha256":sha256_bytes(vector_file.read_bytes()) if vector_file.exists() else None,
        "baselineResult":str(RESULT_ROOT/f"baseline-{frozen_identity['evaluatorSha256'][:12]}.json"),"baselineEquivalence":equivalence,
        "startedAtUtc":_STARTED_AT,"endedAtUtc":end_time,"stopReason":stop_reason,
    }


_STARTED_AT = now_utc()


def run(generate_only: bool=False) -> int:
    optuna=load_optuna()
    space=load_json(SPACE_PATH)
    if len(space.get("dimensions",[]))!=6 or space.get("sampler",{}).get("points")!=64:
        raise RuntimeError("active search space does not define exactly six dimensions and 64 Sobol points")
    frozen_identity=identity()
    OPTUNA_ROOT.mkdir(parents=True,exist_ok=True)
    ARTIFACT_ROOT.mkdir(parents=True,exist_ok=True)
    RESULT_ROOT.mkdir(parents=True,exist_ok=True)
    LOG_ROOT.mkdir(parents=True,exist_ok=True)

    vectors=generate_vectors(optuna,space,64)
    vector_file=ARTIFACT_ROOT/"sobol-vectors-seed7.json"
    atomic_json(vector_file,{**vectors,"identity":frozen_identity,"generatedAtUtc":now_utc()})
    print(json.dumps({"sobolVectors":64,"dimensions":6,"seed":7,"scramble":True,
                      "searchSpaceSha256":frozen_identity["searchSpaceSha256"],
                      "vectorFileSha256":sha256_bytes(vector_file.read_bytes())}),flush=True)
    if generate_only:
        manifest=write_manifest(space,frozen_identity,optuna,0,"VECTORS_GENERATED_ONLY",vector_file,None,None,now_utc())
        atomic_json(ARTIFACT_ROOT/"run-manifest.json",manifest)
        return 0

    baseline,equivalence=run_baseline(frozen_identity)
    assert_identity(frozen_identity,"before QMC study initialization")
    study,starting_trials=queue_design(optuna,space,vectors)
    run_manifest=write_manifest(space,frozen_identity,optuna,starting_trials,"IN_PROGRESS",vector_file,baseline,equivalence)
    atomic_json(ARTIFACT_ROOT/"run-manifest.json",run_manifest)

    stop_reason="64_CANDIDATES_COMPLETE"
    try:
        attempted,stop_reason=run_pending_trials(optuna,study,space,vectors,frozen_identity,starting_trials)
        from optuna.trial import TrialState
        complete=[trial for trial in study.get_trials(deepcopy=False,states=(TrialState.COMPLETE,))
                  if trial.user_attrs.get("qmc_index") is not None]
        if len(complete)==64:
            analysis=ped_anova(optuna,study,vectors)
            atomic_json(ARTIFACT_ROOT/"ped-anova-and-active-set.json",analysis)
            stop_reason="QMC_64_COMPLETE_PED_ANOVA_COMPLETE"
        else:
            analysis=None
        summary={"schemaVersion":1,"studyName":study.study_name,"candidateCount":len(complete),
                 "baseline":baseline,"scratchEquivalence":equivalence,"sobolVectors":vectors["vectors"],
                 "stopReason":stop_reason,"pedAnova":analysis}
        atomic_json(ARTIFACT_ROOT/"qmc-summary.json",summary)
        print(json.dumps({"candidateCount":len(complete),"stopReason":stop_reason,
                          "activeLevel1Set":analysis["activeLevel1Set"] if analysis else None}),flush=True)
    except Exception as error:
        stop_reason="BLOCKED_BY_SOURCE_CHANGE" if "BLOCKED_SOURCE_CHANGED" in str(error) else "BLOCKED_BY_EVALUATION_ERROR"
        atomic_json(ARTIFACT_ROOT/"run-error.json",{"timeUtc":now_utc(),"stopReason":stop_reason,"error":str(error)})
        raise
    finally:
        run_manifest=write_manifest(space,frozen_identity,optuna,starting_trials,stop_reason,vector_file,baseline,equivalence,now_utc())
        atomic_json(ARTIFACT_ROOT/"run-manifest.json",run_manifest)
    return 0


def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument("--generate-vectors-only",action="store_true",help="verify and save the deterministic 64-point design without audio renders")
    args=parser.parse_args()
    return run(generate_only=args.generate_vectors_only)


if __name__=="__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"QMC run stopped: {error}",file=sys.stderr)
        raise
