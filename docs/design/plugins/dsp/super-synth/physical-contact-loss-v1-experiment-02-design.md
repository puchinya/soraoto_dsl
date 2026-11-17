<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Issue #7 — Physical Contact Loss experiment-02 Design

- **Owner:** Issue #7 / PR #8
- **Normative owner:** [experiment-02 amendment](../../../../specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md)
- **Contract:** [successor Implementation Contract](physical-contact-loss-v1-experiment-02-contract.md)
- **CTest order amendment:** [approved amendment contract](physical-contact-loss-v1-experiment-02-ctest-order-contract.md), SHA-256 `106f22061781a2826a77d3ca0f83b85c79a7e03de4187c3407138090ae6d4ae3`
- **Prepare recovery amendment:** [approved recovery contract](physical-contact-loss-v1-experiment-02-prepare-recovery-contract.md), SHA-256 `20241190b844ba47f3d317891776ba523ced0fa517c05207be9fa75e8ebd7be0`
- **Continuation-06 recovery amendment:** [approved state-reader recovery contract](physical-contact-loss-v1-experiment-02-continuation-06-recovery-contract.md), SHA-256 `cd735bc1d262811927c28c5b2921cb34ee73ffea0ba70bb8530cffaf52addec6`
- **Continuation-07 recovery amendment:** [approved Gate3 recheck recovery contract](physical-contact-loss-v1-experiment-02-continuation-07-recovery-contract.md)
- **Continuation-07 contract SHA-256:** `0ac392630ebc956c1f5085067394bc372f7338c7d34e1fa2069ccedbe5bbd9ef` (5,753 bytes)
- **Approval markers:** `ISSUE7_CONTACT_LOSS_V1_EXPERIMENT_02_APPROVED`, `ISSUE7_CONTACT_LOSS_CTEST_ORDER_AMENDMENT_APPROVED`, `ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_APPROVED`

## Context and goals

Use one append-only `experiment-02` dual-store root and treat `experiment-01` as immutable parent evidence. The existing runner remains the single orchestration owner; its active CLI modes default to the fixed successor epoch, and its resolver accepts only the exact approved epoch identifiers. Writes are permitted only to experiment-02. The runner reads experiment-01 solely to authenticate its parent proof.

The existing 42-call allocation is consumed at most once across both epochs. Since the authenticated experiment-01 ledger contains no call starts or terminal result, experiment-02 receives the unchanged fixed 42-cell plan. The original 1,962 downstream reserve and 5,255 lifetime ceiling remain unchanged.

## Architecture

The current contact-loss runner remains the single owner of experiment and acceptance orchestration. It uses fixed experiment-02 roots for new writes, treats experiment-01 only as immutable parent evidence, and advances through the already approved stages in order. A new `--preflight` operation owns the approved pre-prepare build/test gate and persists one immutable report per pushed HEAD. `--prepare` authenticates that report before creating experiment evidence. The post-Stage4 full-CTest check consumes reconstructed rows from saved evidence and does not render audio or change the acoustic budget.

For the specifically approved malformed preparation, `--recover-prepared` authenticates the four original dual-store root members and zero-call state, repeats the full strict preflight on the pushed HEAD, then appends a recovery preflight and receipt without rewriting the original preparation or preflight. The first approved recovery append is immutable. Its post-write reader defect is recorded in Issue #7; the receipt and its preflight remain historical evidence and are never repaired in place.

The separately approved Prepare Recovery Continuation 02 extends this single case once. It first authenticates the exact six existing experiment-02 root members, including both files from the first recovery append. The prior failed attempt's `analysis-20` publication remains immutable and bound to its original pushed HEAD. Under the approved analysis-21 amendment, the runner binds the new offline `analysis-21` report and strict recovery preflight to the final pushed PR HEAD. It appends `recovery-preflight-<HEAD>.json` and `prepare-recovery-continuation-02.json` as the only two additional experiment-02 root members. The first recovery receipt is verified against its pinned `analysis-19` report, and the amended continuation verifies `analysis-21` as the latest offline epoch for the final HEAD. The continuation receipt binds the original four record hashes, first recovery receipt/preflight hashes, immutable analysis-20 identity, analysis-21 report/manifest, new preflight, unchanged parent and WASM identities, source/frozen snapshots, zero counters, and unchanged budgets. Only the continuation supplies the current execution HEAD after both receipts verify.

The original prepare's frozen offline inventory ends at `analysis-17`. The amended continuation therefore authenticates the four append-only epochs `analysis-18` through `analysis-21`; it never rewrites or substitutes analysis-20. While holding the active writer lock, prefix verification must exclude only the owned `writer.lock` member from exact root membership and still verify every prior file's SHA, size, and per-copy mtime.

## Data flow and ownership

