# Project / DAW / Audio / Rendering

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

---

# 32. Project / Arrangement

Project source:

```text
project {
    version: 1
    title: "My Song"

    allow_plugin_transport_control: false

    sample_rate: 48khz
    bit_depth: 24bit

    tempo: 124bpm
    meter: 4/4
    tuning: 440hz
}
```

canonical project configuration:

```text
ProjectConfigV1 {
    version: UInt32 = 1
    title: String

    sample_rate: Hz = 48000hz
    bit_depth: BitDepth = 24bit
    tuning: Hz = 440hz

    tempo: Bpm = 120bpm
    meter: Meter = 4/4

    key: KeyContextV1?

    allow_plugin_transport_control: Bool = false
}
```

constraints:

```text
version = 1
sample_rate > 0
tuning > 0
tempo > 0
```

`allow_plugin_transport_control=false` が default。
true の場合も Plugin transport request は project bounds / loop validity を満たす必要がある。

## 32.1 Timeline origin

Canonical arrangement origin:

```text
1bar = MusicalTime 0/1
```

Pickup は負の `MusicalTime` を使用できる。

```text
pickup event:
    time < 0

normal bar 1:
    time = 0
```

Structure / bar numberingは常に bar 1 から開始し、pickup は bar index をずらさない。

## 32.2 Structure

```text
structure {
    Intro    { bars: 8 }
    Verse.A  { bars: 16 }
    Chorus.A { bars: 16 }
    Verse.B  { bars: 16 }
    Chorus.B { bars: 16 }
    Outro    { bars: 8 }
}
```

Each entry:

```text
StructureSectionV1 {
    name: String
    start_bar: UInt32
    bars: UInt32

    start: MusicalTime
    end: MusicalTime
}
```

rules:

```text
bars >= 1
start_bar is 1-based
section names are fully-qualified source names
duplicate section name -> compile error
sections do not overlap
declaration order = arrangement order
```

First section:

```text
start_bar = 1
```

Each following section:

```text
start_bar =
    previous.start_bar
    + previous.bars
```

`start/end` は Meter Map (§33.2) から解決する。

Section reference:

```text
Verse.A
```

when a timeline position is expected:

```text
section start
```

Section span:

```text
[section.start, section.end)
```

## 32.3 Project end

If `structure` exists:

```text
arrangement_end = final section end
```

notes/clips/automation authored beyond arrangement_end are compile error unless the containing construct explicitly uses `allow_tail` for effect/audio tail semantics。

If `structure` is absent:

```text
arrangement_end =
    maximum authored event/clip/automation endpoint
```

Effect tail is not part of arrangement length and is handled by render tail rules。

An empty project without structure has:

```text
arrangement_end = 0
```

## 32.4 Timeline locator

Position-expected contexts accept:

```text
Nbar
Nbeat
Section.Name
```

semantics:

```text
Nbar:
    N is integer >= 1
    start of the Nth meter bar

Nbeat:
    N >= 0
    N quarter-note beats from bar-1 origin

Section.Name:
    section start
```

`bar` as a duration and `Nbar` as a locator are resolved by expected type。
Ambiguous use without expected position/duration type is compile error。

---

---

---

# 33. Tempo / Meter / Key Maps

Project scalar defaults:

```text
tempo: 124bpm
meter: 4/4
key: C.major
```

All three can become timeline maps。

## 33.1 Tempo Map

Point form:

```text
tempo {
    1bar: 120bpm
    33bar: 124bpm
}
```

Ramp:

```text
tempo {
    33bar -> 41bar {
        120bpm -> 128bpm
        curve: ease_in
    }
}
```

canonical:

```text
TempoSegmentV1 {
    start: MusicalTime
    end: MusicalTime

    start_bpm: Bpm
    end_bpm: Bpm

    curve:
        step
        linear
        ease_in
        ease_out
        ease_in_out
}
```

rules:

```text
segments sorted by start
no overlap
start < end
BPM > 0
```

Point `P: Xbpm` means a step change beginning at P and continuing until the next tempo point/ramp。
Project scalar `tempo` supplies the value before the first explicit tempo-map entry。

Ramp interval is half-open:

```text
[start, end)
```

Ramp endpoint value becomes the step value at `end` unless another explicit entry begins there。

Overlapping ramps or a point strictly inside a ramp are compile error。

### Tempo curve evaluation

Let:

```text
u =
    (beat - start_beat)
    / (end_beat - start_beat)
```

`u` in `0..1`。

curve shaping uses §62.20:

```text
v = curve(u)

bpm(beat) =
    lerp(start_bpm, end_bpm, v)
```

Musical beat -> seconds conversion:

```text
seconds(a,b) =
    integral from beat=a to b of:
        60 / bpm(beat) dbeat
```

Host/Compiler numerical integration must produce timeline sample positions within:

```text
<= 0.25 sample error
```

at the project sample rate。

For `step`, integration is exact constant-tempo arithmetic。
For `linear`, implementation may use the analytic logarithmic integral。
Ease curves may use deterministic adaptive integration meeting the error bound。

## 33.2 Meter Map

Syntax:

```text
meter {
    1bar: 4/4
    33bar: 3/4
    41bar: 4/4
}
```

canonical:

```text
MeterPointV1 {
    bar: UInt32
    at: MusicalTime

    numerator: UInt16
    denominator: UInt16
}
```

rules:

```text
bar >= 1
numerator >= 1
denominator power-of-two in 1..64
strictly increasing bar
meter changes only at bar boundaries
```

Project scalar `meter` applies from bar 1 until the first explicit change。

Bar duration in quarter-note beats:

```text
bar_beats =
    numerator * 4 / denominator
```

Bar locator resolution is sequential and depends only on Meter Map, never on Tempo Map。

## 33.3 Key / Scale Map

Standard source:

```text
key: C.major
```

Map:

```text
key {
    1bar: C.major
    17bar: A.minor
    33bar: D.dorian
}
```

canonical:

```text
KeyContextV1 {
    tonic: PitchClass
    scale_mask: UInt16
    name: String
}

KeyPointV1 {
    at: MusicalTime
    key: KeyContextV1
}
```

`scale_mask` stores pitch-class offsets from tonic:

```text
bit 0  = unison
bit 1  = minor second
...
bit 11 = major seventh
```

bit 0 is required。

standard scale registry:

```text
major:
    0 2 4 5 7 9 11

minor / natural_minor:
    0 2 3 5 7 8 10

harmonic_minor:
    0 2 3 5 7 8 11

melodic_minor:
    0 2 3 5 7 9 11

dorian:
    0 2 3 5 7 9 10

phrygian:
    0 1 3 5 7 8 10

lydian:
    0 2 4 6 7 9 11

mixolydian:
    0 2 4 5 7 9 10

locrian:
    0 1 3 5 6 8 10

major_pentatonic:
    0 2 4 7 9

minor_pentatonic:
    0 3 5 7 10

chromatic:
    0..11
```

`A.minor` is alias of `A.natural_minor`。

Key points are step changes。
They may occur at any valid timeline locator; bar-boundary restriction is not required。

Roman/Nashville harmony resolution uses the KeyContextV1 active at each chord onset。

Core Note DSL relative semitone syntax `+N/-N` is unaffected by Key。

---

---

---

# 34. Track / Musical Clip

Track:

```text
track Lead {
    gain: -8db
    pan: 0.0

    instrument {
        SuperSynth {
            cutoff: 2khz
        }
    }

    Chorus.A {
        notes {
            @8:
            c5 . +2 +2 -3 .,
        }
    }
}
```

canonical:

```text
TrackV1 {
    id: String
    name: String

    gain: Db = 0db
    pan: Pan = 0

    channel_layout: ChannelLayout?

    instrument: PluginRef?
}
```

rules:

```text
track id unique
at most one primary instrument Plugin
audio-only track may have no instrument
instrument Plugin must expose compatible event input + audio output
```

Track gain/pan are Host standard automatable parameters。

## 34.1 Section-scoped content

A section block inside a track:

```text
Chorus.A {
    ...
}
```

