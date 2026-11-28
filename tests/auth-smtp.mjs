import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";
import { createSecureContext, TLSSocket } from "node:tls";
import { inspect } from "node:util";
import vm from "node:vm";
import nodemailer from "nodemailer";
import * as ts from "typescript";

// Entirely synthetic settings; never read .env, process.env or a real mail account.
const recipient = "member@example.test";
const token = "test-token_012345678901234567890123456789012";
const upstreamSecret = "private-upstream-diagnostic";
const unavailable = "邮件服务暂不可用，请稍后重试。";
const settings = {
  NODE_ENV: "production",
  AUTH_APP_URL: "https://app.example.test/ignored?discard=yes#discard",
  AUTH_MAIL_FROM: "Renewal <auth@example.test>",
  AUTH_SMTP_HOST: "127.0.0.1",
  AUTH_SMTP_PORT: "587",
  AUTH_SMTP_USER: "fixture-smtp-user",
  AUTH_SMTP_PASSWORD: "fixture-smtp-password",
  AUTH_MAIL_API_KEY: "fixture-http-api-key"
};
const leaked = `${upstreamSecret} ${recipient} ${token} ${settings.AUTH_SMTP_PASSWORD} ${settings.AUTH_MAIL_API_KEY}`;
const certificate = makeCertificate();
const sources = new Map(await Promise.all(["errors", "smtp", "mail"].map(async (name) => {
  const path = new URL(`../src/lib/auth/${name}.ts`, import.meta.url);
  const source = await readFile(path, "utf8");
  return [name, ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: path.pathname
  }).outputText];
})));

