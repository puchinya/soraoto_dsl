# soraotoDSL Draft v0.5 — Web Reference Implementation Compliance

This build targets the latest normative soraotoDSL **Draft v0.5** language model and preserves the three version axes separately:

```text
Language       Draft v0.5
Component ABI  soraoto:component@1.0.0
Plugin ABI     1.0
```

Legend: **Implemented** means parsed/lowered and executed or exported by this browser player; **IR** means represented and validated at the browser boundary but not fully hosted as the portable binary ABI.

| Area | Status | Browser reference behavior |
| --- | --- | --- |
| `import plugin` | Implemented | Canonical spelling; `import dsp` is rejected; only canonical `import plugin` is accepted. |
| immutable `let` | Implemented reference | Pitch/scalar/String, Pattern aliases/results, NotesFragment and drum-lane String use cases; `const` is rejected in v0.5 mode. |
| EventFragment / PatternFn | Implemented reference | NotesFragment and DrumFragment pattern results, explicit/inferred result type, repetition and provenance. |
| Lyrics DSL | Implemented | `_`, `.`, `/`, `|`, `surface{reading}`, `{reading}`, language metadata, note alignment, `soraoto-vocal-v1` IR, MIDI lyrics. |
| Core Note DSL | Implemented | Absolute/relative pitch, retrigger/rest/sustain, duration, dotted/triplet, tuplets, bar commit, chords, voices, attributes, articulation, gate up to 2. |
| Harmony / follow / generators | Implemented | Section-aware harmony and current generator set. |
| Drum repeat / humanize | Implemented | String lane `* N`, section grids, seeded humanize; DrumFragment pattern repeat. |
| Macro declarations | IR / partial execution | Draft v0.5 typed macro declarations and `map/filter/flat_map/window/fold/scan` operator use are retained as pure finite-stream metadata. Standard built-in macros execute; arbitrary user macro bodies are not yet interpreted by the lightweight browser compiler. |
| JS Component | IR / standard components | Canonical Component import/ABI metadata is retained; Sidechain/StereoDelay standard components execute. Arbitrary third-party synchronous sandbox loading is not performed by this static browser compiler. |
| WASM Component | IR boundary | ABI identity is `soraoto:component@1.0.0`; this player does not implement a general WebAssembly Component Model loader. |
| Plugin Interface Source (`soraoto.interface`) | Implemented build/validation path | SuperSynth v6 ships normalized `*.interface.soraoto`; build lowering creates the PluginDescriptor, embeds exact interface source, and release tests validate identity/parameter ID/path equivalence. Runtime truth remains `soraoto.plugin.v1`. |
| WASM Plugin | Implemented | Included plugins implement Plugin ABI 1.0 directly, embed `soraoto.plugin.v1`, use the normative lifecycle and ProcessBlock structures, and are hosted by AudioWorklet. |
| Compile-time/runtime boundary | Implemented | DSL/fn/pattern/macro/component work never runs on the audio thread; runtime receives Resolved Project IR. |
| Audio Graph / stereo / routing | Implemented | Track/Bus/Master, sends, sidechain edges, graph-level pan, balance/width, ChannelStrip EQ/dynamics/M-S width, safety guards. |
| Automation / modulation | Implemented reference | Track controls plus timeline automation for instrument parameters, stereo width/balance, send levels and named effect parameters run in the browser engine. |
| MIDI / WAV | Implemented | Type-1 MIDI, lyric meta-events, tempo/meter/control data, OfflineAudioContext WAV. |
| Performance Compiler | Implemented reference | Instrument-family and articulation-aware per-note pitch, pressure, timbre, volume and pan expression curves are lowered to Plugin ABI note-expression events. |
| Factory preset service | Implemented | Preset-bearing bundled plugins publish `factory_presets` / `program_lists`; WebPlayer loads them through `LOAD_FACTORY_PRESET` and applies explicit DSL parameters afterwards. |
| Reload lifecycle / leak regression | Implemented reference | Load awaits Plugin/AudioWorklet disposal before closing the prior AudioContext; 960 Plugin lifecycle cycles / 38,400 control queries verify stable WASM allocator/memory behavior. |
| Audio quality regression | Implemented reference | Representative offline WASM renders gate loudness, intersample peak, crest, DC, LF/spectral energy, stereo correlation/imbalance, dynamic range and section loudness difference; preset/aliasing/drum-noise tests are separate gates. |
| Plugin ABI 1.0 host surface | Implemented reference | Descriptor/control, configure, lifecycle, audio/event buses, sample-accurate parameter points, note events, state snapshot/load, latency/tail queries are wired. Optional host services not used by bundled plugins are not advertised. |

The player exposes no second or legacy realtime ABI. Plugin binaries and the browser host share Plugin ABI 1.0 directly.
