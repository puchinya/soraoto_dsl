# SuperSynth Engine Models Specification

- Product: SuperSynth
- Product version: 9.0.0
- Authority: Normative companion to [`super-synth-spec.md`](super-synth-spec.md)
- Review state: Proposed for Issue [#7](https://github.com/puchinya/soraoto_dsl/issues/7); approval pending

## 1. Purpose and source of truth

This document defines the product-level role of each supported SuperSynth source model. It does not
change the shared Plugin ABI, define new parameters, or duplicate all 157 parameter declarations.
`interface.soraoto` owns the enum and parameter schema; `src/plugin.c` is the implementation. The
companion design at
[`../../../../design/plugins/dsp/super-synth/super-synth-engine-models-design.md`](../../../../design/plugins/dsp/super-synth/super-synth-engine-models-design.md)
describes current renderer ownership and dispatch.

## 2. Stable model catalog

The public `EngineModel` enum order and values are:

| Runtime value | Model | Product behavior |
|---:|---|---|
| 0 | `wavetable` | General-purpose procedural wavetable synthesis. The shared source provides band-limited frame-morphing wavetables, dual oscillators, unison, sub, and colored noise. |
| 1 | `pluck` | Plucked-string synthesis using a delay-line waveguide, body resonances, and a sympathetic component. |
| 2 | `piano` | Lighter modal struck-piano synthesis with felt contact, detuned string modes, stretched partials, and broad soundboard modes. Used by `soft_piano`. |
| 3 | `tine` | Struck tine/electric-key synthesis with resonant partials, pickup response/drive, and bell/body resonances. |
| 4 | `bowed` | Bow-friction-driven string synthesis with position-weighted partials, body modes, and sympathetic response. |
| 5 | `flute` | Breath/jet-noise excitation selected by air-column/bore partials, with a body resonance. |
| 6 | `reed` | Pressure-driven reed airflow coupled to a conical bore and body resonance. |
| 7 | `brass` | Pressure-driven lip excitation coupled to mouthpiece and bore resonances, with a body component. |
| 8 | `vocal` | Glottal excitation shaped by moving vowel formants with nasal and chest components. |
| 9 | `concert_grand` | Full acoustic-grand physical model with felt hammer/string contact, traveling-wave strings, bridge/soundboard radiation, and keyboard stereo behavior. See §5 of the companion product spec. |

Numeric values match `EngineModel` enum order in `interface.soraoto`; they are public compatibility
data, not an invitation to reorder the render branches. Model-specific existing controls remain
defined by the interface and current presets.

## 3. Product-level invariants

- Each enum value remains selectable through the existing `engine_model` parameter; the V9 task
  changes no model enum value or parameter identity.
- The ordinary Web Player piano route selects `concert_grand`. An explicitly selected `soft_piano`
  preset retains `piano`.
- Model descriptions state the source family and major audible/resonant components. They do not
  promise a sampled instrument, exact acoustic instrument emulation, or sample-identical output.
- Piano calibration modifies only the V9 `concert_grand` behavior covered by the product spec.
  Unrelated model behavior and presets are preserved.
- Changes to another model's role, exposed value, or compatibility require product-spec and design
  review before implementation.
