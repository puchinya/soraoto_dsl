# Stage3B Contact Attribution Status

## Decision

`STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE`

This is a zero-acoustic-render preflight result. It resolves the production provenance blocker and corrects the factor-selection gates. It does not authorize mask-0 acoustic renders or the 477 Stage3B diagnostic renders.

## Provenance and accounting

- Preflight baseline: `c1fd7f39b1c5d8353862169cadf7e187a7ed6eb6`.
- Fixed candidate: `stage2n-r3-candidate-01`.
- Authoritative production WASM remains SHA-256 `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`.
- Stage3A evidence validated and remains the M0 baseline; it was not rerendered.
- Embedded plugin descriptor matches exactly one isolated metadata variant: C, generated from clean Stage2Q inputs with only a temporary copy of the existing dirty descriptor.
- C runtime metadata fingerprint equals clean Stage2Q and clean Stage3B baseline fingerprints; fixed profile identity matches.
- Embedded interface matches Stage2Q byte-for-byte. Stage2Q-to-Stage3A production-input diff is empty.
- The existing dirty descriptor and authoritative production artifact were unchanged by reconciliation.
- Isolated ordinary production build SHA-256: `eef4fb43c8df85d7840bacd258e289448d2f841c95a02157d29d45803341df47`; byte-identical rebuild was not achieved, so provenance classification is `SUFFICIENT_METADATA_PROVENANCE`.
- Stage3B diagnostic WASM SHA-256: `2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9`.
- Stage3B acoustic renders: 0. Production candidate delta: 0. Stage4 renders: 0.

Detailed hashes, A/B/C header and CBOR metadata, toolchain information, and descriptor working-tree integrity are recorded privately in `.agent-state/issues/7/stage3b/preflight-provenance.json`.

## Selection-gate corrections

- Worst failing pitch is selected from M0 span error; the persisted Stage3A measurements confirm MIDI51 at 20.696187 dB. The six-decibel gate now applies to MIDI51 for each factor.
- MIDI96/v31 direct-level error uses I and P factorial main effects independently.
- MIDI41 derivative checks are factor-specific: I uses masks 1/3 and P uses masks 2/3.
- Safety checks are factor-specific. An unsafe mask family does not automatically disqualify the other family.
- Decision precedence compares eligible safe families, and does not use comparative or interaction evidence against an unsafe family.

## Verification

- Provenance parser/unit tests: PASS.
- Stage3B selection/ledger tests: PASS.
- Gate self-check against actual Stage3A M0 evidence: PASS; worst pitch MIDI51.
- Dedicated Stage3B CMake configure/build: PASS; diagnostics enabled, production build directory untouched.
- `--preflight`: PASS as `STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE`; 0 acoustic renders; no Stage3B ledger cells created.
- Ordinary `--dry-run`: PASS; 0 builds and 0 renders; 477 future identities reported.
- `git diff --check`: PASS.
- Production and Stage3A artifact hashes: PASS.
- Stage3B mask-0 equivalence, 477-cell render matrix/finalization, Stage3 production acceptance, Stage4, full CTest, Web Player, and manual listening: NOT RUN by contract.

Issue #7 remains in implementation and blocked. Stage3B may proceed only under a separate contract authorizing mask-0 acoustic equivalence. No Stage3B architecture has been selected.

## Stage3B execution-lock correction — 2026-10-04

- Added a required private authorization artifact at `.agent-state/issues/7/stage3b/mask0-equivalence-authorization.json`. It must bind schema 1, `STAGE3B_MASK0_EQUIVALENT`, candidate ID, current production and diagnostic WASM SHA-256 values, the current preflight-provenance SHA-256, production candidate delta 0, and Stage4 renders 0.
- The normal `--execute` and `--finalize` modes now require that authorization before Stage3B state inspection. Direct production calls to the exported finalizer enforce the same gate. `identityOverride` remains available only for injected unit-test identities; the CLI cannot provide it.
- With no real authorization artifact present, CLI `--execute` and `--finalize` both exit nonzero with `BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED`. Tests also verify that direct `finalize()` blocks before reading/writing acoustic state. No acoustic ledger, cells, aggregates, or final result exist.
- `--preflight`: PASS as `STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE`, provenance `SUFFICIENT_METADATA_PROVENANCE`, one isolated production-provenance build, zero acoustic renders. Current private preflight-provenance SHA-256: `e90cefbf5336f4e39ce401f6bd4c671098cb7ae36cf60cc8a67d6a3cfc4c4a30`.
- `--dry-run`: PASS, builds 0, renders 0, masks 1/2/3, 477 future identities, mask-0 renders 0. The private authorization file, acoustic ledger, and final-result file are all absent.
- PASS: Stage3B authorization/runner test, production-provenance test, JavaScript syntax checks, scoped `git diff --check`, production WASM SHA unchanged (`9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`), diagnostic WASM SHA unchanged (`2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9`), and dirty descriptor hash unchanged (`6ba10fccb856d56adccd21d67966d9625eadd070ac1891b3587dd24e18c007a0`).
- No real authorization artifact was created. No mask-0 or Stage3B acoustic render, ledger/cell write, aggregate write, or finalization was performed. Production candidate delta remains 0; Stage4 remains 0/locked. Stage3B workflow state remains `STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE`; Issue #7 remains `phase:implementation` + `blocked`.
- NOT RUN: mask-0 acoustic equivalence, 477 Stage3B renders/finalization, Stage3 480-cell acceptance, Stage4, full CTest, Web Player tests/build, and manual listening.

