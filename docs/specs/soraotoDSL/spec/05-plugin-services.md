# Plugin Configuration / Preset / Services

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

---

# 30. Plugin Configuration / Preset / Program

## 30.1 DSL-owned Plugin configuration

Compiled DSL configuration and declarative `.soraotopreset` data use `PluginConfigurationV1`.
The `Project` and `Resolved Project IR` are generated in memory and are not save/load formats.

```text
PluginConfigurationV1 {
    bypassed: Bool

    factory_preset_id: UInt32?
    active_unit_id: UInt32?
    program_selections: List<ProgramSelectionV1>
    controller_mappings: List<ControllerMappingDescriptor>

    parameter_values: List<ParameterSnapshotEntryV1>

    assets: List<AssetRef>
}

ProgramSelectionV1 {
    unit_id: UInt32
    program_list_id: UInt32
    program_id: UInt32
}
```

The Host configures the Plugin only from these DSL fields and the Plugin descriptor defaults.
The selected factory preset ID is configuration input; it is not copied into plugin-owned data.
The selected preset owns its complete physical `engine_config` where applicable.

`parameter_values` is the DSL-authored typed CBOR list of values, keyed by stable parameter ID and
optionally by `unit_id` for unit-scoped parameters. It is not a snapshot of live Plugin state.
Missing values come from the selected factory/program configuration and then the descriptor default.
Adding a parameter appends a stable-ID entry; it does not change any existing version number.

No persistent Plugin state blob, state schema, state lookup key, or state snapshot/load operation is
part of the Plugin ABI. Runtime audio memory remains ephemeral and is initialized from the DSL
configuration. Old opaque plugin-state data is unsupported and is not migrated.

## 30.4 PresetMetaV1

```text
PresetMetaV1 {
    name: String?

    category: String?
    tags: List<String>

    author: String?
    comment: String?

    instrument: String?
    style: String?
    character: String?

    preset_type:
        project
        default_preset
        normal_preset
        null

    source_file_name: String?
}
```

`source_file_name` is a portable display/base-name hint only。
A Host-local source path is import-session metadata and is not serialized into Plugin configuration.

All text is UTF-8 NFC。

`tags`:

```text
canonical sort by UTF-8 byte order
exact duplicates removed
```

VST3 preset bridge:

```text
Name              -> name
PlugInCategory    -> category
MusicalInstrument -> instrument
MusicalStyle      -> style
MusicalCharacter  -> character
StateType         -> preset_type
FileName          -> source_file_name
```

A host-local absolute file path is **not** persistent soraoto preset identity and is not written into
portable `SoraotoPresetV1`。
If a native preset bridge exposes such a path, it remains Host-local import metadata only.

## 30.5 Applying Plugin configuration

For each DSL `PluginConfigurationV1`, the Host applies:

```text
1. instantiate the Plugin identified by the graph node
2. CONFIGURE with the current host audio/runtime requirements
3. LOAD_FACTORY_PRESET(factory_preset_id), when present
4. LOAD_PROGRAM for each declared unit/program selection, when present
5. SELECT_UNIT(active_unit_id), when present
6. apply each authored controller mapping using BEGIN_MIDI_LEARN, LEARN_CONTROLLER, and
   END_MIDI_LEARN, when present
7. SET_PARAMETER_VALUES(parameter_values) from the compiled DSL
8. refresh descriptor, parameter, unit assignment, latency, and tail data as required
9. attach automation and modulation from the DSL
10. activate/start processing
```

Omitted optional selections use the Plugin descriptor's declared defaults. Explicit parameter
values in the DSL are applied after the selected preset/program. Runtime construction never reads or
restores Plugin state. A user edit that must survive recompilation updates the DSL/source model; a
runtime-only edit is discarded when that source is compiled again.

## 30.6 DSL compilation and runtime construction

```text
1. read the DSL source and its explicitly imported modules
2. compile a fresh Project and Resolved Project IR in memory
3. build ResolvedGraphV1 from that generated IR
4. validate each declared Plugin selection and parameter value against its descriptor
5. instantiate and configure Plugins using §30.5
6. attach automation/modulation and start processing
```

There is no Project save/load operation, Plugin state restore step, or supported serialized-IR
runtime input. Automation overrides DSL-authored parameter values only during playback. WebPlayer
source convenience storage may retain the DSL text; it does not retain derived Project, IR, graph, or
Plugin runtime data.

## 30.7 User preset format

extension:

```text
.soraotopreset
```

format:

```text
Deterministic CBOR(SoraotoPresetV1)
```

```text
SoraotoPresetV1 {
    format: 1

    plugin_id: String
    plugin_version: SemVer

    meta: PresetMetaV1

    configuration: PluginConfigurationV1
}
```

Preset load applies `configuration` using §30.5. No opaque state bytes or plugin-state schema
identity are present. Old `.soraotopreset` objects that contain opaque state are not supported and
are not migrated; the public format number remains unchanged.

## 30.8 Factory preset

`factory_presets`:

```text
FactoryPresetDescriptor {
    id: UInt32
    meta: PresetMetaV1
}
```

Load:

```text
LOAD_FACTORY_PRESET
```

Factory preset load configures the running Plugin. The Host records the selected preset ID in the
project DSL configuration; the Plugin does not persist a second copy.

## 30.9 Program lists

