"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForegroundPoll } from "./use-foreground-poll";
import { acknowledgeReadMessages } from "@/lib/client-sync/read";

const UPDATED = "renewal:read-receipts-updated";
type Scope = "private" | "group";
type Thread = { scope: Scope; threadId: string; unreadCount: number };
type State = "loading" | "ready" | "offline" | "signed-out" | "account-changed";

export function useInboxSync(userId?: string) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [state, setState] = useState<State>("loading");
  const revision = useRef(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  useEffect(() => {
    const changed = () => {
      revision.current++;
      setRefreshRevision(value => value + 1);
    };
    window.addEventListener(UPDATED, changed);
    return () => window.removeEventListener(UPDATED, changed);
  }, []);
  // Supersede a pre-receipt GET immediately, even if its response is stalled.
  useForegroundPoll(userId ? `${userId}:${refreshRevision}` : null, async signal => {
    const version = revision.current;
    try {
      const response = await fetch("/api/sync/inbox", { cache: "no-store", signal });
      if (signal.aborted || version !== revision.current) return;
      if (response.status === 401) { setThreads([]); setState("signed-out"); return; }
      if (!response.ok) throw new Error();
      const data = await response.json() as { userId: string; threads: Thread[] };
      if (signal.aborted || version !== revision.current) return;
      if (data.userId !== userId) { setThreads([]); setState("account-changed"); return; }
      if (!Array.isArray(data.threads) || !data.threads.every(row => ["private", "group"].includes(row.scope) && typeof row.threadId === "string" && Number.isInteger(row.unreadCount) && row.unreadCount >= 0)) throw new Error();
      setThreads(data.threads); setState("ready");
    } catch { if (!signal.aborted && version === revision.current) setState("offline"); }
  }, 15000);
  return { state, count: (scope: Scope, threadId?: string) => threads.find(row => row.scope === scope && row.threadId === threadId)?.unreadCount ?? 0,
    total: (scope: Scope) => threads.filter(row => row.scope === scope).reduce((sum, row) => sum + row.unreadCount, 0) };
}

/** Acknowledge only actual loaded incoming IDs while this conversation is in view. */
export function useReadMessages(userId: string | undefined, scope: Scope, threadId: string | undefined, messageIds: string[], enabled: boolean, canRead: () => boolean = () => true, viewKey?: string) {
  const identity = `${userId ?? ""}:${scope}:${threadId ?? ""}`;
  const receipt = useMemo(() => ({ identity, acknowledged: new Set<string>() }), [identity]);
  const idsKey = messageIds.join("\n");
  // Opening the already-selected mobile chat changes its view, not its IDs.
  const refreshKey = `${idsKey}:${viewKey ?? ""}`;
  useForegroundPoll(userId && threadId && enabled ? identity : null, async signal => {
    await acknowledgeReadMessages({
      messageIds, acknowledged: receipt.acknowledged, signal,
      // Visibility and the caller's viewport/scroll gate work on mobile too.
      canRead: () => document.visibilityState === "visible" && canRead(),
      post: async batch => {
        const response = await fetch("/api/sync/read", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, threadId, messageIds: batch }) });
        if (!response.ok) throw new Error("Read receipt failed");
        return await response.json() as { markedCount: number };
      },
      updated: () => window.dispatchEvent(new Event(UPDATED))
    });
  }, 15000, undefined, refreshKey);
}
