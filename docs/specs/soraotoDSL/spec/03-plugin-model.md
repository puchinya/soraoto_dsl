# WASM Plugin Model / Control Plane

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

---

# 22. WASM Plugin

WASM Plugin は realtime/offline runtime extension の canonical model。

```text
import plugin SuperSynth from "./plugins/super-synth.wasm"
import plugin SoraotoDelay from "./plugins/delay.wasm"
```

対象:

```text
instrument
sampler
effect
generator
analyzer
event_effect
hybrid
```

GUI/editor/view embedding は ABI 1.0 の対象外。

GUI を除く音声・イベント・parameter・state・program・routing 機能は ABI 1.0 で仕様化する。

## 22.1 Plugin binary / package

Code-only Plugin:

```text
foo.wasm
```

Resource-bearing Plugin:

```text
Foo.soraotoplug
```

`.soraotoplug` は ZIP container。

必須 entry:

```text
/plugin.wasm
```

resource root:

```text
/resources/
```

package constraints:

```text
UTF-8 path
forward slash separator
absolute path禁止
".." segment禁止
symlink禁止
encrypted ZIP禁止
duplicate normalized path禁止
```

`plugin://<plugin-id>/<path>` は:

```text
/resources/<path>
```

へ解決する。

`.wasm` 単体 Plugin では `plugin://` resource は存在しない。

`asset://<sha256>` は package 外の Project Asset Registry。

Package digest は ZIP metadata に依存させない。

```text
entries =
    [
      ["/plugin.wasm", SHA256(uncompressed plugin.wasm)],
      ... all /resources files ...
    ]

sort entries by UTF-8 path byte order

package_digest =
    SHA-256(
      "soraoto:plugin-package:v1"
      || Deterministic-CBOR(entries)
    )
```

directory entry 自体は digest 対象外。
ZIP timestamp/compression method/order は identity に影響しない。

### Multi-Plugin distribution bundle

VST3 Factory / Module Info 相当の **配布単位**は `.soraotobundle` とする。
Realtime instance ABI は変えず、各 Plugin は引き続き1 Core Wasm instanceである。

```text
Suite.soraotobundle
```

`.soraotobundle` は ZIP container。

required:

```text
/bundle.cbor
/plugins/*.soraotoplug
```

`bundle.cbor`:

```text
PluginBundleV1 {
    format: 1

    id: String
    vendor: String
    vendor_url: String?
    vendor_email: String?

    name: String
    version: SemVer

    plugins: List<PluginBundleEntryV1>
}

PluginBundleEntryV1 {
    plugin_id: String
    name: String
    version: SemVer

    categories: List<String>
    kinds: List<PluginKind>

    max_instances: UInt32 | null
    distributable: Bool

    process_modes: List<PluginProcessMode>
    io_modes: List<PluginIOMode>

    compatible_plugin_ids: List<String>

    path: String
    sha256: String
}
```

constraints:

```text
bundle id:
    same reverse-DNS grammar as Plugin id

path:
    normalized relative UTF-8 path
    must begin "plugins/"
    must end ".soraotoplug"
    no absolute path
    no "." / ".." segment
    unique

plugin_id:
    unique within bundle

categories:
    canonical UTF-8 byte-order sort
    exact duplicates removed

compatible_plugin_ids:
    same validation rules as PluginDescriptorV1
    must not contain plugin_id

process_modes / io_modes:
    non-empty and valid descriptor enum values

vendor_email:
    when present, UTF-8 text containing an RFC 5322 addr-spec or "mailto:" URI

sha256:
    64 lowercase hex
    SHA-256 of exact nested .soraotoplug file bytes
```

Host は entry metadata と nested `.soraotoplug` の `PluginDescriptorV1` を照合する。

必須一致:

```text
plugin_id             == descriptor.id
name                  == descriptor.name
version               == descriptor.version
categories            == descriptor.categories or []
kinds                 == descriptor.kinds
max_instances         == descriptor.max_instances
distributable         == descriptor.distributable
process_modes         == descriptor.process_modes
io_modes              == descriptor.io_modes
compatible_plugin_ids == descriptor.compatible_plugin_ids
```

不一致は bundle validation error。

The duplicated discovery fields let a Host enumerate classes/capabilities and replacement relationships from `bundle.cbor` without instantiating Plugin code。
The nested `.soraotoplug` descriptor remains authoritative and is cross-checked before use。

import:

```text
import plugin SuperSynth
from "./Suite.soraotobundle#net.vendor.super-synth"
```

fragment は exact `plugin_id`。
fragment が無い bundle import は、plugins が exactly 1 entry の場合のみ許可。

bundle digest:

```text
manifest =
    Deterministic-CBOR(PluginBundleV1)

entries =
    sorted [
      [path, SHA-256(exact nested .soraotoplug bytes)]
    ]

bundle_digest =
    SHA-256(
      "soraoto:plugin-bundle:v1"
      || manifest
      || Deterministic-CBOR(entries)
    )
```

ZIP timestamp/compression/order は bundle identity に影響しない。

`.soraotobundle` は distribution/discovery convenienceであり、
Plugin間のmemory/shared-state/shared-thread ABIを提供しない。

## 22.2 Runtime architecture

soraoto Plugin ABI 1.0 deliberately uses a **single logical Plugin instance** rather than the VST pattern of a mandatory processor plus edit-controller pair。

Because custom GUI is out of scope:

```text
parameter metadata / formatting / programs / units / MIDI mapping
    -> Plugin control plane

realtime DSP / events
    -> process plane

large realtime -> non-realtime data
    -> Data Exchange

persistent control/DSP synchronization
    -> one Plugin state model
```

Therefore a VST-style private `IConnectionPoint` / `IMessage` channel between processor and edit controller has no separate soraoto ABI equivalent: there is no second in-plugin component to message。
The non-GUI behavior those messages commonly coordinate is expressed directly by the control plane, state model, HostRequest, and Data Exchange。

```text
1 PluginNode
    =
1 WebAssembly Core Module instance
    +
1 isolated linear memory
```

ABI 1.0 では Plugin instance 間で linear memory を共有しない。

Plugin process の同一 instance への concurrent call も行わない。

Graph scheduler は異なる Plugin instance を別 thread で並列処理できる。

## 22.3 WebAssembly profile

WASM Plugin ABI 1.0 は **WebAssembly Core Module** を使用する。

必須:

```text
memory32
little-endian WebAssembly numeric representation
one exported linear memory named "memory"
declared maximum memory size
```

禁止:

```text
WASI import
Component Model import/export
shared memory
WebAssembly threads
arbitrary host imports
memory64
GC references as ABI values
```

ABI 1.0 Core Wasm profile:

```text
base WebAssembly MVP numeric/control/memory instructions
+ sign-extension
+ multi-value
+ bulk-memory
+ simd128 when declared
```

`required_wasm_features` standard values:

```text
simd128
bulk-memory
sign-extension
multi-value
```

明示的に禁止:

```text
shared-memory / threads
memory64
GC
exception-handling
tail-call
multiple-memories
reference-types exposed through ABI
WASI
```

Host が required feature を提供できない場合は load error。

未列挙 Core Wasm proposal feature を Plugin が使用した場合 ABI validation error。

## 22.4 ABI version number

required export:

```text
soraoto_plugin_abi_version() -> i32
```

bit layout:

```text
bits 31..16 = major
bits 15..0  = minor
```

ABI 1.0:

```text
0x0001_0000
```

Host と Plugin の major は一致必須。

Plugin minor <= Host supported minor なら load 可能。

Core Wasm function ABI scalar convention:

```text
pointer:
    i32 bit pattern interpreted as unsigned memory32 byte offset

size / len / capacity passed as i32:
    0 .. 2,147,483,647 only

status/result i32:
    signed two's-complement

i64 documented as unsigned:
    raw 64-bit bit pattern

i64 documented as signed:
    signed two's-complement
```

`ptr + len` は unsigned overflow を起こさず current linear-memory size 以下でなければならない。

Realtime ABI の拡張規則は §59.2 に従う。

---

---

---

# 23. Plugin module ABI

## 23.1 Required exports

```text
memory

soraoto_plugin_abi_version() -> i32

soraoto_plugin_init(host_abi: i32) -> i32
soraoto_plugin_terminate()

soraoto_alloc(size: i32, align: i32) -> i32
soraoto_free(ptr: i32, size: i32, align: i32)

soraoto_plugin_control(
    opcode: i32,
    request_ptr: i32,
    request_len: i32,
    response_ptr: i32,
    response_capacity: i32
) -> i32

soraoto_plugin_activate() -> i32
soraoto_plugin_deactivate()

soraoto_plugin_start_processing() -> i32
soraoto_plugin_stop_processing()

soraoto_plugin_process(
    process_block_ptr: i32
) -> i32

soraoto_plugin_reset()

soraoto_plugin_state_snapshot(
    dst_ptr: i32,
    capacity: i32
) -> i32

soraoto_plugin_state_load(
    src_ptr: i32,
    len: i32,
    context_ptr: i32,
    context_len: i32
) -> i32

soraoto_plugin_latency_samples() -> i32
soraoto_plugin_tail_samples() -> i64
```

`soraoto_alloc` / `soraoto_free` は Host が Plugin memory 内へ process arena を作るための non-realtime allocator。

allocator contract:

```text
size > 0
align = power-of-two
8 <= align <= 64

success -> non-zero pointer aligned to `align`
failure -> 0
```

`soraoto_free` は allocation 時と同じ `size` / `align` を受け取る。

`soraoto_plugin_process` 内および Processing state 中の realtime path では Host も Plugin も `soraoto_alloc` を呼ばない。

## 23.2 Allowed Host imports

Plugin が import できる namespace は:

```text
soraoto_host_v1
```

定義済み import:

```text
log(
    level: i32,
    utf8_ptr: i32,
    utf8_len: i32
)

asset_open(
    uri_ptr: i32,
    uri_len: i32
) -> i32

asset_size(
    handle: i32
) -> i64

asset_read(
    handle: i32,
    offset: i64,
    dst_ptr: i32,
    len: i32
) -> i32

asset_close(
    handle: i32
)

host_query(
    feature_ptr: i32,
    feature_len: i32
) -> i32

system_time_ns() -> i64

host_request(
    kind: i32,
    arg0: i64,
    arg1: i64,
    arg2: i64
) -> i32

progress_begin(
    kind: i32,
    title_ptr: i32,
    title_len: i32
) -> i64

progress_update(
    progress_id: i64,
    normalized: f64
) -> i32

progress_end(
    progress_id: i64,
    status: i32
) -> i32
```

