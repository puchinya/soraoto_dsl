<!-- agent-doc-type: specification -->
# Issue #7 Physical Root Cause Offline v1 Amendment

## Document Impact

- **Status:** approved implementation contract, Gate 0–2 only.
- **Issue / PR:** [Issue #7](https://github.com/puchinya/soraoto_dsl/issues/7) / [PR #8](https://github.com/puchinya/soraoto_dsl/pull/8).
- **Authority:** the approved Gate 0–2 contract, the 2026-10-25 end-to-end execution review addendum, and the Issue #7 HEAD-bound continuation authorization.
- **Scope:** historical P1 executable forensics, independent recomputation of stored PCM evidence, synthetic validation, and conditional immutable publication.
- **Out of scope:** Gate 3–6, new builds/renders/audio calls, DSP or preset changes, budget changes, PR splitting, merge, and Issue closure.

## Normative guarantees

This amendment defines an offline evidence reader. It does not establish product acoustic acceptance. The report has two independent identity axes:

1. `historicExecutableIdentity` is `VERIFIED_ORIGINAL` only when the original diagnostic WASM has SHA-256 `1028c5a77b533ba97066d116f77aab80e5e91b45ef043394875614ee3efab99a`, its four frozen exports are present, and the P1 runtime record names that exact digest. Otherwise it is `HISTORICAL_BINARY_UNAVAILABLE`; the specific forensic predicate remains separately recorded.
2. `storedPcmEvaluation` is `PCM_METRICS_RECOMPUTED_AND_MATCHED` only after both immutable copies of all 140 historical WAV/metadata pairs, the P1/P3/P5 frozen records, the 20 observation receipts, and the fixed Salamander reference archive and sample manifest have been authenticated and independently recomputed. Missing or divergent source data is `UNVERIFIABLE_SOURCE_DATA`; numerical drift is `PCM_METRIC_MISMATCH`.

One axis cannot promote the other. A PCM match never proves which executable produced the WAVs. Neither axis means Stage 3/4 or product acceptance passed.

## Frozen inputs and comparison rules

- Preserve the original v3, v4, v5, review-01, and review-02 stores byte-for-byte, including sizes and modification times. Read-only commands perform zero writes, builds, renders, or acoustic calls.
- Read the exact v3 baseline plus seven candidate vectors and the twelve unique v4 P3 vectors in their recorded order. Require seven stress cells per vector in the frozen order: `90/31`, `93/31`, `96/14`, `96/31`, `96/36`, `96/124`, `99/31`.
- Anchor P5 runtime, diagnostics, history, and terminal digests to the already published physical-root-cause-v1 report and its immutable manifest. Match the v3, v4, v5, review-01, and review-02 copy inventories, including per-copy mtimes, to that report before recomputation.
- Recompute five-window reference and measured features from the saved PCM, then apply the official direct-reference evaluator and the frozen P3 shared gain to candidate loss. Do not refit or rerank the historical search.
- IDs, provenance tags, parameter tuples, row order, metadata bytes, WAV bytes, source manifest, archive digest, and all finite checks must match exactly. Signed dB metrics allow absolute error at most `1e-6`; loss and normalized violation allow absolute error at most `1e-8`.
- The report includes maximum absolute history deltas for EARLY, LATE, post-attack shape, peak, official violation, and family loss, plus signed MIDI 96 / velocity 124 residuals. It records the reference archive SHA-256, byte size, and mtime read from the open file descriptor after confirming the file stayed stable during hashing.
- `guardHits` is authenticated from the stored metadata record. PCM cannot independently reconstruct that counter, and the report must say so.
- The full Stage 3 velocity/span acceptance remains `NOT EVALUATED`.

## Reference corpus

The only accepted archive is SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b`. The SFZ member is `SalamanderGrandPiano-SFZ+FLAC-V3+20200602/SalamanderGrandPiano-V3+20200602.sfz`. Verify the whole archive before extraction. Require one SFZ region per requested pitch/velocity, reject absolute paths and traversal, and compare each extracted FLAC digest and size with the frozen P3 source manifest. Archive selection is limited to the existing Google Drive locator or one explicit `ISSUE7_SALAMANDER_ARCHIVE_PATH`; do not search directories recursively or disclose private paths.

## Finite outcomes

The offline command terminates with one of `GATE0_2_VERIFIED_AND_PUBLISHED`, `GATE0_2_IMPLEMENTED_BUT_PRIVATE_EVIDENCE_BLOCKED`, `EVIDENCE_UNVERIFIABLE`, or `BLOCKED_DELIVERY`. A failed or unavailable historical chain remains failed or unavailable; no fallback WASM, evidence repair, or suppressed exception is permitted. Only a fully verified report with unchanged parent snapshots, exact approved Issue and PR identity, clean commit, and matching PR HEAD may be immutably appended. The original publication namespace remains fixed:

- primary: `<git-common-dir>/soraoto-agent-state/7/physical-root-cause-offline-v1/analysis-01/`
- secondary: `$HOME/.soraoto-agent-archive/soraoto_dsl/7/physical-root-cause-offline-v1/analysis-01/`

The analysis-01 report and manifest are immutable historical records and MUST NOT be rewritten, retagged, or have their mtimes changed to follow a later commit. The Issue-authorized HEAD-bound continuation uses sibling numbered epochs `analysis-02`, `analysis-03`, and so on. Each distinct pushed PR HEAD gets at most one new epoch; a retry at the same HEAD reuses that epoch only when every byte and source identity matches. Gaps, partial directories, lock residue, or mismatched prior reports block instead of being skipped.

Before publishing a continuation, the verifier MUST authenticate the existing analysis-01 report/manifest pair and compare its Gate 1 result, Gate 2 metrics, reference identity, and source snapshots with the fresh read-only analysis. It MUST preserve all earlier numbered epochs. `--verify` selects the newest complete numbered epoch and requires its recorded HEAD to equal the current clean PR HEAD; with no continuation it verifies analysis-01 and reports stale HEAD honestly. Every continuation repeats the same 20 × 7 saved-PCM evaluation and fixed reference checks. It adds zero builds, renders, acoustic calls, or budget changes and does not authorize Gate 3–6.

Before creating a continuation epoch or acquiring publication locks, the publisher MUST compare the complete evidence basis of the fresh report with both the pinned analysis-01 report and the latest authenticated continuation. This comparison includes frozen source snapshots (including mtimes), Gate 1, all Gate 2 metric results, reference identity, and the independent identity axes. A changed evidence basis MUST fail before any target epoch directory, file, or lock is created. Under the owned write transaction, immediately before the first immutable report byte, it MUST re-authenticate every prior report and manifest and verify their SHA-256, byte size, and mtime snapshots against the preflight read. Any change MUST release only locks owned by this process, preserve existing records, and leave no new target files. After immutable readback, both new-publication and byte-identical-reuse results MUST verify the actual live local HEAD and clean worktree and re-read the remote PR's current state, branch, base, and HEAD. Test-only identity providers may be injected only by tests; production paths MUST NOT substitute constants for live identity.

Continuation publication is authorized only when Issue #7 contains `HEAD_BOUND_APPEND_ONLY_CONTINUATION_APPROVED: physical-root-cause-offline-v1/analysis-02`. The marker authorizes the monotonically numbered continuation sequence for later distinct pushed HEADs while the fixed inputs and zero-acoustic boundary remain unchanged.

Each epoch is write-once, lock-protected, dual-copy, fsynced, and read back. Partial state is retained and blocks retry; it is never deleted, repaired, or overwritten automatically. A read-only or publication failure must not change any older store.

