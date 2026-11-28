import { privateJson } from "@/lib/http/private-response";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { createUserVoiceProvider } from "@/lib/voice/user-provider";
import {
  VoiceProviderError,
  type VoiceSynthesisFormat,
  type VoiceSynthesis,
  type VoiceSynthesisOptions
} from "@/lib/voice/types";

export const runtime = "nodejs";

const maxSynthesisTextChars = 4_000;
const maxVoiceNameChars = 80;
const minSpeechSpeed = 0.25;
const maxSpeechSpeed = 4;
// 与 docs/ERROR_COPY.md「语音回复生成失败」保持一致：文字回复保留，语音可重试。
const voiceUnavailableCopy = "语音暂时没有生成成功，文字回复还在。";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await readJsonObject(request);
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to synthesize voice.") },
      { status: 400 }
    );
  }

  if (!isSynthesisInput(body)) {
    return privateJson({ error: "Missing text for voice synthesis." }, { status: 400 });
  }

  const validationError = validateSynthesisInput(body);
  if (validationError) {
    return privateJson({ error: validationError }, { status: 400 });
  }

  try {
    const session = await getCurrentSession();
    const provider = await createUserVoiceProvider(session.userId);
    const result = await provider.synthesize(body);

    // mock/fallback 会返回 0 秒静音 wav。它不是可播放的语音回复，必须按失败处理，
    // 否则页面会显示"语音回复已生成"，播放器却是 0:00。
    if (isUnplayableSynthesis(result)) {
      return privateJson(toVoiceUnavailableResponse(result), { status: 502 });
    }

    return privateJson(toSafeSynthesisResponse(result));
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "credentials");
    if (persistenceError) return persistenceError;

    if (error instanceof VoiceProviderError) {
      return privateJson(
        {
          error: "Voice provider failed."
        },
        { status: 502 }
      );
    }

    return privateJson({ error: "Failed to synthesize voice." }, { status: 500 });
  }
}

function toSafeSynthesisResponse(result: VoiceSynthesis) {
  return {
    audioBase64: result.audioBase64,
    audioDataUrl: `data:${result.mimeType};base64,${result.audioBase64}`,
    mimeType: result.mimeType,
    provider: result.provider,
    requestedProvider: result.requestedProvider,
    credentialSource: result.credentialSource,
    model: result.model,
    voice: result.voice,
    fallback: result.fallback,
    fallbackKind: result.fallbackKind,
    fallbackReason: redactSensitiveResponseText(result.fallbackReason),
    missingConfig: result.missingConfig,
    retryable: result.retryable,
    status: result.status
  };
}

function toVoiceUnavailableResponse(result: VoiceSynthesis) {
  return {
    error: voiceUnavailableCopy,
    errorType: "voice_unavailable",
    retryable: true,
    provider: result.provider,
    requestedProvider: result.requestedProvider,
    credentialSource: result.credentialSource,
    model: result.model,
    fallback: result.fallback ?? result.provider === "mock",
    fallbackKind: result.fallbackKind ?? "mock_provider",
    fallbackReason: redactSensitiveResponseText(result.fallbackReason),
    missingConfig: result.missingConfig,
    status: result.status
  };
}

function isUnplayableSynthesis(result: VoiceSynthesis) {
  if (result.placeholder) return true;

  const bytes = decodeBase64Bytes(result.audioBase64);
  if (!bytes || bytes.byteLength === 0) return true;

  return hasEmptyWavPayload(bytes);
}

function decodeBase64Bytes(value: string) {
  try {
    return Buffer.from(value.replace(/\s+/g, ""), "base64");
  } catch {
    return null;
  }
}

function hasEmptyWavPayload(bytes: Buffer) {
  if (bytes.byteLength < 12) return false;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    return false;
  }

  // RIFF/WAVE 头不完整时同样是空/损坏音频。
  if (bytes.byteLength < 44) return true;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);

    if (chunkId === "data") {
      return chunkSize === 0 || bytes.byteLength - (offset + 8) === 0;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return true;
}

function isSynthesisInput(value: unknown): value is VoiceSynthesisOptions {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<VoiceSynthesisOptions>;

  return (
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    (candidate.voice === undefined || typeof candidate.voice === "string") &&
    (candidate.format === undefined || isVoiceFormat(candidate.format)) &&
    (candidate.speed === undefined || typeof candidate.speed === "number")
  );
}

function validateSynthesisInput(input: VoiceSynthesisOptions) {
  if (input.text.trim().length > maxSynthesisTextChars) {
    return "Voice synthesis text is too long.";
  }

  if (input.voice && input.voice.trim().length > maxVoiceNameChars) {
    return "Voice name is too long.";
  }

  if (input.speed !== undefined && (input.speed < minSpeechSpeed || input.speed > maxSpeechSpeed)) {
    return "Voice speed is out of range.";
  }

  return null;
}

function isVoiceFormat(value: unknown): value is VoiceSynthesisFormat {
  return value === "mp3" || value === "wav" || value === "ogg";
}