## Stage3B mask-0 evidence-binding correction — 2026-10-04

This section supersedes the earlier execution-lock artifact path and schema above. The prior implementation used `mask0-equivalence-authorization.json`; it no longer grants production execution. The sole accepted path is `.agent-state/issues/7/stage3b/mask0-equivalence.json`, with decision `STAGE3B_MASK0_EQUIVALENCE_COMPLETE` and fields binding the current candidate, production and diagnostic WASM hashes, accepted preflight classification/SHA, all three Stage3A evidence SHAs, finite/guard outcome, exact tolerance `0.000001`, measured maximum metric difference, render count, production candidate delta 0, and Stage4 count 0.

Any future Stage3B acoustic ledger stores both `mask0EquivalenceSha256` (hash of the exact result-file bytes) and `preflightProvenanceSha256`. Execute/resume, each new cell, and finalization must validate the same pair. A mismatch stops before a pending cell becomes `IN_PROGRESS`; existing evidence is never silently rebased. Synthetic tests must inject identity and binding explicitly. This correction does not create the real mask-0 result, ledger, cells, or render evidence.

Verification:

- PASS: `run-stage3b-contact-attribution.test.cjs` covers malformed/missing and mismatched result fields, accepted provenance classes, three Stage3A SHA bindings, exact tolerance/limit, exact-byte hash changes, required ledger binding, changed-binding resume/finalize blocks, explicit test injection, and mid-run evidence replacement before the next cell enters `IN_PROGRESS`.
- PASS: `stage3b-production-provenance.test.cjs`.
- PASS: `--preflight` → `STAGE3B_PREFLIGHT_READY_FOR_MASK0_EQUIVALENCE`; one isolated provenance build, zero acoustic renders, classification `SUFFICIENT_METADATA_PROVENANCE`. Current preflight-provenance SHA-256: `f69e8adf900db451bc91c48928f914dc8b7da28b732e533f1742d5b49d9ce1dc`.
- PASS: `--dry-run` → 0 builds, 0 renders, 477 future identities, zero mask-0 renders.
- PASS: real CLI `--execute` and `--finalize` both exit nonzero with `BLOCKED_STAGE3B_MASK0_EQUIVALENCE_NOT_AUTHORIZED` because the authoritative result is absent.
- PASS: scoped `git diff --check`. Production WASM SHA-256 remains `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`; Stage3B diagnostic WASM remains `2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9`; working-tree descriptor SHA-256 remains `6ba10fccb856d56adccd21d67966d9625eadd070ac1891b3587dd24e18c007a0`.
- Confirmed absent: new and old mask-0 files, Stage3B ledger, cells, aggregates, and final result. No real mask-0 result or acoustic render was created; production candidate delta remains 0 and Stage4 remains 0.
- NOT RUN by contract: mask-0 equivalence render, 477 acoustic renders/finalization, Stage3, Stage4, full CTest, Web Player tests/build, and manual listening.

Issue #7 remains OPEN, `phase:implementation` + `blocked`. This correction only hardens the future render lock.

## Stage3B CLI render-lock completion record — 2026-10-04

**STAGE3B_CLI_RENDER_LOCK_COMPLETE**

This decision records completion of the CLI/evidence-lock implementation only. It does not establish mask-0 acoustic equivalence or complete Stage3B attribution, and it does not pass Stage3 or unlock Stage4.

- Real `.agent-state/issues/7/stage3b/mask0-equivalence.json`: absent.
- Real mask-0 renders: 0.
- Stage3B acoustic ledger, cells, aggregates, and final result: absent.
- Stage3B acoustic renders: 0.
- Production candidate delta: 0.
- Stage4 renders: 0; Stage4 remains NOT RUN / LOCKED.
- Stage3 remains `BLOCKED_STAGE3_DIRECT_REFERENCE`.
- Next work requires a separate Stage3B mask-0 acoustic-equivalence Implementation Contract.

