#!/usr/bin/env python3
"""Build a deterministic Stage-3 diagnostic subset from immutable FAIL reports."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
FIXTURE = ROOT / "wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json"


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def build_subset(report_paths: list[Path]) -> dict:
    fixture = json.loads(FIXTURE.read_text())
    pitches = list(fixture["coverage"]["pitches"])
    velocities = list(fixture["coverage"]["velocityRepresentatives"])
    if len(pitches) != 30 or len(velocities) != 16:
        raise ValueError("reference fixture must retain its 30 x 16 direct matrix")

    candidates = []
    selected: dict[tuple[int, int], set[str]] = {}
    dynamic_pitches: set[int] = set()
    brightness_pitches: set[int] = set()
    source_hashes: set[str] = set()

    def add(pitch: int, velocity: int, reason: str) -> None:
        selected.setdefault((pitch, velocity), set()).add(reason)

    for report_path in sorted(report_paths):
        report = json.loads(report_path.read_text())
        if report.get("stageReached") != 3 or report.get("result") != "FAIL":
            raise ValueError(f"expected immutable Stage-3 FAIL evidence: {report_path.name}")
        source_hashes.add(report["sourceTreeSha256"])
        candidates.append({
            "candidateId": report["candidateId"],
            "sourceTreeSha256": report["sourceTreeSha256"],
            "configSha256": report["configSha256"],
            "wasmSha256": report["wasmSha256"],
            "reportSha256": hashlib.sha256(report_path.read_bytes()).hexdigest(),
        })
        for failure in report["failures"]:
            if failure.startswith("pitch "):
                pitch_text, kinds = failure[6:].split(":", 1)
                pitch = int(pitch_text)
                if "dynamicSpan" in kinds:
                    dynamic_pitches.add(pitch)
                if "brightnessDirection" in kinds:
                    brightness_pitches.add(pitch)
                continue
            parts = failure.split(":", 2)
            if len(parts) != 3:
                continue
            pitch, velocity = int(parts[0]), int(parts[1])
            if "postAttackShape" in parts[2]:
                add(pitch, velocity, f"postAttackShape:{report['candidateId']}")

    if len(source_hashes) != 1:
        raise ValueError("Stage-3 reports have mixed source-tree identities")

    for pitch in pitches:
        add(pitch, velocities[0], "all-pitches-lowest-velocity")
        add(pitch, velocities[-1], "all-pitches-highest-velocity")
    for pitch in sorted(dynamic_pitches):
        for velocity in velocities:
            add(pitch, velocity, "all-16-layers-for-dynamic-span")
    for pitch in sorted(brightness_pitches):
        for velocity in velocities:
            add(pitch, velocity, "all-16-layers-for-brightness-direction")

    rows = [
        {"pitch": pitch, "velocity": velocity, "reasons": sorted(reasons)}
        for (pitch, velocity), reasons in sorted(selected.items())
    ]
    manifest = {
        "schemaVersion": 1,
        "referenceFixtureSha256": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
        "sourceTreeSha256": next(iter(source_hashes)),
        "candidateEvidence": candidates,
        "dynamicSpanPitches": sorted(dynamic_pitches),
        "brightnessDirectionPitches": sorted(brightness_pitches),
        "cellCount": len(rows),
        "cells": rows,
        "purpose": "diagnostic-only; cannot produce Stage-3 PASS",
    }
    manifest["subsetSha256"] = hashlib.sha256(canonical(manifest)).hexdigest()
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports", nargs="+", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = build_subset(args.reports)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "cellCount": result["cellCount"],
                      "subsetSha256": result["subsetSha256"],
                      "dynamicSpanPitches": result["dynamicSpanPitches"]}, sort_keys=True))


if __name__ == "__main__":
    main()
