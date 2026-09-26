# soraotoDSL Web Player — Draft v0.5 executable reference subset

The browser compiler reports:

```text
Language       Draft v0.5
Component ABI  soraoto:component@1.0.0
Plugin ABI     1.0
```

## Canonical source syntax

Realtime WebAssembly is imported with `plugin`:

```text
import plugin SuperSynth from "../wasm/plugins/dsp/super-synth/plugin.wasm"
```

Draft v0.5 accepts only canonical `import plugin` for realtime plugins. No `import dsp` compatibility path exists.

Immutable compile-time bindings use `let`; `const` is a compile error:

```text
let ROOT = c4
let Kick4 = "x...x...x...x..."
let Riff = notes { @8: ROOT . +2 -2 }

notes {
  use Riff * 4
}
```


## Plugin Interface Source

Bundled SuperSynth v6 also exercises the latest declarative Plugin Interface Source profile:

```text
plugin interface SuperSynthV6 {
  abi: "1.0"
  id: "net.puchinya.soraotodsl.super-synth-v5"
  name: "SuperSynth v6"
  version: "6.0.0"
  kind: instrument
  control_modulation_max_quantum: 64
  ...
}
```

`wasm/plugins/dsp/super-synth/interface.soraoto` is normalized UTF-8/LF source and is embedded byte-for-byte as `soraoto.interface`; the build lowers the same declarations into the mandatory `soraoto.plugin.v1` runtime descriptor. Executable Project constructs are rejected from the interface subset.


Priority B reference support is implemented and SuperSynth 6 extends it: x4 FM/filter/saturation oversampling now supports cascaded 31-tap half-band decimation, the high-quality filter path uses a TPT state-variable filter with optional stereo L/R state, and acoustic-oriented models use digital-waveguide/modal-resonator processing with dedicated physical-model parameters. Preset-bearing bundled plugins use Plugin ABI factory presets/program lists and `LOAD_FACTORY_PRESET`, and deterministic audio-quality regression covers loudness/peak/dynamics/DC/spectral/stereo/section metrics plus preset, physical-model, filter and aliasing gates. Repeated project Load performs awaited graph/AudioWorklet/AudioContext teardown and is covered by allocator/lifecycle stress tests.

Priority A reference production support also includes the `ChannelStrip` Plugin (parametric EQ, compression, M/S width/balance), instrument-family Performance Compiler note expressions, and timeline automation for instrument parameters, stereo width/balance, send gains and named effect parameters.

## Pattern / Fragment

```text
pattern Motif(root: Pitch) -> NotesFragment {
  notes { @8: root . +2 -2 }
}

pattern Beat() -> DrumFragment {
  drums {
    @16:
    Kick  "x...x...x...x..." * 2
    Snare "....X.......X..." * 2
  }
}
```

Pattern callable metadata is retained as `PatternFn<Args, ResultFragment>`. Notes fragment expansion uses an isolated pitch/note-group cursor in the single Draft v0.5 compiler.

## Lyrics

```text
track Vocal {
  performance vocal { language: "ja-JP" }
  notes { @8: c4 d4 e4 g4 a4 g4, }
  lyrics { "き み _ . / こ{コ} | え" }
}
```

Supported mini-language:

```text
_  melisma continuation
.  note without lyric
/  word boundary
|  phrase boundary
surface{reading}
{reading}
```

Lyrics are aligned to note events, retained in Resolved Project IR, lowered to `soraoto-vocal-v1` browser events, and exported as MIDI lyric/marker meta-events where applicable.

## Existing executable areas

The v0.5 layer retains the existing browser implementation for Core Note DSL, Harmony, `follow`, BassRoot/WalkingBass/PianoVoicing/PadVoicing/Arpeggio/GuitarVoicing/GuitarStrum, deterministic drum humanize, Track/Bus/Master routing, Sidechain, StereoDelay, automation, modulation, MIDI and offline WAV.

The compiler keeps Source/Pattern/Macro/Component work on the compile-time side of the Resolved Project IR boundary; the AudioWorklet only receives resolved runtime events/audio graph state.

## ABI boundary

The portable specification fixes Component ABI `soraoto:component@1.0.0` and Plugin ABI `1.0`. The included realtime `.wasm` modules implement Plugin ABI 1.0 directly, including the embedded `soraoto.plugin.v1` descriptor, lifecycle, control plane, ProcessBlock, parameter points and realtime note events.

See `SPEC_COMPLIANCE.md` for exact execution coverage.