desugars to a bounded musical clip:

```text
at:
    section.start

length:
    section.end - section.start

overflow:
    clip
```

Contained event time is relative to section start。

Short content produces silence for the remaining section span。
Events crossing the section end are clipped according to event/clip policy。

Multiple blocks targeting the same section overlay in source order。

## 34.2 Explicit Musical Clip

```text
clip Solo {
    at: 65bar
    length: 8bar

    notes {
        @16:
        c5 . -2 +4,
    }
}
```

canonical:

```text
MusicalClipV1 {
    id: String
    at: MusicalTime

    length: MusicalDuration?

    overflow:
        clip
        allow_tail
        error

    events: List<TypedIRValueV1>
}
```

default:

```text
overflow = clip
```

If `length` omitted:

```text
length =
    max event end
```

Empty clip without explicit length is compile error。

relative event position:

```text
absolute_time =
    clip.at + event.relative_time
```

overflow:

```text
clip:
    truncate note/performance/automation events at clip end

allow_tail:
    event onset must be before clip end
    release/effect/audio tail may extend beyond clip end

error:
    any event endpoint > clip end -> compile error
```

## 34.3 Track layering order

Within one track, overlapping event sources are merged by canonical stream ordering (§19.4)。

Audio clips on the same audio track are summed unless a comping construct (§64.11) selects only one take。

No implicit monophonic conflict resolution is performed。
Monophonic behavior belongs to the receiving Instrument Plugin / Performance Compiler。

---

---

---

# 41. Audio Track / Clip

```text
track VocalAudio {
    clip Verse {
        asset: asset("audio/verse.wav")
        at: Verse.A
    }
}
```

以下の全機能の normative semantics は §64。

```text
trim
clip gain
fade
loop
reverse
transpose
formant
warp
time stretch
slice
takes
comping
```

---

---

---

# 42. Audio / Event / Control Graph

The compiler lowers the authored Project into a typed `ResolvedGraphV1` before realtime execution。

```text
Composition / Performance IR
    ↓
Track / Bus / Component lowering
    ↓
ResolvedGraphV1
    ↓
Plugin binding / standard processors
    ↓
Runtime scheduler
```

## 42.1 Graph schema

```text
ResolvedGraphV1 {
    nodes: List<GraphNodeV1>
    edges: List<GraphEdgeV1>

    master_node_id: String
}
```

Both lists are sorted by stable ID byte order before serialization。

`GraphNodeV1` is a closed tagged union:

```text
GraphNodeV1 =
    TrackNodeV1
  | BusNodeV1
  | PluginNodeV1
  | StandardProcessorNodeV1
  | AudioSourceNodeV1
```

`GraphEdgeV1`:

```text
GraphEdgeV1 =
    AudioEdgeV1
  | EventEdgeV1
  | ControlEdgeV1
  | SidechainEdgeV1
```

Unknown node/edge kind is a Project IR version error。

## 42.2 Stable graph ID

Graph IDs are:

```text
32 lowercase hex characters
128-bit prefix of domain-separated SHA-256
```

Source-authored object:

```text
payload =
    Deterministic-CBOR([
        "soraoto-graph-node-v1",
        source_id_bytes,
        node_kind
    ])

node_id =
    lowercase-hex(
        SHA-256(payload)[0..16]
    )
```

Component-created node uses the Component global ID from §20.5 directly。

Compiler-inserted node:

```text
payload =
    Deterministic-CBOR([
        "soraoto-generated-graph-node-v1",
        parent_origin_id,
        purpose,
        ordinal
    ])
```

Examples of `purpose`:

```text
channel-mixer
sample-format-converter
interleave-converter
send-gain
standard-bypass
feedback-delay
```

`ordinal` is 0-based among generated nodes with the same parent/purpose in canonical lowering order。

## 42.3 Node common fields

```text
GraphNodeHeaderV1 {
    id: String
    name: String?

    origin:
        source
        component
        generated

    provenance: Provenance?
}
```

`id` uniqueness is graph-global。

### TrackNodeV1

```text
TrackNodeV1 {
    kind: "track"
    header: GraphNodeHeaderV1

    input_layout: ChannelLayout?
    output_layout: ChannelLayout

    gain: Db
    pan: Pan?

    balance: Balance?
    width: Width?
}
```

### BusNodeV1

```text
BusNodeV1 {
    kind: "bus"
    header: GraphNodeHeaderV1

    input_layout: ChannelLayout
    output_layout: ChannelLayout

    gain: Db
    balance: Balance?
    width: Width?

    is_master: Bool
}
```

exactly one BusNode has:

```text
is_master = true
id = ResolvedGraphV1.master_node_id
```

### PluginNodeV1

```text
PluginNodeV1 {
    kind: "plugin"
    header: GraphNodeHeaderV1

    implementation:
        {
            "kind": "wasm",
            "plugin_id": String,
            "package_digest": String
        }
      | {
            "kind": "external",
            "adapter_id": String,
            "target_id": String
        }

    role:
        instrument
        effect
        generator
        analyzer
        event_effect
        hybrid

    persistent_instance_key: String
}
```

`persistent_instance_key` is the lookup key for stored Plugin state。
It equals node `id` unless an explicit Project migration preserves an older key。

### StandardProcessorNodeV1

```text
StandardProcessorNodeV1 {
    kind: "standard_processor"
    header: GraphNodeHeaderV1

    processor:
        gain
        pan
        balance
        width
        channel_mixer
        eq
        compressor
        limiter
        delay
        standard_bypass
        feedback_delay
        sample_format_converter
        interleave_converter

    config: Value
}
```

`config` must validate against §65 contract for the selected processor。

### AudioSourceNodeV1

```text
AudioSourceNodeV1 {
    kind: "audio_source"
    header: GraphNodeHeaderV1

    asset: AssetRef
    clip_id: String

    output_layout: ChannelLayout
}
```

AudioClip DSP semantics remain §64; this node is the graph source identity for its rendered stream。

## 42.4 Endpoint

```text
GraphEndpointV1 {
    node_id: String

    port: GraphPortV1
}
```

`GraphPortV1` is a `"kind"` closed tagged union:

```text
GraphPortV1 =
    {
        "kind": "host",
        "name": String
    }
  | {
        "kind": "plugin_audio_bus",
        "bus_id": UInt32
    }
  | {
        "kind": "plugin_event_bus",
        "bus_id": UInt32
    }
  | {
        "kind": "plugin_parameter",
        "parameter_id": UInt32
    }
  | {
        "kind": "control_output",
        "name": String
    }
```

Host standard port names:

```text
audio_in
audio_out
event_in
event_out
control_in
control_out
pre_fader
post_fader
```

Only names defined by the corresponding node kind are valid。

Plugin bus/parameter IDs must exist in the bound Plugin descriptor。

## 42.5 AudioEdgeV1

```text
AudioEdgeV1 {
    kind: "audio"
    id: String

    source: GraphEndpointV1
    target: GraphEndpointV1

    layout: ChannelLayout
}
```

source and target must both be audio endpoints。

The declared `layout` must equal:

```text
source output layout
target input layout
```

after any explicit ChannelMixer。

## 42.6 EventEdgeV1

```text
EventEdgeV1 {
    kind: "event"
    id: String

    source: GraphEndpointV1
    target: GraphEndpointV1

    dialect: EventDialect
}
```

If source/destination dialect differ, an explicit Adapter/converter node must be inserted。
No implicit MIDI conversion exists in a raw EventEdge。

## 42.7 ControlEdgeV1

```text
ControlEdgeV1 {
    kind: "control"
    id: String

    source: GraphEndpointV1
    target: GraphEndpointV1

    rate:
        block
        control
        audio
}
```

Target normally is:

```text
plugin_parameter
or
host control_in
```

Rate conversion must follow the target parameter modulation capability (§48)。

## 42.8 SidechainEdgeV1

```text
SidechainEdgeV1 {
    kind: "sidechain"
    id: String

    source: GraphEndpointV1
    target: GraphEndpointV1

    layout: ChannelLayout
}
```

