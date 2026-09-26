# soraotoDSL Web Player — Plugin ABI 1.0

This player hosts realtime WebAssembly extensions using **soraotoDSL Plugin ABI 1.0 only**. There is no legacy browser DSP ABI and no external `*.manifest.json` runtime metadata.

## Binary metadata

Every bundled Plugin WASM contains exactly one mandatory custom section:

```text
soraoto.plugin.v1
```

containing Deterministic-CBOR(`PluginDescriptorV1`). `GET_DESCRIPTOR` must return byte-identical descriptor bytes.

SuperSynth v6 additionally contains exactly one optional authoring/inspection section:

```text
soraoto.interface
```

whose payload is the normalized bytes of `wasm/plugins/dsp/super-synth/interface.soraoto`. It does **not** replace `soraoto.plugin.v1`; the build validates and lowers the interface source into the runtime descriptor.

## Required exports

```text
memory
soraoto_plugin_abi_version
soraoto_plugin_init
soraoto_plugin_terminate
soraoto_alloc
soraoto_free
soraoto_plugin_control
soraoto_plugin_activate
soraoto_plugin_deactivate
soraoto_plugin_start_processing
soraoto_plugin_stop_processing
soraoto_plugin_process
soraoto_plugin_reset
soraoto_plugin_state_snapshot
soraoto_plugin_state_load
soraoto_plugin_latency_samples
soraoto_plugin_tail_samples
```

Legacy exports such as `init`, `set_parameter`, `note_on`, `note_off`, `note_expression`, and `process(frames, ...)` are rejected by `js/plugin-host.js`.

## Realtime wire structures

```text
SoraotoProcessBlockV1       176 bytes
SoraotoProcessContextV1     192 bytes
SoraotoAudioBusBufferV1      32 bytes
SoraotoParameterPointV1      24 bytes
SoraotoRealtimeEventV1       64 bytes
```

Parameter IDs are stable Plugin-local UInt32 values in the specification-valid range `1..0xffff_fffe`; ID 0 is not used. AudioBus/EventBus IDs share one Plugin-global bus namespace and therefore never collide inside one descriptor.

Numeric parameter changes cross the realtime boundary as normalized `0..1` values. `js/plugin-host.js` performs type/scale conversion from `ParameterDescriptor`, including discrete Bool/Int/Enum handling and logarithmic Float scaling.

## Included Plugins

```text
build/wasm/plugins/effects/gain/plugin.wasm
build/wasm/plugins/effects/stereo-delay/plugin.wasm
build/wasm/plugins/effects/channel-strip/plugin.wasm
build/wasm/plugins/effects/sidechain/plugin.wasm
build/wasm/plugins/effects/reverb/plugin.wasm
build/wasm/plugins/effects/master-limiter/plugin.wasm
build/wasm/plugins/dsp/drum-machine/plugin.wasm
build/wasm/plugins/dsp/super-synth/plugin.wasm
```

All eight use Plugin ABI 1.0 directly. SuperSynth v6 exposes 73 stable parameters, 50 factory presets, standard `soraoto-note-v1` input and standard note-expression IDs. Its high-quality path includes 1×/2×/4× oversampling with optional 31-tap half-band decimation, TPT state-variable filtering with optional L/R-independent state, and physical-model controls for waveguide/modal/resonator engines.

## Lifecycle

```text
Created
  -> soraoto_plugin_init(0x00010000)
Initialized
  -> CONFIGURE
Configured
  -> soraoto_plugin_activate()
Active
  -> soraoto_plugin_start_processing()
Processing
  -> soraoto_plugin_process(SoraotoProcessBlockV1*)
```

Shutdown reverses processing/activation and ends with `soraoto_plugin_terminate()`.
