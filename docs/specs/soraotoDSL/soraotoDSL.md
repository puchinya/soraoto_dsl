# soraotoDSL Specification

**Version:** Draft v0.5  
**Status:** Interoperability-complete normative design draft  
**Semantic-drift policy:** single-owner semantics (§60.0)  
**Component ABI:** `soraoto:component@1.0.0`  
**WASM Plugin ABI:** `1.0`  
**VST functional target:** `VST 3.8.1 non-GUI`

soraotoDSL は作曲・アレンジ・演奏表現・歌詞・DAW構造・オートメーション・
compile-time Component・realtime/offline WASM Plugin を同一Project IRへ統合するDSL。

## Source of truth

通常の編集・参照ではこのrootと `spec/*.md` を使用する。
このrootと `spec/*.md` が完全なauthoritative normative sourceであり、意味論の編集は
担当するsplit moduleへ行う。統合snapshotは管理しない。

Semantic ownershipは§60.0に従う。
同じ型signature/schema/意味論を複数のnormative章で再定義しない。

## Modules

| File | Scope | Sections |
|---|---|---|
| `spec/01-language.md` | Core DSL / Harmony / Fragment / Pattern / Macro / grammar | §4–19, §55, §62 |
| `spec/02-component.md` | JS/WASM compile-time Component | §20–21 |
| `spec/03-plugin-model.md` | Plugin package / descriptor / control / parameter / lifecycle / Plugin Interface Source (`soraoto.interface`) | §22–28 |
| `spec/04-realtime-abi.md` | realtime ABI / vocal events / Deterministic CBOR | §29, §61 |
| `spec/05-plugin-services.md` | state / adapters / compatibility / consistency registry | §30–31, §49–50, §59–60 |
| `spec/06-project-audio.md` | Project / routing / automation / rendering / DSP | §32–34, §41–48, §51–54, §64–65 |
| `spec/07-performance.md` | instrument Performance / Lyrics / Drum / Performance IR | §35–40, §63 |
| `spec/08-interchange.md` | clipboard / VST-XML bridge | §66 |
| `spec/09-conformance.md` | validator / interoperability / completeness inventory | §67–68 |
| `examples/soraotoDSL-example.md` | examples / quick reference / role navigation | §56–58 |

## Maintenance

関連するconformance sectionと内部Markdown link/pathを確認する。repository内にspec validatorが
存在する場合のみ実行する。不存在のtoolをあるものとして前提にせず、統合snapshotも生成しない。

## Normative priority

```text
1. explicit wire/binary schema
2. formal grammar / typed IR schema
3. owning normative semantic rule (§60.0)
4. cross-cutting normative constraint
5. explanatory prose
6. non-normative example
```

同優先度で矛盾した場合は仕様エラーであり、実装自由度ではない。

---

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
