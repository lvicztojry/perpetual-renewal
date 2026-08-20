import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { testLlmConnection, type LlmConnectionTestInput } from "@/lib/llm/connection-test";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  let body: LlmConnectionTestInput;

  try {
    body = (await request.json()) as LlmConnectionTestInput;
  } catch {
    return NextResponse.json({ error: "Expected a valid JSON body." }, { status: 400 });
  }

  const result = await testLlmConnection(session.userId, body);
  return NextResponse.json(result);
}