test("auth mail transport contracts", { timeout: 30_000 }, async (suite) => {
  await suite.test("real Nodemailer authenticates after STARTTLS and delivers one verification email", async (t) => {
    const server = await smtpFixture(t);
    const options = [];
    const runtime = loadMail({
      env: { AUTH_SMTP_PORT: String(server.port) },
      createTransport(config) {
        options.push(config);
        // Trust only this generated fixture certificate; keep certificate/hostname checks enabled.
        return nodemailer.createTransport({ ...config, tls: { ...config.tls, ca: certificate.cert, servername: "localhost" } });
      }
    });
    runtime.mail.assertAuthMailConfigured();
    assert.equal(await runtime.mail.sendAuthMail(recipient, token, "verify"), undefined);
    assert.equal(options.length, 1);
    assert.equal(options[0].secure, false);
    assert.equal(options[0].requireTLS, true);
    assert.equal(options[0].tls.minVersion, "TLSv1.2");
    assert.notEqual(options[0].tls.rejectUnauthorized, false);
    assert.equal(options[0].logger, false);
    assert.equal(options[0].debug, false);
    assert.deepEqual(server.auth, [{ encrypted: true, user: settings.AUTH_SMTP_USER, password: settings.AUTH_SMTP_PASSWORD }]);
    assert.equal(server.mailFrom, "auth@example.test");
    assert.deepEqual(server.recipients, [recipient]);
    assert.equal(server.messages.length, 1);
    const { headers, text } = decodeMessage(server.messages[0]);
    assert.equal(headers.get("from"), settings.AUTH_MAIL_FROM);
    assert.equal(headers.get("to"), recipient);
    assert.equal(headers.get("subject"), "验证邮箱");
    assert.equal(headers.has("bcc"), false);
    assert.equal(headers.has("cc"), false);
    assertLink(text, "verify");
    assert.deepEqual(runtime.logs, []);
  });

  for (const failure of ["untrusted-certificate", "hostname-mismatch", "no-starttls", "auth", "recipient", "data"]) {
    await suite.test(`real Nodemailer ${failure} failure rejects with a sanitized AuthError`, async (t) => {
      const server = await smtpFixture(t, failure);
      const runtime = loadMail({
        env: { AUTH_SMTP_PORT: String(server.port) },
        createTransport(config) {
          if (failure === "untrusted-certificate") return nodemailer.createTransport(config);
          return nodemailer.createTransport({
            ...config,
            tls: { ...config.tls, ca: certificate.cert, servername: failure === "hostname-mismatch" ? "wrong.example.test" : "localhost" }
          });
        }
      });
      await assertUnavailable(runtime, () => runtime.mail.sendAuthMail(recipient, token, "reset"));
      if (["untrusted-certificate", "hostname-mismatch", "no-starttls"].includes(failure)) {
        assert.deepEqual(server.auth, [], "credentials must never be sent before validated TLS");
      } else {
        assert.equal(server.auth.length, 1);
        assert.equal(server.auth[0].encrypted, true);
      }
      assert.equal(server.messages.length, failure === "data" ? 1 : 0);
    });
  }

  await suite.test("implicit TLS on 465, accepted result and transport closure", async () => {
    let calls = 0;
    let closed = 0;
    const runtime = loadMail({
      env: { AUTH_SMTP_PORT: "465", AUTH_MAIL_TRANSPORT: "smtp", AUTH_MAIL_API_URL: "https://unused.example.test" },
      createTransport(config) {
        calls++;
        assert.equal(config.port, 465);
        assert.equal(config.secure, true);
        assert.equal(config.requireTLS, false);
        assert.equal(config.tls.minVersion, "TLSv1.2");
        assert.equal(config.disableFileAccess, true);
        assert.equal(config.disableUrlAccess, true);
        assert.equal(config.auth.user, settings.AUTH_SMTP_USER);
        assert.equal(config.auth.pass, settings.AUTH_SMTP_PASSWORD);
        return {
          async sendMail(message) { assertMessage(message, "reset"); return { accepted: [recipient], rejected: [] }; },
          close() { closed++; }
        };
      }
    });
    await runtime.mail.sendAuthMail(recipient, token, "reset");
    assert.equal(calls, 1, "explicit SMTP must override an available HTTP endpoint");
    assert.equal(closed, 1);
  });

  for (const failure of ["empty-accepted", "missing-accepted", "throw", "construction"]) {
    await suite.test(`SMTP ${failure} cannot report delivery or disclose diagnostics`, async () => {
      let closed = 0;
      const runtime = loadMail({
        createTransport() {
          if (failure === "construction") throw new Error(leaked);
          return {
            async sendMail() {
              if (failure === "throw") throw Object.assign(new Error(leaked), { response: leaked });
              return failure === "empty-accepted" ? { accepted: [], rejected: [recipient] } : {};
            },
            close() { closed++; }
          };
        }
      });
      await assertUnavailable(runtime, () => runtime.mail.sendAuthMail(recipient, token, "reset"));
      assert.equal(closed, failure === "construction" ? 0 : 1);
    });
  }

  for (const explicit of [false, true]) {
    await suite.test(`${explicit ? "explicit" : "default"} HTTP selection sends the gateway contract`, async (t) => {
      const gateway = await httpFixture(t, 202);
      const runtime = loadMail({ env: {
        NODE_ENV: "test",
        AUTH_MAIL_TRANSPORT: explicit ? "http" : undefined,
        AUTH_MAIL_API_URL: gateway.url,
        AUTH_SMTP_HOST: undefined,
        AUTH_SMTP_USER: undefined,
        AUTH_SMTP_PASSWORD: undefined
      } });
      runtime.mail.assertAuthMailConfigured();
      await runtime.mail.sendAuthMail(recipient, token, "reset");
      assert.equal(gateway.requests.length, 1);
      const request = gateway.requests[0];
      assert.equal(request.method, "POST");
      assert.equal(request.authorization, `Bearer ${settings.AUTH_MAIL_API_KEY}`);
      assert.equal(request.contentType, "application/json");
      assert.equal(request.url, "/send", "tokens must not appear in transport URLs");
      assertMessage(request.body, "reset");
      assert.deepEqual(runtime.logs, []);
    });
  }

  for (const status of [401, 429, 500, 302]) {
    await suite.test(`HTTP ${status} rejects safely and never follows redirects`, async (t) => {
      const gateway = await httpFixture(t, status);
      const runtime = loadMail({ env: { NODE_ENV: "test", AUTH_MAIL_API_URL: gateway.url } });
      await assertUnavailable(runtime, () => runtime.mail.sendAuthMail(recipient, token, "verify"));
      assert.equal(gateway.requests.length, 1);
    });
  }

  await suite.test("HTTP network failures suppress diagnostics and use a bounded nonredirecting request", async () => {
    let calls = 0;
    const runtime = loadMail({
      env: { AUTH_MAIL_TRANSPORT: "http", AUTH_MAIL_API_URL: "https://mail.example.test/send" },
      async fetch(url, options) {
        calls++;
        assert.equal(String(url), "https://mail.example.test/send");
        assert.equal(options.redirect, "error");
        assert.ok(options.signal instanceof AbortSignal);
        throw new Error(leaked);
      }
    });
    await assertUnavailable(runtime, () => runtime.mail.sendAuthMail(recipient, token, "verify"));
    assert.equal(calls, 1);
  });

  const invalid = [
    { AUTH_MAIL_FROM: "auth@example.test\r\nBcc: thief@example.test" },
    { AUTH_APP_URL: "https://user:password@app.example.test" },
    { AUTH_APP_URL: "http://app.example.test" },
    { AUTH_MAIL_TRANSPORT: "unsupported" },
    { AUTH_SMTP_HOST: "smtp.example.test/path" },
    { AUTH_SMTP_PORT: "0" },
    { AUTH_SMTP_PORT: "65536" },
    { AUTH_SMTP_PORT: "2.5" },
    { AUTH_SMTP_USER: " " },
    { AUTH_SMTP_PASSWORD: " " },
    { AUTH_MAIL_TRANSPORT: "http", AUTH_MAIL_API_URL: "http://mail.example.test/send" },
    { AUTH_MAIL_TRANSPORT: "http", AUTH_MAIL_API_URL: "https://user:password@mail.example.test/send" },
    { AUTH_MAIL_TRANSPORT: "http", AUTH_MAIL_API_URL: "https://mail.example.test/send", AUTH_MAIL_API_KEY: " " }
  ];
  for (const [index, env] of invalid.entries()) {
    await suite.test(`invalid mail configuration ${index + 1} fails before either transport`, async () => {
      const runtime = loadMail({ env });
      assert.throws(() => runtime.mail.assertAuthMailConfigured(), (error) => {
        assertSafeError(error);
        return true;
      });
      await assertUnavailable(runtime, () => runtime.mail.sendAuthMail(recipient, token, "verify"));
    });
  }
});

