# Runtime architecture

## Pipeline boundary

The browser keeps compile-time work outside the audio thread:

```text
.soraoto source
  -> browser compiler
  -> Resolved Project IR
  -> browser Audio/Event Graph
  -> Plugin binding / fallback binding
  -> AudioWorklet + Web Audio runtime
```

Pattern/Macro/Component/source evaluation does not execute in AudioWorklet processing.

## Ownership

`src/js/app.js` owns transport/session orchestration and the current `AudioContext`.

`src/js/audio-graph.js` owns graph construction and the graph-level disposal contract.

`src/js/plugin-host.js` owns Plugin-backed AudioWorklet nodes.

`src/js/instrument-library.js` owns WebAudio fallback voices and standard-instrument resolution
helpers.

No lower layer closes the application-owned `AudioContext`.

## Realtime scheduling

Realtime playback uses incremental look-ahead scheduling. It must not eagerly create all future Web
Audio voice graphs for a long song.

The scheduler queue is pumped periodically and schedules only the near future. UI painting and meter
updates are intentionally slower than audio scheduling.

Exact timing constants are implementation parameters in `app.js`; the architectural invariant is
bounded incremental scheduling.

## Transport lifecycle

The UI exposes a single transport state at a time: stopped, busy/preparing, playing, or rendering/
exporting. Playback controls must not permit overlapping graph construction or two active transport
sessions.

Stop and project reload invalidate pending scheduler work before a replacement graph becomes active.

## Offline render

Offline render builds the same resolved graph semantics into `OfflineAudioContext`, schedules the
resolved events, renders, then disposes the graph. Browser WAV serialization is a separate final
step and is governed by the Web Player export specification.