`host_query`:

```text
1  supported
0  unsupported
<0 status code
```

`system_time_ns` は ProcessContext の `system_time_ns` と同一 monotonic clock domain の現在値を返す。
capability `system-time` が無い場合は `-1`。

`host_request` は §29.11 `SoraotoHostRequestV1.kind/arg0/arg1/arg2` と同じ numeric contract を non-realtime control plane から使用する。

```text
0:
    request accepted/queued

SORAOTO_E_UNSUPPORTED:
    Host/capability does not support that request

SORAOTO_E_BAD_STATE:
    request is not legal in the current Host/transport state

SORAOTO_E_INVALID_ARGUMENT:
    kind/arguments invalid
```

`host_request` は Host action を同期完了させるAPIではない。
特に transport / bus / reload request は safe point で処理できる。
Plugin は return `0` だけで requested state が即時成立したと仮定してはならず、次の ProcessContext / GET_ACTIVE_CONFIG / descriptor refresh を authoritative result とする。

Realtime `soraoto_plugin_process` から同じ要求を出す場合は `ProcessBlock.host_requests` を使い、`host_request` import を呼ばない。

これにより transport停止中など `process` callback が発生していない状態でも、`soraoto_plugin_control` 等の non-realtime call 内から Transport Control 相当要求を出せる。

Progress API は non-realtime の長時間処理専用。

```text
progress kind:
0 generic
1 loading
2 analysis
3 rendering
4 migration
```

Plugin は必要なものだけ import してよい。

上記以外の import が存在する module は load error。

Host import numeric semantics:

```text
log level:
    0 trace
    1 debug
    2 info
    3 warning
    4 error

asset_open:
    >0 asset handle
    <0 status code

asset_size:
    >=0 byte size
    <0  status code

asset_read:
    >=0 bytes read
    <0  status code
```

`asset_read` は EOF で request length より短い値を返せる。

`asset_close(0)` は no-op。

これら import は次から呼び出せる。

```text
init
control
activate
deactivate
state_load
terminate
```

`host_request` の notification/transport要求もこの non-realtime call-state に限定する。
Host import callは現在のPlugin exportがreturnするまで実際のPlugin state-transition callbackをre-enterしてはならない。

次から呼び出してはならない。

```text
start_processing
process
stop_processing
state_snapshot
```


## 23.3 Status codes

```text
 0  SORAOTO_OK

-1  SORAOTO_E_INVALID_ARGUMENT
-2  SORAOTO_E_BAD_STATE
-3  SORAOTO_E_UNSUPPORTED
-4  SORAOTO_E_BUFFER_TOO_SMALL
-5  SORAOTO_E_INCOMPATIBLE_LAYOUT
-6  SORAOTO_E_OUT_OF_MEMORY
-7  SORAOTO_E_STATE_INCOMPATIBLE
-8  SORAOTO_E_ASSET_UNAVAILABLE
-9  SORAOTO_E_INTERNAL
```

Trap は status code ではなく Plugin fault。

## 23.4 Control opcodes

`soraoto_plugin_control` request/response payload は §61 の Deterministic CBOR wire schema に従う。

call contract:

```text
request:
    every opcode carries exactly one CBOR item

schema request = null:
    request_len = 1
    request bytes = 0xf6 (CBOR null)

request_ptr:
    non-zero when request_len > 0

request/response memory ranges:
    in-bounds
    non-overlapping

mutation opcode:
    response_ptr = 0
    response_capacity = 0

query opcode size-query:
    response_ptr = 0
    response_capacity = 0

query opcode normal:
    response_ptr != 0
```

Query return:

```text
r < 0:
    status error

r >= 0 and r <= response_capacity:
    exactly r response bytes written

r > response_capacity:
    no response bytes written
    r = required capacity
```

size-query は side-effect free で、required response size を返す。

CBOR response size が `2,147,483,647` bytes を超える query は `SORAOTO_E_OUT_OF_MEMORY`。

固定 opcode:

```text
1   GET_DESCRIPTOR
2   CONFIGURE
3   GET_ACTIVE_CONFIG
4   GET_PARAMETER_SNAPSHOT
5   GET_REMOTE_REPRESENTATIONS
6   GET_PHYSICAL_UI_MAPPINGS
7   GET_UNIT_BUS_ASSIGNMENTS
8   GET_ORCHESTRAL_ARTICULATIONS
9   SET_PARAMETER_VALUES

10  LOAD_FACTORY_PRESET
11  FORMAT_PARAMETER_VALUE
12  PARSE_PARAMETER_TEXT

20  GET_PROGRAM_INFO
21  LOAD_PROGRAM
22  GET_PITCH_NAME
23  GET_PROGRAM_DATA
24  SET_PROGRAM_DATA
25  GET_UNIT_DATA
26  SET_UNIT_DATA
27  SET_PROGRAM_NAME
28  GET_SELECTED_UNIT
29  SELECT_UNIT

30  BEGIN_MIDI_LEARN
31  LEARN_CONTROLLER
32  END_MIDI_LEARN
33  GET_CONTROLLER_MAPPINGS

34  FORMAT_NOTE_EXPRESSION_VALUE
35  PARSE_NOTE_EXPRESSION_TEXT
```

Query opcode:

```text
GET_DESCRIPTOR
GET_ACTIVE_CONFIG
GET_PARAMETER_SNAPSHOT
GET_REMOTE_REPRESENTATIONS
GET_PHYSICAL_UI_MAPPINGS
GET_UNIT_BUS_ASSIGNMENTS
GET_ORCHESTRAL_ARTICULATIONS
FORMAT_PARAMETER_VALUE
PARSE_PARAMETER_TEXT
GET_PROGRAM_INFO
GET_PITCH_NAME
GET_PROGRAM_DATA
GET_UNIT_DATA
GET_SELECTED_UNIT
GET_CONTROLLER_MAPPINGS
FORMAT_NOTE_EXPRESSION_VALUE
PARSE_NOTE_EXPRESSION_TEXT
```

Query で `response_ptr = 0 && response_capacity = 0` の場合、副作用を起こさず必要 byte 数を正の戻り値で返す。
本呼び出しでは書き込んだ byte 数を返す。

Mutation opcode:

```text
CONFIGURE
SET_PARAMETER_VALUES
LOAD_FACTORY_PRESET
LOAD_PROGRAM
SET_PROGRAM_DATA
SET_UNIT_DATA
SET_PROGRAM_NAME
SELECT_UNIT
BEGIN_MIDI_LEARN
LEARN_CONTROLLER
END_MIDI_LEARN
```

成功は `0`、失敗は負の status code。

### Control opcode call-state matrix

All calls require:

```text
not Processing
```

unless a stricter state is listed。

```text
GET_DESCRIPTOR
GET_PARAMETER_SNAPSHOT
GET_REMOTE_REPRESENTATIONS
GET_PHYSICAL_UI_MAPPINGS
GET_ORCHESTRAL_ARTICULATIONS
FORMAT_PARAMETER_VALUE
PARSE_PARAMETER_TEXT
GET_PROGRAM_INFO
GET_PITCH_NAME
GET_PROGRAM_DATA
GET_UNIT_DATA
GET_SELECTED_UNIT
GET_CONTROLLER_MAPPINGS
FORMAT_NOTE_EXPRESSION_VALUE
PARSE_NOTE_EXPRESSION_TEXT:
    Initialized
    Configured
    Active

CONFIGURE:
    Initialized
    Configured

    Active only for the lightweight reconfiguration allowed by §28:
        same sample_rate
        same sample_format
        same max_frames
        same process_mode
        same active audio/event buses
        same data-exchange queues/capacities

        only automation_state and/or channel_context may differ

GET_ACTIVE_CONFIG
GET_UNIT_BUS_ASSIGNMENTS:
    Configured
    Active

SET_PARAMETER_VALUES
LOAD_FACTORY_PRESET
LOAD_PROGRAM
SET_PROGRAM_DATA
SET_UNIT_DATA
SET_PROGRAM_NAME
SELECT_UNIT
BEGIN_MIDI_LEARN
LEARN_CONTROLLER
END_MIDI_LEARN:
    Configured
    Active
```

Calling an opcode in another state returns:

```text
SORAOTO_E_BAD_STATE
```

Mutation opcodes in `Active` state must be called only when the Plugin is not Processing。
If a mutation changes descriptor/layout/context requirements, the Host follows its documented refresh/reconfigure sequence before restarting Processing。

### GET_DESCRIPTOR

request `null`、response `PluginDescriptorV1`。

### CONFIGURE

request `PluginConfigV1`、response `null`。

### GET_ACTIVE_CONFIG

request `null`、response `PluginConfigV1`。

### GET_PARAMETER_SNAPSHOT

request `null`。

response:

```text
ParameterSnapshotV1 {
    values: List<ParameterSnapshotEntryV1>
}

ParameterSnapshotEntryV1 {
    parameter_id: UInt32

    value:
        {
            "kind": "numeric",
            "normalized": Float64
        }
      | {
            "kind": "string",
            "value": String
        }
}
```

全 persistent parameter を exactly once 含む。`read_only` meter parameter は含めない。

### SET_PARAMETER_VALUES

Static/control-plane parameter assignment。

request:

```text
ParameterValueUpdateV1 {
    values: List<ParameterSnapshotEntryV1>
}
```

rules:

```text
parameter_id unique in request

read_only=true:
    cannot be set

numeric parameter:
    value.kind = "numeric"
    normalized finite 0..1

string parameter:
    value.kind = "string"

type mismatch:
    SORAOTO_E_INVALID_ARGUMENT
```

Transactional:

```text
all entries valid
    -> apply all

any invalid
    -> apply none
```

Allowed states:

```text
Configured
Active but not Processing
```

After success Host refreshes:

```text
GET_DESCRIPTOR
GET_PARAMETER_SNAPSHOT
GET_UNIT_BUS_ASSIGNMENTS
soraoto_plugin_latency_samples
soraoto_plugin_tail_samples
```

