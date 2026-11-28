import { spawn } from "node:child_process";
import process from "node:process";

// Local preview server for the Claude Browser pane.
// Memory repository + local-email demo login, dummy LLM: no real keys, no database.
const port = process.env.PREVIEW_PORT ?? "3000";
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--hostname", "localhost", "--port", port],
  {
    env: {
      ...process.env,
      AUTH_MODE: "local-email",
      LLM_PROVIDER: "compatible",
      LLM_API_KEY: "",
      LLM_BASE_URL: "",
      LLM_MODEL: "",
      SESSION_COOKIE_SECRET: "preview-session-cookie-secret-ui-private-32",
      NEXT_TELEMETRY_DISABLED: "1",
      RENEWAL_REPOSITORY: "memory"
    },
    stdio: "inherit",
    shell: false
  }
);

const stop = () => { if (child.exitCode === null) child.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
child.on("exit", code => process.exit(code ?? 0));
