<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# Physical Fit v5 Review Amendment 01

**Status:** Approved for review-code remediation in Issue #7 / PR #8  
**Contract SHA-256:** `951a0bad7fb12b92f9aa103e0caef8e0d689b13e61eda72640ee68376399c105`

This amendment defines a read-only audit and an independent evidence reader for the frozen Physical Fit v5 run. It does not change the Physical Fit model, candidate thresholds, supported parameter box, runtime ABI, or the v5 terminal decision.

## Frozen parent

The parent is v5 HEAD `7ab88ce5b857423ec1d278e8741e963f4e33cd56`, with runtime record SHA-256 `90cf96c243f298cc6f91b8eba350f904c9581cd1924d53e272e422450d377307`, diagnostics SHA-256 `f847aab8c2775d3edded8225d3842f5c4ac52757631cf145fde54b4d844483d3`, and terminal SHA-256 `346a61a21e3c6fb46c97ee45c74616c523f8a180d63a032f30643532e73243ed`.

The terminal remains `BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT`; the eligible candidate count is zero. A review child may read the parent only after checking record digests, source hashes, v3/v4 inventories, and commit ancestry. The parent source files and both evidence copies are immutable under this amendment.

## Fixed-grid audit

The audit enumerates all 729 points in the existing `[-4..4]^3` grid in its fixed loop order. It uses the frozen local-model API for parameter normalization, prediction, thresholds, and candidate ordering. Each point records its indices, three values, fourteen predicted residuals, maximum predicted magnitude, upper bound `U`, nearest training identity and distance, local-support distance, classification, and reason codes.

Classifications are mutually exclusive and applied in this order: `CENTER`, `OUT_OF_BOX`, `MEASURED_DUPLICATE`, `S_AND_P`, `S_ONLY`, `P_ONLY`, `NEITHER`. Candidate eligibility remains exactly `S_AND_P`, with local support at maximum per-parameter baseline-relative difference `<= 0.01` and predicted upper bound `U <= 9.95 dB`. The audit compares the eligible values and their order with the frozen planner. Empty sets report count zero and `null` extrema. Non-finite values fail closed.

The audit is diagnostic. It cannot turn the frozen zero-candidate terminal into a passing result or create acoustic work.

## Review evidence

The review epoch is `current-build-v5-review/continuation-01`. Its primary and secondary roots are separate from all v3/v4/v5 stores. Only the review reader/writer in this epoch may create records. Existing v3/v4/v5 writer APIs are not used for review writes.

Each call marker fixes the stage, immutable plan SHA, normalized finite three-value tuple, canonical cell, `artifactKind`, and source/capture/binary/fixture SHA values. A completed WAV call requires identical copies of its marker, result, row, manifest, and audio bytes, with the result's audio SHA and size checked against the actual file. A completed metric call requires identical marker, result, row, and manifest copies; any audio file is an error. A result-row SHA is computed from canonical row bytes. Extra files, symlinks, incomplete dual copies, divergent copies, identity changes, or ambiguous markers fail closed. A started call remains charged after interruption and is never rerendered automatically.

The cumulative call ledger starts at 3,251 and is capped at 5,255. Stage limits are candidate 42, confirmation 25, headroom 4, release equivalence 24, Stage 3 486, and Stage 4 1,423. The current amendment authorizes zero additional real acoustic calls and zero builds.

## Stage order for isolated synthetic verification

The runner implements the prospective control flow so that its gates can be tested with injected synthetic data. This test path uses temporary dual stores and cannot launch DSP or build processes.

1. Test at most six unique candidate vectors, seven fixed stress cells per vector, and the official direct-reference hard gates.
2. Run the fixed 25-cell confirmation gate, preserving the seven training overlaps and eighteen new coordinates.
3. Run four headroom cases, then validate an isolated P6 receipt naming exactly `presets.json` and the generated profile header.
4. Record separate production-test and production-release identities, six synthetic regressions and CTest status, then compare 12 release pairs across both channels with sample-wise `maxAbs <= 1e-6`.
5. Run Stage 3 with exactly 480 direct plus six sentinel cells. Run Stage 4 only after Stage 3 passes, with 1,408 lifecycle plus 15 repeat cells and 1,392 adjacent comparisons.
6. Stop at `ACOUSTIC_PASS_AWAITING_FINAL_REVIEW` while Web Player acceptance, metadata/ABI review, PR push readback, and manual listening remain `NOT RUN`.

