"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Follow the visible screen when a mobile keyboard resizes only the visual viewport. */
export function useChatViewport() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = ref.current;
    const viewport = window.visualViewport;
    if (!root || !viewport) return;
    const update = () => {
      // Pinch zoom must keep its native pan/scroll behavior.
      if (Math.abs(viewport.scale - 1) > 0.01) {
        root.style.removeProperty("--chat-viewport-height");
        root.style.removeProperty("--chat-viewport-top");
        return;
      }
      root.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
      root.style.setProperty("--chat-viewport-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--chat-viewport-height");
      root.style.removeProperty("--chat-viewport-top");
    };
  }, []);
  return ref;
}

/** Keep the newest message visible on keyboard/toolbar changes, preserving an up-scroll. */
export function useFollowLatestOnResize(stream: RefObject<HTMLDivElement | null>, follow: RefObject<boolean>, threadId?: string) {
  useEffect(() => {
    const node = stream.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (follow.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [stream, follow, threadId]);
}
