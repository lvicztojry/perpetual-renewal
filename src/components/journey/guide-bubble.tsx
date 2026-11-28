"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CourseStep, InteractionPolicy } from "@/lib/journey/courses/types";
import { chapterTitles } from "@/lib/journey/courses/main";
import type { TargetRect, TargetState } from "./use-target";
import styles from "./journey-guide.module.css";

const GAP = 14;
const EDGE = 12;
const steps: Record<CourseStep["kind"], string> = {
  story: "听余念安说", read: "认一认这里", navigate: "去下一个地方",
  input: "写一点什么", action: "完成这一步", wait: "等一等", review: "核对一下"
};

type Placement = { left: number; top: number; width: number };

/** Choose the side with the most room, then clamp into the visual viewport. */
export function placeCard(rect: TargetRect | null, card: { width: number; height: number }, viewport: { width: number; height: number }) {
  if (!rect) return { left: Math.max(EDGE, (viewport.width - card.width) / 2), top: Math.max(EDGE, viewport.height - card.height - EDGE) };
  const below = viewport.height - (rect.y + rect.height) - GAP;
  const above = rect.y - GAP;
  const right = viewport.width - (rect.x + rect.width) - GAP;
  const preferHorizontal = viewport.width >= 860 ? right >= card.width || rect.x - GAP >= card.width : false;
  let left: number; let top: number;
  if (preferHorizontal) {
    left = right >= card.width ? rect.x + rect.width + GAP : rect.x - card.width - GAP;
    top = rect.y;
  } else if (below >= card.height || below >= above) {
    left = rect.x;
    top = rect.y + rect.height + GAP;
  } else {
    left = rect.x;
    top = rect.y - card.height - GAP;
  }
  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, viewport.width - card.width - EDGE));
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, viewport.height - card.height - EDGE));
  return { left, top };
}

/**
 * Purely visual dimming: four bands leave the target untouched. They never capture
 * pointer events — interaction is restricted by `inert` on the target's siblings —
 * so a stale measurement can never block the control it failed to find.
 */
function Shade({ rect }: { rect: TargetRect }) {
  const pad = 8;
  const left = Math.max(0, rect.x - pad);
  const top = Math.max(0, rect.y - pad);
  const right = rect.x + rect.width + pad;
  const bottom = rect.y + rect.height + pad;
  const bands = [
    { left: 0, top: 0, width: "100vw", height: `${top}px` },
    { left: 0, top: `${bottom}px`, width: "100vw", height: `max(0px, calc(100dvh - ${bottom}px))` },
    { left: 0, top: `${top}px`, width: `${left}px`, height: `${Math.max(0, bottom - top)}px` },
    { left: `${right}px`, top: `${top}px`, width: `max(0px, calc(100vw - ${right}px))`, height: `${Math.max(0, bottom - top)}px` }
  ];
  return <>{bands.map((band, index) => (
    <div key={index} className={styles.shade} style={band} data-journey-shade aria-hidden="true" />
  ))}</>;
}

