# 1. 設計原則

- メロディは相対音程を短く記述できる。
- コード進行はコード譜に近い記法で入力できる。
- `chords` を曲全体の Harmony Timeline として第一級に扱う。
- ベース、ピアノ、ギター、ストリングスなどを Harmony から派生生成できる。
- `pattern`、`fn`、`macro` は純粋かつ決定論的に展開する。
- 楽器固有の「弾き方」は Instrument Performance Compiler が担当する。
- 高水準 DAW 構造は JavaScript / WebAssembly Component で拡張できる。
- Realtime instrument / effect / generator / event processor は WASM Plugin として実装できる。
- Component は compile-time、WASM Plugin は runtime とし、同一 Audio Thread 上で混同しない。
- DSL source、JS Component、WASM Component を Audio Thread で評価しない。
- GUI・AI・CLI は同じ AST / Project Model を編集する。
- 生成物は provenance を保持し、GUI から Detach / Expand できる。
- random / humanize / probability は seed を要求し、再現可能にする。
- WASM Plugin の目標は **GUI を除く VST クラスの plugin-host 機能を表現できること**であり、VST3 binary ABI 互換を意味しない。

---

---

---

---

---

---

---

# 2. コンパイル / 実行モデル

```text
Source (.soraoto)
 ↓
Parser
 ↓
AST
 ↓
Name / Type Resolution
 ↓
Harmony Resolution
 ↓
Pattern Expansion
 ↓
Macro Expansion
 ↓
External Component Expansion (JS / WASM)
 ↓
Instrument Performance Compilation
 ↓
Performance IR
 ↓
Timeline Resolution
 ↓
Automation / Modulation Compilation
 ↓
Audio / Event Graph Construction
 ↓
Resolved Project IR
 ↓
Runtime Plugin Binding / External Plugin Adaptation
 ↓
Realtime Engine / Offline Renderer
```

Realtime Engine が扱うのは Resolved Project IR 以降のみである。

---

---

---

---

---

---

---

# 3. ファイルとモジュール

標準ソース拡張子は `.soraoto`。

```text
song.soraoto
patterns/
components/
plugins/
audio/
```

soraotoDSL module:

```text
import "patterns/bass.soraoto"
```

Compile-time Component:

```text
import component Sidechain from "./components/sidechain.js"
import component VocalChain from "./components/vocal-chain.wasm"
```

Realtime WASM Plugin:

```text
import plugin SuperSynth from "./plugins/super-synth.wasm"
import plugin SoraotoDelay from "./plugins/delay.wasm"
```

Legacy source syntax:

```text
import dsp X from "..."
```

may be accepted by parser compatibility mode as an alias of `import plugin`.
Canonical Draft v0.5 syntax is always `import plugin`.

`.wasm` は Component と Plugin の両方に利用できるため、import kind を必ず明示する。

## 3.1 Standard Prelude

基本 utility processor:

```text
EQ
Compressor
Limiter
Gain
ChannelMixer
```

高水準 DAW 構造は Standard Component:

```text
import component Sidechain from "std:components/sidechain"
import component StereoDelay from "std:components/stereo-delay"
```

---

---

---

---

# 4. 基本型

代表型:

```text
Pitch
PitchClass
Interval
Chord
ChordContext

Duration
Beat
Bar
BeatDuration
MusicalTime
MusicalDuration
Time
Meter
BitDepth
Norm

Bpm
Hz
Db
Cent
Semitone

Velocity
Expression
Pan
Balance
Width

Int
Float
Bool
String

Notes
Chords
Curve<T>
Audio
AudioMono
AudioStereo

TrackRef
BusRef
HarmonyRef
AudioSourceRef
EffectRef
PluginRef
ParameterRef
AudioBusRef
EventBusRef
PresetRef

Range<T>
Stream<T>

EventFragment<T>
NotesFragment
DrumFragment
PerformanceFragment<T>
PatternFn<Args, Result>
```

reference identity has two phases.

### Source reference

Source DSL name resolution uses compiler-only:

```text
SourceObjectRef {
    kind:
        track
        bus
        harmony
        plugin
        parameter
        audio_bus
        event_bus
        preset

    module_uri: String
    qualified_name: String
}
```

This type is **not serialized into Resolved Project IR**。

`module_uri`:

```text
§62.8.1 normalized project-root-relative module URI
```

`qualified_name`:

```text
source identifiers joined by "."
Unicode NFC
case-sensitive
```

Example:

```text
song/main.soraoto::Lead
song/main.soraoto::Harmony
song/main.soraoto::Lead.instrument
```

### Resolved wire reference

All Project IR / Clipboard / Component-facing persistent references use:

```text
ObjectRefV1 {
    kind:
        track
        bus
        harmony
        plugin
        parameter
        audio_bus
        event_bus
        preset

    id: String
}
```

`ObjectRefV1.id` is always:

```text
exactly 32 lowercase hexadecimal characters
```

representing a stable 128-bit object ID。

typed aliases:

```text
TrackRef      = ObjectRefV1(kind=track)
BusRef        = ObjectRefV1(kind=bus)
HarmonyRef    = ObjectRefV1(kind=harmony)
PluginRef     = ObjectRefV1(kind=plugin)
ParameterRef  = ObjectRefV1(kind=parameter)
AudioBusRef   = ObjectRefV1(kind=audio_bus)
EventBusRef   = ObjectRefV1(kind=event_bus)
PresetRef     = ObjectRefV1(kind=preset)

AudioSourceRef = TrackRef | BusRef | PluginRef
EffectRef      = PluginRef
```

Source-authored object ID:

```text
resolved-id =
    lowercase-hex(
        SHA-256(
            Deterministic-CBOR([
                "soraoto-project-object-v1",
                kind,
                normalized-module-uri,
                qualified-source-name
            ])
        )[0..16]
    )
```

Component-created object ID uses §20.5 Component global-ID derivation directly。
Compiler-generated object ID uses the domain-separated graph/object generation rule of its defining IR section。

Therefore serialized Resolved Project IR never depends on filesystem absolute paths or mutable display names。

`AudioSourceRef` は audio output を持つ object のみ参照可能。
`PluginRef` が generator/instrument/effect 等どの kind かは resolved Project IR で type-checkする。

### ParameterRef identity

Parameter object IDs are derived independently from runtime UInt32 parameter IDs:

```text
Host Track/Bus parameter:

    SHA-256(
      Deterministic-CBOR([
        "soraoto-parameter-ref-v1",
        owner_object_id,
        standard_parameter_semantic_path
      ])
    )[0..16]

WASM Plugin parameter:

    SHA-256(
      Deterministic-CBOR([
        "soraoto-parameter-ref-v1",
        plugin_instance_object_id,
        ParameterDescriptor.path
      ])
    )[0..16]

External Plugin parameter:

    SHA-256(
      Deterministic-CBOR([
        "soraoto-parameter-ref-v1",
        external_adapter_instance_id,
        stable_semantic_mapping_path
      ])
    )[0..16]
```

stored as lowercase 32-hex `ObjectRefV1.id`。

Runtime `parameter_id: UInt32` is an ABI-local lookup key and is never the persistent Project identity by itself。

canonical scalar semantics:

```text
Int       = signed 64-bit integer
Float     = IEEE-754 binary64 finite value

Norm      = Float in 0..1
Velocity  = Norm
Expression= Norm

Pan       = Float in -1..1
Balance   = Float in -1..1
Width     = Float in 0..2

Db        = Float, decibels
Hz        = Float, hertz
Bpm       = Float > 0, beats/minute
Semitone  = Float, 12-TET semitone distance
Cent      = Float, 1/100 semitone

Pitch     = Float semitone position, C-1 = 0
PitchClass= UInt8 0..11, C=0
```

stereo controls:

```text
Pan:
    mono source position
    -1 = hard left
     0 = center
    +1 = hard right

Balance:
    stereo channel balance
    -1 = right muted
     0 = unchanged
    +1 = left muted

Width:
    0 = mono sum
    1 = unchanged stereo width
    2 = maximum standard widening
```

Mid/Side width reference:

```text
M = (L + R) / sqrt(2)
S = (L - R) / sqrt(2)

S' = S * Width

L' = (M + S') / sqrt(2)
R' = (M - S') / sqrt(2)
```

Mono Pan is equal-power:

```text
theta = (Pan + 1) * pi / 4

L = mono * cos(theta)
R = mono * sin(theta)
```

therefore center Pan is approximately `-3.0103 dB` per output channel。

Stereo Balance:

```text
if Balance < 0:
    L' = L
    R' = R * (1 + Balance)

else:
    L' = L * (1 - Balance)
    R' = R
```

A stereo source that also uses Width is processed:

```text
Width
then Balance
```

A mono source uses Pan; applying Balance to a mono source is type/configuration error unless it has first been converted to stereo。

`Duration` は note/event context では `MusicalDuration` のalias。
`Beat` は resolved IR では `MusicalTime` を使用する。
source-level `Bar` locator は meter map で `MusicalTime` へ compile-time resolveし、Resolved Project IRには残さない。

単位付き値は型安全に扱う。

```text
gain: -6db
cutoff: 2.5khz
attack: 5ms
velocity: 0.8
```

```text
velocity: -6db   // type error
```


`Interval` / `Semitone`:

```text
Interval {
    semitones: Float
}
```

12-TETで:

```text
+1 semitone = 100 cent
+12 semitone = 1 octave
```

`Pitch` は C-1=0 を基準とする semitone position を保持し、microtonal pitch は fractional value を許可する。

`Meter`:

```text
Meter {
    numerator: UInt16
    denominator: UInt16
}
```

constraints:

```text
numerator >= 1
denominator = power of two
1 <= denominator <= 64
```

`BitDepth` source literal:

```text
16bit
24bit
32bit
```

PCM integer render では 16/24bit、float render では 32bit を使用する。


---

---

---

---

# 5. Core Note DSL

## 5.1 Absolute pitch

```text
c4
d4
f#4
bb3
c#5
```

## 5.2 Relative pitch

`+N/-N` は直前 pitch cursor からの半音差。

```text
c4 +2 +2 +1
```

```text
C4 D4 E4 F4
```

省略:

```text
+   // +1 semitone
-   // -1 semitone
```

Key / Scale には依存しない。

## 5.3 Retrigger `.`

`.` は現在の Note Group を再発音する。

```text
@4:
c4 . . .,
```

Chord にも適用できる。

```text
[c4 +4 +7] . . .,
```

休符は Note Group / pitch cursor を消去しない。

## 5.4 Rest `_`

```text
@8:
c4 . _ +2,
```

One-shot:

```text
@4_
```

## 5.5 Sustain `~`

直前 sounding event を再発音せず延長する。

```text
@4:
c4 ~ ~ ~,
```

有効な sounding event がない `~` は compile error。

---

---

---

---

# 6. Duration

Default:

```text
@1:
@2:
@4:
@8:
@16:
@32:
```

One-shot:

```text
@4c4
@16+2
@2_
```

付点は `d`:

```text
@4d
@8d
```

三連 shorthand:

```text
@8t
```

一般 tuplet:

```text
tuplet 5:4 {
    @16:
    c4 +2 +2 +1 +2
}
```

`tuplet A:B`:

```text
A > 0
B > 0

effective duration of every event/rest/sustain segment
    = authored duration * B / A
```

nested tuplet は scale factor を乗算する。

```text
tuplet 3:2 inside tuplet 5:4
    total scale = 2/3 * 4/5
```

bar accounting は scaled effective duration を使用する。

Bar-relative:

```text
@bar:
```

exact semantics:

```text
@N:
    N > 0
    duration = 4/N quarter-note beats

@Nd:
    numeric @N only
    duration *= 3/2

@Nt:
    numeric @N only
    duration *= 2/3

@bar:
    duration = one full meter bar at event onset
    = meter.numerator * 4 / meter.denominator beats
```

`@bar` に `d` / `t` modifier は compile error。

event が bar midpoint から `@bar` を使用して current bar boundary を越え、`,` commit 時に overrun する場合は通常の bar overrun error。

Meter change は bar boundary にのみ配置できる。

---

---

---

---

# 7. 小節 `,`

`,` は bar terminator / bar commit。

4/4:

```text
@4:
c4 . .,
```

不足は trailing rest、超過は compile error。

```text
short -> trailing rest
exact -> valid
over  -> compile error
```

弱起:

```text
pickup {
    @8:
    g4 a4
}
```

---

---

---

---

# 8. Velocity / Expression

Velocity は Note On 強度。Audio Gain とは別。

```text
!0.8:
!1.0c4
@16!0.9c4
```

Canonical order:

```text
@duration !velocity event
```

Dynamics alias:

```text
dynamics {
    p: 0.35
    mp: 0.50
    mf: 0.65
    f: 0.85
}
```

Expression は継続的演奏表現として別に扱う。

---

---

---

---

# 9. Chord in Note DSL

```text
[c4 +4 +7]
```

Chord 内の相対 interval は先頭 root 基準であり累積しない。

```text
[c4 +4 +7 +11]
```

Note DSL Chord は発音イベント、Harmony Timeline の `Chord` は非発音和声イベント。

---

---

---

---

# 10. Voice / Polyphony

```text
notes {
    voice Right {
        @8:
        c5 . +2 .,
    }

    voice Left {
        @2:
        c3 +7,
    }
}
```

各 voice は独立 cursor / timeline を持つ。

---

---

---

---

# 11. Note Attributes / Articulation

Core Note event may carry an attribute block。

```text
c4 {
    gate: 0.8
    articulation: staccato
    expression: 0.9
    pressure: 0.4
}
```

Common attributes:

```text
gate: Float = 1.0

articulation: String?

expression: Norm = inherited/default expression
pressure: Norm?
timbre: Norm?
pan: Pan?

pitch_curve: NoteCurve<Semitone>?
```

`gate`:

```text
0 < gate <= 2

performance duration =
    authored note duration * gate
```

The note cursor still advances by the **authored** duration, not gated sounding duration。
Therefore `gate > 1` may overlap the following note。

If gated duration crosses an enclosing clip/section/follow hard boundary, the containing overflow policy applies。

`articulation` is a semantic ID。
In an expected semantic-enum/string context, standard bare identifiers such as:

```text
staccato
legato
tenuto
accent
```

are contextual shorthand for the corresponding NFC string。
A quoted string is always permitted。

Articulation scope:

```text
articulation staccato {
    c4 . +2 +2
}
```

desugars to applying:

```text
articulation: "staccato"
```

to every sounding event in the block that does not explicitly override it。

Nested articulation scope:

```text
inner scope wins
```

Instrument-specific attributes are defined by the selected Performance family (§35–39) and lower to §63。

Unknown attribute for the active Performance family:

```text
compile error
```

No unknown note attribute is silently copied into Plugin-specific metadata。

Articulation mapping target is Instrument Performance Compiler / WASM Plugin semantic articulation / External Plugin Adapter, never a hard-coded MIDI keyswitch in Core DSL。

---

---

---

---

# 12. Harmony Timeline / Chord Track

`chords` は非発音 Harmonic Timeline。

```text
chords Harmony {
    C,
    G/B,
    Am7,
    Fmaj7,
}
```

Section:

```text
chords Harmony {
    Verse {
        C,
        G/B,
        Am7,
        Fmaj7,
    }

    Chorus {
        C,
        G,
        F,
        G,
    }
}
```

1小節1コードは duration 省略可。

```text
C,
G,
```

1小節複数コードは duration 必須。

```text
@2:
C G,
Am F,
```

Chord symbols:

```text
C
Cm
C7
Cmaj7
Cm7
Cdim
Caug
Csus2
Csus4
Cadd9
Cm7b5
C7#9
F#m7
Bbmaj7
C/E
G/B
```

Roman / Nashville も typed `Chord` へ解決する。

```text
key: C.major

chords Harmony {
    I,
    V/vi,
    vi,
    IV,
}
```

```text
chords Harmony {
    1,
    5,
    6m,
    4,
}
```

Resolution is §62.21。

---

---

---

---

# 13. Chord / Chord Context

Canonical harmony value preserves both sounding pitch classes and structural chord degrees。

```text
ChordToneV1 {
    degree: UInt8?

    alteration: Int8?
    semitones: Int16
}

Chord {
    root: PitchClass
    bass: PitchClass

    tones: List<ChordToneV1>

    pitch_class_mask: UInt16
    symbol: String?
}
```

`ChordToneV1.degree`:

```text
1..13:
    known structural diatonic degree

null:
    structural degree unknown
    used for imported/external pitch-set-only harmony
```

For known degree:

```text
alteration is required

base semitones:
    1  -> 0
    2  -> 2
    3  -> 4
    4  -> 5
    5  -> 7
    6  -> 9
    7  -> 11
    8  -> 12
    9  -> 14
    10 -> 16
    11 -> 17
    12 -> 19
    13 -> 21

semitones =
    base_semitones(degree)
    + alteration
```

Source chord modifiers currently produce alteration:

```text
-1, 0, +1
```

Programmatic Chord values permit:

```text
-2..+2
```

For `degree=null`:

```text
alteration = null
0 <= semitones <= 11
```

Canonical root tone:

```text
degree = 1
alteration = 0
semitones = 0
```

is required exactly once。

Canonical tone ordering:

```text
1. known degree ascending
2. same degree: alteration ascending
3. unknown degree after known tones
4. unknown: semitones ascending
```

Exact duplicate `(degree, alteration, semitones)` is removed。

`pitch_class_mask` is derived, not independently authored:

```text
mask = 0

for tone in tones:
    pc =
        (root + tone.semitones) mod 12

    set bit pc
```

bit `0..11 = C..B`。

`root` must therefore always be present in the mask。

Slash chord:

```text
bass may differ from root
bass need not be present in pitch_class_mask
```

`symbol` preserves authored/display chord spelling when available but is not semantic identity。

## 13.1 ChordContext

```text
ChordContext {
    current: Chord
    previous: Chord?
    next: Chord?

    start: MusicalTime
    end: MusicalTime
    duration: MusicalDuration

    index: UInt32
}
```

Helpers:

```text
root(ctx)        -> PitchClass
bass(ctx)        -> PitchClass

third(ctx)       -> PitchClass
fifth(ctx)       -> PitchClass
seventh(ctx)     -> PitchClass
ninth(ctx)       -> PitchClass

tone(ctx, n)     -> PitchClass
degree(ctx, n)   -> PitchClass
```

`root/bass` are direct fields。

Structural helper:

```text
third   -> degree 3
fifth   -> degree 5
seventh -> degree 7
ninth   -> degree 9
```

If no tone with that structural degree exists:

```text
compile error
```

If multiple altered tones of the same requested degree exist, for example both `b9` and `#9`:

```text
ambiguous chord-tone error
```

Use `tone(ctx,n)` or explicit filtering in a Macro instead。

`tone(ctx,n)`:

```text
n is 1-based
indexes canonical Chord.tones order
returns:
    (root + selected.semitones) mod 12
```

Out of range -> compile error。

`degree(ctx,n)` is **scale degree**, not chord-tone degree:

```text
requires active KeyContextV1V1

ordered scale =
    set bits of KeyContextV1.scale_mask
    in ascending semitone offset from tonic

1 <= n <= ordered scale tone count

result =
    (tonic + ordered_scale[n-1]) mod 12
```

Missing KeyContextV1 or out-of-range degree -> compile error。

Unlike `ScaleEvent.pitch_class_mask`, `KeyContextV1.scale_mask` stores **interval offsets relative to tonic** (§33.3)。

---

---

---

---

# 14. `follow`

`follow` repeats one note-pattern body inside every span of a Harmony Timeline。

Canonical example:

```text
track Bass {
    follow Harmony(octave: 2) {
        @4:
        root . fifth .,
    }
}
```

## 14.1 Invocation

```text
follow <HarmonyRef>(
    octave: Int
) {
    ...
}
```

`octave` is required when the body uses any implicit chord-derived pitch binding。

A body containing only explicit absolute `Pitch` values may omit `octave`。

For every `ChordEvent`:

```text
ctx.current  = current chord
ctx.previous = previous chord or null
ctx.next     = next chord or null

local timeline origin = chord event start
local span            = chord event duration
```

Each chord iteration starts with a fresh note-state snapshot:

```text
duration cursor:
    inherited from follow declaration entry

velocity cursor:
    inherited from follow declaration entry

pitch cursor:
    unset until first sounding Pitch

note group:
    unset
```

State changes inside one chord iteration do not leak into the next chord iteration。

## 14.2 Implicit bindings

Within a `follow` body:

```text
ctx
current
previous
next

root
bass
third
fifth
seventh
ninth

tone(n)
```

are predefined。

`current/previous/next` are Chord values。

Chord-derived note bindings are **Pitch**, not PitchClass。

Root lift:

```text
root_pitch =
    12 * (octave + 1)
    + current.root
```

because soraoto Pitch uses:

```text
C-1 = 0
```

Structural tone lift:

```text
third/fifth/seventh/ninth/tone(n) =
    root_pitch
    + selected ChordToneV1.semitones
```

Slash bass lift:

```text
bass =
    highest Pitch with pitch class current.bass
    such that bass <= root_pitch
```

If `bass == root pitch class`, bass equals `root_pitch`。

Examples for `octave:2`:

```text
C:
    root  = C2
    fifth = G2

G/B:
    root  = G2
    bass  = B1
```

`root(ctx)` etc. from §13 remain available when a PitchClass rather than lifted Pitch is needed。

## 14.3 Span rules

The body expands independently inside each chord span。

```text
body duration < chord duration:
    trailing remainder = rest

body duration == chord duration:
    exact

body duration > chord duration:
    compile error
```

A note/retrigger/sustain crossing the chord boundary is an overrun and is not silently truncated。

`,` in a `follow` body commits against the **current chord span**, not the outer Project meter bar。

Therefore a chord whose duration is not one meter bar may still use `,`; the commit target is that chord's exact duration。

## 14.4 Empty / zero-duration chord

Harmony `ChordEvent.duration` must be greater than zero when consumed by `follow`。

Clipboard-only instantaneous harmony markers with duration `0` cannot be used as `follow` input until they are assigned an explicit duration by arrangement context。

---

---

---

---

# 15. Harmony-derived generation

```text
track Bass {
    Harmony
    |> BassRoot(octave: 2, mode: chord_bass)
}
```

```text
track Piano {
    Harmony
    |> PianoVoicing(range: c3..c5, voice_leading: nearest)
}
```

```text
track Guitar {
    Harmony
    |> GuitarVoicing(style: open, voice_leading: nearest)
    |> GuitarStrum(style: pop8)
}
```

Compiler は dependency graph を保持し、Harmony 変更時は依存生成物のみ再コンパイルする。

---

---

---

---

# 16. Pattern / Event Fragment

`pattern` is a pure compile-time reusable musical fragment function。

Canonical fragment type:

```text
EventFragment<T> {
    events: Stream<T>
    duration: MusicalDuration
}

NotesFragment         = EventFragment<NoteEvent>
DrumFragment          = EventFragment<DrumPerformance>
PerformanceFragment<T> = EventFragment<T>
```

All event times inside a fragment are relative to fragment start:

```text
0 <= event.at < fragment.duration
```

An event may end exactly at `fragment.duration`。
An event extending beyond it is invalid unless the fragment-producing construct explicitly declares an allow-tail policy。

Basic pattern:

```text
pattern Motif(root: Pitch) {
    notes {
        @8:
        root . +2 +2 -3 .,
    }
}
```

Invocation:

```text
Motif(c4)
```

returns an `EventFragment<NoteEvent>`。

A pattern body must produce exactly one primary finite musical fragment:

```text
notes { ... }              -> NotesFragment
drums { ... }              -> DrumFragment
Performance<T> pipeline    -> PerformanceFragment<T>
```

Graph/Track/Bus construction is not permitted in `pattern`; use Component for that。

## 16.1 Pattern callable value / alias

A named `pattern` is an immutable compile-time callable value。

Conceptual inferred type:

```text
PatternFn<Args, ResultFragment>
```

Example:

```text
pattern Beat() -> DrumFragment {
    drums {
        @16:
        Kick  "x...x...x...x..."
        Snare "....X.......X..."
    }
}

let VersePattern = Beat

track Drums {
    VersePattern() * 8
}
```

Pattern aliasing does not clone or mutate the definition。
Invocation through an alias is semantically identical to invocation through the original symbol, except the expansion-site identity still contributes to generated EventIds。

An explicit return type is optional:

```text
pattern Motif(root: Pitch) -> NotesFragment {
    ...
}
```

When omitted, Compiler infers exactly one fragment result type from the body。

Two Pattern values may be selected by an `if`/`match` expression only when their full callable signatures are identical。

A Pattern value cannot cross the runtime Plugin ABI or be stored in Project IR。
It exists only during compilation。

## 16.2 Pattern cursor isolation

A pattern never reads or mutates the caller pitch/note-group cursor。

A pattern may require explicit musical compile context such as Meter Map when its body contains `,`/bar-relative constructs。
That dependency is part of the invocation's compile context, not hidden mutable state。

Each invocation starts with fresh internal note state:

```text
pitch cursor:
    unset

note group:
    unset

duration cursor:
    inherited from values explicitly captured in pattern definition/arguments only

velocity cursor:
    inherited from values explicitly captured in pattern definition/arguments only
```

Therefore a note fragment whose first sounding event is relative without an earlier absolute/local Pitch is invalid:

```text
pattern Bad() {
    notes {
        +2
    }
}
```

Caller-side:

```text
notes {
    c4
    Motif(g4)
    +2
}
```

The `+2` after `Motif` is relative to the caller's prior `c4`, not to the final pitch emitted by `Motif`。

