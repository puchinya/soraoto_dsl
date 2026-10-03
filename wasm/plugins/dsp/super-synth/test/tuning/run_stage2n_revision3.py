#!/usr/bin/env python3
"""Run the single-candidate Stage2N revision-3 gate after DSL-only alignment."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[6]
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
STATE = ROOT / ".agent-state/issues/7/calibration-optuna/stage2n-revision3"
MANIFESTS = STATE / "runs"
RESULTS = STATE / "results"
SCRATCH = STATE / "scratch"
SEARCH_PATH = TUNING / "stage2l-model-revision-search-space.json"
STAGE2L_RESULT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2l-model-revision-2/results/stage2l-r2-candidate-01.json"
STAGE2M_RESULT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2m-factorial/factorial-result.json"
STAGE2M_PEAKNEAR = ROOT / ".agent-state/issues/7/calibration-optuna/stage2m-factorial/factorial-result-peaknear.json"
STAGE2M_LONG = ROOT / ".agent-state/issues/7/calibration-optuna/stage2m-factorial/factorial-result-long-window.json"
SUBSET_PATH = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
CANDIDATE_ID = "stage2n-r3-candidate-01"
MAX_CANDIDATES = 1
PREVIOUS_STAGE2L_CANDIDATES = 1
MAX_STAGE2L_CANDIDATES = 12
REPRO_TOLERANCE_DB = 1.1e-5
PITCH_TOLERANCE_CENTS = 0.05
EXPECTED_CANDIDATE = {
    "effective_strike_position_c4": 0.13664120183629616,
    "hammer.compression_scale": 0.00053383185753125,
    "hammer.velocity_hardness_amount": 0.5,
    "piano_hammer_hardness": 0.3719079878026494,
    "piano_inharmonicity": 0.06597007256584347,
    "piano_string_damping": 0.0,
    "piano_string_unison": 0.9855708493914253,
}
STAGE2M_FACTOR_IDENTITIES = {"N": "revision-2", "V": "revision-2", "H": "legacy"}
VELOCITIES = [14, 31, 36, 40, 45, 49, 54, 61, 69, 77, 85, 93, 101, 109, 117, 124]
PROTECTED_PATHS = (
    STAGE2L_RESULT, STAGE2M_RESULT, STAGE2M_PEAKNEAR, STAGE2M_LONG,
    SEARCH_PATH, SUBSET_PATH,
    ROOT / "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json",
    ROOT / "wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.json",
)
SHARED_ABI_PATHS = (
    ROOT / "wasm/shared/plugin_abi_runtime.h",
    ROOT / "docs/specs/soraotoDSL/spec/03-plugin-model.md",
    ROOT / "docs/specs/soraotoDSL/spec/04-realtime-abi.md",
    ROOT / "docs/specs/soraotoDSL/spec/05-plugin-services.md",
    ROOT / "docs/specs/soraotoDSL/spec/06-project-audio.md",
    ROOT / "docs/specs/soraotoDSL/spec/09-conformance.md",
)
SOURCE_PATHS = (
    ROOT / "wasm/plugins/dsp/super-synth/src/plugin.c",
    ROOT / "wasm/plugins/dsp/super-synth/presets.json",
    ROOT / "wasm/cmake/super_synth_metadata.py",
    ROOT / "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
    ROOT / "wasm/plugins/dsp/super-synth/test/tools/capture-stage2n-revision3.cjs",
    ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
    ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs",
    ROOT / "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
    ROOT / "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
    ROOT / "wasm/plugins/dsp/super-synth/test/tuning/run_stage2e_termination_joint.py",
    ROOT / "wasm/plugins/dsp/super-synth/test/tuning/run_stage2l_model_revision.py",
    ROOT / "wasm/plugins/dsp/super-synth/test/tuning/stage2l-model-revision-search-space.json",
    ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json",
    ROOT / "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json",
    ROOT / "web-player/src/js/plugin-cbor.js",
)

sys.path.insert(0, str(TUNING))
import run_stage2e_termination_joint as stage2e  # noqa: E402
import run_stage2l_model_revision as stage2l  # noqa: E402


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(path: Path) -> str:
    return digest_bytes(path.read_bytes())


def hash_paths(paths: tuple[Path, ...]) -> str:
    hasher = hashlib.sha256()
    for path in sorted(paths, key=lambda item: str(item.relative_to(ROOT))):
        relative = str(path.relative_to(ROOT)).replace(os.sep, "/")
        hasher.update(relative.encode())
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return hasher.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def git_head() -> str:
    return subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def source_dirty() -> bool:
    return bool(subprocess.check_output(["rtk", "git", "status", "--porcelain"], cwd=ROOT, text=True).strip())


def validate_candidate_vector(value: dict[str, Any]) -> None:
    if set(value) != set(EXPECTED_CANDIDATE):
        raise ValueError("BLOCKED_STAGE2N_CANDIDATE_VECTOR: expected exact seven-field Stage2L candidate 1")
    for key, expected in EXPECTED_CANDIDATE.items():
        observed = value[key]
        if isinstance(observed, bool) or not isinstance(observed, (int, float)) or not math.isclose(float(observed), expected, rel_tol=0, abs_tol=1e-15):
            raise ValueError(f"BLOCKED_STAGE2N_CANDIDATE_VECTOR: {key} differs from preserved candidate 1")


def validate_evidence() -> dict[str, Any]:
    for path in (*PROTECTED_PATHS, *SHARED_ABI_PATHS, *SOURCE_PATHS):
        if not path.is_file():
            raise FileNotFoundError(f"required Stage2N input is missing: {path.relative_to(ROOT)}")
    search = read_json(SEARCH_PATH)
    stage2l.validate_search(search)
    prior = read_json(STAGE2L_RESULT)
    validate_candidate_vector(prior.get("parameters", {}))
    if prior.get("candidateId") != "stage2l-r2-candidate-01" or prior.get("stage2bReached") is not True:
        raise ValueError("BLOCKED_STAGE2N_STAGE2L_EVIDENCE: Stage2L candidate-1 result is not complete")
    if prior.get("stage2lProvenance", {}).get("historicalReplay") is not True:
        raise ValueError("BLOCKED_STAGE2N_STAGE2L_EVIDENCE: Stage2L candidate-1 provenance is incomplete")
    factorial = read_json(STAGE2M_RESULT)
    peaknear = read_json(STAGE2M_PEAKNEAR)
    long_window = read_json(STAGE2M_LONG)
    for label, evidence in (("factorial", factorial), ("peaknear", peaknear), ("long-window", long_window)):
        if evidence.get("complete") is not True or evidence.get("diagnosticOnly") is not True or evidence.get("productionSimd") is not True:
            raise ValueError(f"BLOCKED_STAGE2N_STAGE2M_EVIDENCE: {label} artifact is incomplete or not production-SIMD diagnostic evidence")
        if evidence.get("candidateId") != prior["candidateId"]:
            raise ValueError(f"BLOCKED_STAGE2N_STAGE2M_EVIDENCE: {label} artifact candidate identity differs")
        validate_candidate_vector(evidence.get("parameters", {}))
    combination = next((item for item in factorial.get("combinations", []) if item.get("mask") == 3), None)
    if not combination or combination.get("label") != "011" or combination.get("factors") != STAGE2M_FACTOR_IDENTITIES:
        raise ValueError("BLOCKED_STAGE2N_STAGE2M_EVIDENCE: mask 011 factor definition is missing")
    if len(combination.get("midi45", [])) != len(VELOCITIES) or [row.get("velocity") for row in combination["midi45"]] != VELOCITIES:
        raise ValueError("BLOCKED_STAGE2N_STAGE2M_EVIDENCE: mask 011 MIDI45 layer coverage is incomplete")
    if not isinstance(combination.get("c8"), dict) or not isinstance(combination.get("midi21"), dict):
        raise ValueError("BLOCKED_STAGE2N_STAGE2M_EVIDENCE: mask 011 focused probes are incomplete")
    observed_span = max(row["level80to200Dbfs"] for row in combination["midi45"]) - min(row["level80to200Dbfs"] for row in combination["midi45"])
    if abs(observed_span - 26.526804) > REPRO_TOLERANCE_DB:
        raise ValueError("BLOCKED_STAGE2N_STAGE2M_EVIDENCE: saved mask 011 span differs from the approved target")
    c8_violation = float(combination["c8"]["postAttackShapeViolationDb"])
    estimator_cents = float(combination["midi21"]["currentEstimatorCents"])
    long_combination = next((item for item in long_window.get("combinations", []) if item.get("mask") == 3), None)
    if not long_combination or not isinstance(long_combination.get("midi21"), dict):
        raise ValueError("BLOCKED_STAGE2N_STAGE2M_EVIDENCE: long-window MIDI21 probe is missing")
    near_cents = float(long_combination["midi21"]["constrainedNearFundamentalCents"])
    if abs(c8_violation - (-0.221763)) > REPRO_TOLERANCE_DB:
        raise ValueError("BLOCKED_STAGE2N_STAGE2M_EVIDENCE: saved mask 011 C8 target changed")
    if abs(estimator_cents - 29.485665486244464) > PITCH_TOLERANCE_CENTS or abs(near_cents - 13.04792250285121) > PITCH_TOLERANCE_CENTS:
        raise ValueError("BLOCKED_STAGE2N_STAGE2M_EVIDENCE: saved mask 011 MIDI21 pitch targets changed")
    budget = factorial.get("stage2lCandidateBudgetObserved", {})
    if budget.get("before", {}).get("candidateIdentities") != PREVIOUS_STAGE2L_CANDIDATES or budget.get("after", {}).get("candidateIdentities") != PREVIOUS_STAGE2L_CANDIDATES or budget.get("before", {}).get("maximumCandidateIdentities") != MAX_STAGE2L_CANDIDATES:
        raise ValueError("BLOCKED_STAGE2N_STAGE2L_BUDGET: preserved Stage2L budget is not 1/12")
    if len(stage2e.STAGE2E_CONSTRAINT_KEYS) != 32:
        raise ValueError("BLOCKED_STAGE2N_CONSTRAINT_SCHEMA: Stage2E must expose exactly 32 constraints")
    return {"stage2lCandidate": prior, "stage2mFactorial": factorial, "stage2mPeaknear": peaknear,
            "stage2mLongWindow": long_window, "combination011": combination, "longWindow011": long_combination, "searchSpace": search}


def protected_hashes() -> dict[str, str]:
    paths = set(PROTECTED_PATHS) | set(SHARED_ABI_PATHS) | set(SOURCE_PATHS)
    return {str(path.relative_to(ROOT)): digest_file(path) for path in sorted(paths, key=lambda p: str(p.relative_to(ROOT)))}


def source_identity(search: dict[str, Any]) -> dict[str, Any]:
    stage2l.SEARCH_PATH = SEARCH_PATH
    base = stage2l.source_identity(search)
    evaluator_paths = (
        *SOURCE_PATHS,
        ROOT / "wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs",
        ROOT / "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
        ROOT / "wasm/plugins/dsp/super-synth/test/tuning/run_stage2n_revision3.py",
        ROOT / "wasm/plugins/dsp/super-synth/test/tuning/tests/test_stage2n_revision3.py",
    )
    base["evaluatorSha256"] = hash_paths(evaluator_paths)
    base["studyName"] = "issue-7-stage2n-revision3-single-candidate"
    base["oatResultSha256"] = None
    return base


def configure_stage2e_paths() -> None:
    stage2l.SEARCH_PATH = SEARCH_PATH
    stage2l.STATE_ROOT = STATE
    stage2l.RESULTS = RESULTS
    stage2l.SCRATCH = SCRATCH
    stage2l.bind_stage2e_scratch()


def classify(result: dict[str, Any], constraints: dict[str, float], preflight: dict[str, Any]) -> str:
    if set(constraints) != set(stage2e.STAGE2E_CONSTRAINT_KEYS):
        raise ValueError("Stage2N complete result does not contain the exact ordered 32-constraint schema")
    if all(value <= 0 for value in constraints.values()):
        return "STAGE2N_STAGE2_PASS"
    independent_positive = [key for key, value in constraints.items()
                            if value > 0 and key not in {"stage1_violation", "stage2_violation", "stage2b_violation"}]
    only_pitch = bool(independent_positive) and all("pitch" in key for key in independent_positive)
    other_positive = [key for key in independent_positive if "pitch" not in key]
    midi21 = preflight["midi21"]
    if only_pitch and not other_positive and midi21["measurementValid"] \
            and abs(midi21["constrainedNearFundamentalCents"]) <= 15 \
            and abs(midi21["currentEstimatorCents"]) > 15:
        return "BLOCKED_STAGE2N_PITCH_ESTIMATOR"
    return "BLOCKED_STAGE2N_MODEL"


def validate_constraint_vector(constraints: dict[str, Any]) -> dict[str, float]:
    if tuple(constraints) != stage2e.STAGE2E_CONSTRAINT_KEYS:
        raise ValueError("Stage2N constraint keys/order differ from the fixed Stage2E schema")
    converted = {}
    for name in stage2e.STAGE2E_CONSTRAINT_KEYS:
        value = constraints[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise ValueError(f"Stage2N constraint {name} must be finite and measured")
        converted[name] = float(value)
    return converted


def create_manifest(mode: str, head: str, hashes: dict[str, str], evidence: dict[str, Any], identity: dict[str, Any]) -> dict[str, Any]:
    return {"schemaVersion": 1, "stage": "Stage2N", "mode": mode, "status": "PREFLIGHT_VALIDATED" if mode == "dry-run" else "RUNNING",
        "candidateId": CANDIDATE_ID, "candidateVector": EXPECTED_CANDIDATE, "physicalCandidateBudget": {"maximum": MAX_CANDIDATES, "before": 0, "after": 0},
        "stage2lBudget": {"candidateIdentities": 1, "maximumCandidateIdentities": 12, "remainingGPSamplerCandidates": 11},
        "sourceRevision": head, "sourceDirty": source_dirty(), "sourceTreeSha256": identity["sourceTreeSha256"],
        "configSourceSha256": identity["sourceConfigSha256"], "searchSpaceSha256": identity["searchSpaceSha256"],
        "subsetSha256": identity["subsetSha256"], "evaluatorSha256": identity["evaluatorSha256"],
        "constraintSchema": list(stage2e.STAGE2E_CONSTRAINT_KEYS), "constraintSchemaSha256": digest_bytes(json.dumps(list(stage2e.STAGE2E_CONSTRAINT_KEYS), separators=(",", ":")).encode()),
        "protectedEvidenceSha256": hashes, "stage2mMask011CellCount": 18,
        "stage2m011": {"midi45SpanDb": 26.526804,"c8ShapeViolationDb": -0.221763,
                       "midi21EstimatorCents": 29.485665486244464,"midi21NearFundamentalCents": 13.04792250285121},
        "stage2lCandidateSourceRevision": evidence["stage2lCandidate"].get("sourceRevision"),
        "createdAt": datetime.now(timezone.utc).isoformat(), "startedAt": None, "endedAt": None,
        "preflightBuildCount": 0, "preflightRenderCount": 0, "stage2eCandidateEvaluationCount": 0,
        "outcome": None}


def run_preflight(candidate_path: Path, build_root: Path, output_path: Path) -> dict[str, Any]:
    command = ["rtk", "node", "wasm/plugins/dsp/super-synth/test/tools/capture-stage2n-revision3.cjs",
               "--candidate", str(candidate_path), "--build-root", str(build_root), "--output", str(output_path)]
    env = os.environ.copy()
    env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(SEARCH_PATH)
    run = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True)
    if run.returncode != 0:
        raise RuntimeError(f"Stage2N 18-cell preflight tool failed ({run.returncode}): {(run.stderr or '')[-5000:]}")
    return read_json(output_path)


def retryable_missing_near_probe(prior_manifest: dict[str, Any], prior_preflight: dict[str, Any]) -> bool:
    """Permit one same-vector rerender only when the first attempt omitted a required measured value."""
    if prior_manifest.get("outcome") != "BLOCKED_STAGE2N_011_EQUIVALENCE":
        return False
    if prior_preflight.get("candidateId") != CANDIDATE_ID or prior_preflight.get("parameters") != EXPECTED_CANDIDATE:
        return False
    if prior_preflight.get("productionSimd") is not True or prior_preflight.get("stage2mExportsAbsent") is not True:
        return False
    summary = prior_preflight.get("preflight", {})
    if summary.get("cellCount") != 18 or summary.get("midi21", {}).get("constrainedNearFundamentalCents") is not None:
        return False
    delta = summary.get("equivalence", {})
    return (abs(float(delta.get("midi45SpanDeltaDb", math.inf))) <= REPRO_TOLERANCE_DB
            and abs(float(delta.get("c8ShapeViolationDeltaDb", math.inf))) <= REPRO_TOLERANCE_DB
            and abs(float(delta.get("midi21EstimatorDeltaCents", math.inf))) <= PITCH_TOLERANCE_CENTS)


def run_execute(evidence: dict[str, Any], identity: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    candidate_file = RESULTS / "candidates" / f"{CANDIDATE_ID}.json"
    preflight_file = RESULTS / f"{CANDIDATE_ID}-preflight.json"
    candidate_scratch = SCRATCH / CANDIDATE_ID
    existing_result = RESULTS / f"{CANDIDATE_ID}.json"
    active_path = MANIFESTS / "active.json"
    if active_path.is_file() and existing_result.is_file() is False:
        previous_active = read_json(active_path)
        if previous_active.get("stage2eAttemptStarted") is True:
            raise RuntimeError("BLOCKED_STAGE2N_STAGE2E_ALREADY_STARTED: do not repeat the single full Stage2E evaluation")
    if existing_result.exists():
        prior = read_json(existing_result)
        if prior.get("result") == "COMPLETE" and prior.get("stage2nProvenance", {}).get("evaluatorSha256") == identity["evaluatorSha256"]:
            manifest.update({"status": prior.get("outcome", "REUSED_COMPLETE_RESULT"), "physicalCandidateBudget": {"maximum": 1, "before": 0, "after": 1}, "reused": True, "stage2eCandidateEvaluationCount": 0, "preflightBuildCount": 0, "preflightRenderCount": 0})
            return prior
        raise RuntimeError("BLOCKED_STAGE2N_PARTIAL_OR_MISMATCHED_RESULT: existing candidate identity is incomplete or provenance differs")
    attempt = 1
    preflight_build_root = candidate_scratch
    resume_preflight = False
    if candidate_file.exists() or candidate_scratch.exists() or preflight_file.exists():
        prior_result_path = RESULTS / "stage2n-revision3-result.json"
        prior_result = read_json(prior_result_path) if prior_result_path.is_file() else {}
        prior_preflight_path = RESULTS / f"{CANDIDATE_ID}-preflight.json"
        prior_preflight = read_json(prior_preflight_path) if prior_preflight_path.is_file() else {}
        if not (candidate_file.is_file() and prior_result_path.is_file() and prior_preflight_path.is_file()
                and retryable_missing_near_probe(prior_result, prior_preflight)):
            raise RuntimeError("BLOCKED_STAGE2N_PARTIAL_EXECUTION: incomplete or non-retryable Stage2N artifacts cannot be reused")
        archived = RESULTS / "attempts"
        archived.mkdir(parents=True, exist_ok=True)
        if not (archived / "attempt-01-result.json").exists():
            shutil.copy2(prior_result_path, archived / "attempt-01-result.json")
        if not (archived / "attempt-01-preflight.json").exists():
            shutil.copy2(prior_preflight_path, archived / "attempt-01-preflight.json")
        attempt = 2
        preflight_file = RESULTS / f"{CANDIDATE_ID}-preflight-attempt-{attempt:02d}.json"
        preflight_build_root = SCRATCH / f"{CANDIDATE_ID}-preflight-attempt-{attempt:02d}"
        if preflight_file.is_file() and preflight_build_root.is_dir():
            saved = read_json(preflight_file)
            same_identity = (saved.get("candidateId") == CANDIDATE_ID and saved.get("parameters") == EXPECTED_CANDIDATE
                             and saved.get("sourceRevision") == identity["sourceRevision"]
                             and saved.get("sourceTreeSha256") == identity["sourceTreeSha256"]
                             and saved.get("productionSimd") is True)
            if same_identity:
                resume_preflight = True
            else:
                if not saved.get("preflight", {}).get("equivalence", {}).get("pass"):
                    raise RuntimeError("BLOCKED_STAGE2N_RETRY_PROVENANCE: prior retry is not a complete passing equivalence result")
                if active_path.is_file() and read_json(active_path).get("stage2eAttemptStarted") is True:
                    raise RuntimeError("BLOCKED_STAGE2N_STAGE2E_ALREADY_STARTED: do not repeat the single full Stage2E evaluation")
                shutil.copy2(preflight_file, archived / "attempt-02-preflight.json")
                attempt = 3
                preflight_file = RESULTS / f"{CANDIDATE_ID}-preflight-attempt-{attempt:02d}.json"
                preflight_build_root = SCRATCH / f"{CANDIDATE_ID}-preflight-attempt-{attempt:02d}"
                if preflight_file.exists() or preflight_build_root.exists():
                    raise RuntimeError("BLOCKED_STAGE2N_RETRY_LIMIT: third attempt artifacts already exist")
        elif preflight_file.exists() or preflight_build_root.exists():
            raise RuntimeError("BLOCKED_STAGE2N_RETRY_EXISTS: incomplete retry artifacts cannot be reused")
        candidate = read_json(candidate_file)
        if candidate != {"candidateId": CANDIDATE_ID, "parameters": EXPECTED_CANDIDATE}:
            raise RuntimeError("BLOCKED_STAGE2N_PARTIAL_EXECUTION: preserved candidate file differs")
    else:
        candidate = {"candidateId": CANDIDATE_ID, "parameters": EXPECTED_CANDIDATE}
        write_json(candidate_file, candidate)
    manifest["startedAt"] = datetime.now(timezone.utc).isoformat()
    manifest["preflightBuildCount"] = attempt
    manifest["preflightRenderCount"] = 18 * attempt
    manifest["preflightAttempt"] = attempt
    if attempt == 2:
        manifest["retryReason"] = "Attempt 1 omitted the required constrained near-fundamental measurement; all other Stage2M 011 targets reproduced within tolerance. Same candidate vector and model revision are retained."
    write_json(MANIFESTS / "active.json", manifest)
    preflight = read_json(preflight_file) if resume_preflight else run_preflight(candidate_file, preflight_build_root, preflight_file)
    if preflight.get("candidateId") != CANDIDATE_ID or preflight.get("parameters") != EXPECTED_CANDIDATE or preflight.get("productionSimd") is not True:
        raise RuntimeError("BLOCKED_STAGE2N_PRELIGHT_PROVENANCE: candidate, parameter, or SIMD identity differs")
    if preflight.get("preflight", {}).get("cellCount") != 18:
        raise RuntimeError("BLOCKED_STAGE2N_REQUIRED_COVERAGE: expected exactly 18 preflight cells")
    manifest["preflight"] = {"cellCount": 18,"pass": bool(preflight["preflight"]["equivalence"]["pass"]),
                             "configSha256": preflight["configSha256"],"wasmSha256": preflight["wasmSha256"],
                             "metrics": {key: preflight["preflight"][key] for key in ("midi45","c8","midi21","equivalence","finite","guardHits","peakWorstDbfs")}}
    if not preflight["preflight"]["equivalence"]["pass"]:
        manifest.update({"status": "BLOCKED_STAGE2N_011_EQUIVALENCE", "outcome": "BLOCKED_STAGE2N_011_EQUIVALENCE",
                         "physicalCandidateBudget": {"maximum": 1, "before": 0, "after": 0},"endedAt": datetime.now(timezone.utc).isoformat()})
        write_json(RESULTS / "stage2n-revision3-result.json", manifest)
        return manifest

    configure_stage2e_paths()
    stage2l.SEARCH_PATH = SEARCH_PATH
    stage2l.STATE_ROOT = STATE
    stage2l.RESULTS = RESULTS
    stage2l.SCRATCH = preflight_build_root
    stage2e.SCRATCH = preflight_build_root
    manifest["stage2eAttemptStarted"] = True
    write_json(MANIFESTS / "active.json", manifest)
    result = stage2e.run_candidate(CANDIDATE_ID, EXPECTED_CANDIDATE, identity)
    if result.get("configSha256") != preflight.get("configSha256") or result.get("wasmSha256") != preflight.get("wasmSha256"):
        raise RuntimeError("BLOCKED_STAGE2N_CANDIDATE_ARTIFACT_MISMATCH: Stage2E did not reuse the preflight config/WASM artifact")
    constraints = validate_constraint_vector(stage2e.stage2e_constraints(
        result["stage1Metrics"], result["stage2Metrics"], result["metrics"]["directProxy"],
        result["heldRelease"], result["localTopology"]))
    loss = float(result["metrics"]["directProxyReferenceFitLoss"])
    if not math.isfinite(loss):
        raise ValueError("Stage2N Stage2E reference-fit loss is non-finite")
    preflight_summary = preflight["preflight"]
    outcome = classify(result, constraints, preflight_summary)
    result.update({"constraints": constraints,"constraintSchema": list(stage2e.STAGE2E_CONSTRAINT_KEYS),
        "constraintSchemaSha256": manifest["constraintSchemaSha256"],"referenceFitLoss": loss,
        "feasible": all(value <= 0 for value in constraints.values()),"outcome": outcome,
        "stage2nProvenance": {"sourceRevision": identity["sourceRevision"],"sourceDirty": identity["sourceDirty"],
          "sourceTreeSha256": identity["sourceTreeSha256"],"configSourceSha256": identity["sourceConfigSha256"],
          "evaluatorSha256": identity["evaluatorSha256"],"searchSpaceSha256": identity["searchSpaceSha256"],
          "subsetSha256": identity["subsetSha256"],"constraintSchemaSha256": manifest["constraintSchemaSha256"],
          "candidateConfigSha256": preflight["configSha256"],"preflightWasmSha256": preflight["wasmSha256"],
          "preflightEquivalent": True,"productionSimd": True,"candidateBudgetBefore": 0,"candidateBudgetAfter": 1,
          "stage2lBudgetBefore": 1,"stage2lBudgetMaximum": 12,"gpsamplerUsed": False}})
    result["stage2nPreflight"] = manifest["preflight"]
    if outcome == "STAGE2N_STAGE2_PASS":
        # Only a fully feasible candidate is baked; the ordinary build and a complete evaluator rerun follow.
        bake = subprocess.run(["rtk", "node", "-e", "const fs=require('fs'); const {writeCandidatePresets,PRESETS_PATH}=require('./wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); writeCandidatePresets(PRESETS_PATH,PRESETS_PATH,p.parameters);",
                              str(candidate_file)], cwd=ROOT, env={**os.environ,"SUPERSYNTH_CALIBRATION_SEARCH_SPACE":str(SEARCH_PATH)}, text=True, capture_output=True)
        if bake.returncode != 0:
            raise RuntimeError(f"Stage2N candidate bake failed: {(bake.stderr or '')[-3000:]}")
        build = subprocess.run(["rtk", "cmake", "-S", "wasm", "-B", "build/wasm",
                                f"-DCMAKE_TOOLCHAIN_FILE={ROOT / 'wasm/cmake/wasm32-clang.cmake'}"], cwd=ROOT, text=True, capture_output=True)
        if build.returncode != 0:
            raise RuntimeError(f"Stage2N ordinary configure failed: {(build.stderr or '')[-3000:]}")
        build = subprocess.run(["rtk", "cmake", "--build", "build/wasm"], cwd=ROOT, text=True, capture_output=True)
        if build.returncode != 0:
            raise RuntimeError(f"Stage2N ordinary build failed: {(build.stderr or '')[-3000:]}")
        baked_identity = source_identity(evidence["searchSpace"])
        baked_identity["oatResultSha256"] = None
        baked_identity["studyName"] = identity["studyName"]
        configure_stage2e_paths()
        stage2e.SCRATCH = SCRATCH / "baked"
        stage2e.RESULTS = RESULTS / "baked"
        baked = stage2e.run_candidate(CANDIDATE_ID, EXPECTED_CANDIDATE, baked_identity)
        baked_constraints = validate_constraint_vector(stage2e.stage2e_constraints(
            baked["stage1Metrics"], baked["stage2Metrics"], baked["metrics"]["directProxy"], baked["heldRelease"], baked["localTopology"]))
        if not all(value <= 0 for value in baked_constraints.values()):
            result["outcome"] = "BLOCKED_STAGE2N_BAKED_MISMATCH"
            result["bakedVerification"] = {"constraints": baked_constraints,"feasible": False}
        else:
            result["outcome"] = "STAGE2_READY_FOR_STAGE3"
            result["bakedVerification"] = {"constraints": baked_constraints,"feasible": True,
                "configSha256": baked.get("configSha256"),"wasmSha256": baked.get("wasmSha256"),"productionSimd": baked.get("productionSimd")}
    result_path = RESULTS / "stage2n-revision3-result.json"
    write_json(result_path, result)
    manifest.update({"status": result["outcome"],"outcome": result["outcome"],"physicalCandidateBudget": {"maximum": 1,"before": 0,"after": 1},
                     "stage2eCandidateEvaluationCount": 1,"referenceFitLoss": loss,"feasible": result["feasible"],
                     "constraints": constraints,"endedAt": datetime.now(timezone.utc).isoformat(),
                     "resultSha256": digest_file(result_path)})
    write_json(MANIFESTS / "active.json", manifest)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--dry-run", action="store_true", help="validate evidence/budgets only; no build or render")
    modes.add_argument("--execute", action="store_true", help="run the single authorized Stage2N candidate")
    args = parser.parse_args()
    if git_head() != "8be863ad7b4afa4101514bf93ee68b1b754a625e":
        raise RuntimeError(f"BLOCKED_STAGE2N_STARTING_HEAD: expected Stage2N base, found {git_head()}")
    evidence = validate_evidence()
    identity = source_identity(evidence["searchSpace"])
    initial_hashes = protected_hashes()
    MANIFESTS.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    manifest = create_manifest("dry-run" if args.dry_run else "execute", git_head(), initial_hashes, evidence, identity)
    if args.dry_run:
        if (RESULTS / "stage2n-revision3-result.json").exists():
            raise RuntimeError("BLOCKED_STAGE2N_ALREADY_COMPLETED: dry-run found an existing Stage2N result; no new evaluation is permitted")
        path = MANIFESTS / "dry-run.json"
        write_json(path, manifest)
        print(json.dumps({"status":"PREFLIGHT_VALIDATED","candidateId":CANDIDATE_ID,"parameters":EXPECTED_CANDIDATE,
            "stage2lBudget":"1/12","stage2nCandidateBudget":"0/1","stage2mMask011Cells":18,
            "builds":0,"physicalRenders":0,"stage2eConstraintCount":len(stage2e.STAGE2E_CONSTRAINT_KEYS),
            "sourceRevision":identity["sourceRevision"],"sourceTreeSha256":identity["sourceTreeSha256"]},sort_keys=True))
        return 0
    before_head = git_head()
    before_source = hash_paths(SOURCE_PATHS)
    before_source_without_preset = hash_paths(tuple(path for path in SOURCE_PATHS if path != ROOT / "wasm/plugins/dsp/super-synth/presets.json"))
    result = run_execute(evidence, identity, manifest)
    after_hashes = protected_hashes()
    after_source = hash_paths(SOURCE_PATHS)
    after_head = git_head()
    allowed_bake = result.get("outcome") in {"STAGE2N_STAGE2_PASS", "STAGE2_READY_FOR_STAGE3", "BLOCKED_STAGE2N_BAKED_MISMATCH"}
    expected_source_hash = before_source_without_preset if allowed_bake else before_source
    after_source_hash = hash_paths(tuple(path for path in SOURCE_PATHS if not (allowed_bake and path == ROOT / "wasm/plugins/dsp/super-synth/presets.json")))
    if before_head != after_head or expected_source_hash != after_source_hash:
        raise RuntimeError("BLOCKED_STAGE2N_SOURCE_CHANGED: source or repository HEAD changed during the run")
    comparable_hashes = {key:value for key,value in initial_hashes.items()
                         if not (allowed_bake and key == "wasm/plugins/dsp/super-synth/presets.json")}
    after_comparable_hashes = {key:value for key,value in after_hashes.items() if key in comparable_hashes}
    if comparable_hashes != after_comparable_hashes:
        raise RuntimeError("BLOCKED_STAGE2N_PROTECTED_EVIDENCE_CHANGED: protected/shared ABI inputs changed during the run")
    status = result.get("outcome", result.get("status"))
    print(json.dumps({"status":status,"candidateId":CANDIDATE_ID,"physicalCandidateBudget":result.get("physicalCandidateBudget",manifest["physicalCandidateBudget"]),
        "feasible":result.get("feasible"),"positiveIndependentConstraints":[key for key,value in result.get("constraints",{}).items() if value>0 and key not in {"stage1_violation","stage2_violation","stage2b_violation"}],
        "protectedHashesUnchanged":True,"sharedAbiHashesUnchanged":True},sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # fail closed; preserve diagnostic detail in private run logs
        print(f"Stage2N blocked: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(2)
