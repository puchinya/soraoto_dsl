# Issue #7 — Stage2L model revision result

**Date:** 2026-10-03  
**PR:** [#8](https://github.com/puchinya/soraoto_dsl/pull/8)  
**Issue state:** OPEN, `phase:implementation` + `blocked`

## Result

Stage2L revision 2 was implemented and candidate 1 was evaluated once through the existing production-SIMD Stage2E path. The candidate improved the C8 post-attack constraint, but worsened the MIDI 45 velocity-span constraint and introduced an absolute-pitch failure. The contract's directional gate therefore stopped the run before any GPSampler proposal. The revision-2 budget used is **1/12**. No Stage 3 or Stage 4 run was started.

The result is `BLOCKED_STAGE2L_MODEL_DIRECTION`, not a completed calibration. No additional physical candidate is authorized by the current contract.

## Revision-2 changes

- Internal `grand_piano_v1` profile revision: 1 → 2. Plugin ABI, Plugin ID, public parameter set, preset identities, and product versions are unchanged.
- Added `string.decay_reference_midi = 60.0`; passive reference loss is now velocity-independent.
- Applied the specified per-second normalization to the already-clamped agraffe / bridge scalar gains, cached by prepared pitch and refreshed when string damping changes.
- Replaced piecewise felt hardness with the continuous pivot mapping around velocity `61/127`.
- The existing metadata generator emitted the immutable profile header.
- The fixed architecture parameter registry excludes string-loss mapping from optimizer dimensions.

## Candidate 1

Candidate identity: `stage2l-r2-candidate-01`  
Source revision: `64308a64f254c4f0866a0b9372d8b1f50c8fa867`  
Result: measured COMPLETE; Stage 1 FAIL, Stage 2 FAIL, Stage 2B direct proxy completed, held/release completed. The 32 Stage2E constraints were computed from the measurements.

| Parameter | Value |
|---|---:|
| `effective_strike_position_c4` | 0.13664120183629616 |
| `hammer.compression_scale` | 0.00053383185753125 |
| `hammer.velocity_hardness_amount` | 0.5 |
| `piano_hammer_hardness` | 0.3719079878026494 |
| `piano_inharmonicity` | 0.06597007256584347 |
| `piano_string_damping` | 0 |
| `piano_string_unison` | 0.9855708493914253 |

| Metric | Result |
|---|---:|
| Stage 1 / Stage 2 peak | −13.008473 / −5.894692 dBFS |
| Direct proxy | 284 cells, 16 pitches |
| Worst direct peak | −5.340350 dBFS |
| Guard hits | 0 |
| Finite output | true |
| Measurement invalid | 0 |
| Low-register buzz | 0.110870 (limit 0.12) |
| Worst sentinel pitch error | +29.497655 cents at MIDI 21, velocity 14 (±15-cent limit) |
| Held decay ratio | 0.702551 |
| Release tails 1 / 2 / 3 | 0.001712605 / 0.000366009 / 0.000015477 |
| Release finite / stuck voices | true / 0 |
| Stage2E reference-fit loss | 0.409293 |

### Directional gate

| Constraint | Stage2K baseline | Stage2L candidate 1 | Change | Gate |
|---|---:|---:|---:|---|
| C8 post-attack violation | +2.101440 dB | −0.179817 dB | −2.281257 dB | improved |
| MIDI 45 dynamic-span violation | +3.528952 dB | +4.674648 dB | +1.145696 dB | worsened |

MIDI 45 span was 32.347597 dB for the synth and 19.672949 dB for the reference, giving +12.674648 dB absolute span error and +4.674648 dB beyond the existing 8 dB bound. The MIDI 45 proxy used all 16 required velocity layers.

New positive independent safety constraint: Stage 1 and Stage 2 pitch violation `+0.966510` (same worst MIDI 21 / velocity 14 error). The pitch limit was not changed.

## Complete Stage2E constraint vector

```json
{
  "brightness_direction_violation": -0.37148308206731384,
  "direct_finite_violation": 0.0,
  "direct_guard_violation": 0.0,
  "direct_level_violation_db": -3.509753,
  "direct_peak_violation_dbfs": -5.34035,
  "dynamic_span_violation_db": 4.674647999999998,
  "held_decay_ratio_violation": -0.3112248724495784,
  "post_attack_shape_violation_db": -0.17981700000000167,
  "release_tail1_min_violation": -4.708684854125707,
  "release_tail2_min_violation": -1.4400609971432965,
  "release_tail_decay_ratio_violation": -0.9231163982490307,
  "release_finite_violation": 0.0,
  "stuck_voice_violation": 0.0,
  "stage1_brightness_violation": -1.215743177143191,
  "stage1_buzz_violation": -0.0760859885082777,
  "stage1_finite_violation": -1.0,
  "stage1_guard_violation": 0.0,
  "stage1_measurement_invalid": 0.0,
  "stage1_peak_violation": -13.008473472005381,
  "stage1_pitch_violation": 0.9665103322455532,
  "stage1_sparsity_violation": -6.860958616674772,
  "stage1_violation": 0.9665103322455532,
  "stage2_brightness_violation": -1.215743177143191,
  "stage2_buzz_violation": -0.0760859885082777,
  "stage2_finite_violation": -1.0,
  "stage2_guard_violation": 0.0,
  "stage2_measurement_invalid": 0.0,
  "stage2_peak_violation": -5.89469221843149,
  "stage2_pitch_violation": 0.9665103322455532,
  "stage2_sparsity_violation": -6.860958616674772,
  "stage2_violation": 0.9665103322455532,
  "stage2b_violation": 4.674647999999998
}
```

## Verification

- **PASS** `rtk cmake -S wasm -B build/wasm -DCMAKE_TOOLCHAIN_FILE="$PWD/wasm/cmake/wasm32-clang.cmake"`
- **PASS** `rtk cmake --build build/wasm` (production SIMD)
- **PASS** host C loss-normalization comparison against `powf`: max absolute error `1.1920929e-07` over 141 gains × MIDI 21–108 (limit `5e-5`)
- **PASS** Stage2L unit tests: 6/6
- **PASS** full Python tuning unittest suite: 107 passed, 1 skipped (108 total)
- **PASS** Stage2L dry-run: zero builds, zero acoustic renders
- **BLOCKED / FAIL** `rtk node wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js`: soundboard control difference `0.00039014785809495076`; this remains an independent Issue #7 blocker, not a Stage2L tuning gate to relax.
- **PASS** `rtk git diff --check`
- **NOT RUN** full CTest, Web Player tests/build, Stage 3 (480 direct cells), Stage 4 (1,408 lifecycle + 1,392 adjacent), manual listening, original Salamander audio decode.

## Remaining work and delivery state

The revision-2 budget remains 1/12, but Stage2L requires candidate 1 to improve both primary failures and add no new positive independent safety constraint. It failed that gate, so candidates 2–12 must not be evaluated under this contract. Return to requirements/design for a new model decision before further physical tuning. Keep Issue #7 `phase:implementation` + `blocked`; PR #8 remains the sole delivery PR with `Closes #7`. Stage 3/4 remain ineligible.

No Stage2F/J evidence, acceptance thresholds, soundboard coefficient, or production source outside the Stage2L change set was intentionally modified by the Stage2L evaluation.
