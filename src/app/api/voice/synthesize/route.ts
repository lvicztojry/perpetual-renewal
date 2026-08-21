import { privateJson } from "@/lib/http/private-response";
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
    return privateJson(toSafeSynthesisResponse(result));
  } catch (error) {
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