```text
ProgramInfoV1 {
    id: UInt32
    name: String

    category: String?
    instrument: String?
    style: String?
    character: String?

    tags: List<String>

    attributes: Map<String, String>
}

ProgramListDescriptor {
    id: UInt32
    unit_id: UInt32
    name: String

    mutable_program_names: Bool

    programs: List<ProgramInfoV1>
}
```

Program metadata rules:

```text
ProgramInfoV1.id:
    unique within ProgramList

name/category/instrument/style/character:
    UTF-8 NFC

tags:
    canonical UTF-8 byte-order sort
    exact duplicates removed

attributes:
    arbitrary UTF-8 NFC key/value metadata
    keys unique
```

Standard VST preset/program attribute bridge:

```text
Instrument        -> instrument
MusicalStyle      -> style
MusicalCharacter  -> character
```

Any additional VST ProgramInfo/PresetAttributes key that is not represented by a first-class field is stored in `attributes` using its exact stable bridge key。
The Host must not discard unknown program attributes during native-plugin round-trip。

Program load:

```text
LOAD_PROGRAM
```

sample-accurate program change をサポートする Plugin は `PROGRAM_CHANGE` event を処理する。

The active program and unit selections, and their parameter values, are represented in
`PluginConfigurationV1`. ABI 1.0 does not transport opaque per-program or per-unit data.

サポートしない Plugin は program selection parameter を `step` parameter として持ち、Host は block boundary で変更する。

## 30.10 Pitch names

Drum/sampler 用 pitch name は:

```text
GET_PITCH_NAME
```

で取得する。

request:

```text
program_list_id
program_id
pitch_semitones_integer
```

response:

```text
UTF-8 name
```

---

---

---

# 31. Latency / tail / bypass / realtime safety / fault

## 31.1 Latency

```text
soraoto_plugin_latency_samples() -> i32
```

`>= 0`。

Host は Audio/Event graph 全経路で Plugin Delay Compensation を行う。

Sidechain path も compensation 対象。

Plugin が latency を変更:

```text
LATENCY_CHANGED
```

Host は safe point で再取得し、PDC graph を更新する。

## 31.2 Tail

```text
soraoto_plugin_tail_samples() -> i64
```

意味:

```text
0                    no tail
1..INT64_MAX         finite samples
-1                   infinite tail
```

変更:

```text
TAIL_CHANGED
```

Offline render は finite tail が終了するまで render を継続。

infinite tail は render target の明示 tail limit を使用する。

既定:

```text
10 seconds
```

project/render block で override 可能。

## 31.3 Bypass

Effect/Hybrid Plugin は `bypass: true` Parameter を最大1個公開できる。

公開する場合 Plugin-managed bypass:

```text
process call は継続
latency は維持
sample-accurate bypass change
artifact-free transition
```

公開しない場合 Host が StandardBypass wrapper を挿入する。

StandardBypass:

```text
dry signal
+ Plugin latency samples delay
+ 64-sample equal-power crossfade
```

Instrument/Generator bypass:

```text
audio output = silence
events are consumed
```

EventEffect bypass:

```text
input events pass through unchanged
```

Analyzer bypass:

```text
audio/event through path は unchanged
analysis output のみ停止
```

## 31.4 Silence / sleep

Plugin output bus は `silence_mask` を正確に更新する。

Plugin が全 output silence かつ tail=0 の場合:

```text
process_status_flags.WANTS_SLEEP
```

を set できる。

Host は instance を suspend できる。

Wake conditions:

```text
non-silent audio input
input event
parameter change
modulation input
transport discontinuity
explicit Host wake
```

## 31.5 Realtime forbidden operations

`soraoto_plugin_process` および `start_processing` realtime path:

```text
blocking
filesystem/network
Host asset_* import
memory.grow
unbounded allocation
garbage collection that can pause
mutex waiting
thread creation
sleep
wall clock
Component execution
DSL parsing
dynamic module loading
```

Plugin は process 用 memory を configure/activate 時に事前確保する。

## 31.6 Memory rule

Processing 開始後:

```text
memory.size は stop_processing まで不変
```

Plugin が process 内で `memory.grow` を実行した場合 Host は Plugin fault とする。

## 31.7 Asset URI

Plugin が `asset_open` へ渡せる URI:

```text
asset://<sha256>
plugin://<plugin-id>/<path>
```

任意 `file://` / absolute path / network URL は禁止。

Host は Project Asset Registry と Plugin package resource だけを解決する。

## 31.8 Fault states

以下で instance は `Faulted`:

```text
Wasm trap
invalid ABI write/count
process returned fatal status
memory.grow during Processing
three consecutive process deadline violations
```

non-finite audio sample:

```text
NaN / +Inf / -Inf
```

は Host が Plugin memory から copy する際に `0.0` へ sanitize し、instance ごとに diagnostic を一度出す。

non-finite のみでは Faulted にしない。

## 31.9 Fault fallback

Audio effect/hybrid:

```text
latency-compensated dry bypass
```

Instrument/generator:

```text
silence
```

Event effect:

```text
input event pass-through
```

Analyzer:

```text
through audio/event unchanged
analysis output dropped
```

Host は engine 全体を Plugin fault で停止しない。

## 31.10 Recovery

Host は Faulted instance に対し:

```text
1. create fresh instance
2. CONFIGURE with current host audio/runtime requirements
3. replay preset/program/unit selections and typed parameter values from the current compiled DSL
4. reconnect assets, routing, automation, and modulation
5. activate/start
6. atomically swap at a block boundary and destroy the old instance
```

