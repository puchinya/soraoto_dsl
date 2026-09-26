# soraotoDSL normative specification

This directory is the single normative specification set for the soraotoDSL language, Project/DAW
model, compile-time Components, realtime/offline WASM Plugins, interchange, and conformance.

Start at [`soraotoDSL.md`](soraotoDSL.md), then open only the owning module.

| Area | Normative source |
|---|---|
| Core language, Harmony, Pattern, Macro, grammar and types | [`spec/01-language.md`](spec/01-language.md) |
| Compile-time JS/WASM Components and Component ABI | [`spec/02-component.md`](spec/02-component.md) |
| WASM Plugin package, descriptor, authoring interface, control plane, parameters and lifecycle | [`spec/03-plugin-model.md`](spec/03-plugin-model.md) |
| Realtime Plugin ABI and deterministic CBOR wire schema | [`spec/04-realtime-abi.md`](spec/04-realtime-abi.md) |
| Plugin state/services, adapters, compatibility and semantic ownership | [`spec/05-plugin-services.md`](spec/05-plugin-services.md) |
| Project/DAW model, graph, routing, automation, assets and export | [`spec/06-project-audio.md`](spec/06-project-audio.md) |
| Instrument performance, Lyrics, Drum DSL and Performance IR | [`spec/07-performance.md`](spec/07-performance.md) |
| Clipboard and drag/drop interchange | [`spec/08-interchange.md`](spec/08-interchange.md) |
| Validation, conformance and completeness | [`spec/09-conformance.md`](spec/09-conformance.md) |

## Plugin specification

The Plugin specification is not a Web Player specification.

The portable Plugin contract is owned by:

1. `spec/03-plugin-model.md` — package/discovery, `soraoto.plugin.v1`, optional
   `soraoto.interface`, descriptor/control/parameter/lifecycle semantics.
2. `spec/04-realtime-abi.md` — fixed realtime memory/wire structures and deterministic CBOR.
3. `spec/05-plugin-services.md` — state, preset/program services, compatibility, host services,
   external adapters and cross-cutting consistency.
4. `spec/09-conformance.md` — binary/control/realtime validation requirements.

A browser, native host, DAW adapter, plugin implementation, example, or test fixture may implement a
subset, but it must not create an alternate Plugin ABI definition.

## Editing rules

- Edit only the module that owns the semantic rule.
- Cross-module references use the shared `§N.M` section numbering.
- A product-specific limitation belongs in that product's specification, not here.
- Implementation details belong in design/source code.
- Tests are executable evidence, not an alternate specification.
- No combined snapshot is maintained. The split files are authoritative.
