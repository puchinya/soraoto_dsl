# SuperSynth Product Specification

- Product: SuperSynth
- Product version: 9.0.0
- Plugin ABI: 1.0
- Status: Normative product specification
- Review state: Proposed for Issue [#7](https://github.com/puchinya/soraoto_dsl/issues/7); approval pending
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
- Factory preset IDs, names, order, and serialized state schema remain unchanged. No migration is
  added. Metadata derived from product version, including `soraoto.preset_version`, is regenerated
  for `9.0.0`.

## 3. Canonical product sources

- `interface.soraoto` owns parameter declarations and `EngineModel` enum values.
- `presets.json` owns factory preset authoring values and identities.
- `descriptor.json` and the metadata generators own tracked/generated Plugin descriptor metadata.
- `src/plugin.c` owns native real-time DSP.
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

- nonlinear felt/hammer contact and velocity response;
- traveling-wave strings with register-dependent string count, unison, inharmonicity, and damping;
- bridge/soundboard coupling and keyboard stereo radiation;
- damper, note release, sustain, and sostenuto response;
- controlled low-bass radiation without audible sustained buzz;
- finite, safe output across the supported pitch and velocity range;
- no synthetic fixed-fifth or bell-like regression.

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
velocity response must change contact/brightness as well as level. Calibrate in the approved order:
hammer/felt response, velocity hardness, hammer noise/attack, string harmonics, dispersion and
inharmonicity, damping/decay, unison, bridge, soundboard, low-register mode suppression,
release/damper, sustain/sostenuto, stereo radiation, preset defaults, and output gain last.

Use broad physically meaningful tolerances and evaluate each key/layer and continuity comparison
individually. Tuning may not improve an aggregate average while causing a new severe cell failure.
Raw audio remains in the private reference store and is excluded from Git and the distributed plugin.
Commit only numeric derived metrics and source provenance needed for reproducible regression. Do not
commit private Drive IDs/URLs, credentials, account identifiers, or absolute local paths. No other
real-piano source is calibration truth for this V9 work.

## 7. Conformance

Identity, enum/model compatibility, preset/state compatibility, and runtime behavior require
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

Passing a build or launching the Web Player is not evidence of direct audio behavior. Report
deterministic test results separately from optional/manual listening evidence. Real-reference derived
targets must be reproducible. Existing V9 concert-grand thresholds must not be widened without
measured evidence and design review.

## 8. Versioning and change control

A product version bump does not by itself require a Plugin ID change. Public Plugin identity, ABI,
parameter, enum, preset-identity, or state-schema changes require requirements/design review. A change
to an engine's product role must update this product spec and its model-specific spec before
implementation. A conflict with the shared normative Plugin contract blocks the conflicting work
until design/specification resolution.
