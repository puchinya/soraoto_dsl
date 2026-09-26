import { cp, mkdir, readdir, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webRoot, "..");
const sourceRoot = path.join(webRoot, "src");
const publicRoot = path.join(webRoot, "public");
const distRoot = path.join(webRoot, "dist");
const wasmSourceRoot = path.join(repositoryRoot, "build", "wasm");
const wasmPluginSourceRoot = path.join(repositoryRoot, "wasm", "plugins");
const wasmPluginOutputRoot = path.join(distRoot, "wasm", "plugins");
const toolchainFile = path.join(repositoryRoot, "wasm", "cmake", "wasm32-clang.cmake");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("cmake", [
  "-S", path.join(repositoryRoot, "wasm"),
  "-B", wasmSourceRoot,
  `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`
]);
run("cmake", ["--build", wasmSourceRoot]);

await rm(distRoot, { recursive: true, force: true });
await mkdir(path.join(distRoot, "assets"), { recursive: true });
await cp(path.join(webRoot, "index.html"), path.join(distRoot, "index.html"));
await cp(path.join(sourceRoot, "js"), path.join(distRoot, "assets", "js"), { recursive: true });
await cp(path.join(sourceRoot, "worklets"), path.join(distRoot, "assets", "worklets"), { recursive: true });
await cp(publicRoot, distRoot, { recursive: true });

for (const group of ["effects", "dsp"]) {
  const sourceGroupRoot = path.join(wasmPluginSourceRoot, group);
  const sourcePlugins = await readdir(sourceGroupRoot, { withFileTypes: true });
  for (const plugin of sourcePlugins.filter((entry) => entry.isDirectory())) {
    const relative = path.join(group, plugin.name, "plugin.wasm");
    const source = path.join(wasmSourceRoot, "plugins", relative);
    const destination = path.join(wasmPluginOutputRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

console.log(`Web player deployment files written to ${path.relative(repositoryRoot, distRoot)}`);
