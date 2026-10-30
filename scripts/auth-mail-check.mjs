import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./load-local-env.mjs";

const deadlineMs = 12_000;
const variableNames = ["NODE_ENV", "AUTH_APP_URL", "AUTH_MAIL_FROM", "AUTH_MAIL_TRANSPORT", "AUTH_SMTP_HOST", "AUTH_SMTP_PORT", "AUTH_SMTP_USER", "AUTH_SMTP_PASSWORD", "AUTH_MAIL_API_URL", "AUTH_MAIL_API_KEY"];
const messages = {
  auth: "Check AUTH_SMTP_USER and the QQ SMTP authorization code in AUTH_SMTP_PASSWORD; enable SMTP in the mailbox settings.",
  network: "Check DNS, outbound SMTP access, host and port; retry after connectivity is restored.",
  TLS: "Check the SMTP port and server certificate; port 465 uses TLS and other ports require STARTTLS. Do not disable certificate validation.",
  config: "Check mail configuration and install the project's Nodemailer dependency before SMTP verification.",
  unknown: "Check mail settings and provider availability, then retry. Upstream error details are intentionally omitted."
};

// Only structured, recognized codes influence classification. Never stringify an
// exception, message, stack, response, or arbitrary provider-controlled value.
function classify(error) {
  try {
    const code = error?.code;
    if (code === "EAUTH" || error?.responseCode === 535) return "auth";
    if (["ETLS", "EPROTO", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_SSL_WRONG_VERSION_NUMBER"].includes(code)) return "TLS";
    if (["ETIMEDOUT", "ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ESOCKET"].includes(code)) return "network";
    if (["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "EINVAL", "EENVELOPE"].includes(code)) return "config";
  } catch { /* Even unusual thrown objects must not escape into output. */ }
  return "unknown";
}

function validUrl(value, local) {
  try {
    const url = new URL(value || "");
    return !url.username && !url.password && (url.protocol === "https:" || (local && url.protocol === "http:"));
  } catch { return false; }
}

/** Reusable diagnostic. envFiles: [] allows hermetic callers to skip local files.
 * Returns an exit status; output contains only fixed messages and variable names.
 * The CLI loads .env.local then .env with the shared loader's existing precedence.
 * loadNodemailer may be injected by tests; it returns an ES module namespace.
 */
export async function runAuthMailCheck({ argv = [], env = process.env, write = console.log, envFiles, verificationTimeoutMs = deadlineMs, loadNodemailer = () => import("nodemailer") } = {}) {
  let transport;
  let timer;
  try {
    if (argv.some((arg) => arg !== "--verify" && arg !== "--help")) {
      write("[config] Supported options: --verify, --help.");
      return 1;
    }
    if (argv.includes("--help")) {
      write("Usage: node scripts/auth-mail-check.mjs [--verify]. Default: configuration only, no network. --verify: SMTP connection/authentication only, no email; HTTP remains unverified.");
      return 0;
    }
    loadLocalEnv(envFiles === undefined ? {} : { files: envFiles });
    const present = (name) => typeof env[name] === "string" && Boolean(env[name].trim());
    for (const name of variableNames) write(`${name}: ${present(name) ? "configured" : "missing"}`);
    const errors = [];
    const required = (name) => { if (!present(name)) errors.push(`${name}: missing required configuration.`); };
    const local = env.NODE_ENV !== "production";
    required("AUTH_APP_URL");
    required("AUTH_MAIL_FROM");
    if (!validUrl(env.AUTH_APP_URL, local)) errors.push("AUTH_APP_URL: invalid; use HTTPS (HTTP allowed outside production), with no URL credentials.");
    if (/[\r\n]/.test(env.AUTH_MAIL_FROM || "")) errors.push("AUTH_MAIL_FROM: invalid; remove line breaks.");
    // Keep the same default selection as src/lib/auth/mail.ts. Explicit values
    // must be exactly smtp or http; never print an unrecognized value.
    const mode = env.AUTH_MAIL_TRANSPORT || (env.AUTH_MAIL_API_URL ? "http" : "smtp");
    let port;
    if (mode === "smtp") {
      for (const name of ["AUTH_SMTP_HOST", "AUTH_SMTP_USER", "AUTH_SMTP_PASSWORD"]) required(name);
      if (/[\s/@?#:]/.test(env.AUTH_SMTP_HOST?.trim() || "")) errors.push("AUTH_SMTP_HOST: invalid; use a hostname without a scheme or port.");
      port = Number(env.AUTH_SMTP_PORT || "465");
      if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("AUTH_SMTP_PORT: invalid; use an integer from 1 to 65535.");
      if (!env.AUTH_SMTP_PORT) write("AUTH_SMTP_PORT: default configured (465).");
    } else if (mode === "http") {
      required("AUTH_MAIL_API_URL");
      required("AUTH_MAIL_API_KEY");
      if (!validUrl(env.AUTH_MAIL_API_URL, local)) errors.push("AUTH_MAIL_API_URL: invalid; use HTTPS (HTTP allowed outside production), with no URL credentials.");
    } else errors.push("AUTH_MAIL_TRANSPORT: invalid; choose smtp or http.");
    if (errors.length) {
      for (const message of errors) write(`[config] ${message}`);
      return 1;
    }
    if (mode === "http") {
      write("HTTP: configured, not verified. No approved verification endpoint; no API request made.");
      return 0;
    }
    write(port === 465 ? "SMTP: configured; TLS on port 465." : "SMTP: configured; STARTTLS required.");
    if (!argv.includes("--verify")) {
      write("Dry check passed; connectivity not verified. Use --verify for SMTP connection/authentication only; no email is sent.");
      return 0;
    }
    const budget = Number.isFinite(verificationTimeoutMs) ? Math.max(1, Math.min(deadlineMs, verificationTimeoutMs)) : deadlineMs;
    // Includes dependency loading and verification. Keep a referenced timer so a
    // hung verification cannot silently exit without a result.
    let expired = false;
    await Promise.race([
      new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject({ code: "ETIMEDOUT" }); }, budget);
      }),
      (async () => {
        const { default: nodemailer } = await loadNodemailer();
        if (expired) return;
        transport = nodemailer.createTransport({
          host: env.AUTH_SMTP_HOST.trim(), port,
          secure: port === 465, requireTLS: port !== 465,
          tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
          auth: { user: env.AUTH_SMTP_USER, pass: env.AUTH_SMTP_PASSWORD },
          connectionTimeout: Math.min(10_000, budget),
          greetingTimeout: Math.min(10_000, budget),
          socketTimeout: Math.min(10_000, budget),
          disableFileAccess: true, disableUrlAccess: true,
          logger: false, debug: false
        });
        const verified = await transport.verify();
        if (verified !== true) throw {};
      })()
    ]);
    write("SMTP: verified connection and authentication; no email sent. Delivery is not verified.");
    return 0;
  } catch (error) {
    const category = classify(error);
    write(`[${category}] ${messages[category]}`);
    return 1;
  } finally {
    clearTimeout(timer);
    try { transport?.close(); } catch { /* Never print provider cleanup errors. */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runAuthMailCheck({ argv: process.argv.slice(2) });
  // SMTP libraries may retain sockets after a deadline. close() is called first;
  // the standalone CLI must still honor its overall bound.
  process.exit(process.exitCode);
}
