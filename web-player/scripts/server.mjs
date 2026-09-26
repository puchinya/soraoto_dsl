import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webRoot, "..");
const mode = process.argv[2] === "preview" ? "preview" : "dev";
const distRoot = path.join(webRoot, "dist");
const routes = mode === "preview"
  ? [{ prefix: "/", root: distRoot }]
  : [
      { prefix: "/assets/js/", root: path.join(webRoot, "src", "js") },
      { prefix: "/assets/worklets/", root: path.join(webRoot, "src", "worklets") },
      { prefix: "/songs/", root: path.join(webRoot, "public", "songs") },
      { prefix: "/wasm/", root: path.join(repositoryRoot, "build", "wasm") },
      { prefix: "/", root: webRoot }
    ];

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".soraoto", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"]
]);

function resolveFile(pathname) {
  const route = routes.find((entry) => pathname.startsWith(entry.prefix));
  if (!route) return null;
  const relative = route.prefix === "/" ? pathname.slice(1) : pathname.slice(route.prefix.length);
  const root = path.resolve(route.root);
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
  return file;
}

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  let file = resolveFile(pathname);
  let fileInfo;
  try {
    fileInfo = file ? await stat(file) : null;
  } catch {}

  if (fileInfo?.isDirectory()) {
    file = path.join(file, "index.html");
    try {
      fileInfo = await stat(file);
    } catch {
      fileInfo = null;
    }
  }

  if (!fileInfo?.isFile() && request.headers.accept?.includes("text/html") && !path.extname(pathname)) {
    file = path.join(mode === "preview" ? distRoot : webRoot, "index.html");
    try {
      fileInfo = await stat(file);
    } catch {
      fileInfo = null;
    }
  }

  if (!fileInfo?.isFile()) {
    response.writeHead(404, { "Cache-Control": "no-store" }).end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Length": fileInfo.size,
    "Content-Type": mimeTypes.get(path.extname(file).toLowerCase()) ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
});

const port = Number(process.env.PORT ?? (mode === "preview" ? 4173 : 5173));
server.listen(port, "127.0.0.1", () => {
  console.log(`Web player ${mode} server: http://localhost:${port}/`);
});
