import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
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
    body = (await readJsonObject(request)) as ProactiveMessagePatch;
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to update proactive message.") },
      { status: 400 }
    );
  }

  const status = readStatus(body.status);
  if (!status) {
    return privateJson({ error: "Unsupported proactive message status." }, { status: 400 });
  }

  const session = await getCurrentSession();
  const repository = createRenewalRepository();
  const proactiveMessage = await repository.updateProactiveMessage(
    session.userId,
    proactiveMessageId,
    { status }
  );

  if (!proactiveMessage) {
    return privateJson({ error: "Proactive message not found." }, { status: 404 });
  }

  return privateJson({
    proactiveMessage,
    persistence: repository.persistence
  });
}

function readStatus(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as ProactiveMessageStatus;
  return statusValues.has(normalized) ? normalized : null;
}
