<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# Physical Root-Cause Read-Only v1 Amendment (Issue #7)

**Status:** User approved on 2026-10-19. **Contract SHA-256:** `5031773c8cf3326a5b0cf495d1fa09e6561b55b03afc380e03b2073c20c785c0`.

## Scope and invariants

This is a new *read-only physical-cause attribution workstream* on PR #8; review continuation-02 remains separate. The source of truth is the frozen Physical Fit v5 P5 parent at `7ab88ce5b857423ec1d278e8741e963f4e33cd56`, plus verified v3/v4 evidence. The frozen decision remains `BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT`. No DSP or parameter changes, builds, WAV creation, acoustic render/call, acceptance progression, or retuning of a quality gate are allowed.

The existing acoustic budget is unchanged: 3,251 charged / 5,255 maximum; 1,962 later acceptance calls reserved and 42 calls not transferable to this analysis. This amendment permits **zero** real acoustic calls.

## Evidence and metrics

- Inspect frozen P5, v3 and v4 source digests, 20 observations (8 v3 + 12 v4), seven ordered stress cells per observation, all 140 stored WAV and metadata identities, both stores' SHA/size/mtime inventory, and the current HEAD's ancestor relationship to P5.
- The authoritative reader is `run-issue7-physical-fit-v5.cjs::readOnlyDiagnosis`; it recomputes official metrics from the stored audio. Compare regenerated records to the frozen P5 history by original observation ID, parameter tuple, cell order and artifact SHA.
- The authoritative shape definition is `stage3-direct-reference-metrics.cjs::postAttackResiduals`: EARLY = (synth envelope[2]-synth envelope[3])-(reference envelope[2]-reference envelope[3]); LATE similarly uses index 4 relative to 3; shape = max(|EARLY|, |LATE|). Never discard signed values, round before comparison, or change shared gain/analysis windows. Require absolute tolerance 1e-6 dB for every saved/recomputed observation.
- Report all 140 signed residual pairs with v3/v4 provenance and each observation's official violations; isolate MIDI96/velocity124 and list other stress cells.
- Historical Stage3 MIDI96/velocity31 and 36 direct-level errors +22.4910715 and +20.1684955 dB, respectively, belong to another measurement lineage. Do not combine as current-candidate failures without matching SHA, build, preset, reference, window and capture identities.
- The September 30 `STRING_TERMINATION_DECAY` diagnosis is only an earlier hypothesis. If underlying measured source/capture/build/reference/window identities cannot be proved compatible with the current P5 record, label it `HISTORICAL_CAUSAL_EVIDENCE_NOT_COMPARABLE` and do not make a numeric cross-study causal claim.
- The current MIDI96/124 dominant component is selected from signed measured EARLY/LATE magnitudes; label the hypothesis `TERMINATION_PRIORITY_HYPOTHESIS`, `HAMMER_EARLY_PRIORITY_HYPOTHESIS` or `MIXED_OR_UNRESOLVED`. If evidence is insufficient, label `INSUFFICIENT_EVIDENCE`. `MODEL_CAUSE_CONFIRMED` is prohibited.
- Explain for each hypothesis supporting observations, contradictory evidence, and at least one falsifiable prediction / proposed minimal *future* experiment. A proposal never triggers an experiment.

## CLI and private publication

`analyze-issue7-physical-root-cause-v1.cjs` exposes `--analyze`, `--verify`, and `--publish`. The first two modes must be read-only, producing JSON stdout; `--verify` may report `NOT_PUBLISHED` before publication. `--publish` requires exact issue-approved contract SHA, clean committed source, pushed open PR #8 HEAD readback, frozen source and inventory validation, and must append the deterministic numeric report, Markdown summary, runtime identity and manifest in separate SHA/size-matched private copies.

Allowed isolated namespace: primary `<GIT_COMMON_DIR>/soraoto-agent-state/7/physical-root-cause-v1/analysis-01/`; secondary `$HOME/.soraoto-agent-archive/soraoto_dsl/7/physical-root-cause-v1/analysis-01/`. No raw WAV, private absolute paths, or credentials in committed or published reports. An existing identical record is reused without touching mtime; mismatch, symlink, ambiguous partial copy or lock contention blocks. Do not delete an incomplete original or silently repair evidence.

## Observable stopping conditions and verification

Unverifiable parent/file/metric/hash/mtime identity must fail closed before attribution or publication. Read-only work must leave historical and review-01/02 evidence byte-for-byte and mtime-identical. Unit tests require signed components, history matching, provenance segregation, lack of legacy causal equivalence, deliberate corruption and read-only/dual-store publication scenarios. Synthetic fixtures are never evidence for acoustic acceptance. Web Player, Stage3/4, production builds, ctest and manual listening remain NOT RUN. Issue #7 remains OPEN and blocked; PR #8 remains OPEN, unmerged.