If descriptor/layout/context requirements changed, perform safe-point reconfiguration before processing。

Realtime/automated numeric changes continue to use `SoraotoParameterPointV1`。
String parameters are never carried in the realtime ParameterPoint queue。

### GET_REMOTE_REPRESENTATIONS

response `List<RemoteRepresentationV1>`。

### GET_PHYSICAL_UI_MAPPINGS

response `List<PhysicalUIMapV1>`。

### GET_UNIT_BUS_ASSIGNMENTS

response `List<UnitBusAssignmentV1>`。

### GET_ORCHESTRAL_ARTICULATIONS

response `List<OrchestralArticulationProfileV1>`。

### LOAD_FACTORY_PRESET

request:

```text
{
    "preset_id": UInt32
}
```

成功後 Host は:

```text
GET_DESCRIPTOR
GET_PARAMETER_SNAPSHOT
GET_UNIT_BUS_ASSIGNMENTS
soraoto_plugin_latency_samples
soraoto_plugin_tail_samples
```

を再取得する。

### FORMAT_PARAMETER_VALUE

request:

```text
{
    "parameter_id": UInt32,
    "normalized_value": Float64
}
```

response:

```text
{
    "text": String
}
```

### PARSE_PARAMETER_TEXT

request:

```text
{
    "parameter_id": UInt32,
    "text": String
}
```

response:

```text
{
    "normalized_value": Float64
}
```

### GET_PROGRAM_INFO

request:

```text
{
    "program_list_id": UInt32,
    "program_id": UInt32
}
```

response:

```text
ProgramInfoV1
```

### LOAD_PROGRAM

request:

```text
{
    "program_list_id": UInt32,
    "program_id": UInt32
}
```

成功後 Host は factory preset と同じ再取得 sequence を実行する。

### GET_PITCH_NAME

request:

```text
{
    "program_list_id": UInt32,
    "program_id": UInt32,
    "pitch": Int32
}
```

response:

```text
{
    "name": String
}
```

### GET_PROGRAM_DATA

request:

```text
{
    "program_list_id": UInt32,
    "program_id": UInt32
}
```

response:

```text
{
    "data": Bytes
}
```

`supports_program_data=false` の list は `SORAOTO_E_UNSUPPORTED`。

### SET_PROGRAM_DATA

request:

```text
{
    "program_list_id": UInt32,
    "program_id": UInt32,
    "data": Bytes,

    "meta": {
        "name": String?,
        "category": String?,
        "instrument": String?,
        "style": String?,
        "character": String?,
        "tags": List<String>?,
        "attributes": Map<String, String>?
    }?
}
```

Plugin は operation 全体を transactional に適用する。

success 後:

```text
PROGRAM_LIST_CHANGED
```

を HostRequest で通知する。

### GET_UNIT_DATA

request:

```text
{
    "unit_id": UInt32
}
```

response:

```text
{
    "data": Bytes
}
```

`supports_unit_data=false` は `SORAOTO_E_UNSUPPORTED`。

### SET_UNIT_DATA

request:

```text
{
    "unit_id": UInt32,
    "data": Bytes
}
```

transactional。
成功後 parameter/program/descriptor が変化し得るため Host は:

```text
GET_DESCRIPTOR
GET_PARAMETER_SNAPSHOT
GET_UNIT_BUS_ASSIGNMENTS
latency / tail
```

を再取得する。

### SET_PROGRAM_NAME

request:

```text
{
    "program_list_id": UInt32,
    "program_id": UInt32,
    "name": String
}
```

`mutable_program_names=false` は `SORAOTO_E_UNSUPPORTED`。

成功後 `PROGRAM_LIST_CHANGED`。

### GET_SELECTED_UNIT

request:

```text
null
```

response:

```text
{
    "unit_id": UInt32
}
```

root のみを持つ Plugin は `unit_id=0`。

### SELECT_UNIT

request:

```text
{
    "unit_id": UInt32
}
```

selected unit は Host generic UI / controller surface が対象とする論理 unit。
DSP routing / sound は selection 自体では変化してはならない。

成功後 `UNIT_SELECTION_CHANGED`。

### BEGIN_MIDI_LEARN

request:

```text
{
    "parameter_id": UInt32,
    "event_bus_id": UInt32
}
```

### LEARN_CONTROLLER

request `ControllerLearnInputV1`。BEGIN_MIDI_LEARN の target parameter を使用する。

### END_MIDI_LEARN

request `null`。

### GET_CONTROLLER_MAPPINGS

request `null`、response `List<ControllerMappingDescriptor>`。

### FORMAT_NOTE_EXPRESSION_VALUE

request:

```text
{
    "expression_id": UInt32,

    "value":
        {
            "kind": "numeric",
            "value": Float64
        }
      | {
            "kind": "integer",
            "value": Int64
        }
}
```

response:

```text
{
    "text": String
}
```

`text` expression は `SORAOTO_E_UNSUPPORTED`。

### PARSE_NOTE_EXPRESSION_TEXT

request:

```text
{
    "expression_id": UInt32,
    "text": String
}
```

response:

```text
{
    "value":
        {
            "kind": "numeric",
            "value": Float64
        }
      | {
            "kind": "integer",
            "value": Int64
        }
}
```

numeric/integer expression の format/parse は §27.4.1 と同じ textual-idempotence rule に従う。

unparseable text:

```text
SORAOTO_E_INVALID_ARGUMENT
```
---

---

---

# 24. Plugin Descriptor / Manifest

## 24.1 Static manifest

Plugin binary は custom section:

```text
soraoto.plugin.v1
```

を **ちょうど1個**持つ。

内容:

```text
Deterministic CBOR(PluginDescriptorV1)
```

Host は instance 作成前に custom section を読み、validation する。

## 24.2 Dynamic descriptor

runtime 中に descriptor が変わりうる場合、Plugin は `RESCAN_DESCRIPTOR` HostRequest を出す。

Host は安全点で Processing -> Active -> Configured へ戻し、`GET_DESCRIPTOR` を呼び、再 negotiation する。

Static custom section は initial descriptor。

`GET_DESCRIPTOR` は current descriptor。

## 24.3 PluginDescriptorV1

Normative fields:

```text
PluginDescriptorV1 {
    abi_major: 1
    abi_minor: 0

    id: String
    vendor: String
    name: String
    version: SemVer

    categories: List<String>?
    tags: List<String>?
    homepage: String?

    kinds: List<PluginKind>

    max_instances: UInt32 | null

    compatible_plugin_ids: List<String>

    required_wasm_features: List<String>

    required_host_features: List<String>
    optional_host_features: List<String>

    process_context_requirements: List<ProcessContextRequirement>

    supports_f64: Bool
    supports_in_place: Bool
    deterministic_dsp: Bool

    distributable: Bool

    process_modes: List<PluginProcessMode>
    io_modes: List<PluginIOMode>

    units: List<UnitDescriptor>
    audio_buses: List<AudioBusDescriptor>
    event_buses: List<EventBusDescriptor>
    routing_hints: List<RoutingHintV1>
    parameters: List<ParameterDescriptor>
    controllers: List<ControllerDescriptorV1>

    note_expressions: List<NoteExpressionDescriptor>
    articulations: List<ArticulationDescriptor>
    key_switches: List<KeySwitchDescriptor>
    physical_ui_mappings: List<PhysicalUIMapV1>
    orchestral_articulations: List<OrchestralArticulationProfileV1>

    controller_mappings: List<ControllerMappingDescriptor>
    remote_representations: List<RemoteRepresentationV1>
    data_exchange_queues: List<DataExchangeQueueDescriptorV1>
    parameter_aliases: List<ParameterAliasDescriptor>

    factory_presets: List<FactoryPresetDescriptor>
    program_lists: List<ProgramListDescriptor>

    state: StateDescriptor

    prefetch_support:
        never | supported | state_dependent

    prefetch_support_current: Bool?

    max_event_output_per_block: UInt32
    max_host_requests_per_block: UInt32
    max_asset_requests_per_block: UInt32
    max_data_exchange_packets_per_block: UInt32
}
```

Plugin `id` は reverse-DNS ASCII。

```text
plugin-id =
    label "." label { "." label }

label =
    [A-Za-z0-9]
    { [A-Za-z0-9_-] }
```

最低2 label。
長さは UTF-8 byte count で 3..255。

identity comparison は ASCII byte exact / case-sensitive。

例:

```text
net.daradara.supersynth
```

`compatible_plugin_ids` は、この Plugin が project load 時に replacement として受け入れられる旧 Plugin ID の exact list。

```text
[]
    replacement declaration なし

["com.old.vendor.synth"]
    old id を置換可能
```

Host が replacement を行う場合:

```text
1. old project state / parameter ids を保持
2. new Plugin instance を生成
3. StateLoadContextV1.source_plugin_id に old id を渡す
4. parameter_aliases で automation reference を remap
5. state migration が成功した場合のみ commit
```

Plugin 自身の `id` を `compatible_plugin_ids` に含めてはならない。
重複 ID 禁止。

## 24.4 Process Context Requirements

`ProcessContextRequirement` は CBOR text enum。

Plugin は activate 前に必要 context を `process_context_requirements` で宣言する。

standard values:

```text
transport-state
system-time
continuous-samples
musical-position
bar-position
cycle
tempo
time-signature
chord
scale
frame-rate
samples-to-next-clock
presentation-latency
automation-state
channel-context
```

Host は `project-sample` と configured `sample-rate` を常に提供する。
それ以外は Plugin が要求したものだけを計算してよい。

unknown standard value は descriptor decode/configuration error。
Vendor requirement は `vendor:<reverse-dns-id>:<name>` 形式のみ許可。

requirements は `CONFIGURE -> deactivate` の間は不変。
state/preset load により requirements が変化する場合は `RESCAN_DESCRIPTOR` を要求し再 configure する。

## 24.5 Plugin Process Mode Capability

`PluginProcessMode` is a CBOR text enum:

```text
PluginProcessMode =
    realtime
  | offline
```

Descriptor rules:

```text
process_modes non-empty
unknown value -> descriptor validation error
```

Meaning:

```text
realtime:
    accepts live realtime/prefetch processing class

offline:
    accepts non-realtime/offline rendering or destructive processing
```

