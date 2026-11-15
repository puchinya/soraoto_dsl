<!-- agent-doc-type: implementation-contract -->
<!-- agent-doc-schema: 2 -->

# Issue #7 / PR #8 — Experiment-02 Continuation-07 Gate3 Recheck Recovery Contract

**Date:** 2026-11-16 (JST)  
**Approval basis:** The user said 「指摘対応して」 after PR review `5913437327` and inline findings `4580686747` / `4580686750`. Append this exact contract and marker to Issue #7; do not post a comment.  
**Approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07_APPROVED`

## Observed state and review findings

PR #8 is OPEN at `02953cc5c37095b3728d7318f6e0b02cf0b922d7`, tree `d567f83b0a8b6a9cd6e2c66d63b59fd40a4ba9b0`. Analysis-25 was published and immediately verified at that HEAD: report SHA-256 `f3fed67b45accb4b97f98effc3a06ce384b3708de59daff246ba876008ac0e63`, manifest SHA-256 `d9fa85b7782a8cf54cec48d39c52357db0cb8f2251ae38e243a1120e72406cdd`.

The sole c06 recovery attempt ran the strict checks and stopped at the second Gate3 comparison because its post-test expected-epoch selection omitted continuation-06 and fell back to analysis-19. It wrote no c06 preflight or receipt. Both experiment-02 stores still have the exact 12-member c04 prefix; c04 remains READY at execution HEAD `be2d89ca21e2286954196b426a97995cb3b9540a`, with 0 started/completed/ambiguous calls. Preserve the failed c06 attempt as history; never retry c06.

The latest PR review also requires (a) one shared pure mode-to-offline-epoch resolver for both pre- and post-test checks, (b) a fixture regression that exercises the post-test Gate3 gate and its negative boundaries before any canonical write, and (c) a current PR-body report.

## Authorized scope

1. Preserve c04 and all earlier receipts, preflights, reports, manifests, root bytes, per-copy mtimes, and budgets. Preserve analysis-20 through analysis-25 byte-for-byte. Do not create c05/c06 artifacts or alter their records.
2. Fix both `preflightExperiment` Gate3 comparisons to use one pure mode-to-offline-epoch function. The function must map initial recovery and continuations 02 through 07, reject unknown/conflicting modes, and be used by receipt verification where the expected offline epoch is selected.
3. Add a fixture integration around the actual post-CTest recovery gate. It must prove the strict focused Node/CTest, frozen-suite, and disclosed full-CTest baseline summaries reach the second Gate3 check before writing; valid analysis-25 and analysis-26 bindings pass for their modes; wrong epoch (including analysis-19/24), HEAD/source/frozen drift, one-sided/extra root membership, or prefix mutation fail with zero canonical writes, renders, and acoustic calls.
4. Add continuation-07 as a distinct one-shot direct successor to c04. Reject any c05/c06 artifact. Preserve the exact c04 12-member prefix. At the final clean pushed PR HEAD, publish and immediately verify exactly one immutable Gate 0–2 analysis-26 report/manifest. Only if all strict preflight checks pass may the runner append `recovery-preflight-<HEAD>.json` and `prepare-recovery-continuation-07.json` to experiment-02. Bind c04's pinned receipt/preflight, original preparation records, analysis-20 through analysis-26, exact source/parent/frozen/build snapshots, zero calls, and unchanged budgets.
5. After both c07 records are written and read back, run same-HEAD `--status` and `--verify`. Only if both pass may the existing bounded experiment resume under its existing 42-call allocation and gates.
6. Update the current PR #8 body section to report the latest pushed HEAD/tree, analysis-26 identities, c06 terminal result, c07 result, exact verification, current 0/42 accounting, and remaining Stage3/4 status. Retain old report sections as history. Keep `Closes #7` intact.

## Test and execution boundary

- Required focused tests must include all mode mappings and conflict/unknown rejection, the post-test positive path, and each named negative case. Run focused contact-loss Node and CTest, frozen offline regressions, and the preflight's full CTest classifier. The exact existing three-failure CTest baseline may be disclosed only when the runner's pinned signatures and lifecycle identity match; do not call it a full-suite PASS.
- The c07 live recovery is one-shot. Any source, publication, test, preflight, write, readback, status, or verification failure is terminal. Preserve partial bytes, do not repair, overwrite, retry, start a ledger cell, render, or call audio.
- No preflight failure is acoustic acceptance. Product acceptance and Stage3/4 can be PASS only after their measured gates pass.
- Keep the physical model, thresholds, experiment plan/order, 42-call shared cap, downstream reserve 1,962, historical count 3,251, lifetime ceiling 5,255, Plugin ABI, presets, and experiment-01 unchanged.
- Scope is limited to this contract, the experiment-02 design, the existing contact-loss runner and its test, Issue #7, and the PR #8 body. Normative specification and status mirrors remain unchanged.

## Reviewer checklist

- [ ] Issue marker, exact contract SHA, and latest review identity are recorded.
- [ ] Both Gate3 checks and receipt verification use the same pure mode resolver.
- [ ] Fixture reaches the post-CTest gate and proves valid and invalid bindings before writes.
- [ ] Analysis-20 through analysis-25 and the exact c04 dual-store prefix remain unchanged.
- [ ] The one c07 attempt binds analysis-26 and c04, rejects c05/c06 artifacts, and keeps the fixed budgets.
- [ ] Same-HEAD status/verify pass after dual-store readback before any experiment call.
- [ ] PR body current section matches the exact pushed HEAD and observed evidence.
- [ ] Audio calls remain 0 until all required gates pass; Stage3/4 and product acceptance are reported from measurements only.
