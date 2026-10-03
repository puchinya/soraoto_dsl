# SuperSynth V9 Stage3 Direct-Reference Status

Date: 2026-10-03  
Issue: [#7](https://github.com/puchinya/soraoto_dsl/issues/7)  
Pull request: [#8](https://github.com/puchinya/soraoto_dsl/pull/8)

## Result

**`BLOCKED_STAGE3_INDEPENDENT_REGRESSION`**. The fixed Stage3 measurement completed with 480/480 unique direct-reference cells and six deterministic sentinel re-renders. The contract's independent `concert-grand-regression.test.js` failed, so Stage4 remains locked. The direct-reference evaluation also has independent level and dynamic-span failures.

No acoustic parameters, thresholds, preset values, reference fixtures, or production DSP were changed. Stage3 candidate delta is 0; Stage2L remains 1/12 and Stage2N remains 1/1.

## Production and reference identity

- Candidate: `stage2n-r3-candidate-01`
- Production SIMD WASM SHA-256: `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`
- Candidate config SHA-256: `792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d`
- Reference: Salamander Grand Piano V3, CC BY 3.0, archive SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b`
- Fixture schema: 3; 480 direct cells; 641 unique source audio references
- Capture: 30 pitch centers × 16 velocity layers, `concert_grand`, no parameter overrides
- Captured: 480 requested, 480 unique

## Gate summary

| Gate | Result | Evidence |
| --- | --- | --- |
| Finite samples | PASS | All cells finite |
| Output guard | PASS | 0 hits |
| Peak | PASS | Worst peak -4.880980 dBFS |
| Shared-offset direct level | FAIL | 1 cell over the 20 dB limit; worst error +21.663703 dB at MIDI 96 / velocity 31 |
| Above-2 kHz delta | PASS | 0 failed cells |
| Comparable centroid ratio | PASS | 0 failed cells |
| Post-attack shape | PASS | 0 failures; maximum 9.880858 dB against 10 dB |
| Dynamic span | FAIL | 4 pitches fail: MIDI 36, 39, 51, 54; worst absolute error 20.696187 dB at MIDI 51 |
| Brightness direction | PASS | 0 failing pitches |
| Six sentinels | PASS | All repeat metrics exactly equal within 1e-6 |

Only failing direct cell:

- MIDI 96 / velocity 31: `directLevel`; level error 21.663703 dB; centroid ratio 4.134334 (comparable); above-2 kHz delta 0.158941; EARLY residual -7.462906 dB; LATE residual -6.122606 dB; shape error 7.462906 dB; peak -29.897132 dBFS; guard 0; finite.

Dynamic-span failures:

| MIDI | Synth span (dB) | Reference span (dB) | Absolute error (dB) | Violation over 8 dB (dB) |
| ---: | ---: | ---: | ---: | ---: |
| 36 | 33.683273 | 21.102391 | 12.580882 | 4.580882 |
| 39 | 27.795148 | 15.725762 | 12.069386 | 4.069386 |
| 51 | 37.172102 | 16.475915 | 20.696187 | 12.696187 |
| 54 | 29.798821 | 20.548897 | 9.249924 | 1.249924 |

## Independent focused regressions

- `concert-grand-regression.test.js`: **FAIL** — bass felt velocity shape regressed; measured values `0.0629905526 / 0.0538900845 / 0.2423147176`.
- `piano-realism-regression.test.js`: **PASS**.

## Next gate

Keep Issue #7 in `phase:implementation` and blocked. Do not run Stage4, retune, change thresholds, or advance the Issue based on this result. A separate requirements/design decision is needed to address the measured blockers.
