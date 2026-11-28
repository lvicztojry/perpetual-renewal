import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function fixture(mode = "development", extra = "http://192.168.1.20:3000,http://localhost:3000,invalid") {
  class AuthError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  class AuthenticationRequiredError extends Error {}
  class JsonRequestError extends Error {}
  const exports = {};
  const context = vm.createContext({ exports, URL, process: { env: { NODE_ENV: mode, AUTH_APP_URL: "http://localhost:3000", AUTH_DEV_ALLOWED_ORIGINS: extra } }, require(name) {
    if (name.endsWith("/private-response")) return { privateJson: (data, init) => Response.json(data, init) };
    if (name.endsWith("/json")) return { JsonRequestError, readJsonObject: request => request.json(), jsonErrorMessage: () => "Invalid JSON" };
    if (name === "./errors") return { AuthError, AuthenticationRequiredError };
    throw new Error("Unexpected dependency");
  } });
  const source = readFileSync(new URL("../src/lib/auth/http.ts", import.meta.url), "utf8");
  new vm.Script(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(context);
  let calls = 0;
  return { get calls() { return calls; }, post: (origin, site = "same-origin") => exports.authPost(new Request("http://192.168.1.20:3000/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": site }, body: "{}" }), async () => { calls++; return { ok: true }; }) };
}

test("explicit development LAN and localhost origins work without weakening foreign-origin checks", async () => {
  const f = fixture();
  assert.equal((await f.post("http://192.168.1.20:3000")).status, 200);
  assert.equal((await f.post("http://localhost:3000")).status, 200);
  for (const origin of ["http://192.168.1.21:3000", "http://192.168.1.20:3001", "https://foreign.invalid"]) assert.equal((await f.post(origin)).status, 403);
  assert.equal((await f.post("http://192.168.1.20:3000", "cross-site")).status, 403);
  assert.equal(f.calls, 2);
});
test("production ignores the extra development allowlist", async () => {
  const f = fixture("production");
  assert.equal((await f.post("http://192.168.1.20:3000")).status, 403);
  assert.equal((await f.post("http://localhost:3000")).status, 200);
});
test("malformed optional development entries do not break the configured origin", async () => {
  assert.equal((await fixture("development", "invalid,,").post("http://localhost:3000")).status, 200);
});
