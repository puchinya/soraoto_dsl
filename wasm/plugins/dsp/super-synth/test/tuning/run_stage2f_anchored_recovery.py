"""Requalify historical Stage-2 anchors and run the fixed Stage2F local design."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from constraints import STAGE2E_CONSTRAINT_KEYS, stage2_constraints, stage2e_constraints, stage1_constraints
from stage2f_anchored import (
    ROOT,
    build_anchor_manifest,
    canonical_json,
    canonical_sha256,
    local_points,
    pitch_diagnostics,
    recoverable_seed_qualification,
    verify_manifest,
)

HERE = Path(__file__).resolve().parent
SEARCH = HERE / "stage2e-termination-joint-search-space.json"
SUBSET = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
OUTPUT_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2f-v2"
BUILD_ROOT = ROOT / "build/wasm/calibration/stage2f-v2"
V1_RUN_ID = "20260930T045213Z"
V1_OUTPUT_ROOT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2f"
V1_RUN_PATH = V1_OUTPUT_ROOT / "runs" / f"{V1_RUN_ID}.json"
V1_MANIFEST_PATH = ROOT / ".agent-state/issues/7/stage2f-anchor-manifest.json"
V2_MANIFEST_PATH = OUTPUT_ROOT / "manifests/stage2f-v2-anchor-manifest.json"
NODE_EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs"
HELD_RELEASE_EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js"
STAGE3_EVALUATOR = ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage3-direct-reference.cjs"
PRIOR_PHYSICAL_RENDERS = 3
TOTAL_PHYSICAL_BUDGET = 25
MAX_NEW_EVALUATIONS = 21
DELIVERY_REQUIRED_PATHS = (
    "wasm/plugins/dsp/super-synth/test/tuning/constraints.py",
    "wasm/plugins/dsp/super-synth/test/tuning/run_stage2e_termination_joint.py",
    "wasm/plugins/dsp/super-synth/test/tuning/stage2f_anchored.py",
    "wasm/plugins/dsp/super-synth/test/tuning/run_stage2f_anchored_recovery.py",
    "wasm/plugins/dsp/super-synth/test/tuning/tests/test_stage2f_anchored.py",
    "wasm/plugins/dsp/super-synth/test/tuning/active-search-space.json",
    "wasm/plugins/dsp/super-synth/test/tuning/stage2e-termination-joint-search-space.json",
    "wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.cjs",
    "wasm/plugins/dsp/super-synth/test/tuning/gpsampler-search-space.json",
    "wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.json",
    "wasm/plugins/dsp/super-synth/test/tuning/run_level1_qmc.py",
    "wasm/plugins/dsp/super-synth/test/tuning/README.md",
    "wasm/plugins/dsp/super-synth/test/tuning/requirements.txt",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage2b-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-calibration-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/evaluate-stage3-direct-reference.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/verify-qmc-scratch-equivalence.cjs",
    "wasm/plugins/dsp/super-synth/test/tools/termination-loss-floor-overlay.cjs",
    "wasm/test/helpers/plugin-harness.cjs",
    "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json",
    "wasm/plugins/dsp/super-synth/src/plugin.c",
    "wasm/plugins/dsp/super-synth/presets.json",
    "wasm/cmake/super_synth_metadata.py",
    "wasm/cmake/generate_plugin_metadata.py",
    "wasm/CMakeLists.txt",
    "wasm/cmake/wasm_plugin.cmake",
)
PROMOTION_FAMILIES = {
    "pitch": ("stage2_pitch_violation",),
    "post_attack_shape": ("post_attack_shape_violation_db",),
    "dynamic_span": ("dynamic_span_violation_db",),
    "brightness_direction": ("brightness_direction_violation",),
    "direct_level": ("direct_level_violation_db",),
    "release_tail2": ("release_tail2_min_violation",),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def source_identity() -> dict[str, Any]:
    from run_stage2e_termination_joint import file_identity

    search = read_json(SEARCH)
    identity = file_identity(search)
    identity["stage2eConstraintSchema"] = list(STAGE2E_CONSTRAINT_KEYS)
    identity["stage2eConstraintSchemaSha256"] = sha256(canonical_json(list(STAGE2E_CONSTRAINT_KEYS)))
    identity["stage2fEvaluatorSha256"] = sha256(Path(__file__).read_bytes())
    return identity


def run_external(command: list[str], env: dict[str, str], *, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True, check=False)


def held_release_metrics(candidate_id: str, candidate_build: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    env = os.environ.copy()
    env["SORAOTO_WASM_BUILD_DIR"] = str(candidate_build / "build")
    env["SUPERSYNTH_HELD_RELEASE_ONLY"] = "1"
    env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(SEARCH)
    run = run_external(["rtk", "node", str(HELD_RELEASE_EVALUATOR)], env)
    (candidate_build / "held-release.stdout.log").write_text(run.stdout or "", encoding="utf-8")
    (candidate_build / "held-release.stderr.log").write_text(run.stderr or "", encoding="utf-8")
    marker = next((line[len("HELD_RELEASE_METRICS "):] for line in (run.stdout or "").splitlines()
                   if line.startswith("HELD_RELEASE_METRICS ")), None)
    if marker is None or run.returncode not in (0, 1):
        raise RuntimeError(f"{candidate_id}: held/release metric capture failed ({run.returncode})")
    measured = json.loads(marker)
    held = {key: measured[key] for key in (
        "heldDecayRatio", "releaseTail1", "releaseTail2", "releaseTail3",
        "releaseTail3To2Ratio", "finiteRelease", "stuckVoiceCount",
    )}
    return held, measured


def topology_from_scratch(candidate_build: Path) -> dict[str, float]:
    presets_path = candidate_build / "source/wasm/plugins/dsp/super-synth/presets.json"
    presets = read_json(presets_path)
    preset = presets["concert_grand"]
    return {
        "pianoStringUnison": float(preset["piano_string_unison"]),
        "pianoSoundboardMix": float(preset["piano_soundboard_mix"]),
    }


def evaluate_candidate(candidate_id: str, params: dict[str, Any], stage: str,
                       expected_identity: dict[str, Any], rendered: set[str]) -> dict[str, Any]:
    identity_before = source_identity()
    if identity_before != expected_identity:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED")
    key = canonical_json(params).decode()

    candidate_path = OUTPUT_ROOT / "candidates" / f"{candidate_id}.json"
    result_path = OUTPUT_ROOT / "results" / f"{candidate_id}.json"
    build = BUILD_ROOT / candidate_id
    physical_evaluator_sha = candidate_evaluator_sha256()
    if candidate_path.is_file() and result_path.is_file():
        cached_candidate = read_json(candidate_path)
        cached_result = read_json(result_path)
        if (cached_candidate.get("parameters") != params
                or cached_result.get("parameters") != params
                or cached_result.get("result") != "COMPLETE"
                or cached_result.get("productionSimd") is not True
                or cached_result.get("sourceRevision") != expected_identity.get("sourceRevision")
                or cached_result.get("evaluatorSha256") != physical_evaluator_sha
                or not cached_result.get("subsetSha256")
                or cached_result.get("constraintSchema") != list(STAGE2E_CONSTRAINT_KEYS)):
            raise RuntimeError(f"BLOCKED_CANDIDATE_EVIDENCE_IDENTITY: cached candidate mismatch for {candidate_id}")
        return {**cached_result, "candidateEvidenceReused": True}
    if key in rendered:
        raise RuntimeError("internal error: rendered candidate is missing its reusable result")
    if len(rendered) >= MAX_NEW_EVALUATIONS:
        raise RuntimeError("BLOCKED_PHYSICAL_EVALUATION_BUDGET")
    rendered.add(key)
    write_json(candidate_path, {"candidateId": candidate_id, "parameters": params})
    env = os.environ.copy()
    env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(SEARCH)
    command = ["rtk", "node", str(NODE_EVALUATOR), "--candidate", str(candidate_path), "--subset", str(SUBSET),
               "--build-root", str(build), "--output", str(result_path)]
    started = time.monotonic()
    run = run_external(command, env)
    (build / "stage2e.stdout.log").write_text(run.stdout or "", encoding="utf-8")
    (build / "stage2e.stderr.log").write_text(run.stderr or "", encoding="utf-8")
    if run.returncode != 0 or not result_path.exists():
        raise RuntimeError(f"{candidate_id}: Stage2E candidate evaluator failed ({run.returncode})")
    measured = read_json(result_path)
    if measured.get("result") != "COMPLETE" or measured.get("productionSimd") is not True:
        raise RuntimeError(f"{candidate_id}: incomplete/non-production-SIMD acoustic result")
    direct = measured.get("metrics", {}).get("directProxy")
    if not isinstance(direct, dict):
        raise RuntimeError(f"{candidate_id}: direct Stage2B proxy metrics missing")
    held, held_raw = held_release_metrics(candidate_id, build)
    topology = topology_from_scratch(build)
    constraints = stage2e_constraints(
        measured["stage1Metrics"], measured["stage2Metrics"], direct, held, topology,
    )
    if tuple(constraints) != STAGE2E_CONSTRAINT_KEYS:
        raise RuntimeError("Stage2F output did not preserve the current Stage2E constraint schema")
    for name in STAGE2E_CONSTRAINT_KEYS:
        if not math.isfinite(float(constraints[name])):
            raise RuntimeError(f"{candidate_id}: non-finite constraint {name}")
    pitch = pitch_diagnostics(measured["stage2Metrics"])
    measured.update({
        "stage2fCandidateId": candidate_id,
        "stage2fStage": stage,
        "heldRelease": held,
        "heldReleaseDiagnostics": held_raw,
        "localTopology": topology,
        "constraints": constraints,
        "constraintSchema": list(STAGE2E_CONSTRAINT_KEYS),
        "constraintSchemaSha256": sha256(canonical_json(list(STAGE2E_CONSTRAINT_KEYS))),
        "pitchDiagnostics": pitch,
        "feasible": all(value <= 0.0 for value in constraints.values()),
        "elapsedSeconds": time.monotonic() - started,
    })
    write_json(result_path, measured)
    if source_identity() != expected_identity:
        raise RuntimeError("BLOCKED_SOURCE_CHANGED")
    return measured


def reusable_identity_matches(current: dict[str, Any], previous: dict[str, Any]) -> tuple[bool, list[str]]:
    """Ignore only runner/tree bookkeeping; require the measured black-box identity to match."""
    keys = (
        "sourceRevision", "sourceConfigSha256", "evaluatorSha256", "searchSpaceSha256",
        "oatResultSha256", "subsetSha256", "studyName", "stage2eConstraintSchemaSha256",
    )
    mismatches = [key for key in keys if current.get(key) != previous.get(key)]
    return not mismatches, mismatches


def candidate_evaluator_sha256() -> str:
    qmc_source = (ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs").read_text(encoding="utf-8")
    evaluator_list = re.search(r"const EVALUATOR_FILES = \[(.*?)\];", qmc_source, re.S)
    if evaluator_list is None:
        raise RuntimeError("BLOCKED_ANCHOR_EVIDENCE_IDENTITY: candidate evaluator input list is unavailable")
    candidate_evaluator = hashlib.sha256()
    for relative in sorted(re.findall(r"'([^']+)'", evaluator_list.group(1))):
        candidate_evaluator.update(relative.encode())
        candidate_evaluator.update(b"\0")
        candidate_evaluator.update((ROOT / relative).read_bytes())
        candidate_evaluator.update(b"\0")
    return candidate_evaluator.hexdigest()


def validate_v1_anchor_historical_evidence(
    anchors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Validate saved V1 observations under their recorded identity only.

    This read-only historical check deliberately does not hash the current
    evaluator or compare the saved identity to the current source. Its result
    can never authorize reuse by a current candidate run.
    """
    if not V1_RUN_PATH.is_file() or not V1_MANIFEST_PATH.is_file():
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: v1 manifest or run is missing")
    manifest = read_json(V1_MANIFEST_PATH)
    if (not verify_manifest(manifest)
            or manifest.get("canonicalSha256") != "17a8a88df8b8644bfb497808383c910478544e5939c03a44688f775a420d43e6"):
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: saved v1 manifest hash is invalid")
    run = read_json(V1_RUN_PATH)
    claimed_run_sha = run.get("runSha256")
    if claimed_run_sha != sha256(canonical_json({key: value for key, value in run.items() if key != "runSha256"})):
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: saved v1 run hash is invalid")
    if run.get("anchorManifestSha256") != manifest.get("canonicalSha256"):
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: saved v1 run does not bind its manifest")
    if run.get("physicalRenderCount") != PRIOR_PHYSICAL_RENDERS:
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: saved v1 render accounting differs from 3")

    if not V2_MANIFEST_PATH.is_file():
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: v2 anchor manifest is missing")
    v2_manifest = read_json(V2_MANIFEST_PATH)
    if not verify_manifest(v2_manifest) or v2_manifest.get("parentV1ManifestSha256") != manifest.get("canonicalSha256"):
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: v2 manifest does not validate its saved v1 parent")

    saved_identity = run.get("sourceIdentity")
    if not isinstance(saved_identity, dict) or not saved_identity.get("sourceRevision"):
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: saved v1 source identity is incomplete")
    requested = anchors if anchors is not None else manifest.get("anchors", [])
    manifest_by_id = {row.get("sourceCandidateId"): row for row in manifest.get("anchors", [])}
    run_by_id = {row.get("sourceCandidateId"): row for row in run.get("anchorRequalification", [])}
    v2_by_id = {row.get("historicalResultId"): row for row in v2_manifest.get("anchors", [])}
    expected_ids = {row.get("sourceCandidateId") for row in requested}
    if expected_ids != set(manifest_by_id) or expected_ids != set(run_by_id):
        raise RuntimeError("BLOCKED_HISTORICAL_EVIDENCE: saved v1 anchor set differs")

    observations: dict[str, dict[str, Any]] = {}
    for anchor in requested:
        source_id = anchor["sourceCandidateId"]
        saved_anchor = manifest_by_id[source_id]
        row = run_by_id[source_id]
        result = row.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} result is missing")
        expected_params = dict(saved_anchor["parameters"])
        expected_params["hammer.velocity_hardness_amount"] = 0.0
        expected_params["termination_loss_floor_scale"] = 1.0
        if result.get("parameters") != expected_params or anchor.get("parameters") != saved_anchor.get("parameters"):
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} candidate vector differs")
        v2_anchor = v2_by_id.get(saved_anchor.get("historicalResultId"))
        if (result.get("result") != "COMPLETE" or result.get("productionSimd") is not True
                or result.get("sourceRevision") != saved_identity.get("sourceRevision")
                or result.get("sourceTreeSha256") != saved_identity.get("sourceTreeSha256")
                or result.get("sourceRevision") != saved_anchor.get("sourceRevision")
                or not v2_anchor
                or result.get("evaluatorSha256") != v2_anchor.get("evaluatorSha256")
                or result.get("configSha256") != v2_anchor.get("configSha256")
                or result.get("wasmSha256") != v2_anchor.get("wasmSha256")):
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} saved source/config/WASM/evaluator identity differs")
        if result.get("stage1Result") != "PASS" or result.get("stage2Result") != "PASS":
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} Stage1/2 result is not PASS")
        if result.get("constraintSchema") != list(STAGE2E_CONSTRAINT_KEYS):
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} constraint schema differs")
        recomputed = stage2e_constraints(
            result["stage1Metrics"], result["stage2Metrics"], result["metrics"]["directProxy"],
            result["heldRelease"], result["localTopology"],
        )
        recorded = result.get("constraints", {})
        if tuple(recomputed) != STAGE2E_CONSTRAINT_KEYS or tuple(recorded) != STAGE2E_CONSTRAINT_KEYS:
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} constraint vector shape differs")
        if any(not math.isclose(float(recomputed[key]), float(recorded[key]), rel_tol=0.0, abs_tol=1e-12)
               for key in STAGE2E_CONSTRAINT_KEYS):
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} constraints do not reproduce from saved metrics")

        result_path = ROOT / row.get("resultPath", "")
        if not result_path.is_file() or read_json(result_path) != result:
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} saved result file differs")
        result_sha = sha256(result_path.read_bytes())
        v2_anchor = v2_by_id.get(saved_anchor.get("historicalResultId"))
        if (not v2_anchor or v2_anchor.get("v1ResultPath") != str(result_path.relative_to(ROOT))
                or v2_anchor.get("v1ResultSha256") != result_sha
                or v2_anchor.get("configSha256") != result.get("configSha256")
                or v2_anchor.get("wasmSha256") != result.get("wasmSha256")
                or v2_anchor.get("evaluatorSha256") != result.get("evaluatorSha256")):
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} v2 saved result hash/provenance differs")

        for path_key, hash_key in (("historicalResultPath", "historicalResultSha256"),
                                   ("sourceCandidatePath", "sourceCandidateSha256"),
                                   ("sourceStage2ResultPath", "sourceStage2ResultSha256")):
            evidence_path = ROOT / saved_anchor.get(path_key, "")
            if (not saved_anchor.get(path_key) or not evidence_path.is_file()
                    or sha256(evidence_path.read_bytes()) != saved_anchor.get(hash_key)):
                raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} {path_key} hash differs")
        historical_result = read_json(ROOT / saved_anchor["historicalResultPath"])
        historical_candidate = read_json(ROOT / saved_anchor["sourceCandidatePath"])
        historical_stage2 = read_json(ROOT / saved_anchor["sourceStage2ResultPath"])
        historical_stage2_result = historical_stage2.get("result", {})
        if (historical_candidate.get("parameters") != saved_anchor.get("parameters")
                or historical_result.get("parameters") != saved_anchor.get("parameters")
                or historical_result.get("sourceRevision") != saved_anchor.get("sourceRevision")
                or historical_result.get("sourceTreeSha256") != saved_anchor.get("historicalSourceTreeSha256")
                or historical_result.get("evaluatorSha256") != saved_anchor.get("historicalEvaluatorSha256")
                or historical_result.get("configSha256") != saved_anchor.get("historicalConfigSha256")
                or historical_result.get("wasmSha256") != saved_anchor.get("historicalWasmSha256")
                or historical_stage2_result.get("candidateId") != source_id
                or historical_stage2_result.get("parameters") != saved_anchor.get("parameters")
                or historical_stage2_result.get("sourceRevision") != saved_anchor.get("sourceRevision")):
            raise RuntimeError(f"BLOCKED_HISTORICAL_EVIDENCE: {source_id} original source evidence identity differs")
        observations[source_id] = {"result": result, "resultSha256": result_sha,
                                   "historicalStatus": "HISTORICAL_EVIDENCE_VALID"}
    return {"status": "HISTORICAL_EVIDENCE_VALID", "sourceIdentity": saved_identity,
            "observations": observations}