No data is copied from or restored from the old runtime instance. If no valid compiled DSL
configuration is available, recovery fails and the existing fault fallback remains active.

を 1 回自動試行する。

再度失敗した場合は instance を Disabled にし fallback を維持する。

## 31.11 Deadline

Host は各 `soraoto_plugin_process` の execution deadline を audio graph scheduler deadline 内で監視する。

3 block 連続で deadline を超えた Plugin は Faulted。

単発 xrun は diagnostic と fallback block を発生させるが即 Disabled にはしない。


Conforming Host runtime は runaway Wasm を停止できる execution interruption mechanism を持つ。

実装手段:

```text
fuel
epoch interruption
cancellable isolated worker
```

のいずれでもよいが、Audio Engine thread を無期限に占有させてはならない。

## 31.12 Non-Realtime Host Services

### Host Query

Plugin は:

```text
host_query(feature)
```

で Host capability を問い合わせる。

結果は `PluginConfigV1.host_capabilities` と一致必須。

### System Time

```text
system_time_ns()
```

は ProcessContext `system_time_ns` と同一 monotonic clock domain。

### Progress

長時間の:

```text
sample analysis
asset preprocessing
offline render preparation
```

では `progress_begin/update/end` を使用する。

Audio Thread から呼んではならない。

return contract:

```text
progress_begin:
    >0  progress handle
    <0  status code

progress_update:
    0   success
    <0  status code

progress_end:
    0   success
    <0  status code
```

`progress_update.normalized`:

```text
0.0 .. 1.0
```

Host が `progress` capability を持たない場合 Plugin はこれらを呼ばない。

### Change notification

HostRequest:

```text
RESCAN_DESCRIPTOR
UNIT_BUS_ASSIGNMENT_CHANGED
PARAMETER_MAPPING_CHANGED
NOTE_EXPRESSION_INFO_CHANGED
KEYSWITCH_INFO_CHANGED
CONTROLLER_MAPPING_CHANGED
PREFETCH_SUPPORT_CHANGED
PARAMETER_VALUES_CHANGED
PARAMETER_INFO_CHANGED
BUS_INFO_CHANGED
ROUTING_INFO_CHANGED
RELOAD_INSTANCE
```

は §29.11 HostRequest safe-point rule に従って処理する。

`soraoto_plugin_control` query が必要な notification は:

```text
Processing -> Active
```

へ遷移してから再取得する。

layout / context requirements が変わる場合のみ追加で:

```text
Active -> Configured
CONFIGURE
Configured -> Active
```

cycleを行う。

metadata-only refresh は deactivate/configure を省略できるが、control query 自体に必要な stop/start は省略しない。

## 31.13 Graph cycle

Audio/Event graph は原則 DAG。

feedback edge は:

```text
explicit FeedbackDelay node
minimum delay >= 1 sample
```

を必須とする。

暗黙 zero-delay feedback cycle は compile error。


## 31.14 VST-class non-GUI feature coverage

soraoto WASM Plugin ABI 1.0 の機能対応:

| Native plugin feature area | soraoto ABI 1.0 |
|---|---|
| Audio instrument / effect / generator | Plugin kinds + audio/event buses |
| Multiple / dynamic I/O | descriptor + safe-point rescan |
| Simple / advanced / offline I/O mode | PluginDescriptor.io_modes + PluginConfig.io_mode |
| Sidechain / aux | AudioBus role |
| Surround / ambisonics | ChannelLayout |
| Control-voltage bus | `sample_semantics: control_voltage` |
| f32 / f64 processing | sample format negotiation |
| Realtime-only / offline-only capability | PluginDescriptor.process_modes |
| Variable block size / zero-frame flush | ProcessBlock |
| Sample-accurate automation | ParameterPoint |
| Bypass | Plugin parameter or StandardBypass |
| Silence flags / sleep | silence_mask + WANTS_SLEEP |
| Live-event flag / note length hint | SoraotoRealtimeEventV1.flags.LIVE + NOTE_ON.length_samples_hint |
| Note expression / MPE class semantics | NOTE_EXPRESSION + note_id |
| Note-expression bipolar/one-shot/absolute + associated parameter | NoteExpressionFlagsV1 / associated_parameter_id |
| Note-expression format/parse | control opcodes 34/35 |
| Key switches / articulations | ArticulationDescriptor / KeySwitchDescriptor |
| MIDI 1 / MIDI 2 | event dialects + MIDI1 / MIDI2_UMP |
| Legacy MIDI CC output | CONTROLLER mapping or raw MIDI1 output event |
| Generic semantic controller events | ControllerDescriptorV1 + CONTROLLER |
| MIDI controller mapping | ControllerMappingDescriptor |
| MIDI learn | control opcodes 30..33 |
| Units / multi-timbral structure | UnitDescriptor |
| Program lists / pitch names | ProgramList + GET_PITCH_NAME |
| Program/preset classification attributes | ProgramInfoV1 + PresetMetaV1 |
| Unit selection / change notification | GET/SELECT_UNIT + HostRequest |
| Module info / multi-plug-in distribution | `.soraotobundle` + PluginBundleV1 |
| Plug-in class cardinality | PluginDescriptor.max_instances + bundle discovery metadata |
| Presets / configuration | DSL `PluginConfigurationV1` + `.soraotopreset` |
| Plug-in replacement mapping | compatible_plugin_ids + parameter_aliases |
| Parameter text parse/format | control opcodes |
| Parameter function metadata | `function` |
| Parameter hidden/list/wrap-around flags | ParameterDescriptor flags |
| Parameter ID remap | ParameterAliasDescriptor |
| Channel context | PluginConfig.channel_context |
| Automation state | config + ProcessContext bits |
| Prefetch processing | `process_mode: prefetch` |
| Bus activation request | HostRequest 20/21 |
| Audio presentation latency | config + ProcessContext |
| Plugin latency / tail | required exports + PDC |
| Transport control | HostRequest 10..14 in realtime + non-RT `host_request` import |
| Current monotonic host time | ProcessContext |
| Process context requirements | PluginDescriptor.process_context_requirements |
| Chord / scale / SMPTE / MIDI clock context | SoraotoProcessContextV1 |
| Non-RT system time query | system_time_ns Host import |
| RT→non-RT data exchange | DataExchangeQueue + ProcessBlock packets |
| Remote parameter presentation | RemoteRepresentationV1 |
| Note-expression physical UI mapping | PhysicalUIMapV1 |
| Unit-bus assignment changes | UnitBusAssignmentV1 + HostRequest |
| Host feature query | host_query + host_capabilities |
| Host application identity | PluginConfig.host_info / HostInfoV1 |
| Orchestral articulation profile | OrchestralArticulationProfileV1 |
| Note expression text/int | NOTE_EXPRESSION_TEXT / INT |
| Arbitrary MIDI1 SysEx | SYSEX event |
| Chord / scale events | CHORD / SCALE events |
| Preset meta-information | PresetMetaV1 |
| Processor→host analysis/data | output events / blobs / read-only params |
| Linked parameter edits | bidirectional gesture events + gesture_id |
| Host-origin parameter editing session | input gesture events + ParameterPoint gesture_id |
| Progress reporting | progress_begin/update/end Host imports |
| Musical clipboard interchange | SoraotoClipboardV1 + VST-XML bridge |
| Parameter/bus/routing restart notifications | HostRequest 30..34 + descriptor refresh |
| Offline processing | `process_mode: offline` |
| Remote/distributable processing declaration | PluginDescriptor.distributable |
| Fault isolation | Wasm sandbox + fallback/recovery |

