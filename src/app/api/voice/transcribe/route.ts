import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { createUserVoiceProvider } from "@/lib/voice/user-provider";
import {
  VoiceProviderError,
  type VoiceTranscription,
  type VoiceTranscriptionOptions
} from "@/lib/voice/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isTranscriptionInput(body)) {
    return NextResponse.json({ error: "Missing voice transcription input." }, { status: 400 });
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
          error: "Voice provider failed.",
          kind: error.details.kind,
          provider: error.details.provider,
          model: error.details.model,
          status: error.details.status,
          retryable: error.details.retryable
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

  return (
    candidate.audioBase64 === undefined ||
    typeof candidate.audioBase64 === "string"
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
