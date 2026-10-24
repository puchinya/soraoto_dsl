# DSL-Owned Plugin Configuration and Ephemeral Project IR

## Status

Approved for Issue #7 / PR #8 on 2026-09-27. The user clarified that DSL is the only source of
truth, there is no state-save/restore concept, the Project remains an ephemeral IR, and no existing
numeric version may be increased. This design updates the in-repository Draft v0.5 / Plugin ABI 1.0
contract in place.

The exact physical-model contract remains at
`.agent-state/issues/7/implementation-contract-preset-physical-config.txt`. The architecture delta
remains at `.agent-state/issues/7/delta-implementation-contract-ephemeral-project.txt`. Keep both
handoffs byte-for-byte; this design resolves their persistence clauses according to the later user
direction.

## Source and runtime lifecycle

The only authoritative authored inputs are DSL source, imported DSL modules, explicit assets, and
Plugin metadata. Each construction compiles those inputs into fresh in-memory Project and
`Resolved Project IR` values, builds `ResolvedGraphV1`, then creates and configures Plugin instances.

```text
DSL source + imports + explicit assets + Plugin metadata
  -> parse/compile
  -> Project / Resolved Project IR (ephemeral)
  -> ResolvedGraphV1
  -> instantiate and configure Plugins
  -> activate runtime
```

The Project abstraction, `project {}` syntax, `ProjectConfigV1`, arrangement/timeline semantics, and
`Resolved Project IR` remain. They are generated compiler/runtime data, not user save formats. There
is no Project save/load, Project restore, or supported serialized-IR runtime input. A diagnostic IR
dump may be serialized for inspection, but it is disposable and is never loaded as authority.

WebPlayer convenience storage may contain DSL source text only. It must not store Project/IR, graph,
Plugin runtime state, active preset selection, or parameter snapshots. Reloading source recompiles it
and rebuilds runtime instances. If compilation or preset resolution fails, the attempted build
fails; no previous saved Project or Plugin state is consulted.

Runtime DSP memory remains necessary while an instance is live. Voice allocation, oscillator phase,
filter history, envelopes, delay buffers, LFO phase, asset handles, and cached derived coefficients
are ephemeral. Recreating a graph discards runtime history. `RELOAD_INSTANCE`, when used, constructs
a replacement from current compiled configuration, then swaps it and destroys the old instance; it
does not copy live Plugin state.

## Declarative Plugin configuration

Every first-party Plugin receives its authored configuration from the compiled DSL. The
configuration carries applicable bypass value, factory-preset/program/unit selections, controller
mapping selections, typed parameter values keyed by stable parameter ID, and explicit asset
references.

For each Plugin, Host initialization applies host runtime requirements, declared preset/program/unit
selections, controller mappings, and then explicit typed parameter values before
automation/modulation binding and activation. The same ordering applies when rebuilding an instance.
A UI edit intended to survive
recompilation edits the DSL/source model. A runtime-only edit is discarded when unchanged source is
compiled again.

Factory-preset selection is DSL configuration, not Plugin-owned state. For SuperSynth,
`presets.json` owns each factory preset definition and its complete physical `engine_config`; DSL
owns which preset a graph node selects. The runtime resolves and applies that profile, rebuilds
dependent caches, and clears incompatible transient piano state when the profile changes. Neither
the Project IR nor Plugin persistence stores a second preset ID, `engine_config`, generated
coefficients, or live parameter snapshot.

`.soraotopreset`, if retained, is a declarative preset artifact containing authored selections,
typed parameter values, explicit assets, and metadata. It is not a Project container or opaque
Plugin-state format.

## ABI and versioning

Remove the generic opaque Plugin persistence model from all eight first-party Plugins:

- `StateDescriptor` and state schema identity;
- state snapshot/load exports and state migration;
- `STATE_DIRTY` persistence semantics;
- state-only `persistent_instance_key`;
- opaque instance, program, or unit payloads.

Do not retain dummy state APIs or old-state compatibility readers. Keep unrelated runtime reset,
parameter query, preset/program selection, automation, modulation, asset, and control services.
Former ABI numeric slots remain reserved where required; unrelated numbers are not renumbered.

Keep every existing numeric version unchanged, including DSL Draft v0.5, Plugin ABI 1.0, preset
format versions, product versions, and existing IR/schema revisions. No compatibility with removed
opaque Project or Plugin state is required.

## Verification expectations

- Compile the same DSL twice with a complete runtime teardown and verify equivalent initial
  Project/IR/graph/Plugin configuration without a state handoff.
- Verify Project, `project {}`, `ProjectConfigV1`, and `Resolved Project IR` remain usable, and no
  Project save/load or authoritative IR deserializer exists.
- Verify source convenience storage contains DSL text only.
- Verify all eight first-party descriptors and modules omit state metadata and active snapshot/load
  APIs while retaining ABI 1.0.
- Verify preset/program/unit selection precedes explicit parameter values; transient runtime edits
  disappear after recompilation unless the source is edited.
- Verify a fresh SuperSynth instance from the same DSL and `presets.json` gets the same initial
  physical profile and derived runtime configuration.
- Run the separate physical-model migration, calibration, production-SIMD, lifecycle, WASM, and
  WebPlayer gates defined by Issue #7.
