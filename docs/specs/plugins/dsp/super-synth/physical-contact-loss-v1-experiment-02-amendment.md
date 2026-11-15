<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# Issue #7 — Physical Contact Loss experiment-02 Amendment

- **Status:** approved by the user on 2026-11-14 JST
- **Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7)
- **Implementation:** [PR #8](https://github.com/puchinya/soraoto_dsl/pull/8)
- **Approval marker:** `ISSUE7_CONTACT_LOSS_V1_EXPERIMENT_02_APPROVED`
- **Contract:** [experiment-02 successor contract](../../../../design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-contract.md)
- **Approved gate-order amendment:** [CTest order contract](../../../../design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-ctest-order-contract.md), SHA-256 `106f22061781a2826a77d3ca0f83b85c79a7e03de4187c3407138090ae6d4ae3`
- **Amendment approval marker:** `ISSUE7_CONTACT_LOSS_CTEST_ORDER_AMENDMENT_APPROVED` (approved by the user in chat on 2026-11-15 JST)
- **Approved prepare-recovery amendment:** [prepare recovery contract](../../../../design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-prepare-recovery-contract.md), SHA-256 `20241190b844ba47f3d317891776ba523ced0fa517c05207be9fa75e8ebd7be0`
- **Recovery approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_APPROVED` (approved by the user in chat on 2026-11-15 JST)

## Purpose

This amendment authorizes exactly one append-only successor experiment epoch after proving the original epoch is empty. It preserves the approved physical model, gates, and total acoustic-call budget.

## Scope

This amendment supplements the approved [Physical Contact Loss v1 amendment](physical-contact-loss-v1-amendment.md). It supersedes only that amendment's experiment-01-only epoch destination and allocation destination. Experiment-01 remains immutable and its prepare record remains bound to HEAD `ebc63ea6a32fa20ed531fa5cc9a517dd7693b38c`.

The user authorized one append-only successor epoch because experiment-01 has exactly 0 started, 0 completed, and 0 ambiguous calls. No other epoch is authorized. All physical, acoustic, quality, compatibility, and downstream acceptance decisions remain those of the original contract.

## Normative requirements

Experiment-02 MUST use the fixed dual-store paths:

- `<git-common-dir>/soraoto-agent-state/7/physical-contact-loss-v1/experiment-02/`
- `$HOME/.soraoto-agent-archive/soraoto_dsl/7/physical-contact-loss-v1/experiment-02/`

Before any new-epoch write, verify experiment-01 has exactly these mirrored root members: `prepare.json`, `plan.json`, and `gate3-analysis.json`. Their SHA-256 values MUST be, respectively:

- `c49362c8db61ec223f78e7a326fb34eb6c49dd24f06bf48ea90bcc6d4624a24e`
- `7d80f490439baa0ca022c2372c1bcbb8236ba5315d8dd31784cd7673cb9f639b`
- `5b406ba0921e87fa8df3c0177fb2f8fc0f239eb611ed37f47c650d7220d39636`

Both copies MUST agree byte-for-byte. The predecessor prepare identifies HEAD `ebc63ea6a32fa20ed531fa5cc9a517dd7693b38c`, archive SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b`, and 0/0/0 calls. There MUST be no experiment-01 terminal, selection, call marker, WAV or metadata. Capture the two stores' full SHA/size/mtime snapshot before and after successor preparation; any mutation or unknown entry blocks and is preserved.

Experiment-02 `prepare.json` MUST record the parent epoch name, exact parent prepare/plan/Gate3 hashes, parent call totals, both-copy inventory, and source/HEAD/WASM identities. It MUST bind the exact successor contract hash and both Issue approval markers. Readers MUST validate the complete parent proof on every preparation, verification, and continuation.

## Reused one-time call allocation

The single existing 42-call authorization transfers to experiment-02 because experiment-01 has 0 charged calls. The sum of calls started in experiment-01 and experiment-02 MUST never exceed 42. Do not interpret the successor as a second 42-call allocation.

The fixed alpha order, seven stress coordinates, baseline safety gate, official metric evaluator, hard thresholds, candidate selection, failure terminal and Stage3/4 order remain byte-for-byte as specified by the original amendment. Historic calls remain 3,251; the downstream reserve remains 1,962; the lifetime ceiling remains 5,255. If no complete candidate passes all official gates, use `PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT`; do not run downstream calls.

## Security and privacy

Keep per-cell WAV and metadata in the fixed private dual-store roots. Public Issue and PR reports may include hashes, counts, aggregate results, gate decisions, and budget accounting, but must not include private filesystem paths, credentials, or raw private artifacts. Read-only commands do not mutate evidence.

## Error and boundary behavior

- All new writes MUST occur under experiment-02. Experiment-01 is read-only parent evidence.
- Only `--prepare`, bounded execution, and approved continuation may write experiment-02. Read-only status/analyze/verify must report the selected epoch, parent identity, call totals, and HEAD relation without writing or changing mtimes.
- Before the first new acoustic call, require the Issue approval marker, original approval marker, exact open PR #8 head and branch, clean tree, exact current source snapshot, accepted current-HEAD Gate3 report, authenticated Salamander archive, and matching diagnostic WASM build.
- A partial/unknown parent, copy divergence, nonzero predecessor call, stale PR/HEAD, source or WASM drift, missing archive, lock conflict, partial write or ambiguous call MUST fail closed. Do not repair, delete, re-sign, re-label or rerender evidence.
- This approval authorizes no experiment-03. If identity changes after experiment-02 is prepared, preserve it and stop.

## Observable behavior

Passing these evidence and runtime checks authorizes the fixed experiment and existing downstream gates; it is not acoustic acceptance. Only a complete measured Gate4 hard-gate PASS permits the already approved 25 confirmation calls, 4 headroom calls, promotion, 24 release-equivalence calls, 486 Stage3 calls, and 1,423 Stage4 calls, in that order. Any failure blocks all later calls. Manual listening, Web Player acceptance, review, PR merge and Issue closure remain separate final gates.

## Approved CTest gate-order amendment (2026-11-15)

The amendment changes only the pre-prepare and post-Stage4 full-CTest sequence. It does not relax an audio threshold or declare an acoustic failure acceptable.

Before `--prepare`, `--preflight` MUST run and persist a source-bound, immutable, dual-store receipt for the exact clean pushed HEAD. It requires independent diagnostic and production build checks; the strict Issue #7 Node suite, focused contact-loss CTest tests, and offline/frozen regressions with zero skips; and a full CTest run whose exit code, count, failures, signatures, and output hashes are retained. `--prepare` MUST authenticate that receipt and the same current HEAD/source/build identities. A changed source or HEAD requires a new append-only preflight receipt; no receipt may be overwritten.

The pre-prepare full suite MUST never be reported `FULL_CTEST_PASS` when it fails. Only the two actual failures proven identical against the named baseline may be classified `KNOWN_BASELINE_FAIL`: `wasm.audio-quality-regression` and `wasm.dsp.super-synth.supersynth-v9-production-lifecycle`. The current approved baseline uses the same diagnostic WASM SHA-256 `f36b18c705a4ac1c965f10712ae2ebde86106c6048b3f5f6a59036e721163fd3`; exact baseline source SHA and measured failure signatures are fixed in the linked CTest order contract. The full-range calibration test MUST remain visible as `DEFERRED_POST_STAGE4_INPUT_NOT_YET_AVAILABLE` when its required persisted Stage4 input is absent. Any additional failure, changed signature or build/input identity, skip, missing result summary, or unexplained nonzero exit blocks preparation.

Only after Gate4, 25 confirmation calls, 4 headroom calls, promotion, 24 release-equivalence calls, 486 Stage3 calls and 1,423 Stage4 calls all pass their existing measured gates may the runner reconstruct the existing 1,408 lifecycle plus 15 repeat document from authenticated dual-store receipts. It must use `stage4-full-range-evaluator.cjs`, place the temporary document under ignored `build/`, pass it through `SUPERSYNTH_LIFECYCLE_PATH`, bind the immutable full-CTest receipt to both the Stage4 report SHA-256 and lifecycle-input SHA-256, and require every test to pass. No additional render or audio call is part of this gate. Web Player and manual listening remain separate final acceptance requirements.

`--status` and `--verify` remain zero-write and do not run CTest. Any actual measured audio failure stops the approved sequence; all later stages remain NOT RUN.

## Verification strategy

Run the amended `--preflight` once on the pushed implementation HEAD and verify its dual-store readback before `--prepare`. After all 1,423 Stage4 captures and their official gates pass, run the full CTest suite again with the authenticated Stage4 input as specified above. A missing summary, nonzero exit, failed test, skip, or identity mismatch blocks final acceptance. Read-only status/verification must preserve all existing mtimes and never construct the post-Stage4 input or run CTest.

### Amendment reviewer checklist

- [ ] Issue approval marker and exact contract SHA match this amendment.
- [ ] Preflight is bound to current pushed HEAD, source snapshot, diagnostic/production builds, parent proof and Gate3 report; `--prepare` refuses to run without it.
- [ ] Focused Node/CTest and offline/frozen regressions pass with zero skips.
- [ ] Full preflight CTest is disclosed as failing if it fails; only the exact approved two baseline signatures and the deferred Stage4-input failure are classifiable.
- [ ] No additional failure, signature drift, build/input mismatch, skip or missing summary can be converted into an allowed outcome.
- [ ] Post-Stage4 CTest consumes only authenticated 1,408 + 15 receipts and requires every test to pass.
- [ ] Experiment-01 evidence, physical gates, thresholds, call budgets, Stage order and product acceptance remain unchanged.

## Approved experiment-02 prepare-binding recovery (2026-11-15)

**Approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_APPROVED`
**Contract SHA-256:** `20241190b844ba47f3d317891776ba523ced0fa517c05207be9fa75e8ebd7be0`
**Affected immutable preparation:** HEAD `7f7fd1074be24bada371a517468f1ff4366ef1fc`, prepare SHA-256 `37b1d47a1329a48298feea6bc93f6bf540e50b30853abe10bc7b40fcac9bd8fd`, original preflight `preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json`, SHA-256 `07a26cee19ba84b588d33f6e5967be5b3913ce11daf1eb0e6039c350894f3cb1`.

The approved preparation omitted `prepare.json::preflightSha256` because the writer referenced a nonexistent return property. This amendment authorizes one recovery within the existing experiment-02 epoch. It does not authorize a third epoch or mutation of any existing record. The original prepare, plan, Gate3 report and preflight remain immutable and retain their original hashes and mtimes.

The implementation MUST correct the property binding and add one `--recover-prepared` path. On the exact clean, pushed recovery HEAD, it MUST repeat the complete approved preflight matrix with zero skips and the same exact full-CTest classification. Only if it passes may the runner append a dual-store `recovery-preflight-<HEAD>.json` and one `prepare-recovery.json`. The recovery receipt MUST bind the original prepare/preflight hashes, the recovery preflight hash, exactly two changed implementation-source files (the contact-loss runner and its test), and exactly three approved normative-document entries (this specification, the experiment-02 design, and the recovery contract). Every other original source-snapshot entry MUST remain identical. The receipt also binds the current pushed HEAD, unchanged parent and Gate3 proofs, identical diagnostic and production WASM identities, unchanged frozen inventories, zero call counters and original budgets.

Readers MUST preserve the original prepared HEAD/source fields as historical preparation identity and recognize the recovery HEAD only through the fully authenticated recovery receipt. Every subsequent acoustic start, metadata, completion and candidate record MUST bind to that recovery HEAD and the unchanged diagnostic WASM. A missing, partial, divergent, stale or contradictory record blocks without repair. No acoustic call may start until current `--status` and `--verify` both pass after recovery.

This exception overrides only the prior post-prepare HEAD/source-change stop for the exact malformed preparation named above. All thresholds, physical parameters, test classification, Stage order and budgets remain unchanged. The recovery reviewer checklist is published in the linked contract and in Issue #7.

## Approved continuation-03 readback recovery (2026-11-15)

**Approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_ANALYSIS22_AMENDMENT_APPROVED`
**Issue approval:** recorded in Issue #7 body after user approval in Codex chat.
**Offline evidence epoch:** `physical-root-cause-offline-v1/analysis-22`
**Experiment evidence receipt:** `prepare-recovery-continuation-03.json`

The continuation-02 report and receipt remain immutable. The continuation-02 receipt's recorded design identity is SHA-256 `ebcabaa5835a7f1987fa1bcc1a3a269392889252643c73ea93ee134d223feb58`; readers MUST validate that historical value without requiring the current design document to retain those bytes. The post-write verification correction remains a separate pushed source identity.

One final recovery append is authorized in the existing experiment-02 epoch. Preserve the original six experiment-02 root records, the continuation-02 recovery preflight and receipt, analysis-20 and analysis-21, and every existing copy's bytes and mtime. Append exactly one Gate 0–2 report/manifest pair at analysis-22 for the final pushed PR #8 HEAD, then run one complete strict zero-acoustic preflight on that same HEAD. Only if all checks pass, append the new `recovery-preflight-<HEAD>.json` and one `prepare-recovery-continuation-03.json` dual-store receipt. The new receipt MUST link the continuation-02 receipt and preflight hashes, all original preparation records, both prior recovery pairs, analysis-20/21/22 report and manifest identities, the new preflight, parent/source/frozen snapshots, diagnostic and production WASM identities, zero-call counters, and unchanged budgets.

The continuation-03 receipt becomes the current execution identity only after both copies and the full readback verify. No experiment ledger start, render, or acoustic call is permitted until `--status` and `--verify` both pass at that exact HEAD. Existing experiment-02 physical parameters, gates, 42-call total, 1,962 downstream reserve, 3,251 historical calls, and 5,255 lifetime cap remain unchanged. Any mismatch, partial write, changed mtime, failed preflight, or readback error blocks without repair. This is the final recovery authorization; no later recovery append is allowed.
