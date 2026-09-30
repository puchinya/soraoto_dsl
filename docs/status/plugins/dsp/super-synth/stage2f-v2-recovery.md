# Stage2F v2 回復可能seed再評価

**状態:** `BLOCKED_ANCHORED_LOCAL_FEASIBILITY`。Issue #7 は `phase:implementation` と `blocked` を維持する。

## 結果

v1の3音響アンカーを変更・再レンダーせずに再利用し、Stage2F v2の限定例外でseed資格だけを判定し直した。strictなStage2Eの32制約と通常のtail2閾値は変更していない。`RECOVERABLE_SEED`は候補PASSやfeasible扱いではない。

| Anchor | v1 release tail2 RMS | 下限0.00015に対する不足 | v2 seed資格 |
|---|---:|---:|---|
| `split-v3-s2-0001` | 0.00014547529112144994 | 3.0165% | RECOVERABLE_SEED |
| `split-v3-s2-0015` | 0.0001434909772116056 | 4.3393% | RECOVERABLE_SEED |
| `split-v3-s2-0016` | 0.00014380312907748692 | 4.1312% | RECOVERABLE_SEED |

3アンカーそれぞれについてL1–L7をproduction SIMDで評価した。既存3回と合わせて累積24回/25回のphysical render予算を使用した。追加の1回は未使用。v2では21/21候補が全32制約を含むcomplete測定として保存され、feasible候補は0件だった。

| Anchor | pitch制約 | post-attack | dynamic span | brightness direction | direct level | release tail2 |
|---|---|---|---|---|---|---|---|
| `split-v3-s2-0001` | FAIL | FAIL | 一部PASS | 一部PASS | 一部PASS | PASS | 
| `split-v3-s2-0015` | PASS | FAIL | FAIL | PASS | 一部PASS | PASS |
| `split-v3-s2-0016` | PASS | FAIL | FAIL | PASS | 一部PASS | PASS |

制約別のPareto結果は `POST_ATTACK_STILL_UNRESOLVED`。全21候補が `post_attack_shape_violation_db` を超えた。0001系列はpitch違反、各系列の一部ではbuzz違反も残った。Stage2E strict feasibilityは全候補で不成立である。

## 安全性と検証

- 最高peak: −6.535 dBFS。guard hits: 0。全候補finite。
- worst valid pitch error: 53.589 cents (`split-v3-s2-0001-L3`)。0015/0016系列のworstは約10.6 cents。
- 最大low-register buzz: 0.123797。0.12の上限を超えるセルが残る。
- Stage2後tail2 RMS: 0.000200762–0.000591341。全候補がstrict tail2を満たすが、これは他の制約FAILを相殺しない。
- Stage 3 (480 cells) / Stage 4 (1,408 lifecycle + 1,392 adjacent) はfeasible候補がないため未実行。
- WASM build、Python tuning tests 61件、Stage2F dry-run、pitch estimator/window tests、termination-floor overlay、board-fit、soundboard diagnostic transparency、concert-grand regression: PASS。
- Full CTest、Web Player tests/build、Stage 3/4、browser/device listening: 今回は未実行。

## Evidence / delivery

- v1 manifest SHA-256: `17a8a88df8b8644bfb497808383c910478544e5939c03a44688f775a420d43e6`
- v2 manifest SHA-256: `ec9aecc61d0250d2326b6cb6ea24b64cbd5a47364a221d1d5b9966b452a812be`
- Private per-candidate JSON retains all 32 constraint values, metric provenance, and production-SIMD build hashes under `.agent-state/issues/7/calibration-optuna/stage2f-v2/`.
- No Stage2F candidate altered DSP, preset, ABI, version, soundboard, or master gain.

この結果は、試した7点局所設計では厳格な全制約を満たす候補が見つからなかったことを示す。Stage3/4や親Issue #7のacceptance完了を意味しない。

## 残差帰属診断 — 実装チェックリスト

この診断は既存21結果JSONのread-only再集計のみ行い、新規レンダーを行わない。値の不一致、evidence欠損、identity不整合時は診断をBLOCKし、部分的な数値を確定結果として扱わない。

- [x] 最新Issue/PR、spec→design→code→statusを確認。
- [x] 21件のidentityと32制約を検査。入力SHA不変、新render 0。
- [x] セル別EARLY/LATE、最大違反、pitch×velocityを記録。
- [x] 同条件の3軸差分とdynamic-span等の競合を数値検証。
- [x] aggregate二重計上なし。全既存閾値不変。
- [x] 合成テストで算術/境界/欠落/identity/入力不変を確認。
- [x] private情報をコミットせず、PR #8の`Closes #7`を維持。
- [x] 親Issue blocked、Stage3/4未実行。

