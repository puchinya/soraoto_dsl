# Review phase

Read this document while an associated Issue is labeled `phase:review` or its PR is open.

## Pull Request content

Keep the PR focused on the approved delta. Include:

- what changed and why;
- the owning Issue using `Closes #<issue-number>`;
- verification commands and PASS/FAIL/NOT RUN/BLOCKED results;
- relevant evidence and any known limitation.

Do not copy the full requirements or design into the PR. Do not claim browser interaction, plugin lifecycle, or audio behavior without direct evidence.

## Review handling

1. Read all actionable review comments and required CI results.
2. For each comment, make the change, explain why no change is appropriate, or create a follow-up Issue for valid out-of-scope work.
3. If review changes a material requirement or public contract decision, update the owning Issue/specification, return to `phase:design`, and obtain approval before continuing.
4. After code or specification remediation, rerun affected verification, inspect the complete updated diff, and repeat the self-review. Prior evidence is stale after a relevant change.
5. Keep unrelated cleanup and follow-up work out of the PR. Do not resolve review threads until they have been addressed or answered.

## Completion

When all review comments are addressed, required checks pass, and the PR is ready to merge, keep the Issue in `phase:review`. The Issue is complete when the PR is merged and GitHub closes it through `Closes #<issue-number>`.
