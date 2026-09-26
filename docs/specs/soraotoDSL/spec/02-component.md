# Compile-time Component

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

---

# 20. External Component

Component は **compile-time graph / timeline generator**。

```text
typed props + immutable compile context
        ↓
JS Component / WASM Component
        ↓
GraphPatch
        ↓
Host validation
        ↓
Project IR
```

Component は realtime audio processor ではない。

## 20.1 Canonical Component data model

Component の唯一の出力は `GraphPatchV1`。

```text
GraphPatchV1 {
    abi: 1

    operations: List<GraphOp>
    exports: Map<String, Ref>

    diagnostics: List<Diagnostic>
    dependencies: List<Dependency>
}
```

`GraphOp` は以下で固定する。

```text
DefineTrack
DefineBus
InstantiatePlugin
ConnectAudio
ConnectEvent
ConnectSidechain
CreateSend
AddAutomation
AddModulation
EmitTimeline
EmitPerformance
InstantiateComponent
DeclareAssetDependency
```

Component は Host の Project IR を直接 mutation しない。

Host は GraphPatch 全体を validate した後、transaction として一括適用する。

validation に失敗した場合は一切適用しない。

## 20.2 ComponentInvocationV1

Component input:

```text
ComponentInvocationV1 {
    abi: 1

    component_id: String
    invocation_id: String

    props: Map<String, Value>

    context: ComponentContextV1

    random_seed: UInt64
}

ComponentContextV1 {
    project_id: String

    project_start: MusicalTime
    project_end: MusicalTime

    section: SectionContextV1?

    tempo_map: List<TempoSegmentV1>
    meter_map: List<MeterPointV1>
    key_map: List<KeyPointV1>

    tuning_hz: Float64

    named_refs: Map<String, Ref>
}

SectionContextV1 {
    name: String
    start: MusicalTime
    end: MusicalTime
}
```

The context reuses the **canonical Project timeline schemas**:

```text
MusicalTime     -> §62.16
TempoSegmentV1  -> §33.1
MeterPointV1    -> §33.2
KeyPointV1      -> §33.3
```

There is no Component-private duplicate timeline representation。

validation:

```text
project_start <= project_end

tempo_map:
    canonical §33.1 rules
    clipped to/covering the invocation-relevant project interval

meter_map:
    canonical §33.2 rules

key_map:
    canonical §33.3 rules

tuning_hz:
    finite > 0
```

`named_refs` は invocation の lexical scope から参照可能な Track / Bus / Harmony / Asset 等だけを含む。

Map key は source-visible binding name。
Map value `Ref.kind` と実 object kind が一致必須。

Component から project 全体を自由探索する API は持たない。

## 20.3 Component Value encoding

Component ABI payload の `Value` は recursive tagged value。

wire encoding は §61.3 を唯一の canonical encoding とする。

```text
null
bool
int
float
string
bytes
list<Value>
record<Map<String, Value>>

unit_value {
    unit
    value
}

pitch {
    semitone
}

ref {
    kind
    id
}
```

`unit`:

```text
norm
db
hz
khz
ms
s
bpm
semitone
cent
beat
bar
ratio
percent
```

Compiler の typed value を ABI 境界で失わない。

## 20.4 GraphOp concrete schema

`GraphOp` は `"op"` field で判別する closed tagged union。

```text
GraphOp =
    DefineTrack
  | DefineBus
  | InstantiatePlugin
  | ConnectAudio
  | ConnectEvent
  | ConnectSidechain
  | CreateSend
  | AddAutomation
  | AddModulation
  | EmitTimeline
  | EmitPerformance
  | InstantiateComponent
  | DeclareAssetDependency
```

wire tag:

```text
DefineTrack              -> "define_track"
DefineBus                -> "define_bus"
InstantiatePlugin        -> "instantiate_plugin"
ConnectAudio             -> "connect_audio"
ConnectEvent             -> "connect_event"
ConnectSidechain         -> "connect_sidechain"
CreateSend               -> "create_send"
AddAutomation            -> "add_automation"
AddModulation            -> "add_modulation"
EmitTimeline             -> "emit_timeline"
EmitPerformance          -> "emit_performance"
InstantiateComponent     -> "instantiate_component"
DeclareAssetDependency   -> "declare_asset_dependency"
```

