import type {
  VoiceProvider,
  VoiceProviderName,
  VoiceRuntimeMetadata,
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

  constructor(
    private readonly fallbackReason?: string,
    private readonly metadata: VoiceRuntimeMetadata = {}
  ) {}

  async transcribe(options: VoiceTranscriptionOptions): Promise<VoiceTranscription> {
    // 只有调用方显式给了 mockTranscript（本地联调/测试）才返回文字；
    // 否则音频并没有被真正识别，必须标记为占位，让 API 层按失败处理。
    const mockText = options.mockTranscript?.trim();

    return {
      text: mockText ?? "",
      provider: this.name,
      model: "mock-voice-local",
      language: options.language ?? "zh-CN",
      fallbackReason: this.fallbackReason,
      // true 表示"这段文字不是从音频里识别出来的"。
      placeholder: !mockText,
      ...this.metadata
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
      // 0 秒静音占位：调用方必须当成"没有语音"处理，不能当作可播放的语音回复。
      placeholder: true,
      ...this.metadata,
      raw: {
        textPreview: text.slice(0, 80),
        format: options.format ?? "wav",
        speed: options.speed ?? 1
      }
    };
  }
}