The token means only that the execution lock is complete; it does not authorize any acoustic render. Issue #7 remains OPEN with `phase:implementation` and `blocked`; PR #8 remains OPEN with `Closes #7`.

## Stage3B mask-0 acoustic equivalence — 2026-10-04

**STAGE3B_MASK0_EQUIVALENCE_COMPLETE**

The six authorized Stage3B diagnostic-WASM renders used Stage2M mask 3 and Stage3B mask 0. Each matched both the saved production Stage3 capture and accepted Stage3A diagnostic row across the contracted output, hammer, and soundboard diagnostics. The maximum numeric difference was `0` against the exact `1e-6` tolerance. All six were finite, had zero output-guard hits, and had negative measured and full-render peaks; the worst peak was `-4.880980 dBFS`.

- Authorized cells: `(36,14)`, `(36,124)`, `(51,14)`, `(51,124)`, `(96,31)`, `(96,124)`; COMPLETE `6/6`; new renders `6`; no build was run.
- Accounting: historical Stage3A diagnostic calls `390`; new mask-0 calls `6`; cumulative diagnostic calls `396`; production candidate delta `0`; Stage4 renders `0`.
- Production, Stage3A diagnostic, and Stage3B diagnostic WASM hashes remained the pinned identities recorded above. Preflight provenance remains `SUFFICIENT_METADATA_PROVENANCE`.
- The authoritative mask-0 result passed the existing Stage3B validator. Repeated `--finalize` was idempotent and rendered zero cells.
- PASS: the dedicated mask-0 runner tests (11/11), existing Stage3B runner tests, existing production-provenance tests, mask-0 dry-run (0 builds/0 renders/6 cells), actual six-cell execution, zero-render finalize, read-only artifact validation, and `git diff --check`.
- Stage3B masks 1/2/3 attribution (`477` renders) remains NOT RUN and locked pending its separate contract. Stage3 480-cell recapture, Stage4, full CTest, Web Player, and manual listening remain NOT RUN.

Issue #7 remains OPEN with `phase:implementation` and `blocked`; PR #8 remains OPEN with `Closes #7`. This result authorizes no factor render by itself.

## Stage3B mask-0 Completion Report — 2026-10-04

**STAGE3B_MASK0_EQUIVALENCE_COMPLETE**

This completion record uses the persisted mask-0 evidence only. No renderer, build, preflight, or finalization command was run for this report.

| MIDI | Velocity | Production max difference | Stage3A diagnostic max difference | Combined max difference | Finite | Guard hits | Peak dBFS | Full-render peak dBFS | Result |
|---:|---:|---:|---:|---:|:---:|---:|---:|---:|:---:|
| 36 | 14 | 0 | 0 | 0 | true | 0 | -38.504727 | -38.50472659272666 | PASS |
| 36 | 124 | 0 | 0 | 0 | true | 0 | -4.88098 | -4.880979944191414 | PASS |
| 51 | 14 | 0 | 0 | 0 | true | 0 | -47.545753 | -47.54575302855055 | PASS |
| 51 | 124 | 0 | 0 | 0 | true | 0 | -7.163076 | -7.163076230820552 | PASS |
| 96 | 31 | 0 | 0 | 0 | true | 0 | -29.897132 | -29.89713248540157 | PASS |
| 96 | 124 | 0 | 0 | 0 | true | 0 | -15.95573 | -15.955730012201277 | PASS |

Exact-byte SHA-256:

- Mask-0 ledger: `23ff977042540645cd99be1392cce6ee0341faa7dcf4dad50156b04b523e1f57`
- Mask-0 evaluation: `4f8a3cd31bec279fdc48d24d73a6d93d3b120aa21d0bb98565d11d137e6e2d55`
- Authoritative result: `fc54305c158e706ca5a28eeacdf9390c029a932283d94d047c9a443a28eb702a`

Accounting: authorized mask-0 renders `6`; actual mask-0 renders `6`; additional renders for this report `0`; Stage3B masks 1/2/3 attribution `NOT RUN` (`0` renders); production candidate delta `0`; Stage4 `0` renders and remains **LOCKED**. The 477-cell attribution is **NOT RUN** and remains locked pending its separate execution contract.

## Stage3B 477-cell contact attribution — 2026-10-04

**BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY**