`prefetch` is not a separate static capability。
It is a realtime-class scheduling variation controlled by `prefetch_support` / `prefetch_support_current`。

Configuration:

```text
PluginConfig.process_mode = realtime:
    descriptor.process_modes contains realtime

PluginConfig.process_mode = prefetch:
    descriptor.process_modes contains realtime
    and current prefetch support is true

PluginConfig.process_mode = offline:
    descriptor.process_modes contains offline
```

A Plugin may be:

```text
[realtime]
    realtime-only

[offline]
    offline-only

[realtime, offline]
    both
```

Host must reject an unsupported mode before activation rather than probe by entering Processing。

This is the soraoto equivalent of native-plugin declarations such as realtime-only/offline-only processing capability while remaining independent of any one native plugin category string。

## 24.6 Plugin I/O Mode

`PluginIOMode` is a CBOR text enum:

```text
PluginIOMode =
    simple
  | advanced
  | offline
```

Semantics:

```text
simple:
    intended for instrument-style 1 logical event-input -> 1 main audio-output use
    Host activates at most one main input EventBus and one main output AudioBus
    aux/sidechain buses remain inactive

advanced:
    arbitrary descriptor-declared multi-bus routing

offline:
    offline processing/editor-style use where realtime playback routing is not required
```

Rules:

```text
io_modes non-empty
unknown value -> descriptor validation error

simple allowed only when Plugin kinds include instrument, sampler, or generator

offline mode does not replace PluginConfig.process_mode=offline;
it declares that the Plugin supports an offline-oriented I/O topology/profile
```

`PluginConfigV1.io_mode` must be one member of `PluginDescriptorV1.io_modes`.

`distributable=true` means the Plugin declares that its processing instance may be isolated on another Host worker/process/machine provided the Host preserves the complete ABI timing/state/asset contract.

```text
distributable=false:
    Host must keep processing in its local Plugin execution domain
```

This flag does not grant network/filesystem access to Plugin code and does not change sandbox capabilities.

## 24.7 Plugin kind

`PluginKind` は CBOR text enum。

```text
instrument
sampler
effect
generator
analyzer
event_effect
hybrid
```

複数 kind を指定可能。
空 list は descriptor validation error。
unknown kind は同 ABI major では load error。

`max_instances` is required module/class cardinality metadata:

```text
null:
    unlimited by Plugin contract

1..0xffff_fffe:
    maximum simultaneously live instances of this Plugin id
    in one Host process

0 or 0xffff_ffff:
    invalid
```

Host must enforce this limit before `soraoto_plugin_init`。
A failed/Faulted instance still counts until it is terminated。
This is discovery-time metadata and is available from the static manifest before instantiation。

Plugin metadata はさらに:

```text
categories: List<String>
tags: List<String>
homepage: String?
```

を持てる。

これらは discovery 用で DSP semantics には影響しない。

## 24.8 Unit hierarchy

```text
UnitDescriptor {
    id: UInt32
    parent_id: UInt32?
    name: String

    program_list_id: UInt32?
    supports_unit_data: Bool
}
```

root unit:

```text
id = 0
parent_id = null
```

Unit tree constraints:

```text
exactly one root unit
parent_id must exist
cycle prohibited
program_list_id, if present, must reference an existing ProgramListDescriptor
ProgramListDescriptor.unit_id must point back to the same Unit
```

Parameter / EventBus / ProgramList は unit に所属できる。

## 24.9 Stable numeric IDs

以下は Plugin version 間で意味を変えず安定させる。

```text
Parameter id
AudioBus/EventBus id
Unit id
ProgramList id
Program id
FactoryPreset id
Controller id
NoteExpression id
Articulation id
DataExchangeQueue id
```

一度公開した ID を別用途へ再利用してはならない。

ID ranges:

```text
Parameter:
    1 .. 0xffff_fffe
    Plugin-global unique

AudioBus / EventBus:
    1 .. 0xffff_fffe
    one shared Plugin-global bus namespace

Unit:
    0 .. 0xffff_fffe
    Plugin-global unique
    0 = root

ProgramList:
    1 .. 0xffff_fffe
    Plugin-global unique

Program:
    1 .. 0xffff_fffe
    unique within its ProgramList
    identity is (program_list_id, program_id)

FactoryPreset:
    1 .. 0xffff_fffe
    Plugin-global unique

Controller:
    1 .. 0xffff_fffe
    Plugin-global unique

Articulation:
    0 .. 0xffff_fffe
    Plugin-global unique
    0 = no explicit articulation

NoteExpression:
    standard 1..10
    custom >= 0x0001_0000
    Plugin-global unique

DataExchangeQueue:
    1 .. 0xffff_fffe
    Plugin-global unique
```

`0xffff_ffff` is invalid/reserved in every UInt32 ID namespace。

Cross-reference validation:

```text
all unit_id fields reference an existing Unit
all parameter_id fields reference an existing Parameter
all event_bus_id/audio bus ids reference an existing bus of the required media type
all program_list_id/program_id pairs exist
all articulation_id fields are 0 or reference an existing Articulation
all expression_id fields reference an existing NoteExpression
all queue_id fields reference an existing DataExchangeQueue
```

AudioBus ID と EventBus ID は shared bus namespace なので、media typeが異なっても同じnumeric IDを再利用してはならない。

## 24.10 Descriptor mutability / rescan contract

A live Plugin instance may issue descriptor-related HostRequests, but descriptor identity is not arbitrarily mutable。

Immutable until instance termination:

```text
abi_major / abi_minor
id / vendor / version
kinds
max_instances
distributable
io_modes
compatible_plugin_ids
required_wasm_features

Unit ids and parent tree
Parameter ids / paths / types / unit_id
Parameter normalized-domain meaning
ProgramList ids and Unit association
Audio/Event bus ids
Controller ids/paths
```

Parameter semantic range/scale changes for an existing ID are forbidden in a live instance because existing automation/state would change meaning。
A new Plugin version requiring such a change must allocate a new parameter ID/path and use `ParameterAliasDescriptor` only when a deterministic migration exists。

Dynamically mutable with the corresponding notification:

```text
current parameter values
    PARAMETER_VALUES_CHANGED

parameter display metadata:
    name, enum labels, display_precision, function
    PARAMETER_INFO_CHANGED

routing_hints
    ROUTING_INFO_CHANGED

bus names / supported layouts / count / role metadata
    BUS_INFO_CHANGED or RESCAN_DESCRIPTOR
    safe-point graph renegotiation required when topology changes

controller mappings
    CONTROLLER_MAPPING_CHANGED

parameter aliases/remap metadata
    PARAMETER_MAPPING_CHANGED

note-expression / physical UI metadata
    NOTE_EXPRESSION_INFO_CHANGED

key-switch / articulation metadata
    KEYSWITCH_INFO_CHANGED

program names/attributes/content
    PROGRAM_LIST_CHANGED

unit selection
    UNIT_SELECTION_CHANGED

prefetch_support_current
    PREFETCH_SUPPORT_CHANGED

latency / tail
    LATENCY_CHANGED / TAIL_CHANGED
```

`process_context_requirements` may change only while not Processing and requires descriptor rescan + reconfiguration before the next process call。

`required_host_features` may not become stricter after successful initialization; a Plugin that needs a newly-required feature must request `RELOAD_INSTANCE` and the replacement instance may fail cleanly during negotiation。

Factory preset list may add display metadata dynamically, but factory preset IDs are never reused for a different preset within one Plugin version。

---

---

---

# 25. Audio bus / channel layout

## 25.1 AudioBusDescriptor

```text
AudioBusDescriptor {
    id: UInt32
    name: String
    unit_id: UInt32

    direction:
        input | output

    role:
        main | aux | sidechain | analysis | control | custom

    sample_semantics:
        audio | control_voltage

    default_active: Bool
    required: Bool

    supported_layouts: List<ChannelLayout>
}
```

## 25.2 ChannelLayout

`ChannelLayout` は `"kind"` で判別する closed tagged union。

```text
ChannelLayout =
    {
        "kind": "speakers",
        "channels": List<ChannelTag>
    }

  | {
        "kind": "ambisonic",
        "order": UInt8,
        "ordering": "acn",
        "normalization": "sn3d" | "n3d"
    }

  | {
        "kind": "custom",
        "channels": List<{
            "id": String,
            "name": String
        }>
    }
```

unknown `kind` は descriptor/configuration error。

1 bus 最大 channel 数:

```text
64
```

0 channel layout は禁止。

validation:

```text
1 <= channel_count <= 64
duplicate ChannelTag in one `speakers` layout prohibited
duplicate custom channel id prohibited
duplicate identical supported_layouts entry prohibited
ambisonic order <= 7
```

`ChannelTag` は CBOR text enum。

standard registry:

```text
M
L
R
C
LFE
LFE2

Lc
Rc
Lw
Rw
Cs

Ls
Rs
Sl
Sr
Lss
Rss
Lrs
Rrs

Tc
Tfc
Trc
Tfl
Tfr
Tsl
Tsr
Trl
Trr

Bfc
Bfl
Bfr
Brl
Brr
```

意味:

```text
M      mono
L/R    front left/right
C      center
LFE    low-frequency effects channel 1
LFE2   low-frequency effects channel 2

Lc/Rc  left/right center
Lw/Rw  left/right wide
Cs     center surround

Ls/Rs   surround left/right
Sl/Sr     side left/right
Lss/Rss   secondary side surround left/right
Lrs/Rrs rear surround left/right

Tc      top center
Tfc     top front center
Trc     top rear center
Tfl/Tfr top front left/right
Tsl/Tsr top side left/right
Trl/Trr top rear left/right

Bfc     bottom front center
Bfl/Bfr bottom front left/right
Brl/Brr bottom rear left/right
```

standard `speakers` layout では上記 tag のみ使用できる。
それ以外は `custom` layout を使用する。

Standard aliases:

```text
mono     = speakers [M]
stereo   = speakers [L, R]
lcr      = speakers [L, R, C]
quad     = speakers [L, R, Ls, Rs]
5.0      = speakers [L, R, C, Ls, Rs]
5.1      = speakers [L, R, C, LFE, Ls, Rs]
7.1      = speakers [L, R, C, LFE, Ls, Rs, Lrs, Rrs]
7.1.4    = speakers [L, R, C, LFE, Ls, Rs, Lrs, Rrs, Tfl, Tfr, Trl, Trr]
```

