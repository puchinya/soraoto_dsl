# SuperSynth V9 design

**Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7)
**Product contract:** [`../../../../specs/plugins/dsp/super-synth/super-synth-spec.md`](../../../../specs/plugins/dsp/super-synth/super-synth-spec.md)
**Review state:** Approved by the user on 2026-09-26; this design governs Issue #7 implementation.

## 1. Scope and decisions

This design covers the in-place SuperSynth release identity update and evidence-driven calibration
of the existing native concert-grand model. It preserves Plugin ABI 1.0, the existing plugin ID,
public parameter and factory-preset compatibility, and the established runtime architecture.
The complete current engine family inventory and non-piano renderer ownership are split into
[`super-synth-engine-models-design.md`](super-synth-engine-models-design.md).

The model remains in `wasm/plugins/dsp/super-synth/src/plugin.c`. The Web Player continues to select
the plugin's `concert_grand` engine model for its ordinary piano instrument and does not implement
DSP. `soft_piano` remains mapped to the existing `piano` engine model. No replacement plugin,
compatibility alias, public parameter, state migration, ABI change, or JavaScript DSP is introduced.

## 2. Metadata ownership and generation path

Keep each field at its existing source of truth:

| Data | Owner / responsibility |
|---|---|
| Plugin parameter schema and engine-model enum | `interface.soraoto` |
| Factory preset authoring | `presets.json` |
| Plugin identity and capabilities | `descriptor.json` |
| SuperSynth lowering and fallback metadata | `wasm/cmake/super_synth_metadata.py` |
| Generic metadata generation | `wasm/cmake/generate_plugin_metadata.py` |
| Runtime descriptor/interface truth | Embedded `soraoto.plugin.v1` and byte-identical source `soraoto.interface` |

Update derived metadata through the established generators. Keep generated artifacts under
`build/wasm/`; do not hand-edit generated output or commit generated binaries. Retain the plugin ID
`net.puchinya.soraotodsl.super-synth-v8`, set the descriptor name to `SuperSynth v9` and version to
`9.0.0`, and keep `compatible_plugin_ids` empty. Update the existing source and generated metadata
regression expectations together so source, embedded descriptor, and interface cannot drift.

Keep parameter IDs, paths, types, ranges, enum values, preset identities/order, and serialized state
schema unchanged. Regenerate only metadata derived from the plugin version, including
`soraoto.preset_version`.

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

Use `soundboard_mix=0` as a diagnostic bypass to isolate the soundboard contribution. Calibrate the
model's gain and spectral shape at the source stages; do not compensate for a flawed model with a
master gain adjustment.

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

After each material calibration stage, rerun all 480 direct-reference cells. The final model must
also pass all 1,408 full-range renders and all 1,392 adjacent-key/layer comparisons. Do not accept a
better global average if it creates a severe individual key/layer failure. Velocity response must
evolve in level and contact/brightness, with plausible harmonics, transient and decay behavior,
stable high notes, controlled bass, and finite release. Preserve existing plugin safety,
voice-stealing, and pedal regressions.

The full-range evaluator uses one shared gain offset: the median source-minus-rendered level across
the 480 direct cells in the 80–200 ms window. This preserves register and velocity relationships.
Hard limits are ±20 dB for direct-cell level, centroid ratio 8, absolute >2 kHz ratio delta 1.0, and
10 dB for post-attack envelope-shape error (30–350 ms). Centroid is a gate only when either compared
render has at least 0.1% of total power above 2 kHz; below that floor, centroid remains visible as a
diagnostic because near-zero high-frequency energy can dominate a magnitude-weighted centroid.
Every rendered cell must stay between
−90 dBFS and +1.6 dBFS peak. Adjacent pairs are limited to 10 dB level jump, centroid ratio 4.5,
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
| Parameter, preset, and state compatibility | Existing interface/preset/state regression coverage and byte-level schema comparison |
| DSP reference fit | Numeric derived-metric fixture for all 480 direct-reference cells; no raw audio or private Drive data; broad thresholds grounded in the source and measurement windows |
| Full-range piano behavior | 1,408 renders over MIDI 21–108 and 1,392 adjacent-key/layer continuity comparisons; per-cell failures remain visible |
| Plugin regressions | Existing concert-grand, safety, voice-steal, click, calibration, realism, and pedal coverage; full CTest suite |
| Web Player compatibility | Existing plugin-interface and publication-audit tests; Web Player test suite and production build |
| Scope and artifact hygiene | Self-review against the contract; `git diff --check`; confirm no raw audio, generated binaries, archives, duplicate runtime headers, or generated build output is tracked |

Run the repository's documented WASM/CTest and Web Player test/build entry points from
[`../../../../../web-player/README.md`](../../../../../web-player/README.md) and `wasm/CMakeLists.txt`;
record exact commands and PASS/FAIL/NOT RUN/BLOCKED results in the Issue and status mirror. These
checks do not substitute for direct audio comparison or browser-interaction evidence.
