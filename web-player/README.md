# soraotoDSL Web Reference Player

Browser reference implementation and test player for the current **soraotoDSL Draft v0.5** design.

It is no longer only a note parser. The current build exercises the pipeline through Harmony/Pattern/Instrument Performance, Resolved Project IR, Audio Graph, realtime WASM DSP, MIDI export and offline WAV rendering.

## Run

Use HTTP. `file://` is not sufficient because songs, WASM modules and AudioWorklet code are fetched as resources.

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

The Node development server serves source files without caching and maps `/wasm/...` URLs to the CMake output at `build/wasm/...`.

Create deployment files with `npm run build`. This configures and builds the WASM plugins with CMake, then writes the complete static site to `dist/`. Run `npm run preview` to serve that output locally.

For deployed realtime WASM DSP, serve the site over HTTPS.

## SPA layout

```text
package.json             # dev, build, and preview commands
index.html               # SPA entry point
src/
  js/
    compiler.js        # single Draft v0.5 compiler
    plugin-cbor.js     # deterministic CBOR for Plugin ABI control plane
    plugin-host.js     # Plugin ABI 1.0 validator/AudioWorklet host
    audio-graph.js     # Track/Bus/Master graph and standard effects
    midi-export.js     # SMF Type 1
    wav-export.js      # PCM WAV encoder
    instrument-library.js
    app.js             # UI, scheduler, playback/render
  worklets/
    soraoto-plugin-processor.js
public/
  songs/                  # static song catalog and source files
docs/                     # Markdown documentation
scripts/                  # Node build and development server
tests/                    # Node-based tests
dist/                     # generated site, including songs and CMake-built WASM
```

## Plugin ABI 1.0 WASM included

```text
wasm/
  CMakeLists.txt
  cmake/
    wasm32-clang.cmake
    wasm_plugin.cmake
    generate_plugin_metadata.py
    super_synth_metadata.py
    append_custom_sections.py
  plugins/
    effects/<name>/{CMakeLists.txt,descriptor.json,src/,test/}
    dsp/<name>/{CMakeLists.txt,descriptor.json,src/,test/}
    dsp/super-synth/{presets.json,interface.soraoto}
  shared/
    plugin_abi_runtime.h
  test/                  # shared WASM plugin tests
build/wasm/plugins/<group>/<name>/plugin.wasm
```

All bundled binaries use soraotoDSL **Plugin ABI 1.0 directly**. Each plugin keeps its descriptor as JSON beside its source and tests. CMake converts the JSON to CBOR and embeds it in the mandatory `soraoto.plugin.v1` custom section; generated headers, CBOR files, and `.wasm` binaries go under `build/wasm/`. SuperSynth's `presets.json` and `interface.soraoto` are also read during the build. There are no external plugin manifests and no legacy DSP ABI.

See [`DSP_ABI.md`](docs/DSP_ABI.md).

Build all plugins from the repository root with:

```bash
cmake -S wasm -B build/wasm -DCMAKE_TOOLCHAIN_FILE="$PWD/wasm/cmake/wasm32-clang.cmake"
cmake --build build/wasm
ctest --test-dir build/wasm --output-on-failure
```

## Draft v0.5 features exercised

- Core Note DSL and strict bar commit
- structure / section-relative content
- Harmony Timeline, Roman/Nashville/slash chords
- follow + harmony-derived bass/piano/guitar/pad/arp
- immutable `let`, NotesFragment/DrumFragment and PatternFn expansion with provenance
- Lyrics DSL and `soraoto-vocal-v1` lowering
- canonical `import plugin` only
- deterministic humanize
- instrument performance IR
- audio clips (basic trim/gain/fades)
- Track / Bus / Master graph
- stereo balance/width
- Sidechain
- StereoDelay including ping-pong/independent L/R/feedback filter
- routing/send
- automation and LFO modulation
- tempo/meter maps in IR and MIDI
- master effects
- offline WAV render
- MIDI / GarageBand-import MIDI

