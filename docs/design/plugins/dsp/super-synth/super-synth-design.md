# SuperSynth V9 design

**Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7)
**Product contract:** [`../../../../specs/plugins/dsp/super-synth/super-synth-spec.md`](../../../../specs/plugins/dsp/super-synth/super-synth-spec.md)
**Review state:** Preset-owned grand-piano physical configuration approved by the user on 2026-09-27 through the supplied Issue #7 contract; implementation pending.

## 1. Scope and decisions

This design covers the evidence-driven calibration of the native concert-grand model. It retains
Plugin ABI 1.0 and the existing Plugin ID. Persisted Plugin configuration is owned by the project DSL
through the shared `PluginConfigurationV1` contract. SuperSynth has no Plugin-owned persistent
snapshot/load state.
The complete current engine family inventory and non-piano renderer ownership are split into
[`super-synth-engine-models-design.md`](super-synth-engine-models-design.md).

The model remains in `wasm/plugins/dsp/super-synth/src/plugin.c`; the Web Player continues to select
`concert_grand` and does not implement DSP. `soft_piano` remains mapped to `piano`. `presets.json`
authors grand physical profiles without adding public construction controls or preset inheritance.
On reload, the Host applies DSL configuration, including preset and public parameters; SuperSynth
resolves the generated profile and rebuilds transient caches and DSP state as required. Runtime
profile selection, `g_grand_config`, voice state, and soundboard state are derived transient state.
The reload flow is: read DSL `PluginConfigurationV1` -> instantiate or reuse the Plugin -> apply the
factory preset, public parameters, and profile selection -> rebuild transient profile caches and DSP
state as required. Plugin-owned persistent snapshot/load is none.

## 2. Metadata ownership and generation path

Keep each field at its existing source of truth:

| Data | Owner / responsibility |
|---|---|
| Plugin parameter schema and engine-model enum | `interface.soraoto` |
| Factory preset authoring and complete grand physical profiles | `presets.json` |
| Plugin identity and capabilities | `descriptor.json` |
| Strict profile validation and generated grand profile table | `wasm/cmake/super_synth_metadata.py` |
| Generic metadata generation | `wasm/cmake/generate_plugin_metadata.py` |
| Generated immutable profiles, preset-ID mapping, and default profile | `wasm/shared/generated/super-synth_grand_profiles.h` |
| Active fixed-size physical config and real-time DSP | `wasm/plugins/dsp/super-synth/src/plugin.c` |
| Runtime descriptor/interface truth | Embedded `soraoto.plugin.v1` and byte-identical source `soraoto.interface` |

Update derived metadata through the established generators. Keep generated artifacts under
`build/wasm/`; do not hand-edit generated output or commit generated binaries. Retain the plugin ID
`net.puchinya.soraotodsl.super-synth-v8`, set the descriptor name to `SuperSynth v9` and version to
`9.0.0`, and keep `compatible_plugin_ids` empty. Update the existing source and generated metadata
regression expectations together so source, embedded descriptor, and interface cannot drift.

Keep public parameter IDs/paths/types/ranges, enum values, preset identities/order, Plugin ABI 1.0,
and DSL/preset version numbers unchanged. Follow the existing shared DSL/ABI contract for persistence
and preset application; Stage2N makes no shared ABI changes. Regenerate metadata derived from the
plugin version, including `soraoto.preset_version`.

## 3. Runtime and real-time boundaries

`engine_model` values dispatch to the existing runtime paths; numeric order follows
`EngineModel` in `interface.soraoto`:

| Value | Model | Runtime path |
|---:|---|---|
| 0 | `wavetable` | Generic wavetable renderer |
| 1 | `pluck` | Prepared waveguide string renderer |
| 2 | `piano` | Modal struck-piano renderer |
| 3 | `tine` | Tine/pickup resonator renderer |
| 4 | `bowed` | `bowed_string_v7` |
| 5 | `flute` | `flute_v7` |
| 6 | `reed` | `reed_v7` |
| 7 | `brass` | `brass_v7` |
| 8 | `vocal` | `vocal_v7` |
| 9 | `concert_grand` | V9 traveling-wave strings and shared soundboard path |

The companion engine-model design records each source family and its current state ownership. This
V9 work documents all ten families, while DSP tuning remains limited to engine 9.

Keep the acoustic-piano implementation in the existing native `concert_grand` engine path. Reuse
the current per-voice string/contact state and shared soundboard state. Preserve the established
allocation-free processing path and existing reset, voice initialization/retarget, note release,
pedal, and voice-stealing behavior. Do not introduce a second piano implementation in Web Player
JavaScript.

`presets.json` is the sole authored source for every sound-affecting grand-piano coefficient and
table. Each factory preset whose `engine_model` is `concert_grand` has a complete independent
`grand_piano_v1` revision-3 `engine_config`; it cannot inherit from another preset or rely on C
defaults for missing fields. The generator rejects missing, unknown, malformed, non-finite,
wrong-length, and out-of-range fields, then emits immutable profiles plus stable preset-ID mapping
and default-profile identity. DSP reads one statically allocated `g_grand_config`; the generated
profile layout may contain fixed arrays but no runtime allocation or JSON parsing.

Factory preset and `LOAD_PROGRAM` apply public values, resolve/copy the generated profile, rebuild
config-dependent caches, and clear incompatible transient grand physical/resonant state when profile
identity changes. A non-grand preset selects the default `concert_grand` profile for deterministic
later manual engine changes. Public piano controls remain high-level modifiers over the active
baseline. The Host reapplies DSL `PluginConfigurationV1` on reload; no separate SuperSynth persistence
or migration layer exists.

Use `soundboard_mix=0` as a diagnostic bypass of the additive left/right board-radiation output. It
does not mute dry transverse, bridge, or contact output, and it does not stop board state or
bridge/body feedback. Verify bypass by measuring raw pre-radiation and applied board-radiation
signals directly; total output RMS may rise or fall as board radiation is added because dry and board
signals can reinforce or cancel. Test non-zero mix effectiveness independently from the zero-mix
bypass. Calibrate the model's gain and spectral shape at the source stages; do not compensate for a
flawed model with a master gain adjustment.

