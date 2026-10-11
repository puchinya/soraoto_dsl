# Stage3E Incremental Verification Performance

Date: 2026-10-11

This change optimizes repeated Stage3E evidence verification without changing
acoustic rendering, the canonical ledger or journal formats, acceptance gates,
or the full-audit contract. Phase entry, phase exit, resume, and `--verify`
remain full audits. New cell bytes and their mirrors are still independently
read and SHA-256 checked before completion. In-process verification state is
discarded when a phase runner exits.

## Temporary-fixture benchmark

The benchmark used temporary primary/secondary roots, a synthetic renderer,
Darwin arm64, and Node.js v26.7.0. Acoustic renders: 0. Each mode ran three
times; medians are reported. The 64-cell timing set was repeated after the
final verifier adjustment. Counters are deterministic from one same-size
fixture run for each mode.

| Cells | Mode | Median elapsed | Full audits | File reads | Read bytes | SHA input bytes | Estimated opens | Ledger writes / bytes | Checkpoint time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 64 | Before | 11.250 s | 65 | 55,762 | 83,799,430 | 93,014,051 | 113,068 | 128 / 8,539,482 | 0 ms |
| 64 | Incremental | 7.605 s | 4 | 6,234 | 24,752,360 | 34,298,383 | 14,016 | 128 / 8,539,482 | 96 ms |
| 256 | Before | 111.030 s | 257 | 812,626 | 1,311,681,616 | 1,447,642,505 | 1,631,404 | 512 / 133,270,604 | 0 ms |
| 256 | Incremental | 33.156 s | 7 | 35,742 | 314,668,634 | 452,542,667 | 77,652 | 512 / 133,270,604 | 637 ms |

The measured median elapsed time fell by 32.4% at 64 cells and 70.1% at 256
cells. The estimate counts `readFileSync` operations plus explicit `openSync`
calls; it is not an OS-level syscall trace. Ledger snapshot write counts and
bytes were unchanged. Checkpoint validation rechecks recorded checkpoint
deltas and is included in incremental-mode cost; this keeps the existing
dual-store evidence validation strict.

## Runtime status

The already-running Stage3E master execution uses its originally loaded
runner and was not interrupted or hot-patched. The incremental verifier is
available to a later safe phase boundary or resume after a full audit. This
measurement does not claim a change in acoustic render time or acoustic
quality.
