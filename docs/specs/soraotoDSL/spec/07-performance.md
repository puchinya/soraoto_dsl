# Instrument Performance / Lyrics

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

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
