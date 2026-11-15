"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./bell-intro.module.css";
import { RenewalSilhouette } from "./renewal-silhouette";
import { BELL_VOLUME, createGiantBellSound } from "@/lib/audio/giant-bell";
import { ABILITY_INTRO_EVENT, publishAbilityIntroState, type AbilityIntroRequest } from "@/lib/ability-events";

const SESSION_KEY = "renewal:intro-seen:v1";
const REPLAY_EVENT = "renewal:replay-intro";

/** One replaceable scene for brand entry, meeting and dream entry. */
export function BellIntro({ showReplay = false }: { showReplay?: boolean }) {
  const [phase, setPhase] = useState<"hidden" | "ready" | "playing">("hidden");
  const [request, setRequest] = useState<AbilityIntroRequest>({ kind: "renewal" });
  const [run, setRun] = useState(0);
  const [muted, setMuted] = useState(false);
  const [silent, setSilent] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const muteRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const mutedRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopAudio = useCallback(() => {
    const context = audioRef.current;
    audioRef.current = null;
    gainRef.current?.disconnect();
    gainRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    stopAudio();
    dialogRef.current?.close();
    setPhase("hidden");
    publishAbilityIntroState(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [clearTimer, stopAudio]);

  const startAudio = useCallback((next: AbilityIntroRequest) => {
    // Construct/resume synchronously, and only with an active user gesture.
    if (!navigator.userActivation?.isActive || mutedRef.current) {
      setSilent(true);
      return;
    }
    try {
      const context = new AudioContext();
      setSilent(false);
      audioRef.current = context;
      gainRef.current = createGiantBellSound(context, {
        muted: false,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        dream: next.kind === "dream",
        duration: next.short ? 2 : 6
      });
      void context.resume().catch(() => {
        if (audioRef.current === context) { stopAudio(); setSilent(true); }
      });
    } catch { stopAudio(); setSilent(true); }
  }, [stopAudio]);

  const open = useCallback((next: AbilityIntroRequest = { kind: "renewal" }, brand = false) => {
    publishAbilityIntroState(true);
    clearTimer();
    stopAudio();
    if (!dialogRef.current?.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (brand) {
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    }
    setRequest(next);
    setRun((value) => value + 1);
    setSilent(false);
    if (next.autoPlay) startAudio(next);
    setPhase(next.autoPlay ? "playing" : "ready");
  }, [clearTimer, startAudio, stopAudio]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    const grace = window.setTimeout(() => {
      try { if (sessionStorage.getItem(SESSION_KEY) === "1") return; } catch {}
      open({ kind: "renewal" }, true);
    }, 120);
    const replay = () => {
      window.clearTimeout(grace);
      open({ kind: "renewal" }, true);
    };
    const ability = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (!detail || typeof detail !== "object" || !("kind" in detail)) return;
      if (detail.kind !== "renewal" && detail.kind !== "dream") return;
      const value = detail as AbilityIntroRequest;
      window.clearTimeout(grace);
      open({
        kind: value.kind,
        companionName: typeof value.companionName === "string" ? value.companionName : undefined,
        short: value.short === true,
        autoPlay: value.autoPlay === true
      });
    };
    window.addEventListener(REPLAY_EVENT, replay);
    window.addEventListener(ABILITY_INTRO_EVENT, ability);
    return () => {
      window.clearTimeout(grace);
      clearTimer();
      preference.removeEventListener("change", updatePreference);
      window.removeEventListener(REPLAY_EVENT, replay);
      window.removeEventListener(ABILITY_INTRO_EVENT, ability);
      stopAudio();
      dialog?.close();
      publishAbilityIntroState(false);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
    };
  }, [open, stopAudio, clearTimer]);

  useEffect(() => {
    // Freeze the fallback if either matched layer is missing or late.
    let active = true;
    const deadline = window.setTimeout(() => { active = false; }, 1_500);
    const images = ["/visuals/bell-scene.png", "/visuals/bell-isolated.png"].map((src) => {
      const image = new Image();
      image.src = src;
      return image;
    });
    void Promise.all(images.map((image) => image.decode())).then(() => {
      if (active) setAssetsReady(true);
    }).catch(() => {}).finally(() => window.clearTimeout(deadline));
    return () => { active = false; window.clearTimeout(deadline); };
  }, []);

  useEffect(() => {
    if (phase === "hidden") return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    if (phase === "ready") enterRef.current?.focus();
    else muteRef.current?.focus();
  }, [phase, run]);

  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = setTimeout(dismiss, reducedMotion ? 800 : request.short ? 2_000 : 6_000);
    return clearTimer;
  }, [phase, run, reducedMotion, request.short, dismiss, clearTimer]);

  function enter() {
    if (phase !== "ready") return;
    startAudio(request);
    setPhase("playing");
  }

  function toggleMute() {
    const next = !(mutedRef.current || silent);
    mutedRef.current = next;
    setMuted(next);
    const context = audioRef.current;
    const gain = gainRef.current;
    if (context && gain) gain.gain.setTargetAtTime(next ? 0 : BELL_VOLUME, context.currentTime, 0.025);
    else if (!next && phase === "playing") startAudio(request);
  }

  const dream = request.kind === "dream";
  const caption = dream ? "我听到了【入梦】的回响" : "我看到了【生生不息】的激荡";
  return (
    <>
      <dialog
        ref={dialogRef}
        className={styles.intro}
        data-phase={phase}
        data-ability={request.kind}
        data-short={request.short === true}
        data-reduced-motion={reducedMotion}
        aria-label={dream ? "入梦开场" : "生生不息开场"}
        aria-describedby="renewal-intro-description"
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
      >
        <div key={run} className={styles.film} aria-hidden="true">
          <div className={styles.camera}>
            <div className={styles.canvas}>
              <div className={`${styles.artwork} ${assetsReady ? styles.loaded : ""}`}>
                <div className={styles.scene} />
                <div className={styles.bellPosition}><div className={styles.bell} /></div>
              </div>
              <div className={styles.screen}>
                <p>{dream ? "我听到了" : "我看到了"}<br /><strong>{dream ? "【入梦】" : "【生生不息】"}</strong>{dream ? "的回响" : "的激荡"}</p>
              </div>
              {dream ? <>
                <div className={`${styles.cityEcho} ${assetsReady ? styles.loaded : ""}`} />
                <div className={styles.reflection} />
                <div className={styles.memories}><i /><i /><i /></div>
                <div className={styles.door}><div className={styles.doorLeaf} /></div>
                <div className={styles.dreamVeil} />
              </> : <div className={styles.birth}><div className={styles.orb} /><RenewalSilhouette className={styles.silhouette} /></div>}
              <div className={styles.dust} />
            </div>
          </div>
          <div className={styles.vignette} />
        </div>
        <p className={styles.srOnly}>{caption}</p>
        <div className={styles.signature}>
          <h1 id="renewal-intro-title">{dream ? "入梦" : "生生不息"}</h1>
          <span className={styles.rule} aria-hidden="true">◆</span>
          <p id="renewal-intro-description">{dream ? "循着回响，再见一面" : "只要想念，就会想见"}</p>
          {request.companionName && <span className={styles.companion}>{request.companionName}</span>}
          {phase === "ready" && <button ref={enterRef} className={styles.enter} onClick={enter}>进入</button>}
        </div>
        <div className={styles.controls}>
          <button ref={muteRef} type="button" aria-pressed={muted || silent} onClick={toggleMute}>{muted || silent ? "开启声音" : "静音"}</button>
          <button type="button" onClick={dismiss} aria-label="跳过开场动画">跳过 <span aria-hidden="true">›</span></button>
        </div>
      </dialog>
      {showReplay && phase === "hidden" && <button type="button" className={styles.replay} onClick={() => open({ kind: "renewal" }, true)}>重播开场</button>}
    </>
  );
}
