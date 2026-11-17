# SuperSynth V9 Level-1 QMC screening

This is offline calibration tooling for Issue #7. It uses the existing preset-owned `concert_grand` config, metadata generator, production SIMD CMake target, matrix renderer, shared pitch estimator, and Salamander metric fixture. It does not add runtime controls or edit tracked preset/config/generated files for a candidate.

The exact six dimensions and their approved bounds/baselines are in `active-search-space.json`. `physical-parameter-registry.json` classifies every Group A–C config field. The candidate overlay maps `effective_strike_position_c4` into both existing string strike endpoints by a common delta computed from the production MIDI interpolation.

Create the isolated Optuna environment:

```sh
python3 -m venv .agent-state/issues/7/calibration-optuna/venv
.agent-state/issues/7/calibration-optuna/venv/bin/python -m pip install -r wasm/plugins/dsp/super-synth/test/tuning/requirements.txt
```

Run the registry and overlay checks:

```sh
rtk node wasm/plugins/dsp/super-synth/test/tuning/physical-parameter-registry.test.cjs
rtk node wasm/plugins/dsp/super-synth/test/tuning/candidate-overlay.test.cjs
```

Run the baseline scratch build, exact 15-cell equivalence check, 64 scrambled Sobol candidates, and per-metric PED-ANOVA:

```sh
.agent-state/issues/7/calibration-optuna/venv/bin/python wasm/plugins/dsp/super-synth/test/tuning/run_level1_qmc.py
```

Candidate sources, generated profiles, builds, matrices, SQLite studies, per-candidate JSON, manifests, and logs are scratch evidence under `build/wasm/calibration/` and `.agent-state/issues/7/`; none belong in Git. The driver reuses completed candidate results and refuses to continue if the source, evaluator, or search-space identity changes during a run.

## Split constrained GPSampler studies

The previous mixed Stage-1/Stage-2 GPSampler study is archived as `READ_ONLY_ARCHIVE`; its trials are never resumed. `run_split_gpsampler.py` writes the complete trial archive to `.agent-state/issues/7/calibration-optuna/gpsampler-split/mixed-study-archive.json` and uses independent fixed schemas:

- Stage 1: `issue-7-grand-v9-stage1-gp-v4-<full-search-space-sha256>` with the ordered Stage-1 hard constraints only.
- Stage 2: `issue-7-grand-v9-stage2-gp-v3-<full-search-space-sha256>` with separate Stage-1 and Stage-2 constraint names. Every candidate renders both stages, including candidates whose Stage-1 acoustics fail.

## Stage-2D velocity-dependent felt hardness

`run_stage2d_velocity_hardness.py` evaluates the private preset-owned
`hammer.velocity_hardness_amount` axis against two provenance-resolved centers. It freshly renders
the five amounts `[0, 0.25, 0.5, 0.75, 1]` at each center through Stage 1, Stage 2, and the existing
Stage-2B direct-reference proxy. The runner can begin its new seven-dimensional GPSampler campaign
only after OAT demonstrates post-attack improvement of at least 2.5 dB, dynamic-span improvement of
at least 2.0 dB, and feasible brightness direction. Its total budget is 25 physical candidates, with
at most 15 GP candidates and a stop after three Stage-2D-feasible candidates.

Run the mapping, overlay, schema, fixed-constraint, and search-space checks before the OAT:

```sh
rtk node wasm/plugins/dsp/super-synth/test/tuning/hammer-velocity-hardness.test.cjs
rtk node wasm/plugins/dsp/super-synth/test/tuning/velocity-hardness-overlay.test.cjs
.agent-state/issues/7/calibration-optuna/venv/bin/python -m unittest discover wasm/plugins/dsp/super-synth/test/tuning/tests
.agent-state/issues/7/calibration-optuna/venv/bin/python wasm/plugins/dsp/super-synth/test/tuning/run_stage2d_velocity_hardness.py --oat-only
```

The rejected velocity-span OAT and provenance remain under `.agent-state/issues/7/`; its production
schema, preset, runtime field, and tuner are not retained. Stage-2D has its own search-space and study
identity and does not import older studies as GP observations.

Run Stage 1 first, then promote its measured candidates into Stage 2:

```sh
.agent-state/issues/7/calibration-optuna/venv/bin/python wasm/plugins/dsp/super-synth/test/tuning/run_split_gpsampler.py --stage 1 --max-new-trials 40
.agent-state/issues/7/calibration-optuna/venv/bin/python wasm/plugins/dsp/super-synth/test/tuning/run_split_gpsampler.py --stage 2 --max-new-trials 40
```

## Stage-3 diagnostic subset and Stage-2B proxy

`build_stage3_diagnostic_subset.py` creates a deterministic diagnostic-only subset from preserved Stage-3 FAIL reports. It includes the union of post-attack shape failures, all 30 direct pitches at the lowest and highest reference layer, and all 16 layers for each pitch with dynamic-span or brightness-direction failures. The JSON manifest records the exact cells and SHA-256; this subset can never declare Stage 3 PASS.

`stage3-direct-reference-metrics.cjs` owns shared direct-reference formulas used by Stage 2B and the ordinary full-range regression. Stage 2B runs existing Stage 1 and Stage 2 evaluators, then measures every cell in the fixed subset with the production-SIMD capture harness. Its GPSampler study has an independent, ordered Stage 1 + Stage 2 + direct-proxy constraint schema. It remeasures the 16 current Stage-2 vectors first; one-at-a-time probes are queued only when needed for the search-space sufficiency decision. The Stage-2B COMPLETE budget is capped at 34.

```sh
rtk python3 wasm/plugins/dsp/super-synth/test/tuning/build_stage3_diagnostic_subset.py \
  --reports .agent-state/issues/7/calibration-optuna/gpsampler-split/stage3/split-v3-s2-0001.stage3.json \
           .agent-state/issues/7/calibration-optuna/gpsampler-split/stage3/split-v3-s2-0015.stage3.json \
           .agent-state/issues/7/calibration-optuna/gpsampler-split/stage3/split-v3-s2-0016.stage3.json \
  --output .agent-state/issues/7/calibration-optuna/stage2b/diagnostic-subset.json
.agent-state/issues/7/calibration-optuna/venv/bin/python \
  wasm/plugins/dsp/super-synth/test/tuning/run_stage2b_gpsampler.py --dry-run
```

Stage 2B PASS remains only a promotion signal. Full 480-cell Stage 3 remains authoritative, and Stage 4 stays locked until a Stage-3 PASS and independent soundboard resolution exist.

Use `--dry-run` to inspect the study/archive plan without rendering. Historical observations enter a live GP only when their source, evaluator, search-space, config, and artifact provenance is complete and compatible. Incompatible observations remain in the archive and are excluded from GP training. Earlier split-study pilots were superseded when the tuner source hash changed and a reused scratch ID correctly refused an identity mismatch; their trials are preserved in `superseded-split-pilot-archive.json`. Final studies use v4/v3 and include the study version in every candidate ID and scratch directory. Stage 2 rerenders the prior Stage-2 PASS parameter vector under the current source as a fresh observation, then adds nine distinct Stage-1-derived seeds. It requires ten distinct measured seed observations before proposing new GP-only candidates.
