#!/usr/bin/env python3
"""Summarize the fixed Stage2Q note-level-B / fixed-B pitch matrix."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

PITCHES = (21, 24, 27, 30, 33, 36, 39, 42)
VELOCITIES = (14, 61, 124)
EXPECTED_CELLS = tuple((pitch, velocity) for pitch in PITCHES for velocity in VELOCITIES)
PITCH_LIMIT_CENTS = 15.0
SPREAD_LIMIT_CENTS = 8.0


def _fit_row(fit: dict[str, Any]) -> dict[str, Any]:
    return {
        "valid": fit.get("measurement_valid") is True,
        "result": fit.get("result"),
        "reason": fit.get("reason"),
        "estimatedF0": fit.get("estimated_f0"),
        "candidateF0": fit.get("candidate_estimated_f0"),
        "cents": fit.get("pitch_error_cents"),
        "candidateCents": fit.get("candidate_pitch_error_cents"),
        "fittedB": fit.get("fitted_B"),
        "candidateB": fit.get("candidate_fitted_B"),
        "inharmonicityBasis": fit.get("inharmonicity_basis"),
        "usablePartialCount": fit.get("usable_partial_count"),
        "usablePartials": fit.get("usable_partials", []),
        "rejectedPartials": fit.get("rejected_partials", []),
        "partialF0SpreadCents": fit.get("partial_f0_spread_cents"),
        "fitResidualCents": fit.get("partial_fit_residual_cents"),
        "uncertaintyCents": fit.get("estimated_uncertainty_cents"),
        "bestScore": fit.get("best_score"),
        "competingScore": fit.get("competing_score"),
        "confidenceRatio": fit.get("confidence_ratio"),
        "confidenceComponents": fit.get("confidence_components"),
        "partialCandidates": fit.get("partial_candidates", []),
        "startMs": fit.get("start_ms"),
        "endMs": fit.get("end_ms"),
        "sampleCount": fit.get("sample_count"),
        "exactWindow": fit.get("exact_window"),
    }


def summarize_capture(capture: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    found: set[tuple[int, int]] = set()
    cells = capture.get("capture", {}).get("matrix", [])
    for cell in cells:
        key = (int(cell["pitch"]), int(cell["velocity"]))
        if key in found:
            raise ValueError(f"duplicate Stage2Q cell: {key}")
        found.add(key)
        if key not in EXPECTED_CELLS:
            raise ValueError(f"unexpected Stage2Q cell: {key}")
        metrics = cell.get("metrics", {})
        measurement = metrics.get("pitchMeasurement", {})
        if measurement.get("pitch_estimator_revision") != 4:
            raise ValueError(f"Stage2Q requires estimator revision 4: {key}")
        diagnostics = measurement.get("low_register_diagnostics", {})
        free_windows = diagnostics.get("free_windows", {})
        fixed_windows = diagnostics.get("windows", {})
        rows.append({
            "pitch": key[0],
            "velocity": key[1],
            "revision": measurement.get("pitch_estimator_revision"),
            "measurementValid": measurement.get("measurement_valid") is True,
            "result": measurement.get("result"),
            "reason": measurement.get("reason"),
            "finalCents": measurement.get("pitch_error_cents"),
            "estimatedF0": measurement.get("estimated_f0"),
            "noteLevelB": diagnostics.get("note_level_B"),
            "noteLevelBValid": diagnostics.get("note_level_B_valid") is True,
            "noteLevelBSource": diagnostics.get("note_level_B_source"),
            "freeBSpread": diagnostics.get("free_B_spread"),
            "freeWindows": {name: _fit_row(free_windows.get(name, {})) for name in ("full", "early", "late")},
            "fixedWindows": {name: _fit_row(fixed_windows.get(name, {})) for name in ("full", "early", "late")},
            "validWindows": diagnostics.get("valid_window_names", []),
            "fixedBSpreadCents": diagnostics.get("overall_valid_window_spread_cents"),
            "stableCluster": diagnostics.get("stable_cluster_names", []),
            "measurementBasis": measurement.get("measurement_basis"),
            "physicalInstability": diagnostics.get("physical_instability") is True,
            "stage2oSourceA": diagnostics.get("diagnostic_only", {}).get("stage2o_source_A"),
            "stage2oAutocorrelation": diagnostics.get("diagnostic_only", {}).get("stage2o_autocorrelation"),
            "revision3Diagnostic": diagnostics.get("diagnostic_only", {}).get("revision3_result"),
            "revision2Diagnostic": diagnostics.get("diagnostic_only", {}).get("revision2_result"),
            "legacyDiagnostic": diagnostics.get("diagnostic_only", {}).get("legacy_short_window_result"),
            "peakDbfs": metrics.get("peakDbfs"),
            "fullRenderPeakDbfs": metrics.get("fullRenderPeakDbfs"),
            "guardHits": metrics.get("outputGuardHits"),
            "finite": metrics.get("finite") is True,
        })

    if found != set(EXPECTED_CELLS):
        missing = sorted(set(EXPECTED_CELLS) - found)
        raise ValueError(f"Stage2Q requires exactly 24 cells; missing={missing}")
    rows.sort(key=lambda row: (row["pitch"], row["velocity"]))
    invalid = [row for row in rows if not row["measurementValid"] or not row["noteLevelBValid"]]
    physical_fails = [row for row in rows if row["measurementValid"] and
                      (row["physicalInstability"] or abs(float(row["finalCents"])) > PITCH_LIMIT_CENTS)]
    safety_fails = [row for row in rows if not row["finite"] or row["guardHits"] != 0 or
                    row["peakDbfs"] is None or float(row["peakDbfs"]) >= 0.0]
    if safety_fails:
        decision = "BLOCKED_STAGE2Q_MODEL_REGRESSION"
    elif invalid:
        decision = "BLOCKED_STAGE2Q_ESTIMATOR_UNRESOLVED"
    elif physical_fails:
        decision = "BLOCKED_STAGE2Q_PHYSICAL_PITCH"
    else:
        decision = "MATRIX_PASS_STAGE2E_ELIGIBLE"
    valid_errors = [abs(float(row["finalCents"])) for row in rows if row["measurementValid"]]
    peaks = [float(row["peakDbfs"]) for row in rows if row["peakDbfs"] is not None]
    return {
        "schemaVersion": 1,
        "stage": "Stage2Q note-level inharmonicity / fixed-B low-register pitch matrix",
        "candidateId": capture.get("candidateId"),
        "sourceRevision": capture.get("sourceRevision"),
        "candidateVector": capture.get("candidateVector"),
        "configSha256": capture.get("configSha256"),
        "wasmSha256": capture.get("wasmSha256"),
        "productionSimd": capture.get("productionSimd") is True,
        "candidateBudgetDelta": capture.get("candidateBudgetDelta"),
        "requestedCellCount": len(EXPECTED_CELLS),
        "noteLevelBValidCount": sum(row["noteLevelBValid"] for row in rows),
        "validCount": len(rows) - len(invalid),
        "invalidCount": len(invalid),
        "physicalPitchFailureCount": len(physical_fails),
        "trajectoryFailureCount": sum(row["physicalInstability"] for row in rows),
        "worstValidAbsolutePitchCents": max(valid_errors, default=None),
        "worstFixedBSpreadCents": max((float(row["fixedBSpreadCents"]) for row in rows
                                       if row["fixedBSpreadCents"] is not None), default=None),
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
        manifest = Path(".agent-state/issues/7/calibration-optuna/stage2q/dry-run.json")
        data = json.loads(manifest.read_text())
        if data.get("status") != "PREFLIGHT_PASS" or data.get("buildCount") != 0 or data.get("physicalRenderCount") != 0:
            raise SystemExit("BLOCKED_STAGE2Q_DRY_RUN_PROVENANCE")
        print(json.dumps({"status": data["status"], "buildCount": 0, "physicalRenderCount": 0,
                          "candidateId": data["identity"]["candidateId"], "wasmSha256": data["identity"]["wasmSha256"]}, sort_keys=True))
        return
    if args.input is None or args.output is None:
        parser.error("--input and --output are required unless --dry-run is used")
    result = summarize_capture(json.loads(args.input.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(args.output)
    print(json.dumps({key: result[key] for key in ("decision", "requestedCellCount", "noteLevelBValidCount",
        "validCount", "invalidCount", "physicalPitchFailureCount", "trajectoryFailureCount", "worstPeakDbfs",
        "worstFixedBSpreadCents", "totalGuardHits", "wasmSha256")}, sort_keys=True))


if __name__ == "__main__":
    main()
