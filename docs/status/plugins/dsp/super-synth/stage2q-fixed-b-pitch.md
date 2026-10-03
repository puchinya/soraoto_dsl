# Stage2Q fixed-B pitch re-evaluation

Status: `STAGE2_READY_FOR_STAGE3` — Stage 3 is not run by Stage2Q.

## Identity and scope

- Issue #7 / PR #8 remain the delivery path; Issue #7 remains open at `phase:implementation` and `blocked` pending a separate Stage 3 contract.
- Baseline HEAD: `fa54334c93ddbefc6e7a6202bc4c251ff85f0d16`.
- Acoustic candidate: `stage2n-r3-candidate-01`; Stage2N budget remains 1/1, Stage2L remains 1/12, and Stage2Q candidate delta is 0.
- Candidate production-SIMD WASM SHA-256: `9c2feccda9d956f86187604440752ee08f53e2388eba85d6bed643594ae8aaf2`.
- Stage2Q made no production DSP equation, threshold, public ABI, DSL, or Plugin identity change.

## Estimator revision 4

Below 100 Hz, the estimator gets `B_note` only from the valid unrestricted FULL fit. It then holds that value fixed when fitting FULL, EARLY, and LATE. Window authority uses only these fixed-B fits. Free EARLY/LATE B fits, the Stage2P result, H1/H2, autocorrelation, and the legacy result remain diagnostic. The 8-cent temporal and ±15-cent absolute-pitch limits are unchanged.

Synthetic validation passed: 96/96 known-pitch fixtures, worst absolute error 0.0448 cents, zero octave/partial locks, and deterministic output. The low-register set had 84/84 valid fixtures with worst error 0.0303 cents. The constant-pitch/low-SNR identifiability regression reproduced 4.0284 cents free-fit drift; fixed-B window spread was 0.0785 cents and passed. The independent true-pitch-trajectory fixture remains a physical FAIL. Four >=100-Hz goldens (MIDI 48/60/84/108) remained unchanged.

## Fixed 24-cell matrix

- Result: 24/24 valid; 24/24 finite; 0 invalid measurements; 0 absolute-pitch failures; 0 trajectory failures.
- Note-level B resolved: 24/24.
- Worst fixed-B temporal spread: 6.1766 cents (limit 8 cents).
- Worst absolute final pitch error: 4.4529 cents (limit 15 cents).
- Worst peak: −4.88098 dBFS; total output-guard hits: 0.
- The Stage2P MIDI21/v14 and MIDI24/v14 free-B trajectories are resolved by FULL-derived fixed B; both final classifications are PASS.

## Fresh and baked Stage2E

Both the scratch Stage2E re-evaluation and the baked ordinary production-SIMD re-evaluation completed with all 32 constraints `<= 0`, invalid count 0, and no positive independent constraints. The baked ordinary build's WASM is byte-identical to the fixed candidate SHA above. The exact Stage2N candidate vector was baked into `concert_grand` through `presets.json` and the CMake metadata generator; no parameter was retuned.

Aggregate margins: direct peak −4.88098 dBFS; worst dynamic-span error 7.901563 dB against 8 dB; worst post-attack shape error 9.8809 dB against 10 dB; low-register buzz 0.112456 against 0.12; worst measured pitch 10.6298 cents; held decay ratio 0.703841; finite release true; stuck voices 0.

The detailed 24-cell measurements, diagnostics, full 32-constraint vector, and verification report are stored in the private evidence store and in the authorized Drive report. Raw audio and private paths are not included here.

## Remaining gates

Stage 3 (480 direct cells), Stage 4 (1,408 lifecycle cells and 1,392 adjacent comparisons), full CTest, Web Player tests/build, and manual listening were not run under Stage2Q. Stage2Q makes the candidate eligible for a separate Stage 3 contract; it does not complete Issue #7.