Target must be a Plugin AudioBus with:

```text
direction = input
role = sidechain
```

SidechainEdge participates in PDC like AudioEdge。

## 42.9 Edge ID

Source-authored edge:

```text
payload =
    Deterministic-CBOR([
        "soraoto-graph-edge-v1",
        routing_source_id_bytes,
        edge_kind,
        ordinal
    ])
```

Component GraphPatch edge:

```text
payload =
    Deterministic-CBOR([
        "soraoto-component-edge-v1",
        invocation_id,
        graph_patch_operation_index
    ])
```

Generated edge:

```text
payload =
    Deterministic-CBOR([
        "soraoto-generated-edge-v1",
        parent_origin_id,
        edge_kind,
        ordinal
    ])
```

All use:

```text
lowercase-hex(SHA-256(payload)[0..16])
```

Duplicate edge ID is compile error。

## 42.10 Send lowering

Authoring `SendV1` (§46) is not retained as an opaque runtime edge。

It lowers to:

```text
source pre/post fader endpoint
    ↓ AudioEdge
Gain standard processor
    ↓ AudioEdge
target Bus
```

The generated Gain node owns the send gain parameter and has a stable generated node ID。

## 42.11 Plugin binding

Performance/Event IR to an instrument Plugin:

```text
Performance/Event IR
    ↓
Event binding
    ↓
EventEdge
    ↓
Plugin event input bus
    ↓
Plugin audio output bus
    ↓
AudioEdge
```

Effect:

```text
AudioEdge
    ↓
Plugin main input bus
    ↓
Plugin process
    ↓
Plugin main output bus
    ↓
AudioEdge
```

## 42.12 Validation order

Compiler validates in this order:

```text
1. unique node IDs
2. unique edge IDs
3. endpoint node existence
4. port existence
5. media/domain compatibility
6. channel layout compatibility
7. EventDialect compatibility
8. required Plugin bus connectivity
9. one Master
10. main-route constraints
11. cycle validation
12. PDC/latency graph construction
13. realtime scheduling feasibility
```

Failure at any stage aborts Resolved Project IR creation。

## 42.13 Graph cycles

Audio/Event/Control graph must be acyclic after treating each explicit `FeedbackDelay` output as a delayed dependency boundary。

Zero-delay cycles:

```text
compile error
```

An event/control cycle is never legalized by FeedbackDelay; only audio cycles may use it unless a future typed delay node is explicitly defined by a later ABI major。

## 42.14 Canonical scheduling order

For nodes with no dependency relation in the same process quantum:

```text
sort by node ID unsigned byte order
```

Incoming audio accumulation:

```text
sort by edge ID unsigned byte order
```

Event merge:

```text
event sample offset
canonical event-kind priority (§29.6)
source edge ID
event_id
```

This ordering is normative for deterministic_dsp mode and recommended otherwise。

---

---

---

# 43. Channel Format / Bus Arrangement

Project IR の channel format は WASM Plugin `ChannelLayout` と同一 model を使う。

```text
speakers
ambisonic
custom
```

Standard aliases:

```text
mono
stereo
lcr
quad
5.0
5.1
7.1
7.1.4
```

最大 64 channels / bus。

Host は layout mismatch を暗黙に無視しない。

必要なら ResolvedGraphV1 に explicit `StandardProcessorNodeV1` を挿入する。

```text
ChannelMixer
SampleFormatConverter
InterleaveConverter
```

Exact processor contracts are §65.2 / §65.9 / §65.10。

WASM Plugin ABI は常に planar。

Project internal native processor が interleaved format を使用する場合、Plugin boundary で `InterleaveConverter` を明示的に入れる。

Mono Track:

```text
pan: -0.2
```

Stereo:

```text
stereo {
    balance: 0.0
    width: 0.9
}
```

Surround pan / ambisonic spatial operation は channel layout aware processor として表現する。

---

---

# 44. Standard Sidechain Component

```text
Sidechain {
    source: AudioSourceRef

    amount: Db
    threshold: Db = -24db

    attack: Time = 5ms
    release: Time = 120ms

    detector:
        peak | rms = rms
}
```

constraints:

```text
amount <= 0db
```

Component は次を生成する。

```text
target
  -> Compressor.main

source
  -> Compressor.sidechain

Compressor:
    threshold = Sidechain.threshold
    ratio = 20
    knee = 6db
    attack/release = Sidechain values
    detector = Sidechain.detector
    max_reduction = abs(amount)
    mix = 1

Compressor
  -> target.output
```

`amount` は最大 ducking attenuation。

`source` bus は Compressor の `role: sidechain` input に接続する。

Sidechain route は PDC 対象。

---

---

---

# 45. Standard StereoDelay Component

```text
import component StereoDelay from "std:components/stereo-delay"
```

props:

```text
StereoDelay {
    time: Time | BeatDuration
    feedback: Norm = 0.35
    mix: Norm = 0.25

    mode:
        stereo
        ping_pong = stereo

    feedback_filter: {
        high_pass: Hz? = null
        low_pass: Hz? = null
    }?
}
```

constraints:

```text
0 <= feedback < 1
0 <= mix <= 1
```

`stereo`:

```text
L delay -> L feedback
R delay -> R feedback
```

`ping_pong`:

```text
L delay -> R feedback
R delay -> L feedback
```

wet/dry:

```text
output =
    dry * (1-mix)
    + wet * mix
```

tempo-synced `time` は block 内 tempo change に対して sample-accurate delay target を生成する。

feedback filter order:

```text
delay output
 -> high-pass if present
 -> low-pass if present
 -> feedback gain
 -> feedback routing
```

Component は standard Delay / EQ primitivesまたは同等contractの WASM Plugin nodeで graph を構築する。

---

---

---

# 46. Routing / Send

Main routing:

```text
routing {
    Guitar -> GuitarBus
    Drums -> DrumBus

    GuitarBus -> Master
    DrumBus -> Master
}
```

Send:

```text
routing {
    Vocal -> VocalDelay {
        gain: -14db
        mode: post_fader
    }
}
```

## 46.1 Canonical signal chain

Track audio path:

```text
source clips / instrument output
    ↓
track insert effects
    ↓
PRE_FADER tap
    ↓
track gain
    ↓
track pan / balance / width
    ↓
POST_FADER tap
    ↓
main output routing
```

Bus:

```text
summed inputs
    ↓
bus insert effects
    ↓
PRE_FADER tap
    ↓
bus gain
    ↓
bus pan/balance/width where applicable
    ↓
POST_FADER tap
    ↓
main output routing
```

`Master` is the unique final audio bus and has no main output。

## 46.2 Main route

Plain:

```text
A -> B
```

means:

```text
A.main_audio_output
    -> B.main_audio_input
```

and defines A's main output route。

Each Track/Bus may have at most one main output route。
For parallel routing, use sends。

Default routing:

```text
Track with no explicit main route:
    -> Master

Bus with no explicit main route:
    -> Master

Master:
    no default route
```

An explicit main route suppresses that source's default route。

## 46.3 Send

Route with send block:

```text
A -> B {
    gain: -12db
    mode: pre_fader
}
```

is a send and **does not** replace A's main route。

Schema:

```text
SendV1 {
    source: AudioSourceRef
    target: BusRef

    gain: Db = 0db

    mode:
        pre_fader
        post_fader
}
```

tap:

```text
pre_fader:
    after source inserts
    before source gain/pan

post_fader:
    after source gain/pan
```

Send gain is applied after the tap and before target bus summing。

Multiple sends from one source are allowed。
Exact duplicate `(source,target,mode)` requires distinct send IDs; otherwise duplicate declaration is compile error。

## 46.4 Explicit Event routing

Project-level event route uses:

```text
Source.events -> Target.events
```

This selects each node's main EventBus。

If a Plugin exposes multiple event buses, high-level DSL must use a Component/Adapter that resolves stable bus IDs; mutable display bus names are not used as project identity。

Audio endpoint to Event endpoint or vice versa is compile error unless an explicit converter node exists。

## 46.5 Sidechain