| Owner | Responsibility |
|---|---|
| `run-issue7-contact-loss-v1.cjs::resolveRoots` | Resolve exactly experiment-01 or experiment-02 roots; default active execution to experiment-02. Reject arbitrary epoch names. |
| Successor parent verifier | Read both experiment-01 stores; require the fixed prepare/plan/Gate3 hashes, exact root member set, matching bytes, and zero charged/completed/ambiguous calls. Return parent hash/size/mtime inventory without writes. |
| `preflightExperiment` | Require both Issue approval records, exact pushed PR HEAD, parent proof, fresh Gate3 report, frozen inventory and build identities. Run strict focused and frozen tests with zero skips plus full CTest; classify only the exact approved baseline failures and deferred Stage4 input failure. Append `preflight-<HEAD>.json` to both experiment-02 stores only after all preflight conditions pass. |
| `prepareExperiment` | Require a matching dual-store preflight receipt, both Issue markers, PR/current HEAD/source/build identities, fresh Gate3 report, and exact parent proof. Record the preflight digest in immutable `prepare.json` alongside `gate3-analysis.json` and `plan.json`. Recheck the predecessor inventory before and after creation. |
| `recoverPreparedExperiment` | Accept the exact approved malformed prepare/preflight hashes. The first recovery appends its preflight and receipt once. The amended continuation authenticates that immutable six-member state, verifies the first receipt using its bound offline epoch, then appends exactly one analysis-21-bound recovery preflight and continuation receipt for the final pushed HEAD. Under the writer lock it excludes only that owned lock from the prior-member set. Every append uses immutable dual-store readback. |
| `readExperimentState` and evidence readers | Bind prepare, starts, metadata, completion, candidate reports and acceptance calls to `experiment-02`; reject cross-epoch, source, WAV, metadata or parent mismatches. |
| `verifyPreparedCurrent` | Select the expected offline Gate 3 epoch from the authenticated recovery receipt kind: the first recovery remains pinned to analysis-19, while continuation 02 is pinned to analysis-21. Apply that same binding after receipt write and on later read-only verification. |
| Read-only modes | Report current epoch, predecessor, preflight/prepared/current HEAD, call totals and writes=0. Do not create roots or update mtimes. |

Before any rendering, the execution reads the durable successor preparation, validates the full source-bound Gate3 report and archive identity, verifies the diagnostic WASM, then writes and reads back a charged start marker in both stores. It renders once, stores WAV and metadata in both stores, hashes/readbacks both copies, and only then writes the complete marker. Ambiguous starts are permanently charged and never rerendered.

## Failure handling

Any parent mismatch, unexpected root member, nonzero experiment-01 call, existing experiment-01 terminal/selection, stale PR or HEAD, dirty tree, Issue marker loss, source/WASM/archive drift, partial dual write, unknown lock, concurrent writer, or ambiguous call blocks. Preserve all partial bytes. Do not change experiment-01 or create experiment-03. The ordinary post-prepare HEAD stop has only the exact first recovery and the separately approved single continuation exception; neither may move, repair or re-sign an earlier record. The first recovery verifies offline analysis-19 by its pinned epoch even after analysis-20 exists; the amended continuation verifies analysis-21 as the latest report for its exact final HEAD.

Preflight records are immutable and keyed by the exact pushed HEAD. A report is eligible only if focused contact-loss Node/CTest and offline/frozen tests have zero skips, and its full CTest result contains exactly the two baseline failures and the expected missing Stage4-input failure. Both baseline failures must match the fixed WASM/input/source identities and full measured signatures in the approved amendment contract. Additional or changed failures block. The pre-Stage4 report records `BASELINE_FAILURES_DISCLOSED`; it never claims full CTest PASS. Any partial dual-store preflight write is retained and blocks; do not repair it in place.

After a measured Gate4 PASS, the existing continuation runner performs 25 → 4 → approved two-file promotion → 24 → 486 → 1,423 with each predecessor fully stored and verified. A failed or incomplete predecessor leaves later stages NOT RUN. This design introduces no new parameter, acceptance gate, or call allocation.

## Requirements traceability