The authorized Stage3B factorial matrix completed and was finalized from persisted evidence. The result is a safety blocker: every cell was finite, but mask 1 and mask 3 violated output safety. No factor is selected and this result authorizes no production change.

### Repository and provenance

- Starting HEAD / source revision: `064db066955e9e72c77ebe60dfd0ce4ad99ab615`.
- Candidate: `stage2n-r3-candidate-01`; Stage2N budget `1/1`; Stage2L budget `1/12`.
- Production WASM SHA-256: `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`.
- Config/profile/presets/reference-fixture SHA-256: `792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d` / `cf3d4adabd055b1b9895820bcaeee95b4a4999d6a245bea06c07fb14eeb7eb66` / `cbe58468911ee583d535c7d3ce09bd40199aeb93183def0a8204d591feac4431` / `5d27b6beae2a3c478e21ef0e260e588fdfd22bd1fea4181c74c0d00520a08cd7`.
- Stage3A diagnostic WASM SHA-256: `59d661e4e435298baf8f097fc1d85bfc8c517c2af1c23f391963a125cb3328b3`.
- Stage3B diagnostic WASM SHA-256: `2fe2919e9d903ade8e42c1eab44a081d1119bdbdc322961e9427fccc571a78d9`.
- Mask-0 result SHA-256: `fc54305c158e706ca5a28eeacdf9390c029a932283d94d047c9a443a28eb702a`.
- Preflight provenance: `SUFFICIENT_METADATA_PROVENANCE`; SHA-256 `f69e8adf900db451bc91c48928f914dc8b7da28b732e533f1742d5b49d9ce1dc`.
- Stage3A ledger/final/supplement SHA-256: `e43d6d1b88f57766d0c48e413801916b313580cec83d629b54835be0f23060e9` / `e953ba33a363f378a006aafcbe4066cb1b05d69ac42ca1f401cd68d7e7261cd4` / `91b6b4df895a2a044135752156b88d1ab04806f02ebd338a8518f703e29c1713`.

### Render accounting and safety

- Authorized factor renders: `477`; actual new factor renders: `477`; COMPLETE `477`; PENDING `0`; IN_PROGRESS `0`.
- Factor masks: `1`, `2`, `3`; Stage2M mask `3`; mask-0 rerenders `0`.
- Stage3A historical calls `390`; mask-0 equivalence calls `6`; Stage3B factor calls `477`; factual cumulative diagnostic calls `873`.
- The finalizer's legacy report field still says `totalStage3aAndStage3bCalls = 867` (`390 + 477`) and omits the separate six mask-0 calls. This is a known reporting-only discrepancy; the persisted render ledger independently records `477` new calls. It did not affect factor selection. No runner or test code was changed under this contract.
- Production candidate delta: `0`; Stage4 renders: `0`.
- Finite cells: `477/477`; total output guard hits: `1,440,235`; worst peak and full-render peak: `+1.583625266 dBFS`.
- Mask 1: 59/159 safety-failing cells; 695,958 guard hits; worst full-render peak `+1.583625266 dBFS`.
- Mask 2: 0/159 safety-failing cells; 0 guard hits; worst full-render peak `-3.902679902 dBFS`.
- Mask 3: 58/159 safety-failing cells; 744,277 guard hits; worst full-render peak `+1.583625266 dBFS`.
- Factor I safety (masks 1 and 3): FAIL. Factor P safety (masks 2 and 3): FAIL.
- All renders used production SIMD, Stage2M mask `3`, Stage3B masks `1/2/3`, soundboard diagnostics, and the fixed 30–180 ms velocity-derivative window.

Safety-failing cells are listed by MIDI and velocity. Mask 1: MIDI36 `101,109,117,124`; MIDI42 `45,49,54`; MIDI45 `36,40,45,49,54,61,69,77`; MIDI48 `14,31,40,45,49,54,61,69,77,85,93,101,109`; MIDI51 `14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124`; MIDI54 `31,36,40,45,49,54,61,69,77,85,93,101,109,117,124`. Mask 3: MIDI36 `101,109,117,124`; MIDI42 `45,49,54`; MIDI45 `36,40,45,49,54,61,69,77`; MIDI48 `14,31,40,45,49,54,61,69,77,85,93,101,109`; MIDI51 `14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124`; MIDI54 `31,36,45,49,54,61,69,77,85,93,101,109,117,124`. Mask 2 had no safety-failing cells.

### Failing-pitch span results

The M0–M3 columns are absolute span error in dB. `I_main`, `P_main`, and `interaction` are the contract factorial effects on that error; positive error effect means worse. The improvement columns below use the runner's improvement convention, where positive means error reduction.