Sidechain is a distinct edge kind。

Canonical high-level construction:

```text
Sidechain {
    source: Kick
    target: Bass
}
```

lowers to:

```text
AudioEdge source
    -> target Plugin AudioBus(role=sidechain)
```

A normal main route never implicitly becomes sidechain。

## 46.6 Channel layout

For every AudioEdge:

```text
source output layout
target input layout
```

must match。

If mismatch is supported by an explicit standard conversion, Compiler inserts:

```text
ChannelMixer
```

as a visible Resolved Project IR node。

No hidden channel dropping/upmix is allowed。

## 46.7 Graph validity

Required:

```text
all endpoint refs exist
media types match
required Plugin buses connected where required
one main output per Track/Bus
Master unique
```

Cycles are prohibited except through explicit `FeedbackDelay` with delay >= 1 sample (§31.13)。

Routing declaration order does not alter DSP result except where it determines deterministic summing order。

Summing order:

```text
incoming edges sorted by stable edge ID
```

Host uses that order for floating-point accumulation to improve deterministic repeatability。

---

---

---

# 47. Automation

Automation is an authored absolute parameter curve。

Point form:

```text
automation Lead.gain {
    1bar: -12db
    8bar: -6db
}
```

Section ramp:

```text
automation Lead.instrument.cutoff {
    Chorus.A {
        800hz -> 4khz
        curve: ease_in
    }
}
```

## 47.1 Target

Automation target resolves to exactly one typed parameter。

Supported:

```text
Host Track/Bus standard parameter
WASM Plugin ParameterDescriptor
External Plugin Adapter parameter
```

Plugin parameter requires:

```text
automation = sample_accurate
```

`automation = none` -> compile error。

Track/Bus standard parameters:

```text
gain
pan
balance
width
mute
```

are sample-accurate Host parameters。

## 47.2 Authored curve

Canonical:

```text
AutomationCurveV1<T> {
    target: ParameterRef
    points: List<AutomationPointV1<T>>
}

AutomationPointV1<T> {
    at: MusicalTime
    value: T

    interpolation:
        step
        linear
        ease_in
        ease_out
        ease_in_out
}
```

Point syntax without explicit curve uses:

```text
numeric parameter:
    linear

bool / enum / int-discrete:
    step
```

Before first point:

```text
static/current parameter value
```

After last point:

```text
last automation value
```

Same-time authored points:

```text
later source declaration wins
```

Overlapping independently-authored ramp intervals for the same target are compile error。

## 47.3 Section ramp shorthand

```text
Section.Name {
    A -> B
    curve: C
}
```

means exactly:

```text
point at Section.start:
    value A

point approaching Section.end:
    value B

curve C over [start,end)
```

At `Section.end`, B becomes the held value。

Discrete parameter cannot use ramp shorthand with different A/B values。

## 47.4 Typed interpolation domain

Authored interpolation occurs in the parameter's **typed value domain**, not normalized Plugin domain。

Example:

```text
800hz -> 4000hz
```

interpolates Hz。

After evaluating the typed value for a sample, Host converts it through `ParameterDescriptor.scale` to normalized `0..1`。

Therefore a log-scaled parameter does not silently change the authored musical curve。

## 47.5 Musical time -> sample grid

For each authored MusicalTime `t`:

```text
seconds =
    TempoMap.integrate(project_origin, t)

sample_position_real =
    seconds * sample_rate

sample_index =
    round_ties_even(sample_position_real)
```

Negative pickup time is converted with the same rule relative to project sample origin。

Two authored changes quantized to the same sample:

```text
later canonical automation point wins
```

## 47.6 Lowering to Plugin queue

Pipeline:

```text
DSL Curve
    ↓
typed Automation IR
    ↓
sample-grid evaluation
    ↓
normalize typed parameter value
    ↓
SoraotoParameterPointV1
```

Lowering:

```text
step curve:
    one point at each transition

linear typed curve + linear parameter scale:
    endpoints are sufficient

all other curve/scale combinations:
    evaluate every affected sample
    and emit the exact sample-grid normalized value
```

Host may losslessly coalesce consecutive points only when the Plugin's specified interpolation reproduces every omitted sample exactly。

If point capacity is insufficient:

```text
split process block
```

Automation points must never be dropped or tolerance-decimated。

## 47.7 Automation and Plugin-origin edits

Input automation uses:

```text
SoraotoParameterPointV1.gesture_id = 0
```

Plugin/Host interactive linked edits use non-zero gesture IDs (§29.3 / §29.6) and are separate from authored playback automation。

During automation write, recorded Host/Plugin edits are converted back to typed parameter values and become a new authored AutomationCurve after recording stops。

---

---

---

# 48. Modulation

Automation is the absolute base value。
Modulation is a realtime bipolar delta around that base。

Example:

```text
modulation Lead.instrument.cutoff {
    source: lfo {
        shape: sine
        rate: 1/8
        phase: 0.0
    }

    amount: 500hz
}
```

Canonical:

```text
ModulationBindingV1 {
    target: ParameterRef
    source: ModulationSource
    amount: Value
}
```

## 48.1 Capability

Parameter descriptor `modulation.kind`:

```text
none
control
audio
```

`none` -> compile error when a modulation binding targets it。

`control` requires:

```text
max_quantum_samples >= 1
```

`audio` uses one sample per project audio frame。

## 48.2 LFO

Source:

```text
lfo {
    shape: sine
    rate: 1/8
    phase: 0
}
```

Schema:

```text
LfoSourceV1 {
    shape:
        sine
        triangle
        saw
        square
        sample_hold

    rate:
        Hz | BeatDuration

    phase: Norm = 0

    seed: UInt64?
}
```

`rate: Hz`:

```text
cycles per second
```

`rate: BeatDuration`:

```text
one LFO cycle per specified musical duration
tempo-synchronized sample accurately
```

phase:

```text
p = fractional(cycle_position + phase)
0 <= p < 1
```

shapes output `-1..1`:

```text
sine:
    sin(2*pi*p)

triangle:
    1 - 4*abs(p - 0.5)

saw:
    2*p - 1

square:
    -1 for p < 0.5
    +1 otherwise

sample_hold:
    2 * rand(seed, ("lfo-sample-hold", cycle_index)) - 1
```

`sample_hold` requires `seed`。
Other shapes ignore `seed`。

LFO phase resets at:

```text
project transport epoch start
```

Transport locate/discontinuity recomputes phase from absolute project musical/sample position; it does not depend on previous process block history。

## 48.3 Envelope

```text
envelope {
    attack: 10ms
    decay: 100ms
    sustain: 0.7
    release: 200ms
}
```

Schema:

```text
EnvelopeSourceV1 {
    attack: Time
    decay: Time
    sustain: Norm
    release: Time
}
```

This is a monophonic aggregate ADSR driven by the owning track's note stream。

```text
first active NoteOn:
    start/retrigger attack from current envelope value

additional NoteOn while notes active:
    retrigger attack from current value

when active note count becomes 0:
    enter release

attack:
    linear current -> 1

decay:
    linear 1 -> sustain

sustain:
    held until release

release:
    linear current -> 0
```

All times >= 0。
A track with no note/event stream cannot use this envelope source。

## 48.4 Ref source

```text
ref {
    source: SomeControlNode
    output: "mod"
}
```

must resolve to a ControlEdge source producing one finite bipolar scalar per sample:

```text
-1..1
```

Out-of-range values are clamped。

## 48.5 Amount

Unitless amount for a normalized parameter:

```text
amount = Norm
```

Typed amount:

```text
cutoff base = 1000hz
amount = 500hz
```

For source `m` in `-1..1`:

```text
typed_target =
    base + m * amount

normalized_delta =
    normalize(clamp_to_parameter_range(typed_target))
    - normalize(base)
```

Final:

```text
normalized_final =
    clamp(
        normalized_automation_base
        + sum(all normalized modulation deltas),
        0,
        1
    )
```

Multiple modulation sources are summed in stable binding-ID order。

## 48.6 Control-rate lowering

For:

