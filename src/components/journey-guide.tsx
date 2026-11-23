"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { ABILITY_INTRO_STATE_EVENT } from "@/lib/ability-events";
import { CREATE_JOURNEY_EVENT, OBSERVE_JOURNEY_EVENT, OPEN_JOURNEY_EVENT, type JourneyObservation } from "@/lib/journey/events";
import { journeySteps, type JourneyStep, type JourneyResponse, type JourneyInput } from "@/lib/journey/types";
import styles from "./journey-guide.module.css";

type Step = JourneyStep;
type Snapshot = JourneyResponse;
type Action = JourneyInput["action"];
type View = "hidden" | "help" | "story" | "compact";
const STEPS = journeySteps;
const TITLES: Record<Step, string> = { awakening: "初醒 · 有人等你", arrival: "旧城 · 久别重逢", lanterns: "留灯 · 人间尚暖", creation: "描摹 · 想见的人", conversation: "回声 · 说给你听", dream: "入梦 · 再近一些", complete: "此后 · 灯长明" };
const PRACTICAL = new Set<Step>(["creation", "conversation", "dream"]);
const AUTH_PATH = /^\/(?:login|register|signup|sign-up|sign-in|auth|verify(?:-email)?|reset-password|forgot-password|recover(?:y)?)(?:\/|$)/;

