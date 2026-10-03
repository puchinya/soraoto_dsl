# SuperSynth V9 Stage3A Velocity Diagnostic

Date: 2026-10-03  
Issue: [#7](https://github.com/puchinya/soraoto_dsl/issues/7)  
Pull request: [#8](https://github.com/puchinya/soraoto_dsl/pull/8)

## Result

**`BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCOMPLETE`**.

Stage3's primary decision precedence is corrected to `BLOCKED_STAGE3_DIRECT_REFERENCE`: the saved direct-reference matrix itself failed. The independent Concert Grand regression remains a secondary blocker. The prior 480-cell measurements are unchanged; Stage3A did not rerender that matrix.

## Identity and protected behavior

- Candidate: `stage2n-r3-candidate-01`
- Production SIMD WASM SHA-256: `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`
- Generated profile SHA-256: `cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66`
- Preset SHA-256: `cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431`
- Reference fixture SHA-256: `5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7`
- Diagnostic WASM was built separately under `build/wasm-stage3a`; the production build under `build/wasm` was not replaced.
- Acoustic candidate delta: 0; Stage2L remains 1/12; Stage2N remains 1/1; Stage4 render count remains 0.
- No production coefficient, preset value, threshold, fixture, or DSP source was changed.

## Corrected Stage3 decision

The saved Stage3 result remains blocked by:

- direct level: MIDI 96 / velocity 31 at `+21.663703 dB` against the 20 dB limit;
- dynamic span: MIDI 36, 39, 51, and 54, with worst absolute error `20.696187 dB`.

Independent regression evidence is secondary: Concert Grand regression FAIL (bass felt velocity shape), and Piano Realism regression PASS. The saved Stage3 matrix had 480/480 finite cells, zero guard hits, and worst peak `-4.880980 dBFS`.

## Diagnostic run

- Separate diagnostic WASM build: PASS.
- Production equivalence: the six contracted cells passed at tolerance `1e-6`: 36/14, 36/124, 51/14, 51/124, 96/31, and 96/124.
- Render allowance: 195 authorized render identities were used. The six equivalence captures were reused within the 192-cell diagnostic matrix; three additional MIDI 41 cells were captured at normalized velocities 0.25, 0.55, and 0.90.
- Factor mask: all diagnostic renders explicitly used and read back Stage2M factor mask 3.
- MIDI 41 comparison: not valid. The initial measurements used the shared capture helper's default derivative interval of 0–160 ms. The existing regression computes the required metric over 30–180 ms. The measured values therefore cannot be compared with the contract's expected values.
- The shared capture helper and Stage3A runner now accept and select the correct 30–180 ms interval for these MIDI 41 checks. No rerender was made after discovering that the fixed allowance had been consumed, so the corrected measurement remains unverified.
- Diagnostic matrix tables are not accepted as final evidence because the run stopped before writing its result artifact.

## Verification

- PASS: `rtk node wasm/plugins/dsp/super-synth/test/tools/run-stage3-direct-reference.test.cjs`
- PASS: `rtk node wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.test.cjs`
- PASS: `rtk node wasm/plugins/dsp/super-synth/test/tools/run-stage3a-velocity-diagnostic.test.cjs`
- PASS: separate `build/wasm-stage3a` configure/build
- PASS: `rtk git diff --check`
- PASS: production WASM, generated profile, presets, and reference fixture hashes still match the Stage3 evidence.
- NOT RUN: Stage4, full CTest, Web Player tests/build, manual listening.

## Next gate

Issue #7 remains open and blocked in `phase:implementation`. Stage4 remains locked. A narrowly scoped follow-up authorization is required to remeasure the three existing MIDI 41 cells using the corrected 30–180 ms derivative interval. No additional pitches, velocities, physical candidates, or tuning are authorized by this report.
