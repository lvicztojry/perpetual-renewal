export class JsonRequestError extends Error {
  constructor(message = "Invalid JSON body.") {
    super(message);
    this.name = "JsonRequestError";
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonBody(request);

  return requireJsonObject(body);
}

export async function readOptionalJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  const body = parseJson(text);
  return requireJsonObject(body);
}

async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new JsonRequestError("Invalid JSON body.");
  }
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JsonRequestError("Invalid JSON body.");
  }
}

function requireJsonObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new JsonRequestError("JSON object body is required.");
  }

  return body as Record<string, unknown>;
}

export function jsonErrorMessage(error: unknown, fallback: string) {
  return error instanceof JsonRequestError ? error.message : fallback;
}
