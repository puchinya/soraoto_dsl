<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Physical Fit v5 Review Amendment 02 Design

**Status:** User-authorized PR #8 review remediation  
**Owner:** Issue #7 / PR #8  
**Predecessor:** `current-build-v5-review/continuation-01`

## Context and goals

The prior review harness had four gaps: persisted unresolved calls did not stop a different call after restart; repeat results were overwritten with the original metrics; Stage4 skipped the existing adjacent and Stage3-equivalence checks; and headroom compared only the loudest value across patterns while using the candidate tuple for baseline captures. The goal is to close those exact gaps without changing the frozen v5 experiment or running audio/build work.

## Architecture

- The shared call recorder remains the authority for dual-store markers and accounting. `startCall` checks persisted unresolved totals before charging any new call.
- Stage4 collection retains each backend row as captured. `run-issue7-stage4-current-build.cjs::evaluate` owns both the official fixture conformance handoff and Stage3 output equivalence.
- The test backend builds an expected matrix from the checked-in reference fixture using the same interpolation fields used by the official full-range test. Its controlled input uses zero stereo pan and raises a velocity layer only when needed to keep the adjacent layer drop within 0.5 dB; the reference file and product output remain untouched. Negative fixtures perturb one guarded property at a time.
- Headroom cases carry their full note arrays, velocity, build identity, and parameter tuple in the plan and call identity. Pairing and delta checks are keyed by the explicit pattern name.
- The writer's epoch and runtime revision path advance to continuation-02. Prior continuation-01 files are read only and their identity is recorded as predecessor provenance.

## Data flow and ownership

The synthetic backend returns independent results to the recorder. The recorder writes the raw result into both stores. Stage4 receives the original results, constructs the lifecycle document, and invokes the existing evaluator. The evaluator writes only its temporary lifecycle handoff into the isolated test stores and invokes the repository fixture test with that handoff path; it does not render audio. Headroom evaluation reads two explicit baseline/candidate pairs and compares each pair separately.

## Failure handling

Unresolved prior calls block before marker creation. Any repeat, official conformance, Stage3 equivalence, or pattern-specific headroom failure returns a blocked decision. Runtime preparation rejects uncommitted sources, mismatched continuation-01 provenance, or divergent dual-store copies.

## Alternatives considered

- Reusing the continuation-01 namespace was rejected because its source identity is already pinned by an immutable record.
- Copying original Stage4 metrics into repeat rows was rejected because it discards the independent repeat result.
- Injecting an unconditional passing callback was rejected because it bypasses the shipped conformance fixture and output comparator.
- Comparing maxima across patterns was rejected because it can hide a regression in one pattern.

## Requirements traceability

| Requirement | Implementation evidence |
|---|---|
| Stop after a charged unresolved call, including restart | `issue7-physical-fit-v5-review-core.cjs`; recovery test |
| Preserve independent repeat metrics | `run-issue7-physical-fit-v5-review.cjs`; repeat mismatch test |
| Run adjacent conformance and Stage3 equivalence | `run-issue7-stage4-current-build.cjs::evaluate`; two negative Stage4 tests |
| Enforce fixed per-pattern headroom | Review runner; baseline identity and one-pattern violation tests |
| Preserve prior evidence and bind new revision | continuation-02 dual-store runtime revision |

## Verification strategy

The focused review test suite must cover the positive synthetic path and each negative boundary. The source-bound continuation-02 runtime record is prepared only after the final remediation sources are committed and pushed. No test result is represented as real acoustic acceptance.