The exact status, including spec-defined open ABI areas, is in [`SPEC_COMPLIANCE.md`](docs/SPEC_COMPLIANCE.md).

## Server-side songs

Songs are not embedded in HTML. The player fetches `songs/index.json`, then fetches the selected `.soraoto` file.

The catalog includes the four longer J-POP samples, Harmony/Export labs, and the Draft v0.5 conformance fixture, which is the main end-to-end regression fixture.

## Controls

- **Compile** — Source → Resolved Project IR
- **Play / Stop** — realtime WebAudio playback
- **Export MIDI** — Standard MIDI File Type 1
- **GarageBand MIDI** — multi-track MIDI for GarageBand import
- **Render WAV** — OfflineAudioContext render using the `render` declaration where present
- **M / S** — per-track mute/solo
- **Ctrl/Cmd + Enter** — compile + play

## Verification

Run:

```bash
node tests/draft-v05.test.js
node ../wasm/test/plugin-abi.test.js
node tests/all-songs.test.js
node tests/wav-export.test.js
```

Syntax-check all JavaScript with `node --check` as part of the release verification.


## iPhone / WASM audio stability fix

The AudioWorklet host reserves DSP I/O scratch memory **after the module's current linear-memory image**. This is required because DSP modules can own large static regions (StereoDelay uses multi-megabyte feedback rings). Fixed-address scratch memory can overlap those regions and cause audible noise/corruption.

The reference player now uses a production-oriented final stage after the DSL-defined master chain: 24 Hz subsonic high-pass, gentle 1.5:1 glue compression, requested master gain, and the `master-limiter` Plugin with look-ahead true-peak control. The old fixed ×0.50 master attenuation and 12:1 safety compressor were removed.

## Instrument Library v5

Standard pitched instruments route through **WASM SuperSynth v6** by default. Explicit WASM instruments still take precedence; the older WebAudio pitched palette remains only as a Plugin-load fallback. Standard drum events now route through **WASM Drum Machine** using the standard `soraoto-note-v1` event bus and a GM-style pitch mapping; the former WebAudio drum renderer is fallback-only.

SuperSynth v6 remains 32-voice polyphonic and ships 50 factory presets / 73 Plugin ABI parameters. It retains the wavetable engine and upgrades the acoustic-oriented `pluck`, `hammer`, `bowed`, `breath`, and `vocal` models with digital-waveguide/modal resonators, sympathetic/body resonance, bow-pressure and formant/vowel controls. Piano, guitar/harp, strings, wind/brass and vocal presets use those physical-model controls rather than relying only on wavetable/filter differences.

`Soraoto Reverb` adds Room / Plate / Hall / Chamber / Ambience presets. The 18 modern sample songs now use a `Space` bus with post-fader sends so reverb is shared as mix space instead of inserted independently on every track.

Preset source-of-truth and instrument routing are documented in `docs/INSTRUMENTS.md`.

## Transport state and clipping protection

The player uses an explicit transport/UI state machine:

- **Stopped**: Play is enabled, Stop is disabled.
- **Compiling / Loading / Preparing / Rendering / Exporting**: source editor and relevant controls are disabled and a visible busy overlay is shown.
- **Playing**: Play/Compile/source selection/editor are disabled and only Stop is enabled.
- **Playback finished / Stop**: controls return to the Stopped state.

Mute/Solo are intentionally locked during playback because this reference scheduler resolves track activity before scheduling audio.

Dense arrangements use conservative source levels and per-track/bus peak guards. The master no longer applies an unconditional 6 dB attenuation; the final Plugin limiter controls accidental peaks while preserving section-to-section dynamics. Live meters expose RMS, peak, momentary LUFS-like level and an accumulated integrated-LUFS estimate; deterministic offline regression is performed from rendered PCM.


## Playback diagnostics and scheduler

