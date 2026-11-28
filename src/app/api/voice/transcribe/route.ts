import { privateJson } from "@/lib/http/private-response";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { createUserVoiceProvider } from "@/lib/voice/user-provider";
import {
  VoiceProviderError,
  type VoiceTranscription,
  type VoiceTranscriptionOptions
} from "@/lib/voice/types";

export const runtime = "nodejs";

const maxVoiceInputBytes = 4 * 1024 * 1024;
const maxVoiceFileNameChars = 120;
const maxVoiceLanguageChars = 35;
const maxMockTranscriptChars = 4_000;
const unsafeVoiceFileNamePattern = /[<>:"/\\|?*\u0000-\u001F]/;
const voiceLanguagePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
type TranscriptionInput = VoiceTranscriptionOptions & { sttModel?: string };

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await readJsonObject(request);
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to transcribe voice.") },
      { status: 400 }
    );
  }

  if (!isTranscriptionInput(body)) {
    return privateJson({ error: "Missing voice transcription input." }, { status: 400 });
  }

  const validationError = validateTranscriptionInput(body);
  if (validationError) {
    return privateJson({ error: validationError.error }, { status: validationError.status });
  }

  try {
    const session = await getCurrentSession();
    const provider = await createUserVoiceProvider(session.userId, { sttModel: body.sttModel?.trim() });
    const result = await provider.transcribe(body);

    // mock/回退路径并没有真正识别音频。以前它返回一句固定的想念文案，
    // 前端会把这句话当成"你刚说的话"塞进输入框，看起来就是"录了音但不识别"。
    if (result.placeholder || result.provider === "mock" || result.fallback || !result.text.trim()) {
      return privateJson(toTranscriptionUnavailableResponse(result), { status: 502 });
    }

    return privateJson(toSafeTranscriptionResponse(result));
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "credentials");
    if (persistenceError) return persistenceError;

    if (error instanceof VoiceProviderError) {
      return privateJson(
        toTranscriptionUnavailableResponse({
          text: "", provider: "shared-llm", model: error.details.model ?? "",
          fallbackKind: error.details.kind, status: error.details.status,
          retryable: error.details.retryable
        }),
        { status: 502 }
      );
    }

    return privateJson({ error: "Failed to transcribe voice." }, { status: 500 });
  }
}

function toSafeTranscriptionResponse(result: VoiceTranscription) {
  return {
    text: result.text,
    provider: result.provider,
    requestedProvider: result.requestedProvider,
    credentialSource: result.credentialSource,
    model: result.model,
    language: result.language,
    durationMs: result.durationMs,
    fallback: result.fallback,
    fallbackKind: result.fallbackKind,
    fallbackReason: redactSensitiveResponseText(result.fallbackReason),
    missingConfig: result.missingConfig,
    retryable: result.retryable,
    status: result.status
  };
}

// 与 docs/ERROR_COPY.md「语音转文字失败」保持一致。
const transcriptionUnavailableCopy = "这段语音没有识别出来，可以再录一次，或改用文字。";

function toTranscriptionUnavailableResponse(result: VoiceTranscription) {
  const unsupported = [400, 404, 405, 422, 501].includes(result.status ?? 0);
  const missingConfig = result.fallbackKind === "missing_config" || result.fallbackKind === "mock_provider" || result.fallbackKind === "configuration";
  const error = missingConfig
    ? "语音转写尚未配置。请在设置中保存兼容中转站地址和 Key，并填写支持语音转写的模型。"
    : unsupported
      ? "当前中转站或所选模型不支持语音转写。请检查语音转写模型名称，并确认中转站开放了 /audio/transcriptions 端点。"
      : result.fallbackKind === "authentication"
        ? "语音转写鉴权失败，请在设置中检查中转站 Key 和模型权限。"
        : result.fallbackKind === "rate_limit"
          ? "语音转写已限流，请稍后重试，或检查 Key 配额。"
          : result.fallbackKind === "timeout" || result.fallbackKind === "network"
            ? "语音转写连接失败或超时，请检查网络和中转站地址后重试。"
            : transcriptionUnavailableCopy;
  return {
    error,
    errorType: "voice_transcription_unavailable",
    retryable: unsupported || missingConfig ? false : result.retryable ?? true,
    provider: result.provider,
    requestedProvider: result.requestedProvider,
    credentialSource: result.credentialSource,
    model: result.model,
    language: result.language,
    fallback: result.fallback ?? result.provider === "mock",
    fallbackKind: result.fallbackKind ?? "mock_provider",
    fallbackReason: redactSensitiveResponseText(result.fallbackReason),
    missingConfig: result.missingConfig,
    status: result.status
  };
}

function isTranscriptionInput(value: unknown): value is TranscriptionInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TranscriptionInput>;
  const hasAudio = typeof candidate.audioBase64 === "string" && candidate.audioBase64.trim().length > 0;
  const hasMockTranscript =
    typeof candidate.mockTranscript === "string" && candidate.mockTranscript.trim().length > 0;

  return (
    (hasAudio || hasMockTranscript) &&
    (
      candidate.audioBase64 === undefined ||
      typeof candidate.audioBase64 === "string"
    )
  ) && (
    candidate.mimeType === undefined ||
    typeof candidate.mimeType === "string"
  ) && (
    candidate.fileName === undefined ||
    typeof candidate.fileName === "string"
  ) && (
    candidate.language === undefined ||
    typeof candidate.language === "string"
  ) && (
    candidate.mockTranscript === undefined ||
    typeof candidate.mockTranscript === "string"
  );
}

function validateTranscriptionInput(input: TranscriptionInput): { error: string; status: number } | null {
  if (input.sttModel !== undefined && (typeof input.sttModel !== "string" || !input.sttModel.trim() ||
      input.sttModel.trim().length > 120 || /[\u0000-\u001F\u007F-\u009F]/.test(input.sttModel))) {
    return { error: "语音转写模型须为 1–120 个字符，且不能包含控制字符。", status: 400 };
  }
  const audioBase64 = input.audioBase64?.trim();
  const fileName = input.fileName?.trim();
  if (fileName) {
    if (fileName.length > maxVoiceFileNameChars) {
      return { error: "Voice file name is too long.", status: 400 };
    }

    if (unsafeVoiceFileNamePattern.test(fileName)) {
      return { error: "Voice file name is invalid.", status: 400 };
    }
  }

  const language = input.language?.trim();
  if (language) {
    if (language.length > maxVoiceLanguageChars || !voiceLanguagePattern.test(language)) {
      return { error: "Voice language is invalid.", status: 400 };
    }
  }

  if (input.mockTranscript && input.mockTranscript.trim().length > maxMockTranscriptChars) {
    return { error: "Mock voice transcript is too long.", status: 400 };
  }

  if (!audioBase64) {
    return null;
  }

  if (input.mimeType && !input.mimeType.toLowerCase().startsWith("audio/")) {
    return { error: "Voice input must use an audio MIME type.", status: 400 };
  }

  const compact = stripDataUrlPrefix(audioBase64).replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    return { error: "Voice input must be valid base64 audio.", status: 400 };
  }

  const decodedBytes = Math.floor((compact.length * 3) / 4) - (compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0);
  if (decodedBytes > maxVoiceInputBytes) {
    return { error: "Voice input is too large.", status: 413 };
  }

  return null;
}

function stripDataUrlPrefix(value: string) {
  const marker = "base64,";
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(markerIndex + marker.length).trim() : value.trim();
}
