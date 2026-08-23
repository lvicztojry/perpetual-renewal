import { privateJson } from "./private-response";

const databaseUnavailableCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1017",
  "P2021",
  "P2024"
]);

const unavailableMessageHints = [
  "Can't reach database server",
  "Can't connect to database server",
  "Connection terminated unexpectedly",
  "Connection refused",
  "Connection timed out",
  "Environment variable not found: DATABASE_URL",
  "Timed out fetching a new connection from the connection pool",
  "prepared statement",
  "server closed the connection"
];

type PersistenceErrorContext =
  | "auth"
  | "credentials"
  | "export"
  | "profile"
  | "renewal"
  | "safety"
  | "usage"
  | "workspace";

const contextMessages: Record<PersistenceErrorContext, string> = {
  auth: "数据库暂时不可用，登录状态无法确认。请稍后重试；如果你正在本地开发，请检查 DATABASE_URL 是否可连接。",
  credentials: "数据库暂时不可用，模型连接配置没有保存成功。请稍后重试；页面不会泄露你的 API Key。",
  export: "数据库暂时不可用，暂时无法导出持久化数据。请稍后重试。",
  profile: "数据库暂时不可用，用户资料没有保存成功。请稍后重试。",
  renewal: "数据库暂时不可用，本次关系、消息或记忆操作没有保存成功。请稍后重试。",
  safety: "数据库暂时不可用，安全检查审计没有保存成功。请稍后重试。",
  usage: "数据库暂时不可用，暂时无法读取模型调用日志。请稍后重试。",
  workspace: "数据库暂时不可用，关系工作台无法读取持久化数据。请稍后重试。"
};

export function persistenceUnavailableResponse(
  error: unknown,
  context: PersistenceErrorContext
): Response | null {
  if (!isConfiguredDatabaseUnavailable(error)) return null;

  return privateJson(
    {
      error: contextMessages[context],
      errorType: "database_unavailable",
      retryable: true,
      persistence: "prisma"
    },
    { status: 503 }
  );
}

export function isConfiguredDatabaseUnavailable(error: unknown) {
  if (!hasConfiguredPersistentDatabase()) return false;

  const code = typeof error === "object" && error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && databaseUnavailableCodes.has(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return unavailableMessageHints.some((hint) => message.includes(hint));
}

function hasConfiguredPersistentDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim()) && process.env.RENEWAL_REPOSITORY !== "memory";
}
