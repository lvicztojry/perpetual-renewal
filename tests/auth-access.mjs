import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const secret = "placeholder-production-access-session-secret";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: {
    ...process.env, NODE_ENV: "production", AUTH_MODE: "local-email",
    // Deliberately unreachable: anonymous requests must fail before touching a database.
    DATABASE_URL: "postgresql://user:password@127.0.0.1:1/unreachable",
    SESSION_COOKIE_SECRET: secret, NEXT_TELEMETRY_DISABLED: "1"
  },
  stdio: "ignore", windowsHide: true
});
const stopped = new Promise((resolve) => child.once("exit", resolve));
let exited = false;
child.once("exit", () => { exited = true; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exited) throw new Error("Production server exited before readiness.");
    try {
      ready = (await fetch(`${base}/login`, { signal: AbortSignal.timeout(1000) })).ok;
      if (ready) break;
    } catch { /* Poll only this live server. */ }
    await delay(200);
  }
  assert(ready, "Production server did not become ready.");
  const userId = Buffer.from("legacy-user").toString("base64url");
  const signature = createHmac("sha256", secret).update(userId).digest("base64url");
  for (const cookie of ["", `perpetual_renewal_session=v1.${userId}.${signature}`]) {
    for (const pathname of ["/", "/settings"]) {
      const response = await fetch(`${base}${pathname}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(response.status, 307, pathname);
      assert.equal(new URL(response.headers.get("location"), base).pathname, "/login");
      assert.equal(response.headers.get("set-cookie"), null);
    }
    for (const [method, pathname, body] of [
      ["GET", "/api/companions"], ["GET", "/api/me"],
      ["GET", "/api/me/config-status"], ["GET", "/api/me/export"],
      ["GET", "/api/me/llm-credential"], ["GET", "/api/me/llm-models"],
      ["GET", "/api/usage/model-calls"],
      ["POST", "/api/companions", { name: "Unauthorized", relationshipKind: "CUSTOM", speakingStyle: "warm" }],
      ["PUT", "/api/me/llm-credential", { provider: "compatible" }],
      ["POST", "/api/me/llm-test", {}],
      ["POST", "/api/proactive/run", { scope: "current-user" }],
      ["POST", "/api/voice/synthesize", { text: "hello" }]
    ]) {
      const response = await fetch(`${base}${pathname}`, {
        method, headers: { cookie, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      assert.equal(response.status, 401, `${method} ${pathname}`);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal((await response.json()).errorType, "authentication_required");
    }
  }
  console.log("Production access passed: anonymous and legacy v1 sessions cannot enter pages, access user APIs or create demo sessions, even with local-email configured.");
} finally {
  if (!exited) {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      await new Promise((resolve) => killer.once("exit", resolve));
    } else child.kill("SIGTERM");
  }
  await stopped;
}
