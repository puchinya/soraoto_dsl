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

## Cell completion

A cell may transition to `COMPLETE` only after all of these steps succeed:

1. Atomically write the primary artifact.
2. Compute its SHA-256 from the stored bytes.
3. Atomically copy the same bytes to the secondary root.
4. Compute the secondary SHA-256 and require exact equality with the primary hash.
5. Persist the ledger transition to `COMPLETE` in both roots and verify its hashes.

If the secondary copy or verification fails, leave the cell `IN_PROGRESS` and report `BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE`. Never reset it automatically or render it again without a separate recovery decision.

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
