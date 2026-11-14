<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Physical Root-Cause Read-Only v1 Design (Issue #7)

**Status:** User-approved scope. **Contract SHA-256:** `5031773c8cf3326a5b0cf495d1fa09e6561b55b03afc380e03b2073c20c785c0`.

## Ownership and dependencies

The analyzer owns pure residual comparison, lineage-aware interpretation, and deterministic report serialization. Frozen v5 reader `run-issue7-physical-fit-v5.cjs::readOnlyDiagnosis` owns re-reading/remeasuring all 140 stored WAVs through the historical official evaluator; `preparedPayload` and `run-issue7-physical-fit-v5-review.cjs::verifyFrozenP5Parent` own prior hash/ancestry/inventory checks. None of their writer functions may be called.

Private report publication is a separate single-owner operation that writes only to `physical-root-cause-v1/analysis-01`; old v3/v4/v5/review01/review02 stores are read-only. No coupling to the mutable review-02 state-machine implementation, audio rendering, C engine or optimizer.

## Execution dataflow

1. Assert current checkout descends from frozen P5 HEAD. Check exact P5 parent/terminal, SHA, frozen sources, previous dual-store inventory and unchanged source identities.
2. Re-run the exported frozen read-only v5 diagnosis. Compare its 20 recomputed observation receipts to the persisted P5 history by unmodified ID, provenance, parameter tuple, cell order, every numeric signed early/late/shape and historical WAV/metadata SHA. Fail on missing/extra vectors, changed bytes, nonfinite values or deviations over 1e-6 dB.
3. Group 140 cells into seven stress-cell histories and split v3 (8) / v4 (12). Rank the observed best candidate using the frozen local-model's `compareScores`; do not refit any new model. Show MIDI96/124 signed residual magnitude and opposite-sign context.
4. Keep old Stage3 MIDI96/31 and 96/36 separate; compare only exact, validated lineage identities. Historical September 30 record is summary-only unless the original matched data and required identities are actually available.
5. Produce a fixed, timestamp-free JSON document (and equivalent Markdown) with actual facts, uncertainties, falsifiable alternatives, missing inputs, `NOT RUN` downstream status and zero-work accounting. Never report a physical cause as confirmed.
6. `--analyze` prints JSON only. `--verify` checks current source/parent state, prior-store snapshot and any published immutable two-copy data. `--publish` requires remote PR/commit identity and approved Issue addendum, then uses an isolated lock, two-store atomic append/readback and manifest; unchanged re-publication does not alter mtimes.

## Boundaries and failure behavior

- Frozen P5 cannot be revised; any changed source, parent evidence, mismatch or user approval absence blocks.
- Outputs do not include absolute private paths or audio bytes. Missing private store is `BLOCKED_INPUT_UNAVAILABLE`, not substituted fixtures. Missing historical controlled experiment only reduces hypothesis confidence.
- On a partial publication, preserve all existing records and stop. Do not auto-repair or auto-increment identities. A subsequent source change requires a newly approved continuation.
- Failures cannot enable Stage3/4, P6 promotion or real audio work. The source report is not a merge-ready status.

## Tests and review obligations

Test the official residual definition and ±1e-6 dB history matching, current/stale lineage separation, all hypothesis branches, 20-by-7 coverage, corruption/identity failure, zero-writes modes, isolated dual-copy idempotence and conflict, and final blocked acoustic status. Verify against real parent evidence only where that private evidence is accessible; otherwise report exact blockage and leave those tests NOT RUN. Preserve the previously approved review-02 workstream and its reviewer findings.
