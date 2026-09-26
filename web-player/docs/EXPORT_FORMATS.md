# Export formats

## Standard MIDI (.mid)

The player exports Standard MIDI File **Format 1**.

- PPQ: 480
- tempo/meta track
- one MIDI track per non-empty soraotoDSL track
- track names
- tempo and 4/4 time signature
- note on/off and velocity
- General MIDI program changes
- General MIDI percussion on channel 10
- initial track gain -> CC7
- initial track pan -> CC10

## Automation

Known automation targets are exported as standard MIDI CC:

- `gain` / `volume` -> CC7
- `pan` -> CC10
- `expression` -> CC11
- `modulation` / `mod` -> CC1
- `sustain` -> CC64

Unknown automation targets are preserved as MIDI Text Meta Events.

## Generic CC

```text
cc {
  1: "0:0 4:64 8:127"
  74: "0:20 8:100"
}
```

The first number is the MIDI CC number (0..127). Curve values are 0..127.

## Pitch bend

```text
pitch_bend {
  range: 2
  curve: "0:0 3.75:1 4:0 7.75:-1 8:0"
}
```

`range` and curve values are semitones.

Export writes:

- RPN 0,0 (Pitch Bend Sensitivity)
- 14-bit MIDI Pitch Bend events

## Guitar string/fret identity

```text
guitar {
  tuning: "E2 A2 D3 G3 B3 E4"
  tab {
    @8:
    s6:3 s5:2 [s6:3 s5:2 s4:0 s3:0 s2:0 s1:3]
  }
}
```

Performance IR retains:

- `stringIndex`
- `fret`
- sounding MIDI pitch

Standard MIDI has no universal fret-number event, so the sounding note is exported normally and soraotoDSL also writes a Text Meta Event at the note start:

```text
soraotoDSL:guitar:string=6;fret=3;pitch=43
```

This makes exact string/fret information available for a future soraotoDSL MIDI round-trip importer. Other DAWs can ignore the metadata while still playing the standard MIDI note.

## GarageBand MIDI

`GarageBand MIDI` exports the same multi-track Standard MIDI data with the GarageBand import track-count guard.

Workflow:

```text
soraotoDSL
  -> GarageBand MIDI (.mid)
  -> Files / iCloud Drive
  -> GarageBand import
  -> Save as a native GarageBand project
```

A native `.band` package is not generated because it is a GarageBand-managed project package rather than a documented MIDI interchange format.

GarageBand may discard optional Text Meta Events during import. Notes, timing, velocity, CC and pitch-bend data remain standard MIDI events.

## Web player playback

The Web Audio test player also applies:

- gain / volume automation
- pan automation
- expression
- CC7 / CC10 / CC11
- CC74 as synth/filter brightness
- Pitch Bend
- Sustain / CC64
- Modulation / CC1 as synth vibrato

## Outside Standard MIDI

The following are not serialized into `.mid` because they are not MIDI event types:

- audio waveform clips
- WebAudio effect-graph topology/state
- plugin instances/state
- browser synth implementation internals

## Offline WAV render

The `Render WAV` toolbar action executes the compiled Audio Graph through `OfflineAudioContext` and encodes PCM WAV in the browser.

When a declaration exists, the first WAV render supplies the format settings:

```text
render Main {
    format: wav
    sample_rate: 48khz
    bit_depth: 24bit
    normalize: false
}
```

Supported encoder depths are 16-bit and 24-bit PCM. `normalize` is applied by the WAV encoder. Realtime graph features with a native fallback remain renderable when an OfflineAudioContext cannot instantiate AudioWorklet.

`render Stems { tracks: [...] }` is preserved in Resolved Project IR; the current toolbar exports the full mix rather than automatically producing one file per selected stem.

## Draft v0.5 Audio Graph data and MIDI

Audio Graph topology, WASM effect instances, sends, sidechain edges and plugin-specific state are not representable as Standard MIDI and therefore are not written into `.mid`. Musical timing/control data that has a MIDI representation is exported:

- note on/off + velocity
- tempo map (including sampled ramps)
- meter map
- CC automation
- 14-bit pitch bend + RPN bend range
- GM percussion
- guitar string/fret provenance as text meta events
- lyrics as MIDI lyric meta events (`0x05`) and phrase markers (`0x06`)

The full graph remains available in `resolvedProjectIR` for native/plugin adapters.