def load_v1_anchor_observations(
    anchors: list[dict[str, Any]], identity: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Reuse v1 acoustic evidence only when its full evaluator/build provenance still matches."""
    if not V1_RUN_PATH.is_file() or not V1_MANIFEST_PATH.is_file():
        raise RuntimeError("BLOCKED_ANCHOR_EVIDENCE_IDENTITY: v1 manifest or run is missing")
    old_manifest = read_json(V1_MANIFEST_PATH)
    if not verify_manifest(old_manifest) or old_manifest.get("canonicalSha256") != "17a8a88df8b8644bfb497808383c910478544e5939c03a44688f775a420d43e6":
        raise RuntimeError("BLOCKED_ANCHOR_EVIDENCE_IDENTITY: v1 manifest changed")
    current_manifest = build_anchor_manifest()
    if not verify_manifest(current_manifest) or current_manifest.get("canonicalSha256") != old_manifest.get("canonicalSha256"):
        raise RuntimeError("BLOCKED_ANCHOR_EVIDENCE_IDENTITY: resolved anchor provenance changed")

    previous = read_json(V1_RUN_PATH)
    compatible, mismatches = reusable_identity_matches(identity, previous.get("sourceIdentity", {}))
    if not compatible:
        raise RuntimeError("BLOCKED_ANCHOR_EVIDENCE_IDENTITY: acoustic identity mismatch: " + ", ".join(mismatches))
    if previous.get("physicalRenderCount") != PRIOR_PHYSICAL_RENDERS:
        raise RuntimeError("BLOCKED_ANCHOR_EVIDENCE_IDENTITY: v1 render accounting differs from 3")
    previous_rows = {row.get("sourceCandidateId"): row for row in previous.get("anchorRequalification", [])}
    if set(previous_rows) != {anchor["sourceCandidateId"] for anchor in anchors}:
        raise RuntimeError("BLOCKED_ANCHOR_EVIDENCE_IDENTITY: v1 anchor result set differs")

    observations: dict[str, dict[str, Any]] = {}
    measured_subset_sha: str | None = None
    candidate_evaluator_sha = candidate_evaluator_sha256()
    for anchor in anchors:
        source_id = anchor["sourceCandidateId"]
        row = previous_rows[source_id]
        result = row.get("result")
        expected_params = dict(anchor["parameters"])
        expected_params["hammer.velocity_hardness_amount"] = 0.0
        expected_params["termination_loss_floor_scale"] = 1.0
        if not isinstance(result, dict) or result.get("parameters") != expected_params:
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} parameter vector mismatch")
        if (result.get("result") != "COMPLETE" or result.get("productionSimd") is not True
                or result.get("sourceRevision") != identity.get("sourceRevision")
                or result.get("evaluatorSha256") != candidate_evaluator_sha
                or not result.get("subsetSha256")
                or not result.get("configSha256") or not result.get("wasmSha256")):
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} build/evaluator provenance mismatch")
        if measured_subset_sha is None:
            measured_subset_sha = result["subsetSha256"]
        elif result["subsetSha256"] != measured_subset_sha:
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} measured subset differs")
        if result.get("stage1Result") != "PASS" or result.get("stage2Result") != "PASS":
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} Stage1/2 result is not PASS")
        if result.get("constraintSchema") != list(STAGE2E_CONSTRAINT_KEYS):
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} Stage2E schema mismatch")

        recomputed = stage2e_constraints(
            result["stage1Metrics"], result["stage2Metrics"], result["metrics"]["directProxy"],
            result["heldRelease"], result["localTopology"],
        )
        recorded = result.get("constraints", {})
        if tuple(recomputed) != STAGE2E_CONSTRAINT_KEYS or tuple(recorded) != STAGE2E_CONSTRAINT_KEYS:
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} constraint vector shape mismatch")
        if any(not math.isclose(float(recomputed[key]), float(recorded[key]), rel_tol=0.0, abs_tol=1e-12)
               for key in STAGE2E_CONSTRAINT_KEYS):
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} stored constraints do not reproduce")
        if result.get("configSha256") != row.get("result", {}).get("configSha256"):
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} config hash mismatch")
        raw_result_path = ROOT / row.get("resultPath", "")
        if not raw_result_path.is_file() or read_json(raw_result_path) != result:
            raise RuntimeError(f"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: {source_id} saved acoustic result differs")
        observations[source_id] = {
            "result": result,
            "resultPath": row.get("resultPath"),
            "resultSha256": sha256(raw_result_path.read_bytes()),
            "rawResultPath": str(raw_result_path.relative_to(ROOT)),
        }
    return observations


def build_v2_manifest(
    base_manifest: dict[str, Any], observations: dict[str, dict[str, Any]], run_id: str,
) -> dict[str, Any]:
    anchors = []
    for anchor in base_manifest["anchors"]:
        evidence = observations[anchor["sourceCandidateId"]]
        result = evidence["result"]
        allowed, status, failures, shortfall = recoverable_seed_qualification(
            anchor["historicalResultId"], result["constraints"], result["localTopology"],
            float(result["heldRelease"]["releaseTail2"]),
        )
        anchors.append({
            **anchor,
            "seedStatus": status,
            "seedQualified": allowed,
            "qualifiedWithReleaseTail2Exception": status == "RECOVERABLE_SEED",
            "releaseTail2": float(result["heldRelease"]["releaseTail2"]),
            "releaseTail2ShortfallFraction": shortfall,
            "seedExclusionReasons": failures,
            "v1ResultPath": evidence["rawResultPath"],
            "v1ResultSha256": evidence["resultSha256"],
            "configSha256": result["configSha256"],
            "wasmSha256": result["wasmSha256"],
            "evaluatorSha256": result["evaluatorSha256"],
        })
    manifest: dict[str, Any] = {
        "schemaVersion": 2,
        "runId": run_id,
        "parentV1ManifestSha256": base_manifest["canonicalSha256"],
        "v1RunId": V1_RUN_ID,
        "acousticReusePolicy": "runner-only changes are excluded; source/config/evaluator/search/OAT/subset/schema/build hashes must match",
        "priorPhysicalRenders": PRIOR_PHYSICAL_RENDERS,
        "maximumNewPhysicalRenders": MAX_NEW_EVALUATIONS,
        "maximumCumulativePhysicalRenders": PRIOR_PHYSICAL_RENDERS + MAX_NEW_EVALUATIONS,
        "anchors": anchors,
    }
    manifest["canonicalSha256"] = canonical_sha256(manifest)
    return manifest


def family_pass(constraints: dict[str, float], family: str) -> bool:
    return all(float(constraints[key]) <= 0.0 for key in PROMOTION_FAMILIES[family])


def no_feasible_classification(rows: list[dict[str, Any]]) -> tuple[str, dict[str, dict[str, bool]]]:
    by_anchor: dict[str, dict[str, bool]] = {}
    for row in rows:
        by_anchor.setdefault(row["anchorId"], {family: False for family in PROMOTION_FAMILIES})
        constraints = row.get("constraints", row.get("result", {}).get("constraints", {}))
        if not constraints:
            raise ValueError(f"{row.get('candidateId', 'candidate')}: Pareto row has no measured constraints")
        for family in PROMOTION_FAMILIES:
            by_anchor[row["anchorId"]][family] |= family_pass(constraints, family)
    any_pass = {family: any(values[family] for values in by_anchor.values()) for family in PROMOTION_FAMILIES}
    if all(any_pass.values()):
        classification = "COUPLED_FEASIBILITY_INTERSECTION_MISSING"
    elif not any_pass["pitch"]:
        classification = "PITCH_PRESERVATION_LOST"
    elif not any_pass["post_attack_shape"]:
        classification = "POST_ATTACK_STILL_UNRESOLVED"
    elif not any_pass["dynamic_span"]:
        classification = "DYNAMIC_SPAN_STILL_UNRESOLVED"
    else:
        classification = "MULTIPLE_FAMILIES_UNRESOLVED"
    return classification, by_anchor


def promote_stage3(rows: list[dict[str, Any]], identity: dict[str, Any]) -> list[dict[str, Any]]:
    feasible = [row for row in rows if row["result"]["feasible"]]
    feasible.sort(key=lambda row: (
        float(row["result"]["metrics"]["directProxyReferenceFitLoss"]),
        max(float(v) for v in row["result"]["constraints"].values()),
        sum(float(v) > -0.1 for v in row["result"]["constraints"].values()),
        row["anchorId"], row["candidateId"],
    ))
    selected: list[dict[str, Any]] = []
    represented: set[str] = set()
    for row in feasible:
        if len(selected) == 3:
            break
        if row["anchorId"] in represented and any(item["anchorId"] not in represented for item in feasible):
            continue
        selected.append(row)
        represented.add(row["anchorId"])

    results = []
    for row in selected:
        candidate_path = OUTPUT_ROOT / "candidates" / f"{row['candidateId']}.json"
        stage3_result = OUTPUT_ROOT / "results" / f"{row['candidateId']}.stage3.json"
        build = BUILD_ROOT / f"{row['candidateId']}-stage3"
        command = ["rtk", "node", str(STAGE3_EVALUATOR), "--candidate", str(candidate_path),
                   "--build-root", str(build), "--output", str(stage3_result)]
        env = os.environ.copy(); env["SUPERSYNTH_CALIBRATION_SEARCH_SPACE"] = str(SEARCH)
        if source_identity() != identity:
            raise RuntimeError("BLOCKED_SOURCE_CHANGED")
        run = run_external(command, env)
        (build / "stage3.stdout.log").write_text(run.stdout or "", encoding="utf-8")
        (build / "stage3.stderr.log").write_text(run.stderr or "", encoding="utf-8")
        if run.returncode != 0 or not stage3_result.exists():
            raise RuntimeError(f"{row['candidateId']}: Stage 3 evaluator failed")
        outcome = read_json(stage3_result)
        results.append({"candidateId": row["candidateId"], "anchorId": row["anchorId"], "result": outcome})
    return results


def completed_v2_vectors(anchors: list[dict[str, Any]], identity: dict[str, Any]) -> set[str]:
    """Reconstruct already consumed v2 renders after interruption without rerendering."""
    completed: set[str] = set()
    measured_subset_sha: str | None = None
    physical_evaluator_sha = candidate_evaluator_sha256()
    for anchor in anchors:
        if not anchor.get("seedQualified"):
            continue
        for point in local_points(anchor):
            params = {key: value for key, value in point.items() if key != "point"}
            candidate_id = f"stage2f-{anchor['sourceCandidateId']}-{point['point']}"
            candidate_path = OUTPUT_ROOT / "candidates" / f"{candidate_id}.json"
            result_path = OUTPUT_ROOT / "results" / f"{candidate_id}.json"
            if not candidate_path.exists() and not result_path.exists():
                continue
            if not candidate_path.is_file() or not result_path.is_file():
                continue
            candidate, result = read_json(candidate_path), read_json(result_path)
            if (candidate.get("parameters") != params or result.get("parameters") != params
                    or result.get("result") != "COMPLETE" or result.get("productionSimd") is not True
                    or result.get("sourceRevision") != identity.get("sourceRevision")
                    or result.get("evaluatorSha256") != physical_evaluator_sha
                    or not result.get("subsetSha256")
                    or result.get("constraintSchema") != list(STAGE2E_CONSTRAINT_KEYS)
                    or len(result.get("constraints", {})) != len(STAGE2E_CONSTRAINT_KEYS)):
                raise RuntimeError(f"BLOCKED_CANDIDATE_EVIDENCE_IDENTITY: saved v2 candidate mismatch for {candidate_id}")
            if measured_subset_sha is None:
                measured_subset_sha = result["subsetSha256"]
            elif result["subsetSha256"] != measured_subset_sha:
                raise RuntimeError(f"BLOCKED_CANDIDATE_EVIDENCE_IDENTITY: inconsistent measured subset for {candidate_id}")
            completed.add(canonical_json(params).decode())
    return completed


def run(args: argparse.Namespace) -> dict[str, Any]:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    identity = source_identity()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    base_manifest = build_anchor_manifest()
    observations = load_v1_anchor_observations(base_manifest["anchors"], identity)
    manifest = build_v2_manifest(base_manifest, observations, run_id)
    if not verify_manifest(manifest):
        raise RuntimeError("Stage2F v2 anchor manifest canonical digest verification failed")
    write_json(V2_MANIFEST_PATH, manifest)
    rendered = completed_v2_vectors(manifest["anchors"], identity)
    resumed_physical_renders = len(rendered)
    summary: dict[str, Any] = {
        "schemaVersion": 2,
        "runId": run_id,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "anchorManifestPath": str(V2_MANIFEST_PATH.relative_to(ROOT)),
        "anchorManifestSha256": manifest["canonicalSha256"],
        "parentV1ManifestPath": str(V1_MANIFEST_PATH.relative_to(ROOT)),
        "parentV1ManifestSha256": base_manifest["canonicalSha256"],
        "parentV1RunPath": str(V1_RUN_PATH.relative_to(ROOT)),
        "parentV1RunId": V1_RUN_ID,
        "sourceIdentity": identity,
        "physicalEvaluationBudget": TOTAL_PHYSICAL_BUDGET,
        "priorPhysicalRenderCount": PRIOR_PHYSICAL_RENDERS,
        "maximumNewPhysicalRenders": MAX_NEW_EVALUATIONS,
        "reservedUnusedPhysicalRenders": TOTAL_PHYSICAL_BUDGET - PRIOR_PHYSICAL_RENDERS - MAX_NEW_EVALUATIONS,
        "physicalRenderCount": 0,
        "resumedPhysicalRenderCount": resumed_physical_renders,
        "freshPhysicalRenderCount": 0,
        "cumulativePhysicalRenderCount": PRIOR_PHYSICAL_RENDERS,
        "deduplicatedReuseCount": 0,
        "cachedCandidateReuseCount": 0,
        "constraintSchema": list(STAGE2E_CONSTRAINT_KEYS),
        "anchorRequalification": [],
        "localCandidates": [],
        "stage3": [],
        "stopReason": None,
    }
    eligible: list[dict[str, Any]] = []

    for anchor in manifest["anchors"]:
        evidence = observations[anchor["sourceCandidateId"]]
        result = evidence["result"]
        passes = bool(anchor["seedQualified"])
        failures = list(anchor["seedExclusionReasons"])
        row = {
            "historicalResultId": anchor["historicalResultId"],
            "sourceCandidateId": anchor["sourceCandidateId"],
            "sourceStage2TrialId": anchor["sourceStage2TrialId"],
            "parameters": anchor["parameters"],
            "status": anchor["seedStatus"],
            "seedQualified": passes,
            "qualifiedWithReleaseTail2Exception": anchor["qualifiedWithReleaseTail2Exception"],
            "releaseTail2": anchor["releaseTail2"],
            "releaseTail2ShortfallFraction": anchor["releaseTail2ShortfallFraction"],
            "acousticEvidenceReused": True,
            "exclusionReasons": failures,
            "resultPath": evidence["rawResultPath"],
            "resultSha256": evidence["resultSha256"],
            "result": result,
        }
        summary["anchorRequalification"].append(row)
        if passes:
            eligible.append(anchor)
    if not eligible:
        summary["stopReason"] = "BLOCKED_NO_RECOVERABLE_SEED"
    else:
        feasible_vectors: set[str] = set()
        seen_vectors: dict[str, dict[str, Any]] = {}
        for anchor in eligible:
            for point in local_points(anchor):
                if len(feasible_vectors) >= 3:
                    break
                params = {key: value for key, value in point.items() if key != "point"}
                candidate_id = f"stage2f-{anchor['sourceCandidateId']}-{point['point']}"
                key = canonical_json(params).decode()
                if key in seen_vectors:
                    summary["deduplicatedReuseCount"] += 1
                    prior = seen_vectors[key]
                    summary["localCandidates"].append({
                        "anchorId": anchor["sourceCandidateId"], "candidateId": candidate_id,
                        "point": point["point"], "parameterKey": key, "reusedCandidateId": prior["candidateId"],
                        "result": prior["result"],
                    })
                    if prior["result"]["feasible"]:
                        feasible_vectors.add(key)
                    continue
                result = evaluate_candidate(candidate_id, params, "local_design", identity, rendered)
                row = {
                    "anchorId": anchor["sourceCandidateId"], "candidateId": candidate_id,
                    "point": point["point"], "parameterKey": key, "result": result,
                }
                summary["localCandidates"].append(row)
                seen_vectors[key] = row
                if result.get("candidateEvidenceReused"):
                    summary["cachedCandidateReuseCount"] += 1
                if result["feasible"]:
                    feasible_vectors.add(key)
            if len(feasible_vectors) >= 3:
                break
        summary["feasibleCandidateCount"] = len(feasible_vectors)
        if not feasible_vectors:
            summary["stopReason"] = "BLOCKED_ANCHORED_LOCAL_FEASIBILITY"
            summary["noFeasibleClassification"], summary["perAnchorFamilyPass"] = no_feasible_classification(summary["localCandidates"])
        else:
            summary["stopReason"] = "STAGE3_PROMOTION"
            summary["stage3"] = promote_stage3(summary["localCandidates"], identity)
            summary["stage3PassCount"] = sum(item["result"].get("result") == "PASS" for item in summary["stage3"])
            summary["stage4Gate"] = "UNLOCKED" if summary["stage3PassCount"] else "LOCKED_STAGE3_FAILURE"
    summary["physicalRenderCount"] = len(rendered)
    summary["freshPhysicalRenderCount"] = len(rendered) - resumed_physical_renders
    summary["cumulativePhysicalRenderCount"] = PRIOR_PHYSICAL_RENDERS + len(rendered)
    summary["endedAt"] = datetime.now(timezone.utc).isoformat()
    summary["runSha256"] = sha256(canonical_json(summary))
    run_path = OUTPUT_ROOT / "runs" / f"{run_id}.json"
    write_json(run_path, summary)
    return summary


def dry_run() -> dict[str, Any]:
    missing = [relative for relative in DELIVERY_REQUIRED_PATHS if not (ROOT / relative).is_file()]
    if missing:
        raise RuntimeError("BLOCKED_DELIVERY_DEPENDENCY_CLOSURE: missing " + ", ".join(missing))
    return {
        "result": "PASS",
        "stage2fDependencyCount": len(DELIVERY_REQUIRED_PATHS),
        "historicalEvidenceRead": False,
        "productionBuildInvoked": False,
        "physicalRenders": 0,
        "priorPhysicalRenders": PRIOR_PHYSICAL_RENDERS,
        "maximumNewPhysicalRenders": MAX_NEW_EVALUATIONS,
        "maximumCumulativePhysicalRenders": PRIOR_PHYSICAL_RENDERS + MAX_NEW_EVALUATIONS,
        "totalPhysicalBudget": TOTAL_PHYSICAL_BUDGET,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="check committed dependency closure without reading history or rendering")
    parser.add_argument("--resolve-only", action="store_true", help="write/hash anchor manifest without rendering")
    args = parser.parse_args()
    if args.dry_run:
        print(json.dumps(dry_run(), indent=2))
        return 0
    if args.resolve_only:
        identity = source_identity()
        base_manifest = build_anchor_manifest()
        observations = load_v1_anchor_observations(base_manifest["anchors"], identity)
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        manifest = build_v2_manifest(base_manifest, observations, run_id)
        if not verify_manifest(manifest):
            raise RuntimeError("Stage2F v2 anchor manifest hash verification failed")
        write_json(V2_MANIFEST_PATH, manifest)
        print(json.dumps({"anchorManifestPath": str(V2_MANIFEST_PATH), "canonicalSha256": manifest["canonicalSha256"],
                          "anchors": [{"historicalResultId": a["historicalResultId"], "sourceCandidateId": a["sourceCandidateId"],
                                       "seedStatus": a["seedStatus"], "seedQualified": a["seedQualified"],
                                       "releaseTail2": a["releaseTail2"],
                                       "releaseTail2ShortfallFraction": a["releaseTail2ShortfallFraction"]}
                                      for a in manifest["anchors"]]}, indent=2))
        return 0
    result = run(args)
    print(json.dumps({key: result.get(key) for key in (
        "runId", "anchorManifestPath", "anchorManifestSha256", "physicalEvaluationBudget",
        "priorPhysicalRenderCount", "maximumNewPhysicalRenders", "physicalRenderCount",
        "resumedPhysicalRenderCount", "freshPhysicalRenderCount", "cumulativePhysicalRenderCount",
        "deduplicatedReuseCount", "cachedCandidateReuseCount", "feasibleCandidateCount", "stopReason",
        "noFeasibleClassification", "stage3PassCount",
    )}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
