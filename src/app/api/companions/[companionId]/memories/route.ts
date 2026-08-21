import { NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { getRenewalService, MemoryCandidateValidationError } from "@/lib/renewal/service";
import type { MemoryType } from "@/lib/renewal/types";

type RouteContext = {
  params: Promise<{
    companionId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { companionId } = await context.params;
  const { searchParams } = new URL(request.url);
  const includeDeleted = searchParams.get("includeDeleted") === "true";
  const session = await getCurrentSession();
  const memories = await getRenewalService(session.userId).listMemories(
    companionId,
    includeDeleted
  );

  return privateJson({ memories });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { companionId } = await context.params;
  let body: Record<string, unknown>;

  try {
    body = await readJsonObject(request);
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to create memory candidates.") },
      { status: 400 }
    );
  }

  const sourceMessageId = readString(body.sourceMessageId);
  const content = readString(body.content);
  const explicitType = normalizeMemoryType(readString(body.type));

  if (!content) {
    return privateJson({ error: "content is required" }, { status: 400 });
  }

  if (readString(body.type) && !explicitType) {
    return privateJson({ error: "Unsupported memory type" }, { status: 400 });
  }

  const session = await getCurrentSession();
  let memories;
  try {
    memories = await getRenewalService(session.userId).createMemoryCandidates(
      companionId,
      {
        sourceMessageId,
        content,
        type: explicitType
      }
    );
  } catch (error) {
    if (error instanceof MemoryCandidateValidationError) {
      return privateJson({ error: memoryCandidateErrorMessage(error) }, { status: 400 });
    }
    throw error;
  }

  if (!memories) {
    return privateJson({ error: "Companion not found" }, { status: 404 });
  }

  return privateJson({ memories }, { status: 201 });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeMemoryType(value: string | undefined): MemoryType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "user_fact" ||
    normalized === "relationship_event" ||
    normalized === "companion_profile" ||
    normalized === "emotional_preference"
  ) {
    return normalized;
  }

  return undefined;
}

function memoryCandidateErrorMessage(error: MemoryCandidateValidationError) {
  if (error.message === "content is required") return "content is required";
  if (error.message === "sourceMessageId was not found") return "sourceMessageId was not found";
  return "Failed to create memory candidates.";
}
