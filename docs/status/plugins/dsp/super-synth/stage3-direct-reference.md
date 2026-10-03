# SuperSynth V9 Stage3 Direct-Reference Status

Date: 2026-10-03  
Issue: [#7](https://github.com/puchinya/soraoto_dsl/issues/7)  
Pull request: [#8](https://github.com/puchinya/soraoto_dsl/pull/8)

## Result

**`BLOCKED_STAGE3_DIRECT_REFERENCE`**. The fixed Stage3 measurement completed with 480/480 unique direct-reference cells and six deterministic sentinel re-renders, but the direct-reference matrix itself failed its direct-level and dynamic-span gates. The independent `concert-grand-regression.test.js` failure is a secondary blocker. Stage4 remains locked.

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

## Stage3A status — diagnostic evidence incomplete

Stage3A corrected the result precedence: `BLOCKED_STAGE3_DIRECT_REFERENCE` is primary because the saved direct-reference matrix failed; the Concert Grand regression is secondary. No Stage3 matrix was rerendered, and the underlying 480-cell measurements remain unchanged.

The separate diagnostic WASM build succeeded. Its six required production-equivalence cells passed the `1e-6` comparison, and the bounded diagnostic run executed 195 authorized render identities (192 selected pitch/velocity cells, with six equivalence cells reused, plus three MIDI 41 normalized-velocity cells). The required MIDI 41 derivative check could not be accepted: the first run used the shared capture helper's default `0–160 ms` window, while the existing Concert Grand regression computes this quantity over `30–180 ms`. The comparison therefore did not measure the contracted metric. The capture helper and Stage3A runner were corrected to use `30–180 ms` for MIDI 41, but no rerender was performed after the 195-render allowance had been consumed.

**Current Stage3A result: `BLOCKED_STAGE3A_DIAGNOSTIC_EVIDENCE_INCOMPLETE`.** The expected MIDI 41 values have not been revalidated with the correct interval; diagnostic path/span tables are not accepted as completion evidence. No production parameters, thresholds, reference data, or DSP were changed. Stage4 remains unrun. A new narrowly scoped authorization is needed before remeasuring the three existing MIDI 41 cells with the corrected analysis window.
