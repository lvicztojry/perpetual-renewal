import { readDecryptedLlmCredential } from "@/lib/credentials";
import { createVoiceProvider } from "./provider";

export async function createUserVoiceProvider(userId: string, options: { sttModel?: string } = {}) {
  const credential = await readDecryptedLlmCredential(userId);
  const requestedProvider = process.env.VOICE_PROVIDER?.trim();

  if (
    credential &&
    (credential.provider === "compatible" || credential.provider === "openai-compatible")
  ) {
    return createVoiceProvider({
      // edge 只负责合成；用户的 vault 凭据用于转写，不能被覆盖成 shared-llm 合成。
      provider: requestedProvider === "edge" ? "edge" : "shared-llm",
      credentialSource: "user-vault",
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      sttModel: options.sttModel?.trim() || process.env.VOICE_STT_MODEL?.trim() || credential.model,
      ttsModel: process.env.VOICE_TTS_MODEL?.trim() || credential.model
    });
  }

  return createVoiceProvider(options.sttModel ? { sttModel: options.sttModel.trim() } : {});
}
