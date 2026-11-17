# Plugin product specifications

This directory contains normative product contracts for individual repository plugins.
These documents define product behavior and compatibility requirements for their plugin, while
the shared soraotoDSL specification remains authoritative for the portable Plugin model and ABI.

| Plugin | Product contract |
|---|---|
| SuperSynth product contract | [`dsp/super-synth/super-synth-spec.md`](dsp/super-synth/super-synth-spec.md) |
| SuperSynth engine models | [`dsp/super-synth/super-synth-engine-models-spec.md`](dsp/super-synth/super-synth-engine-models-spec.md) |
| Issue #7 contact-loss experiment successor | [`dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md`](dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md) |

Architecture belongs in [`../../design/README.md`](../../design/README.md); current progress and
verification belong in [`../../status/README.md`](../../status/README.md). Neither may override a
product specification or the shared DSL contract.
