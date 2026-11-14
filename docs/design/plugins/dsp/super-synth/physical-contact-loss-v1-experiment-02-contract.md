<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Issue #7 / PR #8 — Physical Contact Loss experiment-02 Successor Contract

- **Status:** user-approved successor authorization, 2026-11-14 JST
- **Approval:** user message: 「承認するので続けて」
- **Approval marker:** `ISSUE7_CONTACT_LOSS_V1_EXPERIMENT_02_APPROVED`
- **Owner:** Issue #7 / PR #8
- **Predecessor:** `physical-contact-loss-v1/experiment-01` (immutable; 0 calls)

## Purpose and fixed scope

The original Issue approval authorized only experiment-01, whose immutable preparation is pinned to HEAD `ebc63ea6a32fa20ed531fa5cc9a517dd7693b38c`. The pushed PR HEAD has moved to `0c0f41ed8e55b539e0cafb6a7f5d982bb9ba4397`, so experiment-01 cannot be resumed or rewritten. This successor authorizes one append-only `experiment-02` namespace and no other epoch.

This is a provenance continuation of the same approved one-factor physical hypothesis, fixed alpha matrix, seven stress cells, official hard gates and stage order. It does not change the physical mechanism, parameter values, Plugin ABI, DSL, preset schema, acceptance thresholds, or renderer. No parameter search expansion or alternate mechanism is authorized.

## Immutable predecessor proof

Before creating experiment-02, read and authenticate both copies of the experiment-01 root. The expected primary and secondary member set is exactly `prepare.json`, `plan.json`, and `gate3-analysis.json`.

- Experiment-01 prepare SHA-256: `c49362c8db61ec223f78e7a326fb34eb6c49dd24f06bf48ea90bcc6d4624a24e`.
- Experiment-01 plan SHA-256: `7d80f490439baa0ca022c2372c1bcbb8236ba5315d8dd31784cd7673cb9f639b`.
- Experiment-01 Gate 3 report SHA-256: `5b406ba0921e87fa8df3c0177fb2f8fc0f239eb611ed37f47c650d7220d39636`.
- Prepared HEAD: `ebc63ea6a32fa20ed531fa5cc9a517dd7693b38c`.
- Charged / completed / ambiguous calls: `0 / 0 / 0`; no terminal or selection exists.
- Original archive SHA-256: `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b`.

The successor preparation records these identities plus each copy's SHA-256, size, and mtime. It checks the predecessor snapshot immediately before and after writing experiment-02. Any unexpected member, missing/divergent copy, changed digest/size/mtime, nonzero predecessor call, terminal, or selection blocks before creating the successor root. Never copy, rename, repair, delete, or rewrite experiment-01.

## New epoch and budget

The only new evidence paths are:

- Primary: `<git-common-dir>/soraoto-agent-state/7/physical-contact-loss-v1/experiment-02/`
- Secondary: `$HOME/.soraoto-agent-archive/soraoto_dsl/7/physical-contact-loss-v1/experiment-02/`

Experiment-02 binds this contract SHA-256, the exact current clean/pushed PR #8 HEAD and branch, the approved Issue marker, current source snapshot, diagnostic WASM identity, Gate 3 report, archive identity, both original frozen-source inventories, and the experiment-01 parent proof.

The original one-time 42-call allocation moves to experiment-02 because experiment-01 has exactly zero started calls. The combined limit across both epochs is **42**, never 42 per epoch. The fixed plan remains alpha `[1.00,0.50,0.65,0.80,1.20,1.40]` × cells `[(90,31),(93,31),(96,14),(96,31),(96,36),(96,124),(99,31)]`, in the original order. The historical 3,251 calls and the 1,962-call downstream reserve are unchanged; the lifetime ceiling remains 5,255. No calls may be borrowed, added, or rolled over.

## Execution and fail-closed rules

1. `--status`, `--analyze`, and `--verify` remain read-only. They report the epoch and both parent/current HEAD identities; they do not create roots or change mtimes.
2. `--prepare` is enabled only for experiment-02 and requires both approval markers, the exact successor contract hash, the immutable experiment-01 parent proof above, current PR #8 open at the clean pushed HEAD, current HEAD-bound Gate 3 analysis, frozen parent inventories, the authenticated Salamander archive, and a matching diagnostic build.
3. Before the first render, read back the dual-written Gate 3 report, plan and prepare record. A mismatch or interruption preserves every partial byte and blocks; no automatic cleanup or rerender is allowed.
4. Every started call is durably charged before render and carries experiment-02, source HEAD and WASM identity. Incomplete or divergent results remain ambiguous and are never retried. Candidate ranking uses only recomputed source WAV/metadata and the existing official evaluator.
5. If alpha=1 is unsafe, stop before candidate calls. If all complete candidates fail, terminate `PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT`; Stage 3/4 remain NOT RUN. A real Gate4 PASS alone permits the already approved ordered 25 → 4 → promotion → 24 → 486 → 1,423 sequence.
6. No third epoch is authorized. A source/HEAD change before experiment-02 begins invalidates its unprepared source identity and must be corrected before preparation. A source/HEAD change after immutable preparation blocks; do not rebind this epoch or create experiment-03 under this approval.

## Acceptance checklist

- Both experiment-01 copies match the fixed prepare/plan/Gate3 hashes, exact member set, zero-call counters, and before/after SHA/size/mtime.
- Experiment-02 roots are distinct, exact, dual-stored, and parent-linked; experiment-01 bytes and mtimes remain unchanged.
- A nonzero, missing, divergent, extra, or mutated parent artifact blocks before any experiment-02 write or call.
- The fixed 42-call plan is unique and ordered; combined accounting cannot exceed 42 experiment calls or 5,255 lifetime calls, and the full 1,962 reserve is retained.
- Restart, stale HEAD, issue/PR approval drift, source/WASM drift, owner lock, concurrent writer, partial dual write, and ambiguous-start cases fail closed.
- The strict diagnostic/production build matrix, focused Node tests, CTest, and frozen offline/v5 regressions pass before prepare. Real archive, Gate 3, prepare readback, and source snapshots are verified on the authorized host.
- After prepare: run only the finite approved gates. Preserve accurate `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN` states; do not claim acoustic acceptance without measured official gates.

## Non-goals and delivery

This contract does not authorize another 42 calls beyond the existing allocation, any change to frozen P5/v3/v4/offline evidence, another experiment epoch, parameter/gate redesign, PR split/merge, or Issue closure. PR #8 remains OPEN and Issue #7 remains blocked until the ordered acoustic and product-acceptance gates and final review actually pass.

The change is complete only when implementation and focused verification are committed/pushed, PR #8 reads back the exact pushed HEAD, experiment-02 preparation is immutable and dual-verified, and the finite approved execution reaches its measured terminal. Report all skipped or inaccessible real-host checks as BLOCKED/NOT RUN.
