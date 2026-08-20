import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getRenewalService } from "@/lib/renewal/service";
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

  return NextResponse.json({ memories });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { companionId } = await context.params;
  const body = await request.json();
  const sourceMessageId = readString(body.sourceMessageId);
  const content = readString(body.content);
  const explicitType = normalizeMemoryType(readString(body.type));

  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  if (readString(body.type) && !explicitType) {
    return NextResponse.json({ error: "Unsupported memory type" }, { status: 400 });
  }

  const session = await getCurrentSession();
  const memories = await getRenewalService(session.userId).createMemoryCandidates(
    companionId,
    {
      sourceMessageId,
      content,
      type: explicitType
    }
  );

  if (!memories) {
    return NextResponse.json({ error: "Companion not found" }, { status: 404 });
  }

  return NextResponse.json({ memories }, { status: 201 });
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