Playback now exposes live RMS/peak meters for every playable track, bus, and the master output. A red `CLIP` latch is held for 1.8 seconds whenever the measured post-guard peak reaches approximately 0 dBFS.

The playback audit also fixed several runtime issues:

- the modern `instrument-library.js` was present but not connected to the realtime playback path; realtime playback now actually uses those presets
- realtime music events are scheduled with an 50 ms look-ahead pump and a 0.85 second horizon instead of creating thousands of future AudioNodes at Play time
- audio clips are preloaded before the transport epoch is chosen, preventing slow fetch/decode from making their start times fall into the past
- effect/instrument tails are allowed to decay after the musical timeline ends instead of being cut immediately
- the playhead stops at the end of the musical timeline while the transport shows `Tail` during the decay interval
- WASM instruments receive an explicit reset/dispose on Stop
- bus gain is now actually applied in the audio graph
- audio clips now respect their owning track gain
- the master ends in the look-ahead `master-limiter` Plugin, with a native limiter/waveshaper only as a load-failure fallback


### Additional playback audit fixes

- unknown/structural Audio Graph nodes are now true pass-through nodes; the old fallback accidentally connected a GainNode to itself, creating a zero-delay feedback cycle
- structural `stereo` / `automation` / `modulation` blocks are filtered out of the insert-effect chain
- `Gain { gain: -Ndb }` now converts dB to linear gain correctly
- mobile realtime scheduling uses a 0.85 second look-ahead while keeping node creation incremental
- the WASM instrument event queue is sorted only after new events arrive, rather than on every 128-frame render quantum

## SuperSynth v6 synthesis engine

The published synthesizer is `wasm/plugins/dsp/super-synth/plugin.wasm`. It is a direct **Plugin ABI 1.0** module, not the earlier reference-DSP ABI.

SuperSynth v6 provides:

- 32 polyphonic voices and up to 8-way stereo unison
- two 8-frame procedural wavetable oscillators with 7 band-limited mip levels
- wavetable morphing, phase warp/PWM-style remap, FM/phase modulation and ring blending
- sub oscillator plus colored noise
- independent amp/filter ADSR and per-voice resonant low/band/high-pass filtering
- standard per-note pitch, pressure, timbre, volume and pan expression IDs
- selectable 1× / 2× / 4× internal oversampling; FM, resonant filtering and nonlinear saturation run in the oversampled domain; x2/x4 can use a 31-tap half-band anti-alias decimator (x4 uses two cascaded stages); stereo chorus and output width
- legacy filter plus a TPT state-variable filter, with optional independent L/R filtering for high-quality stereo presets
- physical-model controls: excitation hardness, string damping, sympathetic resonance, body resonance, bow pressure, formant shift and vowel morph
- 63 stable 1-based Plugin ABI parameters and 50 normative Plugin ABI factory presets/programs loaded with `LOAD_FACTORY_PRESET`
- six engine models: wavetable, pluck/resonator, hammer/resonator, bowed/ensemble, breath/formant and vocal/formant
- per-voice LFO phase, random drift, age motion, timbre spread, pan spread and model-dependent resonator/formant state

The WASM embeds the mandatory deterministic-CBOR `soraoto.plugin.v1` descriptor and one normalized UTF-8 `soraoto.interface` section. The latter is source-level authoring/inspection metadata; runtime discovery remains `soraoto.plugin.v1`. No external manifest is fetched.

### Priority A production path

The production path now includes `wasm/plugins/effects/channel-strip/plugin.wasm`, a 19-parameter track processor with HPF/LPF, three parametric EQ bands, compressor, makeup gain, M/S width, balance and wet mix. The Performance Compiler lowers instrument-family and articulation context into per-note pitch, pressure, timbre, volume and pan expression curves. Project automation can target instrument parameters, stereo width/balance, send levels and named effect parameters.

Plugin-backed tracks use the graph stereo stage for authored `pan`, and the WebAudio fallback path suppresses duplicate instrument-level panning. Public non-Chopin songs also declare genre-appropriate Drum Machine kits instead of falling through to the default studio kit.


