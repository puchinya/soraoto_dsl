#!/usr/bin/env python3
"""Validate and attribute the fixed Stage2M 2^3 diagnostic matrix."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[6]
STATE = ROOT / ".agent-state/issues/7/calibration-optuna/stage2m-factorial"
DEFAULT_INPUT = STATE / "factorial-result.json"
DEFAULT_OUTPUT = ROOT / "docs/status/plugins/dsp/super-synth/stage2m-factorial-attribution.md"
DEFAULT_DETAILED_OUTPUT = STATE / "stage2m-factorial-attribution-detailed.md"
DEFAULT_STAGE2L = ROOT / ".agent-state/issues/7/calibration-optuna/stage2l-model-revision-2/results/stage2l-r2-candidate-01.json"
EXPECTED_VELOCITIES = [14, 31, 36, 40, 45, 49, 54, 61, 69, 77, 85, 93, 101, 109, 117, 124]
FACTOR_NAMES = ("N", "V", "H")
PITCH_TOLERANCE_CENTS = 15.0
SPAN_LIMIT_DB = 8.0
POST_ATTACK_LIMIT_DB = 10.0
# Stage2H's raw metric comparison is 1e-6; saved Stage2L aggregate metrics
# are rounded to 6 decimal places, so 1e-5 preserves that serialization error.
REPRO_TOLERANCE = 1.1e-5


class EvidenceError(ValueError):
    pass


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise EvidenceError(f"{label} must be a finite number")
    return float(value)


def close(actual: Any, expected: Any, label: str, tolerance: float = REPRO_TOLERANCE) -> float:
    delta = number(actual, label) - number(expected, f"expected {label}")
    if abs(delta) > tolerance:
        raise EvidenceError(f"{label} does not reproduce Stage2L candidate-1 (delta={delta:.9g})")
    return delta


def factorial_effects(values: dict[int, float]) -> dict[str, float]:
    """Difference of coded-product means for all 8 fixed factor combinations."""
    if set(values) != set(range(8)):
        raise EvidenceError("factorial effects require exactly masks 0..7")
    clean = {mask: number(value, f"outcome mask {mask}") for mask, value in values.items()}
    terms = {"N": (1,), "V": (2,), "H": (4,), "N×V": (1, 2),
             "N×H": (1, 4), "V×H": (2, 4), "N×V×H": (1, 2, 4)}
    output: dict[str, float] = {}
    for name, bits in terms.items():
        total = 0.0
        for mask, value in clean.items():
            sign = math.prod(1 if mask & bit else -1 for bit in bits)
            total += sign * value
        output[name] = total / 4.0
    return output


def matched_pairs(values: dict[int, float], factor_bit: int) -> list[dict[str, float | int]]:
    other_bits = [bit for bit in (1, 2, 4) if bit != factor_bit]
    rows = []
    for low in range(8):
        if low & factor_bit:
            continue
        # The pair changes only this factor; positive delta means rev2 - legacy.
        rows.append({"otherMask": low & (other_bits[0] | other_bits[1]),
                     "legacyMask": low, "revision2Mask": low | factor_bit,
                     "revision2MinusLegacy": values[low | factor_bit] - values[low]})
    return rows


def _span_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(rows, key=lambda row: row["velocity"])
    ref = [number(row["reference80to200Dbfs"], "reference MIDI45 level") for row in ordered]
    synth = [number(row["level80to200Dbfs"], "synth MIDI45 level") for row in ordered]
    steps = [{"fromVelocity": ordered[i]["velocity"], "toVelocity": ordered[i + 1]["velocity"],
              "deltaDb": synth[i + 1] - synth[i]} for i in range(len(ordered) - 1)]
    ref_span, synth_span = max(ref) - min(ref), max(synth) - min(synth)
    signed = synth_span - ref_span
    return {
        "referenceSpanDb": ref_span, "synthSpanDb": synth_span,
        "signedSpanDifferenceDb": signed, "absoluteSpanErrorDb": abs(signed),
        "existing8DbViolationDb": abs(signed) - SPAN_LIMIT_DB,
        "synthMinimumVelocities": [ordered[i]["velocity"] for i, level in enumerate(synth) if level == min(synth)],
        "synthMaximumVelocities": [ordered[i]["velocity"] for i, level in enumerate(synth) if level == max(synth)],
        "referenceMinimumVelocities": [ordered[i]["velocity"] for i, level in enumerate(ref) if level == min(ref)],
        "referenceMaximumVelocities": [ordered[i]["velocity"] for i, level in enumerate(ref) if level == max(ref)],
        "adjacentLayerDeltas": steps,
        "largestDownwardAdjacentStepDb": min((row["deltaDb"] for row in steps), default=0.0),
        "monotonicInversionCount": sum(row["deltaDb"] < 0.0 for row in steps),
    }


def validate_and_analyze(result: dict[str, Any], stage2l: dict[str, Any]) -> dict[str, Any]:
    if result.get("schemaVersion") != 1 or result.get("complete") is not True or result.get("diagnosticOnly") is not True:
        raise EvidenceError("Stage2M result is not a complete diagnostic-only schemaVersion=1 artifact")
    if result.get("candidateId") != "stage2l-r2-candidate-01" or result.get("candidateCountDelta") != 0:
        raise EvidenceError("Stage2M must use Stage2L candidate-1 with candidateCountDelta=0")
    if result.get("productionSimd") is not True or result.get("feasible") is not False or result.get("promotionEligible") is not False:
        raise EvidenceError("Stage2M diagnostic result has an invalid production/promotion identity")
    if result.get("candidateBudgetBefore") != 1 or result.get("candidateBudgetAfter") != 1:
        raise EvidenceError("Stage2L candidate budget must remain 1/12")
    if (stage2l.get("candidateId") != result.get("candidateId") or stage2l.get("result") != "COMPLETE"
            or stage2l.get("productionSimd") is not True
            or stage2l.get("parameters") != result.get("parameters")
            or stage2l.get("configSha256") != result.get("configSha256")):
        raise EvidenceError("Stage2L equivalence anchor does not match the Stage2M candidate/source/config identity")
    if result.get("ordinaryWasmBeforeSha256") != result.get("ordinaryWasmAfterSha256"):
        raise EvidenceError("ordinary production WASM changed during diagnostic capture")
    budget = result.get("stage2lCandidateBudgetObserved", {})
    if budget.get("before") != budget.get("after") or budget.get("before", {}).get("candidateIdentities") != 1 or budget.get("before", {}).get("maximumCandidateIdentities") != 12:
        raise EvidenceError("Stage2L physical candidate budget changed during Stage2M")
    combos = result.get("combinations")
    if not isinstance(combos, list) or len(combos) != 8:
        raise EvidenceError("exactly eight factorial combinations are required")
    by_mask: dict[int, dict[str, Any]] = {}
    expected_labels = {mask: f"{mask:03b}" for mask in range(8)}
    for row in combos:
        mask = row.get("mask")
        if isinstance(mask, bool) or mask not in range(8) or mask in by_mask:
            raise EvidenceError("factor masks must be unique integers 0..7")
        if row.get("label") != expected_labels[mask]:
            raise EvidenceError(f"factor label does not match bit order at mask {mask}")
        midi45 = row.get("midi45")
        if not isinstance(midi45, list) or len(midi45) != len(EXPECTED_VELOCITIES):
            raise EvidenceError(f"mask {mask}: exactly 16 MIDI45 layers are required")
        if [item.get("velocity") for item in midi45] != EXPECTED_VELOCITIES:
            raise EvidenceError(f"mask {mask}: MIDI45 velocity coverage/order differs")
        for item in midi45:
            for key in ("level80to200Dbfs", "level200to350Dbfs", "peakDbfs", "guardHits"):
                number(item.get(key), f"mask {mask} MIDI45 {item['velocity']} {key}")
            if item.get("finite") is not True or item.get("guardHits") != 0:
                raise EvidenceError(f"mask {mask}: non-finite or guarded MIDI45 output")
            if not isinstance(item.get("pitchEstimator"), dict):
                raise EvidenceError(f"mask {mask}: MIDI45 pitch-estimator result is missing")
            hammer = item.get("hammer")
            if not isinstance(hammer, dict) or set(hammer) != {"effectiveHardness", "initialHammerVelocity", "contactDurationSamples", "peakForce", "maxCompression", "postContactTransverseEnergy"}:
                raise EvidenceError(f"mask {mask}: incomplete observational hammer diagnostics")
            for key, value in hammer.items():
                number(value, f"mask {mask} MIDI45 {item['velocity']} hammer {key}")
        c8, midi21 = row.get("c8"), row.get("midi21")
        if not isinstance(c8, dict) or not isinstance(midi21, dict):
            raise EvidenceError(f"mask {mask}: missing single C8 or MIDI21 probe")
        if len(c8.get("envelopeDbfs", [])) != 5:
            raise EvidenceError(f"mask {mask}: C8 must report five envelope windows")
        for key in ("earlyResidualDb", "lateResidualDb", "postAttackShapeErrorDb", "postAttackShapeViolationDb", "peakDbfs", "guardHits", "level80to200Dbfs", "level200to350Dbfs"):
            number(c8.get(key), f"mask {mask} C8 {key}")
        for key in ("targetMidiFrequency", "currentEstimatorCents", "currentEstimatorSelectedFrequency", "constrainedNearFundamentalFrequency", "constrainedNearFundamentalCents", "estimatorSelectedPeakAmplitude", "constrainedNearFundamentalAmplitude", "selectedToConstrainedAmplitudeRatio"):
            number(midi21.get(key), f"mask {mask} MIDI21 {key}")
        if not isinstance(midi21.get("preparedStringNominalHz"), list) or not midi21["preparedStringNominalHz"]:
            raise EvidenceError(f"mask {mask}: MIDI21 prepared string frequencies are missing")
        if any(item.get("finite") is not True or item.get("guardHits") != 0 for item in (c8, midi21)):
            raise EvidenceError(f"mask {mask}: non-finite or guarded C8/MIDI21 output")
        by_mask[mask] = row
    if set(by_mask) != set(range(8)):
        raise EvidenceError("factorial mask coverage is incomplete")

    span_by_mask = {m: _span_metrics(by_mask[m]["midi45"]) for m in range(8)}
    c8_violation = {m: number(by_mask[m]["c8"]["postAttackShapeViolationDb"], "C8 violation") for m in range(8)}
    c8_late = {m: number(by_mask[m]["c8"]["lateResidualDb"], "C8 late residual") for m in range(8)}
    midi21_estimator = {m: number(by_mask[m]["midi21"]["currentEstimatorCents"], "MIDI21 estimator cents") for m in range(8)}
    midi21_near = {m: number(by_mask[m]["midi21"]["constrainedNearFundamentalCents"], "MIDI21 constrained peak cents") for m in range(8)}
    outcomes = {
        "midi45SpanViolationDb": {m: span_by_mask[m]["existing8DbViolationDb"] for m in range(8)},
        "midi45SynthSpanDb": {m: span_by_mask[m]["synthSpanDb"] for m in range(8)},
        "midi45LargestDownwardLayerStepDb": {m: span_by_mask[m]["largestDownwardAdjacentStepDb"] for m in range(8)},
        "c8PostAttackViolationDb": c8_violation,
        "c8LateResidualDb": c8_late,
        "midi21PitchEstimatorCents": midi21_estimator,
        "midi21ConstrainedNearFundamentalCents": midi21_near,
    }
    effects = {name: {"factorialEffects": factorial_effects(values),
                      "matchedPairDeltas": {factor: matched_pairs(values, bit) for factor, bit in zip(FACTOR_NAMES, (1, 2, 4))}}
               for name, values in outcomes.items()}

    baseline45 = next((x for x in stage2l["metrics"]["directProxy"]["dynamicSpan"]["perPitch"] if x["pitch"] == 45), None)
    baselineC8 = next((x for x in stage2l["directProxy"]["cells"] if x["pitch"] == 108 and x["velocity"] == 14), None)
    baselinePitch = next((x for x in stage2l["stage1Metrics"]["pitchCells"] if x["pitch"] == 21 and x["velocity"] == 14), None)
    if not baseline45 or not baselineC8 or not baselinePitch:
        raise EvidenceError("saved Stage2L candidate-1 lacks the equivalence anchor cells")
    stage2l_equivalence = {
        "mask": 7,
        "midi45SynthSpanDeltaDb": close(span_by_mask[7]["synthSpanDb"], baseline45["actualSpanDb"], "MIDI45 synth span"),
        "midi45ReferenceSpanDeltaDb": close(span_by_mask[7]["referenceSpanDb"], baseline45["referenceSpanDb"], "MIDI45 reference span"),
        "c8ShapeViolationDeltaDb": close(by_mask[7]["c8"]["postAttackShapeViolationDb"], baselineC8["postAttackShapeViolationDb"], "C8 post-attack violation"),
        "midi21PitchErrorDeltaCents": close(by_mask[7]["midi21"]["currentEstimatorCents"], baselinePitch["errorCents"], "MIDI21 pitch error", 0.05),
        "toleranceDb": REPRO_TOLERANCE, "pitchToleranceCents": 0.05, "pass": True,
    }
    c8_effect = effects["c8PostAttackViolationDb"]["factorialEffects"]
    c8_pairs = effects["c8PostAttackViolationDb"]["matchedPairDeltas"]["N"]
    n_consistently_improves = all(row["revision2MinusLegacy"] < 0 for row in c8_pairs)
    if c8_effect["N"] < 0 and abs(c8_effect["N"]) >= max(abs(c8_effect[f]) for f in ("V", "H")) and n_consistently_improves:
        c8_decision = "PRESERVE_TIME_NORMALIZATION_FOR_REVISION3"
    else:
        c8_decision = "REVISIT_TIME_NORMALIZATION"

    span_effects = effects["midi45SpanViolationDb"]["factorialEffects"]
    span_pair_mean = {factor: sum(row["revision2MinusLegacy"] for row in effects["midi45SpanViolationDb"]["matchedPairDeltas"][factor]) / 4 for factor in FACTOR_NAMES}
    interaction_max = max((abs(span_effects[name]), name) for name in ("N×V", "N×H", "V×H", "N×V×H"))
    if interaction_max[0] > max(abs(span_effects[f]) for f in FACTOR_NAMES):
        span_decision = "COUPLED_HAMMER_LOSS_RESPONSE_REQUIRES_REDESIGN"
    elif abs(span_pair_mean["H"]) >= abs(span_pair_mean["V"]) and span_pair_mean["H"] > 0:
        span_decision = "VELOCITY_HARDNESS_MAPPING_REQUIRES_REDESIGN"
    elif abs(span_pair_mean["V"]) > abs(span_pair_mean["H"]) and span_pair_mean["V"] > 0:
        span_decision = "PASSIVE_VELOCITY_LOSS_SEPARATION_REQUIRES_REDESIGN"
    else:
        span_decision = "NO_SINGLE_ADVERSE_FACTOR_ATTRIBUTED"

    failing_pitch_masks = [m for m, value in midi21_estimator.items() if abs(value) > PITCH_TOLERANCE_CENTS]
    near_inside_masks = [m for m, value in midi21_near.items() if abs(value) <= PITCH_TOLERANCE_CENTS]
    estimator_disagreement_masks = sorted(set(failing_pitch_masks) & set(near_inside_masks))
    both_pitch_measures_outside_masks = sorted(set(failing_pitch_masks) - set(near_inside_masks))
    if estimator_disagreement_masks:
        pitch_decision = "PITCH_ESTIMATOR_TRACKING_PROBLEM"
    elif failing_pitch_masks:
        pitch_decision = "PHYSICAL_PITCH_OR_SPECTRAL_MODEL_PROBLEM"
    else:
        pitch_decision = "PITCH_PROBE_WITHIN_TOLERANCE"

    return {
        "schemaVersion": 1, "candidateId": result["candidateId"], "sourceRevision": result.get("sourceRevision"),
        "candidateBudget": {"before": 1, "after": 1, "maximum": 12, "candidateCountDelta": 0, "gpsamplerTrialsCreated": 0},
        "factorBitOrder": {"bit0": "N", "bit1": "V", "bit2": "H", "0": "legacy", "1": "revision-2"},
        "combinationSummaries": [{"mask": m, "label": by_mask[m]["label"], "midi45": span_by_mask[m],
                                  "c8": by_mask[m]["c8"], "midi21": by_mask[m]["midi21"],
                                  "safety": by_mask[m]["diagnostics"]} for m in range(8)],
        "outcomes": outcomes, "effects": effects, "stage2lCandidate1Equivalence": stage2l_equivalence,
        "decision": {"c8": c8_decision, "midi45Span": span_decision, "midi21Pitch": pitch_decision,
                     "midi21FailingEstimatorMasks": failing_pitch_masks, "midi21NearFundamentalWithin15CentMasks": near_inside_masks,
                     "midi21EstimatorDisagreementMasks": estimator_disagreement_masks,
                     "midi21BothMeasuresOutside15CentMasks": both_pitch_measures_outside_masks,
                     "physicalCausalityClaimed": False, "revision3Implemented": False},
        "allVariantsFiniteGuardZero": True, "stage3Eligible": False, "stage4Eligible": False,
    }


def markdown(report: dict[str, Any]) -> str:
    lines = ["# Issue #7 — Stage2M Factorial Attribution", "",
             "Stage2Mは診断専用です。係数変更、Stage 3/4、候補昇格の根拠には使用しません。", "",
             f"- Candidate: `{report['candidateId']}` (Stage2L semantic vector)",
             f"- Source revision: `{report.get('sourceRevision')}`",
             "- Candidate budget: 1/12 (Stage2M candidate delta 0; GPSampler trials 0)",
             f"- 111 equivalence: {'PASS' if report['stage2lCandidate1Equivalence']['pass'] else 'FAIL'}", "",
             "## Factor combinations", "", "| Mask | MIDI45 span | Existing 8 dB violation | C8 shape violation | C8 LATE residual | MIDI21 estimator | MIDI21 constrained peak | Peak worst | Guard |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for row in report["combinationSummaries"]:
        lines.append(f"| {row['label']} | {row['midi45']['synthSpanDb']:.6f} dB | {row['midi45']['existing8DbViolationDb']:.6f} dB | {row['c8']['postAttackShapeViolationDb']:.6f} dB | {row['c8']['lateResidualDb']:.6f} dB | {row['midi21']['currentEstimatorCents']:.4f} ¢ | {row['midi21']['constrainedNearFundamentalCents']:.4f} ¢ | {row['safety']['peakWorstDbfs']:.4f} dBFS | {row['safety']['guardHits']} |")
    lines += ["", "## Factorial effects", "", "各効果は revision-2 (+1) 平均 − legacy (−1) 平均です。交互作用も同じ符号規約です。", "",
              "| Outcome | N | V | H | N×V | N×H | V×H | N×V×H |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for name, entry in report["effects"].items():
        e = entry["factorialEffects"]
        lines.append(f"| {name} | " + " | ".join(f"{e[k]:.6f}" for k in ("N", "V", "H", "N×V", "N×H", "V×H", "N×V×H")) + " |")
    lines += ["", "## Matched-pair deltas", "", "各セルは他の2因子を固定し、revision-2 − legacy（dBまたは¢）を4組で示します。", "",
              "| Outcome | Factor | Pair deltas |", "|---|---|---:|"]
    for name, entry in report["effects"].items():
        for factor in ("N", "V", "H"):
            deltas = [row["revision2MinusLegacy"] for row in entry["matchedPairDeltas"][factor]]
            lines.append(f"| {name} | {factor} | `" + ", ".join(f"{x:.6f}" for x in deltas) + "` |")
    lines += ["", "## Decision classification", "",
              f"- C8 time normalization: `{report['decision']['c8']}`",
              f"- MIDI45 velocity span: `{report['decision']['midi45Span']}`",
              f"- MIDI21 pitch: `{report['decision']['midi21Pitch']}`",
              f"- Estimator >15¢ masks: `{report['decision']['midi21FailingEstimatorMasks']}`",
              f"- Constrained peak within ±15¢ masks: `{report['decision']['midi21NearFundamentalWithin15CentMasks']}`",
              f"- Estimator-fail / constrained-peak-pass masks: `{report['decision']['midi21EstimatorDisagreementMasks']}`",
              f"- Both MIDI21 measures outside ±15¢ masks: `{report['decision']['midi21BothMeasuresOutside15CentMasks']}`",
              "- Output ablation/factor deltas are path-authority evidence only; no unsupported mechanical/physical root cause is inferred.",
              "- Production preset/equations and acceptance thresholds were not tuned by this diagnostic.",
              "- Stage 3 and Stage 4 were not run and remain locked.", ""]
    return "\n".join(lines)


def detailed_markdown(report: dict[str, Any], result: dict[str, Any]) -> str:
    lines = [markdown(report), "## Candidate vector", "",
             "```json", json.dumps(result["parameters"], indent=2, sort_keys=True), "```", "",
             "## MIDI45 per-layer measurements", "",
             "数値は診断値です。各行は同一semantic candidateの1つのfactor maskです。", ""]
    for combo in result["combinations"]:
        lines += [f"### Mask {combo['label']}", "",
                  "| Velocity | Synth 80–200 | Ref 80–200 | Layer error | Synth 200–350 | Ref 200–350 | Peak | Estimator cents | Hardness | Launch velocity | Contact samples | Peak force | Max compression | Post-contact transverse energy | Finite | Guard |",
                  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---:|"]
        for row in combo["midi45"]:
            layer_error = row["level80to200Dbfs"] - row["reference80to200Dbfs"]
            hammer = row["hammer"]
            pitch_error = row["pitchEstimator"].get("pitch_error_cents")
            pitch_text = f"{float(pitch_error):.4f}¢" if isinstance(pitch_error, (int, float)) and math.isfinite(float(pitch_error)) else "MEASUREMENT_INVALID"
            lines.append(f"| {row['velocity']} | {row['level80to200Dbfs']:.6f} dBFS | {row['reference80to200Dbfs']:.6f} dBFS | {layer_error:.6f} dB | {row['level200to350Dbfs']:.6f} dBFS | {row['reference200to350Dbfs']:.6f} dBFS | {row['peakDbfs']:.6f} dBFS | {pitch_text} | {hammer['effectiveHardness']:.7g} | {hammer['initialHammerVelocity']:.7g} | {hammer['contactDurationSamples']:.0f} | {hammer['peakForce']:.7g} | {hammer['maxCompression']:.7g} | {hammer['postContactTransverseEnergy']:.7g} | {row['finite']} | {row['guardHits']} |")
        c8 = combo["c8"]
        windows = ("0–10 ms", "10–30 ms", "30–80 ms", "80–200 ms", "200–350 ms")
        lines += ["", "C8 108/14 windows: " + "; ".join(f"{label} {value:.6f} dBFS" for label, value in zip(windows, c8["envelopeDbfs"])),
                  f"C8 residuals: EARLY {c8['earlyResidualDb']:.6f} dB; LATE {c8['lateResidualDb']:.6f} dB; shape {c8['postAttackShapeErrorDb']:.6f} dB; existing 10 dB violation {c8['postAttackShapeViolationDb']:.6f} dB; peak {c8['peakDbfs']:.6f} dBFS; finite {c8['finite']}; guard {c8['guardHits']}.", ""]
        m21 = combo["midi21"]
        lines += [f"MIDI21 21/14: target {m21['targetMidiFrequency']:.8f} Hz; estimator {m21['currentEstimatorSelectedFrequency']:.8f} Hz / {m21['currentEstimatorCents']:.6f}¢; local peak {m21['constrainedNearFundamentalFrequency']:.8f} Hz / {m21['constrainedNearFundamentalCents']:.6f}¢; estimator/local amplitude ratio {m21['selectedToConstrainedAmplitudeRatio']:.7g}; prepared strings {', '.join(f'{x:.8f} Hz' for x in m21['preparedStringNominalHz'])}; finite {m21['finite']}; guard {m21['guardHits']}.", ""]
    lines += ["## Measurement and scope notes", "",
              "- The MIDI21 local peak uses the shared spectrum helper with a 1.36 s Hann window and expected-f0-centered ±100¢ bin search; it remains diagnostic, not a replacement hard pitch gate.",
              "- 144 renders are eight factor variants of one semantic vector; no new physical candidate identity or optimizer observation was created.",
              "- Raw audio, local filesystem paths, Drive identifiers, and credentials are not included.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--detailed-output", type=Path, default=DEFAULT_DETAILED_OUTPUT)
    parser.add_argument("--stage2l-result", type=Path, default=DEFAULT_STAGE2L)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    args.input = args.input if args.input.is_absolute() else ROOT / args.input
    args.output = args.output if args.output.is_absolute() else ROOT / args.output
    args.detailed_output = args.detailed_output if args.detailed_output.is_absolute() else ROOT / args.detailed_output
    args.stage2l_result = args.stage2l_result if args.stage2l_result.is_absolute() else ROOT / args.stage2l_result
    if args.dry_run:
        candidate_path = STATE.parent / "stage2l-model-revision-2/results/candidates/stage2l-r2-candidate-01.json"
        if not candidate_path.is_file() or not args.stage2l_result.is_file():
            raise EvidenceError("dry-run preflight requires the preserved candidate and Stage2L result")
        candidate = json.loads(candidate_path.read_text())
        baseline = json.loads(args.stage2l_result.read_text())
        if candidate.get("candidateId") != "stage2l-r2-candidate-01" or baseline.get("result") != "COMPLETE":
            raise EvidenceError("dry-run candidate/baseline identity mismatch")
        print(json.dumps({"status": "DRY_RUN_PASS", "candidateId": candidate["candidateId"],
                          "factorCombinations": 8, "plannedRenders": 144, "builds": 0, "physicalRenders": 0,
                          "candidateCountDelta": 0, "candidateBudget": "1/12"}, sort_keys=True))
        return 0
    result = json.loads(args.input.read_text())
    stage2l = json.loads(args.stage2l_result.read_text())
    for relative, expected in result.get("protectedEvidenceSha256", {}).items():
        path = ROOT / relative
        if not path.is_file() or sha256(path) != expected:
            raise EvidenceError(f"protected Stage2M input hash changed: {relative}")
    report = validate_and_analyze(result, stage2l)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(markdown(report), encoding="utf-8")
    args.detailed_output.parent.mkdir(parents=True, exist_ok=True)
    args.detailed_output.write_text(detailed_markdown(report, result), encoding="utf-8")
    print(json.dumps({"status": "ANALYSIS_PASS", "output": str(args.output.relative_to(ROOT)),
                      "stage2lEquivalence": report["stage2lCandidate1Equivalence"], "decision": report["decision"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (EvidenceError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"Stage2M analysis blocked: {exc}", file=sys.stderr)
        raise SystemExit(2)
