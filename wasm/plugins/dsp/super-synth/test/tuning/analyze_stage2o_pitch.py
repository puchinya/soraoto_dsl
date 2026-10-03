#!/usr/bin/env python3
"""Validate and summarize the fixed Stage2O low-register measurement matrix."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


PITCHES = (21, 24, 27, 30, 33, 36, 39, 42)
VELOCITIES = (14, 61, 124)
EXPECTED_CELLS = tuple((pitch, velocity) for pitch in PITCHES for velocity in VELOCITIES)
MIDI21_RAW_H1_REFERENCE_CENTS = 13.04792250285121
MIDI21_RAW_H1_TOLERANCE_CENTS = 0.5
PITCH_LIMIT_CENTS = 15.0


def expected_pitch_result(cells: list[dict[str, Any]]) -> str:
    """Return the Stage2O estimator decision without inferring missing metrics."""
    invalid = [cell for cell in cells if cell.get("measurementValid") is not True]
    if invalid:
        return "BLOCKED_STAGE2O_ESTIMATOR_UNRESOLVED"
    failures = [cell for cell in cells if abs(float(cell["finalCents"])) > PITCH_LIMIT_CENTS]
    if failures:
        return "BLOCKED_STAGE2O_PHYSICAL_PITCH"
    return "LOW_REGISTER_MATRIX_PITCH_PASS"


def _source(sources: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next((source for source in sources if source.get("name") == name), {})


def summarize_capture(capture: dict[str, Any]) -> dict[str, Any]:
    rows = capture.get("capture", {}).get("matrix", [])
    actual = tuple((row.get("pitch"), row.get("velocity")) for row in rows)
    if len(rows) != 24 or actual != EXPECTED_CELLS or len(set(actual)) != 24:
        raise ValueError("BLOCKED_STAGE2O_REQUIRED_COVERAGE")

    cells: list[dict[str, Any]] = []
    for row in rows:
        metrics = row.get("metrics", {})
        pitch = metrics.get("pitchMeasurement") or {}
        diagnostics = pitch.get("low_register_diagnostics") or {}
        sources = diagnostics.get("sources") or []
        source_a = _source(sources, "spectralBaseF0")
        source_b = _source(sources, "autocorrelation")
        source_c = _source(sources, "harmonicComb")
        final_cents = pitch.get("pitch_error_cents")
        cells.append({
            "pitch": row["pitch"],
            "velocity": row["velocity"],
            "rawH1FrequencyHz": source_a.get("h1Hz"),
            "rawH1Cents": source_a.get("rawH1Cents"),
            "h2FrequencyHz": source_a.get("h2Hz"),
            "sourceAEligible": source_a.get("eligible") is True,
            "sourceAReason": source_a.get("reason"),
            "h1Prominence": source_a.get("h1Prominence"),
            "h2Prominence": source_a.get("h2Prominence"),
            "sourceAB": source_a.get("B_A"),
            "sourceAF0": source_a.get("f0_A"),
            "sourceACents": source_a.get("cents_A"),
            "sourceBEligibleDiagnostic": source_b.get("eligible") is True,
            "sourceBFrequencyHz": source_b.get("frequencyHz"),
            "sourceBCents": source_b.get("cents"),
            "sourceBScore": source_b.get("score"),
            "sourceCEligible": source_c.get("eligible") is True,
            "sourceCDiagnosticsValid": source_c.get("valid") is True,
            "sourceCB": source_c.get("B_C"),
            "sourceCF0": source_c.get("f0_C"),
            "sourceCCents": source_c.get("cents_C"),
            "acDifferenceCents": diagnostics.get("agreement_cluster", {}).get("spreadCents"),
            "measurementValid": pitch.get("measurement_valid") is True,
            "result": pitch.get("result"),
            "invalidReason": pitch.get("reason"),
            "finalCents": final_cents,
            "legacyEstimatorCents": pitch.get("legacy_diagnostic", {}).get("pitch_error_cents"),
            "peakDbfs": metrics.get("fullRenderPeakDbfs", metrics.get("peakDbfs")),
            "guardHits": metrics.get("outputGuardHits"),
            "finite": metrics.get("finite") is True,
        })

    reference = next(cell for cell in cells if cell["pitch"] == 21 and cell["velocity"] == 14)
    raw_h1 = reference["rawH1Cents"]
    provenance_pass = (raw_h1 is not None and
                       abs(float(raw_h1) - MIDI21_RAW_H1_REFERENCE_CENTS) <= MIDI21_RAW_H1_TOLERANCE_CENTS)
    decision = expected_pitch_result(cells)
    if not provenance_pass:
        decision = "BLOCKED_STAGE2O_LOW_REGISTER_PROVENANCE"
    invalid_count = sum(cell["measurementValid"] is not True for cell in cells)
    physical_pitch_failures = [cell for cell in cells if cell["measurementValid"] and
                               abs(float(cell["finalCents"])) > PITCH_LIMIT_CENTS]
    return {
        "schemaVersion": 1,
        "candidateId": capture.get("candidateId"),
        "sourceRevision": capture.get("sourceRevision"),
        "configSha256": capture.get("configSha256"),
        "wasmSha256": capture.get("wasmSha256"),
        "productionSimd": True,
        "candidateBudgetDelta": 0,
        "requestedCellCount": 24,
        "measurementInvalidCount": invalid_count,
        "physicalPitchFailureCount": len(physical_pitch_failures),
        "midi21Velocity14RawH1Cents": raw_h1,
        "midi21RawH1ReferenceCents": MIDI21_RAW_H1_REFERENCE_CENTS,
        "midi21RawH1ToleranceCents": MIDI21_RAW_H1_TOLERANCE_CENTS,
        "midi21RawH1ProvenancePass": provenance_pass,
        "decision": decision,
        "cells": cells,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = summarize_capture(json.loads(args.input.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(args.output)
    print(json.dumps({key: result[key] for key in (
        "decision", "requestedCellCount", "measurementInvalidCount",
        "physicalPitchFailureCount", "midi21Velocity14RawH1Cents",
        "midi21RawH1ProvenancePass", "wasmSha256"
    )}, sort_keys=True))


if __name__ == "__main__":
    main()
