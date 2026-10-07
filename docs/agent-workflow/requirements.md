# Requirements phase

Read this document for a new request or an Issue labeled `phase:requirements`.

## Goal

Turn the request into a small, owned, verifiable scope before detailed investigation or implementation.

## Required actions

1. Confirm the owning Issue or PR. If none exists, make only the minimal GitHub lookup; create an Issue with the request, known affected area, open questions, and acceptance criteria, then label it `phase:requirements`.
2. Separate the objective, functional requirements, non-goals, constraints, acceptance criteria, and unresolved decisions in the Issue.
3. Classify the change: normative DSL or ABI contract, internal architecture, implementation, bug fix, documentation, or verification.
4. For a contract or other user-supplied file that constrains the change, preserve the original artifact with the Issue or in `.agent-state/issues/<number>/` before implementation. Do not replace it with a paraphrase.
5. Identify the relevant part of the normative source at `docs/specs/soraotoDSL/soraotoDSL.md` and its owning `spec/*.md` module. Do not scan unrelated modules as a substitute for clarifying scope.
6. Record external inputs required by acceptance criteria and confirm their authoritative location. If a required input is missing, record the exact blocker and do not replace it with fabricated or unrelated data.

Use `rtk gh` for Issue and label changes. Multiline Issue content must be written with real newlines and passed with `--body-file`; use `--body` only for genuinely single-line text.

Do not begin implementation or run implementation-only self-review during this phase. If a material choice about DSL behavior, ABI, compatibility, architecture, or scope is unresolved, record it and use `needs-user-decision`.

A supplied implementation contract does not bypass phase gates. Preserve it byte-for-byte, resolve its scope against the Issue and normative sources, and carry its acceptance criteria into design and the Reviewer Checklist before implementation.

## Completion

The user-approved objective and acceptance criteria are recorded, material blocking questions are resolved, and the Issue moves to `phase:design`. Remove `needs-user-decision` when no user decision remains. Use `blocked` only for an external or technical blocker.
