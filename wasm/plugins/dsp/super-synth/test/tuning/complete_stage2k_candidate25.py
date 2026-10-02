#!/usr/bin/env python3
"""Complete Stage2E held/release and C8 evidence for immutable candidate 25."""
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
from typing import Any

ROOT = Path(__file__).resolve().parents[6]
TOOLS = ROOT / "wasm/plugins/dsp/super-synth/test/tools"
STAGE2J = ROOT / ".agent-state/issues/7/calibration-optuna/stage2j"
STAGE2K = ROOT / ".agent-state/issues/7/calibration-optuna/stage2k"
RESULT_PATH = STAGE2K / "candidate25-evidence-completion.json"
MANIFEST_PATH = STAGE2K / "manifest.json"
HELD_PARTIAL_PATH = STAGE2K / "held-release.json"
C8_PARTIAL_PATH = STAGE2K / "c8-path-diagnostic.json"
START_HEAD = "e20fd0713e8a50bb08d1b57badf7be524727e7bf"
EXPECTED_CANDIDATE = "stage2j-2ddddab0412a5324"
EXPECTED_SOURCE_REVISION = "3cd14834f224358b1a279f349b7055dbab97a3d4"
EXPECTED_VELOCITIES = [14, 31, 36, 40, 45, 49, 54, 61, 69, 77, 85, 93, 101, 109, 117, 124]
METRIC_DEFINITION = "stage2k-held-release-v1"
MEASUREMENT_TOOL_KEYS = ("metricDefinition", "heldReleaseExtractorSha256", "c8CaptureSha256",
                         "stage3MetricDefinitionSha256")
sys.path.insert(0, str(ROOT / "wasm/plugins/dsp/super-synth/test/tuning"))
from constraints import STAGE2E_CONSTRAINT_KEYS, stage2e_constraints  # noqa: E402


class Stage2KError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def verify_wasm_hash(path: Path, expected: str) -> str:
    if not path.is_file():
        raise Stage2KError("BLOCKED_CANDIDATE25_ARTIFACT_UNAVAILABLE")
    actual = sha256_file(path)
    if actual != expected:
        raise Stage2KError(f"BLOCKED_CANDIDATE25_ARTIFACT_UNAVAILABLE: expected {expected}, got {actual}")
    return actual


