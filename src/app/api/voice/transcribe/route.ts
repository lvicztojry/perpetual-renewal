import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await readJsonObject(request);
  } catch (error) {
    return NextResponse.json(
      { error: jsonErrorMessage(error, "Failed to transcribe voice.") },
      { status: 400 }
    );
  }

  if (!isTranscriptionInput(body)) {
    return NextResponse.json({ error: "Missing voice transcription input." }, { status: 400 });
  }

  const validationError = validateTranscriptionInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError.error }, { status: validationError.status });
  }

  try {
    const session = await getCurrentSession();
    const provider = await createUserVoiceProvider(session.userId);
    const result = await provider.transcribe(body);
    return NextResponse.json(toSafeTranscriptionResponse(result));
  } catch (error) {
    if (error instanceof VoiceProviderError) {
      return NextResponse.json(
        {
          error: "Voice provider failed."
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ error: "Failed to transcribe voice." }, { status: 500 });
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
    fallbackReason: result.fallbackReason,
    missingConfig: result.missingConfig,
    retryable: result.retryable,
    status: result.status
  };
}

function isTranscriptionInput(value: unknown): value is VoiceTranscriptionOptions {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<VoiceTranscriptionOptions>;
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

function validateTranscriptionInput(input: VoiceTranscriptionOptions): { error: string; status: number } | null {
  const audioBase64 = input.audioBase64?.trim();
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
