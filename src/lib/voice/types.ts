export type VoiceProviderName = "mock" | "shared-llm" | "compatible";

export type VoiceCredentialSource = "server-env" | "user-vault";

export type VoiceProviderConfig = {
  provider: VoiceProviderName;
  credentialSource: VoiceCredentialSource;
  apiKey?: string;
  baseUrl?: string;
  sttModel?: string;
  ttsModel?: string;
  defaultVoice?: string;
};

export type VoiceTranscriptionOptions = {
  audioBase64?: string;
  mimeType?: string;
  fileName?: string;
  language?: string;
  mockTranscript?: string;
  signal?: AbortSignal;
};

export type VoiceTranscription = {
  text: string;
  provider: VoiceProviderName;
  model: string;
  language?: string;
  durationMs?: number;
  fallbackReason?: string;
  raw?: unknown;
};

export type VoiceSynthesisFormat = "mp3" | "wav" | "ogg";

export type VoiceSynthesisOptions = {
  text: string;
  voice?: string;
  format?: VoiceSynthesisFormat;
  speed?: number;
  signal?: AbortSignal;
};

export type VoiceSynthesis = {
  audioBase64: string;
  mimeType: string;
  provider: VoiceProviderName;
  model: string;
  voice: string;
  fallbackReason?: string;
  raw?: unknown;
};

export interface VoiceProvider {
  readonly name: VoiceProviderName;
  transcribe(options: VoiceTranscriptionOptions): Promise<VoiceTranscription>;
  synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesis>;
}

export type VoiceProviderErrorKind =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "provider_response"
  | "unsupported_media";

export class VoiceProviderError extends Error {
  constructor(
    message: string,
    readonly details: {
      kind: VoiceProviderErrorKind;
      provider: VoiceProviderName | string;
      model?: string;
      status?: number;
      retryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}

export function classifyVoiceProviderStatus(status: number): {
  kind: VoiceProviderErrorKind;
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return { kind: "authentication", retryable: false };
  }

  if (status === 408) {
    return { kind: "timeout", retryable: true };
  }

  if (status === 413 || status === 415) {
    return { kind: "unsupported_media", retryable: false };
  }

  if (status === 429) {
    return { kind: "rate_limit", retryable: true };
  }

  if (status >= 500) {
    return { kind: "provider_response", retryable: true };
  }

  return { kind: "provider_response", retryable: false };
}