function loadMail(overrides = {}) {
  const logs = [];
  const modules = {};
  for (const name of ["errors", "smtp", "mail"]) {
    const sandbox = {
      process: { env: { ...settings, ...overrides.env } },
      URL, URLSearchParams, AbortSignal,
      fetch: overrides.fetch ?? globalThis.fetch,
      console: Object.fromEntries(["log", "warn", "error", "debug", "info"].map((level) => [level, (...args) => logs.push(args)])),
      exports: {},
      require(specifier) {
        if (specifier === "nodemailer") return { createTransport: overrides.createTransport ?? (() => assert.fail("Unexpected SMTP transport")) };
        assert.ok(Object.hasOwn(modules, specifier), `Unexpected import: ${specifier}`);
        return modules[specifier];
      }
    };
    vm.createContext(sandbox);
    new vm.Script(sources.get(name), { filename: `src/lib/auth/${name}.ts` }).runInContext(sandbox);
    modules[`./${name}`] = sandbox.exports;
  }
  return { mail: modules["./mail"], logs };
}

async function assertUnavailable(runtime, action) {
  await assert.rejects(action, (error) => { assertSafeError(error); return true; });
  assert.deepEqual(runtime.logs, [], "mail failures must not log tokens or transport errors");
}

function assertSafeError(error) {
  assert.equal(error.name, "AuthError");
  assert.equal(error.status, 503);
  assert.equal(error.message, unavailable);
  assert.equal(error.cause, undefined);
  const publicError = inspect(error, { showHidden: true });
  for (const secret of [upstreamSecret, recipient, token, settings.AUTH_SMTP_PASSWORD, settings.AUTH_MAIL_API_KEY]) {
    assert.equal(publicError.includes(secret), false, "upstream diagnostics must not escape through the error");
  }
}

function assertMessage(message, purpose) {
  assert.deepEqual(Object.keys(message).sort(), ["from", "subject", "text", "to"]);
  assert.equal(message.from, settings.AUTH_MAIL_FROM);
  assert.equal(message.to, recipient);
  assert.equal(message.subject, purpose === "verify" ? "验证邮箱" : "重设密码");
  assertLink(message.text, purpose);
}

function assertLink(text, purpose) {
  const link = new URL(text.match(/https:\/\/[^\s]+/u)[0]);
  assert.equal(link.origin, "https://app.example.test");
  assert.equal(link.pathname, purpose === "verify" ? "/verify-email" : "/reset-password");
  assert.equal(link.search, "");
  assert.equal(link.hash, `#token=${token}`);
  assert.equal(new URLSearchParams(link.hash.slice(1)).get("token"), token);
  assert.ok(text.includes("30 分钟"));
  assert.ok(text.includes("仅可使用一次"));
}

