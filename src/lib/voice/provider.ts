import { CompatibleVoiceProvider } from "./compatible-provider";
import { MockVoiceProvider } from "./mock-provider";
import {
  VoiceProviderError,
  type VoiceCredentialSource,
  type VoiceProvider,
  type VoiceProviderConfig,
  type VoiceProviderName,
  type VoiceSynthesis,
  type VoiceSynthesisOptions,
  type VoiceTranscription,
  type VoiceTranscriptionOptions
} from "./types";

export function createVoiceProvider(config: Partial<VoiceProviderConfig> = {}): VoiceProvider {
  const requestedProvider = config.provider ?? readProviderName(process.env.VOICE_PROVIDER);
  const credentialSource = config.credentialSource ?? readCredentialSource();

  if (requestedProvider === "mock") {
    return new MockVoiceProvider(readMockFallbackReason(process.env.VOICE_PROVIDER));
  }

  const apiKey = config.apiKey ?? readSharedApiKey(requestedProvider);
  const baseUrl = config.baseUrl ?? readSharedBaseUrl(requestedProvider);
  const sttModel = config.sttModel ?? readVoiceModel(process.env.VOICE_STT_MODEL, process.env.LLM_MODEL);
  const ttsModel = config.ttsModel ?? readVoiceModel(process.env.VOICE_TTS_MODEL, process.env.LLM_MODEL);
  const missingConfig = readMissingConfig({
    apiKey,
    baseUrl,
    sttModel,
    ttsModel
  });

  if (missingConfig.length > 0) {
    return new MockVoiceProvider(
      `${requestedProvider} voice provider missing ${missingConfig.join(", ")}; using mock provider.`
    );
  }

  const configuredApiKey = apiKey;
  const configuredBaseUrl = baseUrl;
  const configuredSttModel = sttModel;
  const configuredTtsModel = ttsModel;

  if (!configuredApiKey || !configuredBaseUrl || !configuredSttModel || !configuredTtsModel) {
    return new MockVoiceProvider(`${requestedProvider} voice provider missing required config; using mock provider.`);
  }

  return new FallbackVoiceProvider(
    new CompatibleVoiceProvider({
      provider: requestedProvider,
      apiKey: configuredApiKey,
      baseUrl: configuredBaseUrl,
      sttModel: configuredSttModel,
      ttsModel: configuredTtsModel,
      defaultVoice: config.defaultVoice ?? process.env.VOICE_DEFAULT_VOICE
    }),
    credentialSource
  );
}

class FallbackVoiceProvider implements VoiceProvider {
  readonly name: VoiceProviderName;

  constructor(
    private readonly primary: VoiceProvider,
    private readonly credentialSource: VoiceCredentialSource
  ) {
    this.name = primary.name;
  }

  async transcribe(options: VoiceTranscriptionOptions): Promise<VoiceTranscription> {
    try {
      return await this.primary.transcribe(options);
    } catch (error) {
      return new MockVoiceProvider(this.readFallbackReason(error)).transcribe(options);
    }
  }

  async synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesis> {
    try {
      return await this.primary.synthesize(options);
    } catch (error) {
      return new MockVoiceProvider(this.readFallbackReason(error)).synthesize(options);
    }
  }

  private readFallbackReason(error: unknown) {
    if (error instanceof VoiceProviderError) {
      return `${error.details.provider} voice provider ${readFailureLabel(error)}; using mock provider.`;
    }

    return `${this.primary.name} voice provider failed for ${this.credentialSource}; using mock provider.`;
  }
}

function readProviderName(value: string | undefined): VoiceProviderName {
  if (value === "compatible" || value === "shared-llm" || value === "mock") {
    return value;
  }

  return "mock";
}

function readCredentialSource(): VoiceCredentialSource {
  return process.env.VOICE_CREDENTIAL_SOURCE === "user-vault" ? "user-vault" : "server-env";
}

function readMissingConfig(values: {
  apiKey?: string;
  baseUrl?: string;
  sttModel?: string;
  ttsModel?: string;
}) {
  const missing: string[] = [];

  if (!values.apiKey) missing.push("LLM_API_KEY");
  if (!values.baseUrl) missing.push("LLM_BASE_URL");
  if (!values.sttModel) missing.push("VOICE_STT_MODEL or LLM_MODEL");
  if (!values.ttsModel) missing.push("VOICE_TTS_MODEL or LLM_MODEL");

  return missing;
}

function readSharedApiKey(provider: VoiceProviderName) {
  if (provider === "compatible" && process.env.VOICE_API_KEY?.trim()) {
    return process.env.VOICE_API_KEY.trim();
  }

  return process.env.LLM_API_KEY?.trim();
}

function readSharedBaseUrl(provider: VoiceProviderName) {
  if (provider === "compatible" && process.env.VOICE_BASE_URL?.trim()) {
    return process.env.VOICE_BASE_URL.trim();
  }

  return process.env.LLM_BASE_URL?.trim();
}

function readVoiceModel(primary: string | undefined, fallback: string | undefined) {
  return primary?.trim() || fallback?.trim();
}

function readMockFallbackReason(requestedProvider: string | undefined) {
  if (!requestedProvider) {
    return "VOICE_PROVIDER is unset; using mock voice provider.";
  }

  if (requestedProvider === "mock") {
    return "VOICE_PROVIDER=mock; using mock voice provider.";
  }

  return `Unsupported VOICE_PROVIDER=${requestedProvider}; using mock voice provider.`;
}

function readFailureLabel(error: VoiceProviderError) {
  if (error.details.kind === "authentication") {
    return "authentication failed";
  }

  if (error.details.kind === "rate_limit") {
    return "hit a rate limit";
  }

  if (error.details.kind === "timeout") {
    return "timed out";
  }

  if (error.details.kind === "network") {
    return "network request failed";
  }

  if (error.details.kind === "unsupported_media") {
    return "could not read the audio input";
  }

  if (error.details.kind === "configuration") {
    return "configuration was incomplete";
  }

  return "returned an invalid response";
}