| MIDI | M0 | M1 | M2 | M3 | I improvement | P improvement | I effect | P effect | Interaction |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 36 | 12.580882 | 17.890174 | 12.980804 | 18.255703 | -5.292095 | -0.382725 | +5.292095 | +0.382725 | -0.034393 |
| 39 | 12.069386 | 13.534894 | 12.445666 | 13.887020 | -1.453431 | -0.364203 | +1.453431 | +0.364203 | -0.024154 |
| 51 | 20.696187 | 8.266599 | 21.758897 | 9.084338 | +12.552073 | -0.940224 | -12.552073 | +0.940224 | -0.244971 |
| 54 | 9.249924 | 5.004335 | 10.117455 | 4.977901 | +4.692572 | -0.420549 | -4.692572 | +0.420549 | -0.893965 |

MIDI51, the baseline-worst pitch, improves by `12.552073 dB` under the Factor I improvement convention and worsens by `0.940224 dB` under Factor P. Factor I reaches the required MIDI51 improvement gate, but only two of four failing pitches improve by at least 4 dB; its three-of-four gate fails.

Complete dynamic-span output for all required pitches. Each M0–M3 value is `synth span / reference span / absolute error / signed difference` in dB; the final columns are factorial effects on absolute error.

| MIDI | Group | M0 | M1 | M2 | M3 | I main | P main | Interaction |
|---:|---|---|---|---|---|---:|---:|---:|
| 33 | Control | 21.3630/18.2444/3.1187/3.1187 | 21.3630/18.2444/3.1187/3.1187 | 21.3630/18.2444/3.1187/3.1187 | 21.3630/18.2444/3.1187/3.1187 | 0.0000 | 0.0000 | 0.0000 |
| 36 | Failure | 33.6833/21.1024/12.5809/12.5809 | 38.9926/21.1024/17.8902/17.8902 | 34.0832/21.1024/12.9808/12.9808 | 39.3581/21.1024/18.2557/18.2557 | +5.2921 | +0.3827 | -0.0344 |
| 39 | Failure | 27.7951/15.7258/12.0694/12.0694 | 29.2607/15.7258/13.5349/13.5349 | 28.1714/15.7258/12.4457/12.4457 | 29.6128/15.7258/13.8870/13.8870 | +1.4534 | +0.3642 | -0.0242 |
| 42 | Control | 15.7936/18.8002/3.0066/-3.0066 | 31.8527/18.8002/13.0525/13.0525 | 15.8051/18.8002/2.9950/-2.9950 | 31.2225/18.8002/12.4223/12.4223 | +9.7366 | -0.3209 | -0.6187 |
| 45 | Control | 26.5268/19.6729/6.8539/6.8539 | 38.2430/19.6729/18.5700/18.5700 | 33.6877/19.6729/14.0148/14.0148 | 38.2703/19.6729/18.5974/18.5974 | +8.1494 | +3.5942 | -7.1336 |
| 48 | Control | 19.4092/17.4451/1.9641/1.9641 | 26.0327/17.4451/8.5876/8.5876 | 20.0811/17.4451/2.6360/2.6360 | 25.6503/17.4451/8.2052/8.2052 | +6.0963 | +0.1447 | -1.0543 |
| 51 | Failure | 37.1721/16.4759/20.6962/20.6962 | 8.2093/16.4759/8.2666/-8.2666 | 38.2348/16.4759/21.7589/21.7589 | 7.3916/16.4759/9.0843/-9.0843 | -12.5521 | +0.9402 | -0.2450 |
| 54 | Failure | 29.7988/20.5489/9.2499/9.2499 | 25.5532/20.5489/5.0043/5.0043 | 30.6664/20.5489/10.1175/10.1175 | 25.5268/20.5489/4.9779/4.9779 | -4.6926 | +0.4205 | -0.8940 |
| 57 | Control | 19.4577/23.6852/4.2275/-4.2275 | 8.9822/23.6852/14.7030/-14.7030 | 19.6114/23.6852/4.0738/-4.0738 | 8.7825/23.6852/14.9027/-14.9027 | +10.6522 | +0.0230 | +0.3534 |
| 93 | Treble | 24.7154/23.5125/1.2028/1.2028 | 17.7132/23.5125/5.7993/-5.7993 | 24.7015/23.5125/1.1889/1.1889 | 19.3710/23.5125/4.1416/-4.1416 | +3.7746 | -0.8358 | -1.6438 |
| 96 | Treble | 24.9516/26.2339/1.2823/-1.2823 | 20.8398/26.2339/5.3941/-5.3941 | 24.2395/26.2339/1.9945/-1.9945 | 23.8121/26.2339/2.4218/-2.4218 | +2.2696 | -1.1301 | -3.6845 |
| 99 | Treble | 25.0109/32.0192/7.0084/-7.0084 | 17.4157/32.0192/14.6036/-14.6036 | 25.1860/32.0192/6.8332/-6.8332 | 16.0672/32.0192/15.9521/-15.9521 | +8.3570 | +0.5867 | +1.5236 |

