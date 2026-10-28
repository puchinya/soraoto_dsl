# Documentation guide

This directory contains the normative soraotoDSL specification and the repository agent workflow.

| Need | Start here |
|---|---|
| soraotoDSL language, Project/DAW model, Component model, Plugin model/ABI, interchange, or conformance | [`specs/README.md`](specs/README.md) |
| Issue phases, design, implementation, review, evidence, or checkpoints | [`agent-workflow/README.md`](agent-workflow/README.md) |
| Plugin product behavior and architecture | [`specs/plugins/README.md`](specs/plugins/README.md) and [`design/README.md`](design/README.md) |
| Current implementation progress and verification status | [`status/README.md`](status/README.md) |
| Web Player run/build instructions | [`../web-player/README.md`](../web-player/README.md) |
| Web Player product-specific behavior | [`../web-player/docs/specs/README.md`](../web-player/docs/specs/README.md) |
| Web Player internal architecture | [`../web-player/docs/design/README.md`](../web-player/docs/design/README.md) |

## Authority boundary

`docs/specs/soraotoDSL/` owns portable soraotoDSL semantics, Component behavior, Plugin ABI,
Project IR behavior, and conformance rules.

`web-player/docs/specs/` may narrow the browser reference player's supported profile and define
browser-only product behavior. It must not redefine shared DSL or Plugin ABI semantics.

`web-player/docs/design/` documents implementation architecture only. Design and implementation
behavior never override the normative specification.

`docs/specs/plugins/` owns normative product contracts for repository plugins. It may narrow a
plugin's product behavior but must not redefine shared soraotoDSL or Plugin ABI semantics.
`docs/design/` records approved implementation architecture, while `docs/status/` mirrors current
progress and verification without changing either specification or design.

The normative specification is maintained only as split Markdown sources. There is no generated
full-spec snapshot in the repository.
