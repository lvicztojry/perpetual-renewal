import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { loadLocalEnv } from "./load-local-env.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
loadLocalEnv();
const secret = process.env.PROACTIVE_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
const origin = new URL(process.env.GROUP_WORKER_ORIGIN || "http://localhost:3000");
if (!secret || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.protocol !== "http:") {
  console.error("Group worker requires a cron secret and a local HTTP app origin.");
  process.exit(1);
}
const lockDirectory = resolve("logs", "current");
await mkdir(lockDirectory, { recursive: true });
const lockPath = resolve(lockDirectory, "group-worker.lock");
let lock;
try { lock = await open(lockPath, "wx"); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  const pid = Number(await readFile(lockPath, "utf8").catch(() => ""));
  let alive = false;
  try { if (pid > 0) { process.kill(pid, 0); alive = true; } } catch (failure) { alive = failure.code !== "ESRCH"; }
  if (alive || !pid) { console.log("Group worker already running or starting."); process.exit(0); }
  await unlink(lockPath);
  lock = await open(lockPath, "wx");
}
await lock.writeFile(String(process.pid));
await lock.close();
let stopped = false;
let cursor = "";
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopped = true; controller.abort(); });
console.log("Local group scheduler started. Only enabled groups can generate messages.");
try {
  while (!stopped) {
    try {
      const url = new URL("/api/proactive/groups/run", origin);
      if (cursor) url.searchParams.set("after", cursor);
      const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240000)]), redirect: "error" });
      if (response.ok) {
        const data = await response.json();
        cursor = typeof data.nextCursor === "string" ? data.nextCursor : "";
        console.log(`Group check complete: ${Number(data.scanned) || 0} checked, ${Number(data.generated) || 0} updated.`);
      } else console.error(`Group check unavailable (HTTP ${response.status}).`);
    } catch { if (!stopped) console.error("Group check unavailable; will retry."); }
    if (!stopped) await delay(60000, undefined, { signal: controller.signal }).catch(() => {});
  }
} finally {
  if (await readFile(lockPath, "utf8").catch(() => "") === String(process.pid)) await unlink(lockPath).catch(() => {});
}
