# Agent workflow

This workflow uses one owning GitHub Issue and a single active phase label:

```text
phase:requirements -> phase:design -> phase:ready
phase:ready -> phase:implementation -> phase:review -> merged/closed
```

`phase:ready` means the requirements, design, and Reviewer Checklist are approved. `blocked` and `needs-user-decision` are additional labels that explain why progress stopped; they do not replace the phase label.

| Document | Use it for |
|---|---|
| [`requirements.md`](requirements.md) | Scope, ownership, acceptance criteria, and unresolved decisions |
| [`design.md`](design.md) | Specification ownership, implementation boundaries, approval, and Reviewer Checklist |
| [`implementation.md`](implementation.md) | Scoped changes, project verification, self-review, and PR transition |
| [`review.md`](review.md) | PR contents, review comments, remediation, and closure |
| [`evidence.md`](evidence.md) | Logs, screenshots, and browser/audio observations |
| [`checkpoint.md`](checkpoint.md) | Pause and resume across sessions or machines |

Start with [`AGENTS.md`](../../AGENTS.md), the shared entry point for repository workflow. [`CLAUDE.md`](../../CLAUDE.md) is a Claude Code router to those same rules. For repository-specific authority, use the split normative documents under `docs/specs/soraotoDSL/`; consult the Web Player README and CMake configuration for current build and test commands.
