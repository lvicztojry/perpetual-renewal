"use client";

import { ChatCharacterImport } from "./chat-character-import";
import { useRouter } from "next/navigation";

export function ChatCharacterCreatePage() {
  const router = useRouter();
  function returnToChat() { router.push("/"); router.refresh(); }
  return <ChatCharacterImport onCreated={returnToChat} onCancel={() => router.push("/")} />;
}
