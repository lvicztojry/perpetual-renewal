import type {
  VoiceProvider,
  VoiceProviderName,
  VoiceSynthesis,
  VoiceSynthesisOptions,
  VoiceTranscription,
  VoiceTranscriptionOptions
} from "./types";
import { VoiceProviderError } from "./types";

const SILENT_WAV_BASE64 =
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class MockVoiceProvider implements VoiceProvider {
  readonly name: VoiceProviderName = "mock";

  constructor(private readonly fallbackReason?: string) {}

  async transcribe(options: VoiceTranscriptionOptions): Promise<VoiceTranscription> {
    const text =
      options.mockTranscript?.trim() ||
      readMockTranscriptFromAudio(options.audioBase64) ||
      "我刚用语音说：今天也很想你。";

    return {
      text,
      provider: this.name,
      model: "mock-voice-local",
      language: options.language ?? "zh-CN",
      fallbackReason: this.fallbackReason
    };
  }

  async synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesis> {
    const text = options.text.trim();

    if (!text) {
      throw new VoiceProviderError("Text is required for voice synthesis.", {
        kind: "configuration",
        provider: this.name,
        model: "mock-voice-local",
        retryable: false
      });
    }

    return {
      audioBase64: SILENT_WAV_BASE64,
      mimeType: "audio/wav",
      provider: this.name,
      model: "mock-voice-local",
      voice: options.voice?.trim() || "mock-warm",
      fallbackReason: this.fallbackReason,
      raw: {
        textPreview: text.slice(0, 80),
        format: options.format ?? "wav",
        speed: options.speed ?? 1
      }
    };
  }
}

function readMockTranscriptFromAudio(audioBase64: string | undefined) {
  if (!audioBase64) return "";

  return "我刚发来一段语音，想让你听见我的想念。";
}