### Priority B quality / preset path

SuperSynth 6 keeps selectable 4× oversampling for alias-sensitive FM, high-resonance filtering and saturation, and replaces simple box decimation with a 31-tap half-band FIR option. The half-band regression measures ~0.999 passband magnitude at normalized 0.20, ~0.5 at the half-band edge and about -57 dB stop-band magnitude at normalized 0.35. Physical-model and TPT-filter sweeps are also regression-tested across low-to-high note ranges.

Preset management now uses Plugin ABI `factory_presets`, `program_lists`, `GET_PROGRAM_INFO` and `LOAD_FACTORY_PRESET` as the normative runtime path. `presets.json` remains the authoring source of truth for SuperSynth, while explicit DSL parameters are still applied after the factory preset and therefore win. Reverb, Drum Machine and ChannelStrip use the same formal preset path; the former private embedded value tables are no longer required.

Drum Machine has also been retuned to avoid broadband-noise-heavy hats/cymbals: hats and cymbals are metallic-partial dominated, snare/clap noise is band-limited, and all five kits now affect the full drum timbre rather than mostly the kick.

### Load/reload lifecycle stability

Repeated song loads now perform an awaited teardown before fetching/compiling the next song: scheduler queues/timers and fallback voices are stopped, Plugin graphs wait for the AudioWorklet `disposed` acknowledgement, the old `AudioContext` is closed, and decoded/pluck/noise caches are released. AudioWorklet initialization temporary allocations are protected with `finally` cleanup so failed initialization cannot strand WASM allocator blocks. A lifecycle stress test runs all eight bundled plugins through 120 complete init/configure/query/activate/deactivate/terminate cycles each (960 cycles / 38,400 control queries) and asserts stable allocator addresses and no WASM linear-memory growth.

### Audio quality regression

The CI-style Node regression renderer uses the same bundled WASM instruments to synthesize representative sections from J-POP, Anime, Game Battle, Game Field, Techno and Jazz. It measures integrated-LUFS-style loudness, 4× intersample true-peak estimate, crest factor, DC, low-frequency energy, spectral balance, stereo correlation/imbalance, short-window dynamic range and section loudness differences. All 50 SuperSynth factory presets are separately checked for finite/non-silent output, safe peak, DC and stereo imbalance; the x4 aliasing regression and drum broadband-noise regression are independent gates.

## Relative-note sample writing

The musical demos intentionally use soraotoDSL relative pitch notation in normal melodic writing. Each bar generally starts from an absolute anchor such as `c#5`, then continues with semitone movement:

```text
c#5 +3 +2 +3 -1 -2 -2 _ ,
```

`+` and `-` are one-semitone moves; `+n` and `-n` move by `n` semitones. The absolute anchor at the beginning of a bar keeps the source readable while still demonstrating cursor-based melody writing.

Two additional original demos explore broad contemporary J-pop production directions without copying any specific artist or song:

- **Afterimage Protocol** — high-speed, story-driven electropop with dense sixteenth-note motion, sub bass, pluck arpeggios and rapid melodic contour.
- **Prism Parade** — colorful theatrical pop-rock with piano/guitar/organ layers, borrowed harmony and wide melodic leaps.


## Long-playback stability

A long-playback slowdown on mobile was traced to the lifetime of Web Audio voice subgraphs. Oscillator/BufferSource nodes stopped correctly, but the per-note Filter/Gain/Panner graph remained connected to the track bus. Dense songs could therefore accumulate thousands of silent nodes.

The realtime player now:

- places every Web Audio note/drum voice behind a per-voice root GainNode
- disconnects that root as soon as all scheduled source nodes in the voice have ended
- force-disposes remaining voice roots on Stop and natural playback completion
- reduces the realtime look-ahead window from 2.5 s to 0.85 s
- pumps the scheduler every 50 ms
- throttles timeline painting to about 15 Hz and level meters to about 10 Hz so UI work does not compete with audio on iPhone

