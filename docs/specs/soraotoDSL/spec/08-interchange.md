# Clipboard / Drag-and-Drop Interchange

**soraotoDSL:** Draft v0.5  
**Status:** Normative  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

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
