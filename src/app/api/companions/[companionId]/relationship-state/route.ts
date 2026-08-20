import { NextResponse } from "next/server";
import {
  createInitialRelationshipState,
  updateRelationshipState,
  type RelationshipSignal,
  type RelationshipStateSnapshot
} from "@/lib/relationship";

type RelationshipStateRequest = {
  current?: RelationshipStateSnapshot;
  signal?: RelationshipSignal;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ companionId: string }> }
) {
  const { companionId } = await context.params;

  return NextResponse.json({
    data: createInitialRelationshipState(companionId),
    persistence: "mock",
    next: "DEV-9: replace mock with Prisma RelationshipState upsert scoped by userId + companionId."
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ companionId: string }> }
) {
  const { companionId } = await context.params;
  const body = (await request.json()) as RelationshipStateRequest;
  const current = body.current ?? createInitialRelationshipState(companionId);
  const signal = body.signal ?? {
    userMessage: "",
    createdAt: new Date().toISOString()
  };

  return NextResponse.json({
    data: updateRelationshipState(current, signal),
    persistence: "mock",
    next: "DEV-9: call after message persistence and attach sourceMessageId for explainability."
  });
}
