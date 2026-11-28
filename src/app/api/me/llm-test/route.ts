import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
import { testLlmConnection, type LlmConnectionTestInput } from "@/lib/llm/connection-test";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: LlmConnectionTestInput;

  try {
    body = (await readJsonObject(request)) as LlmConnectionTestInput;
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to test LLM connection.") },
      { status: 400 }
    );
  }

  try {
    const session = await getCurrentSession();
    const result = await testLlmConnection(session.userId, body);
    return privateJson(result);
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "credentials");
    if (persistenceError) return persistenceError;

    throw error;
  }
}
