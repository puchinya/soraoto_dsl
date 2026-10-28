<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->
# Issue #7 — Physical Contact Loss v1 Design (approved)

## Normative authority and lifecycle

- Specification: [physical-contact-loss-v1-amendment.md](../../../../specs/plugins/dsp/super-synth/physical-contact-loss-v1-amendment.md).
- [Implementation Contract](https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-6473845875) SHA-256 `54838dfea9832f6da358a1c620567b09246a54fdd26fb807bc74d4ceeb6dc4aa`, [user approval](https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-6475747258), Issue body marker `ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED`.
- Existing `physical-fit-v5-amendment.md` is still authoritative for the *frozen v5 experiment*. The approved exception reallocates the 42 **unused** calls only to the new independent epoch. Do not repurpose the old v5 ledger or adjust its terminal.
- Scope: one hammer contact dissipation scaling mechanism. All other DSP branches and architecture invariants remain unchanged. Gate 3 reports hypothesis; Gate 4 falsifies it with actual captures; Gate 5 performs existing acceptance sequence only on PASS; Gate 6 is final product review.

## Ownership map / exact changes

| Owner | Responsibility / prescribed behavior |
| --- | --- |
| `wasm/plugins/dsp/super-synth/src/plugin.c::grand_strings_step` | Existing force equation **unchanged**; new test-only setter/getter writes canonical `g_grand_config.hammer.contact_loss_soft/hard` from the selected original factory profile, never cumulatively; valid engine9 + zero active voice, then `dsp_reset`. |
| `wasm/CMakeLists.txt` | Option `SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS=OFF` by default; requires test+guard build, incompatible with `SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS`; emit exactly two extra exports only for test diagnostic build. |
| `wasm/plugins/dsp/super-synth/test/tools/issue7-contact-loss-v1-core.cjs` | Pure authorized fixed α×cell enumeration, hypothesis report from authenticated offline reader, official hard-gate result comparison, immutable call ID/cap accounting, and portable source-snapshot comparison. Keep it separate from disk/remote/GitHub writers. |
| `wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs` | Single CLI orchestration owner; read-only `--status/--analyze/--verify`, authority-bound `--prepare`, ledger-charged `--run-bounded`, independently gated `--continue-approved`. Never import old v4/v5 `writeJson/chargeCall/runOptimizer` side effects. |
| New `issue7-contact-loss-v1-core.test.cjs`, `run-issue7-contact-loss-v1.test.cjs` | Pure cardinality/order/official rejection tests; actual writer failure/restart/reentry/head-drift/partial-copy test doubles and host-bound optional tests. |
| `wasm/plugins/dsp/super-synth/presets.json` and generated `wasm/shared/generated/super-synth_grand_profiles.h` | **Only after** Gate4 candidate PASS + 25 confirmation PASS + 4 headroom PASS; update grand contact loss coefficients only. Metadata generation must be deterministic. |

No changes permitted in `interface.soraoto`, Plugin ABI, factory preset schema, physical-identification helper signatures or `grand_strings_step` force/loss arithmetic. The test-only setter is deliberately private to the diagnostic build. The production path must keep the existing `engine_model=9` and current physical transition geometry.

## Fixed α and render protocol

```text
ALPHA = [1.00, 0.50, 0.65, 0.80, 1.20, 1.40]
CELLS = [[90,31],[93,31],[96,14],[96,31],[96,36],[96,124],[99,31]]
first     = alpha=1 new source-bound baseline (7 calls)
remaining = five candidate vectors in fixed order (35 calls max)
hardCap   = 42 calls
```

Choose a single immutable reference source (the authenticated Salamander V3 archive) and existing official evaluator `stage3-direct-reference-metrics.cjs`. Preserve signed EARLY/LATE, shape, level, finite/guard, peak, centroid/above2k, velocity span and brightness tests. A lower weighted research loss cannot rank a hard-gate-FAIL candidate ahead of a PASS. For eligible candidates rank official violation → family loss → |alpha−1| → alpha. A candidate counts as measured only with all seven readback-valid WAV/metadata pairs; no partial promotion. Baseline unsafe/unverified stops before any nonbaseline render. An entirely unsuccessful family stops with `PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT` and leaves 1,962 acceptance calls untouched.

The starting conjecture is **`HAMMER_CONTACT_DISSIPATION_HYPOTHESIS`**, not confirmed physics. Gate3 input is the accepted 20×7 offline evidence plus separate v3/v4 tags; the logged MIDI96 velocity124 EARLY dominance is not a causal identification. Explicit negative predictions include no EARLY improvement, LATE deterioration, peak/guard violation, or new failure elsewhere. Historical Stage3 MIDI96 v31/v36 errors remain separate unless their capture lineage is authenticated.

## Evidence identity, repeat and cancellation

