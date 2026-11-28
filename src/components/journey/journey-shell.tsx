"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ABILITY_INTRO_STATE_EVENT } from "@/lib/ability-events";
import { OPEN_JOURNEY_EVENT } from "@/lib/journey/events";
import { getCourse } from "@/lib/journey/courses";
import type { GuideCapability } from "@/lib/journey/courses/types";
import { useGuideController } from "./use-guide-controller";
import { useTarget } from "./use-target";
import { useGuidedScope } from "./use-guided-scope";
import { GuideBubble } from "./guide-bubble";
import { JourneyDirectory } from "./journey-directory";
import { JourneyInvite } from "./journey-invite";
import styles from "./journey-shell.module.css";

const AUTH_PATH = /^\/(?:login|register|signup|sign-up|sign-in|auth|verify(?:-email)?|reset-password|forgot-password|recover(?:y)?)(?:\/|$)/;

/** Which branch fits the current page, for “当前页面的支线” and the first-visit invite. */
export function pageCourse(pathname: string): string | undefined {
  if (pathname.startsWith("/groups")) return "groups";
  if (pathname.startsWith("/dream")) return "dream";
  if (pathname.startsWith("/settings")) return "preferences";
  if (pathname.startsWith("/create-from-chat")) return "chat-character";
  return undefined;
}

/** Recovery labels for the one capability each branch declares. */
const capabilityLabels: Partial<Record<GuideCapability, string>> = {
  "open-create-person": "打开「想见谁」",
  "open-people": "回到人物列表",
  "open-chat": "回到聊天",
  "open-dream": "打不开时，去入梦页",
  "open-memory": "打开人物资料",
  "open-import": "打开导入面板",
  "open-groups": "去打留灯会",
  "open-settings": "打开设置",
  "open-course-directory": "打开目录"
};

/**
 * One coordinator per account. It never renders on auth pages and yields to the
 * bell/ability performance and to unknown dialogs.
 */
export function JourneyShell({ userId }: { userId?: string }) {
  const pathname = usePathname() || "/";
  if (AUTH_PATH.test(pathname)) return null;
  return <AccountGuide key={`${userId ?? "session"}:${pathname}`} userId={userId} pathname={pathname} />;
}

