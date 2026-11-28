"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TargetRect = { x: number; y: number; width: number; height: number };
export type TargetState = {
  /** Resolved element, or null when missing or ambiguous. */
  element: HTMLElement | null;
  rect: TargetRect | null;
  /** "missing" until the first successful measurement within the wait window. */
  status: "pending" | "found" | "missing" | "ambiguous";
  /** Text the user typed into the target, when the target is a text control. */
  input: { required: boolean; satisfied: boolean; composing: boolean };
};

const EMPTY_INPUT = { required: false, satisfied: true, composing: false };

function visible(node: HTMLElement) {
  if (!node.getClientRects().length) return false;
  const style = getComputedStyle(node);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
}

/** Registry lookup: only one visible, semantically matching target may drive a guided step. */
export function resolveTarget(key: string): { element: HTMLElement | null; status: TargetState["status"] } {
  if (typeof document === "undefined") return { element: null, status: "missing" };
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-guide="${CSS.escape(key)}"]`))
    // The guide's own card never hosts an anchor; the directory may.
    .filter(node => !node.closest("[data-guide-card]") && visible(node));
  if (!nodes.length) return { element: null, status: "missing" };
  if (nodes.length > 1) {
    // Prefer the one inside the topmost open dialog: that is what the user can reach.
    const inDialog = nodes.filter(node => node.closest("dialog[open]"));
    if (inDialog.length === 1) return { element: inDialog[0], status: "found" };
    return { element: null, status: "ambiguous" };
  }
  return { element: nodes[0], status: "found" };
}

function readInput(element: HTMLElement): TargetState["input"] {
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") return { required: true, satisfied: element.checked, composing: false };
    return { required: true, satisfied: element.value.trim().length > 0, composing: false };
  }
  if (element instanceof HTMLTextAreaElement) return { required: true, satisfied: element.value.trim().length > 0, composing: false };
  if (element instanceof HTMLSelectElement) return { required: true, satisfied: Boolean(element.value), composing: false };
  const text = element.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (text) return readInput(text);
  // A group of choices (relationship kinds, tabs): satisfied once any is chosen.
  const checked = element.querySelector<HTMLInputElement>('input:checked, [aria-pressed="true"], [aria-current="true"]');
  if (checked) return { required: true, satisfied: true, composing: false };
  return EMPTY_INPUT;
}

function measure(element: HTMLElement | null): TargetRect | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (!box.width && !box.height) return null;
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

const sameRect = (a: TargetRect | null, b: TargetRect | null) =>
  a === b || (Boolean(a && b) && Math.abs(a!.x - b!.x) < 0.5 && Math.abs(a!.y - b!.y) < 0.5 &&
    Math.abs(a!.width - b!.width) < 0.5 && Math.abs(a!.height - b!.height) < 0.5);

/**
 * Track one anchor. Measurement is coalesced into one rAF per burst; observers are
 * scoped to the target and its scroll containers, never to the whole document style.
 */
export function useTarget(key: string | null, waitMs = 5000) {
  const [state, setState] = useState<TargetState>({ element: null, rect: null, status: "pending", input: EMPTY_INPUT });
  const frame = useRef(0);
  const composing = useRef(false);
  const started = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const sync = useCallback(() => {
    if (!key) return;
    const { element, status } = resolveTarget(key);
    const rect = measure(element);
    const input = element ? { ...readInput(element), composing: composing.current } : EMPTY_INPUT;
    setState(current => {
      const nextStatus: TargetState["status"] = element && rect ? "found" : status === "ambiguous" ? "ambiguous" : "missing";
      if (current.status === nextStatus && sameRect(current.rect, rect) &&
          current.element === element &&
          current.input.required === input.required && current.input.satisfied === input.satisfied && current.input.composing === input.composing) {
        return current;
      }
      return { element, rect, status: nextStatus, input };
    });
  }, [key]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; sync(); });
  }, [sync]);

  useEffect(() => {
    if (!key) return;
    started.current = Date.now();
    // Reset the card onto the new anchor on the next microtask, so the mounting
    // component is not synchronously re-rendered from inside its own effect.
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      setState(current => current.status === "pending" && !current.element ? current : { element: null, rect: null, status: "pending", input: EMPTY_INPUT });
      schedule();
    });

    const onCompositionStart = () => { composing.current = true; schedule(); };
    const onCompositionEnd = () => { composing.current = false; schedule(); };
    // Input listeners are attached per target; recomputed whenever the element changes.
    let detachInput: (() => void) | undefined;
    const attach = () => {
      detachInput?.();
      const { element } = resolveTarget(key);
      if (!element) { detachInput = undefined; return; }
      element.addEventListener("input", schedule);
      element.addEventListener("change", schedule);
      element.addEventListener("compositionstart", onCompositionStart);
      element.addEventListener("compositionend", onCompositionEnd);
      detachInput = () => {
        element.removeEventListener("input", schedule);
        element.removeEventListener("change", schedule);
        element.removeEventListener("compositionstart", onCompositionStart);
        element.removeEventListener("compositionend", onCompositionEnd);
      };
    };
    attach();

    const resizeObserver = new ResizeObserver(schedule);
    const observeTarget = () => {
      resizeObserver.disconnect();
      const { element } = resolveTarget(key);
      if (element) resizeObserver.observe(element);
      attach();
    };
    observeTarget();

    // Bounded mutation watch: attribute/child changes in the document, filtered to
    // runs that could affect the anchor's presence or geometry.
    let mutations = 0;
    const observer = new MutationObserver(records => {
      if (records.every(record => record.target instanceof Element && record.target.closest("[data-journey-overlay]"))) return;
      mutations++;
      if (mutations > 400) { observer.disconnect(); }
      observeTarget();
      schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "open", "style", "aria-hidden", "disabled"] });

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);

    // Scroll the nearest scrollable ancestor only when the target is out of view.
    const { element } = resolveTarget(key);
    if (element) {
      const box = element.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      if (box.top < 8 || box.bottom > viewportHeight - 8) element.scrollIntoView({ block: "center", behavior: "instant" });
    }

    // One slow recheck settles the pending window; never polls after that.
    const settle = window.setTimeout(() => {
      schedule();
      if (Date.now() - started.current >= waitMs) observer.disconnect();
    }, waitMs);

    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.clearTimeout(settle);
      detachInput?.();
      resizeObserver.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [key, schedule, waitMs]);

  return { ...state, resync: sync } as TargetState & { resync: () => void };
}
