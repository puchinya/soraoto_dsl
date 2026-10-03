# Design phase

Read this document for an Issue labeled `phase:design`.

## Goal

Decide how the approved requirements fit the DSL contract, implementation boundaries, and available verification before nontrivial implementation begins.

## Required design

Inspect only the relevant specification modules and source/test areas. Record in the Issue:

- the owning normative section or sections for a public contract change;
- the intended implementation area and important ownership or realtime constraints;
- compatibility, migration, dependency, and generated-file effects;
- the tests or other evidence that will verify each acceptance criterion;
- the files or document categories that may change, plus explicit non-goals.

For a Web Player change, use the relevant `web-player/` source and tests. For a WASM/plugin change, include the Plugin ABI boundary and relevant `wasm/` CTest coverage. For a specification change, name the split source module and its generated full snapshot.

## Reviewer Checklist and approval

Before implementation, add a task-specific Reviewer Checklist to the Issue or approved design. Each item must be observable and map to an acceptance criterion or an important regression risk. Keep verification requirements separate from implementation steps.

For contract-driven work, the design must resolve the contract against the approved Issue and normative sources, name required external inputs and their availability, and map each contract acceptance criterion to observable evidence. A missing input that blocks an acceptance criterion stays visible as a blocker; it is not grounds to substitute data or skip the criterion.

Do not start a nontrivial implementation until the user or responsible maintainer approves the requirements and design. A narrowly scoped correction may use the direct request as approval when existing normative behavior is unambiguous and acceptance criteria are clear. Ask the user when a decision would materially change DSL behavior, ABI, compatibility, architecture, supported behavior, or scope.

After approval, update the Issue with the final scope, design summary, non-goals, and Reviewer Checklist; move it to `phase:ready`. Remove `needs-user-decision` if resolved. If requirements materially change, remain in design and obtain approval for the revised scope.
