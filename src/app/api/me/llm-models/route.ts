import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listAvailableLlmModels } from "@/lib/llm/model-list";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();

  try {
    const result = await listAvailableLlmModels(session.userId);
    return NextResponse.json({
      provider: result.provider,
      credentialSource: result.credentialSource,
      models: result.models
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list models."
      },
      { status: 400 }
    );
  }
}
