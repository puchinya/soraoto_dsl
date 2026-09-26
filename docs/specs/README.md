# Specification index

`docs/specs/soraotoDSL/` is the normative public contract for soraotoDSL. The root specification and its numbered modules form one specification: section references are shared across file boundaries.

## Choose a module

| Question | Specification |
|---|---|
| Language syntax, types, expressions, diagnostics, and core DSL | [`soraotoDSL/spec/01-language.md`](soraotoDSL/spec/01-language.md) |
| Compile-time and external components | [`soraotoDSL/spec/02-component.md`](soraotoDSL/spec/02-component.md) |
| WASM plugin descriptors and control plane | [`soraotoDSL/spec/03-plugin-model.md`](soraotoDSL/spec/03-plugin-model.md) |
| Realtime ABI and wire schemas | [`soraotoDSL/spec/04-realtime-abi.md`](soraotoDSL/spec/04-realtime-abi.md) |
| Plugin state, services, and compatibility | [`soraotoDSL/spec/05-plugin-services.md`](soraotoDSL/spec/05-plugin-services.md) |
| Projects, DAW model, audio graph, and rendering | [`soraotoDSL/spec/06-project-audio.md`](soraotoDSL/spec/06-project-audio.md) |
| Instrument performance, lyrics, and drum DSL | [`soraotoDSL/spec/07-performance.md`](soraotoDSL/spec/07-performance.md) |
| Clipboard and drag-and-drop interchange | [`soraotoDSL/spec/08-interchange.md`](soraotoDSL/spec/08-interchange.md) |
| Conformance, validation expectations, and completeness | [`soraotoDSL/spec/09-conformance.md`](soraotoDSL/spec/09-conformance.md) |

Use [`soraotoDSL/soraotoDSL.md`](soraotoDSL/soraotoDSL.md) for the root model, source-of-truth rules, shared semantic ownership, and links across the modules. `soraotoDSL/soraotoDSL-full.md` is the generated full snapshot; edit the root or owning module instead of editing the snapshot directly.

## Authority and maintenance

When rules conflict, follow the normative-priority section in the root specification and report contradictory normative rules as a specification defect. Do not use examples, implementation behavior, or Web Player documentation to decide a missing public rule.

The root specification's `Maintenance` section describes the spec validator and full-snapshot builder. Confirm those tools are present in the current checkout before claiming validation or regeneration succeeded; the current repository checkout does not contain the referenced scripts.

For request scope and Issue phases, see [`../agent-workflow/README.md`](../agent-workflow/README.md). For runtime implementation details, use the relevant documents under [`../../web-player/docs/`](../../web-player/docs/) while keeping this specification authoritative for intended behavior.
