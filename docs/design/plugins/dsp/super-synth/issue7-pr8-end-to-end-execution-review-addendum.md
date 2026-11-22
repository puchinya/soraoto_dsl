# Issue #7 / PR #8 — 最後まで実行するためのレビュー追補 Implementation Contract

- Repository: `puchinya/soraoto_dsl`
- Issue: https://github.com/puchinya/soraoto_dsl/issues/7
- Existing PR: https://github.com/puchinya/soraoto_dsl/pull/8
- Reviewed HEAD: `36e7d945e54855a4650461c1db74afeccb158e34` (2026-10-25; 実行直前に再取得)
- Governing Gate 0–2 contract: `docs/design/plugins/dsp/super-synth/issue7-gates0-2-evidence-recovery-implementation-contract.md`, SHA-256 `87681057245c2d966f0ffb26a7003d8367b244fbddb51bf75233fdaa068fefd8`.
- User authorization: 2026-10-25「これで実施します」および今回の「レビューして。最後まで実施するように指示して」。**Gate 0–2の承認済み設計と実装を実行し、証拠・コミット・push・既存PRのレビュー状態まで扱う。調査・計画・コメント作成のみで完了としない。**

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline / 今回のレビュー

- HEADで新たに追加されたのはGate 0–2の設計/実装契約書だけ。Gate 1フォレンジックCLI、Gate 2独立PCM reader、および認可済みホスト実測は未実装・未実行。したがってIssue #7/PR #8の完了判定は不可。
- 元のP1 WASMの確認は`wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v4.cjs::safeP1Snapshot`、P5入力前提は`run-issue7-physical-fit-v5.cjs::readOnlyDiagnosis`。旧検証器は元のWASM SHA、元P1 runtime、v3 terminal、P3記録の一致を要求する。
- 既存P5は`BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT`。報告済み音響累積3,251/5,255、729候補の適格数0。過去の保全済みv3/v4/v5、review-01/02のSHA・size・mtimeは変更禁止。
- 一つのPRに約330ファイルが含まれる。Issue全体の品質合格、未実施のStage3/4、release同等性、Web Player、聴感確認について合格報告をしてはならない。
- 基礎資料：Issue #7の承認、上記Gate 0–2契約のSections 1–10、`AGENTS.md`、`docs/agent-workflow/{design,implementation,review,evidence-preservation,checkpoint}.md`、同task spec/design、対象source/tests。これらの記載は本追補より優先する。ただし「追加の重複承認を得るまで着手しない」という表現は、本追補で扱う既承認Gate 0–2の範囲に限り不要とする。

## 2. Architecture Decisions / レビュー修正

### B/P1-1: Gate 1結果の分岐を一意にする

元契約はGate 2を「元WASMが復元できない場合」に限定する一方、Gate 1で他の検証失敗が起きた場合にもGate 2へ進む、と読める。これを次のように固定する。

1. `VERIFIED_ORIGINAL`: オリジナルWASMとP1 runtime SHA/exportsが一致したら、元の`v4 --verify`および既存`--analyze/--verify`を実行。全検証PASSなら同じ既存epochの`--publish`へ進み、Gate 2は作成しない。
2. `MISSING` / `FILE_SHA_MISMATCH` / `EXPORT_MISMATCH` / `P1_RECORD_SHA_MISMATCH`: その個別述語を記録。正当な**同一バイト**の既知保管先を調査し、復元可能なら元経路を再試行（実物の復元は元ビルドpathの未存在時のみ）。正当な同一バイトがないなら、元WASM同一性は`HISTORICAL_BINARY_UNAVAILABLE`または`P1_IDENTITY_CONFLICT`として保持し、Gate 2の独立PCM検証へ進む。**P1記録自体が不正・矛盾する場合は、元値を書き換えず、PCM保証とは別にidentity conflictを記録する。**
3. オリジナルWASMが検証済みでも、その後`v4.verify()`でP3/v3 terminal、parent inventory、source identityなどが不一致になった場合は、これを**別の`PARENT_IDENTITY_CONFLICT`**として扱う。元経路のFAILをPASSへすり替えない。独立PCM readerの条件は「元WASM欠落のみ」に狭めず、**元検証器の前提が満たせず、なお独立に真正な保存PCMと参照入力を検証できる場合**とする。こうした経路で成功しても旧chainの全identity PASSは宣言しない。
4. 保存された原PCM / metadata / 参照archive自体が不足・不一致なら、既知の認証済み保存先とmanifestで一回の有限調査を完了後、`UNVERIFIABLE_SOURCE_DATA`で終端。総当たり探索、ダミー音声、空のfixtureでのPASS代用は禁止。