## 4. Calibration inputs and measurements

Use only the official Salamander Grand Piano V3 SFZ+FLAC package as the real-piano reference. The
source is a 48 kHz / 24-bit Yamaha C5 recording by Alexander Holm, published by FreePats under CC BY
3.0. The exact source identity, license, and velocity boundaries are normative in the
[product specification](../../../../specs/plugins/dsp/super-synth/super-synth-spec.md#6-real-piano-calibration-requirements).
The analysis utility accepts `--reference-dir <package-root>`, where the supplied directory contains
`SalamanderGrandPiano-V3+20200602.sfz` and its relative `samples/` directory. It uses the
repository's existing Node infrastructure, adds no dependency, and runs offline without Google
Drive API access. The user can extract the package from the Google Drive for Desktop mirror and pass
the inner package directory at runtime; no personal path is stored in code or configuration. The
analyzer parses the actual SFZ/Data source rather than guessing sample paths from a naming convention.

Coverage:

| Purpose | Coverage |
|---|---|
| Direct source matrix | 30 minor-third pitch centers × 16 exact SFZ velocity layers = **480 cells** |
| Full-range SuperSynth sweep | MIDI 21–108 (A0–C8), all 16 representative layer velocities = **1,408 renders** |
| Adjacent-key continuity | Every pair from 21↔22 through 107↔108, all 16 layers = **1,392 comparisons** |
| Direct/interpolated comparison | Compare source-derived metrics at all 30 centers; interpolate metrics only for the 58 non-center keys |

For each layer, choose the representative MIDI velocity as `round((lovel + hivel) / 2)` from the
parsed SFZ range. The resulting values are `14, 31, 36, 40, 45, 49, 54, 61, 69, 77, 85, 93, 101,
109, 117, 124`, converted to normalized plugin velocity by dividing by 127. Do not collapse the
layers to p/m/f or substitute an even 16-way split.

At each direct pitch center, compare each layer with metrics from the corresponding source samples.
At non-center keys, interpolate the numeric metrics between neighboring centers at the same layer;
at the lowest and highest keyboard edges use one-sided reference behavior. Never interpolate
waveforms or describe a pitch-shifted sample as an original recording.

The analysis utility emits only derived numeric metrics and provenance suitable for a committed
fixture. It parses the actual SFZ/Data source and runs offline without Google Drive access. Do not
place Drive identifiers, URLs, credentials, private local paths, or raw audio in the repository.

Record harmonic ratios h2/h1 through h5/h1, spectral centroid, energy above 2 kHz, attack and early
brightness, inharmonic spectral spread, RMS/energy and peak progression, hammer/felt transient
response, attack and decay behavior, stereo width/localization, and release/damper response. Remove
DC, align note onset, and compare equivalent analysis windows. Normalize only shape-specific spectral
windows; preserve unnormalized velocity-dependent level, energy, and peak measurements.

The AB capture describes the reference microphone image, while the physical model renders a
playable output image. Use stereo width/localization as broad derived targets and regression signals;
do not force sample-level or microphone-room identity. Apply broad physically meaningful tolerances
and expose every key/layer result so an aggregate score cannot hide a local regression. Derived
metrics include source attribution, license, analysis version, source format, pitch centers, velocity
ranges, analysis windows, and the verified source-archive SHA-256. Do not put Drive IDs/URLs,
credentials, account identifiers, private paths, or audio bytes in the repository.

## 5. Tuning sequence

Tune in this order and retain before/after measurements at every stage:

1. Hammer/felt response.
2. Velocity-dependent hammer hardness.
3. Hammer noise and attack.
4. String harmonics.
5. Dispersion and inharmonicity.
6. Damping and decay.
7. Unison behavior.
8. Bridge response.
9. Soundboard response.
10. Low-register mode suppression.
11. Release/damper response.
12. Sustain and sostenuto response.
13. Stereo radiation.
14. `concert_grand` preset defaults, only after physical-model calibration.
15. Output gain last.

### 5.1 Current residual-failure order

Do not begin acoustic coefficient changes during presetization. First copy the baseline
`6f4ab32bf20f9267eeb368aa4d7809e0fe846329` values into `engine_config`, generate the runtime profile,
and prove migration equivalence at the contract's keys, velocities, and sustain states. Only after
that gate passes, use the following fixed residual-failure sequence; every tuned value is then changed
in `presets.json` and regenerated.

The user fixed the following order for resolving the remaining physical-model failures:

1. Re-measure pitch for both Salamander and SuperSynth with an expected-f0-constrained harmonic-comb estimator. Only change string delay length, fractional delay, or dispersion if the revised measurements still exceed the normative pitch tolerance.
2. Separate hammer force from board radiation. Hold `engine_config.hammer.force_scale` at 300 if the velocity-brightness result remains better, and sweep only `engine_config.soundboard.radiation_scale` with the ordinary 480-cell renderer. Target a maximum peak near −3 dBFS and zero output-guard hits. Do not use master gain before the board scale is fixed.
3. Measure C4 H3–H5 over 0–30 ms, 30–80 ms, and 80–200 ms. If only the attack is weak, tune contact duration, felt hardness, strike position, or the force-linked transient. If the later windows remain weak, inspect string propagation, bridge termination, dispersion, and board transfer. Keep `contact_transient` limited to attack support; add no dedicated harmonic correction terms.
4. Measure note-held decay separately from post-note-off release tail. Attribute the first to string/bridge loss and modal Q, and the second to damper, board feedback, and sympathetic decay. The already-maximum preset controls cannot be used for further compensation.
5. In a `soundboard_mix=0` bypass, remove board radiation only. Longitudinal modes radiate through bridge/body drive; the direct dry longitudinal path is disabled by the fixed architecture value `engine_config.radiation.dry_longitudinal_gain = 0.0`. Do not tune this field or weaken the bypass test to compensate for its removal.
6. Re-fit key-position to radiation-position mapping from Salamander for `engine_config.soundboard.zone_pan` and the generated excitation-pan values. Do not raise preset stereo width.

Do not adjust hammer force and board radiation scale in the same sweep. Any coefficient change invalidates the affected 480-cell, lifecycle, and acoustic evidence.

#### Velocity-dependent felt hardness

The private `concert_grand.engine_config.hammer.velocity_hardness_amount` is the single calibration
axis for changing felt hardness with note velocity. It is preset-owned and constrained to `[0,1]`.
Revision 3 uses the historical piecewise mapping with `pivot = 61/127`. Let `h` be clamped base
hardness, `v` clamped normalized velocity, and `a` the profile amount in `[0,1]`. If `a == 0`, return
`h`; if `v <= pivot`, return `h * (1 - a * ((pivot - v) / pivot))`; otherwise return
`h + (1 - h) * a * ((v - pivot) / (1 - pivot))`. This is continuous at the pivot and remains in
`[0,1]`. Use the result for felt exponent, stiffness, passive contact loss, hammer mass, and the
hardness factor in initial hammer velocity. Keep the initial launch intercept/slope fixed at
`0.42 / 1.05`. Hammer-noise scaling remains based on base hardness. Do not tune hammer force,
compression endpoints, contact endpoints, or output gain to emulate velocity-dependent felt behavior.

### 5.3 Stage2L revision-2 string-loss and velocity-response model carried by Stage2N revision 3

Stage2L introduced the internal revision-2 `grand_piano_v1` model; Stage2N carries its N/V equations
forward in revision 3 while restoring the historical H mapping. These are internal profile revisions,
not public Plugin or product versions. Keep Plugin ABI 1.0, Plugin ID, public parameter catalog/ranges,
preset identities, and DSL behavior unchanged. The strict preset-owned schema adds
`string.decay_reference_midi = 60.0` and removes
`string.reference_loss_velocity_base` / `string.reference_loss_velocity_scale`. At MIDI 61/127 pivot
velocity, set `string.reference_loss_base = 0.0019965984251968504`; preserve the existing register
start/width (`0.68 / 0.45`) and agraffe/bridge reference-loss multipliers.

Passive reference loss is velocity-independent:

```text
reference_loss = reference_loss_base * register_gate
cycle_exponent = 2 ^ ((decay_reference_midi - prepared_pitch) / 12)
time_normalized_gain = clamped_passive_gain ^ cycle_exponent
```

`clamped_passive_gain` is the scalar agraffe or bridge gain after its existing passive formula and
existing `[passive_min, passive_max]` clamp. At MIDI 60 the normalized gain equals the existing gain;
above MIDI 60 it moves toward 1; below MIDI 60 it decreases. Every result remains within `[0,1]`.
Do not time-normalize low-pass/HF filters, dispersion, bridge impedance, soundboard, or radiation.

The per-voice cache stores the prepared string pitch, agraffe held gain, bridge held gain, and bridge
released gain. Refresh it in `prepare_grand_strings(q, pitch)` and when
`P_PIANO_STRING_DAMPING` changes for active concert-grand voices. Use the pitch used for delay-line
geometry; do not follow glide/LFO/drift pitch. `grand_strings_step` selects the held or released cached
bridge gain without logarithm/exponential work. Refreshing a cache does not clear string or body state.
No allocation is permitted in `dsp_process`, and scalar/SIMD topology remains the same.

Implement the power operation without libc/libm using a bounded near-unity log/exp polynomial helper.
Call it only while preparing or refreshing a per-voice cache. The helper must be checked against host
`pow` over gains `[0.93, 0.9998]`, MIDI 21–108, and reference MIDI 60 with maximum absolute error
`<= 5e-5`.

### 5.4 Stage2L model-revision search and promotion

The old Stage2F/J candidate budget remains frozen at 25/25. Stage2L creates an independent revision-2
budget of at most 12 acoustic candidate identities. Candidate 1 deterministically ports Stage2K's
semantic vector, excluding `termination_loss_floor_scale`. Candidates 2–12 may use sequential
`GPSampler(seed=7)` evaluations in one job, searching only the seven approved semantic dimensions:
strike position `[0.13,0.17]`, compression `[0.0005,0.002]`, base hammer hardness `[0,1]`,
inharmonicity `[0,1]`, string damping `[0,1]`, string unison `[0.4,1]`, and velocity hardness amount
`[0,1]`. Do not include soundboard/radiation values, termination-loss coefficients, or other
low-level architecture parameters.

Before spending candidate 2 or later, candidate 1 must improve both C8 post-attack violation from
`+2.101440 dB` and MIDI 45 span violation from `+3.528952 dB`, and introduce no positive independent
safety constraint. Otherwise stop with `BLOCKED_STAGE2L_MODEL_DIRECTION`. Stop immediately on the
first candidate with all 32 current Stage2E constraints `<= 0`. A feasible revision-2 candidate may be
baked only through the authoritative preset/generator path, then Stage 1, Stage 2, Stage2B, and
held/release must be rerun on the ordinary production artifact. Stage 3 and Stage 4 remain out of scope.

Within one material calibration stage, individual scalar or grid candidate trials may use the C4
regression and the 24-cell sentinel matrix to reject failures before running the full direct-reference
matrix. After selecting a candidate for that material stage, rerun all 480 direct-reference cells
before proceeding to the next material stage. The final candidate must pass all 1,408 full-range
lifecycle renders and all 1,392 adjacent-key/layer comparisons. Run that final evidence again whenever
a change can plausibly affect global pitch, output safety, or lifecycle behavior. Do not accept a
better global average if it creates a severe individual key/layer failure. Velocity response must
evolve in level and contact/brightness, with plausible harmonics, transient and decay behavior,
 stable high notes, controlled bass, and finite release. Preserve existing plugin safety,
voice-stealing, and pedal regressions.

### 5.5 Stage2N revision-3 production gate

Stage2N is a one-candidate production model gate, independent of the frozen Stage2L revision-2
budget. Revision 3 reproduces Stage2M mask `011`: preserve N/time-normalized scalar passive loss and
V/velocity-independent passive reference loss from revision 2, and use the exact historical
piecewise hardness mapping in §5.1. The profile kind remains `grand_piano_v1`; the authored
`engine_config.revision` and generated `GRAND_PROFILE_REVISION` are both 3.

For N, retain `cycleExponent = 2^((decay_reference_midi - prepared_pitch) / 12)` and
`normalizedGain = clampedScalarGain ^ cycleExponent`, with `decay_reference_midi = 60.0`. Preserve
the prepared-pitch cache and refresh it on string preparation and string-damping changes; do not add
power/log work to the per-sample string loop. For V, retain
`reference_loss = reference_loss_base * register_gate` and the existing base/register parameters
`0.0019965984251968504 / 0.68 / 0.45`.

The single Stage2N semantic candidate is `stage2n-r3-candidate-01`, using exactly Stage2L candidate
1's parameter vector. First reproduce the fixed 18-cell Stage2M `011` subset from the revision-3
candidate artifact within existing serialization/evaluator tolerances. Only after equivalence passes,
run one complete Stage2E evaluation covering Stage 1, Stage 2, direct-reference proxy, held/release,
and the fixed ordered 32 constraints. This does not extend or decrement Stage2L's 1/12 budget. Do not
run GPSampler, change thresholds or the pitch estimator, or run Stage 3/4 under this gate. A fully
feasible baked ordinary production artifact may be declared ready for a separate Stage 3 contract;
Stage 3 remains locked here.

### 5.2 Absolute pitch measurement

For `concert_grand`, absolute pitch is measured against the equal-tempered frequency of the
rendered MIDI note. The hard limit is inclusive ±15 cents. Stage 2's 24-cell sentinel matrix and
Stage 4's full-range lifecycle evaluator use the same test-only, expected-f0-centered,
inharmonicity-aware multi-partial estimator as their sole pitch authority. For each analysis window,
the estimator searches expected MIDI f0 ±100 cents and the existing approved inharmonicity range,
tracks local partial peaks, and robustly fits `f_n = n*f0*sqrt(1+B*n^2)`. The estimator uses at
least two independent stable windows; it reports per-partial inferred f0, fit residual, uncertainty,
window spread, and local peak evidence. A search-boundary result is invalid.

For expected fundamentals from 100 Hz upward, retain the existing estimator selection, analysis
windows, validity gates, and result behavior. In particular, below 1 kHz a stable measurement
requires two coherent usable partials shared across both windows; from 1–3 kHz, two locally
unambiguous partials may establish a valid measurement; above 3 kHz, use the expected-f0 local
fundamental and available supporting partials. A valid measured pitch movement beyond the approved
window-spread limit remains a physical pitch-instability `FAIL`, and a confident result outside
±15 cents remains a pitch `FAIL`.

For expected fundamentals below 100 Hz, estimator revision 4 measures the stiff-string model's base
`f0`, not raw H1. The capture plan exposes three exact Hann windows beginning 20 ms after onset:
FULL uses 65,536 samples, EARLY uses the first 32,768, and LATE uses the following 32,768. The
capture must include the FULL end plus its block-alignment margin. First, estimate note-level `B`
exactly once from the unrestricted FULL-window inharmonic-comb fit. That FULL fit must pass every
existing validity gate and produce finite `B` in [0, 0.02]; otherwise return
`MEASUREMENT_INVALID` with `note-level-inharmonicity-unresolved`, without fallback. Then hold this
`B_note` fixed and independently refit base `f0` in FULL, EARLY, and LATE. The fixed-B fitter uses the
same partial extraction, cents grid (−100…+100 by 4, then best ±4 by 0.25, then best ±0.25 by 0.05),
local-peak evidence, robust inlier rejection, and existing partial-spread, residual, uncertainty, and
search-boundary gates. Per-window free-B estimates remain diagnostic-only; they never determine
temporal pitch classification.

The low-register measurement requires at least two individually valid fixed-B window fits. When all valid
window estimates span no more than 8 cents, the measurement is valid and its pitch is the median of
those estimates; apply the unchanged inclusive ±15-cent limit. Exactly two valid windows separated by
more than 8 cents produce `MEASUREMENT_INVALID`. If all three windows are individually valid but
their total spread exceeds 8 cents, report a valid physical `FAIL` with reason
`analysis-window-pitch-instability` and use the fixed-B estimate with the greatest absolute cents
error. Fewer than two valid fixed-B fits are `MEASUREMENT_INVALID`; do not fall back to expected pitch
or another estimator. The Stage2P free-B temporal classification remains diagnostic evidence only.

The Stage2O H1/H2 inversion, including its `B_A` and `f0_A` diagnostics, is retained as diagnostic-only:
weak H1 or an invalid two-partial inversion cannot invalidate or classify a multi-window comb result.
Expected-lag autocorrelation is also diagnostic-only below 100 Hz. Neither source can create a PASS,
FAIL, or rescue an invalid comb result. Record all per-window fit diagnostics, cross-window spread and
cluster, Stage2O source diagnostics, autocorrelation, revision-2 result, and the original short-window
legacy result. Select this rule by expected frequency, never by MIDI note number.

Stage 2 and Stage 4 must not use different estimators or shift the synth result by a Salamander
source offset.

For expected fundamentals at or above 100 Hz, all existing estimator selection and validity behavior
remains unchanged; autocorrelation, the single-peak `fundamentalHz` estimate, and the Salamander
source pitch offset remain diagnostics only. Below 100 Hz, autocorrelation is diagnostic only.
For all registers, best-to-competitor score ratio is diagnostic and is not the sole confidence gate;
the synth result is never shifted by a Salamander source offset. Do not proceed to Stage 3 while
Stage 2 has no passing candidate; report failing cells and metrics before making any new physical-model
change.

The soundboard-control regression is an independent acceptance blocker. Keep the control and
bypass checks substantive; do not lower their limits to conceal an ineffective radiation path. A
zero-mix bypass gate measures applied board radiation itself, not the total piano output RMS; retain
the dry output and mechanical feedback paths at zero mix.
Diagnose dry/board interaction using same-state polarity renders, energy identity, covariance,
correlation, and bounded lag analysis before changing the radiation path or scale. Measure low-
register buzz at `soundboard_mix=0`, the preset default, and `1`; a buzz above its existing limit at
zero mix belongs to a non-radiation source and cannot be compensated by increasing board scale.

The full-range evaluator uses one shared gain offset: the median source-minus-rendered level across
the 480 direct cells in the 80–200 ms window. This preserves register and velocity relationships.
Hard limits are ±20 dB for direct-cell level, centroid ratio 8, absolute >2 kHz ratio delta 1.0, and
10 dB for post-attack envelope-shape error (30–350 ms). Centroid is a gate only when either compared
render has at least 0.1% of total power above 2 kHz; below that floor, centroid remains visible as a
diagnostic because near-zero high-frequency energy can dominate a magnitude-weighted centroid.
Every rendered cell must stay between
−90 dBFS and strictly below 0 dBFS peak. Adjacent pairs are limited to 10 dB level jump, centroid ratio 4.5,
0.5 absolute >2 kHz ratio delta, 8 dB late-decay-shape jump, and 0.3 stereo-pan change. Across
velocity layers, no adjacent representative may fall by more than 1 dB, every key must span at least
6 dB, and at least 75% of keys must brighten by centroid or >2 kHz energy. These broad gates are
paired with per-cell diagnostics; they do not use a global score to conceal outliers.

The evaluator records onset timing and early-attack shape, all five envelope windows, h2/h1 through
h6/h1, inharmonicity, spectral spread, stereo width/pan, and peak for each cell. Stereo width and
harmonic-ratio factors are diagnostics rather than hard gates: the reference is a two-microphone AB
recording, and near-zero partial ratios are numerically unstable. `full-range-cells.csv`,
`adjacent-continuity.csv`, and `velocity-progression.csv` keep every evaluated row visible beside the
summary distributions.

### Stage3B string-bundle contact attribution

Stage3B is a bounded diagnostic factorial over the existing Stage2N candidate. It does not select production coefficients or change the production model. The diagnostic CMake option `SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS` defaults OFF and requires both guard and Stage2M diagnostics. A build with the option OFF retains the production semantics and must remain byte-identical to the approved production artifact.

The Stage3B variant mask is test-only: bit 1 normalizes the active characteristic impedances to a sum of one while preserving their ratios, and bit 2 applies lane-0 frequency and strike geometry coherently to all active unison strings while preserving separate delay-line state. Mask 0 is the current model; masks 1, 2, and 3 isolate each factor and their combination. Stage2M factor mask stays at 3. A mask change resets DSP state. Neither factor is approved production architecture.

Use the persisted Stage3A mask-0 measurements as the factorial baseline; do not rerender them. Attribute each measured scalar with the two-factor main-effect and interaction equations, and report the two-string and three-string groups separately. Safety failures disqualify the affected factor. Stage3B may recommend a separate design phase, but it must not implement a selected factor in production.

Before any Stage3B acoustic render, reconcile the fixed production WASM provenance against the embedded descriptor and interface sections. Prefer a byte-identical isolated rebuild; if that is unavailable, require exact descriptor-CBOR attribution to one isolated metadata variant, matching runtime metadata fingerprint and profile identity, unchanged production inputs, and an unchanged user working-tree descriptor. Keep the detailed provenance artifact under `.agent-state/issues/7/stage3b/`. Passing this preflight authorizes only a separately reviewed mask-0 equivalence gate; it does not authorize the 477-cell Stage3B matrix.

Stage3B acoustic execution is locked by the single authoritative result artifact `.agent-state/issues/7/stage3b/mask0-equivalence.json`. The old `mask0-equivalence-authorization.json` path never grants execution. Before `--execute`, `--finalize`, or direct production finalization inspects acoustic state, the runner validates current preflight provenance, production/diagnostic build identity, accepted Stage3A ledger/final/supplement hashes, the exact preflight-provenance SHA, and the complete mask-0 result schema. The required decision is `STAGE3B_MASK0_EQUIVALENCE_COMPLETE`; the result must report finite output, zero guard hits, exact tolerance `0.000001`, maximum metric difference at or below that value, a non-negative integer render count, production candidate delta 0, and Stage4 renders 0. The accepted provenance classification is copied from current preflight and must be `EXACT_REBUILD_PROVENANCE` or `SUFFICIENT_METADATA_PROVENANCE`.

The runner hashes the exact result-file bytes and binds both that SHA-256 and the current preflight-provenance SHA-256 into any newly created acoustic ledger. Every resume and finalization must present the same binding. Before each new acoustic cell is marked `IN_PROGRESS`, the result, provenance, and build identity are revalidated; an evidence change blocks without rebasing the ledger. Preflight and dry-run remain zero-acoustic-render checks. Programmatic tests must inject both identity and authorization binding explicitly; the CLI exposes no bypass. No real mask-0 result is created by the lock correction.

Before the 477 factor-attribution cells, a separate mask-0 equivalence gate renders only the six Stage3A equivalence coordinates: MIDI 36/velocity 14 and 124, MIDI 51/velocity 14 and 124, and MIDI 96/velocity 31 and 124. Each render uses Stage2M mask 3 and Stage3B mask 0. It is compared both to the saved production Stage3 row and the accepted Stage3A diagnostic row. Production fields, hammer and soundboard diagnostics must match within absolute `1e-6`; categorical fields, masks, arrays, and frame counts must match exactly. Every render must be finite, have zero output-guard hits, and remain below 0 dBFS for both measured and full-render peaks. Only a six-cell pass may create the authoritative `mask0-equivalence.json` result; masks 1/2/3 remain locked until a separate contract.

Apply Stage3B selection gates to each factor independently. The six-decibel worst-pitch requirement is evaluated at the Stage3A M0 failing pitch with the greatest absolute span error (currently MIDI 51). The MIDI96/v31 level guard uses each factor's factorial main effect. The MIDI41 derivative and safety checks use the relevant factor masks only: I uses masks 1 and 3; P uses masks 2 and 3. When both factor families are safe, architecture selection also requires the stated interaction, subgroup-direction, and comparative-improvement checks; when one family is unsafe, it does not automatically disqualify the other.

## 6. Failure and blocker handling

If the official Salamander package cannot be retrieved, its contents are incomplete, or its SFZ
structure does not match the pinned reference, mark calibration `BLOCKED`, record the exact missing
evidence in Issue #7 and the status mirror, and stop reference-dependent tuning. The private Drive
copy and source archive hash must be verified before calibration. Preserve existing unrelated Drive
content; remove old directories only when their task-created provenance is confirmed. Do not use
another piano source or prior SuperSynth render to fill a gap.

If measured targets conflict with Plugin ABI, compatibility, or existing normative behavior, stop and
return to requirements/design. Do not resolve such conflicts by changing public interfaces or
silently substituting a different identity.

## 7. Verification map

| Risk / acceptance area | Evidence |
|---|---|
| Identity and metadata drift | Identity regression; compare authoring files, generated metadata, and embedded descriptors |
| Profile schema and generated data | Positive/negative profile validation fixtures; two generation runs compare descriptor and grand-profile header byte-for-byte |
| Preset/program/profile selection | Runtime checks for shared factory/program path, profile-switch clearing/cache rebuild, non-grand default, DSL preset-ID roundtrip, and rejection of incomplete/unknown profiles |
| Migration behavior | Baseline comparison across eight pitches, three velocities, sustain off/on with the contract's lifecycle, peak, envelope, pitch, and spectral deltas |
| DSP reference fit | Numeric derived-metric fixture for all 480 direct-reference cells; no raw audio or private Drive data; broad thresholds grounded in the source and measurement windows |
| Full-range piano behavior | 1,408 renders over MIDI 21–108 and 1,392 adjacent-key/layer continuity comparisons; per-cell failures remain visible |
| Plugin regressions | Existing concert-grand, safety, voice-steal, click, calibration, realism, and pedal coverage; full CTest suite |
| Web Player compatibility | Existing plugin-interface and publication-audit tests; Web Player test suite and production build |
| Scope and artifact hygiene | Self-review against the contract; `git diff --check`; confirm no raw audio, generated binaries, archives, duplicate runtime headers, or generated build output is tracked |

Run the repository's documented WASM/CTest and Web Player test/build entry points from
[`../../../../../web-player/README.md`](../../../../../web-player/README.md) and `wasm/CMakeLists.txt`;
record exact commands and PASS/FAIL/NOT RUN/BLOCKED results in the Issue and status mirror. These
checks do not substitute for direct audio comparison or browser-interaction evidence.

## 8. Physical-model and WASM SIMD delta

The approved physical-model, preset-ownership, and ephemeral-Project architecture is preserved in
`.agent-state/issues/7/implementation-contract-physical-model-simd-cpu.txt`,
`.agent-state/issues/7/implementation-contract-preset-physical-config.txt`, and
`.agent-state/issues/7/delta-implementation-contract-ephemeral-project.txt`. It changes the native
`concert_grand` tuning ownership and runtime preset/configuration path, without changing the physical topology.
The signal path is:

```text
dynamic hammer mass and nonlinear felt
  -> energy-consistent hammer scattering
  -> one, two, or three traveling-wave strings
  -> one shared bridge scattering solve
  <-> passive sympathetic-string register
  <-> stable fitted soundboard/radiation model
  -> stereo radiation

transverse low-register energy -> nonlinear longitudinal modes -> bridge/body radiation
```

### 8.1 Compatibility and runtime ownership

Keep Plugin ABI 1.0 and Plugin ID `net.puchinya.soraotodsl.super-synth-v8`. Keep the existing public
control catalog and factory-preset identities unless implementation evidence requires a reviewed
change. Store active preset selection only in the project DSL; do not serialize plugin-owned state.
Add no construction parameters and no allocation or dynamic containers in `dsp_process()`. Keep per-note
string, hammer, and longitudinal state in fixed-size `Voice` records; own the sympathetic and board
state once in shared grand state. A profile switch clears incompatible grand resonant state and
rebuilds dependent caches.

Reuse existing controls as high-level modifiers over the selected profile: hammer hardness controls
felt response; hammer noise controls contact-gated noise; string damping controls passive loss; unison
controls detuning/coupling; inharmonicity modifies transverse dispersion and calibrated coupling;
board size scales fitted modal frequencies; board mix remains a true radiation bypass; sympathetic
amount controls passive-register coupling/return; stereo width remains the final keyboard radiation
control. Internal construction/tuning coefficients live only in the selected profile.

### 8.2 Waveguide, hammer, and shared bridge

Treat delay-line values in the grand-piano path as normalized transverse velocity waves. This is an
internal normalization, not an SI-calibrated displacement claim. Every characteristic impedance is
positive, passive termination/scattering is non-energy-creating, and force exchange at the hammer is
equal and opposite.

Replace the prescribed `hammer_path`/`micro_gate` drive with per-voice dynamic mass, compression,
force, previous force, and contact state. Felt compression and force remain non-negative. The felt
force is nonlinear with exponent 2–4 and a passive contact-loss term; hardness maps monotonically to
stiffness, exponent, and contact loss. Update contact from current string velocity, integrate hammer
velocity with a semi-implicit/symplectic or wave-digital step, inject the resulting force, and latch
contact off when separating compression reaches zero. Do not retrigger that strike. Hammer noise is
a contact-duration/force-gated transient and never a free waveguide-force source.

For N active strings with positive impedances `Z_i`, sum `Z_sum = Σ Z_i` and distribute the common
force-generated junction velocity increment `delta_v = F_hammer / (2 * Z_sum)`. Remove soft clipping
from normal hammer-point propagation. Any retained numerical guard is an emergency-only path and
must have zero hits in all required calibration renders.

Keep the current one/two/three-string register and detuning. Gather every string's bridge-arrival
wave before updating any string. Solve the same-sample shared junction:

```text
v_bridge = (2 * Σ(Z_i * a_i) + Z_b * v_board) / (Σ Z_i + Z_b)
b_i       = v_bridge - a_i
F_bridge  = Z_b * (v_bridge - v_board)
```

`Z_b` is positive. Apply only approved passive bridge-loss filtering to each reflected wave. Gather,
solve, filter, write all string values, then advance delay positions; no string may observe another
string's partially updated same-sample state.

### 8.3 Fitted soundboard and radiation

Replace hand-authored `basef[]`, `weight[]`, `wet`, and register-boost tuning with a deterministic,
reference-derived stable modal model of the existing computational class: 24 modal sections, three
bridge zones, and a broadband residual path. More than 24 modes requires design re-approval. The
identification target is an effective bridge-to-radiation/admittance proxy constrained to passivity
and BIBO stability. Salamander is a microphone recording, not a bridge-force/velocity experiment;
the model must not claim true mechanical bridge admittance.

The deterministic fitter consumes committed derived Salamander metrics and captures from the same
final hammer/string/longitudinal/sympathetic model with soundboard radiation bypassed. It emits
`test/reference/salamander-grand-piano-v3-board-fit.json` and
`src/grand_physics_fit_v9.h`, with archive SHA, metric schema, fitter version, and dry-capture model
identity. A regular test compares their coefficients. Positive frequencies/Q, finite gains, bounded
zone coupling, and nonnegative dissipative/radiation gains are required. `piano_soundboard_size`
smoothly scales fitted frequencies without changing mode count or adding unrelated EQ. A zero board
mix bypasses board-radiated longitudinal and sympathetic output as well as direct board output.

### 8.4 Sympathetic strings and longitudinal modes

Own one shared 88-key × 2-mode passive register, never one copy per voice. Excite each key from its
appropriate shared bridge zone. Return its force with at least one sample/state delay so no
zero-delay feedback loop exists. Derive undamped keys from existing held-note state, sustain, and
`sostenuto_latched`: sustain lifts all dampers, sostenuto lifts only latched keys, ordinary held keys
lift their own dampers, and other resonators receive heavy damping. `piano_sympathetic=0` bypasses
both passive-register return and board-to-string sympathetic feedback. Use fixed group masks to skip
the 44 SIMD groups when disabled or idle, and skip inactive four-key groups when sparse.

Add two nonlinear longitudinal resonators per active voice. Their excitation is zero-mean and
derived from transverse velocity/bridge-force energy, such as AC-coupled squared energy; it is not a
separate MIDI-triggered oscillator. They are full strength through MIDI 45, fade smoothly over MIDI
45–57, and are absent at and above MIDI 57. Frequencies, gains, and Q values come from Salamander-
derived low-register non-harmonic resonance analysis, are interpolated between reference centers,
and radiate through the bridge/body path rather than a large dry oscillator. The preset-owned
`radiation.dry_longitudinal_gain` is fixed at exactly `0.0`: this disables only direct dry
longitudinal output. The resonators and their bridge/body drive remain active. Schema validation
rejects any nonzero value, and the field is excluded from QMC, PED-ANOVA, and Optuna.

### 8.5 SIMD layout, caches, and CPU behavior

Production uses standard Wasm `simd128` only. Keep `-O3 -msimd128 -fvectorize -fslp-vectorize`
explicit for SuperSynth. Add an OFF-by-default vectorizer-diagnostics option. Do not enable relaxed
SIMD, threads/shared memory, memory64, fp16, or global fast-math. Gate explicit grand kernels with
`__wasm_simd128__ && !SORAOTO_FORCE_SCALAR_GRAND`; the forced-scalar build exists only for local
reference tests and benchmarks and is not shipped.

Use aligned structure-of-arrays/four-lane state and cached modal coefficients. The soundboard runs
24 modes as six `f32x4` groups. The passive register runs 176 resonators as 44 groups when active,
with lane masks instead of 176 individual branches. Pack one/two/three gathered bridge strings into
lanes 0–2 and use lane 3 as zero; SIMD accelerates arithmetic after scalar delay addressing, without
adding a fourth physical string. Preserve a scalar reference for each explicit kernel. Keep the
hammer recurrence scalar per voice and never vectorize serial time samples. Reuse/generalize the
existing `resonator_step4()` recurrence.

Cache `g`/`a1` and related fixed coefficients at initialization or dirty transitions: sample-rate,
mode-frequency, damping/Q, board-size, and note initialization changes. Rebuild the board cache before
using a new board-size value and clear/rebuild ownership correctly on reset. Do not calculate MIDI to
Hz or tangent/Pade/Q terms per resonator per sample. Iterate a fixed `active_voice_mask` rather than
scanning 32 inactive voices; note-on/steal sets bits, same-pass lifecycle deactivation clears them,
retarget preserves them, and reset clears all bits.

Profile the x2/x4 halfband FIR first. Vectorize it only if it costs at least 5% of total CPU in those
benchmarks; otherwise record `N/A — below SIMD optimization threshold` and leave the shared filter
layout alone.

### 8.6 Runtime semantics, passivity, and performance acceptance

A new strike resets only that voice's hammer contact; note-off stops hammer force and follows
existing pedal/damper lifecycle; voice stealing replaces per-voice state while preserving the current
de-click tail and all shared energy. Sustain lifts all passive dampers. Sostenuto holds only latched
keys, and its release restores damping and finite decay when sustain is up. Board mix zero is a true
radiation bypass. Sympathetic amount zero leaves unrelated transverse strings unchanged. No passive
network uses negative impedance or unstable poles; no normal string path relies on clipping. An
instability is a design conflict, not permission to restore clipping.

The current production standard SIMD128 topology is accepted for this calibration delivery. Scalar/SIMD
numerical equivalence, PR #8-relative CPU ratios, and SIMD-versus-scalar kernel/full-render speedups are
non-blocking diagnostics; report any available measurements without using them as completion gates.

The production SIMD build is the sole full-range lifecycle and acoustic gate. For each of the 1,408
key/layer cells it must show finite output, direct pitch within the normative tolerance, peak below
0 dBFS, zero final output-guard hits, finite note-off/release, and no stuck voice. All 1,392 adjacent
comparisons and production-SIMD acoustic regressions must pass. `supersynth-v9-lifecycle-differential.json`
is diagnostic only because its `pass:false` combines production checks with scalar/SIMD comparisons.
Record production-gate evidence separately from any scalar/performance diagnostics.

### 8.7 Provenance and validation sequence

Bind the committed Salamander metrics to the verified archive with a hash manifest for the SFZ,
all 641 referenced audio files, required license/provenance files, and archive SHA. The analyzer
must verify each extracted file before deriving metrics; a missing/mismatching hash fails or blocks
analysis. Extend numeric-only analysis for low-register non-harmonic peaks, log-spaced board-fit
bands, direct per-pitch brightness direction, and per-pitch dynamic span. Keep raw audio and private
Drive identifiers/paths out of Git.

Capture PR #8 baseline evidence at `6f4ab32bf20f9267eeb368aa4d7809e0fe846329` before DSP edits.
Record baseline, hammer, bridge, longitudinal, sympathetic, soundboard, and final preset/gain stages
with direct-reference distributions, dynamic-span error, brightness failures, full-range and adjacent
failures, peak/guard hits, and CPU ratio as informational data. Fit the board only after earlier physical
stages are stable. Then run the direct 480 cells, the production-SIMD 1,408-cell lifecycle gate, and
1,392 adjacent comparisons; tune preset and output gain last. Any later relevant source or document
change invalidates its affected evidence.

### 8.8 Stage3C contact-vs-bridge impedance split diagnostic

Stage3C is a test-only attribution experiment for the Stage3B bundle-impedance
change. It separates the two current uses of active-string characteristic
impedance without selecting or changing production architecture. The product
specification, production presets, and ordinary DSP behavior remain unchanged.

Stage3C diagnostic mask meanings are:

| Mask | Diagnostic behavior |
| ---: | --- |
| 0 | Current production-equivalent contact and bridge impedances |
| 1 | Contact-side bundle normalization only |
| 2 | Bridge-side bundle normalization only |
| 3 | Normalize both views; must reproduce Stage3B Factor-I behavior |

For active lanes, each normalized view divides the existing lane impedance by
the sum of active lane impedances. Lane ratios remain `1 : 0.965 : 1.035`.
Contact normalization affects only contact-weighted string velocity, contact
impedance sum, and hammer `delta_v`. Bridge normalization affects only the
shared bridge numerator and impedance denominator. String count, delay state,
unison geometry, hammer force law, bridge termination, soundboard, and output
gain do not change. The Stage3B implementation remains available with its
original mask semantics and is not modified by Stage3C.

Before split attribution, a 20-render equivalence gate checks ten fixed
coordinates at Stage3C masks 0 and 3. Mask 0 is compared with accepted Stage3A
evidence; mask 3 is compared with persisted Stage3B mask-1 evidence. Compared
numeric output and diagnostic fields must differ by no more than `1e-6`, while
masks, counts, and categorical values must match exactly. The mask-0 result is
reused as the factorial baseline; no mask-0 or mask-3 renders occur in the
subsequent split matrix.

After equivalence passes, the split matrix permits 286 renders: 256 dynamic
span cells over MIDI 36/39/42/45/48/51/54/57 and two masks (contact-only and
bridge-only), 24 treble guardrail cells over MIDI 93/96/99 and two masks, and
six MIDI41 velocity-derivative cells over normalized velocities 0.25/0.55/0.90
and two masks. The total Stage3C allowance is 306 renders, including
equivalence. Stage3A, Stage3B, and prior equivalence evidence are immutable
inputs. Stage3C factorial analysis reuses the accepted baselines and reports
contact, bridge, and interaction effects separately. This diagnostic can
identify output-path attribution only; it cannot establish physical root cause
or authorize production adoption. Any production architecture decision needs
a separate requirements/design contract.

#### Stage3C equivalence recovery

The original 20-render Stage3C equivalence ledger and blocked result are
immutable historical evidence. Its nineteen passing rows remain reusable; the
MIDI41 normalized-velocity `0.25`, mask-0 row is retained as a superseded
capture because it used `[0,160] ms` instead of the Stage3A supplement's
`[30,180] ms` derivative window. A separate correction sidecar supplies exactly
one replacement-comparison render at `[30,180] ms` and composes the nineteen
historical passes with that new pass. The original ledger, cells, and result are
never edited or rerendered.

Only after the corrected equivalence decision passes may the continuation
runner execute the existing 286 contact/bridge split cells. Correction and
continuation evidence have separate ledgers and are bound to the accepted
historical build/evidence hashes. Every continuation cell uses the fixed
`[30,180] ms` velocity-derivative window. The maximum new render count for this
recovery is 287: one correction plus 286 split cells. Correct cumulative
diagnostic accounting is 893 calls before recovery, 894 after correction, and
1180 after a complete split (`390 + 6 + 477 + 20 + 1 + 286`). The earlier
reported value 993 was an arithmetic error. This recovery remains diagnostic
only and cannot select or implement a production impedance architecture.

#### Stage3C continuation finalization recovery

The correction and 286-cell continuation evidence remain immutable and retain
their execution identity. Final attribution now runs through a separate
read-only finalizer sidecar and a pure, filesystem-independent attribution
core. The finalizer validates the persisted evidence against its historical
identity, then supplies the actual continuation-ledger hash to the attribution
result; it does not derive evidence ownership from a legacy path. The obsolete
`.agent-state/issues/7/stage3c/split/` path is not revived. This recovery adds
no acoustic execution and does not change Stage3C metric or factorial rules.

The finalized `continuation/split-attribution.json` is a terminal immutable
result. Repeated finalization validates its exact file hash, fixed evidence
bindings, and historical creator tuple, then returns the persisted result
without writes or renders. A later documentation-only HEAD change does not
change replay validity or the historical creator identity. A missing or
modified authoritative result fails closed; the finalizer never recreates or
overwrites it.
