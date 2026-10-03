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
