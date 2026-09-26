# Web Player instrument resolution

This is a Web Player product rule, not a portable soraotoDSL rule.

## Resolution order

For a pitched track:

1. an explicitly authored WASM Plugin instrument wins;
2. otherwise the Web Player resolves the track's authored instrument/name metadata to a bundled
   SuperSynth preset;
3. if the WASM instrument cannot be created, the legacy WebAudio pitched-instrument renderer is a
   resilience fallback.

For drum events:

1. the bundled Drum Machine Plugin is the primary path;
2. named drum lanes are lowered to the reference GM-style note mapping;
3. the legacy WebAudio drum renderer is fallback-only.

A fallback must not change the portable Project IR or be persisted as if the user had authored a
different Plugin.

## Preset resolution

The authoritative preset definitions live with the Plugin implementation:
`wasm/plugins/dsp/super-synth/presets.json`, its `interface.soraoto`, and the generated
`PluginDescriptorV1`.

Durable documentation must not duplicate the current SuperSynth generation number, parameter
count, or preset count. Those values are expected to evolve.

Typical standard-family mapping includes piano, electric piano, bass, guitar, strings, brass,
organ, wind, sax, vocal, harp, lead, pad, and pluck families. The exact resolver table is implemented
in `web-player/src/js/instrument-library.js` and must be updated together with this product
specification when externally observable mapping rules change.

## Explicit parameter precedence

Factory preset values are applied first. Explicit DSL parameter values are then applied and win.