### Control pitches and subgroup results

Control worsening in absolute span error (dB; positive means worse):

| MIDI | Factor I worsening | Factor P worsening |
|---:|---:|---:|
| 33 | 0.000000 | 0.000000 |
| 42 | 9.730865 | 4.702113 |
| 45 | 11.729842 | 9.452232 |
| 48 | 6.432273 | 3.456483 |
| 57 | 10.575346 | 5.260731 |

| Group | Factor I mean improvement | Factor P mean improvement |
|---|---:|---:|
| Two-string (36,39) | -3.372763 dB | -0.373464 dB |
| Three-string (51,54) | +8.622323 dB | -0.680387 dB |
| Pooled failing pitches | +2.624780 dB | -0.526925 dB |

Mean absolute failing-pitch interaction: `0.299371 dB`. Factor I reverses direction between the two-string and three-string groups; Factor P does not.

### Treble and MIDI41 guardrails

MIDI96/velocity31 absolute direct-level error: M0 `6.749034 dB`, M1 `5.982623 dB`, M2 `6.768095 dB`, M3 `4.312521 dB`; `I_main = -1.610992 dB`, `P_main = -0.825520 dB`, interaction `-1.689163 dB`. Both ≤3 dB treble guardrails PASS.

Treble direct-level errors M0/M1/M2/M3 and factorial effects I/P/interaction, all in dB:

| MIDI | Velocity | M0/M1/M2/M3 absolute error | I/P/interaction |
|---:|---:|---|---|
| 93 | 14 | 4.2253/3.7082/4.2606/1.0290 | -1.8744/-1.3219/-2.7145 |
| 93 | 31 | 0.2093/0.5827/0.1594/1.2676 | +0.7407/+0.3175/+0.7348 |
| 93 | 61 | 1.3626/3.7521/1.4458/3.1467 | +2.0452/-0.2611/-0.6887 |
| 93 | 124 | 3.0224/9.5075/3.0717/5.1705 | +4.2919/-2.1439/-4.3861 |
| 96 | 14 | 0.1428/0.5544/0.1666/0.0649 | +0.1549/-0.2329/-0.5133 |
| 96 | 31 | 6.7490/5.9826/6.7681/4.3125 | -1.6110/-0.8255/-1.6892 |
| 96 | 61 | 0.3179/0.1187/0.3645/4.1370 | +1.7866/+2.0325/+3.9716 |
| 96 | 124 | 1.4252/4.8397/2.1611/2.3569 | +1.8052/-0.8734/-3.2188 |
| 99 | 14 | 0.6046/4.5776/0.5754/2.7667 | +3.0822/-0.9201/-1.7818 |
| 99 | 31 | 3.1274/6.1233/3.2084/3.0643 | +1.4259/-1.4890/-3.1401 |
| 99 | 61 | 4.8651/8.6740/4.8931/6.8783 | +2.8970/-0.8839/-1.8237 |
| 99 | 124 | 6.4038/11.1113/6.2579/13.1854 | +5.8175/+0.9641/+2.2200 |

MIDI41 derivative, 30–180 ms:

| Normalized velocity | M0 | M1 | M2 | M3 |
|---:|---:|---:|---:|---:|
| 0.25 | 0.062991 | 0.415140 | 0.063690 | 0.413098 |
| 0.55 | 0.053890 | 0.055096 | 0.054006 | 0.055264 |
| 0.90 | 0.242315 | 0.348419 | 0.241354 | 0.347165 |

MIDI41 factorial I/P/interaction effects for normalized velocities `0.25/0.55/0.90`: `+0.35077880/-0.00067102/-0.00274037`; `+0.00123191/+0.00014216/+0.00005239`; `+0.10595784/-0.00110780/-0.00029363`.

Hard derivative remains above mid. Factor I derivative guard FAILS: soft/mid/hard deviations are mask 1 `0.352149/0.001206/0.106105` and mask 3 `0.350108/0.001374/0.104850`; each required deviation must be ≤0.10. Factor P derivative guard FAILS because mask 3 exceeds 0.10 (mask 2 itself is within the guard).

### Gate matrix

