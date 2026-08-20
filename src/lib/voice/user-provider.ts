import { readDecryptedLlmCredential } from "@/lib/credentials";
import { createVoiceProvider } from "./provider";

export async function createUserVoiceProvider(userId: string) {
  const credential = await readDecryptedLlmCredential(userId);

  if (
    credential &&
    (credential.provider === "compatible" || credential.provider === "openai-compatible")
  ) {
    return createVoiceProvider({
      provider: "shared-llm",
      credentialSource: "user-vault",
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      sttModel: process.env.VOICE_STT_MODEL?.trim() || credential.model,
      ttsModel: process.env.VOICE_TTS_MODEL?.trim() || credential.model
    });
  }

  return createVoiceProvider();
}