## 16.3 First-class fragment values

Fragments are immutable compile-time values。

Module-level:

```text
let ROOT = c4

let IntroRiff = notes {
    @8:
    ROOT . +2 -2
}
```

Local:

```text
notes {
    let answer = notes {
        @8:
        g4 . -2 +4,
    }

    use answer
    use answer
}
```

Pattern result may also be stored。

Context-free example:

```text
pattern Cell(root: Pitch) {
    notes {
        @8:
        root . +2 -2
    }
}

let Hook = Cell(c4)
```

A module-level fragment value is legal only when static analysis proves that expansion does not require:

```text
active Meter Map
section identity
Track/voice identity
caller timeline bounds
```

A context-dependent Pattern invocation is stored with local `let` at its use-site context:

```text
notes {
    let hook = Motif(c4)

    use hook * 4
}
```

A module-level context-dependent fragment initializer is compile error rather than a deferred implicit environment capture。

Type rules:

```text
Pitch / PitchClass variable:
    may be used where a note pitch expression is expected

EventFragment<T> variable:
    may be expanded only into a compatible event destination

NotesFragment:
    notes / note-event track destination

DrumFragment:
    drums / drum-event track destination

PerformanceFragment<T>:
    matching Performance<T> destination
```

Incompatible fragment splice is compile error。

## 16.4 Fragment literal expressions

`notes { ... }` and `drums { ... }` are expressions when an expression is syntactically expected:

```text
let Fill = drums {
    @16:
    Snare "....r..."
}
```

The same tokens in structural Track context remain normal `notes` / `drums` statements。

The parser chooses by syntactic position; there is no ambiguity。

## 16.5 Fragment expansion

Expanding a fragment at current local timeline cursor `t`:

```text
for each event e:
    emit e with:
        at = t + e.at

advance local timeline cursor by:
    fragment.duration
```

Expansion does not mutate caller pitch cursor, note-group cursor, or fragment value。

The fragment is copied semantically, not shared as mutable events。
Every expansion derives fresh deterministic EventIds from:

```text
original fragment EventId
expansion site source_id
expansion ordinal
```

using the §19 EventId derivation rules。

---

---

---

---

# 17. Repeat

Generic compile-time repeat:

```text
fragment * N
```

where:

```text
fragment: EventFragment<T>
N: Int
N >= 0
```

Result:

```text
EventFragment<T>
```

with:

```text
duration =
    fragment.duration * N
```

and iteration `i` shifted by:

```text
i * fragment.duration
```

Examples:

```text
// at a structural use site with an active meter context:
Motif(c4) * 4

// context-free stored fragment:
let Hook = Cell(c4)
Hook * 2
```

`N = 0` yields an empty zero-duration fragment。

Each iteration is a fresh expansion and receives deterministic iteration-specific EventIds。

For source note-group shorthand:

```text
(c4 . +2 -2) * 4
```

the grouped note sequence is treated as an anonymous `NotesFragment`。

To keep the shorthand locally self-contained, grouped shorthand may not contain:

```text
bar commit `,`
section block
voice block
lyrics block
```

Use an explicit `notes { ... }` fragment/pattern for those cases。
Each iteration starts from the repeat-entry **internal fragment** cursor snapshot; iterations do not inherit pitch cursor mutations from the previous iteration。

Caller pitch cursor remains unchanged by the repeated fragment。

## 17.1 Drum lane repeat

Inside `drums {}` a lane pattern can be repeated directly:

```text
Kick  "x...x...x...x..." * 4
Snare "....X.......X..." * 4
Hat   "x.x.x.x.x.x.x.x." * 4
```

This is equivalent to repeating the decoded lane cell sequence `N` times before hit expansion。

A compile-time String variable is allowed:

```text
let FourOnFloor = "x...x...x...x..."

drums {
    @16:
    Kick FourOnFloor * 4
}
```

The multiplication here is a drum-lane grammar operation, not general `String * Int` arithmetic。

## 17.2 Whole drum pattern repeat

A complete multi-lane drum pattern should normally be factored as a `pattern`/`DrumFragment`:

```text
pattern Beat() {
    drums {
        @16:
        Kick  "x...x...x...x..."
        Snare "....X.......X..."
        Hat   "x.x.x.x.x.x.x.x."
    }
}

track Drums {
    Beat() * 8
}
```

This preserves lane overlay within each iteration while placing each repeated fragment sequentially。

---

---

---

---

# 18. Function

`fn` は Value -> Value の純粋関数。

```text
fn octave(p: Pitch) -> Pitch {
    p + 12
}
```

```text
fn fade(t: Norm) -> Db {
    lerp(-18db, -6db, ease_in(t))
}
```

Track / Bus / Graph を生成しない。

---

---

---

---

# 19. Macro

`macro` は **finite typed Event Stream -> finite typed Event Stream** の純粋変換である。

```text
Stream<T>

Notes              = Stream<NoteEvent>
Chords             = Stream<ChordEvent>
AutomationEvents<T> = Stream<AutomationEvent<T>>
Performance<T>     = Stream<T>
```

概念型:

```text
macro Humanize(input: Notes, ...) -> Notes
macro BassRoot(input: Chords, ...) -> Notes
macro GuitarVoicing(input: Chords, ...) -> Performance<GuitarPerformance>
```

Pipeline:

```text
source
|> MacroA(...)
|> MacroB(...)
```

標準 Macro:

```text
Humanize
Quantize
Swing
Transpose
Arpeggio
Accent
BassRoot
WalkingBass
PianoVoicing
GuitarVoicing
GuitarStrum
PadVoicing
```

Macro は compile-time のみで実行し、Audio Thread では実行しない。

## 19.1 Event Stream model

すべての stream item は論理的に以下を持つ。

```text
StreamItem<T> {
    id: EventId
    time: MusicalTime
    value: T
    provenance: Provenance
}
```

`EventId` は 128-bit の安定 ID。

Compiler が生成する ID は次の入力から決定論的に生成する。

```text
source-id
macro-invocation-id
input-event-id
emission-ordinal
```

`EventId128` derivation:

```text
payload =
    Deterministic-CBOR([
        "soraoto-event-id-v1",
        source_id,
        macro_invocation_id,
        input_event_id_bytes_or_null,
        emission_ordinal
    ])

digest = SHA-256(payload)

EventId128 = digest[0..16]
```

SHA-256 は FIPS 180-4。
`input_event_id_bytes_or_null` は 16-byte Bytes または CBOR null。

同一 stream 内 collision を検出した場合 compile error。
collision 時に別saltで黙って再生成してはならない。

wire representation:

```text
EventId = EventId128
EventId128 = Bytes length exactly 16
```

`EventId` は `EventId128` の完全なaliasであり別型ではない。

Macro の前後で不要に EventId を変えてはならない。

- `map` は原則として入力 EventId を保持する。
- `filter` は残存 item の EventId を保持する。
- `flat_map` で 1 個目の派生 item は入力 EventId を継承できる。
- 2 個目以降は `input-event-id + emission-ordinal` から派生 ID を生成する。
- Stream 全体を新規生成する Macro は invocation ID と output ordinal から生成する。

## 19.2 Macro body syntax

Macro body は immutable `let` と `return` のみを持つ純粋式ブロックである。

```text
macro AccentEvery(
    input: Notes,
    every: Int,
    amount: Float
) -> Notes {
    let out =
        input
        |> map |e, i| {
            match e {
                Note n if i % every == 0 =>
                    e with {
                        velocity: clamp(n.velocity * amount, 0.0, 1.0)
                    }

                _ => e
            }
        }

    return out
}
```

可変変数、I/O、thread、async、wall clock は使用できない。

### Macro grammar

Macro の parser-level grammar は **§62.7–§62.8 の formal EBNF** を唯一の定義とする。

この章では stream operator の意味論だけを定義する。

```text
macro:
    pure compile-time transform

body:
    immutable let*
    one final return

pipeline target:
    stream_operator or ordinary callable postfix expression
```

early return はない。

### Immutable update

```text
value with {
    field: expression
    ...
}
```

は元 value を mutation せず、新しい value を返す。

### Match

```text
match value {
    Pattern [if guard] => expression
    ...
    _ => expression
}
```

case は上から評価。

exhaustive でない `match` は compile error。

## 19.3 Stream operators

以下を language built-in として固定する。

### `map`

```text
stream |> map |item, index| expression
```

1 input item につき 1 output item。

### `filter`

```text
stream |> filter |item, index| predicate
```

`predicate == true` の item のみ残す。

### `flat_map`

```text
stream |> flat_map |item, index| [item0, item1, ...]
```

0 個以上の item を生成できる。

削除:

```text
input
|> flat_map |e, i| {
    if should_drop(e) { [] } else { [e] }
}
```

複数生成:

```text
input
|> flat_map |e, i| {
    [e, e with { time: e.time + @8 }]
}
```

### `enumerate`

```text
stream |> enumerate
```

`Stream<(Int, T)>` を返す。index は canonical stream order に対する 0-based index。

### `take` / `drop`

```text
stream |> take(8)
stream |> drop(4)
```

### `merge`

```text
a |> merge(b)
```

両 stream の絶対 time を維持したまま overlay し、canonical order に再整列する。

### `shift`

```text
stream |> shift(@8)
stream |> shift(-20ms)
```

全 item の time を同量移動する。

### `window(count: ...)`

```text
stream
|> window(
    count: 4,
    step: 2,
    partial: keep
)
```

返り値:

```text
Stream<Window<T>>
```

```text
Window<T> {
    index: Int
    items: List<StreamItem<T>>
    start: MusicalTime
    end: MusicalTime
}
```

`partial`:

```text
keep
drop
```

### `window(time: ...)`

```text
stream
|> window(
    time: 1bar,
    step: 1bar,
    align: bar,
    partial: keep
)
```

`align`:

```text
stream_start
bar
project
```

### `group_by_time`

```text
stream |> group_by_time()
```

同一 logical time の item を 1 `Window<T>` にまとめる。

### `fold`

```text
let total =
    stream
    |> fold(0) |state, item, index| {
        state + 1
    }
```

`fold` は Stream ではなく最終 accumulator value を返す。

### `scan`

```text
stream
|> scan(0) |state, item, index| {
    state + 1
}
```

各 step の accumulator を `Stream<S>` として返す。

各 output item:

```text
time = corresponding input item time
id = derived(input.id, "scan")
```

### `sort_within_time`

```text
stream
|> sort_within_time |item| item.pitch
```

同一 time bucket 内だけを key の昇順で安定 sort する。

異なる time 間の順序を変更してはならない。

## 19.4 Canonical stream order

各 Macro operator の出力は次の順で canonicalize する。

```text
1. logical time
2. source order
3. emission ordinal
4. EventId
```

`sort_within_time` を使用した場合のみ 2 の前に user key を入れる。

同一 stream 内に duplicate `EventId` が残った場合は compile error。

これにより同一 source / seed / input に対する結果を完全に再現可能にする。

## 19.5 Stream finiteness

Macro input は compile 時に有限範囲へ解決されていなければならない。

禁止:

```text
infinite stream
unbounded recursion
while
runtime waiting
async stream
```

`repeat` / `window` / `flat_map` の expansion 数は Compiler が静的または実行時 compile budget 内で上限検査する。

Compiler の既定 expansion 上限:

```text
1 macro invocation:
    1,000,000 output items

1 project compile:
    10,000,000 generated items
```

明示 project option で上限を増やせるが、無限 expansion は常に error。

## 19.6 Deterministic random

stateful global RNG は使用しない。

標準 random は key-based。

```text
rand(seed: UInt64, key: Hashable) -> Norm
rand_range(seed, key, min, max)
rand_bool(seed, key, probability)
```

`Hashable`:

```text
Bool
Int
String
Bytes
EventId128
enum value
tuple/list of Hashable
```

canonical Hashable wire:

```text
Bool:
    {"t":"bool","v":Bool}

Int:
    {"t":"int","v":Int64}

String:
    {"t":"string","v":String}

Bytes:
    {"t":"bytes","v":Bytes}

EventId128:
    {"t":"event_id","v":Bytes length 16}

enum:
    {
      "t":"enum",
      "type": fully-qualified-type-name,
      "case": case-name
    }

tuple:
    {"t":"tuple","v":List<Hashable>}

list:
    {"t":"list","v":List<Hashable>}
```

これを §61 profile の Deterministic CBOR で encode する。
異なる Hashable type が同じ byte sequence になってはならない。

`rand` algorithm:

```text
payload =
    Deterministic-CBOR([
        "soraoto-rand-v1",
        seed,
        key
    ])

digest = SHA-256(payload)

u64be =
    digest[0] << 56 |
    digest[1] << 48 |
    ...
    digest[7]

u53 = u64be >> 11

rand = Float64(u53) / 9007199254740992.0
```

range:

```text
0.0 <= rand < 1.0
```

`rand_bool`:

```text
0 <= probability <= 1
result = rand(seed,key) < probability
```

`rand_range`:

```text
min <= max required
result = min + rand(seed,key) * (max - min)
```

unit付き scalar は同じdimensionのcanonical base unitへ変換して計算し、元target unitへ戻す。

JS Component `soraoto.rand` / `soraoto.randRange` もこの algorithm を使用する。

同一 `(seed,key)` は同一 Norm を返す。
他イベントの追加・削除で既存 EventId-based key の random 値は変化しない。

## 19.7 Time validity

Macro output は自身の許可された span を超えてよいが、最終 Timeline Resolution 時に次を適用する。

```text
project time < pickup start
    compile error

event end > explicitly bounded clip end
    clip policy に従う
```

Clip policy:

```text
clip
allow_tail
error
```

既定:

```text
notes/performance -> clip
automation       -> clip
effect tail      -> allow_tail
```

## 19.8 Standard Macro Library v1

The names listed in §19 as Standard Macro are normative built-ins of:

```text
soraoto:stdlib@1
```

An implementation may optimize them but output Event values, EventIds/order, and diagnostics must be equivalent to this section。

All generated EventIds use §19 deterministic derivation。
All ranges use half-open MusicalTime intervals unless stated otherwise。

### 19.8.1 Humanize

```text
Humanize(
    input: Notes,
    timing: BeatDuration = 0beat,
    velocity: Norm = 0,
    seed: UInt64
) -> Notes
```

constraints:

```text
timing >= 0
0 <= velocity <= 1

if timing > 0 or velocity > 0:
    seed required
```

For each event `e`:

```text
dt =
    deterministic_random_musical_time_offset(
        timing,
        seed,
        (e.id, "humanize-time")
    )

dv =
    rand_range(
        seed,
        (e.id, "humanize-velocity"),
        -velocity,
        +velocity
    )

time' =
    e.time + dt

velocity' =
    clamp(e.velocity + dv, 0, 1)
```

`deterministic_random_musical_time_offset` is exactly §62.16。

Duration/pitch/other attributes unchanged。

Final canonical stream ordering is reapplied。
Timeline-bound violations follow §19.7。

### 19.8.2 Quantize

```text
Quantize(
    input: Notes,
    grid: BeatDuration,
    strength: Norm = 1
) -> Notes
```

constraints:

```text
grid > 0
```

Grid origin:

```text
project bar-1 origin = MusicalTime 0
```

For event time `t` in quarter-note beats:

```text
q =
    t / grid

lower =
    floor(q)

upper =
    lower + 1

nearest_index =
    lower
    when abs(q-lower) <= abs(upper-q)
    else upper

target =
    nearest_index * grid

w =
    time_weight(strength)   // §62.16

time' =
    t + (target - t) * w
```

Exact tie goes to the earlier grid point。
Duration is unchanged。

### 19.8.3 Swing

```text
Swing(
    input: Notes,
    grid: BeatDuration = 1/8,
    amount: Norm = 1
) -> Notes
```

constraints:

```text
grid > 0
```

Subdivision index relative project origin:

```text
i =
    floor(time / grid)
```

Even index:

```text
unchanged
```

Odd index:

```text
w =
    time_weight(amount)   // §62.16

delay =
    grid * w / 3

time' =
    time + delay
```

Therefore:

```text
amount=0:
    straight

amount=1:
    exact 2:1 triplet swing
```

Only event onset moves; duration unchanged。

### 19.8.4 Transpose

```text
Transpose(
    input: Notes,
    by: Semitone
) -> Notes
```

```text
pitch' =
    pitch + by
```

Any pitch-curve offset is unchanged。

For a Performance stream with a `pitch` field, the generic overloaded standard function applies the same transformation only when physical metadata can remain valid。
For Guitar/Bass/PedalSteel explicit string/fret metadata, generic Transpose is compile error; use the family voicing/compiler again。

### 19.8.5 Accent

```text
Accent(
    input: Notes,
    every: UInt32,
    amount: Float = 1.15,
    offset: UInt32 = 0
) -> Notes
```

constraints:

```text
every >= 1
amount >= 0
```

Events are enumerated in canonical stream order。

```text
if (index - offset) mod every == 0:
    velocity' =
        clamp(velocity * amount, 0, 1)
else:
    unchanged
```

`offset` is interpreted modulo `every`。

### 19.8.6 Arpeggio

```text
Arpeggio(
    input: Chords,

    rate: BeatDuration = 1/8,

    order:
        up
        down
        up_down
        as_chord = up,

    octave: Int = 4,

    octaves: UInt8 = 1
) -> Notes
```

constraints:

```text
rate > 0
octaves >= 1
```

For each Chord span:

```text
base tones =
    distinct sounding pitch classes from Chord.tones
    ordered by Chord canonical tone order
```

Lift each tone to the lowest Pitch:

```text
>= C(octave)
```

with the corresponding pitch class。

Replicate upward across `octaves` and remove exact duplicate Pitches。

Ordering:

```text
up:
    ascending Pitch

down:
    descending Pitch

up_down:
    ascending then descending interior pitches
    endpoints not duplicated

as_chord:
    Chord canonical tone order after octave lift
```

Emit one note every `rate`, cycling the ordered sequence until chord span end。

Each event:

```text
duration =
    min(rate, chord_end - onset)

velocity =
    0.8
```

No event may cross chord end。

### 19.8.7 BassRoot

```text
BassRoot(
    input: Chords,

    octave: Int,

    mode:
        root
        chord_bass = chord_bass
) -> Notes
```

For each ChordEvent:

```text
mode=root:
    pc = chord.root

mode=chord_bass:
    pc = chord.bass
```

Pitch:

```text
root_pitch =
    12*(octave+1) + chord.root

mode=root:
    pitch = root_pitch

mode=chord_bass:
    pitch =
        highest pitch with pitch class chord.bass
        <= root_pitch
```

Emit:

```text
one NoteEvent
onset = chord.at
duration = chord.duration
velocity = 0.8
articulation = null
```

### 19.8.8 WalkingBass

```text
WalkingBass(
    input: Chords,

    octave: Int,
    rate: BeatDuration = 1/4
) -> Notes
```

constraints:

```text
rate > 0
```

For each Chord span, step index `k` from 0:

```text
k mod 4 = 0:
    root

k mod 4 = 1:
    degree 3 if unambiguous
    else lowest non-root canonical chord tone

k mod 4 = 2:
    degree 5 if unambiguous
    else highest canonical chord tone

k mod 4 = 3:
    chromatic approach to next chord root/bass
```

Approach:

```text
target =
    next chord bass when slash bass differs
    else next chord root

choose target-1 or target+1 pitch class
whose lifted Pitch minimizes absolute distance
from previous emitted Pitch

tie:
    lower Pitch
```

For final Chord with no next:

```text
k mod 4 = 3:
    chord seventh if present
    else root
```

All chord-tone lifts choose the nearest Pitch to the previous emitted Pitch within:

```text
C(octave-1) .. B(octave+1)
```

First event uses §19.8.7 root lift。

No event crosses chord span。

### 19.8.9 PianoVoicing

```text
PianoVoicing(
    input: Chords,

    range: Range<Pitch>,

    voices: UInt8 = 4,

    voice_leading:
        nearest
        smooth = nearest
) -> Notes
```

`range` endpoints are inclusive for this API。

constraints:

```text
voices >= 1
range.start <= range.end
```

For every Chord, form candidate Pitches in range whose pitch class is present in `chord.pitch_class_mask`。

A voicing candidate:

```text
exactly `voices` pitches
strictly ascending
duplicate pitch prohibited
```

Required structural tone priority:

```text
root
degree 3 when present
degree 7 when present
degree 5 when present
remaining canonical tones
```

If `voices` is less than required-tone count, keep the first `voices` by priority。
If `voices` is greater, duplicate chord pitch classes at different octaves as necessary。

Every retained required pitch class must occur at least once。

Candidate cost:

For first chord:

```text
1. total span
2. sum abs(pitch - range midpoint)
3. pitch vector lexicographic ascending
```

For later chord:

```text
match voice index low->high

1. sum abs(new[i] - previous[i])
2. maximum abs(new[i] - previous[i])
3. total span
4. sum pitch
5. pitch vector lexicographic
```

If voice count changed by future extension, minimum-length indices are compared first; Draft v0.5 fixed `voices` prevents this case。

Emit simultaneous NoteEvents:

```text
onset = chord.at
duration = chord.duration
velocity = 0.75
```

No valid candidate -> compile error。

### 19.8.10 PadVoicing

```text
PadVoicing(
    input: Chords,

    range: Range<Pitch>,
    voices: UInt8 = 4,

    voice_leading:
        smooth
        nearest = smooth
) -> Notes
```

Uses exactly the `PianoVoicing` candidate generation/cost rules。

Only default emitted velocity differs:

```text
velocity = 0.65
```

### 19.8.11 GuitarVoicing

```text
GuitarVoicing(
    input: Chords,

    style:
        open
        compact = open,

    tuning: List<Pitch> =
        [e4, b3, g3, d3, a2, e2],

    frets: UInt16 = 24,

    max_fret_span: UInt8 = 5,

    voice_leading:
        nearest
        smooth = nearest
) -> Performance<GuitarPerformance>
```

String 1 is highest-pitched string, matching §36。

For every chord, enumerate per-string states:

```text
mute
or
fret 0..frets
```

A sounding string is valid when produced pitch class is in the Chord mask。

Candidate requirements:

```text
at least 3 sounding strings
no more than 6 sounding strings

root pitch class present

degree 3 present when structurally available
degree 7 present when structurally available

fretted-note span:
    max positive fret - min positive fret
    <= max_fret_span

open strings are excluded from fret-span calculation
```

`style=open` cost, first chord:

```text
1. maximum fret
2. fret span
3. number of muted strings
4. sum fret
5. string/fret state vector lexicographic
```

Later chord adds first priority:

```text
sum absolute fret movement
for strings sounding in both old and new voicing
```

and second priority:

```text
number of string mute/sound state changes
```

then the first-chord cost list。

Emit one `GuitarPerformance` per sounding string:

```text
start = chord.at
duration = chord.duration
string/fret exact
technique = normal
velocity = 0.75
```

No valid fingering -> compile error。

### 19.8.12 GuitarStrum

```text
GuitarStrum(
    input: Performance<GuitarPerformance>,

    style:
        pop8
        custom = pop8,

    rhythm: String? = null,

    spread: BeatDuration = 1/128
) -> Performance<GuitarPerformance>
```

Input events are grouped by identical `(start,duration)` into chord voicings。

Rhythm source:

```text
style=pop8 and rhythm=null:
    "D.DU.UD."

rhythm!=null:
    use rhythm exactly
```

Rhythm characters:

```text
D:
    down stroke

U:
    up stroke

.:
    no stroke
```

Whitespace is forbidden inside the rhythm string。
At least one stroke required。

The pattern is stretched uniformly over each input group duration:

```text
cell_duration =
    group.duration / rhythm.length
```

Each stroke retriggers the group notes at its cell onset。

String ordering:

```text
D:
    low-pitched string -> high-pitched string
    therefore descending numeric string number

U:
    high-pitched string -> low-pitched string
    ascending numeric string number
```

Per-note offset within a stroke:

```text
N = sounding string count

effective_spread =
    min(
        spread,
        cell_duration / 2
    )

N <= 1:
    offset = 0

N > 1:
    offset_i =
        effective_spread * i/(N-1)
```

Thus all strummed notes remain inside the first half of the stroke cell without any tempo-dependent second conversion。

A retriggered note duration:

```text
min(
    cell_duration - offset_i,
    group_end - note_start
)
```

All arithmetic is exact MusicalDuration rational arithmetic until Timeline Resolution。

Generated `GuitarPerformance` preserves string/fret/technique and scales velocity:

```text
D: 1.00
U: 0.92
```

clamped `0..1`。

Input chord group events themselves are replaced by generated strokes, not retained。

---

---

---

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

---

# 29. Realtime ABI memory layout

すべての pointer は Plugin exported `memory` への **u32 byte offset**。

全 multi-byte scalar は WebAssembly little-endian。

Host は `soraoto_alloc` で 8-byte alignment 以上を確保する。

## 29.0 ABI constants / flag bits

### SoraotoAudioBusBufferV1.flags

ABI 1.0:

```text
0
```

全 bit reserved。Host / Plugin は 0 を書く。

### SoraotoRealtimeEventV1.flags

ABI 1.0:

```text
bit 0   LIVE_INPUT
bit 1   GENERATED
bits 2..15 reserved
```

### SoraotoProcessContextV1.valid_flags

