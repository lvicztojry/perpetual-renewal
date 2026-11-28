import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/session";
import { ChatCharacterCreatePage } from "@/components/chat-character-create-page";

export const metadata: Metadata = { title: "从聊天记录创建人物 · 生生不息" };

export default async function CreateFromChatPage() {
  if (!await getOptionalSession()) redirect("/login");
  return <ChatCharacterCreatePage />;
}
