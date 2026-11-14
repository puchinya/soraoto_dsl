# Stage3E Incremental Verification Performance

Date: 2026-10-12

Incremental verification reduces repeated Stage3E evidence reads without
changing acoustic rendering, the canonical ledger or journal formats,
acceptance gates, or the full-audit contract. Phase entry, phase exit, resume,
and `--verify` remain full audits. New cell bytes and both copies are still
independently read and SHA-256 checked before completion. In-process
verification state is discarded when a phase runner exits.

## Review correction: checkpoint delta SHA binding

`verifyDeltaEntries()` now explicitly requires the actual SHA-256 returned by
the dual-copy read to equal the checkpoint entry's recorded `sha256`. Both
checkpoint creation and checkpoint-chain replay use this verifier. The
regression test mutates both copies of a recorded cell to the same different
bytes without changing its length or the checkpoint; checkpoint creation and
replay fail with `BLOCKED_STAGE3E_VERIFICATION_CHECKPOINT`.

## Temporary-fixture benchmark

Command:

```text
rtk node wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.bench.cjs
```

Measured on implementation commit
`5507e711738799b11daa6fa560d08fc8fb48dabd`. The benchmark source SHA-256 is
`c886ff4461d8123ec757a2c5fdb3e795caaf50d247ecc581fc16ebc927a9afcc`; the
incremental verifier SHA-256 is
`8d4b3a13f6a99ce159d33aa784fabfeb646f0b7adfd4e3c551aa60722215f694`.
Environment: Darwin arm64, Node.js v26.7.0. Each run used temporary primary
and secondary roots, a synthetic low-phase fixture, and a synthetic renderer.
No durable evidence roots were touched; acoustic renders: 0. The `before`
mode uses the legacy `capturePhaseRows()` path and the `incremental` mode uses
`screenLedgerRows()`. Each combination ran three times; `process.hrtime.bigint()`
measured elapsed time. Read/hash/file-operation counters below are from one
same-size fixture execution per mode; elapsed values are the three raw runs.

| Cells | Mode | Run 1 | Run 2 | Run 3 | Median |
|---:|---|---:|---:|---:|---:|
| 64 | Before | 9.754229 s | 9.622202 s | 9.579947 s | 9.622202 s |
| 64 | Incremental | 8.130697 s | 8.111009 s | 8.018903 s | 8.111009 s |
| 256 | Before | 54.336714 s | 53.784867 s | 53.602926 s | 53.784867 s |
| 256 | Incremental | 33.706464 s | 34.100517 s | 34.752601 s | 34.100517 s |

These measurements describe the earlier checkpoint implementation and are
superseded for the latest review correction below. They remain as the record
of the first optimization iteration.

| Cells | Mode | Full audits | File reads | Read bytes | SHA input bytes | Estimated opens | Ledger writes / bytes | Checkpoint time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 64 | Before | 65 | 55,762 | 80,893,270 | 89,577,629 | 113,060 | 128 / 8,080,730 | 0 ms |
| 64 | Incremental | 4 | 6,234 | 23,637,124 | 32,642,943 | 14,008 | 128 / 8,080,730 | 68.244 ms |
| 256 | Before | 257 | 812,626 | 1,265,651,104 | 1,394,001,111 | 1,631,396 | 512 / 125,930,572 | 0 ms |
| 256 | Incremental | 7 | 35,742 | 298,725,934 | 428,929,359 | 77,644 | 512 / 125,930,572 | 389.346 ms |

Ledger snapshot write counts and bytes were unchanged. Estimated opens equal
`readFileSync` calls plus explicit `openSync` calls; this is not an OS syscall
trace. The raw sanitized benchmark JSON SHA-256 is
`4f446093532087ba8ba2ccea812dd5ec84b17eb810ce9233784c398858bc8184`; the
progress log SHA-256 is
`9ade1da0c05d7270c746ea779bc7a3fdd97b63c1939ae4bbfbbd5daf2b444967`.

## Review correction: checkpoint delta-only verification

Implementation and regression test commit:
`b40cc7c67c16370b2bcecafb67061a1e254848ca`.
The correction removes the full audit and checkpoint-chain replay from each
64-cell checkpoint. A checkpoint now checks the live mirrored ledger and
journal tip, verifies only the current uncheckpointed delta, and reads back the
new checkpoint bytes from both stores. Full checkpoint-chain verification
remains at phase entry/resume, explicit read-only verification, and phase exit.
The 256-cell regression confirms four checkpoints each read only their current
64-cell delta; phase entry and exit are the only two full audits. An explicit
full-chain replay still rereads all deltas and detects same-size mutations in
both mirrored copies.

The benchmark command and environment are unchanged from above. It was rerun
three times per mode on the temporary low-phase fixture after this correction
(Darwin arm64, Node.js v26.7.0; acoustic renders: 0; durable evidence roots
untouched). Raw elapsed milliseconds:

| Cells | Mode | Run 1 | Run 2 | Run 3 | Median |
|---:|---|---:|---:|---:|---:|
| 64 | Before | 9679.722875 | 9499.967542 | 9502.179333 | 9502.179333 |
| 64 | Incremental | 7818.625833 | 7799.405667 | 7890.469167 | 7818.625833 |
| 256 | Before | 56236.032125 | 56791.159917 | 53349.974500 | 56236.032125 |
| 256 | Incremental | 32534.439375 | 31720.623792 | 29833.664208 | 31720.623792 |

At these fixture sizes, median verifier time fell by 17.7% and 43.6%. This is
not a claim about acoustic-render time or total Stage3E wall clock.

| Cells | Mode | Full audits | File reads | Read bytes | SHA input bytes | Estimated opens | Ledger writes / bytes | Checkpoint time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 64 | Before | 65 | 55,762 | 80,893,270 | 89,577,629 | 113,060 | 128 / 8,080,730 | 0 ms |
| 64 | Incremental | 2 | 3,506 | 24,178,244 | 33,085,078 | 8,552 | 128 / 8,080,730 | 62.246292 / 55.430458 / 57.484416 ms (median 57.484416) |
| 256 | Before | 257 | 812,626 | 1,265,651,104 | 1,394,001,111 | 1,631,396 | 512 / 125,930,572 | 0 ms |
| 256 | Incremental | 2 | 13,514 | 330,654,050 | 459,887,624 | 33,188 | 512 / 125,930,572 | 235.198501 / 177.002583 / 149.475291 ms (median 177.002583) |

Ledger snapshot write counts and bytes are unchanged. Estimated opens remain
`readFileSync` calls plus explicit `openSync` calls, not an OS syscall trace.
No acoustic runtime benchmark was run.

## Runtime status and limits

The repository's Stage3E search completed 2,023 acoustic calls and reached
`BLOCKED_STAGE3E_MID_RESPONSE_FAMILY`: all five top-ranked candidates failed
the existing MIDI 51 dynamic-span limit. Stage3 and Stage4 remain NOT RUN /
LOCKED. This performance report does not alter that acoustic decision or its
thresholds. CI and independent benchmark reproduction were not run.
