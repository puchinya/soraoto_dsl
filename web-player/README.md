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
