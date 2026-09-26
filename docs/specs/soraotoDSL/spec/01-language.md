# Language / Core DSL

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

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
