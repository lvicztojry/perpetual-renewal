import { readDecryptedLlmCredential } from "@/lib/credentials";

export type LlmModelListItem = {
  id: string;
  ownedBy?: string;
};

export type LlmModelListResult = {
  provider: string;
  credentialSource: "user-vault" | "server-env";
  models: LlmModelListItem[];
};

export type LlmModelListParseResult =
  | {
      ok: true;
      models: LlmModelListItem[];
    }
  | {
      ok: false;
      diagnostic: string;
    };

export class LlmModelListError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing_api_key"
      | "unsupported_provider"
      | "provider_http_error"
      | "provider_network_error"
      | "provider_timeout"
      | "invalid_provider_response",
    readonly options: {
      httpStatus?: number;
      retryable: boolean;
      diagnostic?: string;
    }
  ) {
    super(message);
    this.name = "LlmModelListError";
  }
}

const defaultCompatibleBaseUrl = "https://api.tryanotherone.com/v1";

export async function listAvailableLlmModels(userId: string): Promise<LlmModelListResult> {
  const credential = await readDecryptedLlmCredential(userId);
  const provider = credential?.provider ?? process.env.LLM_PROVIDER ?? "compatible";
  const normalizedProvider = provider === "openai-compatible" ? "compatible" : provider;

  if (normalizedProvider !== "compatible") {
    throw new LlmModelListError(
      "Model listing currently supports compatible providers only.",
      "unsupported_provider",
      { retryable: false }
    );
  }

  const apiKey =
    credential?.apiKey || process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const baseUrl = credential?.baseUrl || process.env.LLM_BASE_URL?.trim() || defaultCompatibleBaseUrl;

  if (!apiKey) {
    throw new LlmModelListError(
      "Model listing requires a saved user API key or server LLM_API_KEY.",
      "missing_api_key",
      { retryable: false }
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(12_000)
    });
  } catch (error) {
    const isTimeout =
      error instanceof DOMException
        ? error.name === "AbortError" || error.name === "TimeoutError"
        : error instanceof Error && /abort|timeout/i.test(error.name);
    throw new LlmModelListError(
      isTimeout ? "Model listing timed out." : "Model listing network request failed.",
      isTimeout ? "provider_timeout" : "provider_network_error",
      { retryable: true }
    );
  }

  if (!response.ok) {
    throw new LlmModelListError(
      `Model listing failed with HTTP ${response.status}.`,
      "provider_http_error",
      {
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500
      }
    );
  }

  const payload = await response.json().catch(() => undefined);
  if (payload === undefined) {
    throw new LlmModelListError(
      "Model listing returned non-JSON content.",
      "invalid_provider_response",
      {
        retryable: false,
        diagnostic: "Provider /models response was not valid JSON."
      }
    );
  }

  const parsed = parseOpenAiCompatibleModelList(payload);
  if (!parsed.ok) {
    throw new LlmModelListError(
      "Model listing returned an unsupported response shape.",
      "invalid_provider_response",
      { retryable: false, diagnostic: parsed.diagnostic }
    );
  }

  return {
    provider: "compatible",
    credentialSource: credential ? "user-vault" : "server-env",
    models: parsed.models
  };
}

export function parseOpenAiCompatibleModelList(payload: unknown): LlmModelListParseResult {
  const candidates = readModelArrayCandidates(payload);
  let sawEmptyArray = false;
  let sawNonEmptyArray = false;

  for (const candidate of candidates) {
    if (!Array.isArray(candidate.value)) continue;

    if (candidate.value.length === 0) {
      sawEmptyArray = true;
      continue;
    }

    sawNonEmptyArray = true;
    const models = dedupeModels(candidate.value.map(toModelListItem).filter(isUsableModel));
    if (models.length > 0) return { ok: true, models };
  }

  if (sawEmptyArray && !sawNonEmptyArray) {
    return { ok: true, models: [] };
  }

  if (!sawEmptyArray && !sawNonEmptyArray) {
    return {
      ok: false,
      diagnostic:
        "Provider /models JSON did not include a top-level data, models, value, or result array."
    };
  }

  return {
    ok: false,
    diagnostic:
      "Provider /models array did not include usable string ids or id/model/name/value fields."
  };
}

function readModelArrayCandidates(payload: unknown) {
  const root = asRecord(payload);
  const data = root ? asRecord(root.data) : null;
  const result = root ? asRecord(root.result) : null;

  return [
    { value: payload },
    { value: root?.data },
    { value: root?.models },
    { value: root?.value },
    { value: root?.result },
    { value: data?.models },
    { value: data?.data },
    { value: result?.models },
    { value: result?.data }
  ];
}

function toModelListItem(item: unknown): LlmModelListItem {
  if (typeof item === "string") {
    return { id: item.trim() };
  }

  const record = asRecord(item);
  if (!record) return { id: "" };

  return {
    id:
      readTrimmedString(record.id) ??
      readTrimmedString(record.model) ??
      readTrimmedString(record.name) ??
      readTrimmedString(record.value) ??
      "",
    ownedBy:
      readTrimmedString(record.owned_by) ??
      readTrimmedString(record.ownedBy) ??
      readTrimmedString(record.owner) ??
      readTrimmedString(record.provider)
  };
}

function isUsableModel(item: LlmModelListItem) {
  return Boolean(item.id);
}

function dedupeModels(models: LlmModelListItem[]) {
  const seen = new Set<string>();
  const deduped: LlmModelListItem[] = [];

  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    deduped.push(model);
  }

  return deduped;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
