import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 本地预览：先构建 site/dist，再启动静态服务器。开发专用，不参与部署。 */

const outDir = fileURLToPath(new URL("../site/dist/", import.meta.url));
const port = Number(process.env.SITE_PORT ?? 4173);

const build = spawnSync(process.execPath, [fileURLToPath(new URL("./build-site.mjs", import.meta.url))], {
  stdio: "inherit"
});
if (build.status !== 0) process.exit(build.status ?? 1);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const rootPrefix = outDir.endsWith(sep) ? outDir : outDir + sep;

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const target = normalize(join(outDir, pathname === "/" ? "index.html" : pathname));
  if (!target.startsWith(rootPrefix) || !existsSync(target) || statSync(target).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.");
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(target).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(target).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Site preview: http://127.0.0.1:${port}`);
});
