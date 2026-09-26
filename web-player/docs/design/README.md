# Web Player design

These documents describe implementation architecture. They do not define portable soraotoDSL or
Plugin ABI semantics.

| Topic | Document |
|---|---|
| Compiler/runtime boundary, audio graph, scheduling and transport | [`runtime-architecture.md`](runtime-architecture.md) |
| Plugin discovery, validation, AudioWorklet hosting and disposal | [`plugin-host-design.md`](plugin-host-design.md) |
| Standard instrument resolver and fallback architecture | [`instrument-runtime-design.md`](instrument-runtime-design.md) |
| Teardown, regression strategy and quality verification | [`lifecycle-quality-design.md`](lifecycle-quality-design.md) |

When a design rule becomes externally observable product behavior, update the corresponding
`../specs/` document. When it becomes portable behavior, update the owning normative specification
instead.