Synthetic success is not acoustic acceptance and cannot set the Issue to `phase:review` or close it.

## CLI and evidence writes

`--audit`, `--status`, `--verify`, and `--dry-run` are read-only: zero evidence writes, builds, renders, and acoustic calls. `--audit` prints all 729 rows to stdout; `--dry-run` prints the summary and representative points.

`--prepare-review` is the only command that creates the independent runtime revision and audit report. It requires the new source HEAD to be pushed and read back from PR #8 and appends immutable records in the new review roots. `--run-all` first verifies that revision. Because the actual frozen P5 terminal has zero eligible candidates, it appends a blocked terminal proof with zero new acoustic calls and all later phases `NOT RUN`. It must not alter the old terminal or spend reserved budgets.

The review epoch uses append-only files. A source or runtime identity change cannot overwrite a prepared revision; it requires a separately authorized revision or contract.

## Purpose

This amendment supplies a review-only audit and independent evidence reader for the rejected Physical Fit v5 review. It makes the existing zero-candidate result reproducible and defines how the remediation records that result without changing the frozen parent.

## Scope

The scope is the six new review-remediation files listed in the approved Issue #7 addendum. Existing v5 implementation and evidence, v4 source-bound files, DSP behavior, public interfaces, parameter bounds, thresholds, and acoustic budgets are outside the change scope. The implementation may append records only to the independent `current-build-v5-review/continuation-01` namespace.

## Normative requirements

- The audit must enumerate exactly 729 points in the frozen grid order and match the frozen planner's eligible values and order.
- Before any review record is accepted, the reader must verify the frozen P5 runtime, diagnostics, history, terminal, source hashes, ancestry, and v3/v4 inventories.
- The append-only runtime record is `runtime-revisions/v5-review-01.json`; it binds the frozen parent identity, current commit identity, P5 record digests, source hashes, parent inventories, and audit digest.
- Read-only commands must make zero evidence writes, builds, renders, and acoustic calls. `--prepare-review` may append the audit and runtime revision. `--run-all` may append a blocked terminal proof only when the verified parent still has zero eligible candidates and no review calls have started.
- Real DSP calls and builds are not authorized by this amendment. The positive transition path may be exercised only with synthetic inputs in isolated temporary stores.
- Any parent, source, identity, ledger, inventory, or dual-store inconsistency must fail closed without deleting or rewriting prior evidence.

## Observable behavior

The current parent audit classifies 1 point as `CENTER`, 280 as `S_ONLY`, and 448 as `NEITHER`; the other classifications contain zero points. The eligible count is zero, so `--audit` and `--dry-run` report `BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT`. After preparation, `--run-all` records that blocker with zero new calls and leaves confirmation, headroom, promotion, release comparison, Stage 3, Stage 4, Web Player acceptance, and manual listening `NOT RUN`.

## Error and boundary behavior

Non-finite predictions, a frozen-planner mismatch, a changed source or parent identity, missing or divergent store copies, malformed artifacts, symlinks, partial writes, stale locks, ambiguous calls, and quota overflow are errors. A call charged before interruption remains charged; the runner must not retry it automatically. The actual zero-candidate parent cannot enter acoustic evaluation.

## Security and privacy

The reader treats evidence files and externally supplied records as untrusted data and verifies their identity before use. Writes are confined to the independent review namespace with path validation and an owner-checked lock. Reports contain hashes and derived metrics, not private filesystem locations or raw audio. No command in this amendment uploads evidence or contacts an external service.

## Verification strategy

Verify the audit against the frozen planner and all 729 grid points; snapshot parent inventories before and after read-only modes; exercise dual-store tampering, interruption, locks, quotas, and each stage failure with temporary synthetic stores; run the frozen v5, v4, and physical-identification regression suites; and validate the Issue-linked specification and design documents. Real acoustic acceptance and production builds remain outside this amendment and must be reported `NOT RUN`.
