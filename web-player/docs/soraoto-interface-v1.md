# soraotoDSL Draft v0.5 — `soraoto.interface` normative amendment

This amendment adds an authoring/inspection representation for WASM Plugin metadata without replacing Plugin ABI 1.0 wire metadata.

## 1. Relationship to Plugin ABI 1.0

A WASM Plugin MAY contain exactly one custom section named:

```text
soraoto.interface
```

Its payload is UTF-8 soraotoDSL Interface Source. The section is non-realtime metadata and MUST NOT be read from the audio thread.

The existing mandatory `soraoto.plugin.v1` custom section remains the runtime discovery descriptor and continues to contain Deterministic-CBOR(`PluginDescriptorV1`). `soraoto.interface` therefore does not change ABI major/minor negotiation and does not replace `soraoto.plugin.v1`.

When both sections exist, a conforming build/validation tool MUST compile `soraoto.interface` and verify semantic equivalence for every overlapping field in `PluginDescriptorV1`. Mismatch is a plugin validation error. Runtime hosts MAY ignore `soraoto.interface` after validation.

Authoring rule:

```text
interface.soraoto
    -> interface parser/type checker
    -> PluginDescriptorV1
    -> soraoto.plugin.v1
    -> embed exact normalized interface source as soraoto.interface
```

Thus `.soraoto` is the human-editable source; CBOR is the canonical runtime wire representation.

## 2. Source normalization

Before embedding:

```text
UTF-8
no BOM
Unicode NFC
LF line endings
final LF required
```

The custom-section payload is exactly those normalized bytes. No NUL terminator is appended.

## 3. Restricted interface language

`soraoto.interface` is a declarative subset of soraotoDSL. It MUST NOT contain project/timeline execution constructs.

Allowed top-level declarations:

```text
plugin interface
enum
struct
type alias
resource type
parameter
audio bus
event bus
factory preset metadata
unit/program metadata
```

Forbidden:

```text
project
track
notes
drums
lyrics
pattern
macro
fn bodies
component invocation
filesystem/network I/O
runtime evaluation
random
```

The parser MUST reject executable constructs rather than silently ignore them.

## 4. Plugin interface declaration

Canonical form:

```text
plugin interface Name {
    abi: "1.0"
    id: "reverse.dns.plugin-id"
    name: "Display Name"
    version: "1.2.3"
    kind: instrument

    audio {
        output main: AudioStereo
    }

    events {
        input notes: "soraoto-note-v1"
    }

    parameter cutoff: Hz {
        id: 10
        default: 2.5khz
        range: 20hz..20khz
        scale: logarithmic
        automation: sample_accurate
        modulation: audio
        smoothing: 3ms
    }
}
```

The declaration is compile-time metadata only.

## 5. Parameter declarations

Syntax:

```text
parameter <semantic-path>: <Type> {
    id: UInt32
    default: <typed value>
    range: <typed min>..<typed max>?
    scale: linear | logarithmic
    automation: none | sample_accurate
    modulation: none | control | audio
    smoothing: Time?
    read_only: Bool?
    hidden: Bool?
    function: String?
}
```

Rules:

- `semantic-path` is stable plugin parameter identity and maps to `ParameterDescriptor.path`.
- `id` is the ABI-local UInt32 lookup key; it is not persistent Project identity.
- `default` and `range` are type checked using normal soraotoDSL unit semantics.
- `automation: sample_accurate` means `SoraotoParameterPointV1` may change the value at any sample offset.
- `modulation: audio` means audio-rate modulation is accepted independently of automation.
- `smoothing` is optional source metadata for plugin-side dezippering of discontinuous authored/control changes; it MUST NOT override explicit sample-accurate parameter points. It has no new realtime wire representation.
- Integer/Bool/Enum parameters MUST NOT declare audio-rate modulation.
- `automation` and `modulation` are independent capabilities.
- Interface `automation` lowers directly to the existing `ParameterDescriptor.automation`; no parallel control/audio automation enum is introduced.
- Interface `modulation` lowers directly to `ParameterDescriptor.modulation` (`none`, `control`, or `audio`).

## 6. Interface types

The interface subset reuses normal soraotoDSL scalar/unit types and adds resource-handle types for plugin binding:

```text
Int Float Bool String Norm
Hz Db Time Semitone Cent Pan Width
Enum<T>
WavetableRef SampleRef MultisampleRef ImpulseResponseRef BlobRef
```

Resource values are resolved before realtime processing. Audio-thread parameter events carry numeric IDs/values or pre-resolved handles; path/string lookup is forbidden in realtime processing.

## 7. Compiler binding

For:

```text
import plugin SuperSynth from "./super-synth-v4.wasm"
```

the compiler MAY inspect `soraoto.interface` for diagnostics, completion and documentation, but final runtime compatibility MUST be checked against `soraoto.plugin.v1`.

Example:

```text
SuperSynth {
    filter_cutoff: 4.5khz   // valid Hz
    unison_voices: 7        // valid Int
}
```

```text
SuperSynth {
    filter_cutoff: "bright" // compile error
}
```

Before Resolved Project IR/realtime binding, semantic parameter paths are resolved to numeric `parameter_id` values. The realtime path MUST NOT perform string lookup.

## 8. WASM custom-section validation

Plugin binary validator additions:

```text
soraoto.interface count <= 1
payload valid UTF-8
source normalized
restricted grammar only
all parameter IDs unique
all parameter paths unique
all defaults/ranges type-correct
all declared Enum defaults valid
no audio-rate capability on discrete parameter types
if present, compiled interface overlaps exactly with soraoto.plugin.v1
```

`soraoto.interface` may be stripped for production only when an equivalent `soraoto.plugin.v1` remains. Tooling intended for source-level inspection SHOULD preserve it.

## 9. No new realtime ABI

This amendment adds no new realtime struct, export, import, event kind or binary parameter representation. Plugin ABI remains 1.0. Realtime parameter delivery continues to use the existing numeric-ID/fixed-struct ABI.
