import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import {
  deleteLlmCredential,
  getLlmCredentialStatus,
  saveLlmCredential
} from "@/lib/credentials";
import { JsonRequestError, jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
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
  try {
    const session = await getCurrentSession();
    const credential = await getLlmCredentialStatus(session.userId);
    return privateJson({ credential });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "credentials");
    if (persistenceError) return persistenceError;

    throw error;
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    const body = (await readJsonObject(request)) as CredentialRequest;
    const credential = await saveLlmCredential(session.userId, parseCredentialRequest(body));
    return privateJson({ credential });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "credentials");
    if (persistenceError) return persistenceError;

    if (error instanceof JsonRequestError) {
      return privateJson(
        { error: jsonErrorMessage(error, "Failed to save credential.") },
        { status: 400 }
      );
    }

    return privateJson({ error: safeCredentialErrorMessage(error) }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    const session = await getCurrentSession();
    const credential = await deleteLlmCredential(session.userId);
    return privateJson({ credential });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "credentials");
    if (persistenceError) return persistenceError;

    throw error;
  }
}

function parseCredentialRequest(body: CredentialRequest) {
  const provider = readProvider(body.provider);
  const apiKey = readOptionalString(body.apiKey, "apiKey", 8, 4096);
  const model = readOptionalString(body.model, "model", 1, 128);
  const baseUrl = readOptionalString(body.baseUrl, "baseUrl", 1, 512);

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new CredentialValidationError("Base URL must start with http:// or https://.");
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
    throw new CredentialValidationError("Unsupported provider.");
  }

  return value as LlmProviderAlias;
}

function readString(value: unknown, fieldName: string, min: number, max: number) {
  if (typeof value !== "string") {
    throw new CredentialValidationError(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new CredentialValidationError(`${fieldName} must be between ${min} and ${max} characters.`);
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
    throw new CredentialValidationError(`${fieldName} must be between ${min} and ${max} characters.`);
  }

  return trimmed;
}

function safeCredentialErrorMessage(error: unknown) {
  if (error instanceof CredentialValidationError) {
    switch (error.message) {
      case "Base URL must start with http:// or https://.":
        return "Base URL must start with http:// or https://.";
      case "Unsupported provider.":
        return "Unsupported provider.";
      case "apiKey must be a string.":
        return "apiKey must be a string.";
      case "apiKey must be between 8 and 4096 characters.":
        return "apiKey must be between 8 and 4096 characters.";
      case "model must be a string.":
        return "model must be a string.";
      case "model must be between 1 and 128 characters.":
        return "model must be between 1 and 128 characters.";
      case "baseUrl must be a string.":
        return "baseUrl must be a string.";
      case "baseUrl must be between 1 and 512 characters.":
        return "baseUrl must be between 1 and 512 characters.";
      default:
        return "Failed to save credential.";
    }
  }

  const message = error instanceof Error ? error.message : "";
  if (
    message === "apiKey is required when no saved credential exists." ||
    message === "compatible provider requires Base URL."
  ) {
    return message;
  }

  return "Failed to save credential.";
}

class CredentialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialValidationError";
  }
}