unknown `"op"` は Component validation error。
同じ operation record に別variant専用fieldを混在させてはならない。


すべての GraphOp は:

```text
{
    op: String
    local_id?: String
    ...
}
```

を持つ。

### DefineTrack

```text
{
    op: "define_track"
    local_id: String
    name: String
    channel_layout: ChannelLayout?
    gain: Db?
    pan: Pan?
}
```

### DefineBus

```text
{
    op: "define_bus"
    local_id: String
    name: String
    channel_layout: ChannelLayout
    gain: Db?
}
```

### InstantiatePlugin

```text
{
    op: "instantiate_plugin"
    local_id: String
    plugin: String
    role:
        instrument | effect | generator | analyzer | event_effect | hybrid

    parameters: Map<String, Value>
    preset: String?
}
```

`plugin` は import 済み Plugin symbol または resolvable Plugin URI。

### ConnectAudio

```text
{
    op: "connect_audio"
    from: Ref
    from_bus: UInt32?
    to: Ref
    to_bus: UInt32?
}
```

### ConnectEvent

```text
{
    op: "connect_event"
    from: Ref
    from_bus: UInt32?
    to: Ref
    to_bus: UInt32?
}
```

### ConnectSidechain

```text
{
    op: "connect_sidechain"
    source: Ref
    source_bus: UInt32?
    target: Ref
    target_bus: UInt32
}
```

`target_bus` は target Plugin descriptor で `role: sidechain` の input bus でなければならない。

### CreateSend

```text
{
    op: "create_send"
    local_id: String
    source: Ref
    target: Ref
    gain: Db
    mode: pre_fader | post_fader
}
```

### AddAutomation

```text
{
    op: "add_automation"
    target: Ref
    parameter_path: String
    curve: CurveValue
}
```

### AddModulation

```text
{
    op: "add_modulation"
    target: Ref
    parameter_path: String
    source: ModulationSource
    amount: Value
}
```

### EmitTimeline

```text
{
    op: "emit_timeline"
    target: Ref
    stream_type: String
    events: List<TypedIRValueV1>
}
```

### EmitPerformance

```text
{
    op: "emit_performance"
    target: Ref
    performance_type: String
    events: List<TypedIRValueV1>
}
```

### InstantiateComponent

```text
{
    op: "instantiate_component"

    local_id: String
    component: String
    props: Map<String, Value>

    bind_exports: Map<String, String>
}
```

### DeclareAssetDependency

```text
{
    op: "declare_asset_dependency"
    asset: AssetRef
    required: Bool
}
```

## 20.5 Common Component ABI records

```text
Ref {
    scope:
        local | project

    kind:
        track | bus | plugin | harmony | asset

    id: String
}
```

Local ID grammar:

```text
"$" [A-Za-z_] { [A-Za-z0-9_.-] }
```

rules:

```text
scope=local:
    id must be a declared/aliased local ID in the current GraphPatch

scope=project:
    Ref must be exactly one of ComponentInvocationV1.context.named_refs values
    or an AssetRef-derived project asset reference already present in props/context

Component may not manufacture an arbitrary project Ref by guessing an internal id
```

`component` is not a graph-object Ref kind。
An `InstantiateComponent.local_id` identifies the nested invocation namespace only; actual graph objects are accessed through `bind_exports`。

```text
AssetRef {
    sha256: String
    logical_name: String?
}
```

`AssetRef.sha256`:

```text
exactly 64 lowercase hexadecimal characters
SHA-256 of exact asset bytes
```

```text
Dependency {
    kind:
        component | plugin | asset | source

    id: String
    digest: String
}
```

`Dependency.digest`:

```text
64 lowercase hexadecimal characters
SHA-256 domain determined by dependency kind
```

kind semantics:

```text
component:
    id = component stable id/URI
    digest = Component package/binary digest

plugin:
    id = Plugin id
    digest = .wasm/.soraotoplug/.soraotobundle-selected Plugin package digest

asset:
    id = asset://<sha256>
    digest = same asset content sha256

source:
    id = normalized module URI
    digest = SHA-256(exact normalized source bytes after BOM removal)
```

