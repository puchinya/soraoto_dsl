# Pause and resume

Use this document when work needs to continue in a later session or on another machine.

## Local checkpoint

Keep one concise checkpoint at the Git-ignored local path:

```text
.agent-state/issues/<number>/checkpoint.md
```

Record only:

- objective and current Issue phase;
- branch and current HEAD;
- completed work and current state;
- exact last verification and result;
- uncommitted files;
- one concrete next action and any blocker.

Do not store reasoning transcripts, full logs, secrets, or a copy of an implementation contract. Keep contract artifacts separate and preserve their exact contents.

## Resume

On resume, inspect current Git status, branch, HEAD, Issue/PR phase, and the task diff. GitHub and repository state take precedence over a stale checkpoint. Re-read the active phase document, relevant normative specification sections, and any preserved contract before continuing material implementation or review decisions. Re-run verification that may be stale after changes.

Local checkpoint files are not shared between machines. For a cross-machine handoff, post one concise checkpoint to the owning Issue using a UTF-8 file and `rtk gh issue comment <number> --body-file <file>`. Include branch, HEAD, completed work, next action, verification, and blockers; never paste secrets or the full contract.