function AccountGuide({ userId, pathname }: { userId?: string; pathname: string }) {
  const router = useRouter();
  // Context flags decide whether a step's declared requirement is met on this page.
  const [context, setContext] = useState<{ companion?: { id: string; name: string }; companionKnown: boolean; group?: boolean; groupKnown: boolean }>({
    companionKnown: false, groupKnown: false
  });
  const guide = useGuideController({
    userId,
    pageBranch: pageCourse(pathname),
    // Until the real resource list is read, the requirement is unknown — never "missing".
    hasCompanion: context.companionKnown ? context.companion !== undefined : undefined,
    hasGroup: context.groupKnown ? context.group === true : undefined
  });
  const step = guide.step;
  const [blocked, setBlocked] = useState(false);
  const [portraitFailed, setPortraitFailed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const target = useTarget(step?.target ?? null, 5000);
  const policy = step?.policy ?? "guided";
  const teachingDirectory = step?.target === "course-directory";
  const visible = Boolean(step && guide.phase === "stepping" && !blocked && (!guide.directoryOpen || teachingDirectory));
  // Free steps let the user browse; guided steps confine interaction.
  useGuidedScope({ policy, active: visible && !guide.unmetRequirement, target: target.element });

  // Business context comes from the real resources, never from the route alone.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch("/api/companions", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { companions?: Array<{ id: string; name: string }> };
        if (cancelled) return;
        const first = payload.companions?.[0];
        setContext(current => ({
          ...current,
          companionKnown: true,
          companion: first ? { id: first.id, name: first.name } : undefined
        }));
      } catch { /* The workspace owns connection feedback; the guide simply stays cautious. */ }
    };
    void read();
    return () => { cancelled = true; };
  }, [pathname, guide.journey?.companionId]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch("/api/groups", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { groups?: unknown[] };
        if (!cancelled) setContext(current => ({ ...current, groupKnown: true, group: (payload.groups?.length ?? 0) > 0 }));
      } catch { /* Same as above. */ }
    };
    if (pathname.startsWith("/groups")) void read();
    return () => { cancelled = true; };
  }, [pathname]);

  // Clicking the highlighted real control completes an in-page step. Links that
  // change the route are handled by arrival instead, so the write is not aborted
  // by the navigation that unmounts this coordinator.
  const confirmRef = useRef(guide.confirm);
  useEffect(() => { confirmRef.current = guide.confirm; }, [guide.confirm]);
  useEffect(() => {
    const element = target.element;
    if (!visible || !step || !element) return;
    if (step.kind !== "action" || step.completion.type !== "confirm") return;
    if (element.closest("a[href]")) return;
    const onClick = () => { void confirmRef.current(); };
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  }, [visible, step, target.element]);

  // Arriving at the step's destination completes a navigation step.
  const arrivalDone = useRef<string | null>(null);
  useEffect(() => {
    if (!step?.arrivePath || !visible) return;
    // "/" must match only the exact root, never every path.
    const reached = step.arrivePath === "/" ? pathname === "/" : pathname.startsWith(step.arrivePath);
    if (!reached) return;
    const key = `${guide.journey?.activeCourse?.runId}:${step.id}`;
    if (arrivalDone.current === key) return;
    arrivalDone.current = key;
    void Promise.resolve().then(() => { if (confirmRef.current) void confirmRef.current(); });
  }, [pathname, step?.arrivePath, step?.id, visible, guide.journey?.activeCourse?.runId]);

  // Ability performances (bell, dream intro) take the screen first.
  useEffect(() => {
    const onAbility = (event: Event) => {
      setBlocked((event as CustomEvent<{ active: boolean }>).detail?.active === true);
    };
    window.addEventListener(ABILITY_INTRO_STATE_EVENT, onAbility);
    return () => window.removeEventListener(ABILITY_INTRO_STATE_EVENT, onAbility);
  }, []);

  // Expected tutorial dialogs are part of the teaching context; unknown ones pause the card.
  useEffect(() => {
    if (!visible) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]'))
        .filter(node => !node.closest("[data-journey-overlay]") && node.getClientRects().length > 0);
      const unknown = dialogs.filter(node => !node.hasAttribute("data-guide-expected"));
      // The card is hosted inside a tutorial-expected dialog so it stays in that top layer.
      const expected = dialogs.filter(node => node.hasAttribute("data-guide-expected"));
      clearTimeout(timer);
      setHost(current => {
        const next = expected.at(-1) ?? null;
        return current === next ? current : next;
      });
      timer = setTimeout(() => setBlocked(current => current || unknown.length > 0), 160);
    };
    const observer = new MutationObserver(records => {
      if (records.every(record => record.target instanceof Element && record.target.closest("[data-journey-overlay]"))) return;
      check();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "style", "hidden", "aria-modal"] });
    check();
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [visible]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 620px)");
    const update = () => { setCompact(media.matches); setCollapsed(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // The entry button opens the directory; nothing auto-opens an overlay.
  useEffect(() => {
    const open = () => guide.openDirectory();
    window.addEventListener(OPEN_JOURNEY_EVENT, open);
    return () => window.removeEventListener(OPEN_JOURNEY_EVENT, open);
  }, [guide]);

  const directory = <JourneyDirectory guide={guide} context={{ pageCourse: pageCourse(pathname) }} forceOpen={teachingDirectory} />;

  // A capability only ever re-points the step; it never performs the business write.
  const capability = step?.capability;
  const onCapability = capability && capabilityLabels[capability]
    ? () => {
      if (capability === "open-groups") router.push("/groups");
      else if (capability === "open-settings") router.push("/settings");
      else if (capability === "open-chat" || capability === "open-people") router.push("/");
      else if (capability === "open-dream" && context.companion) router.push(`/dream/${encodeURIComponent(context.companion.id)}`);
      else if (capability === "open-course-directory") guide.openDirectory();
      // Anything else needs an in-page panel; the page adapter owns that, so the
      // card keeps pointing at it and we only offer the directory.
      else guide.openDirectory();
    }
    : undefined;

  if (!step || !visible) {
    return <>
      {directory}
      {guide.phase === "invite" && guide.invite && !blocked ? <JourneyInvite
        title={guide.invite.title}
        onAccept={() => void guide.acceptInvite()}
        onDecline={() => void guide.declineInvite()}
        onLater={guide.dismiss}
      /> : null}
      {guide.phase === "paused" && !guide.directoryOpen ? <aside className={styles.pause} aria-label="引导已暂停">
        <span>余念安 · 灯会等你</span>
        <button type="button" onClick={guide.openDirectory}>继续</button>
        <button type="button" onClick={guide.dismiss}>收起</button>
      </aside> : null}
    </>;
  }

  const course = getCourse(guide.journey!.activeCourse!.id)!;
  const reuse = step.completion.type === "evidence" && step.completion.kind === "companion-created" && context.companion
    ? { id: context.companion.id, name: context.companion.name }
    : null;
  return <>
    <GuideBubble
      key={step.id}
      step={step}
      stepNumber={guide.stepNumber}
      stepTotal={guide.stepTotal}
      target={target}
      policy={policy}
      busy={guide.busy}
      error={guide.error}
      notice={guide.notice}
      portraitFailed={portraitFailed}
      compact={compact}
      collapsed={collapsed}
      canBack={guide.stepNumber > 1}
      canSkipStep={step.completion.type === "evidence"}
      unmetRequirement={guide.unmetRequirement}
      reuseCompanion={reuse}
      onReuse={reuse ? () => void guide.reuseCompanion(reuse.id) : undefined}
      onPortraitFail={() => setPortraitFailed(true)}
      onConfirm={() => void guide.confirm()}
      onBack={() => void guide.back()}
      onSkipStep={() => void guide.skipStep()}
      onPause={() => void guide.pause()}
      onSkipCourse={() => void guide.skipCourse("skipped")}
      onDismiss={guide.dismiss}
      onRelocate={target.resync}
      onExpand={() => setCollapsed(false)}
      onOpenDirectory={guide.openDirectory}
      onCapability={onCapability}
      capabilityLabel={capability ? capabilityLabels[capability] : undefined}
      host={host}
    />
    {/* Hidden asset probe keeps the portrait fallback chain honest in browsers. */}
    <span className={styles.hiddenAsset} aria-hidden="true" data-course={course.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/visuals/yu-nianan-guide.png" alt="" onError={() => setPortraitFailed(true)} />
    </span>
    {directory}
  </>;
}