`dependencies` must contain every external compile input whose change can alter this GraphPatch and that is not already part of the Component's own package digest or `ComponentInvocationV1` bytes。

List is canonicalized:

```text
sort by (kind UTF-8 bytes, id UTF-8 bytes, digest bytes)
exact duplicate removed
conflicting digest for same (kind,id) -> validation error
```

Every `DeclareAssetDependency` operation must have a matching `kind=asset` dependency。
Every instantiated Plugin whose descriptor/package affects generated structure must have a matching `kind=plugin` dependency。

```text
Diagnostic {
    severity:
        info | warning | error

    code: String
    message: String

    source_span?: {
        file: String
        start: UInt64
        end: UInt64
    }
}
```

`source_span`:

```text
file = normalized project-root-relative module URI
start/end = half-open UTF-8 byte offsets after BOM removal
start <= end
```

`severity: error` を1件でも返した GraphPatch は適用しない。

```text
CurveValue {
    points: List<{
        at: Value
        value: Value
        interpolation:
            step | linear | ease_in | ease_out | ease_in_out
    }>
}
```

`points` は `at` 昇順。

同一 `at` duplicate は後勝ちで canonicalize する。

`ModulationSource` は `"kind"` で判別する closed tagged union。

```text
ModulationSource =
    {
        "kind": "lfo",
        "shape": "sine" | "triangle" | "saw" | "square" | "sample_hold",
        "rate": Value,
        "phase": Norm
    }

  | {
        "kind": "envelope",
        "attack": Time,
        "decay": Time,
        "sustain": Norm,
        "release": Time
    }

  | {
        "kind": "ref",
        "source": Ref,
        "output": String
    }
```

unknown `kind` は Component validation error。

`EmitTimeline.events` / `EmitPerformance.events` は `TypedIRValueV1`。

```text
TypedIRValueV1 {
    type: String
    value: Value
}
```

`type` は fully-qualified Project IR type name。

例:

```text
soraoto.ir.NoteEvent@1
soraoto.ir.ChordEvent@1
soraoto.performance.GuitarPerformance@1
```

`value` は§61.3 `Value` で、通常 `"t":"record"` を使用して IR fields を保持する。

Host は `type` に対応する Project IR schema version で `value` を type-check する。
unknown `type` は Component validation error。

`stream_type` / `performance_type` は container-level declared typeであり、
各 `TypedIRValueV1.type` はその型または仕様上許可されたsubtypeでなければならない。

## 20.6 Component exports / nested binding

`GraphPatchV1.exports` exposes graph objects to a parent Component or caller。

```text
export name:
    UTF-8 NFC
    [A-Za-z_][A-Za-z0-9_.-]*
    unique

export value:
    Ref resolving successfully after this GraphPatch transaction
```

An export may reference:

```text
local object created by this patch
project object intentionally re-exported from named_refs
```

Nested Component:

```text
InstantiateComponent.local_id:
    identifies the nested invocation

bind_exports:
    nested export name -> parent local ID
```

Example:

```text
nested GraphPatch.exports:
    {
        "bus": ref(local,bus,"$internalBus")
    }

parent InstantiateComponent:
    local_id: "$fx"
    bind_exports: {
        "bus": "$fxBus"
    }
```

After nested validation, parent obtains:

```text
ref(local,bus,"$fxBus")
```

pointing to the nested exported Bus object。

Algorithm:

```text
1. derive nested invocation_id from parent invocation_id + InstantiateComponent.local_id
2. execute nested Component
3. validate nested GraphPatch transactionally
4. resolve nested exports
5. for each bind_exports entry:
       require nested export exists
       require parent alias local ID is unique
       alias that resolved object into parent local-ref namespace
6. continue parent phase validation
```

Unbound nested exports remain private。
A requested missing export is Component validation error。
Nested Component diagnostics/dependencies are merged into the parent result in nested invocation order。

`InstantiateComponent.local_id` itself is not connectable as Track/Bus/Plugin。

