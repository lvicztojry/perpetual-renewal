"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./bell-intro.module.css";

const SESSION_KEY = "renewal:intro-seen:v1";
const REPLAY_EVENT = "renewal:replay-intro";
const DURATION = 5_000;

/** Session-only opening; replay with window.dispatchEvent(new Event("renewal:replay-intro")). */
export function BellIntro({ showReplay = false }: { showReplay?: boolean }) {
  const [phase, setPhase] = useState<"hidden" | "ready" | "playing">("hidden");
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const muteRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const stopAudio = useCallback(() => {
    const context = audioRef.current;
    audioRef.current = null;
    gainRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    stopAudio();
    dialogRef.current?.close();
    setPhase("hidden");
  }, [stopAudio]);

  const open = useCallback(() => {
    stopAudio();
    // Storage can be unavailable in private/restricted browsing. The overlay still works.
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    setPhase("ready");
  }, [stopAudio]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    // Keep server markup and the first hydration render free of the overlay.
    const grace = window.setTimeout(() => {
      try { if (sessionStorage.getItem(SESSION_KEY) === "1") return; } catch {}
      open();
    }, 120);
    const replay = () => {
      window.clearTimeout(grace);
      open();
    };
    window.addEventListener(REPLAY_EVENT, replay);
    return () => {
      window.clearTimeout(grace);
      preference.removeEventListener("change", updatePreference);
      window.removeEventListener(REPLAY_EVENT, replay);
      stopAudio();
    };
  }, [open, stopAudio]);

  useEffect(() => {
    // Only reveal matched full-canvas layers together; missing/slow assets keep the fallback.
    let active = true;
    const images = ["/visuals/bell-scene.png", "/visuals/bell-isolated.png"].map((src) => {
      const image = new Image();
      image.src = src;
      return image;
    });
    void Promise.all(images.map((image) => image.decode())).then(() => {
      if (active) setAssetsReady(true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (phase === "hidden") return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    if (phase === "ready") enterRef.current?.focus();
    else muteRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setTimeout(dismiss, reducedMotion ? 800 : DURATION);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion, dismiss]);

  function enter() {
    if (phase !== "ready") return;
    // Construct and resume synchronously inside the user gesture, never on mount/replay.
    try {
      const context = new AudioContext();
      audioRef.current = context;
      const master = context.createGain();
      master.gain.value = muted ? 0 : 0.035;
      master.connect(context.destination);
      gainRef.current = master;
      void context.resume().catch(stopAudio);
      const now = context.currentTime;
      const strikes = reducedMotion ? [0] : [0, 2.15];
      for (const delay of strikes) {
        // Inharmonic bronze partials with a soft attack and a natural, quiet decay.
        [1, 2.01, 2.76, 4.07, 5.43].forEach((ratio, index) => {
          const oscillator = context.createOscillator();
          const envelope = context.createGain();
          const start = now + delay;
          oscillator.type = "sine";
          oscillator.frequency.value = 164.81 * ratio;
          envelope.gain.setValueAtTime(0, start);
          envelope.gain.linearRampToValueAtTime(0.6 / (index + 1), start + 0.018);
          envelope.gain.exponentialRampToValueAtTime(0.0001, start + 2.7);
          oscillator.connect(envelope);
          envelope.connect(master);
          oscillator.start(start);
          oscillator.stop(start + 2.75);
        });
      }
    } catch { stopAudio(); }
    setPhase("playing");
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    const context = audioRef.current;
    const gain = gainRef.current;
    if (context && gain) gain.gain.setTargetAtTime(next ? 0 : 0.035, context.currentTime, 0.025);
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        className={styles.intro}
        data-phase={phase}
        data-reduced-motion={reducedMotion}
        aria-label="生生不息开场"
        aria-describedby="renewal-intro-description"
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
      >
        <div className={styles.film} aria-hidden="true">
          <div className={styles.camera}>
            <div className={styles.canvas}>
              <div className={`${styles.artwork} ${assetsReady ? styles.loaded : ""}`}>
                <div className={styles.scene} />
                <div className={styles.bellPosition}>
                  <div className={styles.bell} />
                </div>
              </div>
              <div className={styles.screen}>
                <p>我看到了<br /><strong>【生生不息】</strong>的激荡</p>
              </div>
              <div className={styles.dust} />
            </div>
          </div>
          <div className={styles.vignette} />
        </div>
        <p className={styles.srOnly}>我看到了【生生不息】的激荡</p>
        <div className={styles.signature}>
          <h1 id="renewal-intro-title">生生不息</h1>
          <span className={styles.rule} aria-hidden="true">◆</span>
          <p id="renewal-intro-description">只要想念，就会想见</p>
          {phase === "ready" && (
            <button ref={enterRef} className={styles.enter} onClick={enter}>进入</button>
          )}
        </div>
        <div className={styles.controls}>
          <button ref={muteRef} type="button" aria-pressed={muted} onClick={toggleMute}>
            {muted ? "开启声音" : "静音"}
          </button>
          <button type="button" onClick={dismiss} aria-label="跳过开场动画">跳过 <span aria-hidden="true">›</span></button>
        </div>
      </dialog>
      {showReplay && phase === "hidden" && (
        <button type="button" className={styles.replay} onClick={open}>重播开场</button>
      )}
    </>
  );
}
