"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { InteractionPolicy } from "@/lib/journey/courses/types";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confine pointer and keyboard interaction to the target and the guide card.
 * Shade bands already block pointer events; this adds the Tab trap and inert
 * siblings without ever making the target's own ancestors inert.
 */
export function useGuidedScope(options: {
  policy: InteractionPolicy;
  active: boolean;
  target: HTMLElement | null;
  cardSelector?: string;
}) {
  const { policy, active, target } = options;
  const cardSelector = options.cardSelector ?? "[data-guide-card]";
  const previous = useRef<{ node: HTMLElement; inert: boolean }[]>([]);

  const allowed = useCallback((node: Element | null) => {
    if (!node) return false;
    if (node.closest(cardSelector)) return true;
    if (node.closest("[data-journey-overlay]")) return true;
    if (target && (target === node || target.contains(node) || node.contains(target))) return true;
    return false;
  }, [cardSelector, target]);

  useEffect(() => {
    if (!active || policy !== "guided") return;
    const card = document.querySelector<HTMLElement>(cardSelector);
    const stops = () => {
      const nodes = [target, card].filter((node): node is HTMLElement => Boolean(node));
      return nodes.flatMap(node => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))).filter(node => !node.closest('[hidden], [aria-hidden="true"]') && node.getClientRects().length > 0);
    };
    // Inert the target's siblings along its ancestor chain: never the target itself
    // and never an ancestor (which would inert the target too).
    const siblings: HTMLElement[] = [];
    let node: HTMLElement | null = target;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        if (sibling.closest("[data-journey-overlay]") || sibling.hasAttribute("data-journey-card")) continue;
        if (sibling === card) continue;
        // Never inert a container that holds the target, e.g. the course directory.
        if (target && sibling.contains(target)) continue;
        siblings.push(sibling);
      }
      node = parent;
    }
    for (const sibling of siblings) {
      previous.current.push({ node: sibling, inert: sibling.inert });
      sibling.inert = true;
    }
    // The app root that is not an ancestor is covered by the shade; focus order too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = stops().filter(item => !item.closest("[inert]"));
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !allowed(current))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (current === last || !allowed(current))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      for (const entry of previous.current) entry.node.inert = entry.inert;
      previous.current = [];
    };
  }, [active, policy, target, cardSelector, allowed]);

  return useMemo(() => ({ allowed }), [allowed]);
}