Standard alias 以外も `speakers` / `custom` で完全に表現できる。

## 25.3 Arrangement negotiation

Host は各 required bus について descriptor の `supported_layouts` から exact layout を選ぶ。

Project graph が直接一致しない場合の順序:

```text
1. exact layout
2. standard ChannelMixer node で変換可能なら mixer を挿入
3. 不可能なら compile/load error
```

Plugin 自身が暗黙 downmix/upmix をしてはならない。

Concrete active layout は `PluginConfigV1` に固定される。

## 25.4 Dynamic I/O

Plugin が bus 数・layout 候補を変更する場合:

```text
Plugin process
    -> RESCAN_DESCRIPTOR request
Host
    -> stop_processing
    -> deactivate
    -> GET_DESCRIPTOR
    -> graph revalidation
    -> CONFIGURE
    -> activate
    -> start_processing
```

Audio Thread 上で bus table を直接変更してはならない。

## 25.5 Control-voltage audio bus

`sample_semantics: control_voltage` は audio-rate scalar/control signal。

規則:

```text
planar f32/f64 buffer
通常 -1..+1 を推奨
NaN/Inf禁止
speaker layout ではなく custom channel layout を使用
```

Audio signal と CV signal の接続は明示的 converter がない限り compile error。

Plugin は HostRequest:

```text
REQUEST_BUS_ACTIVATE
REQUEST_BUS_DEACTIVATE
```

で bus activation change を要求できる。

Host は graph validity を確認し、要求を受理できる場合のみ safe-point reconfiguration sequence を実行する。

拒否時は active configuration を変更しない。
Plugin は次回 `GET_ACTIVE_CONFIG` / process input を authoritative state とし、request送信だけで activation 成功を仮定してはならない。

## 25.6 Unit / Bus Assignment

```text
UnitBusAssignmentV1 {
    bus_id: UInt32
    channel: UInt16?
    unit_id: UInt32
}
```

`channel = null` は bus 全体。

event bus の channel override が存在する場合、exact channel assignment が bus-level `unit_id` より優先する。

Audio bus は ABI 1.0 では bus-level assignment のみ。

assignment change:

```text
UNIT_BUS_ASSIGNMENT_CHANGED
```

HostRequest を発行し、Host は §29.11 HostRequest safe-point rule に従って Processing を停止してから `GET_UNIT_BUS_ASSIGNMENTS` を再取得する。

存在しない Unit / Bus ID、同じ `(bus_id, channel)` の重複 assignment は descriptor validation error。

## 25.7 Event-to-Audio Routing Hint

multi-output instrument の semantic routing:

```text
RoutingHintV1 {
    event_bus_id: UInt32
    event_channel: UInt16

    audio_bus_id: UInt32
}
```

`event_channel`:

```text
0..15 exact channel
0xffff any channel
```

exact channel が wildcard より優先。

複数 audio bus へ同じ event channel を route する場合は複数 entry を持てる。

これは Host routing / track labeling の hint であり、Plugin DSP内部 routing を強制しない。

routing relation が変化した場合:

```text
ROUTING_INFO_CHANGED
```

を要求し Host は `routing_hints` を再取得する。

---

---

---

# 26. Event bus / note expression

## 26.1 EventBusDescriptor

```text
EventBusDescriptor {
    id: UInt32
    name: String
    direction: input | output
    unit_id: UInt32

    channel_count: UInt16

    channel_unit_overrides: List<{
        channel: UInt16
        unit_id: UInt32
    }>

    dialects: List<EventDialect>
}
```

EventBus validation:

```text
1 <= channel_count <= 65534

dialects:
    non-empty
    exact duplicate prohibited

channel_unit_overrides:
    channel < channel_count
    duplicate channel prohibited
    unit_id exists
```

Realtime native event `channel` field:

```text
0 .. channel_count-1:
    explicit logical channel

0xffff:
    channel-less / not applicable

0xfffe and values >= channel_count:
    invalid unless they are below channel_count
```

A channel-less event may still be routed through a bus with `channel_count >= 1`; `0xffff` means the event is addressed to the bus/unit rather than one logical channel。

`EventDialect` は CBOR text。

standard values:

```text
soraoto-note-v1
soraoto-vocal-v1
midi1
midi2-ump
custom:<reverse-dns-id>
```

`custom:` prefix 以外の unknown dialect は descriptor validation error。

soraotoDSL canonical native event dialects:

```text
soraoto-note-v1:
    generic musical note/expression/controller/harmony events

soraoto-vocal-v1:
    strict superset of soraoto-note-v1
    adds lossless VocalLyricV1 / VocalPhoneme realtime delivery
```

Active EventBus は CONFIGURE 時に exactly one dialect を選択する。

event kind validity:

```text
soraoto-note-v1:
    NOTE_ON
    NOTE_OFF
    NOTE_EXPRESSION
    NOTE_EXPRESSION_INT
    NOTE_EXPRESSION_TEXT
    CONTROLLER
    PROGRAM_CHANGE
    CHORD
    SCALE

soraoto-vocal-v1:
    all soraoto-note-v1 event kinds
    VOCAL_LYRIC
    VOCAL_PHONEME

midi1:
    MIDI1
    SYSEX

midi2-ump:
    MIDI2_UMP

custom:<reverse-dns-id>:
    CUSTOM
    DATA
```

`PARAM_GESTURE_BEGIN/END` は EventBus event ではなく Plugin/Host parameter edit control event。
この2種だけ:

```text
bus_id = 0
```

それ以外の event は active EventBus の non-zero bus ID が必須。

Event dialect negotiation:

```text
explicit raw MIDI source:
    request matching midi1 / midi2-ump dialect

canonical ordinary soraoto event source:
    preference:
        1. soraoto-note-v1
        2. midi2-ump through MIDI Adapter
        3. midi1 through MIDI Adapter

canonical VocalPerformance source carrying lyric/phoneme semantics:
    preference:
        1. soraoto-vocal-v1
        2. explicit Vocal External Adapter
        3. compile/binding error

    soraoto-note-v1 is not an implicit lossy fallback

custom source:
    exact custom:<reverse-dns-id> match required
```

同順位候補が複数ある場合 descriptor `dialects` の最初を選ぶ。
Plugin は `CONFIGURE` response success 後、選択 dialect の event kind だけを受理/生成する。

MIDI は Adapter boundary。

## 26.2 ControllerDescriptorV1

`soraoto-note-v1` の `CONTROLLER` event は Plugin descriptor の controller registry を参照する。

```text
ControllerDescriptorV1 {
    id: UInt32
    path: String
    name: String
    unit_id: UInt32

    default: Float64
}
```

rules:

```text
id:
    1..0xffff_fffe
    Plugin内 unique

path:
    Plugin内 unique
    stable across compatible Plugin versions

value:
    realtime event は normalized Float64 0..1

default:
    0..1
```

Host が異なる Plugin 間で semantic controller を route する場合、numeric ID ではなく `path` を照合し destination ID へ remap する。

一致 path が無ければ explicit Adapter が必要。

## 26.3 NoteExpressionDescriptor

```text
NoteExpressionFlagsV1 {
    bipolar: Bool
    one_shot: Bool
    absolute: Bool
}

NoteExpressionNumericValueV1 {
    kind: "numeric"

    unit: String?

    default: Float64
    min: Float64
    max: Float64

    step_count: UInt32
    display_precision: UInt8?

    flags: NoteExpressionFlagsV1
}

NoteExpressionIntegerValueV1 {
    kind: "integer"

    unit: String?

    default: Int64
    min: Int64
    max: Int64

    display_precision: UInt8?

    flags: NoteExpressionFlagsV1
}

NoteExpressionTextValueV1 {
    kind: "text"

    default: String

    flags: NoteExpressionFlagsV1
}

NoteExpressionDescriptor {
    id: UInt32

    name: String
    short_name: String?

    unit_id: UInt32

    value:
        NoteExpressionNumericValueV1
      | NoteExpressionIntegerValueV1
      | NoteExpressionTextValueV1

    associated_parameter_id: UInt32?
}
```

Validation:

```text
id:
    stable Plugin-global NoteExpression ID

unit_id:
    existing Unit

numeric:
    default/min/max finite
    min < max
    min <= default <= max

    step_count = 0:
        continuous

    step_count > 0:
        exactly step_count + 1 discrete values
        evenly spaced in [min,max]

integer:
    min <= default <= max

text:
    default UTF-8 NFC
    flags.bipolar = false

display_precision:
    null or 0..12

flags.bipolar=true:
    numeric/integer only
    min < 0
    max > 0

associated_parameter_id:
    if present, existing ParameterDescriptor.id
```

Flag semantics:

```text
bipolar:
    Host should present the value around a semantic center/zero

one_shot:
    expression may occur only at the associated NoteOn sample

absolute:
    true  -> absolute semantic setting
    false -> relative/change expression
```

`absolute` は wire arithmetic を自動変更しない。
Host/editor/Adapter が表現・合成方法を判断する semantic metadata。

Associated parameter:

```text
numeric/integer expression:
    may reference a global Parameter with equivalent semantic meaning

text expression:
    associated_parameter_id = null
```

Per-note expression remains note-scoped and must not silently overwrite the associated global parameter。

standard expression IDs:

```text
1   pitch
2   pressure
3   timbre
4   volume
5   pan
6   brightness
7   vibrato
8   expression
9   text
10  phoneme
```

standard value families:

```text
1 pitch:
    numeric
    bipolar = true
    absolute = false
    recommended unit = "semitone"

2 pressure:
    numeric 0..1

3 timbre:
    numeric 0..1

4 volume:
    numeric

5 pan:
    numeric
    bipolar = true

6 brightness:
    numeric 0..1

7 vibrato:
    numeric 0..1

8 expression:
    numeric 0..1

9 text:
    text

10 phoneme:
    text
```

Plugin may choose a narrower range when musically meaningful, but standard semantic direction must not be inverted。

Plugin custom expression:

```text
>= 0x0001_0000
```

MIDI 2.0 Per-Note Controller / Attribute uses custom expression IDs when no standard expression ID applies。

