# Web Player specifications

These documents define behavior specific to the browser reference player. They may narrow the
portable specification's supported profile, but they must not redefine portable soraotoDSL or
Plugin ABI semantics.

| Topic | Document |
|---|---|
| Supported language/runtime profile and known conformance gaps | [`reference-player-profile.md`](reference-player-profile.md) |
| Browser Plugin host product contract | [`plugin-host-profile.md`](plugin-host-profile.md) |
| MIDI/GarageBand/WAV browser export behavior | [`export-behavior.md`](export-behavior.md) |
| Standard instrument and drum resolution | [`instrument-resolution.md`](instrument-resolution.md) |
| Public sample catalog and classical-source provenance | [`public-sample-catalog.md`](public-sample-catalog.md) |

## Normative precedence

1. Portable soraotoDSL specification under `docs/specs/soraotoDSL/`.
2. These Web Player specifications for browser-only behavior or intentionally narrower support.
3. Web Player design documents.
4. Source code and tests as implementation/evidence.

If this directory conflicts with the portable specification on shared semantics, the portable
specification wins and the conflict is a Web Player conformance defect.
