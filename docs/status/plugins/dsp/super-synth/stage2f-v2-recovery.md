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
