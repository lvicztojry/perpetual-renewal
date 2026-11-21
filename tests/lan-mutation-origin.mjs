import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Compile only the pure helper; no app boot, database, account or network access.
const source = readFileSync(new URL("../src/lib/http/request-origin.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const internal = "http://localhost:3000";
const lan = "http://192.168.1.20:3000";
function fixture(env = {}) {
  const exports = {};
  new vm.Script(compiled).runInContext(vm.createContext({ exports, URL, process: { env: { ...env } } }));
  return (origin, headers = {}, url = `${internal}/api/sync/read`) => {
    const requestHeaders = new Headers(headers);
    if (origin !== undefined) requestHeaders.set("origin", origin);
    return exports.isTrustedMutationOrigin(new Request(url, { method: "POST", headers: requestHeaders }));
  };
}

test("request and configured canonical HTTP(S) origins work independently of internal hostname", () => {
  for (const NODE_ENV of [undefined, "test", "development", "production"]) {
    const trusted = fixture({ NODE_ENV, AUTH_APP_URL: `${lan}/configured/path?query=1#fragment` });
    assert.equal(trusted(internal), true);
    assert.equal(trusted(lan), true);
    assert.equal(trusted("http://192.168.1.20:3001"), false);
    assert.equal(trusted("https://192.168.1.20:3000"), false);
  }
  assert.equal(fixture({ AUTH_APP_URL: "https://canonical.test/path" })("https://canonical.test"), true);
  assert.equal(fixture()("https://app.test", {}, "https://app.test/api/sync/read"), true);
  assert.equal(fixture()("http://[::1]:3000", {}, "http://[::1]:3000/api/sync/read"), true);
});

test("missing, opaque, malformed and non-serialized Origin headers are rejected", () => {
  const trusted = fixture({ AUTH_APP_URL: lan });
  for (const origin of [undefined, "", "null", "invalid", "*", `${lan}/`, `${lan}/path`, `${lan}?x=1`, `${lan}#fragment`,
    "http://user:password@192.168.1.20:3000", "http://user@192.168.1.20:3000", "HTTP://192.168.1.20:3000",
    "http://LOCALHOST:3000", `${lan}, ${internal}`, `${lan} ${internal}`, "http://192.168.1.20:03000"]) {
    assert.equal(trusted(origin), false, String(origin));
  }
  const defaultPort = fixture({ AUTH_APP_URL: "https://canonical.test" });
  assert.equal(defaultPort("https://canonical.test:443"), false);
  assert.equal(defaultPort("https://canonical.test"), true);
  for (const origin of ["file://", "ftp://app.test", "ws://app.test", "data:text/plain,test", "blob:https://app.test/id"]) {
    assert.equal(fixture({ AUTH_APP_URL: origin })(origin), false, origin);
  }
});

test("cross-site metadata rejects every otherwise trusted origin", () => {
  const trusted = fixture({ NODE_ENV: "development", AUTH_APP_URL: lan, AUTH_DEV_ALLOWED_ORIGINS: "https://dev.test" });
  for (const origin of [internal, lan, "https://dev.test"]) {
    assert.equal(trusted(origin, { "sec-fetch-site": "cross-site" }), false, origin);
    for (const site of ["same-origin", "same-site", "none"]) assert.equal(trusted(origin, { "sec-fetch-site": site }), true);
  }
});

test("development permits only explicitly configured serialized origins", () => {
  const trusted = fixture({ NODE_ENV: "development", AUTH_DEV_ALLOWED_ORIGINS: `, ${lan},, https://dev.test, http://[::1]:4000,invalid,` });
  for (const origin of [lan, "https://dev.test", "http://[::1]:4000", internal]) assert.equal(trusted(origin), true, origin);
  for (const origin of ["http://192.168.1.21:3000", "http://192.168.1.20:3001", "http://10.0.0.1:3000", "http://172.16.0.1:3000", "https://dev.test.evil.test"]) assert.equal(trusted(origin), false, origin);
});

test("malformed dev entries and wildcard patterns grant no trust", () => {
  for (const entry of ["*", "http://*", "http://192.168.*:3000", "http://192.168.0.0/16", `${lan}/`, `${lan}/path`, `${lan}?x=1`, `${lan}#x`,
    "http://user@192.168.1.20:3000", "HTTP://192.168.1.20:3000", "null", "invalid", "", "https://dev.test:443"]) {
    const trusted = fixture({ NODE_ENV: "development", AUTH_DEV_ALLOWED_ORIGINS: entry, AUTH_APP_URL: "https://canonical.test/path" });
    assert.equal(trusted(lan), false, entry);
    assert.equal(trusted("https://dev.test"), false, entry);
    assert.equal(trusted("https://canonical.test"), true, entry);
    assert.equal(trusted(internal), true, entry);
  }
});

test("production, test and unspecified modes ignore development entries", () => {
  for (const NODE_ENV of ["production", "test", undefined]) {
    const trusted = fixture({ NODE_ENV, AUTH_DEV_ALLOWED_ORIGINS: `${lan},https://dev.test`, AUTH_APP_URL: "https://canonical.test" });
    assert.equal(trusted(lan), false);
    assert.equal(trusted("https://dev.test"), false);
    assert.equal(trusted("https://canonical.test"), true);
    assert.equal(trusted(internal), true);
  }
});

test("invalid canonical configuration fails closed without disabling request-origin trust", () => {
  for (const AUTH_APP_URL of [undefined, "", "invalid", "null", "*", "ftp://192.168.1.20:3000", "http://user@192.168.1.20:3000"]) {
    const trusted = fixture({ AUTH_APP_URL });
    assert.equal(trusted(lan), false, String(AUTH_APP_URL));
    assert.equal(trusted(internal), true, String(AUTH_APP_URL));
  }
});

test("Host, Forwarded and proxy headers cannot authorize an unconfigured LAN origin", () => {
  const trusted = fixture();
  const headers = { host: "192.168.1.20:3000", "x-forwarded-host": "192.168.1.20:3000", "x-forwarded-proto": "http", "x-forwarded-port": "3000", forwarded: 'host="192.168.1.20:3000";proto=http' };
  assert.equal(trusted(lan, headers), false);
  assert.equal(trusted(internal, headers), true);
});
