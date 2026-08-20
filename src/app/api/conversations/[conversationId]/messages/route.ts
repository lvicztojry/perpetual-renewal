import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getRenewalService } from "@/lib/renewal/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const session = await getCurrentSession();
  const messages = await getRenewalService(session.userId).listMessages(conversationId);
  return NextResponse.json({ messages });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json()) as { content?: string };
    const session = await getCurrentSession();
    const result = await getRenewalService(session.userId).sendMessage(
      conversationId,
      body.content ?? ""
    );

    if (!result) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message." },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json()) as {
      action?: string;
      messageId?: string;
      important?: boolean;
    };
    const session = await getCurrentSession();

    if (!body.messageId) {
      return NextResponse.json({ error: "PATCH requires messageId." }, { status: 400 });
    }

    if (body.action === "regenerate") {
      const result = await getRenewalService(session.userId).regenerateMessage(
        conversationId,
        body.messageId
      );

      if (!result) {
        return NextResponse.json({ error: "Message or conversation not found." }, { status: 404 });
      }

      return NextResponse.json(result);
    }

    if (body.action === "set_important") {
      const result = await getRenewalService(session.userId).setMessageImportance(
        conversationId,
        body.messageId,
        body.important ?? true
      );

      if (!result) {
        return NextResponse.json({ error: "Message or conversation not found." }, { status: 404 });
      }

      return NextResponse.json({ message: result });
    }

    return NextResponse.json(
      { error: "Unsupported PATCH action. Use regenerate or set_important." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update message." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const session = await getCurrentSession();
  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get("messageId");

  if (!messageId) {
    return NextResponse.json({ error: "DELETE requires messageId." }, { status: 400 });
  }

  const deleted = await getRenewalService(session.userId).deleteMessage(conversationId, messageId);

  if (!deleted) {
    return NextResponse.json({ error: "Message or conversation not found." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, messageId });
}
