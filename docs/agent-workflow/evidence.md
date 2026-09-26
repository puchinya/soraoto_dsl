# Evidence capture

Use this document when logs, screenshots, audio observations, or other evidence are needed to review an Issue or PR.

## Storage

Keep temporary material under:

```text
.agent-state/issues/<number>/logs/
.agent-state/issues/<number>/screenshots/
```

Keep evidence local by default. Commit only a small artifact that is necessary for review or future reference; put it beside a concise `README.md` describing the OS, scenario, commit, command, and result. Keep baseline and golden test files with their tests.

## Rules

- Report the command, environment, commit, and observed result. Distinguish automated results from manual browser/audio observations.
- Do not commit full build logs, repeated warnings, private data, secrets, machine-specific paths, or large image/video/audio collections.
- Use an Issue or PR attachment for concise review evidence when needed; use CI artifacts for large logs, videos, or dumps.
- A page opening or WASM build is not evidence that interactive playback, lifecycle cleanup, or audio quality is correct. Name the exact interaction and observable result.
- Keep test fixtures and regression baselines in the test tree rather than Issue evidence storage.
