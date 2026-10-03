# Issue #7 — Stage2M Factorial Attribution

Stage2Mは診断専用です。係数変更、Stage 3/4、候補昇格の根拠には使用しません。

- Candidate: `stage2l-r2-candidate-01` (Stage2L semantic vector)
- Source revision: `b2ca766235378c33e47185c8b185f09dbe005b98`
- Candidate budget: 1/12 (Stage2M candidate delta 0; GPSampler trials 0)
- Capture accounting: 593 diagnostic note renders across five attempts; only the final validated 144-cell matrix is used below. The earlier 449 calls were incomplete or superseded after evaluator/preflight fixes, preserved privately, and did not create candidate identities.
- 111 equivalence: PASS

## Factor combinations

| Mask | MIDI45 span | Existing 8 dB violation | C8 shape violation | C8 LATE residual | MIDI21 estimator | MIDI21 constrained peak | Peak worst | Guard |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 000 | 27.629382 dB | -0.043567 dB | 8.262966 dB | -18.262966 dB | -4.6249 ¢ | 2.1937 ¢ | -10.8363 dBFS | 0 |
| 001 | 26.855461 dB | -0.817488 dB | -0.221763 dB | -9.778237 dB | 29.5123 ¢ | 18.7564 ¢ | -11.2499 dBFS | 0 |
| 010 | 27.489054 dB | -0.183895 dB | 8.262966 dB | -18.262966 dB | -4.6249 ¢ | 2.0966 ¢ | -10.8452 dBFS | 0 |
| 011 | 26.526804 dB | -1.146145 dB | -0.221763 dB | -9.778237 dB | 29.4857 ¢ | 13.0479 ¢ | -11.2712 dBFS | 0 |
| 100 | 33.510499 dB | 5.837550 dB | 8.202503 dB | -18.202503 dB | 29.1351 ¢ | 2.2198 ¢ | -4.9169 dBFS | 0 |
| 101 | 32.765436 dB | 5.092487 dB | -0.264736 dB | -9.735264 dB | 29.5327 ¢ | 20.5289 ¢ | -5.2997 dBFS | 0 |
| 110 | 33.331852 dB | 5.658903 dB | 8.202503 dB | -18.202503 dB | 29.1967 ¢ | 2.1172 ¢ | -4.9339 dBFS | 0 |
| 111 | 32.347597 dB | 4.674648 dB | -0.264736 dB | -9.735264 dB | 29.4977 ¢ | 14.0393 ¢ | -5.3403 dBFS | 0 |

## Factorial effects

各効果は revision-2 (+1) 平均 − legacy (−1) 平均です。交互作用も同じ符号規約です。

| Outcome | N | V | H | N×V | N×H | V×H | N×V×H |
|---|---:|---:|---:|---:|---:|---:|---:|
| midi45SpanViolationDb | -0.866372 | -0.266368 | 5.863671 | -0.106880 | 0.001713 | -0.031875 | -0.012716 |
| midi45SynthSpanDb | -0.866372 | -0.266368 | 5.863671 | -0.106880 | 0.001713 | -0.031875 | -0.012716 |
| midi45LargestDownwardLayerStepDb | 1.015779 | 0.025435 | -4.638597 | 0.009783 | -0.004130 | 0.017574 | 0.007041 |
| c8PostAttackViolationDb | -8.475984 | 0.000000 | -0.051718 | 0.000000 | 0.008745 | 0.000000 | 0.000000 |
| c8LateResidualDb | 8.475984 | 0.000000 | 0.051718 | 0.000000 | -0.008745 | 0.000000 | 0.000000 |
| midi21PitchEstimatorCents | 17.236539 | -0.000011 | 16.903507 | -0.030808 | -16.887283 | 0.013268 | -0.017502 |
| midi21ConstrainedNearFundamentalCents | 14.436304 | -3.099463 | 0.702657 | -2.999595 | 0.679278 | -0.196665 | -0.193896 |

## Matched-pair deltas

各セルは他の2因子を固定し、revision-2 − legacy（dBまたは¢）を4組で示します。

| Outcome | Factor | Pair deltas |
|---|---|---:|
| midi45SpanViolationDb | N | `-0.773921, -0.962250, -0.745063, -0.984255` |
| midi45SpanViolationDb | V | `-0.140328, -0.328657, -0.178647, -0.417839` |
| midi45SpanViolationDb | H | `5.881117, 5.909975, 5.842798, 5.820793` |
| midi45SynthSpanDb | N | `-0.773921, -0.962250, -0.745063, -0.984255` |
| midi45SynthSpanDb | V | `-0.140328, -0.328657, -0.178647, -0.417839` |
| midi45SynthSpanDb | H | `5.881117, 5.909975, 5.842798, 5.820793` |
| midi45LargestDownwardLayerStepDb | N | `1.017167, 1.022651, 0.994825, 1.028473` |
| midi45LargestDownwardLayerStepDb | V | `0.005120, 0.010604, 0.026185, 0.059833` |
| midi45LargestDownwardLayerStepDb | H | `-4.645000, -4.667342, -4.623935, -4.618113` |
| c8PostAttackViolationDb | N | `-8.484729, -8.484729, -8.467239, -8.467239` |
| c8PostAttackViolationDb | V | `0.000000, 0.000000, 0.000000, 0.000000` |
| c8PostAttackViolationDb | H | `-0.060463, -0.042973, -0.060463, -0.042973` |
| c8LateResidualDb | N | `8.484729, 8.484729, 8.467239, 8.467239` |
| c8LateResidualDb | V | `0.000000, 0.000000, 0.000000, 0.000000` |
| c8LateResidualDb | H | `0.060463, 0.042973, 0.060463, 0.042973` |
| midi21PitchEstimatorCents | N | `34.137128, 34.110516, 0.397566, 0.300946` |
| midi21PitchEstimatorCents | V | `0.000027, -0.026585, 0.061568, -0.035053` |
| midi21PitchEstimatorCents | H | `33.760019, 0.020458, 33.821560, 0.011989` |
| midi21ConstrainedNearFundamentalCents | N | `16.562725, 10.951327, 18.309073, 11.922090` |
| midi21ConstrainedNearFundamentalCents | V | `-0.097099, -5.708498, -0.102637, -6.489620` |
| midi21ConstrainedNearFundamentalCents | H | `0.026149, 1.772496, 0.020610, 0.991374` |

## Decision classification

- C8 time normalization: `PRESERVE_TIME_NORMALIZATION_FOR_REVISION3`
- MIDI45 velocity span: `VELOCITY_HARDNESS_MAPPING_REQUIRES_REDESIGN`
- MIDI21 pitch: `PITCH_ESTIMATOR_TRACKING_PROBLEM`
- Estimator >15¢ masks: `[1, 3, 4, 5, 6, 7]`
- Constrained peak within ±15¢ masks: `[0, 2, 3, 4, 6, 7]`
- Estimator-fail / constrained-peak-pass masks: `[3, 4, 6, 7]`
- Both MIDI21 measures outside ±15¢ masks: `[1, 5]`
- Output ablation/factor deltas are path-authority evidence only; no unsupported mechanical/physical root cause is inferred.
- Production preset/equations and acceptance thresholds were not tuned by this diagnostic.
- Stage 3 and Stage 4 were not run and remain locked.