function Pulse({ rect, rounded }: { rect: TargetRect; rounded: "round" | "box" | "pill" }) {
  const pad = 7;
  return <div className={`${styles.pulse} ${styles[rounded]}`} style={{ left: rect.x - pad, top: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} aria-hidden="true" />;
}

export type GuideBubbleProps = {
  step: CourseStep;
  stepNumber: number;
  stepTotal: number;
  target: TargetState;
  policy: InteractionPolicy;
  /** True while a business call is in flight for an evidence step. */
  busy: boolean;
  error: string;
  notice: string;
  portraitFailed: boolean;
  compact: boolean;
  collapsed: boolean;
  canBack: boolean;
  canSkipStep: boolean;
  /** Context this step declares but the page does not have; the card cannot point anywhere. */
  unmetRequirement?: "companion" | "group" | null;
  /** Existing companion offered when the user already has one. */
  reuseCompanion?: { id: string; name: string } | null;
  onConfirm: () => void;
  onBack: () => void;
  onSkipStep: () => void;
  onPause: () => void;
  onSkipCourse: () => void;
  onDismiss: () => void;
  onRelocate: () => void;
  onExpand: () => void;
  onOpenDirectory: () => void;
  /** Optional capability the page offers as a recovery path (never a silent write). */
  onCapability?: () => void;
  capabilityLabel?: string;
  onReuse?: () => void;
  onPortraitFail?: () => void;
  host?: HTMLElement | null;
};

export function GuideBubble(props: GuideBubbleProps) {
  const {
    step, stepNumber, stepTotal, target, policy, busy, error, notice, portraitFailed, compact, collapsed,
    canBack, canSkipStep, unmetRequirement, reuseCompanion, onConfirm, onBack, onSkipStep, onPause,
    onSkipCourse, onDismiss, onRelocate, onExpand, onOpenDirectory, onCapability, capabilityLabel,
    onReuse, host
  } = props;
  const [answer, setAnswer] = useState("");
  const onChoose = setAnswer;
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement>({ left: EDGE, top: EDGE, width: 320 });
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [viewportSize, setViewportSize] = useState({ width: 1024, height: 768 });
  const [viewportVersion, setViewportVersion] = useState(0);
  const rounded: "round" | "box" | "pill" = step.kind === "input" || step.kind === "review" ? "box" : "pill";

  // A resized window or an opened phone keyboard must re-place the card, not strand it.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; setViewportVersion(value => value + 1); });
    };
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const viewport = { width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight };
    // Clamp in pixels as well: dvh units do not shrink for every embedded viewport.
    const limit = Math.max(140, Math.round(viewport.height * (compact ? 0.46 : 0.56)));
    card.style.maxHeight = `${limit}px`;
    setMaxHeight(limit);
    const box = { width: card.offsetWidth, height: Math.min(card.offsetHeight, limit) };
    setPlacement({ ...placeCard(target.rect, box, viewport), width: box.width });
    setViewportSize(current => current.width === viewport.width && current.height === viewport.height ? current : viewport);
  }, [target.rect, compact, collapsed, error, notice, viewportVersion]);

  // Move focus only for guided steps and only when focus is outside the target.
  useEffect(() => {
    if (policy !== "guided") return;
    const active = document.activeElement;
    const insideTarget = target.element && active instanceof Node && target.element.contains(active);
    if (!insideTarget && cardRef.current && !cardRef.current.contains(active)) {
      returnFocus.current = active instanceof HTMLElement ? active : null;
      cardRef.current.querySelector<HTMLElement>("[data-guide-focus]")?.focus({ preventScroll: true });
    }
  }, [policy, step.id, target.element]);

  useEffect(() => () => {
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
  }, []);

  const inputReady = !target.input.required || target.input.satisfied;
  const waiting = step.kind === "input" && !inputReady;
  const missing = target.status === "missing" || target.status === "ambiguous";
  const progress = stepTotal > 1 ? Math.round((stepNumber / stepTotal) * 100) : 0;

  const card = (
    <div
      ref={cardRef}
      className={`${styles.card} ${compact ? styles.cardCompact : ""} ${collapsed ? styles.collapsed : ""}`}
      style={{ left: placement.left, top: placement.top, maxHeight }}
      role="dialog"
      aria-modal={false}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-journey-dialog
      data-journey-overlay
      data-guide-card
      data-step-id={step.id}
    >
      <div className={styles.cardTop}>
        {compact ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.avatar} src={portraitFailed ? "/visuals/yu-nianan-silhouette.png" : "/visuals/yu-nianan-guide.png"} alt="" aria-hidden="true" onError={e => { (e.currentTarget as HTMLImageElement).src = "/visuals/yu-nianan-silhouette.png"; }} />
        </> : null}
        <span className={styles.name} id={titleId}>余念安{compact ? "" : " · 旧城守灯人"}</span>
        <span className={styles.counter}>{stepNumber} / {stepTotal}</span>
        <button className={styles.close} type="button" aria-label="收起本次引导展示" onClick={onDismiss}>×</button>
      </div>
      <h2 className={styles.stepTitle}>{step.title ?? (step.chapter ? chapterTitles[step.chapter] : steps[step.kind])}</h2>
      <div className={styles.progress} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      {collapsed ? <button className={styles.expand} type="button" onClick={onExpand} data-guide-focus>{step.instruction ?? step.dialogue[0]}</button> : (
        <>
          <div className={styles.dialogue} id={bodyId}>
            {step.dialogue.map((line, index) => <p key={index}>“{line}”</p>)}
            {step.choices?.find(choice => choice.label === answer) ? <p className={styles.reply}>“{step.choices.find(choice => choice.label === answer)!.reply}”</p> : null}
          </div>
          {step.instruction ? <p className={styles.instruction}>{step.instruction}</p> : null}
          {notice ? <p className={styles.waiting} role="status">{notice}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {missing || unmetRequirement ? (
            <div className={styles.recovery}>
              <p>{unmetRequirement === "companion" ? "眼下还没有可以对话的人物，这一步指不到东西。"
                : unmetRequirement === "group" ? "眼下还没有可以围坐的群聊，这一步指不到东西。"
                : target.status === "ambiguous" ? "这一步的目标不止一个，我先不指错位置。" : "还没找到这一步的位置。"}</p>
              <div className={styles.actions}>
                {missing ? <button type="button" onClick={onRelocate} data-guide-focus>重新定位</button> : null}
                {onReuse && reuseCompanion ? <button type="button" onClick={onReuse} data-guide-focus>{`用现有人物：${reuseCompanion.name}`}</button> : null}
                {onCapability && capabilityLabel ? <button type="button" onClick={onCapability}>{capabilityLabel}</button> : null}
                <button type="button" className={styles.quiet} onClick={onOpenDirectory}>返回目录</button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              {step.choices?.length ? step.choices.map(choice => (
                <button key={choice.label} type="button" className={answer === choice.label ? styles.primary : undefined} aria-pressed={answer === choice.label} disabled={busy} onClick={() => onChoose(choice.label)}>{choice.label}</button>
              )) : null}
              {step.kind === "input" ? (
                <button type="button" className={styles.primary} disabled={busy || waiting || target.input.composing} onClick={onConfirm} data-guide-focus>
                  {target.input.composing ? "等你输入完" : waiting ? "写好了" : busy ? "正在记录…" : "写好了"}
                </button>
              ) : null}
              {step.kind !== "input" && (step.completion.type === "confirm" || step.kind === "wait") ? (
                step.completion.type === "confirm" ? (
                  <button type="button" className={styles.primary} disabled={busy || (step.choices?.length ? !answer : false)} onClick={onConfirm} data-guide-focus>
                    {busy ? "正在记录…" : step.kind === "read" || step.kind === "review" ? "知道了" : "继续"}
                  </button>
                ) : (
                  <span className={styles.waiting} role="status">{busy ? "正在确认结果…" : "等 TA 的回声落下来…"}</span>
                )
              ) : null}
              {step.completion.type === "evidence" && step.kind !== "wait" && step.kind !== "input" ? (
                <span className={styles.waiting} role="status">
                  {busy ? "正在确认结果…" : "完成页面上的操作后，这里会自动接上。"}
                </span>
              ) : null}
            </div>
          )}
          <div className={styles.more}>
            {canBack ? <button type="button" onClick={onBack}>返回上一步</button> : null}
            {canSkipStep ? <button type="button" onClick={onSkipStep} disabled={busy}>跳过这一步</button> : null}
            <button type="button" onClick={onPause}>暂歇</button>
            <button type="button" onClick={onSkipCourse}>离开本段</button>
            <button type="button" onClick={onOpenDirectory}>目录</button>
          </div>
        </>
      )}
    </div>
  );

  // Desktop keeps her portrait beside the card, on the side away from the target so it
  // never covers what the step points at. Phones use the 34px avatar in the card head.
  const portrait = !compact && viewportSize.width >= 860 ? (() => {
    const width = 168;
    const sideRight = placement.left + (placement.width ?? 320) + 12;
    const left = sideRight + width <= viewportSize.width - 8 ? sideRight : Math.max(8, placement.left - width - 12);
    return { left, bottom: Math.max(12, viewportSize.height - (placement.top + (maxHeight ?? 320)) - 4) };
  })() : null;

  // Inside an open native dialog, the card must live within that dialog's subtree:
  // `showModal()` puts the dialog in the browser top layer, which no external z-index
  // can cover. Positioning is still viewport-fixed, so geometry is unchanged.
  const content = <>
    <div className={styles.overlay} data-journey-overlay data-policy={policy}>
      {target.rect ? <Shade rect={target.rect} /> : null}
      {target.rect ? <Pulse rect={target.rect} rounded={rounded} /> : null}
      {portrait ? (portraitFailed
        ? <div className={styles.portraitFallback} style={{ left: portrait.left, bottom: portrait.bottom }} aria-hidden="true" data-guide-portrait="fallback">余念安</div>
        : <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.portrait} style={{ left: portrait.left, bottom: portrait.bottom }} src="/visuals/yu-nianan-guide.png" alt="" aria-hidden="true" data-guide-portrait="primary" onError={props.onPortraitFail} />
        </>) : null}
      <span className={styles.srOnly} aria-live="polite">
        {`第 ${stepNumber} 步，共 ${stepTotal} 步。${step.instruction ?? ""}`}
      </span>
      {card}
    </div>
  </>;
  if (!host) return content;
  return createPortal(content, host);
}

/** Topmost open native dialog on screen, used as the card's host, if any. */
export function findTopDialog(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"))
    .filter(node => !node.closest("[data-journey-overlay]") && node.getClientRects().length > 0);
  return open.at(-1) ?? null;
}
