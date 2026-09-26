# soraotoDSL Web Player Instruments

## 1. WASM SuperSynth v8

`wasm/plugins/dsp/super-synth/plugin.wasm` is the current 32-voice realtime synthesizer. It is a native soraotoDSL Plugin ABI 1.0 module and exposes 157 parameters with IDs 1–157.

Core engine:

- 16 spectral-morph wavetable frames × 7 band-limited mip levels × 1024 samples
- two morphable wavetable oscillators, sub oscillator and colored noise
- up to 8-way stereo unison with hard sync, phase distortion and selectable FM routing
- four-slot modulation matrix: LFO/envelope/velocity/pressure/timbre/note-age/random sources to pitch, cutoff, wavetable position, vocal formants, body resonance, vibrato, amplitude and pan
- poly / mono / legato voice modes, last/low/high note priority, sustain, sostenuto, portamento and release-priority de-clicked voice stealing
- preset polyphony limits plus optional dynamic voice limiting and adaptive oversampling budget controls
- per-note pitch/pressure/timbre/volume/pan expression and independent amp/filter envelopes
- selectable 1× / 2× / 4× oversampling, 31-tap half-band decimation, TPT stereo filter, chorus, saturation and output width
- dedicated physical models for pluck, modal piano, concert grand, tine, bowed string, flute, reed, brass and vocal
- concert-grand model with coupled fractional-delay strings, nonlinear felt hammer, common bridge feedback and a shared six-mode soundboard
- WebAssembly SIMD paths for resonator-heavy physical modelling

Authoring metadata is `wasm/plugins/dsp/super-synth/interface.soraoto`; the exact normalized source is embedded as `soraoto.interface`, while `soraoto.plugin.v1` remains the runtime descriptor.

### v8 synthesis and performance controls

SuperSynth v8 retains the v7 physical engines and adds the general modulation matrix, mono/legato note engine, extended wavetable oscillator and adaptive CPU-quality controls. `mono_lead`, `vintage_lead`, `acid_bass` and `sax_warm` exercise the legato engine; motion/pad presets exercise matrix routing; sync/FM presets exercise the new oscillator paths. The existing `concert_grand` remains the default full acoustic-piano model while `soft_piano` remains the lighter modal model.

### Performance Compiler and ChannelStrip

The browser Performance Compiler converts note/articulation context into sample-scheduled Plugin ABI note expressions for pitch, pressure, timbre, volume and pan. Instrument families receive different attack, sustain and phrase-shape curves instead of sharing one generic humanize rule.

`wasm/plugins/effects/channel-strip/plugin.wasm` is the standard track processor for production samples. It provides HPF/LPF, low/mid/high parametric bands, compressor attack/release/ratio/threshold, makeup gain, M/S width, balance and wet mix. Public sample songs use role-specific presets and section automation for instrument cutoff, stereo width, reverb send and ChannelStrip mid gain.

### Preset library and management

The preset source of truth is `wasm/plugins/dsp/super-synth/presets.json`. CMake reads it together with `descriptor.json` and `interface.soraoto` when generating the PluginDescriptor CBOR and embedding the normalized interface section. The descriptor source JSON lives beside the plugin's C source; generated metadata and the `.wasm` binary live under `build/wasm/`. The build emits normative Plugin ABI `factory_presets` plus one `program_lists` catalog. Each program carries family, engine/model, recommended range, polyphony, CPU class and preset-version attributes.

At node creation, `SoraotoPluginHost` resolves the authored preset name to its stable factory-preset ID and sends `LOAD_FACTORY_PRESET` (opcode 10) before sample processing begins. Explicit DSL parameter values are then sent as parameter points, so the preset-first / explicit-parameters-second rule is preserved. Reverb, Drum Machine and ChannelStrip use the same formal factory-preset path. A compatibility preset mirror remains in the browser vendor extension so an older cached host can still resolve preset values during rolling publication, but `factory_presets` / `program_lists` / `LOAD_FACTORY_PRESET` remain the canonical runtime contract.

#### Lead

- `mono_lead` — Focused mono legato lead
- `octave_lead` — Bright octave-stacked lead
- `pulse_lead` — Animated PWM lead
- `soft_lead` — Smooth vocal-guide lead with gentle vibrato
- `supersaw_lead` — Wide modern supersaw lead
- `vintage_lead` — Warm vintage mono lead

#### Bass

- `acid_bass` — Resonant acid-style bass
- `pluck_bass` — Short plucked bass
- `reese_bass` — Wide detuned bass
- `round_bass` — Round analog bass for pop
- `picked_bass` — Picked electric-bass approximation for standard tracks
- `sub_bass` — Clean fundamental sub
- `synth_bass` — Punchy modern synth bass

#### Pluck

- `arp_sparkle` — High sparkling arpeggio
- `bright_pluck` — Bright pop pluck
- `chord_stab` — Wide chord stab
- `glass_pluck` — Glassy phase-modulated pluck
- `muted_pluck` — Muted percussive pluck
- `soft_pluck` — Rounded soft pluck

#### Pad

