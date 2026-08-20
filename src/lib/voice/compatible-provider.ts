import {
  classifyVoiceProviderStatus,
  VoiceProviderError,
  type VoiceProvider,
  type VoiceProviderName,
  type VoiceSynthesis,
  type VoiceSynthesisFormat,
  type VoiceSynthesisOptions,
  type VoiceTranscription,
  type VoiceTranscriptionOptions
} from "./types";

type CompatibleVoiceProviderConfig = {
  provider: Extract<VoiceProviderName, "shared-llm" | "compatible">;
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  defaultVoice?: string;
};

type TranscriptionResponse = {
  text?: unknown;
  language?: unknown;
  duration?: unknown;
};

export class CompatibleVoiceProvider implements VoiceProvider {
  readonly name: Extract<VoiceProviderName, "shared-llm" | "compatible">;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly sttModel: string;
  private readonly ttsModel: string;
  private readonly defaultVoice: string;

  constructor(config: CompatibleVoiceProviderConfig) {
    this.name = config.provider;
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.sttModel = config.sttModel.trim();
    this.ttsModel = config.ttsModel.trim();
    this.defaultVoice = config.defaultVoice?.trim() || "warm";
  }

  async transcribe(options: VoiceTranscriptionOptions): Promise<VoiceTranscription> {
    const model = this.sttModel;
    const audioBase64 = stripDataUrlPrefix(options.audioBase64);

    if (!audioBase64) {
      throw new VoiceProviderError("Audio is required for voice transcription.", {
        kind: "configuration",
        provider: this.name,
        model,
        retryable: false
      });
    }

    const formData = new FormData();
    const bytes = decodeBase64Audio(audioBase64, this.name, model);
    const mimeType = options.mimeType?.trim() || "audio/webm";
    const fileName = options.fileName?.trim() || `voice.${extensionFromMimeType(mimeType)}`;

    formData.append("file", new Blob([bytes], { type: mimeType }), fileName);
    formData.append("model", model);

    if (options.language?.trim()) {
      formData.append("language", options.language.trim());
    }

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        body: formData,
        signal: options.signal
      });
    } catch (error) {
      throw toVoiceNetworkError(error, this.name, model);
    }

    if (!response.ok) {
      throw toVoiceHttpError(response.status, this.name, model);
    }

    const payload = (await response.json().catch(() => ({}))) as TranscriptionResponse;
    const text = typeof payload.text === "string" ? payload.text.trim() : "";

    if (!text) {
      throw new VoiceProviderError("Voice provider returned an empty transcription.", {
        kind: "provider_response",
        provider: this.name,
        model,
        retryable: false
      });
    }

    return {
      text,
      provider: this.name,
      model,
      language: typeof payload.language === "string" ? payload.language : options.language,
      durationMs: typeof payload.duration === "number" ? Math.round(payload.duration * 1000) : undefined,
      raw: {
        responseType: "audio.transcription"
      }
    };
  }

  async synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesis> {
    const model = this.ttsModel;
    const text = options.text.trim();
    const format = options.format ?? "mp3";
    const voice = options.voice?.trim() || this.defaultVoice;

    if (!text) {
      throw new VoiceProviderError("Text is required for voice synthesis.", {
        kind: "configuration",
        provider: this.name,
        model,
        retryable: false
      });
    }

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: toProviderSpeechFormat(format),
          speed: options.speed ?? 1
        }),
        signal: options.signal
      });
    } catch (error) {
      throw toVoiceNetworkError(error, this.name, model);
    }

    if (!response.ok) {
      throw toVoiceHttpError(response.status, this.name, model);
    }

    const audio = await response.arrayBuffer();

    if (audio.byteLength === 0) {
      throw new VoiceProviderError("Voice provider returned empty audio.", {
        kind: "provider_response",
        provider: this.name,
        model,
        retryable: false
      });
    }

    return {
      audioBase64: Buffer.from(audio).toString("base64"),
      mimeType: response.headers.get("content-type")?.split(";")[0] || mimeTypeForFormat(format),
      provider: this.name,
      model,
      voice,
      raw: {
        responseType: "audio.speech",
        format,
        bytes: audio.byteLength
      }
    };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function stripDataUrlPrefix(value: string | undefined) {
  if (!value) return "";

  const marker = "base64,";
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(markerIndex + marker.length).trim() : value.trim();
}

function decodeBase64Audio(value: string, provider: VoiceProviderName, model: string) {
  try {
    const compact = value.replace(/\s+/g, "");
    const bytes = Buffer.from(compact, "base64");

    if (bytes.byteLength === 0 || Buffer.from(bytes).toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) {
      throw new Error("Invalid base64 audio.");
    }

    return new Uint8Array(bytes);
  } catch (error) {
    throw new VoiceProviderError("Audio must be valid base64.", {
      kind: "unsupported_media",
      provider,
      model,
      retryable: false,
      cause: error
    });
  }
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  return "audio";
}

function toProviderSpeechFormat(format: VoiceSynthesisFormat) {
  return format === "ogg" ? "opus" : format;
}

function mimeTypeForFormat(format: VoiceSynthesisFormat) {
  if (format === "wav") return "audio/wav";
  if (format === "ogg") return "audio/ogg";
  return "audio/mpeg";
}

function toVoiceHttpError(status: number, provider: VoiceProviderName, model: string) {
  const classification = classifyVoiceProviderStatus(status);

  return new VoiceProviderError("Voice provider request failed.", {
    ...classification,
    provider,
    model,
    status
  });
}

function toVoiceNetworkError(error: unknown, provider: VoiceProviderName, model: string) {
  const isAbort =
    error instanceof DOMException
      ? error.name === "AbortError" || error.name === "TimeoutError"
      : error instanceof Error && /abort|timeout/i.test(error.name);

  return new VoiceProviderError(
    isAbort ? "Voice provider request timed out." : "Voice provider network request failed.",
    {
      kind: isAbort ? "timeout" : "network",
      provider,
      model,
      retryable: true,
      cause: error
    }
  );
}