```text
bit 0   CONTINUOUS_SAMPLE_VALID
bit 1   MUSICAL_POSITION_VALID
bit 2   BAR_POSITION_VALID
bit 3   TEMPO_VALID
bit 4   TIME_SIGNATURE_VALID
bit 5   CYCLE_VALID
bit 6   SYSTEM_TIME_VALID
bit 7   SMPTE_VALID
bit 8   CLOCK_VALID
bit 9   CHORD_VALID
bit 10  SCALE_VALID
bit 11  PRESENTATION_LATENCY_VALID
bit 12  CHANNEL_CONTEXT_VALID
bits 13..31 reserved
```

### SoraotoProcessContextV1.state_flags

```text
bit 0   PLAYING
bit 1   RECORDING
bit 2   LOOPING
bit 3   OFFLINE
bit 4   TRANSPORT_DISCONTINUITY
bit 5   AUTOMATION_READ
bit 6   AUTOMATION_WRITE
bit 7   PREFETCH
bits 8..63 reserved
```

### SoraotoAssetRequestV1.flags

```text
bit 0   PREFETCH
bit 1   HIGH_PRIORITY
bits 2..31 reserved
```

### SoraotoProcessBlockV1.flags

ABI 1.0:

```text
bit 0   END_OF_STREAM
bits 1..31 reserved
```

`END_OF_STREAM` は offline/source end を示し、Plugin は新規 input がないことを知る。

### SoraotoProcessBlockV1.process_status_flags

```text
bit 0   WANTS_SLEEP
bits 1..31 reserved
```

## 29.0.1 Pointer / count validity

`SoraotoProcessBlockV1` から到達する全 pointer/count pair に共通:

```text
count/size/capacity == 0:
    pointer may be 0 or valid aligned non-zero pointer
    receiver must not dereference

count/size/capacity > 0:
    pointer must be non-zero
    entire range must be inside current exported linear memory

range arithmetic:
    checked unsigned arithmetic
    wraparound is invalid
```

Array byte size:

```text
count * sizeof(element)
```

must not overflow UInt32 and must be in-bounds.

Host-provided input ranges are read-only from Plugin semantic perspective unless explicitly documented as output/in-place audio.

Plugin must not write:

```text
input event array
input parameter array
ProcessContext
asset completion array
input blob
```

Host must not mutate ProcessBlock-associated Plugin memory while `soraoto_plugin_process` is executing.

Output arrays/blobs are Plugin-writable only for the current process call.

invalid pointer/range/alignment generated by Host:
    Host ABI violation; Plugin behavior is not required

invalid output count/range generated by Plugin:
    Plugin fault


## 29.1 SoraotoAudioBusBufferV1 — 32 bytes

```text
offset size field

0      4   bus_id: u32
4      4   channel_count: u32
8      4   channels_ptr: u32
12     4   flags: u32
16     8   silence_mask: u64
24     8   reserved: u64
```

`channels_ptr` は:

```text
u32[channel_count]
```

各 pointer は `num_frames` 個の `f32` または `f64` planar sample buffer。

alignment:

```text
channels_ptr table:
    4-byte aligned

each audio sample buffer:
    at least 16-byte aligned

struct arrays:
    at least 8-byte aligned
```

Host が提供する pointer がこの alignment を満たさない場合 Host ABI violation。

最大 `channel_count = 64`。

`silence_mask` bit N:

```text
1 -> channel N は全 sample 0 と Host/Plugin が保証
0 -> silence guarantee なし
```

Plugin は output の `silence_mask` を process 後に更新する。

## 29.2 In-place processing

`supports_in_place == true` の場合、Host は同一 channel buffer pointer を input/output に使用できる。

Plugin は alias を正しく処理しなければならない。

false の場合 Host は distinct buffer を提供する。

## 29.3 SoraotoParameterPointV1 — 24 bytes

```text
0    4   parameter_id: u32
4    4   sample_offset: u32
8    8   normalized_value: f64
16   8   gesture_id: u64
```

input は:

```text
(sample_offset, parameter_id)
```

の昇順。

同一 `(sample_offset, parameter_id)` は 1 個に coalesce し、最後の authored value を使用する。

## 29.4 Parameter interpolation

`step`:

```text
sample_offset で即時切替
```

`linear`:

```text
隣接 parameter point 間を normalized domain で linear interpolation
```

block 開始時の初期値は前 block 最終値。

曲線 Automation は Host が sample grid 上で exact evaluation し、線形で表現できない区間は必要数の point へ lower する。

capacity を超える場合:

```text
Host は block を sub-block に分割する
```

point を捨ててはならない。


Plugin output `SoraotoParameterPointV1` は:

```text
read_only meter update
Plugin-originated writable parameter update
```

に使用する。

input automation point は:

```text
gesture_id = 0
```

Plugin が linked parameter edit を生成する場合:

```text
gesture_id != 0
```

同一 editing session に属する複数 parameter point は同じ `gesture_id` を使用する。

Host は output point を current parameter snapshot に反映する。
`PARAM_GESTURE_BEGIN/END` と同じ gesture_id に属する writable change だけを automation-recording edit session として扱う。

## 29.5 SoraotoModulationBufferV1 — 16 bytes

```text
0   4   parameter_id: u32
4   4   values_ptr: u32
8   4   depth_norm: f32
12  4   reserved: u32
```

`values_ptr`:

```text
f32[num_frames]
```

各 sample:

```text
-1.0 .. +1.0
```

最終 normalized value:

```text
final =
    clamp(
        automated_base
        + modulation_sample * depth_norm,
        0,
        1
    )
```

同一 parameter への複数 modulation source は Host が加算し、1 buffer に合成してから渡す。

### control-rate modulation

descriptor:

```text
{
    "kind": "control",
    "max_quantum_samples": UInt32
}
```

validation:

```text
max_quantum_samples >= 1
PluginConfig.control_quantum_samples >= 1
```

Host は:

```text
quantum =
    min(
        Plugin max_quantum_samples,
        PluginConfig.control_quantum_samples
    )
```

ごとに modulation を sample し、最終 normalized value を `SoraotoParameterPointV1` へ lower する。

### audio-rate modulation

descriptor:

```text
{
    "kind": "audio"
}
```

Host は `SoraotoModulationBufferV1` を渡す。

`modulation.kind = "none"` への DSL modulation は compile error。

## 29.6 SoraotoRealtimeEventV1 — 64 bytes

common header:

```text
0    2   kind: u16
2    2   flags: u16
4    4   size: u32 = 64
8    4   bus_id: u32
12   4   sample_offset: u32
16   8   event_id: u64
24  40   payload
```

event `flags`:

```text
bit 0   LIVE
bits 1..15 reserved = 0
```

`LIVE`:

```text
Host input:
    event originates from live/user/device input rather than deterministic timeline playback

Plugin output:
    may be set only when the output event is causally derived from a live input event
    or from an explicitly live Plugin source

offline render:
    Host input LIVE = 0
```

Host routes/preserves `LIVE` where downstream semantics can use it。
The flag does not change sample ordering, note identity, or determinism of non-live Project playback。

`event_id` は realtime `note_id` として note life cycle 間で維持する。

identity scope:

```text
event_id uniqueness:
    one active EventBus stream

Host input:
    Host guarantees no duplicate active note id on the same bus

Plugin output:
    Plugin guarantees no duplicate active note id on the same output bus

cross-bus:
    same numeric event_id allowed
```

Host が output event を別 Plugin へ route する場合、`(source instance, source bus, event_id)` から destination bus-local `event_id` へ remap する。

standard kind:

```text
1   NOTE_ON
2   NOTE_OFF
3   NOTE_EXPRESSION
4   CONTROLLER
5   PROGRAM_CHANGE
6   MIDI1
7   MIDI2_UMP
8   CUSTOM
9   PARAM_GESTURE_BEGIN
10  PARAM_GESTURE_END
11  NOTE_EXPRESSION_INT
12  NOTE_EXPRESSION_TEXT
13  CHORD
14  SCALE
15  SYSEX
16  DATA
17  VOCAL_LYRIC
18  VOCAL_PHONEME
```

### NOTE_ON / NOTE_OFF payload

```text
24   8   pitch_semitones: f64
32   4   velocity: f32
36   4   unit_id: u32
40   2   channel: u16
42   2   reserved
44   4   articulation_id: u32
48   4   length_samples_hint: u32
52  12   reserved
```

Pitch scale:

```text
C-1 = 0.0
C4  = 60.0
A4  = 69.0
```

fractional semitone を許可。

`channel = 0xffff` は channel-less native soraoto-note-v1。

NOTE/OFF validation:

```text
pitch_semitones:
    finite Float64

velocity:
    finite Float32
    0..1

unit_id:
    existing Unit
    must equal:
        channel_unit_override[channel] when an explicit channel override exists
        otherwise EventBusDescriptor.unit_id

channel:
    explicit index < EventBusDescriptor.channel_count
    or 0xffff

articulation_id:
    0 or existing ArticulationDescriptor.id

length_samples_hint:
    NOTE_ON:
        0 = unknown / not supplied
        >0 = expected note duration from this NoteOn sample

    NOTE_OFF:
        must be 0
```

`length_samples_hint` is advisory but sample-exact when non-zero。
A NOTE_OFF is still required and remains authoritative for actual note termination。

If actual NOTE_OFF differs from the hint:

```text
Plugin must follow NOTE_OFF
Host/Plugin may use the hint only for planning/envelope/lookahead
```

For `NOTE_ON`:

```text
event_id != 0
no currently-active note with same event_id on this bus
```

For `NOTE_OFF`:

```text
event_id identifies an active note on this bus

pitch_semitones
unit_id
channel
articulation_id

must equal the corresponding NOTE_ON values

length_samples_hint:
    ignored for matching and must be 0 on NOTE_OFF
```

`NOTE_OFF.velocity` is release velocity。
Same-sample NoteExpression events for that note are ordered before NOTE_OFF by §29.7。
After NOTE_OFF is processed, the note ID is inactive immediately。

### NOTE_EXPRESSION payload

```text
24   4   expression_id: u32
28   4   unit_id: u32
32   8   value: f64
40  24   reserved
```

### CONTROLLER payload

```text
24   4   controller_id: u32
28   2   channel: u16
30   2   group: u16
32   8   value: f64
40  24   reserved
```

`soraoto-note-v1` では:

```text
controller_id:
    ControllerDescriptorV1.id

value:
    finite normalized 0..1

channel:
    0xffff = channel-less
    otherwise < active EventBusDescriptor.channel_count

group:
    0xffff = no group
    otherwise 0..15 for MIDI-group-addressed semantic mappings
```

`controller_id=0` / 未登録 ID は ABI error。

### PROGRAM_CHANGE payload

```text
24   4   program_list_id: u32
28   4   program_id: u32
32   4   unit_id: u32
36  28   reserved
```

PROGRAM_CHANGE validation:

```text
program_list_id/program_id:
    existing pair

unit_id:
    existing Unit
    ProgramListDescriptor.unit_id must equal unit_id
```

If Program change is received on an EventBus whose default/overridden Unit is incompatible with `unit_id`, the event is invalid rather than silently redirected。

### MIDI1 payload

```text
24   1   len: u8
25   3   data[3]
28  36   reserved
```

### MIDI2_UMP payload

```text
24   1   word_count: u8
25   3   reserved
28  16   words[4]: u32
44  20   reserved
```

### CUSTOM payload

```text
24   4   custom_type_id: u32
28   4   blob_offset: u32
32   4   blob_len: u32
36  28   reserved
```

`blob_offset` は `ProcessBlock.input_blob_ptr` / `output_blob_ptr` からの byte offset。

`CUSTOM.custom_type_id` は selected `custom:<reverse-dns-id>` dialect 内だけで意味を持つ Plugin-defined UInt32。
Host は値を解釈せず、同じ custom dialect の edge 上だけ opaque transport する。


### PARAM_GESTURE_BEGIN / PARAM_GESTURE_END payload

```text
24   8   gesture_id: u64
32   4   primary_parameter_id: u32
36  28   reserved
```

validation:

```text
gesture_id != 0

primary_parameter_id:
    existing writable ParameterDescriptor.id
    or 0 when the gesture intentionally has no single primary parameter
```

Host は同一 gesture_id の BEGIN〜END を1 linked editing sessionとして扱う。
複数 parameter の `SoraotoParameterPointV1.gesture_id` が同一であれば1 undo/automation edit unit。

Group-edit timing:

```text
session timestamp =
    absolute project sample corresponding to PARAM_GESTURE_BEGIN.sample_offset

all writable parameter points with the same gesture_id:
    belong to that same edit/undo transaction
    even when they occur at later samples/blocks before END
```

This is the functional equivalent of VST `startGroupEdit/finishGroupEdit` timestamp grouping。

Nesting:

```text
same gesture_id BEGIN while already active:
    invalid

END for inactive gesture_id:
    invalid

different gesture_id sessions:
    may overlap only when their parameter sets are disjoint
```

If two active gestures attempt to write the same parameter:

```text
Plugin output validation error
```

gesture_id がない output change は meter/state update であり automation recording edit ではない。

### NOTE_EXPRESSION_INT payload

```text
24   4   expression_id: u32
28   4   unit_id: u32
32   8   value: i64
40  24   reserved
```

### NOTE_EXPRESSION_TEXT payload

```text
24   4   expression_id: u32
28   4   unit_id: u32
32   4   blob_offset: u32
36   4   blob_len: u32
40  24   reserved
```

Expression event validation:

```text
event_id:
    active note on same EventBus

expression_id:
    existing NoteExpressionDescriptor.id

unit_id:
    equals NoteExpressionDescriptor.unit_id

NOTE_EXPRESSION:
    descriptor.value.kind = numeric
    value finite
    descriptor.value.min <= value <= descriptor.value.max

NOTE_EXPRESSION_INT:
    descriptor.value.kind = integer
    descriptor.value.min <= value <= descriptor.value.max

NOTE_EXPRESSION_TEXT:
    descriptor.value.kind = text
    blob is valid UTF-8 NFC
```

If:

```text
descriptor.value.flags.one_shot = true
```

the expression event must occur at the same sample position as the associated NoteOn for that note。
A later update for that same `(event_id, expression_id)` is invalid。

`bipolar` / `absolute` are semantic metadata only and do not change the binary payload layout。

`NOTE_EXPRESSION_TEXT` with `blob_len=0` means empty UTF-8 string, not absent value。

Standard expression constraints:

```text
id 2 pressure:
    numeric range must include 0..1 semantics

id 3 timbre:
    numeric range must include 0..1 semantics

id 5 pan:
    bipolar=true

id 9 text:
    value.kind=text

id 10 phoneme:
    value.kind=text
```

A Host may reject a descriptor that assigns a contradictory value kind to a standard ID。

### VOCAL_LYRIC payload

`VOCAL_LYRIC` is valid only on selected dialect:

```text
soraoto-vocal-v1
```

and is note-scoped。

```text
24   8   lyric_group_id: u64
32   4   surface_blob_offset: u32
36   4   surface_blob_len: u32
40   4   reading_blob_offset: u32
44   4   reading_blob_len: u32
48   4   language_blob_offset: u32
52   4   language_blob_len: u32
56   2   melisma_index: u16
58   2   melisma_count: u16
60   4   lyric_flags: u32
```

`event_id` identifies the active note on the same EventBus。

`lyric_group_id` is a non-zero Host session-local collision-free mapping of canonical `VocalLyricV1.lyric_unit_id`。
Hash truncation alone is forbidden。

All text blobs are UTF-8 NFC。

validation:

```text
reading non-empty
language = canonical BCP 47 tag or "und"
melisma_count >= 1
melisma_index < melisma_count
```

`lyric_flags`:

```text
bit 0   WORD_BOUNDARY_AFTER
bit 1   PHRASE_START
bit 2   PHRASE_END
bits 3..31 reserved = 0
```

The event occurs at exactly the same sample as the associated NOTE_ON。

### VOCAL_PHONEME payload

`VOCAL_PHONEME` is valid only on `soraoto-vocal-v1` and is note-scoped。

```text
24   4   phoneme_blob_offset: u32
28   4   phoneme_blob_len: u32
32   4   alphabet_blob_offset: u32
36   4   alphabet_blob_len: u32
40   4   duration_samples_hint: u32
44   4   phoneme_index: u32
48   4   phoneme_count: u32
52  12   reserved
```

validation:

```text
event_id:
    active note on same EventBus

phoneme:
    UTF-8 NFC, non-empty

alphabet:
    "ipa" or vendor:<reverse-dns-id>:<alphabet>

phoneme_count >= 1
phoneme_index < phoneme_count
```

`sample_offset` is the phoneme start sample。

`duration_samples_hint`:

```text
0  = unknown/unavailable
>0 = expected phoneme duration from sample_offset
```

For canonical §63.13 phonemes with known note duration:

```text
start =
    note_start_sample
    + round_ties_even(note_duration_samples * phoneme.start)

end =
    note_start_sample
    + round_ties_even(note_duration_samples * phoneme.end)

duration_samples_hint =
    max(0, end - start)
```

If multiple phoneme boundaries quantize to one sample, preserve canonical phoneme index order。
NOTE_OFF remains authoritative for actual note termination。

### CHORD payload

```text
24   1   root_pitch_class: u8
25   1   bass_pitch_class: u8
26   2   pitch_class_mask: u16

28   4   chord_kind_id: u32

32   4   name_blob_offset: u32
36   4   name_blob_len: u32

40   4   detail_blob_offset: u32
44   4   detail_blob_len: u32

48  16   reserved
```

ABI 1.0:

```text
root_pitch_class:
    0..11

bass_pitch_class:
    0..11

pitch_class_mask:
    bits 0..11 = C..B
    bits 12..15 = 0
    root bit must be set

chord_kind_id:
    0
```

`name`:

```text
UTF-8 NFC display/source chord symbol
name_blob_len = 0 when unavailable
```

Structural detail is Deterministic CBOR:

```text
ChordRealtimeDetailV1 {
    format: UInt32 = 1
    tones: List<ChordToneV1>
}
```

The `ChordToneV1` schema and canonical ordering are §13。

validation:

```text
detail_blob_len > 0:
    decoded tones derive exactly:
        root_pitch_class
        pitch_class_mask

detail_blob_len = 0:
    chord has pitch-set-only realtime semantics
    structural degree helpers are unavailable to receiver
```

For a CHORD event lowered from canonical soraoto `ChordEvent`, Host must emit `ChordRealtimeDetailV1`。
An External Adapter that knows only root/mask may emit detail with `degree=null` tones or omit detail。

`detail_blob_offset/detail_blob_len` and name offsets use the same input/output blob base as other event blob references。

### SCALE payload

```text
24   1   root_pitch_class: u8
25   1   reserved0
26   2   pitch_class_mask: u16
28   4   scale_kind_id: u32
32   4   name_blob_offset: u32
36   4   name_blob_len: u32
40  24   reserved
```

ABI 1.0:

```text
root_pitch_class:
    0..11

pitch_class_mask:
    bits 0..11 = C..B
    bits 12..15 = 0
    root bit must be set

scale_kind_id:
    0
```

`root_pitch_class + pitch_class_mask` が canonical scale meaning。
name は UTF-8 NFC display metadata。
non-zero scale_kind_id は ABI 1.0 invalid/reserved。

### SYSEX payload

```text
24   4   blob_offset: u32
28   4   blob_len: u32
32  32   reserved
```

任意長 MIDI 1 SysEx。

### DATA payload

```text
24   4   data_type_id: u32
28   4   blob_offset: u32
32   4   blob_len: u32
36  28   reserved
```

Host/Plugin negotiated custom binary event。

`data_type_id` も selected custom dialect 内の Plugin-defined UInt32。
`CUSTOM` は semantic event record、`DATA` は opaque binary recordとして使い分ける。

input blob offset は `input_blob_ptr` 基準。
output blob offset は `output_blob_ptr` 基準。

## 29.7 Event ordering

Host input events are sorted by:

```text
1. sample_offset
2. note-lifecycle dependency
3. canonical kind priority
4. source edge/source order
5. event_id
```

### Note-lifecycle dependency

For the same `(bus_id, event_id, sample_offset)`:

```text
if note is inactive entering the sample and NOTE_ON exists:
    NOTE_ON
    -> VOCAL_LYRIC
    -> VOCAL_PHONEME
    -> NOTE_EXPRESSION / INT / TEXT
    -> NOTE_OFF if a zero-sample note termination is explicitly present

if note is active entering the sample:
    VOCAL_PHONEME
    -> NOTE_EXPRESSION / INT / TEXT
    -> NOTE_OFF
```

Therefore:

```text
Note Expression at the same sample as NOTE_ON:
    after NOTE_ON

Note Expression at the same sample as NOTE_OFF:
    before NOTE_OFF
```

A note ID that is active entering a sample may not be reused by another NOTE_ON at that same sample。
The new note must use a different `event_id`。

After NOTE_OFF is processed:

```text
event_id becomes inactive immediately
```

and later events at the same sample with that ID are invalid。

### Canonical kind priority

For events not ordered by the note-lifecycle dependency above:

```text
PROGRAM_CHANGE
CHORD
SCALE
NOTE_OFF
NOTE_ON
VOCAL_LYRIC
VOCAL_PHONEME
NOTE_EXPRESSION / NOTE_EXPRESSION_INT / NOTE_EXPRESSION_TEXT
CONTROLLER
MIDI1 / MIDI2_UMP / SYSEX
DATA / CUSTOM
PARAM_GESTURE_BEGIN
PARAM_GESTURE_END
```

`PARAM_GESTURE_BEGIN/END` additionally obey §29.3/§29.6 gesture ordering relative to parameter points。

`num_frames > 0`:

```text
0 <= sample_offset < num_frames
```

`num_frames == 0`:

```text
sample_offset = 0
```

Project IR 128-bit `EventId` -> realtime 64-bit `event_id` conversion is Host session-local table mapping。

Simple hash truncation is forbidden。

The Host must not assign the same 64-bit ID to two simultaneously active notes on one EventBus。

`event_id = 0`:

```text
non-note event:
    allowed = anonymous

NOTE_ON / NOTE_OFF /
VOCAL_LYRIC /
VOCAL_PHONEME /
NOTE_EXPRESSION /
NOTE_EXPRESSION_INT /
NOTE_EXPRESSION_TEXT:
    forbidden
```

## 29.8 SoraotoProcessContextV1 — 192 bytes

```text
0     4   size: u32 = 192
4     4   valid_flags: u32
8     8   state_flags: u64

16    8   project_sample: i64
24    8   continuous_sample: i64

32    8   beat_position: f64
40    8   bar_start_beat: f64
48    8   tempo_bpm: f64

56    8   cycle_start_beat: f64
64    8   cycle_end_beat: f64

72    4   time_sig_num: u32
76    4   time_sig_den: u32

80    8   system_time_ns: i64

88    4   smpte_offset_subframes: i32
92    4   frame_rate_num: u32
96    4   frame_rate_den: u32
100   4   frame_rate_flags: u32

104   4   samples_to_next_clock: i32
108   4   input_presentation_latency_samples: u32
112   4   output_presentation_latency_samples: u32
116   4   transport_epoch: u32

120   1   chord_key_pitch_class: u8
121   1   chord_bass_pitch_class: u8
122   2   chord_interval_mask: u16

124   1   scale_root_pitch_class: u8
125   1   reserved0: u8
126   2   scale_pitch_class_mask: u16

128   8   channel_context_revision: u64
136  56   reserved
```

beat unit:

```text
quarter note = 1.0
```

timeline/sample semantics:

```text
project_sample:
    signed sample index corresponding to ProcessBlock sample_offset 0
    relative to project bar-1 origin
    may be negative during pickup
    always valid

continuous_sample:
    Host processing-clock sample index
    monotonic across project locate / loop wrap
    increments by num_frames after every successful non-zero process block
    zero-frame flush does not increment it

beat_position:
    project MusicalTime at sample_offset 0
    converted to Float64 quarter-note beats

bar_start_beat:
    MusicalTime of the active meter-bar start
    converted to Float64 quarter-note beats
```

`CONTINUOUS_SAMPLE_VALID=1` の場合、Host は上記 continuous counter semantics を満たす。
continuous counter は新しい Plugin instance の `init/configure` 前後で初期化できるが、active instance の transport locate ではresetしない。

`system_time_ns` は sample offset 0 に対応する Host monotonic clock timestamp。
`system_time_ns()` Host import と同一 clock domain。

SMPTE:

```text
smpte_offset_subframes:
    1 frame = 80 subframes

frame_rate_flags bit0:
    drop_frame
```

MIDI clock:

```text
samples_to_next_clock
    24 clocks / quarter note
    negative value allowed when nearest clock is behind block start
```

Chord:

```text
chord_key_pitch_class:
    harmonic root/key note, C=0..B=11

chord_bass_pitch_class:
    lowest chord pitch class

chord_interval_mask:
    bit0  = minor 2nd above root
    bit1  = major 2nd
    ...
    bit10 = major 7th
    bit11 = reserved, must be 0
```

root 自身は mask に含めない。

Scale mask:

```text
bit0..11 = C..B
```

valid_flags:

```text
bit 0   CONTINUOUS_SAMPLE_VALID
bit 1   MUSICAL_POSITION_VALID
bit 2   BAR_POSITION_VALID
bit 3   TEMPO_VALID
bit 4   TIME_SIGNATURE_VALID
bit 5   CYCLE_VALID
bit 6   SYSTEM_TIME_VALID
bit 7   SMPTE_VALID
bit 8   CLOCK_VALID
bit 9   CHORD_VALID
bit 10  SCALE_VALID
bit 11  PRESENTATION_LATENCY_VALID
bit 12  CHANNEL_CONTEXT_VALID
```

state_flags:

