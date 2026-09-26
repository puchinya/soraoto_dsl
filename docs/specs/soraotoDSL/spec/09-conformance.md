# Conformance / Completeness

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

---

# 67. Conformance / Validation

仕様準拠を自己申告だけにしない。

## 67.1 Compiler conformance suite

必須 test categories:

```text
lexical
parser
name resolution
type checking
unit checking
bar duration
pitch cursor
harmony resolution
macro deterministic ordering
macro random stability
EventFragment typing/splice/repeat
pattern context isolation
note/drum fragment variable expansion
drum lane repeat/string variable validation
Lyrics exact/prefix alignment
Lyrics melisma/skip/word/phrase boundaries
Lyrics reading/language/phoneme lowering
component graph patch
graph validation
audio clip mapping
performance IR lowering
VocalLyricV1 deterministic lyric_unit_id
MIDI Lyric meta-event export
```

Golden test は:

```text
source
expected AST digest
expected IR digest
expected diagnostics
```

を保持する。

## 67.2 Component ABI conformance

Host test:

```text
WIT world exact match
WASI import absent
WASI-0.2 Component Model feature baseline
Deterministic CBOR rejection cases
GraphPatch transaction rollback
nested component cycle detection
cache determinism
```

Component test:

```text
same input -> byte-identical deterministic GraphPatch CBOR
unknown optional field handling
error code behavior
```

## 67.3 Plugin binary validator

load 前に:

```text
Core Wasm valid
memory32
one exported memory "memory"
declared maximum
no shared memory
no WASI
allowed imports only
required exports exact signature
soraoto.plugin.v1 exactly once
descriptor valid
ID uniqueness
parameter scale/flags valid
NoteExpression descriptor/flags valid
RemoteRepresentation page/cell/layer references valid
ProgramList/ProgramInfo metadata valid
bundle discovery metadata matches nested Plugin descriptor
bus layout valid
state size valid
required Host capabilities satisfiable
```

## 67.4 Realtime ABI validator

必須:

```text
all struct pointer ranges in-bounds
alignment
count <= capacity
sample_offset range
Event.size >= known minimum
blob range in-bounds
output NaN/Inf sanitization
memory.size unchanged during Processing
no forbidden Host import from realtime calls
```

## 67.4.1 Control-plane tests

Every fixed control opcode must have:

```text
valid-state success case
invalid-state SORAOTO_E_BAD_STATE case
size-query case for query opcode
buffer-too-small case
malformed CBOR case
unknown-field forward-compatibility case where applicable
```

Mandatory feature-specific cases:

```text
GET/SET parameter snapshot/value
program/unit data
program rename/unit selection
MIDI learn 1/2 mappings
parameter text format/parse
NoteExpression format/parse
factory preset/program load refresh sequence
```

Validator derives the opcode list from the ABI 1.0 registry (§23.4) and fails if any fixed opcode lacks a test vector。

## 67.5 Lifecycle tests

```text
initialize/configure/activate/start/process/stop/deactivate/terminate
zero-frame process
variable frames
reset
state snapshot during playback between calls
state migration
preset load
preset source-locator context
program load
program-list membership/count change
static/string SET_PARAMETER_VALUES
descriptor rescan
dynamic bus assignment
HostRequest safe-point stop/query/restart
latency/tail change
dirty-state set/clear
fault recovery
```

## 67.6 Audio/event tests

```text
mono/stereo/surround/ambisonic
f32/f64
sidechain
CV bus
sample-accurate parameter
linked edit gesture
control modulation
audio modulation
note on/off
LIVE event flag
NoteOn length hint
numeric/int/text note expression
soraoto-vocal-v1 dialect negotiation
VOCAL_LYRIC payload/string/melisma validation
VOCAL_PHONEME timing/alphabet validation
same-sample NOTE_ON -> VOCAL_LYRIC -> VOCAL_PHONEME ordering
note-expression bipolar/one-shot/absolute behavior
note-expression associated parameter
note-expression format/parse round-trip
physical UI mapping
MIDI1
SysEx
MIDI2 UMP
chord
scale
program
ProgramInfo attributes
RemoteRepresentation multi-layer cells/page links
Data Exchange
```

## 67.7 Realtime safety tests

validator Host は debug mode で:

```text
memory.grow trap
forbidden import trap
deadline/fuel exhaustion
oversized output
invalid pointer
invalid count
```

を injection し fault fallback を確認する。

## 67.8 Clipboard / VST-XML tests

Mandatory:

```text
SoraotoClipboardV1 deterministic CBOR
asset hash resolution
VST-XML-1.4 known element mapping
quarterNotes/seconds projectTime
joined segments
normal/release loops
chords/scales/signatures
raw byte-identical unmodified round-trip
modified semantic regeneration
XML entity/network rejection
```

## 67.9 Interoperability rule

2つの独立 Host implementation と2つの独立 Plugin implementation の cross matrix:

```text
Host A x Plugin A
Host A x Plugin B
Host B x Plugin A
Host B x Plugin B
```

で同じ normative test corpus を通過した時、ABI interoperable とみなす。

## 67.10 Specification closure rule

仕様本文で以下の語を normative requirement の代わりに使用してはならない。

```text
TBD
未確定
後で決める
implementation-defined
host-defined
```

ただし以下は許可:

```text
implementation-dependent quality within explicit tolerance
optional capability with explicit negotiation
resource limit with explicit minimum/maximum
vendor extension with namespace rule
```

これらは仕様穴ではなく規定された variation point。

