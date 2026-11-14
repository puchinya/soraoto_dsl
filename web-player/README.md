# soraotoDSL Web Reference Player

Browser reference implementation for soraotoDSL Draft v0.5.

## Run

Use HTTP; `file://` is not sufficient because songs, WASM modules, and AudioWorklet code are fetched.

```bash
npm run dev
```

Open `http://localhost:5173/`.

Create deployment output with:

```bash
npm run build
npm run preview
```

Realtime WASM Plugin playback requires a secure context in deployed environments.

## Source and runtime data

The browser compiler creates the Project and `Resolved Project IR` in memory from DSL source. They
are ephemeral runtime data, not saved Project formats. Reloading source recompiles it and rebuilds
the Plugin graph from DSL configuration.

The convenience `localStorage` entry `soraotoDSL.source` stores editor source text only. Authored
preset selections and parameter values remain in that source. The Web Player does not persist or
restore derived Project/IR, graph, Plugin state, or runtime parameter snapshots separately.

## Documentation

- Web Player external/support contract:
  [`docs/specs/README.md`](docs/specs/README.md)
- Web Player architecture:
  [`docs/design/README.md`](docs/design/README.md)
- Portable soraotoDSL + Plugin normative specification:
  [`../docs/specs/soraotoDSL/README.md`](../docs/specs/soraotoDSL/README.md)

## Verification

Web Player tests:

```bash
npm test
```

WASM Plugin build/tests from the repository root:

```bash
cmake -S wasm -B build/wasm -DCMAKE_TOOLCHAIN_FILE="$PWD/wasm/cmake/wasm32-clang.cmake"
cmake --build build/wasm
ctest --test-dir build/wasm --output-on-failure
```

`dist/` and `build/wasm/` are generated outputs.