```text
bit 0   PLAYING
bit 1   RECORDING
bit 2   LOOPING
bit 3   OFFLINE
bit 4   TRANSPORT_DISCONTINUITY
bit 5   AUTOMATION_READ
bit 6   AUTOMATION_WRITE
bit 7   PREFETCH
```

Host は Plugin `process_context_requirements` に含まれない optional field の valid bit を 0 にしてよい。

`transport_epoch`:

```text
initial value = 0

increment modulo 2^32 on:
    explicit project locate
    loop wrap
    transport discontinuity that changes project timeline continuity
```

Transport start/stop without a timeline discontinuity does not increment it。

`channel_context_revision`:

```text
initial value = 0

increment modulo 2^64 whenever any field of:
    PluginConfigV1.channel_context

changes semantically
```

If `CHANNEL_CONTEXT_VALID=0`:

```text
channel_context_revision = 0
```

Plugin は full channel context を `PluginConfigV1.channel_context` から取得し、
ProcessContext では revision だけを比較する。
revision wrap is legal; a changed revision is a cache invalidation hint, not a globally unique identity。

strict deterministic offline render:

```text
SYSTEM_TIME_VALID = 0
```


## 29.9 SoraotoAssetRequestV1 — 32 bytes

```text
0    8   request_id: u64
8    4   asset_handle: u32
12   4   destination_ptr: u32
16   8   file_offset: u64
24   4   length: u32
28   4   flags: u32
```

## 29.10 SoraotoAssetCompletionV1 — 16 bytes

```text
0   8   request_id: u64
8   4   bytes_written: u32
12  4   status: i32
```

Async asset flow:

```text
process N:
    Plugin emits AssetRequest

after process N:
    Host queues background I/O

between later process calls:
    completed bytes are copied into destination_ptr

next suitable process:
    Host supplies AssetCompletion
```

Host は `soraoto_plugin_process` 実行中に Plugin memory を書き換えない。

Plugin は completion を受けるまで destination range を読まない。

さらに pending request 中:

```text
Plugin:
    destination range へ書き込まない
    asset handle を close しない

Host:
    soraoto_plugin_process 実行中は destination range へ書き込まない
    process call 間だけ copy
```

`asset_handle` は `asset_open` が返した live handle でなければならない。
`file_offset + length` が asset size を超える場合 Host は available bytes だけ copy し、completion `bytes_written < length` とする。
完全にEOF以降なら `bytes_written=0, status=SORAOTO_OK`。

## 29.11 SoraotoHostRequestV1 — 32 bytes

```text
0    4   kind: u32
4    4   flags: u32
8    8   arg0: i64
16   8   arg1: i64
24   8   arg2: i64
```

kind:

```text
1   RESCAN_DESCRIPTOR
2   LATENCY_CHANGED
3   TAIL_CHANGED
4   STATE_DIRTY

10  TRANSPORT_START
11  TRANSPORT_STOP
12  TRANSPORT_LOCATE_SAMPLE
13  TRANSPORT_LOCATE_BEAT
14  TRANSPORT_SET_LOOP

20  REQUEST_BUS_ACTIVATE
21  REQUEST_BUS_DEACTIVATE
22  PREFETCH_SUPPORT_CHANGED
23  CONTROLLER_MAPPING_CHANGED
24  UNIT_BUS_ASSIGNMENT_CHANGED
25  PARAMETER_MAPPING_CHANGED
26  NOTE_EXPRESSION_INFO_CHANGED
27  KEYSWITCH_INFO_CHANGED
28  PROGRAM_LIST_CHANGED
29  UNIT_SELECTION_CHANGED

30  PARAMETER_VALUES_CHANGED
31  PARAMETER_INFO_CHANGED
32  BUS_INFO_CHANGED
33  ROUTING_INFO_CHANGED
34  RELOAD_INSTANCE
```

argument semantics:

```text
RESCAN_DESCRIPTOR:
LATENCY_CHANGED:
TAIL_CHANGED:
PREFETCH_SUPPORT_CHANGED:
CONTROLLER_MAPPING_CHANGED:
UNIT_BUS_ASSIGNMENT_CHANGED:
PARAMETER_MAPPING_CHANGED:
NOTE_EXPRESSION_INFO_CHANGED:
KEYSWITCH_INFO_CHANGED:
PARAMETER_VALUES_CHANGED:
PARAMETER_INFO_CHANGED:
BUS_INFO_CHANGED:
ROUTING_INFO_CHANGED:
RELOAD_INSTANCE:
    arg0..2 = 0

STATE_DIRTY:
    arg0 = 1 dirty / 0 clean
    arg1..2 = 0

TRANSPORT_START:
    arg0..2 = 0

TRANSPORT_STOP:
    arg0..2 = 0

TRANSPORT_LOCATE_SAMPLE:
    arg0 = target sample position

TRANSPORT_LOCATE_BEAT:
    arg0 = IEEE-754 f64 beat bits reinterpreted as i64

TRANSPORT_SET_LOOP:
    arg0 = f64 loop-start beat bits
    arg1 = f64 loop-end beat bits
    arg2 = 1 enable / 0 disable

REQUEST_BUS_ACTIVATE:
    arg0 = shared bus-id namespace id
    arg1..2 = 0

REQUEST_BUS_DEACTIVATE:
    arg0 = shared bus-id namespace id
    arg1..2 = 0

PROGRAM_LIST_CHANGED:
    arg0 = program_list_id
    arg1 = program_id, or -1 for all programs
    arg2 = 0

UNIT_SELECTION_CHANGED:
    arg0 = unit_id
    arg1..2 = 0
```

Host は process return 後に request を処理する。

### HostRequest safe-point rule

`SoraotoHostRequestV1` is emitted from `soraoto_plugin_process`, but many reactions require `soraoto_plugin_control` queries。

Because `soraoto_plugin_control` is forbidden while lifecycle state is `Processing`, Host classifies requests:

```text
host-only:
    STATE_DIRTY
    UNIT_SELECTION_CHANGED
    TRANSPORT_START
    TRANSPORT_STOP
    TRANSPORT_LOCATE_SAMPLE
    TRANSPORT_LOCATE_BEAT
    TRANSPORT_SET_LOOP

realtime-safe-query:
    LATENCY_CHANGED
    TAIL_CHANGED

control-refresh:
    RESCAN_DESCRIPTOR
    PREFETCH_SUPPORT_CHANGED
    CONTROLLER_MAPPING_CHANGED
    UNIT_BUS_ASSIGNMENT_CHANGED
    PARAMETER_MAPPING_CHANGED
    NOTE_EXPRESSION_INFO_CHANGED
    KEYSWITCH_INFO_CHANGED
    PROGRAM_LIST_CHANGED
    PARAMETER_VALUES_CHANGED
    PARAMETER_INFO_CHANGED
    BUS_INFO_CHANGED
    ROUTING_INFO_CHANGED
    RELOAD_INSTANCE

graph-reconfiguration:
    REQUEST_BUS_ACTIVATE
    REQUEST_BUS_DEACTIVATE
```

For `control-refresh` received while Processing:

```text
1. finish current process call
2. reach Host graph safe point
3. soraoto_plugin_stop_processing
       Processing -> Active
4. perform required soraoto_plugin_control queries/mutations
5. if configuration/layout must change:
       deactivate -> CONFIGURE -> activate
6. soraoto_plugin_start_processing
       Active -> Processing
7. resume graph
```

No pending input event/parameter at the safe-point sample may be dropped。
Host may split the surrounding graph process block so the lifecycle transition occurs between sample ranges。

For `realtime-safe-query`, latency/tail export may be queried between process calls without stopping, but any resulting graph/PDC mutation is still committed at a Host safe point。

For `host-only`, no Plugin control-plane call is required。

notification reaction:

```text
RESCAN_DESCRIPTOR:
    GET_DESCRIPTOR
    compare descriptor with active config
    perform only the required cache refresh / safe-point reconfiguration

LATENCY_CHANGED:
    query soraoto_plugin_latency_samples()
    rebuild Plugin Delay Compensation at safe point

TAIL_CHANGED:
    query soraoto_plugin_tail_samples()

STATE_DIRTY:
    arg0=1:
        mark project/plugin state dirty
        schedule a new state snapshot outside the current process call

    arg0=0:
        clear Plugin-reported dirty flag after the Host has persisted the current state
        or when the Plugin explicitly reports that its non-parameter state matches the last persisted snapshot

PREFETCH_SUPPORT_CHANGED:
    GET_DESCRIPTOR
    update prefetch capability
    reconfigure process_mode only if current mode is no longer valid

CONTROLLER_MAPPING_CHANGED:
    GET_CONTROLLER_MAPPINGS
    GET_DESCRIPTOR
    refresh controller mappings and program-selector Unit/step metadata

UNIT_BUS_ASSIGNMENT_CHANGED:
    GET_UNIT_BUS_ASSIGNMENTS

PARAMETER_MAPPING_CHANGED:
    GET_DESCRIPTOR
    refresh parameter_aliases / remap automation references

NOTE_EXPRESSION_INFO_CHANGED:
    GET_DESCRIPTOR
    GET_PHYSICAL_UI_MAPPINGS
    refresh note-expression caches

KEYSWITCH_INFO_CHANGED:
    GET_DESCRIPTOR
    refresh key-switch/articulation caches

PROGRAM_LIST_CHANGED:
    GET_DESCRIPTOR
    refresh ProgramListDescriptor / ProgramInfoV1

    if arg1 == -1:
        treat list membership/count/order as potentially changed

    if arg1 >= 0:
        at minimum refresh that ProgramInfoV1
        descriptor may still return unchanged list shape

    refresh associated program_selector ParameterDescriptor
    validate selected program index/value

UNIT_SELECTION_CHANGED:
    update selected generic-host unit to arg0
    no Plugin control query required unless Host UI needs freshly rescanned Unit metadata

PARAMETER_VALUES_CHANGED:
    GET_PARAMETER_SNAPSHOT

PARAMETER_INFO_CHANGED:
    GET_DESCRIPTOR
    invalidate parameter / remote representation caches

BUS_INFO_CHANGED:
    GET_DESCRIPTOR

    if bus count/layout/default-active/required-state changed:
        deactivate -> graph renegotiation -> CONFIGURE -> activate
        (stop/start already handled by HostRequest safe-point rule)

    name/metadata-only change:
        cache refresh only

ROUTING_INFO_CHANGED:
    GET_DESCRIPTOR
    refresh routing_hints

RELOAD_INSTANCE:
    current instance is first brought to Active by the HostRequest safe-point rule

    1. capture last valid state snapshot
    2. create fresh module instance
    3. init/configure
    4. load snapshot with StateLoadContextV1(source=project)
    5. refresh descriptor/parameters/unit assignments/latency/tail
    6. atomically swap at graph safe point
    7. destroy old instance after swap
```

`RELOAD_INSTANCE` failure leaves the old instance active if it is still valid。
old instance が既に Faulted の場合は§31 fault fallbackを維持する。

transport request は Project/Host の `allow_plugin_transport_control` が false の場合拒否。
true の場合も project bounds / loop validity を満たす必要がある。

Plugin にとって次 block の ProcessContext が authoritative transport state。


## 29.12 SoraotoProcessBlockV1 — 176 bytes

```text
0    4   size: u32 = 176
4    4   abi_version: u32

8    4   num_frames: u32
12   4   flags: u32

16   4   audio_inputs_ptr: u32
20   4   audio_inputs_count: u32

24   4   audio_outputs_ptr: u32
28   4   audio_outputs_count: u32

32   4   input_events_ptr: u32
36   4   input_events_count: u32

40   4   output_events_ptr: u32
44   4   output_events_capacity: u32
48   4   output_events_count: u32
52   4   reserved0

56   4   input_params_ptr: u32
60   4   input_params_count: u32

64   4   output_params_ptr: u32
68   4   output_params_capacity: u32
72   4   output_params_count: u32
76   4   reserved1

80   4   modulations_ptr: u32
84   4   modulations_count: u32

88   4   context_ptr: u32
92   4   reserved2

96   4   input_blob_ptr: u32
100  4   input_blob_size: u32

104  4   output_blob_ptr: u32
108  4   output_blob_capacity: u32
112  4   output_blob_size: u32
116  4   reserved3

120  4   asset_requests_ptr: u32
124  4   asset_requests_capacity: u32
128  4   asset_requests_count: u32

132  4   asset_completions_ptr: u32
136  4   asset_completions_count: u32

140  4   host_requests_ptr: u32
144  4   host_requests_capacity: u32
148  4   host_requests_count: u32

152  4   process_status_flags: u32
156  4   reserved4

160  4   data_exchange_packets_ptr: u32
164  4   data_exchange_packets_capacity: u32
168  4   data_exchange_packets_count: u32
172  4   reserved5
```

`abi_version`:

```text
0x0001_0000
```

Host は process 前に:

```text
output_events_count
output_params_count
output_blob_size
asset_requests_count
host_requests_count
data_exchange_packets_count
process_status_flags
```

を 0 にする。

Plugin は capacity を超えて書いてはならない。

Conforming Host は configure 時に descriptor の:

```text
max_event_output_per_block
max_host_requests_per_block
max_asset_requests_per_block
max_data_exchange_packets_per_block
```

以上の output capacity を確保する。

input capacity を超える authored data は Host が事前に block を sub-block 化する。

capacity 超過がなお必要な場合 `SORAOTO_E_BUFFER_TOO_SMALL`。

Host は block を小さくして再実行する。

Plugin は error を返す process call の:

```text
output buffers
output events/params
DSP internal time/voice/envelope state
asset request state
```

を commit/advance してはならない。

`SORAOTO_E_BUFFER_TOO_SMALL` 後の同一 input/sub-block retry は、失敗 call が存在しなかった場合と同じ結果を返す。


## 29.13 Realtime Data Exchange

Plugin descriptor:

```text
DataExchangeQueueDescriptorV1 {
    id: UInt32
    name: String

    block_size_max: UInt32
    block_count_min: UInt32
    block_count_preferred: UInt32

    delivery:
        background
        main

    presentation_sync:
        none
        output

    overflow:
        drop_newest
        drop_oldest
        lossless_offline
}
```

`id` は Plugin 内で unique、range `1..0xffff_fffe`。

`main` は Host の serialized non-realtime control thread を意味し、GUI thread を要求しない。

`SoraotoDataExchangePacketV1.flags` は ABI 1.0 では `0`。非0は reserved。

### 29.13.1 SoraotoDataExchangePacketV1 — 32 bytes

```text
0    4   queue_id: u32
4    4   flags: u32
8    4   sample_offset: u32
12   4   blob_offset: u32
16   4   blob_len: u32
20   4   reserved: u32
24   8   sequence: u64
```

payload は `output_blob_ptr` に置く。

packet rules:

```text
blob_offset + blob_len <= ProcessBlock.output_blob_size

sequence:
    starts at 0 for each queue activation
    increments by exactly 1 per emitted packet
    wraps modulo UInt64 only after 2^64 packets
```

Host は sequence gap から overflow/drop を検知できる。

lifetime:

```text
Plugin:
    current soraoto_plugin_process call only

Host:
    process return直後に Host-owned queue blockへcopy

non-realtime consumer:
    Host-owned copyを受信
```

Plugin memory の pointer を process return 後に保持してはならない。

presentation timestamp:

```text
project_sample
+ sample_offset
+ output_presentation_latency_samples
```

`presentation_sync: output` では Host がこの timestamp に合わせて delivery/display を遅延できる。

overflow:

```text
drop_newest
    新packetを破棄

drop_oldest
    最古queued packetを破棄して新packetを保持

lossless_offline
    realtimeではdrop_newest
    offlineではHostがqueue drain/sub-block化してlosslessを保証
```

Audio Thread は queue の空きを待たない。

Host queue overflow は Host が queue ごとの:

```text
dropped_packets: UInt64
```

counter に記録し、non-realtime diagnostics から取得可能にする。

Plugin は Host queue overflow を Audio Thread 内で待機・再送しない。

`block_count_min` を Host が確保できない場合 CONFIGURE は `SORAOTO_E_UNSUPPORTED`。

`block_count_preferred` は:

```text
block_count_preferred >= block_count_min >= 1
```

`block_size_max >= 1`。

Data Exchange は FFT / waveform / analyzer metadata / large processor telemetry 用。
小さい scalar は output parameter を使用する。

---

---

---

---

# 30. State / Preset / Program

## 30.1 Persistent state

Plugin state は次をすべて含む。

```text
persistent parameter values
bypass state
hidden plugin configuration
program selection
plugin-specific persistent data
asset references
```

含めない:

```text
decoded sample data
cache
delay buffer
reverb tail buffer
FFT scratch
other reconstructible bulk data
```

bulk content は AssetRef にする。

## 30.2 StateDescriptor

```text
StateDescriptor {
    schema_id: String
    schema_version: UInt32
    max_snapshot_bytes: UInt32
}
```

ABI 1.0 wire limit:

```text
1 <= max_snapshot_bytes <= 2,147,483,647
```

Conforming Host minimum:

```text
at least 16 MiB per Plugin instance
```

Host の実 resource limit が Plugin descriptor の `max_snapshot_bytes` 未満なら instance load を拒否しなければならず、state を truncate してはならない。

bulk audio/sample content は state に埋め込まず AssetRef を使用することを強く要求する。

## 30.3 Snapshot while playing

`soraoto_plugin_state_snapshot` は:

```text
realtime-safe
allocation-free
lock-free
memory.grow禁止
```

Host は同一 instance の process call と process call の間に同じ Audio Worker thread から呼べる。

`StateDescriptor.max_snapshot_bytes` は query が返しうる最大値。
Plugin は runtime state によりこの値を超える snapshot を要求してはならない。

query:

```text
dst_ptr = 0
capacity = 0
```

return:

```text
0..2,147,483,647 = required bytes
<0               = status error
```

write:

```text
dst_ptr != 0
0 <= written <= capacity
```

buffer 不足:

```text
SORAOTO_E_BUFFER_TOO_SMALL
```

buffer 不足時は partial state を書いてはならない。

Host は Processing 開始前に `StateDescriptor.max_snapshot_bytes` の buffer を preallocate しておけば playback 中にも snapshot できる。

これにより playback を停止せず Project Save が可能。

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

    state_type:
        project
        default_preset
        normal_preset
        null

    source_file_name: String?
}
```

`source_file_name` is a portable display/base-name hint only。
A Host-local full path/URI belongs to `StateLoadContextV1.source_locator`。

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
StateType         -> state_type
FileName          -> source_file_name
```

A host-local absolute file path is **not** persistent soraoto preset identity and is not written into portable `SoraotoPresetV1`。
If a native preset bridge exposes such a path, it remains Host-local metadata only。

## 30.5 StateLoadContextV1

`soraoto_plugin_state_load` の `context_ptr/context_len` は Deterministic CBOR:

```text
StateLoadContextV1 {
    state_schema_id: String
    state_schema_version: UInt32

    source:
        project
        user_preset
        factory_preset
        program
        migration

    source_plugin_id: String
    source_plugin_version: SemVer?

    preset_meta: PresetMetaV1?

    source_locator: StateSourceLocatorV1?
}

StateSourceLocatorV1 {
    uri: String

    display_name: String?

    asset: AssetRef?
}
```

Plugin は `state_schema_version` と source Plugin version を使って migration する。

`source_plugin_version = null`:

```text
source version unavailable/legacy
```

`source_locator` is **load-session context**, not portable Plugin state。

URI examples:

```text
file:///host/local/path/Preset.vstpreset
asset://<sha256>
soraotopreset://<host-library-id>
```

Rules:

```text
uri:
    UTF-8 NFC
    syntactically valid absolute URI

file: URI:
    may reveal Host-local location only when Host privacy/security policy permits

asset:
    when present, exact bytes resolve through Host asset services
```

Plugin cannot directly open a `file:` URI through arbitrary filesystem access。
It may:

```text
use it for diagnostics/display
request a Host-authorized asset/resource
resolve explicitly authorized neighboring resources through Host services
```

Portable `.soraotopreset` serialization does **not** persist `source_locator`。

VST bridge:

```text
IStreamAttributes preset full file path
    ->
StateLoadContextV1.source_locator.uri
```

This preserves the non-GUI state-load context without making Host filesystem layout part of soraoto preset identity。

`context_len = 0` は `SORAOTO_E_INVALID_ARGUMENT`。

## 30.6 State load

`soraoto_plugin_state_load` は Processing 中に呼ばない。

Host は transactional restore のため、新しい inactive Plugin instance に state を load して成功後 swap する。

State load に失敗した instance を live graph へ commit しない。

State load 成功後 Host は必ず:

```text
GET_DESCRIPTOR
GET_PARAMETER_SNAPSHOT
GET_UNIT_BUS_ASSIGNMENTS
soraoto_plugin_latency_samples
soraoto_plugin_tail_samples
```

を再取得して graph/state を同期する。

Plugin は過去 `schema_version` を migration できる。

migration 不可能:

```text
SORAOTO_E_STATE_INCOMPATIBLE
```

## 30.7 Project save order

```text
1. obtain Plugin state snapshot
2. store opaque state bytes
3. store descriptor identity
4. store current Host parameter snapshot
5. store asset dependencies
```

Project load:

```text
1. instantiate Plugin
2. CONFIGURE
3. soraoto_plugin_state_load(..., StateLoadContextV1)
4. GET_DESCRIPTOR
5. GET_PARAMETER_SNAPSHOT
6. GET_UNIT_BUS_ASSIGNMENTS
7. query latency / tail
8. re-CONFIGURE if descriptor/layout/context requirements changed
9. apply explicit static DSL parameter overrides with SET_PARAMETER_VALUES
10. refresh descriptor/parameter/unit assignment/latency/tail if SET changed them
11. attach automation
12. attach modulation
13. activate/start
14. zero-frame numeric parameter flush
```

State 内 parameter と DSL explicit override が競合する場合:

```text
DSL explicit override wins
```

Automation は playback time 上でその後に上書きする。

## 30.8 User preset format

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

    state_schema_id: String
    state_schema_version: UInt32

    meta: PresetMetaV1

    state: Bytes

    parameter_snapshot: List<ParameterSnapshotEntryV1>

    assets: List<AssetRef>
}
```

Preset load order は Project state load と同じ。

## 30.9 Factory preset

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

Factory preset load は persistent working state を変更する。

## 30.10 Program lists

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

    supports_program_data: Bool
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

Program data / Unit data は persistent preset payload だが、Project全体の Plugin state とは別の可搬単位。

```text
GET/SET_PROGRAM_DATA:
    one program only

GET/SET_UNIT_DATA:
    one logical unit only

soraoto_plugin_state_snapshot/load:
    whole Plugin instance
```

Program/Unit data payload の内部形式は Plugin opaque bytes。
Host は byte-identical storage/transport のみを保証する。

サポートしない Plugin は program selection parameter を `step` parameter として持ち、Host は block boundary で変更する。

## 30.11 Pitch names

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
2. load last valid state snapshot
3. configure
4. activate/start
5. swap at block boundary
```

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
state migration
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
| Per-program binary data | GET/SET_PROGRAM_DATA |
| Per-unit preset data | GET/SET_UNIT_DATA |
| Unit selection / change notification | GET/SELECT_UNIT + HostRequest |
| Plug-in replacement compatibility | compatible_plugin_ids + StateLoadContext |
| Module info / multi-plug-in distribution | `.soraotobundle` + PluginBundleV1 |
| Plug-in class cardinality | PluginDescriptor.max_instances + bundle discovery metadata |
| Presets / state | state snapshot + `.soraotopreset` |
| Dirty-state notification / clear | STATE_DIRTY(arg0=1/0) via HostRequest / host_request |
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
| Preset meta-information | PresetMetaV1 + StateLoadContextV1 |
| Preset load source/path context | StateLoadContextV1.source_locator |
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
UnitDescriptor / ProgramListDescriptor /
GET/SET_PROGRAM_DATA / GET/SET_UNIT_DATA

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
one persistent state model
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

These exclusions must not remove audio/event/state/automation/controller functionality。

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

---

# 35. Instrument Performance Layer

Performance IR is Plugin-independent; canonical schemas are §63。

The source language does **not** define a separate parser grammar per instrument。
All pitched instruments share Core Note syntax and use:

```text
performance <family> {
    ... family configuration ...
}

notes {
    pitch {
        ... common/family attributes ...
    }

    control <semantic.path>: value
}
```

`performance <family> {}` is a specialized `named_block_statement` in Track scope。

Supported standard families:

```text
note
guitar
bass
bowed_string
harp
accordion
organ
pedal_steel
wind
piano
vocal
```

`note` is default when no family is declared。

Exactly one standard Performance family may be active per Track source stream。
A Track can still contain multiple independent `voice` blocks under that family。

## 35.1 Family configuration

```text
PerformanceConfigV1 {
    family: String
    options: Value.Record
}
```

`options` is type-checked by the selected family schema。
Unknown option is compile error。

A versioned external Instrument Performance Compiler may introduce a custom family:

```text
vendor:<reverse-dns-id>:<name>
```

but it must publish a typed source-option/attribute schema before compilation。
No arbitrary untyped passthrough is allowed。

## 35.2 Note lowering

For each Core sounding note:

```text
1. resolve authored Pitch
2. resolve common attributes (§11)
3. resolve active family attributes
4. apply current family control state
5. validate physical constraints
6. emit exactly one or more canonical §63 Performance events
7. preserve provenance
```

A family Compiler may expand one authored event to multiple physical events only when the family contract explicitly defines the expansion。

The generated EventId for each emitted event uses §19 deterministic derivation with stable emission ordinal。

