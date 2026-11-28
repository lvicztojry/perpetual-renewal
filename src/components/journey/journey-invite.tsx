"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./journey-invite.module.css";

/**
 * A quiet, non-blocking offer shown the first time someone opens a feature.
 * It never covers the page with a scrim; declining is remembered per account.
 */
export function JourneyInvite({ title, onAccept, onDecline, onLater }: {
  title: string;
  onAccept: () => void;
  onDecline: () => void;
  onLater: () => void;
}) {
  const titleId = useId();
  const accept = useRef<HTMLButtonElement>(null);
  useEffect(() => { accept.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onLater(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onLater]);

  return <aside className={styles.invite} role="region" aria-labelledby={titleId} data-journey-overlay data-guide-invite>
    <p className={styles.kicker}>余念安</p>
    <p className={styles.text} id={titleId}>这里也有一小段，要不要我陪你走一遍？<span>{title}</span></p>
    <div className={styles.actions}>
      <button ref={accept} type="button" className={styles.primary} onClick={onAccept}>走一遍</button>
      <button type="button" onClick={onLater}>以后再说</button>
      <button type="button" className={styles.quiet} onClick={onDecline}>不用了</button>
    </div>
  </aside>;
}
