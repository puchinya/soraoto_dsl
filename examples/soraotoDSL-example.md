# Examples / Quick Reference

**soraotoDSL:** Draft v0.5  
**Status:** Non-normative examples  
**Root:** `../soraotoDSL.md`

章番号は全仕様で共有し、`§N.M`参照はファイル境界を越えて有効。

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
