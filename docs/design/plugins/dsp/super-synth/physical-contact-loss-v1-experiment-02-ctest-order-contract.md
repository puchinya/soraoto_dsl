<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Issue #7 / PR #8 — experiment-02 CTest Gate-Order Amendment Contract

- **Status:** user-approved in this chat, 2026-11-15 JST
- **Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7)
- **PR:** [#8](https://github.com/puchinya/soraoto_dsl/pull/8)
- **Owner:** Issue #7 / PR #8
- **Approval marker:** `ISSUE7_CONTACT_LOSS_CTEST_ORDER_AMENDMENT_APPROVED`
- **Amends:** the experiment-02 [successor contract](physical-contact-loss-v1-experiment-02-contract.md), only at its pre-prepare and post-Stage4 full-CTest gates
- **Reference proposal:** [Issue #7 comment #6882025664](https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-6882025664)

## Approved scope

This contract changes only the order and classification of the full CTest gate so the existing Stage4-produced lifecycle input is not required before Stage4. The existing physical mechanism, alpha matrix, seven stress cells, product thresholds, stage order, experiment epoch, one-time 42-call cap, 1,962 downstream reserve, 3,251 historical calls, and 5,255 lifetime ceiling remain fixed. Experiment-01 and all frozen evidence remain immutable. No experiment-03, parameter search, extra acoustic call, threshold change, or product-source change is authorized.

The user approved the narrow gate-order proposal directly in chat with 「承認するので進めて」. This is the approval record; no approval comment is requested.

## Pre-prepare gate

The runner MUST provide an explicit `--preflight` operation and make `--prepare` require its authenticated, immutable dual-store receipt for the exact current pushed HEAD.

Before writing the preflight receipt, `--preflight` MUST:

1. Require Issue #7 open with both the existing experiment-02 approval marker and this amendment marker/hash; PR #8 open on the approved branch at the exact clean current HEAD.
2. Authenticate the immutable experiment-01 dual-store parent, the current-HEAD Gate3/offline report, frozen evidence inventory, Salamander archive and diagnostic/production build identities. Run the independent diagnostic and production build checks without changing any physical source or preset.
3. Run the strict Issue #7 contact-loss Node suite with zero skips; the focused contact-loss CTest targets with zero skips; and the offline/frozen regressions with zero skips on this authorized evidence host.
4. Run the full CTest suite and disclose its actual exit status, test count, every failing test, failure signatures, and stdout/stderr hashes. It MUST NOT label the full suite PASS if any test fails.
5. Permit exactly these pre-prepare full-CTest outcomes:
   - `wasm.audio-quality-regression` and `wasm.dsp.super-synth.supersynth-v9-production-lifecycle` may be classified `KNOWN_BASELINE_FAIL` only when the exact baseline test sources, inputs, product WASM identity, and complete failure signatures match baseline HEAD `3e3e3ba91b768767f38574b1dac9c65af75bbc23`.
   - `wasm.dsp.super-synth.supersynth-v9-full-range-calibration` is classified `DEFERRED_POST_STAGE4_INPUT_NOT_YET_AVAILABLE` only when its exact missing-input signature is observed with `SUPERSYNTH_LIFECYCLE_PATH` unset. It is not counted as a known baseline audio failure.
   - Any added failure, changed signature, mismatched build/input identity, skip, missing summary, nonzero unexpected exit, or unclassifiable result MUST block `--prepare`.
6. Persist a deterministic, source-bound preflight report in both experiment-02 stores, under an append-only filename bound to the exact pushed HEAD. A repeated request may reuse only byte-identical report bytes. The report records full CTest as `BASELINE_FAILURES_DISCLOSED`, never as `FULL_CTEST_PASS`.

### Approved baseline evidence

The baseline comparison uses the exact same diagnostic SuperSynth WASM (SHA-256 `f36b18c705a4ac1c965f10712ae2ebde86106c6048b3f5f6a59036e721163fd3`) and unchanged CTest source/input files. Relevant baseline/current source SHA-256 values match:

- `wasm/test/audio-quality-regression.test.js`: `cb24d7b78b9145e5d43ca4405d48a0b52259557ef7df2a45d1c04ec199c2d165`.
- `wasm/plugins/dsp/super-synth/test/tools/verify-supersynth-v9-production-lifecycle.cjs`: `7f88c043544ac0984702efe883d5b35ab3b4191bc8c41767094f39d1a573ebbd`.
- `wasm/plugins/dsp/super-synth/test/supersynth-v9-full-range-calibration.test.js`: `a78bf720b84868d41f68c91f394dad8c79d035fcc20b70dc020df2a094a075c8`.

On baseline HEAD, the first test reproduced the exact current failure `field-wind-over-lumeria: true peak -32.387194396613445`. The second test produced a full report SHA-256 `9f0e33296134825b9dc0e86f097e4648763fcae5378452bf85e4491a56df8de0`; all JSON fields including the WASM hash, 1,408 cells, 1,390 adjacent comparisons, 20 failure records, counts, maxima, and failure records exactly equal the current full-CTest embedded report. Its counts are 3 peaks at/above 0 dBFS, 6,019 guard hits, 6 pitch failures, 1 invalid pitch, and 7 adjacent-pitch failures; the worst cell peak is +1.583625266098734 dBFS. The full-CTest baseline log saved from the earlier run contained only failing test names, so the direct baseline reruns above establish the complete signatures.

The Stage4 calibration test is a separate ordering dependency. It requires the persisted Stage4 lifecycle matrix and MUST remain an actual disclosed failure before Stage4. At the post-Stage4 gate, the existing runner reconstructs the exact 1,408 lifecycle plus 15 repeat rows only from authenticated dual-store receipts, evaluates them with the existing `stage4-full-range-evaluator.cjs`, supplies the temporary document through `SUPERSYNTH_LIFECYCLE_PATH`, and requires full CTest all-pass.

## Post-Stage4 acceptance gate

The post-Stage4 full CTest run is mandatory only after the existing ordered plan has actually passed Gate4, 25 confirmation calls, 4 headroom calls, promotion, 24 release-equivalence calls, 486 Stage3 calls, and 1,423 Stage4 calls with their official gates. It MUST:

- authenticate every required Stage3/Stage4 receipt from both stores;
- reconstruct the existing 1,408 + 15 lifecycle document using the existing evaluator, without rendering or creating a canonical Stage4 file;
- write the input only to an ignored temporary path and bind the immutable full-CTest receipt to the Stage4 report SHA-256 and lifecycle-input SHA-256;
- require every test to pass, with no skips, errors, or nonzero exit; and
- retain Web Player and manual listening as separate final acceptance gates.

No extra acoustic render, threshold adjustment, failure suppression, epoch, or budget reallocation is authorized. If an actual acoustic gate fails, stop at that measured terminal and leave all later gates NOT RUN.

## Exact change boundary

Only the following files may change for this amendment:

- `docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md`;
- `docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md`;
- this new contract and its exact `.agent-state/issues/7/` mirror;
- `wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs`;
- `wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs`.

No old experiment, DSP source, preset, reference, evaluator, acceptance threshold, budget, or stage order may change.

## Reviewer checklist

- [ ] Issue #7 records the user's chat approval and this exact contract hash; its active phase follows design → ready → implementation.
- [ ] The old approved successor contract and experiment-01 bytes remain unchanged.
- [ ] `--preflight` is explicit, source/HEAD bound, dual-store, append-only and cannot create an audio call; `--prepare` requires it.
- [ ] Strict focused Node/CTest and offline/frozen runs require zero skips; command results and identities are recorded.
- [ ] The two allowed baseline failures are accepted only after exact source, WASM, input and failure-signature comparison.
- [ ] The Stage4-input failure remains visible and is classified as deferred, never as full-CTest PASS.
- [ ] Any third failure, signature drift, missing summary, stale identity or failed focused gate blocks preparation.
- [ ] Post-Stage4 full CTest reuses only authenticated 1,408 + 15 rows, the existing evaluator and temporary input; all 50 tests must pass.
- [ ] Acoustic budget and ordering remain exactly 42 then 25 → 4 → promotion → 24 → 486 → 1,423; no extra calls or changed thresholds.
- [ ] Tests cover preflight classifications, baseline mismatch, no-skip enforcement, dual-store integrity, HEAD/source drift, prepare prerequisite, and existing post-Stage4 gate behavior.
- [ ] All verification and actual experiment states are reported distinctly; no acoustic acceptance is claimed without measured gates.
