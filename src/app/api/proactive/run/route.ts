import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
  let body: ProactiveRunRequest;

  try {
    body = await readRequestBody(request);
  } catch (error) {
    return NextResponse.json(
      { error: jsonErrorMessage(error, "Failed to run proactive scheduler.") },
      { status: 400 }
    );
  }

  const scope = body.scope ?? "current-user";
  const cronAuthorized = isCronAuthorized(request);

  if (scope === "all" && !cronAuthorized) {
    return NextResponse.json(
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

  return NextResponse.json({
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
  const expected = process.env.PROACTIVE_CRON_SECRET?.trim();
  if (!expected) return false;

  const auth = request.headers.get("authorization") ?? "";
  const headerSecret = request.headers.get("x-proactive-cron-secret") ?? "";
  return auth === `Bearer ${expected}` || headerSecret === expected;
}
