import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function createScheduler({ origin = "http://127.0.0.1:3000", secret, fetchImpl = fetch }) {
  const base = new URL(origin);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password || !secret) {
    throw new Error("Scheduler requires a loopback HTTP origin and a cron secret.");
  }
  let cursor = "";
  return async function tick(kind, signal) {
    if (!["groups", "private"].includes(kind)) throw new Error("Invalid scheduler task.");
    const url = new URL(kind === "groups" ? "/api/proactive/groups/run" : "/api/proactive/run?limit=20&maxDrafts=50", base);
    if (kind === "groups" && cursor) url.searchParams.set("after", cursor);
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${secret}` }, redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000)
    });
    if (!response.ok) throw new Error(`Scheduler HTTP ${response.status}.`);
    const data = await response.json();
    if (kind === "groups") cursor = typeof data.nextCursor === "string" ? data.nextCursor : "";
    // Never return upstream payloads to logging code.
    return { ok: true };
  };
}

async function main() {
  const tick = createScheduler({ secret: process.env.PROACTIVE_CRON_SECRET });
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => controller.abort());
  await Promise.all(["private", "groups"].map(async kind => {
    while (!controller.signal.aborted) {
      try {
        await tick(kind, controller.signal);
        console.log(`${kind}: scheduler check complete.`);
      } catch {
        if (!controller.signal.aborted) console.error(`${kind}: scheduler unavailable; will retry.`);
      }
      await delay(60000, undefined, { signal: controller.signal }).catch(() => {});
    }
  }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Scheduler could not start."); process.exitCode = 1; });
}
