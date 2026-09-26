# Lifecycle and quality design

## Project reload ordering

Replacing the current project follows this order:

1. stop transport scheduling/timers;
2. dispose scheduled WebAudio fallback voices;
3. request and await active graph / AudioWorklet Plugin disposal;
4. release per-context instrument caches;
5. close the old `AudioContext`;
6. fetch/compile/build the replacement project.

The new graph must not become active while disposal of the prior graph is still pending.

## Stop ordering

Stop invalidates the current play serial/session, clears scheduler queues, disposes fallback voices,
and waits for graph disposal. Natural playback completion uses the same cleanup ownership model.

## Failure cleanup

Initialization and reset failures must release temporary Plugin allocations and pending promises.
Plugin init failure must not leave a live Worklet node counted as active.

## Verification layers

### Web Player unit/regression suite

From `web-player/`:

```bash
npm test
```

The test runner executes every `tests/*.test.js` and `tests/*.test.cjs` file and requires a built
SuperSynth WASM module.

### WASM Plugin suite

From repository root:

```bash
cmake -S wasm -B build/wasm -DCMAKE_TOOLCHAIN_FILE="$PWD/wasm/cmake/wasm32-clang.cmake"
cmake --build build/wasm
ctest --test-dir build/wasm --output-on-failure
```

### Browser-only evidence

Browser load/play/stop stress and mobile interaction checks require a real browser environment.
Node/CMake success must not be reported as proof of browser interaction or audible quality.

### Audio quality

Audio-quality regressions are executable evidence tied to the bundled Plugin implementation.
Numeric thresholds belong in tests, not duplicated in design prose.