function suppressed() {
  try { if (sessionStorage.getItem("renewal:journey-suppress:v1") === "1") return true; } catch {}
  try { return localStorage.getItem("renewal:journey-suppress:v1") === "1"; } catch { return false; }
}
function snapshot(value: unknown): Snapshot {
  const data = value as Partial<Snapshot> | null;
  const j = data?.journey;
  if (!data || typeof data.userId !== "string" || !j || j.version !== 1 || !STEPS.includes(j.step)
    || !["legacy", "active", "paused", "completed", "skipped"].includes(j.status)
    || !Number.isSafeInteger(j.revision) || j.revision < 0 || !(j.companionId === null || typeof j.companionId === "string")) throw new Error("invalid response");
  return data as Snapshot;
}
function blockedByDialog() {
  return Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')).some(node => {
    if (node.closest("[data-journey-dialog]")) return false;
    if (node instanceof HTMLDialogElement && !node.open) return false;
    return !node.closest('[hidden], [aria-hidden="true"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  });
}

/** Mount once in each shared root. With no userId, the API establishes the web account. */
export function JourneyGuide({ userId }: { userId?: string }) {
  const pathname = usePathname() || "/";
  if (AUTH_PATH.test(pathname)) return null;
  return <AccountJourneyGuide key={userId ?? "session"} userId={userId} pathname={pathname} />;
}

function AccountJourneyGuide({ userId, pathname }: { userId?: string; pathname: string }) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const live = useRef(true);
  const record = useRef<Snapshot | null>(null);
  const readNumber = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const requests = useRef(new Set<AbortController>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const manual = useRef(false);
  const autoSeen = useRef(false);
  const abilityActive = useRef(false);
  const [current, setCurrent] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>("hidden");
  const [blocked, setBlocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [portraitFailed, setPortraitFailed] = useState(false);
  const retryRef = useRef<{ action: Action; observation?: JourneyObservation } | null>(null);

  const accept = useCallback((next: Snapshot) => {
    if (!live.current || (userId && next.userId !== userId)) return false;
    if (record.current && record.current.userId !== next.userId) {
      manual.current = false; autoSeen.current = false;
      retryRef.current = null; setView("hidden"); setAnswer(""); setError("");
    }
    record.current = next;
    setCurrent(next);
    return true;
  }, [userId]);

  const load = useCallback(async () => {
    const number = ++readNumber.current;
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    try {
      const response = await fetch("/api/me/journey", { cache: "no-store", signal: controller.signal });
      if (!live.current || number !== readNumber.current) return null;
      if (response.status === 401) {
        record.current = null; retryRef.current = null; setCurrent(null); setView("hidden"); manual.current = false; autoSeen.current = false;
        return null;
      }
      if (!response.ok) throw new Error("unavailable");
      const next = snapshot(await response.json());
      if (number !== readNumber.current || controller.signal.aborted || !accept(next)) return null;
      if (!retryRef.current) setError("");
      if (!autoSeen.current && next.journey.status === "active" && !suppressed() && !manual.current) {
        autoSeen.current = true;
        setView(PRACTICAL.has(next.journey.step) ? "compact" : "story");
      }
      return next;
    } catch {
      if (live.current && !controller.signal.aborted && number === readNumber.current) {
        setError("风声有些远，暂时没能接上。请再试一次。");
      }
      return null;
    }
  }, [accept]);

  const act = useCallback((action: Action, observation?: JourneyObservation): Promise<Snapshot | null> => {
    pending.current++; setBusy(true);
    async function run(retried = false): Promise<Snapshot | null> {
      if (!live.current) return null;
      const previous = record.current ?? await load();
      if (!previous || !live.current) return null;
      if (observation?.userId && observation.userId !== previous.userId) return null;
      if (action === "observe" && previous.journey.status !== "active") return null;
      ++readNumber.current; readAbort.current?.abort();
      const controller = new AbortController(); requests.current.add(controller);
      try {
        const response = await fetch("/api/me/journey", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ action, expectedRevision: previous.journey.revision, ...(observation ? { kind: observation.kind, companionId: observation.companionId } : {}) }),
        });
        if (!live.current || controller.signal.aborted) return null;
        if (response.status === 401) { record.current = null; retryRef.current = null; setCurrent(null); setView("hidden"); return null; }
        if (response.status === 409) {
          const refreshed = await load();
          if (action === "observe" && !retried && refreshed?.userId === previous.userId && live.current) return run(true);
          if (live.current) setError("灯下的故事已有新的一页。已为你重新接上，请再确认一次。");
          return null;
        }
        if (!response.ok) throw new Error("unavailable");
        const next = snapshot(await response.json());
        if (!live.current || controller.signal.aborted) return null;
        if (next.userId !== previous.userId) { await load(); return null; }
        if (!accept(next)) return null;
        retryRef.current = null; setError(""); setAnswer("");
        if (action === "pause" || action === "skip") setView("hidden");
        else if (action !== "observe") setView(PRACTICAL.has(next.journey.step) ? "compact" : "story");
        else if (next.journey.step === "complete") setView("compact");
        return next;
      } catch {
        if (live.current && !controller.signal.aborted) {
          setError("这一页还没能保存。故事仍停在原处，可以再试一次。");
          retryRef.current = { action, observation };
        }
        return null;
      } finally { requests.current.delete(controller); }
    }
    const task = chain.current.then(() => run(), () => run());
    chain.current = task;
    return task.finally(() => {
      pending.current--;
      if (live.current) setBusy(pending.current > 0);
    });
  }, [accept, load]);

  useEffect(() => {
    live.current = true;
    const activeRequests = requests.current;
    return () => {
      live.current = false; readAbort.current?.abort();
      activeRequests.forEach(controller => controller.abort());
    };
  }, []);

  useEffect(() => {
    // Also reconcile arrival at the workbench after navigation, never infer progress from routes.
    void chain.current.then(() => { if (live.current) void load(); });
    const focus = () => { if (!pending.current) void load(); };
    window.addEventListener("focus", focus);
    return () => { window.removeEventListener("focus", focus); readAbort.current?.abort(); };
  }, [pathname, load]);

  useEffect(() => {
    const open = () => {
      manual.current = true; setView("help");
      void chain.current.then(() => { if (live.current) void load(); });
    };
    const observe = (event: Event) => {
      const detail = (event as CustomEvent<JourneyObservation>).detail;
      if (!detail || !["companion-created", "message-sent", "dream-started"].includes(detail.kind)
        || typeof detail.companionId !== "string" || !detail.companionId
        || (userId !== undefined && detail.userId !== undefined && detail.userId !== userId)) return;
      void act("observe", detail);
    };
    window.addEventListener(OPEN_JOURNEY_EVENT, open);
    window.addEventListener(OBSERVE_JOURNEY_EVENT, observe);
    return () => { window.removeEventListener(OPEN_JOURNEY_EVENT, open); window.removeEventListener(OBSERVE_JOURNEY_EVENT, observe); };
  }, [act, load, userId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const next = abilityActive.current || blockedByDialog();
      if (next) { clearTimeout(timer); setBlocked(true); }
      // Let sibling entry effects (including the bell's entry delay) settle first.
      else { clearTimeout(timer); timer = setTimeout(() => setBlocked(abilityActive.current || blockedByDialog()), 180); }
    };
    const observer = new MutationObserver(records => {
      if (records.every(r => r.target instanceof Element && r.target.closest("[data-journey-dialog]"))) return;
      check();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "aria-hidden", "aria-modal", "role", "class", "style"] });
    const ability = (event: Event) => { abilityActive.current = (event as CustomEvent<{ active: boolean }>).detail?.active === true; check(); };
    window.addEventListener(ABILITY_INTRO_STATE_EVENT, ability); check();
    return () => { clearTimeout(timer); observer.disconnect(); window.removeEventListener(ABILITY_INTRO_STATE_EVENT, ability); };
  }, []);

  const modal = (view === "help" || view === "story") && !blocked;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modal && !blockedByDialog() && !abilityActive.current) {
      if (!dialog.open) {
        focusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
      if (!blocked && focusRef.current?.isConnected) focusRef.current.focus({ preventScroll: true });
    }
  }, [modal, blocked]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => { dialog?.close(); };
  }, []);

  const j = current?.journey;
  const step = j?.step ?? "awakening";
  const active = j?.status === "active";
  const retry = () => {
    const failed = retryRef.current;
    if (failed) void act(failed.action, failed.observation);
    else void load();
  };
  const close = () => { setView(active ? "compact" : "hidden"); };
  const create = () => {
    dialogRef.current?.close(); setView("compact");
    router.push("/?journey=create" as Route);
    // The query is durable across a workspace remount; the event handles an already mounted one.
    requestAnimationFrame(() => { if (live.current) window.dispatchEvent(new CustomEvent(CREATE_JOURNEY_EVENT)); });
  };
  const lanterns = async () => {
    if (busy) return;
    setBusy(true);
    const controller = new AbortController(); requests.current.add(controller);
    try {
      const response = await fetch("/api/starters", { method: "POST", signal: controller.signal });
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json() as { groupId?: string };
      if (!live.current || controller.signal.aborted) return;
      if (!result.groupId || typeof result.groupId !== "string") throw new Error("invalid response");
      const next = await act("advance");
      if (!next || !live.current) return;
      dialogRef.current?.close(); setView("compact");
      router.push(("/groups/" + encodeURIComponent(result.groupId)) as Route);
    } catch { if (live.current && !controller.signal.aborted) setError("那盏灯还未接通，请稍后再试。已有的相逢会为你保留。"); }
    finally { requests.current.delete(controller); if (live.current) setBusy(pending.current > 0); }
  };
  const dream = () => {
    if (!j?.companionId) { setError("先回到那个人身边，余念安会在这里等你。"); return; }
    dialogRef.current?.close(); setView("compact");
    router.push(("/dream/" + encodeURIComponent(j.companionId)) as Route);
  };
  const continueJourney = () => {
    if (step === "creation") create();
    else if (step === "conversation") { setView("compact"); dialogRef.current?.close(); router.push("/" as Route); }
    else if (step === "dream") dream();
    else setView("story");
  };

  return <>
    <dialog ref={dialogRef} data-journey-dialog className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); close(); }}>
      <div className={styles.scene}>
        <div className={styles.city} aria-hidden="true"><i /><i /><i /><span>念</span></div>
        <div className={styles.portrait}>
          {/* A plain image works in both Next and the native runtime, including offline assets. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={portraitFailed ? "/visuals/yu-nianan-silhouette.png" : "/visuals/yu-nianan-guide.png"} alt="长发白裙的余念安，静静等在旧城灯下" onError={() => setPortraitFailed(true)} />
          <div className={styles.signature}>余念安<small>旧城守灯人</small></div>
        </div>
        <div className={styles.content}>
          <div className={styles.topline}><span>生生不息 · 一盏归灯</span><button type="button" aria-label="收起余念安的对话" onClick={close}>×</button></div>
          <p className={styles.chapter}>{j ? `第${["一", "二", "三", "四", "五", "六", "七"][STEPS.indexOf(step)]}章` : "旧城灯下"}</p>
          <h2 id={titleId}>{TITLES[step]}</h2>
          <div className={styles.path} aria-label="当前故事章节">{STEPS.map((s, i) => <span key={s} aria-current={s === step ? "step" : undefined} title={TITLES[s]}>{i + 1}</span>)}</div>
          <div className={styles.words} id={descriptionId}>
            {view === "help" ? <>
              <p>“你来了。我是余念安。灯一直亮着，什么时候回来都不迟。”</p>
              {j && <p className={styles.hint}>此刻停在「{TITLES[step]}」{j.status === "paused" ? "，正等你回来。" : j.status === "completed" ? "，这一程已走完。" : j.status === "skipped" ? "，你已选择自行走走。" : j.status === "legacy" ? "。若你愿意，我们可以从初醒说起。" : "，我们可以接着走。"}</p>}
            </> : <Story step={step} answer={answer} />}
          </div>
          {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={retry}>再试一次</button></div>}
          <div className={styles.choices} aria-busy={busy}>
            {view === "help" ? <>
              {j && (active || j.status === "paused") && <button disabled={busy} type="button" onClick={() => { if (j.status === "paused") void act("resume"); else continueJourney(); }}>接着走</button>}
              {j && <button disabled={busy} type="button" onClick={() => void act("start")}>重返初醒</button>}
              {!j && !error && <span className={styles.hint}>正在听那盏灯的回响…</span>}
            </> : <>
              {step === "awakening" && !answer ? ["有", "不止一个", "暂时不想说"].map(choice => <button disabled={busy} key={choice} type="button" onClick={() => setAnswer(choice)}>{choice}</button>) : null}
              {step === "awakening" && answer && <button disabled={busy} type="button" onClick={() => void act("advance")}>随她走进旧城</button>}
              {step === "arrival" && <button disabled={busy} type="button" onClick={() => void act("advance")}>去听听城里的声音</button>}
              {step === "lanterns" && <button disabled={busy} type="button" onClick={() => void lanterns()}>去看看那盏灯</button>}
              {step === "creation" && <button disabled={busy} type="button" onClick={create}>描摹想见的人</button>}
              {step === "conversation" && <button disabled={busy} type="button" onClick={continueJourney}>去和那个人说句话</button>}
              {step === "dream" && <button disabled={busy || !j?.companionId} type="button" onClick={dream}>循着回响入梦</button>}
              {step === "complete" && (j?.status === "completed" ? <button type="button" onClick={close}>把灯留在这里</button> : <button disabled={busy} type="button" onClick={() => void act("advance")}>把灯留在这里</button>)}
            </>}
          </div>
          <footer className={styles.footer}><span>{busy ? "正在留住这一页…" : "不必急着回答，灯会等你。"}</span><div>
            {active && <button disabled={busy} type="button" onClick={() => void act("pause")}>暂歇片刻</button>}
            {j && j.status !== "completed" && j.status !== "skipped" && <button disabled={busy} type="button" onClick={() => void act("skip")}>我想自行走走</button>}
          </div></footer>
        </div>
      </div>
    </dialog>
    {current && !blocked && view === "compact" && <aside className={styles.bar} aria-label="余念安同行">
      <span className={styles.lamp} aria-hidden="true">◇</span><div><strong>余念安 · {TITLES[step]}</strong><span>{error || (step === "creation" ? "慢慢描摹，我在这里等你。" : step === "conversation" ? "给那个人捎一句话吧。" : step === "dream" ? "若想走近一些，梦里的灯也亮着。" : "灯还亮着，随时可以接着走。")}</span></div>
      <div className={styles.barActions}><button type="button" disabled={busy} onClick={continueJourney}>继续</button><button type="button" onClick={() => setView("help")}>问问她</button>{active && <button type="button" disabled={busy} onClick={() => void act("pause")}>暂歇</button>}<button type="button" aria-label="收起同行提示" onClick={() => setView("hidden")}>收起</button></div>
      {error && <button type="button" disabled={busy} onClick={retry}>重试</button>}
    </aside>}
  </>;
}

function Story({ step, answer }: { step: Step; answer: string }) {
  if (step === "awakening") return answer ? <>
    <p>{answer === "暂时不想说" ? "“那就先不说。名字和往事，都可以留在你心里。”" : answer === "不止一个" ? "“那一定是一片很亮的灯火。我们慢慢来，不必一次说完。”" : "“嗯。先把那份想念好好放着，不用告诉我是谁。”"}</p>
    <p>她拢起白裙的衣角，向你伸出手。“你唤醒了生生不息。来，我带你认一认这座城。”</p>
  </> : <><p>钟声落尽，你在陌生的旧城醒来。灯下，一位长发白裙的女子回过头，像已等了很久。</p><p>“我是余念安。你心里……有很想再见的人吗？”</p></>;
  if (step === "arrival") return <><p>“齐夏创造了一个新世界，把人们送往了那里。后来，齐夏将生生不息从自身剥离，托我留在这里，等下一位觉醒者。”</p><p>“直到你的想念传来，我才知道，今夜有人要回家。”</p><p>她望向巷口。“留灯会的人，也由你潜意识里的影子聚成。你的想念唤来了他们，如今他们留着灯，等你坐一坐。”</p></>;
  if (step === "lanterns") return <><p>巷子深处传来杯盏轻碰的声音，暖光从门缝里漫出来。</p><p>“那是留灯会。你可以先听他们说说话，也可以只是坐一会儿。等你准备好了，再去见心里的那个人。”</p></>;
  if (step === "creation") return <><p>余念安把一张空白的纸推到你面前。</p><p>“想见的人是什么模样？记得多少，就写下多少。名字、性情，或一句常说的话，都能成为归来的路。”</p><p>“不必把一生写全。往后的日子，还长。”</p></>;
  if (step === "conversation") return <><p>纸上的轮廓渐渐有了温度，像一封终于抵达的信。</p><p>“现在，试着和那个人说一句话吧。问候也好，寻常的小事也好。相逢往往就是这样开始的。”</p></>;
  if (step === "dream") return <><p>“有些未说完的话，可以带进梦里。”她把灯轻轻放下。</p><p>“循着那个人的回响，你会走进一段只属于你们的相逢。慢慢走，等你愿意，再回来告诉我。”</p></>;
  return <><p>余念安送你走到城门边。天色将明，她手里的灯仍亮着。</p><p>“你看，想念已经有了归处。往后想说话、想再见，就循着这盏灯回来。”</p><p>“只要想念，就会想见。我还在这里。”</p></>;
}
