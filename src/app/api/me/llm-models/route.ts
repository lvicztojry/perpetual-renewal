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
        error: toModelListError(error)
      },
      { status: 400 }
    );
  }
}

function toModelListError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/API key/i.test(message)) {
    return "读取模型列表需要先保存 API key，或配置服务端 LLM_API_KEY。";
  }

  if (/compatible providers/i.test(message)) {
    return "当前自动读取模型列表仅支持兼容中转站；其他供应商可手动填写模型名。";
  }

  return "读取模型列表失败，请检查模型供应商配置或稍后再试。";
}
