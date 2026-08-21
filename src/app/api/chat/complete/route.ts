import { NextResponse } from "next/server";
import {
  generateCompanionReply,
  type GenerateCompanionReplyInput
} from "@/lib/chat/generate-reply";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { LlmProviderError } from "@/lib/llm/types";
import { createUserLlmProvider } from "@/lib/llm/user-provider";
import { recordModelUsage } from "@/lib/usage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await readJsonObject(request);
  } catch (error) {
    return NextResponse.json(
      { error: jsonErrorMessage(error, "Failed to generate reply.") },
      { status: 400 }
    );
  }

  if (!isGenerateReplyInput(body)) {
    return NextResponse.json(
      { error: "Missing required companion profile or recent messages." },
      { status: 400 }
    );
  }

  const startedAt = Date.now();

  try {
    const session = await getCurrentSession();
    const provider = await createUserLlmProvider(session.userId);
    const result = await generateCompanionReply(body, provider);
    await recordModelUsage({
      userId: session.userId,
      purpose: "chat_complete_api",
      provider: result.provider,
      model: result.model,
      status: "success",
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      fallbackReason: result.fallbackReason
    });
    return NextResponse.json(result);
  } catch (error) {
    const session = await getCurrentSession().catch(() => null);
    if (error instanceof LlmProviderError) {
      if (session) {
        await recordModelUsage({
          userId: session.userId,
          purpose: "chat_complete_api",
          provider: error.details.provider,
          model: error.details.model,
          status: "error",
          errorKind: error.details.kind,
          httpStatus: error.details.status,
          latencyMs: Date.now() - startedAt
        });
      }
      return NextResponse.json(
        {
          error: "LLM provider failed.",
          kind: error.details.kind,
          provider: error.details.provider,
          model: error.details.model,
          status: error.details.status,
          retryable: error.details.retryable
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ error: "Failed to generate reply." }, { status: 500 });
  }
}

function isGenerateReplyInput(value: unknown): value is GenerateCompanionReplyInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GenerateCompanionReplyInput>;

  return (
    !!candidate.companion &&
    typeof candidate.companion.name === "string" &&
    typeof candidate.companion.relationshipKind === "string" &&
    Array.isArray(candidate.recentMessages) &&
    candidate.recentMessages.every(
      (message) =>
        message &&
        typeof message === "object" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
    )
  );
}