---

---

---

# 68. Normative Completeness Matrix

This chapter is the **single normative inventory of Draft v0.5 closure**。
Its entries assert coverage only; they do not redefine the semantics owned by §60.0 authority sections。

Draft v0.5 normative closure includes:

```text
Language / composition:
    lexical grammar
    scope / name resolution
    source/ref identity
    type conversion / unit algebra
    Harmony / Chord structural semantics
    Pattern / Function roles
    first-class EventFragment<T> values
    fragment variable/splice/repeat semantics
    Macro stream syntax / semantics
    Standard Macro Library
    Note / Drum / instrument-performance source semantics
    Drum lane/full-pattern repeat
    Lyrics DSL / alignment / melisma / reading / language
    Tempo / Meter / Key maps
    Track / Musical Clip
    Routing / Send
    Automation / Modulation
    Rendering / MIDI export
    MIDI lyric metadata export

Compile-time extension:
    JS Component deterministic profile
    Component package digest
    Component source API
    Component WIT ABI
    Component Model baseline
    Component resource limits
    GraphPatch operations
    nested Component exports/binding
    dependency/cache identity

Canonical IR:
    stable ObjectRef identity
    Provenance
    Note / Chord / Scale Event IR
    VocalLyricV1 / vocal lyric assignment
    instrument Performance IR
    ResolvedGraphV1
    Audio Clip semantics
    Asset registry
    Clipboard / VST-XML interchange

Standard audio processing:
    Gain / Pan / Balance / Width
    ChannelMixer
    EQ
    Compressor
    Limiter
    Delay / StereoDelay
    FeedbackDelay
    SampleFormatConverter
    InterleaveConverter
    StandardBypass
    deterministic processor contracts

WASM Plugin distribution/discovery:
    .wasm / .soraotoplug
    .soraotobundle
    PluginBundleV1
    multiple Plugin classes per bundle
    class cardinality
    compatible Plugin replacement IDs
    distributable declaration

WASM Plugin control/process contract:
    ABI versioning
    Host imports
    required exports
    lifecycle / call-state matrix
    non-reentrant serialization
    control opcode request/response
    static/string parameter write
    descriptor wire semantics
    PluginConfig wire semantics
    realtime/offline process-mode capability
    simple/advanced/offline I/O mode
    Host capability negotiation
    HostInfo
    process-context requirements

Audio/Event/control:
    multiple audio/event buses
    dynamic I/O
    sidechain / aux
    Unit/Bus assignment
    channel layouts / surround / ambisonics
    CV bus semantics
    sample format negotiation
    silence flags / sleep
    in-place processing

Parameters:
    typed parameters
    normalized conversion
    list/wrap/hidden/read-only/bypass/program flags
    sample-accurate automation
    control/audio-rate modulation
    text parse/format
    function-name metadata
    stable path identity
    parameter remap
    linked/group editing
    host-origin editing gesture
    remote parameter presentation

Musical/runtime events:
    Note On/Off
    numeric/int/text Note Expression
    physical UI mapping
    articulation / key switches
    Orchestral Articulation Profile
    semantic Controller events
    MIDI1 / SysEx / MIDI2 UMP
    Program Change
    Chord / Scale
    custom/data event
    soraoto-vocal-v1 lyric/phoneme realtime events

Host integration:
    MIDI mapping / MIDI learn 1/2
    Transport Control
    non-realtime host_request
    current system time
    Audio Presentation Latency
    Channel Context
    Automation State
    Prefetch
    Unit/Bus change
    bus activation request
    restart/rescan notifications
    dirty-state set/clear
    Progress
    Data Exchange

State / program:
    project state snapshot/load
    StateLoadContext
    PresetMetaV1
    .soraotopreset
    factory presets
    Program Lists
    ProgramInfo metadata/attributes
    Pitch Names
    per-program binary data
    per-unit binary data
    Unit selection
    Plugin-version state migration

Realtime robustness:
    asset streaming
    latency / tail / PDC
    bypass
    deadline/fault isolation
    realtime-safe memory/locking rules
    deterministic EventId/random algorithms
    deterministic offline mode

Interoperability:
    Soraoto Deterministic CBOR Profile 1
    fixed struct layouts
    pointer/range/alignment rules
    forward compatibility
    VST 3.8.1 non-GUI functional parity boundary
    conformance corpus/tests
```

No normative item above is intentionally deferred in Draft v0.5。

GUI/editor/view-specific functionality is intentionally out of scope:

```text
custom editor embedding
view resize / content scale
platform window/surface integration
GUI context menu
knob interaction mode
editor snapshots
screen-coordinate parameter finder
request-open-editor
open-help / open-about
GUI run-loop integration
```

Platform-native container mechanics are also not soraoto Plugin ABI:

```text
native VST3 binary loading
VST3 installation/search paths
native signing/notarization
iOS Inter-App Audio application embedding
```

They belong to Host / External Plugin Adapter backends。

Generic Host UI can be built from:

```text
ParameterDescriptor
UnitDescriptor
ProgramListDescriptor
PresetMetaV1
RemoteRepresentationV1
PhysicalUIMapV1
```

Audio/Event/State/Automation/Controller functionality does not require a custom Plugin GUI。

Completeness rule:

```text
if a normative cross-reference, schema type, ABI field,
state transition, wire representation, or non-GUI VST3 3.8.1
functional target cannot be implemented without choosing
an unspecified semantic,
the specification is incomplete and must be revised.
```