WASM instruments remain persistent AudioWorklet voices and do not create per-note AudioNodes.


## Vocal-oriented sample melodies

The six musical demos now use vocal-oriented lead lines rather than continuous instrumental eighth-note runs.

The lead-writing rules used in the demos are:

- phrases are normally 2–4 bars long
- `~` is used for held syllables and phrase endings
- `_` creates explicit breathing space
- verses stay in a narrower/lower register
- pre-choruses climb in register and tension
- choruses repeat recognizable interval/melodic motifs
- final choruses expand the same hook rather than replacing it with unrelated notes
- relative pitch (`+`, `-`, `+n`, `-n`) remains the normal notation after each bar's absolute anchor

The samples intentionally contain melody only; no artist lyrics or copied vocal lines are included.


## Production-style compact sample notation

The six musical demos are intentionally written as concise DSL examples rather than generated event dumps.

They now demonstrate:

- `( ... ) * N` for repeated 2- or 4-bar vocal motifs
- comma-only bars (` , `) for a completely silent measure
- `.` for retriggering the current note/group
- `~` for held vocal syllables
- `+`, `-`, `+n`, `-n` for relative melodic movement
- dynamic aliases such as `!mp:`, `!mf:`, `!f:`, and `!ff:`
- `articulation staccato { ... }` for short counter-hook figures
- Harmony-derived bass, piano, guitar, pad and arpeggio parts instead of spelling every backing note manually

The arrangement also leaves intentional holes around the lead. CounterHook is generally silent during verses and answers the vocal only in selected pre-chorus/chorus bars, making the demos closer to a produced pop arrangement than a syntax stress test.


## Mobile-first player UI

The player has a dedicated phone layout rather than shrinking the desktop toolbar.

On screens up to 850 CSS px:

- song selection stays at the top with a large Load target
- Mixer is the default view
- Source and Tools are explicit tabs, so the code editor and export controls do not crowd playback
- Play and Stop live in a fixed bottom transport bar with iPhone safe-area padding
- transport controls use large touch targets
- the source editor uses 16 px text to avoid iOS focus zoom
- the timeline uses a compact label margin/font at phone widths
- track cards reflow vertically with large Mute/Solo targets and full-width meters
- Timeline and meter drawing remain throttled to protect realtime audio performance
- busy work still locks playback/edit controls and presents a blocking progress overlay


## Public sample catalog v2

The visible player catalog was replaced with 22 concise, production-oriented samples:

- 4 × contemporary J-POP originals
- 4 × anime-song originals
- 2 × game battle originals
- 2 × game field / exploration originals
- 4 × techno originals
- 2 × jazz originals
- 4 × works composed by Frédéric Chopin

The original modern-genre samples are not copies of specific artists or songs. They use broad current production vocabulary—hybrid acoustic/electronic arrangements, vocal-space-aware counter lines, sidechain, modern synth presets, concise motifs, repeated DSL phrases and section dynamics.

The `Chopin` category contains the complete works, not shortened sketches: Preludes Op. 28 Nos. 4, 7 and 20, plus the Waltz in A minor B. 150. Pitch, rhythm, harmony, polyphonic voices and the written form are carried through to the end of each score; the B. 150 repeats are unfolded for full playback.

The public Song selector is grouped by category. Older development/demo songs remain in the repository only as regression fixtures and are no longer listed in `songs/index.json`.


### Browser load stress

Serve the WebPlayer and open `tests/browser-load-stress.html`. It runs 20 real `Load → Play → Stop` cycles across modern sample songs, requires `SoraotoPluginHost.stats().liveNodeCount` to return to zero after every stop/load boundary, and surfaces any preparation/load errors. This complements the Node/WASM lifecycle stress test; it must be run in a normal browser environment because some managed/headless environments block local pages.