GUI-specific feature areas:

```text
editor embedding
context menu UI
content scaling
UI snapshots
custom plugin GUI
```

は意図的に対象外。

Host は descriptor から generic parameter/preset/program UI を構築できる。

## 31.15 VST 3.8.1 non-GUI parity boundary

Compatibility target:

```text
VST 3.8.1
published 2026-08-11
```

soraoto Plugin ABI 1.0 targets **functional parity for non-GUI plug-in behavior**。
It does **not** claim binary, COM/interface, package-layout, or source-API compatibility with VST3。

### Architectural equivalents

```text
VST IComponent / IAudioProcessor
    ->
soraoto Plugin process plane + lifecycle exports

VST IEditController non-GUI responsibilities
    ->
soraoto Plugin control plane

VST processor/controller state synchronization
    ->
single logical Plugin state model

VST IConnectionPoint / IMessage
    ->
not separately required because soraoto has no mandatory second controller object

small processor -> host/controller values
    ->
output parameter changes / output events

VST beginEdit/performEdit/endEdit
    ->
PARAM_GESTURE_BEGIN / SoraotoParameterPointV1.gesture_id / PARAM_GESTURE_END

VST startGroupEdit/finishGroupEdit
    ->
one shared non-zero gesture_id across multiple writable parameters
    within one BEGIN..END editing session

large realtime -> non-realtime processor data
    ->
Data Exchange

VST IComponentHandler / restartComponent
    ->
SoraotoHostRequestV1 + non-RT host_request()

VST IHostApplication / IPlugInterfaceSupport
    ->
HostInfoV1 + host_query()

VST Module Factory / moduleinfo.json
    ->
.soraotoplug descriptor + .soraotobundle / PluginBundleV1

VST IPluginCompatibility / module compatibility list
    ->
compatible_plugin_ids

VST Units / Program Lists / ProgramListData
    ->
UnitDescriptor / ProgramListDescriptor

VST ParameterInfo / parameter function names
    ->
ParameterDescriptor + function

VST ProcessData / ProcessContext
    ->
SoraotoProcessBlockV1 / SoraotoProcessContextV1
```

### Single-component difference

VST3 may separate audio processor and edit controller and can mark the processor `kDistributable`。
soraoto uses one logical Plugin instance with separate control/process planes。

Therefore these VST architectural mechanics are **not missing functionality**:

```text
processor/controller class-id lookup
processor/controller private connection object
controller component state separate from processor component state
```

The equivalent externally observable behavior is represented by:

```text
one Plugin identity
one declarative DSL configuration model
typed parameters
control requests
HostRequest
Data Exchange
distributable declaration
```

### Intentional GUI exclusions

Out of scope:

```text
custom editor/view creation and embedding
platform window/surface integration
editor resize/content scale
GUI context menu
knob interaction mode
UI snapshots
screen-coordinate parameter finder
request-open-editor
open-help / open-about
GUI run-loop integration
```

These exclusions must not remove audio/event processing, typed DSL configuration, automation, or
controller-mapping functionality。

### Platform/container exclusions

The following are Host/platform integration rather than soraoto Plugin semantic ABI:

```text
native VST3 binary loading
VST3 OS installation/search paths
native code signing/notarization
iOS Inter-App Audio application embedding
```