## 20.7 GraphPatch operation ordering

GraphPatch `operations` は authored order を保持する。

Host は以下の dependency phase で transaction validation する。

```text
1. DefineTrack / DefineBus
2. InstantiatePlugin / InstantiateComponent
3. EmitTimeline / EmitPerformance
4. ConnectAudio / ConnectEvent / ConnectSidechain / CreateSend
5. AddAutomation / AddModulation
6. DeclareAssetDependency
```

同 phase 内は source order。

後 phase から前 phase への参照は可能。

存在しない local/project Ref は validation error。
---

---

---

# 21. Component ABI

## 21.1 Payload format

WASM Component の input/output payload は **§61 Soraoto Deterministic CBOR Profile 1** を唯一の wire encoding とする。

```text
input:
    ComponentInvocationV1

output:
    GraphPatchV1
```

unknown/required field、numeric、Unicode、map ordering、float encoding はすべて§61に従う。

Schema field `abi` の major が一致しない場合は load error。

## 21.2 WASM Component ABI

WASM Component は WebAssembly Component Model を使用する。

WIT package:

```wit
package soraoto:component@1.0.0;

interface extension {
    record component-error {
        code: u32,
        message: string,
    }

    expand: func(
        input: list<u8>
    ) -> result<list<u8>, component-error>;
}

world component {
    export extension;
}
```

Component `component-error.code`:

```text
1   INVALID_INPUT
2   INVALID_PROPS
3   UNSUPPORTED_ABI
4   EXPANSION_LIMIT
5   INTERNAL_ERROR
```

Host は unknown error code を `INTERNAL_ERROR` として扱う。

`input`:

```text
Deterministic CBOR(ComponentInvocationV1)
```

成功 output:

```text
Deterministic CBOR(GraphPatchV1)
```

WASM Component は Host import を持たない。

したがって以下へ直接アクセスできない。

```text
filesystem
network
wall clock
random device
process
DOM
host mutable project state
```

Component Model の Canonical ABI が language binding を担当し、soraotoDSL 独自 linear-memory ABI は定義しない。


Component binary は `soraoto:component@1.0.0/component` world に適合しなければならず、追加 required import を持つ Component は load error。

Component Model baseline:

```text
the default ungated WebAssembly Component Model feature set
adopted by the WASI 0.2.0 Developer Preview
```

This pins **Component Model features**, not WASI APIs。
soraoto Component ABI 1.0 imports no `wasi:*` interface。

A Host/runtime may implement WASI 0.3/0.3.1 or later as a superset, but a `soraoto:component@1.0.0` Component must validate without requiring any post-0.2 adopted/gated feature。

ABI 1.0 does not use:

```text
async
future
stream
map
implements
external-id
component threads
```

を使用しない。

Therefore runtime support for WASI 0.3/0.3.1 additions does not change soraoto Component semantics or cache identity。

## 21.3 JavaScript Component ABI

JavaScript Component は ESM。

required exports:

```javascript
export const soraotoComponentAbi = 1;

export function expand(input) {
    return {
        abi: 1,
        operations: [],
        exports: {},
        diagnostics: [],
        dependencies: []
    };
}
```

`expand` は synchronous。

Promise を返してはならない。

`input` は deep-frozen `ComponentInvocationV1` JS object。

output は `GraphPatchV1` と同型の plain object。

## 21.4 JavaScript sandbox

禁止:

```text
Date
performance.now
Math.random
crypto random
fetch
WebSocket
XMLHttpRequest
filesystem
process
worker/thread
dynamic import from network
eval
Function constructor
```

許可:

```text
pure ECMAScript language operations
TextEncoder / TextDecoder
ArrayBuffer / TypedArray
relative imports inside the hashed component package
```

`Math` deterministic subset:

```text
Math.abs
Math.min
Math.max
Math.floor
Math.ceil
Math.trunc
Math.round
Math.sign
Math.imul
Math.clz32
Math.fround

Math.PI
Math.E
```

禁止:

