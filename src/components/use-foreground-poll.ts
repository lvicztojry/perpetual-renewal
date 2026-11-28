"use client";

import { useEffect, useRef } from "react";
import { startForegroundPoll } from "@/lib/client-sync/poll";

export function useForegroundPoll(identity: string | null, run: (signal: AbortSignal) => Promise<void>, intervalMs = 7000, refreshEvent?: string, refreshKey?: string) {
  const task = useRef(run);
  const wake = useRef<(() => void) | null>(null);
  useEffect(() => { task.current = run; }, [run]);
  useEffect(() => {
    if (!identity) return;
    return startForegroundPoll({
      visible: () => document.visibilityState === "visible",
      subscribe: refresh => {
        wake.current = refresh;
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        if (refreshEvent) window.addEventListener(refreshEvent, refresh);
        return () => {
          if (wake.current === refresh) wake.current = null;
          document.removeEventListener("visibilitychange", refresh);
          window.removeEventListener("focus", refresh);
          window.removeEventListener("online", refresh);
          if (refreshEvent) window.removeEventListener(refreshEvent, refresh);
        };
      },
      schedule: (callback, delay) => setTimeout(callback, delay),
      cancel: timer => clearTimeout(timer)
    }, signal => task.current(signal), intervalMs);
  }, [identity, intervalMs, refreshEvent]);
  // New messages request another pass without aborting an in-flight receipt.
  useEffect(() => { if (refreshKey !== undefined) wake.current?.(); }, [refreshKey]);
}
