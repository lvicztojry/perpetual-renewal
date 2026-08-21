import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { testLlmConnection, type LlmConnectionTestInput } from "@/lib/llm/connection-test";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  let body: LlmConnectionTestInput;

  try {
    body = (await readJsonObject(request)) as LlmConnectionTestInput;
  } catch (error) {
    return NextResponse.json(
      { error: jsonErrorMessage(error, "Failed to test LLM connection.") },
      { status: 400 }
    );
  }

  const result = await testLlmConnection(session.userId, body);
  return NextResponse.json(result);
}