They may be implemented by an External Plugin Adapter/Host backend and do not change soraoto Project IR。

### Parity closure rule

For the declared VST3 3.8.1 target:

```text
non-GUI externally observable plug-in behavior
    must map to:
        a soraoto ABI feature
        a standard processor/Host service
        or an explicit External Plugin Adapter boundary
```

If a future audit finds a non-GUI VST3 3.8.1 feature that satisfies none of those categories, that is a **soraotoDSL specification defect**, not an implementation choice。

Future VST versions do not implicitly extend ABI 1.0。
They require a specification update and conformance-matrix revision。

---

---

# 49. MIDI / MPE / Generic Event

soraotoDSL内部のcanonical modelはMIDIではない。

```text
NoteEvent / PerformanceEvent
    ↓
Runtime binding
    ↓
SoraotoRealtimeEventV1
```

MIDI 1 / MIDI 2 / MPEはExternal Adapter boundaryでのみ使用する。

## 49.1 Canonical note values

```text
Pitch:
    Float64 semitone position
    C-1 = 0

Velocity / Expression:
    0..1

note identity:
    EventId128 in Project/Performance IR
    bus-local UInt64 event_id in Plugin realtime ABI
```

MIDIへlowerするときだけ整数note/channel/controller表現へ変換する。

## 49.2 MIDI 1 channel-message encoding

7-bit scalar:

```text
u7(x: Norm) =
    clamp(
        round_ties_even(x * 127),
        0,
        127
    )
```

14-bit scalar:

```text
u14(x: Norm) =
    clamp(
        round_ties_even(x * 16383),
        0,
        16383
    )
```

Note velocity:

```text
velocity > 0:
    NoteOn velocity = max(1, u7(velocity))

velocity == 0:
    NoteOn velocity = 1
```

A zero-velocity semantic note is still a note event; it is not rewritten to MIDI NoteOff。

Release velocity:

```text
u7(release_velocity)
```

when source semantics provide it, otherwise:

```text
64
```

MIDI note number for an exactly integral Pitch:

```text
round(Pitch)
```

must be in:

```text
0..127
```

Otherwise MPE/MIDI2 or an explicit Adapter is required。

## 49.3 Raw MIDI 1 event

`SoraotoRealtimeEventV1.MIDI1` supports exactly one complete non-SysEx MIDI 1 message of 1–3 bytes。

Allowed status:

```text
0x80..0xEF   channel voice
0xF1         MTC quarter frame
0xF2         song position
0xF3         song select
0xF6         tune request
0xF8         timing clock
0xFA         start
0xFB         continue
0xFC         stop
0xFE         active sensing
0xFF         system reset
```

Running status is not used in `MIDI1` events。
Each event contains its own status byte。

SysEx:

```text
0xF0 ... 0xF7
```

uses the `SYSEX` event kind and stores the complete byte payload including leading `F0` and trailing `F7`。

Malformed MIDI message is Adapter/export error。

## 49.4 MIDI 2.0 UMP

`MIDI2_UMP` contains 1–4 complete 32-bit UMP words belonging to exactly one UMP message。

Rules:

```text
word_count must match UMP message type
words stored in host-independent numeric UInt32 form
unused words = 0
```

MIDI 2.0 Note On/Off, Per-Note Controller, Registered/Assignable Controller, and Orchestral Articulation attributes may be lowered from canonical soraoto semantic events when a mapping is available。

No MIDI2 byte-stream serialization is part of the WASM Plugin ABI。

## 49.5 MPE lowering

MPE is used only for MIDI 1 targets that need polyphonic expression。

Default zone:

```text
master channel:
    1

member channels:
    2..16
```

If the same MIDI destination is carrying General MIDI drums:

```text
channel 10 excluded from member channels
```

Channel numbers above are human 1-based notation。

One active semantic note owns one member channel from NoteOn through NoteOff。

Allocation:

```text
lowest available member channel
```

released channel becomes available after its NoteOff and all same-sample expression messages have been emitted。

No channel available:

```text
Adapter error
```

Notes are never silently stolen。

## 49.6 MPE pitch bend

Default pitch-bend range:

```text
±48 semitones
```

At adapter initialization emit RPN pitch-bend sensitivity for every member channel。

For semantic pitch:

```text
base_note =
    clamp(round_ties_even(pitch), 0, 127)

delta =
    pitch - base_note
```

If:

```text
abs(delta) > configured_bend_range
```

Adapter attempts another integer `base_note` minimizing `abs(delta)`。

If still out of range:

```text
Adapter error
```

14-bit bend:

```text
normalized =
    clamp(
        delta / bend_range,
        -1,
        1
    )

bend14 =
    clamp(
        round_ties_even(
            8192 + normalized * 8191
        ),
        0,
        16383
    )
```

Center:

```text
8192
```

Per-note pitch curve is sampled at each Project audio sample where the source curve value changes after canonical curve evaluation。
The MIDI Adapter may coalesce only consecutive bend values that quantize to the same 14-bit value。

## 49.7 MPE expression mapping

Standard:

```text
pressure:
    Channel Pressure

timbre:
    CC74

pitch:
    Pitch Bend
```

Values use §49.2 quantization。

Unknown/custom note expression:

```text
explicit External Adapter mapping required
```

otherwise Adapter error。

## 49.8 MIDI 2 semantic lowering

When the destination supports MIDI 2.0:

