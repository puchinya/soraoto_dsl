# Issue #7 — Stage2F Anchor Requalification

**State:** `BLOCKED_NO_CURRENT_STAGE2_ANCHOR` — Issue #7 remains `phase:implementation` + `blocked`; PR #8 remains the delivery PR.

The three historical Stage-2-pass candidates were resolved from saved provenance and six-axis vector matches, then freshly re-rendered with production SIMD under the current Stage2E evaluator. All pass Stage1 and Stage2 pitch, measurement, finite, peak, guard, and low-buzz gates. Each fails only the current release-tail-2 minimum, so the Stage2F local design is locked by contract.

## Anchor provenance and requalification

Manifest SHA-256: `17a8a88df8b8644bfb497808383c910478544e5939c03a44688f775a420d43e6`.

| Historical result | Resolved Stage2 candidate/trial | Strike | Compression | Base hardness | Inharmonicity | Damping | Unison | Stage1/2 | Worst valid pitch | Stage2 peak | Buzz | Release tail 2 | Violation |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| `stage2b-v1-0001` | `split-v3-s2-0001` | 0.1371616458 | 0.0005000000 | 0.3355742391 | 0.0836683161 | 1.0000000000 | 1.0000000000 | PASS / PASS | 10.5318 cents | -12.1430 dBFS | 0.113242 | 0.0001454753 | +0.0301647 |
| `stage2b-v1-0015` | `split-v3-s2-0015` | 0.1362664439 | 0.0005536096 | 0.4112116697 | 0.0564307460 | 1.0000000000 | 0.9845754031 | PASS / PASS | 9.0954 cents | -11.6634 dBFS | 0.113184 | 0.0001434910 | +0.0433935 |
| `stage2b-v1-0016` | `split-v3-s2-0016` | 0.1366412018 | 0.0005338319 | 0.3719079878 | 0.0659700726 | 1.0000000000 | 0.9855708494 | PASS / PASS | 9.6007 cents | -12.2407 dBFS | 0.110597 | 0.0001438031 | +0.0413125 |

The release-tail-2 limit is `0.00015`. All three anchors have zero measurement-invalid cells, zero guard hits, finite output, zero stuck voices, passing held decay and other release predicates. Their unison values exceed the calibration-only floor of `0.4`. The public Plugin unison range remains `[0.0, 1.0]`.

## Stage2F accounting

- Current anchors: 0 eligible of 3.
- Anchor requalification renders: 3.
- Local points: 0 rendered; all seven-point designs remain unentered.
- Deduplicated points: 0.
- Physical-evaluation budget: 3 of 25.
- Stage 3 (480 cells), Stage 4 (1,408 lifecycle / 1,392 adjacent), and final bake: not run.
- No Stage2E study, production preset, DSP equation, public parameter, ABI, or version changed.
- Calibration search bound: `piano_string_unison` is `[0.4, 1.0]` in the active search-space registry.

## Verification

- PASS — Python tuning unit tests: 52/52; Python 3.13.0, Optuna 5.0.0.
- PASS — Stage2F anchor/design/schema/pitch diagnostics tests: 6/6.
- PASS — WASM configure and production-SIMD build.
- PASS — Candidate, velocity-hardness, and termination-floor overlay tests.
- PASS — Pitch estimator conformance: 96 fixtures; worst error 1.4751 cents; zero octave/partial locks; deterministic.
- PASS — Board-fit focused test and paired-build soundboard diagnostic transparency.
- PASS — `concert-grand-regression.test.js`: peak -31.8194 dBFS, guard 0, pitch C4 -0.7175 cents / E5 +3.5118 cents, brightness 1.27397, low-bass buzz 0.11901, board-control difference 0.000401.
- NOT RUN — 480 direct, 1,408 lifecycle, 1,392 adjacent, full CTest, Web Player tests/build, and final artifact/privacy acceptance because no anchor qualified.

This result identifies a new current-schema blocker: the historical anchors do not meet the existing Stage2E release-tail-2 minimum. It does not authorize changing the threshold, mutating anchors, widening search, or adding a physical axis. Return to design before further anchored tuning.

Delivery note: the Stage2F tool chain depends on the current local `constraints.py`, `run_stage2e_termination_joint.py`, `evaluate-stage2b-candidate.cjs`, and `evaluate-calibration-candidate.cjs`, which are not tracked in PR #8's current baseline. Those dependencies remain pre-existing uncommitted/untracked work. No Stage2F commit or push was made because committing only the new files would leave them unusable on the PR branch, while staging the larger dependency set would exceed the isolated Stage2F scope.
