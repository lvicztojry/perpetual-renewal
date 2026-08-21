import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { getRenewalService, MessageValidationError } from "@/lib/renewal/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const session = await getCurrentSession();
  const messages = await getRenewalService(session.userId).listMessages(conversationId);
  return privateJson({ messages });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = readMessageCreate(await readJsonObject(request));
    const session = await getCurrentSession();
    const result = await getRenewalService(session.userId).sendMessage(
      conversationId,
      body.content ?? ""
    );

    if (!result) {
      return privateJson({ error: "Conversation not found." }, { status: 404 });
    }

    return privateJson(result, { status: 201 });
  } catch (error) {
    if (error instanceof MessageValidationError) {
      return privateJson({ error: messageValidationErrorMessage(error) }, { status: 400 });
    }

    return privateJson(
      { error: jsonErrorMessage(error, "Failed to send message.") },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = readMessagePatch(await readJsonObject(request));
    const session = await getCurrentSession();

    if (!body.messageId) {
      return privateJson({ error: "PATCH requires messageId." }, { status: 400 });
    }

    if (body.action === "regenerate") {
      const result = await getRenewalService(session.userId).regenerateMessage(
        conversationId,
        body.messageId
      );

      if (!result) {
        return privateJson({ error: "Message or conversation not found." }, { status: 404 });
      }

      return privateJson(result);
    }

    if (body.action === "set_important") {
      const result = await getRenewalService(session.userId).setMessageImportance(
        conversationId,
        body.messageId,
        body.important ?? true
      );

      if (!result) {
        return privateJson({ error: "Message or conversation not found." }, { status: 404 });
      }

      return privateJson({ message: result });
    }

    return privateJson(
      { error: "Unsupported PATCH action. Use regenerate or set_important." },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof MessageValidationError) {
      return privateJson({ error: messageValidationErrorMessage(error) }, { status: 400 });
    }

    return privateJson(
      { error: jsonErrorMessage(error, "Failed to update message.") },
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
    return privateJson({ error: "DELETE requires messageId." }, { status: 400 });
  }

  const deleted = await getRenewalService(session.userId).deleteMessage(conversationId, messageId);

  if (!deleted) {
    return privateJson({ error: "Message or conversation not found." }, { status: 404 });
  }

  return privateJson({ deleted: true, messageId });
}

function readMessageCreate(body: Record<string, unknown>) {
  return {
    content: typeof body.content === "string" ? body.content : undefined
  };
}

function readMessagePatch(body: Record<string, unknown>) {
  return {
    action: typeof body.action === "string" ? body.action : undefined,
    messageId: typeof body.messageId === "string" ? body.messageId : undefined,
    important: typeof body.important === "boolean" ? body.important : undefined
  };
}

function messageValidationErrorMessage(error: MessageValidationError) {
  if (error.message === "Message content is required.") return "Message content is required.";
  if (error.message === "Only assistant messages can be regenerated.") {
    return "Only assistant messages can be regenerated.";
  }
  if (error.message === "Regeneration requires at least one prior user message.") {
    return "Regeneration requires at least one prior user message.";
  }
  return "Failed to update message.";
}
