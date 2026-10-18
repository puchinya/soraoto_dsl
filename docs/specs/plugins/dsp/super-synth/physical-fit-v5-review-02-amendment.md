<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# Physical Fit v5 Review Amendment 02

**Status:** User-authorized remediation of PR #8 review findings  
**Owner:** Issue #7 / PR #8  
**Predecessor:** `current-build-v5-review/continuation-01` (immutable)

## Purpose

Correct four fail-open or incorrectly modeled paths identified in PR #8 review comment 6249816929. This amendment is limited to the v5 review harness and its synthetic verification. It does not change the Physical Fit model, candidate thresholds, supported parameter box, production behavior, runtime ABI, v5 terminal decision, or acoustic call budget.

## Scope

- Block every new call while any prior charged call is ambiguous or incomplete, including after a writer restart.
- Preserve independently captured repeat metrics and fail Stage4 when a repeated metric differs from its original.
- Route Stage4 through the existing current-build evaluator so its fixture-based 1,392 adjacent/velocity comparisons and Stage3 output-equivalence comparison both gate completion.
- Use explicit velocity-124 note patterns and fixed baseline parameters for headroom; enforce the +0.1 dB peak allowance separately for each pattern.
- Add focused negative tests for each corrected guard and a positive synthetic path exercising the real evaluators.
- Write new audit/runtime/terminal records only under `current-build-v5-review/continuation-02`. Do not modify or reuse continuation-01 records.

## Normative requirements

### Charged-call recovery

Before creating any new start marker, the writer must inspect its current persisted accounting. If `ambiguous > 0` or `incomplete > 0`, it must fail with `BLOCKED_REVIEW_UNRESOLVED_CALLS`. This applies to a new writer session after process restart and must not alter call accounting. Reusing an already-complete call with an identical identity remains permitted.

### Repeat evidence

The Stage4 repeat evidence must retain the metrics returned by that repeat call. The Stage4 evaluator must compare the persisted repeat metrics with the original cell metrics and reject any mismatch. The raw repeat result must remain available in the immutable call evidence.

### Stage4 gates

The review runner must use `run-issue7-stage4-current-build.cjs::evaluate`. Completion requires the official full-range fixture conformance test to pass, including all 1,392 adjacent pitch/velocity comparisons, and the 486-cell Stage3/Stage4 output comparison at tolerance `1e-6`. A skipped, stubbed, or unconditional passing legacy callback is prohibited. The positive synthetic fixture may smooth its own stereo-pan value and any velocity-84 envelope dip so the controlled input satisfies those real gates; those test-only values do not alter the reference fixture or product output.

### Headroom identities and limits

Use two fixed MIDI note patterns: the ten-note pattern `[48,55,60,64,67,71,74,76,79,84]` and the 32-note pattern `[48,49,...,79]`. Each baseline/candidate pair uses velocity 124, 48 kHz, block size 128, two seconds total duration, and note-off at one second. The baseline tuple is exactly `[1.05,0.5,0.018]`; the candidate tuple is the selected v5 tuple. For each pattern independently, candidate peak dBFS minus its baseline peak dBFS must be at most `0.1`.

### Append-only evidence

This continuation is synthetic verification only. It performs zero real acoustic calls and zero builds. Keep the original v5 terminal BLOCKED result, continuation-01 records, all completed historical calls, and all budgets unchanged. Bind continuation-02 records to the committed source hashes and the exact current HEAD.

## Observable behavior

- A resumed writer with an unresolved call cannot create a different call ID; the persisted call counts are byte-for-byte unchanged by the rejected attempt.
- A repeat mismatch, an adjacent-conformance violation, a Stage3/Stage4 output mismatch, or a per-pattern headroom violation produces a blocked decision and cannot produce `STAGE4_FULL_RANGE_COMPLETE`.
- Synthetic positive evidence reaches the real Stage4 gates only when fixture conformance, repeats, lifecycle checks, and Stage3 output equivalence pass.
- The continuation-02 runtime identity names continuation-01 as its immutable predecessor and is stored separately in both configured evidence stores.

## Error and boundary behavior

Missing or non-finite headroom peaks, absent patterns, incomplete repeat rows, unresolved charged calls, missing Stage3 cells, legacy-test failure, or source/dual-store identity drift fail closed. No failed synthetic scenario may advance to a later stage.

## Security and privacy

The v5 review evidence remains in the existing private dual-store layout. No raw audio or new acoustic capture is authorized by this amendment. The separate continuation-02 namespace prevents overwriting prior review evidence.

## Verification strategy

Run the focused review test suite, including restart recovery, one-pattern headroom violation, repeat mismatch, adjacent-conformance violation, and Stage3/Stage4 mismatch cases. Then commit and push the exact reviewed sources, prepare and verify continuation-02 against that HEAD in both stores, and rerun the source/dual-store checks. Report each result with its command and PASS/FAIL/NOT RUN/BLOCKED status.
