import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { getRenewalService, MemoryUpdateValidationError } from "@/lib/renewal/service";
import type { MemoryStatus, MemoryType } from "@/lib/renewal/types";

type RouteContext = {
  params: Promise<{
    memoryId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { memoryId } = await context.params;
    const body = await readJsonObject(request);

    const nextStatus = normalizeMemoryStatus(readString(body.status));
    const nextType = normalizeMemoryType(readString(body.type));
    const nextContent = readString(body.content);

    if (readString(body.status) && !nextStatus) {
      return NextResponse.json({ error: "Unsupported memory status" }, { status: 400 });
    }

    if (readString(body.type) && !nextType) {
      return NextResponse.json({ error: "Unsupported memory type" }, { status: 400 });
    }

    const session = await getCurrentSession();
    const memory = await getRenewalService(session.userId).updateMemory(memoryId, {
      status: nextStatus,
      type: nextType,
      content: nextContent
    });

    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    return NextResponse.json({ memory });
  } catch (error) {
    if (error instanceof MemoryUpdateValidationError) {
      return NextResponse.json({ error: memoryUpdateErrorMessage(error) }, { status: 400 });
    }

    return NextResponse.json(
      { error: jsonErrorMessage(error, "Failed to update memory.") },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { memoryId } = await context.params;
  const session = await getCurrentSession();
  const memory = await getRenewalService(session.userId).deleteMemory(memoryId);

  if (!memory) {
    return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  }

  return NextResponse.json({ memory });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeMemoryStatus(value: string | undefined): MemoryStatus | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "active" ||
    normalized === "archived" ||
    normalized === "deleted"
  ) {
    return normalized;
  }

  return undefined;
}

function memoryUpdateErrorMessage(error: MemoryUpdateValidationError) {
  if (error.message === "content is required") return "content is required";
  return "Failed to update memory.";
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