function decodeMessage(raw) {
  const separator = raw.indexOf("\r\n\r\n");
  const headers = new Map(raw.slice(0, separator).replace(/\r\n[ \t]+/g, " ").split("\r\n").map((line) => {
    const colon = line.indexOf(":");
    return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim().replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, value) => Buffer.from(value, "base64").toString("utf8"))];
  }));
  const body = raw.slice(separator + 4);
  const encoding = headers.get("content-transfer-encoding");
  const text = encoding === "base64" ? Buffer.from(body, "base64").toString("utf8")
    : encoding === "quoted-printable" ? Buffer.from(body.replace(/=\r\n/g, "").replace(/=([A-F0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1").toString("utf8") : body;
  return { headers, text };
}

async function smtpFixture(t, failure) {
  const fixture = { auth: [], recipients: [], messages: [], mailFrom: undefined };
  const sockets = new Set();
  const secureContext = createSecureContext(certificate);
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.write("220 localhost fixture SMTP\r\n");
    attach(socket, false);
  });
  function attach(socket, encrypted) {
    sockets.add(socket);
    socket.on("error", () => {});
    let pending = "";
    let data;
    const onData = (chunk) => {
      pending += chunk.toString("utf8");
      for (let end; (end = pending.indexOf("\r\n")) >= 0;) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data !== undefined) {
          if (line !== ".") { data += `${line.replace(/^\.\./, ".")}\r\n`; continue; }
          fixture.messages.push(data);
          data = undefined;
          socket.write(failure === "data" ? `554 ${leaked}\r\n` : "250 Message accepted\r\n");
        } else if (/^(EHLO|HELO) /i.test(line)) {
          socket.write(encrypted ? "250-localhost\r\n250 AUTH PLAIN\r\n" : failure === "no-starttls" ? "250 localhost\r\n" : "250-localhost\r\n250 STARTTLS\r\n");
        } else if (line === "STARTTLS") {
          if (failure === "no-starttls") { socket.write(`454 ${leaked}\r\n`); continue; }
          socket.removeListener("data", onData);
          socket.write("220 Start TLS\r\n", () => attach(new TLSSocket(socket, { isServer: true, secureContext }), true));
          return;
        } else if (line.startsWith("AUTH PLAIN ")) {
          const [, user, password] = Buffer.from(line.slice(11), "base64").toString("utf8").split("\0");
          fixture.auth.push({ encrypted, user, password });
          socket.write(failure === "auth" ? `535 ${leaked}\r\n` : "235 Authentication succeeded\r\n");
        } else if (line.startsWith("MAIL FROM:")) {
          fixture.mailFrom = line.match(/<([^>]+)>/)[1];
          socket.write("250 Sender accepted\r\n");
        } else if (line.startsWith("RCPT TO:")) {
          fixture.recipients.push(line.match(/<([^>]+)>/)[1]);
          socket.write(failure === "recipient" ? `550 ${leaked}\r\n` : "250 Recipient accepted\r\n");
        } else if (line === "DATA") {
          data = "";
          socket.write("354 End with dot\r\n");
        } else if (line === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("500 Unexpected command\r\n");
      }
    };
    socket.on("data", onData);
  }
  await listen(server);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { ...fixture, get mailFrom() { return fixture.mailFrom; }, port: server.address().port };
}

async function httpFixture(t, status) {
  const requests = [];
  const server = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, contentType: request.headers["content-type"], body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    response.writeHead(status, { "Content-Type": "application/json", Location: `http://127.0.0.1:${server.address().port}/redirect-target` });
    response.end(JSON.stringify({ diagnostic: leaked }));
  });
  await listen(server);
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}/send`, requests };
}

function listen(server) {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
}

function makeCertificate() {
  // Generate a disposable self-signed certificate with Node crypto, avoiding openssl/dependencies/fixtures.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const der = (tag, ...parts) => {
    const bytes = Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));
    const length = bytes.length < 128 ? [bytes.length] : bytes.length < 256 ? [0x81, bytes.length] : [0x82, bytes.length >> 8, bytes.length & 255];
    return Buffer.concat([Buffer.from([tag, ...length]), bytes]);
  };
  const sequence = (...parts) => der(0x30, ...parts);
  const oid = (hex) => der(0x06, Buffer.from(hex, "hex"));
  const algorithm = sequence(oid("2a8648ce3d040302")); // ecdsa-with-SHA256
  const name = sequence(der(0x31, sequence(oid("550403"), der(0x0c, "localhost"))));
  const extensions = der(0xa3, sequence(
    sequence(oid("551d13"), der(0x01, [0xff]), der(0x04, sequence(der(0x01, [0xff])))),
    sequence(oid("551d11"), der(0x04, sequence(der(0x82, "localhost"), der(0x87, [127, 0, 0, 1]))))
  ));
  const unsigned = sequence(der(0xa0, der(0x02, [2])), der(0x02, [1]), algorithm, name,
    sequence(der(0x17, "200101000000Z"), der(0x17, "491231235959Z")), name,
    publicKey.export({ type: "spki", format: "der" }), extensions);
  const signed = sequence(unsigned, algorithm, der(0x03, [0], sign("sha256", unsigned, privateKey)));
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
    cert: `-----BEGIN CERTIFICATE-----\n${signed.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`
  };
}
