# Stage2N Revision 3 Result

Date: 2026-10-03
Issue: [#7](https://github.com/puchinya/soraoto_dsl/issues/7)
Pull request: [#8](https://github.com/puchinya/soraoto_dsl/pull/8)

## Persistence alignment

- Generic persistence ownership: `DSL_ONLY`.
- Canonical persisted Plugin configuration: `PluginConfigurationV1`.
- Plugin-owned persistent snapshot/load: `NONE`.
- SuperSynth profile selection, generated grand profile, and dependent DSP caches are transient derived runtime state. The Host reapplies DSL configuration on reload.
- Stage2N changed no shared DSL/ABI files. The pre-existing shared-file hashes matched before and after the candidate evaluation.

## Revision 3 model

- Revision 3 retains revision-2 time-normalized string loss (`N`) and velocity-independent passive loss (`V`), and restores the exact legacy piecewise hardness mapping (`H`).
- No public parameter, ABI, Plugin ID, or version change was part of Stage2N.
- Stage2L candidate budget remains `1/12`; Stage2N used its separate, authorized `1/1` candidate slot.
- The fixed revision-3 candidate used the preserved Stage2L candidate-1 vector. No additional candidate identity was created.

## Evaluation

- Fixed 011 equivalence preflight: **PASS**, all 18 required cells matched within the saved tolerances.
- Stage2E: **FAIL**, one hard-gate family remains positive: absolute pitch.
- Pitch failure: MIDI 21, velocity 14, `+29.4857 cents`; the measurement is valid and the same cell fails Stage 1 and Stage 2.
- Other measured Stage2E hard constraints: pass. Measurement invalid count: 0/25.
- Stage2B/direct proxy: 284 cells; no direct-pitch or brightness-direction failures; dynamic-span and post-attack shape checks remain within their current limits, with the narrowest margins `0.0984 dB` and `0.1191 dB` respectively.
- Worst measured peak: `-4.8810 dBFS`; guard activations: `0`; output finite: yes.
- Stage1: brightness ratio `3.0394`; low-register buzz `0.112456` against `<0.12`; peak `-12.6098 dBFS`; guard `0`.
- Held/release: finite release, stuck voices `0`; held-decay ratio `0.703841`; tail levels `0.00174887 / 0.00037394 / 0.000015806`.
- Candidate budget: `1/1` consumed. Stage 3 and Stage 4 were not run and remain locked.

## Verification

- PASS: WASM configure/build before the physical evaluation.
- PASS: Salamander reference fixture test, 480 cells.
- PASS: Stage2N Python tests, 9 tests.
- PASS: Stage2N capture helper test, exact 18-cell coverage.
- PASS: fixed 011 equivalence preflight.
- PASS: protected source/config and shared ABI hashes unchanged by the candidate run.
- PASS: `rtk git diff --check`.
- NOT RUN: full CTest, Web Player tests/build, Stage 3 (480 direct cells), Stage 4 (1,408 lifecycle cells and 1,392 adjacent comparisons), manual listening.

## State

Issue #7 remains `phase:implementation` + `blocked`; PR #8 remains open and retains `Closes #7`. Stage2N did not meet its acoustic pitch gate. The one-candidate budget is exhausted, so further acoustic candidate evaluation requires a new requirements/design decision and explicit budget approval.
