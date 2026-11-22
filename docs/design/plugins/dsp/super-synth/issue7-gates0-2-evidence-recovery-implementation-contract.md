# Issue #7 / PR #8 — Gate 0–2 証拠復旧・独立PCM検証 Implementation Contract

- 対象: `puchinya/soraoto_dsl`, Issue #7, 既存PR #8
- ベースライン: `codex/issue-7-supersynth-v9` の `5f8fbda3ff0153544e3194b5368ed7d4e6ea83ef`（作成時点。**実行前に再取得する**）
- 承認された上位方針: 2026-10-25、ユーザーの「これで実施します」。品質優先の **Q**。物理モデル・既存基準を維持し、有限回数で合格または明示的な不合格・検証不能へ終結する。
- 契約対象: **Gate 0、Gate 1、Gate 2のみ**。Gate 3–6の物理変更・音響呼び出し・予算再配分・PR分割をこの契約で実行してはならない。
- 実施権限: GitHub/ソース側の調査と契約作成は可能。ただしこの文書をIssueに登録したことは、非公開実行環境での検証が成功したことを意味しない。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

### 確定している状態

- Issue #7は`phase:implementation` + `blocked`、PR #8はOPEN、未マージ。PRは約330ファイルを変更しており、この段階では既存PRを閉じず、追加の音響変更を混載しない。
- v5 P5凍結コミット `7ab88ce5b857423ec1d278e8741e963f4e33cd56`、P5 runtime SHA-256 `90cf96c243f298cc6f91b8eba350f904c9581cd1924d53e272e422450d377307`、terminal SHA-256 `346a61a21e3c6fb46c97ee45c74616c523f8a180d63a032f30643532e73243ed`。終端は `BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT`、729点中eligible=0。3,251/5,255呼び出し済み。旧P5の残42回を新探索に転用してはならない。
- 読み取り専用原因分析 `analyze-issue7-physical-root-cause-v1.cjs` は17 PASS / 0 FAIL / 1 SKIPとのPR本文報告（未独立実行）。実WAV140セルの再計算は `BLOCKED_V5_V4_PARENT_TERMINAL_IDENTITY`、その内部で `BLOCKED_PHYSICAL_V4_P1_WASM_IDENTITY`。バイナリが実際に欠落しているかどうかは**未確認**。
- `docs/specs/plugins/dsp/super-synth/physical-fit-root-cause-readonly-v1-amendment.md`「Evidence and metrics / CLI」、同design「Ownership and dependencies / Execution dataflow」: 旧v5 readerは元のWASMまで含めてP1/v4を確認してから、v3の8点＋v4の12点・140個の保存WAVを再採点する。元readerは改変しない。
- `wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v4.cjs::safeP1Snapshot`：旧P1のruntime、candidate terminal、98個の初期P1セル、元診断WASM、参照archiveを照合する。期待WASMは `build/issue7-physical-identification-v1/diagnostic/plugins/dsp/super-synth/plugin.wasm`、SHA-256 `1028c5a77b533ba97066d116f77aab80e5e91b45ef043394875614ee3efab99a`、元P1 runtimeは `runtime-revisions/physical-fit-P1.json::build.wasmSha256`。
- `run-issue7-physical-fit-v5.cjs::readOnlyDiagnosis`：v4の`verify()`成功と元P1のWASM同一性を要求する。保存WAVはそれと独立して存在し得る。この元readerを`skip`・`catch`・ダミーWASMで通してはならない。
- `issue7-physical-identification-v1-core.cjs::resolveRoots/readDual`、`issue7-physical-fit-v4-core.cjs::resolveRoots/readDual`、`issue7-physical-fit-v5-core.cjs::resolveRoots/readDual`：各世代の実ストアの真の場所と二重保存検証。v3は`{a,b}`、v4/v5は`{primary,secondary}`という返却形の違いがある。
- `run-issue7-physical-fit-v5.cjs::HISTORY_REL` = `p5/observed-history.json`。`observationReceipt/metricRows`が元ID、原sourceタグ、3パラメータ、7セル、WAV/metadata SHA、符号付きEARLY/LATE・shape・official violation・lossを保存する。v3タグは`immutable-v3-p1-baseline`または`immutable-v3-p1-candidate`、v4タグは`v4`。
- `issue7-physical-fit-v4-core.cjs::STRESS_CELLS`：順序固定 90/31, 93/31, 96/14, 96/31, 96/36, 96/124, 99/31。`run-issue7-physical-fit-v4.cjs::oldRowsByStage`と`readV4Scores`（v5 runner内）のレコード経路規則を参照して、保存音声とP5 manifestを相互検証する。
- 公式評価は `stage3-direct-reference-metrics.cjs::evaluateDirectReferenceMatrix/postAttackResiduals`、PCMデコードは `physical-fit-v4-loss.cjs::decodeFloat32StereoWav`、参照解析は `analyze-issue7-physical-identification.cjs::{parseSfz,decodeWav24Stereo,analyze,locateGoogleDriveArchive}`。元参照archive SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b`、SFZ memberは `SalamanderGrandPiano-SFZ+FLAC-V3+20200602/SalamanderGrandPiano-V3+20200602.sfz`。旧`run-issue7-physical-fit-v4.cjs::extractReferenceSet`は**仕様照合の参照実装**であり、実行時にv4 runnerへ依存しない。
- 権限・変更境界: `AGENTS.md`、`docs/agent-workflow/{design,implementation,review,evidence-preservation,checkpoint}.md`。新たなmaterial designはIssue #7 `phase:design`で承認、実装完了はcommit/push/PR/review移行と検証証拠が必須。

## 2. Architecture Decisions（固定）

### Gate 0 — 要求／受入れ境界

1. **Qのみ採用**。全音域の既存品質閾値、物理モデル方針、Plugin ABI・DSL authorityは不変。今回の成功は「原因分析の終了」ではなく、将来の物理モデル実測と製品受入れを通過したときだけ宣言する。Gate 0–2の成果は独立した証拠準備マイルストーンであり、Issue #7の完了ではない。
2. P5終端、全過去のWAV・source・二重保存記録のSHA/サイズ/mtimeを保持。0新規build、0render、0音響call。Gate 3以降の1機構改善、42+1,962の回数再承認、PR分割を**別契約**へ送る。サンプラー化・MIDI局所gain/EQ・基準緩和を採らない。
3. 「有限回で終結」には証拠不足の `EVIDENCE_UNVERIFIABLE` も含める。証拠が足りない場合に検証済みと偽らない。再試行は同じ記録の読み取り再検証のみを許し、証拠探索を無期限に増やさない。

### Gate 1 — original P1 WASM一度限りのread-onlyフォレンジック

1. 旧診断WASMの存在、サイズ、実SHA、WebAssembly.Module exports、P1 runtimeの参照SHAを**それぞれ別の述語**で検査する。`MISSING | FILE_SHA_MISMATCH | P1_RECORD_SHA_MISMATCH | EXPORT_MISMATCH | RECOVERED_IDENTICAL`を出力。検査経路や元バイナリのバイト列をGitHubに貼らない。
2. 復元候補は作業マシンの元ビルドpath、実行当時の**既知の認証済み**private artifact保管先、P1既存receiptに明記されたartifactのみに限定。全ホームディレクトリの総当り探索は禁止。
3. 候補が**完全同一SHA**なら、新しい音響ビルドを行わず、先に候補の所有権・出所を検査し、元の期待ビルドpath（private ignored build出力）に**未存在時のみ**配置できる。置換不可、既存検査対象の上書き不可。復元操作はread-only診断実行とは明確に分離し、実施履歴を保存する。元二重保存WAV/meta/runtimeは変更不可。
4. 元WASMを復元できる場合、元の`v4 --verify`→旧read-only診断`--analyze`を実施してGate 3診断入力を検証する。失敗/照合不能はそれぞれ正しいブロッカーを記録し、Gate 2へ進む。**同じGate 1の再探索は禁止**。

### Gate 2 — original WASMとは独立した保存PCM検証

**条件:** Gate 1が`RECOVERED_IDENTICAL`でなく、WAV+参照データは存在する場合のみ、別の読み取り専用APIを導入する。オリジナルWASMの生成同等性を証明したと主張してはならない。

1. 独立ツールは純計測モジュール＋上位read-only CLI。**旧v3/v4/v5 runnerを`require()`しない**。世代別coreの`readDual/resolveRoots`、公式純関数、既存WAV decoder/analysisのみ再使用可。旧データのwriter、render harness、WASM instantiation、audio processor、optimizerを読み込み/呼出ししてはならない。
2. 真の入力証拠は旧v3/v4/v5 private二重保存とP1/P3/P5の凍結記録・元参照コーパス。**P5 history値だけを信頼しても再採点とは呼べない。** 元WAV140本（56 v3、84 v4）、対応するmetadata各140件、既知のSfz/FLAC archive SHAと参照セル、元P1/P3/P5のレコードhash、既存source/inventoryが独立に一致した場合だけ`PCM_METRICS_RECOMPUTED_AND_MATCHED`。
3. `v3`の8観測は、`baseline/plan.json` / `baseline/ledger.json`、`candidate/plan.json` / `candidate/ledger.json`をread-onlyで検査し、`baseline/artifacts/<encodeURIComponent(cellKey)>.wav` と`candidate/artifacts/...`、metadataに対するP5のWAV/metadata SHAとセル順・元の`id/source`を照合。v4の12観測はP3の`p3/optimizer-result.json`の選択済み`rounds[].candidates[].score`に固定し、`issue7-physical-fit-v4-core.cjs::callKey('p3-'+score.id+'-'+pitch+'-'+velocity)`の`result.json`/`audio.wav`を照合する。元のスコアや全セル数が一致しなければ停止。
4. 参照wave抽出は既存`parseSfz`/`decodeWav24Stereo`/`analyze`、固定`tar -xOzf`/`flac -d -c`と同等の処理だけを新reader内で行う。archive digestは展開前にファイル全体をSHA検証。SFZのpitch/velocity選択、default_pathのpath-traversal拒否、唯一マッチ、各FLAC digestをP3 source manifestと照合。`run-issue7-physical-fit-v4.cjs::extractReferenceSet`の仕様/手順を読んで一致させるが、元runnerは実行時にimport不可。archive探索は元ロケータ、または環境変数`ISSUE7_SALAMANDER_ARCHIVE_PATH`の**明示された単一路径**のみ（ディレクトリ総当り禁止）。環境変数pathはレポートに書かない。
5. 実測audioから元の5ウィンドウの公式特徴量を再計算し、`evaluateDirectReferenceMatrix`と`postAttackResiduals`でdirect-level、符号付きEARLY/LATE、shape、finite/guard/peakとstress subsetのspanを再評価。`physical-fit-v4-loss.cjs::candidateLoss`を元のP3 sharedGain値で再評価。20×7の元P5履歴と各数値を、絶対許容差`1e-6 dB`（lossなど非dBの元コントラクト精度は元の受入れ規則）で比較。元P5の固定結果・rank/LOO/候補0を再計画・再フィットしない。元のフルStage3 velocity/spanは**NOT EVALUATED**。
6. 信頼は**二軸**: `historicExecutableIdentity = VERIFIED_ORIGINAL | HISTORICAL_BINARY_UNAVAILABLE`と、`storedPcmEvaluation = PCM_METRICS_RECOMPUTED_AND_MATCHED | UNVERIFIABLE_SOURCE_DATA`。WASMなしのPCM再測定は元ビルドを再現した保証ではなく、**独立したPCMの一致**のみ。いずれの軸でもStage 3/4や製品releaseへの合格昇格は禁止。
7. Gate 2から許可される次段階は現存の20×7データに対する**仮説提案のみ**。物理音源の実験は別に承認したGate 3/4契約を要する。

### 出版・証拠境界

1. 新epochは`physical-root-cause-offline-v1/analysis-01`とし、既存`physical-root-cause-v1/analysis-01`、v3/v4/v5、review-01/02とは完全に別。primary=`<GIT_COMMON_DIR>/soraoto-agent-state/7/physical-root-cause-offline-v1/analysis-01/`、secondary=`$HOME/.soraoto-agent-archive/soraoto_dsl/7/physical-root-cause-offline-v1/analysis-01/`。
2. 読み取り専用`--forensic`、`--analyze`、`--verify`はprivate outputsにも**ゼロwrite/mtime変更**。`--publish`は修正ソースのcommit/push、実際のPR HEADとtree/branch/Issue承認、完全なreport/manifest、親のbefore/after snapshot一致を確認した後だけ別epochへimmutable dual-append。publisherは独立ロック、所有者照合、primary+secondary同一bytes、fsync/readback、競合fail-closed、再実行同一bytesならmtime不変。部分コピー、例外、キャンセルで既存ファイルを削除・修復・上書きしない。
3. 原WAV、private絶対path、認証情報はコミット・Issue・PRに書かない。公表するのはハッシュ、集計数値、判定、SHA/サイズ、ソース・予算情報のみ。

### 重要な不採用案

- 元の`safeP1Snapshot`/`v4.verify`をskipする、旧WASMを新ビルドで代替する、旧P5 SHAを再署名する方法。
- 同じ3変数の729点探索を拡大する、残42枠を流用する、旧Stage3/4を一気に実行する方法。
- 原P1がない場合に「WASM同等性がPASSした」とする方法。

## 3. Exact Change Set

**設計文書の承認後に限定**して、差分を次の新規ファイルだけに収める（旧runnerや既存データは無変更）。

1. `docs/specs/plugins/dsp/super-synth/physical-root-cause-offline-v1-amendment.md`：この新epochのnormative input identities、二軸保証、public/private境界、終端判定、0音響を固定。
2. `docs/design/plugins/dsp/super-synth/physical-root-cause-offline-v1-design.md`：reader/evaluator/publisherの所有者、読み込み順、fail-closed transactionと部分保存を設計。
3. `wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1-core.cjs`：副作用ゼロの`resolveInputRoots({root,home,commonDirectory})`、`snapshotSources(roots)`、`verifyFrozenRecords(roots)`、`readVerifiedV3Rows(roots,p5History)`、`readVerifiedV4Rows(roots,p5History,p3)`、`readVerifiedReference(archive,expectedManifest)`、`recomputeOfficial({rows,reference,gainDb})`、`compareHistory(recomputed,p5History,tolerance)`、`buildReport(input)`をexport。`fs`の書き込みAPI禁止、legacy runnerのimport禁止。
4. `wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.cjs`：CLI `--forensic | --analyze | --verify | --publish` のみ。フォレンジック対象のPATH/SHAは上述で固定。GitHub依存は`--publish`だけ。`--forensic`は既知認証済み候補を最大1セット検査し、一次調査の結果をJSON stdoutへ出す（原バイト非表示）。原WASM復元の「配置」は**このCLIに実装しない**。置換を防ぐ手順に従う別の管理操作として実施。
5. `wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1.test.cjs`：純readersのfixture tests、単一copy/WAV hash・archive hash・SFZ mapping・metric drift・epoch境界・各終端分類。
6. `wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.test.cjs`：`--forensic`条件分岐、approve/head/branch競合、publisher、ロック、partial write、再実行、read-only mtimeテスト。テスト実行は保存PCMならsynthetic WAVだけを利用し、実音響callゼロ。

公開DSL/Plugin ABI/C音響方程式/プリセット/metadataに変更なし。設計に反する現実を見つけたらIssue #7で報告し、勝手にファイル範囲を拡張しない。

## 4. Implementation Sequence

1. 実行者はIssue #7とPR #8のHEAD・`AGENTS.md`・workflow/spec/designを再読し、本契約の改訂SHAとIssue上の承認状態を確認。Gate 0 Q、0 acousticの方針を固定。元ストア各copyのSHA/size/mtime inventoryをsnapshotし、変更しない。
2. Gate 1: **既存の認証済み場所だけを一度**read-onlyで調査してエラー述語を特定し、結果をIssue/PRに追補。`RECOVERED_IDENTICAL`なら元検証を実行し、Gate 2不要で既存原因分析へ接続。異なる場合はGate 2へ必ず進む。配置が必要なら、配置前後の出所・SHA/サイズ・履歴を追加記録。
3. Gate 2開始時に、新normative specとdesignとレビュー項目をIssueへ掲載して設計整合を確認、必要な承認を得る。承認済みの契約境界を越えた実装はしない。
4. 読取coreを先に実装。P5/P3/P1親のSHA、140 WAV/meta原バイト、参照archiveを検証後に公式計測。どこか欠損したら不可逆に前進せず`UNVERIFIABLE_SOURCE_DATA`を返す。例外メッセージにprivate pathを混ぜない。
5. 合成fixtureで音響0テスト、その後に既存音響証拠を置く**認可済みマシンのみ**で140セルを再計測。元のP5値と許容差を比べ、レポートを決定的にシリアライズ。
6. レポートの一致と親SHA/mtimeの不変性、公開Issueの承認、PR HEADの同一性が揃ってから`--publish`。初回/再実行の2copy readbackを検査し、Phase 3方向分析への入力だけ作成。
7. Gate 2の成果がない場合は`EVIDENCE_UNVERIFIABLE`で今回の証拠工程を正式終端にする。音質合格を主張しない。実音響の新設計・予算契約は別のIssue/PR判断に送る。

## 5. Required Runtime Semantics

| 入力/事象 | 検証器の動作 | 必須の事後状態 |
|---|---|---|
| 元P1 WASMが期待SHAで存在 | exports + P1 runtime一致を確認 | `VERIFIED_ORIGINAL`、元v4から読み取り専用再検証へ |
| 元WASMが存在しない／SHA違い | エラー述語を分離して記録 | 旧証拠は完全不変、Gate 2へ有限遷移 |
| v3/v4 WAV/meta片側のみ／不一致 | Fail-closed | `UNVERIFIABLE_SOURCE_DATA`、報告に該当セルと期待/実SHAだけ記録、変更ゼロ |
| 参照archiveなし／SHA違い／SFZ複数マッチ | Fail-closed | 不足/矛盾を記録し、別入力を自動使用しない |
| 全140セル元音声+参照一致、旧WASMなし | 公式残差・7-cell hard gates再計測 | `PCM_METRICS_RECOMPUTED_AND_MATCHED`、ただし`HISTORICAL_BINARY_UNAVAILABLE`、製品PASS不可 |
| 差分が1e-6 dBを超過 | 改変/評価互換性不明として停止 | `PCM_METRIC_MISMATCH`とセル・項目を記録。履歴値を修復しない |
| 同一出版要求再実行 | 既存report SHA/manifest検証し再利用 | 同一主従ファイルのbytes・mtime不変 |
| 新HEAD、承認不足、未コミットdiff | 出版前停止 | ゼロ報告書き込み、元証拠不変 |
| 二重保存の片側失敗、プロセス中断 | 部分状態を保持・再書き禁止 | FAIL/BLOCKED。所有者照合・手動recovery設計なしにクリーンアップしない |
| producerやrepo worktreeのDrop/終了 | owner lockの正常releaseは成功・整合時のみ | 完全出版前の失敗を成功に変えない。unknown lockは保全 |
| concurrent実行、書き込み再入 | 単一writer lock + immutable creation | 2 writer同時成功は禁止。比較読取は許可 |
| レンダー/ビルド/音響callを要求 | 禁止 | 実行ゼロ、会計3,251/5,255は不変 |

## 6. Non-goals / Forbidden Changes

- 旧v3/v4/v5/physical-root-cause-v1の実装・証拠・sourceHashes・契約・エポック・音質閾値・WASM ABIを変更しない。
- 「既存140 WAVで原因の方向を示す」ことと、物理機構の因果確定を混同しない。旧Stage3 v31/v36測定と2026-09-30実験を同一系譜だとみなさない。
- 旧バイナリの欠落を修正するために新たな`cmake` / `build` / 音響レンダリングを起動しない。
- Gate 3–6、42音響call枠再配分、1,962 downstream、PR #8マージ、Issue #7クローズ、既存巨大PRの分割は未承認の個別実行。専用の設計・契約とレビューチェックを作成するまで触らない。

## 7. Concrete Tests

1. **F01 P1-元WASM正常:** synthetic original WASM +一致P1 runtimeで`VERIFIED_ORIGINAL`。exports必須4件は`run-issue7-physical-identification-v1.cjs::DIAGNOSTIC_EXPORTS`を参照（元runnerをCLI runtimeでimportしない）。
2. **F02欠落/改変:** MISSING/FILE_SHA_MISMATCH/P1_RECORD_SHA_MISMATCH/EXPORT_MISMATCHをそれぞれ別fixtureで確認。いずれもGate 2へ停止/遷移。
3. **R01 20×7完全性:** v3 8件、v4 12件、原ID/source/3パラメータ、正確な7セル順、140 WAV/meta SHA一致でのみ合格。
4. **R02 片側欠落:** WAVまたはmetadataの片側を除くと元二重store読取がBLOCKED。生成補填なし。
5. **R03 参照検証:** archive SHA違い・SFZ path traversal・0件/複数region・FLAC digest違い・Sfz sample不足を独立に再現。
6. **R04公式残差:** `EARLY=5,LATE=-6,shape=6`等符号付き境界、shape閾値10.0、direct-level±20、velocity subsetはフルStage3のPASSと混同しない。
7. **R05受領履歴diff:** 保存セル残差を`+1e-5`ずらせばblock、1e-6以内は誤差制約どおり判定（浮動小数境界注意）。元sourceタグ改変もblock。
8. **R06 元WASM欠如による保証分離:** 有効なPCM/参照のときも`historicExecutableIdentity=HISTORICAL_BINARY_UNAVAILABLE`、PCM評価だけPASS、最終acousticAcceptanceはBLOCKED。
9. **R07既知旧Stage3との非比較:** 古い96/31/36残差と新96/124の論拠を別記し、SHA不一致の旧実験はNOT_COMPARABLE。
10. **P01 readonly:** `--forensic/--analyze/--verify`の前後で全旧private copyと新epochのSHA・size・mtimeに差なし。原WAVと公開原パスを標準出力に出さない。
11. **P02 publisher:** Issue承認/PR HEAD/branch/コミット不一致でwriteゼロ、正常は2copy同一・manifest厳密集合、再利用でmtime不変。
12. **P03 failure / cancellation:** write途中で片側失敗・lock contention・異常再入、元のprivate root不変、部分新epoch状態保持。成功と報告しない。
13. **I01 private-host:** 実140本のSHA+数値一致、リファレンスarchiveのSHA、前後inventory、不変性を認可された実環境で検証。**このテストはfixture PASSで代用不可**。

## 8. Verification

- Syntax: `rtk node --check wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1-core.cjs` / `rtk node --check wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.cjs`
- Tests: `rtk node --test wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1.test.cjs wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.test.cjs`
- Frozen existing: `rtk node --test wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-root-cause-v1.test.cjs wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5.test.cjs wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5-review.test.cjs`
- Forensic: `rtk node wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.cjs --forensic`（actual private host、読み取り専用）
- Offline analyze/verify: `rtk node wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.cjs --analyze`; 続けて `--verify`（原音声+参照アーカイブ有のホストのみ）。
- Publish: `--analyze`/`--verify`がすべてPASSした後、`--publish`を1回、直後の`--verify`でreadback。
- Git: `rtk git status --short`; `rtk git diff --check`; `rtk git diff --stat`; `rtk git rev-parse HEAD`; `rtk gh pr view 8 --json state,headRefOid,headRefName`; Issue state/labelsをreadback。
- spec/docs: 対象spec/designの所有者・リンク・`agent-doc-schema: 2`・Document Impactを検証。repoにvalidate-docsの実コマンドがある場合のみ実行、憶測でコマンド名を作らない。
- CTest/production/WASMビルド/Stage3/4/manual audioは**NOT RUN（scope外）**。Windows/macOS/Linuxはそれぞれ実行証拠がなければ`NOT VERIFIED`。
- テストFAILなら誤ったPASSにはしない。private host不在は`BLOCKED_INPUT_UNAVAILABLE`として記録。

## 9. Reviewer Checklist（実装前公開）

- [ ] Issue #7にはGate0 Q・0音響・有限終端と、Gate1の一回限りルールが承認済みで記録されている。
- [ ] Gate1失敗述語を5種類区別でき、元WASMの未確認を欠落と断定しない。
- [ ] 旧P1/v4/v5 source-bound readers / frozen roots / old archive / thresholdsに差分がない。
- [ ] 新readerが旧runner/WASM/DSP/harnessを実行時にimportしていない。
- [ ] 参照SFZ/FLAC/archiveと140 WAV/metaの原バイトSHA、元history及びP1/P3/P5の完全性を照合している。
- [ ] `historicExecutableIdentity`と`storedPcmEvaluation`の2軸が明確で、フルStage3/4未実行をPASS扱いしない。
- [ ] すべての測定比較は元ウィンドウ/公式純関数/許容誤差を保持する。
- [ ] 読み取り専用は0write/0render/0build/0call、主従両方のSHA/size/mtime不変。
- [ ] 新epoch publisherの競合/部分失敗/再実行/lock/owner破棄がfail-closed。
- [ ] Gate1成功/失敗・Gate2成功/データ不足の全終端で独立した報告と残作業の処理がある。
- [ ] `rtk`検証、コミット/ブランチpush/PR URLのreadback、実検証/未実行の区別を記録。
- [ ] Gate3–6および旧P5の残42呼び出しを触っていない。

## 10. Completion Report（実装者に必須）

提出内容を固定する。

1. `repository/issue/pr`, 改善範囲、ブランチ、commit/tree SHA、PR URL（既存PR #8または**別途承認された**分割PR）、PR本文中の`Closes #7`帰属。現時点で完成したと偽らない。
2. 変更ファイル全件と各ファイルの目的。旧source-boundファイル差分=0。新規epochのmanifest/report SHA、primary/secondary不変性digest。
3. Gate 1の実測値：元WASM存在／size／SHA／exports／P1 runtime SHA／復旧可能性と出所、必須の**個別失敗述語**。いずれか未確認なら`NOT RUN`。
4. Gate 2の20×7 coverage、参照archive SHA、max EARLY/LATE/shape誤差、MIDI96/v124残差、2軸保証、結果のSHAと保存実行有無。
5. すべてのテストコマンドと`PASS/FAIL/BLOCKED/NOT RUN`、未検証OS。Reviewer Checklist各項目を自己レビュー。
6. 元音響呼び出し累計3,251/5,255を維持し、今回の新audio0・build0・render0を証拠付きで報告。
7. 新たな仕様/契約の衝突と逸脱。停止時は exact blocker、必要な設計変更、独立に完了した作業を区別。
8. **Gate0–2完了はPR #8全体の完了ではない。** 製品の本受入れとIssue #7のクローズは、別のGate3–6契約下でのみ可能。必要なPRのcommit/push/URL/Issue workflow transitionができなければ`BLOCKED_DELIVERY`と報告。

## 引継ぎの効率化

この契約は既存ソース、WAV、spec/design本文を複製しない。各参照path/symbolに保持すべき事実と決定を明記している。実装者は詳細をリポジトリから読んでよいが、データ所有者・信頼レベル・禁止された回避策・分岐判断を独自に再設計してはならない。