### B/P1-2: 「最後まで」の正確な定義

- Gate 0–2の実行者は**設計書提出やGate 1調査のみでは終了しない**。上記分岐に沿って、6新規ファイルの実装、syntheticテスト、認可された証拠ホストでの実測、必要条件を満たす場合のimmutable二重保存、Issue/PRの報告、push・HEAD readback・最終レビューまで責任を持つ。
- 実行者の環境にデータがないという**だけ**でGate 2実装を放棄しない。テスト可能な実装・契約範囲の検証・commit/push/PR更新を完了し、実データ依存のGateのみ`BLOCKED_INPUT_UNAVAILABLE`と明記する。アクセス可能な認可ホストがある場合はそこで検証し、同一セッション内で進める。
- 真に実行不能な外部依存（アクセス権、認証済みarchive欠落、元P1/WAV不存在、GitHub権限）が判明した場合は、**正確な原因と試行コマンドのエラー、未完了受入れ項目、再開点**を記録する。この場合「完了」ではなく`BLOCKED`であり、PRをマージしない。
- 本承認は**Gate 0–2実装そのものへの承認**であり、同じ設計事項で何度も承認を求める必要はない。Gate 3–6の新しい音響機構変更、予算再配分、旧P5の42呼び出し転用、PR分割方法はmaterial designとなるため、この指示を**無制限の承認**としてはならない。

### B/P2-3: 数値比較・停止の正確性

- 元P5 historyの観測順/ID/sourceタグ/3パラメータと140本のWAV・metadata digestは**完全一致**。符号付きEARLY/LATE/shape/direct-level/dynamic-spanなどdB指標は元契約どおり`abs(diff) <= 1e-6 dB`、丸め前。objective lossとnormalized violationは`abs(diff) <= 1e-8`、この二者の閾値をdBとして扱わない。全数値がfiniteでなければFAIL。
- 元の評価器・reference corpus・P3 shared gain・窓・公式hard gatesをそのまま用いる。guardHitはPCMから再現できないので、**認証済みメタデータ由来の保存事実**として扱い、PCMだけでguardHit同等性を独立再測定したとは言わない。
- 復元したWASMが旧verificationにPASSしても、新実装の音質合格ではない。PCM一致にPASSしても物理原因の**因果確定**でも製品受入れでもない。

## 3. Exact Change Set

承認済み親契約Section 3の**6つの新規ファイル**が正規の実装対象。旧runner、DSP、preset、WASM ABI、保存証拠には差分を出さない。Gate 2の条件に達しなくても、Gate 1フォレンジック検証とそれをテストするCLI・core・契約済みspec/designは用意する。Gate 2に必要な残りの純readerとpublisherも、未入手のprivate WAVを合成fixtureで代用して実装・テスト可能な範囲は実装し、実データによるPASSと混同しない。

親契約への本追補は新たな物理音響実装を許可しない。新たな材料で6ファイル範囲を超える変更が必要になった場合は、ファイル・API・理由をIssueで特定し、独断で拡張しない。

## 4. Implementation Sequence（依存関係順、途中で止まらない）

