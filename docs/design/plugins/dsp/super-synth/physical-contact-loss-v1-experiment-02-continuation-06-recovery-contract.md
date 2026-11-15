# Issue #7 / PR #8 — Experiment-02 Continuation-06 State-Reader Recovery Contract

**Date:** 2026-11-16 (JST)  
**Approval:** The user replied 「すすめて」 after being informed that a new Issue addendum was required to continue. Append this contract and marker to Issue #7; do not post an approval comment.  
**Approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06_APPROVED`

## Observed failure and verified state

At PR #8 HEAD `f51f24a4cd48b24fdecb5b4fb0d382f28d7ad26b`, the single authorized continuation-05 command exited before its preflight. A read-only stack capture localized the failure to `run-issue7-contact-loss-v1.cjs::readExperimentState`, line 3414: `ReferenceError: continuation04 is not defined`. The validated continuation-04 result was declared inside a block but referenced after that block while assembling the expected recovery-preflight member list.

The c05 command reached this state read before calling `preflightExperiment`; it therefore did not build, run tests, create a recovery preflight or receipt, start an experiment ledger cell, render, or call the acoustic runner. A subsequent read-only `--status` hit the same defect. A direct read-only inventory confirmed identical names in both experiment-02 copies: the exact 12-member prefix through continuation-04, with no c05 preflight or receipt and no experiment subdirectory. The continuation-04 receipt SHA-256 is `96d24196e6e7b585675a790b26f9a926c435556085255b2ec54ccf518b1ddc2c`; its preflight SHA-256 is `65cdc8b22ffc4d7ee5bd9e5f84fe9ea4953dd54959b28918fec6d6ca4e4d858d`.

The immutable Gate 0–2 publication `physical-root-cause-offline-v1/analysis-24` remains bound to the old HEAD `f51f24a4cd48b24fdecb5b4fb0d382f28d7ad26b`: report SHA-256 `54b0673bb2a8d375b6109ba67768a355ad0d1c0ddac7aac44485fdcda9d21759`, manifest SHA-256 `2a3456a69d09628d3afcc5e951b00222373289bc7198a3fe7156cf7b901b70b1`. Preserve it unchanged.

## Authorized scope

1. Preserve continuation-05 contract and its Issue execution record, analysis-24, all continuation-04 and earlier records, both-copy bytes and mtimes. Do not add a c05 receipt or retry c05.
2. Fix the state-reader scope defect by retaining the already-verified continuation-04 value for later recovery-preflight membership checks. Add regression coverage that exercises the verified c04 state path and proves the execution HEAD and prefix are selected without `ReferenceError`. Do not weaken receipt, owner-lock, or root-membership validation.
3. Add a distinct continuation-06 recovery path and receipt, directly succeeding continuation-04 because c05 never reached preflight and produced no files. It must authenticate the exact 12-member c04 prefix, reject any c05 artifact or unexpected root member, bind the c04 receipt/preflight SHA above, and append only a new final-HEAD recovery preflight and `prepare-recovery-continuation-06.json` to experiment-02.
4. Commit and push the scoped implementation to the existing PR #8 branch. At that final clean pushed HEAD, publish exactly one immutable Gate 0–2 report/manifest at `physical-root-cause-offline-v1/analysis-25`, then immediately verify both copies. The new Gate 3 analysis and c06 preflight/receipt must bind analysis-25 and preserve analysis-20 through analysis-24 identities.
5. Run exactly one `--recover-prepared-continuation-06` attempt. It may append only `recovery-preflight-<HEAD>.json` and `prepare-recovery-continuation-06.json`, and only after all strict zero-acoustic checks pass. Then run same-HEAD `--status` and `--verify`; both must pass before any experiment call.
6. After those checks pass, resume only the existing bounded experiment and its already-approved continuation under the same gates and budgets: experiment-02 cap 42, downstream reserve 1,962, historical calls 3,251, lifetime cap 5,255. No physical mechanism, threshold, stage order, epoch, or budget changes are authorized.

## Failure boundary

The c06 recovery attempt is one-shot. Any source, test, publication, preflight, dual-store append, status, or verification failure is recorded without cleanup or overwrite. Do not retry c06, repair partial state, create another receipt, or start acoustic execution after a failed gate. Preserve the exact 42 / 1,962 / 3,251 / 5,255 accounting. Product acceptance and Stage 3/4 are PASS only if their existing measured gates actually pass.

## Files and reviewer checklist

Allowed source/document changes are limited to this contract, the existing experiment-02 design document, `run-issue7-contact-loss-v1.cjs`, and `run-issue7-contact-loss-v1.test.cjs`. No normative specification, Plugin ABI, DSP equation, preset, historical record, WAV, or other runner may change.

- [ ] Issue marker and exact c06 contract SHA are present; PR remains open on the approved branch and exact pushed HEAD.
- [ ] The regression reproduces the c04 state-reader path and proves the verified c04 value remains in scope for root-member validation.
- [ ] All c04 and earlier bytes/mtimes and analysis-20 through analysis-24 remain unchanged; c05 receipt/preflight remain absent.
- [ ] c06 uses analysis-25 at the new pushed HEAD, authenticates the exact c04 prefix, and dual-appends only its own preflight and receipt after zero-acoustic checks pass.
- [ ] Same-HEAD status and verify pass after the append; no ledger cell starts before those gates.
- [ ] Regression/focused tests have zero skips; all full-CTest failures are classified against the already-approved exact baseline, without relaxing it.
- [ ] Audio calls, renders, budgets, Stage 3/4 outcomes, and product acceptance are reported from observed evidence only.
