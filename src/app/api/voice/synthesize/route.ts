import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { createUserVoiceProvider } from "@/lib/voice/user-provider";
import {
  VoiceProviderError,
  type VoiceSynthesisFormat,
  type VoiceSynthesisOptions
} from "@/lib/voice/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isSynthesisInput(body)) {
    return NextResponse.json({ error: "Missing text for voice synthesis." }, { status: 400 });
  }

  try {
    const session = await getCurrentSession();
    const provider = await createUserVoiceProvider(session.userId);
    const result = await provider.synthesize(body);
    return NextResponse.json({
      ...result,
      audioDataUrl: `data:${result.mimeType};base64,${result.audioBase64}`
    });
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

    return NextResponse.json({ error: "Failed to synthesize voice." }, { status: 500 });
  }
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

function isVoiceFormat(value: unknown): value is VoiceSynthesisFormat {
  return value === "mp3" || value === "wav" || value === "ogg";
}