```text
modulation.kind = control
```

Host quantum:

```text
q =
    min(
        descriptor.max_quantum_samples,
        PluginConfig.control_quantum_samples
    )
```

Host samples the source at each quantum boundary and emits the resulting final normalized value as `SoraotoParameterPointV1`。

If parameter interpolation is linear, Plugin interpolates between quantum points。
For step interpolation, value changes at each quantum boundary。

## 48.7 Audio-rate lowering

For:

```text
modulation.kind = audio
```

Host pre-combines all sources for a target into one `SoraotoModulationBufferV1`。

Each buffer sample:

```text
-1..1 source-domain signal
```

`depth_norm` carries the normalized depth only when a single symmetric normalized amount is representable。
For typed/nonlinear/multiple-source modulation, Host precomputes the final normalized delta in the buffer and sets:

```text
depth_norm = 1
```

No per-sample modulation event may allocate or block the Audio Thread。

---

---

---

# 51. Assets / Bindings / User Types

## 51.1 Asset declaration

```text
assets {
    Vocal = "audio/vocal.wav"
    Kick = "samples/kick.wav"
}
```

Source path is resolved relative to the declaring module directory and must remain inside project root unless the project explicitly grants an external asset root。

Compiler reads exact file bytes and registers:

```text
AssetEntryV1 {
    ref: AssetRef

    source_uri: String
    byte_size: UInt64

    media_type: String

    audio: AudioAssetInfoV1?
}
```

`AssetRef` is §20.5:

```text
sha256:
    SHA-256 of exact file bytes

logical_name:
    source binding name when one exists
```

Canonical Plugin URI:

```text
asset://<64-lowercase-hex-sha256>
```

Moving a Project does not change asset identity when bytes are unchanged。

## 51.2 `asset()` compile-time function

```text
asset(path: String) -> AssetRef
```

`path` resolution uses the same rules as an `assets {}` declaration:

```text
relative to declaring module
normalized inside project root
external root only when explicitly granted
```

Compiler:

```text
1. resolves file
2. reads exact bytes
3. computes SHA-256
4. registers/deduplicates AssetEntryV1 by content hash
5. returns AssetRef
```

Same content referenced through different source paths has the same `sha256` identity。

`asset()` is:

```text
compile-time only
pure with respect to the declared project filesystem snapshot
```

The project compile input digest includes every resolved asset content hash, so cache validity does not depend on wall-clock/file timestamp。

Missing/unreadable path is compile error。

## 51.3 Audio asset metadata

```text
AudioAssetInfoV1 {
    sample_rate: Hz
    channel_layout: ChannelLayout

    frames: UInt64

    sample_encoding:
        pcm_s16
        pcm_s24
        pcm_s32
        float32
        float64
        flac
}
```

duration:

```text
seconds =
    frames / sample_rate
```

All decoded samples are converted to finite normalized Float64 semantic sample values for offline/reference processing and Float32/Float64 graph format at runtime。

Integer PCM mapping:

```text
signed_min -> -1.0
0          ->  0.0
signed_max -> signed_max / 2^(bits-1)
```

Thus positive full-scale integer is slightly below +1.0, matching standard two's-complement PCM normalization。

## 51.4 Mandatory audio decode profile

Every conforming soraotoDSL implementation supports:

```text
RIFF/WAVE
RF64/WAVE

PCM:
    16-bit
    24-bit
    32-bit signed integer

IEEE float:
    32-bit
    64-bit
```

required channel metadata:

```text
mono
stereo
WAVE_FORMAT_EXTENSIBLE speaker mask layouts representable by ChannelTag
```

Optional decoder capability may add:

```text
FLAC
AIFF/AIFC
AAC
MP3
Opus
other
```

Optional media type unsupported by the current Host is a compile/load error, never silent substitution。

For lossless formats, decoded PCM must represent the exact encoded sample values according to the format specification。
Lossy decoder sample-level identity across independent libraries is not required; timeline/frame count/channel metadata semantics are required。

## 51.5 Asset integrity

On Project load:

```text
actual SHA-256 != AssetRef.sha256
    -> asset integrity error
```

Missing asset:

```text
compile/load error
```

Host may relink a missing source path only when candidate bytes match the required hash。
Relinking by file name alone is forbidden。

## 51.6 Plugin package imports

Resource-bearing Plugin:

```text
import plugin SuperSynth
from "./plugins/SuperSynth.soraotoplug"
```

Single binary:

```text
import plugin TinySynth
from "./plugins/tiny-synth.wasm"
```

Bundle:

```text
import plugin SuperSynth
from "./Suite.soraotobundle#net.vendor.super-synth"
```

Package formats and digests are §22.1。

## 51.7 Immutable bindings

```text
let ROOT = c4
let BPM = 124bpm
```

`let` initializer must be compile-time pure and evaluable。
The binding is immutable; its inferred type is fixed for the binding scope。

## 51.8 User types

```text
struct ChordSpec {
    root: Pitch
    intervals: List<Interval>
}
```

```text
enum Articulation {
    Normal
    Staccato
    Legato
}
```

User type identity:

```text
<normalized-module-uri>::<type-name>
```

Struct field order is source declaration order for source reflection, but CBOR record ordering follows §61 map-key ordering。

Enum wire identity used by `Hashable`:

```text
type:
    fully-qualified type identity

case:
    source case name
```

---

---

---

# 52. Rendering / Export

## 52.1 WAV render

```text
render Main {
    format: wav
    sample_rate: 48khz
    bit_depth: 24bit
    normalize: false
}
```

Schema:

```text
RenderWavV1 {
    name: String

    sample_rate: Hz
    bit_depth: BitDepth

    normalize: Bool = false
    dither_seed: UInt64 = 0

    tail_limit: Time = 10s
}
```

Render interval:

```text
project_start
through
arrangement_end + required finite tails
```

Infinite-tail Plugin:

```text
render at most tail_limit after arrangement_end
```

`tail_limit >= 0`。

All Plugins are configured with:

```text
process_mode = offline
```

Audio/Event/Automation/Sidechain/PDC semantics remain identical to realtime graph semantics。

## 52.2 WAV sample format

```text
16bit:
    signed little-endian PCM

24bit:
    signed little-endian PCM

32bit:
    IEEE-754 little-endian float
```

Container:

```text
RIFF/WAVE when file fits RIFF 32-bit chunk limits
RF64 automatically when it does not
```

For >2 standard speaker channels, use WAVE_FORMAT_EXTENSIBLE and channel order from `ChannelLayout`。

For ambisonic/custom layouts, channel order is exactly Project IR order and a `soraoto` metadata chunk stores the Deterministic-CBOR ChannelLayout。

## 52.3 Normalize

```text
normalize: false
    no gain normalization

normalize: true
    sample-peak normalize so max absolute sample = -1.0 dBFS
```

Silence remains silence and receives no gain。

Normalization gain is applied after Master processing and before integer dither/quantization。

## 52.4 Integer quantization / dither

16/24-bit output uses deterministic TPDF dither。

For each `(channel, sample_index)`:

```text
u1 = rand(dither_seed, ("wav-dither", channel, sample_index, 0))
u2 = rand(dither_seed, ("wav-dither", channel, sample_index, 1))

tpdf = u1 - u2
```

One LSB peak-to-peak scale:

```text
quantized_input =
    sample + tpdf * one_lsb
```

rounding:

```text
round_ties_even
```

Then saturate to integer PCM range。

If unnormalized source exceeded full-scale before saturation, emit render warning with clipped sample count。

32-bit float output:

```text
no dither
no hard clipping required
finite Float32 conversion
```

NaN/Inf must already have been sanitized by Plugin Host rules。

## 52.5 Stem render

```text
render Stems {
    tracks: [Drums, Bass, Lead, Vocal]
    format: wav
}
```

Default stem tap:

```text
post_fader
pre_main-routing
```

Thus each Track stem includes:

```text
source/instrument
track inserts
track gain/pan
```

and excludes:

```text
shared downstream Bus effects
Master effects
other Track signals
```

To render a processed Bus stem, list the Bus explicitly。

