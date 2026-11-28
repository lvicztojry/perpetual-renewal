export function shouldUseMemoryFallback() {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.RENEWAL_REPOSITORY === "memory" || !process.env.DATABASE_URL?.trim())
  );
}

export function shouldFallbackToMemoryOnPrismaError(error: unknown, options?: {
  codes?: ReadonlySet<string>;
  schemaHints?: string[];
}) {
  if (!shouldUseMemoryFallback()) return false;

  const code = typeof error === "object" && error ? (error as { code?: string }).code : undefined;
  if (code && options?.codes?.has(code)) return true;

  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Can't reach database server") ||
    message.includes("Environment variable not found") ||
    message.includes("does not exist in the current database") ||
    Boolean(options?.schemaHints?.some((hint) => message.includes(hint)))
  );
}