```text
NoteOn / NoteOff:
    MIDI 2 Channel Voice

pitch expression:
    Per-Note Pitch Bend / defined MIDI2 Per-Note Controller mapping

pressure/timbre/custom:
    NoteExpressionDescriptor / ControllerMappingDescriptor mapping

orchestral articulation:
    OrchestralArticulationProfileV1 mapping
```

MIDI 2 lowering is preferred over MPE when:

```text
destination declares midi2-ump support
```

unless the Adapter profile explicitly forces MIDI1/MPE。

## 49.9 Program and controller lowering

Canonical ProgramChange:

```text
ProgramListDescriptor / program_id
```

to MIDI 1 requires an Adapter mapping:

```text
bank_msb
bank_lsb
program 0..127
```

Canonical semantic controller:

```text
ControllerDescriptorV1.path
```

is mapped through:

```text
ControllerMappingDescriptor
```

or Adapter profile rules。

No numeric controller ID is assumed portable across unrelated Plugins。

## 49.10 Timing

Every MIDI event preserves the source sample offset as long as the destination API supports sample timestamps。

Destination without sample-offset scheduling:

```text
Host queues event for the nearest device scheduling quantum
```

quantization rule:

```text
nearest quantum
ties -> earlier quantum
```

The Host must expose resulting output scheduling latency through the External Adapter node latency so graph/PDC timing remains correct。

---

---

---

# 50. Runtime Plugin Binding / External Plugin Adapter

## 50.1 WASM Plugin binding

WASM Plugin is the native soraotoDSL runtime extension。

```text
Performance/Event IR
    ↓
semantic binding
    ↓
SoraotoRealtimeEventV1
    ↓
WASM Plugin Host
```

Binding uses Plugin descriptor metadata:

```text
event buses
controllers
note expressions
articulations
units
parameters
```

No MIDI conversion occurs when the Plugin consumes `soraoto-note-v1` directly。

## 50.2 External Adapter purpose

Third-party native Plugins, hardware MIDI devices, sound libraries, and protocol-specific instruments use an External Plugin Adapter。

```text
Performance IR
    ↓
ExternalPluginAdapterV1
    ↓
MIDI1 / MPE / MIDI2 / native-plugin parameter+event API
```

DSL / Performance IR never stores vendor-specific keyswitch note numbers or CC numbers directly unless the user explicitly writes an Adapter profile。

## 50.3 Adapter schema

```text
ExternalPluginAdapterV1 {
    id: String
    version: SemVer

    accepts: List<String>

    target: ExternalTargetV1

    articulation_mappings: List<ArticulationMappingV1>
    controller_mappings: List<ExternalControllerMappingV1>
    program_mappings: List<ExternalProgramMappingV1>
    parameter_mappings: List<ExternalParameterMappingV1>

    note_mode:
        direct
        midi1
        mpe
        midi2
}
```

`accepts` contains canonical type identities such as:

```text
soraoto.performance.GuitarPerformance@1
soraoto.performance.BowedStringPerformance@1
soraoto.performance.NotePerformance@1
```

Adapter ID uses reverse-DNS stable identity。

## 50.4 Target

`ExternalTargetV1` is a `"kind"` closed tagged union。

```text
ExternalTargetV1 =
    MidiDeviceTargetV1
  | NativePluginTargetV1

MidiDeviceTargetV1 {
    kind: "midi_device"
    endpoint_id: String

    protocol:
        midi1
        midi2

    latency_samples: UInt32
}

NativePluginTargetV1 {
    kind: "native_plugin"

    format:
        vst3
        au
        aax
        clap

    plugin_id: String

    event_protocol:
        midi1
        midi2
        native

    latency_source:
        {
            "kind": "plugin"
        }
      | {
            "kind": "fixed",
            "samples": UInt32
        }
}
```

The listed native formats are backend target identities, not binary ABIs defined by soraotoDSL。

A Host may support a subset of native formats。
A Project requiring an unavailable target format fails load/compile explicitly。

## 50.5 Articulation mapping

```text
ArticulationMappingV1 {
    semantic_id: String

    actions: List<AdapterActionV1>
}
```

`AdapterActionV1` is a `"kind"` closed tagged union:

```text
AdapterActionV1 =
    {
        "kind": "keyswitch",
        "note": UInt8,
        "velocity": Norm,
        "timing":
            "before_note"
            | "same_sample"
            | "release"
    }
  | {
        "kind": "cc",
        "cc": UInt8,
        "value": Norm
    }
  | {
        "kind": "midi2_controller",
        "controller": ControllerSpec,
        "value": Norm
    }
  | {
        "kind": "program",
        "program_mapping_id": String
    }
  | {
        "kind": "parameter",
        "parameter_mapping_id": String,
        "value": Value
    }
```

validation:

```text
keyswitch note 0..127
cc 0..127
semantic_id unique within Adapter
referenced mapping ids exist
```

## 50.6 Keyswitch timing

`before_note`:

```text
default lead =
    min(10ms, one process block)
```

Host schedules keyswitch before NoteOn by that lead。

If NoteOn is too near project/pickup start:

```text
keyswitch clamped to earliest available sample
```

If target requires a larger lead, Adapter can declare:

```text
keyswitch_lead: Time
```

in target-specific extension data; this contributes to Adapter latency and PDC。

`same_sample`:

```text
keyswitch event ordered before target NoteOn
```

`release`:

```text
keyswitch emitted at source NoteOff
```

## 50.7 Controller mapping

