import { existsSync, readFileSync } from "node:fs";

export function loadLocalEnv(options = {}) {
  const files = options.files ?? [".env.local", ".env"];
  const override = Boolean(options.override);
  const loaded = [];

  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }

    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let loadedCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || (!override && process.env[match[1]])) {
        continue;
      }

      process.env[match[1]] = stripQuotes(match[2]);
      loadedCount += 1;
    }

    loaded.push({ file, loadedCount });
  }

  return loaded;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