Each stem file uses the same start/end sample range so files remain sample-aligned。

## 52.6 MIDI export

```text
export midi {
    tracks: [Piano, Bass, Drums]

    ppq: 960
    mpe: auto
}
```

ABI-independent export format:

```text
Standard MIDI File Type 1
MIDI 1.0 channel voice messages
```

Schema:

```text
MidiExportV1 {
    tracks: List<TrackRef>

    ppq: UInt16 = 960

    mpe:
        off
        on
        auto
}
```

constraints:

```text
96 <= ppq <= 32767
```

MusicalTime -> tick:

```text
tick_real =
    beat_position * ppq

tick =
    round_ties_even(tick_real)
```

`quarter note = ppq ticks`。

If NoteOff would quantize to NoteOn tick or earlier:

```text
note_off_tick =
    note_on_tick + 1
```

## 52.7 MIDI tempo/meter/key metadata

Export includes:

```text
track 0:
    Set Tempo meta events
    Time Signature meta events
    Key Signature meta events when representable
```

Tempo ramps are sampled into tempo meta events such that reconstructed beat-to-time position error is:

```text
<= 0.5 ms
```

and never fewer than one tempo event at each authored tempo segment boundary。

Non-major/minor Key scale has no standard SMF Key Signature representation; omit Key Signature and retain musical notes unchanged。

## 52.8 MIDI note / expression lowering

Integer 12-TET note with no per-note expression:

```text
normal MIDI NoteOn/NoteOff
```

Fractional Pitch or polyphonic pitch/timbre/pressure:

```text
mpe = off:
    export error unless an explicit MIDI Adapter supplies lowering

mpe = on:
    use MPE lowering

mpe = auto:
    use MPE only when required
```

MPE zone:

```text
channel 1:
    master

member channels:
    2..16
    excluding channel 10 when a drum Track shares the same MIDI port
```

Per-note channel is held from NoteOn through NoteOff。

Maximum simultaneous member notes is available member-channel count。
Overflow is export error; notes are not silently stolen。

Default pitch-bend range:

```text
±48 semitones
```

Exporter emits the required RPN setup at track start。

Mappings:

```text
Pitch expression:
    channel Pitch Bend

pressure:
    Channel Pressure

timbre:
    CC74
```

Other Note Expressions require an External MIDI Adapter or are export error。

Drum semantic voices use §40.7 General MIDI mapping unless overridden by Adapter。

## 52.8.1 MIDI lyric metadata

For a Track containing §63.13 `VocalLyricV1`, the exporter emits Standard MIDI File:

```text
Lyric Meta Event:
    FF 05
```

at the tick of the first VocalPerformance note whose:

```text
melisma_index = 0
```

for each `lyric_unit_id`。

Meta-event text bytes are UTF-8。

Text payload:

```text
payload =
    lyric.surface
    + (
        lyric.word_boundary_after
        ? " "
        : ""
      )
    + (
        lyric.phrase_end
        ? "\n"
        : ""
      )
```

If:

```text
surface = ""
word_boundary_after = false
phrase_end = false
```

no Lyric Meta Event is emitted for that unit。

Melisma continuation notes:

```text
melisma_index > 0
```

do not emit duplicate lyric text。

The Standard MIDI File Lyric event does not carry:

```text
reading
language
phoneme_alphabet
phoneme timing
lyric_unit_id
```

Those fields remain available only in native soraoto Project/Performance IR or an explicit extended MIDI/DAW Adapter format。

MIDI export must not replace display `surface` with `reading` unless the user explicitly selects such an Adapter/export policy。

## 52.9 Deterministic offline render

If:

```text
render {
    deterministic_dsp: true
}
```

Host applies §60.3 deterministic DSP conditions。

Output metadata that contains timestamps must either be omitted or fixed from explicit project metadata; current wall-clock time must not affect audio bytes or deterministic render digest。

---

---

---

# 53. GUI / AI Editing

```text
GUI / AI
   ↓
AST edit
   ↓
Dependency invalidation
   ↓
Incremental compile
   ↓
Performance IR / Timeline / Graph IR
```

生成イベントは provenance を保持。

直接編集:

```text
Detach
Expand
```

Detach 後は元 Harmony / Pattern / Component への自動追従を停止する。

WASM Plugin の GUI editor はこの仕様外だが、Host は descriptor / parameter metadata から generic parameter UI を構築できる。

---

---

---

# 54. Determinism / Safety

Core DSL に含めない:

```text
mutable variables
while
runtime thread
async arbitrary task
unbounded runtime recursion
```

random 系は seed 必須。

```text
Component
    sandboxed compile-time code

WASM Plugin
    sandboxed constrained realtime/offline code
```

この2つを混同しない。

Plugin determinism semantics are owned by §60.3。

Default realtime mode does not require cross-runtime/CPU bit identity。
When `deterministic_dsp: true` is requested, the exact stronger reproducibility contract is §60.3 and must not be redefined here。

---

---

---

# 64. Audio Clip Normative Semantics

§41 の Audio Clip 概念を具体化する。

## 64.1 Clip schema

```text
AudioClip {
    asset: AssetRef

    at: MusicalTime
    length: MusicalDuration?

    source_start: Time = 0s
    source_end: Time?

    gain: Db = 0db

    reverse: Bool = false

    transpose: Semitone = 0st
    formant: Semitone = 0st

    stretch:
        {
            "kind": "none"
        }
      | {
            "kind": "ratio",
            "ratio": Float64
        }
      | {
            "kind": "warp"
        }

    warp_markers: List<WarpMarker> = []

    loop: LoopSpec?

    fade_in: FadeSpec?
    fade_out: FadeSpec?

    slices: List<SliceMarker> = []
}
```

## 64.2 Source region

source interval:

```text
[source_start, source_end)
```

`source_end` omitted:

```text
asset duration
```

invalid:

```text
source_start < 0
source_end <= source_start
source_end > decoded asset duration
```

compile error。

## 64.3 Processing order

canonical order:

```text
1. decode asset
2. select source region
3. reverse if enabled
4. loop-source construction
5. time-stretch / warp
6. pitch transpose
7. formant shift
8. clip gain
9. fades
10. track processing/routing
```

renderer はこの semantic order を変えてはならない。

## 64.4 Reverse

`reverse: true` は selected source region の sample order を反転する。

warp marker の source coordinate は reverse 後の source coordinate へ変換してから適用。

## 64.5 Time stretch

ratio:

```text
output_duration =
    source_duration * ratio
```

`ratio > 0`。

pitch を維持する。

`transpose` は stretch 後に別処理。

## 64.6 Warp

```text
WarpMarker {
    source: Time
    target: MusicalDuration
}
```

最低2 marker。

strict conditions:

```text
source strictly increasing
target strictly increasing
first marker:
    source = source region start
    target = 0 beats

last marker:
    source = source region end
    target = desired stretched clip duration
```

marker 間は source-time -> target-time の piecewise linear map。

音声 algorithm は transient preserving stretch を使用してよいが mapping error は:

```text
<= 0.25 sample at marker positions
```

## 64.7 Transpose / formant

```text
transpose:
    spectral pitch shift in semitones

formant:
    spectral-envelope shift in semitones
```

transpose だけ指定した場合 formant保持が default。

conformance tests:

```text
steady sinusoid pitch target:
    realtime <= ±5 cents
    offline  <= ±2 cents

synthetic vowel spectral-envelope peak target under formant shift:
    realtime <= ±5 %
    offline  <= ±3 %
```

transient/texture quality はこの誤差条件を満たす範囲で permitted implementation variation とする。

## 64.8 Loop

```text
LoopSpec {
    source_start: Time
    source_end: Time

    repeat:
        {
            "kind": "finite",
            "count": UInt32
        }
      | {
            "kind": "infinite"
        }

    crossfade: Time = 0ms
}
```

validation:

```text
source_start >= selected source region start
source_end <= selected source region end
source_start < source_end

finite count >= 1

infinite repeat:
    explicit AudioClip.length required
```

