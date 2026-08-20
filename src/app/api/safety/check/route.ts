import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
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
  const body = (await request.json()) as SafetyCheckRequest;
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
    persistence: safetyEvent.persistence,
    next: "DEV-11: call for user input, assistant output and proactive drafts."
  });
}
