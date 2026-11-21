function httpOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

/** Next may expose an internal hostname in request.url when accessed over LAN/proxy. */
export function isTrustedMutationOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const supplied = request.headers.get("origin");
  const origin = httpOrigin(supplied ?? undefined);
  // Origin headers are serialized origins, never paths, credentials or opaque "null".
  if (!origin || supplied !== origin) return false;
  const allowed = new Set([httpOrigin(request.url), httpOrigin(process.env.AUTH_APP_URL)]);
  if (process.env.NODE_ENV === "development") {
    for (const value of (process.env.AUTH_DEV_ALLOWED_ORIGINS ?? "").split(",")) {
      // Match the exact development origins configured by the LAN launcher.
      const entry = value.trim();
      const candidate = httpOrigin(entry);
      if (candidate && entry === candidate) allowed.add(candidate);
    }
  }
  // Do not derive trust from client-controlled Host/Forwarded headers or subnet patterns.
  return allowed.has(origin);
}
