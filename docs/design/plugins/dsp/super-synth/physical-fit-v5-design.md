<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->
# Issue #7 Physical Fit v5 Design

## Context and goals

This Issue-bound design annex implements the approved procedure in `physical-fit-v5-amendment.md`. Its goal is to determine, from immutable v3/v4 measurements, whether the tightly bounded v5 local search has any supported predicted candidate before spending acoustic calls. It does not supersede the existing SuperSynth architecture or alter the source-bound v4 design.

## Requirements traceability

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Preserve v3/v4 evidence and source identity | Read-only dual-store import, hashes, and parent inventory snapshots | `--dry-run`, `--verify`, v3/v4 regression suites |
| Fail closed on an unreliable local model | Rank, weighted condition, and 12-fold LOO gates | v5 local-model unit tests and dry-run diagnostics |
| Limit predicted search to the approved supported grid | Fixed 729-point enumeration, parameter-box, duplicate, support, and upper-bound filters | Planner unit tests and persisted diagnostics |
| Charge and preserve every permitted acoustic call | Separate v5 dual-store ledger with pre-render call markers | Core ledger tests and runtime verification |
| Prevent downstream promotion after a failed P5 gate | Immutable terminal decision blocks all later phases | `--run-all` terminal record and `--verify` |

## Architecture

For every fixed stress cell, preserve the signed early and late residuals as separate outputs. Select the measured incumbent by official hard-gate violation, v2 loss, baseline distance, and ID. Fit the weighted local linear model to the 12 nearest unique measured vectors and evaluate all 12 leave-one-out folds. Any rank, conditioning, finite-value, or prediction-error failure stops before audio.

Enumerate the complete 729-point grid in fixed order, then apply the parameter box, measured-point exclusion, local-support, and predicted upper-bound rules. Candidate order uses upper bound, normalized distance from the incumbent, and lexicographic parameter tuple. Replanning after a complete measured failure creates a new immutable round plan and excludes every prior vector by its values hash.

## Data flow and ownership

The runner reads v3 and v4 state from the canonical private primary and secondary roots. It verifies both copies, source hashes, full P3 runtime SHA, the 20 vector identities, and all 140 cell WAV and metadata hashes. It snapshots both parent inventories before and after the read-only diagnostic and requires identical content, sizes, and modification times. It never invokes a v4 writer or charge API.

The imported observation manifest contains numeric measurements and SHA-256 identities only. Raw audio stays in the private evidence roots. The v5 runtime record binds the exact contract SHA, current PR commit/tree/parent, complete v4 P3 SHA, v3 terminal SHA, source hashes, parent inventory digests, and the diagnostic result digest.

The v5 core owns separate dual-store paths, counters, call markers, and locks. Its cumulative accounting begins at the immutable historical total of 3,251 and cannot exceed 5,255. A call marker is written to both stores before rendering. A missing or divergent result after a start marker is ambiguous and blocks the run. Only an exact complete marker/result/WAV identity may be reused.

## Failure handling

`--status`, `--verify`, and `--dry-run` perform no build, DSP render, or evidence write and must leave every parent modification time unchanged. `--prepare-p5` binds the verified read-only record to the pushed PR commit. `--run-all` rechecks that identity, then stops immediately if no predicted feasible candidate exists. A terminal P5 failure leaves confirmation, headroom, promotion, release equivalence, Stage 3, and Stage 4 as `NOT RUN`.

No v4 mutable ledger, charge counter, evidence writer, or promotion helper is called. The renderer and official evaluator may be imported from v4 only as pure read/render helpers. P6 is conditional on a complete P5 measured pass; all downstream gates retain their existing order and immutable v5 evidence namespace.

## Alternatives considered

Starting acoustic trials before checking local support would spend the fixed 42-call allowance without evidence that the proposed points are within the approved local model's domain. Expanding the grid, relaxing the upper bound, or treating a surrogate prediction as an acoustic pass would change the approved contract. The selected read-only feasibility gate preserves the allowance and stops deterministically when no eligible point exists.

## Verification strategy

The focused v5 suite covers the local model, deterministic grid, candidate filters, dual-store charge markers, and immutable reuse. The v3 and v4 suites cover historical regressions. The runner's `--dry-run` validates all parent evidence without builds, renders, or writes; `--prepare-p5`, `--run-all`, and `--verify` record and check the pushed-head-bound terminal result. Stage 3 and Stage 4 evidence is produced only if every preceding measured gate passes.