Polyphonic expression is associated with realtime note `event_id`。

Formatting:

```text
numeric/integer:
    FORMAT_NOTE_EXPRESSION_VALUE
    PARSE_NOTE_EXPRESSION_TEXT

text:
    payload itself is display text
```

Default Host formatter may use `unit` and `display_precision` if Plugin does not provide a custom conversion。

## 26.4 ArticulationDescriptor

```text
ArticulationDescriptor {
    id: UInt32

    semantic_id: String?

    name: String
    short_name: String?
    unit_id: UInt32
    category: String?
}
```

`NOTE_ON.articulation_id` はこの numeric `id` を使用する。

`0`:

```text
no explicit articulation
```

Plugin custom articulation ID は `>= 1`。

`semantic_id` は Project/Performance IR の semantic articulation と対応する stable UTF-8 NFC key。

standard examples:

```text
normal
staccato
legato
tenuto
accent
marcato
pizzicato
tremolo
harmonic
mute
```

custom semantic key:

```text
vendor:<reverse-dns-id>:<name>
```

WASM Plugin binding:

```text
Performance/Event IR articulation semantic_id
    -> matching ArticulationDescriptor.semantic_id
    -> numeric ArticulationDescriptor.id
```

exact match が無く、External Plugin Adapterも無い場合は compile/binding error。
display `name` を identity として使用してはならない。

## 26.5 KeySwitchDescriptor

```text
KeySwitchDescriptor {
    articulation_id: UInt32

    event_bus_id: UInt32
    channel: UInt16

    mode:
        before_note
        while_note
        on_release
        key_range

    key_min: UInt8
    key_max: UInt8
    remapped_key: Int16
}
```

`remapped_key = -1` は remap なし。

Host は native articulation event を理解しない external/MIDI path へ lower する場合、この metadata から key switch note event を生成できる。

WASM Plugin 自身は native `articulation_id` を直接受け取るため、内部で key switch へ変換する必要はない。

## 26.6 ControllerMappingDescriptor

MIDI controller -> exported Parameter mapping。

```text
ControllerMappingDescriptor {
    event_bus_id: UInt32

    protocol:
        midi1 | midi2

    group: UInt16
    channel: UInt16

    controller: ControllerSpec
    parameter_id: UInt32
}
```

`ControllerSpec` は `"kind"` で判別する closed tagged union。

```text
ControllerSpec =
    Midi1CcController
  | Midi1PitchBendController
  | Midi1ChannelPressureController
  | Midi1PolyPressureController
  | Midi2RegisteredController
  | Midi2AssignableController
  | Midi2RelativeRegisteredController
  | Midi2RelativeAssignableController
  | Midi2PerNoteRegisteredController
  | Midi2PerNoteAssignableController
```

MIDI 1:

```text
Midi1CcController = {
    "kind": "cc",
    "number": UInt8
}

Midi1PitchBendController = {
    "kind": "pitch_bend"
}

Midi1ChannelPressureController = {
    "kind": "channel_pressure"
}

Midi1PolyPressureController = {
    "kind": "poly_pressure",
    "key": UInt8
}
```

validation:

```text
cc.number: 0..127
poly_pressure.key: 0..127
```

MIDI 2:

```text
Midi2RegisteredController = {
    "kind": "registered_controller",
    "bank": UInt8,
    "index": UInt8
}

Midi2AssignableController = {
    "kind": "assignable_controller",
    "bank": UInt8,
    "index": UInt8
}

Midi2RelativeRegisteredController = {
    "kind": "relative_registered_controller",
    "bank": UInt8,
    "index": UInt8
}

Midi2RelativeAssignableController = {
    "kind": "relative_assignable_controller",
    "bank": UInt8,
    "index": UInt8
}

Midi2PerNoteRegisteredController = {
    "kind": "per_note_registered_controller",
    "index": UInt8
}

Midi2PerNoteAssignableController = {
    "kind": "per_note_assignable_controller",
    "index": UInt8
}
```

unknown `kind` は descriptor/control validation error。

CBOR wire:

```text
cc(n):
    {"kind":"cc","number":UInt8}

pitch_bend:
    {"kind":"pitch_bend"}

channel_pressure:
    {"kind":"channel_pressure"}

poly_pressure(key):
    {"kind":"poly_pressure","key":UInt8}

MIDI2 controller:
    {
      "kind": <exact name above>,
      "bank": UInt8?,
      "index": UInt8
    }
```

range:

```text
group/channel:
    0..15
0xffff:
    wildcard only where descriptor explicitly permits wildcard

MIDI1 CC:
    0..127
key:
    0..127
```

Host は mapping された MIDI controller を raw event として Plugin へ渡さず、`SoraotoParameterPointV1` に変換する。

同時に raw MIDI input を必要とする Plugin は別 event bus/dialect を宣言する。

## 26.7 MIDI Learn

generic Host UI から Plugin mapping を学習できる。

control opcode:

```text
30  BEGIN_MIDI_LEARN
31  LEARN_CONTROLLER
32  END_MIDI_LEARN
33  GET_CONTROLLER_MAPPINGS
```

`BEGIN_MIDI_LEARN` request:

```text
{
    parameter_id
    event_bus_id
}
```

`LEARN_CONTROLLER` request:

```text
ControllerLearnInputV1 {
    protocol: midi1 | midi2
    group: UInt16
    channel: UInt16
    controller: ControllerSpec
}
```

target parameter は直前の BEGIN_MIDI_LEARN で固定する。

Plugin が受理した場合 mapping を persistent state に更新する。

`END_MIDI_LEARN` は request `null`。

`GET_CONTROLLER_MAPPINGS` は `List<ControllerMappingDescriptor>` を返す。

Mapping 変更後 Plugin/Host は current mapping を Project state として保存する。

## 26.8 Physical UI Mapping

```text
PhysicalUIMapV1 {
    event_bus_id: UInt32

    channel: UInt16

    // 0..15 exact channel
    // 0xffff any channel

    physical_ui:
        x
        y
        pressure

    expression_id: UInt32
}
```

range:

```text
x / y / pressure = 0..1
```

同一 `(event_bus_id, channel, physical_ui)` に複数 mapping は禁止。
`channel = 0xffff` より exact 0..15 channel mapping が優先。

Host は MPE / MIDI 2.0 / controller input を native Note Expression へ変換する際に preferred mapping として使用する。

## 26.9 Orchestral Articulation Profile

```text
OrchestralArticulationProfileV1 {
    event_bus_id: UInt32

    channel: UInt16

    // 0..15 exact channel
    // 0xffff any channel

    entries: List<{
        classification_id: UInt16
        subclass_id: UInt16
        variation_id: UInt16

        articulation_id: UInt32
        name: String
    }>
}
```

`classification_id/subclass_id/variation_id` は MIDI-CI Note On Selection of Orchestral Articulation Profile と bridge 可能な numeric identity。

soraoto 内の canonical identity は `articulation_id`。

Host が MIDI 2.0 Orchestral Articulation Attribute を受信した場合、この table で `articulation_id` へ変換する。
未知 classification は raw `MIDI2_UMP` event として渡せる。

---

---

---

# 27. Parameter model

## 27.1 ParameterDescriptor

```text
ParameterDescriptor {
    id: UInt32
    path: String
    name: String
    unit_id: UInt32

    type:
        bool
        int
        enum
        float
        string

    unit:
        none
        norm
        db
        hz
        seconds
        milliseconds
        bpm
        semitone
        cent
        pan
        ratio
        percent

    default:
        Bool | Int64 | Float64 | String

    min: Int64 | Float64 | null
    max: Int64 | Float64 | null

    enum_values: List<String> | null

    scale:
        {
            "kind": "linear"
        }
      | {
            "kind": "log"
        }
      | {
            "kind": "power",
            "exponent": Float64
        }
      | {
            "kind": "piecewise",
            "points": List<ScalePointV1>
        }

    interpolation:
        step
        linear

    automation:
        none
        sample_accurate

    modulation:
        {
            "kind": "none"
        }
      | {
            "kind": "control",
            "max_quantum_samples": UInt32
        }
      | {
            "kind": "audio"
        }

    read_only: Bool
    hidden: Bool
    meter: Bool
    bypass: Bool
    program_selector: Bool
    wrap_around: Bool
    list: Bool

    function: String?
    display_precision: UInt8?
}

ScalePointV1 {
    normalized: Float64
    value: Float64
}
```


descriptor validation:

```text
type=bool:
    default Bool
    min/max/enum_values = null
    scale.kind = linear
    interpolation = step
    modulation.kind = none

type=int:
    default Int64
    min/max Int64 required
    min <= default <= max
    enum_values = null
    scale.kind = linear
    interpolation = step
    modulation.kind = none

type=enum:
    default Int64 index
    min = 0
    max = len(enum_values)-1
    enum_values non-empty
    scale.kind = linear
    interpolation = step
    modulation.kind = none

type=float:
    default Float64 finite
    min/max Float64 finite required
    min < max
    min <= default <= max

type=string:
    default String
    min/max/enum_values = null
    scale.kind = linear
    automation = none
    modulation.kind = none
    interpolation = step

scale.kind=log:
    type=float
    min > 0
    max > 0

scale.kind=power:
    type=float
    exponent finite > 0

scale.kind=piecewise:
    type=float

bypass=true:
    type=bool
    read_only=false
    program_selector=false

program_selector=true:
    type=int or enum
    read_only=false
    automation=none
    modulation.kind=none

    UnitDescriptor(parameter.unit_id).program_list_id must exist

    if type=int:
        min = 0
        max = programs_count - 1
        default is a valid program-list index

    if type=enum:
        len(enum_values) = programs_count
        enum index = program-list index
        default is a valid program-list index

read_only=true:
    automation=none
    modulation.kind=none
    bypass=false
    program_selector=false

meter=true:
    read_only=true

hidden=true:
    read_only=true
    automation=none
    modulation.kind=none

wrap_around=true:
    type=int or enum or float
    read_only=false
    hidden=false

list=true:
    type=bool or int or enum

display_precision:
    null or 0..12
    applies only to default Host text formatting

descriptor-wide:
    at most one bypass=true parameter
```

`path` は Plugin 内で unique。

例:

```text
filter.cutoff
osc1.detune
master.gain
```

