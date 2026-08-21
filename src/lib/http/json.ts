export class JsonRequestError extends Error {
  constructor(message = "Invalid JSON body.") {
    super(message);
    this.name = "JsonRequestError";
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new JsonRequestError("Invalid JSON body.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new JsonRequestError("JSON object body is required.");
  }

  return body as Record<string, unknown>;
}

export function jsonErrorMessage(error: unknown, fallback: string) {
  return error instanceof JsonRequestError
    ? error.message
    : error instanceof Error
      ? error.message
      : fallback;
}
