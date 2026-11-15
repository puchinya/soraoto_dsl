<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Issue #7 — Physical Contact Loss experiment-02 Design

- **Owner:** Issue #7 / PR #8
- **Normative owner:** [experiment-02 amendment](../../../../specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md)
- **Contract:** [successor Implementation Contract](physical-contact-loss-v1-experiment-02-contract.md)
- **CTest order amendment:** [approved amendment contract](physical-contact-loss-v1-experiment-02-ctest-order-contract.md), SHA-256 `106f22061781a2826a77d3ca0f83b85c79a7e03de4187c3407138090ae6d4ae3`
- **Approval markers:** `ISSUE7_CONTACT_LOSS_V1_EXPERIMENT_02_APPROVED`, `ISSUE7_CONTACT_LOSS_CTEST_ORDER_AMENDMENT_APPROVED`

## Context and goals

Use one append-only `experiment-02` dual-store root and treat `experiment-01` as immutable parent evidence. The existing runner remains the single orchestration owner; its active CLI modes default to the fixed successor epoch, and its resolver accepts only the exact approved epoch identifiers. Writes are permitted only to experiment-02. The runner reads experiment-01 solely to authenticate its parent proof.

The existing 42-call allocation is consumed at most once across both epochs. Since the authenticated experiment-01 ledger contains no call starts or terminal result, experiment-02 receives the unchanged fixed 42-cell plan. The original 1,962 downstream reserve and 5,255 lifetime ceiling remain unchanged.

## Architecture

The current contact-loss runner remains the single owner of experiment and acceptance orchestration. It uses fixed experiment-02 roots for new writes, treats experiment-01 only as immutable parent evidence, and advances through the already approved stages in order. A new `--preflight` operation owns the approved pre-prepare build/test gate and persists one immutable report per pushed HEAD. `--prepare` authenticates that report before creating experiment evidence. The post-Stage4 full-CTest check consumes reconstructed rows from saved evidence and does not render audio or change the acoustic budget.

## Data flow and ownership

| Owner | Responsibility |
|---|---|
| `run-issue7-contact-loss-v1.cjs::resolveRoots` | Resolve exactly experiment-01 or experiment-02 roots; default active execution to experiment-02. Reject arbitrary epoch names. |
| Successor parent verifier | Read both experiment-01 stores; require the fixed prepare/plan/Gate3 hashes, exact root member set, matching bytes, and zero charged/completed/ambiguous calls. Return parent hash/size/mtime inventory without writes. |
| `preflightExperiment` | Require both Issue approval records, exact pushed PR HEAD, parent proof, fresh Gate3 report, frozen inventory and build identities. Run strict focused and frozen tests with zero skips plus full CTest; classify only the exact approved baseline failures and deferred Stage4 input failure. Append `preflight-<HEAD>.json` to both experiment-02 stores only after all preflight conditions pass. |
| `prepareExperiment` | Require a matching dual-store preflight receipt, both Issue markers, PR/current HEAD/source/build identities, fresh Gate3 report, and exact parent proof. Record the preflight digest in immutable `prepare.json` alongside `gate3-analysis.json` and `plan.json`. Recheck the predecessor inventory before and after creation. |
| `readExperimentState` and evidence readers | Bind prepare, starts, metadata, completion, candidate reports and acceptance calls to `experiment-02`; reject cross-epoch, source, WAV, metadata or parent mismatches. |
| Read-only modes | Report current epoch, predecessor, preflight/prepared/current HEAD, call totals and writes=0. Do not create roots or update mtimes. |

Before any rendering, the execution reads the durable successor preparation, validates the full source-bound Gate3 report and archive identity, verifies the diagnostic WASM, then writes and reads back a charged start marker in both stores. It renders once, stores WAV and metadata in both stores, hashes/readbacks both copies, and only then writes the complete marker. Ambiguous starts are permanently charged and never rerendered.

## Failure handling

Any parent mismatch, extra/missing root member, nonzero experiment-01 call, existing experiment-01 terminal/selection, stale PR or HEAD, dirty tree, Issue marker loss, source/WASM/archive drift, partial dual write, unknown lock, concurrent writer, or ambiguous call blocks. Preserve all partial bytes. Do not change experiment-01, automatically create experiment-03, or move/repair the old prepare.

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
- [ ] Post-Stage4 full CTest consumes authenticated 1,408 + 15 rows and requires all tests to pass.
- [ ] Experiment-01, acoustic thresholds, physical mechanism, call budgets and stage order are unchanged.
