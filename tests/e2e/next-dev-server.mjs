import { spawn } from "node:child_process";
import process from "node:process";

const port = process.env.E2E_PORT || "3000";
const hostname = "localhost";
const e2eSessionCookieSecret =
  process.env.E2E_SESSION_COOKIE_SECRET ?? "e2e-session-cookie-secret-ui-private-32";
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--hostname", hostname, "--port", port],
  {
    env: {
      ...process.env,
      AUTH_MODE: "local-email",
      LLM_PROVIDER: "compatible",
      LLM_API_KEY: "",
      LLM_BASE_URL: "",
      LLM_MODEL: "",
      SESSION_COOKIE_SECRET: e2eSessionCookieSecret,
      E2E_SESSION_COOKIE_SECRET: e2eSessionCookieSecret,
      NEXT_TELEMETRY_DISABLED: "1",
      RENEWAL_REPOSITORY: "memory"
    },
    stdio: "inherit"
  }
);

let shuttingDown = false;

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  if (!shuttingDown && child.exitCode === null) {
    child.kill();
  }
});

child.on("exit", (code, signal) => {
  if (!shuttingDown) {
    process.exit(code ?? (signal ? 1 : 0));
  }
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore"
    });
    killer.on("exit", () => process.exit(0));
    killer.on("error", () => process.exit(0));
    return;
  }

  child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 2_000).unref();
}
