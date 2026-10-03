#!/usr/bin/env python3
"""Validate the fixed Stage2P multi-window pitch matrix."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

PITCHES = (21, 24, 27, 30, 33, 36, 39, 42)
VELOCITIES = (14, 61, 124)
EXPECTED_CELLS = tuple((pitch, velocity) for pitch in PITCHES for velocity in VELOCITIES)
PITCH_LIMIT_CENTS = 15.0


def _window_row(measurement: dict[str, Any], name: str) -> dict[str, Any]:
    windows = measurement.get("low_register_diagnostics", {}).get("windows", {})
    window = windows.get(name, {})
    return {
        "valid": window.get("measurement_valid") is True,
        "result": window.get("result"),
        "reason": window.get("reason"),
        "estimatedF0": window.get("estimated_f0"),
        "cents": window.get("pitch_error_cents"),
        "fittedB": window.get("fitted_B"),
        "usablePartialCount": window.get("usable_partial_count"),
        "usablePartials": window.get("usable_partials", []),
        "rejectedPartials": window.get("rejected_partials", []),
        "partialF0SpreadCents": window.get("partial_f0_spread_cents"),
        "fitResidualCents": window.get("partial_fit_residual_cents"),
        "uncertaintyCents": window.get("estimated_uncertainty_cents"),
        "bestScore": window.get("best_score"),
        "competingScore": window.get("competing_score"),
        "confidenceRatio": window.get("confidence_ratio"),
        "confidenceComponents": window.get("confidence_components"),
        "partialCandidates": window.get("partial_candidates", []),
        "startMs": window.get("start_ms"),
        "endMs": window.get("end_ms"),
        "sampleCount": window.get("sample_count"),
        "exactWindow": window.get("exact_window"),
    }


def summarize_capture(capture: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    found: set[tuple[int, int]] = set()
    cells = capture.get("capture", {}).get("matrix", [])
    for cell in cells:
        key = (int(cell["pitch"]), int(cell["velocity"]))
        if key in found:
            raise ValueError(f"duplicate Stage2P cell: {key}")
        found.add(key)
        if key not in EXPECTED_CELLS:
            raise ValueError(f"unexpected Stage2P cell: {key}")
        metrics = cell.get("metrics", {})
        measurement = metrics.get("pitchMeasurement", {})
        diagnostics = measurement.get("low_register_diagnostics", {})
        source_a = next((item for item in diagnostics.get("sources", []) if item.get("name") == "spectralBaseF0"), {})
        source_b = next((item for item in diagnostics.get("sources", []) if item.get("name") == "autocorrelation"), {})
        rows.append({
            "pitch": key[0],
            "velocity": key[1],
            "revision": measurement.get("pitch_estimator_revision"),
            "measurementValid": measurement.get("measurement_valid") is True,
            "result": measurement.get("result"),
            "reason": measurement.get("reason"),
            "finalCents": measurement.get("pitch_error_cents"),
            "estimatedF0": measurement.get("estimated_f0"),
            "fittedB": measurement.get("fitted_B"),
            "validWindows": diagnostics.get("valid_window_names", []),
            "stableCluster": diagnostics.get("stable_cluster_names", []),
            "stableClusterSpreadCents": diagnostics.get("stable_cluster_spread_cents"),
            "overallSpreadCents": diagnostics.get("overall_valid_window_spread_cents"),
            "measurementBasis": measurement.get("measurement_basis"),
            "physicalInstability": diagnostics.get("physical_instability") is True,
            "windows": {name: _window_row(measurement, name) for name in ("full", "early", "late")},
            "sourceA": source_a,
            "autocorrelationDiagnostic": source_b,
            "revision2Diagnostic": diagnostics.get("revision2_diagnostic"),
            "legacyDiagnostic": diagnostics.get("legacy_diagnostic"),
            "peakDbfs": metrics.get("peakDbfs"),
            "fullRenderPeakDbfs": metrics.get("fullRenderPeakDbfs"),
            "guardHits": metrics.get("outputGuardHits"),
            "finite": metrics.get("finite") is True,
        })

    if found != set(EXPECTED_CELLS):
        missing = sorted(set(EXPECTED_CELLS) - found)
        raise ValueError(f"Stage2P requires exactly 24 cells; missing={missing}")
    rows.sort(key=lambda row: (row["pitch"], row["velocity"]))
    invalid = [row for row in rows if not row["measurementValid"]]
    physical_fails = [row for row in rows if row["measurementValid"] and
                      (row["physicalInstability"] or abs(float(row["finalCents"])) > PITCH_LIMIT_CENTS)]
    safety_fails = [row for row in rows if not row["finite"] or row["guardHits"] != 0 or
                    row["peakDbfs"] is None or float(row["peakDbfs"]) >= 0.0]
    if invalid:
        decision = "BLOCKED_STAGE2P_ESTIMATOR_UNRESOLVED"
    elif physical_fails:
        decision = "BLOCKED_STAGE2P_PHYSICAL_PITCH"
    elif safety_fails:
        decision = "BLOCKED_STAGE2P_MODEL_REGRESSION"
    else:
        decision = "MATRIX_PASS_STAGE2E_ELIGIBLE"
    valid_errors = [abs(float(row["finalCents"])) for row in rows if row["measurementValid"]]
    peaks = [float(row["peakDbfs"]) for row in rows if row["peakDbfs"] is not None]
    return {
        "schemaVersion": 1,
        "stage": "Stage2P multi-window low-register pitch matrix",
        "candidateId": capture.get("candidateId"),
        "sourceRevision": capture.get("sourceRevision"),
        "candidateVector": capture.get("candidateVector"),
        "configSha256": capture.get("configSha256"),
        "wasmSha256": capture.get("wasmSha256"),
        "productionSimd": capture.get("productionSimd") is True,
        "candidateBudgetDelta": capture.get("candidateBudgetDelta"),
        "requestedCellCount": len(EXPECTED_CELLS),
        "validCount": len(rows) - len(invalid),
        "invalidCount": len(invalid),
        "physicalPitchFailureCount": len(physical_fails),
        "trajectoryFailureCount": sum(row["physicalInstability"] for row in rows),
        "worstValidAbsolutePitchCents": max(valid_errors, default=None),
        "worstPeakDbfs": max(peaks, default=None),
        "totalGuardHits": sum(int(row["guardHits"] or 0) for row in rows),
        "decision": decision,
        "cells": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        manifest = Path(".agent-state/issues/7/calibration-optuna/stage2p/dry-run.json")
        data = json.loads(manifest.read_text())
        if data.get("status") != "PREFLIGHT_PASS" or data.get("buildCount") != 0 or data.get("physicalRenderCount") != 0:
            raise SystemExit("BLOCKED_STAGE2P_DRY_RUN_PROVENANCE")
        print(json.dumps({"status": data["status"], "buildCount": 0, "physicalRenderCount": 0,
                          "candidateId": data["candidateId"], "wasmSha256": data["wasmSha256"]}, sort_keys=True))
        return
    if args.input is None or args.output is None:
        parser.error("--input and --output are required unless --dry-run is used")
    result = summarize_capture(json.loads(args.input.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(args.output)
    print(json.dumps({key: result[key] for key in ("decision", "requestedCellCount", "validCount",
        "invalidCount", "physicalPitchFailureCount", "trajectoryFailureCount", "worstPeakDbfs",
        "totalGuardHits", "wasmSha256")}, sort_keys=True))


if __name__ == "__main__":
    main()