`count` is the total number of loop-region plays, including the first play。

crossfade:

```text
0 <= crossfade <= loop_length / 2
```

equal-power crossfade。

## 64.9 Fade

```text
FadeSpec {
    duration: Time
    curve:
        linear
        equal_power
        ease_in
        ease_out
}
```

validation:

```text
duration >= 0
duration <= rendered clip duration
```

fade gain:

```text
linear:
    g(u) = u

equal_power:
    g(u) = sin(pi/2 * u)

ease_in:
    g(u) = u^2

ease_out:
    g(u) = 1 - (1-u)^2
```

For fade-out use `u = remaining / duration` so gain moves 1 -> 0。

fade-in/out overlap:

```text
both gains multiply
```

## 64.10 Slice

```text
SliceMarker {
    id: String
    source: Time
}
```

strict ascending。

slice playback:

```text
slice("verse", index: 3)
```

は `[marker3, marker4)`。
last slice は source_end まで。

## 64.11 Takes / Comping

```text
TakeLane {
    id: String
    clips: List<AudioClip>
}

CompRegion {
    at: MusicalTime
    length: MusicalDuration
    take: String
    take_offset: Time
    crossfade: Time
}
```

CompRegion は destination timeline 上で overlap 不可。

隣接 region の take が異なる場合:

```text
crossfade default = 5ms
```

equal-power。

Comping 後の結果は通常の AudioClip stream として downstream graph に入る。

## 64.12 Render quality

```text
realtime:
    low-latency algorithm allowed

offline:
    higher-quality algorithm allowed
```

両者で timeline mapping / pitch target / gain / fade semantics は一致必須。

---

---

---

# 65. Standard Processor Contracts

Standard Prelude processor 名は vendor-specific implementation 名ではなく、以下の parameter contract を意味する。

DSP実装は許容誤差内で異なってよい。
従って **behavioral conformance contract** として固定する。

## 65.1 Gain

```text
Gain {
    gain: Db = 0db
}
```

sample:

```text
y = x * 10^(gain_db / 20)
```

automation は sample-accurate。

## 65.2 ChannelMixer

```text
ChannelMixer {
    input: ChannelLayout
    output: ChannelLayout

    matrix: Float[out_channels][in_channels]
}
```

sample:

```text
y[o] = sum_i matrix[o][i] * x[i]
```

validation:

```text
matrix rows = output channel count
each row columns = input channel count
all coefficient values finite Float64
1 <= input channels <= 64
1 <= output channels <= 64
```

processing accumulation order:

```text
for each output channel:
    input channels in increasing channel index
```

reference accumulation uses Float64 even when graph sample format is f32。
The final output sample is converted to graph sample format after the sum。

matrix automation is block-boundary only。
A changed matrix becomes active at sample 0 of the next process block。

standard mono -> stereo:

```text
L = M
R = M
```

stereo -> mono:

```text
M = (L + R) / sqrt(2)
```

その他 layout conversion は explicit matrixをProject IRに保存する。

## 65.3 EQ

```text
EQ {
    bands: List<EQBand>
}

EQBand {
    enabled: Bool = true

    type:
        high_pass
        low_pass
        peak
        low_shelf
        high_shelf
        notch

    frequency: Hz
    q: Float = 0.7071067811865476
    gain: Db = 0db

    slope_db_oct:
        6 | 12 | 18 | 24
}
```

constraints:

```text
10hz <= frequency < sample_rate/2

0.1 <= q <= 24

-60db <= gain <= +60db

slope_db_oct:
    used only by high_pass / low_pass
    for other band types it must be 12 or is ignored after canonicalization to 12
```

All filters use Transposed Direct Form II or a mathematically equivalent realization of the following transfer functions。

For a normalized biquad:

```text
H(z) =
    (b0 + b1 z^-1 + b2 z^-2)
    /
    (1 + a1 z^-1 + a2 z^-2)
```

Coefficients are calculated in Float64 at parameter-change samples。

### 65.3.1 Common biquad terms

```text
w0 =
    2*pi*frequency/sample_rate

c =
    cos(w0)

s =
    sin(w0)

alpha =
    s/(2*q)

A =
    10^(gain_db/40)
```

Raw coefficients are divided by `a0` before processing。

### 65.3.2 12 dB/oct low-pass

```text
b0 = (1-c)/2
b1 =  1-c
b2 = (1-c)/2

a0 = 1+alpha
a1 = -2*c
a2 = 1-alpha
```

### 65.3.3 12 dB/oct high-pass

```text
b0 = (1+c)/2
b1 = -(1+c)
b2 = (1+c)/2

a0 = 1+alpha
a1 = -2*c
a2 = 1-alpha
```

### 65.3.4 Peak

```text
b0 = 1 + alpha*A
b1 = -2*c
b2 = 1 - alpha*A

a0 = 1 + alpha/A
a1 = -2*c
a2 = 1 - alpha/A
```

### 65.3.5 Notch

```text
b0 = 1
b1 = -2*c
b2 = 1

a0 = 1+alpha
a1 = -2*c
a2 = 1-alpha
```

### 65.3.6 Shelves

Shelves use slope parameter:

```text
S = 1
```

and ignore `q` for coefficient generation。

```text
alpha_shelf =
    sin(w0)/2
    * sqrt(
        (A + 1/A)*(1/S - 1)
        + 2
      )

beta =
    2*sqrt(A)*alpha_shelf
```

Low shelf:

```text
b0 = A*((A+1) - (A-1)*c + beta)
b1 = 2*A*((A-1) - (A+1)*c)
b2 = A*((A+1) - (A-1)*c - beta)

a0 =     (A+1) + (A-1)*c + beta
a1 = -2*((A-1) + (A+1)*c)
a2 =     (A+1) + (A-1)*c - beta
```

High shelf:

```text
b0 = A*((A+1) + (A-1)*c + beta)
b1 = -2*A*((A-1) + (A+1)*c)
b2 = A*((A+1) + (A-1)*c - beta)

a0 =     (A+1) - (A-1)*c + beta
a1 = 2*((A-1) - (A+1)*c)
a2 =     (A+1) - (A-1)*c - beta
```

### 65.3.7 6 dB/oct first-order low/high-pass

```text
K =
    tan(pi*frequency/sample_rate)
```

Low-pass:

```text
b0 = K/(1+K)
b1 = b0

a1 = (K-1)/(K+1)
```

High-pass:

```text
b0 = 1/(1+K)
b1 = -b0

a1 = (K-1)/(K+1)
```

Transfer:

```text
H(z) =
    (b0 + b1 z^-1)
    /
    (1 + a1 z^-1)
```

### 65.3.8 HP/LP slope construction

```text
6:
    one first-order section

12:
    one 12dB biquad using band q

18:
    one first-order section
    followed by one 12dB biquad using band q

24:
    two identical 12dB biquads
    each using band q
```

Cascade order is exactly the order above。

### 65.3.9 Band order

Enabled bands are processed in source-list order。

Changing list order is semantically observable because minimum-phase filters do not generally share identical floating-point state evolution even when ideal LTI multiplication commutes。

### 65.3.10 Parameter automation

`frequency`, `q`, and `gain` may be sample-accurate。

At every sample where an automated coefficient-driving parameter changes:

```text
recompute coefficients in Float64
retain existing filter delay state
process that sample with the new coefficients
```

`enabled`, `type`, and `slope_db_oct` changes occur at sample boundaries。
To avoid clicks, Host/processor performs a 64-sample equal-power crossfade between old and new filter topology。

### 65.3.11 Conformance

Reference magnitude is **the coefficient formulas above**, not an implementation-selected analog model。

For static coefficients, measured magnitude:

```text
<= 0.05 dB error
```

relative to the mathematical transfer function from:

```text
max(20hz, 2hz)
through
min(20khz, sample_rate/2 - 20hz)
```

excluding frequencies where reference magnitude is below `-120 dB`。

Phase is minimum-phase as defined by the causal IIR sections above。

## 65.4 Compressor

