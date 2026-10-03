# Stage2O Low-Register Pitch Authority — Blocked

**Decision:** `BLOCKED_STAGE2O_ESTIMATOR_UNRESOLVED`

Stage2O evaluates the unchanged Stage2N revision-3 candidate with the corrected low-register
base-f0 authority. Source A derives `B_A` and base `f0_A` from measured H1/H2; Source C is the full
inharmonic fit and supplies the authoritative pitch; autocorrelation is diagnostic only. The 8-cent
A/C agreement and ±15-cent pitch limits are unchanged.

## Evidence

| Check | Result |
|---|---|
| Candidate identity | `stage2n-r3-candidate-01`; no new acoustic candidate |
| Stage2N baseline | `9d8af93dd7f02fff3d16ea36a1cd0edadba9a6f4` |
| Candidate WASM SHA-256 | `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2` |
| Candidate config SHA-256 | `792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d` |
| Fixed low-register renders | 24/24 completed; candidate budget delta 0 |
| Valid A/C measurements | 14/24 |
| `MEASUREMENT_INVALID` | 10/24; one cell failed the prominence minimum and nine produced `B_A < 0` |
| MIDI 21 / velocity 14 raw H1 provenance | `+13.0479225` cents; within the required 0.5-cent check |
| Peak / guard / finite | Worst peak `−4.880980 dBFS`; guard hits 0; all 24 finite |
| Stage2E | Not run; the required low-register measurement-validity gate did not pass |
| Stage3 / Stage4 | Not run |

Source C alone is not substituted for invalid Source A. No physical coefficient, pitch limit,
candidate vector, or shared DSL/ABI file changed.

The same-metric MIDI 21 raw H1 check passes, but Source A is ineligible there because H1 prominence
is below 3. This confirms the prior low-order spectral observation while leaving the contracted A/C
authority unresolved. Do not classify Stage2E, bake the candidate, or unlock Stage3 from this matrix.

Detailed per-cell diagnostics remain private and are not committed.

## Verification

- Pitch estimator synthetic conformance: PASS; 84 low-register fixtures, 11 invalid rows where
  Source A's measured `B_A` was outside range, 72 valid rows, worst valid base-f0 error `0.02304`
  cents. The mandatory MIDI 21 / −30-cent / B=0.01 fixture is a valid physical FAIL.
- Above-100-Hz golden regression: PASS for MIDI 48/60/84/108.
- Salamander fixture: PASS, 480 direct cells / 641 referenced audio items.
- Candidate provenance: PASS; WASM/config hashes match Stage2N, protected shared DSL/ABI hashes
  unchanged, physical candidate delta 0.
- Stage2O dedicated result analyzer tests: PASS, 4/4.
- Stage2E, CTest, Web Player, Stage3/4 and manual listening: NOT RUN.

Issue #7 remains `phase:implementation` + `blocked`; PR #8 remains open.
