# Plugin host design

## Metadata path

`src/js/plugin-host.js` validates the mandatory `soraoto.plugin.v1` section and decodes
`PluginDescriptorV1` before creating a processing node.

If `soraoto.interface` is present, `src/js/plugin-interface.js` validates the browser-supported
authoring subset and checks overlapping descriptor fields. Runtime truth remains
`soraoto.plugin.v1`.

The browser does not use an external manifest as a second source of runtime truth.

## Worklet boundary

Realtime Plugin execution is isolated in `src/worklets/soraoto-plugin-processor.js`.

The main thread is responsible for:

- fetching/caching the WASM module;
- static validation;
- selecting active buses and configuration;
- creating the AudioWorkletNode;
- converting authored parameter values to normalized Plugin values;
- sending note, note-expression, parameter, reset, transport-origin and disposal messages.

The Worklet owns the realtime Plugin instance and Plugin ABI process calls.

## Preset initialization

The main-thread host computes initial authored values, requests the selected factory preset, then
re-sends explicit parameter values after preset loading. This preserves the required
preset-first/explicit-values-second ordering.

## Disposal

`node.dispose()` is asynchronous. It requests Worklet disposal and resolves after an explicit
`disposed` acknowledgement, with a bounded fallback timeout so a broken Worklet cannot permanently
block teardown.

Application-level reload/Stop waits for graph disposal before closing the owning `AudioContext`.

## Cache scope

Plugin module cache keys include the publication/build identity and Plugin URL. A failed fetch or
validation must evict the failed cache entry rather than poison future loads.