## 35.3 Timeline `control`

Syntax:

```text
control piano.sustain: 1.0
control organ.expression: 0.75
control accordion.bellows_pressure: 0.6
```

`control` occurs at the current note cursor and **does not advance time**。

It emits §63 `ControlPerformance` and updates the deterministic current control state for subsequent notes in the same `voice`/performance scope。

Scope/state rules:

```text
each voice:
    independent control cursor/state by default

track-level control outside voice:
    applies to all voices from that timeline position

same-time controls:
    source order
```

A family contract states whether a control is:

```text
voice-local
track-global
```

Conflicting same-time assignments to one track-global control from separate voices are compile error。

## 35.4 `control` grammar

Inside `note_body`:

```ebnf
performance_control =
    "control" qualified_name ":" expr ;
```

It is a note item and consumes zero duration。

## 35.5 Common control/value rules

Control target is a stable semantic path, not a Plugin Parameter ID。

Standard paths use:

```text
<family>.<name>
```

Vendor path:

```text
vendor.<reverse-dns-id>.<name>
```

Control value must be finite and match the family-declared type。

## 35.6 Default Note family

`performance note {}` / omitted Performance family lowers Core notes to §63 `NotePerformance`。

Common mappings:

```text
pitch       -> NotePerformance.pitch
pressure    -> pressure
timbre      -> timbre
pan         -> pan
pitch_curve -> pitch_curve
```

Header values come from Core note time/voice/articulation/velocity/expression/provenance。

---

---

---

---

# 36. Guitar

Configuration:

```text
performance guitar {
    tuning: [e4, b3, g3, d3, a2, e2]
    frets: 24
}
```

Schema:

```text
GuitarPerformanceConfigV1 {
    tuning: List<Pitch> =
        [e4, b3, g3, d3, a2, e2]

    frets: UInt16 = 24
}
```

String numbering:

```text
1 = highest-pitched string
N = lowest-pitched string
```

Therefore standard six-string tuning above maps:

```text
string 1 -> e4
string 2 -> b3
string 3 -> g3
string 4 -> d3
string 5 -> a2
string 6 -> e2
```

`frets >= 1`。
`tuning` non-empty and strictly descending in string-number order after the above mapping。

Explicit physical note:

```text
e4 {
    string: 1
    fret: 0
    technique: normal
}
```

Family attributes:

```text
string: UInt8?
fret: UInt16?

technique:
    normal
    hammer
    pull
    slide
    bend
    vibrato
    mute
    palm_mute
    harmonic
    dead_note

bend_curve: NoteCurve<Semitone>?
```

Physical consistency when both string/fret are explicit:

```text
expected_pitch =
    tuning[string] + fret

abs(expected_pitch - authored_pitch) <= 0.01 semitone
```

otherwise compile error。

When string/fret omitted, Compiler selects a feasible `(string,fret)` pair。

Selection cost, ascending priority:

```text
1. minimum absolute fret movement from previous note in same voice
2. minimum fret number
3. lowest string number
```

For a chord/same-onset group, evaluate all feasible non-duplicate-string assignments and choose lexicographically by:

```text
1. minimum fret-span (max fret - min fret)
2. minimum sum absolute movement from previous assignment
3. minimum sum fret
4. lexicographic string-number vector
5. lexicographic fret vector
```

No feasible fingering -> compile error。

### Guitar Harmony macros

```text
Harmony
|> GuitarVoicing(...)
|> GuitarStrum(...)
```

normative Standard Macro contracts are §19.7。

---

---

---

---

# 37. Bass Guitar

```text
performance bass {
    tuning: [g2, d2, a1, e1]
    frets: 24
}
```

Schema:

```text
BassPerformanceConfigV1 {
    tuning: List<Pitch> =
        [g2, d2, a1, e1]

    frets: UInt16 = 24

    default_technique:
        finger
        pick
        slap
        pop
        = finger
}
```

String numbering and physical pitch consistency are identical to Guitar。

Family attributes:

```text
string: UInt8?
fret: UInt16?

technique:
    finger
    pick
    slap
    pop
    mute
    harmonic
    slide

pitch_curve: NoteCurve<Semitone>?
```

Missing string/fret uses the same deterministic single-note selection rule as Guitar。

Standard Harmony Bass macros are §19.7。

---

---

---

---

# 38. Bowed Strings

```text
performance bowed_string {
    tuning: [e5, a4, d4, g3]
}
```

Schema:

```text
BowedStringPerformanceConfigV1 {
    tuning: List<Pitch>
    max_position: UInt8 = 12
}
```

String numbering:

```text
1 = highest string
```

Family attributes:

```text
string: UInt8?
position: UInt8?
finger: UInt8?

bow_direction:
    up
    down
    none

bow_pressure: Norm?
bow_speed: Norm?
vibrato: Norm?

pitch_curve: NoteCurve<Semitone>?
```

finger when present:

```text
0..4
```

position:

```text
1..max_position
```

If explicit `string/position/finger` cannot produce the authored Pitch under the selected instrument model:

```text
compile error
```

When physical fingering is omitted, deterministic selection priority:

```text
1. preserve previous string when feasible
2. minimum position movement
3. minimum position
4. lowest string number
5. lowest finger
```

Bow direction `none` means no explicit authored direction; Adapter/Plugin may choose its default articulation behavior。

Controls:

```text
control bowed_string.bow_pressure: Norm
control bowed_string.bow_speed: Norm
control bowed_string.vibrato: Norm
```

are voice-local and become defaults for subsequent notes unless overridden by note attributes。

---

---

---

---

# 39. Harp / Accordion / Organ / Pedal Steel / Wind / Piano / Vocal

## 39.1 Harp

```text
performance harp {
    range: c1..g7
}
```

Family attributes:

```text
string_index: UInt16?

pedals: List<HarpPedalStateV1>

technique:
    normal
    harmonic
    pres_de_la_table
    etouffe
    gliss
```

Track-global controls:

```text
control harp.pedal.C: flat | natural | sharp
...
control harp.pedal.B: flat | natural | sharp
```

A note impossible under the current explicit pedal state is compile error unless the note provides an explicit temporary pedal list。

## 39.2 Accordion

Family attributes:

```text
manual:
    right
    left_bass
    left_chord

bellows_direction:
    push
    pull
    unspecified

bellows_pressure: Norm?
```

Track-global controls:

```text
control accordion.bellows_direction: push|pull|unspecified
control accordion.bellows_pressure: Norm
```

## 39.3 Organ

Family attributes:

```text
manual: String
stops: List<String>
```

Track-global controls:

```text
control organ.expression: Norm
control organ.stop.<semantic-stop-id>: Bool
control organ.manual: String
```

Active stops are snapshotted into subsequent `OrganPerformance.stops` in canonical UTF-8 byte sort order。

## 39.4 Pedal Steel

Configuration publishes:

```text
tuning
named pedals
named knee levers
```

Family attributes:

```text
string: UInt8
fret: UInt16

active_pedals: List<String>
active_knee_levers: List<String>

pitch_curve: NoteCurve<Semitone>?
```

Controls:

```text
control pedal_steel.pedal.<id>: Bool
control pedal_steel.knee.<id>: Bool
```

are track-global。

Unknown pedal/lever ID is compile error。

## 39.5 Wind / Brass

Family attributes:

```text
breath: Norm?

tonguing:
    none
    soft
    normal
    hard
    double
    triple

growl: Norm?
flutter: Norm?

pitch_curve: NoteCurve<Semitone>?
```

Voice-local controls:

```text
control wind.breath: Norm
control wind.growl: Norm
control wind.flutter: Norm
```

## 39.6 Piano

Family attributes:

```text
finger: UInt8?          // 1..5

sustain: Norm?
sostenuto: Norm?
una_corda: Norm?
half_pedal: Norm?
```

Track-global controls:

```text
control piano.sustain: Norm
control piano.sostenuto: Norm
control piano.una_corda: Norm
control piano.half_pedal: Norm
```

Each subsequent `PianoPerformance` snapshots current pedal values so Performance IR remains self-contained。
For runtime targets that support continuous pedal events, `ControlPerformance` events are also preserved and lowered。

## 39.7 Vocal

Configuration:

```text
performance vocal {
    language: "ja-JP"
    phoneme_alphabet: "ipa"
}
```

```text
VocalPerformanceConfigV1 {
    language: String = "und"
    phoneme_alphabet: String? = null

    phoneme_generation:
        none
        text
        reading
        = none
}
```

Rules:

```text
language:
    canonical BCP 47 tag or "und"

phoneme_alphabet:
    null or "ipa" or vendor:<reverse-dns-id>:<alphabet>

phoneme_generation=text:
    target/compiler may generate phonemes from display lyric text

phoneme_generation=reading:
    target/compiler may generate phonemes from resolved reading

phoneme_generation=none:
    no automatic phoneme derivation
```

Phoneme generation is a declared compiler/target capability and must be deterministic for the same input/compiler version。
Generated phonemes become explicit canonical §63.13 phoneme data before persistence/render reproducibility checks。

Low-level per-note form remains available:

```text
c4 {
    lyric: "Hello"
    reading: "hello"

    phonemes: [
        ...
    ]

    breath: 0.2
    vibrato: 0.35
}
```

Family attributes:

```text
lyric: String?
reading: String?

phonemes: List<VocalPhonemeV1>
phoneme_alphabet: String?

pitch_curve: NoteCurve<Semitone>?

breath: Norm?
vibrato: Norm?
```

`lyric` is display text for this lyric unit。
`reading` is pronunciation text and does not need to equal display spelling。

If `reading` is absent:

```text
pronunciation source =
    lyric
```

If `phonemes` is non-empty, it is the explicit pronunciation override and `reading` is metadata/display guidance。

Phoneme validation is §63.13。

Controls:

```text
control vocal.breath: Norm
control vocal.vibrato: Norm
```

are voice-local defaults。

A target-specific phoneme alphabet may be selected by Performance Compiler configuration; otherwise IPA Unicode is the canonical explicit-phoneme default。

## 39.8 Lyrics DSL

For song authoring, lyrics should normally be separated from note notation。

Example:

```text
track Vocal {
    performance vocal {}

    notes {
        @8:
        c4 d4 e4 g4 a4 g4,
        g4 e4 d4 c4,
    }

    lyrics {
        language: "ja-JP"

        "き み の こ え が | き こ え る"
    }
}
```

English:

```text
lyrics {
    language: "en-US"

    "Hel lo / world _ | sing ing / now"
}
```

The lyrics block aligns lyric tokens to the Track's vocal note slots at compile time。

### 39.8.1 Lyric slot

A **lyric slot** is produced by a sounding source event in Vocal source notation。

Consumes one slot:

```text
note_event
retrigger
chord_event
```

Does not create a new slot:

```text
rest
sustain
performance control
duration/velocity default
bar commit
```

A vocal chord event creates **one** lyric slot; every simultaneous VocalPerformance note generated from that one source chord shares the same lyric assignment。

Each `voice {}` owns an independent lyric-slot sequence。

Slot order:

```text
1. source timeline position
2. source order
3. source EventId
```

### 39.8.2 Target voice

```text
lyrics {
    voice: Lead
    ...
}
```

or:

```text
lyrics {
    voice: "Lead"
    ...
}
```

If the target Track has exactly one vocal voice:

```text
voice may be omitted
```

If more than one vocal voice exists:

```text
voice is required
```

unless the lyrics block is nested under an unambiguous section/voice-specific construct。

Unknown voice -> compile error。

### 39.8.3 Section-scoped lyrics

```text
lyrics Chorus.A {
    language: "ja-JP"
    "き み が | す き"
}
```

aligns only to lyric slots in:

```text
[Chorus.A.start, Chorus.A.end)
```

Equivalent nested form:

```text
lyrics {
    language: "ja-JP"

    Chorus.A {
        "き み が | す き"
    }
}
```

A nested section inherits:

```text
language
voice
alignment
phoneme_alphabet
```

and may override them。

### 39.8.4 Lyrics string mini-language

Ordinary String escape processing (§62.4) happens first。
The resulting Unicode string is then tokenized by the Lyrics mini-language。

ASCII whitespace separates tokens and is **not** itself display text。

Special standalone tokens:

```text
_   melisma continuation
.   consume one lyric slot with no lyric
/   word boundary
|   phrase boundary
```

Normal lyric token:

```text
surface
surface{reading}
{reading}
```

Examples:

```text
"君{き} {み} の / 声{こえ}"
"Hel lo / world"
```

`{reading}` has empty display `surface` and is useful when one displayed word spans multiple sung units。

Braces inside surface/reading use doubled braces:

```text
{{  -> literal {
}}  -> literal }
```

A single unmatched brace is compile error。

Reserved standalone token characters can be sung/displayed by including them inside a normal token together with another character, or by Unicode escape in a token whose parsed result is not exactly the reserved standalone form。

### 39.8.5 Display word reconstruction

Whitespace in the Lyrics source is only a token separator。

Display text is reconstructed:

```text
normal adjacent lyric units:
    concatenate with no inserted character

/:
    insert one U+0020 SPACE word boundary

|:
    end current phrase
    inserts no display character by itself
```

Therefore Japanese can remain compact while still using spaces for note alignment:

```text
"き み の こ え"
    -> display "きみのこえ"
```

English word segmentation:

```text
"Hel lo / world"
    -> display "Hello world"
```

Punctuation belongs to the surface token:

```text
"Hel lo, / world!"
```

### 39.8.6 Reading

`surface{reading}`:

```text
surface:
    display lyric fragment

reading:
    pronunciation source
```

`{reading}`:

```text
surface = ""
reading = reading
```

When no `{reading}` exists:

```text
reading = surface
```

All surface/reading text is UTF-8 NFC。

The Lyrics DSL does **not** silently perform dictionary-dependent word segmentation or kanji reading generation。
If pronunciation differs from display spelling, author/Component/AI tool supplies `{reading}` or explicit note-level phonemes。

This keeps compilation deterministic and language-independent。

### 39.8.7 Language

```text
language: "ja-JP"
language: "en-US"
```

is a valid BCP 47 / RFC 5646 language tag。

Canonicalization:

```text
language subtags use BCP 47 canonical case conventions
semantic comparison is ASCII case-insensitive
```

A Lyrics block without `language` inherits `VocalPerformanceConfigV1.language`。
If no language can be resolved:

```text
language = "und"
```

(`und` = undetermined)。

### 39.8.8 Word boundary `/`

`/` consumes no note slot。

It marks:

```text
previous lyric unit:
    word_boundary_after = true
```

Rules:

```text
/ before any lyric unit:
    compile error

two consecutive /:
    compile error

/ immediately before |:
    allowed
```

### 39.8.9 Phrase boundary `|`

`|` consumes no note slot。

It marks:

```text
previous lyric unit:
    phrase_end = true

next non-melisma lyric unit:
    phrase_start = true
```

Leading/trailing `|` is allowed and represents an explicit phrase boundary at the selection edge。

Consecutive `|` collapse to one boundary in canonical IR。

### 39.8.10 Melisma `_`

`_` consumes exactly one lyric slot and continues the previous lyric unit。

Example:

```text
notes:
    c4 d4 e4

lyrics:
    "love _ _"
```

means:

```text
c4 -> lyric unit "love", melisma_index 0
d4 -> same lyric unit, melisma_index 1
e4 -> same lyric unit, melisma_index 2
```

Rules:

```text
_ requires a previous lyric unit
_ cannot follow .
_ does not create display text
_ does not create a new reading
```

All notes in the melisma share one stable `lyric_unit_id`。

### 39.8.11 Skip `.`

`.` consumes exactly one lyric slot but assigns no lyric。

Use for:

```text
instrumental vocalise
pickup/noise note
explicit breath-like pitched event
untexted backing note
```

The resulting VocalPerformance has:

```text
lyric = null
```

unless a note-level lyric override exists。

### 39.8.12 Alignment mode

Default:

```text
alignment: exact
```

Modes:

```text
exact:
    lyric slot count consumed by normal token / _ / .
    must equal available lyric-slot count in target range

prefix:
    consumed count may be <= available slots
    remaining slots receive no lyric
```

Too many consumed slots is always compile error。

`exact` is the default specifically to catch accidental lyric/note drift。

### 39.8.13 Note-level override

If a note carries:

```text
lyric:
reading:
phonemes:
```

and the same slot is targeted by a Lyrics block:

```text
explicit note-level field wins for that field
```

Other Lyrics metadata remains。

Example:

```text
lyrics:
    surface/reading from block

note:
    explicit phonemes only

result:
    block surface/reading
    note phonemes
```

Two different Lyrics blocks assigning the same field to the same slot are compile error unless one is a strictly more-specific nested section override。

### 39.8.14 Phoneme generation

Canonical Lyrics alignment does not require phoneme generation。

After lyric alignment:

```text
explicit phonemes present:
    use them

else:
    VocalPerformance.phonemes = []
    preserve lyric + reading + language
```

A target Vocal Performance Compiler / Adapter may declare:

```text
phoneme_generation:
    none
    text
    reading
```

If target requires explicit phonemes and:

```text
phonemes empty
and
no compatible phoneme generator exists
```

binding is compile error。

No implementation-dependent G2P is silently inserted into canonical Project/Performance IR。

### 39.8.15 Phoneme alphabet

```text
phoneme_alphabet: "ipa"
```

or target-specific stable identifier:

```text
vendor:<reverse-dns-id>:<alphabet>
```

If explicit `phonemes` are present and no alphabet is stated:

```text
alphabet = "ipa"
```

Text/reading-only lyrics do not require a phoneme alphabet。

### 39.8.16 Canonical lyric assignment

After alignment each sung slot gets:

```text
VocalLyricV1
```

defined in §63.13。

For melisma, every participating VocalPerformance receives the same `lyric_unit_id` plus its own `melisma_index/melisma_count`。

This makes:

```text
subtitle rendering
karaoke highlighting
MIDI lyric export
vocal synthesis
editor lyric-follow
```

derive from the same canonical assignment。

## 39.9 Contextual enum values

For family fields whose expected type is a closed enum:

```text
technique: palm_mute
manual: right
bow_direction: down
```

bare case identifiers are contextual enum-case literals and do not require a `let` binding。

Outside an expected enum context, an unbound identifier remains a name-resolution error。

---

---

---

---

# 40. Drum DSL

Basic:

```text
drums {
    @16:

    Kick  "x...x...x...x..."
    Snare "....X.......X..."
    Hat   "x.x.x.x.x.x.x.x."
}
```

The parser grammar is §62.17.1。

## 40.1 Cell grid

`@N:` in a drum scope defines the duration of one pattern character。

```text
@16:
    one cell = 1/16 note = 1/4 quarter-note beat
```

The default is:

```text
@16:
```

unless an enclosing drum scope already provides a duration。

`@bar` is not permitted as a drum cell duration。

Each lane string starts at the same local scope origin。
Lanes overlay; they do not advance one another。

Lane duration:

```text
number_of_cells * cell_duration
```

Drum block duration:

```text
max duration of all direct lanes / nested section span
```

A shorter lane has implicit trailing rests。

## 40.2 Pattern string

After UTF-8 decoding, only these pattern characters are semantic:

```text
. x X g o c r f
```

Formatting characters:

```text
ASCII space
ASCII tab
|
```

Space/tab are ignored。

`|` is a visual bar separator and consumes no time。
It is valid only at an exact bar boundary under the active Meter Map。
A misplaced `|` is compile error。

Any other character is compile error。

## 40.2.1 Lane repeat

```text
Kick "x...x...x...x..." * 4
```

Repeat count:

```text
compile-time Int
>= 0
```

The decoded semantic cell sequence is concatenated `N` times **before** hit expansion/humanize。

`N=0` produces an empty lane。

A compile-time String variable may be used:

```text
let Kick4 = "x...x...x...x..."

drums {
    @16:
    Kick Kick4 * 8
}
```

The String value is validated as a drum pattern when used as `drum_lane_source`。

## 40.2.2 Whole-pattern repeat

Multi-lane repetition uses `DrumFragment`:

```text
pattern BasicBeat() {
    drums {
        @16:
        Kick  "x...x...x...x..."
        Snare "....X.......X..."
        Hat   "x.x.x.x.x.x.x.x."
    }
}

track Drums {
    BasicBeat() * 8
}
```

Within one DrumFragment all lanes remain overlaid at the same fragment-local origin。
Fragment repeat places each full multi-lane fragment sequentially (§17)。

A fragment can be stored:

```text
let VerseBeat = BasicBeat() * 4
```

and expanded later:

```text
track Drums {
    VerseBeat
    Fill()
    VerseBeat
}
```

## 40.2.3 DrumFragment local duration

For one `drums {}` fragment:

```text
duration =
    max(
        every lane decoded duration,
        every explicitly expanded nested DrumFragment end
    )
```

Direct lane definitions begin at fragment-local time `0` unless they are inside an explicitly sequential nested fragment expansion。

A shorter direct lane has trailing rest through fragment duration。

Nested DrumFragment expansion used as a drum item is sequential:

```text
first nested fragment starts at local cursor 0
next nested fragment starts at previous nested fragment end
```

Direct lanes and nested-fragment sequences may coexist only when their intended overlap is unambiguous:

```text
direct lanes:
    anchored at time 0

nested fragment sequence:
    anchored at time 0 and advances its own sequence cursor

overall duration:
    max(direct-lane duration, nested-sequence duration)
```

This lets a fixed ostinato lane overlay a sequence of fills deterministically。

## 40.3 Hit semantics

Canonical generated type is §63 `DrumPerformance`。

Base symbols:

```text
.   rest

x   normal hit
    velocity = 0.80

X   accent
    velocity = 1.00

g   ghost note
    velocity = 0.35

o   open articulation
    velocity = 0.80

c   closed articulation
    velocity = 0.80

r   two-hit roll inside one cell
    emit two DrumPerformance events
    hit = normal
    hit 1 at cell start
    hit 2 at cell start + cell_duration/2
    velocity = 0.75 each

f   flam
    emit two DrumPerformance events
    hit = normal
    main hit at cell start
    grace hit before main by:
        min(20ms, cell_duration/4)
    main velocity = 0.80
    grace velocity = 0.50
```

For a flam at scope start, grace time is clamped to scope start。
If grace and main become the same sample after quantization, only the main hit is emitted。

`o` / `c` set:

```text
articulation = "open" / "closed"
```

For lane `Hat`:

```text
x / X / g default articulation = "closed"
```

Other lanes may use open/closed if their receiving drum instrument supports it。

## 40.4 Drum voice identity

Lane identifier becomes canonical semantic voice。

Standard names:

```text
Kick
Snare
Hat
Crash
Ride
LowTom
MidTom
HighTom
Rim
Clap
Cowbell
Tambourine
Shaker
```

Unknown identifier is allowed as a custom semantic voice and is preserved as UTF-8 NFC text。

Voice comparison is case-sensitive after NFC normalization。

## 40.5 Scope / section placement

Top-level drum content:

```text
track origin = 1bar
```

Section:

```text
drums {
    Verse.A {
        @16:
        Kick "x...x...x...x..."
    }
}
```

starts at:

```text
Verse.A.start
```

Nested section lane duration must fit the section span。
Overflow policy is:

```text
error
```

because drum lane strings are explicit authored grids。

Top-level lanes with `structure` present must end at or before `arrangement_end`。

## 40.6 Humanize

```text
humanize {
    timing: 3ms
    velocity: 0.035
    seed: 200
}
```

Schema:

```text
DrumHumanizeV1 {
    timing: Time = 0s
    velocity: Norm = 0
    seed: UInt64
}
```

constraints:

```text
timing >= 0
timing < cell_duration / 2

0 <= velocity <= 1
seed required when timing > 0 or velocity > 0
```

For each generated hit with EventId `id`:

```text
dt =
    rand_range(
        seed,
        (id, "drum-timing"),
        -timing,
        +timing
    )

dv =
    rand_range(
        seed,
        (id, "drum-velocity"),
        -velocity,
        +velocity
    )

time' =
    clamp(
        base_time + dt,
        scope_start,
        scope_end
    )

velocity' =
    clamp(
        base_velocity + dv,
        0,
        1
    )
```

`rand_range` is the exact §19.6 algorithm。

Humanize is applied after roll/flam expansion so each emitted hit has an independent stable EventId。

## 40.7 MIDI lowering default

Native WASM Plugin should consume semantic `DrumPerformance` where possible。

For MIDI 1 / Standard MIDI File export, the default General MIDI percussion mapping is:

```text
Kick        36
Snare       38
Hat closed  42
Hat open    46
LowTom      45
MidTom      47
HighTom     50
Crash       49
Ride        51
Rim         37
Clap        39
Cowbell     56
Tambourine  54
Shaker      82
```

MIDI channel:

```text
10 in human 1-based notation
9 in MIDI zero-based channel number
```

Custom voice without an External Plugin/MIDI Adapter mapping is export error。

Adapter-provided mapping overrides the General MIDI default。

---

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

---

# 55. コメントと空白

通常は空白と改行に構文上の意味を持たせない。

```text
@8: c4 . +2 +2,
```

と:

```text
@8:
c4 . +2 +2,
```

は同一。

```text
// single line
/* multi line */
```

---

---

---

---

# 56. Complete Example

> **Non-normative:** この章は説明・例示用。矛盾時は対応する normative 章を優先する。

