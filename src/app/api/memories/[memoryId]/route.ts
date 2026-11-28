import { NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { JsonRequestError, jsonErrorMessage, readJsonObject, readOptionalJsonObject } from "@/lib/http/json";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
import { getRenewalService, MemoryUpdateValidationError } from "@/lib/renewal/service";
import { MemoryLifecycleError } from "@/lib/memory/lifecycle";
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
      return privateJson({ error: "Unsupported memory status" }, { status: 400 });
    }

    if (readString(body.type) && !nextType) {
      return privateJson({ error: "Unsupported memory type" }, { status: 400 });
    }

    const session = await getCurrentSession();
    if (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
      return privateJson({ error: "请重新读取记忆后再确认修改。" }, { status: 400 });
    }
    const memory = await getRenewalService(session.userId).updateMemory(memoryId, {
      expectedUpdatedAt: body.expectedUpdatedAt as string | undefined,
      status: nextStatus,
      type: nextType,
      content: nextContent
    });

    if (!memory) {
      return privateJson({ error: "Memory not found" }, { status: 404 });
    }

    return privateJson({ memory });
  } catch (error) {
    if (error instanceof JsonRequestError) return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof MemoryLifecycleError) return privateJson({ error: error.message }, { status: error.status });
    const persistenceError = persistenceUnavailableResponse(error, "renewal");
    if (persistenceError) return persistenceError;

    if (error instanceof MemoryUpdateValidationError) {
      return privateJson({ error: memoryUpdateErrorMessage(error) }, { status: 400 });
    }

    return privateJson(
      { error: jsonErrorMessage(error, "Failed to update memory.") },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { memoryId } = await context.params;
    const session = await getCurrentSession();
    const body = await readOptionalJsonObject(request);
    const memory = await getRenewalService(session.userId).updateMemory(memoryId, { status: "deleted", expectedUpdatedAt: body.expectedUpdatedAt as string | undefined });

    if (!memory) {
      return privateJson({ error: "Memory not found" }, { status: 404 });
    }

    return privateJson({ memory });
  } catch (error) {
    if (error instanceof JsonRequestError) return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof MemoryLifecycleError) return privateJson({ error: error.message }, { status: error.status });
    const persistenceError = persistenceUnavailableResponse(error, "renewal");
    if (persistenceError) return persistenceError;

    throw error;
  }
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
