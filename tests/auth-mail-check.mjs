import assert from "node:assert/strict";
import { test } from "node:test";
import { runAuthMailCheck } from "../scripts/auth-mail-check.mjs";

const secret = "arbitrary-unclassified-credential-never-print-7b93";
const settings = {
  NODE_ENV: "production", AUTH_APP_URL: "https://app.example.invalid",
  AUTH_MAIL_FROM: `Sender <${secret}@example.invalid>`, AUTH_MAIL_TRANSPORT: "smtp",
  AUTH_SMTP_HOST: "smtp.example.invalid", AUTH_SMTP_PORT: "465",
  AUTH_SMTP_USER: `${secret}@example.invalid`, AUTH_SMTP_PASSWORD: secret,
  AUTH_MAIL_API_URL: "", AUTH_MAIL_API_KEY: secret
};
async function check({ env = {}, argv = [], verify = async () => true, timeout = 100, createError, closeError, loaderError, loader } = {}) {
  const state = { loads: 0, calls: 0, closed: 0, options: undefined };
  const nodemailer = {
    createTransport(options) {
      state.calls++;
      state.options = options;
      if (createError) throw createError;
      return {
        verify,
        sendMail() { assert.fail("A diagnostic must never send email"); },
        close() { state.closed++; if (closeError) throw closeError; }
      };
    }
  };
  const lines = [];
  const code = await runAuthMailCheck({
    env: { ...settings, ...env }, argv, envFiles: [], verificationTimeoutMs: timeout,
    write: (line) => lines.push(line),
    loadNodemailer: async () => {
      state.loads++;
      if (loaderError) throw loaderError;
      return loader ? loader(nodemailer) : { default: nodemailer };
    }
  });
  const output = lines.join("\n");
  assert.equal(output.includes(secret), false, "Diagnostic leaked synthetic credentials or provider text");
  assert.equal(output.includes(settings.AUTH_APP_URL), false, "Diagnostic printed a configured URL");
  assert.equal(output.includes(settings.AUTH_SMTP_HOST), false, "Diagnostic printed a configured host");
  return { code, output, ...state, state };
}

  await test("mail diagnostic uses actual modules, hermetic environment and injected SMTP", async (t) => {
    await t.test("dry check never imports a network transport", async () => {
      const result = await check();
      assert.equal(result.code, 0);
      assert.equal(result.loads, 0);
      assert.equal(result.calls, 0);
      assert.match(result.output, /connectivity not verified/);
    });
    await t.test("all missing required SMTP variables are identified by name", async () => {
      const result = await check({ env: Object.fromEntries(Object.keys(settings).map((name) => [name, ""])) });
      assert.equal(result.code, 1);
      for (const name of ["AUTH_APP_URL", "AUTH_MAIL_FROM", "AUTH_SMTP_HOST", "AUTH_SMTP_USER", "AUTH_SMTP_PASSWORD"]) {
        assert.ok(result.output.includes(`${name}: missing required configuration.`));
      }
      assert.equal(result.calls, 0);
    });
    await t.test("configuration validation precedes verification", async () => {
      for (const env of [
        { AUTH_MAIL_TRANSPORT: secret }, { AUTH_APP_URL: secret },
        { AUTH_APP_URL: "http://localhost:3000" }, { AUTH_APP_URL: `https://${secret}:x@app.example.invalid` },
        { AUTH_MAIL_FROM: `${secret}\r\nBcc: hidden@example.invalid` },
        { AUTH_SMTP_HOST: "smtp://example.invalid" }, { AUTH_SMTP_HOST: " " },
        { AUTH_SMTP_PORT: secret }, { AUTH_SMTP_PORT: "0" }, { AUTH_SMTP_PORT: "65536" }, { AUTH_SMTP_PORT: "1.5" },
        { AUTH_SMTP_USER: " " }, { AUTH_SMTP_PASSWORD: " " }
      ]) {
        const result = await check({ env, argv: ["--verify"] });
        assert.equal(result.code, 1);
        assert.match(result.output, /\[config\]/);
        assert.equal(result.calls, 0);
      }
    });
    await t.test("localhost HTTP app is allowed locally, HTTPS is required in production", async () => {
      assert.equal((await check({ env: { NODE_ENV: "development", AUTH_APP_URL: "http://localhost:3000" } })).code, 0);
    });
    await t.test("explicit transport wins; runtime defaults select SMTP or HTTP", async () => {
      assert.match((await check({ env: { AUTH_MAIL_TRANSPORT: "", AUTH_SMTP_PORT: "" } })).output, /default configured \(465\)/);
      assert.match((await check({ env: { AUTH_MAIL_API_URL: "https://gateway.example.invalid/send" } })).output, /SMTP: configured/);
      const result = await check({ env: { AUTH_MAIL_TRANSPORT: "", AUTH_MAIL_API_URL: "https://gateway.example.invalid/send" }, argv: ["--verify"] });
      assert.match(result.output, /HTTP: configured, not verified/);
      assert.equal(result.loads, 0);
      assert.equal(result.calls, 0);
    });
    await t.test("HTTP checks validate configuration and never call an API", async () => {
      for (const env of [
        { AUTH_MAIL_API_URL: "" }, { AUTH_MAIL_API_URL: secret }, { AUTH_MAIL_API_KEY: " " },
        { AUTH_MAIL_API_URL: "http://localhost/send" },
        { AUTH_MAIL_API_URL: `https://${secret}:password@gateway.example.invalid/send` }
      ]) {
        const result = await check({ env: { AUTH_MAIL_TRANSPORT: "http", AUTH_MAIL_API_URL: "https://gateway.example.invalid/send", ...env }, argv: ["--verify"] });
        assert.equal(result.code, 1);
        assert.equal(result.calls, 0);
      }
      const result = await check({ env: { AUTH_MAIL_TRANSPORT: "http", NODE_ENV: "development", AUTH_MAIL_API_URL: "http://localhost/send" }, argv: ["--verify"] });
      assert.equal(result.code, 0);
      assert.match(result.output, /no API request made/);
      assert.equal(result.loads, 0);
    });
    await t.test("SMTP verify enforces TLS, timeouts, disabled logging and closes", async () => {
      for (const port of ["465", "587", "25"]) {
        const result = await check({ env: { AUTH_SMTP_PORT: port }, argv: ["--verify"] });
        assert.equal(result.code, 0);
        assert.equal(result.calls, 1);
        assert.equal(result.loads, 1);
        assert.equal(result.closed, 1);
        assert.equal(result.options.secure, port === "465");
        assert.equal(result.options.requireTLS, port !== "465");
        assert.deepEqual(result.options.tls, { minVersion: "TLSv1.2", rejectUnauthorized: true });
        for (const name of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) assert.equal(result.options[name], 100);
        for (const name of ["logger", "debug"]) assert.equal(result.options[name], false);
        for (const name of ["disableFileAccess", "disableUrlAccess"]) assert.equal(result.options[name], true);
        assert.deepEqual(result.options.auth, { user: settings.AUTH_SMTP_USER, pass: secret });
        assert.match(result.output, /Delivery is not verified/);
      }
    });
    await t.test("fixed classifications suppress all raw provider messages and arbitrary secrets", async () => {
      for (const [code, category] of [["EAUTH", "auth"], ["ETIMEDOUT", "network"], ["ENOTFOUND", "network"], ["ETLS", "TLS"], ["CERT_HAS_EXPIRED", "TLS"], ["ERR_MODULE_NOT_FOUND", "config"], [secret, "unknown"]]) {
        const error = Object.assign(new Error(secret), { code, response: secret, stack: secret });
        const result = await check({ argv: ["--verify"], verify: async () => { throw error; } });
        assert.equal(result.code, 1);
        assert.match(result.output, new RegExp(`\\[${category}\\]`));
        assert.equal(result.closed, 1);
      }
      for (const error of [secret, null, { response: secret }, new Proxy({}, { get() { throw new Error(secret); } })]) {
        const result = await check({ argv: ["--verify"], verify: async () => { throw error; } });
        assert.match(result.output, /\[unknown\]/);
      }
    });
    await t.test("hung verification is bounded and closed; late rejection is handled", async () => {
      let rejectVerify;
      const result = await check({ argv: ["--verify"], timeout: 10, verify: () => new Promise((_, reject) => { rejectVerify = reject; }) });
      assert.equal(result.code, 1);
      assert.match(result.output, /\[network\]/);
      assert.equal(result.closed, 1);
      rejectVerify(new Error(secret));
      await new Promise((resolve) => setImmediate(resolve));
    });
    await t.test("creation, false verify and close failures never expose details", async () => {
      assert.match((await check({ argv: ["--verify"], createError: new Error(secret) })).output, /\[unknown\]/);
      assert.equal((await check({ argv: ["--verify"], verify: async () => false })).code, 1);
      assert.equal((await check({ argv: ["--verify"], closeError: new Error(secret) })).code, 0);
    });
    await t.test("injected loader errors are classified without leaking details", async () => {
      const result = await check({ argv: ["--verify"], loaderError: Object.assign(new Error(secret), { code: "ERR_MODULE_NOT_FOUND" }) });
      assert.equal(result.code, 1);
      assert.match(result.output, /\[config\]/);
      assert.equal(result.calls, 0);
    });
    await t.test("loader deadline prevents a late module from opening a transport", async () => {
      let finishLoad;
      const result = await check({ argv: ["--verify"], timeout: 10, loader: (nodemailer) => new Promise((resolve) => { finishLoad = () => resolve({ default: nodemailer }); }) });
      assert.equal(result.code, 1);
      assert.match(result.output, /\[network\]/);
      assert.equal(result.calls, 0);
      finishLoad();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(result.state.calls, 0);
    });
    await t.test("help and invalid arguments do not expose values or connect", async () => {
      assert.equal((await check({ argv: ["--help"] })).code, 0);
      assert.equal((await check({ argv: [secret] })).code, 1);
    });
  });
