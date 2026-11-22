# Issue #7 Stage2P — Multi-window inharmonic-comb pitch authority

Status: `BLOCKED_STAGE2P_PHYSICAL_PITCH`. Issue #7 remains `phase:implementation` + `blocked`.

Stage2P replaces Stage2O's low-register H1/H2 measurement authority with the existing inharmonic-comb fit applied to exact FULL, EARLY, and LATE windows. It is evaluator-only and keeps the fixed Stage2N revision-3 candidate, ±15-cent pitch limit, and 8-cent window agreement limit unchanged.

## Fixed baseline

- Starting HEAD / PR #8 HEAD: `67f9ab93a69ff677c4f18f1a5e867a6c5ae63594`.
- Candidate: `stage2n-r3-candidate-01`.
- Candidate WASM SHA-256: `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`.
- Candidate config SHA-256: `792c563e3ae6ffbf6bef72b18a6c841a24598e1bc20ad5ec7dd39a4c0832513d`.
- Stage2L budget: 1/12; Stage2N budget: 1/1; Stage2P physical candidate delta: 0.

## Measurement definition

For expected f0 below 100 Hz, revision 3 uses the same single-window inharmonic-comb fitter and validity thresholds for FULL (65,536 samples), EARLY (32,768), and LATE (32,768). At 48 kHz these begin at frames 960, 960, and 33,728 from onset, respectively. H1/H2 inversion and autocorrelation remain diagnostic only.

At least two individually valid fits are required. A stable valid window group must span at most 8 cents. Three valid windows spanning more than 8 cents are classified as physical pitch instability and fail the unchanged ±15-cent requirement. Two valid windows more than 8 cents apart, or fewer than two valid windows, remain measurement-invalid.

## Verification

The fixed Stage2P 24-cell matrix completed on the exact Stage2N candidate artifact. All 24 measurements were valid, finite, below 0 dBFS, and had zero guard hits. Two cells had all three individually valid window fits but exceeded the 8-cent total-spread limit; per contract they are physical pitch-instability failures:

| MIDI / velocity | FULL cents | EARLY cents | LATE cents | Spread | Classification |
|---|---:|---:|---:|---:|---|
| 21 / 14 | -0.220654 | +0.026957 | -9.509495 | 9.536452 | `analysis-window-pitch-instability` |
| 24 / 14 | -0.547661 | +0.536323 | +25.830240 | 26.377901 | `analysis-window-pitch-instability` |

The matrix summary is 24 valid / 0 measurement-invalid, 2 physical pitch-instability failures, worst absolute valid estimate 25.830240 cents, worst peak -4.880980 dBFS, and 0 total guard hits. At MIDI21/velocity14, diagnostic Source A remains ineligible because H1 prominence is 1.503770; the multi-window comb is nevertheless valid and identifies the time-varying pitch evidence.

Decision: Stage2E is not eligible because the matrix contains physical pitch failures. No Stage2E rerun, bake, physical tuning, Stage3, or Stage4 was performed. Physical candidate delta remains 0; Stage2N remains 1/1 and Stage2L remains 1/12.

PASS estimator conformance: 96 legacy fixtures plus 84 low-register fixtures; low-register invalid count 0; worst known-f0 error 0.217215 cents; octave and partial locks 0; four >=100-Hz goldens unchanged. PASS exact Stage2P dry-run: build 0, physical renders 0. PASS WASM build, Salamander fixture (480 direct cells / 641 references), Python tuning suite (133 tests, 1 skipped), Stage2P analyzer tests (5/5), and `git diff --check`.

Stage2O evidence remains historical and unmodified. Full CTest, Web Player tests/build, Stage 3, Stage 4, and manual listening are not run under Stage2P unless separately required after the scoped gates.
