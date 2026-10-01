# SuperSynth V9 status

> This document records current evidence. It is non-normative; the product specification and approved design define requirements and decisions.

**Owning Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7) — SuperSynth V9 Salamander Calibration and Full-Range Delivery
**Issue phase:** `phase:implementation`
**Updated:** 2026-09-26

## Progress

| Work item | Status | Evidence / limitation |
|---|---|---|
| Implementation contract and approval | PASS | Exact physical-model/SIMD delta copy matches its source SHA-256 `3c260156dcd84e12e388b200fb691abb2e03d7f2f71f0aa8db602fa0b8a18bc4`; the user supplied the decision-complete approved architecture on 2026-09-26 |
| Product specification, design, and Issue checklist | PASS | Normative V9 requirements and companion concert-grand design now cover the approved delta; Issue #7 records the user approval and 97-item unchecked delta checklist |
| Owning Issue and phase | IN PROGRESS | Issue #7 passed through `phase:ready` to `phase:implementation`; PR #8 remains open at pre-delta HEAD `28113fa0a6ee33a5366b8da8a8851d2d35d2d5ac` |
| Official Salamander reference | PASS (pre-delta evidence) | FreePats V3 SFZ+FLAC archive; 741,757,374 bytes; expected archive SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b` |
| Per-file reference provenance binding | IN PROGRESS | Delta requires a committed manifest for the SFZ, all 641 referenced audio files, license/provenance files, and archive SHA; extracted-file verification is pending |
| Physical architecture | IN PROGRESS | Dynamic hammer, shared bridge, fitted passive board, sympathetic register, longitudinal modes, passivity, and lifecycle regressions are pending implementation |
| SIMD and CPU evidence | IN PROGRESS | Production kernels, scalar differential build, active-voice mask, baseline comparisons, and performance summary are pending |
| Full-range calibration and V9 implementation | IN PROGRESS | Existing 480 direct, 1,408 full-range, and 1,392 adjacent results describe the pre-delta model only and are stale for changed behavior |
| Repository and Web Player verification | IN PROGRESS | Prior WASM/CTest and Web Player passes are pre-delta evidence; rerun after implementation |
| Native browser/audio interaction | NOT RUN | Automated tests establish render and integration properties, not actual device playback or browser listening |
| Independent Drive cloud archive hash readback | NOT AVAILABLE | The Drive download connector limit is 268,435,456 bytes, below the 741,757,374-byte archive; local DriveFS hash and Drive listing/upload state were verified |
| Commit, push, pull request, Issue review phase | IN PROGRESS | Continue on the existing PR branch; return Issue #7 to `phase:review` only after the delta evidence and self-review are complete |

## Verification

| Check | Status | Result |
|---|---|---|
| Delta contract provenance | PASS | Source attachment and preserved copy both hash to `3c260156dcd84e12e388b200fb691abb2e03d7f2f71f0aa8db602fa0b8a18bc4` |
| PR #8 baseline identity | PASS | Remote PR HEAD is `28113fa0a6ee33a5366b8da8a8851d2d35d2d5ac`, the required pre-delta baseline |
| Official source archive | PASS (pre-delta evidence) | Prior Issue evidence records the verified 741,757,374-byte archive and SHA-256; recheck while producing the required per-file manifest |
| Extracted-file hash manifest | IN PROGRESS | The required SFZ, 641 audio, and provenance-file hashes have not yet been bound and checked by the analyzer |
| Analyzer and board/longitudinal metrics | IN PROGRESS | Existing 480-cell metrics are pre-delta; hash enforcement, low-register peaks, fit bands, brightness direction, and dynamic-span evidence remain |
| Latest fit artifact/source alignment | FAIL | The fit report records board radiation scale 6.5784186, while `grand_physics_fit_v9.h` currently sets 3.249554; regenerate and validate the fit evidence after calibration |
| PR #8 full-range baseline | PASS (baseline only) | Prior report: 480 direct cells, 1,408 renders, 1,392 adjacent comparisons; peak reached +1.5836 dBFS under the old +1.6 dBFS gate, so it does not meet the new <0 dBFS delta gate |
| WASM configure/build and CTest | IN PROGRESS | Prior 27/27 CTest pass is baseline-only; rerun against the final model and SIMD tests |
| Latest `concert-grand` regression | FAIL | `rtk node wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js` fails with `string harmonic spectrum too sparse` (0.0005212328942458759 / 0.00004030822268236699 / 8.61389257455428e-7) |
| Latest 480-cell output-guard sweep | FAIL | At hammer-force scale 100, default preset hardness 0.81, and board radiation scale 3.249554, 145/480 cells reached or exceeded 0 dBFS and the final guard recorded 36,596 hits; the required 1,408-key/layer matrix is not current evidence |
| Web Player tests/build | IN PROGRESS | Prior 39/39 tests and build pass are baseline-only; rerun after the delta |
| SIMD/scalar differential and performance | IN PROGRESS | Final-topology scalar comparison, kernel speedups, PR #8 CPU ratios, and `performance-simd-summary.json` are pending |
| Diff hygiene and artifact/privacy scan | NOT RUN | Run after the final scoped edits |
| Native browser/audio interaction | NOT RUN | No browser listening or hardware audio session was performed |

The pre-delta full-range report used a shared gain offset of +4.7693 dB. Direct-cell absolute level error was P50 4.2236 dB / P95 11.8864 dB / maximum 19.1777 dB; peak reached +1.5836 dBFS against the old +1.6 dBFS gate. Those baseline results had no failures under the old checks, but fail the new contract's strict peak limit and do not prove per-cell pitch/release or output-guard behavior. Centroid checks below 0.1% power above 2 kHz remain low-energy diagnostics; one baseline cell and five adjacent pairs fell below that energy floor. Velocity brightness evolved for 83/88 pitches (94.32%) under the aggregate check; the delta requires direct-pitch checks, including MIDI 21/24/27.

The Studio Piano and fuhton references are excluded from the active calibration plan. Raw Salamander audio remains in the user's private Drive and is not included in the repository or distributed plugin.

## 2026-10-02 Stage2H Corrective Review and Stage2I Loss-Authority Audit

| Item | Status | Evidence |
|---|---|---|
| Stage2H fixture binding (A1) | PASS | Fixture test now requires schemaVersion 3 and preserves the 480 direct-cell / 641 referenced-audio coverage. Fixture data was not regenerated or edited. |
| Stage2H source comparison (A2) | PASS | Optional source comparison now uses only `envelopeDbfs[5]`, `envelope20msDbfs[18]`, and `peakDbfs`; onset is not required. Mock coverage verifies missing required metrics fail and a hash mismatch prevents decode. |
| Stage2H numeric reconstruction | PASS (diagnostic) | 21 candidates, 105 C8/control cells and 10 span curves reconcile from saved Stage2F evidence; 0 renders. All 105 C8 late residuals are negative; all 21 candidates have at least one C8 shape-limit failure; 8/10 velocity-span curves exceed the existing 8 dB limit. Original audio reanalysis is NOT AVAILABLE. |
| Stage2I loss-authority mapping | PASS (mathematical audit) | Current equations/config were evaluated against the preserved Stage2H probes. At MIDI 108 the register gate and `ref_loss` are exactly 0 at every requested velocity; at MIDI 45 the gate is 0.8980842912 and `ref_loss` falls from 0.0021746651 (velocity 14) to 0.0012816724 (velocity 124). |
| Evidence identity | QUALIFIED | Stage2F results identify sourceRevision `6f4ab32bf20f9267eeb368aa4d7809e0fe846329`; current HEAD at analysis was `f7a1050ec59c132960d5c46f944d57ab4d02673f`. The audit preserves both identities and makes no causal claim or acoustic-equivalence claim. |
| Focused verification | PASS | Fixture test; Stage2H tests 8/8; Stage2I tests 6/6; full tuning suite 88/88 in the Issue #7 calibration venv; Stage2F dry-run reports 0 builds / 0 renders; Stage2H and Stage2I analyses each report 0 renders; `git diff --check`. |
| Issue #7 acceptance | BLOCKED / NOT RUN | This audit does not unlock Stage 3/4 or change physical tuning. Full 480, 1,408, 1,392, CTest, Web Player and listening acceptance were not run. Issue remains `phase:implementation` + `blocked`; PR #8 remains open. |

Copyable report: `.agent-state/issues/7/reports/2026-10-02-stage2h-stage2i-loss-authority.md`. No production DSP, preset coefficient, threshold, source equation, or physical-candidate slot was changed.
