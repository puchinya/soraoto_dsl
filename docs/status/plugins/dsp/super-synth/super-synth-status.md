# SuperSynth V9 status

> This document records current evidence. It is non-normative; the product specification and approved design define requirements and decisions.

**Owning Issue:** [#7](https://github.com/puchinya/soraoto_dsl/issues/7) — SuperSynth V9 Salamander Calibration and Full-Range Delivery  
**Issue phase:** `phase:review`  
**Updated:** 2026-09-26

## Progress

| Work item | Status | Evidence / limitation |
|---|---|---|
| Implementation contract and approval | PASS | Exact contract copy and source SHA-256 `a5aa3439b4ec25a41e1cae6ff1819bbb49ab631fc2a41f0f6fc32da5f0be72db`; user approved the design on 2026-09-26 |
| Owning Issue and phase | PASS | Issue #7 is at `phase:review` with open [PR #8](https://github.com/puchinya/soraoto_dsl/pull/8) |
| Official Salamander reference | PASS | FreePats V3 SFZ+FLAC archive; 741,757,374 bytes; archive SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b` |
| Source matrix and samples | PASS | 30 pitch centers × 16 exact SFZ layers = 480 direct cells; all 641 referenced FLAC files are present and decode as 48 kHz / 24-bit |
| Private Drive provisioning | PASS | Drive for Desktop mirror contains the archive and four provenance/quickstart sidecars; local archive hash matches the verified source |
| Product specification, design, and attribution | PASS | Salamander-only scope, CC BY 3.0 attribution, source velocity mapping, analyzer handoff, broad limits, and derived-only fixture are documented |
| Full-range calibration and V9 implementation | PASS | 1,408 key/layer renders; 1,392 adjacent comparisons; 480 direct cells; 58 interpolated pitches; zero hard failures; reports are under `metrics/` |
| Repository and Web Player verification | PASS | WASM build and all 27 CTest cases pass; Web Player tests pass 39/39 and deployment build succeeds |
| Native browser/audio interaction | NOT RUN | Automated tests establish render and integration properties, not actual device playback or browser listening |
| Independent Drive cloud archive hash readback | NOT AVAILABLE | The Drive download connector limit is 268,435,456 bytes, below the 741,757,374-byte archive; local DriveFS hash and Drive listing/upload state were verified |
| Commit, push, pull request, Issue review phase | PASS | Commit `a2aa30c` is pushed to `codex/issue-7-supersynth-v9`; [PR #8](https://github.com/puchinya/soraoto_dsl/pull/8) is open and Issue #7 is `phase:review` |

## Verification

| Check | Status | Result |
|---|---|---|
| Contract provenance | PASS | Preserved contract source and repository copy match SHA-256 `a5aa3439b4ec25a41e1cae6ff1819bbb49ab631fc2a41f0f6fc32da5f0be72db` |
| Official source archive | PASS | Downloaded source and local DriveFS mirror match SHA-256 `b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b` |
| Archive structure and sample integrity | PASS | SFZ parse maps 30 centers × 16 layers; 641/641 sample references resolve; `flac --test` and format checks passed |
| Analyzer re-derivation | PASS | 480/480 direct metric cells exactly match the committed numeric fixture; 641 unique source audio references; SFZ SHA-256 `91a273d53390c84a855437b4f37a734afac5cb0e4063b3ef59ccf0e63d909506` |
| `rtk cmake --build build/wasm` | PASS | Plugin metadata regenerated and SuperSynth WASM linked |
| `SUPERSYNTH_REPORT_DIR="$PWD/docs/status/plugins/dsp/super-synth/metrics" rtk ctest --test-dir build/wasm --output-on-failure` | PASS | 27/27 tests; full-range test reports 480 direct cells, 1,408 renders, 1,392 adjacent comparisons, zero failures; repeated 15-cell determinism sentinel matched exactly |
| `rtk npm test` from `web-player/` | PASS | 39/39 Web Player tests |
| `rtk npm run build` from `web-player/` | PASS | Deployment output generated under ignored `web-player/dist/` |
| `rtk git diff --check` | PASS | No whitespace errors |
| Scoped artifact/privacy scan | PASS | No raw audio/archive, oversized artifacts, private Drive identifiers, or private DriveFS paths in changed repository files |
| Native browser/audio interaction | NOT RUN | No browser listening or hardware audio session was performed |

The full-range report uses a single shared gain offset of +4.7693 dB. Direct-cell absolute level error is P50 4.2236 dB / P95 11.8864 dB / maximum 19.1777 dB; peak is at most +1.5836 dBFS against the +1.6 dBFS gate. There are no hard failures. Centroid checks below 0.1% power above 2 kHz remain visible as low-energy diagnostics rather than hard gates; one full-range cell and five adjacent pairs fall below that energy floor. Velocity brightness evolves for 83/88 pitches (94.32%); all keys meet the configured velocity-level-span and adjacent-layer drop checks.

The Studio Piano and fuhton references are excluded from the active calibration plan. Raw Salamander audio remains in the user's private Drive and is not included in the repository or distributed plugin.