1. **Preflight:** Issue/PR/最新HEAD、承認SHA、spec/design/code/status、GitHubの未解決レビューとCI、認可ホスト可用性、元source+両私有store snapshotを読み取る。実行ブランチを確定。raw audio/private pathをIssueへ書かない。
2. **Gate 1:** 原WASMの存在・size・SHA・exports・P1記録照合を**実際に一回の有限フォレンジック手順**で実施。結果をmanifestへ保持。認証済み既存artifactがあれば同一バイトを復元できるか決定。
3. **Gate 1 route:** オリジナルが確認できれば旧v4→既存root-cause `--analyze/--verify`を順に実行。成功ならreadbackを確保し条件付き出版。別原因で停止した場合はその条件を記録し、独立PCMの検証可能性を判断してGate 2へ進む（旧chainはBLOCKEDと記録）。
4. **Gate 2 implementation:** 親契約のspec/designと`core.cjs`/CLI/2 test filesを実装し、18ケース相当の検証だけでなくparent contractのF01–I01を満たすテストを追加。**本Stepでコードをコミット・プッシュし、既存PR #8を更新する**。private evidence不在はローカル単体テストの阻害要因にならないよう、synthetic fixtureを独立に構成する。
5. **Gate 2 private integration:** 認可ホストでexact 140 WAV+metadata、元archive・SFZ/FLAC identity、P1/P3/P5 digestを照合。独立PCM再計測と歴史historyの誤差閾値、元と新epochの両copy前後SHA/size/mtime、各actual outputを収集。どこか失敗したらFAILのまま正式終端にする。
6. **Conditional publication:** 検証がPASSし、Issue承認/committed pushed head・manifest/readbackが一致する場合に限りnew epochへ二重保存。重複実行は同一バイト再利用。partial/conflictは不可逆に改修せず新たな回復契約が必要なblocked状態として記録。
7. **Review and delivery:** focused + frozen tests、docs checks、`rtk git diff --check`、source/no-write audit、`git commit`、push、PR HEAD readback、PR comment/description、Issue phase/state、Reviewer Checklist自己レビューを実施。PR URLをcompletion reportに記載。**これらを省略して完了と言わない**。
8. **Gate 3–6 handoff:** Gate 2を`PASS`または`UNVERIFIABLE`に分類後、次段の**決定済みでない物理機構・最大試行回数・パラメータ権限・Stage3/4 gating・PR分割**を明示した別のImplementation Contractと実行可否をIssueに提出。必要な設計承認を経てから実装・音響評価に着手する。新しい物理機構案が有限予算で合格するとは断言しない。

## 5. Required Runtime Semantics / Terminal matrix

| 条件 | 行動 | 最終判定 |
|---|---|---|
| 元P1 WASM同一バイトかつ既存検証PASS | 旧readerで140セル再計測、dual出版まで | `GATE2_NOT_NEEDED` + `EVIDENCE_REPORT_PUBLISHED`（音響PASSではない） |
| 元WASM不在/不一致、WAV+archive真正 | 独立PCM readerを実装・実測してdual出版 | `HISTORICAL_BINARY_UNAVAILABLE` + `PCM_METRICS_RECOMPUTED_AND_MATCHED` |
| 元WASMは同一だがv3/P3等の旧chainがFAIL、PCM入力真正 | 旧chainをBLOCKEDのまま保持、独立readerで再測定 | `PARENT_IDENTITY_CONFLICT` + 個別の`storedPcmEvaluation` |
| WAV/metadata/archive不足またはハッシュ差異 | 一回の認証済み入力調査後、修復せず停止 | `UNVERIFIABLE_SOURCE_DATA` |
| 任意dBが1e-6を超える/非dBが1e-8を超える | 違反セル・項目・expected/actualを記録、保存不可 | `PCM_METRIC_MISMATCH` |
| 公開GitHub承認/HEAD不一致、二重保存partial/lock競合 | 強制的に出版を禁止、既存記録保持 | `BLOCKED_PUBLICATION_IDENTITY` / `BLOCKED_PARTIAL_PUBLISH` |
| authorized private hostへのアクセス権自体がない | 純実装・synthetic/CI・コミット・PRを完了して依存を明示 | `BLOCKED_INPUT_UNAVAILABLE`（実装済み≠受入れ済み） |

`--forensic`,`--analyze`,`--verify`は0 audio/0 writes。`--publish`のみ承認済み新epochへappend-only。owner Drop・再入・同時実行・再実行は親契約Sections 5,7を完全に適用。

## 6. Non-goals / Forbidden Changes

- 旧WASMを再ビルドして元バイナリと同一だと宣言しない。元v3/v4/v5 runnerに例外的skip/verify無効化を入れない。
- P5凍結判定を変更せず、旧42音響呼び出しや予約済み1,962回を転用しない。Gate 3–6へ音響自動実行しない。
- Plugin ABI、DSL authority、既存の音質合格基準、参照アーカイブ、旧二重保存証拠、source hashesを変えない。
- `BLOCKED`や`NOT RUN`をPASS、`UNVERIFIABLE`を完成と表記しない。PRのマージ・Issueクローズを勝手に行わない。

