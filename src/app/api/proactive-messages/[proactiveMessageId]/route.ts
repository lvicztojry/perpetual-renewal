import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { createRenewalRepository } from "@/lib/renewal/repository";
import type { ProactiveMessageStatus } from "@/lib/renewal/types";

type RouteContext = {
  params: Promise<{ proactiveMessageId: string }>;
};

type ProactiveMessagePatch = {
  status?: unknown;
};

const statusValues = new Set<ProactiveMessageStatus>(["draft", "sent", "dismissed", "blocked"]);

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: RouteContext) {
  const { proactiveMessageId } = await context.params;
  let body: ProactiveMessagePatch;

  try {
    body = (await request.json()) as ProactiveMessagePatch;
  } catch {
    return NextResponse.json({ error: "Expected a valid JSON body." }, { status: 400 });
  }

  const status = readStatus(body.status);
  if (!status) {
    return NextResponse.json({ error: "Unsupported proactive message status." }, { status: 400 });
  }

  const session = await getCurrentSession();
  const repository = createRenewalRepository();
  const proactiveMessage = await repository.updateProactiveMessage(
    session.userId,
    proactiveMessageId,
    { status }
  );

  if (!proactiveMessage) {
    return NextResponse.json({ error: "Proactive message not found." }, { status: 404 });
  }

  return NextResponse.json({
    proactiveMessage,
    persistence: repository.persistence
  });
}

function readStatus(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as ProactiveMessageStatus;
  return statusValues.has(normalized) ? normalized : null;
}
