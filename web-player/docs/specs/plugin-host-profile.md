# Web Player Plugin host profile

Portable Plugin semantics are defined by
`docs/specs/soraotoDSL/spec/03-plugin-model.md`,
`04-realtime-abi.md`, `05-plugin-services.md`, and `09-conformance.md`.

This document only defines the browser host profile.

## Discovery and metadata

- A hosted Plugin binary must contain exactly one mandatory `soraoto.plugin.v1` custom section.
- Runtime discovery uses Deterministic-CBOR `PluginDescriptorV1` from that section.
- `soraoto.interface` is optional portable authoring/inspection metadata. When present, the browser
  validates the supported interface subset against the runtime descriptor.
- No external `*.manifest.json` runtime metadata is fetched.
- Legacy realtime exports (`init`, `process`, `set_parameter`, `note_on`, `note_off`,
  `note_expression`, etc.) are rejected rather than adapted.

## Browser execution profile

Realtime Plugin processing uses AudioWorklet and therefore requires a secure context in deployed
use. Offline rendering uses the same Plugin ABI with offline processing when an
`OfflineAudioContext` is available.

The browser host advertises only capabilities it actually implements. Optional portable host
services that are not wired by the Web Player must not be advertised merely because they exist in
the portable specification.

## Preset/parameter ordering

When a track selects a factory preset:

1. resolve the authored preset name to a stable factory-preset ID;
2. load the factory preset through the Plugin ABI control plane;
3. apply explicit DSL parameter values after preset loading.

Explicit authored parameter values therefore win over preset defaults.

## Failure behavior

A Plugin that fails validation or initialization must not be partially treated as ABI-compatible.
Standard-instrument fallback behavior, when applicable, is defined in
`instrument-resolution.md`; it is a Web Player resilience feature, not a Plugin ABI rule.