```text
import component Sidechain from "std:components/sidechain"
import component StereoDelay from "std:components/stereo-delay"
import plugin SuperSynth from "./plugins/super-synth.wasm"

fn fade(t: Norm) -> Db {
    lerp(-14db, -7db, ease_in(t))
}

pattern LeadPhrase(root: Pitch) {
    notes {
        @8:
        !0.8:
        root . +2 +2 -3 .,
        +5 . -2 . -3 .,
    }
}

project {
    version: 1
    title: "soraotoDSL Example"

    sample_rate: 48khz
    bit_depth: 24bit

    tempo: 124bpm
    meter: 4/4
    key: C.major

    structure {
        Intro  { bars: 4 }
        Verse  { bars: 4 }
        Chorus { bars: 4 }
        Outro  { bars: 4 }
    }

    chords Harmony {
        Verse {
            C,
            G/B,
            Am7,
            Fmaj7,
        }

        Chorus {
            C,
            G,
            F,
            G,
        }
    }

    track Kick {
        drums {
            @16:
            Kick "x...x...x...x..."
        }
    }

    track Drums {
        drums {
            Verse {
                @16:
                Snare "....X.......X..."
                Hat   "x.x.x.x.x.x.x.x."
            }

            Chorus {
                @16:
                Snare "....X.......X..."
                Hat   "xxxxxxxxxxxxxxxx"
                Crash "X..............."
            }

            humanize {
                timing: 3ms
                velocity: 0.035
                seed: 200
            }
        }
    }

    track Bass {
        Harmony
        |> BassRoot(
            octave: 2,
            mode: chord_bass
        )

        effects {
            Sidechain {
                source: Kick
                amount: -8db
                attack: 4ms
                release: 110ms
            }
        }

        gain: -8db
    }

    track Guitar {
        Harmony
        |> GuitarVoicing(
            style: open,
            voice_leading: nearest
        )
        |> GuitarStrum(
            style: pop8
        )

        gain: -9db
    }

    track Piano {
        Harmony
        |> PianoVoicing(
            range: c3..c5,
            voice_leading: nearest
        )

        gain: -8db
    }

    track Lead {
        instrument {
            SuperSynth {
                preset: "Wide Lead"
                cutoff: 2.2khz
                resonance: 0.3
            }
        }

        Chorus {
            LeadPhrase(c5)
        }

        gain: -10db
    }

    automation Lead.instrument.cutoff {
        Chorus {
            1.2khz -> 4.5khz
            curve: ease_in
        }
    }

    modulation Lead.instrument.cutoff {
        source: lfo {
            shape: sine
            rate: 1/4
            phase: 0.0
        }

        amount: 500hz
    }

    track Vocal {
        clip VerseVocal {
            asset: asset("audio/verse.wav")
            at: Verse
            fade_in: {
                duration: 30ms,
                curve: equal_power
            }

            fade_out: {
                duration: 80ms,
                curve: equal_power
            }
        }
    }

    bus VocalDelay {
        StereoDelay {
            time: 1/8d
            feedback: 0.38
            mix: 1.0

            feedback_filter {
                high_pass: 200hz
                low_pass: 5khz
            }
        }
    }

    routing {
        Kick -> Master
        Drums -> Master
        Bass -> Master
        Guitar -> Master
        Piano -> Master
        Lead -> Master
        Vocal -> Master

        Vocal -> VocalDelay {
            gain: -14db
            mode: post_fader
        }

        VocalDelay -> Master
    }

    master {
        effects {
            Compressor {
                threshold: -10db
                ratio: 2
            }

            Limiter {
                ceiling: -1db
            }
        }
    }

    render Main {
        format: wav
        sample_rate: 48khz
        bit_depth: 24bit
    }
}
```

---

---

---

---

# 57. 最小限覚える構文

> **Non-normative:** この章は説明・例示用。矛盾時は対応する normative 章を優先する。

```text
c4          absolute pitch
+2 / -3     relative semitone
+ / -       ±1 semitone
.           retrigger current note group
_           rest
~           sustain

@8:         default duration
@4c4        one-shot duration

!0.8:       default velocity
!1.0c4      one-shot velocity

[c4 +4 +7] chord
,           close current bar
(...)*4     repeat
```

変数化・展開:

```text
let ROOT = c4

let Riff = notes {
    @8:
    ROOT . +2 -2
}

notes {
    use Riff * 4
}
```

ドラム:

```text
let Kick4 = "x...x...x...x..."

pattern Beat() {
    drums {
        @16:
        Kick  Kick4
        Snare "....X.......X..."
        Hat   "x.x.x.x.x.x.x.x."
    }
}

track Drums {
    Beat() * 8
}
```

歌詞:

```text
track Vocal {
    performance vocal {
        language: "ja-JP"
    }

    notes {
        @8:
        c4 d4 e4 g4 a4 g4,
        g4 e4 d4 c4,
    }

    lyrics {
        "き み の こ え が | き こ え る"
    }
}
```

Lyrics mini-language:

```text
_   previous lyric unit melisma continuation
.   one note without lyric
/   word boundary
|   phrase boundary

surface{reading}
{reading}
```

構造:

```text
project
structure
chords
track
notes
drums
lyrics
pattern
fn
macro
```

拡張:

```text
import component
import plugin
automation
modulation
routing
bus
master
render
```

---

---

---

---

# 58. 役割の最終整理

> **Non-normative:** この章はnavigation/説明専用。型signature・wire schema・実行意味論を再定義しない。

Canonical authority:

| Term | Normative authority |
|---|---|
| `fn` | §18, formal grammar §62 |
| `pattern`, `EventFragment<T>`, `PatternFn` | §16–17, formal grammar/type rules §62 |
| `macro`, `Stream<T>` | §19, formal grammar §62 |
| JS/WASM Component | §20–21 |
| Instrument Performance Layer | §35–40 |
| Canonical Performance IR | §63 |
| WASM Plugin | §22–31 |
| External Plugin Adapter / MIDI lowering | §49–50 |
| Project/Audio graph | §32–34, §41–48 |
| Rendering / export | §52–54 |
| Determinism cross-cutting rules | §60.3 |
| Wire / binary schema | §29, §61 |
| Conformance / completeness | §67–68 |

役割の読み方:

```text
Core / Harmony / Pattern / Macro:
    musical authoring and compile-time transformation

Instrument Performance Layer:
    instrument-specific musical/physical intent lowering

Component:
    compile-time Project/graph generation

WASM Plugin:
    runtime realtime/offline audio/event processing

External Plugin Adapter:
    vendor/native-plugin/protocol-specific lowering
```

上の説明は理解補助のみ。
正確な入力型・出力型・lifecycle・wire semanticsは表のNormative authorityだけを参照する。

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

---

# 61. Deterministic CBOR Wire Schema

Component payload、Plugin control plane、preset/state context で使用する CBOR をここで固定する。

## 61.1 Encoding profile

RFC 8949 の CBOR data model / major type encoding を使用し、
soraotoDSL はその上に **Soraoto Deterministic CBOR Profile 1** を定義する。

RFC 8949 の generic deterministic profile をそのまま参照するのではなく、
以下を唯一の canonical byte encoding とする。

```text
map key:
    UTF-8 text only
    Unicode NFC
    sort by normalized UTF-8 key bytes in unsigned lexicographic order
    shorter prefix sorts before its longer continuation

text:
    valid UTF-8
    Unicode NFC
    definite length
    shortest legal byte-length argument encoding

bytes:
    definite length
    shortest legal byte-length argument encoding

integer:
    RFC 8949 major type 0/1
    shortest legal argument-width encoding

float:
    always CBOR major type 7, additional-info 27
    exactly IEEE-754 binary64 big-endian payload
    Float16 / Float32 encoding prohibited
    -0.0 canonicalized to +0.0
    NaN / +Infinity / -Infinity prohibited

array:
    definite length
    shortest legal length encoding

map:
    definite length
    shortest legal length encoding
    duplicate key prohibited
    keys ordered by the UTF-8 rule above

simple:
    false / true / null only where schema allows

indefinite-length:
    prohibited

tag:
    prohibited unless this specification explicitly allocates it
```

したがって、同一 semantic value は exactly one byte representation を持つ。

`Bool`, `Null`, `Bytes`, `String`, `List<T>`, `Map<String,T>` は CBOR primitive に直接対応する。

Optional / nullable field:

```text
T?
```

means:

```text
field absent
OR
field present with value T
OR
field present with CBOR null
```

unless the defining section says otherwise。

`absent` と explicit `null` は wire上は別物だが、`T?` では既定で同じ semantic `None` として扱う。

absent と null を区別する必要がある field は:

```text
T | null
```

を **required field** として宣言し、section が両者の意味を定義する。

Enum は **本仕様に記載した exact lowercase snake_case text string** で encoding する。

例:

```text
PluginKind.effect
    -> "effect"

ProcessMode.offline
    -> "offline"
```

SemVer:

```text
String
```

Semantic Versioning 2.0.0 の canonical text。
例:

```text
"1.2.3"
"2.0.0-beta.1"
```

## 61.2 Numeric aliases

```text
UInt8   = CBOR unsigned 0..255
UInt16  = CBOR unsigned 0..65535
UInt32  = CBOR unsigned 0..4294967295
UInt64  = CBOR unsigned 0..18446744073709551615

Int16   = CBOR integer -32768..32767
Int32   = CBOR integer -2147483648..2147483647
Int64   = CBOR integer signed 64-bit domain

Float64 = finite IEEE-754 binary64
```

range 外は decode error。

## 61.2.1 SemVer

`SemVer` は UTF-8 text stringで、Semantic Versioning 2.0.0 の canonical subset。

grammar:

```text
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

constraints:

```text
MAJOR / MINOR / PATCH:
    decimal UInt32
    no leading zero unless exactly "0"

PRERELEASE:
    dot-separated ASCII identifiers
    [0-9A-Za-z-]+
    numeric identifier has no leading zero unless "0"

BUILD:
    dot-separated ASCII identifiers
    [0-9A-Za-z-]+
```

Comparison for compatibility:

```text
major/minor/patch numeric
then prerelease according to SemVer 2.0.0 precedence
build metadata ignored for precedence
```

Descriptor equality uses exact string equality after parser validates canonical syntax。

## 61.2.2 Canonical scalar/unit wire aliases

Direct Project IR / Clipboard / Descriptor schemas use the following wire aliases:

```text
Int        = Int64
Float      = Float64

Norm       = Float64, 0..1
Velocity   = Norm
Expression = Norm

Pan        = Float64, -1..1
Balance    = Float64, -1..1
Width      = Float64, 0..2

Db         = Float64 in decibels
Hz         = Float64 in hertz
Bpm        = Float64 > 0
Semitone   = Float64
Cent       = Float64

Time       = Float64 seconds
Pitch      = Float64 semitones with C-1 = 0
PitchClass = UInt8 0..11
BitDepth   = UInt16, one of 16 | 24 | 32
```

canonical unit conversion before wire encoding:

```text
khz  -> Hz * 1000
ms   -> seconds / 1000
st   -> Semitone
percent -> ratio / 100 where target type is Norm/ratio
```

`MusicalTime`, `MusicalDuration`, `Meter`, `Chord`, `AssetRef` はそれぞれの normative record schema を Deterministic CBOR record rules (§61.4) で encodeする。

Unit-bearing direct IR fields **do not** carry textual unit suffixes on wire。
Unit is determined by schema type。

## 61.3 `Value` wire schema

```text
Value =
    null
  | bool
  | int
  | float
  | string
  | bytes
  | list
  | record
  | unit_value
  | pitch
  | ref
```

wire:

```text
null:
    {"t":"null"}

bool:
    {"t":"bool","v":Bool}

int:
    {"t":"int","v":Int64}

float:
    {"t":"float","v":Float64}

string:
    {"t":"string","v":String}

bytes:
    {"t":"bytes","v":Bytes}

list:
    {"t":"list","v":List<Value>}

record:
    {"t":"record","v":Map<String,Value>}

unit_value:
    {
      "t":"unit",
      "unit":String,
      "v":Float64
    }

pitch:
    {
      "t":"pitch",
      "semitone":Float64
    }

ref:
    {
      "t":"ref",
      "kind":String,
      "id":String
    }
```

unit string registry:

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

unknown unit は:

```text
vendor:<reverse-dns-id>:<name>
```

形式のみ許可。

## 61.4 Record encoding

この仕様中:

```text
Foo {
    a: UInt32
    b: String?
}
```

は wire 上、以下3形を許可する。

```text
{"a": UInt32}

{"a": UInt32, "b": String}

{"a": UInt32, "b": null}
```

field order は semantic ではないが Soraoto Deterministic CBOR Profile 1 の map-key ordering に従う。

schema notation:

```text
field: T
    required; null prohibited unless T includes Null

field: T?
    optional/nullable; absent, T, or null allowed
    absent/null are semantically equivalent unless section explicitly distinguishes them

field: T | null
    required; null is an explicit value

field: List<T>
    required array; empty allowed unless section states otherwise
```

required field の欠落は decode error。

unknown field:

```text
same ABI major:
    ignore for semantic processing
    preservation during opaque read-modify-write is optional
    preservation must not alter defined semantic behavior
```

unknown enum value in a required field:

```text
decode/configuration error
```

vendor semantic extension field は `x-<reverse-dns-id>-<name>` を使用する。

標準 schema の field 名を vendor extension が上書きしてはならない。

## 61.5 `PluginDescriptorV1` required fields

以下は required:

```text
abi_major
abi_minor
id
vendor
name
version
kinds
max_instances
compatible_plugin_ids
required_wasm_features
required_host_features
optional_host_features
process_context_requirements
supports_f64
supports_in_place
deterministic_dsp
distributable
process_modes
io_modes
units
audio_buses
event_buses
routing_hints
parameters
controllers
note_expressions
articulations
key_switches
physical_ui_mappings
orchestral_articulations
controller_mappings
remote_representations
data_exchange_queues
parameter_aliases
factory_presets
program_lists
state
prefetch_support
max_event_output_per_block
max_host_requests_per_block
max_asset_requests_per_block
max_data_exchange_packets_per_block
```

optional:

```text
categories
tags
homepage
prefetch_support_current
```

missing required field は load error。

## 61.6 `PluginConfigV1` required fields

```text
abi
sample_rate
sample_format
max_frames
process_mode
io_mode
automation_state
host_info
host_capabilities
control_quantum_samples
active_audio_buses
active_event_buses
data_exchange_queues
capacities
```

optional:

```text
channel_context
```

## 61.7 EventId128 / stable binary identity

CBOR encoding:

```text
EventId128 = Bytes length exactly 16
```

hex display form:

```text
32 lowercase hexadecimal characters
```

binary comparison は unsigned lexicographic byte order。

## 61.8 Control request validation

Control opcode ごとに §23.4 の request schema 以外を受理してはならない。

unknown request field:

```text
"x-*" vendor extension:
    ignore if unsupported

other:
    SORAOTO_E_INVALID_ARGUMENT
```

Response は schema-required field をすべて含む。

---

---

---

---

# 62. Language Lexical Grammar / Scope / Type Rules

この章は parser / compiler 間で source 解釈が分岐しないための normative language layer。

## 62.1 Source encoding

```text
UTF-8 without BOM preferred
BOM accepted only at byte 0
line ending:
    LF
    CRLF
```

EBNF meta-notation used in §62:

```text
"token"     literal terminal
A B         sequence
A | B       alternative
[ A ]       optional (zero or one)
{ A }       repetition (zero or more)
( A )       grouping

UPPER_CASE  lexer/meta terminal defined by prose
lower_case  grammar nonterminal
```

Postfix `?`, `*`, `+` are not EBNF meta-operators in this specification。
A source-language `?` is always written as quoted `"?"`。

Compiler は source text を Unicode NFC に正規化せず、identifier/string comparison 時のみ NFC canonicalization する。

tab は whitespace。

## 62.2 Comments

```ebnf
line_comment  = "//" { LINE_CHAR } ;
block_comment = "/*" { block_comment | BLOCK_CHAR } "*/" ;
```

lexical meta terminals:

```text
LINE_CHAR:
    any Unicode scalar except CR or LF

BLOCK_CHAR:
    any Unicode scalar, consumed by the nested-comment scanner
    except that "/*" opens a nested block_comment
    and "*/" closes the current block_comment
```

block comment は nest 可能。

unterminated comment は lexical error。

## 62.3 Identifiers

```ebnf
ident_start = "_" | Unicode-XID-Start ;
ident_cont  = "_" | Unicode-XID-Continue ;
ident       = ident_start { ident_cont } ;
```

NFC normalized identity で比較する。

Keyword は identifier として使用不可。

case-sensitive。

## 62.4 Literals

lexical primitives:

```ebnf
digit       = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
hex_digit   = digit | "a".."f" | "A".."F" ;
sign        = "+" | "-" ;
exponent    = ("e" | "E") [sign] digit { digit | "_" } ;
```

numeric/string:

```ebnf
int_lit     = digit { digit | "_" } ;

float_lit   =
      digit { digit | "_" } "." digit { digit | "_" } [exponent]
    | digit { digit | "_" } exponent ;

number      = int_lit | float_lit ;

string_lit  = '"' { STRING_CHAR | escape } '"' ;

escape =
    "\\" ( "\\" | '"' | "n" | "r" | "t"
          | "u{" hex_digit { hex_digit } "}" ) ;

bool_lit    = "true" | "false" ;
null_lit    = "null" ;
percent_lit = number "%" ;
```

`STRING_CHAR` は unescaped `"`、`\`、U+0000..U+001F を除く Unicode scalar。

`\u{...}`:

```text
1..6 hex digits
Unicode scalar value only
surrogate U+D800..U+DFFF prohibited
> U+10FFFF prohibited
```

leading/trailing underscore in numeric literalは禁止。
consecutive underscoreは禁止。

string character:

```text
all Unicode scalar values except unescaped:
    "
    \
    U+0000..U+001F
```

escape:

```text
\\
\"
\n
\r
\t
\u{HEX}
```

Unit literal:

```ebnf
unit_lit =
    number unit_suffix ;

unit_suffix =
      "db"
    | "hz"
    | "khz"
    | "ms"
    | "s"
    | "bpm"
    | "st"
    | "cent"
    | "bar"
    | "beat"
    | "bit" ;
```

`bar` は project meter map に依存する position/duration unit。
`bit` は BitDepth。

Percent:

```text
50%
```

Norm は unitless Float constrained `0..1` by target type。

musical fraction literal:

```ebnf
musical_fraction =
    int_lit "/" int_lit ["d" | "t"] ;
```

target type が `BeatDuration` の場合:

```text
1/4  = 1 quarter-note beat
1/8  = 1/2 beat
1/8d = 3/4 beat
1/8t = 1/3 beat
```

formula:

```text
base = 4 * numerator / denominator beats

d -> base * 3/2
t -> base * 2/3
```

meter literal:

```ebnf
meter_lit = int_lit "/" int_lit ;
```

target type `Meter` でのみ meter と解釈する。

同じ token sequence が `BeatDuration` / `Meter` / division expression の複数候補になる場合は **expected target type** で解決する。
expected type が無く複数解釈可能なら compile error。

## 62.5 Pitch token

```ebnf
pitch =
    note_name [ pitch_accidental ] octave ;

note_name =
    "c" | "d" | "e" | "f" | "g" | "a" | "b"
  | "C" | "D" | "E" | "F" | "G" | "A" | "B" ;

pitch_accidental =
    "#" | "b" | "##" | "bb" ;

octave =
    ["-"] digit { digit } ;
```

canonical internal value:

```text
C-1 = 0 semitones
C4  = 60
A4  = 69
```

enharmonic spelling は AST に保持するが pitch equality は sounding pitch で行う。

## 62.6 Duration token

```ebnf
duration =
    "@" duration_base [ duration_modifier ] ;

duration_base =
    int_lit
  | "bar" ;

duration_modifier =
    "d"
  | "t" ;
```

validation:

```text
numeric duration_base > 0
duration_modifier permitted only for numeric duration_base
```

`@N`:

```text
whole note / N
```

`d`:

```text
x 3/2
```

`t`:

```text
x 2/3
```

## 62.7 Declaration / structural grammar

```ebnf
module =
    { import_decl
    | let_decl
    | type_decl
    | fn_decl
    | pattern_decl
    | macro_decl
    | project_decl
    } ;

import_decl =
      "import" string_lit
    | "import" "component" ident "from" string_lit
    | "import" "plugin" ident "from" string_lit ;

let_decl =
    "let" ident "=" expr ;

type_decl =
      struct_decl
    | enum_decl ;

struct_decl =
    "struct" ident "{"
        [ struct_field { [","] struct_field } [","] ]
    "}" ;

struct_field =
    ident ":" type_ref ;

enum_decl =
    "enum" ident "{"
        [ ident { [","] ident } [","] ]
    "}" ;

fn_decl =
    "fn" ident "(" [ param_list ] ")" "->" type_ref fn_block ;

pattern_decl =
    "pattern" ident "(" [ param_list ] ")"
    [ "->" type_ref ]
    block ;

macro_decl =
    "macro" ident "(" [ param_list ] ")" "->" type_ref macro_block ;

project_decl =
    "project" block ;

param_list =
    param { "," param } ;

param =
    ident ":" type_ref [ "=" expr ] ;

type_ref =
    type_atom [ "?" ] ;

type_atom =
      qualified_name [ generic_args ]
    | "(" type_ref "," type_ref { "," type_ref } ")" ;

generic_args =
    "<" type_ref { "," type_ref } ">" ;

qualified_name =
    ident { "." ident } ;
```

Function / Macro value blocks:

```ebnf
fn_block =
    "{"
        { let_stmt }
        [ "return" ] expr
    "}" ;

macro_block =
    "{"
        { let_stmt }
        "return" expr
    "}" ;

expr_block =
    "{"
        { let_stmt }
        expr
    "}" ;

let_stmt =
    "let" ident "=" expr ;
```

`fn` は final expression または final `return expression` を返す。
`macro` は final `return` 必須。
early return はない。

Structural blocks:

```ebnf
block =
    "{" { statement } "}" ;

statement =
      specialized_statement
    | fragment_statement
    | field_statement
    | assignment_statement
    | named_block_statement
    | routing_statement
    | pipeline_statement ;

fragment_statement =
    expr ;

specialized_statement =
      notes_statement
    | drums_statement
    | lyrics_statement
    | chords_statement
    | follow_statement
    | tempo_map_statement
    | meter_map_statement
    | key_map_statement
    | routing_block_statement
    | automation_statement ;

notes_statement =
    "notes" note_block ;

drums_statement =
    "drums" drum_block ;

lyrics_statement =
    "lyrics" [ qualified_name ] lyrics_block ;

chords_statement =
    "chords" [ qualified_name ] chord_timeline_block ;

follow_statement =
    "follow" qualified_name [ "(" named_args ")" ] note_block ;

tempo_map_statement =
    "tempo" tempo_map_block ;

meter_map_statement =
    "meter" meter_map_block ;

key_map_statement =
    "key" key_map_block ;

routing_block_statement =
    "routing" routing_block ;

automation_statement =
    "automation" ref_expr automation_block ;

field_statement =
    qualified_name ":" expr ;

assignment_statement =
    qualified_name "=" expr ;

named_block_statement =
    qualified_name [ block_label ] block ;

block_label =
      qualified_name
    | string_lit ;

routing_statement =
    ref_expr "->" ref_expr [ block ] ;

ref_expr =
    qualified_name ;

pipeline_statement =
    logical_or "|>" pipeline_target { "|>" pipeline_target } ;

timeline_locator =
      unit_lit
    | qualified_name ;

value_ramp_statement =
    expr "->" expr ;

tempo_map_block =
    "{"
        { tempo_map_entry }
    "}" ;

tempo_map_entry =
      timeline_locator ":" unit_lit
    | timeline_locator "->" timeline_locator tempo_ramp_block ;

tempo_ramp_block =
    "{"
        value_ramp_statement
        [ "curve" ":" ident ]
    "}" ;

meter_map_block =
    "{"
        { timeline_locator ":" meter_lit }
    "}" ;

key_map_block =
    "{"
        { timeline_locator ":" key_literal }
    "}" ;

routing_block =
    "{"
        { routing_statement }
    "}" ;

automation_block =
    "{"
        { automation_entry }
    "}" ;

automation_entry =
      timeline_locator ":" expr
    | qualified_name automation_section_block ;

automation_section_block =
    "{"
        value_ramp_statement
        [ "curve" ":" ident ]
    "}" ;
```

Specialized block semantics determine which statement kinds are legal:

```text
project:
    project fields + structure/chords/track/bus/automation/modulation/
    routing/master/render/assets blocks

track:
    fields + performance/instrument/effects/section/notes/lyrics/pipeline/clip
    + compatible EventFragment<T> expansion

bus/master:
    fields + effects/routing-compatible blocks

notes:
    §62.17 note-sequence grammar

chords:
    §62.18 chord grammar + duration/bar rules

routing:
    routing_statement only

automation:
    typed curve statements

modulation:
    modulation source statements

assets:
    assignment_statement

render:
    declared render fields
```

Parser dispatch rule:

```text
when the first identifier is:
    notes / drums / chords / follow / tempo / meter / key / routing / automation

the corresponding specialized_statement production is attempted before generic named_block_statement。
```

Scalar fields such as:

```text
tempo: 120bpm
meter: 4/4
key: C.major
```

remain ordinary `field_statement`。

A syntactically valid statement in a block where its semantic kind is not allowed is a compile error。

## 62.8 Expression / pipeline grammar

precedence high -> low:

```text
postfix/member/call/index
immutable `with`
unary
* / %
+ -
range `..`
comparison
equality
&&
||
|>
```

binary operators are left associative except range, which is non-associative。