| Gate | Factor I | Factor P |
|---|:---:|:---:|
| At least 3/4 failing pitches improve by ≥4 dB | FAIL | FAIL |
| MIDI51 improves by ≥6 dB | PASS | FAIL |
| All controls worsen by ≤3 dB | FAIL | FAIL |
| Factor-specific safety | FAIL | FAIL |
| MIDI96/v31 factorial worsening ≤3 dB | PASS | PASS |
| MIDI41 derivative guard | FAIL | FAIL |
| Two-/three-string direction does not reverse | FAIL | PASS |

Neither factor is safe, so comparative winner selection is not applicable. The finalizer's precedence selects `BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY`; no architecture is selected.

### Path attribution

Pooled factorial effects are in each metric's native units; `mean |interaction|` is across cells.

| Metric | I main | P main | Interaction | Mean |interaction| |
|---|---:|---:|---:|---:|
| Contact duration (samples) | 48.116352 | 0.059748 | -2.031447 | 3.792453 |
| Peak force | 83.418950 | 0.317006 | -0.493524 | 0.613343 |
| Post-contact transverse energy | 4,241,925.738018 | 80,943.941834 | 155,767.193425 | 242,380.545501 |
| Bridge-B RMS | 30.995189 | 1.165612 | 2.067496 | 2.120258 |
| Board-drive-B RMS | 30.994426 | 1.165557 | 2.067392 | 2.120153 |
| Post-radiation-L RMS | 1.910972 | 0.075732 | 0.147407 | 0.150707 |
| Spectral centroid (Hz) | 2,352.088243 | -59.916935 | -162.109868 | 244.941662 |
| Above-2k power ratio | 0.339161 | 0.001123 | -0.014898 | 0.018699 |

### Persisted evidence and next state

- Finalized ledger SHA-256 (exact current file): `3c688ce49877dd7a94a2920c02bc9ddb7145709d06b1e7a04a7aecda4b18fbaf`.
- Factorial analysis SHA-256: `220c4904fc858ee671002ce84de85a75abd2271f78a53f433dbf5bd4021675cb`.
- Ledger's analysis snapshot hash: `58132618393f3e84b04a0c38cdcbb8411b96e2c942e080ad51bab15fbd1e200c` (the ledger was finalized after this snapshot; both hashes are retained as persisted).
- Final decision: `BLOCKED_STAGE3B_DIAGNOSTIC_SAFETY`.
- Stage3 remains `BLOCKED_STAGE3_DIRECT_REFERENCE`; Stage4 remains NOT RUN / LOCKED.
- Issue #7 remains OPEN with `phase:implementation` and `blocked`; PR #8 remains OPEN with `Closes #7`.
- Stage3 production 480-cell recapture, Stage3A recapture, Stage4, full CTest, Web Player, and manual listening remain NOT RUN.

No code, DSP, candidate, configuration, threshold, or reference fixture was changed. The existing production and diagnostic build artifacts were reused; no build occurred. This status record does not authorize a 26th or repeat acoustic evaluation, production adoption of Factor I or P, or Stage4. A new requirements/design decision is required before any further acoustic evaluation or production architecture work.

## Stage3C contact-vs-bridge split diagnostic attempt — 2026-10-04

**Decision: `BLOCKED_STAGE3C_EQUIVALENCE`**

Stage3C diagnostic implementation and its dedicated production-SIMD diagnostic build were prepared. The fixed production WASM remained byte-identical (`9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`). Stage3B's persisted aggregate count was validated as **39**.

The authorized 20-cell equivalence gate ran to completion. Nineteen rows passed with maximum numeric difference `0`; the Stage3C mask-0 MIDI41 / normalized velocity `0.25` row failed the exact `velocityDerivativeWindowMs` comparison. The capture used `[0,160]` ms while its accepted Stage3A supplemental reference uses `[30,180]` ms. The measured row therefore cannot establish the required equivalence. This is an implementation contract violation in the Stage3C capture-window selection, not evidence of an acoustic mismatch. The Stage3B mask-1 checks, including unsafe guard telemetry, matched exactly where compared.

| MIDI / velocity | Stage3C mask 0 | Stage3C mask 3 |
|---|---:|---:|
| 36 / 124 | PASS, diff 0 | PASS, diff 0 |
| 39 / 124 | PASS, diff 0 | PASS, diff 0 |
| 45 / 69 | PASS, diff 0 | PASS, diff 0 |
| 48 / 69 | PASS, diff 0 | PASS, diff 0 |
| 51 / 14 | PASS, diff 0 | PASS, diff 0 |
| 51 / 124 | PASS, diff 0 | PASS, diff 0 |
| 54 / 124 | PASS, diff 0 | PASS, diff 0 |
| 57 / 124 | PASS, diff 0 | PASS, diff 0 |
| 96 / 31 | PASS, diff 0 | PASS, diff 0 |
| 41 / normalized 0.25 | FAIL, window mismatch | PASS, diff 0 |