## 7. Concrete Tests

親契約F01–I01の全テストが必須。特に「WASM正常→旧v4失敗」を注入し、**元chainの失敗とPCM-only結果が混同されない**ことを検査する。`P1_RECORD_SHA_MISMATCH`の判定は、対象WASM存在有無と独立に検証する。正真正銘の音声140件がなければI01をBLOCKEDと記録し、合成データPASSで代用しない。`candidateLoss`/`normalizedViolation`を1e-8より大きく改変するfixtureはFAIL、dB 1e-6超改変もFAIL。guardHitを未検証として扱うケースのセーフティPASS偽装を拒否する。

## 8. Verification Commands

実行コマンドは親契約Section 8を省略せずそのまま実施し、実測ログと実行機器を紐づける。以下も必須。

```bash
rtk git status --short
rtk git diff --check
rtk node --check wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1-core.cjs
rtk node --check wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.cjs
rtk node --test wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1.test.cjs wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.test.cjs
rtk node --test wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-root-cause-v1.test.cjs wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5.test.cjs wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5-review.test.cjs
rtk gh pr view 8 --repo puchinya/soraoto_dsl --json state,headRefOid,headRefName,url
rtk gh issue view 7 --repo puchinya/soraoto_dsl --json state,labels
```

実WAV対応の`--forensic/--analyze/--verify/--publish`は認可ホスト限定。ドキュメントvalidatorはリポジトリに実体のあるものだけを実行。出力のPASS/FAIL/BLOCKED/NOT RUNを混同しない。

## 9. Reviewer Checklist

- [ ] ユーザー承認済みGate 0–2を追加承認待ちとして停止していない。
- [ ] 元WASM正常・不一致・存在しない・P1/parent identity conflict・WAV/archive不足が独立した有限分岐になっている。
- [ ] 上位承認の音響予算/品質基準/元WASM/証拠の不変条件を維持している。
- [ ] 6ファイルのspec/design/code/testsに本文のdecisionが実装されている。
- [ ] 独立Readerが旧v3/v4/v5 runnersやDSP harnessを実行時にimportしない。
- [ ] 20×7の元PCMと参照コーパスに基づく厳密なSHA/数値検証・非比較性がある。
- [ ] 0 acoustic/0 build/0 render、凍結された親のSHA/size/mtimeの不変性を検証した。
- [ ] 正常/異常/同時実行/再利用/partial dual-copy出版テストが本当のfailure modeを再現している。
- [ ] テスト実行、レビュー、コミット、push、HEAD readback、既存PR #8 URL、Issue状態、Completion Reportまで作業した。
- [ ] 作業不能な項目はexact blocker + failure predicate + log + retry ownerを記録し、偽PASSで終わっていない。
- [ ] Gate 3–6の実装・音響call・PR分割は明示的に設計承認を得るまで実行していない。

## 10. Completion Report

親契約Section 10に加えて以下を必須とする。

1. **実行段階ごとの最終状態:** Gate0 / Gate1 / Gate2 / Gate3–6(`UNAUTHORIZED` or `DESIGN_APPROVAL_PENDING`)、対応する`PASS|FAIL|BLOCKED|NOT RUN`。報告書だけでGate2完了としない。
2. **証拠値:** SHAと判定述語、20×7の測定差分、出典、parent-before/after、dual-copy manifest/readback hash、欠落ホスト依存を区別。
3. **実装検証:** files changed / commands / PASS-FAIL-BLOCKED-NOT RUN / platforms / source-bound delta=0 / reviewer checklist self-audit。
4. **Delivery:** commit SHA / pushed branch / PR URL / PR HEAD readback / issue phase+blocked / reviewersの未解決事項 / 限定されたmaterial conflicts / 残る具体的作業。
5. **完了ゲート:** Gate 0–2の実装完了とIssue #7全体の製品音響受入れ完了は別。PR #8のマージは全受入れ条件PASS後のレビュー工程のみで、ブロッカーがある間はOPENで保持する。

