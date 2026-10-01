#!/usr/bin/env python3
"""Read-only Stage2I audit of the existing string-loss equation authority."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze_stage2f_v2_residuals as stage2f  # noqa: E402
import analyze_stage2h_window_span as stage2h  # noqa: E402

PRESETS_REL = Path("wasm/plugins/dsp/super-synth/presets.json")
PLUGIN_REL = Path("wasm/plugins/dsp/super-synth/src/plugin.c")
CAPTURE_REL = Path("wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs")
REGISTRY_REL = Path("wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.json")
STAGE2H_RESULT = ROOT / stage2h.DEFAULT_OUTPUT
DEFAULT_OUTPUT = ROOT / ".agent-state/issues/7/calibration-optuna/stage2i/loss-authority.json"
ANCHORS = ("0001", "0015", "0016")
C8_KEYS_ORDERED = ((108, 14), (108, 31), (108, 40), (108, 61), (105, 14))
PITCH45_CANDIDATES = ("stage2f-split-v3-s2-0015-L1", "stage2f-split-v3-s2-0016-L1")
REFERENCE_FIELDS = (
    "reference_loss_base", "reference_loss_register_start", "reference_loss_register_width",
    "reference_loss_velocity_base", "reference_loss_velocity_scale",
)
AGRAFFE_FIELDS = (
    "lowpass_base", "lowpass_damping_coefficient", "lowpass_key_coefficient",
    "high_frequency_loss_base", "high_frequency_loss_damping_coefficient",
    "high_frequency_loss_key_coefficient", "high_frequency_loss_wound_coefficient",
    "reflection_loss_base", "key_loss_base", "key_loss_coefficient", "damping_base",
    "damping_coefficient", "reference_loss_multiplier", "passive_min", "passive_max",
)
BRIDGE_FIELDS = tuple(field for field in AGRAFFE_FIELDS if field != "reference_loss_multiplier") + (
    "reference_loss_multiplier", "release_loss_multiplier",
)

FORMULA_LINES = (
    "float key=clampf((q->glide_pitch-21.0f)/87.0f,0.0f,1.0f);",
    "float wound=clampf((s->wound_reference_midi-q->glide_pitch)/s->wound_transition_width_midi,0.0f,1.0f);",
    "float ref_loss=s->reference_loss_base*clampf((s->reference_loss_register_start-key)/s->reference_loss_register_width,0.0f,1.0f)*(s->reference_loss_velocity_base-s->reference_loss_velocity_scale*q->velocity);",
    "float release=q->amp_stage==3?(s->release_loss_base+s->release_loss_damping_scale*damping+s->release_loss_key_scale*key):0.0f;",
    "float aa=clampf(ag->lowpass_base-ag->lowpass_damping_coefficient*damping-ag->lowpass_key_coefficient*key,ag->passive_min,ag->passive_max);",
    "float hf_a=ag->high_frequency_loss_base+ag->high_frequency_loss_damping_coefficient*damping+ag->high_frequency_loss_key_coefficient*key+wound*ag->high_frequency_loss_wound_coefficient;",
    "float loss_a=clampf(ag->reflection_loss_base-(ag->key_loss_base+ag->key_loss_coefficient*key)*(ag->damping_base+ag->damping_coefficient*damping)-ref_loss*ag->reference_loss_multiplier,ag->passive_min,ag->passive_max);",
    "float ab=clampf(bt->lowpass_base-bt->lowpass_damping_coefficient*damping-bt->lowpass_key_coefficient*key,bt->passive_min,bt->passive_max);",
    "float hf_b=bt->high_frequency_loss_base+bt->high_frequency_loss_damping_coefficient*damping+bt->high_frequency_loss_key_coefficient*key+wound*bt->high_frequency_loss_wound_coefficient;",
    "float loss_b=clampf(bt->reflection_loss_base-(bt->key_loss_base+bt->key_loss_coefficient*key)*(bt->damping_base+bt->damping_coefficient*damping)-release*bt->release_loss_multiplier-ref_loss*bt->reference_loss_multiplier,bt->passive_min,bt->passive_max);",
)
HELD_CAPTURE_LINES = (
    "const DURATION_MS = 380;",
    "function render(pitch, velocity, parameters={}, options={}) {",
    "return renderNormalized(pitch,velocity/127,parameters,options);",
    "const events = position===0 ? [{kind:1,noteId:1,pitch,velocity:velocityNormalized,offset:0}] : [];",
)


def fail(message: str, path: Path | None = None) -> None:
    raise stage2f.EvidenceError("BLOCKED_EVIDENCE_IDENTITY", message,
                                stage2f.rel(path) if path is not None else None)


def finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        fail(f"{label} must be finite")
    return float(value)


def close(actual: Any, expected: float, label: str, tolerance: float = 1e-12) -> float:
    value = finite(actual, label)
    if abs(value - expected) > tolerance:
        fail(f"{label} mismatch: delta={value - expected:.12g}")
    return value


def clamp(value: float, lower: float, upper: float) -> float:
    if not (math.isfinite(value) and math.isfinite(lower) and math.isfinite(upper)) or lower > upper:
        fail("clamp input/bounds are invalid")
    return min(max(value, lower), upper)


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_snapshot_unchanged(before: dict[str, str], after: dict[str, str], label: str) -> None:
    if before != after:
        changed = sorted(path for path in set(before) | set(after) if before.get(path) != after.get(path))
        fail(f"{label} protected input hashes changed: {changed[:5]}")


def verify_formula_source(plugin_source: str, capture_source: str) -> str:
    lines = {line.strip() for line in plugin_source.splitlines()}
    missing = [line for line in FORMULA_LINES if line not in lines]
    if missing:
        fail("grand_strings_step loss formula changed; review the equation before attribution")
    missing_capture = [line for line in HELD_CAPTURE_LINES if line not in capture_source]
    if missing_capture:
        fail("Stage2H capture no longer proves held-window velocity normalization")
    return hashlib.sha256("\n".join(FORMULA_LINES + HELD_CAPTURE_LINES).encode()).hexdigest()


def config_values(string_config: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(string_config, dict):
        fail("concert_grand engine_config.string is missing")
    ref = {name: finite(string_config.get(name), f"string.{name}") for name in REFERENCE_FIELDS}
    if ref["reference_loss_register_width"] <= 0:
        fail("reference-loss register width must be positive")
    if not isinstance(string_config.get("agraffe"), dict) or not isinstance(string_config.get("bridge_termination"), dict):
        fail("agraffe/bridge termination config missing")
    agraffe = {name: finite(string_config["agraffe"].get(name), f"agraffe.{name}") for name in AGRAFFE_FIELDS}
    bridge = {name: finite(string_config["bridge_termination"].get(name), f"bridge_termination.{name}") for name in BRIDGE_FIELDS}
    for name, row in (("agraffe", agraffe), ("bridge_termination", bridge)):
        if row["passive_min"] > row["passive_max"]:
            fail(f"{name} passive clamp bounds are inverted")
    wound_reference = finite(string_config.get("wound_reference_midi"), "string.wound_reference_midi")
    wound_width = finite(string_config.get("wound_transition_width_midi"), "string.wound_transition_width_midi")
    if wound_width <= 0:
        fail("wound transition width must be positive")
    release = {name: finite(string_config.get(name), f"string.{name}") for name in (
        "release_loss_base", "release_loss_damping_scale", "release_loss_key_scale")}
    return {"reference": ref, "agraffe": agraffe, "bridge": bridge,
            "woundReferenceMidi": wound_reference, "woundTransitionWidthMidi": wound_width,
            "release": release}


def compute_loss_terms(pitch: int, midi_velocity: int, damping_value: Any,
                       values: dict[str, Any], release_active: bool = False) -> dict[str, Any]:
    if isinstance(pitch, bool) or not isinstance(pitch, int) or not 0 <= pitch <= 127:
        fail("pitch must be an integer MIDI note")
    if isinstance(midi_velocity, bool) or not isinstance(midi_velocity, int) or not 1 <= midi_velocity <= 127:
        fail("velocity must be an integer MIDI velocity in 1..127")
    key = clamp((pitch - 21.0) / 87.0, 0.0, 1.0)
    wound = clamp((values["woundReferenceMidi"] - pitch) / values["woundTransitionWidthMidi"], 0.0, 1.0)
    ref = values["reference"]
    gate = clamp((ref["reference_loss_register_start"] - key) / ref["reference_loss_register_width"], 0.0, 1.0)
    velocity_normalized = midi_velocity / 127.0
    velocity_multiplier = ref["reference_loss_velocity_base"] - ref["reference_loss_velocity_scale"] * velocity_normalized
    ref_loss = ref["reference_loss_base"] * gate * velocity_multiplier
    damping = finite(damping_value, "candidate piano_string_damping")
    ag = values["agraffe"]
    aa_raw = ag["lowpass_base"] - ag["lowpass_damping_coefficient"] * damping - ag["lowpass_key_coefficient"] * key
    hf_a = (ag["high_frequency_loss_base"] + ag["high_frequency_loss_damping_coefficient"] * damping
            + ag["high_frequency_loss_key_coefficient"] * key + wound * ag["high_frequency_loss_wound_coefficient"])
    loss_a_raw = (ag["reflection_loss_base"] - (ag["key_loss_base"] + ag["key_loss_coefficient"] * key)
                  * (ag["damping_base"] + ag["damping_coefficient"] * damping)
                  - ref_loss * ag["reference_loss_multiplier"])
    release = 0.0
    if release_active:
        release_cfg = values["release"]
        release = release_cfg["release_loss_base"] + release_cfg["release_loss_damping_scale"] * damping + release_cfg["release_loss_key_scale"] * key
    bt = values["bridge"]
    ab_raw = bt["lowpass_base"] - bt["lowpass_damping_coefficient"] * damping - bt["lowpass_key_coefficient"] * key
    hf_b = (bt["high_frequency_loss_base"] + bt["high_frequency_loss_damping_coefficient"] * damping
            + bt["high_frequency_loss_key_coefficient"] * key + wound * bt["high_frequency_loss_wound_coefficient"])
    loss_b_raw = (bt["reflection_loss_base"] - (bt["key_loss_base"] + bt["key_loss_coefficient"] * key)
                  * (bt["damping_base"] + bt["damping_coefficient"] * damping)
                  - release * bt["release_loss_multiplier"] - ref_loss * bt["reference_loss_multiplier"])
    return {
        "pitch": pitch, "velocity": midi_velocity, "normalizedKey": key, "woundGate": wound,
        "velocityNormalized": velocity_normalized,
        "referenceLossRegisterGate": gate, "referenceLossVelocityMultiplier": velocity_multiplier,
        "referenceLoss": ref_loss, "candidateStringDamping": damping,
        "releaseActive": release_active, "releaseLoss": release,
        "agraffe": {"aaRaw": aa_raw, "aa": clamp(aa_raw, ag["passive_min"], ag["passive_max"]),
                    "hf_a": hf_a, "loss_aRaw": loss_a_raw,
                    "loss_a": clamp(loss_a_raw, ag["passive_min"], ag["passive_max"])},
        "bridge": {"abRaw": ab_raw, "ab": clamp(ab_raw, bt["passive_min"], bt["passive_max"]),
                   "hf_b": hf_b, "loss_bRaw": loss_b_raw,
                   "loss_b": clamp(loss_b_raw, bt["passive_min"], bt["passive_max"])},
    }


def select_stage2h_inputs(report: dict[str, Any]) -> tuple[dict[str, dict[tuple[int, int], dict[str, Any]]], dict[str, dict[str, Any]]]:
    if report.get("status") != "COMPLETE_NUMERIC_WINDOW_SPAN_AUDIT" or report.get("renderCount") != 0:
        fail("Stage2H evidence is incomplete or reports a render")
    c8_rows = report.get("c8WindowAudit", {}).get("cells")
    if not isinstance(c8_rows, list):
        fail("Stage2H C8 cells are missing")
    c8_by_candidate: dict[str, dict[tuple[int, int], dict[str, Any]]] = {}
    required_ids = {f"stage2f-split-v3-s2-{anchor}-L1" for anchor in ANCHORS}
    for row in c8_rows:
        candidate_id = row.get("candidateId")
        if candidate_id not in required_ids:
            continue
        key = (int(row.get("pitch", -1)), int(row.get("velocity", -1)))
        if key in c8_by_candidate.setdefault(candidate_id, {}):
            fail(f"duplicate Stage2H C8 probe for {candidate_id}/{key}")
        c8_by_candidate[candidate_id][key] = row
    if set(c8_by_candidate) != required_ids or any(set(rows) != set(C8_KEYS_ORDERED) for rows in c8_by_candidate.values()):
        fail("Stage2H is missing a required C8/control probe")
    curves = report.get("velocitySpanAudit", {}).get("curves")
    if not isinstance(curves, list):
        fail("Stage2H velocity-span curves are missing")
    curve_by_candidate = {}
    for curve in curves:
        if curve.get("candidateId") not in PITCH45_CANDIDATES or int(curve.get("pitch", -1)) != 45:
            continue
        candidate_id = curve["candidateId"]
        if candidate_id in curve_by_candidate:
            fail(f"duplicate Stage2H pitch45 curve for {candidate_id}")
        layers = curve.get("layers")
        layer_velocities = [int(row.get("velocity", -1)) for row in layers or []]
        if layer_velocities != stage2h.EXPECTED_VELOCITIES:
            fail(f"Stage2H pitch45 curve has incomplete velocity coverage for {candidate_id}")
        for key in ("referenceMinimumVelocities", "referenceMaximumVelocities", "renderMinimumVelocities",
                    "renderMaximumVelocities", "signedSpanDifferenceDb"):
            if key not in curve:
                fail(f"Stage2H pitch45 curve is missing {key}")
        curve_by_candidate[candidate_id] = curve
    if set(curve_by_candidate) != set(PITCH45_CANDIDATES):
        fail("Stage2H is missing a required pitch45 span curve")
    return c8_by_candidate, curve_by_candidate


def verify_stage2h_report(root: Path, candidates: list[dict[str, Any]], evidence: dict[str, Any],
                          fixture: dict[str, Any], subset_keys: set[tuple[int, int]], saved: dict[str, Any]) -> None:
    if not isinstance(saved, dict) or saved.get("schemaVersion") != 1:
        fail("Stage2H output schema is invalid", STAGE2H_RESULT)
    stage2h_evidence = {**evidence, "referenceFixtureSha256": stage2h.sha(root / stage2h.FIXTURE_REL),
                        "subsetSha256": evidence.get("subsetSha256"),
                        "sourceArchiveSha256": fixture["source"]["archiveSha256"]}
    rebuilt = stage2h.build_report(candidates, stage2h_evidence, fixture, subset_keys,
                                   saved.get("originalAudioReanalysis", {}))
    observed = dict(saved)
    rebuilt.pop("generatedAt", None)
    observed.pop("generatedAt", None)
    if stage2f.canonical_sha(rebuilt) != stage2f.canonical_sha(observed):
        fail("Stage2H report does not reconcile with the preserved Stage2F results", STAGE2H_RESULT)


def build_report(root: Path, candidates: list[dict[str, Any]], evidence: dict[str, Any],
                 preset: dict[str, Any], preset_hash: str, formula_hash: str,
                 stage2h_report: dict[str, Any], stage2h_hash: str,
                 plugin_hash: str, registry_hash: str) -> dict[str, Any]:
    config = config_values(preset.get("engine_config", {}).get("string", {}))
    preset_damping = finite(preset.get("piano_string_damping"), "preset piano_string_damping")
    c8, span_curves = select_stage2h_inputs(stage2h_report)
    by_candidate = {candidate["candidateId"]: candidate for candidate in candidates}
    loss_config = config

    c8_groups = []
    for anchor in ANCHORS:
        candidate_id = f"stage2f-split-v3-s2-{anchor}-L1"
        if candidate_id not in by_candidate:
            fail(f"Stage2F L1 candidate missing for anchor {anchor}")
        candidate = by_candidate[candidate_id]
        damping = finite(candidate["parameters"].get("piano_string_damping"), "candidate damping")
        ordered = []
        for pitch, velocity in C8_KEYS_ORDERED:
            observed = c8[candidate_id][(pitch, velocity)]
            late = finite(observed.get("lateResidualDb"), "Stage2H lateResidualDb")
            row = {"candidateId": candidate_id, "anchor": anchor, "pitch": pitch, "velocity": velocity,
                   "lateResidualDb": late,
                   "referenceLateRelDb": finite(observed.get("RR_referenceRelativeDb"), "Stage2H reference late"),
                   "renderLateRelDb": finite(observed.get("DR_renderRelativeDb"), "Stage2H render late"),
                   "lossTerms": compute_loss_terms(pitch, velocity, damping, loss_config)}
            ordered.append(row)
        c8_groups.append({"anchor": anchor, "candidateId": candidate_id, "orderedLateResiduals": ordered})

    span_rows = []
    for candidate_id in PITCH45_CANDIDATES:
        candidate = by_candidate.get(candidate_id)
        if candidate is None:
            fail(f"Stage2F L1 candidate missing for pitch45 span: {candidate_id}")
        curve = span_curves[candidate_id]
        damping = finite(candidate["parameters"].get("piano_string_damping"), "candidate pitch45 damping")
        layers = []
        for layer in curve["layers"]:
            velocity = int(layer["velocity"])
            terms = compute_loss_terms(45, velocity, damping, loss_config)
            layers.append({"velocity": velocity,
                           "referenceR3Dbfs": finite(layer.get("R3_reference80_200Dbfs"), "reference R3"),
                           "renderS3Dbfs": finite(layer.get("S3_render80_200Dbfs"), "render S3"),
                           "layerLevelErrorDb": finite(layer.get("layerLevelErrorDb"), "layer level error"),
                           "lossTerms": terms})
        span_rows.append({"candidateId": candidate_id, "anchor": candidate_id.split("-")[-2],
                          "pitch": 45, "candidateStringDamping": damping,
                          "referenceMinimumVelocities": curve["referenceMinimumVelocities"],
                          "referenceMaximumVelocities": curve["referenceMaximumVelocities"],
                          "renderMinimumVelocities": curve["renderMinimumVelocities"],
                          "renderMaximumVelocities": curve["renderMaximumVelocities"],
                          "actualSpanDb": finite(curve.get("actualSpanDb"), "actual span"),
                          "referenceSpanDb": finite(curve.get("referenceSpanDb"), "reference span"),
                          "signedSpanDifferenceDb": finite(curve.get("signedSpanDifferenceDb"), "signed span difference"),
                          "layers": layers})

    c8_gate = c8_groups[1]["orderedLateResiduals"][0]["lossTerms"]
    pitch45_terms = span_rows[0]["layers"]
    pitch45_soft = next(row["lossTerms"]["referenceLoss"] for row in pitch45_terms if row["velocity"] == 14)
    pitch45_hard = next(row["lossTerms"]["referenceLoss"] for row in pitch45_terms if row["velocity"] == 124)
    if c8_gate["normalizedKey"] != 1.0 or c8_gate["referenceLossRegisterGate"] != 0.0 or c8_gate["referenceLoss"] != 0.0:
        fail("current C8 reference-loss gate must evaluate to exactly zero")
    return {
        "schemaVersion": 1, "status": "COMPLETE_LOSS_AUTHORITY_AUDIT",
        "generatedAt": datetime.now(timezone.utc).isoformat(), "renderCount": 0,
        "stage3Or4Run": False, "stage2FeasibilityClaim": False, "acousticCauseProven": False,
        "evidence": {"candidateCount": len(candidates),
                     "stage2fSourceRevision": evidence.get("resultIdentity", {}).get("sourceRevision"),
                     "currentHead": current_head(root), "stage2hStatus": stage2h_report.get("status"),
                     "stage2hSha256": stage2h_hash, "stage2fProtectedFileCount": evidence.get("protectedFileCount"),
                     "formulaSha256": formula_hash, "pluginSourceSha256": plugin_hash,
                     "presetConfigSha256": preset_hash, "parameterRegistrySha256": registry_hash,
                     "subsetSha256": evidence.get("subsetSha256"),
                     "referenceFixtureSha256": evidence.get("referenceFixtureSha256"),
                     "sourceArchiveSha256": evidence.get("sourceArchiveSha256")},
        "configuration": {"presetStringDamping": preset_damping,
                           "referenceLoss": loss_config["reference"],
                           "agraffe": loss_config["agraffe"], "bridgeTermination": loss_config["bridge"],
                           "woundReferenceMidi": loss_config["woundReferenceMidi"],
                           "woundTransitionWidthMidi": loss_config["woundTransitionWidthMidi"],
                           "releaseLoss": loss_config["release"]},
        "c8ReferenceLossAuthority": {"finding": "NO_DIRECT_REFERENCE_LOSS_AUTHORITY_AT_C8",
                                     "normalizedKey": c8_gate["normalizedKey"],
                                     "registerGate": c8_gate["referenceLossRegisterGate"],
                                     "refLossByVelocity": [{"velocity": row["velocity"],
                                         "referenceLossVelocityMultiplier": row["lossTerms"]["referenceLossVelocityMultiplier"],
                                         "referenceLoss": row["lossTerms"]["referenceLoss"]}
                                         for row in c8_groups[1]["orderedLateResiduals"]],
                                     "anchorOrderedLateResiduals": c8_groups,
                                     "interpretation": "The register gate is zero at MIDI 108, so reference_loss_velocity_* cannot directly change the C8 ref_loss term. This is not acoustic-cause proof."},
        "pitch45VelocitySpanAuthority": {"finding": "REFERENCE_LOSS_VELOCITY_MAPPING_ACTIVE_AT_PITCH45",
                                         "normalizedKey": span_rows[0]["layers"][0]["lossTerms"]["normalizedKey"],
                                         "registerGate": span_rows[0]["layers"][0]["lossTerms"]["referenceLossRegisterGate"],
                                         "referenceLossVelocity14": pitch45_soft,
                                         "referenceLossVelocity124": pitch45_hard,
                                         "weakVelocityHasGreaterReferenceLoss": pitch45_soft > pitch45_hard,
                                         "anchorCurves": span_rows,
                                         "interpretation": "The mapping is mathematically active for pitch45 span; this does not prove acoustic causality or identify a corrective parameter."},
        "publicConclusion": "reference_loss_velocity_* is mathematically active for pitch45 span but cannot directly fix C8 under the current register gate. C8 still needs a separate controlled design/render decision among termination, filtering, or board-radiation paths. No production mapping change is approved.",
    }


def current_head(root: Path) -> str:
    result = subprocess.run(["rtk", "git", "rev-parse", "HEAD"], cwd=root,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if result.returncode != 0:
        fail("cannot determine current Git HEAD")
    return result.stdout.strip()


def run(results_root: Path, output: Path) -> dict[str, Any]:
    results_root, output = results_root.resolve(), output.resolve()
    if ROOT.resolve() not in results_root.parents:
        fail("results root must remain inside the repository")
    candidates, evidence, protected, _ = stage2f.validate_evidence(ROOT.resolve(), results_root)
    fixture, _, subset, subset_keys, reference_paths = stage2h.validate_reference_assets(ROOT.resolve())
    stage2h_path = output.parent.parent / "stage2h/window-span-attribution.json"
    if stage2h_path.resolve() != STAGE2H_RESULT.resolve():
        fail("Stage2H input path differs from the preserved report", stage2h_path)
    stage2h_report = stage2f.read_json(stage2h_path)
    evidence = {**evidence, "referenceFixtureSha256": stage2h.sha(ROOT / stage2h.FIXTURE_REL),
                "subsetSha256": subset["subsetSha256"], "sourceArchiveSha256": fixture["source"]["archiveSha256"]}
    verify_stage2h_report(ROOT.resolve(), candidates, evidence, fixture, subset_keys, stage2h_report)
    c8_inputs, pitch45_inputs = select_stage2h_inputs(stage2h_report)
    if len(c8_inputs) != 3 or len(pitch45_inputs) != 2:
        fail("Stage2H candidate/probe coverage is incomplete")

    presets_path, plugin_path = ROOT / PRESETS_REL, ROOT / PLUGIN_REL
    capture_path, registry_path = ROOT / CAPTURE_REL, ROOT / REGISTRY_REL
    presets = stage2f.read_json(presets_path)
    registry = stage2f.read_json(registry_path)
    preset = presets.get("concert_grand")
    if not isinstance(preset, dict):
        fail("concert_grand preset missing", presets_path)
    plugin_source, capture_source = plugin_path.read_text(encoding="utf-8"), capture_path.read_text(encoding="utf-8")
    formula_hash = verify_formula_source(plugin_source, capture_source)
    config_values(preset.get("engine_config", {}).get("string", {}))
    groups = registry.get("groups")
    if not isinstance(groups, list):
        fail("physical parameter registry schema is missing groups", registry_path)
    by_id = {row.get("id"): row for row in groups if isinstance(row, dict)}
    for group_id in ("string-loss-mapping", "agraffe-and-bridge-termination"):
        row = by_id.get(group_id)
        if (not row or row.get("classification") != "FIXED_ARCHITECTURE_MAPPING"
                or row.get("optimizerEligible") is not False):
            fail(f"registry ownership changed for {group_id}", registry_path)

    all_protected = sorted(set(protected + reference_paths + [stage2h_path, presets_path, plugin_path,
                                                              capture_path, registry_path]), key=str)
    before = stage2f.snapshot(all_protected)
    report = build_report(ROOT, candidates, evidence, preset, stage2f.sha(presets_path), formula_hash,
                          stage2h_report, stage2f.sha(stage2h_path), stage2f.sha(plugin_path),
                          stage2f.sha(registry_path))
    report["protectedFileCount"] = len(all_protected)
    report["protectedInputSha256"] = before
    ensure_snapshot_unchanged(before, stage2f.snapshot(all_protected), "during analysis")
    stage2f.ensure_output_safe(output, results_root, all_protected)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + f".tmp-{os.getpid()}")
    temp.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n",
                    encoding="utf-8")
    temp.replace(output)
    if stage2f.snapshot(all_protected) != before:
        output.unlink(missing_ok=True)
        fail("Stage2I protected inputs changed before report publication")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results-root", type=Path, default=ROOT / stage2f.DEFAULT_RESULTS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        report = run(args.results_root, args.output)
        print(json.dumps({"status": report["status"], "candidateCount": report["evidence"]["candidateCount"],
                          "c8Anchors": len(report["c8ReferenceLossAuthority"]["anchorOrderedLateResiduals"]),
                          "pitch45Curves": len(report["pitch45VelocitySpanAuthority"]["anchorCurves"]),
                          "renderCount": report["renderCount"], "protectedFileCount": report["protectedFileCount"],
                          "stage2fSourceRevision": report["evidence"]["stage2fSourceRevision"],
                          "currentHead": report["evidence"]["currentHead"],
                          "output": stage2f.rel(args.output)}))
        return 0
    except stage2f.EvidenceError as exc:
        print(json.dumps({"status": exc.status, "message": str(exc), "path": exc.path}, ensure_ascii=False),
              file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