def canonical_sha(value: Any) -> str:
    return sha256_bytes(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                 ensure_ascii=False, allow_nan=False).encode())


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Stage2KError(f"BLOCKED_STAGE2K_EVIDENCE: cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise Stage2KError(f"BLOCKED_STAGE2K_EVIDENCE: {path.name} must contain an object")
    return value


def current_head() -> str:
    return subprocess.check_output(["rtk", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def tree_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def validate_expected_identity(ordinary: dict[str, Any], manifest: dict[str, Any],
                               candidate: dict[str, Any], candidate_artifact: dict[str, Any],
                               candidate_build: Path, subset: dict[str, Any]) -> dict[str, Any]:
    if current_head() != START_HEAD:
        raise Stage2KError(f"BLOCKED_START_HEAD: expected {START_HEAD}, got {current_head()}")
    if ordinary.get("candidateId") != EXPECTED_CANDIDATE or manifest.get("candidateId") != EXPECTED_CANDIDATE:
        raise Stage2KError("BLOCKED_CANDIDATE25_IDENTITY: Stage2J candidate id mismatch")
    if manifest.get("physicalBudgetBefore") != 24 or manifest.get("physicalBudgetAfterExecutionStart") != 25:
        raise Stage2KError("BLOCKED_CANDIDATE25_BUDGET: Stage2J budget evidence is not 24 -> 25")
    if manifest.get("physicalCandidateSlotConsumed") is not True:
        raise Stage2KError("BLOCKED_CANDIDATE25_BUDGET: Stage2J does not record the slot as consumed")
    if ordinary.get("sourceRevision") != EXPECTED_SOURCE_REVISION:
        raise Stage2KError("BLOCKED_CANDIDATE25_SOURCE: recorded source revision differs")
    if ordinary.get("productionSimd") is not True or ordinary.get("wasmSha256") is None:
        raise Stage2KError("BLOCKED_CANDIDATE25_SIMD: Stage2J artifact is not identified as production SIMD")
    parameters = ordinary.get("parameters")
    if not isinstance(parameters, dict) or parameters != candidate.get("parameters") or parameters != candidate_artifact.get("parameters"):
        raise Stage2KError("BLOCKED_CANDIDATE25_VECTOR: candidate vector differs across Stage2J evidence")
    candidate_id = ordinary.get("candidateId")
    if candidate_artifact.get("candidateId") != candidate_id:
        raise Stage2KError("BLOCKED_CANDIDATE25_IDENTITY: candidate build descriptor id mismatch")
    for key in ("configSha256", "subsetSha256"):
        if not ordinary.get(key):
            raise Stage2KError(f"BLOCKED_CANDIDATE25_PROVENANCE: missing {key}")
    if ordinary["configSha256"] != candidate_artifact.get("configSha256"):
        raise Stage2KError("BLOCKED_CANDIDATE25_CONFIG: candidate config hash mismatch")
    if ordinary["sourceRevision"] != candidate_artifact.get("sourceRevision"):
        raise Stage2KError("BLOCKED_CANDIDATE25_SOURCE: candidate descriptor revision mismatch")
    if subset.get("subsetSha256") != ordinary["subsetSha256"]:
        raise Stage2KError("BLOCKED_CANDIDATE25_SUBSET: subset hash mismatch")
    if sorted({int(row["velocity"]) for row in subset.get("cells", []) if int(row.get("pitch", -1)) == 45}) != EXPECTED_VELOCITIES:
        raise Stage2KError("BLOCKED_CANDIDATE25_SUBSET: pitch 45 does not contain the required 16 layers")
    wasm = candidate_build / "build/plugins/dsp/super-synth/plugin.wasm"
    wasm_sha = verify_wasm_hash(wasm, ordinary["wasmSha256"])
    source_snapshot = candidate_build / "source"
    if not (source_snapshot / "wasm/plugins/dsp/super-synth/presets.json").is_file():
        raise Stage2KError("BLOCKED_CANDIDATE25_ARTIFACT_UNAVAILABLE: candidate source snapshot is missing")
    protected = manifest.get("protectedInputSha256")
    if not isinstance(protected, dict) or not protected:
        raise Stage2KError("BLOCKED_CANDIDATE25_PROTECTED_INPUTS: Stage2J protected hash inventory is missing")
    changed = []
    for relative, expected_hash in protected.items():
        path = ROOT / relative
        if not path.is_file() or sha256_file(path) != expected_hash:
            changed.append(relative)
    if changed:
        raise Stage2KError(f"BLOCKED_CANDIDATE25_PROTECTED_INPUTS: {changed[:5]}")
    return {
        "candidateId": candidate_id,
        "sourceRevision": ordinary["sourceRevision"],
        "candidateParameters": parameters,
        "configSha256": ordinary["configSha256"],
        "wasmSha256": wasm_sha,
        "subsetSha256": ordinary["subsetSha256"],
        "productionSimd": True,
        "candidateBuildRoot": str(candidate_build),
        "candidateSourceTreeSha256": tree_sha256(source_snapshot),
        "protectedInputCount": len(protected),
        "protectedInputSha256": protected,
    }


def tool_identity() -> dict[str, Any]:
    held = TOOLS / "capture-stage2k-held-release.cjs"
    c8 = TOOLS / "capture-stage2j-c8-path.cjs"
    metrics = TOOLS / "stage3-direct-reference-metrics.cjs"
    if not all(path.is_file() for path in (held, c8, metrics)):
        raise Stage2KError("BLOCKED_STAGE2K_TOOLS: required extractor or metric definition is missing")
    return {
        "metricDefinition": METRIC_DEFINITION,
        "heldReleaseExtractorSha256": sha256_file(held),
        "c8CaptureSha256": sha256_file(c8),
        "stage3MetricDefinitionSha256": sha256_file(metrics),
    }


def measurement_tool_identity_matches(actual: Any, expected: dict[str, Any]) -> bool:
    return isinstance(actual, dict) and all(actual.get(key) == expected.get(key)
                                              for key in MEASUREMENT_TOOL_KEYS)


def run_tool(command: list[str]) -> str:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout)[-3000:]
        raise Stage2KError(f"BLOCKED_STAGE2K_CAPTURE: command failed ({result.returncode}): {detail}")
    return result.stdout.strip()


def check_exports(wasm: Path) -> dict[str, Any]:
    held = run_tool(["rtk", "node", str(TOOLS / "capture-stage2k-held-release.cjs"),
                     "--check-exports", "--wasm", str(wasm)])
    c8 = run_tool(["rtk", "node", str(TOOLS / "capture-stage2j-c8-path.cjs"),
                   "--check-exports", "--wasm", str(wasm)])
    return {"heldRelease": json.loads(held), "c8": json.loads(c8)}


def load_matching_partial(path: Path, acoustic: dict[str, Any], tools: dict[str, Any]) -> dict[str, Any] | None:
    if not path.exists():
        return None
    partial = read_json(path)
    if partial.get("acousticArtifactIdentity") != acoustic:
        raise Stage2KError(f"BLOCKED_STAGE2K_PARTIAL_IDENTITY: {path.name} acoustic artifact mismatch")
    if not measurement_tool_identity_matches(partial.get("measurementToolIdentity"), tools):
        raise Stage2KError(f"BLOCKED_STAGE2K_PARTIAL_TOOL_IDENTITY: {path.name} measurement tool mismatch")
    return partial


def validate_c8_result(value: dict[str, Any], candidate_id: str, wasm_sha: str) -> None:
    expected_names = ["normal", "board_off", "board_off_no_dry_transverse",
                      "board_off_no_dry_bridge", "board_off_no_dry_contact"]
    if value.get("candidateId") != candidate_id or value.get("wasmSha256") != wasm_sha:
        raise Stage2KError("BLOCKED_STAGE2K_C8_IDENTITY: candidate or WASM hash differs")
    if value.get("variantNames") != expected_names or len(value.get("variants", [])) != 5:
        raise Stage2KError("BLOCKED_STAGE2K_C8_COVERAGE: expected exactly five C8 variants")
    if value.get("stage2PromotionEvidence") is not False or value.get("diagnosticOnly") is not True:
        raise Stage2KError("BLOCKED_STAGE2K_C8_PROMOTION: diagnostic variants cannot promote Stage2")
    for expected, actual in zip(expected_names, value["variants"]):
        if actual.get("name") != expected or not math.isfinite(float(actual.get("earlyResidualDb"))) \
                or not math.isfinite(float(actual.get("lateResidualDb"))) \
                or not math.isfinite(float(actual.get("postAttackShapeErrorDb"))):
            raise Stage2KError(f"BLOCKED_STAGE2K_C8_METRICS: invalid variant {expected}")


def combine_constraints(ordinary: dict[str, Any], held: dict[str, Any], source_root: Path) -> dict[str, float]:
    preset_path = source_root / "wasm/plugins/dsp/super-synth/presets.json"
    presets = read_json(preset_path)
    grand = presets.get("concert_grand", {})
    direct = ordinary.get("metrics", {}).get("directProxy")
    if not isinstance(direct, dict):
        raise Stage2KError("BLOCKED_STAGE2K_STAGE2B: direct proxy metrics are missing")
    topology = {
        "pianoStringUnison": grand.get("piano_string_unison"),
        "pianoSoundboardMix": grand.get("piano_soundboard_mix"),
    }
    result = stage2e_constraints(ordinary.get("stage1Metrics", {}), ordinary.get("stage2Metrics", {}),
                                 direct, held, topology)
    if tuple(result) != STAGE2E_CONSTRAINT_KEYS or len(result) != 32:
        raise Stage2KError("BLOCKED_STAGE2K_CONSTRAINT_SCHEMA: expected exact 32-key Stage2E vector")
    if not all(math.isfinite(float(value)) for value in result.values()):
        raise Stage2KError("BLOCKED_STAGE2K_CONSTRAINT_FINITE: non-finite constraint")
    return result


def execute(dry_run: bool) -> dict[str, Any]:
    ordinary_path = STAGE2J / "ordinary-stage2b.json"
    manifest_path = STAGE2J / "manifest.json"
    candidate_path = STAGE2J / "candidate.json"
    subset_path = ROOT / ".agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json"
    ordinary = read_json(ordinary_path)
    manifest = read_json(manifest_path)
    candidate = read_json(candidate_path)
    candidate_build = ROOT / "build/wasm/calibration" / EXPECTED_CANDIDATE
    candidate_artifact_path = candidate_build / "candidate.json"
    candidate_artifact = read_json(candidate_artifact_path)
    subset = read_json(subset_path)
    acoustic = validate_expected_identity(ordinary, manifest, candidate, candidate_artifact,
                                          candidate_build, subset)
    tools = tool_identity()
    wasm = candidate_build / "build/plugins/dsp/super-synth/plugin.wasm"
    exports = check_exports(wasm)
    if dry_run:
        return {"status": "DRY_RUN_PASS", "candidateId": acoustic["candidateId"],
                "acousticArtifactIdentity": {k: v for k, v in acoustic.items() if k != "protectedInputSha256"},
                "measurementToolIdentity": tools, "wasmExports": exports,
                "physicalBudgetBefore": 25, "physicalBudgetAfter": 25,
                "candidateCountDelta": 0, "supplementaryRenderCount": 0}

    STAGE2K.mkdir(parents=True, exist_ok=True)
    if RESULT_PATH.exists():
        result = read_json(RESULT_PATH)
        if result.get("acousticArtifactIdentity") != acoustic or result.get("measurementToolIdentity") != tools:
            raise Stage2KError("BLOCKED_STAGE2K_COMPLETE_IDENTITY: existing completion evidence identity mismatch")
        if result.get("completionStatus") == "COMPLETE" and tuple(result.get("constraints", {})) == STAGE2E_CONSTRAINT_KEYS:
            return {"status": result["stage2Classification"], "reused": True,
                    "physicalBudgetBefore": 25, "physicalBudgetAfter": 25,
                    "candidateCountDelta": 0, "supplementaryRenderCount": result.get("supplementaryRenderCount", 0)}
        raise Stage2KError("BLOCKED_STAGE2K_INCOMPLETE_RESULT: final evidence file exists but is not reusable")

    existing_manifest = read_json(MANIFEST_PATH) if MANIFEST_PATH.exists() else None
    if existing_manifest:
        if existing_manifest.get("acousticArtifactIdentity") != acoustic:
            raise Stage2KError("BLOCKED_STAGE2K_PARTIAL_IDENTITY: prior partial manifest acoustic identity mismatch")
        if not measurement_tool_identity_matches(existing_manifest.get("measurementToolIdentity"), tools):
            raise Stage2KError("BLOCKED_STAGE2K_PARTIAL_TOOL_IDENTITY: prior partial manifest measurement tools mismatch")
    else:
        existing_manifest = {"schemaVersion": 1, "status": "IN_PROGRESS",
                             "acousticArtifactIdentity": acoustic,
                             "measurementToolIdentity": tools,
                             "physicalBudgetBefore": 25, "physicalBudgetAfter": 25,
                             "candidateCountDelta": 0, "supplementaryRenderCount": 0,
                             "startedAt": datetime.now(timezone.utc).isoformat(),
                             "wasmExports": exports}
        write_json(MANIFEST_PATH, existing_manifest)

    def ensure_unchanged() -> None:
        if sha256_file(wasm) != acoustic["wasmSha256"]:
            raise Stage2KError("BLOCKED_CANDIDATE25_ARTIFACT_UNAVAILABLE: WASM changed during Stage2K")
        if tree_sha256(candidate_build / "source") != acoustic["candidateSourceTreeSha256"]:
            raise Stage2KError("BLOCKED_CANDIDATE25_SOURCE_CHANGED: candidate source snapshot changed during measurement")

    held_partial = load_matching_partial(HELD_PARTIAL_PATH, acoustic, tools)
    if held_partial is None:
        ensure_unchanged()
        held_tool = TOOLS / "capture-stage2k-held-release.cjs"
        command = ["rtk", "node", str(held_tool), "--repo-root", str(ROOT),
                   "--candidate-build", str(candidate_build), "--candidate", str(candidate_path),
                   "--output", str(STAGE2K / "held-release.raw.json"),
                   "--expected-wasm-sha256", acoustic["wasmSha256"]]
        stdout = run_tool(command)
        held_raw = read_json(STAGE2K / "held-release.raw.json")
        ensure_unchanged()
        if held_raw.get("candidateId") != acoustic["candidateId"] \
                or held_raw.get("acousticArtifactIdentity", {}).get("wasmSha256") != acoustic["wasmSha256"]:
            raise Stage2KError("BLOCKED_STAGE2K_HELD_IDENTITY: held/release capture does not match candidate 25")
        held_partial = {"acousticArtifactIdentity": acoustic,
                        "measurementToolIdentity": tools,
                        "metrics": held_raw["metrics"],
                        "rawToolResult": held_raw,
                        "stdoutSummary": stdout}
        write_json(HELD_PARTIAL_PATH, held_partial)
        existing_manifest["heldReleaseStatus"] = "COMPLETE"
        existing_manifest["supplementaryRenderCount"] = max(2, int(existing_manifest.get("supplementaryRenderCount", 0)))
        existing_manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
        write_json(MANIFEST_PATH, existing_manifest)
    held_metrics = held_partial.get("metrics")
    required_held = ("heldDecayRatio", "releaseTail1", "releaseTail2", "releaseTail3",
                     "releaseTail3To2Ratio", "finiteRelease", "stuckVoiceCount")
    if not isinstance(held_metrics, dict) or any(key not in held_metrics for key in required_held):
        raise Stage2KError("BLOCKED_STAGE2K_HELD_METRICS: required held/release measurements are missing")

    c8_partial = load_matching_partial(C8_PARTIAL_PATH, acoustic, tools)
    if c8_partial is None:
        ensure_unchanged()
        c8_tool = TOOLS / "capture-stage2j-c8-path.cjs"
        command = ["rtk", "node", str(c8_tool), "--repo-root", str(candidate_build / "source"),
                   "--candidate-build", str(candidate_build), "--candidate", str(candidate_path),
                   "--output", str(STAGE2K / "c8-path-diagnostic.raw.json")]
        stdout = run_tool(command)
        c8_raw = read_json(STAGE2K / "c8-path-diagnostic.raw.json")
        ensure_unchanged()
        validate_c8_result(c8_raw, acoustic["candidateId"], acoustic["wasmSha256"])
        c8_partial = {"acousticArtifactIdentity": acoustic,
                      "measurementToolIdentity": tools,
                      "diagnostics": c8_raw,
                      "stdoutSummary": stdout}
        write_json(C8_PARTIAL_PATH, c8_partial)
        existing_manifest["c8Status"] = "COMPLETE"
        existing_manifest["supplementaryRenderCount"] = 7
        existing_manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
        write_json(MANIFEST_PATH, existing_manifest)
    c8_metrics = c8_partial.get("diagnostics")
    if not isinstance(c8_metrics, dict):
        raise Stage2KError("BLOCKED_STAGE2K_C8_METRICS: C8 diagnostic details are missing")
    validate_c8_result(c8_metrics, acoustic["candidateId"], acoustic["wasmSha256"])

    ensure_unchanged()
    constraints = combine_constraints(ordinary, held_metrics, candidate_build / "source")
    positives = {key: value for key, value in constraints.items() if value > 0.0}
    classification = "STAGE2_CURRENT_HEAD_PASS" if not positives else "STAGE2_CURRENT_HEAD_FAIL"
    stage2k = {
        "schemaVersion": 1,
        "completionStatus": "COMPLETE",
        "stage2Classification": classification,
        "acousticArtifactIdentity": acoustic,
        "measurementToolIdentity": tools,
        "candidateCountDelta": 0,
        "physicalBudgetBefore": 25,
        "physicalBudgetAfter": 25,
        "supplementaryRenderCount": 7,
        "stage2jOrdinaryEvidence": {"candidateId": ordinary["candidateId"],
                                     "stage1Result": ordinary["stage1Result"],
                                     "stage2Result": ordinary["stage2Result"],
                                     "stage2bReached": ordinary["stage2bReached"],
                                     "metrics": ordinary["metrics"],
                                     "measurement": ordinary["measurement"]},
        "heldRelease": held_metrics,
        "c8Diagnostics": c8_metrics,
        "constraintSchema": list(STAGE2E_CONSTRAINT_KEYS),
        "constraintSchemaSha256": canonical_sha(list(STAGE2E_CONSTRAINT_KEYS)),
        "constraints": constraints,
        "positiveConstraints": positives,
        "feasible": not positives,
        "protectedInputCount": acoustic["protectedInputCount"],
        "protectedInputHashesUnchanged": True,
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }
    write_json(RESULT_PATH, stage2k)
    existing_manifest.update({"status": "COMPLETE", "completionStatus": "COMPLETE",
                              "stage2Classification": classification,
                              "resultSha256": canonical_sha(stage2k),
                              "supplementaryRenderCount": 7,
                              "updatedAt": datetime.now(timezone.utc).isoformat()})
    write_json(MANIFEST_PATH, existing_manifest)
    return {"status": classification, "candidateId": acoustic["candidateId"],
            "positiveConstraints": positives, "heldRelease": held_metrics,
            "c8Variants": [row["name"] for row in c8_metrics["variants"]],
            "wasmSha256": acoustic["wasmSha256"], "physicalBudgetBefore": 25,
            "physicalBudgetAfter": 25, "candidateCountDelta": 0,
            "supplementaryRenderCount": 7, "resultPath": str(RESULT_PATH)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = execute(dry_run=args.dry_run)
    except Stage2KError as exc:
        if args.execute:
            STAGE2K.mkdir(parents=True, exist_ok=True)
            manifest = read_json(MANIFEST_PATH) if MANIFEST_PATH.exists() else {"schemaVersion": 1}
            manifest["status"] = str(exc).split(":", 1)[0]
            manifest["failureReason"] = str(exc)
            manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
            write_json(MANIFEST_PATH, manifest)
        print(json.dumps({"status": str(exc).split(":", 1)[0], "message": str(exc),
                          "physicalBudgetBefore": 25, "physicalBudgetAfter": 25,
                          "candidateCountDelta": 0}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