| Acceptance criterion | Evidence |
|---|---|
| Fixed epoch paths and parent immutability | Resolver allowlist tests; before/after SHA, size and mtime inventory tests |
| Parent zero-call proof and malformed-parent rejection | Missing/extra/corrupt/one-sided/nonzero predecessor fixtures |
| One-time 42-call cap and unchanged 1,962 reserve | Cross-epoch accounting and over-budget tests |
| Epoch/source/HEAD/WASM binding | Stale HEAD, source drift, build drift, approval removal and cross-epoch artifact tests |
| Start-before-render and ambiguous no-replay | Existing failure injection extended to epoch-02 roots |
| Strict product separation | Required diagnostic/production build matrix, production export check, alpha-1 PCM comparison |
| Pre-prepare order exception | Pushed-HEAD-bound preflight receipt; focused and frozen suites have zero skips; exact baseline signatures and deferred Stage4 input failure are preserved |
| Prepare cannot bypass preflight | Missing, one-sided, stale-head, source-mismatched or contract-mismatched preflight receipt tests block before any experiment plan write |
| Malformed prepare recovery and continuation 02 | Exact original hashes, first recovery preflight/receipt preserved, six-member before-state, immutable analysis-20 plus one analysis-21 append, one final-HEAD preflight and continuation receipt, zero calls, exact source delta, sequential receipt verification, lock-aware prefix validation, partial-write rejection and current execution-head binding |
| Old evidence preservation | Full primary/secondary experiment-01 SHA/size/mtime snapshots before and after prepare/verify |
| Actual acoustic gates | Authorized-host `--preflight`, `--prepare`, `--verify`, `--run-bounded`, then `--continue-approved`; synthetic tests are not audio acceptance |
| Post-Stage4 full CTest | Authenticated 1,408 + 15 lifecycle receipts, existing evaluator, temporary input, Stage4/input-bound report and all-pass result |

## Verification strategy

The preflight runs the approved focused and frozen suites with zero skips, then executes full CTest and records every result. Only the two byte/signature-identical baseline audio failures are classified `KNOWN_BASELINE_FAIL`; the missing Stage4 matrix is reported as `DEFERRED_POST_STAGE4_INPUT_NOT_YET_AVAILABLE`. No full-CTest PASS is claimed at this point. `--prepare` is gated on the immutable report for the exact pushed HEAD. After Stage4 PASS, read back and authenticate all Stage3/Stage4 dual-store rows, reconstruct the existing full-range calibration document in a temporary file under ignored `build/`, and run the full CTest suite with `SUPERSYNTH_LIFECYCLE_PATH`. Store the CTest outcome immutably with the Stage4 report and input hashes, then remove the temporary file. Read-only status and verification modes must neither construct the input nor run CTest.

## Alternatives considered

Reusing or modifying experiment-01, creating experiment-03, changing the stage order, skipping a failing test, or recreating the Stage4 input from unverified history would violate the approved contract. The selected design preserves the existing runner, budget, and private dual-store evidence model.

## Scope boundaries

No change to `plugin.c`, presets, generated profiles, Plugin ABI, DSL, old P5/v3/v4/offline evidence, Stage3/4 evaluators, quality thresholds, or audio-call budget. `.vscode/settings.json` is separately ignored as previously requested; its contents are not staged or committed.

## CTest gate-order reviewer checklist

- [ ] Issue approval marker and exact contract SHA match the linked amendment.
- [ ] Strict focused Node/CTest and offline/frozen suites finish with zero skips.
- [ ] Full preflight CTest reports every failure and never claims full-suite PASS.
- [ ] Only the exact two baseline signatures and missing Stage4-input dependency are classifiable; all other changes block.
- [ ] `--prepare` verifies the immutable preflight receipt for the exact pushed HEAD and source/build identities.
- [ ] The approved one-time recovery preserves the original four members and binds the exact old prepare/preflight and new recovery-preflight hashes, permits only the two runner/test source entries plus three amendment documents, and binds later artifacts to the authenticated recovery HEAD.
- [ ] Continuation 02 preserves all six prior experiment-02 members and immutable analysis-20, reads the first receipt at pinned analysis-19, and appends only analysis-21, one final-HEAD recovery preflight, and one continuation receipt; all later artifacts bind to that final HEAD.
- [ ] Continuation 03 verifies the immutable continuation-02 record at its recorded design SHA, preserves all eight prior experiment-02 root records and analysis-20/21, and appends only analysis-22, one final-HEAD recovery preflight, and one continuation-03 receipt; same-HEAD `--status` and `--verify` pass before any call.
- [ ] Continuation 04 verifies the complete continuation-03 receipt chain, preserves all ten prior experiment-02 root files and analysis-20/21/22, and appends only analysis-23, one final-HEAD recovery preflight, and one continuation-04 receipt; same-HEAD `--status` and `--verify` pass before any call.
- [ ] Post-Stage4 full CTest consumes authenticated 1,408 + 15 rows and requires all tests to pass.
- [ ] Experiment-01, acoustic thresholds, physical mechanism, call budgets and stage order are unchanged.

Continuation-03 preserves the immutable continuation-02 receipt and preflight, all original preparation/recovery files and analysis-20/21, then appends analysis-22, its strict preflight and continuation-03. State readers validate the full chain and exact root membership before selecting its execution HEAD. The later approved continuation-04 amendment supersedes only the prior “no further recovery” limit.

## Approved continuation-04 recovery (2026-11-16)

