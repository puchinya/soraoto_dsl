# Documentation guide

This directory contains the normative soraotoDSL specification and the repository's agent workflow. Start with the category index that matches your question, then read only the relevant document or specification module.

| Need | Start here |
|---|---|
| DSL language, components, plugins, ABI, project audio, performance, interchange, or conformance | [`specs/README.md`](specs/README.md) |
| Issue phases, implementation, review, evidence, or checkpoints | [`agent-workflow/README.md`](agent-workflow/README.md) |
| Web Player run/build instructions | [`../web-player/README.md`](../web-player/README.md) |
| Web Player implementation notes and supported subset | [`../web-player/docs/`](../web-player/docs/) |

## Current layout

```text
docs/
├── README.md
├── agent-workflow/
│   ├── README.md
│   ├── requirements.md
│   ├── design.md
│   ├── implementation.md
│   ├── review.md
│   ├── evidence.md
│   └── checkpoint.md
└── specs/
    ├── README.md
    └── soraotoDSL/
        ├── soraotoDSL.md
        ├── soraotoDSL-full.md
        └── spec/
            ├── 01-language.md
            ├── 02-component.md
            ├── 03-plugin-model.md
            ├── 04-realtime-abi.md
            ├── 05-plugin-services.md
            ├── 06-project-audio.md
            ├── 07-performance.md
            ├── 08-interchange.md
            └── 09-conformance.md
```

`docs/specs/soraotoDSL/soraotoDSL.md` and its `spec/*.md` modules are the normative source. `soraotoDSL-full.md` is a generated snapshot, not an independent place to author rules. The Web Player documents describe that implementation and do not replace the normative specification.

The current `docs/` tree has no separate design or status category. Do not create empty categories; if a durable new document category is needed, add its purpose and entry point to this guide first.