## 残差帰属診断 — 2026-10-01

- 判定: COMPLETE_READ_ONLY_ATTRIBUTION。保存済みStage2F v2の21候補のみを読み、direct-reference 5,964セルを再集計した。追加レンダーは0。これはStage2 feasible、Stage3/4 PASS、または物理モデル全体の実現可能性を意味しない。
- identity: 3 anchor × 7 local point、32制約、production SIMD、source/evaluator/subset identity、manifest/run/result一致を確認。protected evidence 61ファイルのSHA-256は解析前後で不変。
- post-attack: 21/21候補が10 dB hard gate FAIL。セル形状違反は412/5,964。成分別にはEARLYのabs(residual)>10 dBが14件、LATEが412件。LATEが支配するセルは4,144件、EARLYは1,820件。最大EARLYは+10.573 dB（pitch 108 / velocity 40）、最大LATEは−29.454 dB（pitch 108 / velocity 14）。
- 0015 / 0016 anchor: pitchは各24/24 valid、±15 cents内。dynamic-spanはそれぞれ3 pitch / 1 pitchがFAIL、最大違反は+3.496 / +3.529 dB。peakは−8.019 / −8.059 dBFS、guard 0、finite、release finite、stuck voice 0。buzzは0.119004 / 0.117357。tail2は0.000563938 / 0.000561672。どちらもStage2全体はPASSしていない。
- 局所差分: damping L6/L7は3 anchorすべてでdynamic-span最大違反を約0.097–0.197 dB改善し、post-attack最大違反を約8.526–17.237 dB悪化。termination floor L4/L5はdynamic-spanを約0.017–0.035 dB改善し、post-attackを約1.547–3.091 dB悪化。hardnessはanchor依存で、両方の最大違反が同時に改善したのは0015/L3の1点のみ（post −0.149 dB、dynamic-span −2.924 dB）で、両familyのFAILは残る。
- 診断は残差が当該21点内でLATE優勢であることを示す。原因の設計判断、探索拡張、DSP変更、追加レンダーはこの契約の対象外。pitch estimatorのaggregate conformance 96/96 PASSと、個別physicalPitchTrajectory FAILは区別して未解決として保持する。
- 検証: analyzer 21/21・render 0、専用合成テスト11件、WASM build、Stage2F dry-runはPASS。tuning全体72件中71件PASS・1件FAIL。失敗はtest_v1_anchor_evidence_is_reused_without_mutating_v1_filesで、保存済みv1 anchorのsourceRevisionが現行sourceRevisionと不一致。証拠ファイルは書き換えず、full CTest / Web Player / Stage3/4 / manual listeningは未実行。
- private詳細とprotected SHA一覧: .agent-state/issues/7/calibration-optuna/stage2f-v2/diagnostics/residual-attribution.json。合成テスト: test_stage2f_v2_residuals.py。

## Stage2G — provenance test / focused late-residual diagnosis — 2026-10-01

- 既存21候補・5,964セルを検証済みの読み取り値から再集計。追加render 0。Stage3/4は未実行。
- 3つのL1候補はそれぞれpost-attack shapeのFAILが1セルで、全てpitch 108 / velocity 14。全体の最大絶対LATE残差も同じセル（−29.454274 dB）で、測定からキー一致を確認した。
- L1 dynamic-span違反: 0015はpitch 45/90/99、0016はpitch 45。L3は0015/0016ともpitch 93/108に残る。focus JSONには各pitchのactual/reference span、誤差、違反量を保持する。
- 同anchorのL1→L3では0015 buzzが0.119004から0.121478へ上がり、0.12制約を超える。post-attackとdynamic-spanの違反も残るためL3は不適格。0016 L3もbuzz 0.120214で上限を超え、post-attack/dynamic-span違反が残る。各比較にはpitch、buzz、tail2、peak、guard、finite/release/stuck、および全32制約を列挙し、トレードオフを隠さない。
- v1保存identityと現HEADの差はsourceRevisionのみ。保存identityでv1の3結果、全32制約、参照result hashを検証し、現HEAD loaderはstrict guardにより `BLOCKED_ANCHOR_EVIDENCE_IDENTITY: ... sourceRevision` を返すことを確認。runner/production guardは変更していない。
- 合成identity/focusテスト、tuning全体、WASM build、Stage2F dry-run、既存analyzer、privacy scan、diff checkの結果はPR #8のStage2G更新に記録する。full CTest、Web Player、Stage3/4、manual listeningは未実行。Issue #7は`phase:implementation` + `blocked`のまま。