```text
ExternalControllerMappingV1 {
    semantic_path: String

    target:
        {
            "kind": "cc",
            "cc": UInt8
        }
      | {
            "kind": "midi2",
            "controller": ControllerSpec
        }
      | {
            "kind": "native_parameter",
            "parameter_id": String
        }

    scale:
        linear
        inverted
}
```

normalized value:

```text
linear:
    y = x

inverted:
    y = 1-x
```

typed Plugin parameter mapping uses §50.9 instead。

## 50.8 Program mapping

```text
ExternalProgramMappingV1 {
    id: String

    bank_msb: UInt8?
    bank_lsb: UInt8?
    program: UInt8

    native_program_id: String?
}
```

MIDI target:

```text
program required 0..127
bank values optional 0..127
```

Native target may use `native_program_id` instead。

## 50.9 Parameter mapping

```text
ExternalParameterMappingV1 {
    id: String

    semantic_path: String
    native_parameter_id: String

    source_min: Float64
    source_max: Float64

    target_min: Float64
    target_max: Float64

    curve:
        linear
        log
}
```

linear:

```text
u =
    (source - source_min)
    / (source_max - source_min)

target =
    lerp(target_min, target_max, clamp(u,0,1))
```

log requires:

```text
source_min > 0
source_max > 0
target_min > 0
target_max > 0
```

and interpolates in natural-log domain。

## 50.10 Note mapping

`note_mode`:

```text
direct:
    target native API can consume canonical Pitch/NoteExpression semantics

midi1:
    §49 MIDI1 rules
    fractional/per-note expression unsupported unless explicit mappings remove the need

mpe:
    §49 MPE rules

midi2:
    §49 MIDI2 rules
```

Adapter cannot silently round fractional pitch in `midi1` mode。
It must either:

```text
map via explicit pitch mechanism
or
fail
```

## 50.11 Performance-specific mapping

Example Guitar:

```text
GuitarPerformance.technique
    -> articulation semantic_id
    -> Adapter actions
```

String/fret metadata may map to:

```text
vendor keyswitch
vendor CC
native event attribute
```

only through explicit Adapter rules。

Example Bowed Strings:

```text
bow_pressure
bow_speed
vibrato
```

may map to semantic controller paths such as:

```text
strings.bow_pressure
strings.bow_speed
strings.vibrato
```

then through §50.7/§50.9 mappings。

## 50.12 Adapter determinism

Adapter execution is pure。

Inputs:

```text
Adapter profile
Performance/Event IR
Project timing/context
```

Output:

```text
deterministic event/parameter stream
```

Forbidden:

```text
wall clock
unseeded random
network
mutable external state during compile
```

If an Adapter needs humanization, it must use the same keyed deterministic random model as §19.6 with an explicit seed。

## 50.13 Adapter failure

Compile/binding error when:

```text
unsupported Performance type
missing articulation mapping
missing required controller mapping
fractional pitch cannot be represented
polyphonic expression cannot be represented
MPE channel capacity exceeded
native Plugin unavailable
required target parameter/program missing
```

No semantic information may be silently dropped unless the Adapter field explicitly declares:

```text
loss_policy:
    drop
```

for that exact optional semantic channel。

Default:

```text
loss_policy = error
```

## 50.14 Native VST3 backend boundary

A VST3 backend may bind `ExternalTargetV1(kind=native_plugin, format=vst3)` to an installed native VST3 Plugin。

soraotoDSL does not re-declare the VST3 binary ABI。
The backend is responsible for translating:

```text
soraoto Audio/Event graph
Plugin state
Parameter automation
Units / Program Lists
MIDI / Note Expression
Latency / Tail
Sidechain / Bus negotiation
```

to the native VST3 API。

The soraoto Project remains portable because vendor-specific data is confined to:

```text
ExternalPluginAdapterV1
native Plugin state blob
target Plugin identity
```

GUI/editor embedding remains outside soraotoDSL Plugin semantics。

---

---

---

# 59. ABI / Language Conformance

Draft v0.5 は第三者互換実装に必要な normative wire/semantic contract を固定する。

version axes:

```text
soraotoDSL Language:
    Draft v0.5

Component ABI:
    soraoto:component@1.0.0

WASM Plugin ABI:
    1.0
```

## 59.1 Capability negotiation / variation points

次は **仕様済み capability negotiation** であり、実装間の合法なvariation pointである。

```text
f64 support
simd128 requirement
supported channel layouts
active buses
event dialects
audio-rate modulation support
factory presets/program lists
custom note expressions
```

Plugin descriptor が capability を明示し、Host は利用可否を deterministic に決定する。

## 59.2 Forward compatibility

Component:

```text
same Component ABI major required
unknown CBOR fields ignored
required unknown operation -> error
```

Plugin:

```text
same ABI major required
Plugin minor <= Host minor
unknown optional CBOR descriptor fields ignored
unknown required capability -> load error
```

Realtime extensible structs:

```text
SoraotoProcessBlockV1
SoraotoProcessContextV1
SoraotoRealtimeEventV1
```

は `size` を持ち、receiver は自身が知る prefix だけを読む。

ABI 1.0 fixed-size structs:

```text
SoraotoAudioBusBufferV1
SoraotoParameterPointV1
SoraotoModulationBufferV1
SoraotoAssetRequestV1
SoraotoAssetCompletionV1
SoraotoHostRequestV1
SoraotoDataExchangePacketV1
```