- `airy_pad` — Airy wide pad
- `analog_pad` — Classic poly analog pad
- `choir_pad` — Soft synthetic choir-like pad
- `dark_pad` — Dark cinematic pad
- `dream_pad` — Slow shimmering dream pad
- `warm_pad` — Warm analog pad

#### Keys

- `digital_bell` — Digital bell with phase modulation
- `ep_bell` — Bell-like electric-piano approximation for standard tracks
- `ep_keys` — Electric-piano style keys
- `lofi_keys` — Muted lo-fi keys
- `mallet` — Short mallet tone
- `organ_drawbar` — Drawbar-organ approximation for standard tracks
- `organ_keys` — Steady organ-like keys
- `soft_keys` — Soft synth keys
- `concert_grand` — Dedicated concert-grand model with coupled fractional-delay strings, nonlinear felt hammer, common bridge feedback, and shared six-mode soundboard
- `soft_piano` — Compatibility modal-piano model; retained for explicitly authored legacy tracks

#### Strings

- `string_pad` — Soft string pad
- `strings_wide` — Wide string-ensemble approximation for standard tracks
- `synth_strings` — Wide synthetic string ensemble

#### Brass

- `brass_pop` — Bright pop brass for standard tracks
- `pop_brass` — Punchy pop brass
- `warm_brass` — Warm sustained brass

#### Guitar

- `clean_guitar` — Clean picked-guitar approximation
- `driven_guitar` — Driven rhythm-guitar approximation

#### Wind / Vocal / Harp

- `flute_air` — Breathy flute approximation
- `sax_warm` — Warm saxophone approximation
- `vocal_ah` — Synthetic ah-vocal approximation
- `harp_glass` — Glassy harp approximation

#### Motion

- `filter_motion` — Slow filter-motion texture
- `noise_riser` — Noisy high-pass riser bed
- `pulse_motion` — PWM motion bed
- `ring_texture` — Metallic ring-mod texture

### Example

```text
import plugin SuperSynth from "../wasm/plugins/dsp/super-synth/plugin.wasm"

track Lead {
  instrument {
    SuperSynth {
      preset: pulse_lead
      filter_cutoff: 4.8khz
      unison_voices: 4
    }
  }
}
```

Preset values are applied first; explicit DSL parameter paths override them. Parameter names/types/ranges come from the Plugin Interface Source / embedded PluginDescriptor rather than an external manifest.

## 2. Standard instrument resolution

For pitched tracks that do not declare an explicit WASM instrument, the WebPlayer now creates `wasm/plugins/dsp/super-synth/plugin.wasm` automatically and selects a preset from the track's `instrument` / name metadata. Typical mappings include piano → `concert_grand`, EP → `ep_bell`, bass → `picked_bass` / `sub_bass`, guitar → `clean_guitar` / `driven_guitar`, strings → `strings_wide`, brass → `brass_pop`, organ → `organ_drawbar`, flute/wind → `flute_air`, sax → `sax_warm`, vocal → `vocal_ah`, and harp → `harp_glass`. Lead/pad/pluck names continue to resolve to the corresponding native SuperSynth production presets.

An explicitly authored WASM instrument always wins over this automatic resolver. The legacy WebAudio pitched-instrument palette remains loaded only as a resilience fallback when the SuperSynth worklet/plugin cannot be created; it is no longer the normal standard-instrument path.

## 3. Drum Machine Plugin

`wasm/plugins/dsp/drum-machine/plugin.wasm` is the primary drum path. It accepts standard `soraoto-note-v1` note events; the WebPlayer lowers named drum lanes to GM-style pitches (Kick 36, Snare 38, Clap 39, Rim 37, Closed Hat 42, Open Hat 46, Tom 47, Ride 51, Crash 49). Five Plugin ABI factory presets are published: `studio`, `pop`, `rock`, `edm`, and `lofi`.

The plugin exposes kit, tone, punch, room, humanize and output gain parameters and adds per-hit variation. The current drum synthesis reduces raw broadband noise: snare/clap use band-limited noise plus body, hats/cymbals use metallic partials, and kit selection changes kick/snare/hat/tom/cymbal voicing rather than mainly kick tuning. Mixed tracks are split by event type so pitched notes can use SuperSynth while drum events use Drum Machine. The old WebAudio drum voices are retained only as a Plugin-load fallback.

## Scope

SuperSynth v7 is a hybrid multi-model synthesizer. Its engine models include `wavetable`, `pluck`, modal `piano`, `tine`, `bowed`, `flute`, `reed`, `brass`, `vocal`, and dedicated `concert_grand`. `concert_grand` uses one/two/three coupled fractional-delay strings by keyboard region, nonlinear felt-hammer excitation, bridge feedback, release damping and a shared stereo soundboard; `soft_piano` remains the lighter modal piano compatibility model, while `ep_bell` uses its tine model; guitar/harp/bass plucks use a digital waveguide plus body resonators; strings use nonlinear bow/string excitation into a waveguide; flute/sax/brass use pressure sources with moving formant/body resonators; and `vocal_ah` uses a harmonic glottal source with morphable formants. These remain procedural synthesis models rather than multisampled acoustic libraries.
