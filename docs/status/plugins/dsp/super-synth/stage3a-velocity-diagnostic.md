# SuperSynth V9 Stage3A Velocity Diagnostic

Date: 2026-10-03  
Issue: [#7](https://github.com/puchinya/soraoto_dsl/issues/7)  
Pull request: [#8](https://github.com/puchinya/soraoto_dsl/pull/8)

## Result

**`BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCOMPLETE`**.

The three authorized MIDI 41 replacement renders are valid. Each used the authoritative 30–180 ms derivative interval and reproduced the production regression value exactly (absolute difference 0, within `1e-6`). All three were finite with zero output-guard hits.

The full Stage3A completion gate remains blocked because the 192-cell diagnostic result table and hammer/path comparison tables are absent from the preserved artifacts. The earlier status records that the in-memory matrix was not written because the run stopped at the invalid MIDI 41 interval comparison. Stage3A's supplemental contract forbids rerendering those 192 cells, so these tables cannot be reconstructed from accepted evidence in this run. No values have been inferred or fabricated.

## Corrected Stage3 decision

The Stage3 primary decision remains `BLOCKED_STAGE3_DIRECT_REFERENCE`: the saved direct-reference matrix failed. The independent Concert Grand regression is secondary. No Stage3 production cell was rerendered.

Preserved Stage3 evidence:

- 480/480 cells finite; zero guard hits; worst peak `-4.880980 dBFS`.
- Direct-level failure: MIDI 96 / velocity 31, `+21.663703 dB` against the 20 dB limit.
- Dynamic-span failures: MIDI 36, 39, 51, and 54; worst absolute error `20.696187 dB`.

## Existing evidence reused

- Stage3 direct-reference cells: 480; rerenders: 0.
- Six production-equivalence sentinels: rerenders: 0. Previously passed at `1e-6`: 36/14, 36/124, 51/14, 51/124, 96/31, 96/124.
- Stage3A diagnostic matrix: 192 cells; rerenders: 0. The matrix was previously rendered, but its accepted result artifact/table is missing and cannot be verified or reproduced from preserved files.
- Original MIDI 41 derivatives at normalized velocities 0.25, 0.55, 0.90 are marked `SUPERSEDED_MEASUREMENT_WINDOW`: they used 0–160 ms rather than 30–180 ms.

## Supplemental MIDI 41 replacements

Diagnostic build: `build/wasm-stage3a`; Stage2M factor mask 3 was explicitly set and read back for each render, with hammer diagnostics reset before each note.

All three derivative values exactly match their production baselines (maximum absolute difference 0), with 3/3 finite renders and zero total guard hits. The six hammer fields and required path/acoustic diagnostics were captured for all three velocities. Per-cell and per-path values remain in private evidence and are not copied into public Git status.

The replacement derivatives verify MIDI 41 soft/mid/hard brightness behavior. The missing 192-cell comparison evidence prevents the contracted dynamic-span, pitch-divergence, failing-vs-control path, and MIDI 96 neighborhood analyses from being accepted as complete.

## Identity and accounting

- Starting and ending baseline before delivery: `27be3eaa6bbba168a7c0830b5acc23ebcba77988`.
- Candidate: `stage2n-r3-candidate-01`; production SIMD WASM SHA-256: `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`.
- Config SHA-256: `792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d`.
- Generated profile SHA-256: `cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66`.
- Presets SHA-256: `cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431`.
- Reference fixture SHA-256: `5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7`.
- Diagnostic WASM SHA-256: `59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3`; both required diagnostic CMake options were ON.
- Original render calls: 195; supplemental replacements: 3; total calls: 198; accepted evidence renders: 195; superseded renders: 3.
- Physical candidate delta: 0; Stage2L: 1/12; Stage2N: 1/1; Stage4 renders: 0.
- Production behavior, acoustic coefficients, preset values, thresholds, and reference fixture were unchanged.

## Verification

- PASS: Stage3A unit test, including exact supplemental identity authorization.
- PASS: supplemental dry-run; builds 0, renders 0; only the three authorized MIDI 41 identities listed.
- PASS: exactly three supplemental renders; all factor-mask readbacks were 3 and all derivatives matched exactly.
- PASS: production/config/profile/preset/reference hashes matched the fixed identities before and after the renders.
- PASS: `rtk git diff --check`.
- NOT RUN: Stage3 480-cell recapture, six-cell recapture, 192-cell recapture, GPSampler, Stage4, full CTest, Web Player tests/build, manual listening.

## Next gate

Issue #7 remains open and blocked in `phase:implementation`. Stage3 remains `BLOCKED_STAGE3_DIRECT_REFERENCE`; Stage4 remains locked. The three-render allowance is fully consumed. Completing the missing Stage3A tables or running any further render requires a separate narrowly scoped decision and authorization.
