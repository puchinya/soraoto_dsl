<!-- agent-doc-type: design -->
# Issue #7 Physical Root Cause Offline v1 Design

## Document Impact

- **Status:** design for the approved Gate 0–2 offline evidence implementation.
- **Issue / PR:** [Issue #7](https://github.com/puchinya/soraoto_dsl/issues/7) / [PR #8](https://github.com/puchinya/soraoto_dsl/pull/8).
- **Normative input:** [Physical Root Cause Offline v1 Amendment](../../../../specs/plugins/dsp/super-synth/physical-root-cause-offline-v1-amendment.md).
- **Non-goals:** production sound changes, new acoustic work, Gate 3–6, and product acceptance.
- **HEAD continuation:** preserve the original `analysis-01` publication; append one numbered sibling epoch for each distinct pushed PR HEAD under the Issue's zero-acoustic authorization.

## Owners and dependencies

`issue7-physical-root-cause-offline-v1-core.cjs` owns path resolution, dual-copy read-only access, frozen identity checks, source row verification, reference extraction, official recomputation, deterministic comparison, and report assembly. It imports only pure metric/loss/decoder helpers; it does not import a historical runner or expose filesystem write operations.

`run-issue7-physical-root-cause-offline-v1.cjs` owns argument parsing, one-time P1 forensic inspection, the finite `--analyze` and `--verify` paths, and the separately gated `--publish` transaction. GitHub access is confined to publish-time identity checks. The CLI never restores the original WASM. Publication routing keeps `analysis-01` immutable, chooses `analysis-02` for the first pushed HEAD continuation, and increments the suffix only when a new pushed HEAD differs from the latest complete publication. Re-entry at the same HEAD can only reuse byte-identical output.

The two test files own synthetic binary/data fixtures and CLI publication/failure scenarios. Actual private artifacts are inspected only on an authorized evidence host. A synthetic fixture cannot satisfy the real 140-cell evidence gate.

## Data flow

1. Resolve each historical store and the new epoch without creating paths. Reject symlinks, escapes, overlaps, half-present copies, and different copy bytes.
2. Authenticate the prior physical-root-cause-v1 report and manifest. Compare both copies of v3, v4, v5, review-01, and review-02, including relative names, byte counts, SHA-256, and per-copy modification-time digests, with the report's frozen parent inventories; never serialize private absolute paths.
3. Independently inspect the known P1 WASM path and frozen P1 record. Hash bytes, inspect WebAssembly exports, and report the five distinct forensic predicates. Do not load or instantiate the module.
4. Authenticate the P1/P3/P5 records, P3 optimizer selection, root-cause report's P5 history digest, P5 history, v3 plans/ledgers, and all 140 WAV/metadata objects by exact two-copy bytes and frozen SHA references.
5. Verify the reference archive digest and stable opened-file size/mtime before using `tar` to extract only the fixed SFZ member and selected FLAC members. Validate the single region mapping and P3 source manifest. Decode stored stereo float WAV and reference stereo PCM through the read-only analysis helpers.
6. Recompute each of the 20 seven-cell observations with the official direct-reference metrics and P3 shared gain. Compare every provenance and numeric field with the immutable P5 history and report maximum absolute errors for all compared dB and non-dB metrics. Mark metadata-sourced guard hits explicitly.
7. Re-inventory all parent stores. Any content, size, or mtime change blocks the report. Build a deterministic JSON report with the two independent identity axes and explicit Stage 3/4 `NOT EVALUATED` status.
8. Publish only after source commit, remote PR head/branch, Issue approval, report completeness, parent snapshots, and two distinct destinations are verified. Acquire an exclusive owner lock, create immutable files, fsync and read both copies. Never clean up partial output.
9. For a HEAD continuation, first authenticate the exact analysis-01 report and manifest and require its frozen Gate 1, Gate 2, reference, and source-snapshot identities to match the fresh analysis. Write to the next numbered sibling epoch; preserve and read back every prior epoch. `--verify` selects the newest continuation, checks the current clean PR HEAD, and returns a stale-head blocker when no current publication exists.

## Failure handling

All failure classes are machine-readable, finite, and path-redacted. Input mismatch returns `UNVERIFIABLE_SOURCE_DATA`; official recomputation drift returns `PCM_METRIC_MISMATCH`; absent or nonidentical original executable records `HISTORICAL_BINARY_UNAVAILABLE` plus its forensic predicate; GitHub/head/branch/approval disagreement returns `BLOCKED_PUBLICATION`; stale saved HEAD or archive/source identity returns a stale-publication blocker; partial dual-copy state or unknown lock returns `BLOCKED_PUBLICATION_STATE`. A failed old-chain verification does not erase or downgrade the separate PCM attempt when the source bytes can still be independently authenticated.

Read-only modes do not invoke write APIs. Publishing uses exclusive creation, not replace semantics. If one copy succeeds and the other fails, leave both observed states untouched and require explicit recovery design before another publish attempt.