Use a dedicated pair:
- Primary: `<git-common-dir>/soraoto-agent-state/7/physical-contact-loss-v1/experiment-01/`
- Secondary: `$HOME/.soraoto-agent-archive/soraoto_dsl/7/physical-contact-loss-v1/experiment-01/`

The new epoch binds the **approved contract hash**, exact pushed PR #8 HEAD/branch/base, source hashes, original `analysis-03` and parent store inventories, authorized archive and each call's canonical alpha/pitch/velocity/build identity. Old epochs remain unchanged byte/SHA/size/mtime. Distinguish original/source metadata identity from product acoustic acceptance. Before any render, acquire exclusive owner lock and durably write mirrored **start markers**, charging the call at start; after capture, persist WAV and metadata bytes in both copies, fsync and SHA readback, then mark complete. A partial start/result, divergent source, unknown/foreign lock, concurrent writer or program death MUST block and conserve all bytes. Never automatically delete or rerender an ambiguous charged call.

Read-only modes never create a directory or mutate file mtimes. `--prepare` is blocked without the exact Issue authorization, immutable evidence, clean local tree, pushed PR HEAD, confirmed release configuration, canonical fixed matrix and source check. Resume occurs only from a complete checkpoint with no unknown starts; crossing an ambiguous start is forbidden.

Source commits after a measured run are new provenance. If continuation evidence is needed, append a distinctly numbered epoch with authenticated parent report and strict source lineage; never edit a previously published report or simply relabel HEAD.

## Gate 5 / Gate 6 transitions

```text
GATE3_ANALYSIS_PASS
    ↓
GATE4_BASELINE_SAFE (7)
    ↓
GATE4_ALL_SIX_VECTORS_AS_NEEDED (≤35 additional)
    ├─ zero official PASS → PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT (stop)
    ↓
GATE4_STRESS_PASS
    ↓ 25 measured confirmations
CONFIRMATION_PASS
    ↓ 4 measured headroom captures
HEADROOM_PASS
    ↓ grand-only preset + generated header source promotion
PRODUCTION_PROMOTED
    ↓ 12 test/release pairs = 24 calls; per-sample abs difference ≤1e−6
RELEASE_EQUIVALENCE_PASS
    ↓ 486 Stage3 cells, full official gates
STAGE3_READY_FOR_STAGE4
    ↓ 1,423 Stage4 cells, lifecycle/repeat/adjacent checks
STAGE4_FULL_RANGE_COMPLETE
    ↓ Web Player test/build + manual audio + review evidence
ACOUSTIC_PASS_AWAITING_FINAL_REVIEW
```

Cumulative `3251 + 42 + (25+4+24+486+1423) = 5255`; no borrowing or broadening. No stage after a failed predecessor. Existing production/release artifacts are allowed different SHA and export sets if the accepted per-sample PCM equivalence proof passes; both must be source-bound, and the diagnostic setter cannot appear in the release export list.

## Concrete failure-mode tests and review checkpoints

Before authorizing the first real call: assert finite canonical α, factory-preset base (0.08/0.28), noncumulative repeated setter, rejection leaves all state unchanged, reset/voice lifecycle and alpha1 bitwise/accepted PCM baseline; source SHA/mtime stable. Assert fixed 42 IDs/ordering, guarded read-only Gate3, lineage segregation, correct reference SHA. Inject (separately) clipping, guard hits, nonfinite, shape>10, level>20, dynamic span>8, spectral brightness fail and better-loss-but-hard-fail. Assert all are rejected, zero winner yields finite terminal and no downstream work.

Inject process abort immediately after one mirrored durable start; retry must not rerender, counter must charge once. Tamper both copies with equal-length different bytes; exact recorded SHA must reject. Inject remote HEAD drift, incomplete two-copy publication, lock owner conflict, and new source identity after freeze; no false PASS. Inject holdout failure, headroom failure, PCM equivalence failure, Stage3 failure and Stage4 failure independently and assert later calls=0. Verify test/release SHA mismatch is allowed only where PCM equivalence is proven. Verify exactly 486/1423 cells and existing lifecycle/adjacent validations.

Commands in [contract](https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-6473845875) are normative: `rtk cmake -S wasm -B build/wasm -DCMAKE_TOOLCHAIN_FILE="$PWD/wasm/cmake/wasm32-clang.cmake"`, build, CTest, focused Node and frozen offline/v5 tests, `rtk git diff --check`, then `web-player/` npm tests/build after all upstream PASS. Record exact results, exit codes, and untested OSs. A synthetic fixture result never satisfies a real audio gate.

## Execution obligations

The reviewer checklist is the approved Contract §9. Implementation must self-review each item; deliver exact changed files, SHA/mtimes, call accounting and ambiguous count, test commands, blocked predicates, source HEAD, branch, **PR URL**, frozen evidence preservation and unverified platforms. A completed implementation must be committed/pushed and attached to PR #8 with `Closes #7`, followed by repository workflow review state. **Do not merge/close** until actual product acoustic quality and final acceptance are established.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.
