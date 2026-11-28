export function migrationDatabaseUrl(env = process.env) {
  const configured = env.DATABASE_URL_UNPOOLED?.trim() || env.DATABASE_URL?.trim();
  if (!configured) return undefined;
  let url;
  try {
    url = new URL(configured);
    if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("Invalid database migration URL.");
  }
  if (url.hostname.endsWith(".neon.tech")) {
    // Both endpoints belong to the same Neon compute; migrations need session affinity.
    url.hostname = url.hostname.replace("-pooler.", ".");
    if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
  }
  return url.toString();
}
