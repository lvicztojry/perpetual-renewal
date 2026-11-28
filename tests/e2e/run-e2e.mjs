import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const port = process.env.E2E_PORT ?? "3000";
const existingBaseURL = process.env.E2E_BASE_URL?.trim();
const useExistingServer = Boolean(existingBaseURL);
const baseURL = existingBaseURL || `http://localhost:${port}`;
const nextBin = "node_modules/next/dist/bin/next";
const playwrightBin = "node_modules/@playwright/test/cli.js";
const extraArgs = process.argv.slice(2);
const realProviderMode = process.env.E2E_REAL_PROVIDER === "1";
const exploratoryMode = realProviderMode || useExistingServer;
const e2eSessionCookieSecret =
  process.env.E2E_SESSION_COOKIE_SECRET ?? "e2e-session-cookie-secret-ui-private-32";

if (extraArgs.includes("--help") || extraArgs.includes("-h")) {
  printHelp();
  process.exit(0);
}

printRunMode();

const baseServerEnv = {
  ...process.env,
  AUTH_MODE: process.env.E2E_AUTH_MODE ?? "local-email",
  SESSION_COOKIE_SECRET: e2eSessionCookieSecret,
  E2E_SESSION_COOKIE_SECRET: e2eSessionCookieSecret,
  NEXT_TELEMETRY_DISABLED: "1",
  RENEWAL_REPOSITORY: process.env.E2E_REPOSITORY ?? "memory"
};

const serverEnv = realProviderMode
  ? baseServerEnv
  : {
      ...baseServerEnv,
      // The default browser E2E suite is a local release gate. It must not depend on
      // network speed, provider quotas, or any real user key stored outside the repo.
      LLM_PROVIDER: "compatible",
      LLM_API_KEY: "",
      LLM_BASE_URL: "",
      LLM_MODEL: ""
    };

const server = useExistingServer
  ? null
  : spawn(process.execPath, [nextBin, "dev", "--hostname", "localhost", "--port", port], {
      env: serverEnv,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true
    });

let serverExited = false;
let cleaning = false;

server?.on("exit", (code, signal) => {
  serverExited = true;

  if (!cleaning) {
    console.error(`E2E server exited before tests finished: ${code ?? signal ?? "unknown"}`);
  }
});

async function waitForServer() {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    if (serverExited) {
      throw new Error("E2E server exited before becoming ready.");
    }

    try {
      const response = await fetch(baseURL, { redirect: "manual" });
      if (response.status < 500) {
        return;
      }
    } catch {
      // Keep polling until Next finishes booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${baseURL}`);
}

function killServer() {
  if (!server || cleaning || serverExited) {
    return Promise.resolve();
  }

  cleaning = true;

  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.on("exit", () => resolve());
      return;
    }

    server.once("exit", () => resolve());
    server.kill("SIGTERM");
    setTimeout(() => {
      if (!serverExited) {
        server.kill("SIGKILL");
      }
    }, 5_000).unref();
  });
}

async function runPlaywright() {
  return new Promise((resolve) => {
    const test = spawn(process.execPath, [playwrightBin, "test", ...extraArgs], {
      env: {
        ...process.env,
        E2E_SESSION_COOKIE_SECRET: e2eSessionCookieSecret,
        E2E_BASE_URL: baseURL
      },
      stdio: "inherit",
      windowsHide: true
    });

    test.on("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

let exitCode = 1;

try {
  await waitForServer();
  exitCode = await runPlaywright();
} catch (error) {
  console.error(error);
} finally {
  await killServer();
  normalizeNextTypes();
}

process.exit(exitCode);

function normalizeNextTypes() {
  const result = spawnSync(process.execPath, [nextBin, "typegen"], {
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: "inherit",
    windowsHide: true
  });

  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  }
}

function printRunMode() {
  const mode = exploratoryMode ? "existing/real-provider exploratory" : "mock/local release gate";
  const serverMode = useExistingServer ? "existing server" : "managed Next dev server";
  console.log(`[e2e] mode=${mode}`);
  console.log(`[e2e] server=${serverMode} baseURL=${baseURL}`);
  if (!realProviderMode && !useExistingServer) {
    console.log("[e2e] provider=mock fallback expected; LLM env is cleared for this managed run.");
  }
  if (exploratoryMode) {
    console.log(
      "[e2e] note=existing/real-provider runs are for manual triage, not PR or release gate evidence."
    );
  }
  console.log("");
}

function printHelp() {
  console.log(`Browser E2E runner

Default release gate:
  npm run e2e

  Starts a local Next dev server, uses the memory repository, clears LLM_API_KEY,
  LLM_BASE_URL and LLM_MODEL, and expects mock provider fallback. This is the
  stable browser gate for PR/release checks.

Existing server / manual real-provider triage:
  E2E_BASE_URL=http://localhost:3000 npm run e2e -- --project=chromium

  Reuses an already running server. If that server uses real PostgreSQL or a real
  LLM key from .env.local / the settings vault, treat the result as exploratory
  experience validation, not as the release gate.

Explicit real-provider mode for the managed dev server:
  E2E_REAL_PROVIDER=1 npm run e2e -- --project=chromium

  Keeps provider env vars visible to the spawned dev server. Use only for targeted
  diagnosis; provider latency, quota and network errors should not fail release.
`);
}