## 27.2 Type restrictions

```text
bool / int / enum
    interpolation = step

string
    automation = none
    modulation = none

read_only
    Host -> Plugin parameter input 禁止
    SET_PARAMETER_VALUES 禁止
    input SoraotoParameterPointV1 禁止

hidden
    generic Host UI のparameter listには表示しない
    outside Pluginから変更不可
    read_only=true
    automation=none
    modulation.kind=none
    RemoteRepresentation cellからも操作対象にしてはならない

wrap_around
    generic Host control that moves beyond one endpoint wraps to the opposite endpoint
    wire/control ABI values themselves remain normalized/clamped to 0..1

list
    generic Host UI should present the discrete parameter as a named/list choice

meter
    Plugin -> Host output parameter only
```

`program_selector=true` parameter:

```text
unit =
    ParameterDescriptor.unit_id

program_list =
    UnitDescriptor(unit).program_list_id

discrete selector index =
    ProgramListDescriptor.programs list index
```

A Host write through `SET_PARAMETER_VALUES` is semantically equivalent to `LOAD_PROGRAM` for that indexed program。
The Plugin must not implement different sound/state semantics for the two paths。

`PROGRAM_CHANGE` realtime event is the sample-accurate performance-time mechanism and is separate from the non-realtime program-selector parameter。

## 27.3 Normalized realtime domain

Realtime ABI は numeric parameter を `Float64 0..1` normalized domain で運ぶ。

Typed DSL value は Host が descriptor に従い変換する。

### linear

encode:

```text
n = (v - min) / (max - min)
```

decode:

```text
v = min + n * (max - min)
```

### log

`min > 0 && max > 0` 必須。

encode:

```text
n = ln(v / min) / ln(max / min)
```

decode:

```text
v = min * (max / min) ^ n
```

### power

```text
scale.kind = "power"
scale.exponent > 0
```

decode:

```text
v = min + (max - min) * n ^ exponent
```

encode:

```text
n = ((v - min) / (max - min)) ^ (1 / exponent)
```

### piecewise

```text
scale.kind = "piecewise"
points = [(n0, v0), ...]
```

conditions:

```text
first.normalized = 0
last.normalized  = 1

normalized strictly increasing

first.value = min
last.value  = max

value strictly increasing
all values finite
```

Each interval uses linear interpolation in `(normalized,value)` space。
Encode performs the inverse linear interpolation on the unique interval containing `value`。

### int

```text
N =
    max - min + 1

index =
    min(
        floor(n * N),
        N - 1
    )

value =
    min + index
```

encode integer `value`:

```text
index =
    value - min

n =
    N == 1
    ? 0
    : index / (N - 1)
```

### enum

```text
N =
    len(enum_values)

index =
    min(
        floor(n * N),
        N - 1
    )
```

encode enum index:

```text
n =
    N == 1
    ? 0
    : index / (N - 1)
```

`n=1.0` always maps to the final discrete value。

### bool

```text
n < 0.5  -> false
n >= 0.5 -> true
```

## 27.4 Default text formatting

Plugin custom formatterを使用しない場合:

```text
bool       true / false
int        decimal
enum       enum label
float      fixed decimal using display_precision/default precision + unit
db         "-6.00 dB"
hz         "440.0 Hz" / "2.40 kHz"
seconds    "1.250 s"
milliseconds "12.0 ms"
percent    "50.0 %"
pan        "-1.00..1.00"
```

Default precision when `display_precision = null`:

```text
db            2
hz            1 below 1000 Hz, 2 when displayed as kHz
seconds       3
milliseconds  1
bpm           2
semitone      2
cent          1
pan           2
ratio         3
percent       1
norm/none     3
```

Trailing zeroes are retained by the default formatter。

Plugin は `FORMAT_PARAMETER_VALUE` / `PARSE_PARAMETER_TEXT` で override できる。

override が失敗した場合 Host default を使う。

### 27.4.1 Text conversion round-trip

For every parameter that accepts Host text conversion:

```text
text =
    FORMAT_PARAMETER_VALUE(parameter_id, n)

n2 =
    PARSE_PARAMETER_TEXT(parameter_id, text)
```

must satisfy:

```text
0 <= n2 <= 1
finite
```

and textual idempotence:

```text
FORMAT_PARAMETER_VALUE(parameter_id, n2)
    ==
text
```

after Unicode NFC normalization。

Discrete parameters:

```text
bool / int / enum / list
```

must additionally decode `n` and `n2` to the **same discrete semantic value**。

Continuous parameter formatting may intentionally round to display precision, therefore `n2 == n` bit-for-bit is not required。
However, parse/format must not jump to a different formatted bucket。

Unparseable input text:

```text
PARSE_PARAMETER_TEXT
    -> SORAOTO_E_INVALID_ARGUMENT
```

NaN/Inf text is always invalid。

Default Host formatting/parsing defined by this specification must satisfy the same idempotence rule。

## 27.5 Standard parameter function names

`ParameterDescriptor.function` is a semantic function identifier used by a Host to discover parameters by purpose rather than numeric ID/path.

Standard soraoto/VST-class function identifiers:

```text
comp_gain_reduction
comp_gain_reduction_max
comp_gain_reduction_peak_hold
comp_reset_gain_reduction_max

randomize
randomize_around_current

pan_pos_center_x
pan_pos_center_y
pan_pos_center_z

low_latency_mode
dry_wet_mix

bypass
program
gain
pan
balance
width
mute
tune
tempo
```

VST3 bridge mapping:

```text
kCompGainReduction          -> comp_gain_reduction
kCompGainReductionMax       -> comp_gain_reduction_max
kCompGainReductionPeakHold  -> comp_gain_reduction_peak_hold
kCompResetGainReductionMax  -> comp_reset_gain_reduction_max
kRandomize                  -> randomize
kRandomizeAroundCurrent     -> randomize_around_current
kPanPosCenterX              -> pan_pos_center_x
kPanPosCenterY              -> pan_pos_center_y
kPanPosCenterZ              -> pan_pos_center_z
kLowLatencyMode             -> low_latency_mode
kDryWetMix                  -> dry_wet_mix
```

A function identifier is unique within one `unit_id`:

```text
(unit_id, function) -> at most one parameter
```

For read-only function parameters such as gain-reduction meters, Host uses the mapping for monitoring only and must not write the parameter.

Vendor function:

```text
vendor:<reverse-dns-id>:<name>
```

Host may use function identifiers for generic controller/accessibility/remote-surface mapping.

## 27.6 ParameterAliasDescriptor

Plugin replacement / version migration 用。

```text
ParameterAliasDescriptor {
    source_plugin_id: String
    source_plugin_version: String?
    source_parameter_id: UInt32
    target_parameter_id: UInt32
}
```

Host が旧 Plugin の automation/state parameter reference を新 Plugin へ remap する際に使用する。

同一 `(source_plugin_id, source_plugin_version, source_parameter_id)` に複数 target を定義してはならない。

`source_plugin_version = null` は全version fallback。
exact version mapping が fallback より優先する。

## 27.7 Remote Parameter Presentation

Plugin may publish hardware-controller / generic-host remote layouts without a custom Plugin GUI。

`RemoteRepresentationV1` is the soraoto semantic equivalent of VST Remote Parameter Presentation, but uses Deterministic CBOR rather than VST Remote XML。

```text
RemoteRepresentationV1 {
    id: String

    name: String
    vendor_target: String?
    version: String?

    originator: String?
    comment: String?

    pages: List<RemotePageV1>
}

RemotePageV1 {
    id: String
    name: String

    cells: List<RemoteCellV1>
}

RemoteCellV1 {
    layers: List<RemoteLayerV1>
}
```

A cell may contain multiple layers。
This permits combinations such as:

```text
knob + value display + title
switch + LED
parameter display + page link
```

### RemoteLayerV1

Closed tagged union:

```text
RemoteLayerV1 =
    RemoteParameterControlLayerV1
  | RemoteParameterDisplayLayerV1
  | RemotePageLinkLayerV1
  | RemoteStaticTextLayerV1
```

Parameter control:

```text
RemoteParameterControlLayerV1 {
    kind: "parameter_control"

    parameter_id: UInt32

    control:
        knob
        fader
        switch
        button
        toggle
        menu
        x
        y

    style: String?

    titles: RemoteTitlesV1?
}
```

Parameter display:

```text
RemoteParameterDisplayLayerV1 {
    kind: "parameter_display"

    parameter_id: UInt32

    display:
        value
        title
        value_and_title
        meter
        led

    style: String?

    titles: RemoteTitlesV1?
}
```

Page link:

```text
RemotePageLinkLayerV1 {
    kind: "page_link"

    target_page_id: String
    title: String?
}
```

Static text:

```text
RemoteStaticTextLayerV1 {
    kind: "static_text"

    text: String
}
```

Titles:

```text
RemoteTitlesV1 {
    short: String?
    medium: String?
    long: String?
}
```

All strings are UTF-8 NFC。

### Identity / ordering

Within one representation:

```text
representation id:
    Plugin-global unique

page id:
    unique within representation

page order:
    authored descriptor order

cell order:
    authored descriptor order

layer order:
    bottom -> top presentation order
```

`id` / page IDs are semantic stable identifiers and must not be derived from localized display names。

### Parameter validation

Every `parameter_id` must reference an existing ParameterDescriptor。

Hidden parameter:

```text
hidden=true:
    cannot appear in any RemoteLayer
```

Read-only parameter:

```text
read_only=true:
    allowed only in RemoteParameterDisplayLayerV1
```

Writable parameter:

```text
RemoteParameterControlLayerV1 permitted
RemoteParameterDisplayLayerV1 permitted
```

`meter=true` is normally exposed as:

```text
display = meter | led | value
```

A writable control layer targeting a read-only/meter parameter is descriptor validation error。

### Page links

Every:

```text
target_page_id
```

must resolve to a page in the **same** RemoteRepresentationV1。

Page-link cycles are allowed because a physical remote may navigate back/forth between pages。

### Style

`style` is a semantic hint, not required behavior。

Standard style strings:

```text
single_dot
spread
boost_cut
wrap
momentary
latching
increment
decrement
```

Vendor style:

```text
vendor:<reverse-dns-id>:<name>
```

