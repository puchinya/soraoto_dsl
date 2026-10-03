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
