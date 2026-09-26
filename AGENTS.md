# Repository Agent Workflow

This is the shared repository entry point for AI agents, including Codex and Claude Code. `CLAUDE.md` is only the Claude Code router and must defer to this file for shared rules.

Use `rtk` before shell commands. Use `rtk gh` for GitHub operations and `rtk git` for local Git operations.

## Task routing

For repository changes, identify the owning Issue or Pull Request before detailed investigation. Use an Issue or PR named by the user; otherwise make only the GitHub lookup needed to find an existing owner. If none exists, create an Issue with a concise scope and acceptance criteria, then set its phase to `phase:requirements` before broad investigation or edits.

Determine the current phase from the Issue label and PR state. Keep exactly one `phase:*` label on an active Issue; `blocked` and `needs-user-decision` are additional state labels. Read the relevant phase document before proceeding:

| State | Read |
|---|---|
| New request / `phase:requirements` | [`docs/agent-workflow/requirements.md`](docs/agent-workflow/requirements.md) |
| `phase:design` | [`docs/agent-workflow/design.md`](docs/agent-workflow/design.md) |
| `phase:ready` / `phase:implementation` | [`docs/agent-workflow/implementation.md`](docs/agent-workflow/implementation.md) |
| `phase:review` / open PR | [`docs/agent-workflow/review.md`](docs/agent-workflow/review.md) |
| Pause, resume, or evidence capture | [`docs/agent-workflow/checkpoint.md`](docs/agent-workflow/checkpoint.md) or [`docs/agent-workflow/evidence.md`](docs/agent-workflow/evidence.md) |

A supplied implementation contract is a handoff, not a workflow bypass. Associate it with the owning Issue, preserve its exact contents under `.agent-state/issues/<number>/` when it must survive a context or machine change, and resolve any conflict against the approved Issue and normative specification before implementation.

## Repository authority

Start documentation lookup at [`docs/README.md`](docs/README.md), then the relevant category README, then only the document or specification sections needed for the task.

- [`docs/specs/soraotoDSL/soraotoDSL.md`](docs/specs/soraotoDSL/soraotoDSL.md) and its `spec/*.md` modules are the normative DSL source. Edit the root or owning module. [`soraotoDSL-full.md`](docs/specs/soraotoDSL/soraotoDSL-full.md) is a generated snapshot; do not edit it directly.
- `docs/specs/soraotoDSL/spec/09-conformance.md` defines conformance expectations. The `Maintenance` section of the specification documents `tools/validate-spec.py` and `tools/build-full.py`.
- Source code is the implementation, tests are executable evidence, and `web-player/README.md` plus `wasm/CMakeLists.txt` document the available build and test entry points.
- Keep requirements, architecture decisions, implementation, and current status in documents with those responsibilities. Do not use implementation status or examples to override normative rules.

## Working rules

- Stay within the approved Issue scope. Do not combine unrelated cleanup or silently decide a material change to DSL semantics, plugin ABI, compatibility, architecture, or supported behavior.
- A public syntax, semantic, interchange, or ABI change must update its owning normative specification and relevant conformance coverage. Regenerate the full snapshot from the split source.
- Keep the working set small: owning Issue/PR, active phase document, relevant spec sections, affected source/tests, and the task diff. Keep large logs and temporary screenshots out of committed source.
- Run focused verification that covers the acceptance criteria. Report each check as PASS, FAIL, NOT RUN, or BLOCKED with the command and relevant result. Do not describe a build or page launch as proof of browser interaction or audio behavior.

## Delivery

Before implementation is reported complete, commit and push the scoped changes, open a PR containing `Closes #<issue-number>`, move the Issue to `phase:review`, and follow the review workflow. Report the exact blocker if a delivery transition cannot be completed. The Issue is complete after the PR is merged and GitHub closes it.

For the full phase gates, read the [workflow guide](docs/agent-workflow/README.md).
