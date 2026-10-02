# SuperSynth Product Specification

- Product: SuperSynth
- Product version: 9.0.0
- Plugin ABI: 1.0
- Status: Normative product specification
- Review state: Preset-owned grand-piano physical configuration approved by the user on 2026-09-27 for Issue [#7](https://github.com/puchinya/soraoto_dsl/issues/7); implementation in progress
- Owning implementation: `wasm/plugins/dsp/super-synth/`

## 1. Scope and authority

This document is normative for SuperSynth-specific product behavior. The shared soraotoDSL Plugin
contract remains authoritative for generic Plugin identity, compatibility, lifecycle, and ABI
behavior: [`../../../soraotoDSL/spec/03-plugin-model.md`](../../../soraotoDSL/spec/03-plugin-model.md)
and [`../../../soraotoDSL/spec/04-realtime-abi.md`](../../../soraotoDSL/spec/04-realtime-abi.md).

When a product rule conflicts with the shared Plugin contract, the shared contract wins. Stop the
affected change and return to requirements/design; do not resolve a public compatibility or ABI
conflict in implementation. The model catalog and model-level requirements are split into
[`super-synth-engine-models-spec.md`](super-synth-engine-models-spec.md).

## 2. Identity and compatibility

- SuperSynth V9 keeps Plugin ID `net.puchinya.soraotodsl.super-synth-v8` and Plugin ABI `1.0`.
- Display name is `SuperSynth v9`; product version is SemVer `9.0.0`.
- `compatible_plugin_ids` remains empty. This is an in-place release, not a replacement plugin or
  a migration release.
- The current 157 parameter IDs, paths, types, ranges, and enum values remain unchanged.
- Factory preset IDs, names, and order remain unchanged. Every factory preset selecting
  `concert_grand` owns a complete internal physical profile; this does not add host parameters.
- The project DSL stores the selected factory preset ID and parameter values. The Plugin owns no
  separate persistent state, and the active preset ID is never duplicated in a Plugin state blob.
- Keep Plugin ABI 1.0 and all DSL/preset version numbers unchanged. The shared ABI 1.0 contract is
  updated to remove state snapshot/load and opaque data services. Old opaque state blobs are not
  supported and are not migrated.
- Metadata derived from product version, including `soraoto.preset_version`, is regenerated for
  `9.0.0`.

## 3. Canonical product sources

- `interface.soraoto` owns parameter declarations and `EngineModel` enum values.
- `presets.json` owns factory preset authoring values and identities, including every sound-affecting
  value in a complete `engine_config` for each `concert_grand` preset.
- `descriptor.json` and the metadata generators own tracked/generated Plugin descriptor metadata.
- `wasm/cmake/super_synth_metadata.py` strictly validates preset profiles and generates immutable
  profile data and ID mappings in `wasm/shared/generated/super-synth_grand_profiles.h`.
- `src/plugin.c` owns native real-time DSP and reads the active generated `GrandEngineConfig`;
  authored sound-tuning defaults do not remain in C or a separate fit header.
- Runtime `soraoto.plugin.v1` must agree with its source descriptor, and runtime `soraoto.interface`
  must embed the canonical interface source byte-for-byte.

The product specification does not duplicate all parameter declarations or factory preset values.
Use these canonical sources when exact values or identities matter.

## 4. Supported engine families

SuperSynth supports the ten stable `EngineModel` values in
[`interface.soraoto`](../../../../../wasm/plugins/dsp/super-synth/interface.soraoto). Their product
roles are:

| Value | Product role |
|---|---|
| `wavetable` | General-purpose morphing wavetable synthesizer with the shared oscillator, unison, sub/noise, filter, and modulation facilities. |
| `pluck` | Plucked-string voice with a waveguide string and resonant body/sympathetic contribution. |
| `piano` | Lighter modal struck-piano voice retained for `soft_piano` and compatibility. |
| `tine` | Struck tine/electric-key voice with resonant pickup, bell, and body components. |
| `bowed` | Bowed-string voice driven by pressure/friction with string, body, and sympathetic resonances. |
| `flute` | Breath/jet-driven air-column voice with bore partials and body resonance. |
| `reed` | Pressure-driven reed voice coupled to bore and body resonances. |
| `brass` | Pressure-driven lip voice coupled to mouthpiece, bore, and body resonances. |
| `vocal` | Glottal/formant voice with vowel morph, nasal, and chest color. |
| `concert_grand` | Full acoustic-grand physical model specified in §5 and calibrated under §6. |

These names identify the supported source families; they do not promise sample-identical acoustic
reproduction. The enum values and their meanings are product compatibility. Do not add, remove, or
repurpose a value without requirements/design review. The existing default remains `wavetable`.
Detailed current behavior and architecture ownership are documented in the model-specific spec and
design.

For ordinary piano routing, Web Player selects `concert_grand`; the explicit `soft_piano` factory
preset continues to use the lighter `piano` model. Preset identity and routing remain governed by
the canonical preset/catalog sources.

## 5. V9 concert-grand behavior

The `concert_grand` model is a native physical piano model. Its behavior includes:

- dynamic hammer mass with nonlinear felt contact and velocity response;
- traveling-wave strings with register-dependent string count, unison, inharmonicity, and damping;
- explicit energy exchange between unison strings through a shared bridge junction;
- a stable, passive, reference-derived modal soundboard/radiation model;
- a shared passive sympathetic-string register with existing damper, sustain, and sostenuto behavior;
- two nonlinearly excited longitudinal modes per active low-register voice, smoothly faded out by MIDI 57;
- bridge/soundboard coupling and keyboard stereo radiation;
- damper, note release, sustain, and sostenuto response;
- controlled low-bass radiation without audible sustained buzz;
- finite, safe output across the supported pitch and velocity range;
- no synthetic fixed-fifth or bell-like regression.

The normal hammer/string path uses energy-consistent force and impedance scattering. Waveguide
clipping is not a normal stabilizer. The soundboard model is a stable effective bridge-to-radiation
proxy identified from derived Salamander metrics; the microphone recordings are not mechanical
bridge-force/bridge-velocity measurements and must not be described as the piano's measured
mechanical admittance.

Each `concert_grand` factory preset is a complete standalone `grand_piano_v1` revision-2 instrument
definition in `engine_config`. No piano-profile inheritance, partial configuration, missing-field C
fallback, runtime JSON parsing, or realtime allocation is used. Construction and calibration values
remain internal; existing public piano controls are high-level modifiers over the selected profile.
Loading a factory preset or program applies public parameters and the corresponding physical profile
through the same path. A profile change clears incompatible grand voice/body resonant state and
rebuilds dependent caches. Selecting a non-grand preset resets the latent grand profile to the
generated default `concert_grand` profile.

The private preset-owned `engine_config.hammer.velocity_hardness_amount` controls how the validated
base hammer-hardness parameter changes effective felt hardness with note velocity. Let `h` be the
clamped public base hardness, `v` the clamped normalized note velocity, and `a` the profile-owned
amount in `[0,1]`. Revision 2 uses the continuous centered mapping
`effective_hardness = clamp(h + a * (v - 61/127), 0, 1)`. The pivot remains invariant; the effective
value controls felt exponent, stiffness, passive contact loss, hammer mass, and the initial hammer
velocity hardness factor. The fixed launch intercept/slope remain `0.42 / 1.05`, and hammer-noise
scaling continues to use base hardness. The field is private preset configuration, not a public
parameter, Plugin state, or DSL field.

In revision 2, passive string termination loss does not directly depend on note velocity. Velocity
affects hammer excitation/hardness and the existing final velocity gain, while passive boundary decay
depends on pitch and the semantic string-damping control. Applying the same per-circulation scalar loss
at every pitch must not cause faster decay per second solely because higher notes have shorter string
periods. This decay-time normalization does not alter low-pass/HF filters, dispersion, bridge impedance,
soundboard, or radiation behavior.

The project DSL stores the selected factory preset ID and public parameter values. The selected ID
resolves the complete physical profile; the Plugin does not store a second preset ID or opaque state.
A test-only second complete grand profile demonstrates that a new piano can be authored and
generated without changing C source.

Changes for this V9 task target the `concert_grand` implementation and its behavior. Other engine
families remain documented and covered by their existing compatibility/regression evidence; do not
retune unrelated engine models or factory presets as part of piano calibration.

`soundboard_mix=0` remains a diagnostic bypass of the soundboard contribution. It is not a master
gain or spectral-balance workaround.

## 6. Real-piano calibration requirements

Use **Salamander Grand Piano V3 only** as the real-piano calibration source. It is Alexander Holm's
Yamaha C5 recording, published by FreePats under Creative Commons Attribution 3.0 Unported (CC BY
3.0). The best-quality package is
`SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz` (SFZ+FLAC, 48 kHz, 24-bit). The source was
recorded in AB stereo with two AKG C414 microphones about 12 cm above the strings. Attribute the
source as “Salamander Grand Piano V3, Alexander Holm, FreePats” and link the [source page](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html)
and [CC BY 3.0 license](https://creativecommons.org/licenses/by/3.0/); do not imply endorsement.
Identify modifications when distributing modified reference artifacts. CC BY 3.0 permits analysis
and calibration use subject to its attribution and notice terms.

The source's SFZ structure defines playable MIDI notes 21–108 (A0–C8), 30 main pitch centers
sampled every minor third from A0 (`21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60,
63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108`), and 16 velocity layers.
Preserve these exact MIDI velocity ranges; do not replace them with an invented linear split:

| Layer | MIDI velocity | Layer | MIDI velocity |
|---:|:---:|---:|:---:|
| 1 | 1–26 | 9 | 65–72 |
| 2 | 27–34 | 10 | 73–80 |
| 3 | 35–36 | 11 | 81–88 |
| 4 | 37–43 | 12 | 89–96 |
| 5 | 44–46 | 13 | 97–104 |
| 6 | 47–50 | 14 | 105–112 |
| 7 | 51–56 | 15 | 113–120 |
| 8 | 57–64 | 16 | 121–127 |

Create one direct-reference entry for each recorded pitch center and layer (30 × 16 = **480 cells**).
For full-range validation, render every key at one representative velocity per layer, calculated
from `round((lovel + hivel) / 2)`: `14, 31, 36, 40, 45, 49, 54, 61, 69, 77, 85, 93, 101, 109,
117, 124`. Evaluate all MIDI 21–108 keys at all 16 layers (88 × 16 = **1,408 render cells**).
Evaluate every adjacent semitone pair at every layer (87 × 16 = **1,392 comparisons**). Keep each
key/layer result visible; an aggregate score cannot hide a local failure.

At direct pitch centers, compare all layers against numeric metrics derived from the corresponding
Salamander source samples. At the 58 non-center keys, interpolate metrics between neighboring
pitch centers at the same layer; use one-sided reference behavior at keyboard edges. Never interpolate
or pitch-shift waveforms and represent the result as an original recording.

Measure harmonic ratios h2/h1 through h5/h1, spectral centroid, energy above 2 kHz, attack and early
brightness, inharmonic spectral spread, output RMS/energy and peak progression, transient/hammer
response, attack and decay behavior, stereo width/localization from the AB recording, and release /
damper response. Remove DC and align note onset; compare equivalent windows. Normalize only
shape-specific spectral windows. Do not normalize away level progression across velocity layers;
velocity response must change contact/brightness as well as level. At each direct Salamander pitch,
if the reference materially brightens from low to high velocity, the SuperSynth response must not
materially darken there. Check every direct pitch individually, including MIDI 21, 24, and 27; the
aggregate 75% brightness criterion cannot hide a direct-pitch inversion. Compare dynamic span at
each direct pitch, with an absolute synth-versus-reference span error no greater than 8 dB unless a
tighter evidence-backed design threshold is recorded. Calibrate in the approved order:
hammer/felt response, velocity hardness, hammer noise/attack, string harmonics, dispersion and
inharmonicity, damping/decay, unison, bridge, soundboard, low-register mode suppression,
release/damper, sustain/sostenuto, stereo radiation, preset defaults, and output gain last.

Use broad physically meaningful tolerances and evaluate each key/layer and continuity comparison
individually. Tuning may not improve an aggregate average while causing a new severe cell failure.
For this physical-model delta, each of the 1,408 full-range single-note cells includes note-on,
sustain, note-off, and release phases with hard checks for finite output, pitch, finite decay, and
stuck tails. Every such cell must peak below 0 dBFS in normal operation, and the emergency final
output guard must not activate in the matrix. The test threshold must not be set to the guard ceiling.
Raw audio remains in the private reference store and is excluded from Git and the distributed plugin.
Commit only numeric derived metrics and source provenance needed for reproducible regression. Do not
commit private Drive IDs/URLs, credentials, account identifiers, or absolute local paths. No other
real-piano source is calibration truth for this V9 work.

## 7. Conformance

Identity, enum/model compatibility, preset/configuration selection, and runtime behavior require
deterministic regression evidence. Existing model and cross-cutting evidence includes:

- `plugin-interface-v1.test.js` for source and runtime interface/identity contract;
- `synth-quality.test.js`, `supersynth-core-quality.test.js`, `supersynth-v7-quality.test.js`, and
  `supersynth-v7-lifecycle.test.js` for general synth behavior and lifecycle;
- `instrument-presets.test.js` for catalog-to-engine assignments;
- `concert-grand-regression.test.js`, `salamander-reference-fixture.test.js`,
  `supersynth-v9-full-range-calibration.test.js`,
  `piano-realism-regression.test.js`, `piano-click-regression.test.js`, and
  `piano-voice-steal-regression.test.js` for piano-specific behavior;
- `playback-safety-regression.test.js` and `oversampling-quality.test.js` for cross-cutting safety
  and signal-quality behavior.

Grand profile conformance additionally requires positive and negative schema fixtures, exact array
length/range/finite-value validation, byte-identical repeated metadata/profile generation, factory
and program profile application, profile-switch clearing/cache invalidation, non-grand defaulting,
DSL preset-ID roundtrip, rejection of incomplete or unknown profiles, and an in-memory second-profile generation
test. The Salamander calibration tool must emit a validated profile and update only the selected
preset's `engine_config` when asked to write a profile.

Run the full-range physical lifecycle and acoustic gates against the production standard SIMD128
build. For every required cell, production output must remain finite and within pitch tolerance, stay
below 0 dBFS without activating the emergency output guard, release finitely after note-off, and leave
no stuck voice. Scalar/SIMD differential measurements and relative SIMD/CPU speed targets are
informational implementation diagnostics; they do not replace or block these production behavior
requirements.

Passing a build or launching the Web Player is not evidence of direct audio behavior. Report
deterministic test results separately from optional/manual listening evidence. Real-reference derived
targets must be reproducible. Existing V9 concert-grand thresholds must not be widened without
measured evidence and design review.

## 8. Versioning and change control

A product version bump does not by itself require a Plugin ID change. This approved Issue does not
bump ABI or DSL/preset version numbers. The shared ABI 1.0 contract is updated in place to remove
Plugin-owned persistent state; previous opaque state blobs are unsupported and are not migrated.
Other public Plugin identity, ABI, parameter, enum, or preset-identity changes require
requirements/design review. A change to an engine's product role must update this product spec and
its model-specific spec before implementation. A conflict with the shared normative Plugin contract
blocks the conflicting work until design/specification resolution.