```ebnf
expr =
    pipeline_expr ;

pipeline_expr =
    logical_or { "|>" pipeline_target } ;

logical_or =
    logical_and { "||" logical_and } ;

logical_and =
    equality { "&&" equality } ;

equality =
    comparison { ("==" | "!=") comparison } ;

comparison =
    range_expr { ("<" | "<=" | ">" | ">=") range_expr } ;

range_expr =
    additive [ ".." additive ] ;

additive =
    multiplicative { ("+" | "-") multiplicative } ;

multiplicative =
    unary { ("*" | "/" | "%") unary } ;

unary =
      ("!" | "+" | "-") unary
    | update_expr ;

update_expr =
    postfix { "with" update_block } ;

postfix =
    primary {
        "." ident
      | "(" [ argument_list ] ")"
      | "[" expr "]"
    } ;

primary =
      note_fragment_literal
    | drum_fragment_literal
    | object_expr
    | key_literal
    | int_lit
    | float_lit
    | string_lit
    | bool_lit
    | null_lit
    | percent_lit
    | pitch
    | duration
    | unit_lit
    | musical_fraction
    | ident
    | list_lit
    | record_lit
    | "(" expr ")"
    | if_expr
    | match_expr ;

argument_list =
    argument { "," argument } ;

argument =
      expr
    | ident ":" expr ;

list_lit =
    "[" [ expr { "," expr } [","] ] "]" ;

record_lit =
    "{"
        [ record_field { "," record_field } [","] ]
    "}" ;

record_field =
    ident ":" expr ;

note_fragment_literal =
    "notes" note_block ;

drum_fragment_literal =
    "drums" drum_block ;

object_expr =
    qualified_name object_block ;

object_block =
    "{"
        { field_statement }
    "}" ;

update_block =
    "{"
        [ update_field { [","] update_field } [","] ]
    "}" ;

update_field =
    ident ":" expr ;

if_expr =
    "if" expr expr_block
    [ "else" (expr_block | if_expr) ] ;

match_expr =
    "match" expr "{"
        match_arm { match_arm }
    "}" ;

match_arm =
    match_pattern [ "if" expr ] "=>" expr_or_block ;

match_pattern =
      "_"
    | literal_pattern
    | qualified_name [ ident ] ;

literal_pattern =
      int_lit
    | float_lit
    | string_lit
    | bool_lit
    | null_lit
    | pitch ;

expr_or_block =
      expr
    | expr_block ;
```

Stream-pipeline targets:

```ebnf
pipeline_target =
      stream_operator
    | postfix ;

stream_operator =
      "map" closure2
    | "filter" closure2
    | "flat_map" closure2
    | "enumerate"
    | "take" "(" expr ")"
    | "drop" "(" expr ")"
    | "merge" "(" expr ")"
    | "shift" "(" expr ")"
    | "window" "(" named_args ")"
    | "group_by_time" "(" ")"
    | "fold" "(" expr ")" closure3
    | "scan" "(" expr ")" closure3
    | "sort_within_time" closure1 ;

closure1 =
    "|" ident "|" expr_or_block ;

closure2 =
    "|" ident "," ident "|" expr_or_block ;

closure3 =
    "|" ident "," ident "," ident "|" expr_or_block ;

named_args =
    named_arg { "," named_arg } [","] ;

named_arg =
    ident ":" expr ;
```

Stream operator type/semantic contracts are §19.3。

range:

```text
a..b
```

is half-open `Range<T>` `[a,b)` unless a consuming API explicitly states inclusive semantics。
Pitch voicing range APIs explicitly use inclusive endpoints。

comparison/equality require compatible operand types。

logical operators:

```text
Bool only
left-to-right short circuit
```

Arithmetic:

```text
Int op Int -> Int where exact
Float involvement -> Float
```

division:

```text
Int / Int -> Float
```

division by zero is compile error for compile-time evaluation。

Floating-point compile-time evaluation:

```text
IEEE-754 binary64
round-to-nearest ties-to-even
```

## 62.8.1 Source identity

Compiler internal `source-id` / source node identity は同一 source tree で implementation 間一致しなければならない。

module identity:

```text
module_uri =
    project-root-relative normalized UTF-8 path
```

normalization:

```text
separator = "/"
"." removed
".." resolved without escaping project root
Unicode NFC
case preserved
```

source node ID:

```text
payload =
    Deterministic-CBOR([
        "soraoto-source-node-v1",
        module_uri,
        syntactic_kind,
        start_utf8_byte_offset,
        end_utf8_byte_offset
    ])

source_id =
    SHA-256(payload)[0..16]
```

offset は BOM除去後の UTF-8 source bytes に対する half-open byte range。

synthetic compiler node は親 source_id + deterministic child ordinal から同様に domain-separated SHA-256 で生成する。

### ExpansionPath

compile-time expansion の位置:

```text
ExpansionPath = List<UInt32>
```

各要素は外側から内側への 0-based expansion ordinal。

例:

```text
pattern repeat iteration
macro flat_map emission branch
nested generated section
```

### Macro invocation ID

```text
payload =
    Deterministic-CBOR([
        "soraoto-macro-invocation-v1",
        call_source_id_bytes,
        fully_qualified_macro_name,
        expansion_path
    ])

macro_invocation_id =
    SHA-256(payload)[0..16]
```

### Component invocation ID

source-authored Component:

```text
payload =
    Deterministic-CBOR([
        "soraoto-component-invocation-v1",
        call_source_id_bytes,
        fully_qualified_component_name,
        expansion_path
    ])

invocation_id =
    lowercase-hex(
        SHA-256(payload)[0..16]
    )
```

nested `InstantiateComponent`:

```text
payload =
    Deterministic-CBOR([
        "soraoto-nested-component-invocation-v1",
        parent_invocation_id,
        local_id
    ])

invocation_id =
    lowercase-hex(
        SHA-256(payload)[0..16]
    )
```

同一 parent invocation 内で nested component `local_id` は unique 必須。

## 62.9 Scope

scope nesting:

```text
module
  project
    section/track/bus/etc.
      local block
        closure
```

same scope duplicate symbol:

```text
compile error
```

`let` is the single immutable binding form in soraotoDSL。

```text
let NAME = expr
```

It is valid at module scope and in compile-time-capable blocks。

Semantics:

```text
immutable:
    rebinding/assignment to the same binding is forbidden

evaluation:
    compile-time

shadowing:
    inner local `let` may shadow an outer `let`

runtime mutation:
    not represented by `let`
```

There is no separate `const` keyword in Draft v0.5。


`let` is valid in:

```text
fn/macro expression blocks
notes blocks
drums blocks
```

A `let` in `notes` / `drums` is compile-time only and may bind:

```text
scalar/value
Pitch/PitchClass
EventFragment<T>
Pattern invocation result
```

Its lifetime ends at the enclosing musical block。

以下は shadow 禁止:

```text
imported component
imported plugin
track
bus
harmony/chords
project/module binding
type
```

Qualified reference は lexical scope より優先。

## 62.10 Namespace

separate type/value namespaces:

```text
Type namespace:
    struct
    enum
    built-in type

Value namespace:
    let
    fn
    pattern
    macro
    track
    bus
    chords
    component symbol
    plugin symbol
```

same namespace 同一 scope の duplicate は error。

## 62.11 Name resolution order

unqualified value:

```text
1. innermost local
2. enclosing block local
3. project declaration
4. module declaration
5. explicit import
6. standard prelude
```

ambiguous import は error。

wildcard import はない。

A `pattern` symbol referenced without `()` resolves to its compile-time `PatternFn` value。
With `()` it is invoked。

```text
let P = Beat   // alias
P()              // invocation
```

## 62.11.1 Fragment expression typing

Compile-time fragment types:

```text
EventFragment<T>
NotesFragment
DrumFragment
PerformanceFragment<T>
```

Operator:

```text
EventFragment<T> * Int
    -> EventFragment<T>

pattern symbol:
    PatternFn<Args, EventFragment<T>>

let/let alias of pattern symbol:
    same PatternFn type/signature
```

Repeat requires `Int >= 0` at compile time。

At structural Track/Section/Pattern level, a bare `EventFragment<T>` expression means splice/expand at the current destination timeline cursor。

Inside `notes {}` / `drums {}` the explicit keyword:

```text
use <fragment-expression> [* N]
```

is required。
This avoids ambiguity with ordinary Pitch/value expressions。

A bare ordinary scalar expression is **not** a legal `fragment_statement`。
Therefore:

```text
track X {
    123
}
```

is a type error rather than a no-op。

Pitch variables in `notes` are handled separately by note-event expected typing。

## 62.12 Type conversion

implicit conversion:

```text
Int -> Float
integer literal -> range-compatible typed integer
numeric literal -> target unit type only when suffix/unit semantics match
```

implicit conversion 禁止:

```text
Float -> Int
Db <-> Float
Hz <-> Float
Time <-> Float
Pitch <-> Int
Norm <-> Float
```

explicit conversion functionsを使用:

```text
float(x)
int(x, rounding: ...)
normalize(value, descriptor)
denormalize(value, descriptor)
```

## 62.13 Unit algebra

許可:

```text
same-unit + same-unit
same-unit - same-unit
unit * scalar
unit / scalar
Time * Float
Hz * Float
```

禁止:

```text
Hz + Db
Time + Hz
Db * Db
```

ratio / percent / Norm は dimensionlessだが暗黙相互変換しない。

## 62.14 Evaluation order

function arguments、list item、record field expression は source left-to-right で評価。

language is pure except compile-time deterministic component expansion。
pure language内では評価順序で結果が変わってはならないが、diagnostic/provenance ordering のため固定する。

## 62.15 Error categories

```text
LEX
PARSE
NAME
TYPE
TIME
GRAPH
COMPONENT
PLUGIN
ASSET
RENDER
LIMIT
```

diagnostic code:

```text
SORAOTO-<CATEGORY>-<4 digit number>
```

Compiler は同一 source に対して diagnostic ordering も deterministic にする。


## 62.16 Musical time representation

Compiler / Project IR の musical time は floating point ではなく reduced rational。

```text
MusicalTime {
    numerator: Int64
    denominator: UInt32
}

MusicalDuration {
    numerator: UInt64
    denominator: UInt32
}

BeatDuration = MusicalDuration
```

`MusicalDuration` / `BeatDuration` の単位は quarter-note beat。

例:

```text
quarter note = 1/1
eighth note  = 1/2
whole note   = 4/1
```


constraints:

```text
denominator > 0
gcd(abs(numerator), denominator) = 1
```

Compile-time rational arithmetic uses unbounded signed integer intermediates。

After every externally visible MusicalTime/MusicalDuration result:

```text
1. reduce by gcd
2. require:
       MusicalTime numerator fits Int64
       MusicalDuration numerator fits UInt64
       denominator fits UInt32
3. otherwise:
       compile error E_TIME_RANGE
```

No implementation may overflow/wrap intermediate fixed-width integers。

### Float/Norm -> musical-time weight

When a normative operation explicitly multiplies a musical-time quantity by `Norm`, the conversion is:

```text
Q = 16,777,216  // 2^24

q =
    round_ties_even(
        clamp(norm,0,1) * Q
    )

time_weight(norm) =
    q / Q
```

The rational is then reduced。

This is the only implicit Float/Norm-to-musical-time conversion in Draft v0.5。
Arbitrary Float cannot be added to MusicalTime。

### Deterministic random musical-time offset

For maximum non-negative `BeatDuration timing`:

```text
Q = 2^24

max_tick =
    floor(
        timing_in_beats * Q
    )

u =
    rand(seed,key)

bucket_count =
    2*max_tick + 1

tick =
    floor(u * bucket_count)
    - max_tick

offset =
    tick / Q beats
```

`offset` is a signed reduced rational and satisfies:

```text
abs(offset) <= timing
```

If `max_tick = 0`, offset is exactly zero。

quarter note:

```text
1/1
```

whole note:

```text
4/1
```

`@N` duration:

```text
4/N quarter notes
```

sample conversion at a constant-tempo segment:

```text
exact_samples =
    quarter_notes
    * 60
    / bpm
    * sample_rate
```

timeline boundary sample index は round-to-nearest ties-to-even。

Tempo ramp では tempo curve の integral を使用し、boundary error:

```text
< 0.5 sample
```

を満たす。

## 62.17 Note sequence grammar

`notes { ... }` 内は expression grammar ではなく musical-event grammar。

```ebnf
note_body =
    { note_item } ;

note_item =
      note_let
    | duration_default
    | velocity_default
    | fragment_expand
    | grouped_note_repeat
    | note_event
    | chord_event
    | retrigger
    | rest
    | sustain
    | performance_control
    | bar_commit
    | voice_block
    | tuplet_block
    | articulation_block
    | section_block ;

note_let =
    "let" ident "=" expr ;

fragment_expand =
    "use" postfix [ "*" int_lit ] ;

grouped_note_repeat =
    "(" note_body ")" "*" int_lit ;

performance_control =
    "control" qualified_name ":" expr ;

duration_default =
    duration ":" ;

velocity_default =
    "!" number ":" ;

event_prefix =
    [duration] ["!" number] ;

note_event =
    event_prefix pitch_or_relative [attribute_block] ;

pitch_or_relative =
      relative_pitch
    | postfix ;

relative_pitch =
      "+" [ int_lit ]
    | "-" [ int_lit ] ;

chord_event =
    event_prefix "[" pitch { relative_pitch } "]" [attribute_block] ;

retrigger =
    event_prefix "." ;

rest =
    event_prefix "_" ;

sustain =
    event_prefix "~" ;

bar_commit =
    "," ;

voice_block =
    "voice" ident note_block ;

tuplet_block =
    "tuplet" int_lit ":" int_lit note_block ;

articulation_block =
    "articulation" ident note_block ;

section_block =
    qualified_name note_block ;

note_block =
    "{" note_body "}" ;

attribute_block =
    "{"
        { field_statement }
    "}" ;
```

`postfix` used as a note pitch expression must type-check as `Pitch` or `PitchClass`。
`PitchClass` lifting rules are defined in §14。

### 62.17.1 Drum pattern grammar

```ebnf
drum_block =
    "{"
        { drum_item }
    "}" ;

drum_item =
      drum_let
    | duration_default
    | drum_lane
    | drum_fragment_expand
    | drum_section
    | drum_humanize ;

drum_let =
    "let" ident "=" expr ;

drum_lane =
    ident drum_lane_source [ "*" int_lit ] ;

drum_lane_source =
      string_lit
    | ident ;

drum_fragment_expand =
    "use" postfix [ "*" int_lit ] ;

drum_section =
    qualified_name drum_block ;

drum_humanize =
    "humanize" object_block ;
```

`drum_lane_source` identifier must type-check as compile-time `String`。

`drum_fragment_expand` must type-check as `DrumFragment`。
A `String` expression is not a DrumFragment and is legal only after a lane identifier。

Drum string/repeat semantics are §40。

### 62.17.2 Lyrics grammar

```ebnf
lyrics_block =
    "{"
        { lyrics_item }
    "}" ;

lyrics_item =
      lyrics_field
    | lyrics_line
    | lyrics_section ;

lyrics_field =
      "language" ":" string_lit
    | "voice" ":" (ident | string_lit)
    | "alignment" ":" ("exact" | "prefix")
    | "phoneme_alphabet" ":" string_lit ;

lyrics_line =
    string_lit ;

lyrics_section =
    qualified_name lyrics_block ;
```

`lyrics` string content is parsed by the mini-language defined in §39.8 after ordinary String escape decoding。


relative pitch:

```text
+N  +N semitone
-N  -N semitone
+   +1 semitone
-   -1 semitone
```

duration + velocity canonical prefix order:

```text
@duration !velocity event
```

Parser は互換入力として逆順を受理してはならない。

`pickup {}` は `notes` container を包む timeline construct で、note event tokenではない。

## 62.18 Chord / Key grammar

Chord timeline parser:

```ebnf
chord_timeline_block =
    "{"
        { chord_timeline_item }
    "}" ;

chord_timeline_item =
      duration_default
    | chord_timeline_event
    | bar_commit
    | chord_section ;

chord_timeline_event =
    [ duration ] chord_symbol ;

chord_section =
    qualified_name chord_timeline_block ;
```

Chord / Key tokens:

```ebnf
chord_symbol =
    chord_root [ chord_body ] [ slash_bass ] ;

chord_root =
    note_letter [ chord_accidental ] ;

note_letter =
    "A" | "B" | "C" | "D" | "E" | "F" | "G" ;

chord_accidental =
    "#" | "b" ;

slash_bass =
    "/" chord_root ;

chord_body =
    [ quality ] [ extension ] { chord_modifier } ;

quality =
    "m"
  | "min"
  | "maj"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4" ;

extension =
    "6"
  | "7"
  | "9"
  | "11"
  | "13"
  | "maj7"
  | "maj9"
  | "maj11"
  | "maj13" ;

chord_modifier =
    "add" ("2"|"4"|"6"|"9"|"11"|"13")
  | ("b"|"#") ("5"|"9"|"11"|"13") ;
```

special canonical alias:

```text
m7b5
```

は:

```text
minor + 7 + b5
```

`Cmaj7` は quality `maj` + extension `7` ではなく longest-token rule により extension `maj7` と parse。

Roman:

```ebnf
roman =
    [ chord_accidental ]
    roman_degree
    [ chord_body ]
    [ "/" roman_target ] ;

roman_degree =
      "I" | "II" | "III" | "IV" | "V" | "VI" | "VII"
    | "i" | "ii" | "iii" | "iv" | "v" | "vi" | "vii" ;

roman_target =
    [ chord_accidental ] roman_degree ;
```

Nashville:

```ebnf
nashville =
    [ chord_accidental ] ("1"|"2"|"3"|"4"|"5"|"6"|"7") [ chord_body ] ;

key_literal =
    note_letter [ chord_accidental ] "." scale_name ;

scale_name =
      "major"
    | "minor"
    | "natural_minor"
    | "harmonic_minor"
    | "melodic_minor"
    | "dorian"
    | "phrygian"
    | "lydian"
    | "mixolydian"
    | "locrian"
    | "major_pentatonic"
    | "minor_pentatonic"
    | "chromatic" ;
```

Roman/Nashville は active Key Context が必須。
Key 未定義では compile error。

## 62.19 Entry module

entry module:

```text
exactly one project declaration
```

imported `.soraoto` module:

```text
project declaration prohibited
```

circular module import:

```text
compile error
```


## 62.20 Standard curve functions

normalized `t`:

```text
0 <= t <= 1
```

```text
step(t):
    0 for t < 1
    1 at t = 1

linear(t):
    t

ease_in(t):
    t^2

ease_out(t):
    1 - (1-t)^2

ease_in_out(t):
    2*t^2                       if t < 0.5
    1 - ((-2*t + 2)^2)/2       otherwise
```

`abs(x)`:

```text
x >= 0 ? x : -x
```

preserves numeric/unit type。

`min(a,b)` / `max(a,b)`:

```text
same compatible type required
returns one operand by ordinary ordering
```

`clamp(x,lo,hi)`:

```text
lo <= hi required

min(
    max(x, lo),
    hi
)
```

All three operands must have the same compatible type/unit。

`lerp(a,b,t)`:

```text
a + (b-a) * t
```

constraints:

```text
a / b:
    same typed linear unit

t:
    Norm
```

Return type is the type of `a/b`。

Automation `curve` は上記関数を interval-local t に適用する。

custom curve は `fn(Norm)->Norm` で、pure / deterministic / finite でなければならない。

## 62.21 Chord resolution semantics

Every parsed chord resolves to the canonical §13 `Chord` structural-tone model。

### 62.21.1 Absolute root

```text
C  = 0
C# = 1
Db = 1
...
B  = 11
```

Enharmonic spelling is retained only in source AST / `Chord.symbol` provenance。

### 62.21.2 Base triad quality

Initial tones:

```text
default / maj:
    degree 1 alt  0 -> 0 st
    degree 3 alt  0 -> 4 st
    degree 5 alt  0 -> 7 st

m / min:
    degree 1 alt  0 -> 0 st
    degree 3 alt -1 -> 3 st
    degree 5 alt  0 -> 7 st

dim:
    degree 1 alt  0 -> 0 st
    degree 3 alt -1 -> 3 st
    degree 5 alt -1 -> 6 st

aug:
    degree 1 alt  0 -> 0 st
    degree 3 alt  0 -> 4 st
    degree 5 alt +1 -> 8 st

sus2:
    degree 1 alt 0 -> 0 st
    degree 2 alt 0 -> 2 st
    degree 5 alt 0 -> 7 st

sus4:
    degree 1 alt 0 -> 0 st
    degree 4 alt 0 -> 5 st
    degree 5 alt 0 -> 7 st
```

No implicit third is added to `sus2/sus4`。

### 62.21.3 Extension expansion

```text
6:
    add degree 6 alt 0

7:
    add degree 7 alt -1
    except quality=dim:
        degree 7 alt -2

maj7:
    add degree 7 alt 0

9:
    apply 7 rule
    add degree 9 alt 0

maj9:
    apply maj7
    add degree 9 alt 0

11:
    apply 9
    add degree 11 alt 0

maj11:
    apply maj9
    add degree 11 alt 0

13:
    apply 11
    add degree 13 alt 0

maj13:
    apply maj11
    add degree 13 alt 0
```

Thus:

```text
C9:
    1 3 5 b7 9

Cm11:
    1 b3 5 b7 9 11

Cdim7:
    1 b3 b5 bb7
```

### 62.21.4 `addN`

```text
add2   -> degree 2  alt 0
add4   -> degree 4  alt 0
add6   -> degree 6  alt 0
add9   -> degree 9  alt 0
add11  -> degree 11 alt 0
add13  -> degree 13 alt 0
```

`addN` does not imply any lower extension。

Example:

```text
Cadd9:
    1 3 5 9
```

### 62.21.5 Alteration modifiers

Supported:

```text
b5  #5
b9  #9
b11 #11
b13 #13
```

Algorithm for modifier on structural degree `D`:

```text
1. remove an unaltered tone (D, alteration=0) if present
2. retain already-present other altered variants of D
3. add:
       bD -> alteration -1
       #D -> alteration +1
4. exact duplicate structural tone is canonicalized away
```

Therefore:

```text
C7#9:
    1 3 5 b7 #9

C7b9#9:
    1 3 5 b7 b9 #9
```

### 62.21.6 `m7b5`

Special canonical alias:

```text
m7b5
```

is exactly:

```text
quality = min
extension = 7
modifier = b5
```

producing:

```text
1 b3 b5 b7
```

### 62.21.7 Slash bass

Absolute chord:

```text
G/B
```

resolves:

```text
root = G
bass = B
```

Slash bass does not add/remove structural tones。

If bass pitch class is not a chord tone, it remains a valid non-chord bass。

### 62.21.8 Canonical structural tones

After quality/extension/modifier processing:

```text
sort tones according to §13 canonical ordering
remove exact structural duplicates
derive pitch_class_mask from tones
```

Do **not** collapse two different structural degrees merely because they share a pitch class。

Example:

```text
Cadd2add9
```

can retain both:

```text
degree 2 -> D
degree 9 -> D
```

while the pitch-class mask contains D only once。

### 62.21.9 Roman numeral resolution

Roman/Nashville require an active `KeyContextV1` whose scale contains exactly 7 ordered pitch classes。

Ordered scale intervals:

```text
take all set bits from KeyContextV1.scale_mask
in ascending semitone order from tonic
```

There must be exactly 7。

Roman root:

```text
I/i     -> scale degree 1
II/ii   -> degree 2
...
VII/vii -> degree 7
```

Root accidental before numeral:

```text
b -> -1 semitone
# -> +1 semitone
```

Default Roman quality when no explicit quality exists:

```text
uppercase numeral -> major triad
lowercase numeral -> minor triad
```

An explicit `quality` token overrides numeral case。

Extension/modifier processing then follows §§62.21.3–62.21.5。

### 62.21.10 Secondary Roman function

Example:

```text
V/vi
```

`roman_target` first resolves in the active KeyContext。

A temporary **major** 7-note scale is constructed on that target tonic。

The left Roman numeral then resolves against that temporary major scale。

Example in C major:

```text
vi = A
V/vi = E major
```

Accidental on the target is applied before construction of the temporary major scale。

Nested secondary syntax such as:

```text
V/V/ii
```

is not part of Draft v0.5 grammar and is a parse error。

### 62.21.11 Nashville resolution

```text
1 .. 7
```

maps to active KeyContextV1 ordered scale degree。

Root accidental:

```text
b -> -1 semitone
# -> +1 semitone
```

If no explicit chord quality is written, Nashville triad quality is derived diatonically from scale degrees:

```text
root = degree N
third = degree N+2
fifth = degree N+4

indices wrap modulo 7
octave is raised as required to preserve ascending interval order
```

The resulting third/fifth semitone intervals determine canonical structural alterations relative to degrees 3/5。

Example in C major:

```text
1  -> C major
2  -> D minor
5  -> G major
6  -> A minor
7  -> B diminished
```

Explicit quality overrides this inferred diatonic triad。

### 62.21.12 Structural helper availability

A Chord imported from an external pitch-set-only format may contain `ChordToneV1.degree=null`。

For such a chord:

```text
tone(ctx,n):
    available

third/fifth/seventh/ninth:
    available only if an exact structural degree is known

pitch_class_mask:
    always available
```

No degree is guessed from pitch class alone。
---

---

---

---

# 63. Canonical Performance IR

Instrument Performance Compiler の出力 schema をここで固定する。

## 63.1 Common header

