# Web Reference Player support profile

## Version axes

The browser reference player targets:

- Language: soraotoDSL Draft v0.5
- Component ABI: `soraoto:component@1.0.0`
- Plugin ABI: `1.0`

These axes are independent. A change to one does not implicitly change the others.

## Supported profile

| Area | Web Player contract |
|---|---|
| Canonical realtime Plugin import | `import plugin`; browser compilation rejects the legacy `import dsp` spelling |
| Core Note DSL | Supported reference path |
| Harmony, `follow`, and built-in harmony-derived generators | Supported reference path |
| `let`, NotesFragment/DrumFragment, PatternFn | Supported reference path |
| Lyrics DSL and vocal Performance IR lowering | Supported reference path |
| Track/Bus/Master graph, sends and sidechain | Supported reference path |
| Automation/modulation used by the reference songs | Supported reference path |
| Standard Sidechain/StereoDelay components | Supported |
| Arbitrary user macro bodies | Profile-limited; metadata is retained but the lightweight browser compiler does not execute every arbitrary macro body |
| Arbitrary third-party JavaScript Components | Not a general browser-hosted capability; only the reference/standard component path is supported |
| General WASM Component Model loading | Not hosted by the Web Player |
| WASM Plugin ABI 1.0 | Supported for the browser host profile described in `plugin-host-profile.md` |
| Native/VST plugin hosting | Not hosted in the browser |
| MIDI/GarageBand/WAV export | Supported subject to `export-behavior.md` and the deviations below |

Compile-time DSL/Pattern/Macro/Component work must remain on the compile side of the Resolved Project
IR boundary. AudioWorklet processing receives only resolved runtime state/events.

## Known conformance gaps

This section records implementation deviations; it does not redefine the portable specification.

### MIDI

Current `src/js/midi-export.js` uses fixed PPQ 480. Portable §52.6 defines a configurable
`MidiExportV1.ppq` with default 960.

Current pitch-bend setup clamps RPN pitch-bend sensitivity to 24 semitones and uses one MIDI channel
per non-drum track. Portable §52.8 defines MPE behavior for fractional/per-note expression and a
default ±48-semitone MPE bend range.

Current lyric export emits browser-specific lyric/melisma/phrase metadata that is not yet an exact
implementation of every §52.8.1 rule.

### WAV

Current `src/js/wav-export.js` emits stereo-or-mono RIFF PCM at 16 or 24 bit. It does not implement
the full portable §52 WAV contract such as 32-bit float output, RF64/WAVE_FORMAT_EXTENSIBLE,
deterministic TPDF dither, arbitrary channel layouts, or the normative -1 dBFS normalization rule.

### `soraoto.interface`

The browser validator supports the declarative subset required by bundled plugins. It is not a
complete compiler for every construct permitted by the portable Plugin Interface Source grammar.

These gaps require implementation follow-up. Documentation restructuring must not silently convert
current browser behavior into portable normative behavior.