```text
Compressor {
    threshold: Db = -18db
    ratio: Float = 4
    knee: Db = 6db

    attack: Time = 10ms
    release: Time = 100ms

    detector:
        peak
        rms

    rms_window: Time = 10ms

    makeup: Db = 0db
    mix: Norm = 1
    lookahead: Time = 0ms

    max_reduction: Db? = null

    sidechain_high_pass: Hz? = null
    sidechain_low_pass: Hz? = null
}
```

validation:

```text
ratio >= 1
knee >= 0db

attack >= 0s
release >= 0s
rms_window > 0s when detector=rms

0 <= mix <= 1
lookahead >= 0s

max_reduction:
    if present, value <= 0db or positive magnitude accepted and canonicalized to negative reduction magnitude

sidechain_high_pass:
    if present, 10hz <= value < sample_rate/2

sidechain_low_pass:
    if present, 10hz < value < sample_rate/2

if both sidechain filters present:
    high_pass < low_pass
```

detector pre-filter:

```text
input =
    connected sidechain bus
    else main input

if sidechain_high_pass present:
    apply §65.3 12dB high-pass
    q = 0.7071067811865476

if sidechain_low_pass present:
    apply §65.3 12dB low-pass
    q = 0.7071067811865476

detector uses the filtered result
```

Sidechain filter coefficient rules and state retention follow §65.3。

detector definition:

```text
peak:
    detector_power[n] = max_c(abs(sidechain_or_main[c][n]))^2

rms:
    x2[n] = max_c(sidechain_or_main[c][n]^2)

    a = exp(-1 / (rms_window_seconds * sample_rate))

    detector_power[n] =
        a * detector_power[n-1]
        + (1-a) * x2[n]
```

`rms_window > 0` when detector=rms。

level conversion:

```text
level_linear = sqrt(max(detector_power, 1e-16))
x_db = 20 * log10(level_linear)
```

Multi-channel detector は channel-linked maximum を使用する。
sidechain が multi-channel の場合も同じ。

static curve in dB。

Let:

```text
x = detector level dB
T = threshold
R = ratio
W = knee
```

hard knee (`W=0`):

```text
y = x                    if x <= T
y = T + (x-T)/R          if x > T
```

soft knee:

```text
x < T-W/2:
    y = x

x > T+W/2:
    y = T + (x-T)/R

otherwise:
    y = x + (1/R - 1) * (x-T+W/2)^2 / (2W)
```

gain reduction target:

```text
g_db = y - x
```

`max_reduction` が存在する場合:

```text
g_db = max(g_db, -abs(max_reduction))
```

gain smoothing domain:

```text
target = g_db

if target < smoothed_gain_db:
    tau = attack
else:
    tau = release

tau == 0:
    smoothed_gain_db = target

tau > 0:
    a = exp(-1 / (tau_seconds * sample_rate))

    smoothed_gain_db[n] =
        a * smoothed_gain_db[n-1]
        + (1-a) * target[n]
```

この定義で step response は指定 time constant 後に `1-e^-1` 到達。

wet gain:

```text
wet = delayed_main * 10^(smoothed_gain_db / 20) * 10^(makeup / 20)
```

lookahead:

```text
latency_samples = ceil(lookahead_seconds * sample_rate)
```

main signal を `latency_samples` delayし、detector は undelayed input/sidechainを使用する。

mix:

```text
dry_aligned =
    main input delayed by latency_samples

equal-amplitude:
y =
    dry_aligned*(1-mix)
    + wet*mix
```

The dry branch is latency-aligned with the lookahead wet branch。

Sidechain bus が接続されていれば detector input に使用、なければ main input。

## 65.5 Limiter

```text
Limiter {
    ceiling: Db = -1db
    release: Time = 100ms
    lookahead: Time = 1ms
    true_peak: Bool = true
}
```

validation:

```text
ceiling <= 0db
release >= 0s
lookahead >= 0s
```

Limiter is a linked-channel downward limiter:

```text
target_gain =
    min(
        1,
        ceiling_linear / max_detected_peak
    )
```

Attack is instantaneous within the configured lookahead。
Release uses the same one-pole gain-domain time-constant convention as §65.4。

`true_peak = false`:

```text
max_detected_peak =
    max absolute sample across channels
```

`true_peak = true`:

```text
minimum 4x oversampled peak estimation
```

output reconstructed true peak は ceiling + 0.1 dB を超えてはならない。

latency:

```text
lookahead + implementation resampling latency
```

として正確に report。

## 65.6 StandardBypass

§31.3 の仕様を使用。

crossfade:

```text
64 samples
equal-power
```

## 65.7 Standard Delay primitive

```text
Delay {
    time: Time | BeatDuration
    feedback: Norm
    mix: Norm
    interpolation:
        linear
        cubic
}
```

constraints:

```text
time > 0
0 <= feedback < 1
0 <= mix <= 1
```

plain `Delay` は各 channel 独立 feedback。

```text
feedback input[channel] =
    dry[channel] + delayed[channel] * feedback
```

wet/dry:

```text
output =
    dry * (1-mix)
    + delayed * mix
```

tempo-sync BeatDuration は timeline tempo map から event/sample位置ごとに解決する。

delay time 変更時:

```text
linear:
    linear fractional-delay interpolation

cubic:
    Catmull-Rom 4-point interpolation
```

time jump による pitch glide / phase behavior は上記 variable-delay read-head interpolation の結果とする。

## 65.8 FeedbackDelay

`FeedbackDelay` is the only standard node that legalizes an explicit audio feedback cycle。

```text
FeedbackDelay {
    delay_samples: UInt32
    layout: ChannelLayout
}
```

validation:

```text
delay_samples >= 1
```

For each channel:

```text
y[n] =
    0                         when n < delay_samples
    x[n - delay_samples]      otherwise
```

The delay line begins with zeros at transport/reset start。

For continuous playback, state persists across process blocks。
On `soraoto_plugin_reset`-equivalent graph reset / transport discontinuity configured to reset graph state, the line is cleared。

`FeedbackDelay` reports:

```text
latency_samples = delay_samples
tail_samples    = delay_samples
```

When used inside a feedback loop, graph scheduling semantics are sample-exact regardless of Host block size。
The Host may split blocks or use a feedback-aware scheduler, but the result must equal the recurrence above。

## 65.9 SampleFormatConverter

```text
SampleFormatConverter {
    input:
        f32 | f64

    output:
        f32 | f64
}
```

`f32 -> f64`:

```text
exact IEEE-754 widening conversion
```

`f64 -> f32`:

```text
round-to-nearest ties-to-even

if finite magnitude > Float32 max finite:
    clamp to signed Float32 max finite
```

NaN/Inf are not valid graph samples; upstream Plugin fault sanitation (§31) occurs before format conversion。

Signed zero:

```text
-0.0 -> +0.0
```

for canonical graph output。

Converter has:

```text
latency = 0
tail = 0
```

## 65.10 InterleaveConverter

WASM Plugin ABI is always planar。
A native processor/backend that uses interleaved storage must cross an explicit `InterleaveConverter`。

Planar -> interleaved:

```text
dst[frame * channel_count + channel]
    =
src[channel][frame]
```

Interleaved -> planar is the exact inverse mapping。

No numeric sample conversion is performed。

constraints:

```text
same sample format on both sides
same channel count/layout
```

latency/tail:

```text
0
```

## 65.11 Track Pan / Balance / Width

Host Track/Bus spatial controls use the exact §4 laws:

```text
mono:
    Pan equal-power law

stereo:
    Width M/S transform
    then Balance
```

They are standard Host processors with:

```text
latency = 0
tail = 0
sample-accurate parameter updates
```

A mono-to-stereo Pan operation changes layout from mono to stereo explicitly in Resolved Project IR。

A stereo Width/Balance operation preserves stereo layout。

## 65.12 Conformance tolerance

浮動小数点 processor は bit-exact を要求しない。

required:

```text
no NaN/Inf for finite valid input
declared latency exact
parameter semantics exact
static response/ceiling tolerance満足
deterministic_dsp=true時は§60.3条件を満足
```

---

---

---
