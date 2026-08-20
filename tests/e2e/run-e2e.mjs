import { spawn } from "node:child_process";
import process from "node:process";

const port = process.env.E2E_PORT ?? "3000";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const nextBin = "node_modules/next/dist/bin/next";
const playwrightBin = "node_modules/@playwright/test/cli.js";
const extraArgs = process.argv.slice(2);

const server = spawn(process.execPath, [nextBin, "dev", "--hostname", "localhost", "--port", port], {
  env: {
    ...process.env,
    LLM_PROVIDER: "compatible",
    LLM_API_KEY: "",
    LLM_BASE_URL: "",
    LLM_MODEL: "",
    NEXT_TELEMETRY_DISABLED: "1",
    RENEWAL_REPOSITORY: "memory"
  },
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true
});

let serverExited = false;
let cleaning = false;

server.on("exit", (code, signal) => {
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
  if (cleaning || serverExited) {
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
}

process.exit(exitCode);
