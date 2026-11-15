"use client";

import { ChatCharacterImport } from "./chat-character-import";
import { useRouter } from "next/navigation";
import { playAbilityIntro } from "@/lib/ability-events";
import type { CompanionProfile } from "@/lib/renewal/types";

export function ChatCharacterCreatePage() {
  const router = useRouter();
  function returnToChat(companion: CompanionProfile) {
    router.push(`/?companion=${encodeURIComponent(companion.id)}`);
    router.refresh();
    playAbilityIntro({ kind: "renewal", companionName: companion.name, autoPlay: true });
  }
  return <ChatCharacterImport onCreated={returnToChat} onCancel={() => router.push("/")} />;
}
