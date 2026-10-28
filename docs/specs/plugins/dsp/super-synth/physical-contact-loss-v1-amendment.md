<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->
# Issue #7 — Physical Contact Loss v1 Amendment (approved 2026-10-29)

## Authority and scope

- Issue: [#7](https://github.com/puchinya/soraoto_dsl/issues/7); implementation PR: [#8](https://github.com/puchinya/soraoto_dsl/pull/8).
- Explicit user approval is recorded as `ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED` in Issue #7, with [approval record](https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-6475747258).
- Decision-complete contract: [Gate 3–6 implementation instruction](https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-6473845875); approved Markdown SHA-256 `54838dfea9832f6da358a1c620567b09246a54fdd26fb807bc74d4ceeb6dc4aa`.
- This amendment changes only the **future, independent `physical-contact-loss-v1` experiment**. The previous `physical-fit-v5-amendment.md` prohibition on reallocating its unused 42 acoustic calls receives a single, explicit exception here. Never amend historical P5 records, authorizations, or evidence.
- Gate0–2 evidence (`physical-root-cause-offline-v1/analysis-01/02/03`) is immutable. Its PCM metrics verify historical measurements, *not* the physical cause or product acceptance.

## Single mechanism and fixed matrix

The sole experimental variable is a shared scalar `alpha` applied to the existing preset-owned concert-grand hammer/felt contact-loss coefficients:

`contact_loss_soft = 0.08 * alpha`; `contact_loss_hard = 0.28 * alpha`.

The original force equation in `plugin.c::grand_strings_step`, felt hardness law, stiffness, mass, bridge, board, final gain, and all unrelated presets remain unchanged. Only this **one physical dissipation mechanism** may be tested; no MIDI-specific EQ, compensation, sample interpolation, alternate fit direction, or threshold relaxation.

The experiment order MUST be `alpha = [1.00, 0.50, 0.65, 0.80, 1.20, 1.40]`; for each alpha, MUST render, in order, exactly `[(90,31),(93,31),(96,14),(96,31),(96,36),(96,124),(99,31)]`. The first seven cells are the **new-build alpha=1 baseline**, not historical audio replay. No preliminary random trial, interpolation, dynamic candidate addition, extra velocity layer, or budget rollover is permitted. At most **42 new acoustic calls** may be charged for Gate 4; an incomplete start counts as charged.

The Gate 3 read-only report MUST authenticate the original P1 diagnostic identity and all historical 20×7 PCM/metadata records via the accepted Gate0–2 verifier; report original IDs, source tags and signed EARLY/LATE residuals, with MIDI96/v124 EARLY≈−10.198791 dB and LATE≈+0.160331 dB identified as observations, **not proof of contact-loss causation**. Do not conflate differently sourced historical Stage3 cells.

## Diagnostic setter, safety and ownership

Only `concert_grand` (engine 9) with a valid selected factory profile and zero active voices permits the **test-only** WebAssembly exports `soraoto_supersynth_contact_loss_set(float)` / `soraoto_supersynth_contact_loss_get(void)`. Reject all nonfinite, noncanonical, wrong-engine, active-voice and invalid-profile operations without altering any state, buffers or future output. A canonical accepted value (absolute error ≤1e−6 against a fixed alpha) sets both coefficients using the **unmodified profile base values**, not cumulative multiplication, and resets the DSP state. Getter reports current alpha or a rejection sentinel for an invalid profile.

`SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS` is OFF by default. ON requires BUILD_TESTING and guard diagnostics, is incompatible with physical-identification mode, and exports the two setter/getter functions **only** for the isolated diagnostic artifact. The regular production/test/release plugin ABIs, 157 parameter IDs, public DSL and selected factory-preset schema MUST remain unchanged. At alpha=1, diagnostic PCM MUST retain the current model's baseline behavior.

## Official gate and bounded budget

Use existing `stage3-direct-reference-metrics.cjs::evaluateDirectReferenceMatrix` and the official loss evaluator, with all seven authenticated Salamander V3 reference cells and a single shared gain fixed by the approved method. A candidate is eligible **only** if all seven direct-reference hard gates pass, including post-attack shape ≤10 dB, direct-level absolute error ≤20 dB, dynamic span ≤8 dB, spectral/brightness checks, finite output, peak <0 dBFS and exactly zero guard hits. Never replace a hard-gate failure with a better research loss. If multiple full passes exist, select deterministically by hard violation, official family loss, |alpha−1|, then alpha ascending. If alpha=1 baseline is unsafe or unauthenticated, stop before the remaining 35 calls. If no candidate has a complete PASS, terminate `PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT` with Stage3/4 NOT RUN; no rerun/expanded search is allowed.

The historical budget remains **3,251 / 5,255**. The accepted new exception allows at most 42 Gate4 calls and **reserves 1,962 for later acceptance only**: 25 confirmation, 4 headroom, 24 test/release PCM, 486 Stage3, 1,423 Stage4. No other transfer, borrowing, or increase is authorized. Every next stage is conditional on complete, stored PASS of all predecessors. Test/release builds may differ in WASM SHA/diagnostic exports; equivalence requires existing ≤1e−6 per-sample PCM error on twelve pairs and no other release/ABI mismatch.

## Evidence and runtime behavior

Use only new `physical-contact-loss-v1/experiment-01` mirrored epoch in `<git-common-dir>/soraoto-agent-state/7/` and `$HOME/.soraoto-agent-archive/soraoto_dsl/7/`, bound to exact approved contract/PR HEAD/source, frozen original inputs and reference archive SHA. Keep old v3/v4/v5, reviews, root-cause and offline analysis-01/02/03 SHA/size/mtime unchanged. For each call: durable mirrored start marker → actual render → mirrored WAV and metadata → SHA/fsync/readback → completed marker. Unclear or conflicting starts are permanently charged and not retried. Failed writer/reentrancy/owner destruction preserves ambiguous evidence; no repair, deletion or rewriting. `--status`, `--analyze`, `--verify` are strictly read-only and zero-build/zero-render/zero-call.

`--prepare` must bind approved contract, exact PR/source identities and both evidence inventories before any call. `--run-bounded` must enforce the fixed 42 maximum and finite terminal. `--continue-approved` may progress only through 25 → 4 → two-file preset/header promotion → 24 → 486 → 1,423 and never after an official failure. Promotion may modify the concert-grand contact-loss coefficients in `presets.json` and the generated `super-synth_grand_profiles.h` **only after** holdout/headroom PASS. Keep `interface.soraoto`, the existing original acoustic runner/writers and frozen evidence unchanged.

## Observable acceptance and verification

Synthetic fixed-grid, setter mutation, safety, hard-gate rejection, charge-before-render/ambiguous-call, dual-copy lock/partial, immutable prior evidence, stale PR HEAD, selected alpha, all gate FAIL branches, production export absence, test/release PCM equivalence and exact 486/1423 lifecycle/adjacent checks MUST be tested. Confirm real audio only on an authorized host with the authentic Salamander archive, frozen previous evidence, actual WASM artifacts and fixed PR HEAD; a fixture cannot substitute. Run CMake/CTest, focused Node tests, frozen offline/v5 regression, then Web Player tests/build and listening only after real gate PASS. Record unverified platforms accurately.

**Approval is for the fixed finite experiment and existing ordered downstream gates, not a guarantee of product quality or PR merge.** Issue #7 remains OPEN/blocked and PR #8 unmerged until actual acoustic acceptance and final user/reviewer gates.
