# Issue #7 / PR #8 — Experiment-02 Continuation-05 Owner-Lock Recovery Contract

**Date:** 2026-11-16 (JST)  
**Approval:** The user instructed 「追補して」 in this Codex chat. This contract is to be appended to Issue #7; no approval comment is required or to be posted.  
**Approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05_APPROVED`

## Scope and observed blocker

This is one narrowly scoped recovery of the first bounded-run attempt after continuation-04. At pushed PR #8 HEAD `be2d89ca21e2286954196b426a97995cb3b9540a`, `--run-bounded` stopped before a ledger start, render, or acoustic call with `BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_ROOT_MEMBERS`. The runner held its own writer lock, but `combinedExperimentCalls()` re-read experiment state without receiving that owner lock and therefore treated the caller's lock as an unexpected root member. Read-only inspection confirmed the mirrored root member sets matched, there was no remaining lock, both experiment subdirectories were empty, and counters remained 0 started / 0 completed / 0 ambiguous.

## Authorized changes

1. Preserve continuation-04 and every earlier receipt, preflight, report, manifest, parent record, and per-copy mtime byte-for-byte. Do not repair, delete, replace, re-sign, or move any existing evidence.
2. Permit the minimum contract/design record, contact-loss runner, and runner regression-test changes required to pass the exact currently owned writer lock through `combinedExperimentCalls()` during a locked bounded-run or approved continuation. The reader must still reject absent, foreign, stale, or mismatched locks; do not broadly ignore `writer.lock` or relax root membership checks.
3. Add regressions proving that the active caller's exact owner lock permits its state/accounting read and that an unrelated or mismatched lock remains fail-closed. Preserve the existing lock lifecycle and all failure handling.
4. Commit and push the scoped changes to PR #8. Bind all new evidence to the exact clean pushed HEAD and tree. Update the Issue record with those identities; expected HEAD movement from this authorized push is not a reason to stop.
5. Permit one append-only Gate 0–2 report/manifest publication at `physical-root-cause-offline-v1/analysis-24` for that HEAD, one complete strict zero-acoustic preflight at the same HEAD, and—only if every required check passes—one dual-store append of `recovery-preflight-<HEAD>.json` and `prepare-recovery-continuation-05.json` to the existing experiment-02 epoch. The new records must bind continuation-04 and all earlier records, analysis-20 through analysis-24, exact source/parent/frozen inventories, build identities, the new HEAD/tree, exact preflight result, and zero-call counters.
6. Preserve the physical model, official metrics and thresholds, gates, ordered stages, and accounting: experiment-02 shared cap 42, downstream reserve 1,962, historical calls 3,251, lifetime cap 5,255. Do not start a ledger cell, render, build for acoustic output, or make an acoustic call before the new same-HEAD preflight, `--status`, and `--verify` all pass after the append.
7. After those gates pass, resume only the existing bounded experiment under its existing failure terminals and shared cap. This amendment authorizes no new physical mechanism, search range, threshold, budget, stage ordering, or experiment epoch. Actual acoustic failure remains fail-closed.

## Finite recovery boundary

This is the only continuation-05 recovery authorization. If source checks, the offline publication, the strict preflight, either mirrored append, post-write status, or verification fails or is ambiguous, preserve all evidence and counters, report the exact blocker, and stop without repair, retry, a further recovery receipt, or acoustic execution. Gate 3/4 and product acceptance must not be reported PASS unless their existing measured gates actually pass.

## Required report

Record the final PR URL, pushed HEAD/tree, this contract SHA, modified files, regression and preflight results (including every CTest result and skip count), analysis-24 report/manifest SHAs, recovery receipt/preflight SHAs, both-copy readback, status/verify, experiment and historical counters, audio/render/build counts, and remaining gates. Clearly distinguish this recovery's successful preflight from acoustic acceptance.
