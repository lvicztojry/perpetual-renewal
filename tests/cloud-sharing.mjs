import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { initializeCloud } from "../deploy/init.mjs";
import { createScheduler } from "../deploy/scheduler.mjs";

const directory = mkdtempSync(join(tmpdir(), "renewal-cloud-test-"));
try {
  for (const url of ["http://demo.example.test", "https://user:password@demo.example.test", "https://demo.example.test/path", "https://demo.example.test?x=1", "https://127.0.0.1"]) {
    assert.throws(() => initializeCloud(directory, { url, emails: "friend@example.test" }));
  }
  for (const emails of ["", "bad-email", "friend@example.test\nEVIL=value"]) {
    assert.throws(() => initializeCloud(directory, { url: "https://demo.example.test", emails }));
  }
  initializeCloud(directory, { url: "https://demo.example.test", emails: " Owner@Example.test,friend@example.test,owner@example.test " });
  const original = readFileSync(join(directory, "cloud.env"), "utf8");
  const config = Object.fromEntries(original.trim().split("\n").map(line => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  assert.equal(config.AUTH_ALLOWED_EMAILS, "owner@example.test,friend@example.test");
  assert.equal(config.AUTH_MODE, "password");
  assert.equal(config.RENEWAL_REPOSITORY, "prisma");
  assert.equal(config.AUTH_APP_URL, "https://demo.example.test");
  assert.equal(config.LLM_API_KEY, "", "no local model credentials copied");
  assert.equal(config.LLM_BASE_URL, "");
  const password = readFileSync(join(directory, ".secrets/db_password"), "utf8");
  assert.equal(new URL(config.DATABASE_URL).password, password);
  const secrets = [password, config.USER_KEY_VAULT_SECRET, config.SESSION_COOKIE_SECRET, config.PROACTIVE_CRON_SECRET];
  assert.equal(new Set(secrets).size, 4);
  for (const secret of secrets) assert.match(secret, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(join(directory, "scheduler.env"), "utf8"), `PROACTIVE_CRON_SECRET=${config.PROACTIVE_CRON_SECRET}\n`);
  assert.equal(readFileSync(join(directory, "site.env"), "utf8"), "SITE_ADDRESS=demo.example.test\n");
  assert.throws(() => initializeCloud(directory, { url: "https://other.example.test", emails: "other@example.test" }), /no files were overwritten/);
  assert.equal(readFileSync(join(directory, "cloud.env"), "utf8"), original);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const requests = [];
let failGroups = false;
const server = createServer((request, response) => {
  requests.push({ url: request.url, auth: request.headers.authorization });
  if (failGroups && request.url.startsWith("/api/proactive/groups/run")) {
    response.writeHead(503).end("private upstream detail");
  } else {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ nextCursor: requests.length === 1 ? "cursor/next?" : "", private: "never-log-this" }));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tick = createScheduler({ origin, secret: "fixture-cron-only" });
  assert.deepEqual(await tick("groups"), { ok: true });
  failGroups = true;
  await assert.rejects(tick("groups"), /Scheduler HTTP 503/);
  failGroups = false;
  await tick("groups");
  await tick("groups");
  await tick("private");
  assert.equal(new URL(requests[1].url, origin).searchParams.get("after"), "cursor/next?");
  assert.equal(requests[2].url, requests[1].url, "retry retains group pagination cursor");
  assert.equal(requests[3].url, "/api/proactive/groups/run");
  assert.equal(requests[4].url, "/api/proactive/run?limit=20&maxDrafts=50");
  assert(requests.every(item => item.auth === "Bearer " + "fixture-cron-only"));
  await assert.rejects(tick("unknown"));
  for (const unsafe of ["https://127.0.0.1", "http://public.example.test", "http://user:pass@localhost"]) {
    assert.throws(() => createScheduler({ origin: unsafe, secret: "fixture" }));
  }
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(tick("private", aborted.signal));
} finally {
  await new Promise(resolve => server.close(resolve));
}

// A missing invitation list must fail before readiness, network access or server startup.
const rejected = spawnSync(process.execPath, ["deploy/start.mjs"], { env: { AUTH_ALLOWED_EMAILS: "" }, encoding: "utf8", windowsHide: true });
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /AUTH_ALLOWED_EMAILS/);
console.log("Cloud sharing passed: isolated configuration, no overwrite, independent secrets, loopback cron authentication, retry pagination and closed startup defaults.");