```text
Math.random

Math.sin / cos / tan
Math.asin / acos / atan / atan2
Math.sinh / cosh / tanh
Math.exp / expm1
Math.log / log1p / log2 / log10
Math.pow
Math.sqrt / cbrt / hypot
```

上記transcendental/implementation-approximation系をJS Componentで直接使用してはならない。
音楽的curveは DSL standard curve / Host側固定 loweringを使用する。

Host は次の deterministic helper を提供する。

```javascript
globalThis.soraoto = Object.freeze({
    rand(seed, key),
    randRange(seed, key, min, max),
    randBool(seed, key, probability),

    clamp(value, min, max),
    lerp(a, b, t),

    sha256(bytes)
})
```

`rand*` は §19.6 の exact algorithm。

```text
clamp(v,min,max):
    require min <= max
    min(max(v,min),max)

lerp(a,b,t):
    a + (b-a)*t
```

評価順とFloat64 roundingはECMAScript binary64 semantics。

JavaScript `key` mapping:

```text
boolean          -> Hashable Bool
safe integer     -> Hashable Int
string           -> Hashable String
Uint8Array       -> Hashable Bytes
Array            -> Hashable list

{eventId: Uint8Array(16)}
                 -> EventId128

{enumType: String, enumCase: String}
                 -> enum
```

other object / Float64 / null は random key として TypeError。

JS Component package closure:

```text
entry:
    import target の .js/.mjs file

dependencies:
    static relative ESM import graph reachable from entry

package root:
    entry file の parent directory
```

relative import path rules:

```text
UTF-8 path
"/" separatorへnormalize
"." segment除去
".." で package root 外へ出る path 禁止
symlink は real path 解決後も package root 内必須
bare specifier禁止
absolute path禁止
network URL禁止
dynamic import禁止
```

package digest:

```text
for every reachable module:
    path = package-root-relative normalized UTF-8 path
    content_digest = SHA-256(exact source bytes)

entries = sort by path Unicode scalar order

digest =
    SHA-256(
        Deterministic-CBOR([
            "soraoto-js-component-package-v1",
            entries
        ])
    )
```

未到達 file は digest に含めない。

## 21.5 GraphPatch local IDs

Component output 内で作成する node は local ID を使用する。

```text
"$track"
"$compressor"
"$delay"
```

Host は `(invocation_id, local_id)` から global stable ID を生成する。

```text
payload =
    Deterministic-CBOR([
        "soraoto-component-object-id-v1",
        invocation_id,
        local_id
    ])

global_id =
    lowercase-hex(
        SHA-256(payload)[0..16]
    )
```

display form は32 lowercase hex chars。

同一 compile input では同一 global ID。

既存 Project object は `ref { kind, id }` で参照する。

同じ local ID の重複定義は compile error。

## 21.6 Nested Component

```text
InstantiateComponent {
    component
    props
    local_id
}
```

Host が nested invocation を実行する。

maximum nesting depth:

```text
64
```

Component dependency cycle は compile error。

## 21.7 Component resource limits

Conforming Compiler/Host が最低限受け入れる上限:

```text
one ComponentInvocation:
    GraphPatch operations <= 1,000,000
    encoded GraphPatch <= 64 MiB

one project compile:
    total Component GraphPatch operations <= 10,000,000

nested Component depth <= 64
```

Host はこれより高い configurable limit を提供してよい。

Component execution は sandbox watchdog で強制終了可能でなければならない。

```text
JavaScript:
    interruptible isolate / instruction watchdog

WASM Component:
    fuel / epoch interruption / cancellable isolated worker
```

Component が:

```text
infinite loop
resource limit超過
stack exhaustion
trap / uncaught exception
```

した場合 compile error `E_COMPONENT_EXECUTION`。

resource limit到達は `E_COMPONENT_RESOURCE_LIMIT`。

partial GraphPatch は一切適用しない。

## 21.8 Component cache

cache key:

```text
SHA-256(
    component-binary-or-js-package-digest
    + Deterministic-CBOR(ComponentInvocationV1)
    + dependency digests sorted by (kind,id,digest)
)
```

同一 key は同一 GraphPatch を返さなければならない。

一致しない場合 Component は nondeterministic とみなし compile error。

---

---

---
