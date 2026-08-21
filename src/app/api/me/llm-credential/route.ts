import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import {
  deleteLlmCredential,
  getLlmCredentialStatus,
  saveLlmCredential
} from "@/lib/credentials";
import { JsonRequestError, jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import type { LlmProviderAlias } from "@/lib/llm/types";

type CredentialRequest = {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
};

const allowedProviders = new Set<LlmProviderAlias>([
  "compatible",
  "openai-compatible",
  "anthropic",
  "gemini",
  "openai-responses"
]);

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const credential = await getLlmCredentialStatus(session.userId);
  return NextResponse.json({ credential });
}

export async function PUT(request: Request) {
  const session = await getCurrentSession();

  try {
    const body = (await readJsonObject(request)) as CredentialRequest;
    const credential = await saveLlmCredential(session.userId, parseCredentialRequest(body));
    return NextResponse.json({ credential });
  } catch (error) {
    if (error instanceof JsonRequestError) {
      return NextResponse.json(
        { error: jsonErrorMessage(error, "Failed to save credential.") },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save credential." },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const session = await getCurrentSession();
  const credential = await deleteLlmCredential(session.userId);
  return NextResponse.json({ credential });
}

function parseCredentialRequest(body: CredentialRequest) {
  const provider = readProvider(body.provider);
  const apiKey = readOptionalString(body.apiKey, "apiKey", 8, 4096);
  const model = readOptionalString(body.model, "model", 1, 128);
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error("Base URL must start with http:// or https://.");
  }

  return {
    provider,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    model
  };
}

function readProvider(value: unknown): LlmProviderAlias {
  if (typeof value !== "string" || !allowedProviders.has(value as LlmProviderAlias)) {
    throw new Error("Unsupported provider.");
  }

  return value as LlmProviderAlias;
}

function readString(value: unknown, fieldName: string, min: number, max: number) {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max} characters.`);
  }

  return trimmed;
}

function readOptionalString(value: unknown, fieldName: string, min: number, max: number) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = readString(value, fieldName, 0, max);
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length < min) {
    throw new Error(`${fieldName} must be between ${min} and ${max} characters.`);
  }

  return trimmed;
}
