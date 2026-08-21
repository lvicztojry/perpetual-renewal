import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { readJsonObject } from "@/lib/http/json";
import {
  buildSafetyBoundaryReply,
  checkProactiveContextSafety,
  checkRelationshipSafety,
  type SafetyCheckStage
} from "@/lib/relationship";
import { recordSafetyEvent } from "@/lib/safety-events";

type SafetyCheckRequest = {
  text?: string;
  stage?: SafetyCheckStage;
  companionId?: string;
  messageId?: string;
  companionName?: string;
  companionInstruction?: string;
};

export async function POST(request: Request) {
  const session = await getCurrentSession();
  let body: SafetyCheckRequest;
  try {
    body = readSafetyCheckRequest(await readJsonObject(request));
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = body.text ?? "";
  const result =
    body.stage === "proactive_context"
      ? checkProactiveContextSafety({
          lastUserMessage: text,
          companionInstruction: body.companionInstruction
        })
      : checkRelationshipSafety(text, { stage: body.stage });
  const safetyEvent = await recordSafetyEvent({
    userId: session.userId,
    companionId: body.companionId,
    messageId: body.messageId,
    type: result.type,
    action: result.action,
    stage: result.stage ?? body.stage ?? "user_input",
    severity: result.severity,
    content: text
  });

  return NextResponse.json({
    data: {
      ...result,
      boundaryReply:
        result.action === "boundary_response"
          ? buildSafetyBoundaryReply(text, body.companionName)
          : undefined
    },
    safetyEvent,
    persistence: safetyEvent.persistence
  });
}

function readSafetyCheckRequest(body: Record<string, unknown>): SafetyCheckRequest {
  return {
    text: typeof body.text === "string" ? body.text : undefined,
    stage: typeof body.stage === "string" ? (body.stage as SafetyCheckStage) : undefined,
    companionId: typeof body.companionId === "string" ? body.companionId : undefined,
    messageId: typeof body.messageId === "string" ? body.messageId : undefined,
    companionName: typeof body.companionName === "string" ? body.companionName : undefined,
    companionInstruction:
      typeof body.companionInstruction === "string" ? body.companionInstruction : undefined
  };
}
