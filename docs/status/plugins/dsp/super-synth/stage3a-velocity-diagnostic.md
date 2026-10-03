# SuperSynth V9 Stage3A Velocity Diagnostic

Date: 2026-10-03  
Issue: [#7](https://github.com/puchinya/soraoto_dsl/issues/7)  
Pull request: [#8](https://github.com/puchinya/soraoto_dsl/pull/8)

## Decision

**`STAGE3A_DIAGNOSTIC_COMPLETE`** for the bounded 192-cell evidence recovery. Stage3 remains `BLOCKED_STAGE3_DIRECT_REFERENCE`; Stage4 remains locked and was not run. No acoustic tuning or new candidate was performed.

## Fixed identity and accounting

- Recovery baseline: `90dac1247560c16c274eadbde3977baacdc5f149`.
- Candidate: `stage2n-r3-candidate-01`; production SIMD WASM SHA-256: `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`.
- Config SHA-256: `792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d`; profile SHA-256: `cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66`.
- Diagnostic WASM SHA-256: `59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3`; both required diagnostic build options were ON.
- Recovered matrix: 192/192 unique cells, mask 3; finite 192/192; guard hits 0; worst peak `-4.880980 dBFS`.
- Six in-matrix production equivalence checks passed at tolerance `1e-6`; observed maximum difference: `0`.
- Hammer mapping invariants passed for all 16 velocity layers; maximum fixed-velocity hardness and launch-velocity spread were both `0`.
- Output gain decomposition used baked `0.7 + 0.3*v`; 14→124 gain span: `2.635308 dB`.
- Stage2L `1/12`; Stage2N `1/1`; physical candidate delta `0`; Stage4 renders `0`.

```text
historical calls = 198
recovery calls = 192
total Stage3A render calls = 390

final accepted evidence = 195
  persisted recovery matrix = 192
  valid supplemental MIDI41 = 3

historical non-authoritative calls = 195
  non-persisted old matrix = 192
  superseded old-window MIDI41 = 3

physical candidate delta = 0
Stage4 renders = 0
```

## Per-pitch span summary

| MIDI | Synth span (dB) | Reference span (dB) | Span error (dB) | Pre-output-gain span (dB) | Worst absolute direct-level error (dB) |
|---:|---:|---:|---:|---:|---:|
| 33 | 21.363 | 18.244 | 3.119 | 18.728 | 7.531 |
| 36 | 33.683 | 21.102 | 12.581 | 31.048 | 11.661 |
| 39 | 27.795 | 15.726 | 12.069 | 25.160 | 12.507 |
| 42 | 15.794 | 18.800 | 3.007 | 13.158 | 12.253 |
| 45 | 26.527 | 19.673 | 6.854 | 25.110 | 9.132 |
| 48 | 19.409 | 17.445 | 1.964 | 17.263 | 13.711 |
| 51 | 37.172 | 16.476 | 20.696 | 34.537 | 14.315 |
| 54 | 29.799 | 20.549 | 9.250 | 27.164 | 10.404 |
| 57 | 19.458 | 23.685 | 4.228 | 16.822 | 7.840 |
| 93 | 24.715 | 23.513 | 1.203 | 22.080 | 15.546 |
| 96 | 24.952 | 26.234 | 1.282 | 22.316 | 21.664 |
| 99 | 25.011 | 32.019 | 7.008 | 22.376 | 15.519 |

After subtracting the explicit final velocity-gain component, MIDI 36, 39 and 51 remain more than 8 dB from their reference spans (`+9.946`, `+9.434`, `+18.061 dB`). MIDI 54's residual becomes `+6.615 dB`, below the existing 8 dB limit. Its ordinary output still has the measured `9.250 dB` span error. This is a diagnostic arithmetic decomposition; it does not alter the product result or threshold.

## Evidence-based observations

- **Direct evidence:** At every fixed velocity, effective hardness and initial hammer velocity are invariant across the 12 pitches (maximum spreads `0`). Contact duration, peak force, maximum compression and post-contact transverse energy vary by pitch. Therefore the first measured pitch-dependent divergence appears in contact mechanics, after the invariant hardness/launch mapping; later bridge/body path RMS and final level also differ. These measurements identify where differences appear, not a proven physical root cause.
- **Direct evidence:** At velocity 31, failing pitches 36/39/51/54 average `9,532` post-contact energy units versus `15,344` for controls 33/42/45/48/57. Their mean bridge-B RMS is `0.121` versus `0.859`. At velocity 124, the corresponding means are `143,152` versus `194,224` for post-contact energy and `24.61` versus `58.51` for bridge-B RMS. Path measures do not all move together, so cancellation or another downstream interaction remains a hypothesis.
- **Direct evidence:** MIDI 96 / velocity 31 is not isolated within the sampled treble neighborhood. For MIDI 93, 96 and 99, every sampled layer from velocity 14 through 61 has a positive direct-level error above `10 dB`; MIDI 96 is the largest at velocity 31 (`+21.664 dB`). This supports a broader low-velocity 93–99 region pattern.
- **Direct evidence:** MIDI 41's 30–180 ms derivative dips from `0.062991` at normalized velocity `0.25` to `0.053890` at `0.55`, then rises to `0.242315` at `0.90`. Meanwhile peak hammer force increases `11.777 → 22.807 → 44.729`, and post-contact transverse energy increases `12,494 → 42,703 → 107,268`. The brightness dip coexists with monotonic force and energy progression in these three renders.
- **Stage3B hypotheses only:** The lower post-contact energy and bridge-B RMS across the known span-failure group may contribute to the excessive pre-gain span; the mismatch among bridge, modal and post-radiation signals may indicate pitch-dependent transfer behavior. The diagnostic ablation data do not establish causal responsibility or authorize coefficient changes.

## Preserved evidence

The detailed machine-readable 192-cell table, per-pitch/velocity rows, all hammer metrics, all path RMS/peak values, six equivalence comparisons, MIDI41 rows, pitch aggregates and SHA ledger remain in private `.agent-state/issues/7/stage3a/`. No raw audio or private local paths are included in this tracked status file.

## Verification

- PASS: Stage3A runner unit tests, including exact authorization, mask validation, atomic recovery states, crash points, ambiguous-resume blocking, COMPLETE-cell skip, hash mismatch blocking, and incomplete-finalize rejection.
- PASS: recovery dry-run; 0 builds, 0 renders; exactly 192 authorized identities.
- PASS: recovery execution; exactly 192 render calls; ledger ended at 192 COMPLETE, 0 PENDING, 0 IN_PROGRESS.
- PASS: zero-render finalize; 192 persisted rows; six equivalence comparisons at max difference 0; 16 hammer invariants; gain span `2.6353081118 dB`.
- PASS: production/diagnostic WASM and candidate config/profile/preset/reference identity checks; per-cell hashes validated during final assembly.
- PASS: `rtk git diff --check`.
- NOT RUN per contract: Stage3 480-cell recapture, six separate equivalence renders, MIDI41 rerender, GPSampler, Stage4, full CTest, Web Player tests/build, manual listening.

Issue #7 remains `OPEN`, `phase:implementation`, `blocked`. Stage3's direct-reference blocker remains authoritative; Stage3A completion does not promote Stage3 or unlock Stage4. The next work requires a separate Stage3B physical-design decision.
