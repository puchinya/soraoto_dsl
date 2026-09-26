import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(root, "tests");
const wasmBuildDir = path.resolve(root, "..", "build", "wasm");

if (!existsSync(path.join(wasmBuildDir, "plugins", "dsp", "super-synth", "plugin.wasm"))) {
  console.error("WASM build missing. Run cmake --build build/wasm before npm test.");
  process.exit(1);
}

const tests = readdirSync(testsDir)
  .filter((name) => /\.test\.(?:js|cjs)$/.test(name))
  .sort();
const failures = [];

for (const name of tests) {
  const result = spawnSync(process.execPath, [path.join(testsDir, name)], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status === 0) {
    console.log(`PASS ${name}`);
    continue;
  }

  failures.push(name);
  console.error(`FAIL ${name}`);
  if (result.error) console.error(result.error);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

console.log(`RESULT ${tests.length - failures.length}/${tests.length} web-player tests passed`);
if (failures.length) process.exitCode = 1;
