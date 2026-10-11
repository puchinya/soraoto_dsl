# Durable evidence preservation

This policy applies to calibration, diagnostic, benchmark, migration, acceptance, regression, recovery, and other evidence-producing work.

## Private durable roots

Every execution uses two private roots:

```text
Primary:   <GIT_COMMON_DIR>/soraoto-agent-state/<issue>/<task>/<execution>/
Secondary: $HOME/.soraoto-agent-archive/<repository>/<issue>/<task>/<execution>/
```

The Git common directory is resolved with `git rev-parse --path-format=absolute --git-common-dir`; it is shared by linked worktrees. The secondary root is outside the repository. Never treat a worktree `.agent-state/**` directory as authoritative; it is only a compatibility/cache location. Neither durable root may be committed.

For Issue #7 Stage3E, the canonical task roots are exactly:

```text
Primary:   <GIT_COMMON_DIR>/soraoto-agent-state/7/stage3e/
Secondary: $HOME/.soraoto-agent-archive/soraoto_dsl/7/stage3e/
```

Historical phase data and new execution namespaces live below these roots. Do not relocate or copy existing evidence, search an alternate `issues/7` tree as a fallback, or promote a worktree `.agent-state/` copy. A legacy Generation-1 tombstone may be read only at its explicitly bound historical location; it is not a current Stage3E evidence root and receives no new writes.


Before the Stage3E MIDI41 derivative amendment can dry-run, persist an immutable, dual-copy identity proof at `generation-2/midi41-derivative-amendment-v1/pre-amendment-identity-proof.json` under both canonical roots. The proof separates historical Stage2Q production lineage, the Stage3D variant-0 surrogate, and the Stage3E Generation-2 candidate. Reconstruct the Generation-2 candidate identity from its creator commit and original immutable manifest/cells; compare later measurements only against that same candidate domain. Bind the proof's exact SHA-256 into amendment authorization, ledger, and result. Never rewrite earlier manifests or adopt observed values without creator-bound evidence.

For Stage3E search recovery, classify evidence instead of comparing the whole durable root to a closed file count. The proof's fixed path/SHA/size inventory is a frozen set: every listed file must remain byte-identical, and unrelated files never satisfy or replace an inventory entry. Explicitly registered execution additions are schema-checked in their owning namespace and must have matching primary/secondary bytes. Mutable ledgers are validated from an immutable genesis snapshot plus an append-only transition journal; the initial ledger SHA is not required after legitimate state transitions. `--dry-run` and `--verify` remain read-only, including timestamps. A finalized manifest, result, proof, or compatibility record is immutable.

When only verifier code changes after an acoustic creator has produced evidence, preserve the creator hashes and add a separately immutable compatibility record. It must bind the old proof, amendment result, search manifest, low-ledger genesis, new verifier commit, exact allowed source diff, unchanged capture helper/acoustic inputs, and passing zero-render tests. A pure preflight module is imported by both the CLI wrapper and phase runner; it must not import either runner. Do not re-sign old evidence or treat a changed acoustic input as a verifier-only change.


For Stage3E search-v1, the v2 compatibility record pins an accepted verifier commit as a minimum ancestor anchor. Require the immutable v1 verifier-fix commit to be its ancestor and the accepted commit to be an ancestor of current `HEAD`; never require exact `HEAD` equality or reissue v2 for later docs/status/test-only descendants. During search, changes to pinned verifier modules, capture helper, diagnostic WASM, candidate inputs, or search semantics are a hard identity blocker.

The one-time pre-render-abort recovery is limited to the forensic-bound MIDI 36 / velocity 14 low-screen row whose original error occurred before `PluginHarness` construction. Preserve the dual-copy pre-abort ledger snapshot, original authorization, and incorrect precommit result. Record the latter as `INVALID_PRECOMMIT_RESULT` in a new immutable disposition; do not rewrite the old result or journal. Requeue only when both live low-ledger copies match the independently audited pre-abort SHA, the 1,511/1/0 state counts and zero render accounting match, the existing genesis and first transition validate, no cell/sample/metric artifact exists, and the structured source/log proof establishes the exception occurred before harness construction and any DSP process call. The original one-time authorization is consumed and cannot be reused.

The v2 recovery is one resumable administrative transaction. First write and dual-verify a new compatibility sidecar, transaction intent, one-cell/zero-render authorization, staged `PENDING` ledger, and proposed `ADMIN_REQUEUE_NO_RENDER` transition. Validate the staged ledger through the production preflight and replay the journal before touching the live ledger. Then append that one transition at the existing journal location and atomically mirror only the exact staged ledger bytes to both canonical `generation-2/search-v1/low/low-ledger.json` paths. A retry may finish only the same intent and old/new byte pair. Unknown hashes, an extra transition, any captured cell artifact, or a one-sided journal blocks.

