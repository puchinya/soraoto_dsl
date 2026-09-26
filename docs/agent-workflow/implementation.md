# Implementation phase

Read this document for an Issue labeled `phase:ready` or `phase:implementation`.

## Start

Before editing:

1. Re-read the approved Issue, acceptance criteria, Reviewer Checklist, and any newer decision that supersedes them.
2. Confirm the implementation agrees with the owning normative specification. If the spec is incomplete or contradictory, stop and return to requirements/design rather than deciding public behavior in code.
3. For a new source branch, use `codex/issue-<number>-<short-description>`; keep documentation-only work similarly scoped. Do not reset, clean, or overwrite unrelated work.
4. Move the Issue from `phase:ready` to `phase:implementation`.

## Implementation rules

- Implement only the approved scope and keep the diff focused.
- For public DSL or ABI behavior, update the owning split normative module and affected conformance tests. The split modules are the only normative source; do not generate a full snapshot.
- For internal or implementation-only changes, do not change normative behavior to match a bug. Update tests for changed behavior and relevant regressions.
- Keep generated artifacts intentional. Do not commit build products from `build/wasm/` or `web-player/dist/` unless the approved scope specifically requires them.
- If a new material requirement or architecture decision appears, stop and return to requirements/design.

## Verification

Select the checks that cover the changed area and the Issue's acceptance criteria:

| Change | Verification |
|---|---|
| Normative specification | Update the owning split module and relevant conformance coverage; check internal Markdown links and paths. Run a repository spec validator only if it exists in the checkout. No full snapshot generation is required. |
| Web Player behavior | From `web-player/`, run `rtk npm test`. Use `rtk npm run build` when the change affects the production build. |
| WASM/plugin behavior | From the repository root, configure with `rtk cmake -S wasm -B build/wasm -DCMAKE_TOOLCHAIN_FILE="$PWD/wasm/cmake/wasm32-clang.cmake"`, build with `rtk cmake --build build/wasm`, and run `rtk ctest --test-dir build/wasm --output-on-failure`. |
| Documentation-only change | Check links, paths, commands, and scope in the diff. Do not run an unrelated build or test suite. |

Run additional focused checks when the acceptance criteria require them. Record the exact command and result. A test that was not run is `NOT RUN`; unavailable runtime evidence is not a pass.

Browser or audio behavior requires actual browser interaction and observation. A successful compile, server launch, or test-page load alone does not prove playback, lifecycle cleanup, or audio quality. Follow [`evidence.md`](evidence.md) when screenshots, audio observations, or logs are part of review.

## Self-review

Stabilize the implementation and run required verification before final self-review. Inspect the complete task diff against the target branch and judge every task-specific Reviewer Checklist item as `PASS`, `FAIL`, or `N/A`. Attach concrete evidence to every `PASS` and a specific reason to every `N/A`.

Also verify:

1. Every acceptance criterion is satisfied or explicitly reported incomplete.
2. The change matches the approved Issue and normative specification.
3. No unrelated files, generated output, dependency changes, or private data entered the diff.
4. Tests cover changed behavior and important boundaries where applicable.
5. Specification, implementation, tests, and user-facing documentation are synchronized where their responsibilities changed.
6. The final reviewed diff is the diff being committed; any later change makes the review stale.

Do not report a failed or incomplete checklist as complete. After remediation, inspect the full diff and repeat affected verification and self-review.

## Transition to review

Commit and push the scoped work. Open a PR with `Closes #<issue-number>`, a concise change summary, verification results, and any known limitation. Move the Issue to `phase:review` and read [`review.md`](review.md). Implementation is not complete at edit, test, commit, or push alone.