Continuation-04 preserves the complete ten-file experiment-02 prefix through continuation-03, including every original, continuation-02 and continuation-03 record and each copy's mtime. It validates continuation-03's immutable receipt/preflight, its analysis-22 binding and the full prior chain. At the exact clean pushed PR #8 HEAD it authenticates analysis-23 and runs one complete strict zero-acoustic preflight. Only on full success does it append the final-HEAD recovery preflight and `prepare-recovery-continuation-04.json`. That receipt binds all prior receipt/preflight hashes, analysis-20/21/22/23 report/manifest identities, parent/source/frozen/build identities, zero calls, and the fixed 42/1,962/3,251/5,255 accounting. State readers select continuation-04 only after validating the entire chain, exact root membership and both dual-store readbacks. No ledger start, render or acoustic call is allowed until same-HEAD `--status` and `--verify` pass. Failed checks or partial writes remain preserved and fail closed without repair or retry.

## Approved continuation-06 state-reader recovery (2026-11-16)

The one continuation-05 command stopped in `readExperimentState` before preflight or any write: the validated continuation-04 value was block-scoped but later referenced while checking the expected recovery-preflight files. A read-only status call exposed the same `ReferenceError` at the same source line. Both experiment-02 copies still contain the exact 12-member continuation-04 prefix, with no continuation-05 recovery preflight, receipt, or experiment ledger directory. The continuation-05 record remains a failed attempt on Issue #7; it is not retried or rewritten.

Continuation-06 corrects the reader by carrying the verified continuation-04 result into the later exact-member check. Its regression covers the stored c04 path and confirms that membership is derived from the authenticated receipt. The c06 path is a distinct direct successor to c04: it rejects any c05 artifact, preserves the 12-member prefix and all prior mtimes, publishes immutable Gate 0–2 analysis-25 for the final pushed HEAD, and appends only one c06 recovery preflight and one `prepare-recovery-continuation-06.json` after every strict zero-acoustic check passes. Both copies and the complete c04 receipt chain are read back before selecting c06 as the current execution identity. A failed check is terminal for this one c06 attempt; no cleanup, retry, or audio call follows.

### Continuation-06 reviewer checklist

- [ ] The Issue approval marker and exact c06 contract SHA match the linked contract.
- [ ] The c04-state regression proves no out-of-scope `continuation04` reference remains and rejects missing, altered, or extra root members.
- [ ] All 12 c04 prefix members and the analysis-24 publication remain byte/mtime stable; c05 artifacts remain absent.
- [ ] Analysis-25 is published and verified for the exact pushed HEAD before c06 preflight.
- [ ] The c06 preflight and receipt bind c04, analysis-20 through analysis-25, source/build/parent identities, zero counters, and fixed budgets.
- [ ] Same-HEAD `--status` and `--verify` pass before the existing experiment resumes.
- [ ] Focused tests have zero skips; full CTest reports its exact result and uses only the previously approved baseline classification.
- [ ] Stage 3/4 and product acceptance reflect measured evidence only.

## Approved continuation-07 Gate3 recheck recovery (2026-11-16)

PR review `5913437327` confirmed that c06's post-test Gate3 check omitted the c06 offline epoch and therefore rejected its valid analysis-25 binding. The c06 one-shot remains terminal and its failed attempt is never retried. The experiment-02 stores still have the exact 12-member c04 prefix and 0/42 calls.

Continuation-07 uses one pure mode-to-offline-epoch resolver for the pre-test check, post-test check, and persisted-receipt verification. A fixture exercises the actual post-CTest gate before any canonical write, covering valid analysis-25/26 cases and wrong epoch, HEAD, source, frozen snapshot, and root-prefix cases. At the final clean pushed HEAD, c07 may publish and verify analysis-26, run one strict zero-acoustic preflight, and append only its recovery preflight and receipt if every gate passes. It is a direct successor to c04 and rejects c05/c06 artifacts. Any c07 failure is terminal; no cleanup, retry, or acoustic call follows. After successful dual-store readback, same-HEAD status and verify must pass before resuming the existing 42-call experiment under unchanged 1,962 / 3,251 / 5,255 accounting.

### Continuation-07 reviewer checklist

- [ ] The Issue marker and contract SHA match the approved c07 amendment.
- [ ] The same resolver drives both pre/post-test Gate3 checks and authenticated receipt epoch selection.
- [ ] The post-CTest fixture reaches the final gate before any write and covers all required drift and prefix failures with zero writes/renders/calls.
- [ ] c04's exact 12-member prefix and analysis-20 through analysis-25 remain immutable; c05/c06 remain absent.
- [ ] Analysis-26 and the c07 receipt bind to the exact pushed HEAD, c04 identity, source/parent/frozen/build evidence, and fixed accounting.
- [ ] Same-HEAD status and verify pass before any call; otherwise c07 remains terminal with experiment 0/42.
- [ ] The PR current report reflects exact current HEAD and observed evidence; Stage3/4 are not promoted without measured PASS.
