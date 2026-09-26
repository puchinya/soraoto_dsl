# Instrument runtime design

## Primary paths

Standard pitched tracks use the bundled SuperSynth Plugin unless the source explicitly names a
different WASM Plugin.

Drum tracks use the bundled Drum Machine Plugin as the primary runtime.

`instrument-library.js` retains WebAudio synthesis only as resilience fallback.

## Resolver boundary

The resolver consumes already-compiled track metadata. It does not change DSL parsing or portable
instrument semantics.

An explicitly authored WASM Plugin descriptor bypasses standard-family auto-resolution.

The resolver may use track instrument/name metadata to select a bundled preset. Changes to this
externally visible mapping require an update to
`../specs/instrument-resolution.md`.

## Fallback lifetime

Every WebAudio fallback voice is wrapped in a disposable voice root. The root disconnects when all
scheduled source nodes end and is force-disposed on Stop/project teardown.

Persistent WASM instruments are AudioWorklet nodes and therefore follow the Plugin-host disposal
path instead of per-note AudioNode lifetime.

## Versioned instrument data

Plugin implementation details belong beside the Plugin:

- `wasm/plugins/dsp/super-synth/interface.soraoto`
- `wasm/plugins/dsp/super-synth/descriptor.json`
- `wasm/plugins/dsp/super-synth/presets.json`
- Plugin source/tests

Design documentation must not duplicate rapidly changing generation numbers, parameter counts, or
preset counts.
