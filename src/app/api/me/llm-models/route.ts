import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { LlmModelListError, listAvailableLlmModels } from "@/lib/llm/model-list";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();

  try {
    const result = await listAvailableLlmModels(session.userId);
    return privateJson({
      provider: result.provider,
      credentialSource: result.credentialSource,
      models: result.models
    });
  } catch (error) {
    return privateJson(
      {
        error: toModelListError(error),
        ...toModelListErrorMetadata(error)
      },
      { status: 400 }
    );
  }
}

function toModelListError(error: unknown) {
  if (error instanceof LlmModelListError) {
    if (error.code === "missing_api_key") {
      return "读取模型列表需要先保存 API key，或配置服务端 LLM_API_KEY。";
    }

    if (error.code === "unsupported_provider") {
      return "当前自动读取模型列表仅支持兼容中转站；其他供应商可手动填写模型名。";
    }

    if (error.code === "provider_http_error") {
      return error.options.httpStatus === 401 || error.options.httpStatus === 403
        ? "模型供应商拒绝了这次请求，请检查 API key 权限或额度。"
        : "模型供应商返回了异常状态，请检查模型供应商配置或稍后再试。";
    }

    if (error.code === "provider_timeout") {
      return "读取模型列表超时，请稍后再试。";
    }

    if (error.code === "provider_network_error") {
      return "无法连接到模型供应商，请检查网络或供应商地址。";
    }

    if (error.code === "invalid_provider_response") {
      return "模型供应商返回格式不兼容，请手动填写模型名后测试连接。";
    }
  }

  const message = error instanceof Error ? error.message : "";
  if (/API key/i.test(message)) {
    return "读取模型列表需要先保存 API key，或配置服务端 LLM_API_KEY。";
  }

  if (/compatible providers/i.test(message)) {
    return "当前自动读取模型列表仅支持兼容中转站；其他供应商可手动填写模型名。";
  }

  return "读取模型列表失败，请检查模型供应商配置或稍后再试。";
}

function toModelListErrorMetadata(error: unknown) {
  if (!(error instanceof LlmModelListError)) {
    return {};
  }

  return {
    errorType: error.code,
    httpStatus: error.options.httpStatus,
    retryable: error.options.retryable
  };
}