Unknown style:

```text
Host may ignore while preserving control/display semantics
```

### Host behavior

Host may select a representation by:

```text
vendor_target exact match
representation id
user preference
```

If no representation matches:

```text
Host may synthesize a generic parameter layout
```

Remote representation never changes DSP semantics or parameter identity。

External VST3 bridge may translate VST Remote XML page/cell/layer structures into this model。
Unknown XML-specific visual decoration can be preserved as Adapter metadata, but parameter/page/control/link semantics must not be silently dropped。

---

---

---

# 28. Plugin lifecycle / configuration

## 28.1 State machine

```text
Loaded
  ↓ instantiate
Created
  ↓ soraoto_plugin_init
Initialized
  ↓ CONFIGURE
Configured
  ↓ activate
Active
  ↓ start_processing
Processing
```

Reverse transition:

```text
Processing -> Active
Active -> Configured
Configured -> Initialized
Initialized -> Created
Created -> unloaded
```

## 28.2 Exact startup sequence

```text
1. read + validate soraoto.plugin.v1
2. validate imports/exports/Wasm features
3. instantiate module
4. soraoto_plugin_abi_version
5. soraoto_plugin_init(host_abi)
6. GET_DESCRIPTOR
7. choose bus layouts / sample format / capacities
8. CONFIGURE
9. Host soraoto_alloc process arena
10. soraoto_plugin_activate
11. query latency / tail
12. soraoto_plugin_start_processing
13. zero-frame parameter flush
14. repeated soraoto_plugin_process
```

Shutdown:

```text
1. soraoto_plugin_stop_processing
2. soraoto_plugin_deactivate
3. free Host-owned process arena
4. soraoto_plugin_terminate
5. destroy instance
```

## 28.2.1 Call-state matrix

```text
soraoto_plugin_abi_version
    Created..Processing
    non-mutating

soraoto_plugin_init
    Created only
    non-realtime

soraoto_plugin_control
    Initialized / Configured / Active
    Processingでは不可
    non-realtime

soraoto_alloc / soraoto_free
    Created..Active
    Processingでは不可
    non-realtime

soraoto_plugin_activate
    Configured only
    non-realtime

soraoto_plugin_deactivate
    Active only
    non-realtime

soraoto_plugin_start_processing
    Active only
    realtime-safe

soraoto_plugin_process
    Processing only
    realtime-safe

soraoto_plugin_state_snapshot
    Configured / Active / Processing-between-calls
    non-realtime
    never concurrent with soraoto_plugin_process

soraoto_plugin_latency_samples
soraoto_plugin_tail_samples
    Configured / Active / Processing-between-calls
    realtime-safe

soraoto_plugin_stop_processing
    Processing only
    realtime-safe

soraoto_plugin_reset
    Active only, not Processing
    realtime-safe

soraoto_plugin_state_load
    Configured / Active, not Processing
    non-realtime

soraoto_plugin_terminate
    Initialized only after reverse transition
    non-realtime
```

Host は同一 instance の export を同時に2 thread から呼ばない。

## 28.3 PluginConfigV1

`CONFIGURE` request:

```text
PluginConfigV1 {
    abi: 1

    sample_rate: Float64

    sample_format:
        f32 | f64

    max_frames: UInt32

    process_mode:
        realtime | prefetch | offline

    io_mode:
        simple | advanced | offline

    automation_state:
        none | read | write | read_write

    host_info: HostInfoV1
    host_capabilities: List<String>

    channel_context: ChannelContextV1?

    control_quantum_samples: UInt32

    active_audio_buses: List<ActiveAudioBusV1>
    active_event_buses: List<ActiveEventBusV1>
    data_exchange_queues: List<ActiveDataExchangeQueueV1>

    capacities: ProcessCapacitiesV1
}

HostInfoV1 {
    id: String
    name: String
    vendor: String
    version: SemVer
}

HostInfoV1 rules:

```text
id:
    reverse-DNS stable Host product identifier

name:
    human-readable product name

vendor:
    human-readable vendor name

version:
    Host application version
```

Plugin may use HostInfo only for compatibility workarounds。
It must not assume an unknown Host is unsupported unless a required capability is actually absent。

ChannelContextV1 {
    uid: String
    name: String
    index: Int32
    color_rgba: UInt32

    location:
        pre_fader | post_fader | panner | unknown
}

ActiveAudioBusV1 {
    bus_id: UInt32
    layout: ChannelLayout
    presentation_latency_samples: UInt32
}

ActiveEventBusV1 {
    bus_id: UInt32
    dialect: String
}

ActiveDataExchangeQueueV1 {
    queue_id: UInt32
    block_size: UInt32
    block_count: UInt32

    delivery:
        background | main

    presentation_sync:
        none | output
}

ProcessCapacitiesV1 {
    input_events: UInt32
    output_events: UInt32
    input_parameter_points: UInt32
    output_parameter_points: UInt32
    modulation_buffers: UInt32
    host_requests: UInt32
    asset_requests: UInt32
    asset_completions: UInt32
    data_exchange_packets: UInt32
    input_blob_bytes: UInt32
    output_blob_bytes: UInt32
}
```

`sample_rate > 0`。

`color_rgba` packing:

```text
bits 31..24 = R
bits 23..16 = G
bits 15..8  = B
bits 7..0   = A
```

each channel `0..255`。


`max_frames >= 1`。

process mode validation:

```text
process_mode=realtime:
    PluginDescriptor.process_modes contains realtime

process_mode=prefetch:
    PluginDescriptor.process_modes contains realtime
    prefetch_support_current == true

process_mode=offline:
    PluginDescriptor.process_modes contains offline
```

```text
PluginConfig.io_mode must be listed in PluginDescriptor.io_modes
```

`io_mode=simple` validation:

```text
active main EventBus input count <= 1
active main AudioBus output count <= 1
active aux/sidechain AudioBus count = 0
```

`io_mode=offline` requires:

```text
process_mode = offline
```

Data Exchange queue:

```text
1 <= block_size <= descriptor.block_size_max
block_count >= descriptor.block_count_min

delivery:
    descriptor が要求する delivery と一致

presentation_sync:
    descriptor が要求する mode と一致
```

Host は `block_count_preferred` を満たすことを推奨する。
満たせない場合でも `block_count_min` 以上なら conforming。

Host は Plugin が受け入れられない config を送って `SORAOTO_E_INCOMPATIBLE_LAYOUT` / `SORAOTO_E_UNSUPPORTED` を受けた場合、descriptor にある別候補へ deterministic order で再 negotiation する。


`channel_context` または `automation_state` だけが変更された場合、Host は次の safe point で:

```text
stop_processing
CONFIGURE with same audio/event layout
start_processing
zero-frame parameter flush
```

を行う。

`deactivate` は不要。

Plugin はこの lightweight reconfigure で DSP persistent state を失ってはならない。

## 28.4 Host Capability Registry

Host identity (`HostInfoV1`) is always provided and is not capability-negotiated。

standard optional feature strings:

```text
transport-control
system-time
progress
data-exchange
remote-parameter-presentation
physical-ui-mapping
orchestral-articulation
midi1
midi2-ump
midi-learn1
midi-learn2
midi-mapping1
midi-mapping2
unit-bus-assignment
parameter-remap
channel-context
automation-state
prefetch
offline-processing
audio-presentation-latency
cv-bus
f64
```

Host は `PluginConfigV1.host_capabilities` と `host_query()` で同じ集合を返す。

`required_host_features` が1つでも不足すれば configure error。

`optional_host_features` は graceful degradation 用。

Vendor extension:

```text
vendor:<reverse-dns-id>:<name>
```

## 28.5 Process mode

```text
realtime
prefetch
offline
```

`realtime`:

```text
live playback / recording
requires descriptor process_modes contains realtime
```

`prefetch`:

```text
Host が後続 block を先行計算できる playback mode
```

`offline`:

```text
render/export/DOP
requires descriptor process_modes contains offline
```

`prefetch_support`:

```text
never
    Plugin は prefetch config を拒否

supported
    prefetch を常に受理

state_dependent
    current GET_DESCRIPTOR の prefetch_support_current を参照
```

`state_dependent` descriptor は:

```text
prefetch_support_current: Bool
```

を必須で持つ。

state により変化した場合 Plugin は `PREFETCH_SUPPORT_CHANGED` HostRequest を出し、Host は GET_DESCRIPTOR で再取得する。

Plugin は offline で algorithm quality を上げてよいが、parameter/event/state semantics を変えてはならない。

`prefetch` output は同一 timeline/input に対し realtime と同じ musical result を返さなければならない。

Realtime/prefetch block-mode switching:

```text
Configured process_mode = realtime or prefetch:
    ProcessContext.state_flags.PREFETCH is authoritative for each process call

PREFETCH=0:
    realtime scheduling semantics

PREFETCH=1:
    prefetch scheduling semantics
```

A Host may toggle the `PREFETCH` state flag between process calls without CONFIGURE when:

```text
prefetch_support_current == true
```

The Plugin must therefore not cache realtime-vs-prefetch solely from `PluginConfig.process_mode`。
`PluginConfig.process_mode` establishes the initial/default scheduling mode and validates that the Plugin accepts that class of processing。

Switching to/from `offline` requires stop/deactivate/re-CONFIGURE/activate/start because offline may select a different algorithm/resource model。

## 28.6 Sample format

全 conforming Plugin:

```text
f32 planar
```

を必須サポート。

`supports_f64 == true` の Plugin は:

```text
f64 planar
```

も受け入れる。

Host が f64 graph に f32-only Plugin を挿入する場合、Plugin boundary で explicit `SampleFormatConverter` を挿入する。

## 28.7 Variable block

実 process frame count:

```text
0 <= num_frames <= max_frames
```

`0` は parameter/event flush。

Plugin は固定 block size を仮定してはならない。


## 28.8 Reset

`soraoto_plugin_reset()` は:

```text
Active state
not Processing
```

で呼ぶ。

reset する:

```text
delay/reverb transient buffers
voice runtime state
envelopes/LFO phase where restart semantics require
pending generated events
```

保持する:

```text
persistent parameter values
loaded preset/program
persistent state
asset handles that remain valid
```

`start_processing()` は reset と同等以上の transient initialization を行う。

---

---

---