Render accounting:

```text
Stage3C equivalence authorized = 20
Stage3C equivalence rendered   = 20
Stage3C split authorized       = 286
Stage3C split rendered         = 0
Stage3C total renders          = 20
cumulative diagnostic calls    = 893 (390 + 6 + 477 + 20)
production candidate delta     = 0
Stage4 renders                 = 0
```

The equivalence ledger has 20 `COMPLETE`, 0 `PENDING`, and 0 `IN_PROGRESS` rows. Its SHA-256 is `348409a1fe0ded9fd9f60d5cd91dcfd80990d4df1d8635578e079c86b7ca5055`; the blocked equivalence evaluation SHA-256 is `4141debf0673e8b36cd6c34363e0a8f0e91540e6cb228fef9e00dd3714d3fcf9`. This was the original attempt; its history remains immutable and the approved correction contract supplies the continuation path.

The previous cumulative value `993` was an arithmetic error. The corrected historical total is `893` (`390 + 6 + 477 + 20`).

## Stage3C equivalence correction and split continuation — 2026-10-04

Execution HEAD: `d3fa2e359dae0a8a21c04f1f535259d4a89cc59b` (PR #8). The original 20-cell ledger, blocked evaluation, all original cells, Stage3C WASM, Stage3C runner, capture helper, `plugin.c`, and CMake source remained unchanged.

The single authorized correction render for MIDI41 / normalized velocity `0.25` / Stage3C mask 0 used Stage2M mask 3 and the exact `[30,180] ms` derivative window. It matched the Stage3A supplement with maximum difference `0`:

- Correction decision: `STAGE3C_EQUIVALENCE_CORRECTION_COMPLETE`.
- Historical 19 PASS rows reused without rerender; the failed historical row remains immutable and is referenced as superseded.
- Correction render calls: `1`; correction cell SHA-256: `018da7dd3687006eb7989881d33b2daaf9b2fe93918c66ba7d084f64a42eb925`.
- Correction ledger SHA-256: `5fe8da6e32b7195a1b186f724ed41638b54db379ef2da64c2c00d75b09aef46b`.
- Corrected-equivalence SHA-256: `e28178043baaf087dae5795d63e3de5acb74cc06904972e88a5755f8860a8b97`.

The authorized contact/bridge split matrix then completed using masks 1 and 2 only:

| Measure | Result |
|---|---:|
| New split renders | 286 |
| COMPLETE / PENDING / IN_PROGRESS | 286 / 0 / 0 |
| Continuation aggregates | 24 |
| Finite cells | 286 / 286 |
| Output guard hits | 778311 |
| Worst full-render peak | +1.583625 dBFS |
| Continuation ledger SHA-256 | `6cd380fe66f7b0d0a7a410f00ba8e40fc403f6c9b227382c4d53cd903d6d5d19` |

### Finalization blocker

The zero-render `--finalize` attempt stopped before producing `split-attribution.json`. The existing `calculateAttribution()` helper hard-codes `.agent-state/issues/7/stage3c/split/ledger.json`; this contract requires continuation evidence under `.agent-state/issues/7/stage3c/continuation/` and forbids reusing the old `split/` path. That directory remains absent. No attribution result or architecture decision is claimed. Current state: `BLOCKED_STAGE3C_CONTINUATION_EVIDENCE` pending a narrowly scoped finalizer correction contract; no acoustic rerender is needed or authorized by this report.

Correct diagnostic-call accounting is:

```text
Stage3A historical                 390
Stage3B mask-0                       6
Stage3B factorial                  477
Stage3C original equivalence        20
Stage3C correction                   1
Stage3C contact/bridge split       286
--------------------------------------
cumulative diagnostic calls       1180
production candidate delta           0
Stage4 renders                       0
```

The totals after correction and after split execution were `894` and `1180`. Production architecture remains unselected. Stage3 remains `BLOCKED_STAGE3_DIRECT_REFERENCE`; Stage4 remains locked. Issue #7 remains OPEN / `phase:implementation` / `blocked`; PR #8 remains OPEN with `Closes #7`.

Stage3 remains `BLOCKED_STAGE3_DIRECT_REFERENCE`; Stage4 remains `NOT RUN / LOCKED`. Issue #7 remains OPEN / `phase:implementation` / `blocked`; PR #8 remains OPEN with `Closes #7`. No production architecture was selected.
