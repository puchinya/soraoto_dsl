# Claude Code instructions

Claude Code must follow the repository-wide rules in [`AGENTS.md`](AGENTS.md). This file is only the Claude Code entry point; it does not redefine the shared workflow, document authority, or product behavior.

## Claude Code routing

1. Before Plan Mode, creating a plan or task list, or broad repository investigation, follow Task routing in [`AGENTS.md`](AGENTS.md).
2. After bootstrap, read the owning Issue's active phase and only the corresponding workflow document listed in [`AGENTS.md`](AGENTS.md).
3. Start document lookup at [`docs/README.md`](docs/README.md), choose the relevant category index, and inspect only the needed document or specification sections.
4. Use [`docs/specs/soraotoDSL/spec/09-conformance.md`](docs/specs/soraotoDSL/spec/09-conformance.md), [`web-player/README.md`](web-player/README.md), and `wasm/CMakeLists.txt` to find relevant conformance, build, and test guidance.
5. Use `rtk gh` for GitHub operations and `rtk git` for local branch/commit/push operations, as required by [`AGENTS.md`](AGENTS.md).

Do not scan every specification module or treat implementation code as the normative contract.
