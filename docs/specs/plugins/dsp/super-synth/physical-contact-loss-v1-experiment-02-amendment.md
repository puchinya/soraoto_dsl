<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# Issue #7 — Physical Contact Loss experiment-02 Amendment

- **Status:** approved by the user on 2026-11-14 JST
- **Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7)
- **Implementation:** [PR #8](https://github.com/puchinya/soraoto_dsl/pull/8)
- **Approval marker:** `ISSUE7_CONTACT_LOSS_V1_EXPERIMENT_02_APPROVED`
- **Contract:** [experiment-02 successor contract](../../../../design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-contract.md)

## Authority and narrow supersession

This amendment supplements the approved [Physical Contact Loss v1 amendment](physical-contact-loss-v1-amendment.md). It supersedes only that amendment's experiment-01-only epoch destination and allocation destination. Experiment-01 remains immutable and its prepare record remains bound to HEAD `ebc63ea6a32fa20ed531fa5cc9a517dd7693b38c`.

The user authorized one append-only successor epoch because experiment-01 has exactly 0 started, 0 completed, and 0 ambiguous calls. No other epoch is authorized. All physical, acoustic, quality, compatibility, and downstream acceptance decisions remain those of the original contract.

## Parent identity and preservation

Experiment-02 MUST use the fixed dual-store paths:

- `<git-common-dir>/soraoto-agent-state/7/physical-contact-loss-v1/experiment-02/`
- `$HOME/.soraoto-agent-archive/soraoto_dsl/7/physical-contact-loss-v1/experiment-02/`

Before any new-epoch write, verify experiment-01 has exactly these mirrored root members: `prepare.json`, `plan.json`, and `gate3-analysis.json`. Their SHA-256 values MUST be, respectively:

- `c49362c8db61ec223f78e7a326fb34eb6c49dd24f06bf48ea90bcc6d4624a24e`
- `7d80f490439baa0ca022c2372c1bcbb8236ba5315d8dd31784cd7673cb9f639b`
- `5b406ba0921e87fa8df3c0177fb2f8fc0f239eb611ed37f47c650d7220d39636`

Both copies MUST agree byte-for-byte. The predecessor prepare identifies HEAD `ebc63ea6a32fa20ed531fa5cc9a517dd7693b38c`, archive SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b`, and 0/0/0 calls. There MUST be no experiment-01 terminal, selection, call marker, WAV or metadata. Capture the two stores' full SHA/size/mtime snapshot before and after successor preparation; any mutation or unknown entry blocks and is preserved.

Experiment-02 `prepare.json` MUST record the parent epoch name, exact parent prepare/plan/Gate3 hashes, parent call totals, both-copy inventory, and source/HEAD/WASM identities. It MUST bind the exact successor contract hash and both Issue approval markers. Readers MUST validate the complete parent proof on every preparation, verification, and continuation.

## Reused one-time call allocation

The single existing 42-call authorization transfers to experiment-02 because experiment-01 has 0 charged calls. The sum of calls started in experiment-01 and experiment-02 MUST never exceed 42. Do not interpret the successor as a second 42-call allocation.

The fixed alpha order, seven stress coordinates, baseline safety gate, official metric evaluator, hard thresholds, candidate selection, failure terminal and Stage3/4 order remain byte-for-byte as specified by the original amendment. Historic calls remain 3,251; the downstream reserve remains 1,962; the lifetime ceiling remains 5,255. If no complete candidate passes all official gates, use `PHYSICAL_CONTACT_LOSS_FAMILY_INSUFFICIENT`; do not run downstream calls.

## Runtime identity and failure behavior

- All new writes MUST occur under experiment-02. Experiment-01 is read-only parent evidence.
- Only `--prepare`, bounded execution, and approved continuation may write experiment-02. Read-only status/analyze/verify must report the selected epoch, parent identity, call totals, and HEAD relation without writing or changing mtimes.
- Before the first new acoustic call, require the Issue approval marker, original approval marker, exact open PR #8 head and branch, clean tree, exact current source snapshot, accepted current-HEAD Gate3 report, authenticated Salamander archive, and matching diagnostic WASM build.
- A partial/unknown parent, copy divergence, nonzero predecessor call, stale PR/HEAD, source or WASM drift, missing archive, lock conflict, partial write or ambiguous call MUST fail closed. Do not repair, delete, re-sign, re-label or rerender evidence.
- This approval authorizes no experiment-03. If identity changes after experiment-02 is prepared, preserve it and stop.

## Acceptance boundary

Passing these evidence and runtime checks authorizes the fixed experiment and existing downstream gates; it is not acoustic acceptance. Only a complete measured Gate4 hard-gate PASS permits the already approved 25 confirmation calls, 4 headroom calls, promotion, 24 release-equivalence calls, 486 Stage3 calls, and 1,423 Stage4 calls, in that order. Any failure blocks all later calls. Manual listening, Web Player acceptance, review, PR merge and Issue closure remain separate final gates.
