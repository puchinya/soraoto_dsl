# SuperSynth V9 status

> This document records current evidence. It is non-normative; the product specification and approved design define requirements and decisions.

**Owning Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7) — SuperSynth V9 Salamander Calibration and Full-Range Delivery
**Pull Request:** [#8](https://github.com/puchinya/soraoto_dsl/pull/8)
**Issue phase:** `phase:design`
**Updated:** 2026-09-27

## Progress

| Work item | Status | Evidence / limitation |
|---|---|---|
| Physical-model / SIMD / CPU contract | PASS | Exact user attachment preserved at `.agent-state/issues/7/implementation-contract-physical-model-simd-cpu.txt`; SHA-256 `3c260156dcd84e12e388b200fb691abb2e03d7f2f71f0aa8db602fa0b8a18bc4` |
| Preset-owned physical-configuration contract | PASS | Exact user attachment preserved at `.agent-state/issues/7/implementation-contract-preset-physical-config.txt`; SHA-256 `a84d8e9c591c5bfa96a2c9aeb93fb68d864d8854467866256663b4fe7806f9e6` |
| Owning Issue and phase | IN PROGRESS | Issue #7 is `phase:implementation`; all supplied contracts, approved design, normative updates, and Reviewer Checklist are recorded |
| PR #8 baseline identity | PASS | PR head and contract baseline are `6f4ab32bf20f9267eeb368aa4d7809e0fe846329`; working branch contains documentation and implementation changes that still require verification and push |
| Product specification and design | PASS | Project remains an ephemeral IR generated from DSL; no Project save/load or Plugin state restore path; `grand_piano_v1` remains at its existing revision |
| Existing V9 physical renderer | BASELINE | Hammer, waveguide strings, bridge, board, sympathetic, and longitudinal paths exist in `plugin.c`; sound-affecting coefficients remain split across C, `presets.json`, and `grand_physics_fit_v9.h` |
| Grand profile schema/generator | IN PROGRESS | Profile schema, deterministic generator, and metadata tests are being updated; build evidence is pending |
| Preset/runtime configuration | IN PROGRESS | Apply the DSL-selected factory preset and profile, remove state hooks, and clear incompatible transient DSP state on profile changes |
| Baseline migration equivalence | NOT RUN | Must pass before acoustic tuning: 8 MIDI keys × 3 velocities × sustain off/on, with contract deltas for lifecycle, peak, envelope, pitch, and spectral metrics |
| Post-migration acoustic calibration | NOT STARTED | After equivalence, follow expected-f0 pitch, independent hammer/radiation, windowed C4 harmonics, held-vs-release decay, bypass routing, and pan-fit order |
| Production-SIMD final matrix | NOT RUN | Final 480 direct-reference cells, 1,408 production lifecycle cells, 1,392 adjacent comparisons, and acoustic regressions are pending; SIMD/scalar and speed ratios are informational |
| Salamander reference and provenance | PASS (prior evidence) | Approved FreePats V3 SFZ+FLAC archive, 48 kHz/24-bit, CC BY 3.0; archive SHA `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b` |
| Per-file reference hash manifest | NOT RUN | Bind SFZ, all 641 referenced audio files, required license/provenance files, and archive hash; analyzer must verify before analysis |
| Repository/Web Player verification | NOT RUN | Full CTest and Web Player test/build must be rerun after implementation |
| Native browser/audio interaction | NOT RUN | No physical-device playback or listening evidence is claimed |
| Delivery | IN PROGRESS | Continue on the existing PR branch; commit/push, update PR #8, and move Issue to `phase:review` after all required evidence and self-review |

## Verification

| Check | Status | Result |
|---|---|---|
| Contract preservation | PASS | Physical-model, preset-owned, and architecture-delta copies match their attachments: `3c260156dcd84e12e388b200fb691abb2e03d7f2f71f0aa8db602fa0b8a18bc4`, `a84d8e9c591c5bfa96a2c9aeb93fb68d864d8854467866256663b4fe7806f9e6`, `2cd6f433881f81fc349199ca87b3c1e6aba603df0bfce33e4ba09aa8ea4a79ca` |
| Issue phase and PR head | PASS | Issue #7 is `phase:implementation`; open PR #8 head remains baseline `6f4ab32bf20f9267eeb368aa4d7809e0fe846329` until changes are pushed |
| Current baseline acoustic artifacts | BASELINE ONLY | Existing reports describe the pre-refactor renderer; they cannot prove migration equivalence or final calibration |
| Production-only lifecycle gate | NOT RUN | Dedicated production-SIMD evidence is required; scalar/SIMD differential `pass:false` is diagnostic only |
| WASM build and CTest | NOT RUN | Rerun after the profile loader/configuration changes |
| Web Player tests/build | NOT RUN | Rerun after implementation |
| Diff hygiene/privacy scan | NOT RUN | Run against final pushed diff |

The baseline renderer has previously reported a sparse C4 harmonic spectrum and output-guard/peak
failures. Those failures will be re-established after the presetization equivalence gate and resolved
only by changing the owning profile values or model behavior in the user's fixed calibration order.
The previous scalar/SIMD aggregate `pass:false` is not used as the production gate result.

## 2026-09-30 Stage2F Anchored Local Recovery

| Item | Status | Evidence |
|---|---|---|
| Anchor provenance | PASS | Resolved historical Stage2B results `stage2b-v1-0001/0015/0016` to Stage2 v3 candidates by preserved provenance and exact six-axis vectors; manifest SHA-256 `17a8a88df8b8644bfb497808383c910478544e5939c03a44688f775a420d43e6`. |
| Calibration-only unison lower bound | PASS | `active-search-space.json` now uses `piano_string_unison` range `[0.4, 1.0]`; public Plugin range remains `[0.0, 1.0]`. |
| Current anchor requalification | BLOCKED | Three fresh production-SIMD renders pass Stage1/Stage2 pitch, finite, peak, guard, and buzz gates. All three fail `release_tail2_min_violation` by 3.02%–4.34%; zero anchors qualify. |
| Stage2F local design | NOT RUN | Correctly locked because there is no current eligible anchor. 0/21 local points rendered; no Stage 3, Stage 4, or final bake. |
| Focused verification | PASS | Python tuning tests 52/52; WASM configure/build; pitch conformance 96 fixtures; candidate/floor overlays; board-fit test; concert-grand regression; soundboard diagnostic transparency. |
| Full parent acceptance | BLOCKED / NOT RUN | 480 direct, 1,408 lifecycle, 1,392 adjacent, CTest, and Web Player suites were not run after Stage2F; return to design is required before local tuning can proceed. |

Full copyable report: `.agent-state/issues/7/reports/2026-09-30-stage2f-anchor-blocked.md`. Issue #7 remains `phase:implementation` + `blocked`; PR #8 remains open.

Raw Salamander audio remains in the user's private reference store and is not included in Git or the
distributed plugin. No private Drive identifiers, credentials, or absolute reference paths are
committed.

## 2026-09-30 Post-Attack Residual Diagnostic

| Item | Status | Evidence |
|---|---|---|
| Signed post-attack residual decomposition | PASS (diagnostic) | 8 conditions × 90 direct cells; 720 matrix cells plus calibration/transparency renders. Used the exact Stage 3 residual formula and retained signed early/late values. |
| Residual-owning subsystem | IDENTIFIED | Center A amount 0 had 9/90 cells above the existing 10 dB shape limit; all nine were late-dominant. Existing string-damping 0↔1 OAT moved a coherent treble group by >2.5 dB. Classification: `STRING_TERMINATION_DECAY`. |
| Soundboard attribution | DIAGNOSTIC ONLY | Component RMS was captured for normal mix and `RADIATION_BYPASS_DELTA`. Bypass p90 residual movement was <0.4 dB in both centers; board is not the owner of this late residual. Production soundboard values/routing were not changed. |
| Pitch / render health | DIAGNOSTIC | Five invalid pitch measurements occurred only in bypass conditions; zero guard hits, zero non-finite cells, worst peak `-7.672 dBFS`. Center A worst valid pitch was `27.571 cents`, outside the unchanged ±15-cent requirement. |
| Focused regression | PASS | WASM build, Stage 3 residual tests, diagnostic matrix/provenance tests, pitch-estimator synthetic conformance, `concert-grand-regression.test.js`, and paired-build soundboard diagnostic transparency passed. Python tuning suite could not import seven tests because Optuna was not installed in an isolated venv. |
| Final Issue #7 acceptance | BLOCKED / NOT RUN | This subset is not the 480 direct, 1,408 lifecycle, or 1,392 adjacency acceptance. Stage 3/4 were not started. No new parameter or production DSP change was made. |

Full copyable diagnostic report: `.agent-state/issues/7/reports/2026-09-30-post-attack-residual-mechanism.md`. Issue #7 remains `phase:implementation` + `blocked`; PR #8 remains open.

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

## 2026-10-02 Stage2J final-budget C8 path diagnostic

| Item | Status | Evidence |
|---|---|---|
| Candidate selection | PASS | Validated Stage2F v2 + Stage2H/I evidence; selected `stage2f-split-v3-s2-0016-L1` by the required ranking tuple. `0001-L1` was filtered by positive independent pitch/buzz constraints; `0015-L1` ranked second. |
| Current-HEAD ordinary measurement | PARTIAL | One candidate identity `stage2j-2ddddab0412a5324` consumed the final budget slot. Stage2B direct proxy completed 284 cells: loss 0.413571, peak −6.168758 dBFS, guard 0, finite, invalid 0/25. It recorded one direct pitch failure, post-attack violation +2.10144 dB, and MIDI 45 span violation +3.528952 dB. |
| Held/release and 32-constraint result | BLOCKED | Required held/release-only mode and `HELD_RELEASE_METRICS` marker are absent from the contract-mandated PR HEAD regression. The full regression stopped at C4 H3 plausibility 1.7520574688; no complete constraint vector or Stage2 feasible result exists. |
| MIDI 45 velocity span | FAIL | 16/16 layers reconstructed from the completed Stage2B subset: synth 31.201901 dB vs reference 19.672949 dB; signed error +11.528952 dB, exceeding the existing 8 dB bound by +3.528952 dB. Synth min/max velocities 14/77; reference 14/124. |
| C8 output-path variants | NOT RUN | The first capture call failed before rendering due to a build-root path issue. The path fix changed diagnostic identity, so the partial attempt cannot be resumed under exact provenance. No path-authority or physical-cause conclusion is made. |
| Budget / protected evidence | BLOCKED AT LIMIT | Physical count is 25/25. All 75 protected input hashes match before/after. No further candidate, Stage 3, or Stage 4 was run. |
| Focused verification | PASS | Stage2J tests 13/13; full tuning suite 101/101; current-HEAD production-SIMD WASM preflight build; fixture test; Node syntax and `git diff --check`. Current dry-run correctly fails closed on partial provenance mismatch with 0 build / 0 render. |
| Issue #7 acceptance | BLOCKED / NOT RUN | Need a new requirements/design decision and explicit budget approval before any further candidate evaluation. Stage 3/4, full CTest, Web Player and manual listening remain unrun. Issue remains `phase:implementation` + `blocked`; PR #8 remains open. |

## 2026-10-02 Stage2K — Candidate-25 evidence completion

| Item | Status | Evidence |
|---|---|---|
| Acoustic artifact identity | PASS | Candidate `stage2j-2ddddab0412a5324`, source revision `3cd14834…`, exact parameter/config/subset identity; production-SIMD WASM SHA `0f8bc8c387df520c54abe7d26e73c83457610a9f6519542d9a0c362d9ec0612b` matched before and after all supplementary measurements. |
| Budget | PASS | 25/25 before and after; candidate count delta 0. Seven supplementary renders only: two held/release and five C8 variants. |
| Held / release | PASS (measured) | heldDecayRatio 0.748930; release tails 0.002176740 / 0.000561672 / 0.000030691; tail3/tail2 0.054642; finiteRelease=true; stuckVoiceCount=0; guard=0. |
| 32 Stage2E constraints | FAIL | Existing `stage2e_constraints` produced 32/32 finite values. Positive independent constraints: post-attack shape +2.101440 dB, MIDI 45 dynamic span +3.528952 dB. `stage2b_violation` repeats the max as an aggregate. |
| C8 path diagnostics | PASS (diagnostic) | Five required variants completed on the same WASM. All finite, guard=0. Normal mix=1; board-off mix=0; masks 0/0/1/2/4. Board-off shifted late residual by −0.0385 dB; dry-transverse ablation reduced peak by about 17.26 dB while relative shape error shifted about −0.0894 dB. Diagnostic differences do not prove physical root cause. |
| Protected inputs | PASS | 75/75 protected SHA-256 values unchanged; no production source, preset, fixture, threshold, or WASM modification. |
| Verification | PASS | Stage2K tests 7/7; full tuning suite 108/108; candidate export checks; preflight dry-run; reference fixture 480/480 cells / 641 samples; scoped privacy and diff checks. Existing candidate artifact was reused; no rebuild was needed. |
| Issue #7 acceptance | BLOCKED | Candidate 25 fails Stage2B shape/span constraints. Budget is exhausted, so further acoustic tuning requires a separate requirements/design contract and explicit budget approval. Stage 3/4, full CTest, Web Player, source-audio decode, and manual listening remain NOT RUN. Issue remains `phase:implementation` + `blocked`; PR #8 remains open. |

## 2026-10-03 Stage2L revision-2 model evaluation

| Item | Status | Evidence |
|---|---|---|
| Revision-2 implementation | PASS | Added time-normalized scalar string loss cached by prepared pitch, made passive loss velocity-independent, and replaced piecewise hardness with the approved continuous pivot mapping. Internal profile revision is 2; public ABI/product versions unchanged. |
| Candidate 1 | BLOCKED BY DIRECTION GATE | Production-SIMD Stage2E completed 284 direct-proxy cells and 16 MIDI 45 velocity layers. C8 post-attack violation improved from +2.101440 to −0.179817 dB, but MIDI 45 span violation worsened from +3.528952 to +4.674648 dB; pitch violation +0.966510 is also positive. |
| Safety / lifecycle | MIXED | Peak −5.340350 dBFS, guard 0, finite, invalid measurements 0, buzz 0.110870, release finite, stuck voices 0. |
| Revision-2 budget | STOPPED | 1/12 identities used. Candidate 1 failed the requirement to improve both primary failures without a new independent safety violation; no GPSampler proposal, Stage 3, or Stage 4 followed. |
| Focused verification | PASS / FAIL | Build, Stage2L 6/6, tuning suite 107 passed + 1 skipped, loss-math error 1.1920929e−7, dry-run zero render, and `git diff --check` PASS. Concert-grand regression still FAILS the independent soundboard-control check at 0.00039014785809495076. |
| Issue #7 | BLOCKED / NOT ACCEPTED | Further physical tuning requires a new requirements/design decision. Full CTest, Web Player, Stage 3/4, original audio decode, and manual listening remain NOT RUN. Issue stays `phase:implementation` + `blocked`; PR #8 remains open. |

Copyable report: [`stage2l-model-revision.md`](stage2l-model-revision.md).
