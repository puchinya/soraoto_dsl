#!/usr/bin/env python3
"""Run the single, budgeted Stage2J current-HEAD C8 path diagnostic."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[6]
HERE = Path(__file__).resolve().parent
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
TOOLS = ROOT / "wasm/plugins/dsp/super-synth/test/tools"
STATE = ROOT / ".agent-state/issues/7/calibration-optuna/stage2j"
BUILD_PARENT = ROOT / "build/wasm/calibration"
HEAD_REQUIRED = "3cd14834f224358b1a279f349b7055dbab97a3d4"
PRIOR_PHYSICAL = 3
PHYSICAL_BUDGET = 25
EXPECTED_VELOCITIES = (14, 31, 36, 40, 45, 49, 54, 61, 69, 77, 85, 93, 101, 109, 117, 124)
L1_IDS = tuple(f"stage2f-split-v3-s2-{suffix}-L1" for suffix in ("0001", "0015", "0016"))
ALLOWED_POSITIVE = {"post_attack_shape_violation_db", "dynamic_span_violation_db"}
SUMMARY_CONSTRAINTS = {"stage1_violation", "stage2_violation", "stage2b_violation"}
PROVENANCE_KEYS = (
    "sourceRevision", "candidateParameters", "evaluatorSha256", "configSha256",
    "subsetSha256", "constraintSchemaSha256", "productionSimdSha256",
    "diagnosticImplementationSha256",
)

sys.path.insert(0, str(TUNING))
import analyze_stage2f_v2_residuals as stage2f  # noqa: E402
import analyze_stage2h_window_span as stage2h  # noqa: E402
import analyze_stage2i_loss_authority as stage2i  # noqa: E402
from constraints import STAGE2E_CONSTRAINT_KEYS, stage2e_constraints  # noqa: E402
from run_stage2f_anchored_recovery import pitch_diagnostics  # noqa: E402


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_sha(value: Any) -> str:
    return sha256_bytes(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False, allow_nan=False).encode())


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                              allow_nan=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def current_head() -> str:
    return subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def held_release_mode_available_in_head() -> bool:
    relative = "wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js"
    source = subprocess.check_output(["rtk", "git", "show", f"HEAD:{relative}"], cwd=ROOT).decode()
    return "SUPERSYNTH_HELD_RELEASE_ONLY" in source and "HELD_RELEASE_METRICS" in source


def current_source_tree_hash() -> str:
    digest = hashlib.sha256()
    for path in sorted((ROOT / "wasm").rglob("*")):
        if path.is_file() and not path.is_symlink():
            digest.update(path.relative_to(ROOT / "wasm").as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def sha_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def evaluator_identity() -> tuple[str, str, str]:
    evaluator_files = (
        "wasm/plugins/dsp/super-synth/test/tuning/run_stage2j_c8_path_diagnostic.py",
        "wasm/plugins/dsp/super-synth/test/tuning/run_stage2f_anchored_recovery.py",
        "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
        "wasm/plugins/dsp/super-synth/test/tuning/stage2f_anchored.py",
        "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
        "wasm/plugins/dsp/super-synth/test/tuning/stage2e-termination-joint-search-space.json",
        "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs",
        "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
        "wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js",
    )
    current_task_files = {
        "wasm/plugins/dsp/super-synth/test/tuning/run_stage2j_c8_path_diagnostic.py",
        "wasm/plugins/dsp/super-synth/test/tools/capture-stage2j-c8-path.cjs",
    }
    values = {}
    for relative in evaluator_files:
        if relative in current_task_files:
            content = (ROOT / relative).read_bytes()
        else:
            content = subprocess.check_output(["rtk", "git", "show", f"HEAD:{relative}"], cwd=ROOT)
        values[relative] = sha256_bytes(content)
    evaluator_sha = canonical_sha(values)
    diagnostic_sha = sha_file(TOOLS / "capture-stage2j-c8-path.cjs")
    simd_identity = canonical_sha({
        "productionSimd": True,
        "buildFlags": "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
        "wasmSha256Source": "stage2-result.wasmSha256",
    })
    return evaluator_sha, diagnostic_sha, simd_identity


def validate_stage2h_i() -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any], dict[str, Any], set[tuple[int, int]]]:
    results_root = (ROOT / stage2f.DEFAULT_RESULTS).resolve()
    candidates, evidence, protected, _ = stage2f.validate_evidence(ROOT.resolve(), results_root)
    fixture, _, subset, subset_keys, reference_paths = stage2h.validate_reference_assets(ROOT.resolve())
    report_path = ROOT / stage2h.DEFAULT_OUTPUT
    if not report_path.is_file():
        raise stage2f.EvidenceError("BLOCKED_STAGE2H_EVIDENCE", "canonical Stage2H report is missing",
                                    stage2f.rel(report_path))
    report = stage2f.read_json(report_path)
    evidence = {**evidence,
                "referenceFixtureSha256": stage2h.sha(ROOT / stage2h.FIXTURE_REL),
                "subsetSha256": subset["subsetSha256"],
                "sourceArchiveSha256": fixture["source"]["archiveSha256"]}
    stage2i.verify_stage2h_report(ROOT.resolve(), candidates, evidence, fixture, subset_keys, report)
    return candidates, evidence, fixture, subset, subset_keys


def _independent_positives(constraints: dict[str, Any]) -> dict[str, float]:
    rejected = ALLOWED_POSITIVE | SUMMARY_CONSTRAINTS
    return {key: float(value) for key, value in constraints.items()
            if key not in rejected and float(value) > 0.0}


def candidate_rank(candidate: dict[str, Any]) -> tuple[int, float, int, float, str]:
    constraints = candidate["raw"]["constraints"]
    span_count = sum(float(row["violationDb"]) > 0.0 for row in candidate["spanRows"])
    post_count = sum(float(row["violationDb"]) > 0.0 for row in candidate["cells"])
    return (span_count, float(constraints["dynamic_span_violation_db"]), post_count,
            float(constraints["post_attack_shape_violation_db"]), candidate["candidateId"])


def rank_l1_candidates(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = {row["candidateId"]: row for row in candidates}
    if set(by_id) < set(L1_IDS):
        raise RuntimeError("BLOCKED_STAGE2F_L1_COVERAGE: one or more required L1 candidates are missing")
    eligible, filtered, rankings = [], [], []
    for candidate_id in L1_IDS:
        candidate = by_id[candidate_id]
        positives = _independent_positives(candidate["raw"]["constraints"])
        entry = {"candidateId": candidate_id, "rankingTuple": list(candidate_rank(candidate)),
                 "independentPositiveConstraints": positives}
        if positives:
            filtered.append({**entry, "filterReason": "positive independent constraints"})
        else:
            rankings.append(entry)
            eligible.append(candidate)
    if not eligible:
        return {"status": "BLOCKED_NO_STAGE2J_DIAGNOSTIC_BASELINE", "originalCandidates": [
            {"candidateId": cid, "rankingTuple": list(candidate_rank(by_id[cid])),
             "independentPositiveConstraints": _independent_positives(by_id[cid]["raw"]["constraints"])}
            for cid in L1_IDS], "filteredCandidates": filtered, "rankedCandidates": rankings,
            "selected": None}
    eligible.sort(key=candidate_rank)
    selected = eligible[0]
    return {"status": "READY", "originalCandidates": [
        {"candidateId": cid, "rankingTuple": list(candidate_rank(by_id[cid])),
         "independentPositiveConstraints": _independent_positives(by_id[cid]["raw"]["constraints"])}
        for cid in L1_IDS], "filteredCandidates": filtered, "rankedCandidates": rankings,
        "selected": {"candidateId": selected["candidateId"],
                     "parameters": selected["raw"]["parameters"],
                     "rankingTuple": list(candidate_rank(selected))}}


def validate_stage2b_pitch45_coverage(subset: dict[str, Any]) -> None:
    cells = [(int(row["pitch"]), int(row["velocity"])) for row in subset.get("cells", [])]
    pitch45 = [velocity for pitch, velocity in cells if pitch == 45]
    if len(pitch45) != len(set(pitch45)) or set(pitch45) != set(EXPECTED_VELOCITIES):
        raise RuntimeError("BLOCKED_STAGE2J_REQUIRED_COVERAGE")


def physical_budget(run: dict[str, Any]) -> tuple[int, int]:
    rendered = run.get("physicalRenderCount")
    if isinstance(rendered, bool) or not isinstance(rendered, int) or rendered < 0:
        raise RuntimeError("BLOCKED_PHYSICAL_BUDGET_PROVENANCE")
    total = PRIOR_PHYSICAL + rendered
    if total > PHYSICAL_BUDGET:
        raise RuntimeError("BLOCKED_PHYSICAL_EVALUATION_BUDGET")
    return total, PHYSICAL_BUDGET


def new_candidate_slot_allowed(physical_count: int) -> bool:
    return physical_count == PHYSICAL_BUDGET - 1


def protected_input_paths() -> list[Path]:
    _, _, validated, _ = stage2f.validate_evidence(ROOT.resolve(), ROOT / stage2f.DEFAULT_RESULTS)
    fixed = [
        ROOT / "wasm/plugins/dsp/super-synth/src/plugin.c",
        ROOT / "wasm/plugins/dsp/super-synth/presets.json",
        ROOT / stage2h.FIXTURE_REL,
        ROOT / stage2h.HASHES_REL,
        ROOT / stage2h.SUBSET_REL,
        ROOT / stage2h.CHECKSUMS_REL,
        ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json",
        ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/run-manifest.json",
        ROOT / stage2f.V2_MANIFEST,
        ROOT / stage2f.V2_RUN,
        ROOT / stage2h.DEFAULT_OUTPUT,
        ROOT / stage2i.DEFAULT_OUTPUT,
        ROOT / "wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.json",
        ROOT / "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
    ]
    for path in sorted(TUNING.glob("*search-space*.json")):
        fixed.append(path)
    fixed.extend([TUNING / "active-search-space.json", TUNING / "gpsampler-search-space.json"])
    return sorted({path.resolve() for path in validated + fixed}, key=str)


def protected_snapshot() -> dict[str, str]:
    return stage2f.snapshot(protected_input_paths())


def compare_provenance(expected: dict[str, Any], actual: dict[str, Any]) -> list[str]:
    return [key for key in PROVENANCE_KEYS
            if expected.get(key) is not None and expected.get(key) != actual.get(key)]


def complete_pair_reusable(manifest: dict[str, Any] | None, result: dict[str, Any] | None,
                           expected: dict[str, Any]) -> bool:
    if not manifest or not result or manifest.get("status") != "COMPLETE" or result.get("result") != "COMPLETE":
        return False
    if manifest.get("resultSha256") != canonical_sha(result):
        return False
    if (manifest.get("candidateId") != result.get("candidateId")
            or result.get("parameters") != expected.get("candidateParameters")
            or (expected.get("candidateId") is not None and result.get("candidateId") != expected["candidateId"])):
        return False
    if compare_provenance(expected, manifest.get("provenance", {})):
        return False
    if compare_provenance(expected, result.get("provenance", {})):
        return False
    return manifest.get("provenance") == result.get("provenance")


def preflight_reusable(manifest: dict[str, Any] | None, expected: dict[str, Any], current: dict[str, Any]) -> bool:
    if not manifest or manifest.get("status") != "PREFLIGHT_READY":
        return False
    return (manifest.get("candidateId") == current.get("candidateId")
            and manifest.get("physicalBudgetBefore") == 24
            and manifest.get("physicalRenderCount") == 0
            and manifest.get("physicalBuildCount") == 0
            and manifest.get("protectedInputSha256") == current.get("protectedInputSha256")
            and not compare_provenance(expected, manifest.get("provenance", {})))


def preflight() -> dict[str, Any]:
    head = current_head()
    if head != HEAD_REQUIRED:
        raise RuntimeError(f"BLOCKED_STARTING_HEAD: expected {HEAD_REQUIRED}, found {head}")
    candidates, evidence, fixture, subset, subset_keys = validate_stage2h_i()
    validate_stage2b_pitch45_coverage(subset)
    selection = rank_l1_candidates(candidates)
    run_path = ROOT / stage2f.V2_RUN
    run = stage2f.read_json(run_path)
    before, maximum = physical_budget(run)
    if before != 24:
        raise RuntimeError(f"BLOCKED_PHYSICAL_BUDGET: expected 24/25 before Stage2J, found {before}/{maximum}")
    subset_path = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
    evaluator_sha, diagnostic_sha, simd_sha = evaluator_identity()
    selected = selection.get("selected")
    candidate_id = "stage2j-" + canonical_sha({
        "head": head, "candidate": selected, "evaluator": evaluator_sha,
        "diagnostic": diagnostic_sha, "subset": subset["subsetSha256"],
    })[:16] if selected else None
    provenance = ({
        "sourceRevision": head,
        "candidateParameters": selected["parameters"],
        "evaluatorSha256": evaluator_sha,
        "configSha256": None,
        "subsetSha256": subset["subsetSha256"],
        "constraintSchemaSha256": canonical_sha(list(STAGE2E_CONSTRAINT_KEYS)),
        "productionSimdSha256": simd_sha,
        "diagnosticImplementationSha256": diagnostic_sha,
    } if selected else {})
    held_mode = held_release_mode_available_in_head()
    blockers = []
    if selection["status"] != "READY":
        blockers.append(selection["status"])
    if not held_mode:
        blockers.append("BLOCKED_HELD_RELEASE_MODE_UNAVAILABLE")
    status = "READY" if not blockers else blockers[0]
    return {
        "schemaVersion": 1, "status": status, "preflightBlockers": blockers,
        "heldReleaseModeAvailableAtHead": held_mode, "candidateId": candidate_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(), "sourceRevision": head,
        "sourceTreeSha256": current_source_tree_hash(), "sourceDirty": bool(
            subprocess.check_output(["rtk", "git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
        "stage2fValidation": "PASS", "stage2hValidation": "PASS", "stage2iValidation": "PASS",
        "stage2fCandidateCount": len(candidates), "stage2hCanonicalStatus": "PASS",
        "stage2hRenderCount": 0, "physicalBudgetBefore": before,
        "physicalBudgetMaximum": maximum, "physicalBudgetAfterDryRun": before,
        "stage2bPitch45Coverage": list(EXPECTED_VELOCITIES), "selection": selection,
        "fixtureSha256": stage2h.sha(ROOT / stage2h.FIXTURE_REL),
        "subsetSha256": subset["subsetSha256"], "constraintSchema": list(STAGE2E_CONSTRAINT_KEYS),
        "protectedInputSha256": protected_snapshot(),
        "provenance": provenance,
        "physicalBuildCount": 0, "physicalRenderCount": 0,
    }


def extract_head_snapshot(head: str, destination: Path) -> None:
    if destination.exists():
        raise RuntimeError("BLOCKED_SNAPSHOT_EXISTS: refusing to overwrite prior Stage2J source snapshot")
    destination.mkdir(parents=True)
    process = subprocess.Popen(["rtk", "git", "archive", "--format=tar", head], cwd=ROOT,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert process.stdout is not None
        with tarfile.open(fileobj=process.stdout, mode="r|*") as archive:
            archive.extractall(destination, filter="data")
    finally:
        stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
        code = process.wait()
    if code != 0:
        shutil.rmtree(destination, ignore_errors=True)
        raise RuntimeError(f"BLOCKED_HEAD_SNAPSHOT: git archive failed ({stderr[-1000:]})")
    subset_source = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
    subset_target = destination / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
    subset_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(subset_source, subset_target)


def run_build_preflight() -> dict[str, Any]:
    base = preflight()
    protected_before = base["protectedInputSha256"]
    build_preflight_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    snapshot_root = BUILD_PARENT / f"stage2j-build-preflight-{build_preflight_id}"
    extract_head_snapshot(base["sourceRevision"], snapshot_root)
    env = os.environ.copy()
    build = snapshot_root / "build/wasm"
    configure = ["rtk", "cmake", "-S", str(snapshot_root / "wasm"), "-B", str(build),
                 f"-DCMAKE_TOOLCHAIN_FILE={snapshot_root}/wasm/cmake/wasm32-clang.cmake",
                 "-DBUILD_TESTING=ON", "-DSORAOTO_FORCE_SCALAR_GRAND=OFF",
                 "-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON"]
    run_command(configure, snapshot_root, env, log=STATE / "build-preflight-configure.log")
    run_command(["rtk", "cmake", "--build", str(build)], snapshot_root, env,
                log=STATE / "build-preflight-build.log")
    wasm = build / "plugins/dsp/super-synth/plugin.wasm"
    node_tool = TOOLS / "capture-stage2j-c8-path.cjs"
    exports = subprocess.run(["rtk", "node", str(node_tool), "--check-exports", "--wasm", str(wasm)],
                             cwd=ROOT, env=env, text=True, capture_output=True, check=False)
    (STATE / "build-preflight-exports.log").write_text(
        (exports.stdout or "") + "\n--- STDERR ---\n" + (exports.stderr or ""), encoding="utf-8")
    if exports.returncode:
        raise RuntimeError("BLOCKED_STAGE2J_DIAGNOSTIC_EXPORTS")
    proof = json.loads(exports.stdout.strip().splitlines()[-1])
    protected_after = protected_snapshot()
    if protected_before != protected_after:
        raise RuntimeError("BLOCKED_PROTECTED_EVIDENCE_CHANGED")
    result = {"status": "PASS", "sourceRevision": base["sourceRevision"],
              "sourceTreeSha256": base["sourceTreeSha256"], "wasmSha256": proof["wasmSha256"],
              "productionSimd": True, "requiredExports": proof["requiredExports"],
              "buildCount": 1, "physicalRenderCount": 0, "physicalBudget": "24/25",
              "protectedInputHashesUnchanged": True}
    write_json(STATE / "build-preflight.json", result)
    return result


def run_command(command: list[str], cwd: Path, env: dict[str, str], *, log: Path,
                allowed_statuses: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[str]:
    process = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True, check=False)
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text((process.stdout or "") + "\n--- STDERR ---\n" + (process.stderr or ""), encoding="utf-8")
    if process.returncode not in allowed_statuses:
        raise RuntimeError(f"Stage2J command failed ({process.returncode}): {command[0]} {command[1] if len(command)>1 else ''}")
    return process


def run_stage2j(execute: bool) -> dict[str, Any]:
    STATE.mkdir(parents=True, exist_ok=True)
    base = preflight()
    manifest_path, result_path = STATE / "manifest.json", STATE / "c8-path-diagnostic.json"
    existing_manifest = stage2f.read_json(manifest_path) if manifest_path.is_file() else None
    existing_result = stage2f.read_json(result_path) if result_path.is_file() else None
    if existing_manifest or existing_result:
        reuse_expected = {**base["provenance"], "candidateId": base["candidateId"]}
        if complete_pair_reusable(existing_manifest, existing_result, reuse_expected):
            return {"status": "REUSED_COMPLETE", "candidateId": base["candidateId"],
                    "physicalBudgetBefore": existing_result["physicalBudgetBefore"],
                    "physicalBudgetAfter": existing_result["physicalBudgetAfter"],
                    "resultPath": str(result_path.relative_to(ROOT))}
        if existing_result is not None or (existing_manifest or {}).get("status") not in (None, "PREFLIGHT_READY"):
            raise RuntimeError("BLOCKED_STAGE2J_EXISTING_PROVENANCE: prior evidence is incomplete or mismatched")
    if execute:
        if not preflight_reusable(existing_manifest, base["provenance"], base):
            raise RuntimeError("BLOCKED_STAGE2J_PREFLIGHT_NOT_CURRENT")
        build_proof_path = STATE / "build-preflight.json"
        if not build_proof_path.is_file():
            raise RuntimeError("BLOCKED_STAGE2J_BUILD_PREFLIGHT_MISSING")
        build_proof = stage2f.read_json(build_proof_path)
        if (build_proof.get("status") != "PASS" or build_proof.get("sourceRevision") != base["sourceRevision"]
                or build_proof.get("sourceTreeSha256") != base["sourceTreeSha256"]
                or build_proof.get("physicalRenderCount") != 0 or build_proof.get("physicalBudget") != "24/25"):
            raise RuntimeError("BLOCKED_STAGE2J_BUILD_PREFLIGHT_IDENTITY")
        if (not existing_manifest or compare_provenance(base["provenance"], existing_manifest.get("provenance", {}))
                or existing_manifest.get("protectedInputSha256") != base.get("protectedInputSha256")):
            raise RuntimeError("BLOCKED_STAGE2J_PREFLIGHT_IDENTITY_CHANGED")
    base["mode"] = "EXECUTE_AUTHORIZED" if execute else "DRY_RUN"
    base["status"] = "PREFLIGHT_READY" if base["status"] == "READY" else base["status"]
    base["sourceRevisionDuringExecution"] = None
    base["completedAt"] = None
    write_json(manifest_path, base)
    if not execute:
        return {"status": base["status"], "candidateId": base["candidateId"],
                "preflightBlockers": base.get("preflightBlockers", []),
                "selected": base["selection"].get("selected"),
                "filteredCandidates": base["selection"]["filteredCandidates"],
                "rankedCandidates": base["selection"]["rankedCandidates"],
                "physicalBudgetBefore": base["physicalBudgetBefore"],
                "physicalBudgetAfter": base["physicalBudgetAfterDryRun"],
                "buildCount": 0, "renderCount": 0,
                "manifestPath": str(manifest_path.relative_to(ROOT))}
    if base["selection"]["status"] != "READY":
        raise RuntimeError("BLOCKED_NO_STAGE2J_DIAGNOSTIC_BASELINE")
    if base["physicalBudgetBefore"] != 24:
        raise RuntimeError("BLOCKED_PHYSICAL_BUDGET")

    selected = base["selection"]["selected"]
    candidate_id = base["candidateId"]
    candidate_path = STATE / "candidate.json"
    stage2b_path = STATE / "ordinary-stage2b.json"
    held_path = STATE / "held-release.json"
    candidate_build = BUILD_PARENT / candidate_id
    source_snapshot = BUILD_PARENT / "stage2j-head-source"
    candidate = {"candidateId": candidate_id, "parameters": selected["parameters"]}
    write_json(candidate_path, candidate)
    snapshot_before = base["protectedInputSha256"]
    base["status"] = "EXECUTION_STARTED"
    base["physicalBudgetAfterExecutionStart"] = 25
    base["executionStartedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(manifest_path, base)
    started = time.monotonic()
    extract_head_snapshot(base["sourceRevision"], source_snapshot)
    child_env = os.environ.copy()
    child_env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(source_snapshot / "wasm/plugins/dsp/super-synth/test/tuning/stage2e-termination-joint-search-space.json")
    subset_path = source_snapshot / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
    stage2b_tool = source_snapshot / "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs"
    run_command(["rtk", "node", str(stage2b_tool), "--candidate", str(candidate_path),
                 "--subset", str(subset_path), "--build-root", str(candidate_build),
                 "--output", str(stage2b_path)], source_snapshot, child_env,
                log=STATE / "stage2b.stdout-stderr.log")
    if current_head() != base["sourceRevision"] or current_source_tree_hash() != base["sourceTreeSha256"]:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED")
    ordinary = stage2f.read_json(stage2b_path)
    if ordinary.get("candidateId") != candidate_id or ordinary.get("parameters") != selected["parameters"]:
        raise RuntimeError("BLOCKED_STAGE2J_CANDIDATE_IDENTITY")
    if ordinary.get("productionSimd") is not True or ordinary.get("stageReached") != 2 or ordinary.get("result") != "COMPLETE":
        raise RuntimeError("BLOCKED_STAGE2J_ORDINARY_STAGE2B_INCOMPLETE")
    if (ordinary.get("sourceRevision") != base["sourceRevision"]
            or ordinary.get("subsetSha256") != base["subsetSha256"]
            or ordinary.get("stage2Metrics", {}).get("measurementInvalidCount") is None):
        raise RuntimeError("BLOCKED_STAGE2J_ORDINARY_PROVENANCE")

    regression = source_snapshot / "wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js"
    held_env = dict(child_env)
    held_env["SORAOTO_WASM_BUILD_DIR"] = str(candidate_build / "build")
    held_env["SUPERSYNTH_HELD_RELEASE_ONLY"] = "1"
    held_run = run_command(["rtk", "node", str(regression)], source_snapshot, held_env,
                           log=STATE / "held-release.stdout-stderr.log", allowed_statuses=(0, 1))
    marker = next((line[len("HELD_RELEASE_METRICS "):] for line in held_run.stdout.splitlines()
                   if line.startswith("HELD_RELEASE_METRICS ")), None)
    if marker is None:
        raise RuntimeError("BLOCKED_STAGE2J_HELD_RELEASE_METRICS")
    held_raw = json.loads(marker)
    held = {key: held_raw[key] for key in (
        "heldDecayRatio", "releaseTail1", "releaseTail2", "releaseTail3",
        "releaseTail3To2Ratio", "finiteRelease", "stuckVoiceCount")}
    config = json.loads((candidate_build / "source/wasm/plugins/dsp/super-synth/presets.json").read_text())
    preset = config["concert_grand"]
    topology = {"pianoStringUnison": float(preset["piano_string_unison"]),
                "pianoSoundboardMix": float(preset["piano_soundboard_mix"])}
    constraints = stage2e_constraints(ordinary["stage1Metrics"], ordinary["stage2Metrics"],
                                      ordinary["metrics"]["directProxy"], held, topology)
    if tuple(constraints) != STAGE2E_CONSTRAINT_KEYS or len(constraints) != 32:
        raise RuntimeError("BLOCKED_STAGE2J_CONSTRAINT_SCHEMA")
    if any(not math.isfinite(float(value)) for value in constraints.values()):
        raise RuntimeError("BLOCKED_STAGE2J_NONFINITE_CONSTRAINT")

    diagnostic_tool = TOOLS / "capture-stage2j-c8-path.cjs"
    diag_path = STATE / "c8-variants.json"
    run_command(["rtk", "node", str(diagnostic_tool), "--repo-root", str(source_snapshot),
                 "--candidate-build", str(candidate_build), "--candidate", str(candidate_path),
                 "--output", str(diag_path)], ROOT, child_env,
                log=STATE / "c8-capture.stdout-stderr.log")
    diagnostics = stage2f.read_json(diag_path)
    if diagnostics.get("wasmSha256") != ordinary.get("wasmSha256"):
        raise RuntimeError("BLOCKED_STAGE2J_DIAGNOSTIC_BUILD_MISMATCH")
    subset_json = stage2f.read_json(subset_path)
    validate_stage2b_pitch45_coverage(subset_json)
    fixture, _, _, _, _ = stage2h.validate_reference_assets(source_snapshot)
    reference45 = [cell for cell in fixture["directCells"] if int(cell["pitch"]) == 45]
    direct = ordinary["directProxy"]
    direct45 = [cell for cell in direct["cells"] if int(cell["pitch"]) == 45]
    if len(direct45) != 16 or len({int(row["velocity"]) for row in direct45}) != 16:
        raise RuntimeError("BLOCKED_STAGE2J_REQUIRED_COVERAGE")
    refs = {int(row["velocity"]): row for row in reference45}
    renders = {int(row["velocity"]): row for row in direct45}
    if set(refs) != set(EXPECTED_VELOCITIES) or set(renders) != set(EXPECTED_VELOCITIES):
        raise RuntimeError("BLOCKED_STAGE2J_REQUIRED_COVERAGE")
    gain = float(direct["sharedGainOffsetDb"])
    layers = []
    for velocity in EXPECTED_VELOCITIES:
        ref_level = float(refs[velocity]["metrics"]["envelopeDbfs"][3])
        render_error = float(renders[velocity]["levelErrorDb"])
        render_level = render_error - gain + ref_level
        layers.append({"velocity": velocity, "reference80_200Dbfs": ref_level,
                       "render80_200Dbfs": render_level, "layerLevelErrorDb": render_level-ref_level})
    ref_levels = [row["reference80_200Dbfs"] for row in layers]
    synth_levels = [row["render80_200Dbfs"] for row in layers]
    ref_span = max(ref_levels)-min(ref_levels)
    synth_span = max(synth_levels)-min(synth_levels)
    signed = synth_span-ref_span
    pitch45 = {"velocities": layers, "referenceSpanDb": ref_span, "synthSpanDb": synth_span,
               "signedSpanDifferenceDb": signed, "absoluteSpanErrorDb": abs(signed),
               "existingViolationDb": abs(signed)-stage2h.SPAN_LIMIT_DB,
               "synthMinimumVelocityLayers": [row["velocity"] for row in layers if row["render80_200Dbfs"] == min(synth_levels)],
               "synthMaximumVelocityLayers": [row["velocity"] for row in layers if row["render80_200Dbfs"] == max(synth_levels)],
               "referenceMinimumVelocityLayers": [row["velocity"] for row in layers if row["reference80_200Dbfs"] == min(ref_levels)],
               "referenceMaximumVelocityLayers": [row["velocity"] for row in layers if row["reference80_200Dbfs"] == max(ref_levels)]}

    expected_provenance = dict(base["provenance"])
    expected_provenance["configSha256"] = ordinary["configSha256"]
    expected_provenance["wasmSha256"] = ordinary["wasmSha256"]
    expected_provenance["candidateBuildSha256"] = ordinary["wasmSha256"]
    ordinary_result = {
        "stage1Result": ordinary["stage1Result"], "stage2Result": ordinary["stage2Result"],
        "stage2bResult": ordinary["result"], "feasible": all(float(v) <= 0 for v in constraints.values()),
        "positiveIndependentConstraints": {k: float(v) for k, v in constraints.items()
                                            if k not in SUMMARY_CONSTRAINTS and float(v) > 0},
        "stage1Metrics": ordinary["stage1Metrics"], "stage2Metrics": ordinary["stage2Metrics"],
        "stage2bMetrics": ordinary["metrics"], "heldRelease": held,
        "heldReleaseDiagnostics": held_raw, "pitchDiagnostics": pitch_diagnostics(ordinary["stage2Metrics"]),
        "directProxy": ordinary["directProxy"],
        "constraints": constraints, "constraintSchema": list(STAGE2E_CONSTRAINT_KEYS),
        "constraintSchemaSha256": expected_provenance["constraintSchemaSha256"],
        "configSha256": ordinary["configSha256"], "wasmSha256": ordinary["wasmSha256"],
        "stage2bEvaluatorSha256": ordinary.get("evaluatorSha256"),
        "sourceRevision": ordinary["sourceRevision"], "sourceDirty": ordinary.get("sourceDirty"),
        "sourceTreeSha256": ordinary.get("sourceTreeSha256"), "subsetSha256": ordinary["subsetSha256"],
        "productionSimd": True,
    }
    result = {
        "schemaVersion": 1, "result": "COMPLETE", "candidateId": candidate_id,
        "sourceRevision": base["sourceRevision"], "sourceDirty": ordinary.get("sourceDirty"),
        "parameters": selected["parameters"], "provenance": expected_provenance,
        "ordinaryEvaluation": ordinary_result, "c8PathDiagnostics": diagnostics["variants"],
        "pitch45VelocitySpan": pitch45, "stage3Eligible": bool(ordinary_result["feasible"]),
        "diagnosticVariantsPromotionEvidence": False, "optimizerObservation": False,
        "physicalBudgetBefore": 24,
        "physicalBudgetAfter": 25, "physicalCandidateOrdinal": "25/25",
        "elapsedSeconds": time.monotonic()-started,
        "protectedInputSha256Before": snapshot_before,
    }
    if current_head() != base["sourceRevision"] or current_source_tree_hash() != base["sourceTreeSha256"]:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED")
    after = protected_snapshot()
    if after != snapshot_before:
        raise RuntimeError("BLOCKED_PROTECTED_EVIDENCE_CHANGED")
    result["protectedInputSha256After"] = after
    result["protectedInputHashesUnchanged"] = True
    result["endedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(result_path, result)
    base.update({"status": "COMPLETE", "completedAt": result["endedAt"],
                 "physicalBudgetAfter": 25, "resultSha256": canonical_sha(result),
                 "sourceRevisionDuringExecution": current_head(),
                 "resultPath": str(result_path.relative_to(ROOT)), "provenance": expected_provenance,
                 "elapsedSeconds": result["elapsedSeconds"]})
    write_json(manifest_path, base)
    return {"status": "COMPLETE", "candidateId": candidate_id,
            "physicalBudgetBefore": 24, "physicalBudgetAfter": 25,
            "feasible": ordinary_result["feasible"],
            "stage3Eligible": result["stage3Eligible"],
            "resultPath": str(result_path.relative_to(ROOT))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="validate and rank with zero builds/renders")
    mode.add_argument("--build-preflight", action="store_true", help="build clean current HEAD and validate diagnostic exports; zero renders")
    mode.add_argument("--execute", action="store_true", help="consume the one remaining Stage2J candidate slot")
    args = parser.parse_args(argv)
    try:
        output = run_build_preflight() if args.build_preflight else run_stage2j(args.execute)
        print(json.dumps(output, ensure_ascii=False, sort_keys=True))
        return 0
    except Exception as exc:  # Fail closed with machine-readable blocker identity.
        print(json.dumps({"status": getattr(exc, "status", "BLOCKED_STAGE2J_PREFLIGHT"),
                          "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
