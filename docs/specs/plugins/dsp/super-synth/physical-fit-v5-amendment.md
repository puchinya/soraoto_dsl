<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->
# Issue #7 Physical Fit v5 Amendment

## Purpose

This document records the Issue-bound v5 recovery procedure approved for Issue #7 and PR #8. It supplements the existing SuperSynth product contract for this calibration run. It does not change public product behavior, Plugin ABI, DSL semantics, preset schema, source references, or official quality thresholds.

## Scope

The recovery uses the existing parameters `initial_velocity_velocity_scale`, `velocity_hardness_amount`, and `stiffness_soft`, each within the previously approved ±10% range. The invariant `velocity_hardness_scale_treble=1` remains fixed. Only the existing seven MIDI stress cells and the official direct-reference evaluator define a candidate's measured result.

The v4 terminal record and its evidence remain immutable. The v5 diagnostic epoch is `current-build-v5/shape-residual-recovery-v1`, with diagnostic lineage `physical-fit-P5` and a separate conditional production lineage `physical-fit-P6`. Historical v3/v4 WAVs and cell metadata are imported by hash and read only. Later integration into the existing product specification requires a separate contract so the v4 source identity remains intact.

## Normative requirements

Before candidate rendering, the implementation MUST verify the complete v4 P3 record SHA-256 in both stores; the v3 terminal identity; every WAV and cell metadata hash for the 20 measured vectors; both parent inventories including size and modification time; and the exact source-bound v4 files. The 20 vectors contain seven cells each. Signed EARLY and LATE residuals MUST be recomputed through the official `postAttackResiduals()` function from the stored measured audio. The recomputed value for the known v4 result MUST match 10.205353 dB within 1e-6 dB.

The local model MUST use the 12 unique observed vectors nearest to the official measured best. Coordinates are normalized as `(theta / baseline - 1) / 0.1`. For each of the 14 signed residual outputs, fit an intercept and three slopes with weighted least squares, weights `1 / (0.05 + distanceSquaredToBest)`, and ridge `1e-4` on slopes only. Rank below four or weighted design condition number above 1e5 blocks the model. Twelve-point leave-one-out maximum absolute error above 0.20 dB also blocks it.

Candidate predictions MUST be limited to the fixed 9×9×9 grid centered on the measured best, with each coordinate step equal to 0.005 of its baseline. Exclude the center, observed points within normalized coordinate tolerance 1e-9, and points outside the original parameter box. A candidate is eligible only when its predicted upper bound `max(abs(predicted signed residual)) + Ecv` is at most 9.95 dB and it is within 0.01 relative coordinate distance of at least one of the 12 training points. Sort by upper bound, distance from the best, then the three parameter values. An empty eligible set terminates as `BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT` with zero new audio calls.

Predicted feasibility is not an official acoustic pass. Only a complete seven-cell measurement meeting every existing hard gate can pass P5. No loss value or surrogate estimate may substitute for that measurement.

P5 allows at most six new vectors and seven calls per vector, for a strict maximum of 42 new acoustic calls. Each call MUST be charged by a dual-store start marker before DSP processing. Started calls with incomplete evidence remain ambiguous and cannot be rendered again. Plans and completed rounds are immutable and append only.

Only after a measured P5 pass may the run proceed to 25 confirmation calls, four headroom calls, a two-file P6 preset promotion, 24 test/release PCM-equivalence calls, Stage 3 (486 calls), and Stage 4 (1,423 calls). Each gate blocks the next. The cumulative ceiling is 5,255 calls, including the immutable 3,251-call history. No remaining allocation may be transferred or used to expand the three-parameter search.

## Observable behavior

`--status`, `--verify`, and `--dry-run` report the current evidence and deterministic feasibility decision without rendering audio or changing evidence. `--prepare-p5` records the verified read-only result against the pushed PR identity. `--run-all` rechecks that identity and either executes the bounded approved sequence after a feasible prediction or records the terminal zero-candidate decision. A predicted candidate is not reported as passing until its complete measured seven-cell result passes every existing hard gate.

## Error and boundary behavior

Any mismatch in source identity, parent inventory, evidence hash, PR identity, dual-store record, model rank, condition number, or cross-validation limit stops the run before new audio processing. An incomplete started call is ambiguous and cannot be retried. A measured P5 failure prevents confirmation, headroom, promotion, release equivalence, Stage 3, and Stage 4. The zero-candidate terminal decision is `BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT`; those downstream phases remain `NOT RUN`.

## Security and privacy

Historical audio remains in the private evidence roots and is read only. The imported observation manifest contains numeric measurements and SHA-256 identities; raw audio is not copied into the manifest or published to GitHub. Runtime evidence is written only to the dedicated v5 dual-store namespace and is bound to the approved contract and PR identity.

## Verification strategy

The focused v5 unit suite verifies deterministic modeling, candidate filtering, dual-store charging, immutability, and reuse rules. The v3 and v4 regression suites verify historical behavior remains intact. `--dry-run` recomputes the complete parent-backed decision and must leave parent inventories unchanged with zero builds, renders, and evidence writes. `--prepare-p5`, `--run-all`, and `--verify` provide the durable runtime evidence and final terminal decision; their reported counters and hashes must agree across both stores.
