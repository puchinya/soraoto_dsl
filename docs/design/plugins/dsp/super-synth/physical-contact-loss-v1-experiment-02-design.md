<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Issue #7 — Physical Contact Loss experiment-02 Design

- **Owner:** Issue #7 / PR #8
- **Normative owner:** [experiment-02 amendment](../../../../specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md)
- **Contract:** [successor Implementation Contract](physical-contact-loss-v1-experiment-02-contract.md)
**Approval marker:** `ISSUE7_CONTACT_LOSS_V1_EXPERIMENT_02_APPROVED`

## Design decision

Use one append-only `experiment-02` dual-store root and treat `experiment-01` as immutable parent evidence. The existing runner remains the single orchestration owner; its active CLI modes default to the fixed successor epoch, and its resolver accepts only the exact approved epoch identifiers. Writes are permitted only to experiment-02. The runner reads experiment-01 solely to authenticate its parent proof.

The existing 42-call allocation is consumed at most once across both epochs. Since the authenticated experiment-01 ledger contains no call starts or terminal result, experiment-02 receives the unchanged fixed 42-cell plan. The original 1,962 downstream reserve and 5,255 lifetime ceiling remain unchanged.

## Ownership and data flow

| Owner | Responsibility |
|---|---|
| `run-issue7-contact-loss-v1.cjs::resolveRoots` | Resolve exactly experiment-01 or experiment-02 roots; default active execution to experiment-02. Reject arbitrary epoch names. |
| Successor parent verifier | Read both experiment-01 stores; require the fixed prepare/plan/Gate3 hashes, exact root member set, matching bytes, and zero charged/completed/ambiguous calls. Return parent hash/size/mtime inventory without writes. |
| `prepareExperiment` | Require both Issue markers, PR/current HEAD/source/build identities, fresh Gate3 report, and exact parent proof. Write immutable `gate3-analysis.json`, `plan.json`, and `prepare.json` only under experiment-02. Recheck the predecessor inventory before and after creation. |
| `readExperimentState` and evidence readers | Bind prepare, starts, metadata, completion, candidate reports and acceptance calls to `experiment-02`; reject cross-epoch, source, WAV, metadata or parent mismatches. |
| Read-only modes | Report current epoch, predecessor, exact prepared/current HEAD, call totals and writes=0. Do not create roots or update mtimes. |

Before any rendering, the execution reads the durable successor preparation, validates the full source-bound Gate3 report and archive identity, verifies the diagnostic WASM, then writes and reads back a charged start marker in both stores. It renders once, stores WAV and metadata in both stores, hashes/readbacks both copies, and only then writes the complete marker. Ambiguous starts are permanently charged and never rerendered.

## Failure handling

Any parent mismatch, extra/missing root member, nonzero experiment-01 call, existing experiment-01 terminal/selection, stale PR or HEAD, dirty tree, Issue marker loss, source/WASM/archive drift, partial dual write, unknown lock, concurrent writer, or ambiguous call blocks. Preserve all partial bytes. Do not change experiment-01, automatically create experiment-03, or move/repair the old prepare.

After a measured Gate4 PASS, the existing continuation runner performs 25 → 4 → approved two-file promotion → 24 → 486 → 1,423 with each predecessor fully stored and verified. A failed or incomplete predecessor leaves later stages NOT RUN. This design introduces no new parameter, acceptance gate, or call allocation.

## Verification mapping

| Acceptance criterion | Evidence |
|---|---|
| Fixed epoch paths and parent immutability | Resolver allowlist tests; before/after SHA, size and mtime inventory tests |
| Parent zero-call proof and malformed-parent rejection | Missing/extra/corrupt/one-sided/nonzero predecessor fixtures |
| One-time 42-call cap and unchanged 1,962 reserve | Cross-epoch accounting and over-budget tests |
| Epoch/source/HEAD/WASM binding | Stale HEAD, source drift, build drift, approval removal and cross-epoch artifact tests |
| Start-before-render and ambiguous no-replay | Existing failure injection extended to epoch-02 roots |
| Strict product separation | Required diagnostic/production build matrix, production export check, alpha-1 PCM comparison |
| Old evidence preservation | Full primary/secondary experiment-01 SHA/size/mtime snapshots before and after prepare/verify |
| Actual acoustic gates | Authorized-host `--prepare`, `--verify`, `--run-bounded`, then `--continue-approved`; synthetic tests are not audio acceptance |

## Scope boundaries

No change to `plugin.c`, presets, generated profiles, Plugin ABI, DSL, old P5/v3/v4/offline evidence, Stage3/4 evaluators, quality thresholds, or audio-call budget. `.vscode/settings.json` is separately ignored as previously requested; its contents are not staged or committed.
