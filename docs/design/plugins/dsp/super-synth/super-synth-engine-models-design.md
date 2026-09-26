# SuperSynth Engine Models Design

**Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7)
**Model specification:** [`../../../../specs/plugins/dsp/super-synth/super-synth-engine-models-spec.md`](../../../../specs/plugins/dsp/super-synth/super-synth-engine-models-spec.md)
**Review state:** Revised companion design approved by the user on 2026-09-26 for Issue #7.

## 1. Scope and source basis

This document records how the existing `EngineModel` values are routed through the native runtime.
It documents current source ownership and the approved `concert_grand` architecture delta; it does
not change or retune the other sound generators.
`interface.soraoto` owns the stable enum order and parameter schema. `src/plugin.c` owns the renderer
and voice state. Product roles are defined by the companion
[`super-synth-engine-models-spec.md`](../../../../specs/plugins/dsp/super-synth/super-synth-engine-models-spec.md).

## 2. Runtime dispatch

The `engine_model` enum order maps to the current native render paths as follows:

| Value | Model | Current renderer / state owner |
|---:|---|---|
| 0 | `wavetable` | Shared procedural wavetable renderer (`wt_lookup`) with dual oscillators and shared unison/sub/noise/filter stages. |
| 1 | `pluck` | `waveguide_step` plus per-voice body and sympathetic resonators; `prepare_waveguide` initializes or retunes its delay line. |
| 2 | `piano` | Struck modal bank in `render_voice_step`, with per-voice string modes and soundboard resonators. |
| 3 | `tine` | Tine partial resonators in `render_voice_step`, followed by pickup drive and bell/body resonators. |
| 4 | `bowed` | `bowed_string_v7`: pressure/friction drive, position-weighted string partials, body and sympathetic modes. |
| 5 | `flute` | `flute_v7`: breath/jet excitation, bore partials, and body resonance. |
| 6 | `reed` | `reed_v7`: pressure-driven aperture/flow, bore partials, and body resonance. |
| 7 | `brass` | `brass_v7`: pressure-driven lip/mouthpiece excitation, bore partials, and body resonance. |
| 8 | `vocal` | `vocal_v7`: glottal source, vowel-controlled formants, and nasal/chest resonances. |
| 9 | `concert_grand` | Dynamic hammer and traveling-wave strings with a shared bridge junction, passive sympathetic register, fitted soundboard/radiation state, longitudinal modes, and SIMD128 modal kernels; detailed in [`super-synth-design.md`](super-synth-design.md). |

The mapping is derived from the `EngineModel` declaration and `render_voice_step` dispatch. Keep the
enum mapping, native dispatch, and metadata generation consistent. Do not reorder numeric values or
derive a new Plugin ID from an engine name.

## 3. Shared voice and render path

All models use the existing Plugin voice lifecycle, note-expression smoothing, envelopes, modulation
matrix, pan/output stage, and allocation-free native processing path. Engine 0 uses the generic
wavetable renderer. For a dedicated physical engine, `render_voice_step` also renders the generic
source when `physical_mix` is below its full value and blends the two paths by that parameter. This
existing control behavior is preserved; no new source path is added in this V9 task.

The pluck and concert-grand delay-line models are explicitly prepared on note start and re-prepared
when legato retargeting requires a new pitch. The bowed, flute, reed, and brass paths are continuous
resonant models and retain their resonant state across continuous pitch changes. Keep any future
lifecycle change tied to an explicit design and regression requirement.

The concert-grand model owns dynamic hammer, transverse-string, and longitudinal state per voice,
plus one shared three-zone fitted soundboard and one shared 88-key passive sympathetic register.
Other engine paths keep their current per-voice resonator ownership. Do not move these native DSP
paths into Web Player JavaScript.

## 4. Product routing and metadata boundary

Engine selection is carried by the existing `engine_model` parameter and factory-preset metadata.
Web Player instrument selection is a separate routing layer: ordinary piano maps to the
`concert_grand` factory preset, explicit `soft_piano` stays on `piano`, and other catalog programs
select their authored preset and engine metadata. Do not duplicate native DSP in the routing layer.

`instrument-presets.test.js` checks representative catalog mappings including `soft_piano`,
`clean_guitar` (`pluck`), `strings_wide` (`bowed`), `flute_air` (`flute`), and `vocal_ah` (`vocal`).
Factory preset authoring stays in `presets.json`; generated descriptors remain under `build/wasm/`.

## 5. Verification mapping and coverage limits

| Concern | Existing evidence |
|---|---|
| Enum and interface identity | `plugin-interface-v1.test.js` |
| General wavetable/render quality | `synth-quality.test.js`, `supersynth-core-quality.test.js`, `supersynth-v7-quality.test.js` |
| Voice lifecycle and playback safety | `supersynth-v7-lifecycle.test.js`, `playback-safety-regression.test.js` |
| Representative program-to-engine routing | `instrument-presets.test.js` |
| Piano model distinction and V9 grand behavior | `piano-realism-regression.test.js`, `concert-grand-regression.test.js`, and the piano-specific calibration/click/voice-steal tests |
| Cross-cutting signal quality | `oversampling-quality.test.js` |

The repository has general synth coverage and representative preset-to-engine assertions; it does not
currently have a separately named behavioral regression file for every one of the ten engine
families. This design documents that coverage boundary rather than claiming unobserved per-model
verification. Add or change model behavior only with an explicit acceptance criterion and matching
focused evidence.

## 6. Change boundary

This Issue's DSP tuning target is engine 9, `concert_grand`. The other engine paths are documented
to make the product contract complete, but their renderer code, factory preset values, and product
roles remain unchanged. If review identifies a concrete defect in another model, record it as a
separate approved requirement before changing that model.
