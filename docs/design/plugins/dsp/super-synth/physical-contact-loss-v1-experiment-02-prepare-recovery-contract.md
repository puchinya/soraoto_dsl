<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Issue #7 — experiment-02 prepare binding recovery contract

- **Status:** approved by the user in Codex on 2026-11-15 JST; recorded in Issue #7 body.
- **Issue / PR:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7) / [#8](https://github.com/puchinya/soraoto_dsl/pull/8)
- **Approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_APPROVED`
- **Amends:** only recovery from the malformed experiment-02 preparation described below.
- **Existing epoch:** `physical-contact-loss-v1/experiment-02`; no new epoch is authorized.

## Observed immutable state

The approved preflight completed on pushed HEAD `7f7fd1074be24bada371a517468f1ff4366ef1fc` with SHA-256 `07a26cee19ba84b588d33f6e5967be5b3913ce11daf1eb0e6039c350894f3cb1`. Read-only status confirmed the preflight was ready, the experiment-01 parent had 0/0/0 calls, and the active budget remained 42 experiment calls, 1,962 downstream calls, 3,251 historic calls, and a 5,255 lifetime cap.

`--prepare` then created the immutable dual-store `prepare.json` with SHA-256 `37b1d47a1329a48298feea6bc93f6bf540e50b30853abe10bc7b40fcac9bd8fd`, plus `plan.json` (`0eaa7f377420d893acb6692f08aa0a6fa0b9035f26422c7d284a15d5fa08f52a`) and `gate3-analysis.json` (`df8fd945bc2936e99c51c082b4ad92d31921321b5a8332643d1e56227c93fcc2`). All four root members match byte-for-byte between stores. The prepare record has zero started/completed/ambiguous calls and no cell start records.

The defect is limited to serialization: `verifyPreflightForPrepare()` returns `preflightSha256`, while the prepare writer reads `preflight.sha256`. JSON serialization therefore omitted the `preflightSha256` field. `--status` correctly fails closed with `BLOCKED_CONTACT_LOSS_PREPARE_IDENTITY`. No acoustic render or call has started.

## Approved recovery

1. Preserve the existing `prepare.json`, `plan.json`, `gate3-analysis.json`, and original `preflight-7f7fd1074be24bada371a517468f1ff4366ef1fc.json` byte-for-byte and preserve their mtimes. Preserve experiment-01 and all frozen evidence.
2. Correct the prepare writer to store the returned `preflight.preflightSha256`; add regression coverage for the binding. The only changed implementation-source snapshot entries may be `wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs` and `wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs`. The approved normative document delta is limited to `docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md`, `docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md`, and this recovery contract. Every other source-snapshot entry MUST remain byte-identical to the original preflight. No Plugin/DSP source, preset, generated profile, evaluator, ABI, metric, or threshold may change.
3. Commit and push the correction to the existing PR #8 branch. The recovery requires the exact clean pushed HEAD and current Issue approval marker.
4. Run one strict, zero-acoustic recovery preflight for that new HEAD. It repeats the approved diagnostic/production builds, focused Node and CTest suites, offline/frozen suite, and full CTest classification. Require zero skips; the only allowed full-CTest result remains the exact `BASELINE_FAILURES_DISCLOSED` set and signatures in the approved CTest order contract. Any other result blocks recovery.
6. Readers may accept the missing original `prepare.json::preflightSha256` only when the exact immutable original prepare and preflight SHAs above, the complete recovery receipt, and its current-HEAD recovery preflight all authenticate in both stores. Preserve the original prepare's `head` and `source` as historical preparation identities. Record the recovery commit as `executionHead`; all later acoustic start, metadata, completion, and candidate evidence must bind to `executionHead` and the unchanged diagnostic WASM SHA. A subsequent HEAD/source change blocks.
7. Before any acoustic call, read back and verify every recovery record, confirm the old four members remain byte/mtime unchanged, and require `--status` and `--verify` to pass with 0/0/0 experiment calls. Only then may the existing approved `--run-bounded` sequence start.

## Fixed boundaries

- No additional acoustic allocation: experiment-01 + experiment-02 remains at most 42 calls; downstream reserve 1,962, historic calls 3,251, lifetime cap 5,255.
- No experiment-03, re-preparation, overwrite, deletion, re-signing, re-rendering, acceptance relaxation, or stage reordering.
- Failed recovery preflight or recovery readback leaves all original records untouched and authorizes zero acoustic calls.
- The full CTest pre-Stage4 result is never called PASS. The approved three failures remain disclosed exactly as previously defined; post-Stage4 full CTest still requires every test to pass.
- Public evidence may contain hashes, filenames relative to the epoch, counts and outcomes; it must not expose private absolute paths, credentials, WAV bytes, or raw private artifacts.

## Reviewer checklist

- [ ] Issue marker and exact contract SHA match; PR #8 is open at the clean recovery HEAD.
- [ ] The four original experiment-02 members and all experiment-01/frozen evidence are unchanged by hash and mtime.
- [ ] The prepare serialization regression proves `preflightSha256` is present and exact.
- [ ] Recovery preflight runs the complete approved matrix with zero skips and exact full-CTest baseline classification.
- [ ] Recovery receipt authenticates original prepare/preflight, new recovery preflight, the exact two-file implementation-source delta and three-file normative-document delta, parent proof, Gate3, WASM identities and budgets.
- [ ] Readers use `executionHead` only after authenticating the recovery receipt; every later artifact binds to it.
- [ ] Any missing, partial, one-sided, stale or contradictory recovery evidence fails closed without a call.
- [ ] No acoustic call starts until current `--status` and `--verify` both pass after recovery.

### Continuation-03 reviewer checklist

- [ ] Issue approval marker and current design/contract SHA values match the pushed implementation.
- [ ] The original six root records and continuation-02 preflight/receipt remain byte-identical with unchanged per-copy mtimes.
- [ ] Continuation-02 is validated using its recorded historical design SHA; continuation-03 binds to analysis-22 and the exact final pushed HEAD.
- [ ] The new preflight and receipt bind analysis-20/21/22, parent/source/frozen evidence, current build identities, 0/0/0 calls, and unchanged budgets.
- [ ] Dual-store readback, `--status`, and `--verify` pass at the same HEAD before any acoustic call.
- [ ] Failure or partial append blocks without repair; no further recovery append is permitted.

## Document impact

- Specification: `physical-contact-loss-v1-experiment-02-amendment.md`.
- Design: `physical-contact-loss-v1-experiment-02-design.md`.
- Status: evidence-only; measured outcomes remain in private receipts and Issue #7 body.

## Approved continuation-03 recovery (2026-11-15)

**Approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_ANALYSIS22_AMENDMENT_APPROVED`
**Prior continuation-02 receipt:** SHA-256 `2a3dbcab25a699a38856a9e9c412aa2cda1c411b4c365ceb019683df932aae28`
**Prior continuation-02 preflight:** SHA-256 `ee5dd614522c3e3064efab5baaeac1deef9bce333600d4c498e6f35e1f8a6d86`
**Offline evidence epoch:** `physical-root-cause-offline-v1/analysis-22`

The approved append repairs the post-write reader identity mismatch without changing any stored record. The continuation-02 receipt and preflight stay byte-for-byte unchanged and are authenticated using the design SHA they record (`ebcabaa5835a7f1987fa1bcc1a3a269392889252643c73ea93ee134d223feb58`).

The runner first authenticates the original preparation and first recovery, then verifies continuation-02 and snapshots its complete eight-file experiment-02 prefix. At the final clean pushed PR #8 HEAD it verifies the single analysis-22 offline report/manifest pair and completes the existing strict preflight matrix with zero skips and the exact approved full-CTest baseline classification. Only after all checks pass may it append a recovery preflight and `prepare-recovery-continuation-03.json`, each dual-store and immutable. The receipt binds the previous continuation-02 report and preflight, the original preparation hashes, the first recovery hashes, analysis-20/21/22 identities, exact current HEAD, source delta, parent/frozen inventories, unchanged diagnostic and production WASM identities, 0/0/0 calls, and the fixed 42/1,962/3,251/5,255 accounting.

After the append, the reader verifies all prior and new records, exact root membership, per-copy prior snapshots, and same-HEAD source/build/offline identities. Acoustic execution remains prohibited until both `--status` and `--verify` pass at the same HEAD. Failure preserves any partial append and blocks; there is no retry, overwrite, repair, or further recovery authorization.

## Approved continuation-04 recovery (2026-11-16)

**Issue approval marker:** `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_ANALYSIS23_AMENDMENT_APPROVED`
**Prior continuation-03 execution HEAD:** `3cde7239219e20e5366e0ee9174a9bfbb76c23cd`
**Prior continuation-03 receipt SHA-256:** `64d087ea8861d55de24ef157386612eee920614fbe1fc7f38c17b1f0632c95ed`
**Prior continuation-03 recovery-preflight SHA-256:** `a09b226809b839c0d56ee0327030fa80b2e88fe4d73dcce98bc24082a07b6f03`
**Offline evidence epoch:** `physical-root-cause-offline-v1/analysis-23`
**Receipt:** `prepare-recovery-continuation-04.json`

The pushed continuation-03 reader correction at `fd1e1f68e43eb6ca2ae9d99d742ab4041ce378d5` exposed a new final-HEAD requirement. The Issue body authorizes this one continuation and no later recovery append. Preserve every previous receipt, preflight, analysis-20/21/22 report and manifest, dual-store object and per-copy mtime. Preserve the experiment-02 physical parameters, quality thresholds, stage ordering, and 42/1,962/3,251/5,255 accounting.

1. Permit only the existing amendment, design and this recovery contract plus the contact-loss runner and its tests to change. Commit and push to PR #8. Bind execution to the exact clean pushed HEAD; expected HEAD movement from this approved change is automatically recorded in Issue #7.
2. Publish exactly one Gate 0–2 analysis-23 report/manifest pair for that HEAD. Then run exactly one complete strict zero-acoustic preflight at the same HEAD. The preflight must authenticate the ten-file continuation-03 experiment-02 prefix, all earlier receipts and preflights, analysis-20/21/22, the 140-cell Gate3 evidence, source/parent/frozen/build identities and the existing approved CTest classification.
3. Only if all checks pass, append `recovery-preflight-<HEAD>.json` and one immutable dual-store `prepare-recovery-continuation-04.json`. The receipt binds continuation-03 and its preflight, all original preparation/recovery and continuation-02 records, analysis-20/21/22/23, exact source delta, current HEAD, unchanged parent/frozen/build identities, 0/0/0 calls and fixed budgets. Verify both copies and exact root membership.
4. Require same-HEAD `--status` and `--verify` to pass before any experiment ledger start, render or acoustic call. Then continue only through the existing bounded execution contract. Actual acoustic gate failure remains terminal. Any preflight mismatch or partial append preserves the state, blocks and forbids repair/retry.

### Continuation-04 reviewer checklist

- [ ] Issue approval marker is present; PR #8 is open at the exact clean pushed implementation HEAD.
- [ ] All ten prior experiment-02 root files and analysis-20/21/22 retain their per-copy SHA/size/mtime; the complete prior receipt chain verifies.
- [ ] Exactly one analysis-23 report/manifest and one strict zero-acoustic preflight are bound to the same HEAD.
- [ ] The new recovery preflight and receipt are the only two additional experiment-02 root members and bind all prior evidence, current source/parent/frozen/build identities and unchanged counters/budgets.
- [ ] Dual-store readback, `--status` and `--verify` pass at the same HEAD before any call.
- [ ] Failure or partial write blocks without repair/retry; acoustic thresholds, physical model, call budgets and stage ordering are unchanged.