All physical/musical performance events use:

```text
PerformanceEventHeader {
    event_id: EventId128

    start: MusicalTime
    duration: MusicalDuration

    voice_id: UInt32

    articulation: String?

    velocity: Velocity
    expression: Expression

    provenance: Provenance
}
```

rules:

```text
duration >= 0
voice_id:
    0-based logical voice identity within the owning Track

articulation:
    semantic articulation ID
    UTF-8 NFC
    standard or vendor:<reverse-dns-id>:<name>

velocity:
    0..1

expression:
    0..1
```

`articulation` is Plugin-independent.
Runtime lowering maps it to a target Plugin `ArticulationDescriptor.semantic_id` and then numeric `articulation_id`.

## 63.2 Note-local curves

Continuous per-note curves use normalized note-relative time rather than project MusicalTime.

```text
NoteCurve<T> {
    points: List<NoteCurvePoint<T>>
}

NoteCurvePoint<T> {
    at: Norm
    value: T

    interpolation:
        step
        linear
        ease_in
        ease_out
        ease_in_out
}
```

rules:

```text
points sorted by at
0 <= at <= 1
same-time duplicate:
    later authored point wins

at = 0:
    note start

at = 1:
    note end
```

An empty `NoteCurve` is invalid where a curve is present.

## 63.3 NotePerformance

```text
NotePerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    pressure: Norm?
    timbre: Norm?
    pan: Pan?

    pitch_curve: NoteCurve<Semitone>?
}
```

`pitch_curve.value` is signed semitone offset from `pitch`.

## 63.4 GuitarPerformance

```text
GuitarPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    string: UInt8
    fret: UInt16

    technique:
        normal
        hammer
        pull
        slide
        bend
        vibrato
        mute
        palm_mute
        harmonic
        dead_note

    bend_curve: NoteCurve<Semitone>?
}
```

constraints:

```text
string >= 1
fret >= 0

technique = bend:
    bend_curve recommended

other technique:
    bend_curve may still express continuous pitch motion
```

String tuning / fret-to-pitch consistency belongs to the active Guitar Performance Compiler model; inconsistent authored explicit values are compile error.

## 63.5 BassPerformance

```text
BassPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    string: UInt8
    fret: UInt16

    technique:
        finger
        pick
        slap
        pop
        mute
        harmonic
        slide

    pitch_curve: NoteCurve<Semitone>?
}
```

`string >= 1`.

## 63.6 BowedStringPerformance

```text
BowedStringPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    string: UInt8
    position: UInt8?
    finger: UInt8?

    bow_direction:
        up
        down
        none

    bow_pressure: Norm?
    bow_speed: Norm?
    vibrato: Norm?

    pitch_curve: NoteCurve<Semitone>?
}
```

`position` / `finger` are instrument-model-specific ordinal values.
`none` bow direction means no explicit authored direction.

## 63.7 HarpPerformance

```text
HarpPedalStateV1 {
    pitch_class: PitchClass

    accidental:
        flat
        natural
        sharp
}

HarpPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    string_index: UInt16?

    pedals: List<HarpPedalStateV1>

    technique:
        normal
        harmonic
        pres_de_la_table
        etouffe
        gliss
}
```

`pedals`:

```text
sorted by pitch_class
no duplicate pitch_class
0..7 entries
```

A full concert-pedal state normally has entries for:

```text
C D E F G A B
```

Partial lists mean unspecified pedals inherit the current instrument pedal state.

## 63.8 AccordionPerformance

```text
AccordionPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    manual:
        right
        left_bass
        left_chord

    bellows_direction:
        push
        pull
        unspecified

    bellows_pressure: Norm?
}
```

## 63.9 OrganPerformance

```text
OrganPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    manual: String
    stops: List<String>
}
```

`manual` / `stops` are UTF-8 NFC semantic names.
`stops` are sorted in authored order and contain no exact duplicate names.

## 63.10 PedalSteelPerformance

```text
PedalSteelPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    string: UInt8
    fret: UInt16

    active_pedals: List<String>
    active_knee_levers: List<String>

    pitch_curve: NoteCurve<Semitone>?
}
```

Pedal/lever names are semantic UTF-8 NFC IDs defined by the active instrument model.
Bitmask numbering is intentionally not used because physical copedents differ.

## 63.11 WindPerformance

```text
WindPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    breath: Norm?

    tonguing:
        none
        soft
        normal
        hard
        double
        triple

    growl: Norm?
    flutter: Norm?

    pitch_curve: NoteCurve<Semitone>?
}
```

## 63.12 PianoPerformance

```text
PianoPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    finger: UInt8?

    sustain: Norm?
    sostenuto: Norm?
    una_corda: Norm?

    half_pedal: Norm?
}
```

If `finger` is present:

```text
1..5
```

Pedal values are `0..1`.

## 63.13 VocalPerformance / Lyric IR

```text
VocalPhonemeV1 {
    phoneme: String

    start: Norm
    end: Norm
}

VocalLyricV1 {
    lyric_unit_id: EventId128

    surface: String
    reading: String
    language: String

    word_boundary_after: Bool

    phrase_start: Bool
    phrase_end: Bool

    melisma_index: UInt16
    melisma_count: UInt16
}

VocalPerformance {
    header: PerformanceEventHeader

    pitch: Pitch

    lyric: VocalLyricV1?

    phoneme_alphabet: String?
    phonemes: List<VocalPhonemeV1>

    pitch_curve: NoteCurve<Semitone>?

    breath: Norm?
    vibrato: Norm?
}
```

### Lyric identity

`lyric_unit_id` is generated from:

```text
lyrics source span
target vocal voice identity
target section/range identity
normal lyric-unit ordinal
```

using §19 EventId rules。

All notes of one melisma share exactly the same `lyric_unit_id`。

A chord source lyric slot also shares one `lyric_unit_id` across all simultaneous pitches generated from that source chord。

### Lyric text

```text
surface:
    UTF-8 NFC display fragment
    may be empty only when reading is non-empty

reading:
    UTF-8 NFC pronunciation source
    must be non-empty

language:
    canonical BCP 47 tag or "und"
```

When a source normal token has no explicit reading:

```text
reading = surface
```

A lyric unit with both empty surface and empty reading is invalid。

### Boundary flags

```text
word_boundary_after:
    `/` follows the unit

phrase_start:
    unit begins after a phrase boundary or selection start

phrase_end:
    `|` follows the unit or selection explicitly ends phrase
```

These flags are metadata; they do not alter note duration/timing。

### Melisma

```text
melisma_count >= 1
0 <= melisma_index < melisma_count
```

Non-melismatic unit:

```text
melisma_index = 0
melisma_count = 1
```

For a three-note melisma:

```text
0/3
1/3
2/3
```

Only the `melisma_index=0` event should normally draw the display surface in a lyric renderer; later notes use the shared `lyric_unit_id` for continuation/highlighting。

### Phonemes

phoneme rules:

```text
phoneme:
    UTF-8 NFC
    non-empty

0 <= start <= end <= 1

sorted by:
    start
    end
    phoneme UTF-8 bytes

no overlap
```

`start/end` are note-relative normalized time。

Empty phoneme list:

```text
no explicit phoneme override
```

not an error by itself。

`phoneme_alphabet`:

```text
null:
    permitted only when phonemes empty

"ipa":
    canonical generic alphabet

vendor:<reverse-dns-id>:<alphabet>:
    target-specific alphabet
```

When phonemes are non-empty and source did not specify an alphabet:

```text
phoneme_alphabet = "ipa"
```

The target Vocal Performance Compiler / Adapter validates that it accepts the chosen alphabet。

### Low-level note attributes

Source:

```text
lyric: "hello"
reading: "hello"
```

creates a one-note `VocalLyricV1`:

```text
melisma_index = 0
melisma_count = 1
```

with deterministic unit ID from the note source identity。

Dedicated `lyrics {}` alignment (§39.8) is preferred for multi-note songs because it keeps text independent from melody edits。

### Realtime vocal lowering

When the destination EventBus selects:

```text
soraoto-vocal-v1
```

each `VocalPerformance` lowers:

```text
note start:
    NOTE_ON

same sample, if lyric != null:
    VOCAL_LYRIC

phoneme start samples, for each explicit phoneme:
    VOCAL_PHONEME

note end:
    NOTE_OFF
```

`VOCAL_LYRIC` fields are copied losslessly from `VocalLyricV1`。
`lyric_unit_id` is mapped to realtime `lyric_group_id` by the collision-free Host session table in §29.6。

Each explicit `VocalPhonemeV1` becomes one `VOCAL_PHONEME` event using the note's `event_id`。

If `phonemes = []`, no `VOCAL_PHONEME` event is generated。

A target that does not support `soraoto-vocal-v1` requires an explicit Vocal External Adapter。
There is no implicit fallback that drops reading/language/word/phrase/melisma/phoneme timing semantics。

Low-level one-note lyric defaults:

```text
surface =
    source lyric
    or "" when only reading is present

reading =
    source reading
    or source lyric when reading absent

language =
    VocalPerformanceConfigV1.language

word_boundary_after = false
phrase_start = false
phrase_end = false

melisma_index = 0
melisma_count = 1
```

If both `lyric` and `reading` are absent:

```text
VocalPerformance.lyric = null
```

## 63.14 DrumPerformance

```text
DrumPerformance {
    header: PerformanceEventHeader

    voice: String

    pitch: Pitch?

    hit:
        normal
        accent
        ghost
        open
        closed
        choke

    hand:
        left
        right
        unspecified
}
```

`voice` is the semantic drum voice from §40.4.

`pitch` is optional:
- semantic drum kits may resolve only by `voice`;
- pitched percussion may set an explicit Pitch.

The Drum DSL `r` (roll) and `f` (flam) are expanded by §40 into multiple `DrumPerformance` events; they are not separate runtime hit kinds.

## 63.15 ControlPerformance

```text
ControlPerformance {
    event_id: EventId128
    start: MusicalTime

    voice_id: UInt32?

    target: String
    value: Value

    provenance: Provenance
}
```

`ControlPerformance` is instantaneous and therefore has no duration/velocity/expression header。

`voice_id = null` means track-global control。
A numeric voice_id means voice-local control。

`target` is a semantic instrument/performance control path, not a Plugin Parameter ID.

Example:

```text
bow.position
organ.expression
vocal.formant
```

Target-specific Performance Compiler / Adapter validates the value type.

## 63.16 Performance event type identity

`PerformanceEvent` is not encoded as an untagged in-record union.

When crossing Component / Clipboard / Project interchange boundaries it uses `TypedIRValueV1.type`.

Canonical type names:

```text
soraoto.performance.NotePerformance@1
soraoto.performance.GuitarPerformance@1
soraoto.performance.BassPerformance@1
soraoto.performance.BowedStringPerformance@1
soraoto.performance.HarpPerformance@1
soraoto.performance.AccordionPerformance@1
soraoto.performance.OrganPerformance@1
soraoto.performance.PedalSteelPerformance@1
soraoto.performance.WindPerformance@1
soraoto.performance.PianoPerformance@1
soraoto.performance.VocalPerformance@1
soraoto.performance.DrumPerformance@1
soraoto.performance.ControlPerformance@1
```

Unknown `soraoto.performance.*` major version is interchange validation error.

## 63.17 Provenance

生成イベント/Performance IR は編集・Detach・再生成判定のため provenance を保持する。

```text
Provenance {
    sources: List<SourceSpanV1>
    generated_by: List<GenerationStepV1>
    detached: Bool
}

SourceSpanV1 {
    module_uri: String
    start_utf8_byte: UInt64
    end_utf8_byte: UInt64
}

GenerationStepV1 {
    kind:
        pattern
        macro
        component
        performance_compiler
        standard_lowering

    definition: String

    invocation_id:
        String | null
}
```

canonical order:

```text
sources:
    sort by (
        module_uri UTF-8 byte lexicographic,
        start_utf8_byte,
        end_utf8_byte
    )
    exact duplicate removed

generated_by:
    outermost -> innermost generation step
```

validation:

```text
module_uri:
    §62.8.1 normalized module identity

start_utf8_byte <= end_utf8_byte

macro invocation_id:
    EventId128 hex display form (32 lowercase hex)

component invocation_id:
    §62.8.1 component invocation id (32 lowercase hex)

pattern/performance_compiler/standard_lowering:
    null permitted when no invocation identity exists
```

`detached=false`:

```text
dependency/provenance link is live
```

`detached=true`:

```text
event is an authored independent copy
automatic upstream regeneration must not overwrite it
```

Detach operation sets `detached=true` and preserves `sources/generated_by` as historical provenance.

## 63.18 Generic Curve IR

```text
Curve<T> {
    points: List<CurvePoint<T>>
}

CurvePoint<T> {
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

constraints:

```text
points sorted by `at`
duplicate `at` canonicalized with later authored point winning
empty Curve invalid where a value is required
```

For note-local curve where domain is note-relative, `at` is represented as `Norm` instead and the containing schema states that explicitly.

## 63.19 Canonical Event IR

`Notes = Stream<NoteEvent>`:

```text
NoteEvent {
    id: EventId128
    at: MusicalTime
    duration: MusicalDuration

    pitch: Pitch
    velocity: Velocity

    articulation: String?
    expression: Map<String, Value>

    provenance: Provenance
}
```

`NoteEvent.articulation` uses the same semantic ID rules as `PerformanceEventHeader.articulation`。
It is mapped to Plugin numeric articulation only at runtime binding。

`Chords = Stream<ChordEvent>`:

```text
ChordEvent {
    id: EventId128
    at: MusicalTime
    duration: MusicalDuration

    chord: Chord

    provenance: Provenance
}
```

Chord pitch-class and structural-degree semantics are §13。

`ScaleEvent`:

```text
ScaleEvent {
    id: EventId128
    at: MusicalTime
    duration: MusicalDuration

    root: PitchClass
    pitch_class_mask: UInt16
    name: String?

    provenance: Provenance
}
```

`AutomationEvent<T>`:

```text
AutomationEvent<T> {
    id: EventId128
    at: MusicalTime
    value: T

    interpolation:
        step
        linear
        ease_in
        ease_out
        ease_in_out

    provenance: Provenance
}
```

`PitchClass` canonical numeric value:

```text
C=0 C#=1 D=2 D#=3 E=4 F=5
F#=6 G=7 G#=8 A=9 A#=10 B=11
```

Enharmonic spellingは source AST/provenance に保持する。


---

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

---

# 66. Clipboard / Drag-and-Drop Interchange

Plugin GUI is out of scope, but musical/media clipboard interchange is a non-GUI data contract。

Native soraoto format:

```text
MIME:
    application/vnd.soraotodsl.clipboard+cbor;version=1

encoding:
    Soraoto Deterministic CBOR Profile 1
```

## 66.1 SoraotoClipboardV1

```text
SoraotoClipboardV1 {
    format: UInt32 = 1

    origin: ClipboardOriginV1

    items: List<ClipboardItemV1>

    extensions: Map<String, Value> = {}
}

ClipboardOriginV1 {
    source_app: String?

    project_id: String?
    project_sample: Int64?
    beat_position: Float64?

    color_rgba: UInt32?
}
```

`color_rgba` packing:

```text
0xRRGGBBAA
```

At least one item is required。

## 66.2 ClipboardItemV1

Closed tagged union:

```text
ClipboardItemV1 =
    AudioClipboardItemV1
  | NotesClipboardItemV1
  | ChordsClipboardItemV1
  | ScaleClipboardItemV1
  | SignatureClipboardItemV1
  | ClipClipboardItemV1
```

Audio:

```text
AudioClipboardItemV1 {
    kind: "audio"

    asset: AssetRef

    source_start: Time
    source_end: Time

    project_position:
        MusicalTime | null

    name: String?
    color_rgba: UInt32?
}
```

constraints:

```text
0 <= source_start < source_end
```

Notes:

```text
NotesClipboardItemV1 {
    kind: "notes"
    events: List<NotePerformance>
}
```

Chords:

```text
ChordsClipboardItemV1 {
    kind: "chords"
    events: List<ChordEvent>
}
```

Scale:

```text
ScaleClipboardItemV1 {
    kind: "scale"
    event: ScaleEvent
}
```

Signature:

```text
SignatureClipboardItemV1 {
    kind: "signature"

    at: MusicalTime
    meter: Meter
}
```

Clip:

```text
ClipClipboardItemV1 {
    kind: "clip"
    clip: AudioClip
}
```

## 66.3 Clipboard asset rule

Native soraoto clipboard does not embed arbitrary audio bytes。

It contains `AssetRef`。
Sender should additionally expose referenced file bytes through OS drag/drop file transfer or Host-managed content-addressed asset transfer。

Import succeeds only when receiver resolves bytes matching `AssetRef.sha256`。
Filename-only relink is forbidden。

## 66.4 Clipboard VST-XML bridge scope

The Host External VST3 Adapter recognizes Clipboard VST-XML structure compatible with published `VST-XML-1.4.dtd`:

```text
sourceApp
region
segment
loop
chord
scale
signature
```

Recognized project-time domains:

```text
quarterNotes
seconds
```

Native soraoto WASM Plugin ABI does not require an XML parser。

## 66.5 Raw round-trip preservation

On VST-XML import the Host stores exact imported UTF-8 XML bytes:

```text
extensions[
  "x-vst3-clipboard-xml-raw"
] =
    Value.Bytes(exact_input_bytes)
```

after the XML passes:

```text
well-formed XML
security restrictions
recognized vst-xml root
resource limits
```

If exported back to VST-XML without semantic modification:

```text
emit exact original XML bytes
```

If semantic items are modified:

```text
regenerate VST-XML from the mapping below
```

Unknown raw-only fields may then be dropped; Host emits a non-fatal conversion diagnostic listing dropped element/attribute names。

## 66.6 XML security profile

```text
external entity resolution:
    disabled

network:
    disabled

external DTD fetch:
    disabled

DOCTYPE internal entity declaration:
    rejected

maximum XML payload:
    16 MiB

maximum element depth:
    64

maximum element count:
    1,000,000

text encoding:
    UTF-8
```

No filesystem/network lookup is performed while parsing clipboard XML。

## 66.7 sourceApp

Import:

```text
<sourceApp>NAME</sourceApp>
    ->
origin.source_app = NFC(NAME)
```

Export uses `origin.source_app`, or `HostInfoV1.name` when absent。

## 66.8 projectTime

Quarter-note domain:

```text
<projectTime domain="quarterNotes">Q</projectTime>
```

maps to exact rational quarter-note beats。

Decimal text is parsed as base-10 rational before reduction。

Example:

```text
"16.5" -> 33/2 beats
```

Seconds domain:

```text
<projectTime domain="seconds">S</projectTime>
```

maps using inverse Project Tempo Map:

```text
seconds from project origin
    -> MusicalTime
```

Inverse error bound:

```text
<= 0.25 project sample
```

If Project tempo context is unavailable, seconds position remains only in raw sidecar and semantic musical position is null/unavailable。

Export prefers `quarterNotes` when MusicalTime is known。

## 66.9 color

Input:

```text
#RRGGBBAA
```

maps to UInt32 `0xRRGGBBAA`。
Hex input is case-insensitive; output uses lowercase hex digits after `#`。

Invalid color produces a conversion diagnostic and is preserved only in raw sidecar。

## 66.10 region

Recognized region data:

```text
id
type?
channelID?

filename
start
end

name?
tempo?
rootkey?
projectTime?
color?
loop*
segment*
signature?
```

### Plain region

When:

```text
type absent
segment list empty
```

Host resolves `filename` to an audio asset。

After source metadata is known:

```text
source_start =
    start / asset.sample_rate

source_end =
    end / asset.sample_rate
```

with:

```text
start >= 0
end > start
```

Result:

```text
AudioClipboardItemV1
```

`id`, `channelID`, `tempo`, `rootkey`, local signature, loops and original numeric text remain available in raw sidecar。

### Joined segments

For:

```text
type="join"
or
non-empty segment list
```

segments are interpreted in XML order。

Each segment:

```text
filename
start
length
fileOffset?
```

must resolve to an asset/source span。

When representable directly, Host builds a `ClipClipboardItemV1`。
If an exact single AudioClip representation would lose segment/join semantics, Host stores deterministic extension:

```text
"x-soraoto-compound-audio-v1"
```

value schema:

```text
CompoundAudioV1 {
    segments: List<CompoundAudioSegmentV1>
}

CompoundAudioSegmentV1 =
    {
        "kind": "audio",
        "asset": AssetRef,
        "source_start_frame": UInt64,
        "length_frames": UInt64,
        "destination_offset_frames": UInt64
    }
  | {
        "kind": "silence",
        "length_frames": UInt64,
        "destination_offset_frames": UInt64
    }
```

Segments are sorted by `destination_offset_frames`。
Overlap is allowed only when the VST source payload explicitly represents overlap; otherwise overlap is conversion error。

The raw XML sidecar is preserved。
No segment is silently omitted。

### Silence

```text
type="silence"
```

maps to explicit silence clip duration, not a missing asset。

## 66.11 loop

Normal VST loop maps to AudioClip `LoopSpec` when directly representable。

```text
<loop type="release">
```

has no direct AudioClip LoopSpec v1 semantic。
It is preserved as:

```text
"x-vst3-release-loop"
```

with:

```text
VstReleaseLoopV1 {
    start_frame: UInt64
    end_frame: UInt64
}
```

constraints:

```text
start_frame < end_frame
```

The raw XML is also preserved and the loop is regenerated when this extension remains present。

## 66.12 chord

Recognized:

```text
id
keyNote
pitches
mask

name?
projectTime?
bassNote?
color?
```

Mapping:

```text
root =
    keyNote mod 12

bass =
    bassNote mod 12
    or root when absent
```

`pitches` is parsed as the semicolon-separated VST pitch list。
Canonical `pitch_class_mask` derives from parsed pitches modulo 12。

VST chord `mask` uses the VST Chord mask convention:

```text
bit 0  = minor 2nd above keyNote
bit 1  = major 2nd
bit 2  = minor 3rd
bit 3  = major 3rd
bit 4  = perfect 4th
bit 5  = tritone
bit 6  = perfect 5th
bit 7  = minor 6th
bit 8  = major 6th
bit 9  = minor 7th
bit 10 = major 7th
bit 11 = octave/reserved by soraoto conversion
```

The chord key/root itself is inherent and is not represented by a VST chord-mask bit。

When deriving soraoto pitch classes from VST mask:

```text
soraoto_mask =
    bit(root_pitch_class)
    OR
    for every VST bit i in 0..10:
        if bit i set:
            set pitch class
                (root_pitch_class + i + 1) mod 12
```

VST bits outside `0x0fff` are rejected。

If both `pitches` and `mask` are present, their derived pitch-class sets must agree。
Mismatch is conversion error and raw XML is preserved for diagnostic/re-export。

Structural `Chord` construction:

```text
1. derive root, bass and absolute pitch-class set
2. if `name` parses as an absolute §62.18 chord symbol
   AND parsed root/bass/pitch-class mask agree with imported data:
       use the parsed structural Chord.tones
3. otherwise:
       root tone:
           degree=1, alteration=0, semitones=0

       every other imported pitch class pc:
           degree=null
           alteration=null
           semitones=(pc-root) mod 12
4. canonicalize tones by §13
5. set Chord.symbol = name when present
```

No structural degree is guessed merely from a pitch-class interval。

`projectTime` -> `ChordEvent.at`。

Imported chord duration:

```text
until next imported chord onset
```

Final chord:

```text
duration = 0
```

unless destination selection/region end provides an explicit end。

Original `id/mask/color/pitches` remain in raw sidecar。

## 66.13 scale

Recognized:

```text
id
mask
keyNote

name?
displayName?
projectTime?
color?
```

Mapping:

```text
ScaleEvent.root =
    keyNote mod 12
```

VST scale `mask` is a 12-bit pitch-class-offset mask relative to `keyNote`:

```text
bit 0  = unison/root
bit 1  = minor 2nd
bit 2  = major 2nd
...
bit 11 = major 7th
```

Conversion:

```text
for every set bit i in 0..11:
    set soraoto pitch class
        (root_pitch_class + i) mod 12
```

Mask must satisfy:

```text
0 <= mask <= 0x0fff
bit 0 set
```

otherwise conversion error。

`displayName` is preferred for human display; original fields remain in raw sidecar。

## 66.14 signature

```text
numerator
denominator
projectTime?
```

maps to the §66.2 `SignatureClipboardItemV1`:

```text
kind  = "signature"

at =
    converted projectTime
    or clipboard selection origin

meter =
    numerator / denominator
```

Meter validation follows §4 / §33。

## 66.15 Regenerated VST-XML

When semantic data changed, exporter writes Clipboard VST-XML version `1.4`。

Ordering:

```text
sourceApp first

then semantic items by:
    project position
    item-kind priority
    stable item/Event ID
```

kind priority:

```text
signature
scale
chord
audio/clip
```

Within each element, child order follows VST-XML-1.4 structure。

XML 1.0 escaping is used。
No external/network reference is emitted。

## 66.16 Bridge conformance fixtures

Mandatory fixtures:

```text
plain audio region
two channelID regions
joined segments
normal loop
release loop
four chords
two scales
signature
quarterNotes projectTime
seconds projectTime
RGBA color
unknown extra metadata
malformed XML
entity-expansion attack
```

Known semantic fields must survive:

```text
VST-XML
 -> SoraotoClipboardV1
 -> regenerated VST-XML
 -> semantic comparison
```

Unmodified payload round-trip is byte-identical via raw preservation。

---

---

---

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