Before writing a recovery receipt or success result, read back both live ledgers and the journal tip, require `1512 PENDING / 0 IN_PROGRESS / 0 COMPLETE / 0 renders`, then run the real recovery `--verify`, Generation-2 `--dry-run`, and master `--dry-run`. All three must report zero builds, renders, and evidence writes; before/after SHA and mtime snapshots must match. Only after these gates pass may the transaction write the receipt, `STAGE3E_PRE_RENDER_ABORT_RECONCILED` result, finalized manifest, and immutable phase archive. Recovery authorizes zero acoustic calls.

All Generation-2 low-ledger readers and writers use the shared path resolver for `generation-2/search-v1/low/low-ledger.json`. The historical flat `generation-2/search-v1/low-ledger.json` path is invalid. Resolve paths beneath each existing canonical root, reject traversal and symlink escape, and use the same resolved identity in preflight, execution, verification, and recovery.

The v3 bridge is created once after the verifier fix is committed, binds that commit and the unchanged acoustic identity, and remains valid for descendant commits while all pinned executor hashes match. A later verifier-transaction sidecar pins its own anchor commit as an ancestor rather than requiring current `HEAD` equality; it is not reissued for documentation-only descendants.

Before a Stage3E cell enters `IN_PROGRESS`, validate the complete named response object `{low, mid, bassHardness}`, normalized velocity, MIDI coordinate, capture options, and helper request without constructing a render harness. Bind and dual-save a render-start marker before the first audio `process()` call. A synchronous pre-marker failure is recoverable only when the same execution records the exact abort; any interruption after the marker or any unknown render accounting remains blocked.

## Cell completion

A cell may transition to `COMPLETE` only after all of these steps succeed:

1. Atomically write the primary artifact.
2. Compute its SHA-256 from the stored bytes.
3. Atomically copy the same bytes to the secondary root.
4. Compute the secondary SHA-256 and require exact equality with the primary hash.
5. Persist the ledger transition to `COMPLETE` in both roots and verify its hashes.

If the secondary copy or verification fails, leave the cell `IN_PROGRESS` and report `BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE`. Never reset it automatically or render it again without a separate recovery decision.

### Incremental verification for Stage3E search

Stage3E search performs a complete dual-store audit at phase entry, on resume, at phase exit, and for every read-only `--verify`. During a phase, each new cell is still read back and SHA-256 checked in both stores, and each current ledger/journal transition must match its verified tip before the next cell. Reuse the phase's verified history in memory so prior completed cells and journal entries are not rehashed once per new cell. After each 64 newly completed cells, write an append-only checkpoint binding the new cell and transition bytes, sequence range, ledger SHA, journal tip, and the full-audit identity. Verify each checkpoint in both stores. Checkpoints do not replace full audits or accept unknown files, interrupted cells, identity drift, or mismatched copies.

Use a temporary sibling file, flush and close it, then rename atomically. Preserve every existing finalized artifact; do not replace it with a newly serialized equivalent.

## Required evidence and manifests

Preserve enough material to audit and resume the execution, including the execution manifest, ledger, cell/result JSON, aggregates, final results, raw metric captures, baseline/equivalence data, build identity, CMake configuration, compiler/toolchain identity, runner/helper/source/config/profile/preset/reference hashes, production and diagnostic WASM binaries used as evidence, stdout/stderr logs, recovery/tombstone data, accounting, and human-readable reports. Preserve raw audio privately when the evaluator requires it.

Each execution root contains `evidence-manifest.json` and `evidence-manifest.sha256`. The manifest enumerates every preserved file by relative path, byte size, SHA-256, artifact role, and first-observed timestamp; it also binds creator revision, execution ID/generation, runner/helper/WASM identities, start/finalization timestamps, and decision. A finalized manifest is immutable.

Create immutable `.tar.gz` phase archives in both roots at the required milestones:

```text
historical-reference-requalification
generation2-baseline
low-selection
mid-selection
stage3e-selection
production-preflight
stage3
stage4
review-handoff
```

Keep previous archives. Each archive includes the phase's full evidence and finalized manifest. Repeated finalization must verify and reuse byte-identical artifacts rather than rewrite them.

## External backup

When Google Drive is available, upload finalized phase archives, manifests, and reports under the Issue evidence folder, then read back and verify each filename, byte size, and recorded SHA-256. If Drive is unavailable, report `External backup: NOT AVAILABLE IN EXECUTION ENVIRONMENT`; this does not waive either local copy.

## Recovery and privacy

If evidence identity changes, a required copy is missing/corrupt, or a ledger is ambiguous, fail closed and preserve the current artifacts. Do not reconstruct raw rows from summaries. Do not stage or commit private roots, archives, raw audio, secrets, or machine-specific paths.