は ABI major 内で byte size を変更しない。

reserved field の新規意味は ABI minor capability negotiation 後のみ使用可能。

追加データが必要な場合は ProcessBlock の tail に新 pointer/count field を追加する。

Unknown realtime event `kind`:

```text
Host/Plugin は `size` bytes skip
```

ただし required event dialect で unknown mandatory event を受け取った場合は configuration error。

## 59.3 Source compatibility

Legacy:

```text
import dsp X from "..."
```

is transformed by parser compatibility mode to:

```text
import plugin X from "..."
```

へ変換する。

新規 source の canonical syntax は常に `import plugin`。

## 59.4 No implicit ABI invention

ABI 1.0 の具体 interface / memory layout / encoding は本仕様を唯一の source of truth とする。

実装は独自の:

```text
extra exported symbol requirement
private parameter binary layout
private event layout
private Component WIT world
```

を project portability の必須条件にしてはならない。

Vendor extension は:

```text
custom descriptor field
custom event dialect
custom event kind >= vendor range
```

として namespace 化し、標準 capability がない Host でも Plugin 自体を安全に reject / degrade できるようにする。

---

---

# 60. Consistency Rules

This section defines **cross-cutting consistency rules**。
It does not duplicate the detailed semantics owned by feature chapters。

## 60.0 Semantic authority registry

For a semantic question, the following chapter is the single normative authority:

| Concept | Single semantic authority |
|---|---|
| Function role/type semantics | §18 |
| Pattern / EventFragment / repeat | §16–17 |
| Macro stream semantics | §19 |
| Component source/API/model | §20 |
| Component execution ABI | §21 |
| WASM Plugin package/runtime model | §22–31 |
| Instrument Performance source lowering | §35–40 |
| MIDI/MPE/external native lowering | §49–50 |
| Project/render determinism | §60.3 |
| Formal source grammar/type mechanics | §62 |
| Canonical Performance/Event IR | §63 |
| Audio Clip | §64 |
| Standard processors | §65 |
| Interchange | §66 |
| Conformance requirements | §67 |
| Completeness inventory | §68 |

Rules:

```text
1. A normative semantic/schema definition must have one owning section.

2. Other normative sections:
       reference the owner
       may add only genuinely cross-cutting constraints
       must not restate the owner's signature/schema as a second definition.

3. Non-normative examples/quick references:
       may summarize
       never override the owner.

4. If two normative sections disagree:
       this is specification defect / semantic drift
       not implementation freedom.

5. Renaming/changing an owned semantic:
       update the owner first
       then update references/examples
       validator must reject known stale aliases/signatures.
```

Canonical terminology:

```text
WASM Plugin:
    runtime extension defined by §22–31

Component:
    compile-time extension defined by §20–21

External Plugin Adapter:
    external/vendor/protocol bridge defined by §49–50

Instrument Performance:
    canonical instrument intent model defined by §35–40 / §63
```

`WASM DSP` is only an explanatory legacy term and is not a separate extension type。

`Plugin Adapter` must not mean WASM Plugin Host。
`Adapter` means external/vendor/protocol lowering only。

## 60.1 Compile-time / runtime boundary

```text
Source / fn / pattern / macro / Component
    Audio Thread 禁止

Resolved Project IR
    runtime boundary

WASM Plugin
    Audio Thread 許可
```

## 60.2 Type boundary

```text
DSL / Project IR:
    typed values

Component ABI:
    tagged typed CBOR Value

Plugin control plane:
    Deterministic CBOR

Plugin realtime plane:
    fixed binary structs
    normalized numeric parameters
    planar audio buffers
```

## 60.3 Determinism boundary

```text
Language / Macro / Component:
    deterministic required

Realtime DSP:
    same input/state/context で reproducible を要求
    floating-point bit-identical result は異なる CPU/runtime 間では要求しない
```

Offline render で strict reproducibility が必要な project は:

```text
render {
    deterministic_dsp: true
}
```

を指定できる。

この場合 Host は:

```text
fixed block partition
fixed sample format
fixed Plugin scheduling order
no host monotonic time
fixed random seed
```

を使用する。

Plugin が `deterministic_dsp` capability を満たさない場合 render start 前に error。


`deterministic_dsp: true` の意味:

同一:

```text
Plugin binary
state
input audio/events
parameter/modulation streams
sample format
block partition
ProcessContext
Host ABI major/minor
Wasm runtime numeric semantics
```

に対し同一 output bit pattern を返す。

異なる CPU architecture / Wasm runtime backend 間の bit identity は要求しない。

## 60.4 Normative completeness

The sole normative completeness inventory is **§68**。

This section intentionally does not repeat the list。
Adding/removing a feature from Draft v0.5 closure updates §68 only。

Capability/resource/Host deployment limits describe valid implementation choices inside an already-defined contract。
They do not by themselves mean that a semantic is unspecified。

## 60.5 Anti-drift requirement

The specification validator must check at least:

```text
deprecated semantic aliases/signatures do not reappear

numbered cross-references resolve

named wire schemas are not multiply defined

fixed ABI structs preserve declared sizes

formal EBNF nonterminals are closed
```

Known forbidden stale Pattern role text is any wording that models Pattern output as an untyped generic “Musical Events” result。

Canonical Pattern semantics are owned by §16–17 and use typed `EventFragment<T>`。

A quick-reference/example discrepancy is a documentation defect。
A normative duplicate discrepancy is a specification defect。

---

---

---
