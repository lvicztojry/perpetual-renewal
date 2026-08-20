import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const nextBin = "node_modules/next/dist/bin/next";
const nextEnvFile = "next-env.d.ts";

const result = spawnSync(process.execPath, [nextBin, "typegen"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1"
  },
  stdio: "inherit"
});

if (result.status !== 0) {
  if (result.error) {
    console.error(`Next typegen failed: ${result.error.message}`);
  }
  process.exit(result.status ?? 1);
}

normalizeNextEnv();

function normalizeNextEnv() {
  if (!existsSync(nextEnvFile)) {
    return;
  }

  const content = readFileSync(nextEnvFile, "utf8");
  const normalized = content.replaceAll("./.next/dev/types/", "./.next/types/");

  if (normalized !== content) {
    writeFileSync(nextEnvFile, normalized);
    console.log("Normalized next-env.d.ts to production route type imports.");
  }
}
