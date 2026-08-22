import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readOptionalJsonObject } from "@/lib/http/json";
import { runProactiveScheduler } from "@/lib/relationship/proactive-scheduler";

type ProactiveRunRequest = {
  dryRun?: boolean;
  limit?: number;
  maxDrafts?: number;
  now?: string;
  scope?: "current-user" | "all";
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return privateJson(
      { error: "Cron authorization is required for proactive runs." },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const now = readNow(url.searchParams.get("now") ?? undefined);
  const result = await runProactiveScheduler({
    dryRun: readBooleanQuery(url.searchParams.get("dryRun")) ?? false,
    limit: readNumberQuery(url.searchParams.get("limit")),
    maxDrafts: readNumberQuery(url.searchParams.get("maxDrafts")),
    now
  });

  return privateJson({
    ...result,
    authMode: "cron-secret",
    now: now.toISOString()
  });
}

export async function POST(request: Request) {
  let body: ProactiveRunRequest;

  try {
    body = await readRequestBody(request);
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to run proactive scheduler.") },
      { status: 400 }
    );
  }

  const scope = body.scope ?? "current-user";
  const cronAuthorized = isCronAuthorized(request);

  if (scope === "all" && !cronAuthorized) {
    return privateJson(
      { error: "PROACTIVE_CRON_SECRET is required for all-user proactive runs." },
      { status: 401 }
    );
  }

  const session = scope === "current-user" ? await getCurrentSession() : null;
  const now = readNow(body.now);
  const result = await runProactiveScheduler({
    userId: session?.userId,
    dryRun: body.dryRun ?? true,
    limit: body.limit,
    maxDrafts: body.maxDrafts,
    now
  });

  return privateJson({
    ...result,
    authMode: scope === "all" ? "cron-secret" : session?.provider ?? "session",
    now: now.toISOString()
  });
}

async function readRequestBody(request: Request): Promise<ProactiveRunRequest> {
  return (await readOptionalJsonObject(request)) as ProactiveRunRequest;
}

function readNow(value: string | undefined) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function isCronAuthorized(request: Request) {
  const expectedSecrets = readCronSecrets();
  if (!expectedSecrets.length) return false;

  const auth = request.headers.get("authorization") ?? "";
  const headerSecret = request.headers.get("x-proactive-cron-secret") ?? "";
  return expectedSecrets.some(
    (expected) => auth === `Bearer ${expected}` || headerSecret === expected
  );
}

function readCronSecrets() {
  return [
    process.env.PROACTIVE_CRON_SECRET?.trim(),
    process.env.CRON_SECRET?.trim()
  ].filter((value, index, values): value is string =>
    Boolean(value && values.indexOf(value) === index)
  );
}

function readBooleanQuery(value: string | null) {
  if (value === null || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function readNumberQuery(value: string | null) {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
